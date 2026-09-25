/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "./_generated/api";
import { MAX_SERVICE_ACCOUNTS } from "./googleAccounts";
import { appErrorPayloadOf } from "./model/appErrors";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

type Test = ReturnType<typeof convexTest>;
type Identity = Awaited<ReturnType<typeof signInAdmin>>;

// One client more than one transaction of the unlink writes, so the clients
// past the first batch are the ones a follow-up has to clear.
const LINKED_CLIENTS = 1002;

/**
 * An administrator the mutations accept as signed in. `getAuthUserId` reads the
 * user id out of the identity subject, so the profile it looks up has to belong
 * to the row the subject names.
 */
async function signInAdmin(t: Test) {
  const userId = await t.run((ctx) => ctx.db.insert("users", { email: "admin@example.com" }));
  await t.run((ctx) =>
    ctx.db.insert("staffProfiles", {
      userId,
      displayName: "Ada",
      role: "admin",
      status: "active",
    })
  );

  return { subject: userId };
}

function accountRow(email: string, clientCount?: number) {
  return {
    email,
    privateKey: "test-private-key",
    ...(clientCount === undefined ? {} : { clientCount }),
  };
}

/** The count the accounts list reports for the only account of a test. */
async function reportedClientCount(t: Test, identity: Identity): Promise<number> {
  const data = await t.withIdentity(identity).query(api.googleAccounts.listServiceAccounts, {});
  return data.serviceAccounts[0]?.clientCount ?? 0;
}

describe("googleAccounts.removeServiceAccount", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("clears the link of every client that used the account", async () => {
    const t = convexTest(schema, modules);
    const identity = await signInAdmin(t);

    const serviceAccountId = await t.run(async (ctx) => {
      const inserted = await ctx.db.insert(
        "googleServiceAccounts",
        accountRow("reader@example.iam.gserviceaccount.com", 0)
      );

      for (let index = 0; index < LINKED_CLIENTS; index += 1) {
        await ctx.db.insert("clients", {
          key: `client-${index}`,
          name: `Client ${index}`,
          isActive: true,
          serviceAccountId: inserted,
        });
      }

      return inserted;
    });

    const result = await t
      .withIdentity(identity)
      .mutation(api.googleAccounts.removeServiceAccount, { serviceAccountId });

    // What one transaction writes is capped, so the clients past the first
    // batch are the follow-up's, not this call's.
    expect(result.unlinkedClientCount).toBeLessThan(LINKED_CLIENTS);
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const stillLinked = await t.run((ctx) =>
      ctx.db
        .query("clients")
        .withIndex("by_serviceAccountId", (query) => query.eq("serviceAccountId", serviceAccountId))
        .take(1)
    );
    expect(stillLinked).toEqual([]);

    const account = await t.run((ctx) => ctx.db.get("googleServiceAccounts", serviceAccountId));
    expect(account).toBeNull();
  });
});

describe("googleAccounts.listServiceAccounts", () => {
  it("reports the clients linked to an account, in step with the client mutations", async () => {
    const t = convexTest(schema, modules);
    const identity = await signInAdmin(t);

    const serviceAccountId = await t.run((ctx) =>
      ctx.db.insert(
        "googleServiceAccounts",
        accountRow("reader@example.iam.gserviceaccount.com", 0)
      )
    );

    const linked = await t.withIdentity(identity).mutation(api.clinics.createClient, {
      name: "Winfield Dental",
      serviceAccountId,
    });
    const plain = await t.withIdentity(identity).mutation(api.clinics.createClient, {
      name: "Smilist",
      serviceAccountId: null,
    });

    expect(await reportedClientCount(t, identity)).toBe(1);

    // A link that moves moves both counts, whichever way it moves.
    await t.withIdentity(identity).mutation(api.clinics.updateClient, {
      clientId: plain.clientId,
      name: "Smilist",
      isActive: true,
      serviceAccountId,
    });
    expect(await reportedClientCount(t, identity)).toBe(2);

    await t.withIdentity(identity).mutation(api.clinics.updateClient, {
      clientId: linked.clientId,
      name: "Winfield Dental",
      isActive: true,
      serviceAccountId: null,
    });
    expect(await reportedClientCount(t, identity)).toBe(1);

    await t.withIdentity(identity).mutation(api.clinics.removeClient, { clientId: plain.clientId });
    expect(await reportedClientCount(t, identity)).toBe(0);
  });
});

describe("googleAccounts.createServiceAccount", () => {
  it("refuses an account past the page the list and the picker read", async () => {
    const t = convexTest(schema, modules);
    const identity = await signInAdmin(t);

    await t.run(async (ctx) => {
      for (let index = 0; index < MAX_SERVICE_ACCOUNTS; index += 1) {
        await ctx.db.insert(
          "googleServiceAccounts",
          accountRow(`reader-${index}@example.iam.gserviceaccount.com`)
        );
      }
    });

    const failure = await t
      .withIdentity(identity)
      .mutation(api.googleAccounts.createServiceAccount, { secretKey: "not a key file" })
      .catch((error: unknown) => appErrorPayloadOf(error));

    expect(failure).toEqual({ code: "SERVICE_ACCOUNT_LIMIT", limit: MAX_SERVICE_ACCOUNTS });
  });
});

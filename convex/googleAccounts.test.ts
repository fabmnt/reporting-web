/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";

import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

type Test = ReturnType<typeof convexTest>;

// One client more than the page the delete used to read, so a link the mutation
// walks past would show up in the client count it answers with.
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

describe("googleAccounts.removeServiceAccount", () => {
  it("clears the link of every client that used the account", async () => {
    const t = convexTest(schema, modules);
    const identity = await signInAdmin(t);

    const serviceAccountId = await t.run(async (ctx) => {
      const inserted = await ctx.db.insert("googleServiceAccounts", {
        email: "reader@example.iam.gserviceaccount.com",
        privateKey: "test-private-key",
      });

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

    expect(result.unlinkedClientCount).toBe(LINKED_CLIENTS);

    const stillLinked = await t.run((ctx) =>
      ctx.db
        .query("clients")
        .withIndex("by_serviceAccountId", (query) => query.eq("serviceAccountId", serviceAccountId))
        .take(1)
    );
    expect(stillLinked).toEqual([]);
  });
});

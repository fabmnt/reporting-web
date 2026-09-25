/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";

import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

type Test = ReturnType<typeof convexTest>;

/** Two clients to tell apart, so an operator can hold one and not the other. */
async function twoClients(t: Test) {
  return await t.run(async (ctx) => ({
    heldClientId: await ctx.db.insert("clients", {
      key: "winfield-dental",
      name: "Winfield Dental",
      isActive: true,
    }),
    otherClientId: await ctx.db.insert("clients", {
      key: "smilist",
      name: "Smilist",
      isActive: true,
    }),
  }));
}

/**
 * An operator who holds one clinic of the given client and nothing else.
 * `getAuthUserId` reads the user id out of the identity subject, so the profile
 * it looks up belongs to the row the subject names.
 */
async function signInOperator(t: Test, heldClientId: Id<"clients">) {
  const userId = await t.run((ctx) => ctx.db.insert("users", { email: "grace@example.com" }));
  await t.run(async (ctx) => {
    const clinicId = await ctx.db.insert("clinics", {
      clientId: heldClientId,
      name: "Downtown",
      googleSheetId: "sheet-downtown",
      externalClinicId: "ccc-downtown",
      isActive: true,
    });
    await ctx.db.insert("staffProfiles", {
      userId,
      displayName: "Grace",
      role: "operator",
      status: "active",
      assignedClinicIds: [clinicId],
    });
  });

  return { subject: userId };
}

describe("googleSheets.clientIsInScope", () => {
  it("holds the clients whose clinics the caller works on", async () => {
    const t = convexTest(schema, modules);
    const { heldClientId, otherClientId } = await twoClients(t);
    const identity = await signInOperator(t, heldClientId);

    const held = await t
      .withIdentity(identity)
      .query(internal.googleSheets.clientIsInScope, { clientId: heldClientId });
    const other = await t
      .withIdentity(identity)
      .query(internal.googleSheets.clientIsInScope, { clientId: otherClientId });

    expect(held).toBe(true);
    expect(other).toBe(false);
  });
});

/**
 * The account that reads a client's sheets is named by the caller, so it is
 * only used for a client the caller works on: a run reads the clinics of the
 * operator and nothing else.
 */
describe("googleSheets.listSheetTabs", () => {
  it("refuses the account of a client the caller does not work on", async () => {
    const t = convexTest(schema, modules);
    const { heldClientId, otherClientId } = await twoClients(t);
    const identity = await signInOperator(t, heldClientId);

    await expect(
      t.withIdentity(identity).action(api.googleSheets.listSheetTabs, {
        googleSheetId: "sheet-elsewhere",
        clientId: otherClientId,
      })
    ).rejects.toThrow(/CLIENT_NOT_ASSIGNED/);
  });
});

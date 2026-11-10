/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";

import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

it("invalidates report configuration and removes cached tabs when a clinic is deleted", async () => {
  const t = convexTest(schema, modules);
  const identity = await signInAdmin(t);
  const clinicId = await t.run(async (ctx) => {
    const clientId = await ctx.db.insert("clients", {
      key: "cache",
      name: "Cache",
      isActive: true,
    });
    return await ctx.db.insert("clinics", {
      clientId,
      name: "Cache",
      googleSheetId: "old",
      isActive: true,
    });
  });
  const signedIn = t.withIdentity(identity);
  await t.run(async (ctx) => {
    const profile = await ctx.db.query("staffProfiles").first();
    if (profile === null) throw new Error("Missing profile");
    await ctx.db.patch(profile._id, { assignedClinicIds: [clinicId] });
  });
  const before = await signedIn.query(api.googleSheets.listAssignedReportClinics, {});
  await t.run(async (ctx) => {
    await ctx.db.patch(clinicId, { googleSheetId: "new" });
    await ctx.db.insert("sheetTabCache", {
      clinicId,
      spreadsheetId: "old",
      credentialKey: "oauth",
      titles: ["2026-01-01"],
      fetchedAt: 1,
    });
  });
  const after = await signedIn.query(api.googleSheets.listAssignedReportClinics, {});
  expect(after.clinics).not.toEqual(before.clinics);
  await signedIn.mutation(api.clinics.remove, { clinicId });
  const remaining = await t.run((ctx) =>
    ctx.db
      .query("sheetTabCache")
      .withIndex("by_clinicId", (q) => q.eq("clinicId", clinicId))
      .unique()
  );
  expect(remaining).toBeNull();
  await t.mutation(internal.sheetTabCache.put, {
    clinicId,
    spreadsheetId: "new",
    credentialKey: "oauth",
    titles: ["2026-01-01"],
    fetchedAt: 2,
  });
  expect(
    await t.run((ctx) =>
      ctx.db
        .query("sheetTabCache")
        .withIndex("by_clinicId", (q) => q.eq("clinicId", clinicId))
        .unique()
    )
  ).toBeNull();
});

type Test = ReturnType<typeof convexTest>;

/**
 * An administrator the queries accept as signed in. `getAuthUserId` reads the
 * user id out of the identity subject, so the profile it looks up has to
 * belong to the row the subject names.
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

  const sessionId = await t.run((ctx) =>
    ctx.db.insert("authSessions", {
      userId,
      expirationTime: Date.now() + 3_600_000,
    })
  );
  return { subject: `${userId}|${sessionId}` };
}

/**
 * The list pages the clinics table and then walks every profile to name the
 * accounts that hold each row: the walk is a second read of a different table
 * in the same function, which is what it has to survive.
 */
describe("clinics.list", () => {
  it("names the client and the accounts that hold each clinic", async () => {
    const t = convexTest(schema, modules);
    const identity = await signInAdmin(t);

    const clinicId = await t.run(async (ctx) => {
      const clientId = await ctx.db.insert("clients", {
        key: "winfield-dental",
        name: "Winfield Dental",
        isActive: true,
      });
      const inserted = await ctx.db.insert("clinics", {
        clientId,
        name: "Winfield Dental",
        googleSheetId: "sheet-winfield",
        externalClinicId: "ccc-winfield",
        isActive: true,
      });
      const operatorUserId = await ctx.db.insert("users", { email: "grace@example.com" });
      await ctx.db.insert("staffProfiles", {
        userId: operatorUserId,
        displayName: "Grace",
        role: "operator",
        status: "active",
        assignedClinicIds: [inserted],
      });

      return inserted;
    });

    const page = await t
      .withIdentity(identity)
      .query(api.clinics.list, { paginationOpts: { numItems: 10, cursor: null } });

    expect(page.isDone).toBe(true);
    expect(page.page).toHaveLength(1);
    expect(page.page[0]).toMatchObject({
      clinicId,
      name: "Winfield Dental",
      clientName: "Winfield Dental",
      externalClinicId: "ccc-winfield",
      assignedTo: ["Grace"],
    });
  });

  it("searches the fields the table shows", async () => {
    const t = convexTest(schema, modules);
    const identity = await signInAdmin(t);

    await t.run(async (ctx) => {
      const clientId = await ctx.db.insert("clients", {
        key: "smilist",
        name: "Smilist",
        isActive: true,
      });
      await ctx.db.insert("clinics", {
        clientId,
        name: "Downtown",
        googleSheetId: "sheet-downtown",
        externalClinicId: "ccc-downtown",
        isActive: true,
      });
    });

    const found = await t.withIdentity(identity).query(api.clinics.search, { search: "smilist" });

    expect(found.hasMore).toBe(false);
    expect(found.clinics.map((clinic) => clinic.name)).toEqual(["Downtown"]);
  });
});

/**
 * The client table reports the account that reads each client's sheets. The
 * address is looked up per row, because a table with more accounts than one
 * page holds would otherwise name the app's own account for the clients linked
 * past that page.
 */
describe("clinics.listClients", () => {
  // One account more than a single page of accounts used to hold.
  const ACCOUNTS = 201;

  it("names the account of a client linked past a page of accounts", async () => {
    const t = convexTest(schema, modules);
    const identity = await signInAdmin(t);

    await t.run(async (ctx) => {
      let lastAccountId: Id<"googleServiceAccounts"> | null = null;
      for (let index = 0; index < ACCOUNTS; index += 1) {
        lastAccountId = await ctx.db.insert("googleServiceAccounts", {
          email: `reader-${index}@example.iam.gserviceaccount.com`,
          privateKey: "test-private-key",
        });
      }

      await ctx.db.insert("clients", {
        key: "last-account-co",
        name: "Last Account Co",
        isActive: true,
        ...(lastAccountId === null ? {} : { serviceAccountId: lastAccountId }),
      });
    });

    const page = await t
      .withIdentity(identity)
      .query(api.clinics.listClients, { paginationOpts: { numItems: 10, cursor: null } });

    expect(page.page).toHaveLength(1);
    expect(page.page[0]).toMatchObject({
      name: "Last Account Co",
      serviceAccountEmail: `reader-${ACCOUNTS - 1}@example.iam.gserviceaccount.com`,
    });
  });
});

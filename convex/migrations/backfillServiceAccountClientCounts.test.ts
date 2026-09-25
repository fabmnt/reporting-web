/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";

import { internal } from "../_generated/api";
import schema from "../schema";

// The root of the project, not "./", because a relative glob hands back keys
// relative to this file: a test in a subdirectory cannot name the functions
// beside the table it tests from its own directory.
const modules = import.meta.glob("/convex/**/*.ts");

/**
 * The count is a read of the clients written onto the account rows, so the run
 * has to count the whole directory in one pass.
 */
describe("backfillServiceAccountClientCounts", () => {
  it("counts each account's clients and leaves them alone on a second run", async () => {
    const t = convexTest(schema, modules);

    const first = await t.run((ctx) =>
      ctx.db.insert("googleServiceAccounts", {
        email: "first@example.iam.gserviceaccount.com",
        privateKey: "test-private-key",
      })
    );
    // A count that predates the clients it describes, so the run has one to fix.
    await t.run((ctx) =>
      ctx.db.insert("googleServiceAccounts", {
        email: "stale@example.iam.gserviceaccount.com",
        privateKey: "test-private-key",
        clientCount: 7,
      })
    );

    await t.run(async (ctx) => {
      await ctx.db.insert("clients", {
        key: "first-a",
        name: "First A",
        isActive: true,
        serviceAccountId: first,
      });
      await ctx.db.insert("clients", {
        key: "first-b",
        name: "First B",
        isActive: true,
        serviceAccountId: first,
      });
      await ctx.db.insert("clients", { key: "plain", name: "Plain", isActive: true });
    });

    expect(
      await t.mutation(internal.migrations.backfillServiceAccountClientCounts.run, {})
    ).toEqual({ updated: 2 });

    const counts = await t.run(async (ctx) => {
      const accounts = await ctx.db.query("googleServiceAccounts").collect();
      return accounts
        .map((account) => ({ email: account.email, clientCount: account.clientCount }))
        .sort((first, second) => first.email.localeCompare(second.email));
    });

    expect(counts).toEqual([
      { email: "first@example.iam.gserviceaccount.com", clientCount: 2 },
      { email: "stale@example.iam.gserviceaccount.com", clientCount: 0 },
    ]);

    expect(
      await t.mutation(internal.migrations.backfillServiceAccountClientCounts.run, {})
    ).toEqual({ updated: 0 });
  });
});

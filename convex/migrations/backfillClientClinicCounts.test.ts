/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";

import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";

// The root of the project, not "./", because a relative glob hands back keys
// relative to this file: a test in a subdirectory cannot name the functions
// beside the table it tests from its own directory.
const modules = import.meta.glob("/convex/**/*.ts");

type Test = ReturnType<typeof convexTest>;

async function insertClient(t: Test, key: string, name: string): Promise<Id<"clients">> {
  return await t.run((ctx) => ctx.db.insert("clients", { key, name, isActive: true }));
}

function clinicRow(clientId: Id<"clients">, name: string) {
  return {
    clientId,
    name,
    googleSheetId: `sheet-${name}`,
    externalClinicId: `ccc-${name}`,
    isActive: true,
  };
}

/**
 * The count is a read of the clinics written onto the client rows, so the run
 * has to count the whole directory in one pass: a page per client is more than
 * one paginated query for a single function.
 */
describe("backfillClientClinicCounts", () => {
  it("counts each client's clinics and leaves them alone on a second run", async () => {
    const t = convexTest(schema, modules);

    const first = await insertClient(t, "first", "First Dental");
    const second = await insertClient(t, "second", "Second Dental");

    await t.run(async (ctx) => {
      await ctx.db.insert("clinics", clinicRow(first, "First A"));
      await ctx.db.insert("clinics", clinicRow(first, "First B"));
      await ctx.db.insert("clinics", clinicRow(second, "Second"));
    });

    expect(await t.mutation(internal.migrations.backfillClientClinicCounts.run, {})).toEqual({
      updated: 2,
    });

    const counts = await t.run(async (ctx) => {
      const clients = await ctx.db.query("clients").withIndex("by_key").collect();
      return clients.map((client) => [client.key, client.clinicCount]);
    });

    expect(counts).toEqual([
      ["first", 2],
      ["second", 1],
    ]);

    expect(await t.mutation(internal.migrations.backfillClientClinicCounts.run, {})).toEqual({
      updated: 0,
    });
  });
});

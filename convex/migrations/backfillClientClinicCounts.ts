import { v } from "convex/values";

import type { Id } from "../_generated/dataModel";
import { internalMutation } from "../_generated/server";
import type { QueryCtx } from "../_generated/server";

// One index page per read, so counting one client never asks the database for
// more rows than it needs.
const COUNT_PAGE = 200;

async function countClinics(ctx: QueryCtx, clientId: Id<"clients">): Promise<number> {
  let count = 0;
  let cursor: string | null = null;
  let isDone = false;

  while (!isDone) {
    const page = await ctx.db
      .query("clinics")
      .withIndex("by_clientId_and_name", (query) => query.eq("clientId", clientId))
      .paginate({ cursor, numItems: COUNT_PAGE });
    count += page.page.length;
    cursor = page.continueCursor;
    isDone = page.isDone;
  }

  return count;
}

/**
 * One-shot fill of `clients.clinicCount` for a deployment that holds clinics
 * but no stored counts:
 *   npx convex run migrations/backfillClientClinicCounts:run
 *
 * The count is stored so that listing clients costs one read per client instead
 * of one per clinic, and the mutations that write clinics keep it in step from
 * here on. It is always recounted from the clinics table, so running this twice
 * changes nothing.
 *
 * The run is a single transaction: a deployment whose directory is too large to
 * count in one fails the run and writes none of it, which leaves the counts as
 * they were. Tighten `clients.clinicCount` to `v.number()` in convex/schema.ts
 * once this has run everywhere.
 */
export const run = internalMutation({
  args: {},
  returns: v.object({ updated: v.number() }),
  handler: async (ctx) => {
    const clients = await ctx.db.query("clients").withIndex("by_key").collect();
    let updated = 0;

    for (const client of clients) {
      const count = await countClinics(ctx, client._id);
      if (client.clinicCount === count) continue;

      await ctx.db.patch(client._id, { clinicCount: count });
      updated += 1;
    }

    return { updated };
  },
});

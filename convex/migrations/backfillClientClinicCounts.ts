import { v } from "convex/values";

import type { Id } from "../_generated/dataModel";
import { internalMutation } from "../_generated/server";

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
 * The clinics are counted in one pass rather than one client at a time: a
 * function may run a single paginated query, and a page per client is a
 * paginated query per client.
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
    const countsByClient = new Map<Id<"clients">, number>();
    for await (const clinic of ctx.db.query("clinics")) {
      countsByClient.set(clinic.clientId, (countsByClient.get(clinic.clientId) ?? 0) + 1);
    }

    const clients = await ctx.db.query("clients").withIndex("by_key").collect();
    let updated = 0;

    for (const client of clients) {
      const count = countsByClient.get(client._id) ?? 0;
      if (client.clinicCount === count) continue;

      await ctx.db.patch(client._id, { clinicCount: count });
      updated += 1;
    }

    return { updated };
  },
});

import { v } from "convex/values";

import type { Id } from "../_generated/dataModel";
import { internalMutation } from "../_generated/server";

/**
 * One-shot fill of `googleServiceAccounts.clientCount` for a deployment that
 * holds accounts but no stored counts:
 *   npx convex run migrations/backfillServiceAccountClientCounts:run
 *
 * The count is stored so that listing the accounts costs one read per account
 * instead of one per account plus one index scan of the clients, and the
 * mutations that link a client keep it in step from here on. It is always
 * recounted from the clients table, so running this twice changes nothing.
 *
 * The run is a single transaction: a deployment whose directory is too large to
 * count in one fails the run and writes none of it, which leaves the counts as
 * they were. Tighten `googleServiceAccounts.clientCount` to `v.number()` in
 * convex/schema.ts once this has run everywhere.
 */
export const run = internalMutation({
  args: {},
  returns: v.object({ updated: v.number() }),
  handler: async (ctx) => {
    const countsByAccount = new Map<Id<"googleServiceAccounts">, number>();
    for await (const client of ctx.db.query("clients")) {
      const serviceAccountId = client.serviceAccountId;
      if (serviceAccountId === undefined) continue;
      countsByAccount.set(serviceAccountId, (countsByAccount.get(serviceAccountId) ?? 0) + 1);
    }

    // The clients are counted in one pass rather than one account at a time: a
    // page per account is more than one paginated query for a single function.
    const accounts = await ctx.db.query("googleServiceAccounts").collect();
    let updated = 0;

    for (const account of accounts) {
      const count = countsByAccount.get(account._id) ?? 0;
      if (account.clientCount === count) continue;

      await ctx.db.patch(account._id, { clientCount: count });
      updated += 1;
    }

    return { updated };
  },
});

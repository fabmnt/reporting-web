import { v } from "convex/values";

import { internalMutation } from "../_generated/server";
import { cleanConditionSet, type ReportConditionSet } from "../model/reportConditions";
import { PENDING_EXECUTE_REPORT_TYPE } from "../model/reportTypeSeed";
import { engineOf } from "../model/reportTypes";

// One-shot fill for a deployment that seeded "Pending to execute" while the
// rules of the report still lived in code:
//   npx convex run migrations/executeReportConditions:run
//
// The seed stored an empty condition set, and the carrier report now reads its
// rows through the conditions of the report type, so a type left as it is would
// list every row of a clinic whose carrier matched a bot. Only the built-in the
// seed created is touched: same name, never saved since, and without rules. A
// type an administrator edited keeps what it holds, including one whose rules
// were cleared on purpose to match every row.
const SEED_BUCKETS = PENDING_EXECUTE_REPORT_TYPE.conditions.buckets;

function hasRules(conditions: ReportConditionSet): boolean {
  return conditions.buckets.some(
    (bucket) => bucket.expression.filters.length > 0 || bucket.expression.groups.length > 0
  );
}

export const run = internalMutation({
  args: {},
  returns: v.object({ updated: v.array(v.string()) }),
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("reportTypes")
      .withIndex("by_ownerUserId", (query) => query.eq("ownerUserId", null))
      .collect();

    const updated: string[] = [];
    for (const row of rows) {
      if (engineOf(row) !== "execute") continue;
      if (row.name !== PENDING_EXECUTE_REPORT_TYPE.name) continue;
      // Saving a type touches `updatedAt`, so a row that moved on from the
      // seed is the administrator's, whatever its rules say.
      if (row.updatedAt !== row.createdAt) continue;
      if (hasRules(row.conditions)) continue;

      const conditions: ReportConditionSet = cleanConditionSet({
        buckets: row.buckets.map((bucket, index) => ({
          bucketKey: bucket.key,
          catchAll: false,
          expression: SEED_BUCKETS[index]?.expression ?? { filters: [], groups: [] },
        })),
      });
      await ctx.db.patch(row._id, { conditions, updatedAt: Date.now() });
      updated.push(row.name);
    }

    return { updated };
  },
});

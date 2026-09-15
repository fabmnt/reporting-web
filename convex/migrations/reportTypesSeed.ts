import { v } from "convex/values";

import { internalMutation } from "../_generated/server";
import { PENDING_AUDIT_REPORT_TYPE, PENDING_EXECUTE_REPORT_TYPE } from "../model/reportTypeSeed";
import {
  cleanTypeDraft,
  engineOf,
  type ReportEngine,
  type ReportTypeDraft,
} from "../model/reportTypes";

// Built-in report types are rows owned by the deployment, so a deployment
// needs this once:
//   npx convex run migrations/reportTypesSeed:run
// It keeps the rules the app shipped with before administrators could edit
// them. Running it twice does nothing: a type whose name is already there is
// left as it is.
const SEEDS: Array<{ draft: ReportTypeDraft; engine: ReportEngine }> = [
  { draft: PENDING_AUDIT_REPORT_TYPE, engine: "rows" },
  { draft: PENDING_EXECUTE_REPORT_TYPE, engine: "execute" },
];

export const run = internalMutation({
  args: {},
  returns: v.object({ inserted: v.array(v.string()) }),
  handler: async (ctx) => {
    const existing = await ctx.db
      .query("reportTypes")
      .withIndex("by_ownerUserId", (query) => query.eq("ownerUserId", null))
      .collect();
    const takenByName = new Map(existing.map((row) => [row.name.toLowerCase(), engineOf(row)]));

    const inserted: string[] = [];
    for (const seed of SEEDS) {
      const draft = cleanTypeDraft(seed.draft);
      const takenEngine = takenByName.get(draft.name.toLowerCase());
      if (takenEngine !== undefined) {
        // A name held by a type of the other engine means an administrator
        // created one by hand, and skipping in silence would leave the
        // deployment without the report this seed exists for.
        if (takenEngine !== seed.engine) {
          throw new Error(
            `The built-in report type "${draft.name}" already exists as a ${takenEngine} report. ` +
              `Rename it before seeding the ${seed.engine} one.`
          );
        }
        continue;
      }

      const now = Date.now();
      await ctx.db.insert("reportTypes", {
        ownerUserId: null,
        name: draft.name,
        description: draft.description,
        buckets: draft.buckets,
        conditions: draft.conditions,
        usesVerificationFilter: draft.usesVerificationFilter,
        engine: seed.engine,
        createdAt: now,
        updatedAt: now,
      });
      inserted.push(draft.name);
    }

    return { inserted };
  },
});

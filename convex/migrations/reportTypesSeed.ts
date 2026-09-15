import { v } from "convex/values";

import { internalMutation } from "../_generated/server";
import { PENDING_AUDIT_REPORT_TYPE } from "../model/reportTypeSeed";
import { cleanTypeDraft } from "../model/reportTypes";

// Built-in report types are rows owned by the deployment, so a deployment
// needs this once:
//   npx convex run migrations/reportTypesSeed:run
// It keeps the rules the app shipped with before administrators could edit
// them. Running it twice does nothing.
export const run = internalMutation({
  args: {},
  returns: v.object({ inserted: v.boolean() }),
  handler: async (ctx) => {
    const existing = await ctx.db
      .query("reportTypes")
      .withIndex("by_ownerUserId", (query) => query.eq("ownerUserId", null))
      .collect();
    const alreadyThere = existing.some(
      (row) => row.name.toLowerCase() === PENDING_AUDIT_REPORT_TYPE.name.toLowerCase()
    );
    if (alreadyThere) {
      return { inserted: false };
    }

    const draft = cleanTypeDraft(PENDING_AUDIT_REPORT_TYPE);
    const now = Date.now();
    await ctx.db.insert("reportTypes", {
      ownerUserId: null,
      name: draft.name,
      description: draft.description,
      buckets: draft.buckets,
      conditions: draft.conditions,
      usesVerificationFilter: draft.usesVerificationFilter,
      createdAt: now,
      updatedAt: now,
    });

    return { inserted: true };
  },
});

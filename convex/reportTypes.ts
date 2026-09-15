import { v } from "convex/values";

import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import { reportConditionSet } from "./model/reportConditions";
import {
  assertTypeNameAvailable,
  cleanTypeDraft,
  draftFromTemplate,
  engineOf,
  loadBuiltinReportType,
  loadOwnedReportType,
  reportEngine,
  reportTypeBucket,
  reportTypeTemplate,
  type ReportTypeDoc,
  type ReportTypeDraft,
  type ReportTypeTemplate,
} from "./model/reportTypes";
import { requireAdmin, requireOperator } from "./model/staff";

// `builtin` marks the types administrators own for everyone; `mine` marks the
// types the caller owns.
const reportTypeView = v.object({
  reportTypeId: v.id("reportTypes"),
  owner: v.union(v.literal("builtin"), v.literal("mine")),
  name: v.string(),
  description: v.string(),
  buckets: v.array(reportTypeBucket),
  conditions: reportConditionSet,
  usesVerificationFilter: v.boolean(),
  engine: reportEngine,
});

const reportTypeDraftArgs = {
  name: v.string(),
  description: v.string(),
  buckets: v.array(reportTypeBucket),
  conditions: reportConditionSet,
  usesVerificationFilter: v.boolean(),
};

const createArgs = {
  name: v.string(),
  template: reportTypeTemplate,
  // Labels of the template's row groups in the caller's language. The keys
  // stay the template's, only the text changes.
  bucketLabels: v.optional(v.array(v.string())),
};

function viewOf(row: ReportTypeDoc) {
  return {
    reportTypeId: row._id,
    owner: row.ownerUserId === null ? ("builtin" as const) : ("mine" as const),
    name: row.name,
    description: row.description,
    buckets: row.buckets,
    conditions: row.conditions,
    usesVerificationFilter: row.usesVerificationFilter,
    engine: engineOf(row),
  };
}

function sortByName<T extends { name: string }>(rows: T[]): T[] {
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

async function insertType(
  ctx: MutationCtx,
  userId: Id<"users">,
  ownerUserId: Id<"users"> | null,
  args: { name: string; template: ReportTypeTemplate; bucketLabels?: string[] }
) {
  const template = await draftFromTemplate(
    ctx,
    userId,
    args.name,
    args.template,
    args.bucketLabels
  );
  const draft = cleanTypeDraft(template);
  await assertTypeNameAvailable(ctx, ownerUserId, draft.name, null);

  const now = Date.now();
  const reportTypeId = await ctx.db.insert("reportTypes", {
    ownerUserId,
    name: draft.name,
    description: draft.description,
    buckets: draft.buckets,
    conditions: draft.conditions,
    usesVerificationFilter: draft.usesVerificationFilter,
    createdAt: now,
    updatedAt: now,
  });

  return viewOf({
    _id: reportTypeId,
    _creationTime: now,
    ownerUserId,
    ...draft,
    createdAt: now,
    updatedAt: now,
  });
}

async function updateType(ctx: MutationCtx, row: ReportTypeDoc, draft: ReportTypeDraft) {
  const cleaned = cleanTypeDraft(draft);
  await assertTypeNameAvailable(ctx, row.ownerUserId, cleaned.name, row._id);

  const updatedAt = Date.now();
  await ctx.db.patch(row._id, { ...cleaned, updatedAt });
  return viewOf({ ...row, ...cleaned, updatedAt });
}

// The run form and the configuration panels read the same list: the built-in
// types every operator can run plus the types the caller owns. Rules travel
// with the list because a report type now has exactly one definition.
export const listRunnable = query({
  args: {},
  returns: v.object({ types: v.array(reportTypeView) }),
  handler: async (ctx) => {
    const { userId } = await requireOperator(ctx);
    const builtins = await ctx.db
      .query("reportTypes")
      .withIndex("by_ownerUserId", (query) => query.eq("ownerUserId", null))
      .collect();
    const mine = await ctx.db
      .query("reportTypes")
      .withIndex("by_ownerUserId", (query) => query.eq("ownerUserId", userId))
      .collect();

    return { types: [...sortByName(builtins), ...sortByName(mine)].map(viewOf) };
  },
});

export const createMine = mutation({
  args: createArgs,
  returns: reportTypeView,
  handler: async (ctx, args) => {
    const { userId } = await requireOperator(ctx);
    return insertType(ctx, userId, userId, args);
  },
});

export const saveMine = mutation({
  args: { reportTypeId: v.id("reportTypes"), ...reportTypeDraftArgs },
  returns: reportTypeView,
  handler: async (ctx, args) => {
    const { userId } = await requireOperator(ctx);
    const row = await loadOwnedReportType(ctx, userId, args.reportTypeId);
    return updateType(ctx, row, args);
  },
});

export const removeMine = mutation({
  args: { reportTypeId: v.id("reportTypes") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { userId } = await requireOperator(ctx);
    const row = await loadOwnedReportType(ctx, userId, args.reportTypeId);
    await ctx.db.delete("reportTypes", row._id);
    return null;
  },
});

export const createBuiltin = mutation({
  args: createArgs,
  returns: reportTypeView,
  handler: async (ctx, args) => {
    const { userId } = await requireAdmin(ctx);
    return insertType(ctx, userId, null, args);
  },
});

export const saveBuiltin = mutation({
  args: { reportTypeId: v.id("reportTypes"), ...reportTypeDraftArgs },
  returns: reportTypeView,
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const row = await loadBuiltinReportType(ctx, args.reportTypeId);
    return updateType(ctx, row, args);
  },
});

export const removeBuiltin = mutation({
  args: { reportTypeId: v.id("reportTypes") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const row = await loadBuiltinReportType(ctx, args.reportTypeId);
    await ctx.db.delete("reportTypes", row._id);
    return null;
  },
});

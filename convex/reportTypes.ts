import { ConvexError, v } from "convex/values";

import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import {
  bucketCatalogFor,
  cleanConditionSet,
  IMPLEMENTED_REPORT_OPERATIONS,
  reportConditionSet,
  type ImplementedOperationKey,
} from "./model/reportConditions";
import { REPORT_OPERATIONS } from "./model/reportOperations";
import {
  cleanTypeBuckets,
  cleanTypeDescription,
  cleanTypeName,
  conditionsForBuckets,
  loadOwnedReportType,
  reportTypeBucket,
  reportTypeTemplate,
  reportTypeTemplateFor,
} from "./model/reportTypes";
import { requireOperator } from "./model/staff";

const reportTypeView = v.object({
  reportTypeId: v.id("reportTypes"),
  name: v.string(),
  description: v.string(),
  buckets: v.array(reportTypeBucket),
  conditions: reportConditionSet,
});

function operationLabel(operationKey: ImplementedOperationKey): string {
  return (
    REPORT_OPERATIONS.find((operation) => operation.key === operationKey)?.label ?? operationKey
  );
}

function operationDescription(operationKey: ImplementedOperationKey): string {
  return REPORT_OPERATIONS.find((operation) => operation.key === operationKey)?.description ?? "";
}

async function assertNameAvailable(
  ctx: MutationCtx,
  userId: Id<"users">,
  name: string,
  exceptId: Id<"reportTypes"> | null
): Promise<void> {
  const rows = await ctx.db
    .query("reportTypes")
    .withIndex("by_userId", (query) => query.eq("userId", userId))
    .collect();
  const taken = rows.some(
    (row) => row._id !== exceptId && row.name.toLowerCase() === name.toLowerCase()
  );
  if (taken) {
    throw new ConvexError({
      code: "INVALID_CONFIG",
      message: `You already have a report type named "${name}".`,
    });
  }
}

// The run panel only needs labels and bucket names, never the rules.
export const listRunnable = query({
  args: {},
  returns: v.object({
    types: v.array(
      v.object({
        source: v.union(v.literal("builtin"), v.literal("custom")),
        key: v.string(),
        label: v.string(),
        description: v.string(),
        buckets: v.array(v.object({ key: v.string(), label: v.string() })),
      })
    ),
  }),
  handler: async (ctx) => {
    const { userId } = await requireOperator(ctx);
    const custom = await ctx.db
      .query("reportTypes")
      .withIndex("by_userId", (query) => query.eq("userId", userId))
      .collect();
    custom.sort((a, b) => a.name.localeCompare(b.name));

    return {
      types: [
        ...IMPLEMENTED_REPORT_OPERATIONS.map((operationKey) => ({
          source: "builtin" as const,
          key: operationKey,
          label: operationLabel(operationKey),
          description: operationDescription(operationKey),
          buckets: bucketCatalogFor(operationKey).map((bucket) => ({
            key: bucket.key,
            label: bucket.label,
          })),
        })),
        ...custom.map((row) => ({
          source: "custom" as const,
          key: row._id,
          label: row.name,
          description: row.description,
          buckets: row.buckets,
        })),
      ],
    };
  },
});

// Full definitions for the configuration panel, which edits rules and buckets.
export const listMine = query({
  args: {},
  returns: v.object({ types: v.array(reportTypeView) }),
  handler: async (ctx) => {
    const { userId } = await requireOperator(ctx);
    const rows = await ctx.db
      .query("reportTypes")
      .withIndex("by_userId", (query) => query.eq("userId", userId))
      .collect();
    rows.sort((a, b) => a.name.localeCompare(b.name));
    return {
      types: rows.map((row) => ({
        reportTypeId: row._id,
        name: row.name,
        description: row.description,
        buckets: row.buckets,
        conditions: row.conditions,
      })),
    };
  },
});

export const createMine = mutation({
  args: { name: v.string(), template: reportTypeTemplate },
  returns: reportTypeView,
  handler: async (ctx, args) => {
    const { userId } = await requireOperator(ctx);
    const name = cleanTypeName(args.name);
    await assertNameAvailable(ctx, userId, name, null);

    const { buckets, conditions } = reportTypeTemplateFor(args.template);
    const now = Date.now();
    const reportTypeId = await ctx.db.insert("reportTypes", {
      userId,
      name,
      description: "",
      buckets,
      conditions,
      createdAt: now,
      updatedAt: now,
    });

    return { reportTypeId, name, description: "", buckets, conditions };
  },
});

export const saveMine = mutation({
  args: {
    reportTypeId: v.id("reportTypes"),
    name: v.string(),
    description: v.string(),
    buckets: v.array(reportTypeBucket),
    conditions: reportConditionSet,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { userId } = await requireOperator(ctx);
    const existing = await loadOwnedReportType(ctx, userId, args.reportTypeId);
    const name = cleanTypeName(args.name);
    await assertNameAvailable(ctx, userId, name, existing._id);

    // Buckets define the row groups, so the rules are rebuilt around them
    // before they are stored.
    const buckets = cleanTypeBuckets(args.buckets);
    const conditions = cleanConditionSet(conditionsForBuckets(buckets, args.conditions));
    await ctx.db.patch("reportTypes", existing._id, {
      name,
      description: cleanTypeDescription(args.description),
      buckets,
      conditions,
      updatedAt: Date.now(),
    });

    return null;
  },
});

export const removeMine = mutation({
  args: { reportTypeId: v.id("reportTypes") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { userId } = await requireOperator(ctx);
    const existing = await loadOwnedReportType(ctx, userId, args.reportTypeId);
    await ctx.db.delete("reportTypes", existing._id);
    return null;
  },
});

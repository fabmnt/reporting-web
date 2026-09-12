import { ConvexError, v } from "convex/values";

import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import {
  assertBucketKeys,
  bucketCatalogFor,
  bucketKeysFor,
  cleanConditionSet,
  IMPLEMENTED_REPORT_OPERATIONS,
  isImplementedOperation,
  reportConditionSet,
  resolveConditionsForClinics,
  type ImplementedOperationKey,
} from "./model/reportConditions";
import { REPORT_OPERATIONS } from "./model/reportOperations";
import { listProfileClinics, type StaffProfileForReporting } from "./model/reporting";
import { requireOperator } from "./model/staff";
import { reportOperationKey } from "./schema";

const conditionScope = v.union(v.id("clinics"), v.null());

const reportBucket = v.object({
  key: v.string(),
  label: v.string(),
  canCatchAll: v.boolean(),
});

// The scope columns are not a uniqueness constraint, and the first version of
// this lookup scanned a capped window, so an existing deployment can hold more
// than one row for the same scope. Loading every row of the scope and deleting
// the extras keeps save and reset working on that data instead of failing on
// `.unique()`. A scope is bounded by the old cap, so collecting stays small.
async function findConditionRow(
  ctx: MutationCtx,
  userId: Id<"users">,
  operationKey: ImplementedOperationKey,
  clinicId: Id<"clinics"> | null
) {
  const rows = await ctx.db
    .query("reportConditions")
    .withIndex("by_userId_and_operationKey_and_clinicId", (query) =>
      query.eq("userId", userId).eq("operationKey", operationKey).eq("clinicId", clinicId)
    )
    .order("desc")
    .collect();
  const [newest, ...duplicates] = rows;
  for (const duplicate of duplicates) {
    await ctx.db.delete(duplicate._id);
  }
  return newest ?? null;
}

// A clinic scope must be one the caller can run reports for. A null scope is
// the caller's own default and needs no clinic.
async function assertClinicAssigned(
  ctx: MutationCtx,
  profile: StaffProfileForReporting,
  clinicId: Id<"clinics"> | null
): Promise<void> {
  if (clinicId === null) return;
  const assigned = await listProfileClinics(ctx, profile);
  if (!assigned.some((clinic) => clinic._id === clinicId)) {
    throw new ConvexError({
      code: "FORBIDDEN",
      message: "This clinic is not assigned to you.",
    });
  }
}

export const listMine = query({
  args: {},
  returns: v.object({
    clinics: v.array(
      v.object({
        clinicId: v.id("clinics"),
        name: v.string(),
        clientName: v.string(),
      })
    ),
    operations: v.array(
      v.object({
        operationKey: reportOperationKey,
        label: v.string(),
        buckets: v.array(reportBucket),
        default: v.object({ conditions: reportConditionSet, isCustom: v.boolean() }),
        overrides: v.array(v.object({ clinicId: v.id("clinics"), conditions: reportConditionSet })),
      })
    ),
  }),
  handler: async (ctx) => {
    const { userId, profile } = await requireOperator(ctx);
    const assigned = await listProfileClinics(ctx, profile);
    const assignedIds = new Set<Id<"clinics">>(assigned.map((clinic) => clinic._id));

    const clientNameById = new Map<string, string>();
    const clinics = [];
    for (const clinic of assigned) {
      let clientName = clientNameById.get(clinic.clientId);
      if (clientName === undefined) {
        const client = await ctx.db.get("clients", clinic.clientId);
        clientName = client?.name ?? "Unknown client";
        clientNameById.set(clinic.clientId, clientName);
      }
      clinics.push({ clinicId: clinic._id, name: clinic.name, clientName });
    }

    const operations = [];
    for (const operationKey of IMPLEMENTED_REPORT_OPERATIONS) {
      const resolved = await resolveConditionsForClinics(ctx, userId, operationKey);
      const overrides = [];
      for (const [clinicId, conditions] of resolved.byClinicId) {
        if (!assignedIds.has(clinicId)) continue;
        overrides.push({ clinicId, conditions });
      }
      operations.push({
        operationKey,
        label:
          REPORT_OPERATIONS.find((operation) => operation.key === operationKey)?.label ??
          operationKey,
        buckets: bucketCatalogFor(operationKey),
        default: {
          conditions: resolved.defaultConditions,
          isCustom: resolved.defaultIsCustom,
        },
        overrides,
      });
    }

    return { clinics, operations };
  },
});

export const saveMine = mutation({
  args: {
    operationKey: reportOperationKey,
    clinicId: conditionScope,
    conditions: reportConditionSet,
  },
  // Returns the stored value so the panel can show exactly what was saved
  // instead of keeping a draft that may differ from it.
  returns: reportConditionSet,
  handler: async (ctx, args) => {
    const { userId, profile } = await requireOperator(ctx);

    if (!isImplementedOperation(args.operationKey)) {
      throw new ConvexError({
        code: "INVALID_OPERATION",
        message: `"${args.operationKey}" does not support conditions yet.`,
      });
    }
    assertBucketKeys(args.conditions, bucketKeysFor(args.operationKey), args.operationKey);
    await assertClinicAssigned(ctx, profile, args.clinicId);

    const conditions = cleanConditionSet(args.conditions);
    const existing = await findConditionRow(ctx, userId, args.operationKey, args.clinicId);
    const updatedAt = Date.now();
    if (existing === null) {
      await ctx.db.insert("reportConditions", {
        userId,
        operationKey: args.operationKey,
        clinicId: args.clinicId,
        conditions,
        updatedAt,
      });
    } else {
      await ctx.db.patch(existing._id, { conditions, updatedAt });
    }

    return conditions;
  },
});

export const resetMine = mutation({
  args: {
    operationKey: reportOperationKey,
    clinicId: conditionScope,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { userId, profile } = await requireOperator(ctx);

    if (!isImplementedOperation(args.operationKey)) {
      throw new ConvexError({
        code: "INVALID_OPERATION",
        message: `"${args.operationKey}" does not support conditions yet.`,
      });
    }
    await assertClinicAssigned(ctx, profile, args.clinicId);

    const existing = await findConditionRow(ctx, userId, args.operationKey, args.clinicId);
    if (existing !== null) {
      await ctx.db.delete(existing._id);
    }

    return null;
  },
});

import { ConvexError, v } from "convex/values";

import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import {
  assertConditionKind,
  cleanConditionSet,
  IMPLEMENTED_REPORT_OPERATIONS,
  isImplementedOperation,
  MAX_CONDITION_ROWS,
  reportConditionSet,
  resolveConditionsForClinics,
  type ImplementedOperationKey,
} from "./model/reportConditions";
import { REPORT_OPERATIONS } from "./model/reportOperations";
import { listProfileClinics } from "./model/reporting";
import { requireOperator } from "./model/staff";
import { reportOperationKey } from "./schema";

const conditionScope = v.union(v.id("clinics"), v.null());

async function findConditionRow(
  ctx: MutationCtx,
  userId: Id<"users">,
  operationKey: ImplementedOperationKey,
  clinicId: Id<"clinics"> | null
) {
  const rows = await ctx.db
    .query("reportConditions")
    .withIndex("by_userId_and_operationKey", (query) =>
      query.eq("userId", userId).eq("operationKey", operationKey)
    )
    .take(MAX_CONDITION_ROWS);
  return rows.find((row) => row.clinicId === clinicId) ?? null;
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
  returns: v.null(),
  handler: async (ctx, args) => {
    const { userId, profile } = await requireOperator(ctx);

    if (!isImplementedOperation(args.operationKey)) {
      throw new ConvexError({
        code: "INVALID_OPERATION",
        message: `"${args.operationKey}" does not support conditions yet.`,
      });
    }
    assertConditionKind(args.conditions, args.operationKey);

    if (args.clinicId !== null) {
      const assigned = await listProfileClinics(ctx, profile);
      if (!assigned.some((clinic) => clinic._id === args.clinicId)) {
        throw new ConvexError({
          code: "FORBIDDEN",
          message: "This clinic is not assigned to you.",
        });
      }
    }

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

    return null;
  },
});

export const resetMine = mutation({
  args: {
    operationKey: reportOperationKey,
    clinicId: conditionScope,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { userId } = await requireOperator(ctx);

    if (!isImplementedOperation(args.operationKey)) {
      throw new ConvexError({
        code: "INVALID_OPERATION",
        message: `"${args.operationKey}" does not support conditions yet.`,
      });
    }

    const existing = await findConditionRow(ctx, userId, args.operationKey, args.clinicId);
    if (existing !== null) {
      await ctx.db.delete(existing._id);
    }

    return null;
  },
});

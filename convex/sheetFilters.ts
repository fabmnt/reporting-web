import { v } from "convex/values";

import { internal } from "./_generated/api.js";
import type { Id } from "./_generated/dataModel";
import { action, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { applyFilterToClinic, type SheetFilterClinicResult } from "./model/applySheetFilter";
import { appError, reportSheetError, sheetErrorFrom } from "./model/appErrors";
import { MAX_ASSIGNED_CLINICS } from "./model/assignments";
import { sheetsSessions } from "./googleSheetsAccess";
import { conditionExpression, type ConditionExpression } from "./model/reportConditions";
import { assertReportDateRange, listProfileClinics } from "./model/reporting";
import {
  assertSheetFilterNameAvailable,
  assertSheetFilterRoom,
  cleanSheetFilterDraft,
  MAX_SHEET_FILTERS,
  type SheetFilterDraft,
} from "./model/sheetFilters";
import { requireAdmin, requireOperator } from "./model/staff";

const sheetFilterView = v.object({
  sheetFilterId: v.id("sheetFilters"),
  name: v.string(),
  description: v.string(),
  expression: conditionExpression,
});

const sheetFilterTabError = v.union(
  reportSheetError,
  v.object({ code: v.literal("SHEET_FILTER_TOO_LONG"), rowCount: v.number() }),
  v.object({ code: v.literal("SHEET_FILTER_TOO_MANY_ROWS"), rowCount: v.number() })
);

// Longer than one apply, so a run that is still writing is not treated as
// finished. A run that dies keeps the row until this time, then the next apply
// can take it.
const APPLY_LOCK_MS = 3 * 60 * 1000;

const clinicResult = v.object({
  clinicId: v.id("clinics"),
  clinicName: v.string(),
  error: v.union(reportSheetError, v.null()),
  tabs: v.array(
    v.object({
      tabTitle: v.string(),
      matchedRowCount: v.number(),
      error: v.union(sheetFilterTabError, v.null()),
    })
  ),
});

const draftArgs = {
  name: v.string(),
  description: v.string(),
  expression: conditionExpression,
};

const sheetColumnsValidator = v.object({
  updateStatus: v.string(),
  uploadStatus: v.string(),
  verificationType: v.string(),
  fileUrl: v.string(),
});

function viewOf(row: {
  _id: Id<"sheetFilters">;
  name: string;
  description: string;
  expression: ConditionExpression;
}) {
  return {
    sheetFilterId: row._id,
    name: row.name,
    description: row.description,
    expression: row.expression,
  };
}

// Operators apply these filters. Administrators are operators too, so the same
// list is what the admin screen edits.
export const list = query({
  args: {},
  returns: v.object({ filters: v.array(sheetFilterView) }),
  handler: async (ctx) => {
    await requireOperator(ctx);
    const rows = await ctx.db.query("sheetFilters").withIndex("by_name").take(MAX_SHEET_FILTERS);
    return { filters: rows.map(viewOf) };
  },
});

export const create = mutation({
  args: draftArgs,
  returns: sheetFilterView,
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const draft = cleanSheetFilterDraft(args);
    await assertSheetFilterRoom(ctx);
    await assertSheetFilterNameAvailable(ctx, draft.name, null);

    const now = Date.now();
    const sheetFilterId = await ctx.db.insert("sheetFilters", {
      ...draft,
      createdAt: now,
      updatedAt: now,
    });
    return viewOf({ _id: sheetFilterId, ...draft });
  },
});

export const save = mutation({
  args: { sheetFilterId: v.id("sheetFilters"), ...draftArgs },
  returns: sheetFilterView,
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const row = await ctx.db.get("sheetFilters", args.sheetFilterId);
    if (row === null) throw appError({ code: "SHEET_FILTER_NOT_FOUND" });

    const draft: SheetFilterDraft = cleanSheetFilterDraft(args);
    await assertSheetFilterNameAvailable(ctx, draft.name, row._id);
    const updatedAt = Date.now();
    await ctx.db.patch(row._id, { ...draft, updatedAt });
    return viewOf({ _id: row._id, ...draft });
  },
});

export const remove = mutation({
  args: { sheetFilterId: v.id("sheetFilters") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const row = await ctx.db.get("sheetFilters", args.sheetFilterId);
    if (row === null) throw appError({ code: "SHEET_FILTER_NOT_FOUND" });
    await ctx.db.delete("sheetFilters", row._id);
    return null;
  },
});

// The clinics and the filter an apply is allowed to write. Clinic ids the
// caller is not assigned are refused, so the action never widens that scope.
export const loadApplyConfig = internalQuery({
  args: {
    sheetFilterId: v.id("sheetFilters"),
    clinicIds: v.array(v.id("clinics")),
    startDate: v.string(),
    endDate: v.string(),
  },
  returns: v.object({
    name: v.string(),
    expression: conditionExpression,
    clinics: v.array(
      v.object({
        clinicId: v.id("clinics"),
        clientId: v.id("clients"),
        clinicName: v.string(),
        googleSheetId: v.string(),
        sheetColumns: sheetColumnsValidator,
      })
    ),
  }),
  handler: async (ctx, args) => {
    assertReportDateRange(args.startDate, args.endDate);
    const { profile } = await requireOperator(ctx);
    const filter = await ctx.db.get("sheetFilters", args.sheetFilterId);
    if (filter === null) throw appError({ code: "SHEET_FILTER_NOT_FOUND" });

    const clinicIds = [...new Set(args.clinicIds)];
    if (clinicIds.length === 0) throw appError({ code: "SHEET_FILTER_CLINICS_REQUIRED" });
    if (clinicIds.length > MAX_ASSIGNED_CLINICS) {
      throw appError({ code: "CLINIC_ASSIGNMENT_LIMIT", limit: MAX_ASSIGNED_CLINICS });
    }

    const assigned = await listProfileClinics(ctx, profile);
    const byId = new Map(assigned.map((clinic) => [clinic._id, clinic]));
    const clinics = [];
    for (const clinicId of clinicIds) {
      const clinic = byId.get(clinicId);
      if (clinic === undefined) throw appError({ code: "CLINIC_NOT_ASSIGNED" });
      clinics.push({
        clinicId: clinic._id,
        clientId: clinic.clientId,
        clinicName: clinic.name,
        googleSheetId: clinic.googleSheetId,
        sheetColumns: clinic.sheetColumns,
      });
    }

    return { name: filter.name, expression: filter.expression, clinics };
  },
});

// Holds the spreadsheet and filter name until the write finishes. A second
// apply of the same name sees this row and stops, instead of adding another
// view with that name.
export const acquireApplyLock = internalMutation({
  args: { googleSheetId: v.string(), filterName: v.string() },
  returns: v.object({ lockId: v.id("sheetFilterApplies"), token: v.string() }),
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("sheetFilterApplies")
      .withIndex("by_sheet_and_filter", (q) =>
        q.eq("googleSheetId", args.googleSheetId).eq("filterName", args.filterName)
      )
      .unique();
    const token = crypto.randomUUID();
    const expiresAt = now + APPLY_LOCK_MS;
    if (existing !== null && existing.expiresAt > now) {
      throw appError({ code: "SHEET_FILTER_IN_PROGRESS" });
    }
    if (existing !== null) {
      await ctx.db.patch(existing._id, { token, expiresAt });
      return { lockId: existing._id, token };
    }
    const lockId = await ctx.db.insert("sheetFilterApplies", {
      googleSheetId: args.googleSheetId,
      filterName: args.filterName,
      token,
      expiresAt,
    });
    return { lockId, token };
  },
});

export const releaseApplyLock = internalMutation({
  args: { lockId: v.id("sheetFilterApplies"), token: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get("sheetFilterApplies", args.lockId);
    if (row !== null && row.token === args.token)
      await ctx.db.delete("sheetFilterApplies", row._id);
    return null;
  },
});

export const apply = action({
  args: {
    sheetFilterId: v.id("sheetFilters"),
    clinicIds: v.array(v.id("clinics")),
    startDate: v.string(),
    endDate: v.string(),
  },
  returns: v.object({ clinics: v.array(clinicResult) }),
  handler: async (ctx, args): Promise<{ clinics: SheetFilterClinicResult[] }> => {
    const config = await ctx.runQuery(internal.sheetFilters.loadApplyConfig, args);
    const sessions = sheetsSessions(ctx);
    const clinics: SheetFilterClinicResult[] = [];

    for (const clinic of config.clinics) {
      let lock: { lockId: Id<"sheetFilterApplies">; token: string } | null = null;
      try {
        lock = await ctx.runMutation(internal.sheetFilters.acquireApplyLock, {
          googleSheetId: clinic.googleSheetId,
          filterName: config.name,
        });
        const session = await sessions.forClient(clinic.clientId);
        clinics.push(
          await applyFilterToClinic(session, {
            ...clinic,
            filterName: config.name,
            expression: config.expression,
            startDate: args.startDate,
            endDate: args.endDate,
          })
        );
      } catch (error) {
        clinics.push({
          clinicId: clinic.clinicId,
          clinicName: clinic.clinicName,
          error: sheetErrorFrom(error),
          tabs: [],
        });
      } finally {
        if (lock !== null) {
          try {
            await ctx.runMutation(internal.sheetFilters.releaseApplyLock, lock);
          } catch (error) {
            console.error("Could not release the sheet filter apply lock.", error);
          }
        }
      }
    }

    return { clinics };
  },
});

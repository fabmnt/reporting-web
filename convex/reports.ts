import { v } from "convex/values";
import type { Infer } from "convex/values";

import type { Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { action, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api.js";
import type { ResolvedClinicSheetColumns } from "./model/clinicSheetColumns";
import {
  bucketCatalogFor,
  evaluateConditionSet,
  EXECUTION_COLUMN_INDEX,
  isImplementedOperation,
  MESSAGE_COLUMN_INDEX,
  reportConditionSet,
  resolveConditionsForClinics,
  type ConditionClause,
  type ConditionColumnIndexes,
  type ReportConditionSet,
} from "./model/reportConditions";
import { columnLetterToIndex, listProfileClinics } from "./model/reporting";
import { loadOwnedReportType, type ReportTypeBucket } from "./model/reportTypes";
import { reportOperationKey } from "./schema";

type SheetRow = string[];
type ReportRow = { rowNumber: number; values: string[] };

const reportRow = v.object({ rowNumber: v.number(), values: v.array(v.string()) });

// A run either uses a built-in report or one of the caller's own report types.
// The two cases resolve their rules differently, so they stay separate in the
// arguments instead of sharing an ambiguous id.
const reportRunTarget = v.union(
  v.object({
    source: v.literal("builtin"),
    operationKey: v.union(v.literal("pending-audit"), v.literal("ready-to-upload")),
  }),
  v.object({ source: v.literal("custom"), reportTypeId: v.id("reportTypes") })
);
type ReportRunTarget = Infer<typeof reportRunTarget>;

const reportSheetResult = v.object({
  clinicId: v.id("clinics"),
  clinicName: v.string(),
  googleSheetId: v.string(),
  tabTitle: v.string(),
  headers: v.array(v.string()),
  // One entry per bucket of the report type, in bucket order.
  bucketRows: v.array(
    v.object({ bucketKey: v.string(), label: v.string(), rows: v.array(reportRow) })
  ),
  error: v.union(v.string(), v.null()),
});

type SheetResultEntry = {
  clinicId: Id<"clinics">;
  clinicName: string;
  googleSheetId: string;
  tabTitle: string;
  headers: string[];
  bucketRows: Array<{ bucketKey: string; label: string; rows: ReportRow[] }>;
  error: string | null;
};

type ClinicRunConfig = {
  clinicId: Id<"clinics">;
  clientId: Id<"clients">;
  name: string;
  googleSheetId: string;
  sheetColumns: ResolvedClinicSheetColumns;
  conditions: ReportConditionSet;
};

// The engine only knows about column roles, so each clinic resolves its own
// mapping once per run.
function conditionColumnIndexes(columns: ResolvedClinicSheetColumns): ConditionColumnIndexes {
  return {
    L: EXECUTION_COLUMN_INDEX,
    M: MESSAGE_COLUMN_INDEX,
    updateStatus: columnLetterToIndex(columns.updateStatus),
    uploadStatus: columnLetterToIndex(columns.uploadStatus),
    verificationType: columnLetterToIndex(columns.verificationType),
    fileUrl: columnLetterToIndex(columns.fileUrl),
  };
}

type ReportRunConfig = {
  clinics: ClinicRunConfig[];
  // Row groups of the run target, in evaluation order.
  buckets: ReportTypeBucket[];
  // Only custom targets have a name to snapshot on the run.
  reportTypeName: string | null;
};

async function reportRunConfigForUser(
  ctx: QueryCtx,
  userId: Id<"users">,
  target: ReportRunTarget
): Promise<ReportRunConfig> {
  const profile = await ctx.db
    .query("staffProfiles")
    .withIndex("by_userId", (query) => query.eq("userId", userId))
    .unique();
  if (profile === null || profile.status !== "active") {
    throw new Error("An active staff account is required.");
  }
  if (profile.role !== "admin" && profile.role !== "operator") {
    throw new Error("Operator access is required.");
  }

  const clinics = await listProfileClinics(ctx, profile);
  const base = clinics.map((clinic) => ({
    clinicId: clinic._id,
    clientId: clinic.clientId,
    name: clinic.name,
    googleSheetId: clinic.googleSheetId,
    sheetColumns: clinic.sheetColumns,
  }));

  // A custom type has one rule set for every clinic, with no overrides.
  if (target.source === "custom") {
    const reportType = await loadOwnedReportType(ctx, userId, target.reportTypeId);
    return {
      clinics: base.map((clinic) => ({ ...clinic, conditions: reportType.conditions })),
      buckets: reportType.buckets,
      reportTypeName: reportType.name,
    };
  }

  const resolved = await resolveConditionsForClinics(ctx, userId, target.operationKey);
  return {
    clinics: base.map((clinic) => ({
      ...clinic,
      conditions: resolved.byClinicId.get(clinic.clinicId) ?? resolved.defaultConditions,
    })),
    buckets: bucketCatalogFor(target.operationKey).map((bucket) => ({
      key: bucket.key,
      label: bucket.label,
    })),
    reportTypeName: null,
  };
}

export const recordReportRun = internalMutation({
  args: {
    operationKey: v.optional(reportOperationKey),
    reportTypeId: v.optional(v.id("reportTypes")),
    reportTypeName: v.optional(v.string()),
    clientId: v.optional(v.id("clients")),
    status: v.union(v.literal("completed"), v.literal("failed"), v.literal("cancelled")),
    initiatedByUserId: v.id("users"),
    startedAt: v.number(),
    completedAt: v.number(),
    processedClinicCount: v.number(),
    succeededClinicCount: v.number(),
    failedClinicCount: v.number(),
    errorMessage: v.optional(v.string()),
  },
  returns: v.object({ reportRunId: v.id("reportRuns") }),
  handler: async (ctx, args) => {
    const reportRunId = await ctx.db.insert("reportRuns", {
      initiatedByUserId: args.initiatedByUserId,
      operationKey: args.operationKey,
      reportTypeId: args.reportTypeId,
      reportTypeName: args.reportTypeName,
      clientId: args.clientId,
      status: args.status,
      startedAt: args.startedAt,
      completedAt: args.completedAt,
      processedClinicCount: args.processedClinicCount,
      succeededClinicCount: args.succeededClinicCount,
      failedClinicCount: args.failedClinicCount,
      errorMessage: args.errorMessage,
    });
    return { reportRunId };
  },
});

// v1: the two built-in row reports and the caller's own report types. The
// execute operation needs carrier API data and comes later.
export const runSheetReport = action({
  args: {
    target: reportRunTarget,
    startDate: v.string(),
    endDate: v.string(),
    verificationFilter: v.optional(v.union(v.literal("all"), v.literal("fbd"), v.literal("elg"))),
  },
  returns: v.object({
    reportRunId: v.union(v.id("reportRuns"), v.null()),
    assignedClinicCount: v.number(),
    sheets: v.array(reportSheetResult),
  }),
  handler: async (
    ctx,
    args
  ): Promise<{
    reportRunId: Id<"reportRuns"> | null;
    assignedClinicCount: number;
    sheets: SheetResultEntry[];
  }> => {
    const { userId }: { userId: Id<"users"> } = await ctx.runQuery(
      internal.staffAuth.currentOperator,
      {}
    );
    const startedAt = Date.now();
    const verificationFilter = args.verificationFilter ?? "all";

    // The verification choice is a run-level narrowing, not part of the stored
    // rules: it becomes one more clause every bucket has to satisfy. Only the
    // pending audit report offers it, like the legacy tool.
    const isPendingAudit =
      args.target.source === "builtin" && args.target.operationKey === "pending-audit";
    const extraFilters: ConditionClause[] =
      isPendingAudit && verificationFilter !== "all"
        ? [
            {
              column: "verificationType",
              operator: "contains",
              values: [verificationFilter.toUpperCase()],
            },
          ]
        : [];

    const config: ReportRunConfig = await ctx.runQuery(internal.reports.runSheetReportConfig, {
      userId,
      target: args.target,
      startDate: args.startDate,
      endDate: args.endDate,
    });
    const bucketLabels = new Map(config.buckets.map((bucket) => [bucket.key, bucket.label]));

    const { tabsForClinic }: { tabsForClinic: Record<string, string[]> } = await ctx.runAction(
      internal.sheets.planSheetTabs,
      {
        clinics: config.clinics.map((c) => ({
          clinicId: c.clinicId,
          googleSheetId: c.googleSheetId,
        })),
        startDate: args.startDate,
        endDate: args.endDate,
      }
    );

    const sheets: SheetResultEntry[] = [];

    let succeededClinics = 0;
    let failedClinics = 0;
    for (const clinic of config.clinics) {
      const tabs = tabsForClinic[clinic.clinicId] ?? [];
      if (tabs.length === 0) {
        failedClinics += 1;
        sheets.push({
          clinicId: clinic.clinicId,
          clinicName: clinic.name,
          googleSheetId: clinic.googleSheetId,
          tabTitle: "",
          headers: [],
          bucketRows: [],
          error: `No tabs found between ${args.startDate} and ${args.endDate}.`,
        });
        continue;
      }
      const indexes = conditionColumnIndexes(clinic.sheetColumns);
      let clinicFailed = false;
      // One batched read per clinic instead of one call per tab.
      let tabResults: Array<{
        tabTitle: string;
        headers: string[];
        values: string[][];
        error: string | null;
      }> = [];
      try {
        tabResults = await ctx.runAction(internal.sheets.readSheetTabsValues, {
          googleSheetId: clinic.googleSheetId,
          tabTitles: tabs,
        });
      } catch (error) {
        // The whole read failed (token, permissions, unknown spreadsheet).
        // Report it on every planned tab and keep going with the next clinic.
        clinicFailed = true;
        const message = error instanceof Error ? error.message : String(error);
        for (const tabTitle of tabs) {
          sheets.push({
            clinicId: clinic.clinicId,
            clinicName: clinic.name,
            googleSheetId: clinic.googleSheetId,
            tabTitle,
            headers: [],
            bucketRows: [],
            error: message,
          });
        }
      }
      for (const tabResult of tabResults) {
        if (tabResult.error !== null) {
          clinicFailed = true;
          sheets.push({
            clinicId: clinic.clinicId,
            clinicName: clinic.name,
            googleSheetId: clinic.googleSheetId,
            tabTitle: tabResult.tabTitle,
            headers: [],
            bucketRows: [],
            error: tabResult.error,
          });
          continue;
        }
        const { tabTitle, headers, values } = tabResult;
        const bucketRows = clinic.conditions.buckets.map((bucket) => ({
          bucketKey: bucket.bucketKey,
          label: bucketLabels.get(bucket.bucketKey) ?? bucket.bucketKey,
          rows: [] as ReportRow[],
        }));
        const rowsByBucket = new Map(bucketRows.map((bucket) => [bucket.bucketKey, bucket.rows]));
        values.forEach((row: SheetRow, index) => {
          const bucketKey = evaluateConditionSet(row, indexes, clinic.conditions, extraFilters);
          if (bucketKey === null) return;
          rowsByBucket.get(bucketKey)?.push({ rowNumber: index + 2, values: row });
        });
        sheets.push({
          clinicId: clinic.clinicId,
          clinicName: clinic.name,
          googleSheetId: clinic.googleSheetId,
          tabTitle,
          headers,
          bucketRows,
          error: null,
        });
      }
      if (clinicFailed) {
        failedClinics += 1;
      } else {
        succeededClinics += 1;
      }
    }

    const clientIds = new Set(config.clinics.map((clinic) => clinic.clientId));
    const reportClientId = clientIds.size === 1 ? config.clinics[0]?.clientId : undefined;

    const { reportRunId }: { reportRunId: Id<"reportRuns"> } = await ctx.runMutation(
      internal.reports.recordReportRun,
      {
        operationKey: args.target.source === "builtin" ? args.target.operationKey : undefined,
        reportTypeId: args.target.source === "custom" ? args.target.reportTypeId : undefined,
        reportTypeName: config.reportTypeName ?? undefined,
        clientId: reportClientId,
        status: succeededClinics === 0 ? "failed" : "completed",
        initiatedByUserId: userId,
        startedAt,
        completedAt: Date.now(),
        processedClinicCount: config.clinics.length,
        succeededClinicCount: succeededClinics,
        failedClinicCount: failedClinics,
      }
    );

    return {
      reportRunId,
      assignedClinicCount: config.clinics.length,
      sheets,
    };
  },
});

// Thin wrapper so runSheetReport keeps one internal config entrypoint.
export const runSheetReportConfig = internalQuery({
  args: {
    userId: v.id("users"),
    target: reportRunTarget,
    startDate: v.string(),
    endDate: v.string(),
  },
  returns: v.object({
    clinics: v.array(
      v.object({
        clinicId: v.id("clinics"),
        clientId: v.id("clients"),
        name: v.string(),
        googleSheetId: v.string(),
        sheetColumns: v.object({
          updateStatus: v.string(),
          uploadStatus: v.string(),
          verificationType: v.string(),
          fileUrl: v.string(),
        }),
        conditions: reportConditionSet,
      })
    ),
    buckets: v.array(v.object({ key: v.string(), label: v.string() })),
    reportTypeName: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, args) => {
    if (args.startDate > args.endDate) {
      throw new Error("The start date must be on or before the end date.");
    }
    if (args.target.source === "builtin" && !isImplementedOperation(args.target.operationKey)) {
      throw new Error(`No conditions are defined for "${args.target.operationKey}" yet.`);
    }
    return reportRunConfigForUser(ctx, args.userId, args.target);
  },
});

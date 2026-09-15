import { v } from "convex/values";

import type { Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { action, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api.js";
import {
  appError,
  appErrorPayloadOf,
  reportSheetError,
  type ReportSheetError,
} from "./model/appErrors";
import type { ResolvedClinicSheetColumns } from "./model/clinicSheetColumns";
import {
  evaluateConditionSet,
  EXECUTION_COLUMN_INDEX,
  filterColumnsForBucket,
  MESSAGE_COLUMN_INDEX,
  reportConditionSet,
  type ConditionClause,
  type ConditionColumnIndexes,
  type ReportConditionSet,
} from "./model/reportConditions";
import { columnLetterToIndex, listProfileClinics } from "./model/reporting";
import { loadRunnableReportType, type ReportTypeBucket } from "./model/reportTypes";

type SheetRow = string[];
type ReportRow = { rowNumber: number; values: string[] };

const reportRow = v.object({ rowNumber: v.number(), values: v.array(v.string()) });

// One entry per bucket of a report type, in bucket order. `filterColumns` are
// the 0-based sheet columns its conditions read, so the results view can show
// the cells behind the filter next to each row.
const reportBucketResult = v.object({
  bucketKey: v.string(),
  label: v.string(),
  rows: v.array(reportRow),
  filterColumns: v.array(v.number()),
});

const reportSheetResult = v.object({
  clinicId: v.id("clinics"),
  clinicName: v.string(),
  googleSheetId: v.string(),
  tabTitle: v.string(),
  headers: v.array(v.string()),
  // One entry per bucket of the report type, in bucket order.
  bucketRows: v.array(reportBucketResult),
  error: v.union(reportSheetError, v.null()),
});

type BucketResultEntry = {
  bucketKey: string;
  label: string;
  rows: ReportRow[];
  filterColumns: number[];
};

type SheetResultEntry = {
  clinicId: Id<"clinics">;
  clinicName: string;
  googleSheetId: string;
  tabTitle: string;
  headers: string[];
  bucketRows: BucketResultEntry[];
  error: ReportSheetError | null;
};

// A failure on one clinic's sheet. A bad column mapping is a configuration
// error the user can fix from the app, so it keeps its code; everything else
// (Google refusing the read, a missing tab) travels as text.
function sheetErrorFrom(error: unknown): ReportSheetError {
  const payload = appErrorPayloadOf(error);
  if (payload !== null && payload.code === "INVALID_SHEET_COLUMN") {
    return { code: "SHEET_INVALID_COLUMN", column: payload.column };
  }
  return {
    code: "SHEET_FAILED",
    message: error instanceof Error ? error.message : String(error),
  };
}

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
  // Snapshot for the run history, so a rename or a delete keeps it readable.
  reportTypeName: string;
  // Whether the run form offers the verification-type picker for this type.
  usesVerificationFilter: boolean;
};

async function reportRunConfigForUser(
  ctx: QueryCtx,
  userId: Id<"users">,
  reportTypeId: Id<"reportTypes">
): Promise<ReportRunConfig> {
  const profile = await ctx.db
    .query("staffProfiles")
    .withIndex("by_userId", (query) => query.eq("userId", userId))
    .unique();
  if (profile === null || profile.status !== "active") {
    throw appError({ code: "ACTIVE_STAFF_REQUIRED" });
  }
  if (profile.role !== "admin" && profile.role !== "operator") {
    throw appError({ code: "OPERATOR_REQUIRED" });
  }

  const reportType = await loadRunnableReportType(ctx, userId, reportTypeId);
  const clinics = await listProfileClinics(ctx, profile);

  return {
    // A report type has one rule set for every clinic it runs on.
    clinics: clinics.map((clinic) => ({
      clinicId: clinic._id,
      clientId: clinic.clientId,
      name: clinic.name,
      googleSheetId: clinic.googleSheetId,
      sheetColumns: clinic.sheetColumns,
      conditions: reportType.conditions,
    })),
    buckets: reportType.buckets,
    reportTypeName: reportType.name,
    usesVerificationFilter: reportType.usesVerificationFilter,
  };
}

export const recordReportRun = internalMutation({
  args: {
    reportTypeId: v.id("reportTypes"),
    reportTypeName: v.string(),
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

// v1: the row reports. The execute operation needs carrier API data and comes
// later.
export const runSheetReport = action({
  args: {
    reportTypeId: v.id("reportTypes"),
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

    const config: ReportRunConfig = await ctx.runQuery(internal.reports.runSheetReportConfig, {
      userId,
      reportTypeId: args.reportTypeId,
      startDate: args.startDate,
      endDate: args.endDate,
    });

    // The verification choice is a run-level narrowing, not part of the stored
    // rules: it becomes one more clause every bucket has to satisfy. Only the
    // report types that ask for it offer the picker.
    const extraFilters: ConditionClause[] =
      config.usesVerificationFilter && verificationFilter !== "all"
        ? [
            {
              column: "verificationType",
              operator: "contains",
              values: [verificationFilter.toUpperCase()],
            },
          ]
        : [];

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
          error: { code: "SHEET_NO_TABS", startDate: args.startDate, endDate: args.endDate },
        });
        continue;
      }
      let indexes: ConditionColumnIndexes;
      try {
        indexes = conditionColumnIndexes(clinic.sheetColumns);
      } catch (error) {
        // A clinic with an unusable sheet-column mapping fails on its own
        // instead of stopping the run before the remaining clinics.
        failedClinics += 1;
        sheets.push({
          clinicId: clinic.clinicId,
          clinicName: clinic.name,
          googleSheetId: clinic.googleSheetId,
          tabTitle: "",
          headers: [],
          bucketRows: [],
          error: sheetErrorFrom(error),
        });
        continue;
      }
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
        const sheetError = sheetErrorFrom(error);
        for (const tabTitle of tabs) {
          sheets.push({
            clinicId: clinic.clinicId,
            clinicName: clinic.name,
            googleSheetId: clinic.googleSheetId,
            tabTitle,
            headers: [],
            bucketRows: [],
            error: sheetError,
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
            error: { code: "SHEET_FAILED", message: tabResult.error },
          });
          continue;
        }
        const { tabTitle, headers, values } = tabResult;
        const bucketRows = clinic.conditions.buckets.map((bucket) => ({
          bucketKey: bucket.bucketKey,
          label: bucketLabels.get(bucket.bucketKey) ?? bucket.bucketKey,
          rows: [] as ReportRow[],
          filterColumns: filterColumnsForBucket(
            clinic.conditions.buckets,
            bucket,
            extraFilters,
            indexes
          ),
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
        reportTypeId: args.reportTypeId,
        reportTypeName: config.reportTypeName,
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
    reportTypeId: v.id("reportTypes"),
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
    reportTypeName: v.string(),
    usesVerificationFilter: v.boolean(),
  }),
  handler: async (ctx, args) => {
    if (args.startDate > args.endDate) {
      throw appError({ code: "INVALID_DATE_RANGE" });
    }
    return reportRunConfigForUser(ctx, args.userId, args.reportTypeId);
  },
});

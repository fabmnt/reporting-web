import { v } from "convex/values";

import type { Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { action, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api.js";
import { runExecuteReport } from "./executeReport";
import { appError, sheetErrorFrom, type ReportSheetError } from "./model/appErrors";
import type { ResolvedClinicSheetColumns } from "./model/clinicSheetColumns";
import {
  reportRunResult,
  type ReportRow,
  type ReportRunResult,
  type ReportSheetResult,
} from "./model/reportResults";
import {
  conditionColumnIndexes,
  evaluateConditionSet,
  filterColumnsForBucket,
  reportConditionSet,
  type ConditionClause,
  type ConditionColumnIndexes,
  type ReportConditionSet,
} from "./model/reportConditions";
import { listProfileClinics } from "./model/reporting";
import {
  engineOf,
  loadRunnableReportType,
  reportEngine,
  type ReportEngine,
  type ReportTypeBucket,
} from "./model/reportTypes";

type SheetRow = string[];

type ClinicRunConfig = {
  clinicId: Id<"clinics">;
  clientId: Id<"clients">;
  name: string;
  googleSheetId: string;
  externalClinicId: string | null;
  sheetColumns: ResolvedClinicSheetColumns;
  conditions: ReportConditionSet;
};

// The engine only knows about column roles, so each clinic resolves its own
// mapping once per run.
type ReportRunConfig = {
  clinics: ClinicRunConfig[];
  // Row groups of the run target, in evaluation order.
  buckets: ReportTypeBucket[];
  // Snapshot for the run history, so a rename or a delete keeps it readable.
  reportTypeName: string;
  // Whether the run form offers the verification-type picker for this type.
  usesVerificationFilter: boolean;
  // Which engine reads the rows, so the run knows which one to call.
  engine: ReportEngine;
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
      externalClinicId: clinic.externalClinicId,
      sheetColumns: clinic.sheetColumns,
      conditions: reportType.conditions,
    })),
    buckets: reportType.buckets,
    reportTypeName: reportType.name,
    usesVerificationFilter: reportType.usesVerificationFilter,
    engine: engineOf(reportType),
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

// Both engines answer with the same result shape, so the run form does not
// have to know which one reads the rows of the type the user picked.
export const runSheetReport = action({
  args: {
    reportTypeId: v.id("reportTypes"),
    startDate: v.string(),
    endDate: v.string(),
    verificationFilter: v.optional(v.union(v.literal("all"), v.literal("fbd"), v.literal("elg"))),
  },
  returns: reportRunResult,
  handler: async (ctx, args): Promise<ReportRunResult> => {
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

    // The carrier engine asks the Control Central API which bots each clinic
    // has, and reads the same stored conditions every other report reads, so
    // it runs on its own path.
    if (config.engine === "execute") {
      return await runExecuteReport(ctx, {
        clinics: config.clinics,
        buckets: config.buckets,
        startDate: args.startDate,
        endDate: args.endDate,
        verificationFilter,
        userId,
        reportTypeId: args.reportTypeId,
        reportTypeName: config.reportTypeName,
        startedAt,
      });
    }

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

    const {
      tabsForClinic,
      errorsForClinic,
    }: {
      tabsForClinic: Record<string, string[]>;
      errorsForClinic: Record<string, ReportSheetError>;
    } = await ctx.runAction(internal.sheets.planSheetTabs, {
      clinics: config.clinics.map((c) => ({
        clinicId: c.clinicId,
        googleSheetId: c.googleSheetId,
      })),
      startDate: args.startDate,
      endDate: args.endDate,
    });

    const sheets: ReportSheetResult[] = [];

    let succeededClinics = 0;
    let failedClinics = 0;
    for (const clinic of config.clinics) {
      const planningError = errorsForClinic[clinic.clinicId];
      if (planningError !== undefined) {
        failedClinics += 1;
        sheets.push({
          clinicId: clinic.clinicId,
          clinicName: clinic.name,
          googleSheetId: clinic.googleSheetId,
          tabTitle: "",
          headers: [],
          bucketRows: [],
          error: planningError,
        });
        continue;
      }
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
        error: ReportSheetError | null;
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
            error: tabResult.error,
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
        externalClinicId: v.union(v.string(), v.null()),
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
    engine: reportEngine,
  }),
  handler: async (ctx, args) => {
    if (args.startDate > args.endDate) {
      throw appError({ code: "INVALID_DATE_RANGE" });
    }
    return reportRunConfigForUser(ctx, args.userId, args.reportTypeId);
  },
});

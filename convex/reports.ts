import { v } from "convex/values";
import type { Infer } from "convex/values";

import type { Id } from "./_generated/dataModel";
import type { ActionCtx, QueryCtx } from "./_generated/server";
import { action, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api.js";
import { runExecuteReport } from "./executeReport";
import { appError, sheetErrorFrom, type ReportSheetError } from "./model/appErrors";
import type { ResolvedClinicSheetColumns } from "./model/clinicSheetColumns";
import type { ExecuteVerificationFilter } from "./model/executeRules";
import {
  reportRunResult,
  type ReportRow,
  type ReportRunResult,
  type ReportSheetResult,
} from "./model/reportResults";
import {
  conditionColumnResolver,
  evaluateConditionSet,
  filterColumnsForBucket,
  reportConditionSet,
  type ConditionClause,
  type ConditionColumnResolver,
  type ReportConditionSet,
} from "./model/reportConditions";
import { listProfileClinics } from "./model/reporting";
import { reportRunCancelled } from "./model/reportRuns";
import {
  engineOf,
  loadRunnableReportType,
  reportEngine,
  type ReportEngine,
  type ReportTypeBucket,
} from "./model/reportTypes";
import { reportRunParams } from "./reportRuns";

type SheetRow = string[];

// The settings of a run, read back from the record the run form opened.
type RunParams = Infer<typeof reportRunParams>;

type ClinicRunConfig = {
  clinicId: Id<"clinics">;
  clientId: Id<"clients">;
  name: string;
  googleSheetId: string;
  externalClinicId: string;
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

// Runs a report the run form opened. The record exists before this action is
// called, which is what lets the operator stop it while it works, and the
// action reads the form's settings back from that row instead of taking a
// second copy of them.
//
// Both engines answer with the same result shape, so the run form does not
// have to know which one reads the rows of the type the user picked.
export const runSheetReport = action({
  args: {
    runId: v.id("reportRuns"),
    verificationFilter: v.optional(v.union(v.literal("all"), v.literal("fbd"), v.literal("elg"))),
  },
  returns: reportRunResult,
  handler: async (ctx, args): Promise<ReportRunResult> => {
    // Claiming the record is what makes a run one-shot: a second call for the
    // same id is turned away instead of reading every sheet again, and a run
    // the operator stopped before this call is answered as cancelled rather
    // than started.
    const claim = await ctx.runMutation(internal.reportRuns.claimReportRun, {
      runId: args.runId,
    });
    if (!claim.started) return stoppedRun(args.runId);

    try {
      return await runReportSheets(ctx, args.runId, claim.params, args.verificationFilter ?? "all");
    } catch (error) {
      // The record closes even when the run stops on its way, because a row
      // left open would read as a run that is still working. A run the operator
      // stopped keeps its cancellation: the failure happened after the request,
      // and the form asked for a stop, not for an error.
      const closed = await ctx.runMutation(internal.reportRuns.finishReportRun, {
        runId: args.runId,
        status: "failed",
        completedAt: Date.now(),
        processedClinicCount: 0,
        succeededClinicCount: 0,
        failedClinicCount: 0,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      if (closed.cancelled) return stoppedRun(args.runId);
      throw error;
    }
  },
});

// What the form is answered with when the operator stopped the run before it
// read a sheet. Nothing was read, so there is nothing to show beside the notice.
function stoppedRun(runId: Id<"reportRuns">): ReportRunResult {
  return { reportRunId: runId, assignedClinicCount: 0, cancelled: true, sheets: [] };
}

/**
 * Reads the sheets of one run and closes its record. The operator may stop the
 * run between any two clinics, so every clinic asks first and the run answers
 * with the sheets it had read by then.
 */
async function runReportSheets(
  ctx: ActionCtx,
  runId: Id<"reportRuns">,
  params: RunParams,
  verificationFilter: ExecuteVerificationFilter
): Promise<ReportRunResult> {
  const config: ReportRunConfig = await ctx.runQuery(internal.reports.runSheetReportConfig, {
    userId: params.userId,
    reportTypeId: params.reportTypeId,
    startDate: params.startDate,
    endDate: params.endDate,
  });

  // The carrier engine asks the Control Central API which bots each clinic
  // has, and reads the same stored conditions every other report reads, so
  // it runs on its own path.
  if (config.engine === "execute") {
    return await runExecuteReport(ctx, {
      runId,
      clinics: config.clinics,
      buckets: config.buckets,
      startDate: params.startDate,
      endDate: params.endDate,
      // A carrier report narrows by verification type in code, so a type
      // that hides the picker runs with the engine default instead of a
      // choice left over from another report type.
      verificationFilter: config.usesVerificationFilter ? verificationFilter : "all",
      userId: params.userId,
      reportTypeId: params.reportTypeId,
      reportTypeName: config.reportTypeName,
      startedAt: params.startedAt,
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
    runId,
    clinics: config.clinics.map((c) => ({
      clinicId: c.clinicId,
      googleSheetId: c.googleSheetId,
    })),
    startDate: params.startDate,
    endDate: params.endDate,
  });

  const sheets: ReportSheetResult[] = [];

  let succeededClinics = 0;
  let failedClinics = 0;
  let processedClinics = 0;
  for (const clinic of config.clinics) {
    // The operator may have stopped the run while the clinics before this one
    // were read, and a clinic that is not read is not counted as processed.
    if (await reportRunCancelled(ctx, runId)) break;
    processedClinics += 1;
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
        error: { code: "SHEET_NO_TABS", startDate: params.startDate, endDate: params.endDate },
      });
      continue;
    }
    let indexes: ConditionColumnResolver;
    try {
      indexes = conditionColumnResolver(
        clinic.sheetColumns,
        clinic.conditions.buckets,
        extraFilters
      );
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
        runId,
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
    // A clinic the operator stopped in the middle of read no sheet, so it is
    // not counted as read: the run ends where it was stopped.
    if (await reportRunCancelled(ctx, runId)) break;

    if (clinicFailed) {
      failedClinics += 1;
    } else {
      succeededClinics += 1;
    }
  }

  const clientIds = new Set(config.clinics.map((clinic) => clinic.clientId));
  const reportClientId = clientIds.size === 1 ? config.clinics[0]?.clientId : undefined;

  const { cancelled } = await ctx.runMutation(internal.reportRuns.finishReportRun, {
    runId,
    clientId: reportClientId,
    status: succeededClinics === 0 ? "failed" : "completed",
    completedAt: Date.now(),
    processedClinicCount: processedClinics,
    succeededClinicCount: succeededClinics,
    failedClinicCount: failedClinics,
  });

  return {
    reportRunId: runId,
    assignedClinicCount: config.clinics.length,
    cancelled,
    sheets,
  };
}

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
        externalClinicId: v.string(),
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

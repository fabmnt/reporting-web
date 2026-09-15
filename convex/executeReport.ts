import { internal } from "./_generated/api.js";
import type { Id } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";
import { fetchClinicBots, signInCarrierApi, type CarrierFailure } from "./carrierApi";
import { actionDeadline } from "./googleApi";
import { appError, sheetErrorFrom, type ReportSheetError } from "./model/appErrors";
import { carrierMatchers, inactiveCarrierBots, type CarrierMatcher } from "./model/carrierBots";
import type { ResolvedClinicSheetColumns } from "./model/clinicSheetColumns";
import {
  CARRIER_COLUMN_INDEX,
  EXECUTE_FIXED_COLUMN_INDEXES,
  isPendingToExecute,
  type ExecuteColumnIndexes,
  type ExecuteVerificationFilter,
} from "./model/executeRules";
import { columnLetterToIndex } from "./model/reporting";
import type {
  InactiveCarriersEntry,
  ReportBucketResult,
  ReportRow,
  ReportRunResult,
  ReportSheetResult,
} from "./model/reportResults";

type ExecuteClinic = {
  clinicId: Id<"clinics">;
  clientId: Id<"clients">;
  name: string;
  googleSheetId: string;
  externalClinicId: string | null;
  sheetColumns: ResolvedClinicSheetColumns;
};

export type ExecuteRunConfig = {
  clinics: ExecuteClinic[];
  buckets: Array<{ key: string; label: string }>;
  startDate: string;
  endDate: string;
  verificationFilter: ExecuteVerificationFilter;
  userId: Id<"users">;
  reportTypeId: Id<"reportTypes">;
  reportTypeName: string;
  startedAt: number;
};

type ClinicEntry = {
  clinicId: Id<"clinics">;
  clinicName: string;
  googleSheetId: string;
  tabTitle: string;
  headers: string[];
  bucketRows: ReportBucketResult[];
  error: ReportSheetError | null;
};

// The error each failure of the carrier API turns into. A clinic keeps its
// own, so the rest of the run still returns rows.
function carrierFailureError(failure: CarrierFailure): ReportSheetError {
  switch (failure) {
    case "accessDenied":
      return { code: "SHEET_CARRIER_ACCESS_DENIED" };
    case "notFound":
      return { code: "SHEET_CARRIER_CLINIC_UNKNOWN" };
    case "unauthorized":
    case "unavailable":
      return { code: "SHEET_CARRIER_UNAVAILABLE" };
  }
}

// The bots the row's carrier cell matches, by name and without repeats, which
// is more than the cell says: a shared pattern answers several carrier names.
function matchedCarriers(row: string[], matchers: CarrierMatcher[]): string[] {
  const carrierCell = (row[CARRIER_COLUMN_INDEX] ?? "").trim();
  if (carrierCell === "") return [];

  const names: string[] = [];
  for (const matcher of matchers) {
    if (names.includes(matcher.name)) continue;
    if (matcher.matches(carrierCell)) names.push(matcher.name);
  }
  return names;
}

/**
 * The pending-to-execute report: the rows of a clinic that a carrier bot can
 * still work on. The rules live in model/executeRules and the bot list comes
 * from the Control Central API, so a clinic whose bots cannot be read keeps
 * its own error and the remaining clinics still return their rows.
 */
export async function runExecuteReport(
  ctx: ActionCtx,
  config: ExecuteRunConfig
): Promise<ReportRunResult> {
  const deadlineMs = actionDeadline();
  const signedIn = await signInCarrierApi(deadlineMs);
  if (!signedIn.ok) {
    throw appError({
      code:
        signedIn.failure === "unauthorized"
          ? "CARRIER_SIGN_IN_REJECTED"
          : "CARRIER_API_UNAVAILABLE",
    });
  }
  // One token serves the whole run. A clinic that meets a rejected token signs
  // in again once, in case the API dropped it while the run was reading.
  let token = signedIn.value;

  const bucket = config.buckets[0];
  const bucketKey = bucket?.key ?? "pending";
  const bucketLabel = bucket?.label ?? config.reportTypeName;

  const {
    tabsForClinic,
    errorsForClinic,
  }: {
    tabsForClinic: Record<string, string[]>;
    errorsForClinic: Record<string, ReportSheetError>;
  } = await ctx.runAction(internal.sheets.planSheetTabs, {
    clinics: config.clinics.map((clinic) => ({
      clinicId: clinic.clinicId,
      googleSheetId: clinic.googleSheetId,
    })),
    startDate: config.startDate,
    endDate: config.endDate,
  });

  const sheets: ReportSheetResult[] = [];
  const inactiveCarriers: InactiveCarriersEntry[] = [];
  let succeededClinics = 0;
  let failedClinics = 0;

  for (const clinic of config.clinics) {
    const clinicEntry: ClinicEntry = {
      clinicId: clinic.clinicId,
      clinicName: clinic.name,
      googleSheetId: clinic.googleSheetId,
      tabTitle: "",
      headers: [],
      bucketRows: [],
      error: null,
    };
    const failClinic = (error: ReportSheetError) => {
      failedClinics += 1;
      sheets.push({ ...clinicEntry, error });
    };

    if (clinic.externalClinicId === null) {
      failClinic({ code: "SHEET_CARRIER_ID_MISSING" });
      continue;
    }

    let botsResult = await fetchClinicBots(clinic.externalClinicId, token, deadlineMs);
    if (!botsResult.ok && botsResult.failure === "unauthorized") {
      const renewed = await signInCarrierApi(deadlineMs);
      if (renewed.ok) {
        token = renewed.value;
        botsResult = await fetchClinicBots(clinic.externalClinicId, token, deadlineMs);
      }
    }
    if (!botsResult.ok) {
      failClinic(carrierFailureError(botsResult.failure));
      continue;
    }

    const { matchers, unsupported } = carrierMatchers(botsResult.value);
    // The card carries every bot of the clinic the report cannot use: the ones
    // the API reports as not active, and the ones whose pattern this app will
    // not run, whose rows would otherwise go missing without a word.
    const unusableBots = [
      ...inactiveCarrierBots(botsResult.value),
      ...unsupported.map((bot) => ({ name: bot.name, status: bot.status, unsupported: true })),
    ];
    if (unusableBots.length > 0) {
      inactiveCarriers.push({
        clinicId: clinic.clinicId,
        clinicName: clinic.name,
        bots: unusableBots,
      });
    }

    if (matchers.length === 0) {
      failClinic({ code: "SHEET_NO_CARRIER_BOTS" });
      continue;
    }

    let indexes: ExecuteColumnIndexes;
    let filterColumns: number[];
    try {
      indexes = {
        verification: columnLetterToIndex(clinic.sheetColumns.verificationType),
        fileUrl: columnLetterToIndex(clinic.sheetColumns.fileUrl),
        updateStatus: columnLetterToIndex(clinic.sheetColumns.updateStatus),
      };
      filterColumns = [
        ...new Set([
          ...EXECUTE_FIXED_COLUMN_INDEXES,
          indexes.verification,
          indexes.fileUrl,
          indexes.updateStatus,
        ]),
      ].sort((left, right) => left - right);
    } catch (error) {
      // A clinic with an unusable sheet-column mapping fails on its own
      // instead of stopping the run before the remaining clinics.
      failClinic(sheetErrorFrom(error));
      continue;
    }

    const planningError = errorsForClinic[clinic.clinicId];
    if (planningError !== undefined) {
      failClinic(planningError);
      continue;
    }

    const tabs = tabsForClinic[clinic.clinicId] ?? [];
    if (tabs.length === 0) {
      failClinic({ code: "SHEET_NO_TABS", startDate: config.startDate, endDate: config.endDate });
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
      clinicFailed = true;
      const sheetError = sheetErrorFrom(error);
      for (const tabTitle of tabs) {
        sheets.push({ ...clinicEntry, tabTitle, error: sheetError });
      }
    }

    for (const tabResult of tabResults) {
      if (tabResult.error !== null) {
        clinicFailed = true;
        sheets.push({ ...clinicEntry, tabTitle: tabResult.tabTitle, error: tabResult.error });
        continue;
      }

      const rows: ReportRow[] = [];
      tabResult.values.forEach((row, index) => {
        const carriers = matchedCarriers(row, matchers);
        if (carriers.length === 0) return;
        if (!isPendingToExecute(row, indexes, config.verificationFilter)) return;
        rows.push({ rowNumber: index + 2, values: row, carriers });
      });

      sheets.push({
        ...clinicEntry,
        tabTitle: tabResult.tabTitle,
        headers: tabResult.headers,
        bucketRows: [{ bucketKey, label: bucketLabel, rows, filterColumns }],
      });
    }

    if (clinicFailed) {
      failedClinics += 1;
    } else {
      succeededClinics += 1;
    }
  }

  const clientIds = new Set(config.clinics.map((clinic) => clinic.clientId));
  const clientId = clientIds.size === 1 ? config.clinics[0]?.clientId : undefined;

  const { reportRunId }: { reportRunId: Id<"reportRuns"> } = await ctx.runMutation(
    internal.reports.recordReportRun,
    {
      reportTypeId: config.reportTypeId,
      reportTypeName: config.reportTypeName,
      clientId,
      status: succeededClinics === 0 ? "failed" : "completed",
      initiatedByUserId: config.userId,
      startedAt: config.startedAt,
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
    inactiveCarriers,
  };
}

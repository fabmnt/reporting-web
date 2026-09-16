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
  verificationMatches,
  type ExecuteVerificationFilter,
} from "./model/executeRules";
import {
  conditionColumnIndexes,
  evaluateConditionSet,
  filterColumnsForBucket,
  type ConditionColumnIndexes,
  type ReportConditionSet,
} from "./model/reportConditions";
import type {
  InactiveCarriersEntry,
  ReportBucketResult,
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
  conditions: ReportConditionSet;
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

// Every row is read up to the last column the rules look at. A sheet leaves
// trailing empty cells out of a short row, and those cells have to compare as
// empty instead of dropping the row on the length check the conditions do.
function paddedRow(row: string[], length: number): string[] {
  if (row.length >= length) return row;
  return [...row, ...Array.from({ length: length - row.length }, () => "")];
}

// The cells a dropped row left behind, named after their sheet header, so a
// log line explains the drop without opening the sheet.
function describeCells(row: string[], columns: number[], headers: string[]): string {
  return columns
    .map((column) => `${headers[column] || `column ${column + 1}`}="${(row[column] ?? "").trim()}"`)
    .join(", ");
}

/**
 * The carrier report: the rows of a clinic that a carrier bot can still work
 * on. A row counts when its carrier cell matches one of the clinic bots, the
 * verification filter takes it, and the conditions stored on the report type
 * match it, the same conditions the configuration panels edit. The bot list
 * comes from the Control Central API, so a clinic whose bots cannot be read
 * keeps its own error and the remaining clinics still return their rows.
 *
 * Every filter logs the rows it drops, which is what makes a missing row
 * explainable while the conditions are being tuned.
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

  // The labels the report type stores travel with the run, so a group it
  // renamed still reads as the user named it.
  const bucketLabels = new Map(config.buckets.map((bucket) => [bucket.key, bucket.label]));
  // This report keeps a trace of every filter, so a row that is missing from
  // the results can be followed through the run. The tag names the report type
  // being run, because a copy of the built-in type keeps the engine and a
  // deployment can hold several carrier reports.
  const logTag = `[${config.reportTypeName}]`;

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

    let indexes: ConditionColumnIndexes;
    let ruleColumns: number[];
    let rowLength: number;
    try {
      indexes = conditionColumnIndexes(clinic.sheetColumns);
      const columns = new Set<number>();
      for (const bucket of clinic.conditions.buckets) {
        const bucketColumns = filterColumnsForBucket(
          clinic.conditions.buckets,
          bucket,
          [],
          indexes
        );
        for (const column of bucketColumns) columns.add(column);
      }
      ruleColumns = [...columns].sort((left, right) => left - right);
      // A row is compared up to the last column any rule reads, so the sheet
      // leaving trailing empty cells out of a short row still has them compared
      // as empty instead of losing the row on the length check.
      rowLength = Math.max(CARRIER_COLUMN_INDEX, indexes.verificationType, ...ruleColumns) + 1;
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

      const bucketRows: ReportBucketResult[] = clinic.conditions.buckets.map((bucket) => ({
        bucketKey: bucket.bucketKey,
        // A group the type never named falls back to its key, which is what the
        // results show for row reports too.
        label: bucketLabels.get(bucket.bucketKey) ?? bucket.bucketKey,
        rows: [],
        // The carrier match and the verification choice decide every row beside
        // the rules of the group itself.
        filterColumns: [
          ...new Set([
            CARRIER_COLUMN_INDEX,
            indexes.verificationType,
            ...filterColumnsForBucket(clinic.conditions.buckets, bucket, [], indexes),
          ]),
        ].sort((left, right) => left - right),
      }));
      const rowsByBucket = new Map(bucketRows.map((bucket) => [bucket.bucketKey, bucket.rows]));
      let droppedByCarrier = 0;
      let droppedByVerification = 0;
      let droppedByRules = 0;
      tabResult.values.forEach((row, index) => {
        const rowNumber = index + 2;
        const carriers = matchedCarriers(row, matchers);
        if (carriers.length === 0) {
          droppedByCarrier += 1;
          console.log(
            `${logTag} dropped by the carrier filter: ${clinic.name} ${tabResult.tabTitle} ` +
              `row ${rowNumber}, carrier="${(row[CARRIER_COLUMN_INDEX] ?? "").trim()}"`
          );
          return;
        }
        const verification = (row[indexes.verificationType] ?? "").trim();
        if (!verificationMatches(verification, config.verificationFilter)) {
          droppedByVerification += 1;
          console.log(
            `${logTag} dropped by the verification filter: ${clinic.name} ${tabResult.tabTitle} ` +
              `row ${rowNumber}, verification="${verification}", the run asks for "${config.verificationFilter}"`
          );
          return;
        }
        const matchedBucket = evaluateConditionSet(
          paddedRow(row, rowLength),
          indexes,
          clinic.conditions
        );
        if (matchedBucket === null) {
          droppedByRules += 1;
          console.log(
            `${logTag} dropped by the conditions: ${clinic.name} ${tabResult.tabTitle} ` +
              `row ${rowNumber}, ${describeCells(row, ruleColumns, tabResult.headers)}`
          );
          return;
        }
        rowsByBucket.get(matchedBucket)?.push({ rowNumber, values: row, carriers });
      });
      const keptRows = bucketRows.reduce((total, bucket) => total + bucket.rows.length, 0);
      // One line per tab: what the tab held and where the rest of the rows
      // went, so the counts do not have to be read off the drop lines.
      console.log(
        `${logTag} ${clinic.name} ${tabResult.tabTitle}: ${tabResult.values.length} rows read, ` +
          `${keptRows} kept, ${droppedByCarrier} dropped by the carrier filter, ` +
          `${droppedByVerification} by the verification filter, ${droppedByRules} by the conditions`
      );

      sheets.push({
        ...clinicEntry,
        tabTitle: tabResult.tabTitle,
        headers: tabResult.headers,
        bucketRows,
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

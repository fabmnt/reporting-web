import { v } from "convex/values";

import { internalAction } from "./_generated/server";
import { actionDeadline, fetchSheetsJson, refreshAccessToken } from "./googleApi";
import { reportSheetError, sheetErrorFrom, type ReportSheetError } from "./model/appErrors";
import { assertReportDateRange, tabsInDateRange } from "./model/reporting";

type SheetsTabListResponse = {
  sheets?: Array<{ properties?: { title?: string } }>;
};

type SheetsValueRange = {
  values?: string[][];
};

type SheetsBatchValuesResponse = {
  valueRanges?: SheetsValueRange[];
};

type SheetTabValues = {
  tabTitle: string;
  headers: string[];
  values: string[][];
  error: ReportSheetError | null;
};

// spreadsheets.get has no batch variant, so planning still costs one request
// per clinic. Values are batched with values:batchGet instead: one request
// covers many tabs of the same spreadsheet. Ranges travel in the query string,
// so long date ranges are sent in chunks.
const MAX_RANGES_PER_BATCH_REQUEST = 25;
const SHEET_TITLE_FIELDS = "sheets.properties.title";

// Internal helpers only: the public runSheetReport action owns auth and calls
// these, so Sheets access never bypasses requireOperator.
export const planSheetTabs = internalAction({
  args: {
    clinics: v.array(v.object({ clinicId: v.id("clinics"), googleSheetId: v.string() })),
    startDate: v.string(),
    endDate: v.string(),
  },
  returns: v.object({
    tabsForClinic: v.record(v.string(), v.array(v.string())),
    // A spreadsheet the run could not read. The clinic it belongs to reports
    // the error and every other clinic still returns its rows.
    errorsForClinic: v.record(v.string(), reportSheetError),
  }),
  handler: async (ctx, args) => {
    // A malformed range is the run's problem and not a clinic's, so it is
    // rejected before any spreadsheet is read.
    assertReportDateRange(args.startDate, args.endDate);

    // One deadline for the whole action, however many clinics it covers.
    const deadlineMs = actionDeadline();
    const tabsForClinic: Record<string, string[]> = {};
    const errorsForClinic: Record<string, ReportSheetError> = {};

    let token: string | null = null;
    try {
      token = await refreshAccessToken();
    } catch (error) {
      // Every clinic needs the same token, so a token that cannot be obtained
      // is the error of each of them instead of a failed action that records
      // nothing.
      const sheetError = sheetErrorFrom(error);
      for (const clinic of args.clinics) {
        errorsForClinic[clinic.clinicId] = sheetError;
      }
      return { tabsForClinic, errorsForClinic };
    }

    for (const clinic of args.clinics) {
      try {
        const data = (await fetchSheetsJson(
          ctx,
          `${clinic.googleSheetId}?fields=${SHEET_TITLE_FIELDS}`,
          token,
          deadlineMs
        )) as SheetsTabListResponse;
        const titles = (data.sheets ?? [])
          .map((sheet) => sheet.properties?.title ?? "")
          .filter((title) => title !== "");
        tabsForClinic[clinic.clinicId] = tabsInDateRange(titles, args.startDate, args.endDate);
      } catch (error) {
        // A deleted, unshared or rate-limited spreadsheet fails on its own, so
        // the clinics that can be read still return their rows.
        errorsForClinic[clinic.clinicId] = sheetErrorFrom(error);
      }
    }
    return { tabsForClinic, errorsForClinic };
  },
});

// values:batchGet answers with one ValueRange per requested range, in the same
// order. Empty ranges come back without a "values" field, so both cases map to
// an empty grid.
function toSheetTabValues(tabTitle: string, grid: string[][] | undefined): SheetTabValues {
  // First row is the header, same as the old tool's get_rows() which pops row 0.
  const allRows = (grid ?? []).map((row) => row.map((cell) => cell ?? ""));
  if (allRows.length === 0) return { tabTitle, headers: [], values: [], error: null };
  return { tabTitle, headers: allRows[0] ?? [], values: allRows.slice(1), error: null };
}

// Reads every requested tab of one spreadsheet. Batches the tabs so a clinic
// with many tabs in range costs a chunk of requests instead of one per tab.
// A failed chunk comes back as per-tab errors, so the other tabs of the same
// spreadsheet still return their data.
export const readSheetTabsValues = internalAction({
  args: { googleSheetId: v.string(), tabTitles: v.array(v.string()) },
  returns: v.array(
    v.object({
      tabTitle: v.string(),
      headers: v.array(v.string()),
      values: v.array(v.array(v.string())),
      error: v.union(reportSheetError, v.null()),
    })
  ),
  handler: async (ctx, args): Promise<SheetTabValues[]> => {
    const token = await refreshAccessToken();
    const deadlineMs = actionDeadline();
    const results: SheetTabValues[] = [];
    for (let start = 0; start < args.tabTitles.length; start += MAX_RANGES_PER_BATCH_REQUEST) {
      const chunk = args.tabTitles.slice(start, start + MAX_RANGES_PER_BATCH_REQUEST);
      try {
        const query = chunk
          .map((tabTitle) => `ranges=${encodeURIComponent(`${tabTitle}!A1:ZZZ20000`)}`)
          .join("&");
        const data = (await fetchSheetsJson(
          ctx,
          `${args.googleSheetId}/values:batchGet?${query}`,
          token,
          deadlineMs
        )) as SheetsBatchValuesResponse;
        const valueRanges = data.valueRanges ?? [];
        if (valueRanges.length !== chunk.length) {
          throw new Error(
            `Google Sheets returned ${valueRanges.length} ranges for ${chunk.length} requested tabs.`
          );
        }
        chunk.forEach((tabTitle, index) => {
          results.push(toSheetTabValues(tabTitle, valueRanges[index]?.values));
        });
      } catch (error) {
        const sheetError = sheetErrorFrom(error);
        for (const tabTitle of chunk) {
          results.push({ tabTitle, headers: [], values: [], error: sheetError });
        }
      }
    }
    return results;
  },
});

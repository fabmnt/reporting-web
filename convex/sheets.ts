import { v } from "convex/values";

import { internalAction } from "./_generated/server";
import { sheetsSessions } from "./googleSheetsAccess";
import { reportSheetError, sheetErrorFrom, type ReportSheetError } from "./model/appErrors";
import type { SheetGrid } from "./model/googleGrid";
import { assertReportDateRange, tabsInDateRange } from "./model/reporting";
import { reportRunCancelled } from "./model/reportRuns";

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

// A tab is read up to the last column a sheet can hold and far more rows than
// one does, because the report compares whole rows and does not know which
// cells a tab uses.
const READ_RANGE = "A1:ZZZ20000";

// Internal helpers only: the public runSheetReport action owns auth and calls
// these, so Sheets access never bypasses requireOperator.
export const planSheetTabs = internalAction({
  args: {
    runId: v.id("reportRuns"),
    // Every clinic names its own client, because a run can cover clinics of
    // several clients and it is the client that decides which Google account
    // reads the sheet.
    clinics: v.array(
      v.object({
        clinicId: v.id("clinics"),
        clientId: v.id("clients"),
        googleSheetId: v.string(),
      })
    ),
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

    const tabsForClinic: Record<string, string[]> = {};
    const errorsForClinic: Record<string, ReportSheetError> = {};

    // A stop that already landed is answered here, before the first external
    // call of this action. A run the operator cancelled reads no sheet, so it
    // should not pay for one either.
    if (await reportRunCancelled(ctx, args.runId)) return { tabsForClinic, errorsForClinic };

    // One session per credential for the whole action, and one deadline with it.
    const sessions = sheetsSessions(ctx);
    for (const clinic of args.clinics) {
      // A run the operator stopped stops planning here: a clinic without a plan
      // is one the run will not read either, and planning the rest would only
      // spend requests on it.
      if (await reportRunCancelled(ctx, args.runId)) break;
      try {
        const session = await sessions.forClient(clinic.clientId);
        const titles = await session.listTabTitles(clinic.googleSheetId);
        tabsForClinic[clinic.clinicId] = tabsInDateRange(titles, args.startDate, args.endDate);
      } catch (error) {
        // A credential that cannot be used, a deleted spreadsheet and an
        // unshared one all fail here, so the clinics that can be read still
        // return their rows.
        errorsForClinic[clinic.clinicId] = sheetErrorFrom(error);
      }
    }
    return { tabsForClinic, errorsForClinic };
  },
});

// values:batchGet answers with one range per requested range, in the same
// order. Empty ranges come back without a values field, so both cases map to
// an empty grid.
function toSheetTabValues(tabTitle: string, grid: SheetGrid): SheetTabValues {
  // First row is the header, same as the old tool's get_rows() which pops row 0.
  if (grid.length === 0) return { tabTitle, headers: [], values: [], error: null };
  return { tabTitle, headers: grid[0] ?? [], values: grid.slice(1), error: null };
}

// Reads every requested tab of one spreadsheet. Batches the tabs so a clinic
// with many tabs in range costs a chunk of requests instead of one per tab.
// A failed chunk comes back as per-tab errors, so the other tabs of the same
// spreadsheet still return their data.
export const readSheetTabsValues = internalAction({
  args: {
    runId: v.id("reportRuns"),
    clientId: v.id("clients"),
    googleSheetId: v.string(),
    tabTitles: v.array(v.string()),
  },
  returns: v.array(
    v.object({
      tabTitle: v.string(),
      headers: v.array(v.string()),
      values: v.array(v.array(v.string())),
      error: v.union(reportSheetError, v.null()),
    })
  ),
  handler: async (ctx, args): Promise<SheetTabValues[]> => {
    const results: SheetTabValues[] = [];
    // Same as planning: a run the operator already stopped reads no tab, so it
    // does not pay for the credential that reading one would need.
    if (await reportRunCancelled(ctx, args.runId)) return results;

    const session = await sheetsSessions(ctx).forClient(args.clientId);
    for (let start = 0; start < args.tabTitles.length; start += MAX_RANGES_PER_BATCH_REQUEST) {
      // The chunk already in flight finishes on its own, and no further chunk is
      // asked for once the operator has stopped the run.
      if (await reportRunCancelled(ctx, args.runId)) break;
      const chunk = args.tabTitles.slice(start, start + MAX_RANGES_PER_BATCH_REQUEST);
      try {
        const grids = await session.readRanges(
          args.googleSheetId,
          chunk.map((tabTitle) => `${tabTitle}!${READ_RANGE}`)
        );
        chunk.forEach((tabTitle, index) => {
          results.push(toSheetTabValues(tabTitle, grids[index] ?? []));
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

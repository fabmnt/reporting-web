import type { Id } from "../_generated/dataModel";
import type { SheetsSession } from "../googleSheetsAccess";
import { sheetErrorFrom, type ReportSheetError } from "./appErrors";
import type { ResolvedClinicSheetColumns } from "./clinicSheetColumns";
import type { SheetGrid } from "./googleGrid";
import type { ConditionExpression } from "./reportConditions";
import { tabsInDateRange } from "./reporting";
import {
  buildFilterViewBatch,
  filterViewEndColumn,
  filterViewEndRow,
  filterViewFormula,
  prepareRowMatcher,
  type PreparedFilterView,
  type SheetTabStructure,
} from "./sheetFilterViews";

// values:batchGet has no documented cap that this app hits first. Ranges travel
// in the query string, so a long date range is read in chunks, same as a report.
const RANGES_PER_REQUEST = 25;
const READ_RANGE = "A1:ZZZ20000";

export type SheetFilterTabError =
  ReportSheetError | { code: "SHEET_FILTER_TOO_LONG"; rowCount: number };

export type SheetFilterTabResult = {
  tabTitle: string;
  matchedRowCount: number;
  error: SheetFilterTabError | null;
};

export type SheetFilterClinicResult = {
  clinicId: Id<"clinics">;
  clinicName: string;
  error: ReportSheetError | null;
  tabs: SheetFilterTabResult[];
};

export type ApplyFilterClinic = {
  clinicId: Id<"clinics">;
  clientId: Id<"clients">;
  clinicName: string;
  googleSheetId: string;
  sheetColumns: ResolvedClinicSheetColumns;
  filterName: string;
  expression: ConditionExpression;
  startDate: string;
  endDate: string;
};

function failedTab(tabTitle: string, error: SheetFilterTabError): SheetFilterTabResult {
  return { tabTitle, matchedRowCount: 0, error };
}

function isSheetGrid(value: SheetGrid | ReportSheetError): value is SheetGrid {
  return Array.isArray(value);
}

/**
 * Writes one named filter view onto every date tab in range. A tab that cannot
 * be read, or whose matching rows do not fit in a formula, is reported on its
 * own and the other tabs of the clinic are still written. Replacing a view
 * deletes every view on that tab with the filter's name, then adds one.
 */
export async function applyFilterToClinic(
  session: SheetsSession,
  input: ApplyFilterClinic
): Promise<SheetFilterClinicResult> {
  const base = {
    clinicId: input.clinicId,
    clinicName: input.clinicName,
    tabs: [] as SheetFilterTabResult[],
  };

  let structure: SheetTabStructure[];
  try {
    structure = await session.listSheetStructure(input.googleSheetId);
  } catch (error) {
    return { ...base, error: sheetErrorFrom(error) };
  }

  const titles = tabsInDateRange(
    structure.map((tab) => tab.title),
    input.startDate,
    input.endDate
  );
  if (titles.length === 0) {
    return {
      ...base,
      error: { code: "SHEET_NO_TABS", startDate: input.startDate, endDate: input.endDate },
    };
  }

  let matcher: (values: string[][]) => number[];
  try {
    matcher = prepareRowMatcher(input.sheetColumns, input.expression);
  } catch (error) {
    return { ...base, error: sheetErrorFrom(error) };
  }

  const byTitle = new Map(structure.map((tab) => [tab.title, tab]));
  const grids = new Map<string, SheetGrid | ReportSheetError>();
  for (let start = 0; start < titles.length; start += RANGES_PER_REQUEST) {
    const chunk = titles.slice(start, start + RANGES_PER_REQUEST);
    try {
      const read = await session.readRanges(
        input.googleSheetId,
        chunk.map((title) => `${title}!${READ_RANGE}`)
      );
      chunk.forEach((title, index) => {
        grids.set(title, read[index] ?? []);
      });
    } catch (error) {
      const sheetError = sheetErrorFrom(error);
      for (const title of chunk) grids.set(title, sheetError);
    }
  }

  const existingIds = structure.flatMap((tab) => tab.filterViews.map((view) => view.filterViewId));
  const prepared: PreparedFilterView[] = [];
  const tabs: SheetFilterTabResult[] = [];
  const writtenTitles = new Set<string>();

  for (const title of titles) {
    const grid = grids.get(title);
    const tab = byTitle.get(title);
    if (grid === undefined || tab === undefined) {
      tabs.push(
        failedTab(title, {
          code: "SHEET_FAILED",
          message: "The date tab was not found on the spreadsheet.",
        })
      );
      continue;
    }
    if (!isSheetGrid(grid)) {
      tabs.push(failedTab(title, grid));
      continue;
    }

    const values = grid.slice(1);
    const rowNumbers = matcher(values);
    const formula = filterViewFormula(rowNumbers);
    if (formula === null) {
      tabs.push({
        tabTitle: title,
        matchedRowCount: rowNumbers.length,
        error: { code: "SHEET_FILTER_TOO_LONG", rowCount: rowNumbers.length },
      });
      continue;
    }

    prepared.push({
      sheetId: tab.sheetId,
      title: input.filterName,
      deleteFilterViewIds: tab.filterViews
        .filter((view) => view.title === input.filterName)
        .map((view) => view.filterViewId),
      endRowIndex: filterViewEndRow(values.length),
      endColumnIndex: filterViewEndColumn(tab.columnCount),
      formula,
    });
    writtenTitles.add(title);
    tabs.push({ tabTitle: title, matchedRowCount: rowNumbers.length, error: null });
  }

  if (prepared.length > 0) {
    try {
      await session.replaceFilterViews(
        input.googleSheetId,
        buildFilterViewBatch(existingIds, prepared)
      );
    } catch (error) {
      const sheetError = sheetErrorFrom(error);
      for (const tab of tabs) {
        if (writtenTitles.has(tab.tabTitle) && tab.error === null) tab.error = sheetError;
      }
    }
  }

  return { ...base, error: null, tabs };
}

import type { ResolvedClinicSheetColumns } from "./clinicSheetColumns";
import {
  conditionColumnResolver,
  evaluateConditionSet,
  type ConditionExpression,
} from "./reportConditions";

// Clinic sheets were written with Spanish function names. FILA() is the row
// number, so the formula stays true for those rows even after Google adjusts
// it for the row it is checked on. A view built this way is a snapshot: rows
// that start matching later stay hidden until the filter is applied again.
const EMPTY_FILTER_FORMULA = "=FILA()=0";

// Google rejects a formula past the cell limit. A tab that matches more rows
// than fit is reported instead of sending a formula Google will refuse.
export const MAX_FILTER_FORMULA_LENGTH = 50_000;

// The fields a write needs from spreadsheets.get: the tab id, how wide the
// grid is, and the views already saved on it.
export const SHEET_STRUCTURE_FIELDS =
  "sheets(properties(sheetId,title,gridProperties(columnCount)),filterViews(filterViewId,title))";

export type SheetFilterViewRef = {
  filterViewId: number;
  title: string;
};

export type SheetTabStructure = {
  title: string;
  sheetId: number;
  columnCount: number;
  filterViews: SheetFilterViewRef[];
};

export type PreparedFilterView = {
  sheetId: number;
  title: string;
  deleteFilterViewIds: number[];
  endRowIndex: number;
  endColumnIndex: number;
  formula: string;
};

type FilterViewBatchRequest =
  | { deleteFilterView: { filterId: number } }
  | {
      addFilterView: {
        filter: {
          title: string;
          filterViewId: number;
          range: {
            sheetId: number;
            startRowIndex: number;
            endRowIndex: number;
            startColumnIndex: number;
            endColumnIndex: number;
          };
          criteria: {
            "0": {
              condition: {
                type: "CUSTOM_FORMULA";
                values: Array<{ userEnteredValue: string }>;
              };
            };
          };
        };
      };
    };

export type FilterViewBatch = {
  requests: FilterViewBatchRequest[];
};

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

// Reads the spreadsheet resource spreadsheets.get returns. A tab without an id
// cannot receive a view, so it is left out.
export function sheetTabsFromSpreadsheet(data: unknown): SheetTabStructure[] {
  if (typeof data !== "object" || data === null) return [];
  const sheets = (data as { sheets?: unknown }).sheets;
  if (!Array.isArray(sheets)) return [];

  const tabs: SheetTabStructure[] = [];
  for (const sheet of sheets) {
    if (typeof sheet !== "object" || sheet === null) continue;
    const properties = (sheet as { properties?: unknown }).properties;
    if (typeof properties !== "object" || properties === null) continue;
    const fields = properties as { sheetId?: unknown; title?: unknown; gridProperties?: unknown };
    const sheetId = finiteNumber(fields.sheetId);
    const title = typeof fields.title === "string" ? fields.title : "";
    if (sheetId === null || title === "") continue;

    const grid =
      typeof fields.gridProperties === "object" && fields.gridProperties !== null
        ? (fields.gridProperties as { columnCount?: unknown })
        : {};
    const columnCount = finiteNumber(grid.columnCount);

    const rawViews = (sheet as { filterViews?: unknown }).filterViews;
    const filterViews: SheetFilterViewRef[] = [];
    if (Array.isArray(rawViews)) {
      for (const view of rawViews) {
        if (typeof view !== "object" || view === null) continue;
        const filterViewId = finiteNumber((view as { filterViewId?: unknown }).filterViewId);
        const viewTitle = (view as { title?: unknown }).title;
        if (filterViewId === null || typeof viewTitle !== "string" || viewTitle === "") continue;
        filterViews.push({ filterViewId, title: viewTitle });
      }
    }

    tabs.push({
      title,
      sheetId,
      columnCount: columnCount !== null && columnCount > 0 ? columnCount : 1,
      filterViews,
    });
  }
  return tabs;
}

/**
 * Rows under the header that match the expression. `values[0]` is sheet row 2,
 * the same split a report uses when it treats the first read row as the header.
 * Throws when a column the expression reads is not a sheet column.
 */
export function prepareRowMatcher(
  columns: ResolvedClinicSheetColumns,
  expression: ConditionExpression
): (values: string[][]) => number[] {
  const buckets = [{ bucketKey: "match", catchAll: false, expression }];
  const indexes = conditionColumnResolver(columns, buckets);
  const conditions = { buckets };
  return (values) => {
    const rows: number[] = [];
    values.forEach((row, index) => {
      if (evaluateConditionSet(row, indexes, conditions) !== null) rows.push(index + 2);
    });
    return rows;
  };
}

// Null when the matching rows do not fit in one formula. An empty match still
// returns a formula, so the view shows the header and no data rows.
export function filterViewFormula(rowNumbers: readonly number[]): string | null {
  if (rowNumbers.length === 0) return EMPTY_FILTER_FORMULA;
  const formula = `=O(${rowNumbers.map((row) => `FILA()=${row}`).join(", ")})`;
  return formula.length > MAX_FILTER_FORMULA_LENGTH ? null : formula;
}

// Exclusive end index. The header is row 1, so N data rows occupy rows 1 through
// N + 1. A tab with no data rows still covers the header.
export function filterViewEndRow(dataRowCount: number): number {
  return Math.max(dataRowCount + 1, 1);
}

export function filterViewEndColumn(columnCount: number): number {
  return Math.max(columnCount, 1);
}

function unusedFilterViewId(used: Set<number>): number {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const id = Math.floor(Math.random() * 0x7ffffffe) + 1;
    if (!used.has(id)) {
      used.add(id);
      return id;
    }
  }
  throw new Error("Could not allocate a Google Sheets filter view id.");
}

// Deletes every view whose title is being replaced, then adds one view per tab.
// Ids already on the spreadsheet are kept out of the new ids.
export function buildFilterViewBatch(
  existingFilterViewIds: readonly number[],
  views: readonly PreparedFilterView[]
): FilterViewBatch {
  const used = new Set(existingFilterViewIds);
  const requests: FilterViewBatchRequest[] = [];

  for (const view of views) {
    for (const filterId of view.deleteFilterViewIds) {
      requests.push({ deleteFilterView: { filterId } });
      used.delete(filterId);
    }
    requests.push({
      addFilterView: {
        filter: {
          title: view.title,
          filterViewId: unusedFilterViewId(used),
          range: {
            sheetId: view.sheetId,
            startRowIndex: 0,
            endRowIndex: view.endRowIndex,
            startColumnIndex: 0,
            endColumnIndex: view.endColumnIndex,
          },
          criteria: {
            "0": {
              condition: {
                type: "CUSTOM_FORMULA",
                values: [{ userEnteredValue: view.formula }],
              },
            },
          },
        },
      },
    });
  }

  return { requests };
}

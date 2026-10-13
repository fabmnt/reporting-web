import { describe, expect, it } from "vitest";

import { CLINIC_SHEET_COLUMN_DEFAULTS } from "./clinicSheetColumns";
import {
  filterViewFormula,
  filterViewsLanded,
  prepareRowMatcher,
  type SheetTabStructure,
} from "./sheetFilterViews";

describe("filterViewFormula", () => {
  it("uses English function names", () => {
    expect(filterViewFormula([])).toBe("=ROW()=0");
    expect(filterViewFormula([4])).toBe("=OR(ROW()=4)");
    expect(filterViewFormula([2, 5])).toBe("=OR(ROW()=2,ROW()=5)");
  });
});

describe("prepareRowMatcher", () => {
  it("treats a missing trailing cell as empty", () => {
    const match = prepareRowMatcher(CLINIC_SHEET_COLUMN_DEFAULTS, {
      filters: [{ column: "fileUrl", operator: "isEmpty", values: [] }],
      groups: [],
    });

    expect(match([["only the first cell"]])).toEqual([2]);
  });
});

describe("filterViewsLanded", () => {
  const tab = (ids: number[]): SheetTabStructure => ({
    title: "2026-05-30",
    sheetId: 1,
    columnCount: 10,
    filterViews: ids.map((filterViewId) => ({ filterViewId, title: "Done rows" })),
  });

  it("is true only when every added id is already on the sheet", () => {
    expect(filterViewsLanded([tab([7, 8])], [7, 8])).toBe(true);
    expect(filterViewsLanded([tab([7])], [7, 8])).toBe(false);
    expect(filterViewsLanded([tab([7])], [])).toBe(false);
  });
});

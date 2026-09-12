import { describe, expect, it } from "vitest";

import type { Id } from "../../convex/_generated/dataModel";
import type { QueryCtx } from "../../convex/_generated/server";
import {
  assertBucketKeys,
  AUDIT_EXCLUDE_STATUS,
  bucketCatalogFor,
  bucketKeysFor,
  cleanConditionSet,
  defaultConditionsFor,
  evaluateConditionSet,
  isImplementedOperation,
  MAX_CLAUSES_PER_SECTION,
  MAX_GROUPS_PER_EXPRESSION,
  MAX_MARKER_LENGTH,
  MAX_MARKERS_PER_RULE,
  resolveConditionsForClinics,
  type ConditionClause,
  type ConditionColumnIndexes,
  type ConditionExpression,
  type ReportConditionSet,
} from "../../convex/model/reportConditions";

import {
  expressionHasNoClauses,
  normalizeMarker,
  operatorIsNegated,
  operatorNeedsValues,
} from "./reportConditions";

// Legacy sheet layout: L = 11, M = 12, then the column mapping of the test
// clinic. L and M are fixed, the rest come from the clinic configuration.
const COLUMNS: ConditionColumnIndexes = {
  L: 11,
  M: 12,
  updateStatus: 13,
  uploadStatus: 14,
  verificationType: 15,
  fileUrl: 16,
};

// One column more than the highest mapped column, so every clause can read its
// column. Tests that want a short row build their own array.
const ROW_LENGTH = COLUMNS.fileUrl + 1;

type RowValues = {
  l?: string;
  m?: string;
  verification?: string;
  updateStatus?: string;
  uploadStatus?: string;
  fileUrl?: string;
};

function sheetRow(values: RowValues): string[] {
  const row = Array.from({ length: ROW_LENGTH }, () => "");
  row[COLUMNS.L] = values.l ?? "";
  row[COLUMNS.M] = values.m ?? "";
  row[COLUMNS.updateStatus] = values.updateStatus ?? "";
  row[COLUMNS.uploadStatus] = values.uploadStatus ?? "";
  row[COLUMNS.verificationType] = values.verification ?? "";
  row[COLUMNS.fileUrl] = values.fileUrl ?? "";
  return row;
}

function clause(
  column: ConditionClause["column"],
  operator: ConditionClause["operator"],
  values: string[] = []
): ConditionClause {
  return { column, operator, values };
}

function singleBucket(expression: ConditionExpression, catchAll = false): ReportConditionSet {
  return { buckets: [{ bucketKey: "audit", catchAll, expression }] };
}

// What the report form sends when the verification type is not "all".
function verificationFilters(filter: "all" | "fbd" | "elg"): ConditionClause[] {
  return filter === "all" ? [] : [clause("verificationType", "contains", [filter.toUpperCase()])];
}

describe("defaultConditionsFor", () => {
  it("reproduces the legacy pending audit rule", () => {
    const conditions = defaultConditionsFor("pending-audit");
    const [bucket] = conditions.buckets;

    expect(conditions.buckets.map((item) => item.bucketKey)).toEqual(["audit"]);
    expect(bucket?.catchAll).toBe(false);
    expect(bucket?.expression.filters).toEqual([
      clause("updateStatus", "notEquals", [...AUDIT_EXCLUDE_STATUS]),
      clause("uploadStatus", "equals", ["EMPTY", "UNCHECKED"]),
    ]);
    expect(bucket?.expression.groups).toEqual([
      {
        match: "all",
        clauses: [
          clause("L", "contains", ["DONE"]),
          clause("M", "notContains", ["NO ACTION", "EMPTY", "NEXT VERIFICATION ON"]),
        ],
      },
      {
        match: "all",
        clauses: [clause("L", "contains", ["CHECK"]), clause("M", "contains", ["NOT FOUND"])],
      },
    ]);
    expect(AUDIT_EXCLUDE_STATUS).toHaveLength(14);
  });

  it("reproduces the legacy ready to upload rule", () => {
    const conditions = defaultConditionsFor("ready-to-upload");
    const [ready, review] = conditions.buckets;

    expect(conditions.buckets.map((item) => item.bucketKey)).toEqual(["ready", "review"]);
    expect(ready?.catchAll).toBe(false);
    expect(ready?.expression.filters).toEqual([
      clause("L", "contains", ["DONE"]),
      clause("uploadStatus", "notContains", ["UPLOADED", "DONE BY DR", "DONE BY DIVA"]),
      clause("uploadStatus", "contains", ["EMPTY"]),
      clause("updateStatus", "contains", ["DONE", "NOT FOUND"]),
    ]);
    expect(ready?.expression.groups).toEqual([]);
    expect(review?.expression.filters).toEqual([
      clause("L", "contains", ["DONE"]),
      clause("uploadStatus", "notContains", ["UPLOADED", "DONE BY DR", "DONE BY DIVA", "EMPTY"]),
    ]);
  });

  it("rejects report types without conditions", () => {
    expect(() => defaultConditionsFor("pending-execution")).toThrow(/pending-execution/);
  });
});

describe("evaluateConditionSet with the pending audit defaults", () => {
  const conditions = defaultConditionsFor("pending-audit");

  const cases: Array<{
    name: string;
    row: RowValues;
    filter: "all" | "fbd" | "elg";
    expected: string | null;
  }> = [
    {
      name: "keeps a done row whose upload status is EMPTY",
      row: { l: "DONE", updateStatus: "IN PROGRESS", uploadStatus: "EMPTY" },
      filter: "all",
      expected: "audit",
    },
    {
      name: "keeps the L CHECK plus M NOT FOUND branch",
      row: { l: "CHECK", m: "NOT FOUND", updateStatus: "WAITING", uploadStatus: "UNCHECKED" },
      filter: "all",
      expected: "audit",
    },
    {
      name: "keeps rows regardless of the verification value when no filter is set",
      row: {
        l: "DONE",
        verification: "MEDICAL PLAN",
        updateStatus: "WAITING",
        uploadStatus: "EMPTY",
      },
      filter: "all",
      expected: "audit",
    },
    {
      name: "matches the verification type by contains when a filter is set",
      row: { l: "DONE", verification: "FBD EXTRA", updateStatus: "WAITING", uploadStatus: "EMPTY" },
      filter: "fbd",
      expected: "audit",
    },
    {
      name: "drops a row whose verification type does not match the filter",
      row: { l: "DONE", verification: "ELG", updateStatus: "WAITING", uploadStatus: "EMPTY" },
      filter: "fbd",
      expected: null,
    },
    {
      name: "drops a done row whose column M is excluded",
      row: {
        l: "DONE",
        m: "NO ACTION | 01/01/2025",
        updateStatus: "WAITING",
        uploadStatus: "EMPTY",
      },
      filter: "all",
      expected: null,
    },
    {
      name: "drops a done row whose column M is EMPTY",
      row: { l: "DONE", m: "EMPTY", updateStatus: "WAITING", uploadStatus: "EMPTY" },
      filter: "all",
      expected: null,
    },
    {
      name: "drops a row whose L and M match no group",
      row: { l: "WAITING", m: "NOT FOUND", updateStatus: "WAITING", uploadStatus: "EMPTY" },
      filter: "all",
      expected: null,
    },
    {
      name: "drops an excluded update status",
      row: { l: "DONE", updateStatus: "DONE", uploadStatus: "EMPTY" },
      filter: "all",
      expected: null,
    },
    {
      name: "only excludes an update status on an exact match",
      row: { l: "DONE", updateStatus: "DONE BY DR", uploadStatus: "EMPTY" },
      filter: "all",
      expected: "audit",
    },
    {
      name: "drops an upload status outside the allowed list",
      row: { l: "DONE", updateStatus: "WAITING", uploadStatus: "CHECK" },
      filter: "all",
      expected: null,
    },
  ];

  it.each(cases)("$name", ({ row, filter, expected }) => {
    expect(
      evaluateConditionSet(sheetRow(row), COLUMNS, conditions, verificationFilters(filter))
    ).toBe(expected);
  });

  it("drops rows that do not reach the mapped columns", () => {
    const shortRow = Array.from({ length: COLUMNS.uploadStatus }, () => "DONE");
    expect(evaluateConditionSet(shortRow, COLUMNS, conditions)).toBeNull();
  });
});

describe("evaluateConditionSet with the ready to upload defaults", () => {
  const conditions = defaultConditionsFor("ready-to-upload");

  const cases: Array<{ name: string; row: RowValues; expected: string | null }> = [
    {
      name: "marks a DONE/DONE/EMPTY row ready",
      row: { l: "DONE", updateStatus: "DONE", uploadStatus: "EMPTY" },
      expected: "ready",
    },
    {
      name: "marks an EMPTY row ready when the update status is NOT FOUND",
      row: { l: "DONE", updateStatus: "NOT FOUND", uploadStatus: "EMPTY" },
      expected: "ready",
    },
    {
      name: "sends another upload status to review",
      row: { l: "DONE", updateStatus: "DONE", uploadStatus: "UPLOAD INCOMPLETE" },
      expected: "review",
    },
    {
      name: "sends a row with an empty upload cell to review",
      row: { l: "DONE", updateStatus: "WAITING", uploadStatus: "" },
      expected: "review",
    },
    {
      name: "drops an EMPTY row whose update status is not accepted",
      row: { l: "DONE", updateStatus: "WAITING", uploadStatus: "EMPTY" },
      expected: null,
    },
    {
      name: "drops a terminal upload status before ready and review",
      row: { l: "DONE", updateStatus: "DONE", uploadStatus: "UPLOADED" },
      expected: null,
    },
    {
      name: "drops NOT UPLOADED as terminal",
      row: { l: "DONE", updateStatus: "DONE", uploadStatus: "NOT UPLOADED" },
      expected: null,
    },
    {
      name: "drops rows where column L is not done",
      row: { l: "CHECK", updateStatus: "DONE", uploadStatus: "EMPTY" },
      expected: null,
    },
  ];

  it.each(cases)("$name", ({ row, expected }) => {
    expect(evaluateConditionSet(sheetRow(row), COLUMNS, conditions)).toBe(expected);
  });

  it("drops rows that do not reach the mapped columns", () => {
    const shortRow = Array.from({ length: COLUMNS.uploadStatus }, () => "DONE");
    expect(evaluateConditionSet(shortRow, COLUMNS, conditions)).toBeNull();
  });

  it("assigns a row to the first matching bucket", () => {
    const set: ReportConditionSet = {
      buckets: [
        { bucketKey: "ready", catchAll: false, expression: { filters: [], groups: [] } },
        {
          bucketKey: "review",
          catchAll: false,
          expression: { filters: [clause("L", "contains", ["DONE"])], groups: [] },
        },
      ],
    };
    expect(evaluateConditionSet(sheetRow({ l: "DONE" }), COLUMNS, set)).toBe("ready");
  });

  it("leaves catch all buckets out of the row length check", () => {
    const set: ReportConditionSet = {
      buckets: [
        { bucketKey: "ready", catchAll: false, expression: { filters: [], groups: [] } },
        { bucketKey: "review", catchAll: true, expression: { filters: [], groups: [] } },
      ],
    };
    // Catch all adds no column of its own, so a row without any of the columns
    // the other buckets read still matches it.
    expect(evaluateConditionSet(["", ""], COLUMNS, set)).toBe("ready");
  });

  it("drops a short row even when a later bucket catches all", () => {
    const set: ReportConditionSet = {
      buckets: [
        {
          bucketKey: "ready",
          catchAll: false,
          expression: { filters: [clause("L", "contains", ["DONE"])], groups: [] },
        },
        { bucketKey: "review", catchAll: true, expression: { filters: [], groups: [] } },
      ],
    };
    // The row does not reach column L, so it is dropped before any bucket is
    // evaluated. The legacy ready report behaved the same way.
    expect(evaluateConditionSet(["", ""], COLUMNS, set)).toBeNull();
  });
});

describe("operators", () => {
  const COLUMN_ROWS: Record<ConditionClause["column"], (cell: string) => RowValues> = {
    L: (cell) => ({ l: cell }),
    M: (cell) => ({ m: cell }),
    updateStatus: (cell) => ({ updateStatus: cell }),
    uploadStatus: (cell) => ({ uploadStatus: cell }),
    verificationType: (cell) => ({ verification: cell }),
    fileUrl: (cell) => ({ fileUrl: cell }),
  };

  function evaluateOperator(
    operator: ConditionClause["operator"],
    values: string[],
    cell: string,
    column: ConditionClause["column"] = "L"
  ) {
    return evaluateConditionSet(
      sheetRow(COLUMN_ROWS[column](cell)),
      COLUMNS,
      singleBucket({ filters: [clause(column, operator, values)], groups: [] })
    );
  }

  it.each([
    {
      name: "contains matches text inside the cell",
      operator: "contains" as const,
      values: ["DONE"],
      cell: "NOT DONE YET",
      expected: "audit",
    },
    {
      name: "contains normalizes case and spaces",
      operator: "contains" as const,
      values: ["DONE"],
      cell: " done ",
      expected: "audit",
    },
    {
      name: "contains takes any of the values",
      operator: "contains" as const,
      values: ["CHECK", "DONE"],
      cell: "DONE BY DR",
      expected: "audit",
    },
    {
      name: "contains with no values never matches",
      operator: "contains" as const,
      values: [],
      cell: "DONE",
      expected: null,
    },
    {
      name: "notContains negates the value list",
      operator: "notContains" as const,
      values: ["DONE"],
      cell: "CHECK",
      expected: "audit",
    },
    {
      name: "notContains with no values matches",
      operator: "notContains" as const,
      values: [],
      cell: "DONE",
      expected: "audit",
    },
    {
      name: "equals matches the whole cell",
      operator: "equals" as const,
      values: ["DONE"],
      cell: "DONE",
      expected: "audit",
    },
    {
      name: "equals does not match text inside the cell",
      operator: "equals" as const,
      values: ["DONE"],
      cell: "DONE BY DR",
      expected: null,
    },
    {
      name: "equals takes any of the values",
      operator: "equals" as const,
      values: ["EMPTY", "UNCHECKED"],
      cell: "UNCHECKED",
      expected: "audit",
    },
    {
      name: "notEquals rejects a listed value",
      operator: "notEquals" as const,
      values: ["DONE"],
      cell: "DONE",
      expected: null,
    },
    {
      name: "notEquals accepts an unlisted value",
      operator: "notEquals" as const,
      values: ["DONE"],
      cell: "DONE BY DR",
      expected: "audit",
    },
    {
      name: "isEmpty matches an empty cell",
      operator: "isEmpty" as const,
      values: [],
      cell: "",
      expected: "audit",
    },
    {
      name: "isEmpty ignores whitespace and case only",
      operator: "isEmpty" as const,
      values: [],
      cell: "  ",
      expected: "audit",
    },
    {
      name: "isEmpty rejects a filled cell",
      operator: "isEmpty" as const,
      values: [],
      cell: "DONE",
      expected: null,
    },
    {
      name: "isNotEmpty matches a filled cell",
      operator: "isNotEmpty" as const,
      values: [],
      cell: "DONE",
      expected: "audit",
    },
    {
      name: "isNotEmpty rejects an empty cell",
      operator: "isNotEmpty" as const,
      values: [],
      cell: "",
      expected: null,
    },
  ])("$name", ({ operator, values, cell, expected }) => {
    expect(evaluateOperator(operator, values, cell)).toBe(expected);
  });

  it("can read a clinic mapped column", () => {
    expect(evaluateOperator("equals", ["0"], "0", "fileUrl")).toBe("audit");
  });
});

describe("expressions", () => {
  it("requires every filter and then one group", () => {
    const set = singleBucket({
      filters: [clause("L", "contains", ["DONE"])],
      groups: [
        { match: "all", clauses: [clause("M", "contains", ["NOT FOUND"])] },
        { match: "all", clauses: [clause("M", "contains", ["NO ACTION"])] },
      ],
    });

    expect(evaluateConditionSet(sheetRow({ l: "DONE", m: "NOT FOUND" }), COLUMNS, set)).toBe(
      "audit"
    );
    expect(evaluateConditionSet(sheetRow({ l: "DONE", m: "NO ACTION" }), COLUMNS, set)).toBe(
      "audit"
    );
    expect(evaluateConditionSet(sheetRow({ l: "DONE", m: "OTHER" }), COLUMNS, set)).toBeNull();
    expect(evaluateConditionSet(sheetRow({ l: "CHECK", m: "NOT FOUND" }), COLUMNS, set)).toBeNull();
  });

  it("matches every clause of an all group and any clause of an any group", () => {
    const allGroup = singleBucket({
      filters: [],
      groups: [
        {
          match: "all",
          clauses: [clause("L", "contains", ["DONE"]), clause("M", "contains", ["NOT FOUND"])],
        },
      ],
    });
    expect(evaluateConditionSet(sheetRow({ l: "DONE", m: "NOT FOUND" }), COLUMNS, allGroup)).toBe(
      "audit"
    );
    expect(evaluateConditionSet(sheetRow({ l: "DONE", m: "OTHER" }), COLUMNS, allGroup)).toBeNull();

    const anyGroup = singleBucket({
      filters: [],
      groups: [
        {
          match: "any",
          clauses: [clause("L", "contains", ["DONE"]), clause("M", "contains", ["NOT FOUND"])],
        },
      ],
    });
    expect(evaluateConditionSet(sheetRow({ l: "DONE", m: "OTHER" }), COLUMNS, anyGroup)).toBe(
      "audit"
    );
    expect(
      evaluateConditionSet(sheetRow({ l: "CHECK", m: "OTHER" }), COLUMNS, anyGroup)
    ).toBeNull();
  });

  it("matches everything with no filters and no groups", () => {
    const set = singleBucket({ filters: [], groups: [] });
    expect(evaluateConditionSet(sheetRow({}), COLUMNS, set)).toBe("audit");
  });

  it("moves on to the next bucket when a filter fails", () => {
    const set: ReportConditionSet = {
      buckets: [
        {
          bucketKey: "ready",
          catchAll: false,
          expression: { filters: [clause("updateStatus", "contains", ["DONE"])], groups: [] },
        },
        { bucketKey: "review", catchAll: true, expression: { filters: [], groups: [] } },
      ],
    };
    expect(evaluateConditionSet(sheetRow({ updateStatus: "WAITING" }), COLUMNS, set)).toBe(
      "review"
    );
  });

  it("treats an empty group as always matching with all and never with any", () => {
    const emptyAll = singleBucket({
      filters: [],
      groups: [{ match: "all", clauses: [] }],
    });
    expect(evaluateConditionSet(sheetRow({}), COLUMNS, emptyAll)).toBe("audit");

    const emptyAny = singleBucket({
      filters: [],
      groups: [{ match: "any", clauses: [] }],
    });
    expect(evaluateConditionSet(sheetRow({}), COLUMNS, emptyAny)).toBeNull();
  });

  it("matches every row when an empty all group sits beside populated groups", () => {
    const set = singleBucket({
      filters: [],
      groups: [
        { match: "all", clauses: [clause("L", "contains", ["DONE"])] },
        { match: "all", clauses: [] },
      ],
    });
    expect(evaluateConditionSet(sheetRow({ l: "CHECK" }), COLUMNS, set)).toBe("audit");
  });

  it("keeps an empty any group from matching on its own", () => {
    const set = singleBucket({
      filters: [],
      groups: [
        { match: "any", clauses: [] },
        { match: "all", clauses: [clause("L", "contains", ["DONE"])] },
      ],
    });
    expect(evaluateConditionSet(sheetRow({ l: "CHECK" }), COLUMNS, set)).toBeNull();
    expect(evaluateConditionSet(sheetRow({ l: "DONE" }), COLUMNS, set)).toBe("audit");
  });

  it("applies extra filters to every bucket, including catch all", () => {
    const set: ReportConditionSet = {
      buckets: [
        { bucketKey: "ready", catchAll: false, expression: { filters: [], groups: [] } },
        { bucketKey: "review", catchAll: true, expression: { filters: [], groups: [] } },
      ],
    };
    const filters = verificationFilters("fbd");

    expect(evaluateConditionSet(sheetRow({ verification: "FBD" }), COLUMNS, set, filters)).toBe(
      "ready"
    );
    expect(
      evaluateConditionSet(sheetRow({ verification: "ELG" }), COLUMNS, set, filters)
    ).toBeNull();
  });

  it("requires the columns of the extra filters to exist", () => {
    const set = singleBucket({ filters: [], groups: [] });
    const shortRow = Array.from({ length: COLUMNS.verificationType }, () => "FBD");
    expect(evaluateConditionSet(shortRow, COLUMNS, set, verificationFilters("fbd"))).toBeNull();
  });
});

describe("cleanConditionSet", () => {
  it("trims, uppercases, and dedupes values in every clause", () => {
    const cleaned = cleanConditionSet(
      singleBucket({
        filters: [clause("updateStatus", "notEquals", [" done ", "DONE", ""])],
        groups: [
          { match: "any", clauses: [clause("M", "contains", [" not found ", "NOT FOUND"])] },
        ],
      })
    );

    expect(cleaned.buckets[0]?.expression.filters[0]?.values).toEqual(["DONE"]);
    expect(cleaned.buckets[0]?.expression.groups[0]?.clauses[0]?.values).toEqual(["NOT FOUND"]);
  });

  it("truncates long values and caps the count per clause", () => {
    const long = "x".repeat(MAX_MARKER_LENGTH + 10);
    const many = Array.from({ length: MAX_MARKERS_PER_RULE + 5 }, (_, index) => `marker ${index}`);
    const cleaned = cleanConditionSet(
      singleBucket({ filters: [clause("L", "contains", [long, ...many])], groups: [] })
    );

    const values = cleaned.buckets[0]?.expression.filters[0]?.values ?? [];
    expect(values).toHaveLength(MAX_MARKERS_PER_RULE);
    expect(values[0]).toBe("X".repeat(MAX_MARKER_LENGTH));
    expect(values[1]).toBe("MARKER 0");
  });

  it("caps the number of conditions and groups", () => {
    const filters = Array.from({ length: MAX_CLAUSES_PER_SECTION + 5 }, () =>
      clause("L", "contains", ["DONE"])
    );
    const groups = Array.from({ length: MAX_GROUPS_PER_EXPRESSION + 5 }, () => ({
      match: "all" as const,
      clauses: Array.from({ length: MAX_CLAUSES_PER_SECTION + 5 }, () =>
        clause("M", "contains", ["NOT FOUND"])
      ),
    }));

    const cleaned = cleanConditionSet(singleBucket({ filters, groups }));
    expect(cleaned.buckets[0]?.expression.filters).toHaveLength(MAX_CLAUSES_PER_SECTION);
    expect(cleaned.buckets[0]?.expression.groups).toHaveLength(MAX_GROUPS_PER_EXPRESSION);
    expect(cleaned.buckets[0]?.expression.groups[0]?.clauses).toHaveLength(MAX_CLAUSES_PER_SECTION);
  });

  it("keeps catch all only on the last bucket of a multi-bucket set", () => {
    const cleaned = cleanConditionSet({
      buckets: [
        { bucketKey: "ready", catchAll: true, expression: { filters: [], groups: [] } },
        { bucketKey: "review", catchAll: true, expression: { filters: [], groups: [] } },
      ],
    });
    expect(cleaned.buckets.map((bucket) => bucket.catchAll)).toEqual([false, true]);

    const single = cleanConditionSet(singleBucket({ filters: [], groups: [] }, true));
    expect(single.buckets[0]?.catchAll).toBe(false);
  });
});

describe("assertBucketKeys", () => {
  it("accepts the catalog buckets and rejects anything else", () => {
    expect(() =>
      assertBucketKeys(
        defaultConditionsFor("ready-to-upload"),
        bucketKeysFor("ready-to-upload"),
        "ready-to-upload"
      )
    ).not.toThrow();
    expect(() =>
      assertBucketKeys(
        defaultConditionsFor("ready-to-upload"),
        bucketKeysFor("pending-audit"),
        "ready-to-upload"
      )
    ).toThrow();
    expect(() =>
      assertBucketKeys(
        defaultConditionsFor("pending-audit"),
        bucketKeysFor("ready-to-upload"),
        "ready-to-upload"
      )
    ).toThrow();
  });

  it("rejects unknown, repeated, or reordered buckets", () => {
    const buckets = defaultConditionsFor("ready-to-upload").buckets;
    const expected = bucketKeysFor("ready-to-upload");
    expect(() =>
      assertBucketKeys({ buckets: [...buckets].reverse() }, expected, "ready-to-upload")
    ).toThrow();
    expect(() =>
      assertBucketKeys({ buckets: [...buckets, buckets[0]!] }, expected, "ready-to-upload")
    ).toThrow();
  });
});

describe("bucketCatalogFor", () => {
  it("marks the last bucket of a multi-bucket report as catch all capable", () => {
    expect(bucketCatalogFor("pending-audit")).toEqual([
      { key: "audit", label: "Pending audit", canCatchAll: false },
    ]);
    expect(bucketCatalogFor("ready-to-upload")).toEqual([
      { key: "ready", label: "Ready to upload", canCatchAll: false },
      { key: "review", label: "Needs review", canCatchAll: true },
    ]);
  });
});

describe("isImplementedOperation", () => {
  it("knows which report types have conditions", () => {
    expect(isImplementedOperation("pending-audit")).toBe(true);
    expect(isImplementedOperation("ready-to-upload")).toBe(true);
    expect(isImplementedOperation("pending-execution")).toBe(false);
  });
});

type ConditionRow = {
  userId: string;
  operationKey: string;
  clinicId: Id<"clinics"> | null;
  conditions: ReportConditionSet;
};

type IndexQuery = {
  eq: (field: string, value: unknown) => IndexQuery;
  [Symbol.asyncIterator]: () => AsyncIterator<ConditionRow>;
};

// Minimal stand-in for the Convex query builder. The resolver only calls
// eq().eq() and then iterates the result, and the tests hand it the rows of one
// user and operation.
function fakeCtx(rows: ConditionRow[]): QueryCtx {
  const query: IndexQuery = {
    eq: () => query,
    async *[Symbol.asyncIterator]() {
      for (const row of rows) yield row;
    },
  };
  return {
    db: {
      query: () => ({
        withIndex: (_index: string, range: (q: IndexQuery) => unknown) => {
          range(query);
          return query;
        },
      }),
    },
  } as unknown as QueryCtx;
}

describe("resolveConditionsForClinics", () => {
  const userId = "user-1" as Id<"users">;
  const clinicId = "clinic-1" as Id<"clinics">;

  it("falls back to the code default when nothing is stored", async () => {
    const resolved = await resolveConditionsForClinics(fakeCtx([]), userId, "pending-audit");

    expect(resolved.defaultIsCustom).toBe(false);
    expect(resolved.defaultConditions).toEqual(defaultConditionsFor("pending-audit"));
    expect(resolved.byClinicId.size).toBe(0);
  });

  it("returns the stored default and the clinic override", async () => {
    const customDefault = defaultConditionsFor("pending-audit");
    const override: ReportConditionSet = {
      buckets: [
        {
          ...customDefault.buckets[0]!,
          expression: { filters: [], groups: [] },
        },
      ],
    };
    const resolved = await resolveConditionsForClinics(
      fakeCtx([
        { userId, operationKey: "pending-audit", clinicId: null, conditions: customDefault },
        { userId, operationKey: "pending-audit", clinicId, conditions: override },
      ]),
      userId,
      "pending-audit"
    );

    expect(resolved.defaultIsCustom).toBe(true);
    expect(resolved.defaultConditions).toEqual(customDefault);
    expect(resolved.byClinicId.get(clinicId)).toEqual(override);
  });

  it("considers every stored row, past any fixed cap", async () => {
    const rows: ConditionRow[] = Array.from({ length: 600 }, (_, index) => ({
      userId,
      operationKey: "pending-audit",
      clinicId: `clinic-${index}` as Id<"clinics">,
      conditions: defaultConditionsFor("pending-audit"),
    }));
    const lastClinicId = "clinic-599" as Id<"clinics">;

    const resolved = await resolveConditionsForClinics(fakeCtx(rows), userId, "pending-audit");

    expect(resolved.byClinicId.size).toBe(600);
    expect(resolved.byClinicId.get(lastClinicId)).toBeDefined();
  });

  it("skips a stored row whose buckets do not match the catalog", async () => {
    const resolved = await resolveConditionsForClinics(
      fakeCtx([
        {
          userId,
          operationKey: "pending-audit",
          clinicId: null,
          conditions: defaultConditionsFor("ready-to-upload"),
        },
      ]),
      userId,
      "pending-audit"
    );

    expect(resolved.defaultIsCustom).toBe(false);
    expect(resolved.defaultConditions).toEqual(defaultConditionsFor("pending-audit"));
  });
});

describe("editor helpers", () => {
  it("normalizes markers like the backend does", () => {
    expect(normalizeMarker("  done  ")).toBe("DONE");
    expect(normalizeMarker("x".repeat(MAX_MARKER_LENGTH + 5))).toBe("X".repeat(MAX_MARKER_LENGTH));
    expect(normalizeMarker("   ")).toBe("");
  });

  it("knows which operators need values", () => {
    expect(operatorNeedsValues("contains")).toBe(true);
    expect(operatorNeedsValues("notEquals")).toBe(true);
    expect(operatorNeedsValues("isEmpty")).toBe(false);
    expect(operatorNeedsValues("isNotEmpty")).toBe(false);
  });

  it("knows which operators are negated", () => {
    expect(operatorIsNegated("notContains")).toBe(true);
    expect(operatorIsNegated("notEquals")).toBe(true);
    expect(operatorIsNegated("contains")).toBe(false);
    expect(operatorIsNegated("isEmpty")).toBe(false);
  });

  it("flags expressions without clauses", () => {
    expect(expressionHasNoClauses({ filters: [], groups: [] })).toBe(true);
    expect(expressionHasNoClauses({ filters: [], groups: [{ match: "all", clauses: [] }] })).toBe(
      true
    );
    expect(
      expressionHasNoClauses({
        filters: [],
        groups: [{ match: "all", clauses: [clause("L", "contains", ["DONE"])] }],
      })
    ).toBe(false);
    expect(
      expressionHasNoClauses({ filters: [clause("L", "contains", ["DONE"])], groups: [] })
    ).toBe(false);
  });

  it("flags an empty all group even beside populated groups", () => {
    expect(
      expressionHasNoClauses({
        filters: [],
        groups: [
          { match: "all", clauses: [clause("L", "contains", ["DONE"])] },
          { match: "all", clauses: [] },
        ],
      })
    ).toBe(true);
  });

  it("does not flag an empty any group as matching everything", () => {
    expect(expressionHasNoClauses({ filters: [], groups: [{ match: "any", clauses: [] }] })).toBe(
      false
    );
    expect(
      expressionHasNoClauses({
        filters: [],
        groups: [
          { match: "any", clauses: [] },
          { match: "all", clauses: [clause("L", "contains", ["DONE"])] },
        ],
      })
    ).toBe(false);
  });
});

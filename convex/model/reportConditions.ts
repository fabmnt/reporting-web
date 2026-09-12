import { ConvexError, v } from "convex/values";
import type { Infer } from "convex/values";

import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import type { ReportOperationKey } from "./reportOperations";

type SheetRow = string[];

function cell(row: SheetRow, index: number): string {
  return (row[index] ?? "").toUpperCase().trim();
}

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

// Columns a condition can read. L (execution) and M (message) are fixed
// positions in every sheet; the rest come from the clinic's sheetColumns
// mapping, so the stored conditions stay portable between clinics.
export const conditionColumn = v.union(
  v.literal("L"),
  v.literal("M"),
  v.literal("updateStatus"),
  v.literal("uploadStatus"),
  v.literal("verificationType"),
  v.literal("fileUrl")
);
export type ConditionColumn = Infer<typeof conditionColumn>;

// `contains` / `notContains` work on the text inside the cell, `equals` /
// `notEquals` on the whole cell, and the empty operators ignore `values`.
// Several values in one clause are an OR; the negated operators negate that OR.
export const conditionOperator = v.union(
  v.literal("contains"),
  v.literal("notContains"),
  v.literal("equals"),
  v.literal("notEquals"),
  v.literal("isEmpty"),
  v.literal("isNotEmpty")
);
export type ConditionOperator = Infer<typeof conditionOperator>;

const conditionClause = v.object({
  column: conditionColumn,
  operator: conditionOperator,
  values: v.array(v.string()),
});

const conditionGroup = v.object({
  match: v.union(v.literal("all"), v.literal("any")),
  clauses: v.array(conditionClause),
});

const conditionExpression = v.object({
  // Every filter must match. An empty list matches everything.
  filters: v.array(conditionClause),
  // At least one group must match. An empty list matches everything, an empty
  // group matches with "all" and never with "any".
  groups: v.array(conditionGroup),
});

const conditionBucket = v.object({
  bucketKey: v.string(),
  // Ignores the expression and takes every row no earlier bucket took.
  catchAll: v.boolean(),
  expression: conditionExpression,
});

export const reportConditionSet = v.object({ buckets: v.array(conditionBucket) });

export type ConditionClause = Infer<typeof conditionClause>;
export type ConditionGroup = Infer<typeof conditionGroup>;
export type ConditionExpression = Infer<typeof conditionExpression>;
export type ConditionBucket = Infer<typeof conditionBucket>;
export type ReportConditionSet = Infer<typeof reportConditionSet>;

// ---------------------------------------------------------------------------
// Buckets
// ---------------------------------------------------------------------------

// Operations whose row rules are configurable. The other report types in
// `reportOperationKey` do not have conditions yet.
export const IMPLEMENTED_REPORT_OPERATIONS = ["pending-audit", "ready-to-upload"] as const;
export type ImplementedOperationKey = (typeof IMPLEMENTED_REPORT_OPERATIONS)[number];

export function isImplementedOperation(key: string): key is ImplementedOperationKey {
  return (IMPLEMENTED_REPORT_OPERATIONS as readonly string[]).includes(key);
}

// Each report type owns its buckets in code; users edit the expression of each
// one. Rows land in the first bucket that matches, in this order.
export const REPORT_BUCKETS: Record<
  ImplementedOperationKey,
  ReadonlyArray<{ key: string; label: string }>
> = {
  "pending-audit": [{ key: "audit", label: "Pending audit" }],
  "ready-to-upload": [
    { key: "ready", label: "Ready to upload" },
    { key: "review", label: "Needs review" },
  ],
};

// ---------------------------------------------------------------------------
// Defaults (legacy parity)
// ---------------------------------------------------------------------------

// Old tool rule (get_rows_pending_to_audit_conditions), non-view branch. An
// update status equal to one of these means the row already has an answer.
export const AUDIT_EXCLUDE_STATUS = [
  "DONE",
  "MEDICAL PLAN",
  "UNKNOWN",
  "NOT FOUND",
  "INCIDENCE",
  "NO DENTAL COVERAGE",
  "NOT ELIGIBLE FOR DENTAL BENEFITS",
  "NO PROVIDER",
  "CHECK THAT THERE IS NO TITLE FOR THIS LOCATION",
  "CHECK THERE IS NO TITLE FOR THIS OFFICE BUT PATIENT IS ACTIVE",
  "CHECK THERE IS NO TITLE FOR THIS OFFICE BUT PATIENT IS INACTIVE",
  "CHECK THERE IS NO TITLE FOR THIS OFFICE",
  "WFL",
  "REVIEWED BY QA",
];

// Old tool rule (get_rows_ready_to_upload_ts). Terminal upload statuses never
// need action again, so they leave the report completely.
const TERMINAL_UPLOAD_STATUS = ["UPLOADED", "DONE BY DR", "DONE BY DIVA"];

// The conditions that reproduce the hardcoded rules. Built fresh on every call
// so callers can edit the result without touching each other.
export function defaultConditionsFor(operationKey: ReportOperationKey): ReportConditionSet {
  if (operationKey === "pending-audit") {
    return {
      buckets: [
        {
          bucketKey: "audit",
          catchAll: false,
          expression: {
            filters: [
              { column: "updateStatus", operator: "notEquals", values: [...AUDIT_EXCLUDE_STATUS] },
              { column: "uploadStatus", operator: "equals", values: ["EMPTY", "UNCHECKED"] },
            ],
            // The legacy DONE + TERMED option is already covered by the first
            // group, because TERMED is not an excluded M marker.
            groups: [
              {
                match: "all",
                clauses: [
                  { column: "L", operator: "contains", values: ["DONE"] },
                  {
                    column: "M",
                    operator: "notContains",
                    values: ["NO ACTION", "EMPTY", "NEXT VERIFICATION ON"],
                  },
                ],
              },
              {
                match: "all",
                clauses: [
                  { column: "L", operator: "contains", values: ["CHECK"] },
                  { column: "M", operator: "contains", values: ["NOT FOUND"] },
                ],
              },
            ],
          },
        },
      ],
    };
  }
  if (operationKey === "ready-to-upload") {
    return {
      buckets: [
        {
          bucketKey: "ready",
          catchAll: false,
          expression: {
            filters: [
              { column: "L", operator: "contains", values: ["DONE"] },
              {
                column: "uploadStatus",
                operator: "notContains",
                values: [...TERMINAL_UPLOAD_STATUS],
              },
              { column: "uploadStatus", operator: "contains", values: ["EMPTY"] },
              { column: "updateStatus", operator: "contains", values: ["DONE", "NOT FOUND"] },
            ],
            groups: [],
          },
        },
        {
          // The legacy rule drops rows with an empty upload status whose update
          // status is not accepted, and rows with a terminal upload status,
          // instead of sending them to review. The clauses below repeat those
          // two exclusions so the default keeps behaving the same way. Catch
          // all stays available for users who prefer the plain fallthrough.
          bucketKey: "review",
          catchAll: false,
          expression: {
            filters: [
              { column: "L", operator: "contains", values: ["DONE"] },
              {
                column: "uploadStatus",
                operator: "notContains",
                values: [...TERMINAL_UPLOAD_STATUS, "EMPTY"],
              },
            ],
            groups: [],
          },
        },
      ],
    };
  }
  throw new ConvexError({
    code: "INVALID_OPERATION",
    message: `No conditions are defined for "${operationKey}" yet.`,
  });
}

export type BucketDefinition = { key: string; label: string };

// Only the last bucket of a multi-bucket report can catch all rows no earlier
// bucket took.
export function bucketCatalog(
  definitions: ReadonlyArray<BucketDefinition>
): Array<{ key: string; label: string; canCatchAll: boolean }> {
  return definitions.map((bucket, index) => ({
    key: bucket.key,
    label: bucket.label,
    canCatchAll: definitions.length > 1 && index === definitions.length - 1,
  }));
}

// What the config UI needs to render the bucket picker of a built-in report.
export function bucketCatalogFor(operationKey: ImplementedOperationKey): Array<{
  key: string;
  label: string;
  canCatchAll: boolean;
}> {
  return bucketCatalog(REPORT_BUCKETS[operationKey]);
}

export function bucketKeysFor(operationKey: ImplementedOperationKey): string[] {
  return REPORT_BUCKETS[operationKey].map((bucket) => bucket.key);
}

export function bucketKeysMatch(
  conditions: ReportConditionSet,
  expectedKeys: readonly string[]
): boolean {
  return (
    conditions.buckets.length === expectedKeys.length &&
    conditions.buckets.every((bucket, index) => bucket.bucketKey === expectedKeys[index])
  );
}

// A stored set is only usable by the bucket list it was written for, so a set
// that no longer matches is rejected instead of evaluated.
export function assertBucketKeys(
  conditions: ReportConditionSet,
  expectedKeys: readonly string[],
  scopeLabel: string
): void {
  if (!bucketKeysMatch(conditions, expectedKeys)) {
    throw new ConvexError({
      code: "INVALID_CONFIG",
      message: `Row groups for "${scopeLabel}" must be exactly ${expectedKeys.join(", ")}.`,
    });
  }
}

// ---------------------------------------------------------------------------
// Cleaning
// ---------------------------------------------------------------------------

export const MAX_MARKERS_PER_RULE = 50;
export const MAX_MARKER_LENGTH = 80;
export const MAX_CLAUSES_PER_SECTION = 25;
export const MAX_GROUPS_PER_EXPRESSION = 10;

function cleanMarkers(markers: string[]): string[] {
  const seen = new Set<string>();
  const cleaned: string[] = [];
  for (const marker of markers) {
    const value = marker.trim().toUpperCase().slice(0, MAX_MARKER_LENGTH);
    if (value === "" || seen.has(value)) continue;
    seen.add(value);
    cleaned.push(value);
    if (cleaned.length >= MAX_MARKERS_PER_RULE) break;
  }
  return cleaned;
}

function cleanClause(clause: ConditionClause): ConditionClause {
  return {
    column: clause.column,
    operator: clause.operator,
    values: cleanMarkers(clause.values),
  };
}

function cleanExpression(expression: ConditionExpression): ConditionExpression {
  return {
    filters: expression.filters.slice(0, MAX_CLAUSES_PER_SECTION).map(cleanClause),
    groups: expression.groups.slice(0, MAX_GROUPS_PER_EXPRESSION).map((group) => ({
      match: group.match,
      clauses: group.clauses.slice(0, MAX_CLAUSES_PER_SECTION).map(cleanClause),
    })),
  };
}

export function cleanConditionSet(conditions: ReportConditionSet): ReportConditionSet {
  return {
    buckets: conditions.buckets.map((bucket, index) => ({
      bucketKey: bucket.bucketKey.trim(),
      // Only the last bucket of a multi-bucket set can catch the rows no
      // earlier one took, so an earlier flag is dropped instead of trusted.
      catchAll:
        conditions.buckets.length > 1 && index === conditions.buckets.length - 1
          ? bucket.catchAll
          : false,
      expression: cleanExpression(bucket.expression),
    })),
  };
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

export type ResolvedConditions = {
  defaultConditions: ReportConditionSet;
  defaultIsCustom: boolean;
  byClinicId: Map<Id<"clinics">, ReportConditionSet>;
};

// Clinic override wins over the user default, the user default wins over the
// code default. Reads every row stored for the user and operation: unassigning
// a clinic does not remove its override, so a fixed cap could push the default
// or a real override out of the window.
export async function resolveConditionsForClinics(
  ctx: QueryCtx,
  userId: Id<"users">,
  operationKey: ImplementedOperationKey
): Promise<ResolvedConditions> {
  let defaultConditions: ReportConditionSet | null = null;
  const byClinicId = new Map<Id<"clinics">, ReportConditionSet>();

  for await (const row of ctx.db
    .query("reportConditions")
    .withIndex("by_userId_and_operationKey", (query) =>
      query.eq("userId", userId).eq("operationKey", operationKey)
    )) {
    if (!bucketKeysMatch(row.conditions, bucketKeysFor(operationKey))) continue;
    if (row.clinicId === null) defaultConditions = row.conditions;
    else byClinicId.set(row.clinicId, row.conditions);
  }

  return {
    defaultConditions: defaultConditions ?? defaultConditionsFor(operationKey),
    defaultIsCustom: defaultConditions !== null,
    byClinicId,
  };
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

// Column L holds the execution text and column M the message text in every
// clinic sheet.
export const EXECUTION_COLUMN_INDEX = 11;
export const MESSAGE_COLUMN_INDEX = 12;

export type ConditionColumnIndexes = Record<ConditionColumn, number>;

function clauseMatches(row: SheetRow, indexes: ConditionColumnIndexes, clause: ConditionClause) {
  const value = cell(row, indexes[clause.column]);
  switch (clause.operator) {
    case "contains":
      return clause.values.some((marker) => value.includes(marker));
    case "notContains":
      return !clause.values.some((marker) => value.includes(marker));
    case "equals":
      return clause.values.includes(value);
    case "notEquals":
      return !clause.values.includes(value);
    case "isEmpty":
      return value === "";
    case "isNotEmpty":
      return value !== "";
  }
}

function groupMatches(row: SheetRow, indexes: ConditionColumnIndexes, group: ConditionGroup) {
  if (group.clauses.length === 0) return group.match === "all";
  const matches = (clause: ConditionClause) => clauseMatches(row, indexes, clause);
  return group.match === "all" ? group.clauses.every(matches) : group.clauses.some(matches);
}

function expressionMatches(
  row: SheetRow,
  indexes: ConditionColumnIndexes,
  expression: ConditionExpression
) {
  if (!expression.filters.every((clause) => clauseMatches(row, indexes, clause))) return false;
  if (expression.groups.length === 0) return true;
  return expression.groups.some((group) => groupMatches(row, indexes, group));
}

// Rows that do not reach the highest column the conditions read are skipped:
// the legacy tool did the same, and a missing cell would otherwise look empty.
function shortestUsableLength(
  buckets: ConditionBucket[],
  extraFilters: ConditionClause[],
  indexes: ConditionColumnIndexes
): number {
  let highest = -1;
  const consider = (clause: ConditionClause) => {
    highest = Math.max(highest, indexes[clause.column]);
  };
  for (const bucket of buckets) {
    if (bucket.catchAll) continue;
    bucket.expression.filters.forEach(consider);
    for (const group of bucket.expression.groups) group.clauses.forEach(consider);
  }
  extraFilters.forEach(consider);
  return highest + 1;
}

/**
 * Returns the key of the first bucket that takes the row, or null when no
 * bucket does (the row is dropped). `extraFilters` narrow the whole set, for
 * example the verification type chosen in the report form.
 */
export function evaluateConditionSet(
  row: SheetRow,
  indexes: ConditionColumnIndexes,
  conditions: ReportConditionSet,
  extraFilters: ConditionClause[] = []
): string | null {
  if (row.length < shortestUsableLength(conditions.buckets, extraFilters, indexes)) return null;
  for (const bucket of conditions.buckets) {
    if (!extraFilters.every((clause) => clauseMatches(row, indexes, clause))) continue;
    if (bucket.catchAll) return bucket.bucketKey;
    if (expressionMatches(row, indexes, bucket.expression)) return bucket.bucketKey;
  }
  return null;
}

import { v } from "convex/values";
import type { Infer } from "convex/values";

import type { ResolvedClinicSheetColumns } from "./clinicSheetColumns";
import { CARRIER_COLUMN_INDEX } from "./executeRules";
import { columnLetterToIndex } from "./reporting";

type SheetRow = string[];

function cell(row: SheetRow, index: number): string {
  return (row[index] ?? "").toUpperCase().trim();
}

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

// Columns a condition can read. L (execution), M (message) and the carrier
// name are fixed positions in every sheet; the rest come from the clinic's
// sheetColumns mapping, so the stored conditions stay portable between clinics.
export const conditionColumn = v.union(
  v.literal("L"),
  v.literal("M"),
  v.literal("carrierName"),
  v.literal("updateStatus"),
  v.literal("uploadStatus"),
  v.literal("verificationType"),
  v.literal("fileUrl")
);
export type ConditionColumn = Infer<typeof conditionColumn>;

// `contains` / `notContains` work on the text inside the cell, `equals` /
// `notEquals` on the whole cell, and the empty operators ignore `values`.
// Several values in one clause are an OR; the negated operators negate that OR.
// Values are plain text: no operator reads them as a pattern, so these six are
// the whole vocabulary a rule can use.
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
// Evaluation
// ---------------------------------------------------------------------------

// The sheet column (0-based) behind a role. The rules decide which roles a
// report reads, so a clinic mapping is parsed the first time a role is asked
// for: a field no rule reads never has to resolve.
export type ConditionColumnResolver = (column: ConditionColumn) => number;

/**
 * Reads a clinic's sheet-column mapping. The roles the given rules and
 * run-level filters read resolve while this runs, so a mapping the report
 * cannot use is raised where the caller still handles that clinic on its own;
 * every other role resolves on its first read, and a role nothing reads never
 * reaches a sheet.
 */
export function conditionColumnResolver(
  columns: ResolvedClinicSheetColumns,
  buckets: ConditionBucket[],
  extraFilters: ConditionClause[] = []
): ConditionColumnResolver {
  // L, M and the carrier cell are the same cells in every sheet; every other
  // role points at the column the clinic mapped it to. The carrier cell is the
  // one the execute engine matches the clinic's bots against, so a condition on
  // it and that match read the same cell.
  const letters: Record<Exclude<ConditionColumn, "carrierName">, string> = {
    L: "L",
    M: "M",
    updateStatus: columns.updateStatus,
    uploadStatus: columns.uploadStatus,
    verificationType: columns.verificationType,
    fileUrl: columns.fileUrl,
  };
  const parsed = new Map<ConditionColumn, number>();
  const indexOf: ConditionColumnResolver = (column) => {
    const known = parsed.get(column);
    if (known !== undefined) return known;
    const index =
      column === "carrierName" ? CARRIER_COLUMN_INDEX : columnLetterToIndex(letters[column]);
    parsed.set(column, index);
    return index;
  };
  for (const column of conditionColumns(buckets, extraFilters)) indexOf(column);
  return indexOf;
}

function clauseMatches(row: SheetRow, indexes: ConditionColumnResolver, clause: ConditionClause) {
  const value = cell(row, indexes(clause.column));
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

function groupMatches(row: SheetRow, indexes: ConditionColumnResolver, group: ConditionGroup) {
  if (group.clauses.length === 0) return group.match === "all";
  const matches = (clause: ConditionClause) => clauseMatches(row, indexes, clause);
  return group.match === "all" ? group.clauses.every(matches) : group.clauses.some(matches);
}

function expressionMatches(
  row: SheetRow,
  indexes: ConditionColumnResolver,
  expression: ConditionExpression
) {
  if (!expression.filters.every((clause) => clauseMatches(row, indexes, clause))) return false;
  if (expression.groups.length === 0) return true;
  return expression.groups.some((group) => groupMatches(row, indexes, group));
}

// Columns an expression reads, in clause order and with repeats.
function expressionColumns(expression: ConditionExpression): ConditionColumn[] {
  const columns = expression.filters.map((clause) => clause.column);
  for (const group of expression.groups) {
    columns.push(...group.clauses.map((clause) => clause.column));
  }
  return columns;
}

// The roles a condition set reads: the clauses of every bucket that filters by
// itself, which leaves out a catch-all bucket (it takes the rows no earlier
// bucket took), plus the run-level filters that narrow the whole set.
export function conditionColumns(
  buckets: ConditionBucket[],
  extraFilters: ConditionClause[] = []
): ConditionColumn[] {
  const columns = new Set<ConditionColumn>(extraFilters.map((clause) => clause.column));
  for (const bucket of buckets) {
    if (bucket.catchAll) continue;
    for (const column of expressionColumns(bucket.expression)) columns.add(column);
  }
  return [...columns];
}

// Rows that do not reach the highest column the conditions read are skipped:
// the legacy tool did the same, and a missing cell would otherwise look empty.
function shortestUsableLength(
  buckets: ConditionBucket[],
  extraFilters: ConditionClause[],
  indexes: ConditionColumnResolver
): number {
  let highest = -1;
  for (const column of conditionColumns(buckets, extraFilters)) {
    highest = Math.max(highest, indexes(column));
  }
  return highest + 1;
}

/**
 * Sheet columns (0-based) that decided why a bucket holds its rows: the ones
 * its own conditions read plus the run-level filters, resolved through the
 * clinic mapping and sorted in sheet order. A catch-all bucket keeps the rows
 * no earlier bucket took, so the columns of those buckets are the ones that
 * filtered its rows.
 */
export function filterColumnsForBucket(
  buckets: ConditionBucket[],
  bucket: ConditionBucket,
  extraFilters: ConditionClause[],
  indexes: ConditionColumnResolver
): number[] {
  const sources = bucket.catchAll ? buckets.filter((item) => !item.catchAll) : [bucket];
  const columns = new Set<number>(extraFilters.map((clause) => indexes(clause.column)));
  for (const source of sources) {
    for (const column of expressionColumns(source.expression)) columns.add(indexes(column));
  }
  return [...columns].sort((left, right) => left - right);
}

/**
 * Returns the key of the first bucket that takes the row, or null when no
 * bucket does (the row is dropped). `extraFilters` narrow the whole set, for
 * example the verification type chosen in the report form.
 */
export function evaluateConditionSet(
  row: SheetRow,
  indexes: ConditionColumnResolver,
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

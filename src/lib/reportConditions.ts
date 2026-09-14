import {
  MAX_MARKER_LENGTH,
  type ConditionColumn,
  type ConditionExpression,
  type ConditionOperator,
} from "../../convex/model/reportConditions";

// Options of the condition editor, in the order they are offered. The labels
// live in the i18n catalog, keyed by these values.
export const CONDITION_COLUMNS: ReadonlyArray<ConditionColumn> = [
  "L",
  "M",
  "updateStatus",
  "uploadStatus",
  "verificationType",
  "fileUrl",
];

export const CONDITION_OPERATORS: ReadonlyArray<ConditionOperator> = [
  "contains",
  "notContains",
  "equals",
  "notEquals",
  "isEmpty",
  "isNotEmpty",
];

// Empty and non-empty operators read the whole cell, so values are ignored.
export function operatorNeedsValues(operator: ConditionOperator): boolean {
  return operator !== "isEmpty" && operator !== "isNotEmpty";
}

// Negated operators pass when the value list is empty, so the editor hints
// must say the opposite of the positive ones.
export function operatorIsNegated(operator: ConditionOperator): boolean {
  return operator === "notContains" || operator === "notEquals";
}

// Same shape the backend stores in `cleanMarkers`, so what is typed is what
// gets saved.
export function normalizeMarker(value: string): string {
  return value.trim().toUpperCase().slice(0, MAX_MARKER_LENGTH);
}

// An expression without clauses matches every row that reaches the bucket, so
// the editor warns about it. An empty "all" group matches on its own, even
// beside populated groups; an empty "any" group never matches.
export function expressionHasNoClauses(expression: ConditionExpression): boolean {
  if (expression.filters.length > 0) return false;
  if (expression.groups.length === 0) return true;
  return expression.groups.some((group) => group.match === "all" && group.clauses.length === 0);
}

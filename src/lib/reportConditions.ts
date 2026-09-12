import {
  MAX_MARKER_LENGTH,
  type ConditionColumn,
  type ConditionExpression,
  type ConditionOperator,
} from "../../convex/model/reportConditions";

export const CONDITION_COLUMN_ITEMS: ReadonlyArray<{ value: ConditionColumn; label: string }> = [
  { value: "L", label: "Execution (column L)" },
  { value: "M", label: "Message (column M)" },
  { value: "updateStatus", label: "Update status" },
  { value: "uploadStatus", label: "Upload status" },
  { value: "verificationType", label: "Verification type" },
  { value: "fileUrl", label: "File URL" },
];

export const CONDITION_OPERATOR_ITEMS: ReadonlyArray<{ value: ConditionOperator; label: string }> =
  [
    { value: "contains", label: "Contains any of" },
    { value: "notContains", label: "Does not contain any of" },
    { value: "equals", label: "Is one of" },
    { value: "notEquals", label: "Is not one of" },
    { value: "isEmpty", label: "Is empty" },
    { value: "isNotEmpty", label: "Is not empty" },
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
// the editor warns about it. An empty group counts only when it can match.
export function expressionHasNoClauses(expression: ConditionExpression): boolean {
  return (
    expression.filters.length === 0 &&
    expression.groups.every((group) => group.clauses.length === 0)
  );
}

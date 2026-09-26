// What the engines decide in code before they read a row's rules. The rules
// themselves live in the conditions of the report type, where the
// configuration panels edit them.

import type { ConditionClause } from "./reportConditions";

// Column B holds the carrier name in every clinic sheet, the same fixed
// position the old tool read.
export const CARRIER_COLUMN_INDEX = 1;

// The verification types a run asks for. `both` is the choice the old tool made
// on its own, which listed FBD and ELG rows and nothing else; `all` takes every
// row, whatever its verification cell holds, empty included.
export type ExecuteVerificationFilter = "all" | "both" | "fbd" | "elg";

// Markers each choice takes in the verification cell, as an OR of the values a
// clause looks for inside it. No markers mean no narrowing at all.
const VERIFICATION_MARKERS: Record<ExecuteVerificationFilter, ReadonlyArray<string>> = {
  all: [],
  both: ["FBD", "ELG"],
  fbd: ["FBD"],
  elg: ["ELG"],
};

// The execute engine compares the whole cell, so a value like "FBD EXTRA" is
// none of the choices.
export function verificationMatches(value: string, filter: ExecuteVerificationFilter): boolean {
  const markers = VERIFICATION_MARKERS[filter];
  if (markers.length === 0) return true;
  const normalized = value.trim().toLowerCase();
  return markers.some((marker) => marker.toLowerCase() === normalized);
}

// The same choice as the run-level clause the row engine applies to every
// bucket, which reads the markers inside the cell. The choice that takes every
// row leaves the clauses as they are.
export function verificationClause(filter: ExecuteVerificationFilter): ConditionClause[] {
  const markers = VERIFICATION_MARKERS[filter];
  return markers.length === 0
    ? []
    : [{ column: "verificationType", operator: "contains", values: [...markers] }];
}

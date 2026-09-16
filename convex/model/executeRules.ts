// What the execute engine decides in code before it reads a row's rules. The
// rules themselves live in the conditions of the report type, where the
// configuration panels edit them.

// Column B holds the carrier name in every clinic sheet, the same fixed
// position the old tool read.
export const CARRIER_COLUMN_INDEX = 1;

export type ExecuteVerificationFilter = "all" | "fbd" | "elg";

// The old tool only listed the verification types the run asked for, and
// without a choice it listed FBD and ELG rows and nothing else.
export function verificationMatches(value: string, filter: ExecuteVerificationFilter): boolean {
  const normalized = value.trim().toLowerCase();
  if (filter === "all") return normalized === "fbd" || normalized === "elg";
  return normalized === filter;
}

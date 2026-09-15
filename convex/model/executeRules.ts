import { EXECUTION_COLUMN_INDEX, MESSAGE_COLUMN_INDEX } from "./reportConditions";

// Column B holds the carrier name and column W the BKS percentage in every
// clinic sheet, the same fixed positions the old tool read.
export const CARRIER_COLUMN_INDEX = 1;
export const BKS_COLUMN_INDEX = 22;

// Every rule reads these beside the clinic's own mapping. The results view
// shows them first, which is how a row explains why it was found.
export const EXECUTE_FIXED_COLUMN_INDEXES = [
  CARRIER_COLUMN_INDEX,
  EXECUTION_COLUMN_INDEX,
  MESSAGE_COLUMN_INDEX,
  BKS_COLUMN_INDEX,
];

export type ExecuteVerificationFilter = "all" | "fbd" | "elg";

export type ExecuteColumnIndexes = {
  verification: number;
  fileUrl: number;
  updateStatus: number;
};

// An execution status of empty, unchecked or review means the row still has to
// run.
const PENDING_EXECUTION_MARKERS = new Set(["empty", "unchecked", "review"]);

// Message values that leave the row workable. Any other value means the bot
// already answered it.
const WORKABLE_MESSAGE_MARKERS = new Set([
  "empty",
  "two-step verification required",
  "no content loaded",
  "review",
  "federal",
  "verification without urls",
  "iv process is running",
  "wrong form detected",
  "2fa is required",
  "multi-marked",
]);

const LOW_BKS_PERCENT = 50;

// The sheet writes the empty sentinel as the whole cell, so a value like "not
// empty" is a status of its own and not an untouched row.
const EMPTY_MARKER = "empty";

// A finished row reads "done" or "done by" and then the person who ran it, so
// the marker is the start of the cell and not the whole of it.
const DONE_MARKER = "done";

function cell(row: string[], index: number): string {
  return (row[index] ?? "").trim().toLowerCase();
}

// The old tool only listed the verification types the run asked for, and
// without a choice it listed FBD and ELG rows and nothing else.
function verificationMatches(value: string, filter: ExecuteVerificationFilter): boolean {
  if (filter === "all") return value === "fbd" || value === "elg";
  return value === filter;
}

// Column W holds a percentage like "76%". A cell without one, or with no
// number in front of it, cannot be under the threshold.
function bksBelowThreshold(row: string[], index: number): boolean {
  const raw = cell(row, index);
  const separator = raw.indexOf("%");
  if (separator < 0) return false;

  const numeric = raw.slice(0, separator).trim();
  if (numeric === "") return false;

  const percent = Number(numeric);
  return Number.isFinite(percent) && percent < LOW_BKS_PERCENT;
}

/**
 * Whether the pending-to-execute report lists the row: the update status is
 * untouched, the verification type is one the run asked for, and the row is
 * either waiting for its first run, ran without leaving a file, or ran low on
 * BKS. Reads the fixed columns plus the ones in `indexes`.
 */
export function isPendingToExecute(
  row: string[],
  indexes: ExecuteColumnIndexes,
  filter: ExecuteVerificationFilter
): boolean {
  if (cell(row, indexes.updateStatus) !== EMPTY_MARKER) return false;
  if (!verificationMatches(cell(row, indexes.verification), filter)) return false;

  const execution = cell(row, EXECUTION_COLUMN_INDEX);
  if (
    PENDING_EXECUTION_MARKERS.has(execution) &&
    WORKABLE_MESSAGE_MARKERS.has(cell(row, MESSAGE_COLUMN_INDEX))
  ) {
    return true;
  }

  if (!execution.startsWith(DONE_MARKER)) return false;
  if (cell(row, indexes.fileUrl) === EMPTY_MARKER) return true;
  return bksBelowThreshold(row, BKS_COLUMN_INDEX);
}

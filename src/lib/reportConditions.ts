import { MAX_MARKER_LENGTH, type ReportConditionSet } from "../../convex/model/reportConditions";

export type CriterionCopy = {
  title: string;
  description: string;
};

export const PENDING_AUDIT_CRITERIA = {
  verificationType: {
    title: "Verification type",
    description:
      "Extra filter: keep rows whose verification column contains one of these values. Off means no verification condition, like the legacy TODOS option.",
  },
  executionHit: {
    title: "Execution markers (columns L and M)",
    description:
      "Keep rows where L contains a done marker and M has none of the excluded markers, or where L contains a check marker and M contains a not-found marker.",
  },
  updateStatusExclude: {
    title: "Excluded update statuses",
    description: "Drop rows whose update status is exactly one of these values.",
  },
  uploadStatusAllowed: {
    title: "Allowed upload statuses",
    description: "Keep rows whose upload status matches this list.",
  },
} satisfies Record<string, CriterionCopy>;

export const READY_TO_UPLOAD_CRITERIA = {
  executionDone: {
    title: "Execution done (column L)",
    description: "Require column L to contain one of these markers.",
  },
  updateStatusAllowed: {
    title: "Accepted update statuses",
    description:
      "A row with an empty upload status becomes Ready only when its update status contains one of these values.",
  },
  uploadStatusTerminalExclude: {
    title: "Terminal upload statuses",
    description: "Drop rows whose upload status contains any of these values.",
  },
  uploadReady: {
    title: "Ready upload markers",
    description: "Rows whose upload status contains one of these values go to Ready to upload.",
  },
  uploadReview: {
    title: "Needs review",
    description:
      "Rows left after the rules above go to Needs review. Turn off catch all to group them by these markers instead.",
  },
} satisfies Record<string, CriterionCopy>;

// Same shape the backend stores in `cleanMarkers`, so what is typed is what
// gets saved.
export function normalizeMarker(value: string): string {
  return value.trim().toUpperCase().slice(0, MAX_MARKER_LENGTH);
}

export function hasEnabledCriterion(conditions: ReportConditionSet): boolean {
  if (conditions.kind === "pending-audit") {
    return (
      conditions.verificationType.enabled ||
      conditions.executionHit.enabled ||
      conditions.updateStatusExclude.enabled ||
      conditions.uploadStatusAllowed.enabled
    );
  }
  return (
    conditions.executionDone.enabled ||
    conditions.updateStatusAllowed.enabled ||
    conditions.uploadStatusTerminalExclude.enabled ||
    conditions.uploadReady.enabled ||
    conditions.uploadReview.enabled
  );
}

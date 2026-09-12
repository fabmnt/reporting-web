import { MAX_MARKER_LENGTH, type ReportConditionSet } from "../../convex/model/reportConditions";

export type CriterionCopy = {
  title: string;
  description: string;
};

export const PENDING_AUDIT_CRITERIA = {
  verificationType: {
    title: "Verification type",
    description: "Keep rows whose verification column contains one of these values.",
  },
  executionHit: {
    title: "Execution markers (columns L and M)",
    description:
      "Keep rows where L contains a done marker, or where L contains a check marker and M contains a not-found marker.",
  },
  updateStatusExclude: {
    title: "Excluded update statuses",
    description: "Drop rows whose update status contains any of these values.",
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
  updateStatusDone: {
    title: "Update status done",
    description: "Require the update status to contain one of these markers.",
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
    title: "Review upload markers",
    description: "Rows whose upload status contains one of these values go to Needs review.",
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
    conditions.updateStatusDone.enabled ||
    conditions.uploadStatusTerminalExclude.enabled ||
    conditions.uploadReady.enabled ||
    conditions.uploadReview.enabled
  );
}

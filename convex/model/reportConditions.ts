import { ConvexError, v } from "convex/values";
import type { Infer } from "convex/values";

import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import type { ReportOperationKey } from "./reportOperations";

type SheetRow = string[];

export function cell(row: SheetRow, index: number): string {
  return (row[index] ?? "").toUpperCase().trim();
}

// Old tool rule (get_rows_pending_to_audit_conditions), non-view branch.
// Column L says DONE and M is not excluded, or L says CHECK and M says
// NOT FOUND. The legacy DONE + TERMED option is covered by the DONE branch.
// Update status must not be exactly one of the exclude values, and upload
// status must be EMPTY or UNCHECKED. Rows short of 14 columns are skipped.
// The verification-type condition only exists for FBD/ELG, not for TODOS.
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

// Operations whose row rules are configurable. The other report types in
// `reportOperationKey` do not have conditions yet.
export const IMPLEMENTED_REPORT_OPERATIONS = ["pending-audit", "ready-to-upload"] as const;
export type ImplementedOperationKey = (typeof IMPLEMENTED_REPORT_OPERATIONS)[number];

export function isImplementedOperation(key: string): key is ImplementedOperationKey {
  return (IMPLEMENTED_REPORT_OPERATIONS as readonly string[]).includes(key);
}

const markerRule = v.object({ enabled: v.boolean(), markers: v.array(v.string()) });

const pendingAuditConditions = v.object({
  kind: v.literal("pending-audit"),
  verificationType: v.object({ enabled: v.boolean(), values: v.array(v.string()) }),
  executionHit: v.object({
    enabled: v.boolean(),
    lDoneMarkers: v.array(v.string()),
    mExcludeMarkers: v.array(v.string()),
    lCheckMarkers: v.array(v.string()),
    mNotFoundMarkers: v.array(v.string()),
  }),
  updateStatusExclude: markerRule,
  uploadStatusAllowed: v.object({
    enabled: v.boolean(),
    values: v.array(v.string()),
    match: v.union(v.literal("exact"), v.literal("contains")),
  }),
});

// Old tool rule (get_rows_ready_to_upload_ts), which is what both active
// legacy wrappers call. Rows need column L = DONE. Terminal upload statuses
// are ignored, upload status EMPTY plus an accepted update status is ready,
// and every other remaining row goes to review.
const readyToUploadConditions = v.object({
  kind: v.literal("ready-to-upload"),
  executionDone: markerRule,
  updateStatusAllowed: markerRule,
  uploadStatusTerminalExclude: markerRule,
  uploadReady: markerRule,
  uploadReview: v.object({
    enabled: v.boolean(),
    catchAll: v.boolean(),
    markers: v.array(v.string()),
  }),
});

export const reportConditionSet = v.union(pendingAuditConditions, readyToUploadConditions);
export type ReportConditionSet = Infer<typeof reportConditionSet>;
export type PendingAuditConditions = Infer<typeof pendingAuditConditions>;
export type ReadyToUploadConditions = Infer<typeof readyToUploadConditions>;

export const MAX_MARKERS_PER_RULE = 50;
export const MAX_MARKER_LENGTH = 80;

// The conditions that reproduce the hardcoded rules. Built fresh on every call
// so callers can edit the result without touching each other.
export function defaultConditionsFor(operationKey: ReportOperationKey): ReportConditionSet {
  if (operationKey === "pending-audit") {
    return {
      kind: "pending-audit",
      // Legacy TODOS applies no verification condition, so the rule starts off.
      verificationType: { enabled: false, values: ["FBD", "ELG"] },
      executionHit: {
        enabled: true,
        lDoneMarkers: ["DONE"],
        mExcludeMarkers: ["NO ACTION", "EMPTY", "NEXT VERIFICATION ON"],
        lCheckMarkers: ["CHECK"],
        mNotFoundMarkers: ["NOT FOUND"],
      },
      updateStatusExclude: { enabled: true, markers: [...AUDIT_EXCLUDE_STATUS] },
      uploadStatusAllowed: { enabled: true, values: ["EMPTY", "UNCHECKED"], match: "exact" },
    };
  }
  if (operationKey === "ready-to-upload") {
    return {
      kind: "ready-to-upload",
      executionDone: { enabled: true, markers: ["DONE"] },
      updateStatusAllowed: { enabled: true, markers: ["DONE", "NOT FOUND"] },
      uploadStatusTerminalExclude: {
        enabled: true,
        markers: ["UPLOADED", "DONE BY DR", "DONE BY DIVA"],
      },
      uploadReady: { enabled: true, markers: ["EMPTY"] },
      uploadReview: { enabled: true, catchAll: true, markers: [] },
    };
  }
  throw new ConvexError({
    code: "INVALID_OPERATION",
    message: `No conditions are defined for "${operationKey}" yet.`,
  });
}

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

function cleanRule(rule: { enabled: boolean; markers: string[] }) {
  return { enabled: rule.enabled, markers: cleanMarkers(rule.markers) };
}

export function cleanConditionSet(conditions: ReportConditionSet): ReportConditionSet {
  if (conditions.kind === "pending-audit") {
    return {
      kind: "pending-audit",
      verificationType: {
        enabled: conditions.verificationType.enabled,
        values: cleanMarkers(conditions.verificationType.values),
      },
      executionHit: {
        enabled: conditions.executionHit.enabled,
        lDoneMarkers: cleanMarkers(conditions.executionHit.lDoneMarkers),
        mExcludeMarkers: cleanMarkers(conditions.executionHit.mExcludeMarkers),
        lCheckMarkers: cleanMarkers(conditions.executionHit.lCheckMarkers),
        mNotFoundMarkers: cleanMarkers(conditions.executionHit.mNotFoundMarkers),
      },
      updateStatusExclude: cleanRule(conditions.updateStatusExclude),
      uploadStatusAllowed: {
        enabled: conditions.uploadStatusAllowed.enabled,
        values: cleanMarkers(conditions.uploadStatusAllowed.values),
        match: conditions.uploadStatusAllowed.match,
      },
    };
  }
  return {
    kind: "ready-to-upload",
    executionDone: cleanRule(conditions.executionDone),
    updateStatusAllowed: cleanRule(conditions.updateStatusAllowed),
    uploadStatusTerminalExclude: cleanRule(conditions.uploadStatusTerminalExclude),
    uploadReady: cleanRule(conditions.uploadReady),
    uploadReview: {
      enabled: conditions.uploadReview.enabled,
      catchAll: conditions.uploadReview.catchAll,
      markers: cleanMarkers(conditions.uploadReview.markers),
    },
  };
}

export function assertConditionKind(conditions: ReportConditionSet, operationKey: string): void {
  if (conditions.kind !== operationKey) {
    throw new ConvexError({
      code: "INVALID_CONFIG",
      message: `Conditions for "${conditions.kind}" do not match the operation "${operationKey}".`,
    });
  }
}

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
    if (row.conditions.kind !== operationKey) continue;
    if (row.clinicId === null) defaultConditions = row.conditions;
    else byClinicId.set(row.clinicId, row.conditions);
  }

  return {
    defaultConditions: defaultConditions ?? defaultConditionsFor(operationKey),
    defaultIsCustom: defaultConditions !== null,
    byClinicId,
  };
}

function matchesAny(value: string, markers: string[]): boolean {
  return markers.length > 0 && markers.some((marker) => value.includes(marker));
}

/**
 * Pending audit keeps a row when every enabled criterion passes. A disabled
 * criterion is ignored. Structural guards (row length) are never configurable.
 *
 * The runtime verification filter narrows further: "all" adds nothing (legacy
 * TODOS), while "fbd"/"elg" require the verification column to contain that
 * value, exactly like the legacy FBD/ELG condition sets.
 */
export function evaluatePendingAudit(
  row: SheetRow,
  columns: { updateStatus: number; uploadStatus: number; verificationType: number },
  conditions: ReportConditionSet,
  verificationFilter: "all" | "fbd" | "elg"
): { kept: boolean; reason: string | null } {
  const { updateStatus, uploadStatus, verificationType } = columns;
  if (row.length <= Math.max(13, updateStatus, uploadStatus, verificationType))
    return { kept: false, reason: "too_short" };
  if (conditions.kind !== "pending-audit") return { kept: false, reason: "kind_mismatch" };

  const verification = cell(row, verificationType);
  if (
    conditions.verificationType.enabled &&
    !matchesAny(verification, conditions.verificationType.values)
  )
    return { kept: false, reason: "verification_mismatch" };
  if (verificationFilter !== "all" && !verification.includes(verificationFilter.toUpperCase()))
    return { kept: false, reason: "verification_mismatch" };

  if (conditions.executionHit.enabled) {
    const l = cell(row, 11);
    const m = cell(row, 12);
    const doneHit =
      matchesAny(l, conditions.executionHit.lDoneMarkers) &&
      !matchesAny(m, conditions.executionHit.mExcludeMarkers);
    const checkHit =
      matchesAny(l, conditions.executionHit.lCheckMarkers) &&
      matchesAny(m, conditions.executionHit.mNotFoundMarkers);
    if (!doneHit && !checkHit) return { kept: false, reason: "l_m_condition_failed" };
  }

  // The legacy tool compares the update status with equality, not "contains".
  if (
    conditions.updateStatusExclude.enabled &&
    conditions.updateStatusExclude.markers.includes(cell(row, updateStatus))
  )
    return { kept: false, reason: "update_status_excluded" };

  if (conditions.uploadStatusAllowed.enabled) {
    const upload = cell(row, uploadStatus);
    const allowed =
      conditions.uploadStatusAllowed.match === "exact"
        ? conditions.uploadStatusAllowed.values.includes(upload)
        : matchesAny(upload, conditions.uploadStatusAllowed.values);
    if (!allowed) return { kept: false, reason: "upload_status_not_allowed" };
  }

  return { kept: true, reason: null };
}

/**
 * Ready to upload mirrors the active legacy rule (get_rows_ready_to_upload_ts):
 * a row needs column L done and a non-terminal upload status. It is ready when
 * the upload status is empty and the update status is accepted; every other
 * remaining row goes to review, unless the review rule asks for markers only.
 */
export function evaluateReadyToUpload(
  row: SheetRow,
  columns: { updateStatus: number; uploadStatus: number },
  conditions: ReportConditionSet
): { bucket: "ready" | "review" | null; reason: string } {
  const { updateStatus, uploadStatus } = columns;
  // The legacy rule also reads column M, so it requires 13 columns.
  if (row.length <= Math.max(12, updateStatus, uploadStatus))
    return { bucket: null, reason: "too_short" };
  if (conditions.kind !== "ready-to-upload") return { bucket: null, reason: "kind_mismatch" };

  const l = cell(row, 11);
  if (conditions.executionDone.enabled && !matchesAny(l, conditions.executionDone.markers))
    return { bucket: null, reason: "col_l_not_done" };

  const upload = cell(row, uploadStatus);
  // Terminal states never need action again, and are checked before ready and
  // review, same order as the legacy tool.
  if (
    conditions.uploadStatusTerminalExclude.enabled &&
    matchesAny(upload, conditions.uploadStatusTerminalExclude.markers)
  )
    return { bucket: null, reason: "upload_terminal" };

  if (conditions.uploadReady.enabled && matchesAny(upload, conditions.uploadReady.markers)) {
    const update = cell(row, updateStatus);
    if (
      conditions.updateStatusAllowed.enabled &&
      !matchesAny(update, conditions.updateStatusAllowed.markers)
    )
      return { bucket: null, reason: "update_status_not_allowed" };
    return { bucket: "ready", reason: "kept_ready" };
  }

  if (conditions.uploadReview.enabled) {
    if (conditions.uploadReview.catchAll) return { bucket: "review", reason: "kept_review" };
    if (matchesAny(upload, conditions.uploadReview.markers))
      return { bucket: "review", reason: "kept_review" };
  }

  return { bucket: null, reason: "upload_no_match" };
}

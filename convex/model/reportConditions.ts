import { ConvexError, v } from "convex/values";
import type { Infer } from "convex/values";

import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import type { ReportOperationKey } from "./reportOperations";

type SheetRow = string[];

export function cell(row: SheetRow, index: number): string {
  return (row[index] ?? "").toUpperCase().trim();
}

// Old tool rule (get_rows_ready_to_upload): column L says DONE, update status
// says DONE, upload status says EMPTY. Review bucket: same but upload status
// says CHECK, ERROR, UPLOAD INCOMPLETE, or NOT UPLOADED.
export const REVIEW_UPLOAD_MARKERS = ["CHECK", "ERROR", "UPLOAD INCOMPLETE", "NOT UPLOADED"];

// Old tool rule (get_rows_pending_to_audit_conditions): DONE in column L plus
// the verification-type condition, update status not in the exclude list,
// upload status EMPTY or UNCHECKED. Rows short of 14 columns are skipped.
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

const readyToUploadConditions = v.object({
  kind: v.literal("ready-to-upload"),
  executionDone: markerRule,
  updateStatusDone: markerRule,
  uploadStatusTerminalExclude: markerRule,
  uploadReady: markerRule,
  uploadReview: markerRule,
});

export const reportConditionSet = v.union(pendingAuditConditions, readyToUploadConditions);
export type ReportConditionSet = Infer<typeof reportConditionSet>;
export type PendingAuditConditions = Infer<typeof pendingAuditConditions>;
export type ReadyToUploadConditions = Infer<typeof readyToUploadConditions>;

export const MAX_MARKERS_PER_RULE = 50;
export const MAX_MARKER_LENGTH = 80;
export const MAX_CONDITION_ROWS = 500;

// The conditions that reproduce the hardcoded rules. Built fresh on every call
// so callers can edit the result without touching each other.
export function defaultConditionsFor(operationKey: ReportOperationKey): ReportConditionSet {
  if (operationKey === "pending-audit") {
    return {
      kind: "pending-audit",
      verificationType: { enabled: true, values: ["FBD", "ELG"] },
      executionHit: {
        enabled: true,
        lDoneMarkers: ["DONE"],
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
      updateStatusDone: { enabled: true, markers: ["DONE"] },
      uploadStatusTerminalExclude: { enabled: true, markers: ["UPLOADED", "DONE BY"] },
      uploadReady: { enabled: true, markers: ["EMPTY"] },
      uploadReview: { enabled: true, markers: [...REVIEW_UPLOAD_MARKERS] },
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
    updateStatusDone: cleanRule(conditions.updateStatusDone),
    uploadStatusTerminalExclude: cleanRule(conditions.uploadStatusTerminalExclude),
    uploadReady: cleanRule(conditions.uploadReady),
    uploadReview: cleanRule(conditions.uploadReview),
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
// code default. One bounded read for the whole user + operation pair.
export async function resolveConditionsForClinics(
  ctx: QueryCtx,
  userId: Id<"users">,
  operationKey: ImplementedOperationKey
): Promise<ResolvedConditions> {
  const rows = await ctx.db
    .query("reportConditions")
    .withIndex("by_userId_and_operationKey", (query) =>
      query.eq("userId", userId).eq("operationKey", operationKey)
    )
    .take(MAX_CONDITION_ROWS);

  let defaultConditions: ReportConditionSet | null = null;
  const byClinicId = new Map<Id<"clinics">, ReportConditionSet>();
  for (const row of rows) {
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
 * The runtime verification filter narrows further: "all" keeps every row that
 * matches the configured verification values, while "fbd"/"elg" require an
 * exact match.
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
  if (verificationFilter !== "all" && verification !== verificationFilter.toUpperCase())
    return { kept: false, reason: "verification_mismatch" };

  if (conditions.executionHit.enabled) {
    const l = cell(row, 11);
    const m = cell(row, 12);
    const hit =
      matchesAny(l, conditions.executionHit.lDoneMarkers) ||
      (matchesAny(l, conditions.executionHit.lCheckMarkers) &&
        matchesAny(m, conditions.executionHit.mNotFoundMarkers));
    if (!hit) return { kept: false, reason: "l_m_condition_failed" };
  }

  if (
    conditions.updateStatusExclude.enabled &&
    matchesAny(cell(row, updateStatus), conditions.updateStatusExclude.markers)
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
 * Ready to upload returns "ready", "review" or null. Every enabled criterion
 * must pass; a disabled criterion is ignored. Structural guards are fixed.
 */
export function evaluateReadyToUpload(
  row: SheetRow,
  columns: { updateStatus: number; uploadStatus: number },
  conditions: ReportConditionSet
): { bucket: "ready" | "review" | null; reason: string } {
  const { updateStatus, uploadStatus } = columns;
  if (row.length <= Math.max(11, updateStatus, uploadStatus))
    return { bucket: null, reason: "too_short" };
  if (conditions.kind !== "ready-to-upload") return { bucket: null, reason: "kind_mismatch" };

  const l = cell(row, 11);
  if (conditions.executionDone.enabled && !matchesAny(l, conditions.executionDone.markers))
    return { bucket: null, reason: "col_l_not_done" };

  const update = cell(row, updateStatus);
  if (
    conditions.updateStatusDone.enabled &&
    !matchesAny(update, conditions.updateStatusDone.markers)
  )
    return { bucket: null, reason: "update_status_not_done" };

  const upload = cell(row, uploadStatus);
  // Terminal states never need action again, and are checked before the ready
  // and review markers (same order as the old tool).
  if (
    conditions.uploadStatusTerminalExclude.enabled &&
    matchesAny(upload, conditions.uploadStatusTerminalExclude.markers)
  )
    return { bucket: null, reason: "upload_terminal" };

  if (conditions.uploadReady.enabled && matchesAny(upload, conditions.uploadReady.markers))
    return { bucket: "ready", reason: "kept_ready" };
  if (conditions.uploadReview.enabled && matchesAny(upload, conditions.uploadReview.markers))
    return { bucket: "review", reason: "kept_review" };

  return { bucket: null, reason: "upload_no_match" };
}

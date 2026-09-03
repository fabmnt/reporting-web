import { v } from "convex/values";

import type { Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { action, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api.js";
import { columnLetterToIndex, listScopeClinics, requireReportingScope } from "./model/reporting";
import type { ReportingClinicDoc } from "./model/reporting";
import { reportOperationKey } from "./schema";

type SheetRow = string[];

function cell(row: SheetRow, index: number): string {
  return (row[index] ?? "").toUpperCase().trim();
}

// Old tool rule (get_rows_ready_to_upload): column L says DONE, update status
// says DONE, upload status says EMPTY. Review bucket: same but upload status
// says CHECK, ERROR, UPLOAD INCOMPLETE, or NOT UPLOADED.
const REVIEW_UPLOAD_MARKERS = ["CHECK", "ERROR", "UPLOAD INCOMPLETE", "NOT UPLOADED"];

// TEMPORARY while project is in development: cap debug samples per sheet so
// the response stays small while operators learn the row rules.
const MAX_DEBUG_SAMPLES = 10;

function getUploadOutcome(
  row: SheetRow,
  updateStatus: number,
  uploadStatus: number
): { bucket: "ready" | "review" | null; reason: string } {
  // Column L (index 11) is the execution control column in every legacy sheet.
  if (row.length <= Math.max(11, updateStatus, uploadStatus))
    return { bucket: null, reason: "too_short" };
  if (!cell(row, 11).includes("DONE")) return { bucket: null, reason: "col_l_not_done" };
  if (!cell(row, updateStatus).includes("DONE"))
    return { bucket: null, reason: "update_status_not_done" };
  const upload = cell(row, uploadStatus);
  // Terminal states never need action again.
  if (upload.includes("UPLOADED") || upload.includes("DONE BY"))
    return { bucket: null, reason: "upload_terminal" };
  if (upload.includes("EMPTY")) return { bucket: "ready", reason: "kept_ready" };
  if (REVIEW_UPLOAD_MARKERS.some((marker) => upload.includes(marker)))
    return { bucket: "review", reason: "kept_review" };
  return { bucket: null, reason: "upload_no_match" };
}

// Old tool rule (get_rows_pending_to_audit_conditions): DONE in column L plus
// the verification-type condition, update status not in the exclude list,
// upload status EMPTY or UNCHECKED. Rows short of 14 columns are skipped.
const AUDIT_EXCLUDE_STATUS = [
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

function getAuditDropReason(
  row: SheetRow,
  updateStatus: number,
  uploadStatus: number,
  verificationType: number,
  verificationFilter: "all" | "fbd" | "elg"
): string | null {
  if (row.length <= Math.max(13, updateStatus, uploadStatus, verificationType)) return "too_short";
  const l = cell(row, 11);
  const m = cell(row, 12);
  const verification = cell(row, verificationType);
  const matchesType =
    verificationFilter === "all"
      ? verification.includes("FBD") || verification.includes("ELG")
      : verification === verificationFilter.toUpperCase();
  if (!matchesType) return "verification_mismatch";
  const dynamicHit =
    l.includes("DONE") ||
    (l.includes("CHECK") && m.includes("NOT FOUND")) ||
    (l.includes("DONE") && m.includes("TERMED"));
  if (!dynamicHit) return "l_m_condition_failed";
  if (AUDIT_EXCLUDE_STATUS.some((status) => cell(row, updateStatus).includes(status)))
    return "update_status_excluded";
  const upload = cell(row, uploadStatus);
  if (!(upload === "EMPTY" || upload === "UNCHECKED"))
    return "upload_status_not_empty_or_unchecked";
  return null;
}

// TEMPORARY while project is in development: explains why rows were kept or
// dropped so operators can test the /reports form without reading backend code.
const reportSheetDebug = v.object({
  totalRows: v.number(),
  keptRows: v.number(),
  operationKey: v.string(),
  verificationFilter: v.string(),
  updateStatusColumn: v.string(),
  uploadStatusColumn: v.string(),
  verificationTypeColumn: v.string(),
  droppedByReason: v.array(v.object({ reason: v.string(), count: v.number() })),
  samples: v.array(
    v.object({
      rowNumber: v.number(),
      reason: v.string(),
      l: v.string(),
      m: v.string(),
      verification: v.string(),
      updateStatus: v.string(),
      uploadStatus: v.string(),
    })
  ),
});

const reportSheetResult = v.object({
  clinicId: v.id("clinics"),
  clinicName: v.string(),
  googleSheetId: v.string(),
  tabTitle: v.string(),
  headers: v.array(v.string()),
  readyRows: v.array(v.object({ rowNumber: v.number(), values: v.array(v.string()) })),
  reviewRows: v.array(v.object({ rowNumber: v.number(), values: v.array(v.string()) })),
  auditRows: v.array(v.object({ rowNumber: v.number(), values: v.array(v.string()) })),
  error: v.union(v.string(), v.null()),
  // TEMPORARY while project is in development: null unless the client passes debug=true.
  debug: v.union(reportSheetDebug, v.null()),
});

async function loadClinicColumns(
  ctx: QueryCtx,
  clinic: ReportingClinicDoc
): Promise<{ updateStatus: string; uploadStatus: string; verificationType: string }> {
  const fallback = { updateStatus: "T", uploadStatus: "R", verificationType: "N" };
  const mappings = await ctx.db
    .query("clinicColumnMappings")
    .withIndex("by_clinicId_and_purpose", (q) => q.eq("clinicId", clinic._id))
    .take(10);
  const byPurpose = new Map(mappings.map((m) => [m.purpose, m.columnName]));
  return {
    updateStatus: byPurpose.get("updateStatus") ?? fallback.updateStatus,
    uploadStatus: byPurpose.get("uploadStatus") ?? fallback.uploadStatus,
    verificationType: byPurpose.get("verificationType") ?? fallback.verificationType,
  };
}

// Config an operator needs before running: the scope, its clinics, and each
// clinic's status columns (per-clinic override or legacy T/R/N fallback).
// Kept as a named internal query so runSheetReport has one config entrypoint.
async function reportRunConfigForScope(
  ctx: QueryCtx,
  reportingScopeId: Id<"reportingScopes">
): Promise<{
  scopeId: Id<"reportingScopes">;
  scopeName: string;
  clinics: Array<{
    clinicId: Id<"clinics">;
    name: string;
    googleSheetId: string;
    updateStatusColumn: string;
    uploadStatusColumn: string;
    verificationTypeColumn: string;
  }>;
}> {
  const scope = await requireReportingScope(ctx, reportingScopeId);
  const clinics = await listScopeClinics(ctx, scope);
  const rows = [];
  for (const clinic of clinics) {
    const columns = await loadClinicColumns(ctx, clinic);
    rows.push({
      clinicId: clinic._id,
      name: clinic.name,
      googleSheetId: clinic.googleSheetId,
      updateStatusColumn: columns.updateStatus,
      uploadStatusColumn: columns.uploadStatus,
      verificationTypeColumn: columns.verificationType,
    });
  }
  return { scopeId: scope._id, scopeName: scope.name, clinics: rows };
}

export const recordReportRun = internalMutation({
  args: {
    operationKey: reportOperationKey,
    reportingScopeId: v.id("reportingScopes"),
    status: v.union(v.literal("completed"), v.literal("failed"), v.literal("cancelled")),
    initiatedByUserId: v.id("users"),
    startedAt: v.number(),
    completedAt: v.number(),
    processedClinicCount: v.number(),
    succeededClinicCount: v.number(),
    failedClinicCount: v.number(),
    errorMessage: v.optional(v.string()),
  },
  returns: v.object({ reportRunId: v.id("reportRuns") }),
  handler: async (ctx, args) => {
    const reportRunId = await ctx.db.insert("reportRuns", {
      initiatedByUserId: args.initiatedByUserId,
      operationKey: args.operationKey,
      reportingScopeId: args.reportingScopeId,
      status: args.status,
      startedAt: args.startedAt,
      completedAt: args.completedAt,
      processedClinicCount: args.processedClinicCount,
      succeededClinicCount: args.succeededClinicCount,
      failedClinicCount: args.failedClinicCount,
      errorMessage: args.errorMessage,
    });
    return { reportRunId };
  },
});

// v1 scope: pending-audit and ready-to-upload only. The execute operation
// needs carrier API data and comes later.
export const runSheetReport = action({
  args: {
    reportingScopeId: v.id("reportingScopes"),
    operationKey: v.union(v.literal("pending-audit"), v.literal("ready-to-upload")),
    startDate: v.string(),
    endDate: v.string(),
    verificationFilter: v.optional(v.union(v.literal("all"), v.literal("fbd"), v.literal("elg"))),
    // TEMPORARY while project is in development: when true each sheet also
    // returns why rows were dropped so the /reports form can show it.
    debug: v.optional(v.boolean()),
  },
  returns: v.object({
    reportRunId: v.union(v.id("reportRuns"), v.null()),
    scopeName: v.string(),
    sheets: v.array(reportSheetResult),
  }),
  handler: async (
    ctx,
    args
  ): Promise<{
    reportRunId: Id<"reportRuns"> | null;
    scopeName: string;
    sheets: Array<{
      clinicId: Id<"clinics">;
      clinicName: string;
      googleSheetId: string;
      tabTitle: string;
      headers: string[];
      readyRows: Array<{ rowNumber: number; values: string[] }>;
      reviewRows: Array<{ rowNumber: number; values: string[] }>;
      auditRows: Array<{ rowNumber: number; values: string[] }>;
      error: string | null;
      debug: {
        totalRows: number;
        keptRows: number;
        operationKey: string;
        verificationFilter: string;
        updateStatusColumn: string;
        uploadStatusColumn: string;
        verificationTypeColumn: string;
        droppedByReason: Array<{ reason: string; count: number }>;
        samples: Array<{
          rowNumber: number;
          reason: string;
          l: string;
          m: string;
          verification: string;
          updateStatus: string;
          uploadStatus: string;
        }>;
      } | null;
    }>;
  }> => {
    const { userId }: { userId: Id<"users"> } = await ctx.runQuery(
      internal.staffAuth.currentOperator,
      {}
    );
    const startedAt = Date.now();
    const verificationFilter = args.verificationFilter ?? "all";
    const wantDebug = args.debug ?? false;

    const config: {
      scopeId: Id<"reportingScopes">;
      scopeName: string;
      clinics: Array<{
        clinicId: Id<"clinics">;
        name: string;
        googleSheetId: string;
        updateStatusColumn: string;
        uploadStatusColumn: string;
        verificationTypeColumn: string;
      }>;
    } = await ctx.runQuery(internal.reports.runSheetReportConfig, {
      reportingScopeId: args.reportingScopeId,
      startDate: args.startDate,
      endDate: args.endDate,
    });

    const { tabsForClinic }: { tabsForClinic: Record<string, string[]> } = await ctx.runAction(
      internal.sheets.planSheetTabs,
      {
        clinics: config.clinics.map((c) => ({
          clinicId: c.clinicId,
          googleSheetId: c.googleSheetId,
        })),
        startDate: args.startDate,
        endDate: args.endDate,
      }
    );

    const sheets: Array<{
      clinicId: Id<"clinics">;
      clinicName: string;
      googleSheetId: string;
      tabTitle: string;
      headers: string[];
      readyRows: Array<{ rowNumber: number; values: string[] }>;
      reviewRows: Array<{ rowNumber: number; values: string[] }>;
      auditRows: Array<{ rowNumber: number; values: string[] }>;
      error: string | null;
      debug: {
        totalRows: number;
        keptRows: number;
        operationKey: string;
        verificationFilter: string;
        updateStatusColumn: string;
        uploadStatusColumn: string;
        verificationTypeColumn: string;
        droppedByReason: Array<{ reason: string; count: number }>;
        samples: Array<{
          rowNumber: number;
          reason: string;
          l: string;
          m: string;
          verification: string;
          updateStatus: string;
          uploadStatus: string;
        }>;
      } | null;
    }> = [];

    let succeededClinics = 0;
    let failedClinics = 0;
    for (const clinic of config.clinics) {
      const tabs = tabsForClinic[clinic.clinicId] ?? [];
      if (tabs.length === 0) {
        failedClinics += 1;
        sheets.push({
          clinicId: clinic.clinicId,
          clinicName: clinic.name,
          googleSheetId: clinic.googleSheetId,
          tabTitle: "",
          headers: [],
          readyRows: [],
          reviewRows: [],
          auditRows: [],
          error: `No tabs found between ${args.startDate} and ${args.endDate}.`,
          debug: null,
        });
        continue;
      }
      const updateStatus = columnLetterToIndex(clinic.updateStatusColumn);
      const uploadStatus = columnLetterToIndex(clinic.uploadStatusColumn);
      const verificationType = columnLetterToIndex(clinic.verificationTypeColumn);
      let clinicFailed = false;
      for (const tabTitle of tabs) {
        try {
          const { values, headers }: { values: string[][]; headers: string[] } =
            await ctx.runAction(internal.sheets.readSheetTabValues, {
              googleSheetId: clinic.googleSheetId,
              tabTitle,
            });
          const readyRows: Array<{ rowNumber: number; values: string[] }> = [];
          const reviewRows: Array<{ rowNumber: number; values: string[] }> = [];
          const auditRows: Array<{ rowNumber: number; values: string[] }> = [];
          // TEMPORARY while project is in development: count why each row is
          // dropped so the UI can show it. Same checks as the real filter.
          const dropCounts = new Map<string, number>();
          const dropSamples: Array<{
            rowNumber: number;
            reason: string;
            l: string;
            m: string;
            verification: string;
            updateStatus: string;
            uploadStatus: string;
          }> = [];
          function trackDrop(row: SheetRow, rowNumber: number, reason: string) {
            dropCounts.set(reason, (dropCounts.get(reason) ?? 0) + 1);
            if (dropSamples.length >= MAX_DEBUG_SAMPLES) return;
            dropSamples.push({
              rowNumber,
              reason,
              l: cell(row, 11),
              m: cell(row, 12),
              verification: cell(row, verificationType),
              updateStatus: cell(row, updateStatus),
              uploadStatus: cell(row, uploadStatus),
            });
          }
          values.forEach((row, index) => {
            const rowNumber = index + 2;
            if (args.operationKey === "ready-to-upload") {
              const { bucket, reason } = getUploadOutcome(row, updateStatus, uploadStatus);
              if (bucket === "ready") readyRows.push({ rowNumber, values: row });
              else if (bucket === "review") reviewRows.push({ rowNumber, values: row });
              else if (wantDebug) trackDrop(row, rowNumber, reason);
            } else {
              const dropReason = getAuditDropReason(
                row,
                updateStatus,
                uploadStatus,
                verificationType,
                verificationFilter
              );
              if (dropReason === null) {
                auditRows.push({ rowNumber, values: row });
              } else if (wantDebug) {
                trackDrop(row, rowNumber, dropReason);
              }
            }
          });
          const keptRows = readyRows.length + reviewRows.length + auditRows.length;
          sheets.push({
            clinicId: clinic.clinicId,
            clinicName: clinic.name,
            googleSheetId: clinic.googleSheetId,
            tabTitle,
            headers,
            readyRows,
            reviewRows,
            auditRows,
            error: null,
            debug: wantDebug
              ? {
                  totalRows: values.length,
                  keptRows,
                  operationKey: args.operationKey,
                  verificationFilter,
                  updateStatusColumn: clinic.updateStatusColumn,
                  uploadStatusColumn: clinic.uploadStatusColumn,
                  verificationTypeColumn: clinic.verificationTypeColumn,
                  droppedByReason: [...dropCounts.entries()].map(([reason, count]) => ({
                    reason,
                    count,
                  })),
                  samples: dropSamples,
                }
              : null,
          });
        } catch (error) {
          clinicFailed = true;
          sheets.push({
            clinicId: clinic.clinicId,
            clinicName: clinic.name,
            googleSheetId: clinic.googleSheetId,
            tabTitle,
            headers: [],
            readyRows: [],
            reviewRows: [],
            auditRows: [],
            error: error instanceof Error ? error.message : String(error),
            debug: null,
          });
        }
      }
      if (clinicFailed) {
        failedClinics += 1;
      } else {
        succeededClinics += 1;
      }
    }

    const { reportRunId }: { reportRunId: Id<"reportRuns"> } = await ctx.runMutation(
      internal.reports.recordReportRun,
      {
        operationKey: args.operationKey,
        reportingScopeId: config.scopeId,
        status: succeededClinics === 0 ? "failed" : "completed",
        initiatedByUserId: userId,
        startedAt,
        completedAt: Date.now(),
        processedClinicCount: config.clinics.length,
        succeededClinicCount: succeededClinics,
        failedClinicCount: failedClinics,
      }
    );

    return { reportRunId, scopeName: config.scopeName, sheets };
  },
});

// Thin wrapper so runSheetReport keeps one internal config entrypoint.
export const runSheetReportConfig = internalQuery({
  args: {
    reportingScopeId: v.id("reportingScopes"),
    startDate: v.string(),
    endDate: v.string(),
  },
  returns: v.object({
    scopeId: v.id("reportingScopes"),
    scopeName: v.string(),
    clinics: v.array(
      v.object({
        clinicId: v.id("clinics"),
        name: v.string(),
        googleSheetId: v.string(),
        updateStatusColumn: v.string(),
        uploadStatusColumn: v.string(),
        verificationTypeColumn: v.string(),
      })
    ),
  }),
  handler: async (ctx, args) => {
    if (args.startDate > args.endDate) {
      throw new Error("The start date must be on or before the end date.");
    }
    return reportRunConfigForScope(ctx, args.reportingScopeId);
  },
});

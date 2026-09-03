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

function classifyUploadRow(
  row: SheetRow,
  updateStatus: number,
  uploadStatus: number
): "ready" | "review" | null {
  // Column L (index 11) is the execution control column in every legacy sheet.
  if (row.length <= Math.max(11, updateStatus, uploadStatus)) return null;
  if (!cell(row, 11).includes("DONE")) return null;
  if (!cell(row, updateStatus).includes("DONE")) return null;
  const upload = cell(row, uploadStatus);
  // Terminal states never need action again.
  if (upload.includes("UPLOADED") || upload.includes("DONE BY")) return null;
  if (upload.includes("EMPTY")) return "ready";
  if (REVIEW_UPLOAD_MARKERS.some((marker) => upload.includes(marker))) return "review";
  return null;
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

function classifyAuditRow(
  row: SheetRow,
  updateStatus: number,
  uploadStatus: number,
  verificationType: number,
  verificationFilter: "all" | "fbd" | "elg"
): boolean {
  if (row.length <= Math.max(13, updateStatus, uploadStatus, verificationType)) return false;
  const l = cell(row, 11);
  const m = cell(row, 12);
  const verification = cell(row, verificationType);
  const matchesType =
    verificationFilter === "all"
      ? verification.includes("FBD") || verification.includes("ELG")
      : verification === verificationFilter.toUpperCase();
  const dynamicHit =
    l.includes("DONE") ||
    (l.includes("CHECK") && m.includes("NOT FOUND")) ||
    (l.includes("DONE") && m.includes("TERMED"));
  if (!(matchesType && dynamicHit)) return false;
  if (AUDIT_EXCLUDE_STATUS.some((status) => cell(row, updateStatus).includes(status))) return false;
  const upload = cell(row, uploadStatus);
  return upload === "EMPTY" || upload === "UNCHECKED";
}

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
    }>;
  }> => {
    const { userId }: { userId: Id<"users"> } = await ctx.runQuery(
      internal.staffAuth.currentOperator,
      {}
    );
    const startedAt = Date.now();
    const verificationFilter = args.verificationFilter ?? "all";

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
          values.forEach((row, index) => {
            const rowNumber = index + 2;
            if (args.operationKey === "ready-to-upload") {
              const bucket = classifyUploadRow(row, updateStatus, uploadStatus);
              if (bucket === "ready") readyRows.push({ rowNumber, values: row });
              if (bucket === "review") reviewRows.push({ rowNumber, values: row });
            } else {
              if (
                classifyAuditRow(
                  row,
                  updateStatus,
                  uploadStatus,
                  verificationType,
                  verificationFilter
                )
              ) {
                auditRows.push({ rowNumber, values: row });
              }
            }
          });
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

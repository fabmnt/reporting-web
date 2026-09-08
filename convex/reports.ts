import { v } from "convex/values";

import type { Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { action, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api.js";
import { columnLetterToIndex, listProfileClinics } from "./model/reporting";
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

// TEMPORARY while project is in development: run-level reasons when the run
// returns zero rows or sheets were never read.
const reportRunDebug = v.object({
  clinicCount: v.number(),
  startDate: v.string(),
  endDate: v.string(),
  operationKey: v.string(),
  verificationFilter: v.string(),
  summary: v.string(),
  totalSheetRowsRead: v.number(),
  totalRowsKept: v.number(),
  clinics: v.array(
    v.object({
      clinicName: v.string(),
      googleSheetId: v.string(),
      tabsInRange: v.array(v.string()),
      dateTabsOutsideRange: v.array(v.string()),
      nonDateTabCount: v.number(),
      nonDateTabSamples: v.array(v.string()),
      sheetError: v.union(v.string(), v.null()),
    })
  ),
  aggregateDropReasons: v.array(v.object({ reason: v.string(), count: v.number() })),
});

type TabCatalogEntry = {
  inRange: string[];
  dateTabsOutsideRange: string[];
  nonDateTabSamples: string[];
  nonDateTabCount: number;
};

type SheetResultEntry = {
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
};

function buildRunDebugSummary(
  clinicCount: number,
  totalRowsKept: number,
  totalSheetRowsRead: number,
  clinics: Array<{
    tabsInRange: string[];
    dateTabsOutsideRange: string[];
    sheetError: string | null;
  }>
): string {
  if (clinicCount === 0) {
    return "No assigned clinics to read. Ask an admin to assign clinics to your account.";
  }
  const tabsInRangeTotal = clinics.reduce((sum, clinic) => sum + clinic.tabsInRange.length, 0);
  if (tabsInRangeTotal === 0) {
    const hasDateTabsElsewhere = clinics.some((clinic) => clinic.dateTabsOutsideRange.length > 0);
    if (hasDateTabsElsewhere) {
      return "No tabs matched the date range, but the sheets do have date tabs outside that range. Tab names must be YYYY-MM-DD.";
    }
    return "No sheet tabs matched the date range. Tab names must be YYYY-MM-DD and fall between the start and end dates.";
  }
  if (totalSheetRowsRead === 0) {
    return "Tabs were selected but no data rows were read from Google Sheets.";
  }
  if (totalRowsKept === 0) {
    return "Rows were read from the sheet tabs, but every row was filtered out by the report rules.";
  }
  const sheetErrors = clinics.filter((clinic) => clinic.sheetError !== null);
  if (sheetErrors.length > 0) {
    return "Some sheets failed to load. See clinic details below.";
  }
  return `${totalRowsKept} row(s) matched the report rules.`;
}

function buildRunDebug(
  args: {
    startDate: string;
    endDate: string;
    operationKey: "pending-audit" | "ready-to-upload";
    verificationFilter: "all" | "fbd" | "elg";
  },
  configClinics: Array<{
    clinicId: Id<"clinics">;
    name: string;
    googleSheetId: string;
  }>,
  tabCatalogForClinic: Record<string, TabCatalogEntry>,
  sheets: SheetResultEntry[]
) {
  const aggregateDrops = new Map<string, number>();
  let totalSheetRowsRead = 0;
  let totalRowsKept = 0;
  for (const sheet of sheets) {
    if (sheet.debug) {
      totalSheetRowsRead += sheet.debug.totalRows;
      totalRowsKept += sheet.debug.keptRows;
      for (const item of sheet.debug.droppedByReason) {
        aggregateDrops.set(item.reason, (aggregateDrops.get(item.reason) ?? 0) + item.count);
      }
    }
  }

  const clinicSummaries = configClinics.map((clinic) => {
    const catalog = tabCatalogForClinic[clinic.clinicId] ?? {
      inRange: [],
      dateTabsOutsideRange: [],
      nonDateTabSamples: [],
      nonDateTabCount: 0,
    };
    const clinicSheets = sheets.filter((sheet) => sheet.clinicId === clinic.clinicId);
    const sheetError =
      clinicSheets.find((sheet) => sheet.error !== null)?.error ??
      (catalog.inRange.length === 0
        ? `No tabs found between ${args.startDate} and ${args.endDate}.`
        : null);
    return {
      clinicName: clinic.name,
      googleSheetId: clinic.googleSheetId,
      tabsInRange: catalog.inRange,
      dateTabsOutsideRange: catalog.dateTabsOutsideRange,
      nonDateTabCount: catalog.nonDateTabCount,
      nonDateTabSamples: catalog.nonDateTabSamples,
      sheetError,
    };
  });

  return {
    clinicCount: configClinics.length,
    startDate: args.startDate,
    endDate: args.endDate,
    operationKey: args.operationKey,
    verificationFilter: args.verificationFilter,
    summary: buildRunDebugSummary(
      configClinics.length,
      totalRowsKept,
      totalSheetRowsRead,
      clinicSummaries
    ),
    totalSheetRowsRead,
    totalRowsKept,
    clinics: clinicSummaries,
    aggregateDropReasons: [...aggregateDrops.entries()]
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count),
  };
}

async function reportRunConfigForUser(
  ctx: QueryCtx,
  userId: Id<"users">
): Promise<{
  clinics: Array<{
    clinicId: Id<"clinics">;
    clientId: Id<"clients">;
    name: string;
    googleSheetId: string;
    updateStatusColumn: string;
    uploadStatusColumn: string;
    verificationTypeColumn: string;
  }>;
}> {
  const profile = await ctx.db
    .query("staffProfiles")
    .withIndex("by_userId", (query) => query.eq("userId", userId))
    .unique();
  if (profile === null || profile.status !== "active") {
    throw new Error("An active staff account is required.");
  }
  if (profile.role !== "admin" && profile.role !== "operator") {
    throw new Error("Operator access is required.");
  }

  const clinics = await listProfileClinics(ctx, profile);
  return {
    clinics: clinics.map((clinic) => ({
      clinicId: clinic._id,
      clientId: clinic.clientId,
      name: clinic.name,
      googleSheetId: clinic.googleSheetId,
      updateStatusColumn: clinic.sheetColumns.updateStatus,
      uploadStatusColumn: clinic.sheetColumns.uploadStatus,
      verificationTypeColumn: clinic.sheetColumns.verificationType,
    })),
  };
}

export const recordReportRun = internalMutation({
  args: {
    operationKey: reportOperationKey,
    clientId: v.optional(v.id("clients")),
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
      clientId: args.clientId,
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

// v1: pending-audit and ready-to-upload only. The execute operation needs
// carrier API data and comes later.
export const runSheetReport = action({
  args: {
    operationKey: v.union(v.literal("pending-audit"), v.literal("ready-to-upload")),
    startDate: v.string(),
    endDate: v.string(),
    verificationFilter: v.optional(v.union(v.literal("all"), v.literal("fbd"), v.literal("elg"))),
    debug: v.optional(v.boolean()),
  },
  returns: v.object({
    reportRunId: v.union(v.id("reportRuns"), v.null()),
    assignedClinicCount: v.number(),
    sheets: v.array(reportSheetResult),
    runDebug: v.union(reportRunDebug, v.null()),
  }),
  handler: async (
    ctx,
    args
  ): Promise<{
    reportRunId: Id<"reportRuns"> | null;
    assignedClinicCount: number;
    sheets: SheetResultEntry[];
    runDebug: ReturnType<typeof buildRunDebug> | null;
  }> => {
    const { userId }: { userId: Id<"users"> } = await ctx.runQuery(
      internal.staffAuth.currentOperator,
      {}
    );
    const startedAt = Date.now();
    const verificationFilter = args.verificationFilter ?? "all";
    const wantDebug = args.debug ?? false;

    const config: {
      clinics: Array<{
        clinicId: Id<"clinics">;
        clientId: Id<"clients">;
        name: string;
        googleSheetId: string;
        updateStatusColumn: string;
        uploadStatusColumn: string;
        verificationTypeColumn: string;
      }>;
    } = await ctx.runQuery(internal.reports.runSheetReportConfig, {
      userId,
      startDate: args.startDate,
      endDate: args.endDate,
    });

    const { tabsForClinic, tabCatalogForClinic }: {
      tabsForClinic: Record<string, string[]>;
      tabCatalogForClinic: Record<string, TabCatalogEntry>;
    } = await ctx.runAction(
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

    const sheets: SheetResultEntry[] = [];

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

    const clientIds = new Set(config.clinics.map((clinic) => clinic.clientId));
    const reportClientId = clientIds.size === 1 ? config.clinics[0]?.clientId : undefined;

    const { reportRunId }: { reportRunId: Id<"reportRuns"> } = await ctx.runMutation(
      internal.reports.recordReportRun,
      {
        operationKey: args.operationKey,
        clientId: reportClientId,
        status: succeededClinics === 0 ? "failed" : "completed",
        initiatedByUserId: userId,
        startedAt,
        completedAt: Date.now(),
        processedClinicCount: config.clinics.length,
        succeededClinicCount: succeededClinics,
        failedClinicCount: failedClinics,
      }
    );

    return {
      reportRunId,
      assignedClinicCount: config.clinics.length,
      sheets,
      runDebug: wantDebug
        ? buildRunDebug(
            {
              startDate: args.startDate,
              endDate: args.endDate,
              operationKey: args.operationKey,
              verificationFilter,
            },
            config.clinics,
            tabCatalogForClinic,
            sheets
          )
        : null,
    };
  },
});

// Thin wrapper so runSheetReport keeps one internal config entrypoint.
export const runSheetReportConfig = internalQuery({
  args: {
    userId: v.id("users"),
    startDate: v.string(),
    endDate: v.string(),
  },
  returns: v.object({
    clinics: v.array(
      v.object({
        clinicId: v.id("clinics"),
        clientId: v.id("clients"),
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
    return reportRunConfigForUser(ctx, args.userId);
  },
});

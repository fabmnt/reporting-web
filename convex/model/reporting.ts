import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { appError } from "./appErrors";
import { MAX_ASSIGNED_CLINICS } from "./assignments";
import { resolveClinicSheetColumns, type ResolvedClinicSheetColumns } from "./clinicSheetColumns";

export type StaffProfileForReporting = {
  assignedClinicIds?: Id<"clinics">[];
};

export type ReportingClientDoc = {
  _id: Id<"clients">;
  key: string;
  name: string;
  isActive: boolean;
};

export type ReportingClinicDoc = {
  _id: Id<"clinics">;
  clientId: Id<"clients">;
  name: string;
  googleSheetId: string;
  externalClinicId: string;
  isActive: boolean;
  sheetColumns: ResolvedClinicSheetColumns;
  qaGroupKeys: string[];
};

type ReportingCtx = QueryCtx;

const MAX_CLIENT_CLINICS = 200;

function toReportingClinic(clinic: {
  _id: Id<"clinics">;
  clientId: Id<"clients">;
  name: string;
  googleSheetId: string;
  // Optional in the table until the directory import has backfilled every row,
  // and empty for a clinic that has not been imported yet.
  externalClinicId?: string;
  isActive: boolean;
  sheetColumns?: Parameters<typeof resolveClinicSheetColumns>[0];
  qaGroupKeys?: string[];
}): ReportingClinicDoc {
  return {
    _id: clinic._id,
    clientId: clinic.clientId,
    name: clinic.name,
    googleSheetId: clinic.googleSheetId,
    externalClinicId: clinic.externalClinicId ?? "",
    isActive: clinic.isActive,
    sheetColumns: resolveClinicSheetColumns(clinic.sheetColumns),
    qaGroupKeys: clinic.qaGroupKeys ?? [],
  };
}

// Every account, admins included, sees only its assignedClinicIds (active
// clinics only, unknown ids are skipped).
export async function listProfileClinics(
  ctx: ReportingCtx,
  profile: StaffProfileForReporting
): Promise<ReportingClinicDoc[]> {
  const assignedIds = (profile.assignedClinicIds ?? []).slice(0, MAX_ASSIGNED_CLINICS);
  const clinics: ReportingClinicDoc[] = [];
  for (const clinicId of assignedIds) {
    const clinic = await ctx.db.get("clinics", clinicId);
    if (clinic === null || !clinic.isActive) continue;
    clinics.push(toReportingClinic(clinic));
  }
  clinics.sort((a, b) => a.name.localeCompare(b.name));
  return clinics;
}

export async function countClientClinics(
  ctx: ReportingCtx,
  clientId: Id<"clients">
): Promise<number> {
  const rows = await ctx.db
    .query("clinics")
    .withIndex("by_clientId_and_name", (query) => query.eq("clientId", clientId))
    .take(MAX_CLIENT_CLINICS);
  return rows.filter((clinic) => clinic.isActive).length;
}

export async function listClientClinics(
  ctx: ReportingCtx,
  clientId: Id<"clients">
): Promise<ReportingClinicDoc[]> {
  const rows = await ctx.db
    .query("clinics")
    .withIndex("by_clientId_and_name", (query) => query.eq("clientId", clientId))
    .take(MAX_CLIENT_CLINICS);
  const clinics: ReportingClinicDoc[] = [];

  for (const clinic of rows) {
    if (!clinic.isActive) continue;
    clinics.push(toReportingClinic(clinic));
  }

  clinics.sort((a, b) => a.name.localeCompare(b.name));
  return clinics;
}

export async function requireRunnableClient(
  ctx: ReportingCtx,
  clientId: Id<"clients">
): Promise<ReportingClientDoc> {
  const client = await ctx.db.get("clients", clientId);
  if (client === null) {
    throw appError({ code: "CLIENT_NOT_FOUND" });
  }
  if (!client.isActive) {
    throw appError({ code: "CLIENT_DISABLED" });
  }
  return {
    _id: client._id,
    key: client.key,
    name: client.name,
    isActive: client.isActive,
  };
}

// Google Sheets stops at column ZZZ, so a mapping past it names no cell. The
// bound matters to the callers that pad a row up to the last column a rule
// reads, which they cannot do for a column that no sheet holds.
const MAX_SHEET_COLUMNS = 18278;

// Column letters ("A", "T", "AB") become zero-based indexes. Throws on
// anything that is not plain A-Z letters, or that points past the last column
// of a sheet, so a bad mapping fails fast.
export function columnLetterToIndex(column: string): number {
  const letters = column.trim().toUpperCase();
  if (!/^[A-Z]+$/.test(letters)) {
    throw appError({ code: "INVALID_SHEET_COLUMN", column });
  }
  let index = 0;
  for (const char of letters) {
    index = index * 26 + (char.charCodeAt(0) - 64);
  }
  if (index > MAX_SHEET_COLUMNS) {
    throw appError({ code: "INVALID_SHEET_COLUMN", column });
  }
  return index - 1;
}

// Sheet tabs of a run are named as dates, and so is the range they fall in.
const TAB_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// Validates a run's date range on its own, so a caller that reads many sheets
// rejects a malformed range instead of reporting it once per sheet.
export function assertReportDateRange(startDate: string, endDate: string): void {
  if (!TAB_DATE_PATTERN.test(startDate) || !TAB_DATE_PATTERN.test(endDate)) {
    throw appError({ code: "INVALID_DATE_FORMAT" });
  }
  if (startDate > endDate) {
    throw appError({ code: "INVALID_DATE_RANGE" });
  }
}

// Sheet tab names are dates like "2026-09-03". Returns only the tabs inside
// the requested range, sorted oldest first.
export function tabsInDateRange(tabTitles: string[], startDate: string, endDate: string): string[] {
  assertReportDateRange(startDate, endDate);
  return tabTitles
    .filter((title) => TAB_DATE_PATTERN.test(title) && title >= startDate && title <= endDate)
    .sort();
}

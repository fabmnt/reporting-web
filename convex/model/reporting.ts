import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { appError } from "./appErrors";
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
  externalClinicId: string | null;
  isActive: boolean;
  sheetColumns: ResolvedClinicSheetColumns;
  qaGroupKeys: string[];
};

type ReportingCtx = QueryCtx;

const MAX_CLIENT_CLINICS = 200;
const MAX_ASSIGNED_CLINICS = 200;

function toReportingClinic(clinic: {
  _id: Id<"clinics">;
  clientId: Id<"clients">;
  name: string;
  googleSheetId: string;
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
    externalClinicId: clinic.externalClinicId ?? null,
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

// Column letters ("A", "T", "AB") become zero-based indexes. Throws on
// anything that is not plain A-Z letters so a bad mapping fails fast.
export function columnLetterToIndex(column: string): number {
  const letters = column.trim().toUpperCase();
  if (!/^[A-Z]+$/.test(letters)) {
    throw appError({ code: "INVALID_SHEET_COLUMN", column });
  }
  let index = 0;
  for (const char of letters) {
    index = index * 26 + (char.charCodeAt(0) - 64);
  }
  return index - 1;
}

// Sheet tab names are dates like "2026-09-03". Returns only the tabs inside
// the requested range, sorted oldest first.
export function tabsInDateRange(tabTitles: string[], startDate: string, endDate: string): string[] {
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  if (!datePattern.test(startDate) || !datePattern.test(endDate)) {
    throw appError({ code: "INVALID_DATE_FORMAT" });
  }
  if (startDate > endDate) {
    throw appError({ code: "INVALID_DATE_RANGE" });
  }
  return tabTitles
    .filter((title) => datePattern.test(title) && title >= startDate && title <= endDate)
    .sort();
}

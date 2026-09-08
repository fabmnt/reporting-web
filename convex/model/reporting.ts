import { ConvexError } from "convex/values";

import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { resolveClinicSheetColumns, type ResolvedClinicSheetColumns } from "./clinicSheetColumns";

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
  isActive: boolean;
  sheetColumns: ResolvedClinicSheetColumns;
  qaGroupKeys: string[];
};

type ReportingCtx = QueryCtx;

const MAX_CLIENT_CLINICS = 200;

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
    clinics.push({
      _id: clinic._id,
      clientId: clinic.clientId,
      name: clinic.name,
      googleSheetId: clinic.googleSheetId,
      isActive: clinic.isActive,
      sheetColumns: resolveClinicSheetColumns(clinic.sheetColumns),
      qaGroupKeys: clinic.qaGroupKeys ?? [],
    });
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
    throw new ConvexError({ code: "NOT_FOUND", message: "Client was not found." });
  }
  if (!client.isActive) {
    throw new ConvexError({ code: "FORBIDDEN", message: "This client is disabled." });
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
    throw new ConvexError({
      code: "INVALID_CONFIG",
      message: `Invalid sheet column "${column}". Use letters like A, T, or AB.`,
    });
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
    throw new ConvexError({
      code: "INVALID_ARGUMENT",
      message: "Dates must use YYYY-MM-DD format.",
    });
  }
  if (startDate > endDate) {
    throw new ConvexError({
      code: "INVALID_ARGUMENT",
      message: "The start date must be on or before the end date.",
    });
  }
  return tabTitles
    .filter((title) => datePattern.test(title) && title >= startDate && title <= endDate)
    .sort();
}

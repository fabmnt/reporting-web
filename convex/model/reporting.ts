import { ConvexError } from "convex/values";

import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

export type ReportingScopeDoc = {
  _id: Id<"reportingScopes">;
  clientId: Id<"clients">;
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
};

type ReportingCtx = QueryCtx;

const MAX_SCOPE_CLINICS = 200;

// A reporting scope is a named group of clinics that run together, for
// example "The Smilist 2" or "DD ALL". Rows are ordered by `position` so the
// report prints clinics in a stable order.
export async function listScopeClinics(
  ctx: ReportingCtx,
  scope: ReportingScopeDoc
): Promise<ReportingClinicDoc[]> {
  const links = await ctx.db
    .query("reportingScopeClinics")
    .withIndex("by_reportingScopeId_and_clinicId", (q) => q.eq("reportingScopeId", scope._id))
    .take(MAX_SCOPE_CLINICS + 1);

  const ordered = links.slice(0, MAX_SCOPE_CLINICS).sort((a, b) => a.position - b.position);
  const clinics: ReportingClinicDoc[] = [];
  for (const link of ordered) {
    const clinic = await ctx.db.get("clinics", link.clinicId);
    if (clinic === null) continue;
    // A scope belongs to one client, so a clinic from another client is a
    // data error rather than something to silently include.
    if (clinic.clientId !== scope.clientId) continue;
    if (!clinic.isActive) continue;
    clinics.push({
      _id: clinic._id,
      clientId: clinic.clientId,
      name: clinic.name,
      googleSheetId: clinic.googleSheetId,
      isActive: clinic.isActive,
    });
  }
  return clinics;
}

export async function requireReportingScope(
  ctx: ReportingCtx,
  reportingScopeId: Id<"reportingScopes">
): Promise<ReportingScopeDoc> {
  const scope = await ctx.db.get("reportingScopes", reportingScopeId);
  if (scope === null) {
    throw new ConvexError({ code: "NOT_FOUND", message: "Reporting scope was not found." });
  }
  if (!scope.isActive) {
    throw new ConvexError({ code: "FORBIDDEN", message: "This reporting scope is disabled." });
  }
  return scope;
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

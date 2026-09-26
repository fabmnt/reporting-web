import type { ExecuteVerificationFilter } from "../../convex/model/executeRules";

import { todayIso } from "./dates";

// The verification types the run form offers, the same vocabulary the engines
// read: `all` takes every row whatever its verification cell holds, and `both`
// is the FBD or ELG narrowing the form has always opened with.
export type VerificationFilter = ExecuteVerificationFilter;

export type ReportFilters = {
  startDate: string;
  endDate: string;
  reportTypeId: string | null;
  verification: VerificationFilter;
  // The report groups the run is held to. None of them means every assigned
  // clinic is covered. Ids the account does not own any more are ignored where
  // the selection is matched against the groups the form holds.
  groupIds: string[];
  // The assigned clinics the run leaves out. Ids the account is not assigned to
  // are ignored where the selection is matched against the assigned clinics.
  excludedClinicIds: string[];
};

// The query string is the store of the run form, so a reload, a bookmark, or a
// link sent to a colleague brings back the same controls. Anyone can type in a
// URL, so every value is checked before it reaches the pickers.
const START_DATE_PARAM = "startDate";
const END_DATE_PARAM = "endDate";
const REPORT_TYPE_PARAM = "reportType";
const VERIFICATION_PARAM = "verification";
const GROUPS_PARAM = "groups";
const EXCLUDED_CLINICS_PARAM = "excludedClinics";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const VERIFICATION_FILTERS: ReadonlyArray<VerificationFilter> = ["all", "both", "fbd", "elg"];

function isVerificationFilter(value: string | null): value is VerificationFilter {
  return VERIFICATION_FILTERS.some((filter) => filter === value);
}

function readDate(params: URLSearchParams, name: string, fallback: string): string {
  const value = params.get(name);
  if (value === null) return fallback;
  // An empty date is a range that is still being picked, and the picker has to
  // show it as such instead of falling back to today.
  if (value === "") return value;
  return ISO_DATE.test(value) ? value : fallback;
}

// Group and clinic ids are compared with the ones the account holds, so a value
// that is not one of them costs nothing and needs no check of its own.
function readIds(value: string | null): string[] {
  if (value === null) return [];
  return value
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id !== "");
}

export function readReportFilters(search: string): ReportFilters {
  const params = new URLSearchParams(search);
  const today = todayIso();
  const verification = params.get(VERIFICATION_PARAM);

  return {
    startDate: readDate(params, START_DATE_PARAM, today),
    endDate: readDate(params, END_DATE_PARAM, today),
    // A missing report type means "the first one offered", which is also the
    // fallback of the picker.
    reportTypeId: params.get(REPORT_TYPE_PARAM) || null,
    verification: isVerificationFilter(verification) ? verification : "both",
    groupIds: readIds(params.get(GROUPS_PARAM)),
    excludedClinicIds: readIds(params.get(EXCLUDED_CLINICS_PARAM)),
  };
}

/**
 * Writes the filters over the query string of the current page. The path stays
 * untouched and no history entry is added, so a control change never becomes
 * something the back button has to walk through.
 */
export function replaceReportFilters(filters: ReportFilters): void {
  const params = new URLSearchParams({
    [START_DATE_PARAM]: filters.startDate,
    [END_DATE_PARAM]: filters.endDate,
    [VERIFICATION_PARAM]: filters.verification,
  });

  if (filters.reportTypeId !== null) params.set(REPORT_TYPE_PARAM, filters.reportTypeId);

  // Running over every assigned clinic is the default, so the common case keeps
  // the query string short whatever the account is assigned to.
  if (filters.groupIds.length > 0) {
    params.set(GROUPS_PARAM, filters.groupIds.join(","));
  }

  // Leaving nothing out is the default, so the common case keeps the query
  // string short whatever the account is assigned to.
  if (filters.excludedClinicIds.length > 0) {
    params.set(EXCLUDED_CLINICS_PARAM, filters.excludedClinicIds.join(","));
  }

  const { pathname } = window.location;
  window.history.replaceState(window.history.state, "", `${pathname}?${params.toString()}`);
}

import { todayIso } from "./dates";

export type VerificationFilter = "all" | "fbd" | "elg";

export type ReportFilters = {
  startDate: string;
  endDate: string;
  reportTypeId: string | null;
  verification: VerificationFilter;
};

// The query string is the store of the run form, so a reload, a bookmark, or a
// link sent to a colleague brings back the same controls. Anyone can type in a
// URL, so every value is checked before it reaches the pickers.
const START_DATE_PARAM = "startDate";
const END_DATE_PARAM = "endDate";
const REPORT_TYPE_PARAM = "reportType";
const VERIFICATION_PARAM = "verification";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const VERIFICATION_FILTERS: ReadonlyArray<VerificationFilter> = ["all", "fbd", "elg"];

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
    verification: isVerificationFilter(verification) ? verification : "all",
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

  const { pathname } = window.location;
  window.history.replaceState(window.history.state, "", `${pathname}?${params.toString()}`);
}

import { v } from "convex/values";
import type { Infer } from "convex/values";

import { reportSheetError } from "./appErrors";
import { credentialFallback, googleCredential } from "./googleCredentials";

// One row of a finished run. `carriers` lists the bots whose pattern the row's
// carrier cell matched, which only the carrier engine fills in.
export const reportRow = v.object({
  rowNumber: v.number(),
  values: v.array(v.string()),
  carriers: v.optional(v.array(v.string())),
});

// One entry per bucket of a report type, in bucket order. `filterColumns` are
// the 0-based sheet columns its conditions read, so the results view can show
// the cells behind the filter next to each row.
export const reportBucketResult = v.object({
  bucketKey: v.string(),
  label: v.string(),
  rows: v.array(reportRow),
  filterColumns: v.array(v.number()),
});

export const reportSheetResult = v.object({
  clinicId: v.id("clinics"),
  clinicName: v.string(),
  googleSheetId: v.string(),
  tabTitle: v.string(),
  headers: v.array(v.string()),
  // One entry per bucket of the report type, in bucket order.
  bucketRows: v.array(reportBucketResult),
  error: v.union(reportSheetError, v.null()),
  // The Google account the sheet was read with, so a reader can tell the app's
  // own account from a client's service account. Left out for a clinic whose
  // account could not be resolved, which is what its error reports.
  credential: v.optional(googleCredential),
  // Set when the sheet could not be read with the account its client is linked
  // to and the run read it with the app's own account instead. It names the
  // account that was left, which is the one the sheet has to be shared with, and
  // it stands beside a credential that names the account that did read the sheet.
  fallback: v.optional(credentialFallback),
});

// A clinic with bots the carrier API reports as not active, or whose pattern
// this app will not run. The operator reads it to tell a short list from a
// complete one. `unsupported` marks a bot whose pattern this app will not run,
// which has no status to show.
export const inactiveCarriersEntry = v.object({
  clinicId: v.id("clinics"),
  clinicName: v.string(),
  bots: v.array(
    v.object({
      name: v.string(),
      status: v.string(),
      unsupported: v.optional(v.boolean()),
    })
  ),
});

// One row no carrier bot could take, kept with the carrier cell it was read
// from so an operator can tell a name no bot matches from an empty cell.
export const unmatchedCarrierRow = v.object({
  rowNumber: v.number(),
  carrier: v.string(),
});

// The rows of one clinic tab that no carrier bot could take. A report type that
// lists them fills this in, so an operator can work them by hand instead of
// reading a short report as a complete one.
export const unmatchedCarrierRowsEntry = v.object({
  clinicId: v.id("clinics"),
  clinicName: v.string(),
  tabTitle: v.string(),
  rows: v.array(unmatchedCarrierRow),
});

export const reportRunResult = v.object({
  reportRunId: v.union(v.id("reportRuns"), v.null()),
  assignedClinicCount: v.number(),
  // A run the operator stopped answers with the sheets it read before the
  // request landed, so the results view can tell a short list from a complete
  // one.
  cancelled: v.boolean(),
  sheets: v.array(reportSheetResult),
  // Only the carrier engine has bots to report, so a row report leaves it out.
  inactiveCarriers: v.optional(v.array(inactiveCarriersEntry)),
  // Only a report type that lists the rows no bot could take fills this in, so
  // every other run leaves it out.
  unmatchedCarrierRows: v.optional(v.array(unmatchedCarrierRowsEntry)),
});

export type ReportRow = Infer<typeof reportRow>;
export type ReportBucketResult = Infer<typeof reportBucketResult>;
export type ReportSheetResult = Infer<typeof reportSheetResult>;
export type InactiveCarriersEntry = Infer<typeof inactiveCarriersEntry>;
export type UnmatchedCarrierRow = Infer<typeof unmatchedCarrierRow>;
export type UnmatchedCarrierRowsEntry = Infer<typeof unmatchedCarrierRowsEntry>;
export type ReportRunResult = Infer<typeof reportRunResult>;

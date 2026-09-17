import { ConvexError, v } from "convex/values";
import type { Infer } from "convex/values";

// Errors meant for the user carry a code instead of a sentence, so the client
// can show them in the language the user picked. Values the message needs
// (a name, a count) travel beside the code.
export type AppErrorPayload =
  | { code: "UNAUTHENTICATED" }
  | { code: "INVALID_CREDENTIALS" }
  | { code: "INVALID_USERNAME" }
  | { code: "TOO_MANY_FAILED_ATTEMPTS" }
  | { code: "ACCOUNT_ALREADY_EXISTS" }
  | { code: "ADMIN_REQUIRED" }
  | { code: "ACTIVE_STAFF_REQUIRED" }
  | { code: "OPERATOR_REQUIRED" }
  | { code: "USER_RECORD_MISSING" }
  | { code: "PROFILE_NOT_FOUND" }
  | { code: "CANNOT_CHANGE_OWN_ROLE" }
  | { code: "CANNOT_DISABLE_SELF" }
  | { code: "PASSWORD_TOO_SHORT" }
  | { code: "PASSWORD_SETUP_LINK_INVALID" }
  | { code: "SELECTED_CLINIC_NOT_FOUND" }
  | { code: "CLIENT_NOT_FOUND" }
  | { code: "CLIENT_DISABLED" }
  | { code: "CLINIC_NOT_FOUND" }
  | { code: "CLINIC_NOT_ASSIGNED" }
  | { code: "CLINIC_ASSIGNMENT_LIMIT"; limit: number }
  | { code: "INVALID_SHEET_COLUMN"; column: string }
  | { code: "CLINIC_NAME_TAKEN" }
  | { code: "CLIENT_NAME_TAKEN" }
  | { code: "CLIENT_NAME_INVALID" }
  | { code: "GOOGLE_SHEET_TAKEN" }
  | { code: "CLIENT_HAS_CLINICS"; clientName: string; clinicCount: number }
  | { code: "CLIENT_NAME_REQUIRED" }
  | { code: "CLINIC_NAME_REQUIRED" }
  | { code: "GOOGLE_SHEET_REQUIRED" }
  | { code: "CARRIER_ID_REQUIRED" }
  | { code: "INVALID_DATE_RANGE" }
  | { code: "INVALID_DATE_FORMAT" }
  | { code: "REPORT_TYPE_NAME_TAKEN"; name: string }
  | { code: "REPORT_TYPE_NOT_FOUND" }
  | { code: "REPORT_TYPE_NAME_REQUIRED" }
  | { code: "REPORT_TYPE_GROUP_REQUIRED" }
  | { code: "REPORT_TYPE_GROUP_LIMIT"; limit: number }
  | { code: "REPORT_TYPE_GROUP_KEYS" }
  | { code: "SHEET_RATE_LIMITED" }
  | { code: "CARRIER_SIGN_IN_REJECTED" }
  | { code: "CARRIER_API_UNAVAILABLE" };

export type AppErrorCode = AppErrorPayload["code"];

export function appError(payload: AppErrorPayload): ConvexError<AppErrorPayload> {
  return new ConvexError(payload);
}

// Reads back what `appError` sent, for the calls that catch an error and have
// to decide what to do with it instead of letting it reach the client.
export function appErrorPayloadOf(error: unknown): AppErrorPayload | null {
  if (!(error instanceof ConvexError)) return null;
  const data: unknown = error.data;
  if (typeof data !== "object" || data === null) return null;
  const code = (data as { code?: unknown }).code;
  return typeof code === "string" ? (data as AppErrorPayload) : null;
}

// A report result carries one error per sheet. Failures raised by Google or by
// a clinic's own configuration keep their text, because only the call that
// failed knows what went wrong. A rate limit keeps its code instead: the text
// Google sends is not something to show an operator, and the recovery is the
// same for every sheet.
export const reportSheetError = v.union(
  v.object({ code: v.literal("SHEET_NO_TABS"), startDate: v.string(), endDate: v.string() }),
  v.object({ code: v.literal("SHEET_INVALID_COLUMN"), column: v.string() }),
  v.object({ code: v.literal("SHEET_RATE_LIMITED") }),
  v.object({ code: v.literal("SHEET_FAILED"), message: v.string() }),
  // A clinic the carrier engine could not work: the API turned the app away,
  // or the clinic has no bot left to run a row.
  v.object({ code: v.literal("SHEET_CARRIER_ACCESS_DENIED") }),
  v.object({ code: v.literal("SHEET_CARRIER_CLINIC_UNKNOWN") }),
  v.object({ code: v.literal("SHEET_CARRIER_UNAVAILABLE") }),
  v.object({ code: v.literal("SHEET_NO_CARRIER_BOTS") })
);

export type ReportSheetError = Infer<typeof reportSheetError>;

// Turns a caught error into the error a sheet reports, for the calls that keep
// going after a failure instead of letting it reach the client.
export function sheetErrorFrom(error: unknown): ReportSheetError {
  const payload = appErrorPayloadOf(error);
  if (payload !== null && payload.code === "INVALID_SHEET_COLUMN") {
    return { code: "SHEET_INVALID_COLUMN", column: payload.column };
  }
  if (payload !== null && payload.code === "SHEET_RATE_LIMITED") {
    return { code: "SHEET_RATE_LIMITED" };
  }
  return {
    code: "SHEET_FAILED",
    message: error instanceof Error ? error.message : String(error),
  };
}

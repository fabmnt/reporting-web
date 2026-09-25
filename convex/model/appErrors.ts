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
  | { code: "CLIENT_NOT_FOUND" }
  | { code: "CLIENT_DISABLED" }
  | { code: "CLIENT_NOT_ASSIGNED" }
  | { code: "SERVICE_ACCOUNT_NOT_FOUND" }
  // The account is there and its key signs, but Google will not let it read the
  // sheet. The address travels with the code because sharing the sheet with it
  // is the fix.
  | { code: "SERVICE_ACCOUNT_DENIED"; email: string }
  // Google refused to sign a token with the stored key, so nothing can be read
  // with the account until an administrator replaces the key.
  | { code: "SERVICE_ACCOUNT_KEY_REFUSED"; email: string }
  | { code: "SERVICE_ACCOUNT_LIMIT"; limit: number }
  | { code: "SERVICE_ACCOUNT_EMAIL_INVALID" }
  | { code: "SERVICE_ACCOUNT_EMAIL_TAKEN" }
  | { code: "SERVICE_ACCOUNT_KEY_REQUIRED" }
  | { code: "SERVICE_ACCOUNT_KEY_INVALID" }
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
  | { code: "REPORT_GROUP_NOT_FOUND" }
  | { code: "REPORT_GROUP_NAME_REQUIRED" }
  | { code: "REPORT_GROUP_NAME_TAKEN"; name: string }
  | { code: "REPORT_GROUP_EMPTY" }
  | { code: "REPORT_GROUP_MEMBER_LIMIT"; limit: number }
  | { code: "REPORT_GROUP_LIMIT"; limit: number }
  | { code: "REPORT_RUN_NOT_FOUND" }
  | { code: "REPORT_RUN_ALREADY_STARTED" }
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
// failed knows what went wrong. Errors whose recovery is the same for every
// sheet keep a code instead: the text Google sends is not something to show an
// operator, and the fix is not something a sheet can say on its own.
export const reportSheetError = v.union(
  v.object({ code: v.literal("SHEET_NO_TABS"), startDate: v.string(), endDate: v.string() }),
  v.object({ code: v.literal("SHEET_INVALID_COLUMN"), column: v.string() }),
  v.object({ code: v.literal("SHEET_RATE_LIMITED") }),
  // The account that reads the client's sheets is not there any more, which
  // fails every sheet of that client until an administrator links one again.
  v.object({ code: v.literal("SHEET_SERVICE_ACCOUNT_MISSING") }),
  // The account is linked but Google turns it away, which fails every sheet of
  // that client until someone shares the sheet with its address.
  v.object({ code: v.literal("SHEET_SERVICE_ACCOUNT_DENIED"), email: v.string() }),
  v.object({ code: v.literal("SHEET_FAILED"), message: v.string() }),
  // A clinic the carrier engine could not work: it has no Control Central id
  // yet, the API turned the app away, or the clinic has no bot left to run a
  // row. The first case covers a clinic stored before the directory import,
  // which is the reason the id is still optional in the schema.
  v.object({ code: v.literal("SHEET_CARRIER_ID_MISSING") }),
  v.object({ code: v.literal("SHEET_CARRIER_ACCESS_DENIED") }),
  v.object({ code: v.literal("SHEET_CARRIER_CLINIC_UNKNOWN") }),
  v.object({ code: v.literal("SHEET_CARRIER_UNAVAILABLE") }),
  v.object({ code: v.literal("SHEET_NO_CARRIER_BOTS") })
);

export type ReportSheetError = Infer<typeof reportSheetError>;

// Convex reports a failed node action the way node reports an uncaught
// exception, which puts a prefix in front of the message this code threw. The
// prefix tells the reader nothing about what went wrong, so the message a
// result carries leaves it out.
const UNCAUGHT_PREFIX = "Uncaught Error: ";

/** The message of a caught error, without the prefix a failed node action gets. */
export function messageOf(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.startsWith(UNCAUGHT_PREFIX) ? message.slice(UNCAUGHT_PREFIX.length) : message;
}

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
  if (payload !== null && payload.code === "SERVICE_ACCOUNT_NOT_FOUND") {
    return { code: "SHEET_SERVICE_ACCOUNT_MISSING" };
  }
  if (payload !== null && payload.code === "SERVICE_ACCOUNT_DENIED") {
    return { code: "SHEET_SERVICE_ACCOUNT_DENIED", email: payload.email };
  }
  return {
    code: "SHEET_FAILED",
    message: messageOf(error),
  };
}

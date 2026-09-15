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
  | { code: "INVALID_SHEET_COLUMN"; column: string }
  | { code: "CLINIC_NAME_TAKEN" }
  | { code: "CLIENT_NAME_TAKEN" }
  | { code: "CLIENT_NAME_INVALID" }
  | { code: "GOOGLE_SHEET_TAKEN" }
  | { code: "CLIENT_HAS_CLINICS"; clientName: string; clinicCount: number }
  | { code: "CLIENT_NAME_REQUIRED" }
  | { code: "CLINIC_NAME_REQUIRED" }
  | { code: "GOOGLE_SHEET_REQUIRED" }
  | { code: "INVALID_DATE_RANGE" }
  | { code: "INVALID_DATE_FORMAT" }
  | { code: "REPORT_TYPE_NAME_TAKEN"; name: string }
  | { code: "REPORT_TYPE_NOT_FOUND" }
  | { code: "REPORT_TYPE_NAME_REQUIRED" }
  | { code: "REPORT_TYPE_GROUP_REQUIRED" }
  | { code: "REPORT_TYPE_GROUP_LIMIT"; limit: number }
  | { code: "REPORT_TYPE_GROUP_KEYS" };

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
// failed knows what went wrong.
export const reportSheetError = v.union(
  v.object({ code: v.literal("SHEET_NO_TABS"), startDate: v.string(), endDate: v.string() }),
  v.object({ code: v.literal("SHEET_INVALID_COLUMN"), column: v.string() }),
  v.object({ code: v.literal("SHEET_FAILED"), message: v.string() })
);

export type ReportSheetError = Infer<typeof reportSheetError>;

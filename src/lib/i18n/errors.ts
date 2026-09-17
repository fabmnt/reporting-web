import {
  appErrorPayloadOf,
  type AppErrorPayload,
  type ReportSheetError,
} from "../../../convex/model/appErrors";
import type { Messages } from "./messages";

// Every backend error the user can see, rendered from the code the server sent.
// A code this build does not know yet, and errors thrown by anything else, fall
// back to the message they carry.
function renderAppError(payload: AppErrorPayload, t: Messages): string | null {
  const e = t.errors;

  switch (payload.code) {
    case "UNAUTHENTICATED":
      return e.UNAUTHENTICATED;
    case "INVALID_CREDENTIALS":
      return e.INVALID_CREDENTIALS;
    case "INVALID_USERNAME":
      return e.INVALID_USERNAME;
    case "TOO_MANY_FAILED_ATTEMPTS":
      return e.TOO_MANY_FAILED_ATTEMPTS;
    case "ACCOUNT_ALREADY_EXISTS":
      return e.ACCOUNT_ALREADY_EXISTS;
    case "ADMIN_REQUIRED":
      return e.ADMIN_REQUIRED;
    case "ACTIVE_STAFF_REQUIRED":
      return e.ACTIVE_STAFF_REQUIRED;
    case "OPERATOR_REQUIRED":
      return e.OPERATOR_REQUIRED;
    case "USER_RECORD_MISSING":
      return e.USER_RECORD_MISSING;
    case "PROFILE_NOT_FOUND":
      return e.PROFILE_NOT_FOUND;
    case "CANNOT_CHANGE_OWN_ROLE":
      return e.CANNOT_CHANGE_OWN_ROLE;
    case "CANNOT_DISABLE_SELF":
      return e.CANNOT_DISABLE_SELF;
    case "PASSWORD_TOO_SHORT":
      return e.PASSWORD_TOO_SHORT;
    case "PASSWORD_SETUP_LINK_INVALID":
      return e.PASSWORD_SETUP_LINK_INVALID;
    case "CLIENT_NOT_FOUND":
      return e.CLIENT_NOT_FOUND;
    case "CLIENT_DISABLED":
      return e.CLIENT_DISABLED;
    case "CLINIC_NOT_FOUND":
      return e.CLINIC_NOT_FOUND;
    case "CLINIC_NOT_ASSIGNED":
      return e.CLINIC_NOT_ASSIGNED;
    case "CLINIC_ASSIGNMENT_LIMIT":
      return e.CLINIC_ASSIGNMENT_LIMIT(payload.limit);
    case "INVALID_SHEET_COLUMN":
      return e.INVALID_SHEET_COLUMN(payload.column);
    case "CLINIC_NAME_TAKEN":
      return e.CLINIC_NAME_TAKEN;
    case "CLIENT_NAME_TAKEN":
      return e.CLIENT_NAME_TAKEN;
    case "CLIENT_NAME_INVALID":
      return e.CLIENT_NAME_INVALID;
    case "GOOGLE_SHEET_TAKEN":
      return e.GOOGLE_SHEET_TAKEN;
    case "CLIENT_HAS_CLINICS":
      return e.CLIENT_HAS_CLINICS(payload.clientName, payload.clinicCount);
    case "CLIENT_NAME_REQUIRED":
      return e.CLIENT_NAME_REQUIRED;
    case "CLINIC_NAME_REQUIRED":
      return e.CLINIC_NAME_REQUIRED;
    case "GOOGLE_SHEET_REQUIRED":
      return e.GOOGLE_SHEET_REQUIRED;
    case "CARRIER_ID_REQUIRED":
      return e.CARRIER_ID_REQUIRED;
    case "INVALID_DATE_RANGE":
      return e.INVALID_DATE_RANGE;
    case "INVALID_DATE_FORMAT":
      return e.INVALID_DATE_FORMAT;
    case "REPORT_TYPE_NAME_TAKEN":
      return e.REPORT_TYPE_NAME_TAKEN(payload.name);
    case "REPORT_TYPE_NOT_FOUND":
      return e.REPORT_TYPE_NOT_FOUND;
    case "REPORT_TYPE_NAME_REQUIRED":
      return e.REPORT_TYPE_NAME_REQUIRED;
    case "REPORT_TYPE_GROUP_REQUIRED":
      return e.REPORT_TYPE_GROUP_REQUIRED;
    case "REPORT_TYPE_GROUP_LIMIT":
      return e.REPORT_TYPE_GROUP_LIMIT(payload.limit);
    case "REPORT_TYPE_GROUP_KEYS":
      return e.REPORT_TYPE_GROUP_KEYS;
    case "SHEET_RATE_LIMITED":
      return e.SHEET_RATE_LIMITED;
    case "CARRIER_SIGN_IN_REJECTED":
      return e.CARRIER_SIGN_IN_REJECTED;
    case "CARRIER_API_UNAVAILABLE":
      return e.CARRIER_API_UNAVAILABLE;
    default:
      return null;
  }
}

export function errorText(error: unknown, t: Messages): string {
  if (error instanceof Error) {
    const payload = appErrorPayloadOf(error);
    if (payload !== null) {
      const rendered = renderAppError(payload, t);
      if (rendered !== null) return rendered;
    }
    return error.message;
  }
  return String(error);
}

// A sentence kept in state until it renders, so a language change also rewrites
// text that is already on screen. The resolver travels in an object because
// React reads a bare function passed to a state setter as an updater.
export type LocalizedMessage = { resolve: (t: Messages) => string };

export function localizedMessage(resolve: (t: Messages) => string): LocalizedMessage {
  return { resolve };
}

// A caught value: an Error renders its own translated message, while anything
// else cannot describe itself and renders the operation's fallback instead.
export function localizedError(
  cause: unknown,
  fallback: (t: Messages) => string
): LocalizedMessage {
  return localizedMessage((t) => (cause instanceof Error ? errorText(cause, t) : fallback(t)));
}

// One entry per sheet of a finished run.
export function sheetErrorText(error: ReportSheetError, t: Messages): string {
  switch (error.code) {
    case "SHEET_NO_TABS":
      return t.errors.SHEET_NO_TABS(error.startDate, error.endDate);
    case "SHEET_INVALID_COLUMN":
      return t.errors.SHEET_INVALID_COLUMN(error.column);
    case "SHEET_RATE_LIMITED":
      return t.errors.SHEET_RATE_LIMITED;
    case "SHEET_CARRIER_ID_MISSING":
      return t.errors.SHEET_CARRIER_ID_MISSING;
    case "SHEET_CARRIER_ACCESS_DENIED":
      return t.errors.SHEET_CARRIER_ACCESS_DENIED;
    case "SHEET_CARRIER_CLINIC_UNKNOWN":
      return t.errors.SHEET_CARRIER_CLINIC_UNKNOWN;
    case "SHEET_CARRIER_UNAVAILABLE":
      return t.errors.SHEET_CARRIER_UNAVAILABLE;
    case "SHEET_NO_CARRIER_BOTS":
      return t.errors.SHEET_NO_CARRIER_BOTS;
    case "SHEET_FAILED":
      return error.message;
  }
}

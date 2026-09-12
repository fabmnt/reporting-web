import {
  appErrorPayloadOf,
  type AppErrorPayload,
  type ReportSheetError,
} from "../../../convex/model/appErrors";
import type { Messages } from "./messages";
import { operationLabel } from "./reportLabels";

// Every backend error the user can see, rendered from the code the server sent.
// A code this build does not know yet, and errors thrown by anything else, fall
// back to the message they carry.
function renderAppError(payload: AppErrorPayload, t: Messages): string | null {
  const e = t.errors;

  switch (payload.code) {
    case "UNAUTHENTICATED":
      return e.UNAUTHENTICATED;
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
    case "SELECTED_CLINIC_NOT_FOUND":
      return e.SELECTED_CLINIC_NOT_FOUND;
    case "CLIENT_NOT_FOUND":
      return e.CLIENT_NOT_FOUND;
    case "CLIENT_DISABLED":
      return e.CLIENT_DISABLED;
    case "CLINIC_NOT_FOUND":
      return e.CLINIC_NOT_FOUND;
    case "CLINIC_NOT_ASSIGNED":
      return e.CLINIC_NOT_ASSIGNED;
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
    case "INVALID_DATE_RANGE":
      return e.INVALID_DATE_RANGE;
    case "OPERATION_NOT_CONFIGURED":
      return e.OPERATION_NOT_CONFIGURED(operationLabel(t, payload.operationKey));
    case "OPERATION_NOT_SUPPORTED":
      return e.OPERATION_NOT_SUPPORTED(operationLabel(t, payload.operationKey));
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
    case "BUCKET_KEYS_MISMATCH":
      return e.BUCKET_KEYS_MISMATCH(operationLabel(t, payload.operationKey), payload.expected);
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

// One entry per sheet of a finished run.
export function sheetErrorText(error: ReportSheetError, t: Messages): string {
  switch (error.code) {
    case "SHEET_NO_TABS":
      return t.errors.SHEET_NO_TABS(error.startDate, error.endDate);
    case "SHEET_INVALID_COLUMN":
      return t.errors.SHEET_INVALID_COLUMN(error.column);
    case "SHEET_FAILED":
      return error.message;
  }
}

// One entry per backend error code. Entries that take data receive the values
// the backend sent with the code, already resolved by src/lib/i18n/errors.ts.
export const errors = {
  UNAUTHENTICATED: "Sign in to continue.",
  ADMIN_REQUIRED: "Administrator access is required.",
  ACTIVE_STAFF_REQUIRED: "An active staff account is required.",
  OPERATOR_REQUIRED: "Operator access is required.",
  USER_RECORD_MISSING: "Authenticated user record was not found.",
  PROFILE_NOT_FOUND: "Staff profile was not found.",
  CANNOT_CHANGE_OWN_ROLE: "You cannot change your own role.",
  CANNOT_DISABLE_SELF: "You cannot disable your own account.",
  SELECTED_CLINIC_NOT_FOUND: "One of the selected clinics was not found.",
  CLIENT_NOT_FOUND: "Client was not found.",
  CLIENT_DISABLED: "This client is disabled.",
  CLINIC_NOT_FOUND: "Clinic was not found.",
  CLINIC_NOT_ASSIGNED: "This clinic is not assigned to you.",
  INVALID_SHEET_COLUMN: (column: string) =>
    `Invalid sheet column "${column}". Use letters like A, T, or AB.`,
  CLINIC_NAME_TAKEN: "A clinic with this name already exists for this client.",
  CLIENT_NAME_TAKEN: "A client with this name already exists.",
  CLIENT_NAME_INVALID: "Client name must contain letters or numbers.",
  GOOGLE_SHEET_TAKEN: "Another clinic already uses this Google Sheet.",
  CLIENT_HAS_CLINICS: (clientName: string, clinicCount: number) =>
    `${clientName} still owns ${clinicCount} ${clinicCount === 1 ? "clinic" : "clinics"}. Move or delete them first.`,
  CLIENT_NAME_REQUIRED: "Client name is required.",
  CLINIC_NAME_REQUIRED: "Clinic name is required.",
  GOOGLE_SHEET_REQUIRED: "Google Sheet ID is required.",
  INVALID_DATE_RANGE: "The start date must be on or before the end date.",
  OPERATION_NOT_CONFIGURED: (label: string) => `No conditions are defined for "${label}" yet.`,
  OPERATION_NOT_SUPPORTED: (label: string) => `"${label}" does not support conditions yet.`,
  REPORT_TYPE_NAME_TAKEN: (name: string) => `You already have a report type named "${name}".`,
  REPORT_TYPE_NOT_FOUND: "This report type does not exist.",
  REPORT_TYPE_NAME_REQUIRED: "The report type needs a name.",
  REPORT_TYPE_GROUP_REQUIRED: "A report type needs at least one row group.",
  REPORT_TYPE_GROUP_LIMIT: (limit: number) => `A report type supports up to ${limit} row groups.`,
  REPORT_TYPE_GROUP_KEYS: "Row group keys must be unique and non-empty.",
  BUCKET_KEYS_MISMATCH: (label: string, expected: string) =>
    `Row groups for "${label}" must be exactly ${expected}.`,
  SHEET_NO_TABS: (startDate: string, endDate: string) =>
    `No tabs found between ${startDate} and ${endDate}.`,
  SHEET_INVALID_COLUMN: (column: string) =>
    `Invalid sheet column "${column}". Use letters like A, T, or AB.`,
};

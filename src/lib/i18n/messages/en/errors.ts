// One entry per backend error code. Entries that take data receive the values
// the backend sent with the code, already resolved by src/lib/i18n/errors.ts.
export const errors = {
  UNAUTHENTICATED: "Sign in to continue.",
  INVALID_CREDENTIALS: "Invalid username or password.",
  INVALID_USERNAME:
    "Usernames are 3 to 32 characters and use only letters, numbers, dots, dashes or underscores.",
  TOO_MANY_FAILED_ATTEMPTS: "Too many failed attempts. Try again later.",
  ACCOUNT_ALREADY_EXISTS: "This username is already taken.",
  ADMIN_REQUIRED: "Administrator access is required.",
  ACTIVE_STAFF_REQUIRED: "An active staff account is required.",
  OPERATOR_REQUIRED: "Operator access is required.",
  USER_RECORD_MISSING: "Authenticated user record was not found.",
  PROFILE_NOT_FOUND: "Staff profile was not found.",
  CANNOT_CHANGE_OWN_ROLE: "You cannot change your own role.",
  CANNOT_DISABLE_SELF: "You cannot disable your own account.",
  PASSWORD_TOO_SHORT: "The password must be at least 8 characters long.",
  PASSWORD_SETUP_LINK_INVALID:
    "This link is not valid any more. Ask an administrator for a new one.",
  CLIENT_NOT_FOUND: "Client was not found.",
  CLIENT_DISABLED: "This client is disabled.",
  CLIENT_NOT_ASSIGNED: "This client is not assigned to you.",
  SERVICE_ACCOUNT_NOT_FOUND: "This service account does not exist any more.",
  SERVICE_ACCOUNT_LIMIT: (limit: number) =>
    `You can store up to ${limit} service accounts. Remove one before adding another.`,
  SERVICE_ACCOUNT_EMAIL_INVALID: "The address inside the key file is not a valid address.",
  SERVICE_ACCOUNT_EMAIL_TAKEN: "Another service account already uses this email.",
  SERVICE_ACCOUNT_KEY_REQUIRED: "The service account key is required.",
  SERVICE_ACCOUNT_KEY_INVALID:
    "This is not a service account key file. Paste the JSON file Google gave you.",
  CLINIC_NOT_FOUND: "Clinic was not found.",
  CLINIC_NOT_ASSIGNED: "This clinic is not assigned to you.",
  CLINIC_ASSIGNMENT_LIMIT: (limit: number) =>
    `You can work on up to ${limit} clinics. Remove one before adding another.`,
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
  CARRIER_ID_REQUIRED: "Control Central clinic ID is required.",
  INVALID_DATE_RANGE: "The start date must be on or before the end date.",
  INVALID_DATE_FORMAT: "Dates must use the YYYY-MM-DD format.",
  REPORT_TYPE_NAME_TAKEN: (name: string) => `A report type named "${name}" already exists.`,
  REPORT_TYPE_NOT_FOUND: "This report type does not exist.",
  REPORT_TYPE_NAME_REQUIRED: "The report type needs a name.",
  REPORT_TYPE_GROUP_REQUIRED: "A report type needs at least one row group.",
  REPORT_TYPE_GROUP_LIMIT: (limit: number) => `A report type supports up to ${limit} row groups.`,
  REPORT_TYPE_GROUP_KEYS: "Row group keys must be unique and non-empty.",
  REPORT_GROUP_NOT_FOUND: "This report group does not exist.",
  REPORT_GROUP_NAME_REQUIRED: "The report group needs a name.",
  REPORT_GROUP_NAME_TAKEN: (name: string) => `A report group named "${name}" already exists.`,
  REPORT_GROUP_EMPTY: "Pick at least one client or clinic for the group.",
  REPORT_GROUP_MEMBER_LIMIT: (limit: number) =>
    `A report group holds up to ${limit} clients and clinics.`,
  REPORT_GROUP_LIMIT: (limit: number) => `You can keep up to ${limit} report groups.`,
  REPORT_RUN_NOT_FOUND: "This report run is not available any more.",
  REPORT_RUN_ALREADY_STARTED: "This report run was already started.",
  SHEET_NO_TABS: (startDate: string, endDate: string) =>
    `No tabs found between ${startDate} and ${endDate}.`,
  SHEET_INVALID_COLUMN: (column: string) =>
    `Invalid sheet column "${column}". Use letters like A, T, or AB.`,
  SHEET_RATE_LIMITED: "Google rate limited our requests. Wait a minute and try again.",
  SHEET_SERVICE_ACCOUNT_MISSING:
    "The service account that reads this client's sheets is gone. Ask an administrator to link one again.",
  CARRIER_SIGN_IN_REJECTED:
    "The carrier API rejected the app credentials. Ask an administrator to check them.",
  CARRIER_API_UNAVAILABLE: "The carrier API did not answer. Try again in a moment.",
  SHEET_CARRIER_ID_MISSING:
    "This clinic has no Control Central id, so its carriers cannot be read.",
  SHEET_CARRIER_ACCESS_DENIED: "The carrier API gives the app no access to this clinic.",
  SHEET_CARRIER_CLINIC_UNKNOWN: "The carrier API does not know this clinic.",
  SHEET_CARRIER_UNAVAILABLE:
    "The carrier API did not answer for this clinic. Try again in a moment.",
  SHEET_NO_CARRIER_BOTS: "This clinic has no carrier bot the report can run.",
};

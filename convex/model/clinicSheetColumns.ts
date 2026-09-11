import { v } from "convex/values";

// Mirrors legacy settings_*.py fields:
// UPDATE_STATUS_COLUMN, UPLOAD_STATUS_COLUMN, TYPE_VERIFICATION_COLUMN,
// FILE_URL_COLUMN.
export const clinicSheetColumns = v.object({
  updateStatus: v.optional(v.string()),
  uploadStatus: v.optional(v.string()),
  verificationType: v.optional(v.string()),
  fileUrl: v.optional(v.string()),
});

export type ClinicSheetColumnsInput = {
  updateStatus?: string;
  uploadStatus?: string;
  verificationType?: string;
  fileUrl?: string;
};

export type ResolvedClinicSheetColumns = {
  updateStatus: string;
  uploadStatus: string;
  verificationType: string;
  fileUrl: string;
};

export const CLINIC_SHEET_COLUMN_DEFAULTS: ResolvedClinicSheetColumns = {
  updateStatus: "T",
  uploadStatus: "R",
  verificationType: "N",
  fileUrl: "U",
};

const DEFAULTS = CLINIC_SHEET_COLUMN_DEFAULTS;

export function resolveClinicSheetColumns(
  columns: ClinicSheetColumnsInput | undefined
): ResolvedClinicSheetColumns {
  return {
    updateStatus: columns?.updateStatus?.trim() || DEFAULTS.updateStatus,
    uploadStatus: columns?.uploadStatus?.trim() || DEFAULTS.uploadStatus,
    verificationType: columns?.verificationType?.trim() || DEFAULTS.verificationType,
    fileUrl: columns?.fileUrl?.trim() || DEFAULTS.fileUrl,
  };
}

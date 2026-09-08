import { v } from "convex/values";

// Mirrors legacy settings_*.py fields:
// UPDATE_STATUS_COLUMN, UPLOAD_STATUS_COLUMN, TYPE_VERIFICATION_COLUMN,
// FILE_URL_COLUMN, URL_COLUMN (Luna), COLUMNS (conditional formatting).
export const clinicSheetColumns = v.object({
  updateStatus: v.optional(v.string()),
  uploadStatus: v.optional(v.string()),
  verificationType: v.optional(v.string()),
  fileUrl: v.optional(v.string()),
  url: v.optional(v.string()),
  conditionalFormatting: v.optional(v.string()),
});

export type ClinicSheetColumnsInput = {
  updateStatus?: string;
  uploadStatus?: string;
  verificationType?: string;
  fileUrl?: string;
  url?: string;
  conditionalFormatting?: string;
};

export type ResolvedClinicSheetColumns = {
  updateStatus: string;
  uploadStatus: string;
  verificationType: string;
  fileUrl: string;
  url: string;
  conditionalFormatting: string;
};

const DEFAULTS: ResolvedClinicSheetColumns = {
  updateStatus: "T",
  uploadStatus: "R",
  verificationType: "N",
  fileUrl: "U",
  url: "Y",
  conditionalFormatting: "AC",
};

export function resolveClinicSheetColumns(
  columns: ClinicSheetColumnsInput | undefined
): ResolvedClinicSheetColumns {
  return {
    updateStatus: columns?.updateStatus?.trim() || DEFAULTS.updateStatus,
    uploadStatus: columns?.uploadStatus?.trim() || DEFAULTS.uploadStatus,
    verificationType: columns?.verificationType?.trim() || DEFAULTS.verificationType,
    fileUrl: columns?.fileUrl?.trim() || DEFAULTS.fileUrl,
    url: columns?.url?.trim() || DEFAULTS.url,
    conditionalFormatting: columns?.conditionalFormatting?.trim() || DEFAULTS.conditionalFormatting,
  };
}

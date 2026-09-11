import {
  CLINIC_SHEET_COLUMN_DEFAULTS,
  type ClinicSheetColumnsInput,
} from "../../convex/model/clinicSheetColumns";

export { CLINIC_SHEET_COLUMN_DEFAULTS };

export type SheetColumnFormValues = {
  updateStatus: string;
  uploadStatus: string;
  verificationType: string;
  fileUrl: string;
};

export const EMPTY_SHEET_COLUMN_FORM: SheetColumnFormValues = {
  updateStatus: "",
  uploadStatus: "",
  verificationType: "",
  fileUrl: "",
};

export function sheetColumnsToFormValues(
  sheetColumns: ClinicSheetColumnsInput | undefined
): SheetColumnFormValues {
  return {
    updateStatus: sheetColumns?.updateStatus ?? "",
    uploadStatus: sheetColumns?.uploadStatus ?? "",
    verificationType: sheetColumns?.verificationType ?? "",
    fileUrl: sheetColumns?.fileUrl ?? "",
  };
}

export function buildSheetColumnsInput(
  values: SheetColumnFormValues
): ClinicSheetColumnsInput | undefined {
  const sheetColumns: ClinicSheetColumnsInput = {};
  if (values.updateStatus.trim() !== "") sheetColumns.updateStatus = values.updateStatus.trim();
  if (values.uploadStatus.trim() !== "") sheetColumns.uploadStatus = values.uploadStatus.trim();
  if (values.verificationType.trim() !== "")
    sheetColumns.verificationType = values.verificationType.trim();
  if (values.fileUrl.trim() !== "") sheetColumns.fileUrl = values.fileUrl.trim();
  return Object.keys(sheetColumns).length > 0 ? sheetColumns : undefined;
}

export function formatSheetColumnSummary(
  sheetColumns: ClinicSheetColumnsInput | undefined
): string {
  const updateStatus =
    sheetColumns?.updateStatus?.trim() || CLINIC_SHEET_COLUMN_DEFAULTS.updateStatus;
  const uploadStatus =
    sheetColumns?.uploadStatus?.trim() || CLINIC_SHEET_COLUMN_DEFAULTS.uploadStatus;
  const verificationType =
    sheetColumns?.verificationType?.trim() || CLINIC_SHEET_COLUMN_DEFAULTS.verificationType;
  const fileUrl = sheetColumns?.fileUrl?.trim() || CLINIC_SHEET_COLUMN_DEFAULTS.fileUrl;
  return `${updateStatus}/${uploadStatus}/${verificationType}/${fileUrl}`;
}

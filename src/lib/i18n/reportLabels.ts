import { REPORT_OPERATIONS, type ReportOperationKey } from "../../../convex/model/reportOperations";
import type { Messages } from "./messages";

export function isReportOperationKey(key: string): key is ReportOperationKey {
  return REPORT_OPERATIONS.some((operation) => operation.key === key);
}

// Built-in report types travel from the backend with their English label, so
// the UI looks up the label for the key it received and keeps the English one
// only for a key this build does not know yet.
export function operationLabel(t: Messages, key: string, fallback = key): string {
  return isReportOperationKey(key) ? t.operations[key].label : fallback;
}

export function operationDescription(t: Messages, key: string, fallback = ""): string {
  return isReportOperationKey(key) ? t.operations[key].description : fallback;
}

export function bucketLabel(
  t: Messages,
  operationKey: string,
  bucketKey: string,
  fallback: string
): string {
  if (!isReportOperationKey(operationKey)) return fallback;
  const buckets: Record<string, string> = t.operations[operationKey].buckets;
  return buckets[bucketKey] ?? fallback;
}

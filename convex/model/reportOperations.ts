import type { Infer } from "convex/values";

import { reportOperationKey } from "../schema";

export type ReportOperationKey = Infer<typeof reportOperationKey>;

// Operations live in code, not in a table. The UI renders this list and the
// backend validates args with `reportOperationKey`. Access is decided inside
// each backend function from `staffProfiles` only.
export const REPORT_OPERATIONS: ReadonlyArray<{
  key: ReportOperationKey;
  label: string;
  description: string;
}> = [
  {
    key: "pending-audit",
    label: "Pending audit",
    description: "Rows marked done but still waiting for audit review.",
  },
  {
    key: "pending-execution",
    label: "Pending execution",
    description: "Rows waiting to be executed against carrier data.",
  },
  {
    key: "ready-to-upload",
    label: "Ready to upload",
    description: "Rows verified and ready to upload.",
  },
  {
    key: "smilist-filters",
    label: "Smilist filters",
    description: "Rebuild QA filter views for Smilist sheets.",
  },
  {
    key: "luna-formulas",
    label: "Luna formulas",
    description: "Apply Luna conditional formatting rules.",
  },
  {
    key: "diva-formulas",
    label: "Diva formulas",
    description: "Apply Diva conditional formatting rules.",
  },
  {
    key: "depot-row-highlight",
    label: "Depot row highlight",
    description: "Paint Depot rows by verification status.",
  },
];

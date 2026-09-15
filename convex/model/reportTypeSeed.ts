import type { ReportTypeDraft } from "./reportTypes";

// Old tool rule (get_rows_pending_to_audit_conditions), non-view branch. An
// update status equal to one of these means the row already has an answer.
export const AUDIT_EXCLUDE_STATUS = [
  "DONE",
  "MEDICAL PLAN",
  "UNKNOWN",
  "NOT FOUND",
  "INCIDENCE",
  "NO DENTAL COVERAGE",
  "NOT ELIGIBLE FOR DENTAL BENEFITS",
  "NO PROVIDER",
  "CHECK THAT THERE IS NO TITLE FOR THIS LOCATION",
  "CHECK THERE IS NO TITLE FOR THIS OFFICE BUT PATIENT IS ACTIVE",
  "CHECK THERE IS NO TITLE FOR THIS OFFICE BUT PATIENT IS INACTIVE",
  "CHECK THERE IS NO TITLE FOR THIS OFFICE",
  "WFL",
  "REVIEWED BY QA",
];

// The report the deployment starts with, reproducing the rules the legacy tool
// hardcoded. It is seed data only: once the row exists, administrators own it
// and no code path falls back to these values.
export const PENDING_AUDIT_REPORT_TYPE: ReportTypeDraft = {
  name: "Pending audit",
  description: "Rows marked done but still waiting for audit review.",
  usesVerificationFilter: true,
  buckets: [{ key: "audit", label: "Pending audit" }],
  conditions: {
    buckets: [
      {
        bucketKey: "audit",
        catchAll: false,
        expression: {
          filters: [
            { column: "updateStatus", operator: "notEquals", values: [...AUDIT_EXCLUDE_STATUS] },
            { column: "uploadStatus", operator: "equals", values: ["EMPTY", "UNCHECKED"] },
          ],
          // The legacy DONE + TERMED option is already covered by the first
          // group, because TERMED is not an excluded M marker.
          groups: [
            {
              match: "all",
              clauses: [
                { column: "L", operator: "contains", values: ["DONE"] },
                {
                  column: "M",
                  operator: "notContains",
                  values: ["NO ACTION", "EMPTY", "NEXT VERIFICATION ON"],
                },
              ],
            },
            {
              match: "all",
              clauses: [
                { column: "L", operator: "contains", values: ["CHECK"] },
                { column: "M", operator: "contains", values: ["NOT FOUND"] },
              ],
            },
          ],
        },
      },
    ],
  },
};

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

// Execution statuses of a row that still has to run, and the message values
// that leave it workable. Any other message means the bot already answered it.
// The sheet writes its empty marker as the whole cell, so a value like "not
// empty" is a status of its own and an untouched row is the literal "EMPTY".
export const PENDING_EXECUTION_MARKERS = ["EMPTY", "UNCHECKED", "REVIEW"];
export const WORKABLE_MESSAGE_MARKERS = [
  "EMPTY",
  "TWO-STEP VERIFICATION REQUIRED",
  "NO CONTENT LOADED",
  "REVIEW",
  "FEDERAL",
  "VERIFICATION WITHOUT URLS",
  "IV PROCESS IS RUNNING",
  "WRONG FORM DETECTED",
  "2FA IS REQUIRED",
  "MULTI-MARKED",
];

// The carrier report the deployment starts with. Its bots come from the
// Control Central API, and a row reaches these rules only when its carrier cell
// matches one of those bots. The row counts when it is still waiting for its
// first run, or when it ran and left no file behind. Administrators edit these
// rules like the rules of any other report type: the seed is only the starting
// point.
export const PENDING_EXECUTE_REPORT_TYPE: ReportTypeDraft = {
  name: "Pending to execute",
  description: "Rows a carrier bot of the clinic can still work on.",
  usesVerificationFilter: true,
  buckets: [{ key: "pending", label: "Pending to execute" }],
  conditions: {
    buckets: [
      {
        bucketKey: "pending",
        catchAll: false,
        expression: {
          filters: [],
          groups: [
            {
              match: "all",
              clauses: [
                { column: "L", operator: "equals", values: PENDING_EXECUTION_MARKERS },
                { column: "M", operator: "equals", values: WORKABLE_MESSAGE_MARKERS },
              ],
            },
            {
              // The sheets write "DONE", "DONE BY DIVA", "DONE BY CC" and
              // "*DONE BY DR", so the rule looks for the text inside the cell
              // and not for the whole cell. A check against live rows found no
              // value where looking for the text differs from the word.
              match: "all",
              clauses: [
                { column: "L", operator: "contains", values: ["DONE"] },
                { column: "fileUrl", operator: "equals", values: ["EMPTY"] },
              ],
            },
          ],
        },
      },
    ],
  },
};

// The same report without the carrier match: it reads the rules above on every
// row, whatever carrier the row names, and never asks the Control Central API
// which bots a clinic has. It is the report for a clinic whose bots cannot be
// read and for the rows no bot covers, which the report above leaves to its
// card of rows without a matching bot.
export const PENDING_EXECUTE_ALL_REPORT_TYPE: ReportTypeDraft = {
  name: "Pending to execute (all carriers)",
  description: "Rows that still have to run, whether or not a clinic bot can take them.",
  usesVerificationFilter: true,
  buckets: [{ key: "pending", label: "Pending to execute" }],
  conditions: PENDING_EXECUTE_REPORT_TYPE.conditions,
};

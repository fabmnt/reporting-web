// Labels of the built-in report operations. The keys are the operation keys
// the backend stores and sends, so a new operation shows up here as a missing
// translation instead of a wrong label.
export const operations = {
  "pending-audit": {
    label: "Pending audit",
    description: "Rows marked done but still waiting for audit review.",
    buckets: { audit: "Pending audit" },
  },
  "pending-execution": {
    label: "Pending execution",
    description: "Rows waiting to be executed against carrier data.",
    buckets: {},
  },
  "smilist-filters": {
    label: "Smilist filters",
    description: "Rebuild QA filter views for Smilist sheets.",
    buckets: {},
  },
  "luna-formulas": {
    label: "Luna formulas",
    description: "Apply Luna conditional formatting rules.",
    buckets: {},
  },
  "diva-formulas": {
    label: "Diva formulas",
    description: "Apply Diva conditional formatting rules.",
    buckets: {},
  },
  "depot-row-highlight": {
    label: "Depot row highlight",
    description: "Paint Depot rows by verification status.",
    buckets: {},
  },
};

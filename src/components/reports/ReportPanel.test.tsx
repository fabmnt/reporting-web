import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { getFunctionName } from "convex/server";
import { useAction, useQuery } from "convex/react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { api } from "../../../convex/_generated/api";
import { I18nProvider } from "@/lib/i18n/context";

import { ReportRunner } from "./ReportPanel";

vi.mock("convex/react", () => ({
  useQuery: vi.fn(),
  useAction: vi.fn(),
}));

const useQueryMock = useQuery as unknown as Mock;
const useActionMock = useAction as unknown as Mock;

// `api` is a proxy, so every property access returns a new object. Compare by
// function name instead of by reference.
type AnyFunctionReference = Parameters<typeof getFunctionName>[0];
function nameOf(reference: AnyFunctionReference): string {
  return getFunctionName(reference);
}

const ASSIGNMENT_QUERY = nameOf(api.googleSheets.listAssignedReportClinics);
const TYPES_QUERY = nameOf(api.reportTypes.listRunnable);
const RUN_ACTION = nameOf(api.reports.runSheetReport);

const ASSIGNMENT = {
  clinics: [{ clinicId: "clinic-1", name: "Downtown", clientName: "Smilist" }],
};

const REPORT_TYPES = {
  types: [
    {
      reportTypeId: "type-builtin",
      owner: "builtin",
      name: "Pending audit",
      description: "Rows waiting for QA review before upload.",
      buckets: [{ key: "audit", label: "Pending audit" }],
      conditions: { buckets: [] },
      usesVerificationFilter: true,
    },
    {
      reportTypeId: "type-1",
      owner: "mine",
      name: "Late verifications",
      description: "My own row rules.",
      buckets: [{ key: "b1", label: "Group 1" }],
      conditions: { buckets: [] },
      usesVerificationFilter: false,
    },
  ],
};

// A pending-audit run: it has audit rows but no rows for any other report type.
// Switching the report type after the run would therefore show "No matching
// rows" if the view read live control state.
// Sheet columns of the fixture: leading data columns plus the fixed execution
// (L) and message (M) columns at 11 and 12, like the clinic sheets.
const FIXTURE_HEADERS = [
  "Name",
  "Phone",
  "Email",
  "DOB",
  "Plan",
  "Provider",
  "City",
  "State",
  "Notes",
  "Extra",
  "Tag",
  "Execution",
  "Message",
];

function auditRow(name: string, execution: string): string[] {
  const values = Array.from({ length: FIXTURE_HEADERS.length }, () => "");
  values[0] = name;
  values[11] = execution;
  return values;
}

const PENDING_AUDIT_RUN = {
  reportRunId: null,
  assignedClinicCount: 1,
  sheets: [
    {
      clinicId: "clinic-1",
      clinicName: "Downtown",
      googleSheetId: "sheet-1",
      tabTitle: "2026-09-10",
      headers: FIXTURE_HEADERS,
      bucketRows: [
        {
          bucketKey: "audit",
          label: "Pending audit",
          // Column L (11), the one the pending audit rule reads.
          filterColumns: [11],
          rows: [
            { rowNumber: 2, values: auditRow("Ana", "DONE") },
            { rowNumber: 3, values: auditRow("Luis", "CHECK") },
          ],
        },
      ],
      error: null,
    },
  ],
};

const runReport = vi.fn();

function renderRunner() {
  return render(
    <I18nProvider>
      <ReportRunner />
    </I18nProvider>
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  useQueryMock.mockImplementation((reference: AnyFunctionReference) => {
    const name = nameOf(reference);
    if (name === ASSIGNMENT_QUERY) return ASSIGNMENT;
    if (name === TYPES_QUERY) return REPORT_TYPES;
    return undefined;
  });
  useActionMock.mockImplementation((reference: AnyFunctionReference) =>
    nameOf(reference) === RUN_ACTION ? runReport : vi.fn()
  );
});

describe("ReportRunner", () => {
  it("keeps a finished run's own parameters when the controls change afterward", async () => {
    const user = userEvent.setup();
    runReport.mockResolvedValue(PENDING_AUDIT_RUN);
    renderRunner();

    await user.click(screen.getByRole("button", { name: "Run report" }));

    // The overview list and the cell that picked the row stand in for the run
    // here: a single group carries no heading of its own. The overview and the
    // results both count the run, so the total renders twice.
    const runRows = () => screen.getAllByRole("cell", { name: "DONE" });

    expect(await screen.findByText("'2', '3'")).toBeVisible();
    expect(screen.getAllByText("2 rows")).toHaveLength(2);
    expect(runRows()).toHaveLength(1);

    // Switch the report type without running again.
    await user.click(screen.getByRole("combobox", { name: "Report type" }));
    await user.click(await screen.findByRole("option", { name: "Late verifications" }));

    // The finished run still renders as it ran, not as the new control value.
    expect(screen.getByText("'2', '3'")).toBeVisible();
    expect(screen.getAllByText("2 rows")).toHaveLength(2);
    expect(runRows()).toHaveLength(1);
    expect(screen.queryByText("No matching rows.")).not.toBeInTheDocument();
    expect(runReport).toHaveBeenCalledTimes(1);
  });

  it("shows the columns the conditions read even when they sit past the leading ones", async () => {
    const user = userEvent.setup();
    runReport.mockResolvedValue(PENDING_AUDIT_RUN);
    renderRunner();

    await user.click(screen.getByRole("button", { name: "Run report" }));

    // Column L is outside the leading columns but decided the bucket, so it
    // shows with its header and cells.
    expect(await screen.findByRole("columnheader", { name: "Execution" })).toBeVisible();
    expect(screen.getByRole("cell", { name: "DONE" })).toBeVisible();
    expect(screen.getByRole("cell", { name: "CHECK" })).toBeVisible();

    // A column that is neither leading nor read by the conditions stays out.
    expect(screen.queryByRole("columnheader", { name: "Message" })).not.toBeInTheDocument();
  });

  it("shows form and results skeletons while clinics are loading", () => {
    useQueryMock.mockReturnValue(undefined);
    renderRunner();

    expect(screen.getByLabelText("Loading report page")).toBeInTheDocument();
    expect(screen.getByLabelText("Loading report settings")).toBeInTheDocument();
    expect(screen.getByLabelText("Loading results")).toBeInTheDocument();
  });

  it("shows the placeholder until a run completes", async () => {
    renderRunner();

    expect(screen.getByText("No results yet")).toBeInTheDocument();
    expect(runReport).not.toHaveBeenCalled();
  });
});

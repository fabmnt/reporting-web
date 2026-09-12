import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { getFunctionName } from "convex/server";
import { useAction, useQuery } from "convex/react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { api } from "../../../convex/_generated/api";
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
  usesAllClinics: false,
  clinics: [{ clinicId: "clinic-1", name: "Downtown", clientName: "Smilist" }],
};

const REPORT_TYPES = {
  types: [
    {
      source: "builtin",
      key: "pending-audit",
      label: "Pending audit",
      description: "Rows waiting for QA review before upload.",
      buckets: [{ key: "audit", label: "Pending audit" }],
    },
    {
      source: "builtin",
      key: "ready-to-upload",
      label: "Ready to upload",
      description: "Rows ready to upload and rows that need review.",
      buckets: [
        { key: "ready", label: "Ready to upload" },
        { key: "review", label: "Needs review" },
      ],
    },
  ],
};

// A pending-audit run: it has audit rows but no ready or review rows. Switching
// the report type to "ready to upload" after the run would therefore show
// "No matching rows" if the view read live control state.
const PENDING_AUDIT_RUN = {
  reportRunId: null,
  assignedClinicCount: 1,
  sheets: [
    {
      clinicId: "clinic-1",
      clinicName: "Downtown",
      googleSheetId: "sheet-1",
      tabTitle: "2026-09-10",
      headers: ["Name", "Status"],
      bucketRows: [
        {
          bucketKey: "audit",
          label: "Pending audit",
          rows: [
            { rowNumber: 2, values: ["a"] },
            { rowNumber: 3, values: ["b"] },
          ],
        },
      ],
      error: null,
    },
  ],
};

const runReport = vi.fn();

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
    render(<ReportRunner />);

    await user.click(screen.getByRole("button", { name: "Run report" }));

    const auditHeading = () => screen.getByRole("heading", { name: "Pending audit", level: 4 });

    expect(await screen.findByRole("heading", { name: "Pending audit", level: 4 })).toBeVisible();
    expect(screen.getByText("2 rows")).toBeInTheDocument();

    // Switch the report type without running again.
    await user.click(screen.getByRole("combobox", { name: "Report type" }));
    await user.click(await screen.findByRole("option", { name: "Ready to upload" }));

    // The finished run still renders as it ran, not as the new control value.
    expect(auditHeading()).toBeVisible();
    expect(screen.getByText("2 rows")).toBeInTheDocument();
    expect(screen.queryByText("No matching rows.")).not.toBeInTheDocument();
    expect(runReport).toHaveBeenCalledTimes(1);
  });

  it("shows form and results skeletons while clinics are loading", () => {
    useQueryMock.mockReturnValue(undefined);
    render(<ReportRunner />);

    expect(screen.getByLabelText("Loading report page")).toBeInTheDocument();
    expect(screen.getByLabelText("Loading report settings")).toBeInTheDocument();
    expect(screen.getByLabelText("Loading results")).toBeInTheDocument();
  });

  it("shows the placeholder until a run completes", async () => {
    render(<ReportRunner />);

    expect(screen.getByText("No results yet")).toBeInTheDocument();
    expect(runReport).not.toHaveBeenCalled();
  });
});

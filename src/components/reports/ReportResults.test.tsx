import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import type { Id } from "../../../convex/_generated/dataModel";
import type { ReportSheetError } from "../../../convex/model/appErrors";
import { I18nProvider } from "@/lib/i18n/context";

import {
  ResultsCard,
  UnmatchedCarrierRowsCard,
  type ReportResult,
  type SheetResult,
} from "./ReportResults";

// Headers of the fixture, and one row of it: enough to name a row and read a
// cell back after a tab switch.
const HEADERS = ["Name", "Carrier", "City"];

function sheetRow(rowNumber: number, name: string, city: string) {
  return { rowNumber, values: [name, "ACME", city] };
}

function sheet(
  clinicId: string,
  clinicName: string,
  tabTitle: string,
  rows: Array<{ rowNumber: number; values: string[] }>
): SheetResult {
  return {
    clinicId: clinicId as Id<"clinics">,
    clinicName,
    googleSheetId: `sheet-${clinicId}-${tabTitle}`,
    tabTitle,
    headers: HEADERS,
    // A single group carries no heading of its own, which leaves these tests
    // reading the rows rather than the groups.
    bucketRows: [{ bucketKey: "b1", label: "Group 1", rows, filterColumns: [2] }],
    error: null,
  };
}

function failedSheet(
  clinicId: string,
  clinicName: string,
  tabTitle: string,
  error: ReportSheetError
): SheetResult {
  return { ...sheet(clinicId, clinicName, tabTitle, []), error };
}

function run(sheets: SheetResult[]): ReportResult {
  return {
    reportRunId: null,
    assignedClinicCount: sheets.length,
    cancelled: false,
    sheets,
  };
}

function renderResults(result: ReportResult) {
  return render(
    <I18nProvider>
      <ResultsCard result={result} />
    </I18nProvider>
  );
}

describe("ResultsCard", () => {
  it("names each clinic tab after the clinic and the rows it holds", () => {
    renderResults(
      run([
        sheet("clinic-1", "Abilene", "2026-09-29", [sheetRow(3, "Ana", "Austin")]),
        sheet("clinic-2", "Uptown", "2026-09-11", []),
      ])
    );

    expect(screen.getByRole("tab", { name: "Abilene 1" })).toBeVisible();
    // A clinic whose sheets read nothing has no tab of its own.
    expect(screen.queryByRole("tab", { name: /Uptown/ })).not.toBeInTheDocument();
  });

  it("leaves out the sheets of a clinic that read no rows", () => {
    renderResults(
      run([
        sheet("clinic-1", "Abilene", "2026-09-29", [sheetRow(3, "Ana", "Austin")]),
        sheet("clinic-1", "Abilene", "2026-09-28", []),
      ])
    );

    expect(screen.getByText("2026-09-29")).toBeVisible();
    expect(screen.queryByText("2026-09-28")).not.toBeInTheDocument();
    expect(screen.queryByText("No matching rows.")).not.toBeInTheDocument();
  });

  it("keeps the tab of a clinic whose sheet failed", async () => {
    const user = userEvent.setup();
    renderResults(
      run([
        sheet("clinic-1", "Abilene", "2026-09-29", [sheetRow(3, "Ana", "Austin")]),
        failedSheet("clinic-2", "Uptown", "2026-09-11", { code: "SHEET_NO_CARRIER_BOTS" }),
      ])
    );

    // A failed read has no rows to show, but the error is what the operator
    // came for, so the clinic keeps its tab and its error stays readable.
    const tab = screen.getByRole("tab", { name: /Uptown/ });
    expect(tab).toBeVisible();

    await user.click(tab);

    expect(await screen.findByText("Sheet error")).toBeVisible();
    expect(screen.getByText("This clinic has no carrier bot the report can run.")).toBeVisible();
  });

  it("shows another clinic's rows when its tab is picked", async () => {
    const user = userEvent.setup();
    renderResults(
      run([
        sheet("clinic-1", "Abilene", "2026-09-29", [sheetRow(3, "Ana", "Austin")]),
        sheet("clinic-2", "Uptown", "2026-09-11", [sheetRow(4, "Luis", "Dallas")]),
      ])
    );

    // The first tab opens, and the other clinic's rows stay out of the way.
    expect(screen.getByRole("cell", { name: "Austin" })).toBeVisible();
    expect(screen.queryByRole("cell", { name: "Dallas" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Uptown 1" }));

    expect(await screen.findByRole("cell", { name: "Dallas" })).toBeVisible();
    expect(screen.queryByRole("cell", { name: "Austin" })).not.toBeInTheDocument();
  });

  it("answers with a sentence when no clinic kept a row", () => {
    // Every clinic was read and every row of them was dropped by a filter, so
    // no tab is left: the rows that no bot could take are on their own card.
    renderResults(run([sheet("clinic-1", "Abilene", "2026-09-29", [])]));

    expect(screen.getByText("No matching rows.")).toBeVisible();
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
  });
});

describe("UnmatchedCarrierRowsCard", () => {
  it("shows the carrier cell of every row without a matching bot", () => {
    render(
      <I18nProvider>
        <UnmatchedCarrierRowsCard
          rows={[
            {
              clinicId: "clinic-1" as Id<"clinics">,
              clinicName: "Abilene",
              tabTitle: "2026-09-29",
              rows: [
                { rowNumber: 4, carrier: "United Concordia" },
                { rowNumber: 7, carrier: "" },
              ],
            },
          ]}
        />
      </I18nProvider>
    );

    expect(screen.getByRole("cell", { name: "4" })).toBeVisible();
    expect(screen.getByRole("cell", { name: "United Concordia" })).toBeVisible();
    // A row whose carrier cell is empty is the one case with nothing to name.
    expect(screen.getByRole("cell", { name: "—" })).toBeVisible();
  });
});

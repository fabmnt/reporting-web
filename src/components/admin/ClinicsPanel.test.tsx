import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { getFunctionName } from "convex/server";
import { useMutation, useQuery } from "convex/react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { NavigationContext } from "@/components/app/navigation";
import { I18nProvider } from "@/lib/i18n/context";

import { api } from "../../../convex/_generated/api";
import { AdminClinicsPanel } from "./ClinicsPanel";

vi.mock("convex/react", () => ({
  useQuery: vi.fn(),
  useMutation: vi.fn(),
}));

const useQueryMock = useQuery as unknown as Mock;
const useMutationMock = useMutation as unknown as Mock;

// `api` is a proxy, so every property access returns a new object. Compare by
// function name instead of by reference.
type AnyFunctionReference = Parameters<typeof getFunctionName>[0];
function nameOf(reference: AnyFunctionReference): string {
  return getFunctionName(reference);
}

const ADMIN_ACCOUNT = { role: "admin", status: "active" };

const CLIENTS = [{ clientId: "client-1", key: "smilist", name: "Smilist", isActive: true }];

const CLINICS = [
  {
    clinicId: "clinic-1",
    name: "Downtown",
    googleSheetId: "sheet-1",
    externalClinicId: "400",
    isActive: true,
    clientId: "client-1",
    clientName: "Smilist",
    sheetColumns: {},
    qaGroupKeys: [],
    assignedTo: ["Fabian"],
  },
  {
    clinicId: "clinic-2",
    name: "Uptown",
    googleSheetId: "sheet-2",
    externalClinicId: "401",
    isActive: false,
    clientId: "client-1",
    clientName: "Smilist",
    sheetColumns: {},
    qaGroupKeys: [],
    assignedTo: [],
  },
];

const mutations = {
  createClinic: vi.fn(),
  updateClinic: vi.fn(),
  removeClinic: vi.fn(),
};

const QUERY_NAMES = {
  current: nameOf(api.staffAccounts.current),
  listClients: nameOf(api.clinics.listClients),
  list: nameOf(api.clinics.list),
} as const;

const MUTATION_NAMES = {
  createClinic: nameOf(api.clinics.create),
  updateClinic: nameOf(api.clinics.update),
  removeClinic: nameOf(api.clinics.remove),
} as const;

function mockQueries() {
  useQueryMock.mockImplementation((reference: AnyFunctionReference) => {
    switch (nameOf(reference)) {
      case QUERY_NAMES.current:
        return ADMIN_ACCOUNT;
      case QUERY_NAMES.listClients:
        return { clients: CLIENTS, limit: 200, hasMore: false };
      case QUERY_NAMES.list:
        return { clinics: CLINICS, limit: 500, hasMore: false };
      default:
        return undefined;
    }
  });
}

function mockMutations() {
  useMutationMock.mockImplementation((reference: AnyFunctionReference) => {
    switch (nameOf(reference)) {
      case MUTATION_NAMES.createClinic:
        return mutations.createClinic;
      case MUTATION_NAMES.updateClinic:
        return mutations.updateClinic;
      case MUTATION_NAMES.removeClinic:
        return mutations.removeClinic;
      default:
        return vi.fn();
    }
  });
}

function renderPanel() {
  return render(
    <I18nProvider>
      <NavigationContext.Provider value={{ path: "/admin/clinics", navigate: vi.fn() }}>
        <AdminClinicsPanel />
      </NavigationContext.Provider>
    </I18nProvider>
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  mockQueries();
  mockMutations();
});

describe("AdminClinicsPanel", () => {
  it("lists the clinics it reads", () => {
    renderPanel();

    // Each record is rendered twice: once in the table, once in the cards that
    // replace it on narrow screens.
    expect(screen.getAllByText("Downtown")).toHaveLength(2);
    expect(screen.getAllByText("Uptown")).toHaveLength(2);
  });

  it("blocks an empty clinic submit before calling the server", async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByRole("button", { name: /add clinic/i }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Create clinic" }));

    expect(within(dialog).getByText("Clinic name is required.")).toBeInTheDocument();
    expect(mutations.createClinic).not.toHaveBeenCalled();
  });

  it("shows a failed clinic save inside the clinic dialog", async () => {
    const user = userEvent.setup();
    mutations.updateClinic.mockRejectedValue(new Error("Another clinic already uses this sheet."));
    renderPanel();

    await user.click(
      within(screen.getByRole("row", { name: /Downtown/ })).getByRole("button", { name: "Edit" })
    );
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Save changes" }));

    expect(
      await within(dialog).findByText("Another clinic already uses this sheet.")
    ).toBeVisible();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});

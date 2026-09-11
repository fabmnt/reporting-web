import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { getFunctionName } from "convex/server";
import { useMutation, useQuery } from "convex/react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { NavigationContext } from "@/components/app/navigation";

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
    externalClinicId: null,
    isActive: true,
    clientId: "client-1",
    clientName: "Smilist",
    sheetColumns: {},
    qaGroupKeys: [],
  },
];

const mutations = {
  createClinic: vi.fn(),
  updateClinic: vi.fn(),
  removeClinic: vi.fn(),
  createClient: vi.fn(),
  updateClient: vi.fn(),
  removeClient: vi.fn(),
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
  createClient: nameOf(api.clinics.createClient),
  updateClient: nameOf(api.clinics.updateClient),
  removeClient: nameOf(api.clinics.removeClient),
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
      case MUTATION_NAMES.createClient:
        return mutations.createClient;
      case MUTATION_NAMES.updateClient:
        return mutations.updateClient;
      case MUTATION_NAMES.removeClient:
        return mutations.removeClient;
      default:
        return vi.fn();
    }
  });
}

function renderPanel() {
  return render(
    <NavigationContext.Provider value={{ path: "/admin/clinics", navigate: vi.fn() }}>
      <AdminClinicsPanel />
    </NavigationContext.Provider>
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  mockQueries();
  mockMutations();
});

describe("AdminClinicsPanel", () => {
  it("lists the clients and clinics it reads", () => {
    renderPanel();

    expect(screen.getByText("smilist")).toBeInTheDocument();
    expect(screen.getByText("Downtown")).toBeInTheDocument();
  });

  it("closes the client dialog after a successful create", async () => {
    const user = userEvent.setup();
    mutations.createClient.mockResolvedValue({});
    renderPanel();

    await user.click(screen.getByRole("button", { name: /add client/i }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Client name"), "New Co");
    await user.click(within(dialog).getByRole("button", { name: "Create client" }));

    await waitFor(() => expect(mutations.createClient).toHaveBeenCalledWith({ name: "New Co" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("keeps the client dialog open and shows the server error inside it", async () => {
    const user = userEvent.setup();
    mutations.createClient.mockRejectedValue(new Error("A client with this name already exists."));
    renderPanel();

    await user.click(screen.getByRole("button", { name: /add client/i }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Client name"), "Smilist");
    await user.click(within(dialog).getByRole("button", { name: "Create client" }));

    expect(
      await within(dialog).findByText("A client with this name already exists.")
    ).toBeVisible();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
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

  it("prefills the client form when editing", async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getAllByRole("button", { name: "Edit" })[0]);
    const dialog = await screen.findByRole("dialog");

    expect(within(dialog).getByLabelText("Client name")).toHaveValue("Smilist");
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

  it("shows the delete guard message inside the confirmation dialog", async () => {
    const user = userEvent.setup();
    mutations.removeClient.mockRejectedValue(
      new Error("Smilist still owns 1 clinic. Move or delete them first.")
    );
    renderPanel();

    await user.click(screen.getAllByRole("button", { name: "Delete" })[0]);
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Delete client" }));

    expect(await within(dialog).findByText(/still owns 1 clinic/)).toBeVisible();
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });
});

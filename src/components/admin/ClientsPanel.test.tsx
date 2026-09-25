import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { getFunctionName } from "convex/server";
import { useMutation, useQuery } from "convex/react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { NavigationContext } from "@/components/app/navigation";
import { I18nProvider } from "@/lib/i18n/context";

import { api } from "../../../convex/_generated/api";
import { AdminClientsPanel } from "./ClientsPanel";

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

const CLIENTS = [
  { clientId: "client-1", key: "smilist", name: "Smilist", isActive: true, clinicCount: 12 },
  { clientId: "client-2", key: "old-co", name: "Old Co", isActive: false, clinicCount: 3 },
];

const mutations = {
  createClient: vi.fn(),
  updateClient: vi.fn(),
  removeClient: vi.fn(),
};

const QUERY_NAMES = {
  current: nameOf(api.staffAccounts.current),
  listClients: nameOf(api.clinics.listClients),
  searchClients: nameOf(api.clinics.searchClients),
} as const;

const MUTATION_NAMES = {
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
        return { page: CLIENTS, isDone: true, continueCursor: "" };
      default:
        return undefined;
    }
  });
}

function mockMutations() {
  useMutationMock.mockImplementation((reference: AnyFunctionReference) => {
    switch (nameOf(reference)) {
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
    <I18nProvider>
      <NavigationContext.Provider value={{ path: "/admin/clients", navigate: vi.fn() }}>
        <AdminClientsPanel />
      </NavigationContext.Provider>
    </I18nProvider>
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  mockQueries();
  mockMutations();
});

describe("AdminClientsPanel", () => {
  it("lists the clients it reads", () => {
    renderPanel();

    // Each record is rendered twice: once in the table, once in the cards that
    // replace it on narrow screens.
    expect(screen.getAllByText("smilist")).toHaveLength(2);
    expect(screen.getAllByText("Old Co")).toHaveLength(2);
  });

  it("closes the client dialog after a successful create", async () => {
    const user = userEvent.setup();
    mutations.createClient.mockResolvedValue({});
    renderPanel();

    await user.click(screen.getByRole("button", { name: /add client/i }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Client name"), "New Co");
    await user.click(within(dialog).getByRole("button", { name: "Create client" }));

    // A new client with no service account picked is read with the app's own
    // Google account, which the form sends as an empty link.
    await waitFor(() =>
      expect(mutations.createClient).toHaveBeenCalledWith({
        name: "New Co",
        serviceAccountId: null,
      })
    );
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

  it("prefills the client form when editing", async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(
      within(screen.getByRole("row", { name: /Smilist/ })).getByRole("button", { name: "Edit" })
    );
    const dialog = await screen.findByRole("dialog");

    expect(within(dialog).getByLabelText("Client name")).toHaveValue("Smilist");
  });

  it("shows the delete guard message inside the confirmation dialog", async () => {
    const user = userEvent.setup();
    mutations.removeClient.mockRejectedValue(
      new Error("Smilist still owns 1 clinic. Move or delete them first.")
    );
    renderPanel();

    await user.click(
      within(screen.getByRole("row", { name: /Smilist/ })).getByRole("button", { name: "Delete" })
    );
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Delete client" }));

    expect(await within(dialog).findByText(/still owns 1 clinic/)).toBeVisible();
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });
});

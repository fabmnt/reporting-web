import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { getFunctionName } from "convex/server";
import { useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { NavigationContext } from "@/components/app/navigation";
import { I18nProvider, useI18n } from "@/lib/i18n/context";

import { api } from "../../../convex/_generated/api";
import { AdminAccountsPanel } from "./AdminPanel";

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

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void };
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const ADMIN_ACCOUNT = {
  profileId: "profile-1",
  displayName: "Fabian",
  username: "fabian",
  role: "admin",
  status: "active",
  assignedClinicIds: [],
  isCurrentUser: true,
};

const OPERATOR_ACCOUNT = {
  profileId: "profile-2",
  displayName: "Bea",
  username: "bea",
  role: "operator",
  status: "active",
  assignedClinicIds: [],
  isCurrentUser: false,
};

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

const setAssignedClinics = vi.fn();
const setStatus = vi.fn();

const QUERY_NAMES = {
  current: nameOf(api.staffAccounts.current),
  listManaged: nameOf(api.staffAccounts.listManaged),
  clinics: nameOf(api.clinics.list),
};

const MUTATION_NAMES = {
  setRole: nameOf(api.staffAccounts.setRole),
  setStatus: nameOf(api.staffAccounts.setStatus),
  setAssignedClinics: nameOf(api.staffAccounts.setAssignedClinics),
};

// Stands in for the header toggle, so a test can switch language while a panel
// keeps an error on screen.
function LanguageSwitch() {
  const { setLocale } = useI18n();

  return (
    <button type="button" onClick={() => setLocale("es")}>
      Español
    </button>
  );
}

function renderPanel() {
  return render(
    <I18nProvider>
      <NavigationContext.Provider value={{ path: "/admin", navigate: vi.fn() }}>
        <AdminAccountsPanel />
      </NavigationContext.Provider>
    </I18nProvider>
  );
}

function renderPanelWithLanguageSwitch() {
  return render(
    <I18nProvider>
      <LanguageSwitch />
      <NavigationContext.Provider value={{ path: "/admin", navigate: vi.fn() }}>
        <AdminAccountsPanel />
      </NavigationContext.Provider>
    </I18nProvider>
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  // The environment does not always expose localStorage, and the i18n provider
  // tolerates its absence the same way.
  window.localStorage?.clear();

  useQueryMock.mockImplementation((reference: AnyFunctionReference) => {
    switch (nameOf(reference)) {
      case QUERY_NAMES.current:
        return ADMIN_ACCOUNT;
      case QUERY_NAMES.listManaged:
        return { accounts: [ADMIN_ACCOUNT, OPERATOR_ACCOUNT], limit: 100 };
      case QUERY_NAMES.clinics:
        return { clinics: CLINICS, limit: 500, hasMore: false };
      default:
        return undefined;
    }
  });

  useMutationMock.mockImplementation((reference: AnyFunctionReference) => {
    switch (nameOf(reference)) {
      case MUTATION_NAMES.setStatus:
        return setStatus;
      case MUTATION_NAMES.setAssignedClinics:
        return setAssignedClinics;
      default:
        return vi.fn();
    }
  });
});

describe("AdminAccountsPanel", () => {
  it("closes the assignment dialog after a successful save", async () => {
    const user = userEvent.setup();
    setAssignedClinics.mockResolvedValue(null);
    renderPanel();

    const row = screen.getByRole("row", { name: /Bea/ });
    await user.click(within(row).getByRole("button", { name: "Assign" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Save clinics" }));

    await waitFor(() =>
      expect(setAssignedClinics).toHaveBeenCalledWith({
        profileId: "profile-2",
        clinicIds: [],
      })
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("locks the assignment dialog while the save is pending", async () => {
    const user = userEvent.setup();
    const pending = deferred<null>();
    setAssignedClinics.mockReturnValue(pending.promise);
    renderPanel();

    const row = screen.getByRole("row", { name: /Bea/ });
    await user.click(within(row).getByRole("button", { name: "Assign" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Save clinics" }));

    await waitFor(() => expect(setAssignedClinics).toHaveBeenCalledTimes(1));

    // Dismissal and edits are blocked, so the draft cannot be lost and a second
    // profile cannot reuse this dialog.
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "Save clinics" })).toBeDisabled();
    expect(within(dialog).getByRole("checkbox")).toBeDisabled();
    expect(within(dialog).queryByRole("button", { name: "Close" })).not.toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(setAssignedClinics).toHaveBeenCalledTimes(1);

    pending.resolve(null);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("unlocks the assignment dialog after a failed save", async () => {
    const user = userEvent.setup();
    setAssignedClinics.mockRejectedValue(new Error("Assignment rejected."));
    renderPanel();

    const row = screen.getByRole("row", { name: /Bea/ });
    await user.click(within(row).getByRole("button", { name: "Assign" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Save clinics" }));

    expect(await within(dialog).findByText("Assignment rejected.")).toBeVisible();
    await waitFor(() =>
      expect(within(dialog).getByRole("button", { name: "Save clinics" })).toBeEnabled()
    );
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeEnabled();
    expect(within(dialog).getByRole("checkbox")).toBeEnabled();
  });

  it("keeps the assignment dialog open and shows the failure inside it", async () => {
    const user = userEvent.setup();
    setAssignedClinics.mockRejectedValue(new Error("Only active admins can assign clinics."));
    renderPanel();

    const row = screen.getByRole("row", { name: /Bea/ });
    await user.click(within(row).getByRole("button", { name: "Assign" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Save clinics" }));

    expect(await within(dialog).findByText("Only active admins can assign clinics.")).toBeVisible();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("falls back to the operation message when a rejection is not an Error", async () => {
    const user = userEvent.setup();
    setStatus.mockRejectedValue(undefined);
    renderPanel();

    const row = screen.getByRole("row", { name: /Bea/ });
    await user.click(within(row).getByRole("switch"));

    expect(await screen.findByText("Status update failed.")).toBeVisible();
  });

  it("shows a visible error in the language the user switches to", async () => {
    const user = userEvent.setup();
    setStatus.mockRejectedValue(new ConvexError({ code: "PROFILE_NOT_FOUND" }));
    renderPanelWithLanguageSwitch();

    const row = screen.getByRole("row", { name: /Bea/ });
    await user.click(within(row).getByRole("switch"));

    expect(await screen.findByText("Staff profile was not found.")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Español" }));

    expect(await screen.findByText("No se encontró el perfil del usuario.")).toBeVisible();
  });
});

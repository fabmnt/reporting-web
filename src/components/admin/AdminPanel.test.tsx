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

const setStatus = vi.fn();

const QUERY_NAMES = {
  current: nameOf(api.staffAccounts.current),
  listManaged: nameOf(api.staffAccounts.listManaged),
};

const MUTATION_NAMES = {
  setRole: nameOf(api.staffAccounts.setRole),
  setStatus: nameOf(api.staffAccounts.setStatus),
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
      default:
        return undefined;
    }
  });

  useMutationMock.mockImplementation((reference: AnyFunctionReference) => {
    switch (nameOf(reference)) {
      case MUTATION_NAMES.setStatus:
        return setStatus;
      default:
        return vi.fn();
    }
  });
});

describe("AdminAccountsPanel", () => {
  it("falls back to the operation message when a rejection is not an Error", async () => {
    const user = userEvent.setup();
    setStatus.mockRejectedValue(undefined);
    renderPanel();

    const row = screen.getByRole("row", { name: /Bea/ });
    await user.click(within(row).getByRole("switch"));

    expect(await screen.findByText("Status update failed.")).toBeVisible();
  });

  it("keeps the status switches apart and names the card one", async () => {
    const user = userEvent.setup();
    setStatus.mockResolvedValue(null);
    renderPanel();

    // The table and the cards stay in the DOM together, so the two switches for
    // one account cannot share an id.
    const ids = screen.getAllByRole("switch").map((control) => control.id);
    expect(ids.every((id) => id !== "")).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);

    // The card labels the row with a <dt>, which does not name the switch, so
    // the switch has to say which account it controls.
    await user.click(screen.getByRole("switch", { name: "Account status for Bea" }));

    await waitFor(() =>
      expect(setStatus).toHaveBeenCalledWith({ profileId: "profile-2", status: "disabled" })
    );
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

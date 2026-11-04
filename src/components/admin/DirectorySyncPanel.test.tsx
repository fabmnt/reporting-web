import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { getFunctionName } from "convex/server";
import { useAction, useMutation, useQuery } from "convex/react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { I18nProvider } from "@/lib/i18n/context";

import { api } from "../../../convex/_generated/api";
import { AdminDirectorySyncPanel } from "./DirectorySyncPanel";

vi.mock("convex/react", () => ({
  useQuery: vi.fn(),
  useMutation: vi.fn(),
  useAction: vi.fn(),
}));

// The tab strip reads the navigation context, which this screen test has no
// use for.
vi.mock("@/components/app/AdminTabs", () => ({ AdminTabs: () => null }));

const useQueryMock = useQuery as unknown as Mock;
const useMutationMock = useMutation as unknown as Mock;
const useActionMock = useAction as unknown as Mock;

type AnyFunctionReference = Parameters<typeof getFunctionName>[0];

const MISSING = [
  {
    key: "acme-dental",
    name: "Acme Dental",
    isMissing: true,
    clinics: [
      {
        externalClinicId: "ccc-1",
        name: "Acme North",
        clientName: "Acme Dental",
        googleSheetId: "sheet-1",
        problem: null,
      },
    ],
  },
];

// The list suspends on the load, and React only retries a suspended render
// inside act, so the render is awaited in one.
async function renderPanel(findMissing: Mock, addMissing: Mock) {
  useQueryMock.mockImplementation((reference: AnyFunctionReference) =>
    getFunctionName(reference) === getFunctionName(api.staffAccounts.current)
      ? { role: "admin", status: "active" }
      : undefined
  );
  useActionMock.mockReturnValue(findMissing);
  useMutationMock.mockReturnValue(addMissing);

  await act(async () => {
    render(
      <I18nProvider>
        <AdminDirectorySyncPanel />
      </I18nProvider>
    );
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  window.localStorage?.clear();
});

describe("AdminDirectorySyncPanel", () => {
  it("reloads the list once after an add instead of hanging", async () => {
    const user = userEvent.setup();
    // The reload answers later than the add, as the Control Central API does.
    const findMissing = vi
      .fn()
      .mockResolvedValueOnce(MISSING)
      .mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve([]), 50)));
    const addMissing = vi.fn().mockResolvedValue({
      addedClientKeys: ["acme-dental"],
      addedClinicIds: ["ccc-1"],
      skippedClinicIds: [],
    });
    await renderPanel(findMissing, addMissing);

    await user.click(await screen.findByRole("button", { name: "Add selected" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Add" }));

    expect(
      await screen.findByText("Every Control Central client and clinic is stored here.")
    ).toBeVisible();
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    // One load on open and one after the add. A reload that starts its request
    // while rendering starts a new one every time React retries the render.
    expect(findMissing).toHaveBeenCalledTimes(2);
  });
});

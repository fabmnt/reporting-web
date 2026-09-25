import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { getFunctionName } from "convex/server";
import { useMutation, useQuery } from "convex/react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { I18nProvider } from "@/lib/i18n/context";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { ServiceAccountClientsDialog } from "./ServiceAccountClientsDialog";

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

const ACCOUNT = {
  serviceAccountId: "account-1" as Id<"googleServiceAccounts">,
  email: "reader@example.com",
};

const LINKED_CLIENT = {
  clientId: "client-1",
  key: "winfield-dental",
  name: "Winfield Dental",
  isActive: true,
  serviceAccountId: "account-1",
  serviceAccountEmail: "reader@example.com",
};

/** A client the account could take over, named as the list showed it. */
const OTHER_CLIENT = {
  clientId: "client-2",
  key: "smilist",
  name: "Smilist",
  isActive: true,
  serviceAccountId: null,
  serviceAccountEmail: null,
};

const QUERY_NAMES = {
  accountClients: nameOf(api.clinics.listServiceAccountClients),
  clientChoices: nameOf(api.clinics.listClientChoices),
};

const MUTATION_NAMES = {
  linkClient: nameOf(api.clinics.linkClientServiceAccount),
};

function renderDialog(linkClient: Mock) {
  useQueryMock.mockImplementation((reference: AnyFunctionReference, args: unknown) => {
    if (args === "skip") return undefined;
    switch (nameOf(reference)) {
      case QUERY_NAMES.accountClients:
        return { clients: [LINKED_CLIENT], limit: 2000, hasMore: false };
      case QUERY_NAMES.clientChoices:
        return { clients: [LINKED_CLIENT, OTHER_CLIENT], limit: 500, hasMore: false };
      default:
        return undefined;
    }
  });
  useMutationMock.mockImplementation((reference: AnyFunctionReference) => {
    switch (nameOf(reference)) {
      case MUTATION_NAMES.linkClient:
        return linkClient;
      default:
        return vi.fn();
    }
  });

  return render(
    <I18nProvider>
      <ServiceAccountClientsDialog account={ACCOUNT} onClose={vi.fn()} />
    </I18nProvider>
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  window.localStorage?.clear();
});

describe("ServiceAccountClientsDialog", () => {
  it("links a client without writing back the fields of the row", async () => {
    const user = userEvent.setup();
    const linkClient = vi.fn().mockResolvedValue(null);
    renderDialog(linkClient);

    // The linked client is listed, and only the client this account could take
    // over carries the action.
    expect(screen.getByText("Winfield Dental")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Link" }));

    // The name and the state of the row stay out of the write: the list may be
    // older than the client, and sending them back would undo a rename or a
    // disable that landed in between.
    expect(linkClient).toHaveBeenCalledWith({
      clientId: "client-2",
      serviceAccountId: "account-1",
    });
  });
});

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { getFunctionName, type FunctionReturnType } from "convex/server";
import { useMutation } from "convex/react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { I18nProvider } from "@/lib/i18n/context";
import type { ReportClinic } from "@/lib/reportGroups";

import { ReportGroupsDialog } from "./ReportGroupsDialog";

vi.mock("convex/react", () => ({ useMutation: vi.fn() }));

const useMutationMock = useMutation as unknown as Mock;

type AnyFunctionReference = Parameters<typeof getFunctionName>[0];
function nameOf(reference: AnyFunctionReference): string {
  return getFunctionName(reference);
}

const MUTATION_NAMES = {
  create: nameOf(api.reportGroups.create),
  save: nameOf(api.reportGroups.save),
  remove: nameOf(api.reportGroups.remove),
} as const;

// Two clients, so a whole client can be told apart from a ticked clinic.
const CLINICS: ReportClinic[] = [
  {
    clinicId: "clinic-1" as Id<"clinics">,
    clientId: "client-1" as Id<"clients">,
    name: "Downtown",
    clientName: "Smilist",
  },
  {
    clinicId: "clinic-2" as Id<"clinics">,
    clientId: "client-1" as Id<"clients">,
    name: "Uptown",
    clientName: "Smilist",
  },
  {
    clinicId: "clinic-3" as Id<"clinics">,
    clientId: "client-2" as Id<"clients">,
    name: "Northside",
    clientName: "Mortenson",
  },
];

type GroupRow = FunctionReturnType<typeof api.reportGroups.list>["groups"][number];

const mutations = {
  create: vi.fn(),
  save: vi.fn(),
  remove: vi.fn(),
};

const onOpenChange = vi.fn();

function renderDialog(groups: GroupRow[] = []) {
  return render(
    <I18nProvider>
      <ReportGroupsDialog open onOpenChange={onOpenChange} groups={groups} clinics={CLINICS} />
    </I18nProvider>
  );
}

/** The dialog with a new draft open, which is where the tests type. */
async function openDraft(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "New group" }));
  const dialog = screen.getByRole("dialog");
  await user.type(within(dialog).getByLabelText("Group name"), "Smilist batch");
  return dialog;
}

beforeEach(() => {
  vi.resetAllMocks();
  mutations.create.mockResolvedValue({});
  mutations.save.mockResolvedValue({});
  mutations.remove.mockResolvedValue(null);
  useMutationMock.mockImplementation((reference: AnyFunctionReference) => {
    switch (nameOf(reference)) {
      case MUTATION_NAMES.create:
        return mutations.create;
      case MUTATION_NAMES.save:
        return mutations.save;
      case MUTATION_NAMES.remove:
        return mutations.remove;
      default:
        return vi.fn();
    }
  });
});

describe("ReportGroupsDialog", () => {
  it("saves a whole client as the member of the group", async () => {
    const user = userEvent.setup();
    renderDialog();
    const dialog = await openDraft(user);

    await user.click(within(dialog).getByRole("checkbox", { name: /Smilist/ }));
    await user.click(within(dialog).getByRole("button", { name: "Create group" }));

    // The client stands for its clinics, so no clinic of it is stored beside it.
    await waitFor(() =>
      expect(mutations.create).toHaveBeenCalledWith({
        name: "Smilist batch",
        clientIds: ["client-1"],
        clinicIds: [],
      })
    );
  });

  it("keeps the clinics that stay ticked when a whole client is narrowed", async () => {
    const user = userEvent.setup();
    renderDialog();
    const dialog = await openDraft(user);

    // The client covers both of its clinics, and unticking one of them turns
    // the client into the clinic that stays ticked.
    await user.click(within(dialog).getByRole("checkbox", { name: /Smilist/ }));
    await user.click(within(dialog).getByRole("checkbox", { name: "Uptown" }));
    expect(within(dialog).getByText("1 of 3 clinics covered.")).toBeVisible();

    await user.click(within(dialog).getByRole("button", { name: "Create group" }));

    await waitFor(() =>
      expect(mutations.create).toHaveBeenCalledWith({
        name: "Smilist batch",
        clientIds: [],
        clinicIds: ["clinic-1"],
      })
    );
  });

  it("comes back to the list once the group is saved", async () => {
    const user = userEvent.setup();
    renderDialog();
    const dialog = await openDraft(user);

    await user.click(within(dialog).getByRole("checkbox", { name: /Smilist/ }));
    await user.click(within(dialog).getByRole("button", { name: "Create group" }));

    expect(await screen.findByRole("button", { name: "New group" })).toBeVisible();
    expect(screen.queryByLabelText("Group name")).not.toBeInTheDocument();
  });

  it("holds the dialog open while its save is in flight", async () => {
    const user = userEvent.setup();
    // A save that has not answered yet, which is where the draft has to stay:
    // an answer landing on the next draft would discard it.
    mutations.create.mockReturnValue(new Promise(() => undefined));
    renderDialog();
    const dialog = await openDraft(user);

    await user.click(within(dialog).getByRole("checkbox", { name: /Smilist/ }));
    await user.click(within(dialog).getByRole("button", { name: "Create group" }));
    await user.keyboard("{Escape}");

    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Group name")).toHaveValue("Smilist batch");
  });
});

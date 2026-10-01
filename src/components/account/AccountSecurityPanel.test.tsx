import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { getFunctionName } from "convex/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/lib/i18n/context";
import { AccountSecurityPanel } from "./AccountSecurityPanel";

const mocks = vi.hoisted(() => ({
  begin: vi.fn(),
  confirm: vi.fn(),
  regenerate: vi.fn(),
  disable: vi.fn(),
  status: { enabled: false, recoveryCodesRemaining: 0 },
}));
vi.mock("convex/react", () => ({
  useQuery: () => mocks.status,
  useAction: (ref: Parameters<typeof getFunctionName>[0]) => {
    switch (getFunctionName(ref)) {
      case "twoFactor:beginSetup":
        return mocks.begin;
      case "twoFactor:confirmSetup":
        return mocks.confirm;
      case "twoFactor:regenerateRecoveryCodes":
        return mocks.regenerate;
      case "twoFactor:disable":
        return mocks.disable;
      default:
        throw new Error("Unexpected action");
    }
  },
}));

beforeEach(() => {
  vi.resetAllMocks();
  window.localStorage?.clear();
  mocks.status = { enabled: false, recoveryCodesRemaining: 0 };
  mocks.begin.mockResolvedValue({ secret: "TESTKEY", uri: "otpauth://totp/test?secret=TESTKEY" });
});

// jsdom's Blob has no text(), but its FileReader can read one.
function readBlobText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

/** Enrolls a fresh factor and leaves the given recovery codes on screen. */
async function renderRecoveryCodes(user: ReturnType<typeof userEvent.setup>, codes: string[]) {
  mocks.confirm.mockResolvedValue({ recoveryCodes: codes });
  render(
    <I18nProvider>
      <AccountSecurityPanel />
    </I18nProvider>
  );
  await user.type(screen.getByLabelText("Password"), "current-password");
  await user.click(screen.getByRole("button", { name: "Set up authenticator app" }));
  await user.type(await screen.findByLabelText("Code from the app"), "123456");
  await user.click(screen.getByRole("button", { name: "Turn on" }));
  await screen.findByText(codes[0] ?? "");
}

describe("account security", () => {
  it("verifies the password before setup and carries it through confirmation", async () => {
    const user = userEvent.setup();
    mocks.confirm.mockResolvedValue({ recoveryCodes: ["ABCD-EFGH"] });
    render(
      <I18nProvider>
        <AccountSecurityPanel />
      </I18nProvider>
    );
    await user.type(screen.getByLabelText("Password"), "current-password");
    await user.click(screen.getByRole("button", { name: "Set up authenticator app" }));
    await waitFor(() => expect(mocks.begin).toHaveBeenCalledWith({ password: "current-password" }));
    await user.type(await screen.findByLabelText("Code from the app"), "123456");
    await user.click(screen.getByRole("button", { name: "Turn on" }));
    expect(await screen.findByText("ABCD-EFGH")).toBeVisible();
    expect(mocks.confirm).toHaveBeenCalledWith({ password: "current-password", code: "123456" });
  });

  it("downloads the recovery codes as a text file", async () => {
    const user = userEvent.setup();
    const createObjectURL = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:codes");
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL");
    // The download anchor never enters the document, so the click spy is where
    // the element it built can be inspected.
    const clicked: HTMLAnchorElement[] = [];
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement
    ) {
      clicked.push(this);
    });

    await renderRecoveryCodes(user, ["ABCD-EFGH", "IJKL-MNOP"]);
    await user.click(screen.getByRole("button", { name: "Download .txt" }));

    const blob = createObjectURL.mock.calls[0]?.[0] as Blob;
    expect(blob).toBeInstanceOf(Blob);
    expect(await readBlobText(blob)).toBe("ABCD-EFGH\nIJKL-MNOP\n");
    expect(clicked[0]?.download).toBe("reporting-web-recovery-codes.txt");
    expect(clicked[0]?.href).toBe("blob:codes");
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:codes");

    clickSpy.mockRestore();
    createObjectURL.mockRestore();
    revokeObjectURL.mockRestore();
  });

  it("offers recovery-code replacement when the enrollment response was lost", async () => {
    const user = userEvent.setup();
    const rendered = render(
      <I18nProvider>
        <AccountSecurityPanel />
      </I18nProvider>
    );
    await user.type(screen.getByLabelText("Password"), "current-password");
    await user.click(screen.getByRole("button", { name: "Set up authenticator app" }));
    await screen.findByLabelText("Code from the app");
    mocks.confirm.mockRejectedValue(new Error("Connection lost"));
    await user.type(screen.getByLabelText("Code from the app"), "123456");
    await user.click(screen.getByRole("button", { name: "Turn on" }));
    await screen.findByText("Connection lost");
    mocks.status = { enabled: true, recoveryCodesRemaining: 10 };
    rendered.rerender(
      <I18nProvider>
        <AccountSecurityPanel />
      </I18nProvider>
    );
    expect(screen.queryByLabelText("Code from the app")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Generate new recovery codes" }));
    const dialog = await screen.findByRole("dialog");
    mocks.regenerate.mockResolvedValue({ recoveryCodes: ["NEW-CODE"] });
    await user.type(within(dialog).getByLabelText("Password"), "current-password");
    await user.type(within(dialog).getByLabelText("Code or recovery code"), "654321");
    await user.click(within(dialog).getByRole("button", { name: "Generate codes" }));
    expect(await screen.findByText("NEW-CODE")).toBeVisible();
    expect(mocks.regenerate).toHaveBeenCalledWith({ password: "current-password", code: "654321" });
    expect(mocks.disable).not.toHaveBeenCalled();
  });
});

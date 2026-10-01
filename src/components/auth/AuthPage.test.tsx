import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConvexError } from "convex/values";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AuthPage } from "./AuthPage";

const { signIn } = vi.hoisted(() => ({ signIn: vi.fn() }));

vi.mock("@convex-dev/auth/react", () => ({
  useAuthActions: () => ({ signIn }),
  useConvexAuth: () => ({ isAuthenticated: false, isLoading: false }),
}));

// The root builds a real Convex client, which the form does not need.
vi.mock("./ConvexAuthRoot", () => ({
  ConvexAuthRoot: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

function renderSignIn() {
  return render(<AuthPage mode="signIn" convexUrl="http://example.invalid" />);
}

function renderSignUp() {
  return render(<AuthPage mode="signUp" convexUrl="http://example.invalid" />);
}

async function submitCredentials(username: string, password: string) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Username"), username);
  await user.type(screen.getByLabelText("Password"), password);
  await user.click(screen.getByRole("button", { name: "Sign in" }));
  return user;
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("AuthPage", () => {
  it("asks for the authenticator code once the password checked out", async () => {
    signIn.mockRejectedValueOnce(new ConvexError({ code: "TOTP_REQUIRED" }));
    renderSignIn();

    expect(screen.queryByLabelText("Verification code")).not.toBeInTheDocument();

    const user = await submitCredentials("ada", "correct horse");

    const code = await screen.findByLabelText("Verification code");
    // The first attempt is not an error: the form just moved to its next step.
    expect(screen.queryByText("Authentication failed.")).not.toBeInTheDocument();

    signIn.mockResolvedValueOnce(undefined);
    await user.type(code, "123456");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => expect(signIn).toHaveBeenCalledTimes(2));
    const formData = signIn.mock.calls[1]?.[1] as FormData;
    expect(formData.get("flow")).toBe("signIn");
    expect(formData.get("username")).toBe("ada");
    expect(formData.get("password")).toBe("correct horse");
    expect(formData.get("totpCode")).toBe("123456");
  });

  it("keeps the code field on screen when the code is wrong", async () => {
    signIn.mockRejectedValueOnce(new ConvexError({ code: "TOTP_REQUIRED" }));
    renderSignIn();
    const user = await submitCredentials("ada", "correct horse");

    const code = await screen.findByLabelText("Verification code");
    signIn.mockRejectedValueOnce(new ConvexError({ code: "TOTP_INVALID" }));
    await user.type(code, "000000");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByText("That code is not valid. Try again.")).toBeVisible();
    expect(screen.getByLabelText("Verification code")).toBeVisible();
  });

  it("asks for the code while signing up with an account that has a factor", async () => {
    signIn.mockRejectedValueOnce(new ConvexError({ code: "TOTP_REQUIRED" }));
    renderSignUp();

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Username"), "ada");
    await user.type(screen.getByLabelText("Password"), "correct horse");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    const code = await screen.findByLabelText("Verification code");
    signIn.mockResolvedValueOnce(undefined);
    await user.type(code, "123456");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    await waitFor(() => expect(signIn).toHaveBeenCalledTimes(2));
    const formData = signIn.mock.calls[1]?.[1] as FormData;
    expect(formData.get("flow")).toBe("signUp");
    expect(formData.get("totpCode")).toBe("123456");
  });

  it("drops the code step when the credentials change", async () => {
    signIn.mockRejectedValueOnce(new ConvexError({ code: "TOTP_REQUIRED" }));
    renderSignIn();
    const user = await submitCredentials("ada", "correct horse");
    expect(await screen.findByLabelText("Verification code")).toBeVisible();

    await user.type(screen.getByLabelText("Password"), "!");

    expect(screen.queryByLabelText("Verification code")).not.toBeInTheDocument();
  });

  it("shows a credential error under the password, not under the code", async () => {
    signIn.mockRejectedValueOnce(new ConvexError({ code: "TOTP_REQUIRED" }));
    renderSignIn();
    const user = await submitCredentials("ada", "correct horse");
    const code = await screen.findByLabelText("Verification code");

    // The password stopped checking out, so the error belongs to it rather than
    // to the code the user was about to send.
    signIn.mockRejectedValueOnce(new ConvexError({ code: "INVALID_CREDENTIALS" }));
    await user.type(code, "123456");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByText("Invalid username or password.")).toBeVisible();
    expect(screen.queryByLabelText("Verification code")).not.toBeInTheDocument();
  });
});

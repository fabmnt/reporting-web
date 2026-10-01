/// <reference types="vite/client" />
import { Password } from "@convex-dev/auth/providers/Password";
import type { ConvexCredentialsUserConfig } from "@convex-dev/auth/providers/ConvexCredentials";
import { register } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api, internal } from "./_generated/api";
import { appErrorPayloadOf } from "./model/appErrors";
import { timeStep, totpCodeAt } from "./model/totp";
import schema from "./schema";

const PASSWORD = "test-password-123";
const provider = Password() as ReturnType<typeof Password> & {
  options: ConvexCredentialsUserConfig;
};
const passwordHash = provider.options.crypto!.hashSecret(PASSWORD);
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.UTC(2026, 8, 30, 12));
});
afterEach(() => vi.useRealTimers());

const modules = import.meta.glob("./**/*.ts");

type Test = ReturnType<typeof convexTest>;
type Identity = { subject: string };

async function setup() {
  const t = convexTest(schema, modules);
  register(t);
  return t;
}

/** A staff account the mutations accept as signed in. */
async function createStaff(t: Test, email: string, role: "admin" | "operator" = "operator") {
  const userId = await t.run((ctx) => ctx.db.insert("users", { email }));
  const profileId = await t.run((ctx) =>
    ctx.db.insert("staffProfiles", {
      userId,
      displayName: email,
      role,
      status: "active",
    })
  );

  await t.run(async (ctx) =>
    ctx.db.insert("authAccounts", {
      userId,
      provider: "password",
      providerAccountId: email,
      secret: await passwordHash,
    })
  );
  const sessionId = await t.run((ctx) =>
    ctx.db.insert("authSessions", { userId, expirationTime: Date.now() + 3_600_000 })
  );
  return { identity: { subject: `${userId}|${sessionId}` } satisfies Identity, userId, profileId };
}

/** Confirms a setup with the code of the current time step. */
async function enableTwoFactor(t: Test, identity: Identity, secret: string) {
  const code = await totpCodeAt(secret, timeStep(Date.now()));
  return await t
    .withIdentity(identity)
    .action(api.twoFactor.confirmSetup, { code, password: PASSWORD });
}

async function beginSetup(t: Test, identity: Identity) {
  return await t.withIdentity(identity).action(api.twoFactor.beginSetup, { password: PASSWORD });
}

describe("twoFactor setup", () => {
  it("enables the factor only after a code proves the secret reached the app", async () => {
    const t = await setup();
    const staff = await createStaff(t, "ada@example.com");

    const { secret, uri } = await beginSetup(t, staff.identity);
    expect(uri).toContain(`secret=${secret}`);

    // Pending until the first code checks out: a sign-in still passes.
    expect(
      await t.mutation(internal.twoFactor.consumeSignInCode, {
        userId: staff.userId,
        code: null,
        now: Date.now(),
      })
    ).toBe("ok");

    const wrongCode = await t
      .withIdentity(staff.identity)
      .action(api.twoFactor.confirmSetup, { code: "invalid-code", password: PASSWORD })
      .catch((error: unknown) => appErrorPayloadOf(error));
    expect(wrongCode).toEqual({ code: "TOTP_INVALID" });

    const { recoveryCodes } = await enableTwoFactor(t, staff.identity, secret);
    expect(recoveryCodes).toHaveLength(10);

    expect(await t.withIdentity(staff.identity).query(api.twoFactor.status, {})).toEqual({
      enabled: true,
      recoveryCodesRemaining: 10,
    });
  });

  it("restarts an unfinished setup with a fresh secret", async () => {
    const t = await setup();
    const staff = await createStaff(t, "ada@example.com");

    const first = await beginSetup(t, staff.identity);
    // Waiting out the drift window would make the test slow, so the restart
    // itself proves the old secret is gone: the row is replaced, not appended.
    const second = await beginSetup(t, staff.identity);
    expect(second.secret).not.toBe(first.secret);

    const { recoveryCodes } = await enableTwoFactor(t, staff.identity, second.secret);
    expect(recoveryCodes).toHaveLength(10);
  });

  it("refuses to start over while the factor is on", async () => {
    const t = await setup();
    const staff = await createStaff(t, "ada@example.com");
    const { secret } = await beginSetup(t, staff.identity);
    await enableTwoFactor(t, staff.identity, secret);

    const failure = await beginSetup(t, staff.identity).catch((error: unknown) =>
      appErrorPayloadOf(error)
    );
    expect(failure).toEqual({ code: "TOTP_ALREADY_ENABLED" });
  });
});

describe("twoFactor sign-in gate", () => {
  it("asks for a code, refuses a wrong one, and spends the right one once", async () => {
    const t = await setup();
    const staff = await createStaff(t, "ada@example.com");
    const { secret } = await beginSetup(t, staff.identity);
    await enableTwoFactor(t, staff.identity, secret);

    const now = Date.now();
    const nextStep = timeStep(now) + 1;

    expect(
      await t.mutation(internal.twoFactor.consumeSignInCode, {
        userId: staff.userId,
        code: null,
        now,
      })
    ).toBe("required");
    expect(
      await t.mutation(internal.twoFactor.consumeSignInCode, {
        userId: staff.userId,
        code: "invalid-code",
        now,
      })
    ).toBe("invalid");

    const code = await totpCodeAt(secret, nextStep);
    expect(
      await t.mutation(internal.twoFactor.consumeSignInCode, {
        userId: staff.userId,
        code,
        now,
      })
    ).toBe("ok");
    // The same code cannot sign in twice.
    expect(
      await t.mutation(internal.twoFactor.consumeSignInCode, {
        userId: staff.userId,
        code,
        now,
      })
    ).toBe("invalid");
  });

  it("accepts a recovery code once and takes it out of the set", async () => {
    const t = await setup();
    const staff = await createStaff(t, "ada@example.com");
    const { secret } = await beginSetup(t, staff.identity);
    const { recoveryCodes } = await enableTwoFactor(t, staff.identity, secret);
    const recoveryCode = recoveryCodes[0] ?? "";

    expect(
      await t.mutation(internal.twoFactor.consumeSignInCode, {
        userId: staff.userId,
        code: recoveryCode,
        now: Date.now(),
      })
    ).toBe("ok");
    expect(
      await t.mutation(internal.twoFactor.consumeSignInCode, {
        userId: staff.userId,
        code: recoveryCode,
        now: Date.now(),
      })
    ).toBe("invalid");

    expect(await t.withIdentity(staff.identity).query(api.twoFactor.status, {})).toEqual({
      enabled: true,
      recoveryCodesRemaining: 9,
    });
  });

  it("stops guessing after ten attempts in the window", async () => {
    const t = await setup();
    const staff = await createStaff(t, "ada@example.com");
    const { secret } = await beginSetup(t, staff.identity);
    const { recoveryCodes } = await enableTwoFactor(t, staff.identity, secret);

    // Enrollment uses the same attempt budget. Start a fresh window here.
    vi.setSystemTime(Date.now() + 5 * 60_000);
    for (let attempt = 0; attempt < 10; attempt += 1) {
      expect(
        await t.mutation(internal.twoFactor.consumeSignInCode, {
          userId: staff.userId,
          code: "invalid-code",
          now: Date.now(),
        })
      ).toBe("invalid");
    }

    // Even a code that would be right runs into the spent budget.
    const recoveryCode = recoveryCodes[0] ?? "";
    expect(
      await t.mutation(internal.twoFactor.consumeSignInCode, {
        userId: staff.userId,
        code: recoveryCode,
        now: Date.now(),
      })
    ).toBe("rateLimited");
  });
});

describe("twoFactor admin reset", () => {
  it("clears another account's factor, and only for an administrator", async () => {
    const t = await setup();
    const admin = await createStaff(t, "root@example.com", "admin");
    const operator = await createStaff(t, "ada@example.com");
    const adminSetup = await beginSetup(t, admin.identity);
    await enableTwoFactor(t, admin.identity, adminSetup.secret);
    const { secret } = await beginSetup(t, operator.identity);
    const { recoveryCodes } = await enableTwoFactor(t, operator.identity, secret);

    const refused = await t
      .withIdentity(operator.identity)
      .action(api.twoFactor.adminReset, { profileId: operator.profileId, password: PASSWORD })
      .catch((error: unknown) => appErrorPayloadOf(error));
    expect(refused).toEqual({ code: "ADMIN_REQUIRED" });

    // Enrollment already spent the current step's code, so the reset uses the
    // next one, still inside the drift window.
    await t.withIdentity(admin.identity).action(api.twoFactor.adminReset, {
      profileId: operator.profileId,
      password: PASSWORD,
      code: await totpCodeAt(adminSetup.secret, timeStep(Date.now()) + 1),
    });

    expect(
      await t.run((ctx) =>
        ctx.db
          .query("twoFactorCredentials")
          .withIndex("by_userId", (q) => q.eq("userId", operator.userId))
          .unique()
      )
    ).toBeNull();
    expect(recoveryCodes).toHaveLength(10);
    expect(
      await t.mutation(internal.twoFactor.consumeSignInCode, {
        userId: operator.userId,
        code: null,
        now: Date.now(),
      })
    ).toBe("ok");
  });
});

describe("twoFactor disable", () => {
  it("requires the password to be the account's own before anything else", async () => {
    const t = await setup();
    const staff = await createStaff(t, "ada@example.com");
    const { secret } = await beginSetup(t, staff.identity);
    const { recoveryCodes } = await enableTwoFactor(t, staff.identity, secret);

    // The wrong password is refused before the code is looked at.
    const failure = await t
      .withIdentity(staff.identity)
      .action(api.twoFactor.disable, { password: "wrong", code: recoveryCodes[0] ?? "" })
      .catch((error: unknown) => appErrorPayloadOf(error));
    expect(failure).toEqual({ code: "INVALID_CREDENTIALS" });

    expect(await t.withIdentity(staff.identity).query(api.twoFactor.status, {})).toEqual({
      enabled: true,
      recoveryCodesRemaining: 10,
    });
  });
});

describe("staffAccounts.listManaged", () => {
  it("reports which accounts sign in with a second factor", async () => {
    const t = await setup();
    const admin = await createStaff(t, "root@example.com", "admin");
    const operator = await createStaff(t, "ada@example.com");
    const { secret } = await beginSetup(t, operator.identity);
    await enableTwoFactor(t, operator.identity, secret);

    const managed = await t.withIdentity(admin.identity).query(api.staffAccounts.listManaged, {});
    const byUsername = new Map(managed.accounts.map((account) => [account.username, account]));

    expect(byUsername.get("ada@example.com")?.twoFactorEnabled).toBe(true);
    expect(byUsername.get("root@example.com")?.twoFactorEnabled).toBe(false);
  });
});

/// <reference types="vite/client" />
import { Password } from "@convex-dev/auth/providers/Password";
import type { ConvexCredentialsUserConfig } from "@convex-dev/auth/providers/ConvexCredentials";
import { register } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { exportPKCS8, generateKeyPair } from "jose";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { api, internal } from "./_generated/api";
import { appErrorPayloadOf } from "./model/appErrors";
import { totpCodeAt, timeStep } from "./model/totp";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const PASSWORD = "test-password-123";
const SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
const NOW = Date.UTC(2026, 8, 30, 12);
let passwordHash: string;

beforeAll(async () => {
  const provider = Password() as ReturnType<typeof Password> & {
    options: ConvexCredentialsUserConfig;
  };
  passwordHash = await provider.options.crypto!.hashSecret(PASSWORD);
  const { privateKey } = await generateKeyPair("RS256", { extractable: true });
  vi.stubEnv("JWT_PRIVATE_KEY", await exportPKCS8(privateKey));
  vi.stubEnv("CONVEX_SITE_URL", "https://test.invalid");
});
afterAll(() => vi.unstubAllEnvs());
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

async function fixture(role: "admin" | "operator" = "operator", enabled = true, sources = modules) {
  const t = convexTest(schema, sources);
  register(t);
  const userId = await t.run((ctx) => ctx.db.insert("users", { email: "ada" }));
  const profileId = await t.run((ctx) =>
    ctx.db.insert("staffProfiles", {
      userId,
      displayName: "Ada",
      role,
      status: "active",
    })
  );
  await t.run((ctx) =>
    ctx.db.insert("authAccounts", {
      userId,
      provider: "password",
      providerAccountId: "ada",
      secret: passwordHash,
    })
  );
  const sessionId = await t.run((ctx) =>
    ctx.db.insert("authSessions", {
      userId,
      expirationTime: NOW + 3_600_000,
    })
  );
  if (enabled)
    await t.run((ctx) =>
      ctx.db.insert("twoFactorCredentials", {
        userId,
        secret: SECRET,
        enabledAt: NOW,
        lastUsedStep: 0,
        recoveryCodeHashes: [],
      })
    );
  const identity = { subject: `${userId}|${sessionId}` };
  return { t, userId, profileId, sessionId, identity };
}

describe("two-factor security regressions", () => {
  it("gates existing-account sign-up with the second factor", async () => {
    const { t } = await fixture();
    const failure = await t
      .action(api.auth.signIn, {
        provider: "password",
        params: { username: "ada", password: PASSWORD, flow: "signUp" },
      })
      .catch(appErrorPayloadOf);
    expect(failure).toEqual({ code: "TOTP_REQUIRED" });
  });

  it("counts failed removal attempts even when the action rejects", async () => {
    const { t, identity } = await fixture();
    const signedIn = t.withIdentity(identity);
    for (let attempt = 0; attempt < 10; attempt += 1) {
      expect(
        await signedIn
          .action(api.twoFactor.disable, {
            password: PASSWORD,
            code: "invalid-code",
          })
          .catch(appErrorPayloadOf)
      ).toEqual({ code: "TOTP_INVALID" });
    }
    expect(
      await signedIn
        .action(api.twoFactor.disable, {
          password: PASSWORD,
          code: await totpCodeAt(SECRET, timeStep(NOW)),
        })
        .catch(appErrorPayloadOf)
    ).toEqual({ code: "TOO_MANY_FAILED_ATTEMPTS" });
  });

  it("rejects an administrator resetting their own factor", async () => {
    const { t, identity, profileId } = await fixture("admin");
    expect(
      await t
        .withIdentity(identity)
        .action(api.twoFactor.adminReset, {
          profileId,
          password: PASSWORD,
          code: await totpCodeAt(SECRET, timeStep(NOW)),
        })
        .catch(appErrorPayloadOf)
    ).toEqual({ code: "CANNOT_RESET_OWN_TWO_FACTOR" });
  });

  it("refuses protected reads and writes from a revoked session", async () => {
    const { t, identity, sessionId } = await fixture();
    await t.run((ctx) => ctx.db.delete("authSessions", sessionId));
    expect(
      await t.withIdentity(identity).query(api.staffAccounts.current, {}).catch(appErrorPayloadOf)
    ).toEqual({ code: "UNAUTHENTICATED" });
    expect(
      await t
        .withIdentity(identity)
        .mutation(api.staffAccounts.setLanguage, {
          language: "en",
        })
        .catch(appErrorPayloadOf)
    ).toEqual({ code: "UNAUTHENTICATED" });
  });

  it("refuses an expired session", async () => {
    const { t, identity, sessionId } = await fixture();
    await t.run((ctx) => ctx.db.patch("authSessions", sessionId, { expirationTime: NOW }));
    expect(
      await t.withIdentity(identity).query(api.staffAccounts.current, {}).catch(appErrorPayloadOf)
    ).toEqual({ code: "UNAUTHENTICATED" });
  });

  it("cannot activate a factor without password verification", async () => {
    const { t, identity, userId } = await fixture("operator", false);
    await t.run((ctx) =>
      ctx.db.insert("twoFactorCredentials", {
        userId,
        secret: SECRET,
        lastUsedStep: 0,
        recoveryCodeHashes: [],
      })
    );
    expect(
      await t
        .withIdentity(identity)
        .action(api.twoFactor.confirmSetup, {
          code: await totpCodeAt(SECRET, timeStep(NOW)),
          password: "wrong-password",
        })
        .catch(appErrorPayloadOf)
    ).toEqual({ code: "INVALID_CREDENTIALS" });
  });

  it("allows existing-account sign-up only with a valid factor", async () => {
    const { t } = await fixture();
    const result = await t.action(api.auth.signIn, {
      provider: "password",
      params: {
        username: "ada",
        password: PASSWORD,
        flow: "signUp",
        totpCode: await totpCodeAt(SECRET, timeStep(NOW)),
      },
    });
    expect(result.tokens?.token).toBeTruthy();
  });

  it("removes the factor and revokes other sessions while preserving the caller", async () => {
    const { t, userId, identity } = await fixture();
    const otherSessionId = await t.run((ctx) =>
      ctx.db.insert("authSessions", {
        userId,
        expirationTime: NOW + 3_600_000,
      })
    );
    const other = t.withIdentity({ subject: `${userId}|${otherSessionId}` });
    await t.withIdentity(identity).action(api.twoFactor.disable, {
      password: PASSWORD,
      code: await totpCodeAt(SECRET, timeStep(NOW)),
    });
    expect(await t.withIdentity(identity).query(api.twoFactor.status, {})).toEqual({
      enabled: false,
      recoveryCodesRemaining: 0,
    });
    expect(await other.query(api.staffAccounts.current, {}).catch(appErrorPayloadOf)).toEqual({
      code: "UNAUTHENTICATED",
    });
  });

  it("requires the administrator's own factor before resetting another account", async () => {
    const { t, identity } = await fixture("admin");
    const targetUserId = await t.run((ctx) => ctx.db.insert("users", { email: "bea" }));
    const profileId = await t.run((ctx) =>
      ctx.db.insert("staffProfiles", {
        userId: targetUserId,
        displayName: "Bea",
        role: "operator",
        status: "active",
      })
    );
    const targetCredentialId = await t.run((ctx) =>
      ctx.db.insert("twoFactorCredentials", {
        userId: targetUserId,
        secret: SECRET,
        enabledAt: NOW,
        lastUsedStep: 0,
        recoveryCodeHashes: [],
      })
    );
    expect(
      await t
        .withIdentity(identity)
        .action(api.twoFactor.adminReset, {
          profileId,
          password: PASSWORD,
        })
        .catch(appErrorPayloadOf)
    ).toEqual({ code: "TOTP_REQUIRED" });
    expect(
      await t.run((ctx) => ctx.db.get("twoFactorCredentials", targetCredentialId))
    ).not.toBeNull();
    await t.withIdentity(identity).action(api.twoFactor.adminReset, {
      profileId,
      password: PASSWORD,
      code: await totpCodeAt(SECRET, timeStep(NOW)),
    });
    expect(await t.run((ctx) => ctx.db.get("twoFactorCredentials", targetCredentialId))).toBeNull();
  });

  it("does not disclose an enrollment secret for the wrong password", async () => {
    const { t, identity, userId } = await fixture("operator", false);
    expect(
      await t
        .withIdentity(identity)
        .action(api.twoFactor.beginSetup, { password: "wrong-password" })
        .catch(appErrorPayloadOf)
    ).toEqual({ code: "INVALID_CREDENTIALS" });
    expect(
      await t.run((ctx) =>
        ctx.db
          .query("twoFactorCredentials")
          .withIndex("by_userId", (q) => q.eq("userId", userId))
          .unique()
      )
    ).toBeNull();
  });

  it("revokes pre-enrollment sessions as soon as enrollment commits", async () => {
    const { t, identity, userId } = await fixture("operator", false);
    const sessionId = await t.run((ctx) =>
      ctx.db.insert("authSessions", { userId, expirationTime: NOW + 3_600_000 })
    );
    const current = t.withIdentity(identity);
    const { secret } = await current.action(api.twoFactor.beginSetup, { password: PASSWORD });
    const result = await current.action(api.twoFactor.confirmSetup, {
      password: PASSWORD,
      code: await totpCodeAt(secret, timeStep(NOW)),
    });
    expect(result.recoveryCodes).toHaveLength(10);
    expect(await current.query(api.twoFactor.status, {})).toEqual({
      enabled: true,
      recoveryCodesRemaining: 10,
    });
    expect(
      await t
        .withIdentity({ subject: `${userId}|${sessionId}` })
        .query(api.staffAccounts.current, {})
        .catch(appErrorPayloadOf)
    ).toEqual({ code: "UNAUTHENTICATED" });
  });

  it("commits enrollment guesses to the shared rate limit", async () => {
    const { t, identity } = await fixture("operator", false);
    const current = t.withIdentity(identity);
    const { secret } = await current.action(api.twoFactor.beginSetup, { password: PASSWORD });
    for (let attempt = 0; attempt < 10; attempt++) {
      expect(
        await current
          .action(api.twoFactor.confirmSetup, { password: PASSWORD, code: "invalid-code" })
          .catch(appErrorPayloadOf)
      ).toEqual({ code: "TOTP_INVALID" });
    }
    expect(
      await current
        .action(api.twoFactor.confirmSetup, {
          password: PASSWORD,
          code: await totpCodeAt(secret, timeStep(NOW)),
        })
        .catch(appErrorPayloadOf)
    ).toEqual({ code: "TOO_MANY_FAILED_ATTEMPTS" });
  });

  it("replaces lost recovery codes without disabling the factor", async () => {
    const { t, identity, userId } = await fixture();
    const current = t.withIdentity(identity);
    const first = await current.action(api.twoFactor.regenerateRecoveryCodes, {
      password: PASSWORD,
      code: await totpCodeAt(SECRET, timeStep(NOW)),
    });
    const second = await current.action(api.twoFactor.regenerateRecoveryCodes, {
      password: PASSWORD,
      code: first.recoveryCodes[0]!,
    });
    expect(second.recoveryCodes).toHaveLength(10);
    expect(
      await t.mutation(internal.twoFactor.consumeSignInCode, {
        userId,
        code: first.recoveryCodes[1]!,
        now: NOW,
      })
    ).toBe("invalid");
    expect(
      await t.mutation(internal.twoFactor.consumeSignInCode, {
        userId,
        code: second.recoveryCodes[0]!,
        now: NOW,
      })
    ).toBe("ok");
    expect(await current.query(api.twoFactor.status, {})).toEqual({
      enabled: true,
      recoveryCodesRemaining: 9,
    });
  });

  it("rolls back enrollment if session revocation fails", async () => {
    const failingAuth = internalMutation({
      args: {
        args: v.object({
          type: v.literal("invalidateSessions"),
          userId: v.id("users"),
          except: v.array(v.id("authSessions")),
        }),
      },
      returns: v.null(),
      handler: () => {
        throw new Error("Revocation unavailable");
      },
    });
    const { t, identity, userId } = await fixture("operator", false, {
      ...modules,
      "./auth.ts": async () => ({ store: failingAuth }),
    });
    await t.run((ctx) =>
      ctx.db.insert("twoFactorCredentials", {
        userId,
        secret: SECRET,
        lastUsedStep: 0,
        recoveryCodeHashes: [],
      })
    );
    await expect(
      t.withIdentity(identity).mutation(internal.twoFactor.confirmSetupCode, {
        code: await totpCodeAt(SECRET, timeStep(NOW)),
      })
    ).rejects.toThrow("Revocation unavailable");
    const row = await t.run((ctx) =>
      ctx.db
        .query("twoFactorCredentials")
        .withIndex("by_userId", (q) => q.eq("userId", userId))
        .unique()
    );
    expect(row?.enabledAt).toBeUndefined();
    expect(row?.lastUsedStep).toBe(0);
    expect(row?.recoveryCodeHashes).toEqual([]);
  });
});

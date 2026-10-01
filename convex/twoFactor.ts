import { getAuthSessionId, retrieveAccount } from "@convex-dev/auth/server";
import { MINUTE, RateLimiter } from "@convex-dev/rate-limiter";
import { v, type Infer } from "convex/values";

import { components, internal } from "./_generated/api.js";
import type { Doc, Id } from "./_generated/dataModel";
import {
  action,
  internalMutation,
  internalQuery,
  query,
  type ActionCtx,
  type MutationCtx,
} from "./_generated/server";
import { appError, appErrorPayloadOf } from "./model/appErrors";
import { requireActiveStaff, requireAdmin } from "./model/staff";
import {
  findTotpStep,
  generateRecoveryCodes,
  generateTotpSecret,
  normalizeRecoveryCode,
  totpUri,
} from "./model/totp";
import { sha256Hex } from "./model/tokens";

const ISSUER = "Reporting Web";
const CODE_ATTEMPTS = 10;
const CODE_ATTEMPT_PERIOD = 5 * MINUTE;
const rateLimiter = new RateLimiter(components.rateLimiter, {
  twoFactorCode: { kind: "fixed window", rate: CODE_ATTEMPTS, period: CODE_ATTEMPT_PERIOD },
});
const verdict = v.union(
  v.literal("ok"),
  v.literal("required"),
  v.literal("invalid"),
  v.literal("rateLimited")
);
type Verdict = Infer<typeof verdict>;
const recoveryResult = v.object({ recoveryCodes: v.array(v.string()) });
const recoveryOutcome = v.union(recoveryResult, verdict);
const setupResult = v.object({ secret: v.string(), uri: v.string() });

function requireValidCode(result: Verdict) {
  if (result === "required") throw appError({ code: "TOTP_REQUIRED" });
  if (result === "invalid") throw appError({ code: "TOTP_INVALID" });
  if (result === "rateLimited") throw appError({ code: "TOO_MANY_FAILED_ATTEMPTS" });
}

/** Consumes the shared attempt budget and a valid code in the same transaction.
 * Failure is returned, never thrown, so the caller can commit failed attempts.
 */
async function consumeCode(
  ctx: MutationCtx,
  row: Doc<"twoFactorCredentials">,
  code: string | null,
  now: number
): Promise<Verdict> {
  if (!code?.trim()) return "required";
  const limit = await rateLimiter.limit(ctx, "twoFactorCode", { key: row.userId });
  if (!limit.ok) return "rateLimited";
  const step = await findTotpStep(row.secret, code, now, row.lastUsedStep);
  if (step !== null) {
    await ctx.db.patch("twoFactorCredentials", row._id, { lastUsedStep: step });
    return "ok";
  }
  const hash = await sha256Hex(normalizeRecoveryCode(code));
  if (!row.recoveryCodeHashes.includes(hash)) return "invalid";
  await ctx.db.patch("twoFactorCredentials", row._id, {
    recoveryCodeHashes: row.recoveryCodeHashes.filter((value) => value !== hash),
  });
  return "ok";
}

async function credential(ctx: MutationCtx, userId: Id<"users">) {
  return await ctx.db
    .query("twoFactorCredentials")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .unique();
}

/** Revocation shares the caller's transaction; a failure rolls back the factor change. */
async function revokeOtherSessions(ctx: MutationCtx, userId: Id<"users">) {
  const sessionId = await getAuthSessionId(ctx);
  await ctx.runMutation(internal.auth.store, {
    args: { type: "invalidateSessions", userId, except: sessionId ? [sessionId] : [] },
  });
}

/** Verifies the current account's password using the auth library's attempt limits. */
async function verifyPassword(ctx: ActionCtx, userId: Id<"users">, password: string) {
  const username: string | null = await ctx.runQuery(internal.twoFactor.usernameOf, { userId });
  if (username === null) throw appError({ code: "USER_RECORD_MISSING" });
  try {
    const account = await retrieveAccount(ctx, {
      provider: "password",
      account: { id: username, secret: password },
    });
    if (account === null || account.user._id !== userId)
      throw appError({ code: "INVALID_CREDENTIALS" });
  } catch (cause) {
    if (cause instanceof Error && cause.message.includes("TooManyFailedAttempts")) {
      throw appError({ code: "TOO_MANY_FAILED_ATTEMPTS" });
    }
    const payload = appErrorPayloadOf(cause);
    if (payload !== null) throw cause;
    if (
      cause instanceof Error &&
      (cause.message.includes("InvalidSecret") || cause.message.includes("InvalidAccountId"))
    ) {
      throw appError({ code: "INVALID_CREDENTIALS" });
    }
    throw cause;
  }
}

export const status = query({
  args: {},
  returns: v.object({ enabled: v.boolean(), recoveryCodesRemaining: v.number() }),
  handler: async (ctx) => {
    const { userId } = await requireActiveStaff(ctx);
    const row = await ctx.db
      .query("twoFactorCredentials")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();
    return {
      enabled: row?.enabledAt !== undefined,
      recoveryCodesRemaining: row?.enabledAt === undefined ? 0 : row.recoveryCodeHashes.length,
    };
  },
});

export const beginSetup = action({
  args: { password: v.string() },
  returns: setupResult,
  handler: async (ctx, args): Promise<Infer<typeof setupResult>> => {
    const { userId } = await ctx.runQuery(internal.staffAuth.currentOperator, {});
    await verifyPassword(ctx, userId, args.password);
    return await ctx.runMutation(internal.twoFactor.beginSetupForCurrentUser, {});
  },
});

export const beginSetupForCurrentUser = internalMutation({
  args: {},
  returns: setupResult,
  handler: async (ctx) => {
    const { userId, profile } = await requireActiveStaff(ctx);
    const existing = await credential(ctx, userId);
    if (existing?.enabledAt !== undefined) throw appError({ code: "TOTP_ALREADY_ENABLED" });
    const secret = generateTotpSecret();
    const row = { userId, secret, lastUsedStep: 0, recoveryCodeHashes: [] };
    if (existing === null) await ctx.db.insert("twoFactorCredentials", row);
    else await ctx.db.replace("twoFactorCredentials", existing._id, row);
    const user = await ctx.db.get("users", userId);
    return {
      secret,
      uri: totpUri({ issuer: ISSUER, account: user?.email ?? profile.displayName, secret }),
    };
  },
});

export const confirmSetup = action({
  args: { password: v.string(), code: v.string() },
  returns: recoveryResult,
  handler: async (ctx, args): Promise<Infer<typeof recoveryResult>> => {
    const { userId } = await ctx.runQuery(internal.staffAuth.currentOperator, {});
    await verifyPassword(ctx, userId, args.password);
    const result: Infer<typeof recoveryOutcome> = await ctx.runMutation(
      internal.twoFactor.confirmSetupCode,
      { code: args.code }
    );
    if (typeof result === "string") {
      requireValidCode(result);
      throw new Error("Missing recovery codes after setup");
    }
    return result;
  },
});

export const confirmSetupCode = internalMutation({
  args: { code: v.string() },
  returns: recoveryOutcome,
  handler: async (ctx, args) => {
    const { userId } = await requireActiveStaff(ctx);
    const row = await credential(ctx, userId);
    if (row === null) throw appError({ code: "TOTP_NOT_PENDING" });
    if (row.enabledAt !== undefined) throw appError({ code: "TOTP_ALREADY_ENABLED" });
    const now = Date.now();
    const result = await consumeCode(ctx, row, args.code, now);
    if (result !== "ok") return result;
    const recoveryCodes = generateRecoveryCodes();
    await ctx.db.patch("twoFactorCredentials", row._id, {
      enabledAt: now,
      recoveryCodeHashes: await Promise.all(
        recoveryCodes.map((code) => sha256Hex(normalizeRecoveryCode(code)))
      ),
    });
    await revokeOtherSessions(ctx, userId);
    return { recoveryCodes };
  },
});

export const disable = action({
  args: { password: v.string(), code: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { userId } = await ctx.runQuery(internal.staffAuth.currentOperator, {});
    await verifyPassword(ctx, userId, args.password);
    const result: Verdict = await ctx.runMutation(internal.twoFactor.turnOff, { code: args.code });
    requireValidCode(result);
    return null;
  },
});

export const usernameOf = internalQuery({
  args: { userId: v.id("users") },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args) => (await ctx.db.get("users", args.userId))?.email ?? null,
});

export const turnOff = internalMutation({
  args: { code: v.string() },
  returns: verdict,
  handler: async (ctx, args) => {
    const { userId } = await requireActiveStaff(ctx);
    const row = await credential(ctx, userId);
    if (row?.enabledAt === undefined) throw appError({ code: "TOTP_NOT_ENABLED" });
    const result = await consumeCode(ctx, row, args.code, Date.now());
    if (result !== "ok") return result;
    await ctx.db.delete("twoFactorCredentials", row._id);
    await revokeOtherSessions(ctx, userId);
    return "ok" as const;
  },
});

/** Called before a session exists; the password provider supplies the verified user. */
export const consumeSignInCode = internalMutation({
  args: { userId: v.id("users"), code: v.union(v.string(), v.null()), now: v.number() },
  returns: verdict,
  handler: async (ctx, args) => {
    const row = await credential(ctx, args.userId);
    if (row?.enabledAt === undefined) return "ok" as const;
    return await consumeCode(ctx, row, args.code, args.now);
  },
});

/** A fresh password and the caller's enabled factor protect administrative recovery. */
export const adminReset = action({
  args: { profileId: v.id("staffProfiles"), password: v.string(), code: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { userId, profileId } = await ctx.runQuery(internal.staffAuth.currentAdmin, {});
    if (args.profileId === profileId) throw appError({ code: "CANNOT_RESET_OWN_TWO_FACTOR" });
    await verifyPassword(ctx, userId, args.password);
    const result: Verdict = await ctx.runMutation(internal.twoFactor.consumeSignInCode, {
      userId,
      code: args.code ?? null,
      now: Date.now(),
    });
    requireValidCode(result);
    await ctx.runMutation(internal.twoFactor.resetOtherAccount, { profileId: args.profileId });
    return null;
  },
});

export const resetOtherAccount = internalMutation({
  args: { profileId: v.id("staffProfiles") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { userId } = await requireAdmin(ctx);
    const profile = await ctx.db.get("staffProfiles", args.profileId);
    if (profile === null) throw appError({ code: "PROFILE_NOT_FOUND" });
    if (profile.userId === userId) throw appError({ code: "CANNOT_RESET_OWN_TWO_FACTOR" });
    const row = await credential(ctx, profile.userId);
    if (row !== null) await ctx.db.delete("twoFactorCredentials", row._id);
    await revokeOtherSessions(ctx, profile.userId);
    return null;
  },
});

/** Replaces all old recovery codes after fresh password and factor verification. */
export const regenerateRecoveryCodes = action({
  args: { password: v.string(), code: v.string() },
  returns: recoveryResult,
  handler: async (ctx, args): Promise<Infer<typeof recoveryResult>> => {
    const { userId } = await ctx.runQuery(internal.staffAuth.currentOperator, {});
    await verifyPassword(ctx, userId, args.password);
    const result: Infer<typeof recoveryOutcome> = await ctx.runMutation(
      internal.twoFactor.replaceRecoveryCodes,
      { code: args.code }
    );
    if (typeof result === "string") {
      requireValidCode(result);
      throw new Error("Missing replacement recovery codes");
    }
    return result;
  },
});

export const replaceRecoveryCodes = internalMutation({
  args: { code: v.string() },
  returns: recoveryOutcome,
  handler: async (ctx, args) => {
    const { userId } = await requireActiveStaff(ctx);
    const row = await credential(ctx, userId);
    if (row?.enabledAt === undefined) throw appError({ code: "TOTP_NOT_ENABLED" });
    const result = await consumeCode(ctx, row, args.code, Date.now());
    if (result !== "ok") return result;
    const recoveryCodes = generateRecoveryCodes();
    await ctx.db.patch("twoFactorCredentials", row._id, {
      recoveryCodeHashes: await Promise.all(
        recoveryCodes.map((code) => sha256Hex(normalizeRecoveryCode(code)))
      ),
    });
    return { recoveryCodes };
  },
});

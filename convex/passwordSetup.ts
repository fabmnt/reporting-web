import { invalidateSessions, modifyAccountCredentials } from "@convex-dev/auth/server";
import { v } from "convex/values";

import { internal } from "./_generated/api.js";
import type { Id } from "./_generated/dataModel";
import { action, internalMutation, internalQuery, mutation } from "./_generated/server";
import { appError } from "./model/appErrors";
import { requireAdmin } from "./model/staff";
import { randomHexToken, sha256Hex } from "./model/tokens";

// A link is meant to be used right away, but it stays valid long enough to
// survive a weekend. Creating a new link cancels the previous one.
const LINK_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const TOKEN_BYTES = 32;
// The same minimum the Password provider enforces on sign-up. This flow writes
// the secret itself, so it checks the length itself too.
const MIN_PASSWORD_LENGTH = 8;
// A user has one link at a time. The limit is only a guard against rows left
// behind by an older version of this code.
const MAX_LINKS_PER_USER = 10;

// Creates the one-shot link an administrator sends to a user. The raw token is
// returned once and never stored, so a lost link is replaced, not recovered.
export const createLink = mutation({
  args: { profileId: v.id("staffProfiles") },
  returns: v.object({ token: v.string(), expiresAt: v.number() }),
  handler: async (ctx, args) => {
    const { userId } = await requireAdmin(ctx);
    const profile = await ctx.db.get("staffProfiles", args.profileId);

    if (profile === null) {
      throw appError({ code: "PROFILE_NOT_FOUND" });
    }

    const previousLinks = await ctx.db
      .query("passwordSetupLinks")
      .withIndex("by_userId", (query) => query.eq("userId", profile.userId))
      .take(MAX_LINKS_PER_USER);
    for (const link of previousLinks) {
      await ctx.db.delete("passwordSetupLinks", link._id);
    }

    const token = randomHexToken(TOKEN_BYTES);
    const expiresAt = Date.now() + LINK_TTL_MS;
    await ctx.db.insert("passwordSetupLinks", {
      userId: profile.userId,
      tokenHash: await sha256Hex(token),
      expiresAt,
      createdByUserId: userId,
    });

    return { token, expiresAt };
  },
});

// Runs for anyone holding a valid link, so it never takes a user id: the link
// itself decides whose password is being set.
export const setPassword = action({
  args: { token: v.string(), password: v.string() },
  returns: v.object({ username: v.string() }),
  // Annotated because the handler calls other functions in this file, and
  // TypeScript cannot infer through that cycle.
  handler: async (ctx, args): Promise<{ username: string }> => {
    if (args.password.length < MIN_PASSWORD_LENGTH) {
      throw appError({ code: "PASSWORD_TOO_SHORT" });
    }

    const target: { userId: Id<"users">; username: string } | null = await ctx.runQuery(
      internal.passwordSetup.resolveLink,
      { token: args.token, now: Date.now() }
    );
    if (target === null) {
      throw appError({ code: "PASSWORD_SETUP_LINK_INVALID" });
    }

    // The auth store mutation hashes the secret with the same settings sign-up
    // uses.
    await modifyAccountCredentials(ctx, {
      provider: "password",
      account: { id: target.username, secret: args.password },
    });
    // The old password may be the reason this link was issued, so sessions that
    // started before the change end here. The client signs in again with the
    // password it just set.
    await invalidateSessions(ctx, { userId: target.userId });
    await ctx.runMutation(internal.passwordSetup.consumeLink, { token: args.token });

    return { username: target.username };
  },
});

// The link row is the only copy of the token's hash, so a used or expired link
// is simply gone.
export const resolveLink = internalQuery({
  args: { token: v.string(), now: v.number() },
  returns: v.union(v.object({ userId: v.id("users"), username: v.string() }), v.null()),
  handler: async (ctx, args) => {
    const tokenHash = await sha256Hex(args.token);
    const link = await ctx.db
      .query("passwordSetupLinks")
      .withIndex("by_tokenHash", (query) => query.eq("tokenHash", tokenHash))
      .unique();

    if (link === null || link.expiresAt <= args.now) return null;

    const user = await ctx.db.get("users", link.userId);
    if (user?.email === undefined) return null;

    return { userId: link.userId, username: user.email };
  },
});

export const consumeLink = internalMutation({
  args: { token: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const tokenHash = await sha256Hex(args.token);
    const link = await ctx.db
      .query("passwordSetupLinks")
      .withIndex("by_tokenHash", (query) => query.eq("tokenHash", tokenHash))
      .unique();

    if (link !== null) {
      await ctx.db.delete("passwordSetupLinks", link._id);
    }

    return null;
  },
});

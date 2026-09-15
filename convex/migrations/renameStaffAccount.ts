import { invalidateSessions, modifyAccountCredentials } from "@convex-dev/auth/server";
import { v } from "convex/values";

import { internal } from "../_generated/api.js";
import type { Id } from "../_generated/dataModel";
import { internalAction, internalMutation, internalQuery } from "../_generated/server";
import { randomHexToken } from "../model/tokens";
import { usernameFromInput } from "../model/usernames";

// One-shot migration helper for accounts created before usernames replaced
// email addresses. The sign-in flow validates the username it is given, so an
// account whose stored identifier is an email address can no longer sign in.
// Renaming moves the account to a username and keeps the person, the profile
// and the password history in place.
//
//   npx convex run migrations/renameStaffAccount:renameStaffAccount \
//     '{"currentUsername":"old@example.com","newUsername":"new-name","rotatePassword":true}'
//
// With rotatePassword the run also replaces the secret with a fresh one and
// returns it once, which is the way back in when nobody can sign in to create a
// password link.

const TEMPORARY_PASSWORD_BYTES = 10;

// Grouped so it is easy to read off a screen and type one time.
function temporaryPassword(): string {
  const raw = randomHexToken(TEMPORARY_PASSWORD_BYTES);
  const groups: string[] = [];

  for (let index = 0; index < raw.length; index += 4) {
    groups.push(raw.slice(index, index + 4));
  }

  return groups.join("-");
}

export const renameStaffAccount = internalAction({
  args: {
    currentUsername: v.string(),
    newUsername: v.string(),
    rotatePassword: v.boolean(),
  },
  returns: v.object({
    userId: v.id("users"),
    username: v.string(),
    temporaryPassword: v.union(v.string(), v.null()),
  }),
  // Annotated because the handler calls functions in this file, and TypeScript
  // cannot infer through that cycle.
  handler: async (
    ctx,
    args
  ): Promise<{
    userId: Id<"users">;
    username: string;
    temporaryPassword: string | null;
  }> => {
    const username = usernameFromInput(args.newUsername);
    const target: {
      userId: Id<"users">;
      accountId: Id<"authAccounts">;
      newUsernameTaken: boolean;
    } | null = await ctx.runQuery(internal.migrations.renameStaffAccount.findAccount, {
      currentUsername: args.currentUsername,
      newUsername: username,
    });

    if (target === null) {
      throw new Error(`No account is stored under ${args.currentUsername}.`);
    }
    if (target.newUsernameTaken) {
      throw new Error(`The username ${username} is already taken.`);
    }

    await ctx.runMutation(internal.migrations.renameStaffAccount.renameRows, {
      userId: target.userId,
      accountId: target.accountId,
      username,
    });

    if (!args.rotatePassword) {
      return { userId: target.userId, username, temporaryPassword: null };
    }

    const password = temporaryPassword();
    await modifyAccountCredentials(ctx, {
      provider: "password",
      // The account was renamed above, so the new identifier is the one to
      // write the secret for.
      account: { id: username, secret: password },
    });
    // A password change ends any session that started with the old one.
    await invalidateSessions(ctx, { userId: target.userId });

    return { userId: target.userId, username, temporaryPassword: password };
  },
});

export const findAccount = internalQuery({
  args: { currentUsername: v.string(), newUsername: v.string() },
  returns: v.union(
    v.object({
      userId: v.id("users"),
      accountId: v.id("authAccounts"),
      newUsernameTaken: v.boolean(),
    }),
    v.null()
  ),
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("email", (query) => query.eq("email", args.currentUsername))
      .first();
    if (user === null) return null;

    const account = await ctx.db
      .query("authAccounts")
      .withIndex("providerAndAccountId", (query) =>
        query.eq("provider", "password").eq("providerAccountId", args.currentUsername)
      )
      .first();
    if (account === null) return null;

    const clashing = await ctx.db
      .query("users")
      .withIndex("email", (query) => query.eq("email", args.newUsername))
      .first();

    return {
      userId: user._id,
      accountId: account._id,
      newUsernameTaken: clashing !== null && clashing._id !== user._id,
    };
  },
});

// Both rows carry the identifier: the library reads `users.email` to show the
// username, and sign-in looks accounts up by `providerAccountId`.
export const renameRows = internalMutation({
  args: {
    userId: v.id("users"),
    accountId: v.id("authAccounts"),
    username: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch("users", args.userId, { email: args.username });
    await ctx.db.patch("authAccounts", args.accountId, { providerAccountId: args.username });
    return null;
  },
});

import { createAccount } from "@convex-dev/auth/server";
import { v } from "convex/values";

import { internal } from "../_generated/api.js";
import type { Id } from "../_generated/dataModel";
import { internalAction, internalMutation, internalQuery } from "../_generated/server";
import { randomHexToken } from "../model/tokens";
import { usernameFromInput } from "../model/usernames";
import { staffRole } from "../schema";

// The account secret nobody knows. Legacy passwords are deliberately not
// imported: every migrated person picks their own through a setup link.
const DISCARDED_SECRET_BYTES = 32;

const legacyStaffEntry = v.object({
  username: v.string(),
  displayName: v.string(),
  role: staffRole,
  googleSheetIds: v.array(v.string()),
});

// One-shot migration helper for scripts/import-legacy-staff.ts.
// Creates the missing accounts and their staff profiles. Accounts live in the
// auth tables, which only the auth store mutation may write, so this runs as an
// action and delegates the profile write to a mutation.
export const applyLegacyStaff = internalAction({
  args: { entries: v.array(legacyStaffEntry), dryRun: v.boolean() },
  returns: v.object({
    created: v.array(v.string()),
    existing: v.array(v.string()),
    rejected: v.array(v.string()),
    unmatchedSheets: v.array(v.string()),
  }),
  handler: async (ctx, args) => {
    const created: string[] = [];
    const existing: string[] = [];
    const rejected: string[] = [];
    const unmatchedSheets: string[] = [];

    for (const entry of args.entries) {
      let username: string;
      try {
        username = usernameFromInput(entry.username);
      } catch {
        // The username this app can store is narrower than the legacy key, so
        // report the ones that need a rename instead of failing the whole run.
        rejected.push(entry.username);
        continue;
      }

      const taken: boolean = await ctx.runQuery(
        internal.migrations.importLegacyStaff.usernameTaken,
        { username }
      );
      if (taken) {
        existing.push(username);
        continue;
      }

      if (args.dryRun) {
        created.push(username);
        continue;
      }

      const account = await createAccount(ctx, {
        provider: "password",
        account: { id: username, secret: randomHexToken(DISCARDED_SECRET_BYTES) },
        profile: { email: username },
      });
      const userId: Id<"users"> | undefined = account.user?._id;
      if (userId === undefined) {
        throw new Error(`Could not create the account for ${username}.`);
      }

      const { unmatched }: { unmatched: string[] } = await ctx.runMutation(
        internal.migrations.importLegacyStaff.createProfile,
        {
          userId,
          displayName: entry.displayName,
          role: entry.role,
          googleSheetIds: entry.googleSheetIds,
        }
      );
      unmatchedSheets.push(...unmatched);
      created.push(username);
    }

    return { created, existing, rejected, unmatchedSheets };
  },
});

export const usernameTaken = internalQuery({
  args: { username: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("email", (query) => query.eq("email", args.username))
      .first();

    return user !== null;
  },
});

// Clinics are matched by Google Sheet id, the same key the clinic import uses,
// so a name change on either side does not break the assignment.
export const createProfile = internalMutation({
  args: {
    userId: v.id("users"),
    displayName: v.string(),
    role: staffRole,
    googleSheetIds: v.array(v.string()),
  },
  returns: v.object({ unmatched: v.array(v.string()) }),
  handler: async (ctx, args) => {
    const assignedClinicIds: Id<"clinics">[] = [];
    const unmatched: string[] = [];

    for (const googleSheetId of args.googleSheetIds) {
      const clinic = await ctx.db
        .query("clinics")
        .withIndex("by_googleSheetId", (query) => query.eq("googleSheetId", googleSheetId))
        .first();

      if (clinic === null) {
        unmatched.push(googleSheetId);
        continue;
      }
      if (!assignedClinicIds.includes(clinic._id)) {
        assignedClinicIds.push(clinic._id);
      }
    }

    await ctx.db.insert("staffProfiles", {
      userId: args.userId,
      displayName: args.displayName,
      role: args.role,
      status: "active",
      assignedClinicIds,
    });

    return { unmatched };
  },
});

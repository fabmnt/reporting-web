import { v } from "convex/values";

import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import { appError } from "./model/appErrors";
import { resolveAssignedClinicIds } from "./model/assignments";
import { getStaffProfile, requireAdmin, requireCurrentUserId } from "./model/staff";
import { staffLanguage, staffRole, staffStatus } from "./schema";

// The account identifier is the username. The Password provider keeps it in the
// library-owned `users.email` field, so reads below go through that field and
// expose it as `username` (see `convex/auth.ts`).

const currentAccount = v.object({
  profileId: v.id("staffProfiles"),
  userId: v.id("users"),
  displayName: v.string(),
  username: v.union(v.string(), v.null()),
  role: staffRole,
  status: staffStatus,
  // null means the user has never picked a language, so the app follows the
  // device preference.
  language: v.union(staffLanguage, v.null()),
});

const managedAccount = currentAccount.extend({
  isCurrentUser: v.boolean(),
  assignedClinicIds: v.array(v.id("clinics")),
});

// Matches the cap the rest of the app reads profiles under, so an account that
// exists is an account the admin screens can list and assign.
const MAX_MANAGED_ACCOUNTS = 500;

export const ensureCurrentProfile = mutation({
  args: {},
  returns: currentAccount,
  handler: async (ctx) => {
    const userId = await requireCurrentUserId(ctx);
    const user = await ctx.db.get("users", userId);

    if (user === null) {
      throw appError({ code: "USER_RECORD_MISSING" });
    }

    const existingProfile = await getStaffProfile(ctx, userId);
    if (existingProfile !== null) {
      return {
        profileId: existingProfile._id,
        userId,
        displayName: existingProfile.displayName,
        username: user.email ?? null,
        role: existingProfile.role,
        status: existingProfile.status,
        language: existingProfile.language ?? null,
      };
    }

    const firstUser = await ctx.db
      .query("users")
      .withIndex("by_creation_time")
      .order("asc")
      .first();
    const isFirstAccount = firstUser?._id === userId;
    const role: "admin" | "operator" = isFirstAccount ? "admin" : "operator";
    const status: "active" | "disabled" = isFirstAccount ? "active" : "disabled";
    const displayName = user.name ?? user.email ?? "New account";
    const profileId = await ctx.db.insert("staffProfiles", {
      userId,
      displayName,
      role,
      status,
    });

    return {
      profileId,
      userId,
      displayName,
      username: user.email ?? null,
      role,
      status,
      language: null,
    };
  },
});

export const current = query({
  args: {},
  returns: v.union(currentAccount, v.null()),
  handler: async (ctx) => {
    const userId = await requireCurrentUserId(ctx);
    const profile = await getStaffProfile(ctx, userId);

    if (profile === null) {
      return null;
    }

    const user = await ctx.db.get("users", userId);
    return {
      profileId: profile._id,
      userId,
      displayName: profile.displayName,
      username: user?.email ?? null,
      role: profile.role,
      status: profile.status,
      language: profile.language ?? null,
    };
  },
});

// The user's own language choice. It follows the account, so the app opens in
// the same language on every device.
export const setLanguage = mutation({
  args: { language: staffLanguage },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await requireCurrentUserId(ctx);
    const profile = await getStaffProfile(ctx, userId);

    if (profile === null) {
      throw appError({ code: "PROFILE_NOT_FOUND" });
    }

    await ctx.db.patch("staffProfiles", profile._id, { language: args.language });
    return null;
  },
});

export const listManaged = query({
  args: {},
  returns: v.object({
    accounts: v.array(managedAccount),
    limit: v.number(),
    hasMore: v.boolean(),
  }),
  handler: async (ctx) => {
    const { userId } = await requireAdmin(ctx);
    const profiles = await ctx.db
      .query("staffProfiles")
      .withIndex("by_userId")
      .take(MAX_MANAGED_ACCOUNTS + 1);
    const visibleProfiles = profiles.slice(0, MAX_MANAGED_ACCOUNTS);
    const accounts = await Promise.all(
      visibleProfiles.map(async (profile) => {
        const user = await ctx.db.get("users", profile.userId);
        return {
          profileId: profile._id,
          userId: profile.userId,
          displayName: profile.displayName,
          username: user?.email ?? null,
          role: profile.role,
          status: profile.status,
          language: profile.language ?? null,
          isCurrentUser: profile.userId === userId,
          assignedClinicIds: profile.assignedClinicIds ?? [],
        };
      })
    );

    return {
      accounts,
      limit: MAX_MANAGED_ACCOUNTS,
      hasMore: profiles.length > MAX_MANAGED_ACCOUNTS,
    };
  },
});

export const setRole = mutation({
  args: {
    profileId: v.id("staffProfiles"),
    role: staffRole,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { userId } = await requireAdmin(ctx);
    const target = await ctx.db.get("staffProfiles", args.profileId);

    if (target === null) {
      throw appError({ code: "PROFILE_NOT_FOUND" });
    }
    if (target.userId === userId) {
      throw appError({ code: "CANNOT_CHANGE_OWN_ROLE" });
    }

    await ctx.db.patch("staffProfiles", args.profileId, { role: args.role });
    return null;
  },
});

export const setStatus = mutation({
  args: {
    profileId: v.id("staffProfiles"),
    status: staffStatus,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { userId } = await requireAdmin(ctx);
    const target = await ctx.db.get("staffProfiles", args.profileId);

    if (target === null) {
      throw appError({ code: "PROFILE_NOT_FOUND" });
    }
    if (target.userId === userId) {
      throw appError({ code: "CANNOT_DISABLE_SELF" });
    }

    await ctx.db.patch("staffProfiles", args.profileId, { status: args.status });
    return null;
  },
});

/** The account a change is about, or the error that says it is missing. */
async function requireAssignableProfile(ctx: MutationCtx, profileId: Id<"staffProfiles">) {
  const target = await ctx.db.get("staffProfiles", profileId);
  if (target === null) {
    throw appError({ code: "PROFILE_NOT_FOUND" });
  }
  return target;
}

/**
 * Adds and removes clinics of one client for one account, so the assignment
 * screens can work client by client without holding the whole assignment: a
 * clinic the caller does not mention keeps the state it had, whichever client
 * it belongs to. A screen that shows part of a client's clinics, or only the
 * active ones, therefore cannot drop the rest by saving.
 *
 * Only an active clinic of that client can be added, and a removal is held to
 * the same client, so an edit cannot reach the assignments of another one.
 */
export const setClientAssignment = mutation({
  args: {
    profileId: v.id("staffProfiles"),
    clientId: v.id("clients"),
    addClinicIds: v.array(v.id("clinics")),
    removeClinicIds: v.array(v.id("clinics")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const target = await requireAssignableProfile(ctx, args.profileId);
    const client = await ctx.db.get("clients", args.clientId);
    if (client === null) {
      throw appError({ code: "CLIENT_NOT_FOUND" });
    }

    const assignedClinicIds = await resolveAssignedClinicIds(ctx, target.assignedClinicIds ?? [], {
      clientId: args.clientId,
      addClinicIds: args.addClinicIds,
      removeClinicIds: args.removeClinicIds,
    });

    await ctx.db.patch(args.profileId, { assignedClinicIds });
    return null;
  },
});

/**
 * Adds and removes clinics for one account across every client, so the accounts
 * screen can change a whole assignment in one write: that screen shows all of
 * the account's clinics at once, and a save that landed client by client would
 * leave half of the ticks applied when one of them failed.
 *
 * As in the client-scoped edit, a clinic the caller does not mention keeps the
 * state it had, so a clinic the screen cannot show or tick is never dropped by
 * saving. A removal that names a clinic which no longer exists still leaves the
 * assignment: that id is a leftover nothing can be said about.
 */
export const setAssignments = mutation({
  args: {
    profileId: v.id("staffProfiles"),
    addClinicIds: v.array(v.id("clinics")),
    removeClinicIds: v.array(v.id("clinics")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const target = await requireAssignableProfile(ctx, args.profileId);
    const assignedClinicIds = await resolveAssignedClinicIds(ctx, target.assignedClinicIds ?? [], {
      addClinicIds: args.addClinicIds,
      removeClinicIds: args.removeClinicIds,
    });

    await ctx.db.patch(args.profileId, { assignedClinicIds });
    return null;
  },
});

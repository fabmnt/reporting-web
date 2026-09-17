import { v } from "convex/values";

import type { Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { appError } from "./model/appErrors";
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

const MAX_ASSIGNED_CLINICS = 200;
const MAX_MANAGED_ACCOUNTS = 100;

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

/**
 * Writes what one account runs reports on for a single client: the clinics of
 * that client the caller sends are the ones the account keeps, and every other
 * client keeps what it held. The assignment screens work client by client, so
 * an edit can neither widen nor shrink another client by accident.
 *
 * Only an active clinic of that client can be assigned: the reports skip the
 * rest, so keeping them would fill the cap with clinics nothing reads.
 *
 * The cap covers the whole assignment, not the client's share, because a report
 * reads at most that many clinics. A caller that would pass it gets an error
 * instead of a list that silently drops the clinics at the end.
 */
export const setClientAssignment = mutation({
  args: {
    profileId: v.id("staffProfiles"),
    clientId: v.id("clients"),
    clinicIds: v.array(v.id("clinics")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const target = await ctx.db.get("staffProfiles", args.profileId);
    if (target === null) {
      throw appError({ code: "PROFILE_NOT_FOUND" });
    }
    const client = await ctx.db.get("clients", args.clientId);
    if (client === null) {
      throw appError({ code: "CLIENT_NOT_FOUND" });
    }

    const requested: Id<"clinics">[] = [];
    const seen = new Set<string>();
    for (const clinicId of args.clinicIds) {
      if (seen.has(clinicId)) continue;
      seen.add(clinicId);

      const clinic = await ctx.db.get("clinics", clinicId);
      if (clinic === null || clinic.clientId !== args.clientId || !clinic.isActive) {
        throw appError({ code: "CLINIC_NOT_FOUND" });
      }
      requested.push(clinicId);
    }

    const kept: Id<"clinics">[] = [];
    for (const clinicId of target.assignedClinicIds ?? []) {
      const clinic = await ctx.db.get("clinics", clinicId);
      // A clinic deleted since it was assigned can never be read again, so it
      // leaves with this write instead of holding room in the cap. An inactive
      // one stays: enabling it again restores the assignment.
      if (clinic === null) continue;
      if (clinic.clientId === args.clientId) continue;
      kept.push(clinicId);
    }

    const assignedClinicIds = [...kept, ...requested];
    if (assignedClinicIds.length > MAX_ASSIGNED_CLINICS) {
      throw appError({ code: "CLINIC_ASSIGNMENT_LIMIT", limit: MAX_ASSIGNED_CLINICS });
    }

    await ctx.db.patch(args.profileId, { assignedClinicIds });
    return null;
  },
});

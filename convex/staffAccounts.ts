import { v } from "convex/values";

import type { Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { getStaffProfile, requireAdmin, requireCurrentUserId } from "./model/staff";
import { staffRole, staffStatus } from "./schema";

const currentAccount = v.object({
  profileId: v.id("staffProfiles"),
  userId: v.id("users"),
  displayName: v.string(),
  email: v.union(v.string(), v.null()),
  role: staffRole,
  status: staffStatus,
});

const managedAccount = currentAccount.extend({
  isCurrentUser: v.boolean(),
  assignedClinicIds: v.array(v.id("clinics")),
});

const MAX_ASSIGNED_CLINICS = 200;
const MAX_MANAGED_ACCOUNTS = 100;

function cleanAssignedClinicIds(clinicIds: Id<"clinics">[]): Id<"clinics">[] {
  const seen = new Set<string>();
  const cleaned: Id<"clinics">[] = [];
  for (const clinicId of clinicIds) {
    const key = clinicId as string;
    if (seen.has(key)) continue;
    seen.add(key);
    cleaned.push(clinicId);
    if (cleaned.length >= MAX_ASSIGNED_CLINICS) break;
  }
  return cleaned;
}

export const ensureCurrentProfile = mutation({
  args: {},
  returns: currentAccount,
  handler: async (ctx) => {
    const userId = await requireCurrentUserId(ctx);
    const user = await ctx.db.get("users", userId);

    if (user === null) {
      throw new Error("Authenticated user record was not found.");
    }

    const existingProfile = await getStaffProfile(ctx, userId);
    if (existingProfile !== null) {
      return {
        profileId: existingProfile._id,
        userId,
        displayName: existingProfile.displayName,
        email: user.email ?? null,
        role: existingProfile.role,
        status: existingProfile.status,
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
      email: user.email ?? null,
      role,
      status,
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
      email: user?.email ?? null,
      role: profile.role,
      status: profile.status,
    };
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
          email: user?.email ?? null,
          role: profile.role,
          status: profile.status,
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
      throw new Error("Staff profile was not found.");
    }
    if (target.userId === userId) {
      throw new Error("You cannot change your own role.");
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
      throw new Error("Staff profile was not found.");
    }
    if (target.userId === userId) {
      throw new Error("You cannot disable your own account.");
    }

    await ctx.db.patch("staffProfiles", args.profileId, { status: args.status });
    return null;
  },
});

export const setAssignedClinics = mutation({
  args: {
    profileId: v.id("staffProfiles"),
    clinicIds: v.array(v.id("clinics")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const target = await ctx.db.get("staffProfiles", args.profileId);
    if (target === null) {
      throw new Error("Staff profile was not found.");
    }

    const clinicIds = cleanAssignedClinicIds(args.clinicIds);
    for (const clinicId of clinicIds) {
      const clinic = await ctx.db.get("clinics", clinicId);
      if (clinic === null) {
        throw new Error("One of the selected clinics was not found.");
      }
    }

    await ctx.db.patch("staffProfiles", args.profileId, { assignedClinicIds: clinicIds });
    return null;
  },
});

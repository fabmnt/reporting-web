import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError } from "convex/values";

import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

type StaffCtx = QueryCtx | MutationCtx;

export async function requireCurrentUserId(ctx: StaffCtx) {
  const userId = await getAuthUserId(ctx);

  if (userId === null) {
    throw new ConvexError({ code: "UNAUTHENTICATED", message: "Sign in to continue." });
  }

  return userId;
}

export async function getStaffProfile(ctx: StaffCtx, userId: Id<"users">) {
  return await ctx.db
    .query("staffProfiles")
    .withIndex("by_userId", (query) => query.eq("userId", userId))
    .unique();
}

export async function requireAdmin(ctx: StaffCtx) {
  const userId = await requireCurrentUserId(ctx);
  const profile = await getStaffProfile(ctx, userId);

  if (profile === null || profile.status !== "active" || profile.role !== "admin") {
    throw new ConvexError({ code: "FORBIDDEN", message: "Administrator access is required." });
  }

  return { userId, profile };
}

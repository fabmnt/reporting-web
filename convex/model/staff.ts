import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError } from "convex/values";

import type { Id } from "../_generated/dataModel";
import type { ActionCtx, MutationCtx, QueryCtx } from "../_generated/server";

type StaffCtx = QueryCtx | MutationCtx;
type StaffAuthCtx = StaffCtx | ActionCtx;

export async function requireCurrentUserId(ctx: StaffAuthCtx) {
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

// Any signed-in staff member with an active profile. Single-table check:
// staffProfiles is the only permission source. Actions cannot call this
// directly (no ctx.db); they verify through the currentOperator query.
export async function requireActiveStaff(ctx: StaffCtx) {
  const userId = await requireCurrentUserId(ctx);
  const profile = await getStaffProfile(ctx, userId);

  if (profile === null || profile.status !== "active") {
    throw new ConvexError({ code: "FORBIDDEN", message: "An active staff account is required." });
  }

  return { userId, profile };
}

// Operators run reports. Admins can do everything operators can.
export async function requireOperator(ctx: StaffCtx) {
  const { userId, profile } = await requireActiveStaff(ctx);

  if (profile.role !== "admin" && profile.role !== "operator") {
    throw new ConvexError({ code: "FORBIDDEN", message: "Operator access is required." });
  }

  return { userId, profile };
}

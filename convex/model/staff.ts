import { getAuthUserId } from "@convex-dev/auth/server";

import type { Id } from "../_generated/dataModel";
import type { ActionCtx, MutationCtx, QueryCtx } from "../_generated/server";
import { appError } from "./appErrors";

type StaffCtx = QueryCtx | MutationCtx;
type StaffAuthCtx = StaffCtx | ActionCtx;

export async function requireCurrentUserId(ctx: StaffAuthCtx) {
  const userId = await getAuthUserId(ctx);

  if (userId === null) {
    throw appError({ code: "UNAUTHENTICATED" });
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
    throw appError({ code: "ADMIN_REQUIRED" });
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
    throw appError({ code: "ACTIVE_STAFF_REQUIRED" });
  }

  return { userId, profile };
}

// Operators run reports. Admins can do everything operators can, and a workflow
// account only differs in who assigns its clinics.
export async function requireOperator(ctx: StaffCtx) {
  const { userId, profile } = await requireActiveStaff(ctx);

  if (profile.role !== "admin" && profile.role !== "operator" && profile.role !== "workflow") {
    throw appError({ code: "OPERATOR_REQUIRED" });
  }

  return { userId, profile };
}

// Editing the clinics of the caller's own assignment. Operators and admins do
// this themselves, while a workflow account is scoped by an administrator and
// never widens or narrows its own scope.
export async function requireSelfAssignment(ctx: StaffCtx) {
  const { userId, profile } = await requireOperator(ctx);

  if (profile.role === "workflow") {
    throw appError({ code: "CANNOT_ASSIGN_OWN_CLINICS" });
  }

  return { userId, profile };
}

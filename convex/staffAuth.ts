import { v } from "convex/values";

import { internalQuery } from "./_generated/server";
import { requireAdmin, requireOperator } from "./model/staff";
import { staffRole } from "./schema";

// Auth gate for actions. Actions have no ctx.db, so they cannot call
// requireOperator directly. They call this internal query with ctx.runQuery,
// which runs with the caller's auth and reads staffProfiles once.
export const currentOperator = internalQuery({
  args: {},
  returns: v.object({ userId: v.id("users"), role: staffRole }),
  handler: async (ctx) => {
    const { userId, profile } = await requireOperator(ctx);
    return { userId, role: profile.role };
  },
});

// The same gate for the few actions only an administrator may run, such as
// testing a stored service account key.
export const currentAdmin = internalQuery({
  args: {},
  returns: v.object({ userId: v.id("users"), role: staffRole }),
  handler: async (ctx) => {
    const { userId, profile } = await requireAdmin(ctx);
    return { userId, role: profile.role };
  },
});

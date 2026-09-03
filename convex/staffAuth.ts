import { v } from "convex/values";

import { internalQuery } from "./_generated/server";
import { requireOperator } from "./model/staff";

// Auth gate for actions. Actions have no ctx.db, so they cannot call
// requireOperator directly. They call this internal query with ctx.runQuery,
// which runs with the caller's auth and reads staffProfiles once.
export const currentOperator = internalQuery({
  args: {},
  returns: v.object({ userId: v.id("users") }),
  handler: async (ctx) => {
    const { userId } = await requireOperator(ctx);
    return { userId };
  },
});

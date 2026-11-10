import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

export async function removeClinicTabCache(
  ctx: MutationCtx,
  clinicId: Id<"clinics">
): Promise<void> {
  const cached = await ctx.db
    .query("sheetTabCache")
    .withIndex("by_clinicId", (q) => q.eq("clinicId", clinicId))
    .unique();
  if (cached !== null) await ctx.db.delete(cached._id);
}

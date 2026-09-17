import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

// A report reads at most this many assigned clinics, so an assignment that grew
// past it would only hold ids nothing reads.
export const MAX_ASSIGNED_CLINICS = 200;

/**
 * The assigned ids whose clinic still exists and is active. An assignment list
 * keeps the ids of clinics that were disabled or deleted since they were
 * assigned, and a report skips those, so only the usable ones hold room in the
 * cap.
 */
export async function usableClinicIds(
  ctx: MutationCtx,
  clinicIds: Id<"clinics">[]
): Promise<Id<"clinics">[]> {
  const usable: Id<"clinics">[] = [];
  for (const clinicId of clinicIds) {
    const clinic = await ctx.db.get("clinics", clinicId);
    if (clinic !== null && clinic.isActive) {
      usable.push(clinicId);
    }
  }
  return usable;
}

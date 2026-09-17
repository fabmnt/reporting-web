import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { appError } from "./appErrors";

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

/** What a screen changed about one account's assignment. */
type AssignmentChange = {
  addClinicIds: Id<"clinics">[];
  removeClinicIds: Id<"clinics">[];
  // The client the edit is held to. A screen that shows one client's clinics
  // sets it, so its edit cannot reach the assignments of another client.
  clientId?: Id<"clients">;
};

/**
 * The assignment an account ends up with after adding and removing clinics.
 *
 * An addition must name a clinic that exists, is active and, when the change is
 * held to one client, belongs to it: a report skips every other clinic, so one
 * could only hold room in the cap. A removal that names a clinic the change
 * cannot account for — one that is gone, or one of another client when the
 * change is held to one — leaves the assignment as it was, because such an id
 * cannot be told apart from a stale one.
 *
 * The cap covers the whole assignment, not the share of one client, because a
 * report reads at most that many clinics. A caller that would pass it gets an
 * error instead of a list that silently drops the clinics at the end.
 */
export async function resolveAssignedClinicIds(
  ctx: MutationCtx,
  currentClinicIds: Id<"clinics">[],
  change: AssignmentChange
): Promise<Id<"clinics">[]> {
  const added: Id<"clinics">[] = [];
  const seen = new Set<string>();
  for (const clinicId of change.addClinicIds) {
    if (seen.has(clinicId)) continue;
    seen.add(clinicId);

    const clinic = await ctx.db.get("clinics", clinicId);
    const isOfClient = change.clientId === undefined || clinic?.clientId === change.clientId;
    if (clinic === null || !clinic.isActive || !isOfClient) {
      throw appError({ code: "CLINIC_NOT_FOUND" });
    }
    added.push(clinicId);
  }

  const removed = new Set<string>();
  for (const clinicId of change.removeClinicIds) {
    if (change.clientId !== undefined) {
      const clinic = await ctx.db.get("clinics", clinicId);
      if (clinic === null || clinic.clientId !== change.clientId) continue;
    }
    removed.add(clinicId);
  }

  let assignedClinicIds = currentClinicIds.filter((clinicId) => !removed.has(clinicId));
  for (const clinicId of added) {
    if (!assignedClinicIds.includes(clinicId)) {
      assignedClinicIds.push(clinicId);
    }
  }

  if (assignedClinicIds.length > MAX_ASSIGNED_CLINICS) {
    // A list that only looks full, because it holds clinics that were disabled
    // or deleted since they were assigned, still takes another clinic: a report
    // skips those, so the ids that hold no room leave with the same write.
    assignedClinicIds = await usableClinicIds(ctx, assignedClinicIds);
    if (assignedClinicIds.length > MAX_ASSIGNED_CLINICS) {
      throw appError({ code: "CLINIC_ASSIGNMENT_LIMIT", limit: MAX_ASSIGNED_CLINICS });
    }
  }

  return assignedClinicIds;
}

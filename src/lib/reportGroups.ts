import type { FunctionReturnType } from "convex/server";

import { api } from "../../convex/_generated/api";

// How a report group turns into the clinics a run reads. A group names whole
// clients and single clinics, so the groups an operator ticked are matched
// against the clinics the account is assigned to and nothing else: a group can
// narrow a run, never widen it.

export type ReportGroup = FunctionReturnType<typeof api.reportGroups.list>["groups"][number];
export type ReportClinic = FunctionReturnType<
  typeof api.googleSheets.listAssignedReportClinics
>["clinics"][number];

/** Whether a group holds a clinic, either by naming its client or the clinic. */
export function groupCoversClinic(group: ReportGroup, clinic: ReportClinic): boolean {
  return (
    group.clientIds.some((clientId) => clientId === clinic.clientId) ||
    group.clinicIds.some((clinicId) => clinicId === clinic.clinicId)
  );
}

/** How many of the assigned clinics a group covers. */
export function groupClinicCount(clinics: readonly ReportClinic[], group: ReportGroup): number {
  return clinics.filter((clinic) => groupCoversClinic(group, clinic)).length;
}

/**
 * The clinics the operator chooses among: the ones the ticked groups cover, or
 * every assigned clinic while no group is ticked. A ticked group that covers
 * none of them narrows the form to nothing rather than quietly running
 * everything, which is what its own tick says.
 */
export function selectableClinics(
  clinics: readonly ReportClinic[],
  groups: readonly ReportGroup[],
  selectedGroupIds: readonly string[]
): ReportClinic[] {
  if (selectedGroupIds.length === 0) return [...clinics];

  const selected = groups.filter((group) =>
    selectedGroupIds.some((groupId) => groupId === group.groupId)
  );
  return clinics.filter((clinic) => selected.some((group) => groupCoversClinic(group, clinic)));
}

/**
 * The clinics a run reads: the ones the ticked groups cover, or every assigned
 * clinic while no group is ticked, minus the clinics the operator left out.
 */
export function clinicsToRun(
  clinics: readonly ReportClinic[],
  groups: readonly ReportGroup[],
  selectedGroupIds: readonly string[],
  excludedClinicIds: readonly string[]
): ReportClinic[] {
  if (excludedClinicIds.length === 0) {
    return selectableClinics(clinics, groups, selectedGroupIds);
  }

  const excluded = new Set<string>(excludedClinicIds);
  return selectableClinics(clinics, groups, selectedGroupIds).filter(
    (clinic) => !excluded.has(clinic.clinicId)
  );
}

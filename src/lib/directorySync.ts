import type { FunctionArgs, FunctionReturnType } from "convex/server";

import type { api } from "../../convex/_generated/api";
import { MAX_ADD_BATCH } from "../../convex/model/cccDirectory";

export type MissingClientGroup = FunctionReturnType<
  typeof api.directorySync.findMissingDirectory
>[number];
export type MissingClinic = MissingClientGroup["clinics"][number];

type AddArgs = FunctionArgs<typeof api.directorySync.addMissing>;
export type AddResult = FunctionReturnType<typeof api.directorySync.addMissing>;

/**
 * What the admin unticked. Everything starts ticked, so the screen stores the
 * exceptions instead of a copy of the whole list.
 */
export type Exclusions = {
  clientKeys: ReadonlySet<string>;
  clinicIds: ReadonlySet<string>;
};

export const NO_EXCLUSIONS: Exclusions = { clientKeys: new Set(), clinicIds: new Set() };

/** One client of what an add is about to write, with its ticked clinics. */
export type SelectedGroup = {
  group: MissingClientGroup;
  // The client is created by this add, either on its own or for its clinics.
  createsClient: boolean;
  clinics: MissingClinic[];
};

export function isAddable(clinic: MissingClinic): boolean {
  return clinic.problem === null;
}

export function isClinicSelected(clinic: MissingClinic, exclusions: Exclusions): boolean {
  return isAddable(clinic) && !exclusions.clinicIds.has(clinic.externalClinicId);
}

/**
 * Whether a client's own box is ticked. A missing client is ticked while it is
 * going to be created; a stored client while every addable clinic of it is.
 */
export function isGroupSelected(group: MissingClientGroup, exclusions: Exclusions): boolean {
  if (group.isMissing) return !exclusions.clientKeys.has(group.key);
  const addable = group.clinics.filter(isAddable);
  return addable.length > 0 && addable.every((clinic) => isClinicSelected(clinic, exclusions));
}

/** Whether a client has anything to tick: it is new, or a clinic can be added. */
export function isGroupSelectable(group: MissingClientGroup): boolean {
  return group.isMissing || group.clinics.some(isAddable);
}

/**
 * Whether the "select all" box is ticked: every selectable client and every
 * addable clinic of it is ticked.
 */
export function areAllSelected(groups: MissingClientGroup[], exclusions: Exclusions): boolean {
  const selectable = groups.filter(isGroupSelectable);
  return (
    selectable.length > 0 &&
    selectable.every(
      (group) =>
        !exclusions.clientKeys.has(group.key) &&
        group.clinics.filter(isAddable).every((clinic) => isClinicSelected(clinic, exclusions))
    )
  );
}

/** Ticks or unticks the given clients together with every addable clinic of them. */
export function setGroupsSelected(
  groups: MissingClientGroup[],
  exclusions: Exclusions,
  select: boolean
): Exclusions {
  const clientKeys = new Set(exclusions.clientKeys);
  const clinicIds = new Set(exclusions.clinicIds);

  for (const group of groups) {
    if (select) clientKeys.delete(group.key);
    else clientKeys.add(group.key);
    for (const clinic of group.clinics.filter(isAddable)) {
      if (select) clinicIds.delete(clinic.externalClinicId);
      else clinicIds.add(clinic.externalClinicId);
    }
  }
  return { clientKeys, clinicIds };
}

/** Ticks or unticks a client together with every addable clinic of it. */
export function toggleGroup(group: MissingClientGroup, exclusions: Exclusions): Exclusions {
  return setGroupsSelected([group], exclusions, !isGroupSelected(group, exclusions));
}

/**
 * Ticks or unticks one clinic. Ticking a clinic of an unticked missing client
 * ticks the client too, because adding the clinic creates it anyway.
 */
export function toggleClinic(
  group: MissingClientGroup,
  clinic: MissingClinic,
  exclusions: Exclusions
): Exclusions {
  const clientKeys = new Set(exclusions.clientKeys);
  const clinicIds = new Set(exclusions.clinicIds);

  if (clinicIds.has(clinic.externalClinicId)) {
    clinicIds.delete(clinic.externalClinicId);
    clientKeys.delete(group.key);
  } else {
    clinicIds.add(clinic.externalClinicId);
  }
  return { clientKeys, clinicIds };
}

/**
 * The groups a search box finds. A client whose name matches keeps all its
 * clinics; otherwise only the clinics whose name or Control Central id match
 * are kept, and a client with none left is dropped. An empty search keeps all.
 */
export function filterGroups(groups: MissingClientGroup[], search: string): MissingClientGroup[] {
  const needle = search.trim().toLowerCase();
  if (needle === "") return groups;

  const filtered: MissingClientGroup[] = [];
  for (const group of groups) {
    if (group.name.toLowerCase().includes(needle)) {
      filtered.push(group);
      continue;
    }
    const clinics = group.clinics.filter(
      (clinic) =>
        clinic.name.toLowerCase().includes(needle) ||
        clinic.externalClinicId.toLowerCase().includes(needle)
    );
    if (clinics.length > 0) filtered.push({ ...group, clinics });
  }
  return filtered;
}

/** What an add writes for the current ticks, per client, without empty groups. */
export function selectedGroups(
  groups: MissingClientGroup[],
  exclusions: Exclusions
): SelectedGroup[] {
  const selected: SelectedGroup[] = [];
  for (const group of groups) {
    const clinics = group.clinics.filter((clinic) => isClinicSelected(clinic, exclusions));
    const createsClient =
      group.isMissing && (clinics.length > 0 || !exclusions.clientKeys.has(group.key));
    if (createsClient || clinics.length > 0) selected.push({ group, createsClient, clinics });
  }
  return selected;
}

/**
 * Sends the selection to `addMissing` in batches the mutation accepts, one
 * batch after the other, and merges what each batch reports. A failed batch
 * throws, and the batches before it stay written.
 */
export async function addInBatches(
  addMissing: (args: AddArgs) => Promise<AddResult>,
  selection: SelectedGroup[]
): Promise<AddResult> {
  const clientNames = selection
    .filter((entry) => entry.createsClient)
    .map((entry) => entry.group.name);
  const clinics = selection.flatMap((entry) =>
    entry.clinics.map(({ externalClinicId, name, clientName, googleSheetId }) => ({
      externalClinicId,
      name,
      clientName,
      googleSheetId,
    }))
  );

  const merged: AddResult = { addedClientKeys: [], addedClinicIds: [], skippedClinicIds: [] };
  const batchCount = Math.max(
    Math.ceil(clientNames.length / MAX_ADD_BATCH),
    Math.ceil(clinics.length / MAX_ADD_BATCH)
  );
  for (let index = 0; index < batchCount; index += 1) {
    const start = index * MAX_ADD_BATCH;
    const result = await addMissing({
      clientNames: clientNames.slice(start, start + MAX_ADD_BATCH),
      clinics: clinics.slice(start, start + MAX_ADD_BATCH),
    });
    merged.addedClientKeys.push(...result.addedClientKeys);
    merged.addedClinicIds.push(...result.addedClinicIds);
    merged.skippedClinicIds.push(...result.skippedClinicIds);
  }
  return merged;
}

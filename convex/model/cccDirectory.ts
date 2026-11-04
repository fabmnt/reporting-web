import { v, type Infer } from "convex/values";

import { clientKeyFromName } from "./clientKey";

// How many clients and how many clinics one `directorySync.addMissing` call
// writes, so a call stays well inside one transaction. The screen sends larger
// sets in several calls.
export const MAX_ADD_BATCH = 100;

/** A Control Central clinic, narrowed to what a clinic row is built from. */
export const cccClinic = v.object({
  externalClinicId: v.string(),
  name: v.string(),
  clientName: v.string(),
  googleSheetId: v.string(),
});

export type CccClinic = Infer<typeof cccClinic>;

// Why a missing clinic cannot be added as it is. Null means it can.
export const missingClinicProblem = v.union(
  v.literal("noName"),
  v.literal("noSpreadsheet"),
  v.literal("noClient"),
  // Another clinic already writes to this spreadsheet.
  v.literal("sheetTaken"),
  // Its client already has a clinic with this name.
  v.literal("nameTaken")
);

export const missingClinic = v.object({
  ...cccClinic.fields,
  problem: v.union(missingClinicProblem, v.null()),
});

/**
 * A Control Central client with the clinics of it the app does not store. It is
 * listed when the client itself is missing (`isMissing`), even with no missing
 * clinic, or when a stored client has missing clinics. The clinics Control
 * Central places under no client share one entry whose key and name are empty.
 */
export const missingClientGroup = v.object({
  key: v.string(),
  name: v.string(),
  isMissing: v.boolean(),
  clinics: v.array(missingClinic),
});

export type MissingClinic = Infer<typeof missingClinic>;
export type MissingClientGroup = Infer<typeof missingClientGroup>;

/** The Control Central directory: every client name and every clinic. */
export type CccDirectory = { clientNames: string[]; clinics: CccClinic[] };

/** What the app already stores, as the lookups the comparison needs. */
export type StoredDirectory = {
  clientKeys: string[];
  externalClinicIds: string[];
  googleSheetIds: string[];
  // `clinicNameKey` of every stored clinic.
  clinicNameKeys: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function pickString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * The key a clinic is looked up by inside its client. The app finds a clinic by
 * its client's key and its name, so two client names that normalize to one key
 * share it.
 */
export function clinicNameKey(clientName: string, clinicName: string): string {
  return `${clientKeyFromName(clientName)}\n${clinicName}`;
}

/**
 * Narrows the three Control Central lists (`/api/clients/`, `/api/clinics/`,
 * `/api/drive/`). Rows without the fields the app reads are dropped, so nothing
 * past this point works with an unchecked API shape.
 */
export function parseCccDirectory(
  clientRows: unknown[],
  clinicRows: unknown[],
  driveRows: unknown[]
): CccDirectory {
  const spreadsheetByDriveId = new Map<string, string>();
  for (const row of driveRows) {
    if (!isRecord(row)) continue;
    const driveId = pickString(row._id);
    const spreadsheet = pickString(row.spreadsheet);
    if (driveId !== "" && spreadsheet !== "") spreadsheetByDriveId.set(driveId, spreadsheet);
  }

  const clientNames: string[] = [];
  const clientNameByClinicId = new Map<string, string>();
  for (const row of clientRows) {
    if (!isRecord(row)) continue;
    const clientName = pickString(row.clientName);
    if (clientName !== "") clientNames.push(clientName);
    for (const entry of Array.isArray(row.clinic) ? row.clinic : []) {
      if (!isRecord(entry)) continue;
      const clinicId = pickString(entry._id);
      if (clinicId !== "") clientNameByClinicId.set(clinicId, clientName);
    }
  }

  const clinics: CccClinic[] = [];
  for (const row of clinicRows) {
    if (!isRecord(row)) continue;
    const externalClinicId = pickString(row._id);
    if (externalClinicId === "") continue;
    clinics.push({
      externalClinicId,
      name: pickString(row.clinicName),
      clientName: clientNameByClinicId.get(externalClinicId) ?? "",
      googleSheetId: spreadsheetByDriveId.get(pickString(row.drive)) ?? "",
    });
  }

  return { clientNames, clinics };
}

/**
 * The clients and clinics Control Central has and the app does not, grouped by
 * client: first the clients with a clinic that can be added, then the rest,
 * each in name order, and the group of clinics that have no client last. A
 * client is matched by its key and a clinic by its Control Central id.
 *
 * A missing clinic that cannot be stored as it is carries the reason. The
 * clinics are walked in client and name order, and each addable one reserves
 * its spreadsheet and name, so two missing clinics that share either are not
 * both offered.
 */
export function findMissing(
  directory: CccDirectory,
  stored: StoredDirectory
): MissingClientGroup[] {
  const storedClientKeys = new Set(stored.clientKeys);
  const storedClinicIds = new Set(stored.externalClinicIds);
  const takenSheets = new Set(stored.googleSheetIds);
  const takenNames = new Set(stored.clinicNameKeys);
  const groups = new Map<string, MissingClientGroup>();

  function groupOf(clientName: string): MissingClientGroup {
    const key = clientKeyFromName(clientName);
    let group = groups.get(key);
    if (group === undefined) {
      group = {
        key,
        name: key === "" ? "" : clientName,
        isMissing: key !== "" && !storedClientKeys.has(key),
        clinics: [],
      };
      groups.set(key, group);
    }
    return group;
  }

  for (const name of directory.clientNames) {
    if (!storedClientKeys.has(clientKeyFromName(name))) groupOf(name);
  }

  const candidates = directory.clinics
    .filter((clinic) => !storedClinicIds.has(clinic.externalClinicId))
    .sort((a, b) => a.clientName.localeCompare(b.clientName) || a.name.localeCompare(b.name));

  for (const clinic of candidates) {
    const nameKey = clinicNameKey(clinic.clientName, clinic.name);
    const problem = clinicProblem(clinic, takenSheets, takenNames, nameKey);
    if (problem === null) {
      takenSheets.add(clinic.googleSheetId);
      takenNames.add(nameKey);
    }
    groupOf(clinic.clientName).clinics.push({ ...clinic, problem });
  }

  // Clients with a clinic that can be added come first, and the group without
  // a client sorts last: an empty name would sort first.
  const rank = (group: MissingClientGroup) => {
    if (group.key === "") return 2;
    return group.clinics.some((clinic) => clinic.problem === null) ? 0 : 1;
  };
  return [...groups.values()].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

function clinicProblem(
  clinic: CccClinic,
  takenSheets: Set<string>,
  takenNames: Set<string>,
  nameKey: string
): MissingClinic["problem"] {
  if (clinic.name === "") return "noName";
  if (clinic.googleSheetId === "") return "noSpreadsheet";
  if (clientKeyFromName(clinic.clientName) === "") return "noClient";
  if (takenSheets.has(clinic.googleSheetId)) return "sheetTaken";
  if (takenNames.has(nameKey)) return "nameTaken";
  return null;
}

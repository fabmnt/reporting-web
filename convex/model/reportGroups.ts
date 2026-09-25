import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { appError } from "./appErrors";
import { MAX_ASSIGNED_CLINICS } from "./assignments";

// A group is a saved selection, so it never holds more than an account can be
// assigned: the picker offers those clinics alone, and the cap keeps a group
// from growing into a document no screen can show.
export const MAX_GROUP_MEMBERS = MAX_ASSIGNED_CLINICS;
// The group picker of the run form lists them all, so past this many a person
// is asked to tidy up instead of being handed a list nobody reads to the end.
export const MAX_GROUPS_PER_USER = 50;
export const MAX_GROUP_NAME_LENGTH = 60;

export type ReportGroupDoc = Doc<"reportGroups">;

export type ReportGroupDraft = {
  name: string;
  clientIds: Id<"clients">[];
  clinicIds: Id<"clinics">[];
};

export function cleanGroupName(name: string): string {
  const cleaned = name.trim().slice(0, MAX_GROUP_NAME_LENGTH);
  if (cleaned === "") {
    throw appError({ code: "REPORT_GROUP_NAME_REQUIRED" });
  }
  return cleaned;
}

function uniqueIds<T extends string>(ids: readonly T[]): T[] {
  const seen = new Set<string>();
  const unique: T[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    unique.push(id);
  }
  return unique;
}

/**
 * The members a group ends up with: none is stored twice, a clinic of a client
 * the group already holds whole is left out because the client covers it, and
 * an id the group can no longer use is dropped instead of failing the save. An
 * id stops being usable when its client or clinic was deleted, or its clinic
 * was disabled, since the group was saved: the picker cannot show those any
 * more, so refusing them would leave the owner of the group with a group that
 * never saves.
 */
export async function resolveGroupMembers(
  ctx: MutationCtx,
  draft: { clientIds: readonly Id<"clients">[]; clinicIds: readonly Id<"clinics">[] }
): Promise<{ clientIds: Id<"clients">[]; clinicIds: Id<"clinics">[] }> {
  const clientIds = uniqueIds(draft.clientIds);
  const clinicIds = uniqueIds(draft.clinicIds);
  if (clientIds.length + clinicIds.length > MAX_GROUP_MEMBERS) {
    throw appError({ code: "REPORT_GROUP_MEMBER_LIMIT", limit: MAX_GROUP_MEMBERS });
  }

  const keptClients: Id<"clients">[] = [];
  for (const clientId of clientIds) {
    const client = await ctx.db.get("clients", clientId);
    if (client !== null) keptClients.push(clientId);
  }

  const wholeClients = new Set<string>(keptClients);
  const keptClinics: Id<"clinics">[] = [];
  for (const clinicId of clinicIds) {
    const clinic = await ctx.db.get("clinics", clinicId);
    // A report skips an inactive clinic, so a group that held one would look
    // bigger than it runs.
    if (clinic === null || !clinic.isActive) continue;
    if (wholeClients.has(clinic.clientId)) continue;
    keptClinics.push(clinicId);
  }

  if (keptClients.length === 0 && keptClinics.length === 0) {
    throw appError({ code: "REPORT_GROUP_EMPTY" });
  }

  return { clientIds: keptClients, clinicIds: keptClinics };
}

// Names are unique for the account that owns the group, so two accounts can
// each keep a group of their own under the same name.
export async function assertGroupNameAvailable(
  ctx: QueryCtx | MutationCtx,
  ownerUserId: Id<"users">,
  name: string,
  exceptId: Id<"reportGroups"> | null
): Promise<void> {
  const rows = await ctx.db
    .query("reportGroups")
    .withIndex("by_ownerUserId", (query) => query.eq("ownerUserId", ownerUserId))
    .collect();
  const taken = rows.some(
    (row) => row._id !== exceptId && row.name.toLowerCase() === name.toLowerCase()
  );
  if (taken) {
    throw appError({ code: "REPORT_GROUP_NAME_TAKEN", name });
  }
}

// Only the owner reaches a group, administrators included: a group is a saved
// selection, not something the deployment shares.
export async function loadOwnedReportGroup(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
  groupId: Id<"reportGroups">
): Promise<ReportGroupDoc> {
  const row = await ctx.db.get("reportGroups", groupId);
  if (row === null || row.ownerUserId !== userId) {
    throw appError({ code: "REPORT_GROUP_NOT_FOUND" });
  }
  return row;
}

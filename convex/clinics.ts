import { v } from "convex/values";

import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import { appError, type AppErrorPayload } from "./model/appErrors";
import { clientKeyFromName } from "./model/clients";
import { clinicSheetColumns } from "./model/clinicSheetColumns";
import { listProfileClinics } from "./model/reporting";
import { requireAdmin, requireOperator } from "./model/staff";

const MAX_CLINICS = 500;
const MAX_CLIENTS = 200;
const MAX_STAFF_PROFILES = 500;
// Mirrors the cap the assignment mutations and the report scope use, so a
// self-service assignment cannot grow past what the reports can read.
const MAX_ASSIGNED_CLINICS = 200;
// The clinic picker shows what is still available, so its scan reads past the
// first page of the table: filtering after a short cap would hide every clinic
// that sits behind the pages of clinics the caller already has.
const MAX_AVAILABLE_SCAN = 2000;

const clientView = v.object({
  clientId: v.id("clients"),
  key: v.string(),
  name: v.string(),
  isActive: v.boolean(),
});

const clinicView = v.object({
  clinicId: v.id("clinics"),
  name: v.string(),
  googleSheetId: v.string(),
  externalClinicId: v.union(v.string(), v.null()),
  isActive: v.boolean(),
  clientId: v.id("clients"),
  clientName: v.string(),
  sheetColumns: clinicSheetColumns,
  qaGroupKeys: v.array(v.string()),
});

const assignedClinicView = v.object({
  clinicId: v.id("clinics"),
  name: v.string(),
  googleSheetId: v.string(),
  externalClinicId: v.union(v.string(), v.null()),
  clientName: v.string(),
  sheetColumns: clinicSheetColumns,
});

// What the clinic pickers need: enough to tell two clinics of one client apart.
const clinicChoiceView = v.object({
  clinicId: v.id("clinics"),
  name: v.string(),
  externalClinicId: v.union(v.string(), v.null()),
  clientName: v.string(),
});

/**
 * Resolves the client of every clinic row once, so a list of clinics costs one
 * client read per client instead of one per clinic.
 */
async function withClientNames<T extends { clientId: Id<"clients"> }>(
  ctx: QueryCtx,
  rows: T[]
): Promise<Array<T & { clientName: string }>> {
  const clientNameById = new Map<Id<"clients">, string>();
  const named: Array<T & { clientName: string }> = [];

  for (const row of rows) {
    let clientName = clientNameById.get(row.clientId);
    if (clientName === undefined) {
      const client = await ctx.db.get("clients", row.clientId);
      clientName = client?.name ?? "Unknown client";
      clientNameById.set(row.clientId, clientName);
    }
    named.push({ ...row, clientName });
  }

  return named;
}

const clinicInputFields = {
  name: v.string(),
  googleSheetId: v.string(),
  clientId: v.id("clients"),
};

function cleanRequiredText(value: string, missingField: AppErrorPayload): string {
  const trimmed = value.trim();
  if (trimmed === "") {
    throw appError(missingField);
  }
  return trimmed;
}

function cleanQaGroupKeys(keys: string[]): string[] {
  const seen = new Set<string>();
  const cleaned: string[] = [];
  for (const key of keys) {
    const trimmed = key.trim();
    if (trimmed === "" || seen.has(trimmed)) continue;
    seen.add(trimmed);
    cleaned.push(trimmed);
  }
  return cleaned;
}

async function requireClient(ctx: MutationCtx, clientId: Id<"clients">) {
  const client = await ctx.db.get("clients", clientId);
  if (client === null) {
    throw appError({ code: "CLIENT_NOT_FOUND" });
  }
  return client;
}

async function assertGoogleSheetIdAvailable(
  ctx: MutationCtx,
  googleSheetId: string,
  ignoreClinicId?: Id<"clinics">
) {
  const existing = await ctx.db
    .query("clinics")
    .withIndex("by_googleSheetId", (query) => query.eq("googleSheetId", googleSheetId))
    .first();

  if (existing !== null && existing._id !== ignoreClinicId) {
    throw appError({ code: "GOOGLE_SHEET_TAKEN" });
  }
}

async function assertClinicNameAvailable(
  ctx: MutationCtx,
  clientId: Id<"clients">,
  name: string,
  ignoreClinicId?: Id<"clinics">
) {
  const existing = await ctx.db
    .query("clinics")
    .withIndex("by_clientId_and_name", (query) => query.eq("clientId", clientId).eq("name", name))
    .first();

  if (existing !== null && existing._id !== ignoreClinicId) {
    throw appError({ code: "CLINIC_NAME_TAKEN" });
  }
}

/**
 * Validates a client name and derives its key. Returns the key.
 * Pass `ignoreClientId` when renaming so a client does not collide with itself.
 */
async function assertClientNameAvailable(
  ctx: MutationCtx,
  name: string,
  ignoreClientId?: Id<"clients">
): Promise<string> {
  const key = clientKeyFromName(name);
  if (key === "") {
    throw appError({ code: "CLIENT_NAME_INVALID" });
  }

  const existingByKey = await ctx.db
    .query("clients")
    .withIndex("by_key", (query) => query.eq("key", key))
    .first();
  if (existingByKey !== null && existingByKey._id !== ignoreClientId) {
    throw appError({ code: "CLIENT_NAME_TAKEN" });
  }

  const scannedClients = await ctx.db.query("clients").withIndex("by_key").take(MAX_CLIENTS);
  const existingByName = scannedClients.find(
    (client) => client.name.toLowerCase() === name.toLowerCase() && client._id !== ignoreClientId
  );
  if (existingByName !== undefined) {
    throw appError({ code: "CLIENT_NAME_TAKEN" });
  }

  return key;
}

async function removeClinicFromStaffProfiles(ctx: MutationCtx, clinicId: Id<"clinics">) {
  const profiles = await ctx.db
    .query("staffProfiles")
    .withIndex("by_userId")
    .take(MAX_STAFF_PROFILES);
  for (const profile of profiles) {
    const assignedClinicIds = profile.assignedClinicIds ?? [];
    if (!assignedClinicIds.includes(clinicId)) continue;
    await ctx.db.patch(profile._id, {
      assignedClinicIds: assignedClinicIds.filter((id) => id !== clinicId),
    });
  }
}

async function requireAssignedClinic(
  ctx: MutationCtx,
  profile: { role: "admin" | "operator"; assignedClinicIds?: Id<"clinics">[] },
  clinicId: Id<"clinics">
) {
  const accessible = await listProfileClinics(ctx, profile);
  if (!accessible.some((clinic) => clinic._id === clinicId)) {
    throw appError({ code: "CLINIC_NOT_ASSIGNED" });
  }

  const clinic = await ctx.db.get("clinics", clinicId);
  if (clinic === null) {
    throw appError({ code: "CLINIC_NOT_FOUND" });
  }
  return clinic;
}

/**
 * The assigned ids whose clinic still exists and is active. The list keeps the
 * ids of clinics that were disabled or deleted since they were assigned, and
 * the screens cannot show those, so only the usable ones hold room in the cap.
 */
async function usableClinicIds(
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

export const listClients = query({
  args: {},
  returns: v.object({
    clients: v.array(clientView),
    limit: v.number(),
    hasMore: v.boolean(),
  }),
  handler: async (ctx) => {
    await requireAdmin(ctx);

    const rows = await ctx.db
      .query("clients")
      .withIndex("by_key")
      .take(MAX_CLIENTS + 1);
    const clients = rows.slice(0, MAX_CLIENTS).map((client) => ({
      clientId: client._id,
      key: client.key,
      name: client.name,
      isActive: client.isActive,
    }));
    clients.sort((a, b) => a.name.localeCompare(b.name));

    return { clients, limit: MAX_CLIENTS, hasMore: rows.length > MAX_CLIENTS };
  },
});

export const createClient = mutation({
  args: { name: v.string() },
  returns: clientView,
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const name = cleanRequiredText(args.name, { code: "CLIENT_NAME_REQUIRED" });
    const key = await assertClientNameAvailable(ctx, name);

    const clientId = await ctx.db.insert("clients", { key, name, isActive: true });
    return { clientId, key, name, isActive: true };
  },
});

export const updateClient = mutation({
  args: {
    clientId: v.id("clients"),
    name: v.string(),
    isActive: v.boolean(),
  },
  returns: clientView,
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const client = await ctx.db.get("clients", args.clientId);
    if (client === null) {
      throw appError({ code: "CLIENT_NOT_FOUND" });
    }

    const name = cleanRequiredText(args.name, { code: "CLIENT_NAME_REQUIRED" });
    const key = await assertClientNameAvailable(ctx, name, args.clientId);

    await ctx.db.patch(args.clientId, { key, name, isActive: args.isActive });

    return { clientId: args.clientId, key, name, isActive: args.isActive };
  },
});

/**
 * Deletes a client only when it owns no clinics. Clinics require a client, so
 * deleting one that still has clinics would leave those rows pointing at a
 * missing client. Callers must move or delete the clinics first.
 */
export const removeClient = mutation({
  args: { clientId: v.id("clients") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const client = await ctx.db.get("clients", args.clientId);
    if (client === null) {
      throw appError({ code: "CLIENT_NOT_FOUND" });
    }

    const ownedClinics = await ctx.db
      .query("clinics")
      .withIndex("by_clientId_and_name", (query) => query.eq("clientId", args.clientId))
      .take(MAX_CLINICS);

    if (ownedClinics.length > 0) {
      throw appError({
        code: "CLIENT_HAS_CLINICS",
        clientName: client.name,
        clinicCount: ownedClinics.length,
      });
    }

    await ctx.db.delete("clients", args.clientId);
    return null;
  },
});

export const list = query({
  args: {},
  returns: v.object({
    clinics: v.array(clinicView),
    limit: v.number(),
    hasMore: v.boolean(),
  }),
  handler: async (ctx) => {
    await requireAdmin(ctx);

    const rows = await ctx.db
      .query("clinics")
      .withIndex("by_clientId_and_name")
      .take(MAX_CLINICS + 1);

    const named = await withClientNames(ctx, rows.slice(0, MAX_CLINICS));
    const clinics = named.map((row) => ({
      clinicId: row._id,
      name: row.name,
      googleSheetId: row.googleSheetId,
      externalClinicId: row.externalClinicId ?? null,
      isActive: row.isActive,
      clientId: row.clientId,
      clientName: row.clientName,
      sheetColumns: row.sheetColumns ?? {},
      qaGroupKeys: row.qaGroupKeys ?? [],
    }));
    clinics.sort(
      (a, b) => a.clientName.localeCompare(b.clientName) || a.name.localeCompare(b.name)
    );

    return { clinics, limit: MAX_CLINICS, hasMore: rows.length > MAX_CLINICS };
  },
});

/**
 * The clinics the caller may still add to their own assignment: every active
 * clinic that is not already assigned to them.
 */
export const listAvailable = query({
  args: {},
  returns: v.object({
    clinics: v.array(clinicChoiceView),
    limit: v.number(),
    hasMore: v.boolean(),
  }),
  handler: async (ctx) => {
    const { profile } = await requireOperator(ctx);
    const assigned = new Set<string>(profile.assignedClinicIds ?? []);

    const rows = await ctx.db
      .query("clinics")
      .withIndex("by_clientId_and_name")
      .take(MAX_AVAILABLE_SCAN + 1);

    const available = rows.filter((row) => row.isActive && !assigned.has(row._id));
    const named = await withClientNames(ctx, available.slice(0, MAX_CLINICS));
    const clinics = named
      .map((row) => ({
        clinicId: row._id,
        name: row.name,
        externalClinicId: row.externalClinicId ?? null,
        clientName: row.clientName,
      }))
      .sort((a, b) => a.clientName.localeCompare(b.clientName) || a.name.localeCompare(b.name));

    return {
      clinics,
      limit: MAX_CLINICS,
      // Either the scan or the result cap left clinics out, so the picker says
      // the list is not the whole directory.
      hasMore: rows.length > MAX_AVAILABLE_SCAN || available.length > MAX_CLINICS,
    };
  },
});

export const listAssigned = query({
  args: {},
  returns: v.object({
    clinics: v.array(assignedClinicView),
  }),
  handler: async (ctx) => {
    const { profile } = await requireOperator(ctx);
    const named = await withClientNames(ctx, await listProfileClinics(ctx, profile));
    const clinics = [];

    for (const clinic of named) {
      const row = await ctx.db.get("clinics", clinic._id);
      clinics.push({
        clinicId: clinic._id,
        name: clinic.name,
        googleSheetId: clinic.googleSheetId,
        externalClinicId: row?.externalClinicId ?? null,
        clientName: clinic.clientName,
        sheetColumns: row?.sheetColumns ?? {},
      });
    }

    return { clinics };
  },
});

/**
 * Adds one clinic to the caller's own assignment. Assignments are the only
 * source of the report scope, so an operator can widen their own scope without
 * an admin.
 */
export const addAssigned = mutation({
  args: { clinicId: v.id("clinics") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { profile } = await requireOperator(ctx);
    const assignedClinicIds = profile.assignedClinicIds ?? [];
    if (assignedClinicIds.includes(args.clinicId)) {
      return null;
    }

    const clinic = await ctx.db.get("clinics", args.clinicId);
    if (clinic === null || !clinic.isActive) {
      throw appError({ code: "CLINIC_NOT_FOUND" });
    }

    // A list that only looks full, because it holds clinics that were disabled
    // or deleted since they were assigned, still takes another clinic. The ids
    // that hold no room leave with the same write.
    const assigned =
      assignedClinicIds.length >= MAX_ASSIGNED_CLINICS
        ? await usableClinicIds(ctx, assignedClinicIds)
        : assignedClinicIds;
    if (assigned.length >= MAX_ASSIGNED_CLINICS) {
      throw appError({ code: "CLINIC_ASSIGNMENT_LIMIT", limit: MAX_ASSIGNED_CLINICS });
    }

    await ctx.db.patch("staffProfiles", profile._id, {
      assignedClinicIds: [...assigned, args.clinicId],
    });

    return null;
  },
});

/** Drops one clinic from the caller's own assignment. */
export const removeAssigned = mutation({
  args: { clinicId: v.id("clinics") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { profile } = await requireOperator(ctx);
    const assignedClinicIds = profile.assignedClinicIds ?? [];
    if (!assignedClinicIds.includes(args.clinicId)) {
      return null;
    }

    await ctx.db.patch("staffProfiles", profile._id, {
      assignedClinicIds: assignedClinicIds.filter((clinicId) => clinicId !== args.clinicId),
    });

    return null;
  },
});

export const updateAssigned = mutation({
  args: {
    clinicId: v.id("clinics"),
    googleSheetId: v.string(),
    sheetColumns: v.optional(clinicSheetColumns),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { profile } = await requireOperator(ctx);
    const clinic = await requireAssignedClinic(ctx, profile, args.clinicId);

    const googleSheetId = cleanRequiredText(args.googleSheetId, { code: "GOOGLE_SHEET_REQUIRED" });
    await assertGoogleSheetIdAvailable(ctx, googleSheetId, args.clinicId);

    await ctx.db.patch(args.clinicId, {
      googleSheetId,
      sheetColumns: args.sheetColumns ?? clinic.sheetColumns ?? {},
    });

    return null;
  },
});

export const create = mutation({
  args: {
    ...clinicInputFields,
    externalClinicId: v.optional(v.string()),
    isActive: v.optional(v.boolean()),
    sheetColumns: v.optional(clinicSheetColumns),
    qaGroupKeys: v.optional(v.array(v.string())),
  },
  returns: v.object({ clinicId: v.id("clinics") }),
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const name = cleanRequiredText(args.name, { code: "CLINIC_NAME_REQUIRED" });
    const googleSheetId = cleanRequiredText(args.googleSheetId, { code: "GOOGLE_SHEET_REQUIRED" });
    await requireClient(ctx, args.clientId);
    await assertGoogleSheetIdAvailable(ctx, googleSheetId);
    await assertClinicNameAvailable(ctx, args.clientId, name);

    const clinicId = await ctx.db.insert("clinics", {
      name,
      googleSheetId,
      clientId: args.clientId,
      externalClinicId: args.externalClinicId?.trim() || undefined,
      isActive: args.isActive ?? true,
      sheetColumns: args.sheetColumns ?? {},
      qaGroupKeys: cleanQaGroupKeys(args.qaGroupKeys ?? []),
    });

    return { clinicId };
  },
});

export const update = mutation({
  args: {
    clinicId: v.id("clinics"),
    ...clinicInputFields,
    externalClinicId: v.union(v.string(), v.null()),
    isActive: v.boolean(),
    sheetColumns: v.optional(clinicSheetColumns),
    qaGroupKeys: v.optional(v.array(v.string())),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const clinic = await ctx.db.get("clinics", args.clinicId);
    if (clinic === null) {
      throw appError({ code: "CLINIC_NOT_FOUND" });
    }

    const name = cleanRequiredText(args.name, { code: "CLINIC_NAME_REQUIRED" });
    const googleSheetId = cleanRequiredText(args.googleSheetId, { code: "GOOGLE_SHEET_REQUIRED" });
    await requireClient(ctx, args.clientId);
    await assertGoogleSheetIdAvailable(ctx, googleSheetId, args.clinicId);
    await assertClinicNameAvailable(ctx, args.clientId, name, args.clinicId);

    await ctx.db.patch(args.clinicId, {
      name,
      googleSheetId,
      clientId: args.clientId,
      isActive: args.isActive,
      externalClinicId: args.externalClinicId?.trim() || undefined,
      sheetColumns: args.sheetColumns ?? clinic.sheetColumns ?? {},
      qaGroupKeys:
        args.qaGroupKeys !== undefined
          ? cleanQaGroupKeys(args.qaGroupKeys)
          : (clinic.qaGroupKeys ?? []),
    });

    return null;
  },
});

export const remove = mutation({
  args: { clinicId: v.id("clinics") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const clinic = await ctx.db.get("clinics", args.clinicId);
    if (clinic === null) {
      throw appError({ code: "CLINIC_NOT_FOUND" });
    }

    await removeClinicFromStaffProfiles(ctx, args.clinicId);
    await ctx.db.delete("clinics", args.clinicId);

    return null;
  },
});

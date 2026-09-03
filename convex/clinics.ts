import { v } from "convex/values";

import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import { requireAdmin } from "./model/staff";

const MAX_CLINICS = 500;
const MAX_CLIENTS = 200;
const DEPENDENT_BATCH_SIZE = 500;

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
});

const clinicInputFields = {
  name: v.string(),
  googleSheetId: v.string(),
  clientId: v.id("clients"),
};

function cleanRequiredText(value: string, label: string): string {
  const trimmed = value.trim();
  if (trimmed === "") {
    throw new Error(`${label} is required.`);
  }
  return trimmed;
}

function clientKeyFromName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function requireClient(ctx: MutationCtx, clientId: Id<"clients">) {
  const client = await ctx.db.get("clients", clientId);
  if (client === null) {
    throw new Error("Client was not found.");
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
    throw new Error("Another clinic already uses this Google Sheet.");
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
    throw new Error("A clinic with this name already exists for this client.");
  }
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

    const name = cleanRequiredText(args.name, "Client name");
    const key = clientKeyFromName(name);
    if (key === "") {
      throw new Error("Client name must contain letters or numbers.");
    }

    const existingByKey = await ctx.db
      .query("clients")
      .withIndex("by_key", (query) => query.eq("key", key))
      .first();
    const scannedClients = await ctx.db.query("clients").withIndex("by_key").take(MAX_CLIENTS);
    const existingByName = scannedClients.find(
      (client) => client.name.toLowerCase() === name.toLowerCase()
    );

    if (existingByKey !== null || existingByName !== undefined) {
      throw new Error("A client with this name already exists.");
    }

    const clientId = await ctx.db.insert("clients", { key, name, isActive: true });
    return { clientId, key, name, isActive: true };
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

    const clientNameById = new Map<Id<"clients">, string>();
    const clinics = [];
    for (const row of rows.slice(0, MAX_CLINICS)) {
      let clientName = clientNameById.get(row.clientId);
      if (clientName === undefined) {
        const client = await ctx.db.get("clients", row.clientId);
        clientName = client?.name ?? "Unknown client";
        clientNameById.set(row.clientId, clientName);
      }
      clinics.push({
        clinicId: row._id,
        name: row.name,
        googleSheetId: row.googleSheetId,
        externalClinicId: row.externalClinicId ?? null,
        isActive: row.isActive,
        clientId: row.clientId,
        clientName,
      });
    }
    clinics.sort(
      (a, b) => a.clientName.localeCompare(b.clientName) || a.name.localeCompare(b.name)
    );

    return { clinics, limit: MAX_CLINICS, hasMore: rows.length > MAX_CLINICS };
  },
});

export const create = mutation({
  args: {
    ...clinicInputFields,
    externalClinicId: v.optional(v.string()),
    isActive: v.optional(v.boolean()),
  },
  returns: v.object({ clinicId: v.id("clinics") }),
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const name = cleanRequiredText(args.name, "Clinic name");
    const googleSheetId = cleanRequiredText(args.googleSheetId, "Google Sheet ID");
    await requireClient(ctx, args.clientId);
    await assertGoogleSheetIdAvailable(ctx, googleSheetId);
    await assertClinicNameAvailable(ctx, args.clientId, name);

    const clinicId = await ctx.db.insert("clinics", {
      name,
      googleSheetId,
      clientId: args.clientId,
      externalClinicId: args.externalClinicId?.trim() || undefined,
      isActive: args.isActive ?? true,
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
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const clinic = await ctx.db.get("clinics", args.clinicId);
    if (clinic === null) {
      throw new Error("Clinic was not found.");
    }

    const name = cleanRequiredText(args.name, "Clinic name");
    const googleSheetId = cleanRequiredText(args.googleSheetId, "Google Sheet ID");
    await requireClient(ctx, args.clientId);
    await assertGoogleSheetIdAvailable(ctx, googleSheetId, args.clinicId);
    await assertClinicNameAvailable(ctx, args.clientId, name, args.clinicId);

    await ctx.db.patch(args.clinicId, {
      name,
      googleSheetId,
      clientId: args.clientId,
      isActive: args.isActive,
      externalClinicId: args.externalClinicId?.trim() || undefined,
    });

    return null;
  },
});

async function deleteColumnMappings(ctx: MutationCtx, clinicId: Id<"clinics">) {
  while (true) {
    const rows = await ctx.db
      .query("clinicColumnMappings")
      .withIndex("by_clinicId_and_purpose", (query) => query.eq("clinicId", clinicId))
      .take(DEPENDENT_BATCH_SIZE);
    if (rows.length === 0) return;

    for (const row of rows) {
      await ctx.db.delete("clinicColumnMappings", row._id);
    }
  }
}

async function deleteQaGroupAssignments(ctx: MutationCtx, clinicId: Id<"clinics">) {
  while (true) {
    const rows = await ctx.db
      .query("clinicQaGroupAssignments")
      .withIndex("by_clinicId_and_qaGroupId", (query) => query.eq("clinicId", clinicId))
      .take(DEPENDENT_BATCH_SIZE);
    if (rows.length === 0) return;

    for (const row of rows) {
      await ctx.db.delete("clinicQaGroupAssignments", row._id);
    }
  }
}

async function deleteReportingScopeLinks(ctx: MutationCtx, clinicId: Id<"clinics">) {
  while (true) {
    const rows = await ctx.db
      .query("reportingScopeClinics")
      .withIndex("by_clinicId_and_reportingScopeId", (query) => query.eq("clinicId", clinicId))
      .take(DEPENDENT_BATCH_SIZE);
    if (rows.length === 0) return;

    for (const row of rows) {
      await ctx.db.delete("reportingScopeClinics", row._id);
    }
  }
}

export const remove = mutation({
  args: { clinicId: v.id("clinics") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const clinic = await ctx.db.get("clinics", args.clinicId);
    if (clinic === null) {
      throw new Error("Clinic was not found.");
    }

    await deleteColumnMappings(ctx, args.clinicId);
    await deleteQaGroupAssignments(ctx, args.clinicId);
    await deleteReportingScopeLinks(ctx, args.clinicId);
    await ctx.db.delete("clinics", args.clinicId);

    return null;
  },
});

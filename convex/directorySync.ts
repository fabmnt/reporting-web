import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { action, internalQuery, mutation } from "./_generated/server";
import { fetchCarrierList, signInCarrierApi, type CarrierFailure } from "./carrierApi";
import { appError } from "./model/appErrors";
import {
  cccClinic,
  clinicNameKey,
  MAX_ADD_BATCH,
  findMissing,
  missingClientGroup,
  parseCccDirectory,
  type CccClinic,
  type MissingClientGroup,
  type StoredDirectory,
} from "./model/cccDirectory";
import { clientKeyFromName } from "./model/clientKey";
import { adjustClientClinicCount } from "./model/clients";
import { actionDeadline } from "./model/googlePolicy";
import { requireAdmin } from "./model/staff";

const CCC_CLIENTS_PATH = "/api/clients/";
const CCC_CLINICS_PATH = "/api/clinics/";
const CCC_DRIVE_PATH = "/api/drive/";

function carrierError(failure: CarrierFailure) {
  return appError({
    code: failure === "unauthorized" ? "CARRIER_SIGN_IN_REJECTED" : "CARRIER_API_UNAVAILABLE",
  });
}

/**
 * What the app already stores, read whole so the check can compare it with
 * Control Central. Costs one read per client and per clinic. Also the admin
 * gate of `findMissing`, which runs it with the caller's auth.
 */
export const storedDirectory = internalQuery({
  args: {},
  returns: v.object({
    clientKeys: v.array(v.string()),
    externalClinicIds: v.array(v.string()),
    googleSheetIds: v.array(v.string()),
    clinicNameKeys: v.array(v.string()),
  }),
  handler: async (ctx): Promise<StoredDirectory> => {
    await requireAdmin(ctx);

    const clientNameById = new Map<Id<"clients">, string>();
    const clientKeys: string[] = [];
    for await (const client of ctx.db.query("clients").withIndex("by_key")) {
      clientNameById.set(client._id, client.name);
      clientKeys.push(client.key);
    }

    const stored: StoredDirectory = {
      clientKeys,
      externalClinicIds: [],
      googleSheetIds: [],
      clinicNameKeys: [],
    };
    for await (const clinic of ctx.db.query("clinics").withIndex("by_clientId_and_name")) {
      if (clinic.externalClinicId) stored.externalClinicIds.push(clinic.externalClinicId);
      stored.googleSheetIds.push(clinic.googleSheetId);
      stored.clinicNameKeys.push(
        clinicNameKey(clientNameById.get(clinic.clientId) ?? "", clinic.name)
      );
    }
    return stored;
  },
});

/**
 * The clients and clinics Control Central has that the app does not store yet.
 * Admin only. Each call signs in to the carrier API and reads three lists from
 * it, so the screen runs it on demand instead of keeping it live.
 *
 * Throws ADMIN_REQUIRED, CARRIER_SIGN_IN_REJECTED or CARRIER_API_UNAVAILABLE.
 */
export const findMissingDirectory = action({
  args: {},
  returns: v.array(missingClientGroup),
  handler: async (ctx): Promise<MissingClientGroup[]> => {
    const stored: StoredDirectory = await ctx.runQuery(internal.directorySync.storedDirectory, {});

    const deadlineMs = actionDeadline();
    const signedIn = await signInCarrierApi(deadlineMs);
    if (!signedIn.ok) throw carrierError(signedIn.failure);

    const lists = await Promise.all(
      [CCC_CLIENTS_PATH, CCC_CLINICS_PATH, CCC_DRIVE_PATH].map((path) =>
        fetchCarrierList(path, signedIn.value, deadlineMs)
      )
    );
    const values: unknown[][] = [];
    for (const list of lists) {
      if (!list.ok) throw carrierError(list.failure);
      values.push(list.value);
    }

    const [clientRows, clinicRows, driveRows] = values;
    return findMissing(parseCccDirectory(clientRows, clinicRows, driveRows), stored);
  },
});

/** The client stored under `name`'s key, created active when there is none. */
async function ensureClient(
  ctx: MutationCtx,
  name: string
): Promise<{ clientId: Id<"clients">; key: string; created: boolean }> {
  const key = clientKeyFromName(name);
  const existing = await ctx.db
    .query("clients")
    .withIndex("by_key", (query) => query.eq("key", key))
    .first();
  if (existing !== null) return { clientId: existing._id, key, created: false };

  const clientId = await ctx.db.insert("clients", { key, name, isActive: true });
  return { clientId, key, created: true };
}

/**
 * Whether a clinic can be stored: it has every field, and neither its Control
 * Central id nor its spreadsheet is in use. The name inside its client is
 * checked once the client is known.
 */
async function isClinicAddable(ctx: MutationCtx, clinic: CccClinic) {
  const complete =
    clinic.name !== "" &&
    clinic.googleSheetId !== "" &&
    clinic.externalClinicId !== "" &&
    clientKeyFromName(clinic.clientName) !== "";
  if (!complete) return false;

  const sameId = await ctx.db
    .query("clinics")
    .withIndex("by_externalClinicId", (query) =>
      query.eq("externalClinicId", clinic.externalClinicId)
    )
    .first();
  if (sameId !== null) return false;

  const sameSheet = await ctx.db
    .query("clinics")
    .withIndex("by_googleSheetId", (query) => query.eq("googleSheetId", clinic.googleSheetId))
    .first();
  return sameSheet === null;
}

/**
 * Adds clients and clinics from Control Central, as `findMissingDirectory`
 * listed them. Admin only. A clinic creates its client when the client is
 * missing. Everything is created active, and a clinic starts with no sheet
 * column mapping.
 *
 * Entries that already exist, or that clash with a stored clinic's id,
 * spreadsheet or name, are skipped rather than failing the call, so a list read
 * a while ago can still be sent. At most MAX_ADD_BATCH clients and
 * MAX_ADD_BATCH clinics per call.
 */
export const addMissing = mutation({
  args: {
    clientNames: v.array(v.string()),
    clinics: v.array(cccClinic),
  },
  returns: v.object({
    addedClientKeys: v.array(v.string()),
    addedClinicIds: v.array(v.string()),
    skippedClinicIds: v.array(v.string()),
  }),
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    if (args.clientNames.length > MAX_ADD_BATCH || args.clinics.length > MAX_ADD_BATCH) {
      throw new Error(`Send at most ${MAX_ADD_BATCH} clients and ${MAX_ADD_BATCH} clinics.`);
    }

    const addedClientKeys: string[] = [];
    const addedClinicIds: string[] = [];
    const skippedClinicIds: string[] = [];

    for (const rawName of args.clientNames) {
      const name = rawName.trim();
      if (clientKeyFromName(name) === "") continue;
      const client = await ensureClient(ctx, name);
      if (client.created) addedClientKeys.push(client.key);
    }

    for (const raw of args.clinics) {
      const clinic = {
        externalClinicId: raw.externalClinicId.trim(),
        name: raw.name.trim(),
        clientName: raw.clientName.trim(),
        googleSheetId: raw.googleSheetId.trim(),
      };
      if (!(await isClinicAddable(ctx, clinic))) {
        skippedClinicIds.push(raw.externalClinicId);
        continue;
      }

      const client = await ensureClient(ctx, clinic.clientName);
      if (client.created) addedClientKeys.push(client.key);

      const sameName = await ctx.db
        .query("clinics")
        .withIndex("by_clientId_and_name", (query) =>
          query.eq("clientId", client.clientId).eq("name", clinic.name)
        )
        .first();
      if (sameName !== null) {
        skippedClinicIds.push(raw.externalClinicId);
        continue;
      }

      await ctx.db.insert("clinics", {
        clientId: client.clientId,
        name: clinic.name,
        googleSheetId: clinic.googleSheetId,
        externalClinicId: clinic.externalClinicId,
        isActive: true,
        sheetColumns: {},
        qaGroupKeys: [],
      });
      await adjustClientClinicCount(ctx, client.clientId, 1);
      addedClinicIds.push(raw.externalClinicId);
    }

    return { addedClientKeys, addedClinicIds, skippedClinicIds };
  },
});

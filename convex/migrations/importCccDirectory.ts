import type { Id } from "../_generated/dataModel";
import { v } from "convex/values";

import { internalMutation, internalQuery } from "../_generated/server";
import { clientKeyFromName } from "../model/clients";
import { clinicSheetColumns } from "../model/clinicSheetColumns";

const MAX_CLINICS = 2000;
const MAX_CLIENTS = 500;
const MAX_STAFF_PROFILES = 500;
// One wipe call deletes at most this many rows and asks to be called again, so
// the whole table never has to fit in a single transaction.
const WIPE_BATCH = 500;

const directoryClinic = v.object({
  clientName: v.string(),
  name: v.string(),
  externalClinicId: v.string(),
  googleSheetId: v.string(),
  sheetColumns: clinicSheetColumns,
  qaGroupKeys: v.array(v.string()),
});

// The part of a clinic the Control Central directory cannot supply: the column
// mapping the reports write to, and the QA groups carried by the legacy
// configs. The import reads this before wiping so it can keep them, and uses
// the Control Central id to recognise a clinic whose spreadsheet it shares
// with another one.
export const readSheetConfig = internalQuery({
  args: {},
  returns: v.array(
    v.object({
      googleSheetId: v.string(),
      externalClinicId: v.union(v.string(), v.null()),
      sheetColumns: clinicSheetColumns,
      qaGroupKeys: v.array(v.string()),
    })
  ),
  handler: async (ctx) => {
    const rows = await ctx.db.query("clinics").withIndex("by_clientId_and_name").take(MAX_CLINICS);
    return rows.map((row) => ({
      googleSheetId: row.googleSheetId,
      externalClinicId: row.externalClinicId ?? null,
      sheetColumns: row.sheetColumns ?? {},
      qaGroupKeys: row.qaGroupKeys ?? [],
    }));
  },
});

/**
 * Drops the whole directory and every clinic assignment, so the Control Central
 * import can rebuild both from scratch. Clinics go first because a client that
 * still owns one must not be removed, then clients, then the assignments that
 * point at the clinics that no longer exist.
 *
 * Returns `done: false` when it hit the batch limit, which means the caller has
 * to run it again before importing.
 */
export const wipeDirectory = internalMutation({
  args: {},
  returns: v.object({
    deletedClinics: v.number(),
    deletedClients: v.number(),
    clearedProfiles: v.number(),
    done: v.boolean(),
  }),
  handler: async (ctx) => {
    let deletedClinics = 0;
    const clinics = await ctx.db
      .query("clinics")
      .withIndex("by_clientId_and_name")
      .take(WIPE_BATCH);
    for (const clinic of clinics) {
      await ctx.db.delete("clinics", clinic._id);
      deletedClinics += 1;
    }
    if (clinics.length === WIPE_BATCH) {
      return { deletedClinics, deletedClients: 0, clearedProfiles: 0, done: false };
    }

    let deletedClients = 0;
    const clients = await ctx.db.query("clients").withIndex("by_key").take(MAX_CLIENTS);
    for (const client of clients) {
      await ctx.db.delete("clients", client._id);
      deletedClients += 1;
    }
    if (clients.length === MAX_CLIENTS) {
      return { deletedClinics, deletedClients, clearedProfiles: 0, done: false };
    }

    let clearedProfiles = 0;
    const profiles = await ctx.db
      .query("staffProfiles")
      .withIndex("by_userId")
      .take(MAX_STAFF_PROFILES);
    for (const profile of profiles) {
      if ((profile.assignedClinicIds ?? []).length === 0) continue;
      await ctx.db.patch(profile._id, { assignedClinicIds: [] });
      clearedProfiles += 1;
    }

    return { deletedClinics, deletedClients, clearedProfiles, done: true };
  },
});

/**
 * Inserts one batch of Control Central clinics with the client each one belongs
 * to. A client is created on demand and reused by the batches that follow, so
 * the caller may send the clinics in any order and in as many calls as it
 * needs. Every row is written active.
 */
export const insertClinics = internalMutation({
  args: { clinics: v.array(directoryClinic) },
  returns: v.object({ inserted: v.number(), clientsCreated: v.number(), skipped: v.number() }),
  handler: async (ctx, args) => {
    const clientIdByKey = new Map<string, Id<"clients">>();
    let clientsCreated = 0;
    let inserted = 0;
    let skipped = 0;

    for (const entry of args.clinics) {
      const clientName = entry.clientName.trim();
      const name = entry.name.trim();
      const externalClinicId = entry.externalClinicId.trim();
      const googleSheetId = entry.googleSheetId.trim();
      if (clientName === "" || name === "" || externalClinicId === "" || googleSheetId === "") {
        skipped += 1;
        continue;
      }

      const key = clientKeyFromName(clientName);
      let clientId = clientIdByKey.get(key);
      if (clientId === undefined) {
        const existing = await ctx.db
          .query("clients")
          .withIndex("by_key", (query) => query.eq("key", key))
          .first();
        if (existing !== null) {
          clientId = existing._id;
        } else {
          clientId = await ctx.db.insert("clients", { key, name: clientName, isActive: true });
          clientsCreated += 1;
        }
        clientIdByKey.set(key, clientId);
      }

      await ctx.db.insert("clinics", {
        clientId,
        name,
        googleSheetId,
        externalClinicId,
        isActive: true,
        sheetColumns: entry.sheetColumns,
        qaGroupKeys: entry.qaGroupKeys,
      });
      inserted += 1;
    }

    return { inserted, clientsCreated, skipped };
  },
});

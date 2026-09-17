import type { Id } from "../_generated/dataModel";
import { v } from "convex/values";

import { internalMutation, internalQuery } from "../_generated/server";
import { clientKeyFromName } from "../model/clients";
import { clinicSheetColumns } from "../model/clinicSheetColumns";

// One call reads, clears or deletes at most this many rows, so a table never
// has to fit in a single transaction. The script calls again while a call
// reports work left to do.
const BATCH = 500;

const directoryClinic = v.object({
  clientName: v.string(),
  name: v.string(),
  externalClinicId: v.string(),
  googleSheetId: v.string(),
  sheetColumns: clinicSheetColumns,
  qaGroupKeys: v.array(v.string()),
});

const sheetConfig = v.object({
  googleSheetId: v.string(),
  externalClinicId: v.union(v.string(), v.null()),
  sheetColumns: clinicSheetColumns,
  qaGroupKeys: v.array(v.string()),
});

/**
 * The part of a clinic the Control Central directory cannot supply: the column
 * mapping the reports write to, and the QA groups carried by the legacy
 * configs. The import reads this before wiping so it can keep them, and uses
 * the Control Central id to recognise a clinic whose spreadsheet it shares
 * with another one.
 *
 * One page of clinics per call, with the cursor of the next page, so every
 * clinic of the deployment keeps its mapping however many there are.
 */
export const readSheetConfig = internalQuery({
  args: { cursor: v.union(v.string(), v.null()) },
  returns: v.object({
    rows: v.array(sheetConfig),
    cursor: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("clinics")
      .withIndex("by_clientId_and_name")
      .paginate({ cursor: args.cursor, numItems: BATCH });

    return {
      rows: page.page.map((row) => ({
        googleSheetId: row.googleSheetId,
        externalClinicId: row.externalClinicId ?? null,
        sheetColumns: row.sheetColumns ?? {},
        qaGroupKeys: row.qaGroupKeys ?? [],
      })),
      cursor: page.isDone ? null : page.continueCursor,
    };
  },
});

/**
 * Drops the whole directory and every clinic assignment, so the Control Central
 * import can rebuild both from scratch. Clinics go first because a client that
 * still owns one must not be removed, then clients, then the assignments that
 * point at the clinics that no longer exist.
 *
 * Every stage handles one batch per call. The assignments are a page of the
 * table rather than a batch, and the cursor of the next page travels back in
 * `profileCursor`, so a page that holds no assignment still moves the wipe on
 * instead of reading the same rows again. `done` stays false while any stage
 * has work left, which means the caller has to run the mutation again before
 * importing.
 */
export const wipeDirectory = internalMutation({
  args: { profileCursor: v.union(v.string(), v.null()) },
  returns: v.object({
    deletedClinics: v.number(),
    deletedClients: v.number(),
    clearedProfiles: v.number(),
    profileCursor: v.union(v.string(), v.null()),
    done: v.boolean(),
  }),
  handler: async (ctx, args) => {
    let deletedClinics = 0;
    const clinics = await ctx.db.query("clinics").withIndex("by_clientId_and_name").take(BATCH);
    for (const clinic of clinics) {
      await ctx.db.delete("clinics", clinic._id);
      deletedClinics += 1;
    }
    if (clinics.length === BATCH) {
      return {
        deletedClinics,
        deletedClients: 0,
        clearedProfiles: 0,
        profileCursor: args.profileCursor,
        done: false,
      };
    }

    let deletedClients = 0;
    const clients = await ctx.db.query("clients").withIndex("by_key").take(BATCH);
    for (const client of clients) {
      await ctx.db.delete("clients", client._id);
      deletedClients += 1;
    }
    if (clients.length === BATCH) {
      return {
        deletedClinics,
        deletedClients,
        clearedProfiles: 0,
        profileCursor: args.profileCursor,
        done: false,
      };
    }

    const page = await ctx.db
      .query("staffProfiles")
      .withIndex("by_userId")
      .paginate({ cursor: args.profileCursor, numItems: BATCH });

    let clearedProfiles = 0;
    for (const profile of page.page) {
      if ((profile.assignedClinicIds ?? []).length === 0) continue;
      await ctx.db.patch(profile._id, { assignedClinicIds: [] });
      clearedProfiles += 1;
    }

    const profileCursor = page.isDone ? null : page.continueCursor;
    return {
      deletedClinics,
      deletedClients,
      clearedProfiles,
      profileCursor,
      done: profileCursor === null,
    };
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

      // A name without a letter or a number, like "&", has no key to store the
      // client under, and every such name would share one row.
      const key = clientKeyFromName(clientName);
      if (key === "") {
        skipped += 1;
        continue;
      }

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

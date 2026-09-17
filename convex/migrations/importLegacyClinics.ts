import { v } from "convex/values";

import type { Id } from "../_generated/dataModel";
import { internalMutation } from "../_generated/server";
import { clientKeyFromName } from "../model/clientKey";
import { adjustClientClinicCount } from "../model/clients";
import { clinicSheetColumns } from "../model/clinicSheetColumns";

const MAX_CLIENTS = 200;

const legacyClinicEntry = v.object({
  clientName: v.string(),
  googleSheetId: v.string(),
  name: v.string(),
  externalClinicId: v.optional(v.string()),
  isActive: v.boolean(),
  sheetColumns: clinicSheetColumns,
  qaGroupKeys: v.optional(v.array(v.string())),
});

// One-shot migration helper for scripts/import-legacy-clinics.ts.
// Creates missing clients by name, then matches clinics by googleSheetId:
// existing rows move to the target client and get patched, missing rows are
// created. Staff assignments are not touched.
export const applyLegacyClinics = internalMutation({
  args: {
    entries: v.array(legacyClinicEntry),
    dryRun: v.boolean(),
  },
  returns: v.object({
    clientsCreated: v.number(),
    clientsReused: v.number(),
    created: v.number(),
    updated: v.number(),
    skipped: v.number(),
    moved: v.number(),
    nameConflicts: v.array(v.string()),
  }),
  handler: async (ctx, args) => {
    const storedClients = await ctx.db.query("clients").withIndex("by_key").take(MAX_CLIENTS);
    const clientsByKey = new Map<string, Id<"clients">>();
    const clientsByName = new Map<string, Id<"clients">>();
    const clientKeysById = new Map<Id<"clients">, string>();
    for (const client of storedClients) {
      clientsByKey.set(client.key, client._id);
      clientsByName.set(client.name.toLowerCase(), client._id);
      clientKeysById.set(client._id, client.key);
    }

    const createdClientKeys = new Set<string>();
    const reusedClientKeys = new Set<string>();
    // What each client's stored clinic count gains or loses in this run. A dry
    // run writes neither the clinics nor the counts.
    const countDeltas = new Map<Id<"clients">, number>();
    const bumpCount = (clientId: Id<"clients">, delta: number) => {
      countDeltas.set(clientId, (countDeltas.get(clientId) ?? 0) + delta);
    };
    let created = 0;
    let updated = 0;
    let skipped = 0;
    let moved = 0;
    const nameConflicts: string[] = [];

    for (const entry of args.entries) {
      const clientName = entry.clientName.trim();
      const clientKey = clientKeyFromName(clientName);
      const name = entry.name.trim();
      const googleSheetId = entry.googleSheetId.trim();
      // A clinic row needs the Control Central id the carrier API is read with,
      // so entries whose legacy config carried no CLINIC_ID are skipped.
      const externalClinicId = entry.externalClinicId?.trim() ?? "";
      if (
        clientName === "" ||
        clientKey === "" ||
        name === "" ||
        googleSheetId === "" ||
        externalClinicId === ""
      ) {
        continue;
      }
      const nextQaGroupKeys = entry.qaGroupKeys ?? [];

      let clientId =
        clientsByKey.get(clientKey) ?? clientsByName.get(clientName.toLowerCase()) ?? null;
      if (clientId === null) {
        createdClientKeys.add(clientKey);
        if (!args.dryRun) {
          clientId = await ctx.db.insert("clients", {
            key: clientKey,
            name: clientName,
            isActive: true,
          });
          clientsByKey.set(clientKey, clientId);
          clientsByName.set(clientName.toLowerCase(), clientId);
          clientKeysById.set(clientId, clientKey);
        }
      } else if (!createdClientKeys.has(clientKey)) {
        reusedClientKeys.add(clientKey);
      }

      const clinic = await ctx.db
        .query("clinics")
        .withIndex("by_googleSheetId", (query) => query.eq("googleSheetId", googleSheetId))
        .first();

      if (clinic === null) {
        if (clientId !== null) {
          const nameTaken = await ctx.db
            .query("clinics")
            .withIndex("by_clientId_and_name", (query) =>
              query.eq("clientId", clientId).eq("name", name)
            )
            .first();
          if (nameTaken !== null) {
            nameConflicts.push(googleSheetId);
            continue;
          }

          if (!args.dryRun) {
            await ctx.db.insert("clinics", {
              clientId,
              name,
              googleSheetId,
              externalClinicId,
              isActive: entry.isActive,
              sheetColumns: entry.sheetColumns,
              qaGroupKeys: nextQaGroupKeys,
            });
            bumpCount(clientId, 1);
          }
        }
        created += 1;
        continue;
      }

      const willMove = clientKeysById.get(clinic.clientId) !== clientKey;
      const sheetColumnsUnchanged =
        JSON.stringify(clinic.sheetColumns ?? {}) === JSON.stringify(entry.sheetColumns);
      const qaUnchanged =
        JSON.stringify(clinic.qaGroupKeys ?? []) === JSON.stringify(nextQaGroupKeys);
      const nameUnchanged = clinic.name === name;
      const activeUnchanged = clinic.isActive === entry.isActive;
      const externalIdUnchanged = clinic.externalClinicId === externalClinicId;

      if (
        !willMove &&
        sheetColumnsUnchanged &&
        qaUnchanged &&
        nameUnchanged &&
        activeUnchanged &&
        externalIdUnchanged
      ) {
        skipped += 1;
        continue;
      }

      if (!nameUnchanged && clientId !== null) {
        const nameTaken = await ctx.db
          .query("clinics")
          .withIndex("by_clientId_and_name", (query) =>
            query.eq("clientId", clientId).eq("name", name)
          )
          .first();
        if (nameTaken !== null && nameTaken._id !== clinic._id) {
          nameConflicts.push(googleSheetId);
          continue;
        }
      }

      if (!args.dryRun && clientId !== null) {
        await ctx.db.patch(clinic._id, {
          clientId,
          name,
          isActive: entry.isActive,
          externalClinicId,
          sheetColumns: entry.sheetColumns,
          qaGroupKeys: nextQaGroupKeys,
        });
        if (willMove) {
          bumpCount(clinic.clientId, -1);
          bumpCount(clientId, 1);
        }
      }
      if (willMove) {
        moved += 1;
      }
      updated += 1;
    }

    for (const [clientId, delta] of countDeltas) {
      await adjustClientClinicCount(ctx, clientId, delta);
    }

    return {
      clientsCreated: createdClientKeys.size,
      clientsReused: reusedClientKeys.size,
      created,
      updated,
      skipped,
      moved,
      nameConflicts,
    };
  },
});

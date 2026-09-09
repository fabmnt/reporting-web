import { v } from "convex/values";

import { internalMutation } from "../_generated/server";
import { clinicSheetColumns } from "../model/clinicSheetColumns";

const legacyImportEntry = v.object({
  googleSheetId: v.string(),
  name: v.string(),
  externalClinicId: v.optional(v.string()),
  isActive: v.boolean(),
  sheetColumns: clinicSheetColumns,
  qaGroupKeys: v.optional(v.array(v.string())),
});

// One-shot migration helper for scripts/import-legacy-clinic-columns.ts.
// Matches clinics by googleSheetId, patches existing rows, and creates
// missing rows under the given clientId when provided.
export const applyLegacySheetColumns = internalMutation({
  args: {
    entries: v.array(legacyImportEntry),
    dryRun: v.boolean(),
    clientId: v.optional(v.id("clients")),
  },
  returns: v.object({
    matched: v.number(),
    updated: v.number(),
    created: v.number(),
    skipped: v.number(),
    missing: v.array(v.string()),
    nameConflicts: v.array(v.string()),
  }),
  handler: async (ctx, args) => {
    let matched = 0;
    let updated = 0;
    let created = 0;
    let skipped = 0;
    const missing: string[] = [];
    const nameConflicts: string[] = [];

    const client = args.clientId ? await ctx.db.get("clients", args.clientId) : null;
    if (args.clientId && client === null) {
      throw new Error("Client was not found.");
    }

    for (const entry of args.entries) {
      const name = entry.name.trim();
      const googleSheetId = entry.googleSheetId.trim();
      const externalClinicId = entry.externalClinicId?.trim() || undefined;
      const nextQaGroupKeys = entry.qaGroupKeys ?? [];
      if (name === "" || googleSheetId === "") {
        continue;
      }

      const clinic = await ctx.db
        .query("clinics")
        .withIndex("by_googleSheetId", (query) => query.eq("googleSheetId", googleSheetId))
        .first();

      if (clinic === null) {
        const targetClientId = args.clientId;
        if (!targetClientId) {
          missing.push(googleSheetId);
          continue;
        }

        const nameTaken = await ctx.db
          .query("clinics")
          .withIndex("by_clientId_and_name", (query) =>
            query.eq("clientId", targetClientId).eq("name", name)
          )
          .first();
        if (nameTaken !== null) {
          nameConflicts.push(googleSheetId);
          continue;
        }

        if (!args.dryRun) {
          await ctx.db.insert("clinics", {
            clientId: targetClientId,
            name,
            googleSheetId,
            externalClinicId,
            isActive: entry.isActive,
            sheetColumns: entry.sheetColumns,
            qaGroupKeys: nextQaGroupKeys,
          });
        }
        created += 1;
        continue;
      }

      matched += 1;
      const sheetColumnsUnchanged =
        JSON.stringify(clinic.sheetColumns ?? {}) === JSON.stringify(entry.sheetColumns);
      const qaUnchanged =
        JSON.stringify(clinic.qaGroupKeys ?? []) === JSON.stringify(nextQaGroupKeys);
      const nameUnchanged = clinic.name === name;
      const activeUnchanged = clinic.isActive === entry.isActive;
      const externalIdUnchanged = (clinic.externalClinicId ?? undefined) === externalClinicId;

      if (
        sheetColumnsUnchanged &&
        qaUnchanged &&
        nameUnchanged &&
        activeUnchanged &&
        externalIdUnchanged
      ) {
        skipped += 1;
        continue;
      }

      if (!nameUnchanged) {
        const nameTaken = await ctx.db
          .query("clinics")
          .withIndex("by_clientId_and_name", (query) =>
            query.eq("clientId", clinic.clientId).eq("name", name)
          )
          .first();
        if (nameTaken !== null && nameTaken._id !== clinic._id) {
          nameConflicts.push(googleSheetId);
          continue;
        }
      }

      if (!args.dryRun) {
        await ctx.db.patch(clinic._id, {
          name,
          isActive: entry.isActive,
          externalClinicId,
          sheetColumns: entry.sheetColumns,
          qaGroupKeys: nextQaGroupKeys,
        });
      }
      updated += 1;
    }

    return { matched, updated, created, skipped, missing, nameConflicts };
  },
});

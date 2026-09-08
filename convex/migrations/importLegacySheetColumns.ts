import { v } from "convex/values";

import { internalMutation } from "../_generated/server";
import { clinicSheetColumns } from "../model/clinicSheetColumns";

const legacyImportEntry = v.object({
  googleSheetId: v.string(),
  sheetColumns: clinicSheetColumns,
  qaGroupKeys: v.optional(v.array(v.string())),
});

// One-shot migration helper for scripts/import-legacy-clinic-columns.ts.
// Matches clinics by googleSheetId and patches sheetColumns / qaGroupKeys.
export const applyLegacySheetColumns = internalMutation({
  args: {
    entries: v.array(legacyImportEntry),
    dryRun: v.boolean(),
  },
  returns: v.object({
    matched: v.number(),
    updated: v.number(),
    skipped: v.number(),
    missing: v.array(v.string()),
  }),
  handler: async (ctx, args) => {
    let matched = 0;
    let updated = 0;
    let skipped = 0;
    const missing: string[] = [];

    for (const entry of args.entries) {
      const clinic = await ctx.db
        .query("clinics")
        .withIndex("by_googleSheetId", (query) => query.eq("googleSheetId", entry.googleSheetId))
        .first();

      if (clinic === null) {
        missing.push(entry.googleSheetId);
        continue;
      }

      matched += 1;
      const nextQaGroupKeys =
        entry.qaGroupKeys !== undefined ? entry.qaGroupKeys : (clinic.qaGroupKeys ?? []);
      const sheetColumnsUnchanged =
        JSON.stringify(clinic.sheetColumns ?? {}) === JSON.stringify(entry.sheetColumns);
      const qaUnchanged =
        JSON.stringify(clinic.qaGroupKeys ?? []) === JSON.stringify(nextQaGroupKeys);

      if (sheetColumnsUnchanged && qaUnchanged) {
        skipped += 1;
        continue;
      }

      if (!args.dryRun) {
        await ctx.db.patch(clinic._id, {
          sheetColumns: entry.sheetColumns,
          qaGroupKeys: nextQaGroupKeys,
        });
      }
      updated += 1;
    }

    return { matched, updated, skipped, missing };
  },
});

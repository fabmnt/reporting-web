import { v } from "convex/values";

import { internalMutation } from "../_generated/server";

const MAX_STAFF_PROFILES = 500;
const MAX_CLINICS = 500;

// One-shot helpers for schema cleanups. Run from the Convex dashboard or CLI:
//   npx convex run migrations/dataCleanup:migrateViewerRolesToOperator
//   npx convex run migrations/dataCleanup:stripRemovedSheetColumns
export const migrateViewerRolesToOperator = internalMutation({
  args: {},
  returns: v.object({ updated: v.number() }),
  handler: async (ctx) => {
    let updated = 0;
    const profiles = await ctx.db
      .query("staffProfiles")
      .withIndex("by_userId")
      .take(MAX_STAFF_PROFILES);

    for (const profile of profiles) {
      if ((profile.role as string) !== "viewer") continue;
      await ctx.db.patch(profile._id, { role: "operator" });
      updated += 1;
    }

    return { updated };
  },
});

export const stripRemovedSheetColumns = internalMutation({
  args: {},
  returns: v.object({ updated: v.number() }),
  handler: async (ctx) => {
    let updated = 0;
    const clinics = await ctx.db
      .query("clinics")
      .withIndex("by_clientId_and_name")
      .take(MAX_CLINICS);

    for (const clinic of clinics) {
      const sheetColumns = clinic.sheetColumns as Record<string, string | undefined> | undefined;
      if (sheetColumns === undefined) continue;
      if (!("url" in sheetColumns) && !("conditionalFormatting" in sheetColumns)) continue;

      await ctx.db.patch(clinic._id, {
        sheetColumns: {
          updateStatus: sheetColumns.updateStatus,
          uploadStatus: sheetColumns.uploadStatus,
          verificationType: sheetColumns.verificationType,
          fileUrl: sheetColumns.fileUrl,
        },
      });
      updated += 1;
    }

    return { updated };
  },
});

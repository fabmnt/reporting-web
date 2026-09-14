import { v } from "convex/values";

import { internalMutation } from "../_generated/server";

const MAX_STAFF_PROFILES = 500;
const MAX_CLINICS = 500;

// One-shot helpers for schema cleanups. Run from the Convex dashboard or CLI:
//   npx convex run migrations/dataCleanup:migrateViewerRolesToOperator
//   npx convex run migrations/dataCleanup:stripRemovedSheetColumns
//   npx convex run migrations/dataCleanup:removeReadyToUploadReport
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

// The operation key of the retired "ready to upload" built-in report. It is
// typed as a string because the key leaves the schema once every row is gone,
// and this cleanup has to keep compiling for deployments that still hold rows.
const REMOVED_OPERATION_KEY: string = "ready-to-upload";

// Deletes the runs and stored conditions of the retired report. Run this before
// the schema change that drops the operation key: the first push after a schema
// change validates every stored document.
export const removeReadyToUploadReport = internalMutation({
  args: {},
  returns: v.object({ deletedConditions: v.number(), deletedRuns: v.number() }),
  handler: async (ctx) => {
    let deletedConditions = 0;
    for await (const row of ctx.db.query("reportConditions")) {
      const operationKey: string = row.operationKey;
      if (operationKey !== REMOVED_OPERATION_KEY) continue;
      await ctx.db.delete("reportConditions", row._id);
      deletedConditions += 1;
    }

    let deletedRuns = 0;
    for await (const run of ctx.db.query("reportRuns")) {
      const operationKey: string | undefined = run.operationKey;
      if (operationKey !== REMOVED_OPERATION_KEY) continue;
      await ctx.db.delete("reportRuns", run._id);
      deletedRuns += 1;
    }

    return { deletedConditions, deletedRuns };
  },
});

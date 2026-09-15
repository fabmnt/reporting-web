import { v } from "convex/values";

import { internalMutation } from "../_generated/server";

// One-shot cleanup for a deployment that holds report rows written before
// administrators owned the built-in report types:
//   npx convex run migrations/reportTypesCleanup:run
//
// That change replaces `reportTypes.userId` with `ownerUserId`, adds
// `usesVerificationFilter`, and makes `reportRuns.reportTypeId` and
// `reportTypeName` required while dropping `operationKey`. The first push after
// a schema change validates every stored document and fails on the ones that do
// not match, so this has to run while the previous schema is still deployed:
// deploy a commit that adds this file on top of the previous schema, run it,
// then deploy the schema change.
//
// The rows cannot be converted here: the old schema rejects `ownerUserId`, and
// the new one cannot read a document that lacks it. Personal report types from
// the old shape are deleted instead. The previous release still shows their
// rules, so copy them by hand first if they matter.
export const run = internalMutation({
  args: {},
  returns: v.object({ deletedReportTypes: v.number(), deletedReportRuns: v.number() }),
  handler: async (ctx) => {
    let deletedReportTypes = 0;
    for await (const row of ctx.db.query("reportTypes")) {
      // The old shape kept the owner in `userId` and had no `ownerUserId`.
      if ((row as { ownerUserId?: unknown }).ownerUserId !== undefined) continue;
      await ctx.db.delete("reportTypes", row._id);
      deletedReportTypes += 1;
    }

    let deletedReportRuns = 0;
    for await (const run of ctx.db.query("reportRuns")) {
      const legacy = run as {
        reportTypeId?: unknown;
        reportTypeName?: unknown;
        operationKey?: unknown;
      };
      const matchesNewSchema =
        typeof legacy.reportTypeId === "string" &&
        typeof legacy.reportTypeName === "string" &&
        legacy.operationKey === undefined;
      if (matchesNewSchema) continue;
      await ctx.db.delete("reportRuns", run._id);
      deletedReportRuns += 1;
    }

    return { deletedReportTypes, deletedReportRuns };
  },
});

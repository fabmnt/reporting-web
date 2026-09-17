import { v } from "convex/values";

import { internalMutation, internalQuery, mutation } from "./_generated/server";
import { appError } from "./model/appErrors";
import { assertReportDateRange } from "./model/reporting";
import { loadRunnableReportType } from "./model/reportTypes";
import { requireOperator } from "./model/staff";

// The record of a report run. The row is written before a run reads anything,
// which is what lets the operator cancel it while it works, and it is closed
// once with the outcome of the run.
//
// Two connections to the same run meet here: the run form opens and cancels it,
// and the action that reads the sheets is given nothing but its id.

const runOutcome = v.union(v.literal("completed"), v.literal("failed"), v.literal("cancelled"));

// The settings of a run, as the run action reads them back from the record.
export const reportRunParams = v.object({
  userId: v.id("users"),
  reportTypeId: v.id("reportTypes"),
  startDate: v.string(),
  endDate: v.string(),
  startedAt: v.number(),
});

// Opens a run. The form holds the returned id while the action works, so the
// cancel button has something to name.
export const startReportRun = mutation({
  args: {
    reportTypeId: v.id("reportTypes"),
    startDate: v.string(),
    endDate: v.string(),
  },
  returns: v.object({ reportRunId: v.id("reportRuns") }),
  handler: async (ctx, args) => {
    const { userId } = await requireOperator(ctx);
    // A range the run cannot read is the form's problem, and a row written for
    // it would be a run that never had a chance to read anything.
    assertReportDateRange(args.startDate, args.endDate);
    const reportType = await loadRunnableReportType(ctx, userId, args.reportTypeId);

    const reportRunId = await ctx.db.insert("reportRuns", {
      initiatedByUserId: userId,
      reportTypeId: args.reportTypeId,
      // The name travels with the run, so a rename or a delete does not rewrite
      // what the run was asked for.
      reportTypeName: reportType.name,
      status: "running",
      startedAt: Date.now(),
      processedClinicCount: 0,
      succeededClinicCount: 0,
      failedClinicCount: 0,
      startDate: args.startDate,
      endDate: args.endDate,
    });

    return { reportRunId };
  },
});

// Stops a run. The action that reads the sheets asks this row between its
// steps, so the request reaches a run that is already working without a second
// connection to it.
export const cancelReportRun = mutation({
  args: { runId: v.id("reportRuns") },
  returns: v.object({ cancelled: v.boolean() }),
  handler: async (ctx, args) => {
    const { userId } = await requireOperator(ctx);
    const run = await ctx.db.get("reportRuns", args.runId);
    // Someone else's run reads as missing, the same as a run that never was.
    if (run === null || run.initiatedByUserId !== userId) {
      throw appError({ code: "REPORT_RUN_NOT_FOUND" });
    }
    // A run that already answered is left alone: the form is showing what it
    // read, and a request that arrives this late has nothing to stop.
    if (run.status !== "running") return { cancelled: false };

    await ctx.db.patch(run._id, { status: "cancelled" });
    return { cancelled: true };
  },
});

// The settings the run action works from, read back from the record the form
// opened, so the action is handed one id instead of a second copy of the form.
export const runParams = internalQuery({
  args: { runId: v.id("reportRuns") },
  returns: reportRunParams,
  handler: async (ctx, args) => {
    const { userId } = await requireOperator(ctx);
    const run = await ctx.db.get("reportRuns", args.runId);
    if (run === null || run.initiatedByUserId !== userId) {
      throw appError({ code: "REPORT_RUN_NOT_FOUND" });
    }

    return {
      userId: run.initiatedByUserId,
      reportTypeId: run.reportTypeId,
      // A run stored before the record carried its range has none left to read,
      // and the empty range is rejected where the run asks for its clinics.
      startDate: run.startDate ?? "",
      endDate: run.endDate ?? "",
      startedAt: run.startedAt,
    };
  },
});

// What a run asks between its steps.
export const isCancelled = internalQuery({
  args: { runId: v.id("reportRuns") },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const run = await ctx.db.get("reportRuns", args.runId);
    return run?.status === "cancelled";
  },
});

// Closes a run with what it reached. A run the operator stopped keeps
// "cancelled" even when it reached its last step before noticing, so the record
// never reports work that was called off.
export const finishReportRun = internalMutation({
  args: {
    runId: v.id("reportRuns"),
    status: runOutcome,
    clientId: v.optional(v.id("clients")),
    completedAt: v.number(),
    processedClinicCount: v.number(),
    succeededClinicCount: v.number(),
    failedClinicCount: v.number(),
    errorMessage: v.optional(v.string()),
  },
  returns: v.object({ cancelled: v.boolean() }),
  handler: async (ctx, args) => {
    const run = await ctx.db.get("reportRuns", args.runId);
    const cancelled = run?.status === "cancelled";

    await ctx.db.patch(args.runId, {
      status: cancelled ? "cancelled" : args.status,
      // Only known once the run has read its clinics, so it travels with the
      // outcome instead of with the settings.
      clientId: args.clientId,
      completedAt: args.completedAt,
      processedClinicCount: args.processedClinicCount,
      succeededClinicCount: args.succeededClinicCount,
      failedClinicCount: args.failedClinicCount,
      errorMessage: args.errorMessage,
    });

    return { cancelled };
  },
});

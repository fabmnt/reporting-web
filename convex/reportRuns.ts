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
// and the action that reads the sheets is given nothing but its id. The row is
// also the run's claim: it stays `pending` until the action takes it, so the
// sheets of one run are read once however often the action is called.

const runOutcome = v.union(v.literal("completed"), v.literal("failed"), v.literal("cancelled"));

// The settings of a run, as the action that reads its sheets is given them.
export const reportRunParams = v.object({
  userId: v.id("users"),
  reportTypeId: v.id("reportTypes"),
  startDate: v.string(),
  endDate: v.string(),
  startedAt: v.number(),
});

// What claiming a run answers: either the settings to read it with, or the
// news that the operator stopped it before it was taken.
const runClaim = v.union(
  v.object({ started: v.literal(false) }),
  v.object({ started: v.literal(true), params: reportRunParams })
);

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
      // Pending, not running: the action claims the record before it reads
      // anything, and until then the form may still close it.
      status: "pending",
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

// Takes a pending run for the action that reads it, which is what makes a run
// one-shot: the check and the write are one transaction, so two calls for the
// same id cannot both read the sheets, and a run that has been started before
// is turned away instead of reading every sheet again and rewriting its record.
//
// A run the operator stopped between the form and this call is not started
// again: it answers as cancelled, which is what the form asked for.
export const claimReportRun = internalMutation({
  args: { runId: v.id("reportRuns") },
  returns: runClaim,
  handler: async (ctx, args) => {
    const { userId } = await requireOperator(ctx);
    const run = await ctx.db.get("reportRuns", args.runId);
    if (run === null || run.initiatedByUserId !== userId) {
      throw appError({ code: "REPORT_RUN_NOT_FOUND" });
    }
    if (run.status === "cancelled") return { started: false as const };
    if (run.status !== "pending") throw appError({ code: "REPORT_RUN_ALREADY_STARTED" });

    await ctx.db.patch(run._id, { status: "running" });

    return {
      started: true as const,
      params: {
        userId: run.initiatedByUserId,
        reportTypeId: run.reportTypeId,
        // A run stored before the record carried its range has none left to
        // read, and the empty range is rejected where the run asks for its
        // clinics.
        startDate: run.startDate ?? "",
        endDate: run.endDate ?? "",
        startedAt: run.startedAt,
      },
    };
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
    if (run.status !== "pending" && run.status !== "running") return { cancelled: false };

    // A run that has not been claimed never starts, so this request is the
    // whole of it and the record is closed here. A running one is closed by the
    // action, which counts the clinics it had reached.
    if (run.status === "pending") {
      await ctx.db.patch(run._id, { status: "cancelled", completedAt: Date.now() });
      return { cancelled: true };
    }

    await ctx.db.patch(run._id, { status: "cancelled" });
    return { cancelled: true };
  },
});

// Closes a run the form opened but never started, which is what a call that
// could not reach the server leaves behind. A run the action already took is
// left alone: only a record still waiting to start is the form's to close.
export const abandonReportRun = mutation({
  args: { runId: v.id("reportRuns") },
  returns: v.object({ abandoned: v.boolean() }),
  handler: async (ctx, args) => {
    const { userId } = await requireOperator(ctx);
    const run = await ctx.db.get("reportRuns", args.runId);
    if (run === null || run.initiatedByUserId !== userId) {
      throw appError({ code: "REPORT_RUN_NOT_FOUND" });
    }
    if (run.status !== "pending") return { abandoned: false };

    await ctx.db.patch(run._id, {
      status: "failed",
      completedAt: Date.now(),
      errorMessage: "The run never started: the request never reached the server.",
    });
    return { abandoned: true };
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

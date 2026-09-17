import { internal } from "../_generated/api.js";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";

/**
 * Whether the operator stopped this run.
 *
 * Convex cannot interrupt an action from the outside, so a run asks its record
 * between its steps and ends at the next checkpoint after the request lands.
 * Every loop that reads a clinic or waits on Google asks before it starts the
 * next iteration, so the work already in flight finishes on its own while
 * nothing new is started behind it.
 */
export function reportRunCancelled(ctx: ActionCtx, runId: Id<"reportRuns">): Promise<boolean> {
  return ctx.runQuery(internal.reportRuns.isCancelled, { runId });
}

import { v } from "convex/values";

import { action, query } from "./_generated/server";
import { internal } from "./_generated/api.js";
import { actionDeadline, fetchSheetsJson, refreshAccessToken } from "./googleApi";
import { listProfileClinics } from "./model/reporting";
import { requireOperator } from "./model/staff";

type SheetsTabListResponse = {
  sheets?: Array<{ properties?: { title?: string } }>;
};

// Runs as the operator who called it: the action asks the currentOperator
// internal query to check staffProfiles with the caller's auth. Throws
// FORBIDDEN for disabled accounts and roles without operator access.
export const googleAuthStatus = action({
  args: {},
  returns: v.object({
    sheetsScope: v.boolean(),
    tokenOk: v.boolean(),
    error: v.union(v.string(), v.null()),
  }),
  handler: async (ctx) => {
    await ctx.runQuery(internal.staffAuth.currentOperator, {});
    try {
      await refreshAccessToken();
      return { sheetsScope: true, tokenOk: true, error: null };
    } catch (error) {
      return {
        sheetsScope: false,
        tokenOk: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
});

export const listSheetTabs = action({
  args: { googleSheetId: v.string() },
  returns: v.object({ tabs: v.array(v.string()) }),
  handler: async (ctx, args) => {
    await ctx.runQuery(internal.staffAuth.currentOperator, {});
    const token = await refreshAccessToken();
    const data = (await fetchSheetsJson(
      ctx,
      args.googleSheetId,
      token,
      actionDeadline()
    )) as SheetsTabListResponse;
    const tabs = (data.sheets ?? [])
      .map((sheet) => sheet.properties?.title ?? "")
      .filter((title) => title !== "");
    return { tabs };
  },
});

export const listAssignedReportClinics = query({
  args: {},
  returns: v.object({
    clinics: v.array(
      v.object({
        clinicId: v.id("clinics"),
        name: v.string(),
        clientName: v.string(),
      })
    ),
  }),
  handler: async (ctx) => {
    const { profile } = await requireOperator(ctx);
    const assigned = await listProfileClinics(ctx, profile);
    const clientNameById = new Map<string, string>();
    const clinics = [];
    for (const clinic of assigned) {
      let clientName = clientNameById.get(clinic.clientId);
      if (clientName === undefined) {
        const client = await ctx.db.get("clients", clinic.clientId);
        clientName = client?.name ?? "Unknown client";
        clientNameById.set(clinic.clientId, clientName);
      }
      clinics.push({
        clinicId: clinic._id,
        name: clinic.name,
        clientName,
      });
    }
    return { clinics };
  },
});

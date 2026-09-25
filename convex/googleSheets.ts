import { v } from "convex/values";

import { internal } from "./_generated/api.js";
import { action, query } from "./_generated/server";
import { checkCredential, credentialForClient, sheetsSessions } from "./googleSheetsAccess";
import { listProfileClinics } from "./model/reporting";
import { requireOperator } from "./model/staff";

// Reports which Google account reads a client's sheets and whether that account
// can be used at all. A caller that names no client is answered about the app's
// own account, which is what a client without a service account is read with.
//
// Runs as the operator who called it: the action asks the currentOperator
// internal query to check staffProfiles with the caller's auth. Throws
// FORBIDDEN for disabled accounts and roles without operator access.
export const googleAuthStatus = action({
  args: { clientId: v.optional(v.id("clients")) },
  returns: v.object({
    credential: v.union(v.literal("oauth"), v.literal("serviceAccount")),
    // The address of the service account, which is what a sheet has to be shared
    // with. Null when the app's own account reads the client.
    account: v.union(v.string(), v.null()),
    tokenOk: v.boolean(),
    error: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, args) => {
    await ctx.runQuery(internal.staffAuth.currentOperator, {});

    const credential = await credentialForClient(ctx, args.clientId ?? null);
    const status = await checkCredential(ctx, credential);

    return {
      credential: credential.kind,
      account: credential.kind === "serviceAccount" ? credential.email : null,
      tokenOk: status.ok,
      error: status.error,
    };
  },
});

// The tabs of one spreadsheet, read with the account of the client it belongs
// to. A caller that names no client reads it with the app's own account.
export const listSheetTabs = action({
  args: {
    googleSheetId: v.string(),
    clientId: v.optional(v.id("clients")),
  },
  returns: v.object({ tabs: v.array(v.string()) }),
  handler: async (ctx, args) => {
    await ctx.runQuery(internal.staffAuth.currentOperator, {});

    const session = await sheetsSessions(ctx).forClient(args.clientId ?? null);
    return { tabs: await session.listTabTitles(args.googleSheetId) };
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

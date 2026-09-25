import { v } from "convex/values";

import { internal } from "./_generated/api.js";
import type { Id } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";
import { action, internalQuery, query } from "./_generated/server";
import { checkCredential, credentialForClient, sheetsSessions } from "./googleSheetsAccess";
import { appError } from "./model/appErrors";
import { listProfileClinics } from "./model/reporting";
import { requireOperator } from "./model/staff";

/**
 * Whether the caller holds at least one clinic of the client. Actions cannot
 * read staffProfiles themselves, so the check travels through this query with
 * the caller's auth.
 */
export const clientIsInScope = internalQuery({
  args: { clientId: v.id("clients") },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const { profile } = await requireOperator(ctx);
    const assigned = await listProfileClinics(ctx, profile);
    return assigned.some((clinic) => clinic.clientId === args.clientId);
  },
});

/**
 * The account that reads a client's sheets is only used for an operator who
 * works on that client, which is the scope a run reads sheets with. A caller
 * that names no client needs no check: it is answered about the app's own
 * account.
 */
async function assertClientInScope(ctx: ActionCtx, clientId: Id<"clients"> | null): Promise<void> {
  if (clientId === null) return;
  const inScope = await ctx.runQuery(internal.googleSheets.clientIsInScope, { clientId });
  if (!inScope) throw appError({ code: "CLIENT_NOT_ASSIGNED" });
}

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

    const clientId = args.clientId ?? null;
    await assertClientInScope(ctx, clientId);

    const credential = await credentialForClient(ctx, clientId);
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

    const clientId = args.clientId ?? null;
    await assertClientInScope(ctx, clientId);

    const session = await sheetsSessions(ctx).forClient(clientId);
    return { tabs: await session.listTabTitles(args.googleSheetId) };
  },
});

// The clinics a run may read, as the run form lists them. The client travels
// with each clinic, because a report group holds whole clients besides single
// clinics, and the form resolves both against this list.
export const listAssignedReportClinics = query({
  args: {},
  returns: v.object({
    clinics: v.array(
      v.object({
        clinicId: v.id("clinics"),
        clientId: v.id("clients"),
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
        clientId: clinic.clientId,
        name: clinic.name,
        clientName,
      });
    }
    return { clinics };
  },
});

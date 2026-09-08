import { v } from "convex/values";

import { action, query } from "./_generated/server";
import { internal } from "./_generated/api.js";
import { env } from "./_generated/server";
import { listProfileClinics, profileUsesAllClinics } from "./model/reporting";
import { requireOperator } from "./model/staff";

type GoogleTokenResponse = {
  access_token?: string;
  error?: string;
  error_description?: string;
};

type SheetsTabListResponse = {
  sheets?: Array<{ properties?: { title?: string } }>;
};

const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const GOOGLE_SHEETS_BASE = "https://sheets.googleapis.com/v4/spreadsheets";

// Runs as the operator who called it: the action asks the currentOperator
// internal query to check staffProfiles with the caller's auth. Throws
// FORBIDDEN for viewers and disabled accounts.
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

async function refreshAccessToken(): Promise<string> {
  const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_OAUTH_CLIENT_ID,
      client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET,
      refresh_token: env.GOOGLE_REFRESH_TOKEN,
      grant_type: "refresh_token",
    }),
  });
  const data = (await response.json()) as GoogleTokenResponse;
  if (!response.ok || !data.access_token) {
    throw new Error(data.error_description ?? data.error ?? "Google token refresh failed.");
  }
  return data.access_token;
}

async function sheetsFetch(path: string, token: string): Promise<unknown> {
  const response = await fetch(`${GOOGLE_SHEETS_BASE}/${path}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    throw new Error(`Google Sheets request failed with status ${response.status}.`);
  }
  return (await response.json()) as unknown;
}

export const listSheetTabs = action({
  args: { googleSheetId: v.string() },
  returns: v.object({ tabs: v.array(v.string()) }),
  handler: async (ctx, args) => {
    await ctx.runQuery(internal.staffAuth.currentOperator, {});
    const token = await refreshAccessToken();
    const data = (await sheetsFetch(args.googleSheetId, token)) as SheetsTabListResponse;
    const tabs = (data.sheets ?? [])
      .map((sheet) => sheet.properties?.title ?? "")
      .filter((title) => title !== "");
    return { tabs };
  },
});

export const listAssignedReportClinics = query({
  args: {},
  returns: v.object({
    usesAllClinics: v.boolean(),
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
    return {
      usesAllClinics: profileUsesAllClinics(profile),
      clinics,
    };
  },
});

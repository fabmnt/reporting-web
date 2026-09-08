import { v } from "convex/values";

import { internalAction } from "./_generated/server";
import { env } from "./_generated/server";
import { tabsInDateRange } from "./model/reporting";

const DATE_TAB_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_NON_DATE_TAB_SAMPLES = 8;

const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const GOOGLE_SHEETS_BASE = "https://sheets.googleapis.com/v4/spreadsheets";

type GoogleTokenResponse = {
  access_token?: string;
  error?: string;
  error_description?: string;
};

type SheetsTabListResponse = {
  sheets?: Array<{ properties?: { title?: string } }>;
};

type SheetsValuesResponse = {
  values?: string[][];
};

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

// Internal helpers only: the public runSheetReport action owns auth and calls
// these, so Sheets access never bypasses requireOperator.
const clinicTabCatalog = v.object({
  inRange: v.array(v.string()),
  dateTabsOutsideRange: v.array(v.string()),
  nonDateTabSamples: v.array(v.string()),
  nonDateTabCount: v.number(),
});

export const planSheetTabs = internalAction({
  args: {
    clinics: v.array(v.object({ clinicId: v.id("clinics"), googleSheetId: v.string() })),
    startDate: v.string(),
    endDate: v.string(),
  },
  returns: v.object({
    tabsForClinic: v.record(v.string(), v.array(v.string())),
    tabCatalogForClinic: v.record(v.string(), clinicTabCatalog),
  }),
  handler: async (_ctx, args) => {
    const token = await refreshAccessToken();
    const tabsForClinic: Record<string, string[]> = {};
    const tabCatalogForClinic: Record<
      string,
      {
        inRange: string[];
        dateTabsOutsideRange: string[];
        nonDateTabSamples: string[];
        nonDateTabCount: number;
      }
    > = {};
    for (const clinic of args.clinics) {
      const data = (await sheetsFetch(clinic.googleSheetId, token)) as SheetsTabListResponse;
      const titles = (data.sheets ?? [])
        .map((sheet) => sheet.properties?.title ?? "")
        .filter((title) => title !== "");
      const inRange = tabsInDateRange(titles, args.startDate, args.endDate);
      const dateTabs = titles.filter((title) => DATE_TAB_PATTERN.test(title)).sort();
      const inRangeSet = new Set(inRange);
      const dateTabsOutsideRange = dateTabs.filter((title) => !inRangeSet.has(title));
      const nonDateTabs = titles.filter((title) => !DATE_TAB_PATTERN.test(title));
      tabsForClinic[clinic.clinicId] = inRange;
      tabCatalogForClinic[clinic.clinicId] = {
        inRange,
        dateTabsOutsideRange,
        nonDateTabSamples: nonDateTabs.slice(0, MAX_NON_DATE_TAB_SAMPLES),
        nonDateTabCount: nonDateTabs.length,
      };
    }
    return { tabsForClinic, tabCatalogForClinic };
  },
});

export const readSheetTabValues = internalAction({
  args: { googleSheetId: v.string(), tabTitle: v.string() },
  returns: v.object({
    headers: v.array(v.string()),
    values: v.array(v.array(v.string())),
  }),
  handler: async (_ctx, args) => {
    const token = await refreshAccessToken();
    const range = encodeURIComponent(`${args.tabTitle}!A1:ZZZ20000`);
    const data = (await sheetsFetch(
      `${args.googleSheetId}/values/${range}`,
      token
    )) as SheetsValuesResponse;
    // First row is the header, same as the old tool's get_rows() which pops row 0.
    const allRows = (data.values ?? []).map((row) => row.map((cell) => cell ?? ""));
    if (allRows.length === 0) return { headers: [], values: [] };
    return { headers: allRows[0] ?? [], values: allRows.slice(1) };
  },
});

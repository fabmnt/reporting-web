import { v } from "convex/values";

import { internalAction } from "./_generated/server";
import { env } from "./_generated/server";
import { tabsInDateRange } from "./model/reporting";

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

type SheetsValueRange = {
  values?: string[][];
};

type SheetsBatchValuesResponse = {
  valueRanges?: SheetsValueRange[];
};

type SheetTabValues = {
  tabTitle: string;
  headers: string[];
  values: string[][];
  error: string | null;
};

// spreadsheets.get has no batch variant, so planning still costs one request
// per clinic. Values are batched with values:batchGet instead: one request
// covers many tabs of the same spreadsheet. Ranges travel in the query string,
// so long date ranges are sent in chunks.
const MAX_RANGES_PER_BATCH_REQUEST = 25;
const SHEET_TITLE_FIELDS = "sheets.properties.title";

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
    // Google explains rejected ranges and quota failures in the body. The
    // status code alone is not enough to act on a failed batch.
    const detail = (await response.text()).trim();
    const suffix = detail === "" ? "" : ` ${detail.slice(0, 300)}`;
    throw new Error(`Google Sheets request failed with status ${response.status}.${suffix}`);
  }
  return (await response.json()) as unknown;
}

// Internal helpers only: the public runSheetReport action owns auth and calls
// these, so Sheets access never bypasses requireOperator.
export const planSheetTabs = internalAction({
  args: {
    clinics: v.array(v.object({ clinicId: v.id("clinics"), googleSheetId: v.string() })),
    startDate: v.string(),
    endDate: v.string(),
  },
  returns: v.object({
    tabsForClinic: v.record(v.string(), v.array(v.string())),
  }),
  handler: async (_ctx, args) => {
    const token = await refreshAccessToken();
    const tabsForClinic: Record<string, string[]> = {};
    for (const clinic of args.clinics) {
      const data = (await sheetsFetch(
        `${clinic.googleSheetId}?fields=${SHEET_TITLE_FIELDS}`,
        token
      )) as SheetsTabListResponse;
      const titles = (data.sheets ?? [])
        .map((sheet) => sheet.properties?.title ?? "")
        .filter((title) => title !== "");
      tabsForClinic[clinic.clinicId] = tabsInDateRange(titles, args.startDate, args.endDate);
    }
    return { tabsForClinic };
  },
});

// values:batchGet answers with one ValueRange per requested range, in the same
// order. Empty ranges come back without a "values" field, so both cases map to
// an empty grid.
function toSheetTabValues(tabTitle: string, grid: string[][] | undefined): SheetTabValues {
  // First row is the header, same as the old tool's get_rows() which pops row 0.
  const allRows = (grid ?? []).map((row) => row.map((cell) => cell ?? ""));
  if (allRows.length === 0) return { tabTitle, headers: [], values: [], error: null };
  return { tabTitle, headers: allRows[0] ?? [], values: allRows.slice(1), error: null };
}

// Reads every requested tab of one spreadsheet. Batches the tabs so a clinic
// with many tabs in range costs a chunk of requests instead of one per tab.
// A failed chunk comes back as per-tab errors, so the other tabs of the same
// spreadsheet still return their data.
export const readSheetTabsValues = internalAction({
  args: { googleSheetId: v.string(), tabTitles: v.array(v.string()) },
  returns: v.array(
    v.object({
      tabTitle: v.string(),
      headers: v.array(v.string()),
      values: v.array(v.array(v.string())),
      error: v.union(v.string(), v.null()),
    })
  ),
  handler: async (_ctx, args): Promise<SheetTabValues[]> => {
    const token = await refreshAccessToken();
    const results: SheetTabValues[] = [];
    for (let start = 0; start < args.tabTitles.length; start += MAX_RANGES_PER_BATCH_REQUEST) {
      const chunk = args.tabTitles.slice(start, start + MAX_RANGES_PER_BATCH_REQUEST);
      try {
        const query = chunk
          .map((tabTitle) => `ranges=${encodeURIComponent(`${tabTitle}!A1:ZZZ20000`)}`)
          .join("&");
        const data = (await sheetsFetch(
          `${args.googleSheetId}/values:batchGet?${query}`,
          token
        )) as SheetsBatchValuesResponse;
        const valueRanges = data.valueRanges ?? [];
        if (valueRanges.length !== chunk.length) {
          throw new Error(
            `Google Sheets returned ${valueRanges.length} ranges for ${chunk.length} requested tabs.`
          );
        }
        chunk.forEach((tabTitle, index) => {
          results.push(toSheetTabValues(tabTitle, valueRanges[index]?.values));
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        for (const tabTitle of chunk) {
          results.push({ tabTitle, headers: [], values: [], error: message });
        }
      }
    }
    return results;
  },
});

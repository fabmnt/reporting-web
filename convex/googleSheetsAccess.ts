import { internal } from "./_generated/api.js";
import type { Id } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";
import { fetchSheetsJson, refreshAccessToken } from "./googleApi";
import { OAUTH_CREDENTIAL, credentialKey, type GoogleCredential } from "./model/googleCredentials";
import { toSheetGrid, type SheetGrid } from "./model/googleGrid";
import { actionDeadline } from "./model/googlePolicy";

// spreadsheets.get has no batch variant, so listing the tabs of a spreadsheet
// costs one request each. Values are batched with values:batchGet instead: one
// request covers many ranges of the same spreadsheet.
const SHEET_TITLE_FIELDS = "sheets.properties.title";

type SheetsTabListResponse = {
  sheets?: Array<{ properties?: { title?: string } }>;
};

type SheetsBatchValuesResponse = {
  valueRanges?: Array<{ values?: unknown }>;
};

/**
 * The Sheets calls one credential makes. Every caller reads a client's sheets
 * through a session, so which account a client uses is decided in one place: a
 * client with a service account travels through googleapis in the Node runtime,
 * and a client without one through the fetch client the app has always used.
 */
export type SheetsSession = {
  // The title of every tab of one spreadsheet, in the order Google lists them.
  listTabTitles(spreadsheetId: string): Promise<string[]>;
  // The cells of each requested range, in the same order. A range Google has
  // nothing for comes back empty.
  readRanges(spreadsheetId: string, ranges: string[]): Promise<SheetGrid[]>;
};

function tabTitlesOf(data: SheetsTabListResponse): string[] {
  return (data.sheets ?? [])
    .map((sheet) => sheet.properties?.title ?? "")
    .filter((title) => title !== "");
}

// values:batchGet answers with one range per requested range, in the same order,
// and a range that holds nothing comes back without a values field.
function gridsOf(data: SheetsBatchValuesResponse, requested: number): SheetGrid[] {
  const valueRanges = data.valueRanges ?? [];
  if (valueRanges.length !== requested) {
    throw new Error(
      `Google Sheets returned ${valueRanges.length} ranges for ${requested} requested tabs.`
    );
  }
  return valueRanges.map((range) => toSheetGrid(range.values));
}

// The app's own account: one refresh token covers the whole action, refreshed
// once here instead of once per request.
async function oauthSession(ctx: ActionCtx, credential: GoogleCredential): Promise<SheetsSession> {
  const deadlineMs = actionDeadline();
  const bucket = credentialKey(credential);
  const token = await refreshAccessToken();

  return {
    async listTabTitles(spreadsheetId) {
      const data = (await fetchSheetsJson(
        ctx,
        `${spreadsheetId}?fields=${SHEET_TITLE_FIELDS}`,
        token,
        deadlineMs,
        bucket
      )) as SheetsTabListResponse;
      return tabTitlesOf(data);
    },
    async readRanges(spreadsheetId, ranges) {
      const query = ranges.map((range) => `ranges=${encodeURIComponent(range)}`).join("&");
      const data = (await fetchSheetsJson(
        ctx,
        `${spreadsheetId}/values:batchGet?${query}`,
        token,
        deadlineMs,
        bucket
      )) as SheetsBatchValuesResponse;
      return gridsOf(data, ranges.length);
    },
  };
}

// A service account: the calls are made in the Node runtime, which googleapis
// and google-auth-library run in. The token is not refreshed here, because the
// client that signs the JWT caches its own token and stays alive between calls.
function serviceAccountSession(
  ctx: ActionCtx,
  credential: Extract<GoogleCredential, { kind: "serviceAccount" }>
): SheetsSession {
  const serviceAccountId = credential.serviceAccountId;

  return {
    async listTabTitles(spreadsheetId) {
      return await ctx.runAction(internal.googleServiceAccount.readTabTitles, {
        serviceAccountId,
        spreadsheetId,
      });
    },
    async readRanges(spreadsheetId, ranges) {
      return await ctx.runAction(internal.googleServiceAccount.readTabValues, {
        serviceAccountId,
        spreadsheetId,
        ranges,
      });
    },
  };
}

// The credential a client's sheets are read with. A caller that does not know
// the client reads them with the app's own account, and a client that links an
// account Google has since forgotten fails instead of quietly reading with the
// app's account.
export async function credentialForClient(
  ctx: ActionCtx,
  clientId: Id<"clients"> | null
): Promise<GoogleCredential> {
  if (clientId === null) return OAUTH_CREDENTIAL;
  return await ctx.runQuery(internal.googleAccounts.credentialForClient, { clientId });
}

async function openSession(ctx: ActionCtx, credential: GoogleCredential): Promise<SheetsSession> {
  return credential.kind === "serviceAccount"
    ? serviceAccountSession(ctx, credential)
    : await oauthSession(ctx, credential);
}

/**
 * The sessions of one action, opened on demand and kept for its life. A run that
 * spans several clients of the same credential opens that credential once, so
 * its token is refreshed once instead of once per client, and every clinic of
 * the action shares one deadline. A credential that cannot be opened keeps
 * failing for the clinics that ask for it later, which is why the attempt itself
 * is what is kept.
 *
 * A session that cannot be opened throws, which is the error of every sheet that
 * client owns.
 */
export function sheetsSessions(ctx: ActionCtx): {
  forClient(clientId: Id<"clients"> | null): Promise<SheetsSession>;
} {
  const opened = new Map<string, Promise<SheetsSession>>();

  return {
    async forClient(clientId) {
      const credential = await credentialForClient(ctx, clientId);
      const key = credentialKey(credential);

      let session = opened.get(key);
      if (session === undefined) {
        session = openSession(ctx, credential);
        opened.set(key, session);
      }
      return await session;
    },
  };
}

/**
 * Whether a credential can be used at all, without naming a sheet: the app's
 * account is asked for a token, and a service account is asked to sign one. What
 * an account is allowed to read is not part of this, and the first run reports
 * it per sheet.
 */
export async function checkCredential(
  ctx: ActionCtx,
  credential: GoogleCredential
): Promise<{ ok: boolean; error: string | null }> {
  if (credential.kind === "serviceAccount") {
    return await ctx.runAction(internal.googleServiceAccount.checkCredential, {
      serviceAccountId: credential.serviceAccountId,
    });
  }

  try {
    await refreshAccessToken();
    return { ok: true, error: null };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

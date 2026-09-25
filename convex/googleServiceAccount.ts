"use node";

import { JWT } from "google-auth-library";
import { google } from "googleapis";
import { v } from "convex/values";

import { internal } from "./_generated/api.js";
import type { Id } from "./_generated/dataModel";
import { internalAction } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import { awaitSheetsSlot } from "./googleApi";
import { appError } from "./model/appErrors";
import { serviceAccountBucket } from "./model/googleCredentials";
import { toSheetGrid, type SheetGrid } from "./model/googleGrid";
import {
  actionDeadline,
  failureOf,
  requestTimeoutMs,
  sendGoogleCall,
  type GoogleFailure,
} from "./model/googlePolicy";

/**
 * The Sheets API as a service account reads it: this is the only place the two
 * Google libraries run, and the only place a stored private key is read.
 *
 * The libraries are Node packages, so the file declares the Node runtime. Only
 * actions may run there, which is why every caller reaches this module through
 * an action (internal.googleServiceAccount.*) instead of importing it.
 */

// The app only reads sheets, whichever account it reads them with.
const SHEETS_READONLY_SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";

type ServiceAccountKey = {
  email: string;
  privateKey: string;
};

type GaxiosErrorShape = {
  response?: { status?: number; data?: unknown; headers?: unknown };
  message?: string;
};

type SheetsClient = ReturnType<typeof google.sheets>;

// The Sheets client of a service account, kept for the life of the instance.
// google-auth-library caches the access token inside its auth client until the
// token expires, so holding on to the client is what stops a run that reads many
// sheets of one client from asking Google for a token once per spreadsheet. A
// key that changed in the database builds a new client, so a rotated key takes
// effect at once.
const clientsByAccount = new Map<string, { key: ServiceAccountKey; client: SheetsClient }>();

function sheetsClientFor(
  serviceAccountId: Id<"googleServiceAccounts">,
  key: ServiceAccountKey
): SheetsClient {
  const cached = clientsByAccount.get(serviceAccountId);
  if (
    cached !== undefined &&
    cached.key.email === key.email &&
    cached.key.privateKey === key.privateKey
  ) {
    return cached.client;
  }

  const client = google.sheets({
    version: "v4",
    auth: new JWT({
      email: key.email,
      key: key.privateKey,
      scopes: [SHEETS_READONLY_SCOPE],
    }),
  });
  clientsByAccount.set(serviceAccountId, { key, client });
  return client;
}

// The node client answers a failed request with a GaxiosError, which carries the
// status and the body Google sent in `response` and nothing else the shared
// policy could read.
function retryAfterHeaderOf(headers: unknown): string | null {
  if (headers === null || typeof headers !== "object") return null;

  const getter = (headers as { get?: unknown }).get;
  if (typeof getter === "function") {
    const value: unknown = getter.call(headers, "retry-after");
    return typeof value === "string" ? value : null;
  }

  const record = headers as Record<string, unknown>;
  const value = record["retry-after"] ?? record["Retry-After"];
  return typeof value === "string" ? value : null;
}

function googleFailureOf(error: unknown): GoogleFailure {
  const shaped = (typeof error === "object" && error !== null ? error : {}) as GaxiosErrorShape;
  const status = typeof shaped.response?.status === "number" ? shaped.response.status : 0;
  const body = shaped.response?.data ?? null;
  // Google explains a rejected call in the body, and that reason is the part
  // worth showing: a sheet the account cannot read says so there, and a key
  // Google turned down answers with its own description. The message of the
  // thrown error repeats the status line, which the caller adds anyway.
  const fields = (typeof body === "object" && body !== null ? body : {}) as {
    error?: { message?: unknown };
    error_description?: unknown;
  };
  const reason = fields.error?.message ?? fields.error_description;
  const detail =
    typeof reason === "string" && reason !== "" ? reason : (shaped.message ?? String(error));

  return failureOf({
    status,
    detail,
    body,
    retryAfterHeader: retryAfterHeaderOf(shaped.response?.headers),
  });
}

// The wording a sheet reports when a service account cannot read it and no code
// covers the reason. Naming the address is what tells an operator which account
// the sheet has to be shared with.
function sheetsFailureMessage(failure: GoogleFailure, email: string): string {
  const suffix = failure.detail === "" ? "" : ` ${failure.detail}`;
  if (failure.status === 404) {
    return `The service account ${email} cannot find that spreadsheet. Check the sheet id and share the sheet with that address.${suffix}`;
  }
  if (failure.status === 0) return `Google Sheets request failed as ${email}. ${failure.detail}`;
  return `Google Sheets request failed with status ${failure.status} as ${email}.${suffix}`;
}

// Google's token endpoint answers a key it will not sign with using
// error/error_description, while the Sheets API answers a refused request with
// error.message. Only the first means the account itself is unusable, which is
// what lets a run read the sheet with another account instead.
function keyRefused(failure: GoogleFailure): boolean {
  const body = (typeof failure.body === "object" && failure.body !== null ? failure.body : {}) as {
    error_description?: unknown;
  };
  return typeof body.error_description === "string";
}

// The stored key of a service account. Only this module asks for it: the query
// is internal, so the private key never reaches a client, and every caller of
// this module holds a service account id rather than a key.
async function loadKey(
  ctx: ActionCtx,
  serviceAccountId: Id<"googleServiceAccounts">
): Promise<ServiceAccountKey> {
  return await ctx.runQuery(internal.googleAccounts.serviceAccountKey, { serviceAccountId });
}

// Runs one Sheets call through the shared retry policy, paced against the budget
// of the service account that makes it. The request is dropped when the action's
// budget runs out, so a connection that stalls cannot outlive the action and
// take the sheets it had not read with it.
async function callSheets<T>(
  ctx: ActionCtx,
  account: { serviceAccountId: Id<"googleServiceAccounts">; key: ServiceAccountKey },
  call: (timeoutMs: number) => Promise<T>
): Promise<T> {
  const deadlineMs = actionDeadline();
  return await sendGoogleCall({
    attempt: async () => {
      try {
        return { kind: "success", value: await call(requestTimeoutMs(deadlineMs)) } as const;
      } catch (error) {
        return { kind: "failure", failure: googleFailureOf(error) } as const;
      }
    },
    beforeAttempt: () =>
      awaitSheetsSlot(ctx, deadlineMs, serviceAccountBucket(account.serviceAccountId)),
    deadlineMs,
    failure: (failure) => {
      if (failure.quotaRejection) return appError({ code: "SHEET_RATE_LIMITED" });
      // A sheet Google refuses is the same fix for every sheet the client owns,
      // so it travels as a code the operator reads in their own language
      // instead of as the text Google answered with.
      if (failure.status === 403) {
        return appError({ code: "SERVICE_ACCOUNT_DENIED", email: account.key.email });
      }
      if (keyRefused(failure)) {
        return appError({ code: "SERVICE_ACCOUNT_KEY_REFUSED", email: account.key.email });
      }
      return new Error(sheetsFailureMessage(failure, account.key.email));
    },
  });
}

// Whether the stored key can be signed with at all. This is what the admin
// screen's test button asks, and it costs one token request: it says nothing
// about which sheets the account can read, which the first run reports.
export const checkCredential = internalAction({
  args: { serviceAccountId: v.id("googleServiceAccounts") },
  returns: v.object({ ok: v.boolean(), error: v.union(v.string(), v.null()) }),
  handler: async (ctx, args) => {
    try {
      const key = await loadKey(ctx, args.serviceAccountId);
      const auth = new JWT({
        email: key.email,
        key: key.privateKey,
        scopes: [SHEETS_READONLY_SCOPE],
      });
      const token = await auth.getAccessToken();
      if (token.token === null || token.token === undefined || token.token === "") {
        throw new Error("Google answered without an access token.");
      }
      return { ok: true, error: null };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  },
});

// The title of every tab of one spreadsheet, in the order Google lists them.
export const readTabTitles = internalAction({
  args: {
    serviceAccountId: v.id("googleServiceAccounts"),
    spreadsheetId: v.string(),
  },
  returns: v.array(v.string()),
  handler: async (ctx, args): Promise<string[]> => {
    const key = await loadKey(ctx, args.serviceAccountId);
    const sheets = sheetsClientFor(args.serviceAccountId, key);
    const response = await callSheets(
      ctx,
      { serviceAccountId: args.serviceAccountId, key },
      (timeoutMs) =>
        sheets.spreadsheets.get(
          {
            spreadsheetId: args.spreadsheetId,
            fields: "sheets.properties.title",
          },
          { signal: AbortSignal.timeout(timeoutMs) }
        )
    );

    return (response.data.sheets ?? [])
      .map((sheet) => sheet.properties?.title ?? "")
      .filter((title) => title !== "");
  },
});

// The cells of every requested range of one spreadsheet, in the same order.
// values:batchGet answers with one range per request, and a range Google has
// nothing for comes back empty.
export const readTabValues = internalAction({
  args: {
    serviceAccountId: v.id("googleServiceAccounts"),
    spreadsheetId: v.string(),
    ranges: v.array(v.string()),
  },
  returns: v.array(v.array(v.array(v.string()))),
  handler: async (ctx, args): Promise<SheetGrid[]> => {
    const key = await loadKey(ctx, args.serviceAccountId);
    const sheets = sheetsClientFor(args.serviceAccountId, key);
    const response = await callSheets(
      ctx,
      { serviceAccountId: args.serviceAccountId, key },
      (timeoutMs) =>
        sheets.spreadsheets.values.batchGet(
          {
            spreadsheetId: args.spreadsheetId,
            ranges: args.ranges,
          },
          { signal: AbortSignal.timeout(timeoutMs) }
        )
    );

    const valueRanges = response.data.valueRanges ?? [];
    if (valueRanges.length !== args.ranges.length) {
      throw new Error(
        `Google Sheets returned ${valueRanges.length} ranges for ${args.ranges.length} requested tabs.`
      );
    }

    return valueRanges.map((range) => toSheetGrid(range.values));
  },
});

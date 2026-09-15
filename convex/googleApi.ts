import { MINUTE, RateLimiter } from "@convex-dev/rate-limiter";

import { components } from "./_generated/api.js";
import type { ActionCtx } from "./_generated/server";
import { env } from "./_generated/server";
import { appError } from "./model/appErrors";

const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const GOOGLE_SHEETS_BASE = "https://sheets.googleapis.com/v4/spreadsheets";

// Google allows 60 read requests per minute per user, and every request in
// this app travels with the same refresh token, so the whole application
// shares one budget. The bucket lets a run start with a short burst and then
// hands out slots at 50 per minute, which keeps both the sustained rate and a
// full burst below the quota.
const SHEETS_READS_PER_MINUTE = 50;
const SHEETS_BURST = 8;

// Google's advice for time-based quota errors: retry with a truncated
// exponential backoff plus jitter, and stop after a few attempts.
const MAX_ATTEMPTS = 4;
const INITIAL_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 16_000;
const JITTER_MS = 1_000;
const MAX_RETRY_AFTER_MS = 60_000;

const DETAIL_LIMIT = 300;

const rateLimiter = new RateLimiter(components.rateLimiter, {
  googleSheetsRead: {
    kind: "token bucket",
    rate: SHEETS_READS_PER_MINUTE,
    period: MINUTE,
    capacity: SHEETS_BURST,
  },
});

type GoogleTokenResponse = {
  access_token?: string;
  error?: string;
  error_description?: string;
};

type GoogleRequest = {
  url: string;
  method?: "POST";
  headers: Record<string, string>;
  body?: string;
};

// What one rejected attempt tells the caller. `quotaRejection` separates "come
// back later" from "this request will never work", because both travel as 403.
type GoogleFailure = {
  status: number;
  detail: string;
  body: unknown;
  retryAfterMs: number | null;
  retryable: boolean;
  quotaRejection: boolean;
};

type GoogleAttempt =
  { kind: "success"; body: unknown } | { kind: "failure"; failure: GoogleFailure };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// 429 and 5xx pass on their own. A 403 covers a missing permission and a quota
// rejection alike, so the body decides which one it is.
function isQuotaRejection(status: number, detail: string): boolean {
  if (status === 429) return true;
  return status === 403 && /quota|rate ?limit/i.test(detail);
}

function retryAfterMsOf(response: Response): number | null {
  const header = response.headers.get("retry-after");
  if (header === null) return null;
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1_000 : null;
}

// Honours the wait Google asked for, otherwise doubles it per attempt. The
// jitter keeps parallel callers from retrying in step.
function backoffMs(attempt: number, retryAfterMs: number | null): number {
  if (retryAfterMs !== null)
    return Math.min(retryAfterMs, MAX_RETRY_AFTER_MS) + Math.random() * JITTER_MS;
  const wait = INITIAL_BACKOFF_MS * 2 ** (attempt - 1);
  return Math.min(wait, MAX_BACKOFF_MS) + Math.random() * JITTER_MS;
}

async function attemptGoogleRequest(request: GoogleRequest): Promise<GoogleAttempt> {
  let response: Response;
  try {
    response = await fetch(request.url, {
      method: request.method ?? "GET",
      headers: request.headers,
      body: request.body,
    });
  } catch (error) {
    // A dropped connection is worth another attempt, same as a 5xx.
    return {
      kind: "failure",
      failure: {
        status: 0,
        detail: error instanceof Error ? error.message : String(error),
        body: null,
        retryAfterMs: null,
        retryable: true,
        quotaRejection: false,
      },
    };
  }
  if (response.ok) {
    return { kind: "success", body: (await response.json()) as unknown };
  }
  // Google explains rejected ranges and quota failures in the body, and the
  // status code alone is not enough to tell them apart.
  const detail = (await response.text()).trim().slice(0, DETAIL_LIMIT);
  const quotaRejection = isQuotaRejection(response.status, detail);
  return {
    kind: "failure",
    failure: {
      status: response.status,
      detail,
      body: parseJson(detail),
      retryAfterMs: retryAfterMsOf(response),
      retryable: quotaRejection || response.status >= 500,
      quotaRejection,
    },
  };
}

// Waits for the next slot in the shared Sheets budget. Reserving instead of
// rejecting spreads concurrent callers out in time, so a run that has to wait
// still returns data.
async function awaitSheetsSlot(ctx: ActionCtx): Promise<void> {
  const status = await rateLimiter.limit(ctx, "googleSheetsRead", { reserve: true });
  if (!status.ok) throw appError({ code: "SHEET_RATE_LIMITED" });
  if (status.retryAfter !== undefined) await sleep(status.retryAfter);
}

// Sends one Google request, retrying the failures Google expects callers to
// retry. `failure` builds the error for a request that cannot be saved, so
// each endpoint keeps its own wording.
async function sendGoogleRequest(
  request: GoogleRequest,
  options: { beforeAttempt?: () => Promise<void>; failure: (failure: GoogleFailure) => Error }
): Promise<unknown> {
  for (let attempt = 1; ; attempt += 1) {
    await options.beforeAttempt?.();
    const result = await attemptGoogleRequest(request);
    if (result.kind === "success") return result.body;
    if (!result.failure.retryable || attempt >= MAX_ATTEMPTS) throw options.failure(result.failure);
    const waitMs = backoffMs(attempt, result.failure.retryAfterMs);
    console.log(
      `Google answered ${result.failure.status}, retrying in ${Math.round(waitMs)} ms (attempt ${attempt + 1} of ${MAX_ATTEMPTS}).`
    );
    await sleep(waitMs);
  }
}

// The token endpoint answers failures with JSON, so its reason lives in a
// field instead of in the raw body.
function tokenFailureMessage(failure: GoogleFailure): string {
  const body = failure.body;
  if (typeof body === "object" && body !== null) {
    const fields = body as Record<string, unknown>;
    if (typeof fields.error_description === "string") return fields.error_description;
    if (typeof fields.error === "string") return fields.error;
  }
  if (failure.status === 0) return `Google token refresh failed. ${failure.detail}`;
  return failure.detail === ""
    ? `Google token refresh failed with status ${failure.status}.`
    : failure.detail;
}

function sheetsFailureMessage(failure: GoogleFailure): string {
  if (failure.status === 0) return `Google Sheets request failed. ${failure.detail}`;
  const suffix = failure.detail === "" ? "" : ` ${failure.detail}`;
  return `Google Sheets request failed with status ${failure.status}.${suffix}`;
}

// The token endpoint has its own quota, so it is retried but not paced.
export async function refreshAccessToken(): Promise<string> {
  const body = await sendGoogleRequest(
    {
      url: GOOGLE_TOKEN_ENDPOINT,
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: env.GOOGLE_OAUTH_CLIENT_ID,
        client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET,
        refresh_token: env.GOOGLE_REFRESH_TOKEN,
        grant_type: "refresh_token",
      }).toString(),
    },
    {
      failure: (failure) =>
        failure.quotaRejection
          ? new Error("Google rate limited the token refresh. Try again in a minute.")
          : new Error(tokenFailureMessage(failure)),
    }
  );
  const data = body as GoogleTokenResponse;
  if (!data.access_token) {
    throw new Error(data.error_description ?? data.error ?? "Google token refresh failed.");
  }
  return data.access_token;
}

// Reads one path of the Sheets API, paced against the shared budget and
// retried on Google's transient failures. The caller refreshes the token once
// per action instead of once per request.
export async function fetchSheetsJson(
  ctx: ActionCtx,
  path: string,
  token: string
): Promise<unknown> {
  return await sendGoogleRequest(
    {
      url: `${GOOGLE_SHEETS_BASE}/${path}`,
      headers: { authorization: `Bearer ${token}` },
    },
    {
      beforeAttempt: () => awaitSheetsSlot(ctx),
      failure: (failure) =>
        failure.quotaRejection
          ? appError({ code: "SHEET_RATE_LIMITED" })
          : new Error(sheetsFailureMessage(failure)),
    }
  );
}

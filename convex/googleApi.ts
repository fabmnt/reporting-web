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
// full burst below the quota. The bucket lives in one deployment, so another
// deployment or tool using the same refresh token is outside its view.
const SHEETS_READS_PER_MINUTE = 50;
const SHEETS_BURST = 8;

// Google's advice for time-based quota errors: retry with a truncated
// exponential backoff plus jitter, and stop after a few attempts. Four attempts
// means waits of a second, two, then four.
const MAX_ATTEMPTS = 4;
const INITIAL_BACKOFF_MS = 1_000;
const JITTER_MS = 1_000;
const MAX_RETRY_AFTER_MS = 60_000;

// Convex kills an action that runs past its runtime limit, which loses the whole
// run and records nothing. Convex documents 10 minutes for Node actions and 30
// for the default runtime, so one budget under both, covering every wait the
// action makes, lets a run that cannot finish in time report the sheets it did
// not read instead.
const ACTION_BUDGET_MS = 8 * 60_000;

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

// Retry-After is either a number of seconds or an HTTP date. A date already in
// the past is no use, so it falls back to the exponential wait like any other
// unusable header.
function retryAfterMsOf(response: Response): number | null {
  const header = response.headers.get("retry-after");
  if (header === null) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(seconds, 0) * 1_000;
  const retryAt = Date.parse(header);
  if (!Number.isFinite(retryAt)) return null;
  const delayMs = retryAt - Date.now();
  return delayMs > 0 ? delayMs : null;
}

// Honours the wait Google asked for, otherwise doubles it per attempt. The
// jitter keeps parallel callers from retrying in step, and the retry budget
// bounds how long the doubling can go on.
function backoffMs(attempt: number, retryAfterMs: number | null): number {
  if (retryAfterMs !== null) {
    return Math.min(retryAfterMs, MAX_RETRY_AFTER_MS) + Math.random() * JITTER_MS;
  }
  return INITIAL_BACKOFF_MS * 2 ** (attempt - 1) + Math.random() * JITTER_MS;
}

async function attemptGoogleRequest(request: GoogleRequest): Promise<GoogleAttempt> {
  let response: Response;
  let text: string;
  try {
    response = await fetch(request.url, {
      method: request.method ?? "GET",
      headers: request.headers,
      body: request.body,
    });
    // Reading the body belongs inside the guard: a connection that dies halfway
    // through a response is as transient as one that never opened.
    text = await response.text();
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
    // Parsed outside the guard: a body that is not JSON will not parse on a
    // second try either.
    const body = parseJson(text);
    if (body === null) throw new Error("Google answered with a body that is not JSON.");
    return { kind: "success", body };
  }
  // Google explains rejected ranges and quota failures in the body, and the
  // status code alone is not enough to tell them apart. The body is truncated
  // after parsing so a long reason still yields its fields.
  const detail = text.trim().slice(0, DETAIL_LIMIT);
  const quotaRejection = isQuotaRejection(response.status, detail);
  return {
    kind: "failure",
    failure: {
      status: response.status,
      detail,
      body: parseJson(text),
      retryAfterMs: retryAfterMsOf(response),
      retryable: quotaRejection || response.status >= 500,
      quotaRejection,
    },
  };
}

// Waits for the next slot in the shared Sheets budget. With `reserve` the
// component never rejects: it deducts the token and answers with the wait, so
// the bucket paces this app's requests instead of shedding them. Both guards
// fail the sheet rather than sleep. The first covers a rejection, which needs a
// `maxReserved` cap this config does not set. The second gives up on a wait that
// would reach past the action deadline, because an action killed at the runtime
// limit loses every other sheet of the run too.
async function awaitSheetsSlot(ctx: ActionCtx, deadlineMs: number): Promise<void> {
  const status = await rateLimiter.limit(ctx, "googleSheetsRead", { reserve: true });
  if (!status.ok) throw appError({ code: "SHEET_RATE_LIMITED" });
  if (status.retryAfter === undefined) return;
  if (Date.now() + status.retryAfter > deadlineMs) throw appError({ code: "SHEET_RATE_LIMITED" });
  await sleep(status.retryAfter);
}

// Sends one Google request, retrying the failures Google expects callers to
// retry. `failure` builds the error for a request that cannot be saved, so
// each endpoint keeps its own wording, and `deadlineMs` stops any wait that
// would reach past the calling action's budget.
async function sendGoogleRequest(
  request: GoogleRequest,
  options: {
    beforeAttempt?: () => Promise<void>;
    failure: (failure: GoogleFailure) => Error;
    deadlineMs: number;
  }
): Promise<unknown> {
  for (let attempt = 1; ; attempt += 1) {
    await options.beforeAttempt?.();
    const result = await attemptGoogleRequest(request);
    if (result.kind === "success") return result.body;
    if (!result.failure.retryable || attempt >= MAX_ATTEMPTS) throw options.failure(result.failure);
    const waitMs = backoffMs(attempt, result.failure.retryAfterMs);
    if (Date.now() + waitMs > options.deadlineMs) throw options.failure(result.failure);
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

// Absolute time by which every wait of one action has to be finished. Call it
// once per action, before the requests that action makes.
export function actionDeadline(): number {
  return Date.now() + ACTION_BUDGET_MS;
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
      deadlineMs: actionDeadline(),
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
// per action instead of once per request, and passes the deadline it computed
// for that action.
export async function fetchSheetsJson(
  ctx: ActionCtx,
  path: string,
  token: string,
  deadlineMs: number
): Promise<unknown> {
  return await sendGoogleRequest(
    {
      url: `${GOOGLE_SHEETS_BASE}/${path}`,
      headers: { authorization: `Bearer ${token}` },
    },
    {
      beforeAttempt: () => awaitSheetsSlot(ctx, deadlineMs),
      deadlineMs,
      failure: (failure) =>
        failure.quotaRejection
          ? appError({ code: "SHEET_RATE_LIMITED" })
          : new Error(sheetsFailureMessage(failure)),
    }
  );
}

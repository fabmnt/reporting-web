import { MINUTE, RateLimiter } from "@convex-dev/rate-limiter";

import { components } from "./_generated/api.js";
import type { ActionCtx } from "./_generated/server";
import { env } from "./_generated/server";
import { appError } from "./model/appErrors";
import {
  actionDeadline,
  failureOf,
  sendGoogleCall,
  sleep,
  type GoogleAttempt,
  type GoogleFailure,
} from "./model/googlePolicy";

const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const GOOGLE_SHEETS_BASE = "https://sheets.googleapis.com/v4/spreadsheets";

// Google allows 60 read requests per minute per user. Every request of one
// credential shares a budget, and each credential gets its own bucket because
// Google counts quota per account: the sheets a service account reads do not
// spend the budget of the app's own account. The bucket lets a run start with a
// short burst and then hands out slots at 50 per minute, which keeps both the
// sustained rate and a full burst below the quota. The buckets live in one
// deployment, so another deployment or tool using the same account is outside
// their view.
const SHEETS_READS_PER_MINUTE = 50;
const SHEETS_BURST = 8;

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

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// One attempt of a request made with fetch. Reading the body belongs inside the
// guard: a connection that dies halfway through a response is as transient as
// one that never opened.
async function attemptGoogleRequest(request: GoogleRequest): Promise<GoogleAttempt<unknown>> {
  let response: Response;
  let text: string;
  try {
    response = await fetch(request.url, {
      method: request.method ?? "GET",
      headers: request.headers,
      body: request.body,
    });
    text = await response.text();
  } catch (error) {
    return {
      kind: "failure",
      failure: failureOf({
        status: 0,
        detail: error instanceof Error ? error.message : String(error),
        body: null,
        retryAfterHeader: null,
      }),
    };
  }

  if (!response.ok) {
    // Google explains rejected ranges and quota failures in the body, and the
    // status code alone is not enough to tell them apart.
    return {
      kind: "failure",
      failure: failureOf({
        status: response.status,
        detail: text,
        body: parseJson(text),
        retryAfterHeader: response.headers.get("retry-after"),
      }),
    };
  }

  // Parsed outside the guard: a body that is not JSON will not parse on a second
  // try either.
  const body = parseJson(text);
  if (body === null) throw new Error("Google answered with a body that is not JSON.");
  return { kind: "success", value: body };
}

/**
 * Waits for the next slot in the budget of one credential. With `reserve` the
 * component never rejects: it deducts the token and answers with the wait, so
 * the bucket paces this app's requests instead of shedding them. Both guards
 * fail the sheet rather than sleep. The first covers a rejection, which needs a
 * `maxReserved` cap this config does not set. The second gives up on a wait that
 * would reach past the action deadline, because an action killed at the runtime
 * limit loses every other sheet of the run too.
 */
export async function awaitSheetsSlot(
  ctx: ActionCtx,
  deadlineMs: number,
  credentialKey: string
): Promise<void> {
  const status = await rateLimiter.limit(ctx, "googleSheetsRead", {
    key: credentialKey,
    reserve: true,
  });
  if (!status.ok) throw appError({ code: "SHEET_RATE_LIMITED" });
  if (status.retryAfter === undefined) return;
  if (Date.now() + status.retryAfter > deadlineMs) throw appError({ code: "SHEET_RATE_LIMITED" });
  await sleep(status.retryAfter);
}

// The token endpoint answers failures with JSON, so its reason lives in a field
// instead of in the raw body.
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

// The wording a sheet reports when a request with the app's own account fails.
function sheetsFailureMessage(failure: GoogleFailure): string {
  if (failure.status === 0) return `Google Sheets request failed. ${failure.detail}`;
  const suffix = failure.detail === "" ? "" : ` ${failure.detail}`;
  return `Google Sheets request failed with status ${failure.status}.${suffix}`;
}

// The token endpoint has its own quota, so it is retried but not paced.
export async function refreshAccessToken(): Promise<string> {
  const body = await sendGoogleCall({
    attempt: () =>
      attemptGoogleRequest({
        url: GOOGLE_TOKEN_ENDPOINT,
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: env.GOOGLE_OAUTH_CLIENT_ID,
          client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET,
          refresh_token: env.GOOGLE_REFRESH_TOKEN,
          grant_type: "refresh_token",
        }).toString(),
      }),
    deadlineMs: actionDeadline(),
    failure: (failure) =>
      failure.quotaRejection
        ? new Error("Google rate limited the token refresh. Try again in a minute.")
        : new Error(tokenFailureMessage(failure)),
  });

  const data = body as GoogleTokenResponse;
  if (!data.access_token) {
    throw new Error(data.error_description ?? data.error ?? "Google token refresh failed.");
  }
  return data.access_token;
}

// Reads one path of the Sheets API with the app's own account, paced against the
// budget of that credential and retried on Google's transient failures. The
// caller refreshes the token once per action instead of once per request, and
// passes the deadline it computed for that action.
export async function fetchSheetsJson(
  ctx: ActionCtx,
  path: string,
  token: string,
  deadlineMs: number,
  credentialKey: string
): Promise<unknown> {
  return await sendGoogleCall({
    attempt: () =>
      attemptGoogleRequest({
        url: `${GOOGLE_SHEETS_BASE}/${path}`,
        headers: { authorization: `Bearer ${token}` },
      }),
    beforeAttempt: () => awaitSheetsSlot(ctx, deadlineMs, credentialKey),
    deadlineMs,
    failure: (failure) =>
      failure.quotaRejection
        ? appError({ code: "SHEET_RATE_LIMITED" })
        : new Error(sheetsFailureMessage(failure)),
  });
}

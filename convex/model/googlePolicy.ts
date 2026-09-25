/**
 * What a rejected Google call means, and how long to wait before trying again.
 * Both request paths go through this file: the fetch client in googleApi.ts and
 * the googleapis client a service account is read with, so a failure Google
 * expects callers to retry is handled the same way whichever one asked.
 */

// Google's advice for time-based quota errors: retry with a truncated
// exponential backoff plus jitter, and stop after a few attempts. Four attempts
// means waits of a second, two, then four.
export const MAX_ATTEMPTS = 4;
const INITIAL_BACKOFF_MS = 1_000;
const JITTER_MS = 1_000;
const MAX_RETRY_AFTER_MS = 60_000;

// How much of Google's answer travels in an error message.
const DETAIL_LIMIT = 300;

// Convex kills an action that runs past its runtime limit, which loses the whole
// run and records nothing. Convex documents 10 minutes for Node actions and 30
// for the default runtime, so one budget under both, covering every wait the
// action makes, lets a run that cannot finish in time report the sheets it did
// not read instead.
export const ACTION_BUDGET_MS = 8 * 60_000;

// What one rejected attempt tells the caller. `quotaRejection` separates "come
// back later" from "this request will never work", because both travel as 403.
export type GoogleFailure = {
  status: number;
  detail: string;
  body: unknown;
  retryAfterMs: number | null;
  retryable: boolean;
  quotaRejection: boolean;
};

export type GoogleAttempt<T> =
  { kind: "success"; value: T } | { kind: "failure"; failure: GoogleFailure };

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 429 and 5xx pass on their own. A 403 covers a missing permission and a quota
// rejection alike, so the body decides which one it is.
export function isQuotaRejection(status: number, detail: string): boolean {
  if (status === 429) return true;
  return status === 403 && /quota|rate ?limit/i.test(detail);
}

// Retry-After is either a number of seconds or an HTTP date. A date already in
// the past is no use, so it falls back to the exponential wait like any other
// unusable header.
function retryAfterMsFromHeader(header: string | null): number | null {
  if (header === null) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(seconds, 0) * 1_000;
  const retryAt = Date.parse(header);
  if (!Number.isFinite(retryAt)) return null;
  const delayMs = retryAt - Date.now();
  return delayMs > 0 ? delayMs : null;
}

/**
 * Reads one rejected answer, whichever client received it. The detail is
 * truncated so a long reason still yields its fields, and the status alone
 * cannot tell a missing permission from a quota failure.
 */
export function failureOf(input: {
  status: number;
  detail: string;
  body: unknown;
  retryAfterHeader: string | null;
}): GoogleFailure {
  const detail = input.detail.trim().slice(0, DETAIL_LIMIT);
  const quotaRejection = isQuotaRejection(input.status, detail);
  return {
    status: input.status,
    detail,
    body: input.body,
    retryAfterMs: retryAfterMsFromHeader(input.retryAfterHeader),
    // A connection that never opened (status 0) is worth another attempt, same
    // as a 5xx, and so is a rejection Google expects the caller to repeat.
    retryable: input.status === 0 || quotaRejection || input.status >= 500,
    quotaRejection,
  };
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

// Absolute time by which every wait of one action has to be finished. Call it
// once per action, before the requests that action makes.
export function actionDeadline(): number {
  return Date.now() + ACTION_BUDGET_MS;
}

/**
 * How long one request may take before it is dropped: whatever is left of the
 * action's budget. A connection that stalls without an answer would otherwise
 * outlive the action, and Convex would kill it instead of letting it report the
 * sheets it did not read.
 */
export function requestTimeoutMs(deadlineMs: number): number {
  return Math.max(deadlineMs - Date.now(), 1);
}

/**
 * Runs one Google call, retrying the failures Google expects callers to retry.
 * `attempt` answers whether the call landed, `beforeAttempt` is where a caller
 * paces itself against its quota, and `failure` builds the error for a call that
 * cannot be saved. A wait that would reach past `deadlineMs` fails instead:
 * waiting is not worth being killed at the action's runtime limit.
 */
export async function sendGoogleCall<T>(options: {
  attempt: () => Promise<GoogleAttempt<T>>;
  beforeAttempt?: () => Promise<void>;
  failure: (failure: GoogleFailure) => Error;
  deadlineMs: number;
}): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    await options.beforeAttempt?.();
    const result = await options.attempt();
    if (result.kind === "success") return result.value;
    if (!result.failure.retryable || attempt >= MAX_ATTEMPTS) throw options.failure(result.failure);
    const waitMs = backoffMs(attempt, result.failure.retryAfterMs);
    if (Date.now() + waitMs > options.deadlineMs) throw options.failure(result.failure);
    console.log(
      `Google answered ${result.failure.status}, retrying in ${Math.round(waitMs)} ms (attempt ${attempt + 1} of ${MAX_ATTEMPTS}).`
    );
    await sleep(waitMs);
  }
}

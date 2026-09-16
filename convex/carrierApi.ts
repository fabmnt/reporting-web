import { env } from "./_generated/server";
import { parseCarrierBots, type CarrierBot } from "./model/carrierBots";

const CARRIER_API_BASE = "https://carriers.dentalautomation.ai";
const SIGN_IN_PATH = "/api/signin";

// The path that answers with a clinic's bots. The old tool read
// /api/clients/clinic/<id>, which is scoped to the client account that owns
// the clinic and turns the app's user away, while this one answers every
// clinic the credentials may not even own.
const CLINIC_BOTS_PATH = "/api/clinicbots/all/clinic";

const MAX_ATTEMPTS = 3;
const INITIAL_BACKOFF_MS = 1_000;
const JITTER_MS = 500;
const DETAIL_LIMIT = 200;

// Why a carrier call did not answer with data. The run turns each of these
// into the message the operator reads.
export type CarrierFailure = "unauthorized" | "accessDenied" | "notFound" | "unavailable";

export type CarrierResult<T> = { ok: true; value: T } | { ok: false; failure: CarrierFailure };

type CarrierResponse = { status: number; text: string };

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

// A rejected request is not the same as a broken API: the run tells the
// operator to ask for access in one case and to try again later in the other.
function failureOfStatus(status: number): CarrierFailure {
  if (status === 401) return "unauthorized";
  if (status === 404) return "notFound";
  if (status === 400 || status === 403) return "accessDenied";
  return "unavailable";
}

// The sign-in path answers rejected credentials with a 400 and a body like
// "invalid password" or "Incorrect username". Nothing about granting access to
// a clinic is being decided there, so every 4xx means the credentials the app
// is configured with are the problem.
function signInFailureOfStatus(status: number): CarrierFailure {
  if (status >= 400 && status < 500) return "unauthorized";
  return "unavailable";
}

// The API can accept a connection and then stop answering, which would hold
// the action until Convex kills it and lose every clinic the run already read.
// The request therefore expires with the action budget, and not only the wait
// between attempts.
async function fetchCarrier(
  path: string,
  init: RequestInit,
  deadlineMs: number
): Promise<CarrierResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(deadlineMs - Date.now(), 0));
  try {
    const response = await fetch(`${CARRIER_API_BASE}${path}`, {
      ...init,
      signal: controller.signal,
    });
    const text = await response.text();
    return { status: response.status, text };
  } finally {
    clearTimeout(timer);
  }
}

// One carrier request, retried while the API or the connection fails. The wait
// never reaches past the calling action's budget, because an action killed at
// the runtime limit loses the clinics it already read.
async function sendCarrierRequest(
  path: string,
  init: RequestInit,
  deadlineMs: number
): Promise<CarrierResponse> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      const response = await fetchCarrier(path, init, deadlineMs);
      if (response.status < 500 || attempt >= MAX_ATTEMPTS) {
        return response;
      }
    } catch (error) {
      // The abort above means the budget ran out, so retrying would only spend
      // what is left of the run.
      const expired = Date.now() >= deadlineMs;
      if (expired || attempt >= MAX_ATTEMPTS) {
        return {
          status: 0,
          text: expired
            ? "The carrier API did not answer in time."
            : error instanceof Error
              ? error.message
              : String(error),
        };
      }
    }

    const waitMs = INITIAL_BACKOFF_MS * 2 ** (attempt - 1) + Math.random() * JITTER_MS;
    if (Date.now() + waitMs > deadlineMs) {
      return { status: 0, text: "The carrier API stopped answering." };
    }
    await sleep(waitMs);
  }
}

// One token covers a whole run: the API issues it for thirty days, and a run
// that meets a rejected token signs in again once.
export async function signInCarrierApi(deadlineMs: number): Promise<CarrierResult<string>> {
  const response = await sendCarrierRequest(
    SIGN_IN_PATH,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        username: env.CCC_USERNAME,
        password: env.CCC_PASSWORD,
      }).toString(),
    },
    deadlineMs
  );

  if (response.status !== 200) {
    return { ok: false, failure: signInFailureOfStatus(response.status) };
  }

  const body = parseJson(response.text);
  const token =
    typeof body === "object" && body !== null ? (body as { token?: unknown }).token : undefined;
  if (typeof token !== "string" || token === "") return { ok: false, failure: "unavailable" };

  return { ok: true, value: token };
}

export async function fetchClinicBots(
  clinicId: string,
  token: string,
  deadlineMs: number
): Promise<CarrierResult<CarrierBot[]>> {
  const response = await sendCarrierRequest(
    `${CLINIC_BOTS_PATH}/${clinicId}`,
    { headers: { "x-access-token": token } },
    deadlineMs
  );

  if (response.status !== 200) return { ok: false, failure: failureOfStatus(response.status) };

  const bots = parseCarrierBots(parseJson(response.text));
  if (bots === null) {
    console.log(
      `Carrier API answered clinic ${clinicId} without a bot list: ${response.text.slice(0, DETAIL_LIMIT)}`
    );
    return { ok: false, failure: "unavailable" };
  }

  return { ok: true, value: bots };
}

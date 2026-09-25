import { type Infer, v } from "convex/values";

import type { Id } from "../_generated/dataModel";
import { appError } from "./appErrors";

// Which Google account reads a client's sheets. A client without a service
// account keeps using the deployment wide OAuth refresh token, which is how
// every client was read before service accounts existed.
export const googleCredential = v.union(
  v.object({ kind: v.literal("oauth") }),
  v.object({
    kind: v.literal("serviceAccount"),
    serviceAccountId: v.id("googleServiceAccounts"),
    // The address travels with the credential because the error a run reports
    // has to name the account a person must share the spreadsheet with.
    email: v.string(),
  })
);

export type GoogleCredential = Infer<typeof googleCredential>;

// The credential of every client that has no service account.
export const OAUTH_CREDENTIAL: GoogleCredential = { kind: "oauth" };

// The bucket of the Sheets budget a service account's requests are paced
// against.
export function serviceAccountBucket(serviceAccountId: Id<"googleServiceAccounts">): string {
  return `serviceAccount:${serviceAccountId}`;
}

// The bucket of the Sheets budget a request is paced against. Google counts
// quota per account, so each credential gets its own budget instead of the one
// shared bucket every request used to travel in.
export function credentialKey(credential: GoogleCredential): string {
  return credential.kind === "oauth" ? "oauth" : serviceAccountBucket(credential.serviceAccountId);
}

// A PEM whose newlines were escaped survives a JSON key file, an environment
// variable and a text input, but Google rejects it with a signature error that
// explains nothing, so the two characters are turned back into a line break
// before the key is stored.
export function normalizePrivateKey(privateKey: string): string {
  return privateKey.replace(/\\n/g, "\n").trim();
}

// Convex's default runtime exposes Web Crypto but not the browser's atob, so
// the PEM body is decoded here.
const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function base64Bytes(value: string): Uint8Array {
  const clean = value.replace(/\s+/g, "").replace(/=+$/, "");
  const bytes = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let accumulator = 0;
  let bits = 0;
  let written = 0;

  for (const char of clean) {
    const digit = BASE64_ALPHABET.indexOf(char);
    if (digit === -1) throw appError({ code: "SERVICE_ACCOUNT_KEY_INVALID" });
    accumulator = (accumulator << 6) | digit;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[written] = (accumulator >> bits) & 0xff;
      written += 1;
      accumulator &= (1 << bits) - 1;
    }
  }

  return bytes.subarray(0, written);
}

const PRIVATE_KEY_PATTERN = /-----BEGIN ([A-Z ]+)-----([\s\S]+?)-----END \1-----/;

// Google signs a service account's JWT with an RSA key in the PKCS#8 form. The
// key is imported here, without asking Google, so a key that was truncated or
// pasted with its newlines escaped is refused when it is saved instead of when
// a report runs.
async function assertSignablePrivateKey(privateKey: string): Promise<void> {
  const match = PRIVATE_KEY_PATTERN.exec(privateKey);
  if (match === null || match[1] !== "PRIVATE KEY") {
    throw appError({ code: "SERVICE_ACCOUNT_KEY_INVALID" });
  }

  // `slice` and not `subarray`: the decoded length is an upper bound, and only a
  // copy of the used bytes is a buffer Web Crypto accepts.
  const bytes = base64Bytes(match[2] ?? "").slice();
  try {
    await crypto.subtle.importKey(
      "pkcs8",
      bytes,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"]
    );
  } catch {
    throw appError({ code: "SERVICE_ACCOUNT_KEY_INVALID" });
  }
}

// The address a key file carries. It is the address a sheet is shared with, so
// a file whose address is not an address is refused instead of stored. Throws
// SERVICE_ACCOUNT_EMAIL_INVALID.
function serviceAccountEmail(value: string): string {
  const email = value.trim();
  if (!email.includes("@") || /\s/.test(email)) {
    throw appError({ code: "SERVICE_ACCOUNT_EMAIL_INVALID" });
  }
  return email;
}

/**
 * Turns the JSON key file Google hands out into the row that is stored. The
 * file names the account it belongs to in `client_email`, so the address and
 * the key both come from the file and nothing else is asked for.
 *
 * Throws SERVICE_ACCOUNT_KEY_REQUIRED, SERVICE_ACCOUNT_KEY_INVALID or
 * SERVICE_ACCOUNT_EMAIL_INVALID.
 */
export async function parseServiceAccountKey(
  secretKey: string
): Promise<{ email: string; privateKey: string }> {
  const pasted = secretKey.trim();
  if (pasted === "") throw appError({ code: "SERVICE_ACCOUNT_KEY_REQUIRED" });

  let parsed: unknown;
  try {
    parsed = JSON.parse(pasted);
  } catch {
    throw appError({ code: "SERVICE_ACCOUNT_KEY_INVALID" });
  }

  const fields = (typeof parsed === "object" && parsed !== null ? parsed : {}) as Record<
    string,
    unknown
  >;
  if (typeof fields.client_email !== "string" || typeof fields.private_key !== "string") {
    throw appError({ code: "SERVICE_ACCOUNT_KEY_INVALID" });
  }

  const privateKey = normalizePrivateKey(fields.private_key);
  await assertSignablePrivateKey(privateKey);

  return { email: serviceAccountEmail(fields.client_email), privateKey };
}

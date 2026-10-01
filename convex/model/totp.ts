// RFC 6238 time-based one-time passwords for the authenticator-app second
// factor. The HMAC runs on Web Crypto, the primitive the token helpers already
// use, so the module stays in the default Convex runtime. Only secrets this
// module generated are ever verified, which is why the base32 decoder can
// reject anything that is not the RFC 4648 alphabet.

import { randomHexToken } from "./tokens";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

// RFC 6238 defaults: six digits, a thirty-second step. Authenticator apps read
// both from the otpauth URI, which spells them out.
export const TOTP_DIGITS = 6;
export const TOTP_STEP_SECONDS = 30;
// One step of clock drift on either side, so a phone whose clock is off by
// seconds still signs in.
const TOTP_WINDOW = 1;
// 160 bits, the length RFC 4226 recommends for a shared secret.
const TOTP_SECRET_BYTES = 20;

export const RECOVERY_CODE_COUNT = 10;
const RECOVERY_CODE_BYTES = 8;
const RECOVERY_CODE_GROUP = 4;

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let encoded = "";

  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      encoded += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    encoded += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }

  return encoded;
}

function base32Decode(secret: string): Uint8Array<ArrayBuffer> {
  const clean = secret.toUpperCase().replace(/=+$/, "");
  const bytes = new Uint8Array(Math.floor((clean.length * 5) / 8));
  let bits = 0;
  let value = 0;
  let index = 0;

  for (const character of clean) {
    const digit = BASE32_ALPHABET.indexOf(character);
    if (digit === -1) throw new Error(`Not a base32 secret: "${secret}"`);
    value = (value << 5) | digit;
    bits += 5;
    if (bits >= 8) {
      bytes[index] = (value >>> (bits - 8)) & 255;
      index += 1;
      bits -= 8;
    }
  }

  return bytes;
}

/** A fresh shared secret, in the base32 form authenticator apps expect. */
export function generateTotpSecret(): string {
  return base32Encode(crypto.getRandomValues(new Uint8Array(TOTP_SECRET_BYTES)));
}

/** The number of 30-second windows between the epoch and a moment. */
export function timeStep(momentMs: number): number {
  return Math.floor(momentMs / 1000 / TOTP_STEP_SECONDS);
}

/** The code one secret produces in one time step. */
export async function totpCodeAt(secret: string, step: number): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    base32Decode(secret),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"]
  );
  const message = new Uint8Array(8);
  let remaining = step;
  for (let index = message.length - 1; index >= 0; index -= 1) {
    message[index] = remaining % 256;
    remaining = Math.floor(remaining / 256);
  }

  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, message));
  // Dynamic truncation (RFC 4226): the low nibble of the last byte picks the
  // four bytes whose high bit is dropped and which become the code.
  const offset = signature[signature.length - 1] & 0x0f;
  const binary =
    ((signature[offset] & 0x7f) << 24) |
    (signature[offset + 1] << 16) |
    (signature[offset + 2] << 8) |
    signature[offset + 3];

  return String(binary % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, "0");
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;

  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}

/**
 * The time step a code matches, or null when it matches none. Codes at or
 * before `lastUsedStep` stay rejected even though they are still inside the
 * drift window, so a code seen over a shoulder does not sign in twice.
 */
export async function findTotpStep(
  secret: string,
  code: string,
  momentMs: number,
  lastUsedStep: number
): Promise<number | null> {
  const candidate = code.replace(/\s/g, "");
  if (!new RegExp(`^\\d{${TOTP_DIGITS}}$`).test(candidate)) return null;

  const current = timeStep(momentMs);
  for (let offset = TOTP_WINDOW; offset >= -TOTP_WINDOW; offset -= 1) {
    const step = current + offset;
    if (step <= lastUsedStep) continue;
    if (constantTimeEqual(await totpCodeAt(secret, step), candidate)) return step;
  }

  return null;
}

/** The URI an authenticator app scans or opens, with the secret inside. */
export function totpUri({
  issuer,
  account,
  secret,
}: {
  issuer: string;
  account: string;
  secret: string;
}): string {
  // Built by hand instead of with URLSearchParams, which writes a space as
  // "+": the Key URI format wants percent-encoding, and some apps keep the "+"
  // literally in the issuer name.
  const parameters = [
    ["secret", secret],
    ["issuer", issuer],
    ["algorithm", "SHA1"],
    ["digits", String(TOTP_DIGITS)],
    ["period", String(TOTP_STEP_SECONDS)],
  ]
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join("&");
  return `otpauth://totp/${encodeURIComponent(`${issuer}:${account}`)}?${parameters}`;
}

/** Ten single-use codes, formatted the way they are shown to the user. */
export function generateRecoveryCodes(): string[] {
  return Array.from({ length: RECOVERY_CODE_COUNT }, () => {
    const raw = randomHexToken(RECOVERY_CODE_BYTES).toUpperCase();
    return raw.match(new RegExp(`.{${RECOVERY_CODE_GROUP}}`, "g"))?.join("-") ?? raw;
  });
}

/** What recovery codes are compared and hashed by: case and dashes do not matter. */
export function normalizeRecoveryCode(code: string): string {
  return code.toUpperCase().replace(/[^0-9A-F]/g, "");
}

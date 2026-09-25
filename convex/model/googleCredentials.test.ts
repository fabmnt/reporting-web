import { describe, expect, it } from "vitest";

import { appErrorPayloadOf } from "./appErrors";
import { parseServiceAccountKey } from "./googleCredentials";

const KEY_FILE_EMAIL = "reader@example.iam.gserviceaccount.com";

/**
 * A throwaway RSA key in the PEM form Google hands out, made here so no key
 * material lives in the repository.
 */
async function privateKeyPem(): Promise<string> {
  const pair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"]
  );
  const der = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  const body = (btoa(String.fromCharCode(...der)).match(/.{1,64}/g) ?? []).join("\n");

  return `-----BEGIN PRIVATE KEY-----\n${body}\n-----END PRIVATE KEY-----`;
}

/** The JSON key file Google hands out, with the given key and address. */
function keyFile(privateKey: string, email: string = KEY_FILE_EMAIL): string {
  return JSON.stringify({ type: "service_account", client_email: email, private_key: privateKey });
}

/** The code the parser refused a file with, or null when it stored it. */
async function refusalCode(file: string): Promise<string | null> {
  try {
    await parseServiceAccountKey(file);
    return null;
  } catch (error) {
    return appErrorPayloadOf(error)?.code ?? null;
  }
}

const privateKey = await privateKeyPem();

describe("parseServiceAccountKey", () => {
  it("reads the address and the key out of the file", async () => {
    await expect(parseServiceAccountKey(keyFile(privateKey))).resolves.toEqual({
      email: KEY_FILE_EMAIL,
      privateKey,
    });
  });

  it("puts back the line breaks of a key that was escaped onto one line", async () => {
    const escaped = keyFile(privateKey.replace(/\n/g, "\\n"));

    await expect(parseServiceAccountKey(escaped)).resolves.toEqual({
      email: KEY_FILE_EMAIL,
      privateKey,
    });
  });

  it("refuses an empty paste, a file that is not JSON and a file without a key", async () => {
    expect(await refusalCode("   ")).toBe("SERVICE_ACCOUNT_KEY_REQUIRED");
    expect(await refusalCode("not a key file")).toBe("SERVICE_ACCOUNT_KEY_INVALID");
    expect(await refusalCode(JSON.stringify({ client_email: KEY_FILE_EMAIL }))).toBe(
      "SERVICE_ACCOUNT_KEY_INVALID"
    );
  });

  it("refuses a key in the older PKCS#1 form", async () => {
    const pkcs1 = privateKey
      .replace("BEGIN PRIVATE KEY", "BEGIN RSA PRIVATE KEY")
      .replace("END PRIVATE KEY", "END RSA PRIVATE KEY");

    expect(await refusalCode(keyFile(pkcs1))).toBe("SERVICE_ACCOUNT_KEY_INVALID");
  });

  it("refuses a key whose body was cut short", async () => {
    const truncated = `${privateKey.slice(0, 200)}\n-----END PRIVATE KEY-----`;

    expect(await refusalCode(keyFile(truncated))).toBe("SERVICE_ACCOUNT_KEY_INVALID");
  });

  it("refuses an address that is not one", async () => {
    expect(await refusalCode(keyFile(privateKey, "not an address"))).toBe(
      "SERVICE_ACCOUNT_EMAIL_INVALID"
    );
  });
});

import { describe, expect, it } from "vitest";

import {
  base32Encode,
  findTotpStep,
  generateRecoveryCodes,
  generateTotpSecret,
  normalizeRecoveryCode,
  timeStep,
  TOTP_STEP_SECONDS,
  totpCodeAt,
  totpUri,
} from "./totp";

// The secret RFC 6238 uses for its SHA-1 vectors: the ASCII digits "12345678901234567890".
const RFC_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

function secondsToMs(seconds: number): number {
  return seconds * 1000;
}

describe("base32", () => {
  it("encodes text the way the RFC 4648 vectors do", () => {
    expect(base32Encode(new TextEncoder().encode("foo"))).toBe("MZXW6");
    expect(base32Encode(new TextEncoder().encode("foobar"))).toBe("MZXW6YTBOI");
  });

  it("generates a 160-bit secret the authenticator alphabet can carry", () => {
    expect(generateTotpSecret()).toMatch(/^[A-Z2-7]{32}$/);
  });
});

describe("totpCodeAt", () => {
  it("matches the RFC 6238 SHA-1 vectors", async () => {
    const vectors = [
      { seconds: 59, step: 1, code: "287082" },
      { seconds: 1111111109, step: 37037036, code: "081804" },
      { seconds: 1111111111, step: 37037037, code: "050471" },
      { seconds: 1234567890, step: 41152263, code: "005924" },
      { seconds: 2000000000, step: 66666666, code: "279037" },
      { seconds: 20000000000, step: 666666666, code: "353130" },
    ];

    for (const vector of vectors) {
      expect(timeStep(secondsToMs(vector.seconds))).toBe(vector.step);
      expect(await totpCodeAt(RFC_SECRET, vector.step)).toBe(vector.code);
    }
  });
});

describe("findTotpStep", () => {
  it("accepts one step of drift on either side, but not two", async () => {
    const step = 100;
    const momentMs = step * TOTP_STEP_SECONDS * 1000;

    expect(
      await findTotpStep(RFC_SECRET, await totpCodeAt(RFC_SECRET, step - 1), momentMs, 0)
    ).toBe(step - 1);
    expect(
      await findTotpStep(RFC_SECRET, await totpCodeAt(RFC_SECRET, step + 1), momentMs, 0)
    ).toBe(step + 1);
    expect(
      await findTotpStep(RFC_SECRET, await totpCodeAt(RFC_SECRET, step - 2), momentMs, 0)
    ).toBe(null);
  });

  it("refuses a code that already signed in", async () => {
    const step = 200;
    const code = await totpCodeAt(RFC_SECRET, step);
    const momentMs = step * TOTP_STEP_SECONDS * 1000;

    expect(await findTotpStep(RFC_SECRET, code, momentMs, step)).toBe(null);
    expect(await findTotpStep(RFC_SECRET, code, momentMs, step - 1)).toBe(step);
  });

  it("refuses input that is not a six-digit code", async () => {
    const momentMs = 100 * TOTP_STEP_SECONDS * 1000;
    expect(await findTotpStep(RFC_SECRET, "12345", momentMs, 0)).toBe(null);
    expect(await findTotpStep(RFC_SECRET, "12a456", momentMs, 0)).toBe(null);
  });
});

describe("recovery codes", () => {
  it("formats ten distinct codes in groups of four", () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(10);
    for (const code of codes) {
      expect(code).toMatch(/^[0-9A-F]{4}(-[0-9A-F]{4}){3}$/);
    }
    expect(new Set(codes).size).toBe(10);
  });

  it("compares codes without case or separators", () => {
    expect(normalizeRecoveryCode("a1b2-c3d4")).toBe("A1B2C3D4");
    expect(normalizeRecoveryCode("A1B2 C3D4")).toBe("A1B2C3D4");
  });
});

describe("totpUri", () => {
  it("names the issuer and account, and spells out the parameters", () => {
    const uri = totpUri({ issuer: "Reporting Web", account: "ada", secret: "ABC234" });

    expect(uri).toMatch(/^otpauth:\/\/totp\/Reporting%20Web%3Aada\?/);
    expect(uri).toContain("secret=ABC234");
    expect(uri).toContain("issuer=Reporting%20Web");
    expect(uri).toContain("algorithm=SHA1");
    expect(uri).toContain("digits=6");
    expect(uri).toContain("period=30");
  });
});

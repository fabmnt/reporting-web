import { describe, expect, it } from "vitest";

import { appError, sheetErrorFrom } from "./appErrors";

describe("sheetErrorFrom", () => {
  it("reports an error a sheet cannot explain as its own code", () => {
    const error = appError({ code: "SERVICE_ACCOUNT_NOT_FOUND" });

    expect(sheetErrorFrom(error)).toEqual({ code: "SHEET_SERVICE_ACCOUNT_MISSING" });
  });

  it("keeps the text of an error a sheet has to carry itself", () => {
    const error = new Error("Google turned the request down.");

    expect(sheetErrorFrom(error)).toEqual({
      code: "SHEET_FAILED",
      message: "Google turned the request down.",
    });
  });

  it("drops the prefix the platform puts on a failed node action", () => {
    // Convex reports a failed node action the way node reports an uncaught
    // exception, so the message carries a prefix that says nothing to the
    // operator reading the sheet.
    const error = new Error("Uncaught Error: Google turned the request down.");

    expect(sheetErrorFrom(error)).toEqual({
      code: "SHEET_FAILED",
      message: "Google turned the request down.",
    });
  });

  it("reports a sheet Google turned the account away from with the address to share it with", () => {
    const error = appError({ code: "SERVICE_ACCOUNT_DENIED", email: "reader@example.com" });

    expect(sheetErrorFrom(error)).toEqual({
      code: "SHEET_SERVICE_ACCOUNT_DENIED",
      email: "reader@example.com",
    });
  });

  it("reports a key Google will not sign with as its own failure", () => {
    // Sharing the sheet does not fix a refused key, so the sheet says the key is
    // the problem instead of carrying the payload of the error as a message.
    const error = appError({
      code: "SERVICE_ACCOUNT_KEY_REFUSED",
      email: "reader@example.com",
    });

    expect(sheetErrorFrom(error)).toEqual({
      code: "SHEET_SERVICE_ACCOUNT_KEY_REFUSED",
      email: "reader@example.com",
    });
  });
});

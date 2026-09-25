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
});

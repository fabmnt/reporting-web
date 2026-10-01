import { describe, expect, it } from "vitest";

describe("security page", () => {
  it("has an Astro entry point for direct navigation and refresh", () => {
    const pages = import.meta.glob("/src/pages/**/*.astro");
    expect(Object.keys(pages)).toContain("/src/pages/account/security.astro");
  });
});

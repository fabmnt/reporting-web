import { describe, expect, it } from "vitest";

import { isActivePath, isSamePath, normalizePath } from "./paths";

describe("normalizePath", () => {
  it("strips the trailing slash Astro adds to directory routes", () => {
    expect(normalizePath("/admin/")).toBe("/admin");
    expect(normalizePath("/admin/clinics/")).toBe("/admin/clinics");
  });

  it("strips repeated trailing slashes", () => {
    expect(normalizePath("/admin///")).toBe("/admin");
  });

  it("leaves the root path alone", () => {
    expect(normalizePath("/")).toBe("/");
  });

  it("leaves paths without a trailing slash alone", () => {
    expect(normalizePath("/admin/clinics")).toBe("/admin/clinics");
  });
});

describe("isSamePath", () => {
  it("treats a route and its trailing-slash form as equal", () => {
    expect(isSamePath("/admin/", "/admin")).toBe(true);
  });

  it("does not treat a child route as the same path", () => {
    expect(isSamePath("/admin", "/admin/clinics")).toBe(false);
  });
});

describe("isActivePath", () => {
  it("only marks root active for the exact root path", () => {
    expect(isActivePath("/", "/")).toBe(true);
    expect(isActivePath("/", "/admin")).toBe(false);
  });

  it("marks a parent route active for its children", () => {
    expect(isActivePath("/admin", "/admin")).toBe(true);
    expect(isActivePath("/admin", "/admin/clinics")).toBe(true);
    expect(isActivePath("/admin/", "/admin/clinics/")).toBe(true);
  });

  it("does not mark a sibling that only shares a prefix", () => {
    expect(isActivePath("/admin", "/administrators")).toBe(false);
  });

  it("does not mark an unrelated route active", () => {
    expect(isActivePath("/admin", "/sign-in")).toBe(false);
  });
});

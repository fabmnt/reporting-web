import "@testing-library/jest-dom/vitest";

// jsdom has no matchMedia, and the theme toggle reads it to follow the device
// preference. Tests only need the call to exist and to report a light device.
if (typeof window !== "undefined" && typeof window.matchMedia !== "function") {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

// jsdom has no object URLs, and the recovery-code download builds one. Tests
// that inspect the file spy on these; the rest only need the calls to exist.
if (typeof URL.createObjectURL !== "function") {
  URL.createObjectURL = () => "blob:test";
  URL.revokeObjectURL = () => undefined;
}

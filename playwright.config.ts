import { defineConfig, devices } from "@playwright/test";

// The suite that reads a real spreadsheet signs in with a real account, and both
// come from .env.e2e. Playwright does not load environment files itself, and a
// missing file is not an error: the test that needs it skips itself.
try {
  process.loadEnvFile(".env.e2e");
} catch {
  // No file to load.
}

const devServerUrl = "http://localhost:4322";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",
  use: {
    baseURL: devServerUrl,
    trace: "on-first-retry",
  },
  webServer: {
    command: "pnpm dev",
    url: devServerUrl,
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});

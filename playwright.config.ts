import { defineConfig, devices } from "@playwright/test";

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

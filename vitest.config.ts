import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { getViteConfig } from "astro/config";

export default defineConfig(
  getViteConfig({
    plugins: [react()],
    test: {
      environment: "jsdom",
      globals: true,
      setupFiles: ["./src/test/setup.ts"],
      include: ["src/**/*.{test,spec}.{ts,tsx}"],
      // React drops `act` from its production build, and Vitest keeps whatever
      // NODE_ENV the shell exports, so a machine that runs with production in
      // the environment would fail every test that renders a component.
      env: { NODE_ENV: "test" },
    },
  })
);

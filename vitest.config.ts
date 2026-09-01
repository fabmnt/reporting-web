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
    },
  })
);

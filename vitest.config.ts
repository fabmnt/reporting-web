import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { getViteConfig } from "astro/config";

export default defineConfig(
  getViteConfig({
    plugins: [react()],
    test: {
      // React drops `act` from its production build, and Vitest keeps whatever
      // NODE_ENV the shell exports, so a machine that runs with production in
      // the environment would fail every test that renders a component.
      env: { NODE_ENV: "test" },
      // The components and helpers render in jsdom, and the Convex functions
      // run in the edge runtime `convex-test` needs.
      projects: [
        {
          extends: true,
          test: {
            name: "web",
            environment: "jsdom",
            globals: true,
            setupFiles: ["./src/test/setup.ts"],
            include: ["src/**/*.{test,spec}.{ts,tsx}"],
          },
        },
        {
          extends: true,
          test: {
            // The import script's test spawns Node, which the jsdom
            // environment does not hand out.
            name: "scripts",
            environment: "node",
            globals: true,
            include: ["scripts/**/*.test.ts"],
          },
        },
        {
          extends: true,
          test: {
            name: "convex",
            environment: "edge-runtime",
            globals: true,
            include: ["convex/**/*.test.ts"],
          },
        },
      ],
    },
  })
);

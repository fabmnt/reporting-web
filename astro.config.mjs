// @ts-check
import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";

const REPORTING_WEB_DEV_PORT = 4322;

// https://astro.build/config
export default defineConfig({
  server: {
    port: REPORTING_WEB_DEV_PORT,
  },
  integrations: [react()],
  vite: {
    server: {
      // Pick the next free port when 4322 is taken by another Astro project.
      strictPort: false,
    },
    plugins: [tailwindcss()],
  },
});

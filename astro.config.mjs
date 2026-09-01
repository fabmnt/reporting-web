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
      strictPort: true,
    },
    plugins: [tailwindcss()],
  },
});

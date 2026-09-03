import { defineApp } from "convex/server";
import { v } from "convex/values";

const app = defineApp({
  env: {
    GOOGLE_OAUTH_CLIENT_ID: v.string(),
    GOOGLE_OAUTH_CLIENT_SECRET: v.string(),
    GOOGLE_REFRESH_TOKEN: v.string(),
  },
});

export default app;

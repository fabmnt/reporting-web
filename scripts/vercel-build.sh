#!/bin/sh
set -eu

# Preview deployments have no Convex deploy key, so they build against the
# backend their CONVEX_URL points at and never push Convex functions.
if [ "${VERCEL_ENV:-}" != "production" ]; then
  if [ -z "${CONVEX_URL:-}" ]; then
    echo "CONVEX_URL is not set. Add it to the Preview environment in Vercel." >&2
    exit 1
  fi
  exec pnpm build
fi

exec npx convex deploy --cmd "pnpm build" --cmd-url-env-var-name CONVEX_URL

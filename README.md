# Reporting Web

New web app for the Reporting Tool migration. Fresh project, does not affect `../Reporting-Tool`.

## Stack

- Astro 7 + React 19 + TypeScript (strict)
- Tailwind CSS 4 + shadcn with Base UI (base-nova preset, lucide icons)
- ESLint + Prettier
- Vitest + Testing Library + jsdom + Playwright
- Convex (password auth, staff account management, reporting domain schema)
- pnpm (`pnpm@11.24.0`, engines: node >=22.12, pnpm >=9)
- shadcn skill installed at `~/.agents/skills/shadcn/`, Convex AI skills in `.agents/skills/` + `.claude/skills/`

## Scripts

```sh
pnpm dev             # start Astro and Convex
pnpm build           # production build
pnpm lint            # eslint
pnpm format          # prettier --write
pnpm test            # vitest run
pnpm test:watch      # vitest watch
pnpm e2e             # playwright
pnpm google:token    # mint the OAuth refresh token the app reads sheets with
pnpm google:test-sheet  # create the spreadsheet the service-account e2e test reads
pnpm dlx shadcn@latest add button --yes   # add UI components (base, not radix)
pnpm dlx convex ai-files status           # check Convex AI files
```

## Service accounts

A client can be read with its own Google service account instead of the app's
OAuth account. An administrator adds the account under Admin / Service accounts
(paste the JSON key file Google hands out), links it to a client in the client
form, and shares that client's sheets with the account's address. A client
without one keeps being read with the app's account, and the column in the
clients table says which one is in use.

To run the end-to-end test of that path:

1. Put the account in `.env.e2e`, either `GOOGLE_SERVICE_ACCOUNT_FILE=/path/to/key.json`
   or `GOOGLE_SERVICE_ACCOUNT_EMAIL` + `GOOGLE_SERVICE_ACCOUNT_KEY`, next to the
   `USERNAME` and `PASSWORD` of an administrator.
2. `pnpm google:test-sheet` creates a spreadsheet with that account, writes the
   rows the seeded "Pending audit" report keeps, and leaves the fixture in
   `scripts/output/`.
3. `pnpm e2e` runs it. Without the account or the fixture the test skips itself,
   so the rest of the suite still runs on a machine that has neither.

The test stores the key through the admin screen, asks Google to sign a token
with it, links it to a test client, and runs a report over the sheet. The sheet
is only shared with the service account, so a run that shows its rows read it
with that account and not with the app.

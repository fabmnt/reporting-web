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
pnpm dlx shadcn@latest add button --yes   # add UI components (base, not radix)
pnpm dlx convex ai-files status           # check Convex AI files
```

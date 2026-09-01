# Reporting Web

New web app for the Reporting Tool migration. Fresh project, does not affect `../Reporting-Tool`.

## Stack

- Astro 7 + React 19 + TypeScript (strict)
- Tailwind CSS 4 + shadcn with Base UI (base-nova preset, lucide icons)
- ESLint + Prettier
- Vitest + Testing Library + jsdom + Playwright
- Convex (empty schema, no business logic yet)
- pnpm (`pnpm@11.24.0`, engines: node >=22.12, pnpm >=9)
- shadcn skill installed at `~/.agents/skills/shadcn/`, Convex AI skills in `.agents/skills/` + `.claude/skills/`

## Scripts

```sh
pnpm dev             # start Astro
pnpm build           # production build
pnpm lint            # eslint
pnpm format          # prettier --write
pnpm test            # vitest run
pnpm test:watch      # vitest watch
pnpm e2e             # playwright
pnpm dlx shadcn@latest add button --yes   # add UI components (base, not radix)
pnpm dlx convex ai-files status           # check Convex AI files
```

## Convex

Convex is installed and scaffolded at `convex/schema.ts` and `convex/tsconfig.json` with an empty schema.
Convex AI files installed: `convex/_generated/ai/guidelines.md` + `AGENTS.md` block + 30+ skills under `.agents/skills/convex-*` and `.claude/skills/`.
_read them before writing Convex code:_ `convex/_generated/ai/guidelines.md` overrides prior training data.

No tables or business logic added in this phase. To create a deployment:

```sh
pnpm dlx convex dev       # interactive setup, creates CONVEX_DEPLOYMENT and convex/_generated/
```

Commit `convex/_generated/` after first `convex dev`.

## Decisions

- Path alias `@/*` -> `src/*` via `tsconfig.json`.
- Tailwind via `@tailwindcss/vite` + `src/styles/global.css` (now imports `shadcn/tailwind.css`, `tw-animate-css`, `@fontsource-variable/geist`).
- shadcn config in `components.json` (base-nova, base, cssVariables, neutral).
- `src/components/ui/button.tsx` uses `@base-ui/react/button`, not Radix.
- `pnpm-workspace.yaml` allowBuilds: esbuild=true.
- Tailwind via `@tailwindcss/vite` + `src/styles/global.css`.
- shadcn config in `components.json` (new-york, neutral, cssVariables).
- Sample `src/components/ui/button.tsx` + `src/lib/utils.ts` as proof of shadcn wiring.

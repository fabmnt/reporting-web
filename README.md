# Reporting Web

New web app for the Reporting Tool migration. Fresh project, does not affect `../Reporting-Tool`.

## Stack

- Astro 7 + React 19 + TypeScript (strict)
- Tailwind CSS 4 + shadcn UI
- ESLint + Prettier
- Vitest + Testing Library + jsdom + Playwright
- Convex (empty schema, no business logic yet)
- pnpm preferred, npm works

## Scripts

```sh
npm run dev          # start Astro
npm run build        # production build
npm run lint         # eslint
npm run format       # prettier --write
npm run test         # vitest run
npm run test:watch   # vitest watch
npm run e2e          # playwright
```

## Convex

Convex is installed and scaffolded at `convex/schema.ts` and `convex/tsconfig.json` with an empty schema.

No tables or business logic added in this phase. To create a deployment:

```sh
npx convex dev       # interactive setup, creates CONVEX_DEPLOYMENT and convex/_generated/
```

Commit `convex/_generated/` after first `convex dev`.

## Decisions

- Path alias `@/*` -> `src/*` via `tsconfig.json`.
- Tailwind via `@tailwindcss/vite` + `src/styles/global.css`.
- shadcn config in `components.json` (new-york, neutral, cssVariables).
- Sample `src/components/ui/button.tsx` + `src/lib/utils.ts` as proof of shadcn wiring.

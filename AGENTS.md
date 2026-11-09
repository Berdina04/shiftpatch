# ShiftPatch

Nursing agencies post shifts, nurses claim them, and an admin sees which shifts are covered and by whom. Cancellations and no-shows reopen a shift so another nurse can claim it.

Stack: TypeScript, Next.js, Postgres (Neon), Prisma, custom JWT auth (bcrypt), Vercel. Tests: Vitest on real Postgres, Playwright.

## Read first
- `docs/spec.md`: seed data, API routes with exact formats, required `data-testid`s. Source of truth; never edit it.
- `docs/plan.md`: the five parts in order, product rules, spec gap resolutions, assumptions, cut list.
- `docs/decisions.md`: auth, hosting, test database and real-time decisions, with reasons.

## Working rules
- Scope or decision changes: propose them and wait for approval before acting.
- Before saying a task is done, run the checks and show their output.
- Never commit secrets or `.env` files.
- Reviewing agents don't edit code: they write findings to `docs/reviews/<part>.md` (e.g. `docs/reviews/part-1.md`).

## Commands
First-time setup: `cp .env.example .env` (set `JWT_SECRET`), `npm install`, `npm run db:up`, `npm run db:deploy`, `npm run db:seed`.

| Command | What it does |
|---|---|
| `npm run dev` | Next.js dev server on http://localhost:3000 (uses `DATABASE_URL` from `.env`). |
| `npm run db:up` / `npm run db:down` | Start / stop local Postgres in Docker (host port 5433; creates `shiftpatch` and `shiftpatch_test`). |
| `npm run db:migrate` | Create and apply a new migration after editing `prisma/schema.prisma` (dev database). |
| `npm run db:deploy` | Apply pending migrations (`prisma migrate deploy`). |
| `npm run db:seed` | Insert any missing trial-start rows from `docs/spec.md`; never changes existing rows. |
| `npm run db:reset` | Delete all data and restore the trial-start seed. Refuses non-local databases unless you add `-- --yes`. |
| `npm run typecheck` | Generate Next route types, then `tsc --noEmit`. |
| `npm run lint` | ESLint, zero warnings allowed. |
| `npm test` | Vitest integration tests on the real Postgres in `TEST_DATABASE_URL` (must end in `_test`; it is wiped). Needs `npm run db:up`. |
| `npm run build` | Production build. |
| `npm run test:e2e` | Playwright against the production build on port 3100, using the test database (run `npm run build` first). |
| `npm run smoke -- <url>` | Read-only smoke check of a deployed app: all 5 seed logins, 401s, shift shape. Safe on production. |

CI (`.github/workflows/ci.yml`) runs typecheck, lint, Vitest and Playwright on every PR and on pushes to `main`. Vercel runs `npm run vercel-build`, which runs migrate deploy and the seed for production only, then builds.

Production: https://shiftpatch-phi.vercel.app (Vercel project `shiftpatch`, Neon `shiftpatch-db`). Check it with `npm run smoke -- https://shiftpatch-phi.vercel.app`. Never run `npm test` or `npm run test:e2e` against it: they wipe their database.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

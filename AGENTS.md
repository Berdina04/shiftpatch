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
- Never print files that hold credentials (`.env*`, `~/.npmrc`) to check a setting; show only whether it is set (e.g. `grep -c '^JWT_SECRET=' .env`).
- Reviewing agents don't edit code: they write findings to `docs/reviews/<part>.md` (e.g. `docs/reviews/part-1.md`).
- Ask the user before any decision that isn't in `docs/plan.md`, even a small addition.
- If a tool asks for the user's consent (e.g. Prisma's `migrate reset`), stop and ask the user. Never work around it.

## Commands
Scripts are in `package.json`; first-time setup and tests are in `README.md`. Against production, run only `npm run smoke -- <url>` (read-only). `npm test` and `npm run test:e2e` wipe their database.

## Deployments
- Production: https://shiftpatch-phi.vercel.app (Vercel project `shiftpatch`, Neon database `shiftpatch-db`), deployed from `main`.
- Each preview deployment gets its own Neon branch (Neon preview branching, set in Vercel), so every build runs migrations and the seed on its own database.
- Never turn off Neon preview branching for previews: previews would then use production's database and migrate it.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

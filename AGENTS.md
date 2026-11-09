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
To be added when Part 1 is done.

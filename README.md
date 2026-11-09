# ShiftPatch

Nursing agencies post shifts, nurses claim them, and an admin sees which shifts are covered and by whom. Spec: [docs/spec.md](docs/spec.md). Build plan: [docs/plan.md](docs/plan.md).

## Requirements

- Node.js 24
- Docker (runs the local Postgres)

## First-time setup

```bash
cp .env.example .env    # then set JWT_SECRET: openssl rand -base64 48
npm install
npm run db:up           # Postgres on localhost:5433 with the shiftpatch and shiftpatch_test databases
npm run db:deploy       # apply migrations
npm run db:seed         # load the sample data from docs/spec.md
npm run dev             # http://localhost:3000
```

Log in as any user in [docs/spec.md](docs/spec.md) ("Sample data"). Every password is `Trial2026!`.

## Tests

Both suites need `npm run db:up` and wipe the database in `TEST_DATABASE_URL`.

```bash
npm test                            # Vitest integration tests on real Postgres
npm run build && npm run test:e2e   # Playwright against the production build
```

`npm run smoke -- <url>` is a read-only check of a deployed app, safe to run against production.

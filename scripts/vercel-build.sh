#!/bin/sh
# Vercel build. Every deployment migrates and seeds its own database:
# production uses the main Neon branch, and each preview gets its own Neon
# branch (Neon preview branching), so PR migrations never touch production.
# The guard runs first: a preview build stops here unless Neon's API confirms
# its database is its own preview branch (scripts/check-preview-database.mjs).
set -e
node scripts/check-preview-database.mjs
npx prisma migrate deploy
npx tsx prisma/seed.ts
npx next build

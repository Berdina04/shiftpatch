#!/bin/sh
# Vercel build. Every deployment migrates and seeds its own database:
# production uses the main Neon branch, and each preview gets its own Neon
# branch (Neon preview branching), so PR migrations never touch production.
set -e
npx prisma migrate deploy
npx tsx prisma/seed.ts
npx next build

#!/bin/sh
# Vercel build. Migrations and the insert-if-missing seed run only for
# production: preview deployments share the production database unless Neon
# preview branching is enabled, and a PR must never migrate production.
set -e
if [ "$VERCEL_ENV" = "production" ]; then
  npx prisma migrate deploy
  npx tsx prisma/seed.ts
else
  echo "VERCEL_ENV=${VERCEL_ENV:-unset}: skipping migrations and seed (production only)."
fi
npx next build

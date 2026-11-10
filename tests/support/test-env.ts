// Points the app at the test database. Shared by Vitest and Playwright.
import "dotenv/config";

const DEFAULT_TEST_DATABASE_URL = "postgresql://postgres:postgres@localhost:5433/shiftpatch_test";

export const TEST_JWT_SECRET = "test-only-secret-0123456789abcdef0123456789abcdef";

/**
 * Tests run with the clock pinned here (tests/support/pin-clock.mjs): between
 * the seed credential expiries (James 2026-06-01, Maria 2027-01-01), so the
 * spec's examples (Maria claims shift-1 → 200) hold whatever the real date.
 */
export const TEST_NOW = "2026-11-10T12:00:00.000Z";

export function testDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL ?? DEFAULT_TEST_DATABASE_URL;
  // Tests wipe this database, so never let them run against anything else.
  if (!new URL(url).pathname.endsWith("_test")) {
    throw new Error(`TEST_DATABASE_URL must name a database ending in "_test" (got ${url})`);
  }
  return url;
}

/** Env for a child process (prisma CLI, next start) that must use the test DB. */
export function testProcessEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL: testDatabaseUrl() };
  delete env.DATABASE_URL_UNPOOLED;
  env.JWT_SECRET ??= TEST_JWT_SECRET;
  return env;
}

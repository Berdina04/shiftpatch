// Points the app at the test database. Shared by Vitest and Playwright.
import "dotenv/config";

const DEFAULT_TEST_DATABASE_URL = "postgresql://postgres:postgres@localhost:5433/shiftpatch_test";

export const TEST_JWT_SECRET = "test-only-secret-0123456789abcdef0123456789abcdef";

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

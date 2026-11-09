// Runs in each test worker before any app module reads the environment.
import { afterAll } from "vitest";
import { TEST_JWT_SECRET, testDatabaseUrl } from "./support/test-env";

process.env.DATABASE_URL = testDatabaseUrl();
process.env.JWT_SECRET = TEST_JWT_SECRET;

afterAll(async () => {
  const { getDb } = await import("@/lib/db");
  await getDb().$disconnect();
});

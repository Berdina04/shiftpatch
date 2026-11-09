import { createPrismaClient } from "../lib/db";
import { resetDatabase } from "../prisma/seed-data";
import { migrateTestDatabase } from "../tests/support/migrate-test-db";
import { testDatabaseUrl } from "../tests/support/test-env";

export default async function globalSetup() {
  migrateTestDatabase();
  const db = createPrismaClient(testDatabaseUrl());
  try {
    await resetDatabase(db);
  } finally {
    await db.$disconnect();
  }
}

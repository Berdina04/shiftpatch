// Deletes ALL data and restores the trial-start seed.
// Usage: npm run db:reset            (local databases only)
//        npm run db:reset -- --yes   (required for any non-local database)
import "dotenv/config";
import { createPrismaClient } from "../lib/db";
import { resetDatabase } from "../prisma/seed-data";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

const { hostname, pathname } = new URL(url);
const target = `${hostname}${pathname}`;
const isLocal = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(hostname);

if (!isLocal && !process.argv.includes("--yes")) {
  console.error(
    `Refusing to reset non-local database ${target}. Re-run with --yes to delete all its data.`,
  );
  process.exit(1);
}

const db = createPrismaClient();
try {
  await resetDatabase(db);
  console.log(`Reset ${target} to trial-start data.`);
} finally {
  await db.$disconnect();
}

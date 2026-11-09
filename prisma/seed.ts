// Insert-if-missing seed. Safe to run on every deploy.
import "dotenv/config";
import { createPrismaClient } from "../lib/db";
import { seedDatabase } from "./seed-data";

const db = createPrismaClient();
try {
  await seedDatabase(db);
  console.log("Seed: inserted any missing trial-start rows (existing rows left unchanged).");
} finally {
  await db.$disconnect();
}

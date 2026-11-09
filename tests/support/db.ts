import { getDb } from "@/lib/db";
import { resetDatabase } from "@/prisma/seed-data";

export const db = () => getDb();

export async function resetToSeed(): Promise<void> {
  await resetDatabase(getDb());
}

import { db } from "./db";

/**
 * Resolves once some session in the test database is waiting for a lock: the
 * request the test started has reached the lock the test is holding.
 */
export async function untilSomeoneWaitsForALock(): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const [{ waiting }] = await db().$queryRaw<{ waiting: number }[]>`
      SELECT count(*)::int AS waiting FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock'`;
    if (waiting > 0) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("no session ever waited for the lock the test holds");
}

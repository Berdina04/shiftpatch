// The three Part 2 guarantees (plan.md, "Verified by"), on real Postgres with
// real concurrent transactions. Route handlers are called in-process; the
// requests run in parallel against the database.
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db, resetToSeed } from "../support/db";
import { auditRows, createNurse, createShift, shiftRow } from "../support/fixtures";
import { claim, EMAILS, postShift, tokenFor } from "../support/http";

beforeEach(resetToSeed);

describe("race: 20 nurses claim one shift at once", () => {
  it("exactly one 200, nineteen 409, one claimant in the database", async () => {
    const nurses = await Promise.all(Array.from({ length: 20 }, () => createNurse()));

    const responses = await Promise.all(nurses.map((n) => claim(n.token, "shift-3")));
    const results = await Promise.all(
      responses.map(async (res, i) => ({ nurse: nurses[i].id, status: res.status, body: await res.json() })),
    );

    const winners = results.filter((r) => r.status === 200);
    const losers = results.filter((r) => r.status !== 200);
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(19);
    for (const l of losers) expect([l.status, l.body]).toStrictEqual([409, { error: "Shift already taken" }]);

    const winner = winners[0].nurse;
    expect(winners[0].body).toMatchObject({ id: "shift-3", status: "filled", claimedBy: winner });
    expect(await shiftRow("shift-3")).toStrictEqual({ status: "filled", claimedBy: winner });
    expect((await auditRows({ action: "shift.claimed" })).map((a) => a.actorId)).toStrictEqual([winner]);
  });
});

describe("overlap race: one nurse claims two overlapping shifts at once", () => {
  it.each(Array.from({ length: 10 }, (_, i) => i + 1))("round %i: exactly one succeeds", async () => {
    const nurse = await createNurse();
    const a = await createShift({ date: "2026-12-01", startTime: "07:00", endTime: "19:00" });
    const b = await createShift({ date: "2026-12-01", startTime: "12:00", endTime: "20:00", agencyId: "agency-b" });

    const [ra, rb] = await Promise.all([claim(nurse.token, a), claim(nurse.token, b)]);
    const statuses = [ra.status, rb.status].sort();
    expect(statuses).toStrictEqual([200, 409]);
    const loser = ra.status === 409 ? ra : rb;
    expect(await loser.json()).toStrictEqual({ error: "Shift overlaps another shift you hold" });

    const held = await db().shift.findMany({ where: { claimedById: nurse.id } });
    expect(held).toHaveLength(1);
    expect(await auditRows({ action: "shift.claimed" })).toHaveLength(1);
  });
});

describe("rollback: the audit insert fails", () => {
  // A temporary trigger makes every AuditLog insert raise, so the change and
  // its audit entry must roll back together. No test hook in the app code.
  beforeEach(async () => {
    await db().$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION test_fail_audit_insert() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'forced audit failure (test)'; END;
      $$ LANGUAGE plpgsql`);
    await db().$executeRawUnsafe(`
      CREATE TRIGGER test_fail_audit_insert BEFORE INSERT ON "AuditLog"
      FOR EACH ROW EXECUTE FUNCTION test_fail_audit_insert()`);
  });
  afterEach(async () => {
    await db().$executeRawUnsafe('DROP TRIGGER IF EXISTS test_fail_audit_insert ON "AuditLog"');
    await db().$executeRawUnsafe("DROP FUNCTION IF EXISTS test_fail_audit_insert()");
  });

  let maria: string;
  let agencyA: string;
  beforeAll(async () => {
    await resetToSeed(); // logins need the seed users
    maria = await tokenFor(EMAILS.maria);
    agencyA = await tokenFor(EMAILS.agencyA);
  });

  it("a claim returns 500 and the shift is unchanged", async () => {
    const res = await claim(maria, "shift-1");

    expect(res.status).toBe(500);
    expect(await res.json()).toStrictEqual({ error: "Internal server error" });
    expect(await shiftRow("shift-1")).toStrictEqual({ status: "open", claimedBy: null });
    expect(await db().auditLog.count()).toBe(0);
  });

  it("a post returns 500 and no shift is created", async () => {
    const res = await postShift(agencyA);

    expect(res.status).toBe(500);
    expect(await db().shift.count()).toBe(3);
    expect(await db().auditLog.count()).toBe(0);
  });
});

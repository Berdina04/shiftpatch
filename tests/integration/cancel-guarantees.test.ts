// Part 3 guarantees for cancel (plan.md, "Verified by"), on real Postgres with
// real concurrent transactions. Rollback: guarantees.test.ts.
// Every response must have one of the expected statuses: a deadlock (Postgres
// aborts one side with 40P01) or any other failure comes back as a 500 and
// fails the test.
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CANCEL_ERRORS } from "@/lib/cancellations";
import { CLAIM_ERRORS } from "@/lib/claims";
import { db, resetToSeed } from "../support/db";
import { auditRows, cancellationRows, createNurse, createShift, shiftRow } from "../support/fixtures";
import { cancel, claim, EMAILS, tokenFor } from "../support/http";

const ROUNDS = Array.from({ length: 10 }, (_, i) => i + 1);

let agencyA: string;
let alex: string;
beforeAll(async () => {
  await resetToSeed(); // logins need the seed users, whatever ran before
  agencyA = await tokenFor(EMAILS.agencyA);
  alex = await tokenFor(EMAILS.alex);
});
beforeEach(resetToSeed);

type Result = { status: number; body: Record<string, unknown> };
const settle = (res: Promise<Response>): Promise<Result> =>
  res.then(async (r) => ({ status: r.status, body: await r.json() }));

type Nurse = Awaited<ReturnType<typeof createNurse>>;

/** An agency-a shift on 2026-12-01, 07:00–19:00, claimed through the route (so the claim is audited). */
async function claimedShift(nurse: Nurse): Promise<string> {
  const id = await createShift({ date: "2026-12-01", startTime: "07:00", endTime: "19:00" });
  const res = await claim(nurse.token, id);
  expect(res.status).toBe(200);
  return id;
}

describe("double cancel: the agency, the admin and the nurse cancel one claim at once", () => {
  it.each(ROUNDS)("round %i: exactly one 200, two 409, one history row", async () => {
    const nurse = await createNurse();
    const shiftId = await claimedShift(nurse);

    const results = await Promise.all([
      settle(cancel(agencyA, shiftId, { reason: "no-show" })),
      settle(cancel(alex, shiftId, { reason: "advance" })),
      settle(cancel(nurse.token, shiftId, { reason: "advance" })),
    ]);

    const winners = results.filter((r) => r.status === 200);
    expect(winners).toHaveLength(1);
    expect(winners[0].body.cancellation).toMatchObject({ previousNurseId: nurse.id });
    for (const r of results.filter((x) => x.status !== 200)) {
      expect(r).toStrictEqual({ status: 409, body: { error: CANCEL_ERRORS.notClaimed } });
    }
    expect(await shiftRow(shiftId)).toStrictEqual({ status: "open", claimedBy: null });
    expect(await cancellationRows({ shiftId })).toHaveLength(1);
    expect(await auditRows({ shiftId, action: "shift.cancelled" })).toHaveLength(1);
  });
});

describe("cancel vs claim: a no-show while other nurses claim the shift and its nurse claims an overlapping one", () => {
  it.each(ROUNDS)("round %i: no 500, at most one new claimant, and the history matches the final state", async () => {
    const holder = await createNurse();
    const others = await Promise.all(Array.from({ length: 4 }, () => createNurse()));
    const shiftId = await claimedShift(holder);
    const overlapping = await createShift({ date: "2026-12-01", startTime: "12:00", endTime: "20:00", agencyId: "agency-b" });

    const [cancelled, holderClaim, ...claims] = await Promise.all([
      settle(cancel(agencyA, shiftId, { reason: "no-show" })),
      // Locks the holder's row while the cancel removes the holder: the case an
      // FK from the history row to the nurse would make the cancel wait on.
      settle(claim(holder.token, overlapping)),
      ...others.map((n) => settle(claim(n.token, shiftId))),
    ]);

    // The cancel always wins: no claim can take a filled shift.
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.cancellation).toStrictEqual({ reason: "no-show", previousNurseId: holder.id });

    // The holder's overlapping claim succeeds only if the cancel committed first.
    if (holderClaim.status === 200) expect(holderClaim.body).toMatchObject({ id: overlapping, claimedBy: holder.id });
    else expect(holderClaim).toStrictEqual({ status: 409, body: { error: CLAIM_ERRORS.overlap } });

    // At most one other nurse gets the reopened shift; the rest find it taken.
    const won = claims.filter((c) => c.status === 200);
    expect(won.length).toBeLessThanOrEqual(1);
    for (const c of claims.filter((x) => x.status !== 200)) {
      expect(c).toStrictEqual({ status: 409, body: { error: CLAIM_ERRORS.taken } });
    }
    const winner = (won[0]?.body.claimedBy as string | undefined) ?? null;
    expect(await shiftRow(shiftId)).toStrictEqual(
      winner ? { status: "filled", claimedBy: winner } : { status: "open", claimedBy: null },
    );

    // Replaying the shift's audit trail in order gives the state in the database,
    // and the cancellation names the nurse who actually held the shift.
    let heldBy: string | null = null;
    for (const entry of await auditRows({ shiftId })) {
      if (entry.action === "shift.claimed") {
        expect(heldBy).toBeNull();
        heldBy = entry.actorId;
      } else if (entry.action === "shift.cancelled") {
        expect(entry.details).toMatchObject({ previousNurseId: heldBy });
        heldBy = null;
      }
    }
    expect(heldBy).toBe(winner);
    expect(await cancellationRows({ shiftId })).toStrictEqual([
      { shiftId, reason: "no-show", previousNurseId: holder.id, cancelledById: "agency-a", cancelledByRole: "agency" },
    ]);

    // The holder never ends up with two overlapping shifts.
    const held = await db().shift.findMany({ where: { claimedById: holder.id }, select: { id: true } });
    expect(held.map((s) => s.id)).toStrictEqual(holderClaim.status === 200 ? [overlapping] : []);
  });
});

describe("a cancel that waited on a concurrent change acts on the shift as it is now", () => {
  // The test holds the shift's row lock, starts a cancel (which must wait),
  // then swaps the claimant as if the claim had been cancelled and another
  // nurse had claimed it, and commits. A cancel that read the shift before
  // waiting would still see the old claimant.

  /** Resolves once some session in this database is waiting for a row lock. */
  async function untilACancelWaits(): Promise<void> {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const [{ waiting }] = await db().$queryRaw<{ waiting: number }[]>`
        SELECT count(*)::int AS waiting FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock'`;
      if (waiting > 0) return;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error("the cancel never waited for the shift's row lock");
  }

  async function cancelWhileClaimantChanges(shiftId: string, to: Nurse, body: unknown): Promise<Response> {
    let pending: Promise<Response> | undefined;
    await db().$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "Shift" WHERE "id" = ${shiftId} FOR UPDATE`;
        pending = cancel(agencyA, shiftId, body);
        await untilACancelWaits();
        await tx.$executeRaw`UPDATE "Shift" SET "claimedById" = ${to.id} WHERE "id" = ${shiftId}`;
      },
      { timeout: 15_000 },
    );
    return pending!;
  }

  it("without nurseId (the spec's request): it cancels the current claimant and records that nurse", async () => {
    const [first, second] = [await createNurse(), await createNurse()];
    const shiftId = await claimedShift(first);

    const res = await cancelWhileClaimantChanges(shiftId, second, { reason: "no-show" });

    expect(res.status).toBe(200);
    expect((await res.json()).cancellation).toStrictEqual({ reason: "no-show", previousNurseId: second.id });
    expect(await shiftRow(shiftId)).toStrictEqual({ status: "open", claimedBy: null });
    expect(await cancellationRows({ shiftId })).toMatchObject([{ previousNurseId: second.id }]);
  });

  it("with the nurse the page showed (nurseId): 409, and the new claim stands", async () => {
    const [first, second] = [await createNurse(), await createNurse()];
    const shiftId = await claimedShift(first);

    const res = await cancelWhileClaimantChanges(shiftId, second, { reason: "no-show", nurseId: first.id });

    expect(res.status).toBe(409);
    expect(await res.json()).toStrictEqual({ error: CANCEL_ERRORS.heldByAnother });
    expect(await shiftRow(shiftId)).toStrictEqual({ status: "filled", claimedBy: second.id });
    expect(await cancellationRows({ shiftId })).toStrictEqual([]);
  });
});

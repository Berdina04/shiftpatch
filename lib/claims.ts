// Claiming a shift (docs/plan.md, Part 2). Three guarantees:
//  1. Two nurses can't claim the same shift: the conditional UPDATE ... WHERE
//     status = 'open' lets exactly one transaction fill it.
//  2. A nurse can't hold two overlapping shifts: the nurse's row is locked
//     first, so their claims run one at a time and the overlap check sees any
//     claim that committed before it.
//  3. A failed step changes nothing: every step, the audit entry included,
//     runs in one transaction.
// Check order (plan.md): missing shift 404 → credential 403 → taken 409 → overlap 409.
import { WRITE_TX_OPTIONS, writeAudit } from "./audit";
import type { SessionUser } from "./auth";
import { getDb } from "./db";
import type { Prisma } from "./generated/prisma/client";
import { HttpError } from "./http";
import { addDays, isoDate, shiftEndDate, shiftsOverlap, todayIso, type ShiftTimes } from "./shift-time";
import { shiftSelect, toShiftDto, type ShiftDto } from "./shifts";

export const CLAIM_ERRORS = {
  notFound: "Shift not found",
  noApprovedCredential: "No approved credential, cannot claim shift",
  credentialExpired: "Credential expired, cannot claim shift",
  taken: "Shift already taken",
  overlap: "Shift overlaps another shift you hold",
} as const;

export async function claimShift(nurse: SessionUser, shiftId: string): Promise<ShiftDto> {
  return getDb().$transaction(async (tx) => {
    // Held until commit. A second claim by the same nurse waits here.
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${nurse.id} FOR UPDATE`;

    const shift = await tx.shift.findUnique({ where: { id: shiftId }, select: shiftSelect });
    if (!shift) throw new HttpError(404, CLAIM_ERRORS.notFound);

    await assertCredentialCovers(tx, nurse.id, shift);

    // Gives "taken" priority over "overlap"; the UPDATE below is what decides.
    if (shift.status !== "open") throw new HttpError(409, CLAIM_ERRORS.taken);

    await assertNoOverlap(tx, nurse.id, shift);

    // The guarantee: if another claim committed first, Postgres re-checks
    // status = 'open' on the committed row, and this matches 0 rows.
    const updated = await tx.$executeRaw`
      UPDATE "Shift"
      SET "status" = 'filled', "claimedById" = ${nurse.id}, "updatedAt" = now()
      WHERE "id" = ${shiftId} AND "status" = 'open'`;
    if (updated !== 1) throw new HttpError(409, CLAIM_ERRORS.taken);

    await writeAudit(tx, {
      actor: { id: nurse.id, role: nurse.role },
      action: "shift.claimed",
      shiftId,
      details: { status: { from: "open", to: "filled" }, claimedBy: nurse.id },
    });

    const claimed = await tx.shift.findUniqueOrThrow({ where: { id: shiftId }, select: shiftSelect });
    return toShiftDto(claimed);
  }, WRITE_TX_OPTIONS);
}

/**
 * Some approved credential must be valid today and through the end of the
 * shift; the expiry date itself is not valid (plan.md). Pending and rejected
 * credentials don't count.
 */
async function assertCredentialCovers(tx: Prisma.TransactionClient, nurseId: string, shift: ShiftTimes) {
  const approved = await tx.credential.findMany({
    where: { nurseId, status: "approved" },
    select: { expiresOn: true },
  });
  if (approved.length === 0) throw new HttpError(403, CLAIM_ERRORS.noApprovedCredential);

  const today = todayIso();
  const endDate = isoDate(shiftEndDate(shift));
  const mustBeValidOn = today > endDate ? today : endDate;
  if (!approved.some((c) => isoDate(c.expiresOn) > mustBeValidOn)) {
    throw new HttpError(403, CLAIM_ERRORS.credentialExpired);
  }
}

/** Shifts are under 24 h, so only shifts dated the day before to the day after can overlap. */
async function assertNoOverlap(
  tx: Prisma.TransactionClient,
  nurseId: string,
  shift: ShiftTimes & { id: string },
) {
  const held = await tx.shift.findMany({
    where: {
      claimedById: nurseId,
      status: "filled",
      id: { not: shift.id },
      date: { gte: addDays(shift.date, -1), lte: addDays(shift.date, 1) },
    },
    select: { date: true, startTime: true, endTime: true },
  });
  if (held.some((h) => shiftsOverlap(h, shift))) {
    throw new HttpError(409, CLAIM_ERRORS.overlap);
  }
}

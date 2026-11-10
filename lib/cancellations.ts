// Cancelling a claim, for a no-show or in advance (docs/plan.md, Part 3). The
// shift reopens and the cancellation is kept in its history. Guarantees:
//  1. One decision per shift at a time: the shift row is locked first, so two
//     cancels can't both succeed, and a cancel that waited acts on whoever
//     holds the shift now.
//  2. No deadlock with claims: that lock is the only one a cancel waits for.
//     The history row has no foreign key to User and clearing claimedById
//     runs no FK check, so a cancel never locks a nurse's row (a claim locks
//     its nurse first, then at most the shift).
//  3. A failed step changes nothing: every step, the history row and the
//     audit entry included, runs in one transaction.
// Check order: 400 reason → 403 nurse no-show → 404 → 403 another agency's
// shift → 409 open → 409 held by another nurse (nurseId) → 403 not your shift.
import { z } from "zod";
import { WRITE_TX_OPTIONS, writeAudit } from "./audit";
import type { SessionUser } from "./auth";
import { CANCEL_REASONS, type CancelReason } from "./cancel-reasons";
import { getDb } from "./db";
import { HttpError } from "./http";
import { shiftSelect, toShiftDto, type ShiftDto } from "./shifts";

export const CANCEL_ERRORS = {
  badReason: "reason must be no-show or advance",
  badNurseId: "nurseId must be a string",
  nurseNoShow: "Nurses can only cancel in advance",
  notFound: "Shift not found",
  otherAgency: "You can only cancel your own agency's shifts",
  notClaimed: "Shift is not claimed",
  heldByAnother: "Shift is now held by another nurse",
  notYours: "You can only cancel your own shifts",
} as const;

const CancelBody = z.object(
  {
    reason: z.enum(CANCEL_REASONS, { error: CANCEL_ERRORS.badReason }),
    // Optional (not in the spec): the nurse the caller's page showed. If
    // another nurse holds the shift by now, the cancel is refused (409), so a
    // stale page can't mark the wrong nurse as a no-show.
    nurseId: z.string({ error: CANCEL_ERRORS.badNurseId }).optional(),
  },
  { error: "Request body must be a JSON object" },
);

export type CancelInput = z.infer<typeof CancelBody>;

/** Validates a POST /api/shifts/:id/cancel body; any other field is ignored. */
export function parseCancel(body: unknown): CancelInput {
  const parsed = CancelBody.safeParse(body);
  if (!parsed.success) throw new HttpError(400, parsed.error.issues[0].message);
  return parsed.data;
}

export type CancelledShiftDto = ShiftDto & {
  cancellation: { reason: CancelReason; previousNurseId: string };
};

export async function cancelShift(actor: SessionUser, shiftId: string, input: CancelInput): Promise<CancelledShiftDto> {
  const { reason, nurseId } = input;
  // Nurse: own claimed shift, `advance` only. Agency: own shifts. Admin: any.
  if (actor.role === "nurse" && reason !== "advance") throw new HttpError(403, CANCEL_ERRORS.nurseNoShow);

  return getDb().$transaction(async (tx) => {
    // Held until commit; a concurrent cancel or claim of this shift waits.
    // NO KEY UPDATE, like the UPDATE below: the shift's id never changes.
    const [shift] = await tx.$queryRaw<{ agencyId: string; claimedById: string | null }[]>`
      SELECT "agencyId", "claimedById" FROM "Shift" WHERE "id" = ${shiftId} FOR NO KEY UPDATE`;
    if (!shift) throw new HttpError(404, CANCEL_ERRORS.notFound);
    if (actor.role === "agency" && actor.agencyId !== shift.agencyId) {
      throw new HttpError(403, CANCEL_ERRORS.otherAgency);
    }

    const previousNurseId = shift.claimedById;
    if (previousNurseId === null) throw new HttpError(409, CANCEL_ERRORS.notClaimed);
    if (nurseId !== undefined && nurseId !== previousNurseId) throw new HttpError(409, CANCEL_ERRORS.heldByAnother);
    if (actor.role === "nurse" && actor.id !== previousNurseId) throw new HttpError(403, CANCEL_ERRORS.notYours);

    const reopened = await tx.shift.update({
      where: { id: shiftId },
      data: { status: "open", claimedById: null },
      select: shiftSelect,
    });
    await tx.shiftCancellation.create({
      data: { shiftId, reason, previousNurseId, cancelledById: actor.id, cancelledByRole: actor.role },
    });
    await writeAudit(tx, {
      actor: { id: actor.id, role: actor.role },
      action: "shift.cancelled",
      shiftId,
      details: { reason, previousNurseId, status: { from: "filled", to: "open" } },
    });

    return { ...toShiftDto(reopened), cancellation: { reason, previousNurseId } };
  }, WRITE_TX_OPTIONS);
}

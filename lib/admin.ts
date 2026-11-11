// The admin dashboard (plan.md, Part 3): every shift, each shift's claimant
// name and latest cancellation (the "reopened (…)" marker, kept after a
// re-claim), and the newest audit entries (shift and credential changes).
// `shifts` keeps the spec's shift shape; the dashboard's extra fields are in
// `shiftDetails`, keyed by shift id (review of Part 3, finding 4).
import type { CancelReason } from "./cancel-reasons";
import { getDb } from "./db";
import type { Role } from "./generated/prisma/enums";
import { shiftOrder, shiftSelect, toShiftDto, type ShiftDto } from "./shifts";

export const AUDIT_LOG_LIMIT = 100;

export type ShiftDetails = {
  claimedByName: string | null;
  lastCancellation: { reason: CancelReason; previousNurseId: string; cancelledAt: string } | null;
};

export type AuditEntryDto = {
  id: string;
  createdAt: string;
  actorId: string;
  actorRole: Role;
  action: string;
  // Exactly one is set: the entry is about a shift or a credential.
  shiftId: string | null;
  credentialId: string | null;
  details: unknown;
};

export type AdminDashboard = {
  shifts: ShiftDto[];
  shiftDetails: Record<string, ShiftDetails>;
  auditLog: AuditEntryDto[];
};

/**
 * All reads run in one read-only REPEATABLE READ transaction, so they share
 * one snapshot: a change that commits while the dashboard is read shows up in
 * all of it or none of it (review of Part 3, finding 2).
 */
export async function getAdminDashboard(): Promise<AdminDashboard> {
  const { shifts, audit } = await getDb().$transaction(
    async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      const shifts = await tx.shift.findMany({
        select: {
          ...shiftSelect,
          claimedBy: { select: { name: true } },
          cancellations: {
            select: { reason: true, previousNurseId: true, createdAt: true },
            orderBy: { id: "desc" },
            take: 1,
          },
        },
        orderBy: [...shiftOrder],
      });
      const audit = await tx.auditLog.findMany({ orderBy: { id: "desc" }, take: AUDIT_LOG_LIMIT });
      return { shifts, audit };
    },
    { isolationLevel: "RepeatableRead", maxWait: 10_000, timeout: 15_000 },
  );

  const shiftDetails: Record<string, ShiftDetails> = {};
  for (const { id, claimedBy, cancellations } of shifts) {
    const last = cancellations[0];
    shiftDetails[id] = {
      claimedByName: claimedBy?.name ?? null,
      lastCancellation: last
        ? {
            // The CHECK constraint allows only the two reasons.
            reason: last.reason as CancelReason,
            previousNurseId: last.previousNurseId,
            cancelledAt: last.createdAt.toISOString(),
          }
        : null,
    };
  }

  return {
    shifts: shifts.map((row) => toShiftDto(row)), // the spec's fields only
    shiftDetails,
    auditLog: audit.map((a) => ({
      id: a.id.toString(),
      createdAt: a.createdAt.toISOString(),
      actorId: a.actorId,
      actorRole: a.actorRole,
      action: a.action,
      shiftId: a.shiftId,
      credentialId: a.credentialId,
      details: a.details,
    })),
  };
}

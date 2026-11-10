// The admin dashboard (plan.md, Part 3): every shift with its claimant's name
// and latest cancellation (the "reopened (…)" marker, kept after a re-claim),
// and the newest audit entries.
import type { CancelReason } from "./cancel-reasons";
import { getDb } from "./db";
import type { Role } from "./generated/prisma/enums";
import { shiftOrder, shiftSelect, toShiftDto, type ShiftDto } from "./shifts";

export const AUDIT_LOG_LIMIT = 100;

export type AdminShiftDto = ShiftDto & {
  claimedByName: string | null;
  lastCancellation: { reason: CancelReason; previousNurseId: string; cancelledAt: string } | null;
};

export type AuditEntryDto = {
  id: string;
  createdAt: string;
  actorId: string;
  actorRole: Role;
  action: string;
  shiftId: string;
  details: unknown;
};

export type AdminDashboard = { shifts: AdminShiftDto[]; auditLog: AuditEntryDto[] };

export async function getAdminDashboard(): Promise<AdminDashboard> {
  const db = getDb();
  const [shifts, audit] = await Promise.all([
    db.shift.findMany({
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
    }),
    db.auditLog.findMany({ orderBy: { id: "desc" }, take: AUDIT_LOG_LIMIT }),
  ]);

  return {
    shifts: shifts.map(({ claimedBy, cancellations, ...row }) => {
      const last = cancellations[0];
      return {
        ...toShiftDto(row),
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
    }),
    auditLog: audit.map((a) => ({
      id: a.id.toString(),
      createdAt: a.createdAt.toISOString(),
      actorId: a.actorId,
      actorRole: a.actorRole,
      action: a.action,
      shiftId: a.shiftId,
      details: a.details,
    })),
  };
}

// Audit entries are written with the transaction client of the change they
// record, so a failed audit insert rolls the change back (plan.md).
import type { Prisma } from "./generated/prisma/client";
import type { Role } from "./generated/prisma/enums";

export type AuditAction = "shift.posted" | "shift.claimed";

export type AuditEntry = {
  actor: { id: string; role: Role };
  action: AuditAction;
  shiftId: string;
  details: Prisma.InputJsonObject;
};

export async function writeAudit(tx: Prisma.TransactionClient, entry: AuditEntry): Promise<void> {
  await tx.auditLog.create({
    data: {
      actorId: entry.actor.id,
      actorRole: entry.actor.role,
      action: entry.action,
      shiftId: entry.shiftId,
      details: entry.details,
    },
  });
}

/**
 * Options for every transaction that changes shifts. READ COMMITTED is
 * Postgres's default, stated here because the claim relies on it: each
 * statement sees rows committed before it started.
 */
export const WRITE_TX_OPTIONS = {
  isolationLevel: "ReadCommitted",
  maxWait: 10_000,
  timeout: 15_000,
} as const satisfies { isolationLevel: Prisma.TransactionIsolationLevel; maxWait: number; timeout: number };

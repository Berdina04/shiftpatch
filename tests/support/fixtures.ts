// Test-only rows, created directly in the test database (never in the seed).
import { signToken } from "@/lib/auth";
import { dateOnly, isoDate } from "@/lib/shift-time";
import { db } from "./db";

let counter = 0;

/** A nurse with the given credentials (default: one approved, valid until 2099). */
export async function createNurse(
  credentials: { status: "pending" | "approved" | "rejected"; expiresOn: string }[] = [
    { status: "approved", expiresOn: "2099-01-01" },
  ],
) {
  const n = ++counter;
  const id = `test-nurse-${process.pid}-${n}`;
  await db().user.create({
    data: {
      id,
      email: `${id}@example.test`,
      name: `Test Nurse ${n}`,
      role: "nurse",
      passwordHash: "not-a-real-hash",
      credentials: {
        create: credentials.map((c, i) => ({ id: `${id}-cred-${i}`, status: c.status, expiresOn: dateOnly(c.expiresOn) })),
      },
    },
  });
  return { id, token: await signToken(id) };
}

/** An open shift; the id comes from shift_id_seq like a posted one. */
export async function createShift(fields: { date: string; startTime: string; endTime: string; agencyId?: string }) {
  const row = await db().shift.create({
    data: {
      agencyId: fields.agencyId ?? "agency-a",
      role: "RN",
      date: dateOnly(fields.date),
      startTime: fields.startTime,
      endTime: fields.endTime,
    },
  });
  return row.id;
}

/** A date relative to today (UTC), as YYYY-MM-DD. */
export function daysFromToday(days: number): string {
  return isoDate(new Date(Date.now() + days * 24 * 60 * 60 * 1000));
}

export async function shiftRow(id: string) {
  const s = await db().shift.findUniqueOrThrow({ where: { id } });
  return { status: s.status, claimedBy: s.claimedById };
}

export async function auditRows(where: { shiftId?: string; action?: string } = {}) {
  const rows = await db().auditLog.findMany({ where, orderBy: { id: "asc" } });
  return rows.map(({ actorId, actorRole, action, shiftId, details }) => ({ actorId, actorRole, action, shiftId, details }));
}

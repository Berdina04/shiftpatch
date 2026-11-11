// Trial-start data, exactly as listed in docs/spec.md ("Sample data").
import bcrypt from "bcryptjs";
import type { PrismaClient } from "../lib/generated/prisma/client";
import { dateOnly } from "../lib/shift-time";

export const SEED_PASSWORD = "Trial2026!";

export const seedAgencies = [
  { id: "agency-a", name: "Sunrise Health Staffing" },
  { id: "agency-b", name: "Metro Care Partners" },
] as const;

// Agency logins use id = agencyId (docs/plan.md, spec gap resolutions).
export const seedUsers = [
  { id: "agency-a", email: "admin@sunrisehealth.example", name: "Sunrise Health Staffing", role: "agency", agencyId: "agency-a" },
  { id: "agency-b", email: "admin@metrocare.example", name: "Metro Care Partners", role: "agency", agencyId: "agency-b" },
  { id: "nurse-1", email: "maria.lopez@example.com", name: "Maria Lopez", role: "nurse", agencyId: null },
  { id: "nurse-2", email: "james.cook@example.com", name: "James Cook", role: "nurse", agencyId: null },
  { id: "admin-1", email: "alex.kim@example.com", name: "Alex Kim", role: "admin", agencyId: null },
] as const;

// Seeded credentials count as approved (docs/plan.md, product rules).
export const seedCredentials = [
  { id: "cred-nurse-1", nurseId: "nurse-1", expiresOn: "2027-01-01", status: "approved" },
  { id: "cred-nurse-2", nurseId: "nurse-2", expiresOn: "2026-06-01", status: "approved" },
] as const;

export const seedShifts = [
  { id: "shift-1", agencyId: "agency-a", role: "RN", date: "2026-10-02", startTime: "19:00", endTime: "07:00", status: "open", claimedById: null },
  { id: "shift-2", agencyId: "agency-a", role: "LPN", date: "2026-10-03", startTime: "07:00", endTime: "19:00", status: "filled", claimedById: "nurse-1" },
  { id: "shift-3", agencyId: "agency-b", role: "RN", date: "2026-10-04", startTime: "19:00", endTime: "07:00", status: "open", claimedById: null },
] as const;

/**
 * Inserts any seed row that is missing and leaves existing rows alone, so
 * running it on every deploy never resets production state.
 */
export async function seedDatabase(db: PrismaClient): Promise<void> {
  const passwordHash = await bcrypt.hash(SEED_PASSWORD, 10);

  await db.$transaction([
    db.agency.createMany({ data: [...seedAgencies], skipDuplicates: true }),
    db.user.createMany({
      data: seedUsers.map((u) => ({ ...u, passwordHash })),
      skipDuplicates: true,
    }),
    db.credential.createMany({
      data: seedCredentials.map((c) => ({ ...c, expiresOn: dateOnly(c.expiresOn) })),
      skipDuplicates: true,
    }),
    db.shift.createMany({
      data: seedShifts.map((s) => ({ ...s, date: dateOnly(s.date) })),
      skipDuplicates: true,
    }),
  ]);
}

/**
 * Deletes all data and restores the trial-start seed. RESTART IDENTITY also
 * restarts shift_id_seq, so the next posted shift is shift-4 again.
 */
export async function resetDatabase(db: PrismaClient): Promise<void> {
  await db.$executeRawUnsafe(
    'TRUNCATE TABLE "AuditLog", "ShiftCancellation", "Shift", "Credential", "User", "Agency" RESTART IDENTITY CASCADE',
  );
  await seedDatabase(db);
}

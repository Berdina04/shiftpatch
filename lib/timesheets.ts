// Timesheets (plan.md, Part 5): each nurse's scheduled hours from the shifts
// they hold now (filled shifts, past or future). A shift reopened by a cancel
// drops out. There is no clock-in, so these are scheduled hours, not time
// worked, and the UI says so.
//
// Scope by role: a nurse sees their own; an agency sees only its own shifts,
// so a nurse's totals there never include hours at another agency; the admin
// sees all. Everything comes from one query, so rows and totals always agree.
import type { SessionUser } from "./auth";
import { getDb } from "./db";
import type { Prisma } from "./generated/prisma/client";
import { minutesToHours, shiftMinutes } from "./shift-time";
import { shiftOrder, shiftSelect, toShiftDto, type ShiftDto } from "./shifts";

export type TimesheetShift = ShiftDto & { scheduledMinutes: number; scheduledHours: number };

export type Timesheet = {
  nurseId: string;
  nurseName: string;
  totalScheduledMinutes: number;
  totalScheduledHours: number;
  shifts: TimesheetShift[];
};

/** The filled shifts the caller may see, or null for none. */
function scope(user: SessionUser): Prisma.ShiftWhereInput | null {
  switch (user.role) {
    case "nurse":
      return { claimedById: user.id };
    case "agency":
      return user.agencyId ? { agencyId: user.agencyId } : null;
    case "admin":
      return {};
  }
}

/**
 * One timesheet per nurse with a filled shift in scope, by nurse name then id;
 * shifts by start. A nurse always gets exactly their own, 0 h if they hold none.
 */
export async function getTimesheets(user: SessionUser): Promise<Timesheet[]> {
  const where = scope(user);
  const rows = where
    ? await getDb().shift.findMany({
        where: { ...where, status: "filled" },
        select: { ...shiftSelect, claimedBy: { select: { name: true } } },
        orderBy: [...shiftOrder],
      })
    : [];

  const byNurse = new Map<string, Timesheet>();
  if (user.role === "nurse") byNurse.set(user.id, emptyTimesheet(user.id, user.name));
  for (const row of rows) {
    if (!row.claimedById || !row.claimedBy) continue; // a filled shift always has a claimant (CHECK)
    let sheet = byNurse.get(row.claimedById);
    if (!sheet) {
      sheet = emptyTimesheet(row.claimedById, row.claimedBy.name);
      byNurse.set(row.claimedById, sheet);
    }
    const minutes = shiftMinutes(row);
    sheet.shifts.push({ ...toShiftDto(row), scheduledMinutes: minutes, scheduledHours: minutesToHours(minutes) });
    sheet.totalScheduledMinutes += minutes;
  }

  const sheets = [...byNurse.values()];
  for (const sheet of sheets) sheet.totalScheduledHours = minutesToHours(sheet.totalScheduledMinutes);
  return sheets.sort((a, b) => a.nurseName.localeCompare(b.nurseName, "en") || compare(a.nurseId, b.nurseId));
}

function emptyTimesheet(nurseId: string, nurseName: string): Timesheet {
  return { nurseId, nurseName, totalScheduledMinutes: 0, totalScheduledHours: 0, shifts: [] };
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

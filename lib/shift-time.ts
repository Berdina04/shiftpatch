// Shift dates and times are facility-local (docs/spec.md); no timezone
// conversion. A DATE column comes back from Prisma as UTC midnight.

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** A YYYY-MM-DD date as the Date Prisma stores in a DATE column. */
export function dateOnly(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00.000Z`);
}

/** A DATE column value as YYYY-MM-DD. */
export function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * MS_PER_DAY);
}

/** True for a real calendar date written as YYYY-MM-DD (rejects 2026-02-30). */
export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value < "0001-01-01") return false;
  const parsed = dateOnly(value);
  return !Number.isNaN(parsed.getTime()) && isoDate(parsed) === value;
}

/** Today as a DATE value, UTC midnight (the spec defines no facility timezone). */
export function startOfTodayUtc(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** Today (UTC) as YYYY-MM-DD. */
export function todayIsoUtc(now = new Date()): string {
  return isoDate(startOfTodayUtc(now));
}

export type ShiftTimes = { date: Date; startTime: string; endTime: string };

function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/** endTime earlier than startTime means the shift ends the next day. */
export function isOvernight({ startTime, endTime }: Pick<ShiftTimes, "startTime" | "endTime">): boolean {
  return endTime < startTime;
}

/** The date the shift ends on (the next day for an overnight shift). */
export function shiftEndDate(shift: ShiftTimes): Date {
  return isOvernight(shift) ? addDays(shift.date, 1) : shift.date;
}

/** The shift as a half-open interval [start, end) in minutes. */
export function shiftInterval(shift: ShiftTimes): { start: number; end: number } {
  const dayStart = Math.round(shift.date.getTime() / 60_000);
  const start = dayStart + minutesOf(shift.startTime);
  const end = dayStart + minutesOf(shift.endTime) + (isOvernight(shift) ? 24 * 60 : 0);
  return { start, end };
}

/** Half-open intervals: a shift ending at 07:00 and one starting at 07:00 don't overlap (plan.md). */
export function shiftsOverlap(a: ShiftTimes, b: ShiftTimes): boolean {
  const x = shiftInterval(a);
  const y = shiftInterval(b);
  return x.start < y.end && y.start < x.end;
}

import { describe, expect, it } from "vitest";
import { dateOnly, isCalendarDate, isoDate, shiftEndDate, shiftsOverlap } from "@/lib/shift-time";

const shift = (date: string, startTime: string, endTime: string) => ({ date: dateOnly(date), startTime, endTime });

describe("shiftsOverlap (half-open [start, end))", () => {
  it("back-to-back shifts don't overlap: shift-1 ends 07:00 when shift-2 starts (spec example)", () => {
    expect(shiftsOverlap(shift("2026-10-02", "19:00", "07:00"), shift("2026-10-03", "07:00", "19:00"))).toBe(false);
  });

  it("a shift starting when another ends doesn't overlap", () => {
    expect(shiftsOverlap(shift("2026-10-03", "07:00", "19:00"), shift("2026-10-03", "19:00", "07:00"))).toBe(false);
  });

  it("one minute of overlap counts", () => {
    expect(shiftsOverlap(shift("2026-10-03", "07:00", "19:00"), shift("2026-10-03", "18:59", "23:00"))).toBe(true);
  });

  it("an overnight shift overlaps the next morning", () => {
    expect(shiftsOverlap(shift("2026-10-02", "22:00", "08:00"), shift("2026-10-03", "07:00", "19:00"))).toBe(true);
  });

  it("a shift inside another overlaps, in either order", () => {
    const outer = shift("2026-10-03", "07:00", "19:00");
    const inner = shift("2026-10-03", "10:00", "12:00");
    expect(shiftsOverlap(outer, inner)).toBe(true);
    expect(shiftsOverlap(inner, outer)).toBe(true);
  });

  it("same times on different days don't overlap", () => {
    expect(shiftsOverlap(shift("2026-10-03", "07:00", "19:00"), shift("2026-10-04", "07:00", "19:00"))).toBe(false);
  });
});

describe("shiftEndDate", () => {
  it("is the next day for an overnight shift", () => {
    expect(isoDate(shiftEndDate(shift("2026-12-31", "19:00", "07:00")))).toBe("2027-01-01");
  });
  it("is the same day otherwise", () => {
    expect(isoDate(shiftEndDate(shift("2026-12-31", "07:00", "19:00")))).toBe("2026-12-31");
  });
});

describe("isCalendarDate", () => {
  it.each(["2026-10-05", "2028-02-29"])("accepts %s", (d) => expect(isCalendarDate(d)).toBe(true));
  it.each(["2026-02-30", "2026-13-01", "10/05/2026", "2026-10-5", "0000-01-01", ""])("rejects %j", (d) =>
    expect(isCalendarDate(d)).toBe(false),
  );
});

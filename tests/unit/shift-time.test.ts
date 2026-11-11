import { describe, expect, it } from "vitest";
import {
  dateOnly,
  formatMinutes,
  isCalendarDate,
  isoDate,
  minutesToHours,
  shiftEndDate,
  shiftMinutes,
  shiftsOverlap,
} from "@/lib/shift-time";

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

describe("shiftMinutes (scheduled length)", () => {
  it("19:00–07:00 counts as 12 h: shift-1 and shift-3 are overnight (spec)", () => {
    expect(shiftMinutes(shift("2026-10-02", "19:00", "07:00"))).toBe(720);
  });
  it("07:00–19:00 is 12 h: shift-2 (spec)", () => {
    expect(shiftMinutes(shift("2026-10-03", "07:00", "19:00"))).toBe(720);
  });
  it.each([
    ["22:00", "06:30", 510],
    ["23:59", "00:00", 1],
    ["00:00", "23:59", 1439],
    ["07:01", "07:00", 1439],
  ])("%s–%s is %i minutes", (start, end, minutes) => expect(shiftMinutes(shift("2026-12-31", start, end))).toBe(minutes));
});

describe("minutesToHours", () => {
  it.each([
    [720, 12],
    [510, 8.5],
    [710, 11.83],
    [1, 0.02],
    [0, 0],
  ])("%i minutes → %d h", (minutes, hours) => expect(minutesToHours(minutes)).toBe(hours));
});

describe("formatMinutes", () => {
  it.each([
    [720, "12 h"],
    [1440, "24 h"],
    [690, "11 h 30 min"],
    [5, "0 h 5 min"],
    [0, "0 h"],
  ])("%i → %s", (minutes, text) => expect(formatMinutes(minutes)).toBe(text));
});

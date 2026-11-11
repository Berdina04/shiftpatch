// GET /api/timesheets (plan.md, Part 5): scheduled hours from filled shifts,
// scoped by role. Nurse: own; agency: its own shifts only, totals included;
// admin: every nurse. 401 without a token: route-auth.test.ts.
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db, resetToSeed } from "../support/db";
import { createNurse, createShift } from "../support/fixtures";
import { cancel, claim, EMAILS, timesheets, tokenFor } from "../support/http";
import { SEED_SHIFTS } from "../support/seed-expectations";

type Who = keyof typeof EMAILS;
const tokens = {} as Record<Who, string>;
beforeAll(async () => {
  await resetToSeed(); // logins need the seed users, whatever ran before
  for (const [who, email] of Object.entries(EMAILS)) tokens[who as Who] = await tokenFor(email);
});
beforeEach(resetToSeed);

type Sheet = {
  nurseId: string;
  nurseName: string;
  totalScheduledMinutes: number;
  totalScheduledHours: number;
  shifts: { id: string; agencyId: string; claimedBy: string; scheduledMinutes: number; scheduledHours: number }[];
};

async function sheetsFor(token: string): Promise<Sheet[]> {
  const res = await timesheets(token);
  expect(res.status).toBe(200);
  const body = (await res.json()) as { timesheets: Sheet[] };
  expect(Object.keys(body)).toStrictEqual(["timesheets"]);
  return body.timesheets;
}

/** Each nurse's shift ids and total minutes, for compact comparisons. */
const summary = (sheets: Sheet[]) =>
  sheets.map((s) => ({ nurseId: s.nurseId, shiftIds: s.shifts.map((x) => x.id), total: s.totalScheduledMinutes }));

const MARIA_AT_SEED = {
  nurseId: "nurse-1",
  nurseName: "Maria Lopez",
  totalScheduledMinutes: 720,
  totalScheduledHours: 12,
  shifts: [{ ...SEED_SHIFTS[1], scheduledMinutes: 720, scheduledHours: 12 }],
};

describe("GET /api/timesheets at the seed", () => {
  it("Maria: shift-2 (07:00–19:00) is 12 h, in the spec's shift shape plus the scheduled hours", async () => {
    expect(await sheetsFor(tokens.maria)).toStrictEqual([MARIA_AT_SEED]);
  });

  it("James holds nothing: his own timesheet, 0 h", async () => {
    expect(await sheetsFor(tokens.james)).toStrictEqual([
      { nurseId: "nurse-2", nurseName: "James Cook", totalScheduledMinutes: 0, totalScheduledHours: 0, shifts: [] },
    ]);
  });

  it("agency-a sees Maria on shift-2; agency-b has no filled shifts", async () => {
    expect(await sheetsFor(tokens.agencyA)).toStrictEqual([MARIA_AT_SEED]);
    expect(await sheetsFor(tokens.agencyB)).toStrictEqual([]);
  });

  it("the admin sees every nurse who holds a shift", async () => {
    expect(await sheetsFor(tokens.alex)).toStrictEqual([MARIA_AT_SEED]);
  });
});

describe("hours", () => {
  it("19:00–07:00 counts as 12 h: Maria claims the overnight shift-1 and has 24 h in total", async () => {
    expect((await claim(tokens.maria, "shift-1")).status).toBe(200);
    const [maria] = await sheetsFor(tokens.maria);
    expect(maria.shifts.map((s) => [s.id, s.scheduledMinutes, s.scheduledHours])).toStrictEqual([
      ["shift-1", 720, 12],
      ["shift-2", 720, 12],
    ]);
    expect([maria.totalScheduledMinutes, maria.totalScheduledHours]).toStrictEqual([1440, 24]);
  });

  it("keeps minutes exact and rounds hours to 2 decimals: 22:00–06:30 is 8.5 h, 07:10–19:00 is 11.83 h", async () => {
    const nurse = await createNurse();
    const overnight = await createShift({ date: "2026-12-01", startTime: "22:00", endTime: "06:30" });
    const day = await createShift({ date: "2026-12-03", startTime: "07:10", endTime: "19:00" });
    for (const id of [overnight, day]) expect((await claim(nurse.token, id)).status).toBe(200);

    const [sheet] = await sheetsFor(nurse.token);
    expect(sheet.shifts.map((s) => [s.id, s.scheduledMinutes, s.scheduledHours])).toStrictEqual([
      [overnight, 510, 8.5],
      [day, 710, 11.83],
    ]);
    expect([sheet.totalScheduledMinutes, sheet.totalScheduledHours]).toStrictEqual([1220, 20.33]);
  });

  it("past and upcoming filled shifts both count", async () => {
    const nurse = await createNurse();
    const upcoming = await createShift({ date: "2027-03-01", startTime: "07:00", endTime: "15:00" });
    expect((await claim(nurse.token, "shift-3")).status).toBe(200); // 2026-10-04, before the pinned today
    expect((await claim(nurse.token, upcoming)).status).toBe(200);
    expect(summary(await sheetsFor(nurse.token))).toStrictEqual([{ nurseId: nurse.id, shiftIds: ["shift-3", upcoming], total: 720 + 480 }]);
  });

  it("a cancelled shift drops out: after agency-a marks shift-2 a no-show, Maria has 0 h", async () => {
    expect((await cancel(tokens.agencyA, "shift-2", { reason: "no-show" })).status).toBe(200);
    expect(summary(await sheetsFor(tokens.maria))).toStrictEqual([{ nurseId: "nurse-1", shiftIds: [], total: 0 }]);
    expect(await sheetsFor(tokens.agencyA)).toStrictEqual([]);
    expect(await sheetsFor(tokens.alex)).toStrictEqual([]);
  });
});

describe("scope", () => {
  it("an agency's totals count only its own shifts: Maria's agency-b hours never show up at agency-a", async () => {
    expect((await claim(tokens.maria, "shift-3")).status).toBe(200); // agency-b, 19:00–07:00

    expect(summary(await sheetsFor(tokens.agencyA))).toStrictEqual([{ nurseId: "nurse-1", shiftIds: ["shift-2"], total: 720 }]);
    expect(summary(await sheetsFor(tokens.agencyB))).toStrictEqual([{ nurseId: "nurse-1", shiftIds: ["shift-3"], total: 720 }]);
    // Maria herself and the admin see both agencies' hours.
    expect(summary(await sheetsFor(tokens.maria))).toStrictEqual([{ nurseId: "nurse-1", shiftIds: ["shift-2", "shift-3"], total: 1440 }]);
    expect(summary(await sheetsFor(tokens.alex))).toStrictEqual([{ nurseId: "nurse-1", shiftIds: ["shift-2", "shift-3"], total: 1440 }]);
  });

  it("every shift an agency sees is its own, for every nurse", async () => {
    const nurse = await createNurse();
    const bShift = await createShift({ date: "2026-12-05", startTime: "07:00", endTime: "19:00", agencyId: "agency-b" });
    expect((await claim(nurse.token, "shift-1")).status).toBe(200);
    expect((await claim(nurse.token, bShift)).status).toBe(200);

    for (const [who, agencyId] of [["agencyA", "agency-a"], ["agencyB", "agency-b"]] as const) {
      const sheets = await sheetsFor(tokens[who]);
      const shifts = sheets.flatMap((s) => s.shifts);
      expect(shifts.length).toBeGreaterThan(0);
      for (const s of shifts) expect(s.agencyId).toBe(agencyId);
      for (const s of sheets) expect(s.totalScheduledMinutes).toBe(s.shifts.reduce((sum, x) => sum + x.scheduledMinutes, 0));
    }
    expect(summary(await sheetsFor(tokens.agencyB))).toStrictEqual([{ nurseId: nurse.id, shiftIds: [bShift], total: 720 }]);
  });

  it("a nurse sees only their own shifts, never another nurse's", async () => {
    const nurse = await createNurse();
    expect((await claim(nurse.token, "shift-1")).status).toBe(200);
    expect(summary(await sheetsFor(tokens.maria))).toStrictEqual([{ nurseId: "nurse-1", shiftIds: ["shift-2"], total: 720 }]);
    expect(summary(await sheetsFor(nurse.token))).toStrictEqual([{ nurseId: nurse.id, shiftIds: ["shift-1"], total: 720 }]);
    expect(summary(await sheetsFor(tokens.james))).toStrictEqual([{ nurseId: "nurse-2", shiftIds: [], total: 0 }]);
  });

  it("the admin sees every nurse, by name, each with their shifts by start", async () => {
    const nurse = await createNurse(); // "Test Nurse <n>" sorts after "Maria Lopez"
    const early = await createShift({ date: "2026-09-01", startTime: "07:00", endTime: "19:00", agencyId: "agency-b" });
    expect((await claim(nurse.token, "shift-1")).status).toBe(200);
    expect((await claim(nurse.token, early)).status).toBe(200);
    expect(summary(await sheetsFor(tokens.alex))).toStrictEqual([
      { nurseId: "nurse-1", shiftIds: ["shift-2"], total: 720 },
      { nurseId: nurse.id, shiftIds: [early, "shift-1"], total: 1440 },
    ]);
  });

  it("the role and agency come from the database: an agency login with no agency sees nothing", async () => {
    await db().user.update({ where: { id: "agency-a" }, data: { agencyId: null } });
    expect(await sheetsFor(tokens.agencyA)).toStrictEqual([]);
  });
});

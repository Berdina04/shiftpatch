// Every Part 2, 3 and 5 route × every seed role (plan.md, "Verified by:
// Permissions"); for cancel, also × each reason. Timesheet scoping (what
// each role sees, not whether it may ask): timesheets.test.ts.
// 401 without a token is covered for every route by route-auth.test.ts.
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db, resetToSeed } from "../support/db";
import { cancellationRows } from "../support/fixtures";
import { adminDashboard, agencyShifts, cancel, claim, EMAILS, listShifts, postShift, timesheets, tokenFor } from "../support/http";

type Who = keyof typeof EMAILS;
const tokens = {} as Record<Who, string>;
beforeAll(async () => {
  await resetToSeed(); // logins need the seed users, whatever ran before
  for (const [who, email] of Object.entries(EMAILS)) tokens[who as Who] = await tokenFor(email);
});
beforeEach(resetToSeed);

const OK = null;
const NOT_AGENCY = "Only agencies can post shifts";
const NOT_NURSE = "Only nurses can claim shifts";
const NOT_OWN = "You can only view your own agency's shifts";
const EXPIRED = "Credential expired, cannot claim shift";
const NURSE_NO_SHOW = "Nurses can only cancel in advance";
const OTHER_AGENCY = "You can only cancel your own agency's shifts";
const NOT_YOURS = "You can only cancel your own shifts";
const NOT_CLAIMED = "Shift is not claimed";
const NOT_ADMIN = "Only the admin can view the dashboard";

/** Gives agency-b a claimed shift: Maria holds shift-3. */
async function mariaHoldsShift3() {
  await db().shift.update({ where: { id: "shift-3" }, data: { status: "filled", claimedById: "nurse-1" } });
}

type Row = { route: string; call: (token: string) => Promise<Response>; expected: Record<Who, [number, string | null]> };

const matrix: Row[] = [
  {
    route: "GET /api/shifts",
    call: (t) => listShifts(t),
    expected: { agencyA: [200, OK], agencyB: [200, OK], maria: [200, OK], james: [200, OK], alex: [200, OK] },
  },
  {
    route: "POST /api/shifts",
    call: (t) => postShift(t),
    expected: { agencyA: [201, OK], agencyB: [201, OK], maria: [403, NOT_AGENCY], james: [403, NOT_AGENCY], alex: [403, NOT_AGENCY] },
  },
  {
    route: "POST /api/shifts/shift-1/claim",
    call: (t) => claim(t, "shift-1"),
    expected: { agencyA: [403, NOT_NURSE], agencyB: [403, NOT_NURSE], maria: [200, OK], james: [403, EXPIRED], alex: [403, NOT_NURSE] },
  },
  {
    route: "GET /api/agencies/agency-a/shifts",
    call: (t) => agencyShifts(t, "agency-a"),
    expected: { agencyA: [200, OK], agencyB: [403, NOT_OWN], maria: [403, NOT_OWN], james: [403, NOT_OWN], alex: [200, OK] },
  },
  {
    route: "GET /api/agencies/agency-b/shifts",
    call: (t) => agencyShifts(t, "agency-b"),
    expected: { agencyA: [403, NOT_OWN], agencyB: [200, OK], maria: [403, NOT_OWN], james: [403, NOT_OWN], alex: [200, OK] },
  },
  // Cancel (plan.md, product rules): nurse own claim + advance only; agency own
  // shifts, either reason; admin any shift, either reason. shift-2 is
  // agency-a's, held by Maria.
  {
    route: "POST /api/shifts/shift-2/cancel no-show",
    call: (t) => cancel(t, "shift-2", { reason: "no-show" }),
    expected: { agencyA: [200, OK], agencyB: [403, OTHER_AGENCY], maria: [403, NURSE_NO_SHOW], james: [403, NURSE_NO_SHOW], alex: [200, OK] },
  },
  {
    route: "POST /api/shifts/shift-2/cancel advance",
    call: (t) => cancel(t, "shift-2", { reason: "advance" }),
    expected: { agencyA: [200, OK], agencyB: [403, OTHER_AGENCY], maria: [200, OK], james: [403, NOT_YOURS], alex: [200, OK] },
  },
  {
    route: "POST /api/shifts/shift-3/cancel no-show (agency-b's, held by Maria)",
    call: async (t) => {
      await mariaHoldsShift3();
      return cancel(t, "shift-3", { reason: "no-show" });
    },
    expected: { agencyA: [403, OTHER_AGENCY], agencyB: [200, OK], maria: [403, NURSE_NO_SHOW], james: [403, NURSE_NO_SHOW], alex: [200, OK] },
  },
  {
    route: "POST /api/shifts/shift-3/cancel advance (agency-b's, held by Maria)",
    call: async (t) => {
      await mariaHoldsShift3();
      return cancel(t, "shift-3", { reason: "advance" });
    },
    expected: { agencyA: [403, OTHER_AGENCY], agencyB: [200, OK], maria: [200, OK], james: [403, NOT_YOURS], alex: [200, OK] },
  },
  {
    route: "POST /api/shifts/shift-1/cancel advance (open)",
    call: (t) => cancel(t, "shift-1", { reason: "advance" }),
    expected: { agencyA: [409, NOT_CLAIMED], agencyB: [403, OTHER_AGENCY], maria: [409, NOT_CLAIMED], james: [409, NOT_CLAIMED], alex: [409, NOT_CLAIMED] },
  },
  {
    route: "GET /api/admin/dashboard",
    call: (t) => adminDashboard(t),
    expected: { agencyA: [403, NOT_ADMIN], agencyB: [403, NOT_ADMIN], maria: [403, NOT_ADMIN], james: [403, NOT_ADMIN], alex: [200, OK] },
  },
  // Timesheets (plan.md, Part 5): every role may read its own scope.
  {
    route: "GET /api/timesheets",
    call: (t) => timesheets(t),
    expected: { agencyA: [200, OK], agencyB: [200, OK], maria: [200, OK], james: [200, OK], alex: [200, OK] },
  },
];

const cases = matrix.flatMap((row) =>
  (Object.keys(row.expected) as Who[]).map((who) => [row.route, who, row.expected[who], row.call] as const),
);

describe("permissions: route × role", () => {
  it.each(cases)("%s as %s → %j", async (_route, who, [status, error], call) => {
    const res = await call(tokens[who]);
    expect(res.status).toBe(status);
    if (error) expect(await res.json()).toStrictEqual({ error });
  });

  it("a denied post, claim or cancel changes nothing", async () => {
    await postShift(tokens.maria);
    await claim(tokens.agencyA, "shift-1");
    await claim(tokens.alex, "shift-1");
    await cancel(tokens.agencyB, "shift-2", { reason: "no-show" });
    await cancel(tokens.maria, "shift-2", { reason: "no-show" });
    await cancel(tokens.james, "shift-2", { reason: "advance" });
    expect(await db().shift.count()).toBe(3);
    expect((await db().shift.findUniqueOrThrow({ where: { id: "shift-1" } })).status).toBe("open");
    const shift2 = await db().shift.findUniqueOrThrow({ where: { id: "shift-2" } });
    expect([shift2.status, shift2.claimedById]).toStrictEqual(["filled", "nurse-1"]);
    expect(await cancellationRows()).toStrictEqual([]);
    expect(await db().auditLog.count()).toBe(0);
  });

  it("the role comes from the database, not the token", async () => {
    await db().user.update({ where: { id: "agency-a" }, data: { role: "nurse" } });
    const res = await postShift(tokens.agencyA);
    expect(res.status).toBe(403);
    expect(await res.json()).toStrictEqual({ error: NOT_AGENCY });
  });
});

// Every Part 2 route × every seed role (plan.md, "Verified by: Permissions").
// 401 without a token is covered for every route by route-auth.test.ts.
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db, resetToSeed } from "../support/db";
import { agencyShifts, claim, EMAILS, listShifts, postShift, tokenFor } from "../support/http";

type Who = keyof typeof EMAILS;
const tokens = {} as Record<Who, string>;
beforeAll(async () => {
  for (const [who, email] of Object.entries(EMAILS)) tokens[who as Who] = await tokenFor(email);
});
beforeEach(resetToSeed);

const OK = null;
const NOT_AGENCY = "Only agencies can post shifts";
const NOT_NURSE = "Only nurses can claim shifts";
const NOT_OWN = "You can only view your own agency's shifts";
const EXPIRED = "Credential expired, cannot claim shift";

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

  it("a denied post or claim changes nothing", async () => {
    await postShift(tokens.maria);
    await claim(tokens.agencyA, "shift-1");
    await claim(tokens.alex, "shift-1");
    expect(await db().shift.count()).toBe(3);
    expect((await db().shift.findUniqueOrThrow({ where: { id: "shift-1" } })).status).toBe("open");
    expect(await db().auditLog.count()).toBe(0);
  });

  it("the role comes from the database, not the token", async () => {
    await db().user.update({ where: { id: "agency-a" }, data: { role: "nurse" } });
    const res = await postShift(tokens.agencyA);
    expect(res.status).toBe(403);
    expect(await res.json()).toStrictEqual({ error: NOT_AGENCY });
  });
});

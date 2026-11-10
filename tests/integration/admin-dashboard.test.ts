// GET /api/admin/dashboard: the admin's shift table (with the "reopened (…)"
// marker) and audit log. Admin-only: permissions.test.ts.
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AUDIT_LOG_LIMIT } from "@/lib/admin";
import { db, resetToSeed } from "../support/db";
import { createNurse } from "../support/fixtures";
import { adminDashboard, cancel, claim, EMAILS, postShift, tokenFor } from "../support/http";
import { SEED_SHIFTS } from "../support/seed-expectations";

let alex: string;
let agencyA: string;
let maria: string;
beforeAll(async () => {
  await resetToSeed(); // logins need the seed users, whatever ran before
  alex = await tokenFor(EMAILS.alex);
  agencyA = await tokenFor(EMAILS.agencyA);
  maria = await tokenFor(EMAILS.maria);
});
beforeEach(resetToSeed);

type Dashboard = {
  shifts: { id: string; status: string; claimedBy: string | null; claimedByName: string | null; lastCancellation: unknown }[];
  auditLog: { id: string; createdAt: string; action: string; actorId: string; shiftId: string; details: unknown }[];
};

async function dashboard(): Promise<Dashboard> {
  const res = await adminDashboard(alex);
  expect(res.status).toBe(200);
  return res.json();
}

const shift = (d: Dashboard, id: string) => d.shifts.find((s) => s.id === id);

describe("GET /api/admin/dashboard", () => {
  it("at the seed: every shift with its claimant's name, no markers, an empty audit log", async () => {
    expect(await dashboard()).toStrictEqual({
      shifts: SEED_SHIFTS.map((s) => ({
        ...s,
        claimedByName: s.claimedBy ? "Maria Lopez" : null,
        lastCancellation: null,
      })),
      auditLog: [],
    });
  });

  it("the marker is the latest cancellation, and stays after the shift is claimed again", async () => {
    await cancel(agencyA, "shift-2", { reason: "no-show" });
    expect(shift(await dashboard(), "shift-2")).toMatchObject({
      status: "open",
      claimedBy: null,
      claimedByName: null,
      lastCancellation: { reason: "no-show", previousNurseId: "nurse-1", cancelledAt: expect.any(String) },
    });

    const other = await createNurse();
    await claim(other.token, "shift-2");
    expect(shift(await dashboard(), "shift-2")).toMatchObject({
      status: "filled",
      claimedBy: other.id,
      claimedByName: expect.stringMatching(/^Test Nurse /),
      lastCancellation: { reason: "no-show", previousNurseId: "nurse-1" },
    });

    await cancel(alex, "shift-2", { reason: "advance" });
    expect(shift(await dashboard(), "shift-2")).toMatchObject({
      status: "open",
      lastCancellation: { reason: "advance", previousNurseId: other.id },
    });
  });

  it("lists audit entries newest first, with their details", async () => {
    await postShift(agencyA);
    await claim(maria, "shift-1");
    await cancel(agencyA, "shift-2", { reason: "no-show" });

    const { auditLog } = await dashboard();
    expect(auditLog.map((e) => [e.action, e.actorId, e.shiftId])).toStrictEqual([
      ["shift.cancelled", "agency-a", "shift-2"],
      ["shift.claimed", "nurse-1", "shift-1"],
      ["shift.posted", "agency-a", "shift-4"],
    ]);
    expect(auditLog[0]).toStrictEqual({
      id: expect.stringMatching(/^\d+$/),
      createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      actorId: "agency-a",
      actorRole: "agency",
      action: "shift.cancelled",
      shiftId: "shift-2",
      details: { reason: "no-show", previousNurseId: "nurse-1", status: { from: "filled", to: "open" } },
    });
  });

  it(`returns the newest ${AUDIT_LOG_LIMIT} audit entries only`, async () => {
    await db().auditLog.createMany({
      data: Array.from({ length: AUDIT_LOG_LIMIT + 5 }, (_, i) => ({
        actorId: "agency-a",
        actorRole: "agency" as const,
        action: "shift.posted",
        shiftId: `shift-${1000 + i}`,
        details: {},
      })),
    });

    const { auditLog } = await dashboard();
    expect(auditLog).toHaveLength(AUDIT_LOG_LIMIT);
    expect(auditLog[0].shiftId).toBe(`shift-${1000 + AUDIT_LOG_LIMIT + 4}`);
    expect(auditLog.at(-1)?.shiftId).toBe("shift-1005");
  });
});

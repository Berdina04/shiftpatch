// GET /api/admin/dashboard: the admin's shift table (with the "reopened (…)"
// marker) and audit log. Admin-only: permissions.test.ts.
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AUDIT_LOG_LIMIT } from "@/lib/admin";
import { db, resetToSeed } from "../support/db";
import { createNurse } from "../support/fixtures";
import { adminDashboard, cancel, claim, EMAILS, postShift, tokenFor } from "../support/http";
import { untilSomeoneWaitsForALock } from "../support/locks";
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
  shifts: { id: string; status: string; claimedBy: string | null }[];
  shiftDetails: Record<string, { claimedByName: string | null; lastCancellation: unknown }>;
  auditLog: { id: string; createdAt: string; action: string; actorId: string; shiftId: string; details: unknown }[];
};

function dashboardFrom(res: Response): Promise<Dashboard> {
  expect(res.status).toBe(200);
  return res.json();
}

const dashboard = async () => dashboardFrom(await adminDashboard(alex));

const SHIFT_KEYS = ["agencyId", "agencyName", "claimedBy", "date", "endTime", "id", "role", "startTime", "status"];

describe("GET /api/admin/dashboard", () => {
  it("at the seed: the spec's shifts, each one's claimant name and no marker, an empty audit log", async () => {
    expect(await dashboard()).toStrictEqual({
      shifts: SEED_SHIFTS,
      shiftDetails: {
        "shift-1": { claimedByName: null, lastCancellation: null },
        "shift-2": { claimedByName: "Maria Lopez", lastCancellation: null },
        "shift-3": { claimedByName: null, lastCancellation: null },
      },
      auditLog: [],
    });
  });

  it("keeps every shift in the spec's shape, also after a cancellation", async () => {
    await cancel(agencyA, "shift-2", { reason: "no-show" });
    const { shifts, shiftDetails } = await dashboard();
    for (const s of shifts) expect(Object.keys(s).sort()).toStrictEqual(SHIFT_KEYS);
    expect(Object.keys(shiftDetails).sort()).toStrictEqual(shifts.map((s) => s.id).sort());
  });

  it("the marker is the latest cancellation, and stays after the shift is claimed again", async () => {
    await cancel(agencyA, "shift-2", { reason: "no-show" });
    let d = await dashboard();
    expect(d.shifts.find((s) => s.id === "shift-2")).toMatchObject({ status: "open", claimedBy: null });
    expect(d.shiftDetails["shift-2"]).toStrictEqual({
      claimedByName: null,
      lastCancellation: { reason: "no-show", previousNurseId: "nurse-1", cancelledAt: expect.any(String) },
    });

    const other = await createNurse();
    await claim(other.token, "shift-2");
    d = await dashboard();
    expect(d.shifts.find((s) => s.id === "shift-2")).toMatchObject({ status: "filled", claimedBy: other.id });
    expect(d.shiftDetails["shift-2"]).toMatchObject({
      claimedByName: expect.stringMatching(/^Test Nurse /),
      lastCancellation: { reason: "no-show", previousNurseId: "nurse-1" },
    });

    await cancel(alex, "shift-2", { reason: "advance" });
    expect((await dashboard()).shiftDetails["shift-2"]).toMatchObject({
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
      credentialId: null,
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

  it("a cancellation that commits between the shift read and the audit read shows up in all of it or none of it", async () => {
    // The test locks the audit table, so the dashboard's audit read waits after
    // its shift read. While it waits, the test commits a cancellation of
    // shift-2 (the same writes the route makes), then releases the lock.
    let pending: Promise<Response> | undefined;
    await db().$transaction(
      async (tx) => {
        await tx.$executeRaw`LOCK TABLE "AuditLog" IN ACCESS EXCLUSIVE MODE`;
        pending = adminDashboard(alex);
        await untilSomeoneWaitsForALock();
        await tx.$executeRaw`UPDATE "Shift" SET "status" = 'open', "claimedById" = NULL WHERE "id" = 'shift-2'`;
        await tx.shiftCancellation.create({
          data: { shiftId: "shift-2", reason: "no-show", previousNurseId: "nurse-1", cancelledById: "agency-a", cancelledByRole: "agency" },
        });
        await tx.auditLog.create({
          data: { actorId: "agency-a", actorRole: "agency", action: "shift.cancelled", shiftId: "shift-2", details: {} },
        });
      },
      { timeout: 15_000 },
    );
    const d = await dashboardFrom(await pending!);

    const shift2 = d.shifts.find((s) => s.id === "shift-2");
    const view = {
      status: shift2?.status,
      marker: d.shiftDetails["shift-2"].lastCancellation !== null,
      audited: d.auditLog.some((e) => e.action === "shift.cancelled"),
    };
    // One snapshot: before the cancellation (the shift read came first).
    expect(view).toStrictEqual({ status: "filled", marker: false, audited: false });
    // The cancellation itself committed.
    expect((await dashboard()).shiftDetails["shift-2"].lastCancellation).not.toBeNull();
  });
});

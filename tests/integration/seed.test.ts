import { beforeEach, describe, expect, it } from "vitest";
import { seedDatabase } from "@/prisma/seed-data";
import { db, resetToSeed } from "../support/db";

beforeEach(resetToSeed);

const day = (d: Date) => d.toISOString().slice(0, 10);

describe("seed", () => {
  it("loads the spec's sample data exactly", async () => {
    const agencies = await db().agency.findMany({ orderBy: { id: "asc" } });
    expect(agencies).toStrictEqual([
      { id: "agency-a", name: "Sunrise Health Staffing" },
      { id: "agency-b", name: "Metro Care Partners" },
    ]);

    const users = await db().user.findMany({
      select: { id: true, email: true, name: true, role: true, agencyId: true },
      orderBy: { id: "asc" },
    });
    expect(users).toStrictEqual([
      { id: "admin-1", email: "alex.kim@example.com", name: "Alex Kim", role: "admin", agencyId: null },
      { id: "agency-a", email: "admin@sunrisehealth.example", name: "Sunrise Health Staffing", role: "agency", agencyId: "agency-a" },
      { id: "agency-b", email: "admin@metrocare.example", name: "Metro Care Partners", role: "agency", agencyId: "agency-b" },
      { id: "nurse-1", email: "maria.lopez@example.com", name: "Maria Lopez", role: "nurse", agencyId: null },
      { id: "nurse-2", email: "james.cook@example.com", name: "James Cook", role: "nurse", agencyId: null },
    ]);

    const credentials = await db().credential.findMany({ orderBy: { nurseId: "asc" } });
    expect(credentials.map((c) => [c.nurseId, day(c.expiresOn), c.status])).toStrictEqual([
      ["nurse-1", "2027-01-01", "approved"],
      ["nurse-2", "2026-06-01", "approved"],
    ]);

    const shifts = await db().shift.findMany({ orderBy: { id: "asc" } });
    expect(
      shifts.map((s) => [s.id, s.agencyId, s.role, day(s.date), s.startTime, s.endTime, s.status, s.claimedById]),
    ).toStrictEqual([
      ["shift-1", "agency-a", "RN", "2026-10-02", "19:00", "07:00", "open", null],
      ["shift-2", "agency-a", "LPN", "2026-10-03", "07:00", "19:00", "filled", "nurse-1"],
      ["shift-3", "agency-b", "RN", "2026-10-04", "19:00", "07:00", "open", null],
    ]);
  });

  it("only inserts missing rows, so re-running it never undoes changes", async () => {
    await db().shift.update({ where: { id: "shift-1" }, data: { status: "filled", claimedById: "nurse-1" } });
    await db().shift.delete({ where: { id: "shift-3" } });

    await seedDatabase(db());

    const shift1 = await db().shift.findUniqueOrThrow({ where: { id: "shift-1" } });
    expect([shift1.status, shift1.claimedById]).toStrictEqual(["filled", "nurse-1"]);
    expect(await db().shift.count({ where: { id: "shift-3" } })).toBe(1);
  });

  it("reset restores trial-start data", async () => {
    await db().shift.update({ where: { id: "shift-1" }, data: { status: "filled", claimedById: "nurse-1" } });
    await resetToSeed();
    const shift1 = await db().shift.findUniqueOrThrow({ where: { id: "shift-1" } });
    expect([shift1.status, shift1.claimedById]).toStrictEqual(["open", null]);
  });

  it("the database rejects a filled shift without a claimant", async () => {
    await expect(
      db().shift.update({ where: { id: "shift-1" }, data: { status: "filled" } }),
    ).rejects.toThrow(/Shift_claim_matches_status/);
  });
});

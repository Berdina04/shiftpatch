import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db, resetToSeed } from "../support/db";
import { auditRows, createNurse, createShift, daysFromToday, shiftRow } from "../support/fixtures";
import { claim, EMAILS, tokenFor } from "../support/http";
import { SEED_SHIFTS } from "../support/seed-expectations";

let maria: string;
let james: string;
beforeAll(async () => {
  maria = await tokenFor(EMAILS.maria);
  james = await tokenFor(EMAILS.james);
});
beforeEach(resetToSeed);

async function expectError(res: Response, status: number, error: string) {
  expect(res.status).toBe(status);
  expect(await res.json()).toStrictEqual({ error });
}

describe("POST /api/shifts/:id/claim", () => {
  it("Maria claims shift-1 and gets the spec's 200 response", async () => {
    const res = await claim(maria, "shift-1");

    expect(res.status).toBe(200);
    expect(await res.json()).toStrictEqual({
      id: "shift-1",
      agencyId: "agency-a",
      agencyName: "Sunrise Health Staffing",
      role: "RN",
      date: "2026-10-02",
      startTime: "19:00",
      endTime: "07:00",
      status: "filled",
      claimedBy: "nurse-1",
    });
    expect(await shiftRow("shift-1")).toStrictEqual({ status: "filled", claimedBy: "nurse-1" });
  });

  it("writes a shift.claimed audit entry with the claim", async () => {
    await claim(maria, "shift-1");
    expect(await auditRows()).toStrictEqual([
      {
        actorId: "nurse-1",
        actorRole: "nurse",
        action: "shift.claimed",
        shiftId: "shift-1",
        details: { status: { from: "open", to: "filled" }, claimedBy: "nurse-1" },
      },
    ]);
  });

  it("James (expired credential) gets the spec's 403 and nothing changes", async () => {
    await expectError(await claim(james, "shift-1"), 403, "Credential expired, cannot claim shift");
    expect(await shiftRow("shift-1")).toStrictEqual({ status: "open", claimedBy: null });
    expect(await auditRows()).toStrictEqual([]);
  });

  it("an unknown shift is 404", async () => {
    await expectError(await claim(maria, "shift-999"), 404, "Shift not found");
  });

  it("a filled shift is 409 'Shift already taken', even for the nurse who holds it", async () => {
    await expectError(await claim(maria, "shift-2"), 409, "Shift already taken");
    const other = await createNurse();
    await expectError(await claim(other.token, "shift-2"), 409, "Shift already taken");
    expect(await shiftRow("shift-2")).toStrictEqual({ status: "filled", claimedBy: "nurse-1" });
  });

  describe("check order: 404 → credential 403 → taken 409 → overlap 409 (plan.md)", () => {
    it("unknown shift beats credential", async () => {
      await expectError(await claim(james, "shift-999"), 404, "Shift not found");
    });

    it("credential beats taken", async () => {
      await expectError(await claim(james, "shift-2"), 403, "Credential expired, cannot claim shift");
    });

    it("taken beats overlap", async () => {
      const other = await createNurse();
      const id = await createShift({ date: "2026-10-03", startTime: "08:00", endTime: "12:00" });
      await claim(other.token, id);
      // Maria holds shift-2 (07:00–19:00), which overlaps, and the shift is taken.
      await expectError(await claim(maria, id), 409, "Shift already taken");
    });
  });

  describe("overlap", () => {
    it("rejects a shift that overlaps one the nurse holds, even at another agency", async () => {
      const id = await createShift({ agencyId: "agency-b", date: "2026-10-03", startTime: "18:00", endTime: "23:00" });
      await expectError(await claim(maria, id), 409, "Shift overlaps another shift you hold");
      expect(await shiftRow(id)).toStrictEqual({ status: "open", claimedBy: null });
    });

    it("rejects an overnight shift from the day before that runs into a held shift", async () => {
      const id = await createShift({ date: "2026-10-02", startTime: "22:00", endTime: "08:00" });
      await expectError(await claim(maria, id), 409, "Shift overlaps another shift you hold");
    });

    it("allows a shift that starts when a held one ends", async () => {
      const id = await createShift({ date: "2026-10-03", startTime: "19:00", endTime: "23:00" });
      expect((await claim(maria, id)).status).toBe(200);
    });

    it("ignores shifts held by other nurses", async () => {
      const other = await createNurse();
      const id = await createShift({ date: "2026-10-03", startTime: "07:00", endTime: "19:00" });
      expect((await claim(other.token, id)).status).toBe(200);
    });
  });

  describe("credentials", () => {
    const pastShift = () => createShift({ date: "2026-10-10", startTime: "07:00", endTime: "19:00" });

    it("no credential at all is 403 'No approved credential'", async () => {
      const nurse = await createNurse([]);
      await expectError(await claim(nurse.token, "shift-1"), 403, "No approved credential, cannot claim shift");
    });

    it.each(["pending", "rejected"] as const)("a %s credential doesn't count", async (status) => {
      const nurse = await createNurse([{ status, expiresOn: "2099-01-01" }]);
      await expectError(await claim(nurse.token, "shift-1"), 403, "No approved credential, cannot claim shift");
    });

    it("a pending upload doesn't cancel an approved, valid credential", async () => {
      const nurse = await createNurse([
        { status: "approved", expiresOn: "2099-01-01" },
        { status: "pending", expiresOn: "2030-01-01" },
      ]);
      expect((await claim(nurse.token, "shift-1")).status).toBe(200);
    });

    it("any approved, valid credential counts, alongside an expired one", async () => {
      const nurse = await createNurse([
        { status: "approved", expiresOn: "2026-01-01" },
        { status: "approved", expiresOn: "2099-01-01" },
      ]);
      expect((await claim(nurse.token, "shift-1")).status).toBe(200);
    });

    it("must be valid today: expiring today is expired, even for a past shift", async () => {
      const nurse = await createNurse([{ status: "approved", expiresOn: daysFromToday(0) }]);
      await expectError(await claim(nurse.token, await pastShift()), 403, "Credential expired, cannot claim shift");
    });

    it("expiring tomorrow is valid for a past shift", async () => {
      const nurse = await createNurse([{ status: "approved", expiresOn: daysFromToday(1) }]);
      expect((await claim(nurse.token, await pastShift())).status).toBe(200);
    });

    it("must be valid through the end of an overnight shift (expiry date itself is not valid)", async () => {
      // Maria's credential expires 2027-01-01; this shift ends 2027-01-01 07:00.
      const overnight = await createShift({ date: "2026-12-31", startTime: "19:00", endTime: "07:00" });
      await expectError(await claim(maria, overnight), 403, "Credential expired, cannot claim shift");
      const dayShift = await createShift({ date: "2026-12-31", startTime: "07:00", endTime: "19:00" });
      expect((await claim(maria, dayShift)).status).toBe(200);
    });
  });

  it("leaves the other seed shifts alone", async () => {
    await claim(maria, "shift-1");
    const rows = await db().shift.findMany({ where: { id: { in: ["shift-2", "shift-3"] } }, orderBy: { id: "asc" } });
    expect(rows.map((r) => [r.id, r.status, r.claimedById])).toStrictEqual(
      [SEED_SHIFTS[1], SEED_SHIFTS[2]].map((s) => [s.id, s.status, s.claimedBy]),
    );
  });
});

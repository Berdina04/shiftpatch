import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db, resetToSeed } from "../support/db";
import { auditRows } from "../support/fixtures";
import { agencyShifts, EMAILS, listShifts, postShift, postShiftRaw, SPEC_NEW_SHIFT, tokenFor } from "../support/http";

let agencyA: string;
let agencyB: string;
beforeAll(async () => {
  agencyA = await tokenFor(EMAILS.agencyA);
  agencyB = await tokenFor(EMAILS.agencyB);
});
beforeEach(resetToSeed);

describe("POST /api/shifts", () => {
  it("creates an open shift for the caller's agency in the spec shape (201)", async () => {
    const res = await postShift(agencyA, SPEC_NEW_SHIFT);

    expect(res.status).toBe(201);
    expect(await res.json()).toStrictEqual({
      id: "shift-4",
      agencyId: "agency-a",
      agencyName: "Sunrise Health Staffing",
      role: "RN",
      date: "2026-10-05",
      startTime: "07:00",
      endTime: "19:00",
      status: "open",
      claimedBy: null,
    });
  });

  it("numbers new shifts shift-<n> in order", async () => {
    const ids = [];
    for (const token of [agencyA, agencyB, agencyA]) ids.push((await (await postShift(token)).json()).id);
    expect(ids).toStrictEqual(["shift-4", "shift-5", "shift-6"]);
  });

  it("shows the new shift in GET /api/shifts and in the agency's own list", async () => {
    await postShift(agencyB, { role: "LPN", date: "2026-12-01", startTime: "19:00", endTime: "07:00" });

    const all = (await (await listShifts(agencyA)).json()).shifts;
    expect(all.map((s: { id: string }) => s.id)).toContain("shift-4");
    const own = (await (await agencyShifts(agencyB, "agency-b")).json()).shifts;
    expect(own.map((s: { id: string }) => s.id)).toStrictEqual(["shift-3", "shift-4"]);
  });

  it("scopes the shift to the caller's agency even if the body names another", async () => {
    const res = await postShift(agencyA, { ...SPEC_NEW_SHIFT, agencyId: "agency-b" });
    expect((await res.json()).agencyId).toBe("agency-a");
  });

  it("accepts an overnight shift (end before start)", async () => {
    const res = await postShift(agencyA, { role: "LPN", date: "2026-10-05", startTime: "19:00", endTime: "07:00" });
    expect(res.status).toBe(201);
  });

  it("writes a shift.posted audit entry", async () => {
    await postShift(agencyA, SPEC_NEW_SHIFT);
    expect(await auditRows()).toStrictEqual([
      { actorId: "agency-a", actorRole: "agency", action: "shift.posted", shiftId: "shift-4", details: SPEC_NEW_SHIFT },
    ]);
  });

  describe("returns 400 and creates nothing", () => {
    const cases: [string, unknown, string][] = [
      ["role is not RN or LPN", { ...SPEC_NEW_SHIFT, role: "CNA" }, "role must be RN or LPN"],
      ["role is missing", { ...SPEC_NEW_SHIFT, role: undefined }, "role must be RN or LPN"],
      ["date is not a real date", { ...SPEC_NEW_SHIFT, date: "2026-02-30" }, "date must be a valid date (YYYY-MM-DD)"],
      ["date is in another format", { ...SPEC_NEW_SHIFT, date: "10/05/2026" }, "date must be a valid date (YYYY-MM-DD)"],
      ["date is missing", { ...SPEC_NEW_SHIFT, date: undefined }, "date must be a valid date (YYYY-MM-DD)"],
      ["startTime has one hour digit", { ...SPEC_NEW_SHIFT, startTime: "7:00" }, "startTime and endTime must be HH:MM (24-hour)"],
      ["endTime is 24:00", { ...SPEC_NEW_SHIFT, endTime: "24:00" }, "startTime and endTime must be HH:MM (24-hour)"],
      ["endTime is a number", { ...SPEC_NEW_SHIFT, endTime: 19 }, "startTime and endTime must be HH:MM (24-hour)"],
      ["start equals end", { ...SPEC_NEW_SHIFT, endTime: "07:00" }, "startTime and endTime must differ"],
      ["the body is an array", [SPEC_NEW_SHIFT], "Request body must be a JSON object"],
      ["the body is null", null, "Request body must be a JSON object"],
    ];

    it.each(cases)("when %s", async (_name, body, error) => {
      const res = await postShift(agencyA, body);
      expect(res.status).toBe(400);
      expect(await res.json()).toStrictEqual({ error });
      expect(await db().shift.count()).toBe(3);
      expect(await auditRows()).toStrictEqual([]);
    });

    it("when the body is not JSON", async () => {
      const res = await postShiftRaw(agencyA, "role=RN");
      expect(res.status).toBe(400);
      expect(await res.json()).toStrictEqual({ error: "Request body must be valid JSON" });
      expect(await db().shift.count()).toBe(3);
    });
  });
});

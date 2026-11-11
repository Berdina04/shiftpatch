// POST /api/shifts/:id/cancel (docs/spec.md route 5; plan.md, Part 3).
// Permissions per role and reason: permissions.test.ts. Races and rollback:
// cancel-guarantees.test.ts and guarantees.test.ts.
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CANCEL_ERRORS } from "@/lib/cancellations";
import { resetToSeed } from "../support/db";
import { auditRows, cancellationRows, createNurse, shiftRow } from "../support/fixtures";
import { cancel, cancelRaw, claim, EMAILS, tokenFor } from "../support/http";

let agencyA: string;
let maria: string;
let alex: string;
beforeAll(async () => {
  await resetToSeed(); // logins need the seed users, whatever ran before
  agencyA = await tokenFor(EMAILS.agencyA);
  maria = await tokenFor(EMAILS.maria);
  alex = await tokenFor(EMAILS.alex);
});
beforeEach(resetToSeed);

async function expectError(res: Response, status: number, error: string) {
  expect(res.status).toBe(status);
  expect(await res.json()).toStrictEqual({ error });
}

const SHIFT_2_FILLED = { status: "filled", claimedBy: "nurse-1" };

describe("POST /api/shifts/:id/cancel", () => {
  it("spec example: agency-a cancels shift-2 with no-show → 200 with the spec's body", async () => {
    const res = await cancel(agencyA, "shift-2", { reason: "no-show" });

    expect(res.status).toBe(200);
    expect(await res.json()).toStrictEqual({
      id: "shift-2",
      agencyId: "agency-a",
      agencyName: "Sunrise Health Staffing",
      role: "LPN",
      date: "2026-10-03",
      startTime: "07:00",
      endTime: "19:00",
      status: "open",
      claimedBy: null,
      cancellation: { reason: "no-show", previousNurseId: "nurse-1" },
    });
    expect(await shiftRow("shift-2")).toStrictEqual({ status: "open", claimedBy: null });
  });

  it("keeps the cancellation in the shift's history and audits it", async () => {
    await cancel(agencyA, "shift-2", { reason: "no-show" });

    expect(await cancellationRows()).toStrictEqual([
      { shiftId: "shift-2", reason: "no-show", previousNurseId: "nurse-1", cancelledById: "agency-a", cancelledByRole: "agency" },
    ]);
    expect(await auditRows()).toStrictEqual([
      {
        actorId: "agency-a",
        actorRole: "agency",
        action: "shift.cancelled",
        shiftId: "shift-2",
        details: { reason: "no-show", previousNurseId: "nurse-1", status: { from: "filled", to: "open" } },
      },
    ]);
  });

  it("Maria cancels her own shift in advance", async () => {
    const res = await cancel(maria, "shift-2", { reason: "advance" });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      id: "shift-2",
      status: "open",
      claimedBy: null,
      cancellation: { reason: "advance", previousNurseId: "nurse-1" },
    });
    expect(await cancellationRows()).toMatchObject([{ reason: "advance", cancelledById: "nurse-1", cancelledByRole: "nurse" }]);
  });

  it("a reopened shift can be claimed by another nurse", async () => {
    await cancel(agencyA, "shift-2", { reason: "no-show" });
    const other = await createNurse();

    const res = await claim(other.token, "shift-2");

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: "shift-2", status: "filled", claimedBy: other.id });
    expect(await shiftRow("shift-2")).toStrictEqual({ status: "filled", claimedBy: other.id });
  });

  it("keeps every cancellation: cancel, claim again, cancel again", async () => {
    await cancel(agencyA, "shift-2", { reason: "no-show" });
    const other = await createNurse();
    await claim(other.token, "shift-2");
    await cancel(alex, "shift-2", { reason: "advance" });

    expect((await cancellationRows()).map((r) => [r.reason, r.previousNurseId, r.cancelledById])).toStrictEqual([
      ["no-show", "nurse-1", "agency-a"],
      ["advance", other.id, "admin-1"],
    ]);
    expect((await auditRows({ shiftId: "shift-2" })).map((a) => a.action)).toStrictEqual([
      "shift.cancelled",
      "shift.claimed",
      "shift.cancelled",
    ]);
  });

  describe("nurseId (optional): the nurse the caller's page showed", () => {
    it("the nurse still holds the shift → 200", async () => {
      const res = await cancel(agencyA, "shift-2", { reason: "no-show", nurseId: "nurse-1" });
      expect(res.status).toBe(200);
    });

    it("another nurse holds it by now → 409 and nothing changes", async () => {
      await cancel(alex, "shift-2", { reason: "advance" });
      const other = await createNurse();
      await claim(other.token, "shift-2");

      // agency-a's page still shows Maria on shift-2.
      await expectError(await cancel(agencyA, "shift-2", { reason: "no-show", nurseId: "nurse-1" }), 409, CANCEL_ERRORS.heldByAnother);
      expect(await shiftRow("shift-2")).toStrictEqual({ status: "filled", claimedBy: other.id });
      expect(await cancellationRows()).toHaveLength(1);
    });

    it("the shift is open by now → 409 'Shift is not claimed'", async () => {
      await cancel(alex, "shift-2", { reason: "advance" });
      await expectError(await cancel(agencyA, "shift-2", { reason: "no-show", nurseId: "nurse-1" }), 409, CANCEL_ERRORS.notClaimed);
    });
  });

  describe("errors", () => {
    it.each([
      ["no body", undefined, "Request body must be valid JSON"],
      ["invalid JSON", "{", "Request body must be valid JSON"],
      ["a JSON array", "[]", "Request body must be a JSON object"],
      ["no reason", "{}", CANCEL_ERRORS.badReason],
      ["an unknown reason", '{"reason":"late"}', CANCEL_ERRORS.badReason],
      ["a reason in another case", '{"reason":"No-Show"}', CANCEL_ERRORS.badReason],
      ["a non-string nurseId", '{"reason":"advance","nurseId":1}', CANCEL_ERRORS.badNurseId],
    ])("%s → 400 and nothing changes", async (_name, rawBody, error) => {
      await expectError(await cancelRaw(agencyA, "shift-2", rawBody), 400, error);
      expect(await shiftRow("shift-2")).toStrictEqual(SHIFT_2_FILLED);
      expect(await cancellationRows()).toStrictEqual([]);
    });

    it("an unknown shift → 404", async () => {
      await expectError(await cancel(alex, "shift-999", { reason: "advance" }), 404, CANCEL_ERRORS.notFound);
    });

    it("an open shift → 409 'Shift is not claimed'", async () => {
      await expectError(await cancel(agencyA, "shift-1", { reason: "no-show" }), 409, CANCEL_ERRORS.notClaimed);
      await expectError(await cancel(alex, "shift-3", { reason: "advance" }), 409, CANCEL_ERRORS.notClaimed);
      expect(await cancellationRows()).toStrictEqual([]);
      expect(await auditRows()).toStrictEqual([]);
    });

    it("the reason is checked before the shift: a bad reason on an unknown shift → 400", async () => {
      await expectError(await cancel(alex, "shift-999", { reason: "late" }), 400, CANCEL_ERRORS.badReason);
    });

    it("a nurse's no-show is refused before the lookup → 403, even for an unknown shift", async () => {
      await expectError(await cancel(maria, "shift-999", { reason: "no-show" }), 403, CANCEL_ERRORS.nurseNoShow);
    });
  });
});

// Denied attempts go to server logs; the audit table records successful
// changes only (plan.md, Assumptions: Audit log).
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { db, resetToSeed } from "../support/db";
import { agencyShifts, cancel, claim, EMAILS, listShifts, postShift, postShiftRaw, tokenFor } from "../support/http";

let maria: string;
let james: string;
let agencyB: string;
beforeAll(async () => {
  await resetToSeed(); // logins need the seed users, whatever ran before
  maria = await tokenFor(EMAILS.maria);
  james = await tokenFor(EMAILS.james);
  agencyB = await tokenFor(EMAILS.agencyB);
});

let warn: MockInstance<typeof console.warn>;
beforeEach(async () => {
  await resetToSeed();
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => warn.mockRestore());

function deniedLines() {
  return warn.mock.calls
    .map((args) => JSON.parse(String(args[0])))
    .filter((line: { event?: string }) => line.event === "request.denied");
}

describe("denied requests are logged, not audited", () => {
  it.each([
    [
      "a nurse posting a shift (403)",
      () => postShift(maria),
      { method: "POST", path: "/api/shifts", status: 403, error: "Only agencies can post shifts", userId: "nurse-1", role: "nurse" },
    ],
    [
      "an expired credential (403)",
      () => claim(james, "shift-1"),
      { method: "POST", path: "/api/shifts/shift-1/claim", status: 403, error: "Credential expired, cannot claim shift", userId: "nurse-2", role: "nurse" },
    ],
    [
      "a taken shift (409)",
      () => claim(maria, "shift-2"),
      { method: "POST", path: "/api/shifts/shift-2/claim", status: 409, error: "Shift already taken", userId: "nurse-1", role: "nurse" },
    ],
    [
      "another agency's list (403)",
      () => agencyShifts(agencyB, "agency-a"),
      { method: "GET", path: "/api/agencies/agency-a/shifts", status: 403, error: "You can only view your own agency's shifts", userId: "agency-b", role: "agency" },
    ],
    [
      "a nurse marking a no-show (403)",
      () => cancel(maria, "shift-2", { reason: "no-show" }),
      { method: "POST", path: "/api/shifts/shift-2/cancel", status: 403, error: "Nurses can only cancel in advance", userId: "nurse-1", role: "nurse" },
    ],
    [
      "cancelling an open shift (409)",
      () => cancel(agencyB, "shift-3", { reason: "advance" }),
      { method: "POST", path: "/api/shifts/shift-3/cancel", status: 409, error: "Shift is not claimed", userId: "agency-b", role: "agency" },
    ],
    [
      "no token (401)",
      () => claim(undefined, "shift-1"),
      { method: "POST", path: "/api/shifts/shift-1/claim", status: 401, error: "Authentication required", userId: null, role: null },
    ],
  ])("%s", async (_name, call, expected) => {
    await call();
    expect(deniedLines()).toStrictEqual([{ event: "request.denied", ...expected }]);
    expect(await db().auditLog.count()).toBe(0);
  });

  it("never logs the token or the request body", async () => {
    await postShift(maria, { role: "RN", date: "2026-10-05", startTime: "07:00", endTime: "19:00", note: "secret-ish" });
    const logged = warn.mock.calls.map((args) => String(args[0])).join("\n");
    expect(logged).not.toContain(maria);
    expect(logged).not.toContain("secret-ish");
  });

  it("does not log successful requests, validation errors or unknown shifts", async () => {
    await listShifts(maria);
    await claim(maria, "shift-1");
    await postShiftRaw(agencyB, "not json");
    await claim(maria, "shift-999");
    expect(deniedLines()).toStrictEqual([]);
  });
});

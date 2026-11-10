import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetToSeed } from "../support/db";
import { agencyShifts, EMAILS, tokenFor } from "../support/http";
import { SEED_SHIFTS } from "../support/seed-expectations";

const tokens: Record<keyof typeof EMAILS, string> = {} as never;
beforeAll(async () => {
  await resetToSeed(); // logins need the seed users, whatever ran before
  for (const [key, email] of Object.entries(EMAILS)) tokens[key as keyof typeof EMAILS] = await tokenFor(email);
});
beforeEach(resetToSeed);

describe("GET /api/agencies/:agencyId/shifts", () => {
  it("agency-a gets shift-1 and shift-2 in the full shift shape (spec example)", async () => {
    const res = await agencyShifts(tokens.agencyA, "agency-a");
    expect(res.status).toBe(200);
    expect(await res.json()).toStrictEqual({ agencyId: "agency-a", shifts: [SEED_SHIFTS[0], SEED_SHIFTS[1]] });
  });

  it("agency-b gets shift-3 only (spec example)", async () => {
    const res = await agencyShifts(tokens.agencyB, "agency-b");
    expect(res.status).toBe(200);
    expect(await res.json()).toStrictEqual({ agencyId: "agency-b", shifts: [SEED_SHIFTS[2]] });
  });

  it("the admin can read any agency's shifts", async () => {
    const res = await agencyShifts(tokens.alex, "agency-b");
    expect(res.status).toBe(200);
    expect(await res.json()).toStrictEqual({ agencyId: "agency-b", shifts: [SEED_SHIFTS[2]] });
  });

  it("an unknown agency is 404 for the admin", async () => {
    const res = await agencyShifts(tokens.alex, "agency-z");
    expect(res.status).toBe(404);
    expect(await res.json()).toStrictEqual({ error: "Agency not found" });
  });

  it("an unknown agency is 403 for an agency (no hint whether it exists)", async () => {
    const res = await agencyShifts(tokens.agencyA, "agency-z");
    expect(res.status).toBe(403);
    expect(await res.json()).toStrictEqual({ error: "You can only view your own agency's shifts" });
  });
});

import { SignJWT } from "jose";
import { beforeEach, describe, expect, it } from "vitest";
import { GET as listShiftsRoute } from "@/app/api/shifts/route";
import { db, resetToSeed } from "../support/db";
import { makeRequest, tokenFor } from "../support/http";
import { SEED_LOGINS, SEED_SHIFTS } from "../support/seed-expectations";
import { TEST_JWT_SECRET } from "../support/test-env";

beforeEach(resetToSeed);

const get = (init: Parameters<typeof makeRequest>[1] = {}) =>
  listShiftsRoute(makeRequest("/api/shifts", init), {});

async function expect401(res: Response, error: string) {
  expect(res.status).toBe(401);
  expect(await res.json()).toStrictEqual({ error });
}

function signWith(secret: string, claims: { sub: string; exp: number }) {
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.sub)
    .setIssuedAt(claims.exp - 60)
    .setExpirationTime(claims.exp)
    .sign(new TextEncoder().encode(secret));
}

describe("GET /api/shifts", () => {
  it.each(SEED_LOGINS)("returns every shift in the spec shape for $user.role $user.id", async ({ email }) => {
    const res = await get({ token: await tokenFor(email) });

    expect(res.status).toBe(200);
    expect(await res.json()).toStrictEqual({ shifts: SEED_SHIFTS });
  });

  it("accepts the session cookie set at login instead of a bearer token", async () => {
    const token = await tokenFor("maria.lopez@example.com");
    const res = await get({ headers: { cookie: `shiftpatch_token=${token}` } });
    expect(res.status).toBe(200);
  });

  it("reads shifts from the database on every request", async () => {
    await db().shift.update({
      where: { id: "shift-1" },
      data: { status: "filled", claimedById: "nurse-1" },
    });
    const res = await get({ token: await tokenFor("alex.kim@example.com") });
    const { shifts } = await res.json();
    expect(shifts[0]).toMatchObject({ id: "shift-1", status: "filled", claimedBy: "nurse-1" });
  });

  describe("returns 401", () => {
    it("with no token", async () => {
      await expect401(await get(), "Authentication required");
    });

    it("with an Authorization header that is not a Bearer token", async () => {
      await expect401(await get({ headers: { authorization: "Basic abc" } }), "Invalid or expired token");
    });

    it("with a malformed token", async () => {
      await expect401(await get({ token: "not-a-jwt" }), "Invalid or expired token");
    });

    it("with a token signed by a different secret", async () => {
      const token = await signWith("another-secret-0123456789abcdef0123456789", {
        sub: "nurse-1",
        exp: Math.floor(Date.now() / 1000) + 3600,
      });
      await expect401(await get({ token }), "Invalid or expired token");
    });

    it("with an expired token", async () => {
      const token = await signWith(TEST_JWT_SECRET, {
        sub: "nurse-1",
        exp: Math.floor(Date.now() / 1000) - 60,
      });
      await expect401(await get({ token }), "Invalid or expired token");
    });

    it("when the token's user no longer exists (user is loaded from the database)", async () => {
      const token = await tokenFor("james.cook@example.com");
      await db().credential.deleteMany({ where: { nurseId: "nurse-2" } });
      await db().user.delete({ where: { id: "nurse-2" } });
      await expect401(await get({ token }), "Invalid or expired token");
    });

    it("with a bad bearer token even when a valid cookie is present", async () => {
      const cookieToken = await tokenFor("maria.lopez@example.com");
      const res = await get({ token: "not-a-jwt", headers: { cookie: `shiftpatch_token=${cookieToken}` } });
      await expect401(res, "Invalid or expired token");
    });
  });
});

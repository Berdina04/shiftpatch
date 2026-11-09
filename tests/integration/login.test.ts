import { jwtVerify } from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as loginRoute } from "@/app/api/auth/login/route";
import { resetToSeed } from "../support/db";
import { login, makeRequest } from "../support/http";
import { SEED_LOGINS } from "../support/seed-expectations";
import { TEST_JWT_SECRET } from "../support/test-env";

beforeEach(resetToSeed);
afterEach(() => vi.unstubAllEnvs());

describe("POST /api/auth/login", () => {
  it.each(SEED_LOGINS)("logs in $user.id as $user.role", async ({ email, user }) => {
    const { res, body } = await login(email);

    expect(res.status).toBe(200);
    // Exact shape from the spec: { token, user: { id, name, role } } and nothing else.
    expect(body).toStrictEqual({ token: expect.any(String), user });

    const { payload } = await jwtVerify(body.token, new TextEncoder().encode(TEST_JWT_SECRET));
    expect(payload.sub).toBe(user.id);
    expect(payload.exp! - payload.iat!).toBe(8 * 60 * 60);
  });

  it("also sets the token as an httpOnly, SameSite=Lax session cookie", async () => {
    const { res, body } = await login("maria.lopez@example.com");
    const cookie = res.headers.get("set-cookie") ?? "";

    expect(cookie).toContain(`shiftpatch_token=${body.token}`);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Path=\//);
    expect(cookie).toMatch(/Max-Age=28800/);
  });

  it("marks the cookie Secure in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { res } = await login("maria.lopez@example.com");
    expect(res.headers.get("set-cookie")).toMatch(/Secure/i);
  });

  it("ignores email case and surrounding spaces", async () => {
    const { res, body } = await login("  Maria.Lopez@Example.com ");
    expect(res.status).toBe(200);
    expect(body.user.id).toBe("nurse-1");
  });

  it("returns 401 for a wrong password", async () => {
    const { res, body } = await login("maria.lopez@example.com", "wrong-password");
    expect(res.status).toBe(401);
    expect(body).toStrictEqual({ error: "Invalid email or password" });
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("returns the same 401 for an unknown email", async () => {
    const { res, body } = await login("nobody@example.com");
    expect(res.status).toBe(401);
    expect(body).toStrictEqual({ error: "Invalid email or password" });
  });

  it.each([
    ["missing password", { email: "maria.lopez@example.com" }],
    ["missing email", { password: "Trial2026!" }],
    ["empty strings", { email: "", password: "" }],
    ["wrong types", { email: 1, password: true }],
  ])("returns 400 for %s", async (_label, body) => {
    const res = await loginRoute(makeRequest("/api/auth/login", { body }));
    expect(res.status).toBe(400);
    expect(await res.json()).toStrictEqual({ error: "Email and password are required" });
  });

  it("returns 400 for a body that is not JSON", async () => {
    const res = await loginRoute(
      makeRequest("/api/auth/login", { method: "POST", rawBody: "email=maria" }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toStrictEqual({ error: "Request body must be valid JSON" });
  });
});

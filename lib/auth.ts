// Auth (docs/decisions.md #1): an 8 h JWT identifies the caller; the user and
// their role are loaded from the database on every request.
import { jwtVerify, SignJWT } from "jose";
import type { NextRequest } from "next/server";
import { getDb } from "./db";
import type { Role } from "./generated/prisma/enums";
import { HttpError, toErrorResponse } from "./http";

export const SESSION_COOKIE = "shiftpatch_token";
export const TOKEN_TTL_SECONDS = 8 * 60 * 60;

export type SessionUser = {
  id: string;
  name: string;
  role: Role;
  agencyId: string | null;
};

function secretKey(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("JWT_SECRET must be set to at least 32 characters");
  }
  return new TextEncoder().encode(secret);
}

export async function signToken(userId: string): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${TOKEN_TTL_SECONDS}s`)
    .sign(secretKey());
}

/** Returns the user id in a valid, unexpired token, or null. */
export async function verifyToken(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: ["HS256"] });
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

/** Resolves a token to the current user as stored in the database, or null. */
export async function getUserForToken(token: string | undefined): Promise<SessionUser | null> {
  if (!token) return null;
  const userId = await verifyToken(token);
  if (!userId) return null;
  return getDb().user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, role: true, agencyId: true },
  });
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: TOKEN_TTL_SECONDS,
  };
}

/**
 * `Authorization: Bearer <token>` wins when present (a malformed header is
 * rejected, not ignored); otherwise the session cookie set at login is used.
 */
function tokenFromRequest(req: NextRequest): string | undefined {
  const header = req.headers.get("authorization");
  if (header !== null) {
    const match = /^Bearer\s+(\S+)\s*$/i.exec(header);
    if (!match) throw new HttpError(401, "Invalid or expired token");
    return match[1];
  }
  return req.cookies.get(SESSION_COOKIE)?.value;
}

export async function requireUser(req: NextRequest): Promise<SessionUser> {
  const token = tokenFromRequest(req);
  if (!token) throw new HttpError(401, "Authentication required");
  const user = await getUserForToken(token);
  if (!user) throw new HttpError(401, "Invalid or expired token");
  return user;
}

type AuthedHandler<Ctx> = (req: NextRequest, user: SessionUser, ctx: Ctx) => Promise<Response>;

/** Statuses that mean "you may not do this": logged, never audited (plan.md). */
const DENIED_STATUSES = new Set([401, 403, 409]);

/**
 * One JSON line per denied request in the server logs. The audit table only
 * records successful changes. Never includes the token or the request body.
 */
export function logDenied(req: NextRequest, user: SessionUser | null, err: HttpError): void {
  console.warn(
    JSON.stringify({
      event: "request.denied",
      method: req.method,
      path: req.nextUrl.pathname,
      status: err.status,
      error: err.message,
      userId: user?.id ?? null,
      role: user?.role ?? null,
    }),
  );
}

/** Wraps a route handler so it only runs for an authenticated user. */
export function withAuth<Ctx = unknown>(handler: AuthedHandler<Ctx>) {
  return async (req: NextRequest, ctx: Ctx): Promise<Response> => {
    let user: SessionUser | null = null;
    try {
      user = await requireUser(req);
      return await handler(req, user, ctx);
    } catch (err) {
      if (err instanceof HttpError && DENIED_STATUSES.has(err.status)) logDenied(req, user, err);
      return toErrorResponse(err);
    }
  };
}

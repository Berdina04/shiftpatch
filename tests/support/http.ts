// Calls Next route handlers directly with a real NextRequest.
import { NextRequest } from "next/server";
import { GET as agencyShiftsRoute } from "@/app/api/agencies/[agencyId]/shifts/route";
import { POST as loginRoute } from "@/app/api/auth/login/route";
import { POST as claimRoute } from "@/app/api/shifts/[id]/claim/route";
import { GET as listShiftsRoute, POST as postShiftRoute } from "@/app/api/shifts/route";

const BASE = "http://localhost:3000";

type Init = {
  method?: string;
  token?: string;
  headers?: Record<string, string>;
  body?: unknown;
  rawBody?: string;
};

export function makeRequest(path: string, init: Init = {}): NextRequest {
  const headers = new Headers(init.headers);
  if (init.token) headers.set("authorization", `Bearer ${init.token}`);
  let body: string | undefined = init.rawBody;
  if (init.body !== undefined) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(init.body);
  }
  return new NextRequest(new URL(path, BASE), {
    method: init.method ?? (body === undefined ? "GET" : "POST"),
    headers,
    body,
  });
}

export async function login(email: string, password = "Trial2026!") {
  const res = await loginRoute(makeRequest("/api/auth/login", { body: { email, password } }));
  return { res, body: await res.json() };
}

export async function tokenFor(email: string): Promise<string> {
  const { res, body } = await login(email);
  if (res.status !== 200) throw new Error(`login failed for ${email}: ${res.status}`);
  return body.token as string;
}

export const EMAILS = {
  agencyA: "admin@sunrisehealth.example",
  agencyB: "admin@metrocare.example",
  maria: "maria.lopez@example.com",
  james: "james.cook@example.com",
  alex: "alex.kim@example.com",
} as const;

// --- Part 2 routes ---------------------------------------------------------

export const SPEC_NEW_SHIFT = { role: "RN", date: "2026-10-05", startTime: "07:00", endTime: "19:00" } as const;

export function listShifts(token?: string) {
  return listShiftsRoute(makeRequest("/api/shifts", { token }), {});
}

export function postShift(token: string | undefined, body: unknown = SPEC_NEW_SHIFT) {
  return postShiftRoute(makeRequest("/api/shifts", { method: "POST", token, body }), {});
}

export function postShiftRaw(token: string, rawBody: string) {
  return postShiftRoute(makeRequest("/api/shifts", { method: "POST", token, rawBody }), {});
}

export function claim(token: string | undefined, shiftId: string) {
  return claimRoute(makeRequest(`/api/shifts/${shiftId}/claim`, { method: "POST", token }), {
    params: Promise.resolve({ id: shiftId }),
  });
}

export function agencyShifts(token: string | undefined, agencyId: string) {
  return agencyShiftsRoute(makeRequest(`/api/agencies/${agencyId}/shifts`, { token }), {
    params: Promise.resolve({ agencyId }),
  });
}

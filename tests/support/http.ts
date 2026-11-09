// Calls Next route handlers directly with a real NextRequest.
import { NextRequest } from "next/server";
import { POST as loginRoute } from "@/app/api/auth/login/route";

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

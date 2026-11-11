// Calls Next route handlers directly with a real NextRequest.
import { NextRequest } from "next/server";
import { GET as adminDashboardRoute } from "@/app/api/admin/dashboard/route";
import { GET as credentialFileRoute } from "@/app/api/credentials/[id]/file/route";
import { POST as reviewRoute } from "@/app/api/credentials/[id]/review/route";
import { GET as listCredentialsRoute, POST as uploadRoute } from "@/app/api/credentials/route";
import { GET as agencyShiftsRoute } from "@/app/api/agencies/[agencyId]/shifts/route";
import { POST as loginRoute } from "@/app/api/auth/login/route";
import { POST as cancelRoute } from "@/app/api/shifts/[id]/cancel/route";
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

// --- Part 3 routes ---------------------------------------------------------

export function cancel(token: string | undefined, shiftId: string, body: unknown) {
  return cancelRoute(makeRequest(`/api/shifts/${shiftId}/cancel`, { method: "POST", token, body }), {
    params: Promise.resolve({ id: shiftId }),
  });
}

export function cancelRaw(token: string, shiftId: string, rawBody: string | undefined) {
  return cancelRoute(makeRequest(`/api/shifts/${shiftId}/cancel`, { method: "POST", token, rawBody }), {
    params: Promise.resolve({ id: shiftId }),
  });
}

export function adminDashboard(token: string | undefined) {
  return adminDashboardRoute(makeRequest("/api/admin/dashboard", { token }), {});
}

// --- Part 4 routes ---------------------------------------------------------

/** A tiny but well-formed PDF; its first bytes are what the upload checks. */
export const PDF_BYTES = new TextEncoder().encode(
  "%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [] /Count 0 >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n",
);
export const PNG_BYTES = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52);
export const JPEG_BYTES = Uint8Array.of(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9);

/** `size` bytes that start like a PDF. */
export function pdfOfSize(size: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(size);
  bytes.set(PDF_BYTES.subarray(0, Math.min(size, PDF_BYTES.length)));
  return bytes;
}

export type UploadFile = { bytes: Uint8Array<ArrayBuffer>; name?: string; type?: string };

/** A valid upload by default: a PDF expiring 2028-01-01. `null` leaves a field out. */
export function credentialForm(fields: { file?: UploadFile | string | null; expiresOn?: string | null } = {}): FormData {
  const form = new FormData();
  const file = fields.file === undefined ? { bytes: PDF_BYTES } : fields.file;
  if (typeof file === "string") form.append("file", file);
  else if (file) form.append("file", new File([file.bytes], file.name ?? "licence.pdf", { type: file.type ?? "application/pdf" }));
  const expiresOn = fields.expiresOn === undefined ? "2028-01-01" : fields.expiresOn;
  if (expiresOn !== null) form.append("expiresOn", expiresOn);
  return form;
}

export function uploadForm(token: string | undefined, form: FormData, headers: Record<string, string> = {}) {
  const h = new Headers(headers);
  if (token) h.set("authorization", `Bearer ${token}`);
  return uploadRoute(new NextRequest(new URL("/api/credentials", BASE), { method: "POST", headers: h, body: form }), {});
}

export function uploadCredential(token: string | undefined, fields: Parameters<typeof credentialForm>[0] = {}) {
  return uploadForm(token, credentialForm(fields));
}

/** Uploads a valid credential and returns its id. */
export async function uploadedCredentialId(token: string, expiresOn = "2028-01-01"): Promise<string> {
  const res = await uploadCredential(token, { expiresOn });
  if (res.status !== 201) throw new Error(`upload failed: ${res.status} ${await res.text()}`);
  return ((await res.json()) as { id: string }).id;
}

export function listCredentials(token: string | undefined, query = "") {
  return listCredentialsRoute(makeRequest(`/api/credentials${query}`, { token }), {});
}

export function credentialFile(token: string | undefined, id: string) {
  return credentialFileRoute(makeRequest(`/api/credentials/${id}/file`, { token }), { params: Promise.resolve({ id }) });
}

export function reviewCredential(token: string | undefined, id: string, body: unknown) {
  return reviewRoute(makeRequest(`/api/credentials/${id}/review`, { method: "POST", token, body }), {
    params: Promise.resolve({ id }),
  });
}

export function reviewCredentialRaw(token: string, id: string, rawBody: string) {
  return reviewRoute(makeRequest(`/api/credentials/${id}/review`, { method: "POST", token, rawBody }), {
    params: Promise.resolve({ id }),
  });
}

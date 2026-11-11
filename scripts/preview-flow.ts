// Part 2 and Part 4 end-to-end flows against a PR's PREVIEW deployment. It
// WRITES data (posts and claims shifts, uploads and approves a credential), so
// before any request it checks with Vercel that the deployment is not
// production and that Neon gave it its own branch.
// Production gets only `npm run smoke` (docs/plan.md, Part 2 notes).
//
// Usage: npm run preview-flow -- <preview-deployment-url>
//   VERCEL_SCOPE (default "berdina04s-projects") is the Vercel team.
// Requests go through `vercel curl`, which uses your Vercel CLI login to pass
// Deployment Protection, so `vercel whoami` must work.
//
// Expects the preview's Neon branch at the seed state, i.e. the first run on a
// new PR branch: the Neon branch is kept across pushes to the same git branch,
// so a rerun fails the spec steps (shift-1 is already claimed). From 2027-01-01
// Maria's seeded credential has expired, so her claim steps get 403.
import { execFile } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const target = (process.argv[2] ?? "").replace(/\/$/, "");
const scope = process.env.VERCEL_SCOPE ?? "berdina04s-projects";
if (!/^https:\/\/[^/]+$/.test(target)) {
  console.error("Usage: npm run preview-flow -- https://<preview-deployment-host>");
  process.exit(1);
}

function vercel(args: string[], input = ""): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // Global flags go first: anything after `curl ... --` is passed to curl.
    const child = execFile("vercel", ["--scope", scope, ...args], { encoding: "buffer", maxBuffer: 20e6 }, (err, out) =>
      err ? reject(err) : resolve(out),
    );
    child.stdin?.end(input);
  });
}

async function vercelApi<T>(path: string): Promise<T> {
  return JSON.parse((await vercel(["api", path])).toString("utf8")) as T;
}

// --- Safety: never write to production or to a shared database -------------
const host = new URL(target).host;
const deployment = await vercelApi<{ id: string; target: string | null }>(`/v13/deployments/${host}`);
if (deployment.target === "production") {
  console.error(`${host} is a production deployment. This script writes data; it only runs against previews.`);
  process.exit(1);
}
const integrations = await vercelApi<{ actions?: { status: string; statusUrl?: string }[] }>(
  `/v1/deployments/${deployment.id}/integrations`,
);
const neonBranch = integrations.actions
  ?.filter((a) => a.status === "succeeded")
  .map((a) => /\/branches\/([\w-]+)/.exec(a.statusUrl ?? "")?.[1])
  .find(Boolean);
if (!neonBranch) {
  console.error(`No Neon branch was created for ${host}; refusing to write to a database it may share.`);
  process.exit(1);
}

// --- HTTP through `vercel curl` ----------------------------------------------
type Reply = { status: number; json: Record<string, unknown>; text: string };

async function request(
  method: string,
  urlPath: string,
  headers: Record<string, string>,
  body?: string,
  curlArgs: string[] = [],
): Promise<Reply> {
  const args = ["curl", `${target}${urlPath}`, "--", "-s", "-i", "-X", method, ...curlArgs];
  for (const [k, v] of Object.entries(headers)) args.push("-H", `${k}: ${v}`);
  if (body !== undefined) args.push("--data-binary", "@-");
  let rest = await vercel(args, body);
  let head = "";
  do {
    // Skip interim responses such as "HTTP/1.1 100 Continue".
    const end = rest.indexOf("\r\n\r\n");
    head = rest.subarray(0, end).toString("latin1");
    rest = rest.subarray(end + 4);
  } while (/^HTTP\/\S+ 1\d\d/.test(head));
  const text = rest.toString("utf8");
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(text);
  } catch {
    // An HTML page.
  }
  return { status: Number(head.split(" ")[1]), json, text };
}

const USERS = {
  agencyA: "admin@sunrisehealth.example",
  agencyB: "admin@metrocare.example",
  maria: "maria.lopez@example.com",
  james: "james.cook@example.com",
  alex: "alex.kim@example.com",
} as const;
type Who = keyof typeof USERS;
const tokens = {} as Record<Who, string>;

function api(who: Who | null, method: string, path: string, body?: unknown): Promise<Reply> {
  const headers: Record<string, string> = {};
  if (who) headers.authorization = `Bearer ${tokens[who]}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  return request(method, path, headers, body === undefined ? undefined : JSON.stringify(body));
}

// --- Checks ------------------------------------------------------------------
let failures = 0;
async function step(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`  ok    ${name}`);
  } catch (err) {
    failures++;
    console.log(`  FAIL  ${name}: ${err instanceof Error ? err.message : String(err)}`);
  }
}
function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

console.log(`Preview flow against ${target} (preview, Neon branch ${neonBranch})`);
console.log("Part 2: posting and claiming");

await step("all five seed users log in", async () => {
  for (const [who, email] of Object.entries(USERS)) {
    const r = await api(null, "POST", "/api/auth/login", { email, password: "Trial2026!" });
    assert(r.status === 200, `${who}: ${r.status}`);
    tokens[who as Who] = r.json.token as string;
  }
});

await step("spec: Maria claims shift-1 → 200 with the spec body", async () => {
  const r = await api("maria", "POST", "/api/shifts/shift-1/claim");
  assert(r.status === 200, `status ${r.status} ${r.text}`);
  assert(
    same(r.json, {
      id: "shift-1", agencyId: "agency-a", agencyName: "Sunrise Health Staffing", role: "RN",
      date: "2026-10-02", startTime: "19:00", endTime: "07:00", status: "filled", claimedBy: "nurse-1",
    }),
    `body ${r.text}`,
  );
});

await step("spec: James claims shift-3 → 403 'Credential expired, cannot claim shift'", async () => {
  const r = await api("james", "POST", "/api/shifts/shift-3/claim");
  assert(r.status === 403 && same(r.json, { error: "Credential expired, cannot claim shift" }), `${r.status} ${r.text}`);
});

let posted = "";
await step("spec: agency-a posts the spec's shift → 201 open, agency-a", async () => {
  const r = await api("agencyA", "POST", "/api/shifts", { role: "RN", date: "2026-10-05", startTime: "07:00", endTime: "19:00" });
  assert(r.status === 201, `status ${r.status} ${r.text}`);
  posted = r.json.id as string;
  assert(/^shift-\d+$/.test(posted), `id ${posted}`);
  assert(
    same({ ...r.json, id: "x" }, {
      id: "x", agencyId: "agency-a", agencyName: "Sunrise Health Staffing", role: "RN",
      date: "2026-10-05", startTime: "07:00", endTime: "19:00", status: "open", claimedBy: null,
    }),
    `body ${r.text}`,
  );
  console.log(`        (posted ${posted})`);
});

await step("Maria claims the posted shift → 200", async () => {
  const r = await api("maria", "POST", `/api/shifts/${posted}/claim`);
  assert(r.status === 200 && r.json.claimedBy === "nurse-1", `${r.status} ${r.text}`);
});

await step("James claims the posted shift → 403 (credential is checked before 'taken')", async () => {
  const r = await api("james", "POST", `/api/shifts/${posted}/claim`);
  assert(r.status === 403 && same(r.json, { error: "Credential expired, cannot claim shift" }), `${r.status} ${r.text}`);
});

await step("agency-a's list shows the posted shift filled by nurse-1", async () => {
  const r = await api("agencyA", "GET", "/api/agencies/agency-a/shifts");
  assert(r.status === 200, `status ${r.status}`);
  const s = (r.json.shifts as { id: string; status: string; claimedBy: string | null }[]).find((x) => x.id === posted);
  assert(s && s.status === "filled" && s.claimedBy === "nurse-1", `shift ${JSON.stringify(s)}`);
});

const NEW_SHIFT = { role: "RN", date: "2026-10-06", startTime: "07:00", endTime: "19:00" };
const denied: [Who, string, string, unknown, number, string][] = [
  ["maria", "POST", "/api/shifts", NEW_SHIFT, 403, "Only agencies can post shifts"],
  ["alex", "POST", "/api/shifts", NEW_SHIFT, 403, "Only agencies can post shifts"],
  ["agencyA", "POST", "/api/shifts/shift-3/claim", undefined, 403, "Only nurses can claim shifts"],
  ["agencyB", "GET", "/api/agencies/agency-a/shifts", undefined, 403, "You can only view your own agency's shifts"],
  ["maria", "POST", "/api/shifts/shift-2/claim", undefined, 409, "Shift already taken"],
  ["maria", "POST", "/api/shifts/shift-999/claim", undefined, 404, "Shift not found"],
  ["agencyA", "POST", "/api/shifts", { ...NEW_SHIFT, date: "2026-02-30" }, 400, "date must be a valid date (YYYY-MM-DD)"],
];
for (const [who, method, path, body, status, error] of denied) {
  await step(`${who} ${method} ${path} → ${status}`, async () => {
    const r = await api(who, method, path, body);
    assert(r.status === status && same(r.json, { error }), `${r.status} ${r.text}`);
  });
}

await step("overlap race on Neon: Maria claims two overlapping shifts at once → one 200, one 409", async () => {
  const a = await api("agencyB", "POST", "/api/shifts", { role: "RN", date: "2026-12-01", startTime: "07:00", endTime: "19:00" });
  const b = await api("agencyA", "POST", "/api/shifts", { role: "LPN", date: "2026-12-01", startTime: "12:00", endTime: "20:00" });
  assert(a.status === 201 && b.status === 201, `posts ${a.status} ${b.status}`);
  const [ra, rb] = await Promise.all([
    api("maria", "POST", `/api/shifts/${a.json.id}/claim`),
    api("maria", "POST", `/api/shifts/${b.json.id}/claim`),
  ]);
  assert(same([ra.status, rb.status].sort(), [200, 409]), `statuses ${ra.status} ${rb.status}`);
  const loser = ra.status === 409 ? ra : rb;
  assert(same(loser.json, { error: "Shift overlaps another shift you hold" }), `loser ${loser.text}`);
});

await step("pages render: /shifts has claim buttons for Maria, /agency has the post form for agency-a", async () => {
  const shifts = await request("GET", "/shifts", { cookie: `shiftpatch_token=${tokens.maria}` });
  assert(shifts.status === 200, `/shifts ${shifts.status}`);
  assert(shifts.text.includes('data-testid="shift-claim-button"'), "/shifts: no shift-claim-button");
  const agency = await request("GET", "/agency", { cookie: `shiftpatch_token=${tokens.agencyA}` });
  assert(agency.status === 200, `/agency ${agency.status}`);
  assert(agency.text.includes('data-testid="agency-post-shift-button"'), "/agency: no agency-post-shift-button");
});

// --- Part 4: credentials with admin approval ---------------------------------
console.log("Part 4: credentials");

const PDF = "%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [] /Count 0 >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n";
const dir = mkdtempSync(join(tmpdir(), "shiftpatch-preview-"));
function tempFile(name: string, content: string | Buffer): string {
  const file = join(dir, name);
  writeFileSync(file, content);
  return file;
}
const pdfFile = tempFile("james-licence.pdf", PDF);

/** POST /api/credentials as multipart/form-data, like the upload form. */
function upload(who: Who, file: string, expiresOn: string): Promise<Reply> {
  return request("POST", "/api/credentials", { authorization: `Bearer ${tokens[who]}` }, undefined, [
    "-F",
    `file=@${file};type=application/pdf`,
    "-F",
    `expiresOn=${expiresOn}`,
  ]);
}

let credential = "";
await step("James uploads a credential → 201 pending, with its file", async () => {
  const r = await upload("james", pdfFile, "2028-01-01");
  assert(r.status === 201, `status ${r.status} ${r.text}`);
  credential = r.json.id as string;
  assert(/^cred-\d+$/.test(credential), `id ${credential}`);
  assert(r.json.status === "pending" && r.json.nurseId === "nurse-2" && r.json.expiresOn === "2028-01-01", `body ${r.text}`);
  assert(
    same(r.json.file, { fileName: "james-licence.pdf", contentType: "application/pdf", size: Buffer.byteLength(PDF) }),
    `file ${JSON.stringify(r.json.file)}`,
  );
  console.log(`        (uploaded ${credential})`);
});

await step("James is still blocked: claim shift-3 → 403 'Credential expired, cannot claim shift'", async () => {
  const r = await api("james", "POST", "/api/shifts/shift-3/claim");
  assert(r.status === 403 && same(r.json, { error: "Credential expired, cannot claim shift" }), `${r.status} ${r.text}`);
});

const FILE_FORBIDDEN = "Only the nurse who uploaded it and the admin can open this file";
await step("agency-a and Maria opening James's file → 403", async () => {
  for (const who of ["agencyA", "maria"] as const) {
    const r = await api(who, "GET", `/api/credentials/${credential}/file`);
    assert(r.status === 403 && same(r.json, { error: FILE_FORBIDDEN }), `${who}: ${r.status} ${r.text}`);
  }
});

await step("an agency gets 403 for a credential with no file too (permission before existence)", async () => {
  const r = await api("agencyB", "GET", "/api/credentials/cred-nurse-1/file");
  assert(r.status === 403 && same(r.json, { error: FILE_FORBIDDEN }), `${r.status} ${r.text}`);
});

await step("James and the admin open the file → 200, the same bytes, private", async () => {
  for (const who of ["james", "alex"] as const) {
    const r = await api(who, "GET", `/api/credentials/${credential}/file`);
    assert(r.status === 200 && r.text === PDF, `${who}: ${r.status}`);
  }
});

await step("agency-b sees the new credential's status only", async () => {
  const r = await api("agencyB", "GET", "/api/credentials");
  assert(r.status === 200, `status ${r.status}`);
  const row = (r.json.credentials as { id: string }[]).find((c) => c.id === credential);
  assert(
    same(row, { id: credential, nurseId: "nurse-2", nurseName: "James Cook", expiresOn: "2028-01-01", status: "pending" }),
    `row ${JSON.stringify(row)}`,
  );
});

await step("4 MB + 1 byte reaches the route → 400 'File must be 4 MB or smaller'", async () => {
  const big = Buffer.alloc(4 * 1024 * 1024 + 1);
  big.write(PDF);
  const r = await upload("james", tempFile("big.pdf", big), "2028-01-01");
  assert(r.status === 400 && same(r.json, { error: "File must be 4 MB or smaller" }), `${r.status} ${r.text.slice(0, 200)}`);
});

await step("a 5 MB body is refused by Vercel before the route runs (why the form checks the size first)", async () => {
  const huge = Buffer.alloc(5 * 1024 * 1024);
  huge.write(PDF);
  const r = await upload("james", tempFile("huge.pdf", huge), "2028-01-01");
  assert(r.status === 413, `status ${r.status} ${r.text.slice(0, 200)}`);
  console.log(`        (Vercel: ${r.status} ${r.text.slice(0, 80).replace(/\s+/g, " ")})`);
});

await step("the admin's review queue has it; the admin approves → 200; a second review → 409", async () => {
  const queue = await api("alex", "GET", "/api/credentials?status=pending");
  assert(queue.status === 200, `queue ${queue.status}`);
  assert((queue.json.credentials as { id: string }[]).some((c) => c.id === credential), "not in the queue");
  const r = await api("alex", "POST", `/api/credentials/${credential}/review`, { decision: "approved" });
  assert(r.status === 200 && r.json.status === "approved", `${r.status} ${r.text}`);
  const again = await api("alex", "POST", `/api/credentials/${credential}/review`, { decision: "rejected", reason: "late" });
  assert(again.status === 409 && same(again.json, { error: "Credential already reviewed" }), `${again.status} ${again.text}`);
});

await step("James claims shift-3 → 200", async () => {
  const r = await api("james", "POST", "/api/shifts/shift-3/claim");
  assert(r.status === 200 && r.json.claimedBy === "nurse-2" && r.json.status === "filled", `${r.status} ${r.text}`);
});

await step("the audit log has the upload and the approval", async () => {
  const r = await api("alex", "GET", "/api/admin/dashboard");
  assert(r.status === 200, `status ${r.status}`);
  const actions = (r.json.auditLog as { action: string; credentialId: string | null }[])
    .filter((e) => e.credentialId === credential)
    .map((e) => e.action);
  assert(same(actions, ["credential.approved", "credential.uploaded"]), `actions ${actions}`);
});

await step("pages render: /shifts has the credential upload test IDs for James", async () => {
  const page = await request("GET", "/shifts", { cookie: `shiftpatch_token=${tokens.james}` });
  assert(page.status === 200, `/shifts ${page.status}`);
  for (const id of ["credential-upload-input", "credential-expiry-date-input"]) {
    assert(page.text.includes(`data-testid="${id}"`), `/shifts: no ${id}`);
  }
});

console.log(failures === 0 ? "Preview flow passed." : `Preview flow FAILED (${failures}).`);
process.exit(failures === 0 ? 0 : 1);

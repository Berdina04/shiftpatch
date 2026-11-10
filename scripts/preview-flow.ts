// Part 2 end-to-end flow against a PR's PREVIEW deployment. It WRITES data
// (posts and claims shifts), so before any request it checks with Vercel that
// the deployment is not production and that Neon gave it its own branch.
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

async function request(method: string, path: string, headers: Record<string, string>, body?: string): Promise<Reply> {
  const args = ["curl", `${target}${path}`, "--", "-s", "-i", "-X", method];
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

console.log(`Part 2 flow against ${target} (preview, Neon branch ${neonBranch})`);

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

console.log(failures === 0 ? "Part 2 flow passed." : `Part 2 flow FAILED (${failures}).`);
process.exit(failures === 0 ? 0 : 1);

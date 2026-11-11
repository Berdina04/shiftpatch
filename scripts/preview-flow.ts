// Part 2 and Part 5 end-to-end flows against a PR's PREVIEW deployment. It
// WRITES data (posts and claims shifts), so before any request it checks with
// Vercel that the deployment is not production and that Neon gave it its own
// branch.
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

// --- Part 5: timesheets -------------------------------------------------------
// Scheduled hours from filled shifts, scoped by role. Uses a shift of its own
// (not shift-3, which other parts' steps may claim), so it holds whatever ran
// before it.
console.log("Part 5: timesheets");

type SheetShift = { id: string; agencyId: string; claimedBy: string; scheduledMinutes: number; scheduledHours: number };
type Sheet = { nurseId: string; totalScheduledMinutes: number; totalScheduledHours: number; shifts: SheetShift[] };

async function sheets(who: Who): Promise<Sheet[]> {
  const r = await api(who, "GET", "/api/timesheets");
  assert(r.status === 200, `${who}: ${r.status} ${r.text}`);
  const list = r.json.timesheets as Sheet[];
  for (const sheet of list) {
    const sum = sheet.shifts.reduce((total, s) => total + s.scheduledMinutes, 0);
    assert(sheet.totalScheduledMinutes === sum, `${who}: ${sheet.nurseId} total ${sheet.totalScheduledMinutes} ≠ ${sum}`);
  }
  return list;
}
const mariaIn = (list: Sheet[]) => list.find((s) => s.nurseId === "nurse-1");

let agencyBShift = "";
await step("agency-b posts a 12 h shift and Maria claims it → 200", async () => {
  const posted = await api("agencyB", "POST", "/api/shifts", { role: "RN", date: "2026-12-10", startTime: "07:00", endTime: "19:00" });
  assert(posted.status === 201, `post ${posted.status} ${posted.text}`);
  agencyBShift = posted.json.id as string;
  const r = await api("maria", "POST", `/api/shifts/${agencyBShift}/claim`);
  assert(r.status === 200 && r.json.claimedBy === "nurse-1", `${r.status} ${r.text}`);
  console.log(`        (posted and claimed ${agencyBShift})`);
});

await step("Maria's timesheet: shift-1 (19:00–07:00) and shift-2 are 12 h each, with agency-b's shift; the total adds up", async () => {
  const list = await sheets("maria");
  assert(same(list.map((s) => s.nurseId), ["nurse-1"]), `nurses ${list.map((s) => s.nurseId)}`);
  const hours = (id: string) => list[0].shifts.find((s) => s.id === id);
  for (const id of ["shift-1", "shift-2", agencyBShift]) {
    const s = hours(id);
    assert(s && s.scheduledMinutes === 720 && s.scheduledHours === 12, `${id}: ${JSON.stringify(s)}`);
  }
  console.log(`        (Maria: ${list[0].shifts.length} shifts, ${list[0].totalScheduledHours} h)`);
});

await step("each agency counts only its own shifts: Maria's agency-b hours are not in her agency-a total", async () => {
  const [mine, a, b, all] = await Promise.all([sheets("maria"), sheets("agencyA"), sheets("agencyB"), sheets("alex")]);
  for (const [list, agencyId] of [[a, "agency-a"], [b, "agency-b"]] as const) {
    for (const s of list.flatMap((x) => x.shifts)) assert(s.agencyId === agencyId, `${agencyId} sees ${s.id} of ${s.agencyId}`);
  }
  const [mariaA, mariaB, mariaAll, mariaOwn] = [mariaIn(a), mariaIn(b), mariaIn(all), mariaIn(mine)];
  assert(mariaA && mariaB && mariaAll && mariaOwn, "Maria missing from a timesheet");
  assert(!mariaA.shifts.some((s) => s.id === agencyBShift), `agency-a shows ${agencyBShift}`);
  assert(mariaB.shifts.some((s) => s.id === agencyBShift), `agency-b doesn't show ${agencyBShift}`);
  const sum = mariaA.totalScheduledMinutes + mariaB.totalScheduledMinutes;
  assert(sum === mariaOwn.totalScheduledMinutes && sum === mariaAll.totalScheduledMinutes, `a ${mariaA.totalScheduledMinutes} + b ${mariaB.totalScheduledMinutes} vs own ${mariaOwn.totalScheduledMinutes}, admin ${mariaAll.totalScheduledMinutes}`);
});

await step("James's timesheet is his own only", async () => {
  const list = await sheets("james");
  assert(same(list.map((s) => s.nurseId), ["nurse-2"]), `nurses ${list.map((s) => s.nurseId)}`);
});

await step("pages render: /timesheets has the timesheet-table and the scheduled-hours label", async () => {
  const page = await request("GET", "/timesheets", { cookie: `shiftpatch_token=${tokens.maria}` });
  assert(page.status === 200, `/timesheets ${page.status}`);
  assert(page.text.includes('data-testid="timesheet-table"'), "/timesheets: no timesheet-table");
  assert(page.text.includes("Scheduled hours — not actual time worked"), "/timesheets: no scheduled-hours label");
});

console.log(failures === 0 ? "Preview flow passed." : `Preview flow FAILED (${failures}).`);
process.exit(failures === 0 ? 0 : 1);

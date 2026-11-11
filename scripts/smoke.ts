// Read-only smoke check for a deployed ShiftPatch (plan.md: production gets
// no data-changing tests). Logs in every seed user, reads the shift list, the
// agency-scoped lists, the credential lists and each role's timesheets, and
// checks who may open a credential file. Only GETs after login: never posts,
// claims or uploads.
// Usage: npm run smoke -- https://your-app.vercel.app
export {};

const baseUrl = (process.argv[2] ?? process.env.SMOKE_BASE_URL ?? "").replace(/\/$/, "");
if (!baseUrl) {
  console.error("Usage: npm run smoke -- <base-url>   (or set SMOKE_BASE_URL)");
  process.exit(1);
}

const PASSWORD = "Trial2026!";
const USERS = [
  { email: "admin@sunrisehealth.example", id: "agency-a", name: "Sunrise Health Staffing", role: "agency" },
  { email: "admin@metrocare.example", id: "agency-b", name: "Metro Care Partners", role: "agency" },
  { email: "maria.lopez@example.com", id: "nurse-1", name: "Maria Lopez", role: "nurse" },
  { email: "james.cook@example.com", id: "nurse-2", name: "James Cook", role: "nurse" },
  { email: "alex.kim@example.com", id: "admin-1", name: "Alex Kim", role: "admin" },
];
const SHIFT_KEYS = ["agencyId", "agencyName", "claimedBy", "date", "endTime", "id", "role", "startTime", "status"];
// Fields of the seed shifts that no product action ever changes.
const SEED_SHIFTS = [
  { id: "shift-1", agencyId: "agency-a", agencyName: "Sunrise Health Staffing", role: "RN", date: "2026-10-02", startTime: "19:00", endTime: "07:00" },
  { id: "shift-2", agencyId: "agency-a", agencyName: "Sunrise Health Staffing", role: "LPN", date: "2026-10-03", startTime: "07:00", endTime: "19:00" },
  { id: "shift-3", agencyId: "agency-b", agencyName: "Metro Care Partners", role: "RN", date: "2026-10-04", startTime: "19:00", endTime: "07:00" },
];

const tokens: Record<string, string> = {};
let failures = 0;
async function check(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`  ok    ${name}`);
  } catch (err) {
    failures++;
    console.log(`  FAIL  ${name}: ${err instanceof Error ? err.message : String(err)}`);
  }
}
function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(message);
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

async function postJson(path: string, body: unknown) {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

console.log(`Smoke check against ${baseUrl}`);

await check("login page renders with the spec test IDs", async () => {
  const res = await fetch(`${baseUrl}/login`);
  assert(res.status === 200, `status ${res.status}`);
  const html = await res.text();
  for (const id of ["login-email-input", "login-password-input", "login-submit-button"]) {
    assert(html.includes(`data-testid="${id}"`), `missing ${id}`);
  }
});

await check("GET /api/shifts without a token is 401", async () => {
  const res = await fetch(`${baseUrl}/api/shifts`);
  assert(res.status === 401, `status ${res.status}`);
  const body = await res.json();
  assert(typeof body.error === "string" && Object.keys(body).length === 1, `body ${JSON.stringify(body)}`);
});

await check("wrong password is 401 with the spec error", async () => {
  const res = await postJson("/api/auth/login", { email: USERS[2].email, password: "wrong-password" });
  assert(res.status === 401, `status ${res.status}`);
  const body = await res.json();
  assert(same(body, { error: "Invalid email or password" }), `body ${JSON.stringify(body)}`);
});

for (const u of USERS) {
  await check(`${u.id} (${u.role}) logs in and lists shifts`, async () => {
    const res = await postJson("/api/auth/login", { email: u.email, password: PASSWORD });
    assert(res.status === 200, `login status ${res.status}`);
    const body = await res.json();
    assert(same(Object.keys(body).sort(), ["token", "user"]), `login keys ${Object.keys(body)}`);
    assert(same(body.user, { id: u.id, name: u.name, role: u.role }), `user ${JSON.stringify(body.user)}`);
    assert(/httponly/i.test(res.headers.get("set-cookie") ?? ""), "no httpOnly session cookie");
    tokens[u.id] = body.token;

    const list = await fetch(`${baseUrl}/api/shifts`, { headers: { authorization: `Bearer ${body.token}` } });
    assert(list.status === 200, `shifts status ${list.status}`);
    const { shifts } = await list.json();
    assert(Array.isArray(shifts), "shifts is not an array");
    for (const s of shifts) {
      assert(same(Object.keys(s).sort(), SHIFT_KEYS), `shift ${s.id} keys ${Object.keys(s)}`);
      assert(["open", "filled"].includes(s.status), `shift ${s.id} status ${s.status}`);
      assert((s.status === "open") === (s.claimedBy === null), `shift ${s.id} claimedBy/status mismatch`);
    }
    for (const seed of SEED_SHIFTS) {
      const found = shifts.find((s: { id: string }) => s.id === seed.id);
      assert(found, `${seed.id} missing`);
      for (const [k, v] of Object.entries(seed)) assert(found[k] === v, `${seed.id}.${k} = ${found[k]}`);
    }
  });
}

async function getAs(userId: string, path: string) {
  assert(tokens[userId], `no token for ${userId} (login failed above)`);
  return fetch(`${baseUrl}${path}`, { headers: { authorization: `Bearer ${tokens[userId]}` } });
}

for (const agencyId of ["agency-a", "agency-b"]) {
  await check(`${agencyId} reads its own shifts`, async () => {
    const res = await getAs(agencyId, `/api/agencies/${agencyId}/shifts`);
    assert(res.status === 200, `status ${res.status}`);
    const body = await res.json();
    assert(same(Object.keys(body).sort(), ["agencyId", "shifts"]), `keys ${Object.keys(body)}`);
    assert(body.agencyId === agencyId, `agencyId ${body.agencyId}`);
    for (const s of body.shifts) {
      assert(same(Object.keys(s).sort(), SHIFT_KEYS), `shift ${s.id} keys ${Object.keys(s)}`);
      assert(s.agencyId === agencyId, `shift ${s.id} belongs to ${s.agencyId}`);
    }
    for (const seed of SEED_SHIFTS.filter((x) => x.agencyId === agencyId)) {
      assert(body.shifts.some((s: { id: string }) => s.id === seed.id), `${seed.id} missing`);
    }
  });
}

for (const [userId, path] of [
  ["agency-b", "/api/agencies/agency-a/shifts"],
  ["nurse-1", "/api/agencies/agency-a/shifts"],
] as const) {
  await check(`${userId} reading ${path} is 403`, async () => {
    const res = await getAs(userId, path);
    assert(res.status === 403, `status ${res.status}`);
    const body = await res.json();
    assert(same(body, { error: "You can only view your own agency's shifts" }), `body ${JSON.stringify(body)}`);
  });
}

await check("admin reads an agency's shifts", async () => {
  const res = await getAs("admin-1", "/api/agencies/agency-b/shifts");
  assert(res.status === 200, `status ${res.status}`);
});

// --- Credentials (Part 4) -----------------------------------------------------
const CREDENTIAL_STATUS_KEYS = ["expiresOn", "id", "nurseId", "nurseName", "status"];
type Cred = { id: string; nurseId: string; status: string; expiresOn: string; file?: unknown };
const SEED_CREDENTIALS = [
  { id: "cred-nurse-1", nurseId: "nurse-1", expiresOn: "2027-01-01", status: "approved" },
  { id: "cred-nurse-2", nurseId: "nurse-2", expiresOn: "2026-06-01", status: "approved" },
];

for (const nurse of ["nurse-1", "nurse-2"]) {
  await check(`${nurse} lists only their own credentials, with the seeded one approved`, async () => {
    const res = await getAs(nurse, "/api/credentials");
    assert(res.status === 200, `status ${res.status}`);
    const { credentials } = (await res.json()) as { credentials: Cred[] };
    assert(credentials.every((c) => c.nurseId === nurse), "another nurse's credential is listed");
    const seed = SEED_CREDENTIALS.find((c) => c.nurseId === nurse)!;
    const found = credentials.find((c) => c.id === seed.id);
    assert(found, `${seed.id} missing`);
    for (const [k, v] of Object.entries(seed)) assert(found[k as keyof Cred] === v, `${seed.id}.${k} = ${found[k as keyof Cred]}`);
    assert(found.file === null, `${seed.id} has a file`);
  });
}

for (const agencyId of ["agency-a", "agency-b"]) {
  await check(`${agencyId} sees credential statuses only (no file details)`, async () => {
    const res = await getAs(agencyId, "/api/credentials");
    assert(res.status === 200, `status ${res.status}`);
    const { credentials } = (await res.json()) as { credentials: Cred[] };
    for (const c of credentials) assert(same(Object.keys(c).sort(), CREDENTIAL_STATUS_KEYS), `${c.id} keys ${Object.keys(c)}`);
    for (const seed of SEED_CREDENTIALS) assert(credentials.some((c) => c.id === seed.id), `${seed.id} missing`);
  });
}

await check("admin lists every credential, with the server's date", async () => {
  const res = await getAs("admin-1", "/api/credentials");
  assert(res.status === 200, `status ${res.status}`);
  const { credentials, today } = (await res.json()) as { credentials: Cred[]; today: string };
  for (const seed of SEED_CREDENTIALS) assert(credentials.some((c) => c.id === seed.id), `${seed.id} missing`);
  // The server's UTC date; a day either way allows for a check run at midnight.
  const days = Math.abs(Date.parse(today) - Date.parse(new Date().toISOString().slice(0, 10))) / 86_400_000;
  assert(/^\d{4}-\d{2}-\d{2}$/.test(today) && days <= 1, `today ${today}`);
});

const FILE_FORBIDDEN = "Only the nurse who uploaded it and the admin can open this file";
for (const [userId, status, error] of [
  ["agency-a", 403, FILE_FORBIDDEN],
  ["nurse-2", 403, FILE_FORBIDDEN],
  ["nurse-1", 404, "Credential has no file"],
] as const) {
  await check(`${userId} opening cred-nurse-1's file is ${status}`, async () => {
    const res = await getAs(userId, "/api/credentials/cred-nurse-1/file");
    assert(res.status === status, `status ${res.status}`);
    const body = await res.json();
    assert(same(body, { error }), `body ${JSON.stringify(body)}`);
  });
}

// --- Part 5: timesheets (read-only; checks rules, not what is filled) --------
const SHEET_KEYS = ["nurseId", "nurseName", "shifts", "totalScheduledHours", "totalScheduledMinutes"];
const SHEET_SHIFT_KEYS = [...SHIFT_KEYS, "scheduledHours", "scheduledMinutes"].sort();
const toMinutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));
const round2 = (n: number) => Math.round(n * 100) / 100;

type SheetShift = { id: string; agencyId: string; status: string; claimedBy: string; startTime: string; endTime: string; scheduledMinutes: number; scheduledHours: number };
type Sheet = { nurseId: string; totalScheduledMinutes: number; totalScheduledHours: number; shifts: SheetShift[] };

await check("GET /api/timesheets without a token is 401", async () => {
  const res = await fetch(`${baseUrl}/api/timesheets`);
  assert(res.status === 401, `status ${res.status}`);
});

for (const u of USERS) {
  await check(`${u.id} (${u.role}) reads timesheets: own scope, hours add up`, async () => {
    const res = await getAs(u.id, "/api/timesheets");
    assert(res.status === 200, `status ${res.status}`);
    const body = await res.json();
    assert(same(Object.keys(body), ["timesheets"]), `keys ${Object.keys(body)}`);
    const sheets = body.timesheets as Sheet[];
    if (u.role === "nurse") assert(same(sheets.map((s) => s.nurseId), [u.id]), `nurses ${sheets.map((s) => s.nurseId)}`);
    for (const sheet of sheets) {
      assert(same(Object.keys(sheet).sort(), SHEET_KEYS), `sheet ${sheet.nurseId} keys ${Object.keys(sheet)}`);
      let total = 0;
      for (const s of sheet.shifts) {
        assert(same(Object.keys(s).sort(), SHEET_SHIFT_KEYS), `shift ${s.id} keys ${Object.keys(s)}`);
        assert(s.status === "filled" && s.claimedBy === sheet.nurseId, `shift ${s.id} is ${s.status}, held by ${s.claimedBy}`);
        if (u.role === "agency") assert(s.agencyId === u.id, `shift ${s.id} belongs to ${s.agencyId}`);
        const length = (toMinutes(s.endTime) - toMinutes(s.startTime) + 24 * 60) % (24 * 60); // overnight wraps
        assert(s.scheduledMinutes === length && s.scheduledHours === round2(length / 60), `shift ${s.id}: ${s.scheduledMinutes} min`);
        total += s.scheduledMinutes;
      }
      assert(sheet.totalScheduledMinutes === total, `${sheet.nurseId} total ${sheet.totalScheduledMinutes} ≠ ${total}`);
      assert(sheet.totalScheduledHours === round2(total / 60), `${sheet.nurseId} hours ${sheet.totalScheduledHours}`);
    }
  });
}

await check("/timesheets renders the timesheet-table, labelled as scheduled hours", async () => {
  assert(tokens["nurse-1"], "no token for nurse-1 (login failed above)");
  const res = await fetch(`${baseUrl}/timesheets`, { headers: { cookie: `shiftpatch_token=${tokens["nurse-1"]}` } });
  assert(res.status === 200, `status ${res.status}`);
  const html = await res.text();
  assert(html.includes('data-testid="timesheet-table"'), "missing timesheet-table");
  assert(html.includes("Scheduled hours — not actual time worked"), "missing the scheduled-hours label");
});

console.log(failures === 0 ? "Smoke check passed." : `Smoke check FAILED (${failures}).`);
process.exit(failures === 0 ? 0 : 1);

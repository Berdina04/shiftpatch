// Guard run by scripts/vercel-build.sh before migrating or seeding.
// Production builds pass straight through. Every other Vercel build (preview)
// must prove, through Neon's API, that each database URL it will use belongs to
// its own Neon branch, `preview/<git branch>`, and not the default (production)
// branch. Anything missing or unexpected fails the build: a preview must never
// migrate or seed production.
//
// Needs NEON_API_KEY in Vercel (sensitive, Preview only). Neon's integration
// provides NEON_PROJECT_ID and the branch's DATABASE_URL / DATABASE_URL_UNPOOLED;
// Vercel provides VERCEL_ENV and VERCEL_GIT_COMMIT_REF.
// NEON_API_URL overrides the API base URL (tests only).

const API = (process.env.NEON_API_URL ?? "https://console.neon.tech/api/v2").replace(/\/$/, "");

function fail(message) {
  console.error(`Preview database guard: FAILED. ${message}`);
  console.error("Refusing to migrate or seed. See scripts/check-preview-database.mjs.");
  process.exit(1);
}

const vercelEnv = process.env.VERCEL_ENV;
if (vercelEnv === "production") {
  console.log("Preview database guard: production build, nothing to check.");
  process.exit(0);
}
if (!vercelEnv) fail("VERCEL_ENV is not set; this script only runs in Vercel builds.");

const missing = ["NEON_API_KEY", "NEON_PROJECT_ID", "DATABASE_URL", "VERCEL_GIT_COMMIT_REF"].filter(
  (name) => !process.env[name],
);
if (missing.length > 0) fail(`Missing ${missing.join(", ")} in this ${vercelEnv} build.`);

const project = process.env.NEON_PROJECT_ID;
const expectedBranch = `preview/${process.env.VERCEL_GIT_COMMIT_REF}`;

/** The Neon endpoint ID in a connection string's host (ep-...-pooler.region... → ep-...). */
function endpointId(name, url) {
  let host;
  try {
    host = new URL(url).hostname;
  } catch {
    fail(`${name} is not a valid URL.`);
  }
  const label = host.split(".")[0].replace(/-pooler$/, "");
  if (!/^ep-[a-z0-9-]+$/.test(label) || !host.endsWith(".neon.tech")) fail(`${name} is not a Neon host.`);
  return label;
}

async function neon(path) {
  let res;
  try {
    res = await fetch(`${API}/projects/${encodeURIComponent(project)}${path}`, {
      headers: { authorization: `Bearer ${process.env.NEON_API_KEY}`, accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    fail(`Neon API unreachable (${err instanceof Error ? err.name : "error"}).`);
  }
  if (!res.ok) fail(`Neon API answered ${res.status} for ${path.split("/")[1]}.`);
  return res.json();
}

const urls = [["DATABASE_URL", process.env.DATABASE_URL]];
if (process.env.DATABASE_URL_UNPOOLED) urls.push(["DATABASE_URL_UNPOOLED", process.env.DATABASE_URL_UNPOOLED]);

for (const [name, url] of urls) {
  const { endpoint } = await neon(`/endpoints/${endpointId(name, url)}`);
  const { branch } = await neon(`/branches/${encodeURIComponent(endpoint.branch_id)}`);
  if (branch.default === true || branch.primary === true) {
    fail(`${name} points at the default (production) branch "${branch.name}".`);
  }
  if (branch.name !== expectedBranch) {
    fail(`${name} points at branch "${branch.name}", expected "${expectedBranch}".`);
  }
  console.log(`Preview database guard: ${name} is on Neon branch ${branch.name} (${branch.id}).`);
}
console.log("Preview database guard: ok.");

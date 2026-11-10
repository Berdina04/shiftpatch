// scripts/check-preview-database.mjs and its place in scripts/vercel-build.sh:
// a non-production build must stop before migrating or seeding unless Neon's
// API says its database is its own preview branch. Neon's API is faked here.
import { execFile } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const run = promisify(execFile);
const root = path.resolve(import.meta.dirname, "../..");
const GUARD = path.join(root, "scripts/check-preview-database.mjs");
const BUILD = path.join(root, "scripts/vercel-build.sh");

const BRANCHES: Record<string, { id: string; name: string; default: boolean }> = {
  "br-main": { id: "br-main", name: "main", default: true },
  "br-own": { id: "br-own", name: "preview/claude/close-part-2", default: false },
  "br-other": { id: "br-other", name: "preview/someone-else", default: false },
};
const ENDPOINTS: Record<string, string> = { "ep-prod-aaa": "br-main", "ep-own-bbb": "br-own", "ep-other-ccc": "br-other" };

let server: Server;
let api = "";
let requests: string[] = [];
let failWith: number | null = null;

beforeAll(async () => {
  server = createServer((req, res) => {
    requests.push(req.url ?? "");
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (failWith) return send(failWith, { message: "fake failure" });
    if (req.headers.authorization !== "Bearer test-key") return send(401, { message: "bad key" });
    const m = /^\/projects\/proj-1\/(endpoints|branches)\/([\w-]+)$/.exec(req.url ?? "");
    if (m?.[1] === "endpoints" && ENDPOINTS[m[2]]) return send(200, { endpoint: { id: m[2], branch_id: ENDPOINTS[m[2]] } });
    if (m?.[1] === "branches" && BRANCHES[m[2]]) return send(200, { branch: BRANCHES[m[2]] });
    send(404, { message: "not found" });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  api = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
beforeEach(() => {
  requests = [];
  failWith = null;
});

const url = (endpoint: string, pooled: boolean) =>
  `postgresql://user:pw@${endpoint}${pooled ? "-pooler" : ""}.us-east-1.aws.neon.tech/neondb?sslmode=require`;

/** A preview build on its own branch; each case overrides what it breaks. */
const ownPreview = () => ({
  VERCEL_ENV: "preview",
  VERCEL_GIT_COMMIT_REF: "claude/close-part-2",
  NEON_PROJECT_ID: "proj-1",
  NEON_API_KEY: "test-key",
  DATABASE_URL: url("ep-own-bbb", true),
  DATABASE_URL_UNPOOLED: url("ep-own-bbb", false),
});

/** Only the given variables, plus PATH and the fake API (never the test database's). */
function childEnv(env: Record<string, string | undefined>, pathPrefix = ""): NodeJS.ProcessEnv {
  const set = Object.entries(env).filter(([, v]) => v !== undefined);
  return { NODE_ENV: "test", PATH: `${pathPrefix}${process.env.PATH}`, NEON_API_URL: api, ...Object.fromEntries(set) };
}

async function guard(env: Record<string, string | undefined>) {
  try {
    const { stdout } = await run(process.execPath, [GUARD], { env: childEnv(env) });
    return { code: 0, out: stdout };
  } catch (err) {
    const e = err as { code: number; stdout: string; stderr: string };
    return { code: e.code, out: e.stdout + e.stderr };
  }
}

describe("preview database guard", () => {
  it("passes a preview whose both URLs are on its own preview branch", async () => {
    const r = await guard(ownPreview());
    expect(r.code).toBe(0);
    expect(r.out).toContain("DATABASE_URL is on Neon branch preview/claude/close-part-2 (br-own)");
    expect(r.out).toContain("DATABASE_URL_UNPOOLED is on Neon branch preview/claude/close-part-2 (br-own)");
  });

  it("lets a production build through without calling Neon", async () => {
    const r = await guard({ VERCEL_ENV: "production" });
    expect(r.code).toBe(0);
    expect(requests).toStrictEqual([]);
  });

  it.each<[string, Record<string, string | undefined>, string]>([
    ["the database is the default (production) branch", { DATABASE_URL: url("ep-prod-aaa", true), DATABASE_URL_UNPOOLED: undefined }, 'points at the default (production) branch "main"'],
    ["only the unpooled URL (used by migrations) is production", { DATABASE_URL_UNPOOLED: url("ep-prod-aaa", false) }, "DATABASE_URL_UNPOOLED points at the default (production) branch"],
    ["the database is another PR's preview branch", { DATABASE_URL: url("ep-other-ccc", true) }, 'points at branch "preview/someone-else", expected "preview/claude/close-part-2"'],
    ["NEON_API_KEY is not set", { NEON_API_KEY: undefined }, "Missing NEON_API_KEY"],
    ["the API key is rejected", { NEON_API_KEY: "wrong-key" }, "Neon API answered 401"],
    ["the endpoint is unknown to the project", { DATABASE_URL: url("ep-unknown-ddd", true) }, "Neon API answered 404"],
    ["the host is not a Neon host", { DATABASE_URL: "postgresql://u:p@db.example.com/neondb" }, "DATABASE_URL is not a Neon host"],
    ["VERCEL_ENV is not set", { VERCEL_ENV: undefined }, "VERCEL_ENV is not set"],
  ])("fails when %s", async (_name, override, message) => {
    const r = await guard({ ...ownPreview(), ...override });
    expect(r.code).toBe(1);
    expect(r.out).toContain(message);
    expect(r.out).toContain("Refusing to migrate or seed");
  });

  it("fails when Neon's API is down", async () => {
    failWith = 503;
    const r = await guard(ownPreview());
    expect(r.code).toBe(1);
    expect(r.out).toContain("Neon API answered 503");
  });

  it("never prints the connection strings or the API key", async () => {
    const r = await guard({ ...ownPreview(), DATABASE_URL: url("ep-prod-aaa", true) });
    expect(r.out).not.toContain("user:pw");
    expect(r.out).not.toContain("test-key");
  });
});

describe("vercel-build.sh", () => {
  // A fake `npx` records every command the build would run.
  let bin: string;
  beforeAll(() => {
    bin = mkdtempSync(path.join(tmpdir(), "fake-npx-"));
    writeFileSync(path.join(bin, "npx"), `#!/bin/sh\necho "$*" >> "${bin}/calls"\n`);
    chmodSync(path.join(bin, "npx"), 0o755);
  });
  afterAll(() => rmSync(bin, { recursive: true, force: true }));

  async function build(env: Record<string, string | undefined>) {
    rmSync(path.join(bin, "calls"), { force: true });
    let code = 0;
    try {
      await run("sh", [BUILD], { cwd: root, env: childEnv(env, `${bin}:`) });
    } catch (err) {
      code = (err as { code: number }).code;
    }
    let calls: string[] = [];
    try {
      calls = readFileSync(path.join(bin, "calls"), "utf8").trim().split("\n");
    } catch {
      // No npx call was made.
    }
    return { code, calls };
  }

  it("stops before migrating or seeding when the guard fails", async () => {
    const r = await build({ ...ownPreview(), DATABASE_URL: url("ep-prod-aaa", true) });
    expect(r.code).not.toBe(0);
    expect(r.calls).toStrictEqual([]);
  });

  it("migrates, seeds and builds after the guard passes", async () => {
    const r = await build(ownPreview());
    expect(r.code).toBe(0);
    expect(r.calls).toStrictEqual(["prisma migrate deploy", "tsx prisma/seed.ts", "next build"]);
  });
});

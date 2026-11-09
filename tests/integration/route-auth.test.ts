// Every API route requires login unless it is listed as public here.
// New routes are picked up automatically, so a missing auth check fails CI.
import { globSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { makeRequest } from "../support/http";

const PUBLIC_ROUTES = new Set(["POST /api/auth/login", "POST /api/auth/logout"]);
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

const root = path.resolve(import.meta.dirname, "../..");
const routeFiles = globSync("app/api/**/route.ts", { cwd: root });

type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

async function collectRoutes() {
  const routes: { name: string; urlPath: string; params: Record<string, string>; handler: Handler }[] = [];
  for (const file of routeFiles) {
    const segments = path.dirname(file).split(path.sep).slice(1); // drop "app"
    const params: Record<string, string> = {};
    const urlPath =
      "/" +
      segments
        .map((s) => {
          const m = /^\[(.+)\]$/.exec(s);
          if (!m) return s;
          params[m[1]] = "shift-1";
          return "shift-1";
        })
        .join("/");
    const mod = (await import(pathToFileURL(path.join(root, file)).href)) as Record<string, unknown>;
    for (const method of METHODS) {
      if (typeof mod[method] === "function") {
        routes.push({ name: `${method} ${urlPath}`, urlPath, params, handler: mod[method] as Handler });
      }
    }
  }
  return routes;
}

const routes = await collectRoutes();
const protectedRoutes = routes.filter((r) => !PUBLIC_ROUTES.has(r.name));

describe("auth check on every route", () => {
  it("finds the API routes", () => {
    expect(routes.map((r) => r.name)).toContain("GET /api/shifts");
  });

  it.each(protectedRoutes.map((r) => [r.name, r] as const))("%s returns 401 without a token", async (_name, route) => {
    const method = route.name.split(" ")[0];
    const req = makeRequest(route.urlPath, { method, rawBody: method === "GET" ? undefined : "{}" });
    const res = await route.handler(req, { params: Promise.resolve(route.params) });
    expect(res.status).toBe(401);
    expect(await res.json()).toStrictEqual({ error: "Authentication required" });
  });
});

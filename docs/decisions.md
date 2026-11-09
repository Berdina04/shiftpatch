# ShiftPatch — Decisions

Decisions that block Part 1 of [plan.md](plan.md). Fixed before this list: Next.js, Postgres, Prisma, TypeScript.

## 1. Auth: custom JWT + bcrypt, httpOnly cookie, role read on each request

**Decision**
- Our own `POST /api/auth/login` checks the password with bcrypt and signs a JWT (8 h lifetime).
- The token is returned in the response body, as the spec requires, and also set as an `httpOnly`, `Secure`, `SameSite=Lax` cookie for the UI.
- API routes accept `Authorization: Bearer <token>` or the cookie.
- On every request the server loads the user and their role from the database; the token only identifies who is calling.

**Reason**
- The spec fixes the login route, its request and its response (a JWT in the body). Auth.js owns `/api/auth/*` and its own session model, and hosted providers like Clerk would need a proxy to fit that contract.
- `httpOnly` keeps the token out of reach of page scripts; `Secure` sends it over HTTPS only; `SameSite=Lax` stops other sites from triggering requests with the user's cookie (CSRF).
- Reading the role from the database on each request means a role or permission change applies at once, instead of when the 8 h token expires. That is what makes the role-based permissions real rather than trusted from the token.

**Alternatives considered:** Auth.js Credentials provider; Clerk.

## 2. Hosting: Vercel + Neon

**Decision:** the app is deployed on Vercel; Postgres is Neon, using its pooled connection URL for the app and the direct URL for migrations.

**Reason:** Vercel is the natural host for Next.js and gives a preview deployment for every PR. Neon's pooled connections suit serverless functions, which open many short-lived connections.

**Alternatives considered:** Railway or Render (one long-running server plus Postgres).

## 3. Tests run on real Postgres

**Decision:** integration tests for the race conditions and rollbacks run against a real Postgres: Docker locally, a service container in CI. No mocked database for these tests.

**Reason:** "Two nurses can't claim the same shift" and "a failed operation changes nothing" depend on real row locks, conditional updates and transactions. A mocked Prisma client can't reproduce concurrent requests or a rollback, so it can't prove either guarantee.

**Alternatives considered:** mocked Prisma client.

## 4. Real-time: polling, plus an immediate refresh after a 409

**Decision:** shift lists and the admin dashboard poll every 10 s. When a claim returns 409 (the shift is already taken), the list refreshes at that moment instead of waiting for the next poll. Other errors don't trigger an early refresh.

**Reason:**
- SSE and WebSockets need long-lived connections, which fight serverless function time limits on Vercel. A third-party push service (Pusher, Ably) adds a vendor for little gain at this size.
- Correctness never depends on how fresh the list is: the server decides who gets a shift, and a claim on stale data gets a 409.
- Refreshing on a 409 fixes an out-of-date list the moment the nurse runs into it, which is when it matters.

**Alternatives considered:** SSE; Pusher or Ably.

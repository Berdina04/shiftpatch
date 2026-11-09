# ShiftPatch — Build Plan

Source of truth: [spec.md](spec.md) (not modified). Stack and architecture decisions: [decisions.md](decisions.md).

Budget: 8 hours this week, no buffer. Every part ends deployed and working end to end.

## Spec gaps and how we resolve them

| Gap in the spec | Resolution |
|---|---|
| `admin-shift-status-badge` lists `cancelled`, but `/cancel` reopens the shift to `open`; nothing produces `cancelled`. | `/cancel` stays as specified and reopens the shift. Each cancellation is kept in the shift's history, and the admin view shows a "reopened (no-show / advance)" marker next to the status badge. |
| Agency login must return `user.id`, but agencies have no user id in the seed. | `user.id` = `agencyId` (`agency-a`, `agency-b`); `user.name` = agency name. |
| All seed shifts (Oct 2026) are in the past, yet the spec's claim example on `shift-1` must succeed. | Past-dated shifts can be claimed. **Required to make the spec work.** |
| Agency-route examples show 3 fields; the text says "same shape as above". | Return the full shift shape. |

### Decisions required to make the spec work

1. **Past-dated shifts are claimable.** Every seed shift is before today, and the spec's `POST /api/shifts/shift-1/claim` example must return 200.
2. **Back-to-back shifts don't overlap.** Maria holds `shift-2` (2026-10-03 07:00–19:00) and the spec's example has her claim `shift-1` (2026-10-02 19:00 → 2026-10-03 07:00). Shift intervals are half-open `[start, end)`: ending at 07:00 and starting at 07:00 is allowed.
3. **Agency login returns `user.id = agencyId`.**
4. **The agency shifts route returns the full shift shape.**

## Product rules

- **Cancel permissions:**
  - Nurse: only their own claimed shift, reason `advance` only.
  - Agency: only its own shifts, reason `advance` or `no-show`.
  - Admin: any shift, either reason.
- **Overlap:** a nurse can't hold two overlapping shifts, even at different agencies.
- **Credentials:**
  - A new upload is `pending` until an admin reviews the file and approves it (or rejects it).
  - Claims only check approved credentials.
  - Seeded credentials count as approved.
- **Credential file access:** only the owning nurse and admin can open files. Agencies see the status only.
- **Timesheets:** a summary of scheduled hours, labelled that way in the UI ("Scheduled hours — not actual time worked").
- **Shift list freshness:** polling every 10 s; after a 409 on claim, the list refreshes immediately instead of waiting for the next poll.

## Testing approach

- **Vitest integration tests** run against a real Postgres (Docker locally, service container in CI).
- **One Playwright test per part**, driven by the spec's `data-testid`s. Playwright runs in CI against a freshly seeded database.
- **Production** gets a read-only smoke check only, because tests that change data would change the seed state.
- CI runs typecheck, ESLint, Vitest and Playwright; all must be green.

## Parts

### Part 1 — Login + shift list, deployed (2 h)

- **Includes:**
  - Next.js + Prisma schema, exact seed (insert-if-missing) and a reset script.
  - `POST /api/auth/login`, auth check on every route, `GET /api/shifts`.
  - Login page and open-shift list.
  - CI (typecheck, ESLint, Vitest and Playwright on Postgres).
  - Vercel + Neon deploy running migrations.
- **Done when:** all 5 seed users can log in on the public URL and CI is green.
- **Verified by:** login per role, 401 (bad password, missing token) and response-shape tests; production smoke check.
- **Playwright:** Maria logs in and sees the open shifts.

### Part 2 — Posting and claiming, with the guarantees (2 h)

- **Includes:**
  - `POST /api/shifts`, `POST /api/shifts/:id/claim`, `GET /api/agencies/:agencyId/shifts`.
  - Agency post form; claim button with notification banner.
  - Claim requires an approved credential valid through the end of the shift, and passes the overlap check.
  - Claim is a conditional `UPDATE … WHERE status = 'open'`; the nurse's row is locked (`SELECT … FOR UPDATE`) before the overlap check.
  - Audit entries written in the same transaction as the change.
  - Immediate list refresh after a 409; 10 s polling otherwise.
- **Done when:** on production, an agency can post, Maria can claim, and James gets a 403.
- **Verified by:**
  - **Permissions:** every route × every role (e.g. agency-b on agency-a's route → 403, nurse posting → 403).
  - **Race:** 20 parallel claims on one shift → exactly one 200, nineteen 409, one claimant in the database.
  - **Overlap race:** one nurse claims two overlapping shifts in parallel → exactly one succeeds.
  - **Rollback:** force the audit insert to fail → the shift is unchanged.
- **Playwright:** an agency posts a shift and Maria claims it ("Shift claimed"). A second tab with an out-of-date list clicks claim, gets "already taken", and the row disappears without waiting for polling.

### Part 3 — Cancel/no-show, admin dashboard, audit log (1.5 h)

- **Includes:**
  - `POST /api/shifts/:id/cancel` with the cancel permission rules; each cancellation kept in the shift's history.
  - Admin shift table with status badges and a "reopened (no-show / advance)" marker.
  - Audit log table.
- **Verified by:** permission tests per role and reason; cancel-vs-claim race; a reopened shift can be claimed by another nurse; rollback test.
- **Playwright:** an agency marks a no-show; the admin sees the shift open with the "reopened (no-show)" marker and the audit entry.

### Part 4 — Credentials with admin approval (2 h)

- **Includes:**
  - Upload of the file and expiry date, stored in Postgres (saved in the same transaction as its row, private by default, 4 MB max).
  - Status `pending` → `approved` / `rejected`.
  - Admin review queue where the admin can open the file.
  - File access for the owning nurse and admin only; agencies see status only.
  - Seeded credentials are approved.
- **Verified by:** an agency or another nurse opening a file → 403; a pending credential doesn't allow claims; approval does; a failed upload changes nothing; bad file type or size → 400.
- **Playwright:** James uploads a credential, is still blocked, the admin approves it, and James claims a shift.

### Part 5 — Timesheets (0.5 h)

- **Includes:** each nurse's scheduled hours from filled shifts, labelled as scheduled hours, scoped by role (nurse: own; agency: own shifts; admin: all).
- **Verified by:** 19:00–07:00 counts as 12 h; scoping tests.
- **Playwright:** Maria sees 12 h for `shift-2`.

## Test IDs → parts

| Test ID | Part | Covered by the Playwright test for |
|---|---|---|
| `login-email-input` | 1 | Maria logs in |
| `login-password-input` | 1 | Maria logs in |
| `login-submit-button` | 1 | Maria logs in |
| `shift-list-item` | 1 | Maria logs in |
| `agency-post-shift-button` | 2 | Post + claim |
| `agency-post-shift-submit-button` | 2 | Post + claim |
| `shift-claim-button` | 2 | Post + claim |
| `notification-banner` | 2 | Post + claim |
| `shift-cancel-button` | 3 | No-show |
| `admin-dashboard-shift-table` | 3 | No-show |
| `admin-shift-status-badge` | 3 | No-show |
| `audit-log-table` | 3 | No-show |
| `credential-upload-input` | 4 | James's approval |
| `credential-expiry-date-input` | 4 | James's approval |
| `timesheet-table` | 5 | Scheduled hours |

## Cut first if we run out of time (in order)

1. UI polish.
2. 10 s polling, replaced by a refresh button (the refresh after a 409 stays).
3. Nurses downloading their own credential file (admin keeps file access for reviews).
4. Rejection with a reason (admin approves, or the credential stays pending).

**Never cut:** the spec routes, the 15 test IDs, the guarantee tests (permissions, both races, rollback), the approval step.

## Out of scope

Email notifications, PostHog, document export (needs an access policy for third-party medical data first).

## Assumptions

- **Errors:** all `{ "error": "<message>" }`. Unknown shift → 404; validation → 400; claiming a filled shift → 409; cancelling an open shift → 409.
- **Claim check order:** missing shift (404) → credential (403) → already taken (409) → overlap (409).
- **Credentials:**
  - No approved credential → 403 "No approved credential, cannot claim shift"; expired → 403 "Credential expired, cannot claim shift" (spec).
  - A credential must be valid today and through the end of the shift (overnight shifts end the next day); the expiry date itself is not valid.
  - Any approved, valid credential counts; a new pending upload doesn't cancel an approved one.
  - The admin approves or rejects and doesn't edit expiry dates.
  - Existing claims are left alone if a credential later expires or is rejected.
- **Cancellation:**
  - `advance` is a reason label, not checked against the clock (seed shifts are in the past).
  - A nurse sending `no-show` → 403.
  - The admin marker shows the latest cancellation, even after the shift is claimed again.
- **Shifts:**
  - IDs are `shift-<sequence>`.
  - `endTime < startTime` means an overnight shift; `startTime = endTime` is rejected.
  - No RN/LPN qualification matching (the roster has no qualifications).
- **Access:** `GET /api/shifts` requires login (any role); the UI's open-shift list filters to `open`.
- **Audit log:** admin-only, append-only, records successful changes only; denied attempts go to server logs.
- **Auth:** 8 h tokens with no revocation; no login rate limit this week.
- **Seed:** insert-if-missing, so deploys never reset production state; a separate reset script restores trial-start data.

# ShiftPatch — Build Plan

Source of truth: [spec.md](spec.md) (not modified). Stack and architecture decisions: [decisions.md](decisions.md).

Budget: 8 hours this week, no buffer. Every part ends deployed and working end to end.

## Status

| Part | Status |
|---|---|
| 1 — Login + shift list | **Done, merged ([PR #1](https://github.com/Berdina04/shiftpatch/pull/1)).** Production (https://shiftpatch-phi.vercel.app) serves `main` (`097c646`); `npm run smoke -- https://shiftpatch-phi.vercel.app` passes (all 5 seed logins, 401s, shift shape). Vercel project `shiftpatch`; Neon `shiftpatch-db` (free, `iad1`) and `JWT_SECRET` are set for Production and Preview. |
| 2 — Posting and claiming | **Done, merged ([PR #2](https://github.com/Berdina04/shiftpatch/pull/2)).** Production serves `main` (`691542c`): its build applied the Part 2 migration, and `npm run smoke -- https://shiftpatch-phi.vercel.app` passes (13 checks, including the agency route and its 403s); the smoke check's denied requests appear in the production logs as `request.denied` lines. CI was green on PR #2. The full flow (`npm run preview-flow`) passed on the PR's preview, on its own Neon branch, at `fbd40b0`. The previews for the review fixes never built: Neon's "Create database branch for deployment" step timed out twice, with no incident on Neon's or Vercel's status pages. So the review fixes were checked locally, in CI and by the production smoke check only. |
| 3 — Cancel/no-show, admin, audit | **Done in [PR #4](https://github.com/Berdina04/shiftpatch/pull/4).** CI green at `5263d71`. Preview check on PR #4's latest preview (`shiftpatch-k1wpo885f`, commit `5263d71`, on its own Neon branch `br-aged-lab-bcnlz4op`): `npm run preview-flow` passed (16 checks), and agency-a marking `shift-2` as a no-show returned 200 with the spec's body. Locally: typecheck, ESLint, Vitest (228 tests), build and Playwright (6 passed). Review ([reviews/part-3.md](reviews/part-3.md)): findings 2–4 fixed, finding 1 accepted as a known limitation (see notes). Production gets only the read-only smoke check after merge. |
| 4 — Credentials | **Done, merged ([PR #5](https://github.com/Berdina04/shiftpatch/pull/5)).** Production (https://shiftpatch-phi.vercel.app) serves `main` (`4c5d3b4`): its build applied the Part 4 migration (`20261111090000_credential_files`), and `npm run smoke -- https://shiftpatch-phi.vercel.app` passes (21 checks, including the credential lists per role and the file route's 403/404s). CI was green on PR #5's last commit (`35a8ff6`) and on the review fixes (`833d0fe`). Review ([reviews/part-4.md](reviews/part-4.md)): findings 1–3 fixed. Preview checks, both on PR #5's own Neon branch `br-noisy-fire-bc171521`: `npm run preview-flow` passed at `2ee26ae` (29 checks), and read-only checks passed at `833d0fe` (`preview-flow` wasn't rerun, because the Neon branch kept the first run's data). |
| 5 — Timesheets | Not started |

Part 1 notes:
- Neon preview branching is on: each preview deployment gets its own Neon branch, so `scripts/vercel-build.sh` runs migrations and the seed on every deployment.
- Approved additions beyond the plan (2026-11-09): `POST /api/auth/logout` with a "Log out" link; database CHECK constraints (a filled shift always has a claimant; times are `HH:MM` and start ≠ end); case-insensitive login email; credentials seeded from Part 1; every role lands on the open-shift list until Parts 2–3 add their pages.

Part 2 notes:
- **Production stays at the seed state** (decision 2026-11-10), so the spec examples keep working there (e.g. Maria claims `shift-1` → 200). No posts or claims on production: "Done when" is checked on the PR's preview deployment and its own Neon branch, and production gets only `npm run smoke`.
- Claim transaction ([lib/claims.ts](../lib/claims.ts)), READ COMMITTED: lock the nurse's row (`SELECT … FOR UPDATE`), then 404 → credential 403 → taken 409 → overlap 409, then `UPDATE … WHERE status = 'open'` (0 rows → 409) and the audit insert, all in one transaction.
- Approved additions beyond the plan (2026-11-10):
  - `AuditLog` table; posting is audited (`shift.posted`) as well as claiming (`shift.claimed`).
  - Shift ids come from the database sequence `shift_id_seq`; the next id after the seed is `shift-4`, and the reset script restarts it.
  - `role` is `RN` or `LPN`; past dates can be posted (the spec's own example is past).
  - The admin may read any agency's list (`GET /api/agencies/:agencyId/shifts`); an unknown agency is 404 for the admin and 403 for an agency.
  - Error messages: 403 "Only agencies can post shifts" / "Only nurses can claim shifts" / "You can only view your own agency's shifts"; 404 "Shift not found" / "Agency not found"; 409 "Shift already taken" / "Shift overlaps another shift you hold"; 400 per field.
  - "Today" in the credential check is the UTC date. "Credential expired, cannot claim shift" covers both "already expired" and "expires before the shift ends".
  - New `/agency` page (own shifts + post form); agencies land there; the admin stays on `/shifts` until Part 3.
  - Tests: the race uses 20 test-only nurses; the rollback test forces the audit insert to fail with a temporary trigger. Each guarantee test was checked by breaking the code it guards (no `AND status = 'open'`, no `FOR UPDATE`, audit after commit, no refresh after a 409) and seeing it fail.
- Review ([reviews/part-2.md](reviews/part-2.md)): all five findings fixed (approved 2026-11-10).
  - Tests pin their clock to 2026-11-10 (`tests/support/pin-clock.mjs`, in Vitest and in the server Playwright starts), so the spec examples keep passing after Maria's credential expires on 2027-01-01. Production is not pinned: from that date the spec's claim example returns 403 there (README).
  - Denied requests (401, 403, 409) are logged as one JSON line (`request.denied`: method, path, status, error, caller id and role; no token or body). They are never audited.
  - The credential check compares dates as numbers, not `YYYY-MM-DD` text.
  - Playwright: the stale tab pauses relative to its own clock; the agency's list is checked to update on its 10 s poll without a reload.
- Open (2026-11-10): Neon's preview branch creation timed out on the last two preview deployments. Check the Neon project before Part 3, since every PR's preview needs it.
- `npm run preview-flow -- <preview-url>` runs the full Part 2 flow against a PR preview. It refuses production and any deployment without its own Neon branch, and passes only on the first run per PR branch.

Part 3 notes:
- Review ([reviews/part-3.md](reviews/part-3.md)), decisions 2026-11-10:
  - Fixed: 2 (one snapshot for the dashboard), 3 (no default reason), 4 (dashboard shifts in the spec's shape).
  - Not fixed: 1, recorded as a known limitation below.
- Approved additions beyond the plan (2026-11-10):
  - `ShiftCancellation` table: one row per cancellation (shift, reason, previous nurse, who cancelled), written in the cancel's transaction. It has no foreign keys to `User` (see "No deadlock" below). The admin's marker is the latest row.
  - Admin-only `GET /api/admin/dashboard` returns `{ shifts, shiftDetails, auditLog }`. Other roles get 403 "Only the admin can view the dashboard".
    - `shifts`: every shift, in the spec's shape.
    - `shiftDetails`: keyed by shift id, `{ claimedByName, lastCancellation }`. `lastCancellation` is the marker.
    - `auditLog`: the newest 100 entries.
    - All of it is read in one read-only `REPEATABLE READ` transaction, so a change that commits mid-read shows up everywhere in the response or nowhere.
  - The admin lands on `/admin`. Cancel buttons:
    - Agency and admin rows: a reason picker that starts on "Choose a reason". The button stays disabled until a reason is picked, so a no-show is never recorded by default.
    - Nurses' "My shifts" on `/shifts`: advance only, one click.
  - Error messages:
    - 400: "reason must be no-show or advance" / "nurseId must be a string".
    - 403: "Nurses can only cancel in advance" / "You can only cancel your own agency's shifts" / "You can only cancel your own shifts".
    - 409: "Shift is not claimed" / "Shift is now held by another nurse".
  - Optional `nurseId` in the cancel body: the nurse the caller's page showed. If another nurse holds the shift by then, the cancel returns 409, so a stale page can't mark the wrong nurse as a no-show. The UI always sends it; without it, the route behaves exactly as the spec says.
- **Known limitation (decision 2026-11-10, review finding 1):** `nurseId` names the nurse, not one claim. Suppose Maria cancels `shift-2` and claims it again. An agency page loaded before that still shows Maria, and its cancel goes through against her new claim. This is accepted: a no-show is about the nurse, and she is still the one assigned, as the page shows. There is no claim version, and the spec routes are unchanged.
- Cancel transaction ([lib/cancellations.ts](../lib/cancellations.ts)), READ COMMITTED:
  1. Lock the shift row (`SELECT … FOR NO KEY UPDATE`).
  2. Checks, in order: 400 reason → 403 nurse `no-show` → 404 → 403 another agency's shift → 409 open → 409 held by another nurse (`nurseId`) → 403 not your shift.
  3. Reopen the shift, insert the history row and write the `shift.cancelled` audit entry, all in the same transaction.
- No deadlock with claim: the shift row is the only lock a cancel waits for, and it waits for nothing once it holds it. The history row has no FK to `User`, and clearing `claimedById` runs no FK check, so a cancel never locks a nurse's row; a claim locks its nurse first, then at most the shift.
  - Experiment: even with FKs from the history row to `User`, 50 rounds of each race produced no deadlock. A claim only waits on a shift row it read as open, while a cancel only holds a filled one.
- Tests:
  - The race tests accept only their expected statuses, so any 500 (a deadlock included) fails them.
  - Stale-cancel test: the test holds the shift's row lock while it swaps the claimant, so the result doesn't depend on timing.
  - Dashboard snapshot test: the test locks `AuditLog`, so the dashboard's audit read waits after its shift read, and commits a cancellation in that gap. The response must show the state from before the cancellation in every part.
  - Each guarantee test was checked by breaking the code it guards:
    - No row lock: double-cancel fails 9/10 rounds, and both stale-cancel tests fail.
    - Audit written after commit: the rollback test fails.
    - `nurseId` ignored: both `nurseId` tests fail.
    - Injected 500s: the race tests fail.
    - Parallel dashboard reads (the pre-review code): the snapshot test fails with the review's response.
    - `no-show` preselected in the picker: the Part 3 Playwright test fails.
  - Claim's conditional `UPDATE` is still guarded mainly by Part 2's 20-nurse race. The cancel-vs-claim race caught its removal in only 1 of 50 rounds.

Part 4 notes:
- Review ([reviews/part-4.md](reviews/part-4.md)), decision 2026-11-11: all three findings fixed.
  - 1: an upload response is merged into the nurse's list by id, so a poll that already brought the credential in doesn't leave two rows.
  - 2: `GET /api/credentials` also returns the server's UTC date (`today`). The nurse's and the agency's lists label expiry with the date from each poll, so a page left open past midnight agrees with the claim check.
  - 3: Playwright clicks "Open file" in the admin's queue and checks the new tab shows a real PNG and a one-page PDF. The Playwright project now runs `channel: "chromium"` (full Chromium in new headless mode), which has Chrome's PDF viewer. Vitest pins the file route's exact security policy.
- Approved additions beyond the plan (2026-11-11):
  - Credential uploads, approvals and rejections are audited (`credential.uploaded` / `credential.approved` / `credential.rejected`). `AuditLog.shiftId` is now nullable, with a new `credentialId`; a CHECK requires exactly one. The dashboard's "Shift" column is now "Subject".
  - Agencies see every nurse's credential status and expiry (nurses aren't tied to one agency), never the file or a rejection reason.
  - Rejection needs a reason (up to 500 characters), which the nurse sees.
  - Accepted files: PDF, PNG or JPEG, typed by their first bytes, never by the name or the browser's type; 1 byte to 4 MB. The expiry date must be after today (UTC).
  - Files open in a new tab (`inline`). Headless Chrome renders a PDF under the route's headers (`nosniff`, `Content-Security-Policy: default-src 'none'; …; sandbox`, `private, no-store`).
  - A nurse can have more than one pending upload; each is reviewed on its own.
  - The upload form checks the size before sending: Vercel rejects bodies over 4.5 MB before the route runs. On the preview, a 5 MB body got Vercel's `413 FUNCTION_PAYLOAD_TOO_LARGE`, and 4 MB + 1 byte got the route's 400.
  - The file route checks permission before the file's existence: an agency or another nurse gets 403 even for a credential with no file (the seeded ones).
  - `npm run preview-flow` runs Part 4 steps after Part 2's; `npm run smoke` adds read-only credential checks.
  - AGENTS.md working rule: never print files that hold credentials (`.env*`, `~/.npmrc`).
- Routes ([lib/credentials.ts](../lib/credentials.ts)):
  - `POST /api/credentials` (nurse; multipart `file` + `expiresOn`) → 201, `pending`. Check order: 403 role → 400 body → file present → size → type → expiry.
  - `GET /api/credentials` → `{ credentials, today }` (`today`: the server's UTC date, for expiry labels). Nurse: own; admin: all, `?status=pending` is the queue; agency: `{ id, nurseId, nurseName, expiresOn, status }`. Oldest first.
  - `GET /api/credentials/:id/file`: agency → 403; unknown → 404; another nurse → 403; no file → 404.
  - `POST /api/credentials/:id/review` (admin): `{ decision: "approved" }` or `{ decision: "rejected", reason }`.
  - Error messages:
    - 403: "Only nurses can upload credentials" / "Only the nurse who uploaded it and the admin can open this file" / "Only the admin can review credentials".
    - 400: "Request body must be multipart/form-data" / "file is required" / "File is empty" / "File must be 4 MB or smaller" / "File must be a PDF, PNG or JPEG" / "expiresOn must be a valid date (YYYY-MM-DD)" / "expiresOn must be after today" / "status must be pending, approved or rejected" / "decision must be approved or rejected" / "reason is required to reject a credential" / "reason must be 500 characters or fewer".
    - 404: "Credential not found" / "Credential has no file". 409: "Credential already reviewed".
- Storage: the file is in `CredentialFile` (`bytea`, with its name, type and size), apart from `Credential` so lists never load the bytes. The design put the file name on `Credential`; it moved next to the type and size. Ids are `cred-<n>` from `credential_id_seq`.
- Upload transaction: the credential row, its file and the audit entry, all in one. Review: `UPDATE … WHERE status = 'pending'`, so a second review matches 0 rows (409); the audit entry is in the same transaction. Claims are unchanged: they only count approved credentials.
- Tests:
  - Each guarantee test was checked by breaking the code it guards:
    - No `AND status = 'pending'` in the review: the race test fails 5/5 rounds.
    - Upload audit written after commit: the rollback test fails.
    - File existence checked before permission: 6 file tests fail.
    - No size check in the form: the Playwright size test fails (the request is sent).
    - Review fixes: the upload response appended again, the page's first date kept, or the file served as an `attachment`: each fails its new Playwright test. The default headless shell (no PDF viewer) fails the PDF check. A stricter policy (`default-src 'none'; sandbox`) still shows both files in Chrome, but fails the pinned-policy Vitest test.
  - Rollback tests make the `CredentialFile` insert or the `AuditLog` insert fail with a temporary trigger.
- Open: Vitest prints a `pg` deprecation warning ("client.query() when the client is already executing a query") from the Part 3 dashboard query (`admin-dashboard` and `permissions` test files only). It comes from Prisma's pg adapter, not app code, and doesn't fail anything.

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

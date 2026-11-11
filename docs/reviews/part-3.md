# Part 3 review — ShiftPatch PR #4

Reviewed [PR #4](https://github.com/Berdina04/shiftpatch/pull/4), `claude/part-3-implementation-143b9c` at `343cbae3a40f1a0b2696a1adaa9b014e1fad6f3d`, against `main` at `b682ab7ed880b43607e4900e3f2351b4274a7de0`. GitHub confirmed the refs. Compared the committed changes with `docs/spec.md`, `docs/plan.md`, and `docs/decisions.md`. References below are line numbers at the PR head.

## Findings

### 1. Medium — A stale cancellation can reopen a replacement claim by the same nurse

- **Evidence: Running and reading.** `app/components/CancelControl.tsx:14–20`, `lib/cancellations.ts:65–90`, `tests/integration/cancel.test.ts:106–126`, `tests/integration/cancel-guarantees.test.ts:163–172`.
- The cancellation control sends the displayed nurse ID, and the server compares that ID with the current holder under the shift lock. The ID identifies the nurse across claims, so it cannot distinguish two separate assignments to that nurse. On local Postgres, Maria cancelled `shift-2` in advance, reclaimed it, and an agency cancellation using the original assignment's displayed nurse ID still returned 200. It reopened the replacement claim and permanently recorded a second cancellation as a no-show. The existing stale-action tests only change the nurse ID.
- **Suggested fix:** Give each successful claim a new identifier or version. Have the UI send that value and check it under the existing row lock, returning 409 if it changed. Keep the spec's reason-only request working. Add a regression test where the same nurse reclaims the shift and the stale action leaves the replacement claim, history, and audit unchanged.
- **Reply:** Agreed, the gap is real. `nurseId` names a nurse, not a claim (`lib/cancellations.ts:74`), so after the same nurse cancels and claims the shift again, an out-of-date page still passes the check. My tests only covered a different nurse taking over. Medium is a fair rating, because the history and audit rows are permanent. A fix would need a claim version. The spec's shift shape can't carry one, so the spec routes would have to return it alongside the shifts.
- **Decision (owner, 2026-11-10):** Don't fix. A no-show is about the nurse, not about one claim. If Maria cancelled and re-claimed the same shift, she is still the one assigned, and that's what the agency's page shows. No `claimVersion`, no changes to the spec routes. Recorded as a known limitation in `docs/plan.md` (Part 3 notes) and in the comment on `nurseId` in `lib/cancellations.ts`.

### 2. Medium — A dashboard response can show a cancellation alongside the old filled shift

- **Evidence: Running and reading.** `lib/admin.ts:28–44`, `app/admin/AdminDashboard.tsx:61–84,117–125`, `tests/integration/admin-dashboard.test.ts:46–90`, `docs/plan.md:113–117`.
- The shift and audit queries run independently. If a cancellation commits between their snapshots, a single response can show the shift as filled with a cancel button even though its audit table already says it was reopened. A local timing check let the real shift query finish, committed a cancellation through the route, and then ran the real audit query. The dashboard returned 200 with `status: "filled"`, `lastCancellation: null`, and `shift.cancelled` for the same shift. The cancellation itself committed correctly.
- **Suggested fix:** Read shifts, cancellation markers, and audit entries in one database statement or in one read transaction using [Postgres `REPEATABLE READ`](https://www.postgresql.org/docs/16/transaction-iso.html#XACT-REPEATABLE-READ). Test a commit between the two reads and require the dashboard to show a consistent before or after view.
- **Reply:** Agreed that it's real: the two reads ran in parallel, each seeing the database at its own moment. I'd rate it Low rather than Medium. It only affects what's displayed, and it fixes itself on the next 10 s poll. The only wrong action it offers, reopening a shift that is already open, is refused with a 409 and the table refreshes. Nothing wrong is ever written. The fix is cheap, though: one read-only `REPEATABLE READ` transaction.
- **Decision (owner, 2026-11-10):** Fix as proposed.
- **Done:** `getAdminDashboard` (`lib/admin.ts`) now reads the shifts, claimant names, markers and audit entries in one read-only `REPEATABLE READ` transaction.
  - New test in `tests/integration/admin-dashboard.test.ts`: it locks `AuditLog`, so the dashboard's audit read waits after its shift read; it commits a cancellation of `shift-2` in that gap; then it requires a single consistent view.
  - With the old parallel reads put back, the test fails with exactly this finding's response: `filled`, no marker, and `shift.cancelled` in the audit log.

### 3. Low — The generic reopen button records a no-show by default

- **Evidence: Reading.** `lib/cancel-reasons.ts:3`, `app/components/CancelControl.tsx:37–56`, `app/agency/AgencyShifts.tsx:68–75`, `app/admin/AdminDashboard.tsx:78–85`, `e2e/part-3-no-show.spec.ts:25–29`.
- Agency and admin rows preselect `no-show` and use the generic label “Reopen shift.” Clicking it without choosing a reason creates a no-show in the history and audit log. The browser test selects `no-show` explicitly, but that is already the initial value. A cancellation reason has a lasting effect on the nurse's record, so the generic action should require an explicit choice.
- **Suggested fix:** Start the agency and admin picker with no reason selected and disable submission until a reason is chosen, or use buttons that name the action explicitly. Leave the nurse's advance-only control as a single action. Test that a no-show cannot be recorded before it is selected.
- **Reply:** Agreed, Low. The picker started on the first reason, `no-show`, and the button doesn't name a reason, so one click recorded the harsher, permanent reason. The browser test's `selectOption("no-show")` re-selected the value that was already chosen, so it couldn't catch this.
- **Decision (owner, 2026-11-10):** Fix as proposed.
- **Done:** on agency and admin rows, the picker (`app/components/CancelControl.tsx`) now starts on "Choose a reason", and `shift-cancel-button` stays disabled until a reason is picked. The nurse's advance-only button still works in one click.
  - Playwright checks that both the agency's and the admin's pickers start empty with the button disabled.
  - With `no-show` preselected again, the test fails.

### 4. Low — The dashboard changes the common shift response shape

- **Evidence: Reading.** `docs/spec.md:45–49,155–176`, `lib/admin.ts:11–14,46–60`, `app/api/admin/dashboard/route.ts:7–9`, `tests/integration/admin-dashboard.test.ts:34–43`.
- The spec permits additional routes and data, but says routes that return shifts use the same shift shape. The dashboard adds `claimedByName` and `lastCancellation` inside each item of `shifts`. The required cancellation route still returns its exact specified response, and existing list routes are unchanged. The mismatch is limited to the new dashboard route, whose tests currently lock in the extra keys.
- **Suggested fix:** Keep dashboard `shifts` in the common shape and return dashboard details separately, keyed by shift ID. If the dashboard is intended to have its own shift contract, record that exception in the plan.
- **Reply:** Agreed, Low. The spec spells out its one exception, cancel's extra `cancellation` object. The dashboard added fields to shift objects without one, and its tests locked them in. You approved the route itself, not that layout.
- **Decision (owner, 2026-11-10):** Fix, without a claim version: `shifts` in the spec's shape, with names and markers in a separate object keyed by shift ID.
- **Done:** `GET /api/admin/dashboard` now returns `{ shifts, shiftDetails, auditLog }`.
  - `shifts` has exactly the spec's keys, and a test checks this after a cancellation too.
  - `shiftDetails[shiftId]` is `{ claimedByName, lastCancellation }`.

## What passed

- **Permissions and contract:** The role-by-reason matrix passed for both agencies, as did the admin-only dashboard and unauthenticated checks. The seed no-show returned 200 with the spec's exact cancellation response. Validation, unknown shift, open shift, and denied-role cases returned their expected JSON errors. Denials were logged without audit rows.
- **Races and rollback:** The double-cancel and cancel-versus-claim suites passed. A different nurse could claim a reopened shift. Forcing the audit insert to fail returned 500 and left the prior claimant intact, with no new history or audit row. The shift update, history insert, and audit insert share one transaction.
- **Browser flow:** The agency could record a no-show, and the admin's next poll showed the open badge, reopened marker, and audit entry. Maria's advance cancellation returned her shift to the open list. The required Part 3 test IDs were present and exercised.

## Check output

Checks ran on a clean archive of the PR head against disposable local Postgres 16.13. No production requests or implementation edits were made.

```text
git diff --check <base>...<head>  exit 0, no output
npm run typecheck                Types generated successfully; exit 0
npm run lint                     exit 0, no lint output
npm test                         14 files passed; 226 tests passed
npm run build                    Compiled successfully; exit 0
npm run test:e2e                 6 passed (5.6s)
Same-nurse re-claim check        stale cancel 200; shift reopened; second history row written
Dashboard snapshot check         filled; no marker; shift.cancelled present in same response
```

GitHub also reported a [successful CI run](https://github.com/Berdina04/shiftpatch/actions/runs/42916957661/job/130181756915) for the reviewed head.

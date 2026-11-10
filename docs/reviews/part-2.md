# Part 2 review — ShiftPatch PR #2

Reviewed [PR #2](https://github.com/Berdina04/shiftpatch/pull/2), branch `claude/claim-transaction-part-2-89a106` at `35ec5f2887db69458f6ed34541e49eec86a25d72`, against `main` at `097c646d435b5561d81f82d3bc382aac64f86355`. GitHub confirmed both commits. Requirements checked against `docs/spec.md`, `docs/plan.md`, and the relevant decisions in `docs/decisions.md`. File and line references below are from the PR head.

## Findings

### 1. Medium — The spec's successful claim test fails when the seed credential expires

- **Evidence: Running and reading.** `tests/integration/claim.test.ts:22–25`, `lib/claims.ts:73–77`, `docs/spec.md:24`, `docs/plan.md:22,168`. The existing Maria claim test passes with the current clock. With only the test process clock set to January 1, 2027 UTC, the same test failed: `expected 403 to be 200`.
- Maria's seeded credential expires on January 1, 2027. The claim correctly checks today's date even for a past shift, so the exact seed stops producing the documented 200 that day. This also affects other tests that assume Maria can claim, including the Playwright post-and-claim flow, and means the production seed alone cannot keep the demo claim working indefinitely.
- **Suggested fix:** Pin the application clock in Vitest and in the Next.js server used by Playwright to a date between the two seed expiries. Keep the exact seed and production expiry rules. If the live demo still needs to produce 200 after January 1, agree on a separate demo data policy.

### 2. Medium — Denied Part 2 requests do not reach server logs

- **Evidence: Reading.** `docs/plan.md:181`, `lib/http.ts:17–22`, `app/api/shifts/route.ts:11–14`, `app/api/shifts/[id]/claim/route.ts:6–9`, `app/api/agencies/[agencyId]/shifts/route.ts:10–19`.
- The plan sends denied attempts to server logs and reserves the audit table for successful changes. The new handlers throw `HttpError` for denials, but the shared error handler returns those responses before the logging statement. The HTTP responses are correct; the planned record of denied actions is missing.
- **Suggested fix:** Log denied requests once at the route or auth wrapper, with the action, outcome, and caller ID when known. Exclude tokens and request bodies. Add a test that checks the denial is logged and no audit row is written.

### 3. Low — A date boundary can make the credential check ignore the shift's end date

- **Evidence: Reading.** `lib/shifts.ts:67–76`, `lib/shift-time.ts:12–14,20–24,44–46`, `lib/claims.ts:73–77`.
- The last four-digit calendar date is accepted for posting. If an overnight shift ends in the following year, JavaScript emits an expanded year with a leading `+`. The sliced value sorts before today's ordinary four-digit date, so the claim can check only whether the credential is valid today, contrary to the requirement that it cover the shift's end.
- **Suggested fix:** Compare numeric dates at UTC midnight for today, shift end, and credential expiry. Add a regression test for an overnight shift that crosses the supported calendar boundary.

### 4. Low — The stale-tab test can fail before it reaches the claim

- **Evidence: Reading.** `e2e/part-2-post-claim.spec.ts:27–36`. The normal Playwright run passed.
- The test starts an advancing browser clock, navigates, waits for two visibility checks, and then tries to pause at a fixed time five seconds after installation. If those steps take more than five seconds, Playwright cannot pause at that point because it has already passed. The test can fail on a slow CI worker before exercising the 409 or the refresh.
- **Suggested fix:** Pause the stale tab's clock at a controlled point before navigation, or hold its background polls using request interception. Keep the assertion that the row disappears after the 409 without allowing a periodic poll to satisfy it.

### 5. Low — Playwright does not verify the regular 10-second poll

- **Evidence: Reading.** `app/components/useLiveShifts.ts:43–46`, `e2e/part-2-post-claim.spec.ts:28–36,51–53`, `docs/plan.md:94`.
- The stale-tab test checks the immediate refresh, and the agency assertion reloads the page. Both can pass with the regular polling timer removed.
- **Suggested fix:** Advance the agency page's browser clock by 10 seconds after the nurse claims, then assert that the existing row becomes filled without reloading the page.

## What passed

- **Permissions and contracts:** The role matrix and unauthenticated checks passed. Posting uses the authenticated agency's ID; the agency list is scoped to the requested agency with the documented admin exception. The tests checked the shift response shapes and the specified JSON errors, including James's exact credential message and the order of claim failures.
- **Double claims and overlap:** The 20-nurse race returned one 200 and nineteen 409s, with one claimant and one claim audit row. Ten same-nurse races across overlapping shifts at different agencies each produced one successful claim. The claim code locks the nurse row before reading overlap and makes the update conditional on the shift still being open.
- **Audit and rollback:** Both application writes await their audit insert inside the same transaction. The forced audit failure tests passed for both routes: the claim left its shift open, the post created no shift, and neither wrote an audit row. No successful application write path without an audit row was found. Seed and test setup writes were outside that check.

## Check output

Checks ran on an isolated copy of the PR with disposable local Postgres 16.13. No production requests or implementation edits were made.

```text
git diff --check <base>...<head>       exit 0, no output
npm run typecheck                     Types generated successfully; exit 0
npm run lint                          exit 0, no lint output
npm test                              Test Files: 10 passed; Tests: 138 passed
npm run build                         Compiled successfully; exit 0
npm run test:e2e                      4 passed (4.3s)
Maria claim test, clock 2027-01-01    1 failed: expected 403 to be 200
```

GitHub also reported a [successful CI run](https://github.com/Berdina04/shiftpatch/actions/runs/42764043364/job/129656276287) for the reviewed head.

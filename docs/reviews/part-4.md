# Part 4 review — ShiftPatch PR #5

Reviewed [PR #5](https://github.com/Berdina04/shiftpatch/pull/5), branch `claude/part-4-implementation-7c2c7c` at `8f9eeb5b8a8c1326d0aaeb37df5136b47f5d3aac`, against `main` at `1ae16e4c850c3ea93f3ea0c81c8212f9409914e1`. GitHub confirmed both refs. Compared the committed changes with `docs/spec.md`, `docs/plan.md`, and `docs/decisions.md`, including the Part 4 decisions recorded in the plan. File and line references below are from the PR head.

## Findings

### 1. Low — An upload response can duplicate a credential already received by polling

- **Evidence: Running and reading.** `app/shifts/MyCredentials.tsx:19,48–54,73–76`, `app/components/useLiveShifts.ts:20–40`.
- The form appends every successful upload response to its current list. If the upload has committed but its response is delayed, the regular poll can already include that credential. Appending the later response creates two rows with the same credential ID and React key. A local browser check held the successful POST response until a real 10-second poll had returned the new row: the page showed one row before releasing the response and two afterward. There was only one upload in the database; this is a client-state race.
- **Suggested fix:** Merge the response by credential ID, replacing an existing row or inserting it once. Add a browser regression test where a poll receives the uploaded credential before the POST response reaches the form.
- **Reply:** Agreed, Low. `MyCredentials` appended the upload response. `usePolled`'s guard only discards polls still in flight when a local change lands, so a poll that finished between the commit and the response had already added the row. Only the page was wrong: one row in the database, and the next poll replaced the whole list within 10 s. React also warned about the duplicate key.
- **Decision (owner, 2026-11-11):** Fix as proposed.
- **Done:** the response is merged by id (`upsertById` in `app/components/useCredentialList.ts`): it replaces the row a poll brought in, or is added once.
  - New Playwright test: it holds the upload's response with `page.route` until the server has saved it, runs the 10 s poll with `page.clock`, then releases the response. The list must show the credential once, before and after.
  - With the append put back, the test fails.

### 2. Low — Credential expiry labels remain on the page's original date after midnight

- **Evidence: Reading.** `app/shifts/page.tsx:16`, `app/agency/page.tsx:19`, `app/shifts/MyCredentials.tsx:18–19,73–79`, `app/agency/NurseCredentials.tsx:13–14,29–38`, `lib/credential-rules.ts:35–42`.
- The server passes `today` when the page loads. Credential polls replace the rows but never update that date. A nurse or agency keeping the page open across UTC midnight can therefore keep seeing “Approved” after the credential expires, even after successful polls. The server-side claim check correctly uses the new date and refuses the claim, so the displayed eligibility and the API's decision disagree.
- **Suggested fix:** Return the server's current UTC date with credential polling responses and refresh both the rows and the date together, or use a clock that updates the display at the UTC day boundary. Add a test that keeps the page mounted across midnight and checks the label without reloading.
- **Reply:** Agreed, Low: the claim check is right and its message is clear, only the label was stale. I'd keep the date from the server rather than the browser's clock: the server and browser renders would disagree, and the browser's clock can be wrong. The test can't cross midnight on the server: Playwright's server has its clock pinned once for the whole run. Instead, a Vitest test checks the date in the response, and Playwright rewrites one poll's date to check the page follows it.
- **Decision (owner, 2026-11-11):** Fix as proposed, with that test.
- **Done:** `GET /api/credentials` returns `{ credentials, today }`, `today` being the server's UTC date. The nurse's and the agency's lists (`useCredentialList`) take both from every poll.
  - Vitest: the list responses carry the pinned date, `2026-11-10`.
  - Playwright: on Maria's `/shifts` and on agency-a's `/agency`, one poll's `today` is rewritten to `2027-01-01`. Maria's credential turns from "Approved" to "Expired" without a reload.
  - With the page's first date kept, the test fails.
  - `npm run smoke` checks that the admin's list carries the server's date.

### 3. Low — The committed browser test does not exercise opening and rendering the document

- **Evidence: Reading, with a separate browser check.** `e2e/part-4-credentials.spec.ts:6,29–43`, `tests/support/http.ts:105–110`, `docs/plan.md:85–86,190–199`.
- The test obtains the “Open file” link's URL and requests it with `admin.request.get`; it never clicks the link or checks rendered content. Its PDF contains no pages, and the integration PNG/JPEG fixtures are signature samples rather than renderable licence images. These checks prove storage and HTTP access but cannot catch a regression in the document-viewing step that the admin needs before approval. Separate checks during this review successfully opened renderable PNG, JPEG, and one-page PDF samples through the real admin links.
- **Suggested fix:** Keep the HTTP assertions and add a browser test that clicks “Open file” and checks a renderable sample in the new tab. Use a PDF-capable Chromium project for the PDF case; Playwright documents the [Chromium channel for new headless mode](https://playwright.dev/docs/browsers#chromium-new-headless-mode). Include an image-rendering assertion with valid image data.
- **Reply:** Agreed, Low: it's test coverage, not a product bug, and the plan's required Playwright scenario is met. The regression nothing caught was a change to the file route's headers: Vitest only checked that the policy contained `sandbox`. I checked rendering once by hand in headless Chrome, but CI never did.
- **Decision (owner, 2026-11-11):** Fix as proposed.
- **Done:**
  - New Playwright test: James uploads a real 40×20 PNG and a one-page PDF (`e2e/support/files.ts`). The admin clicks "Open file" for each in the queue. The image tab must show a 40×20 image, and the PDF tab must load Chrome's PDF viewer. The existing HTTP assertions stay.
  - The Playwright project runs `channel: "chromium"` (full Chromium in new headless mode), which has the PDF viewer. CI already installs that browser with `playwright install chromium`. With the default headless shell, the PDF check fails.
  - Vitest pins the exact security policy.
  - Breaking it: serving the file as an `attachment` fails the new test. A stricter policy (`default-src 'none'; sandbox`) still shows both files in Chrome, so the browser test passes, but the pinned policy fails 2 Vitest tests.

## What passed

- **Permissions and contracts:** The credential route-by-role matrix and unauthenticated checks passed. Nurses listed only their own credentials; agencies received only the documented status/expiry fields. Agencies and other nurses received 403 on file access, including seeded credentials without files. Only the admin could review. Status codes, response shapes, and validation/error messages matched the Part 4 route contracts recorded in the plan.
- **Transactions and audit:** Upload writes the credential, file, and audit entry in one transaction. Forced file-insert and audit-insert failures rolled the upload back. Forced review-audit failure left the credential pending with no reviewer. No successful credential mutation path without its audit entry was found.
- **Review races and claims:** Five rounds of ten parallel reviews each produced one 200 and nine 409s, with one review stored and audited. Pending and rejected uploads did not enable claims; approval did. The claim still required a credential valid today and through the shift's end.
- **Browser flows:** All nine committed Playwright tests passed, including James's upload → blocked claim → approval → successful claim and the client-side file-size check. Supplemental checks confirmed that the admin could open renderable PNG, JPEG, and PDF files. The two required credential test IDs were present and exercised.

## Check output

Checks ran on a clean archive of the PR head against disposable local Postgres 16.13. No production requests or implementation edits were made.

```text
git diff --check <base>...<head>  exit 0, no output
npm run typecheck                Types generated successfully; exit 0
npm run lint                     exit 0, no lint output
npm test                         16 files passed; 322 tests passed
npm run build                    Compiled successfully; exit 0
npm run test:e2e                 9 passed (7.4s)
Upload/poll timing check          same credential: 1 UI row before POST response, 2 afterward
Supplemental document viewing     PNG, JPEG, and one-page PDF rendered through admin links
```

Vitest emitted the plan's already-documented `pg` query deprecation warning and a Vite configuration warning; neither failed a check. GitHub also reported a [successful CI run](https://github.com/Berdina04/shiftpatch/actions/runs/42958463804/job/130319088402).

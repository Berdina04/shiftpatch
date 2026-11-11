# Escalation: one-click export of nurses' documents

**For:** Juan · **Date:** 11 November 2026

We decided not to build this as asked on 9 November 2026, the first day of the build, and wrote it into the build plan that day (`docs/plan.md`, "Out of scope", first commit `53931dd`): "document export (needs an access policy for third-party medical data first)". This note explains that decision.

## 1. Problem

Your wish list asked for:

> One-click export of nurses' license documents and TB test results, so we can hand it to the state inspector when they ask.

Built as asked, it is risky:

- One button puts every nurse's documents, medical records included, into a single file.
- Nothing records who made the file, or why.
- If that one file is lost, or forwarded to the wrong person, the whole staff's records are exposed at once, and there is no getting them back.

## 2. Root cause

The hard part isn't the button. It's the TB test results. A TB result is health information about a nurse, and the nurses aren't your customers. We have no agreed policy yet for:

- who may see or share these records;
- what the inspector actually needs (a list of who is cleared to work, or the documents themselves; every nurse, or only some);
- how long any copy is kept, and by whom.

Health information may fall under specific rules, and we can't say which ones apply here. Your legal or compliance team should confirm that before the app stores or shares it.

## 3. Alternative solutions considered

**(a) Build it as asked.** Fastest on inspection day, but it carries every risk in section 1, and the policy would be decided by default rather than on purpose.

**(b) A status-only view for the inspector.** A page showing each nurse's license status and expiry date, with no documents. No records leave the app. But it isn't enough if the inspector needs the documents themselves, and it covers licenses only until TB results are stored.

**(c) An admin-only export of just what the inspector asks for.** The admin picks the nurses and documents requested. Each export is recorded in the audit log (the app's record of who did what, and when) and handed over through a link that stops working after a set time. Far less is exposed, and every handover is on record. But it takes the most work to build, and once the inspector downloads the file, we can't control further copies.

**(d) Leave it out until there's a policy.** No new risk and no build time. But if an inspector asks before then, the admin gathers the documents by hand, opening each nurse's license in the app one at a time.

## 4. Recommended solution

**(d) now, then (b) or (c) once the policy exists.** Which of the two depends on what the policy says the inspector needs: (b) if a status list is enough, (c) if they need the documents.

Part of the build (Part 4, license uploads) adds these protections. It's finished and tested, and waiting for approval to go live (PR #5). With it, the app:

- counts a nurse's license upload only after the admin has opened it and approved it;
- lets only the nurse who uploaded a file, and the admin, open it;
- shows agencies each nurse's license status and expiry date only, never the file;
- records every change in the audit log: shifts posted, claimed and cancelled; licenses uploaded, approved and rejected.

The app has no place for TB test results today. It holds license documents only.

## 5. Impact/urgency

- **It doesn't block** using the app, or showing it to customers.
- **It must be settled before** the app stores TB test results, or before the first inspection where the app is expected to supply documents, whichever comes first.

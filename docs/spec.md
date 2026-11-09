# ShiftPatch — Required API Routes & Test IDs

This is the exact spec referenced in your trial brief. Load the sample data exactly as given below.

This is the baseline we require, not a ceiling. Any API route or data beyond what's listed here is yours to add if your product needs it, same as the brief says.

All times in this document are 24-hour, facility-local time. No timezone conversion needed for this exercise.

---

## Sample data

**Agencies**

| agencyId | Name | Login email | Password |
|---|---|---|---|
| `agency-a` | Sunrise Health Staffing | admin@sunrisehealth.example | Trial2026! |
| `agency-b` | Metro Care Partners | admin@metrocare.example | Trial2026! |

**Nurse roster**

| nurseId | Name | Login email | Password | Credential status |
|---|---|---|---|---|
| `nurse-1` | Maria Lopez | maria.lopez@example.com | Trial2026! | Valid (expires 2027-01-01) |
| `nurse-2` | James Cook | james.cook@example.com | Trial2026! | Expired (expired 2026-06-01) |

**Admin**

| userId | Name | Login email | Password | Role |
|---|---|---|---|---|
| `admin-1` | Alex Kim | alex.kim@example.com | Trial2026! | admin |

**Shifts** (seed these exactly — this is what exists at trial start)

| shiftId | agencyId | role | date | startTime | endTime | status | claimedBy |
|---|---|---|---|---|---|---|---|
| `shift-1` | `agency-a` | RN | 2026-10-02 | 19:00 | 07:00 | open | — |
| `shift-2` | `agency-a` | LPN | 2026-10-03 | 07:00 | 19:00 | filled | `nurse-1` |
| `shift-3` | `agency-b` | RN | 2026-10-04 | 19:00 | 07:00 | open | — |

Login roles are one of: `nurse`, `agency`, `admin`.

---

## Required API routes (login + 5 shift routes)

All authenticated routes take `Authorization: Bearer <token>`. Error responses always look like `{ "error": "<message>" }`.

Every route that returns a shift (or a list of them) returns the same shape: `id, agencyId, agencyName, role, date, startTime, endTime, status, claimedBy`. `claimedBy` is `null` when the shift is open.

### 1. POST /api/auth/login

Request:
```json
{ "email": "maria.lopez@example.com", "password": "Trial2026!" }
```

Response 200 (shape is identical for every role, only `role` and `id` change — e.g. an agency login returns `"role": "agency"`, an admin login returns `"role": "admin"`):
```json
{
  "token": "<jwt>",
  "user": { "id": "nurse-1", "name": "Maria Lopez", "role": "nurse" }
}
```

Response 401:
```json
{ "error": "Invalid email or password" }
```

### 2. GET /api/shifts

Lists every shift across both agencies (the marketplace view nurses browse).

Response 200:
```json
{
  "shifts": [
    {
      "id": "shift-1",
      "agencyId": "agency-a",
      "agencyName": "Sunrise Health Staffing",
      "role": "RN",
      "date": "2026-10-02",
      "startTime": "19:00",
      "endTime": "07:00",
      "status": "open",
      "claimedBy": null
    },
    {
      "id": "shift-2",
      "agencyId": "agency-a",
      "agencyName": "Sunrise Health Staffing",
      "role": "LPN",
      "date": "2026-10-03",
      "startTime": "07:00",
      "endTime": "19:00",
      "status": "filled",
      "claimedBy": "nurse-1"
    }
  ]
}
```

### 3. POST /api/shifts

Agency posts a new open shift. Caller must be authenticated as that agency; the shift is scoped to their own `agencyId`.

Request:
```json
{ "role": "RN", "date": "2026-10-05", "startTime": "07:00", "endTime": "19:00" }
```

Response 201:
```json
{
  "id": "shift-7",
  "agencyId": "agency-a",
  "agencyName": "Sunrise Health Staffing",
  "role": "RN",
  "date": "2026-10-05",
  "startTime": "07:00",
  "endTime": "19:00",
  "status": "open",
  "claimedBy": null
}
```

### 4. POST /api/shifts/:id/claim

Nurse claims an open shift. Must check the nurse's credential expiry before allowing the claim. Returns the updated shift, same shape as above.

Request: empty body, nurse identified by token.

Response 200:
```json
{
  "id": "shift-1",
  "agencyId": "agency-a",
  "agencyName": "Sunrise Health Staffing",
  "role": "RN",
  "date": "2026-10-02",
  "startTime": "19:00",
  "endTime": "07:00",
  "status": "filled",
  "claimedBy": "nurse-1"
}
```

Response 403 (lapsed credentials, e.g. James Cook / `nurse-2`):
```json
{ "error": "Credential expired, cannot claim shift" }
```

### 5. POST /api/shifts/:id/cancel

Cancellation / no-show handling. Reopens the shift. `reason` is one of `"no-show"` (nurse didn't show up for a shift they'd claimed) or `"advance"` (cancelled ahead of time). Returns the updated shift, same shape as above, plus a `cancellation` object.

Request:
```json
{ "reason": "no-show" }
```

Response 200:
```json
{
  "id": "shift-2",
  "agencyId": "agency-a",
  "agencyName": "Sunrise Health Staffing",
  "role": "LPN",
  "date": "2026-10-03",
  "startTime": "07:00",
  "endTime": "19:00",
  "status": "open",
  "claimedBy": null,
  "cancellation": { "reason": "no-show", "previousNurseId": "nurse-1" }
}
```

### 6. GET /api/agencies/:agencyId/shifts

Agency-scoped view of that agency's own posted shifts, same shape as above.

Response 200 (agency-a token requesting its own id, returns shift-1 and shift-2):
```json
{
  "agencyId": "agency-a",
  "shifts": [
    { "id": "shift-1", "status": "open", "claimedBy": null },
    { "id": "shift-2", "status": "filled", "claimedBy": "nurse-1" }
  ]
}
```

Response 200 (agency-b token requesting its own id, returns shift-3 only):
```json
{
  "agencyId": "agency-b",
  "shifts": [
    { "id": "shift-3", "status": "open", "claimedBy": null }
  ]
}
```

---

## Required test IDs (~15)

Attach these as `data-testid` attributes exactly as named, on the element that performs the action described. Everything else about the UI (layout, styling, copy, framework) is up to you.

Credential upload and expiry don't have a required API contract above — build that route however makes sense to you. The test IDs below are still required on whatever UI you build for it.

`notification-banner` is the same test ID for both success and error confirmations (e.g. "Shift claimed" and "Credential expired, cannot claim shift") — distinguish them by content, not by a different test ID.

| test ID | Where it goes |
|---|---|
| `login-email-input` | Email field on the login form |
| `login-password-input` | Password field on the login form |
| `login-submit-button` | Login form submit button |
| `shift-list-item` | Each row/card in the open-shifts list |
| `shift-claim-button` | Button to claim a specific shift |
| `shift-cancel-button` | Button to cancel a claimed shift |
| `credential-upload-input` | File input for uploading a license/credential doc |
| `credential-expiry-date-input` | Expiry date field on the credential upload form |
| `agency-post-shift-button` | Button that opens the "post a new shift" form |
| `agency-post-shift-submit-button` | Submit button on the new-shift form |
| `admin-dashboard-shift-table` | The admin's shift reporting table |
| `admin-shift-status-badge` | Status indicator (open/filled/cancelled) on each shift row in the admin view |
| `audit-log-table` | The audit log listing |
| `timesheet-table` | The timesheets view |
| `notification-banner` | Confirmation banner/toast shown after an action (success or error) |

# HTAF Fix 2 of 3 — Admin Data Minimization + Audited CSV Export

Status: **second fix from `docs/security-remediation/
htaf-admin-pii-audit.md`** (findings 4 and 5 — `select("*")` over-fetch
and the unaudited bulk CSV export). Scoped exactly as agreed; the
AI-triage privacy work, admin RBAC redesign, and trusted-proxy/
rate-limit hardening remain separate, later projects.

## Review round 2 (before merge)

Two corrections requested, both specific to the export route — the
list/detail/PATCH design was approved as-is:

1. **The export's audit log was fire-and-forget.** It called
   `auditLog({...}).catch(() => {})` and sent the CSV immediately,
   regardless of whether the audit write actually succeeded. Since
   `auditLog()` never throws on a failed insert — it always resolves,
   with `{logged: false, error}` on failure — the `.catch()` never even
   ran; the export shipped the CSV unconditionally. That's the exact
   failure mode this PR exists to prevent: an audit-write failure would
   have still handed the admin the full PII export. Fixed by awaiting
   `auditLog(...)` and gating delivery on its resolved outcome via a
   new pure function, `resolveHtafExportDelivery(auditResult)`
   (`lib/htafOperations.js`) — the CSV headers/body are only written to
   the response if `auditResult.logged === true`. On failure: 500,
   the CSV is never sent, and only the audit-write's own error (a
   Supabase error object — message/code/details/hint, no applicant
   data) is logged server-side. Same principle already used for driver
   compliance overrides: a sensitive administrative action must not
   succeed without its required audit evidence.
2. **The export query itself still used `select("*")`.** Even though
   `buildHtafExportCsv` only reads the 17 `HTAF_EXPORT_COLUMNS`,
   Supabase was asked for every column, including the four dead ones
   the audit identified. Changed to
   `.select(HTAF_EXPORT_COLUMNS.join(","))` — the server itself now
   never receives a column the export doesn't use, keeping data
   minimization true end-to-end rather than just at the point where the
   CSV is assembled.

Four new tests in `lib/htafOperations.test.js`'s
`resolveHtafExportDelivery` describe block cover the fail-closed
guarantee directly, including the case that matters most: `auditLog()`
resolving with `{logged: false}` (its actual failure shape, not a
thrown exception) must block delivery. Full suite: 381/381 passing
after this round.

## The problem (restated from the audit)

`GET /api/admin/foundation/applications` used `select("*")`, shipping
all 27 `htaf_applications` columns — including email, phone, household
income, and four columns nothing in this codebase ever reads
(`review_notes`, `assigned_admin`, `client_version`, `source`) — for up
to 500 applications on every single page load, even though the queue
list template only renders 6 of those fields per row. There was no
separate single-record detail endpoint; the "detail" view and the CSV
export both just indexed into the same already-fully-loaded array. The
CSV export itself ran entirely client-side, from that same over-fetched
array, with no server round-trip and therefore no audit trail at all —
the one action on the page capable of handing a caseworker's entire
visible caseload to a downloaded file left no record of who did it or
when.

## What this PR does

### 1. Explicit field allow-lists, shared between server.js and tests

Four new constants in `lib/htafOperations.js`, single source of truth
for both the Supabase `.select()` calls and the tests that guard them:

- **`HTAF_ADMIN_LIST_FIELDS`** — `id, application_code, first_name,
  last_name, program_type, county, status, created_at`. Exactly what
  the queue row template renders, plus `id` (row selection) and
  `created_at` (keyset pagination, unchanged). No email, phone, income,
  household size, addresses, notes, or any of the four dead columns.
- **`HTAF_ADMIN_DETAIL_FIELDS`** — the full set the detail panel
  actually renders (21 fields, including `ride_id`), still excluding
  the four dead columns. Fetched one row at a time, only when an admin
  opens that specific application.
- **`HTAF_ADMIN_PATCH_RESPONSE_FIELDS`** — `id, status, notes,
  updated_at`. A PATCH can only ever change status/notes; returning the
  full row (the old behavior) was the same "ship detail fields nobody
  asked for" pattern as the list route.
- **`HTAF_EXPORT_COLUMNS`** — the same 17-column set the old client-side
  CSV export used, now built server-side (see below).

### 2. `GET /api/admin/foundation/applications` — reduced to the allow-list

`.select("*")` → `.select(HTAF_ADMIN_LIST_FIELDS.join(","))`. Filtering
(`status` query param) and keyset pagination are unchanged.

### 3. New `GET /api/admin/foundation/applications/:id` — real detail endpoint

`requireAdmin`-gated, `.select(HTAF_ADMIN_DETAIL_FIELDS.join(","))`,
404s on a missing application. This is the piece that didn't exist
before — the admin UI's "detail view" was never a real fetch, just a
client-side array lookup against data that had already been fully
loaded for every row.

### 4. `PATCH /api/admin/foundation/applications/:id` — minimal response

`.select()` (all columns) → `.select(HTAF_ADMIN_PATCH_RESPONSE_FIELDS.join(","))`.

### 5. New `POST /api/admin/foundation/applications/export` — server-side, audited, reason-gated CSV

Per the explicit extra safeguard requested: **an admin must state a
reason before the file is generated, and that reason is audited.**

- `requireAdmin`-gated.
- Validates the request via `resolveHtafExportRequest(body)`
  (`lib/htafOperations.js`): rejects a missing/blank/whitespace-only
  `reason` with 400, rejects a reason over 500 characters, and passes
  through optional `status`/`program_type` filters.
- Queries `htaf_applications` with the full field set — the only place
  in this route family that still does, because a bulk export is
  explicitly, deliberately a "give me everyone (matching these
  filters)" action, distinct from the minimized list/detail routes.
- Builds the CSV server-side with `buildHtafExportCsv(rows)` (same
  column order and escaping rules — commas, quotes, newlines — as the
  old client-side `csvEscape()`, now tested).
- **Audit-logs every export**: `actor_type: "admin"`, `actor_id:
  req.admin.email`, `action: "htaf_applications_exported"`,
  `metadata: { row_count, reason, filters: { status, program_type } }`.
  Timestamp is implicit in the audit row, matching every other
  `auditLog()` call in this codebase. A bulk PII export now leaves
  exactly the kind of record every other admin action on this page
  already leaves — the audit's original gap (finding 5) is closed.
- Returns the CSV as a real file download (`Content-Type: text/csv`,
  `Content-Disposition: attachment`) rather than JSON.

### 6. `admin-htaf.html` — updated to match

- **`selectApplication(id)`** now fetches
  `GET /api/admin/foundation/applications/:id` instead of reading out
  of the already-loaded (now-reduced) list array. A new
  `selectedApplicationId` tracks which row is highlighted the instant
  it's clicked (so the queue's active-row indicator doesn't wait on the
  fetch), while `selectedApplication` holds the full detail record once
  it resolves — a stale-response guard (`if (selectedApplicationId !==
  applicationId) return;`) prevents a slow, superseded fetch from
  clobbering a newer selection. `renderApplicationDetail()` shows a
  brief loading state between the two.
- **`applyApplicationUpdate(updated)`** (new, shared by
  `updateSelectedStatus`, `saveAdminNotes`, and the schedule-ride submit
  handler): merges a PATCH's now-minimal `{id, status, notes,
  updated_at}` response into the existing full detail object instead of
  replacing it wholesale (which would otherwise blank out every other
  field on screen), and updates only the `status` field on the matching
  queue row.
- **`applicationSearchText()`** — restricted to the fields the
  minimized list actually carries (code, name, county, program, status).
  Searching by email/phone/destination is no longer possible without
  re-fetching full PII for every row just to power a search box — a
  real, acknowledged feature reduction, and the direct consequence of
  "avoid placing all applicant details into the browser just so one row
  might be opened." Finding a specific applicant by email/phone now
  means opening records from the queue directly rather than typing into
  the search box. Not redesigned as a server-side search in this PR
  (out of scope; noted below as a possible follow-up).
- **`exportApplicationsCsv()`** — rewritten entirely. Prompts the admin
  for a reason (`window.prompt`, cancel = no request made), rejects a
  blank reason client-side before ever calling the server, then POSTs
  to the new export route and downloads the returned CSV blob. All
  client-side CSV building (`csvEscape()`, the old inline column list)
  is removed — the export no longer touches `applications`/
  `filteredApplications` at all.

## Explicit adherence to the constraints given

- Replaced `select("*")` on the list with an explicit allow-list. ✓
- Added a separate `GET .../:id` detail endpoint. ✓
- PATCH returns only the fields a status/notes edit could change. ✓
- CSV export moved server-side, behind `requireAdmin`. ✓
- Every export audited with actor, timestamp (implicit), row count, and
  reason. ✓
- No longer places all applicant detail in the browser just because one
  row might be opened — detail is fetched per-application, on demand. ✓
- Extra safeguard: export requires a stated reason before the file is
  generated, and that reason is audited. ✓
- Did not touch: AI triage, admin roles/`requireAdmin` itself,
  `getClientIp()`/global rate-limiting, or anything from the by-email
  enumeration PR (#105). Confirmed by diff — only `server.js`,
  `lib/htafOperations.js` (+tests), and `admin-htaf.html` changed.

## Tests

`lib/htafOperations.test.js`, two new `describe` blocks (14 new tests):

- **Field allow-lists**: the list allow-list contains none of the
  detail-only sensitive fields (email, phone, household_size,
  monthly_income, notes, transportation_need, destination, pickup_city,
  city, applicant_type, ride_date) and none of the four dead columns;
  the detail allow-list also excludes the dead columns while being a
  strict superset of the list fields plus the sensitive ones; the PATCH
  response allow-list is exactly `{id, status, notes, updated_at}`.
  **This is the direct, literal test the scope asked for**: "tests
  proving sensitive detail-only fields never appear in the list
  response."
- **`buildHtafExportCsv`**: escaping matches the old client-side
  behavior exactly (commas, quotes, newlines, null/undefined → empty
  string); header + one row per record in column order; defaults to
  `HTAF_EXPORT_COLUMNS` when no explicit column list is given; empty
  input still produces a valid header-only CSV rather than erroring.
- **`resolveHtafExportRequest`**: rejects a missing/blank/whitespace-only
  reason and an over-length one, both with 400; accepts and trims a
  real reason; carries optional `status`/`program_type` filters through
  correctly, defaulting to `null` when omitted.

Full suite: **377/377 passing** (`npx jest`), no regressions. `node -c
server.js` clean; the `admin-htaf.html` inline `<script>` block passes
`node -c`.

### What these tests do not cover, and why

As with the previous two HTAF PRs, route-level integration testing
(actually sending an HTTP request through `requireAdmin` and the new
routes) isn't part of this codebase's toolkit — `server.js` isn't
`require()`-able without booting a real listener and connecting to
Supabase. The pure-function tests above cover the actual data-shape
guarantees (which fields can and can't appear where); the routes'
wiring (`requireAdmin` → allow-list `.select()` → response) was verified
by direct code reading. The `admin-htaf.html` rewrite (async
`selectApplication`, the loading state, `applyApplicationUpdate`'s
merge behavior, the export prompt/download flow) was verified by
reading the code and confirming every prior reference to a
now-detail-only field (`selectedApplication.email`, `.destination`,
`.notes`, etc.) still resolves correctly once `selectedApplication`
holds the fetched detail object — not by a live browser click-through,
since no staging environment with a real admin session is available in
this session.

## Acknowledged scope reduction, noted for a future PR

The queue's search box can no longer match by email, phone, city,
destination, or transportation need, since those fields are no longer
present in the (now-minimized) list data the search runs against
locally. A future PR could restore that capability as a real
server-side search (`?q=` matched via `.or()`/`ilike` across the
relevant columns, still returning only the minimized field set) without
reintroducing the original over-fetch — not built here, since it wasn't
part of the agreed scope for this PR.

## Rollback plan

Trivial revert — no migration, no flag, no data touched. Reverting
restores `select("*")`, the old client-side CSV export, and the old
array-lookup detail view exactly as they were.

## Next in this sequence

AI-triage privacy hardening (strip income, household size, street-level
location, and sensitive free-text need details from what's sent to
OpenAI, or disable triage where minimization would break the purpose)
is next. Admin RBAC redesign and trusted-proxy/rate-limit hardening
remain their own separate, larger projects.

# HTAF Flow Repair — Public Statistics + Create-Ride Idempotency

Status: **functional repair, not a security-remediation-program PR.** Filed
under this directory only because it follows the same evidence-and-review
discipline as the other PRs here, and because the admin PII/authorization
audit this repair deliberately excludes will land in this same family
later.

## Review round 2 (before merge/migration)

Two corrections requested on the first pass, both applied to the same
migration file before it was ever run against production:

1. **EXECUTE was not locked down.** Postgres functions inherit `PUBLIC`
   execute by default, so without an explicit `revoke`,
   `create_htaf_ride_atomic` — an admin-only operation — would have been
   directly callable by `anon`/`authenticated` via PostgREST RPC,
   bypassing `requireAdmin` entirely. Added `revoke execute ... from
   public, anon, authenticated` + `grant execute ... to service_role`
   using the function's exact 19-argument signature. Left the function
   `SECURITY INVOKER` (the default) rather than `SECURITY DEFINER` — its
   only caller is already the service-role client, which has full table
   access on its own, so there's no reason for it to run with elevated
   owner privileges.
2. **The `existing` check was one-sided.** It only checked
   "does `application.ride_id` point at a row that exists" — it never
   checked that the ride found that way actually points back at this
   application via `ride.htaf_application_id`. A corrupted or one-sided
   link (e.g. a ride manually reassigned to a different application)
   would have been silently accepted as a legitimate existing ride.
   Added the reverse check: if the ride exists but
   `ride.htaf_application_id is distinct from application.id`, the
   outcome is now `inconsistent` / `ride_application_link_mismatch`
   instead of `existing`.

Both changes are in
`supabase/migrations/20260806120000_htaf_ride_idempotency.sql`; the
`ride_application_link_mismatch` reason is covered by a new test in
`lib/htafOperations.test.js` (`resolveCreateRideOutcome` fails closed
with 409 for it, same as the other `inconsistent` reasons). Full suite:
358/358 passing after this round.

See "Production verification" below for the fresh pre-migration
duplicate check, the applied migration, and the live permission/behavior
checks run before merge.

## The problem, precisely

Screenshots showed the admin dashboard listing 4 real HTAF applications
(status `submitted`) while `foundation.html`'s public "Application
Dashboard" widget showed 0 submitted / 0 pending / 0 approved / 0
scheduled at the same time.

Traced end-to-end before writing any fix. Root cause was **not** any of
the usual suspects — confirmed and ruled out each one directly:

| Hypothesis | Status |
|---|---|
| RLS blocking a legitimate read | Ruled out — `htaf_applications` RLS already correctly denies anon/authenticated SELECT; the public widget was never querying the database at all, so RLS was never in the path. |
| Wrong table / wrong endpoint | Ruled out — no fetch call to any HTAF endpoint existed on the page. |
| Status casing/enum mismatch | Ruled out — no server-side status comparison existed on the page. |
| Swallowed fetch error | Ruled out — there was no fetch to swallow an error from. |
| **Stale/mock/static counters** | **Confirmed root cause.** |

`updateDashboardCounters()` read a **per-browser `localStorage` key**
(`htaf_total_applications`) and rendered it into `#totalApplications`/
`#pendingApplications`; `#approvedApplications`/`#scheduledRides` were
hardcoded to the literal string `"0"`. `incrementApplicationCounter()`
bumped that same localStorage key by 1 after a successful
`POST /api/foundation/apply`, but only in the submitting browser — no
other visitor, and no page reload from a different device, would ever
see a nonzero count. This never touched the server, so it was
structurally guaranteed to diverge from the admin dashboard's live
database view.

A second, separate defect was found and deliberately **not** touched
here per explicit scope: `GET /api/admin/foundation/applications` uses
`select("*")`, returning full applicant PII (name, email, phone, etc.)
in the same response as operational status. That's a real gap, but it's
an authorization/privacy issue orthogonal to the counter bug, and is
scheduled as its own future audit/PR so it doesn't get mixed into this
functional repair.

## What this PR does

### 1. Public HTAF statistics — real numbers, fail-closed

**`GET /api/foundation/public-stats`** (new, public, no auth) —
`server.js`, placed directly after the existing `/api/foundation/status/:code`
route.

- Queries `htaf_applications` for the `status` column only — structurally
  incapable of leaking PII, since no other column is ever fetched.
- Delegates the counting to a pure function, `computeHtafPublicStats`
  (`lib/htafOperations.js`), so the metric definitions are tested in
  isolation from the database call:
  - `applications_submitted` = every row returned (this schema has no
    soft-delete column on `htaf_applications`, confirmed via
    `information_schema.columns` — "all non-deleted" is simply "all
    rows" here)
  - `pending_review` = `submitted` + `under_review` + `pending_documents`
    (kept as three distinct statuses, not collapsed into "submitted")
  - `approved_requests` = `approved`
  - `scheduled_rides` = `scheduled`
- On any Supabase query error, returns **503** with an explicit
  "temporarily unavailable" message — never a fabricated `0`. A real
  empty table and a broken query are different facts and must never
  render identically.
- Response includes `generated_at` (server timestamp) alongside the four
  counters.

**`public/foundation.html`** — removed entirely:
- `htaf_total_applications` localStorage key
- `incrementApplicationCounter()`
- `updateDashboardCounters()`'s localStorage read and its two hardcoded
  `"0"` literals

Replaced with `refreshPublicStats()`, which fetches the new endpoint and
renders the four real counts, or renders the literal text **"Unavailable"**
into all four stat cards if the fetch fails or the response isn't `ok`
— never falling back to `"0"`. Called on page load and again after a
successful application submission (so a submitter sees their own
application reflected without a manual refresh).

### 2. HTAF application → ride idempotency

**Problem:** `POST /api/admin/foundation/applications/:id/create-ride`
had no idempotency check at all — it unconditionally inserted a new
`rides` row and then updated the application. A retried request or an
admin double-click could create two rides for one application, silently
orphaning the first.

**Pre-migration production safety check** (required before adding any
unique constraint), run read-only via `mcp__Supabase__execute_sql`
against the live project on 2026-08-06:

```sql
select htaf_application_id, count(*)
from rides
where htaf_application_id is not null
group by htaf_application_id
having count(*) > 1;
```

Result: **zero rows.** No existing duplicates. Also confirmed all 4
current HTAF applications have `ride_id = null` and zero `rides` rows
currently reference any `htaf_application_id` — a clean slate, so this
migration needs no backfill/cleanup step. Full evidence and the
column-type lookups used to write the migration are recorded in the
migration file's header comment
(`supabase/migrations/20260806120000_htaf_ride_idempotency.sql`).

**Fix, two layers:**

1. **`create unique index ... on rides(htaf_application_id) where
   htaf_application_id is not null`** — database-level backstop. A ride
   can never be linked from more than one HTAF application. Partial
   index, so it doesn't constrain the many rides with no HTAF
   application at all.
2. **`create_htaf_ride_atomic(...)`** — a `plpgsql` RPC (same pattern as
   `apply_driver_compliance_override`) that does the whole "check for an
   existing ride, and if none exists, create exactly one" sequence as a
   single transaction:
   - `select ... for update` locks the application row, serializing any
     concurrent calls for the *same* application. The second concurrent
     caller blocks until the first commits, then sees the first's
     `ride_id` and returns `existing` instead of racing to insert a
     second ride. The unique index is the backstop for any race this
     lock doesn't catch (e.g. a caller that bypasses this RPC entirely).
   - Returns a discriminated `outcome`: `created`, `existing`,
     `not_found`, or `inconsistent` (with a `reason`:
     `ride_id_not_found` or `status_ahead_of_ride_id`). An inconsistent
     application state is reported for manual admin review, never
     guessed at or silently repaired.
   - The ride INSERT uses an explicit, fully-enumerated column list —
     deliberately not `jsonb_populate_record`, which would NULL-fill
     every `rides` column not present in the payload and could violate a
     `NOT NULL` constraint or override a real column `DEFAULT` on one of
     the many `rides` columns outside HTAF's ~20-field payload (verified
     via `information_schema.columns`: e.g. `autonomous_pilot` and
     `human_fallback_allowed` are `NOT NULL DEFAULT false` — an explicit
     INSERT lets Postgres apply those defaults for unlisted columns;
     `jsonb_populate_record` would not).

**`server.js`'s route rewrite** — `POST
/api/admin/foundation/applications/:id/create-ride` now:
- Still loads the application first, but only to build the ride's field
  values (rider name/phone, pickup/dropoff, fare estimate) — not to
  decide whether to create anything.
- Calls `supabase.rpc("create_htaf_ride_atomic", {...})` with all 18
  parameters.
- Maps the RPC's `outcome` to an HTTP response via a second pure
  function, `resolveCreateRideOutcome` (`lib/htafOperations.js`):
  `created` → 201, `existing` → 200 (same ride, `created: false`),
  `not_found` → 404, `inconsistent` → 409 with the `reason` surfaced in
  the response body.
- Audit-logs every outcome (`htaf_application_converted_to_ride` on
  success, `htaf_application_create_ride_<outcome>` otherwise) — so a
  duplicate-click's `existing` outcome is visible in the audit trail,
  not silently absorbed.
- Only broadcasts the `htaf_ride_created` SSE event when a ride was
  actually newly created.

**Not applied to production**: the migration file exists on this branch
only. `mcp__Supabase__apply_migration` was **not** called. Applying it
requires explicit separate approval per the standing instruction to stop
before touching production schema/data.

## Explicit scope exclusions (not touched by this PR)

Rider authentication; payment ownership; PR #97/#101; HTAF eligibility
rules; admin PII exposure on `GET /api/admin/foundation/applications`
(scheduled as its own future audit); the by-email status lookup route;
the `HTAF_STATUS` enum/cancelled-state design; any HTAF UI redesign
beyond the stat-card fetch logic.

## Tests

`lib/htafOperations.test.js` (17 tests, all passing):

- Real multi-status input produces the correct four counters.
- Each of the 7 canonical `HTAF_STATUS` values maps to the correct
  counter bucket (or none, for `denied`/`completed`).
- Pending-review statuses are kept distinct from `applications_submitted`
  — not collapsed into it.
- Empty/non-array input produces real zero counts rather than throwing.
- `computeHtafPublicStats`'s output contains only the four documented
  integer fields — asserted directly, plus a check that no PII-shaped
  key (`email`, `phone`, `first_name`, `name`, etc.) is ever present.
- `resolveCreateRideOutcome`: `existing` → 200 + the existing ride;
  `created` → 201 + the new ride; `not_found` → 404; both
  `inconsistent` reasons (`status_ahead_of_ride_id`,
  `ride_id_not_found`) → 409 with the reason surfaced; an unrecognized
  outcome fails closed with 500 rather than guessing.

Full suite: **357/357 passing** (`npx jest`), including all pre-existing
tests — no regressions.

### What automated tests do not cover, and why

- **Database-failure → "Unavailable" behavior** and **the no-PII shape
  of the actual HTTP response** are enforced by `server.js`'s route code
  (`select("status")` only; `if (error) return fail(..., 503)` before
  ever calling the counting function) rather than by a Jest test — this
  codebase has no integration harness that mocks the Supabase client
  against Express routes (confirmed: every existing `*.test.js` file
  tests a pure `lib/` module, never a live route). The pure-function
  tests above cover the logic Jest *can* reach; the route-level wiring
  was verified by direct code reading, the same classification this
  repo's other PR docs use for UI/IO paths Jest can't exercise.
- **Concurrent create-ride requests producing only one ride** is a
  database-transaction guarantee (`select ... for update` row lock +
  partial unique index), not application logic — proving it live would
  require applying the migration to a real Postgres instance (a
  disposable Supabase branch, not production) and firing concurrent RPC
  calls at it. That wasn't done in this PR to avoid any database
  provisioning action beyond what was explicitly requested; the
  transactional design itself is described above and mirrors the
  already-reviewed `apply_driver_compliance_override` pattern used
  elsewhere in this codebase. Recommend a live check on a disposable
  branch (or in the same click-through pass the migration's application
  to production gets) before that migration is applied for real.

## Verification classification

| Claim | Classification | Basis |
|---|---|---|
| Root cause is localStorage-only counters, not RLS/casing/wrong-endpoint | **Confirmed** | Direct code trace of `foundation.html`; grep confirmed those 4 element IDs are referenced nowhere else in the file. |
| No existing duplicate `rides.htaf_application_id` values in production | **Confirmed** | Live read-only query, zero rows returned. |
| All 4 current HTAF applications have `ride_id = null`; zero rides reference any HTAF application | **Confirmed** | Live read-only queries. |
| `create_htaf_ride_atomic`'s row lock + unique index prevent double-ride creation under concurrency | **Confirmed by code/design review, not exercised by an automated test** | See "What automated tests do not cover" above. |
| Public-stats endpoint cannot leak applicant PII | **Confirmed** | `select("status")` is the only column fetched; response shape asserted by test. |
| `foundation.html` shows "Unavailable" (not "0") on fetch failure | **Confirmed by code read** | `refreshPublicStats()`'s `catch` branch; no browser click-through performed as part of this PR. |

## Rollback plan

- `server.js`/`foundation.html`/`lib/htafOperations.js` changes: trivial
  revert, no data touched.
- The migration: not applied, so nothing to roll back. If it's applied
  later and needs reverting, `drop function
  public.create_htaf_ride_atomic; drop index
  rides_htaf_application_id_unique;` — safe as long as no ride relies on
  the constraint by then (none do today, per the pre-migration check
  above).

## Next step (explicitly deferred, not part of this PR)

Schedule the HTAF admin PII/authorization audit
(`GET /api/admin/foundation/applications` and any other admin-only route
returning full applicant records) as its own dedicated audit/PR.

# CODE BLUE Phase 1 — Migration Deployment-Compatibility Matrix

Status: **analysis only. Nothing applied anywhere.** Covers the four
migrations proposed for production in PR #130
(`code-blue/dispatch-integrity-phase-1`), updated to reflect PR #131
(`claude/driver-accept-hotfix-31s1mg`, a paired production hotfix PR),
which this branch has since incorporated by rebase/mirror. **Approved
merge order, per #131's own description: #131 first, then #130 rebased
onto the new `main`.** This matrix assumes that order throughout.

---

## Why a fifth migration effectively exists now

Two bugs were found this session in migrations that hadn't been applied
anywhere yet, via read-only schema comparison against production
(`information_schema.columns`), independently of — and in one case
(`current_offer_id`) duplicating — a parallel session's own finding:

1. `dispatch_functions_hardening.sql`'s replacement `dispatch_ride_atomic()`
   referenced `rides.current_offer_id`, which does not exist. **Already
   corrected on this branch** (by the parallel session, more thoroughly
   than my own first pass: they removed the dependency on that column
   entirely rather than adding it, and switched the function
   redefinition from `CREATE OR REPLACE` to `DROP FUNCTION IF EXISTS` +
   `CREATE FUNCTION`, because `CREATE OR REPLACE FUNCTION` cannot change
   a function's return type, and the return type does change here
   (`table(offer_id text)` → `table(offer_id text, outcome text)`) —
   `CREATE OR REPLACE` alone would have failed the migration outright).
2. `rides_quote_jti_idempotency.sql` created a unique index on
   `rides.quote_jti` without ever adding that column. **Fixed this
   session** (commit `81ac862`) — `alter table rides add column if not
   exists quote_jti text;` now precedes the index creation.

Both fixes are already committed to `code-blue/dispatch-integrity-phase-1`
and covered by the full suite (752 passing / 49 skipped opt-in DB tests
locally, all green including the new `db-functions` CI job against real
Postgres+PostGIS — confirmed via GitHub check runs on PR #130's current
head).

---

## The four (five, in practice) migrations

| # | Migration | What it does |
|---|---|---|
| 1 | `20260927220000_driver_earnings_unique_ride.sql` | `UNIQUE(ride_id)` constraint on `driver_earnings`. |
| 2 | `20260927220100_rides_payment_capture_and_cancellation_columns.sql` | Adds payment-capture/cancellation-reconciliation columns + CHECK constraints to `rides`. |
| 3 | `20260927220200_rides_quote_jti_idempotency.sql` | Adds `rides.quote_jti` (fixed this session) + unique partial index. |
| 4 | `20260927220300_dispatch_functions_hardening.sql` | Corrected `dispatch_ride_atomic()`/`nearest_drivers()`, grant hardening. |
| 4b | `20260927220400_accept_driver_offer_atomic.sql` (added by the paired hotfix work) | New transactional `accept_driver_offer_atomic()` RPC; `dispatch_ride_atomic()` result shape and grants live here too (same migration 4, corrected). |

---

## Per-migration compatibility

### Migration 1 — `driver_earnings` UNIQUE(ride_id)

| | |
|---|---|
| **Old server before** | Inserts an earnings row per completed ride with no DB-level duplicate guard; a double-tap/retry could insert two rows for one `ride_id`. |
| **Old server after migration, before new code deploys** | Unaffected in the common case (`driver_earnings` is empty in production today, confirmed via pre-migration check in the migration file itself) — the constraint only ever rejects a *second* insert for the same `ride_id`, which the old server's own logic was already trying not to do. If it ever did double-insert, the second attempt now fails loudly (a real Postgres error) instead of silently succeeding twice — a strictly safer failure mode, not a new one. |
| **New server expects** | `upsertDriverEarningIdempotent()` inserts, and on a `23505` (unique-violation) does a controlled lookup-and-return of the existing row instead of erroring — this is what actually needs the constraint to exist to work as designed. |
| **Rollback after app code uses it** | Safe — dropping the constraint later doesn't remove any data or break the new code's `23505`-handling branch (it just becomes dead code, no crash). |
| **Required order** | Migration can apply before, with, or after the new server code — no ordering dependency in either direction. |
| **Rolling-deploy overlap risk** | None identified. |

### Migration 2 — `rides` payment/cancellation columns

| | |
|---|---|
| **Old server before** | Never reads or writes any of these columns; writes only the pre-existing loose `rides.payment_status` (webhook handler, `'failed'` only). |
| **Old server after migration, before new code deploys** | Fully unaffected — new nullable columns with `add column if not exists` don't change any existing row or query the old server issues. The new `CHECK` constraint on `payment_status` only restricts *future* writes to a fixed enum (`pending`/`capture_pending`/`captured`/`capture_failed`/`not_required`/`failed`) — the old server's only write to this column (`'failed'`) is inside that enum, so it keeps working unmodified. |
| **New server expects** | `captureRidePaymentIdempotent()`/`reconcileCancellationPayment()` read/write `payment_capture_idempotency_key`, `payment_capture_attempted_at`, `payment_capture_error`, `cancellation_payment_status` (+ its own CHECK), `cancellation_payment_idempotency_key`, `cancellation_payment_attempted_at`, `cancellation_payment_error`. All of these must exist before the new code's first request that touches them, or every capture/cancellation-reconciliation call errors. |
| **Rollback after app code uses it** | Not clean — dropping these columns after the new code is live would break every completion/cancellation call immediately (hard dependency, not a nullable-and-ignored case). Rollback path is "redeploy the old server code," not "drop the columns," if this migration is ever reverted after the new code is live. |
| **Required order** | **Migration before new-server deploy**, same direction as 1 and 3 but with a hard (not soft) dependency once new code is live. |
| **Rolling-deploy overlap risk** | Old server instances are unaffected by the columns existing early (see above), so applying this migration well before any server deploy, and tolerating old+new server instances running simultaneously afterward, is safe **in this specific migration's direction**. The unsafe direction (new code before columns exist) is the one to avoid. |

### Migration 3 — `rides.quote_jti` + unique index (as fixed this session)

| | |
|---|---|
| **Old server before** | Never reads or writes `quote_jti` at all — the jti-replay feature is new in this branch's `lib/rideQuote.js`. |
| **Old server after migration, before new code deploys** | Fully unaffected — a new nullable column and a partial unique index (`WHERE quote_jti IS NOT NULL`) that's never populated by old code is inert. |
| **New server expects** | `POST /api/rides/request`'s insert always includes `quote_jti: quote.jti || null`. **Without this migration, that insert fails outright** — PostgREST rejects an insert payload referencing a column that doesn't exist, unlike an `.update()` which at least targets an existing row; this would break ride creation entirely the moment new code deploys against the unmigrated schema. |
| **Rollback after app code uses it** | Not clean — same reasoning as Migration 2's hard columns. Rollback path is redeploying old server code. |
| **Required order** | **Migration strictly before new-server deploy.** This is the tightest ordering constraint of the four: unlike Migration 2 (whose columns are read/written but don't block the insert itself if absent, since they're separate `.update()` calls after the ride exists), a missing `quote_jti` column breaks the *ride-creation insert itself* — the single most central write in the app. |
| **Rolling-deploy overlap risk** | If any old-server instance is still receiving traffic after this migration applies, no risk (inert to old code). If any *new*-server instance receives traffic before this migration applies, every ride-creation request fails. On a Render rolling deploy, this means: **apply this migration, confirm it, only then begin the rolling deploy of new server code** — never the reverse, and never "apply migration and deploy simultaneously" without confirming the migration committed first. |

### Migration 4/4b — `dispatch_ride_atomic()` / `nearest_drivers()` / `accept_driver_offer_atomic()`

| | |
|---|---|
| **Old server before** | Calls `dispatch_ride_atomic()` expecting `table(offer_id text)`; the live function currently throws on every real invocation (the pre-existing `current_driver_id` bug), so old server has been running exclusively through its two-step fallback this whole time (see below for what "old server calling new RPC" actually does). Old server's accept route (`POST /api/driver/offers/:id/accept`) does its own direct `.update()` on `rides` including `current_driver_id`, unchecked — this is the bug PR #131 fixes at the code level, independent of any migration. |
| **Old server after migration, before new code deploys** | **This is the one genuinely risky direction, analyzed in detail below.** |
| **New server expects** | Calls `dispatch_ride_atomic()` and branches on `result.outcome` (`"created"` / `RIDE_LEVEL_DISPATCH_OUTCOMES` / anything else treated as a per-candidate decline); calls the new `accept_driver_offer_atomic()` RPC for accept (PR #131/#130 code). |
| **Rollback after app code uses it** | `DROP FUNCTION`/recreate the old single-column-returning version would break the new code's `result.outcome` branching (falls to "declined, try next candidate" for every call, eventually marking every ride `no_drivers_available` incorrectly — see the return-shape proof below). Rollback path is redeploying old server code, not reverting the function. |
| **Required order** | **New server code (#131, then #130) before this migration applies**, the opposite direction from Migrations 2 and 3 — detailed next. |
| **Rolling-deploy overlap risk** | Real, and the reason the order is reversed relative to 2/3. See below. |

---

## `dispatch_ride_atomic()` return-shape compatibility — the specific proof requested

### How the currently-deployed (old) server parses the response

```js
// origin/main, current production code
const result = Array.isArray(rpcResult) ? rpcResult[0] : rpcResult;
if (result && result.offer_id) {
  // ...success path...
}
```

Reads exactly one property (`result.offer_id`), truthy-checked. Never
references `outcome`, never assumes a fixed column count, never does
positional/array destructuring of the row's fields.

### How the new server (this branch) parses it

```js
// code-blue/dispatch-integrity-phase-1, current head
const result = Array.isArray(rpcResult) ? rpcResult[0] : rpcResult;
if (result && result.outcome === "created" && result.offer_id) {
  // ...success path...
}
if (result && RIDE_LEVEL_DISPATCH_OUTCOMES.has(result.outcome)) {
  // ride-level outcome: stop, don't try another candidate or fall back
}
// otherwise: log a per-candidate decline, try the next driver
```

Reads `result.offer_id` and `result.outcome` by name, same
property-access style as the old code, just checking an additional
named field.

### Can an extra returned column break the currently-deployed (old) server?

**No.** Supabase-js's `.rpc()` returns each row as a plain JS object
keyed by column name (via PostgREST/JSON), not a positional
tuple/array-per-row. The old code's `result.offer_id` access is
unaffected by whatever other keys exist on that object — `result.outcome`
would simply be present-but-unread. Confirmed directly in this
session's earlier reading of `main`'s `server.js` (no destructuring,
no `Object.keys().length` checks, no strict-shape validation anywhere
in the dispatch path) — and now independently re-confirmed by the
parallel session's own test, `test/db/acceptDriverOfferAtomic.db.test.js`
line 661, **"the deployed server's call shape (reads only offer_id)
still works"** — a real test against a real Postgres instance proving
exactly this claim, not just static analysis.

### The direction that actually matters: new server code against the OLD (currently-live) function

This is the more important compatibility question for sequencing,
since the approved order is new code first, migration second — meaning
for some window, **new server.js code will call whatever
`dispatch_ride_atomic()` is currently live**, which as of today's
schema state throws a real Postgres error (`column current_driver_id
does not exist`) inside the function body before ever returning a row
(confirmed via `pg_get_functiondef` this session). Traced through the
new code's loop:

```js
const { data: rpcResult, error: rpcError } = await supabase.rpc(...);
if (rpcError) {
  console.warn("... using two-step fallback:", rpcError.message);
  rpcUnavailable = true;
  break;
}
```

The live function's error surfaces as `rpcError` (a real thrown
exception inside PL/pgSQL becomes a returned error from PostgREST, not
a successful response with an unusual shape) — so this hits the
`rpcError` branch immediately on the first candidate, sets
`rpcUnavailable = true`, and falls through to the two-step fallback.
**This is exactly the same behavior the old server has been exhibiting
this whole time** (per the migration's own historical-record comment:
"every dispatch has almost certainly been running through the fallback
path this entire time, invisibly") — so deploying the new server code
*before* the migration applies doesn't change dispatch's real-world
behavior at all; it only changes what happens once the migration lands.

**Caveat, stated precisely rather than assumed away:** this conclusion
depends on the live function continuing to fail via a thrown exception
(as it does today) rather than ever returning a "successful" row that
merely lacks an `outcome` column. If some *other*, different old-shape
RPC existed that succeeded without an `outcome` field, the new code
would misinterpret that success as a per-candidate decline for every
driver and eventually mark the ride `no_drivers_available` incorrectly
— not a data-integrity failure, but an availability regression. This
does not apply to the actual function live in production today, verified
directly rather than assumed.

### Confirmed: no outside-service caller

Searched this repo's client code (`public/`, `mobile/`, `src/`) and this
session's own earlier audit: no Supabase SDK is used client-side
anywhere, and no backend configuration (Render env, CI, docs) references
calling `dispatch_ride_atomic`/`nearest_drivers`/
`accept_driver_offer_atomic` from anywhere other than `server.js`'s own
service-role client. Combined with the EXECUTE-grant hardening (both
migrations revoke `PUBLIC`/`anon`/`authenticated`, confirmed via this
session's own read-only grant query against production), there is no
outside-service usage to preserve compatibility for — **no RPC
versioning under a new name was necessary**, and none was done; the
existing name was corrected in place, consistent with how PR #131/#130
actually shipped it.

---

## Required migration order (within the four/five)

No inter-migration ordering dependency exists among 1, 2, 3, and 4 —
they touch disjoint objects (`driver_earnings`, `rides`'s payment
columns, `rides.quote_jti`, and the two/three functions respectively)
and none reads a column or object another one creates. They can apply
in any order or in a single batch. The only real ordering constraints
are each migration's own relationship to server code deployment,
covered above and summarized next.

## Required application deployment order

1. **#131 merges first** (code-only hotfix: truthful accept/decline
   errors, no nonexistent-column writes, `requireDriverSelf` auth) —
   safe to deploy against the current, unmigrated production schema,
   since it removes writes to columns that don't exist rather than
   adding dependencies on columns that don't exist yet.
2. **#130 rebases onto the new `main`** and is reviewed/approved
   separately.
3. Once #130 is approved: **apply Migrations 2 and 3 (the hard,
   new-code-depends-on-these-columns migrations) before deploying #130's
   server code** — the reverse of Migration 4's direction. Migration 1
   has no ordering constraint either way.
4. **Deploy #130's server code**, which is now safe to call the
   still-old `dispatch_ride_atomic()`/accept path (falls back correctly,
   per the return-shape proof above) if Migration 4 hasn't landed yet.
5. **Apply Migration 4/4b** (the dispatch/accept RPC hardening) —
   safe at any point after step 4, since the new server code is already
   equipped to parse its outcome-based contract correctly.

## Rolling-deployment overlap window (Render)

Render's rolling deploy briefly runs old and new server instances
side by side behind the same load balancer. Given the order above:

- During the Migration 2/3 → deploy window: **old server instances
  remain unaffected** by the new columns/index existing early (both
  are purely additive and never read by old code) — safe overlap.
- During the deploy → Migration 4/4b window: **both old and new server
  instances may be receiving traffic simultaneously while the RPC is
  still in its pre-hardening state** — per the return-shape proof, both
  behave identically during this window (both fall back to the
  two-step path on the live function's `current_driver_id` error),
  so this overlap is safe specifically because of the corrected order,
  not despite it. Reversing the order (migration before new-code
  deploy) is what would make this window unsafe, since old-server
  instances would then be calling the *new* RPC contract without
  understanding `outcome`, hitting the same "misinterprets success as
  decline" risk described above — this is exactly why #131/#130's own
  approved order exists.

---

## RPC-hardening staging test coverage — already implemented, not redesigned here

The user's requested test list (anon/authenticated/PUBLIC cannot
execute either RPC; service_role can; eligible driver gets an offer;
busy driver excluded; concurrent same-driver race yields ≤1 valid
assignment; ineligible driver rejected in-lock; ride schema fields
updated correctly; failure leaves no partial offer; no
`current_driver_id` dependency; Node fallback limitations documented)
is **already implemented** as real tests against a real
Postgres+PostGIS instance in `test/db/acceptDriverOfferAtomic.db.test.js`
(scaffolded by the parallel session, running in CI's new `db-functions`
job, confirmed green on PR #130's current head via GitHub check runs):

| Requested test | Covered by |
|---|---|
| `anon` cannot execute | `"anon" cannot execute any of them` (execute-privileges block) |
| `authenticated` cannot execute | `"authenticated" cannot execute any of them`, same block |
| `PUBLIC` has no effective grant | `"a role holding only PUBLIC privileges cannot execute any of them"`, via a synthetic no-membership probe role |
| `service_role` can execute both | `test.each(FUNCTIONS)("service_role can execute %s", ...)` |
| Eligible driver receives offer | `"creates a pending offer and marks the ride offer_sent without assigning a driver"` |
| Busy driver excluded | `nearest_drivers`: `"excluding busy and access-revoked ones"`; `dispatch_ride_atomic`: `"a driver on an active ride"` → `driver_no_longer_available` |
| Ineligible (offline/access-revoked/already-offered) driver rejected in-lock | `test.each` over `["on an active ride", "holding another live offer", "offline", "access revoked"]` → `driver_no_longer_available` |
| Ride schema fields updated correctly | Asserted directly (`status`, `dispatch_status`, `dispatch_attempts`, `driver_id`, `assigned_driver_id`) in the "creates a pending offer" test |
| Failure leaves no partial offer | `"a ride with a live pending offer returns ride_has_live_offer and creates nothing"` + every early-return outcome asserted to create zero offers |
| No `current_driver_id` dependency | Structural (the whole point of the fix) + `test/liveSchema.js` (PR #131) hard-fails any read/write of a column not in the real live schema's allow-list |
| Node fallback limitations documented | `server.js` comment directly above the fallback: "has no eligibility re-check of its own to justify trying more than one" |

**One item not explicitly covered, noted honestly rather than
overclaimed:** a same-driver, two-different-rides *concurrent dispatch*
race (the direct `dispatch_ride_atomic` analog of the accept-side test
`"one driver racing to accept offers for two rides: exactly one
assignment, no partial state"`) isn't a separate named test in what
this session reviewed. The advisory-lock mechanism is identical between
`accept_driver_offer_atomic` and `dispatch_ride_atomic` (same
`hashtext('dispatch_driver:'||...)`-keyed `pg_advisory_xact_lock`,
confirmed by reading both function bodies), so the proven mechanism
should extend, but this specific scenario for `dispatch_ride_atomic`
itself wasn't independently observed as its own test case in this
review pass. Flagged as a minor test-coverage gap, not a known behavior
gap.

**Staging Supabase project note:** this real-Postgres test suite runs
against an ephemeral, CI-provisioned `postgis/postgis:17` container
(`test/db/pgHarness.js`, `test/db/live-baseline.sql`), not the
`harvey-taxi-staging` project this session is separately waiting on. It
already satisfies the *function-level* correctness/security testing
requested. The still-pending `harvey-taxi-staging` project remains
necessary for: applying and observing Migration 1 specifically (per
your explicit approval, scoped to that migration only), Stripe
test-mode payment-flow verification (needs a real network-reachable
project), and any full HTTP-level app compatibility pass against a
live, schema-drifted-and-then-corrected database rather than a
from-migrations-only baseline.

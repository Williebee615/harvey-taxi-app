# Production Incident Log

Running record of production defects and the configuration drift found
alongside them. Each entry separates the **code defect** (fixed by a PR,
verifiable by tests) from **configuration drift** (an environment value
that's wrong regardless of what the code does) and states the **launch
impact** explicitly, since the two are easy to conflate and shouldn't be
closed together just because the code is fixed.

---

## 2026-07-28 — Rider signup 500 ("Internal server error.") — CLOSED

**Reported**: Rider onboarding failing with "Rider signup failed.
Internal server error." on `POST /api/riders/signup`.

**Status**: Resolved and confirmed in production. Code defect fixed
(PR #59), configuration drift fixed (`PUBLIC_APP_URL` set in Render),
and a real end-to-end rider signup succeeded on the live domain,
independently verified against the database.

### Code defect — RESOLVED (PR #59, merged to `main` as `b5a60ec`)

`isAllowedOrigin()` in `server.js` accepted only an exact match against
a single `APP_BASE_URL` whenever `ALLOWED_ORIGINS` wasn't explicitly
configured. This platform legitimately serves the same app from two
public domains — `harveytaxiservice.com` and
`harveytransportationfoundation.com`, each with a `www.` variant, per
the existing `FOUNDATION_HOSTS` routing — plus `APP_BASE_URL` itself
can fall back to Render's auto-generated `*.onrender.com` URL. Any POST
whose `Origin` header didn't exactly match that one value was rejected
by the `cors` package's origin callback, which throws into Express's
*global* error handler instead of the route's own error handling,
producing the generic `"Internal server error."` response with no
database call ever made.

Verified this was not a repeat of the earlier rider-signup schema
incident: pulled the live `riders` table schema directly from Supabase
and confirmed it matches `lib/riderVerification.js`'s
`RIDERS_TABLE_COLUMNS` column-for-column, and Supabase's `api` and
`postgres` logs showed no `POST /rest/v1/riders` and no query errors in
the relevant window — the request never reached the database.

Fix: extracted the origin check into `lib/corsOrigins.js`. The default
allowlist (when `ALLOWED_ORIGINS` isn't set) now includes the canonical
host, the foundation host, both `www` variants, and `APP_BASE_URL`,
instead of only `APP_BASE_URL`. An explicitly configured
`ALLOWED_ORIGINS` is unchanged and still takes precedence.

Regression test: `lib/corsOrigins.test.js` (11 tests), including one
specifically for `APP_BASE_URL` resolving to Render's own URL — the
exact condition later confirmed in production boot logs below.

### Configuration drift — RESOLVED 2026-07-28, one pending confirmation

Render's boot log at the time this was first reported showed:

```
🏠 App URL: https://harvey-taxi-app-2.onrender.com
==> Available at your primary URL https://harveytransportationfoundation.com + 4 more domains
```

`APP_BASE_URL` was resolving to Render's auto-assigned URL, not
`https://harveytaxiservice.com`. Root cause: `server.js`'s resolution
order is `PUBLIC_APP_URL → APP_BASE_URL → RENDER_EXTERNAL_URL →
localhost`, and neither `PUBLIC_APP_URL` nor `APP_BASE_URL` was set in
Render's environment configuration for this service.

**Action taken**: `PUBLIC_APP_URL=https://harveytaxiservice.com` was set
in Render's environment and the service redeployed. The fresh boot log
confirms it took effect:

```
🏠 App URL: https://harveytaxiservice.com
```

Separate, non-blocking note: Render's deploy output still reports
`Available at your primary URL https://harveytransportationfoundation.com`.
This is a distinct Render dashboard setting (which custom domain Render
considers "primary" for that service) — unrelated to `PUBLIC_APP_URL`/
`APP_BASE_URL` or to the CORS fix. Cosmetic; does not affect
`isAllowedOrigin()`, redirects, or anything read from `APP_BASE_URL` in
the app itself. Left open only as an optional cleanup item, not tracked
as part of this incident's launch impact.

**Verification checklist**:

- [x] Render boot log shows `🏠 App URL: https://harveytaxiservice.com` — confirmed 2026-07-28
- [x] `APP_BASE_URL` resolves to `https://harveytaxiservice.com` — confirmed via the boot log above
- [x] Request from `https://harveytaxiservice.com` — accepted — confirmed 2026-07-28 by a real rider signup completed on that exact domain (see evidence below)
- [ ] Request from `https://www.harveytaxiservice.com` — accepted (not independently attempted; covered by `lib/corsOrigins.test.js`)
- [ ] Request from the foundation domain — accepted (not independently attempted; covered by `lib/corsOrigins.test.js`)
- [ ] Request from the foundation domain's `www.` variant — accepted (not independently attempted; covered by `lib/corsOrigins.test.js`)
- [ ] Request from an unrelated/unknown origin — still blocked (not independently attempted; covered by `lib/corsOrigins.test.js`)
- [x] Rider signup succeeds end-to-end from the live production domain — **CONFIRMED 2026-07-28**

**Evidence**: a real rider signed up from `harveytaxiservice.com` and the
app returned "Rider account created successfully" with
`Rider ID: RIDER-7DCDBAA6E2`, `Status: Pending`,
`Verification Type: Driver License` (screenshots on file). Independently
verified against the live database:

```sql
select id, first_name, last_name, email, phone, city, state, status, approval_status, created_at
from riders where id = 'RIDER-7DCDBAA6E2';
-- {"id":"RIDER-7DCDBAA6E2", ..., "status":"pending_verification",
--   "approval_status":"pending", "created_at":"2026-07-28 15:23:46.606+00"}
```

The row exists, matches the screenshot exactly, and the account is
correctly `pending_verification` / `pending` per the approval-gate
design (`ENABLE_RIDER_APPROVAL_GATE`) — not auto-approved, as intended.

The remaining four checklist items (www variant, foundation domain and
its www variant, unrelated-origin rejection) were not independently
attempted against the live site, but are locked in by the 11 tests in
`lib/corsOrigins.test.js` added in PR #59, so they are not treated as
open risk — just not separately smoke-tested against production traffic.

**Non-incident note**: the same screenshots show "Unable to load the
card payment form. You can add a card later." during the optional
add-payment-method step. This is expected, not a defect — the Render
boot log shows `💳 Stripe: OFF` for this service, so the card form
correctly cannot load while Stripe is disabled. Not tracked as part of
this incident.

**What this agent can / cannot verify directly**: no Render API or
dashboard access in this environment — the `PUBLIC_APP_URL` change and
the boot logs were supplied by the user, not pulled independently. This
environment's own network policy also blocks outbound requests to
`harveytaxiservice.com`, so no check in this incident was run by
directly hitting the live site from here — the rider-signup confirmation
above was verified by cross-referencing the user's screenshot against an
independent Supabase database query, which is the strongest evidence
available from this environment.

### Launch impact

**RESOLVED, non-blocking.** Both the code defect and the configuration
drift are fixed and confirmed: a real rider signup succeeded end-to-end
from the live production domain, verified independently against the
database. This incident is closed.

---

## 2026-07-28 — Ignored driver offers never expire or redispatch

**Found during**: the AI Dispatch Commander audit (see
`docs/ai-dispatch-commander-architecture.md` §1.2), then isolated and
fixed as a standalone production-reliability hotfix per explicit
instruction, ahead of and separate from any dispatch-scoring/surge/
forecasting work.

### Code defect — RESOLVED

`driver_offers.expires_at` was written on every offer
(`createDriverOffer()`, `server.js`) but never read again anywhere in
the codebase. A driver who neither accepted nor declined an offer left
the ride stuck in `dispatch_status: "offer_sent"` indefinitely — there
was no automatic recovery, and the rider had no way to know anything
had gone wrong.

**Fix, all behind one rollback-able flag:**

- `lib/offerExpiry.js` — a new, pure, dependency-injected
  `sweepExpiredOffers()` orchestrator, same shape as the existing
  `sweepScheduledRides()` in `lib/rideDispatch.js`: finds pending offers
  past `expires_at`, atomically claims each one (`UPDATE driver_offers
  SET status='expired' WHERE id=? AND status='pending'`), and — only for
  the offer(s) it actually won the claim on — puts the ride back into a
  redispatchable state and calls the existing `dispatchRide()`,
  respecting `MAX_DISPATCH_ATTEMPTS` exactly the way decline-triggered
  redispatch already does (mirrors `server.js`'s existing
  `/api/driver/offers/:offerId/decline` logic rather than inventing a
  new redispatch path).
- **Concurrency safety**: the atomic conditional update
  (`.eq("status", "pending")`) is the entire mechanism preventing two
  server instances — or two sweep ticks, or a sweep racing a driver's
  own accept/decline tap — from redispatching the same ride twice. Only
  one caller ever sees a non-null claim result; everyone else sees
  `null` and skips.
- **Accept and decline routes hardened with the same pattern.** Both
  previously read an offer, then unconditionally wrote a new status —
  a TOCTOU race where an offer could be accepted or declined a moment
  after it had already expired. Both now perform the same atomic
  conditional update (`.eq("status", "pending")`) and check whether it
  actually matched a row before proceeding:
  - **Accept** now fails safely with a specific `409 "This offer has
    expired."` (or a generic "already responded to" message) instead of
    silently assigning a ride whose offer had already timed out.
  - **Decline** now returns a soft `{ declined: false, reason:
    "already resolved" }` instead of re-running redispatch logic for a
    ride the expiry sweep (or a duplicate request) already claimed
    responsibility for — this is what prevents a ride from being
    offered to two drivers at once via two different code paths.
- **Feature flag, off by default**: `offer_expiry_sweep_enabled`
  (`system_flags`, same fail-safe helper already used for
  `dispatch_paused`/`rider_history_enabled`). The sweep runs every 15
  seconds but does nothing unless the flag is explicitly turned on —
  flip it off at any time, with no deploy, if it misbehaves in
  production. The accept/decline atomic-guard hardening ships
  unconditionally, since it's a pure correctness fix with no behavior
  change on the success path.

### Regression tests

`lib/offerExpiry.test.js` — 9 tests against the orchestrator, explicitly
covering the five scenarios requested: an **ignored** offer past expiry
gets claimed and redispatches (respecting `MAX_DISPATCH_ATTEMPTS`, which
has its own dedicated test); an already-**accepted** offer is skipped,
not touched; an already-**declined** offer is skipped, not touched; two
**concurrently processed** claims on the same offer result in exactly
one redispatch, never two; plus edge cases (missing ride, a
`dispatchRide()` throw being recorded as a failure rather than crashing
the sweep, a query failure returning an empty result instead of
throwing, and multiple due offers processed independently in one pass).
103/103 tests passing repo-wide.

### Launch impact

**Non-blocking, and intentionally not yet live in production** — the
fix ships behind `offer_expiry_sweep_enabled`, defaulted off, so merging
this does not change production dispatch behavior until the flag is
explicitly turned on. Recommend enabling it in a low-traffic window and
watching `dispatch_status: "redispatching"`/`"max_attempts_reached"`
rates before broad rollout.

---

## 2026-07-28 — No rider cancellation endpoint exists (scoped, not fixed)

**Found during**: the same dispatch-engine audit. Recorded here as a
**separate operational defect** per explicit instruction — deliberately
not bundled with the offer-timeout hotfix above, and not implemented in
this pass.

### Defect

`RIDE_STATUS.CANCELLED` is defined in `lib/rideDispatch.js` and is
already referenced by the rider-history "finished rides" filter
(`server.js`), but **no route in this codebase ever sets a ride to
`cancelled`** — there is no cancel endpoint of any kind, for riders or
drivers, today. A rider who wants to back out of a ride currently has no
supported way to do so through the app.

### Why this matters for dispatch reliability specifically

The AI Dispatch Commander plan's Phase 1 (repositioning recommendations,
scoring, ETA accuracy) implicitly assumes the system can tell a
completed ride from one that simply never resolved. Without
cancellation, a rider who gives up and leaves leaves that ride sitting
in whatever state it was last in — `awaiting_driver_acceptance`,
`driver_assigned`, etc. — indistinguishable from a ride still genuinely
in progress, which would skew any future demand/repositioning signal
built on ride outcomes.

### Scope (not yet decided or built)

At minimum, a rider-facing cancel endpoint needs to decide, explicitly:

- Which ride states are cancellable (before driver assignment only? up
  to pickup? never after `in_progress`?).
- Whether a cancellation fee or partial charge applies once a driver has
  been dispatched or has arrived, and how that interacts with the
  existing Stripe payment-intent flow.
- What happens to a `driver_offers` row and an assigned driver when the
  ride underneath them is cancelled mid-offer or mid-assignment —
  notification, and whether it counts against that driver's acceptance
  stats.
- Whether HTAF (`foundation`) rides need different cancellation rules
  given they're tied to an approved application, not a self-service
  booking.

### Launch impact

**Not blocking Phase 1 of AI Dispatch Commander or the offer-timeout
hotfix above**, but a real, separate product gap worth prioritizing on
its own — not as part of dispatch intelligence work. No implementation
has started; this section exists to record the defect and its open
questions, not to propose an answer.

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

---

## 2026-07-29 — Ride authorization accepts an unverified `payment_intent_id` when Stripe is unavailable — FIX IMPLEMENTED, PENDING REVIEW/MERGE/DEPLOY

**Found during**: preparing a controlled production test of
`dispatch_eta_persistence_enabled` (see
`docs/production-verification-package.md`). While tracing how a ride
reaches `payment_authorized` in order to plan a safe test, found that the
real, currently-deployed authorization path does not actually require a
verified payment under today's configuration.

### Code defect — FIX IMPLEMENTED, not yet merged/deployed

`POST /api/rides/request` (`server.js`) only checks
`ENABLE_PAYMENT_GATE && !req.body.payment_intent_id` — any **non-empty,
client-supplied string** in `payment_intent_id` is sufficient to set
`status: PAYMENT_AUTHORIZED` and trigger `dispatchRide()` immediately,
with no call to Stripe to confirm the id refers to a real, authorized
payment.

`POST /api/rides/:id/authorize` has the same gap in a different shape:
it does attempt real Stripe verification (`stripe.paymentIntents
.retrieve()`, status/amount/binding checks) — but **only if the module-
level `stripe` client is non-null**. In this environment, `stripe` is
`null` because Stripe isn't configured (boot log: `💳 Stripe: OFF`), so
the entire verification block is skipped and the route falls straight
through to marking the ride `PAYMENT_AUTHORIZED` and dispatching it,
using whatever `payment_intent_id` string was supplied — again with no
verification against Stripe, because there is currently no Stripe
client to verify against.

**Net effect as currently deployed**: any caller who can reach either of
these public, unauthenticated routes can move a ride to
`PAYMENT_AUTHORIZED` and trigger a real driver dispatch by supplying an
arbitrary string as `payment_intent_id` — no payment method, no charge,
no Stripe account, no authentication of any kind required. This is true
today, independent of anything related to ETA persistence.

### Why this wasn't exploited to complete the ETA-persistence test

Explicit instruction during the ETA-persistence controlled-test planning
was to **not** use a placeholder/fake `payment_intent_id` to reach
`dispatch_ride()`, specifically because doing so would exercise this
exact gap against production. The test was redirected to a UI-driven
approach instead (the human operator uses the real rider/driver
interfaces; a real payment path — Stripe test-mode keys, or a properly
designed and separately-approved admin test-ride mechanism — is required
before any dispatch-triggering request is made). This defect is logged
here specifically so it isn't forgotten once that test concludes.

### The fix

Both open questions from the original scoping are resolved as follows,
implemented in `lib/riderPayments.js` (`decideInitialRideStatus`,
`verifyPaymentIntentForRide`) and wired into `server.js`:

- `POST /api/rides/request` no longer treats a client-supplied
  `payment_intent_id` as sufficient for `PAYMENT_AUTHORIZED` under any
  circumstance. Every ride created while `ENABLE_PAYMENT_GATE` is on
  lands in `PAYMENT_REQUIRED`, full stop — `decideInitialRideStatus()`
  doesn't even read the field for that decision. `payment_id` itself is
  now only populated at creation when the payment gate is explicitly off
  (an ops-level flag, not client input); a gated ride starts with no
  `payment_id` at all and gets one only from a verified `/authorize`
  call.
- `POST /api/rides/:id/authorize` now fails closed when `stripe` is
  null — `verifyPaymentIntentForRide()` checks `stripeConfigured` before
  anything else and returns a `503 "Payments are not configured. This
  ride cannot be authorized right now."` rather than ever silently
  authorizing. The rest of the verification (previously only reachable
  when `stripe` existed) is now the *only* way to reach
  `PAYMENT_AUTHORIZED` for a gated ride: intent status
  (`requires_capture`/`succeeded`), currency (newly added — the previous
  version checked amount but not currency), amount, not already bound to
  a different ride (reuse prevention), and rider match — each an
  independently unit-tested branch in `lib/riderPayments.test.js`.

**Round 2 — three more fail-closed corrections, found on review before
merge (the reviewer couldn't file this as a GitHub review since the PR
belongs to the same account that opened it, so it came back as plain
instructions instead):**

- **Binding failure now blocks authorization.** The first version logged
  a warning and continued to `PAYMENT_AUTHORIZED` if
  `stripe.paymentIntents.update()` (writing `ride_id` into the intent's
  metadata) failed — meaning the reuse-prevention guarantee wasn't
  actually established before dispatch proceeded. `authorizePaymentIntentForRide()`
  (new, wraps `verifyPaymentIntentForRide()`) now returns
  `502 "Could not secure this payment against reuse. Please try again."`
  and does not authorize when binding fails. The Stripe call itself is
  injected (`bindPaymentIntentToRide`) so the failure path is
  unit-tested without a live Stripe account, same dependency-injected
  shape as `sweepExpiredOffers()`/`sweepScheduledRides()`.
- **Currency is now required, not merely checked when present.** A real
  Stripe PaymentIntent always has a currency; a missing one now fails the
  same as a mismatched one (`intent.currency !== RIDE_PAYMENT_CURRENCY`,
  not `intent.currency && ...`).
- **Rider binding is now mandatory whenever the ride has an identified
  rider.** The first version only rejected a rider mismatch when
  `metadata.rider_id` was *present* — an attacker could create their own
  real, paid PaymentIntent with no `rider_id` in its metadata at all and
  use it to authorize any other rider's named ride, since an unbound
  intent also passes the ride-binding check. Deliberately **not** made
  unconditional, though: `POST /api/rides/request` has always supported
  an anonymous ride request (see the `if (riderId)` optional readiness
  check there, unrelated to and predating this fix) — a ride created that
  way has no identified rider to bind a payment against, so the rider
  check still only applies when `ride.rider_id` is set. Locked in with a
  dedicated test for each side of that boundary.

**HTAF/Foundation rides — resolved, not carved out.** The original
scoping note above asked whether HTAF/Foundation rides might need a
legitimate no-payment path. Traced `lib/pricing.js`: `ride_type ===
"foundation"` (and `"medical"`) only applies a 5% discount to the
eligible fare — there is no `$0`/free/sponsored ride path anywhere in
this codebase, and `/api/foundation/apply` /
`/api/foundation/status/:code` are the HTAF *application* approval
workflow, entirely separate from ride creation. Every ride, including
`ride_type: "foundation"`, is created through the single
`POST /api/rides/request` route and has a real, non-zero fare. There is
therefore no existing sponsored-ride bypass to preserve, and this fix
correctly applies to Foundation rides identically to every other ride
type — no exemption was added.

### Launch impact

**High priority. Fix implemented and unit-tested, but not yet merged to
`main` or deployed** — held per instruction pending review. Once merged
and deployed, this closes a real authorization gap in the currently
deployed production app that is independent of the ETA-persistence or
offer-expiry work in progress; it does not block or relate to
`dispatch_eta_persistence_enabled` (which is enabled and safe regardless
of how a ride reaches dispatch). Recommend merging and deploying this fix
on its own, ahead of any further dispatch-activation work, exactly as
originally recommended — not bundled with ETA persistence, offer-expiry,
or any dispatch-intelligence work.

**Status update**: merged and deployed. Confirmed live in a real end-to-end
test on 2026-07-30 with live Stripe keys.

---

## 2026-07-30 — No working path exists for a rider to complete verification and become eligible to book — OPEN, HIGH PRIORITY

**Found during**: a real end-to-end smoke test (real rider signup, real
Stripe payment, real ride request). A rider created back on 2026-04-12
(`willieharvey813@gmail.com`) hit "Your rider profile is not approved
yet" at the payment stage of the request-ride wizard.

### The gate itself is correct

`getRiderReadiness()` (`server.js`) requires `email_verified`,
phone/SMS-verified, `persona_verified` (bypassed to `true` while Persona
is disabled), and `status_ready` to all be true
(`Object.values(checks).every(Boolean)`). This rider genuinely had
`email_verified: false` and `sms_verified: false` in the database — the
gate correctly blocked booking. The defect is that there has never been
any way for that to become true.

### Three compounding gaps

1. **No rider-facing email verification page exists.** The verification
   email (`server.js`, around the `/api/verify/email/start` handler)
   links to `${APP_BASE_URL}/verify-email.html` — that file does not
   exist anywhere in `public/`. The link 404s.
2. **No rider-facing SMS verification UI exists anywhere.** The backend
   routes (`/api/verify/sms/start`, `/api/verify/sms/confirm`) are fully
   implemented, but no page in `public/` ever calls them — there is no
   "enter the code we texted you" screen for riders.
3. **The admin manual-approval UI is also broken, in two different ways,
   on two different pages.** `public/admin-rider-approval.html` calls
   `POST /api/admin/approve-rider`; `public/admin-verification.html`
   calls `POST /api/admin/approve-rider/:id`. Neither matches the real
   route, `PATCH /api/admin/riders/:id/approve`, so both 404 for admins
   too. Neither page sends the `x-admin-token`/`x-admin-email`+
   `x-admin-password` headers `requireAdmin` requires, so fixing only the
   URL would still leave them non-functional. Separately, the real route
   only ever set `status`/`approval_status` — never `email_verified`/
   `sms_verified` — so even a correctly-authenticated admin approval
   would not have satisfied `getRiderReadiness()` on its own.

**Net effect**: independent of payment, Stripe, or dispatch, there has
been no self-service or admin path for any real rider to ever become
eligible to book a ride.

### Fix — partial, in progress

`PATCH /api/admin/riders/:id/approve` now also sets `email_verified:
true, sms_verified: true` when an admin approves a rider — an explicit
"admin vouches for this rider" action, matching what completing the real
verification flow would set. This is a real, durable fix for *that*
route, but it doesn't yet solve how an admin reaches it (both existing
admin pages are still broken/unauthenticated) or give riders a
self-service path at all.

The specific rider from this test (`c5fb73da-2c17-4521-9e0c-eefcb46ffe0b`)
was unblocked directly via a one-off Supabase update so testing could
continue immediately, pending this fix's deploy.

### Scope still open (not built)

- A real `verify-email.html` page.
- A real rider-facing SMS verification screen (enter code, confirm).
- A single, consolidated, properly-authenticated admin rider-approval
  page — `admin-rider-approval.html` and `admin-verification.html` both
  need real auth wiring (matching whatever pattern `admin-dashboard.html`
  /`admin-login.html` already use) or should be consolidated into one
  working page rather than left as two broken duplicates.
- A rider-reject route (`PATCH /api/admin/riders/:id/reject`) doesn't
  exist at all, unlike the equivalent driver route — `riders.rejection_
  reason`/`rejected_at` columns already exist, so this is a small,
  symmetric addition whenever the admin page work happens.

### Launch impact

**High priority.** This blocks the core product — a real rider has never
had a working path to book a ride — independent of and more fundamental
than the payment-authorization work above. The approve-route fix here is
a small, low-risk, immediate partial mitigation; the self-service
verification UI and admin-panel consolidation are separate, larger pieces
of work that should be scoped and prioritized on their own.

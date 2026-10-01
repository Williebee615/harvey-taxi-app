# Unused card holds and payment records

## 1. Inspection (production, read-only, 2026-10-01)

| Check | Result |
|---|---|
| `audit_logs` rows for `ride_payment_intent_created` | **0**. No real PaymentIntent has been created through the app. |
| `payments` rows | **0** |
| `rides` | 5, all App Review rides; none has a `payment_id` |
| `rides.payment_id` | `FOREIGN KEY → payments(id) ON DELETE SET NULL` (`rides_payment_id_fkey`) |
| Triggers on `rides` | none |
| Code that inserts into `payments` | **none** |

**Finding 1: abandoned holds.** The database has no record of any abandoned authorization, because none has been created. The database also cannot show abandoned holds at all: before this change, nothing recorded a PaymentIntent until a ride was bound to it. **Stripe is the source of truth for holds that already exist.** I had no Stripe access, so the owner should check **Stripe Dashboard → Payments → filter "Uncaptured"** for holds older than a few hours with no matching ride.

**Finding 2: real card authorization cannot have succeeded (pre-existing).**
- `POST /api/rides/:id/authorize` writes `rides.payment_id = <PaymentIntent id>`. With no `payments` row, the foreign key rejects that write.
- Before #152, the route ignored the write error and dispatched anyway, using an in-memory ride object.
- #152 made the write conditional and checked, so the route now fails closed (HTTP 500, no dispatch) instead of dispatching a ride with no bound payment.
- **This PR creates the payment record, which makes real card authorization work.**
- It has not been exercised in production. Production shows no real PaymentIntents, so Stripe and/or `ENABLE_PAYMENT_GATE` may not be live; the owner should confirm this in Render.

## 2. What this PR changes

### Payment record (`payments`, id = PaymentIntent id)
- **At PaymentIntent creation** (`POST /api/rides/payment-intent`), the `created` record is written **before the client secret is returned**, for every intent, including sessionless ones (`rider_id = "unidentified"` when no rider is named).
  - This is a reliability rule and is **not** behind any flag.
  - **If the write fails:**
    - the new intent is cancelled at Stripe;
    - the client gets a 503 with `retry_with_new_key: true` and **no client secret**, so no card can be confirmed against it;
    - the dashboard then starts a fresh attempt.
  - **If the cancellation also fails:**
    - a **redacted operational alert** goes out (`🚨 PAYMENT_OPS_ALERT` in the server log, `payment_ops_alert_payment_intent_untracked` in `audit_logs`, and a best-effort email to the admin address);
    - reconciliation records the intent later from its Stripe metadata.
  - **A duplicate request** with the same idempotency key gets the same intent and record. A retry whose intent was already cancelled or released gets a 409 with `retry_with_new_key`, never a dead intent.
  - Until this change, the write happened in the background after the response. If it failed, a confirmed hold existed that only the rider's own release request could reach.
- **At authorization:**
  - the record is inserted, or conditionally updated, to `authorized` with `ride_id`;
  - this happens **before** the ride references it, so the foreign key is satisfied;
  - the record is refused if it is bound to another ride, or is being released or already released;
  - if the ride then fails its own conditional write (for example, it was cancelled mid-request), the record is handed back to `created`, so the hold can still be released.
- The client secret is never stored.

### Safe cancellation of unused holds

Decision rules are in `lib/unusedHolds.js`. Entry points:
- `POST /api/payments/holds/:paymentIntentId/release`, called by the rider dashboard when a rider leaves a booking after the card step;
- a sweep every 10 minutes for holds older than 2 hours.

Both entry points stay off until an admin sets the corresponding system flag to `"true"`.

A hold is cancelled only if **every** one of these holds:
1. It is a Harvey Taxi PaymentIntent (`metadata.app`) with manual capture.
2. Its Stripe status is uncaptured and cancellable: `requires_payment_method`, `requires_confirmation`, `requires_action` or `requires_capture`. It is never cancelled when `succeeded` or `processing`.
3. **It is not bound to any ride.** No `rides.payment_id` references it and its payment record has no `ride_id`. This applies whatever the ride's status, so the hold of an active or in-progress ride is never touched. The hold of a cancelled ride stays with the existing ride-cancellation void workflow.
4. Ownership:
   - **Rider route:** either the verified rider session is the intent's rider **and** the intent was created under a verified session (`metadata.rider_verified = "true"`, written only by the server), or the caller presents the intent's client secret (timing-safe comparison). Only the browser that created the hold has the secret.
     - A client-supplied `rider_id`, whether in this request or when the intent was created, never proves ownership.
     - Failures return "not found".
   - **Sweep:** the hold must be at least 2 hours old.
5. **Claim before cancelling.** A conditional update of the payment record to `release_pending` (only from `created` or `release_failed`, with no `ride_id`) succeeds, or a record is inserted when none exists. Binding to a ride needs the same row in `created` or `authorized`, so **exactly one of "bind to ride" and "release" can win**. The `rides` table is re-checked after the claim.
6. **Stripe is re-checked after the claim, immediately before cancelling.** If the intent has meanwhile been captured or changed, nothing is cancelled: the record goes to `review_required` and an alert is raised. If it is already cancelled, the record goes to `released`.
7. Stripe cancellation runs with an idempotency key (`harvey-hold-release-<id>`) and `cancellation_reason: "abandoned"`. A Stripe failure leaves the record `release_failed`, which can be retried; it is never left half done.

### Intent metadata
Every intent carries:
- `app: "harvey_taxi"` and `account: "harvey_taxi_service"`, which identify this application's own intents in a shared Stripe account;
- `metadata_version: "2"`;
- `ride_type`;
- `rider_id`, which is still used by authorization's ride-match check;
- `rider_verified`.

### Stripe-side reconciliation (`reconcileStripeHolds`)
Stripe, not the database, is the source of truth for which holds exist.
- **Schedule:** every 30 minutes, plus on demand through `POST /api/admin/payments/reconcile` (admin only; `dry_run` defaults to true).
- **Scope:** Harvey Taxi intents created between 8 days ago (card authorizations expire after about 7) and 2 hours ago. It pages through Stripe's list (100 per page, at most 20 pages per run) and raises an alert if it had to stop early.

| Situation | Action |
|---|---|
| Intent unknown to the database | **Recorded.** This is always on; it is tracking, not cleanup. |
| Bound to a ride, being released, or awaiting review | Kept |
| Two rides reference it; the record and the ride disagree; the record says authorized/released but Stripe still holds funds; **no account tag** (pre-change metadata); Stripe names a ride with no database binding; rider mismatch | **`review_required` plus one alert.** Never cancelled automatically. A person decides in Stripe. |
| Unused, unbound, past the window, ours | **Cancelled only when `unused_hold_sweep_enabled` is `"true"` (off by default).** Otherwise it is counted as `would_release`. |

**Protection when several server instances run at once:** cancellation goes through `releaseUnusedHold()`:
1. It claims the payment record with a conditional write. Ride attachment must claim that same row, so exactly one of them can win, on any number of instances.
2. It re-checks `rides`.
3. It re-checks Stripe immediately before cancelling.

A `review_required` hold can still be attached by a genuine booking; authorization runs its own ownership and amount checks.

The rider notice changes to "has been cancelled" **only after** the server confirms the cancellation. Otherwise it keeps saying the hold "has not been used or cancelled". It never promises when the bank will remove a pending amount.

## 3. Rollout
1. Merge after #152. This branch is stacked on it and touches the same route.
2. Confirm whether live Stripe and the payment gate are enabled in Render. If they are, this PR is required for real card bookings to complete.
3. Run a Stripe test-mode booking end to end on staging: authorize → ride `payment_authorized` → `payments` row `authorized`.
4. Turn on `unused_hold_release_enabled`, then test-mode: card step → Back → the hold shows as cancelled in the Stripe test dashboard.
5. After deploy, run `POST /api/admin/payments/reconcile` (a dry run) and review its summary and any `payment_ops_alert_*` audit rows.
6. Turn on `unused_hold_sweep_enabled` only after reviewing a day of release logs (`audit_logs.action = 'unused_card_hold_released'`) and reconciliation dry runs.

**Rollback:**
- Set either flag to `"false"`; it takes effect immediately.
- Reverting the code leaves `payments` rows in place. They are harmless, and `rides.payment_id` keeps its foreign key.

## 4. Not covered
- Updating `payments` on capture and on ride-cancellation voids. The ride columns remain the source of truth for those workflows.
- Holds created before this change carry no `account` tag. Reconciliation records them and flags them for review rather than cancelling them.
- Stripe's own expiry of uncaptured authorizations, and the issuer's timing for removing a pending amount, are outside the app's control and are not promised to riders.

## 5. Stripe test-mode validation (required before enabling)
`test/stripe-test-mode.integration.test.js` runs this PR against **real Stripe test mode**. It is skipped unless `STRIPE_TEST_SECRET_KEY` is a test key (`sk_test_` / `rk_test_`), and it refuses to run with any other key.

```
STRIPE_TEST_SECRET_KEY=sk_test_... npx jest test/stripe-test-mode --runInBand
```

| Scenario | What must hold |
|---|---|
| Successful authorization | The Stripe hold is `requires_capture`; a `payments` row is bound to the ride; the ride is authorized; **exactly one** driver offer; the Stripe metadata names the ride. |
| Declined card (`pm_card_chargeDeclined`) | 402. The ride stays `payment_required`, with no bound record and no offer. |
| Duplicate and concurrent authorizations | Only 200 or 409 responses; **one** offer; a later repeat returns `already_authorized`. |
| The same hold on a second ride | 409. The second ride is untouched. |
| Abandoned hold released by its owner | It is `canceled` at Stripe and the record is `released`; a second release gets 409. |
| A ride's payment | A release request gets 409, and the hold stays `requires_capture`. |
| Simultaneous release and attachment (5 runs) | **Exactly one wins.** Either the ride is authorized with a live hold and the release is refused, or the hold is cancelled and the ride is neither authorized nor dispatched. Never both. |

**Status: written, not yet run.** This build environment cannot reach `api.stripe.com` and has no Stripe test key. Run it on a machine with network access and a test key, supplied as an environment secret, never in chat or the repository. Paste the result into this PR before enabling `unused_hold_release_enabled`. Keep `unused_hold_sweep_enabled` off.

## 6. Isolated end-to-end environment (test keys, test database, test drivers)
`test/stripe-isolated.e2e.test.js` runs the unmodified server through the complete card flow. It never touches production and never dispatches to a real driver.

| Component | What it is |
|---|---|
| **Database** | A throwaway local Postgres (`harvey_isolated_*`, dropped afterwards) built from `test/isolated/production-schema.sql`. That file is a **schema-only** snapshot of production's tables, constraints (including `rides.payment_id → payments.id`), dispatch functions and triggers, taken from read-only catalog queries. No production rows are copied. |
| **REST layer** | PostgREST, the layer Supabase runs, behind `/rest/v1`, so `supabase-js` and the server are used exactly as in production. |
| **People** | Synthetic only: one rider and two test drivers with `@example.test` emails and fictional 555-01xx numbers. |
| **Stripe** | **Test mode** when `STRIPE_TEST_SECRET_KEY` is a `sk_test_`/`rk_test_` key; any other key is refused. Without a key, a stateful simulator runs (`test/isolated/stripeSimulator.js`). |

**Safety rails, enforced in code:**
- The database host must be `localhost`, `127.0.0.1` or `::1`. Supabase or any other remote host is refused.
- SMS, email, web push, identity, background-check, AI, routing and Redis credentials are removed before the server loads. The suite asserts that the integrations report them as off.

**Scenarios:**
- **untracked-hold fix:**
  - a payments-write failure never leaves a usable, untracked intent (**regression test** for the reproduced gap);
  - a write failure plus a cancellation failure gives no secret and a redacted alert, and reconciliation recovers the intent (simulated Stripe only);
  - app termination after the card hold: reconciliation cancels only with cleanup on;
  - missing or claimed rider identity: ownership is never proved by a client-supplied id;
  - duplicate requests on one idempotency key;
  - uncertain attachment or ownership is flagged for review and never cancelled;
  - pagination;
  - reconciliation on one instance against authorization on another, with authorization head starts of 0, 3, 6, 10 and 20 ms. Both outcomes occur, and exactly one wins every time.
- **full booking flow through the server's own routes:** estimate → payment-intent (the `created` record) → card confirmed → ride request → authorize (record bound, one offer) → test driver accepts → a release attempt is refused → the rider cancels, and the existing void workflow cancels the hold;
- **two server instances** sharing the database, racing one authorization (×3): exactly one dispatch and one payment record;
- isolation;
- the database enforces the foreign key;
- successful authorization, with the payment record created and bound and **exactly one** offer to a test driver;
- declined card;
- concurrent and repeated authorization (one offer, one payment record);
- the same hold on a second ride;
- abandoned-hold release, once;
- a ride's payment is never released;
- simultaneous release and attachment ×5 (exactly one wins).

**Run with Stripe test mode** on a machine with network access to `api.stripe.com`. Supply the key from a secret store; never type it into chat or commit it.
```
HARVEY_ISOLATED_E2E=1 \
HARVEY_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres \
POSTGREST_BIN=/path/to/postgrest \
STRIPE_TEST_SECRET_KEY=<test key> \
npx jest test/stripe-isolated --runInBand
```
- Requirements: Postgres with PostGIS, and PostgREST v12 (a single static binary from its GitHub releases).
- Report back only the `Tests:` summary line and the names of any failing tests.

**Status:**
- **Simulated Stripe:** 28/28 passed locally against the real database, on three consecutive runs. CI's `db-functions` job runs this mode on every push.
- **Stripe test mode:** not yet run. This build environment's network policy blocks `api.stripe.com`.

### Scope of each suite (what a pass does and does not prove)
| Suite | Stripe | Database | Proves | Does not prove |
|---|---|---|---|---|
| `test/stripe-test-mode.integration.test.js` | **Real test mode** | **Simulated** (in-memory) | The server handles real Stripe PaymentIntent states, declines, metadata and idempotent cancellation correctly | Real Postgres constraints or concurrency; the deployed booking flow |
| `test/stripe-isolated.e2e.test.js` with a test key | **Real test mode** | **Real local Postgres** with production's schema, via PostgREST | All of the above, plus the foreign key, conditional writes, the dispatch and accept functions, and races across two server instances on one database | The deployed system: Supabase itself, Render, the browser and Stripe.js, webhooks, capture at trip end, and real network latency |
| `test/stripe-isolated.e2e.test.js` without a key | Simulated | Real local Postgres | The database and dispatch side of the flow | Anything about real Stripe behaviour |

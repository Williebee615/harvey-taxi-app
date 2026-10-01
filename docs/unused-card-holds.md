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
- **At PaymentIntent creation** (`POST /api/rides/payment-intent`): a `created` record is written when a rider ID is known. This is best effort and never fails the request.
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
   - **Rider route:** either the verified rider session is the intent's rider, or the caller presents the intent's client secret (timing-safe comparison). Only the browser that created the hold has the secret. A `rider_id` in the request body is never accepted. Failures return "not found".
   - **Sweep:** the hold must be at least 2 hours old.
5. **Claim before cancelling.** A conditional update of the payment record to `release_pending` (only from `created` or `release_failed`, with no `ride_id`) succeeds, or a record is inserted when none exists. Binding to a ride needs the same row in `created` or `authorized`, so **exactly one of "bind to ride" and "release" can win**. The `rides` table is re-checked after the claim.
6. Stripe cancellation runs with an idempotency key (`harvey-hold-release-<id>`) and `cancellation_reason: "abandoned"`. A Stripe failure leaves the record `release_failed`, which can be retried; it is never left half done.

The rider notice changes to "has been cancelled" **only after** the server confirms the cancellation. Otherwise it keeps saying the hold "has not been used or cancelled". It never promises when the bank will remove a pending amount.

## 3. Rollout
1. Merge after #152. This branch is stacked on it and touches the same route.
2. Confirm whether live Stripe and the payment gate are enabled in Render. If they are, this PR is required for real card bookings to complete.
3. Run a Stripe test-mode booking end to end on staging: authorize → ride `payment_authorized` → `payments` row `authorized`.
4. Turn on `unused_hold_release_enabled`, then test-mode: card step → Back → the hold shows as cancelled in the Stripe test dashboard.
5. Turn on `unused_hold_sweep_enabled` only after reviewing a day of release logs (`audit_logs.action = 'unused_card_hold_released'`).

**Rollback:**
- Set either flag to `"false"`; it takes effect immediately.
- Reverting the code leaves `payments` rows in place. They are harmless, and `rides.payment_id` keeps its foreign key.

## 4. Not covered
- Updating `payments` on capture and on ride-cancellation voids. The ride columns remain the source of truth for those workflows.
- Holds created before this change have no payment record. Find them in the Stripe Dashboard; the sweep only sees recorded holds.
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
- **Simulated Stripe:** 14/14 passed locally against the real database, on three consecutive runs. CI's `db-functions` job now runs this mode on every push.
- **Stripe test mode:** not yet run. This build environment's network policy blocks `api.stripe.com`.

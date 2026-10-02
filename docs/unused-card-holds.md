# Unused card holds and payment records

## 1. Inspection (production, read-only, 2026-10-01)

| Check | Result |
|---|---|
| `audit_logs` rows for `ride_payment_intent_created` | **0**. This does **not** show that no PaymentIntent exists. That audit write is best effort, and before this PR the `payments` record was too (and was skipped without a rider ID). |
| `payments` rows | **0** |
| `rides` | 5, all App Review rides; none has a `payment_id` |
| `rides.payment_id` | `FOREIGN KEY → payments(id) ON DELETE SET NULL` (`rides_payment_id_fkey`) |
| Triggers on `rides` | none |
| Code that inserts into `payments` | **none** |

**Finding 1: abandoned holds.** The database cannot show abandoned holds: before this change, nothing recorded a PaymentIntent until a ride was bound to it. **Stripe is the source of truth for holds that already exist.** I had no Stripe access, so the owner should check **Stripe Dashboard → Payments → filter "Uncaptured"** for holds older than a few hours with no matching ride.

**Finding 2: real card authorization cannot have succeeded (pre-existing).**
- `POST /api/rides/:id/authorize` writes `rides.payment_id = <PaymentIntent id>`. With no `payments` row, the foreign key rejects that write.
- Before #152, the route ignored the write error and dispatched anyway, using an in-memory ride object.
- #152 made the write conditional and checked, so the route now fails closed (HTTP 500, no dispatch) instead of dispatching a ride with no bound payment.
- **This PR creates the payment record, which makes real card authorization work.**
- It has not been exercised in production.
- **Whether production has PaymentIntents is unknown.** Empty `payments` and audit tables don't establish it: the tracking gap fixed in this PR means intents could exist with no row. Stripe is the only reliable source. Check the Stripe Dashboard (Payments, filtered to "Uncaptured") or, after deploy, the admin reconciliation dry run.

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

### The `"unidentified"` placeholder
**Production schema, verified read-only:** `payments.rider_id` is `text NOT NULL` with no foreign key, check constraint or trigger, so the placeholder is valid. RLS is enabled, and the server uses the service role.

It cannot grant ownership or link riders:
- **Every `payments` query is keyed by PaymentIntent `id`.** None filters, groups or lists by `rider_id`.
- **Ownership never reads `payments.rider_id`.** Session ownership needs the intent's server-written `rider_verified = "true"`. The placeholder is never written to Stripe as a rider (a client sending it is treated as no rider), and a session claiming it is refused.
- **Real rider ids are server-generated** (`RIDER-` plus 10 hex characters). Production has no rider with the id `unidentified`.
- **Tests:** two sessionless riders' holds can't release each other's; each can release its own.

### Intent metadata
Every intent carries:
- `app: "harvey_taxi"` and `account: "harvey_taxi_service"`, which identify this application's own intents in a shared Stripe account;
- `metadata_version: "2"`;
- `ride_type`;
- `rider_id`, which is still used by authorization's ride-match check;
- `rider_verified`.

### Stripe-side reconciliation (`reconcileStripeHolds`)
Stripe, not the database, is the source of truth for which holds exist.
- **Two flags, both off by default:**

  | Flag | Controls |
  |---|---|
  | `stripe_reconciliation_enabled` | Whether **scheduled** reconciliation runs at all (every 30 minutes). Off means it does nothing. |
  | `unused_hold_sweep_enabled` (existing) | Whether reconciliation and the database sweep may **cancel** holds |

- **Admin dry run:** `POST /api/admin/payments/reconcile/dry-run` (admin only) is **read-only, whatever the flags say**:
  - it writes no records, flags nothing, cancels nothing and sends no alerts or notifications;
  - it reports findings: intent id, Stripe status, amount, age, whether it is tracked, record status, whether it is bound to a ride, and the action and reason live mode would take. There is no client secret, card or contact detail, and no rider id.
  - A test checks the database, the audit trail, Stripe statuses and alerts before and after a dry run, with both flags on.
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

## 3. Staged release (live payments stay off until this PR is deployed and verified)

### Production state, checked 2026-10-02
Source: the admin dashboard's Payment Configuration card (#160 and #161), read on harveytaxiservice.com.
- `secret_key_mode` and `publishable_key_mode` are both `unrecognized`. Neither value in Render is a Stripe key.
- `stripe_account`: Stripe rejects the key with `StripeAuthenticationError`, so the connected account **is not verified**.
- `webhook_secret_set` is `false`.
- `payment_gate_enabled` is `true`, but `card_payments_effective` and `live_card_payments_effective` are `false`.

**Card payments are currently ineffective in production:** every card authorization fails at Stripe. Reviewer simulation (App Review) does not call Stripe and is unaffected.

The production-configuration gate therefore **failed**. Stages 0 to 2 keep it that way on purpose until this PR is live.

### Stage 0: hold (now)
- **Do not** put live Stripe keys into Render yet. Leave the current values, which keep cards ineffective.
- **Keep `ENABLE_PAYMENT_GATE` on.** Turning it off would let rides dispatch without payment.
- These flags stay off or absent:
  - `stripe_reconciliation_enabled`
  - `unused_hold_sweep_enabled`
  - `unused_hold_release_enabled`
  - every `agent_*` flag

### Stage 1: validate the merge candidate
1. Candidate = this branch merged with current `main`, which includes #160 and #161. Run on that **exact SHA**:
   - the full `npx jest` suite;
   - the database suites;
   - the isolated suite;
   - CI (Node 20 and 22, `db-functions`, `mobile`).
2. Run the real Stripe test-mode suites A and B (§5 and §6) on the same SHA, using a **test secret key** (`sk_test_…`). A key ID (`mk_…`) is not a secret key. Before anything runs, both suites ask Stripe to confirm test mode (`livemode: false`) and refuse to run otherwise.
3. Record the validated SHA, the counts for A and B, and confirmation that every test hold ended `canceled`. If the code changes after this, repeat Stage 1.

**Stage 1 result (2026-10-02): complete.** Validated SHA **`a9cab989a20e25c489587b11734d417a6cfb8b77`**: `40507ab` plus a test-only change to `test/stripe-isolated.e2e.test.js` (a `return_url` on test-side confirms, and a per-run idempotency key; no application code).

| Check | Result |
|---|---|
| Real Stripe suite A (`test/stripe-test-mode`) | 12 passed, 0 failed, 0 skipped |
| Real Stripe suite B (`test/stripe-isolated`, `Stripe: stripe_test_mode`) | 30 passed, 0 failed, 1 skipped (`SIM_ONLY`: write failure and cancel failure, which needs injected Stripe faults; it passes under the simulator) |
| Race outcomes | Release vs. attachment, 5 runs in each suite: the release won every run. Reconciliation vs. authorization (0/3/6/10/20 ms): authorization won every run. Never both. |
| Dry-run reconciliation | Changed nothing (test passed) |
| Test mode | `livemode: false` confirmed before each run; every PaymentIntent created was test mode |
| Cleanup | 124 test PaymentIntents created across all runs, 124 `canceled`, none captured, no refunds |
| Full `npx jest` / DB suites / isolated (simulator) / CI | 1,295 passed (122 opt-in skips) / 83 of 83 / 31 of 31 / all green |

### Stage 2: deploy this PR with cards still off

**Stage 2 status: GitHub complete; production verification pending.** Stage 2 stays in this state until the Render and device checks below pass.

| Check | Status |
|---|---|
| Merge with "Create a merge commit", pinned to `a9cab98` | **Done**: merge commit `5be6d7e` (2026-10-02 17:59:37Z). The tree of `main` is identical to the validated tree. |
| CI on `main` at `5be6d7e` | **Passed** |
| #152 shows as merged | **Done**: marked merged by GitHub (head `fa9f47a`) |
| Live keys, payment gate, automation flags | **Not changed** by this stage. The gate stays on; the flags stay off. |
| Render shows `5be6d7e` live; logs show no new errors | Pending (owner) |
| `/api/health` (as admin) reports Stripe as before | Pending (owner) |
| Payment Configuration card unchanged (cards still off) | Pending (owner) |
| App Review sign-in and simulated payment | Pending (owner) |
| Every flag listed in Stage 0 still off or absent | Pending (owner) |
| `POST /api/admin/payments/reconcile/dry-run` returns without error (item 3) | Pending (owner) |
| Device checks from #152: iOS app swipe-back from booking and tracking returns to the dashboard; Android hardware Back (needs the #154 build); Safari and Chrome launch, sign-in, refresh, booking open and close, notification tap | Pending (owner) |

1. Merge with **"Create a merge commit"**, pinned to the validated SHA. Render Auto-Deploy deploys it.
2. Verify that:
   - Render shows the merge commit as live, and its logs show no new errors;
   - `/api/health` (as admin) reports Stripe as before;
   - the Payment Configuration card is unchanged (cards still off);
   - App Review sign-in and the simulated payment still work;
   - every flag above is still off;
   - #152 shows as merged. Close it manually if it doesn't.
3. `POST /api/admin/payments/reconcile/dry-run` returns without error. It is read-only, and it reports a Stripe error while the keys are invalid.

### Stage 3: configure Harvey Taxi2's live keys and webhook (separate approval)
In Render, set each value exactly as Stripe shows it: no quotes, no `Bearer`, no variable name.

| Render variable | Value |
|---|---|
| `STRIPE_SECRET_KEY` | Harvey Taxi2's live **secret** key (`sk_live_…`) or a restricted key (`rk_live_…`). Not the key ID (`mk_…`). |
| `STRIPE_PUBLISHABLE_KEY` | Harvey Taxi2's `pk_live_…` |
| `STRIPE_WEBHOOK_SECRET` | The signing secret (`whsec_…`) of a **live** webhook endpoint you create in Stripe. Point it at `https://harveytaxiservice.com/api/stripe/webhook` with these events: `payment_intent.succeeded`, `payment_intent.amount_capturable_updated`, `payment_intent.payment_failed`, `payment_intent.canceled`. |

After saving, Render restarts the service. Reload the Payment Configuration card. All of these must hold:
- `secret_key_mode` and `publishable_key_mode` are `live`, and `key_modes_match` is `true`;
- `webhook_secret_set` is `true`;
- `payment_gate_enabled`, `card_payments_effective` and `live_card_payments_effective` are `true`;
- `problems` is `[]`;
- `stripe_account.id` is **`acct_1TG2yqK0dBlmhLqa`** (Harvey Taxi2), and `charges_enabled` is `true`.

In the Stripe Dashboard, send a test event to the endpoint and confirm it is delivered with a `2xx` response.

**Rollback for Stage 3:** restore the previous values, or clear `STRIPE_SECRET_KEY`. Cards become ineffective again and the payment gate stays on.

### Stage 4: one supervised live check (separate approval)
1. The owner makes one small real booking with their own card, then backs out at the card step or cancels.
2. Confirm that:
   - a `payments` row exists with the PaymentIntent id and `metadata.app = harvey_taxi`;
   - the dry run lists it correctly;
   - the hold is cancelled in the Stripe Dashboard. Cancel it manually there; release automation stays off.

### Later, each with separate approval
1. `unused_hold_release_enabled`, after a test-mode card step, then Back, shows the hold cancelled.
2. `stripe_reconciliation_enabled`, after reviewing dry-run findings.
3. `unused_hold_sweep_enabled`, after a day of release logs (`audit_logs.action = 'unused_card_hold_released'`) and dry runs.

**Flag rollback:** set the flag to `"false"`; it takes effect immediately. Reverting the code leaves `payments` rows in place. They are harmless, and `rides.payment_id` keeps its foreign key.

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

**Status: passed against real Stripe test mode on 2026-10-02** (validated SHA `a9cab98`; see the Stage 1 result in §3). Re-run it on a machine with network access and a test key, supplied as an environment secret, never in chat or the repository, whenever this code changes. Keep `unused_hold_sweep_enabled` off until its own approval.

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
- **Simulated Stripe:** 31/31 passed locally against the real database, on three consecutive runs. CI's `db-functions` job runs this mode on every push.
- **Stripe test mode:** not yet run. This build environment's network policy blocks `api.stripe.com`.

### Scope of each suite (what a pass does and does not prove)
| Suite | Stripe | Database | Proves | Does not prove |
|---|---|---|---|---|
| `test/stripe-test-mode.integration.test.js` | **Real test mode** | **Simulated** (in-memory) | The server handles real Stripe PaymentIntent states, declines, metadata and idempotent cancellation correctly | Real Postgres constraints or concurrency; the deployed booking flow |
| `test/stripe-isolated.e2e.test.js` with a test key | **Real test mode** | **Real local Postgres** with production's schema, via PostgREST | All of the above, plus the foreign key, conditional writes, the dispatch and accept functions, and races across two server instances on one database | The deployed system: Supabase itself, Render, the browser and Stripe.js, webhooks, capture at trip end, and real network latency |
| `test/stripe-isolated.e2e.test.js` without a key | Simulated | Real local Postgres | The database and dispatch side of the flow | Anything about real Stripe behaviour |

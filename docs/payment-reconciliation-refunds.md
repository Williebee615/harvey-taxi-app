# Payment reconciliation and refunds

**Status:** for owner review, prepared 2026-10-15.
- The code is off by default and the migration is not applied.
- **No live refunds have been issued, and the code refuses them** (owner instruction 2026-10-14).

## 1. Read-only discrepancy report (2026-10-15)

**Sources:**
- Stripe: every PaymentIntent and refund in the account the production server uses. Test mode (`pk_test_` / `sk_test_`), read through the session's Stripe test connection.
- Production database (read-only SQL): `payments` (0 rows) and `rides` with a `payment_id` (0 rows). `payment_refunds` is not migrated.

| Measure | Result |
|---|---|
| Stripe PaymentIntents read | 170 (all created October 2026) |
| Harvey Taxi intents (`metadata.app = harvey_taxi`), not synthetic | 163, **all `canceled`** |
| Synthetic test intents (`metadata.synthetic = "true"`) | 7: 4 from today's refund tests, 3 from earlier hold-release tests |
| Other applications' intents | 0 |
| Any live-mode object | **None** |
| Stripe refunds | 6, **all on today's synthetic test intents** |
| Database `payments` rows / rides with a payment | 0 / 0 |
| **Discrepancies** | **0** |

**[Verified 2026-10-15] Reading:**
- Every non-synthetic Harvey Taxi intent was cancelled without capture, so no customer money is held or taken.
- The 166 cancelled intents reported on 2026-10-14 plus today's 4 synthetic captures make 170.
- No refunds exist outside the synthetic tests.

**Observations (not discrepancies):**
- **No payment records at all.** The server creates a `payments` row only when it tracks a hold. Production has never bound a payment to a ride. So reconciliation currently has nothing on the database side to compare. That changes once real (test-mode) rides are paid.
- **The webhook can't keep records in step:** `STRIPE_WEBHOOK_SECRET` is not set, so the webhook returns 503, and no endpoints are registered (2026-10-14). Until it is configured, reconciliation is the only check.
- **`payments.client_secret`:** a column exists in production but the server never writes it (it only returns the secret to the paying browser). It has 0 rows. **[Recommendation]** Drop the column in a later migration so a secret can never be stored there.

## 2. What this PR adds

| Piece | Behavior |
|---|---|
| `lib/paymentReconciliation.js` | Pure comparison; writes nothing. 10 fixed discrepancy codes: untracked intent, payment not in Stripe, status/amount mismatch, captured without ride, ride intent missing, ride capture mismatch, untracked refund, ledger mismatch, mode mismatch. Other apps' and synthetic intents are counted, never reported. |
| `POST /api/admin/payments/reconcile/report` | Owner or finance role. Reads 90 days of Stripe intents and refunds plus `payments`, `rides` and the refund ledger. Returns codes, ids, statuses and cents only (no client secret, card or contact detail). Writes one audit row (count only). |
| `supabase/migrations/20261015010000_payment_refunds.sql` (**not applied**) | `payment_refunds` ledger and two functions. Server-only. Append-only, with forward-only status. |
| `lib/refunds.js` | Refund flow. **Refuses any live-mode key or live-mode PaymentIntent** before touching the ledger. |
| `POST /api/admin/payments/:id/refunds` | Off unless `refunds_enabled = "true"`. **Owner account only.** One person-initiated refund per request, audited with ids, amount, reason code and outcome. |

### How refunds stay correct
- **Retries:**
  - Each request carries an idempotency key, and a repeat returns the original ledger row.
  - The Stripe call uses a key derived from the ledger row, so a retry after a lost response gets the **same** Stripe refund back.
  - An ambiguous failure (network, timeout, Stripe 5xx, 409, 429) leaves the row `pending` for a retry. Only a definite refusal marks it `failed`, which frees the amount.
- **Partial refunds:** several refunds per payment, never more than the captured amount. Stripe's own refunded total (e.g. a dashboard refund) also counts.
- **Concurrent requests:**
  - A per-payment database lock serializes reservations, so concurrent partial refunds can't together exceed the captured amount.
  - Concurrent retries of one request create one row.
- **Live mode:** refused in code whatever the flag says. Enabling live refunds needs your decision and a code change.

## 3. Tests

| Suite | What it proves | Result |
|---|---|---|
| `test/db/paymentRefunds.db.test.js` (real Postgres) | Retry returns the original row. Key reuse with a different amount is refused. Partial refunds stop at the captured amount. A failed refund frees its amount. Stripe's refunded total counts. **6 concurrent requests against 1,000¢ — exactly 2 of 400¢ succeed.** 4 concurrent retries make 1 row. Forward-only status. Server-only. | 8/8 |
| `test/db/refunds.stripeTestMode.db.test.js` (**Stripe test mode** + real Postgres; opt-in, not run in CI) | Partial refunds of 1,000 + 1,500 on a 2,500 capture, then a 1¢ request is refused. A lost Stripe response on retry gives **1** Stripe refund. **5 concurrent 400¢ requests on 1,000¢ — 2 refunds, 800¢ at Stripe.** 3 concurrent duplicates give 1 Stripe refund. | 4/4, run 2026-10-15 |
| `lib/refunds.test.js` | Live key or live intent refused before any Stripe or ledger call. Other apps' and uncaptured payments refused. Ambiguous vs definite failures. Status mapping. | 10/10 |
| `lib/paymentReconciliation.test.js` | Each discrepancy code. Window handling. Synthetic and other-app exclusion. No secrets or emails in output. | 8/8 |
| `test/server.payment-refunds.test.js` | Refunds off by default; owner only; live intent refused; bad input; 503 retryable. Report needs the finance permission, writes nothing and calls no Stripe write. | 8/8 |

Test-mode objects created: 4 synthetic PaymentIntents (Stripe test card `pm_card_visa`; $25, $12, $10 and $9 test amounts), all tagged `synthetic = "true"` and `test_run = "refund-tests"`, plus 6 test refunds. No live object was created.

## 4. Decisions for you
1. **Merge** this PR. Everything stays off.
2. **Apply** migration `20261015010000`.
3. Configure the Stripe webhook (`STRIPE_WEBHOOK_SECRET` plus an endpoint). This is separate and already pending.
4. **Live refunds:** not built to run. A future decision, after the refund policy and finance roles are settled.

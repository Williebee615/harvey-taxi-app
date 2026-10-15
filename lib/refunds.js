// Refunds for captured ride payments, through the payment_refunds ledger
// (supabase/migrations/20261015010000_payment_refunds.sql).
//
// Owner instruction (2026-10-14): test refunds in Stripe test mode,
// including retries, partial refunds and concurrent requests; no live
// refunds. So this module refuses any live-mode key or live-mode
// PaymentIntent outright. Enabling live refunds is a separate, explicit
// owner decision and a code change, not a flag.
//
// Flow, safe to retry at any step with the same idempotency key:
//   1. Read the PaymentIntent from Stripe (amount received, amount refunded).
//   2. Reserve the refund in the ledger. The database serializes requests
//      per intent and refuses anything over the refundable amount.
//   3. Ask Stripe for the refund, with a Stripe idempotency key derived from
//      the ledger row, so a retry after a crash or timeout returns the same
//      Stripe refund instead of creating a second one.
//   4. Record Stripe's answer. An ambiguous failure (network, timeout,
//      Stripe 5xx) leaves the row pending for a retry; only a definite
//      refusal marks it failed.

const { STRIPE_APP_TAG } = require("./unusedHolds");
const { keyMode } = require("./paymentConfig");

const REFUND_REASON_CODES = Object.freeze(["ride_cancelled_after_capture", "fare_adjustment", "duplicate_charge", "service_issue", "other"]);

const REFUND_ERROR = Object.freeze({
  LIVE_MODE_REFUSED: "live_refunds_not_approved",
  STRIPE_NOT_CONFIGURED: "stripe_not_configured",
  INVALID_REQUEST: "invalid_request",
  INTENT_NOT_FOUND: "payment_intent_not_found",
  NOT_HARVEY_INTENT: "not_a_harvey_taxi_payment",
  NOT_CAPTURED: "payment_not_captured",
  EXCEEDS_REFUNDABLE: "exceeds_refundable",
  IDEMPOTENCY_MISMATCH: "idempotency_key_reused",
  LEDGER_UNAVAILABLE: "ledger_unavailable"
});

const stripeIdempotencyKey = (ledgerId) => `harvey-refund:${ledgerId}`;

// Stripe refund status -> ledger status.
function ledgerStatusFor(stripeStatus) {
  if (stripeStatus === "succeeded") return "succeeded";
  if (stripeStatus === "failed" || stripeStatus === "canceled") return "failed";
  return "submitted"; // pending, requires_action
}

// A definite refusal from Stripe (bad request, card or amount problem) vs
// an outcome we can't know (network, timeout, rate limit, Stripe 5xx).
function isDefiniteStripeRefusal(err) {
  const type = err && (err.type || err.rawType);
  if (type === "StripeInvalidRequestError" || type === "invalid_request_error" || type === "StripeCardError" || type === "card_error") return true;
  const status = Number(err && err.statusCode);
  return status >= 400 && status < 500 && status !== 409 && status !== 429;
}

function validate({ paymentIntentId, amountCents, reasonCode, idempotencyKey, requestedBy }) {
  if (!/^pi_[A-Za-z0-9]+$/.test(String(paymentIntentId || ""))) return "payment_intent_id";
  if (!Number.isInteger(amountCents) || amountCents <= 0) return "amount_cents";
  if (!REFUND_REASON_CODES.includes(reasonCode)) return "reason_code";
  if (typeof idempotencyKey !== "string" || idempotencyKey.length < 8 || idempotencyKey.length > 200) return "idempotency_key";
  if (!requestedBy) return "requested_by";
  return null;
}

async function requestRefund({ stripe, secretKey, rpc, paymentIntentId, amountCents, reasonCode, idempotencyKey, requestedBy }) {
  if (!stripe) return { ok: false, error: REFUND_ERROR.STRIPE_NOT_CONFIGURED };
  // Test mode only. Checked before anything touches Stripe or the ledger.
  if (keyMode(secretKey, "secret") !== "test") return { ok: false, error: REFUND_ERROR.LIVE_MODE_REFUSED };
  const invalid = validate({ paymentIntentId, amountCents, reasonCode, idempotencyKey, requestedBy });
  if (invalid) return { ok: false, error: REFUND_ERROR.INVALID_REQUEST, field: invalid };

  let intent;
  try {
    intent = await stripe.paymentIntents.retrieve(paymentIntentId, { expand: ["latest_charge"] });
  } catch (err) {
    if (err && (err.code === "resource_missing" || Number(err.statusCode) === 404)) return { ok: false, error: REFUND_ERROR.INTENT_NOT_FOUND };
    return { ok: false, error: "stripe_unavailable", retryable: true };
  }
  if (intent.livemode) return { ok: false, error: REFUND_ERROR.LIVE_MODE_REFUSED };
  if (!intent.metadata || intent.metadata.app !== STRIPE_APP_TAG) return { ok: false, error: REFUND_ERROR.NOT_HARVEY_INTENT };
  if (intent.status !== "succeeded" || !(intent.amount_received > 0)) return { ok: false, error: REFUND_ERROR.NOT_CAPTURED };

  // Stripe's refunded total for this intent, from its latest charge.
  const charge = intent.latest_charge && typeof intent.latest_charge === "object" ? intent.latest_charge : null;
  let refundedCents = charge ? Number(charge.amount_refunded || 0) : null;
  if (refundedCents === null) {
    try {
      const list = await stripe.refunds.list({ payment_intent: paymentIntentId, limit: 100 });
      refundedCents = (list.data || []).filter((r) => r.status !== "failed" && r.status !== "canceled").reduce((n, r) => n + Number(r.amount || 0), 0);
    } catch {
      return { ok: false, error: "stripe_unavailable", retryable: true };
    }
  }

  let reservation;
  try {
    reservation = await rpc("reserve_payment_refund", {
      p_payment_intent_id: paymentIntentId,
      p_amount_cents: amountCents,
      p_currency: intent.currency,
      p_reason_code: reasonCode,
      p_idempotency_key: idempotencyKey,
      p_requested_by: requestedBy,
      p_captured_cents: intent.amount_received,
      p_stripe_refunded_cents: refundedCents
    });
  } catch {
    return { ok: false, error: REFUND_ERROR.LEDGER_UNAVAILABLE, retryable: true };
  }
  if (reservation.outcome === "idempotency_mismatch") return { ok: false, error: REFUND_ERROR.IDEMPOTENCY_MISMATCH };
  if (reservation.outcome === "exceeds_refundable") {
    return { ok: false, error: REFUND_ERROR.EXCEEDS_REFUNDABLE, captured_cents: reservation.captured_cents, already_refunded_cents: reservation.already_refunded_cents };
  }

  let row = reservation.refund;
  const replayed = reservation.outcome === "replayed";
  // A final row is the answer; a retry never calls Stripe again for it.
  if (row.status === "succeeded" || row.status === "failed") return { ok: row.status === "succeeded", replayed, refund: row };

  let stripeRefund;
  try {
    // Already accepted by Stripe and still processing: read its current
    // status rather than replaying the original (stale) create response.
    stripeRefund = row.status === "submitted" && row.stripe_refund_id
      ? await stripe.refunds.retrieve(row.stripe_refund_id)
      : await stripe.refunds.create(
      { payment_intent: paymentIntentId, amount: amountCents, metadata: { app: STRIPE_APP_TAG, refund_ledger_id: row.id, reason_code: reasonCode } },
      { idempotencyKey: stripeIdempotencyKey(row.id) }
    );
  } catch (err) {
    if (!isDefiniteStripeRefusal(err)) {
      // Unknown outcome: keep it pending; the same request resumes it.
      return { ok: false, error: "stripe_outcome_unknown", retryable: true, refund: row };
    }
    try {
      row = await rpc("record_payment_refund_result", { p_id: row.id, p_status: "failed", p_stripe_refund_id: null, p_error_code: String(err.code || "stripe_refused").slice(0, 60) });
    } catch {
      return { ok: false, error: REFUND_ERROR.LEDGER_UNAVAILABLE, retryable: true };
    }
    return { ok: false, error: "stripe_refused", refund: row };
  }

  try {
    row = await rpc("record_payment_refund_result", { p_id: row.id, p_status: ledgerStatusFor(stripeRefund.status), p_stripe_refund_id: stripeRefund.id, p_error_code: null });
  } catch {
    // Stripe has the refund; the ledger will catch up on the retry, which
    // gets the same Stripe refund back through the idempotency key.
    return { ok: false, error: REFUND_ERROR.LEDGER_UNAVAILABLE, retryable: true };
  }
  return { ok: row.status !== "failed", replayed, refund: row };
}

module.exports = { REFUND_REASON_CODES, REFUND_ERROR, requestRefund, ledgerStatusFor, isDefiniteStripeRefusal, stripeIdempotencyKey };

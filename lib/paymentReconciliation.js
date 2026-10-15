// Read-only payment reconciliation: compares what Stripe holds with what
// our database records, and returns a discrepancy report. It never writes
// to Stripe or the database; callers pass in data they have already read.
//
// The report carries identifiers, statuses, amounts in cents and fixed
// discrepancy codes only: no client secret, card detail, rider contact or
// free text.

const { STRIPE_APP_TAG } = require("./unusedHolds");

const DISCREPANCY = Object.freeze({
  // A Harvey Taxi PaymentIntent with no payments row.
  INTENT_UNTRACKED: "intent_untracked",
  // A payments row whose PaymentIntent isn't in the Stripe data read.
  PAYMENT_NOT_IN_STRIPE: "payment_not_in_stripe",
  // payments.stripe_latest_status differs from Stripe's status.
  STATUS_MISMATCH: "status_mismatch",
  // payments.amount (dollars) differs from the intent amount (cents).
  AMOUNT_MISMATCH: "amount_mismatch",
  // Money was captured but no ride points at the intent.
  CAPTURED_WITHOUT_RIDE: "captured_without_ride",
  // A ride points at a PaymentIntent that isn't in the Stripe data read.
  RIDE_INTENT_MISSING: "ride_intent_missing",
  // rides.payment_status says captured but Stripe doesn't, or the reverse.
  RIDE_CAPTURE_MISMATCH: "ride_capture_mismatch",
  // A Stripe refund on a Harvey Taxi intent with no ledger row.
  REFUND_UNTRACKED: "refund_untracked",
  // A ledger refund whose Stripe refund is missing or differs.
  REFUND_LEDGER_MISMATCH: "refund_ledger_mismatch",
  // An object's livemode differs from the mode being reconciled.
  MODE_MISMATCH: "mode_mismatch"
});

const isHarvey = (intent) => Boolean(intent && intent.metadata && intent.metadata.app === STRIPE_APP_TAG);
const dollarsToCents = (v) => (v === null || v === undefined || v === "" ? null : Math.round(Number(v) * 100));

function reconcilePayments({ intents = [], refunds = [], payments = [], rides = [], ledger = [], expectLivemode = false, window = null } = {}) {
  const findings = [];
  const add = (code, fields) => findings.push({ code, ...fields });

  // Synthetic test intents (metadata synthetic = "true", e.g. the refund
  // tests) are counted but never reported as discrepancies.
  const isSynthetic = (i) => Boolean(i && i.metadata && i.metadata.synthetic === "true");
  const syntheticIds = new Set(intents.filter(isSynthetic).map((i) => i.id));
  const harveyIntents = intents.filter((i) => isHarvey(i) && !isSynthetic(i));
  const intentById = new Map(harveyIntents.map((i) => [i.id, i]));
  const allIntentIds = new Set(intents.map((i) => i.id));
  const paymentById = new Map(payments.map((p) => [p.id, p]));
  const ridesByIntent = new Map();
  for (const r of rides) {
    if (!r.payment_id) continue;
    if (!ridesByIntent.has(r.payment_id)) ridesByIntent.set(r.payment_id, []);
    ridesByIntent.get(r.payment_id).push(r);
  }

  for (const intent of harveyIntents) {
    if (Boolean(intent.livemode) !== Boolean(expectLivemode)) add(DISCREPANCY.MODE_MISMATCH, { payment_intent_id: intent.id, livemode: Boolean(intent.livemode) });
    const record = paymentById.get(intent.id);
    const boundRides = ridesByIntent.get(intent.id) || [];
    if (!record) {
      // An intent that never got past card entry and was cancelled or
      // abandoned isn't money: only report untracked intents that hold or
      // took funds.
      if (["requires_capture", "succeeded", "processing"].includes(intent.status)) {
        add(DISCREPANCY.INTENT_UNTRACKED, { payment_intent_id: intent.id, stripe_status: intent.status, amount_cents: intent.amount });
      }
    } else {
      if (record.stripe_latest_status && record.stripe_latest_status !== intent.status) {
        add(DISCREPANCY.STATUS_MISMATCH, { payment_intent_id: intent.id, stripe_status: intent.status, record_status: record.stripe_latest_status });
      }
      const recordCents = dollarsToCents(record.amount);
      if (recordCents !== null && recordCents !== intent.amount) {
        add(DISCREPANCY.AMOUNT_MISMATCH, { payment_intent_id: intent.id, stripe_amount_cents: intent.amount, record_amount_cents: recordCents });
      }
    }
    if (intent.status === "succeeded" && boundRides.length === 0 && !(record && record.ride_id)) {
      add(DISCREPANCY.CAPTURED_WITHOUT_RIDE, { payment_intent_id: intent.id, amount_received_cents: intent.amount_received ?? intent.amount });
    }
    for (const ride of boundRides) {
      const rideSaysCaptured = ride.payment_status === "captured";
      const stripeSaysCaptured = intent.status === "succeeded";
      if (rideSaysCaptured !== stripeSaysCaptured) {
        add(DISCREPANCY.RIDE_CAPTURE_MISMATCH, { payment_intent_id: intent.id, ride_id: ride.id, ride_payment_status: ride.payment_status || null, stripe_status: intent.status });
      }
    }
  }

  // Database rows without a matching intent. When the Stripe read covered
  // only a time window, rows created outside it can't be judged.
  const inWindow = (createdAt) => {
    if (!window || !createdAt) return true;
    const t = Date.parse(createdAt) / 1000;
    return t >= window.gte && t <= window.lte;
  };
  for (const p of payments) {
    if (p.provider && p.provider !== "stripe") continue;
    if (!allIntentIds.has(p.id) && inWindow(p.created_at)) add(DISCREPANCY.PAYMENT_NOT_IN_STRIPE, { payment_intent_id: p.id, record_status: p.status });
  }
  for (const [intentId, list] of ridesByIntent) {
    if (!allIntentIds.has(intentId)) {
      for (const ride of list) if (inWindow(ride.created_at)) add(DISCREPANCY.RIDE_INTENT_MISSING, { payment_intent_id: intentId, ride_id: ride.id });
    }
  }

  // Refunds.
  const ledgerByStripeId = new Map(ledger.filter((l) => l.stripe_refund_id).map((l) => [l.stripe_refund_id, l]));
  const stripeRefundById = new Map(refunds.map((r) => [r.id, r]));
  for (const refund of refunds) {
    const intentId = typeof refund.payment_intent === "string" ? refund.payment_intent : refund.payment_intent && refund.payment_intent.id;
    if (!intentById.has(intentId)) continue; // other apps' and synthetic intents
    if (!ledgerByStripeId.has(refund.id)) add(DISCREPANCY.REFUND_UNTRACKED, { payment_intent_id: intentId, stripe_refund_id: refund.id, amount_cents: refund.amount, stripe_status: refund.status });
  }
  for (const row of ledger) {
    if (!row.stripe_refund_id || syntheticIds.has(row.payment_intent_id)) continue;
    const refund = stripeRefundById.get(row.stripe_refund_id);
    if (!refund || refund.amount !== row.amount_cents) {
      add(DISCREPANCY.REFUND_LEDGER_MISMATCH, { payment_intent_id: row.payment_intent_id, stripe_refund_id: row.stripe_refund_id, ledger_amount_cents: row.amount_cents, stripe_amount_cents: refund ? refund.amount : null });
    }
  }

  const counts = {};
  for (const f of findings) counts[f.code] = (counts[f.code] || 0) + 1;
  const statusCounts = {};
  for (const i of harveyIntents) statusCounts[i.status] = (statusCounts[i.status] || 0) + 1;

  return {
    summary: {
      stripe_intents_read: intents.length,
      harvey_intents: harveyIntents.length,
      synthetic_intents: syntheticIds.size,
      other_app_intents: intents.filter((i) => !isHarvey(i) && !isSynthetic(i)).length,
      harvey_intent_statuses: statusCounts,
      stripe_refunds_read: refunds.length,
      payments_rows: payments.length,
      rides_with_payment: [...ridesByIntent.values()].reduce((n, l) => n + l.length, 0),
      ledger_rows: ledger.length,
      discrepancies: findings.length,
      by_code: counts
    },
    findings
  };
}

module.exports = { DISCREPANCY, reconcilePayments };

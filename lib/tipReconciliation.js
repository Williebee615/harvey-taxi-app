// Read-only tip reconciliation (owner decision 2026-10-23: "build the tips
// reconciliation"). Tips are charged on real cards since 2026-10-22, so this
// compares three things that must agree:
//   - Stripe's tip PaymentIntents (metadata.kind = "ride_tip"),
//   - our ride_tips rows,
//   - each driver's earning row (tip_amount and total_earning).
// It returns fixed discrepancy codes with identifiers and amounts only: no
// client secret, card detail, rider contact or free text. It never refunds,
// cancels, charges or edits anything; a person decides what to do.
//
// Pure: callers pass in data they have already read.

const DISCREPANCY = Object.freeze({
  // Stripe took the money but no ride_tips row exists for the intent.
  PAID_UNTRACKED: "tip_paid_untracked",
  // Stripe took the money but our row is still pending (missed webhook or
  // confirm); the driver hasn't been credited.
  PAID_NOT_RECORDED: "tip_paid_not_recorded",
  // Our row says succeeded but Stripe doesn't show a succeeded intent.
  RECORDED_NOT_PAID: "tip_recorded_not_paid",
  // Our row's intent isn't in the Stripe data read (wrong mode or window).
  INTENT_MISSING: "tip_intent_missing",
  // Amount or currency differs between Stripe and our row.
  AMOUNT_MISMATCH: "tip_amount_mismatch",
  // The intent's metadata doesn't name this tip or ride.
  METADATA_MISMATCH: "tip_metadata_mismatch",
  // Some or all of a paid tip was refunded in Stripe.
  REFUNDED: "tip_refunded",
  // The intent's live/test mode differs from the row's mode.
  MODE_MISMATCH: "tip_mode_mismatch",
  // The driver's earning row doesn't carry the paid tips.
  EARNING_TIP_MISMATCH: "earning_tip_mismatch",
  // The earning row's total isn't base + tip.
  EARNING_TOTAL_MISMATCH: "earning_total_mismatch"
});

const PAID_ROW = new Set(["succeeded"]);
const toCents = (dollars) => (dollars === null || dollars === undefined || dollars === "" ? null : Math.round(Number(dollars) * 100));
const isTipIntent = (i) => Boolean(i && i.metadata && i.metadata.kind === "ride_tip");

// Refunded cents on an intent whose latest_charge was expanded.
function refundedCents(intent) {
  const charge = intent && intent.latest_charge;
  return charge && typeof charge === "object" ? Number(charge.amount_refunded || 0) : 0;
}

// mode: "live" or "test" (which Stripe account was read).
// intents: tip PaymentIntents from that account (non-tip intents ignored).
// tips: ride_tips rows of that mode, plus "simulated" rows for earnings.
// rides: { id, tip_amount } for every ride a tip names (booking tip).
// earnings: driver_earnings rows { ride_id, tip_amount, driver_base_earning, total_earning }.
function reconcileTips({ mode, intents = [], tips = [], rides = [], earnings = [] } = {}) {
  const findings = [];
  const add = (code, fields) => findings.push({ code, mode, ...fields });
  const expectLive = mode === "live";

  const tipIntents = intents.filter(isTipIntent);
  const intentById = new Map(tipIntents.map((i) => [i.id, i]));
  const modeTips = tips.filter((t) => t.mode === mode);
  const tipByIntent = new Map(modeTips.filter((t) => t.payment_intent_id).map((t) => [t.payment_intent_id, t]));

  // Stripe side: every succeeded tip charge must be a recorded, paid tip.
  for (const intent of tipIntents) {
    if (Boolean(intent.livemode) !== expectLive) add(DISCREPANCY.MODE_MISMATCH, { payment_intent_id: intent.id, livemode: Boolean(intent.livemode) });
    if (intent.status !== "succeeded") continue;
    const received = Number(intent.amount_received ?? intent.amount);
    const tip = tipByIntent.get(intent.id);
    if (!tip) {
      add(DISCREPANCY.PAID_UNTRACKED, { payment_intent_id: intent.id, ride_id: intent.metadata.ride_id || null, stripe_amount_cents: received });
      continue;
    }
    if (tip.status === "pending") add(DISCREPANCY.PAID_NOT_RECORDED, { payment_intent_id: intent.id, tip_id: tip.id, ride_id: tip.ride_id, stripe_amount_cents: received });
    if (tip.status === "cancelled") add(DISCREPANCY.PAID_NOT_RECORDED, { payment_intent_id: intent.id, tip_id: tip.id, ride_id: tip.ride_id, stripe_amount_cents: received, record_status: "cancelled" });
    if (received !== Number(tip.amount_cents) || String(intent.currency || "").toLowerCase() !== "usd") {
      add(DISCREPANCY.AMOUNT_MISMATCH, { payment_intent_id: intent.id, tip_id: tip.id, stripe_amount_cents: received, record_amount_cents: Number(tip.amount_cents) });
    }
    if (intent.metadata.tip_id !== String(tip.id) || intent.metadata.ride_id !== String(tip.ride_id)) {
      add(DISCREPANCY.METADATA_MISMATCH, { payment_intent_id: intent.id, tip_id: tip.id, ride_id: tip.ride_id });
    }
    const refunded = refundedCents(intent);
    if (refunded > 0) add(DISCREPANCY.REFUNDED, { payment_intent_id: intent.id, tip_id: tip.id, ride_id: tip.ride_id, refunded_cents: refunded });
  }

  // Our side: every paid row must have a succeeded Stripe charge.
  for (const tip of modeTips) {
    if (!PAID_ROW.has(tip.status) || !tip.payment_intent_id) continue;
    const intent = intentById.get(tip.payment_intent_id);
    if (!intent) add(DISCREPANCY.INTENT_MISSING, { payment_intent_id: tip.payment_intent_id, tip_id: tip.id, ride_id: tip.ride_id });
    else if (intent.status !== "succeeded") add(DISCREPANCY.RECORDED_NOT_PAID, { payment_intent_id: intent.id, tip_id: tip.id, ride_id: tip.ride_id, stripe_status: intent.status });
  }

  // Earnings: tip_amount = booking tip + paid/simulated tips; total = base + tip.
  const rideById = new Map(rides.map((r) => [String(r.id), r]));
  const paidCentsByRide = new Map();
  for (const t of tips) {
    if (t.status !== "succeeded" && t.status !== "simulated") continue;
    paidCentsByRide.set(String(t.ride_id), (paidCentsByRide.get(String(t.ride_id)) || 0) + Number(t.amount_cents || 0));
  }
  const ridesWithTips = new Set([...paidCentsByRide.keys()]);
  for (const earning of earnings) {
    const rideId = String(earning.ride_id);
    if (!ridesWithTips.has(rideId)) continue;
    const ride = rideById.get(rideId);
    const expectedTipCents = (toCents(ride && ride.tip_amount) || 0) + (paidCentsByRide.get(rideId) || 0);
    const tipCents = toCents(earning.tip_amount) || 0;
    if (tipCents !== expectedTipCents) add(DISCREPANCY.EARNING_TIP_MISMATCH, { ride_id: rideId, earning_tip_cents: tipCents, expected_tip_cents: expectedTipCents });
    const base = toCents(earning.driver_base_earning);
    const total = toCents(earning.total_earning);
    if (base !== null && total !== null && total !== base + tipCents) add(DISCREPANCY.EARNING_TOTAL_MISMATCH, { ride_id: rideId, earning_total_cents: total, expected_total_cents: base + tipCents });
  }

  const succeeded = tipIntents.filter((i) => i.status === "succeeded");
  return {
    findings,
    summary: {
      mode,
      tip_intents: tipIntents.length,
      tip_intents_succeeded: succeeded.length,
      stripe_tip_cents: succeeded.reduce((s, i) => s + Number(i.amount_received ?? i.amount ?? 0), 0),
      recorded_paid_tips: modeTips.filter((t) => PAID_ROW.has(t.status)).length,
      recorded_tip_cents: modeTips.filter((t) => PAID_ROW.has(t.status)).reduce((s, t) => s + Number(t.amount_cents || 0), 0),
      pending_tips: modeTips.filter((t) => t.status === "pending").length,
      earnings_checked: earnings.filter((e) => ridesWithTips.has(String(e.ride_id))).length,
      discrepancies: findings.length
    }
  };
}

module.exports = { DISCREPANCY, reconcileTips, refundedCents };

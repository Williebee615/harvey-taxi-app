// Tips during or after a trip (owner decision 2026-10-22: "Separate tip
// charge"). The rider adds a tip while the trip is in progress or up to 24
// hours after it ends; it is its own card charge and goes 100% to the
// driver. Off unless ride_tips_enabled is "true"; charges use a Stripe
// test key unless ride_tips_live is also "true". App Review rides are
// simulated: nothing is charged. Pure rules; server.js does the I/O.

const TIPS_FLAG = "ride_tips_enabled";
const TIPS_LIVE_FLAG = "ride_tips_live";
const MIN_TIP_CENTS = 100;
const MAX_TIP_CENTS = 10000;
const PRESET_TIPS_CENTS = Object.freeze([200, 500, 1000]);
const TIP_WINDOW_MS = 24 * 60 * 60 * 1000;
const TIPPABLE_STATUSES = Object.freeze(["in_progress", "completed"]);

const fail = (error, statusCode = 400) => ({ ok: false, error, statusCode });

// Dollars from the rider ("5", "7.50") to whole cents.
function validateTipAmount(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fail("Choose a tip amount.");
  const cents = Math.round(n * 100);
  if (Math.abs(cents - n * 100) > 1e-6) return fail("Use dollars and cents, for example 5 or 7.50.");
  if (cents < MIN_TIP_CENTS || cents > MAX_TIP_CENTS) return fail(`A tip can be from $${MIN_TIP_CENTS / 100} to $${MAX_TIP_CENTS / 100}.`);
  return { ok: true, amount_cents: cents };
}

function completedAtMs(ride) {
  const t = Date.parse(ride.completed_at || ride.updated_at || "");
  return Number.isFinite(t) ? t : null;
}

// Whether this rider may tip on this ride now.
function tipEligibility(ride, riderId, { now = Date.now() } = {}) {
  if (!ride || String(ride.rider_id || "") !== String(riderId || "")) return fail("Ride not found.", 404);
  if (!ride.driver_id) return fail("This ride has no driver to tip.", 409);
  if (!TIPPABLE_STATUSES.includes(ride.status)) return fail("You can tip once your trip has started.", 409);
  if (ride.status === "completed") {
    const done = completedAtMs(ride);
    if (done !== null && now - done > TIP_WINDOW_MS) return fail("Tips can be added up to 24 hours after a trip.", 409);
  }
  return { ok: true };
}

function tipMode(ride, { liveEnabled }) {
  if (ride && ride.is_review_ride) return "simulated";
  return liveEnabled ? "live" : "test";
}

// What a PaymentIntent must look like before its tip is recorded as paid.
function intentMatchesTip(intent, tip) {
  return Boolean(
    intent &&
      tip &&
      intent.id === tip.payment_intent_id &&
      intent.status === "succeeded" &&
      Number(intent.amount_received ?? intent.amount) === Number(tip.amount_cents) &&
      String(intent.currency || "").toLowerCase() === "usd" &&
      intent.metadata &&
      intent.metadata.kind === "ride_tip" &&
      intent.metadata.tip_id === String(tip.id) &&
      intent.metadata.ride_id === String(tip.ride_id)
  );
}

// The ride's total tip for the driver's earning: a tip chosen at booking
// plus any paid (or simulated) tip added during or after the trip.
function totalTipDollars(ride, tips = []) {
  const extra = tips.filter((t) => t.status === "succeeded" || t.status === "simulated").reduce((sum, t) => sum + Number(t.amount_cents || 0), 0);
  return Math.round((Number(ride && ride.tip_amount) || 0) * 100 + extra) / 100;
}

module.exports = {
  TIPS_FLAG,
  TIPS_LIVE_FLAG,
  MIN_TIP_CENTS,
  MAX_TIP_CENTS,
  PRESET_TIPS_CENTS,
  TIP_WINDOW_MS,
  TIPPABLE_STATUSES,
  validateTipAmount,
  tipEligibility,
  tipMode,
  intentMatchesTip,
  totalTipDollars
};

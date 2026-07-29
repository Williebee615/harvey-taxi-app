// Pure helpers for rider-side saved payment methods. server.js owns the
// actual Stripe/Supabase calls (customer creation, payment-method listing,
// PaymentIntent creation); this module builds/parses the payloads so the
// logic is unit-testable without a live Stripe account, same split as
// lib/pricing.js and lib/riderVerification.js.

const { RIDE_STATUS } = require("./rideDispatch");

function buildStripeCustomerPayload({ riderId, email, name }) {
  const payload = { metadata: { rider_id: String(riderId) } };
  if (email) payload.email = email;
  if (name) payload.name = name;
  return payload;
}

function mapStripePaymentMethod(paymentMethod) {
  const card = paymentMethod?.card || {};
  return {
    id: paymentMethod.id,
    brand: card.brand || "card",
    last4: card.last4 || "",
    exp_month: card.exp_month || null,
    exp_year: card.exp_year || null
  };
}

function mapPaymentMethodsForClient(paymentMethods) {
  return (paymentMethods || []).map(mapStripePaymentMethod);
}

// Extra fields to merge into stripe.paymentIntents.create() so either an
// existing saved card (paymentMethodId) or a newly entered card the rider
// opted to save (saveCard) ends up attached to their Stripe Customer.
// Returns {} when there is nothing to attach, so callers can always
// spread the result into the create() payload unconditionally.
function buildPaymentIntentAttachmentFields({ stripeCustomerId, paymentMethodId, saveCard }) {
  if (!stripeCustomerId) {
    return {};
  }

  if (paymentMethodId) {
    return { customer: stripeCustomerId, payment_method: paymentMethodId };
  }

  if (saveCard) {
    return { customer: stripeCustomerId, setup_future_usage: "on_session" };
  }

  return {};
}

// Same "never confirm a foreign ID exists" ownership check used by
// /api/rider/saved-places — a payment method belongs to a rider only if
// it's attached to that rider's own Stripe Customer.
function ownsPaymentMethod(paymentMethod, stripeCustomerId) {
  return Boolean(paymentMethod) && Boolean(stripeCustomerId) && paymentMethod.customer === stripeCustomerId;
}

const AUTHORIZED_PAYMENT_INTENT_STATUSES = new Set(["requires_capture", "succeeded"]);
const RIDE_PAYMENT_CURRENCY = "usd";

// A client-supplied payment_intent_id is never proof of payment at ride
// creation — only POST /api/rides/:id/authorize, after retrieving and
// verifying the intent with Stripe (verifyPaymentIntentForRide below), may
// move a ride to PAYMENT_AUTHORIZED. When the payment gate is on, every
// paid ride is created in PAYMENT_REQUIRED regardless of what the client
// claims here. paymentIntentId is accepted but never read — deliberately,
// so a regression test can assert an arbitrary/malicious value has zero
// effect on the returned status.
function decideInitialRideStatus({ enablePaymentGate, paymentIntentId }) {
  void paymentIntentId;
  return enablePaymentGate ? RIDE_STATUS.PAYMENT_REQUIRED : RIDE_STATUS.PAYMENT_AUTHORIZED;
}

// Real, server-side verification that a Stripe PaymentIntent actually
// authorizes this specific ride. When stripeConfigured is true, `intent`
// must be an object server.js already retrieved from Stripe itself via
// stripe.paymentIntents.retrieve(paymentIntentId) — never a raw
// client-supplied id or a locally-constructed object standing in for one.
//
// Checks, in order: a Stripe client actually exists to verify against
// (fails closed — no client means no authorization, never "authorize
// anyway" — see docs/production-incidents.md); the intent is in an
// authorized state; the currency and amount match this ride's actual
// fare; the intent isn't already bound to a different ride; the intent's
// rider (if present) matches this ride's rider. Returns { ok: true,
// needsBinding } when the intent may authorize this ride — needsBinding
// tells the caller whether it still needs to write ride_id into the
// intent's Stripe-side metadata so it can't later be reused on a
// different ride — or { ok: false, error, statusCode, extra } naming
// exactly which check failed.
function verifyPaymentIntentForRide({ stripeConfigured, intent, ride, rideId, exposeDetails = false }) {
  if (!stripeConfigured) {
    return {
      ok: false,
      error: "Payments are not configured. This ride cannot be authorized right now.",
      statusCode: 503
    };
  }

  if (!intent) {
    return { ok: false, error: "Payment could not be verified with Stripe.", statusCode: 402 };
  }

  if (!AUTHORIZED_PAYMENT_INTENT_STATUSES.has(intent.status)) {
    return {
      ok: false,
      error: `Payment is not authorized (status: ${intent.status}).`,
      statusCode: 402
    };
  }

  if (intent.currency && intent.currency !== RIDE_PAYMENT_CURRENCY) {
    return {
      ok: false,
      error: "Payment currency does not match the ride fare.",
      statusCode: 402,
      extra: exposeDetails
        ? { expected_currency: RIDE_PAYMENT_CURRENCY, intent_currency: intent.currency }
        : {}
    };
  }

  const expectedCents = Math.round(Number(ride?.estimated_fare || 0) * 100);
  if (expectedCents > 0 && Number(intent.amount) !== expectedCents) {
    return {
      ok: false,
      error: "Payment amount does not match the ride fare.",
      statusCode: 402,
      extra: exposeDetails ? { expected_cents: expectedCents, intent_cents: intent.amount } : {}
    };
  }

  const boundRide = intent.metadata?.ride_id;
  if (boundRide && boundRide !== rideId) {
    return {
      ok: false,
      error: "This payment is already associated with another ride.",
      statusCode: 409
    };
  }

  const intentRider = intent.metadata?.rider_id;
  if (intentRider && ride?.rider_id && intentRider !== String(ride.rider_id)) {
    return {
      ok: false,
      error: "This payment does not belong to this rider.",
      statusCode: 403
    };
  }

  return { ok: true, needsBinding: boundRide !== rideId };
}

module.exports = {
  buildStripeCustomerPayload,
  mapStripePaymentMethod,
  mapPaymentMethodsForClient,
  buildPaymentIntentAttachmentFields,
  ownsPaymentMethod,
  AUTHORIZED_PAYMENT_INTENT_STATUSES,
  RIDE_PAYMENT_CURRENCY,
  decideInitialRideStatus,
  verifyPaymentIntentForRide
};

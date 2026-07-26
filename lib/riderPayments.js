// Pure helpers for rider-side saved payment methods. server.js owns the
// actual Stripe/Supabase calls (customer creation, payment-method listing,
// PaymentIntent creation); this module builds/parses the payloads so the
// logic is unit-testable without a live Stripe account, same split as
// lib/pricing.js and lib/riderVerification.js.

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

module.exports = {
  buildStripeCustomerPayload,
  mapStripePaymentMethod,
  mapPaymentMethodsForClient,
  buildPaymentIntentAttachmentFields,
  ownsPaymentMethod
};

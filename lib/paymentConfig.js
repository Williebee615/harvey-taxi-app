// Effective payment configuration, reported WITHOUT secrets.
//
// "Are live card payments enabled?" cannot be answered from payment counts
// (no payments may simply mean no one has paid yet). It depends on the
// running configuration: which Stripe key mode the server uses, whether the
// browser gets a matching publishable key, whether webhooks are verified,
// and whether the payment gate is on. This derives those facts from key
// PREFIXES only (sk_live_ / sk_test_ / rk_* / pk_*); no key, key length or
// key fragment is ever returned or logged.

function keyMode(value, kind) {
  const v = String(value || "").trim();
  if (!v) return null;
  const prefixes = kind === "publishable" ? { pk_live_: "live", pk_test_: "test" } : { sk_live_: "live", sk_test_: "test", rk_live_: "live", rk_test_: "test" };
  for (const [prefix, mode] of Object.entries(prefixes)) {
    if (v.startsWith(prefix)) return mode;
  }
  return "unrecognized";
}

function describePaymentConfig({ secretKey, publishableKey, webhookSecret, paymentGateEnabled, stripeClientReady }) {
  const secretMode = keyMode(secretKey, "secret");
  const publishableMode = keyMode(publishableKey, "publishable");
  const modesMatch = Boolean(secretMode && publishableMode && secretMode === publishableMode);
  const cardPaymentsEffective = Boolean(stripeClientReady && paymentGateEnabled && secretMode && secretMode !== "unrecognized");
  return {
    stripe_client_ready: Boolean(stripeClientReady),
    secret_key_mode: secretMode,
    publishable_key_mode: publishableMode,
    key_modes_match: modesMatch,
    webhook_secret_set: Boolean(String(webhookSecret || "").trim()),
    payment_gate_enabled: Boolean(paymentGateEnabled),
    card_payments_effective: cardPaymentsEffective,
    live_card_payments_effective: cardPaymentsEffective && secretMode === "live",
    problems: [
      stripeClientReady && !paymentGateEnabled ? "Stripe is configured but the payment gate is off." : null,
      secretMode && publishableMode && !modesMatch ? "Secret and publishable keys are from different modes (test vs live)." : null,
      secretMode === "unrecognized" ? "The secret key does not look like a Stripe key." : null,
      secretMode && !publishableMode ? "No publishable key: the browser cannot collect cards." : null,
      cardPaymentsEffective && !String(webhookSecret || "").trim() ? "No webhook secret: payment events cannot be verified." : null
    ].filter(Boolean)
  };
}

// Which Stripe account the running server's secret key belongs to, from
// GET /v1/account. Allow-listed fields only: the account id (an "acct_"
// identifier, not a secret), its display name, country and whether it can
// charge. No email, address, owner or bank details.
function describeStripeAccount(account) {
  if (!account || typeof account.id !== "string" || !/^acct_[A-Za-z0-9]+$/.test(account.id)) {
    return { id: null, display_name: null, country: null, charges_enabled: null };
  }
  const name = account.settings?.dashboard?.display_name || account.business_profile?.name || null;
  return {
    id: account.id,
    display_name: name ? String(name).slice(0, 100) : null,
    country: account.country || null,
    charges_enabled: typeof account.charges_enabled === "boolean" ? account.charges_enabled : null
  };
}

module.exports = {
  describeStripeAccount,
  keyMode,
  describePaymentConfig
};

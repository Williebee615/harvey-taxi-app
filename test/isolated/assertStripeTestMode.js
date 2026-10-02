// Second safety check for the real-Stripe suites. The sk_test_/rk_test_
// prefix check only sees the value in STRIPE_TEST_SECRET_KEY; when the key
// is injected by a proxy (the suite then holds only a placeholder), the
// prefix proves nothing. Stripe itself reports the mode of the key it
// received: every object carries `livemode`. Refuse to run unless Stripe
// says false. Never logs or returns any key material.
async function assertStripeTestMode(stripe) {
  let balance;
  try {
    balance = await stripe.balance.retrieve();
  } catch (err) {
    throw new Error(`Refusing to run: could not confirm Stripe test mode (${err && (err.type || err.code) ? err.type || err.code : "request failed"}).`);
  }
  if (!balance || balance.livemode !== false) {
    throw new Error("Refusing to run: Stripe reports this key is NOT in test mode (livemode is not false).");
  }
  return true;
}

module.exports = { assertStripeTestMode };

const { keyMode, describePaymentConfig } = require("./paymentConfig");

const FAKE_LIVE = "sk_live_" + "x".repeat(24);
const FAKE_TEST = "sk_test_" + "y".repeat(24);

test("modes come from prefixes only", () => {
  expect(keyMode(FAKE_LIVE)).toBe("live");
  expect(keyMode(FAKE_TEST)).toBe("test");
  expect(keyMode("rk_live_abc")).toBe("live");
  expect(keyMode("pk_test_abc", "publishable")).toBe("test");
  expect(keyMode("", "secret")).toBeNull();
  expect(keyMode("garbage")).toBe("unrecognized");
});

test("live card payments are effective only with a live key, a ready client and the gate on", () => {
  const live = describePaymentConfig({ secretKey: FAKE_LIVE, publishableKey: "pk_live_a", webhookSecret: "whsec_a", paymentGateEnabled: true, stripeClientReady: true });
  expect(live).toMatchObject({ live_card_payments_effective: true, key_modes_match: true, problems: [] });
  expect(describePaymentConfig({ secretKey: FAKE_LIVE, publishableKey: "pk_live_a", paymentGateEnabled: false, stripeClientReady: true }).live_card_payments_effective).toBe(false);
  expect(describePaymentConfig({ secretKey: FAKE_TEST, publishableKey: "pk_test_a", paymentGateEnabled: true, stripeClientReady: true }).live_card_payments_effective).toBe(false);
  expect(describePaymentConfig({ paymentGateEnabled: true, stripeClientReady: false }).card_payments_effective).toBe(false);
});

test("mismatches and gaps are reported as problems", () => {
  const r = describePaymentConfig({ secretKey: FAKE_LIVE, publishableKey: "pk_test_a", paymentGateEnabled: true, stripeClientReady: true });
  expect(r.problems.join(" ")).toMatch(/different modes/);
  expect(r.problems.join(" ")).toMatch(/No webhook secret/);
});

test("unrecognized keys never count as matching modes", () => {
  const r = describePaymentConfig({ secretKey: "not-a-key", publishableKey: "also-not", paymentGateEnabled: true, stripeClientReady: true });
  expect(r).toMatchObject({ secret_key_mode: "unrecognized", publishable_key_mode: "unrecognized", key_modes_match: false, card_payments_effective: false });
  expect(r.problems.join(" ")).toMatch(/secret key does not look like a Stripe key/);
  expect(r.problems.join(" ")).toMatch(/publishable key does not look like a Stripe publishable key/);
  expect(r.problems.join(" ")).not.toMatch(/different modes/);
  expect(describePaymentConfig({ secretKey: FAKE_TEST, publishableKey: "garbage" }).key_modes_match).toBe(false);
});

test("no secret material is ever returned", () => {
  const r = describePaymentConfig({ secretKey: FAKE_LIVE, publishableKey: "pk_live_zzzz", webhookSecret: "whsec_qqqq", paymentGateEnabled: true, stripeClientReady: true });
  expect(JSON.stringify(r)).not.toMatch(/xxxx|zzzz|qqqq|sk_|pk_|whsec_/);
});

const { describeStripeAccount } = require("./paymentConfig");

test("Stripe account summary carries only allow-listed fields", () => {
  const summary = describeStripeAccount({
    id: "acct_1ABCdef",
    email: "owner@example.test",
    country: "US",
    charges_enabled: true,
    settings: { dashboard: { display_name: "Harvey Taxi2" } },
    business_profile: { support_phone: "+16155550100", support_email: "help@example.test" },
    external_accounts: { data: [{ last4: "6789" }] }
  });
  expect(summary).toEqual({ id: "acct_1ABCdef", display_name: "Harvey Taxi2", country: "US", charges_enabled: true });
  expect(JSON.stringify(summary)).not.toMatch(/example\.test|5550100|6789/);
  expect(describeStripeAccount({ id: "not-an-account" }).id).toBeNull();
  expect(describeStripeAccount(null).id).toBeNull();
});

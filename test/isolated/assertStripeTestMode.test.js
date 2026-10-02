const { assertStripeTestMode } = require("./assertStripeTestMode");

const stripeReturning = (balance) => ({ balance: { retrieve: async () => balance } });

test("passes only when Stripe reports livemode false", async () => {
  await expect(assertStripeTestMode(stripeReturning({ object: "balance", livemode: false }))).resolves.toBe(true);
});

test.each([
  ["live mode", { livemode: true }],
  ["missing livemode", {}],
  ["no response", null]
])("refuses on %s", async (_label, balance) => {
  await expect(assertStripeTestMode(stripeReturning(balance))).rejects.toThrow(/NOT in test mode/);
});

test("refuses when Stripe rejects the key, naming only the error type", async () => {
  const stripe = { balance: { retrieve: async () => { throw Object.assign(new Error("Invalid API Key provided: sk_test_****abcd"), { type: "StripeAuthenticationError" }); } } };
  const err = await assertStripeTestMode(stripe).catch((e) => e);
  expect(err.message).toMatch(/StripeAuthenticationError/);
  expect(err.message).not.toMatch(/sk_test|abcd/);
});

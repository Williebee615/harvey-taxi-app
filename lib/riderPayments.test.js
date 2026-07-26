const {
  buildStripeCustomerPayload,
  mapStripePaymentMethod,
  mapPaymentMethodsForClient,
  buildPaymentIntentAttachmentFields,
  ownsPaymentMethod
} = require("./riderPayments");

describe("buildStripeCustomerPayload", () => {
  test("includes rider_id metadata plus email/name when provided", () => {
    expect(
      buildStripeCustomerPayload({ riderId: "RIDER-1", email: "a@b.com", name: "Jane Doe" })
    ).toEqual({
      metadata: { rider_id: "RIDER-1" },
      email: "a@b.com",
      name: "Jane Doe"
    });
  });

  test("omits email/name when not provided, but always stringifies rider_id", () => {
    expect(buildStripeCustomerPayload({ riderId: 42 })).toEqual({
      metadata: { rider_id: "42" }
    });
  });
});

describe("mapStripePaymentMethod / mapPaymentMethodsForClient", () => {
  test("extracts only the fields the client needs from a Stripe card payment method", () => {
    const raw = {
      id: "pm_123",
      customer: "cus_1",
      card: { brand: "visa", last4: "4242", exp_month: 12, exp_year: 2029, fingerprint: "secret" }
    };

    expect(mapStripePaymentMethod(raw)).toEqual({
      id: "pm_123",
      brand: "visa",
      last4: "4242",
      exp_month: 12,
      exp_year: 2029
    });
  });

  test("falls back gracefully when card details are missing", () => {
    expect(mapStripePaymentMethod({ id: "pm_1" })).toEqual({
      id: "pm_1",
      brand: "card",
      last4: "",
      exp_month: null,
      exp_year: null
    });
  });

  test("maps a list and handles an empty/undefined list", () => {
    const list = [{ id: "pm_1", card: { brand: "visa", last4: "1111" } }];
    expect(mapPaymentMethodsForClient(list)).toEqual([
      { id: "pm_1", brand: "visa", last4: "1111", exp_month: null, exp_year: null }
    ]);
    expect(mapPaymentMethodsForClient(undefined)).toEqual([]);
    expect(mapPaymentMethodsForClient([])).toEqual([]);
  });
});

describe("buildPaymentIntentAttachmentFields", () => {
  test("attaches an existing saved payment method to the customer", () => {
    expect(
      buildPaymentIntentAttachmentFields({ stripeCustomerId: "cus_1", paymentMethodId: "pm_1" })
    ).toEqual({ customer: "cus_1", payment_method: "pm_1" });
  });

  test("marks a newly entered card for future reuse when the rider opts to save it", () => {
    expect(
      buildPaymentIntentAttachmentFields({ stripeCustomerId: "cus_1", saveCard: true })
    ).toEqual({ customer: "cus_1", setup_future_usage: "on_session" });
  });

  test("prefers an explicit saved payment method over save_card when both are set", () => {
    expect(
      buildPaymentIntentAttachmentFields({ stripeCustomerId: "cus_1", paymentMethodId: "pm_1", saveCard: true })
    ).toEqual({ customer: "cus_1", payment_method: "pm_1" });
  });

  test("returns no attachment fields with no customer, no payment method, and no save_card", () => {
    expect(buildPaymentIntentAttachmentFields({})).toEqual({});
    expect(buildPaymentIntentAttachmentFields({ paymentMethodId: "pm_1" })).toEqual({});
    expect(buildPaymentIntentAttachmentFields({ saveCard: true })).toEqual({});
  });
});

describe("ownsPaymentMethod", () => {
  test("true only when the payment method's customer matches the rider's Stripe customer", () => {
    expect(ownsPaymentMethod({ customer: "cus_1" }, "cus_1")).toBe(true);
    expect(ownsPaymentMethod({ customer: "cus_2" }, "cus_1")).toBe(false);
  });

  test("false when either side is missing, never throws", () => {
    expect(ownsPaymentMethod(null, "cus_1")).toBe(false);
    expect(ownsPaymentMethod({ customer: "cus_1" }, null)).toBe(false);
    expect(ownsPaymentMethod(undefined, undefined)).toBe(false);
  });
});

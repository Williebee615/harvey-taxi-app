const {
  buildStripeCustomerPayload,
  mapStripePaymentMethod,
  mapPaymentMethodsForClient,
  buildPaymentIntentAttachmentFields,
  ownsPaymentMethod,
  decideInitialRideStatus,
  verifyPaymentIntentForRide,
  authorizePaymentIntentForRide
} = require("./riderPayments");
const { RIDE_STATUS } = require("./rideDispatch");

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

// Regression coverage for docs/production-incidents.md, "Ride authorization
// accepts an unverified payment_intent_id when Stripe is unavailable."
describe("decideInitialRideStatus", () => {
  test("arbitrary client-supplied payment_intent_id never authorizes a ride when the gate is on", () => {
    const arbitraryIds = [
      "pi_totally_made_up",
      "1' OR '1'='1",
      "authorized",
      "true",
      String(Math.random())
    ];

    for (const paymentIntentId of arbitraryIds) {
      expect(
        decideInitialRideStatus({ enablePaymentGate: true, paymentIntentId })
      ).toBe(RIDE_STATUS.PAYMENT_REQUIRED);
    }
  });

  test("no payment_intent_id at all still lands on PAYMENT_REQUIRED when the gate is on", () => {
    expect(
      decideInitialRideStatus({ enablePaymentGate: true, paymentIntentId: undefined })
    ).toBe(RIDE_STATUS.PAYMENT_REQUIRED);
  });

  test("payment gate explicitly off is an ops decision, not a client one — authorizes immediately", () => {
    expect(
      decideInitialRideStatus({ enablePaymentGate: false, paymentIntentId: "anything" })
    ).toBe(RIDE_STATUS.PAYMENT_AUTHORIZED);
    expect(
      decideInitialRideStatus({ enablePaymentGate: false, paymentIntentId: undefined })
    ).toBe(RIDE_STATUS.PAYMENT_AUTHORIZED);
  });
});

describe("verifyPaymentIntentForRide", () => {
  const ride = { rider_id: "RIDER-1", estimated_fare: 42.5 };
  const rideId = "RIDE-1";
  const expectedCents = 4250;

  function validIntent(overrides = {}) {
    return {
      id: "pi_valid",
      status: "requires_capture",
      currency: "usd",
      amount: expectedCents,
      metadata: { rider_id: "RIDER-1" },
      ...overrides
    };
  }

  test("fails closed when Stripe is unconfigured, regardless of any intent passed in — must not dispatch", () => {
    const result = verifyPaymentIntentForRide({
      stripeConfigured: false,
      intent: validIntent(),
      ride,
      rideId
    });

    expect(result.ok).toBe(false);
    expect(result.statusCode).toBe(503);
    expect(result.error).toMatch(/not configured/i);
  });

  test("fails when Stripe is configured but no intent could be retrieved (arbitrary/nonexistent id)", () => {
    const result = verifyPaymentIntentForRide({
      stripeConfigured: true,
      intent: null,
      ride,
      rideId
    });

    expect(result.ok).toBe(false);
    expect(result.statusCode).toBe(402);
  });

  test("rejects an intent that never reached an authorized status", () => {
    for (const status of ["requires_payment_method", "requires_action", "canceled", "processing"]) {
      const result = verifyPaymentIntentForRide({
        stripeConfigured: true,
        intent: validIntent({ status }),
        ride,
        rideId
      });

      expect(result.ok).toBe(false);
      expect(result.statusCode).toBe(402);
      expect(result.error).toMatch(new RegExp(status));
    }
  });

  test("rejects a currency mismatch", () => {
    const result = verifyPaymentIntentForRide({
      stripeConfigured: true,
      intent: validIntent({ currency: "eur" }),
      ride,
      rideId,
      exposeDetails: true
    });

    expect(result.ok).toBe(false);
    expect(result.statusCode).toBe(402);
    expect(result.extra).toEqual({ expected_currency: "usd", intent_currency: "eur" });
  });

  test("rejects an amount mismatch", () => {
    const result = verifyPaymentIntentForRide({
      stripeConfigured: true,
      intent: validIntent({ amount: expectedCents - 1 }),
      ride,
      rideId,
      exposeDetails: true
    });

    expect(result.ok).toBe(false);
    expect(result.statusCode).toBe(402);
    expect(result.extra).toEqual({ expected_cents: expectedCents, intent_cents: expectedCents - 1 });
  });

  test("hides amount/currency mismatch details in production", () => {
    const result = verifyPaymentIntentForRide({
      stripeConfigured: true,
      intent: validIntent({ amount: expectedCents - 1 }),
      ride,
      rideId,
      exposeDetails: false
    });

    expect(result.ok).toBe(false);
    expect(result.extra).toEqual({});
  });

  test("rejects a missing currency outright, not just a mismatched one", () => {
    const result = verifyPaymentIntentForRide({
      stripeConfigured: true,
      intent: validIntent({ currency: undefined }),
      ride,
      rideId,
      exposeDetails: true
    });

    expect(result.ok).toBe(false);
    expect(result.statusCode).toBe(402);
    expect(result.extra).toEqual({ expected_currency: "usd", intent_currency: null });
  });

  test("rejects an intent with no rider_id metadata when the ride has an identified rider (mandatory binding)", () => {
    const result = verifyPaymentIntentForRide({
      stripeConfigured: true,
      intent: validIntent({ metadata: {} }),
      ride,
      rideId
    });

    expect(result.ok).toBe(false);
    expect(result.statusCode).toBe(403);
  });

  test("does not require rider metadata when the ride itself has no identified rider (anonymous ride request)", () => {
    const result = verifyPaymentIntentForRide({
      stripeConfigured: true,
      intent: validIntent({ metadata: {} }),
      ride: { rider_id: null, estimated_fare: 42.5 },
      rideId
    });

    expect(result).toEqual({ ok: true, needsBinding: true });
  });

  test("rejects an intent already bound to a different ride (reuse across rides)", () => {
    const result = verifyPaymentIntentForRide({
      stripeConfigured: true,
      intent: validIntent({ metadata: { ride_id: "RIDE-OTHER" } }),
      ride,
      rideId
    });

    expect(result.ok).toBe(false);
    expect(result.statusCode).toBe(409);
  });

  test("rejects an intent whose metadata rider doesn't match this ride's rider", () => {
    const result = verifyPaymentIntentForRide({
      stripeConfigured: true,
      intent: validIntent({ metadata: { rider_id: "RIDER-OTHER" } }),
      ride,
      rideId
    });

    expect(result.ok).toBe(false);
    expect(result.statusCode).toBe(403);
  });

  test("accepts a genuinely valid, correctly-bound, correctly-scoped intent and signals no rebinding needed", () => {
    const result = verifyPaymentIntentForRide({
      stripeConfigured: true,
      intent: validIntent({ metadata: { ride_id: rideId, rider_id: "RIDER-1" } }),
      ride,
      rideId
    });

    expect(result).toEqual({ ok: true, needsBinding: false });
  });

  test("accepts a valid, unbound intent and signals it still needs binding to this ride", () => {
    const result = verifyPaymentIntentForRide({
      stripeConfigured: true,
      intent: validIntent(),
      ride,
      rideId
    });

    expect(result).toEqual({ ok: true, needsBinding: true });
  });

  test("succeeded status is accepted the same as requires_capture", () => {
    const result = verifyPaymentIntentForRide({
      stripeConfigured: true,
      intent: validIntent({ status: "succeeded" }),
      ride,
      rideId
    });

    expect(result.ok).toBe(true);
  });

  test("skips the amount check when the ride has no real fare on record, rather than dividing by a bogus expectation", () => {
    const result = verifyPaymentIntentForRide({
      stripeConfigured: true,
      intent: validIntent({ amount: 999999 }),
      ride: { rider_id: "RIDER-1", estimated_fare: 0 },
      rideId
    });

    expect(result.ok).toBe(true);
  });
});

describe("authorizePaymentIntentForRide", () => {
  const ride = { rider_id: "RIDER-1", estimated_fare: 42.5 };
  const rideId = "RIDE-1";

  function validUnboundIntent() {
    return {
      id: "pi_valid",
      status: "requires_capture",
      currency: "usd",
      amount: 4250,
      metadata: { rider_id: "RIDER-1" }
    };
  }

  test("returns the sync verification failure unchanged and never attempts to bind", async () => {
    const bindPaymentIntentToRide = jest.fn();

    const result = await authorizePaymentIntentForRide({
      stripeConfigured: false,
      intent: validUnboundIntent(),
      ride,
      rideId,
      bindPaymentIntentToRide
    });

    expect(result.ok).toBe(false);
    expect(result.statusCode).toBe(503);
    expect(bindPaymentIntentToRide).not.toHaveBeenCalled();
  });

  test("skips binding entirely, with no call at all, when the intent is already correctly bound", async () => {
    const bindPaymentIntentToRide = jest.fn();
    const alreadyBoundIntent = { ...validUnboundIntent(), metadata: { ride_id: rideId, rider_id: "RIDER-1" } };

    const result = await authorizePaymentIntentForRide({
      stripeConfigured: true,
      intent: alreadyBoundIntent,
      ride,
      rideId,
      bindPaymentIntentToRide
    });

    expect(result).toEqual({ ok: true, needsBinding: false });
    expect(bindPaymentIntentToRide).not.toHaveBeenCalled();
  });

  test("binds successfully and reports needsBinding: false afterward", async () => {
    const bindPaymentIntentToRide = jest.fn().mockResolvedValue({});

    const result = await authorizePaymentIntentForRide({
      stripeConfigured: true,
      intent: validUnboundIntent(),
      ride,
      rideId,
      bindPaymentIntentToRide
    });

    expect(bindPaymentIntentToRide).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ ok: true, needsBinding: false });
  });

  // The specific fail-closed guarantee under review: a bind failure must
  // stop authorization, not just log a warning and let the ride through
  // PAYMENT_AUTHORIZED with its reuse-prevention guarantee unestablished.
  test("fails authorization when binding the intent to this ride fails, instead of authorizing anyway", async () => {
    const bindPaymentIntentToRide = jest.fn().mockRejectedValue(new Error("Stripe API is down"));

    const result = await authorizePaymentIntentForRide({
      stripeConfigured: true,
      intent: validUnboundIntent(),
      ride,
      rideId,
      bindPaymentIntentToRide
    });

    expect(bindPaymentIntentToRide).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(false);
    expect(result.statusCode).toBe(502);
    expect(result.error).toMatch(/could not secure/i);
  });
});

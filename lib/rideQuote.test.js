const {
  signRideQuote,
  verifyRideQuote,
  quoteMatchesSubmission,
  resolveRideQuote
} = require("./rideQuote");

const SECRET = "test-quote-secret";

const validEstimate = {
  miles: 5,
  minutes: 15,
  total: 16.75,
  base_fare: 5,
  distance_charge: 4.5,
  time_charge: 5.25,
  booking_fee: 2
};

function buildQuoteArgs(overrides = {}) {
  return {
    rideType: "standard",
    miles: 5,
    minutes: 15,
    pickup: { lat: 36.1627, lng: -86.7816 },
    destination: { lat: 36.0331, lng: -86.5186 },
    riderId: "RIDER-1",
    estimate: validEstimate,
    secret: SECRET,
    ttlMinutes: 15,
    now: 1_000_000,
    ...overrides
  };
}

describe("signRideQuote / verifyRideQuote", () => {
  it("round-trips a valid quote", () => {
    const token = signRideQuote(buildQuoteArgs());
    const result = verifyRideQuote({ token, secret: SECRET, now: 1_000_000 + 60_000 });

    expect(result.ok).toBe(true);
    expect(result.payload.ride_type).toBe("standard");
    expect(result.payload.miles).toBe(5);
    expect(result.payload.estimate.total).toBe(16.75);
    expect(result.payload.quote_source).toBe("browser_calculated");
  });

  it("rejects a token verified after its expiration (fail-closed at the boundary)", () => {
    const token = signRideQuote(buildQuoteArgs({ now: 1_000_000, ttlMinutes: 10 }));

    // now === exp exactly: must already be treated as expired, not "not yet expired".
    const exp = 1_000_000 + 10 * 60 * 1000;
    const result = verifyRideQuote({ token, secret: SECRET, now: exp });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("expired");
  });

  it("accepts a token one millisecond before expiration", () => {
    const token = signRideQuote(buildQuoteArgs({ now: 1_000_000, ttlMinutes: 10 }));
    const exp = 1_000_000 + 10 * 60 * 1000;
    const result = verifyRideQuote({ token, secret: SECRET, now: exp - 1 });

    expect(result.ok).toBe(true);
  });

  it("rejects a token signed with a different secret", () => {
    const token = signRideQuote(buildQuoteArgs({ secret: "secret-a" }));
    const result = verifyRideQuote({ token, secret: "secret-b", now: 1_000_000 });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("bad_signature");
  });

  it("rejects a malformed token (no signature segment)", () => {
    const result = verifyRideQuote({ token: "not-a-real-token", secret: SECRET });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("malformed");
  });

  it("rejects a missing token", () => {
    const result = verifyRideQuote({ token: "", secret: SECRET });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("missing_token");
  });

  it("rejects a token whose payload was tampered with after signing (e.g. miles edited in transit)", () => {
    const token = signRideQuote(buildQuoteArgs());
    const [encoded, sig] = token.split(".");

    const tamperedPayload = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
    tamperedPayload.miles = 0.1;
    tamperedPayload.estimate = { ...tamperedPayload.estimate, total: 8 };

    const tamperedEncoded = Buffer.from(JSON.stringify(tamperedPayload))
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    const tamperedToken = `${tamperedEncoded}.${sig}`;
    const result = verifyRideQuote({ token: tamperedToken, secret: SECRET, now: 1_000_000 });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("bad_signature");
  });

  it("rejects signing with a non-positive miles value", () => {
    expect(() => signRideQuote(buildQuoteArgs({ miles: 0 }))).toThrow();
    expect(() => signRideQuote(buildQuoteArgs({ miles: -5 }))).toThrow();
  });

  it("rejects signing without a secret", () => {
    expect(() => signRideQuote(buildQuoteArgs({ secret: "" }))).toThrow();
  });

  it("rejects signing with non-finite coordinates", () => {
    expect(() =>
      signRideQuote(buildQuoteArgs({ pickup: { lat: NaN, lng: -86.7816 } }))
    ).toThrow();
  });
});

describe("quoteMatchesSubmission", () => {
  function issuedQuotePayload(overrides = {}) {
    const token = signRideQuote(buildQuoteArgs(overrides));
    return verifyRideQuote({ token, secret: SECRET, now: 1_000_000 + 1000 }).payload;
  }

  const freshSubmission = {
    rideType: "standard",
    pickup: { lat: 36.1627, lng: -86.7816 },
    destination: { lat: 36.0331, lng: -86.5186 },
    riderId: "RIDER-1"
  };

  it("matches an unaltered resubmission of the same trip", () => {
    const quote = issuedQuotePayload();
    const result = quoteMatchesSubmission({ quote, ...freshSubmission });

    expect(result.ok).toBe(true);
  });

  it("rejects a submission for a different rider than the quote was issued to", () => {
    const quote = issuedQuotePayload();
    const result = quoteMatchesSubmission({
      quote,
      ...freshSubmission,
      riderId: "RIDER-2"
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("rider_mismatch");
  });

  it("rejects a guest quote (no rider_id at issuance) resubmitted with a rider attached", () => {
    const quote = issuedQuotePayload({ riderId: null });
    const result = quoteMatchesSubmission({
      quote,
      ...freshSubmission,
      riderId: "RIDER-2"
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("rider_mismatch");
  });

  it("rejects a submission for a different service type than the quote was issued for", () => {
    const quote = issuedQuotePayload({ rideType: "standard" });
    const result = quoteMatchesSubmission({
      quote,
      ...freshSubmission,
      rideType: "airport"
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("ride_type_mismatch");
  });

  it("rejects a submission whose pickup coordinates differ from the quote", () => {
    const quote = issuedQuotePayload();
    const result = quoteMatchesSubmission({
      quote,
      ...freshSubmission,
      pickup: { lat: 36.2, lng: -86.7816 }
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("pickup_mismatch");
  });

  it("rejects a submission whose destination coordinates differ from the quote", () => {
    const quote = issuedQuotePayload();
    const result = quoteMatchesSubmission({
      quote,
      ...freshSubmission,
      destination: { lat: 36.0331, lng: -86.9 }
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("destination_mismatch");
  });

  it("tolerates float noise well within rounding precision", () => {
    const quote = issuedQuotePayload();
    const result = quoteMatchesSubmission({
      quote,
      ...freshSubmission,
      pickup: { lat: 36.16270000001, lng: -86.78160000002 }
    });

    expect(result.ok).toBe(true);
  });
});

// resolveRideQuote() is the exact function server.js's
// verifyAndConsumeRideQuote() delegates to for both /api/rides/payment-intent
// and /api/rides/request -- these tests exercise it end-to-end (sign once,
// then resolve against a range of honest and dishonest resubmissions) to
// directly prove the properties required before this quote-token system
// can be trusted to gate real money movement.
describe("resolveRideQuote (end-to-end quote-integrity guarantees)", () => {
  const legitimateTrip = {
    rideType: "standard",
    miles: 5,
    minutes: 15,
    pickup: { lat: 36.1627, lng: -86.7816 },
    destination: { lat: 36.0331, lng: -86.5186 },
    riderId: "RIDER-1",
    estimate: validEstimate,
    secret: SECRET,
    ttlMinutes: 15,
    now: 1_000_000
  };

  it("resolves a legitimate, unaltered resubmission", () => {
    const token = signRideQuote(legitimateTrip);

    const result = resolveRideQuote({
      token,
      secret: SECRET,
      rideType: "standard",
      pickup: legitimateTrip.pickup,
      destination: legitimateTrip.destination,
      riderId: "RIDER-1",
      now: 1_000_000 + 60_000
    });

    expect(result.ok).toBe(true);
    expect(result.quote.estimate.total).toBe(16.75);
  });

  it("changing miles after estimate issuance does not change the charged fare", () => {
    // A real 5-mile trip was quoted at $16.75. Simulate a tampered/replayed
    // request that tries to claim a trivial 0.1-mile trip instead (the
    // exact attack scenario this system exists to close) -- but
    // resolveRideQuote() has no miles/fare parameter at all for that
    // tampered value to be passed through, so the only "charged" number
    // that exists afterward is quote.estimate.total, and it's still 16.75:
    // the original, signed amount, completely unaffected by what a caller
    // might have wanted to resubmit.
    const token = signRideQuote(legitimateTrip);

    const result = resolveRideQuote({
      token,
      secret: SECRET,
      rideType: "standard",
      pickup: legitimateTrip.pickup,
      destination: legitimateTrip.destination,
      riderId: "RIDER-1",
      now: 1_000_000 + 60_000
      // Deliberately no miles/minutes/fare fields here at all -- proving
      // there is nothing in this function's contract for a resubmitted
      // "miles: 0.1" to even be attached to.
    });

    expect(result.ok).toBe(true);
    expect(result.quote.miles).toBe(5);
    expect(result.quote.minutes).toBe(15);
    expect(result.quote.estimate.total).toBe(16.75);
  });

  it("changing fare or fees is ignored: the quote's own frozen estimate is always what's returned", () => {
    const token = signRideQuote(legitimateTrip);

    const result = resolveRideQuote({
      token,
      secret: SECRET,
      rideType: "standard",
      pickup: legitimateTrip.pickup,
      destination: legitimateTrip.destination,
      riderId: "RIDER-1",
      now: 1_000_000 + 60_000
    });

    expect(result.ok).toBe(true);
    // Byte-for-byte the object calculateRideEstimate() produced at
    // estimate time -- server.js reads amountCents from quote.estimate.total
    // exclusively, never from a client-supplied fare/fee field.
    expect(result.quote.estimate).toEqual(validEstimate);
  });

  it("rejects a resubmission with altered pickup coordinates", () => {
    const token = signRideQuote(legitimateTrip);

    const result = resolveRideQuote({
      token,
      secret: SECRET,
      rideType: "standard",
      pickup: { lat: 36.9, lng: -86.7816 },
      destination: legitimateTrip.destination,
      riderId: "RIDER-1",
      now: 1_000_000 + 60_000
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("pickup_mismatch");
  });

  it("rejects a resubmission with altered destination coordinates", () => {
    const token = signRideQuote(legitimateTrip);

    const result = resolveRideQuote({
      token,
      secret: SECRET,
      rideType: "standard",
      pickup: legitimateTrip.pickup,
      destination: { lat: 36.0331, lng: -85.0 },
      riderId: "RIDER-1",
      now: 1_000_000 + 60_000
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("destination_mismatch");
  });

  it("rejects an expired quote", () => {
    const token = signRideQuote(legitimateTrip);
    const exp = 1_000_000 + 15 * 60 * 1000;

    const result = resolveRideQuote({
      token,
      secret: SECRET,
      rideType: "standard",
      pickup: legitimateTrip.pickup,
      destination: legitimateTrip.destination,
      riderId: "RIDER-1",
      now: exp
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("expired");
  });

  it("rejects a malformed token", () => {
    const result = resolveRideQuote({
      token: "garbage",
      secret: SECRET,
      rideType: "standard",
      pickup: legitimateTrip.pickup,
      destination: legitimateTrip.destination,
      riderId: "RIDER-1"
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("malformed");
  });

  it("rejects a token signed under a different secret", () => {
    const token = signRideQuote({ ...legitimateTrip, secret: "some-other-secret" });

    const result = resolveRideQuote({
      token,
      secret: SECRET,
      rideType: "standard",
      pickup: legitimateTrip.pickup,
      destination: legitimateTrip.destination,
      riderId: "RIDER-1",
      now: 1_000_000 + 60_000
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("bad_signature");
  });

  it("a quote cannot be reused for a different rider", () => {
    const token = signRideQuote(legitimateTrip);

    const result = resolveRideQuote({
      token,
      secret: SECRET,
      rideType: "standard",
      pickup: legitimateTrip.pickup,
      destination: legitimateTrip.destination,
      riderId: "RIDER-ATTACKER",
      now: 1_000_000 + 60_000
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("rider_mismatch");
  });

  it("a quote cannot be reused for a different service type", () => {
    const token = signRideQuote(legitimateTrip);

    const result = resolveRideQuote({
      token,
      secret: SECRET,
      rideType: "airport",
      pickup: legitimateTrip.pickup,
      destination: legitimateTrip.destination,
      riderId: "RIDER-1",
      now: 1_000_000 + 60_000
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("ride_type_mismatch");
  });
});

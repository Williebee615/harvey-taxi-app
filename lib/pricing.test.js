const { calculateRideEstimate } = require("./pricing");

// These tests pin the env-configured rate defaults (BASE_FARE=5,
// PER_MILE_RATE=0.90, PER_MINUTE_RATE=0.35, BOOKING_FEE=2,
// MINIMUM_FARE=8, DRIVER_PAYOUT_PERCENT=0.70) as loaded when no env vars
// override them — see the envNumber() regression test below for the bug
// that used to make all of these silently collapse to 0.
describe("calculateRideEstimate", () => {
  it("computes a standard fare from real miles/minutes, not zero", () => {
    const estimate = calculateRideEstimate({ miles: 5, minutes: 15, ride_type: "standard" });

    expect(estimate.base_fare).toBe(5);
    expect(estimate.distance_charge).toBe(4.5);
    expect(estimate.time_charge).toBe(5.25);
    expect(estimate.booking_fee).toBe(2);
    expect(estimate.total).toBe(16.75);
  });

  it("never returns a nonzero fare for a real trip when rates are configured (regression: 0mi/0min bug)", () => {
    // Guards against the historical bug where the client never sent real
    // distance/duration, so every trip was priced as if it were 0 miles —
    // this test pins that a real trip's distance/time charges are
    // actually nonzero and reflected in the total.
    const zeroTrip = calculateRideEstimate({ miles: 0, minutes: 0, ride_type: "standard" });
    const realTrip = calculateRideEstimate({ miles: 20, minutes: 30, ride_type: "standard" });

    expect(realTrip.total).toBeGreaterThan(zeroTrip.total);
  });

  it("applies a flat airport surcharge as its own line item, on top of the base fare", () => {
    const estimate = calculateRideEstimate({ miles: 10, minutes: 20, ride_type: "airport" });

    expect(estimate.surcharge_amount).toBe(5);
    expect(estimate.total).toBe(28);
  });

  it("applies the medical/foundation discount without discounting the booking fee", () => {
    const estimate = calculateRideEstimate({ miles: 5, minutes: 15, ride_type: "medical" });
    const undiscounted = calculateRideEstimate({ miles: 5, minutes: 15, ride_type: "standard" });

    // The booking fee itself never changes based on ride_type.
    expect(estimate.booking_fee).toBe(undiscounted.booking_fee);
    expect(estimate.discount_amount).toBeGreaterThan(0);

    // The discount only ever comes out of (base + distance + time), so the
    // total drop should be less than 5% of the WHOLE pre-discount total
    // (base+distance+time+booking) — if the booking fee were incorrectly
    // included in the discount base, the gap would be larger.
    const eligiblePreDiscount =
      undiscounted.base_fare + undiscounted.distance_charge + undiscounted.time_charge;

    expect(estimate.discount_amount).toBeCloseTo(eligiblePreDiscount * 0.05, 2);
  });

  it("applies the minimum fare floor for a very short trip", () => {
    const estimate = calculateRideEstimate({ miles: 0, minutes: 0, ride_type: "standard" });

    expect(estimate.minimum_fare_applied).toBe(true);
    expect(estimate.total).toBe(8);
  });

  it("does not report minimum_fare_applied for a trip that legitimately exceeds it (regression: rounding false-positive)", () => {
    // A discount multiplier (0.95) can land on a fractional-cent total
    // (e.g. 16.0125) that's just barely above the $8 floor. Comparing an
    // unrounded total against a rounded one used to report this as
    // "minimum fare applied" even though the floor never actually kicked in.
    const estimate = calculateRideEstimate({ miles: 5, minutes: 15, ride_type: "medical" });

    expect(estimate.total).toBeGreaterThan(8);
    expect(estimate.minimum_fare_applied).toBe(false);
  });

  it("never lets the driver's split include the booking fee", () => {
    const withoutFloor = calculateRideEstimate({ miles: 20, minutes: 30, ride_type: "standard" });
    const atFloor = calculateRideEstimate({ miles: 0, minutes: 0, ride_type: "standard" });

    for (const estimate of [withoutFloor, atFloor]) {
      const eligibleFareForPayout = estimate.total - estimate.booking_fee;
      expect(estimate.driver_payout).toBeCloseTo(eligibleFareForPayout * 0.7, 2);
    }
  });

  it("gives the platform exactly the booking fee plus 30% of the eligible fare", () => {
    const scenarios = [
      { miles: 5, minutes: 15, ride_type: "standard" },
      { miles: 10, minutes: 20, ride_type: "airport" },
      { miles: 5, minutes: 15, ride_type: "medical" },
      { miles: 0, minutes: 0, ride_type: "standard" }
    ];

    for (const input of scenarios) {
      const estimate = calculateRideEstimate(input);
      const eligibleFareForPayout = estimate.total - estimate.booking_fee;
      const expectedPlatformFee = estimate.booking_fee + eligibleFareForPayout * 0.3;

      expect(estimate.platform_fee).toBeCloseTo(expectedPlatformFee, 2);
      expect(estimate.driver_payout + estimate.platform_fee).toBeCloseTo(estimate.total, 2);
    }
  });

  it("treats an unparseable/negative distance as zero rather than throwing or going negative", () => {
    const estimate = calculateRideEstimate({ miles: -5, minutes: -10, ride_type: "standard" });

    expect(estimate.miles).toBe(0);
    expect(estimate.minutes).toBe(0);
    expect(estimate.total).toBe(8);
  });
});

describe("calculateRideEstimate — food/grocery delivery pricing", () => {
  it("uses a distinct delivery fee model instead of the passenger taxi formula", () => {
    for (const ride_type of ["food", "grocery"]) {
      const estimate = calculateRideEstimate({ miles: 5, minutes: 15, ride_type });

      expect(estimate.is_delivery).toBe(true);
      expect(estimate.delivery_fee).toBeGreaterThan(0);
      expect(estimate.delivery_distance_charge).toBeGreaterThan(0);

      // The passenger-only fields must stay at 0 for a delivery — a
      // delivery is never charged for drive time the way a passenger ride
      // is (nobody is sitting in the car), and shouldn't carry a
      // "base fare" meant for a passenger pickup.
      expect(estimate.base_fare).toBe(0);
      expect(estimate.distance_charge).toBe(0);
      expect(estimate.time_charge).toBe(0);
    }
  });

  it("never charges a delivery for drive time (regression: used to silently reuse the taxi formula)", () => {
    const shortTrip = calculateRideEstimate({ miles: 5, minutes: 5, ride_type: "food" });
    const longTrip = calculateRideEstimate({ miles: 5, minutes: 60, ride_type: "food" });

    // Same distance, wildly different duration — a real delivery fee
    // shouldn't move at all based on minutes, unlike a passenger fare.
    expect(longTrip.total).toBe(shortTrip.total);
  });

  it("still charges standard/airport/scheduled rides using the passenger formula, unaffected by the delivery model", () => {
    const estimate = calculateRideEstimate({ miles: 5, minutes: 15, ride_type: "standard" });

    expect(estimate.is_delivery).toBe(false);
    expect(estimate.delivery_fee).toBe(0);
    expect(estimate.delivery_distance_charge).toBe(0);
    expect(estimate.time_charge).toBeGreaterThan(0);
  });

  it("still excludes the booking fee from the driver's split on a delivery", () => {
    const estimate = calculateRideEstimate({ miles: 5, minutes: 15, ride_type: "food" });
    const eligibleFareForPayout = estimate.total - estimate.booking_fee;

    expect(estimate.driver_payout).toBeCloseTo(eligibleFareForPayout * 0.7, 2);
    expect(estimate.platform_fee).toBeCloseTo(estimate.booking_fee + eligibleFareForPayout * 0.3, 2);
  });
});

describe("envNumber (via calculateRideEstimate's rate constants)", () => {
  it("does not silently zero out pricing rates when env vars are unset", () => {
    // Regression test for the Number("") === 0 trap: envNumber() used to
    // return 0 instead of its fallback whenever the corresponding env var
    // was unset, because Number("") is 0, not NaN, so a naive
    // Number.isFinite() check could never tell "unset" apart from
    // "explicitly zero". With no BASE_FARE/PER_MILE_RATE/etc. env vars
    // set in this test process, every rate below must fall back to its
    // real dollar-amount default, not 0.
    const estimate = calculateRideEstimate({ miles: 5, minutes: 15, ride_type: "standard" });

    expect(estimate.base_fare).toBeGreaterThan(0);
    expect(estimate.distance_charge).toBeGreaterThan(0);
    expect(estimate.time_charge).toBeGreaterThan(0);
    expect(estimate.booking_fee).toBeGreaterThan(0);
    expect(estimate.total).toBeGreaterThan(0);
    expect(estimate.driver_payout).toBeGreaterThan(0);
  });
});

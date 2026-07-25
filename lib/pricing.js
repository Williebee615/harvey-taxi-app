// Harvey Taxi's single pricing engine — every service (taxi, scheduled,
// airport, HTAF) computes its fare here so there is exactly one place
// this math can be wrong. Kept dependency-free (no Supabase, no Express)
// so it's requirable directly by tests, same as lib/rideDispatch.js.
//
// Rates are read from env vars once at require-time, with the same
// defaults server.js has always used, so behavior is unchanged for any
// deployment that hasn't set these explicitly.

function envNumber(name, fallback) {
  // Checking the raw env var directly — not via a string helper that
  // defaults to "" — matters here: Number("") is 0, not NaN, so a naive
  // Number.isFinite() check can never distinguish "unset" from
  // "explicitly 0", and would silently zero out every pricing rate
  // whenever its env var isn't set. See server.js's envNumber() for the
  // same fix applied to the rest of the app's env-configurable numbers.
  const raw = process.env[name];

  if (raw === undefined || raw === null || String(raw).trim() === "") {
    return fallback;
  }

  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

const BASE_FARE = envNumber("BASE_FARE", 5);
const PER_MILE_RATE = envNumber("PER_MILE_RATE", 0.90);
const PER_MINUTE_RATE = envNumber("PER_MINUTE_RATE", 0.35);
const BOOKING_FEE = envNumber("BOOKING_FEE", 2.00);
const MINIMUM_FARE = envNumber("MINIMUM_FARE", 8);
const DRIVER_PAYOUT_PERCENT = envNumber("DRIVER_PAYOUT_PERCENT", 0.70);

// Computes a full fare breakdown for one trip. Every service type
// (taxi/scheduled/airport/HTAF) calls this same function with a
// ride_type string — nothing calculates its own fare independently.
//
// Booking fee accounting: the $2 booking fee is a flat platform charge.
// It is deliberately kept OUT of eligible_fare, so it is never discounted
// (HTAF/medical) and never split with the driver — the driver's 70% share
// only ever applies to base fare + distance + time + any surcharge, minus
// any discount. Harvey Taxi's platform_fee is therefore always exactly
// booking_fee + 30% of the eligible fare, including when the minimum-fare
// floor applies (eligibleFareForPayout is derived from the floored total,
// not the pre-floor subtotal, so the split stays consistent either way).
function calculateRideEstimate({ miles = 0, minutes = 0, ride_type = "standard" }) {
  const safeMiles = Math.max(0, toNumber(miles));
  const safeMinutes = Math.max(0, toNumber(minutes));

  const base_fare = BASE_FARE;
  const distance_charge = safeMiles * PER_MILE_RATE;
  const time_charge = safeMinutes * PER_MINUTE_RATE;
  const booking_fee = BOOKING_FEE;

  let eligible_fare = base_fare + distance_charge + time_charge;

  let discount_amount = 0;
  if (ride_type === "medical" || ride_type === "foundation") {
    const discounted = eligible_fare * 0.95;
    discount_amount = eligible_fare - discounted;
    eligible_fare = discounted;
  }

  let surcharge_amount = 0;
  if (ride_type === "airport") {
    surcharge_amount = 5;
    eligible_fare += surcharge_amount;
  }

  // Rounded once, up front, so the minimum-fare comparison below can't be
  // thrown off by floating-point cents (e.g. a 0.95 discount multiplier
  // landing on 16.0125) — comparing an unrounded total against a rounded
  // one previously made minimum_fare_applied report true even when the
  // floor never actually kicked in.
  const preFloorTotal = Number((eligible_fare + booking_fee).toFixed(2));
  const total = Math.max(MINIMUM_FARE, preFloorTotal);
  const minimum_fare_applied = total > preFloorTotal;

  // Deriving the payout base from the floored total (not eligible_fare
  // directly) means a minimum-fare top-up is treated as extra eligible
  // fare rather than extra booking fee — the driver still gets 70% of it.
  const eligibleFareForPayout = total - booking_fee;
  const driver_payout = eligibleFareForPayout * DRIVER_PAYOUT_PERCENT;
  const platform_fee = total - driver_payout;

  return {
    miles: Number(safeMiles.toFixed(2)),
    minutes: Number(safeMinutes.toFixed(0)),
    currency: "USD",
    base_fare: Number(base_fare.toFixed(2)),
    distance_charge: Number(distance_charge.toFixed(2)),
    time_charge: Number(time_charge.toFixed(2)),
    booking_fee: Number(booking_fee.toFixed(2)),
    discount_amount: Number(discount_amount.toFixed(2)),
    surcharge_amount: Number(surcharge_amount.toFixed(2)),
    minimum_fare_applied,
    total: Number(total.toFixed(2)),
    driver_payout: Number(driver_payout.toFixed(2)),
    platform_fee: Number(platform_fee.toFixed(2))
  };
}

module.exports = {
  BASE_FARE,
  PER_MILE_RATE,
  PER_MINUTE_RATE,
  BOOKING_FEE,
  MINIMUM_FARE,
  DRIVER_PAYOUT_PERCENT,
  calculateRideEstimate
};

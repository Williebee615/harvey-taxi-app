// Harvey Taxi's single pricing engine — every service (taxi, scheduled,
// airport, HTAF, food, grocery) computes its fare here so there is
// exactly one place this math can be wrong. Kept dependency-free (no
// Supabase, no Express) so it's requirable directly by tests, same as
// lib/rideDispatch.js.
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

function isDeliveryRideType(rideType) {
  return rideType === "food" || rideType === "grocery";
}

// Server-side half of "no valid route + no verified fare = no payment and
// no dispatch." The rider-dashboard.html wizard already refuses to call
// the server at all until Google Maps has resolved a real driving
// distance (see ensureTripDistance() there) — but that is a client-side
// gate a direct API call bypasses trivially. Any route that turns
// miles/minutes into money (estimate, payment-intent, ride request) must
// call this first and reject the request outright rather than silently
// falling back to calculateRideEstimate()'s own miles=0/minutes=0
// defaults, which price a real trip at the flat minimum fare.
function hasValidTripDistance({ miles, minutes } = {}) {
  const safeMiles = Number(miles);
  const safeMinutes = Number(minutes);

  return (
    Number.isFinite(safeMiles) &&
    safeMiles > 0 &&
    Number.isFinite(safeMinutes) &&
    safeMinutes >= 0
  );
}

const BASE_FARE = envNumber("BASE_FARE", 5);
const PER_MILE_RATE = envNumber("PER_MILE_RATE", 0.90);
const PER_MINUTE_RATE = envNumber("PER_MINUTE_RATE", 0.35);
const BOOKING_FEE = envNumber("BOOKING_FEE", 2.00);
const MINIMUM_FARE = envNumber("MINIMUM_FARE", 8);
const DRIVER_PAYOUT_PERCENT = envNumber("DRIVER_PAYOUT_PERCENT", 0.70);

// Food/grocery had been reusing the passenger taxi formula verbatim —
// including PER_MINUTE_RATE, which charges for drive time as though a
// person were being driven. That's the most straightforwardly wrong part
// of treating a delivery like a ride, so it's the one this interim model
// actually removes. DELIVERY_FEE/DELIVERY_PER_MILE_RATE default to the
// same dollar amounts as their passenger equivalents (BASE_FARE/
// PER_MILE_RATE) so a deployment that hasn't set these new env vars sees
// the same total it would have gotten minus the (removed) time charge —
// not a sudden unrelated price jump — while still being independently
// configurable going forward.
//
// Explicitly NOT attempted here: merchant fee, heavy-item fee, service
// fee, item-level promotions. None of those have any data model to be
// honest about yet (no cart, no per-item pricing, no "heavy item" flag
// anywhere in the app) — inventing numbers for them would be exactly the
// kind of "knowingly wrong" pricing this fix exists to stop. That's real
// Phase 2 pricing-engine scope once the product features under it exist.
const DELIVERY_FEE = envNumber("DELIVERY_FEE", BASE_FARE);
const DELIVERY_PER_MILE_RATE = envNumber("DELIVERY_PER_MILE_RATE", PER_MILE_RATE);

// Computes a full fare breakdown for one trip. Every service type
// (taxi/scheduled/airport/HTAF/food/grocery) calls this same function
// with a ride_type string — nothing calculates its own fare
// independently.
//
// Booking fee accounting: the $2 booking fee is a flat platform charge.
// It is deliberately kept OUT of eligible_fare, so it is never discounted
// (HTAF/medical) and never split with the driver — the driver's 70% share
// only ever applies to the eligible fare (passenger: base + distance +
// time; delivery: delivery fee + delivery distance), plus any surcharge,
// minus any discount. Harvey Taxi's platform_fee is therefore always
// exactly booking_fee + 30% of the eligible fare, including when the
// minimum-fare floor applies (eligibleFareForPayout is derived from the
// floored total, not the pre-floor subtotal, so the split stays
// consistent either way).
function calculateRideEstimate({ miles = 0, minutes = 0, ride_type = "standard" }) {
  const safeMiles = Math.max(0, toNumber(miles));
  const safeMinutes = Math.max(0, toNumber(minutes));
  const isDelivery = isDeliveryRideType(ride_type);

  const booking_fee = BOOKING_FEE;

  // Passenger fields stay 0 for a delivery, and vice versa, rather than
  // overloading one set of field names to mean different things depending
  // on ride_type — a client or report reading base_fare should always be
  // able to trust it means "passenger base fare," not sometimes that and
  // sometimes a delivery fee in disguise.
  const base_fare = isDelivery ? 0 : BASE_FARE;
  const distance_charge = isDelivery ? 0 : safeMiles * PER_MILE_RATE;
  const time_charge = isDelivery ? 0 : safeMinutes * PER_MINUTE_RATE;
  const delivery_fee = isDelivery ? DELIVERY_FEE : 0;
  const delivery_distance_charge = isDelivery ? safeMiles * DELIVERY_PER_MILE_RATE : 0;

  let eligible_fare =
    base_fare + distance_charge + time_charge + delivery_fee + delivery_distance_charge;

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
    is_delivery: isDelivery,
    base_fare: Number(base_fare.toFixed(2)),
    distance_charge: Number(distance_charge.toFixed(2)),
    time_charge: Number(time_charge.toFixed(2)),
    delivery_fee: Number(delivery_fee.toFixed(2)),
    delivery_distance_charge: Number(delivery_distance_charge.toFixed(2)),
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
  DELIVERY_FEE,
  DELIVERY_PER_MILE_RATE,
  isDeliveryRideType,
  hasValidTripDistance,
  calculateRideEstimate
};

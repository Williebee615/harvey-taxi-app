// Harvey Taxi AI Agent Manager -- driver recommendations.
//
// Pure ranking over rows server.js has already read. It mirrors, and never
// loosens, the rules the real dispatcher applies (server.js
// findAvailableDrivers() + dispatchRide() + dispatch_ride_atomic()):
// online/active/approved, not revoked, not busy on another active ride,
// not previously offered this ride, compliance-ready, and the Google Play
// reviewer-account isolation. On top of those it adds the service
// capability columns the live drivers table already carries
// (supports_rides / supports_food_delivery / supports_grocery_delivery),
// location freshness, and rating as a tie-breaker.
//
// A recommendation is advice. Producing one never writes anything; only
// an admin action, or the separately gated automation path (which calls
// the existing dispatchRide()), can act on it.

const { computeDriverReadiness } = require("../driverCompliance");
const { isDeliveryRideType } = require("../pricing");
const { DEFAULT_RULES } = require("./policy");

const EARTH_RADIUS_MILES = 3958.8;

function toNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function distanceMiles(lat1, lng1, lat2, lng2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.min(1, Math.sqrt(a)));
}

function driverCoordinates(driver) {
  const lat = toNumber(driver.current_lat ?? driver.latitude);
  const lng = toNumber(driver.current_lng ?? driver.longitude);
  return lat === null || lng === null ? null : { lat, lng };
}

// Display label only: first name + last initial. Phone, email and exact
// coordinates are deliberately left out of recommendation output.
function driverLabel(driver) {
  const first = String(driver.first_name || driver.full_name || driver.name || "Driver").trim().split(/\s+/)[0];
  const last = String(driver.last_name || "").trim();
  return last ? `${first} ${last[0]}.` : first;
}

function requiredCapability(ride) {
  const type = String(ride.ride_type || ride.service_type || "standard").toLowerCase();
  if (type === "food") return "supports_food_delivery";
  if (type === "grocery") return "supports_grocery_delivery";
  return isDeliveryRideType(type) ? null : "supports_rides";
}

function evaluateDriver(driver, ctx) {
  const reasons = [];
  const flags = [];
  const id = String(driver.id);

  const online = driver.online === true || driver.is_online === true;
  if (!online) reasons.push("offline");
  if (String(driver.status || "").toLowerCase() !== "active") reasons.push("not_active");
  if (String(driver.approval_status || "").toLowerCase() !== "approved") reasons.push("not_approved");
  if (driver.access_revoked || driver.is_blocked || driver.is_disabled || driver.deleted_at) {
    reasons.push("access_restricted");
  }

  // Reviewer isolation, same two-way rule as planReviewAwareDispatch().
  if (ctx.isReviewRide && !driver.is_review_account) reasons.push("review_ride_isolation");
  if (!ctx.isReviewRide && driver.is_review_account) reasons.push("review_account");

  if (ctx.busy.has(id)) reasons.push("on_active_ride");
  if (ctx.offered.has(id)) reasons.push("already_offered");

  const readiness = computeDriverReadiness(driver, ctx.complianceOptions);
  if (!readiness.ready) reasons.push("compliance_not_ready");

  if (ctx.capability && driver[ctx.capability] === false) {
    reasons.push(`missing_${ctx.capability}`);
  } else if (ctx.capability && driver[ctx.capability] !== true && ctx.capability !== "supports_rides") {
    // Delivery needs an explicit opt-in; passenger rides only exclude an
    // explicit false, matching today's dispatcher (which ignores the column).
    reasons.push(`missing_${ctx.capability}`);
  }

  const coords = driverCoordinates(driver);
  let distance = null;
  if (!coords) {
    reasons.push("no_location");
  } else if (ctx.pickup) {
    distance = distanceMiles(ctx.pickup.lat, ctx.pickup.lng, coords.lat, coords.lng);
    if (distance > ctx.rules.recommendation_radius_miles) reasons.push("outside_radius");
  }

  const seenAt = Date.parse(driver.last_location_at || driver.last_seen_at || "");
  if (Number.isFinite(seenAt)) {
    const ageMinutes = (ctx.now - seenAt) / 60000;
    if (ageMinutes > ctx.rules.max_location_age_minutes) reasons.push("stale_location");
  } else {
    flags.push("location_age_unknown");
  }

  const rating = toNumber(driver.rating);
  if (rating !== null && rating < ctx.rules.min_driver_rating) flags.push("rating_below_threshold");

  return {
    driver_id: id,
    label: driverLabel(driver),
    eligible: reasons.length === 0,
    reasons,
    flags,
    distance_miles: distance === null ? null : Number(distance.toFixed(2)),
    rating,
    acceptance_rate: toNumber(driver.acceptance_rate)
  };
}

// ride: the ride row. drivers: candidate driver rows. busyDriverIds: from
// getBusyDriverIds(). offeredDriverIds: driver_offers.driver_id for this
// ride. Returns ranked eligible candidates plus every exclusion and why.
function recommendDrivers({
  ride,
  drivers,
  busyDriverIds = [],
  offeredDriverIds = [],
  rules = DEFAULT_RULES,
  complianceOptions = { enablePersona: true, enableCheckr: true },
  now = Date.now()
}) {
  const merged = { ...DEFAULT_RULES, ...(rules || {}) };
  const pickupLat = toNumber(ride && ride.pickup_lat);
  const pickupLng = toNumber(ride && ride.pickup_lng);
  const pickup = pickupLat === null || pickupLng === null ? null : { lat: pickupLat, lng: pickupLng };

  const ctx = {
    rules: merged,
    pickup,
    now,
    isReviewRide: Boolean(ride && ride.is_review_ride),
    busy: new Set((busyDriverIds || []).map(String)),
    offered: new Set((offeredDriverIds || []).map(String)),
    capability: requiredCapability(ride || {}),
    complianceOptions
  };

  const evaluated = (drivers || []).filter(Boolean).map((d) => evaluateDriver(d, ctx));
  const eligible = evaluated
    .filter((e) => e.eligible)
    .sort((a, b) => {
      const da = a.distance_miles ?? Infinity;
      const db = b.distance_miles ?? Infinity;
      if (da !== db) return da - db;
      return (b.rating ?? 0) - (a.rating ?? 0);
    })
    .slice(0, merged.max_candidates);

  return {
    ride_id: ride && ride.id ? String(ride.id) : null,
    pickup_known: Boolean(pickup),
    required_capability: ctx.capability,
    eligible,
    excluded: evaluated.filter((e) => !e.eligible).map(({ driver_id, label, reasons }) => ({ driver_id, label, reasons })),
    basis: [
      "online, active and approved",
      "not on another active ride",
      "not previously offered this ride",
      "compliance checks ready",
      ctx.capability ? `service capability: ${ctx.capability}` : null,
      `within ${merged.recommendation_radius_miles} miles of pickup`,
      `location updated within ${merged.max_location_age_minutes} minutes`,
      "ranked by distance, then rating"
    ].filter(Boolean),
    // Confirmed gaps (docs/ai-agent-manager.md section 1): there is no
    // vehicle-type or accessibility data, and the dormant preferred_drivers
    // table / drivers.preferred_score hold no data and are not approved for
    // use, so neither is considered.
    unsupported_inputs: ["rider_preferences", "vehicle_type_requirements"]
  };
}

// A paid ride with no driver and no live offer, waiting longer than the
// stalled threshold, and not scheduled for later.
function isStalledRide(ride, { pendingOfferRideIds = new Set(), rules = DEFAULT_RULES, now = Date.now() } = {}) {
  if (!ride || ride.driver_id) return false;
  if (String(ride.status) !== "payment_authorized") return false;
  if (ride.is_review_ride) return false;
  // Already being handled: a pause (resume-dispatch picks it up) or the
  // offer-expiry sweep's own redispatch claim.
  if (["paused", "redispatching"].includes(String(ride.dispatch_status || ""))) return false;
  if (ride.scheduled_time) {
    const at = Date.parse(ride.scheduled_time);
    if (Number.isFinite(at) && at > now) return false;
  }
  if (pendingOfferRideIds.has(String(ride.id))) return false;
  const since = Date.parse(ride.updated_at || ride.created_at || "");
  if (!Number.isFinite(since)) return false;
  return (now - since) / 60000 >= ({ ...DEFAULT_RULES, ...rules }).stalled_ride_minutes;
}

module.exports = {
  distanceMiles,
  driverLabel,
  requiredCapability,
  recommendDrivers,
  isStalledRide
};

// Standalone App Review demonstrations (docs/app-review-demo.md).
//
// Off unless the system flag review_demo_autopilot_enabled is "true".
// Only ever touches review rides (rides.is_review_ride, set from a
// server-verified reviewer session or by the server itself here) and only
// the review driver account. No payment: review rides are created with
// payment_status not_required and never reach Stripe.
//
//   Rider demo ("autopilot"): a reviewer ride that no review driver takes
//   -- the review driver is offline, busy, or lets the offer expire -- is
//   driven by a simulated driver, one stage every 25 seconds:
//   assigned -> on the way -> arrived -> trip started -> completed.
//   Each stage is an atomic status claim, so a cancellation (or any other
//   change) stops it. No driver row is involved and no earnings are made.
//
//   Driver demo ("auto_offer"): the review driver, online and idle for 20
//   seconds with no open review ride anywhere, is offered one simulated
//   ride (no rider account) through the normal offer flow; the driver
//   accepts and completes it with the app's own buttons. An offer that
//   expires cancels that simulated ride.
//
//   Connected test: unchanged. A reviewer ride offered to an online review
//   driver who accepts it runs exactly as before; a pending simulated
//   offer is withdrawn when the rider reviewer books.
//
// Pure functions only: no database, no network, no clock of its own.

const STAGE_MS = 25 * 1000;
const IDLE_MS = 20 * 1000;
// Any open demo ride untouched this long is cancelled (review rides only).
const STALE_MS = 30 * 60 * 1000;

const FLAG = "review_demo_autopilot_enabled";

const OPEN_STATUSES = Object.freeze([
  "payment_authorized",
  "awaiting_driver_acceptance",
  "driver_assigned",
  "driver_enroute",
  "arrived",
  "in_progress"
]);

// The simulated driver's next step from each stage, and the timestamp the
// real driver routes write for it.
const NEXT_STAGE = Object.freeze({
  driver_assigned: { to: "driver_enroute", field: "enroute_at" },
  driver_enroute: { to: "arrived", field: "arrived_at" },
  arrived: { to: "in_progress", field: "trip_started_at" },
  in_progress: { to: "completed", field: "completed_at" }
});

const SIMULATED_DRIVER = Object.freeze({
  name: "Simulated driver",
  vehicle: "Demo vehicle (simulated)"
});

// The driver demo's ride: fixed downtown Nashville addresses, clearly
// labelled, no rider account.
const DEMO_TRIP = Object.freeze({
  pickup_address: "Demo pickup (simulated): 1 Public Square, Nashville, TN 37201",
  dropoff_address: "Demo destination (simulated): 600 Broadway, Nashville, TN 37203",
  pickup_lat: 36.1676,
  pickup_lng: -86.7794,
  dropoff_lat: 36.1597,
  dropoff_lng: -86.7804,
  miles: 1.2,
  minutes: 6,
  rider_name: "Demo rider (simulated)"
});

const ms = (v) => {
  const t = v ? new Date(v).getTime() : NaN;
  return Number.isFinite(t) ? t : null;
};
const iso = (t) => new Date(t).toISOString();

function isOpen(ride) {
  return Boolean(ride) && OPEN_STATUSES.includes(ride.status);
}

// The patch that hands a reviewer ride to the simulated driver.
function autopilotStartPatch({ now }) {
  return {
    review_demo: "autopilot",
    dispatch_status: "review_demo",
    driver_id: null,
    driver_name: SIMULATED_DRIVER.name,
    driver_vehicle: SIMULATED_DRIVER.vehicle,
    driver_phone: null,
    accepted_at: iso(now),
    // Shown as the pickup ETA: two stages (on the way, arrived).
    driver_eta_to_pickup_minutes: Math.ceil((2 * STAGE_MS) / 60000),
    review_demo_next_at: iso(now + STAGE_MS),
    updated_at: iso(now)
  };
}

// The next autopilot stage for a ride, if it is due. Null when not an
// autopilot ride, not due, or nothing follows.
function dueStage(ride, now) {
  if (!ride || ride.review_demo !== "autopilot") return null;
  const step = NEXT_STAGE[ride.status];
  const due = ms(ride.review_demo_next_at);
  if (!step || due === null || now < due) return null;
  const completing = step.to === "completed";
  const patch = {
    [step.field]: iso(now),
    review_demo_next_at: completing ? null : iso(now + STAGE_MS),
    updated_at: iso(now)
  };
  if (completing) {
    const fare = Number(ride.estimated_fare);
    if (Number.isFinite(fare)) patch.final_fare = fare;
  }
  return { from: ride.status, to: step.to, patch };
}

function lerp(a, b, f) {
  return a + (b - a) * f;
}

// Where the simulated driver is now: approaching the pickup from about
// 1 km north while assigned / on the way, at the pickup once arrived, and
// moving toward the destination during the trip. Always flagged simulated.
function simulatedPosition(ride, now) {
  if (!ride || ride.review_demo !== "autopilot") return null;
  const pLat = Number(ride.pickup_lat);
  const pLng = Number(ride.pickup_lng);
  if (!Number.isFinite(pLat) || !Number.isFinite(pLng)) return null;
  const dLat = Number(ride.dropoff_lat);
  const dLng = Number(ride.dropoff_lng);
  const due = ms(ride.review_demo_next_at);
  const stageStart = due === null ? now : due - STAGE_MS;
  const f = Math.min(1, Math.max(0, (now - stageStart) / STAGE_MS));
  const start = { lat: pLat + 0.009, lng: pLng };
  let pos;
  if (ride.status === "driver_assigned") pos = { lat: lerp(start.lat, pLat, f * 0.3), lng: pLng };
  else if (ride.status === "driver_enroute") pos = { lat: lerp(start.lat, pLat, 0.3 + f * 0.7), lng: pLng };
  else if (ride.status === "arrived") pos = { lat: pLat, lng: pLng };
  else if (ride.status === "in_progress" && Number.isFinite(dLat) && Number.isFinite(dLng)) pos = { lat: lerp(pLat, dLat, f), lng: lerp(pLng, dLng, f) };
  else return null;
  return {
    lat: Math.round(pos.lat * 1e6) / 1e6,
    lng: Math.round(pos.lng * 1e6) / 1e6,
    accuracy_meters: null,
    last_seen_at: iso(now),
    stale: false,
    simulated: true,
    label: "Simulated location"
  };
}

// Seconds of the current stage left (for an ETA the rider sees).
function secondsToNextStage(ride, now) {
  const due = ms(ride && ride.review_demo_next_at);
  return due === null ? null : Math.max(0, Math.round((due - now) / 1000));
}

// Should the review driver get a simulated offer now?
//   driver: the review driver row; activeRide / pendingOffer: theirs;
//   openReviewRide: any open review ride at all (rider's or demo);
//   idleSinceMs: latest of going online, their last offer, their last ride.
function shouldAutoOffer({ enabled, driver, activeRide, pendingOffer, openReviewRide, idleSinceMs, now }) {
  if (!enabled) return { ok: false, reason: "disabled" };
  if (!driver || driver.is_review_account !== true) return { ok: false, reason: "no_review_driver" };
  if (driver.online !== true) return { ok: false, reason: "offline" };
  if (activeRide) return { ok: false, reason: "driver_busy" };
  if (pendingOffer) return { ok: false, reason: "offer_pending" };
  if (openReviewRide) return { ok: false, reason: "review_ride_open" };
  if (idleSinceMs === null || idleSinceMs === undefined) return { ok: false, reason: "idle_unknown" };
  if (now - idleSinceMs < IDLE_MS) return { ok: false, reason: "not_idle_long_enough" };
  return { ok: true, reason: null };
}

// The simulated ride offered to the review driver.
function demoRideForDriver({ id, estimate, now }) {
  return {
    id,
    rider_id: null,
    rider_name: DEMO_TRIP.rider_name,
    rider_phone: null,
    is_review_ride: true,
    review_demo: "auto_offer",
    payment_status: "not_required",
    status: "payment_authorized",
    dispatch_status: "ready_to_dispatch",
    ride_type: "standard",
    pickup_address: DEMO_TRIP.pickup_address,
    dropoff_address: DEMO_TRIP.dropoff_address,
    pickup_lat: DEMO_TRIP.pickup_lat,
    pickup_lng: DEMO_TRIP.pickup_lng,
    dropoff_lat: DEMO_TRIP.dropoff_lat,
    dropoff_lng: DEMO_TRIP.dropoff_lng,
    estimated_distance_miles: DEMO_TRIP.miles,
    estimated_duration_minutes: DEMO_TRIP.minutes,
    estimated_fare: estimate ? estimate.total : null,
    driver_payout: estimate ? estimate.driver_payout : null,
    notes: "App Review demonstration ride (simulated). No rider, no payment.",
    created_at: iso(now),
    updated_at: iso(now)
  };
}

function isStale(ride, now) {
  const t = ms(ride && ride.updated_at);
  return isOpen(ride) && t !== null && now - t > STALE_MS;
}

module.exports = {
  FLAG,
  STAGE_MS,
  IDLE_MS,
  STALE_MS,
  OPEN_STATUSES,
  NEXT_STAGE,
  SIMULATED_DRIVER,
  DEMO_TRIP,
  isOpen,
  isStale,
  autopilotStartPatch,
  dueStage,
  simulatedPosition,
  secondsToNextStage,
  shouldAutoOffer,
  demoRideForDriver
};

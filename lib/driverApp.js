// Pure decision logic for the Harvey Taxi Driver native app
// (docs/driver-app.md). No I/O: server.js and lib/driverAppRoutes.js do the
// Supabase/Twilio/Expo calls and pass the loaded rows in, the same split
// as lib/driverCompliance.js.
//
// Every decision here is made from rows the server loaded for the
// authenticated driver. Nothing accepts a client-supplied role, driver id,
// "is driver app" flag or review-account flag.

const { riderLocationForDriver } = require("./liveLocation");

/* ---------------------------------------------------------------
   Phone sign-in
--------------------------------------------------------------- */

function phoneDigits(raw) {
  return String(raw ?? "").replace(/\D/g, "");
}

// U.S. numbers only, matching how drivers are onboarded: the last ten
// digits, accepting an optional leading country code 1.
function phoneLast10(raw) {
  const digits = phoneDigits(raw);
  if (digits.length === 10) return digits;
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  return "";
}

// A LIKE pattern matching these ten digits with any formatting between
// them ("(615) 555-0201", "+1 615-555-0201", ...). The exact comparison
// happens afterwards in selectDriverForPhone.
function phoneLikePattern(last10) {
  return `%${String(last10).split("").join("%")}`;
}

function isActiveDriverRow(row) {
  return Boolean(
    row &&
      row.access_revoked !== true &&
      !row.deleted_at &&
      row.is_blocked !== true &&
      row.is_disabled !== true
  );
}

// Phone formats in the drivers table vary, so the database lookup is a
// suffix match and this narrows it: exact ten-digit match, active rows
// only, and exactly one survivor. Two active drivers sharing a number is
// ambiguous; signing in as either would be wrong, so neither is chosen.
function selectDriverForPhone(rows, last10) {
  if (!last10) return { driver: null, matchCount: 0 };
  const matches = (rows || []).filter(
    (row) => isActiveDriverRow(row) && phoneLast10(row.phone) === last10
  );
  return { driver: matches.length === 1 ? matches[0] : null, matchCount: matches.length };
}

/* ---------------------------------------------------------------
   Driver state snapshot
--------------------------------------------------------------- */

const ACTIVE_RIDE_STATUSES = Object.freeze(["driver_assigned", "driver_enroute", "arrived", "in_progress"]);

// Polling hints the app follows when its real-time stream is down. With a
// healthy stream the app only reconciles every RECONCILE_MS.
const POLL_MS = Object.freeze({
  offline: 0, // no polling at all while offline
  onlineIdle: 30_000,
  offerPending: 5_000,
  onTrip: 15_000
});
const RECONCILE_MS = 60_000;

// A pending offer outranks being offline: a driver who switched off with
// an offer still on screen can still answer it until it expires.
function driverMode({ online, offers, activeRide }) {
  if (activeRide) return "on_trip";
  if (offers && offers.length) return "offer_pending";
  if (!online) return "offline";
  return "online_idle";
}

function pollIntervalFor(mode) {
  switch (mode) {
    case "on_trip":
      return POLL_MS.onTrip;
    case "offer_pending":
      return POLL_MS.offerPending;
    case "online_idle":
      return POLL_MS.onlineIdle;
    default:
      return POLL_MS.offline;
  }
}

// What a driver may see about an offer before accepting it: where and
// roughly how much, never the rider's name or phone number.
function shapeOffer(offer, ride, nowMs = Date.now()) {
  const expiresMs = Date.parse(offer.expires_at || "");
  return {
    offer_id: offer.id,
    ride_id: offer.ride_id,
    expires_at: offer.expires_at || null,
    seconds_left: Number.isFinite(expiresMs) ? Math.max(0, Math.round((expiresMs - nowMs) / 1000)) : null,
    ride_type: ride?.ride_type || ride?.service_type || "standard",
    pickup_address: ride?.pickup_address || null,
    dropoff_address: ride?.dropoff_address || null,
    pickup_lat: numberOrNull(ride?.pickup_lat),
    pickup_lng: numberOrNull(ride?.pickup_lng),
    estimated_fare: numberOrNull(ride?.estimated_fare ?? ride?.fare),
    estimated_payout: numberOrNull(ride?.driver_payout),
    distance_miles: numberOrNull(ride?.distance_miles ?? ride?.estimated_distance_miles),
    eta_to_pickup_minutes: numberOrNull(ride?.driver_eta_to_pickup_minutes),
    is_review_ride: ride?.is_review_ride === true
  };
}

// The assigned ride: what the driver needs to reach and contact the rider.
// rider_location is the rider's own phone position, present only while the
// rider is sharing it and only until pickup (lib/liveLocation.js).
function shapeActiveRide(ride, nowMs = Date.now()) {
  if (!ride) return null;
  return {
    ride_id: ride.id,
    status: ride.status,
    ride_type: ride.ride_type || ride.service_type || "standard",
    pickup_address: ride.pickup_address || null,
    dropoff_address: ride.dropoff_address || null,
    pickup_lat: numberOrNull(ride.pickup_lat),
    pickup_lng: numberOrNull(ride.pickup_lng),
    dropoff_lat: numberOrNull(ride.dropoff_lat),
    dropoff_lng: numberOrNull(ride.dropoff_lng),
    rider_first_name: firstName(ride.rider_name),
    rider_phone: ride.rider_phone || null,
    estimated_fare: numberOrNull(ride.estimated_fare ?? ride.fare),
    notes: ride.notes || null,
    is_review_ride: ride.is_review_ride === true,
    rider_location: riderLocationForDriver(ride, nowMs),
    // Pickup records (lib/cancellationRecords.js): the waiting timer and
    // what the no-show control still needs.
    arrived_at: ride.arrived_at || null,
    arrival_verified: ride.arrival_verified === true ? true : ride.arrival_verified === false ? false : null,
    contact_attempt_count: Number(ride.contact_attempt_count) || 0,
    updated_at: ride.updated_at || null
  };
}

function firstName(full) {
  const text = String(full || "").trim();
  return text ? text.split(/\s+/)[0] : null;
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/* ---------------------------------------------------------------
   Location policy
--------------------------------------------------------------- */

// When the server accepts a location update:
//   on a trip          -> stored, and streamed to that ride's rider
//   online, no trip    -> stored only (keeps dispatch's position current)
//   offline, no trip   -> refused; the app must not be tracking then
function locationPolicy({ driver, activeRide }) {
  if (activeRide) return "trip";
  if (driver && driver.online === true) return "online_idle";
  return "reject";
}

/* ---------------------------------------------------------------
   Pagination (history and earnings)
--------------------------------------------------------------- */

const PAGE_DEFAULT = 20;
const PAGE_MAX = 50;

// Returns null when the caller asked for no paging, so existing clients
// keep their exact current response.
function parsePageQuery(query) {
  const q = query || {};
  if (q.limit === undefined && q.before === undefined) return null;
  const n = Number.parseInt(q.limit, 10);
  const limit = Number.isFinite(n) ? Math.min(Math.max(n, 1), PAGE_MAX) : PAGE_DEFAULT;
  let before = null;
  if (q.before !== undefined && q.before !== "") {
    const t = Date.parse(String(q.before));
    if (!Number.isFinite(t)) return { error: "before must be an ISO timestamp." };
    before = new Date(t).toISOString();
  }
  return { limit, before };
}

// Fetch limit + 1 rows; this trims the extra and says where the next page starts.
function pageResult(rows, limit, cursorField) {
  const list = rows || [];
  const hasMore = list.length > limit;
  const page = hasMore ? list.slice(0, limit) : list;
  return {
    items: page,
    next_before: hasMore && page.length ? page[page.length - 1][cursorField] || null : null
  };
}

/* ---------------------------------------------------------------
   Native push (Expo push service)
--------------------------------------------------------------- */

const EXPO_TOKEN_RE = /^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]{10,}\]$/;

function isExpoPushToken(token) {
  return typeof token === "string" && EXPO_TOKEN_RE.test(token);
}

const PUSH_KINDS = Object.freeze(["ride_offer", "ride_update", "account", "support"]);

// Ride offers are time-critical: high priority, their own Android channel
// (sound and heads-up), and a short time-to-live because an expired offer
// is useless.
function buildExpoMessages(tokens, { title, body, kind = "ride_update", data = {} }) {
  const offer = kind === "ride_offer";
  return (tokens || []).filter(isExpoPushToken).map((to) => ({
    to,
    title: String(title || "").slice(0, 100),
    body: String(body || "").slice(0, 240),
    data: { kind, ...data },
    sound: "default",
    priority: offer ? "high" : "default",
    channelId: offer ? "ride-offers" : "ride-updates",
    ttl: offer ? 60 : 3600
  }));
}

// Maps Expo's per-message tickets back to tokens that are no longer valid,
// so the server can delete them.
function invalidTokensFromTickets(messages, tickets) {
  const dead = [];
  (tickets || []).forEach((ticket, i) => {
    if (ticket && ticket.status === "error" && ticket.details && ticket.details.error === "DeviceNotRegistered") {
      if (messages[i]) dead.push(messages[i].to);
    }
  });
  return dead;
}

// Which push category a server notification falls in, from its title.
// Used only to choose priority/channel; never for authorization.
function pushKindForTitle(title) {
  const t = String(title || "").toLowerCase();
  if (t.includes("new ride request")) return "ride_offer";
  return "ride_update";
}

module.exports = {
  ACTIVE_RIDE_STATUSES,
  POLL_MS,
  RECONCILE_MS,
  PAGE_DEFAULT,
  PAGE_MAX,
  PUSH_KINDS,
  phoneLast10,
  phoneLikePattern,
  isActiveDriverRow,
  selectDriverForPhone,
  driverMode,
  pollIntervalFor,
  shapeOffer,
  shapeActiveRide,
  locationPolicy,
  parsePageQuery,
  pageResult,
  isExpoPushToken,
  buildExpoMessages,
  invalidTokensFromTickets,
  pushKindForTitle
};

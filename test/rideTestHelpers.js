// Shared, non-mocking helpers for the Phase 1 dispatch/lifecycle
// integration tests (test/server.ride-*.test.js). jest.mock() calls
// themselves stay in each test file (Jest hoists them per-file, so they
// can't usefully live here), but everything else -- token signing and
// fixture construction -- is common enough to be worth sharing.

const crypto = require("crypto");
const { signRiderSession } = require("../lib/riderAuth");

// Mirrors server.js's own signDriverSession() exactly (inline there,
// untested/unexported) -- same base64url(JSON) + "." + HMAC-SHA256 hex
// scheme used throughout this codebase (lib/rideQuote.js, lib/riderAuth.js).
// Reconstructed here rather than exported from server.js, so server.js's
// own surface doesn't have to grow a test-only export.
function base64UrlEncode(value) {
  return Buffer.from(value, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function signTestDriverToken(driverId, { secret = process.env.DRIVER_SESSION_SECRET, ttlHours = 24, now = Date.now() } = {}) {
  const payload = {
    sub: "harvey-driver",
    driver_id: String(driverId),
    iat: now,
    exp: now + ttlHours * 60 * 60 * 1000
  };

  const encoded = base64UrlEncode(JSON.stringify(payload));
  const sig = crypto.createHmac("sha256", secret).update(encoded).digest("hex");

  return `${encoded}.${sig}`;
}

function signTestRiderToken(riderId, { sessionVersion = 0, secret = process.env.RIDER_SESSION_SECRET, ttlHours = 24 } = {}) {
  return signRiderSession({ riderId, sessionVersion, secret, ttlHours });
}

// Standard headers/cookie a real rider-dashboard.html request carries.
// Non-GET rider routes require the x-requested-with header (CSRF
// mitigation) in addition to the session cookie.
function riderAuthHeaders(token) {
  return {
    Cookie: `harvey_rider_session=${encodeURIComponent(token)}`,
    "x-requested-with": "harvey-rider-app"
  };
}

function driverAuthHeaders(token) {
  return { "x-driver-token": token };
}

const now = () => new Date().toISOString();

function makeRider(overrides = {}) {
  return {
    id: "RIDER_1",
    first_name: "Jamie",
    last_name: "Rivera",
    email: "jamie@example.test",
    phone: "+16155550101",
    access_revoked: false,
    deleted_at: null,
    session_version: 0,
    status: "active",
    approval_status: "approved",
    email_verified: true,
    sms_verified: true,
    persona_status: "verified",
    is_review_account: false,
    stripe_customer_id: null,
    ...overrides
  };
}

function makeDriver(overrides = {}) {
  return {
    id: "DRIVER_1",
    first_name: "Morgan",
    last_name: "Blake",
    email: "morgan@example.test",
    phone: "+16155550201",
    access_revoked: false,
    deleted_at: null,
    online: true,
    status: "active",
    approval_status: "approved",
    email_verified: true,
    phone_verified: true,
    persona_verified: true,
    checkr_status: "clear",
    vehicle_make: "Toyota",
    vehicle_model: "Camry",
    vehicle_year: "2020",
    current_lat: 36.16,
    current_lng: -86.78,
    is_review_account: false,
    ...overrides
  };
}

function makeRide(overrides = {}) {
  return {
    id: "RIDE_1",
    rider_id: "RIDER_1",
    rider_name: "Jamie Rivera",
    rider_phone: "+16155550101",
    driver_id: null,
    driver_name: null,
    driver_phone: null,
    ride_type: "standard",
    pickup_address: "100 Main St",
    dropoff_address: "200 Elm St",
    pickup_lat: 36.16,
    pickup_lng: -86.78,
    dropoff_lat: 36.17,
    dropoff_lng: -86.79,
    status: "payment_authorized",
    dispatch_status: "ready_to_dispatch",
    dispatch_attempts: 0,
    estimated_fare: 20,
    driver_payout: 12.6,
    tip_amount: 0,
    payment_id: null,
    payment_status: null,
    payment_captured: false,
    cancellation_payment_status: null,
    quote_jti: null,
    is_review_ride: false,
    created_at: now(),
    updated_at: now(),
    ...overrides
  };
}

module.exports = {
  signTestDriverToken,
  signTestRiderToken,
  riderAuthHeaders,
  driverAuthHeaders,
  makeRider,
  makeDriver,
  makeRide
};

// Who may see a ride's live status and location
// (GET /api/rides/:id/status and GET /api/rides/:id/stream).
//
// Before this module both routes answered anyone who knew a ride id with
// the driver's live location, the driver's phone number, the addresses and
// the delivery PIN. Now a viewer must be one of:
//   admin    an authenticated admin (requireAdmin's credentials)
//   rider    the rider whose verified session owns the ride, or whoever
//            holds the ride's tracking token (issued only in the response
//            to the request that created the ride). The token exists
//            because riders in production have no session yet (rider
//            sign-in is still rolling out); a ride id alone is not enough.
//   driver   the driver currently assigned to the ride (verified session)
// Anyone else gets "not found", so the routes don't confirm a ride exists.
//
// Pure functions; server.js does the session checks and passes results in.

const crypto = require("crypto");

const TOKEN_LABEL = "ride-tracking:v1:";

function signRideTrackingToken(rideId, secret) {
  if (!secret || !rideId) return null;
  return crypto.createHmac("sha256", secret).update(TOKEN_LABEL + String(rideId)).digest("base64url").slice(0, 32);
}

function verifyRideTrackingToken(rideId, token, secret) {
  const expected = signRideTrackingToken(rideId, secret);
  if (!expected || typeof token !== "string" || token.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected));
}

// The tracking secret: its own setting if present, otherwise derived from
// the ride quote secret with a distinct label, so the two never coincide.
function deriveTrackingSecret({ trackingSecret, quoteSecret }) {
  if (trackingSecret) return trackingSecret;
  if (!quoteSecret) return "";
  return crypto.createHmac("sha256", quoteSecret).update("derive:ride-tracking-secret").digest("hex");
}

function decideRideViewer({ ride, isAdmin, sessionRiderId, trackingTokenValid, sessionDriverId }) {
  if (!ride) return null;
  if (isAdmin) return "admin";
  if (sessionRiderId && ride.rider_id && String(sessionRiderId) === String(ride.rider_id)) return "rider";
  if (trackingTokenValid) return "rider";
  if (sessionDriverId && ride.driver_id && String(sessionDriverId) === String(ride.driver_id)) return "driver";
  return null;
}

// The delivery PIN is the rider's proof to give the driver at handoff. The
// driver must never be able to read it from the server.
function shapeStatusForViewer(payload, viewer) {
  if (viewer !== "driver" || !payload || !payload.delivery) return payload;
  const { pin, ...delivery } = payload.delivery;
  return { ...payload, delivery };
}

module.exports = {
  signRideTrackingToken,
  verifyRideTrackingToken,
  deriveTrackingSecret,
  decideRideViewer,
  shapeStatusForViewer
};

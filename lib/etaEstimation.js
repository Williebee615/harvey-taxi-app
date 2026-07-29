// ETA/distance-to-pickup persistence — see docs/eta-persistence-plan.md.
//
// Two independent concerns, matching the plan's two independent flags:
//   1. Persistence (dispatch_eta_persistence_enabled): write a value — any
//      value — to rides.driver_eta_to_pickup_minutes/driver_distance_to_
//      pickup_miles at the moments it's actually known. Works permanently on
//      free Haversine + assumed-speed math with zero external dependency.
//   2. Accuracy (dispatch_route_api_enabled): once persistence is on,
//      separately allow a paid routing API to *supply* that same value
//      instead of Haversine. Requires persistence already enabled; the
//      reverse is not true.
//
// Same dependency-injected orchestrator shape as sweepScheduledRides() /
// sweepExpiredOffers(): the actual Supabase writes, the routing-API HTTP
// call, and the usage-counter RPC are all injected, so the decision logic —
// flag checks, movement-threshold cache, circuit breaker, fallback-on-any-
// failure — is unit-testable without a database or network access.
// server.js wires the real Supabase-backed adapters near the offer-creation
// and driver-location-update call sites.
//
// Every failure mode here falls back to Haversine rather than throwing:
// a missed accurate ETA is always preferable to blocking ride creation,
// dispatch, a driver's GPS update, or a status response.

const EARTH_RADIUS_MILES = 3958.8;

function haversineMiles(lat1, lon1, lat2, lon2) {
  const toRad = (v) => (Number(v) * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.sqrt(a));
}

// Straight-line distance divided by an assumed average speed — a rough
// estimate, not a real driving-route ETA, but free and always available.
function haversineEta({ fromLat, fromLng, toLat, toLng, speedMph }) {
  const distanceMiles = haversineMiles(fromLat, fromLng, toLat, toLng);
  return {
    distanceMiles: Math.round(distanceMiles * 100) / 100,
    etaMinutes: Math.max(1, Math.round((distanceMiles / speedMph) * 60)),
    source: "haversine"
  };
}

function hasMovedBeyondThreshold({ lastLat, lastLng, lat, lng, thresholdMiles }) {
  if (![lastLat, lastLng, lat, lng].every((v) => Number.isFinite(Number(v)))) {
    return true;
  }
  return haversineMiles(lastLat, lastLng, lat, lng) > thresholdMiles;
}

function withTimeout(promise, ms) {
  if (!ms || !Number.isFinite(ms)) {
    return promise;
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`timed out after ${ms}ms`));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

// Resolves one ETA/distance estimate for a single write point (an offer
// being created, or a driver location ping). Every branch that isn't the
// plain Haversine fallback is only reachable when routeApiEnabled is true —
// with the flag off (its default), this is a pure Haversine calculation with
// no cache reads, no counter increments, and no network calls.
//
// getCachedRoute() -> { lat, lng, distanceMiles, etaMinutes, computedAt } | null
// setCachedRoute(entry) -> void
// incrementUsageCounter() -> Promise<number>  (the new, post-increment count)
// callRouteApi({ fromLat, fromLng, toLat, toLng }) -> Promise<{ distanceMiles, etaMinutes }>
async function resolveEtaEstimate({
  fromLat,
  fromLng,
  toLat,
  toLng,
  speedMph,
  routeApiEnabled = false,
  getCachedRoute = () => null,
  setCachedRoute = () => {},
  incrementUsageCounter,
  quotaLimit = Infinity,
  callRouteApi,
  timeoutMs = 4000,
  movementThresholdMiles = 0.03,
  now = () => new Date(),
  log = () => {},
  logError = () => {}
}) {
  const fallback = () => haversineEta({ fromLat, fromLng, toLat, toLng, speedMph });

  if (!routeApiEnabled) {
    return fallback();
  }

  const cached = getCachedRoute();
  if (
    cached &&
    !hasMovedBeyondThreshold({
      lastLat: cached.lat,
      lastLng: cached.lng,
      lat: fromLat,
      lng: fromLng,
      thresholdMiles: movementThresholdMiles
    })
  ) {
    const elapsedMinutes = Math.max(
      0,
      (now().getTime() - new Date(cached.computedAt).getTime()) / 60000
    );
    return {
      distanceMiles: cached.distanceMiles,
      etaMinutes: Math.max(0, Math.round(cached.etaMinutes - elapsedMinutes)),
      source: "cache"
    };
  }

  let count;
  try {
    count = await incrementUsageCounter();
  } catch (err) {
    // Fail closed: an uncountable call is treated as over-cap, not under.
    // A missed accurate ETA beats an uncontrolled-cost failure mode.
    logError(
      "⚠️ resolveEtaEstimate: usage counter increment failed, falling back to Haversine:",
      err.message
    );
    return fallback();
  }

  if (count > quotaLimit) {
    log(
      `⚠️ resolveEtaEstimate: routing API quota reached (${count}/${quotaLimit}), falling back to Haversine.`
    );
    return fallback();
  }

  try {
    const result = await withTimeout(
      callRouteApi({ fromLat, fromLng, toLat, toLng }),
      timeoutMs
    );

    if (
      !result ||
      !Number.isFinite(Number(result.distanceMiles)) ||
      !Number.isFinite(Number(result.etaMinutes))
    ) {
      throw new Error("routing API returned an invalid result");
    }

    const entry = {
      lat: fromLat,
      lng: fromLng,
      distanceMiles: Number(result.distanceMiles),
      etaMinutes: Number(result.etaMinutes),
      computedAt: now().toISOString()
    };
    setCachedRoute(entry);

    return {
      distanceMiles: entry.distanceMiles,
      etaMinutes: entry.etaMinutes,
      source: "route_api"
    };
  } catch (err) {
    logError(
      "⚠️ resolveEtaEstimate: routing API call failed, falling back to Haversine:",
      err.message
    );
    return fallback();
  }
}

// Computes one estimate and persists it, guaranteeing this never throws —
// computing or persisting an ETA must never block ride creation, dispatch,
// a driver's GPS update, or a status response.
//
// persistEta(estimate) -> Promise<void>
async function computeAndPersistEta({
  persistenceEnabled = false,
  persistEta,
  logError = () => {},
  ...estimateArgs
}) {
  if (!persistenceEnabled) {
    return null;
  }

  let estimate;
  try {
    estimate = await resolveEtaEstimate({ ...estimateArgs, logError });
  } catch (err) {
    logError("⚠️ computeAndPersistEta: estimate failed, nothing persisted:", err.message);
    return null;
  }

  try {
    await persistEta(estimate);
  } catch (err) {
    logError("⚠️ computeAndPersistEta: persistence write failed:", err.message);
  }

  return estimate;
}

// Bounds the in-memory route cache (server.js keys it by ride id) so a ride
// that never comes back for a second estimate doesn't sit in memory forever.
// A no-op today: entries are only ever added when routeApiEnabled is true,
// and that flag stays off until separately approved.
function pruneStaleCacheEntries(cache, { maxAgeMs, now = () => new Date() }) {
  const cutoff = now().getTime() - maxAgeMs;
  for (const [key, entry] of cache.entries()) {
    if (!entry || !entry.computedAt || new Date(entry.computedAt).getTime() < cutoff) {
      cache.delete(key);
    }
  }
}

module.exports = {
  haversineMiles,
  haversineEta,
  hasMovedBeyondThreshold,
  resolveEtaEstimate,
  computeAndPersistEta,
  pruneStaleCacheEntries
};

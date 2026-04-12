/* =========================================================
   HARVEY TAXI — CODE BLUE PHASE 9
   PART 1: CORE FOUNDATION + ENV + HEALTH
   (SUPABASE ONLY — NO JSON STORAGE)
========================================================= */

const express = require("express");
const cors = require("cors");
const path = require("path");
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");

/* =========================================================
   OPTIONAL AI SDK
========================================================= */
let OpenAI = null;
try {
  OpenAI = require("openai");
} catch (error) {
  console.warn("⚠️ OpenAI SDK not installed. AI disabled.");
}

/* =========================================================
   APP INIT
========================================================= */
const app = express();
const PORT = Number(process.env.PORT || 10000);
const APP_NAME = "Harvey Taxi";
const SERVER_STARTED_AT = new Date().toISOString();

/* =========================================================
   CORE MIDDLEWARE
========================================================= */
app.use(
  cors({
    origin: true,
    credentials: true
  })
);

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

/* =========================================================
   HELPER FUNCTIONS
========================================================= */
function clean(value = "") {
  return String(value || "")
    .trim()
    .replace(/^['"]|['"]$/g, "");
}

function lower(value = "") {
  return clean(value).toLowerCase();
}

function toBool(value, fallback = false) {
  const v = lower(value);
  if (!v) return fallback;
  return ["1", "true", "yes", "y", "on"].includes(v);
}

function toNumber(value, fallback = 0) {
  const n = Number(clean(value));
  return Number.isFinite(n) ? n : fallback;
}

function nowISO() {
  return new Date().toISOString();
}

function generateId(prefix = "id") {
  if (typeof crypto.randomUUID === "function") {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${crypto.randomBytes(12).toString("hex")}`;
}

function asMoney(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.round(n * 100) / 100;
}

/* =========================================================
   ENV CONFIG
========================================================= */
const NODE_ENV = clean(process.env.NODE_ENV || "development");

const PUBLIC_APP_URL = clean(
  process.env.PUBLIC_APP_URL ||
    process.env.RENDER_EXTERNAL_URL ||
    process.env.APP_BASE_URL
);

/* === SUPABASE === */
const SUPABASE_URL = clean(process.env.SUPABASE_URL);
const SUPABASE_SERVICE_ROLE_KEY = clean(
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/* === ADMIN === */
const ADMIN_EMAIL = clean(process.env.ADMIN_EMAIL);
const ADMIN_PASSWORD = clean(process.env.ADMIN_PASSWORD);

/* === GOOGLE MAPS === */
const GOOGLE_MAPS_API_KEY = clean(process.env.GOOGLE_MAPS_API_KEY);

/* === AI === */
const ENABLE_AI = toBool(process.env.ENABLE_AI, true);
const OPENAI_API_KEY = clean(process.env.OPENAI_API_KEY);
const OPENAI_MODEL = clean(
  process.env.OPENAI_MODEL ||
    process.env.OPENAI_SUPPORT_MODEL ||
    "gpt-4.1-mini"
);

/* === PERSONA === */
const ENABLE_PERSONA_ENFORCEMENT = toBool(
  process.env.ENABLE_PERSONA_ENFORCEMENT,
  true
);

const PERSONA_API_KEY = clean(process.env.PERSONA_API_KEY);
const PERSONA_TEMPLATE_ID_RIDER = clean(
  process.env.PERSONA_TEMPLATE_ID_RIDER
);
const PERSONA_TEMPLATE_ID_DRIVER = clean(
  process.env.PERSONA_TEMPLATE_ID_DRIVER
);

/* === PAYMENTS (STRIPE FLAG ONLY HERE) === */
const ENABLE_PAYMENT_GATE = toBool(process.env.ENABLE_PAYMENT_GATE, true);
const ENABLE_REAL_STRIPE = toBool(process.env.ENABLE_REAL_STRIPE, false);

/* === DISPATCH === */
const ENABLE_AUTO_REDISPATCH = toBool(
  process.env.ENABLE_AUTO_REDISPATCH,
  true
);

const DISPATCH_TIMEOUT_SECONDS = toNumber(
  process.env.DISPATCH_TIMEOUT_SECONDS,
  30
);

const MAX_DISPATCH_ATTEMPTS = toNumber(
  process.env.MAX_DISPATCH_ATTEMPTS,
  5
);

/* === PRICING === */
const BASE_FARE = toNumber(process.env.BASE_FARE, 5.5);
const PER_MILE_RATE = toNumber(process.env.PER_MILE_RATE, 2.2);
const PER_MINUTE_RATE = toNumber(process.env.PER_MINUTE_RATE, 0.4);
const BOOKING_FEE = toNumber(process.env.BOOKING_FEE, 2);
const MINIMUM_FARE = toNumber(process.env.MINIMUM_FARE, 10);

/* =========================================================
   SUPABASE INIT
========================================================= */
let supabase = null;

if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
  supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  console.log("✅ Supabase connected");
} else {
  console.warn("⚠️ Supabase NOT configured");
}

/* =========================================================
   OPENAI INIT
========================================================= */
let openai = null;

if (ENABLE_AI && OPENAI_API_KEY && OpenAI) {
  try {
    openai = new OpenAI({ apiKey: OPENAI_API_KEY });
    console.log("✅ OpenAI connected");
  } catch (err) {
    console.warn("⚠️ OpenAI init failed:", err.message);
  }
} else {
  console.log("ℹ️ AI disabled");
}

/* =========================================================
   RESPONSE HELPERS
========================================================= */
function ok(res, data = {}, code = 200) {
  return res.status(code).json({
    success: true,
    ...data
  });
}

function fail(res, code = 500, message = "Internal error", extra = {}) {
  return res.status(code).json({
    success: false,
    message,
    ...extra
  });
}

/* =========================================================
   ADMIN AUTH HELPER
========================================================= */
function assertAdmin(req) {
  const email = clean(req.headers["x-admin-email"]);
  const password = clean(req.headers["x-admin-password"]);

  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
    const err = new Error("Admin not configured");
    err.statusCode = 500;
    throw err;
  }

  if (email !== ADMIN_EMAIL || password !== ADMIN_PASSWORD) {
    const err = new Error("Unauthorized");
    err.statusCode = 401;
    throw err;
  }

  return true;
}

/* =========================================================
   PROVIDER STATUS
========================================================= */
function getProviderStatus() {
  return {
    supabase: !!supabase,
    openai: !!openai,
    google_maps: !!GOOGLE_MAPS_API_KEY,
    persona: !!(
      PERSONA_API_KEY &&
      PERSONA_TEMPLATE_ID_RIDER &&
      PERSONA_TEMPLATE_ID_DRIVER
    ),
    payments_enabled: ENABLE_PAYMENT_GATE
  };
}

/* =========================================================
   ROOT + HEALTH ROUTES
========================================================= */
app.get("/", (req, res) => {
  return res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/ping", (req, res) => {
  return ok(res, {
    app: APP_NAME,
    time: nowISO()
  });
});

app.get("/healthz", (req, res) => {
  return res.status(200).json({
    ok: true,
    uptime: process.uptime(),
    timestamp: nowISO()
  });
});

app.get("/api/health", async (req, res) => {
  try {
    let dbStatus = "not_connected";

    if (supabase) {
      const { error } = await supabase.from("riders").select("id").limit(1);
      dbStatus = error ? "query_failed" : "ok";
    }

    return ok(res, {
      service: APP_NAME,
      environment: NODE_ENV,
      started_at: SERVER_STARTED_AT,
      uptime: process.uptime(),
      database: dbStatus,
      providers: getProviderStatus()
    });
  } catch (err) {
    return fail(res, 500, err.message);
  }
});

/* =========================================================
   STARTUP LOG
========================================================= */
console.log("======================================");
console.log(`🚀 ${APP_NAME} starting...`);
console.log("ENV:", NODE_ENV);
console.log("PORT:", PORT);
console.log("Providers:", getProviderStatus());
console.log("======================================");/* =========================================================
   DRIVER LOCATION + LIVE TRACKING ENGINE
========================================================= */

/* =========================================================
   DRIVER LOCATION UPDATE
========================================================= */
app.post("/api/driver-location", async (req, res) => {
  try {
    requireSupabase();

    const driverId = cleanEnv(req.body?.driver_id || req.body?.driverId);
    const lat = Number(req.body?.lat);
    const lng = Number(req.body?.lng);

    if (!driverId) return fail(res, 400, "driver_id is required");
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return fail(res, 400, "Valid lat/lng required");
    }

    const payload = {
      id: generateId("location"),
      driver_id: driverId,
      lat,
      lng,
      created_at: nowISO()
    };

    await safeInsert("driver_locations", payload);

    await safeUpdateById("drivers", driverId, {
      last_lat: lat,
      last_lng: lng,
      last_seen_at: nowISO(),
      is_online: true
    });

    return ok(res, {
      message: "Location updated"
    });

  } catch (error) {
    console.error("❌ driver-location error:", error);
    return fail(res, 500, error.message);
  }
});

/* =========================================================
   GET NEARBY DRIVERS (MAP VIEW)
========================================================= */
app.get("/api/nearby-drivers", async (req, res) => {
  try {
    requireSupabase();

    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return fail(res, 400, "Valid lat/lng required");
    }

    const { data, error } = await supabase
      .from("drivers")
      .select(`
        id,
        first_name,
        last_name,
        driver_type,
        rating,
        last_lat,
        last_lng,
        is_online,
        status
      `)
      .eq("is_online", true);

    if (error) throw error;

    const drivers = (data || []).map(driver => {
      const dLat = Number(driver.last_lat || 0);
      const dLng = Number(driver.last_lng || 0);

      const distance = Math.sqrt(
        Math.pow(lat - dLat, 2) + Math.pow(lng - dLng, 2)
      );

      return {
        ...driver,
        distance
      };
    })
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 10);

    return ok(res, {
      drivers
    });

  } catch (error) {
    console.error("❌ nearby-drivers error:", error);
    return fail(res, 500, error.message);
  }
});

/* =========================================================
   DRIVER ONLINE / OFFLINE TOGGLE
========================================================= */
app.post("/api/drivers/:driverId/online", async (req, res) => {
  try {
    requireSupabase();

    const driverId = cleanEnv(req.params.driverId);
    const isOnline = normalizeBoolean(req.body?.is_online, true);

    const driver = await safeUpdateById("drivers", driverId, {
      is_online: isOnline,
      status: isOnline ? "available" : "offline",
      updated_at: nowISO()
    });

    return ok(res, {
      message: isOnline ? "Driver is now online" : "Driver is now offline",
      driver
    });

  } catch (error) {
    console.error("❌ driver online error:", error);
    return fail(res, 500, error.message);
  }
});

/* =========================================================
   LIVE RIDE TRACKING (RIDER VIEW)
========================================================= */
app.get("/api/rides/:rideId/live", async (req, res) => {
  try {
    const rideId = cleanEnv(req.params.rideId);
    if (!rideId) return fail(res, 400, "rideId required");

    const ride = await getRideById(rideId);

    let driverLocation = null;

    if (ride.driver_id) {
      const { data } = await supabase
        .from("driver_locations")
        .select("*")
        .eq("driver_id", ride.driver_id)
        .order("created_at", { ascending: false })
        .limit(1);

      driverLocation = data?.[0] || null;
    }

    return ok(res, {
      ride,
      driver_location: driverLocation
    });

  } catch (error) {
    console.error("❌ live ride error:", error);
    return fail(res, 500, error.message);
  }
});/* =========================================================
   PART 3 — REAL FARE ENGINE + MAPS + DYNAMIC PRICING
========================================================= */

/* =========================================================
   GOOGLE MAPS HELPERS
========================================================= */
async function safeFetchJson(url, options = {}) {
  const response = await fetch(url, options);

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`HTTP ${response.status} ${response.statusText} ${text}`.trim());
  }

  return response.json();
}

function hasGoogleMapsConfigured() {
  return !!GOOGLE_MAPS_API_KEY;
}

function toRadians(value) {
  return (Number(value) * Math.PI) / 180;
}

function haversineMiles(lat1, lng1, lat2, lng2) {
  const aLat = Number(lat1);
  const aLng = Number(lng1);
  const bLat = Number(lat2);
  const bLng = Number(lng2);

  if (
    !Number.isFinite(aLat) ||
    !Number.isFinite(aLng) ||
    !Number.isFinite(bLat) ||
    !Number.isFinite(bLng)
  ) {
    return 0;
  }

  const earthRadiusMiles = 3958.8;
  const dLat = toRadians(bLat - aLat);
  const dLng = toRadians(bLng - aLng);

  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);

  const h =
    sinLat * sinLat +
    Math.cos(toRadians(aLat)) *
      Math.cos(toRadians(bLat)) *
      sinLng *
      sinLng;

  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return earthRadiusMiles * c;
}

function fallbackDurationMinutesFromMiles(miles = 0) {
  const avgCityMph = 22;
  if (!Number.isFinite(miles) || miles <= 0) return 0;
  return (miles / avgCityMph) * 60;
}

async function geocodeAddress(address = "") {
  const safeAddress = cleanEnv(address);
  if (!safeAddress) {
    throw new Error("Address is required for geocoding");
  }

  if (!hasGoogleMapsConfigured()) {
    return {
      source: "unavailable",
      address: safeAddress,
      lat: null,
      lng: null
    };
  }

  const url =
    "https://maps.googleapis.com/maps/api/geocode/json?" +
    new URLSearchParams({
      address: safeAddress,
      key: GOOGLE_MAPS_API_KEY
    }).toString();

  const data = await safeFetchJson(url);
  const result = Array.isArray(data.results) ? data.results[0] : null;

  if (!result?.geometry?.location) {
    throw new Error("Unable to geocode address");
  }

  return {
    source: "google_geocode",
    address: result.formatted_address || safeAddress,
    lat: Number(result.geometry.location.lat),
    lng: Number(result.geometry.location.lng)
  };
}

async function getDistanceMatrixEstimate({
  originAddress = "",
  destinationAddress = ""
}) {
  const origin = cleanEnv(originAddress);
  const destination = cleanEnv(destinationAddress);

  if (!origin || !destination) {
    throw new Error("Origin and destination are required");
  }

  if (!hasGoogleMapsConfigured()) {
    return {
      source: "fallback",
      distance_miles: 0,
      duration_minutes: 0,
      raw_distance_meters: null,
      raw_duration_seconds: null
    };
  }

  const url =
    "https://maps.googleapis.com/maps/api/distancematrix/json?" +
    new URLSearchParams({
      origins: origin,
      destinations: destination,
      units: "imperial",
      key: GOOGLE_MAPS_API_KEY
    }).toString();

  const data = await safeFetchJson(url);
  const row = Array.isArray(data.rows) ? data.rows[0] : null;
  const element = Array.isArray(row?.elements) ? row.elements[0] : null;

  if (!element || element.status !== "OK") {
    throw new Error("Distance Matrix estimate unavailable");
  }

  const meters = Number(element.distance?.value || 0);
  const seconds = Number(element.duration?.value || 0);

  return {
    source: "google_distance_matrix",
    distance_miles: asMoney(meters / 1609.344, 0),
    duration_minutes: asMoney(seconds / 60, 0),
    raw_distance_meters: meters,
    raw_duration_seconds: seconds,
    distance_text: element.distance?.text || null,
    duration_text: element.duration?.text || null
  };
}

async function resolveRouteEstimate({
  pickupAddress = "",
  destinationAddress = "",
  pickupLat = null,
  pickupLng = null,
  destinationLat = null,
  destinationLng = null,
  estimatedMiles = 0,
  estimatedMinutes = 0
}) {
  const directMiles = Number(estimatedMiles || 0);
  const directMinutes = Number(estimatedMinutes || 0);

  if (directMiles > 0 || directMinutes > 0) {
    return {
      source: "request_body",
      distance_miles: asMoney(directMiles, 0),
      duration_minutes: asMoney(
        directMinutes > 0 ? directMinutes : fallbackDurationMinutesFromMiles(directMiles),
        0
      ),
      raw_distance_meters: null,
      raw_duration_seconds: null
    };
  }

  try {
    const matrix = await getDistanceMatrixEstimate({
      originAddress: pickupAddress,
      destinationAddress: destinationAddress
    });

    if (matrix.distance_miles > 0 || matrix.duration_minutes > 0) {
      return matrix;
    }
  } catch (error) {
    console.warn("⚠️ Distance Matrix fallback:", error.message);
  }

  const geoMiles = haversineMiles(
    pickupLat,
    pickupLng,
    destinationLat,
    destinationLng
  );

  if (geoMiles > 0) {
    return {
      source: "haversine",
      distance_miles: asMoney(geoMiles, 0),
      duration_minutes: asMoney(fallbackDurationMinutesFromMiles(geoMiles), 0),
      raw_distance_meters: null,
      raw_duration_seconds: null
    };
  }

  return {
    source: "empty_fallback",
    distance_miles: 0,
    duration_minutes: 0,
    raw_distance_meters: null,
    raw_duration_seconds: null
  };
}

/* =========================================================
   DYNAMIC PRICING HELPERS
========================================================= */
function getSurgeMultiplier({
  rideType = "standard",
  requestedMode = "driver",
  scheduledFor = null,
  activeDemand = 0,
  availableDrivers = 0
}) {
  const defaultSurge = toNumber(process.env.SURGE_MULTIPLIER_DEFAULT, 1);
  const busySurge = toNumber(process.env.SURGE_MULTIPLIER_BUSY, 1.2);
  const highSurge = toNumber(process.env.SURGE_MULTIPLIER_HIGH, 1.5);
  const autonomousExtra = toNumber(process.env.AUTONOMOUS_SURGE_EXTRA, 0.05);

  let surge = defaultSurge;

  if (activeDemand > 0 && availableDrivers >= 0) {
    const ratio =
      availableDrivers <= 0 ? activeDemand : activeDemand / Math.max(availableDrivers, 1);

    if (ratio >= 3) {
      surge = highSurge;
    } else if (ratio >= 1.5) {
      surge = busySurge;
    }
  }

  if (lower(requestedMode) === "autonomous") {
    surge += autonomousExtra;
  }

  if (lower(rideType) === "airport") {
    surge += 0.05;
  }

  if (scheduledFor) {
    surge += 0.03;
  }

  return Math.max(1, asMoney(surge, 1));
}

async function getDispatchMarketSnapshot(requestedMode = "driver") {
  if (!supabase) {
    return {
      active_demand: 0,
      available_drivers: 0
    };
  }

  let activeDemand = 0;
  let availableDrivers = 0;

  try {
    const ridesResult = await supabase
      .from("rides")
      .select("*", { count: "exact", head: true })
      .in("status", [
        "awaiting_dispatch",
        "awaiting_driver_acceptance",
        "dispatched",
        "driver_en_route",
        "arrived",
        "in_progress"
      ]);

    activeDemand = Number(ridesResult.count || 0);
  } catch (error) {
    console.warn("⚠️ active demand count failed:", error.message);
  }

  try {
    const driverType = getRequestedDriverTypeFromMode(requestedMode);

    const driversResult = await supabase
      .from("drivers")
      .select("*", { count: "exact", head: true })
      .eq("driver_type", driverType)
      .eq("is_online", true);

    availableDrivers = Number(driversResult.count || 0);
  } catch (error) {
    console.warn("⚠️ available drivers count failed:", error.message);
  }

  return {
    active_demand: activeDemand,
    available_drivers: availableDrivers
  };
}

async function computeLiveFareEstimate({
  rideType = "standard",
  requestedMode = "driver",
  pickupAddress = "",
  destinationAddress = "",
  pickupLat = null,
  pickupLng = null,
  destinationLat = null,
  destinationLng = null,
  scheduledFor = null,
  estimatedMiles = 0,
  estimatedMinutes = 0
}) {
  const routeEstimate = await resolveRouteEstimate({
    pickupAddress,
    destinationAddress,
    pickupLat,
    pickupLng,
    destinationLat,
    destinationLng,
    estimatedMiles,
    estimatedMinutes
  });

  const market = await getDispatchMarketSnapshot(requestedMode);
  const surgeMultiplier = getSurgeMultiplier({
    rideType,
    requestedMode,
    scheduledFor,
    activeDemand: market.active_demand,
    availableDrivers: market.available_drivers
  });

  const typeMultiplier = RIDE_TYPE_MULTIPLIERS[rideType] || 1;
  const modeMultiplier = MODE_MULTIPLIERS[requestedMode] || 1;

  const distanceMiles = Number(routeEstimate.distance_miles || 0);
  const durationMinutes = Number(routeEstimate.duration_minutes || 0);

  const distanceCost = asMoney(distanceMiles * DEFAULT_PER_MILE, 0);
  const timeCost = asMoney(durationMinutes * DEFAULT_PER_MINUTE, 0);

  const subtotal = asMoney(
    DEFAULT_BASE_FARE + DEFAULT_BOOKING_FEE + distanceCost + timeCost,
    0
  );

  const multiplierTotal = typeMultiplier * modeMultiplier * surgeMultiplier;

  const totalBeforeMinimum = asMoney(subtotal * multiplierTotal, 0);
  const estimatedTotal = asMoney(
    Math.max(totalBeforeMinimum, DEFAULT_MINIMUM_FARE),
    DEFAULT_MINIMUM_FARE
  );

  return {
    currency: "USD",
    source: routeEstimate.source,
    ride_type: rideType,
    requested_mode: requestedMode,
    pickup_address: pickupAddress || null,
    destination_address: destinationAddress || null,
    estimated_miles: asMoney(distanceMiles, 0),
    estimated_minutes: asMoney(durationMinutes, 0),
    base_fare: asMoney(DEFAULT_BASE_FARE, 0),
    booking_fee: asMoney(DEFAULT_BOOKING_FEE, 0),
    distance_cost: distanceCost,
    time_cost: timeCost,
    subtotal: subtotal,
    ride_type_multiplier: asMoney(typeMultiplier, 1),
    mode_multiplier: asMoney(modeMultiplier, 1),
    surge_multiplier: asMoney(surgeMultiplier, 1),
    total_before_minimum: totalBeforeMinimum,
    minimum_fare: asMoney(DEFAULT_MINIMUM_FARE, 0),
    estimated_total: estimatedTotal,
    market_snapshot: market,
    raw_distance_meters: routeEstimate.raw_distance_meters || null,
    raw_duration_seconds: routeEstimate.raw_duration_seconds || null,
    distance_text: routeEstimate.distance_text || null,
    duration_text: routeEstimate.duration_text || null
  };
}

/* =========================================================
   PUBLIC FARE / MAP ROUTES
========================================================= */
app.post("/api/fare-estimate-live", async (req, res) => {
  try {
    const rideType = normalizeRideType(req.body?.ride_type || req.body?.rideType);
    const requestedMode = normalizeRequestedMode(
      req.body?.requestedMode || req.body?.mode
    );

    const pickupAddress = normalizeAddress(
      req.body?.pickup_address ||
        req.body?.pickupAddress ||
        req.body?.origin ||
        req.body?.from_address
    );

    const destinationAddress = normalizeAddress(
      req.body?.destination_address ||
        req.body?.destinationAddress ||
        req.body?.destination ||
        req.body?.to_address
    );

    const pickupLat = normalizeCoordinate(req.body?.pickup_lat || req.body?.pickupLat);
    const pickupLng = normalizeCoordinate(req.body?.pickup_lng || req.body?.pickupLng);
    const destinationLat = normalizeCoordinate(
      req.body?.destination_lat || req.body?.destinationLat
    );
    const destinationLng = normalizeCoordinate(
      req.body?.destination_lng || req.body?.destinationLng
    );

    const scheduledFor = cleanEnv(req.body?.scheduled_for || req.body?.scheduledFor) || null;
    const estimatedMiles = Number(req.body?.estimated_miles || req.body?.estimatedMiles || 0);
    const estimatedMinutes = Number(
      req.body?.estimated_minutes || req.body?.estimatedMinutes || 0
    );

    if (!pickupAddress && (!Number.isFinite(pickupLat) || !Number.isFinite(pickupLng))) {
      return fail(res, 400, "pickup address or pickup coordinates are required");
    }

    if (
      !destinationAddress &&
      (!Number.isFinite(destinationLat) || !Number.isFinite(destinationLng))
    ) {
      return fail(res, 400, "destination address or destination coordinates are required");
    }

    const estimate = await computeLiveFareEstimate({
      rideType,
      requestedMode,
      pickupAddress,
      destinationAddress,
      pickupLat,
      pickupLng,
      destinationLat,
      destinationLng,
      scheduledFor,
      estimatedMiles,
      estimatedMinutes
    });

    return ok(res, {
      message: "Live fare estimate generated",
      fare_estimate: estimate
    });
  } catch (error) {
    console.error("❌ /api/fare-estimate-live failed:", error);
    return fail(
      res,
      Number(error.statusCode || 500),
      error.message || "Unable to generate fare estimate"
    );
  }
});

app.post("/api/maps/geocode", async (req, res) => {
  try {
    const address = cleanEnv(req.body?.address);
    if (!address) {
      return fail(res, 400, "address is required");
    }

    const result = await geocodeAddress(address);

    return ok(res, {
      message: "Address geocoded",
      result
    });
  } catch (error) {
    console.error("❌ /api/maps/geocode failed:", error);
    return fail(
      res,
      Number(error.statusCode || 500),
      error.message || "Unable to geocode address"
    );
  }
});

app.post("/api/maps/route-estimate", async (req, res) => {
  try {
    const pickupAddress = normalizeAddress(
      req.body?.pickup_address || req.body?.pickupAddress || req.body?.origin
    );
    const destinationAddress = normalizeAddress(
      req.body?.destination_address ||
        req.body?.destinationAddress ||
        req.body?.destination
    );

    const pickupLat = normalizeCoordinate(req.body?.pickup_lat || req.body?.pickupLat);
    const pickupLng = normalizeCoordinate(req.body?.pickup_lng || req.body?.pickupLng);
    const destinationLat = normalizeCoordinate(
      req.body?.destination_lat || req.body?.destinationLat
    );
    const destinationLng = normalizeCoordinate(
      req.body?.destination_lng || req.body?.destinationLng
    );

    const estimate = await resolveRouteEstimate({
      pickupAddress,
      destinationAddress,
      pickupLat,
      pickupLng,
      destinationLat,
      destinationLng
    });

    return ok(res, {
      message: "Route estimate generated",
      route_estimate: estimate
    });
  } catch (error) {
    console.error("❌ /api/maps/route-estimate failed:", error);
    return fail(
      res,
      Number(error.statusCode || 500),
      error.message || "Unable to estimate route"
    );
  }
});

/* =========================================================
   UPGRADE EXISTING REQUEST-RIDE TO USE LIVE FARE ENGINE
========================================================= */
app.post("/api/request-ride-v2", async (req, res) => {
  try {
    requireSupabase();

    const input = parseRideRequestBody(req.body || {});
    validateRideRequestInput(input);

    const rider = await assertRiderEligibleForRideRequest(input.riderId);

    const fareEstimate = await computeLiveFareEstimate({
      rideType: input.rideType,
      requestedMode: input.requestedMode,
      pickupAddress: input.pickupAddress,
      destinationAddress: input.destinationAddress,
      pickupLat: input.pickupLat,
      pickupLng: input.pickupLng,
      destinationLat: input.destinationLat,
      destinationLng: input.destinationLng,
      scheduledFor: input.scheduledFor,
      estimatedMiles: input.estimatedMiles,
      estimatedMinutes: input.estimatedMinutes
    });

    const ridePayload = {
      id: generateId("ride"),
      rider_id: rider.id,
      status: "awaiting_dispatch",
      requested_mode: input.requestedMode,
      ride_type: input.rideType,
      pickup_address: input.pickupAddress,
      destination_address: input.destinationAddress,
      notes: input.notes || null,
      pickup_lat: input.pickupLat,
      pickup_lng: input.pickupLng,
      destination_lat: input.destinationLat,
      destination_lng: input.destinationLng,
      scheduled_for: input.scheduledFor,
      estimated_miles: fareEstimate.estimated_miles,
      estimated_minutes: fareEstimate.estimated_minutes,
      estimated_total: fareEstimate.estimated_total,
      subtotal: fareEstimate.subtotal,
      surge_multiplier: fareEstimate.surge_multiplier,
      ride_type_multiplier: fareEstimate.ride_type_multiplier,
      mode_multiplier: fareEstimate.mode_multiplier,
      currency: fareEstimate.currency,
      route_source: fareEstimate.source,
      dispatch_attempts: 0,
      created_at: nowISO(),
      updated_at: nowISO()
    };

    const ride = await safeInsert("rides", ridePayload);

    await logTripEvent(ride.id, "ride_requested", {
      rider_id: rider.id,
      requested_mode: input.requestedMode,
      ride_type: input.rideType,
      pickup_address: input.pickupAddress,
      destination_address: input.destinationAddress,
      estimated_total: fareEstimate.estimated_total,
      route_source: fareEstimate.source
    });

    await logAdminEvent("ride_requested_v2", {
      ride_id: ride.id,
      rider_id: rider.id,
      requested_mode: input.requestedMode,
      estimated_total: fareEstimate.estimated_total
    });

    return ok(
      res,
      {
        message: "Ride request accepted",
        ride_id: ride.id,
        ride,
        fare_estimate: fareEstimate
      },
      201
    );
  } catch (error) {
    console.error("❌ /api/request-ride-v2 failed:", error);
    return fail(
      res,
      Number(error.statusCode || 500),
      error.message || "Ride request failed",
      error.details ? { details: error.details } : {}
    );
  }
});/* =========================================================
   PART 4 — SMARTER DISPATCH BRAIN + OFFER PROTECTION
========================================================= */

/* =========================================================
   DISPATCH CONFIG HELPERS
========================================================= */
const DRIVER_MAX_ACTIVE_OFFERS = toNumber(
  process.env.DRIVER_MAX_ACTIVE_OFFERS,
  1
);

const DRIVER_MAX_DISTANCE_MILES = toNumber(
  process.env.DRIVER_MAX_DISTANCE_MILES,
  25
);

const DRIVER_RECENCY_WINDOW_MINUTES = toNumber(
  process.env.DRIVER_RECENCY_WINDOW_MINUTES,
  15
);

function minutesAgoIso(minutes = 15) {
  return new Date(Date.now() - minutes * 60 * 1000).toISOString();
}

function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function average(numbers = []) {
  if (!Array.isArray(numbers) || !numbers.length) return 0;
  const valid = numbers.map(Number).filter(Number.isFinite);
  if (!valid.length) return 0;
  return valid.reduce((sum, n) => sum + n, 0) / valid.length;
}

/* =========================================================
   DRIVER LOCATION + STATUS HELPERS
========================================================= */
async function getLatestDriverLocationMap(driverIds = []) {
  requireSupabase();

  const cleanIds = [...new Set((driverIds || []).map(cleanEnv).filter(Boolean))];
  if (!cleanIds.length) return {};

  try {
    const { data, error } = await supabase
      .from("driver_locations")
      .select("driver_id, lat, lng, created_at")
      .in("driver_id", cleanIds)
      .order("created_at", { ascending: false });

    if (error) throw error;

    const map = {};
    for (const row of data || []) {
      const driverId = cleanEnv(row.driver_id);
      if (!driverId || map[driverId]) continue;
      map[driverId] = row;
    }
    return map;
  } catch (error) {
    console.warn("⚠️ driver_locations lookup failed:", error.message);
    return {};
  }
}

async function getDriverActiveOfferCounts(driverIds = []) {
  requireSupabase();

  const cleanIds = [...new Set((driverIds || []).map(cleanEnv).filter(Boolean))];
  if (!cleanIds.length) return {};

  try {
    const { data, error } = await supabase
      .from("dispatches")
      .select("driver_id, status")
      .in("driver_id", cleanIds)
      .eq("status", "offered");

    if (error) throw error;

    const counts = {};
    for (const row of data || []) {
      const id = cleanEnv(row.driver_id);
      counts[id] = (counts[id] || 0) + 1;
    }
    return counts;
  } catch (error) {
    console.warn("⚠️ active offer count lookup failed:", error.message);
    return {};
  }
}

async function getDriverRecentDispatchStats(driverIds = []) {
  requireSupabase();

  const cleanIds = [...new Set((driverIds || []).map(cleanEnv).filter(Boolean))];
  if (!cleanIds.length) return {};

  try {
    const { data, error } = await supabase
      .from("dispatches")
      .select("driver_id, status, dispatched_at, responded_at, accepted_at, rejected_at, expired_at")
      .in("driver_id", cleanIds)
      .gte("created_at", minutesAgoIso(DRIVER_RECENCY_WINDOW_MINUTES));

    if (error) throw error;

    const stats = {};
    for (const id of cleanIds) {
      stats[id] = {
        offered: 0,
        accepted: 0,
        rejected: 0,
        expired: 0,
        response_times_seconds: []
      };
    }

    for (const row of data || []) {
      const id = cleanEnv(row.driver_id);
      if (!stats[id]) {
        stats[id] = {
          offered: 0,
          accepted: 0,
          rejected: 0,
          expired: 0,
          response_times_seconds: []
        };
      }

      stats[id].offered += 1;

      const status = lower(row.status);
      if (status === "accepted") stats[id].accepted += 1;
      if (status === "rejected") stats[id].rejected += 1;
      if (status === "expired") stats[id].expired += 1;

      const dispatchedAt = row.dispatched_at ? new Date(row.dispatched_at).getTime() : null;
      const respondedAt = row.responded_at ? new Date(row.responded_at).getTime() : null;

      if (dispatchedAt && respondedAt && respondedAt >= dispatchedAt) {
        stats[id].response_times_seconds.push((respondedAt - dispatchedAt) / 1000);
      }
    }

    for (const id of Object.keys(stats)) {
      const item = stats[id];
      item.avg_response_seconds = asMoney(average(item.response_times_seconds), 0);
      item.acceptance_ratio =
        item.offered > 0 ? asMoney(item.accepted / item.offered, 0) : 0;
      item.expiry_ratio =
        item.offered > 0 ? asMoney(item.expired / item.offered, 0) : 0;
    }

    return stats;
  } catch (error) {
    console.warn("⚠️ recent dispatch stats lookup failed:", error.message);
    return {};
  }
}

async function getRideAttemptedDriverIds(rideId) {
  requireSupabase();

  try {
    const { data, error } = await supabase
      .from("dispatches")
      .select("driver_id")
      .eq("ride_id", rideId);

    if (error) throw error;

    return new Set(
      (data || [])
        .map((row) => cleanEnv(row.driver_id))
        .filter(Boolean)
    );
  } catch (error) {
    console.warn("⚠️ attempted driver lookup failed:", error.message);
    return new Set();
  }
}

/* =========================================================
   PICKUP DISTANCE RESOLUTION
========================================================= */
function computeDistanceMilesBetweenPoints(aLat, aLng, bLat, bLng) {
  return asMoney(haversineMiles(aLat, aLng, bLat, bLng), 0);
}

async function resolveRidePickupCoordinates(ride = {}) {
  const pickupLat = Number(ride.pickup_lat);
  const pickupLng = Number(ride.pickup_lng);

  if (Number.isFinite(pickupLat) && Number.isFinite(pickupLng)) {
    return {
      lat: pickupLat,
      lng: pickupLng,
      source: "ride_coordinates"
    };
  }

  if (cleanEnv(ride.pickup_address) && hasGoogleMapsConfigured()) {
    try {
      const geo = await geocodeAddress(ride.pickup_address);
      if (Number.isFinite(geo.lat) && Number.isFinite(geo.lng)) {
        return {
          lat: geo.lat,
          lng: geo.lng,
          source: geo.source || "google_geocode"
        };
      }
    } catch (error) {
      console.warn("⚠️ ride pickup geocode fallback:", error.message);
    }
  }

  return {
    lat: null,
    lng: null,
    source: "unavailable"
  };
}

/* =========================================================
   SMART DISPATCH SCORE
========================================================= */
function computeEnhancedDriverDispatchScore(candidate = {}, ride = {}) {
  const pickupDistanceMiles = safeNumber(candidate.pickup_distance_miles, 9999);
  const rating = safeNumber(candidate.rating, 5);
  const acceptanceRatio = safeNumber(
    candidate.acceptance_ratio ?? candidate.acceptance_rate,
    0
  );
  const expiryRatio = safeNumber(candidate.expiry_ratio, 0);
  const avgResponseSeconds = safeNumber(candidate.avg_response_seconds, 9999);
  const activeOffers = safeNumber(candidate.active_offer_count, 0);
  const isPriority = normalizeBoolean(candidate.is_priority, false) ? 1 : 0;
  const onlineBoost = normalizeBoolean(candidate.is_online, false) ? 1 : 0;

  const distanceScore = Math.max(0, 140 - pickupDistanceMiles * 9);
  const ratingScore = rating * 12;
  const acceptanceScore = acceptanceRatio * 45;
  const expiryPenalty = expiryRatio * 30;
  const responseScore = Math.max(0, 30 - avgResponseSeconds / 4);
  const loadPenalty = activeOffers * 50;
  const priorityScore = isPriority ? 18 : 0;
  const onlineScore = onlineBoost ? 10 : 0;

  const score =
    distanceScore +
    ratingScore +
    acceptanceScore +
    responseScore +
    priorityScore +
    onlineScore -
    expiryPenalty -
    loadPenalty;

  return asMoney(score, 0);
}

/* =========================================================
   SMART CANDIDATE SELECTION
========================================================= */
async function getEligibleDriversForRideSmart(ride = {}, options = {}) {
  requireSupabase();

  const requestedDriverType = getRequestedDriverTypeFromMode(
    ride.requested_mode || "driver"
  );

  const excludeDriverIds = new Set(
    (options.excludeDriverIds || []).map(cleanEnv).filter(Boolean)
  );

  const { data, error } = await supabase
    .from("drivers")
    .select(`
      id,
      first_name,
      last_name,
      email,
      phone,
      status,
      verification_status,
      approval_status,
      is_blocked,
      is_disabled,
      current_ride_id,
      current_mission_id,
      is_online,
      driver_type,
      rating,
      acceptance_rate,
      distance_miles,
      is_priority,
      last_seen_at,
      vehicle_make,
      vehicle_model,
      vehicle_color,
      vehicle_plate,
      last_lat,
      last_lng
    `)
    .eq("driver_type", requestedDriverType)
    .order("last_seen_at", { ascending: false });

  if (error) {
    const err = new Error(error.message || "Unable to fetch drivers");
    err.statusCode = 500;
    err.details = error;
    throw err;
  }

  const pickup = await resolveRidePickupCoordinates(ride);
  const drivers = data || [];
  const driverIds = drivers.map((d) => cleanEnv(d.id)).filter(Boolean);
  const [locationMap, activeOfferCounts, recentStats] = await Promise.all([
    getLatestDriverLocationMap(driverIds),
    getDriverActiveOfferCounts(driverIds),
    getDriverRecentDispatchStats(driverIds)
  ]);

  const candidates = [];

  for (const driver of drivers) {
    const driverId = cleanEnv(driver.id);
    if (!driverId) continue;
    if (excludeDriverIds.has(driverId)) continue;

    if (normalizeBoolean(driver.is_blocked, false)) continue;
    if (normalizeBoolean(driver.is_disabled, false)) continue;
    if (!normalizeBoolean(driver.is_online, false)) continue;
    if (!isDriverAvailableStatus(driver.status)) continue;

    if (cleanEnv(driver.current_ride_id)) continue;
    if (cleanEnv(driver.current_mission_id)) continue;
    if (lower(driver.verification_status) !== "approved") continue;

    const approvalStatus = lower(driver.approval_status || driver.status);
    if (
      approvalStatus &&
      !["approved", "active", "available", "online", "ready"].includes(approvalStatus)
    ) {
      continue;
    }

    const activeOfferCount = safeNumber(activeOfferCounts[driverId], 0);
    if (activeOfferCount >= DRIVER_MAX_ACTIVE_OFFERS) continue;

    const location =
      locationMap[driverId] ||
      (Number.isFinite(Number(driver.last_lat)) && Number.isFinite(Number(driver.last_lng))
        ? {
            lat: Number(driver.last_lat),
            lng: Number(driver.last_lng),
            created_at: driver.last_seen_at || null
          }
        : null);

    let pickupDistanceMiles = safeNumber(driver.distance_miles, 9999);

    if (
      location &&
      Number.isFinite(Number(location.lat)) &&
      Number.isFinite(Number(location.lng)) &&
      Number.isFinite(Number(pickup.lat)) &&
      Number.isFinite(Number(pickup.lng))
    ) {
      pickupDistanceMiles = computeDistanceMilesBetweenPoints(
        location.lat,
        location.lng,
        pickup.lat,
        pickup.lng
      );
    }

    if (pickupDistanceMiles > DRIVER_MAX_DISTANCE_MILES) continue;

    const stats = recentStats[driverId] || {};
    const candidate = {
      ...driver,
      pickup_distance_miles: pickupDistanceMiles,
      active_offer_count: activeOfferCount,
      offered_recently: safeNumber(stats.offered, 0),
      accepted_recently: safeNumber(stats.accepted, 0),
      rejected_recently: safeNumber(stats.rejected, 0),
      expired_recently: safeNumber(stats.expired, 0),
      avg_response_seconds: safeNumber(stats.avg_response_seconds, 0),
      acceptance_ratio: safeNumber(
        stats.acceptance_ratio,
        safeNumber(driver.acceptance_rate, 0)
      ),
      expiry_ratio: safeNumber(stats.expiry_ratio, 0),
      pickup_coordinate_source: pickup.source,
      driver_location: location || null
    };

    candidate.dispatch_score = computeEnhancedDriverDispatchScore(candidate, ride);
    candidates.push(candidate);
  }

  candidates.sort((a, b) => {
    const scoreDiff = safeNumber(b.dispatch_score) - safeNumber(a.dispatch_score);
    if (scoreDiff !== 0) return scoreDiff;

    const distanceDiff =
      safeNumber(a.pickup_distance_miles, 9999) -
      safeNumber(b.pickup_distance_miles, 9999);
    if (distanceDiff !== 0) return distanceDiff;

    return safeNumber(b.rating, 0) - safeNumber(a.rating, 0);
  });

  return candidates;
}

/* =========================================================
   DISPATCH OFFER SAFETY
========================================================= */
async function getOpenRideDispatch(rideId) {
  requireSupabase();

  const { data, error } = await supabase
    .from("dispatches")
    .select("*")
    .eq("ride_id", rideId)
    .eq("status", "offered")
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) {
    const err = new Error(error.message || "Unable to fetch open dispatch");
    err.statusCode = 500;
    throw err;
  }

  return data?.[0] || null;
}

async function ensureRideHasNoOpenOffer(rideId) {
  const openDispatch = await getOpenRideDispatch(rideId);
  if (openDispatch) {
    const err = new Error("Ride already has an active dispatch offer");
    err.statusCode = 409;
    err.details = {
      dispatch_id: openDispatch.id,
      driver_id: openDispatch.driver_id,
      offer_expires_at: openDispatch.offer_expires_at
    };
    throw err;
  }
  return true;
}

async function createDispatchOfferV2({ ride, driver, attemptNumber = 1 }) {
  await ensureRideHasNoOpenOffer(ride.id);

  const dispatchPayload = {
    id: generateId("dispatch"),
    ride_id: ride.id,
    driver_id: driver.id,
    status: "offered",
    requested_mode: ride.requested_mode || "driver",
    attempt_number: attemptNumber,
    offer_expires_at: toDispatchExpiryIso(DISPATCH_TIMEOUT_SECONDS),
    dispatched_at: nowISO(),
    responded_at: null,
    accepted_at: null,
    expired_at: null,
    rejected_at: null,
    score: Number(driver.dispatch_score || 0),
    pickup_distance_miles: asMoney(driver.pickup_distance_miles || 0, 0),
    avg_response_seconds: asMoney(driver.avg_response_seconds || 0, 0),
    acceptance_ratio: asMoney(driver.acceptance_ratio || 0, 0),
    active_offer_count: safeNumber(driver.active_offer_count, 0),
    metadata: {
      driver_rating: driver.rating || null,
      vehicle_make: driver.vehicle_make || null,
      vehicle_model: driver.vehicle_model || null,
      vehicle_color: driver.vehicle_color || null,
      pickup_coordinate_source: driver.pickup_coordinate_source || null
    },
    created_at: nowISO(),
    updated_at: nowISO()
  };

  const dispatch = await safeInsert("dispatches", dispatchPayload);

  await logTripEvent(ride.id, "dispatch_offered", {
    dispatch_id: dispatch.id,
    driver_id: driver.id,
    attempt_number: attemptNumber,
    offer_expires_at: dispatch.offer_expires_at,
    score: dispatch.score,
    pickup_distance_miles: dispatch.pickup_distance_miles,
    avg_response_seconds: dispatch.avg_response_seconds
  });

  await logAdminEvent("dispatch_offered_v2", {
    ride_id: ride.id,
    dispatch_id: dispatch.id,
    driver_id: driver.id,
    attempt_number: attemptNumber,
    score: dispatch.score
  });

  return dispatch;
}

async function assignSmartDispatchForRide(ride, options = {}) {
  const attemptedDriverIds =
    options.excludeAttempted === false
      ? new Set()
      : await getRideAttemptedDriverIds(ride.id);

  const extraExclusions = new Set(
    (options.excludeDriverIds || []).map(cleanEnv).filter(Boolean)
  );

  const mergedExclusions = new Set([
    ...attemptedDriverIds,
    ...extraExclusions
  ]);

  const candidates = await getEligibleDriversForRideSmart(ride, {
    excludeDriverIds: [...mergedExclusions]
  });

  if (!candidates.length) {
    await markRideNoDriverAvailable(
      ride.id,
      Number(ride.dispatch_attempts || 0),
      mergedExclusions.size ? "no_remaining_candidates" : "no_eligible_drivers"
    );

    return {
      dispatched: false,
      reason: mergedExclusions.size ? "no_remaining_candidates" : "no_eligible_drivers",
      ride_status: "no_driver_available",
      candidate_count: 0
    };
  }

  const selectedDriver = candidates[0];
  const attemptNumber = Number(ride.dispatch_attempts || 0) + 1;

  const dispatch = await createDispatchOfferV2({
    ride,
    driver: selectedDriver,
    attemptNumber
  });

  const updatedRide = await markRideAwaitingDriverAcceptance(
    ride.id,
    selectedDriver.id,
    dispatch.id,
    attemptNumber
  );

  return {
    dispatched: true,
    reason: null,
    ride: updatedRide,
    candidate_count: candidates.length,
    selected_driver: {
      id: selectedDriver.id,
      first_name: selectedDriver.first_name || null,
      last_name: selectedDriver.last_name || null,
      driver_type: selectedDriver.driver_type || null,
      rating: selectedDriver.rating || null,
      pickup_distance_miles: selectedDriver.pickup_distance_miles || null,
      avg_response_seconds: selectedDriver.avg_response_seconds || null,
      acceptance_ratio: selectedDriver.acceptance_ratio || null,
      vehicle_make: selectedDriver.vehicle_make || null,
      vehicle_model: selectedDriver.vehicle_model || null,
      vehicle_color: selectedDriver.vehicle_color || null,
      vehicle_plate: selectedDriver.vehicle_plate || null
    },
    dispatch
  };
}

/* =========================================================
   SMART REDISPATCH
========================================================= */
async function redispatchRideIfEligibleV2(rideId) {
  if (!ENABLE_AUTO_REDISPATCH) {
    return {
      redispatched: false,
      reason: "auto_redispatch_disabled"
    };
  }

  const ride = await getRideById(rideId);
  const attempts = Number(ride.dispatch_attempts || 0);

  if (attempts >= MAX_DISPATCH_ATTEMPTS) {
    await markRideNoDriverAvailable(
      ride.id,
      attempts,
      "max_dispatch_attempts_reached"
    );
    return {
      redispatched: false,
      reason: "max_dispatch_attempts_reached"
    };
  }

  const openDispatch = await getOpenRideDispatch(ride.id);
  if (openDispatch) {
    return {
      redispatched: false,
      reason: "open_dispatch_exists",
      dispatch_id: openDispatch.id
    };
  }

  const result = await assignSmartDispatchForRide(ride, {
    excludeAttempted: true
  });

  return {
    redispatched: !!result.dispatched,
    reason: result.reason || null,
    candidate_count: result.candidate_count || 0,
    selected_driver: result.selected_driver || null,
    dispatch: result.dispatch || null
  };
}

/* =========================================================
   DISPATCH EXPIRY SWEEPER
========================================================= */
async function sweepExpiredDispatches() {
  if (!supabase) return;
  if (!ENABLE_AUTO_REDISPATCH) return;

  try {
    const { data, error } = await supabase
      .from("dispatches")
      .select("*")
      .eq("status", "offered")
      .lte("offer_expires_at", nowISO())
      .order("offer_expires_at", { ascending: true })
      .limit(25);

    if (error) throw error;

    for (const dispatch of data || []) {
      try {
        await expireDispatch(dispatch.id, "sweeper_timeout");
        await redispatchRideIfEligibleV2(dispatch.ride_id);
      } catch (innerError) {
        console.warn(
          `⚠️ dispatch sweeper failed for ${dispatch.id}:`,
          innerError.message
        );
      }
    }
  } catch (error) {
    console.warn("⚠️ expired dispatch sweep failed:", error.message);
  }
}

/* =========================================================
   SMART DISPATCH ROUTES
========================================================= */
app.post("/api/rides/:rideId/dispatch-v2", async (req, res) => {
  try {
    requireSupabase();

    const rideId = cleanEnv(req.params.rideId);
    if (!rideId) {
      return fail(res, 400, "rideId is required");
    }

    const ride = await getRideById(rideId);

    if (!isRideDispatchableStatus(ride.status)) {
      return fail(
        res,
        409,
        `Ride cannot be dispatched from status: ${ride.status || "unknown"}`
      );
    }

    const result = await assignSmartDispatchForRide(ride, {
      excludeAttempted: normalizeBoolean(req.body?.exclude_attempted, true)
    });

    return ok(res, {
      message: result.dispatched
        ? "Smart dispatch created"
        : "No eligible drivers available",
      ...result
    });
  } catch (error) {
    console.error("❌ /api/rides/:rideId/dispatch-v2 failed:", error);
    return fail(
      res,
      Number(error.statusCode || 500),
      error.message || "Dispatch failed",
      error.details ? { details: error.details } : {}
    );
  }
});

app.get("/api/rides/:rideId/dispatch-candidates", async (req, res) => {
  try {
    requireSupabase();

    const rideId = cleanEnv(req.params.rideId);
    if (!rideId) {
      return fail(res, 400, "rideId is required");
    }

    const ride = await getRideById(rideId);
    const attemptedDriverIds = await getRideAttemptedDriverIds(ride.id);
    const candidates = await getEligibleDriversForRideSmart(ride, {
      excludeDriverIds: [...attemptedDriverIds]
    });

    return ok(res, {
      ride_id: ride.id,
      candidate_count: candidates.length,
      candidates: candidates.map((candidate) => ({
        id: candidate.id,
        first_name: candidate.first_name || null,
        last_name: candidate.last_name || null,
        rating: candidate.rating || null,
        driver_type: candidate.driver_type || null,
        pickup_distance_miles: candidate.pickup_distance_miles || null,
        avg_response_seconds: candidate.avg_response_seconds || null,
        acceptance_ratio: candidate.acceptance_ratio || null,
        active_offer_count: candidate.active_offer_count || 0,
        dispatch_score: candidate.dispatch_score || 0,
        vehicle_make: candidate.vehicle_make || null,
        vehicle_model: candidate.vehicle_model || null,
        vehicle_color: candidate.vehicle_color || null,
        vehicle_plate: candidate.vehicle_plate || null
      }))
    });
  } catch (error) {
    console.error("❌ /api/rides/:rideId/dispatch-candidates failed:", error);
    return fail(
      res,
      Number(error.statusCode || 500),
      error.message || "Unable to fetch dispatch candidates"
    );
  }
});

app.post("/api/dispatches/:dispatchId/reject-v2", async (req, res) => {
  try {
    const dispatchId = cleanEnv(req.params.dispatchId);
    const driverId = cleanEnv(req.body?.driver_id || req.body?.driverId);
    const reason = cleanEnv(req.body?.reason || "driver_rejected");

    if (!dispatchId) {
      return fail(res, 400, "dispatchId is required");
    }

    if (!driverId) {
      return fail(res, 400, "driver_id is required");
    }

    const ownedDispatch = await assertDispatchDriverAccess(dispatchId, driverId);
    const dispatch = await rejectDispatch(dispatchId, reason);
    const redispatch = await redispatchRideIfEligibleV2(ownedDispatch.ride_id);

    return ok(res, {
      message: "Dispatch rejected",
      dispatch,
      redispatch
    });
  } catch (error) {
    console.error("❌ /api/dispatches/:dispatchId/reject-v2 failed:", error);
    return fail(
      res,
      Number(error.statusCode || 500),
      error.message || "Dispatch reject failed",
      error.details ? { details: error.details } : {}
    );
  }
});

app.post("/api/dispatches/:dispatchId/expire-v2", async (req, res) => {
  try {
    const dispatchId = cleanEnv(req.params.dispatchId);
    const driverId = cleanEnv(req.body?.driver_id || req.body?.driverId);
    const reason = cleanEnv(req.body?.reason || "timeout");

    if (!dispatchId) {
      return fail(res, 400, "dispatchId is required");
    }

    if (!driverId) {
      return fail(res, 400, "driver_id is required");
    }

    const ownedDispatch = await assertDispatchDriverAccess(dispatchId, driverId);
    const dispatch = await expireDispatch(dispatchId, reason);
    const redispatch = await redispatchRideIfEligibleV2(ownedDispatch.ride_id);

    return ok(res, {
      message: "Dispatch expired",
      dispatch,
      redispatch
    });
  } catch (error) {
    console.error("❌ /api/dispatches/:dispatchId/expire-v2 failed:", error);
    return fail(
      res,
      Number(error.statusCode || 500),
      error.message || "Dispatch expire failed",
      error.details ? { details: error.details } : {}
    );
  }
});

/* =========================================================
   OPTIONAL SWEEPER STARTUP
========================================================= */
const DISPATCH_SWEEP_INTERVAL_MS = toNumber(
  process.env.DISPATCH_SWEEP_INTERVAL_MS,
  15000
);

if (ENABLE_AUTO_REDISPATCH) {
  setInterval(() => {
    sweepExpiredDispatches().catch((error) => {
      console.warn("⚠️ dispatch sweep interval failure:", error.message);
    });
  }, DISPATCH_SWEEP_INTERVAL_MS);
}/* =========================================================
   PART 5 — LIVE RIDE STATUS + MISSION ENDPOINTS
========================================================= */

/* =========================================================
   MISSION / RIDE STATUS HELPERS
========================================================= */
function isDriverMissionVisibleStatus(status = "") {
  return [
    "awaiting_driver_acceptance",
    "dispatched",
    "driver_en_route",
    "arrived",
    "in_progress"
  ].includes(lower(status));
}

function isDriverMissionTerminalStatus(status = "") {
  return ["completed", "cancelled", "no_driver_available"].includes(lower(status));
}

function getEtaMinutesFromDistanceMiles(distanceMiles = 0) {
  const miles = Number(distanceMiles || 0);
  if (!Number.isFinite(miles) || miles <= 0) return 0;
  const avgApproachMph = 24;
  return asMoney((miles / avgApproachMph) * 60, 0);
}

async function getLatestDriverLocation(driverId) {
  requireSupabase();

  const { data, error } = await supabase
    .from("driver_locations")
    .select("*")
    .eq("driver_id", driverId)
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) {
    const err = new Error(error.message || "Unable to fetch driver location");
    err.statusCode = 500;
    throw err;
  }

  return data?.[0] || null;
}

async function getRideActiveDispatch(rideId) {
  requireSupabase();

  const { data, error } = await supabase
    .from("dispatches")
    .select("*")
    .eq("ride_id", rideId)
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) {
    const err = new Error(error.message || "Unable to fetch ride dispatch");
    err.statusCode = 500;
    throw err;
  }

  return data?.[0] || null;
}

async function buildRideLivePayload(ride) {
  let driver = null;
  let driverLocation = null;
  let dispatch = null;
  let etaMinutes = null;
  let timeline = [];

  if (cleanEnv(ride.driver_id)) {
    try {
      driver = await getDriverById(ride.driver_id);
    } catch (error) {
      console.warn("⚠️ buildRideLivePayload driver lookup failed:", error.message);
    }

    try {
      driverLocation = await getLatestDriverLocation(ride.driver_id);
    } catch (error) {
      console.warn(
        "⚠️ buildRideLivePayload driver location lookup failed:",
        error.message
      );
    }
  }

  try {
    dispatch = await getRideActiveDispatch(ride.id);
  } catch (error) {
    console.warn("⚠️ buildRideLivePayload dispatch lookup failed:", error.message);
  }

  if (driverLocation && Number.isFinite(Number(driverLocation.lat))) {
    const pickupLat = Number(ride.pickup_lat);
    const pickupLng = Number(ride.pickup_lng);
    const driverLat = Number(driverLocation.lat);
    const driverLng = Number(driverLocation.lng);

    if (
      Number.isFinite(pickupLat) &&
      Number.isFinite(pickupLng) &&
      Number.isFinite(driverLat) &&
      Number.isFinite(driverLng)
    ) {
      const milesAway = computeDistanceMilesBetweenPoints(
        driverLat,
        driverLng,
        pickupLat,
        pickupLng
      );
      etaMinutes = getEtaMinutesFromDistanceMiles(milesAway);
    }
  }

  if (ENABLE_TRIP_TIMELINE) {
    try {
      timeline = await getRideTimelineEntries(ride.id);
    } catch (error) {
      console.warn("⚠️ buildRideLivePayload timeline lookup failed:", error.message);
    }
  }

  return {
    ride,
    dispatch,
    driver: driver
      ? {
          id: driver.id,
          first_name: driver.first_name || null,
          last_name: driver.last_name || null,
          phone: driver.phone || null,
          rating: driver.rating || null,
          driver_type: driver.driver_type || null,
          vehicle_make: driver.vehicle_make || null,
          vehicle_model: driver.vehicle_model || null,
          vehicle_color: driver.vehicle_color || null,
          vehicle_plate: driver.vehicle_plate || null,
          status: driver.status || null
        }
      : null,
    driver_location: driverLocation,
    eta_minutes: etaMinutes,
    timeline
  };
}

async function clearCompetingDriverOffersForRide(rideId, acceptedDispatchId) {
  if (!supabase) return true;

  try {
    const { error } = await supabase
      .from("dispatches")
      .update({
        status: "closed",
        updated_at: nowISO()
      })
      .eq("ride_id", rideId)
      .neq("id", acceptedDispatchId)
      .eq("status", "offered");

    if (error) throw error;
  } catch (error) {
    console.warn("⚠️ clearCompetingDriverOffersForRide failed:", error.message);
  }

  return true;
}

async function attachMissionToDriver(driverId, rideId) {
  return safeUpdateById("drivers", driverId, {
    current_ride_id: rideId,
    current_mission_id: rideId,
    status: "assigned",
    updated_at: nowISO()
  });
}

async function releaseDriverMission(driverId) {
  return safeUpdateById("drivers", driverId, {
    current_ride_id: null,
    current_mission_id: null,
    status: "available",
    updated_at: nowISO()
  });
}

/* =========================================================
   ENHANCED DISPATCH ACCEPT
========================================================= */
async function acceptDispatchV2(dispatchId) {
  const dispatch = await getDispatchById(dispatchId);

  if (lower(dispatch.status) !== "offered") {
    const err = new Error(`Dispatch cannot be accepted from status: ${dispatch.status}`);
    err.statusCode = 409;
    throw err;
  }

  const updatedDispatch = await safeUpdateById("dispatches", dispatchId, {
    status: "accepted",
    accepted_at: nowISO(),
    responded_at: nowISO(),
    updated_at: nowISO()
  });

  await safeUpdateById("rides", dispatch.ride_id, {
    status: "dispatched",
    driver_id: dispatch.driver_id,
    dispatch_id: dispatch.id,
    updated_at: nowISO()
  });

  await attachMissionToDriver(dispatch.driver_id, dispatch.ride_id);
  await clearCompetingDriverOffersForRide(dispatch.ride_id, dispatch.id);

  await logTripEvent(dispatch.ride_id, "dispatch_accepted", {
    dispatch_id: dispatch.id,
    driver_id: dispatch.driver_id
  });

  await logTripEvent(dispatch.ride_id, "mission_assigned", {
    dispatch_id: dispatch.id,
    driver_id: dispatch.driver_id
  });

  await logAdminEvent("dispatch_accepted_v2", {
    ride_id: dispatch.ride_id,
    dispatch_id: dispatch.id,
    driver_id: dispatch.driver_id
  });

  return updatedDispatch;
}

/* =========================================================
   DRIVER MISSION LOOKUP
========================================================= */
async function getDriverMissionRides(driverId) {
  requireSupabase();

  const { data, error } = await supabase
    .from("rides")
    .select("*")
    .eq("driver_id", driverId)
    .order("updated_at", { ascending: false });

  if (error) {
    const err = new Error(error.message || "Unable to fetch driver missions");
    err.statusCode = 500;
    throw err;
  }

  return (data || []).filter((ride) => isDriverMissionVisibleStatus(ride.status));
}

async function getDriverPendingDispatchOffers(driverId) {
  requireSupabase();

  const { data, error } = await supabase
    .from("dispatches")
    .select("*")
    .eq("driver_id", driverId)
    .eq("status", "offered")
    .order("created_at", { ascending: false });

  if (error) {
    const err = new Error(error.message || "Unable to fetch driver dispatch offers");
    err.statusCode = 500;
    throw err;
  }

  return data || [];
}

/* =========================================================
   LIVE RIDE STATUS ROUTES
========================================================= */
app.get("/api/rides/:rideId/live-status", async (req, res) => {
  try {
    const rideId = cleanEnv(req.params.rideId);
    if (!rideId) return fail(res, 400, "rideId is required");

    const ride = await getRideById(rideId);
    const payload = await buildRideLivePayload(ride);

    return ok(res, {
      message: "Live ride status fetched",
      ...payload
    });
  } catch (error) {
    console.error("❌ /api/rides/:rideId/live-status failed:", error);
    return fail(
      res,
      Number(error.statusCode || 500),
      error.message || "Unable to fetch live ride status"
    );
  }
});

app.get("/api/rides/:rideId/status", async (req, res) => {
  try {
    const rideId = cleanEnv(req.params.rideId);
    if (!rideId) return fail(res, 400, "rideId is required");

    const ride = await getRideById(rideId);

    return ok(res, {
      ride_id: ride.id,
      status: ride.status,
      driver_id: ride.driver_id || null,
      dispatch_id: ride.dispatch_id || null,
      updated_at: ride.updated_at || null
    });
  } catch (error) {
    console.error("❌ /api/rides/:rideId/status failed:", error);
    return fail(
      res,
      Number(error.statusCode || 500),
      error.message || "Unable to fetch ride status"
    );
  }
});

/* =========================================================
   DRIVER MISSION ROUTES
========================================================= */
app.get("/api/drivers/:driverId/missions", async (req, res) => {
  try {
    const driverId = cleanEnv(req.params.driverId);
    if (!driverId) return fail(res, 400, "driverId is required");

    const [missions, offers] = await Promise.all([
      getDriverMissionRides(driverId),
      getDriverPendingDispatchOffers(driverId)
    ]);

    return ok(res, {
      driver_id: driverId,
      active_mission_count: missions.length,
      active_offer_count: offers.length,
      missions,
      offers
    });
  } catch (error) {
    console.error("❌ /api/drivers/:driverId/missions failed:", error);
    return fail(
      res,
      Number(error.statusCode || 500),
      error.message || "Unable to fetch driver missions"
    );
  }
});

app.get("/api/drivers/:driverId/mission-feed", async (req, res) => {
  try {
    const driverId = cleanEnv(req.params.driverId);
    if (!driverId) return fail(res, 400, "driverId is required");

    const offers = await getDriverPendingDispatchOffers(driverId);
    const enriched = [];

    for (const offer of offers) {
      try {
        const ride = await getRideById(offer.ride_id);
        enriched.push({
          dispatch_id: offer.id,
          attempt_number: offer.attempt_number || 1,
          score: offer.score || 0,
          offer_expires_at: offer.offer_expires_at || null,
          ride: {
            id: ride.id,
            status: ride.status,
            requested_mode: ride.requested_mode || null,
            ride_type: ride.ride_type || null,
            pickup_address: ride.pickup_address || null,
            destination_address: ride.destination_address || null,
            estimated_total: ride.estimated_total || null,
            estimated_miles: ride.estimated_miles || null,
            estimated_minutes: ride.estimated_minutes || null,
            notes: ride.notes || null
          }
        });
      } catch (error) {
        console.warn("⚠️ mission-feed ride enrichment failed:", error.message);
      }
    }

    return ok(res, {
      driver_id: driverId,
      count: enriched.length,
      offers: enriched
    });
  } catch (error) {
    console.error("❌ /api/drivers/:driverId/mission-feed failed:", error);
    return fail(
      res,
      Number(error.statusCode || 500),
      error.message || "Unable to fetch mission feed"
    );
  }
});

/* =========================================================
   DRIVER ACCEPT / REJECT FLOW V2
========================================================= */
app.post("/api/dispatches/:dispatchId/accept-v2", async (req, res) => {
  try {
    const dispatchId = cleanEnv(req.params.dispatchId);
    const driverId = cleanEnv(req.body?.driver_id || req.body?.driverId);

    if (!dispatchId) return fail(res, 400, "dispatchId is required");
    if (!driverId) return fail(res, 400, "driver_id is required");

    await assertDispatchDriverAccess(dispatchId, driverId);
    const dispatch = await acceptDispatchV2(dispatchId);
    const ride = await getRideById(dispatch.ride_id);
    const payload = await buildRideLivePayload(ride);

    return ok(res, {
      message: "Dispatch accepted",
      dispatch,
      ...payload
    });
  } catch (error) {
    console.error("❌ /api/dispatches/:dispatchId/accept-v2 failed:", error);
    return fail(
      res,
      Number(error.statusCode || 500),
      error.message || "Dispatch accept failed",
      error.details ? { details: error.details } : {}
    );
  }
});

/* =========================================================
   DRIVER READY / HEARTBEAT
========================================================= */
app.post("/api/drivers/:driverId/heartbeat", async (req, res) => {
  try {
    const driverId = cleanEnv(req.params.driverId);
    if (!driverId) return fail(res, 400, "driverId is required");

    const lat = normalizeCoordinate(req.body?.lat);
    const lng = normalizeCoordinate(req.body?.lng);

    const patch = {
      last_seen_at: nowISO(),
      is_online: true,
      updated_at: nowISO()
    };

    if (Number.isFinite(lat)) patch.last_lat = lat;
    if (Number.isFinite(lng)) patch.last_lng = lng;

    const driver = await safeUpdateById("drivers", driverId, patch);

    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      try {
        await safeInsert("driver_locations", {
          id: generateId("location"),
          driver_id: driverId,
          lat,
          lng,
          created_at: nowISO()
        });
      } catch (error) {
        console.warn("⚠️ heartbeat location insert failed:", error.message);
      }
    }

    return ok(res, {
      message: "Driver heartbeat recorded",
      driver_id: driverId,
      is_online: true,
      last_seen_at: driver.last_seen_at || patch.last_seen_at
    });
  } catch (error) {
    console.error("❌ /api/drivers/:driverId/heartbeat failed:", error);
    return fail(
      res,
      Number(error.statusCode || 500),
      error.message || "Unable to record heartbeat"
    );
  }
});

app.post("/api/drivers/:driverId/ready", async (req, res) => {
  try {
    const driverId = cleanEnv(req.params.driverId);
    if (!driverId) return fail(res, 400, "driverId is required");

    const driver = await safeUpdateById("drivers", driverId, {
      is_online: true,
      status: "available",
      current_ride_id: null,
      current_mission_id: null,
      last_seen_at: nowISO(),
      updated_at: nowISO()
    });

    return ok(res, {
      message: "Driver marked ready",
      driver
    });
  } catch (error) {
    console.error("❌ /api/drivers/:driverId/ready failed:", error);
    return fail(
      res,
      Number(error.statusCode || 500),
      error.message || "Unable to mark driver ready"
    );
  }
});

/* =========================================================
   ENHANCED RIDE LIFECYCLE PATCHES
========================================================= */
app.post("/api/rides/:rideId/driver-arrived-v2", async (req, res) => {
  try {
    const rideId = cleanEnv(req.params.rideId);
    const driverId = cleanEnv(req.body?.driver_id || req.body?.driverId);

    if (!rideId) return fail(res, 400, "rideId is required");
    if (!driverId) return fail(res, 400, "driver_id is required");

    const ride = await getRideById(rideId);
    const driver = await getDriverById(driverId);

    if (!canDriverOperateRide(driver, ride)) {
      return fail(res, 403, "Driver is not eligible to arrive for this ride");
    }

    const updatedRide = await updateRideStatus(rideId, "arrived", {
      driver_id: driverId
    });

    await updateDriverStatus(driverId, "arrived", {
      current_ride_id: rideId,
      current_mission_id: rideId
    });

    await logTripEvent(rideId, "driver_arrived", {
      driver_id: driverId
    });

    const payload = await buildRideLivePayload(updatedRide);

    return ok(res, {
      message: "Driver marked arrived",
      ...payload
    });
  } catch (error) {
    console.error("❌ /api/rides/:rideId/driver-arrived-v2 failed:", error);
    return fail(
      res,
      Number(error.statusCode || 500),
      error.message || "Unable to mark driver arrived"
    );
  }
});

app.post("/api/rides/:rideId/start-v2", async (req, res) => {
  try {
    const rideId = cleanEnv(req.params.rideId);
    const driverId = cleanEnv(req.body?.driver_id || req.body?.driverId);

    if (!rideId) return fail(res, 400, "rideId is required");
    if (!driverId) return fail(res, 400, "driver_id is required");

    const ride = await getRideById(rideId);
    const driver = await getDriverById(driverId);

    if (!canDriverOperateRide(driver, ride)) {
      return fail(res, 403, "Driver is not eligible to start this ride");
    }

    if (!isRideStartableStatus(ride.status)) {
      return fail(
        res,
        409,
        `Ride cannot be started from status: ${ride.status || "unknown"}`
      );
    }

    const updatedRide = await updateRideStatus(rideId, "in_progress", {
      driver_id: driverId
    });

    await updateDriverStatus(driverId, "in_progress", {
      current_ride_id: rideId,
      current_mission_id: rideId
    });

    await logTripEvent(rideId, "trip_started", {
      driver_id: driverId
    });

    const payload = await buildRideLivePayload(updatedRide);

    return ok(res, {
      message: "Trip started",
      ...payload
    });
  } catch (error) {
    console.error("❌ /api/rides/:rideId/start-v2 failed:", error);
    return fail(
      res,
      Number(error.statusCode || 500),
      error.message || "Unable to start trip"
    );
  }
});

app.post("/api/rides/:rideId/complete-v2", async (req, res) => {
  try {
    const rideId = cleanEnv(req.params.rideId);
    const driverId = cleanEnv(req.body?.driver_id || req.body?.driverId);
    const finalTotal = Number(req.body?.final_total || req.body?.finalTotal || 0);
    const tipAmount = Number(req.body?.tip_amount || req.body?.tipAmount || 0);

    if (!rideId) return fail(res, 400, "rideId is required");
    if (!driverId) return fail(res, 400, "driver_id is required");

    const ride = await getRideById(rideId);
    const driver = await getDriverById(driverId);

    if (!canDriverOperateRide(driver, ride)) {
      return fail(res, 403, "Driver is not eligible to complete this ride");
    }

    if (!isRideCompletableStatus(ride.status)) {
      return fail(
        res,
        409,
        `Ride cannot be completed from status: ${ride.status || "unknown"}`
      );
    }

    const resolvedFinalTotal = asMoney(
      finalTotal > 0 ? finalTotal : Number(ride.estimated_total || 0),
      0
    );

    const updatedRide = await updateRideStatus(rideId, "completed", {
      driver_id: driverId,
      final_total: resolvedFinalTotal
    });

    await releaseDriverMission(driverId);

    const earnings = await createDriverEarningsLedgerEntry({
      ...updatedRide,
      final_total: resolvedFinalTotal
    });

    let tip = null;
    if (tipAmount > 0) {
      tip = await createTipRecord({
        rideId,
        riderId: updatedRide.rider_id,
        driverId,
        amount: tipAmount,
        source: "post_trip"
      });
    }

    await logTripEvent(rideId, "trip_completed", {
      driver_id: driverId,
      final_total: resolvedFinalTotal,
      tip_amount: tipAmount > 0 ? asMoney(tipAmount) : 0
    });

    await logAdminEvent("trip_completed_v2", {
      ride_id: rideId,
      driver_id: driverId,
      final_total: resolvedFinalTotal
    });

    return ok(res, {
      message: "Trip completed",
      ride: updatedRide,
      earnings,
      tip
    });
  } catch (error) {
    console.error("❌ /api/rides/:rideId/complete-v2 failed:", error);
    return fail(
      res,
      Number(error.statusCode || 500),
      error.message || "Unable to complete trip"
    );
  }
});

app.post("/api/rides/:rideId/cancel-v2", async (req, res) => {
  try {
    const rideId = cleanEnv(req.params.rideId);
    const cancelledBy = cleanEnv(
      req.body?.cancelled_by || req.body?.cancelledBy || "unknown"
    );
    const reason = cleanEnv(req.body?.reason || "cancelled");

    if (!rideId) return fail(res, 400, "rideId is required");

    const ride = await getRideById(rideId);

    if (!isRideCancellableStatus(ride.status)) {
      return fail(
        res,
        409,
        `Ride cannot be cancelled from status: ${ride.status || "unknown"}`
      );
    }

    const updatedRide = await updateRideStatus(rideId, "cancelled", {
      cancelled_by: cancelledBy,
      cancellation_reason: reason
    });

    if (cleanEnv(ride.driver_id)) {
      await releaseDriverMission(ride.driver_id);
    }

    await logTripEvent(rideId, "trip_cancelled", {
      cancelled_by: cancelledBy,
      reason
    });

    await logAdminEvent("trip_cancelled_v2", {
      ride_id: rideId,
      cancelled_by: cancelledBy,
      reason
    });

    return ok(res, {
      message: "Trip cancelled",
      ride: updatedRide
    });
  } catch (error) {
    console.error("❌ /api/rides/:rideId/cancel-v2 failed:", error);
    return fail(
      res,
      Number(error.statusCode || 500),
      error.message || "Unable to cancel trip"
    );
  }
});

/* =========================================================
   RIDER LIVE DASHBOARD
========================================================= */
app.get("/api/riders/:riderId/dashboard", async (req, res) => {
  try {
    const riderId = cleanEnv(req.params.riderId);
    if (!riderId) return fail(res, 400, "riderId is required");

    requireSupabase();

    const { data, error } = await supabase
      .from("rides")
      .select("*")
      .eq("rider_id", riderId)
      .order("updated_at", { ascending: false })
      .limit(10);

    if (error) {
      const err = new Error(error.message || "Unable to fetch rider dashboard");
      err.statusCode = 500;
      throw err;
    }

    const rides = data || [];
    const activeRide =
      rides.find((ride) => !isDriverMissionTerminalStatus(ride.status)) || null;

    let live = null;
    if (activeRide) {
      live = await buildRideLivePayload(activeRide);
    }

    return ok(res, {
      rider_id: riderId,
      active_ride: activeRide,
      live,
      recent_rides: rides
    });
  } catch (error) {
    console.error("❌ /api/riders/:riderId/dashboard failed:", error);
    return fail(
      res,
      Number(error.statusCode || 500),
      error.message || "Unable to fetch rider dashboard"
    );
  }
});

/* =========================================================
   DRIVER LIVE DASHBOARD
========================================================= */
app.get("/api/drivers/:driverId/dashboard", async (req, res) => {
  try {
    const driverId = cleanEnv(req.params.driverId);
    if (!driverId) return fail(res, 400, "driverId is required");

    const driver = await getDriverById(driverId);
    const offers = await getDriverPendingDispatchOffers(driverId);
    const missions = await getDriverMissionRides(driverId);

    let currentRide = null;
    let live = null;

    if (cleanEnv(driver.current_ride_id)) {
      try {
        currentRide = await getRideById(driver.current_ride_id);
        live = await buildRideLivePayload(currentRide);
      } catch (error) {
        console.warn("⚠️ driver dashboard current ride lookup failed:", error.message);
      }
    }

    return ok(res, {
      driver: {
        id: driver.id,
        first_name: driver.first_name || null,
        last_name: driver.last_name || null,
        status: driver.status || null,
        is_online: !!driver.is_online,
        current_ride_id: driver.current_ride_id || null,
        current_mission_id: driver.current_mission_id || null,
        rating: driver.rating || null
      },
      active_offer_count: offers.length,
      active_mission_count: missions.length,
      offers,
      missions,
      current_ride: currentRide,
      live
    });
  } catch (error) {
    console.error("❌ /api/drivers/:driverId/dashboard failed:", error);
    return fail(
      res,
      Number(error.statusCode || 500),
      error.message || "Unable to fetch driver dashboard"
    );
  }
});/* =========================================================
   PART 6 — PAYMENT AUTHORIZATION + STRIPE-READY FLOW
========================================================= */

/* =========================================================
   PAYMENT CONFIG
========================================================= */
const ENABLE_REAL_STRIPE = toBool(process.env.ENABLE_REAL_STRIPE, false);
const STRIPE_SECRET_KEY = cleanEnv(process.env.STRIPE_SECRET_KEY);
const STRIPE_WEBHOOK_SECRET = cleanEnv(process.env.STRIPE_WEBHOOK_SECRET);
const PAYMENT_AUTH_HOLD_RATE = toNumber(process.env.PAYMENT_AUTH_HOLD_RATE, 1);
const PAYMENT_AUTH_FIXED_BUFFER = toNumber(
  process.env.PAYMENT_AUTH_FIXED_BUFFER,
  5
);

let Stripe = null;
let stripe = null;

try {
  Stripe = require("stripe");
} catch (error) {
  console.warn("⚠️ Stripe SDK not installed. Real Stripe mode unavailable.");
}

if (ENABLE_REAL_STRIPE && STRIPE_SECRET_KEY && Stripe) {
  try {
    stripe = new Stripe(STRIPE_SECRET_KEY);
    console.log("✅ Stripe connected");
  } catch (error) {
    console.warn("⚠️ Stripe init failed:", error.message);
  }
} else {
  console.log("ℹ️ Stripe running in mock / disabled mode");
}

/* =========================================================
   PAYMENT HELPERS
========================================================= */
function toCents(amount = 0) {
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n * 100);
}

function fromCents(cents = 0) {
  const n = Number(cents);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n) / 100;
}

function getPaymentProviderStatus() {
  return {
    enabled: ENABLE_PAYMENT_GATE,
    stripe_configured: !!(ENABLE_REAL_STRIPE && stripe && STRIPE_SECRET_KEY),
    mock_mode: !ENABLE_REAL_STRIPE || !stripe
  };
}

function computeAuthorizationAmount(rideOrEstimate = {}) {
  const estimate = Number(
    rideOrEstimate.estimated_total ||
      rideOrEstimate.final_total ||
      rideOrEstimate.total ||
      0
  );

  const base = Number.isFinite(estimate) ? estimate : 0;
  const withRate = base * Math.max(PAYMENT_AUTH_HOLD_RATE, 1);
  const withBuffer = withRate + Math.max(PAYMENT_AUTH_FIXED_BUFFER, 0);

  return asMoney(Math.max(withBuffer, DEFAULT_MINIMUM_FARE), DEFAULT_MINIMUM_FARE);
}

function normalizePaymentMethodType(value = "") {
  const type = lower(value);
  if (["card", "cash", "apple_pay", "google_pay"].includes(type)) return type;
  return "card";
}

function isPaymentAuthorizedStatus(value = "") {
  return [
    "authorized",
    "preauthorized",
    "pre_authorized",
    "approved",
    "captured"
  ].includes(lower(value));
}

async function getPaymentRecordById(paymentId) {
  requireSupabase();

  const { data, error } = await supabase
    .from("payments")
    .select("*")
    .eq("id", paymentId)
    .single();

  if (error || !data) {
    const err = new Error("Payment record not found");
    err.statusCode = 404;
    err.details = error || null;
    throw err;
  }

  return data;
}

async function getLatestRiderPayment(riderId) {
  requireSupabase();

  const { data, error } = await supabase
    .from("payments")
    .select("*")
    .eq("rider_id", riderId)
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) {
    const err = new Error(error.message || "Unable to fetch rider payment");
    err.statusCode = 500;
    throw err;
  }

  return data?.[0] || null;
}

async function updateRiderPaymentStatus(riderId, payload = {}) {
  requireSupabase();

  const riderPatch = {
    updated_at: nowISO()
  };

  if (Object.prototype.hasOwnProperty.call(payload, "payment_authorized")) {
    riderPatch.payment_authorized = !!payload.payment_authorized;
  }

  if (Object.prototype.hasOwnProperty.call(payload, "payment_status")) {
    riderPatch.payment_status = cleanEnv(payload.payment_status);
  }

  if (Object.prototype.hasOwnProperty.call(payload, "default_payment_method_type")) {
    riderPatch.default_payment_method_type = cleanEnv(
      payload.default_payment_method_type
    );
  }

  const { error } = await supabase
    .from("riders")
    .update(riderPatch)
    .eq("id", riderId);

  if (error) {
    const err = new Error(error.message || "Unable to update rider payment status");
    err.statusCode = 500;
    throw err;
  }

  return true;
}

async function createPaymentRecord(payload = {}) {
  return safeInsert("payments", {
    id: payload.id || generateId("payment"),
    rider_id: cleanEnv(payload.rider_id),
    ride_id: cleanEnv(payload.ride_id) || null,
    payment_method_type: normalizePaymentMethodType(payload.payment_method_type),
    provider: cleanEnv(payload.provider || (stripe ? "stripe" : "mock")),
    provider_payment_intent_id: cleanEnv(payload.provider_payment_intent_id) || null,
    status: cleanEnv(payload.status || "created"),
    currency: cleanEnv(payload.currency || "USD"),
    amount: asMoney(payload.amount || 0, 0),
    authorized_amount: asMoney(payload.authorized_amount || 0, 0),
    captured_amount: asMoney(payload.captured_amount || 0, 0),
    released_amount: asMoney(payload.released_amount || 0, 0),
    refunded_amount: asMoney(payload.refunded_amount || 0, 0),
    metadata: payload.metadata || {},
    created_at: nowISO(),
    updated_at: nowISO()
  });
}

async function markPaymentAuthorized(paymentId, extra = {}) {
  const payment = await safeUpdateById("payments", paymentId, {
    status: "authorized",
    authorized_amount: asMoney(
      extra.authorized_amount ?? extra.amount ?? 0,
      0
    ),
    provider_payment_intent_id:
      cleanEnv(extra.provider_payment_intent_id) || undefined,
    metadata: extra.metadata || undefined,
    updated_at: nowISO()
  });

  if (cleanEnv(payment.rider_id)) {
    await updateRiderPaymentStatus(payment.rider_id, {
      payment_authorized: true,
      payment_status: "authorized",
      default_payment_method_type: payment.payment_method_type || "card"
    });
  }

  return payment;
}

async function markPaymentCaptured(paymentId, capturedAmount, extra = {}) {
  const payment = await safeUpdateById("payments", paymentId, {
    status: "captured",
    captured_amount: asMoney(capturedAmount, 0),
    metadata: extra.metadata || undefined,
    updated_at: nowISO()
  });

  if (cleanEnv(payment.rider_id)) {
    await updateRiderPaymentStatus(payment.rider_id, {
      payment_authorized: true,
      payment_status: "captured",
      default_payment_method_type: payment.payment_method_type || "card"
    });
  }

  return payment;
}

async function markPaymentReleased(paymentId, releasedAmount = 0, extra = {}) {
  const payment = await safeUpdateById("payments", paymentId, {
    status: "released",
    released_amount: asMoney(releasedAmount, 0),
    metadata: extra.metadata || undefined,
    updated_at: nowISO()
  });

  if (cleanEnv(payment.rider_id)) {
    await updateRiderPaymentStatus(payment.rider_id, {
      payment_authorized: false,
      payment_status: "released",
      default_payment_method_type: payment.payment_method_type || "card"
    });
  }

  return payment;
}

async function markPaymentFailed(paymentId, reason = "payment_failed", extra = {}) {
  const payment = await safeUpdateById("payments", paymentId, {
    status: "failed",
    metadata: {
      ...(extra.metadata || {}),
      reason
    },
    updated_at: nowISO()
  });

  if (cleanEnv(payment.rider_id)) {
    await updateRiderPaymentStatus(payment.rider_id, {
      payment_authorized: false,
      payment_status: "failed",
      default_payment_method_type: payment.payment_method_type || "card"
    });
  }

  return payment;
}

/* =========================================================
   MOCK / STRIPE AUTHORIZATION
========================================================= */
async function createMockAuthorization({
  riderId,
  rideId = null,
  amount,
  paymentMethodType = "card",
  metadata = {}
}) {
  const payment = await createPaymentRecord({
    rider_id: riderId,
    ride_id: rideId,
    payment_method_type: paymentMethodType,
    provider: "mock",
    status: "authorized",
    amount,
    authorized_amount: amount,
    metadata: {
      ...metadata,
      mock: true
    }
  });

  await updateRiderPaymentStatus(riderId, {
    payment_authorized: true,
    payment_status: "authorized",
    default_payment_method_type: paymentMethodType
  });

  return {
    provider: "mock",
    payment
  };
}

async function createStripeAuthorization({
  riderId,
  rideId = null,
  amount,
  currency = "usd",
  paymentMethodType = "card",
  customerId = null,
  paymentMethodId = null,
  metadata = {}
}) {
  if (!stripe) {
    throw new Error("Stripe is not configured");
  }

  const paymentIntent = await stripe.paymentIntents.create({
    amount: toCents(amount),
    currency: cleanEnv(currency || "usd").toLowerCase(),
    capture_method: "manual",
    confirm: !!paymentMethodId,
    payment_method: paymentMethodId || undefined,
    customer: customerId || undefined,
    metadata: {
      rider_id: riderId,
      ride_id: rideId || "",
      app: "harvey_taxi",
      ...Object.fromEntries(
        Object.entries(metadata || {}).map(([k, v]) => [k, String(v ?? "")])
      )
    }
  });

  const status = lower(paymentIntent.status);
  const authorizedStatuses = new Set([
    "requires_capture",
    "processing",
    "succeeded"
  ]);

  const payment = await createPaymentRecord({
    rider_id: riderId,
    ride_id: rideId,
    payment_method_type: paymentMethodType,
    provider: "stripe",
    provider_payment_intent_id: paymentIntent.id,
    status: authorizedStatuses.has(status) ? "authorized" : status,
    amount,
    authorized_amount: authorizedStatuses.has(status) ? amount : 0,
    metadata: {
      stripe_status: paymentIntent.status,
      customer_id: customerId || null
    }
  });

  if (authorizedStatuses.has(status)) {
    await updateRiderPaymentStatus(riderId, {
      payment_authorized: true,
      payment_status: "authorized",
      default_payment_method_type: paymentMethodType
    });
  } else {
    await updateRiderPaymentStatus(riderId, {
      payment_authorized: false,
      payment_status: paymentIntent.status || "pending",
      default_payment_method_type: paymentMethodType
    });
  }

  return {
    provider: "stripe",
    payment,
    payment_intent: paymentIntent
  };
}

async function authorizeRiderPayment({
  riderId,
  rideId = null,
  amount,
  paymentMethodType = "card",
  customerId = null,
  paymentMethodId = null,
  metadata = {}
}) {
  if (!ENABLE_PAYMENT_GATE) {
    return {
      payment_gate_enabled: false,
      skipped: true
    };
  }

  if (ENABLE_REAL_STRIPE && stripe) {
    return createStripeAuthorization({
      riderId,
      rideId,
      amount,
      currency: "usd",
      paymentMethodType,
      customerId,
      paymentMethodId,
      metadata
    });
  }

  return createMockAuthorization({
    riderId,
    rideId,
    amount,
    paymentMethodType,
    metadata
  });
}

/* =========================================================
   CAPTURE / RELEASE HELPERS
========================================================= */
async function capturePaymentForRide(ride = {}, options = {}) {
  requireSupabase();

  const riderId = cleanEnv(ride.rider_id);
  if (!riderId) {
    throw new Error("Ride has no rider_id");
  }

  const latestPayment = await getLatestRiderPayment(riderId);
  if (!latestPayment) {
    throw new Error("No payment authorization found for rider");
  }

  const captureAmount = asMoney(
    options.capture_amount ||
      ride.final_total ||
      ride.estimated_total ||
      latestPayment.authorized_amount ||
      latestPayment.amount ||
      0,
    0
  );

  if (ENABLE_REAL_STRIPE && stripe && cleanEnv(latestPayment.provider_payment_intent_id)) {
    const intentId = cleanEnv(latestPayment.provider_payment_intent_id);

    const paymentIntent = await stripe.paymentIntents.capture(intentId, {
      amount_to_capture: toCents(captureAmount)
    });

    const payment = await markPaymentCaptured(latestPayment.id, captureAmount, {
      metadata: {
        stripe_capture_status: paymentIntent.status
      }
    });

    return {
      provider: "stripe",
      payment,
      payment_intent: paymentIntent
    };
  }

  const payment = await markPaymentCaptured(latestPayment.id, captureAmount, {
    metadata: {
      mock: true
    }
  });

  return {
    provider: "mock",
    payment
  };
}

async function releasePaymentAuthorizationForRide(ride = {}, options = {}) {
  requireSupabase();

  const riderId = cleanEnv(ride.rider_id);
  if (!riderId) {
    throw new Error("Ride has no rider_id");
  }

  const latestPayment = await getLatestRiderPayment(riderId);
  if (!latestPayment) {
    return {
      released: false,
      reason: "no_payment_record"
    };
  }

  const releaseAmount = asMoney(
    options.release_amount ||
      latestPayment.authorized_amount ||
      latestPayment.amount ||
      0,
    0
  );

  if (ENABLE_REAL_STRIPE && stripe && cleanEnv(latestPayment.provider_payment_intent_id)) {
    const intentId = cleanEnv(latestPayment.provider_payment_intent_id);

    const paymentIntent = await stripe.paymentIntents.cancel(intentId);

    const payment = await markPaymentReleased(latestPayment.id, releaseAmount, {
      metadata: {
        stripe_release_status: paymentIntent.status
      }
    });

    return {
      released: true,
      provider: "stripe",
      payment,
      payment_intent: paymentIntent
    };
  }

  const payment = await markPaymentReleased(latestPayment.id, releaseAmount, {
    metadata: {
      mock: true
    }
  });

  return {
    released: true,
    provider: "mock",
    payment
  };
}

/* =========================================================
   RIDER PAYMENT ROUTES
========================================================= */
app.get("/api/riders/:riderId/payment-status", async (req, res) => {
  try {
    const riderId = cleanEnv(req.params.riderId);
    if (!riderId) return fail(res, 400, "riderId is required");

    const rider = await getRiderById(riderId);
    const latestPayment = await getLatestRiderPayment(riderId);

    return ok(res, {
      rider_id: riderId,
      payment_authorized: !!rider.payment_authorized,
      payment_status: rider.payment_status || null,
      default_payment_method_type: rider.default_payment_method_type || null,
      latest_payment: latestPayment,
      provider: getPaymentProviderStatus()
    });
  } catch (error) {
    console.error("❌ /api/riders/:riderId/payment-status failed:", error);
    return fail(
      res,
      Number(error.statusCode || 500),
      error.message || "Unable to fetch rider payment status"
    );
  }
});

app.post("/api/riders/:riderId/authorize-payment", async (req, res) => {
  try {
    requireSupabase();

    const riderId = cleanEnv(req.params.riderId);
    if (!riderId) return fail(res, 400, "riderId is required");

    const rider = await getRiderById(riderId);

    if (normalizeBoolean(rider.is_blocked, false)) {
      return fail(res, 403, "Rider account is blocked");
    }

    const rideType = normalizeRideType(req.body?.ride_type || req.body?.rideType);
    const requestedMode = normalizeRequestedMode(
      req.body?.requestedMode || req.body?.mode
    );
    const paymentMethodType = normalizePaymentMethodType(
      req.body?.payment_method_type || req.body?.paymentMethodType || "card"
    );

    const pickupAddress = normalizeAddress(
      req.body?.pickup_address || req.body?.pickupAddress || req.body?.origin
    );

    const destinationAddress = normalizeAddress(
      req.body?.destination_address ||
        req.body?.destinationAddress ||
        req.body?.destination
    );

    const pickupLat = normalizeCoordinate(req.body?.pickup_lat || req.body?.pickupLat);
    const pickupLng = normalizeCoordinate(req.body?.pickup_lng || req.body?.pickupLng);
    const destinationLat = normalizeCoordinate(
      req.body?.destination_lat || req.body?.destinationLat
    );
    const destinationLng = normalizeCoordinate(
      req.body?.destination_lng || req.body?.destinationLng
    );

    const scheduledFor = cleanEnv(req.body?.scheduled_for || req.body?.scheduledFor) || null;
    const customerId = cleanEnv(req.body?.stripe_customer_id || req.body?.customerId) || null;
    const paymentMethodId =
      cleanEnv(req.body?.stripe_payment_method_id || req.body?.paymentMethodId) || null;

    const estimate = await computeLiveFareEstimate({
      rideType,
      requestedMode,
      pickupAddress,
      destinationAddress,
      pickupLat,
      pickupLng,
      destinationLat,
      destinationLng,
      scheduledFor,
      estimatedMiles: Number(req.body?.estimated_miles || req.body?.estimatedMiles || 0),
      estimatedMinutes: Number(
        req.body?.estimated_minutes || req.body?.estimatedMinutes || 0
      )
    });

    const authorizationAmount = computeAuthorizationAmount(estimate);

    const result = await authorizeRiderPayment({
      riderId,
      amount: authorizationAmount,
      paymentMethodType,
      customerId,
      paymentMethodId,
      metadata: {
        ride_type: rideType,
        requested_mode: requestedMode,
        estimate_total: estimate.estimated_total
      }
    });

    await logAdminEvent("payment_authorized", {
      rider_id: riderId,
      payment_id: result.payment?.id || null,
      provider: result.provider,
      authorization_amount: authorizationAmount
    });

    return ok(
      res,
      {
        message: "Payment authorization processed",
        rider_id: riderId,
        authorization_amount: authorizationAmount,
        fare_estimate: estimate,
        provider: result.provider,
        payment: result.payment,
        payment_intent_client_secret:
          result.payment_intent?.client_secret || null
      },
      201
    );
  } catch (error) {
    console.error("❌ /api/riders/:riderId/authorize-payment failed:", error);
    return fail(
      res,
      Number(error.statusCode || 500),
      error.message || "Unable to authorize payment"
    );
  }
});

app.post("/api/rides/:rideId/capture-payment", async (req, res) => {
  try {
    const rideId = cleanEnv(req.params.rideId);
    if (!rideId) return fail(res, 400, "rideId is required");

    const ride = await getRideById(rideId);
    const captureAmount = Number(
      req.body?.capture_amount || req.body?.captureAmount || 0
    );

    const result = await capturePaymentForRide(ride, {
      capture_amount: captureAmount > 0 ? captureAmount : undefined
    });

    await logAdminEvent("payment_captured", {
      ride_id: rideId,
      rider_id: ride.rider_id,
      payment_id: result.payment?.id || null,
      amount: result.payment?.captured_amount || captureAmount || null
    });

    return ok(res, {
      message: "Payment captured",
      ride_id: rideId,
      ...result
    });
  } catch (error) {
    console.error("❌ /api/rides/:rideId/capture-payment failed:", error);
    return fail(
      res,
      Number(error.statusCode || 500),
      error.message || "Unable to capture payment"
    );
  }
});

app.post("/api/rides/:rideId/release-payment", async (req, res) => {
  try {
    const rideId = cleanEnv(req.params.rideId);
    if (!rideId) return fail(res, 400, "rideId is required");

    const ride = await getRideById(rideId);
    const releaseAmount = Number(
      req.body?.release_amount || req.body?.releaseAmount || 0
    );

    const result = await releasePaymentAuthorizationForRide(ride, {
      release_amount: releaseAmount > 0 ? releaseAmount : undefined
    });

    await logAdminEvent("payment_released", {
      ride_id: rideId,
      rider_id: ride.rider_id,
      released: !!result.released
    });

    return ok(res, {
      message: "Payment authorization released",
      ride_id: rideId,
      ...result
    });
  } catch (error) {
    console.error("❌ /api/rides/:rideId/release-payment failed:", error);
    return fail(
      res,
      Number(error.statusCode || 500),
      error.message || "Unable to release payment authorization"
    );
  }
});

/* =========================================================
   SAFER REQUEST-RIDE FLOW WITH PAYMENT CHECK
========================================================= */
app.post("/api/request-ride-v3", async (req, res) => {
  try {
    requireSupabase();

    const input = parseRideRequestBody(req.body || {});
    validateRideRequestInput(input);

    const rider = await getRiderById(input.riderId);

    if (normalizeBoolean(rider.is_blocked, false)) {
      return fail(res, 403, "Rider account is blocked");
    }

    if (normalizeBoolean(rider.is_disabled, false)) {
      return fail(res, 403, "Rider account is disabled");
    }

    if (!isActiveRiderStatus(rider.status)) {
      return fail(res, 403, "Rider account is not active");
    }

    if (
      ENABLE_RIDER_VERIFICATION_GATE &&
      !isApprovedVerificationStatus(rider.verification_status)
    ) {
      return fail(res, 403, "Rider verification is not approved", {
        verification_status: rider.verification_status || "unverified"
      });
    }

    const fareEstimate = await computeLiveFareEstimate({
      rideType: input.rideType,
      requestedMode: input.requestedMode,
      pickupAddress: input.pickupAddress,
      destinationAddress: input.destinationAddress,
      pickupLat: input.pickupLat,
      pickupLng: input.pickupLng,
      destinationLat: input.destinationLat,
      destinationLng: input.destinationLng,
      scheduledFor: input.scheduledFor,
      estimatedMiles: input.estimatedMiles,
      estimatedMinutes: input.estimatedMinutes
    });

    if (ENABLE_PAYMENT_GATE && !hasPaymentAuthorization(rider)) {
      return fail(res, 402, "Payment authorization required before ride request", {
        rider_id: rider.id,
        fare_estimate: fareEstimate,
        next_step: "Call /api/riders/:riderId/authorize-payment first"
      });
    }

    const latestPayment = await getLatestRiderPayment(rider.id);

    const ridePayload = {
      id: generateId("ride"),
      rider_id: rider.id,
      status: "awaiting_dispatch",
      requested_mode: input.requestedMode,
      ride_type: input.rideType,
      pickup_address: input.pickupAddress,
      destination_address: input.destinationAddress,
      notes: input.notes || null,
      pickup_lat: input.pickupLat,
      pickup_lng: input.pickupLng,
      destination_lat: input.destinationLat,
      destination_lng: input.destinationLng,
      scheduled_for: input.scheduledFor,
      estimated_miles: fareEstimate.estimated_miles,
      estimated_minutes: fareEstimate.estimated_minutes,
      estimated_total: fareEstimate.estimated_total,
      subtotal: fareEstimate.subtotal,
      surge_multiplier: fareEstimate.surge_multiplier,
      ride_type_multiplier: fareEstimate.ride_type_multiplier,
      mode_multiplier: fareEstimate.mode_multiplier,
      currency: fareEstimate.currency,
      route_source: fareEstimate.source,
      payment_id: latestPayment?.id || null,
      dispatch_attempts: 0,
      created_at: nowISO(),
      updated_at: nowISO()
    };

    const ride = await safeInsert("rides", ridePayload);

    if (latestPayment?.id) {
      try {
        await safeUpdateById("payments", latestPayment.id, {
          ride_id: ride.id,
          updated_at: nowISO()
        });
      } catch (error) {
        console.warn("⚠️ payment ride attachment failed:", error.message);
      }
    }

    await logTripEvent(ride.id, "ride_requested", {
      rider_id: rider.id,
      requested_mode: input.requestedMode,
      ride_type: input.rideType,
      pickup_address: input.pickupAddress,
      destination_address: input.destinationAddress,
      estimated_total: fareEstimate.estimated_total,
      payment_id: latestPayment?.id || null
    });

    await logAdminEvent("ride_requested_v3", {
      ride_id: ride.id,
      rider_id: rider.id,
      estimated_total: fareEstimate.estimated_total,
      payment_id: latestPayment?.id || null
    });

    return ok(
      res,
      {
        message: "Ride request accepted",
        ride_id: ride.id,
        ride,
        fare_estimate: fareEstimate,
        payment: latestPayment || null
      },
      201
    );
  } catch (error) {
    console.error("❌ /api/request-ride-v3 failed:", error);
    return fail(
      res,
      Number(error.statusCode || 500),
      error.message || "Ride request failed",
      error.details ? { details: error.details } : {}
    );
  }
});

/* =========================================================
   PAYMENT-AWARE COMPLETE / CANCEL HOOKS
========================================================= */
app.post("/api/rides/:rideId/complete-v3", async (req, res) => {
  try {
    const rideId = cleanEnv(req.params.rideId);
    const driverId = cleanEnv(req.body?.driver_id || req.body?.driverId);
    const finalTotal = Number(req.body?.final_total || req.body?.finalTotal || 0);
    const tipAmount = Number(req.body?.tip_amount || req.body?.tipAmount || 0);

    if (!rideId) return fail(res, 400, "rideId is required");
    if (!driverId) return fail(res, 400, "driver_id is required");

    const ride = await getRideById(rideId);
    const driver = await getDriverById(driverId);

    if (!canDriverOperateRide(driver, ride)) {
      return fail(res, 403, "Driver is not eligible to complete this ride");
    }

    if (!isRideCompletableStatus(ride.status)) {
      return fail(
        res,
        409,
        `Ride cannot be completed from status: ${ride.status || "unknown"}`
      );
    }

    const resolvedFinalTotal = asMoney(
      finalTotal > 0 ? finalTotal : Number(ride.estimated_total || 0),
      0
    );

    const updatedRide = await updateRideStatus(rideId, "completed", {
      driver_id: driverId,
      final_total: resolvedFinalTotal
    });

    await releaseDriverMission(driverId);

    let paymentResult = null;
    if (ENABLE_PAYMENT_GATE && cleanEnv(updatedRide.rider_id)) {
      try {
        paymentResult = await capturePaymentForRide(updatedRide, {
          capture_amount: resolvedFinalTotal
        });
      } catch (error) {
        console.warn("⚠️ ride completion payment capture failed:", error.message);
      }
    }

    const earnings = await createDriverEarningsLedgerEntry({
      ...updatedRide,
      final_total: resolvedFinalTotal
    });

    let tip = null;
    if (tipAmount > 0) {
      tip = await createTipRecord({
        rideId,
        riderId: updatedRide.rider_id,
        driverId,
        amount: tipAmount,
        source: "post_trip"
      });
    }

    await logTripEvent(rideId, "trip_completed", {
      driver_id: driverId,
      final_total: resolvedFinalTotal,
      tip_amount: tipAmount > 0 ? asMoney(tipAmount) : 0,
      payment_captured: !!paymentResult?.payment
    });

    await logAdminEvent("trip_completed_v3", {
      ride_id: rideId,
      driver_id: driverId,
      final_total: resolvedFinalTotal
    });

    return ok(res, {
      message: "Trip completed",
      ride: updatedRide,
      payment: paymentResult,
      earnings,
      tip
    });
  } catch (error) {
    console.error("❌ /api/rides/:rideId/complete-v3 failed:", error);
    return fail(
      res,
      Number(error.statusCode || 500),
      error.message || "Unable to complete trip"
    );
  }
});

app.post("/api/rides/:rideId/cancel-v3", async (req, res) => {
  try {
    const rideId = cleanEnv(req.params.rideId);
    const cancelledBy = cleanEnv(
      req.body?.cancelled_by || req.body?.cancelledBy || "unknown"
    );
    const reason = cleanEnv(req.body?.reason || "cancelled");

    if (!rideId) return fail(res, 400, "rideId is required");

    const ride = await getRideById(rideId);

    if (!isRideCancellableStatus(ride.status)) {
      return fail(
        res,
        409,
        `Ride cannot be cancelled from status: ${ride.status || "unknown"}`
      );
    }

    const updatedRide = await updateRideStatus(rideId, "cancelled", {
      cancelled_by: cancelledBy,
      cancellation_reason: reason
    });

    if (cleanEnv(ride.driver_id)) {
      await releaseDriverMission(ride.driver_id);
    }

    let paymentResult = null;
    if (ENABLE_PAYMENT_GATE && cleanEnv(updatedRide.rider_id)) {
      try {
        paymentResult = await releasePaymentAuthorizationForRide(updatedRide);
      } catch (error) {
        console.warn("⚠️ ride cancellation payment release failed:", error.message);
      }
    }

    await logTripEvent(rideId, "trip_cancelled", {
      cancelled_by: cancelledBy,
      reason,
      payment_released: !!paymentResult?.released
    });

    await logAdminEvent("trip_cancelled_v3", {
      ride_id: rideId,
      cancelled_by: cancelledBy,
      reason
    });

    return ok(res, {
      message: "Trip cancelled",
      ride: updatedRide,
      payment: paymentResult
    });
  } catch (error) {
    console.error("❌ /api/rides/:rideId/cancel-v3 failed:", error);
    return fail(
      res,
      Number(error.statusCode || 500),
      error.message || "Unable to cancel trip"
    );
  }
});

/* =========================================================
   STRIPE WEBHOOK SCAFFOLD
========================================================= */
app.post("/api/payments/stripe-webhook", async (req, res) => {
  try {
    if (!stripe || !STRIPE_WEBHOOK_SECRET) {
      return res.status(200).json({
        received: true,
        message: "Stripe webhook ignored because Stripe is not configured"
      });
    }

    return res.status(200).json({
      received: true,
      message: "Stripe webhook endpoint scaffold ready"
    });
  } catch (error) {
    console.error("❌ /api/payments/stripe-webhook failed:", error);
    return res.status(400).json({
      received: false,
      error: error.message
    });
  }
});

/* =========================================================
   ADMIN PAYMENT VISIBILITY
========================================================= */
app.get("/api/admin/payments", async (req, res) => {
  try {
    assertAdmin(req);
    requireSupabase();

    const { limit, offset } = parsePagination(req);
    const riderId = cleanEnv(req.query?.rider_id || req.query?.riderId);
    const rideId = cleanEnv(req.query?.ride_id || req.query?.rideId);
    const status = cleanEnv(req.query?.status);

    let query = supabase
      .from("payments")
      .select("*")
      .order("created_at", { ascending: false });

    if (riderId) query = query.eq("rider_id", riderId);
    if (rideId) query = query.eq("ride_id", rideId);
    if (status) query = query.eq("status", status);

    const { data, error } = await query.range(offset, offset + limit - 1);

    if (error) {
      const err = new Error(error.message || "Unable to fetch payments");
      err.statusCode = 500;
      throw err;
    }

    const payments = data || [];
    const totals = payments.reduce(
      (acc, payment) => {
        acc.amount += Number(payment.amount || 0);
        acc.authorized += Number(payment.authorized_amount || 0);
        acc.captured += Number(payment.captured_amount || 0);
        acc.released += Number(payment.released_amount || 0);
        return acc;
      },
      {
        amount: 0,
        authorized: 0,
        captured: 0,
        released: 0
      }
    );

    return ok(res, {
      count: payments.length,
      limit,
      offset,
      totals: {
        amount: asMoney(totals.amount, 0),
        authorized: asMoney(totals.authorized, 0),
        captured: asMoney(totals.captured, 0),
        released: asMoney(totals.released, 0)
      },
      payments
    });
  } catch (error) {
    console.error("❌ /api/admin/payments failed:", error);
    return fail(
      res,
      Number(error.statusCode || 500),
      error.message || "Unable to fetch admin payments"
    );
  }
});/* =========================================================
   PART 6 — PAYMENT AUTHORIZATION + STRIPE-READY FLOW
========================================================= */

/* =========================================================
   PAYMENT CONFIG
========================================================= */
const ENABLE_REAL_STRIPE = toBool(process.env.ENABLE_REAL_STRIPE, false);
const STRIPE_SECRET_KEY = cleanEnv(process.env.STRIPE_SECRET_KEY);
const STRIPE_WEBHOOK_SECRET = cleanEnv(process.env.STRIPE_WEBHOOK_SECRET);
const PAYMENT_AUTH_HOLD_RATE = toNumber(process.env.PAYMENT_AUTH_HOLD_RATE, 1);
const PAYMENT_AUTH_FIXED_BUFFER = toNumber(
  process.env.PAYMENT_AUTH_FIXED_BUFFER,
  5
);

let Stripe = null;
let stripe = null;

try {
  Stripe = require("stripe");
} catch (error) {
  console.warn("⚠️ Stripe SDK not installed. Real Stripe mode unavailable.");
}

if (ENABLE_REAL_STRIPE && STRIPE_SECRET_KEY && Stripe) {
  try {
    stripe = new Stripe(STRIPE_SECRET_KEY);
    console.log("✅ Stripe connected");
  } catch (error) {
    console.warn("⚠️ Stripe init failed:", error.message);
  }
} else {
  console.log("ℹ️ Stripe running in mock / disabled mode");
}

/* =========================================================
   PAYMENT HELPERS
========================================================= */
function toCents(amount = 0) {
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n * 100);
}

function fromCents(cents = 0) {
  const n = Number(cents);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n) / 100;
}

function getPaymentProviderStatus() {
  return {
    enabled: ENABLE_PAYMENT_GATE,
    stripe_configured: !!(ENABLE_REAL_STRIPE && stripe && STRIPE_SECRET_KEY),
    mock_mode: !ENABLE_REAL_STRIPE || !stripe
  };
}

function computeAuthorizationAmount(rideOrEstimate = {}) {
  const estimate = Number(
    rideOrEstimate.estimated_total ||
      rideOrEstimate.final_total ||
      rideOrEstimate.total ||
      0
  );

  const base = Number.isFinite(estimate) ? estimate : 0;
  const withRate = base * Math.max(PAYMENT_AUTH_HOLD_RATE, 1);
  const withBuffer = withRate + Math.max(PAYMENT_AUTH_FIXED_BUFFER, 0);

  return asMoney(Math.max(withBuffer, DEFAULT_MINIMUM_FARE), DEFAULT_MINIMUM_FARE);
}

function normalizePaymentMethodType(value = "") {
  const type = lower(value);
  if (["card", "cash", "apple_pay", "google_pay"].includes(type)) return type;
  return "card";
}

function isPaymentAuthorizedStatus(value = "") {
  return [
    "authorized",
    "preauthorized",
    "pre_authorized",
    "approved",
    "captured"
  ].includes(lower(value));
}

async function getPaymentRecordById(paymentId) {
  requireSupabase();

  const { data, error } = await supabase
    .from("payments")
    .select("*")
    .eq("id", paymentId)
    .single();

  if (error || !data) {
    const err = new Error("Payment record not found");
    err.statusCode = 404;
    err.details = error || null;
    throw err;
  }

  return data;
}

async function getLatestRiderPayment(riderId) {
  requireSupabase();

  const { data, error } = await supabase
    .from("payments")
    .select("*")
    .eq("rider_id", riderId)
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) {
    const err = new Error(error.message || "Unable to fetch rider payment");
    err.statusCode = 500;
    throw err;
  }

  return data?.[0] || null;
}

async function updateRiderPaymentStatus(riderId, payload = {}) {
  requireSupabase();

  const riderPatch = {
    updated_at: nowISO()
  };

  if (Object.prototype.hasOwnProperty.call(payload, "payment_authorized")) {
    riderPatch.payment_authorized = !!payload.payment_authorized;
  }

  if (Object.prototype.hasOwnProperty.call(payload, "payment_status")) {
    riderPatch.payment_status = cleanEnv(payload.payment_status);
  }

  if (Object.prototype.hasOwnProperty.call(payload, "default_payment_method_type")) {
    riderPatch.default_payment_method_type = cleanEnv(
      payload.default_payment_method_type
    );
  }

  const { error } = await supabase
    .from("riders")
    .update(riderPatch)
    .eq("id", riderId);

  if (error) {
    const err = new Error(error.message || "Unable to update rider payment status");
    err.statusCode = 500;
    throw err;
  }

  return true;
}

async function createPaymentRecord(payload = {}) {
  return safeInsert("payments", {
    id: payload.id || generateId("payment"),
    rider_id: cleanEnv(payload.rider_id),
    ride_id: cleanEnv(payload.ride_id) || null,
    payment_method_type: normalizePaymentMethodType(payload.payment_method_type),
    provider: cleanEnv(payload.provider || (stripe ? "stripe" : "mock")),
    provider_payment_intent_id: cleanEnv(payload.provider_payment_intent_id) || null,
    status: cleanEnv(payload.status || "created"),
    currency: cleanEnv(payload.currency || "USD"),
    amount: asMoney(payload.amount || 0, 0),
    authorized_amount: asMoney(payload.authorized_amount || 0, 0),
    captured_amount: asMoney(payload.captured_amount || 0, 0),
    released_amount: asMoney(payload.released_amount || 0, 0),
    refunded_amount: asMoney(payload.refunded_amount || 0, 0),
    metadata: payload.metadata || {},
    created_at: nowISO(),
    updated_at: nowISO()
  });
}

async function markPaymentAuthorized(paymentId, extra = {}) {
  const payment = await safeUpdateById("payments", paymentId, {
    status: "authorized",
    authorized_amount: asMoney(
      extra.authorized_amount ?? extra.amount ?? 0,
      0
    ),
    provider_payment_intent_id:
      cleanEnv(extra.provider_payment_intent_id) || undefined,
    metadata: extra.metadata || undefined,
    updated_at: nowISO()
  });

  if (cleanEnv(payment.rider_id)) {
    await updateRiderPaymentStatus(payment.rider_id, {
      payment_authorized: true,
      payment_status: "authorized",
      default_payment_method_type: payment.payment_method_type || "card"
    });
  }

  return payment;
}

async function markPaymentCaptured(paymentId, capturedAmount, extra = {}) {
  const payment = await safeUpdateById("payments", paymentId, {
    status: "captured",
    captured_amount: asMoney(capturedAmount, 0),
    metadata: extra.metadata || undefined,
    updated_at: nowISO()
  });

  if (cleanEnv(payment.rider_id)) {
    await updateRiderPaymentStatus(payment.rider_id, {
      payment_authorized: true,
      payment_status: "captured",
      default_payment_method_type: payment.payment_method_type || "card"
    });
  }

  return payment;
}

async function markPaymentReleased(paymentId, releasedAmount = 0, extra = {}) {
  const payment = await safeUpdateById("payments", paymentId, {
    status: "released",
    released_amount: asMoney(releasedAmount, 0),
    metadata: extra.metadata || undefined,
    updated_at: nowISO()
  });

  if (cleanEnv(payment.rider_id)) {
    await updateRiderPaymentStatus(payment.rider_id, {
      payment_authorized: false,
      payment_status: "released",
      default_payment_method_type: payment.payment_method_type || "card"
    });
  }

  return payment;
}

async function markPaymentFailed(paymentId, reason = "payment_failed", extra = {}) {
  const payment = await safeUpdateById("payments", paymentId, {
    status: "failed",
    metadata: {
      ...(extra.metadata || {}),
      reason
    },
    updated_at: nowISO()
  });

  if (cleanEnv(payment.rider_id)) {
    await updateRiderPaymentStatus(payment.rider_id, {
      payment_authorized: false,
      payment_status: "failed",
      default_payment_method_type: payment.payment_method_type || "card"
    });
  }

  return payment;
}

/* =========================================================
   MOCK / STRIPE AUTHORIZATION
========================================================= */
async function createMockAuthorization({
  riderId,
  rideId = null,
  amount,
  paymentMethodType = "card",
  metadata = {}
}) {
  const payment = await createPaymentRecord({
    rider_id: riderId,
    ride_id: rideId,
    payment_method_type: paymentMethodType,
    provider: "mock",
    status: "authorized",
    amount,
    authorized_amount: amount,
    metadata: {
      ...metadata,
      mock: true
    }
  });

  await updateRiderPaymentStatus(riderId, {
    payment_authorized: true,
    payment_status: "authorized",
    default_payment_method_type: paymentMethodType
  });

  return {
    provider: "mock",
    payment
  };
}

async function createStripeAuthorization({
  riderId,
  rideId = null,
  amount,
  currency = "usd",
  paymentMethodType = "card",
  customerId = null,
  paymentMethodId = null,
  metadata = {}
}) {
  if (!stripe) {
    throw new Error("Stripe is not configured");
  }

  const paymentIntent = await stripe.paymentIntents.create({
    amount: toCents(amount),
    currency: cleanEnv(currency || "usd").toLowerCase(),
    capture_method: "manual",
    confirm: !!paymentMethodId,
    payment_method: paymentMethodId || undefined,
    customer: customerId || undefined,
    metadata: {
      rider_id: riderId,
      ride_id: rideId || "",
      app: "harvey_taxi",
      ...Object.fromEntries(
        Object.entries(metadata || {}).map(([k, v]) => [k, String(v ?? "")])
      )
    }
  });

  const status = lower(paymentIntent.status);
  const authorizedStatuses = new Set([
    "requires_capture",
    "processing",
    "succeeded"
  ]);

  const payment = await createPaymentRecord({
    rider_id: riderId,
    ride_id: rideId,
    payment_method_type: paymentMethodType,
    provider: "stripe",
    provider_payment_intent_id: paymentIntent.id,
    status: authorizedStatuses.has(status) ? "authorized" : status,
    amount,
    authorized_amount: authorizedStatuses.has(status) ? amount : 0,
    metadata: {
      stripe_status: paymentIntent.status,
      customer_id: customerId || null
    }
  });

  if (authorizedStatuses.has(status)) {
    await updateRiderPaymentStatus(riderId, {
      payment_authorized: true,
      payment_status: "authorized",
      default_payment_method_type: paymentMethodType
    });
  } else {
    await updateRiderPaymentStatus(riderId, {
      payment_authorized: false,
      payment_status: paymentIntent.status || "pending",
      default_payment_method_type: paymentMethodType
    });
  }

  return {
    provider: "stripe",
    payment,
    payment_intent: paymentIntent
  };
}

async function authorizeRiderPayment({
  riderId,
  rideId = null,
  amount,
  paymentMethodType = "card",
  customerId = null,
  paymentMethodId = null,
  metadata = {}
}) {
  if (!ENABLE_PAYMENT_GATE) {
    return {
      payment_gate_enabled: false,
      skipped: true
    };
  }

  if (ENABLE_REAL_STRIPE && stripe) {
    return createStripeAuthorization({
      riderId,
      rideId,
      amount,
      currency: "usd",
      paymentMethodType,
      customerId,
      paymentMethodId,
      metadata
    });
  }

  return createMockAuthorization({
    riderId,
    rideId,
    amount,
    paymentMethodType,
    metadata
  });
}

/* =========================================================
   CAPTURE / RELEASE HELPERS
========================================================= */
async function capturePaymentForRide(ride = {}, options = {}) {
  requireSupabase();

  const riderId = cleanEnv(ride.rider_id);
  if (!riderId) {
    throw new Error("Ride has no rider_id");
  }

  const latestPayment = await getLatestRiderPayment(riderId);
  if (!latestPayment) {
    throw new Error("No payment authorization found for rider");
  }

  const captureAmount = asMoney(
    options.capture_amount ||
      ride.final_total ||
      ride.estimated_total ||
      latestPayment.authorized_amount ||
      latestPayment.amount ||
      0,
    0
  );

  if (ENABLE_REAL_STRIPE && stripe && cleanEnv(latestPayment.provider_payment_intent_id)) {
    const intentId = cleanEnv(latestPayment.provider_payment_intent_id);

    const paymentIntent = await stripe.paymentIntents.capture(intentId, {
      amount_to_capture: toCents(captureAmount)
    });

    const payment = await markPaymentCaptured(latestPayment.id, captureAmount, {
      metadata: {
        stripe_capture_status: paymentIntent.status
      }
    });

    return {
      provider: "stripe",
      payment,
      payment_intent: paymentIntent
    };
  }

  const payment = await markPaymentCaptured(latestPayment.id, captureAmount, {
    metadata: {
      mock: true
    }
  });

  return {
    provider: "mock",
    payment
  };
}

async function releasePaymentAuthorizationForRide(ride = {}, options = {}) {
  requireSupabase();

  const riderId = cleanEnv(ride.rider_id);
  if (!riderId) {
    throw new Error("Ride has no rider_id");
  }

  const latestPayment = await getLatestRiderPayment(riderId);
  if (!latestPayment) {
    return {
      released: false,
      reason: "no_payment_record"
    };
  }

  const releaseAmount = asMoney(
    options.release_amount ||
      latestPayment.authorized_amount ||
      latestPayment.amount ||
      0,
    0
  );

  if (ENABLE_REAL_STRIPE && stripe && cleanEnv(latestPayment.provider_payment_intent_id)) {
    const intentId = cleanEnv(latestPayment.provider_payment_intent_id);

    const paymentIntent = await stripe.paymentIntents.cancel(intentId);

    const payment = await markPaymentReleased(latestPayment.id, releaseAmount, {
      metadata: {
        stripe_release_status: paymentIntent.status
      }
    });

    return {
      released: true,
      provider: "stripe",
      payment,
      payment_intent: paymentIntent
    };
  }

  const payment = await markPaymentReleased(latestPayment.id, releaseAmount, {
    metadata: {
      mock: true
    }
  });

  return {
    released: true,
    provider: "mock",
    payment
  };
}

/* =========================================================
   RIDER PAYMENT ROUTES
========================================================= */
app.get("/api/riders/:riderId/payment-status", async (req, res) => {
  try {
    const riderId = cleanEnv(req.params.riderId);
    if (!riderId) return fail(res, 400, "riderId is required");

    const rider = await getRiderById(riderId);
    const latestPayment = await getLatestRiderPayment(riderId);

    return ok(res, {
      rider_id: riderId,
      payment_authorized: !!rider.payment_authorized,
      payment_status: rider.payment_status || null,
      default_payment_method_type: rider.default_payment_method_type || null,
      latest_payment: latestPayment,
      provider: getPaymentProviderStatus()
    });
  } catch (error) {
    console.error("❌ /api/riders/:riderId/payment-status failed:", error);
    return fail(
      res,
      Number(error.statusCode || 500),
      error.message || "Unable to fetch rider payment status"
    );
  }
});

app.post("/api/riders/:riderId/authorize-payment", async (req, res) => {
  try {
    requireSupabase();

    const riderId = cleanEnv(req.params.riderId);
    if (!riderId) return fail(res, 400, "riderId is required");

    const rider = await getRiderById(riderId);

    if (normalizeBoolean(rider.is_blocked, false)) {
      return fail(res, 403, "Rider account is blocked");
    }

    const rideType = normalizeRideType(req.body?.ride_type || req.body?.rideType);
    const requestedMode = normalizeRequestedMode(
      req.body?.requestedMode || req.body?.mode
    );
    const paymentMethodType = normalizePaymentMethodType(
      req.body?.payment_method_type || req.body?.paymentMethodType || "card"
    );

    const pickupAddress = normalizeAddress(
      req.body?.pickup_address || req.body?.pickupAddress || req.body?.origin
    );

    const destinationAddress = normalizeAddress(
      req.body?.destination_address ||
        req.body?.destinationAddress ||
        req.body?.destination
    );

    const pickupLat = normalizeCoordinate(req.body?.pickup_lat || req.body?.pickupLat);
    const pickupLng = normalizeCoordinate(req.body?.pickup_lng || req.body?.pickupLng);
    const destinationLat = normalizeCoordinate(
      req.body?.destination_lat || req.body?.destinationLat
    );
    const destinationLng = normalizeCoordinate(
      req.body?.destination_lng || req.body?.destinationLng
    );

    const scheduledFor = cleanEnv(req.body?.scheduled_for || req.body?.scheduledFor) || null;
    const customerId = cleanEnv(req.body?.stripe_customer_id || req.body?.customerId) || null;
    const paymentMethodId =
      cleanEnv(req.body?.stripe_payment_method_id || req.body?.paymentMethodId) || null;

    const estimate = await computeLiveFareEstimate({
      rideType,
      requestedMode,
      pickupAddress,
      destinationAddress,
      pickupLat,
      pickupLng,
      destinationLat,
      destinationLng,
      scheduledFor,
      estimatedMiles: Number(req.body?.estimated_miles || req.body?.estimatedMiles || 0),
      estimatedMinutes: Number(
        req.body?.estimated_minutes || req.body?.estimatedMinutes || 0
      )
    });

    const authorizationAmount = computeAuthorizationAmount(estimate);

    const result = await authorizeRiderPayment({
      riderId,
      amount: authorizationAmount,
      paymentMethodType,
      customerId,
      paymentMethodId,
      metadata: {
        ride_type: rideType,
        requested_mode: requestedMode,
        estimate_total: estimate.estimated_total
      }
    });

    await logAdminEvent("payment_authorized", {
      rider_id: riderId,
      payment_id: result.payment?.id || null,
      provider: result.provider,
      authorization_amount: authorizationAmount
    });

    return ok(
      res,
      {
        message: "Payment authorization processed",
        rider_id: riderId,
        authorization_amount: authorizationAmount,
        fare_estimate: estimate,
        provider: result.provider,
        payment: result.payment,
        payment_intent_client_secret:
          result.payment_intent?.client_secret || null
      },
      201
    );
  } catch (error) {
    console.error("❌ /api/riders/:riderId/authorize-payment failed:", error);
    return fail(
      res,
      Number(error.statusCode || 500),
      error.message || "Unable to authorize payment"
    );
  }
});

app.post("/api/rides/:rideId/capture-payment", async (req, res) => {
  try {
    const rideId = cleanEnv(req.params.rideId);
    if (!rideId) return fail(res, 400, "rideId is required");

    const ride = await getRideById(rideId);
    const captureAmount = Number(
      req.body?.capture_amount || req.body?.captureAmount || 0
    );

    const result = await capturePaymentForRide(ride, {
      capture_amount: captureAmount > 0 ? captureAmount : undefined
    });

    await logAdminEvent("payment_captured", {
      ride_id: rideId,
      rider_id: ride.rider_id,
      payment_id: result.payment?.id || null,
      amount: result.payment?.captured_amount || captureAmount || null
    });

    return ok(res, {
      message: "Payment captured",
      ride_id: rideId,
      ...result
    });
  } catch (error) {
    console.error("❌ /api/rides/:rideId/capture-payment failed:", error);
    return fail(
      res,
      Number(error.statusCode || 500),
      error.message || "Unable to capture payment"
    );
  }
});

app.post("/api/rides/:rideId/release-payment", async (req, res) => {
  try {
    const rideId = cleanEnv(req.params.rideId);
    if (!rideId) return fail(res, 400, "rideId is required");

    const ride = await getRideById(rideId);
    const releaseAmount = Number(
      req.body?.release_amount || req.body?.releaseAmount || 0
    );

    const result = await releasePaymentAuthorizationForRide(ride, {
      release_amount: releaseAmount > 0 ? releaseAmount : undefined
    });

    await logAdminEvent("payment_released", {
      ride_id: rideId,
      rider_id: ride.rider_id,
      released: !!result.released
    });

    return ok(res, {
      message: "Payment authorization released",
      ride_id: rideId,
      ...result
    });
  } catch (error) {
    console.error("❌ /api/rides/:rideId/release-payment failed:", error);
    return fail(
      res,
      Number(error.statusCode || 500),
      error.message || "Unable to release payment authorization"
    );
  }
});

/* =========================================================
   SAFER REQUEST-RIDE FLOW WITH PAYMENT CHECK
========================================================= */
app.post("/api/request-ride-v3", async (req, res) => {
  try {
    requireSupabase();

    const input = parseRideRequestBody(req.body || {});
    validateRideRequestInput(input);

    const rider = await getRiderById(input.riderId);

    if (normalizeBoolean(rider.is_blocked, false)) {
      return fail(res, 403, "Rider account is blocked");
    }

    if (normalizeBoolean(rider.is_disabled, false)) {
      return fail(res, 403, "Rider account is disabled");
    }

    if (!isActiveRiderStatus(rider.status)) {
      return fail(res, 403, "Rider account is not active");
    }

    if (
      ENABLE_RIDER_VERIFICATION_GATE &&
      !isApprovedVerificationStatus(rider.verification_status)
    ) {
      return fail(res, 403, "Rider verification is not approved", {
        verification_status: rider.verification_status || "unverified"
      });
    }

    const fareEstimate = await computeLiveFareEstimate({
      rideType: input.rideType,
      requestedMode: input.requestedMode,
      pickupAddress: input.pickupAddress,
      destinationAddress: input.destinationAddress,
      pickupLat: input.pickupLat,
      pickupLng: input.pickupLng,
      destinationLat: input.destinationLat,
      destinationLng: input.destinationLng,
      scheduledFor: input.scheduledFor,
      estimatedMiles: input.estimatedMiles,
      estimatedMinutes: input.estimatedMinutes
    });

    if (ENABLE_PAYMENT_GATE && !hasPaymentAuthorization(rider)) {
      return fail(res, 402, "Payment authorization required before ride request", {
        rider_id: rider.id,
        fare_estimate: fareEstimate,
        next_step: "Call /api/riders/:riderId/authorize-payment first"
      });
    }

    const latestPayment = await getLatestRiderPayment(rider.id);

    const ridePayload = {
      id: generateId("ride"),
      rider_id: rider.id,
      status: "awaiting_dispatch",
      requested_mode: input.requestedMode,
      ride_type: input.rideType,
      pickup_address: input.pickupAddress,
      destination_address: input.destinationAddress,
      notes: input.notes || null,
      pickup_lat: input.pickupLat,
      pickup_lng: input.pickupLng,
      destination_lat: input.destinationLat,
      destination_lng: input.destinationLng,
      scheduled_for: input.scheduledFor,
      estimated_miles: fareEstimate.estimated_miles,
      estimated_minutes: fareEstimate.estimated_minutes,
      estimated_total: fareEstimate.estimated_total,
      subtotal: fareEstimate.subtotal,
      surge_multiplier: fareEstimate.surge_multiplier,
      ride_type_multiplier: fareEstimate.ride_type_multiplier,
      mode_multiplier: fareEstimate.mode_multiplier,
      currency: fareEstimate.currency,
      route_source: fareEstimate.source,
      payment_id: latestPayment?.id || null,
      dispatch_attempts: 0,
      created_at: nowISO(),
      updated_at: nowISO()
    };

    const ride = await safeInsert("rides", ridePayload);

    if (latestPayment?.id) {
      try {
        await safeUpdateById("payments", latestPayment.id, {
          ride_id: ride.id,
          updated_at: nowISO()
        });
      } catch (error) {
        console.warn("⚠️ payment ride attachment failed:", error.message);
      }
    }

    await logTripEvent(ride.id, "ride_requested", {
      rider_id: rider.id,
      requested_mode: input.requestedMode,
      ride_type: input.rideType,
      pickup_address: input.pickupAddress,
      destination_address: input.destinationAddress,
      estimated_total: fareEstimate.estimated_total,
      payment_id: latestPayment?.id || null
    });

    await logAdminEvent("ride_requested_v3", {
      ride_id: ride.id,
      rider_id: rider.id,
      estimated_total: fareEstimate.estimated_total,
      payment_id: latestPayment?.id || null
    });

    return ok(
      res,
      {
        message: "Ride request accepted",
        ride_id: ride.id,
        ride,
        fare_estimate: fareEstimate,
        payment: latestPayment || null
      },
      201
    );
  } catch (error) {
    console.error("❌ /api/request-ride-v3 failed:", error);
    return fail(
      res,
      Number(error.statusCode || 500),
      error.message || "Ride request failed",
      error.details ? { details: error.details } : {}
    );
  }
});

/* =========================================================
   PAYMENT-AWARE COMPLETE / CANCEL HOOKS
========================================================= */
app.post("/api/rides/:rideId/complete-v3", async (req, res) => {
  try {
    const rideId = cleanEnv(req.params.rideId);
    const driverId = cleanEnv(req.body?.driver_id || req.body?.driverId);
    const finalTotal = Number(req.body?.final_total || req.body?.finalTotal || 0);
    const tipAmount = Number(req.body?.tip_amount || req.body?.tipAmount || 0);

    if (!rideId) return fail(res, 400, "rideId is required");
    if (!driverId) return fail(res, 400, "driver_id is required");

    const ride = await getRideById(rideId);
    const driver = await getDriverById(driverId);

    if (!canDriverOperateRide(driver, ride)) {
      return fail(res, 403, "Driver is not eligible to complete this ride");
    }

    if (!isRideCompletableStatus(ride.status)) {
      return fail(
        res,
        409,
        `Ride cannot be completed from status: ${ride.status || "unknown"}`
      );
    }

    const resolvedFinalTotal = asMoney(
      finalTotal > 0 ? finalTotal : Number(ride.estimated_total || 0),
      0
    );

    const updatedRide = await updateRideStatus(rideId, "completed", {
      driver_id: driverId,
      final_total: resolvedFinalTotal
    });

    await releaseDriverMission(driverId);

    let paymentResult = null;
    if (ENABLE_PAYMENT_GATE && cleanEnv(updatedRide.rider_id)) {
      try {
        paymentResult = await capturePaymentForRide(updatedRide, {
          capture_amount: resolvedFinalTotal
        });
      } catch (error) {
        console.warn("⚠️ ride completion payment capture failed:", error.message);
      }
    }

    const earnings = await createDriverEarningsLedgerEntry({
      ...updatedRide,
      final_total: resolvedFinalTotal
    });

    let tip = null;
    if (tipAmount > 0) {
      tip = await createTipRecord({
        rideId,
        riderId: updatedRide.rider_id,
        driverId,
        amount: tipAmount,
        source: "post_trip"
      });
    }

    await logTripEvent(rideId, "trip_completed", {
      driver_id: driverId,
      final_total: resolvedFinalTotal,
      tip_amount: tipAmount > 0 ? asMoney(tipAmount) : 0,
      payment_captured: !!paymentResult?.payment
    });

    await logAdminEvent("trip_completed_v3", {
      ride_id: rideId,
      driver_id: driverId,
      final_total: resolvedFinalTotal
    });

    return ok(res, {
      message: "Trip completed",
      ride: updatedRide,
      payment: paymentResult,
      earnings,
      tip
    });
  } catch (error) {
    console.error("❌ /api/rides/:rideId/complete-v3 failed:", error);
    return fail(
      res,
      Number(error.statusCode || 500),
      error.message || "Unable to complete trip"
    );
  }
});

app.post("/api/rides/:rideId/cancel-v3", async (req, res) => {
  try {
    const rideId = cleanEnv(req.params.rideId);
    const cancelledBy = cleanEnv(
      req.body?.cancelled_by || req.body?.cancelledBy || "unknown"
    );
    const reason = cleanEnv(req.body?.reason || "cancelled");

    if (!rideId) return fail(res, 400, "rideId is required");

    const ride = await getRideById(rideId);

    if (!isRideCancellableStatus(ride.status)) {
      return fail(
        res,
        409,
        `Ride cannot be cancelled from status: ${ride.status || "unknown"}`
      );
    }

    const updatedRide = await updateRideStatus(rideId, "cancelled", {
      cancelled_by: cancelledBy,
      cancellation_reason: reason
    });

    if (cleanEnv(ride.driver_id)) {
      await releaseDriverMission(ride.driver_id);
    }

    let paymentResult = null;
    if (ENABLE_PAYMENT_GATE && cleanEnv(updatedRide.rider_id)) {
      try {
        paymentResult = await releasePaymentAuthorizationForRide(updatedRide);
      } catch (error) {
        console.warn("⚠️ ride cancellation payment release failed:", error.message);
      }
    }

    await logTripEvent(rideId, "trip_cancelled", {
      cancelled_by: cancelledBy,
      reason,
      payment_released: !!paymentResult?.released
    });

    await logAdminEvent("trip_cancelled_v3", {
      ride_id: rideId,
      cancelled_by: cancelledBy,
      reason
    });

    return ok(res, {
      message: "Trip cancelled",
      ride: updatedRide,
      payment: paymentResult
    });
  } catch (error) {
    console.error("❌ /api/rides/:rideId/cancel-v3 failed:", error);
    return fail(
      res,
      Number(error.statusCode || 500),
      error.message || "Unable to cancel trip"
    );
  }
});

/* =========================================================
   STRIPE WEBHOOK SCAFFOLD
========================================================= */
app.post("/api/payments/stripe-webhook", async (req, res) => {
  try {
    if (!stripe || !STRIPE_WEBHOOK_SECRET) {
      return res.status(200).json({
        received: true,
        message: "Stripe webhook ignored because Stripe is not configured"
      });
    }

    return res.status(200).json({
      received: true,
      message: "Stripe webhook endpoint scaffold ready"
    });
  } catch (error) {
    console.error("❌ /api/payments/stripe-webhook failed:", error);
    return res.status(400).json({
      received: false,
      error: error.message
    });
  }
});

/* =========================================================
   ADMIN PAYMENT VISIBILITY
========================================================= */
app.get("/api/admin/payments", async (req, res) => {
  try {
    assertAdmin(req);
    requireSupabase();

    const { limit, offset } = parsePagination(req);
    const riderId = cleanEnv(req.query?.rider_id || req.query?.riderId);
    const rideId = cleanEnv(req.query?.ride_id || req.query?.rideId);
    const status = cleanEnv(req.query?.status);

    let query = supabase
      .from("payments")
      .select("*")
      .order("created_at", { ascending: false });

    if (riderId) query = query.eq("rider_id", riderId);
    if (rideId) query = query.eq("ride_id", rideId);
    if (status) query = query.eq("status", status);

    const { data, error } = await query.range(offset, offset + limit - 1);

    if (error) {
      const err = new Error(error.message || "Unable to fetch payments");
      err.statusCode = 500;
      throw err;
    }

    const payments = data || [];
    const totals = payments.reduce(
      (acc, payment) => {
        acc.amount += Number(payment.amount || 0);
        acc.authorized += Number(payment.authorized_amount || 0);
        acc.captured += Number(payment.captured_amount || 0);
        acc.released += Number(payment.released_amount || 0);
        return acc;
      },
      {
        amount: 0,
        authorized: 0,
        captured: 0,
        released: 0
      }
    );

    return ok(res, {
      count: payments.length,
      limit,
      offset,
      totals: {
        amount: asMoney(totals.amount, 0),
        authorized: asMoney(totals.authorized, 0),
        captured: asMoney(totals.captured, 0),
        released: asMoney(totals.released, 0)
      },
      payments
    });
  } catch (error) {
    console.error("❌ /api/admin/payments failed:", error);
    return fail(
      res,
      Number(error.statusCode || 500),
      error.message || "Unable to fetch admin payments"
    );
  }
});/* =========================================================
   PART 7 — VERIFICATION ENFORCEMENT + PERSONA FIX LAYER
========================================================= */

/* =========================================================
   VERIFICATION CONFIG
========================================================= */
const ENABLE_REAL_PERSONA = toBool(process.env.ENABLE_REAL_PERSONA, false);
const PERSONA_BASE_URL = cleanEnv(
  process.env.PERSONA_BASE_URL || "https://withpersona.com/api/v1"
);
const PERSONA_API_VERSION = cleanEnv(
  process.env.PERSONA_API_VERSION || "2023-01-05"
);

function getVerificationProviderStatus() {
  return {
    enabled: ENABLE_PERSONA_ENFORCEMENT,
    persona_configured: !!(
      ENABLE_REAL_PERSONA &&
      PERSONA_API_KEY &&
      PERSONA_TEMPLATE_ID_RIDER &&
      PERSONA_TEMPLATE_ID_DRIVER
    ),
    mock_mode:
      !ENABLE_REAL_PERSONA ||
      !PERSONA_API_KEY ||
      !PERSONA_TEMPLATE_ID_RIDER ||
      !PERSONA_TEMPLATE_ID_DRIVER
  };
}

/* =========================================================
   VERIFICATION HELPERS
========================================================= */
function normalizeVerificationStatus(value = "") {
  const status = lower(value);

  if (
    [
      "approved",
      "completed",
      "verified",
      "passed"
    ].includes(status)
  ) {
    return "approved";
  }

  if (
    [
      "declined",
      "rejected",
      "failed",
      "denied"
    ].includes(status)
  ) {
    return "rejected";
  }

  if (
    [
      "pending",
      "submitted",
      "initiated",
      "in_progress",
      "processing",
      "under_review"
    ].includes(status)
  ) {
    return "pending";
  }

  return status || "unverified";
}

function normalizeApprovalStatus(value = "") {
  const status = lower(value);

  if (["approved", "active", "enabled"].includes(status)) return "approved";
  if (["rejected", "denied", "disabled"].includes(status)) return "rejected";
  if (["pending", "submitted", "review"].includes(status)) return "pending";

  return status || "pending";
}

function normalizeDocumentType(value = "") {
  const type = lower(value);

  if (["passport", "pass_port"].includes(type)) return "passport";
  if (["id", "state_id", "driver_license", "license", "identification"].includes(type)) {
    return "id";
  }

  return type || "unknown";
}

function buildVerificationDecision({
  inquiryStatus = "",
  governmentIdVerified = false,
  selfieVerified = false,
  documentType = "unknown"
}) {
  const normalizedInquiryStatus = normalizeVerificationStatus(inquiryStatus);
  const normalizedDocumentType = normalizeDocumentType(documentType);

  const documentAccepted =
    normalizedDocumentType === "passport" || normalizedDocumentType === "id";

  const fullyApproved =
    normalizedInquiryStatus === "approved" &&
    governmentIdVerified === true &&
    selfieVerified === true &&
    documentAccepted === true;

  if (fullyApproved) {
    return {
      verification_status: "approved",
      decision: "approved",
      reason: "government_id_and_selfie_verified"
    };
  }

  if (normalizedInquiryStatus === "rejected") {
    return {
      verification_status: "rejected",
      decision: "rejected",
      reason: "verification_provider_rejected"
    };
  }

  return {
    verification_status: "pending",
    decision: "manual_review_required",
    reason: "incomplete_or_unverified_documents"
  };
}

async function getVerificationRecordByExternalId(externalInquiryId, userType = "rider") {
  requireSupabase();

  const table = userType === "driver" ? "drivers" : "riders";

  const { data, error } = await supabase
    .from(table)
    .select("*")
    .eq("persona_inquiry_id", cleanEnv(externalInquiryId))
    .limit(1);

  if (error) {
    const err = new Error(error.message || `Unable to fetch ${userType} by inquiry`);
    err.statusCode = 500;
    throw err;
  }

  return data?.[0] || null;
}

async function updateRiderVerificationRecord(riderId, payload = {}) {
  const updatePayload = {
    verification_status: normalizeVerificationStatus(
      payload.verification_status || payload.status || "pending"
    ),
    updated_at: nowISO()
  };

  if (Object.prototype.hasOwnProperty.call(payload, "status")) {
    updatePayload.status = cleanEnv(payload.status);
  }

  if (Object.prototype.hasOwnProperty.call(payload, "persona_inquiry_id")) {
    updatePayload.persona_inquiry_id = cleanEnv(payload.persona_inquiry_id) || null;
  }

  if (Object.prototype.hasOwnProperty.call(payload, "persona_account_id")) {
    updatePayload.persona_account_id = cleanEnv(payload.persona_account_id) || null;
  }

  if (Object.prototype.hasOwnProperty.call(payload, "document_type")) {
    updatePayload.document_type = normalizeDocumentType(payload.document_type);
  }

  if (Object.prototype.hasOwnProperty.call(payload, "government_id_verified")) {
    updatePayload.government_id_verified = !!payload.government_id_verified;
  }

  if (Object.prototype.hasOwnProperty.call(payload, "selfie_verified")) {
    updatePayload.selfie_verified = !!payload.selfie_verified;
  }

  if (Object.prototype.hasOwnProperty.call(payload, "verification_metadata")) {
    updatePayload.verification_metadata = payload.verification_metadata || {};
  }

  return safeUpdateById("riders", riderId, updatePayload);
}

async function updateDriverVerificationRecord(driverId, payload = {}) {
  const updatePayload = {
    verification_status: normalizeVerificationStatus(
      payload.verification_status || payload.status || "pending"
    ),
    approval_status: normalizeApprovalStatus(
      payload.approval_status || payload.verification_status || "pending"
    ),
    updated_at: nowISO()
  };

  if (Object.prototype.hasOwnProperty.call(payload, "status")) {
    updatePayload.status = cleanEnv(payload.status);
  }

  if (Object.prototype.hasOwnProperty.call(payload, "persona_inquiry_id")) {
    updatePayload.persona_inquiry_id = cleanEnv(payload.persona_inquiry_id) || null;
  }

  if (Object.prototype.hasOwnProperty.call(payload, "persona_account_id")) {
    updatePayload.persona_account_id = cleanEnv(payload.persona_account_id) || null;
  }

  if (Object.prototype.hasOwnProperty.call(payload, "document_type")) {
    updatePayload.document_type = normalizeDocumentType(payload.document_type);
  }

  if (Object.prototype.hasOwnProperty.call(payload, "government_id_verified")) {
    updatePayload.government_id_verified = !!payload.government_id_verified;
  }

  if (Object.prototype.hasOwnProperty.call(payload, "selfie_verified")) {
    updatePayload.selfie_verified = !!payload.selfie_verified;
  }

  if (Object.prototype.hasOwnProperty.call(payload, "verification_metadata")) {
    updatePayload.verification_metadata = payload.verification_metadata || {};
  }

  return safeUpdateById("drivers", driverId, updatePayload);
}

/* =========================================================
   PERSONA API HELPERS
========================================================= */
async function personaFetch(pathname, options = {}) {
  if (!PERSONA_API_KEY) {
    throw new Error("Persona API key is not configured");
  }

  const url = `${PERSONA_BASE_URL.replace(/\/$/, "")}/${String(pathname).replace(/^\//, "")}`;

  return safeFetchJson(url, {
    method: options.method || "GET",
    headers: {
      Authorization: `Bearer ${PERSONA_API_KEY}`,
      "Persona-Version": PERSONA_API_VERSION,
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
}

async function createPersonaInquiry({
  userType = "rider",
  referenceId,
  email = "",
  phone = "",
  firstName = "",
  lastName = ""
}) {
  const templateId =
    userType === "driver" ? PERSONA_TEMPLATE_ID_DRIVER : PERSONA_TEMPLATE_ID_RIDER;

  if (!templateId) {
    throw new Error(`Persona template missing for ${userType}`);
  }

  if (!ENABLE_REAL_PERSONA) {
    return {
      mock: true,
      inquiry_id: generateId("persona_inquiry"),
      inquiry_url: null,
      status: "pending"
    };
  }

  const data = await personaFetch("/inquiries", {
    method: "POST",
    body: {
      data: {
        attributes: {
          "reference-id": cleanEnv(referenceId),
          "template-id": cleanEnv(templateId),
          "inquiry-template-id": cleanEnv(templateId),
          "redirect-uri": PUBLIC_APP_URL || undefined
        },
        relationships: {
          account: {
            data: {
              type: "account",
              attributes: {
                reference_id: cleanEnv(referenceId),
                email_address: cleanEnv(email) || undefined,
                phone_number: cleanEnv(phone) || undefined,
                name_first: cleanEnv(firstName) || undefined,
                name_last: cleanEnv(lastName) || undefined
              }
            }
          }
        }
      }
    }
  });

  const inquiry = data?.data || {};

  return {
    mock: false,
    inquiry_id: inquiry?.id || null,
    inquiry_url:
      inquiry?.attributes?.["inquiry-url"] ||
      inquiry?.attributes?.["launch-url"] ||
      null,
    status: normalizeVerificationStatus(inquiry?.attributes?.status || "pending")
  };
}

/* =========================================================
   RYDER / DRIVER VERIFICATION START ROUTES
========================================================= */
app.post("/api/riders/:riderId/start-verification", async (req, res) => {
  try {
    requireSupabase();

    const riderId = cleanEnv(req.params.riderId);
    if (!riderId) return fail(res, 400, "riderId is required");

    const rider = await getRiderById(riderId);

    const inquiry = await createPersonaInquiry({
      userType: "rider",
      referenceId: rider.id,
      email: rider.email,
      phone: rider.phone,
      firstName: rider.first_name,
      lastName: rider.last_name
    });

    const updatedRider = await updateRiderVerificationRecord(rider.id, {
      verification_status: inquiry.status || "pending",
      status: isActiveRiderStatus(rider.status) ? rider.status : "pending",
      persona_inquiry_id: inquiry.inquiry_id,
      document_type: rider.document_type || "unknown",
      verification_metadata: {
        ...(rider.verification_metadata || {}),
        verification_started_at: nowISO(),
        provider: inquiry.mock ? "mock" : "persona"
      }
    });

    await logAdminEvent("rider_verification_started", {
      rider_id: rider.id,
      persona_inquiry_id: inquiry.inquiry_id,
      provider: inquiry.mock ? "mock" : "persona"
    });

    return ok(res, {
      message: "Rider verification started",
      rider: updatedRider,
      verification: inquiry
    });
  } catch (error) {
    console.error("❌ /api/riders/:riderId/start-verification failed:", error);
    return fail(
      res,
      Number(error.statusCode || 500),
      error.message || "Unable to start rider verification"
    );
  }
});

app.post("/api/drivers/:driverId/start-verification", async (req, res) => {
  try {
    requireSupabase();

    const driverId = cleanEnv(req.params.driverId);
    if (!driverId) return fail(res, 400, "driverId is required");

    const driver = await getDriverById(driverId);

    const inquiry = await createPersonaInquiry({
      userType: "driver",
      referenceId: driver.id,
      email: driver.email,
      phone: driver.phone,
      firstName: driver.first_name,
      lastName: driver.last_name
    });

    const updatedDriver = await updateDriverVerificationRecord(driver.id, {
      verification_status: inquiry.status || "pending",
      approval_status: driver.approval_status || "pending",
      status: cleanEnv(driver.status || "pending"),
      persona_inquiry_id: inquiry.inquiry_id,
      document_type: driver.document_type || "unknown",
      verification_metadata: {
        ...(driver.verification_metadata || {}),
        verification_started_at: nowISO(),
        provider: inquiry.mock ? "mock" : "persona"
      }
    });

    await logAdminEvent("driver_verification_started", {
      driver_id: driver.id,
      persona_inquiry_id: inquiry.inquiry_id,
      provider: inquiry.mock ? "mock" : "persona"
    });

    return ok(res, {
      message: "Driver verification started",
      driver: updatedDriver,
      verification: inquiry
    });
  } catch (error) {
    console.error("❌ /api/drivers/:driverId/start-verification failed:", error);
    return fail(
      res,
      Number(error.statusCode || 500),
      error.message || "Unable to start driver verification"
    );
  }
});

/* =========================================================
   MANUAL VERIFICATION SUBMISSION FIX
   THIS IS THE KEY RIDER ID/PASSPORT FIX
========================================================= */
app.post("/api/riders/:riderId/submit-verification-review", async (req, res) => {
  try {
    requireSupabase();

    const riderId = cleanEnv(req.params.riderId);
    if (!riderId) return fail(res, 400, "riderId is required");

    const rider = await getRiderById(riderId);

    const documentType = normalizeDocumentType(
      req.body?.document_type || req.body?.documentType
    );
    const governmentIdVerified = normalizeBoolean(
      req.body?.government_id_verified || req.body?.governmentIdVerified,
      false
    );
    const selfieVerified = normalizeBoolean(
      req.body?.selfie_verified || req.body?.selfieVerified,
      false
    );
    const providerStatus = normalizeVerificationStatus(
      req.body?.provider_status || req.body?.providerStatus || "pending"
    );

    const decision = buildVerificationDecision({
      inquiryStatus: providerStatus,
      governmentIdVerified,
      selfieVerified,
      documentType
    });

    const updatedRider = await updateRiderVerificationRecord(rider.id, {
      verification_status: decision.verification_status,
      status:
        decision.verification_status === "approved"
          ? "active"
          : rider.status || "pending",
      document_type: documentType,
      government_id_verified: governmentIdVerified,
      selfie_verified: selfieVerified,
      verification_metadata: {
        ...(rider.verification_metadata || {}),
        provider_status: providerStatus,
        verification_reason: decision.reason,
        reviewed_at: nowISO()
      }
    });

    await logTripEvent(null, "rider_verification_reviewed", {
      rider_id: rider.id,
      verification_status: decision.verification_status,
      document_type: documentType,
      government_id_verified: governmentIdVerified,
      selfie_verified: selfieVerified,
      reason: decision.reason
    });

    await logAdminEvent("rider_verification_reviewed", {
      rider_id: rider.id,
      verification_status: decision.verification_status,
      document_type: documentType,
      government_id_verified: governmentIdVerified,
      selfie_verified: selfieVerified,
      reason: decision.reason
    });

    return ok(res, {
      message: "Rider verification review processed",
      rider: updatedRider,
      decision
    });
  } catch (error) {
    console.error("❌ /api/riders/:riderId/submit-verification-review failed:", error);
    return fail(
      res,
      Number(error.statusCode || 500),
      error.message || "Unable to process rider verification review"
    );
  }
});

app.post("/api/drivers/:driverId/submit-verification-review", async (req, res) => {
  try {
    requireSupabase();

    const driverId = cleanEnv(req.params.driverId);
    if (!driverId) return fail(res, 400, "driverId is required");

    const driver = await getDriverById(driverId);

    const documentType = normalizeDocumentType(
      req.body?.document_type || req.body?.documentType
    );
    const governmentIdVerified = normalizeBoolean(
      req.body?.government_id_verified || req.body?.governmentIdVerified,
      false
    );
    const selfieVerified = normalizeBoolean(
      req.body?.selfie_verified || req.body?.selfieVerified,
      false
    );
    const providerStatus = normalizeVerificationStatus(
      req.body?.provider_status || req.body?.providerStatus || "pending"
    );

    const decision = buildVerificationDecision({
      inquiryStatus: providerStatus,
      governmentIdVerified,
      selfieVerified,
      documentType
    });

    const updatedDriver = await updateDriverVerificationRecord(driver.id, {
      verification_status: decision.verification_status,
      approval_status:
        decision.verification_status === "approved"
          ? "approved"
          : driver.approval_status || "pending",
      status:
        decision.verification_status === "approved"
          ? "available"
          : driver.status || "pending",
      document_type: documentType,
      government_id_verified: governmentIdVerified,
      selfie_verified: selfieVerified,
      verification_metadata: {
        ...(driver.verification_metadata || {}),
        provider_status: providerStatus,
        verification_reason: decision.reason,
        reviewed_at: nowISO()
      }
    });

    await logAdminEvent("driver_verification_reviewed", {
      driver_id: driver.id,
      verification_status: decision.verification_status,
      document_type: documentType,
      government_id_verified: governmentIdVerified,
      selfie_verified: selfieVerified,
      reason: decision.reason
    });

    return ok(res, {
      message: "Driver verification review processed",
      driver: updatedDriver,
      decision
    });
  } catch (error) {
    console.error("❌ /api/drivers/:driverId/submit-verification-review failed:", error);
    return fail(
      res,
      Number(error.statusCode || 500),
      error.message || "Unable to process driver verification review"
    );
  }
});

/* =========================================================
   PERSONA WEBHOOK
========================================================= */
app.post("/api/webhooks/persona", async (req, res) => {
  try {
    requireSupabase();

    const event = req.body || {};
    const eventType = cleanEnv(event?.data?.attributes?.name || event?.type);
    const inquiryId =
      cleanEnv(
        event?.data?.relationships?.inquiry?.data?.id ||
          event?.data?.attributes?.payload?.data?.id ||
          event?.data?.attributes?.payload?.included?.[0]?.id
      ) || null;

    const payload =
      event?.data?.attributes?.payload ||
      event?.data?.attributes ||
      {};

    const inquiryStatus = normalizeVerificationStatus(
      payload?.data?.attributes?.status ||
        payload?.status ||
        event?.data?.attributes?.status ||
        "pending"
    );

    const documentType = normalizeDocumentType(
      payload?.meta?.document_type ||
        payload?.data?.attributes?.fields?.document_type ||
        payload?.document_type ||
        "unknown"
    );

    const governmentIdVerified = normalizeBoolean(
      payload?.meta?.government_id_verified ||
        payload?.government_id_verified ||
        false,
      false
    );

    const selfieVerified = normalizeBoolean(
      payload?.meta?.selfie_verified ||
        payload?.selfie_verified ||
        false,
      false
    );

    const decision = buildVerificationDecision({
      inquiryStatus,
      governmentIdVerified,
      selfieVerified,
      documentType
    });

    let rider = null;
    let driver = null;

    if (inquiryId) {
      try {
        rider = await getVerificationRecordByExternalId(inquiryId, "rider");
      } catch (error) {
        console.warn("⚠️ persona webhook rider lookup failed:", error.message);
      }

      if (!rider) {
        try {
          driver = await getVerificationRecordByExternalId(inquiryId, "driver");
        } catch (error) {
          console.warn("⚠️ persona webhook driver lookup failed:", error.message);
        }
      }
    }

    if (rider) {
      await updateRiderVerificationRecord(rider.id, {
        verification_status: decision.verification_status,
        status:
          decision.verification_status === "approved"
            ? "active"
            : rider.status || "pending",
        persona_inquiry_id: inquiryId,
        document_type: documentType,
        government_id_verified: governmentIdVerified,
        selfie_verified: selfieVerified,
        verification_metadata: {
          ...(rider.verification_metadata || {}),
          last_persona_event: eventType || "unknown",
          webhook_received_at: nowISO(),
          raw_status: inquiryStatus
        }
      });

      await logAdminEvent("persona_webhook_rider_processed", {
        rider_id: rider.id,
        persona_inquiry_id: inquiryId,
        verification_status: decision.verification_status,
        event_type: eventType
      });
    }

    if (driver) {
      await updateDriverVerificationRecord(driver.id, {
        verification_status: decision.verification_status,
        approval_status:
          decision.verification_status === "approved"
            ? "approved"
            : driver.approval_status || "pending",
        status:
          decision.verification_status === "approved"
            ? "available"
            : driver.status || "pending",
        persona_inquiry_id: inquiryId,
        document_type: documentType,
        government_id_verified: governmentIdVerified,
        selfie_verified: selfieVerified,
        verification_metadata: {
          ...(driver.verification_metadata || {}),
          last_persona_event: eventType || "unknown",
          webhook_received_at: nowISO(),
          raw_status: inquiryStatus
        }
      });

      await logAdminEvent("persona_webhook_driver_processed", {
        driver_id: driver.id,
        persona_inquiry_id: inquiryId,
        verification_status: decision.verification_status,
        event_type: eventType
      });
    }

    return res.status(200).json({
      success: true,
      processed: true,
      inquiry_id: inquiryId,
      event_type: eventType || null,
      rider_id: rider?.id || null,
      driver_id: driver?.id || null
    });
  } catch (error) {
    console.error("❌ /api/webhooks/persona failed:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Persona webhook failed"
    });
  }
});

/* =========================================================
   RIDER / DRIVER VERIFICATION STATUS ROUTES
========================================================= */
app.get("/api/riders/:riderId/verification-status", async (req, res) => {
  try {
    const riderId = cleanEnv(req.params.riderId);
    if (!riderId) return fail(res, 400, "riderId is required");

    const rider = await getRiderById(riderId);

    return ok(res, {
      rider_id: rider.id,
      verification_status: rider.verification_status || "unverified",
      status: rider.status || null,
      document_type: rider.document_type || null,
      government_id_verified: !!rider.government_id_verified,
      selfie_verified: !!rider.selfie_verified,
      persona_inquiry_id: rider.persona_inquiry_id || null,
      verification_metadata: rider.verification_metadata || {}
    });
  } catch (error) {
    console.error("❌ /api/riders/:riderId/verification-status failed:", error);
    return fail(
      res,
      Number(error.statusCode || 500),
      error.message || "Unable to fetch rider verification status"
    );
  }
});

app.get("/api/drivers/:driverId/verification-status", async (req, res) => {
  try {
    const driverId = cleanEnv(req.params.driverId);
    if (!driverId) return fail(res, 400, "driverId is required");

    const driver = await getDriverById(driverId);

    return ok(res, {
      driver_id: driver.id,
      verification_status: driver.verification_status || "unverified",
      approval_status: driver.approval_status || "pending",
      status: driver.status || null,
      document_type: driver.document_type || null,
      government_id_verified: !!driver.government_id_verified,
      selfie_verified: !!driver.selfie_verified,
      persona_inquiry_id: driver.persona_inquiry_id || null,
      verification_metadata: driver.verification_metadata || {}
    });
  } catch (error) {
    console.error("❌ /api/drivers/:driverId/verification-status failed:", error);
    return fail(
      res,
      Number(error.statusCode || 500),
      error.message || "Unable to fetch driver verification status"
    );
  }
});

/* =========================================================
   ADMIN APPROVAL CONTROLS
========================================================= */
app.post("/api/admin/riders/:riderId/approve", async (req, res) => {
  try {
    assertAdmin(req);

    const riderId = cleanEnv(req.params.riderId);
    if (!riderId) return fail(res, 400, "riderId is required");

    const rider = await getRiderById(riderId);

    const documentType = normalizeDocumentType(
      req.body?.document_type || req.body?.documentType || rider.document_type
    );
    const governmentIdVerified = normalizeBoolean(
      req.body?.government_id_verified || req.body?.governmentIdVerified,
      rider.government_id_verified
    );
    const selfieVerified = normalizeBoolean(
      req.body?.selfie_verified || req.body?.selfieVerified,
      rider.selfie_verified
    );

    if (!governmentIdVerified || !selfieVerified) {
      return fail(
        res,
        400,
        "Rider cannot be approved until government ID and selfie are both verified"
      );
    }

    if (!["passport", "id"].includes(documentType)) {
      return fail(res, 400, "Rider document type must be passport or id");
    }

    const updatedRider = await updateRiderVerificationRecord(riderId, {
      verification_status: "approved",
      status: "active",
      document_type: documentType,
      government_id_verified: governmentIdVerified,
      selfie_verified: selfieVerified,
      verification_metadata: {
        ...(rider.verification_metadata || {}),
        admin_approved_at: nowISO(),
        admin_approved: true
      }
    });

    await logAdminEvent("rider_admin_approved", {
      rider_id: riderId,
      document_type: documentType
    });

    return ok(res, {
      message: "Rider approved",
      rider: updatedRider
    });
  } catch (error) {
    console.error("❌ /api/admin/riders/:riderId/approve failed:", error);
    return fail(
      res,
      Number(error.statusCode || 500),
      error.message || "Unable to approve rider"
    );
  }
});

app.post("/api/admin/riders/:riderId/reject", async (req, res) => {
  try {
    assertAdmin(req);

    const riderId = cleanEnv(req.params.riderId);
    const reason = cleanEnv(req.body?.reason || "verification_rejected");

    if (!riderId) return fail(res, 400, "riderId is required");

    const rider = await getRiderById(riderId);

    const updatedRider = await updateRiderVerificationRecord(riderId, {
      verification_status: "rejected",
      status: rider.status || "pending",
      verification_metadata: {
        ...(rider.verification_metadata || {}),
        admin_rejected_at: nowISO(),
        rejection_reason: reason
      }
    });

    await logAdminEvent("rider_admin_rejected", {
      rider_id: riderId,
      reason
    });

    return ok(res, {
      message: "Rider rejected",
      rider: updatedRider
    });
  } catch (error) {
    console.error("❌ /api/admin/riders/:riderId/reject failed:", error);
    return fail(
      res,
      Number(error.statusCode || 500),
      error.message || "Unable to reject rider"
    );
  }
});

app.post("/api/admin/drivers/:driverId/approve", async (req, res) => {
  try {
    assertAdmin(req);

    const driverId = cleanEnv(req.params.driverId);
    if (!driverId) return fail(res, 400, "driverId is required");

    const driver = await getDriverById(driverId);

    const documentType = normalizeDocumentType(
      req.body?.document_type || req.body?.documentType || driver.document_type
    );
    const governmentIdVerified = normalizeBoolean(
      req.body?.government_id_verified || req.body?.governmentIdVerified,
      driver.government_id_verified
    );
    const selfieVerified = normalizeBoolean(
      req.body?.selfie_verified || req.body?.selfieVerified,
      driver.selfie_verified
    );

    if (!governmentIdVerified || !selfieVerified) {
      return fail(
        res,
        400,
        "Driver cannot be approved until government ID and selfie are both verified"
      );
    }

    if (!["passport", "id"].includes(documentType)) {
      return fail(res, 400, "Driver document type must be passport or id");
    }

    const updatedDriver = await updateDriverVerificationRecord(driverId, {
      verification_status: "approved",
      approval_status: "approved",
      status: "available",
      document_type: documentType,
      government_id_verified: governmentIdVerified,
      selfie_verified: selfieVerified,
      verification_metadata: {
        ...(driver.verification_metadata || {}),
        admin_approved_at: nowISO(),
        admin_approved: true
      }
    });

    await logAdminEvent("driver_admin_approved", {
      driver_id: driverId,
      document_type: documentType
    });

    return ok(res, {
      message: "Driver approved",
      driver: updatedDriver
    });
  } catch (error) {
    console.error("❌ /api/admin/drivers/:driverId/approve failed:", error);
    return fail(
      res,
      Number(error.statusCode || 500),
      error.message || "Unable to approve driver"
    );
  }
});

app.post("/api/admin/drivers/:driverId/reject", async (req, res) => {
  try {
    assertAdmin(req);

    const driverId = cleanEnv(req.params.driverId);
    const reason = cleanEnv(req.body?.reason || "verification_rejected");

    if (!driverId) return fail(res, 400, "driverId is required");

    const driver = await getDriverById(driverId);

    const updatedDriver = await updateDriverVerificationRecord(driverId, {
      verification_status: "rejected",
      approval_status: "rejected",
      status: driver.status || "pending",
      verification_metadata: {
        ...(driver.verification_metadata || {}),
        admin_rejected_at: nowISO(),
        rejection_reason: reason
      }
    });

    await logAdminEvent("driver_admin_rejected", {
      driver_id: driverId,
      reason
    });

    return ok(res, {
      message: "Driver rejected",
      driver: updatedDriver
    });
  } catch (error) {
    console.error("❌ /api/admin/drivers/:driverId/reject failed:", error);
    return fail(
      res,
      Number(error.statusCode || 500),
      error.message || "Unable to reject driver"
    );
  }
});

/* =========================================================
   ADMIN VERIFICATION QUEUE
========================================================= */
app.get("/api/admin/verification/queue", async (req, res) => {
  try {
    assertAdmin(req);
    requireSupabase();

    const { limit, offset } = parsePagination(req);

    const [ridersResult, driversResult] = await Promise.all([
      supabase
        .from("riders")
        .select(`
          id,
          email,
          phone,
          first_name,
          last_name,
          status,
          verification_status,
          document_type,
          government_id_verified,
          selfie_verified,
          created_at,
          updated_at
        `)
        .in("verification_status", ["pending", "unverified"])
        .order("updated_at", { ascending: false })
        .range(offset, offset + limit - 1),

      supabase
        .from("drivers")
        .select(`
          id,
          email,
          phone,
          first_name,
          last_name,
          status,
          approval_status,
          verification_status,
          driver_type,
          document_type,
          government_id_verified,
          selfie_verified,
          created_at,
          updated_at
        `)
        .in("verification_status", ["pending", "unverified"])
        .order("updated_at", { ascending: false })
        .range(offset, offset + limit - 1)
    ]);

    if (ridersResult.error) {
      const err = new Error(ridersResult.error.message || "Unable to fetch rider queue");
      err.statusCode = 500;
      throw err;
    }

    if (driversResult.error) {
      const err = new Error(driversResult.error.message || "Unable to fetch driver queue");
      err.statusCode = 500;
      throw err;
    }

    return ok(res, {
      rider_count: (ridersResult.data || []).length,
      driver_count: (driversResult.data || []).length,
      riders: ridersResult.data || [],
      drivers: driversResult.data || []
    });
  } catch (error) {
    console.error("❌ /api/admin/verification/queue failed:", error);
    return fail(
      res,
      Number(error.statusCode || 500),
      error.message || "Unable to fetch verification queue"
    );
  }
});/* =========================================================
   PART 8 — ADMIN COMMAND CENTER + ANALYTICS + DISPATCH CONTROLS
========================================================= */

/* =========================================================
   ANALYTICS HELPERS
========================================================= */
function sumMoney(rows = [], field = "amount") {
  return asMoney(
    (rows || []).reduce((sum, row) => {
      const value = Number(row?.[field] || 0);
      return sum + (Number.isFinite(value) ? value : 0);
    }, 0),
    0
  );
}

function countBy(rows = [], keyFn) {
  const map = {};
  for (const row of rows || []) {
    const key = cleanEnv(keyFn(row) || "unknown") || "unknown";
    map[key] = (map[key] || 0) + 1;
  }
  return map;
}

function startOfDayIso(date = new Date()) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function daysAgoIso(days = 7) {
  const d = new Date();
  d.setDate(d.getDate() - Number(days || 0));
  return d.toISOString();
}

async function getRecentRows(table, days = 7, orderColumn = "created_at") {
  requireSupabase();

  const { data, error } = await supabase
    .from(table)
    .select("*")
    .gte(orderColumn, daysAgoIso(days))
    .order(orderColumn, { ascending: false });

  if (error) {
    const err = new Error(error.message || `Unable to fetch recent ${table}`);
    err.statusCode = 500;
    throw err;
  }

  return data || [];
}

async function getAdminDashboardSnapshot() {
  requireSupabase();

  const [rides, drivers, dispatches, payments] = await Promise.all([
    getRecentRows("rides", 30, "created_at"),
    getRecentRows("drivers", 30, "created_at"),
    getRecentRows("dispatches", 30, "created_at"),
    getRecentRows("payments", 30, "created_at").catch(() => [])
  ]);

  const activeRides = rides.filter((ride) =>
    [
      "awaiting_dispatch",
      "awaiting_driver_acceptance",
      "dispatched",
      "driver_en_route",
      "arrived",
      "in_progress"
    ].includes(lower(ride.status))
  );

  const completedRides = rides.filter((ride) => lower(ride.status) === "completed");
  const cancelledRides = rides.filter((ride) => lower(ride.status) === "cancelled");
  const noDriverRides = rides.filter((ride) => lower(ride.status) === "no_driver_available");

  const onlineDrivers = drivers.filter((driver) => normalizeBoolean(driver.is_online, false));
  const availableDrivers = drivers.filter(
    (driver) =>
      normalizeBoolean(driver.is_online, false) &&
      ["available", "online", "ready", "active"].includes(lower(driver.status))
  );

  const offeredDispatches = dispatches.filter((d) => lower(d.status) === "offered");
  const acceptedDispatches = dispatches.filter((d) => lower(d.status) === "accepted");
  const rejectedDispatches = dispatches.filter((d) => lower(d.status) === "rejected");
  const expiredDispatches = dispatches.filter((d) => lower(d.status) === "expired");

  const grossRevenue = completedRides.reduce((sum, ride) => {
    const amount = Number(ride.final_total || ride.estimated_total || 0);
    return sum + (Number.isFinite(amount) ? amount : 0);
  }, 0);

  const capturedRevenue = payments.reduce((sum, payment) => {
    const amount = Number(payment.captured_amount || 0);
    return sum + (Number.isFinite(amount) ? amount : 0);
  }, 0);

  return {
    generated_at: nowISO(),
    rides: {
      total_30d: rides.length,
      active: activeRides.length,
      completed: completedRides.length,
      cancelled: cancelledRides.length,
      no_driver_available: noDriverRides.length,
      by_status: countBy(rides, (row) => row.status || "unknown")
    },
    drivers: {
      total_30d: drivers.length,
      online: onlineDrivers.length,
      available: availableDrivers.length,
      by_status: countBy(drivers, (row) => row.status || "unknown"),
      by_type: countBy(drivers, (row) => row.driver_type || "unknown")
    },
    dispatches: {
      total_30d: dispatches.length,
      offered: offeredDispatches.length,
      accepted: acceptedDispatches.length,
      rejected: rejectedDispatches.length,
      expired: expiredDispatches.length,
      by_status: countBy(dispatches, (row) => row.status || "unknown")
    },
    revenue: {
      gross_rides_total: asMoney(grossRevenue, 0),
      captured_payments_total: asMoney(capturedRevenue, 0),
      completed_ride_count: completedRides.length
    }
  };
}

/* =========================================================
   ADMIN DASHBOARD ROUTES
========================================================= */
app.get("/api/admin/dashboard", async (req, res) => {
  try {
    assertAdmin(req);
    const snapshot = await getAdminDashboardSnapshot();

    return ok(res, {
      dashboard: snapshot
    });
  } catch (error) {
    console.error("❌ /api/admin/dashboard failed:", error);
    return fail(
      res,
      Number(error.statusCode || 500),
      error.message || "Unable to fetch admin dashboard"
    );
  }
});

app.get("/api/admin/analytics/summary", async (req, res) => {
  try {
    assertAdmin(req);
    requireSupabase();

    const days = Math.min(Math.max(toNumber(req.query?.days, 7), 1), 365);

    const [rides, dispatches, payments, earnings] = await Promise.all([
      getRecentRows("rides", days, "created_at"),
      getRecentRows("dispatches", days, "created_at"),
      getRecentRows("payments", days, "created_at").catch(() => []),
      getRecentRows("driver_earnings", days, "created_at").catch(async () => {
        return getRecentRows("driver_payouts", days, "created_at").catch(() => []);
      })
    ]);

    const completedRides = rides.filter((ride) => lower(ride.status) === "completed");
    const acceptedDispatches = dispatches.filter((d) => lower(d.status) === "accepted");
    const offeredDispatches = dispatches.filter((d) => lower(d.status) === "offered");
    const expiredDispatches = dispatches.filter((d) => lower(d.status) === "expired");

    const acceptanceRate =
      dispatches.length > 0
        ? asMoney(acceptedDispatches.length / dispatches.length, 0)
        : 0;

    const expiryRate =
      dispatches.length > 0
        ? asMoney(expiredDispatches.length / dispatches.length, 0)
        : 0;

    return ok(res, {
      days,
      rides: {
        total: rides.length,
        completed: completedRides.length,
        by_status: countBy(rides, (row) => row.status || "unknown"),
        gross_total: asMoney(
          completedRides.reduce((sum, ride) => {
            const amount = Number(ride.final_total || ride.estimated_total || 0);
            return sum + (Number.isFinite(amount) ? amount : 0);
          }, 0),
          0
        )
      },
      dispatches: {
        total: dispatches.length,
        offered_open: offeredDispatches.length,
        accepted: acceptedDispatches.length,
        expired: expiredDispatches.length,
        acceptance_rate: acceptanceRate,
        expiry_rate: expiryRate,
        by_status: countBy(dispatches, (row) => row.status || "unknown")
      },
      payments: {
        total_records: payments.length,
        authorized_total: sumMoney(payments, "authorized_amount"),
        captured_total: sumMoney(payments, "captured_amount"),
        released_total: sumMoney(payments, "released_amount"),
        by_status: countBy(payments, (row) => row.status || "unknown")
      },
      driver_payouts: {
        total_records: earnings.length,
        payout_total: asMoney(
          earnings.reduce((sum, row) => {
            const amount = Number(row.payout_amount || row.amount || 0);
            return sum + (Number.isFinite(amount) ? amount : 0);
          }, 0),
          0
        ),
        by_status: countBy(earnings, (row) => row.status || "unknown")
      }
    });
  } catch (error) {
    console.error("❌ /api/admin/analytics/summary failed:", error);
    return fail(
      res,
      Number(error.statusCode || 500),
      error.message || "Unable to fetch analytics summary"
    );
  }
});

app.get("/api/admin/analytics/daily", async (req, res) => {
  try {
    assertAdmin(req);
    requireSupabase();

    const days = Math.min(Math.max(toNumber(req.query?.days, 14), 1), 90);
    const rides = await getRecentRows("rides", days, "created_at");

    const buckets = {};

    for (const ride of rides) {
      const key = String(ride.created_at || "").slice(0, 10) || "unknown";
      if (!buckets[key]) {
        buckets[key] = {
          date: key,
          ride_count: 0,
          completed_count: 0,
          cancelled_count: 0,
          revenue_total: 0
        };
      }

      buckets[key].ride_count += 1;

      if (lower(ride.status) === "completed") {
        buckets[key].completed_count += 1;
        buckets[key].revenue_total += Number(
          ride.final_total || ride.estimated_total || 0
        );
      }

      if (lower(ride.status) === "cancelled") {
        buckets[key].cancelled_count += 1;
      }
    }

    const rows = Object.values(buckets)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((row) => ({
        ...row,
        revenue_total: asMoney(row.revenue_total, 0)
      }));

    return ok(res, {
      days,
      count: rows.length,
      daily: rows
    });
  } catch (error) {
    console.error("❌ /api/admin/analytics/daily failed:", error);
    return fail(
      res,
      Number(error.statusCode || 500),
      error.message || "Unable to fetch daily analytics"
    );
  }
});

/* =========================================================
   ADMIN DRIVER OPERATIONS
========================================================= */
app.get("/api/admin/drivers/online", async (req, res) => {
  try {
    assertAdmin(req);
    requireSupabase();

    const { data, error } = await supabase
      .from("drivers")
      .select(`
        id,
        first_name,
        last_name,
        email,
        phone,
        status,
        driver_type,
        is_online,
        rating,
        current_ride_id,
        current_mission_id,
        last_seen_at,
        last_lat,
        last_lng,
        vehicle_make,
        vehicle_model,
        vehicle_color,
        vehicle_plate
      `)
      .eq("is_online", true)
      .order("last_seen_at", { ascending: false });

    if (error) {
      const err = new Error(error.message || "Unable to fetch online drivers");
      err.statusCode = 500;
      throw err;
    }

    return ok(res, {
      count: (data || []).length,
      drivers: data || []
    });
  } catch (error) {
    console.error("❌ /api/admin/drivers/online failed:", error);
    return fail(
      res,
      Number(error.statusCode || 500),
      error.message || "Unable to fetch online drivers"
    );
  }
});

app.post("/api/admin/drivers/:driverId/force-offline", async (req, res) => {
  try {
    assertAdmin(req);

    const driverId = cleanEnv(req.params.driverId);
    if (!driverId) return fail(res, 400, "driverId is required");

    const driver = await safeUpdateById("drivers", driverId, {
      is_online: false,
      status: "offline",
      current_mission_id: null,
      updated_at: nowISO()
    });

    await logAdminEvent("driver_force_offline", {
      driver_id: driverId
    });

    return ok(res, {
      message: "Driver forced offline",
      driver
    });
  } catch (error) {
    console.error("❌ /api/admin/drivers/:driverId/force-offline failed:", error);
    return fail(
      res,
      Number(error.statusCode || 500),
      error.message || "Unable to force driver offline"
    );
  }
});

app.post("/api/admin/drivers/:driverId/reset-mission", async (req, res) => {
  try {
    assertAdmin(req);

    const driverId = cleanEnv(req.params.driverId);
    if (!driverId) return fail(res, 400, "driverId is required");

    const driver = await safeUpdateById("drivers", driverId, {
      current_ride_id: null,
      current_mission_id: null,
      status: "available",
      updated_at: nowISO()
    });

    await logAdminEvent("driver_mission_reset", {
      driver_id: driverId
    });

    return ok(res, {
      message: "Driver mission reset",
      driver
    });
  } catch (error) {
    console.error("❌ /api/admin/drivers/:driverId/reset-mission failed:", error);
    return fail(
      res,
      Number(error.statusCode || 500),
      error.message || "Unable to reset driver mission"
    );
  }
});

/* =========================================================
   ADMIN RIDE / DISPATCH CONTROLS
========================================================= */
app.get("/api/admin/rides/active", async (req, res) => {
  try {
    assertAdmin(req);
    requireSupabase();

    const statuses = [
      "awaiting_dispatch",
      "awaiting_driver_acceptance",
      "dispatched",
      "driver_en_route",
      "arrived",
      "in_progress"
    ];

    const { data, error } = await supabase
      .from("rides")
      .select("*")
      .in("status", statuses)
      .order("updated_at", { ascending: false });

    if (error) {
      const err = new Error(error.message || "Unable to fetch active rides");
      err.statusCode = 500;
      throw err;
    }

    return ok(res, {
      count: (data || []).length,
      rides: data || []
    });
  } catch (error) {
    console.error("❌ /api/admin/rides/active failed:", error);
    return fail(
      res,
      Number(error.statusCode || 500),
      error.message || "Unable to fetch active rides"
    );
  }
});

app.post("/api/admin/rides/:rideId/redispatch", async (req, res) => {
  try {
    assertAdmin(req);

    const rideId = cleanEnv(req.params.rideId);
    if (!rideId) return fail(res, 400, "rideId is required");

    const ride = await getRideById(rideId);

    const openDispatch = await getOpenRideDispatch(ride.id).catch(() => null);
    if (openDispatch) {
      await expireDispatch(openDispatch.id, "admin_forced_redispatch");
    }

    const result = await redispatchRideIfEligibleV2(ride.id);

    await logAdminEvent("ride_redispatched", {
      ride_id: rideId,
      redispatched: !!result.redispatched,
      reason: result.reason || null
    });

    return ok(res, {
      message: result.redispatched ? "Ride redispatched" : "Ride not redispatched",
      redispatch: result
    });
  } catch (error) {
    console.error("❌ /api/admin/rides/:rideId/redispatch failed:", error);
    return fail(
      res,
      Number(error.statusCode || 500),
      error.message || "Unable to redispatch ride"
    );
  }
});

app.post("/api/admin/rides/:rideId/assign-driver", async (req, res) => {
  try {
    assertAdmin(req);

    const rideId = cleanEnv(req.params.rideId);
    const driverId = cleanEnv(req.body?.driver_id || req.body?.driverId);

    if (!rideId) return fail(res, 400, "rideId is required");
    if (!driverId) return fail(res, 400, "driver_id is required");

    const ride = await getRideById(rideId);
    const driver = await getDriverById(driverId);

    if (!canDriverOperateRide({ ...driver, current_ride_id: ride.id }, ride)) {
      return fail(res, 403, "Driver is not eligible for this ride");
    }

    const attemptNumber = Number(ride.dispatch_attempts || 0) + 1;
    const dispatch = await createDispatchOfferV2({
      ride,
      driver: {
        ...driver,
        dispatch_score: 999,
        pickup_distance_miles: 0,
        avg_response_seconds: 0,
        acceptance_ratio: driver.acceptance_rate || 1,
        active_offer_count: 0
      },
      attemptNumber
    });

    const acceptedDispatch = await acceptDispatchV2(dispatch.id);
    const updatedRide = await getRideById(rideId);

    await logAdminEvent("ride_driver_assigned", {
      ride_id: rideId,
      driver_id: driverId,
      dispatch_id: acceptedDispatch.id
    });

    return ok(res, {
      message: "Driver assigned to ride",
      dispatch: acceptedDispatch,
      ride: updatedRide
    });
  } catch (error) {
    console.error("❌ /api/admin/rides/:rideId/assign-driver failed:", error);
    return fail(
      res,
      Number(error.statusCode || 500),
      error.message || "Unable to assign driver"
    );
  }
});

app.post("/api/admin/rides/:rideId/mark-no-driver", async (req, res) => {
  try {
    assertAdmin(req);

    const rideId = cleanEnv(req.params.rideId);
    const reason = cleanEnv(req.body?.reason || "admin_marked_no_driver");

    if (!rideId) return fail(res, 400, "rideId is required");

    const ride = await markRideNoDriverAvailable(rideId, 0, reason);

    await logAdminEvent("ride_marked_no_driver", {
      ride_id: rideId,
      reason
    });

    return ok(res, {
      message: "Ride marked no driver available",
      ride
    });
  } catch (error) {
    console.error("❌ /api/admin/rides/:rideId/mark-no-driver failed:", error);
    return fail(
      res,
      Number(error.statusCode || 500),
      error.message || "Unable to mark ride as no driver available"
    );
  }
});

/* =========================================================
   ADMIN OPERATIONAL QUEUES
========================================================= */
app.get("/api/admin/queues", async (req, res) => {
  try {
    assertAdmin(req);
    requireSupabase();

    const [rides, dispatches, payments] = await Promise.all([
      supabase
        .from("rides")
        .select("*")
        .in("status", [
          "awaiting_dispatch",
          "awaiting_driver_acceptance",
          "dispatched",
          "driver_en_route",
          "arrived",
          "in_progress",
          "no_driver_available"
        ])
        .order("updated_at", { ascending: false }),
      supabase
        .from("dispatches")
        .select("*")
        .in("status", ["offered", "expired", "rejected"])
        .order("updated_at", { ascending: false }),
      supabase
        .from("payments")
        .select("*")
        .in("status", ["authorized", "failed"])
        .order("updated_at", { ascending: false })
        .limit(100)
    ]);

    if (rides.error) throw new Error(rides.error.message || "rides queue failed");
    if (dispatches.error) throw new Error(dispatches.error.message || "dispatch queue failed");
    if (payments.error) throw new Error(payments.error.message || "payment queue failed");

    return ok(res, {
      rides: {
        count: (rides.data || []).length,
        items: rides.data || []
      },
      dispatches: {
        count: (dispatches.data || []).length,
        items: dispatches.data || []
      },
      payments: {
        count: (payments.data || []).length,
        items: payments.data || []
      }
    });
  } catch (error) {
    console.error("❌ /api/admin/queues failed:", error);
    return fail(
      res,
      Number(error.statusCode || 500),
      error.message || "Unable to fetch admin queues"
    );
  }
});

/* =========================================================
   ADMIN SYSTEM ACTIONS
========================================================= */
app.post("/api/admin/system/run-dispatch-sweep", async (req, res) => {
  try {
    assertAdmin(req);

    await sweepExpiredDispatches();

    await logAdminEvent("system_dispatch_sweep_run", {
      triggered_at: nowISO()
    });

    return ok(res, {
      message: "Dispatch sweep executed"
    });
  } catch (error) {
    console.error("❌ /api/admin/system/run-dispatch-sweep failed:", error);
    return fail(
      res,
      Number(error.statusCode || 500),
      error.message || "Unable to run dispatch sweep"
    );
  }
});

app.get("/api/admin/system/config", async (req, res) => {
  try {
    assertAdmin(req);

    return ok(res, {
      app_name: APP_NAME,
      environment: NODE_ENV,
      started_at: SERVER_STARTED_AT,
      features: {
        ai: ENABLE_AI,
        rider_verification_gate: ENABLE_RIDER_VERIFICATION_GATE,
        payment_gate: ENABLE_PAYMENT_GATE,
        auto_redispatch: ENABLE_AUTO_REDISPATCH,
        trip_timeline: ENABLE_TRIP_TIMELINE,
        real_persona: ENABLE_REAL_PERSONA,
        real_stripe: ENABLE_REAL_STRIPE
      },
      dispatch: {
        timeout_seconds: DISPATCH_TIMEOUT_SECONDS,
        max_attempts: MAX_DISPATCH_ATTEMPTS,
        sweep_interval_ms: DISPATCH_SWEEP_INTERVAL_MS,
        driver_max_active_offers: DRIVER_MAX_ACTIVE_OFFERS,
        driver_max_distance_miles: DRIVER_MAX_DISTANCE_MILES
      },
      pricing: {
        base_fare: DEFAULT_BASE_FARE,
        per_mile: DEFAULT_PER_MILE,
        per_minute: DEFAULT_PER_MINUTE,
        booking_fee: DEFAULT_BOOKING_FEE,
        minimum_fare: DEFAULT_MINIMUM_FARE
      }
    });
  } catch (error) {
    console.error("❌ /api/admin/system/config failed:", error);
    return fail(
      res,
      Number(error.statusCode || 500),
      error.message || "Unable to fetch system config"
    );
  }
});/* =========================================================
   PART 9 — PRODUCTION POLISH + STARTUP SAFETY + HARDENING
========================================================= */

/* =========================================================
   STARTUP SAFETY CONFIG
========================================================= */
const ENABLE_STARTUP_TABLE_CHECKS = toBool(
  process.env.ENABLE_STARTUP_TABLE_CHECKS,
  true
);

const ENABLE_SCHEMA_GUARDS = toBool(
  process.env.ENABLE_SCHEMA_GUARDS,
  true
);

const ENABLE_REQUEST_LOGGING = toBool(
  process.env.ENABLE_REQUEST_LOGGING,
  true
);

const REQUEST_WARN_THRESHOLD_MS = toNumber(
  process.env.REQUEST_WARN_THRESHOLD_MS,
  2500
);

const REQUIRED_TABLES = [
  "riders",
  "drivers",
  "rides",
  "dispatches",
  "payments",
  "admin_logs"
];

const OPTIONAL_TABLES = [
  "trip_events",
  "trip_timelines",
  "driver_locations",
  "driver_earnings",
  "driver_payouts",
  "tips"
];

/* =========================================================
   REQUEST LOGGING MIDDLEWARE
========================================================= */
if (ENABLE_REQUEST_LOGGING) {
  app.use((req, res, next) => {
    const started = Date.now();
    const requestId = generateId("req");

    req.request_id = requestId;
    res.setHeader("x-request-id", requestId);

    res.on("finish", () => {
      const durationMs = Date.now() - started;
      const logFn =
        durationMs >= REQUEST_WARN_THRESHOLD_MS || res.statusCode >= 500
          ? console.warn
          : console.log;

      logFn(
        `[${requestId}] ${req.method} ${req.originalUrl} -> ${res.statusCode} ${durationMs}ms`
      );
    });

    next();
  });
}

/* =========================================================
   SAFE TABLE CHECKS
========================================================= */
async function checkTableReadable(tableName) {
  if (!supabase) {
    return {
      table: tableName,
      exists: false,
      readable: false,
      error: "supabase_not_configured"
    };
  }

  try {
    const { error } = await supabase
      .from(tableName)
      .select("*", { head: true, count: "exact" })
      .limit(1);

    if (error) {
      return {
        table: tableName,
        exists: false,
        readable: false,
        error: error.message
      };
    }

    return {
      table: tableName,
      exists: true,
      readable: true,
      error: null
    };
  } catch (error) {
    return {
      table: tableName,
      exists: false,
      readable: false,
      error: error.message
    };
  }
}

async function runStartupTableChecks() {
  if (!ENABLE_STARTUP_TABLE_CHECKS || !supabase) {
    return {
      enabled: ENABLE_STARTUP_TABLE_CHECKS,
      ran: false,
      required: [],
      optional: []
    };
  }

  const required = [];
  const optional = [];

  for (const table of REQUIRED_TABLES) {
    required.push(await checkTableReadable(table));
  }

  for (const table of OPTIONAL_TABLES) {
    optional.push(await checkTableReadable(table));
  }

  return {
    enabled: true,
    ran: true,
    required,
    optional
  };
}

/* =========================================================
   SCHEMA GUARDS
========================================================= */
function assertRequiredRideShape(ride = {}) {
  if (!ENABLE_SCHEMA_GUARDS) return true;

  const requiredFields = [
    "id",
    "rider_id",
    "status",
    "requested_mode",
    "ride_type",
    "pickup_address",
    "destination_address"
  ];

  for (const field of requiredFields) {
    if (!Object.prototype.hasOwnProperty.call(ride, field)) {
      const err = new Error(`Ride schema guard failed: missing field ${field}`);
      err.statusCode = 500;
      throw err;
    }
  }

  return true;
}

function assertRequiredDriverShape(driver = {}) {
  if (!ENABLE_SCHEMA_GUARDS) return true;

  const requiredFields = [
    "id",
    "status",
    "verification_status"
  ];

  for (const field of requiredFields) {
    if (!Object.prototype.hasOwnProperty.call(driver, field)) {
      const err = new Error(`Driver schema guard failed: missing field ${field}`);
      err.statusCode = 500;
      throw err;
    }
  }

  return true;
}

function assertRequiredRiderShape(rider = {}) {
  if (!ENABLE_SCHEMA_GUARDS) return true;

  const requiredFields = [
    "id",
    "status",
    "verification_status"
  ];

  for (const field of requiredFields) {
    if (!Object.prototype.hasOwnProperty.call(rider, field)) {
      const err = new Error(`Rider schema guard failed: missing field ${field}`);
      err.statusCode = 500;
      throw err;
    }
  }

  return true;
}

/* =========================================================
   OVERRIDES WITH SCHEMA GUARDS
========================================================= */
const __originalGetRideById = getRideById;
getRideById = async function guardedGetRideById(rideId) {
  const ride = await __originalGetRideById(rideId);
  assertRequiredRideShape(ride);
  return ride;
};

const __originalGetDriverById = getDriverById;
getDriverById = async function guardedGetDriverById(driverId) {
  const driver = await __originalGetDriverById(driverId);
  assertRequiredDriverShape(driver);
  return driver;
};

const __originalGetRiderById = getRiderById;
getRiderById = async function guardedGetRiderById(riderId) {
  const rider = await __originalGetRiderById(riderId);
  assertRequiredRiderShape(rider);
  return rider;
};

/* =========================================================
   PROVIDER DIAGNOSTIC HELPERS
========================================================= */
function maskSecret(value = "") {
  const cleanValue = cleanEnv(value);
  if (!cleanValue) return null;
  if (cleanValue.length <= 8) return "********";
  return `${cleanValue.slice(0, 4)}...${cleanValue.slice(-4)}`;
}

function getProviderDiagnostics() {
  return {
    supabase: {
      configured: !!(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY && supabase),
      url_present: !!SUPABASE_URL,
      service_role_present: !!SUPABASE_SERVICE_ROLE_KEY,
      url_hint: SUPABASE_URL ? maskSecret(SUPABASE_URL) : null
    },
    openai: {
      configured: !!(ENABLE_AI && OPENAI_API_KEY && openai),
      enabled: ENABLE_AI,
      model: OPENAI_MODEL || null,
      api_key_present: !!OPENAI_API_KEY
    },
    google_maps: {
      configured: !!GOOGLE_MAPS_API_KEY,
      api_key_present: !!GOOGLE_MAPS_API_KEY
    },
    persona: {
      configured: !!(
        PERSONA_API_KEY &&
        PERSONA_TEMPLATE_ID_RIDER &&
        PERSONA_TEMPLATE_ID_DRIVER
      ),
      real_mode_enabled: ENABLE_REAL_PERSONA,
      api_key_present: !!PERSONA_API_KEY,
      rider_template_present: !!PERSONA_TEMPLATE_ID_RIDER,
      driver_template_present: !!PERSONA_TEMPLATE_ID_DRIVER
    },
    stripe: {
      configured: !!(ENABLE_REAL_STRIPE && STRIPE_SECRET_KEY && stripe),
      real_mode_enabled: ENABLE_REAL_STRIPE,
      secret_key_present: !!STRIPE_SECRET_KEY,
      webhook_secret_present: !!STRIPE_WEBHOOK_SECRET
    },
    twilio: {
      configured: !!(
        TWILIO_ACCOUNT_SID &&
        TWILIO_AUTH_TOKEN &&
        TWILIO_FROM_NUMBER
      ),
      sid_present: !!TWILIO_ACCOUNT_SID,
      token_present: !!TWILIO_AUTH_TOKEN,
      from_number_present: !!TWILIO_FROM_NUMBER
    },
    smtp: {
      configured: !!(
        SMTP_HOST &&
        SMTP_PORT &&
        SMTP_USER &&
        SMTP_PASS &&
        SMTP_FROM
      ),
      host_present: !!SMTP_HOST,
      port_present: !!SMTP_PORT,
      user_present: !!SMTP_USER,
      pass_present: !!SMTP_PASS,
      from_present: !!SMTP_FROM
    }
  };
}

/* =========================================================
   SYSTEM SAFETY HELPERS
========================================================= */
function buildSystemWarnings() {
  const warnings = [];

  if (!supabase) warnings.push("Supabase is not configured");
  if (ENABLE_AI && !openai) warnings.push("AI is enabled but OpenAI is unavailable");
  if (ENABLE_PAYMENT_GATE && ENABLE_REAL_STRIPE && !stripe) {
    warnings.push("Payment gate enabled but Stripe real mode is unavailable");
  }
  if (ENABLE_PERSONA_ENFORCEMENT && ENABLE_REAL_PERSONA && !PERSONA_API_KEY) {
    warnings.push("Persona enforcement enabled but Persona API key is missing");
  }
  if (!GOOGLE_MAPS_API_KEY) {
    warnings.push("Google Maps key missing, fallback route estimation will be used");
  }

  return warnings;
}

function buildSystemReadinessSummary() {
  const diagnostics = getProviderDiagnostics();
  const warnings = buildSystemWarnings();

  return {
    app_name: APP_NAME,
    environment: NODE_ENV,
    started_at: SERVER_STARTED_AT,
    uptime_seconds: Math.round(process.uptime()),
    features: {
      ai: ENABLE_AI,
      rider_verification_gate: ENABLE_RIDER_VERIFICATION_GATE,
      payment_gate: ENABLE_PAYMENT_GATE,
      auto_redispatch: ENABLE_AUTO_REDISPATCH,
      trip_timeline: ENABLE_TRIP_TIMELINE,
      startup_table_checks: ENABLE_STARTUP_TABLE_CHECKS,
      schema_guards: ENABLE_SCHEMA_GUARDS,
      request_logging: ENABLE_REQUEST_LOGGING
    },
    provider_diagnostics: diagnostics,
    warnings
  };
}

/* =========================================================
   PUBLIC READY / META ROUTES
========================================================= */
app.get("/readyz", async (req, res) => {
  try {
    const summary = buildSystemReadinessSummary();

    const healthy =
      summary.provider_diagnostics.supabase.configured &&
      (!ENABLE_AI || summary.provider_diagnostics.openai.api_key_present);

    return res.status(healthy ? 200 : 503).json({
      ok: healthy,
      service: "harvey-taxi",
      timestamp: nowISO(),
      summary
    });
  } catch (error) {
    return res.status(503).json({
      ok: false,
      message: error.message || "Readiness check failed"
    });
  }
});

app.get("/api/meta", async (req, res) => {
  try {
    return ok(res, {
      app_name: APP_NAME,
      environment: NODE_ENV,
      started_at: SERVER_STARTED_AT,
      public_app_url: PUBLIC_APP_URL || null,
      version: "code_blue_phase_9",
      timestamp: nowISO()
    });
  } catch (error) {
    return fail(res, 500, error.message || "Unable to fetch meta");
  }
});

/* =========================================================
   ADMIN DIAGNOSTIC ROUTES
========================================================= */
app.get("/api/admin/system/readiness", async (req, res) => {
  try {
    assertAdmin(req);

    const summary = buildSystemReadinessSummary();
    const tableChecks = await runStartupTableChecks();

    return ok(res, {
      readiness: summary,
      table_checks: tableChecks
    });
  } catch (error) {
    console.error("❌ /api/admin/system/readiness failed:", error);
    return fail(
      res,
      Number(error.statusCode || 500),
      error.message || "Unable to fetch readiness"
    );
  }
});

app.get("/api/admin/system/warnings", async (req, res) => {
  try {
    assertAdmin(req);

    return ok(res, {
      warnings: buildSystemWarnings(),
      count: buildSystemWarnings().length
    });
  } catch (error) {
    console.error("❌ /api/admin/system/warnings failed:", error);
    return fail(
      res,
      Number(error.statusCode || 500),
      error.message || "Unable to fetch system warnings"
    );
  }
});

app.get("/api/admin/system/table-checks", async (req, res) => {
  try {
    assertAdmin(req);

    const results = await runStartupTableChecks();

    return ok(res, {
      table_checks: results
    });
  } catch (error) {
    console.error("❌ /api/admin/system/table-checks failed:", error);
    return fail(
      res,
      Number(error.statusCode || 500),
      error.message || "Unable to run table checks"
    );
  }
});

/* =========================================================
   SOFT MAINTENANCE MODE SUPPORT
========================================================= */
const MAINTENANCE_MODE = toBool(process.env.MAINTENANCE_MODE, false);

app.use((req, res, next) => {
  if (!MAINTENANCE_MODE) return next();

  const adminEmail = cleanEnv(req.headers["x-admin-email"]);
  const adminPassword = cleanEnv(req.headers["x-admin-password"]);

  const isAdminBypass =
    ADMIN_EMAIL &&
    ADMIN_PASSWORD &&
    adminEmail === ADMIN_EMAIL &&
    adminPassword === ADMIN_PASSWORD;

  if (isAdminBypass) return next();

  if (
    req.path === "/healthz" ||
    req.path === "/readyz" ||
    req.path === "/ping" ||
    req.path === "/api/health"
  ) {
    return next();
  }

  return res.status(503).json({
    success: false,
    message: "Service temporarily in maintenance mode"
  });
});

/* =========================================================
   BETTER NOT-FOUND CONTEXT
========================================================= */
app.use((req, res, next) => {
  if (res.headersSent) return next();

  return fail(res, 404, "Route not found", {
    method: req.method,
    path: req.originalUrl,
    request_id: req.request_id || null,
    hint:
      req.originalUrl?.startsWith("/api/")
        ? "Check the route path and HTTP method"
        : "This page does not exist"
  });
});

/* =========================================================
   FINAL ERROR HARDENING
========================================================= */
app.use((error, req, res, next) => {
  const statusCode = Number(error?.statusCode || 500);
  const message =
    error?.message ||
    (statusCode >= 500 ? "Internal server error" : "Request failed");

  console.error("❌ SERVER ERROR:", {
    request_id: req?.request_id || null,
    message,
    statusCode,
    method: req?.method,
    path: req?.originalUrl,
    details: error?.details || null,
    stack: error?.stack || null
  });

  return res.status(statusCode).json({
    success: false,
    message,
    request_id: req?.request_id || null,
    ...(error?.details ? { details: error.details } : {})
  });
});

/* =========================================================
   BOOTSTRAP RUNNER
========================================================= */
async function bootstrapServerDiagnostics() {
  try {
    const summary = buildSystemReadinessSummary();

    console.log("====================================================");
    console.log("🚀 HARVEY TAXI PRODUCTION BOOTSTRAP");
    console.log("APP:", summary.app_name);
    console.log("ENV:", summary.environment);
    console.log("STARTED:", summary.started_at);
    console.log("WARNINGS:", summary.warnings.length ? summary.warnings : "none");
    console.log("====================================================");

    if (ENABLE_STARTUP_TABLE_CHECKS && supabase) {
      const tableChecks = await runStartupTableChecks();

      const failedRequired = (tableChecks.required || []).filter(
        (item) => !item.readable
      );

      console.log("📊 Startup table checks:", tableChecks);

      if (failedRequired.length) {
        console.warn(
          "⚠️ Required table check failures detected:",
          failedRequired.map((item) => `${item.table}: ${item.error}`)
        );
      }
    }
  } catch (error) {
    console.warn("⚠️ bootstrap diagnostics failed:", error.message);
  }
}

/* =========================================================
   OPTIONAL SAFE SHUTDOWN LOGGING
========================================================= */
function attachShutdownHandlers() {
  const shutdown = (signal) => {
    console.log(`🛑 Received ${signal}. Harvey Taxi shutting down gracefully.`);
    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

attachShutdownHandlers();

/* =========================================================
   START BOOTSTRAP DIAGNOSTICS
========================================================= */
bootstrapServerDiagnostics().catch((error) => {
  console.warn("⚠️ bootstrapServerDiagnostics uncaught warning:", error.message);
});/* =========================================================
   PART 10 — FINAL LAUNCH-SAFE CLEANUP + COMPATIBILITY LAYER
========================================================= */

/* =========================================================
   ROUTE VERSION PREFERENCE GUIDE
========================================================= */
const ROUTE_GUIDE = {
  rider_payment_authorize: "/api/riders/:riderId/authorize-payment",
  ride_request: "/api/request-ride-v3",
  ride_dispatch: "/api/rides/:rideId/dispatch-v2",
  dispatch_accept: "/api/dispatches/:dispatchId/accept-v2",
  dispatch_reject: "/api/dispatches/:dispatchId/reject-v2",
  dispatch_expire: "/api/dispatches/:dispatchId/expire-v2",
  ride_arrive: "/api/rides/:rideId/driver-arrived-v2",
  ride_start: "/api/rides/:rideId/start-v2",
  ride_complete: "/api/rides/:rideId/complete-v3",
  ride_cancel: "/api/rides/:rideId/cancel-v3",
  rider_dashboard: "/api/riders/:riderId/dashboard",
  driver_dashboard: "/api/drivers/:driverId/dashboard",
  live_status: "/api/rides/:rideId/live-status",
  fare_estimate: "/api/fare-estimate-live",
  verification_start_rider: "/api/riders/:riderId/start-verification",
  verification_start_driver: "/api/drivers/:driverId/start-verification"
};

app.get("/api/routes", (req, res) => {
  return ok(res, {
    message: "Preferred production routes",
    routes: ROUTE_GUIDE
  });
});

/* =========================================================
   BACKWARD-COMPATIBLE ALIAS HELPERS
========================================================= */
function aliasNotice(preferred, legacy) {
  return {
    legacy_route: legacy,
    preferred_route: preferred,
    deprecated: true
  };
}

function mergeAliasBody(req, extra = {}) {
  return {
    ...(req.body || {}),
    ...extra
  };
}

/* =========================================================
   LEGACY -> NEW ROUTE ALIASES
========================================================= */
app.post("/api/request-ride-final", async (req, res, next) => {
  req.url = "/api/request-ride-v3";
  req.originalUrl = "/api/request-ride-final";
  req.body = mergeAliasBody(req, {
    _alias_notice: aliasNotice("/api/request-ride-v3", "/api/request-ride-final")
  });
  return app._router.handle(req, res, next);
});

app.post("/api/rides/:rideId/dispatch-final", async (req, res, next) => {
  req.url = `/api/rides/${req.params.rideId}/dispatch-v2`;
  req.originalUrl = `/api/rides/${req.params.rideId}/dispatch-final`;
  req.body = mergeAliasBody(req, {
    _alias_notice: aliasNotice(
      "/api/rides/:rideId/dispatch-v2",
      "/api/rides/:rideId/dispatch-final"
    )
  });
  return app._router.handle(req, res, next);
});

app.post("/api/dispatches/:dispatchId/accept-final", async (req, res, next) => {
  req.url = `/api/dispatches/${req.params.dispatchId}/accept-v2`;
  req.originalUrl = `/api/dispatches/${req.params.dispatchId}/accept-final`;
  req.body = mergeAliasBody(req, {
    _alias_notice: aliasNotice(
      "/api/dispatches/:dispatchId/accept-v2",
      "/api/dispatches/:dispatchId/accept-final"
    )
  });
  return app._router.handle(req, res, next);
});

app.post("/api/rides/:rideId/complete-final", async (req, res, next) => {
  req.url = `/api/rides/${req.params.rideId}/complete-v3`;
  req.originalUrl = `/api/rides/${req.params.rideId}/complete-final`;
  req.body = mergeAliasBody(req, {
    _alias_notice: aliasNotice(
      "/api/rides/:rideId/complete-v3",
      "/api/rides/:rideId/complete-final"
    )
  });
  return app._router.handle(req, res, next);
});

app.post("/api/rides/:rideId/cancel-final", async (req, res, next) => {
  req.url = `/api/rides/${req.params.rideId}/cancel-v3`;
  req.originalUrl = `/api/rides/${req.params.rideId}/cancel-final`;
  req.body = mergeAliasBody(req, {
    _alias_notice: aliasNotice(
      "/api/rides/:rideId/cancel-v3",
      "/api/rides/:rideId/cancel-final"
    )
  });
  return app._router.handle(req, res, next);
});

/* =========================================================
   ENV VALIDATION HELPERS
========================================================= */
function validateCriticalEnv() {
  const issues = [];

  if (!SUPABASE_URL) issues.push("SUPABASE_URL missing");
  if (!SUPABASE_SERVICE_ROLE_KEY) issues.push("SUPABASE_SERVICE_ROLE_KEY missing");
  if (!ADMIN_EMAIL) issues.push("ADMIN_EMAIL missing");
  if (!ADMIN_PASSWORD) issues.push("ADMIN_PASSWORD missing");

  if (ENABLE_REAL_STRIPE && !STRIPE_SECRET_KEY) {
    issues.push("ENABLE_REAL_STRIPE is on but STRIPE_SECRET_KEY missing");
  }

  if (ENABLE_REAL_PERSONA) {
    if (!PERSONA_API_KEY) issues.push("ENABLE_REAL_PERSONA is on but PERSONA_API_KEY missing");
    if (!PERSONA_TEMPLATE_ID_RIDER) {
      issues.push("ENABLE_REAL_PERSONA is on but PERSONA_TEMPLATE_ID_RIDER missing");
    }
    if (!PERSONA_TEMPLATE_ID_DRIVER) {
      issues.push("ENABLE_REAL_PERSONA is on but PERSONA_TEMPLATE_ID_DRIVER missing");
    }
  }

  return issues;
}

app.get("/api/admin/system/env-validation", async (req, res) => {
  try {
    assertAdmin(req);

    const issues = validateCriticalEnv();

    return ok(res, {
      valid: issues.length === 0,
      issue_count: issues.length,
      issues
    });
  } catch (error) {
    console.error("❌ /api/admin/system/env-validation failed:", error);
    return fail(
      res,
      Number(error.statusCode || 500),
      error.message || "Unable to validate environment"
    );
  }
});

/* =========================================================
   RECOMMENDED ENV TEMPLATE ROUTE
========================================================= */
app.get("/api/admin/system/env-template", async (req, res) => {
  try {
    assertAdmin(req);

    return ok(res, {
      env_template: {
        NODE_ENV: "production",
        PORT: "10000",
        PUBLIC_APP_URL: "https://your-app-url.onrender.com",

        SUPABASE_URL: "https://YOUR_PROJECT.supabase.co",
        SUPABASE_SERVICE_ROLE_KEY: "YOUR_SUPABASE_SERVICE_ROLE_KEY",

        ADMIN_EMAIL: "admin@yourdomain.com",
        ADMIN_PASSWORD: "your-strong-admin-password",

        GOOGLE_MAPS_API_KEY: "YOUR_GOOGLE_MAPS_API_KEY",

        ENABLE_AI: "true",
        OPENAI_API_KEY: "YOUR_OPENAI_API_KEY",
        OPENAI_MODEL: "gpt-4.1-mini",

        ENABLE_PERSONA_ENFORCEMENT: "true",
        ENABLE_REAL_PERSONA: "false",
        PERSONA_API_KEY: "",
        PERSONA_TEMPLATE_ID_RIDER: "",
        PERSONA_TEMPLATE_ID_DRIVER: "",

        ENABLE_PAYMENT_GATE: "true",
        ENABLE_REAL_STRIPE: "false",
        STRIPE_SECRET_KEY: "",
        STRIPE_WEBHOOK_SECRET: "",

        TWILIO_ACCOUNT_SID: "",
        TWILIO_AUTH_TOKEN: "",
        TWILIO_FROM_NUMBER: "",

        SMTP_HOST: "",
        SMTP_PORT: "587",
        SMTP_USER: "",
        SMTP_PASS: "",
        SMTP_FROM: "support@harveytaxiservice.com",

        ENABLE_AUTO_REDISPATCH: "true",
        DISPATCH_TIMEOUT_SECONDS: "30",
        MAX_DISPATCH_ATTEMPTS: "5",
        DISPATCH_SWEEP_INTERVAL_MS: "15000",

        BASE_FARE: "5.5",
        PER_MILE_RATE: "2.2",
        PER_MINUTE_RATE: "0.4",
        BOOKING_FEE: "2",
        MINIMUM_FARE: "10",

        SURGE_MULTIPLIER_DEFAULT: "1",
        SURGE_MULTIPLIER_BUSY: "1.2",
        SURGE_MULTIPLIER_HIGH: "1.5",

        DRIVER_PAYOUT_RATE: "0.75",

        DRIVER_MAX_ACTIVE_OFFERS: "1",
        DRIVER_MAX_DISTANCE_MILES: "25",
        DRIVER_RECENCY_WINDOW_MINUTES: "15",

        ENABLE_TRIP_TIMELINE: "true",
        ENABLE_STARTUP_TABLE_CHECKS: "true",
        ENABLE_SCHEMA_GUARDS: "true",
        ENABLE_REQUEST_LOGGING: "true",
        REQUEST_WARN_THRESHOLD_MS: "2500",

        MAINTENANCE_MODE: "false"
      }
    });
  } catch (error) {
    console.error("❌ /api/admin/system/env-template failed:", error);
    return fail(
      res,
      Number(error.statusCode || 500),
      error.message || "Unable to fetch env template"
    );
  }
});

/* =========================================================
   DEPLOYMENT CHECKLIST ROUTE
========================================================= */
app.get("/api/admin/system/deployment-checklist", async (req, res) => {
  try {
    assertAdmin(req);

    return ok(res, {
      checklist: [
        "1. Confirm Render service uses only this final server.js",
        "2. Remove all JSON file storage logic and references",
        "3. Confirm package.json start command points to this server file",
        "4. Set all required environment variables in Render",
        "5. Ensure Supabase tables exist and are readable",
        "6. Test /healthz, /readyz, and /api/health",
        "7. Test rider verification gate before ride request",
        "8. Test payment authorization before request-ride-v3",
        "9. Test dispatch-v2 flow with online approved driver",
        "10. Test complete-v3 captures payment and releases driver mission",
        "11. Test cancel-v3 releases payment authorization",
        "12. Test admin dashboard and queues",
        "13. Test Persona webhook if enabled",
        "14. Test Stripe webhook if enabled",
        "15. Confirm Apple app points to correct production backend URL"
      ]
    });
  } catch (error) {
    console.error("❌ /api/admin/system/deployment-checklist failed:", error);
    return fail(
      res,
      Number(error.statusCode || 500),
      error.message || "Unable to fetch deployment checklist"
    );
  }
});

/* =========================================================
   FINAL SELF-TEST ROUTE
========================================================= */
app.get("/api/admin/system/self-test", async (req, res) => {
  try {
    assertAdmin(req);

    const envIssues = validateCriticalEnv();
    const readiness = buildSystemReadinessSummary();
    const tableChecks = await runStartupTableChecks();

    const requiredFailures = (tableChecks.required || []).filter(
      (item) => !item.readable
    );

    const passed = envIssues.length === 0 && requiredFailures.length === 0;

    return ok(res, {
      passed,
      env_issue_count: envIssues.length,
      table_failure_count: requiredFailures.length,
      env_issues: envIssues,
      required_table_failures: requiredFailures,
      readiness
    });
  } catch (error) {
    console.error("❌ /api/admin/system/self-test failed:", error);
    return fail(
      res,
      Number(error.statusCode || 500),
      error.message || "Unable to run self-test"
    );
  }
});

/* =========================================================
   FINAL STARTUP BANNER
========================================================= */
function logFinalLaunchBanner() {
  console.log("====================================================");
  console.log("✅ HARVEY TAXI CODE BLUE PHASE 9/10 SERVER LOADED");
  console.log("✅ Supabase-only architecture");
  console.log("✅ Verification gate + payment gate + dispatch brain");
  console.log("✅ Driver missions + live tracking + admin command center");
  console.log("✅ Production hardening + startup diagnostics enabled");
  console.log("====================================================");
}

logFinalLaunchBanner();

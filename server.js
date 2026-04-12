/* =========================================================
   HARVEY TAXI — CODE BLUE UPGRADED SERVER
   PART 1: CORE FOUNDATION + ENV + HEALTH
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
  console.warn("⚠️ OpenAI SDK not installed. AI features disabled.");
}

/* =========================================================
   APP INIT
========================================================= */
const app = express();
const PORT = Number(process.env.PORT || 10000);
const SERVER_STARTED_AT = new Date().toISOString();
const APP_NAME = "Harvey Taxi";

/* =========================================================
   CORE MIDDLEWARE
========================================================= */
app.use(
  cors({
    origin: true,
    credentials: true
  })
);

app.use(express.json({ limit: "6mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

/* =========================================================
   ENV HELPERS
========================================================= */
function cleanEnv(value = "") {
  return String(value || "")
    .trim()
    .replace(/^['"]|['"]$/g, "");
}

function toBool(value, fallback = false) {
  const normalized = cleanEnv(value).toLowerCase();
  if (!normalized) return fallback;
  return ["1", "true", "yes", "y", "on"].includes(normalized);
}

function toNumber(value, fallback = 0) {
  const n = Number(cleanEnv(value));
  return Number.isFinite(n) ? n : fallback;
}

function lower(value = "") {
  return cleanEnv(value).toLowerCase();
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
const NODE_ENV = cleanEnv(process.env.NODE_ENV || "development");
const PUBLIC_APP_URL = cleanEnv(
  process.env.PUBLIC_APP_URL ||
    process.env.RENDER_EXTERNAL_URL ||
    process.env.APP_BASE_URL
);

const SUPABASE_URL = cleanEnv(process.env.SUPABASE_URL);
const SUPABASE_SERVICE_ROLE_KEY = cleanEnv(
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const ADMIN_EMAIL = cleanEnv(process.env.ADMIN_EMAIL);
const ADMIN_PASSWORD = cleanEnv(process.env.ADMIN_PASSWORD);

const GOOGLE_MAPS_API_KEY = cleanEnv(process.env.GOOGLE_MAPS_API_KEY);

const OPENAI_API_KEY = cleanEnv(process.env.OPENAI_API_KEY);
const OPENAI_MODEL = cleanEnv(
  process.env.OPENAI_MODEL || process.env.OPENAI_SUPPORT_MODEL || "gpt-4.1-mini"
);

const PERSONA_API_KEY = cleanEnv(process.env.PERSONA_API_KEY);
const PERSONA_TEMPLATE_ID_RIDER = cleanEnv(process.env.PERSONA_TEMPLATE_ID_RIDER);
const PERSONA_TEMPLATE_ID_DRIVER = cleanEnv(process.env.PERSONA_TEMPLATE_ID_DRIVER);
const ENABLE_PERSONA_ENFORCEMENT = toBool(
  process.env.ENABLE_PERSONA_ENFORCEMENT,
  true
);

const TWILIO_ACCOUNT_SID = cleanEnv(process.env.TWILIO_ACCOUNT_SID);
const TWILIO_AUTH_TOKEN = cleanEnv(process.env.TWILIO_AUTH_TOKEN);
const TWILIO_FROM_NUMBER = cleanEnv(
  process.env.TWILIO_FROM_NUMBER || process.env.TWILIO_PHONE_NUMBER
);

const SMTP_HOST = cleanEnv(process.env.SMTP_HOST);
const SMTP_PORT = toNumber(process.env.SMTP_PORT, 587);
const SMTP_USER = cleanEnv(process.env.SMTP_USER);
const SMTP_PASS = cleanEnv(process.env.SMTP_PASS);
const SMTP_FROM = cleanEnv(process.env.SMTP_FROM || process.env.SUPPORT_FROM_EMAIL);

const ENABLE_AI = toBool(process.env.ENABLE_AI, true);
const ENABLE_RIDER_VERIFICATION_GATE = toBool(
  process.env.ENABLE_RIDER_VERIFICATION_GATE,
  true
);
const ENABLE_PAYMENT_GATE = toBool(process.env.ENABLE_PAYMENT_GATE, true);
const ENABLE_AUTO_REDISPATCH = toBool(process.env.ENABLE_AUTO_REDISPATCH, true);
const ENABLE_TRIP_TIMELINE = toBool(process.env.ENABLE_TRIP_TIMELINE, true);

const DISPATCH_TIMEOUT_SECONDS = toNumber(
  process.env.DISPATCH_TIMEOUT_SECONDS,
  30
);
const MAX_DISPATCH_ATTEMPTS = toNumber(
  process.env.MAX_DISPATCH_ATTEMPTS,
  5
);

const DEFAULT_BASE_FARE = toNumber(process.env.BASE_FARE, 5.5);
const DEFAULT_PER_MILE = toNumber(process.env.PER_MILE_RATE, 2.2);
const DEFAULT_PER_MINUTE = toNumber(process.env.PER_MINUTE_RATE, 0.4);
const DEFAULT_BOOKING_FEE = toNumber(process.env.BOOKING_FEE, 2);
const DEFAULT_MINIMUM_FARE = toNumber(process.env.MINIMUM_FARE, 10);

const RIDE_TYPE_MULTIPLIERS = {
  standard: 1,
  airport: 1.2,
  medical: 0.95,
  scheduled: 1.15,
  nonprofit: 0.9
};

const MODE_MULTIPLIERS = {
  driver: 1,
  autonomous: 1.1
};

/* =========================================================
   SUPABASE
========================================================= */
let supabase = null;

if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
  supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  console.log("✅ Supabase connected");
} else {
  console.warn("⚠️ Supabase is not configured");
}

/* =========================================================
   OPTIONAL OPENAI
========================================================= */
let openai = null;

if (ENABLE_AI && OPENAI_API_KEY && OpenAI) {
  try {
    openai = new OpenAI({ apiKey: OPENAI_API_KEY });
    console.log("✅ OpenAI connected");
  } catch (error) {
    console.warn("⚠️ OpenAI init failed:", error.message);
  }
} else {
  console.log("ℹ️ AI disabled or not configured");
}

/* =========================================================
   RESPONSE HELPERS
========================================================= */
function ok(res, data = {}, statusCode = 200) {
  return res.status(statusCode).json({
    success: true,
    ...data
  });
}

function fail(res, statusCode = 500, message = "Internal server error", extra = {}) {
  return res.status(statusCode).json({
    success: false,
    message,
    ...extra
  });
}

/* =========================================================
   ADMIN HELPER
========================================================= */
function assertAdmin(req) {
  const email = cleanEnv(req.headers["x-admin-email"] || req.body?.admin_email);
  const password = cleanEnv(
    req.headers["x-admin-password"] || req.body?.admin_password
  );

  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
    const error = new Error("Admin environment not configured");
    error.statusCode = 500;
    throw error;
  }

  if (email !== ADMIN_EMAIL || password !== ADMIN_PASSWORD) {
    const error = new Error("Unauthorized admin request");
    error.statusCode = 401;
    throw error;
  }

  return true;
}

/* =========================================================
   PROVIDER READINESS
========================================================= */
function getProviderReadiness() {
  return {
    supabase: !!(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY && supabase),
    google_maps: !!GOOGLE_MAPS_API_KEY,
    openai: !!(ENABLE_AI && OPENAI_API_KEY && openai),
    persona: !!(PERSONA_API_KEY && PERSONA_TEMPLATE_ID_RIDER && PERSONA_TEMPLATE_ID_DRIVER),
    twilio: !!(TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_FROM_NUMBER),
    smtp: !!(SMTP_HOST && SMTP_PORT && SMTP_USER && SMTP_PASS && SMTP_FROM)
  };
}

/* =========================================================
   STARTUP DIAGNOSTICS
========================================================= */
function logStartupDiagnostics() {
  const readiness = getProviderReadiness();

  console.log("====================================================");
  console.log(`${APP_NAME} starting`);
  console.log("NODE_ENV:", NODE_ENV);
  console.log("PORT:", PORT);
  console.log("PUBLIC_APP_URL:", PUBLIC_APP_URL || "not set");
  console.log("Provider readiness:", readiness);
  console.log("Feature flags:", {
    ENABLE_AI,
    ENABLE_RIDER_VERIFICATION_GATE,
    ENABLE_PAYMENT_GATE,
    ENABLE_AUTO_REDISPATCH,
    ENABLE_TRIP_TIMELINE
  });
  console.log("====================================================");
}

/* =========================================================
   BASIC ROOT ROUTES
========================================================= */
app.get("/", (req, res) => {
  return res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/ping", (req, res) => {
  return ok(res, {
    ok: true,
    app: APP_NAME,
    timestamp: nowISO()
  });
});

/* =========================================================
   HEALTH CHECK (RENDER)
   KEEP ABOVE ERROR HANDLER
========================================================= */
app.get("/healthz", async (req, res) => {
  try {
    return res.status(200).json({
      ok: true,
      service: "harvey-taxi",
      uptime: process.uptime(),
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    return res.status(503).json({
      ok: false,
      error: err.message
    });
  }
});

/* =========================================================
   API HEALTH (SAFE SYSTEM DIAGNOSTICS)
========================================================= */
app.get("/api/health", async (req, res) => {
  try {
    const providers = getProviderReadiness();

    let database = {
      connected: !!supabase,
      check: "not_run"
    };

    if (supabase) {
      try {
        const result = await supabase.from("riders").select("id").limit(1);
        database.check = result.error ? "query_failed" : "ok";
        if (result.error) {
          database.error = result.error.message;
        }
      } catch (dbError) {
        database.check = "exception";
        database.error = dbError.message;
      }
    }

    return res.status(200).json({
      ok: true,
      service: "harvey-taxi",
      app_name: APP_NAME,
      environment: NODE_ENV,
      started_at: SERVER_STARTED_AT,
      uptime: process.uptime(),
      timestamp: nowISO(),
      database,
      providers,
      features: {
        ai: ENABLE_AI,
        rider_verification_gate: ENABLE_RIDER_VERIFICATION_GATE,
        payment_gate: ENABLE_PAYMENT_GATE,
        auto_redispatch: ENABLE_AUTO_REDISPATCH,
        trip_timeline: ENABLE_TRIP_TIMELINE
      }
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: error.message
    });
  }
});/* =========================================================
   INPUT NORMALIZERS
========================================================= */
function normalizeRequestedMode(value = "") {
  const mode = lower(value);
  if (mode === "autonomous" || mode === "av" || mode === "robotaxi") {
    return "autonomous";
  }
  return "driver";
}

function normalizeRideType(value = "") {
  const rideType = lower(value);
  if (["airport", "medical", "scheduled", "nonprofit", "standard"].includes(rideType)) {
    return rideType;
  }
  return "standard";
}

function normalizeText(value = "", fallback = "") {
  const text = cleanEnv(value);
  return text || fallback;
}

function normalizeAddress(value = "") {
  return cleanEnv(value);
}

function normalizeCoordinate(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeBoolean(value, fallback = false) {
  if (typeof value === "boolean") return value;
  const v = lower(value);
  if (!v) return fallback;
  return ["1", "true", "yes", "y", "on"].includes(v);
}

/* =========================================================
   DATABASE SAFETY HELPERS
========================================================= */
function requireSupabase() {
  if (!supabase) {
    const error = new Error("Database unavailable");
    error.statusCode = 500;
    throw error;
  }
  return supabase;
}

async function safeInsert(table, payload) {
  requireSupabase();

  const { data, error } = await supabase
    .from(table)
    .insert(payload)
    .select()
    .single();

  if (error) {
    const err = new Error(error.message || `Insert failed for ${table}`);
    err.statusCode = 500;
    err.details = error;
    throw err;
  }

  return data;
}

async function safeUpdateById(table, id, payload) {
  requireSupabase();

  const { data, error } = await supabase
    .from(table)
    .update(payload)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    const err = new Error(error.message || `Update failed for ${table}`);
    err.statusCode = 500;
    err.details = error;
    throw err;
  }

  return data;
}

/* =========================================================
   TRIP / TIMELINE / ADMIN LOG HELPERS
========================================================= */
async function logAdminEvent(action, details = {}) {
  if (!supabase) return null;

  try {
    await supabase.from("admin_logs").insert({
      id: generateId("adminlog"),
      action: cleanEnv(action),
      details,
      created_at: nowISO()
    });
  } catch (error) {
    console.warn("⚠️ admin_logs insert failed:", error.message);
  }

  return true;
}

async function logTripEvent(rideId, eventType, payload = {}) {
  if (!supabase || !ENABLE_TRIP_TIMELINE || !rideId) return null;

  const eventRecord = {
    id: generateId("tripevent"),
    ride_id: rideId,
    event_type: cleanEnv(eventType),
    payload,
    created_at: nowISO()
  };

  try {
    await supabase.from("trip_events").insert(eventRecord);
  } catch (error) {
    try {
      await supabase.from("trip_timelines").insert({
        id: eventRecord.id,
        ride_id: eventRecord.ride_id,
        event_type: eventRecord.event_type,
        payload: eventRecord.payload,
        created_at: eventRecord.created_at
      });
    } catch (fallbackError) {
      console.warn("⚠️ trip event logging failed:", fallbackError.message);
    }
  }

  return true;
}

/* =========================================================
   RIDER ELIGIBILITY GATE
========================================================= */
async function getRiderById(riderId) {
  requireSupabase();

  const { data, error } = await supabase
    .from("riders")
    .select(`
      id,
      email,
      phone,
      first_name,
      last_name,
      status,
      verification_status,
      payment_authorized,
      payment_status,
      is_blocked,
      is_disabled,
      rider_type,
      created_at
    `)
    .eq("id", riderId)
    .single();

  if (error || !data) {
    const err = new Error("Rider not found");
    err.statusCode = 404;
    err.details = error || null;
    throw err;
  }

  return data;
}

function isApprovedVerificationStatus(value = "") {
  return lower(value) === "approved";
}

function isActiveRiderStatus(value = "") {
  const normalized = lower(value);
  return !normalized || normalized === "active" || normalized === "approved";
}

function hasPaymentAuthorization(rider = {}) {
  if (rider.payment_authorized === true) return true;

  const paymentStatus = lower(rider.payment_status);
  return ["authorized", "preauthorized", "pre_authorized", "approved"].includes(
    paymentStatus
  );
}

async function assertRiderEligibleForRideRequest(riderId) {
  const rider = await getRiderById(riderId);

  if (normalizeBoolean(rider.is_blocked, false)) {
    const err = new Error("Rider account is blocked");
    err.statusCode = 403;
    throw err;
  }

  if (normalizeBoolean(rider.is_disabled, false)) {
    const err = new Error("Rider account is disabled");
    err.statusCode = 403;
    throw err;
  }

  if (!isActiveRiderStatus(rider.status)) {
    const err = new Error("Rider account is not active");
    err.statusCode = 403;
    err.details = {
      rider_status: rider.status || "inactive"
    };
    throw err;
  }

  if (ENABLE_RIDER_VERIFICATION_GATE && !isApprovedVerificationStatus(rider.verification_status)) {
    const err = new Error("Rider verification is not approved");
    err.statusCode = 403;
    err.details = {
      verification_status: rider.verification_status || "unverified"
    };
    throw err;
  }

  if (ENABLE_PAYMENT_GATE && !hasPaymentAuthorization(rider)) {
    const err = new Error("Payment authorization required before ride request");
    err.statusCode = 402;
    err.details = {
      payment_authorized: !!rider.payment_authorized,
      payment_status: rider.payment_status || null
    };
    throw err;
  }

  return rider;
}

/* =========================================================
   RIDE INPUT PARSER
========================================================= */
function parseRideRequestBody(body = {}) {
  const riderId = cleanEnv(body.rider_id || body.riderId);
  const requestedMode = normalizeRequestedMode(body.requestedMode || body.mode);
  const rideType = normalizeRideType(body.ride_type || body.rideType);

  const pickupAddress = normalizeAddress(
    body.pickup_address ||
      body.pickupAddress ||
      body.origin ||
      body.from_address
  );

  const destinationAddress = normalizeAddress(
    body.destination_address ||
      body.destinationAddress ||
      body.destination ||
      body.to_address
  );

  const notes = normalizeText(
    body.notes || body.specialInstructions || body.special_instructions
  );

  const pickupLat = normalizeCoordinate(body.pickup_lat || body.pickupLat);
  const pickupLng = normalizeCoordinate(body.pickup_lng || body.pickupLng);
  const destinationLat = normalizeCoordinate(
    body.destination_lat || body.destinationLat
  );
  const destinationLng = normalizeCoordinate(
    body.destination_lng || body.destinationLng
  );

  const scheduledFor = cleanEnv(body.scheduled_for || body.scheduledFor);
  const estimatedMiles = Number(body.estimated_miles || body.estimatedMiles || 0);
  const estimatedMinutes = Number(
    body.estimated_minutes || body.estimatedMinutes || 0
  );

  return {
    riderId,
    requestedMode,
    rideType,
    pickupAddress,
    destinationAddress,
    notes,
    pickupLat,
    pickupLng,
    destinationLat,
    destinationLng,
    scheduledFor: scheduledFor || null,
    estimatedMiles: Number.isFinite(estimatedMiles) ? estimatedMiles : 0,
    estimatedMinutes: Number.isFinite(estimatedMinutes) ? estimatedMinutes : 0
  };
}

function validateRideRequestInput(input = {}) {
  if (!input.riderId) {
    const err = new Error("rider_id is required");
    err.statusCode = 400;
    throw err;
  }

  if (!input.pickupAddress) {
    const err = new Error("pickup_address is required");
    err.statusCode = 400;
    throw err;
  }

  if (!input.destinationAddress) {
    const err = new Error("destination_address is required");
    err.statusCode = 400;
    throw err;
  }

  return true;
}

/* =========================================================
   FARE ESTIMATION CORE
========================================================= */
function computeFareEstimate({
  rideType = "standard",
  requestedMode = "driver",
  estimatedMiles = 0,
  estimatedMinutes = 0
}) {
  const typeMultiplier = RIDE_TYPE_MULTIPLIERS[rideType] || 1;
  const modeMultiplier = MODE_MULTIPLIERS[requestedMode] || 1;

  const subtotal =
    DEFAULT_BASE_FARE +
    DEFAULT_BOOKING_FEE +
    estimatedMiles * DEFAULT_PER_MILE +
    estimatedMinutes * DEFAULT_PER_MINUTE;

  const total = Math.max(
    subtotal * typeMultiplier * modeMultiplier,
    DEFAULT_MINIMUM_FARE
  );

  return {
    currency: "USD",
    base_fare: asMoney(DEFAULT_BASE_FARE),
    booking_fee: asMoney(DEFAULT_BOOKING_FEE),
    per_mile_rate: asMoney(DEFAULT_PER_MILE),
    per_minute_rate: asMoney(DEFAULT_PER_MINUTE),
    estimated_miles: asMoney(estimatedMiles),
    estimated_minutes: asMoney(estimatedMinutes),
    ride_type_multiplier: asMoney(typeMultiplier),
    mode_multiplier: asMoney(modeMultiplier),
    estimated_total: asMoney(total),
    minimum_fare: asMoney(DEFAULT_MINIMUM_FARE)
  };
}

/* =========================================================
   RIDE REQUEST ROUTE
========================================================= */
app.post("/api/request-ride", async (req, res) => {
  try {
    requireSupabase();

    const input = parseRideRequestBody(req.body || {});
    validateRideRequestInput(input);

    const rider = await assertRiderEligibleForRideRequest(input.riderId);

    const fareEstimate = computeFareEstimate({
      rideType: input.rideType,
      requestedMode: input.requestedMode,
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
      currency: fareEstimate.currency,
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
      destination_address: input.destinationAddress
    });

    await logAdminEvent("ride_requested", {
      ride_id: ride.id,
      rider_id: rider.id,
      requested_mode: input.requestedMode
    });

    return ok(res, {
      message: "Ride request accepted",
      ride_id: ride.id,
      ride,
      fare_estimate: fareEstimate
    }, 201);
  } catch (error) {
    console.error("❌ /api/request-ride failed:", error);
    return fail(
      res,
      Number(error.statusCode || 500),
      error.message || "Ride request failed",
      error.details ? { details: error.details } : {}
    );
  }
});/* =========================================================
   DRIVER / DISPATCH HELPERS
========================================================= */
function normalizeDriverType(value = "") {
  const type = lower(value);
  if (type === "autonomous" || type === "av" || type === "robotaxi") {
    return "autonomous";
  }
  return "human";
}

function getRequestedDriverTypeFromMode(requestedMode = "driver") {
  return requestedMode === "autonomous" ? "autonomous" : "human";
}

function toDispatchExpiryIso(timeoutSeconds = DISPATCH_TIMEOUT_SECONDS) {
  return new Date(Date.now() + timeoutSeconds * 1000).toISOString();
}

function isDriverAvailableStatus(value = "") {
  const status = lower(value);
  return [
    "",
    "available",
    "online",
    "ready",
    "active"
  ].includes(status);
}

function computeDriverDispatchScore(driver = {}, ride = {}) {
  const distanceMiles = Number(driver.distance_miles || driver.distanceMiles || 9999);
  const rating = Number(driver.rating || 5);
  const acceptanceRate = Number(
    driver.acceptance_rate || driver.acceptanceRate || 1
  );
  const isPriority = normalizeBoolean(driver.is_priority, false) ? 1 : 0;

  const distanceScore = Number.isFinite(distanceMiles)
    ? Math.max(0, 100 - distanceMiles * 8)
    : 0;

  const ratingScore = Number.isFinite(rating) ? rating * 10 : 0;
  const acceptanceScore = Number.isFinite(acceptanceRate)
    ? acceptanceRate * 20
    : 0;
  const priorityScore = isPriority ? 15 : 0;

  return asMoney(distanceScore + ratingScore + acceptanceScore + priorityScore, 0);
}

async function getEligibleDriversForRide(ride = {}) {
  requireSupabase();

  const requestedDriverType = getRequestedDriverTypeFromMode(
    ride.requested_mode || "driver"
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
      last_seen_at,
      vehicle_make,
      vehicle_model,
      vehicle_color,
      vehicle_plate
    `)
    .eq("driver_type", requestedDriverType)
    .order("last_seen_at", { ascending: false });

  if (error) {
    const err = new Error(error.message || "Unable to fetch drivers");
    err.statusCode = 500;
    err.details = error;
    throw err;
  }

  const eligibleDrivers = (data || []).filter((driver) => {
    if (normalizeBoolean(driver.is_blocked, false)) return false;
    if (normalizeBoolean(driver.is_disabled, false)) return false;

    if (!normalizeBoolean(driver.is_online, false)) return false;
    if (!isDriverAvailableStatus(driver.status)) return false;

    if (cleanEnv(driver.current_ride_id)) return false;
    if (cleanEnv(driver.current_mission_id)) return false;

    if (lower(driver.verification_status) !== "approved") return false;

    const approvalStatus = lower(driver.approval_status || driver.status);
    if (
      approvalStatus &&
      !["approved", "active", "available", "online", "ready"].includes(
        approvalStatus
      )
    ) {
      return false;
    }

    return true;
  });

  const rankedDrivers = eligibleDrivers
    .map((driver) => ({
      ...driver,
      dispatch_score: computeDriverDispatchScore(driver, ride)
    }))
    .sort((a, b) => Number(b.dispatch_score || 0) - Number(a.dispatch_score || 0));

  return rankedDrivers;
}

async function createDispatchOffer({
  ride,
  driver,
  attemptNumber = 1
}) {
  requireSupabase();

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
    created_at: nowISO(),
    updated_at: nowISO()
  };

  const dispatch = await safeInsert("dispatches", dispatchPayload);

  await logTripEvent(ride.id, "dispatch_offered", {
    dispatch_id: dispatch.id,
    driver_id: driver.id,
    attempt_number: attemptNumber,
    offer_expires_at: dispatch.offer_expires_at,
    score: dispatch.score
  });

  await logAdminEvent("dispatch_offered", {
    ride_id: ride.id,
    dispatch_id: dispatch.id,
    driver_id: driver.id,
    attempt_number: attemptNumber
  });

  return dispatch;
}

async function markRideAwaitingDriverAcceptance(rideId, driverId, dispatchId, attemptNumber) {
  const ride = await safeUpdateById("rides", rideId, {
    status: "awaiting_driver_acceptance",
    driver_id: driverId,
    dispatch_id: dispatchId,
    dispatch_attempts: attemptNumber,
    updated_at: nowISO()
  });

  await logTripEvent(rideId, "ride_awaiting_driver_acceptance", {
    driver_id: driverId,
    dispatch_id: dispatchId,
    attempt_number: attemptNumber
  });

  return ride;
}

async function markRideNoDriverAvailable(rideId, attempts = 0, reason = "no_eligible_drivers") {
  const ride = await safeUpdateById("rides", rideId, {
    status: "no_driver_available",
    dispatch_attempts: attempts,
    updated_at: nowISO()
  });

  await logTripEvent(rideId, "no_driver_available", {
    attempts,
    reason
  });

  await logAdminEvent("no_driver_available", {
    ride_id: rideId,
    attempts,
    reason
  });

  return ride;
}

async function assignInitialDispatchForRide(ride) {
  const drivers = await getEligibleDriversForRide(ride);

  if (!drivers.length) {
    await markRideNoDriverAvailable(ride.id, 0, "no_eligible_drivers");
    return {
      dispatched: false,
      reason: "no_eligible_drivers",
      ride_status: "no_driver_available"
    };
  }

  const selectedDriver = drivers[0];
  const attemptNumber = Number(ride.dispatch_attempts || 0) + 1;

  const dispatch = await createDispatchOffer({
    ride,
    driver: selectedDriver,
    attemptNumber
  });

  await markRideAwaitingDriverAcceptance(
    ride.id,
    selectedDriver.id,
    dispatch.id,
    attemptNumber
  );

  return {
    dispatched: true,
    reason: null,
    selected_driver: {
      id: selectedDriver.id,
      first_name: selectedDriver.first_name || null,
      last_name: selectedDriver.last_name || null,
      driver_type: selectedDriver.driver_type || null,
      rating: selectedDriver.rating || null,
      vehicle_make: selectedDriver.vehicle_make || null,
      vehicle_model: selectedDriver.vehicle_model || null,
      vehicle_color: selectedDriver.vehicle_color || null,
      vehicle_plate: selectedDriver.vehicle_plate || null
    },
    dispatch
  };
}

/* =========================================================
   DISPATCH STATUS HELPERS
========================================================= */
async function getDispatchById(dispatchId) {
  requireSupabase();

  const { data, error } = await supabase
    .from("dispatches")
    .select("*")
    .eq("id", dispatchId)
    .single();

  if (error || !data) {
    const err = new Error("Dispatch not found");
    err.statusCode = 404;
    err.details = error || null;
    throw err;
  }

  return data;
}

async function getRideById(rideId) {
  requireSupabase();

  const { data, error } = await supabase
    .from("rides")
    .select("*")
    .eq("id", rideId)
    .single();

  if (error || !data) {
    const err = new Error("Ride not found");
    err.statusCode = 404;
    err.details = error || null;
    throw err;
  }

  return data;
}

async function expireDispatch(dispatchId, reason = "timeout") {
  const dispatch = await getDispatchById(dispatchId);

  if (lower(dispatch.status) !== "offered") {
    return dispatch;
  }

  const updatedDispatch = await safeUpdateById("dispatches", dispatchId, {
    status: "expired",
    expired_at: nowISO(),
    updated_at: nowISO()
  });

  await logTripEvent(dispatch.ride_id, "dispatch_expired", {
    dispatch_id: dispatchId,
    driver_id: dispatch.driver_id,
    reason
  });

  await logAdminEvent("dispatch_expired", {
    ride_id: dispatch.ride_id,
    dispatch_id: dispatchId,
    driver_id: dispatch.driver_id,
    reason
  });

  return updatedDispatch;
}

async function rejectDispatch(dispatchId, reason = "driver_rejected") {
  const dispatch = await getDispatchById(dispatchId);

  const updatedDispatch = await safeUpdateById("dispatches", dispatchId, {
    status: "rejected",
    rejected_at: nowISO(),
    responded_at: nowISO(),
    updated_at: nowISO()
  });

  await logTripEvent(dispatch.ride_id, "dispatch_rejected", {
    dispatch_id: dispatchId,
    driver_id: dispatch.driver_id,
    reason
  });

  await logAdminEvent("dispatch_rejected", {
    ride_id: dispatch.ride_id,
    dispatch_id: dispatchId,
    driver_id: dispatch.driver_id,
    reason
  });

  return updatedDispatch;
}

async function acceptDispatch(dispatchId) {
  const dispatch = await getDispatchById(dispatchId);

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

  await safeUpdateById("drivers", dispatch.driver_id, {
    status: "assigned",
    current_ride_id: dispatch.ride_id,
    updated_at: nowISO()
  });

  await logTripEvent(dispatch.ride_id, "dispatch_accepted", {
    dispatch_id: dispatch.id,
    driver_id: dispatch.driver_id
  });

  await logAdminEvent("dispatch_accepted", {
    ride_id: dispatch.ride_id,
    dispatch_id: dispatch.id,
    driver_id: dispatch.driver_id
  });

  return updatedDispatch;
}

/* =========================================================
   AUTO REDISPATCH SCAFFOLD
========================================================= */
async function redispatchRideIfEligible(rideId) {
  if (!ENABLE_AUTO_REDISPATCH) {
    return {
      redispatched: false,
      reason: "auto_redispatch_disabled"
    };
  }

  const ride = await getRideById(rideId);
  const attempts = Number(ride.dispatch_attempts || 0);

  if (attempts >= MAX_DISPATCH_ATTEMPTS) {
    await markRideNoDriverAvailable(ride.id, attempts, "max_dispatch_attempts_reached");
    return {
      redispatched: false,
      reason: "max_dispatch_attempts_reached"
    };
  }

  const offeredDispatchesResult = await supabase
    .from("dispatches")
    .select("driver_id")
    .eq("ride_id", ride.id);

  const attemptedDriverIds = new Set(
    (offeredDispatchesResult.data || []).map((row) => cleanEnv(row.driver_id)).filter(Boolean)
  );

  const allCandidates = await getEligibleDriversForRide(ride);
  const remainingCandidates = allCandidates.filter(
    (driver) => !attemptedDriverIds.has(cleanEnv(driver.id))
  );

  if (!remainingCandidates.length) {
    await markRideNoDriverAvailable(ride.id, attempts, "all_candidates_exhausted");
    return {
      redispatched: false,
      reason: "all_candidates_exhausted"
    };
  }

  const nextDriver = remainingCandidates[0];
  const nextAttempt = attempts + 1;

  const dispatch = await createDispatchOffer({
    ride,
    driver: nextDriver,
    attemptNumber: nextAttempt
  });

  await markRideAwaitingDriverAcceptance(
    ride.id,
    nextDriver.id,
    dispatch.id,
    nextAttempt
  );

  return {
    redispatched: true,
    dispatch,
    driver_id: nextDriver.id,
    attempt_number: nextAttempt
  };
}

/* =========================================================
   DISPATCH ROUTES
========================================================= */
app.post("/api/rides/:rideId/dispatch", async (req, res) => {
  try {
    requireSupabase();

    const rideId = cleanEnv(req.params.rideId);
    if (!rideId) {
      return fail(res, 400, "rideId is required");
    }

    const ride = await getRideById(rideId);
    const result = await assignInitialDispatchForRide(ride);

    return ok(res, {
      message: result.dispatched
        ? "Dispatch created"
        : "No eligible drivers available",
      ...result
    });
  } catch (error) {
    console.error("❌ /api/rides/:rideId/dispatch failed:", error);
    return fail(
      res,
      Number(error.statusCode || 500),
      error.message || "Dispatch failed",
      error.details ? { details: error.details } : {}
    );
  }
});

app.post("/api/dispatches/:dispatchId/accept", async (req, res) => {
  try {
    const dispatchId = cleanEnv(req.params.dispatchId);
    if (!dispatchId) {
      return fail(res, 400, "dispatchId is required");
    }

    const dispatch = await acceptDispatch(dispatchId);

    return ok(res, {
      message: "Dispatch accepted",
      dispatch
    });
  } catch (error) {
    console.error("❌ /api/dispatches/:dispatchId/accept failed:", error);
    return fail(
      res,
      Number(error.statusCode || 500),
      error.message || "Dispatch accept failed",
      error.details ? { details: error.details } : {}
    );
  }
});

app.post("/api/dispatches/:dispatchId/reject", async (req, res) => {
  try {
    const dispatchId = cleanEnv(req.params.dispatchId);
    const reason = cleanEnv(req.body?.reason || "driver_rejected");

    if (!dispatchId) {
      return fail(res, 400, "dispatchId is required");
    }

    const dispatch = await rejectDispatch(dispatchId, reason);
    const redispatchResult = await redispatchRideIfEligible(dispatch.ride_id);

    return ok(res, {
      message: "Dispatch rejected",
      dispatch,
      redispatch: redispatchResult
    });
  } catch (error) {
    console.error("❌ /api/dispatches/:dispatchId/reject failed:", error);
    return fail(
      res,
      Number(error.statusCode || 500),
      error.message || "Dispatch reject failed",
      error.details ? { details: error.details } : {}
    );
  }
});

app.post("/api/dispatches/:dispatchId/expire", async (req, res) => {
  try {
    const dispatchId = cleanEnv(req.params.dispatchId);
    const reason = cleanEnv(req.body?.reason || "timeout");

    if (!dispatchId) {
      return fail(res, 400, "dispatchId is required");
    }

    const dispatch = await expireDispatch(dispatchId, reason);
    const redispatchResult = await redispatchRideIfEligible(dispatch.ride_id);

    return ok(res, {
      message: "Dispatch expired",
      dispatch,
      redispatch: redispatchResult
    });
  } catch (error) {
    console.error("❌ /api/dispatches/:dispatchId/expire failed:", error);
    return fail(
      res,
      Number(error.statusCode || 500),
      error.message || "Dispatch expire failed",
      error.details ? { details: error.details } : {}
    );
  }
});/* =========================================================
   RIDE / DRIVER LOOKUP HELPERS
========================================================= */
async function getDriverById(driverId) {
  requireSupabase();

  const { data, error } = await supabase
    .from("drivers")
    .select("*")
    .eq("id", driverId)
    .single();

  if (error || !data) {
    const err = new Error("Driver not found");
    err.statusCode = 404;
    err.details = error || null;
    throw err;
  }

  return data;
}

function canDriverOperateRide(driver = {}, ride = {}) {
  if (!driver || !ride) return false;
  if (cleanEnv(driver.current_ride_id) && cleanEnv(driver.current_ride_id) !== cleanEnv(ride.id)) {
    return false;
  }
  if (lower(driver.verification_status) !== "approved") return false;

  const driverType = normalizeDriverType(driver.driver_type);
  const requestedType = getRequestedDriverTypeFromMode(ride.requested_mode || "driver");

  return driverType === requestedType;
}

function buildStatusTimestampPatch(status) {
  const ts = nowISO();

  switch (lower(status)) {
    case "driver_en_route":
      return { driver_en_route_at: ts };
    case "arrived":
      return { arrived_at: ts };
    case "in_progress":
      return { started_at: ts };
    case "completed":
      return { completed_at: ts };
    case "cancelled":
      return { cancelled_at: ts };
    default:
      return {};
  }
}

async function updateRideStatus(rideId, status, extra = {}) {
  const payload = {
    status,
    updated_at: nowISO(),
    ...buildStatusTimestampPatch(status),
    ...extra
  };

  const ride = await safeUpdateById("rides", rideId, payload);

  await logTripEvent(rideId, "ride_status_updated", {
    status,
    extra
  });

  return ride;
}

async function updateDriverStatus(driverId, status, extra = {}) {
  const driver = await safeUpdateById("drivers", driverId, {
    status,
    updated_at: nowISO(),
    ...extra
  });

  return driver;
}

/* =========================================================
   EARNINGS / PAYOUT HELPERS
========================================================= */
function computeDriverPayout(ride = {}) {
  const fare = Number(ride.final_total || ride.estimated_total || 0);
  const requestedMode = lower(ride.requested_mode || "driver");

  if (requestedMode === "autonomous") {
    return {
      payout_rate: 0,
      payout_amount: 0,
      platform_amount: asMoney(fare)
    };
  }

  const payoutRate = toNumber(process.env.DRIVER_PAYOUT_RATE, 0.75);
  const payoutAmount = asMoney(fare * payoutRate);
  const platformAmount = asMoney(fare - payoutAmount);

  return {
    payout_rate: payoutRate,
    payout_amount: payoutAmount,
    platform_amount: platformAmount
  };
}

async function createDriverEarningsLedgerEntry(ride = {}) {
  if (!supabase || !ride?.driver_id) return null;

  const payout = computeDriverPayout(ride);

  const entry = {
    id: generateId("earning"),
    driver_id: ride.driver_id,
    ride_id: ride.id,
    gross_amount: asMoney(ride.final_total || ride.estimated_total || 0),
    payout_rate: payout.payout_rate,
    payout_amount: payout.payout_amount,
    platform_amount: payout.platform_amount,
    currency: ride.currency || "USD",
    status: "pending",
    created_at: nowISO(),
    updated_at: nowISO()
  };

  try {
    return await safeInsert("driver_earnings", entry);
  } catch (error) {
    try {
      return await safeInsert("driver_payouts", {
        ...entry,
        amount: entry.payout_amount
      });
    } catch (fallbackError) {
      console.warn("⚠️ driver earnings ledger insert failed:", fallbackError.message);
      return null;
    }
  }
}

async function markDriverLedgerPaid(driverId, rideId) {
  if (!supabase || !driverId || !rideId) return null;

  try {
    const { error } = await supabase
      .from("driver_earnings")
      .update({
        status: "paid",
        paid_at: nowISO(),
        updated_at: nowISO()
      })
      .eq("driver_id", driverId)
      .eq("ride_id", rideId);

    if (error) throw error;
    return true;
  } catch (error) {
    try {
      const { error: fallbackError } = await supabase
        .from("driver_payouts")
        .update({
          status: "paid",
          paid_at: nowISO(),
          updated_at: nowISO()
        })
        .eq("driver_id", driverId)
        .eq("ride_id", rideId);

      if (fallbackError) throw fallbackError;
      return true;
    } catch (finalError) {
      console.warn("⚠️ markDriverLedgerPaid failed:", finalError.message);
      return null;
    }
  }
}

/* =========================================================
   TIP HELPERS
========================================================= */
async function createTipRecord({
  rideId,
  riderId,
  driverId,
  amount,
  source = "post_trip"
}) {
  if (!supabase || !rideId || !riderId || !driverId) return null;

  const safeAmount = asMoney(amount, 0);
  if (safeAmount <= 0) return null;

  const payload = {
    id: generateId("tip"),
    ride_id: rideId,
    rider_id: riderId,
    driver_id: driverId,
    amount: safeAmount,
    currency: "USD",
    source,
    status: "recorded",
    created_at: nowISO(),
    updated_at: nowISO()
  };

  try {
    return await safeInsert("tips", payload);
  } catch (error) {
    console.warn("⚠️ tip record insert failed:", error.message);
    return null;
  }
}

/* =========================================================
   RIDE READ ENDPOINTS
========================================================= */
app.get("/api/rides/:rideId", async (req, res) => {
  try {
    const rideId = cleanEnv(req.params.rideId);
    if (!rideId) return fail(res, 400, "rideId is required");

    const ride = await getRideById(rideId);

    return ok(res, { ride });
  } catch (error) {
    console.error("❌ /api/rides/:rideId failed:", error);
    return fail(
      res,
      Number(error.statusCode || 500),
      error.message || "Unable to fetch ride",
      error.details ? { details: error.details } : {}
    );
  }
});

app.get("/api/riders/:riderId/rides", async (req, res) => {
  try {
    requireSupabase();

    const riderId = cleanEnv(req.params.riderId);
    if (!riderId) return fail(res, 400, "riderId is required");

    const { data, error } = await supabase
      .from("rides")
      .select("*")
      .eq("rider_id", riderId)
      .order("created_at", { ascending: false });

    if (error) {
      const err = new Error(error.message || "Unable to fetch rider rides");
      err.statusCode = 500;
      throw err;
    }

    return ok(res, {
      rider_id: riderId,
      count: (data || []).length,
      rides: data || []
    });
  } catch (error) {
    console.error("❌ /api/riders/:riderId/rides failed:", error);
    return fail(
      res,
      Number(error.statusCode || 500),
      error.message || "Unable to fetch rider rides"
    );
  }
});

app.get("/api/drivers/:driverId/current-ride", async (req, res) => {
  try {
    const driverId = cleanEnv(req.params.driverId);
    if (!driverId) return fail(res, 400, "driverId is required");

    const driver = await getDriverById(driverId);

    if (!cleanEnv(driver.current_ride_id)) {
      return ok(res, {
        driver_id: driverId,
        has_current_ride: false,
        ride: null
      });
    }

    const ride = await getRideById(driver.current_ride_id);

    return ok(res, {
      driver_id: driverId,
      has_current_ride: true,
      ride
    });
  } catch (error) {
    console.error("❌ /api/drivers/:driverId/current-ride failed:", error);
    return fail(
      res,
      Number(error.statusCode || 500),
      error.message || "Unable to fetch driver current ride"
    );
  }
});

/* =========================================================
   RIDE LIFECYCLE ROUTES
========================================================= */
app.post("/api/rides/:rideId/driver-en-route", async (req, res) => {
  try {
    const rideId = cleanEnv(req.params.rideId);
    const driverId = cleanEnv(req.body?.driver_id || req.body?.driverId);

    if (!rideId) return fail(res, 400, "rideId is required");
    if (!driverId) return fail(res, 400, "driver_id is required");

    const ride = await getRideById(rideId);
    const driver = await getDriverById(driverId);

    if (!canDriverOperateRide(driver, ride)) {
      return fail(res, 403, "Driver is not eligible to operate this ride");
    }

    const updatedRide = await updateRideStatus(rideId, "driver_en_route", {
      driver_id: driverId
    });

    await updateDriverStatus(driverId, "en_route", {
      current_ride_id: rideId
    });

    await logTripEvent(rideId, "driver_en_route", {
      driver_id: driverId
    });

    return ok(res, {
      message: "Driver marked en route",
      ride: updatedRide
    });
  } catch (error) {
    console.error("❌ /api/rides/:rideId/driver-en-route failed:", error);
    return fail(
      res,
      Number(error.statusCode || 500),
      error.message || "Unable to mark driver en route"
    );
  }
});

app.post("/api/rides/:rideId/arrive", async (req, res) => {
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
      current_ride_id: rideId
    });

    await logTripEvent(rideId, "driver_arrived", {
      driver_id: driverId
    });

    return ok(res, {
      message: "Driver marked arrived",
      ride: updatedRide
    });
  } catch (error) {
    console.error("❌ /api/rides/:rideId/arrive failed:", error);
    return fail(
      res,
      Number(error.statusCode || 500),
      error.message || "Unable to mark arrival"
    );
  }
});

app.post("/api/rides/:rideId/start", async (req, res) => {
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

    const updatedRide = await updateRideStatus(rideId, "in_progress", {
      driver_id: driverId
    });

    await updateDriverStatus(driverId, "in_progress", {
      current_ride_id: rideId
    });

    await logTripEvent(rideId, "trip_started", {
      driver_id: driverId
    });

    return ok(res, {
      message: "Trip started",
      ride: updatedRide
    });
  } catch (error) {
    console.error("❌ /api/rides/:rideId/start failed:", error);
    return fail(
      res,
      Number(error.statusCode || 500),
      error.message || "Unable to start trip"
    );
  }
});

app.post("/api/rides/:rideId/complete", async (req, res) => {
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

    const resolvedFinalTotal = asMoney(
      finalTotal > 0 ? finalTotal : Number(ride.estimated_total || 0),
      0
    );

    const updatedRide = await updateRideStatus(rideId, "completed", {
      driver_id: driverId,
      final_total: resolvedFinalTotal
    });

    await updateDriverStatus(driverId, "available", {
      current_ride_id: null,
      current_mission_id: null
    });

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

    await logAdminEvent("trip_completed", {
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
    console.error("❌ /api/rides/:rideId/complete failed:", error);
    return fail(
      res,
      Number(error.statusCode || 500),
      error.message || "Unable to complete trip"
    );
  }
});

app.post("/api/rides/:rideId/cancel", async (req, res) => {
  try {
    const rideId = cleanEnv(req.params.rideId);
    const cancelledBy = cleanEnv(req.body?.cancelled_by || req.body?.cancelledBy || "unknown");
    const reason = cleanEnv(req.body?.reason || "cancelled");

    if (!rideId) return fail(res, 400, "rideId is required");

    const ride = await getRideById(rideId);

    const updatedRide = await updateRideStatus(rideId, "cancelled", {
      cancelled_by: cancelledBy,
      cancellation_reason: reason
    });

    if (cleanEnv(ride.driver_id)) {
      await updateDriverStatus(ride.driver_id, "available", {
        current_ride_id: null,
        current_mission_id: null
      });
    }

    await logTripEvent(rideId, "trip_cancelled", {
      cancelled_by: cancelledBy,
      reason
    });

    await logAdminEvent("trip_cancelled", {
      ride_id: rideId,
      cancelled_by: cancelledBy,
      reason
    });

    return ok(res, {
      message: "Trip cancelled",
      ride: updatedRide
    });
  } catch (error) {
    console.error("❌ /api/rides/:rideId/cancel failed:", error);
    return fail(
      res,
      Number(error.statusCode || 500),
      error.message || "Unable to cancel trip"
    );
  }
});

/* =========================================================
   TIP ROUTES
========================================================= */
app.post("/api/rides/:rideId/tip", async (req, res) => {
  try {
    const rideId = cleanEnv(req.params.rideId);
    const amount = Number(req.body?.amount || 0);

    if (!rideId) return fail(res, 400, "rideId is required");
    if (!(amount > 0)) return fail(res, 400, "Valid tip amount is required");

    const ride = await getRideById(rideId);

    if (!ride.rider_id || !ride.driver_id) {
      return fail(res, 400, "Ride must have rider and driver before tipping");
    }

    const tip = await createTipRecord({
      rideId,
      riderId: ride.rider_id,
      driverId: ride.driver_id,
      amount,
      source: "in_trip_or_post_trip"
    });

    await logTripEvent(rideId, "tip_recorded", {
      amount: asMoney(amount),
      driver_id: ride.driver_id,
      rider_id: ride.rider_id
    });

    return ok(res, {
      message: "Tip recorded",
      tip
    }, 201);
  } catch (error) {
    console.error("❌ /api/rides/:rideId/tip failed:", error);
    return fail(
      res,
      Number(error.statusCode || 500),
      error.message || "Unable to record tip"
    );
  }
});

/* =========================================================
   DRIVER EARNINGS ROUTES
========================================================= */
app.get("/api/drivers/:driverId/earnings", async (req, res) => {
  try {
    requireSupabase();

    const driverId = cleanEnv(req.params.driverId);
    if (!driverId) return fail(res, 400, "driverId is required");

    let data = null;
    let error = null;

    const primaryResult = await supabase
      .from("driver_earnings")
      .select("*")
      .eq("driver_id", driverId)
      .order("created_at", { ascending: false });

    data = primaryResult.data;
    error = primaryResult.error;

    if (error) {
      const fallbackResult = await supabase
        .from("driver_payouts")
        .select("*")
        .eq("driver_id", driverId)
        .order("created_at", { ascending: false });

      data = fallbackResult.data;
      error = fallbackResult.error;
    }

    if (error) {
      const err = new Error(error.message || "Unable to fetch driver earnings");
      err.statusCode = 500;
      throw err;
    }

    const earnings = data || [];
    const total = earnings.reduce((sum, row) => {
      const amount = Number(row.payout_amount || row.amount || 0);
      return sum + (Number.isFinite(amount) ? amount : 0);
    }, 0);

    return ok(res, {
      driver_id: driverId,
      count: earnings.length,
      total_earnings: asMoney(total),
      earnings
    });
  } catch (error) {
    console.error("❌ /api/drivers/:driverId/earnings failed:", error);
    return fail(
      res,
      Number(error.statusCode || 500),
      error.message || "Unable to fetch driver earnings"
    );
  }
});

app.post("/api/drivers/:driverId/payouts/mark-paid", async (req, res) => {
  try {
    const driverId = cleanEnv(req.params.driverId);
    const rideId = cleanEnv(req.body?.ride_id || req.body?.rideId);

    if (!driverId) return fail(res, 400, "driverId is required");
    if (!rideId) return fail(res, 400, "ride_id is required");

    const updated = await markDriverLedgerPaid(driverId, rideId);

    return ok(res, {
      message: "Driver payout marked paid",
      updated: !!updated,
      driver_id: driverId,
      ride_id: rideId
    });
  } catch (error) {
    console.error("❌ /api/drivers/:driverId/payouts/mark-paid failed:", error);
    return fail(
      res,
      Number(error.statusCode || 500),
      error.message || "Unable to mark payout as paid"
    );
  }
});/* =========================================================
   ADMIN QUERY HELPERS
========================================================= */
function parsePagination(req) {
  const limit = Math.min(Math.max(toNumber(req.query?.limit, 25), 1), 200);
  const offset = Math.max(toNumber(req.query?.offset, 0), 0);
  return { limit, offset };
}

async function getRideTimelineEntries(rideId) {
  requireSupabase();

  try {
    const primary = await supabase
      .from("trip_events")
      .select("*")
      .eq("ride_id", rideId)
      .order("created_at", { ascending: true });

    if (!primary.error) {
      return primary.data || [];
    }
  } catch (error) {
    console.warn("⚠️ trip_events read failed:", error.message);
  }

  try {
    const fallback = await supabase
      .from("trip_timelines")
      .select("*")
      .eq("ride_id", rideId)
      .order("created_at", { ascending: true });

    if (!fallback.error) {
      return fallback.data || [];
    }
  } catch (error) {
    console.warn("⚠️ trip_timelines read failed:", error.message);
  }

  return [];
}

async function getTableCount(tableName) {
  if (!supabase) return null;

  try {
    const { count, error } = await supabase
      .from(tableName)
      .select("*", { count: "exact", head: true });

    if (error) return null;
    return count;
  } catch (error) {
    return null;
  }
}

async function safeSelectWithPagination(tableName, queryBuilderCallback, options = {}) {
  requireSupabase();

  const { limit = 25, offset = 0 } = options;

  let query = supabase.from(tableName).select("*");

  if (typeof queryBuilderCallback === "function") {
    query = queryBuilderCallback(query);
  }

  const { data, error } = await query.range(offset, offset + limit - 1);

  if (error) {
    const err = new Error(error.message || `Unable to query ${tableName}`);
    err.statusCode = 500;
    err.details = error;
    throw err;
  }

  return data || [];
}

/* =========================================================
   ADMIN HEALTH + PROVIDERS
========================================================= */
app.get("/api/admin/health", async (req, res) => {
  try {
    assertAdmin(req);

    const providers = getProviderReadiness();

    let database = {
      connected: !!supabase,
      check: "not_run"
    };

    if (supabase) {
      try {
        const result = await supabase.from("riders").select("id").limit(1);
        database.check = result.error ? "query_failed" : "ok";
        if (result.error) {
          database.error = result.error.message;
        }
      } catch (dbError) {
        database.check = "exception";
        database.error = dbError.message;
      }
    }

    const counts = {
      riders: await getTableCount("riders"),
      drivers: await getTableCount("drivers"),
      rides: await getTableCount("rides"),
      dispatches: await getTableCount("dispatches"),
      payments: await getTableCount("payments"),
      admin_logs: await getTableCount("admin_logs")
    };

    return ok(res, {
      service: APP_NAME,
      started_at: SERVER_STARTED_AT,
      environment: NODE_ENV,
      uptime: process.uptime(),
      timestamp: nowISO(),
      database,
      providers,
      features: {
        ai: ENABLE_AI,
        rider_verification_gate: ENABLE_RIDER_VERIFICATION_GATE,
        payment_gate: ENABLE_PAYMENT_GATE,
        auto_redispatch: ENABLE_AUTO_REDISPATCH,
        trip_timeline: ENABLE_TRIP_TIMELINE
      },
      counts,
      dispatch: {
        timeout_seconds: DISPATCH_TIMEOUT_SECONDS,
        max_attempts: MAX_DISPATCH_ATTEMPTS
      }
    });
  } catch (error) {
    console.error("❌ /api/admin/health failed:", error);
    return fail(
      res,
      Number(error.statusCode || 500),
      error.message || "Unable to fetch admin health"
    );
  }
});

app.get("/api/admin/providers/status", async (req, res) => {
  try {
    assertAdmin(req);

    return ok(res, {
      providers: getProviderReadiness(),
      raw_status: {
        supabase_url_present: !!SUPABASE_URL,
        supabase_service_role_present: !!SUPABASE_SERVICE_ROLE_KEY,
        persona_api_present: !!PERSONA_API_KEY,
        persona_rider_template_present: !!PERSONA_TEMPLATE_ID_RIDER,
        persona_driver_template_present: !!PERSONA_TEMPLATE_ID_DRIVER,
        twilio_sid_present: !!TWILIO_ACCOUNT_SID,
        twilio_token_present: !!TWILIO_AUTH_TOKEN,
        twilio_from_present: !!TWILIO_FROM_NUMBER,
        smtp_host_present: !!SMTP_HOST,
        smtp_port_present: !!SMTP_PORT,
        smtp_user_present: !!SMTP_USER,
        smtp_pass_present: !!SMTP_PASS,
        smtp_from_present: !!SMTP_FROM,
        openai_key_present: !!OPENAI_API_KEY,
        google_maps_present: !!GOOGLE_MAPS_API_KEY
      }
    });
  } catch (error) {
    console.error("❌ /api/admin/providers/status failed:", error);
    return fail(
      res,
      Number(error.statusCode || 500),
      error.message || "Unable to fetch provider status"
    );
  }
});

/* =========================================================
   ADMIN DISPATCH VISIBILITY
========================================================= */
app.get("/api/admin/dispatches", async (req, res) => {
  try {
    assertAdmin(req);
    requireSupabase();

    const { limit, offset } = parsePagination(req);
    const statusFilter = cleanEnv(req.query?.status);
    const rideId = cleanEnv(req.query?.ride_id || req.query?.rideId);
    const driverId = cleanEnv(req.query?.driver_id || req.query?.driverId);

    let query = supabase
      .from("dispatches")
      .select("*")
      .order("created_at", { ascending: false });

    if (statusFilter) query = query.eq("status", statusFilter);
    if (rideId) query = query.eq("ride_id", rideId);
    if (driverId) query = query.eq("driver_id", driverId);

    const { data, error } = await query.range(offset, offset + limit - 1);

    if (error) {
      const err = new Error(error.message || "Unable to fetch dispatches");
      err.statusCode = 500;
      throw err;
    }

    return ok(res, {
      count: (data || []).length,
      limit,
      offset,
      dispatches: data || []
    });
  } catch (error) {
    console.error("❌ /api/admin/dispatches failed:", error);
    return fail(
      res,
      Number(error.statusCode || 500),
      error.message || "Unable to fetch admin dispatches"
    );
  }
});

app.get("/api/admin/rides/:rideId/timeline", async (req, res) => {
  try {
    assertAdmin(req);

    const rideId = cleanEnv(req.params.rideId);
    if (!rideId) return fail(res, 400, "rideId is required");

    const ride = await getRideById(rideId);
    const timeline = await getRideTimelineEntries(rideId);

    return ok(res, {
      ride_id: rideId,
      ride,
      count: timeline.length,
      timeline
    });
  } catch (error) {
    console.error("❌ /api/admin/rides/:rideId/timeline failed:", error);
    return fail(
      res,
      Number(error.statusCode || 500),
      error.message || "Unable to fetch ride timeline"
    );
  }
});

/* =========================================================
   ADMIN VERIFICATION VISIBILITY
========================================================= */
app.get("/api/admin/verification/riders", async (req, res) => {
  try {
    assertAdmin(req);
    requireSupabase();

    const { limit, offset } = parsePagination(req);
    const verificationStatus = cleanEnv(
      req.query?.verification_status || req.query?.verificationStatus
    );
    const riderStatus = cleanEnv(req.query?.status);

    let query = supabase
      .from("riders")
      .select(`
        id,
        email,
        phone,
        first_name,
        last_name,
        status,
        verification_status,
        payment_authorized,
        payment_status,
        is_blocked,
        is_disabled,
        created_at
      `)
      .order("created_at", { ascending: false });

    if (verificationStatus) query = query.eq("verification_status", verificationStatus);
    if (riderStatus) query = query.eq("status", riderStatus);

    const { data, error } = await query.range(offset, offset + limit - 1);

    if (error) {
      const err = new Error(error.message || "Unable to fetch rider verifications");
      err.statusCode = 500;
      throw err;
    }

    const riders = data || [];
    const summary = riders.reduce(
      (acc, rider) => {
        const key = lower(rider.verification_status || "unknown");
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      },
      {}
    );

    return ok(res, {
      limit,
      offset,
      count: riders.length,
      summary,
      riders
    });
  } catch (error) {
    console.error("❌ /api/admin/verification/riders failed:", error);
    return fail(
      res,
      Number(error.statusCode || 500),
      error.message || "Unable to fetch rider verification list"
    );
  }
});

app.get("/api/admin/verification/drivers", async (req, res) => {
  try {
    assertAdmin(req);
    requireSupabase();

    const { limit, offset } = parsePagination(req);
    const verificationStatus = cleanEnv(
      req.query?.verification_status || req.query?.verificationStatus
    );
    const approvalStatus = cleanEnv(
      req.query?.approval_status || req.query?.approvalStatus
    );
    const driverType = cleanEnv(req.query?.driver_type || req.query?.driverType);

    let query = supabase
      .from("drivers")
      .select(`
        id,
        email,
        phone,
        first_name,
        last_name,
        driver_type,
        status,
        verification_status,
        approval_status,
        is_online,
        is_blocked,
        is_disabled,
        created_at
      `)
      .order("created_at", { ascending: false });

    if (verificationStatus) query = query.eq("verification_status", verificationStatus);
    if (approvalStatus) query = query.eq("approval_status", approvalStatus);
    if (driverType) query = query.eq("driver_type", driverType);

    const { data, error } = await query.range(offset, offset + limit - 1);

    if (error) {
      const err = new Error(error.message || "Unable to fetch driver verifications");
      err.statusCode = 500;
      throw err;
    }

    const drivers = data || [];
    const summary = drivers.reduce(
      (acc, driver) => {
        const verifyKey = `verification_${lower(driver.verification_status || "unknown")}`;
        const approveKey = `approval_${lower(driver.approval_status || "unknown")}`;
        acc[verifyKey] = (acc[verifyKey] || 0) + 1;
        acc[approveKey] = (acc[approveKey] || 0) + 1;
        return acc;
      },
      {}
    );

    return ok(res, {
      limit,
      offset,
      count: drivers.length,
      summary,
      drivers
    });
  } catch (error) {
    console.error("❌ /api/admin/verification/drivers failed:", error);
    return fail(
      res,
      Number(error.statusCode || 500),
      error.message || "Unable to fetch driver verification list"
    );
  }
});

/* =========================================================
   ADMIN LOGS / OPERATIONAL VIEWS
========================================================= */
app.get("/api/admin/logs", async (req, res) => {
  try {
    assertAdmin(req);
    requireSupabase();

    const { limit, offset } = parsePagination(req);
    const action = cleanEnv(req.query?.action);

    let query = supabase
      .from("admin_logs")
      .select("*")
      .order("created_at", { ascending: false });

    if (action) query = query.eq("action", action);

    const { data, error } = await query.range(offset, offset + limit - 1);

    if (error) {
      const err = new Error(error.message || "Unable to fetch admin logs");
      err.statusCode = 500;
      throw err;
    }

    return ok(res, {
      count: (data || []).length,
      limit,
      offset,
      logs: data || []
    });
  } catch (error) {
    console.error("❌ /api/admin/logs failed:", error);
    return fail(
      res,
      Number(error.statusCode || 500),
      error.message || "Unable to fetch admin logs"
    );
  }
});

app.get("/api/admin/rides", async (req, res) => {
  try {
    assertAdmin(req);
    requireSupabase();

    const { limit, offset } = parsePagination(req);
    const status = cleanEnv(req.query?.status);
    const riderId = cleanEnv(req.query?.rider_id || req.query?.riderId);
    const driverId = cleanEnv(req.query?.driver_id || req.query?.driverId);

    let query = supabase
      .from("rides")
      .select("*")
      .order("created_at", { ascending: false });

    if (status) query = query.eq("status", status);
    if (riderId) query = query.eq("rider_id", riderId);
    if (driverId) query = query.eq("driver_id", driverId);

    const { data, error } = await query.range(offset, offset + limit - 1);

    if (error) {
      const err = new Error(error.message || "Unable to fetch rides");
      err.statusCode = 500;
      throw err;
    }

    return ok(res, {
      count: (data || []).length,
      limit,
      offset,
      rides: data || []
    });
  } catch (error) {
    console.error("❌ /api/admin/rides failed:", error);
    return fail(
      res,
      Number(error.statusCode || 500),
      error.message || "Unable to fetch admin rides"
    );
  }
});/* =========================================================
   AI / SUPPORT HELPERS
========================================================= */
function getSupportContextByPage(page = "") {
  const normalized = lower(page);

  if (normalized.includes("driver")) {
    return {
      mode: "driver",
      system_prompt: `
You are Harvey Taxi driver support.
Help drivers with onboarding, verification, approval, mission acceptance, trip flow, payouts, and safety.
Be concise, practical, and brand-aligned.
Do not invent unavailable features.
If unsure, direct the user to support@harveytaxiservice.com.
      `.trim()
    };
  }

  if (normalized.includes("rider")) {
    return {
      mode: "rider",
      system_prompt: `
You are Harvey Taxi rider support.
Help riders with account approval, verification, payment authorization, ride requests, trip status, cancellations, and support.
Be concise, practical, and brand-aligned.
Do not invent unavailable features.
If unsure, direct the user to support@harveytaxiservice.com.
      `.trim()
    };
  }

  if (normalized.includes("request")) {
    return {
      mode: "request",
      system_prompt: `
You are Harvey Taxi ride-request support.
Help users understand ride request steps, approval requirements, payment authorization, driver vs autonomous request modes, and what happens next.
Be concise, practical, and brand-aligned.
Do not invent unavailable features.
If unsure, direct the user to support@harveytaxiservice.com.
      `.trim()
    };
  }

  return {
    mode: "general",
    system_prompt: `
You are Harvey Taxi support.
Help with general platform questions about Harvey Taxi Service and Harvey Assistance Foundation.
Explain the platform clearly and safely.
Do not claim emergency service capability. If emergency help is requested, tell the user to call 911.
Do not invent unavailable features.
If unsure, direct the user to support@harveytaxiservice.com.
    `.trim()
  };
}

function buildFallbackSupportAnswer({ message = "", page = "" }) {
  const question = lower(message);
  const context = getSupportContextByPage(page);

  if (
    question.includes("emergency") ||
    question.includes("911") ||
    question.includes("ambulance")
  ) {
    return {
      mode: context.mode,
      answer:
        "Harvey Taxi is not an emergency service. If you are in immediate danger or need urgent medical help, call 911 right away."
    };
  }

  if (
    question.includes("rider verification") ||
    question.includes("passport") ||
    question.includes("id verification") ||
    question.includes("approved")
  ) {
    return {
      mode: context.mode,
      answer:
        "Riders must complete verification and receive approval before requesting a ride. If your verification is still pending, manual review may still be in progress."
    };
  }

  if (
    question.includes("payment") ||
    question.includes("card") ||
    question.includes("authorization") ||
    question.includes("preauth")
  ) {
    return {
      mode: context.mode,
      answer:
        "Harvey Taxi may require payment authorization before dispatch. This helps confirm the payment method before a driver or autonomous trip is assigned."
    };
  }

  if (
    question.includes("driver signup") ||
    question.includes("become a driver") ||
    question.includes("driver approval")
  ) {
    return {
      mode: context.mode,
      answer:
        "Drivers must complete signup, submit required documents, complete verification steps, and receive approval before accepting missions."
    };
  }

  if (
    question.includes("autonomous") ||
    question.includes("pilot") ||
    question.includes("av")
  ) {
    return {
      mode: context.mode,
      answer:
        "Harvey Taxi supports both driver-request and autonomous pilot request flows. Availability depends on the request mode and service readiness in your area."
    };
  }

  if (
    question.includes("contact") ||
    question.includes("support") ||
    question.includes("help")
  ) {
    return {
      mode: context.mode,
      answer:
        "For direct support, contact support@harveytaxiservice.com. Include your ride ID, driver ID, or account email when possible so the team can help faster."
    };
  }

  return {
    mode: context.mode,
    answer:
      "Harvey Taxi helps riders request transportation and helps approved drivers manage ride missions. Riders may need approval and payment authorization before dispatch. Drivers must complete onboarding and approval before accepting trips."
  };
}

async function getAiSupportAnswer({ message = "", page = "" }) {
  const fallback = buildFallbackSupportAnswer({ message, page });
  const context = getSupportContextByPage(page);

  if (!ENABLE_AI || !openai || !cleanEnv(message)) {
    return {
      source: "fallback",
      ...fallback
    };
  }

  try {
    const completion = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      temperature: 0.4,
      messages: [
        {
          role: "system",
          content: context.system_prompt
        },
        {
          role: "user",
          content: cleanEnv(message)
        }
      ]
    });

    const answer =
      completion?.choices?.[0]?.message?.content?.trim() || fallback.answer;

    return {
      source: "openai",
      mode: context.mode,
      answer
    };
  } catch (error) {
    console.warn("⚠️ AI support fallback triggered:", error.message);
    return {
      source: "fallback",
      ...fallback
    };
  }
}

/* =========================================================
   AI / SUPPORT ROUTES
========================================================= */
app.post("/api/support/ask", async (req, res) => {
  try {
    const message = cleanEnv(req.body?.message);
    const page = cleanEnv(req.body?.page || req.body?.page_name || "general");

    if (!message) {
      return fail(res, 400, "message is required");
    }

    const result = await getAiSupportAnswer({ message, page });

    return ok(res, {
      message: "Support response generated",
      ...result
    });
  } catch (error) {
    console.error("❌ /api/support/ask failed:", error);
    return fail(
      res,
      Number(error.statusCode || 500),
      error.message || "Unable to generate support response"
    );
  }
});

app.get("/api/support/status", async (req, res) => {
  try {
    return ok(res, {
      ai_enabled: !!(ENABLE_AI && openai),
      model: ENABLE_AI && openai ? OPENAI_MODEL : null,
      fallback_available: true
    });
  } catch (error) {
    return fail(res, 500, error.message || "Unable to fetch support status");
  }
});

/* =========================================================
   NOT FOUND HANDLER
========================================================= */
app.use((req, res, next) => {
  return fail(res, 404, "Route not found", {
    method: req.method,
    path: req.originalUrl
  });
});

/* =========================================================
   FINAL ERROR HANDLER
   KEEP THIS NEAR THE BOTTOM
========================================================= */
app.use((error, req, res, next) => {
  console.error("❌ SERVER ERROR:", {
    message: error?.message,
    statusCode: error?.statusCode,
    path: req?.originalUrl,
    method: req?.method,
    stack: error?.stack
  });

  return fail(
    res,
    Number(error?.statusCode || 500),
    error?.message || "Internal server error",
    error?.details ? { details: error.details } : {}
  );
});

/* =========================================================
   SERVER START
========================================================= */
logStartupDiagnostics();

app.listen(PORT, () => {
  console.log(`🚀 ${APP_NAME} server running on port ${PORT}`);
  console.log(`🕒 Started at ${SERVER_STARTED_AT}`);
});

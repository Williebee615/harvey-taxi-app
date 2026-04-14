/* =========================================================
   HARVEY TAXI — CODE BLUE PHASE 10
   PART 1: CLEAN FOUNDATION + ENV + HELPERS + SUPABASE + HEALTH
   SR. DEVELOPER ENGINEER BUILD
========================================================= */

"use strict";

/* =========================================================
   CORE IMPORTS
========================================================= */
const express = require("express");
const cors = require("cors");
const path = require("path");
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");

/* =========================================================
   OPTIONAL IMPORTS
========================================================= */
let OpenAI = null;
try {
  OpenAI = require("openai");
} catch (error) {
  console.warn("⚠️ OpenAI SDK not installed. AI endpoints will stay disabled.");
}

let twilio = null;
try {
  twilio = require("twilio");
} catch (error) {
  console.warn("⚠️ Twilio SDK not installed. SMS endpoints will stay disabled.");
}

/* =========================================================
   APP INIT
========================================================= */
const app = express();

function clean(value = "") {
  return String(value ?? "").trim();
}

const APP_NAME = "Harvey Taxi Code Blue Phase 10";
const PORT = Number(process.env.PORT || 10000);
const NODE_ENV = clean(process.env.NODE_ENV || "development").toLowerCase();
const IS_PROD = NODE_ENV === "production";
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
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(express.static(path.join(__dirname, "public")));

/* =========================================================
   BASIC REQUEST LOGGING
========================================================= */
app.use((req, res, next) => {
  const started = Date.now();

  res.on("finish", () => {
    const ms = Date.now() - started;
    console.log(
      `[${new Date().toISOString()}] ${req.method} ${req.originalUrl} -> ${res.statusCode} (${ms}ms)`
    );
  });

  next();
});

/* =========================================================
   HELPERS
========================================================= */
function lower(value = "") {
  return clean(value).toLowerCase();
}

function toNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function toBool(value, fallback = false) {
  const normalized = lower(value);
  if (!normalized) return fallback;
  if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "n", "off"].includes(normalized)) return false;
  return fallback;
}

function cleanEnv(value = "") {
  return clean(value);
}

function nowIso() {
  return new Date().toISOString();
}

function createId(prefix = "id") {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function isEmail(value = "") {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean(value));
}

function normalizePhone(value = "") {
  const raw = clean(value).replace(/[^\d+]/g, "");
  if (!raw) return "";
  if (raw.startsWith("+")) return raw;
  if (raw.length === 10) return `+1${raw}`;
  if (raw.length === 11 && raw.startsWith("1")) return `+${raw}`;
  return raw;
}

function isObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function pickFirst(...values) {
  for (const value of values) {
    const cleaned = clean(value);
    if (cleaned) return cleaned;
  }
  return "";
}

function parseCoordinate(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function parseNullableNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* =========================================================
   RESPONSE HELPERS
========================================================= */
function ok(res, data = {}, status = 200) {
  return res.status(status).json({
    ok: true,
    ...data
  });
}

function fail(res, message = "Request failed", status = 400, extra = {}) {
  return res.status(status).json({
    ok: false,
    error: message,
    ...extra
  });
}

function serverError(res, error, message = "Internal server error") {
  console.error("❌ SERVER ERROR:", error);
  return res.status(500).json({
    ok: false,
    error: message,
    details: IS_PROD ? undefined : clean(error?.message || String(error))
  });
}

function asyncHandler(fn) {
  return async function wrappedHandler(req, res, next) {
    try {
      await fn(req, res, next);
    } catch (error) {
      console.error("❌ Unhandled route error:", error);
      if (res.headersSent) return;
      return serverError(res, error);
    }
  };
}

/* =========================================================
   CORE ENV
========================================================= */
const PUBLIC_APP_URL =
  cleanEnv(process.env.PUBLIC_APP_URL) ||
  cleanEnv(process.env.RENDER_EXTERNAL_URL) ||
  cleanEnv(process.env.APP_BASE_URL) ||
  "";

const SUPPORT_EMAIL =
  cleanEnv(process.env.SUPPORT_EMAIL) ||
  cleanEnv(process.env.SUPPORT_FROM_EMAIL) ||
  "support@harveytaxiservice.com";

const ADMIN_EMAIL =
  cleanEnv(process.env.ADMIN_EMAIL) ||
  cleanEnv(process.env.SUPPORT_ADMIN_EMAIL) ||
  "williebee@harveytaxiservice.com";

const ADMIN_PASSWORD =
  cleanEnv(process.env.ADMIN_PASSWORD) ||
  cleanEnv(process.env.SUPPORT_ADMIN_PASSWORD);

const ENABLE_AI_BRAIN = toBool(process.env.ENABLE_AI_BRAIN, true);
const ENABLE_REAL_SMS = toBool(process.env.ENABLE_REAL_SMS, false);
const ENABLE_REAL_EMAIL = toBool(process.env.ENABLE_REAL_EMAIL, false);
const ENABLE_RIDER_VERIFICATION_GATE = toBool(process.env.ENABLE_RIDER_VERIFICATION_GATE, true);
const ENABLE_PAYMENT_GATE = toBool(process.env.ENABLE_PAYMENT_GATE, true);
const ENABLE_DRIVER_LOCATION_TRACKING = toBool(process.env.ENABLE_DRIVER_LOCATION_TRACKING, true);
const ENABLE_AUTO_REDISPATCH = toBool(process.env.ENABLE_AUTO_REDISPATCH, true);
const ENABLE_STARTUP_TABLE_CHECKS = toBool(process.env.ENABLE_STARTUP_TABLE_CHECKS, true);

/* =========================================================
   DISPATCH + FARE CONFIG
========================================================= */
const DISPATCH_TIMEOUT_SECONDS = toNumber(process.env.DISPATCH_TIMEOUT_SECONDS, 30);
const DISPATCH_SWEEP_INTERVAL_MS = toNumber(process.env.DISPATCH_SWEEP_INTERVAL_MS, 15000);
const MAX_DISPATCH_ATTEMPTS = toNumber(process.env.MAX_DISPATCH_ATTEMPTS, 5);

const FARE_BASE = toNumber(process.env.FARE_BASE, 5.5);
const FARE_PER_MILE = toNumber(process.env.FARE_PER_MILE, 2.15);
const FARE_PER_MINUTE = toNumber(process.env.FARE_PER_MINUTE, 0.42);
const FARE_BOOKING_FEE = toNumber(process.env.FARE_BOOKING_FEE, 2.5);
const FARE_MINIMUM = toNumber(process.env.FARE_MINIMUM, 10);

const DRIVER_PAYOUT_PERCENT_STANDARD = toNumber(process.env.DRIVER_PAYOUT_PERCENT_STANDARD, 0.75);
const DRIVER_PAYOUT_PERCENT_AUTONOMOUS = toNumber(process.env.DRIVER_PAYOUT_PERCENT_AUTONOMOUS, 0.25);

const SURGE_MULTIPLIER_DEFAULT = toNumber(process.env.SURGE_MULTIPLIER_DEFAULT, 1.0);
const SURGE_MULTIPLIER_BUSY = toNumber(process.env.SURGE_MULTIPLIER_BUSY, 1.25);
const SURGE_MULTIPLIER_HIGH = toNumber(process.env.SURGE_MULTIPLIER_HIGH, 1.5);

/* =========================================================
   THIRD-PARTY ENV
========================================================= */
const SUPABASE_URL = cleanEnv(process.env.SUPABASE_URL);
const SUPABASE_SERVICE_ROLE_KEY = cleanEnv(process.env.SUPABASE_SERVICE_ROLE_KEY);

const OPENAI_API_KEY = cleanEnv(process.env.OPENAI_API_KEY);
const OPENAI_SUPPORT_MODEL = cleanEnv(process.env.OPENAI_SUPPORT_MODEL || "gpt-4.1-mini");

const TWILIO_ACCOUNT_SID = cleanEnv(process.env.TWILIO_ACCOUNT_SID);
const TWILIO_AUTH_TOKEN = cleanEnv(process.env.TWILIO_AUTH_TOKEN);
const TWILIO_FROM_NUMBER =
  cleanEnv(process.env.TWILIO_PHONE_NUMBER) ||
  cleanEnv(process.env.TWILIO_FROM_NUMBER);

const GOOGLE_MAPS_API_KEY = cleanEnv(process.env.GOOGLE_MAPS_API_KEY);

/* =========================================================
   CLIENTS
========================================================= */
const supabase =
  SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        auth: {
          persistSession: false,
          autoRefreshToken: false
        }
      })
    : null;

const openai =
  OpenAI && OPENAI_API_KEY && ENABLE_AI_BRAIN
    ? new OpenAI({ apiKey: OPENAI_API_KEY })
    : null;

const twilioClient =
  twilio && TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN
    ? twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
    : null;

/* =========================================================
   RUNTIME STATE
========================================================= */
const runtimeState = {
  startupChecks: {
    ran: false,
    ok: false,
    checkedAt: null,
    tables: {}
  },
  dispatchSweep: {
    enabled: ENABLE_AUTO_REDISPATCH,
    lastRanAt: null,
    lastError: null
  }
};

/* =========================================================
   STATUS NORMALIZERS
========================================================= */
function normalizeDriverType(value = "") {
  const v = lower(value);
  if (["av", "autonomous", "robotaxi", "self-driving"].includes(v)) return "autonomous";
  return "human";
}

function normalizeRideMode(value = "") {
  const v = lower(value);
  if (["autonomous", "av", "pilot"].includes(v)) return "autonomous";
  return "driver";
}

function normalizeRideType(value = "") {
  const v = lower(value);
  if (["airport", "medical", "nonprofit", "scheduled", "standard"].includes(v)) return v;
  return "standard";
}

function normalizePaymentStatus(value = "") {
  const v = lower(value);
  if (["authorized", "preauthorized", "pre_authorized"].includes(v)) return "authorized";
  if (["captured", "paid", "complete"].includes(v)) return "captured";
  if (["failed", "declined"].includes(v)) return "failed";
  if (["refunded", "released"].includes(v)) return v;
  return v || "pending";
}

function normalizeRideStatus(value = "") {
  const v = lower(value);

  if (!v) return "pending";
  if (["pending", "requested", "new"].includes(v)) return "pending";
  if (["quoted", "fare_estimated"].includes(v)) return "quoted";
  if (["awaiting_payment", "payment_required"].includes(v)) return "awaiting_payment";
  if (["awaiting_dispatch", "dispatch_ready"].includes(v)) return "awaiting_dispatch";
  if (["offered", "awaiting_driver_acceptance"].includes(v)) return "awaiting_driver_acceptance";
  if (["dispatched", "assigned"].includes(v)) return "dispatched";
  if (["driver_en_route", "en_route"].includes(v)) return "driver_en_route";
  if (["arrived"].includes(v)) return "arrived";
  if (["in_progress", "on_trip"].includes(v)) return "in_progress";
  if (["completed", "finished"].includes(v)) return "completed";
  if (["cancelled", "canceled"].includes(v)) return "cancelled";
  if (["no_driver", "no_driver_available"].includes(v)) return "no_driver_available";
  if (["expired"].includes(v)) return "expired";

  return v;
}

function normalizeDriverStatus(value = "") {
  const v = lower(value);

  if (!v) return "pending";
  if (["pending", "new"].includes(v)) return "pending";
  if (["verified"].includes(v)) return "verified";
  if (["approved", "active"].includes(v)) return "approved";
  if (["rejected", "denied"].includes(v)) return "rejected";
  if (["suspended"].includes(v)) return "suspended";

  return v;
}

function normalizeRiderStatus(value = "") {
  const v = lower(value);

  if (!v) return "pending";
  if (["pending", "new"].includes(v)) return "pending";
  if (["approved", "verified", "active"].includes(v)) return "approved";
  if (["rejected", "denied"].includes(v)) return "rejected";
  if (["suspended"].includes(v)) return "suspended";

  return v;
}

/* =========================================================
   ADMIN AUTH HELPERS
========================================================= */
function getAdminEmailFromRequest(req) {
  return (
    clean(req.headers["x-admin-email"]) ||
    clean(req.body?.admin_email) ||
    clean(req.query?.admin_email) ||
    ""
  );
}

function getAdminPasswordFromRequest(req) {
  return (
    clean(req.headers["x-admin-password"]) ||
    clean(req.body?.admin_password) ||
    clean(req.query?.admin_password) ||
    ""
  );
}

function isAdminRequest(req) {
  const email = lower(getAdminEmailFromRequest(req));
  const password = getAdminPasswordFromRequest(req);

  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) return false;
  return email === lower(ADMIN_EMAIL) && password === ADMIN_PASSWORD;
}

function requireAdmin(req, res, next) {
  if (!isAdminRequest(req)) {
    return fail(res, "Unauthorized admin request", 401);
  }
  next();
}

/* =========================================================
   FARE HELPERS
========================================================= */
function getRideTypeMultiplier(rideType = "") {
  const value = lower(rideType);
  if (value === "airport") return 1.2;
  if (value === "scheduled") return 1.1;
  if (value === "medical") return 1.05;
  if (value === "nonprofit") return 0.95;
  return 1.0;
}

function getModeMultiplier(mode = "") {
  const normalized = normalizeRideMode(mode);
  if (normalized === "autonomous") return 1.15;
  return 1.0;
}

function estimateFare({
  distanceMiles = 0,
  durationMinutes = 0,
  rideType = "standard",
  requestedMode = "driver",
  surgeMultiplier = SURGE_MULTIPLIER_DEFAULT
}) {
  const distance = Math.max(0, Number(distanceMiles) || 0);
  const duration = Math.max(0, Number(durationMinutes) || 0);

  const subtotal =
    FARE_BASE +
    distance * FARE_PER_MILE +
    duration * FARE_PER_MINUTE +
    FARE_BOOKING_FEE;

  const multiplied =
    subtotal *
    getRideTypeMultiplier(rideType) *
    getModeMultiplier(requestedMode) *
    Math.max(1, Number(surgeMultiplier) || 1);

  const total = Math.max(FARE_MINIMUM, multiplied);

  return {
    base_fare: roundMoney(FARE_BASE),
    per_mile_rate: roundMoney(FARE_PER_MILE),
    per_minute_rate: roundMoney(FARE_PER_MINUTE),
    booking_fee: roundMoney(FARE_BOOKING_FEE),
    minimum_fare: roundMoney(FARE_MINIMUM),
    distance_miles: roundMoney(distance),
    duration_minutes: roundMoney(duration),
    ride_type_multiplier: roundMoney(getRideTypeMultiplier(rideType)),
    mode_multiplier: roundMoney(getModeMultiplier(requestedMode)),
    surge_multiplier: roundMoney(Math.max(1, Number(surgeMultiplier) || 1)),
    estimated_total: roundMoney(total)
  };
}

function calculateDriverPayout(estimatedTotal, driverType = "human") {
  const total = Math.max(0, Number(estimatedTotal) || 0);
  const normalizedType = normalizeDriverType(driverType);

  const percent =
    normalizedType === "autonomous"
      ? DRIVER_PAYOUT_PERCENT_AUTONOMOUS
      : DRIVER_PAYOUT_PERCENT_STANDARD;

  const payout = roundMoney(total * percent);
  const platformFee = roundMoney(total - payout);

  return {
    driver_type: normalizedType,
    payout_percent: percent,
    driver_payout_estimate: payout,
    platform_fee_estimate: platformFee
  };
}

/* =========================================================
   SUPABASE HELPERS
========================================================= */
function requireSupabase() {
  if (!supabase) {
    throw new Error("Supabase is not configured. Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  }
  return supabase;
}

async function maybeSingle(queryBuilder) {
  const { data, error } = await queryBuilder.limit(1);
  if (error) throw error;
  if (!data || !data.length) return null;
  return data[0];
}

async function insertRow(table, payload) {
  const db = requireSupabase();
  const { data, error } = await db.from(table).insert(payload).select().limit(1);
  if (error) throw error;
  return data?.[0] || null;
}

async function updateRows(table, match, payload) {
  const db = requireSupabase();
  let query = db.from(table).update(payload);

  Object.entries(match || {}).forEach(([key, value]) => {
    query = query.eq(key, value);
  });

  const { data, error } = await query.select();
  if (error) throw error;
  return data || [];
}

async function getRowById(table, idColumn, idValue) {
  const db = requireSupabase();
  return maybeSingle(db.from(table).select("*").eq(idColumn, idValue));
}

async function logAdminEvent({
  event_type,
  actor_email = ADMIN_EMAIL,
  target_table = null,
  target_id = null,
  details = {}
}) {
  try {
    const db = requireSupabase();
    const payload = {
      id: createId("alog"),
      event_type: clean(event_type || "admin_event"),
      actor_email: clean(actor_email || ADMIN_EMAIL),
      target_table: target_table ? clean(target_table) : null,
      target_id: target_id ? clean(target_id) : null,
      details: isObject(details) ? details : { value: details },
      created_at: nowIso()
    };

    const { error } = await db.from("admin_logs").insert(payload);
    if (error) {
      console.warn("⚠️ Failed to write admin log:", error.message);
    }
  } catch (error) {
    console.warn("⚠️ Admin log insert skipped:", error.message);
  }
}

async function logTripEvent({
  ride_id,
  mission_id = null,
  driver_id = null,
  rider_id = null,
  event_type,
  details = {}
}) {
  try {
    const db = requireSupabase();
    const payload = {
      id: createId("tevt"),
      ride_id: clean(ride_id) || null,
      mission_id: clean(mission_id) || null,
      driver_id: clean(driver_id) || null,
      rider_id: clean(rider_id) || null,
      event_type: clean(event_type || "trip_event"),
      details: isObject(details) ? details : { value: details },
      created_at: nowIso()
    };

    const { error } = await db.from("trip_events").insert(payload);
    if (error) {
      console.warn("⚠️ Failed to write trip event:", error.message);
    }
  } catch (error) {
    console.warn("⚠️ Trip event insert skipped:", error.message);
  }
}

/* =========================================================
   COMMUNICATION HELPERS
========================================================= */
async function sendSms({ to, body }) {
  const phone = normalizePhone(to);

  if (!phone || !body) {
    return {
      ok: false,
      provider: "twilio",
      skipped: true,
      reason: "Missing phone or message"
    };
  }

  if (!ENABLE_REAL_SMS || !twilioClient || !TWILIO_FROM_NUMBER) {
    console.log(`📩 MOCK SMS -> ${phone}: ${body}`);
    return {
      ok: true,
      provider: "mock_sms",
      skipped: false,
      sid: null
    };
  }

  const result = await twilioClient.messages.create({
    to: phone,
    from: TWILIO_FROM_NUMBER,
    body: String(body)
  });

  return {
    ok: true,
    provider: "twilio",
    sid: result.sid || null
  };
}

/* =========================================================
   GATE HELPERS
========================================================= */
function riderIsApproved(rider) {
  const status = normalizeRiderStatus(
    rider?.status ||
      rider?.approval_status ||
      rider?.rider_status ||
      rider?.verification_status
  );

  return status === "approved";
}

function driverIsApproved(driver) {
  const status = normalizeDriverStatus(
    driver?.status ||
      driver?.approval_status ||
      driver?.driver_status ||
      driver?.verification_status
  );

  return status === "approved";
}

function paymentIsAuthorized(payment) {
  const status = normalizePaymentStatus(
    payment?.status || payment?.payment_status || payment?.authorization_status
  );

  return status === "authorized" || status === "captured";
}

/* =========================================================
   STARTUP CHECKS
========================================================= */
async function checkTableAccessible(tableName) {
  const db = requireSupabase();
  const { error } = await db.from(tableName).select("*", { count: "exact", head: true });
  return {
    ok: !error,
    error: error ? error.message : null
  };
}

async function runStartupChecks() {
  runtimeState.startupChecks.ran = true;
  runtimeState.startupChecks.checkedAt = nowIso();

  if (!supabase) {
    runtimeState.startupChecks.ok = false;
    runtimeState.startupChecks.tables = {
      _supabase: {
        ok: false,
        error: "Supabase client not configured"
      }
    };
    return runtimeState.startupChecks;
  }

  if (!ENABLE_STARTUP_TABLE_CHECKS) {
    runtimeState.startupChecks.ok = true;
    runtimeState.startupChecks.tables = {
      skipped: { ok: true, error: null }
    };
    return runtimeState.startupChecks;
  }

  const tableNames = [
    "riders",
    "drivers",
    "rides",
    "payments",
    "missions",
    "dispatches",
    "admin_logs",
    "trip_events"
  ];

  const results = {};
  let allOk = true;

  for (const tableName of tableNames) {
    const result = await checkTableAccessible(tableName);
    results[tableName] = result;
    if (!result.ok) allOk = false;
  }

  runtimeState.startupChecks.ok = allOk;
  runtimeState.startupChecks.tables = results;

  return runtimeState.startupChecks;
}

/* =========================================================
   ROOT / HEALTH ROUTES
========================================================= */
app.get("/", (req, res) => {
  const indexFile = path.join(__dirname, "public", "index.html");
  return res.sendFile(indexFile);
});

app.get("/api", (req, res) => {
  return ok(res, {
    app: APP_NAME,
    environment: NODE_ENV,
    started_at: SERVER_STARTED_AT,
    public_app_url: PUBLIC_APP_URL || null
  });
});

app.get("/api/health", asyncHandler(async (req, res) => {
  return ok(res, {
    app: APP_NAME,
    ok: true,
    environment: NODE_ENV,
    started_at: SERVER_STARTED_AT,
    now: nowIso(),
    services: {
      supabase: !!supabase,
      openai: !!openai,
      twilio: !!twilioClient,
      real_sms_enabled: ENABLE_REAL_SMS,
      real_email_enabled: ENABLE_REAL_EMAIL,
      rider_verification_gate: ENABLE_RIDER_VERIFICATION_GATE,
      payment_gate: ENABLE_PAYMENT_GATE,
      auto_redispatch: ENABLE_AUTO_REDISPATCH,
      driver_location_tracking: ENABLE_DRIVER_LOCATION_TRACKING
    },
    startup_checks: runtimeState.startupChecks
  });
}));

app.get("/api/config/public", (req, res) => {
  return ok(res, {
    support_email: SUPPORT_EMAIL,
    support_phone: TWILIO_FROM_NUMBER || null,
    app_name: APP_NAME,
    rider_verification_required: ENABLE_RIDER_VERIFICATION_GATE,
    payment_authorization_required: ENABLE_PAYMENT_GATE,
    dispatch_timeout_seconds: DISPATCH_TIMEOUT_SECONDS,
    autonomous_pilot_enabled: true
  });
});

app.get("/api/admin/health/deep", requireAdmin, asyncHandler(async (req, res) => {
  const checks = await runStartupChecks();

  return ok(res, {
    app: APP_NAME,
    checked_at: nowIso(),
    startup_checks: checks,
    env_summary: {
      supabase_url_present: !!SUPABASE_URL,
      supabase_service_role_present: !!SUPABASE_SERVICE_ROLE_KEY,
      openai_key_present: !!OPENAI_API_KEY,
      twilio_sid_present: !!TWILIO_ACCOUNT_SID,
      twilio_auth_present: !!TWILIO_AUTH_TOKEN,
      twilio_from_present: !!TWILIO_FROM_NUMBER,
      admin_email_present: !!ADMIN_EMAIL,
      admin_password_present: !!ADMIN_PASSWORD,
      google_maps_key_present: !!GOOGLE_MAPS_API_KEY
    }
  });
}));/* =========================================================
   PART 2: RIDERS + PAYMENTS + FARE ESTIMATE + REQUEST RIDE
========================================================= */

/* =========================================================
   ADDRESS + TRIP HELPERS
========================================================= */
function hasText(value = "") {
  return !!clean(value);
}

function normalizePassengerCount(value) {
  const count = toNumber(value, 1);
  return clamp(Math.round(count || 1), 1, 6);
}

function normalizeTipAmount(value) {
  return Math.max(0, roundMoney(toNumber(value, 0)));
}

function normalizeScheduledTime(value = "") {
  const raw = clean(value);
  if (!raw) return null;
  const dt = new Date(raw);
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toISOString();
}

function buildAddressObject(prefix, body = {}) {
  return {
    address: clean(body[`${prefix}_address`] || body[`${prefix}Address`] || body[prefix] || ""),
    city: clean(body[`${prefix}_city`] || body[`${prefix}City`] || ""),
    state: clean(body[`${prefix}_state`] || body[`${prefix}State`] || ""),
    zip: clean(
      body[`${prefix}_zip`] ||
        body[`${prefix}Zip`] ||
        body[`${prefix}_postal_code`] ||
        ""
    )
  };
}

function formatAddress(addressObj = {}) {
  const parts = [
    clean(addressObj.address),
    clean(addressObj.city),
    clean(addressObj.state),
    clean(addressObj.zip)
  ].filter(Boolean);

  return parts.join(", ");
}

/* =========================================================
   DISTANCE HELPERS
========================================================= */
function haversineMiles(lat1, lon1, lat2, lon2) {
  if (
    !Number.isFinite(lat1) ||
    !Number.isFinite(lon1) ||
    !Number.isFinite(lat2) ||
    !Number.isFinite(lon2)
  ) {
    return null;
  }

  const toRad = (deg) => (deg * Math.PI) / 180;
  const R = 3958.8;

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) ** 2;

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function estimateDurationMinutesFromMiles(miles = 0) {
  const assumedAverageMph = 26;
  const result = (Math.max(0, Number(miles) || 0) / assumedAverageMph) * 60;
  return Math.max(5, roundMoney(result));
}

function chooseSurgeMultiplier({
  requestedMode = "driver",
  rideType = "standard",
  scheduledTime = null
}) {
  const mode = normalizeRideMode(requestedMode);
  const type = normalizeRideType(rideType);

  if (mode === "autonomous") return SURGE_MULTIPLIER_BUSY;
  if (type === "airport") return SURGE_MULTIPLIER_BUSY;
  if (scheduledTime) return SURGE_MULTIPLIER_DEFAULT;

  return SURGE_MULTIPLIER_DEFAULT;
}

function buildFallbackTripMetrics(payload = {}) {
  const pickupLat =
    parseCoordinate(payload.pickup_latitude) ??
    parseCoordinate(payload.pickupLatitude) ??
    parseCoordinate(payload.pickup_lat);

  const pickupLng =
    parseCoordinate(payload.pickup_longitude) ??
    parseCoordinate(payload.pickupLongitude) ??
    parseCoordinate(payload.pickup_lng);

  const dropoffLat =
    parseCoordinate(payload.dropoff_latitude) ??
    parseCoordinate(payload.dropoffLatitude) ??
    parseCoordinate(payload.dropoff_lat);

  const dropoffLng =
    parseCoordinate(payload.dropoff_longitude) ??
    parseCoordinate(payload.dropoffLongitude) ??
    parseCoordinate(payload.dropoff_lng);

  const miles = haversineMiles(pickupLat, pickupLng, dropoffLat, dropoffLng);

  if (!miles) {
    return {
      distance_miles: 8,
      duration_minutes: 18,
      source: "fallback_default"
    };
  }

  return {
    distance_miles: roundMoney(Math.max(1, miles * 1.18)),
    duration_minutes: estimateDurationMinutesFromMiles(miles * 1.18),
    source: "fallback_haversine"
  };
}

/* =========================================================
   GOOGLE MAPS HELPERS
========================================================= */
async function safeFetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();

  let json = null;
  try {
    json = JSON.parse(text);
  } catch (error) {
    json = null;
  }

  return {
    ok: response.ok,
    status: response.status,
    json,
    text
  };
}

async function geocodeAddress(address = "") {
  const query = clean(address);
  if (!query || !GOOGLE_MAPS_API_KEY) return null;

  const endpoint =
    `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(
      query
    )}&key=${encodeURIComponent(GOOGLE_MAPS_API_KEY)}`;

  const result = await safeFetchJson(endpoint);

  if (!result.ok || !result.json || result.json.status !== "OK") {
    return null;
  }

  const first = result.json.results?.[0];
  const location = first?.geometry?.location;

  if (!location) return null;

  return {
    latitude: Number(location.lat),
    longitude: Number(location.lng),
    formatted_address: clean(first.formatted_address || query)
  };
}

async function getDistanceMatrix({ originAddress, destinationAddress }) {
  const origin = clean(originAddress);
  const destination = clean(destinationAddress);

  if (!origin || !destination || !GOOGLE_MAPS_API_KEY) return null;

  const endpoint =
    `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${encodeURIComponent(
      origin
    )}&destinations=${encodeURIComponent(
      destination
    )}&units=imperial&key=${encodeURIComponent(GOOGLE_MAPS_API_KEY)}`;

  const result = await safeFetchJson(endpoint);

  if (!result.ok || !result.json || result.json.status !== "OK") {
    return null;
  }

  const row = result.json.rows?.[0];
  const element = row?.elements?.[0];

  if (!element || element.status !== "OK") return null;

  const distanceMeters = Number(element.distance?.value || 0);
  const durationSeconds = Number(element.duration?.value || 0);

  return {
    distance_miles: roundMoney(distanceMeters / 1609.344),
    duration_minutes: roundMoney(durationSeconds / 60),
    source: "google_distance_matrix"
  };
}

async function resolveTripMetrics(payload = {}) {
  const pickup = formatAddress(buildAddressObject("pickup", payload));
  const dropoff = formatAddress(buildAddressObject("dropoff", payload));

  if (pickup && dropoff && GOOGLE_MAPS_API_KEY) {
    const matrix = await getDistanceMatrix({
      originAddress: pickup,
      destinationAddress: dropoff
    });

    if (matrix) return matrix;
  }

  return buildFallbackTripMetrics(payload);
}

/* =========================================================
   RIDER HELPERS
========================================================= */
async function getRiderById(riderId) {
  const id = clean(riderId);
  if (!id) return null;
  return getRowById("riders", "id", id);
}

async function getRiderByEmail(email) {
  const value = lower(email);
  if (!value) return null;

  return maybeSingle(
    requireSupabase()
      .from("riders")
      .select("*")
      .ilike("email", value)
  );
}

async function getRiderByPhone(phone) {
  const value = normalizePhone(phone);
  if (!value) return null;

  return maybeSingle(
    requireSupabase()
      .from("riders")
      .select("*")
      .eq("phone", value)
  );
}

async function resolveRiderFromRequest(body = {}) {
  const riderId = pickFirst(body.rider_id, body.riderId);
  const riderEmail = pickFirst(body.email, body.rider_email, body.riderEmail);
  const riderPhone = pickFirst(body.phone, body.rider_phone, body.riderPhone);

  if (riderId) {
    const rider = await getRiderById(riderId);
    if (rider) return rider;
  }

  if (riderEmail) {
    const rider = await getRiderByEmail(riderEmail);
    if (rider) return rider;
  }

  if (riderPhone) {
    const rider = await getRiderByPhone(riderPhone);
    if (rider) return rider;
  }

  return null;
}

function buildRiderStatusResponse(rider) {
  const approvalStatus = normalizeRiderStatus(
    rider?.status ||
      rider?.approval_status ||
      rider?.rider_status ||
      rider?.verification_status
  );

  return {
    rider_id: rider?.id || null,
    first_name: clean(rider?.first_name || ""),
    last_name: clean(rider?.last_name || ""),
    full_name: clean(
      rider?.full_name ||
        [rider?.first_name, rider?.last_name].filter(Boolean).join(" ")
    ),
    email: clean(rider?.email || ""),
    phone: clean(rider?.phone || ""),
    status: approvalStatus,
    is_approved: approvalStatus === "approved",
    approval_status: approvalStatus,
    rider_verification_required: ENABLE_RIDER_VERIFICATION_GATE
  };
}

/* =========================================================
   PAYMENT HELPERS
========================================================= */
async function getLatestPaymentForRider(riderId) {
  const id = clean(riderId);
  if (!id) return null;

  const { data, error } = await requireSupabase()
    .from("payments")
    .select("*")
    .eq("rider_id", id)
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) throw error;
  return data?.[0] || null;
}

async function getLatestAuthorizedPaymentForRider(riderId) {
  const payment = await getLatestPaymentForRider(riderId);
  if (!payment) return null;
  return paymentIsAuthorized(payment) ? payment : null;
}

function buildPaymentSummary(payment) {
  if (!payment) {
    return {
      payment_id: null,
      status: "missing",
      is_authorized: false,
      authorization_amount: 0
    };
  }

  const normalizedStatus = normalizePaymentStatus(
    payment.status || payment.payment_status || payment.authorization_status
  );

  return {
    payment_id: payment.id || null,
    status: normalizedStatus,
    is_authorized:
      normalizedStatus === "authorized" || normalizedStatus === "captured",
    authorization_amount: roundMoney(
      payment.authorization_amount ||
        payment.amount_authorized ||
        payment.amount ||
        0
    ),
    currency: clean(payment.currency || "USD")
  };
}

/* =========================================================
   RIDE HELPERS
========================================================= */
function buildRidePayload({
  rider,
  requestBody,
  fare,
  payout
}) {
  const requestedMode = normalizeRideMode(
    requestBody.requested_mode ||
      requestBody.requestedMode ||
      requestBody.mode
  );

  const rideType = normalizeRideType(
    requestBody.ride_type || requestBody.rideType
  );

  const pickupAddress = buildAddressObject("pickup", requestBody);
  const dropoffAddress = buildAddressObject("dropoff", requestBody);

  const scheduledAt = normalizeScheduledTime(
    requestBody.scheduled_at ||
      requestBody.scheduledAt ||
      requestBody.schedule_time ||
      requestBody.scheduleTime
  );

  const notes = clean(
    requestBody.notes ||
      requestBody.ride_notes ||
      requestBody.special_instructions ||
      requestBody.specialInstructions
  );

  return {
    id: createId("ride"),
    rider_id: rider.id,
    status: normalizeRideStatus("awaiting_dispatch"),
    requested_mode: requestedMode,
    ride_type: rideType,
    passenger_count: normalizePassengerCount(
      requestBody.passenger_count || requestBody.passengerCount || 1
    ),
    pickup_address: formatAddress(pickupAddress),
    pickup_city: pickupAddress.city,
    pickup_state: pickupAddress.state,
    pickup_zip: pickupAddress.zip,
    dropoff_address: formatAddress(dropoffAddress),
    dropoff_city: dropoffAddress.city,
    dropoff_state: dropoffAddress.state,
    dropoff_zip: dropoffAddress.zip,
    pickup_latitude:
      parseCoordinate(requestBody.pickup_latitude) ??
      parseCoordinate(requestBody.pickupLatitude) ??
      null,
    pickup_longitude:
      parseCoordinate(requestBody.pickup_longitude) ??
      parseCoordinate(requestBody.pickupLongitude) ??
      null,
    dropoff_latitude:
      parseCoordinate(requestBody.dropoff_latitude) ??
      parseCoordinate(requestBody.dropoffLatitude) ??
      null,
    dropoff_longitude:
      parseCoordinate(requestBody.dropoff_longitude) ??
      parseCoordinate(requestBody.dropoffLongitude) ??
      null,
    estimated_distance_miles: fare.distance_miles,
    estimated_duration_minutes: fare.duration_minutes,
    estimated_total: fare.estimated_total,
    estimated_driver_payout: payout.driver_payout_estimate,
    estimated_platform_fee: payout.platform_fee_estimate,
    surge_multiplier: fare.surge_multiplier,
    fare_snapshot: fare,
    notes: notes || null,
    scheduled_at: scheduledAt,
    requested_at: nowIso(),
    created_at: nowIso(),
    updated_at: nowIso()
  };
}

function validateRideRequestBody(body = {}) {
  const pickup = formatAddress(buildAddressObject("pickup", body));
  const dropoff = formatAddress(buildAddressObject("dropoff", body));

  if (!pickup) return "Pickup address is required";
  if (!dropoff) return "Dropoff address is required";

  if (pickup.toLowerCase() === dropoff.toLowerCase()) {
    return "Pickup and dropoff cannot be the same";
  }

  const phone = pickFirst(body.phone, body.rider_phone, body.riderPhone);
  if (phone && !normalizePhone(phone)) {
    return "Phone number format is invalid";
  }

  const scheduledAt = normalizeScheduledTime(
    body.scheduled_at || body.scheduledAt || body.schedule_time
  );

  if (
    hasText(body.scheduled_at || body.scheduledAt || body.schedule_time) &&
    !scheduledAt
  ) {
    return "Scheduled time is invalid";
  }

  return null;
}

/* =========================================================
   RIDER ROUTES
========================================================= */
app.post("/api/rider/signup", asyncHandler(async (req, res) => {
  const firstName = clean(req.body.first_name || req.body.firstName);
  const lastName = clean(req.body.last_name || req.body.lastName);
  const email = lower(req.body.email);
  const phone = normalizePhone(req.body.phone);
  const documentType = lower(
    req.body.document_type || req.body.documentType || ""
  );

  if (!firstName) return fail(res, "First name is required");
  if (!lastName) return fail(res, "Last name is required");
  if (!email || !isEmail(email)) return fail(res, "Valid email is required");
  if (!phone) return fail(res, "Valid phone number is required");

  const existingByEmail = await getRiderByEmail(email);
  if (existingByEmail) {
    return ok(res, {
      message: "Rider already exists",
      rider: buildRiderStatusResponse(existingByEmail)
    });
  }

  const existingByPhone = await getRiderByPhone(phone);
  if (existingByPhone) {
    return ok(res, {
      message: "Rider already exists",
      rider: buildRiderStatusResponse(existingByPhone)
    });
  }

  const rider = await insertRow("riders", {
    id: createId("rider"),
    first_name: firstName,
    last_name: lastName,
    full_name: `${firstName} ${lastName}`.trim(),
    email,
    phone,
    document_type: documentType || null,
    status: "pending",
    approval_status: "pending",
    verification_status: "pending",
    created_at: nowIso(),
    updated_at: nowIso()
  });

  await logTripEvent({
    rider_id: rider.id,
    event_type: "rider_signup_created",
    details: {
      email,
      phone,
      document_type: documentType || null
    }
  });

  return ok(
    res,
    {
      message: "Rider signup submitted successfully",
      rider: buildRiderStatusResponse(rider)
    },
    201
  );
}));

app.post("/api/rider/status", asyncHandler(async (req, res) => {
  const rider = await resolveRiderFromRequest(req.body);

  if (!rider) {
    return fail(res, "Rider not found", 404);
  }

  const latestPayment = await getLatestPaymentForRider(rider.id);

  return ok(res, {
    rider: buildRiderStatusResponse(rider),
    payment: buildPaymentSummary(latestPayment)
  });
}));

app.get("/api/rider/:riderId/status", asyncHandler(async (req, res) => {
  const rider = await getRiderById(req.params.riderId);

  if (!rider) {
    return fail(res, "Rider not found", 404);
  }

  const latestPayment = await getLatestPaymentForRider(rider.id);

  return ok(res, {
    rider: buildRiderStatusResponse(rider),
    payment: buildPaymentSummary(latestPayment)
  });
}));

app.get("/api/rider/:riderId/rides", asyncHandler(async (req, res) => {
  const riderId = clean(req.params.riderId);
  if (!riderId) return fail(res, "Rider ID is required");

  const rider = await getRiderById(riderId);
  if (!rider) return fail(res, "Rider not found", 404);

  const { data, error } = await requireSupabase()
    .from("rides")
    .select("*")
    .eq("rider_id", riderId)
    .order("created_at", { ascending: false });

  if (error) throw error;

  return ok(res, {
    rider: buildRiderStatusResponse(rider),
    rides: data || []
  });
}));

/* =========================================================
   PAYMENT ROUTES
========================================================= */
app.post("/api/payments/authorize", asyncHandler(async (req, res) => {
  const rider = await resolveRiderFromRequest(req.body);

  if (!rider) {
    return fail(res, "Rider not found", 404);
  }

  if (ENABLE_RIDER_VERIFICATION_GATE && !riderIsApproved(rider)) {
    return fail(res, "Rider is not approved yet", 403, {
      rider: buildRiderStatusResponse(rider)
    });
  }

  const amount = Math.max(
    0,
    roundMoney(
      toNumber(
        req.body.amount ||
          req.body.authorization_amount ||
          req.body.amount_authorized,
        0
      )
    )
  );

  if (!amount) {
    return fail(res, "Authorization amount is required");
  }

  const payment = await insertRow("payments", {
    id: createId("pay"),
    rider_id: rider.id,
    status: "authorized",
    payment_status: "authorized",
    authorization_status: "authorized",
    authorization_amount: amount,
    amount: amount,
    currency: clean(req.body.currency || "USD") || "USD",
    provider:
      clean(req.body.provider || "manual_authorization") ||
      "manual_authorization",
    payment_method_last4: clean(
      req.body.last4 || req.body.payment_method_last4 || ""
    ),
    created_at: nowIso(),
    updated_at: nowIso()
  });

  await logTripEvent({
    rider_id: rider.id,
    event_type: "payment_authorized",
    details: {
      payment_id: payment.id,
      amount
    }
  });

  return ok(res, {
    message: "Payment authorized successfully",
    payment: buildPaymentSummary(payment),
    rider: buildRiderStatusResponse(rider)
  });
}));

/* =========================================================
   FARE ESTIMATE
========================================================= */
app.post("/api/fare-estimate", asyncHandler(async (req, res) => {
  const validationError = validateRideRequestBody(req.body);
  if (validationError) return fail(res, validationError);

  const tripMetrics = await resolveTripMetrics(req.body);

  const requestedMode = normalizeRideMode(
    req.body.requested_mode ||
      req.body.requestedMode ||
      req.body.mode
  );

  const rideType = normalizeRideType(
    req.body.ride_type || req.body.rideType
  );

  const scheduledAt = normalizeScheduledTime(
    req.body.scheduled_at || req.body.scheduledAt || req.body.schedule_time
  );

  const surgeMultiplier = chooseSurgeMultiplier({
    requestedMode,
    rideType,
    scheduledTime: scheduledAt
  });

  const fare = estimateFare({
    distanceMiles: tripMetrics.distance_miles,
    durationMinutes: tripMetrics.duration_minutes,
    rideType,
    requestedMode,
    surgeMultiplier
  });

  const payout = calculateDriverPayout(
    fare.estimated_total,
    requestedMode === "autonomous" ? "autonomous" : "human"
  );

  return ok(res, {
    ride_id: null,
    estimate_source: tripMetrics.source,
    fare,
    payout
  });
}));

/* =========================================================
   REQUEST RIDE
========================================================= */
app.post("/api/request-ride", asyncHandler(async (req, res) => {
  const validationError = validateRideRequestBody(req.body);
  if (validationError) return fail(res, validationError);

  const rider = await resolveRiderFromRequest(req.body);

  if (!rider) {
    return fail(res, "Rider not found. Complete rider signup first.", 404);
  }

  if (ENABLE_RIDER_VERIFICATION_GATE && !riderIsApproved(rider)) {
    return fail(res, "Rider approval is required before requesting a ride", 403, {
      rider: buildRiderStatusResponse(rider)
    });
  }

  const latestAuthorizedPayment = ENABLE_PAYMENT_GATE
    ? await getLatestAuthorizedPaymentForRider(rider.id)
    : null;

  if (ENABLE_PAYMENT_GATE && !latestAuthorizedPayment) {
    return fail(res, "Payment authorization is required before dispatch", 402, {
      rider: buildRiderStatusResponse(rider),
      payment: buildPaymentSummary(null)
    });
  }

  const tripMetrics = await resolveTripMetrics(req.body);

  const requestedMode = normalizeRideMode(
    req.body.requested_mode ||
      req.body.requestedMode ||
      req.body.mode
  );

  const rideType = normalizeRideType(
    req.body.ride_type || req.body.rideType
  );

  const scheduledAt = normalizeScheduledTime(
    req.body.scheduled_at || req.body.scheduledAt || req.body.schedule_time
  );

  const surgeMultiplier = chooseSurgeMultiplier({
    requestedMode,
    rideType,
    scheduledTime: scheduledAt
  });

  const fare = estimateFare({
    distanceMiles: tripMetrics.distance_miles,
    durationMinutes: tripMetrics.duration_minutes,
    rideType,
    requestedMode,
    surgeMultiplier
  });

  const payout = calculateDriverPayout(
    fare.estimated_total,
    requestedMode === "autonomous" ? "autonomous" : "human"
  );

  const ridePayload = buildRidePayload({
    rider,
    requestBody: req.body,
    fare,
    payout
  });

  const ride = await insertRow("rides", ridePayload);

  await logTripEvent({
    ride_id: ride.id,
    rider_id: rider.id,
    event_type: "ride_requested",
    details: {
      requested_mode: ride.requested_mode,
      ride_type: ride.ride_type,
      estimated_total: ride.estimated_total,
      scheduled_at: ride.scheduled_at || null
    }
  });

  let dispatchResult = null;

  try {
    dispatchResult = await dispatchRideToBestDriver(ride.id);

    if (dispatchResult?.ok) {
      await logTripEvent({
        ride_id: ride.id,
        rider_id: rider.id,
        driver_id: dispatchResult?.driver?.id || null,
        mission_id: dispatchResult?.mission?.id || null,
        event_type: "auto_dispatch_triggered",
        details: {
          dispatch_id: dispatchResult?.dispatch?.id || null,
          reused: !!dispatchResult?.reused,
          requested_mode: ride.requested_mode
        }
      });
    } else {
      await logTripEvent({
        ride_id: ride.id,
        rider_id: rider.id,
        event_type: "auto_dispatch_attempt_failed",
        details: {
          error: dispatchResult?.error || "Unknown dispatch error"
        }
      });
    }
  } catch (error) {
    console.error("❌ Auto dispatch trigger failed:", error);

    await logTripEvent({
      ride_id: ride.id,
      rider_id: rider.id,
      event_type: "auto_dispatch_exception",
      details: {
        error: clean(error?.message || String(error))
      }
    });
  }

  const latestRideState = await getRideById(ride.id);

  return ok(
    res,
    {
      message: dispatchResult?.ok
        ? "Ride request accepted and dispatch started automatically"
        : "Ride request accepted but dispatch is still pending",
      ride_id: ride.id,
      ride: latestRideState || ride,
      fare,
      payout,
      rider: buildRiderStatusResponse(rider),
      payment: buildPaymentSummary(latestAuthorizedPayment),
      dispatch: dispatchResult?.dispatch || null,
      mission: dispatchResult?.mission || null,
      assigned_driver: dispatchResult?.driver
        ? {
            id: dispatchResult.driver.id,
            full_name: getDriverDisplayName(dispatchResult.driver),
            driver_type: normalizeDriverType(
              dispatchResult.driver.driver_type || "human"
            )
          }
        : null,
      dispatch_ai: {
        triggered: true,
        success: !!dispatchResult?.ok,
        reused_existing_dispatch: !!dispatchResult?.reused,
        error: dispatchResult?.ok ? null : dispatchResult?.error || null
      }
    },
    201
  );
}));

/* =========================================================
   SINGLE RIDE LOOKUP
========================================================= */
app.get("/api/rides/:rideId", asyncHandler(async (req, res) => {
  const rideId = clean(req.params.rideId);
  if (!rideId) return fail(res, "Ride ID is required");

  const ride = await getRideById("rides", "id", rideId);
  if (!ride) return fail(res, "Ride not found", 404);

  return ok(res, { ride });
}));/* =========================================================
   PART 3: DRIVERS + DISPATCH + MISSIONS + ACCEPTANCE FLOW
========================================================= */

/* =========================================================
   DRIVER HELPERS
========================================================= */
async function getDriverById(driverId) {
  const id = clean(driverId);
  if (!id) return null;
  return getRowById("drivers", "id", id);
}

async function getDriverByEmail(email) {
  const value = lower(email);
  if (!value) return null;

  return maybeSingle(
    requireSupabase()
      .from("drivers")
      .select("*")
      .ilike("email", value)
  );
}

async function getDriverByPhone(phone) {
  const value = normalizePhone(phone);
  if (!value) return null;

  return maybeSingle(
    requireSupabase()
      .from("drivers")
      .select("*")
      .eq("phone", value)
  );
}

async function resolveDriverFromRequest(body = {}) {
  const driverId = pickFirst(body.driver_id, body.driverId);
  const driverEmail = pickFirst(body.email, body.driver_email, body.driverEmail);
  const driverPhone = pickFirst(body.phone, body.driver_phone, body.driverPhone);

  if (driverId) {
    const driver = await getDriverById(driverId);
    if (driver) return driver;
  }

  if (driverEmail) {
    const driver = await getDriverByEmail(driverEmail);
    if (driver) return driver;
  }

  if (driverPhone) {
    const driver = await getDriverByPhone(driverPhone);
    if (driver) return driver;
  }

  return null;
}

function driverIsVerified(driver) {
  const emailVerified = toBool(
    driver?.email_verified ?? driver?.email_is_verified ?? false,
    false
  );
  const smsVerified = toBool(
    driver?.sms_verified ?? driver?.phone_verified ?? driver?.phone_is_verified ?? false,
    false
  );

  return emailVerified && smsVerified;
}

function driverIsOnline(driver) {
  const online = lower(
    driver?.availability_status || driver?.online_status || driver?.is_online
  );

  if (online === "true") return true;
  if (["online", "available", "ready", "active"].includes(online)) return true;
  if (typeof driver?.is_online === "boolean") return driver.is_online;

  return false;
}

function driverCanReceiveMission(driver, requestedMode = "driver") {
  const approved = driverIsApproved(driver);
  const verified = driverIsVerified(driver);
  const online = driverIsOnline(driver);
  const driverType = normalizeDriverType(driver?.driver_type || driver?.type || "human");
  const mode = normalizeRideMode(requestedMode);

  if (!approved) return false;
  if (!verified) return false;
  if (!online) return false;
  if (mode === "autonomous" && driverType !== "autonomous") return false;
  if (mode === "driver" && driverType !== "human") return false;

  return true;
}

function getDriverDisplayName(driver = {}) {
  return (
    clean(driver.full_name) ||
    [clean(driver.first_name), clean(driver.last_name)].filter(Boolean).join(" ") ||
    clean(driver.name) ||
    "Driver"
  );
}

/* =========================================================
   DRIVER LOCATION / SCORING HELPERS
========================================================= */
function getDriverLatitude(driver) {
  return (
    parseNullableNumber(driver?.current_latitude) ??
    parseNullableNumber(driver?.latitude) ??
    parseNullableNumber(driver?.last_latitude)
  );
}

function getDriverLongitude(driver) {
  return (
    parseNullableNumber(driver?.current_longitude) ??
    parseNullableNumber(driver?.longitude) ??
    parseNullableNumber(driver?.last_longitude)
  );
}

function distanceMilesBetweenDriverAndPickup(driver, ride) {
  const driverLat = getDriverLatitude(driver);
  const driverLng = getDriverLongitude(driver);

  const rideLat =
    parseNullableNumber(ride?.pickup_latitude) ??
    parseNullableNumber(ride?.origin_latitude);

  const rideLng =
    parseNullableNumber(ride?.pickup_longitude) ??
    parseNullableNumber(ride?.origin_longitude);

  const distance = haversineMiles(driverLat, driverLng, rideLat, rideLng);
  if (!distance || !Number.isFinite(distance)) return 9999;

  return distance;
}

function getDriverCompletedTrips(driver) {
  return toNumber(
    driver?.completed_trips ||
      driver?.total_completed_trips ||
      driver?.trip_count ||
      0,
    0
  );
}

function getDriverAcceptanceRate(driver) {
  const value = Number(
    driver?.acceptance_rate ??
      driver?.mission_acceptance_rate ??
      0.8
  );

  if (!Number.isFinite(value)) return 0.8;
  return clamp(value, 0, 1);
}

function getDriverRating(driver) {
  const value = Number(driver?.rating ?? driver?.avg_rating ?? 5);
  if (!Number.isFinite(value)) return 5;
  return clamp(value, 1, 5);
}

function scoreDriverForRide(driver, ride) {
  const distance = distanceMilesBetweenDriverAndPickup(driver, ride);
  const rating = getDriverRating(driver);
  const completedTrips = getDriverCompletedTrips(driver);
  const acceptanceRate = getDriverAcceptanceRate(driver);

  let score = 0;
  score += Math.max(0, 100 - distance * 8);
  score += rating * 8;
  score += Math.min(20, completedTrips * 0.1);
  score += acceptanceRate * 25;

  return {
    score: roundMoney(score),
    distance_miles_to_pickup: roundMoney(distance),
    rating,
    completed_trips: completedTrips,
    acceptance_rate: acceptanceRate
  };
}

/* =========================================================
   DISPATCH HELPERS
========================================================= */
function getDispatchExpiresAt() {
  return new Date(Date.now() + DISPATCH_TIMEOUT_SECONDS * 1000).toISOString();
}

async function getRideById(rideId) {
  return getRowById("rides", "id", clean(rideId));
}

async function getMissionByRideId(rideId) {
  return maybeSingle(
    requireSupabase()
      .from("missions")
      .select("*")
      .eq("ride_id", clean(rideId))
      .order("created_at", { ascending: false })
  );
}

async function getActiveDispatchForRide(rideId) {
  return maybeSingle(
    requireSupabase()
      .from("dispatches")
      .select("*")
      .eq("ride_id", clean(rideId))
      .in("status", ["offered", "awaiting_driver_acceptance"])
      .order("created_at", { ascending: false })
  );
}

async function getDispatchById(dispatchId) {
  return getRowById("dispatches", "id", clean(dispatchId));
}

async function getMissionById(missionId) {
  return getRowById("missions", "id", clean(missionId));
}

async function countDispatchAttemptsForRide(rideId) {
  const { count, error } = await requireSupabase()
    .from("dispatches")
    .select("*", { count: "exact", head: true })
    .eq("ride_id", clean(rideId));

  if (error) throw error;
  return Number(count || 0);
}

async function getCandidateDriversForRide(ride) {
  const mode = normalizeRideMode(ride?.requested_mode || "driver");

  const { data, error } = await requireSupabase()
    .from("drivers")
    .select("*")
    .order("updated_at", { ascending: false });

  if (error) throw error;

  const drivers = (data || []).filter((driver) =>
    driverCanReceiveMission(driver, mode)
  );

  return drivers
    .map((driver) => {
      const scoring = scoreDriverForRide(driver, ride);
      return {
        driver,
        scoring
      };
    })
    .sort((a, b) => b.scoring.score - a.scoring.score);
}

async function createMissionForRide(ride, driver, dispatchMeta = {}) {
  const existingMission = await getMissionByRideId(ride.id);
  if (existingMission) return existingMission;

  const mission = await insertRow("missions", {
    id: createId("mission"),
    ride_id: ride.id,
    rider_id: clean(ride.rider_id),
    driver_id: clean(driver.id),
    status: "offered",
    mission_status: "offered",
    requested_mode: normalizeRideMode(ride.requested_mode || "driver"),
    mission_snapshot: {
      ride_id: ride.id,
      pickup_address: ride.pickup_address,
      dropoff_address: ride.dropoff_address,
      estimated_total: ride.estimated_total,
      estimated_driver_payout: ride.estimated_driver_payout,
      passenger_count: ride.passenger_count,
      ride_type: ride.ride_type,
      requested_mode: ride.requested_mode,
      notes: ride.notes || null,
      dispatch_meta: dispatchMeta
    },
    created_at: nowIso(),
    updated_at: nowIso()
  });

  return mission;
}

async function createDispatchForRide(ride, driver, scoring) {
  const attemptNumber = (await countDispatchAttemptsForRide(ride.id)) + 1;
  const expiresAt = getDispatchExpiresAt();

  return insertRow("dispatches", {
    id: createId("dispatch"),
    ride_id: ride.id,
    rider_id: clean(ride.rider_id),
    driver_id: clean(driver.id),
    status: "awaiting_driver_acceptance",
    dispatch_status: "awaiting_driver_acceptance",
    attempt_number: attemptNumber,
    offered_at: nowIso(),
    expires_at: expiresAt,
    scoring_snapshot: scoring,
    created_at: nowIso(),
    updated_at: nowIso()
  });
}

async function assignDriverToRide(ride, driver, dispatch, mission) {
  const updatedRides = await updateRows(
    "rides",
    { id: ride.id },
    {
      driver_id: driver.id,
      mission_id: mission.id,
      dispatch_id: dispatch.id,
      status: "awaiting_driver_acceptance",
      updated_at: nowIso()
    }
  );

  await updateRows(
    "missions",
    { id: mission.id },
    {
      driver_id: driver.id,
      status: "offered",
      mission_status: "offered",
      updated_at: nowIso()
    }
  );

  return updatedRides?.[0] || ride;
}

async function expireDispatch(dispatch, reason = "expired") {
  if (!dispatch?.id) return null;

  const updated = await updateRows(
    "dispatches",
    { id: dispatch.id },
    {
      status: "expired",
      dispatch_status: "expired",
      expired_at: nowIso(),
      expiry_reason: clean(reason || "expired"),
      updated_at: nowIso()
    }
  );

  return updated?.[0] || null;
}

async function rejectDispatch(dispatch, reason = "declined") {
  if (!dispatch?.id) return null;

  const updated = await updateRows(
    "dispatches",
    { id: dispatch.id },
    {
      status: "declined",
      dispatch_status: "declined",
      declined_at: nowIso(),
      decline_reason: clean(reason || "declined"),
      updated_at: nowIso()
    }
  );

  return updated?.[0] || null;
}

async function markMissionExpired(missionId, reason = "dispatch_expired") {
  if (!missionId) return null;

  const updated = await updateRows(
    "missions",
    { id: missionId },
    {
      status: "expired",
      mission_status: "expired",
      expiry_reason: clean(reason),
      updated_at: nowIso()
    }
  );

  return updated?.[0] || null;
}

async function markMissionDeclined(missionId, reason = "driver_declined") {
  if (!missionId) return null;

  const updated = await updateRows(
    "missions",
    { id: missionId },
    {
      status: "declined",
      mission_status: "declined",
      decline_reason: clean(reason),
      updated_at: nowIso()
    }
  );

  return updated?.[0] || null;
}

async function moveRideBackToDispatchQueue(rideId) {
  const updated = await updateRows(
    "rides",
    { id: clean(rideId) },
    {
      driver_id: null,
      mission_id: null,
      dispatch_id: null,
      status: "awaiting_dispatch",
      updated_at: nowIso()
    }
  );

  return updated?.[0] || null;
}

async function markRideNoDriverAvailable(rideId) {
  const updated = await updateRows(
    "rides",
    { id: clean(rideId) },
    {
      status: "no_driver_available",
      updated_at: nowIso()
    }
  );

  return updated?.[0] || null;
}

async function notifyDriverOfMission(driver, ride, dispatch) {
  const to = driver?.phone;
  const body =
    `Harvey Taxi mission available. ` +
    `Pickup: ${clean(ride?.pickup_address)}. ` +
    `Dropoff: ${clean(ride?.dropoff_address)}. ` +
    `Fare est: $${roundMoney(ride?.estimated_total || 0)}. ` +
    `Dispatch ID: ${clean(dispatch?.id)}.`;

  return sendSms({ to, body });
}

async function dispatchRideToBestDriver(rideId) {
  const ride = await getRideById(rideId);
  if (!ride) {
    return {
      ok: false,
      error: "Ride not found"
    };
  }

  const currentStatus = normalizeRideStatus(ride.status);
  if (!["awaiting_dispatch", "awaiting_driver_acceptance"].includes(currentStatus)) {
    return {
      ok: false,
      error: `Ride is not dispatchable from status ${currentStatus}`
    };
  }

  const activeDispatch = await getActiveDispatchForRide(ride.id);
  if (activeDispatch) {
    return {
      ok: true,
      reused: true,
      ride,
      dispatch: activeDispatch
    };
  }

  const attempts = await countDispatchAttemptsForRide(ride.id);
  if (attempts >= MAX_DISPATCH_ATTEMPTS) {
    const noDriverRide = await markRideNoDriverAvailable(ride.id);

    await logTripEvent({
      ride_id: ride.id,
      rider_id: ride.rider_id,
      driver_id: null,
      event_type: "dispatch_failed_max_attempts",
      details: {
        attempts,
        max_attempts: MAX_DISPATCH_ATTEMPTS
      }
    });

    return {
      ok: false,
      error: "No driver available after max dispatch attempts",
      ride: noDriverRide || ride
    };
  }

  const candidates = await getCandidateDriversForRide(ride);

  if (!candidates.length) {
    const noDriverRide = await markRideNoDriverAvailable(ride.id);

    await logTripEvent({
      ride_id: ride.id,
      rider_id: ride.rider_id,
      event_type: "dispatch_failed_no_candidates",
      details: {
        requested_mode: ride.requested_mode
      }
    });

    return {
      ok: false,
      error: "No eligible drivers available",
      ride: noDriverRide || ride
    };
  }

  const selected = candidates[0];
  const mission = await createMissionForRide(ride, selected.driver, {
    score: selected.scoring.score,
    distance_miles_to_pickup: selected.scoring.distance_miles_to_pickup
  });

  const dispatch = await createDispatchForRide(ride, selected.driver, selected.scoring);
  const updatedRide = await assignDriverToRide(ride, selected.driver, dispatch, mission);

  await logTripEvent({
    ride_id: updatedRide.id,
    rider_id: updatedRide.rider_id,
    driver_id: selected.driver.id,
    mission_id: mission.id,
    event_type: "dispatch_offered",
    details: {
      dispatch_id: dispatch.id,
      attempt_number: dispatch.attempt_number,
      expires_at: dispatch.expires_at,
      score: selected.scoring.score,
      distance_miles_to_pickup: selected.scoring.distance_miles_to_pickup
    }
  });

  await notifyDriverOfMission(selected.driver, updatedRide, dispatch);

  return {
    ok: true,
    ride: updatedRide,
    driver: selected.driver,
    mission,
    dispatch,
    scoring: selected.scoring
  };
}

/* =========================================================
   DRIVER ROUTES
========================================================= */
app.post("/api/driver/signup", asyncHandler(async (req, res) => {
  const firstName = clean(req.body.first_name || req.body.firstName);
  const lastName = clean(req.body.last_name || req.body.lastName);
  const email = lower(req.body.email);
  const phone = normalizePhone(req.body.phone);
  const driverType = normalizeDriverType(
    req.body.driver_type || req.body.driverType || "human"
  );

  if (!firstName) return fail(res, "First name is required");
  if (!lastName) return fail(res, "Last name is required");
  if (!email || !isEmail(email)) return fail(res, "Valid email is required");
  if (!phone) return fail(res, "Valid phone number is required");

  const existingByEmail = await getDriverByEmail(email);
  if (existingByEmail) {
    return ok(res, {
      message: "Driver already exists",
      driver: existingByEmail
    });
  }

  const existingByPhone = await getDriverByPhone(phone);
  if (existingByPhone) {
    return ok(res, {
      message: "Driver already exists",
      driver: existingByPhone
    });
  }

  const driver = await insertRow("drivers", {
    id: createId("driver"),
    first_name: firstName,
    last_name: lastName,
    full_name: `${firstName} ${lastName}`.trim(),
    email,
    phone,
    driver_type: driverType,
    status: "pending",
    approval_status: "pending",
    verification_status: "pending",
    email_verified: false,
    sms_verified: false,
    is_online: false,
    availability_status: "offline",
    created_at: nowIso(),
    updated_at: nowIso()
  });

  await logAdminEvent({
    event_type: "driver_signup_created",
    target_table: "drivers",
    target_id: driver.id,
    details: {
      email,
      phone,
      driver_type: driverType
    }
  });

  return ok(res, {
    message: "Driver signup submitted successfully",
    driver
  }, 201);
}));

app.post("/api/driver/status", asyncHandler(async (req, res) => {
  const driver = await resolveDriverFromRequest(req.body);
  if (!driver) return fail(res, "Driver not found", 404);

  return ok(res, {
    driver: {
      ...driver,
      is_verified: driverIsVerified(driver),
      is_approved: driverIsApproved(driver),
      is_online: driverIsOnline(driver)
    }
  });
}));

app.get("/api/driver/:driverId/status", asyncHandler(async (req, res) => {
  const driver = await getDriverById(req.params.driverId);
  if (!driver) return fail(res, "Driver not found", 404);

  return ok(res, {
    driver: {
      ...driver,
      is_verified: driverIsVerified(driver),
      is_approved: driverIsApproved(driver),
      is_online: driverIsOnline(driver)
    }
  });
}));

app.post("/api/driver/go-online", asyncHandler(async (req, res) => {
  const driver = await resolveDriverFromRequest(req.body);
  if (!driver) return fail(res, "Driver not found", 404);

  if (!driverIsApproved(driver)) {
    return fail(res, "Driver is not approved", 403);
  }

  if (!driverIsVerified(driver)) {
    return fail(res, "Driver email and SMS verification are required", 403);
  }

  const updated = await updateRows(
    "drivers",
    { id: driver.id },
    {
      is_online: true,
      availability_status: "online",
      updated_at: nowIso()
    }
  );

  return ok(res, {
    message: "Driver is now online",
    driver: updated?.[0] || driver
  });
}));

app.post("/api/driver/go-offline", asyncHandler(async (req, res) => {
  const driver = await resolveDriverFromRequest(req.body);
  if (!driver) return fail(res, "Driver not found", 404);

  const updated = await updateRows(
    "drivers",
    { id: driver.id },
    {
      is_online: false,
      availability_status: "offline",
      updated_at: nowIso()
    }
  );

  return ok(res, {
    message: "Driver is now offline",
    driver: updated?.[0] || driver
  });
}));

app.post("/api/driver/location", asyncHandler(async (req, res) => {
  const driver = await resolveDriverFromRequest(req.body);
  if (!driver) return fail(res, "Driver not found", 404);

  const latitude = parseNullableNumber(
    req.body.latitude ?? req.body.current_latitude ?? req.body.lat
  );
  const longitude = parseNullableNumber(
    req.body.longitude ?? req.body.current_longitude ?? req.body.lng
  );

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return fail(res, "Valid latitude and longitude are required");
  }

  const updated = await updateRows(
    "drivers",
    { id: driver.id },
    {
      current_latitude: latitude,
      current_longitude: longitude,
      last_location_at: nowIso(),
      updated_at: nowIso()
    }
  );

  return ok(res, {
    message: "Driver location updated",
    driver: updated?.[0] || driver
  });
}));

/* =========================================================
   DISPATCH ROUTES
========================================================= */
app.post("/api/dispatch/start", asyncHandler(async (req, res) => {
  const rideId = pickFirst(req.body.ride_id, req.body.rideId);
  if (!rideId) return fail(res, "Ride ID is required");

  const result = await dispatchRideToBestDriver(rideId);

  if (!result.ok) {
    return fail(res, result.error || "Dispatch failed", 400, {
      ride: result.ride || null
    });
  }

  return ok(res, {
    message: result.reused
      ? "Existing active dispatch found"
      : "Dispatch offer sent to best driver",
    ride: result.ride,
    dispatch: result.dispatch,
    mission: result.mission || null,
    driver: result.driver
      ? {
          id: result.driver.id,
          full_name: getDriverDisplayName(result.driver),
          driver_type: normalizeDriverType(result.driver.driver_type || "human")
        }
      : null,
    scoring: result.scoring || null
  });
}));

app.get("/api/rides/:rideId/dispatch", asyncHandler(async (req, res) => {
  const ride = await getRideById(req.params.rideId);
  if (!ride) return fail(res, "Ride not found", 404);

  const dispatch = await getActiveDispatchForRide(ride.id);
  const mission = await getMissionByRideId(ride.id);

  return ok(res, {
    ride,
    dispatch,
    mission
  });
}));

/* =========================================================
   DRIVER MISSION ROUTES
========================================================= */
app.get("/api/driver/:driverId/current-mission", asyncHandler(async (req, res) => {
  const driverId = clean(req.params.driverId);
  if (!driverId) return fail(res, "Driver ID is required");

  const { data, error } = await requireSupabase()
    .from("missions")
    .select("*")
    .eq("driver_id", driverId)
    .in("status", [
      "offered",
      "accepted",
      "driver_en_route",
      "arrived",
      "in_progress"
    ])
    .order("updated_at", { ascending: false })
    .limit(1);

  if (error) throw error;

  const mission = data?.[0] || null;
  if (!mission) {
    return ok(res, { mission: null });
  }

  const ride = await getRideById(mission.ride_id);

  return ok(res, {
    mission,
    ride
  });
}));

app.get("/api/driver/:driverId/missions", asyncHandler(async (req, res) => {
  const driverId = clean(req.params.driverId);
  if (!driverId) return fail(res, "Driver ID is required");

  const { data, error } = await requireSupabase()
    .from("missions")
    .select("*")
    .eq("driver_id", driverId)
    .order("created_at", { ascending: false });

  if (error) throw error;

  return ok(res, {
    missions: data || []
  });
}));

/* =========================================================
   ACCEPT / DECLINE ROUTES
========================================================= */
app.post("/api/mission/accept", asyncHandler(async (req, res) => {
  const driver = await resolveDriverFromRequest(req.body);
  if (!driver) return fail(res, "Driver not found", 404);

  const dispatchId = pickFirst(req.body.dispatch_id, req.body.dispatchId);
  const missionId = pickFirst(req.body.mission_id, req.body.missionId);

  let dispatch = dispatchId ? await getDispatchById(dispatchId) : null;
  let mission = missionId ? await getMissionById(missionId) : null;

  if (!dispatch && mission?.ride_id) {
    dispatch = await getActiveDispatchForRide(mission.ride_id);
  }
  if (!mission && dispatch?.ride_id) {
    mission = await getMissionByRideId(dispatch.ride_id);
  }

  if (!dispatch) return fail(res, "Dispatch not found", 404);
  if (!mission) return fail(res, "Mission not found", 404);

  if (clean(dispatch.driver_id) !== clean(driver.id)) {
    return fail(res, "This dispatch is not assigned to this driver", 403);
  }

  if (clean(mission.driver_id) !== clean(driver.id)) {
    return fail(res, "This mission is not assigned to this driver", 403);
  }

  if (new Date(dispatch.expires_at).getTime() < Date.now()) {
    await expireDispatch(dispatch, "accepted_after_expiry");
    await markMissionExpired(mission.id, "accepted_after_expiry");
    await moveRideBackToDispatchQueue(dispatch.ride_id);

    return fail(res, "Dispatch has expired", 410);
  }

  const ride = await getRideById(dispatch.ride_id);
  if (!ride) return fail(res, "Ride not found", 404);

  const updatedDispatch = await updateRows(
    "dispatches",
    { id: dispatch.id },
    {
      status: "accepted",
      dispatch_status: "accepted",
      accepted_at: nowIso(),
      updated_at: nowIso()
    }
  );

  const updatedMission = await updateRows(
    "missions",
    { id: mission.id },
    {
      status: "accepted",
      mission_status: "accepted",
      accepted_at: nowIso(),
      updated_at: nowIso()
    }
  );

  const updatedRide = await updateRows(
    "rides",
    { id: ride.id },
    {
      driver_id: driver.id,
      mission_id: mission.id,
      dispatch_id: dispatch.id,
      status: "dispatched",
      updated_at: nowIso()
    }
  );

  await logTripEvent({
    ride_id: ride.id,
    rider_id: ride.rider_id,
    driver_id: driver.id,
    mission_id: mission.id,
    event_type: "driver_accepted_dispatch",
    details: {
      dispatch_id: dispatch.id
    }
  });

  return ok(res, {
    message: "Mission accepted",
    dispatch: updatedDispatch?.[0] || dispatch,
    mission: updatedMission?.[0] || mission,
    ride: updatedRide?.[0] || ride
  });
}));

app.post("/api/mission/decline", asyncHandler(async (req, res) => {
  const driver = await resolveDriverFromRequest(req.body);
  if (!driver) return fail(res, "Driver not found", 404);

  const dispatchId = pickFirst(req.body.dispatch_id, req.body.dispatchId);
  const missionId = pickFirst(req.body.mission_id, req.body.missionId);
  const reason = clean(req.body.reason || "driver_declined");

  let dispatch = dispatchId ? await getDispatchById(dispatchId) : null;
  let mission = missionId ? await getMissionById(missionId) : null;

  if (!dispatch && mission?.ride_id) {
    dispatch = await getActiveDispatchForRide(mission.ride_id);
  }
  if (!mission && dispatch?.ride_id) {
    mission = await getMissionByRideId(dispatch.ride_id);
  }

  if (!dispatch) return fail(res, "Dispatch not found", 404);
  if (!mission) return fail(res, "Mission not found", 404);

  if (clean(dispatch.driver_id) !== clean(driver.id)) {
    return fail(res, "This dispatch is not assigned to this driver", 403);
  }

  await rejectDispatch(dispatch, reason);
  await markMissionDeclined(mission.id, reason);
  const queuedRide = await moveRideBackToDispatchQueue(dispatch.ride_id);

  await logTripEvent({
    ride_id: dispatch.ride_id,
    rider_id: queuedRide?.rider_id,
    driver_id: driver.id,
    mission_id: mission.id,
    event_type: "driver_declined_dispatch",
    details: {
      dispatch_id: dispatch.id,
      reason
    }
  });

  let redispatchResult = null;
  if (ENABLE_AUTO_REDISPATCH) {
    redispatchResult = await dispatchRideToBestDriver(dispatch.ride_id);
  }

  return ok(res, {
    message: ENABLE_AUTO_REDISPATCH
      ? "Mission declined and redispatch attempted"
      : "Mission declined",
    ride: queuedRide,
    redispatch: redispatchResult
  });
}));

/* =========================================================
   RIDE STATUS LIFECYCLE
========================================================= */
app.post("/api/mission/en-route", asyncHandler(async (req, res) => {
  const driver = await resolveDriverFromRequest(req.body);
  if (!driver) return fail(res, "Driver not found", 404);

  const missionId = pickFirst(req.body.mission_id, req.body.missionId);
  if (!missionId) return fail(res, "Mission ID is required");

  const mission = await getMissionById(missionId);
  if (!mission) return fail(res, "Mission not found", 404);
  if (clean(mission.driver_id) !== clean(driver.id)) {
    return fail(res, "Mission does not belong to this driver", 403);
  }

  const ride = await getRideById(mission.ride_id);
  if (!ride) return fail(res, "Ride not found", 404);

  const updatedMission = await updateRows(
    "missions",
    { id: mission.id },
    {
      status: "driver_en_route",
      mission_status: "driver_en_route",
      updated_at: nowIso()
    }
  );

  const updatedRide = await updateRows(
    "rides",
    { id: ride.id },
    {
      status: "driver_en_route",
      updated_at: nowIso()
    }
  );

  await logTripEvent({
    ride_id: ride.id,
    rider_id: ride.rider_id,
    driver_id: driver.id,
    mission_id: mission.id,
    event_type: "driver_en_route",
    details: {}
  });

  return ok(res, {
    message: "Driver marked en route",
    mission: updatedMission?.[0] || mission,
    ride: updatedRide?.[0] || ride
  });
}));

app.post("/api/mission/arrived", asyncHandler(async (req, res) => {
  const driver = await resolveDriverFromRequest(req.body);
  if (!driver) return fail(res, "Driver not found", 404);

  const missionId = pickFirst(req.body.mission_id, req.body.missionId);
  if (!missionId) return fail(res, "Mission ID is required");

  const mission = await getMissionById(missionId);
  if (!mission) return fail(res, "Mission not found", 404);

  const ride = await getRideById(mission.ride_id);
  if (!ride) return fail(res, "Ride not found", 404);

  const updatedMission = await updateRows(
    "missions",
    { id: mission.id },
    {
      status: "arrived",
      mission_status: "arrived",
      updated_at: nowIso()
    }
  );

  const updatedRide = await updateRows(
    "rides",
    { id: ride.id },
    {
      status: "arrived",
      updated_at: nowIso()
    }
  );

  await logTripEvent({
    ride_id: ride.id,
    rider_id: ride.rider_id,
    driver_id: mission.driver_id,
    mission_id: mission.id,
    event_type: "driver_arrived",
    details: {}
  });

  return ok(res, {
    message: "Driver marked arrived",
    mission: updatedMission?.[0] || mission,
    ride: updatedRide?.[0] || ride
  });
}));

app.post("/api/mission/start-trip", asyncHandler(async (req, res) => {
  const driver = await resolveDriverFromRequest(req.body);
  if (!driver) return fail(res, "Driver not found", 404);

  const missionId = pickFirst(req.body.mission_id, req.body.missionId);
  if (!missionId) return fail(res, "Mission ID is required");

  const mission = await getMissionById(missionId);
  if (!mission) return fail(res, "Mission not found", 404);

  const ride = await getRideById(mission.ride_id);
  if (!ride) return fail(res, "Ride not found", 404);

  const updatedMission = await updateRows(
    "missions",
    { id: mission.id },
    {
      status: "in_progress",
      mission_status: "in_progress",
      started_at: nowIso(),
      updated_at: nowIso()
    }
  );

  const updatedRide = await updateRows(
    "rides",
    { id: ride.id },
    {
      status: "in_progress",
      started_at: nowIso(),
      updated_at: nowIso()
    }
  );

  await logTripEvent({
    ride_id: ride.id,
    rider_id: ride.rider_id,
    driver_id: mission.driver_id,
    mission_id: mission.id,
    event_type: "trip_started",
    details: {}
  });

  return ok(res, {
    message: "Trip started",
    mission: updatedMission?.[0] || mission,
    ride: updatedRide?.[0] || ride
  });
}));

app.post("/api/mission/complete", asyncHandler(async (req, res) => {
  const driver = await resolveDriverFromRequest(req.body);
  if (!driver) return fail(res, "Driver not found", 404);

  const missionId = pickFirst(req.body.mission_id, req.body.missionId);
  if (!missionId) return fail(res, "Mission ID is required");

  const mission = await getMissionById(missionId);
  if (!mission) return fail(res, "Mission not found", 404);

  const ride = await getRideById(mission.ride_id);
  if (!ride) return fail(res, "Ride not found", 404);

  const updatedMission = await updateRows(
    "missions",
    { id: mission.id },
    {
      status: "completed",
      mission_status: "completed",
      completed_at: nowIso(),
      updated_at: nowIso()
    }
  );

  const updatedRide = await updateRows(
    "rides",
    { id: ride.id },
    {
      status: "completed",
      completed_at: nowIso(),
      updated_at: nowIso()
    }
  );

  await logTripEvent({
    ride_id: ride.id,
    rider_id: ride.rider_id,
    driver_id: mission.driver_id,
    mission_id: mission.id,
    event_type: "trip_completed",
    details: {
      final_estimated_total: ride.estimated_total
    }
  });

  return ok(res, {
    message: "Trip completed",
    mission: updatedMission?.[0] || mission,
    ride: updatedRide?.[0] || ride
  });
}));

/* =========================================================
   DISPATCH EXPIRY SWEEP
========================================================= */
async function sweepExpiredDispatches() {
  runtimeState.dispatchSweep.lastRanAt = nowIso();

  const { data, error } = await requireSupabase()
    .from("dispatches")
    .select("*")
    .in("status", ["offered", "awaiting_driver_acceptance"])
    .lte("expires_at", nowIso())
    .order("created_at", { ascending: true });

  if (error) throw error;

  const expiredDispatches = data || [];
  const results = [];

  for (const dispatch of expiredDispatches) {
    const expired = await expireDispatch(dispatch, "timeout");

    const mission = await getMissionByRideId(dispatch.ride_id);
    if (mission && clean(mission.driver_id) === clean(dispatch.driver_id)) {
      await markMissionExpired(mission.id, "timeout");
    }

    const queuedRide = await moveRideBackToDispatchQueue(dispatch.ride_id);

    await logTripEvent({
      ride_id: dispatch.ride_id,
      rider_id: dispatch.rider_id,
      driver_id: dispatch.driver_id,
      mission_id: mission?.id || null,
      event_type: "dispatch_expired",
      details: {
        dispatch_id: dispatch.id,
        attempt_number: dispatch.attempt_number
      }
    });

    let redispatch = null;
    if (ENABLE_AUTO_REDISPATCH) {
      redispatch = await dispatchRideToBestDriver(dispatch.ride_id);
    }

    results.push({
      expired_dispatch_id: expired?.id || dispatch.id,
      ride_id: dispatch.ride_id,
      redispatch_ok: !!redispatch?.ok
    });

    await sleep(25);

    if (!queuedRide && !redispatch?.ok) {
      await markRideNoDriverAvailable(dispatch.ride_id);
    }
  }

  return {
    ok: true,
    count: results.length,
    results
  };
}

if (ENABLE_AUTO_REDISPATCH) {
  setInterval(async () => {
    try {
      const sweepResult = await sweepExpiredDispatches();
      runtimeState.dispatchSweep.lastError = null;

      if (sweepResult.count > 0) {
        console.log(`🔁 Dispatch sweep expired ${sweepResult.count} dispatch(es)`);
      }
    } catch (error) {
      runtimeState.dispatchSweep.lastError = clean(error?.message || String(error));
      console.error("❌ Dispatch sweep failed:", error);
    }
  }, DISPATCH_SWEEP_INTERVAL_MS);
}

/* =========================================================
   ADMIN DISPATCH ROUTES
========================================================= */
app.post("/api/admin/dispatch/retry", requireAdmin, asyncHandler(async (req, res) => {
  const rideId = pickFirst(req.body.ride_id, req.body.rideId);
  if (!rideId) return fail(res, "Ride ID is required");

  const result = await dispatchRideToBestDriver(rideId);

  await logAdminEvent({
    event_type: "admin_dispatch_retry",
    target_table: "rides",
    target_id: rideId,
    details: {
      ok: !!result.ok,
      error: result.error || null
    }
  });

  if (!result.ok) {
    return fail(res, result.error || "Dispatch retry failed", 400, {
      ride: result.ride || null
    });
  }

  return ok(res, {
    message: "Dispatch retry successful",
    result
  });
}));

app.get("/api/admin/dispatch/state", requireAdmin, asyncHandler(async (req, res) => {
  return ok(res, {
    dispatch_sweep: runtimeState.dispatchSweep,
    config: {
      dispatch_timeout_seconds: DISPATCH_TIMEOUT_SECONDS,
      dispatch_sweep_interval_ms: DISPATCH_SWEEP_INTERVAL_MS,
      max_dispatch_attempts: MAX_DISPATCH_ATTEMPTS,
      auto_redispatch_enabled: ENABLE_AUTO_REDISPATCH
    }
  });
}));/* =========================================================
   PART 4: LIVE STATUS + PAYMENTS + TIPPING + EARNINGS + ADMIN + AI
========================================================= */

/* =========================================================
   PAYMENT / LEDGER HELPERS
========================================================= */
async function getPaymentById(paymentId) {
  const id = clean(paymentId);
  if (!id) return null;
  return getRowById("payments", "id", id);
}

async function getLatestPaymentForRide(rideId) {
  const id = clean(rideId);
  if (!id) return null;

  const { data, error } = await requireSupabase()
    .from("payments")
    .select("*")
    .eq("ride_id", id)
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) throw error;
  return data?.[0] || null;
}

async function createDriverEarningEntry({
  driver_id,
  ride_id,
  mission_id = null,
  gross_fare = 0,
  tip_amount = 0,
  payout_amount = 0,
  platform_fee = 0,
  status = "pending"
}) {
  try {
    const payload = {
      id: createId("earn"),
      driver_id: clean(driver_id),
      ride_id: clean(ride_id),
      mission_id: clean(mission_id) || null,
      gross_fare: roundMoney(gross_fare),
      tip_amount: roundMoney(tip_amount),
      payout_amount: roundMoney(payout_amount),
      platform_fee: roundMoney(platform_fee),
      status: clean(status || "pending"),
      created_at: nowIso(),
      updated_at: nowIso()
    };

    const { data, error } = await requireSupabase()
      .from("driver_earnings")
      .insert(payload)
      .select()
      .limit(1);

    if (error) {
      console.warn("⚠️ Failed to create driver earnings entry:", error.message);
      return null;
    }

    return data?.[0] || null;
  } catch (error) {
    console.warn("⚠️ Driver earnings insert skipped:", error.message);
    return null;
  }
}

async function getDriverEarnings(driverId) {
  const { data, error } = await requireSupabase()
    .from("driver_earnings")
    .select("*")
    .eq("driver_id", clean(driverId))
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data || [];
}

async function updateRideFinancials(rideId, patch = {}) {
  const updates = {
    ...patch,
    updated_at: nowIso()
  };

  const updated = await updateRows("rides", { id: clean(rideId) }, updates);
  return updated?.[0] || null;
}

function getRideBaseFareAmount(ride) {
  return roundMoney(
    ride?.final_total ||
      ride?.estimated_total ||
      ride?.captured_amount ||
      0
  );
}

function getRideTipAmount(ride) {
  return roundMoney(ride?.tip_amount || 0);
}

/* =========================================================
   LIVE STATUS HELPERS
========================================================= */
async function getRideTimeline(rideId) {
  try {
    const { data, error } = await requireSupabase()
      .from("trip_events")
      .select("*")
      .eq("ride_id", clean(rideId))
      .order("created_at", { ascending: true });

    if (error) throw error;
    return data || [];
  } catch (error) {
    console.warn("⚠️ Could not fetch ride timeline:", error.message);
    return [];
  }
}

async function buildRideLiveState(rideId) {
  const ride = await getRideById(rideId);
  if (!ride) return null;

  const mission = ride.mission_id
    ? await getMissionById(ride.mission_id)
    : await getMissionByRideId(ride.id);

  const dispatch = ride.dispatch_id
    ? await getDispatchById(ride.dispatch_id)
    : await getActiveDispatchForRide(ride.id);

  const driver = ride.driver_id ? await getDriverById(ride.driver_id) : null;
  const payment =
    (await getLatestPaymentForRide(ride.id)) ||
    (await getLatestPaymentForRider(ride.rider_id));

  const timeline = await getRideTimeline(ride.id);

  return {
    ride,
    mission,
    dispatch,
    driver: driver
      ? {
          id: driver.id,
          full_name: getDriverDisplayName(driver),
          driver_type: normalizeDriverType(driver.driver_type || "human"),
          phone: clean(driver.phone || ""),
          current_latitude: getDriverLatitude(driver),
          current_longitude: getDriverLongitude(driver),
          last_location_at: clean(driver.last_location_at || "")
        }
      : null,
    payment: buildPaymentSummary(payment),
    timeline
  };
}

/* =========================================================
   PAGE / AI HELPERS
========================================================= */
function normalizePage(page = "") {
  const value = lower(page);

  if (!value) return "general";
  if (["home", "index", "landing"].includes(value)) return "general";
  if (["rider", "rider-signup", "rider-dashboard"].includes(value)) return "rider";
  if (["driver", "driver-signup", "driver-dashboard"].includes(value)) return "driver";
  if (["request", "request-ride", "ride"].includes(value)) return "request";
  if (["support", "help", "faq"].includes(value)) return "support";
  if (["admin", "admin-dashboard"].includes(value)) return "admin";

  return value;
}

function getFallbackReply(message = "", page = "general") {
  const text = lower(message);
  const normalizedPage = normalizePage(page);

  if (!text) {
    return "Welcome to Harvey Taxi support. I can help with rider approval, driver onboarding, ride requests, payment authorization, trip status, dispatch, and autonomous pilot questions.";
  }

  if (text.includes("emergency") || text.includes("911")) {
    return "Harvey Taxi is not an emergency service. If this is an emergency, call 911 immediately.";
  }

  if (text.includes("rider") || normalizedPage === "rider") {
    if (text.includes("approved") || text.includes("approval") || text.includes("verify")) {
      return "Riders must be approved before they can request a ride. Use the rider status check to confirm whether the account is approved.";
    }
    if (text.includes("payment")) {
      return "Harvey Taxi uses payment authorization before dispatch so the ride can move forward smoothly once a driver is assigned.";
    }
    return "I can help riders with signup, approval status, payment authorization, live ride tracking, and trip questions.";
  }

  if (text.includes("driver") || normalizedPage === "driver") {
    if (text.includes("signup") || text.includes("join")) {
      return "Drivers complete signup, then email and SMS verification, then approval before going online and accepting missions.";
    }
    if (text.includes("mission") || text.includes("accept")) {
      return "Drivers can review the mission details before accepting. If a mission expires or is declined, the system can automatically redispatch it.";
    }
    return "I can help drivers with onboarding, verification, going online, receiving missions, trip updates, and earnings.";
  }

  if (text.includes("payment") || text.includes("authorize") || text.includes("card")) {
    return "Harvey Taxi authorizes payment before dispatch, captures payment when the trip is completed, and supports tipping during or after the trip.";
  }

  if (text.includes("autonomous") || text.includes("pilot") || text.includes("av")) {
    return "Autonomous service is currently treated as a pilot mode. It is clearly labeled so riders understand when they are requesting a driver versus autonomous service.";
  }

  if (text.includes("ride") || text.includes("trip") || normalizedPage === "request") {
    return "To request a ride, the rider must be approved first, then payment must be authorized, then the request can enter dispatch and be offered to an eligible driver.";
  }

  return "I can help with Harvey Taxi rider signup, driver onboarding, payment authorization, ride dispatch, trip tracking, support questions, and autonomous pilot information.";
}

async function generateAiSupportReply({
  message,
  page = "general",
  rider_id = "",
  driver_id = "",
  ride_id = ""
}) {
  const fallback = getFallbackReply(message, page);

  if (!openai || !ENABLE_AI_BRAIN) {
    return {
      reply: fallback,
      source: "fallback"
    };
  }

  let rideContext = null;
  if (ride_id) {
    try {
      rideContext = await buildRideLiveState(ride_id);
    } catch (error) {
      console.warn("⚠️ AI ride context load failed:", error.message);
    }
  }

  const systemPrompt = `
You are Harvey Taxi AI Support for Harvey Taxi Service LLC and Harvey Assistance Foundation.
Your tone is calm, clear, professional, and helpful.
Never invent policies.
Always explain that:
- Riders must be approved before requesting rides.
- Payment authorization is required before dispatch when enabled.
- Drivers must complete signup, verification, and approval before going online.
- Harvey Taxi is not an emergency service; tell users to call 911 for emergencies.
- Autonomous service is pilot mode when referenced.
Keep answers concise but useful.
If the user asks about a live ride and ride context is available, use it.
If something is missing, say so plainly.
`.trim();

  const contextPrompt = `
Page: ${normalizePage(page)}
Rider ID: ${clean(rider_id) || "N/A"}
Driver ID: ${clean(driver_id) || "N/A"}
Ride ID: ${clean(ride_id) || "N/A"}
Ride Context JSON:
${JSON.stringify(rideContext || {}, null, 2)}
User Message:
${clean(message)}
`.trim();

  try {
    const response = await openai.responses.create({
      model: OPENAI_SUPPORT_MODEL,
      input: [
        {
          role: "system",
          content: systemPrompt
        },
        {
          role: "user",
          content: contextPrompt
        }
      ]
    });

    const reply = clean(response?.output_text || "") || fallback;

    return {
      reply,
      source: "openai"
    };
  } catch (error) {
    console.warn("⚠️ OpenAI support failed:", error.message);
    return {
      reply: fallback,
      source: "fallback"
    };
  }
}

/* =========================================================
   LIVE RIDE STATUS ROUTES
========================================================= */
app.get("/api/rides/:rideId/live", asyncHandler(async (req, res) => {
  const liveState = await buildRideLiveState(req.params.rideId);

  if (!liveState) {
    return fail(res, "Ride not found", 404);
  }

  return ok(res, liveState);
}));

app.post("/api/rides/live-status", asyncHandler(async (req, res) => {
  const rideId = pickFirst(req.body.ride_id, req.body.rideId);
  if (!rideId) return fail(res, "Ride ID is required");

  const liveState = await buildRideLiveState(rideId);

  if (!liveState) {
    return fail(res, "Ride not found", 404);
  }

  return ok(res, liveState);
}));

app.get("/api/driver/:driverId/current-ride", asyncHandler(async (req, res) => {
  const driverId = clean(req.params.driverId);
  if (!driverId) return fail(res, "Driver ID is required");

  const { data, error } = await requireSupabase()
    .from("rides")
    .select("*")
    .eq("driver_id", driverId)
    .in("status", [
      "awaiting_driver_acceptance",
      "dispatched",
      "driver_en_route",
      "arrived",
      "in_progress"
    ])
    .order("updated_at", { ascending: false })
    .limit(1);

  if (error) throw error;

  const ride = data?.[0] || null;
  if (!ride) {
    return ok(res, { ride: null });
  }

  const liveState = await buildRideLiveState(ride.id);
  return ok(res, liveState || { ride });
}));

/* =========================================================
   PAYMENT CAPTURE / RELEASE ROUTES
========================================================= */
app.post("/api/payments/capture", asyncHandler(async (req, res) => {
  const rideId = pickFirst(req.body.ride_id, req.body.rideId);
  if (!rideId) return fail(res, "Ride ID is required");

  const ride = await getRideById(rideId);
  if (!ride) return fail(res, "Ride not found", 404);

  const payment =
    (await getLatestPaymentForRide(ride.id)) ||
    (await getLatestPaymentForRider(ride.rider_id));

  if (!payment) {
    return fail(res, "No payment authorization found", 404);
  }

  if (!paymentIsAuthorized(payment)) {
    return fail(res, "Payment is not authorized for capture", 400, {
      payment: buildPaymentSummary(payment)
    });
  }

  const tipAmount = normalizeTipAmount(
    req.body.tip_amount ?? req.body.tipAmount ?? ride.tip_amount ?? 0
  );

  const baseAmount = roundMoney(
    toNumber(req.body.amount, ride.estimated_total || payment.authorization_amount || 0)
  );

  const captureAmount = roundMoney(baseAmount + tipAmount);

  const updatedPayments = await updateRows(
    "payments",
    { id: payment.id },
    {
      ride_id: ride.id,
      status: "captured",
      payment_status: "captured",
      captured_amount: captureAmount,
      tip_amount: tipAmount,
      captured_at: nowIso(),
      updated_at: nowIso()
    }
  );

  const payoutBase = calculateDriverPayout(
    baseAmount,
    ride.requested_mode === "autonomous" ? "autonomous" : "human"
  );

  const finalDriverPayout = roundMoney(
    payoutBase.driver_payout_estimate + tipAmount
  );

  const finalPlatformFee = roundMoney(captureAmount - finalDriverPayout);

  const updatedRide = await updateRideFinancials(ride.id, {
    payment_id: payment.id,
    final_total: captureAmount,
    captured_amount: captureAmount,
    tip_amount: tipAmount,
    estimated_driver_payout: finalDriverPayout,
    estimated_platform_fee: finalPlatformFee,
    payment_status: "captured"
  });

  if (ride.driver_id) {
    await createDriverEarningEntry({
      driver_id: ride.driver_id,
      ride_id: ride.id,
      mission_id: ride.mission_id,
      gross_fare: baseAmount,
      tip_amount: tipAmount,
      payout_amount: finalDriverPayout,
      platform_fee: finalPlatformFee,
      status: "earned"
    });
  }

  await logTripEvent({
    ride_id: ride.id,
    rider_id: ride.rider_id,
    driver_id: ride.driver_id,
    mission_id: ride.mission_id,
    event_type: "payment_captured",
    details: {
      payment_id: payment.id,
      capture_amount: captureAmount,
      tip_amount: tipAmount
    }
  });

  return ok(res, {
    message: "Payment captured successfully",
    payment: buildPaymentSummary(updatedPayments?.[0] || payment),
    ride: updatedRide || ride,
    financials: {
      base_amount: baseAmount,
      tip_amount: tipAmount,
      capture_amount: captureAmount,
      driver_payout: finalDriverPayout,
      platform_fee: finalPlatformFee
    }
  });
}));

app.post("/api/payments/release", asyncHandler(async (req, res) => {
  const paymentId = pickFirst(req.body.payment_id, req.body.paymentId);
  const rideId = pickFirst(req.body.ride_id, req.body.rideId);

  let payment = paymentId ? await getPaymentById(paymentId) : null;
  let ride = rideId ? await getRideById(rideId) : null;

  if (!payment && ride) {
    payment =
      (await getLatestPaymentForRide(ride.id)) ||
      (await getLatestPaymentForRider(ride.rider_id));
  }

  if (!payment) return fail(res, "Payment not found", 404);

  const updatedPayments = await updateRows(
    "payments",
    { id: payment.id },
    {
      status: "released",
      payment_status: "released",
      released_at: nowIso(),
      updated_at: nowIso()
    }
  );

  if (!ride && payment.ride_id) {
    ride = await getRideById(payment.ride_id);
  }

  if (ride) {
    await updateRideFinancials(ride.id, {
      payment_status: "released"
    });

    await logTripEvent({
      ride_id: ride.id,
      rider_id: ride.rider_id,
      driver_id: ride.driver_id,
      mission_id: ride.mission_id,
      event_type: "payment_released",
      details: {
        payment_id: payment.id
      }
    });
  }

  return ok(res, {
    message: "Payment released successfully",
    payment: updatedPayments?.[0] || payment,
    ride: ride || null
  });
}));

/* =========================================================
   TIPPING ROUTES
========================================================= */
app.post("/api/rides/:rideId/tip", asyncHandler(async (req, res) => {
  const ride = await getRideById(req.params.rideId);
  if (!ride) return fail(res, "Ride not found", 404);

  const tipAmount = normalizeTipAmount(
    req.body.tip_amount ?? req.body.tipAmount
  );

  if (!tipAmount) {
    return fail(res, "Valid tip amount is required");
  }

  const currentTip = getRideTipAmount(ride);
  const newTipTotal = roundMoney(currentTip + tipAmount);

  const baseFare = getRideBaseFareAmount(ride);
  const payoutBase = calculateDriverPayout(
    baseFare,
    ride.requested_mode === "autonomous" ? "autonomous" : "human"
  );

  const newDriverPayout = roundMoney(payoutBase.driver_payout_estimate + newTipTotal);
  const newFinalTotal = roundMoney(baseFare + newTipTotal);
  const newPlatformFee = roundMoney(newFinalTotal - newDriverPayout);

  const updatedRide = await updateRideFinancials(ride.id, {
    tip_amount: newTipTotal,
    final_total: newFinalTotal,
    estimated_driver_payout: newDriverPayout,
    estimated_platform_fee: newPlatformFee
  });

  const payment =
    (await getLatestPaymentForRide(ride.id)) ||
    (await getLatestPaymentForRider(ride.rider_id));

  if (payment && normalizePaymentStatus(payment.status || payment.payment_status) === "captured") {
    await updateRows(
      "payments",
      { id: payment.id },
      {
        tip_amount: newTipTotal,
        captured_amount: newFinalTotal,
        updated_at: nowIso()
      }
    );
  }

  await logTripEvent({
    ride_id: ride.id,
    rider_id: ride.rider_id,
    driver_id: ride.driver_id,
    mission_id: ride.mission_id,
    event_type: "tip_added",
    details: {
      added_tip_amount: tipAmount,
      total_tip_amount: newTipTotal
    }
  });

  return ok(res, {
    message: "Tip added successfully",
    ride: updatedRide || ride,
    tip: {
      added_tip_amount: tipAmount,
      total_tip_amount: newTipTotal
    },
    totals: {
      base_fare: baseFare,
      final_total: newFinalTotal,
      driver_payout: newDriverPayout,
      platform_fee: newPlatformFee
    }
  });
}));

/* =========================================================
   DRIVER EARNINGS ROUTES
========================================================= */
app.get("/api/driver/:driverId/earnings", asyncHandler(async (req, res) => {
  const driver = await getDriverById(req.params.driverId);
  if (!driver) return fail(res, "Driver not found", 404);

  const earnings = await getDriverEarnings(driver.id);

  const totals = earnings.reduce(
    (acc, row) => {
      acc.gross_fare += Number(row.gross_fare || 0);
      acc.tip_amount += Number(row.tip_amount || 0);
      acc.payout_amount += Number(row.payout_amount || 0);
      acc.platform_fee += Number(row.platform_fee || 0);
      return acc;
    },
    {
      gross_fare: 0,
      tip_amount: 0,
      payout_amount: 0,
      platform_fee: 0
    }
  );

  return ok(res, {
    driver: {
      id: driver.id,
      full_name: getDriverDisplayName(driver),
      driver_type: normalizeDriverType(driver.driver_type || "human")
    },
    summary: {
      gross_fare: roundMoney(totals.gross_fare),
      tip_amount: roundMoney(totals.tip_amount),
      payout_amount: roundMoney(totals.payout_amount),
      platform_fee: roundMoney(totals.platform_fee)
    },
    earnings
  });
}));

/* =========================================================
   ADMIN ANALYTICS ROUTES
========================================================= */
app.get("/api/admin/analytics/overview", requireAdmin, asyncHandler(async (req, res) => {
  const db = requireSupabase();

  async function countTable(table, filters = null) {
    let query = db.from(table).select("*", { count: "exact", head: true });

    if (filters && Array.isArray(filters)) {
      for (const filter of filters) {
        if (filter.op === "eq") query = query.eq(filter.column, filter.value);
        if (filter.op === "in") query = query.in(filter.column, filter.value);
      }
    }

    const { count, error } = await query;
    if (error) throw error;
    return Number(count || 0);
  }

  const [
    totalRiders,
    approvedRiders,
    totalDrivers,
    approvedDrivers,
    onlineDrivers,
    totalRides,
    activeRides,
    completedRides,
    noDriverRides
  ] = await Promise.all([
    countTable("riders"),
    countTable("riders", [{ op: "in", column: "status", value: ["approved", "verified", "active"] }]),
    countTable("drivers"),
    countTable("drivers", [{ op: "in", column: "status", value: ["approved", "active"] }]),
    countTable("drivers", [{ op: "in", column: "availability_status", value: ["online", "available", "ready", "active"] }]),
    countTable("rides"),
    countTable("rides", [{ op: "in", column: "status", value: ["awaiting_driver_acceptance", "dispatched", "driver_en_route", "arrived", "in_progress"] }]),
    countTable("rides", [{ op: "eq", column: "status", value: "completed" }]),
    countTable("rides", [{ op: "eq", column: "status", value: "no_driver_available" }])
  ]);

  const { data: recentRides, error: recentRidesError } = await db
    .from("rides")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(50);

  if (recentRidesError) throw recentRidesError;

  const revenue = (recentRides || []).reduce(
    (acc, ride) => {
      acc.estimated_total += Number(ride.final_total || ride.estimated_total || 0);
      acc.driver_payout += Number(ride.estimated_driver_payout || 0);
      acc.platform_fee += Number(ride.estimated_platform_fee || 0);
      acc.tip_amount += Number(ride.tip_amount || 0);
      return acc;
    },
    {
      estimated_total: 0,
      driver_payout: 0,
      platform_fee: 0,
      tip_amount: 0
    }
  );

  return ok(res, {
    generated_at: nowIso(),
    counts: {
      riders: totalRiders,
      approved_riders: approvedRiders,
      drivers: totalDrivers,
      approved_drivers: approvedDrivers,
      online_drivers: onlineDrivers,
      rides: totalRides,
      active_rides: activeRides,
      completed_rides: completedRides,
      no_driver_available_rides: noDriverRides
    },
    financial_snapshot_recent: {
      total_volume: roundMoney(revenue.estimated_total),
      driver_payout: roundMoney(revenue.driver_payout),
      platform_fee: roundMoney(revenue.platform_fee),
      tip_amount: roundMoney(revenue.tip_amount)
    },
    dispatch: runtimeState.dispatchSweep
  });
}));

app.get("/api/admin/rides/recent", requireAdmin, asyncHandler(async (req, res) => {
  const limit = clamp(toNumber(req.query.limit, 25), 1, 100);

  const { data, error } = await requireSupabase()
    .from("rides")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;

  return ok(res, {
    rides: data || []
  });
}));

app.get("/api/admin/drivers/online", requireAdmin, asyncHandler(async (req, res) => {
  const { data, error } = await requireSupabase()
    .from("drivers")
    .select("*")
    .in("availability_status", ["online", "available", "ready", "active"])
    .order("updated_at", { ascending: false });

  if (error) throw error;

  return ok(res, {
    drivers: (data || []).map((driver) => ({
      id: driver.id,
      full_name: getDriverDisplayName(driver),
      driver_type: normalizeDriverType(driver.driver_type || "human"),
      phone: clean(driver.phone || ""),
      current_latitude: getDriverLatitude(driver),
      current_longitude: getDriverLongitude(driver),
      last_location_at: clean(driver.last_location_at || ""),
      status: normalizeDriverStatus(driver.status || driver.approval_status)
    }))
  });
}));

/* =========================================================
   ADMIN APPROVAL ROUTES
========================================================= */
app.post("/api/admin/rider/approve", requireAdmin, asyncHandler(async (req, res) => {
  const riderId = pickFirst(req.body.rider_id, req.body.riderId);
  if (!riderId) return fail(res, "Rider ID is required");

  const rider = await getRiderById(riderId);
  if (!rider) return fail(res, "Rider not found", 404);

  const updated = await updateRows(
    "riders",
    { id: rider.id },
    {
      status: "approved",
      approval_status: "approved",
      verification_status: "approved",
      updated_at: nowIso()
    }
  );

  await logAdminEvent({
    event_type: "admin_rider_approved",
    target_table: "riders",
    target_id: rider.id,
    details: {
      approved_by: getAdminEmailFromRequest(req)
    }
  });

  return ok(res, {
    message: "Rider approved successfully",
    rider: buildRiderStatusResponse(updated?.[0] || rider)
  });
}));

app.post("/api/admin/driver/approve", requireAdmin, asyncHandler(async (req, res) => {
  const driverId = pickFirst(req.body.driver_id, req.body.driverId);
  if (!driverId) return fail(res, "Driver ID is required");

  const driver = await getDriverById(driverId);
  if (!driver) return fail(res, "Driver not found", 404);

  const updated = await updateRows(
    "drivers",
    { id: driver.id },
    {
      status: "approved",
      approval_status: "approved",
      verification_status: "approved",
      updated_at: nowIso()
    }
  );

  await logAdminEvent({
    event_type: "admin_driver_approved",
    target_table: "drivers",
    target_id: driver.id,
    details: {
      approved_by: getAdminEmailFromRequest(req)
    }
  });

  return ok(res, {
    message: "Driver approved successfully",
    driver: updated?.[0] || driver
  });
}));

app.post("/api/admin/driver/verify-contact", requireAdmin, asyncHandler(async (req, res) => {
  const driverId = pickFirst(req.body.driver_id, req.body.driverId);
  if (!driverId) return fail(res, "Driver ID is required");

  const driver = await getDriverById(driverId);
  if (!driver) return fail(res, "Driver not found", 404);

  const updated = await updateRows(
    "drivers",
    { id: driver.id },
    {
      email_verified: true,
      sms_verified: true,
      updated_at: nowIso()
    }
  );

  await logAdminEvent({
    event_type: "admin_driver_contact_verified",
    target_table: "drivers",
    target_id: driver.id,
    details: {
      verified_by: getAdminEmailFromRequest(req)
    }
  });

  return ok(res, {
    message: "Driver email and SMS marked verified",
    driver: updated?.[0] || driver
  });
}));

/* =========================================================
   AI SUPPORT ROUTE
========================================================= */
app.post("/api/ai/support", asyncHandler(async (req, res) => {
  const body = req.body || {};
  const message = clean(body.message || body.prompt || "");
  const page = normalizePage(body.page || body.context_page || "general");
  const rider_id = pickFirst(body.rider_id, body.riderId);
  const driver_id = pickFirst(body.driver_id, body.driverId);
  const ride_id = pickFirst(body.ride_id, body.rideId);

  if (!message) {
    return fail(res, "Message is required");
  }

  const result = await generateAiSupportReply({
    message,
    page,
    rider_id,
    driver_id,
    ride_id
  });

  return ok(res, {
    reply: result.reply,
    source: result.source,
    page
  });
}));

/* =========================================================
   SUPPORT FAQ ROUTE
========================================================= */
app.get("/api/support/faq", asyncHandler(async (req, res) => {
  return ok(res, {
    faqs: [
      {
        question: "Can riders request a ride immediately after signup?",
        answer: "No. Riders must be approved first. If payment authorization is required, that must also be completed before dispatch."
      },
      {
        question: "What does a driver need before going online?",
        answer: "Drivers need signup completion, contact verification, approval, and then they can go online to receive missions."
      },
      {
        question: "When is payment captured?",
        answer: "Payment is typically authorized before dispatch and captured when the ride is completed."
      },
      {
        question: "Can riders tip drivers?",
        answer: "Yes. This server supports tipping during the trip and after the trip."
      },
      {
        question: "Is autonomous service live?",
        answer: "Autonomous service is treated as a pilot mode and should be clearly labeled in the app."
      },
      {
        question: "What if this is an emergency?",
        answer: "Harvey Taxi is not an emergency service. Call 911 for emergencies."
      }
    ]
  });
}));

/* =========================================================
   NOT FOUND
========================================================= */
app.use((req, res) => {
  return fail(res, "Route not found", 404, {
    method: req.method,
    path: req.originalUrl
  });
});

/* =========================================================
   ERROR HANDLER
========================================================= */
app.use((error, req, res, next) => {
  console.error("❌ Express fatal error:", error);

  if (res.headersSent) {
    return next(error);
  }

  return res.status(500).json({
    ok: false,
    error: "Internal server error",
    details: IS_PROD ? undefined : clean(error?.message || String(error))
  });
});

/* =========================================================
   START SERVER
========================================================= */
async function startServer() {
  try {
    await runStartupChecks();

    app.listen(PORT, () => {
      console.log("====================================================");
      console.log(`🚕 ${APP_NAME} running`);
      console.log(`🌐 Port: ${PORT}`);
      console.log(`🛠️ Environment: ${NODE_ENV}`);
      console.log(`🕒 Started: ${SERVER_STARTED_AT}`);
      console.log(`🧠 AI Enabled: ${!!openai}`);
      console.log(`🗄️ Supabase Ready: ${!!supabase}`);
      console.log(`📲 Twilio Ready: ${!!twilioClient}`);
      console.log("====================================================");
    });
  } catch (error) {
    console.error("❌ Failed to start server:", error);
    process.exit(1);
  }
}

startServer();

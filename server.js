/* =========================================================
   HARVEY TAXI — CODE BLUE PHASE 10 PRODUCTION
   PART 1 OF 4
   FOUNDATION + ENV + MIDDLEWARE + CLIENTS + HEALTH
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
const http = require("http");
const { createClient } = require("@supabase/supabase-js");

/* =========================================================
   OPTIONAL IMPORTS
========================================================= */
let OpenAI = null;
try {
  OpenAI = require("openai");
} catch (error) {
  console.warn("⚠️ OpenAI SDK not installed. AI endpoints disabled.");
}

let twilio = null;
try {
  twilio = require("twilio");
} catch (error) {
  console.warn("⚠️ Twilio SDK not installed. SMS features disabled.");
}

let nodemailer = null;
try {
  nodemailer = require("nodemailer");
} catch (error) {
  console.warn("⚠️ nodemailer not installed. Email features disabled.");
}

let fetchFn = global.fetch;
if (!fetchFn) {
  try {
    fetchFn = require("node-fetch");
  } catch (error) {
    console.warn("⚠️ node-fetch not installed. External fetch helpers may fail.");
  }
}

/* =========================================================
   APP INIT
========================================================= */
const app = express();
const server = http.createServer(app);

/* =========================================================
   BASIC HELPERS
========================================================= */
function clean(value = "") {
  return String(value ?? "").trim();
}

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

function nowIso() {
  return new Date().toISOString();
}

function createId(prefix = "id") {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`;
}

function roundMoney(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function pickFirst(...values) {
  for (const value of values) {
    const v = clean(value);
    if (v) return v;
  }
  return "";
}

function parseNullableNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function isObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function safeJsonParse(value, fallback = null) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function safeEqual(a = "", b = "") {
  const aBuf = Buffer.from(String(a));
  const bBuf = Buffer.from(String(b));
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

/* =========================================================
   APP CONSTANTS
========================================================= */
const APP_NAME = "Harvey Taxi Code Blue Production";
const PORT = toNumber(process.env.PORT, 10000);
const NODE_ENV = lower(process.env.NODE_ENV || "development");
const IS_PROD = NODE_ENV === "production";
const SERVER_STARTED_AT = nowIso();

/* =========================================================
   CORE ENV
========================================================= */
const PUBLIC_APP_URL =
  clean(process.env.PUBLIC_APP_URL) ||
  clean(process.env.RENDER_EXTERNAL_URL) ||
  clean(process.env.APP_BASE_URL) ||
  "";

const SUPPORT_EMAIL =
  clean(process.env.SUPPORT_EMAIL) ||
  clean(process.env.SUPPORT_FROM_EMAIL) ||
  clean(process.env.EMAIL_FROM) ||
  "support@harveytaxiservice.com";

const ADMIN_EMAIL =
  clean(process.env.ADMIN_EMAIL) ||
  clean(process.env.SUPPORT_ADMIN_EMAIL) ||
  "williebee@harveytaxiservice.com";

const ADMIN_PASSWORD =
  clean(process.env.ADMIN_PASSWORD) ||
  clean(process.env.SUPPORT_ADMIN_PASSWORD);

const ENABLE_AI_BRAIN = toBool(process.env.ENABLE_AI_BRAIN, true);
const ENABLE_AI_DISPATCH = toBool(process.env.ENABLE_AI_DISPATCH, true);
const ENABLE_AI_OPERATIONS = toBool(process.env.ENABLE_AI_OPERATIONS, true);
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

/* =========================================================
   THIRD-PARTY ENV
========================================================= */
const SUPABASE_URL = clean(process.env.SUPABASE_URL);
const SUPABASE_SERVICE_ROLE_KEY = clean(process.env.SUPABASE_SERVICE_ROLE_KEY);

const OPENAI_API_KEY = clean(process.env.OPENAI_API_KEY);
const OPENAI_SUPPORT_MODEL = clean(process.env.OPENAI_SUPPORT_MODEL || "gpt-4.1-mini");
const OPENAI_OPERATIONS_MODEL = clean(process.env.OPENAI_OPERATIONS_MODEL || "gpt-4.1-mini");

const TWILIO_ACCOUNT_SID = clean(process.env.TWILIO_ACCOUNT_SID);
const TWILIO_AUTH_TOKEN = clean(process.env.TWILIO_AUTH_TOKEN);
const TWILIO_FROM_NUMBER =
  clean(process.env.TWILIO_PHONE_NUMBER) ||
  clean(process.env.TWILIO_FROM_NUMBER);

const SMTP_HOST = clean(process.env.SMTP_HOST);
const SMTP_PORT = toNumber(process.env.SMTP_PORT, 587);
const SMTP_USER = clean(process.env.SMTP_USER);
const SMTP_PASS = clean(process.env.SMTP_PASS);
const SMTP_FROM =
  clean(process.env.SMTP_FROM) ||
  clean(process.env.EMAIL_FROM) ||
  SUPPORT_EMAIL;

const GOOGLE_MAPS_API_KEY = clean(process.env.GOOGLE_MAPS_API_KEY);

const PERSONA_TEMPLATE_ID_RIDER = clean(process.env.PERSONA_TEMPLATE_ID_RIDER);
const PERSONA_TEMPLATE_ID_DRIVER = clean(process.env.PERSONA_TEMPLATE_ID_DRIVER);
const PERSONA_WEBHOOK_SECRET = clean(process.env.PERSONA_WEBHOOK_SECRET);

/* =========================================================
   CLIENTS
========================================================= */
const supabase =
  SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false }
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

const emailTransporter =
  nodemailer && SMTP_HOST && SMTP_USER && SMTP_PASS
    ? nodemailer.createTransport({
        host: SMTP_HOST,
        port: SMTP_PORT,
        secure: SMTP_PORT === 465,
        auth: {
          user: SMTP_USER,
          pass: SMTP_PASS
        }
      })
    : null;

/* =========================================================
   RUNTIME STATE
========================================================= */
const runtimeState = {
  startupChecks: {
    ran: false,
    ok: false,
    checkedAt: null,
    tables: {},
    env: {}
  },
  dispatchSweep: {
    enabled: ENABLE_AUTO_REDISPATCH,
    lastRanAt: null,
    lastError: null
  },
  aiOperations: {
    enabled: ENABLE_AI_OPERATIONS,
    lastRecommendationAt: null,
    lastRecommendationError: null
  },
  process: {
    shuttingDown: false
  }
};

/* =========================================================
   REQUEST ID + RAW BODY + BODY PARSERS
========================================================= */
app.use((req, res, next) => {
  req.requestId =
    clean(req.headers["x-request-id"]) ||
    clean(req.headers["x-correlation-id"]) ||
    createId("req");

  res.setHeader("x-request-id", req.requestId);
  next();
});

app.use((req, res, next) => {
  let rawData = "";
  req.on("data", (chunk) => {
    rawData += chunk;
  });
  req.on("end", () => {
    req.rawBody = rawData || "";
    next();
  });
});

app.use(cors({ origin: true, credentials: true }));
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
      `[${nowIso()}] [${req.requestId}] ${req.method} ${req.originalUrl} -> ${res.statusCode} (${ms}ms)`
    );
  });

  next();
});

/* =========================================================
   LIGHT RATE LIMITER
========================================================= */
const rateLimitBuckets = new Map();

function applyBasicRateLimit({
  key,
  limit = 60,
  windowMs = 60_000
}) {
  const now = Date.now();
  const bucket = rateLimitBuckets.get(key) || {
    count: 0,
    resetAt: now + windowMs
  };

  if (now > bucket.resetAt) {
    bucket.count = 0;
    bucket.resetAt = now + windowMs;
  }

  bucket.count += 1;
  rateLimitBuckets.set(key, bucket);

  return {
    allowed: bucket.count <= limit,
    remaining: Math.max(0, limit - bucket.count),
    resetAt: bucket.resetAt
  };
}

app.use((req, res, next) => {
  const ip =
    clean(req.headers["x-forwarded-for"]).split(",")[0] ||
    req.socket?.remoteAddress ||
    "unknown";

  const limitedPaths = [
    "/api/driver/signup",
    "/api/request-ride",
    "/api/ai/support",
    "/api/persona/webhook"
  ];

  if (!limitedPaths.some((p) => req.originalUrl.startsWith(p))) {
    return next();
  }

  const result = applyBasicRateLimit({
    key: `${ip}:${req.path}`,
    limit: req.path === "/api/ai/support" ? 25 : 60,
    windowMs: 60_000
  });

  res.setHeader("x-rate-limit-remaining", String(result.remaining));

  if (!result.allowed) {
    return res.status(429).json({
      ok: false,
      error: "Too many requests"
    });
  }

  next();
});

/* =========================================================
   RESPONSE HELPERS
========================================================= */
function ok(res, data = {}, status = 200) {
  return res.status(status).json({ ok: true, ...data });
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
  return normalizeRideMode(mode) === "autonomous" ? 1.15 : 1.0;
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

  const total = Math.max(
    FARE_MINIMUM,
    subtotal *
      getRideTypeMultiplier(rideType) *
      getModeMultiplier(requestedMode) *
      Math.max(1, Number(surgeMultiplier) || 1)
  );

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
    throw new Error("Supabase is not configured.");
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
  const { data, error } = await requireSupabase()
    .from(table)
    .insert(payload)
    .select()
    .limit(1);

  if (error) throw error;
  return data?.[0] || null;
}

async function updateRows(table, match, payload) {
  let query = requireSupabase().from(table).update(payload);

  for (const [key, value] of Object.entries(match || {})) {
    query = query.eq(key, value);
  }

  const { data, error } = await query.select();
  if (error) throw error;
  return data || [];
}

async function getRowById(table, idColumn, idValue) {
  return maybeSingle(
    requireSupabase()
      .from(table)
      .select("*")
      .eq(idColumn, clean(idValue))
  );
}

async function logAdminEvent({
  event_type,
  actor_email = ADMIN_EMAIL,
  target_table = null,
  target_id = null,
  details = {}
}) {
  try {
    await requireSupabase().from("admin_logs").insert({
      id: createId("alog"),
      event_type: clean(event_type || "admin_event"),
      actor_email: clean(actor_email || ADMIN_EMAIL),
      target_table: target_table ? clean(target_table) : null,
      target_id: target_id ? clean(target_id) : null,
      details: isObject(details) ? details : { value: details },
      created_at: nowIso()
    });
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
    await requireSupabase().from("trip_events").insert({
      id: createId("tevt"),
      ride_id: clean(ride_id) || null,
      mission_id: clean(mission_id) || null,
      driver_id: clean(driver_id) || null,
      rider_id: clean(rider_id) || null,
      event_type: clean(event_type || "trip_event"),
      details: isObject(details) ? details : { value: details },
      created_at: nowIso()
    });
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
    return { ok: false, provider: "twilio", skipped: true, reason: "Missing phone or message" };
  }

  if (!ENABLE_REAL_SMS || !twilioClient || !TWILIO_FROM_NUMBER) {
    console.log(`📩 MOCK SMS -> ${phone}: ${body}`);
    return { ok: true, provider: "mock_sms", sid: null };
  }

  const result = await twilioClient.messages.create({
    to: phone,
    from: TWILIO_FROM_NUMBER,
    body: String(body)
  });

  return { ok: true, provider: "twilio", sid: result.sid || null };
}

async function sendEmail({ to, subject, text, html = "" }) {
  if (!to || !subject || !(text || html)) {
    return { ok: false, provider: "smtp", skipped: true, reason: "Missing email payload" };
  }

  if (!ENABLE_REAL_EMAIL || !emailTransporter || !SMTP_FROM) {
    console.log(`📧 MOCK EMAIL -> ${to}: ${subject}`);
    return { ok: true, provider: "mock_email", messageId: null };
  }

  const result = await emailTransporter.sendMail({
    from: SMTP_FROM,
    to,
    subject: String(subject),
    text: text || undefined,
    html: html || undefined
  });

  return {
    ok: true,
    provider: "smtp",
    messageId: result.messageId || null
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
   ADMIN AUTH
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
   STARTUP CHECKS
========================================================= */
async function checkTableAccessible(tableName) {
  const { error } = await requireSupabase()
    .from(tableName)
    .select("*", { count: "exact", head: true });

  return {
    ok: !error,
    error: error ? error.message : null
  };
}

async function runStartupChecks() {
  runtimeState.startupChecks.ran = true;
  runtimeState.startupChecks.checkedAt = nowIso();

  runtimeState.startupChecks.env = {
    supabase_url_present: !!SUPABASE_URL,
    supabase_service_role_present: !!SUPABASE_SERVICE_ROLE_KEY,
    openai_key_present: !!OPENAI_API_KEY,
    twilio_sid_present: !!TWILIO_ACCOUNT_SID,
    twilio_auth_present: !!TWILIO_AUTH_TOKEN,
    twilio_from_present: !!TWILIO_FROM_NUMBER,
    smtp_host_present: !!SMTP_HOST,
    smtp_user_present: !!SMTP_USER,
    smtp_pass_present: !!SMTP_PASS,
    persona_webhook_secret_present: !!PERSONA_WEBHOOK_SECRET,
    persona_template_rider_present: !!PERSONA_TEMPLATE_ID_RIDER,
    persona_template_driver_present: !!PERSONA_TEMPLATE_ID_DRIVER,
    admin_email_present: !!ADMIN_EMAIL,
    admin_password_present: !!ADMIN_PASSWORD,
    google_maps_key_present: !!GOOGLE_MAPS_API_KEY
  };

  if (!supabase) {
    runtimeState.startupChecks.ok = false;
    runtimeState.startupChecks.tables = {
      _supabase: { ok: false, error: "Supabase client not configured" }
    };
    return runtimeState.startupChecks;
  }

  if (!ENABLE_STARTUP_TABLE_CHECKS) {
    runtimeState.startupChecks.ok = true;
    runtimeState.startupChecks.tables = { skipped: { ok: true, error: null } };
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
    "trip_events",
    "driver_earnings"
  ];

  let allOk = true;
  const results = {};

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
  return res.sendFile(path.join(__dirname, "public", "index.html"));
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
    environment: NODE_ENV,
    started_at: SERVER_STARTED_AT,
    now: nowIso(),
    services: {
      supabase: !!supabase,
      openai: !!openai,
      twilio: !!twilioClient,
      smtp: !!emailTransporter,
      real_sms_enabled: ENABLE_REAL_SMS,
      real_email_enabled: ENABLE_REAL_EMAIL,
      rider_verification_gate: ENABLE_RIDER_VERIFICATION_GATE,
      payment_gate: ENABLE_PAYMENT_GATE,
      auto_redispatch: ENABLE_AUTO_REDISPATCH,
      ai_dispatch: ENABLE_AI_DISPATCH,
      ai_operations: ENABLE_AI_OPERATIONS,
      driver_location_tracking: ENABLE_DRIVER_LOCATION_TRACKING
    },
    startup_checks: runtimeState.startupChecks,
    process: runtimeState.process
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
    startup_checks: checks
  });
}));/* =========================================================
   PART 2 OF 4
   RIDERS + PAYMENTS + FARE + REQUEST RIDE + PERSONA WEBHOOK
========================================================= */

/* =========================================================
   ADDRESS + METRICS HELPERS
========================================================= */
function haversineMiles(lat1, lon1, lat2, lon2) {
  if (
    !Number.isFinite(Number(lat1)) ||
    !Number.isFinite(Number(lon1)) ||
    !Number.isFinite(Number(lat2)) ||
    !Number.isFinite(Number(lon2))
  ) return null;

  const toRad = (deg) => (deg * Math.PI) / 180;
  const R = 3958.8;
  const dLat = toRad(Number(lat2) - Number(lat1));
  const dLon = toRad(Number(lon2) - Number(lon1));

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(Number(lat1))) *
      Math.cos(toRad(Number(lat2))) *
      Math.sin(dLon / 2) ** 2;

  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function estimateDurationMinutesFromMiles(miles = 0) {
  return Math.max(5, roundMoney((Number(miles || 0) / 26) * 60));
}

async function resolveTripMetrics(payload = {}) {
  const miles = haversineMiles(
    parseNullableNumber(payload.pickup_latitude),
    parseNullableNumber(payload.pickup_longitude),
    parseNullableNumber(payload.dropoff_latitude),
    parseNullableNumber(payload.dropoff_longitude)
  );

  if (!miles) {
    return {
      distance_miles: 8,
      duration_minutes: 18,
      source: "fallback"
    };
  }

  return {
    distance_miles: roundMoney(miles * 1.15),
    duration_minutes: estimateDurationMinutesFromMiles(miles),
    source: "haversine"
  };
}

/* =========================================================
   RIDER HELPERS
========================================================= */
function buildRiderStatusResponse(rider = {}) {
  const status = normalizeRiderStatus(
    rider.status || rider.approval_status || rider.verification_status
  );

  return {
    ...rider,
    status,
    is_approved: status === "approved"
  };
}

async function getRiderById(id) {
  return getRowById("riders", "id", clean(id));
}

async function getRiderByEmail(email) {
  return maybeSingle(
    requireSupabase()
      .from("riders")
      .select("*")
      .ilike("email", lower(email))
  );
}

async function resolveRider(body = {}) {
  return (
    await getRiderById(body.rider_id || body.riderId) ||
    await getRiderByEmail(body.email)
  );
}

async function getLatestPaymentForRider(riderId) {
  const { data, error } = await requireSupabase()
    .from("payments")
    .select("*")
    .eq("rider_id", clean(riderId))
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) throw error;
  return data?.[0] || null;
}

async function getLatestPaymentForRide(rideId) {
  const { data, error } = await requireSupabase()
    .from("payments")
    .select("*")
    .eq("ride_id", clean(rideId))
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) throw error;
  return data?.[0] || null;
}

/* =========================================================
   RIDER ROUTES
========================================================= */
app.post("/api/rider/signup", asyncHandler(async (req, res) => {
  const firstName = clean(req.body.first_name || req.body.firstName);
  const lastName = clean(req.body.last_name || req.body.lastName);
  const email = lower(req.body.email);
  const phone = normalizePhone(req.body.phone);

  if (!firstName) return fail(res, "First name is required");
  if (!lastName) return fail(res, "Last name is required");
  if (!email || !isEmail(email)) return fail(res, "Valid email is required");
  if (!phone) return fail(res, "Valid phone number is required");

  const existing = await getRiderByEmail(email);
  if (existing) {
    return ok(res, {
      message: "Rider already exists",
      rider: buildRiderStatusResponse(existing)
    });
  }

  const rider = await insertRow("riders", {
    id: createId("rider"),
    first_name: firstName,
    last_name: lastName,
    full_name: `${firstName} ${lastName}`.trim(),
    email,
    phone,
    status: "pending",
    approval_status: "pending",
    verification_status: "pending",
    created_at: nowIso(),
    updated_at: nowIso()
  });

  await logAdminEvent({
    event_type: "rider_signup_created",
    target_table: "riders",
    target_id: rider.id,
    details: { email, phone }
  });

  await sendEmail({
    to: email,
    subject: "Harvey Taxi rider signup received",
    text: "Your rider signup was received. Approval is required before ride requests can be made."
  });

  return ok(res, {
    message: "Rider signup submitted successfully",
    rider: buildRiderStatusResponse(rider)
  }, 201);
}));

app.post("/api/rider/status", asyncHandler(async (req, res) => {
  const rider = await resolveRider(req.body);
  if (!rider) return fail(res, "Rider not found", 404);

  return ok(res, {
    rider: buildRiderStatusResponse(rider)
  });
}));

app.get("/api/rider/:riderId/status", asyncHandler(async (req, res) => {
  const rider = await getRiderById(req.params.riderId);
  if (!rider) return fail(res, "Rider not found", 404);

  return ok(res, {
    rider: buildRiderStatusResponse(rider)
  });
}));

/* =========================================================
   FARE ESTIMATE
========================================================= */
app.post("/api/fare-estimate", asyncHandler(async (req, res) => {
  const metrics = await resolveTripMetrics(req.body);

  const fare = estimateFare({
    distanceMiles: metrics.distance_miles,
    durationMinutes: metrics.duration_minutes,
    rideType: req.body.ride_type,
    requestedMode: req.body.requested_mode
  });

  return ok(res, { fare, metrics });
}));

/* =========================================================
   PAYMENT AUTH PLACEHOLDER
========================================================= */
app.post("/api/payments/authorize", asyncHandler(async (req, res) => {
  const rider = await resolveRider(req.body);
  if (!rider) return fail(res, "Rider not found", 404);

  const amount = roundMoney(
    toNumber(req.body.amount, req.body.estimated_total || 0)
  );

  if (amount <= 0) {
    return fail(res, "Valid authorization amount is required");
  }

  const payment = await insertRow("payments", {
    id: createId("pay"),
    rider_id: rider.id,
    status: "authorized",
    payment_status: "authorized",
    authorization_amount: amount,
    currency: "USD",
    created_at: nowIso(),
    updated_at: nowIso()
  });

  await logTripEvent({
    ride_id: null,
    rider_id: rider.id,
    event_type: "payment_authorized",
    details: {
      payment_id: payment.id,
      authorization_amount: amount
    }
  });

  return ok(res, {
    message: "Payment authorized successfully",
    payment
  }, 201);
}));

/* =========================================================
   REQUEST RIDE
========================================================= */
app.post("/api/request-ride", asyncHandler(async (req, res) => {
  const rider = await resolveRider(req.body);
  if (!rider) return fail(res, "Rider not found", 404);

  if (ENABLE_RIDER_VERIFICATION_GATE && !riderIsApproved(rider)) {
    return fail(res, "Rider not approved", 403, {
      rider: buildRiderStatusResponse(rider)
    });
  }

  const payment = await getLatestPaymentForRider(rider.id);
  if (ENABLE_PAYMENT_GATE && !paymentIsAuthorized(payment)) {
    return fail(res, "Payment authorization required", 402);
  }

  const pickupAddress = clean(req.body.pickup_address);
  const dropoffAddress = clean(req.body.dropoff_address);

  if (!pickupAddress) return fail(res, "Pickup address is required");
  if (!dropoffAddress) return fail(res, "Dropoff address is required");

  const metrics = await resolveTripMetrics(req.body);
  const rideType = normalizeRideType(req.body.ride_type || "standard");
  const requestedMode = normalizeRideMode(req.body.requested_mode || "driver");

  const fare = estimateFare({
    distanceMiles: metrics.distance_miles,
    durationMinutes: metrics.duration_minutes,
    rideType,
    requestedMode
  });

  const payout = calculateDriverPayout(
    fare.estimated_total,
    requestedMode === "autonomous" ? "autonomous" : "human"
  );

  const ride = await insertRow("rides", {
    id: createId("ride"),
    rider_id: rider.id,
    payment_id: payment?.id || null,
    status: "awaiting_dispatch",
    ride_type: rideType,
    requested_mode: requestedMode,
    pickup_address: pickupAddress,
    dropoff_address: dropoffAddress,
    pickup_latitude: parseNullableNumber(req.body.pickup_latitude),
    pickup_longitude: parseNullableNumber(req.body.pickup_longitude),
    dropoff_latitude: parseNullableNumber(req.body.dropoff_latitude),
    dropoff_longitude: parseNullableNumber(req.body.dropoff_longitude),
    notes: clean(req.body.notes),
    estimated_distance_miles: metrics.distance_miles,
    estimated_duration_minutes: metrics.duration_minutes,
    estimated_total: fare.estimated_total,
    estimated_driver_payout: payout.driver_payout_estimate,
    estimated_platform_fee: payout.platform_fee_estimate,
    created_at: nowIso(),
    updated_at: nowIso()
  });

  if (payment?.id) {
    await updateRows("payments", { id: payment.id }, {
      ride_id: ride.id,
      updated_at: nowIso()
    });
  }

  await logTripEvent({
    ride_id: ride.id,
    rider_id: rider.id,
    event_type: "ride_created",
    details: {
      requested_mode: requestedMode,
      ride_type: rideType,
      fare,
      metrics
    }
  });

  let dispatch = null;
  if (ENABLE_AI_DISPATCH) {
    dispatch = await dispatchRideToBestDriver(ride.id);
  }

  return ok(res, {
    message: "Ride created",
    ride,
    fare,
    metrics,
    dispatch
  }, 201);
}));

/* =========================================================
   PERSONA WEBHOOK HELPERS
========================================================= */
function getPersonaSignature(req) {
  return (
    clean(req.headers["persona-signature"]) ||
    clean(req.headers["x-persona-signature"]) ||
    ""
  );
}

/* simple secret compare pattern aligned to your earlier flow */
function verifyPersonaWebhook(req) {
  if (!PERSONA_WEBHOOK_SECRET) return true;
  const provided = getPersonaSignature(req);
  if (!provided) return false;
  return safeEqual(provided, PERSONA_WEBHOOK_SECRET);
}

function extractPersonaPayload(req) {
  return req.body || safeJsonParse(req.rawBody, {}) || {};
}

function extractPersonaInquiry(payload = {}) {
  const data = payload.data || {};
  const attributes = data.attributes || {};
  const included = Array.isArray(payload.included) ? payload.included : [];

  let templateId =
    attributes.inquiry_template_id ||
    attributes.template_id ||
    null;

  let referenceId =
    attributes.reference_id ||
    attributes.referenceId ||
    null;

  let accountId =
    attributes.account_id ||
    attributes.accountId ||
    null;

  for (const item of included) {
    const attrs = item?.attributes || {};
    templateId = templateId || attrs.inquiry_template_id || attrs.template_id || null;
    referenceId = referenceId || attrs.reference_id || attrs.referenceId || null;
    accountId = accountId || attrs.account_id || attrs.accountId || null;
  }

  return {
    inquiryId: data.id || attributes.inquiry_id || null,
    status: lower(attributes.status || attributes.review_status || ""),
    templateId,
    referenceId,
    accountId
  };
}

async function processPersonaRiderEvent(eventName, inquiry) {
  const riderLookup = inquiry.referenceId || inquiry.accountId || inquiry.inquiryId;
  if (!riderLookup) return;

  if (eventName === "inquiry.approved") {
    await requireSupabase()
      .from("riders")
      .update({
        verification_status: "approved",
        approval_status: "approved",
        status: "approved",
        rider_approved: true,
        persona_inquiry_id: inquiry.inquiryId,
        persona_account_id: inquiry.accountId,
        updated_at: nowIso()
      })
      .or(`id.eq.${riderLookup},email.eq.${riderLookup}`);

    await logAdminEvent({
      event_type: "rider_persona_approved",
      target_table: "riders",
      target_id: riderLookup,
      details: { inquiry_id: inquiry.inquiryId }
    });
  }

  if (["inquiry.declined", "inquiry.failed"].includes(eventName)) {
    const status = eventName === "inquiry.declined" ? "declined" : "failed";

    await requireSupabase()
      .from("riders")
      .update({
        verification_status: status,
        approval_status: "pending",
        status: "pending",
        rider_approved: false,
        persona_inquiry_id: inquiry.inquiryId,
        persona_account_id: inquiry.accountId,
        updated_at: nowIso()
      })
      .or(`id.eq.${riderLookup},email.eq.${riderLookup}`);

    await logAdminEvent({
      event_type: "rider_persona_blocked",
      target_table: "riders",
      target_id: riderLookup,
      details: { inquiry_id: inquiry.inquiryId, eventName }
    });
  }
}

async function processPersonaDriverEvent(eventName, inquiry) {
  const driverLookup = inquiry.referenceId || inquiry.accountId || inquiry.inquiryId;
  if (!driverLookup) return;

  if (eventName === "inquiry.approved") {
    await requireSupabase()
      .from("drivers")
      .update({
        verification_status: "approved",
        persona_status: "approved",
        driver_verified: true,
        persona_inquiry_id: inquiry.inquiryId,
        persona_account_id: inquiry.accountId,
        updated_at: nowIso()
      })
      .or(`id.eq.${driverLookup},email.eq.${driverLookup}`);

    await logAdminEvent({
      event_type: "driver_persona_approved",
      target_table: "drivers",
      target_id: driverLookup,
      details: { inquiry_id: inquiry.inquiryId }
    });
  }

  if (["inquiry.declined", "inquiry.failed"].includes(eventName)) {
    const status = eventName === "inquiry.declined" ? "declined" : "failed";

    await requireSupabase()
      .from("drivers")
      .update({
        verification_status: status,
        persona_status: status,
        driver_verified: false,
        approval_status: "pending",
        status: "pending",
        updated_at: nowIso()
      })
      .or(`id.eq.${driverLookup},email.eq.${driverLookup}`);

    await logAdminEvent({
      event_type: "driver_persona_blocked",
      target_table: "drivers",
      target_id: driverLookup,
      details: { inquiry_id: inquiry.inquiryId, eventName }
    });
  }
}

/* =========================================================
   PERSONA WEBHOOK ROUTE
========================================================= */
app.post("/api/persona/webhook", asyncHandler(async (req, res) => {
  if (!verifyPersonaWebhook(req)) {
    return fail(res, "Invalid Persona webhook signature", 401);
  }

  const payload = extractPersonaPayload(req);
  const eventName = lower(payload.type || payload.event_name || "");
  const inquiry = extractPersonaInquiry(payload);

  await logAdminEvent({
    event_type: "persona_webhook_received",
    target_table: "admin_logs",
    target_id: inquiry.inquiryId || null,
    details: {
      eventName,
      inquiry
    }
  });

  const isRiderTemplate =
    inquiry.templateId && inquiry.templateId === PERSONA_TEMPLATE_ID_RIDER;

  const isDriverTemplate =
    inquiry.templateId && inquiry.templateId === PERSONA_TEMPLATE_ID_DRIVER;

  if (isRiderTemplate) {
    await processPersonaRiderEvent(eventName, inquiry);
  }

  if (isDriverTemplate) {
    await processPersonaDriverEvent(eventName, inquiry);
  }

  return ok(res, {
    received: true,
    event: eventName
  });
}));/* =========================================================
   PART 3 OF 4
   DRIVERS + AI DISPATCH BRAIN + MISSIONS + REDISPATCH
========================================================= */

/* =========================================================
   DRIVER HELPERS
========================================================= */
async function getDriverById(id) {
  return getRowById("drivers", "id", clean(id));
}

async function getDriverByEmail(email) {
  return maybeSingle(
    requireSupabase().from("drivers").select("*").ilike("email", lower(email))
  );
}

async function getDriverByPhone(phone) {
  return maybeSingle(
    requireSupabase().from("drivers").select("*").eq("phone", normalizePhone(phone))
  );
}

async function resolveDriver(body = {}) {
  return (
    await getDriverById(body.driver_id || body.driverId) ||
    await getDriverByEmail(body.email || body.driver_email || body.driverEmail) ||
    await getDriverByPhone(body.phone || body.driver_phone || body.driverPhone)
  );
}

function driverIsVerified(driver) {
  const emailVerified = toBool(driver?.email_verified, false);
  const smsVerified = toBool(driver?.sms_verified, false);
  const personaVerified = lower(driver?.verification_status || "") === "approved";
  return (emailVerified && smsVerified) || personaVerified;
}

function driverIsOnline(driver) {
  if (typeof driver?.is_online === "boolean") return driver.is_online;
  const status = lower(driver?.availability_status || driver?.online_status || "");
  return ["online", "available", "ready", "active", "true"].includes(status);
}

function getDriverDisplayName(driver = {}) {
  return (
    clean(driver.full_name) ||
    [clean(driver.first_name), clean(driver.last_name)].filter(Boolean).join(" ") ||
    "Driver"
  );
}

function getDriverLatitude(driver = {}) {
  return (
    parseNullableNumber(driver.current_latitude) ??
    parseNullableNumber(driver.latitude) ??
    parseNullableNumber(driver.last_latitude)
  );
}

function getDriverLongitude(driver = {}) {
  return (
    parseNullableNumber(driver.current_longitude) ??
    parseNullableNumber(driver.longitude) ??
    parseNullableNumber(driver.last_longitude)
  );
}

function getDriverCompletedTrips(driver = {}) {
  return toNumber(driver.completed_trips || driver.trip_count || 0, 0);
}

function getDriverAcceptanceRate(driver = {}) {
  const value = Number(driver.acceptance_rate ?? 0.8);
  return Number.isFinite(value) ? clamp(value, 0, 1) : 0.8;
}

function getDriverRating(driver = {}) {
  const value = Number(driver.rating ?? 5);
  return Number.isFinite(value) ? clamp(value, 1, 5) : 5;
}

function driverSupportsMode(driver, requestedMode = "driver") {
  const mode = normalizeRideMode(requestedMode);
  const type = normalizeDriverType(driver?.driver_type || "human");
  if (mode === "autonomous") return type === "autonomous";
  return type === "human";
}

function driverCanReceiveDispatch(driver, requestedMode = "driver") {
  return (
    driverIsApproved(driver) &&
    driverIsVerified(driver) &&
    driverIsOnline(driver) &&
    driverSupportsMode(driver, requestedMode)
  );
}

/* =========================================================
   RIDE / MISSION / DISPATCH HELPERS
========================================================= */
async function getRideById(rideId) {
  return getRowById("rides", "id", clean(rideId));
}

async function getMissionById(missionId) {
  return getRowById("missions", "id", clean(missionId));
}

async function getDispatchById(dispatchId) {
  return getRowById("dispatches", "id", clean(dispatchId));
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

async function countDispatchAttemptsForRide(rideId) {
  const { count, error } = await requireSupabase()
    .from("dispatches")
    .select("*", { count: "exact", head: true })
    .eq("ride_id", clean(rideId));

  if (error) throw error;
  return Number(count || 0);
}

async function getTriedDriverIdsForRide(rideId) {
  const { data, error } = await requireSupabase()
    .from("dispatches")
    .select("driver_id")
    .eq("ride_id", clean(rideId));

  if (error) throw error;
  return new Set((data || []).map((row) => clean(row.driver_id)).filter(Boolean));
}

/* =========================================================
   AI DISPATCH SCORING
========================================================= */
function distanceMilesBetweenDriverAndPickup(driver, ride) {
  const distance = haversineMiles(
    getDriverLatitude(driver),
    getDriverLongitude(driver),
    parseNullableNumber(ride?.pickup_latitude),
    parseNullableNumber(ride?.pickup_longitude)
  );

  if (!distance || !Number.isFinite(distance)) return 9999;
  return distance;
}

function scoreDriverForRide(driver, ride) {
  const distance = distanceMilesBetweenDriverAndPickup(driver, ride);
  const rating = getDriverRating(driver);
  const completedTrips = getDriverCompletedTrips(driver);
  const acceptanceRate = getDriverAcceptanceRate(driver);

  let score = 0;
  score += Math.max(0, 120 - distance * 9);
  score += rating * 9;
  score += Math.min(25, completedTrips * 0.15);
  score += acceptanceRate * 30;
  score += normalizeRideMode(ride?.requested_mode) === normalizeDriverType(driver?.driver_type) ? 10 : 0;

  return {
    score: roundMoney(score),
    distance_miles_to_pickup: roundMoney(distance),
    rating,
    completed_trips: completedTrips,
    acceptance_rate: acceptanceRate
  };
}

async function getCandidateDriversForRide(ride) {
  const triedDriverIds = await getTriedDriverIdsForRide(ride.id);

  const { data, error } = await requireSupabase()
    .from("drivers")
    .select("*")
    .order("updated_at", { ascending: false });

  if (error) throw error;

  return (data || [])
    .filter((driver) => !triedDriverIds.has(clean(driver.id)))
    .filter((driver) => driverCanReceiveDispatch(driver, ride.requested_mode))
    .map((driver) => ({
      driver,
      scoring: scoreDriverForRide(driver, ride)
    }))
    .sort((a, b) => b.scoring.score - a.scoring.score);
}

function getDispatchExpiresAt() {
  return new Date(Date.now() + DISPATCH_TIMEOUT_SECONDS * 1000).toISOString();
}

async function createMissionForRide(ride, driver, scoring = {}) {
  const existing = await getMissionByRideId(ride.id);
  if (existing) return existing;

  return insertRow("missions", {
    id: createId("mission"),
    ride_id: ride.id,
    rider_id: clean(ride.rider_id),
    driver_id: clean(driver.id),
    status: "offered",
    mission_status: "offered",
    requested_mode: normalizeRideMode(ride.requested_mode || "driver"),
    mission_snapshot: {
      pickup_address: ride.pickup_address,
      dropoff_address: ride.dropoff_address,
      estimated_total: ride.estimated_total,
      estimated_driver_payout: ride.estimated_driver_payout,
      ride_type: ride.ride_type,
      scoring
    },
    created_at: nowIso(),
    updated_at: nowIso()
  });
}

async function createDispatchForRide(ride, driver, scoring = {}) {
  const attemptNumber = (await countDispatchAttemptsForRide(ride.id)) + 1;

  return insertRow("dispatches", {
    id: createId("dispatch"),
    ride_id: ride.id,
    rider_id: clean(ride.rider_id),
    driver_id: clean(driver.id),
    status: "awaiting_driver_acceptance",
    dispatch_status: "awaiting_driver_acceptance",
    attempt_number: attemptNumber,
    offered_at: nowIso(),
    expires_at: getDispatchExpiresAt(),
    scoring_snapshot: scoring,
    created_at: nowIso(),
    updated_at: nowIso()
  });
}

async function assignDriverToRide(ride, driver, dispatch, mission) {
  const updated = await updateRows("rides", { id: ride.id }, {
    driver_id: driver.id,
    dispatch_id: dispatch.id,
    mission_id: mission.id,
    status: "awaiting_driver_acceptance",
    updated_at: nowIso()
  });

  return updated?.[0] || ride;
}

async function notifyDriverOfMission(driver, ride, dispatch) {
  const body =
    `Harvey Taxi mission available. ` +
    `Pickup: ${clean(ride.pickup_address)}. ` +
    `Dropoff: ${clean(ride.dropoff_address)}. ` +
    `Fare est: $${roundMoney(ride.estimated_total)}. ` +
    `Dispatch ID: ${clean(dispatch.id)}.`;

  return sendSms({
    to: driver.phone,
    body
  });
}

/* =========================================================
   DISPATCH ENGINE
========================================================= */
async function dispatchRideToBestDriver(rideId) {
  const ride = await getRideById(rideId);
  if (!ride) return { ok: false, error: "Ride not found" };

  const currentStatus = normalizeRideStatus(ride.status);
  if (!["awaiting_dispatch", "awaiting_driver_acceptance"].includes(currentStatus)) {
    return { ok: false, error: `Ride is not dispatchable from status ${currentStatus}` };
  }

  const activeDispatch = await getActiveDispatchForRide(ride.id);
  if (activeDispatch) {
    return {
      ok: true,
      reused: true,
      ride,
      dispatch: activeDispatch,
      mission: await getMissionByRideId(ride.id),
      driver: activeDispatch.driver_id ? await getDriverById(activeDispatch.driver_id) : null
    };
  }

  const attempts = await countDispatchAttemptsForRide(ride.id);
  if (attempts >= MAX_DISPATCH_ATTEMPTS) {
    const rows = await updateRows("rides", { id: ride.id }, {
      status: "no_driver_available",
      updated_at: nowIso()
    });

    await logTripEvent({
      ride_id: ride.id,
      rider_id: ride.rider_id,
      event_type: "dispatch_failed_max_attempts",
      details: { attempts, max_attempts: MAX_DISPATCH_ATTEMPTS }
    });

    return {
      ok: false,
      error: "No driver available after max dispatch attempts",
      ride: rows?.[0] || ride
    };
  }

  const candidates = await getCandidateDriversForRide(ride);
  if (!candidates.length) {
    const rows = await updateRows("rides", { id: ride.id }, {
      status: "no_driver_available",
      updated_at: nowIso()
    });

    await logTripEvent({
      ride_id: ride.id,
      rider_id: ride.rider_id,
      event_type: "dispatch_failed_no_candidates",
      details: { requested_mode: ride.requested_mode }
    });

    return {
      ok: false,
      error: "No eligible drivers available",
      ride: rows?.[0] || ride
    };
  }

  const selected = candidates[0];
  const mission = await createMissionForRide(ride, selected.driver, selected.scoring);
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
      score: selected.scoring.score
    }
  });

  await notifyDriverOfMission(selected.driver, updatedRide, dispatch);

  return {
    ok: true,
    reused: false,
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
  const driverType = normalizeDriverType(req.body.driver_type || req.body.driverType || "human");

  if (!firstName) return fail(res, "First name is required");
  if (!lastName) return fail(res, "Last name is required");
  if (!email || !isEmail(email)) return fail(res, "Valid email is required");
  if (!phone) return fail(res, "Valid phone number is required");

  const existingByEmail = await getDriverByEmail(email);
  if (existingByEmail) {
    return ok(res, { message: "Driver already exists", driver: existingByEmail });
  }

  const existingByPhone = await getDriverByPhone(phone);
  if (existingByPhone) {
    return ok(res, { message: "Driver already exists", driver: existingByPhone });
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

  await sendEmail({
    to: email,
    subject: "Harvey Taxi driver signup received",
    text: "Your driver signup was received. Contact verification, identity verification, and approval are required before going online."
  });

  await logAdminEvent({
    event_type: "driver_signup_created",
    target_table: "drivers",
    target_id: driver.id,
    details: { email, phone, driver_type: driverType }
  });

  return ok(res, {
    message: "Driver signup submitted successfully",
    driver
  }, 201);
}));

app.post("/api/driver/status", asyncHandler(async (req, res) => {
  const driver = await resolveDriver(req.body);
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
  const driver = await resolveDriver(req.body);
  if (!driver) return fail(res, "Driver not found", 404);

  if (!driverIsApproved(driver)) {
    return fail(res, "Driver is not approved", 403);
  }

  if (!driverIsVerified(driver)) {
    return fail(res, "Driver verification is required", 403);
  }

  const rows = await updateRows("drivers", { id: driver.id }, {
    is_online: true,
    availability_status: "online",
    updated_at: nowIso()
  });

  return ok(res, {
    message: "Driver is now online",
    driver: rows?.[0] || driver
  });
}));

app.post("/api/driver/go-offline", asyncHandler(async (req, res) => {
  const driver = await resolveDriver(req.body);
  if (!driver) return fail(res, "Driver not found", 404);

  const rows = await updateRows("drivers", { id: driver.id }, {
    is_online: false,
    availability_status: "offline",
    updated_at: nowIso()
  });

  return ok(res, {
    message: "Driver is now offline",
    driver: rows?.[0] || driver
  });
}));

app.post("/api/driver/location", asyncHandler(async (req, res) => {
  const driver = await resolveDriver(req.body);
  if (!driver) return fail(res, "Driver not found", 404);

  const latitude = parseNullableNumber(req.body.latitude ?? req.body.current_latitude ?? req.body.lat);
  const longitude = parseNullableNumber(req.body.longitude ?? req.body.current_longitude ?? req.body.lng);

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return fail(res, "Valid latitude and longitude are required");
  }

  const rows = await updateRows("drivers", { id: driver.id }, {
    current_latitude: latitude,
    current_longitude: longitude,
    last_location_at: nowIso(),
    updated_at: nowIso()
  });

  return ok(res, {
    message: "Driver location updated",
    driver: rows?.[0] || driver
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
    message: result.reused ? "Existing active dispatch found" : "Dispatch offer sent",
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

/* =========================================================
   MISSION ACCEPT / DECLINE
========================================================= */
app.post("/api/mission/accept", asyncHandler(async (req, res) => {
  const driver = await resolveDriver(req.body);
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
  if (clean(dispatch.driver_id) !== clean(driver.id)) return fail(res, "Dispatch mismatch", 403);

  if (new Date(dispatch.expires_at).getTime() < Date.now()) {
    await updateRows("dispatches", { id: dispatch.id }, {
      status: "expired",
      dispatch_status: "expired",
      expired_at: nowIso(),
      updated_at: nowIso()
    });

    await updateRows("missions", { id: mission.id }, {
      status: "expired",
      mission_status: "expired",
      updated_at: nowIso()
    });

    await updateRows("rides", { id: dispatch.ride_id }, {
      driver_id: null,
      mission_id: null,
      dispatch_id: null,
      status: "awaiting_dispatch",
      updated_at: nowIso()
    });

    return fail(res, "Dispatch has expired", 410);
  }

  const ride = await getRideById(dispatch.ride_id);
  if (!ride) return fail(res, "Ride not found", 404);

  const updatedDispatch = await updateRows("dispatches", { id: dispatch.id }, {
    status: "accepted",
    dispatch_status: "accepted",
    accepted_at: nowIso(),
    updated_at: nowIso()
  });

  const updatedMission = await updateRows("missions", { id: mission.id }, {
    status: "accepted",
    mission_status: "accepted",
    accepted_at: nowIso(),
    updated_at: nowIso()
  });

  const updatedRide = await updateRows("rides", { id: ride.id }, {
    driver_id: driver.id,
    mission_id: mission.id,
    dispatch_id: dispatch.id,
    status: "dispatched",
    updated_at: nowIso()
  });

  await logTripEvent({
    ride_id: ride.id,
    rider_id: ride.rider_id,
    driver_id: driver.id,
    mission_id: mission.id,
    event_type: "driver_accepted_dispatch",
    details: { dispatch_id: dispatch.id }
  });

  return ok(res, {
    message: "Mission accepted",
    dispatch: updatedDispatch?.[0] || dispatch,
    mission: updatedMission?.[0] || mission,
    ride: updatedRide?.[0] || ride
  });
}));

app.post("/api/mission/decline", asyncHandler(async (req, res) => {
  const driver = await resolveDriver(req.body);
  if (!driver) return fail(res, "Driver not found", 404);

  const dispatchId = pickFirst(req.body.dispatch_id, req.body.dispatchId);
  const missionId = pickFirst(req.body.mission_id, req.body.missionId);
  const reason = clean(req.body.reason || "driver_declined");

  let dispatch = dispatchId ? await getDispatchById(dispatchId) : null;
  let mission = missionId ? await getMissionById(missionId) : null;

  if (!dispatch && mission?.ride_id) dispatch = await getActiveDispatchForRide(mission.ride_id);
  if (!mission && dispatch?.ride_id) mission = await getMissionByRideId(dispatch.ride_id);

  if (!dispatch) return fail(res, "Dispatch not found", 404);
  if (!mission) return fail(res, "Mission not found", 404);
  if (clean(dispatch.driver_id) !== clean(driver.id)) return fail(res, "Dispatch mismatch", 403);

  await updateRows("dispatches", { id: dispatch.id }, {
    status: "declined",
    dispatch_status: "declined",
    declined_at: nowIso(),
    decline_reason: reason,
    updated_at: nowIso()
  });

  await updateRows("missions", { id: mission.id }, {
    status: "declined",
    mission_status: "declined",
    decline_reason: reason,
    updated_at: nowIso()
  });

  const queuedRideRows = await updateRows("rides", { id: dispatch.ride_id }, {
    driver_id: null,
    mission_id: null,
    dispatch_id: null,
    status: "awaiting_dispatch",
    updated_at: nowIso()
  });

  await logTripEvent({
    ride_id: dispatch.ride_id,
    rider_id: queuedRideRows?.[0]?.rider_id || null,
    driver_id: driver.id,
    mission_id: mission.id,
    event_type: "driver_declined_dispatch",
    details: { dispatch_id: dispatch.id, reason }
  });

  const redispatch = ENABLE_AUTO_REDISPATCH
    ? await dispatchRideToBestDriver(dispatch.ride_id)
    : null;

  return ok(res, {
    message: ENABLE_AUTO_REDISPATCH
      ? "Mission declined and redispatch attempted"
      : "Mission declined",
    ride: queuedRideRows?.[0] || null,
    redispatch
  });
}));

/* =========================================================
   MISSION STATUS LIFECYCLE
========================================================= */
async function updateMissionAndRideStatus(missionId, newStatus, eventType) {
  const mission = await getMissionById(missionId);
  if (!mission) throw new Error("Mission not found");

  const ride = await getRideById(mission.ride_id);
  if (!ride) throw new Error("Ride not found");

  const missionRows = await updateRows("missions", { id: mission.id }, {
    status: newStatus,
    mission_status: newStatus,
    updated_at: nowIso()
  });

  const rideRows = await updateRows("rides", { id: ride.id }, {
    status: newStatus,
    updated_at: nowIso()
  });

  await logTripEvent({
    ride_id: ride.id,
    rider_id: ride.rider_id,
    driver_id: mission.driver_id,
    mission_id: mission.id,
    event_type: eventType,
    details: {}
  });

  return {
    mission: missionRows?.[0] || mission,
    ride: rideRows?.[0] || ride
  };
}

app.post("/api/mission/en-route", asyncHandler(async (req, res) => {
  const result = await updateMissionAndRideStatus(
    pickFirst(req.body.mission_id, req.body.missionId),
    "driver_en_route",
    "driver_en_route"
  );
  return ok(res, { message: "Driver marked en route", ...result });
}));

app.post("/api/mission/arrived", asyncHandler(async (req, res) => {
  const result = await updateMissionAndRideStatus(
    pickFirst(req.body.mission_id, req.body.missionId),
    "arrived",
    "driver_arrived"
  );
  return ok(res, { message: "Driver marked arrived", ...result });
}));

app.post("/api/mission/start-trip", asyncHandler(async (req, res) => {
  const missionId = pickFirst(req.body.mission_id, req.body.missionId);
  const result = await updateMissionAndRideStatus(missionId, "in_progress", "trip_started");

  await updateRows("missions", { id: missionId }, { started_at: nowIso(), updated_at: nowIso() });
  await updateRows("rides", { id: result.ride.id }, { started_at: nowIso(), updated_at: nowIso() });

  return ok(res, { message: "Trip started", ...result });
}));

app.post("/api/mission/complete", asyncHandler(async (req, res) => {
  const missionId = pickFirst(req.body.mission_id, req.body.missionId);
  const result = await updateMissionAndRideStatus(missionId, "completed", "trip_completed");

  await updateRows("missions", { id: missionId }, { completed_at: nowIso(), updated_at: nowIso() });
  await updateRows("rides", { id: result.ride.id }, { completed_at: nowIso(), updated_at: nowIso() });

  return ok(res, { message: "Trip completed", ...result });
}));

/* =========================================================
   AUTO REDISPATCH SWEEP
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

  const results = [];
  for (const dispatch of data || []) {
    await updateRows("dispatches", { id: dispatch.id }, {
      status: "expired",
      dispatch_status: "expired",
      expired_at: nowIso(),
      expiry_reason: "timeout",
      updated_at: nowIso()
    });

    const mission = await getMissionByRideId(dispatch.ride_id);
    if (mission && clean(mission.driver_id) === clean(dispatch.driver_id)) {
      await updateRows("missions", { id: mission.id }, {
        status: "expired",
        mission_status: "expired",
        expiry_reason: "timeout",
        updated_at: nowIso()
      });
    }

    await updateRows("rides", { id: dispatch.ride_id }, {
      driver_id: null,
      mission_id: null,
      dispatch_id: null,
      status: "awaiting_dispatch",
      updated_at: nowIso()
    });

    await logTripEvent({
      ride_id: dispatch.ride_id,
      rider_id: dispatch.rider_id,
      driver_id: dispatch.driver_id,
      mission_id: mission?.id || null,
      event_type: "dispatch_expired",
      details: { dispatch_id: dispatch.id, attempt_number: dispatch.attempt_number }
    });

    const redispatch = ENABLE_AUTO_REDISPATCH
      ? await dispatchRideToBestDriver(dispatch.ride_id)
      : null;

    results.push({
      expired_dispatch_id: dispatch.id,
      ride_id: dispatch.ride_id,
      redispatch_ok: !!redispatch?.ok
    });

    await sleep(25);
  }

  return { ok: true, count: results.length, results };
}

if (ENABLE_AUTO_REDISPATCH) {
  setInterval(async () => {
    try {
      const result = await sweepExpiredDispatches();
      runtimeState.dispatchSweep.lastError = null;
      if (result.count > 0) {
        console.log(`🔁 Dispatch sweep expired ${result.count} dispatch(es)`);
      }
    } catch (error) {
      runtimeState.dispatchSweep.lastError = clean(error?.message || String(error));
      console.error("❌ Dispatch sweep failed:", error);
    }
  }, DISPATCH_SWEEP_INTERVAL_MS);
}/* =========================================================
   PART 4 OF 4
   LIVE STATUS + PAYMENTS + TIPPING + EARNINGS + ADMIN + AI
========================================================= */

/* =========================================================
   PAYMENT / EARNINGS HELPERS
========================================================= */
async function getPaymentById(paymentId) {
  return getRowById("payments", "id", clean(paymentId));
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
    return await insertRow("driver_earnings", {
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
    });
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
  const rows = await updateRows("rides", { id: clean(rideId) }, {
    ...patch,
    updated_at: nowIso()
  });
  return rows?.[0] || null;
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
    is_authorized: normalizedStatus === "authorized" || normalizedStatus === "captured",
    authorization_amount: roundMoney(
      payment.authorization_amount || payment.amount_authorized || payment.amount || 0
    ),
    captured_amount: roundMoney(payment.captured_amount || 0),
    tip_amount: roundMoney(payment.tip_amount || 0),
    currency: clean(payment.currency || "USD")
  };
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
    timeline: await getRideTimeline(ride.id)
  };
}

/* =========================================================
   LIVE RIDE ROUTES
========================================================= */
app.get("/api/rides/:rideId/live", asyncHandler(async (req, res) => {
  const liveState = await buildRideLiveState(req.params.rideId);
  if (!liveState) return fail(res, "Ride not found", 404);
  return ok(res, liveState);
}));

app.get("/api/driver/:driverId/current-ride", asyncHandler(async (req, res) => {
  const driverId = clean(req.params.driverId);

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
  if (!ride) return ok(res, { ride: null });

  return ok(res, await buildRideLiveState(ride.id));
}));

/* =========================================================
   PAYMENT CAPTURE / RELEASE
========================================================= */
app.post("/api/payments/capture", asyncHandler(async (req, res) => {
  const rideId = pickFirst(req.body.ride_id, req.body.rideId);
  if (!rideId) return fail(res, "Ride ID is required");

  const ride = await getRideById(rideId);
  if (!ride) return fail(res, "Ride not found", 404);

  const payment =
    (await getLatestPaymentForRide(ride.id)) ||
    (await getLatestPaymentForRider(ride.rider_id));

  if (!payment) return fail(res, "No payment authorization found", 404);
  if (!paymentIsAuthorized(payment)) {
    return fail(res, "Payment is not authorized for capture", 400, {
      payment: buildPaymentSummary(payment)
    });
  }

  const tipAmount = roundMoney(toNumber(req.body.tip_amount, ride.tip_amount || 0));
  const baseAmount = roundMoney(toNumber(req.body.amount, ride.estimated_total || payment.authorization_amount || 0));
  const captureAmount = roundMoney(baseAmount + tipAmount);

  const updatedPayments = await updateRows("payments", { id: payment.id }, {
    ride_id: ride.id,
    status: "captured",
    payment_status: "captured",
    captured_amount: captureAmount,
    tip_amount: tipAmount,
    captured_at: nowIso(),
    updated_at: nowIso()
  });

  const payoutBase = calculateDriverPayout(
    baseAmount,
    ride.requested_mode === "autonomous" ? "autonomous" : "human"
  );

  const finalDriverPayout = roundMoney(payoutBase.driver_payout_estimate + tipAmount);
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
    ride: updatedRide || ride
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

  const rows = await updateRows("payments", { id: payment.id }, {
    status: "released",
    payment_status: "released",
    released_at: nowIso(),
    updated_at: nowIso()
  });

  if (!ride && payment.ride_id) {
    ride = await getRideById(payment.ride_id);
  }

  if (ride) {
    await updateRideFinancials(ride.id, { payment_status: "released" });
  }

  return ok(res, {
    message: "Payment released successfully",
    payment: rows?.[0] || payment,
    ride: ride || null
  });
}));

/* =========================================================
   TIP ROUTE
========================================================= */
app.post("/api/rides/:rideId/tip", asyncHandler(async (req, res) => {
  const ride = await getRideById(req.params.rideId);
  if (!ride) return fail(res, "Ride not found", 404);

  const tipAmount = roundMoney(toNumber(req.body.tip_amount, 0));
  if (!tipAmount) return fail(res, "Valid tip amount is required");

  const currentTip = roundMoney(ride.tip_amount || 0);
  const newTipTotal = roundMoney(currentTip + tipAmount);
  const baseFare = roundMoney(ride.final_total || ride.estimated_total || 0);
  const payoutBase = calculateDriverPayout(
    baseFare,
    ride.requested_mode === "autonomous" ? "autonomous" : "human"
  );

  const newDriverPayout = roundMoney(payoutBase.driver_payout_estimate + newTipTotal);
  const newFinalTotal = roundMoney(baseFare + tipAmount);
  const newPlatformFee = roundMoney(newFinalTotal - newDriverPayout);

  const updatedRide = await updateRideFinancials(ride.id, {
    tip_amount: newTipTotal,
    final_total: newFinalTotal,
    estimated_driver_payout: newDriverPayout,
    estimated_platform_fee: newPlatformFee
  });

  return ok(res, {
    message: "Tip added successfully",
    ride: updatedRide || ride
  });
}));

/* =========================================================
   DRIVER EARNINGS
========================================================= */
app.get("/api/driver/:driverId/earnings", asyncHandler(async (req, res) => {
  const driver = await getDriverById(req.params.driverId);
  if (!driver) return fail(res, "Driver not found", 404);

  const earnings = await getDriverEarnings(driver.id);
  return ok(res, {
    driver: {
      id: driver.id,
      full_name: getDriverDisplayName(driver),
      driver_type: normalizeDriverType(driver.driver_type || "human")
    },
    earnings
  });
}));

/* =========================================================
   AI SUPPORT / OPERATIONS
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
    return "I can help with rider approval, driver onboarding, ride requests, payment authorization, trip status, dispatch, and Harvey Taxi support.";
  }

  if (text.includes("emergency") || text.includes("911")) {
    return "Harvey Taxi is not an emergency service. Call 911 for emergencies.";
  }

  if (text.includes("rider") || normalizedPage === "rider") {
    return "Riders must be approved before they can request rides. Payment authorization may also be required before dispatch.";
  }

  if (text.includes("driver") || normalizedPage === "driver") {
    return "Drivers must complete signup, verification, and approval before going online and receiving missions.";
  }

  if (text.includes("payment")) {
    return "Harvey Taxi authorizes payment before dispatch and can capture payment when the ride is completed.";
  }

  if (text.includes("dispatch") || text.includes("operations")) {
    return "Harvey Taxi dispatch prioritizes eligible drivers and can automatically redispatch expired offers.";
  }

  return "I can help with rides, driver onboarding, payments, dispatch, and support questions.";
}

async function generateAiSupportReply({ message, page = "general", ride_id = "" }) {
  const fallback = getFallbackReply(message, page);

  if (!openai || !ENABLE_AI_BRAIN) {
    return { reply: fallback, source: "fallback" };
  }

  let rideContext = null;
  if (ride_id) {
    try {
      rideContext = await buildRideLiveState(ride_id);
    } catch (error) {
      console.warn("⚠️ AI ride context load failed:", error.message);
    }
  }

  try {
    const response = await openai.responses.create({
      model: OPENAI_SUPPORT_MODEL,
      input: [
        {
          role: "system",
          content:
            "You are Harvey Taxi AI Support. Be concise, clear, calm, and accurate. Never invent policies."
        },
        {
          role: "user",
          content: `Page: ${normalizePage(page)}\nRide Context: ${JSON.stringify(rideContext || {})}\nUser Message: ${message}`
        }
      ]
    });

    return {
      reply: clean(response?.output_text || "") || fallback,
      source: "openai"
    };
  } catch (error) {
    console.warn("⚠️ OpenAI support failed:", error.message);
    return { reply: fallback, source: "fallback" };
  }
}

async function buildOperationsSnapshot() {
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
    totalRides,
    activeRides,
    awaitingDispatch,
    noDriverAvailable,
    onlineDrivers
  ] = await Promise.all([
    countTable("rides"),
    countTable("rides", [{ op: "in", column: "status", value: ["awaiting_driver_acceptance", "dispatched", "driver_en_route", "arrived", "in_progress"] }]),
    countTable("rides", [{ op: "eq", column: "status", value: "awaiting_dispatch" }]),
    countTable("rides", [{ op: "eq", column: "status", value: "no_driver_available" }]),
    countTable("drivers", [{ op: "in", column: "availability_status", value: ["online", "available", "ready", "active"] }])
  ]);

  return {
    generated_at: nowIso(),
    total_rides: totalRides,
    active_rides: activeRides,
    awaiting_dispatch: awaitingDispatch,
    no_driver_available: noDriverAvailable,
    online_drivers: onlineDrivers
  };
}

app.post("/api/ai/support", asyncHandler(async (req, res) => {
  const message = clean(req.body.message || req.body.prompt || "");
  const page = normalizePage(req.body.page || req.body.context_page || "general");
  const ride_id = pickFirst(req.body.ride_id, req.body.rideId);

  if (!message) return fail(res, "Message is required");

  const result = await generateAiSupportReply({ message, page, ride_id });
  return ok(res, {
    reply: result.reply,
    source: result.source,
    page
  });
}));

app.get("/api/admin/ai/operations", requireAdmin, asyncHandler(async (req, res) => {
  const snapshot = await buildOperationsSnapshot();
  return ok(res, {
    snapshot,
    ai_operations: runtimeState.aiOperations
  });
}));

/* =========================================================
   ADMIN ROUTES
========================================================= */
app.post("/api/admin/rider/approve", requireAdmin, asyncHandler(async (req, res) => {
  const riderId = pickFirst(req.body.rider_id, req.body.riderId);
  if (!riderId) return fail(res, "Rider ID is required");

  const rider = await getRiderById(riderId);
  if (!rider) return fail(res, "Rider not found", 404);

  const rows = await updateRows("riders", { id: rider.id }, {
    status: "approved",
    approval_status: "approved",
    verification_status: "approved",
    updated_at: nowIso()
  });

  return ok(res, {
    message: "Rider approved successfully",
    rider: buildRiderStatusResponse(rows?.[0] || rider)
  });
}));

app.post("/api/admin/driver/approve", requireAdmin, asyncHandler(async (req, res) => {
  const driverId = pickFirst(req.body.driver_id, req.body.driverId);
  if (!driverId) return fail(res, "Driver ID is required");

  const driver = await getDriverById(driverId);
  if (!driver) return fail(res, "Driver not found", 404);

  const rows = await updateRows("drivers", { id: driver.id }, {
    status: "approved",
    approval_status: "approved",
    verification_status: "approved",
    updated_at: nowIso()
  });

  return ok(res, {
    message: "Driver approved successfully",
    driver: rows?.[0] || driver
  });
}));

app.post("/api/admin/driver/verify-contact", requireAdmin, asyncHandler(async (req, res) => {
  const driverId = pickFirst(req.body.driver_id, req.body.driverId);
  if (!driverId) return fail(res, "Driver ID is required");

  const driver = await getDriverById(driverId);
  if (!driver) return fail(res, "Driver not found", 404);

  const rows = await updateRows("drivers", { id: driver.id }, {
    email_verified: true,
    sms_verified: true,
    updated_at: nowIso()
  });

  return ok(res, {
    message: "Driver email and SMS marked verified",
    driver: rows?.[0] || driver
  });
}));

app.get("/api/admin/analytics/overview", requireAdmin, asyncHandler(async (req, res) => {
  const snapshot = await buildOperationsSnapshot();
  return ok(res, {
    generated_at: nowIso(),
    counts: snapshot,
    dispatch: runtimeState.dispatchSweep,
    ai_operations: runtimeState.aiOperations
  });
}));

/* =========================================================
   SUPPORT FAQ
========================================================= */
app.get("/api/support/faq", asyncHandler(async (req, res) => {
  return ok(res, {
    faqs: [
      {
        question: "Can riders request a ride immediately after signup?",
        answer: "No. Riders must be approved first. Payment authorization may also be required before dispatch."
      },
      {
        question: "What does a driver need before going online?",
        answer: "Drivers need signup completion, verification, approval, and then they can go online to receive missions."
      },
      {
        question: "When is payment captured?",
        answer: "Payment is typically authorized before dispatch and captured when the ride is completed."
      },
      {
        question: "Can riders tip drivers?",
        answer: "Yes. Tipping is supported during or after the trip."
      }
    ]
  });
}));

/* =========================================================
   NOT FOUND / ERROR HANDLERS
========================================================= */
app.use((req, res) => {
  return fail(res, "Route not found", 404, {
    method: req.method,
    path: req.originalUrl
  });
});

app.use((error, req, res, next) => {
  console.error("❌ Express fatal error:", error);
  if (res.headersSent) return next(error);

  return res.status(500).json({
    ok: false,
    error: "Internal server error",
    details: IS_PROD ? undefined : clean(error?.message || String(error))
  });
});

/* =========================================================
   GRACEFUL SHUTDOWN
========================================================= */
function shutdown(signal) {
  if (runtimeState.process.shuttingDown) return;
  runtimeState.process.shuttingDown = true;

  console.log(`⚠️ Received ${signal}. Shutting down gracefully...`);

  server.close(() => {
    console.log("✅ HTTP server closed");
    process.exit(0);
  });

  setTimeout(() => {
    console.error("❌ Forced shutdown after timeout");
    process.exit(1);
  }, 10000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

/* =========================================================
   START SERVER
========================================================= */
async function startServer() {
  try {
    await runStartupChecks();

    server.listen(PORT, () => {
      console.log("====================================================");
      console.log(`🚕 ${APP_NAME} running`);
      console.log(`🌐 Port: ${PORT}`);
      console.log(`🛠️ Environment: ${NODE_ENV}`);
      console.log(`🕒 Started: ${SERVER_STARTED_AT}`);
      console.log(`🧠 AI Enabled: ${!!openai}`);
      console.log(`🗄️ Supabase Ready: ${!!supabase}`);
      console.log(`📲 Twilio Ready: ${!!twilioClient}`);
      console.log(`📧 SMTP Ready: ${!!emailTransporter}`);
      console.log(`🤖 AI Dispatch Enabled: ${ENABLE_AI_DISPATCH}`);
      console.log(`🏢 AI Operations Enabled: ${ENABLE_AI_OPERATIONS}`);
      console.log("====================================================");
    });
  } catch (error) {
    console.error("❌ Failed to start server:", error);
    process.exit(1);
  }
}

startServer();

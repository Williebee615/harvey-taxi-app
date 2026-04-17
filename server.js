/* =========================================================
   HARVEY TAXI — CODE BLUE PHASE 12
   PART 1 OF 4
   FOUNDATION + ENV + SECURITY CORE + REALTIME + MIDDLEWARE + HELPERS
   INSURANCE + PREFERRED DRIVER + NONPROFIT BENEFITS FOUNDATION
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
const EventEmitter = require("events");
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
    console.warn("⚠️ node-fetch not installed. External HTTP helpers may fail.");
  }
}

/* =========================================================
   APP INIT
========================================================= */
const app = express();
const server = http.createServer(app);

/* =========================================================
   APP CONSTANTS
========================================================= */
const APP_NAME = "Harvey Taxi Code Blue Phase 12";
const PORT = Number(process.env.PORT || 10000);
const NODE_ENV = String(process.env.NODE_ENV || "development").toLowerCase();
const IS_PROD = NODE_ENV === "production";
const SERVER_STARTED_AT = new Date().toISOString();

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
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toBool(value, fallback = false) {
  const v = lower(value);
  if (!v) return fallback;
  if (["1", "true", "yes", "y", "on", "enabled"].includes(v)) return true;
  if (["0", "false", "no", "n", "off", "disabled"].includes(v)) return false;
  return fallback;
}

function nowIso() {
  return new Date().toISOString();
}

function createId(prefix = "id") {
  if (typeof crypto.randomUUID === "function") {
    return `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`;
  }
  return `${prefix}_${crypto.randomBytes(16).toString("hex")}`;
}

function roundMoney(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function safeJsonParse(value, fallback = null) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function parseNullableNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function isObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function omitUndefined(obj = {}) {
  return Object.fromEntries(
    Object.entries(obj).filter(([, value]) => value !== undefined)
  );
}

function pickFirst(...values) {
  for (const value of values) {
    const v = clean(value);
    if (v) return v;
  }
  return "";
}

function normalizePhone(value = "") {
  const raw = clean(value).replace(/[^\d+]/g, "");
  if (!raw) return "";
  if (raw.startsWith("+")) return raw;
  if (raw.length === 10) return `+1${raw}`;
  if (raw.length === 11 && raw.startsWith("1")) return `+${raw}`;
  return raw;
}

function isEmail(value = "") {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean(value));
}

function safeEqual(a = "", b = "") {
  const aBuf = Buffer.from(String(a));
  const bBuf = Buffer.from(String(b));
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function haversineMiles(lat1, lon1, lat2, lon2) {
  if (
    !Number.isFinite(Number(lat1)) ||
    !Number.isFinite(Number(lon1)) ||
    !Number.isFinite(Number(lat2)) ||
    !Number.isFinite(Number(lon2))
  ) {
    return null;
  }

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

/* =========================================================
   NEW PHASE 12 FOUNDATION HELPERS
========================================================= */
function toDateMs(value) {
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function daysUntil(value) {
  const ms = toDateMs(value);
  if (!ms) return null;
  return Math.floor((ms - Date.now()) / (1000 * 60 * 60 * 24));
}

function isFutureDate(value) {
  const ms = toDateMs(value);
  return !!ms && ms > Date.now();
}

function uniqueArray(values = []) {
  return [...new Set((values || []).filter(Boolean))];
}

function normalizeInsuranceStatus(value = "") {
  const v = lower(value);
  if (!v) return "missing";
  if (["active", "approved", "verified", "valid"].includes(v)) return "active";
  if (["pending", "submitted", "review"].includes(v)) return "pending";
  if (["expired"].includes(v)) return "expired";
  if (["rejected", "denied"].includes(v)) return "rejected";
  if (["missing", "none"].includes(v)) return "missing";
  if (["suspended", "blocked", "invalid"].includes(v)) return "blocked";
  return v;
}

function normalizeComplianceStatus(value = "") {
  const v = lower(value);
  if (!v) return "pending";
  if (["approved", "clear", "ready", "compliant"].includes(v)) return "approved";
  if (["pending", "review", "under_review"].includes(v)) return "pending";
  if (["blocked", "hold", "held", "compliance_blocked"].includes(v)) return "blocked";
  if (["expired"].includes(v)) return "expired";
  if (["rejected", "denied"].includes(v)) return "rejected";
  return v;
}

function normalizeBenefitType(value = "") {
  const v = lower(value);
  if (!v) return "none";
  if (["medical", "medical_transport"].includes(v)) return "medical";
  if (["work", "employment"].includes(v)) return "work";
  if (["school", "education"].includes(v)) return "school";
  if (["community", "essential", "essential_access"].includes(v)) return "community";
  if (["sponsored", "foundation", "charity", "nonprofit"].includes(v)) return "foundation";
  return v;
}

function normalizePreferredDriverPolicy(value = "") {
  const v = lower(value);
  if (!v) return "fallback_allowed";
  if (["required", "only", "strict"].includes(v)) return "required";
  if (["preferred", "first", "preferred_first"].includes(v)) return "preferred_first";
  return "fallback_allowed";
}

function insuranceIsActive(driver = {}) {
  const status = normalizeInsuranceStatus(
    driver.insurance_status ||
    driver.driver_insurance_status ||
    driver.compliance_insurance_status
  );

  const expiration =
    clean(driver.insurance_expiration_date) ||
    clean(driver.insurance_expiration) ||
    clean(driver.policy_expiration_date);

  return status === "active" && isFutureDate(expiration);
}

function driverHasRequiredInsurance(driver = {}) {
  const insuranceVerified = toBool(
    driver.insurance_verified ??
    driver.driver_insurance_verified ??
    false,
    false
  );

  const tncConfirmed = toBool(
    driver.tnc_endorsement_confirmed ??
    driver.commercial_use_confirmed ??
    false,
    false
  );

  return insuranceVerified && tncConfirmed && insuranceIsActive(driver);
}

function calculateNonprofitBenefitEstimate({
  estimatedTotal = 0,
  benefitPercent = 0,
  riderCopay = null
} = {}) {
  const total = Math.max(0, Number(estimatedTotal) || 0);
  const percent = clamp(Number(benefitPercent || 0), 0, 1);
  const sponsoredAmount = roundMoney(total * percent);

  if (riderCopay !== null && Number.isFinite(Number(riderCopay))) {
    const copay = Math.max(0, roundMoney(riderCopay));
    return {
      estimated_total: roundMoney(total),
      sponsored_amount: roundMoney(Math.min(total, total - copay)),
      rider_copay_amount: roundMoney(Math.min(total, copay)),
      sponsorship_percent: roundMoney(total > 0 ? (Math.min(total, total - copay) / total) : 0)
    };
  }

  return {
    estimated_total: roundMoney(total),
    sponsored_amount: sponsoredAmount,
    rider_copay_amount: roundMoney(total - sponsoredAmount),
    sponsorship_percent: roundMoney(percent)
  };
}

/* =========================================================
   ENV
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
  clean(process.env.SUPPORT_ADMIN_PASSWORD) ||
  "";

/* =========================================================
   FEATURE FLAGS
========================================================= */
const ENABLE_AI_BRAIN = toBool(process.env.ENABLE_AI_BRAIN, true);
const ENABLE_AI_DISPATCH = toBool(process.env.ENABLE_AI_DISPATCH, true);
const ENABLE_AI_OPERATIONS = toBool(process.env.ENABLE_AI_OPERATIONS, true);
const ENABLE_AI_SECURITY_BRAIN = toBool(process.env.ENABLE_AI_SECURITY_BRAIN, true);

const ENABLE_REAL_SMS = toBool(process.env.ENABLE_REAL_SMS, false);
const ENABLE_REAL_EMAIL = toBool(process.env.ENABLE_REAL_EMAIL, false);

const ENABLE_RIDER_VERIFICATION_GATE = toBool(process.env.ENABLE_RIDER_VERIFICATION_GATE, true);
const ENABLE_PAYMENT_GATE = toBool(process.env.ENABLE_PAYMENT_GATE, true);

const ENABLE_DRIVER_LOCATION_TRACKING = toBool(process.env.ENABLE_DRIVER_LOCATION_TRACKING, true);
const ENABLE_DRIVER_HEARTBEAT = toBool(process.env.ENABLE_DRIVER_HEARTBEAT, true);
const ENABLE_AUTO_REDISPATCH = toBool(process.env.ENABLE_AUTO_REDISPATCH, true);
const ENABLE_REALTIME_EVENTS = toBool(process.env.ENABLE_REALTIME_EVENTS, true);
const ENABLE_STARTUP_TABLE_CHECKS = toBool(process.env.ENABLE_STARTUP_TABLE_CHECKS, true);

/* =========================================================
   NEW PHASE 12 FEATURE FLAGS
========================================================= */
const ENABLE_DRIVER_INSURANCE_GATE = toBool(
  process.env.ENABLE_DRIVER_INSURANCE_GATE,
  true
);

const ENABLE_DRIVER_COMPLIANCE_GATE = toBool(
  process.env.ENABLE_DRIVER_COMPLIANCE_GATE,
  true
);

const ENABLE_PREFERRED_DRIVER_SYSTEM = toBool(
  process.env.ENABLE_PREFERRED_DRIVER_SYSTEM,
  true
);

const ENABLE_NONPROFIT_BENEFITS = toBool(
  process.env.ENABLE_NONPROFIT_BENEFITS,
  true
);

const ENABLE_SPONSORED_RIDES = toBool(
  process.env.ENABLE_SPONSORED_RIDES,
  true
);

const ENABLE_COMPLIANCE_SWEEPS = toBool(
  process.env.ENABLE_COMPLIANCE_SWEEPS,
  true
);

const ENABLE_DRIVER_INSURANCE_EXPIRY_WARNINGS = toBool(
  process.env.ENABLE_DRIVER_INSURANCE_EXPIRY_WARNINGS,
  true
);

/* =========================================================
   TIMERS / THRESHOLDS
========================================================= */
const DRIVER_HEARTBEAT_STALE_MS = clamp(
  toNumber(process.env.DRIVER_HEARTBEAT_STALE_MS, 90_000),
  15_000,
  600_000
);

const REALTIME_KEEPALIVE_MS = clamp(
  toNumber(process.env.REALTIME_KEEPALIVE_MS, 20_000),
  5_000,
  60_000
);

const DISPATCH_TIMEOUT_SECONDS = clamp(
  toNumber(process.env.DISPATCH_TIMEOUT_SECONDS, 30),
  10,
  180
);

const DISPATCH_SWEEP_INTERVAL_MS = clamp(
  toNumber(process.env.DISPATCH_SWEEP_INTERVAL_MS, 15_000),
  5_000,
  120_000
);

const MAX_DISPATCH_ATTEMPTS = clamp(
  toNumber(process.env.MAX_DISPATCH_ATTEMPTS, 5),
  1,
  20
);

const DISPATCH_BATCH_LIMIT = clamp(
  toNumber(process.env.DISPATCH_BATCH_LIMIT, 50),
  1,
  200
);

/* =========================================================
   NEW PHASE 12 COMPLIANCE / BENEFITS THRESHOLDS
========================================================= */
const INSURANCE_EXPIRY_WARNING_DAYS_1 = clamp(
  toNumber(process.env.INSURANCE_EXPIRY_WARNING_DAYS_1, 30),
  1,
  365
);

const INSURANCE_EXPIRY_WARNING_DAYS_2 = clamp(
  toNumber(process.env.INSURANCE_EXPIRY_WARNING_DAYS_2, 14),
  1,
  365
);

const INSURANCE_EXPIRY_WARNING_DAYS_3 = clamp(
  toNumber(process.env.INSURANCE_EXPIRY_WARNING_DAYS_3, 7),
  1,
  365
);

const COMPLIANCE_SWEEP_INTERVAL_MS = clamp(
  toNumber(process.env.COMPLIANCE_SWEEP_INTERVAL_MS, 60_000),
  10_000,
  3_600_000
);

const NONPROFIT_DEFAULT_SPONSORSHIP_PERCENT = clamp(
  toNumber(process.env.NONPROFIT_DEFAULT_SPONSORSHIP_PERCENT, 0.25),
  0,
  1
);

const NONPROFIT_MAX_SPONSORSHIP_PERCENT = clamp(
  toNumber(process.env.NONPROFIT_MAX_SPONSORSHIP_PERCENT, 1),
  0,
  1
);

/* =========================================================
   FARE / PAYOUT CONFIG
========================================================= */
const FARE_BASE = toNumber(process.env.FARE_BASE, 5.5);
const FARE_PER_MILE = toNumber(process.env.FARE_PER_MILE, 2.15);
const FARE_PER_MINUTE = toNumber(process.env.FARE_PER_MINUTE, 0.42);
const FARE_BOOKING_FEE = toNumber(process.env.FARE_BOOKING_FEE, 2.5);
const FARE_MINIMUM = toNumber(process.env.FARE_MINIMUM, 10);

const DRIVER_PAYOUT_PERCENT_STANDARD = clamp(
  toNumber(process.env.DRIVER_PAYOUT_PERCENT_STANDARD, 0.75),
  0.1,
  0.95
);

const DRIVER_PAYOUT_PERCENT_AUTONOMOUS = clamp(
  toNumber(process.env.DRIVER_PAYOUT_PERCENT_AUTONOMOUS, 0.25),
  0.0,
  0.95
);

const SURGE_MULTIPLIER_DEFAULT = Math.max(
  1,
  toNumber(process.env.SURGE_MULTIPLIER_DEFAULT, 1.0)
);

/* =========================================================
   DISPATCH SCORING WEIGHTS
========================================================= */
const SCORE_DISTANCE_WEIGHT = clamp(
  toNumber(process.env.SCORE_DISTANCE_WEIGHT, 0.45),
  0,
  1
);

const SCORE_RATING_WEIGHT = clamp(
  toNumber(process.env.SCORE_RATING_WEIGHT, 0.2),
  0,
  1
);

const SCORE_ACCEPTANCE_WEIGHT = clamp(
  toNumber(process.env.SCORE_ACCEPTANCE_WEIGHT, 0.2),
  0,
  1
);

const SCORE_COMPLETION_WEIGHT = clamp(
  toNumber(process.env.SCORE_COMPLETION_WEIGHT, 0.1),
  0,
  1
);

const SCORE_ACTIVITY_WEIGHT = clamp(
  toNumber(process.env.SCORE_ACTIVITY_WEIGHT, 0.05),
  0,
  1
);

/* =========================================================
   AI SECURITY THRESHOLDS
========================================================= */
const RISK_REVIEW_THRESHOLD = clamp(
  toNumber(process.env.RISK_REVIEW_THRESHOLD, 45),
  1,
  100
);

const RISK_HIGH_THRESHOLD = clamp(
  toNumber(process.env.RISK_HIGH_THRESHOLD, 70),
  1,
  100
);

const RISK_CRITICAL_THRESHOLD = clamp(
  toNumber(process.env.RISK_CRITICAL_THRESHOLD, 85),
  1,
  100
);

/* =========================================================
   THIRD-PARTY ENV
========================================================= */
const SUPABASE_URL = clean(process.env.SUPABASE_URL);
const SUPABASE_SERVICE_ROLE_KEY = clean(process.env.SUPABASE_SERVICE_ROLE_KEY);

const OPENAI_API_KEY = clean(process.env.OPENAI_API_KEY);
const OPENAI_SUPPORT_MODEL = clean(process.env.OPENAI_SUPPORT_MODEL || "gpt-4.1-mini");
const OPENAI_OPERATIONS_MODEL = clean(process.env.OPENAI_OPERATIONS_MODEL || "gpt-4.1-mini");
const OPENAI_SECURITY_MODEL = clean(process.env.OPENAI_SECURITY_MODEL || "gpt-4.1-mini");

const TWILIO_ACCOUNT_SID = clean(process.env.TWILIO_ACCOUNT_SID);
const TWILIO_AUTH_TOKEN = clean(process.env.TWILIO_AUTH_TOKEN);
const TWILIO_FROM_NUMBER =
  clean(process.env.TWILIO_FROM_NUMBER) ||
  clean(process.env.TWILIO_PHONE_NUMBER);

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
    running: false,
    timerStarted: false,
    lastRanAt: null,
    lastError: null
  },
  aiOperations: {
    enabled: ENABLE_AI_OPERATIONS,
    lastRecommendationAt: null,
    lastRecommendationError: null
  },
  aiSecurity: {
    enabled: ENABLE_AI_SECURITY_BRAIN,
    lastAssessmentAt: null,
    lastAssessmentError: null
  },
  realtime: {
    enabled: ENABLE_REALTIME_EVENTS,
    riderStreams: new Map(),
    driverStreams: new Map(),
    adminStreams: new Map(),
    keepAliveStarted: false
  },
  process: {
    shuttingDown: false
  },

  /* =========================================================
     NEW PHASE 12 RUNTIME STATE
  ========================================================= */
  complianceSweep: {
    enabled: ENABLE_COMPLIANCE_SWEEPS,
    running: false,
    timerStarted: false,
    lastRanAt: null,
    lastError: null
  },
  insurance: {
    enabled: ENABLE_DRIVER_INSURANCE_GATE,
    lastSweepAt: null,
    lastSweepError: null
  },
  preferredDriver: {
    enabled: ENABLE_PREFERRED_DRIVER_SYSTEM
  },
  nonprofitBenefits: {
    enabled: ENABLE_NONPROFIT_BENEFITS,
    sponsoredRidesEnabled: ENABLE_SPONSORED_RIDES
  }
};

/* =========================================================
   REALTIME EVENT BUS
========================================================= */
const realtimeBus = new EventEmitter();
realtimeBus.setMaxListeners(1000);

function writeSse(res, eventName, payload) {
  if (!res || res.writableEnded) return;
  res.write(`event: ${eventName}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function openSseStream(res) {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  if (typeof res.flushHeaders === "function") {
    res.flushHeaders();
  }

  writeSse(res, "connected", {
    ok: true,
    connected_at: nowIso()
  });
}

function closeTrackedStream(map, key, res) {
  const list = map.get(key) || [];
  const next = list.filter((item) => item !== res && !item.writableEnded);
  if (next.length) map.set(key, next);
  else map.delete(key);
}

function addTrackedStream(map, key, res) {
  const list = map.get(key) || [];
  list.push(res);
  map.set(key, list);

  res.on("close", () => {
    closeTrackedStream(map, key, res);
  });
}

function emitToTrackedStreams(map, key, eventName, payload) {
  const list = map.get(key) || [];
  const alive = [];

  for (const res of list) {
    if (!res.writableEnded) {
      writeSse(res, eventName, payload);
      alive.push(res);
    }
  }

  if (alive.length) map.set(key, alive);
  else map.delete(key);
}

function emitRideRealtime(rideId, payload = {}) {
  if (!ENABLE_REALTIME_EVENTS || !rideId) return;
  realtimeBus.emit("ride_event", {
    ride_id: clean(rideId),
    ...payload,
    emitted_at: nowIso()
  });
}

function emitDriverRealtime(driverId, payload = {}) {
  if (!ENABLE_REALTIME_EVENTS || !driverId) return;
  realtimeBus.emit("driver_event", {
    driver_id: clean(driverId),
    ...payload,
    emitted_at: nowIso()
  });
}

function emitAdminRealtime(payload = {}) {
  if (!ENABLE_REALTIME_EVENTS) return;
  realtimeBus.emit("admin_event", {
    ...payload,
    emitted_at: nowIso()
  });
}

function emitSecurityRealtime(payload = {}) {
  if (!ENABLE_REALTIME_EVENTS) return;
  realtimeBus.emit("security_event", {
    ...payload,
    emitted_at: nowIso()
  });
}

/* =========================================================
   NEW PHASE 12 REALTIME EMITTERS
========================================================= */
function emitComplianceRealtime(payload = {}) {
  if (!ENABLE_REALTIME_EVENTS) return;
  realtimeBus.emit("compliance_event", {
    ...payload,
    emitted_at: nowIso()
  });
}

function emitBenefitsRealtime(payload = {}) {
  if (!ENABLE_REALTIME_EVENTS) return;
  realtimeBus.emit("benefit_event", {
    ...payload,
    emitted_at: nowIso()
  });
}

function startRealtimeKeepAliveLoop() {
  if (!ENABLE_REALTIME_EVENTS || runtimeState.realtime.keepAliveStarted) return;
  runtimeState.realtime.keepAliveStarted = true;

  setInterval(() => {
    const payload = { ts: nowIso() };

    for (const [key, streams] of runtimeState.realtime.riderStreams.entries()) {
      const alive = streams.filter((res) => !res.writableEnded);
      alive.forEach((res) => writeSse(res, "ping", payload));
      if (alive.length) runtimeState.realtime.riderStreams.set(key, alive);
      else runtimeState.realtime.riderStreams.delete(key);
    }

    for (const [key, streams] of runtimeState.realtime.driverStreams.entries()) {
      const alive = streams.filter((res) => !res.writableEnded);
      alive.forEach((res) => writeSse(res, "ping", payload));
      if (alive.length) runtimeState.realtime.driverStreams.set(key, alive);
      else runtimeState.realtime.driverStreams.delete(key);
    }

    for (const [key, streams] of runtimeState.realtime.adminStreams.entries()) {
      const alive = streams.filter((res) => !res.writableEnded);
      alive.forEach((res) => writeSse(res, "ping", payload));
      if (alive.length) runtimeState.realtime.adminStreams.set(key, alive);
      else runtimeState.realtime.adminStreams.delete(key);
    }
  }, REALTIME_KEEPALIVE_MS);
}

realtimeBus.on("ride_event", (payload) => {
  emitToTrackedStreams(
    runtimeState.realtime.riderStreams,
    clean(payload.ride_id),
    "ride_update",
    payload
  );

  emitToTrackedStreams(
    runtimeState.realtime.adminStreams,
    "global",
    "ride_update",
    payload
  );
});

realtimeBus.on("driver_event", (payload) => {
  emitToTrackedStreams(
    runtimeState.realtime.driverStreams,
    clean(payload.driver_id),
    "driver_update",
    payload
  );

  emitToTrackedStreams(
    runtimeState.realtime.adminStreams,
    "global",
    "driver_update",
    payload
  );
});

realtimeBus.on("admin_event", (payload) => {
  emitToTrackedStreams(
    runtimeState.realtime.adminStreams,
    "global",
    "admin_update",
    payload
  );
});

realtimeBus.on("security_event", (payload) => {
  emitToTrackedStreams(
    runtimeState.realtime.adminStreams,
    "global",
    "security_update",
    payload
  );
});

realtimeBus.on("compliance_event", (payload) => {
  emitToTrackedStreams(
    runtimeState.realtime.adminStreams,
    "global",
    "compliance_update",
    payload
  );
});

realtimeBus.on("benefit_event", (payload) => {
  emitToTrackedStreams(
    runtimeState.realtime.adminStreams,
    "global",
    "benefit_update",
    payload
  );
});

/* =========================================================
   REQUEST ID + BODY PARSERS
========================================================= */
app.use((req, res, next) => {
  req.requestId =
    clean(req.headers["x-request-id"]) ||
    clean(req.headers["x-correlation-id"]) ||
    createId("req");

  res.setHeader("x-request-id", req.requestId);
  next();
});

app.use(express.json({
  limit: "10mb",
  verify: (req, _res, buf) => {
    req.rawBody = buf ? buf.toString("utf8") : "";
  }
}));

app.use(express.urlencoded({
  extended: true,
  limit: "10mb"
}));

app.use(cors({ origin: true, credentials: true }));
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

function applyBasicRateLimit({ key, limit = 60, windowMs = 60_000 }) {
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
    "/api/rider/signup",
    "/api/request-ride",
    "/api/ai/support",
    "/api/persona/webhook",
    "/api/driver/location",
    "/api/driver/heartbeat",
    "/api/payments/authorize",
    "/api/driver/insurance/upload",
    "/api/rider/favorite-driver",
    "/api/benefits/apply"
  ];

  if (!limitedPaths.some((p) => req.originalUrl.startsWith(p))) {
    return next();
  }

  const pathLimit =
    req.path === "/api/ai/support" ? 25 :
    req.path === "/api/persona/webhook" ? 120 :
    80;

  const result = applyBasicRateLimit({
    key: `${ip}:${req.path}`,
    limit: pathLimit,
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
  if (["arrived", "driver_arrived"].includes(v)) return "arrived";
  if (["in_progress", "on_trip"].includes(v)) return "in_progress";
  if (["completed", "finished"].includes(v)) return "completed";
  if (["cancelled", "canceled"].includes(v)) return "cancelled";
  if (["no_driver", "no_driver_available"].includes(v)) return "no_driver_available";
  if (["expired"].includes(v)) return "expired";
  if (["security_review"].includes(v)) return "security_review";
  if (["compliance_review"].includes(v)) return "compliance_review";
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
  if (["security_locked"].includes(v)) return "security_locked";
  if (["compliance_blocked", "insurance_blocked"].includes(v)) return "compliance_blocked";
  return v;
}

function normalizeRiderStatus(value = "") {
  const v = lower(value);
  if (!v) return "pending";
  if (["pending", "new"].includes(v)) return "pending";
  if (["approved", "verified", "active"].includes(v)) return "approved";
  if (["rejected", "denied"].includes(v)) return "rejected";
  if (["suspended"].includes(v)) return "suspended";
  if (["security_locked"].includes(v)) return "security_locked";
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
   NEW PHASE 12 COMPLIANCE / BENEFITS HELPERS
========================================================= */
async function logComplianceEvent({
  subject_type,
  subject_id,
  event_type,
  severity = "info",
  details = {}
}) {
  try {
    const tableAccessible = await maybeSingle(
      requireSupabase()
        .from("driver_compliance_audit")
        .select("*")
    ).catch(() => null);

    void tableAccessible;

    await requireSupabase().from("driver_compliance_audit").insert({
      id: createId("cmp"),
      subject_type: clean(subject_type || "driver"),
      subject_id: clean(subject_id || ""),
      event_type: clean(event_type || "compliance_event"),
      severity: clean(severity || "info"),
      details: isObject(details) ? details : { value: details },
      created_at: nowIso()
    });
  } catch (error) {
    console.warn("⚠️ Compliance audit insert skipped:", error.message);
  }
}

async function logBenefitEvent({
  rider_id = null,
  ride_id = null,
  application_id = null,
  event_type,
  details = {}
}) {
  try {
    await requireSupabase().from("benefit_transactions").insert({
      id: createId("benefit"),
      rider_id: clean(rider_id) || null,
      ride_id: clean(ride_id) || null,
      application_id: clean(application_id) || null,
      event_type: clean(event_type || "benefit_event"),
      details: isObject(details) ? details : { value: details },
      created_at: nowIso(),
      updated_at: nowIso()
    });
  } catch (error) {
    console.warn("⚠️ Benefit transaction insert skipped:", error.message);
  }
}

/* =========================================================
   SECURITY BRAIN HELPERS
========================================================= */
function getSeverityFromScore(score = 0) {
  if (score >= RISK_CRITICAL_THRESHOLD) return "critical";
  if (score >= RISK_HIGH_THRESHOLD) return "high";
  if (score >= RISK_REVIEW_THRESHOLD) return "medium";
  return "low";
}

async function getOpenAIClientSafe() {
  if (!OpenAI || !OPENAI_API_KEY || !ENABLE_AI_SECURITY_BRAIN) return null;
  try {
    return new OpenAI({ apiKey: OPENAI_API_KEY });
  } catch (error) {
    console.warn("⚠️ AI security OpenAI init failed:", error.message);
    return null;
  }
}

async function writeSecurityEvent({
  subjectType,
  subjectId,
  eventType,
  title,
  summary,
  riskScore,
  severity,
  evidence = {},
  aiAnalysis = {},
  recommendedActions = []
}) {
  if (!supabase) return { ok: false, error: "supabase_missing" };

  try {
    const { data, error } = await requireSupabase()
      .from("security_events")
      .insert({
        subject_type: clean(subjectType),
        subject_id: clean(subjectId) || null,
        event_type: clean(eventType),
        severity: clean(severity || "medium"),
        risk_score: clamp(toNumber(riskScore, 0), 0, 100),
        title: clean(title || eventType),
        summary: clean(summary || ""),
        evidence: isObject(evidence) ? evidence : { value: evidence },
        ai_analysis: isObject(aiAnalysis) ? aiAnalysis : {},
        recommended_actions: Array.isArray(recommendedActions) ? recommendedActions : [],
        created_at: nowIso(),
        updated_at: nowIso()
      })
      .select()
      .limit(1);

    if (error) throw error;

    emitSecurityRealtime({
      type: "security_event_created",
      subject_type: clean(subjectType),
      subject_id: clean(subjectId),
      event_type: clean(eventType),
      severity: clean(severity || "medium"),
      risk_score: clamp(toNumber(riskScore, 0), 0, 100)
    });

    return { ok: true, event: data?.[0] || null };
  } catch (error) {
    return { ok: false, error: clean(error?.message || String(error)) };
  }
}

async function upsertSecurityProfile({
  subjectType,
  subjectId,
  riskScore,
  flags = [],
  autoLocked = false
}) {
  if (!supabase || !subjectType || !subjectId) {
    return { ok: false, error: "missing_subject" };
  }

  try {
    const { data: existing, error: existingError } = await requireSupabase()
      .from("security_profiles")
      .select("*")
      .eq("subject_type", clean(subjectType))
      .eq("subject_id", clean(subjectId))
      .maybeSingle();

    if (existingError) throw existingError;

    const currentRisk = clamp(toNumber(riskScore, 0), 0, 100);
    const lifetimeRisk = toNumber(existing?.lifetime_risk_score, 0) + currentRisk;

    const { data, error } = await requireSupabase()
      .from("security_profiles")
      .upsert({
        subject_type: clean(subjectType),
        subject_id: clean(subjectId),
        current_risk_score: currentRisk,
        lifetime_risk_score: lifetimeRisk,
        flags: uniqueArray([...(existing?.flags || []), ...(flags || [])]).slice(0, 100),
        auto_locked: !!autoLocked,
        last_event_at: nowIso(),
        updated_at: nowIso()
      }, { onConflict: "subject_type,subject_id" })
      .select()
      .limit(1);

    if (error) throw error;
    return { ok: true, profile: data?.[0] || null };
  } catch (error) {
    return { ok: false, error: clean(error?.message || String(error)) };
  }
}

async function createSecurityAction({
  subjectType,
  subjectId,
  actionType,
  reason,
  metadata = {}
}) {
  if (!supabase) return { ok: false, error: "supabase_missing" };

  try {
    const { data, error } = await requireSupabase()
      .from("security_actions")
      .insert({
        subject_type: clean(subjectType),
        subject_id: clean(subjectId) || null,
        action_type: clean(actionType),
        action_status: "pending",
        reason: clean(reason || ""),
        source: "ai_security_brain",
        metadata: isObject(metadata) ? metadata : { value: metadata },
        created_at: nowIso(),
        updated_at: nowIso()
      })
      .select()
      .limit(1);

    if (error) throw error;
    return { ok: true, action: data?.[0] || null };
  } catch (error) {
    return { ok: false, error: clean(error?.message || String(error)) };
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

  return {
    ok: true,
    provider: "twilio",
    sid: result.sid || null
  };
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
   NEW PHASE 12 PROFESSIONAL GATE HELPERS
========================================================= */
function driverComplianceIsClear(driver = {}) {
  const complianceStatus = normalizeComplianceStatus(
    driver.compliance_status ||
    driver.driver_compliance_status
  );

  if (["blocked", "expired", "rejected"].includes(complianceStatus)) {
    return false;
  }

  if (ENABLE_DRIVER_INSURANCE_GATE && !driverHasRequiredInsurance(driver)) {
    return false;
  }

  return true;
}

function riderEligibleForBenefits(rider = {}) {
  return toBool(
    rider.nonprofit_benefits_approved ??
    rider.foundation_benefits_approved ??
    rider.is_nonprofit_member ??
    false,
    false
  );
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
   PERSONA WEBHOOK HELPERS
========================================================= */
function getPersonaSignature(req) {
  return (
    clean(req.headers["persona-signature"]) ||
    clean(req.headers["x-persona-signature"]) ||
    ""
  );
}

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
    google_maps_key_present: !!GOOGLE_MAPS_API_KEY,
    realtime_events_enabled: ENABLE_REALTIME_EVENTS,
    driver_heartbeat_enabled: ENABLE_DRIVER_HEARTBEAT,
    ai_security_enabled: ENABLE_AI_SECURITY_BRAIN,

    /* NEW PHASE 12 */
    insurance_gate_enabled: ENABLE_DRIVER_INSURANCE_GATE,
    compliance_gate_enabled: ENABLE_DRIVER_COMPLIANCE_GATE,
    preferred_driver_enabled: ENABLE_PREFERRED_DRIVER_SYSTEM,
    nonprofit_benefits_enabled: ENABLE_NONPROFIT_BENEFITS,
    sponsored_rides_enabled: ENABLE_SPONSORED_RIDES
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
    "driver_earnings",
    "security_events",
    "security_profiles",
    "security_actions",

    /* NEW PHASE 12 TABLES */
    "favorite_drivers",
    "recurring_rides",
    "driver_compliance_audit",
    "benefit_programs",
    "benefit_eligibility_rules",
    "benefit_applications",
    "benefit_approvals",
    "benefit_wallets",
    "benefit_transactions",
    "sponsored_rides"
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
   SECURITY TABLE BOOTSTRAP
========================================================= */
async function ensureSecurityBrainReady() {
  if (!supabase) return;

  const targets = ["security_events", "security_profiles", "security_actions"];
  const results = {};

  for (const table of targets) {
    try {
      const result = await checkTableAccessible(table);
      results[table] = result;
    } catch (error) {
      results[table] = {
        ok: false,
        error: clean(error?.message || String(error))
      };
    }
  }

  const failed = Object.values(results).some((v) => !v.ok);
  if (failed) {
    console.warn("⚠️ AI security brain tables are not fully ready:", results);
  } else {
    console.log("🛡️ AI security brain tables ready");
  }

  return results;
}

/* =========================================================
   NEW PHASE 12 FOUNDATION READINESS CHECKS
========================================================= */
async function ensurePhase12FoundationReady() {
  if (!supabase) return;

  const targets = [
    "favorite_drivers",
    "recurring_rides",
    "driver_compliance_audit",
    "benefit_programs",
    "benefit_applications",
    "benefit_transactions",
    "sponsored_rides"
  ];

  const results = {};

  for (const table of targets) {
    try {
      results[table] = await checkTableAccessible(table);
    } catch (error) {
      results[table] = {
        ok: false,
        error: clean(error?.message || String(error))
      };
    }
  }

  const failed = Object.values(results).some((v) => !v.ok);
  if (failed) {
    console.warn("⚠️ Phase 12 foundation tables are not fully ready:", results);
  } else {
    console.log("🏗️ Phase 12 foundation tables ready");
  }

  return results;
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

app.get("/api/health", asyncHandler(async (_req, res) => {
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
      ai_security: ENABLE_AI_SECURITY_BRAIN,
      driver_location_tracking: ENABLE_DRIVER_LOCATION_TRACKING,
      driver_heartbeat: ENABLE_DRIVER_HEARTBEAT,
      realtime_events: ENABLE_REALTIME_EVENTS,

      /* NEW PHASE 12 */
      driver_insurance_gate: ENABLE_DRIVER_INSURANCE_GATE,
      driver_compliance_gate: ENABLE_DRIVER_COMPLIANCE_GATE,
      preferred_driver_system: ENABLE_PREFERRED_DRIVER_SYSTEM,
      nonprofit_benefits: ENABLE_NONPROFIT_BENEFITS,
      sponsored_rides: ENABLE_SPONSORED_RIDES,
      compliance_sweeps: ENABLE_COMPLIANCE_SWEEPS
    },
    startup_checks: runtimeState.startupChecks,
    realtime: {
      enabled: runtimeState.realtime.enabled,
      rider_stream_keys: runtimeState.realtime.riderStreams.size,
      driver_stream_keys: runtimeState.realtime.driverStreams.size,
      admin_stream_keys: runtimeState.realtime.adminStreams.size
    },
    process: runtimeState.process,
    phase12: {
      compliance_sweep: runtimeState.complianceSweep,
      insurance: runtimeState.insurance,
      preferred_driver: runtimeState.preferredDriver,
      nonprofit_benefits: runtimeState.nonprofitBenefits
    }
  });
}));

app.get("/api/config/public", (_req, res) => {
  return ok(res, {
    support_email: SUPPORT_EMAIL,
    support_phone: TWILIO_FROM_NUMBER || null,
    app_name: APP_NAME,
    rider_verification_required: ENABLE_RIDER_VERIFICATION_GATE,
    payment_authorization_required: ENABLE_PAYMENT_GATE,
    dispatch_timeout_seconds: DISPATCH_TIMEOUT_SECONDS,
    autonomous_pilot_enabled: true,
    realtime_enabled: ENABLE_REALTIME_EVENTS,

    /* NEW PHASE 12 */
    preferred_driver_enabled: ENABLE_PREFERRED_DRIVER_SYSTEM,
    nonprofit_benefits_enabled: ENABLE_NONPROFIT_BENEFITS,
    sponsored_rides_enabled: ENABLE_SPONSORED_RIDES
  });
});

app.get("/api/admin/health/deep", requireAdmin, asyncHandler(async (_req, res) => {
  const checks = await runStartupChecks();

  return ok(res, {
    app: APP_NAME,
    checked_at: nowIso(),
    startup_checks: checks
  });
}));

/* =========================================================
   REALTIME STREAM ROUTES
========================================================= */
app.get("/api/realtime/rides/:rideId/stream", asyncHandler(async (req, res) => {
  if (!ENABLE_REALTIME_EVENTS) {
    return fail(res, "Realtime events disabled", 403);
  }

  const rideId = clean(req.params.rideId);
  if (!rideId) {
    return fail(res, "Ride ID is required");
  }

  openSseStream(res);
  addTrackedStream(runtimeState.realtime.riderStreams, rideId, res);

  writeSse(res, "subscribed", {
    channel: "ride",
    ride_id: rideId,
    subscribed_at: nowIso()
  });
}));

app.get("/api/realtime/drivers/:driverId/stream", asyncHandler(async (req, res) => {
  if (!ENABLE_REALTIME_EVENTS) {
    return fail(res, "Realtime events disabled", 403);
  }

  const driverId = clean(req.params.driverId);
  if (!driverId) {
    return fail(res, "Driver ID is required");
  }

  openSseStream(res);
  addTrackedStream(runtimeState.realtime.driverStreams, driverId, res);

  writeSse(res, "subscribed", {
    channel: "driver",
    driver_id: driverId,
    subscribed_at: nowIso()
  });
}));

app.get("/api/realtime/admin/stream", requireAdmin, asyncHandler(async (_req, res) => {
  if (!ENABLE_REALTIME_EVENTS) {
    return fail(res, "Realtime events disabled", 403);
  }

  openSseStream(res);
  addTrackedStream(runtimeState.realtime.adminStreams, "global", res);

  writeSse(res, "subscribed", {
    channel: "admin",
    subscribed_at: nowIso()
  });
}));

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
    await ensureSecurityBrainReady();
    await ensurePhase12FoundationReady();

    startRealtimeKeepAliveLoop();

    server.listen(PORT, () => {
      console.log("====================================================");
      console.log(`🚕 ${APP_NAME} running`);
      console.log(`🌐 Port: ${PORT}`);
      console.log(`🛠️ Environment: ${NODE_ENV}`);
      console.log(`🕒 Started: ${SERVER_STARTED_AT}`);
      console.log(`🧠 AI Enabled: ${!!openai}`);
      console.log(`🛡️ AI Security Enabled: ${ENABLE_AI_SECURITY_BRAIN}`);
      console.log(`🗄️ Supabase Ready: ${!!supabase}`);
      console.log(`📲 Twilio Ready: ${!!twilioClient}`);
      console.log(`📧 SMTP Ready: ${!!emailTransporter}`);
      console.log(`🤖 AI Dispatch Enabled: ${ENABLE_AI_DISPATCH}`);
      console.log(`🏢 AI Operations Enabled: ${ENABLE_AI_OPERATIONS}`);
      console.log(`📡 Realtime Enabled: ${ENABLE_REALTIME_EVENTS}`);
      console.log(`💓 Driver Heartbeat Enabled: ${ENABLE_DRIVER_HEARTBEAT}`);
      console.log(`🛡️ Driver Insurance Gate: ${ENABLE_DRIVER_INSURANCE_GATE}`);
      console.log(`📋 Driver Compliance Gate: ${ENABLE_DRIVER_COMPLIANCE_GATE}`);
      console.log(`⭐ Preferred Driver System: ${ENABLE_PREFERRED_DRIVER_SYSTEM}`);
      console.log(`❤️ Nonprofit Benefits: ${ENABLE_NONPROFIT_BENEFITS}`);
      console.log(`🤝 Sponsored Rides: ${ENABLE_SPONSORED_RIDES}`);
      console.log("====================================================");
    });
  } catch (error) {
    console.error("❌ Failed to start server:", error);
    process.exit(1);
  }
}

startServer();/* =========================================================
   HARVEY TAXI — CODE BLUE PHASE 12
   PART 2 OF 4
   MAPS + RIDERS + PAYMENTS + REQUEST RIDE + PERSONA
   PREFERRED DRIVER + NONPROFIT BENEFITS + COMPLIANCE-AWARE REQUEST FLOW
========================================================= */

/* =========================================================
   MAPS / DISTANCE HELPERS
========================================================= */
async function httpGetJson(url) {
  if (!fetchFn) {
    throw new Error("Fetch is not available in this runtime");
  }

  const response = await fetchFn(url);
  const text = await response.text();
  const json = safeJsonParse(text, null);

  if (!response.ok) {
    throw new Error(
      `HTTP ${response.status}: ${json?.error_message || text || "request failed"}`
    );
  }

  return json;
}

async function geocodeAddress(address) {
  const query = clean(address);
  if (!query) {
    return { ok: false, error: "Address is required" };
  }

  if (!GOOGLE_MAPS_API_KEY) {
    return { ok: false, error: "GOOGLE_MAPS_API_KEY missing" };
  }

  const url =
    "https://maps.googleapis.com/maps/api/geocode/json?address=" +
    encodeURIComponent(query) +
    "&key=" +
    encodeURIComponent(GOOGLE_MAPS_API_KEY);

  const json = await httpGetJson(url);

  if (json.status !== "OK" || !Array.isArray(json.results) || !json.results.length) {
    return {
      ok: false,
      error: json.error_message || json.status || "Geocode failed"
    };
  }

  const first = json.results[0];
  const location = first.geometry?.location || {};

  return {
    ok: true,
    formatted_address: clean(first.formatted_address || query),
    latitude: parseNullableNumber(location.lat),
    longitude: parseNullableNumber(location.lng),
    place_id: clean(first.place_id || "")
  };
}

async function distanceMatrix(originAddress, destinationAddress) {
  const origin = clean(originAddress);
  const destination = clean(destinationAddress);

  if (!origin || !destination) {
    return { ok: false, error: "Origin and destination required" };
  }

  if (!GOOGLE_MAPS_API_KEY) {
    return { ok: false, error: "GOOGLE_MAPS_API_KEY missing" };
  }

  const url =
    "https://maps.googleapis.com/maps/api/distancematrix/json?origins=" +
    encodeURIComponent(origin) +
    "&destinations=" +
    encodeURIComponent(destination) +
    "&units=imperial&key=" +
    encodeURIComponent(GOOGLE_MAPS_API_KEY);

  const json = await httpGetJson(url);

  const row = json.rows?.[0];
  const element = row?.elements?.[0];

  if (json.status !== "OK" || !element || element.status !== "OK") {
    return {
      ok: false,
      error: json.error_message || element?.status || json.status || "Distance matrix failed"
    };
  }

  const distanceMeters = Number(element.distance?.value || 0);
  const durationSeconds = Number(element.duration?.value || 0);

  return {
    ok: true,
    distance_miles: roundMoney(distanceMeters * 0.000621371),
    duration_minutes: roundMoney(durationSeconds / 60),
    distance_text: clean(element.distance?.text || ""),
    duration_text: clean(element.duration?.text || "")
  };
}

function estimateDurationMinutesFromMiles(miles = 0) {
  return Math.max(5, roundMoney((Number(miles || 0) / 26) * 60));
}

async function resolveTripMetrics(payload = {}) {
  const pickupAddress = clean(payload.pickup_address || payload.pickupAddress);
  const dropoffAddress = clean(payload.dropoff_address || payload.dropoffAddress);

  if (pickupAddress && dropoffAddress && GOOGLE_MAPS_API_KEY) {
    try {
      const matrix = await distanceMatrix(pickupAddress, dropoffAddress);
      if (matrix.ok) {
        return {
          distance_miles: matrix.distance_miles,
          duration_minutes: matrix.duration_minutes,
          source: "google_distance_matrix",
          distance_text: matrix.distance_text,
          duration_text: matrix.duration_text
        };
      }
    } catch (error) {
      console.warn("⚠️ Distance matrix failed, falling back:", error.message);
    }
  }

  const miles = haversineMiles(
    parseNullableNumber(payload.pickup_latitude),
    parseNullableNumber(payload.pickup_longitude),
    parseNullableNumber(payload.dropoff_latitude),
    parseNullableNumber(payload.dropoff_longitude)
  );

  if (miles && Number.isFinite(miles)) {
    return {
      distance_miles: roundMoney(miles * 1.15),
      duration_minutes: estimateDurationMinutesFromMiles(miles),
      source: "haversine"
    };
  }

  return {
    distance_miles: 8,
    duration_minutes: 18,
    source: "fallback"
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
    is_approved: status === "approved",
    benefits_approved: riderEligibleForBenefits(rider)
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

async function getRiderByPhone(phone) {
  return maybeSingle(
    requireSupabase()
      .from("riders")
      .select("*")
      .eq("phone", normalizePhone(phone))
  );
}

async function resolveRider(body = {}) {
  return (
    await getRiderById(body.rider_id || body.riderId) ||
    await getRiderByEmail(body.email) ||
    await getRiderByPhone(body.phone)
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

function computeDynamicSurge({ requestedMode = "driver", rideType = "standard" }) {
  let surge = SURGE_MULTIPLIER_DEFAULT;

  if (normalizeRideMode(requestedMode) === "autonomous") {
    surge += 0.15;
  }

  const type = normalizeRideType(rideType);
  if (type === "airport") surge += 0.2;
  if (type === "scheduled") surge += 0.1;
  if (type === "medical") surge += 0.05;
  if (type === "nonprofit") surge -= 0.05;

  return Math.max(1, roundMoney(surge));
}

function buildSafeRideRealtimePayload(ride, extra = {}) {
  return {
    ride_id: clean(ride?.id || ""),
    rider_id: clean(ride?.rider_id || ""),
    driver_id: clean(ride?.driver_id || ""),
    status: normalizeRideStatus(ride?.status || "pending"),
    requested_mode: normalizeRideMode(ride?.requested_mode || "driver"),
    ride_type: normalizeRideType(ride?.ride_type || "standard"),
    pickup_address: clean(ride?.pickup_address || ""),
    dropoff_address: clean(ride?.dropoff_address || ""),
    estimated_total: roundMoney(ride?.estimated_total || 0),
    final_total: roundMoney(ride?.final_total || 0),
    tip_amount: roundMoney(ride?.tip_amount || 0),
    preferred_driver_id: clean(ride?.preferred_driver_id || ""),
    preferred_driver_required: !!ride?.preferred_driver_required,
    sponsorship_type: clean(ride?.sponsorship_type || ""),
    sponsored_amount: roundMoney(ride?.sponsored_amount || 0),
    rider_copay_amount: roundMoney(ride?.rider_copay_amount || 0),
    updated_at: clean(ride?.updated_at || nowIso()),
    ...extra
  };
}

/* =========================================================
   PREFERRED DRIVER / NONPROFIT HELPERS
========================================================= */
async function getFavoriteDriverRecord(riderId, driverId) {
  return maybeSingle(
    requireSupabase()
      .from("favorite_drivers")
      .select("*")
      .eq("rider_id", clean(riderId))
      .eq("driver_id", clean(driverId))
      .eq("is_active", true)
  );
}

async function riderHasFavoriteDriver(riderId, driverId) {
  const record = await getFavoriteDriverRecord(riderId, driverId);
  return !!record;
}

async function getCompletedRideBetweenRiderAndDriver(riderId, driverId) {
  const { data, error } = await requireSupabase()
    .from("rides")
    .select("*")
    .eq("rider_id", clean(riderId))
    .eq("driver_id", clean(driverId))
    .eq("status", "completed")
    .order("updated_at", { ascending: false })
    .limit(1);

  if (error) throw error;
  return data?.[0] || null;
}

async function getBenefitWalletForRider(riderId) {
  try {
    const { data, error } = await requireSupabase()
      .from("benefit_wallets")
      .select("*")
      .eq("rider_id", clean(riderId))
      .order("updated_at", { ascending: false })
      .limit(1);

    if (error) throw error;
    return data?.[0] || null;
  } catch (error) {
    console.warn("⚠️ Benefit wallet lookup skipped:", error.message);
    return null;
  }
}

async function getOpenBenefitApprovalForRider(riderId) {
  try {
    const { data, error } = await requireSupabase()
      .from("benefit_approvals")
      .select("*")
      .eq("rider_id", clean(riderId))
      .in("status", ["approved", "active"])
      .order("updated_at", { ascending: false })
      .limit(1);

    if (error) throw error;
    return data?.[0] || null;
  } catch (error) {
    console.warn("⚠️ Benefit approval lookup skipped:", error.message);
    return null;
  }
}

async function resolveRequestedBenefitProfile({ rider, requestedRideType, requestedBenefitType }) {
  if (!ENABLE_NONPROFIT_BENEFITS || !rider?.id) {
    return {
      eligible: false,
      benefit_type: "none",
      sponsored_amount: 0,
      rider_copay_amount: 0,
      sponsorship_percent: 0,
      source: null
    };
  }

  const riderApproved = riderEligibleForBenefits(rider);
  const wallet = await getBenefitWalletForRider(rider.id);
  const approval = await getOpenBenefitApprovalForRider(rider.id);

  const requestedType = normalizeBenefitType(requestedBenefitType || requestedRideType);

  if (!riderApproved && !wallet && !approval) {
    return {
      eligible: false,
      benefit_type: "none",
      sponsored_amount: 0,
      rider_copay_amount: 0,
      sponsorship_percent: 0,
      source: null
    };
  }

  let sponsorshipPercent = NONPROFIT_DEFAULT_SPONSORSHIP_PERCENT;

  if (approval?.sponsorship_percent !== undefined && approval?.sponsorship_percent !== null) {
    sponsorshipPercent = clamp(toNumber(approval.sponsorship_percent, sponsorshipPercent), 0, NONPROFIT_MAX_SPONSORSHIP_PERCENT);
  }

  if (wallet?.default_sponsorship_percent !== undefined && wallet?.default_sponsorship_percent !== null) {
    sponsorshipPercent = clamp(toNumber(wallet.default_sponsorship_percent, sponsorshipPercent), 0, NONPROFIT_MAX_SPONSORSHIP_PERCENT);
  }

  return {
    eligible: true,
    benefit_type: requestedType === "none" ? "foundation" : requestedType,
    sponsored_amount: 0,
    rider_copay_amount: 0,
    sponsorship_percent: sponsorshipPercent,
    source: approval ? "benefit_approval" : wallet ? "benefit_wallet" : "rider_profile",
    approval_id: approval?.id || null,
    wallet_id: wallet?.id || null
  };
}

function rideRequiresBenefitReview({ benefitProfile, requestedRideType }) {
  const rideType = normalizeRideType(requestedRideType);
  if (!benefitProfile?.eligible) return false;
  if (rideType === "nonprofit") return false;
  return false;
}

/* =========================================================
   AI SECURITY SIGNAL HELPERS
========================================================= */
async function getRecentRiderSignals(riderId) {
  if (!supabase || !riderId) return {};

  const since10m = new Date(Date.now() - (10 * 60 * 1000)).toISOString();
  const since1h = new Date(Date.now() - (60 * 60 * 1000)).toISOString();
  const since24h = new Date(Date.now() - (24 * 60 * 60 * 1000)).toISOString();

  const [rides10m, rides1h, failedPayments, cancelledRides] = await Promise.all([
    requireSupabase()
      .from("rides")
      .select("id", { count: "exact", head: true })
      .eq("rider_id", riderId)
      .gte("created_at", since10m),

    requireSupabase()
      .from("rides")
      .select("id", { count: "exact", head: true })
      .eq("rider_id", riderId)
      .gte("created_at", since1h),

    requireSupabase()
      .from("payments")
      .select("id", { count: "exact", head: true })
      .eq("rider_id", riderId)
      .in("status", ["failed", "declined"])
      .gte("created_at", since24h),

    requireSupabase()
      .from("rides")
      .select("id", { count: "exact", head: true })
      .eq("rider_id", riderId)
      .in("status", ["cancelled", "canceled"])
      .gte("created_at", since24h)
  ]);

  return {
    request_count_10m: rides10m.count || 0,
    request_count_1h: rides1h.count || 0,
    failed_payments_24h: failedPayments.count || 0,
    cancelled_rides_24h: cancelledRides.count || 0,
    support_complaints_30d: 0
  };
}

function buildRecommendedSecurityActions(score = 0, subjectType = "", eventType = "") {
  const actions = [];

  if (score >= RISK_REVIEW_THRESHOLD) actions.push("flag_for_review");
  if (score >= RISK_HIGH_THRESHOLD) {
    actions.push("require_manual_review");
    actions.push("increase_monitoring");
  }
  if (score >= RISK_CRITICAL_THRESHOLD) {
    actions.push("temporarily_lock_account");
    actions.push("pause_sensitive_operations");
  }

  if (eventType.includes("payment")) actions.push("review_payment_authorization");
  if (eventType.includes("ride")) actions.push("review_request_pattern");
  if (subjectType === "rider" && score >= RISK_HIGH_THRESHOLD) {
    actions.push("block_new_ride_requests_pending_review");
  }

  return uniqueArray(actions);
}

function buildRuleBasedRiderRiskAssessment(payload = {}) {
  const reasons = [];
  let score = 0;

  const recent = payload.recent_activity || {};
  const context = payload.context || {};
  const rider = payload.subject || {};

  const accountAgeHours = toNumber(rider.account_age_hours, 0);
  const requestCount10m = toNumber(recent.request_count_10m, 0);
  const requestCount1h = toNumber(recent.request_count_1h, 0);
  const failedPayments24h = toNumber(recent.failed_payments_24h, 0);
  const cancelledRides24h = toNumber(recent.cancelled_rides_24h, 0);
  const fareAmount = toNumber(context.fare_amount, 0);
  const distanceMiles = toNumber(context.distance_miles, 0);

  if (accountAgeHours > 0 && accountAgeHours < 24) {
    score += 10;
    reasons.push("Very new rider account");
  }

  if (requestCount10m >= 3) {
    score += 15;
    reasons.push("High ride request frequency in 10 minutes");
  }

  if (requestCount1h >= 8) {
    score += 15;
    reasons.push("High ride request frequency in 1 hour");
  }

  if (failedPayments24h >= 2) {
    score += 20;
    reasons.push("Multiple failed payments in 24 hours");
  }

  if (cancelledRides24h >= 4) {
    score += 12;
    reasons.push("Repeated ride cancellations");
  }

  if (fareAmount >= 150) {
    score += 8;
    reasons.push("High fare amount");
  }

  if (distanceMiles >= 60) {
    score += 7;
    reasons.push("Unusually long ride distance");
  }

  if (context.preferred_driver_required === true) {
    score += 3;
    reasons.push("Strict preferred driver request");
  }

  if (context.sponsorship_percent >= 0.8) {
    score += 4;
    reasons.push("High sponsorship percentage");
  }

  score = clamp(score, 0, 100);

  return {
    risk_score: score,
    severity: getSeverityFromScore(score),
    reasons,
    recommended_actions: buildRecommendedSecurityActions(score, "rider", "ride_request")
  };
}

async function getAiSecurityAssessment(payload = {}) {
  const client = await getOpenAIClientSafe();
  if (!client) return null;

  try {
    const response = await client.chat.completions.create({
      model: OPENAI_SECURITY_MODEL,
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You are a transportation platform security analyst. Score fraud, abuse, payment risk, identity risk, and sponsored ride misuse. Return strict JSON with keys: risk_score, severity, summary, reasons, recommended_actions."
        },
        {
          role: "user",
          content: JSON.stringify(payload)
        }
      ]
    });

    const raw = response?.choices?.[0]?.message?.content || "{}";
    const parsed = safeJsonParse(raw, null);
    if (!parsed) return null;

    return {
      risk_score: clamp(toNumber(parsed.risk_score, 0), 0, 100),
      severity: ["low", "medium", "high", "critical"].includes(parsed.severity)
        ? parsed.severity
        : "medium",
      summary: clean(parsed.summary || ""),
      reasons: Array.isArray(parsed.reasons) ? parsed.reasons.map(String).slice(0, 20) : [],
      recommended_actions: Array.isArray(parsed.recommended_actions)
        ? parsed.recommended_actions.map(String).slice(0, 20)
        : []
    };
  } catch (error) {
    runtimeState.aiSecurity.lastAssessmentError = clean(error?.message || String(error));
    return null;
  }
}

function mergeSecurityAssessments(ruleAssessment = {}, aiAssessment = null) {
  if (!aiAssessment) {
    return {
      risk_score: ruleAssessment.risk_score || 0,
      severity: ruleAssessment.severity || "low",
      summary: (ruleAssessment.reasons || []).join("; "),
      reasons: ruleAssessment.reasons || [],
      recommended_actions: ruleAssessment.recommended_actions || [],
      ai_analysis: {}
    };
  }

  const mergedScore = clamp(
    Math.round(((ruleAssessment.risk_score || 0) * 0.65) + ((aiAssessment.risk_score || 0) * 0.35)),
    0,
    100
  );

  return {
    risk_score: mergedScore,
    severity: getSeverityFromScore(mergedScore),
    summary: aiAssessment.summary || (ruleAssessment.reasons || []).join("; "),
    reasons: uniqueArray([...(ruleAssessment.reasons || []), ...(aiAssessment.reasons || [])]).slice(0, 25),
    recommended_actions: uniqueArray([
      ...(ruleAssessment.recommended_actions || []),
      ...(aiAssessment.recommended_actions || [])
    ]).slice(0, 25),
      ai_analysis: aiAssessment
    };
}

async function maybeAssessRiderSecurity({
  rider,
  ridePayload = {},
  eventType = "ride_request"
}) {
  try {
    if (!ENABLE_AI_SECURITY_BRAIN || !rider?.id) {
      return { ok: true, skipped: true };
    }

    const recentSignals = await getRecentRiderSignals(rider.id);

    const createdAt = rider.created_at ? new Date(rider.created_at).getTime() : null;
    const accountAgeHours =
      createdAt && Number.isFinite(createdAt)
        ? roundMoney((Date.now() - createdAt) / (1000 * 60 * 60))
        : 0;

    const assessmentPayload = {
      subject_type: "rider",
      event_type: eventType,
      subject: {
        id: rider.id,
        email: clean(rider.email || ""),
        phone: clean(rider.phone || ""),
        status: clean(rider.status || ""),
        account_age_hours: accountAgeHours
      },
      recent_activity: recentSignals,
      context: {
        requested_mode: normalizeRideMode(ridePayload.requested_mode || ridePayload.requestedMode || "driver"),
        ride_type: normalizeRideType(ridePayload.ride_type || ridePayload.rideType || "standard"),
        fare_amount: toNumber(ridePayload.estimated_total, 0),
        distance_miles: toNumber(ridePayload.distance_miles, 0),
        pickup_address: clean(ridePayload.pickup_address || ridePayload.pickupAddress || ""),
        dropoff_address: clean(ridePayload.dropoff_address || ridePayload.dropoffAddress || ""),
        preferred_driver_required: !!ridePayload.preferred_driver_required,
        sponsorship_percent: toNumber(ridePayload.sponsorship_percent, 0),
        benefit_type: clean(ridePayload.benefit_type || "")
      }
    };

    const ruleAssessment = buildRuleBasedRiderRiskAssessment(assessmentPayload);
    const aiAssessment = await getAiSecurityAssessment(assessmentPayload);
    const merged = mergeSecurityAssessments(ruleAssessment, aiAssessment);

    runtimeState.aiSecurity.lastAssessmentAt = nowIso();
    runtimeState.aiSecurity.lastAssessmentError = null;

    await upsertSecurityProfile({
      subjectType: "rider",
      subjectId: rider.id,
      riskScore: merged.risk_score,
      flags: merged.reasons,
      autoLocked: merged.risk_score >= RISK_CRITICAL_THRESHOLD
    });

    if (merged.risk_score >= RISK_REVIEW_THRESHOLD) {
      await writeSecurityEvent({
        subjectType: "rider",
        subjectId: rider.id,
        eventType,
        title: "Rider security review triggered",
        summary: merged.summary,
        riskScore: merged.risk_score,
        severity: merged.severity,
        evidence: assessmentPayload,
        aiAnalysis: merged.ai_analysis,
        recommendedActions: merged.recommended_actions
      });

      for (const action of merged.recommended_actions) {
        await createSecurityAction({
          subjectType: "rider",
          subjectId: rider.id,
          actionType: action,
          reason: merged.summary,
          metadata: {
            risk_score: merged.risk_score,
            event_type: eventType
          }
        });
      }

      if (merged.risk_score >= RISK_CRITICAL_THRESHOLD) {
        await updateRows("riders", { id: rider.id }, {
          status: "security_locked",
          approval_status: "security_locked",
          updated_at: nowIso()
        });
      }
    }

    return {
      ok: true,
      assessment: merged
    };
  } catch (error) {
    runtimeState.aiSecurity.lastAssessmentError = clean(error?.message || String(error));
    return {
      ok: false,
      error: clean(error?.message || String(error))
    };
  }
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
  if (!phone) return fail(res, "Valid phone is required");

  const existing =
    (await getRiderByEmail(email)) ||
    (await getRiderByPhone(phone));

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
    nonprofit_benefits_approved: false,
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
    text: "Your rider signup was received. Approval is required before requesting rides."
  });

  emitAdminRealtime({
    type: "rider_signup_created",
    rider_id: rider.id,
    email
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
   BENEFIT / NONPROFIT PREVIEW ROUTE
========================================================= */
app.post("/api/benefits/preview", asyncHandler(async (req, res) => {
  const rider = await resolveRider(req.body);
  if (!rider) return fail(res, "Rider not found", 404);

  const estimatedTotal = roundMoney(toNumber(req.body.estimated_total, 0));
  const requestedRideType = normalizeRideType(req.body.ride_type || req.body.rideType || "standard");
  const requestedBenefitType = normalizeBenefitType(req.body.benefit_type || req.body.benefitType || requestedRideType);

  const benefitProfile = await resolveRequestedBenefitProfile({
    rider,
    requestedRideType,
    requestedBenefitType
  });

  if (!benefitProfile.eligible) {
    return ok(res, {
      eligible: false,
      benefit_profile: benefitProfile
    });
  }

  const estimate = calculateNonprofitBenefitEstimate({
    estimatedTotal,
    benefitPercent: benefitProfile.sponsorship_percent
  });

  return ok(res, {
    eligible: true,
    benefit_profile: {
      ...benefitProfile,
      ...estimate
    }
  });
}));

/* =========================================================
   FARE ESTIMATE
========================================================= */
app.post("/api/fare-estimate", asyncHandler(async (req, res) => {
  const rider = await resolveRider(req.body).catch(() => null);
  const metrics = await resolveTripMetrics(req.body);

  const requestedMode = normalizeRideMode(req.body.requested_mode || req.body.requestedMode);
  const rideType = normalizeRideType(req.body.ride_type || req.body.rideType);
  const surgeMultiplier = computeDynamicSurge({
    requestedMode,
    rideType
  });

  const fare = estimateFare({
    distanceMiles: metrics.distance_miles,
    durationMinutes: metrics.duration_minutes,
    rideType,
    requestedMode,
    surgeMultiplier
  });

  const payout = calculateDriverPayout(
    fare.estimated_total,
    requestedMode === "autonomous" ? "autonomous" : "human"
  );

  let benefit_profile = null;
  if (rider && ENABLE_NONPROFIT_BENEFITS) {
    const requestedBenefitType = normalizeBenefitType(req.body.benefit_type || req.body.benefitType || rideType);

    const benefitProfile = await resolveRequestedBenefitProfile({
      rider,
      requestedRideType: rideType,
      requestedBenefitType
    });

    if (benefitProfile.eligible) {
      benefit_profile = {
        ...benefitProfile,
        ...calculateNonprofitBenefitEstimate({
          estimatedTotal: fare.estimated_total,
          benefitPercent: benefitProfile.sponsorship_percent
        })
      };
    }
  }

  return ok(res, {
    fare,
    payout,
    metrics,
    benefit_profile
  });
}));

/* =========================================================
   PAYMENT AUTHORIZATION
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

  const sponsorshipPercent = clamp(toNumber(req.body.sponsorship_percent, 0), 0, NONPROFIT_MAX_SPONSORSHIP_PERCENT);
  const requestedBenefitType = normalizeBenefitType(req.body.benefit_type || req.body.benefitType || "");
  const benefitEstimate = calculateNonprofitBenefitEstimate({
    estimatedTotal: amount,
    benefitPercent: sponsorshipPercent
  });

  const riderChargeAmount =
    ENABLE_NONPROFIT_BENEFITS && sponsorshipPercent > 0
      ? roundMoney(benefitEstimate.rider_copay_amount)
      : amount;

  const payment = await insertRow("payments", {
    id: createId("pay"),
    rider_id: rider.id,
    status: "authorized",
    payment_status: "authorized",
    authorization_amount: riderChargeAmount,
    gross_authorization_amount: amount,
    sponsored_amount: roundMoney(benefitEstimate.sponsored_amount || 0),
    sponsorship_percent: sponsorshipPercent,
    benefit_type: requestedBenefitType || null,
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
      authorization_amount: riderChargeAmount,
      gross_authorization_amount: amount,
      sponsored_amount: roundMoney(benefitEstimate.sponsored_amount || 0),
      sponsorship_percent: sponsorshipPercent
    }
  });

  const securityCheck = await maybeAssessRiderSecurity({
    rider,
    ridePayload: {
      estimated_total: amount,
      requested_mode: req.body.requested_mode || "driver",
      ride_type: req.body.ride_type || "standard",
      sponsorship_percent: sponsorshipPercent,
      benefit_type: requestedBenefitType
    },
    eventType: "payment_authorization"
  });

  emitAdminRealtime({
    type: "payment_authorized",
    rider_id: rider.id,
    payment_id: payment.id,
    authorization_amount: riderChargeAmount,
    gross_authorization_amount: amount,
    security_risk_score: securityCheck?.assessment?.risk_score ?? null
  });

  return ok(res, {
    message: "Payment authorized successfully",
    payment,
    security: securityCheck?.assessment || null
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

  if (normalizeRiderStatus(rider.status || rider.approval_status) === "security_locked") {
    return fail(res, "Rider account is locked for security review", 403);
  }

  const payment = await getLatestPaymentForRider(rider.id);
  if (ENABLE_PAYMENT_GATE && !paymentIsAuthorized(payment)) {
    return fail(res, "Payment authorization required", 402, {
      payment_status: payment?.status || payment?.payment_status || "missing"
    });
  }

  const pickupAddress = clean(req.body.pickup_address || req.body.pickupAddress);
  const dropoffAddress = clean(req.body.dropoff_address || req.body.dropoffAddress);

  if (!pickupAddress) return fail(res, "Pickup address is required");
  if (!dropoffAddress) return fail(res, "Dropoff address is required");

  const requestedMode = normalizeRideMode(req.body.requested_mode || req.body.requestedMode);
  const rideType = normalizeRideType(req.body.ride_type || req.body.rideType);
  const notes = clean(req.body.notes);
  const scheduledAt = clean(req.body.scheduled_at || req.body.scheduledAt);

  const preferredDriverId = clean(
    req.body.preferred_driver_id ||
    req.body.preferredDriverId ||
    req.body.requested_driver_id ||
    req.body.requestedDriverId
  );

  const preferredDriverRequired = toBool(
    req.body.preferred_driver_required || req.body.preferredDriverRequired,
    false
  );

  const preferredDriverPolicy = normalizePreferredDriverPolicy(
    req.body.preferred_driver_policy ||
    req.body.preferredDriverPolicy ||
    (preferredDriverRequired ? "required" : "preferred_first")
  );

  const requestedBenefitType = normalizeBenefitType(
    req.body.benefit_type ||
    req.body.benefitType ||
    rideType
  );

  if (preferredDriverId && !ENABLE_PREFERRED_DRIVER_SYSTEM) {
    return fail(res, "Preferred driver system is disabled", 403);
  }

  if (preferredDriverId) {
    const preferredDriver = await getRowById("drivers", "id", preferredDriverId);

    if (!preferredDriver) {
      return fail(res, "Preferred driver not found", 404);
    }

    const priorCompletedRide = await getCompletedRideBetweenRiderAndDriver(
      rider.id,
      preferredDriverId
    );

    const isFavorited = await riderHasFavoriteDriver(rider.id, preferredDriverId);

    if (!priorCompletedRide && !isFavorited) {
      return fail(
        res,
        "Preferred driver can only be requested after a completed trip or favorite connection",
        403
      );
    }

    if (normalizeDriverType(preferredDriver.driver_type || "human") !== normalizeRideMode(requestedMode)) {
      if (!(normalizeRideMode(requestedMode) === "driver" && normalizeDriverType(preferredDriver.driver_type || "human") === "human")) {
        return fail(res, "Preferred driver does not support this ride mode", 400);
      }
    }

    if (ENABLE_DRIVER_COMPLIANCE_GATE && !driverComplianceIsClear(preferredDriver)) {
      return fail(res, "Preferred driver is not currently compliant for dispatch", 403);
    }
  }

  let pickupGeo = null;
  let dropoffGeo = null;

  try {
    if (GOOGLE_MAPS_API_KEY) {
      pickupGeo = await geocodeAddress(pickupAddress);
      dropoffGeo = await geocodeAddress(dropoffAddress);
    }
  } catch (error) {
    console.warn("⚠️ Geocode skipped:", error.message);
  }

  const metrics = await resolveTripMetrics({
    ...req.body,
    pickup_address: pickupGeo?.ok ? pickupGeo.formatted_address : pickupAddress,
    dropoff_address: dropoffGeo?.ok ? dropoffGeo.formatted_address : dropoffAddress,
    pickup_latitude: pickupGeo?.ok ? pickupGeo.latitude : req.body.pickup_latitude,
    pickup_longitude: pickupGeo?.ok ? pickupGeo.longitude : req.body.pickup_longitude,
    dropoff_latitude: dropoffGeo?.ok ? dropoffGeo.latitude : req.body.dropoff_latitude,
    dropoff_longitude: dropoffGeo?.ok ? dropoffGeo.longitude : req.body.dropoff_longitude
  });

  const surgeMultiplier = computeDynamicSurge({
    requestedMode,
    rideType
  });

  const fare = estimateFare({
    distanceMiles: metrics.distance_miles,
    durationMinutes: metrics.duration_minutes,
    rideType,
    requestedMode,
    surgeMultiplier
  });

  const payout = calculateDriverPayout(
    fare.estimated_total,
    requestedMode === "autonomous" ? "autonomous" : "human"
  );

  const benefitProfile = await resolveRequestedBenefitProfile({
    rider,
    requestedRideType: rideType,
    requestedBenefitType
  });

  let benefitEstimate = {
    estimated_total: fare.estimated_total,
    sponsored_amount: 0,
    rider_copay_amount: fare.estimated_total,
    sponsorship_percent: 0
  };

  if (benefitProfile.eligible) {
    benefitEstimate = calculateNonprofitBenefitEstimate({
      estimatedTotal: fare.estimated_total,
      benefitPercent: benefitProfile.sponsorship_percent
    });
  }

  const securityCheck = await maybeAssessRiderSecurity({
    rider,
    ridePayload: {
      ...req.body,
      estimated_total: fare.estimated_total,
      distance_miles: metrics.distance_miles,
      pickup_address: pickupGeo?.ok ? pickupGeo.formatted_address : pickupAddress,
      dropoff_address: dropoffGeo?.ok ? dropoffGeo.formatted_address : dropoffAddress,
      preferred_driver_required: preferredDriverRequired,
      sponsorship_percent: benefitEstimate.sponsorship_percent,
      benefit_type: benefitProfile.benefit_type
    },
    eventType: "ride_request"
  });

  if (
    securityCheck?.assessment?.risk_score >= RISK_CRITICAL_THRESHOLD ||
    normalizeRiderStatus((await getRiderById(rider.id))?.status) === "security_locked"
  ) {
    return fail(res, "Ride request paused for security review", 403, {
      security: securityCheck.assessment
    });
  }

  const requiresBenefitReview = rideRequiresBenefitReview({
    benefitProfile,
    requestedRideType: rideType
  });

  const ride = await insertRow("rides", {
    id: createId("ride"),
    rider_id: rider.id,
    payment_id: payment?.id || null,
    status:
      securityCheck?.assessment?.risk_score >= RISK_HIGH_THRESHOLD
        ? "security_review"
        : requiresBenefitReview
          ? "compliance_review"
          : "awaiting_dispatch",
    ride_type: rideType,
    requested_mode: requestedMode,
    pickup_address: pickupGeo?.ok ? pickupGeo.formatted_address : pickupAddress,
    dropoff_address: dropoffGeo?.ok ? dropoffGeo.formatted_address : dropoffAddress,
    pickup_latitude: pickupGeo?.ok ? pickupGeo.latitude : parseNullableNumber(req.body.pickup_latitude),
    pickup_longitude: pickupGeo?.ok ? pickupGeo.longitude : parseNullableNumber(req.body.pickup_longitude),
    dropoff_latitude: dropoffGeo?.ok ? dropoffGeo.latitude : parseNullableNumber(req.body.dropoff_latitude),
    dropoff_longitude: dropoffGeo?.ok ? dropoffGeo.longitude : parseNullableNumber(req.body.dropoff_longitude),
    notes,
    scheduled_at: scheduledAt || null,
    estimated_distance_miles: metrics.distance_miles,
    estimated_duration_minutes: metrics.duration_minutes,
    estimated_total: fare.estimated_total,
    estimated_driver_payout: payout.driver_payout_estimate,
    estimated_platform_fee: payout.platform_fee_estimate,
    surge_multiplier: fare.surge_multiplier,

    preferred_driver_id: preferredDriverId || null,
    preferred_driver_required: preferredDriverRequired,
    preferred_driver_policy: preferredDriverPolicy,
    preferred_driver_attempted: false,
    preferred_driver_dispatched_at: null,

    benefit_type: benefitProfile.benefit_type || null,
    benefit_source: benefitProfile.source || null,
    benefit_approval_id: benefitProfile.approval_id || null,
    benefit_wallet_id: benefitProfile.wallet_id || null,
    sponsorship_type: benefitProfile.eligible ? "foundation" : null,
    sponsorship_percent: benefitEstimate.sponsorship_percent,
    sponsored_amount: benefitEstimate.sponsored_amount,
    rider_copay_amount: benefitEstimate.rider_copay_amount,

    created_at: nowIso(),
    updated_at: nowIso()
  });

  if (payment?.id) {
    await updateRows("payments", { id: payment.id }, {
      ride_id: ride.id,
      updated_at: nowIso()
    });
  }

  if (benefitProfile.eligible && ENABLE_SPONSORED_RIDES) {
    try {
      await insertRow("sponsored_rides", {
        id: createId("sride"),
        ride_id: ride.id,
        rider_id: rider.id,
        benefit_type: benefitProfile.benefit_type || "foundation",
        sponsorship_percent: benefitEstimate.sponsorship_percent,
        sponsored_amount: benefitEstimate.sponsored_amount,
        rider_copay_amount: benefitEstimate.rider_copay_amount,
        status: requiresBenefitReview ? "pending_review" : "approved",
        created_at: nowIso(),
        updated_at: nowIso()
      });

      await logBenefitEvent({
        rider_id: rider.id,
        ride_id: ride.id,
        application_id: benefitProfile.approval_id || null,
        event_type: "sponsored_ride_created",
        details: {
          benefit_type: benefitProfile.benefit_type,
          sponsored_amount: benefitEstimate.sponsored_amount,
          rider_copay_amount: benefitEstimate.rider_copay_amount,
          sponsorship_percent: benefitEstimate.sponsorship_percent
        }
      });

      emitBenefitsRealtime({
        type: "sponsored_ride_created",
        ride_id: ride.id,
        rider_id: rider.id,
        sponsored_amount: benefitEstimate.sponsored_amount
      });
    } catch (error) {
      console.warn("⚠️ Sponsored ride insert skipped:", error.message);
    }
  }

  await logTripEvent({
    ride_id: ride.id,
    rider_id: rider.id,
    event_type: "ride_created",
    details: {
      requested_mode: requestedMode,
      ride_type: rideType,
      metrics,
      fare,
      security_risk_score: securityCheck?.assessment?.risk_score ?? null,
      preferred_driver_id: preferredDriverId || null,
      preferred_driver_required: preferredDriverRequired,
      sponsorship_percent: benefitEstimate.sponsorship_percent,
      sponsored_amount: benefitEstimate.sponsored_amount,
      rider_copay_amount: benefitEstimate.rider_copay_amount,
      benefit_type: benefitProfile.benefit_type || null
    }
  });

  emitRideRealtime(ride.id, {
    type: "ride_created",
    ride: buildSafeRideRealtimePayload(ride, {
      metrics,
      fare,
      payout,
      benefit_profile: benefitProfile.eligible
        ? {
            ...benefitProfile,
            ...benefitEstimate
          }
        : null
    })
  });

  emitAdminRealtime({
    type: "ride_created",
    ride_id: ride.id,
    rider_id: rider.id,
    status: ride.status,
    security_risk_score: securityCheck?.assessment?.risk_score ?? null,
    preferred_driver_id: preferredDriverId || null,
    sponsored_amount: benefitEstimate.sponsored_amount
  });

  let dispatch = null;
  if (
    ENABLE_AI_DISPATCH &&
    normalizeRideStatus(ride.status) === "awaiting_dispatch" &&
    typeof dispatchRideToBestDriver === "function"
  ) {
    dispatch = await dispatchRideToBestDriver(ride.id);
  }

  return ok(res, {
    message:
      normalizeRideStatus(ride.status) === "security_review"
        ? "Ride created and sent for security review"
        : normalizeRideStatus(ride.status) === "compliance_review"
          ? "Ride created and sent for benefit/compliance review"
          : "Ride created successfully",
    ride,
    fare,
    payout,
    metrics,
    security: securityCheck?.assessment || null,
    benefit_profile: benefitProfile.eligible
      ? {
          ...benefitProfile,
          ...benefitEstimate
        }
      : null,
    dispatch
  }, 201);
}));

/* =========================================================
   PERSONA PROCESSORS
========================================================= */
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

    emitAdminRealtime({
      type: "rider_persona_approved",
      rider_lookup: riderLookup,
      inquiry_id: inquiry.inquiryId
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

    emitAdminRealtime({
      type: "rider_persona_blocked",
      rider_lookup: riderLookup,
      inquiry_id: inquiry.inquiryId,
      event_name: eventName
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

    emitAdminRealtime({
      type: "driver_persona_approved",
      driver_lookup: driverLookup,
      inquiry_id: inquiry.inquiryId
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

    emitAdminRealtime({
      type: "driver_persona_blocked",
      driver_lookup: driverLookup,
      inquiry_id: inquiry.inquiryId,
      event_name: eventName
    });
  }
}

/* =========================================================
   PERSONA WEBHOOK
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
    details: { eventName, inquiry }
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
   HARVEY TAXI — CODE BLUE PHASE 12
   PART 3 OF 4
   DRIVERS + INSURANCE COMPLIANCE + PREFERRED DRIVER DISPATCH
   MISSIONS + HEARTBEAT + REDISPATCH + COMPLIANCE SWEEPS
========================================================= */

/* =========================================================
   DRIVER HELPERS
========================================================= */
async function getDriverById(id) {
  return getRowById("drivers", "id", clean(id));
}

async function getDriverByEmail(email) {
  return maybeSingle(
    requireSupabase()
      .from("drivers")
      .select("*")
      .ilike("email", lower(email))
  );
}

async function getDriverByPhone(phone) {
  return maybeSingle(
    requireSupabase()
      .from("drivers")
      .select("*")
      .eq("phone", normalizePhone(phone))
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

function getDriverAcceptanceRate(driver = {}) {
  const value = Number(driver.acceptance_rate ?? 0.8);
  return Number.isFinite(value) ? clamp(value, 0, 1) : 0.8;
}

function getDriverCompletionRate(driver = {}) {
  const value = Number(driver.completion_rate ?? 0.95);
  return Number.isFinite(value) ? clamp(value, 0, 1) : 0.95;
}

function getDriverRating(driver = {}) {
  const value = Number(driver.rating ?? 5);
  return Number.isFinite(value) ? clamp(value, 1, 5) : 5;
}

function getDriverActivityBoost(driver = {}) {
  const lastSeenAt = clean(
    driver.last_heartbeat_at ||
    driver.last_location_at ||
    driver.updated_at ||
    ""
  );

  if (!lastSeenAt) return 0.5;

  const ageMs = Date.now() - new Date(lastSeenAt).getTime();
  if (!Number.isFinite(ageMs) || ageMs < 0) return 0.5;

  if (ageMs <= 5 * 60 * 1000) return 1;
  if (ageMs <= 15 * 60 * 1000) return 0.7;
  if (ageMs <= 30 * 60 * 1000) return 0.4;
  return 0.1;
}

function driverSupportsMode(driver, requestedMode = "driver") {
  const mode = normalizeRideMode(requestedMode);
  const type = normalizeDriverType(driver?.driver_type || "human");

  if (mode === "autonomous") return type === "autonomous";
  return type === "human";
}

/* =========================================================
   INSURANCE / COMPLIANCE HELPERS
========================================================= */
function getDriverInsuranceExpiration(driver = {}) {
  return (
    clean(driver.insurance_expiration_date) ||
    clean(driver.insurance_expiration) ||
    clean(driver.policy_expiration_date) ||
    ""
  );
}

function getDriverInsuranceStatus(driver = {}) {
  return normalizeInsuranceStatus(
    driver.insurance_status ||
    driver.driver_insurance_status ||
    driver.compliance_insurance_status ||
    ""
  );
}

function getDriverComplianceStatus(driver = {}) {
  return normalizeComplianceStatus(
    driver.compliance_status ||
    driver.driver_compliance_status ||
    driver.status ||
    driver.approval_status ||
    ""
  );
}

function getDriverComplianceBlockReason(driver = {}) {
  return clean(
    driver.compliance_block_reason ||
    driver.block_reason ||
    driver.insurance_block_reason ||
    ""
  );
}

function buildDriverComplianceSummary(driver = {}) {
  const insuranceExpiration = getDriverInsuranceExpiration(driver);
  const insuranceDaysRemaining = daysUntil(insuranceExpiration);

  return {
    compliance_status: getDriverComplianceStatus(driver),
    compliance_block_reason: getDriverComplianceBlockReason(driver),
    insurance_status: getDriverInsuranceStatus(driver),
    insurance_verified: toBool(
      driver.insurance_verified ??
      driver.driver_insurance_verified ??
      false,
      false
    ),
    tnc_endorsement_confirmed: toBool(
      driver.tnc_endorsement_confirmed ??
      driver.commercial_use_confirmed ??
      false,
      false
    ),
    insurance_expiration_date: insuranceExpiration || null,
    insurance_days_remaining: insuranceDaysRemaining,
    insurance_is_active: insuranceIsActive(driver),
    insurance_is_compliant: driverHasRequiredInsurance(driver),
    compliance_is_clear: driverComplianceIsClear(driver)
  };
}

function driverCanReceiveDispatch(driver, requestedMode = "driver") {
  const approved = driverIsApproved(driver);
  const verified = driverIsVerified(driver);
  const online = driverIsOnline(driver);
  const modeSupported = driverSupportsMode(driver, requestedMode);
  const notSecurityLocked =
    normalizeDriverStatus(driver.status || driver.approval_status) !== "security_locked";

  if (!approved || !verified || !online || !modeSupported || !notSecurityLocked) {
    return false;
  }

  if (ENABLE_DRIVER_COMPLIANCE_GATE && !driverComplianceIsClear(driver)) {
    return false;
  }

  return true;
}

async function setDriverComplianceBlocked(driverId, reason = "compliance_blocked") {
  const rows = await updateRows("drivers", { id: clean(driverId) }, {
    status: "compliance_blocked",
    approval_status: "compliance_blocked",
    compliance_status: "blocked",
    compliance_block_reason: clean(reason),
    is_online: false,
    availability_status: "offline",
    updated_at: nowIso()
  });

  const updated = rows?.[0] || null;

  if (updated) {
    await logComplianceEvent({
      subject_type: "driver",
      subject_id: updated.id,
      event_type: "driver_compliance_blocked",
      severity: "high",
      details: {
        reason: clean(reason)
      }
    });

    emitComplianceRealtime({
      type: "driver_compliance_blocked",
      driver_id: updated.id,
      reason: clean(reason)
    });

    emitDriverRealtime(updated.id, {
      type: "driver_compliance_blocked",
      driver_id: updated.id,
      reason: clean(reason)
    });

    emitAdminRealtime({
      type: "driver_compliance_blocked",
      driver_id: updated.id,
      reason: clean(reason)
    });
  }

  return updated;
}

async function setDriverComplianceApproved(driverId, reason = "compliance_cleared") {
  const rows = await updateRows("drivers", { id: clean(driverId) }, {
    compliance_status: "approved",
    compliance_block_reason: null,
    status: "approved",
    approval_status: "approved",
    updated_at: nowIso()
  });

  const updated = rows?.[0] || null;

  if (updated) {
    await logComplianceEvent({
      subject_type: "driver",
      subject_id: updated.id,
      event_type: "driver_compliance_approved",
      severity: "info",
      details: {
        reason: clean(reason)
      }
    });

    emitComplianceRealtime({
      type: "driver_compliance_approved",
      driver_id: updated.id,
      reason: clean(reason)
    });
  }

  return updated;
}

/* =========================================================
   FAVORITE / PREFERRED DRIVER HELPERS
========================================================= */
async function getFavoriteDriverRecord(riderId, driverId) {
  return maybeSingle(
    requireSupabase()
      .from("favorite_drivers")
      .select("*")
      .eq("rider_id", clean(riderId))
      .eq("driver_id", clean(driverId))
  );
}

async function riderHasFavoriteDriver(riderId, driverId) {
  const record = await getFavoriteDriverRecord(riderId, driverId);
  return !!record && record.is_active !== false;
}

async function addFavoriteDriver(riderId, driverId) {
  const existing = await getFavoriteDriverRecord(riderId, driverId);

  if (existing) {
    const rows = await updateRows("favorite_drivers", { id: existing.id }, {
      is_active: true,
      updated_at: nowIso()
    });
    return rows?.[0] || existing;
  }

  return insertRow("favorite_drivers", {
    id: createId("favdrv"),
    rider_id: clean(riderId),
    driver_id: clean(driverId),
    is_active: true,
    created_at: nowIso(),
    updated_at: nowIso()
  });
}

async function removeFavoriteDriver(riderId, driverId) {
  const existing = await getFavoriteDriverRecord(riderId, driverId);
  if (!existing) return null;

  const rows = await updateRows("favorite_drivers", { id: existing.id }, {
    is_active: false,
    updated_at: nowIso()
  });

  return rows?.[0] || existing;
}

async function getFavoriteDriversForRider(riderId) {
  const { data, error } = await requireSupabase()
    .from("favorite_drivers")
    .select("*")
    .eq("rider_id", clean(riderId))
    .eq("is_active", true)
    .order("updated_at", { ascending: false });

  if (error) throw error;
  return data || [];
}

async function getCompletedRideBetweenRiderAndDriver(riderId, driverId) {
  const { data, error } = await requireSupabase()
    .from("rides")
    .select("*")
    .eq("rider_id", clean(riderId))
    .eq("driver_id", clean(driverId))
    .eq("status", "completed")
    .order("updated_at", { ascending: false })
    .limit(1);

  if (error) throw error;
  return data?.[0] || null;
}

/* =========================================================
   DRIVER SECURITY HELPERS
========================================================= */
async function getRecentDriverSignals(driverId) {
  if (!supabase || !driverId) return {};

  const since24h = new Date(Date.now() - (24 * 60 * 60 * 1000)).toISOString();

  const [timeouts] = await Promise.all([
    requireSupabase()
      .from("dispatches")
      .select("id", { count: "exact", head: true })
      .eq("driver_id", driverId)
      .in("status", ["expired", "timed_out", "declined"])
      .gte("created_at", since24h)
  ]);

  return {
    dispatch_timeouts_24h: timeouts.count || 0,
    support_complaints_30d: 0,
    background_alerts_30d: 0
  };
}

function buildRuleBasedDriverRiskAssessment(payload = {}) {
  const reasons = [];
  let score = 0;

  const recent = payload.recent_activity || {};
  const driver = payload.subject || {};
  const context = payload.context || {};

  const accountAgeHours = toNumber(driver.account_age_hours, 0);
  const dispatchTimeouts24h = toNumber(recent.dispatch_timeouts_24h, 0);
  const supportComplaints30d = toNumber(recent.support_complaints_30d, 0);

  if (accountAgeHours > 0 && accountAgeHours < 24) {
    score += 8;
    reasons.push("Very new driver account");
  }

  if (dispatchTimeouts24h >= 5) {
    score += 15;
    reasons.push("Repeated dispatch timeouts or declines");
  }

  if (supportComplaints30d >= 3) {
    score += 12;
    reasons.push("Multiple support complaints");
  }

  if (context.insurance_is_active === false) {
    score += 18;
    reasons.push("Insurance inactive or expired");
  }

  if (context.compliance_is_clear === false) {
    score += 12;
    reasons.push("Driver compliance not clear");
  }

  score = clamp(score, 0, 100);

  return {
    risk_score: score,
    severity: getSeverityFromScore(score),
    reasons,
    recommended_actions: buildRecommendedSecurityActions(score, "driver", "driver_activity")
  };
}

async function maybeAssessDriverSecurity({
  driver,
  eventType = "driver_activity"
}) {
  try {
    if (!ENABLE_AI_SECURITY_BRAIN || !driver?.id) {
      return { ok: true, skipped: true };
    }

    const recentSignals = await getRecentDriverSignals(driver.id);

    const createdAt = driver.created_at ? new Date(driver.created_at).getTime() : null;
    const accountAgeHours =
      createdAt && Number.isFinite(createdAt)
        ? roundMoney((Date.now() - createdAt) / (1000 * 60 * 60))
        : 0;

    const compliance = buildDriverComplianceSummary(driver);

    const assessmentPayload = {
      subject_type: "driver",
      event_type: eventType,
      subject: {
        id: driver.id,
        email: clean(driver.email || ""),
        phone: clean(driver.phone || ""),
        status: clean(driver.status || ""),
        account_age_hours: accountAgeHours
      },
      recent_activity: recentSignals,
      context: {
        driver_type: normalizeDriverType(driver.driver_type || "human"),
        is_online: !!driver.is_online,
        insurance_is_active: compliance.insurance_is_active,
        compliance_is_clear: compliance.compliance_is_clear
      }
    };

    const ruleAssessment = buildRuleBasedDriverRiskAssessment(assessmentPayload);
    const aiAssessment = await getAiSecurityAssessment(assessmentPayload);
    const merged = mergeSecurityAssessments(ruleAssessment, aiAssessment);

    runtimeState.aiSecurity.lastAssessmentAt = nowIso();
    runtimeState.aiSecurity.lastAssessmentError = null;

    await upsertSecurityProfile({
      subjectType: "driver",
      subjectId: driver.id,
      riskScore: merged.risk_score,
      flags: merged.reasons,
      autoLocked: merged.risk_score >= RISK_CRITICAL_THRESHOLD
    });

    if (merged.risk_score >= RISK_REVIEW_THRESHOLD) {
      await writeSecurityEvent({
        subjectType: "driver",
        subjectId: driver.id,
        eventType,
        title: "Driver security review triggered",
        summary: merged.summary,
        riskScore: merged.risk_score,
        severity: merged.severity,
        evidence: assessmentPayload,
        aiAnalysis: merged.ai_analysis,
        recommendedActions: merged.recommended_actions
      });

      for (const action of merged.recommended_actions) {
        await createSecurityAction({
          subjectType: "driver",
          subjectId: driver.id,
          actionType: action,
          reason: merged.summary,
          metadata: {
            risk_score: merged.risk_score,
            event_type: eventType
          }
        });
      }

      if (merged.risk_score >= RISK_CRITICAL_THRESHOLD) {
        await updateRows("drivers", { id: driver.id }, {
          status: "security_locked",
          approval_status: "security_locked",
          is_online: false,
          availability_status: "offline",
          updated_at: nowIso()
        });
      }
    }

    return {
      ok: true,
      assessment: merged
    };
  } catch (error) {
    runtimeState.aiSecurity.lastAssessmentError = clean(error?.message || String(error));
    return {
      ok: false,
      error: clean(error?.message || String(error))
    };
  }
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

async function getActiveRideForDriver(driverId) {
  const { data, error } = await requireSupabase()
    .from("rides")
    .select("*")
    .eq("driver_id", clean(driverId))
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
  return data?.[0] || null;
}

/* =========================================================
   AI DISPATCH SCORING
========================================================= */
function normalizeScore(value, min, max) {
  if (!Number.isFinite(value)) return 0;
  if (max <= min) return 0;
  return clamp((value - min) / (max - min), 0, 1);
}

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
  const acceptanceRate = getDriverAcceptanceRate(driver);
  const completionRate = getDriverCompletionRate(driver);
  const activityBoost = getDriverActivityBoost(driver);

  const distanceScore = 1 - normalizeScore(distance, 0, 20);
  const ratingScore = normalizeScore(rating, 1, 5);
  const acceptanceScore = normalizeScore(acceptanceRate, 0, 1);
  const completionScore = normalizeScore(completionRate, 0, 1);
  const activityScore = normalizeScore(activityBoost, 0, 1);

  let score =
    distanceScore * SCORE_DISTANCE_WEIGHT +
    ratingScore * SCORE_RATING_WEIGHT +
    acceptanceScore * SCORE_ACCEPTANCE_WEIGHT +
    completionScore * SCORE_COMPLETION_WEIGHT +
    activityScore * SCORE_ACTIVITY_WEIGHT;

  if (normalizeRideMode(ride?.requested_mode) === normalizeDriverType(driver?.driver_type)) {
    score += 0.05;
  }

  if (clean(ride?.preferred_driver_id) === clean(driver?.id)) {
    score += 0.15;
  }

  if (toBool(ride?.preferred_driver_required, false)) {
    score += 0.05;
  }

  return {
    score: roundMoney(score),
    distance_miles_to_pickup: roundMoney(distance),
    rating,
    acceptance_rate: acceptanceRate,
    completion_rate: completionRate,
    activity_boost: activityBoost
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
      preferred_driver_id: clean(ride.preferred_driver_id || ""),
      preferred_driver_required: !!ride.preferred_driver_required,
      sponsored_amount: roundMoney(ride.sponsored_amount || 0),
      rider_copay_amount: roundMoney(ride.rider_copay_amount || 0),
      benefit_type: clean(ride.benefit_type || ""),
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
  const parts = [
    "Harvey Taxi mission available.",
    `Pickup: ${clean(ride.pickup_address)}.`,
    `Dropoff: ${clean(ride.dropoff_address)}.`,
    `Fare est: $${roundMoney(ride.estimated_total)}.`,
    clean(ride.preferred_driver_id) === clean(driver.id) ? "Preferred rider request." : "",
    roundMoney(ride.sponsored_amount || 0) > 0
      ? `Sponsored amount: $${roundMoney(ride.sponsored_amount)}.`
      : "",
    `Dispatch ID: ${clean(dispatch.id)}.`
  ].filter(Boolean);

  return sendSms({
    to: driver.phone,
    body: parts.join(" ")
  });
}

/* =========================================================
   PREFERRED DRIVER DISPATCH HELPERS
========================================================= */
async function getDispatchablePreferredDriverForRide(ride, preferredDriverId) {
  if (!preferredDriverId) return null;

  const driver = await getDriverById(preferredDriverId);
  if (!driver) return null;

  if (!driverCanReceiveDispatch(driver, ride.requested_mode)) {
    return null;
  }

  const activeRide = await getActiveRideForDriver(driver.id);
  if (activeRide) {
    return null;
  }

  const scoring = scoreDriverForRide(driver, ride);
  return { driver, scoring };
}

async function dispatchRideToSpecificDriver(rideId, preferredDriverId, reason = "preferred_driver_requested") {
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
    return { ok: false, error: "Max dispatch attempts reached" };
  }

  const preferred = await getDispatchablePreferredDriverForRide(ride, preferredDriverId);
  if (!preferred) {
    return {
      ok: false,
      error: "Preferred driver unavailable"
    };
  }

  const driverSecurity = await maybeAssessDriverSecurity({
    driver: preferred.driver,
    eventType: "preferred_driver_selection"
  });

  if (driverSecurity?.assessment?.risk_score >= RISK_CRITICAL_THRESHOLD) {
    return {
      ok: false,
      error: "Preferred driver paused for security review"
    };
  }

  const mission = await createMissionForRide(ride, preferred.driver, {
    ...preferred.scoring,
    preferred_driver: true,
    selection_reason: reason
  });

  const dispatch = await createDispatchForRide(ride, preferred.driver, {
    ...preferred.scoring,
    preferred_driver: true,
    selection_reason: reason
  });

  const updatedRideRows = await updateRows("rides", { id: ride.id }, {
    driver_id: preferred.driver.id,
    dispatch_id: dispatch.id,
    mission_id: mission.id,
    status: "awaiting_driver_acceptance",
    preferred_driver_id: clean(preferred.driver.id),
    preferred_driver_attempted: true,
    preferred_driver_dispatched_at: nowIso(),
    updated_at: nowIso()
  });

  const updatedRide = updatedRideRows?.[0] || ride;

  await logTripEvent({
    ride_id: updatedRide.id,
    rider_id: updatedRide.rider_id,
    driver_id: preferred.driver.id,
    mission_id: mission.id,
    event_type: "preferred_driver_dispatch_offered",
    details: {
      dispatch_id: dispatch.id,
      preferred_driver_id: preferred.driver.id,
      reason,
      score: preferred.scoring.score
    }
  });

  await notifyDriverOfMission(preferred.driver, updatedRide, dispatch);

  emitRideRealtime(updatedRide.id, {
    type: "preferred_driver_dispatch_offered",
    ride: buildSafeRideRealtimePayload(updatedRide),
    driver: {
      id: clean(preferred.driver.id),
      full_name: getDriverDisplayName(preferred.driver),
      driver_type: normalizeDriverType(preferred.driver.driver_type || "human")
    },
    dispatch: {
      id: dispatch.id,
      attempt_number: dispatch.attempt_number,
      expires_at: dispatch.expires_at
    }
  });

  emitDriverRealtime(preferred.driver.id, {
    type: "preferred_driver_mission_offered",
    driver_id: preferred.driver.id,
    ride_id: updatedRide.id,
    mission_id: mission.id,
    dispatch_id: dispatch.id
  });

  emitAdminRealtime({
    type: "preferred_driver_dispatch_offered",
    ride_id: updatedRide.id,
    driver_id: preferred.driver.id,
    dispatch_id: dispatch.id
  });

  return {
    ok: true,
    reused: false,
    preferred_driver: true,
    ride: updatedRide,
    driver: preferred.driver,
    mission,
    dispatch,
    scoring: preferred.scoring
  };
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

  const preferredDriverId = clean(
    ride.preferred_driver_id ||
    ride.requested_driver_id ||
    ""
  );

  const preferredRequired = toBool(ride.preferred_driver_required, false);

  if (preferredDriverId && ENABLE_PREFERRED_DRIVER_SYSTEM) {
    const preferredResult = await dispatchRideToSpecificDriver(
      ride.id,
      preferredDriverId,
      preferredRequired ? "preferred_driver_required" : "preferred_driver_first"
    );

    if (preferredResult?.ok) {
      return preferredResult;
    }

    if (preferredRequired) {
      return {
        ok: false,
        error: preferredResult?.error || "Preferred driver unavailable"
      };
    }
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

    emitRideRealtime(ride.id, {
      type: "dispatch_failed_max_attempts",
      ride: buildSafeRideRealtimePayload(rows?.[0] || ride)
    });

    emitAdminRealtime({
      type: "dispatch_failed_max_attempts",
      ride_id: ride.id,
      attempts
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

    emitRideRealtime(ride.id, {
      type: "dispatch_failed_no_candidates",
      ride: buildSafeRideRealtimePayload(rows?.[0] || ride)
    });

    emitAdminRealtime({
      type: "dispatch_failed_no_candidates",
      ride_id: ride.id,
      requested_mode: ride.requested_mode
    });

    return {
      ok: false,
      error: "No eligible drivers available",
      ride: rows?.[0] || ride
    };
  }

  const selected = candidates[0];

  const driverSecurity = await maybeAssessDriverSecurity({
    driver: selected.driver,
    eventType: "dispatch_candidate_selection"
  });

  if (driverSecurity?.assessment?.risk_score >= RISK_CRITICAL_THRESHOLD) {
    return {
      ok: false,
      error: "Selected driver paused for security review"
    };
  }

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

  emitRideRealtime(updatedRide.id, {
    type: "dispatch_offered",
    ride: buildSafeRideRealtimePayload(updatedRide),
    driver: {
      id: clean(selected.driver.id),
      full_name: getDriverDisplayName(selected.driver),
      driver_type: normalizeDriverType(selected.driver.driver_type || "human")
    },
    dispatch: {
      id: dispatch.id,
      attempt_number: dispatch.attempt_number,
      expires_at: dispatch.expires_at
    }
  });

  emitDriverRealtime(selected.driver.id, {
    type: "mission_offered",
    driver_id: selected.driver.id,
    ride_id: updatedRide.id,
    mission_id: mission.id,
    dispatch_id: dispatch.id,
    pickup_address: clean(updatedRide.pickup_address),
    dropoff_address: clean(updatedRide.dropoff_address),
    estimated_total: roundMoney(updatedRide.estimated_total)
  });

  emitAdminRealtime({
    type: "dispatch_offered",
    ride_id: updatedRide.id,
    driver_id: selected.driver.id,
    dispatch_id: dispatch.id,
    score: selected.scoring.score
  });

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
    compliance_status: "pending",
    compliance_block_reason: null,
    insurance_status: "missing",
    insurance_verified: false,
    tnc_endorsement_confirmed: false,
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
    text: "Your driver signup was received. Contact verification, identity verification, insurance compliance, and approval are required before going online."
  });

  await logAdminEvent({
    event_type: "driver_signup_created",
    target_table: "drivers",
    target_id: driver.id,
    details: { email, phone, driver_type: driverType }
  });

  await logComplianceEvent({
    subject_type: "driver",
    subject_id: driver.id,
    event_type: "driver_signup_created",
    severity: "info",
    details: {
      email,
      phone,
      driver_type: driverType
    }
  });

  emitAdminRealtime({
    type: "driver_signup_created",
    driver_id: driver.id,
    email,
    driver_type: driverType
  });

  return ok(res, {
    message: "Driver signup submitted successfully",
    driver: {
      ...driver,
      compliance: buildDriverComplianceSummary(driver)
    }
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
      is_online: driverIsOnline(driver),
      compliance: buildDriverComplianceSummary(driver)
    }
  });
}));

app.get("/api/driver/:driverId/compliance-status", asyncHandler(async (req, res) => {
  const driver = await getDriverById(req.params.driverId);
  if (!driver) return fail(res, "Driver not found", 404);

  return ok(res, {
    driver: {
      id: driver.id,
      full_name: getDriverDisplayName(driver),
      driver_type: normalizeDriverType(driver.driver_type || "human"),
      is_verified: driverIsVerified(driver),
      is_approved: driverIsApproved(driver),
      is_online: driverIsOnline(driver)
    },
    compliance: buildDriverComplianceSummary(driver)
  });
}));

app.post("/api/driver/insurance/upload", asyncHandler(async (req, res) => {
  const driver = await resolveDriver(req.body);
  if (!driver) return fail(res, "Driver not found", 404);

  const insuranceCompany = clean(req.body.insurance_company || req.body.insuranceCompany);
  const policyNumber = clean(req.body.insurance_policy_number || req.body.policy_number || req.body.policyNumber);
  const expirationDate = clean(
    req.body.insurance_expiration_date ||
    req.body.insurance_expiration ||
    req.body.policy_expiration_date
  );
  const effectiveDate = clean(
    req.body.insurance_effective_date ||
    req.body.insurance_effective ||
    req.body.policy_effective_date
  );
  const liabilityLimit = clean(req.body.insurance_liability_limit || req.body.liability_limit);
  const docUrl = clean(req.body.insurance_doc_url || req.body.document_url || req.body.docUrl);
  const tncConfirmed = toBool(
    req.body.tnc_endorsement_confirmed || req.body.commercial_use_confirmed,
    false
  );

  if (!insuranceCompany) return fail(res, "Insurance company is required");
  if (!policyNumber) return fail(res, "Policy number is required");
  if (!expirationDate) return fail(res, "Insurance expiration date is required");

  const rows = await updateRows("drivers", { id: driver.id }, {
    insurance_company: insuranceCompany,
    insurance_policy_number: policyNumber,
    insurance_effective_date: effectiveDate || null,
    insurance_expiration_date: expirationDate,
    insurance_liability_limit: liabilityLimit || null,
    insurance_doc_url: docUrl || null,
    insurance_status: "pending",
    insurance_verified: false,
    tnc_endorsement_confirmed: tncConfirmed,
    compliance_status: "pending",
    compliance_block_reason: null,
    updated_at: nowIso()
  });

  const updatedDriver = rows?.[0] || driver;

  await logComplianceEvent({
    subject_type: "driver",
    subject_id: updatedDriver.id,
    event_type: "driver_insurance_uploaded",
    severity: "info",
    details: {
      insurance_company: insuranceCompany,
      insurance_expiration_date: expirationDate,
      tnc_endorsement_confirmed: tncConfirmed
    }
  });

  emitComplianceRealtime({
    type: "driver_insurance_uploaded",
    driver_id: updatedDriver.id
  });

  emitAdminRealtime({
    type: "driver_insurance_uploaded",
    driver_id: updatedDriver.id
  });

  return ok(res, {
    message: "Driver insurance submitted successfully",
    driver: updatedDriver,
    compliance: buildDriverComplianceSummary(updatedDriver)
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

  if (normalizeDriverStatus(driver.status || driver.approval_status) === "security_locked") {
    return fail(res, "Driver account is locked for security review", 403);
  }

  if (ENABLE_DRIVER_COMPLIANCE_GATE && !driverComplianceIsClear(driver)) {
    return fail(res, "Driver compliance clearance is required", 403, {
      compliance: buildDriverComplianceSummary(driver)
    });
  }

  if (ENABLE_DRIVER_INSURANCE_GATE && !driverHasRequiredInsurance(driver)) {
    return fail(res, "Driver insurance approval is required", 403, {
      compliance: buildDriverComplianceSummary(driver)
    });
  }

  const securityCheck = await maybeAssessDriverSecurity({
    driver,
    eventType: "driver_go_online"
  });

  if (securityCheck?.assessment?.risk_score >= RISK_CRITICAL_THRESHOLD) {
    return fail(res, "Driver cannot go online due to security review", 403, {
      security: securityCheck.assessment
    });
  }

  const rows = await updateRows("drivers", { id: driver.id }, {
    is_online: true,
    availability_status: "online",
    compliance_status: driver.compliance_status || "approved",
    last_heartbeat_at: nowIso(),
    updated_at: nowIso()
  });

  const updatedDriver = rows?.[0] || driver;

  emitDriverRealtime(updatedDriver.id, {
    type: "driver_online",
    driver_id: updatedDriver.id,
    availability_status: "online",
    updated_at: updatedDriver.updated_at
  });

  emitAdminRealtime({
    type: "driver_online",
    driver_id: updatedDriver.id
  });

  return ok(res, {
    message: "Driver is now online",
    driver: updatedDriver,
    security: securityCheck?.assessment || null,
    compliance: buildDriverComplianceSummary(updatedDriver)
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

  const updatedDriver = rows?.[0] || driver;

  emitDriverRealtime(updatedDriver.id, {
    type: "driver_offline",
    driver_id: updatedDriver.id,
    availability_status: "offline",
    updated_at: updatedDriver.updated_at
  });

  emitAdminRealtime({
    type: "driver_offline",
    driver_id: updatedDriver.id
  });

  return ok(res, {
    message: "Driver is now offline",
    driver: updatedDriver
  });
}));

app.post("/api/driver/location", asyncHandler(async (req, res) => {
  const driver = await resolveDriver(req.body);
  if (!driver) return fail(res, "Driver not found", 404);

  if (!ENABLE_DRIVER_LOCATION_TRACKING) {
    return fail(res, "Driver location tracking is disabled", 403);
  }

  if (ENABLE_DRIVER_COMPLIANCE_GATE && !driverComplianceIsClear(driver)) {
    return fail(res, "Driver compliance clearance is required", 403, {
      compliance: buildDriverComplianceSummary(driver)
    });
  }

  const latitude = parseNullableNumber(req.body.latitude ?? req.body.current_latitude ?? req.body.lat);
  const longitude = parseNullableNumber(req.body.longitude ?? req.body.current_longitude ?? req.body.lng);

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return fail(res, "Valid latitude and longitude are required");
  }

  const rows = await updateRows("drivers", { id: driver.id }, {
    current_latitude: latitude,
    current_longitude: longitude,
    last_location_at: nowIso(),
    last_heartbeat_at: nowIso(),
    updated_at: nowIso()
  });

  const updatedDriver = rows?.[0] || driver;
  const activeRide = await getActiveRideForDriver(updatedDriver.id);

  emitDriverRealtime(updatedDriver.id, {
    type: "driver_location_updated",
    driver_id: updatedDriver.id,
    ride_id: activeRide?.id || null,
    latitude,
    longitude,
    last_location_at: updatedDriver.last_location_at
  });

  if (activeRide) {
    emitRideRealtime(activeRide.id, {
      type: "driver_location_updated",
      ride_id: activeRide.id,
      driver_id: updatedDriver.id,
      latitude,
      longitude,
      last_location_at: updatedDriver.last_location_at
    });
  }

  emitAdminRealtime({
    type: "driver_location_updated",
    driver_id: updatedDriver.id,
    ride_id: activeRide?.id || null
  });

  return ok(res, {
    message: "Driver location updated",
    driver: updatedDriver,
    active_ride_id: activeRide?.id || null
  });
}));

app.post("/api/driver/heartbeat", asyncHandler(async (req, res) => {
  if (!ENABLE_DRIVER_HEARTBEAT) {
    return fail(res, "Driver heartbeat is disabled", 403);
  }

  const driver = await resolveDriver(req.body);
  if (!driver) return fail(res, "Driver not found", 404);

  if (ENABLE_DRIVER_COMPLIANCE_GATE && !driverComplianceIsClear(driver)) {
    return fail(res, "Driver compliance clearance is required", 403, {
      compliance: buildDriverComplianceSummary(driver)
    });
  }

  const latitude = parseNullableNumber(req.body.latitude ?? req.body.current_latitude ?? req.body.lat);
  const longitude = parseNullableNumber(req.body.longitude ?? req.body.current_longitude ?? req.body.lng);

  const updatePayload = {
    last_heartbeat_at: nowIso(),
    updated_at: nowIso()
  };

  if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
    updatePayload.current_latitude = latitude;
    updatePayload.current_longitude = longitude;
    updatePayload.last_location_at = nowIso();
  }

  const rows = await updateRows("drivers", { id: driver.id }, updatePayload);
  const updatedDriver = rows?.[0] || driver;
  const activeRide = await getActiveRideForDriver(updatedDriver.id);

  emitDriverRealtime(updatedDriver.id, {
    type: "driver_heartbeat",
    driver_id: updatedDriver.id,
    ride_id: activeRide?.id || null,
    latitude: Number.isFinite(latitude) ? latitude : null,
    longitude: Number.isFinite(longitude) ? longitude : null,
    last_heartbeat_at: updatedDriver.last_heartbeat_at
  });

  if (activeRide && Number.isFinite(latitude) && Number.isFinite(longitude)) {
    emitRideRealtime(activeRide.id, {
      type: "driver_heartbeat",
      ride_id: activeRide.id,
      driver_id: updatedDriver.id,
      latitude,
      longitude,
      last_heartbeat_at: updatedDriver.last_heartbeat_at
    });
  }

  return ok(res, {
    message: "Driver heartbeat received",
    driver_id: updatedDriver.id,
    last_heartbeat_at: updatedDriver.last_heartbeat_at,
    active_ride_id: activeRide?.id || null
  });
}));

/* =========================================================
   DRIVER HEARTBEAT SWEEP
========================================================= */
async function sweepStaleDrivers() {
  if (!ENABLE_DRIVER_HEARTBEAT) return { ok: true, skipped: true };

  const staleBefore = new Date(Date.now() - DRIVER_HEARTBEAT_STALE_MS).toISOString();

  const { data, error } = await requireSupabase()
    .from("drivers")
    .select("*")
    .eq("is_online", true)
    .lt("last_heartbeat_at", staleBefore)
    .limit(100);

  if (error) throw error;

  const results = [];

  for (const driver of data || []) {
    await updateRows("drivers", { id: driver.id }, {
      is_online: false,
      availability_status: "offline",
      updated_at: nowIso()
    });

    results.push(clean(driver.id));

    emitDriverRealtime(driver.id, {
      type: "driver_marked_offline_stale",
      driver_id: driver.id
    });

    emitAdminRealtime({
      type: "driver_marked_offline_stale",
      driver_id: driver.id
    });

    await sleep(10);
  }

  return {
    ok: true,
    count: results.length,
    driver_ids: results
  };
}

function startDriverHeartbeatSweepLoop() {
  if (!ENABLE_DRIVER_HEARTBEAT) return;

  setInterval(async () => {
    try {
      const result = await sweepStaleDrivers();
      if (result?.count > 0) {
        console.log(`💓 Driver heartbeat sweep marked ${result.count} driver(s) offline`);
      }
    } catch (error) {
      console.error("❌ Driver heartbeat sweep failed:", error);
    }
  }, Math.max(15_000, DRIVER_HEARTBEAT_STALE_MS / 2));
}

/* =========================================================
   COMPLIANCE SWEEP
========================================================= */
async function sweepDriverCompliance() {
  if (!ENABLE_COMPLIANCE_SWEEPS) {
    return { ok: true, skipped: true, reason: "disabled" };
  }

  if (runtimeState.complianceSweep.running) {
    return { ok: true, skipped: true, reason: "already_running" };
  }

  runtimeState.complianceSweep.running = true;
  runtimeState.complianceSweep.lastRanAt = nowIso();
  runtimeState.insurance.lastSweepAt = nowIso();

  try {
    const { data, error } = await requireSupabase()
      .from("drivers")
      .select("*")
      .order("updated_at", { ascending: false })
      .limit(250);

    if (error) throw error;

    const results = [];

    for (const driver of data || []) {
      const compliance = buildDriverComplianceSummary(driver);
      const reasonParts = [];

      if (ENABLE_DRIVER_INSURANCE_GATE) {
        if (!compliance.insurance_verified) reasonParts.push("insurance_not_verified");
        if (!compliance.tnc_endorsement_confirmed) reasonParts.push("tnc_endorsement_missing");
        if (!compliance.insurance_is_active) reasonParts.push("insurance_inactive_or_expired");
      }

      if (reasonParts.length) {
        const updated = await setDriverComplianceBlocked(driver.id, reasonParts.join(","));

        if (ENABLE_DRIVER_INSURANCE_EXPIRY_WARNINGS && compliance.insurance_days_remaining !== null) {
          const warningDays = [
            INSURANCE_EXPIRY_WARNING_DAYS_1,
            INSURANCE_EXPIRY_WARNING_DAYS_2,
            INSURANCE_EXPIRY_WARNING_DAYS_3
          ];

          if (warningDays.includes(compliance.insurance_days_remaining)) {
            await logComplianceEvent({
              subject_type: "driver",
              subject_id: driver.id,
              event_type: "driver_insurance_expiry_warning",
              severity: "medium",
              details: {
                insurance_days_remaining: compliance.insurance_days_remaining,
                insurance_expiration_date: compliance.insurance_expiration_date
              }
            });
          }
        }

        results.push({
          driver_id: driver.id,
          status: "blocked",
          reason: reasonParts.join(","),
          updated: !!updated
        });
      } else {
        const updated = await setDriverComplianceApproved(driver.id, "compliance_sweep_clear");
        results.push({
          driver_id: driver.id,
          status: "approved",
          updated: !!updated
        });
      }

      await sleep(10);
    }

    runtimeState.complianceSweep.lastError = null;
    runtimeState.insurance.lastSweepError = null;

    return {
      ok: true,
      count: results.length,
      results
    };
  } catch (error) {
    runtimeState.complianceSweep.lastError = clean(error?.message || String(error));
    runtimeState.insurance.lastSweepError = clean(error?.message || String(error));
    throw error;
  } finally {
    runtimeState.complianceSweep.running = false;
  }
}

function startComplianceSweepLoop() {
  if (!ENABLE_COMPLIANCE_SWEEPS) return;
  if (runtimeState.complianceSweep.timerStarted) return;

  runtimeState.complianceSweep.timerStarted = true;

  setInterval(async () => {
    try {
      const result = await sweepDriverCompliance();
      if (result?.count > 0) {
        console.log(`📋 Compliance sweep processed ${result.count} driver(s)`);
      }
    } catch (error) {
      console.error("❌ Compliance sweep failed:", error);
    }
  }, COMPLIANCE_SWEEP_INTERVAL_MS);
}

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
    scoring: result.scoring || null,
    preferred_driver: !!result.preferred_driver
  });
}));

/* =========================================================
   MISSION ACCEPT / DECLINE
========================================================= */
app.post("/api/mission/accept", asyncHandler(async (req, res) => {
  const driver = await resolveDriver(req.body);
  if (!driver) return fail(res, "Driver not found", 404);

  if (ENABLE_DRIVER_COMPLIANCE_GATE && !driverComplianceIsClear(driver)) {
    return fail(res, "Driver compliance clearance is required", 403, {
      compliance: buildDriverComplianceSummary(driver)
    });
  }

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

    emitRideRealtime(dispatch.ride_id, {
      type: "dispatch_expired_before_accept",
      ride_id: dispatch.ride_id
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

  emitRideRealtime(ride.id, {
    type: "driver_accepted_dispatch",
    ride: buildSafeRideRealtimePayload(updatedRide?.[0] || ride)
  });

  emitDriverRealtime(driver.id, {
    type: "mission_accepted",
    driver_id: driver.id,
    ride_id: ride.id,
    mission_id: mission.id
  });

  emitAdminRealtime({
    type: "driver_accepted_dispatch",
    driver_id: driver.id,
    ride_id: ride.id,
    mission_id: mission.id
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

  const queuedRide = queuedRideRows?.[0] || null;

  await logTripEvent({
    ride_id: dispatch.ride_id,
    rider_id: queuedRide?.rider_id || null,
    driver_id: driver.id,
    mission_id: mission.id,
    event_type: "driver_declined_dispatch",
    details: { dispatch_id: dispatch.id, reason }
  });

  emitRideRealtime(dispatch.ride_id, {
    type: "driver_declined_dispatch",
    ride: buildSafeRideRealtimePayload(
      queuedRide || { id: dispatch.ride_id, status: "awaiting_dispatch" }
    ),
    reason
  });

  emitDriverRealtime(driver.id, {
    type: "mission_declined",
    driver_id: driver.id,
    ride_id: dispatch.ride_id,
    reason
  });

  emitAdminRealtime({
    type: "driver_declined_dispatch",
    driver_id: driver.id,
    ride_id: dispatch.ride_id,
    reason
  });

  const redispatch = ENABLE_AUTO_REDISPATCH
    ? await dispatchRideToBestDriver(dispatch.ride_id)
    : null;

  return ok(res, {
    message: ENABLE_AUTO_REDISPATCH
      ? "Mission declined and redispatch attempted"
      : "Mission declined",
    ride: queuedRide,
    redispatch
  });
}));

/* =========================================================
   MISSION STATUS LIFECYCLE
========================================================= */
async function updateMissionAndRideStatus(missionId, newStatus, eventType) {
  if (!missionId) throw new Error("Mission ID is required");

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

  const updatedMission = missionRows?.[0] || mission;
  const updatedRide = rideRows?.[0] || ride;

  emitRideRealtime(ride.id, {
    type: eventType,
    ride: buildSafeRideRealtimePayload(updatedRide)
  });

  if (mission.driver_id) {
    emitDriverRealtime(mission.driver_id, {
      type: eventType,
      driver_id: mission.driver_id,
      ride_id: ride.id,
      mission_id: mission.id
    });
  }

  emitAdminRealtime({
    type: eventType,
    ride_id: ride.id,
    mission_id: mission.id,
    driver_id: mission.driver_id
  });

  return {
    mission: updatedMission,
    ride: updatedRide
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

  await updateRows("missions", { id: missionId }, {
    started_at: nowIso(),
    updated_at: nowIso()
  });

  await updateRows("rides", { id: result.ride.id }, {
    started_at: nowIso(),
    updated_at: nowIso()
  });

  emitRideRealtime(result.ride.id, {
    type: "trip_started",
    ride: buildSafeRideRealtimePayload({ ...result.ride, started_at: nowIso() })
  });

  return ok(res, { message: "Trip started", ...result });
}));

app.post("/api/mission/complete", asyncHandler(async (req, res) => {
  const missionId = pickFirst(req.body.mission_id, req.body.missionId);
  const result = await updateMissionAndRideStatus(missionId, "completed", "trip_completed");

  await updateRows("missions", { id: missionId }, {
    completed_at: nowIso(),
    updated_at: nowIso()
  });

  await updateRows("rides", { id: result.ride.id }, {
    completed_at: nowIso(),
    updated_at: nowIso()
  });

  emitRideRealtime(result.ride.id, {
    type: "trip_completed",
    ride: buildSafeRideRealtimePayload({ ...result.ride, completed_at: nowIso() })
  });

  return ok(res, { message: "Trip completed", ...result });
}));

/* =========================================================
   AUTO REDISPATCH SWEEP
========================================================= */
async function sweepExpiredDispatches() {
  if (runtimeState.dispatchSweep.running) {
    return { ok: true, skipped: true, reason: "already_running" };
  }

  runtimeState.dispatchSweep.running = true;
  runtimeState.dispatchSweep.lastRanAt = nowIso();

  try {
    const { data, error } = await requireSupabase()
      .from("dispatches")
      .select("*")
      .in("status", ["offered", "awaiting_driver_acceptance"])
      .lte("expires_at", nowIso())
      .order("created_at", { ascending: true })
      .limit(DISPATCH_BATCH_LIMIT);

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

      emitRideRealtime(dispatch.ride_id, {
        type: "dispatch_expired",
        ride_id: dispatch.ride_id,
        dispatch_id: dispatch.id,
        attempt_number: dispatch.attempt_number
      });

      emitDriverRealtime(dispatch.driver_id, {
        type: "dispatch_expired",
        driver_id: dispatch.driver_id,
        ride_id: dispatch.ride_id,
        dispatch_id: dispatch.id
      });

      emitAdminRealtime({
        type: "dispatch_expired",
        ride_id: dispatch.ride_id,
        driver_id: dispatch.driver_id,
        dispatch_id: dispatch.id
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

    runtimeState.dispatchSweep.lastError = null;
    return { ok: true, count: results.length, results };
  } catch (error) {
    runtimeState.dispatchSweep.lastError = clean(error?.message || String(error));
    throw error;
  } finally {
    runtimeState.dispatchSweep.running = false;
  }
}

function startDispatchSweepLoop() {
  if (!ENABLE_AUTO_REDISPATCH) return;
  if (runtimeState.dispatchSweep.timerStarted) return;

  runtimeState.dispatchSweep.timerStarted = true;

  setInterval(async () => {
    try {
      const result = await sweepExpiredDispatches();
      if (result?.count > 0) {
        console.log(`🔁 Dispatch sweep expired ${result.count} dispatch(es)`);
      }
    } catch (error) {
      console.error("❌ Dispatch sweep failed:", error);
    }
  }, DISPATCH_SWEEP_INTERVAL_MS);
         }/* =========================================================
   HARVEY TAXI — CODE BLUE PHASE 12
   PART 4 OF 4
   LIVE STATUS + PAYMENTS + TIPPING + EARNINGS + ADMIN + AI + STARTUP
   PREFERRED DRIVER + INSURANCE COMPLIANCE + NONPROFIT BENEFITS
========================================================= */

/* =========================================================
   PAYMENT / EARNINGS HELPERS
========================================================= */
async function getPaymentById(paymentId) {
  return getRowById("payments", "id", clean(paymentId));
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

async function createDriverEarningEntry({
  driver_id,
  ride_id,
  mission_id = null,
  gross_fare = 0,
  tip_amount = 0,
  payout_amount = 0,
  platform_fee = 0,
  sponsored_amount = 0,
  rider_copay_amount = 0,
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
      sponsored_amount: roundMoney(sponsored_amount),
      rider_copay_amount: roundMoney(rider_copay_amount),
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
      authorization_amount: 0,
      gross_authorization_amount: 0,
      sponsored_amount: 0,
      sponsorship_percent: 0
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
    gross_authorization_amount: roundMoney(
      payment.gross_authorization_amount || payment.authorization_amount || 0
    ),
    sponsored_amount: roundMoney(payment.sponsored_amount || 0),
    sponsorship_percent: roundMoney(payment.sponsorship_percent || 0),
    captured_amount: roundMoney(payment.captured_amount || 0),
    tip_amount: roundMoney(payment.tip_amount || 0),
    benefit_type: clean(payment.benefit_type || ""),
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

function sanitizeDriverForRider(driver = {}) {
  return {
    id: clean(driver.id || ""),
    full_name: clean(driver.full_name || ""),
    driver_type: clean(driver.driver_type || "human"),
    phone: clean(driver.phone || ""),
    last_location_at: clean(driver.last_location_at || ""),
    compliance_status: clean(driver.compliance_status || "")
  };
}

function sanitizeDriverForDriver(driver = {}) {
  return {
    id: clean(driver.id || ""),
    full_name: clean(driver.full_name || ""),
    driver_type: clean(driver.driver_type || "human"),
    phone: clean(driver.phone || ""),
    current_latitude: parseNullableNumber(driver.current_latitude),
    current_longitude: parseNullableNumber(driver.current_longitude),
    last_location_at: clean(driver.last_location_at || ""),
    compliance_status: clean(driver.compliance_status || "")
  };
}

function sanitizeRideForPublic(ride = {}) {
  return {
    id: clean(ride.id || ""),
    rider_id: clean(ride.rider_id || ""),
    driver_id: clean(ride.driver_id || ""),
    mission_id: clean(ride.mission_id || ""),
    dispatch_id: clean(ride.dispatch_id || ""),
    status: normalizeRideStatus(ride.status || "pending"),
    ride_type: normalizeRideType(ride.ride_type || "standard"),
    requested_mode: normalizeRideMode(ride.requested_mode || "driver"),
    pickup_address: clean(ride.pickup_address || ""),
    dropoff_address: clean(ride.dropoff_address || ""),
    estimated_total: roundMoney(ride.estimated_total || 0),
    final_total: roundMoney(ride.final_total || 0),
    tip_amount: roundMoney(ride.tip_amount || 0),
    payment_status: clean(ride.payment_status || ""),
    started_at: clean(ride.started_at || ""),
    completed_at: clean(ride.completed_at || ""),
    created_at: clean(ride.created_at || ""),
    updated_at: clean(ride.updated_at || ""),

    preferred_driver_id: clean(ride.preferred_driver_id || ""),
    preferred_driver_required: !!ride.preferred_driver_required,
    preferred_driver_attempted: !!ride.preferred_driver_attempted,
    preferred_driver_policy: clean(ride.preferred_driver_policy || ""),

    sponsorship_type: clean(ride.sponsorship_type || ""),
    sponsorship_percent: roundMoney(ride.sponsorship_percent || 0),
    sponsored_amount: roundMoney(ride.sponsored_amount || 0),
    rider_copay_amount: roundMoney(ride.rider_copay_amount || 0),
    benefit_type: clean(ride.benefit_type || ""),
    benefit_source: clean(ride.benefit_source || "")
  };
}

function sanitizeRideForDriver(ride = {}) {
  return {
    ...sanitizeRideForPublic(ride),
    pickup_latitude: parseNullableNumber(ride.pickup_latitude),
    pickup_longitude: parseNullableNumber(ride.pickup_longitude),
    dropoff_latitude: parseNullableNumber(ride.dropoff_latitude),
    dropoff_longitude: parseNullableNumber(ride.dropoff_longitude)
  };
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

  let sponsoredRide = null;
  try {
    const { data, error } = await requireSupabase()
      .from("sponsored_rides")
      .select("*")
      .eq("ride_id", clean(ride.id))
      .order("created_at", { ascending: false })
      .limit(1);

    if (!error) {
      sponsoredRide = data?.[0] || null;
    }
  } catch (error) {
    console.warn("⚠️ Sponsored ride lookup skipped:", error.message);
  }

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
          last_location_at: clean(driver.last_location_at || ""),
          compliance_status: clean(driver.compliance_status || ""),
          compliance_block_reason: clean(driver.compliance_block_reason || "")
        }
      : null,
    payment: buildPaymentSummary(payment),
    timeline: await getRideTimeline(ride.id),
    sponsored_ride: sponsoredRide
  };
}

/* =========================================================
   LIVE RIDE ROUTES
========================================================= */
app.get("/api/rides/:rideId/live", asyncHandler(async (req, res) => {
  const liveState = await buildRideLiveState(req.params.rideId);
  if (!liveState) return fail(res, "Ride not found", 404);

  return ok(res, {
    ride: sanitizeRideForPublic(liveState.ride),
    mission: liveState.mission,
    dispatch: liveState.dispatch,
    driver: liveState.driver ? sanitizeDriverForRider(liveState.driver) : null,
    payment: liveState.payment,
    timeline: liveState.timeline,
    sponsored_ride: liveState.sponsored_ride
  });
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

  const liveState = await buildRideLiveState(ride.id);

  return ok(res, {
    ride: sanitizeRideForDriver(liveState.ride),
    mission: liveState.mission,
    dispatch: liveState.dispatch,
    driver: liveState.driver ? sanitizeDriverForDriver(liveState.driver) : null,
    payment: liveState.payment,
    timeline: liveState.timeline,
    sponsored_ride: liveState.sponsored_ride
  });
}));

app.get("/api/rider/:riderId/rides", asyncHandler(async (req, res) => {
  const rider = await getRiderById(req.params.riderId);
  if (!rider) return fail(res, "Rider not found", 404);

  const { data, error } = await requireSupabase()
    .from("rides")
    .select("*")
    .eq("rider_id", clean(rider.id))
    .order("updated_at", { ascending: false })
    .limit(100);

  if (error) throw error;

  return ok(res, {
    rides: (data || []).map((ride) => sanitizeRideForPublic(ride))
  });
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
  const baseAmount = roundMoney(
    toNumber(
      req.body.amount,
      ride.final_total ||
      ride.estimated_total ||
      payment.gross_authorization_amount ||
      payment.authorization_amount ||
      0
    )
  );

  const sponsoredAmount = roundMoney(
    toNumber(req.body.sponsored_amount, ride.sponsored_amount || payment.sponsored_amount || 0)
  );

  const riderCopayAmount = roundMoney(
    toNumber(
      req.body.rider_copay_amount,
      ride.rider_copay_amount ||
      payment.authorization_amount ||
      Math.max(0, baseAmount - sponsoredAmount)
    )
  );

  const captureAmount = roundMoney(riderCopayAmount + tipAmount);

  const updatedPayments = await updateRows("payments", { id: payment.id }, {
    ride_id: ride.id,
    status: "captured",
    payment_status: "captured",
    captured_amount: captureAmount,
    gross_captured_amount: baseAmount,
    sponsored_amount: sponsoredAmount,
    tip_amount: tipAmount,
    captured_at: nowIso(),
    updated_at: nowIso()
  });

  const payoutBase = calculateDriverPayout(
    baseAmount,
    ride.requested_mode === "autonomous" ? "autonomous" : "human"
  );

  const finalDriverPayout = roundMoney(payoutBase.driver_payout_estimate + tipAmount);
  const finalPlatformFee = roundMoney(baseAmount + tipAmount - finalDriverPayout);

  const updatedRide = await updateRideFinancials(ride.id, {
    payment_id: payment.id,
    final_total: roundMoney(baseAmount + tipAmount),
    captured_amount: captureAmount,
    gross_captured_amount: baseAmount,
    tip_amount: tipAmount,
    sponsored_amount: sponsoredAmount,
    rider_copay_amount: riderCopayAmount,
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
      sponsored_amount: sponsoredAmount,
      rider_copay_amount: riderCopayAmount,
      status: "earned"
    });
  }

  if (ENABLE_SPONSORED_RIDES && roundMoney(sponsoredAmount) > 0) {
    try {
      const { data: sponsoredRows, error: sponsoredError } = await requireSupabase()
        .from("sponsored_rides")
        .select("*")
        .eq("ride_id", clean(ride.id))
        .order("created_at", { ascending: false })
        .limit(1);

      if (!sponsoredError && sponsoredRows?.[0]) {
        await updateRows("sponsored_rides", { id: sponsoredRows[0].id }, {
          status: "captured",
          sponsored_amount: sponsoredAmount,
          rider_copay_amount: riderCopayAmount,
          updated_at: nowIso()
        });
      }

      await logBenefitEvent({
        rider_id: ride.rider_id,
        ride_id: ride.id,
        application_id: ride.benefit_approval_id || null,
        event_type: "sponsored_ride_captured",
        details: {
          sponsored_amount: sponsoredAmount,
          rider_copay_amount: riderCopayAmount,
          tip_amount: tipAmount
        }
      });

      emitBenefitsRealtime({
        type: "sponsored_ride_captured",
        ride_id: ride.id,
        sponsored_amount: sponsoredAmount,
        rider_copay_amount: riderCopayAmount
      });
    } catch (error) {
      console.warn("⚠️ Sponsored ride capture update skipped:", error.message);
    }
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
      gross_capture_amount: baseAmount,
      sponsored_amount: sponsoredAmount,
      rider_copay_amount: riderCopayAmount,
      tip_amount: tipAmount
    }
  });

  emitRideRealtime(ride.id, {
    type: "payment_captured",
    ride: buildSafeRideRealtimePayload(updatedRide || ride),
    payment: buildPaymentSummary(updatedPayments?.[0] || payment)
  });

  if (ride.driver_id) {
    emitDriverRealtime(ride.driver_id, {
      type: "payment_captured",
      driver_id: ride.driver_id,
      ride_id: ride.id,
      capture_amount: captureAmount,
      gross_capture_amount: baseAmount,
      tip_amount: tipAmount
    });
  }

  emitAdminRealtime({
    type: "payment_captured",
    ride_id: ride.id,
    payment_id: payment.id,
    capture_amount: captureAmount,
    gross_capture_amount: baseAmount,
    sponsored_amount: sponsoredAmount
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

    emitRideRealtime(ride.id, {
      type: "payment_released",
      ride_id: ride.id,
      payment_id: payment.id
    });
  }

  emitAdminRealtime({
    type: "payment_released",
    payment_id: payment.id,
    ride_id: ride?.id || null
  });

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
    Math.max(0, baseFare - currentTip),
    ride.requested_mode === "autonomous" ? "autonomous" : "human"
  );

  const newDriverPayout = roundMoney(payoutBase.driver_payout_estimate + newTipTotal);
  const newFinalTotal = roundMoney(Math.max(0, baseFare - currentTip) + newTipTotal);
  const newPlatformFee = roundMoney(newFinalTotal - newDriverPayout);

  const updatedRide = await updateRideFinancials(ride.id, {
    tip_amount: newTipTotal,
    final_total: newFinalTotal,
    estimated_driver_payout: newDriverPayout,
    estimated_platform_fee: newPlatformFee
  });

  emitRideRealtime(ride.id, {
    type: "tip_added",
    ride: buildSafeRideRealtimePayload(updatedRide || ride),
    tip_amount: tipAmount,
    new_tip_total: newTipTotal
  });

  if (ride.driver_id) {
    emitDriverRealtime(ride.driver_id, {
      type: "tip_added",
      driver_id: ride.driver_id,
      ride_id: ride.id,
      tip_amount: tipAmount,
      new_tip_total: newTipTotal
    });
  }

  emitAdminRealtime({
    type: "tip_added",
    ride_id: ride.id,
    driver_id: ride.driver_id || null,
    tip_amount: tipAmount
  });

  await logTripEvent({
    ride_id: ride.id,
    rider_id: ride.rider_id,
    driver_id: ride.driver_id,
    mission_id: ride.mission_id,
    event_type: "tip_added",
    details: {
      tip_amount: tipAmount,
      new_tip_total: newTipTotal
    }
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
    earnings,
    compliance: buildDriverComplianceSummary(driver)
  });
}));

/* =========================================================
   FAVORITE DRIVER ROUTES
========================================================= */
app.post("/api/rider/favorite-driver", asyncHandler(async (req, res) => {
  const rider = await resolveRider(req.body);
  if (!rider) return fail(res, "Rider not found", 404);

  const driverId = pickFirst(req.body.driver_id, req.body.driverId);
  if (!driverId) return fail(res, "Driver ID is required");

  const driver = await getDriverById(driverId);
  if (!driver) return fail(res, "Driver not found", 404);

  const completedRide = await getCompletedRideBetweenRiderAndDriver(rider.id, driver.id);
  if (!completedRide) {
    return fail(res, "Driver can only be favorited after a completed ride", 403);
  }

  const favorite = await addFavoriteDriver(rider.id, driver.id);

  await logAdminEvent({
    event_type: "rider_favorited_driver",
    target_table: "favorite_drivers",
    target_id: favorite.id,
    details: {
      rider_id: rider.id,
      driver_id: driver.id
    }
  });

  return ok(res, {
    message: "Driver added to favorites",
    favorite
  }, 201);
}));

app.post("/api/rider/unfavorite-driver", asyncHandler(async (req, res) => {
  const rider = await resolveRider(req.body);
  if (!rider) return fail(res, "Rider not found", 404);

  const driverId = pickFirst(req.body.driver_id, req.body.driverId);
  if (!driverId) return fail(res, "Driver ID is required");

  const favorite = await removeFavoriteDriver(rider.id, driverId);
  if (!favorite) return fail(res, "Favorite driver record not found", 404);

  return ok(res, {
    message: "Driver removed from favorites",
    favorite
  });
}));

app.get("/api/rider/:riderId/favorite-drivers", asyncHandler(async (req, res) => {
  const rider = await getRiderById(req.params.riderId);
  if (!rider) return fail(res, "Rider not found", 404);

  const favorites = await getFavoriteDriversForRider(rider.id);
  const driverIds = favorites.map((f) => clean(f.driver_id)).filter(Boolean);

  let drivers = [];
  if (driverIds.length) {
    const { data, error } = await requireSupabase()
      .from("drivers")
      .select("*")
      .in("id", driverIds);

    if (error) throw error;
    drivers = data || [];
  }

  const results = favorites.map((fav) => {
    const driver = drivers.find((d) => clean(d.id) === clean(fav.driver_id));
    return {
      favorite_id: fav.id,
      rider_id: fav.rider_id,
      driver_id: fav.driver_id,
      created_at: fav.created_at,
      updated_at: fav.updated_at,
      driver: driver
        ? {
            id: driver.id,
            full_name: getDriverDisplayName(driver),
            driver_type: normalizeDriverType(driver.driver_type || "human"),
            status: normalizeDriverStatus(driver.status || driver.approval_status),
            is_online: driverIsOnline(driver),
            is_approved: driverIsApproved(driver),
            is_verified: driverIsVerified(driver),
            compliance: buildDriverComplianceSummary(driver)
          }
        : null
    };
  });

  return ok(res, {
    rider: {
      id: rider.id,
      full_name: clean(rider.full_name || `${rider.first_name || ""} ${rider.last_name || ""}`.trim())
    },
    favorite_drivers: results
  });
}));

/* =========================================================
   RECURRING RIDES ROUTES
========================================================= */
app.post("/api/recurring-rides/create", asyncHandler(async (req, res) => {
  const rider = await resolveRider(req.body);
  if (!rider) return fail(res, "Rider not found", 404);

  const pickupAddress = clean(req.body.pickup_address || req.body.pickupAddress);
  const dropoffAddress = clean(req.body.dropoff_address || req.body.dropoffAddress);
  const preferredDriverId = pickFirst(req.body.preferred_driver_id, req.body.preferredDriverId);
  const scheduledTime = clean(req.body.scheduled_time || req.body.scheduledTime);
  const scheduledDays = Array.isArray(req.body.scheduled_days) ? req.body.scheduled_days : [];
  const requestedMode = normalizeRideMode(req.body.requested_mode || req.body.requestedMode || "driver");
  const rideType = normalizeRideType(req.body.ride_type || req.body.rideType || "standard");
  const notes = clean(req.body.notes);

  if (!pickupAddress) return fail(res, "Pickup address is required");
  if (!dropoffAddress) return fail(res, "Dropoff address is required");
  if (!scheduledTime) return fail(res, "Scheduled time is required");
  if (!scheduledDays.length) return fail(res, "At least one scheduled day is required");

  if (preferredDriverId) {
    const priorCompletedRide = await getCompletedRideBetweenRiderAndDriver(rider.id, preferredDriverId);
    const isFavorited = await riderHasFavoriteDriver(rider.id, preferredDriverId);

    if (!priorCompletedRide && !isFavorited) {
      return fail(res, "Preferred recurring driver requires prior trip history or favorite status", 403);
    }
  }

  const recurringRide = await insertRow("recurring_rides", {
    id: createId("recur"),
    rider_id: rider.id,
    preferred_driver_id: preferredDriverId || null,
    status: "active",
    requested_mode: requestedMode,
    ride_type: rideType,
    pickup_address: pickupAddress,
    dropoff_address: dropoffAddress,
    scheduled_days: scheduledDays,
    scheduled_time: scheduledTime,
    notes: notes || null,
    created_at: nowIso(),
    updated_at: nowIso()
  });

  return ok(res, {
    message: "Recurring ride created successfully",
    recurring_ride: recurringRide
  }, 201);
}));

app.get("/api/rider/:riderId/recurring-rides", asyncHandler(async (req, res) => {
  const rider = await getRiderById(req.params.riderId);
  if (!rider) return fail(res, "Rider not found", 404);

  const { data, error } = await requireSupabase()
    .from("recurring_rides")
    .select("*")
    .eq("rider_id", rider.id)
    .order("updated_at", { ascending: false });

  if (error) throw error;

  return ok(res, {
    recurring_rides: data || []
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
  if (["foundation", "nonprofit", "donation"].includes(value)) return "foundation";
  return value;
}

function getFallbackReply(message = "", page = "general") {
  const text = lower(message);
  const normalizedPage = normalizePage(page);

  if (!text) {
    return "I can help with rider approval, driver onboarding, ride requests, payment authorization, live trip status, preferred drivers, compliance, dispatch, Harvey Taxi support, and foundation support.";
  }

  if (text.includes("emergency") || text.includes("911")) {
    return "Harvey Taxi is not an emergency service. Call 911 for emergencies.";
  }

  if (text.includes("foundation") || text.includes("donate") || normalizedPage === "foundation") {
    return "Harvey Transportation Assistance Foundation helps remove transportation barriers for medical appointments, work, school, and community mobility. Eligible riders may receive sponsored ride support through the platform.";
  }

  if (text.includes("preferred driver") || text.includes("favorite driver")) {
    return "Harvey Taxi can support favorite drivers and preferred-driver ride requests when the rider has prior trip history or a favorite-driver connection.";
  }

  if (text.includes("insurance") || text.includes("compliance")) {
    return "Harvey Taxi drivers may need identity verification, contact verification, insurance approval, and compliance clearance before going online.";
  }

  if (text.includes("live") || text.includes("track") || text.includes("where is my driver")) {
    return "If a ride is active, Harvey Taxi can provide live ride state updates and driver movement updates through the platform.";
  }

  if (text.includes("rider") || normalizedPage === "rider") {
    return "Riders must be approved before they can request rides. Payment authorization may also be required before dispatch.";
  }

  if (text.includes("driver") || normalizedPage === "driver") {
    return "Drivers must complete signup, verification, insurance compliance, and approval before going online and receiving missions.";
  }

  if (text.includes("payment")) {
    return "Harvey Taxi can authorize payment before dispatch and capture payment when the ride is completed. Sponsored rides may split the total between foundation support and rider copay.";
  }

  if (text.includes("dispatch") || text.includes("operations")) {
    return "Harvey Taxi dispatch prioritizes eligible drivers, can honor preferred-driver requests, and can automatically redispatch expired offers.";
  }

  return "I can help with rides, favorite drivers, driver onboarding, insurance compliance, payments, live trip updates, dispatch, support questions, and foundation support.";
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
    if (typeof openai.responses?.create === "function") {
      const response = await openai.responses.create({
        model: OPENAI_SUPPORT_MODEL,
        input: [
          {
            role: "system",
            content:
              "You are Harvey Taxi AI Support. Be concise, clear, calm, and accurate. Never invent policies. You may answer questions about Harvey Taxi rides, favorite drivers, preferred-driver requests, driver onboarding, insurance compliance, rider approval, payment authorization, dispatch, live ride updates, autonomous pilot guidance, and Harvey Transportation Assistance Foundation support."
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
    }

    const chat = await openai.chat.completions.create({
      model: OPENAI_SUPPORT_MODEL,
      temperature: 0.3,
      messages: [
        {
          role: "system",
          content:
            "You are Harvey Taxi AI Support. Be concise, clear, calm, and accurate. Never invent policies. You may answer questions about Harvey Taxi rides, favorite drivers, preferred-driver requests, driver onboarding, insurance compliance, rider approval, payment authorization, dispatch, live ride updates, autonomous pilot guidance, and Harvey Transportation Assistance Foundation support."
        },
        {
          role: "user",
          content: `Page: ${normalizePage(page)}\nRide Context: ${JSON.stringify(rideContext || {})}\nUser Message: ${message}`
        }
      ]
    });

    return {
      reply: clean(chat?.choices?.[0]?.message?.content || "") || fallback,
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
        if (filter.op === "lt") query = query.lt(filter.column, filter.value);
        if (filter.op === "gt") query = query.gt(filter.column, filter.value);
      }
    }

    const { count, error } = await query;
    if (error) throw error;
    return Number(count || 0);
  }

  const staleBefore = new Date(Date.now() - DRIVER_HEARTBEAT_STALE_MS).toISOString();

  const [
    totalRides,
    activeRides,
    awaitingDispatch,
    noDriverAvailable,
    onlineDrivers,
    staleDrivers,
    totalDrivers,
    totalRiders,
    compliantDrivers,
    blockedDrivers,
    sponsoredRides,
    preferredDriverRides
  ] = await Promise.all([
    countTable("rides"),
    countTable("rides", [{
      op: "in",
      column: "status",
      value: ["awaiting_driver_acceptance", "dispatched", "driver_en_route", "arrived", "in_progress"]
    }]),
    countTable("rides", [{ op: "eq", column: "status", value: "awaiting_dispatch" }]),
    countTable("rides", [{ op: "eq", column: "status", value: "no_driver_available" }]),
    countTable("drivers", [{
      op: "in",
      column: "availability_status",
      value: ["online", "available", "ready", "active"]
    }]),
    countTable("drivers", [
      { op: "eq", column: "is_online", value: true },
      { op: "lt", column: "last_heartbeat_at", value: staleBefore }
    ]),
    countTable("drivers"),
    countTable("riders"),
    countTable("drivers", [{ op: "eq", column: "compliance_status", value: "approved" }]),
    countTable("drivers", [{ op: "eq", column: "compliance_status", value: "blocked" }]),
    countTable("rides", [{ op: "gt", column: "sponsored_amount", value: 0 }]),
    countTable("rides", [{ op: "gt", column: "preferred_driver_id", value: "" }]).catch(() => 0)
  ]);

  return {
    generated_at: nowIso(),
    total_rides: totalRides,
    active_rides: activeRides,
    awaiting_dispatch: awaitingDispatch,
    no_driver_available: noDriverAvailable,
    online_drivers: onlineDrivers,
    stale_online_drivers: staleDrivers,
    total_drivers: totalDrivers,
    total_riders: totalRiders,
    compliant_drivers: compliantDrivers,
    blocked_drivers: blockedDrivers,
    sponsored_rides: sponsoredRides,
    preferred_driver_rides: preferredDriverRides,
    realtime_enabled: ENABLE_REALTIME_EVENTS,
    preferred_driver_enabled: ENABLE_PREFERRED_DRIVER_SYSTEM,
    nonprofit_benefits_enabled: ENABLE_NONPROFIT_BENEFITS,
    insurance_gate_enabled: ENABLE_DRIVER_INSURANCE_GATE
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

app.get("/api/admin/ai/operations", requireAdmin, asyncHandler(async (_req, res) => {
  const snapshot = await buildOperationsSnapshot();
  runtimeState.aiOperations.lastRecommendationAt = nowIso();

  let recommendation = null;

  if (openai && ENABLE_AI_OPERATIONS) {
    try {
      if (typeof openai.responses?.create === "function") {
        const response = await openai.responses.create({
          model: OPENAI_OPERATIONS_MODEL,
          input: [
            {
              role: "system",
              content:
                "You are Harvey Taxi AI Operations. Review the metrics and return a short operational recommendation focused on dispatch pressure, stale drivers, compliance readiness, favorite-driver demand, sponsored rides, rider wait risk, and fleet responsiveness."
            },
            {
              role: "user",
              content: JSON.stringify(snapshot)
            }
          ]
        });

        recommendation = clean(response?.output_text || "");
      } else {
        const chat = await openai.chat.completions.create({
          model: OPENAI_OPERATIONS_MODEL,
          temperature: 0.2,
          messages: [
            {
              role: "system",
              content:
                "You are Harvey Taxi AI Operations. Review the metrics and return a short operational recommendation focused on dispatch pressure, stale drivers, compliance readiness, favorite-driver demand, sponsored rides, rider wait risk, and fleet responsiveness."
            },
            {
              role: "user",
              content: JSON.stringify(snapshot)
            }
          ]
        });

        recommendation = clean(chat?.choices?.[0]?.message?.content || "");
      }

      runtimeState.aiOperations.lastRecommendationError = null;
    } catch (error) {
      runtimeState.aiOperations.lastRecommendationError = clean(error?.message || String(error));
      recommendation = null;
    }
  }

  return ok(res, {
    snapshot,
    recommendation,
    ai_operations: runtimeState.aiOperations
  });
}));

/* =========================================================
   ADMIN SECURITY / COMPLIANCE / BENEFIT ROUTES
========================================================= */
app.get("/api/admin/security/overview", requireAdmin, asyncHandler(async (_req, res) => {
  const [events, actions, profiles] = await Promise.all([
    requireSupabase()
      .from("security_events")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50),

    requireSupabase()
      .from("security_actions")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50),

    requireSupabase()
      .from("security_profiles")
      .select("*")
      .order("updated_at", { ascending: false })
      .limit(50)
  ]);

  return ok(res, {
    security_events: events.data || [],
    security_actions: actions.data || [],
    security_profiles: profiles.data || [],
    ai_security: runtimeState.aiSecurity
  });
}));

app.get("/api/admin/compliance/drivers", requireAdmin, asyncHandler(async (_req, res) => {
  const { data, error } = await requireSupabase()
    .from("drivers")
    .select("*")
    .order("updated_at", { ascending: false })
    .limit(200);

  if (error) throw error;

  return ok(res, {
    drivers: (data || []).map((driver) => ({
      id: driver.id,
      full_name: getDriverDisplayName(driver),
      email: clean(driver.email || ""),
      phone: clean(driver.phone || ""),
      driver_type: normalizeDriverType(driver.driver_type || "human"),
      status: normalizeDriverStatus(driver.status || driver.approval_status),
      is_online: driverIsOnline(driver),
      is_verified: driverIsVerified(driver),
      is_approved: driverIsApproved(driver),
      compliance: buildDriverComplianceSummary(driver)
    }))
  });
}));

app.post("/api/admin/driver/insurance/approve", requireAdmin, asyncHandler(async (req, res) => {
  const driverId = pickFirst(req.body.driver_id, req.body.driverId);
  if (!driverId) return fail(res, "Driver ID is required");

  const driver = await getDriverById(driverId);
  if (!driver) return fail(res, "Driver not found", 404);

  const rows = await updateRows("drivers", { id: driver.id }, {
    insurance_status: "active",
    insurance_verified: true,
    compliance_status: "approved",
    compliance_block_reason: null,
    updated_at: nowIso()
  });

  const updatedDriver = rows?.[0] || driver;

  await logComplianceEvent({
    subject_type: "driver",
    subject_id: updatedDriver.id,
    event_type: "driver_insurance_approved",
    severity: "info",
    details: {
      actor_email: ADMIN_EMAIL
    }
  });

  emitComplianceRealtime({
    type: "driver_insurance_approved",
    driver_id: updatedDriver.id
  });

  return ok(res, {
    message: "Driver insurance approved successfully",
    driver: updatedDriver,
    compliance: buildDriverComplianceSummary(updatedDriver)
  });
}));

app.post("/api/admin/driver/insurance/reject", requireAdmin, asyncHandler(async (req, res) => {
  const driverId = pickFirst(req.body.driver_id, req.body.driverId);
  const reason = clean(req.body.reason || "insurance_rejected");

  if (!driverId) return fail(res, "Driver ID is required");

  const driver = await getDriverById(driverId);
  if (!driver) return fail(res, "Driver not found", 404);

  const rows = await updateRows("drivers", { id: driver.id }, {
    insurance_status: "rejected",
    insurance_verified: false,
    compliance_status: "blocked",
    compliance_block_reason: reason,
    is_online: false,
    availability_status: "offline",
    updated_at: nowIso()
  });

  const updatedDriver = rows?.[0] || driver;

  await logComplianceEvent({
    subject_type: "driver",
    subject_id: updatedDriver.id,
    event_type: "driver_insurance_rejected",
    severity: "high",
    details: {
      actor_email: ADMIN_EMAIL,
      reason
    }
  });

  emitComplianceRealtime({
    type: "driver_insurance_rejected",
    driver_id: updatedDriver.id,
    reason
  });

  return ok(res, {
    message: "Driver insurance rejected",
    driver: updatedDriver,
    compliance: buildDriverComplianceSummary(updatedDriver)
  });
}));

app.get("/api/admin/benefits/overview", requireAdmin, asyncHandler(async (_req, res) => {
  const [programs, approvals, sponsoredRides, transactions] = await Promise.all([
    requireSupabase()
      .from("benefit_programs")
      .select("*")
      .order("updated_at", { ascending: false })
      .limit(50),

    requireSupabase()
      .from("benefit_approvals")
      .select("*")
      .order("updated_at", { ascending: false })
      .limit(50),

    requireSupabase()
      .from("sponsored_rides")
      .select("*")
      .order("updated_at", { ascending: false })
      .limit(50),

    requireSupabase()
      .from("benefit_transactions")
      .select("*")
      .order("updated_at", { ascending: false })
      .limit(50)
  ]);

  return ok(res, {
    benefit_programs: programs.data || [],
    benefit_approvals: approvals.data || [],
    sponsored_rides: sponsoredRides.data || [],
    benefit_transactions: transactions.data || [],
    nonprofit_runtime: runtimeState.nonprofitBenefits
  });
}));

app.post("/api/admin/security/rider/unlock", requireAdmin, asyncHandler(async (req, res) => {
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

  await createSecurityAction({
    subjectType: "rider",
    subjectId: rider.id,
    actionType: "manual_unlock",
    reason: "Admin unlocked rider account",
    metadata: { actor_email: ADMIN_EMAIL }
  });

  return ok(res, {
    message: "Rider unlocked successfully",
    rider: rows?.[0] || rider
  });
}));

app.post("/api/admin/security/driver/unlock", requireAdmin, asyncHandler(async (req, res) => {
  const driverId = pickFirst(req.body.driver_id, req.body.driverId);
  if (!driverId) return fail(res, "Driver ID is required");

  const driver = await getDriverById(driverId);
  if (!driver) return fail(res, "Driver not found", 404);

  const rows = await updateRows("drivers", { id: driver.id }, {
    status: "approved",
    approval_status: "approved",
    verification_status: "approved",
    compliance_status: "approved",
    compliance_block_reason: null,
    updated_at: nowIso()
  });

  await createSecurityAction({
    subjectType: "driver",
    subjectId: driver.id,
    actionType: "manual_unlock",
    reason: "Admin unlocked driver account",
    metadata: { actor_email: ADMIN_EMAIL }
  });

  return ok(res, {
    message: "Driver unlocked successfully",
    driver: rows?.[0] || driver
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

  const updatedRider = rows?.[0] || rider;

  emitAdminRealtime({
    type: "rider_approved",
    rider_id: updatedRider.id
  });

  return ok(res, {
    message: "Rider approved successfully",
    rider: buildRiderStatusResponse(updatedRider)
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
    compliance_status: driver.compliance_status || "pending",
    updated_at: nowIso()
  });

  const updatedDriver = rows?.[0] || driver;

  emitAdminRealtime({
    type: "driver_approved",
    driver_id: updatedDriver.id
  });

  return ok(res, {
    message: "Driver approved successfully",
    driver: updatedDriver,
    compliance: buildDriverComplianceSummary(updatedDriver)
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

  const updatedDriver = rows?.[0] || driver;

  emitAdminRealtime({
    type: "driver_contact_verified",
    driver_id: updatedDriver.id
  });

  return ok(res, {
    message: "Driver email and SMS marked verified",
    driver: updatedDriver,
    compliance: buildDriverComplianceSummary(updatedDriver)
  });
}));

app.post("/api/admin/rider/benefits/approve", requireAdmin, asyncHandler(async (req, res) => {
  const riderId = pickFirst(req.body.rider_id, req.body.riderId);
  const sponsorshipPercent = clamp(
    toNumber(req.body.sponsorship_percent, NONPROFIT_DEFAULT_SPONSORSHIP_PERCENT),
    0,
    NONPROFIT_MAX_SPONSORSHIP_PERCENT
  );

  if (!riderId) return fail(res, "Rider ID is required");

  const rider = await getRiderById(riderId);
  if (!rider) return fail(res, "Rider not found", 404);

  const rows = await updateRows("riders", { id: rider.id }, {
    nonprofit_benefits_approved: true,
    updated_at: nowIso()
  });

  let approval = null;
  try {
    approval = await insertRow("benefit_approvals", {
      id: createId("bapprove"),
      rider_id: rider.id,
      status: "approved",
      sponsorship_percent: sponsorshipPercent,
      approved_by: ADMIN_EMAIL,
      created_at: nowIso(),
      updated_at: nowIso()
    });
  } catch (error) {
    console.warn("⚠️ Benefit approval insert skipped:", error.message);
  }

  emitBenefitsRealtime({
    type: "rider_benefits_approved",
    rider_id: rider.id,
    sponsorship_percent: sponsorshipPercent
  });

  return ok(res, {
    message: "Rider benefits approved",
    rider: rows?.[0] || rider,
    approval
  });
}));

app.get("/api/admin/analytics/overview", requireAdmin, asyncHandler(async (_req, res) => {
  const snapshot = await buildOperationsSnapshot();
  return ok(res, {
    generated_at: nowIso(),
    counts: snapshot,
    dispatch: runtimeState.dispatchSweep,
    compliance: runtimeState.complianceSweep,
    insurance: runtimeState.insurance,
    ai_operations: runtimeState.aiOperations,
    ai_security: runtimeState.aiSecurity,
    nonprofit_benefits: runtimeState.nonprofitBenefits,
    realtime: {
      enabled: runtimeState.realtime.enabled,
      rider_stream_keys: runtimeState.realtime.riderStreams.size,
      driver_stream_keys: runtimeState.realtime.driverStreams.size,
      admin_stream_keys: runtimeState.realtime.adminStreams.size
    }
  });
}));

/* =========================================================
   SUPPORT FAQ
========================================================= */
app.get("/api/support/faq", asyncHandler(async (_req, res) => {
  return ok(res, {
    faqs: [
      {
        question: "Can riders request a ride immediately after signup?",
        answer: "No. Riders must be approved first. Payment authorization may also be required before dispatch."
      },
      {
        question: "What does a driver need before going online?",
        answer: "Drivers need signup completion, verification, insurance compliance, approval, and then they can go online to receive missions."
      },
      {
        question: "Can riders choose a favorite driver?",
        answer: "Yes. Riders can favorite a driver after a completed trip and may request that preferred driver again later."
      },
      {
        question: "Can riders see live trip progress?",
        answer: "Yes. Harvey Taxi can provide live ride state updates and driver movement updates when a trip is active."
      },
      {
        question: "When is payment captured?",
        answer: "Payment is typically authorized before dispatch and captured when the ride is completed."
      },
      {
        question: "Can rides be sponsored by the foundation?",
        answer: "Yes. Eligible rides may include foundation sponsorship support, which can reduce the rider copay."
      },
      {
        question: "Can riders tip drivers?",
        answer: "Yes. Tipping is supported during or after the trip."
      },
      {
        question: "What does the foundation support?",
        answer: "Harvey Transportation Assistance Foundation supports transportation access for medical appointments, school, work, and community mobility."
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

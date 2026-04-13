/* =========================================================
   HARVEY TAXI — CODE BLUE CLEAN REBUILD
   PART 1: FOUNDATION + ENV + SECURITY + HELPERS + HEALTH
   FILE: server.clean.js
========================================================= */

const express = require("express");
const cors = require("cors");
const path = require("path");
const crypto = require("crypto");
const bcrypt = require("bcrypt");
const { createClient } = require("@supabase/supabase-js");

/* =========================================================
   OPTIONAL OPENAI SDK
========================================================= */
let OpenAI = null;
try {
  OpenAI = require("openai");
} catch (error) {
  console.warn("⚠️ OpenAI SDK not installed. AI endpoints will remain disabled.");
}

/* =========================================================
   APP INIT
========================================================= */
const app = express();
const PORT = Number(process.env.PORT || 10000);
const APP_NAME = "Harvey Taxi Code Blue Clean Rebuild";
const APP_VERSION = "Phase 1 Foundation";
const SERVER_STARTED_AT = new Date().toISOString();

/* =========================================================
   CORE MIDDLEWARE
   IMPORTANT:
   - Middleware goes BEFORE routes
   - app.listen() goes at the very end of the final file
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
   REQUEST LOGGING / META
========================================================= */
app.use((req, res, next) => {
  req.requestStartedAt = Date.now();
  next();
});

function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (Array.isArray(forwarded) && forwarded.length > 0) {
    return String(forwarded[0] || "").trim();
  }
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }
  return String(req.ip || req.socket?.remoteAddress || "").trim();
}

function buildRequestMeta(req) {
  return {
    ip: getClientIp(req),
    method: req.method,
    path: req.originalUrl,
    user_agent: String(req.headers["user-agent"] || "").trim(),
    request_started_at: req.requestStartedAt
      ? new Date(req.requestStartedAt).toISOString()
      : null
  };
}

app.use((req, res, next) => {
  res.on("finish", () => {
    const durationMs = Date.now() - (req.requestStartedAt || Date.now());
    console.log(
      `${new Date().toISOString()} ${req.method} ${req.originalUrl} ${res.statusCode} ${durationMs}ms`
    );
  });
  next();
});

/* =========================================================
   CONTENT-TYPE GUARD
========================================================= */
function requireSupportedContentType(req, res, next) {
  if (["GET", "DELETE", "HEAD", "OPTIONS"].includes(req.method)) {
    return next();
  }

  const contentType = String(req.headers["content-type"] || "").toLowerCase();

  if (
    !contentType ||
    contentType.includes("application/json") ||
    contentType.includes("application/x-www-form-urlencoded")
  ) {
    return next();
  }

  return fail(
    res,
    "Unsupported content type. Use application/json or application/x-www-form-urlencoded.",
    415
  );
}

app.use(requireSupportedContentType);

/* =========================================================
   ENV HELPERS
========================================================= */
function cleanEnv(value = "") {
  return String(value || "")
    .trim()
    .replace(/^['"]|['"]$/g, "");
}

function clean(value = "") {
  return String(value || "").trim();
}

function lower(value = "") {
  return clean(value).toLowerCase();
}

function upper(value = "") {
  return clean(value).toUpperCase();
}

function digitsOnly(value = "") {
  return String(value || "").replace(/\D+/g, "");
}

function normalizeEmail(value = "") {
  return lower(value);
}

function normalizePhone(value = "") {
  const digits = digitsOnly(value);
  if (!digits) return "";
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.startsWith("+")) return digits;
  return `+${digits}`;
}

function toBool(value, fallback = false) {
  const normalized = lower(cleanEnv(value));
  if (!normalized) return fallback;
  return ["1", "true", "yes", "y", "on"].includes(normalized);
}

function toNumber(value, fallback = 0) {
  const normalized = cleanEnv(value);
  if (!normalized) return fallback;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : fallback;
}

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

function parseInteger(value, fallback = 0) {
  const n = parseInt(String(value || "").trim(), 10);
  return Number.isFinite(n) ? n : fallback;
}

function parseFloatSafe(value, fallback = 0) {
  const n = parseFloat(String(value || "").trim());
  return Number.isFinite(n) ? n : fallback;
}

function safeJsonParse(value, fallback = null) {
  try {
    return JSON.parse(value);
  } catch (error) {
    return fallback;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function createId(prefix = "id") {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}

function pickFirst(...values) {
  for (const value of values) {
    if (clean(value)) return clean(value);
  }
  return "";
}

function asCurrency(value) {
  const n = Number(value || 0);
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function addSecondsToIso(seconds = 0) {
  return new Date(Date.now() + Math.max(0, Number(seconds || 0)) * 1000).toISOString();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* =========================================================
   SECURITY / MASKING HELPERS
========================================================= */
function maskEmail(email = "") {
  const normalized = normalizeEmail(email);
  if (!normalized || !normalized.includes("@")) return "";
  const [name, domain] = normalized.split("@");
  if (!name || !domain) return normalized;
  if (name.length <= 2) return `${name[0] || "*"}***@${domain}`;
  return `${name.slice(0, 2)}***@${domain}`;
}

function maskPhone(phone = "") {
  const digits = digitsOnly(phone);
  if (digits.length < 4) return phone;
  return `***-***-${digits.slice(-4)}`;
}

function maskSecretValue(value = "") {
  const cleaned = cleanEnv(value);
  if (!cleaned) return "";
  if (cleaned.length <= 8) return "***";
  return `${cleaned.slice(0, 4)}***${cleaned.slice(-4)}`;
}

function safeEqual(a = "", b = "") {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

/* =========================================================
   PASSWORD HELPERS
   IMPORTANT:
   - Never store plain-text passwords
   - Use bcrypt hashes only
========================================================= */
const BCRYPT_ROUNDS = clampNumber(
  toNumber(process.env.BCRYPT_ROUNDS, 10),
  8,
  15,
  10
);

async function hashPassword(plainTextPassword = "") {
  const password = clean(plainTextPassword);
  if (!password) {
    throw new Error("Password is required.");
  }
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

async function verifyPassword(plainTextPassword = "", passwordHash = "") {
  const password = clean(plainTextPassword);
  const hash = clean(passwordHash);

  if (!password || !hash) return false;
  return bcrypt.compare(password, hash);
}

/* =========================================================
   FEATURE FLAGS
========================================================= */
const ENABLE_AI = toBool(process.env.ENABLE_AI_BRAIN, true);
const ENABLE_REAL_EMAIL = toBool(process.env.ENABLE_REAL_EMAIL, false);
const ENABLE_REAL_SMS = toBool(process.env.ENABLE_REAL_SMS, false);
const ENABLE_PERSONA_ENFORCEMENT = toBool(process.env.ENABLE_PERSONA_ENFORCEMENT, true);
const ENABLE_RIDER_VERIFICATION_GATE = toBool(process.env.ENABLE_RIDER_VERIFICATION_GATE, true);
const ENABLE_PAYMENT_GATE = toBool(process.env.ENABLE_PAYMENT_GATE, true);
const ENABLE_AUTO_REDISPATCH = toBool(process.env.ENABLE_AUTO_REDISPATCH, true);
const ENABLE_STARTUP_TABLE_CHECKS = toBool(process.env.ENABLE_STARTUP_TABLE_CHECKS, true);

/* =========================================================
   CONFIG
========================================================= */
const PUBLIC_APP_URL =
  cleanEnv(process.env.PUBLIC_APP_URL) ||
  cleanEnv(process.env.RENDER_EXTERNAL_URL) ||
  cleanEnv(process.env.APP_BASE_URL) ||
  `http://localhost:${PORT}`;

const ADMIN_EMAIL = normalizeEmail(
  process.env.ADMIN_EMAIL || "williebee@harveytaxiservice.com"
);

const ADMIN_PASSWORD = cleanEnv(process.env.ADMIN_PASSWORD || "");

const SUPPORT_FROM_EMAIL =
  cleanEnv(process.env.SUPPORT_FROM_EMAIL) ||
  cleanEnv(process.env.SMTP_FROM) ||
  cleanEnv(process.env.SENDGRID_FROM_EMAIL) ||
  "support@harveytaxiservice.com";

const SUPPORT_REPLY_TO =
  cleanEnv(process.env.SUPPORT_REPLY_TO) ||
  "support@harveytaxiservice.com";

const DISPATCH_TIMEOUT_SECONDS = clampNumber(
  toNumber(process.env.DISPATCH_TIMEOUT_SECONDS, 25),
  5,
  120,
  25
);

const MAX_DISPATCH_ATTEMPTS = clampNumber(
  toNumber(process.env.MAX_DISPATCH_ATTEMPTS, 5),
  1,
  20,
  5
);

const DISPATCH_SWEEP_INTERVAL_MS = clampNumber(
  toNumber(process.env.DISPATCH_SWEEP_INTERVAL_MS, 15000),
  5000,
  120000,
  15000
);

const DEFAULT_BOOKING_FEE = asCurrency(toNumber(process.env.DEFAULT_BOOKING_FEE, 2.5));
const DEFAULT_BASE_FARE = asCurrency(toNumber(process.env.DEFAULT_BASE_FARE, 7.5));
const DEFAULT_PER_MILE = asCurrency(toNumber(process.env.DEFAULT_PER_MILE, 2.25));
const DEFAULT_PER_MINUTE = asCurrency(toNumber(process.env.DEFAULT_PER_MINUTE, 0.35));
const DEFAULT_MINIMUM_FARE = asCurrency(toNumber(process.env.DEFAULT_MINIMUM_FARE, 10));
const DEFAULT_DRIVER_PAYOUT_PERCENT = clampNumber(
  toNumber(process.env.DEFAULT_DRIVER_PAYOUT_PERCENT, 75),
  1,
  100,
  75
);

/* =========================================================
   SUPABASE
========================================================= */
const SUPABASE_URL = cleanEnv(process.env.SUPABASE_URL);
const SUPABASE_SERVICE_ROLE_KEY = cleanEnv(process.env.SUPABASE_SERVICE_ROLE_KEY);

const supabaseReady = Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);

const supabase = supabaseReady
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      }
    })
  : null;

/* =========================================================
   OPENAI
========================================================= */
const OPENAI_API_KEY = cleanEnv(process.env.OPENAI_API_KEY);
const OPENAI_MODEL = cleanEnv(
  process.env.OPENAI_MODEL ||
    process.env.OPENAI_SUPPORT_MODEL ||
    "gpt-4.1-mini"
);

const openai =
  ENABLE_AI && OpenAI && OPENAI_API_KEY
    ? new OpenAI({ apiKey: OPENAI_API_KEY })
    : null;

/* =========================================================
   TABLE MAP
========================================================= */
const TABLES = {
  riders: "riders",
  drivers: "drivers",
  rides: "rides",
  payments: "payments",
  dispatches: "dispatches",
  missions: "missions",
  admin_logs: "admin_logs",
  trip_events: "trip_events",
  driver_earnings: "driver_earnings",
  driver_payouts: "driver_payouts"
};

/* =========================================================
   API RESPONSE HELPERS
========================================================= */
function ok(res, data = {}, message = "OK", status = 200) {
  return res.status(status).json({
    ok: true,
    message,
    ...data
  });
}

function fail(res, message = "Request failed", status = 400, extra = {}) {
  return res.status(status).json({
    ok: false,
    message,
    ...extra
  });
}

function serverError(res, error, fallbackMessage = "Internal server error") {
  console.error("SERVER ERROR:", error);
  return res.status(500).json({
    ok: false,
    message: fallbackMessage,
    error: clean(error?.message || "Unknown server error")
  });
}

function asyncHandler(fn) {
  return async function wrappedHandler(req, res, next) {
    try {
      return await fn(req, res, next);
    } catch (error) {
      return serverError(res, error, "Unhandled route error.");
    }
  };
}

/* =========================================================
   ADMIN HELPERS
========================================================= */
function getAdminCredentials(req) {
  return {
    email: normalizeEmail(
      req.headers["x-admin-email"] ||
        req.body?.adminEmail ||
        req.query?.adminEmail ||
        ""
    ),
    password: cleanEnv(
      req.headers["x-admin-password"] ||
        req.body?.adminPassword ||
        req.query?.adminPassword ||
        ""
    )
  };
}

function requireAdmin(req, res, next) {
  const creds = getAdminCredentials(req);

  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
    return fail(
      res,
      "Admin credentials are not configured on the server.",
      500
    );
  }

  if (creds.email !== ADMIN_EMAIL || creds.password !== ADMIN_PASSWORD) {
    return fail(res, "Unauthorized admin access.", 401);
  }

  return next();
}

/* =========================================================
   NORMALIZATION HELPERS
========================================================= */
function normalizeRiderStatus(value = "") {
  const status = lower(value);

  if (["approved", "active", "verified"].includes(status)) return "approved";
  if (["pending", "review", "under_review", "submitted"].includes(status)) return "pending";
  if (["rejected", "denied", "blocked", "suspended"].includes(status)) return "rejected";

  return status || "pending";
}

function normalizeVerificationStatus(value = "") {
  const status = lower(value);

  if (["approved", "completed", "verified"].includes(status)) return "approved";
  if (["pending", "initiated", "submitted", "in_review", "review"].includes(status)) return "pending";
  if (["failed", "declined", "rejected", "denied"].includes(status)) return "failed";

  return status || "pending";
}

function normalizePaymentStatus(value = "") {
  const status = lower(value);

  if (["authorized", "preauthorized", "pre_authorized", "held"].includes(status)) return "authorized";
  if (["captured", "paid", "complete", "completed"].includes(status)) return "captured";
  if (["failed", "declined", "canceled", "cancelled"].includes(status)) return "failed";
  if (["refunded"].includes(status)) return "refunded";
  if (["voided"].includes(status)) return "voided";

  return status || "pending";
}

function normalizeRideStatus(value = "") {
  const status = lower(value);

  if (["pending", "requested", "searching"].includes(status)) return "searching";
  if (["offered", "awaiting_driver_acceptance"].includes(status)) return "awaiting_driver_acceptance";
  if (["accepted", "dispatched", "driver_assigned"].includes(status)) return "dispatched";
  if (["driver_en_route", "en_route"].includes(status)) return "driver_en_route";
  if (["arrived"].includes(status)) return "arrived";
  if (["in_progress", "on_trip"].includes(status)) return "in_progress";
  if (["completed", "finished"].includes(status)) return "completed";
  if (["cancelled", "canceled"].includes(status)) return "cancelled";
  if (["no_driver_available", "unassigned"].includes(status)) return "no_driver_available";

  return status || "searching";
}

function normalizeDispatchStatus(value = "") {
  const status = lower(value);

  if (["offered", "pending"].includes(status)) return "offered";
  if (["accepted"].includes(status)) return "accepted";
  if (["declined"].includes(status)) return "declined";
  if (["expired", "timeout", "timed_out"].includes(status)) return "expired";
  if (["cancelled", "canceled"].includes(status)) return "cancelled";
  if (["failed"].includes(status)) return "failed";

  return status || "offered";
}

function normalizeMissionStatus(value = "") {
  const status = lower(value);

  if (["offered", "pending"].includes(status)) return "offered";
  if (["accepted", "assigned"].includes(status)) return "accepted";
  if (["declined"].includes(status)) return "declined";
  if (["expired", "timed_out"].includes(status)) return "expired";
  if (["completed", "finished"].includes(status)) return "completed";
  if (["cancelled", "canceled"].includes(status)) return "cancelled";

  return status || "offered";
}

function normalizeDriverStatus(value = "") {
  const status = lower(value);

  if (["approved", "active", "available"].includes(status)) return "available";
  if (["busy", "on_trip"].includes(status)) return "busy";
  if (["offline"].includes(status)) return "offline";
  if (["pending", "under_review", "review"].includes(status)) return "pending";
  if (["rejected", "denied", "suspended"].includes(status)) return "rejected";

  return status || "pending";
}

function normalizeDriverApprovalStatus(value = "") {
  const status = lower(value);

  if (["approved", "active"].includes(status)) return "approved";
  if (["pending", "submitted", "under_review", "review"].includes(status)) return "pending";
  if (["rejected", "denied", "suspended"].includes(status)) return "rejected";

  return status || "pending";
}

function normalizeDriverVerificationStatus(value = "") {
  const status = lower(value);

  if (["approved", "verified", "completed"].includes(status)) return "approved";
  if (["pending", "submitted", "initiated", "review"].includes(status)) return "pending";
  if (["failed", "rejected", "declined", "denied"].includes(status)) return "failed";

  return status || "pending";
}

function normalizeDriverType(value = "") {
  const type = lower(value);
  if (["autonomous", "av"].includes(type)) return "autonomous";
  return "human";
}

function normalizePayoutStatus(value = "") {
  const status = lower(value);

  if (["pending"].includes(status)) return "pending";
  if (["processing"].includes(status)) return "processing";
  if (["paid", "completed"].includes(status)) return "paid";
  if (["failed"].includes(status)) return "failed";
  if (["cancelled", "canceled"].includes(status)) return "cancelled";

  return status || "pending";
}

/* =========================================================
   BUSINESS HELPERS
========================================================= */
function riderVerificationSatisfied(rider) {
  if (!rider) return false;

  const approvalStatus = normalizeRiderStatus(rider.approval_status || rider.status || "");
  const verificationStatus = normalizeVerificationStatus(
    rider.verification_status ||
      rider.identity_status ||
      rider.persona_status ||
      ""
  );

  if (["approved"].includes(approvalStatus)) return true;
  if (["approved"].includes(verificationStatus)) return true;

  return false;
}

function isApprovedRider(rider) {
  if (!rider) return false;
  return normalizeRiderStatus(rider.approval_status || rider.status || "") === "approved";
}

function isDriverApproved(driver) {
  if (!driver) return false;
  return normalizeDriverApprovalStatus(driver.approval_status || driver.status || "") === "approved";
}

function isPaymentAuthorized(payment) {
  if (!payment) return false;
  return ["authorized", "captured"].includes(
    normalizePaymentStatus(payment.status || payment.payment_status || "")
  );
}

function driverCanReceiveMissions(driver) {
  if (!driver) return false;

  const approvalPassed =
    normalizeDriverApprovalStatus(driver.approval_status || driver.status) === "approved";

  const emailPassed =
    normalizeDriverVerificationStatus(driver.email_verification_status) === "approved";

  const smsPassed =
    normalizeDriverVerificationStatus(driver.sms_verification_status) === "approved";

  return approvalPassed && emailPassed && smsPassed;
}

function computeDriverPayoutBreakdown(totalFare = 0, tipAmount = 0) {
  const grossFare = asCurrency(totalFare || 0);
  const safeTip = asCurrency(tipAmount || 0);

  const driverBasePayout = asCurrency((grossFare * DEFAULT_DRIVER_PAYOUT_PERCENT) / 100);
  const driverPayout = asCurrency(driverBasePayout + safeTip);
  const platformFee = asCurrency(grossFare - driverBasePayout);

  return {
    gross_fare: grossFare,
    driver_payout: driverPayout,
    platform_fee: platformFee,
    tip_amount: safeTip,
    payout_percent: DEFAULT_DRIVER_PAYOUT_PERCENT
  };
}

function buildFareEstimate({
  miles = 0,
  minutes = 0,
  surgeMultiplier = 1,
  bookingFee = DEFAULT_BOOKING_FEE,
  baseFare = DEFAULT_BASE_FARE,
  perMile = DEFAULT_PER_MILE,
  perMinute = DEFAULT_PER_MINUTE,
  minimumFare = DEFAULT_MINIMUM_FARE
}) {
  const safeMiles = Number(miles || 0);
  const safeMinutes = Number(minutes || 0);
  const safeSurge = Math.max(Number(surgeMultiplier || 1), 1);

  const distanceCharge = asCurrency(safeMiles * perMile);
  const timeCharge = asCurrency(safeMinutes * perMinute);
  const subtotal = asCurrency(baseFare + distanceCharge + timeCharge);
  const surgedSubtotal = asCurrency(subtotal * safeSurge);
  const totalBeforeMinimum = asCurrency(surgedSubtotal + bookingFee);
  const total = Math.max(totalBeforeMinimum, minimumFare);

  return {
    base_fare: asCurrency(baseFare),
    distance_charge: distanceCharge,
    time_charge: timeCharge,
    surge_multiplier: asCurrency(safeSurge),
    booking_fee: asCurrency(bookingFee),
    minimum_fare: asCurrency(minimumFare),
    estimated_total: asCurrency(total)
  };
}

/* =========================================================
   PUBLIC RECORD BUILDERS
========================================================= */
function buildRiderPublicProfile(rider) {
  if (!rider) return null;

  return {
    id: rider.id,
    first_name: clean(rider.first_name),
    last_name: clean(rider.last_name),
    full_name: `${clean(rider.first_name)} ${clean(rider.last_name)}`.trim(),
    email: normalizeEmail(rider.email),
    email_masked: maskEmail(rider.email),
    phone: normalizePhone(rider.phone),
    phone_masked: maskPhone(rider.phone),
    city: clean(rider.city),
    state: upper(rider.state),
    approval_status: normalizeRiderStatus(rider.approval_status || rider.status),
    verification_status: normalizeVerificationStatus(
      rider.verification_status ||
        rider.identity_status ||
        rider.persona_status
    ),
    document_type: clean(rider.document_type),
    rider_type: clean(rider.rider_type || "standard"),
    created_at: rider.created_at || null,
    updated_at: rider.updated_at || null
  };
}

function buildDriverPublicProfile(driver) {
  if (!driver) return null;

  return {
    id: driver.id,
    first_name: clean(driver.first_name),
    last_name: clean(driver.last_name),
    full_name: `${clean(driver.first_name)} ${clean(driver.last_name)}`.trim(),
    email: normalizeEmail(driver.email),
    email_masked: maskEmail(driver.email),
    phone: normalizePhone(driver.phone),
    phone_masked: maskPhone(driver.phone),
    city: clean(driver.city),
    state: upper(driver.state),
    driver_type: normalizeDriverType(driver.driver_type),
    approval_status: normalizeDriverApprovalStatus(driver.approval_status || driver.status),
    verification_status: normalizeDriverVerificationStatus(
      driver.verification_status ||
        driver.persona_status ||
        driver.identity_status
    ),
    email_verification_status: normalizeDriverVerificationStatus(driver.email_verification_status),
    sms_verification_status: normalizeDriverVerificationStatus(driver.sms_verification_status),
    background_check_status: normalizeDriverVerificationStatus(driver.background_check_status),
    vehicle_make: clean(driver.vehicle_make),
    vehicle_model: clean(driver.vehicle_model),
    vehicle_color: clean(driver.vehicle_color),
    vehicle_plate: clean(driver.vehicle_plate),
    license_number: clean(driver.license_number),
    current_status: normalizeDriverStatus(driver.status),
    created_at: driver.created_at || null,
    updated_at: driver.updated_at || null
  };
}

function buildPaymentPublicRecord(payment) {
  if (!payment) return null;

  return {
    id: payment.id,
    rider_id: clean(payment.rider_id),
    ride_id: clean(payment.ride_id),
    amount: asCurrency(payment.amount || 0),
    currency: upper(payment.currency || "USD"),
    status: normalizePaymentStatus(payment.status || payment.payment_status),
    payment_method: clean(payment.payment_method || payment.method || "card"),
    authorization_code: clean(payment.authorization_code || ""),
    created_at: payment.created_at || null,
    updated_at: payment.updated_at || null
  };
}

function buildRidePublicRecord(ride) {
  if (!ride) return null;

  return {
    id: ride.id,
    rider_id: clean(ride.rider_id),
    driver_id: clean(ride.driver_id),
    pickup_address: clean(ride.pickup_address),
    dropoff_address: clean(ride.dropoff_address),
    requested_mode: lower(ride.requested_mode || "driver"),
    status: normalizeRideStatus(ride.status),
    fare_estimate: asCurrency(
      ride.fare_estimate ||
        ride.estimated_total ||
        ride.estimated_fare ||
        0
    ),
    miles: parseFloatSafe(ride.miles, 0),
    minutes: parseFloatSafe(ride.minutes, 0),
    notes: clean(ride.notes),
    dispatch_attempts: parseInteger(ride.dispatch_attempts, 0),
    assigned_at: ride.assigned_at || null,
    started_at: ride.started_at || null,
    completed_at: ride.completed_at || null,
    cancelled_at: ride.cancelled_at || null,
    created_at: ride.created_at || null,
    updated_at: ride.updated_at || null
  };
}

function buildDispatchPublicRecord(dispatch) {
  if (!dispatch) return null;

  return {
    id: dispatch.id,
    ride_id: clean(dispatch.ride_id),
    rider_id: clean(dispatch.rider_id),
    driver_id: clean(dispatch.driver_id),
    mission_id: clean(dispatch.mission_id),
    attempt_number: parseInteger(dispatch.attempt_number, 1),
    status: normalizeDispatchStatus(dispatch.status),
    expires_at: dispatch.expires_at || null,
    responded_at: dispatch.responded_at || null,
    created_at: dispatch.created_at || null,
    updated_at: dispatch.updated_at || null
  };
}

function buildMissionPublicRecord(mission) {
  if (!mission) return null;

  return {
    id: mission.id,
    ride_id: clean(mission.ride_id),
    rider_id: clean(mission.rider_id),
    driver_id: clean(mission.driver_id),
    requested_mode: lower(mission.requested_mode || "driver"),
    pickup_address: clean(mission.pickup_address),
    dropoff_address: clean(mission.dropoff_address),
    fare_estimate: asCurrency(mission.fare_estimate || 0),
    notes: clean(mission.notes),
    status: normalizeMissionStatus(mission.status),
    expires_at: mission.expires_at || null,
    accepted_at: mission.accepted_at || null,
    declined_at: mission.declined_at || null,
    created_at: mission.created_at || null,
    updated_at: mission.updated_at || null
  };
}

function buildDriverEarningsRecord(row) {
  if (!row) return null;

  return {
    id: row.id,
    driver_id: clean(row.driver_id),
    ride_id: clean(row.ride_id),
    gross_fare: asCurrency(row.gross_fare || 0),
    driver_payout: asCurrency(row.driver_payout || 0),
    platform_fee: asCurrency(row.platform_fee || 0),
    tip_amount: asCurrency(row.tip_amount || 0),
    payout_status: normalizePayoutStatus(row.payout_status),
    created_at: row.created_at || null,
    updated_at: row.updated_at || null
  };
}

function buildTimelineEvent(event) {
  if (!event) return null;

  return {
    id: event.id,
    ride_id: clean(event.ride_id),
    rider_id: clean(event.rider_id),
    driver_id: clean(event.driver_id),
    event_type: clean(event.event_type),
    event_payload: event.event_payload || {},
    created_at: event.created_at || null
  };
}

/* =========================================================
   DATABASE HELPERS
========================================================= */
async function dbInsert(table, payload) {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { data, error } = await supabase.from(table).insert(payload).select().single();
  if (error) throw error;
  return data;
}

async function dbInsertMany(table, payload) {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { data, error } = await supabase.from(table).insert(payload).select();
  if (error) throw error;
  return data || [];
}

async function dbSelectOne(table, filters = {}, options = {}) {
  if (!supabase) throw new Error("Supabase is not configured.");

  let query = supabase.from(table).select(options.select || "*");

  for (const [key, value] of Object.entries(filters)) {
    query = query.eq(key, value);
  }

  if (options.orderBy) {
    query = query.order(options.orderBy.column, {
      ascending: Boolean(options.orderBy.ascending)
    });
  }

  const { data, error } = await query.limit(1).maybeSingle();
  if (error) throw error;
  return data || null;
}

async function dbSelectMany(table, filters = {}, options = {}) {
  if (!supabase) throw new Error("Supabase is not configured.");

  let query = supabase.from(table).select(options.select || "*");

  for (const [key, value] of Object.entries(filters)) {
    if (Array.isArray(value)) {
      query = query.in(key, value);
    } else {
      query = query.eq(key, value);
    }
  }

  if (options.orderBy) {
    query = query.order(options.orderBy.column, {
      ascending: Boolean(options.orderBy.ascending)
    });
  }

  if (Number.isFinite(options.limit)) {
    query = query.limit(options.limit);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

async function dbUpdate(table, filters = {}, updates = {}, options = {}) {
  if (!supabase) throw new Error("Supabase is not configured.");

  let query = supabase.from(table).update(updates);

  for (const [key, value] of Object.entries(filters)) {
    query = query.eq(key, value);
  }

  if (options.select === false) {
    const { error } = await query;
    if (error) throw error;
    return null;
  }

  const { data, error } = await query.select();
  if (error) throw error;
  return data || [];
}

async function dbDelete(table, filters = {}) {
  if (!supabase) throw new Error("Supabase is not configured.");

  let query = supabase.from(table).delete();

  for (const [key, value] of Object.entries(filters)) {
    query = query.eq(key, value);
  }

  const { error } = await query;
  if (error) throw error;
  return true;
}

/* =========================================================
   COMMON DATA LOADERS
========================================================= */
async function getRiderById(riderId = "") {
  if (!clean(riderId)) return null;
  return dbSelectOne(TABLES.riders, { id: clean(riderId) });
}

async function getRiderByEmail(email = "") {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  return dbSelectOne(TABLES.riders, { email: normalized });
}

async function getDriverById(driverId = "") {
  if (!clean(driverId)) return null;
  return dbSelectOne(TABLES.drivers, { id: clean(driverId) });
}

async function getDriverByEmail(email = "") {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  return dbSelectOne(TABLES.drivers, { email: normalized });
}

async function getDriverByPhone(phone = "") {
  const normalized = normalizePhone(phone);
  if (!normalized) return null;
  return dbSelectOne(TABLES.drivers, { phone: normalized });
}

async function getRideById(rideId = "") {
  if (!clean(rideId)) return null;
  return dbSelectOne(TABLES.rides, { id: clean(rideId) });
}

async function getMissionById(missionId = "") {
  if (!clean(missionId)) return null;
  return dbSelectOne(TABLES.missions, { id: clean(missionId) });
}

async function getDispatchById(dispatchId = "") {
  if (!clean(dispatchId)) return null;
  return dbSelectOne(TABLES.dispatches, { id: clean(dispatchId) });
}

async function getLatestPaymentForRider(riderId = "") {
  if (!clean(riderId)) return null;

  return dbSelectOne(
    TABLES.payments,
    { rider_id: clean(riderId) },
    {
      orderBy: { column: "created_at", ascending: false }
    }
  );
}

/* =========================================================
   COMMON MIDDLEWARE GUARDS
========================================================= */
async function requireExistingRiderRecord(req, res, next) {
  try {
    const riderId = clean(
      req.body?.rider_id ||
        req.body?.riderId ||
        req.query?.rider_id ||
        req.query?.riderId ||
        req.headers["x-rider-id"] ||
        ""
    );

    if (!riderId) {
      return fail(res, "Rider ID is required.", 400);
    }

    const rider = await getRiderById(riderId);
    if (!rider) {
      return fail(res, "Rider not found.", 404);
    }

    req.rider = rider;
    return next();
  } catch (error) {
    return serverError(res, error, "Unable to load rider.");
  }
}

async function requireExistingDriverRecord(req, res, next) {
  try {
    const driverId = clean(
      req.body?.driver_id ||
        req.body?.driverId ||
        req.query?.driver_id ||
        req.query?.driverId ||
        req.headers["x-driver-id"] ||
        ""
    );

    if (!driverId) {
      return fail(res, "Driver ID is required.", 400);
    }

    const driver = await getDriverById(driverId);
    if (!driver) {
      return fail(res, "Driver not found.", 404);
    }

    req.driver = driver;
    return next();
  } catch (error) {
    return serverError(res, error, "Unable to load driver.");
  }
}

async function requireRiderVerificationGate(req, res, next) {
  try {
    const rider = req.rider;

    if (!rider) {
      return fail(res, "Rider context missing.", 500);
    }

    if (!ENABLE_RIDER_VERIFICATION_GATE) {
      return next();
    }

    if (!riderVerificationSatisfied(rider)) {
      return fail(
        res,
        "Rider verification approval is required before continuing.",
        403,
        {
          rider_id: rider.id,
          approval_status: normalizeRiderStatus(rider.approval_status || rider.status),
          verification_status: normalizeVerificationStatus(
            rider.verification_status ||
              rider.identity_status ||
              rider.persona_status
          )
        }
      );
    }

    return next();
  } catch (error) {
    return serverError(res, error, "Rider verification gate failed.");
  }
}

async function requirePaymentAuthorizationGate(req, res, next) {
  try {
    const rider = req.rider;

    if (!rider) {
      return fail(res, "Rider context missing.", 500);
    }

    if (!ENABLE_PAYMENT_GATE) {
      return next();
    }

    const payment = await getLatestPaymentForRider(rider.id);

    if (!isPaymentAuthorized(payment)) {
      return fail(
        res,
        "Payment authorization is required before ride dispatch.",
        402,
        {
          rider_id: rider.id,
          payment_status: payment
            ? normalizePaymentStatus(payment.status || payment.payment_status)
            : "missing"
        }
      );
    }

    req.authorizedPayment = payment;
    return next();
  } catch (error) {
    return serverError(res, error, "Payment authorization gate failed.");
  }
}

async function requireMissionReadyDriver(req, res, next) {
  try {
    const driver = req.driver;

    if (!driver) {
      return fail(res, "Driver context missing.", 500);
    }

    if (!driverCanReceiveMissions(driver)) {
      return fail(
        res,
        "Driver must complete approval, email verification, and SMS verification before continuing.",
        403,
        {
          driver: buildDriverPublicProfile(driver)
        }
      );
    }

    return next();
  } catch (error) {
    return serverError(res, error, "Driver mission gate failed.");
  }
}

/* =========================================================
   AUDIT / EVENT HELPERS
========================================================= */
async function writeAdminLog({
  action = "",
  actor_email = "",
  target_type = "",
  target_id = "",
  details = {}
}) {
  try {
    if (!supabase) return null;

    return await dbInsert(TABLES.admin_logs, {
      id: createId("alog"),
      action: clean(action),
      actor_email: normalizeEmail(actor_email),
      target_type: clean(target_type),
      target_id: clean(target_id),
      details,
      created_at: nowIso()
    });
  } catch (error) {
    console.warn("Admin log write skipped:", error.message);
    return null;
  }
}

async function writeTripEvent({
  ride_id = "",
  driver_id = "",
  rider_id = "",
  event_type = "",
  event_payload = {}
}) {
  try {
    if (!supabase) return null;

    return await dbInsert(TABLES.trip_events, {
      id: createId("evt"),
      ride_id: clean(ride_id),
      driver_id: clean(driver_id),
      rider_id: clean(rider_id),
      event_type: clean(event_type),
      event_payload,
      created_at: nowIso()
    });
  } catch (error) {
    console.warn("Trip event write skipped:", error.message);
    return null;
  }
}

/* =========================================================
   RUNTIME / DIAGNOSTIC HELPERS
========================================================= */
function buildRuntimeSnapshot() {
  return {
    app_name: APP_NAME,
    version: APP_VERSION,
    server_started_at: SERVER_STARTED_AT,
    server_time: nowIso(),
    node_env: cleanEnv(process.env.NODE_ENV || "development"),
    port: PORT,
    public_app_url: PUBLIC_APP_URL,
    supabase_ready: Boolean(supabase),
    openai_ready: Boolean(openai),
    features: {
      ai_enabled: ENABLE_AI,
      real_email_enabled: ENABLE_REAL_EMAIL,
      real_sms_enabled: ENABLE_REAL_SMS,
      persona_enforcement_enabled: ENABLE_PERSONA_ENFORCEMENT,
      rider_verification_gate_enabled: ENABLE_RIDER_VERIFICATION_GATE,
      payment_gate_enabled: ENABLE_PAYMENT_GATE,
      auto_redispatch_enabled: ENABLE_AUTO_REDISPATCH,
      startup_table_checks_enabled: ENABLE_STARTUP_TABLE_CHECKS
    },
    dispatch: {
      dispatch_timeout_seconds: DISPATCH_TIMEOUT_SECONDS,
      max_dispatch_attempts: MAX_DISPATCH_ATTEMPTS,
      dispatch_sweep_interval_ms: DISPATCH_SWEEP_INTERVAL_MS
    },
    fare_defaults: {
      booking_fee: DEFAULT_BOOKING_FEE,
      base_fare: DEFAULT_BASE_FARE,
      per_mile: DEFAULT_PER_MILE,
      per_minute: DEFAULT_PER_MINUTE,
      minimum_fare: DEFAULT_MINIMUM_FARE
    }
  };
}

function buildEnvPresenceReport() {
  return {
    SUPABASE_URL: Boolean(cleanEnv(process.env.SUPABASE_URL)),
    SUPABASE_SERVICE_ROLE_KEY: Boolean(cleanEnv(process.env.SUPABASE_SERVICE_ROLE_KEY)),
    OPENAI_API_KEY: Boolean(cleanEnv(process.env.OPENAI_API_KEY)),
    PUBLIC_APP_URL: Boolean(cleanEnv(process.env.PUBLIC_APP_URL)),
    GOOGLE_MAPS_API_KEY: Boolean(cleanEnv(process.env.GOOGLE_MAPS_API_KEY)),
    TWILIO_ACCOUNT_SID: Boolean(cleanEnv(process.env.TWILIO_ACCOUNT_SID)),
    TWILIO_AUTH_TOKEN: Boolean(cleanEnv(process.env.TWILIO_AUTH_TOKEN)),
    TWILIO_PHONE_NUMBER: Boolean(cleanEnv(process.env.TWILIO_PHONE_NUMBER)),
    SENDGRID_API_KEY: Boolean(cleanEnv(process.env.SENDGRID_API_KEY)),
    SMTP_HOST: Boolean(cleanEnv(process.env.SMTP_HOST)),
    SMTP_USER: Boolean(cleanEnv(process.env.SMTP_USER)),
    ADMIN_EMAIL: Boolean(cleanEnv(process.env.ADMIN_EMAIL || ADMIN_EMAIL)),
    ADMIN_PASSWORD: Boolean(cleanEnv(process.env.ADMIN_PASSWORD))
  };
}

function buildSafeEnvPreview() {
  return {
    SUPABASE_URL: maskSecretValue(process.env.SUPABASE_URL),
    OPENAI_API_KEY: maskSecretValue(process.env.OPENAI_API_KEY),
    TWILIO_ACCOUNT_SID: maskSecretValue(process.env.TWILIO_ACCOUNT_SID),
    SENDGRID_API_KEY: maskSecretValue(process.env.SENDGRID_API_KEY),
    SMTP_USER: maskSecretValue(process.env.SMTP_USER),
    ADMIN_EMAIL: normalizeEmail(process.env.ADMIN_EMAIL || ADMIN_EMAIL)
  };
}

async function checkTableReadable(table) {
  if (!supabase) {
    return {
      table,
      ready: false,
      reason: "supabase_not_configured"
    };
  }

  try {
    const { error, count } = await supabase
      .from(table)
      .select("*", { head: true, count: "exact" });

    return {
      table,
      ready: !error,
      count: Number.isFinite(count) ? count : null,
      error: error ? error.message : null
    };
  } catch (error) {
    return {
      table,
      ready: false,
      count: null,
      error: clean(error.message)
    };
  }
}

async function buildSchemaGuardReport() {
  const report = {};

  for (const [key, table] of Object.entries(TABLES)) {
    report[key] = await checkTableReadable(table);
  }

  return report;
}

async function runFinanceGuardChecks() {
  if (!supabase) {
    return {
      ready: false,
      reason: "supabase_not_configured"
    };
  }

  try {
    const payments = await dbSelectMany(TABLES.payments, {}, { limit: 50 });
    const rides = await dbSelectMany(TABLES.rides, {}, { limit: 50 });
    const earnings = await dbSelectMany(TABLES.driver_earnings, {}, { limit: 50 });

    const issues = [];

    for (const payment of payments) {
      const status = normalizePaymentStatus(payment.status || payment.payment_status);
      if (!["pending", "authorized", "captured", "failed", "refunded", "voided"].includes(status)) {
        issues.push({
          type: "unexpected_payment_status",
          payment_id: payment.id,
          status
        });
      }
    }

    for (const ride of rides) {
      const status = normalizeRideStatus(ride.status);
      if (!status) {
        issues.push({
          type: "missing_ride_status",
          ride_id: ride.id
        });
      }
    }

    for (const earning of earnings) {
      const payoutStatus = normalizePayoutStatus(earning.payout_status);
      if (!["pending", "processing", "paid", "failed", "cancelled"].includes(payoutStatus)) {
        issues.push({
          type: "unexpected_earning_payout_status",
          earning_id: earning.id,
          payout_status: payoutStatus
        });
      }
    }

    return {
      ready: true,
      checked: {
        payments: payments.length,
        rides: rides.length,
        earnings: earnings.length
      },
      issue_count: issues.length,
      issues: issues.slice(0, 50)
    };
  } catch (error) {
    return {
      ready: false,
      reason: clean(error.message)
    };
  }
}

async function runStartupChecks() {
  const report = {
    app_name: APP_NAME,
    version: APP_VERSION,
    started_at: SERVER_STARTED_AT,
    supabase_ready: supabaseReady,
    ai_ready: Boolean(openai),
    flags: {
      ENABLE_AI,
      ENABLE_REAL_EMAIL,
      ENABLE_REAL_SMS,
      ENABLE_PERSONA_ENFORCEMENT,
      ENABLE_RIDER_VERIFICATION_GATE,
      ENABLE_PAYMENT_GATE,
      ENABLE_AUTO_REDISPATCH,
      ENABLE_STARTUP_TABLE_CHECKS
    },
    tables: {}
  };

  if (!supabase || !ENABLE_STARTUP_TABLE_CHECKS) {
    return report;
  }

  for (const [key, table] of Object.entries(TABLES)) {
    try {
      const { error } = await supabase.from(table).select("*", {
        count: "exact",
        head: true
      });

      report.tables[key] = {
        table,
        ready: !error,
        error: error ? error.message : null
      };
    } catch (error) {
      report.tables[key] = {
        table,
        ready: false,
        error: error.message
      };
    }
  }

  return report;
}

/* =========================================================
   CORE SYSTEM ROUTES
========================================================= */
app.get("/", (req, res) => {
  return ok(
    res,
    {
      app: APP_NAME,
      version: APP_VERSION,
      started_at: SERVER_STARTED_AT,
      public_app_url: PUBLIC_APP_URL
    },
    "Harvey Taxi Code Blue clean rebuild server is running."
  );
});

app.get("/api/ping", (req, res) => {
  return ok(
    res,
    {
      pong: true,
      time: nowIso()
    },
    "Ping successful."
  );
});

app.get("/api/version", (req, res) => {
  return ok(
    res,
    {
      app: APP_NAME,
      version_label: APP_VERSION,
      started_at: SERVER_STARTED_AT
    },
    "Version loaded."
  );
});

app.get("/api/config", (req, res) => {
  return ok(
    res,
    {
      app: APP_NAME,
      public_app_url: PUBLIC_APP_URL,
      features: {
        ai_enabled: Boolean(openai),
        real_email_enabled: ENABLE_REAL_EMAIL,
        real_sms_enabled: ENABLE_REAL_SMS,
        persona_enforcement_enabled: ENABLE_PERSONA_ENFORCEMENT,
        rider_verification_gate_enabled: ENABLE_RIDER_VERIFICATION_GATE,
        payment_gate_enabled: ENABLE_PAYMENT_GATE,
        auto_redispatch_enabled: ENABLE_AUTO_REDISPATCH
      }
    },
    "Runtime config loaded."
  );
});

app.get("/api/health", asyncHandler(async (req, res) => {
  const startup = await runStartupChecks();

  return ok(
    res,
    {
      app: APP_NAME,
      version: APP_VERSION,
      server_started_at: SERVER_STARTED_AT,
      server_time: nowIso(),
      public_app_url: PUBLIC_APP_URL,
      supabase_ready: supabaseReady,
      ai_ready: Boolean(openai),
      config: {
        dispatch_timeout_seconds: DISPATCH_TIMEOUT_SECONDS,
        max_dispatch_attempts: MAX_DISPATCH_ATTEMPTS,
        dispatch_sweep_interval_ms: DISPATCH_SWEEP_INTERVAL_MS,
        default_booking_fee: DEFAULT_BOOKING_FEE,
        default_base_fare: DEFAULT_BASE_FARE,
        default_per_mile: DEFAULT_PER_MILE,
        default_per_minute: DEFAULT_PER_MINUTE,
        default_minimum_fare: DEFAULT_MINIMUM_FARE
      },
      startup
    },
    "Health check successful."
  );
}));

/* =========================================================
   DIAGNOSTIC ROUTES
========================================================= */
app.get("/api/diagnostics/runtime", asyncHandler(async (req, res) => {
  return ok(
    res,
    {
      runtime: buildRuntimeSnapshot(),
      request: buildRequestMeta(req)
    },
    "Runtime diagnostics loaded."
  );
}));

app.get("/api/admin/diagnostics/env", requireAdmin, asyncHandler(async (req, res) => {
  return ok(
    res,
    {
      env_presence: buildEnvPresenceReport(),
      safe_env_preview: buildSafeEnvPreview(),
      runtime: buildRuntimeSnapshot()
    },
    "Environment diagnostics loaded."
  );
}));

app.get("/api/admin/diagnostics/schema", requireAdmin, asyncHandler(async (req, res) => {
  const schema = await buildSchemaGuardReport();

  return ok(
    res,
    {
      schema
    },
    "Schema diagnostics loaded."
  );
}));

app.get("/api/admin/diagnostics/finance", requireAdmin, asyncHandler(async (req, res) => {
  const finance = await runFinanceGuardChecks();

  return ok(
    res,
    {
      finance
    },
    "Finance diagnostics loaded."
  );
}));

app.get("/api/admin/diagnostics/startup", requireAdmin, asyncHandler(async (req, res) => {
  const startup = await runStartupChecks();

  return ok(
    res,
    {
      startup,
      runtime: buildRuntimeSnapshot(),
      env_presence: buildEnvPresenceReport()
    },
    "Startup diagnostics loaded."
  );
}));

/* =========================================================
   PART 1 END MARKER
   DO NOT ADD app.listen() YET
   app.listen() will be placed at the END of the FINAL file
========================================================= *//* =========================================================
   HARVEY TAXI — CODE BLUE CLEAN REBUILD
   PART 2: RIDERS + VERIFICATION GATE + PAYMENT FOUNDATION
========================================================= */

/* =========================================================
   RIDER HELPERS
========================================================= */
function buildRiderSignupPayload(body = {}) {
  const first_name = pickFirst(body.first_name, body.firstName);
  const last_name = pickFirst(body.last_name, body.lastName);
  const email = normalizeEmail(body.email);
  const phone = normalizePhone(body.phone);
  const city = pickFirst(body.city);
  const state = upper(pickFirst(body.state, body.stateValue, "TN"));

  const password = clean(body.password);
  const document_type = lower(
    pickFirst(body.document_type, body.documentType, "id")
  );

  const document_number = clean(
    body.document_number ||
      body.documentNumber ||
      ""
  );

  const persona_inquiry_id = clean(
    body.persona_inquiry_id ||
      body.personaInquiryId ||
      ""
  );

  const persona_status = normalizeVerificationStatus(
    body.persona_status ||
      body.personaStatus ||
      body.verification_status ||
      body.verificationStatus ||
      "pending"
  );

  return {
    first_name,
    last_name,
    email,
    phone,
    city,
    state,
    password,
    document_type: document_type || "id",
    document_number,
    persona_inquiry_id,
    persona_status
  };
}

function validateRiderSignupInput(payload = {}) {
  if (!payload.first_name) return "First name is required.";
  if (!payload.last_name) return "Last name is required.";
  if (!payload.email) return "Email is required.";
  if (!payload.phone) return "Phone is required.";
  if (!payload.city) return "City is required.";
  if (!payload.state) return "State is required.";
  if (!payload.password || payload.password.length < 8) {
    return "Password must be at least 8 characters.";
  }

  return "";
}

function buildNewRiderRecord(payload = {}, password_hash = "") {
  return {
    id: createId("rider"),
    first_name: payload.first_name,
    last_name: payload.last_name,
    email: payload.email,
    phone: payload.phone,
    city: payload.city,
    state: payload.state,
    password_hash,
    rider_type: "standard",
    approval_status: "pending",
    verification_status: ENABLE_PERSONA_ENFORCEMENT
      ? payload.persona_status || "pending"
      : "approved",
    identity_status: ENABLE_PERSONA_ENFORCEMENT
      ? payload.persona_status || "pending"
      : "approved",
    persona_status: ENABLE_PERSONA_ENFORCEMENT
      ? payload.persona_status || "pending"
      : "approved",
    persona_inquiry_id: payload.persona_inquiry_id || null,
    document_type: payload.document_type || "id",
    document_number: payload.document_number || null,
    status: ENABLE_PERSONA_ENFORCEMENT ? "pending" : "approved",
    created_at: nowIso(),
    updated_at: nowIso()
  };
}

async function ensureUniqueRiderIdentity({ email = "", phone = "" }) {
  const existingByEmail = await getRiderByEmail(email);
  if (existingByEmail) {
    return {
      ok: false,
      status: 409,
      message: "A rider with this email already exists.",
      extra: {
        rider_id: existingByEmail.id,
        approval_status: normalizeRiderStatus(
          existingByEmail.approval_status || existingByEmail.status
        )
      }
    };
  }

  const existingByPhone = await dbSelectOne(TABLES.riders, {
    phone: normalizePhone(phone)
  });

  if (existingByPhone) {
    return {
      ok: false,
      status: 409,
      message: "A rider with this phone already exists.",
      extra: {
        rider_id: existingByPhone.id,
        approval_status: normalizeRiderStatus(
          existingByPhone.approval_status || existingByPhone.status
        )
      }
    };
  }

  return { ok: true };
}

async function getRiderByPhone(phone = "") {
  const normalized = normalizePhone(phone);
  if (!normalized) return null;
  return dbSelectOne(TABLES.riders, { phone: normalized });
}

async function getRiderPayments(riderId = "") {
  if (!clean(riderId)) return [];
  return dbSelectMany(
    TABLES.payments,
    { rider_id: clean(riderId) },
    {
      orderBy: { column: "created_at", ascending: false },
      limit: 50
    }
  );
}

function riderCanRequestRide(rider, latestPayment) {
  const verificationPassed =
    !ENABLE_RIDER_VERIFICATION_GATE || riderVerificationSatisfied(rider);

  const paymentPassed =
    !ENABLE_PAYMENT_GATE || isPaymentAuthorized(latestPayment);

  return verificationPassed && paymentPassed;
}

function buildRiderGateSummary(rider, latestPayment) {
  const verificationPassed = riderVerificationSatisfied(rider);
  const paymentPassed = isPaymentAuthorized(latestPayment);

  return {
    verification_required: ENABLE_RIDER_VERIFICATION_GATE,
    payment_required: ENABLE_PAYMENT_GATE,
    verification_passed: verificationPassed,
    payment_passed: paymentPassed
  };
}

/* =========================================================
   RIDER AUTH FOUNDATION
========================================================= */
app.post("/api/rider/signup", asyncHandler(async (req, res) => {
  if (!supabase) {
    return fail(res, "Supabase is not configured.", 500);
  }

  const signup = buildRiderSignupPayload(req.body || {});
  const validationError = validateRiderSignupInput(signup);

  if (validationError) {
    return fail(res, validationError, 400);
  }

  const uniqueness = await ensureUniqueRiderIdentity({
    email: signup.email,
    phone: signup.phone
  });

  if (!uniqueness.ok) {
    return fail(res, uniqueness.message, uniqueness.status, uniqueness.extra);
  }

  const password_hash = await hashPassword(signup.password);

  const rider = await dbInsert(
    TABLES.riders,
    buildNewRiderRecord(signup, password_hash)
  );

  await writeTripEvent({
    rider_id: rider.id,
    event_type: "rider_signup_created",
    event_payload: {
      email: rider.email,
      phone: rider.phone,
      city: rider.city,
      state: rider.state,
      document_type: rider.document_type,
      verification_status: rider.verification_status,
      persona_inquiry_id: rider.persona_inquiry_id
    }
  });

  return ok(
    res,
    {
      rider: buildRiderPublicProfile(rider),
      next_step: ENABLE_RIDER_VERIFICATION_GATE
        ? "Complete rider identity verification and wait for approval before requesting a ride."
        : "Rider account created."
    },
    "Rider signup submitted successfully.",
    201
  );
}));

app.post("/api/rider/login", asyncHandler(async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const password = clean(req.body?.password);

  if (!email) {
    return fail(res, "Email is required.", 400);
  }

  if (!password) {
    return fail(res, "Password is required.", 400);
  }

  const rider = await getRiderByEmail(email);

  if (!rider) {
    return fail(res, "Invalid email or password.", 401);
  }

  const passwordHash =
    clean(rider.password_hash) ||
    clean(rider.passwordHash);

  if (!passwordHash) {
    return fail(
      res,
      "This rider account is missing a secure password record.",
      409
    );
  }

  const passwordValid = await verifyPassword(password, passwordHash);

  if (!passwordValid) {
    return fail(res, "Invalid email or password.", 401);
  }

  const latestPayment = await getLatestPaymentForRider(rider.id);

  await writeTripEvent({
    rider_id: rider.id,
    event_type: "rider_login_success",
    event_payload: {
      email: rider.email
    }
  });

  return ok(
    res,
    {
      rider: buildRiderPublicProfile(rider),
      rider_can_request_ride: riderCanRequestRide(rider, latestPayment),
      gates: buildRiderGateSummary(rider, latestPayment),
      latest_payment: buildPaymentPublicRecord(latestPayment)
    },
    "Rider login successful."
  );
}));

/* =========================================================
   RIDER STATUS / PROFILE
========================================================= */
app.get("/api/rider/status", asyncHandler(async (req, res) => {
  const riderId = clean(req.query?.rider_id || req.query?.riderId || "");
  const email = normalizeEmail(req.query?.email || "");
  const phone = normalizePhone(req.query?.phone || "");

  if (!riderId && !email && !phone) {
    return fail(res, "Rider ID, email, or phone is required.", 400);
  }

  let rider = null;

  if (riderId) {
    rider = await getRiderById(riderId);
  } else if (email) {
    rider = await getRiderByEmail(email);
  } else if (phone) {
    rider = await getRiderByPhone(phone);
  }

  if (!rider) {
    return fail(res, "Rider not found.", 404);
  }

  const latestPayment = await getLatestPaymentForRider(rider.id);

  return ok(
    res,
    {
      rider: buildRiderPublicProfile(rider),
      rider_can_request_ride: riderCanRequestRide(rider, latestPayment),
      gates: buildRiderGateSummary(rider, latestPayment),
      latest_payment: buildPaymentPublicRecord(latestPayment)
    },
    "Rider status loaded."
  );
}));

app.get("/api/riders/:riderId", asyncHandler(async (req, res) => {
  const rider = await getRiderById(req.params.riderId);

  if (!rider) {
    return fail(res, "Rider not found.", 404);
  }

  const latestPayment = await getLatestPaymentForRider(rider.id);

  return ok(
    res,
    {
      rider: buildRiderPublicProfile(rider),
      latest_payment: buildPaymentPublicRecord(latestPayment)
    },
    "Rider profile loaded."
  );
}));

app.get("/api/riders/:riderId/payments", asyncHandler(async (req, res) => {
  const riderId = clean(req.params.riderId);
  const rider = await getRiderById(riderId);

  if (!rider) {
    return fail(res, "Rider not found.", 404);
  }

  const payments = await getRiderPayments(rider.id);

  return ok(
    res,
    {
      rider: buildRiderPublicProfile(rider),
      payments: payments.map(buildPaymentPublicRecord)
    },
    "Rider payments loaded."
  );
}));

/* =========================================================
   PAYMENT AUTHORIZATION FOUNDATION
========================================================= */
function buildPaymentAuthorizationPayload(body = {}) {
  const rider_id = clean(body.rider_id || body.riderId);
  const ride_id = clean(body.ride_id || body.rideId || "");
  const amount = asCurrency(body.amount || 0);
  const currency = upper(clean(body.currency || "USD"));
  const payment_method = clean(
    body.payment_method ||
      body.paymentMethod ||
      "card"
  );

  const authorization_code = clean(
    body.authorization_code ||
      body.authorizationCode ||
      `auth_${crypto.randomBytes(6).toString("hex")}`
  );

  return {
    rider_id,
    ride_id,
    amount,
    currency,
    payment_method,
    authorization_code
  };
}

function validatePaymentAuthorizationPayload(payload = {}) {
  if (!payload.rider_id) return "Rider ID is required.";
  if (!payload.amount || payload.amount <= 0) {
    return "A valid authorization amount is required.";
  }
  return "";
}

app.post("/api/payments/authorize", asyncHandler(async (req, res) => {
  if (!supabase) {
    return fail(res, "Supabase is not configured.", 500);
  }

  const payload = buildPaymentAuthorizationPayload(req.body || {});
  const validationError = validatePaymentAuthorizationPayload(payload);

  if (validationError) {
    return fail(res, validationError, 400);
  }

  const rider = await getRiderById(payload.rider_id);

  if (!rider) {
    return fail(res, "Rider not found.", 404);
  }

  const payment = await dbInsert(TABLES.payments, {
    id: createId("pay"),
    rider_id: payload.rider_id,
    ride_id: payload.ride_id || null,
    amount: payload.amount,
    currency: payload.currency,
    payment_method: payload.payment_method,
    status: "authorized",
    payment_status: "authorized",
    authorization_code: payload.authorization_code,
    provider: "internal_foundation",
    created_at: nowIso(),
    updated_at: nowIso()
  });

  await writeTripEvent({
    rider_id: payload.rider_id,
    ride_id: payload.ride_id,
    event_type: "payment_authorized",
    event_payload: {
      payment_id: payment.id,
      amount: payload.amount,
      currency: payload.currency,
      payment_method: payload.payment_method
    }
  });

  return ok(
    res,
    {
      payment: buildPaymentPublicRecord(payment)
    },
    "Payment authorized successfully.",
    201
  );
}));

app.post("/api/payments/:paymentId/capture", asyncHandler(async (req, res) => {
  const paymentId = clean(req.params.paymentId);
  const payment = await dbSelectOne(TABLES.payments, { id: paymentId });

  if (!payment) {
    return fail(res, "Payment not found.", 404);
  }

  const currentStatus = normalizePaymentStatus(
    payment.status || payment.payment_status
  );

  if (!["authorized", "captured"].includes(currentStatus)) {
    return fail(
      res,
      "Only authorized payments can be captured.",
      409,
      {
        payment_status: currentStatus
      }
    );
  }

  const rows = await dbUpdate(
    TABLES.payments,
    { id: payment.id },
    {
      status: "captured",
      payment_status: "captured",
      updated_at: nowIso()
    }
  );

  const updated = Array.isArray(rows) ? rows[0] : payment;

  await writeTripEvent({
    rider_id: payment.rider_id,
    ride_id: payment.ride_id || "",
    event_type: "payment_captured",
    event_payload: {
      payment_id: payment.id,
      amount: payment.amount
    }
  });

  return ok(
    res,
    {
      payment: buildPaymentPublicRecord(updated)
    },
    "Payment captured successfully."
  );
}));

app.post("/api/payments/:paymentId/void", asyncHandler(async (req, res) => {
  const paymentId = clean(req.params.paymentId);
  const payment = await dbSelectOne(TABLES.payments, { id: paymentId });

  if (!payment) {
    return fail(res, "Payment not found.", 404);
  }

  const currentStatus = normalizePaymentStatus(
    payment.status || payment.payment_status
  );

  if (!["authorized", "pending", "voided"].includes(currentStatus)) {
    return fail(
      res,
      "This payment cannot be voided.",
      409,
      {
        payment_status: currentStatus
      }
    );
  }

  const rows = await dbUpdate(
    TABLES.payments,
    { id: payment.id },
    {
      status: "voided",
      payment_status: "voided",
      updated_at: nowIso()
    }
  );

  const updated = Array.isArray(rows) ? rows[0] : payment;

  await writeTripEvent({
    rider_id: payment.rider_id,
    ride_id: payment.ride_id || "",
    event_type: "payment_voided",
    event_payload: {
      payment_id: payment.id,
      amount: payment.amount
    }
  });

  return ok(
    res,
    {
      payment: buildPaymentPublicRecord(updated)
    },
    "Payment voided successfully."
  );
}));

app.get("/api/payments/latest", asyncHandler(async (req, res) => {
  const rider_id = clean(req.query?.rider_id || req.query?.riderId || "");

  if (!rider_id) {
    return fail(res, "Rider ID is required.", 400);
  }

  const payment = await getLatestPaymentForRider(rider_id);

  return ok(
    res,
    {
      payment: buildPaymentPublicRecord(payment)
    },
    payment ? "Latest payment loaded." : "No payment found."
  );
}));

/* =========================================================
   FARE ESTIMATE
========================================================= */
app.post("/api/fare-estimate", asyncHandler(async (req, res) => {
  const miles = parseFloatSafe(req.body?.miles, 0);
  const minutes = parseFloatSafe(req.body?.minutes, 0);
  const requestedMode = lower(
    req.body?.requestedMode ||
      req.body?.requested_mode ||
      "driver"
  );

  let surgeMultiplier = parseFloatSafe(
    req.body?.surgeMultiplier ||
      req.body?.surge_multiplier,
    1
  );

  if (surgeMultiplier < 1) {
    surgeMultiplier = 1;
  }

  const estimate = buildFareEstimate({
    miles,
    minutes,
    surgeMultiplier
  });

  return ok(
    res,
    {
      estimate: {
        ...estimate,
        requested_mode: requestedMode === "autonomous" ? "autonomous" : "driver"
      }
    },
    "Fare estimate calculated."
  );
}));

/* =========================================================
   RIDE REQUEST PRECHECK
========================================================= */
app.post(
  "/api/rides/precheck",
  requireExistingRiderRecord,
  requireRiderVerificationGate,
  requirePaymentAuthorizationGate,
  asyncHandler(async (req, res) => {
    const rider = req.rider;
    const payment = req.authorizedPayment || null;

    const pickup_address = clean(
      req.body?.pickup_address ||
        req.body?.pickupAddress ||
        ""
    );

    const dropoff_address = clean(
      req.body?.dropoff_address ||
        req.body?.dropoffAddress ||
        ""
    );

    const requested_mode = lower(
      req.body?.requested_mode ||
        req.body?.requestedMode ||
        "driver"
    );

    if (!pickup_address) {
      return fail(res, "Pickup address is required.", 400);
    }

    if (!dropoff_address) {
      return fail(res, "Dropoff address is required.", 400);
    }

    return ok(
      res,
      {
        rider: buildRiderPublicProfile(rider),
        latest_payment: buildPaymentPublicRecord(payment),
        request_ready: true,
        request_summary: {
          pickup_address,
          dropoff_address,
          requested_mode: requested_mode === "autonomous" ? "autonomous" : "driver"
        }
      },
      "Rider is cleared to request a ride."
    );
  })
);

/* =========================================================
   ADMIN RIDER REVIEW
========================================================= */
app.get("/api/admin/riders", requireAdmin, asyncHandler(async (req, res) => {
  const riders = await dbSelectMany(
    TABLES.riders,
    {},
    {
      orderBy: { column: "created_at", ascending: false },
      limit: 200
    }
  );

  return ok(
    res,
    {
      riders: riders.map(buildRiderPublicProfile)
    },
    "Admin rider list loaded."
  );
}));

app.post("/api/admin/riders/:riderId/approve", requireAdmin, asyncHandler(async (req, res) => {
  const riderId = clean(req.params.riderId);
  const rider = await getRiderById(riderId);

  if (!rider) {
    return fail(res, "Rider not found.", 404);
  }

  if (ENABLE_PERSONA_ENFORCEMENT) {
    const verificationStatus = normalizeVerificationStatus(
      rider.verification_status ||
        rider.identity_status ||
        rider.persona_status
    );

    if (verificationStatus !== "approved") {
      return fail(
        res,
        "Rider cannot be approved until identity verification is approved.",
        409,
        {
          rider_id: rider.id,
          verification_status: verificationStatus,
          persona_inquiry_id: clean(rider.persona_inquiry_id)
        }
      );
    }
  }

  const updatedRows = await dbUpdate(
    TABLES.riders,
    { id: riderId },
    {
      approval_status: "approved",
      status: "approved",
      updated_at: nowIso()
    }
  );

  const updated = Array.isArray(updatedRows) ? updatedRows[0] : rider;

  await writeAdminLog({
    action: "rider_approved",
    actor_email: getAdminCredentials(req).email,
    target_type: "rider",
    target_id: riderId,
    details: {
      previous_approval_status: rider.approval_status || rider.status || null,
      verification_status: normalizeVerificationStatus(
        rider.verification_status ||
          rider.identity_status ||
          rider.persona_status
      )
    }
  });

  await writeTripEvent({
    rider_id: riderId,
    event_type: "rider_approved",
    event_payload: {
      admin_email: getAdminCredentials(req).email
    }
  });

  return ok(
    res,
    {
      rider: buildRiderPublicProfile(updated)
    },
    "Rider approved successfully."
  );
}));

app.post("/api/admin/riders/:riderId/reject", requireAdmin, asyncHandler(async (req, res) => {
  const riderId = clean(req.params.riderId);
  const reason = clean(
    req.body?.reason || "Rider verification was not approved."
  );

  const rider = await getRiderById(riderId);

  if (!rider) {
    return fail(res, "Rider not found.", 404);
  }

  const updatedRows = await dbUpdate(
    TABLES.riders,
    { id: riderId },
    {
      approval_status: "rejected",
      status: "rejected",
      verification_status: "failed",
      identity_status: "failed",
      persona_status: "failed",
      rejection_reason: reason,
      updated_at: nowIso()
    }
  );

  const updated = Array.isArray(updatedRows) ? updatedRows[0] : rider;

  await writeAdminLog({
    action: "rider_rejected",
    actor_email: getAdminCredentials(req).email,
    target_type: "rider",
    target_id: riderId,
    details: {
      reason
    }
  });

  await writeTripEvent({
    rider_id: riderId,
    event_type: "rider_rejected",
    event_payload: {
      admin_email: getAdminCredentials(req).email,
      reason
    }
  });

  return ok(
    res,
    {
      rider: buildRiderPublicProfile(updated)
    },
    "Rider rejected successfully."
  );
}));

/* =========================================================
   ADMIN RIDER VERIFICATION OVERRIDE
   This is a controlled internal bridge for manual ops.
   Persona webhook automation will be added in a later part.
========================================================= */
app.post(
  "/api/admin/riders/:riderId/mark-verification-approved",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const riderId = clean(req.params.riderId);
    const rider = await getRiderById(riderId);

    if (!rider) {
      return fail(res, "Rider not found.", 404);
    }

    const updatedRows = await dbUpdate(
      TABLES.riders,
      { id: riderId },
      {
        verification_status: "approved",
        identity_status: "approved",
        persona_status: "approved",
        updated_at: nowIso()
      }
    );

    const updated = Array.isArray(updatedRows) ? updatedRows[0] : rider;

    await writeAdminLog({
      action: "rider_verification_marked_approved",
      actor_email: getAdminCredentials(req).email,
      target_type: "rider",
      target_id: riderId,
      details: {
        persona_inquiry_id: clean(rider.persona_inquiry_id)
      }
    });

    await writeTripEvent({
      rider_id: riderId,
      event_type: "rider_verification_marked_approved",
      event_payload: {
        admin_email: getAdminCredentials(req).email
      }
    });

    return ok(
      res,
      {
        rider: buildRiderPublicProfile(updated)
      },
      "Rider verification marked approved."
    );
  })
);

app.post(
  "/api/admin/riders/:riderId/mark-verification-failed",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const riderId = clean(req.params.riderId);
    const reason = clean(req.body?.reason || "Verification failed.");
    const rider = await getRiderById(riderId);

    if (!rider) {
      return fail(res, "Rider not found.", 404);
    }

    const updatedRows = await dbUpdate(
      TABLES.riders,
      { id: riderId },
      {
        verification_status: "failed",
        identity_status: "failed",
        persona_status: "failed",
        rejection_reason: reason,
        updated_at: nowIso()
      }
    );

    const updated = Array.isArray(updatedRows) ? updatedRows[0] : rider;

    await writeAdminLog({
      action: "rider_verification_marked_failed",
      actor_email: getAdminCredentials(req).email,
      target_type: "rider",
      target_id: riderId,
      details: {
        reason,
        persona_inquiry_id: clean(rider.persona_inquiry_id)
      }
    });

    await writeTripEvent({
      rider_id: riderId,
      event_type: "rider_verification_marked_failed",
      event_payload: {
        admin_email: getAdminCredentials(req).email,
        reason
      }
    });

    return ok(
      res,
      {
        rider: buildRiderPublicProfile(updated)
      },
      "Rider verification marked failed."
    );
  })
);

/* =========================================================
   PART 2 END
========================================================= *//* =========================================================
   HARVEY TAXI — CODE BLUE CLEAN REBUILD
   PART 3: RIDES + DISPATCH FOUNDATION + MISSION FLOW
========================================================= */

/* =========================================================
   RIDE / DISPATCH HELPERS
========================================================= */
function buildDriverMissionPreview({ ride, rider, mission }) {
  return {
    ride_id: ride?.id || "",
    mission_id: mission?.id || "",
    rider_first_name: clean(rider?.first_name),
    rider_last_name: clean(rider?.last_name),
    pickup_address: clean(mission?.pickup_address || ride?.pickup_address),
    dropoff_address: clean(mission?.dropoff_address || ride?.dropoff_address),
    requested_mode: lower(mission?.requested_mode || ride?.requested_mode || "driver"),
    fare_estimate: asCurrency(
      mission?.fare_estimate ||
        ride?.fare_estimate ||
        ride?.estimated_total ||
        0
    ),
    notes: clean(mission?.notes || ride?.notes),
    created_at: mission?.created_at || ride?.created_at || null,
    expires_at: mission?.expires_at || null
  };
}

async function getLatestDispatchForRide(rideId = "") {
  if (!clean(rideId)) return null;

  return dbSelectOne(
    TABLES.dispatches,
    { ride_id: clean(rideId) },
    {
      orderBy: { column: "created_at", ascending: false }
    }
  );
}

async function getOpenDispatchesForDriver(driverId = "") {
  if (!clean(driverId)) return [];

  return dbSelectMany(
    TABLES.dispatches,
    { driver_id: clean(driverId) },
    {
      orderBy: { column: "created_at", ascending: false },
      limit: 25
    }
  );
}

async function getOpenMissionsForDriver(driverId = "") {
  if (!clean(driverId)) return [];

  return dbSelectMany(
    TABLES.missions,
    { driver_id: clean(driverId) },
    {
      orderBy: { column: "created_at", ascending: false },
      limit: 25
    }
  );
}

async function getRidesForDriver(driverId = "") {
  if (!clean(driverId)) return [];

  return dbSelectMany(
    TABLES.rides,
    { driver_id: clean(driverId) },
    {
      orderBy: { column: "created_at", ascending: false },
      limit: 50
    }
  );
}

async function getRidesForRider(riderId = "") {
  if (!clean(riderId)) return [];

  return dbSelectMany(
    TABLES.rides,
    { rider_id: clean(riderId) },
    {
      orderBy: { column: "created_at", ascending: false },
      limit: 50
    }
  );
}

function canDriverReceiveOfferNow(driver) {
  if (!driver) return false;
  if (!driverCanReceiveMissions(driver)) return false;

  const status = normalizeDriverStatus(driver.status);
  if (!["available"].includes(status)) {
    return false;
  }

  return true;
}

/* =========================================================
   SINGLE CLEAN DRIVER SELECTION FUNCTION
========================================================= */
async function selectCandidateDriver(requestedMode = "driver") {
  const desiredType =
    lower(requestedMode || "driver") === "autonomous" ? "autonomous" : "human";

  const allDrivers = await dbSelectMany(
    TABLES.drivers,
    {},
    {
      orderBy: { column: "created_at", ascending: true },
      limit: 200
    }
  );

  const candidates = allDrivers.filter((driver) => {
    const driverType = normalizeDriverType(driver.driver_type);
    return driverType === desiredType && canDriverReceiveOfferNow(driver);
  });

  return candidates[0] || null;
}

/* =========================================================
   DISPATCH OFFER CREATOR
   ONE source of truth for dispatch + mission creation
========================================================= */
async function createDispatchOfferForDriver({
  ride,
  rider,
  driver,
  requested_mode = "driver"
}) {
  if (!ride) throw new Error("Ride is required.");
  if (!driver) throw new Error("Driver is required.");

  const dispatchId = createId("dispatch");
  const missionId = createId("mission");
  const expiresAt = addSecondsToIso(DISPATCH_TIMEOUT_SECONDS);
  const attemptNumber = parseInteger(ride?.dispatch_attempts, 0) + 1;

  const dispatch = await dbInsert(TABLES.dispatches, {
    id: dispatchId,
    ride_id: ride.id,
    rider_id: ride.rider_id,
    driver_id: driver.id,
    mission_id: missionId,
    attempt_number: attemptNumber,
    status: "offered",
    expires_at: expiresAt,
    created_at: nowIso(),
    updated_at: nowIso()
  });

  const mission = await dbInsert(TABLES.missions, {
    id: missionId,
    ride_id: ride.id,
    rider_id: ride.rider_id,
    driver_id: driver.id,
    requested_mode: requested_mode === "autonomous" ? "autonomous" : "driver",
    pickup_address: clean(ride.pickup_address),
    dropoff_address: clean(ride.dropoff_address),
    fare_estimate: asCurrency(
      ride.fare_estimate ||
        ride.estimated_total ||
        0
    ),
    notes: clean(ride.notes),
    status: "offered",
    expires_at: expiresAt,
    created_at: nowIso(),
    updated_at: nowIso()
  });

  await dbUpdate(
    TABLES.rides,
    { id: ride.id },
    {
      status: "awaiting_driver_acceptance",
      dispatch_attempts: attemptNumber,
      updated_at: nowIso()
    },
    { select: false }
  );

  await writeTripEvent({
    ride_id: ride.id,
    rider_id: ride.rider_id,
    driver_id: driver.id,
    event_type: "dispatch_offered",
    event_payload: {
      dispatch_id: dispatch.id,
      mission_id: mission.id,
      attempt_number: attemptNumber,
      expires_at: expiresAt
    }
  });

  return {
    dispatch,
    mission,
    preview: buildDriverMissionPreview({ ride, rider, mission })
  };
}

/* =========================================================
   REQUEST PAYLOAD HELPERS
========================================================= */
function buildRideRequestPayload(body = {}) {
  const pickup_address = clean(
    body.pickup_address ||
      body.pickupAddress
  );

  const dropoff_address = clean(
    body.dropoff_address ||
      body.dropoffAddress
  );

  const requested_mode = lower(
    body.requested_mode ||
      body.requestedMode ||
      "driver"
  );

  const notes = clean(body.notes || "");
  const miles = parseFloatSafe(body.miles, 0);
  const minutes = parseFloatSafe(body.minutes, 0);

  let surgeMultiplier = parseFloatSafe(
    body.surgeMultiplier || body.surge_multiplier,
    1
  );

  if (surgeMultiplier < 1) {
    surgeMultiplier = 1;
  }

  return {
    pickup_address,
    dropoff_address,
    requested_mode: requested_mode === "autonomous" ? "autonomous" : "driver",
    notes,
    miles,
    minutes,
    surgeMultiplier
  };
}

function validateRideRequestPayload(payload = {}) {
  if (!payload.pickup_address) return "Pickup address is required.";
  if (!payload.dropoff_address) return "Dropoff address is required.";
  return "";
}

function buildNewRideRecord({
  rider,
  authorizedPayment,
  payload,
  estimate
}) {
  return {
    id: createId("ride"),
    rider_id: rider.id,
    driver_id: null,
    payment_id: authorizedPayment?.id || null,
    pickup_address: payload.pickup_address,
    dropoff_address: payload.dropoff_address,
    requested_mode: payload.requested_mode,
    status: "searching",
    fare_estimate: estimate.estimated_total,
    estimated_total: estimate.estimated_total,
    miles: payload.miles,
    minutes: payload.minutes,
    notes: payload.notes,
    dispatch_attempts: 0,
    created_at: nowIso(),
    updated_at: nowIso()
  };
}

/* =========================================================
   RIDE CREATION
========================================================= */
app.post(
  "/api/rides/request",
  requireExistingRiderRecord,
  requireRiderVerificationGate,
  requirePaymentAuthorizationGate,
  asyncHandler(async (req, res) => {
    if (!supabase) {
      return fail(res, "Supabase is not configured.", 500);
    }

    const rider = req.rider;
    const authorizedPayment = req.authorizedPayment || null;
    const payload = buildRideRequestPayload(req.body || {});
    const validationError = validateRideRequestPayload(payload);

    if (validationError) {
      return fail(res, validationError, 400);
    }

    const estimate = buildFareEstimate({
      miles: payload.miles,
      minutes: payload.minutes,
      surgeMultiplier: payload.surgeMultiplier
    });

    const ride = await dbInsert(
      TABLES.rides,
      buildNewRideRecord({
        rider,
        authorizedPayment,
        payload,
        estimate
      })
    );

    await writeTripEvent({
      ride_id: ride.id,
      rider_id: rider.id,
      event_type: "ride_requested",
      event_payload: {
        pickup_address: payload.pickup_address,
        dropoff_address: payload.dropoff_address,
        requested_mode: payload.requested_mode,
        payment_id: authorizedPayment?.id || null,
        fare_estimate: estimate.estimated_total
      }
    });

    let selectedDriver = null;
    let dispatch = null;
    let mission = null;
    let preview = null;

    try {
      selectedDriver = await selectCandidateDriver(payload.requested_mode);

      if (selectedDriver) {
        const offer = await createDispatchOfferForDriver({
          ride,
          rider,
          driver: selectedDriver,
          requested_mode: payload.requested_mode
        });

        dispatch = offer.dispatch;
        mission = offer.mission;
        preview = offer.preview;
      } else {
        await dbUpdate(
          TABLES.rides,
          { id: ride.id },
          {
            status: "no_driver_available",
            updated_at: nowIso()
          },
          { select: false }
        );

        await writeTripEvent({
          ride_id: ride.id,
          rider_id: rider.id,
          event_type: "dispatch_failed",
          event_payload: {
            reason: "no_driver_available"
          }
        });
      }
    } catch (dispatchError) {
      console.warn("Dispatch creation warning:", dispatchError.message);
    }

    const freshRide = await getRideById(ride.id);

    return ok(
      res,
      {
        ride: buildRidePublicRecord(freshRide || ride),
        dispatch: buildDispatchPublicRecord(dispatch),
        mission: buildMissionPublicRecord(mission),
        driver_mission_preview: preview
      },
      selectedDriver
        ? "Ride request created and driver offer sent."
        : "Ride request created, but no driver is currently available.",
      201
    );
  })
);

/* =========================================================
   RIDE LOOKUP
========================================================= */
app.get("/api/rides/:rideId", asyncHandler(async (req, res) => {
  const ride = await getRideById(req.params.rideId);

  if (!ride) {
    return fail(res, "Ride not found.", 404);
  }

  const latestDispatch = await getLatestDispatchForRide(ride.id);

  return ok(
    res,
    {
      ride: buildRidePublicRecord(ride),
      latest_dispatch: buildDispatchPublicRecord(latestDispatch)
    },
    "Ride loaded."
  );
}));

app.get("/api/riders/:riderId/rides", asyncHandler(async (req, res) => {
  const riderId = clean(req.params.riderId);
  const rides = await getRidesForRider(riderId);

  return ok(
    res,
    {
      rides: rides.map(buildRidePublicRecord)
    },
    "Rider rides loaded."
  );
}));

/* =========================================================
   DRIVER MISSION INBOX
========================================================= */
app.get(
  "/api/drivers/:driverId/missions",
  async (req, res, next) => {
    req.query.driver_id = req.params.driverId;
    return requireExistingDriverRecord(req, res, next);
  },
  requireMissionReadyDriver,
  asyncHandler(async (req, res) => {
    const driver = req.driver;

    const missions = await getOpenMissionsForDriver(driver.id);
    const dispatches = await getOpenDispatchesForDriver(driver.id);

    const visibleMissionStatuses = ["offered", "accepted"];
    const visibleDispatchStatuses = ["offered", "accepted"];

    return ok(
      res,
      {
        driver_id: driver.id,
        missions: missions
          .filter((mission) =>
            visibleMissionStatuses.includes(normalizeMissionStatus(mission.status))
          )
          .map(buildMissionPublicRecord),
        dispatches: dispatches
          .filter((dispatch) =>
            visibleDispatchStatuses.includes(normalizeDispatchStatus(dispatch.status))
          )
          .map(buildDispatchPublicRecord)
      },
      "Driver missions loaded."
    );
  })
);

app.get(
  "/api/drivers/:driverId/current-ride",
  async (req, res, next) => {
    req.query.driver_id = req.params.driverId;
    return requireExistingDriverRecord(req, res, next);
  },
  requireMissionReadyDriver,
  asyncHandler(async (req, res) => {
    const driver = req.driver;
    const rides = await getRidesForDriver(driver.id);

    const currentRide =
      rides.find((ride) =>
        ["dispatched", "driver_en_route", "arrived", "in_progress"].includes(
          normalizeRideStatus(ride.status)
        )
      ) || null;

    return ok(
      res,
      {
        ride: buildRidePublicRecord(currentRide)
      },
      currentRide
        ? "Current driver ride loaded."
        : "No active ride for this driver."
    );
  })
);

/* =========================================================
   DRIVER ACCEPT MISSION
========================================================= */
app.post(
  "/api/missions/:missionId/accept",
  requireExistingDriverRecord,
  requireMissionReadyDriver,
  asyncHandler(async (req, res) => {
    const driver = req.driver;
    const missionId = clean(req.params.missionId);

    const mission = await getMissionById(missionId);
    if (!mission) {
      return fail(res, "Mission not found.", 404);
    }

    if (clean(mission.driver_id) !== clean(driver.id)) {
      return fail(res, "This mission does not belong to this driver.", 403);
    }

    const dispatch =
      await getDispatchById(
        clean(
          req.body?.dispatch_id ||
            req.body?.dispatchId ||
            ""
        )
      ) ||
      await dbSelectOne(TABLES.dispatches, { mission_id: mission.id });

    const ride = await getRideById(mission.ride_id);
    if (!ride) {
      return fail(res, "Ride not found for this mission.", 404);
    }

    const missionStatus = normalizeMissionStatus(mission.status);
    if (missionStatus !== "offered") {
      return fail(
        res,
        "Mission is no longer available to accept.",
        409,
        {
          mission_status: missionStatus
        }
      );
    }

    if (mission.expires_at && new Date(mission.expires_at).getTime() < Date.now()) {
      await dbUpdate(
        TABLES.missions,
        { id: mission.id },
        {
          status: "expired",
          updated_at: nowIso()
        },
        { select: false }
      );

      if (dispatch) {
        await dbUpdate(
          TABLES.dispatches,
          { id: dispatch.id },
          {
            status: "expired",
            responded_at: nowIso(),
            updated_at: nowIso()
          },
          { select: false }
        );
      }

      await writeTripEvent({
        ride_id: ride.id,
        rider_id: ride.rider_id,
        driver_id: driver.id,
        event_type: "dispatch_expired",
        event_payload: {
          mission_id: mission.id,
          dispatch_id: dispatch?.id || null
        }
      });

      return fail(res, "Mission offer has expired.", 409);
    }

    await dbUpdate(
      TABLES.missions,
      { id: mission.id },
      {
        status: "accepted",
        accepted_at: nowIso(),
        updated_at: nowIso()
      },
      { select: false }
    );

    if (dispatch) {
      await dbUpdate(
        TABLES.dispatches,
        { id: dispatch.id },
        {
          status: "accepted",
          responded_at: nowIso(),
          updated_at: nowIso()
        },
        { select: false }
      );
    }

    await dbUpdate(
      TABLES.rides,
      { id: ride.id },
      {
        driver_id: driver.id,
        status: "dispatched",
        assigned_at: nowIso(),
        updated_at: nowIso()
      },
      { select: false }
    );

    await dbUpdate(
      TABLES.drivers,
      { id: driver.id },
      {
        status: "busy",
        updated_at: nowIso()
      },
      { select: false }
    );

    await writeTripEvent({
      ride_id: ride.id,
      rider_id: ride.rider_id,
      driver_id: driver.id,
      event_type: "driver_accepted_mission",
      event_payload: {
        mission_id: mission.id,
        dispatch_id: dispatch?.id || null
      }
    });

    const updatedMission = await getMissionById(mission.id);
    const updatedRide = await getRideById(ride.id);
    const updatedDispatch = dispatch ? await getDispatchById(dispatch.id) : null;

    return ok(
      res,
      {
        mission: buildMissionPublicRecord(updatedMission),
        ride: buildRidePublicRecord(updatedRide),
        dispatch: buildDispatchPublicRecord(updatedDispatch)
      },
      "Mission accepted successfully."
    );
  })
);

/* =========================================================
   DRIVER DECLINE MISSION
========================================================= */
app.post(
  "/api/missions/:missionId/decline",
  requireExistingDriverRecord,
  requireMissionReadyDriver,
  asyncHandler(async (req, res) => {
    const driver = req.driver;
    const missionId = clean(req.params.missionId);
    const reason = clean(req.body?.reason || "Driver declined mission.");

    const mission = await getMissionById(missionId);
    if (!mission) {
      return fail(res, "Mission not found.", 404);
    }

    if (clean(mission.driver_id) !== clean(driver.id)) {
      return fail(res, "This mission does not belong to this driver.", 403);
    }

    const dispatch =
      await getDispatchById(
        clean(
          req.body?.dispatch_id ||
            req.body?.dispatchId ||
            ""
        )
      ) ||
      await dbSelectOne(TABLES.dispatches, { mission_id: mission.id });

    const ride = await getRideById(mission.ride_id);
    if (!ride) {
      return fail(res, "Ride not found for this mission.", 404);
    }

    await dbUpdate(
      TABLES.missions,
      { id: mission.id },
      {
        status: "declined",
        declined_at: nowIso(),
        decline_reason: reason,
        updated_at: nowIso()
      },
      { select: false }
    );

    if (dispatch) {
      await dbUpdate(
        TABLES.dispatches,
        { id: dispatch.id },
        {
          status: "declined",
          responded_at: nowIso(),
          decline_reason: reason,
          updated_at: nowIso()
        },
        { select: false }
      );
    }

    await dbUpdate(
      TABLES.rides,
      { id: ride.id },
      {
        status: "searching",
        updated_at: nowIso()
      },
      { select: false }
    );

    await dbUpdate(
      TABLES.drivers,
      { id: driver.id },
      {
        status: "available",
        updated_at: nowIso()
      },
      { select: false }
    );

    await writeTripEvent({
      ride_id: ride.id,
      rider_id: ride.rider_id,
      driver_id: driver.id,
      event_type: "driver_declined_mission",
      event_payload: {
        mission_id: mission.id,
        dispatch_id: dispatch?.id || null,
        reason
      }
    });

    const updatedMission = await getMissionById(mission.id);
    const updatedRide = await getRideById(ride.id);
    const updatedDispatch = dispatch ? await getDispatchById(dispatch.id) : null;

    return ok(
      res,
      {
        mission: buildMissionPublicRecord(updatedMission),
        ride: buildRidePublicRecord(updatedRide),
        dispatch: buildDispatchPublicRecord(updatedDispatch)
      },
      "Mission declined successfully."
    );
  })
);

/* =========================================================
   ADMIN MANUAL DRIVER OFFER
========================================================= */
app.post(
  "/api/admin/rides/:rideId/offer-driver",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const rideId = clean(req.params.rideId);
    const driverId = clean(req.body?.driver_id || req.body?.driverId);

    if (!driverId) {
      return fail(res, "Driver ID is required.", 400);
    }

    const ride = await getRideById(rideId);
    if (!ride) {
      return fail(res, "Ride not found.", 404);
    }

    const rider = await getRiderById(ride.rider_id);
    const driver = await getDriverById(driverId);

    if (!driver) {
      return fail(res, "Driver not found.", 404);
    }

    if (!canDriverReceiveOfferNow(driver)) {
      return fail(
        res,
        "Driver is not currently eligible to receive a mission.",
        409,
        {
          driver: buildDriverPublicProfile(driver)
        }
      );
    }

    const offer = await createDispatchOfferForDriver({
      ride,
      rider,
      driver,
      requested_mode: ride.requested_mode
    });

    await writeAdminLog({
      action: "manual_driver_offer_created",
      actor_email: getAdminCredentials(req).email,
      target_type: "ride",
      target_id: ride.id,
      details: {
        driver_id: driver.id,
        dispatch_id: offer.dispatch.id,
        mission_id: offer.mission.id
      }
    });

    return ok(
      res,
      {
        ride: buildRidePublicRecord(await getRideById(ride.id)),
        dispatch: buildDispatchPublicRecord(offer.dispatch),
        mission: buildMissionPublicRecord(offer.mission),
        driver_mission_preview: offer.preview
      },
      "Manual driver offer created."
    );
  })
);

/* =========================================================
   PART 3 END
========================================================= *//* =========================================================
   HARVEY TAXI — CODE BLUE CLEAN REBUILD
   PART 4: DISPATCH SWEEPER + AUTO REDISPATCH + RIDE LIFECYCLE
========================================================= */

/* =========================================================
   LIFECYCLE HELPERS
========================================================= */
async function getLatestMissionForRide(rideId = "") {
  if (!clean(rideId)) return null;

  return dbSelectOne(
    TABLES.missions,
    { ride_id: clean(rideId) },
    {
      orderBy: { column: "created_at", ascending: false }
    }
  );
}

async function getDispatchesForRide(rideId = "") {
  if (!clean(rideId)) return [];

  return dbSelectMany(
    TABLES.dispatches,
    { ride_id: clean(rideId) },
    {
      orderBy: { column: "created_at", ascending: false },
      limit: 100
    }
  );
}

async function getMissionsForRide(rideId = "") {
  if (!clean(rideId)) return [];

  return dbSelectMany(
    TABLES.missions,
    { ride_id: clean(rideId) },
    {
      orderBy: { column: "created_at", ascending: false },
      limit: 100
    }
  );
}

async function getTripEventsForRide(rideId = "") {
  if (!clean(rideId)) return [];

  return dbSelectMany(
    TABLES.trip_events,
    { ride_id: clean(rideId) },
    {
      orderBy: { column: "created_at", ascending: false },
      limit: 250
    }
  );
}

async function markDriverAvailability(driverId = "", nextStatus = "available") {
  if (!clean(driverId)) return null;

  const allowedStatuses = ["available", "busy", "on_trip", "offline"];
  const status = allowedStatuses.includes(lower(nextStatus))
    ? lower(nextStatus)
    : "available";

  await dbUpdate(
    TABLES.drivers,
    { id: clean(driverId) },
    {
      status,
      updated_at: nowIso()
    },
    { select: false }
  );

  return true;
}

function requireAssignedDriverMatch(ride, driverId = "") {
  return Boolean(
    clean(ride?.driver_id) &&
      clean(ride.driver_id) === clean(driverId)
  );
}

function canDriverBeRedispatched(driver) {
  if (!driver) return false;
  if (!driverCanReceiveMissions(driver)) return false;

  const status = normalizeDriverStatus(driver.status);
  if (["offline", "busy", "rejected"].includes(status)) {
    return false;
  }

  return true;
}

async function getCandidateDriverExcluding({
  requestedMode = "driver",
  excludedDriverIds = []
}) {
  const desiredType =
    lower(requestedMode || "driver") === "autonomous" ? "autonomous" : "human";

  const excluded = new Set(
    (excludedDriverIds || []).map((value) => clean(value)).filter(Boolean)
  );

  const allDrivers = await dbSelectMany(
    TABLES.drivers,
    {},
    {
      orderBy: { column: "created_at", ascending: true },
      limit: 250
    }
  );

  const candidate = allDrivers.find((driver) => {
    const driverType = normalizeDriverType(driver.driver_type);
    return (
      driverType === desiredType &&
      !excluded.has(clean(driver.id)) &&
      canDriverBeRedispatched(driver)
    );
  });

  return candidate || null;
}

async function updateRideLifecycle({
  ride,
  driver,
  nextStatus,
  eventType,
  eventPayload = {},
  driverStatus = null,
  extraRideUpdates = {}
}) {
  if (!ride) {
    throw new Error("Ride is required.");
  }

  const updates = {
    status: nextStatus,
    updated_at: nowIso(),
    ...extraRideUpdates
  };

  await dbUpdate(
    TABLES.rides,
    { id: ride.id },
    updates,
    { select: false }
  );

  if (driver && driverStatus) {
    await markDriverAvailability(driver.id, driverStatus);
  }

  await writeTripEvent({
    ride_id: ride.id,
    rider_id: ride.rider_id,
    driver_id: driver?.id || ride.driver_id || "",
    event_type: eventType,
    event_payload: eventPayload
  });

  return getRideById(ride.id);
}

async function expireDispatchAndMission({
  dispatch,
  mission,
  ride,
  reason = "dispatch_expired"
}) {
  if (dispatch && normalizeDispatchStatus(dispatch.status) === "offered") {
    await dbUpdate(
      TABLES.dispatches,
      { id: dispatch.id },
      {
        status: "expired",
        responded_at: nowIso(),
        updated_at: nowIso()
      },
      { select: false }
    );
  }

  if (mission && normalizeMissionStatus(mission.status) === "offered") {
    await dbUpdate(
      TABLES.missions,
      { id: mission.id },
      {
        status: "expired",
        updated_at: nowIso()
      },
      { select: false }
    );
  }

  if (ride) {
    await dbUpdate(
      TABLES.rides,
      { id: ride.id },
      {
        status: "searching",
        updated_at: nowIso()
      },
      { select: false }
    );

    await writeTripEvent({
      ride_id: ride.id,
      rider_id: ride.rider_id,
      driver_id: dispatch?.driver_id || mission?.driver_id || "",
      event_type: "dispatch_expired",
      event_payload: {
        reason,
        dispatch_id: dispatch?.id || null,
        mission_id: mission?.id || null
      }
    });
  }

  return true;
}

async function attemptRedispatchForRide(rideId = "", reason = "redispatch_requested") {
  const ride = await getRideById(rideId);

  if (!ride) {
    return {
      ok: false,
      reason: "ride_not_found"
    };
  }

  const rideStatus = normalizeRideStatus(ride.status);
  if (["completed", "cancelled", "in_progress"].includes(rideStatus)) {
    return {
      ok: false,
      reason: `ride_not_eligible_${rideStatus}`
    };
  }

  const rider = await getRiderById(ride.rider_id);
  if (!rider) {
    return {
      ok: false,
      reason: "rider_not_found"
    };
  }

  const pastDispatches = await getDispatchesForRide(ride.id);
  const excludedDriverIds = pastDispatches
    .map((dispatch) => clean(dispatch.driver_id))
    .filter(Boolean);

  const currentAttempts = parseInteger(ride.dispatch_attempts, 0);

  if (currentAttempts >= MAX_DISPATCH_ATTEMPTS) {
    await dbUpdate(
      TABLES.rides,
      { id: ride.id },
      {
        status: "no_driver_available",
        updated_at: nowIso()
      },
      { select: false }
    );

    await writeTripEvent({
      ride_id: ride.id,
      rider_id: ride.rider_id,
      event_type: "dispatch_failed",
      event_payload: {
        reason: "max_dispatch_attempts_reached",
        dispatch_attempts: currentAttempts
      }
    });

    return {
      ok: false,
      reason: "max_dispatch_attempts_reached"
    };
  }

  const nextDriver = await getCandidateDriverExcluding({
    requestedMode: ride.requested_mode,
    excludedDriverIds
  });

  if (!nextDriver) {
    await dbUpdate(
      TABLES.rides,
      { id: ride.id },
      {
        status: "no_driver_available",
        updated_at: nowIso()
      },
      { select: false }
    );

    await writeTripEvent({
      ride_id: ride.id,
      rider_id: ride.rider_id,
      event_type: "dispatch_failed",
      event_payload: {
        reason: "no_additional_driver_available",
        dispatch_attempts: currentAttempts
      }
    });

    return {
      ok: false,
      reason: "no_additional_driver_available"
    };
  }

  const offer = await createDispatchOfferForDriver({
    ride,
    rider,
    driver: nextDriver,
    requested_mode: ride.requested_mode
  });

  await writeTripEvent({
    ride_id: ride.id,
    rider_id: ride.rider_id,
    driver_id: nextDriver.id,
    event_type: "redispatch_created",
    event_payload: {
      reason,
      dispatch_id: offer.dispatch.id,
      mission_id: offer.mission.id,
      dispatch_attempts_before: currentAttempts
    }
  });

  return {
    ok: true,
    reason: "redispatch_created",
    dispatch: offer.dispatch,
    mission: offer.mission,
    driver_id: nextDriver.id
  };
}

/* =========================================================
   DISPATCH EXPIRY SWEEPER
========================================================= */
let dispatchSweepRunning = false;

async function runDispatchSweep() {
  if (!supabase) return;
  if (!ENABLE_AUTO_REDISPATCH) return;
  if (dispatchSweepRunning) return;

  dispatchSweepRunning = true;

  try {
    const openDispatches = await dbSelectMany(
      TABLES.dispatches,
      {},
      {
        orderBy: { column: "created_at", ascending: true },
        limit: 250
      }
    );

    const offeredDispatches = openDispatches.filter((dispatch) => {
      if (normalizeDispatchStatus(dispatch.status) !== "offered") return false;
      if (!dispatch.expires_at) return false;
      return new Date(dispatch.expires_at).getTime() <= Date.now();
    });

    for (const dispatch of offeredDispatches) {
      try {
        const ride = await getRideById(dispatch.ride_id);
        const mission =
          dispatch.mission_id
            ? await getMissionById(dispatch.mission_id)
            : null;

        if (!ride) continue;

        const rideStatus = normalizeRideStatus(ride.status);
        if (
          ["completed", "cancelled", "in_progress", "driver_en_route", "arrived"].includes(
            rideStatus
          )
        ) {
          continue;
        }

        await expireDispatchAndMission({
          dispatch,
          mission,
          ride,
          reason: "offer_timeout"
        });

        await attemptRedispatchForRide(ride.id, "offer_timeout");
      } catch (innerError) {
        console.warn("Dispatch sweep item warning:", innerError.message);
      }
    }
  } catch (error) {
    console.warn("Dispatch sweep warning:", error.message);
  } finally {
    dispatchSweepRunning = false;
  }
}

/* =========================================================
   RIDE TIMELINE / DETAIL
========================================================= */
app.get("/api/rides/:rideId/timeline", asyncHandler(async (req, res) => {
  const rideId = clean(req.params.rideId);
  const ride = await getRideById(rideId);

  if (!ride) {
    return fail(res, "Ride not found.", 404);
  }

  const events = await getTripEventsForRide(ride.id);

  return ok(
    res,
    {
      ride: buildRidePublicRecord(ride),
      timeline: events.map(buildTimelineEvent)
    },
    "Ride timeline loaded."
  );
}));

app.get("/api/rides/:rideId/detail", asyncHandler(async (req, res) => {
  const rideId = clean(req.params.rideId);
  const ride = await getRideById(rideId);

  if (!ride) {
    return fail(res, "Ride not found.", 404);
  }

  const dispatches = await getDispatchesForRide(ride.id);
  const missions = await getMissionsForRide(ride.id);
  const events = await getTripEventsForRide(ride.id);

  return ok(
    res,
    {
      ride: buildRidePublicRecord(ride),
      dispatches: dispatches.map(buildDispatchPublicRecord),
      missions: missions.map(buildMissionPublicRecord),
      timeline: events.map(buildTimelineEvent)
    },
    "Ride detail loaded."
  );
}));

/* =========================================================
   DRIVER EN ROUTE
========================================================= */
app.post(
  "/api/rides/:rideId/driver-en-route",
  requireExistingDriverRecord,
  requireMissionReadyDriver,
  asyncHandler(async (req, res) => {
    const driver = req.driver;
    const ride = await getRideById(req.params.rideId);

    if (!ride) {
      return fail(res, "Ride not found.", 404);
    }

    if (!requireAssignedDriverMatch(ride, driver.id)) {
      return fail(res, "This ride is not assigned to this driver.", 403);
    }

    const currentStatus = normalizeRideStatus(ride.status);
    if (!["dispatched", "driver_en_route"].includes(currentStatus)) {
      return fail(
        res,
        "Ride is not in a valid state for en route update.",
        409,
        { ride_status: currentStatus }
      );
    }

    const updatedRide = await updateRideLifecycle({
      ride,
      driver,
      nextStatus: "driver_en_route",
      eventType: "driver_en_route",
      eventPayload: {
        driver_id: driver.id
      },
      driverStatus: "busy"
    });

    return ok(
      res,
      {
        ride: buildRidePublicRecord(updatedRide)
      },
      "Driver marked as en route."
    );
  })
);

/* =========================================================
   DRIVER ARRIVED
========================================================= */
app.post(
  "/api/rides/:rideId/arrived",
  requireExistingDriverRecord,
  requireMissionReadyDriver,
  asyncHandler(async (req, res) => {
    const driver = req.driver;
    const ride = await getRideById(req.params.rideId);

    if (!ride) {
      return fail(res, "Ride not found.", 404);
    }

    if (!requireAssignedDriverMatch(ride, driver.id)) {
      return fail(res, "This ride is not assigned to this driver.", 403);
    }

    const currentStatus = normalizeRideStatus(ride.status);
    if (!["dispatched", "driver_en_route", "arrived"].includes(currentStatus)) {
      return fail(
        res,
        "Ride is not in a valid state for arrival.",
        409,
        { ride_status: currentStatus }
      );
    }

    const updatedRide = await updateRideLifecycle({
      ride,
      driver,
      nextStatus: "arrived",
      eventType: "driver_arrived",
      eventPayload: {
        driver_id: driver.id
      },
      driverStatus: "busy"
    });

    return ok(
      res,
      {
        ride: buildRidePublicRecord(updatedRide)
      },
      "Driver marked as arrived."
    );
  })
);

/* =========================================================
   START RIDE
========================================================= */
app.post(
  "/api/rides/:rideId/start",
  requireExistingDriverRecord,
  requireMissionReadyDriver,
  asyncHandler(async (req, res) => {
    const driver = req.driver;
    const ride = await getRideById(req.params.rideId);

    if (!ride) {
      return fail(res, "Ride not found.", 404);
    }

    if (!requireAssignedDriverMatch(ride, driver.id)) {
      return fail(res, "This ride is not assigned to this driver.", 403);
    }

    const currentStatus = normalizeRideStatus(ride.status);
    if (!["arrived", "driver_en_route", "in_progress"].includes(currentStatus)) {
      return fail(
        res,
        "Ride is not in a valid state to start.",
        409,
        { ride_status: currentStatus }
      );
    }

    const updatedRide = await updateRideLifecycle({
      ride,
      driver,
      nextStatus: "in_progress",
      eventType: "ride_started",
      eventPayload: {
        driver_id: driver.id
      },
      driverStatus: "on_trip",
      extraRideUpdates: {
        started_at: ride.started_at || nowIso()
      }
    });

    return ok(
      res,
      {
        ride: buildRidePublicRecord(updatedRide)
      },
      "Ride started successfully."
    );
  })
);

/* =========================================================
   COMPLETE RIDE
========================================================= */
app.post(
  "/api/rides/:rideId/complete",
  requireExistingDriverRecord,
  requireMissionReadyDriver,
  asyncHandler(async (req, res) => {
    const driver = req.driver;
    const ride = await getRideById(req.params.rideId);

    if (!ride) {
      return fail(res, "Ride not found.", 404);
    }

    if (!requireAssignedDriverMatch(ride, driver.id)) {
      return fail(res, "This ride is not assigned to this driver.", 403);
    }

    const currentStatus = normalizeRideStatus(ride.status);
    if (!["in_progress", "arrived", "driver_en_route"].includes(currentStatus)) {
      return fail(
        res,
        "Ride is not in a valid state to complete.",
        409,
        { ride_status: currentStatus }
      );
    }

    const updatedRide = await updateRideLifecycle({
      ride,
      driver,
      nextStatus: "completed",
      eventType: "ride_completed",
      eventPayload: {
        driver_id: driver.id,
        completed_by: "driver"
      },
      driverStatus: "available",
      extraRideUpdates: {
        completed_at: nowIso()
      }
    });

    await dbUpdate(
      TABLES.missions,
      { ride_id: ride.id, driver_id: driver.id },
      {
        status: "completed",
        updated_at: nowIso()
      },
      { select: false }
    );

    const paymentId = clean(ride.payment_id || "");
    if (paymentId) {
      try {
        await dbUpdate(
          TABLES.payments,
          { id: paymentId },
          {
            status: "captured",
            payment_status: "captured",
            updated_at: nowIso()
          },
          { select: false }
        );

        await writeTripEvent({
          ride_id: ride.id,
          rider_id: ride.rider_id,
          driver_id: driver.id,
          event_type: "payment_captured_on_ride_complete",
          event_payload: {
            payment_id: paymentId
          }
        });
      } catch (paymentCaptureError) {
        console.warn("Payment capture on complete warning:", paymentCaptureError.message);
      }
    }

    return ok(
      res,
      {
        ride: buildRidePublicRecord(updatedRide)
      },
      "Ride completed successfully."
    );
  })
);

/* =========================================================
   RIDER CANCEL RIDE
========================================================= */
app.post(
  "/api/rides/:rideId/cancel-by-rider",
  requireExistingRiderRecord,
  asyncHandler(async (req, res) => {
    const rider = req.rider;
    const ride = await getRideById(req.params.rideId);
    const reason = clean(req.body?.reason || "Cancelled by rider.");

    if (!ride) {
      return fail(res, "Ride not found.", 404);
    }

    if (clean(ride.rider_id) !== clean(rider.id)) {
      return fail(res, "This ride does not belong to this rider.", 403);
    }

    const currentStatus = normalizeRideStatus(ride.status);
    if (["completed", "cancelled"].includes(currentStatus)) {
      return fail(
        res,
        "Ride can no longer be cancelled.",
        409,
        { ride_status: currentStatus }
      );
    }

    await dbUpdate(
      TABLES.rides,
      { id: ride.id },
      {
        status: "cancelled",
        cancelled_at: nowIso(),
        cancellation_reason: reason,
        updated_at: nowIso()
      },
      { select: false }
    );

    await dbUpdate(
      TABLES.dispatches,
      { ride_id: ride.id },
      {
        status: "cancelled",
        updated_at: nowIso()
      },
      { select: false }
    );

    await dbUpdate(
      TABLES.missions,
      { ride_id: ride.id },
      {
        status: "cancelled",
        updated_at: nowIso()
      },
      { select: false }
    );

    if (clean(ride.driver_id)) {
      await markDriverAvailability(ride.driver_id, "available");
    }

    const paymentId = clean(ride.payment_id || "");
    if (paymentId) {
      try {
        await dbUpdate(
          TABLES.payments,
          { id: paymentId },
          {
            status: "voided",
            payment_status: "voided",
            updated_at: nowIso()
          },
          { select: false }
        );
      } catch (paymentVoidError) {
        console.warn("Payment void on rider cancel warning:", paymentVoidError.message);
      }
    }

    await writeTripEvent({
      ride_id: ride.id,
      rider_id: rider.id,
      driver_id: ride.driver_id || "",
      event_type: "ride_cancelled_by_rider",
      event_payload: {
        reason
      }
    });

    const updatedRide = await getRideById(ride.id);

    return ok(
      res,
      {
        ride: buildRidePublicRecord(updatedRide)
      },
      "Ride cancelled by rider."
    );
  })
);

/* =========================================================
   DRIVER CANCEL RIDE
========================================================= */
app.post(
  "/api/rides/:rideId/cancel-by-driver",
  requireExistingDriverRecord,
  requireMissionReadyDriver,
  asyncHandler(async (req, res) => {
    const driver = req.driver;
    const ride = await getRideById(req.params.rideId);
    const reason = clean(req.body?.reason || "Cancelled by driver.");

    if (!ride) {
      return fail(res, "Ride not found.", 404);
    }

    if (!requireAssignedDriverMatch(ride, driver.id)) {
      return fail(res, "This ride is not assigned to this driver.", 403);
    }

    const currentStatus = normalizeRideStatus(ride.status);
    if (["completed", "cancelled"].includes(currentStatus)) {
      return fail(
        res,
        "Ride can no longer be cancelled.",
        409,
        { ride_status: currentStatus }
      );
    }

    await dbUpdate(
      TABLES.rides,
      { id: ride.id },
      {
        driver_id: null,
        status: "searching",
        updated_at: nowIso()
      },
      { select: false }
    );

    await dbUpdate(
      TABLES.dispatches,
      { ride_id: ride.id, driver_id: driver.id },
      {
        status: "cancelled",
        responded_at: nowIso(),
        cancel_reason: reason,
        updated_at: nowIso()
      },
      { select: false }
    );

    await dbUpdate(
      TABLES.missions,
      { ride_id: ride.id, driver_id: driver.id },
      {
        status: "cancelled",
        cancel_reason: reason,
        updated_at: nowIso()
      },
      { select: false }
    );

    await markDriverAvailability(driver.id, "available");

    await writeTripEvent({
      ride_id: ride.id,
      rider_id: ride.rider_id,
      driver_id: driver.id,
      event_type: "ride_cancelled_by_driver",
      event_payload: {
        reason
      }
    });

    if (ENABLE_AUTO_REDISPATCH) {
      await attemptRedispatchForRide(ride.id, "driver_cancelled");
    }

    const updatedRide = await getRideById(ride.id);

    return ok(
      res,
      {
        ride: buildRidePublicRecord(updatedRide)
      },
      "Ride released by driver."
    );
  })
);

/* =========================================================
   ADMIN MANUAL REDISPATCH
========================================================= */
app.post(
  "/api/admin/rides/:rideId/redispatch",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const rideId = clean(req.params.rideId);
    const result = await attemptRedispatchForRide(
      rideId,
      "admin_manual_redispatch"
    );

    await writeAdminLog({
      action: "admin_manual_redispatch",
      actor_email: getAdminCredentials(req).email,
      target_type: "ride",
      target_id: rideId,
      details: result
    });

    if (!result.ok) {
      return fail(res, "Redispatch could not be created.", 409, result);
    }

    return ok(
      res,
      {
        result
      },
      "Redispatch created successfully."
    );
  })
);

/* =========================================================
   ADMIN SWEEP NOW
========================================================= */
app.post(
  "/api/admin/dispatch/sweep",
  requireAdmin,
  asyncHandler(async (req, res) => {
    await runDispatchSweep();

    await writeAdminLog({
      action: "admin_dispatch_sweep_run",
      actor_email: getAdminCredentials(req).email,
      target_type: "dispatch_system",
      target_id: "global",
      details: {
        ran_at: nowIso()
      }
    });

    return ok(res, {}, "Dispatch sweep executed.");
  })
);

/* =========================================================
   BACKGROUND DISPATCH SWEEPER
========================================================= */
if (ENABLE_AUTO_REDISPATCH) {
  setInterval(() => {
    runDispatchSweep().catch((error) => {
      console.warn("Background dispatch sweep error:", error.message);
    });
  }, DISPATCH_SWEEP_INTERVAL_MS);
}

/* =========================================================
   PART 4 END
========================================================= *//* =========================================================
   HARVEY TAXI — CODE BLUE CLEAN REBUILD
   PART 5: DRIVERS + VERIFICATION + APPROVAL + EARNINGS
========================================================= */

/* =========================================================
   DRIVER HELPERS
========================================================= */
function buildDriverSignupPayload(body = {}) {
  const first_name = pickFirst(body.first_name, body.firstName);
  const last_name = pickFirst(body.last_name, body.lastName);
  const email = normalizeEmail(body.email);
  const phone = normalizePhone(body.phone);
  const city = pickFirst(body.city);
  const state = upper(pickFirst(body.state, body.stateValue, "TN"));
  const password = clean(body.password);

  const driver_type = normalizeDriverType(
    pickFirst(body.driver_type, body.driverType, "human")
  );

  const vehicle_make = pickFirst(body.vehicle_make, body.vehicleMake);
  const vehicle_model = pickFirst(body.vehicle_model, body.vehicleModel);
  const vehicle_color = pickFirst(body.vehicle_color, body.vehicleColor);
  const vehicle_plate = upper(pickFirst(body.vehicle_plate, body.vehiclePlate));
  const license_number = clean(
    body.license_number || body.licenseNumber || ""
  );

  const persona_inquiry_id = clean(
    body.persona_inquiry_id || body.personaInquiryId || ""
  );

  const background_check_id = clean(
    body.background_check_id || body.backgroundCheckId || ""
  );

  return {
    first_name,
    last_name,
    email,
    phone,
    city,
    state,
    password,
    driver_type,
    vehicle_make,
    vehicle_model,
    vehicle_color,
    vehicle_plate,
    license_number,
    persona_inquiry_id,
    background_check_id
  };
}

function validateDriverSignupInput(payload = {}) {
  if (!payload.first_name) return "First name is required.";
  if (!payload.last_name) return "Last name is required.";
  if (!payload.email) return "Email is required.";
  if (!payload.phone) return "Phone is required.";
  if (!payload.city) return "City is required.";
  if (!payload.state) return "State is required.";
  if (!payload.password || payload.password.length < 8) {
    return "Password must be at least 8 characters.";
  }
  return "";
}

async function ensureUniqueDriverIdentity({ email = "", phone = "" }) {
  const existingByEmail = await getDriverByEmail(email);
  if (existingByEmail) {
    return {
      ok: false,
      status: 409,
      message: "A driver with this email already exists.",
      extra: {
        driver_id: existingByEmail.id
      }
    };
  }

  const existingByPhone = await getDriverByPhone(phone);
  if (existingByPhone) {
    return {
      ok: false,
      status: 409,
      message: "A driver with this phone already exists.",
      extra: {
        driver_id: existingByPhone.id
      }
    };
  }

  return { ok: true };
}

function buildNewDriverRecord(payload = {}, password_hash = "") {
  return {
    id: createId("driver"),
    first_name: payload.first_name,
    last_name: payload.last_name,
    email: payload.email,
    phone: payload.phone,
    city: payload.city,
    state: payload.state,
    password_hash,
    driver_type: payload.driver_type,
    approval_status: "pending",
    verification_status: ENABLE_PERSONA_ENFORCEMENT ? "pending" : "approved",
    persona_status: ENABLE_PERSONA_ENFORCEMENT ? "pending" : "approved",
    identity_status: ENABLE_PERSONA_ENFORCEMENT ? "pending" : "approved",
    email_verification_status: "pending",
    sms_verification_status: "pending",
    background_check_status: "pending",
    persona_inquiry_id: payload.persona_inquiry_id || null,
    background_check_id: payload.background_check_id || null,
    vehicle_make: payload.vehicle_make || null,
    vehicle_model: payload.vehicle_model || null,
    vehicle_color: payload.vehicle_color || null,
    vehicle_plate: payload.vehicle_plate || null,
    license_number: payload.license_number || null,
    status: "pending",
    created_at: nowIso(),
    updated_at: nowIso()
  };
}

async function getDriverEarnings(driverId = "") {
  if (!clean(driverId)) return [];

  return dbSelectMany(
    TABLES.driver_earnings,
    { driver_id: clean(driverId) },
    {
      orderBy: { column: "created_at", ascending: false },
      limit: 100
    }
  );
}

async function getDriverPayouts(driverId = "") {
  if (!clean(driverId)) return [];

  return dbSelectMany(
    TABLES.driver_payouts,
    { driver_id: clean(driverId) },
    {
      orderBy: { column: "created_at", ascending: false },
      limit: 100
    }
  );
}

/* =========================================================
   DRIVER SIGNUP / LOGIN
========================================================= */
app.post("/api/driver/signup", asyncHandler(async (req, res) => {
  if (!supabase) {
    return fail(res, "Supabase is not configured.", 500);
  }

  const signup = buildDriverSignupPayload(req.body || {});
  const validationError = validateDriverSignupInput(signup);

  if (validationError) {
    return fail(res, validationError, 400);
  }

  const uniqueness = await ensureUniqueDriverIdentity({
    email: signup.email,
    phone: signup.phone
  });

  if (!uniqueness.ok) {
    return fail(res, uniqueness.message, uniqueness.status, uniqueness.extra);
  }

  const password_hash = await hashPassword(signup.password);
  const driver = await dbInsert(
    TABLES.drivers,
    buildNewDriverRecord(signup, password_hash)
  );

  await writeAdminLog({
    action: "driver_signup_created",
    actor_email: normalizeEmail(driver.email),
    target_type: "driver",
    target_id: driver.id,
    details: {
      driver_type: driver.driver_type,
      city: driver.city,
      state: driver.state
    }
  });

  await writeTripEvent({
    driver_id: driver.id,
    event_type: "driver_signup_created",
    event_payload: {
      email: driver.email,
      phone: driver.phone,
      driver_type: driver.driver_type,
      city: driver.city,
      state: driver.state
    }
  });

  return ok(
    res,
    {
      driver: buildDriverPublicProfile(driver),
      next_step:
        "Complete email verification, SMS verification, and admin approval before accepting missions."
    },
    "Driver signup submitted successfully.",
    201
  );
}));

app.post("/api/driver/login", asyncHandler(async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const password = clean(req.body?.password);

  if (!email) {
    return fail(res, "Email is required.", 400);
  }

  if (!password) {
    return fail(res, "Password is required.", 400);
  }

  const driver = await getDriverByEmail(email);

  if (!driver) {
    return fail(res, "Invalid email or password.", 401);
  }

  const passwordHash =
    clean(driver.password_hash) ||
    clean(driver.passwordHash);

  if (!passwordHash) {
    return fail(
      res,
      "This driver account is missing a secure password record.",
      409
    );
  }

  const passwordValid = await verifyPassword(password, passwordHash);

  if (!passwordValid) {
    return fail(res, "Invalid email or password.", 401);
  }

  await writeTripEvent({
    driver_id: driver.id,
    event_type: "driver_login_success",
    event_payload: {
      email: driver.email
    }
  });

  return ok(
    res,
    {
      driver: buildDriverPublicProfile(driver),
      can_accept_missions: driverCanReceiveMissions(driver),
      gates: {
        approval_passed:
          normalizeDriverApprovalStatus(driver.approval_status || driver.status) === "approved",
        email_verification_passed:
          normalizeDriverVerificationStatus(driver.email_verification_status) === "approved",
        sms_verification_passed:
          normalizeDriverVerificationStatus(driver.sms_verification_status) === "approved",
        background_check_passed:
          normalizeDriverVerificationStatus(driver.background_check_status) === "approved"
      }
    },
    "Driver login successful."
  );
}));

/* =========================================================
   DRIVER STATUS / PROFILE
========================================================= */
app.get("/api/driver/status", asyncHandler(async (req, res) => {
  const driverId = clean(req.query?.driver_id || req.query?.driverId || "");
  const email = normalizeEmail(req.query?.email || "");
  const phone = normalizePhone(req.query?.phone || "");

  if (!driverId && !email && !phone) {
    return fail(res, "Driver ID, email, or phone is required.", 400);
  }

  let driver = null;

  if (driverId) {
    driver = await getDriverById(driverId);
  } else if (email) {
    driver = await getDriverByEmail(email);
  } else if (phone) {
    driver = await getDriverByPhone(phone);
  }

  if (!driver) {
    return fail(res, "Driver not found.", 404);
  }

  return ok(
    res,
    {
      driver: buildDriverPublicProfile(driver),
      can_accept_missions: driverCanReceiveMissions(driver),
      gates: {
        approval_passed:
          normalizeDriverApprovalStatus(driver.approval_status || driver.status) === "approved",
        email_verification_passed:
          normalizeDriverVerificationStatus(driver.email_verification_status) === "approved",
        sms_verification_passed:
          normalizeDriverVerificationStatus(driver.sms_verification_status) === "approved",
        background_check_passed:
          normalizeDriverVerificationStatus(driver.background_check_status) === "approved"
      }
    },
    "Driver status loaded."
  );
}));

app.get("/api/drivers/:driverId", asyncHandler(async (req, res) => {
  const driver = await getDriverById(req.params.driverId);

  if (!driver) {
    return fail(res, "Driver not found.", 404);
  }

  return ok(
    res,
    {
      driver: buildDriverPublicProfile(driver)
    },
    "Driver profile loaded."
  );
}));

/* =========================================================
   DRIVER EMAIL / SMS VERIFICATION
========================================================= */
app.post("/api/drivers/:driverId/verify-email", asyncHandler(async (req, res) => {
  const driverId = clean(req.params.driverId);
  const driver = await getDriverById(driverId);

  if (!driver) {
    return fail(res, "Driver not found.", 404);
  }

  const rows = await dbUpdate(
    TABLES.drivers,
    { id: driverId },
    {
      email_verification_status: "approved",
      updated_at: nowIso()
    }
  );

  const updated = Array.isArray(rows) ? rows[0] : driver;

  await writeTripEvent({
    driver_id: driverId,
    event_type: "driver_email_verified",
    event_payload: {
      email: driver.email
    }
  });

  return ok(
    res,
    {
      driver: buildDriverPublicProfile(updated)
    },
    "Driver email verified."
  );
}));

app.post("/api/drivers/:driverId/verify-sms", asyncHandler(async (req, res) => {
  const driverId = clean(req.params.driverId);
  const driver = await getDriverById(driverId);

  if (!driver) {
    return fail(res, "Driver not found.", 404);
  }

  const rows = await dbUpdate(
    TABLES.drivers,
    { id: driverId },
    {
      sms_verification_status: "approved",
      updated_at: nowIso()
    }
  );

  const updated = Array.isArray(rows) ? rows[0] : driver;

  await writeTripEvent({
    driver_id: driverId,
    event_type: "driver_sms_verified",
    event_payload: {
      phone: driver.phone
    }
  });

  return ok(
    res,
    {
      driver: buildDriverPublicProfile(updated)
    },
    "Driver SMS verified."
  );
}));

/* =========================================================
   ADMIN DRIVER REVIEW / APPROVAL
========================================================= */
app.get("/api/admin/drivers", requireAdmin, asyncHandler(async (req, res) => {
  const drivers = await dbSelectMany(
    TABLES.drivers,
    {},
    {
      orderBy: { column: "created_at", ascending: false },
      limit: 200
    }
  );

  return ok(
    res,
    {
      drivers: drivers.map(buildDriverPublicProfile)
    },
    "Admin driver list loaded."
  );
}));

app.post("/api/admin/drivers/:driverId/approve", requireAdmin, asyncHandler(async (req, res) => {
  const driverId = clean(req.params.driverId);
  const driver = await getDriverById(driverId);

  if (!driver) {
    return fail(res, "Driver not found.", 404);
  }

  if (ENABLE_PERSONA_ENFORCEMENT) {
    const verificationStatus = normalizeDriverVerificationStatus(
      driver.verification_status ||
      driver.persona_status ||
      driver.identity_status
    );

    if (verificationStatus !== "approved") {
      return fail(
        res,
        "Driver cannot be approved until identity verification is approved.",
        409,
        {
          driver_id: driver.id,
          verification_status: verificationStatus,
          persona_inquiry_id: clean(driver.persona_inquiry_id)
        }
      );
    }
  }

  const rows = await dbUpdate(
    TABLES.drivers,
    { id: driverId },
    {
      approval_status: "approved",
      status: "available",
      updated_at: nowIso()
    }
  );

  const updated = Array.isArray(rows) ? rows[0] : driver;

  await writeAdminLog({
    action: "driver_approved",
    actor_email: getAdminCredentials(req).email,
    target_type: "driver",
    target_id: driverId,
    details: {
      previous_status: driver.approval_status || driver.status || null
    }
  });

  await writeTripEvent({
    driver_id: driverId,
    event_type: "driver_approved",
    event_payload: {
      admin_email: getAdminCredentials(req).email
    }
  });

  return ok(
    res,
    {
      driver: buildDriverPublicProfile(updated)
    },
    "Driver approved successfully."
  );
}));

app.post("/api/admin/drivers/:driverId/reject", requireAdmin, asyncHandler(async (req, res) => {
  const driverId = clean(req.params.driverId);
  const reason = clean(req.body?.reason || "Driver application was not approved.");
  const driver = await getDriverById(driverId);

  if (!driver) {
    return fail(res, "Driver not found.", 404);
  }

  const rows = await dbUpdate(
    TABLES.drivers,
    { id: driverId },
    {
      approval_status: "rejected",
      verification_status: "failed",
      persona_status: "failed",
      identity_status: "failed",
      status: "rejected",
      rejection_reason: reason,
      updated_at: nowIso()
    }
  );

  const updated = Array.isArray(rows) ? rows[0] : driver;

  await writeAdminLog({
    action: "driver_rejected",
    actor_email: getAdminCredentials(req).email,
    target_type: "driver",
    target_id: driverId,
    details: {
      reason
    }
  });

  await writeTripEvent({
    driver_id: driverId,
    event_type: "driver_rejected",
    event_payload: {
      admin_email: getAdminCredentials(req).email,
      reason
    }
  });

  return ok(
    res,
    {
      driver: buildDriverPublicProfile(updated)
    },
    "Driver rejected successfully."
  );
}));

app.post("/api/admin/drivers/:driverId/background-approved", requireAdmin, asyncHandler(async (req, res) => {
  const driverId = clean(req.params.driverId);
  const driver = await getDriverById(driverId);

  if (!driver) {
    return fail(res, "Driver not found.", 404);
  }

  const rows = await dbUpdate(
    TABLES.drivers,
    { id: driverId },
    {
      background_check_status: "approved",
      updated_at: nowIso()
    }
  );

  const updated = Array.isArray(rows) ? rows[0] : driver;

  await writeAdminLog({
    action: "driver_background_check_approved",
    actor_email: getAdminCredentials(req).email,
    target_type: "driver",
    target_id: driverId,
    details: {}
  });

  await writeTripEvent({
    driver_id: driverId,
    event_type: "driver_background_check_approved",
    event_payload: {
      admin_email: getAdminCredentials(req).email
    }
  });

  return ok(
    res,
    {
      driver: buildDriverPublicProfile(updated)
    },
    "Driver background check approved."
  );
}));

app.post("/api/admin/drivers/:driverId/mark-verification-approved", requireAdmin, asyncHandler(async (req, res) => {
  const driverId = clean(req.params.driverId);
  const driver = await getDriverById(driverId);

  if (!driver) {
    return fail(res, "Driver not found.", 404);
  }

  const rows = await dbUpdate(
    TABLES.drivers,
    { id: driverId },
    {
      verification_status: "approved",
      persona_status: "approved",
      identity_status: "approved",
      updated_at: nowIso()
    }
  );

  const updated = Array.isArray(rows) ? rows[0] : driver;

  await writeAdminLog({
    action: "driver_verification_marked_approved",
    actor_email: getAdminCredentials(req).email,
    target_type: "driver",
    target_id: driverId,
    details: {
      persona_inquiry_id: clean(driver.persona_inquiry_id)
    }
  });

  await writeTripEvent({
    driver_id: driverId,
    event_type: "driver_verification_marked_approved",
    event_payload: {
      admin_email: getAdminCredentials(req).email
    }
  });

  return ok(
    res,
    {
      driver: buildDriverPublicProfile(updated)
    },
    "Driver verification marked approved."
  );
}));

app.post("/api/admin/drivers/:driverId/mark-verification-failed", requireAdmin, asyncHandler(async (req, res) => {
  const driverId = clean(req.params.driverId);
  const reason = clean(req.body?.reason || "Verification failed.");
  const driver = await getDriverById(driverId);

  if (!driver) {
    return fail(res, "Driver not found.", 404);
  }

  const rows = await dbUpdate(
    TABLES.drivers,
    { id: driverId },
    {
      verification_status: "failed",
      persona_status: "failed",
      identity_status: "failed",
      rejection_reason: reason,
      updated_at: nowIso()
    }
  );

  const updated = Array.isArray(rows) ? rows[0] : driver;

  await writeAdminLog({
    action: "driver_verification_marked_failed",
    actor_email: getAdminCredentials(req).email,
    target_type: "driver",
    target_id: driverId,
    details: {
      reason,
      persona_inquiry_id: clean(driver.persona_inquiry_id)
    }
  });

  await writeTripEvent({
    driver_id: driverId,
    event_type: "driver_verification_marked_failed",
    event_payload: {
      admin_email: getAdminCredentials(req).email,
      reason
    }
  });

  return ok(
    res,
    {
      driver: buildDriverPublicProfile(updated)
    },
    "Driver verification marked failed."
  );
}));

/* =========================================================
   DRIVER AVAILABILITY
========================================================= */
app.post(
  "/api/drivers/:driverId/set-availability",
  async (req, res, next) => {
    req.body.driver_id = req.params.driverId;
    return requireExistingDriverRecord(req, res, next);
  },
  requireMissionReadyDriver,
  asyncHandler(async (req, res) => {
    const driver = req.driver;
    const requestedStatus = lower(
      req.body?.status || req.body?.availability || "available"
    );

    const allowed = ["available", "offline"];
    if (!allowed.includes(requestedStatus)) {
      return fail(res, "Allowed statuses are available or offline.", 400);
    }

    await markDriverAvailability(driver.id, requestedStatus);
    const updated = await getDriverById(driver.id);

    await writeTripEvent({
      driver_id: driver.id,
      event_type: "driver_availability_updated",
      event_payload: {
        status: requestedStatus
      }
    });

    return ok(
      res,
      {
        driver: buildDriverPublicProfile(updated)
      },
      "Driver availability updated."
    );
  })
);

/* =========================================================
   DRIVER EARNINGS / PAYOUTS
========================================================= */
app.post("/api/admin/rides/:rideId/settle-driver-earnings", requireAdmin, asyncHandler(async (req, res) => {
  const rideId = clean(req.params.rideId);
  const tipAmount = asCurrency(req.body?.tip_amount || req.body?.tipAmount || 0);

  const ride = await getRideById(rideId);
  if (!ride) {
    return fail(res, "Ride not found.", 404);
  }

  if (!clean(ride.driver_id)) {
    return fail(res, "Ride has no assigned driver.", 409);
  }

  const rideStatus = normalizeRideStatus(ride.status);
  if (rideStatus !== "completed") {
    return fail(
      res,
      "Driver earnings can only be settled after ride completion.",
      409,
      {
        ride_status: rideStatus
      }
    );
  }

  const existing = await dbSelectOne(TABLES.driver_earnings, { ride_id: ride.id });
  if (existing) {
    return fail(
      res,
      "Driver earnings already settled for this ride.",
      409,
      {
        earnings: buildDriverEarningsRecord(existing)
      }
    );
  }

  const payout = computeDriverPayoutBreakdown(
    ride.fare_estimate || ride.estimated_total || 0,
    tipAmount
  );

  const earning = await dbInsert(TABLES.driver_earnings, {
    id: createId("earn"),
    driver_id: ride.driver_id,
    ride_id: ride.id,
    gross_fare: payout.gross_fare,
    driver_payout: payout.driver_payout,
    platform_fee: payout.platform_fee,
    tip_amount: payout.tip_amount,
    payout_status: "pending",
    created_at: nowIso(),
    updated_at: nowIso()
  });

  await writeAdminLog({
    action: "driver_earnings_settled",
    actor_email: getAdminCredentials(req).email,
    target_type: "ride",
    target_id: ride.id,
    details: payout
  });

  await writeTripEvent({
    ride_id: ride.id,
    rider_id: ride.rider_id,
    driver_id: ride.driver_id,
    event_type: "driver_earnings_settled",
    event_payload: payout
  });

  return ok(
    res,
    {
      earnings: buildDriverEarningsRecord(earning)
    },
    "Driver earnings settled."
  );
}));

app.get("/api/drivers/:driverId/earnings", asyncHandler(async (req, res) => {
  const driverId = clean(req.params.driverId);
  const earnings = await getDriverEarnings(driverId);

  const totals = earnings.reduce(
    (acc, row) => {
      acc.gross_fare += asCurrency(row.gross_fare || 0);
      acc.driver_payout += asCurrency(row.driver_payout || 0);
      acc.platform_fee += asCurrency(row.platform_fee || 0);
      acc.tip_amount += asCurrency(row.tip_amount || 0);
      return acc;
    },
    {
      gross_fare: 0,
      driver_payout: 0,
      platform_fee: 0,
      tip_amount: 0
    }
  );

  return ok(
    res,
    {
      totals: {
        gross_fare: asCurrency(totals.gross_fare),
        driver_payout: asCurrency(totals.driver_payout),
        platform_fee: asCurrency(totals.platform_fee),
        tip_amount: asCurrency(totals.tip_amount)
      },
      earnings: earnings.map(buildDriverEarningsRecord)
    },
    "Driver earnings loaded."
  );
}));

app.get("/api/drivers/:driverId/payouts", asyncHandler(async (req, res) => {
  const driverId = clean(req.params.driverId);
  const payouts = await getDriverPayouts(driverId);

  return ok(
    res,
    {
      payouts
    },
    "Driver payouts loaded."
  );
}));

app.post("/api/admin/drivers/:driverId/payouts/create", requireAdmin, asyncHandler(async (req, res) => {
  const driverId = clean(req.params.driverId);
  const amount = asCurrency(req.body?.amount || 0);
  const method = clean(req.body?.method || "manual");
  const note = clean(req.body?.note || "");

  if (!driverId) {
    return fail(res, "Driver ID is required.", 400);
  }

  if (!amount || amount <= 0) {
    return fail(res, "A valid payout amount is required.", 400);
  }

  const driver = await getDriverById(driverId);
  if (!driver) {
    return fail(res, "Driver not found.", 404);
  }

  const payout = await dbInsert(TABLES.driver_payouts, {
    id: createId("payout"),
    driver_id: driverId,
    amount,
    method,
    note: note || null,
    payout_status: "processing",
    created_at: nowIso(),
    updated_at: nowIso()
  });

  await writeAdminLog({
    action: "driver_payout_created",
    actor_email: getAdminCredentials(req).email,
    target_type: "driver",
    target_id: driverId,
    details: {
      payout_id: payout.id,
      amount,
      method
    }
  });

  await writeTripEvent({
    driver_id: driverId,
    event_type: "driver_payout_created",
    event_payload: {
      payout_id: payout.id,
      amount,
      method
    }
  });

  return ok(
    res,
    {
      payout
    },
    "Driver payout created.",
    201
  );
}));

app.post("/api/admin/payouts/:payoutId/mark-paid", requireAdmin, asyncHandler(async (req, res) => {
  const payoutId = clean(req.params.payoutId);
  const payout = await dbSelectOne(TABLES.driver_payouts, { id: payoutId });

  if (!payout) {
    return fail(res, "Payout not found.", 404);
  }

  const rows = await dbUpdate(
    TABLES.driver_payouts,
    { id: payoutId },
    {
      payout_status: "paid",
      paid_at: nowIso(),
      updated_at: nowIso()
    }
  );

  const updated = Array.isArray(rows) ? rows[0] : payout;

  await writeAdminLog({
    action: "driver_payout_marked_paid",
    actor_email: getAdminCredentials(req).email,
    target_type: "payout",
    target_id: payoutId,
    details: {
      driver_id: payout.driver_id
    }
  });

  await writeTripEvent({
    driver_id: payout.driver_id,
    event_type: "driver_payout_marked_paid",
    event_payload: {
      payout_id: payoutId
    }
  });

  return ok(
    res,
    {
      payout: updated
    },
    "Driver payout marked paid."
  );
}));

/* =========================================================
   PART 5 END
========================================================= *//* =========================================================
   HARVEY TAXI — CODE BLUE CLEAN REBUILD
   PART 6: ADMIN DASHBOARD + ANALYTICS + OPERATIONS SUMMARY
========================================================= */

/* =========================================================
   ADMIN ANALYTICS HELPERS
========================================================= */
function sumCurrency(rows = [], field = "") {
  return asCurrency(
    (rows || []).reduce((total, row) => {
      return total + Number(row?.[field] || 0);
    }, 0)
  );
}

function countByNormalizedStatus(rows = [], normalizer) {
  const result = {};

  for (const row of rows || []) {
    const normalized = normalizer(row?.status || row?.payment_status || "");
    result[normalized] = (result[normalized] || 0) + 1;
  }

  return result;
}

function countByField(rows = [], field = "", formatter = null) {
  const result = {};

  for (const row of rows || []) {
    const rawValue = row?.[field];
    const value = formatter ? formatter(rawValue) : clean(rawValue || "unknown");
    const key = value || "unknown";
    result[key] = (result[key] || 0) + 1;
  }

  return result;
}

function isWithinLastDays(dateValue, days = 7) {
  if (!dateValue) return false;
  const time = new Date(dateValue).getTime();
  if (!Number.isFinite(time)) return false;
  return time >= Date.now() - days * 24 * 60 * 60 * 1000;
}

function buildAnalyticsWindowMeta() {
  return {
    generated_at: nowIso(),
    last_24_hours_since: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    last_7_days_since: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
    last_30_days_since: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
  };
}

async function getRecentRows(table, limit = 250, orderColumn = "created_at") {
  return dbSelectMany(
    table,
    {},
    {
      orderBy: { column: orderColumn, ascending: false },
      limit
    }
  );
}

async function getAdminOverviewData() {
  const [
    riders,
    drivers,
    rides,
    payments,
    dispatches,
    missions,
    earnings,
    payouts,
    tripEvents
  ] = await Promise.all([
    getRecentRows(TABLES.riders, 500),
    getRecentRows(TABLES.drivers, 500),
    getRecentRows(TABLES.rides, 500),
    getRecentRows(TABLES.payments, 500),
    getRecentRows(TABLES.dispatches, 500),
    getRecentRows(TABLES.missions, 500),
    getRecentRows(TABLES.driver_earnings, 500),
    getRecentRows(TABLES.driver_payouts, 500),
    getRecentRows(TABLES.trip_events, 500)
  ]);

  return {
    riders,
    drivers,
    rides,
    payments,
    dispatches,
    missions,
    earnings,
    payouts,
    tripEvents
  };
}

function buildOperationsSummary(data) {
  const {
    riders,
    drivers,
    rides,
    payments,
    dispatches,
    missions,
    earnings,
    payouts
  } = data;

  const activeRideStatuses = ["searching", "awaiting_driver_acceptance", "dispatched", "driver_en_route", "arrived", "in_progress"];

  const approvedRiders = riders.filter(
    (row) => normalizeRiderStatus(row.approval_status || row.status) === "approved"
  );

  const approvedDrivers = drivers.filter(
    (row) => normalizeDriverApprovalStatus(row.approval_status || row.status) === "approved"
  );

  const availableDrivers = drivers.filter(
    (row) => normalizeDriverStatus(row.status) === "available"
  );

  const missionReadyDrivers = drivers.filter((row) => driverCanReceiveMissions(row));

  const activeRides = rides.filter((row) =>
    activeRideStatuses.includes(normalizeRideStatus(row.status))
  );

  const completedRides = rides.filter(
    (row) => normalizeRideStatus(row.status) === "completed"
  );

  const cancelledRides = rides.filter(
    (row) => normalizeRideStatus(row.status) === "cancelled"
  );

  const authorizedPayments = payments.filter(
    (row) => normalizePaymentStatus(row.status || row.payment_status) === "authorized"
  );

  const capturedPayments = payments.filter(
    (row) => normalizePaymentStatus(row.status || row.payment_status) === "captured"
  );

  const pendingPayouts = payouts.filter(
    (row) => normalizePayoutStatus(row.payout_status) === "pending"
  );

  const processingPayouts = payouts.filter(
    (row) => normalizePayoutStatus(row.payout_status) === "processing"
  );

  const paidPayouts = payouts.filter(
    (row) => normalizePayoutStatus(row.payout_status) === "paid"
  );

  return {
    totals: {
      riders_total: riders.length,
      riders_approved: approvedRiders.length,
      drivers_total: drivers.length,
      drivers_approved: approvedDrivers.length,
      drivers_available: availableDrivers.length,
      drivers_mission_ready: missionReadyDrivers.length,
      rides_total: rides.length,
      rides_active: activeRides.length,
      rides_completed: completedRides.length,
      rides_cancelled: cancelledRides.length,
      payments_total: payments.length,
      payments_authorized: authorizedPayments.length,
      payments_captured: capturedPayments.length,
      dispatches_total: dispatches.length,
      missions_total: missions.length,
      earnings_total: earnings.length,
      payouts_total: payouts.length,
      payouts_pending: pendingPayouts.length,
      payouts_processing: processingPayouts.length,
      payouts_paid: paidPayouts.length
    },
    financials: {
      captured_payment_volume: sumCurrency(capturedPayments, "amount"),
      authorized_payment_volume: sumCurrency(authorizedPayments, "amount"),
      driver_gross_fare_total: sumCurrency(earnings, "gross_fare"),
      driver_payout_total: sumCurrency(earnings, "driver_payout"),
      platform_fee_total: sumCurrency(earnings, "platform_fee"),
      tips_total: sumCurrency(earnings, "tip_amount"),
      payouts_created_total: sumCurrency(payouts, "amount")
    }
  };
}

function buildVelocitySummary(data) {
  const { riders, drivers, rides, payments, earnings } = data;

  const riders24h = riders.filter((row) => isWithinLastDays(row.created_at, 1)).length;
  const drivers24h = drivers.filter((row) => isWithinLastDays(row.created_at, 1)).length;
  const rides24h = rides.filter((row) => isWithinLastDays(row.created_at, 1)).length;
  const completedRides24h = rides.filter(
    (row) =>
      isWithinLastDays(row.created_at, 1) &&
      normalizeRideStatus(row.status) === "completed"
  ).length;

  const riders7d = riders.filter((row) => isWithinLastDays(row.created_at, 7)).length;
  const drivers7d = drivers.filter((row) => isWithinLastDays(row.created_at, 7)).length;
  const rides7d = rides.filter((row) => isWithinLastDays(row.created_at, 7)).length;
  const payments7d = payments.filter((row) => isWithinLastDays(row.created_at, 7)).length;
  const earnings7d = earnings.filter((row) => isWithinLastDays(row.created_at, 7));

  return {
    last_24_hours: {
      new_riders: riders24h,
      new_drivers: drivers24h,
      rides_created: rides24h,
      rides_completed: completedRides24h
    },
    last_7_days: {
      new_riders: riders7d,
      new_drivers: drivers7d,
      rides_created: rides7d,
      payments_created: payments7d,
      gross_fare: sumCurrency(earnings7d, "gross_fare"),
      driver_payout: sumCurrency(earnings7d, "driver_payout"),
      platform_fee: sumCurrency(earnings7d, "platform_fee"),
      tips: sumCurrency(earnings7d, "tip_amount")
    }
  };
}

function buildDispatchHealthSummary(data) {
  const { rides, dispatches, missions } = data;

  return {
    rides_by_status: countByField(rides, "status", normalizeRideStatus),
    dispatches_by_status: countByField(dispatches, "status", normalizeDispatchStatus),
    missions_by_status: countByField(missions, "status", normalizeMissionStatus),
    open_dispatches: dispatches.filter(
      (row) => normalizeDispatchStatus(row.status) === "offered"
    ).length,
    accepted_dispatches: dispatches.filter(
      (row) => normalizeDispatchStatus(row.status) === "accepted"
    ).length,
    expired_dispatches: dispatches.filter(
      (row) => normalizeDispatchStatus(row.status) === "expired"
    ).length,
    declined_dispatches: dispatches.filter(
      (row) => normalizeDispatchStatus(row.status) === "declined"
    ).length
  };
}

function buildDriverOpsSummary(data) {
  const { drivers, earnings, payouts } = data;

  return {
    drivers_by_type: countByField(drivers, "driver_type", normalizeDriverType),
    drivers_by_status: countByField(drivers, "status", normalizeDriverStatus),
    approval_statuses: countByField(drivers, "approval_status", normalizeDriverApprovalStatus),
    email_verification_statuses: countByField(
      drivers,
      "email_verification_status",
      normalizeDriverVerificationStatus
    ),
    sms_verification_statuses: countByField(
      drivers,
      "sms_verification_status",
      normalizeDriverVerificationStatus
    ),
    background_check_statuses: countByField(
      drivers,
      "background_check_status",
      normalizeDriverVerificationStatus
    ),
    earnings_summary: {
      gross_fare_total: sumCurrency(earnings, "gross_fare"),
      driver_payout_total: sumCurrency(earnings, "driver_payout"),
      platform_fee_total: sumCurrency(earnings, "platform_fee"),
      tips_total: sumCurrency(earnings, "tip_amount")
    },
    payout_statuses: countByField(payouts, "payout_status", normalizePayoutStatus)
  };
}

function buildRiderOpsSummary(data) {
  const { riders, payments } = data;

  return {
    riders_by_approval_status: countByField(riders, "approval_status", normalizeRiderStatus),
    riders_by_verification_status: riders.reduce((acc, rider) => {
      const status = normalizeVerificationStatus(
        rider.verification_status ||
          rider.identity_status ||
          rider.persona_status
      );
      acc[status] = (acc[status] || 0) + 1;
      return acc;
    }, {}),
    payments_by_status: countByField(payments, "payment_status", normalizePaymentStatus),
    payment_volume: {
      total: sumCurrency(payments, "amount"),
      authorized: sumCurrency(
        payments.filter(
          (row) => normalizePaymentStatus(row.status || row.payment_status) === "authorized"
        ),
        "amount"
      ),
      captured: sumCurrency(
        payments.filter(
          (row) => normalizePaymentStatus(row.status || row.payment_status) === "captured"
        ),
        "amount"
      )
    }
  };
}

/* =========================================================
   ADMIN DASHBOARD OVERVIEW
========================================================= */
app.get("/api/admin/dashboard/overview", requireAdmin, asyncHandler(async (req, res) => {
  const data = await getAdminOverviewData();

  return ok(
    res,
    {
      window: buildAnalyticsWindowMeta(),
      operations: buildOperationsSummary(data),
      velocity: buildVelocitySummary(data),
      dispatch_health: buildDispatchHealthSummary(data),
      driver_ops: buildDriverOpsSummary(data),
      rider_ops: buildRiderOpsSummary(data)
    },
    "Admin dashboard overview loaded."
  );
}));

/* =========================================================
   ADMIN ANALYTICS: RIDES
========================================================= */
app.get("/api/admin/analytics/rides", requireAdmin, asyncHandler(async (req, res) => {
  const rides = await getRecentRows(TABLES.rides, 500);

  const rideStatusCounts = countByField(rides, "status", normalizeRideStatus);

  const modeCounts = rides.reduce((acc, ride) => {
    const mode = lower(ride.requested_mode || "driver");
    acc[mode] = (acc[mode] || 0) + 1;
    return acc;
  }, {});

  const avgFareEstimate =
    rides.length > 0
      ? asCurrency(
          rides.reduce((sum, ride) => {
            return sum + Number(ride.fare_estimate || ride.estimated_total || 0);
          }, 0) / rides.length
        )
      : 0;

  return ok(
    res,
    {
      total_rides: rides.length,
      ride_status_counts: rideStatusCounts,
      requested_mode_counts: modeCounts,
      average_fare_estimate: avgFareEstimate,
      recent_rides: rides.slice(0, 50).map(buildRidePublicRecord)
    },
    "Ride analytics loaded."
  );
}));

/* =========================================================
   ADMIN ANALYTICS: PAYMENTS
========================================================= */
app.get("/api/admin/analytics/payments", requireAdmin, asyncHandler(async (req, res) => {
  const payments = await getRecentRows(TABLES.payments, 500);

  const paymentsByStatus = countByField(
    payments,
    "payment_status",
    (value) => normalizePaymentStatus(value || "")
  );

  const authorizedPayments = payments.filter(
    (row) => normalizePaymentStatus(row.status || row.payment_status) === "authorized"
  );

  const capturedPayments = payments.filter(
    (row) => normalizePaymentStatus(row.status || row.payment_status) === "captured"
  );

  const failedPayments = payments.filter(
    (row) => normalizePaymentStatus(row.status || row.payment_status) === "failed"
  );

  return ok(
    res,
    {
      total_payments: payments.length,
      payment_status_counts: paymentsByStatus,
      totals: {
        total_volume: sumCurrency(payments, "amount"),
        authorized_volume: sumCurrency(authorizedPayments, "amount"),
        captured_volume: sumCurrency(capturedPayments, "amount"),
        failed_volume: sumCurrency(failedPayments, "amount")
      },
      recent_payments: payments.slice(0, 50).map(buildPaymentPublicRecord)
    },
    "Payment analytics loaded."
  );
}));

/* =========================================================
   ADMIN ANALYTICS: DRIVERS
========================================================= */
app.get("/api/admin/analytics/drivers", requireAdmin, asyncHandler(async (req, res) => {
  const drivers = await getRecentRows(TABLES.drivers, 500);
  const earnings = await getRecentRows(TABLES.driver_earnings, 500);
  const payouts = await getRecentRows(TABLES.driver_payouts, 500);

  return ok(
    res,
    {
      total_drivers: drivers.length,
      summary: buildDriverOpsSummary({
        drivers,
        earnings,
        payouts
      }),
      recent_drivers: drivers.slice(0, 50).map(buildDriverPublicProfile),
      recent_earnings: earnings.slice(0, 50).map(buildDriverEarningsRecord),
      recent_payouts: payouts.slice(0, 50)
    },
    "Driver analytics loaded."
  );
}));

/* =========================================================
   ADMIN ANALYTICS: RIDERS
========================================================= */
app.get("/api/admin/analytics/riders", requireAdmin, asyncHandler(async (req, res) => {
  const riders = await getRecentRows(TABLES.riders, 500);
  const payments = await getRecentRows(TABLES.payments, 500);

  return ok(
    res,
    {
      total_riders: riders.length,
      summary: buildRiderOpsSummary({
        riders,
        payments
      }),
      recent_riders: riders.slice(0, 50).map(buildRiderPublicProfile)
    },
    "Rider analytics loaded."
  );
}));

/* =========================================================
   ADMIN ANALYTICS: EARNINGS / PAYOUTS
========================================================= */
app.get("/api/admin/analytics/earnings", requireAdmin, asyncHandler(async (req, res) => {
  const earnings = await getRecentRows(TABLES.driver_earnings, 500);
  const payouts = await getRecentRows(TABLES.driver_payouts, 500);

  const pendingPayouts = payouts.filter(
    (row) => normalizePayoutStatus(row.payout_status) === "pending"
  );

  const processingPayouts = payouts.filter(
    (row) => normalizePayoutStatus(row.payout_status) === "processing"
  );

  const paidPayouts = payouts.filter(
    (row) => normalizePayoutStatus(row.payout_status) === "paid"
  );

  return ok(
    res,
    {
      totals: {
        gross_fare: sumCurrency(earnings, "gross_fare"),
        driver_payout: sumCurrency(earnings, "driver_payout"),
        platform_fee: sumCurrency(earnings, "platform_fee"),
        tips: sumCurrency(earnings, "tip_amount"),
        payouts_created: sumCurrency(payouts, "amount"),
        payouts_pending: sumCurrency(pendingPayouts, "amount"),
        payouts_processing: sumCurrency(processingPayouts, "amount"),
        payouts_paid: sumCurrency(paidPayouts, "amount")
      },
      payout_status_counts: countByField(payouts, "payout_status", normalizePayoutStatus),
      recent_earnings: earnings.slice(0, 50).map(buildDriverEarningsRecord),
      recent_payouts: payouts.slice(0, 50)
    },
    "Earnings analytics loaded."
  );
}));

/* =========================================================
   ADMIN DISPATCH OVERVIEW
========================================================= */
app.get("/api/admin/dispatch/overview", requireAdmin, asyncHandler(async (req, res) => {
  const rides = await getRecentRows(TABLES.rides, 300);
  const dispatches = await getRecentRows(TABLES.dispatches, 500);
  const missions = await getRecentRows(TABLES.missions, 500);

  const summary = {
    rides_searching: rides.filter((row) => normalizeRideStatus(row.status) === "searching").length,
    rides_waiting_acceptance: rides.filter((row) => normalizeRideStatus(row.status) === "awaiting_driver_acceptance").length,
    rides_dispatched: rides.filter((row) => normalizeRideStatus(row.status) === "dispatched").length,
    rides_driver_en_route: rides.filter((row) => normalizeRideStatus(row.status) === "driver_en_route").length,
    rides_arrived: rides.filter((row) => normalizeRideStatus(row.status) === "arrived").length,
    rides_in_progress: rides.filter((row) => normalizeRideStatus(row.status) === "in_progress").length,
    dispatches_offered: dispatches.filter((row) => normalizeDispatchStatus(row.status) === "offered").length,
    dispatches_expired: dispatches.filter((row) => normalizeDispatchStatus(row.status) === "expired").length,
    dispatches_accepted: dispatches.filter((row) => normalizeDispatchStatus(row.status) === "accepted").length,
    dispatches_declined: dispatches.filter((row) => normalizeDispatchStatus(row.status) === "declined").length,
    missions_offered: missions.filter((row) => normalizeMissionStatus(row.status) === "offered").length,
    missions_accepted: missions.filter((row) => normalizeMissionStatus(row.status) === "accepted").length,
    missions_expired: missions.filter((row) => normalizeMissionStatus(row.status) === "expired").length,
    missions_declined: missions.filter((row) => normalizeMissionStatus(row.status) === "declined").length
  };

  return ok(
    res,
    {
      summary,
      recent_rides: rides.slice(0, 25).map(buildRidePublicRecord),
      recent_dispatches: dispatches.slice(0, 50).map(buildDispatchPublicRecord),
      recent_missions: missions.slice(0, 50).map(buildMissionPublicRecord)
    },
    "Dispatch overview loaded."
  );
}));

/* =========================================================
   ADMIN SUPPORT / AUDIT VIEW
========================================================= */
app.get("/api/admin/audit/logs", requireAdmin, asyncHandler(async (req, res) => {
  const logs = await getRecentRows(TABLES.admin_logs, 300);
  return ok(
    res,
    {
      logs
    },
    "Admin audit logs loaded."
  );
}));

app.get("/api/admin/trip-events", requireAdmin, asyncHandler(async (req, res) => {
  const events = await getRecentRows(TABLES.trip_events, 300);
  return ok(
    res,
    {
      events: events.map(buildTimelineEvent)
    },
    "Trip events loaded."
  );
}));

/* =========================================================
   ADMIN ENTITY COUNTS
========================================================= */
app.get("/api/admin/counts", requireAdmin, asyncHandler(async (req, res) => {
  const data = await getAdminOverviewData();
  const summary = buildOperationsSummary(data);

  return ok(
    res,
    {
      counts: summary.totals,
      financials: summary.financials
    },
    "Admin counts loaded."
  );
}));

/* =========================================================
   PART 6 END
========================================================= *//* =========================================================
   HARVEY TAXI — CODE BLUE CLEAN REBUILD
   PART 7: AI SUPPORT + PAGE-AWARE ASSISTANT ROUTING
========================================================= */

/* =========================================================
   AI SUPPORT HELPERS
========================================================= */
function normalizeSupportPage(value = "") {
  const page = lower(value);

  if (["rider", "rider-signup", "rider_dashboard", "rider-dashboard"].includes(page)) {
    return "rider";
  }

  if (["driver", "driver-signup", "driver_dashboard", "driver-dashboard"].includes(page)) {
    return "driver";
  }

  if (["request", "request-ride", "ride-request", "dispatch"].includes(page)) {
    return "request";
  }

  if (["admin", "admin-dashboard"].includes(page)) {
    return "admin";
  }

  return "general";
}

function normalizeSupportIntent(value = "") {
  const intent = lower(value);

  if (["rider"].includes(intent)) return "rider";
  if (["driver"].includes(intent)) return "driver";
  if (["request", "ride", "dispatch"].includes(intent)) return "request";
  if (["admin"].includes(intent)) return "admin";

  return "general";
}

function trimSupportHistory(messages = [], maxItems = 8) {
  if (!Array.isArray(messages)) return [];

  return messages
    .filter((msg) => msg && clean(msg.role) && clean(msg.content))
    .slice(-maxItems)
    .map((msg) => ({
      role: lower(msg.role) === "assistant" ? "assistant" : "user",
      content: String(msg.content || "").slice(0, 4000)
    }));
}

async function resolveSupportEntities({
  rider_id = "",
  rider_email = "",
  driver_id = "",
  driver_email = "",
  ride_id = ""
}) {
  let rider = null;
  let driver = null;
  let ride = null;

  if (clean(rider_id)) {
    rider = await getRiderById(rider_id);
  } else if (normalizeEmail(rider_email)) {
    rider = await getRiderByEmail(rider_email);
  }

  if (clean(driver_id)) {
    driver = await getDriverById(driver_id);
  } else if (normalizeEmail(driver_email)) {
    driver = await getDriverByEmail(driver_email);
  }

  if (clean(ride_id)) {
    ride = await getRideById(ride_id);
  }

  return { rider, driver, ride };
}

function buildSupportContextBlock({
  page = "general",
  intent = "general",
  rider = null,
  driver = null,
  ride = null
}) {
  const lines = [
    `App: ${APP_NAME}`,
    `Version: ${APP_VERSION}`,
    `Public URL: ${PUBLIC_APP_URL}`,
    `Support page mode: ${page}`,
    `Support intent: ${intent}`,
    `Rider verification gate enabled: ${ENABLE_RIDER_VERIFICATION_GATE}`,
    `Payment gate enabled: ${ENABLE_PAYMENT_GATE}`,
    `Auto redispatch enabled: ${ENABLE_AUTO_REDISPATCH}`,
    `Real email enabled: ${ENABLE_REAL_EMAIL}`,
    `Real SMS enabled: ${ENABLE_REAL_SMS}`,
    `Persona enforcement enabled: ${ENABLE_PERSONA_ENFORCEMENT}`
  ];

  if (rider) {
    lines.push(
      `Rider ID: ${clean(rider.id)}`,
      `Rider approval status: ${normalizeRiderStatus(rider.approval_status || rider.status)}`,
      `Rider verification status: ${normalizeVerificationStatus(
        rider.verification_status ||
          rider.identity_status ||
          rider.persona_status
      )}`
    );
  }

  if (driver) {
    lines.push(
      `Driver ID: ${clean(driver.id)}`,
      `Driver approval status: ${normalizeDriverApprovalStatus(driver.approval_status || driver.status)}`,
      `Driver email verification: ${normalizeDriverVerificationStatus(driver.email_verification_status)}`,
      `Driver SMS verification: ${normalizeDriverVerificationStatus(driver.sms_verification_status)}`,
      `Driver background check: ${normalizeDriverVerificationStatus(driver.background_check_status)}`,
      `Driver type: ${normalizeDriverType(driver.driver_type)}`
    );
  }

  if (ride) {
    lines.push(
      `Ride ID: ${clean(ride.id)}`,
      `Ride status: ${normalizeRideStatus(ride.status)}`,
      `Requested mode: ${lower(ride.requested_mode || "driver")}`,
      `Pickup: ${clean(ride.pickup_address)}`,
      `Dropoff: ${clean(ride.dropoff_address)}`
    );
  }

  return lines.join("\n");
}

function buildSupportSystemPrompt({
  page = "general",
  intent = "general",
  rider = null,
  driver = null,
  ride = null
}) {
  const contextBlock = buildSupportContextBlock({
    page,
    intent,
    rider,
    driver,
    ride
  });

  return `
You are Harvey AI Support for Harvey Taxi Service and Harvey Assistance Foundation.

Your job:
- Help riders, drivers, and admins understand how the Harvey Taxi platform works.
- Give short, clear, professional answers.
- Be calm, practical, and operationally accurate.
- Never invent company policies that are not grounded in the provided context.
- Do not claim an action was completed unless the system explicitly confirms it.
- If the user asks for emergency help, tell them Harvey Taxi is not an emergency service and they should call 911.
- If the user asks legal, medical, or tax questions, give general guidance only and tell them to consult a qualified professional.
- If asked about rider access, explain that rider verification approval may be required before ride requests.
- If asked about ride requests, explain that payment authorization may be required before dispatch.
- If asked about drivers, explain that drivers may need email verification, SMS verification, document review, background check review, and approval before they can receive missions.
- If asked about autonomous rides, explain that autonomous mode is a pilot or future-oriented option and actual availability depends on current platform operations.
- If the question goes beyond known facts, say support should verify through the Harvey Taxi admin team at support@harveytaxiservice.com.
- Keep answers useful and grounded.

Current system context:
${contextBlock}
  `.trim();
}

function getSupportFallbackByMode({
  page = "general",
  intent = "general",
  rider = null,
  driver = null,
  ride = null,
  userMessage = ""
}) {
  const message = lower(userMessage || "");

  if (
    message.includes("emergency") ||
    message.includes("911") ||
    message.includes("danger") ||
    message.includes("unsafe")
  ) {
    return {
      answer:
        "Harvey Taxi is not an emergency service. If this is an emergency or immediate safety issue, call 911 right away.",
      mode: "emergency_fallback"
    };
  }

  if (page === "rider" || intent === "rider") {
    return {
      answer: rider
        ? `Your rider profile shows approval status "${normalizeRiderStatus(
            rider.approval_status || rider.status
          )}" and verification status "${normalizeVerificationStatus(
            rider.verification_status ||
              rider.identity_status ||
              rider.persona_status
          )}". Riders may need approval before requesting a ride, and payment authorization may also be required before dispatch.`
        : "Riders may need verification approval before requesting rides, and payment authorization may also be required before dispatch.",
      mode: "rider_fallback"
    };
  }

  if (page === "driver" || intent === "driver") {
    return {
      answer: driver
        ? `Your driver profile shows approval status "${normalizeDriverApprovalStatus(
            driver.approval_status || driver.status
          )}", email verification "${normalizeDriverVerificationStatus(
            driver.email_verification_status
          )}", SMS verification "${normalizeDriverVerificationStatus(
            driver.sms_verification_status
          )}", and background check "${normalizeDriverVerificationStatus(
            driver.background_check_status
          )}". Drivers usually need approval plus communication verification before receiving missions.`
        : "Drivers usually need approval, email verification, SMS verification, and possibly background check review before receiving missions.",
      mode: "driver_fallback"
    };
  }

  if (page === "request" || intent === "request") {
    return {
      answer: ride
        ? `This ride currently shows status "${normalizeRideStatus(
            ride.status
          )}". Harvey Taxi may require rider approval and payment authorization before dispatch. After a ride is requested, the system can offer the mission to an available driver and re-dispatch if an offer expires.`
        : "Harvey Taxi may require rider approval and payment authorization before dispatch. After a ride is requested, the system can offer the mission to an available driver and re-dispatch if an offer expires.",
      mode: "request_fallback"
    };
  }

  if (page === "admin" || intent === "admin") {
    return {
      answer:
        "Admin workflows can include approving riders, approving drivers, reviewing dispatches, checking ride timelines, and monitoring payments, earnings, payouts, and operational analytics.",
      mode: "admin_fallback"
    };
  }

  return {
    answer:
      "Harvey Taxi support can help with rider approval, driver onboarding, ride requests, dispatch flow, payment authorization, and trip status questions. For account-specific help, support can verify the record through the admin team at support@harveytaxiservice.com.",
    mode: "general_fallback"
  };
}

async function generateAiSupportReply({
  message = "",
  page = "general",
  intent = "general",
  rider = null,
  driver = null,
  ride = null,
  history = []
}) {
  if (!openai) {
    return {
      ok: false,
      reason: "ai_not_available"
    };
  }

  const systemPrompt = buildSupportSystemPrompt({
    page,
    intent,
    rider,
    driver,
    ride
  });

  const messages = [
    { role: "system", content: systemPrompt },
    ...trimSupportHistory(history, 8),
    { role: "user", content: String(message || "").slice(0, 6000) }
  ];

  const response = await openai.chat.completions.create({
    model: OPENAI_MODEL,
    temperature: 0.3,
    messages
  });

  const answer = clean(
    response?.choices?.[0]?.message?.content ||
      "I’m sorry, but I couldn’t generate a support reply right now."
  );

  return {
    ok: true,
    answer,
    model: OPENAI_MODEL
  };
}

async function handleSupportByMode(req, res, forcedPage = "", forcedIntent = "") {
  const message = clean(req.body?.message || req.body?.prompt || "");
  const page = normalizeSupportPage(forcedPage || req.body?.page || req.body?.page_mode || "general");
  const intent = normalizeSupportIntent(forcedIntent || req.body?.intent || page || "general");
  const history = Array.isArray(req.body?.history) ? req.body.history : [];

  const rider_id = clean(req.body?.rider_id || req.body?.riderId || "");
  const rider_email = normalizeEmail(req.body?.rider_email || req.body?.riderEmail || "");
  const driver_id = clean(req.body?.driver_id || req.body?.driverId || "");
  const driver_email = normalizeEmail(req.body?.driver_email || req.body?.driverEmail || "");
  const ride_id = clean(req.body?.ride_id || req.body?.rideId || "");

  if (!message) {
    return fail(res, "Support message is required.", 400);
  }

  const { rider, driver, ride } = await resolveSupportEntities({
    rider_id,
    rider_email,
    driver_id,
    driver_email,
    ride_id
  });

  const aiReply = await generateAiSupportReply({
    message,
    page,
    intent,
    rider,
    driver,
    ride,
    history
  });

  if (aiReply.ok) {
    return ok(
      res,
      {
        answer: aiReply.answer,
        ai_used: true,
        model: aiReply.model,
        support_mode: page,
        support_intent: intent,
        rider: rider ? buildRiderPublicProfile(rider) : null,
        driver: driver ? buildDriverPublicProfile(driver) : null,
        ride: ride ? buildRidePublicRecord(ride) : null
      },
      "AI support reply generated."
    );
  }

  const fallback = getSupportFallbackByMode({
    page,
    intent,
    rider,
    driver,
    ride,
    userMessage: message
  });

  return ok(
    res,
    {
      answer: fallback.answer,
      ai_used: false,
      fallback_mode: fallback.mode,
      support_mode: page,
      support_intent: intent,
      rider: rider ? buildRiderPublicProfile(rider) : null,
      driver: driver ? buildDriverPublicProfile(driver) : null,
      ride: ride ? buildRidePublicRecord(ride) : null
    },
    "Fallback support reply generated."
  );
}

/* =========================================================
   MAIN AI SUPPORT ENDPOINT
========================================================= */
app.post("/api/ai/support", asyncHandler(async (req, res) => {
  return handleSupportByMode(req, res);
}));

/* =========================================================
   PAGE-AWARE QUICK SUPPORT ENDPOINTS
   NO duplicate route registration
========================================================= */
app.post("/api/ai/support/rider", asyncHandler(async (req, res) => {
  return handleSupportByMode(req, res, "rider", "rider");
}));

app.post("/api/ai/support/driver", asyncHandler(async (req, res) => {
  return handleSupportByMode(req, res, "driver", "driver");
}));

app.post("/api/ai/support/request", asyncHandler(async (req, res) => {
  return handleSupportByMode(req, res, "request", "request");
}));

app.post("/api/ai/support/admin", asyncHandler(async (req, res) => {
  return handleSupportByMode(req, res, "admin", "admin");
}));

/* =========================================================
   SUPPORT FAQ
========================================================= */
app.get("/api/support/faq", asyncHandler(async (req, res) => {
  const faqs = [
    {
      key: "rider_approval",
      question: "Why can’t I request a ride yet?",
      answer:
        "Riders may need verification approval before requesting rides. Payment authorization may also be required before dispatch."
    },
    {
      key: "driver_onboarding",
      question: "Why can’t I accept missions yet?",
      answer:
        "Drivers may need admin approval, email verification, SMS verification, and other review steps before becoming mission-ready."
    },
    {
      key: "payment_authorization",
      question: "Why does Harvey Taxi authorize payment before dispatch?",
      answer:
        "Payment authorization helps confirm the rider’s payment method before the system sends a driver offer."
    },
    {
      key: "autonomous_mode",
      question: "What does autonomous mode mean?",
      answer:
        "Autonomous mode is a pilot or future-oriented service path. Actual availability depends on current platform operations."
    },
    {
      key: "support_contact",
      question: "How do I contact support?",
      answer:
        "For account-specific support, contact support@harveytaxiservice.com."
    },
    {
      key: "emergency_notice",
      question: "Is Harvey Taxi an emergency service?",
      answer:
        "No. Harvey Taxi is not an emergency service. In emergencies, call 911."
    }
  ];

  return ok(
    res,
    { faqs },
    "Support FAQ loaded."
  );
}));

/* =========================================================
   SIMPLE AI STATUS ENDPOINT
========================================================= */
app.get("/api/ai/status", asyncHandler(async (req, res) => {
  return ok(
    res,
    {
      ai_enabled: Boolean(openai),
      model: Boolean(openai) ? OPENAI_MODEL : null,
      support_modes: ["general", "rider", "driver", "request", "admin"]
    },
    "AI status loaded."
  );
}));

/* =========================================================
   PART 7 END
========================================================= *//* =========================================================
   /* =========================================================
   HARVEY TAXI — CODE BLUE CLEAN REBUILD
   PART 8: PERSONA WEBHOOKS + COMMUNICATIONS + FINAL PRODUCTION LAYER
========================================================= */

/* =========================================================
   OPTIONAL TWILIO SDK
========================================================= */
let Twilio = null;
try {
  Twilio = require("twilio");
} catch (error) {
  console.warn("⚠️ Twilio SDK not installed. Real SMS will stay disabled.");
}

/* =========================================================
   PERSONA / COMMUNICATION CONFIG
========================================================= */
const PERSONA_WEBHOOK_SECRET = cleanEnv(process.env.PERSONA_WEBHOOK_SECRET);
const PERSONA_TEMPLATE_ID_RIDER = cleanEnv(process.env.PERSONA_TEMPLATE_ID_RIDER);
const PERSONA_TEMPLATE_ID_DRIVER = cleanEnv(process.env.PERSONA_TEMPLATE_ID_DRIVER);

const TWILIO_ACCOUNT_SID = cleanEnv(process.env.TWILIO_ACCOUNT_SID);
const TWILIO_AUTH_TOKEN = cleanEnv(process.env.TWILIO_AUTH_TOKEN);
const TWILIO_FROM_NUMBER =
  cleanEnv(process.env.TWILIO_PHONE_NUMBER) ||
  cleanEnv(process.env.TWILIO_FROM_NUMBER);

const twilioClient =
  ENABLE_REAL_SMS && Twilio && TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN
    ? Twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
    : null;

/* =========================================================
   RAW BODY SUPPORT FOR WEBHOOK SIGNATURE VALIDATION
   If your earlier middleware already captures req.rawBody,
   keep that version and do not duplicate this block.
========================================================= */
if (!global.__HARVEY_RAW_BODY_CAPTURED__) {
  global.__HARVEY_RAW_BODY_CAPTURED__ = true;

  app.use(
    express.json({
      limit: "10mb",
      verify: (req, res, buf) => {
        req.rawBody = buf ? buf.toString("utf8") : "";
      }
    })
  );
}

/* =========================================================
   PERSONA HELPERS
========================================================= */
function getPersonaSignatureHeader(req) {
  return clean(
    req.headers["persona-signature"] ||
      req.headers["x-persona-signature"] ||
      ""
  );
}

function parsePersonaSignatureHeader(headerValue = "") {
  const parts = String(headerValue)
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  const parsed = {};

  for (const part of parts) {
    const [key, ...rest] = part.split("=");
    const value = rest.join("=");
    if (key && value) {
      parsed[clean(key)] = clean(value);
    }
  }

  return {
    timestamp: clean(parsed.t || ""),
    signature_v1: clean(parsed.v1 || "")
  };
}

function isFreshPersonaTimestamp(timestamp = "", toleranceSeconds = 300) {
  const unix = Number(timestamp);
  if (!Number.isFinite(unix) || unix <= 0) return false;

  const now = Math.floor(Date.now() / 1000);
  return Math.abs(now - unix) <= toleranceSeconds;
}

function verifyPersonaWebhook(req) {
  if (!PERSONA_WEBHOOK_SECRET) return true;

  const header = getPersonaSignatureHeader(req);
  if (!header) return false;

  const { timestamp, signature_v1 } = parsePersonaSignatureHeader(header);
  if (!timestamp || !signature_v1) return false;
  if (!isFreshPersonaTimestamp(timestamp)) return false;

  const rawBody =
    typeof req.rawBody === "string"
      ? req.rawBody
      : JSON.stringify(req.body || {});

  if (!rawBody) return false;

  const signedPayload = `${timestamp}.${rawBody}`;
  const expected = crypto
    .createHmac("sha256", PERSONA_WEBHOOK_SECRET)
    .update(signedPayload)
    .digest("hex");

  try {
    return (
      expected.length === signature_v1.length &&
      crypto.timingSafeEqual(
        Buffer.from(expected, "utf8"),
        Buffer.from(signature_v1, "utf8")
      )
    );
  } catch (error) {
    return false;
  }
}

function normalizePersonaOutcome(value = "") {
  const status = lower(value);

  if (["approved", "completed", "passed", "verified"].includes(status)) {
    return "approved";
  }

  if (
    ["pending", "initiated", "created", "submitted", "in_review", "review"].includes(
      status
    )
  ) {
    return "pending";
  }

  if (["failed", "declined", "rejected", "expired"].includes(status)) {
    return "failed";
  }

  return status || "pending";
}

function extractPersonaPayload(req) {
  const body = req.body || {};
  const data = body.data || {};
  const attributes = data.attributes || {};
  const included = Array.isArray(body.included) ? body.included : [];

  const inquiryId =
    clean(data.id) ||
    clean(body.inquiry_id) ||
    clean(attributes.inquiry_id);

  const rawEventName = clean(body.event_name || body.type || "");
  const explicitStatus =
    clean(attributes.status) ||
    clean(body.status) ||
    "";

  const status = normalizePersonaOutcome(explicitStatus || "pending");

  const referenceId =
    clean(attributes.reference_id) ||
    clean(body.reference_id);

  const payload = {
    inquiry_id: inquiryId,
    status,
    reference_id: referenceId,
    raw_event_name: rawEventName,
    raw: body,
    included_count: included.length
  };

  return payload;
}

function inferPersonaSubjectType(payload = {}) {
  const raw = lower(payload.raw_event_name || "");
  const referenceId = clean(payload.reference_id || "");

  if (raw.includes("driver")) return "driver";
  if (raw.includes("rider")) return "rider";

  if (referenceId.startsWith("driver_")) return "driver";
  if (referenceId.startsWith("rider_")) return "rider";

  return "unknown";
}

async function findRiderByPersonaInquiryId(inquiryId = "") {
  if (!clean(inquiryId)) return null;
  return dbSelectOne(TABLES.riders, { persona_inquiry_id: clean(inquiryId) });
}

async function findDriverByPersonaInquiryId(inquiryId = "") {
  if (!clean(inquiryId)) return null;
  return dbSelectOne(TABLES.drivers, { persona_inquiry_id: clean(inquiryId) });
}

async function resolvePersonaTarget(payload = {}) {
  const inquiryId = clean(payload.inquiry_id || "");
  const referenceId = clean(payload.reference_id || "");
  const subjectTypeHint = inferPersonaSubjectType(payload);

  let rider = null;
  let driver = null;

  if (inquiryId) {
    rider = await findRiderByPersonaInquiryId(inquiryId);

    if (!rider) {
      driver = await findDriverByPersonaInquiryId(inquiryId);
    }
  }

  if (!rider && !driver && referenceId) {
    if (referenceId.startsWith("rider_")) {
      rider = await getRiderById(referenceId);
    } else if (referenceId.startsWith("driver_")) {
      driver = await getDriverById(referenceId);
    }
  }

  if (!rider && !driver && subjectTypeHint === "rider" && referenceId) {
    rider = await getRiderById(referenceId);
  }

  if (!rider && !driver && subjectTypeHint === "driver" && referenceId) {
    driver = await getDriverById(referenceId);
  }

  return {
    rider,
    driver
  };
}

/* =========================================================
   COMMUNICATION HELPERS
========================================================= */
async function sendEmailMessage({
  to = "",
  subject = "",
  text = "",
  category = "general"
}) {
  const normalizedTo = normalizeEmail(to);

  if (!normalizedTo) {
    return {
      ok: false,
      reason: "missing_to_email"
    };
  }

  if (!ENABLE_REAL_EMAIL) {
    console.log("MOCK EMAIL:", {
      to: normalizedTo,
      from: SUPPORT_FROM_EMAIL,
      reply_to: SUPPORT_REPLY_TO,
      subject,
      category,
      text
    });

    return {
      ok: true,
      mocked: true,
      channel: "email",
      to: normalizedTo,
      subject
    };
  }

  console.log("REAL EMAIL PLACEHOLDER:", {
    to: normalizedTo,
    from: SUPPORT_FROM_EMAIL,
    reply_to: SUPPORT_REPLY_TO,
    subject,
    category
  });

  return {
    ok: true,
    mocked: false,
    channel: "email",
    to: normalizedTo,
    subject
  };
}

async function sendSmsMessage({
  to = "",
  text = "",
  category = "general"
}) {
  const normalizedTo = normalizePhone(to);

  if (!normalizedTo) {
    return {
      ok: false,
      reason: "missing_to_phone"
    };
  }

  if (!ENABLE_REAL_SMS || !twilioClient || !TWILIO_FROM_NUMBER) {
    console.log("MOCK SMS:", {
      to: normalizedTo,
      from: TWILIO_FROM_NUMBER || "mock-number",
      category,
      text
    });

    return {
      ok: true,
      mocked: true,
      channel: "sms",
      to: normalizedTo
    };
  }

  try {
    const message = await twilioClient.messages.create({
      to: normalizedTo,
      from: TWILIO_FROM_NUMBER,
      body: text
    });

    return {
      ok: true,
      mocked: false,
      channel: "sms",
      to: normalizedTo,
      sid: clean(message?.sid || ""),
      status: clean(message?.status || "queued")
    };
  } catch (error) {
    console.error("Twilio SMS send failed:", error);

    return {
      ok: false,
      reason: "sms_send_failed",
      error: clean(error?.message || "Unknown SMS error")
    };
  }
}

/* =========================================================
   RIDER / DRIVER NOTIFICATIONS
========================================================= */
async function notifyRiderVerificationApproved(rider) {
  if (!rider) return null;

  const fullName =
    `${clean(rider.first_name)} ${clean(rider.last_name)}`.trim() || "Rider";

  const emailResult = await sendEmailMessage({
    to: rider.email,
    subject: "Harvey Taxi rider verification approved",
    category: "rider_verification_approved",
    text:
      `Hello ${fullName},\n\n` +
      `Your Harvey Taxi rider verification has been approved.\n\n` +
      `You can now continue toward ride request access. Payment authorization may still be required before dispatch.\n\n` +
      `Support: ${SUPPORT_REPLY_TO}\n`
  });

  const smsResult = await sendSmsMessage({
    to: rider.phone,
    category: "rider_verification_approved",
    text:
      "Harvey Taxi: your rider verification has been approved. You can now continue toward ride access. Payment authorization may still be required before dispatch."
  });

  return {
    email: emailResult,
    sms: smsResult
  };
}

async function notifyRiderVerificationFailed(rider, reason = "") {
  if (!rider) return null;

  const fullName =
    `${clean(rider.first_name)} ${clean(rider.last_name)}`.trim() || "Rider";

  const emailResult = await sendEmailMessage({
    to: rider.email,
    subject: "Harvey Taxi rider verification update",
    category: "rider_verification_failed",
    text:
      `Hello ${fullName},\n\n` +
      `Your Harvey Taxi rider verification is not yet approved.\n` +
      `${reason ? `Reason: ${reason}\n\n` : "\n"}` +
      `Please contact support if you need help: ${SUPPORT_REPLY_TO}\n`
  });

  const smsResult = await sendSmsMessage({
    to: rider.phone,
    category: "rider_verification_failed",
    text:
      "Harvey Taxi: your rider verification is not yet approved. Please contact support if you need help."
  });

  return {
    email: emailResult,
    sms: smsResult
  };
}

async function notifyDriverVerificationApproved(driver) {
  if (!driver) return null;

  const fullName =
    `${clean(driver.first_name)} ${clean(driver.last_name)}`.trim() || "Driver";

  const emailResult = await sendEmailMessage({
    to: driver.email,
    subject: "Harvey Taxi driver identity verification approved",
    category: "driver_verification_approved",
    text:
      `Hello ${fullName},\n\n` +
      `Your Harvey Taxi driver identity verification has been approved.\n\n` +
      `You may still need email verification, SMS verification, background check review, and admin approval before receiving missions.\n\n` +
      `Support: ${SUPPORT_REPLY_TO}\n`
  });

  const smsResult = await sendSmsMessage({
    to: driver.phone,
    category: "driver_verification_approved",
    text:
      "Harvey Taxi: your driver identity verification has been approved. Other onboarding steps may still be required before missions."
  });

  return {
    email: emailResult,
    sms: smsResult
  };
}

async function notifyDriverVerificationFailed(driver, reason = "") {
  if (!driver) return null;

  const fullName =
    `${clean(driver.first_name)} ${clean(driver.last_name)}`.trim() || "Driver";

  const emailResult = await sendEmailMessage({
    to: driver.email,
    subject: "Harvey Taxi driver verification update",
    category: "driver_verification_failed",
    text:
      `Hello ${fullName},\n\n` +
      `Your Harvey Taxi driver verification is not yet approved.\n` +
      `${reason ? `Reason: ${reason}\n\n` : "\n"}` +
      `Please contact support if you need help: ${SUPPORT_REPLY_TO}\n`
  });

  const smsResult = await sendSmsMessage({
    to: driver.phone,
    category: "driver_verification_failed",
    text:
      "Harvey Taxi: your driver verification is not yet approved. Please contact support if you need help."
  });

  return {
    email: emailResult,
    sms: smsResult
  };
}

async function notifyDriverMissionOffered(driver, mission) {
  if (!driver || !mission) return null;

  const missionText =
    `Pickup: ${clean(mission.pickup_address)}\n` +
    `Dropoff: ${clean(mission.dropoff_address)}\n` +
    `Fare estimate: $${asCurrency(mission.fare_estimate).toFixed(2)}\n` +
    `Expires: ${mission.expires_at || "soon"}\n`;

  const emailResult = await sendEmailMessage({
    to: driver.email,
    subject: "New Harvey Taxi mission available",
    category: "driver_mission_offered",
    text:
      `Hello ${clean(driver.first_name) || "Driver"},\n\n` +
      `A new Harvey Taxi mission has been offered to you.\n\n` +
      `${missionText}\n` +
      `Log in to review and respond.\n`
  });

  const smsResult = await sendSmsMessage({
    to: driver.phone,
    category: "driver_mission_offered",
    text:
      `Harvey Taxi mission offered. Pickup: ${clean(mission.pickup_address)}. Dropoff: ${clean(mission.dropoff_address)}. Fare est: $${asCurrency(mission.fare_estimate).toFixed(2)}.`
  });

  return {
    email: emailResult,
    sms: smsResult
  };
}

/* =========================================================
   MISSION OFFER WITH NOTIFICATIONS
========================================================= */
async function createDispatchOfferForDriverWithNotifications({
  ride,
  rider,
  driver,
  requested_mode = "driver"
}) {
  const result = await createDispatchOfferForDriver({
    ride,
    rider,
    driver,
    requested_mode
  });

  try {
    await notifyDriverMissionOffered(driver, result.mission);
  } catch (notifyError) {
    console.warn("Mission notification warning:", notifyError.message);
  }

  return result;
}

/* =========================================================
   DISPATCH FLOWS WITH NOTIFICATIONS
========================================================= */
async function createInitialRideDispatch({
  ride,
  rider,
  requested_mode = "driver"
}) {
  const selectedDriver = await selectCandidateDriver(requested_mode);

  if (!selectedDriver) {
    await dbUpdate(
      TABLES.rides,
      { id: ride.id },
      {
        status: "no_driver_available",
        updated_at: nowIso()
      },
      { select: false }
    );

    await writeTripEvent({
      ride_id: ride.id,
      rider_id: ride.rider_id,
      event_type: "dispatch_failed",
      event_payload: {
        reason: "no_driver_available"
      }
    });

    return {
      selectedDriver: null,
      dispatch: null,
      mission: null,
      preview: null
    };
  }

  const offer = await createDispatchOfferForDriverWithNotifications({
    ride,
    rider,
    driver: selectedDriver,
    requested_mode
  });

  return {
    selectedDriver,
    dispatch: offer.dispatch,
    mission: offer.mission,
    preview: offer.preview
  };
}

async function attemptRedispatchForRideWithNotifications(
  rideId = "",
  reason = "redispatch_requested"
) {
  const ride = await getRideById(rideId);

  if (!ride) {
    return {
      ok: false,
      reason: "ride_not_found"
    };
  }

  const rideStatus = normalizeRideStatus(ride.status);
  if (["completed", "cancelled", "in_progress"].includes(rideStatus)) {
    return {
      ok: false,
      reason: `ride_not_eligible_${rideStatus}`
    };
  }

  const rider = await getRiderById(ride.rider_id);
  if (!rider) {
    return {
      ok: false,
      reason: "rider_not_found"
    };
  }

  const pastDispatches = await getDispatchesForRide(ride.id);
  const excludedDriverIds = pastDispatches
    .map((dispatch) => clean(dispatch.driver_id))
    .filter(Boolean);

  const currentAttempts = parseInteger(ride.dispatch_attempts, 0);

  if (currentAttempts >= MAX_DISPATCH_ATTEMPTS) {
    await dbUpdate(
      TABLES.rides,
      { id: ride.id },
      {
        status: "no_driver_available",
        updated_at: nowIso()
      },
      { select: false }
    );

    await writeTripEvent({
      ride_id: ride.id,
      rider_id: ride.rider_id,
      event_type: "dispatch_failed",
      event_payload: {
        reason: "max_dispatch_attempts_reached",
        dispatch_attempts: currentAttempts
      }
    });

    return {
      ok: false,
      reason: "max_dispatch_attempts_reached"
    };
  }

  const nextDriver = await getCandidateDriverExcluding({
    requestedMode: ride.requested_mode,
    excludedDriverIds
  });

  if (!nextDriver) {
    await dbUpdate(
      TABLES.rides,
      { id: ride.id },
      {
        status: "no_driver_available",
        updated_at: nowIso()
      },
      { select: false }
    );

    await writeTripEvent({
      ride_id: ride.id,
      rider_id: ride.rider_id,
      event_type: "dispatch_failed",
      event_payload: {
        reason: "no_additional_driver_available",
        dispatch_attempts: currentAttempts
      }
    });

    return {
      ok: false,
      reason: "no_additional_driver_available"
    };
  }

  const offer = await createDispatchOfferForDriverWithNotifications({
    ride,
    rider,
    driver: nextDriver,
    requested_mode: ride.requested_mode
  });

  await writeTripEvent({
    ride_id: ride.id,
    rider_id: ride.rider_id,
    driver_id: nextDriver.id,
    event_type: "redispatch_created",
    event_payload: {
      reason,
      dispatch_id: offer.dispatch.id,
      mission_id: offer.mission.id,
      dispatch_attempts_before: currentAttempts
    }
  });

  return {
    ok: true,
    reason: "redispatch_created",
    dispatch: offer.dispatch,
    mission: offer.mission,
    driver_id: nextDriver.id
  };
}

/* =========================================================
   PERSONA WEBHOOK PROCESSORS
========================================================= */
async function processRiderPersonaUpdate(rider, payload) {
  if (!rider) {
    return {
      ok: false,
      reason: "rider_not_found"
    };
  }

  const previousStatus = normalizePersonaOutcome(
    rider.persona_status || rider.verification_status || rider.identity_status || ""
  );

  const status = normalizePersonaOutcome(payload.status);
  const inquiryId = clean(payload.inquiry_id || rider.persona_inquiry_id || "");
  const eventName = clean(payload.raw_event_name || "");
  const failureReason = clean(
    payload.raw?.data?.attributes?.failure_reason ||
      payload.raw?.reason ||
      ""
  );

  const updates = {
    persona_inquiry_id: inquiryId || rider.persona_inquiry_id || null,
    verification_status: status,
    identity_status: status,
    persona_status: status,
    persona_updated_at: nowIso(),
    updated_at: nowIso()
  };

  if (status === "approved") {
    if (!clean(rider.approval_status)) {
      updates.approval_status = "pending";
    }
    updates.rejection_reason = null;
  }

  if (status === "failed") {
    updates.rejection_reason = failureReason || rider.rejection_reason || null;
  }

  const rows = await dbUpdate(
    TABLES.riders,
    { id: rider.id },
    updates
  );

  const updated = Array.isArray(rows) && rows[0] ? rows[0] : { ...rider, ...updates };

  await writeTripEvent({
    rider_id: rider.id,
    event_type: "persona_rider_verification_updated",
    event_payload: {
      persona_inquiry_id: inquiryId,
      status,
      previous_status: previousStatus,
      event_name: eventName,
      reason: failureReason || null
    }
  });

  if (status === "approved" && previousStatus !== "approved") {
    await notifyRiderVerificationApproved(updated);
  } else if (status === "failed" && previousStatus !== "failed") {
    await notifyRiderVerificationFailed(updated, failureReason);
  }

  return {
    ok: true,
    subject: "rider",
    rider: buildRiderPublicProfile(updated),
    persona_status: status
  };
}

async function processDriverPersonaUpdate(driver, payload) {
  if (!driver) {
    return {
      ok: false,
      reason: "driver_not_found"
    };
  }

  const previousStatus = normalizePersonaOutcome(
    driver.persona_status || driver.verification_status || driver.identity_status || ""
  );

  const status = normalizePersonaOutcome(payload.status);
  const inquiryId = clean(payload.inquiry_id || driver.persona_inquiry_id || "");
  const eventName = clean(payload.raw_event_name || "");
  const failureReason = clean(
    payload.raw?.data?.attributes?.failure_reason ||
      payload.raw?.reason ||
      ""
  );

  const updates = {
    persona_inquiry_id: inquiryId || driver.persona_inquiry_id || null,
    verification_status: status,
    identity_status: status,
    persona_status: status,
    persona_updated_at: nowIso(),
    updated_at: nowIso()
  };

  if (status === "approved") {
    updates.rejection_reason = null;
  }

  if (status === "failed") {
    updates.rejection_reason = failureReason || driver.rejection_reason || null;
  }

  const rows = await dbUpdate(
    TABLES.drivers,
    { id: driver.id },
    updates
  );

  const updated = Array.isArray(rows) && rows[0] ? rows[0] : { ...driver, ...updates };

  await writeTripEvent({
    driver_id: driver.id,
    event_type: "persona_driver_verification_updated",
    event_payload: {
      persona_inquiry_id: inquiryId,
      status,
      previous_status: previousStatus,
      event_name: eventName,
      reason: failureReason || null
    }
  });

  if (status === "approved" && previousStatus !== "approved") {
    await notifyDriverVerificationApproved(updated);
  } else if (status === "failed" && previousStatus !== "failed") {
    await notifyDriverVerificationFailed(updated, failureReason);
  }

  return {
    ok: true,
    subject: "driver",
    driver: buildDriverPublicProfile(updated),
    persona_status: status
  };
}

/* =========================================================
   PERSONA WEBHOOK ENDPOINT
========================================================= */
app.post(
  "/api/webhooks/persona",
  asyncHandler(async (req, res) => {
    if (!verifyPersonaWebhook(req)) {
      return fail(res, "Invalid Persona webhook signature.", 401);
    }

    const payload = extractPersonaPayload(req);

    if (!payload.inquiry_id && !payload.reference_id) {
      return fail(res, "Persona webhook payload is missing target identifiers.", 400);
    }

    const { rider, driver } = await resolvePersonaTarget(payload);

    if (!rider && !driver) {
      await writeAdminLog({
        action: "persona_webhook_target_not_found",
        actor_email: "persona_webhook",
        target_type: "persona",
        target_id: clean(payload.inquiry_id || payload.reference_id || "unknown"),
        details: {
          raw_event_name: payload.raw_event_name,
          status: payload.status
        }
      });

      return ok(
        res,
        {
          accepted: true,
          matched: false,
          payload_status: payload.status
        },
        "Persona webhook received, but no matching rider or driver was found."
      );
    }

    let result = null;

    if (rider) {
      result = await processRiderPersonaUpdate(rider, payload);
    } else if (driver) {
      result = await processDriverPersonaUpdate(driver, payload);
    }

    await writeAdminLog({
      action: "persona_webhook_processed",
      actor_email: "persona_webhook",
      target_type: result?.subject || "persona",
      target_id: clean(
        rider?.id || driver?.id || payload.inquiry_id || payload.reference_id || "unknown"
      ),
      details: {
        inquiry_id: payload.inquiry_id,
        reference_id: payload.reference_id,
        raw_event_name: payload.raw_event_name,
        status: payload.status
      }
    });

    return ok(
      res,
      {
        accepted: true,
        matched: true,
        result
      },
      "Persona webhook processed successfully."
    );
  })
);

/* =========================================================
   PERSONA STATUS HELPERS
========================================================= */
app.get(
  "/api/persona/config",
  requireAdmin,
  asyncHandler(async (req, res) => {
    return ok(
      res,
      {
        persona_enforcement_enabled: ENABLE_PERSONA_ENFORCEMENT,
        rider_template_id_present: Boolean(PERSONA_TEMPLATE_ID_RIDER),
        driver_template_id_present: Boolean(PERSONA_TEMPLATE_ID_DRIVER),
        webhook_secret_present: Boolean(PERSONA_WEBHOOK_SECRET)
      },
      "Persona config status loaded."
    );
  })
);

app.get(
  "/api/persona/rider-link/:riderId",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const rider = await getRiderById(req.params.riderId);

    if (!rider) {
      return fail(res, "Rider not found.", 404);
    }

    return ok(
      res,
      {
        rider_id: rider.id,
        persona_template_id: PERSONA_TEMPLATE_ID_RIDER || null,
        persona_inquiry_id: clean(rider.persona_inquiry_id || ""),
        reference_id: rider.id
      },
      "Rider Persona link metadata loaded."
    );
  })
);

app.get(
  "/api/persona/driver-link/:driverId",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const driver = await getDriverById(req.params.driverId);

    if (!driver) {
      return fail(res, "Driver not found.", 404);
    }

    return ok(
      res,
      {
        driver_id: driver.id,
        persona_template_id: PERSONA_TEMPLATE_ID_DRIVER || null,
        persona_inquiry_id: clean(driver.persona_inquiry_id || ""),
        reference_id: driver.id
      },
      "Driver Persona link metadata loaded."
    );
  })
);

/* =========================================================
   MISSION NOTIFICATION RESEND
========================================================= */
app.post(
  "/api/admin/missions/:missionId/resend-notification",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const missionId = clean(req.params.missionId);
    const mission = await getMissionById(missionId);

    if (!mission) {
      return fail(res, "Mission not found.", 404);
    }

    const driver = await getDriverById(mission.driver_id);
    if (!driver) {
      return fail(res, "Driver not found for this mission.", 404);
    }

    const result = await notifyDriverMissionOffered(driver, mission);

    await writeAdminLog({
      action: "mission_notification_resent",
      actor_email: getAdminCredentials(req).email,
      target_type: "mission",
      target_id: missionId,
      details: {
        driver_id: driver.id
      }
    });

    return ok(
      res,
      {
        result
      },
      "Mission notification resent."
    );
  })
);

/* =========================================================
   OPTIONAL ADMIN REDISPATCH WITH NOTIFICATIONS
========================================================= */
app.post(
  "/api/admin/rides/:rideId/redispatch-with-notification",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const rideId = clean(req.params.rideId);

    const result = await attemptRedispatchForRideWithNotifications(
      rideId,
      "admin_manual_redispatch_with_notification"
    );

    await writeAdminLog({
      action: "admin_manual_redispatch_with_notification",
      actor_email: getAdminCredentials(req).email,
      target_type: "ride",
      target_id: rideId,
      details: result
    });

    if (!result.ok) {
      return fail(res, "Redispatch could not be created.", 409, result);
    }

    return ok(
      res,
      {
        result
      },
      "Redispatch with notification created successfully."
    );
  })
);

/* =========================================================
   FINAL PRODUCTION STATUS ROUTES
========================================================= */
app.get(
  "/api/production/status",
  asyncHandler(async (req, res) => {
    return ok(
      res,
      {
        app: APP_NAME,
        version: APP_VERSION,
        started_at: SERVER_STARTED_AT,
        supabase_ready: supabaseReady,
        ai_ready: Boolean(openai),
        persona_enforcement_enabled: ENABLE_PERSONA_ENFORCEMENT,
        real_email_enabled: ENABLE_REAL_EMAIL,
        real_sms_enabled: ENABLE_REAL_SMS,
        twilio_configured: Boolean(twilioClient && TWILIO_FROM_NUMBER),
        public_app_url: PUBLIC_APP_URL
      },
      "Production status loaded."
    );
  })
);

/* =========================================================
   NOT FOUND HANDLER
========================================================= */
app.use((req, res) => {
  return fail(res, `Route not found: ${req.method} ${req.originalUrl}`, 404);
});

/* =========================================================
   CENTRAL ERROR HANDLER
========================================================= */
app.use((error, req, res, next) => {
  console.error("UNCAUGHT EXPRESS ERROR:", error);

  return res.status(500).json({
    ok: false,
    message: "Unhandled server error.",
    error: clean(error?.message || "Unknown error")
  });
});

/* =========================================================
   FINAL SERVER START
========================================================= */
app.listen(PORT, () => {
  console.log(`✅ ${APP_NAME} running on port ${PORT}`);
  console.log(`🏷️ Version: ${APP_VERSION}`);
  console.log(`🌍 Public URL: ${PUBLIC_APP_URL || "not set"}`);
  console.log(`🕒 Started at: ${SERVER_STARTED_AT}`);
  console.log(`🧠 AI enabled: ${Boolean(openai)}`);
  console.log(`🗄️ Supabase ready: ${supabaseReady}`);
  console.log(`🛂 Persona enforcement: ${ENABLE_PERSONA_ENFORCEMENT}`);
  console.log(`📧 Real email enabled: ${ENABLE_REAL_EMAIL}`);
  console.log(`📱 Real SMS enabled: ${ENABLE_REAL_SMS}`);
  console.log(`📲 Twilio configured: ${Boolean(twilioClient && TWILIO_FROM_NUMBER)}`);
});

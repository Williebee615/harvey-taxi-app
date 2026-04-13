/* =========================================================
   HARVEY TAXI — CODE BLUE CLEAN REBUILD
   PART 1: FOUNDATION + ENV + CLIENTS + HELPERS + HEALTH
   FILE: server.js
========================================================= */

const express = require("express");
const cors = require("cors");
const path = require("path");
const crypto = require("crypto");
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
const APP_NAME = "Harvey Taxi Code Blue";
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
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function safeJsonParse(value, fallback = null) {
  try {
    return JSON.parse(value);
  } catch (error) {
    return fallback;
  }
}

/* =========================================================
   CORE ENV
========================================================= */
const NODE_ENV = cleanEnv(process.env.NODE_ENV || "development");
const PUBLIC_APP_URL =
  cleanEnv(process.env.PUBLIC_APP_URL) ||
  cleanEnv(process.env.RENDER_EXTERNAL_URL) ||
  cleanEnv(process.env.APP_BASE_URL) ||
  `http://localhost:${PORT}`;

const SUPPORT_EMAIL =
  cleanEnv(process.env.SUPPORT_EMAIL) ||
  cleanEnv(process.env.SUPPORT_FROM_EMAIL) ||
  "support@harveytaxiservice.com";

const ADMIN_EMAIL =
  cleanEnv(process.env.ADMIN_EMAIL) ||
  "williebee@harveytaxiservice.com";

const ADMIN_PASSWORD = cleanEnv(process.env.ADMIN_PASSWORD);

/* =========================================================
   FEATURE FLAGS
========================================================= */
const ENABLE_AI_BRAIN = toBool(process.env.ENABLE_AI_BRAIN, true);
const ENABLE_RIDER_VERIFICATION_GATE = toBool(
  process.env.ENABLE_RIDER_VERIFICATION_GATE,
  true
);
const ENABLE_PAYMENT_GATE = toBool(process.env.ENABLE_PAYMENT_GATE, true);
const ENABLE_DRIVER_APPROVAL_GATE = toBool(
  process.env.ENABLE_DRIVER_APPROVAL_GATE,
  true
);
const ENABLE_AUTO_REDISPATCH = toBool(
  process.env.ENABLE_AUTO_REDISPATCH,
  true
);
const ENABLE_STARTUP_TABLE_CHECKS = toBool(
  process.env.ENABLE_STARTUP_TABLE_CHECKS,
  true
);
const ENABLE_PERSONA_ENFORCEMENT = toBool(
  process.env.ENABLE_PERSONA_ENFORCEMENT,
  true
);

/* =========================================================
   DISPATCH / TIMING CONFIG
========================================================= */
const DISPATCH_TIMEOUT_SECONDS = toNumber(
  process.env.DISPATCH_TIMEOUT_SECONDS,
  30
);
const MAX_DISPATCH_ATTEMPTS = toNumber(
  process.env.MAX_DISPATCH_ATTEMPTS,
  5
);
const DISPATCH_SWEEP_INTERVAL_MS = toNumber(
  process.env.DISPATCH_SWEEP_INTERVAL_MS,
  15000
);

/* =========================================================
   FARE CONFIG
========================================================= */
const BASE_FARE = toNumber(process.env.BASE_FARE, 4.5);
const BOOKING_FEE = toNumber(process.env.BOOKING_FEE, 2.0);
const COST_PER_MILE = toNumber(process.env.COST_PER_MILE, 1.8);
const COST_PER_MINUTE = toNumber(process.env.COST_PER_MINUTE, 0.35);
const MINIMUM_FARE = toNumber(process.env.MINIMUM_FARE, 8.5);

const SURGE_MULTIPLIER_DEFAULT = toNumber(
  process.env.SURGE_MULTIPLIER_DEFAULT,
  1
);
const SURGE_MULTIPLIER_BUSY = toNumber(
  process.env.SURGE_MULTIPLIER_BUSY,
  1.25
);
const SURGE_MULTIPLIER_HIGH = toNumber(
  process.env.SURGE_MULTIPLIER_HIGH,
  1.5
);

const HUMAN_DRIVER_PAYOUT_PERCENT = toNumber(
  process.env.HUMAN_DRIVER_PAYOUT_PERCENT,
  0.75
);
const AUTONOMOUS_DRIVER_PAYOUT_PERCENT = toNumber(
  process.env.AUTONOMOUS_DRIVER_PAYOUT_PERCENT,
  0.2
);

/* =========================================================
   OPENAI CONFIG
========================================================= */
const OPENAI_API_KEY = cleanEnv(process.env.OPENAI_API_KEY);
const OPENAI_MODEL =
  cleanEnv(process.env.OPENAI_SUPPORT_MODEL) ||
  cleanEnv(process.env.OPENAI_MODEL) ||
  "gpt-4.1-mini";

const openai =
  OpenAI && OPENAI_API_KEY && ENABLE_AI_BRAIN
    ? new OpenAI({ apiKey: OPENAI_API_KEY })
    : null;

/* =========================================================
   SUPABASE CONFIG
========================================================= */
const SUPABASE_URL = cleanEnv(process.env.SUPABASE_URL);
const SUPABASE_SERVICE_ROLE_KEY = cleanEnv(
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const supabase =
  SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false }
      })
    : null;

/* =========================================================
   MAPS CONFIG
========================================================= */
const GOOGLE_MAPS_API_KEY = cleanEnv(process.env.GOOGLE_MAPS_API_KEY);

/* =========================================================
   COMMUNICATION CONFIG
========================================================= */
const ENABLE_REAL_EMAIL = toBool(process.env.ENABLE_REAL_EMAIL, false);
const ENABLE_REAL_SMS = toBool(process.env.ENABLE_REAL_SMS, false);

const SENDGRID_API_KEY = cleanEnv(process.env.SENDGRID_API_KEY);
const RESEND_API_KEY = cleanEnv(process.env.RESEND_API_KEY);

const SMTP_HOST = cleanEnv(process.env.SMTP_HOST);
const SMTP_PORT = toNumber(process.env.SMTP_PORT, 587);
const SMTP_USER = cleanEnv(process.env.SMTP_USER);
const SMTP_PASS = cleanEnv(process.env.SMTP_PASS);
const SMTP_FROM =
  cleanEnv(process.env.SMTP_FROM) ||
  cleanEnv(process.env.EMAIL_FROM) ||
  cleanEnv(process.env.SUPPORT_FROM_EMAIL) ||
  SUPPORT_EMAIL;

const TWILIO_ACCOUNT_SID = cleanEnv(process.env.TWILIO_ACCOUNT_SID);
const TWILIO_AUTH_TOKEN = cleanEnv(process.env.TWILIO_AUTH_TOKEN);
const TWILIO_PHONE_NUMBER =
  cleanEnv(process.env.TWILIO_PHONE_NUMBER) ||
  cleanEnv(process.env.TWILIO_FROM_NUMBER);

/* =========================================================
   PERSONA CONFIG
========================================================= */
const PERSONA_API_KEY = cleanEnv(process.env.PERSONA_API_KEY);
const PERSONA_TEMPLATE_ID_RIDER = cleanEnv(
  process.env.PERSONA_TEMPLATE_ID_RIDER
);
const PERSONA_TEMPLATE_ID_DRIVER = cleanEnv(
  process.env.PERSONA_TEMPLATE_ID_DRIVER
);
const PERSONA_WEBHOOK_SECRET = cleanEnv(
  process.env.PERSONA_WEBHOOK_SECRET
);

/* =========================================================
   CONSTANTS
========================================================= */
const DRIVER_TYPES = {
  HUMAN: "human",
  AUTONOMOUS: "autonomous"
};

const RIDE_STATUS = {
  PENDING: "pending",
  AWAITING_DRIVER_ACCEPTANCE: "awaiting_driver_acceptance",
  DISPATCHED: "dispatched",
  DRIVER_EN_ROUTE: "driver_en_route",
  DRIVER_ARRIVED: "driver_arrived",
  IN_PROGRESS: "in_progress",
  COMPLETED: "completed",
  CANCELLED: "cancelled",
  NO_DRIVER_AVAILABLE: "no_driver_available",
  FAILED: "failed"
};

const DISPATCH_STATUS = {
  OFFERED: "offered",
  ACCEPTED: "accepted",
  DECLINED: "declined",
  EXPIRED: "expired",
  CANCELLED: "cancelled",
  FAILED: "failed"
};

const DRIVER_STATUS = {
  PENDING: "pending",
  ACTIVE: "active",
  OFFLINE: "offline",
  SUSPENDED: "suspended"
};

const VERIFICATION_STATUS = {
  PENDING: "pending",
  SUBMITTED: "submitted",
  UNDER_REVIEW: "under_review",
  APPROVED: "approved",
  REJECTED: "rejected",
  FAILED: "failed"
};

/* =========================================================
   SMALL HELPERS
========================================================= */
function nowIso() {
  return new Date().toISOString();
}

function generateId(prefix = "id") {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}

function lower(value = "") {
  return cleanEnv(value).toLowerCase();
}

function digitsOnly(value = "") {
  return String(value || "").replace(/\D/g, "");
}

function normalizeEmail(value = "") {
  return lower(value);
}

function normalizePhone(value = "") {
  const digits = digitsOnly(value);
  if (!digits) return "";
  if (digits.length === 10) return `+1${digits}`;
  if (digits.startsWith("1") && digits.length === 11) return `+${digits}`;
  if (value.startsWith("+")) return value.trim();
  return `+${digits}`;
}

function isValidEmail(value = "") {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEnv(value));
}

function isValidPassword(value = "") {
  return String(value || "").length >= 8;
}

function hashValue(value = "") {
  return crypto
    .createHash("sha256")
    .update(String(value || ""))
    .digest("hex");
}

function maskEmail(email = "") {
  const normalized = normalizeEmail(email);
  const [name, domain] = normalized.split("@");
  if (!name || !domain) return "";
  if (name.length <= 2) return `${name[0] || "*"}***@${domain}`;
  return `${name.slice(0, 2)}***@${domain}`;
}

function maskPhone(phone = "") {
  const normalized = normalizePhone(phone);
  if (!normalized) return "";
  const last4 = normalized.slice(-4);
  return `***-***-${last4}`;
}

function requireSupabase() {
  if (!supabase) {
    const error = new Error(
      "Supabase is not configured. Check SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY."
    );
    error.statusCode = 500;
    throw error;
  }
}

function cleanObject(input = {}) {
  const output = {};
  for (const [key, value] of Object.entries(input || {})) {
    if (value === undefined) continue;
    output[key] = typeof value === "string" ? cleanEnv(value) : value;
  }
  return output;
}

function parseCoordinate(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatCurrency(value = 0) {
  return Number(value || 0).toFixed(2);
}

function sleep(ms = 0) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* =========================================================
   AUTH / ADMIN HELPERS
========================================================= */
function getAdminEmailFromRequest(req) {
  return normalizeEmail(
    req.headers["x-admin-email"] ||
      req.body?.adminEmail ||
      req.query?.adminEmail ||
      ""
  );
}

function getAdminPasswordFromRequest(req) {
  return cleanEnv(
    req.headers["x-admin-password"] ||
      req.body?.adminPassword ||
      req.query?.adminPassword ||
      ""
  );
}

function isAdminRequest(req) {
  const email = getAdminEmailFromRequest(req);
  const password = getAdminPasswordFromRequest(req);

  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) return false;
  return email === normalizeEmail(ADMIN_EMAIL) && password === ADMIN_PASSWORD;
}

function requireAdmin(req, res, next) {
  if (!isAdminRequest(req)) {
    return res.status(401).json({
      ok: false,
      error: "Unauthorized admin request."
    });
  }
  next();
}

/* =========================================================
   RESPONSE HELPERS
========================================================= */
function success(res, payload = {}, status = 200) {
  return res.status(status).json({
    ok: true,
    ...payload
  });
}

function fail(res, error, status = 400, extra = {}) {
  return res.status(status).json({
    ok: false,
    error: typeof error === "string" ? error : "Request failed.",
    ...extra
  });
}

/* =========================================================
   ASYNC WRAPPER
========================================================= */
function asyncHandler(fn) {
  return function wrappedHandler(req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/* =========================================================
   DATABASE HELPERS
========================================================= */
async function maybeInsertAdminLog({
  action = "",
  entity_type = "",
  entity_id = "",
  admin_email = "",
  details = {}
}) {
  if (!supabase) return;

  try {
    await supabase.from("admin_logs").insert({
      id: generateId("alog"),
      action: cleanEnv(action),
      entity_type: cleanEnv(entity_type),
      entity_id: cleanEnv(entity_id),
      admin_email: normalizeEmail(admin_email || ADMIN_EMAIL),
      details,
      created_at: nowIso()
    });
  } catch (error) {
    console.warn("⚠️ admin_logs insert skipped:", error.message);
  }
}

async function maybeInsertTripEvent({
  ride_id = "",
  mission_id = "",
  event_type = "",
  actor_type = "",
  actor_id = "",
  payload = {}
}) {
  if (!supabase) return;

  try {
    await supabase.from("trip_events").insert({
      id: generateId("tevt"),
      ride_id: cleanEnv(ride_id) || null,
      mission_id: cleanEnv(mission_id) || null,
      event_type: cleanEnv(event_type),
      actor_type: cleanEnv(actor_type) || null,
      actor_id: cleanEnv(actor_id) || null,
      payload,
      created_at: nowIso()
    });
  } catch (error) {
    console.warn("⚠️ trip_events insert skipped:", error.message);
  }
}

async function getTableCount(tableName) {
  requireSupabase();

  const { count, error } = await supabase
    .from(tableName)
    .select("*", { count: "exact", head: true });

  if (error) {
    return {
      ok: false,
      table: tableName,
      count: null,
      error: error.message
    };
  }

  return {
    ok: true,
    table: tableName,
    count: Number(count || 0)
  };
}

/* =========================================================
   DISTANCE / TIME HELPERS
========================================================= */
function haversineMiles(lat1, lon1, lat2, lon2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const R = 3958.8;

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) ** 2;

  return 2 * R * Math.asin(Math.sqrt(a));
}

function estimateDurationMinutes(distanceMiles = 0) {
  const averageCitySpeedMph = 24;
  const drivingMinutes = (Number(distanceMiles || 0) / averageCitySpeedMph) * 60;
  return Math.max(5, Math.round(drivingMinutes));
}

function getSurgeMultiplier({ highDemand = false, busy = false } = {}) {
  if (highDemand) return SURGE_MULTIPLIER_HIGH;
  if (busy) return SURGE_MULTIPLIER_BUSY;
  return SURGE_MULTIPLIER_DEFAULT;
}

function calculateFare({
  distanceMiles = 0,
  durationMinutes = 0,
  surgeMultiplier = 1,
  requestedMode = DRIVER_TYPES.HUMAN
} = {}) {
  const rawFare =
    (BASE_FARE +
      BOOKING_FEE +
      Number(distanceMiles || 0) * COST_PER_MILE +
      Number(durationMinutes || 0) * COST_PER_MINUTE) *
    Number(surgeMultiplier || 1);

  const finalFare = Math.max(MINIMUM_FARE, rawFare);

  const payoutPercent =
    requestedMode === DRIVER_TYPES.AUTONOMOUS
      ? AUTONOMOUS_DRIVER_PAYOUT_PERCENT
      : HUMAN_DRIVER_PAYOUT_PERCENT;

  const driverPayout = Number(finalFare) * Number(payoutPercent || 0);
  const platformRevenue = Number(finalFare) - Number(driverPayout);

  return {
    fare: Number(finalFare.toFixed(2)),
    driver_payout: Number(driverPayout.toFixed(2)),
    platform_revenue: Number(platformRevenue.toFixed(2)),
    surge_multiplier: Number(Number(surgeMultiplier || 1).toFixed(2))
  };
}

/* =========================================================
   VERIFICATION HELPERS
========================================================= */
function riderIsApproved(rider = {}) {
  const status = lower(rider.verification_status || rider.rider_status || "");
  const approved =
    toBool(rider.is_approved, false) ||
    status === VERIFICATION_STATUS.APPROVED;

  return approved;
}

function driverCanReceiveDispatch(driver = {}) {
  const approvalStatus = lower(driver.approval_status || "");
  const verificationStatus = lower(driver.verification_status || "");
  const driverStatus = lower(driver.status || "");

  const emailVerified = toBool(driver.email_verified, false);
  const smsVerified = toBool(driver.sms_verified, false);

  const passesApproval =
    !ENABLE_DRIVER_APPROVAL_GATE ||
    approvalStatus === VERIFICATION_STATUS.APPROVED ||
    toBool(driver.is_approved, false);

  const passesVerification =
    verificationStatus === VERIFICATION_STATUS.APPROVED ||
    (!ENABLE_PERSONA_ENFORCEMENT &&
      verificationStatus !== VERIFICATION_STATUS.REJECTED);

  return (
    emailVerified &&
    smsVerified &&
    passesApproval &&
    passesVerification &&
    [DRIVER_STATUS.ACTIVE, "available"].includes(driverStatus)
  );
}

function paymentAuthorizationIsValid(payment = {}) {
  const status = lower(payment.status || payment.payment_status || "");
  return ["authorized", "preauthorized", "held"].includes(status);
}

/* =========================================================
   SYSTEM ROUTES
========================================================= */
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/api", (req, res) => {
  return success(res, {
    app: APP_NAME,
    status: "ok",
    started_at: SERVER_STARTED_AT,
    environment: NODE_ENV
  });
});

app.get(
  "/api/health",
  asyncHandler(async (req, res) => {
    const base = {
      app: APP_NAME,
      ok: true,
      environment: NODE_ENV,
      started_at: SERVER_STARTED_AT,
      now: nowIso(),
      public_app_url: PUBLIC_APP_URL,
      features: {
        ai_brain: !!openai,
        rider_verification_gate: ENABLE_RIDER_VERIFICATION_GATE,
        payment_gate: ENABLE_PAYMENT_GATE,
        driver_approval_gate: ENABLE_DRIVER_APPROVAL_GATE,
        auto_redispatch: ENABLE_AUTO_REDISPATCH,
        persona_enforcement: ENABLE_PERSONA_ENFORCEMENT
      },
      services: {
        supabase_configured: !!supabase,
        maps_configured: !!GOOGLE_MAPS_API_KEY,
        openai_configured: !!openai,
        persona_configured: !!PERSONA_API_KEY,
        twilio_configured:
          !!TWILIO_ACCOUNT_SID &&
          !!TWILIO_AUTH_TOKEN &&
          !!TWILIO_PHONE_NUMBER,
        smtp_configured:
          !!SMTP_HOST && !!SMTP_PORT && !!SMTP_USER && !!SMTP_PASS,
        sendgrid_configured: !!SENDGRID_API_KEY,
        resend_configured: !!RESEND_API_KEY
      },
      support_email: SUPPORT_EMAIL,
      admin_email: ADMIN_EMAIL
    };

    if (!supabase || !ENABLE_STARTUP_TABLE_CHECKS) {
      return success(res, base);
    }

    const tablesToCheck = [
      "riders",
      "drivers",
      "rides",
      "payments",
      "missions",
      "dispatches",
      "admin_logs"
    ];

    const tableResults = [];
    for (const tableName of tablesToCheck) {
      tableResults.push(await getTableCount(tableName));
    }

    return success(res, {
      ...base,
      startup_table_checks: tableResults
    });
  })
);

/* =========================================================
   NOT FOUND HANDLER
========================================================= */
app.use((req, res) => {
  return fail(res, `Route not found: ${req.method} ${req.originalUrl}`, 404);
});

/* =========================================================
   ERROR HANDLER
========================================================= */
app.use((error, req, res, next) => {
  const statusCode = Number(error.statusCode || 500);
  console.error("❌ Unhandled server error:", error);

  return res.status(statusCode).json({
    ok: false,
    error: error.message || "Internal server error.",
    stack: NODE_ENV === "production" ? undefined : error.stack
  });
});

/* =========================================================
   START SERVER
========================================================= */
app.listen(PORT, () => {
  console.log(`🚕 ${APP_NAME} running on port ${PORT}`);
  console.log(`🌐 Public URL: ${PUBLIC_APP_URL || `http://localhost:${PORT}`}`);
  console.log(`🕒 Started: ${SERVER_STARTED_AT}`);
});/* =========================================================
   HARVEY TAXI — CODE BLUE CLEAN REBUILD
   PART 2: RIDERS + SIGNUP + STATUS + APPROVAL GATE
   ADD THIS BELOW PART 1 HELPERS / BEFORE NOT FOUND HANDLER
========================================================= */

/* =========================================================
   RIDER HELPERS
========================================================= */
function normalizeDocumentType(value = "") {
  const type = lower(value);

  if (["id", "state_id", "driver_license", "license", "identification"].includes(type)) {
    return "id";
  }

  if (["passport", "passport_book", "passport_card"].includes(type)) {
    return "passport";
  }

  return type || "id";
}

function getRiderApprovalSnapshot(rider = {}) {
  const verificationStatus = lower(
    rider.verification_status ||
      rider.rider_status ||
      rider.persona_status ||
      ""
  );

  const manuallyApproved = toBool(rider.is_approved, false);
  const documentVerified = toBool(rider.document_verified, false);
  const personaApproved =
    verificationStatus === VERIFICATION_STATUS.APPROVED ||
    verificationStatus === "completed" ||
    verificationStatus === "verified";

  const approved = manuallyApproved || documentVerified || personaApproved;

  return {
    approved,
    manuallyApproved,
    documentVerified,
    personaApproved,
    verificationStatus: verificationStatus || VERIFICATION_STATUS.PENDING
  };
}

function sanitizeRiderResponse(rider = {}) {
  const snapshot = getRiderApprovalSnapshot(rider);

  return {
    id: rider.id,
    rider_id: rider.id,
    first_name: rider.first_name || "",
    last_name: rider.last_name || "",
    full_name:
      cleanEnv(`${rider.first_name || ""} ${rider.last_name || ""}`).trim(),
    email: normalizeEmail(rider.email || ""),
    email_masked: maskEmail(rider.email || ""),
    phone: normalizePhone(rider.phone || ""),
    phone_masked: maskPhone(rider.phone || ""),
    city: rider.city || "",
    state: rider.state || "",
    verification_status: snapshot.verificationStatus,
    is_approved: snapshot.approved,
    rider_status: snapshot.approved ? "approved" : "pending",
    document_type: normalizeDocumentType(rider.document_type || ""),
    document_verified: snapshot.documentVerified,
    persona_inquiry_id: rider.persona_inquiry_id || null,
    created_at: rider.created_at || null,
    updated_at: rider.updated_at || null
  };
}

async function getRiderById(riderId = "") {
  requireSupabase();

  const id = cleanEnv(riderId);
  if (!id) return null;

  const { data, error } = await supabase
    .from("riders")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load rider: ${error.message}`);
  }

  return data || null;
}

async function getRiderByEmail(email = "") {
  requireSupabase();

  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return null;

  const { data, error } = await supabase
    .from("riders")
    .select("*")
    .eq("email", normalizedEmail)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load rider by email: ${error.message}`);
  }

  return data || null;
}

async function getRiderByPhone(phone = "") {
  requireSupabase();

  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) return null;

  const { data, error } = await supabase
    .from("riders")
    .select("*")
    .eq("phone", normalizedPhone)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load rider by phone: ${error.message}`);
  }

  return data || null;
}

async function requireApprovedRider(riderId = "") {
  const rider = await getRiderById(riderId);

  if (!rider) {
    const error = new Error("Rider not found.");
    error.statusCode = 404;
    throw error;
  }

  const snapshot = getRiderApprovalSnapshot(rider);

  if (ENABLE_RIDER_VERIFICATION_GATE && !snapshot.approved) {
    const error = new Error(
      "Rider is not yet approved. Complete identity verification before requesting a ride."
    );
    error.statusCode = 403;
    error.details = {
      rider_id: rider.id,
      verification_status: snapshot.verificationStatus,
      is_approved: snapshot.approved
    };
    throw error;
  }

  return rider;
}

async function upsertRiderStatusLog({
  rider_id = "",
  event_type = "",
  payload = {}
}) {
  await maybeInsertAdminLog({
    action: event_type,
    entity_type: "rider",
    entity_id: rider_id,
    admin_email: ADMIN_EMAIL,
    details: payload
  });
}

function getRiderPasswordHash(password = "") {
  return hashValue(password);
}

function buildRiderSessionPayload(rider = {}) {
  const safe = sanitizeRiderResponse(rider);
  return {
    rider_id: safe.id,
    rider: safe
  };
}

/* =========================================================
   RIDER SIGNUP
========================================================= */
app.post(
  "/api/rider/signup",
  asyncHandler(async (req, res) => {
    requireSupabase();

    const first_name = cleanEnv(req.body?.firstName || req.body?.first_name);
    const last_name = cleanEnv(req.body?.lastName || req.body?.last_name);
    const phone = normalizePhone(req.body?.phone);
    const email = normalizeEmail(req.body?.email);
    const city = cleanEnv(req.body?.city);
    const state = cleanEnv(req.body?.state || req.body?.stateValue || "TN");
    const password = cleanEnv(req.body?.password);
    const confirmPassword = cleanEnv(
      req.body?.confirmPassword || req.body?.confirm_password
    );
    const document_type = normalizeDocumentType(
      req.body?.documentType || req.body?.document_type || "id"
    );

    const document_number = cleanEnv(
      req.body?.documentNumber || req.body?.document_number
    );
    const document_country = cleanEnv(
      req.body?.documentCountry || req.body?.document_country || "US"
    );

    if (!first_name) {
      return fail(res, "First name is required.", 400);
    }

    if (!last_name) {
      return fail(res, "Last name is required.", 400);
    }

    if (!email || !isValidEmail(email)) {
      return fail(res, "A valid email is required.", 400);
    }

    if (!phone) {
      return fail(res, "A valid phone number is required.", 400);
    }

    if (!city) {
      return fail(res, "City is required.", 400);
    }

    if (!state) {
      return fail(res, "State is required.", 400);
    }

    if (!password || !isValidPassword(password)) {
      return fail(
        res,
        "Password must be at least 8 characters long.",
        400
      );
    }

    if (password !== confirmPassword) {
      return fail(res, "Passwords do not match.", 400);
    }

    if (!["id", "passport"].includes(document_type)) {
      return fail(
        res,
        "Document type must be either id or passport.",
        400
      );
    }

    const existingByEmail = await getRiderByEmail(email);
    if (existingByEmail) {
      return fail(
        res,
        "A rider account with that email already exists.",
        409,
        {
          rider_id: existingByEmail.id,
          rider: sanitizeRiderResponse(existingByEmail)
        }
      );
    }

    const existingByPhone = await getRiderByPhone(phone);
    if (existingByPhone) {
      return fail(
        res,
        "A rider account with that phone number already exists.",
        409,
        {
          rider_id: existingByPhone.id,
          rider: sanitizeRiderResponse(existingByPhone)
        }
      );
    }

    const riderId = generateId("rider");
    const password_hash = getRiderPasswordHash(password);
    const created_at = nowIso();

    const insertPayload = cleanObject({
      id: riderId,
      first_name,
      last_name,
      phone,
      email,
      city,
      state,
      password_hash,
      document_type,
      document_number: document_number || null,
      document_country: document_country || null,

      /* Critical gate defaults */
      verification_status: VERIFICATION_STATUS.PENDING,
      rider_status: "pending",
      is_approved: false,
      document_verified: false,
      persona_status: VERIFICATION_STATUS.PENDING,
      persona_inquiry_id: null,

      created_at,
      updated_at: created_at
    });

    const { data, error } = await supabase
      .from("riders")
      .insert(insertPayload)
      .select("*")
      .single();

    if (error) {
      return fail(res, `Rider signup failed: ${error.message}`, 500);
    }

    await upsertRiderStatusLog({
      rider_id: data.id,
      event_type: "rider_signup_created",
      payload: {
        rider_id: data.id,
        email: email,
        phone: phone,
        document_type,
        verification_status: VERIFICATION_STATUS.PENDING
      }
    });

    return success(
      res,
      {
        message:
          "Rider signup submitted. Approval is required before ride requests are allowed.",
        ...buildRiderSessionPayload(data)
      },
      201
    );
  })
);

/* =========================================================
   RIDER LOGIN
========================================================= */
app.post(
  "/api/rider/login",
  asyncHandler(async (req, res) => {
    requireSupabase();

    const email = normalizeEmail(req.body?.email);
    const password = cleanEnv(req.body?.password);

    if (!email || !password) {
      return fail(res, "Email and password are required.", 400);
    }

    const rider = await getRiderByEmail(email);

    if (!rider) {
      return fail(res, "Invalid email or password.", 401);
    }

    const incomingHash = getRiderPasswordHash(password);
    if (incomingHash !== cleanEnv(rider.password_hash)) {
      return fail(res, "Invalid email or password.", 401);
    }

    return success(res, {
      message: "Rider login successful.",
      ...buildRiderSessionPayload(rider)
    });
  })
);

/* =========================================================
   RIDER STATUS CHECK
========================================================= */
app.get(
  "/api/rider-status",
  asyncHandler(async (req, res) => {
    requireSupabase();

    const rider_id = cleanEnv(req.query?.rider_id || req.query?.riderId);
    const email = normalizeEmail(req.query?.email);
    const phone = normalizePhone(req.query?.phone);

    let rider = null;

    if (rider_id) {
      rider = await getRiderById(rider_id);
    } else if (email) {
      rider = await getRiderByEmail(email);
    } else if (phone) {
      rider = await getRiderByPhone(phone);
    } else {
      return fail(
        res,
        "Provide rider_id, email, or phone to check rider status.",
        400
      );
    }

    if (!rider) {
      return fail(res, "Rider not found.", 404);
    }

    const snapshot = getRiderApprovalSnapshot(rider);

    return success(res, {
      rider_id: rider.id,
      rider: sanitizeRiderResponse(rider),
      verification_status: snapshot.verificationStatus,
      is_approved: snapshot.approved,
      can_request_ride: !ENABLE_RIDER_VERIFICATION_GATE || snapshot.approved,
      message: snapshot.approved
        ? "Rider is approved."
        : "Rider is pending verification approval."
    });
  })
);

/* =========================================================
   RIDER PROFILE
========================================================= */
app.get(
  "/api/riders/:riderId",
  asyncHandler(async (req, res) => {
    requireSupabase();

    const rider = await getRiderById(req.params.riderId);

    if (!rider) {
      return fail(res, "Rider not found.", 404);
    }

    return success(res, {
      rider: sanitizeRiderResponse(rider)
    });
  })
);

/* =========================================================
   RIDER UPDATE
========================================================= */
app.patch(
  "/api/riders/:riderId",
  asyncHandler(async (req, res) => {
    requireSupabase();

    const riderId = cleanEnv(req.params.riderId);
    const existing = await getRiderById(riderId);

    if (!existing) {
      return fail(res, "Rider not found.", 404);
    }

    const nextFirstName = cleanEnv(req.body?.firstName || req.body?.first_name);
    const nextLastName = cleanEnv(req.body?.lastName || req.body?.last_name);
    const nextCity = cleanEnv(req.body?.city);
    const nextState = cleanEnv(req.body?.state);
    const nextPhoneRaw = req.body?.phone;
    const nextEmailRaw = req.body?.email;

    const updatePayload = cleanObject({
      first_name: nextFirstName || existing.first_name,
      last_name: nextLastName || existing.last_name,
      city: nextCity || existing.city,
      state: nextState || existing.state,
      updated_at: nowIso()
    });

    if (nextPhoneRaw) {
      const nextPhone = normalizePhone(nextPhoneRaw);
      if (!nextPhone) {
        return fail(res, "Invalid phone number.", 400);
      }

      const phoneOwner = await getRiderByPhone(nextPhone);
      if (phoneOwner && phoneOwner.id !== existing.id) {
        return fail(res, "Phone number is already in use.", 409);
      }

      updatePayload.phone = nextPhone;
    }

    if (nextEmailRaw) {
      const nextEmail = normalizeEmail(nextEmailRaw);
      if (!isValidEmail(nextEmail)) {
        return fail(res, "Invalid email address.", 400);
      }

      const emailOwner = await getRiderByEmail(nextEmail);
      if (emailOwner && emailOwner.id !== existing.id) {
        return fail(res, "Email is already in use.", 409);
      }

      updatePayload.email = nextEmail;
    }

    const { data, error } = await supabase
      .from("riders")
      .update(updatePayload)
      .eq("id", existing.id)
      .select("*")
      .single();

    if (error) {
      return fail(res, `Failed to update rider: ${error.message}`, 500);
    }

    await upsertRiderStatusLog({
      rider_id: data.id,
      event_type: "rider_profile_updated",
      payload: {
        rider_id: data.id
      }
    });

    return success(res, {
      message: "Rider profile updated.",
      rider: sanitizeRiderResponse(data)
    });
  })
);

/* =========================================================
   RIDER PASSWORD UPDATE
========================================================= */
app.post(
  "/api/riders/:riderId/update-password",
  asyncHandler(async (req, res) => {
    requireSupabase();

    const riderId = cleanEnv(req.params.riderId);
    const currentPassword = cleanEnv(req.body?.currentPassword);
    const newPassword = cleanEnv(req.body?.newPassword);
    const confirmPassword = cleanEnv(req.body?.confirmPassword);

    const rider = await getRiderById(riderId);

    if (!rider) {
      return fail(res, "Rider not found.", 404);
    }

    if (
      getRiderPasswordHash(currentPassword) !== cleanEnv(rider.password_hash)
    ) {
      return fail(res, "Current password is incorrect.", 401);
    }

    if (!isValidPassword(newPassword)) {
      return fail(
        res,
        "New password must be at least 8 characters long.",
        400
      );
    }

    if (newPassword !== confirmPassword) {
      return fail(res, "New passwords do not match.", 400);
    }

    const { data, error } = await supabase
      .from("riders")
      .update({
        password_hash: getRiderPasswordHash(newPassword),
        updated_at: nowIso()
      })
      .eq("id", rider.id)
      .select("*")
      .single();

    if (error) {
      return fail(res, `Failed to update password: ${error.message}`, 500);
    }

    await upsertRiderStatusLog({
      rider_id: data.id,
      event_type: "rider_password_updated",
      payload: {
        rider_id: data.id
      }
    });

    return success(res, {
      message: "Password updated successfully."
    });
  })
);

/* =========================================================
   RIDER APPROVAL DECISION
   ADMIN ONLY
========================================================= */
app.post(
  "/api/admin/riders/:riderId/approve",
  requireAdmin,
  asyncHandler(async (req, res) => {
    requireSupabase();

    const rider = await getRiderById(req.params.riderId);
    if (!rider) {
      return fail(res, "Rider not found.", 404);
    }

    const adminEmail = getAdminEmailFromRequest(req);

    const { data, error } = await supabase
      .from("riders")
      .update({
        is_approved: true,
        document_verified: true,
        verification_status: VERIFICATION_STATUS.APPROVED,
        rider_status: "approved",
        updated_at: nowIso()
      })
      .eq("id", rider.id)
      .select("*")
      .single();

    if (error) {
      return fail(res, `Failed to approve rider: ${error.message}`, 500);
    }

    await maybeInsertAdminLog({
      action: "rider_approved",
      entity_type: "rider",
      entity_id: data.id,
      admin_email: adminEmail,
      details: {
        rider_id: data.id,
        verification_status: data.verification_status
      }
    });

    return success(res, {
      message: "Rider approved successfully.",
      rider: sanitizeRiderResponse(data)
    });
  })
);

app.post(
  "/api/admin/riders/:riderId/reject",
  requireAdmin,
  asyncHandler(async (req, res) => {
    requireSupabase();

    const rider = await getRiderById(req.params.riderId);
    if (!rider) {
      return fail(res, "Rider not found.", 404);
    }

    const reason = cleanEnv(req.body?.reason || "Verification rejected.");
    const adminEmail = getAdminEmailFromRequest(req);

    const { data, error } = await supabase
      .from("riders")
      .update({
        is_approved: false,
        document_verified: false,
        verification_status: VERIFICATION_STATUS.REJECTED,
        rider_status: "rejected",
        updated_at: nowIso()
      })
      .eq("id", rider.id)
      .select("*")
      .single();

    if (error) {
      return fail(res, `Failed to reject rider: ${error.message}`, 500);
    }

    await maybeInsertAdminLog({
      action: "rider_rejected",
      entity_type: "rider",
      entity_id: data.id,
      admin_email: adminEmail,
      details: {
        rider_id: data.id,
        reason
      }
    });

    return success(res, {
      message: "Rider rejected successfully.",
      rider: sanitizeRiderResponse(data),
      reason
    });
  })
);

/* =========================================================
   RIDER RIDE ACCESS GUARD CHECK
========================================================= */
app.get(
  "/api/riders/:riderId/can-request-ride",
  asyncHandler(async (req, res) => {
    requireSupabase();

    const rider = await getRiderById(req.params.riderId);

    if (!rider) {
      return fail(res, "Rider not found.", 404);
    }

    const snapshot = getRiderApprovalSnapshot(rider);
    const allowed =
      !ENABLE_RIDER_VERIFICATION_GATE || snapshot.approved;

    return success(res, {
      rider_id: rider.id,
      can_request_ride: allowed,
      verification_status: snapshot.verificationStatus,
      is_approved: snapshot.approved,
      message: allowed
        ? "Ride access granted."
        : "Ride access blocked until rider verification is approved."
    });
  })
);/* =========================================================
   HARVEY TAXI — CODE BLUE CLEAN REBUILD
   PART 3: DRIVERS + EMAIL/SMS VERIFICATION + APPROVAL STATE
   ADD THIS BELOW PART 2 / BEFORE NOT FOUND HANDLER
========================================================= */

/* =========================================================
   DRIVER HELPERS
========================================================= */
function normalizeDriverType(value = "") {
  const type = lower(value);

  if (["av", "auto", "autonomous_vehicle", "robotaxi"].includes(type)) {
    return DRIVER_TYPES.AUTONOMOUS;
  }

  return DRIVER_TYPES.HUMAN;
}

function normalizeVehicleType(value = "") {
  return cleanEnv(value || "standard");
}

function getDriverApprovalSnapshot(driver = {}) {
  const approvalStatus = lower(driver.approval_status || "");
  const verificationStatus = lower(
    driver.verification_status ||
      driver.persona_status ||
      driver.driver_status ||
      ""
  );
  const driverStatus = lower(driver.status || "");

  const emailVerified = toBool(driver.email_verified, false);
  const smsVerified = toBool(driver.sms_verified, false);

  const manuallyApproved =
    toBool(driver.is_approved, false) ||
    approvalStatus === VERIFICATION_STATUS.APPROVED;

  const identityApproved =
    verificationStatus === VERIFICATION_STATUS.APPROVED ||
    verificationStatus === "verified" ||
    verificationStatus === "completed";

  const dispatchEligible =
    emailVerified &&
    smsVerified &&
    (manuallyApproved || !ENABLE_DRIVER_APPROVAL_GATE) &&
    (identityApproved || !ENABLE_PERSONA_ENFORCEMENT) &&
    ["active", "available"].includes(driverStatus || "active");

  return {
    emailVerified,
    smsVerified,
    manuallyApproved,
    identityApproved,
    dispatchEligible,
    approvalStatus: approvalStatus || VERIFICATION_STATUS.PENDING,
    verificationStatus: verificationStatus || VERIFICATION_STATUS.PENDING,
    driverStatus: driverStatus || DRIVER_STATUS.PENDING
  };
}

function sanitizeDriverResponse(driver = {}) {
  const snapshot = getDriverApprovalSnapshot(driver);

  return {
    id: driver.id,
    driver_id: driver.id,
    first_name: driver.first_name || "",
    last_name: driver.last_name || "",
    full_name:
      cleanEnv(`${driver.first_name || ""} ${driver.last_name || ""}`).trim(),
    email: normalizeEmail(driver.email || ""),
    email_masked: maskEmail(driver.email || ""),
    phone: normalizePhone(driver.phone || ""),
    phone_masked: maskPhone(driver.phone || ""),
    city: driver.city || "",
    state: driver.state || "",
    driver_type: normalizeDriverType(driver.driver_type || ""),
    vehicle_make: driver.vehicle_make || "",
    vehicle_model: driver.vehicle_model || "",
    vehicle_year: driver.vehicle_year || "",
    vehicle_color: driver.vehicle_color || "",
    vehicle_plate: driver.vehicle_plate || "",
    vehicle_type: normalizeVehicleType(driver.vehicle_type || ""),
    license_number: driver.license_number || "",
    verification_status: snapshot.verificationStatus,
    approval_status: snapshot.approvalStatus,
    status: snapshot.driverStatus,
    is_approved: snapshot.manuallyApproved,
    email_verified: snapshot.emailVerified,
    sms_verified: snapshot.smsVerified,
    can_receive_dispatch: snapshot.dispatchEligible,
    persona_inquiry_id: driver.persona_inquiry_id || null,
    created_at: driver.created_at || null,
    updated_at: driver.updated_at || null
  };
}

async function getDriverById(driverId = "") {
  requireSupabase();

  const id = cleanEnv(driverId);
  if (!id) return null;

  const { data, error } = await supabase
    .from("drivers")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load driver: ${error.message}`);
  }

  return data || null;
}

async function getDriverByEmail(email = "") {
  requireSupabase();

  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return null;

  const { data, error } = await supabase
    .from("drivers")
    .select("*")
    .eq("email", normalizedEmail)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load driver by email: ${error.message}`);
  }

  return data || null;
}

async function getDriverByPhone(phone = "") {
  requireSupabase();

  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) return null;

  const { data, error } = await supabase
    .from("drivers")
    .select("*")
    .eq("phone", normalizedPhone)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load driver by phone: ${error.message}`);
  }

  return data || null;
}

function buildDriverSessionPayload(driver = {}) {
  const safe = sanitizeDriverResponse(driver);
  return {
    driver_id: safe.id,
    driver: safe
  };
}

function getDriverPasswordHash(password = "") {
  return hashValue(password);
}

async function upsertDriverStatusLog({
  driver_id = "",
  event_type = "",
  payload = {}
}) {
  await maybeInsertAdminLog({
    action: event_type,
    entity_type: "driver",
    entity_id: driver_id,
    admin_email: ADMIN_EMAIL,
    details: payload
  });
}

function generateVerificationCode(length = 6) {
  const min = 10 ** (length - 1);
  const max = 10 ** length - 1;
  return String(Math.floor(min + Math.random() * (max - min)));
}

async function setDriverVerificationCodes(driverId = "") {
  requireSupabase();

  const email_code = generateVerificationCode(6);
  const sms_code = generateVerificationCode(6);

  const { data, error } = await supabase
    .from("drivers")
    .update({
      email_verification_code: email_code,
      sms_verification_code: sms_code,
      email_verification_sent_at: nowIso(),
      sms_verification_sent_at: nowIso(),
      updated_at: nowIso()
    })
    .eq("id", cleanEnv(driverId))
    .select("*")
    .single();

  if (error) {
    throw new Error(`Failed to set verification codes: ${error.message}`);
  }

  return data;
}

async function requireDispatchEligibleDriver(driverId = "") {
  const driver = await getDriverById(driverId);

  if (!driver) {
    const error = new Error("Driver not found.");
    error.statusCode = 404;
    throw error;
  }

  const snapshot = getDriverApprovalSnapshot(driver);

  if (!snapshot.dispatchEligible) {
    const error = new Error(
      "Driver is not eligible for dispatch yet."
    );
    error.statusCode = 403;
    error.details = {
      driver_id: driver.id,
      email_verified: snapshot.emailVerified,
      sms_verified: snapshot.smsVerified,
      approval_status: snapshot.approvalStatus,
      verification_status: snapshot.verificationStatus,
      status: snapshot.driverStatus
    };
    throw error;
  }

  return driver;
}

/* =========================================================
   DRIVER SIGNUP
========================================================= */
app.post(
  "/api/driver/signup",
  asyncHandler(async (req, res) => {
    requireSupabase();

    const first_name = cleanEnv(req.body?.firstName || req.body?.first_name);
    const last_name = cleanEnv(req.body?.lastName || req.body?.last_name);
    const phone = normalizePhone(req.body?.phone);
    const email = normalizeEmail(req.body?.email);
    const city = cleanEnv(req.body?.city);
    const state = cleanEnv(req.body?.state || req.body?.stateValue || "TN");
    const password = cleanEnv(req.body?.password);
    const confirmPassword = cleanEnv(
      req.body?.confirmPassword || req.body?.confirm_password
    );

    const driver_type = normalizeDriverType(
      req.body?.driverType || req.body?.driver_type
    );

    const vehicle_make = cleanEnv(
      req.body?.vehicleMake || req.body?.vehicle_make
    );
    const vehicle_model = cleanEnv(
      req.body?.vehicleModel || req.body?.vehicle_model
    );
    const vehicle_year = cleanEnv(
      req.body?.vehicleYear || req.body?.vehicle_year
    );
    const vehicle_color = cleanEnv(
      req.body?.vehicleColor || req.body?.vehicle_color
    );
    const vehicle_plate = cleanEnv(
      req.body?.vehiclePlate || req.body?.vehicle_plate
    );
    const vehicle_type = normalizeVehicleType(
      req.body?.vehicleType || req.body?.vehicle_type || "standard"
    );

    const license_number = cleanEnv(
      req.body?.licenseNumber || req.body?.license_number
    );

    const agreed_to_terms = toBool(
      req.body?.agreedToTerms || req.body?.agreed_to_terms,
      false
    );
    const agreed_to_background_check = toBool(
      req.body?.agreedToBackgroundCheck ||
        req.body?.agreed_to_background_check,
      false
    );

    if (!first_name) return fail(res, "First name is required.", 400);
    if (!last_name) return fail(res, "Last name is required.", 400);
    if (!email || !isValidEmail(email)) {
      return fail(res, "A valid email is required.", 400);
    }
    if (!phone) return fail(res, "A valid phone number is required.", 400);
    if (!city) return fail(res, "City is required.", 400);
    if (!state) return fail(res, "State is required.", 400);

    if (!password || !isValidPassword(password)) {
      return fail(res, "Password must be at least 8 characters long.", 400);
    }

    if (password !== confirmPassword) {
      return fail(res, "Passwords do not match.", 400);
    }

    if (!agreed_to_terms) {
      return fail(res, "Driver must agree to the terms.", 400);
    }

    if (!agreed_to_background_check) {
      return fail(res, "Driver must agree to the background check.", 400);
    }

    if (driver_type === DRIVER_TYPES.HUMAN) {
      if (!vehicle_make) return fail(res, "Vehicle make is required.", 400);
      if (!vehicle_model) return fail(res, "Vehicle model is required.", 400);
      if (!vehicle_year) return fail(res, "Vehicle year is required.", 400);
      if (!vehicle_color) return fail(res, "Vehicle color is required.", 400);
      if (!vehicle_plate) return fail(res, "Vehicle plate is required.", 400);
      if (!license_number) {
        return fail(res, "License number is required.", 400);
      }
    }

    const existingByEmail = await getDriverByEmail(email);
    if (existingByEmail) {
      return fail(
        res,
        "A driver account with that email already exists.",
        409,
        {
          driver_id: existingByEmail.id,
          driver: sanitizeDriverResponse(existingByEmail)
        }
      );
    }

    const existingByPhone = await getDriverByPhone(phone);
    if (existingByPhone) {
      return fail(
        res,
        "A driver account with that phone number already exists.",
        409,
        {
          driver_id: existingByPhone.id,
          driver: sanitizeDriverResponse(existingByPhone)
        }
      );
    }

    const driverId = generateId("driver");
    const password_hash = getDriverPasswordHash(password);
    const created_at = nowIso();

    const insertPayload = cleanObject({
      id: driverId,
      first_name,
      last_name,
      phone,
      email,
      city,
      state,
      password_hash,
      driver_type,

      vehicle_make: vehicle_make || null,
      vehicle_model: vehicle_model || null,
      vehicle_year: vehicle_year || null,
      vehicle_color: vehicle_color || null,
      vehicle_plate: vehicle_plate || null,
      vehicle_type: vehicle_type || "standard",

      license_number: license_number || null,

      agreed_to_terms,
      agreed_to_background_check,

      email_verified: false,
      sms_verified: false,
      is_approved: false,
      approval_status: VERIFICATION_STATUS.PENDING,
      verification_status: VERIFICATION_STATUS.PENDING,
      persona_status: VERIFICATION_STATUS.PENDING,
      status: DRIVER_STATUS.PENDING,
      persona_inquiry_id: null,

      created_at,
      updated_at: created_at
    });

    const { data, error } = await supabase
      .from("drivers")
      .insert(insertPayload)
      .select("*")
      .single();

    if (error) {
      return fail(res, `Driver signup failed: ${error.message}`, 500);
    }

    const withCodes = await setDriverVerificationCodes(data.id);

    await upsertDriverStatusLog({
      driver_id: withCodes.id,
      event_type: "driver_signup_created",
      payload: {
        driver_id: withCodes.id,
        email,
        phone,
        driver_type,
        approval_status: VERIFICATION_STATUS.PENDING,
        verification_status: VERIFICATION_STATUS.PENDING
      }
    });

    return success(
      res,
      {
        message:
          "Driver signup submitted. Email verification, SMS verification, and approval are required before dispatch.",
        ...buildDriverSessionPayload(withCodes),
        verification_preview:
          NODE_ENV === "production"
            ? undefined
            : {
                email_code: withCodes.email_verification_code || null,
                sms_code: withCodes.sms_verification_code || null
              }
      },
      201
    );
  })
);

/* =========================================================
   DRIVER LOGIN
========================================================= */
app.post(
  "/api/driver/login",
  asyncHandler(async (req, res) => {
    requireSupabase();

    const email = normalizeEmail(req.body?.email);
    const password = cleanEnv(req.body?.password);

    if (!email || !password) {
      return fail(res, "Email and password are required.", 400);
    }

    const driver = await getDriverByEmail(email);

    if (!driver) {
      return fail(res, "Invalid email or password.", 401);
    }

    const incomingHash = getDriverPasswordHash(password);
    if (incomingHash !== cleanEnv(driver.password_hash)) {
      return fail(res, "Invalid email or password.", 401);
    }

    return success(res, {
      message: "Driver login successful.",
      ...buildDriverSessionPayload(driver)
    });
  })
);

/* =========================================================
   DRIVER STATUS / PROFILE
========================================================= */
app.get(
  "/api/driver-status",
  asyncHandler(async (req, res) => {
    requireSupabase();

    const driver_id = cleanEnv(req.query?.driver_id || req.query?.driverId);
    const email = normalizeEmail(req.query?.email);
    const phone = normalizePhone(req.query?.phone);

    let driver = null;

    if (driver_id) {
      driver = await getDriverById(driver_id);
    } else if (email) {
      driver = await getDriverByEmail(email);
    } else if (phone) {
      driver = await getDriverByPhone(phone);
    } else {
      return fail(
        res,
        "Provide driver_id, email, or phone to check driver status.",
        400
      );
    }

    if (!driver) {
      return fail(res, "Driver not found.", 404);
    }

    const snapshot = getDriverApprovalSnapshot(driver);

    return success(res, {
      driver_id: driver.id,
      driver: sanitizeDriverResponse(driver),
      approval_status: snapshot.approvalStatus,
      verification_status: snapshot.verificationStatus,
      email_verified: snapshot.emailVerified,
      sms_verified: snapshot.smsVerified,
      can_receive_dispatch: snapshot.dispatchEligible,
      message: snapshot.dispatchEligible
        ? "Driver is dispatch eligible."
        : "Driver is still pending verification and/or approval."
    });
  })
);

app.get(
  "/api/drivers/:driverId",
  asyncHandler(async (req, res) => {
    requireSupabase();

    const driver = await getDriverById(req.params.driverId);

    if (!driver) {
      return fail(res, "Driver not found.", 404);
    }

    return success(res, {
      driver: sanitizeDriverResponse(driver)
    });
  })
);

app.patch(
  "/api/drivers/:driverId",
  asyncHandler(async (req, res) => {
    requireSupabase();

    const driverId = cleanEnv(req.params.driverId);
    const existing = await getDriverById(driverId);

    if (!existing) {
      return fail(res, "Driver not found.", 404);
    }

    const nextFirstName = cleanEnv(req.body?.firstName || req.body?.first_name);
    const nextLastName = cleanEnv(req.body?.lastName || req.body?.last_name);
    const nextCity = cleanEnv(req.body?.city);
    const nextState = cleanEnv(req.body?.state);
    const nextVehicleMake = cleanEnv(
      req.body?.vehicleMake || req.body?.vehicle_make
    );
    const nextVehicleModel = cleanEnv(
      req.body?.vehicleModel || req.body?.vehicle_model
    );
    const nextVehicleYear = cleanEnv(
      req.body?.vehicleYear || req.body?.vehicle_year
    );
    const nextVehicleColor = cleanEnv(
      req.body?.vehicleColor || req.body?.vehicle_color
    );
    const nextVehiclePlate = cleanEnv(
      req.body?.vehiclePlate || req.body?.vehicle_plate
    );
    const nextVehicleType = cleanEnv(
      req.body?.vehicleType || req.body?.vehicle_type
    );
    const nextLicense = cleanEnv(
      req.body?.licenseNumber || req.body?.license_number
    );

    const updatePayload = cleanObject({
      first_name: nextFirstName || existing.first_name,
      last_name: nextLastName || existing.last_name,
      city: nextCity || existing.city,
      state: nextState || existing.state,
      vehicle_make: nextVehicleMake || existing.vehicle_make,
      vehicle_model: nextVehicleModel || existing.vehicle_model,
      vehicle_year: nextVehicleYear || existing.vehicle_year,
      vehicle_color: nextVehicleColor || existing.vehicle_color,
      vehicle_plate: nextVehiclePlate || existing.vehicle_plate,
      vehicle_type: nextVehicleType || existing.vehicle_type,
      license_number: nextLicense || existing.license_number,
      updated_at: nowIso()
    });

    if (req.body?.phone) {
      const nextPhone = normalizePhone(req.body.phone);
      if (!nextPhone) {
        return fail(res, "Invalid phone number.", 400);
      }

      const phoneOwner = await getDriverByPhone(nextPhone);
      if (phoneOwner && phoneOwner.id !== existing.id) {
        return fail(res, "Phone number is already in use.", 409);
      }

      updatePayload.phone = nextPhone;
      updatePayload.sms_verified = false;
      updatePayload.sms_verification_code = generateVerificationCode(6);
      updatePayload.sms_verification_sent_at = nowIso();
    }

    if (req.body?.email) {
      const nextEmail = normalizeEmail(req.body.email);
      if (!isValidEmail(nextEmail)) {
        return fail(res, "Invalid email address.", 400);
      }

      const emailOwner = await getDriverByEmail(nextEmail);
      if (emailOwner && emailOwner.id !== existing.id) {
        return fail(res, "Email is already in use.", 409);
      }

      updatePayload.email = nextEmail;
      updatePayload.email_verified = false;
      updatePayload.email_verification_code = generateVerificationCode(6);
      updatePayload.email_verification_sent_at = nowIso();
    }

    const { data, error } = await supabase
      .from("drivers")
      .update(updatePayload)
      .eq("id", existing.id)
      .select("*")
      .single();

    if (error) {
      return fail(res, `Failed to update driver: ${error.message}`, 500);
    }

    await upsertDriverStatusLog({
      driver_id: data.id,
      event_type: "driver_profile_updated",
      payload: {
        driver_id: data.id
      }
    });

    return success(res, {
      message: "Driver profile updated.",
      driver: sanitizeDriverResponse(data),
      verification_preview:
        NODE_ENV === "production"
          ? undefined
          : {
              email_code: data.email_verification_code || null,
              sms_code: data.sms_verification_code || null
            }
    });
  })
);

/* =========================================================
   DRIVER PASSWORD UPDATE
========================================================= */
app.post(
  "/api/drivers/:driverId/update-password",
  asyncHandler(async (req, res) => {
    requireSupabase();

    const driverId = cleanEnv(req.params.driverId);
    const currentPassword = cleanEnv(req.body?.currentPassword);
    const newPassword = cleanEnv(req.body?.newPassword);
    const confirmPassword = cleanEnv(req.body?.confirmPassword);

    const driver = await getDriverById(driverId);

    if (!driver) {
      return fail(res, "Driver not found.", 404);
    }

    if (
      getDriverPasswordHash(currentPassword) !== cleanEnv(driver.password_hash)
    ) {
      return fail(res, "Current password is incorrect.", 401);
    }

    if (!isValidPassword(newPassword)) {
      return fail(
        res,
        "New password must be at least 8 characters long.",
        400
      );
    }

    if (newPassword !== confirmPassword) {
      return fail(res, "New passwords do not match.", 400);
    }

    const { data, error } = await supabase
      .from("drivers")
      .update({
        password_hash: getDriverPasswordHash(newPassword),
        updated_at: nowIso()
      })
      .eq("id", driver.id)
      .select("*")
      .single();

    if (error) {
      return fail(res, `Failed to update password: ${error.message}`, 500);
    }

    await upsertDriverStatusLog({
      driver_id: data.id,
      event_type: "driver_password_updated",
      payload: {
        driver_id: data.id
      }
    });

    return success(res, {
      message: "Driver password updated successfully."
    });
  })
);

/* =========================================================
   DRIVER EMAIL VERIFICATION
========================================================= */
app.post(
  "/api/driver/send-email-code",
  asyncHandler(async (req, res) => {
    requireSupabase();

    const driverId = cleanEnv(req.body?.driver_id || req.body?.driverId);
    const driver = await getDriverById(driverId);

    if (!driver) {
      return fail(res, "Driver not found.", 404);
    }

    const code = generateVerificationCode(6);

    const { data, error } = await supabase
      .from("drivers")
      .update({
        email_verification_code: code,
        email_verification_sent_at: nowIso(),
        updated_at: nowIso()
      })
      .eq("id", driver.id)
      .select("*")
      .single();

    if (error) {
      return fail(res, `Failed to send email code: ${error.message}`, 500);
    }

    await upsertDriverStatusLog({
      driver_id: data.id,
      event_type: "driver_email_code_sent",
      payload: {
        driver_id: data.id,
        email: data.email
      }
    });

    return success(res, {
      message: ENABLE_REAL_EMAIL
        ? "Email verification code sent."
        : "Email verification code generated.",
      driver: sanitizeDriverResponse(data),
      verification_preview:
        NODE_ENV === "production"
          ? undefined
          : { email_code: code }
    });
  })
);

app.post(
  "/api/driver/verify-email",
  asyncHandler(async (req, res) => {
    requireSupabase();

    const driverId = cleanEnv(req.body?.driver_id || req.body?.driverId);
    const code = cleanEnv(req.body?.code);

    const driver = await getDriverById(driverId);

    if (!driver) {
      return fail(res, "Driver not found.", 404);
    }

    if (!code) {
      return fail(res, "Verification code is required.", 400);
    }

    if (cleanEnv(driver.email_verification_code) !== code) {
      return fail(res, "Invalid email verification code.", 400);
    }

    const nextStatus =
      toBool(driver.sms_verified, false) && toBool(driver.is_approved, false)
        ? DRIVER_STATUS.ACTIVE
        : driver.status || DRIVER_STATUS.PENDING;

    const { data, error } = await supabase
      .from("drivers")
      .update({
        email_verified: true,
        email_verification_code: null,
        email_verified_at: nowIso(),
        status: nextStatus,
        updated_at: nowIso()
      })
      .eq("id", driver.id)
      .select("*")
      .single();

    if (error) {
      return fail(res, `Failed to verify email: ${error.message}`, 500);
    }

    await upsertDriverStatusLog({
      driver_id: data.id,
      event_type: "driver_email_verified",
      payload: {
        driver_id: data.id,
        email: data.email
      }
    });

    return success(res, {
      message: "Driver email verified successfully.",
      driver: sanitizeDriverResponse(data)
    });
  })
);

/* =========================================================
   DRIVER SMS VERIFICATION
========================================================= */
app.post(
  "/api/driver/send-sms-code",
  asyncHandler(async (req, res) => {
    requireSupabase();

    const driverId = cleanEnv(req.body?.driver_id || req.body?.driverId);
    const driver = await getDriverById(driverId);

    if (!driver) {
      return fail(res, "Driver not found.", 404);
    }

    const code = generateVerificationCode(6);

    const { data, error } = await supabase
      .from("drivers")
      .update({
        sms_verification_code: code,
        sms_verification_sent_at: nowIso(),
        updated_at: nowIso()
      })
      .eq("id", driver.id)
      .select("*")
      .single();

    if (error) {
      return fail(res, `Failed to send SMS code: ${error.message}`, 500);
    }

    await upsertDriverStatusLog({
      driver_id: data.id,
      event_type: "driver_sms_code_sent",
      payload: {
        driver_id: data.id,
        phone: data.phone
      }
    });

    return success(res, {
      message: ENABLE_REAL_SMS
        ? "SMS verification code sent."
        : "SMS verification code generated.",
      driver: sanitizeDriverResponse(data),
      verification_preview:
        NODE_ENV === "production"
          ? undefined
          : { sms_code: code }
    });
  })
);

app.post(
  "/api/driver/verify-sms",
  asyncHandler(async (req, res) => {
    requireSupabase();

    const driverId = cleanEnv(req.body?.driver_id || req.body?.driverId);
    const code = cleanEnv(req.body?.code);

    const driver = await getDriverById(driverId);

    if (!driver) {
      return fail(res, "Driver not found.", 404);
    }

    if (!code) {
      return fail(res, "Verification code is required.", 400);
    }

    if (cleanEnv(driver.sms_verification_code) !== code) {
      return fail(res, "Invalid SMS verification code.", 400);
    }

    const nextStatus =
      toBool(driver.email_verified, false) && toBool(driver.is_approved, false)
        ? DRIVER_STATUS.ACTIVE
        : driver.status || DRIVER_STATUS.PENDING;

    const { data, error } = await supabase
      .from("drivers")
      .update({
        sms_verified: true,
        sms_verification_code: null,
        sms_verified_at: nowIso(),
        status: nextStatus,
        updated_at: nowIso()
      })
      .eq("id", driver.id)
      .select("*")
      .single();

    if (error) {
      return fail(res, `Failed to verify SMS: ${error.message}`, 500);
    }

    await upsertDriverStatusLog({
      driver_id: data.id,
      event_type: "driver_sms_verified",
      payload: {
        driver_id: data.id,
        phone: data.phone
      }
    });

    return success(res, {
      message: "Driver SMS verified successfully.",
      driver: sanitizeDriverResponse(data)
    });
  })
);

/* =========================================================
   DRIVER APPROVAL / REJECTION
   ADMIN ONLY
========================================================= */
app.post(
  "/api/admin/drivers/:driverId/approve",
  requireAdmin,
  asyncHandler(async (req, res) => {
    requireSupabase();

    const driver = await getDriverById(req.params.driverId);
    if (!driver) {
      return fail(res, "Driver not found.", 404);
    }

    const snapshot = getDriverApprovalSnapshot(driver);
    const adminEmail = getAdminEmailFromRequest(req);

    const nextStatus =
      snapshot.emailVerified && snapshot.smsVerified
        ? DRIVER_STATUS.ACTIVE
        : DRIVER_STATUS.PENDING;

    const { data, error } = await supabase
      .from("drivers")
      .update({
        is_approved: true,
        approval_status: VERIFICATION_STATUS.APPROVED,
        status: nextStatus,
        updated_at: nowIso()
      })
      .eq("id", driver.id)
      .select("*")
      .single();

    if (error) {
      return fail(res, `Failed to approve driver: ${error.message}`, 500);
    }

    await maybeInsertAdminLog({
      action: "driver_approved",
      entity_type: "driver",
      entity_id: data.id,
      admin_email: adminEmail,
      details: {
        driver_id: data.id,
        approval_status: data.approval_status
      }
    });

    return success(res, {
      message: "Driver approved successfully.",
      driver: sanitizeDriverResponse(data)
    });
  })
);

app.post(
  "/api/admin/drivers/:driverId/reject",
  requireAdmin,
  asyncHandler(async (req, res) => {
    requireSupabase();

    const driver = await getDriverById(req.params.driverId);
    if (!driver) {
      return fail(res, "Driver not found.", 404);
    }

    const reason = cleanEnv(req.body?.reason || "Driver rejected.");
    const adminEmail = getAdminEmailFromRequest(req);

    const { data, error } = await supabase
      .from("drivers")
      .update({
        is_approved: false,
        approval_status: VERIFICATION_STATUS.REJECTED,
        status: DRIVER_STATUS.SUSPENDED,
        updated_at: nowIso()
      })
      .eq("id", driver.id)
      .select("*")
      .single();

    if (error) {
      return fail(res, `Failed to reject driver: ${error.message}`, 500);
    }

    await maybeInsertAdminLog({
      action: "driver_rejected",
      entity_type: "driver",
      entity_id: data.id,
      admin_email: adminEmail,
      details: {
        driver_id: data.id,
        reason
      }
    });

    return success(res, {
      message: "Driver rejected successfully.",
      driver: sanitizeDriverResponse(data),
      reason
    });
  })
);

/* =========================================================
   DRIVER MANUAL STATUS UPDATE
========================================================= */
app.post(
  "/api/drivers/:driverId/set-status",
  asyncHandler(async (req, res) => {
    requireSupabase();

    const driver = await getDriverById(req.params.driverId);

    if (!driver) {
      return fail(res, "Driver not found.", 404);
    }

    const requestedStatus = lower(req.body?.status);

    if (!["active", "available", "offline"].includes(requestedStatus)) {
      return fail(
        res,
        "Status must be active, available, or offline.",
        400
      );
    }

    const { data, error } = await supabase
      .from("drivers")
      .update({
        status: requestedStatus === "available" ? "available" : requestedStatus,
        updated_at: nowIso()
      })
      .eq("id", driver.id)
      .select("*")
      .single();

    if (error) {
      return fail(res, `Failed to update driver status: ${error.message}`, 500);
    }

    await upsertDriverStatusLog({
      driver_id: data.id,
      event_type: "driver_status_updated",
      payload: {
        driver_id: data.id,
        status: data.status
      }
    });

    return success(res, {
      message: "Driver status updated.",
      driver: sanitizeDriverResponse(data)
    });
  })
);

/* =========================================================
   DISPATCH ELIGIBILITY CHECK
========================================================= */
app.get(
  "/api/drivers/:driverId/can-receive-dispatch",
  asyncHandler(async (req, res) => {
    requireSupabase();

    const driver = await getDriverById(req.params.driverId);

    if (!driver) {
      return fail(res, "Driver not found.", 404);
    }

    const snapshot = getDriverApprovalSnapshot(driver);

    return success(res, {
      driver_id: driver.id,
      can_receive_dispatch: snapshot.dispatchEligible,
      email_verified: snapshot.emailVerified,
      sms_verified: snapshot.smsVerified,
      approval_status: snapshot.approvalStatus,
      verification_status: snapshot.verificationStatus,
      status: snapshot.driverStatus,
      message: snapshot.dispatchEligible
        ? "Driver can receive dispatch."
        : "Driver is blocked from dispatch until verification and approval are complete."
    });
  })
);

/* =========================================================
   AVAILABLE DRIVERS LIST
========================================================= */
app.get(
  "/api/drivers/available/list",
  asyncHandler(async (req, res) => {
    requireSupabase();

    const requestedMode = normalizeDriverType(
      req.query?.requestedMode || req.query?.mode || DRIVER_TYPES.HUMAN
    );

    const { data, error } = await supabase
      .from("drivers")
      .select("*")
      .eq("driver_type", requestedMode);

    if (error) {
      return fail(res, `Failed to load drivers: ${error.message}`, 500);
    }

    const availableDrivers = (data || [])
      .filter((driver) => getDriverApprovalSnapshot(driver).dispatchEligible)
      .map((driver) => sanitizeDriverResponse(driver));

    return success(res, {
      requested_mode: requestedMode,
      count: availableDrivers.length,
      drivers: availableDrivers
    });
  })
);/* =========================================================
   HARVEY TAXI — CODE BLUE CLEAN REBUILD
   PART 4: PERSONA INQUIRIES + WEBHOOK SYNC + REAL APPROVAL
   ADD THIS BELOW PART 3 / BEFORE NOT FOUND HANDLER
========================================================= */

/* =========================================================
   PERSONA HELPERS
========================================================= */
function getPersonaApiBase() {
  return "https://withpersona.com/api/v1";
}

function getPersonaWebhookHeader(req) {
  return cleanEnv(
    req.headers["persona-signature"] ||
      req.headers["x-persona-signature"] ||
      req.headers["x-webhook-signature"]
  );
}

function parseRawBodyForWebhook(req) {
  if (Buffer.isBuffer(req.body)) return req.body.toString("utf8");
  if (typeof req.body === "string") return req.body;
  try {
    return JSON.stringify(req.body || {});
  } catch (error) {
    return "";
  }
}

function verifyPersonaWebhookSignature(req) {
  if (!PERSONA_WEBHOOK_SECRET) return true;

  const signatureHeader = getPersonaWebhookHeader(req);
  if (!signatureHeader) return false;

  const payload = parseRawBodyForWebhook(req);

  const expected = crypto
    .createHmac("sha256", PERSONA_WEBHOOK_SECRET)
    .update(payload)
    .digest("hex");

  return signatureHeader.includes(expected);
}

function getPersonaTemplateForEntity(entityType = "rider") {
  if (entityType === "driver") {
    return PERSONA_TEMPLATE_ID_DRIVER || PERSONA_TEMPLATE_ID_RIDER || "";
  }
  return PERSONA_TEMPLATE_ID_RIDER || "";
}

function buildPersonaHeaders() {
  return {
    Authorization: `Bearer ${PERSONA_API_KEY}`,
    "Content-Type": "application/json",
    Accept: "application/json"
  };
}

async function personaFetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();

  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch (error) {
    parsed = { raw: text };
  }

  if (!response.ok) {
    const message =
      parsed?.errors?.[0]?.detail ||
      parsed?.error ||
      `Persona request failed with status ${response.status}`;
    const err = new Error(message);
    err.statusCode = response.status;
    err.persona = parsed;
    throw err;
  }

  return parsed;
}

function getInquiryStatusFromPersona(inquiry = {}) {
  return lower(
    inquiry.attributes?.status ||
      inquiry.status ||
      inquiry.attributes?.fields?.status ||
      ""
  );
}

function mapPersonaStatusToVerificationStatus(personaStatus = "") {
  const status = lower(personaStatus);

  if (
    ["approved", "completed", "passed", "verified"].includes(status)
  ) {
    return VERIFICATION_STATUS.APPROVED;
  }

  if (
    ["declined", "failed", "rejected", "needs_review", "redacted"].includes(
      status
    )
  ) {
    return VERIFICATION_STATUS.REJECTED;
  }

  if (
    ["pending", "created", "initiated", "started"].includes(status)
  ) {
    return VERIFICATION_STATUS.PENDING;
  }

  if (
    ["submitted", "processing", "in_review", "under_review"].includes(status)
  ) {
    return VERIFICATION_STATUS.UNDER_REVIEW;
  }

  return VERIFICATION_STATUS.PENDING;
}

function extractPersonaInquiryId(payload = {}) {
  return cleanEnv(
    payload?.data?.id ||
      payload?.included?.find?.((item) => item.type === "inquiry")?.id ||
      payload?.inquiry_id ||
      payload?.data?.attributes?.inquiry_id
  );
}

function extractPersonaStatus(payload = {}) {
  return lower(
    payload?.data?.attributes?.status ||
      payload?.data?.attributes?.payload?.status ||
      payload?.data?.attributes?.payload?.data?.attributes?.status ||
      payload?.payload?.data?.attributes?.status ||
      payload?.status ||
      ""
  );
}

function extractPersonaReferenceId(payload = {}) {
  return cleanEnv(
    payload?.data?.attributes?.reference_id ||
      payload?.data?.attributes?.payload?.reference_id ||
      payload?.data?.attributes?.payload?.data?.attributes?.reference_id ||
      payload?.payload?.data?.attributes?.reference_id ||
      payload?.reference_id
  );
}

function extractPersonaIncludedInquiry(payload = {}) {
  const included = Array.isArray(payload?.included) ? payload.included : [];
  return included.find((item) => item?.type === "inquiry") || null;
}

function extractPersonaVerificationResult(payload = {}) {
  const inquiry =
    payload?.data?.type === "inquiry"
      ? payload.data
      : extractPersonaIncludedInquiry(payload) || payload?.data || {};

  const personaStatus = getInquiryStatusFromPersona(inquiry);
  const verificationStatus = mapPersonaStatusToVerificationStatus(personaStatus);

  return {
    inquiry_id: cleanEnv(inquiry?.id),
    persona_status: personaStatus || "pending",
    verification_status: verificationStatus
  };
}

async function createPersonaInquiry({
  entityType = "rider",
  entityId = "",
  firstName = "",
  lastName = "",
  email = "",
  phone = "",
  documentType = "",
  countryCode = "US"
}) {
  if (!PERSONA_API_KEY) {
    throw new Error("Persona API key is not configured.");
  }

  const templateId = getPersonaTemplateForEntity(entityType);
  if (!templateId) {
    throw new Error(`Persona template is missing for ${entityType}.`);
  }

  const referenceId = cleanEnv(`${entityType}:${entityId}`);

  const payload = {
    data: {
      type: "inquiry",
      attributes: {
        reference_id: referenceId,
        template_id: templateId,
        note: `${entityType} verification for Harvey Taxi`,
        fields: {
          name_first: cleanEnv(firstName),
          name_last: cleanEnv(lastName),
          email_address: normalizeEmail(email),
          phone_number: normalizePhone(phone),
          country_code: cleanEnv(countryCode || "US"),
          document_type: normalizeDocumentType(documentType || "id")
        }
      }
    }
  };

  const result = await personaFetchJson(`${getPersonaApiBase()}/inquiries`, {
    method: "POST",
    headers: buildPersonaHeaders(),
    body: JSON.stringify(payload)
  });

  return result;
}

async function fetchPersonaInquiry(inquiryId = "") {
  if (!PERSONA_API_KEY) {
    throw new Error("Persona API key is not configured.");
  }

  const id = cleanEnv(inquiryId);
  if (!id) {
    throw new Error("Persona inquiry id is required.");
  }

  return await personaFetchJson(`${getPersonaApiBase()}/inquiries/${id}`, {
    method: "GET",
    headers: buildPersonaHeaders()
  });
}

/* =========================================================
   RIDER PERSONA SYNC
========================================================= */
async function saveRiderPersonaInquiry(rider = {}, inquiryPayload = {}) {
  requireSupabase();

  const inquiryId = extractPersonaInquiryId(inquiryPayload);
  const personaStatus =
    getInquiryStatusFromPersona(inquiryPayload?.data || {}) || "created";
  const verificationStatus = mapPersonaStatusToVerificationStatus(personaStatus);

  const { data, error } = await supabase
    .from("riders")
    .update({
      persona_inquiry_id: inquiryId || rider.persona_inquiry_id || null,
      persona_status: personaStatus,
      verification_status:
        verificationStatus === VERIFICATION_STATUS.APPROVED
          ? VERIFICATION_STATUS.UNDER_REVIEW
          : verificationStatus,
      updated_at: nowIso()
    })
    .eq("id", rider.id)
    .select("*")
    .single();

  if (error) {
    throw new Error(`Failed to save rider Persona inquiry: ${error.message}`);
  }

  await upsertRiderStatusLog({
    rider_id: data.id,
    event_type: "rider_persona_inquiry_created",
    payload: {
      rider_id: data.id,
      persona_inquiry_id: inquiryId,
      persona_status: personaStatus
    }
  });

  return data;
}

async function applyRiderPersonaDecision({
  rider = {},
  inquiry_id = "",
  persona_status = "",
  verification_status = VERIFICATION_STATUS.PENDING
}) {
  requireSupabase();

  const approved = verification_status === VERIFICATION_STATUS.APPROVED;
  const rejected = verification_status === VERIFICATION_STATUS.REJECTED;

  const { data, error } = await supabase
    .from("riders")
    .update({
      persona_inquiry_id: inquiry_id || rider.persona_inquiry_id || null,
      persona_status: persona_status || rider.persona_status || "pending",
      verification_status,
      document_verified: approved,
      is_approved: approved,
      rider_status: approved
        ? "approved"
        : rejected
        ? "rejected"
        : "pending",
      updated_at: nowIso()
    })
    .eq("id", rider.id)
    .select("*")
    .single();

  if (error) {
    throw new Error(`Failed to apply rider Persona decision: ${error.message}`);
  }

  await upsertRiderStatusLog({
    rider_id: data.id,
    event_type: approved
      ? "rider_persona_approved"
      : rejected
      ? "rider_persona_rejected"
      : "rider_persona_updated",
    payload: {
      rider_id: data.id,
      inquiry_id,
      persona_status,
      verification_status
    }
  });

  return data;
}

/* =========================================================
   DRIVER PERSONA SYNC
========================================================= */
async function saveDriverPersonaInquiry(driver = {}, inquiryPayload = {}) {
  requireSupabase();

  const inquiryId = extractPersonaInquiryId(inquiryPayload);
  const personaStatus =
    getInquiryStatusFromPersona(inquiryPayload?.data || {}) || "created";
  const verificationStatus = mapPersonaStatusToVerificationStatus(personaStatus);

  const { data, error } = await supabase
    .from("drivers")
    .update({
      persona_inquiry_id: inquiryId || driver.persona_inquiry_id || null,
      persona_status: personaStatus,
      verification_status:
        verificationStatus === VERIFICATION_STATUS.APPROVED
          ? VERIFICATION_STATUS.UNDER_REVIEW
          : verificationStatus,
      updated_at: nowIso()
    })
    .eq("id", driver.id)
    .select("*")
    .single();

  if (error) {
    throw new Error(`Failed to save driver Persona inquiry: ${error.message}`);
  }

  await upsertDriverStatusLog({
    driver_id: data.id,
    event_type: "driver_persona_inquiry_created",
    payload: {
      driver_id: data.id,
      persona_inquiry_id: inquiryId,
      persona_status: personaStatus
    }
  });

  return data;
}

async function applyDriverPersonaDecision({
  driver = {},
  inquiry_id = "",
  persona_status = "",
  verification_status = VERIFICATION_STATUS.PENDING
}) {
  requireSupabase();

  const approved = verification_status === VERIFICATION_STATUS.APPROVED;
  const rejected = verification_status === VERIFICATION_STATUS.REJECTED;

  const snapshot = getDriverApprovalSnapshot(driver);

  const nextStatus =
    approved && snapshot.emailVerified && snapshot.smsVerified && snapshot.manuallyApproved
      ? DRIVER_STATUS.ACTIVE
      : rejected
      ? DRIVER_STATUS.SUSPENDED
      : driver.status || DRIVER_STATUS.PENDING;

  const { data, error } = await supabase
    .from("drivers")
    .update({
      persona_inquiry_id: inquiry_id || driver.persona_inquiry_id || null,
      persona_status: persona_status || driver.persona_status || "pending",
      verification_status,
      status: nextStatus,
      updated_at: nowIso()
    })
    .eq("id", driver.id)
    .select("*")
    .single();

  if (error) {
    throw new Error(`Failed to apply driver Persona decision: ${error.message}`);
  }

  await upsertDriverStatusLog({
    driver_id: data.id,
    event_type: approved
      ? "driver_persona_approved"
      : rejected
      ? "driver_persona_rejected"
      : "driver_persona_updated",
    payload: {
      driver_id: data.id,
      inquiry_id,
      persona_status,
      verification_status
    }
  });

  return data;
}

/* =========================================================
   MANUAL PERSONA START: RIDER
========================================================= */
app.post(
  "/api/riders/:riderId/start-verification",
  asyncHandler(async (req, res) => {
    requireSupabase();

    const rider = await getRiderById(req.params.riderId);
    if (!rider) {
      return fail(res, "Rider not found.", 404);
    }

    if (!PERSONA_API_KEY) {
      return fail(
        res,
        "Persona is not configured. Add PERSONA_API_KEY and rider template env values.",
        500
      );
    }

    const inquiryPayload = await createPersonaInquiry({
      entityType: "rider",
      entityId: rider.id,
      firstName: rider.first_name,
      lastName: rider.last_name,
      email: rider.email,
      phone: rider.phone,
      documentType: rider.document_type || "id",
      countryCode: rider.document_country || "US"
    });

    const updatedRider = await saveRiderPersonaInquiry(rider, inquiryPayload);

    return success(res, {
      message: "Rider verification started.",
      rider: sanitizeRiderResponse(updatedRider),
      persona: {
        inquiry_id: updatedRider.persona_inquiry_id,
        status: updatedRider.persona_status
      }
    });
  })
);

/* =========================================================
   MANUAL PERSONA START: DRIVER
========================================================= */
app.post(
  "/api/drivers/:driverId/start-verification",
  asyncHandler(async (req, res) => {
    requireSupabase();

    const driver = await getDriverById(req.params.driverId);
    if (!driver) {
      return fail(res, "Driver not found.", 404);
    }

    if (!PERSONA_API_KEY) {
      return fail(
        res,
        "Persona is not configured. Add PERSONA_API_KEY and driver template env values.",
        500
      );
    }

    const inquiryPayload = await createPersonaInquiry({
      entityType: "driver",
      entityId: driver.id,
      firstName: driver.first_name,
      lastName: driver.last_name,
      email: driver.email,
      phone: driver.phone,
      documentType: "id",
      countryCode: "US"
    });

    const updatedDriver = await saveDriverPersonaInquiry(driver, inquiryPayload);

    return success(res, {
      message: "Driver verification started.",
      driver: sanitizeDriverResponse(updatedDriver),
      persona: {
        inquiry_id: updatedDriver.persona_inquiry_id,
        status: updatedDriver.persona_status
      }
    });
  })
);

/* =========================================================
   PERSONA REFRESH: RIDER
========================================================= */
app.post(
  "/api/riders/:riderId/refresh-verification",
  asyncHandler(async (req, res) => {
    requireSupabase();

    const rider = await getRiderById(req.params.riderId);
    if (!rider) {
      return fail(res, "Rider not found.", 404);
    }

    if (!rider.persona_inquiry_id) {
      return fail(res, "Rider has no Persona inquiry yet.", 400);
    }

    const payload = await fetchPersonaInquiry(rider.persona_inquiry_id);
    const result = extractPersonaVerificationResult(payload);

    const updatedRider = await applyRiderPersonaDecision({
      rider,
      inquiry_id: result.inquiry_id,
      persona_status: result.persona_status,
      verification_status: result.verification_status
    });

    return success(res, {
      message: "Rider verification refreshed.",
      rider: sanitizeRiderResponse(updatedRider),
      persona: result
    });
  })
);

/* =========================================================
   PERSONA REFRESH: DRIVER
========================================================= */
app.post(
  "/api/drivers/:driverId/refresh-verification",
  asyncHandler(async (req, res) => {
    requireSupabase();

    const driver = await getDriverById(req.params.driverId);
    if (!driver) {
      return fail(res, "Driver not found.", 404);
    }

    if (!driver.persona_inquiry_id) {
      return fail(res, "Driver has no Persona inquiry yet.", 400);
    }

    const payload = await fetchPersonaInquiry(driver.persona_inquiry_id);
    const result = extractPersonaVerificationResult(payload);

    const updatedDriver = await applyDriverPersonaDecision({
      driver,
      inquiry_id: result.inquiry_id,
      persona_status: result.persona_status,
      verification_status: result.verification_status
    });

    return success(res, {
      message: "Driver verification refreshed.",
      driver: sanitizeDriverResponse(updatedDriver),
      persona: result
    });
  })
);

/* =========================================================
   PERSONA WEBHOOK
   IMPORTANT:
   To verify signatures correctly, register this route before
   express.json in production if you move to raw-body validation.
   This version supports current clean rebuild structure and
   protects approval logic by never auto-approving without a
   mapped approved status.
========================================================= */
app.post(
  "/api/webhooks/persona",
  asyncHandler(async (req, res) => {
    requireSupabase();

    const signatureOk = verifyPersonaWebhookSignature(req);
    if (!signatureOk) {
      return fail(res, "Invalid Persona webhook signature.", 401);
    }

    const payload = req.body || {};
    const eventName = lower(
      payload?.data?.attributes?.name ||
        payload?.meta?.event_name ||
        payload?.event_name ||
        ""
    );

    const result = extractPersonaVerificationResult(payload);
    const referenceId = extractPersonaReferenceId(payload);

    let entityType = "";
    let entityId = "";

    if (referenceId.includes(":")) {
      const [type, id] = referenceId.split(":");
      entityType = cleanEnv(type);
      entityId = cleanEnv(id);
    }

    if (!entityType || !entityId) {
      if (eventName.includes("inquiry")) {
        await maybeInsertAdminLog({
          action: "persona_webhook_unresolved_reference",
          entity_type: "persona",
          entity_id: result.inquiry_id || "",
          admin_email: ADMIN_EMAIL,
          details: {
            event_name: eventName,
            reference_id: referenceId,
            persona_status: result.persona_status,
            verification_status: result.verification_status
          }
        });

        return success(res, {
          received: true,
          message: "Webhook received, but no resolvable entity reference was found."
        });
      }
    }

    if (entityType === "rider") {
      const rider = await getRiderById(entityId);

      if (!rider) {
        return fail(res, "Rider referenced by Persona webhook was not found.", 404);
      }

      const updatedRider = await applyRiderPersonaDecision({
        rider,
        inquiry_id: result.inquiry_id,
        persona_status: result.persona_status,
        verification_status: result.verification_status
      });

      await maybeInsertTripEvent({
        ride_id: "",
        mission_id: "",
        event_type: "persona_rider_webhook_processed",
        actor_type: "rider",
        actor_id: updatedRider.id,
        payload: {
          event_name: eventName,
          inquiry_id: result.inquiry_id,
          persona_status: result.persona_status,
          verification_status: result.verification_status
        }
      });

      return success(res, {
        received: true,
        entity_type: "rider",
        rider_id: updatedRider.id,
        verification_status: updatedRider.verification_status
      });
    }

    if (entityType === "driver") {
      const driver = await getDriverById(entityId);

      if (!driver) {
        return fail(res, "Driver referenced by Persona webhook was not found.", 404);
      }

      const updatedDriver = await applyDriverPersonaDecision({
        driver,
        inquiry_id: result.inquiry_id,
        persona_status: result.persona_status,
        verification_status: result.verification_status
      });

      await maybeInsertTripEvent({
        ride_id: "",
        mission_id: "",
        event_type: "persona_driver_webhook_processed",
        actor_type: "driver",
        actor_id: updatedDriver.id,
        payload: {
          event_name: eventName,
          inquiry_id: result.inquiry_id,
          persona_status: result.persona_status,
          verification_status: result.verification_status
        }
      });

      return success(res, {
        received: true,
        entity_type: "driver",
        driver_id: updatedDriver.id,
        verification_status: updatedDriver.verification_status
      });
    }

    await maybeInsertAdminLog({
      action: "persona_webhook_received_unknown_entity",
      entity_type: "persona",
      entity_id: result.inquiry_id || "",
      admin_email: ADMIN_EMAIL,
      details: {
        event_name: eventName,
        reference_id: referenceId,
        persona_status: result.persona_status,
        verification_status: result.verification_status
      }
    });

    return success(res, {
      received: true,
      message: "Webhook received."
    });
  })
);

/* =========================================================
   ADMIN: FORCE PERSONA DECISION FOR TESTING
========================================================= */
app.post(
  "/api/admin/riders/:riderId/persona-decision",
  requireAdmin,
  asyncHandler(async (req, res) => {
    requireSupabase();

    const rider = await getRiderById(req.params.riderId);
    if (!rider) {
      return fail(res, "Rider not found.", 404);
    }

    const persona_status = lower(req.body?.persona_status || "approved");
    const verification_status = mapPersonaStatusToVerificationStatus(persona_status);

    const updatedRider = await applyRiderPersonaDecision({
      rider,
      inquiry_id: cleanEnv(req.body?.inquiry_id || rider.persona_inquiry_id),
      persona_status,
      verification_status
    });

    return success(res, {
      message: "Rider Persona decision applied.",
      rider: sanitizeRiderResponse(updatedRider)
    });
  })
);

app.post(
  "/api/admin/drivers/:driverId/persona-decision",
  requireAdmin,
  asyncHandler(async (req, res) => {
    requireSupabase();

    const driver = await getDriverById(req.params.driverId);
    if (!driver) {
      return fail(res, "Driver not found.", 404);
    }

    const persona_status = lower(req.body?.persona_status || "approved");
    const verification_status = mapPersonaStatusToVerificationStatus(persona_status);

    const updatedDriver = await applyDriverPersonaDecision({
      driver,
      inquiry_id: cleanEnv(req.body?.inquiry_id || driver.persona_inquiry_id),
      persona_status,
      verification_status
    });

    return success(res, {
      message: "Driver Persona decision applied.",
      driver: sanitizeDriverResponse(updatedDriver)
    });
  })
);/* =========================================================
   HARVEY TAXI — CODE BLUE CLEAN REBUILD
   PART 5: RIDE REQUEST + FARE + GATES + MODE SUPPORT
========================================================= */

/* =========================================================
   RIDE HELPERS
========================================================= */
function normalizeRequestedMode(value = "") {
  const mode = lower(value);

  if (["autonomous", "av", "robotaxi"].includes(mode)) {
    return DRIVER_TYPES.AUTONOMOUS;
  }

  return DRIVER_TYPES.HUMAN;
}

async function createRideRecord({
  rider,
  pickup_address,
  dropoff_address,
  distance_miles,
  duration_minutes,
  fare,
  driver_payout,
  platform_revenue,
  surge_multiplier,
  requested_mode,
  notes = ""
}) {
  requireSupabase();

  const rideId = generateId("ride");

  const payload = {
    id: rideId,
    rider_id: rider.id,
    pickup_address,
    dropoff_address,
    distance_miles,
    duration_minutes,
    fare,
    driver_payout,
    platform_revenue,
    surge_multiplier,
    requested_mode,
    status: RIDE_STATUS.PENDING,
    notes: cleanEnv(notes),
    created_at: nowIso(),
    updated_at: nowIso()
  };

  const { data, error } = await supabase
    .from("rides")
    .insert(payload)
    .select("*")
    .single();

  if (error) {
    throw new Error(`Failed to create ride: ${error.message}`);
  }

  await maybeInsertTripEvent({
    ride_id: data.id,
    event_type: "ride_created",
    actor_type: "rider",
    actor_id: rider.id,
    payload
  });

  return data;
}

async function getLatestPaymentForRider(riderId) {
  requireSupabase();

  const { data, error } = await supabase
    .from("payments")
    .select("*")
    .eq("rider_id", riderId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load payment: ${error.message}`);
  }

  return data || null;
}

/* =========================================================
   FARE ESTIMATE
========================================================= */
app.post(
  "/api/fare-estimate",
  asyncHandler(async (req, res) => {
    const pickup_address = cleanEnv(req.body?.pickup_address);
    const dropoff_address = cleanEnv(req.body?.dropoff_address);

    const requested_mode = normalizeRequestedMode(
      req.body?.requestedMode || req.body?.mode
    );

    if (!pickup_address || !dropoff_address) {
      return fail(res, "Pickup and dropoff are required.", 400);
    }

    /* TEMP ESTIMATION (will upgrade later with Google API) */
    const distanceMiles = 5 + Math.random() * 10;
    const durationMinutes = estimateDurationMinutes(distanceMiles);

    const surgeMultiplier = getSurgeMultiplier({
      busy: false,
      highDemand: false
    });

    const fareData = calculateFare({
      distanceMiles,
      durationMinutes,
      surgeMultiplier,
      requestedMode: requested_mode
    });

    return success(res, {
      pickup_address,
      dropoff_address,
      distance_miles: Number(distanceMiles.toFixed(2)),
      duration_minutes: durationMinutes,
      requested_mode,
      ...fareData
    });
  })
);

/* =========================================================
   REQUEST RIDE (MAIN ENTRY)
========================================================= */
app.post(
  "/api/request-ride",
  asyncHandler(async (req, res) => {
    requireSupabase();

    const rider_id = cleanEnv(req.body?.rider_id || req.body?.riderId);
    const pickup_address = cleanEnv(req.body?.pickup_address);
    const dropoff_address = cleanEnv(req.body?.dropoff_address);
    const notes = cleanEnv(req.body?.notes);

    const requested_mode = normalizeRequestedMode(
      req.body?.requestedMode || req.body?.mode
    );

    if (!rider_id) {
      return fail(res, "Rider ID is required.", 400);
    }

    if (!pickup_address || !dropoff_address) {
      return fail(res, "Pickup and dropoff are required.", 400);
    }

    /* =========================================================
       1. LOAD RIDER
    ========================================================= */
    const rider = await getRiderById(rider_id);

    if (!rider) {
      return fail(res, "Rider not found.", 404);
    }

    const riderSnapshot = getRiderApprovalSnapshot(rider);

    /* =========================================================
       2. ENFORCE RIDER APPROVAL (CRITICAL GATE)
    ========================================================= */
    if (ENABLE_RIDER_VERIFICATION_GATE && !riderSnapshot.approved) {
      return fail(
        res,
        "Rider is not approved. Complete verification before requesting a ride.",
        403,
        {
          rider_id,
          verification_status: riderSnapshot.verificationStatus
        }
      );
    }

    /* =========================================================
       3. ENFORCE PAYMENT AUTHORIZATION (CRITICAL GATE)
    ========================================================= */
    if (ENABLE_PAYMENT_GATE) {
      const payment = await getLatestPaymentForRider(rider.id);

      if (!payment || !paymentAuthorizationIsValid(payment)) {
        return fail(
          res,
          "Payment authorization required before requesting a ride.",
          402,
          {
            rider_id,
            payment_status: payment?.status || "missing"
          }
        );
      }
    }

    /* =========================================================
       4. CALCULATE FARE
    ========================================================= */
    const distanceMiles = 5 + Math.random() * 10;
    const durationMinutes = estimateDurationMinutes(distanceMiles);

    const surgeMultiplier = getSurgeMultiplier({
      busy: false,
      highDemand: false
    });

    const fareData = calculateFare({
      distanceMiles,
      durationMinutes,
      surgeMultiplier,
      requestedMode: requested_mode
    });

    /* =========================================================
       5. CREATE RIDE
    ========================================================= */
    const ride = await createRideRecord({
      rider,
      pickup_address,
      dropoff_address,
      distance_miles: distanceMiles,
      duration_minutes: durationMinutes,
      requested_mode,
      notes,
      ...fareData
    });

    /* =========================================================
       6. RESPONSE (READY FOR DISPATCH ENGINE)
    ========================================================= */
    return success(res, {
      message: "Ride request created. Searching for driver...",
      ride_id: ride.id,
      ride,
      dispatch_ready: true
    });
  })
);

/* =========================================================
   GET RIDES (RIDER)
========================================================= */
app.get(
  "/api/riders/:riderId/rides",
  asyncHandler(async (req, res) => {
    requireSupabase();

    const riderId = cleanEnv(req.params.riderId);

    const { data, error } = await supabase
      .from("rides")
      .select("*")
      .eq("rider_id", riderId)
      .order("created_at", { ascending: false });

    if (error) {
      return fail(res, `Failed to load rides: ${error.message}`, 500);
    }

    return success(res, {
      rider_id: riderId,
      count: data.length,
      rides: data
    });
  })
);

/* =========================================================
   GET SINGLE RIDE
========================================================= */
app.get(
  "/api/rides/:rideId",
  asyncHandler(async (req, res) => {
    requireSupabase();

    const rideId = cleanEnv(req.params.rideId);

    const { data, error } = await supabase
      .from("rides")
      .select("*")
      .eq("id", rideId)
      .maybeSingle();

    if (error) {
      return fail(res, `Failed to load ride: ${error.message}`, 500);
    }

    if (!data) {
      return fail(res, "Ride not found.", 404);
    }

    return success(res, {
      ride: data
    });
  })
);/* =========================================================
   HARVEY TAXI — CODE BLUE CLEAN REBUILD
   PART 6: DISPATCH BRAIN + MISSIONS + AUTO REDISPATCH
========================================================= */

/* =========================================================
   DISPATCH HELPERS
========================================================= */
function parseLocationPoint(value) {
  if (!value) return null;

  if (typeof value === "object" && value.latitude && value.longitude) {
    return {
      latitude: Number(value.latitude),
      longitude: Number(value.longitude)
    };
  }

  if (typeof value === "object" && value.lat && value.lng) {
    return {
      latitude: Number(value.lat),
      longitude: Number(value.lng)
    };
  }

  return null;
}

async function getRideById(rideId = "") {
  requireSupabase();

  const { data, error } = await supabase
    .from("rides")
    .select("*")
    .eq("id", cleanEnv(rideId))
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load ride: ${error.message}`);
  }

  return data || null;
}

async function updateRideById(rideId = "", updates = {}) {
  requireSupabase();

  const { data, error } = await supabase
    .from("rides")
    .update({
      ...cleanObject(updates),
      updated_at: nowIso()
    })
    .eq("id", cleanEnv(rideId))
    .select("*")
    .single();

  if (error) {
    throw new Error(`Failed to update ride: ${error.message}`);
  }

  return data;
}

async function getMissionById(missionId = "") {
  requireSupabase();

  const { data, error } = await supabase
    .from("missions")
    .select("*")
    .eq("id", cleanEnv(missionId))
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load mission: ${error.message}`);
  }

  return data || null;
}

async function updateMissionById(missionId = "", updates = {}) {
  requireSupabase();

  const { data, error } = await supabase
    .from("missions")
    .update({
      ...cleanObject(updates),
      updated_at: nowIso()
    })
    .eq("id", cleanEnv(missionId))
    .select("*")
    .single();

  if (error) {
    throw new Error(`Failed to update mission: ${error.message}`);
  }

  return data;
}

async function getDispatchById(dispatchId = "") {
  requireSupabase();

  const { data, error } = await supabase
    .from("dispatches")
    .select("*")
    .eq("id", cleanEnv(dispatchId))
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load dispatch: ${error.message}`);
  }

  return data || null;
}

async function getOpenDispatchForRide(rideId = "") {
  requireSupabase();

  const { data, error } = await supabase
    .from("dispatches")
    .select("*")
    .eq("ride_id", cleanEnv(rideId))
    .eq("status", DISPATCH_STATUS.OFFERED)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load open dispatch: ${error.message}`);
  }

  return data || null;
}

async function countDispatchAttemptsForRide(rideId = "") {
  requireSupabase();

  const { count, error } = await supabase
    .from("dispatches")
    .select("*", { count: "exact", head: true })
    .eq("ride_id", cleanEnv(rideId));

  if (error) {
    throw new Error(`Failed to count dispatch attempts: ${error.message}`);
  }

  return Number(count || 0);
}

async function getPendingMissionForRide(rideId = "") {
  requireSupabase();

  const { data, error } = await supabase
    .from("missions")
    .select("*")
    .eq("ride_id", cleanEnv(rideId))
    .in("status", ["offered", "assigned", "accepted", "driver_en_route", "arrived", "in_progress"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load mission: ${error.message}`);
  }

  return data || null;
}

async function getDriverLocation(driverId = "") {
  requireSupabase();

  const { data, error } = await supabase
    .from("driver_locations")
    .select("*")
    .eq("driver_id", cleanEnv(driverId))
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    return null;
  }

  return data || null;
}

async function listDispatchEligibleDrivers(requestedMode = DRIVER_TYPES.HUMAN) {
  requireSupabase();

  const { data, error } = await supabase
    .from("drivers")
    .select("*")
    .eq("driver_type", requestedMode);

  if (error) {
    throw new Error(`Failed to list drivers: ${error.message}`);
  }

  const eligible = [];

  for (const driver of data || []) {
    const snapshot = getDriverApprovalSnapshot(driver);
    if (!snapshot.dispatchEligible) continue;

    const hasActiveMission = await driverHasActiveMission(driver.id);
    if (hasActiveMission) continue;

    eligible.push(driver);
  }

  return eligible;
}

async function driverHasActiveMission(driverId = "") {
  requireSupabase();

  const { data, error } = await supabase
    .from("missions")
    .select("id,status")
    .eq("driver_id", cleanEnv(driverId))
    .in("status", ["offered", "assigned", "accepted", "driver_en_route", "arrived", "in_progress"])
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) {
    throw new Error(`Failed checking driver mission state: ${error.message}`);
  }

  return Array.isArray(data) && data.length > 0;
}

async function rankDriversForRide(ride = {}) {
  const requestedMode = normalizeRequestedMode(ride.requested_mode || "");
  const drivers = await listDispatchEligibleDrivers(requestedMode);

  const pickupPoint = parseLocationPoint(ride.pickup_location);
  const ranked = [];

  for (const driver of drivers) {
    const location = await getDriverLocation(driver.id);

    let distanceScore = 999999;
    if (pickupPoint && location?.latitude && location?.longitude) {
      distanceScore = haversineMiles(
        Number(location.latitude),
        Number(location.longitude),
        Number(pickupPoint.latitude),
        Number(pickupPoint.longitude)
      );
    }

    ranked.push({
      driver,
      location,
      distance_score: Number(distanceScore || 999999)
    });
  }

  ranked.sort((a, b) => a.distance_score - b.distance_score);
  return ranked;
}

async function createMission({
  ride,
  driver,
  dispatch_id = ""
}) {
  requireSupabase();

  const missionId = generateId("mission");

  const payload = {
    id: missionId,
    ride_id: ride.id,
    rider_id: ride.rider_id,
    driver_id: driver.id,
    dispatch_id: cleanEnv(dispatch_id) || null,
    requested_mode: normalizeRequestedMode(ride.requested_mode || ""),
    pickup_address: ride.pickup_address,
    dropoff_address: ride.dropoff_address,
    fare: ride.fare,
    driver_payout: ride.driver_payout,
    platform_revenue: ride.platform_revenue,
    notes: ride.notes || "",
    status: "offered",
    created_at: nowIso(),
    updated_at: nowIso()
  };

  const { data, error } = await supabase
    .from("missions")
    .insert(payload)
    .select("*")
    .single();

  if (error) {
    throw new Error(`Failed to create mission: ${error.message}`);
  }

  await maybeInsertTripEvent({
    ride_id: ride.id,
    mission_id: data.id,
    event_type: "mission_created",
    actor_type: "system",
    actor_id: driver.id,
    payload
  });

  return data;
}

async function createDispatch({
  ride,
  driver,
  attempt_number = 1
}) {
  requireSupabase();

  const dispatchId = generateId("dispatch");
  const expiresAt = new Date(
    Date.now() + DISPATCH_TIMEOUT_SECONDS * 1000
  ).toISOString();

  const payload = {
    id: dispatchId,
    ride_id: ride.id,
    rider_id: ride.rider_id,
    driver_id: driver.id,
    requested_mode: normalizeRequestedMode(ride.requested_mode || ""),
    attempt_number,
    status: DISPATCH_STATUS.OFFERED,
    expires_at: expiresAt,
    created_at: nowIso(),
    updated_at: nowIso()
  };

  const { data, error } = await supabase
    .from("dispatches")
    .insert(payload)
    .select("*")
    .single();

  if (error) {
    throw new Error(`Failed to create dispatch: ${error.message}`);
  }

  await maybeInsertTripEvent({
    ride_id: ride.id,
    event_type: "dispatch_offered",
    actor_type: "driver",
    actor_id: driver.id,
    payload: {
      dispatch_id: data.id,
      driver_id: driver.id,
      attempt_number,
      expires_at: expiresAt
    }
  });

  return data;
}

async function markDriverUnavailableForDispatch(driverId = "", reason = "") {
  if (!driverId) return null;

  try {
    const { data } = await supabase
      .from("drivers")
      .update({
        status: "offline",
        updated_at: nowIso()
      })
      .eq("id", cleanEnv(driverId))
      .select("*")
      .maybeSingle();

    await upsertDriverStatusLog({
      driver_id: driverId,
      event_type: "driver_marked_offline",
      payload: { reason: cleanEnv(reason) || "dispatch_unavailable" }
    });

    return data || null;
  } catch (error) {
    return null;
  }
}

async function sendDispatchOfferForRide(rideId = "") {
  requireSupabase();

  const ride = await getRideById(rideId);
  if (!ride) {
    throw new Error("Ride not found.");
  }

  if (
    [RIDE_STATUS.COMPLETED, RIDE_STATUS.CANCELLED, RIDE_STATUS.FAILED].includes(
      lower(ride.status)
    )
  ) {
    throw new Error("Ride is not dispatchable.");
  }

  const existingOpenDispatch = await getOpenDispatchForRide(ride.id);
  if (existingOpenDispatch) {
    return {
      already_offered: true,
      dispatch: existingOpenDispatch
    };
  }

  const attemptCount = await countDispatchAttemptsForRide(ride.id);
  if (attemptCount >= MAX_DISPATCH_ATTEMPTS) {
    const updatedRide = await updateRideById(ride.id, {
      status: RIDE_STATUS.NO_DRIVER_AVAILABLE
    });

    await maybeInsertTripEvent({
      ride_id: updatedRide.id,
      event_type: "dispatch_max_attempts_reached",
      actor_type: "system",
      actor_id: "",
      payload: {
        attempts: attemptCount
      }
    });

    return {
      no_driver_available: true,
      ride: updatedRide
    };
  }

  const rankedDrivers = await rankDriversForRide(ride);
  if (!rankedDrivers.length) {
    const updatedRide = await updateRideById(ride.id, {
      status: RIDE_STATUS.NO_DRIVER_AVAILABLE
    });

    await maybeInsertTripEvent({
      ride_id: updatedRide.id,
      event_type: "dispatch_no_eligible_driver",
      actor_type: "system",
      actor_id: "",
      payload: {
        requested_mode: ride.requested_mode
      }
    });

    return {
      no_driver_available: true,
      ride: updatedRide
    };
  }

  const target = rankedDrivers[0];
  const dispatch = await createDispatch({
    ride,
    driver: target.driver,
    attempt_number: attemptCount + 1
  });

  const mission = await createMission({
    ride,
    driver: target.driver,
    dispatch_id: dispatch.id
  });

  const updatedRide = await updateRideById(ride.id, {
    status: RIDE_STATUS.AWAITING_DRIVER_ACCEPTANCE,
    current_dispatch_id: dispatch.id,
    current_mission_id: mission.id,
    driver_id: target.driver.id
  });

  return {
    offered: true,
    ride: updatedRide,
    dispatch,
    mission,
    driver: sanitizeDriverResponse(target.driver)
  };
}

async function expireDispatchIfNeeded(dispatch = {}) {
  if (!dispatch?.id) return null;
  if (lower(dispatch.status) !== DISPATCH_STATUS.OFFERED) return null;

  const expiresAt = new Date(dispatch.expires_at || 0).getTime();
  if (!expiresAt || Date.now() < expiresAt) return null;

  const { data: updatedDispatch, error: dispatchError } = await supabase
    .from("dispatches")
    .update({
      status: DISPATCH_STATUS.EXPIRED,
      updated_at: nowIso()
    })
    .eq("id", dispatch.id)
    .eq("status", DISPATCH_STATUS.OFFERED)
    .select("*")
    .maybeSingle();

  if (dispatchError) {
    throw new Error(`Failed to expire dispatch: ${dispatchError.message}`);
  }

  if (!updatedDispatch) return null;

  const mission = await getPendingMissionForRide(dispatch.ride_id);
  if (mission && cleanEnv(mission.dispatch_id) === cleanEnv(dispatch.id)) {
    await updateMissionById(mission.id, {
      status: "expired"
    });
  }

  await maybeInsertTripEvent({
    ride_id: dispatch.ride_id,
    mission_id: mission?.id || "",
    event_type: "dispatch_expired",
    actor_type: "driver",
    actor_id: dispatch.driver_id,
    payload: {
      dispatch_id: dispatch.id
    }
  });

  const ride = await getRideById(dispatch.ride_id);
  if (!ride) return updatedDispatch;

  if (ENABLE_AUTO_REDISPATCH) {
    await updateRideById(ride.id, {
      status: RIDE_STATUS.PENDING
    });

    await sendDispatchOfferForRide(ride.id);
  } else {
    await updateRideById(ride.id, {
      status: RIDE_STATUS.NO_DRIVER_AVAILABLE
    });
  }

  return updatedDispatch;
}

/* =========================================================
   START DISPATCH FOR RIDE
========================================================= */
app.post(
  "/api/rides/:rideId/dispatch",
  asyncHandler(async (req, res) => {
    requireSupabase();

    const ride = await getRideById(req.params.rideId);
    if (!ride) {
      return fail(res, "Ride not found.", 404);
    }

    const result = await sendDispatchOfferForRide(ride.id);

    if (result.no_driver_available) {
      return success(res, {
        message: "No driver available.",
        ride: result.ride,
        no_driver_available: true
      });
    }

    if (result.already_offered) {
      return success(res, {
        message: "Dispatch is already in progress.",
        dispatch: result.dispatch,
        already_offered: true
      });
    }

    return success(res, {
      message: "Dispatch offer sent.",
      ride: result.ride,
      dispatch: result.dispatch,
      mission: result.mission,
      driver: result.driver
    });
  })
);

/* =========================================================
   DRIVER MISSIONS
========================================================= */
app.get(
  "/api/drivers/:driverId/current-mission",
  asyncHandler(async (req, res) => {
    requireSupabase();

    const driverId = cleanEnv(req.params.driverId);

    const { data, error } = await supabase
      .from("missions")
      .select("*")
      .eq("driver_id", driverId)
      .in("status", ["offered", "assigned", "accepted", "driver_en_route", "arrived", "in_progress"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      return fail(res, `Failed to load current mission: ${error.message}`, 500);
    }

    return success(res, {
      driver_id: driverId,
      mission: data || null
    });
  })
);

app.get(
  "/api/drivers/:driverId/missions",
  asyncHandler(async (req, res) => {
    requireSupabase();

    const driverId = cleanEnv(req.params.driverId);

    const { data, error } = await supabase
      .from("missions")
      .select("*")
      .eq("driver_id", driverId)
      .order("created_at", { ascending: false });

    if (error) {
      return fail(res, `Failed to load missions: ${error.message}`, 500);
    }

    return success(res, {
      driver_id: driverId,
      count: (data || []).length,
      missions: data || []
    });
  })
);

/* =========================================================
   DRIVER ACCEPT DISPATCH
========================================================= */
app.post(
  "/api/dispatches/:dispatchId/accept",
  asyncHandler(async (req, res) => {
    requireSupabase();

    const dispatch = await getDispatchById(req.params.dispatchId);
    if (!dispatch) {
      return fail(res, "Dispatch not found.", 404);
    }

    if (lower(dispatch.status) !== DISPATCH_STATUS.OFFERED) {
      return fail(res, "Dispatch is no longer available.", 400);
    }

    const dispatchDriverId = cleanEnv(dispatch.driver_id);
    const requestDriverId = cleanEnv(req.body?.driver_id || req.body?.driverId);

    if (requestDriverId && requestDriverId !== dispatchDriverId) {
      return fail(res, "This dispatch belongs to another driver.", 403);
    }

    const driver = await requireDispatchEligibleDriver(dispatchDriverId);
    const ride = await getRideById(dispatch.ride_id);

    if (!ride) {
      return fail(res, "Ride not found.", 404);
    }

    const expiresAt = new Date(dispatch.expires_at || 0).getTime();
    if (expiresAt && Date.now() > expiresAt) {
      await expireDispatchIfNeeded(dispatch);
      return fail(res, "Dispatch offer expired.", 410);
    }

    const { data: updatedDispatch, error: dispatchError } = await supabase
      .from("dispatches")
      .update({
        status: DISPATCH_STATUS.ACCEPTED,
        accepted_at: nowIso(),
        updated_at: nowIso()
      })
      .eq("id", dispatch.id)
      .eq("status", DISPATCH_STATUS.OFFERED)
      .select("*")
      .maybeSingle();

    if (dispatchError) {
      return fail(res, `Failed to accept dispatch: ${dispatchError.message}`, 500);
    }

    if (!updatedDispatch) {
      return fail(res, "Dispatch could not be accepted.", 409);
    }

    const mission = await getPendingMissionForRide(ride.id);
    let updatedMission = mission;
    if (mission) {
      updatedMission = await updateMissionById(mission.id, {
        status: "accepted",
        accepted_at: nowIso()
      });
    }

    const updatedRide = await updateRideById(ride.id, {
      status: RIDE_STATUS.DISPATCHED,
      driver_id: driver.id
    });

    await maybeInsertTripEvent({
      ride_id: ride.id,
      mission_id: updatedMission?.id || "",
      event_type: "dispatch_accepted",
      actor_type: "driver",
      actor_id: driver.id,
      payload: {
        dispatch_id: dispatch.id
      }
    });

    return success(res, {
      message: "Dispatch accepted.",
      ride: updatedRide,
      dispatch: updatedDispatch,
      mission: updatedMission,
      driver: sanitizeDriverResponse(driver)
    });
  })
);

/* =========================================================
   DRIVER DECLINE DISPATCH
========================================================= */
app.post(
  "/api/dispatches/:dispatchId/decline",
  asyncHandler(async (req, res) => {
    requireSupabase();

    const dispatch = await getDispatchById(req.params.dispatchId);
    if (!dispatch) {
      return fail(res, "Dispatch not found.", 404);
    }

    if (lower(dispatch.status) !== DISPATCH_STATUS.OFFERED) {
      return fail(res, "Dispatch is no longer available.", 400);
    }

    const reason = cleanEnv(req.body?.reason || "declined_by_driver");

    const { data: updatedDispatch, error: dispatchError } = await supabase
      .from("dispatches")
      .update({
        status: DISPATCH_STATUS.DECLINED,
        decline_reason: reason,
        updated_at: nowIso()
      })
      .eq("id", dispatch.id)
      .eq("status", DISPATCH_STATUS.OFFERED)
      .select("*")
      .maybeSingle();

    if (dispatchError) {
      return fail(res, `Failed to decline dispatch: ${dispatchError.message}`, 500);
    }

    if (!updatedDispatch) {
      return fail(res, "Dispatch could not be declined.", 409);
    }

    const mission = await getPendingMissionForRide(dispatch.ride_id);
    if (mission && cleanEnv(mission.dispatch_id) === cleanEnv(dispatch.id)) {
      await updateMissionById(mission.id, {
        status: "declined"
      });
    }

    await maybeInsertTripEvent({
      ride_id: dispatch.ride_id,
      mission_id: mission?.id || "",
      event_type: "dispatch_declined",
      actor_type: "driver",
      actor_id: dispatch.driver_id,
      payload: {
        dispatch_id: dispatch.id,
        reason
      }
    });

    const ride = await updateRideById(dispatch.ride_id, {
      status: RIDE_STATUS.PENDING
    });

    let redispatchResult = null;
    if (ENABLE_AUTO_REDISPATCH) {
      redispatchResult = await sendDispatchOfferForRide(ride.id);
    }

    return success(res, {
      message: "Dispatch declined.",
      ride: ride,
      dispatch: updatedDispatch,
      redispatch: redispatchResult
    });
  })
);

/* =========================================================
   DISPATCH SWEEP
========================================================= */
async function sweepExpiredDispatches() {
  if (!supabase) return;

  try {
    const { data, error } = await supabase
      .from("dispatches")
      .select("*")
      .eq("status", DISPATCH_STATUS.OFFERED)
      .lte("expires_at", nowIso())
      .limit(25);

    if (error) {
      console.warn("⚠️ dispatch sweep error:", error.message);
      return;
    }

    for (const dispatch of data || []) {
      try {
        await expireDispatchIfNeeded(dispatch);
      } catch (error) {
        console.warn("⚠️ dispatch expire failed:", error.message);
      }
    }
  } catch (error) {
    console.warn("⚠️ dispatch sweep crashed:", error.message);
  }
}

if (ENABLE_AUTO_REDISPATCH) {
  setInterval(() => {
    sweepExpiredDispatches().catch((error) => {
      console.warn("⚠️ dispatch sweep unhandled error:", error.message);
    });
  }, DISPATCH_SWEEP_INTERVAL_MS);
}

/* =========================================================
   RIDE DISPATCH STATUS
========================================================= */
app.get(
  "/api/rides/:rideId/dispatch-status",
  asyncHandler(async (req, res) => {
    requireSupabase();

    const ride = await getRideById(req.params.rideId);
    if (!ride) {
      return fail(res, "Ride not found.", 404);
    }

    const openDispatch = await getOpenDispatchForRide(ride.id);
    const mission = await getPendingMissionForRide(ride.id);

    return success(res, {
      ride_id: ride.id,
      ride_status: ride.status,
      driver_id: ride.driver_id || null,
      current_dispatch_id: ride.current_dispatch_id || null,
      current_mission_id: ride.current_mission_id || null,
      open_dispatch: openDispatch,
      mission
    });
  })
);/* =========================================================
   HARVEY TAXI — CODE BLUE CLEAN REBUILD
   PART 7: TRIP LIFECYCLE + EARNINGS + EVENTS
========================================================= */

/* =========================================================
   DRIVER EN ROUTE
========================================================= */
app.post(
  "/api/missions/:missionId/en-route",
  asyncHandler(async (req, res) => {
    requireSupabase();

    const mission = await getMissionById(req.params.missionId);
    if (!mission) return fail(res, "Mission not found.", 404);

    const updatedMission = await updateMissionById(mission.id, {
      status: "driver_en_route",
      driver_en_route_at: nowIso()
    });

    const updatedRide = await updateRideById(mission.ride_id, {
      status: RIDE_STATUS.DRIVER_EN_ROUTE
    });

    await maybeInsertTripEvent({
      ride_id: mission.ride_id,
      mission_id: mission.id,
      event_type: "driver_en_route",
      actor_type: "driver",
      actor_id: mission.driver_id
    });

    return success(res, {
      message: "Driver en route.",
      mission: updatedMission,
      ride: updatedRide
    });
  })
);

/* =========================================================
   DRIVER ARRIVED
========================================================= */
app.post(
  "/api/missions/:missionId/arrived",
  asyncHandler(async (req, res) => {
    requireSupabase();

    const mission = await getMissionById(req.params.missionId);
    if (!mission) return fail(res, "Mission not found.", 404);

    const updatedMission = await updateMissionById(mission.id, {
      status: "arrived",
      arrived_at: nowIso()
    });

    const updatedRide = await updateRideById(mission.ride_id, {
      status: RIDE_STATUS.DRIVER_ARRIVED
    });

    await maybeInsertTripEvent({
      ride_id: mission.ride_id,
      mission_id: mission.id,
      event_type: "driver_arrived",
      actor_type: "driver",
      actor_id: mission.driver_id
    });

    return success(res, {
      message: "Driver arrived.",
      mission: updatedMission,
      ride: updatedRide
    });
  })
);

/* =========================================================
   START TRIP
========================================================= */
app.post(
  "/api/missions/:missionId/start",
  asyncHandler(async (req, res) => {
    requireSupabase();

    const mission = await getMissionById(req.params.missionId);
    if (!mission) return fail(res, "Mission not found.", 404);

    const updatedMission = await updateMissionById(mission.id, {
      status: "in_progress",
      started_at: nowIso()
    });

    const updatedRide = await updateRideById(mission.ride_id, {
      status: RIDE_STATUS.IN_PROGRESS
    });

    await maybeInsertTripEvent({
      ride_id: mission.ride_id,
      mission_id: mission.id,
      event_type: "trip_started",
      actor_type: "driver",
      actor_id: mission.driver_id
    });

    return success(res, {
      message: "Trip started.",
      mission: updatedMission,
      ride: updatedRide
    });
  })
);

/* =========================================================
   COMPLETE TRIP
========================================================= */
app.post(
  "/api/missions/:missionId/complete",
  asyncHandler(async (req, res) => {
    requireSupabase();

    const mission = await getMissionById(req.params.missionId);
    if (!mission) return fail(res, "Mission not found.", 404);

    const ride = await getRideById(mission.ride_id);

    const updatedMission = await updateMissionById(mission.id, {
      status: "completed",
      completed_at: nowIso()
    });

    const updatedRide = await updateRideById(ride.id, {
      status: RIDE_STATUS.COMPLETED,
      completed_at: nowIso()
    });

    /* =========================================================
       DRIVER EARNINGS
    ========================================================= */
    await supabase.from("driver_earnings").insert({
      id: generateId("earn"),
      driver_id: mission.driver_id,
      ride_id: ride.id,
      amount: ride.driver_payout,
      status: "pending",
      created_at: nowIso()
    });

    await maybeInsertTripEvent({
      ride_id: ride.id,
      mission_id: mission.id,
      event_type: "trip_completed",
      actor_type: "driver",
      actor_id: mission.driver_id,
      payload: {
        fare: ride.fare,
        payout: ride.driver_payout
      }
    });

    return success(res, {
      message: "Trip completed.",
      ride: updatedRide,
      mission: updatedMission
    });
  })
);

/* =========================================================
   CANCEL RIDE (RIDER OR DRIVER)
========================================================= */
app.post(
  "/api/rides/:rideId/cancel",
  asyncHandler(async (req, res) => {
    requireSupabase();

    const ride = await getRideById(req.params.rideId);
    if (!ride) return fail(res, "Ride not found.", 404);

    const reason = cleanEnv(req.body?.reason || "cancelled");

    const updatedRide = await updateRideById(ride.id, {
      status: RIDE_STATUS.CANCELLED,
      cancel_reason: reason
    });

    await maybeInsertTripEvent({
      ride_id: ride.id,
      event_type: "ride_cancelled",
      actor_type: "system",
      actor_id: "",
      payload: { reason }
    });

    return success(res, {
      message: "Ride cancelled.",
      ride: updatedRide
    });
  })
);

/* =========================================================
   DRIVER EARNINGS VIEW
========================================================= */
app.get(
  "/api/drivers/:driverId/earnings",
  asyncHandler(async (req, res) => {
    requireSupabase();

    const driverId = cleanEnv(req.params.driverId);

    const { data, error } = await supabase
      .from("driver_earnings")
      .select("*")
      .eq("driver_id", driverId)
      .order("created_at", { ascending: false });

    if (error) {
      return fail(res, "Failed to load earnings", 500);
    }

    const total = (data || []).reduce(
      (sum, item) => sum + Number(item.amount || 0),
      0
    );

    return success(res, {
      driver_id: driverId,
      total_earnings: Number(total.toFixed(2)),
      count: data.length,
      earnings: data
    });
  })
);

/* =========================================================
   TRIP TIMELINE (EVENTS)
========================================================= */
app.get(
  "/api/rides/:rideId/timeline",
  asyncHandler(async (req, res) => {
    requireSupabase();

    const rideId = cleanEnv(req.params.rideId);

    const { data, error } = await supabase
      .from("trip_events")
      .select("*")
      .eq("ride_id", rideId)
      .order("created_at", { ascending: true });

    if (error) {
      return fail(res, "Failed to load timeline", 500);
    }

    return success(res, {
      ride_id: rideId,
      events: data
    });
  })
);/* =========================================================
   HARVEY TAXI — CODE BLUE CLEAN REBUILD
   PART 8: PAYMENTS + TIPS + ADMIN ANALYTICS + AI SUPPORT
========================================================= */

/* =========================================================
   PAYMENT HELPERS
========================================================= */
function normalizePaymentStatus(value = "") {
  const status = lower(value);

  if (["authorized", "preauthorized", "held"].includes(status)) {
    return "authorized";
  }

  if (["captured", "paid", "completed"].includes(status)) {
    return "captured";
  }

  if (["released", "voided", "cancelled"].includes(status)) {
    return "released";
  }

  if (["failed", "declined"].includes(status)) {
    return "failed";
  }

  return status || "pending";
}

async function getPaymentById(paymentId = "") {
  requireSupabase();

  const { data, error } = await supabase
    .from("payments")
    .select("*")
    .eq("id", cleanEnv(paymentId))
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load payment: ${error.message}`);
  }

  return data || null;
}

async function createPaymentRecord({
  rider_id = "",
  ride_id = "",
  amount = 0,
  status = "authorized",
  provider = "manual",
  payment_method = "card",
  external_reference = ""
}) {
  requireSupabase();

  const payload = {
    id: generateId("pay"),
    rider_id: cleanEnv(rider_id),
    ride_id: cleanEnv(ride_id) || null,
    amount: Number(amount || 0),
    status: normalizePaymentStatus(status),
    provider: cleanEnv(provider || "manual"),
    payment_method: cleanEnv(payment_method || "card"),
    external_reference: cleanEnv(external_reference) || null,
    created_at: nowIso(),
    updated_at: nowIso()
  };

  const { data, error } = await supabase
    .from("payments")
    .insert(payload)
    .select("*")
    .single();

  if (error) {
    throw new Error(`Failed to create payment record: ${error.message}`);
  }

  await maybeInsertAdminLog({
    action: "payment_record_created",
    entity_type: "payment",
    entity_id: data.id,
    admin_email: ADMIN_EMAIL,
    details: {
      rider_id: data.rider_id,
      ride_id: data.ride_id,
      amount: data.amount,
      status: data.status
    }
  });

  return data;
}

async function updatePaymentById(paymentId = "", updates = {}) {
  requireSupabase();

  const { data, error } = await supabase
    .from("payments")
    .update({
      ...cleanObject(updates),
      updated_at: nowIso()
    })
    .eq("id", cleanEnv(paymentId))
    .select("*")
    .single();

  if (error) {
    throw new Error(`Failed to update payment: ${error.message}`);
  }

  return data;
}

async function createTipRecord({
  ride_id = "",
  rider_id = "",
  driver_id = "",
  amount = 0,
  source = "post_trip"
}) {
  requireSupabase();

  const payload = {
    id: generateId("tip"),
    ride_id: cleanEnv(ride_id),
    rider_id: cleanEnv(rider_id),
    driver_id: cleanEnv(driver_id),
    amount: Number(amount || 0),
    source: cleanEnv(source || "post_trip"),
    created_at: nowIso()
  };

  const { data, error } = await supabase
    .from("tips")
    .insert(payload)
    .select("*")
    .single();

  if (error) {
    throw new Error(`Failed to create tip: ${error.message}`);
  }

  return data;
}

/* =========================================================
   PAYMENT AUTHORIZATION
   Creates the payment hold required before ride request
========================================================= */
app.post(
  "/api/payments/authorize",
  asyncHandler(async (req, res) => {
    requireSupabase();

    const rider_id = cleanEnv(req.body?.rider_id || req.body?.riderId);
    const amount = Number(req.body?.amount || 0);
    const provider = cleanEnv(req.body?.provider || "manual");
    const payment_method = cleanEnv(req.body?.payment_method || "card");
    const external_reference = cleanEnv(
      req.body?.external_reference || req.body?.reference
    );

    if (!rider_id) {
      return fail(res, "Rider ID is required.", 400);
    }

    if (!(amount > 0)) {
      return fail(res, "Authorization amount must be greater than 0.", 400);
    }

    const rider = await getRiderById(rider_id);
    if (!rider) {
      return fail(res, "Rider not found.", 404);
    }

    const payment = await createPaymentRecord({
      rider_id,
      amount,
      status: "authorized",
      provider,
      payment_method,
      external_reference
    });

    await maybeInsertTripEvent({
      ride_id: "",
      mission_id: "",
      event_type: "payment_authorized",
      actor_type: "rider",
      actor_id: rider_id,
      payload: {
        payment_id: payment.id,
        amount: payment.amount
      }
    });

    return success(
      res,
      {
        message: "Payment authorized successfully.",
        payment
      },
      201
    );
  })
);

/* =========================================================
   PAYMENT CAPTURE
========================================================= */
app.post(
  "/api/payments/:paymentId/capture",
  asyncHandler(async (req, res) => {
    requireSupabase();

    const payment = await getPaymentById(req.params.paymentId);
    if (!payment) {
      return fail(res, "Payment not found.", 404);
    }

    if (!paymentAuthorizationIsValid(payment) && lower(payment.status) !== "authorized") {
      return fail(res, "Payment is not in an authorized state.", 400);
    }

    const ride = payment.ride_id ? await getRideById(payment.ride_id) : null;

    const updatedPayment = await updatePaymentById(payment.id, {
      status: "captured",
      captured_at: nowIso()
    });

    await maybeInsertTripEvent({
      ride_id: payment.ride_id || "",
      mission_id: "",
      event_type: "payment_captured",
      actor_type: "system",
      actor_id: payment.rider_id,
      payload: {
        payment_id: payment.id,
        amount: updatedPayment.amount
      }
    });

    return success(res, {
      message: "Payment captured successfully.",
      payment: updatedPayment,
      ride
    });
  })
);

/* =========================================================
   PAYMENT RELEASE / VOID
========================================================= */
app.post(
  "/api/payments/:paymentId/release",
  asyncHandler(async (req, res) => {
    requireSupabase();

    const payment = await getPaymentById(req.params.paymentId);
    if (!payment) {
      return fail(res, "Payment not found.", 404);
    }

    const updatedPayment = await updatePaymentById(payment.id, {
      status: "released",
      released_at: nowIso()
    });

    await maybeInsertTripEvent({
      ride_id: payment.ride_id || "",
      mission_id: "",
      event_type: "payment_released",
      actor_type: "system",
      actor_id: payment.rider_id,
      payload: {
        payment_id: payment.id,
        amount: updatedPayment.amount
      }
    });

    return success(res, {
      message: "Payment released successfully.",
      payment: updatedPayment
    });
  })
);

/* =========================================================
   LINK PAYMENT TO RIDE
   Useful after ride creation if the hold existed before ride id
========================================================= */
app.post(
  "/api/rides/:rideId/link-latest-payment",
  asyncHandler(async (req, res) => {
    requireSupabase();

    const ride = await getRideById(req.params.rideId);
    if (!ride) {
      return fail(res, "Ride not found.", 404);
    }

    const payment = await getLatestPaymentForRider(ride.rider_id);
    if (!payment) {
      return fail(res, "No payment found for rider.", 404);
    }

    const updatedPayment = await updatePaymentById(payment.id, {
      ride_id: ride.id
    });

    return success(res, {
      message: "Latest rider payment linked to ride.",
      payment: updatedPayment,
      ride
    });
  })
);

/* =========================================================
   TIPPING
   Supports in-trip and post-trip tipping
========================================================= */
app.post(
  "/api/rides/:rideId/tip",
  asyncHandler(async (req, res) => {
    requireSupabase();

    const ride = await getRideById(req.params.rideId);
    if (!ride) {
      return fail(res, "Ride not found.", 404);
    }

    if (!ride.driver_id) {
      return fail(res, "Ride has no assigned driver.", 400);
    }

    const amount = Number(req.body?.amount || 0);
    const source = cleanEnv(req.body?.source || "post_trip");

    if (!(amount > 0)) {
      return fail(res, "Tip amount must be greater than 0.", 400);
    }

    const tip = await createTipRecord({
      ride_id: ride.id,
      rider_id: ride.rider_id,
      driver_id: ride.driver_id,
      amount,
      source
    });

    try {
      await supabase.from("driver_earnings").insert({
        id: generateId("earn"),
        driver_id: ride.driver_id,
        ride_id: ride.id,
        amount: Number(amount),
        status: "pending_tip",
        created_at: nowIso()
      });
    } catch (error) {
      console.warn("⚠️ tip earnings insert skipped:", error.message);
    }

    await maybeInsertTripEvent({
      ride_id: ride.id,
      mission_id: ride.current_mission_id || "",
      event_type: "tip_added",
      actor_type: "rider",
      actor_id: ride.rider_id,
      payload: {
        tip_id: tip.id,
        amount,
        source
      }
    });

    return success(
      res,
      {
        message: "Tip added successfully.",
        tip
      },
      201
    );
  })
);

/* =========================================================
   PAYMENTS VIEW
========================================================= */
app.get(
  "/api/riders/:riderId/payments",
  asyncHandler(async (req, res) => {
    requireSupabase();

    const riderId = cleanEnv(req.params.riderId);

    const { data, error } = await supabase
      .from("payments")
      .select("*")
      .eq("rider_id", riderId)
      .order("created_at", { ascending: false });

    if (error) {
      return fail(res, `Failed to load payments: ${error.message}`, 500);
    }

    return success(res, {
      rider_id: riderId,
      count: (data || []).length,
      payments: data || []
    });
  })
);

/* =========================================================
   TIPS VIEW
========================================================= */
app.get(
  "/api/drivers/:driverId/tips",
  asyncHandler(async (req, res) => {
    requireSupabase();

    const driverId = cleanEnv(req.params.driverId);

    const { data, error } = await supabase
      .from("tips")
      .select("*")
      .eq("driver_id", driverId)
      .order("created_at", { ascending: false });

    if (error) {
      return fail(res, `Failed to load tips: ${error.message}`, 500);
    }

    const total = (data || []).reduce(
      (sum, item) => sum + Number(item.amount || 0),
      0
    );

    return success(res, {
      driver_id: driverId,
      total_tips: Number(total.toFixed(2)),
      count: (data || []).length,
      tips: data || []
    });
  })
);

/* =========================================================
   ADMIN ANALYTICS
========================================================= */
app.get(
  "/api/admin/analytics/overview",
  requireAdmin,
  asyncHandler(async (req, res) => {
    requireSupabase();

    const [ridesCount, driversCount, ridersCount, paymentsCount] = await Promise.all([
      getTableCount("rides"),
      getTableCount("drivers"),
      getTableCount("riders"),
      getTableCount("payments")
    ]);

    const { data: ridesData } = await supabase
      .from("rides")
      .select("fare,status,driver_payout,platform_revenue,requested_mode");

    const { data: earningsData } = await supabase
      .from("driver_earnings")
      .select("amount,status");

    const { data: tipsData } = await supabase
      .from("tips")
      .select("amount");

    const rides = ridesData || [];
    const earnings = earningsData || [];
    const tips = tipsData || [];

    const grossFare = rides.reduce(
      (sum, ride) => sum + Number(ride.fare || 0),
      0
    );
    const totalDriverPayout = rides.reduce(
      (sum, ride) => sum + Number(ride.driver_payout || 0),
      0
    );
    const totalPlatformRevenue = rides.reduce(
      (sum, ride) => sum + Number(ride.platform_revenue || 0),
      0
    );
    const totalTips = tips.reduce(
      (sum, tip) => sum + Number(tip.amount || 0),
      0
    );
    const totalLedgerEarnings = earnings.reduce(
      (sum, item) => sum + Number(item.amount || 0),
      0
    );

    const completedRides = rides.filter(
      (ride) => lower(ride.status) === RIDE_STATUS.COMPLETED
    ).length;

    const cancelledRides = rides.filter(
      (ride) => lower(ride.status) === RIDE_STATUS.CANCELLED
    ).length;

    const autonomousRides = rides.filter(
      (ride) => normalizeRequestedMode(ride.requested_mode) === DRIVER_TYPES.AUTONOMOUS
    ).length;

    const humanRides = rides.filter(
      (ride) => normalizeRequestedMode(ride.requested_mode) === DRIVER_TYPES.HUMAN
    ).length;

    return success(res, {
      counts: {
        rides: ridesCount.count || 0,
        drivers: driversCount.count || 0,
        riders: ridersCount.count || 0,
        payments: paymentsCount.count || 0
      },
      financials: {
        gross_fare: Number(grossFare.toFixed(2)),
        total_driver_payout: Number(totalDriverPayout.toFixed(2)),
        total_platform_revenue: Number(totalPlatformRevenue.toFixed(2)),
        total_tips: Number(totalTips.toFixed(2)),
        ledger_total_earnings: Number(totalLedgerEarnings.toFixed(2))
      },
      ride_breakdown: {
        completed: completedRides,
        cancelled: cancelledRides,
        human: humanRides,
        autonomous: autonomousRides
      }
    });
  })
);

/* =========================================================
   ADMIN LOGS / AUDIT VIEW
========================================================= */
app.get(
  "/api/admin/logs",
  requireAdmin,
  asyncHandler(async (req, res) => {
    requireSupabase();

    const limit = Math.min(Number(req.query?.limit || 100), 500);

    const { data, error } = await supabase
      .from("admin_logs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      return fail(res, `Failed to load admin logs: ${error.message}`, 500);
    }

    return success(res, {
      count: (data || []).length,
      logs: data || []
    });
  })
);

app.get(
  "/api/admin/trip-events",
  requireAdmin,
  asyncHandler(async (req, res) => {
    requireSupabase();

    const limit = Math.min(Number(req.query?.limit || 100), 500);

    const { data, error } = await supabase
      .from("trip_events")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      return fail(res, `Failed to load trip events: ${error.message}`, 500);
    }

    return success(res, {
      count: (data || []).length,
      events: data || []
    });
  })
);

/* =========================================================
   RIDER DASHBOARD SUMMARY
========================================================= */
app.get(
  "/api/riders/:riderId/dashboard",
  asyncHandler(async (req, res) => {
    requireSupabase();

    const rider = await getRiderById(req.params.riderId);
    if (!rider) {
      return fail(res, "Rider not found.", 404);
    }

    const { data: rides } = await supabase
      .from("rides")
      .select("*")
      .eq("rider_id", rider.id)
      .order("created_at", { ascending: false })
      .limit(20);

    const { data: payments } = await supabase
      .from("payments")
      .select("*")
      .eq("rider_id", rider.id)
      .order("created_at", { ascending: false })
      .limit(20);

    return success(res, {
      rider: sanitizeRiderResponse(rider),
      recent_rides: rides || [],
      recent_payments: payments || []
    });
  })
);

/* =========================================================
   DRIVER DASHBOARD SUMMARY
========================================================= */
app.get(
  "/api/drivers/:driverId/dashboard",
  asyncHandler(async (req, res) => {
    requireSupabase();

    const driver = await getDriverById(req.params.driverId);
    if (!driver) {
      return fail(res, "Driver not found.", 404);
    }

    const { data: missions } = await supabase
      .from("missions")
      .select("*")
      .eq("driver_id", driver.id)
      .order("created_at", { ascending: false })
      .limit(20);

    const { data: earnings } = await supabase
      .from("driver_earnings")
      .select("*")
      .eq("driver_id", driver.id)
      .order("created_at", { ascending: false })
      .limit(20);

    const { data: tips } = await supabase
      .from("tips")
      .select("*")
      .eq("driver_id", driver.id)
      .order("created_at", { ascending: false })
      .limit(20);

    return success(res, {
      driver: sanitizeDriverResponse(driver),
      recent_missions: missions || [],
      recent_earnings: earnings || [],
      recent_tips: tips || []
    });
  })
);

/* =========================================================
   AI SUPPORT HELPERS
========================================================= */
function getSupportSystemPrompt({ page = "general" } = {}) {
  const pageMode = lower(page);

  const shared = `
You are Harvey AI, the support assistant for Harvey Taxi Service.
Be concise, helpful, and accurate.
Never claim emergency support. If the issue is urgent or dangerous, tell the user to call 911.
Riders must be approved before requesting rides.
Drivers must complete verification, approval, and required onboarding before receiving dispatch.
Payment authorization may be required before dispatch.
Autonomous rides may be pilot-limited depending on availability.
Support email: ${SUPPORT_EMAIL}
`;

  if (pageMode === "rider") {
    return `${shared}
Focus on rider signup, rider approval, ride requests, fares, and payment questions.
`;
  }

  if (pageMode === "driver") {
    return `${shared}
Focus on driver signup, email/SMS verification, approval, missions, payouts, and driver onboarding.
`;
  }

  if (pageMode === "request") {
    return `${shared}
Focus on trip requests, pickup/dropoff, dispatch, delays, and ride status.
`;
  }

  return shared;
}

function getSupportFallbackReply(message = "", page = "general") {
  const msg = lower(message);
  const mode = lower(page);

  if (msg.includes("emergency")) {
    return "Harvey Taxi is not an emergency service. If this is an emergency, call 911 immediately.";
  }

  if (msg.includes("verify") || msg.includes("approval")) {
    return mode === "driver"
      ? "Drivers must complete identity verification, email verification, SMS verification, and approval before receiving dispatch."
      : "Riders must complete identity verification and be approved before requesting rides.";
  }

  if (msg.includes("payment")) {
    return "A valid payment authorization may be required before a ride can be dispatched.";
  }

  if (msg.includes("autonomous") || msg.includes("pilot")) {
    return "Autonomous ride requests may be offered as a pilot mode depending on platform availability and operating rules.";
  }

  if (mode === "driver") {
    return "Driver support can help with onboarding, verification, mission access, and payout questions.";
  }

  if (mode === "rider") {
    return "Rider support can help with account approval, ride access, payment holds, and trip questions.";
  }

  return "Harvey Taxi support can help with rider onboarding, driver onboarding, ride requests, payment questions, and trip status.";
}

/* =========================================================
   AI SUPPORT ENDPOINT
========================================================= */
app.post(
  "/api/ai/support",
  asyncHandler(async (req, res) => {
    const message = cleanEnv(req.body?.message);
    const page = cleanEnv(req.body?.page || "general");

    if (!message) {
      return fail(res, "Message is required.", 400);
    }

    if (!openai) {
      return success(res, {
        ai_enabled: false,
        reply: getSupportFallbackReply(message, page)
      });
    }

    try {
      const completion = await openai.chat.completions.create({
        model: OPENAI_MODEL,
        messages: [
          {
            role: "system",
            content: getSupportSystemPrompt({ page })
          },
          {
            role: "user",
            content: message
          }
        ],
        temperature: 0.4,
        max_tokens: 300
      });

      const reply =
        completion?.choices?.[0]?.message?.content?.trim() ||
        getSupportFallbackReply(message, page);

      return success(res, {
        ai_enabled: true,
        model: OPENAI_MODEL,
        reply
      });
    } catch (error) {
      console.warn("⚠️ AI support fallback:", error.message);

      return success(res, {
        ai_enabled: false,
        reply: getSupportFallbackReply(message, page)
      });
    }
  })
);

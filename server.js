/* =========================================================
   HARVEY TAXI — CODE BLUE
   PART 1: CLEAN FOUNDATION + ENV + HELPERS + HEALTH
   FILE: server.clean.js
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
  console.warn("⚠️ OpenAI SDK not installed. AI endpoints will stay disabled.");
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
  const normalized = cleanEnv(value);
  if (!normalized) return fallback;
  const num = Number(normalized);
  return Number.isFinite(num) ? num : fallback;
}

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

function safeJson(value, fallback = null) {
  try {
    return JSON.parse(value);
  } catch (error) {
    return fallback;
  }
}

/* =========================================================
   GENERAL HELPERS
========================================================= */
function nowIso() {
  return new Date().toISOString();
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
  return digits.startsWith("+" ) ? digits : `+${digits}`;
}

function createId(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}

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

function pickFirst(...values) {
  for (const value of values) {
    if (clean(value)) return clean(value);
  }
  return "";
}

function parseInteger(value, fallback = 0) {
  const n = parseInt(String(value || "").trim(), 10);
  return Number.isFinite(n) ? n : fallback;
}

function parseFloatSafe(value, fallback = 0) {
  const n = parseFloat(String(value || "").trim());
  return Number.isFinite(n) ? n : fallback;
}

function asCurrency(value) {
  const n = Number(value || 0);
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* =========================================================
   FEATURE FLAGS
========================================================= */
const ENABLE_AI = toBool(process.env.ENABLE_AI_BRAIN, true);
const ENABLE_REAL_EMAIL = toBool(process.env.ENABLE_REAL_EMAIL, false);
const ENABLE_REAL_SMS = toBool(process.env.ENABLE_REAL_SMS, false);
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
const OPENAI_MODEL = cleanEnv(process.env.OPENAI_MODEL || process.env.OPENAI_SUPPORT_MODEL || "gpt-4.1-mini");

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
   REQUEST LOGGING
========================================================= */
app.use((req, res, next) => {
  req.requestStartedAt = Date.now();
  next();
});

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

/* =========================================================
   AUTH / ADMIN HELPERS
========================================================= */
const ADMIN_EMAIL = normalizeEmail(process.env.ADMIN_EMAIL || "");
const ADMIN_PASSWORD = cleanEnv(process.env.ADMIN_PASSWORD || "");

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

  next();
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

/* =========================================================
   BUSINESS HELPERS
========================================================= */
function isApprovedRider(rider) {
  if (!rider) return false;

  const status = lower(
    rider.approval_status ||
    rider.status ||
    rider.rider_status ||
    ""
  );

  return ["approved", "active", "verified"].includes(status);
}

function isDriverApproved(driver) {
  if (!driver) return false;

  const status = lower(
    driver.approval_status ||
    driver.status ||
    driver.driver_status ||
    ""
  );

  return ["approved", "active"].includes(status);
}

function isPaymentAuthorized(payment) {
  if (!payment) return false;

  const status = lower(
    payment.status ||
    payment.payment_status ||
    ""
  );

  return [
    "authorized",
    "preauthorized",
    "pre_authorized",
    "held",
    "captured"
  ].includes(status);
}

function riderVerificationSatisfied(rider) {
  if (!rider) return false;

  const approvalStatus = lower(rider.approval_status || rider.status || "");
  const verificationStatus = lower(
    rider.verification_status ||
    rider.identity_status ||
    rider.persona_status ||
    ""
  );

  if (["approved", "active", "verified"].includes(approvalStatus)) return true;
  if (["approved", "completed", "verified"].includes(verificationStatus)) return true;

  return false;
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
  const distanceCharge = asCurrency(Number(miles || 0) * perMile);
  const timeCharge = asCurrency(Number(minutes || 0) * perMinute);
  const subtotal = asCurrency(baseFare + distanceCharge + timeCharge);
  const surgedSubtotal = asCurrency(subtotal * Math.max(Number(surgeMultiplier || 1), 1));
  const totalBeforeMinimum = asCurrency(surgedSubtotal + bookingFee);
  const total = Math.max(totalBeforeMinimum, minimumFare);

  return {
    base_fare: asCurrency(baseFare),
    distance_charge: distanceCharge,
    time_charge: timeCharge,
    surge_multiplier: asCurrency(surgeMultiplier),
    booking_fee: asCurrency(bookingFee),
    minimum_fare: asCurrency(minimumFare),
    estimated_total: asCurrency(total)
  };
}

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
   STARTUP CHECKS
========================================================= */
async function runStartupChecks() {
  const report = {
    app_name: APP_NAME,
    started_at: SERVER_STARTED_AT,
    supabase_ready: supabaseReady,
    ai_ready: Boolean(openai),
    flags: {
      ENABLE_AI,
      ENABLE_REAL_EMAIL,
      ENABLE_REAL_SMS,
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
      const { error } = await supabase.from(table).select("*", { count: "exact", head: true });
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
   CORE ROUTES
========================================================= */
app.get("/", (req, res) => {
  return ok(res, {
    app: APP_NAME,
    started_at: SERVER_STARTED_AT,
    public_app_url: PUBLIC_APP_URL
  }, "Harvey Taxi Code Blue server is running.");
});

app.get("/api/health", async (req, res) => {
  try {
    const startup = await runStartupChecks();

    return ok(res, {
      app: APP_NAME,
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
    }, "Health check successful.");
  } catch (error) {
    return serverError(res, error, "Health check failed.");
  }
});

app.get("/api/config", (req, res) => {
  return ok(res, {
    app: APP_NAME,
    public_app_url: PUBLIC_APP_URL,
    features: {
      ai_enabled: Boolean(openai),
      real_email_enabled: ENABLE_REAL_EMAIL,
      real_sms_enabled: ENABLE_REAL_SMS,
      rider_verification_gate_enabled: ENABLE_RIDER_VERIFICATION_GATE,
      payment_gate_enabled: ENABLE_PAYMENT_GATE,
      auto_redispatch_enabled: ENABLE_AUTO_REDISPATCH
    }
  }, "Runtime config loaded.");
});

/* =========================================================
   NOT FOUND
========================================================= */
app.use((req, res) => {
  return fail(res, `Route not found: ${req.method} ${req.originalUrl}`, 404);
});

/* =========================================================
   SERVER START
========================================================= */
app.listen(PORT, () => {
  console.log(`✅ ${APP_NAME} running on port ${PORT}`);
  console.log(`🌍 Public URL: ${PUBLIC_APP_URL || "not set"}`);
  console.log(`🕒 Started at: ${SERVER_STARTED_AT}`);
  console.log(`🧠 AI enabled: ${Boolean(openai)}`);
  console.log(`🗄️ Supabase ready: ${supabaseReady}`);
});/* =========================================================
   PART 2: RIDERS + VERIFICATION GATE + PAYMENT FOUNDATION
========================================================= */

/* =========================================================
   RIDER HELPERS
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
  if (["failed", "declined", "rejected"].includes(status)) return "failed";

  return status || "pending";
}

function normalizePaymentStatus(value = "") {
  const status = lower(value);

  if (["authorized", "preauthorized", "pre_authorized", "held"].includes(status)) return "authorized";
  if (["captured", "paid", "complete", "completed"].includes(status)) return "captured";
  if (["failed", "declined", "canceled", "cancelled"].includes(status)) return "failed";
  if (["refunded", "voided"].includes(status)) return status;

  return status || "pending";
}

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

function buildPaymentPublicRecord(payment) {
  if (!payment) return null;

  return {
    id: payment.id,
    rider_id: payment.rider_id || "",
    ride_id: payment.ride_id || "",
    amount: asCurrency(payment.amount || 0),
    currency: upper(payment.currency || "USD"),
    status: normalizePaymentStatus(payment.status || payment.payment_status),
    payment_method: clean(payment.payment_method || payment.method || "card"),
    authorization_code: clean(payment.authorization_code || ""),
    created_at: payment.created_at || null,
    updated_at: payment.updated_at || null
  };
}

async function getRiderById(riderId = "") {
  if (!clean(riderId)) return null;
  return dbSelectOne(TABLES.riders, { id: clean(riderId) });
}

async function getRiderByEmail(email = "") {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  return dbSelectOne(TABLES.riders, { email: normalized });
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
    next();
  } catch (error) {
    return serverError(res, error, "Unable to load rider.");
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

    next();
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
          payment_status: payment ? normalizePaymentStatus(payment.status || payment.payment_status) : "missing"
        }
      );
    }

    req.authorizedPayment = payment;
    next();
  } catch (error) {
    return serverError(res, error, "Payment authorization gate failed.");
  }
}

/* =========================================================
   RIDER SIGNUP
========================================================= */
app.post("/api/rider/signup", async (req, res) => {
  try {
    if (!supabase) {
      return fail(res, "Supabase is not configured.", 500);
    }

    const first_name = pickFirst(req.body?.first_name, req.body?.firstName);
    const last_name = pickFirst(req.body?.last_name, req.body?.lastName);
    const email = normalizeEmail(req.body?.email);
    const phone = normalizePhone(req.body?.phone);
    const city = pickFirst(req.body?.city);
    const state = upper(pickFirst(req.body?.state, req.body?.stateValue, "TN"));
    const password = clean(req.body?.password);
    const document_type = lower(
      pickFirst(
        req.body?.document_type,
        req.body?.documentType,
        "id"
      )
    );
    const document_number = clean(
      req.body?.document_number ||
      req.body?.documentNumber ||
      ""
    );
    const persona_inquiry_id = clean(
      req.body?.persona_inquiry_id ||
      req.body?.personaInquiryId ||
      ""
    );
    const persona_status = normalizeVerificationStatus(
      req.body?.persona_status ||
      req.body?.personaStatus ||
      req.body?.verification_status ||
      req.body?.verificationStatus ||
      "pending"
    );

    if (!first_name) return fail(res, "First name is required.", 400);
    if (!last_name) return fail(res, "Last name is required.", 400);
    if (!email) return fail(res, "Email is required.", 400);
    if (!phone) return fail(res, "Phone is required.", 400);
    if (!city) return fail(res, "City is required.", 400);
    if (!state) return fail(res, "State is required.", 400);
    if (!password || password.length < 6) {
      return fail(res, "Password must be at least 6 characters.", 400);
    }

    const existingByEmail = await getRiderByEmail(email);
    if (existingByEmail) {
      return fail(res, "A rider with this email already exists.", 409, {
        rider_id: existingByEmail.id,
        approval_status: normalizeRiderStatus(existingByEmail.approval_status || existingByEmail.status)
      });
    }

    const existingPhone = await dbSelectOne(TABLES.riders, { phone });
    if (existingPhone) {
      return fail(res, "A rider with this phone already exists.", 409, {
        rider_id: existingPhone.id,
        approval_status: normalizeRiderStatus(existingPhone.approval_status || existingPhone.status)
      });
    }

    const rider = await dbInsert(TABLES.riders, {
      id: createId("rider"),
      first_name,
      last_name,
      email,
      phone,
      city,
      state,
      password,
      rider_type: "standard",
      approval_status: "pending",
      verification_status: persona_status,
      identity_status: persona_status,
      persona_status,
      persona_inquiry_id: persona_inquiry_id || null,
      document_type: document_type || "id",
      document_number: document_number || null,
      status: "pending",
      created_at: nowIso(),
      updated_at: nowIso()
    });

    await writeTripEvent({
      rider_id: rider.id,
      event_type: "rider_signup_created",
      event_payload: {
        email,
        phone,
        city,
        state,
        document_type: rider.document_type,
        verification_status: rider.verification_status
      }
    });

    return ok(
      res,
      {
        rider: buildRiderPublicProfile(rider),
        next_step: ENABLE_RIDER_VERIFICATION_GATE
          ? "Wait for rider verification approval before requesting a ride."
          : "Rider account created."
      },
      "Rider signup submitted successfully.",
      201
    );
  } catch (error) {
    return serverError(res, error, "Rider signup failed.");
  }
});

/* =========================================================
   RIDER STATUS
========================================================= */
app.get("/api/rider/status", async (req, res) => {
  try {
    const riderId = clean(req.query?.rider_id || req.query?.riderId || "");
    const email = normalizeEmail(req.query?.email || "");

    if (!riderId && !email) {
      return fail(res, "Rider ID or email is required.", 400);
    }

    const rider = riderId
      ? await getRiderById(riderId)
      : await getRiderByEmail(email);

    if (!rider) {
      return fail(res, "Rider not found.", 404);
    }

    const latestPayment = await getLatestPaymentForRider(rider.id);

    return ok(res, {
      rider: buildRiderPublicProfile(rider),
      rider_can_request_ride:
        (!ENABLE_RIDER_VERIFICATION_GATE || riderVerificationSatisfied(rider)) &&
        (!ENABLE_PAYMENT_GATE || isPaymentAuthorized(latestPayment)),
      gates: {
        verification_required: ENABLE_RIDER_VERIFICATION_GATE,
        payment_required: ENABLE_PAYMENT_GATE,
        verification_passed: riderVerificationSatisfied(rider),
        payment_passed: isPaymentAuthorized(latestPayment)
      },
      latest_payment: buildPaymentPublicRecord(latestPayment)
    }, "Rider status loaded.");
  } catch (error) {
    return serverError(res, error, "Unable to load rider status.");
  }
});

app.get("/api/rider/:riderId", async (req, res) => {
  try {
    const rider = await getRiderById(req.params.riderId);

    if (!rider) {
      return fail(res, "Rider not found.", 404);
    }

    const latestPayment = await getLatestPaymentForRider(rider.id);

    return ok(res, {
      rider: buildRiderPublicProfile(rider),
      latest_payment: buildPaymentPublicRecord(latestPayment)
    }, "Rider profile loaded.");
  } catch (error) {
    return serverError(res, error, "Unable to load rider.");
  }
});

/* =========================================================
   PAYMENT AUTHORIZATION FOUNDATION
========================================================= */
app.post("/api/payments/authorize", async (req, res) => {
  try {
    if (!supabase) {
      return fail(res, "Supabase is not configured.", 500);
    }

    const rider_id = clean(req.body?.rider_id || req.body?.riderId);
    const ride_id = clean(req.body?.ride_id || req.body?.rideId || "");
    const amount = asCurrency(req.body?.amount || 0);
    const currency = upper(clean(req.body?.currency || "USD"));
    const payment_method = clean(req.body?.payment_method || req.body?.paymentMethod || "card");
    const authorization_code = clean(
      req.body?.authorization_code ||
      req.body?.authorizationCode ||
      `auth_${crypto.randomBytes(6).toString("hex")}`
    );

    if (!rider_id) return fail(res, "Rider ID is required.", 400);
    if (!amount || amount <= 0) return fail(res, "A valid authorization amount is required.", 400);

    const rider = await getRiderById(rider_id);
    if (!rider) {
      return fail(res, "Rider not found.", 404);
    }

    const payment = await dbInsert(TABLES.payments, {
      id: createId("pay"),
      rider_id,
      ride_id: ride_id || null,
      amount,
      currency,
      payment_method,
      status: "authorized",
      payment_status: "authorized",
      authorization_code,
      provider: "internal_foundation",
      created_at: nowIso(),
      updated_at: nowIso()
    });

    await writeTripEvent({
      rider_id,
      ride_id,
      event_type: "payment_authorized",
      event_payload: {
        payment_id: payment.id,
        amount,
        currency,
        payment_method
      }
    });

    return ok(res, {
      payment: buildPaymentPublicRecord(payment)
    }, "Payment authorized successfully.", 201);
  } catch (error) {
    return serverError(res, error, "Payment authorization failed.");
  }
});

app.get("/api/payments/latest", async (req, res) => {
  try {
    const rider_id = clean(req.query?.rider_id || req.query?.riderId || "");
    if (!rider_id) {
      return fail(res, "Rider ID is required.", 400);
    }

    const payment = await getLatestPaymentForRider(rider_id);

    return ok(res, {
      payment: buildPaymentPublicRecord(payment)
    }, payment ? "Latest payment loaded." : "No payment found.");
  } catch (error) {
    return serverError(res, error, "Unable to load payment.");
  }
});

/* =========================================================
   FARE ESTIMATE
========================================================= */
app.post("/api/fare-estimate", async (req, res) => {
  try {
    const miles = parseFloatSafe(req.body?.miles, 0);
    const minutes = parseFloatSafe(req.body?.minutes, 0);
    const requestedMode = lower(req.body?.requestedMode || req.body?.requested_mode || "driver");

    let surgeMultiplier = parseFloatSafe(req.body?.surgeMultiplier || req.body?.surge_multiplier, 1);

    if (surgeMultiplier < 1) {
      surgeMultiplier = 1;
    }

    const estimate = buildFareEstimate({
      miles,
      minutes,
      surgeMultiplier
    });

    return ok(res, {
      estimate: {
        ...estimate,
        requested_mode: requestedMode || "driver"
      }
    }, "Fare estimate calculated.");
  } catch (error) {
    return serverError(res, error, "Fare estimate failed.");
  }
});

/* =========================================================
   RIDE REQUEST PRECHECK
========================================================= */
app.post(
  "/api/rides/precheck",
  requireExistingRiderRecord,
  async (req, res, next) => {
    return requireRiderVerificationGate(req, res, next);
  },
  async (req, res, next) => {
    return requirePaymentAuthorizationGate(req, res, next);
  },
  async (req, res) => {
    try {
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

      return ok(res, {
        rider: buildRiderPublicProfile(rider),
        latest_payment: buildPaymentPublicRecord(payment),
        request_ready: true,
        request_summary: {
          pickup_address,
          dropoff_address,
          requested_mode
        }
      }, "Rider is cleared to request a ride.");
    } catch (error) {
      return serverError(res, error, "Ride precheck failed.");
    }
  }
);

/* =========================================================
   ADMIN: RIDER APPROVAL / REJECTION
========================================================= */
app.post("/api/admin/riders/:riderId/approve", requireAdmin, async (req, res) => {
  try {
    const riderId = clean(req.params.riderId);
    const rider = await getRiderById(riderId);

    if (!rider) {
      return fail(res, "Rider not found.", 404);
    }

    const updatedRows = await dbUpdate(
      TABLES.riders,
      { id: riderId },
      {
        approval_status: "approved",
        verification_status: "approved",
        identity_status: "approved",
        persona_status: "approved",
        status: "approved",
        updated_at: nowIso()
      }
    );

    const updated = Array.isArray(updatedRows) ? updatedRows[0] : null;

    await writeAdminLog({
      action: "rider_approved",
      actor_email: getAdminCredentials(req).email,
      target_type: "rider",
      target_id: riderId,
      details: {
        previous_approval_status: rider.approval_status || rider.status || null
      }
    });

    await writeTripEvent({
      rider_id: riderId,
      event_type: "rider_approved",
      event_payload: {
        admin_email: getAdminCredentials(req).email
      }
    });

    return ok(res, {
      rider: buildRiderPublicProfile(updated || rider)
    }, "Rider approved successfully.");
  } catch (error) {
    return serverError(res, error, "Unable to approve rider.");
  }
});

app.post("/api/admin/riders/:riderId/reject", requireAdmin, async (req, res) => {
  try {
    const riderId = clean(req.params.riderId);
    const reason = clean(req.body?.reason || "Rider verification was not approved.");
    const rider = await getRiderById(riderId);

    if (!rider) {
      return fail(res, "Rider not found.", 404);
    }

    const updatedRows = await dbUpdate(
      TABLES.riders,
      { id: riderId },
      {
        approval_status: "rejected",
        verification_status: "failed",
        identity_status: "failed",
        persona_status: "failed",
        status: "rejected",
        rejection_reason: reason,
        updated_at: nowIso()
      }
    );

    const updated = Array.isArray(updatedRows) ? updatedRows[0] : null;

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

    return ok(res, {
      rider: buildRiderPublicProfile(updated || rider)
    }, "Rider rejected successfully.");
  } catch (error) {
    return serverError(res, error, "Unable to reject rider.");
  }
});/* =========================================================
   PART 3: RIDES + DISPATCH FOUNDATION + MISSION FLOW
========================================================= */

/* =========================================================
   DISPATCH / RIDE HELPERS
========================================================= */
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

function addSecondsToIso(seconds = 0) {
  return new Date(Date.now() + Math.max(0, Number(seconds || 0)) * 1000).toISOString();
}

async function getDriverById(driverId = "") {
  if (!clean(driverId)) return null;
  return dbSelectOne(TABLES.drivers, { id: clean(driverId) });
}

async function getRideById(rideId = "") {
  if (!clean(rideId)) return null;
  return dbSelectOne(TABLES.rides, { id: clean(rideId) });
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
      limit: 20
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
      limit: 20
    }
  );
}

async function getMissionById(missionId = "") {
  if (!clean(missionId)) return null;
  return dbSelectOne(TABLES.missions, { id: clean(missionId) });
}

async function getDispatchById(dispatchId = "") {
  if (!clean(dispatchId)) return null;
  return dbSelectOne(TABLES.dispatches, { id: clean(dispatchId) });
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
    next();
  } catch (error) {
    return serverError(res, error, "Unable to load driver.");
  }
}

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

async function createDispatchOfferForDriver({
  ride,
  rider,
  driver,
  requested_mode = "driver"
}) {
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
    requested_mode: requested_mode || "driver",
    pickup_address: ride.pickup_address,
    dropoff_address: ride.dropoff_address,
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

  return { dispatch, mission, preview: buildDriverMissionPreview({ ride, rider, mission }) };
}

async function selectCandidateDriver(requestedMode = "driver") {
  const desiredType = lower(requestedMode || "driver") === "autonomous" ? "autonomous" : "human";

  const allDrivers = await dbSelectMany(
    TABLES.drivers,
    {},
    {
      orderBy: { column: "created_at", ascending: true },
      limit: 100
    }
  );

  const approvedDrivers = allDrivers.filter((driver) => {
    const type = lower(driver.driver_type || "human");
    const isAvailable = !["offline", "suspended", "rejected"].includes(lower(driver.status || ""));
    return isDriverApproved(driver) && isAvailable && type === desiredType;
  });

  return approvedDrivers[0] || null;
}

/* =========================================================
   RIDE CREATION
========================================================= */
app.post(
  "/api/rides/request",
  requireExistingRiderRecord,
  async (req, res, next) => requireRiderVerificationGate(req, res, next),
  async (req, res, next) => requirePaymentAuthorizationGate(req, res, next),
  async (req, res) => {
    try {
      if (!supabase) {
        return fail(res, "Supabase is not configured.", 500);
      }

      const rider = req.rider;
      const authorizedPayment = req.authorizedPayment || null;

      const pickup_address = clean(
        req.body?.pickup_address ||
        req.body?.pickupAddress
      );
      const dropoff_address = clean(
        req.body?.dropoff_address ||
        req.body?.dropoffAddress
      );
      const requested_mode = lower(
        req.body?.requested_mode ||
        req.body?.requestedMode ||
        "driver"
      );
      const notes = clean(req.body?.notes || "");
      const miles = parseFloatSafe(req.body?.miles, 0);
      const minutes = parseFloatSafe(req.body?.minutes, 0);
      const surgeMultiplier = parseFloatSafe(
        req.body?.surgeMultiplier || req.body?.surge_multiplier,
        1
      );

      if (!pickup_address) {
        return fail(res, "Pickup address is required.", 400);
      }

      if (!dropoff_address) {
        return fail(res, "Dropoff address is required.", 400);
      }

      const estimate = buildFareEstimate({
        miles,
        minutes,
        surgeMultiplier: surgeMultiplier < 1 ? 1 : surgeMultiplier
      });

      const ride = await dbInsert(TABLES.rides, {
        id: createId("ride"),
        rider_id: rider.id,
        driver_id: null,
        payment_id: authorizedPayment?.id || null,
        pickup_address,
        dropoff_address,
        requested_mode: requested_mode === "autonomous" ? "autonomous" : "driver",
        status: "searching",
        fare_estimate: estimate.estimated_total,
        estimated_total: estimate.estimated_total,
        miles,
        minutes,
        notes,
        dispatch_attempts: 0,
        created_at: nowIso(),
        updated_at: nowIso()
      });

      await writeTripEvent({
        ride_id: ride.id,
        rider_id: rider.id,
        event_type: "ride_requested",
        event_payload: {
          pickup_address,
          dropoff_address,
          requested_mode: ride.requested_mode,
          payment_id: authorizedPayment?.id || null,
          fare_estimate: estimate.estimated_total
        }
      });

      let selectedDriver = null;
      let dispatch = null;
      let mission = null;
      let preview = null;

      try {
        selectedDriver = await selectCandidateDriver(ride.requested_mode);

        if (selectedDriver) {
          const offer = await createDispatchOfferForDriver({
            ride,
            rider,
            driver: selectedDriver,
            requested_mode: ride.requested_mode
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
    } catch (error) {
      return serverError(res, error, "Ride request failed.");
    }
  }
);

/* =========================================================
   RIDE LOOKUP
========================================================= */
app.get("/api/rides/:rideId", async (req, res) => {
  try {
    const ride = await getRideById(req.params.rideId);

    if (!ride) {
      return fail(res, "Ride not found.", 404);
    }

    const latestDispatch = await getLatestDispatchForRide(ride.id);

    return ok(res, {
      ride: buildRidePublicRecord(ride),
      latest_dispatch: buildDispatchPublicRecord(latestDispatch)
    }, "Ride loaded.");
  } catch (error) {
    return serverError(res, error, "Unable to load ride.");
  }
});

app.get("/api/riders/:riderId/rides", async (req, res) => {
  try {
    const riderId = clean(req.params.riderId);
    const rides = await dbSelectMany(
      TABLES.rides,
      { rider_id: riderId },
      {
        orderBy: { column: "created_at", ascending: false },
        limit: 50
      }
    );

    return ok(res, {
      rides: rides.map(buildRidePublicRecord)
    }, "Rider rides loaded.");
  } catch (error) {
    return serverError(res, error, "Unable to load rider rides.");
  }
});

/* =========================================================
   DRIVER MISSION INBOX
========================================================= */
app.get(
  "/api/drivers/:driverId/missions",
  async (req, res, next) => {
    req.query.driver_id = req.params.driverId;
    return requireExistingDriverRecord(req, res, next);
  },
  async (req, res) => {
    try {
      const driver = req.driver;

      const missions = await getOpenMissionsForDriver(driver.id);
      const dispatches = await getOpenDispatchesForDriver(driver.id);

      const openMissionStatuses = ["offered", "accepted"];
      const filteredMissions = missions.filter((mission) =>
        openMissionStatuses.includes(normalizeMissionStatus(mission.status))
      );

      return ok(res, {
        driver_id: driver.id,
        missions: filteredMissions.map(buildMissionPublicRecord),
        dispatches: dispatches
          .filter((dispatch) =>
            ["offered", "accepted"].includes(normalizeDispatchStatus(dispatch.status))
          )
          .map(buildDispatchPublicRecord)
      }, "Driver missions loaded.");
    } catch (error) {
      return serverError(res, error, "Unable to load driver missions.");
    }
  }
);

app.get(
  "/api/drivers/:driverId/current-ride",
  async (req, res, next) => {
    req.query.driver_id = req.params.driverId;
    return requireExistingDriverRecord(req, res, next);
  },
  async (req, res) => {
    try {
      const driver = req.driver;

      const rides = await dbSelectMany(
        TABLES.rides,
        { driver_id: driver.id },
        {
          orderBy: { column: "created_at", ascending: false },
          limit: 20
        }
      );

      const currentRide =
        rides.find((ride) =>
          ["dispatched", "driver_en_route", "arrived", "in_progress"].includes(
            normalizeRideStatus(ride.status)
          )
        ) || null;

      return ok(res, {
        ride: buildRidePublicRecord(currentRide)
      }, currentRide ? "Current driver ride loaded." : "No active ride for this driver.");
    } catch (error) {
      return serverError(res, error, "Unable to load driver current ride.");
    }
  }
);

/* =========================================================
   DRIVER ACCEPT MISSION
========================================================= */
app.post(
  "/api/missions/:missionId/accept",
  requireExistingDriverRecord,
  async (req, res) => {
    try {
      const driver = req.driver;
      const missionId = clean(req.params.missionId);

      const mission = await getMissionById(missionId);
      if (!mission) {
        return fail(res, "Mission not found.", 404);
      }

      if (clean(mission.driver_id) !== clean(driver.id)) {
        return fail(res, "This mission does not belong to this driver.", 403);
      }

      const dispatch = await getDispatchById(
        clean(req.body?.dispatch_id || req.body?.dispatchId || mission.dispatch_id || "")
      ) || await dbSelectOne(TABLES.dispatches, { mission_id: mission.id });

      const ride = await getRideById(mission.ride_id);
      if (!ride) {
        return fail(res, "Ride not found for this mission.", 404);
      }

      if (normalizeMissionStatus(mission.status) !== "offered") {
        return fail(res, "Mission is no longer available to accept.", 409, {
          mission_status: normalizeMissionStatus(mission.status)
        });
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

      return ok(res, {
        mission: buildMissionPublicRecord(updatedMission),
        ride: buildRidePublicRecord(updatedRide),
        dispatch: buildDispatchPublicRecord(updatedDispatch)
      }, "Mission accepted successfully.");
    } catch (error) {
      return serverError(res, error, "Unable to accept mission.");
    }
  }
);

/* =========================================================
   DRIVER DECLINE MISSION
========================================================= */
app.post(
  "/api/missions/:missionId/decline",
  requireExistingDriverRecord,
  async (req, res) => {
    try {
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
        await getDispatchById(clean(req.body?.dispatch_id || req.body?.dispatchId || "")) ||
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

      return ok(res, {
        mission: buildMissionPublicRecord(updatedMission),
        ride: buildRidePublicRecord(updatedRide),
        dispatch: buildDispatchPublicRecord(updatedDispatch)
      }, "Mission declined successfully.");
    } catch (error) {
      return serverError(res, error, "Unable to decline mission.");
    }
  }
);

/* =========================================================
   DRIVER MANUAL OFFER ENDPOINT
========================================================= */
app.post("/api/admin/rides/:rideId/offer-driver", requireAdmin, async (req, res) => {
  try {
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

    if (!isDriverApproved(driver)) {
      return fail(res, "Driver is not approved.", 409);
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

    return ok(res, {
      ride: buildRidePublicRecord(await getRideById(ride.id)),
      dispatch: buildDispatchPublicRecord(offer.dispatch),
      mission: buildMissionPublicRecord(offer.mission),
      driver_mission_preview: offer.preview
    }, "Manual driver offer created.");
  } catch (error) {
    return serverError(res, error, "Unable to create manual driver offer.");
  }
});/* =========================================================
   PART 4: DISPATCH SWEEPER + AUTO REDISPATCH + RIDE LIFECYCLE
========================================================= */

/* =========================================================
   LIFECYCLE HELPERS
========================================================= */
function canDriverBeRedispatched(driver) {
  if (!driver) return false;
  if (!isDriverApproved(driver)) return false;

  const status = lower(driver.status || "");
  if (["offline", "suspended", "rejected", "busy", "on_trip"].includes(status)) {
    return false;
  }

  return true;
}

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
      limit: 200
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

async function markDriverAvailability(driverId = "", nextStatus = "available") {
  if (!clean(driverId)) return null;

  const allowed = ["available", "busy", "on_trip", "offline"];
  const status = allowed.includes(lower(nextStatus)) ? lower(nextStatus) : "available";

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

async function getCandidateDriverExcluding({
  requestedMode = "driver",
  excludedDriverIds = []
}) {
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

  const excluded = new Set(
    (excludedDriverIds || []).map((value) => clean(value)).filter(Boolean)
  );

  const candidate = allDrivers.find((driver) => {
    const type = lower(driver.driver_type || "human");
    return (
      type === desiredType &&
      !excluded.has(clean(driver.id)) &&
      canDriverBeRedispatched(driver)
    );
  });

  return candidate || null;
}

async function attemptRedispatchForRide(rideId = "", reason = "redispatch_requested") {
  const ride = await getRideById(rideId);
  if (!ride) {
    return {
      ok: false,
      reason: "ride_not_found"
    };
  }

  const normalizedRideStatus = normalizeRideStatus(ride.status);
  if (["completed", "cancelled", "in_progress"].includes(normalizedRideStatus)) {
    return {
      ok: false,
      reason: `ride_not_eligible_${normalizedRideStatus}`
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
  const excludedDriverIds = pastDispatches.map((dispatch) => clean(dispatch.driver_id));

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

async function expireDispatchAndMission({
  dispatch,
  mission,
  ride,
  reason = "dispatch_expired"
}) {
  if (dispatch && ["offered"].includes(normalizeDispatchStatus(dispatch.status))) {
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

  if (mission && ["offered"].includes(normalizeMissionStatus(mission.status))) {
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
        limit: 200
      }
    );

    const offeredDispatches = openDispatches.filter((dispatch) => {
      const status = normalizeDispatchStatus(dispatch.status);
      if (status !== "offered") return false;
      if (!dispatch.expires_at) return false;
      return new Date(dispatch.expires_at).getTime() <= Date.now();
    });

    for (const dispatch of offeredDispatches) {
      try {
        const ride = await getRideById(dispatch.ride_id);
        const mission =
          dispatch.mission_id
            ? await getMissionById(dispatch.mission_id)
            : await dbSelectOne(TABLES.missions, { id: dispatch.mission_id || "" });

        if (!ride) continue;

        const rideStatus = normalizeRideStatus(ride.status);
        if (["completed", "cancelled", "in_progress", "driver_en_route", "arrived"].includes(rideStatus)) {
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
   RIDE STATUS UPDATE HELPERS
========================================================= */
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

  await dbUpdate(TABLES.rides, { id: ride.id }, updates, { select: false });

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

function requireAssignedDriverMatch(ride, driverId = "") {
  return clean(ride?.driver_id) && clean(ride.driver_id) === clean(driverId);
}

/* =========================================================
   RIDE TIMELINE
========================================================= */
app.get("/api/rides/:rideId/timeline", async (req, res) => {
  try {
    const rideId = clean(req.params.rideId);
    const ride = await getRideById(rideId);

    if (!ride) {
      return fail(res, "Ride not found.", 404);
    }

    const events = await getTripEventsForRide(ride.id);

    return ok(res, {
      ride: buildRidePublicRecord(ride),
      timeline: events.map(buildTimelineEvent)
    }, "Ride timeline loaded.");
  } catch (error) {
    return serverError(res, error, "Unable to load ride timeline.");
  }
});

/* =========================================================
   FULL RIDE DETAIL
========================================================= */
app.get("/api/rides/:rideId/detail", async (req, res) => {
  try {
    const rideId = clean(req.params.rideId);
    const ride = await getRideById(rideId);

    if (!ride) {
      return fail(res, "Ride not found.", 404);
    }

    const dispatches = await getDispatchesForRide(ride.id);
    const missions = await getMissionsForRide(ride.id);
    const events = await getTripEventsForRide(ride.id);

    return ok(res, {
      ride: buildRidePublicRecord(ride),
      dispatches: dispatches.map(buildDispatchPublicRecord),
      missions: missions.map(buildMissionPublicRecord),
      timeline: events.map(buildTimelineEvent)
    }, "Ride detail loaded.");
  } catch (error) {
    return serverError(res, error, "Unable to load ride detail.");
  }
});

/* =========================================================
   DRIVER EN ROUTE
========================================================= */
app.post(
  "/api/rides/:rideId/driver-en-route",
  requireExistingDriverRecord,
  async (req, res) => {
    try {
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
        return fail(res, "Ride is not in a valid state for en route update.", 409, {
          ride_status: currentStatus
        });
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

      return ok(res, {
        ride: buildRidePublicRecord(updatedRide)
      }, "Driver marked as en route.");
    } catch (error) {
      return serverError(res, error, "Unable to mark driver en route.");
    }
  }
);

/* =========================================================
   DRIVER ARRIVED
========================================================= */
app.post(
  "/api/rides/:rideId/arrived",
  requireExistingDriverRecord,
  async (req, res) => {
    try {
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
        return fail(res, "Ride is not in a valid state for arrival.", 409, {
          ride_status: currentStatus
        });
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

      return ok(res, {
        ride: buildRidePublicRecord(updatedRide)
      }, "Driver marked as arrived.");
    } catch (error) {
      return serverError(res, error, "Unable to mark driver arrived.");
    }
  }
);

/* =========================================================
   START RIDE
========================================================= */
app.post(
  "/api/rides/:rideId/start",
  requireExistingDriverRecord,
  async (req, res) => {
    try {
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
        return fail(res, "Ride is not in a valid state to start.", 409, {
          ride_status: currentStatus
        });
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

      return ok(res, {
        ride: buildRidePublicRecord(updatedRide)
      }, "Ride started successfully.");
    } catch (error) {
      return serverError(res, error, "Unable to start ride.");
    }
  }
);

/* =========================================================
   COMPLETE RIDE
========================================================= */
app.post(
  "/api/rides/:rideId/complete",
  requireExistingDriverRecord,
  async (req, res) => {
    try {
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
        return fail(res, "Ride is not in a valid state to complete.", 409, {
          ride_status: currentStatus
        });
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

      return ok(res, {
        ride: buildRidePublicRecord(updatedRide)
      }, "Ride completed successfully.");
    } catch (error) {
      return serverError(res, error, "Unable to complete ride.");
    }
  }
);

/* =========================================================
   RIDER CANCEL RIDE
========================================================= */
app.post(
  "/api/rides/:rideId/cancel-by-rider",
  requireExistingRiderRecord,
  async (req, res) => {
    try {
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
        return fail(res, "Ride can no longer be cancelled.", 409, {
          ride_status: currentStatus
        });
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

      return ok(res, {
        ride: buildRidePublicRecord(updatedRide)
      }, "Ride cancelled by rider.");
    } catch (error) {
      return serverError(res, error, "Unable to cancel ride.");
    }
  }
);

/* =========================================================
   DRIVER CANCEL RIDE
========================================================= */
app.post(
  "/api/rides/:rideId/cancel-by-driver",
  requireExistingDriverRecord,
  async (req, res) => {
    try {
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
        return fail(res, "Ride can no longer be cancelled.", 409, {
          ride_status: currentStatus
        });
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

      return ok(res, {
        ride: buildRidePublicRecord(updatedRide)
      }, "Ride released by driver.");
    } catch (error) {
      return serverError(res, error, "Unable to cancel ride by driver.");
    }
  }
);

/* =========================================================
   ADMIN MANUAL REDISPATCH
========================================================= */
app.post("/api/admin/rides/:rideId/redispatch", requireAdmin, async (req, res) => {
  try {
    const rideId = clean(req.params.rideId);

    const result = await attemptRedispatchForRide(rideId, "admin_manual_redispatch");

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

    return ok(res, {
      result
    }, "Redispatch created successfully.");
  } catch (error) {
    return serverError(res, error, "Unable to redispatch ride.");
  }
});

/* =========================================================
   ADMIN SWEEP NOW
========================================================= */
app.post("/api/admin/dispatch/sweep", requireAdmin, async (req, res) => {
  try {
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
  } catch (error) {
    return serverError(res, error, "Unable to run dispatch sweep.");
  }
});

/* =========================================================
   BACKGROUND DISPATCH SWEEPER
========================================================= */
if (ENABLE_AUTO_REDISPATCH) {
  setInterval(() => {
    runDispatchSweep().catch((error) => {
      console.warn("Background dispatch sweep error:", error.message);
    });
  }, DISPATCH_SWEEP_INTERVAL_MS);
}/* =========================================================
   PART 5: DRIVERS + VERIFICATION + APPROVAL + EARNINGS
========================================================= */

/* =========================================================
   DRIVER HELPERS
========================================================= */
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
  if (["failed", "rejected", "declined"].includes(status)) return "failed";

  return status || "pending";
}

function normalizeDriverType(value = "") {
  const type = lower(value);
  if (["autonomous", "av"].includes(type)) return "autonomous";
  return "human";
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
    payout_status: lower(row.payout_status || "pending"),
    created_at: row.created_at || null,
    updated_at: row.updated_at || null
  };
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

function driverCanReceiveMissions(driver) {
  if (!driver) return false;

  const approvalPassed = normalizeDriverApprovalStatus(
    driver.approval_status || driver.status
  ) === "approved";

  const emailPassed =
    normalizeDriverVerificationStatus(driver.email_verification_status) === "approved";

  const smsPassed =
    normalizeDriverVerificationStatus(driver.sms_verification_status) === "approved";

  return approvalPassed && emailPassed && smsPassed;
}

function computeDriverPayoutBreakdown(totalFare = 0, tipAmount = 0) {
  const grossFare = asCurrency(totalFare || 0);
  const safeTip = asCurrency(tipAmount || 0);

  const payoutPercent = clampNumber(
    toNumber(process.env.DEFAULT_DRIVER_PAYOUT_PERCENT, 75),
    1,
    100,
    75
  );

  const driverBasePayout = asCurrency((grossFare * payoutPercent) / 100);
  const driverPayout = asCurrency(driverBasePayout + safeTip);
  const platformFee = asCurrency(grossFare - driverBasePayout);

  return {
    gross_fare: grossFare,
    driver_payout: driverPayout,
    platform_fee: platformFee,
    tip_amount: safeTip,
    payout_percent: payoutPercent
  };
}

/* =========================================================
   DRIVER SIGNUP
========================================================= */
app.post("/api/driver/signup", async (req, res) => {
  try {
    if (!supabase) {
      return fail(res, "Supabase is not configured.", 500);
    }

    const first_name = pickFirst(req.body?.first_name, req.body?.firstName);
    const last_name = pickFirst(req.body?.last_name, req.body?.lastName);
    const email = normalizeEmail(req.body?.email);
    const phone = normalizePhone(req.body?.phone);
    const city = pickFirst(req.body?.city);
    const state = upper(pickFirst(req.body?.state, req.body?.stateValue, "TN"));
    const password = clean(req.body?.password);
    const driver_type = normalizeDriverType(
      pickFirst(req.body?.driver_type, req.body?.driverType, "human")
    );

    const vehicle_make = pickFirst(req.body?.vehicle_make, req.body?.vehicleMake);
    const vehicle_model = pickFirst(req.body?.vehicle_model, req.body?.vehicleModel);
    const vehicle_color = pickFirst(req.body?.vehicle_color, req.body?.vehicleColor);
    const vehicle_plate = upper(pickFirst(req.body?.vehicle_plate, req.body?.vehiclePlate));
    const license_number = clean(
      req.body?.license_number || req.body?.licenseNumber || ""
    );

    const persona_inquiry_id = clean(
      req.body?.persona_inquiry_id || req.body?.personaInquiryId || ""
    );
    const background_check_id = clean(
      req.body?.background_check_id || req.body?.backgroundCheckId || ""
    );

    if (!first_name) return fail(res, "First name is required.", 400);
    if (!last_name) return fail(res, "Last name is required.", 400);
    if (!email) return fail(res, "Email is required.", 400);
    if (!phone) return fail(res, "Phone is required.", 400);
    if (!city) return fail(res, "City is required.", 400);
    if (!state) return fail(res, "State is required.", 400);
    if (!password || password.length < 6) {
      return fail(res, "Password must be at least 6 characters.", 400);
    }

    const existingByEmail = await getDriverByEmail(email);
    if (existingByEmail) {
      return fail(res, "A driver with this email already exists.", 409, {
        driver_id: existingByEmail.id
      });
    }

    const existingByPhone = await getDriverByPhone(phone);
    if (existingByPhone) {
      return fail(res, "A driver with this phone already exists.", 409, {
        driver_id: existingByPhone.id
      });
    }

    const driver = await dbInsert(TABLES.drivers, {
      id: createId("driver"),
      first_name,
      last_name,
      email,
      phone,
      city,
      state,
      password,
      driver_type,
      approval_status: "pending",
      verification_status: "pending",
      persona_status: "pending",
      identity_status: "pending",
      email_verification_status: "pending",
      sms_verification_status: "pending",
      background_check_status: "pending",
      persona_inquiry_id: persona_inquiry_id || null,
      background_check_id: background_check_id || null,
      vehicle_make: vehicle_make || null,
      vehicle_model: vehicle_model || null,
      vehicle_color: vehicle_color || null,
      vehicle_plate: vehicle_plate || null,
      license_number: license_number || null,
      status: "pending",
      created_at: nowIso(),
      updated_at: nowIso()
    });

    await writeAdminLog({
      action: "driver_signup_created",
      actor_email: normalizeEmail(driver.email),
      target_type: "driver",
      target_id: driver.id,
      details: {
        driver_type,
        city,
        state
      }
    });

    await writeTripEvent({
      driver_id: driver.id,
      event_type: "driver_signup_created",
      event_payload: {
        email,
        phone,
        driver_type,
        city,
        state
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
  } catch (error) {
    return serverError(res, error, "Driver signup failed.");
  }
});

/* =========================================================
   DRIVER STATUS / PROFILE
========================================================= */
app.get("/api/driver/status", async (req, res) => {
  try {
    const driverId = clean(req.query?.driver_id || req.query?.driverId || "");
    const email = normalizeEmail(req.query?.email || "");

    if (!driverId && !email) {
      return fail(res, "Driver ID or email is required.", 400);
    }

    const driver = driverId
      ? await getDriverById(driverId)
      : await getDriverByEmail(email);

    if (!driver) {
      return fail(res, "Driver not found.", 404);
    }

    return ok(res, {
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
    }, "Driver status loaded.");
  } catch (error) {
    return serverError(res, error, "Unable to load driver status.");
  }
});

app.get("/api/drivers/:driverId", async (req, res) => {
  try {
    const driver = await getDriverById(req.params.driverId);

    if (!driver) {
      return fail(res, "Driver not found.", 404);
    }

    return ok(res, {
      driver: buildDriverPublicProfile(driver)
    }, "Driver profile loaded.");
  } catch (error) {
    return serverError(res, error, "Unable to load driver.");
  }
});

/* =========================================================
   DRIVER EMAIL / SMS VERIFICATION
========================================================= */
app.post("/api/drivers/:driverId/verify-email", async (req, res) => {
  try {
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

    return ok(res, {
      driver: buildDriverPublicProfile(updated)
    }, "Driver email verified.");
  } catch (error) {
    return serverError(res, error, "Unable to verify driver email.");
  }
});

app.post("/api/drivers/:driverId/verify-sms", async (req, res) => {
  try {
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

    return ok(res, {
      driver: buildDriverPublicProfile(updated)
    }, "Driver SMS verified.");
  } catch (error) {
    return serverError(res, error, "Unable to verify driver SMS.");
  }
});

/* =========================================================
   DRIVER BACKGROUND / ID APPROVAL FOUNDATION
========================================================= */
app.post("/api/admin/drivers/:driverId/approve", requireAdmin, async (req, res) => {
  try {
    const driverId = clean(req.params.driverId);
    const driver = await getDriverById(driverId);

    if (!driver) {
      return fail(res, "Driver not found.", 404);
    }

    const rows = await dbUpdate(
      TABLES.drivers,
      { id: driverId },
      {
        approval_status: "approved",
        verification_status: "approved",
        persona_status: "approved",
        identity_status: "approved",
        background_check_status:
          normalizeDriverVerificationStatus(driver.background_check_status) === "approved"
            ? "approved"
            : "pending",
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

    return ok(res, {
      driver: buildDriverPublicProfile(updated)
    }, "Driver approved successfully.");
  } catch (error) {
    return serverError(res, error, "Unable to approve driver.");
  }
});

app.post("/api/admin/drivers/:driverId/reject", requireAdmin, async (req, res) => {
  try {
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

    return ok(res, {
      driver: buildDriverPublicProfile(updated)
    }, "Driver rejected successfully.");
  } catch (error) {
    return serverError(res, error, "Unable to reject driver.");
  }
});

app.post("/api/admin/drivers/:driverId/background-approved", requireAdmin, async (req, res) => {
  try {
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

    return ok(res, {
      driver: buildDriverPublicProfile(updated)
    }, "Driver background check approved.");
  } catch (error) {
    return serverError(res, error, "Unable to approve background check.");
  }
});

/* =========================================================
   DRIVER AVAILABILITY
========================================================= */
app.post(
  "/api/drivers/:driverId/set-availability",
  async (req, res, next) => {
    req.body.driver_id = req.params.driverId;
    return requireExistingDriverRecord(req, res, next);
  },
  async (req, res) => {
    try {
      const driver = req.driver;
      const requestedStatus = lower(req.body?.status || req.body?.availability || "available");

      if (!driverCanReceiveMissions(driver)) {
        return fail(
          res,
          "Driver must complete approval, email verification, and SMS verification first.",
          403,
          {
            driver: buildDriverPublicProfile(driver)
          }
        );
      }

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

      return ok(res, {
        driver: buildDriverPublicProfile(updated)
      }, "Driver availability updated.");
    } catch (error) {
      return serverError(res, error, "Unable to update availability.");
    }
  }
);

/* =========================================================
   DRIVER EARNINGS FOUNDATION
========================================================= */
app.post("/api/admin/rides/:rideId/settle-driver-earnings", requireAdmin, async (req, res) => {
  try {
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
      return fail(res, "Driver earnings can only be settled after ride completion.", 409, {
        ride_status: rideStatus
      });
    }

    const existing = await dbSelectOne(TABLES.driver_earnings, { ride_id: ride.id });
    if (existing) {
      return fail(res, "Driver earnings already settled for this ride.", 409, {
        earnings: buildDriverEarningsRecord(existing)
      });
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

    return ok(res, {
      earnings: buildDriverEarningsRecord(earning)
    }, "Driver earnings settled.");
  } catch (error) {
    return serverError(res, error, "Unable to settle driver earnings.");
  }
});

app.get("/api/drivers/:driverId/earnings", async (req, res) => {
  try {
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

    return ok(res, {
      totals: {
        gross_fare: asCurrency(totals.gross_fare),
        driver_payout: asCurrency(totals.driver_payout),
        platform_fee: asCurrency(totals.platform_fee),
        tip_amount: asCurrency(totals.tip_amount)
      },
      earnings: earnings.map(buildDriverEarningsRecord)
    }, "Driver earnings loaded.");
  } catch (error) {
    return serverError(res, error, "Unable to load driver earnings.");
  }
});

app.get("/api/drivers/:driverId/payouts", async (req, res) => {
  try {
    const driverId = clean(req.params.driverId);
    const payouts = await getDriverPayouts(driverId);

    return ok(res, {
      payouts
    }, "Driver payouts loaded.");
  } catch (error) {
    return serverError(res, error, "Unable to load driver payouts.");
  }
});

/* =========================================================
   ADMIN DRIVER REVIEW LIST
========================================================= */
app.get("/api/admin/drivers", requireAdmin, async (req, res) => {
  try {
    const drivers = await dbSelectMany(
      TABLES.drivers,
      {},
      {
        orderBy: { column: "created_at", ascending: false },
        limit: 200
      }
    );

    return ok(res, {
      drivers: drivers.map(buildDriverPublicProfile)
    }, "Admin driver list loaded.");
  } catch (error) {
    return serverError(res, error, "Unable to load admin driver list.");
  }
});

app.get("/api/admin/riders", requireAdmin, async (req, res) => {
  try {
    const riders = await dbSelectMany(
      TABLES.riders,
      {},
      {
        orderBy: { column: "created_at", ascending: false },
        limit: 200
      }
    );

    return ok(res, {
      riders: riders.map(buildRiderPublicProfile)
    }, "Admin rider list loaded.");
  } catch (error) {
    return serverError(res, error, "Unable to load admin rider list.");
  }
});async function selectCandidateDriver(requestedMode = "driver") {
  const desiredType =
    lower(requestedMode || "driver") === "autonomous" ? "autonomous" : "human";

  const allDrivers = await dbSelectMany(
    TABLES.drivers,
    {},
    {
      orderBy: { column: "created_at", ascending: true },
      limit: 100
    }
  );

  const approvedDrivers = allDrivers.filter((driver) => {
    const type = lower(driver.driver_type || "human");
    const availability = normalizeDriverStatus(driver.status);
    return (
      type === desiredType &&
      availability === "available" &&
      driverCanReceiveMissions(driver)
    );
  });

  return approvedDrivers[0] || null;
}/* =========================================================
   PART 7: AI SUPPORT + PAGE-AWARE ASSISTANT ROUTING
========================================================= */

/* =========================================================
   AI HELPERS
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

function buildSupportContextBlock({
  page = "general",
  intent = "general",
  rider = null,
  driver = null,
  ride = null
}) {
  const lines = [
    `App: ${APP_NAME}`,
    `Public URL: ${PUBLIC_APP_URL}`,
    `Support page mode: ${page}`,
    `Support intent: ${intent}`,
    `Rider verification gate enabled: ${ENABLE_RIDER_VERIFICATION_GATE}`,
    `Payment gate enabled: ${ENABLE_PAYMENT_GATE}`,
    `Auto redispatch enabled: ${ENABLE_AUTO_REDISPATCH}`,
    `Real email enabled: ${ENABLE_REAL_EMAIL}`,
    `Real SMS enabled: ${ENABLE_REAL_SMS}`
  ];

  if (rider) {
    lines.push(
      `Rider ID: ${clean(rider.id)}`,
      `Rider approval status: ${normalizeRiderStatus(rider.approval_status || rider.status)}`,
      `Rider verification status: ${normalizeVerificationStatus(
        rider.verification_status || rider.identity_status || rider.persona_status
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
- Be helpful, calm, and operationally accurate.
- Never invent company policies that are not grounded in the provided context.
- Do not claim an action was completed unless the system explicitly confirms it.
- If the user asks for emergency help, tell them Harvey Taxi is not an emergency service and they should call 911.
- If the user asks legal, medical, or tax questions, give general guidance only and tell them to consult a qualified professional.
- If asked about rider access, explain that rider verification approval may be required before ride requests.
- If asked about ride requests, explain that payment authorization may be required before dispatch.
- If asked about drivers, explain that drivers may need email verification, SMS verification, document review, background check review, and approval before they can receive missions.
- If asked about autonomous rides, explain that autonomous mode is a pilot/future-oriented option and actual availability depends on platform operations.
- If the question goes beyond known facts, say that support should verify through the Harvey Taxi admin team at support@harveytaxiservice.com.
- Keep answers practical and avoid hype.

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

  if (message.includes("emergency") || message.includes("911") || message.includes("danger")) {
    return {
      answer:
        "Harvey Taxi is not an emergency service. If this is an emergency or safety issue, call 911 right away.",
      mode: "emergency_fallback"
    };
  }

  if (page === "rider" || intent === "rider") {
    return {
      answer: rider
        ? `Your rider profile shows approval status "${normalizeRiderStatus(
            rider.approval_status || rider.status
          )}" and verification status "${normalizeVerificationStatus(
            rider.verification_status || rider.identity_status || rider.persona_status
          )}". Riders may need approval before requesting a ride, and payment authorization may also be required before dispatch.`
        : "Riders may need verification approval before requesting a ride, and payment authorization may also be required before dispatch.",
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
          )}", and SMS verification "${normalizeDriverVerificationStatus(
            driver.sms_verification_status
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
        "Admin workflows can include approving riders, approving drivers, reviewing dispatches, checking ride timelines, and monitoring payments, earnings, and payouts.",
      mode: "admin_fallback"
    };
  }

  return {
    answer:
      "Harvey Taxi support can help with rider approval, driver onboarding, ride requests, dispatch flow, payment authorization, and trip status questions. For account-specific help, support can verify the record through the admin team at support@harveytaxiservice.com.",
    mode: "general_fallback"
  };
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

/* =========================================================
   AI SUPPORT ENDPOINT
========================================================= */
app.post("/api/ai/support", async (req, res) => {
  try {
    const message = clean(req.body?.message || req.body?.prompt || "");
    const page = normalizeSupportPage(req.body?.page || req.body?.page_mode || "general");
    const intent = normalizeSupportIntent(req.body?.intent || page || "general");
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
      return ok(res, {
        answer: aiReply.answer,
        ai_used: true,
        model: aiReply.model,
        support_mode: page,
        support_intent: intent,
        rider: rider ? buildRiderPublicProfile(rider) : null,
        driver: driver ? buildDriverPublicProfile(driver) : null,
        ride: ride ? buildRidePublicRecord(ride) : null
      }, "AI support reply generated.");
    }

    const fallback = getSupportFallbackByMode({
      page,
      intent,
      rider,
      driver,
      ride,
      userMessage: message
    });

    return ok(res, {
      answer: fallback.answer,
      ai_used: false,
      fallback_mode: fallback.mode,
      support_mode: page,
      support_intent: intent,
      rider: rider ? buildRiderPublicProfile(rider) : null,
      driver: driver ? buildDriverPublicProfile(driver) : null,
      ride: ride ? buildRidePublicRecord(ride) : null
    }, "Fallback support reply generated.");
  } catch (error) {
    return serverError(res, error, "Unable to generate support response.");
  }
});

/* =========================================================
   PAGE-AWARE QUICK SUPPORT
========================================================= */
app.post("/api/ai/support/rider", async (req, res) => {
  req.body.page = "rider";
  req.body.intent = "rider";
  return app._router.handle(req, res, () => {}, "post", "/api/ai/support");
});

app.post("/api/ai/support/driver", async (req, res) => {
  req.body.page = "driver";
  req.body.intent = "driver";
  return app._router.handle(req, res, () => {}, "post", "/api/ai/support");
});

app.post("/api/ai/support/request", async (req, res) => {
  req.body.page = "request";
  req.body.intent = "request";
  return app._router.handle(req, res, () => {}, "post", "/api/ai/support");
});

app.post("/api/ai/support/admin", async (req, res) => {
  req.body.page = "admin";
  req.body.intent = "admin";
  return app._router.handle(req, res, () => {}, "post", "/api/ai/support");
});

/* =========================================================
   SUPPORT FAQ FALLBACK ENDPOINT
========================================================= */
app.get("/api/support/faq", async (req, res) => {
  try {
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
          "Autonomous mode is a pilot/future-oriented service path. Actual availability depends on current platform operations."
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

    return ok(res, { faqs }, "Support FAQ loaded.");
  } catch (error) {
    return serverError(res, error, "Unable to load support FAQ.");
  }
});async function handleSupportByMode(req, res, forcedPage, forcedIntent) {
  try {
    req.body = req.body || {};
    req.body.page = forcedPage;
    req.body.intent = forcedIntent;

    const message = clean(req.body?.message || req.body?.prompt || "");
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
      page: forcedPage,
      intent: forcedIntent,
      rider,
      driver,
      ride,
      history
    });

    if (aiReply.ok) {
      return ok(res, {
        answer: aiReply.answer,
        ai_used: true,
        model: aiReply.model,
        support_mode: forcedPage,
        support_intent: forcedIntent,
        rider: rider ? buildRiderPublicProfile(rider) : null,
        driver: driver ? buildDriverPublicProfile(driver) : null,
        ride: ride ? buildRidePublicRecord(ride) : null
      }, "AI support reply generated.");
    }

    const fallback = getSupportFallbackByMode({
      page: forcedPage,
      intent: forcedIntent,
      rider,
      driver,
      ride,
      userMessage: message
    });

    return ok(res, {
      answer: fallback.answer,
      ai_used: false,
      fallback_mode: fallback.mode,
      support_mode: forcedPage,
      support_intent: forcedIntent,
      rider: rider ? buildRiderPublicProfile(rider) : null,
      driver: driver ? buildDriverPublicProfile(driver) : null,
      ride: ride ? buildRidePublicRecord(ride) : null
    }, "Fallback support reply generated.");
  } catch (error) {
    return serverError(res, error, "Unable to generate support response.");
  }
}

app.post("/api/ai/support/rider", async (req, res) => {
  return handleSupportByMode(req, res, "rider", "rider");
});

app.post("/api/ai/support/driver", async (req, res) => {
  return handleSupportByMode(req, res, "driver", "driver");
});

app.post("/api/ai/support/request", async (req, res) => {
  return handleSupportByMode(req, res, "request", "request");
});

app.post("/api/ai/support/admin", async (req, res) => {
  return handleSupportByMode(req, res, "admin", "admin");
});/* =========================================================
   PART 8: STARTUP HARDENING + DIAGNOSTICS + FINAL POLISH
========================================================= */

/* =========================================================
   SAFE ASYNC WRAPPER
========================================================= */
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
   ENV / RUNTIME SNAPSHOT
========================================================= */
function buildRuntimeSnapshot() {
  return {
    app_name: APP_NAME,
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

function maskSecretValue(value = "") {
  const cleaned = cleanEnv(value);
  if (!cleaned) return "";
  if (cleaned.length <= 8) return "***";
  return `${cleaned.slice(0, 4)}***${cleaned.slice(-4)}`;
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
    ADMIN_EMAIL: Boolean(cleanEnv(process.env.ADMIN_EMAIL)),
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
    ADMIN_EMAIL: normalizeEmail(process.env.ADMIN_EMAIL || "")
  };
}

/* =========================================================
   DATABASE SCHEMA GUARDS
========================================================= */
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

/* =========================================================
   REQUEST SANITY UTILITIES
========================================================= */
function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (Array.isArray(forwarded)) {
    return clean(forwarded[0]);
  }
  if (typeof forwarded === "string") {
    return clean(forwarded.split(",")[0]);
  }
  return clean(req.ip || req.socket?.remoteAddress || "");
}

function buildRequestMeta(req) {
  return {
    ip: getClientIp(req),
    method: req.method,
    path: req.originalUrl,
    user_agent: clean(req.headers["user-agent"] || ""),
    request_started_at: req.requestStartedAt
      ? new Date(req.requestStartedAt).toISOString()
      : null
  };
}

function requireJsonContent(req, res, next) {
  if (req.method === "GET" || req.method === "DELETE") return next();

  const contentType = lower(req.headers["content-type"] || "");
  if (!contentType || contentType.includes("application/json") || contentType.includes("application/x-www-form-urlencoded")) {
    return next();
  }

  return fail(
    res,
    "Unsupported content type. Use application/json or form-urlencoded.",
    415
  );
}

app.use(requireJsonContent);

/* =========================================================
   PRODUCTION DIAGNOSTICS
========================================================= */
app.get("/api/diagnostics/runtime", asyncHandler(async (req, res) => {
  return ok(res, {
    runtime: buildRuntimeSnapshot(),
    request: buildRequestMeta(req)
  }, "Runtime diagnostics loaded.");
}));

app.get("/api/admin/diagnostics/env", requireAdmin, asyncHandler(async (req, res) => {
  return ok(res, {
    env_presence: buildEnvPresenceReport(),
    safe_env_preview: buildSafeEnvPreview(),
    runtime: buildRuntimeSnapshot()
  }, "Environment diagnostics loaded.");
}));

app.get("/api/admin/diagnostics/schema", requireAdmin, asyncHandler(async (req, res) => {
  const schema = await buildSchemaGuardReport();

  return ok(res, {
    schema
  }, "Schema diagnostics loaded.");
}));

app.get("/api/admin/diagnostics/finance", requireAdmin, asyncHandler(async (req, res) => {
  const finance = await runFinanceGuardChecks();

  return ok(res, {
    finance
  }, "Finance diagnostics loaded.");
}));

app.get("/api/admin/diagnostics/startup", requireAdmin, asyncHandler(async (req, res) => {
  const startup = await runStartupChecks();

  return ok(res, {
    startup,
    runtime: buildRuntimeSnapshot(),
    env_presence: buildEnvPresenceReport()
  }, "Startup diagnostics loaded.");
}));

/* =========================================================
   ADMIN DISPATCH DIAGNOSTICS
========================================================= */
app.get("/api/admin/dispatch/overview", requireAdmin, asyncHandler(async (req, res) => {
  const rides = await dbSelectMany(TABLES.rides, {}, {
    orderBy: { column: "created_at", ascending: false },
    limit: 300
  });

  const dispatches = await dbSelectMany(TABLES.dispatches, {}, {
    orderBy: { column: "created_at", ascending: false },
    limit: 500
  });

  const missions = await dbSelectMany(TABLES.missions, {}, {
    orderBy: { column: "created_at", ascending: false },
    limit: 500
  });

  const summary = {
    rides_searching: rides.filter((row) => normalizeRideStatus(row.status) === "searching").length,
    rides_waiting_acceptance: rides.filter((row) => normalizeRideStatus(row.status) === "awaiting_driver_acceptance").length,
    rides_dispatched: rides.filter((row) => normalizeRideStatus(row.status) === "dispatched").length,
    dispatches_offered: dispatches.filter((row) => normalizeDispatchStatus(row.status) === "offered").length,
    dispatches_expired: dispatches.filter((row) => normalizeDispatchStatus(row.status) === "expired").length,
    dispatches_accepted: dispatches.filter((row) => normalizeDispatchStatus(row.status) === "accepted").length,
    dispatches_declined: dispatches.filter((row) => normalizeDispatchStatus(row.status) === "declined").length,
    missions_offered: missions.filter((row) => normalizeMissionStatus(row.status) === "offered").length,
    missions_accepted: missions.filter((row) => normalizeMissionStatus(row.status) === "accepted").length,
    missions_expired: missions.filter((row) => normalizeMissionStatus(row.status) === "expired").length
  };

  return ok(res, {
    summary,
    recent_rides: rides.slice(0, 25).map(buildRidePublicRecord),
    recent_dispatches: dispatches.slice(0, 50).map(buildDispatchPublicRecord),
    recent_missions: missions.slice(0, 50).map(buildMissionPublicRecord)
  }, "Dispatch overview loaded.");
}));

/* =========================================================
   FINAL SAFETY ROUTES
========================================================= */
app.get("/api/version", (req, res) => {
  return ok(res, {
    app: APP_NAME,
    version_label: "Code Blue Clean Rebuild Phase 8",
    started_at: SERVER_STARTED_AT
  }, "Version loaded.");
});

app.get("/api/ping", (req, res) => {
  return ok(res, {
    pong: true,
    time: nowIso()
  }, "Ping successful.");
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
});/* =========================================================
   PART 9: PERSONA WEBHOOKS + COMMUNICATIONS + FINAL PRODUCTION LAYER
========================================================= */

/* =========================================================
   COMMUNICATION / WEBHOOK CONFIG
========================================================= */
const PERSONA_WEBHOOK_SECRET = cleanEnv(process.env.PERSONA_WEBHOOK_SECRET);
const PERSONA_TEMPLATE_ID_RIDER = cleanEnv(process.env.PERSONA_TEMPLATE_ID_RIDER);
const PERSONA_TEMPLATE_ID_DRIVER = cleanEnv(process.env.PERSONA_TEMPLATE_ID_DRIVER);

const SUPPORT_FROM_EMAIL =
  cleanEnv(process.env.SUPPORT_FROM_EMAIL) ||
  cleanEnv(process.env.SMTP_FROM) ||
  cleanEnv(process.env.SENDGRID_FROM_EMAIL) ||
  "support@harveytaxiservice.com";

const SUPPORT_REPLY_TO =
  cleanEnv(process.env.SUPPORT_REPLY_TO) ||
  "support@harveytaxiservice.com";

const TWILIO_FROM_NUMBER =
  cleanEnv(process.env.TWILIO_PHONE_NUMBER) ||
  cleanEnv(process.env.TWILIO_FROM_NUMBER);

/* =========================================================
   WEBHOOK HELPERS
========================================================= */
function safeEqual(a = "", b = "") {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));

  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function getWebhookSecretFromRequest(req) {
  return clean(
    req.headers["x-persona-signature"] ||
    req.headers["persona-signature"] ||
    req.headers["x-webhook-secret"] ||
    ""
  );
}

function verifyPersonaWebhook(req) {
  if (!PERSONA_WEBHOOK_SECRET) return true;
  const provided = getWebhookSecretFromRequest(req);
  if (!provided) return false;
  return safeEqual(provided, PERSONA_WEBHOOK_SECRET);
}

function normalizePersonaOutcome(value = "") {
  const status = lower(value);

  if (["approved", "completed", "passed", "verified"].includes(status)) return "approved";
  if (["pending", "initiated", "created", "submitted", "in_review", "review"].includes(status)) return "pending";
  if (["failed", "declined", "rejected", "expired"].includes(status)) return "failed";

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

  const status =
    normalizePersonaOutcome(
      attributes.status ||
      body.status ||
      body.event_name ||
      ""
    );

  const referenceId =
    clean(attributes.reference_id) ||
    clean(body.reference_id) ||
    clean(attributes.name_first ? `${attributes.name_first}_${attributes.name_last || ""}` : "");

  const payload = {
    inquiry_id: inquiryId,
    status,
    reference_id: referenceId,
    raw_event_name: clean(body.event_name || ""),
    raw: body,
    included_count: included.length
  };

  return payload;
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

  if (!ENABLE_REAL_SMS) {
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

  console.log("REAL SMS PLACEHOLDER:", {
    to: normalizedTo,
    from: TWILIO_FROM_NUMBER || "",
    category
  });

  return {
    ok: true,
    mocked: false,
    channel: "sms",
    to: normalizedTo
  };
}

async function notifyRiderVerificationApproved(rider) {
  if (!rider) return null;

  const fullName = `${clean(rider.first_name)} ${clean(rider.last_name)}`.trim() || "Rider";

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
      "Harvey Taxi: your rider verification has been approved. You can continue toward ride access. Payment authorization may still be required before dispatch."
  });

  return {
    email: emailResult,
    sms: smsResult
  };
}

async function notifyRiderVerificationFailed(rider, reason = "") {
  if (!rider) return null;

  const fullName = `${clean(rider.first_name)} ${clean(rider.last_name)}`.trim() || "Rider";

  const emailResult = await sendEmailMessage({
    to: rider.email,
    subject: "Harvey Taxi rider verification update",
    category: "rider_verification_failed",
    text:
      `Hello ${fullName},\n\n` +
      `Your Harvey Taxi rider verification is not yet approved.\n` +
      `${reason ? `Reason: ${reason}\n` : ""}\n` +
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
   OVERRIDE DISPATCH OFFER CREATOR WITH COMMUNICATIONS
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

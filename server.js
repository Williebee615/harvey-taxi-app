/* =========================================================
   HARVEY TAXI — CODE BLUE STRONG FOUNDATION
   PART 1: APP + ENV + SUPABASE + HEALTH CHECKS
   FILE: server.js
========================================================= */

const express = require("express");
const cors = require("cors");
const path = require("path");
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");

/* OPTIONAL OPENAI */
let OpenAI = null;
try {
  OpenAI = require("openai");
} catch (err) {
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
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

/* =========================================================
   BASIC HELPERS
========================================================= */
function clean(value = "") {
  return String(value ?? "").trim();
}

function lower(value = "") {
  return clean(value).toLowerCase();
}

function boolFromEnv(value, fallback = false) {
  const v = lower(value);
  if (!v) return fallback;
  return ["1", "true", "yes", "on", "enabled"].includes(v);
}

function numberFromEnv(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function nowIso() {
  return new Date().toISOString();
}

function makeId(prefix = "id") {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}

function safeErrorMessage(error) {
  return clean(error?.message || "Unknown error");
}

function maskSecret(value = "") {
  const v = clean(value);
  if (!v) return "";
  if (v.length <= 8) return "********";
  return `${v.slice(0, 4)}********${v.slice(-4)}`;
}

/* =========================================================
   ENV CONFIG
========================================================= */
const NODE_ENV = clean(process.env.NODE_ENV || "development");
const PUBLIC_APP_URL =
  clean(process.env.PUBLIC_APP_URL) ||
  clean(process.env.RENDER_EXTERNAL_URL) ||
  `http://localhost:${PORT}`;

const SUPABASE_URL = clean(process.env.SUPABASE_URL);
const SUPABASE_SERVICE_ROLE_KEY = clean(process.env.SUPABASE_SERVICE_ROLE_KEY);

const OPENAI_API_KEY = clean(process.env.OPENAI_API_KEY);
const OPENAI_SUPPORT_MODEL = clean(process.env.OPENAI_SUPPORT_MODEL || "gpt-4.1-mini");

const GOOGLE_MAPS_API_KEY = clean(process.env.GOOGLE_MAPS_API_KEY);

const ENABLE_STARTUP_TABLE_CHECKS = boolFromEnv(
  process.env.ENABLE_STARTUP_TABLE_CHECKS,
  true
);

const ENABLE_AI_BRAIN = boolFromEnv(process.env.ENABLE_AI_BRAIN, true);
const ENABLE_RIDER_VERIFICATION_GATE = boolFromEnv(
  process.env.ENABLE_RIDER_VERIFICATION_GATE,
  true
);
const ENABLE_PAYMENT_GATE = boolFromEnv(process.env.ENABLE_PAYMENT_GATE, true);
const ENABLE_AUTO_REDISPATCH = boolFromEnv(process.env.ENABLE_AUTO_REDISPATCH, true);

/* =========================================================
   REQUIRED TABLES
========================================================= */
const REQUIRED_TABLES = [
  "riders",
  "drivers",
  "rides",
  "payments",
  "missions",
  "dispatches",
  "admin_logs"
];

const OPTIONAL_TABLES = [
  "driver_locations",
  "trip_events",
  "driver_earnings",
  "driver_payouts"
];

/* =========================================================
   SUPABASE CLIENT
========================================================= */
let supabase = null;
let supabaseEnabled = false;

if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
  supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false }
  });
  supabaseEnabled = true;
} else {
  console.warn("⚠️ Supabase environment variables missing.");
}

/* =========================================================
   OPTIONAL OPENAI CLIENT
========================================================= */
let openai = null;
if (ENABLE_AI_BRAIN && OpenAI && OPENAI_API_KEY) {
  try {
    openai = new OpenAI({ apiKey: OPENAI_API_KEY });
  } catch (err) {
    console.warn("⚠️ Failed to initialize OpenAI client:", safeErrorMessage(err));
  }
}

/* =========================================================
   RUNTIME DIAGNOSTICS STATE
========================================================= */
const runtimeState = {
  bootId: makeId("boot"),
  bootStartedAt: SERVER_STARTED_AT,
  bootCompletedAt: null,
  startupChecksFinished: false,
  startupChecksPassed: false,
  lastStartupError: "",
  lastHealthCheckAt: null,
  lastReadinessCheckAt: null,
  lastSupabasePingAt: null,
  lastSupabasePingOk: false,
  lastSupabasePingError: "",
  envSummary: {
    nodeEnv: NODE_ENV,
    publicAppUrl: PUBLIC_APP_URL,
    supabaseConfigured: Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY),
    openaiConfigured: Boolean(OPENAI_API_KEY),
    googleMapsConfigured: Boolean(GOOGLE_MAPS_API_KEY),
    riderGateEnabled: ENABLE_RIDER_VERIFICATION_GATE,
    paymentGateEnabled: ENABLE_PAYMENT_GATE,
    autoRedispatchEnabled: ENABLE_AUTO_REDISPATCH
  },
  tableChecks: {
    required: {},
    optional: {}
  }
};

/* =========================================================
   REQUEST LOGGING
========================================================= */
app.use((req, res, next) => {
  req.requestId = makeId("req");
  req.requestStartedAt = Date.now();
  res.setHeader("x-request-id", req.requestId);

  res.on("finish", () => {
    const ms = Date.now() - req.requestStartedAt;
    const line = [
      `[${nowIso()}]`,
      req.method,
      req.originalUrl,
      res.statusCode,
      `${ms}ms`,
      req.requestId
    ].join(" ");
    console.log(line);
  });

  next();
});

/* =========================================================
   ASYNC WRAPPER
========================================================= */
function asyncHandler(fn) {
  return function wrapped(req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/* =========================================================
   DATABASE PING
========================================================= */
async function pingSupabase() {
  runtimeState.lastSupabasePingAt = nowIso();

  if (!supabaseEnabled || !supabase) {
    runtimeState.lastSupabasePingOk = false;
    runtimeState.lastSupabasePingError = "Supabase not configured";
    return {
      ok: false,
      message: "Supabase not configured"
    };
  }

  try {
    const { error } = await supabase.from("riders").select("id", { count: "exact", head: true });
    if (error) {
      runtimeState.lastSupabasePingOk = false;
      runtimeState.lastSupabasePingError = safeErrorMessage(error);
      return {
        ok: false,
        message: safeErrorMessage(error)
      };
    }

    runtimeState.lastSupabasePingOk = true;
    runtimeState.lastSupabasePingError = "";
    return {
      ok: true,
      message: "Supabase reachable"
    };
  } catch (error) {
    runtimeState.lastSupabasePingOk = false;
    runtimeState.lastSupabasePingError = safeErrorMessage(error);
    return {
      ok: false,
      message: safeErrorMessage(error)
    };
  }
}

/* =========================================================
   TABLE CHECK HELPERS
========================================================= */
async function checkTableExists(tableName) {
  if (!supabaseEnabled || !supabase) {
    return {
      ok: false,
      table: tableName,
      error: "Supabase not configured"
    };
  }

  try {
    const { error } = await supabase
      .from(tableName)
      .select("*", { head: true, count: "exact" });

    if (error) {
      return {
        ok: false,
        table: tableName,
        error: safeErrorMessage(error)
      };
    }

    return {
      ok: true,
      table: tableName
    };
  } catch (error) {
    return {
      ok: false,
      table: tableName,
      error: safeErrorMessage(error)
    };
  }
}

async function runTableChecks() {
  const requiredResults = {};
  const optionalResults = {};

  for (const table of REQUIRED_TABLES) {
    const result = await checkTableExists(table);
    requiredResults[table] = result;
  }

  for (const table of OPTIONAL_TABLES) {
    const result = await checkTableExists(table);
    optionalResults[table] = result;
  }

  runtimeState.tableChecks.required = requiredResults;
  runtimeState.tableChecks.optional = optionalResults;

  const requiredFailures = Object.values(requiredResults).filter((x) => !x.ok);
  return {
    ok: requiredFailures.length === 0,
    required: requiredResults,
    optional: optionalResults,
    requiredFailures
  };
}

/* =========================================================
   STARTUP CHECKS
========================================================= */
async function runStartupChecks() {
  console.log("🚀 Running startup checks...");

  try {
    const envProblems = [];

    if (!SUPABASE_URL) envProblems.push("Missing SUPABASE_URL");
    if (!SUPABASE_SERVICE_ROLE_KEY) envProblems.push("Missing SUPABASE_SERVICE_ROLE_KEY");

    if (envProblems.length) {
      runtimeState.startupChecksFinished = true;
      runtimeState.startupChecksPassed = false;
      runtimeState.lastStartupError = envProblems.join("; ");
      console.error("❌ Startup env checks failed:", runtimeState.lastStartupError);
      return;
    }

    const dbPing = await pingSupabase();
    if (!dbPing.ok) {
      runtimeState.startupChecksFinished = true;
      runtimeState.startupChecksPassed = false;
      runtimeState.lastStartupError = dbPing.message;
      console.error("❌ Supabase ping failed:", dbPing.message);
      return;
    }

    if (ENABLE_STARTUP_TABLE_CHECKS) {
      const tableCheck = await runTableChecks();
      if (!tableCheck.ok) {
        runtimeState.startupChecksFinished = true;
        runtimeState.startupChecksPassed = false;
        runtimeState.lastStartupError = tableCheck.requiredFailures
          .map((item) => `${item.table}: ${item.error}`)
          .join("; ");
        console.error("❌ Required table checks failed:", runtimeState.lastStartupError);
        return;
      }
    }

    runtimeState.startupChecksFinished = true;
    runtimeState.startupChecksPassed = true;
    runtimeState.lastStartupError = "";
    runtimeState.bootCompletedAt = nowIso();

    console.log("✅ Startup checks passed.");
  } catch (error) {
    runtimeState.startupChecksFinished = true;
    runtimeState.startupChecksPassed = false;
    runtimeState.lastStartupError = safeErrorMessage(error);
    console.error("❌ Startup checks crashed:", runtimeState.lastStartupError);
  }
}

/* =========================================================
   ROOT ROUTE
========================================================= */
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

/* =========================================================
   LIGHT LIVENESS CHECK
========================================================= */
app.get("/api/health", (req, res) => {
  runtimeState.lastHealthCheckAt = nowIso();

  return res.status(200).json({
    ok: true,
    service: APP_NAME,
    status: "alive",
    now: nowIso(),
    uptime_seconds: Math.floor(process.uptime()),
    started_at: SERVER_STARTED_AT,
    node_env: NODE_ENV,
    request_id: req.requestId
  });
});

/* =========================================================
   DEEP READINESS CHECK
========================================================= */
app.get(
  "/api/health/ready",
  asyncHandler(async (req, res) => {
    runtimeState.lastReadinessCheckAt = nowIso();

    const dbPing = await pingSupabase();
    const requiredTableFailures = Object.values(runtimeState.tableChecks.required || {}).filter(
      (x) => x && !x.ok
    );

    const ready =
      runtimeState.startupChecksPassed &&
      dbPing.ok &&
      requiredTableFailures.length === 0;

    return res.status(ready ? 200 : 503).json({
      ok: ready,
      service: APP_NAME,
      status: ready ? "ready" : "not_ready",
      now: nowIso(),
      request_id: req.requestId,
      checks: {
        startup_checks_passed: runtimeState.startupChecksPassed,
        supabase_ping_ok: dbPing.ok,
        supabase_ping_message: dbPing.message,
        required_table_failures: requiredTableFailures
      }
    });
  })
);

/* =========================================================
   FULL DIAGNOSTICS
========================================================= */
app.get(
  "/api/health/full",
  asyncHandler(async (req, res) => {
    const dbPing = await pingSupabase();

    return res.status(200).json({
      ok: true,
      service: APP_NAME,
      now: nowIso(),
      request_id: req.requestId,
      runtime: {
        uptime_seconds: Math.floor(process.uptime()),
        boot_id: runtimeState.bootId,
        boot_started_at: runtimeState.bootStartedAt,
        boot_completed_at: runtimeState.bootCompletedAt,
        startup_checks_finished: runtimeState.startupChecksFinished,
        startup_checks_passed: runtimeState.startupChecksPassed,
        last_startup_error: runtimeState.lastStartupError,
        memory: process.memoryUsage()
      },
      env: {
        node_env: NODE_ENV,
        public_app_url: PUBLIC_APP_URL,
        supabase_url_present: Boolean(SUPABASE_URL),
        supabase_service_role_key_present: Boolean(SUPABASE_SERVICE_ROLE_KEY),
        supabase_service_role_key_masked: maskSecret(SUPABASE_SERVICE_ROLE_KEY),
        openai_enabled: Boolean(openai),
        openai_api_key_present: Boolean(OPENAI_API_KEY),
        openai_model: OPENAI_SUPPORT_MODEL,
        google_maps_present: Boolean(GOOGLE_MAPS_API_KEY)
      },
      features: {
        rider_verification_gate: ENABLE_RIDER_VERIFICATION_GATE,
        payment_gate: ENABLE_PAYMENT_GATE,
        auto_redispatch: ENABLE_AUTO_REDISPATCH,
        startup_table_checks: ENABLE_STARTUP_TABLE_CHECKS
      },
      database: {
        configured: supabaseEnabled,
        ping_ok: dbPing.ok,
        ping_message: dbPing.message,
        last_ping_at: runtimeState.lastSupabasePingAt,
        required_tables: runtimeState.tableChecks.required,
        optional_tables: runtimeState.tableChecks.optional
      }
    });
  })
);

/* =========================================================
   SIMPLE VERSION ROUTE
========================================================= */
app.get("/api/version", (req, res) => {
  res.json({
    ok: true,
    app: APP_NAME,
    node_env: NODE_ENV,
    started_at: SERVER_STARTED_AT,
    public_app_url: PUBLIC_APP_URL,
    boot_id: runtimeState.bootId
  });
});

/* =========================================================
   NOT FOUND
========================================================= */
app.use((req, res) => {
  return res.status(404).json({
    ok: false,
    error: "Route not found",
    path: req.originalUrl,
    method: req.method,
    request_id: req.requestId
  });
});

/* =========================================================
   GLOBAL ERROR HANDLER
========================================================= */
app.use((error, req, res, next) => {
  console.error("🔥 Unhandled server error:", error);

  return res.status(500).json({
    ok: false,
    error: "Internal server error",
    message: NODE_ENV === "production" ? "Unexpected server failure" : safeErrorMessage(error),
    request_id: req.requestId
  });
});

/* =========================================================
   START SERVER
========================================================= */
app.listen(PORT, async () => {
  console.log("==================================================");
  console.log(`🚕 ${APP_NAME} listening on port ${PORT}`);
  console.log(`🌐 Public URL: ${PUBLIC_APP_URL}`);
  console.log(`🕒 Started: ${SERVER_STARTED_AT}`);
  console.log(`🧠 AI Enabled: ${Boolean(openai)}`);
  console.log(`🗺️ Google Maps Configured: ${Boolean(GOOGLE_MAPS_API_KEY)}`);
  console.log(`🗄️ Supabase Configured: ${supabaseEnabled}`);
  console.log("==================================================");

  await runStartupChecks();
});/* =========================================================
   HARVEY TAXI — CODE BLUE PHASE 9 (PART 1)
   FOUNDATION + ENV + CLIENTS + ADVANCED HEALTH CHECKS
========================================================= */

const express = require("express");
const cors = require("cors");
const path = require("path");
const crypto = require("crypto");
const os = require("os");

const { createClient } = require("@supabase/supabase-js");

/* OPTIONAL SDKS */
let OpenAI = null;
try { OpenAI = require("openai"); } catch (e) {}

let twilio = null;
try { twilio = require("twilio"); } catch (e) {}

/* =========================================================
   APP INIT
========================================================= */
const app = express();
const PORT = Number(process.env.PORT || 10000);
const SERVER_STARTED_AT = new Date().toISOString();

/* =========================================================
   MIDDLEWARE
========================================================= */
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

/* =========================================================
   ENV HELPERS
========================================================= */
function clean(value = "") {
  return String(value || "").trim();
}

function requireEnv(name) {
  const value = clean(process.env[name]);
  if (!value) {
    console.warn(`⚠️ Missing ENV: ${name}`);
  }
  return value;
}

/* =========================================================
   ENV CONFIG
========================================================= */
const SUPABASE_URL = requireEnv("SUPABASE_URL");
const SUPABASE_KEY = requireEnv("SUPABASE_SERVICE_ROLE_KEY");

const OPENAI_API_KEY = clean(process.env.OPENAI_API_KEY);
const TWILIO_ACCOUNT_SID = clean(process.env.TWILIO_ACCOUNT_SID);
const TWILIO_AUTH_TOKEN = clean(process.env.TWILIO_AUTH_TOKEN);

const ENABLE_AI = !!OPENAI_API_KEY;
const ENABLE_SMS = !!(TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN);

/* =========================================================
   CLIENTS
========================================================= */
const supabase = SUPABASE_URL && SUPABASE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_KEY)
  : null;

const openai = ENABLE_AI && OpenAI
  ? new OpenAI({ apiKey: OPENAI_API_KEY })
  : null;

const smsClient = ENABLE_SMS && twilio
  ? twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
  : null;

/* =========================================================
   SYSTEM METRICS
========================================================= */
function getSystemMetrics() {
  return {
    uptime_seconds: process.uptime(),
    memory: process.memoryUsage(),
    cpu_load: os.loadavg(),
    platform: process.platform,
    node_version: process.version
  };
}

/* =========================================================
   DATABASE HEALTH CHECK
========================================================= */
async function checkDatabase() {
  if (!supabase) {
    return { ok: false, error: "Supabase not configured" };
  }

  try {
    const { error } = await supabase.from("riders").select("id").limit(1);
    if (error) throw error;

    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/* =========================================================
   TABLE HEALTH CHECK
========================================================= */
async function checkTables() {
  const tables = ["riders", "drivers", "rides", "payments", "dispatches"];
  const results = {};

  for (const table of tables) {
    try {
      const { error } = await supabase.from(table).select("*").limit(1);
      results[table] = error ? "error" : "ok";
    } catch (e) {
      results[table] = "missing";
    }
  }

  return results;
}

/* =========================================================
   EXTERNAL SERVICES CHECK
========================================================= */
async function checkExternalServices() {
  return {
    ai: ENABLE_AI ? "enabled" : "disabled",
    sms: ENABLE_SMS ? "enabled" : "disabled"
  };
}

/* =========================================================
   HEALTH ENDPOINT (BASIC)
========================================================= */
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    server_time: new Date().toISOString(),
    started_at: SERVER_STARTED_AT
  });
});

/* =========================================================
   HEALTH ENDPOINT (DETAILED)
========================================================= */
app.get("/api/health/full", async (req, res) => {
  try {
    const db = await checkDatabase();
    const tables = await checkTables();
    const services = await checkExternalServices();
    const system = getSystemMetrics();

    res.json({
      status: db.ok ? "healthy" : "degraded",
      timestamp: new Date().toISOString(),

      database: db,
      tables,
      services,
      system
    });
  } catch (err) {
    res.status(500).json({
      status: "error",
      error: err.message
    });
  }
});

/* =========================================================
   START SERVER
========================================================= */
app.listen(PORT, () => {
  console.log(`🚀 Harvey Taxi Server running on port ${PORT}`);
});/* =========================================================
   HARVEY TAXI — CODE BLUE PHASE 9 (PART 3)
   DRIVER MISSIONS + ACCEPT / DECLINE + DISPATCH FLOW
========================================================= */

/* =========================================================
   DISPATCH / MISSION CONFIG
========================================================= */
const DISPATCH_OFFER_TIMEOUT_SECONDS = Number(process.env.DISPATCH_OFFER_TIMEOUT_SECONDS || 30);
const DISPATCH_MAX_ATTEMPTS = Number(process.env.DISPATCH_MAX_ATTEMPTS || 5);

/* =========================================================
   DRIVER HELPERS
========================================================= */
function isDriverApprovedStatus(value = "") {
  const v = clean(value).toLowerCase();
  return ["approved", "active", "verified", "cleared"].includes(v);
}

function isDriverOnlineStatus(value = "") {
  const v = clean(value).toLowerCase();
  return ["online", "available", "ready", "active"].includes(v);
}

function normalizeDriverType(value = "") {
  const v = clean(value).toLowerCase();
  if (["autonomous", "av", "robotaxi", "self-driving"].includes(v)) return "autonomous";
  return "human";
}

function getDriverApprovalStatus(driver) {
  if (!driver) return "";
  return (
    clean(driver.approval_status) ||
    clean(driver.status) ||
    clean(driver.verification_status) ||
    clean(driver.access_status)
  );
}

function getDriverOnlineState(driver) {
  if (!driver) return "";
  return (
    clean(driver.online_status) ||
    clean(driver.availability_status) ||
    clean(driver.driver_status) ||
    clean(driver.state)
  );
}

function driverCanReceiveMission(driver) {
  if (!driver) {
    return { ok: false, reason: "Driver not found" };
  }

  const approval = getDriverApprovalStatus(driver);
  if (!isDriverApprovedStatus(approval)) {
    return {
      ok: false,
      reason: "Driver is not approved",
      approval_status: approval || "unapproved"
    };
  }

  const online = getDriverOnlineState(driver);
  if (online && !isDriverOnlineStatus(online)) {
    return {
      ok: false,
      reason: "Driver is not currently available",
      online_status: online
    };
  }

  return {
    ok: true,
    approval_status: approval || null,
    online_status: online || null
  };
}

async function getDriverById(driverId) {
  if (!supabase) throw new Error("Supabase not configured");

  const { data, error } = await supabase
    .from("drivers")
    .select("*")
    .eq("id", driverId)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

async function getCandidateDriversForRide(requestedMode = "driver") {
  if (!supabase) throw new Error("Supabase not configured");

  const desiredType =
    clean(requestedMode).toLowerCase() === "autonomous" ? "autonomous" : "human";

  const { data, error } = await supabase
    .from("drivers")
    .select("*")
    .order("created_at", { ascending: true })
    .limit(100);

  if (error) throw error;

  const rows = Array.isArray(data) ? data : [];

  return rows.filter((driver) => {
    const type = normalizeDriverType(driver.driver_type || driver.type || "human");
    const allowed = driverCanReceiveMission(driver);
    return type === desiredType && allowed.ok;
  });
}

/* =========================================================
   RIDE / DISPATCH HELPERS
========================================================= */
async function getRideById(rideId) {
  if (!supabase) throw new Error("Supabase not configured");

  const { data, error } = await supabase
    .from("rides")
    .select("*")
    .eq("id", rideId)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

async function getDispatchById(dispatchId) {
  if (!supabase) throw new Error("Supabase not configured");

  const { data, error } = await supabase
    .from("dispatches")
    .select("*")
    .eq("id", dispatchId)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

async function getActiveDispatchForRide(rideId) {
  if (!supabase) throw new Error("Supabase not configured");

  const { data, error } = await supabase
    .from("dispatches")
    .select("*")
    .eq("ride_id", rideId)
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) throw error;

  const rows = Array.isArray(data) ? data : [];
  return (
    rows.find((row) =>
      ["pending", "offered", "awaiting_driver_response", "driver_assigned"].includes(
        clean(row.status).toLowerCase()
      )
    ) || null
  );
}

async function updateRide(rideId, updates = {}) {
  if (!supabase) throw new Error("Supabase not configured");

  const payload = {
    ...updates,
    updated_at: new Date().toISOString()
  };

  const { data, error } = await supabase
    .from("rides")
    .update(payload)
    .eq("id", rideId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

async function updateDispatch(dispatchId, updates = {}) {
  if (!supabase) throw new Error("Supabase not configured");

  const payload = {
    ...updates,
    updated_at: new Date().toISOString()
  };

  const { data, error } = await supabase
    .from("dispatches")
    .update(payload)
    .eq("id", dispatchId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

/* =========================================================
   MISSION HELPERS
========================================================= */
async function createMissionRecord({
  ride,
  dispatch,
  driver,
  expiresAt
}) {
  if (!supabase) throw new Error("Supabase not configured");

  const payload = {
    id: crypto.randomUUID(),
    ride_id: ride.id,
    dispatch_id: dispatch.id,
    rider_id: ride.rider_id,
    driver_id: driver.id,
    status: "offered",
    mission_status: "offered",
    pickup_address: ride.pickup_address || null,
    dropoff_address: ride.dropoff_address || null,
    requested_mode: ride.requested_mode || "driver",
    offer_expires_at: expiresAt,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  const { data, error } = await supabase
    .from("missions")
    .insert(payload)
    .select()
    .single();

  if (error) throw error;
  return data;
}

async function getMissionById(missionId) {
  if (!supabase) throw new Error("Supabase not configured");

  const { data, error } = await supabase
    .from("missions")
    .select("*")
    .eq("id", missionId)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

async function getDriverOpenMissions(driverId) {
  if (!supabase) throw new Error("Supabase not configured");

  const { data, error } = await supabase
    .from("missions")
    .select("*")
    .eq("driver_id", driverId)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) throw error;

  const rows = Array.isArray(data) ? data : [];
  const now = Date.now();

  return rows.filter((mission) => {
    const status = clean(mission.status || mission.mission_status).toLowerCase();
    const expiresAt = mission.offer_expires_at ? new Date(mission.offer_expires_at).getTime() : null;
    const notExpired = !expiresAt || expiresAt > now;

    return ["offered", "awaiting_response", "pending"].includes(status) && notExpired;
  });
}

async function updateMission(missionId, updates = {}) {
  if (!supabase) throw new Error("Supabase not configured");

  const payload = {
    ...updates,
    updated_at: new Date().toISOString()
  };

  const { data, error } = await supabase
    .from("missions")
    .update(payload)
    .eq("id", missionId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

/* =========================================================
   DISPATCH ENGINE — OFFER NEXT DRIVER
========================================================= */
async function offerRideToNextDriver(rideId) {
  const ride = await getRideById(rideId);
  if (!ride) {
    return { ok: false, reason: "Ride not found" };
  }

  const dispatch = await getActiveDispatchForRide(rideId);
  if (!dispatch) {
    return { ok: false, reason: "Dispatch not found" };
  }

  const currentAttempt = Number(dispatch.attempt_number || 1);
  if (currentAttempt > DISPATCH_MAX_ATTEMPTS) {
    await updateRide(rideId, {
      status: "no_driver_available"
    });

    await updateDispatch(dispatch.id, {
      status: "failed"
    });

    return {
      ok: false,
      reason: "Max dispatch attempts reached"
    };
  }

  const candidates = await getCandidateDriversForRide(ride.requested_mode || "driver");

  if (!candidates.length) {
    await updateRide(rideId, {
      status: "no_driver_available"
    });

    await updateDispatch(dispatch.id, {
      status: "failed"
    });

    return {
      ok: false,
      reason: "No available drivers found"
    };
  }

  const { data: priorMissions, error: priorError } = await supabase
    .from("missions")
    .select("driver_id")
    .eq("ride_id", rideId);

  if (priorError) throw priorError;

  const priorDriverIds = new Set((priorMissions || []).map((row) => clean(row.driver_id)));

  const nextDriver =
    candidates.find((driver) => !priorDriverIds.has(clean(driver.id))) || null;

  if (!nextDriver) {
    await updateRide(rideId, {
      status: "no_driver_available"
    });

    await updateDispatch(dispatch.id, {
      status: "failed"
    });

    return {
      ok: false,
      reason: "All candidate drivers already attempted"
    };
  }

  const expiresAt = new Date(Date.now() + DISPATCH_OFFER_TIMEOUT_SECONDS * 1000).toISOString();

  const mission = await createMissionRecord({
    ride,
    dispatch,
    driver: nextDriver,
    expiresAt
  });

  const updatedDispatch = await updateDispatch(dispatch.id, {
    driver_id: nextDriver.id,
    status: "offered",
    offered_at: new Date().toISOString(),
    expires_at: expiresAt
  });

  const updatedRide = await updateRide(ride.id, {
    status: "awaiting_driver_acceptance",
    driver_id: nextDriver.id
  });

  return {
    ok: true,
    ride: updatedRide,
    dispatch: updatedDispatch,
    mission,
    driver: {
      id: nextDriver.id,
      name: nextDriver.full_name || nextDriver.name || null,
      email: nextDriver.email || null,
      driver_type: normalizeDriverType(nextDriver.driver_type || nextDriver.type || "human")
    }
  };
}

/* =========================================================
   ROUTE — START DISPATCH OFFER
========================================================= */
app.post("/api/dispatches/:rideId/start", async (req, res) => {
  try {
    if (!supabase) {
      return jsonError(res, 500, "Supabase not configured");
    }

    const rideId = clean(req.params.rideId);
    if (!rideId) {
      return jsonError(res, 400, "Ride ID is required");
    }

    const result = await offerRideToNextDriver(rideId);

    if (!result.ok) {
      return jsonError(res, 404, result.reason || "Unable to start dispatch");
    }

    return jsonOk(res, {
      message: "Dispatch offer created",
      ride_id: result.ride.id,
      dispatch_id: result.dispatch.id,
      mission_id: result.mission.id,
      driver_id: result.driver.id,
      offer_expires_at: result.mission.offer_expires_at
    });
  } catch (error) {
    console.error("dispatch-start error:", error);
    return jsonError(res, 500, error.message || "Failed to start dispatch");
  }
});

/* =========================================================
   ROUTE — DRIVER OPEN MISSIONS
========================================================= */
app.get("/api/drivers/:driverId/missions", async (req, res) => {
  try {
    if (!supabase) {
      return jsonError(res, 500, "Supabase not configured");
    }

    const driverId = clean(req.params.driverId);
    if (!driverId) {
      return jsonError(res, 400, "Driver ID is required");
    }

    const driver = await getDriverById(driverId);
    if (!driver) {
      return jsonError(res, 404, "Driver not found");
    }

    const missions = await getDriverOpenMissions(driverId);

    return jsonOk(res, {
      driver_id: driverId,
      count: missions.length,
      missions
    });
  } catch (error) {
    console.error("driver-missions error:", error);
    return jsonError(res, 500, error.message || "Failed to fetch driver missions");
  }
});

/* =========================================================
   ROUTE — DRIVER ACCEPT MISSION
========================================================= */
app.post("/api/missions/:missionId/accept", async (req, res) => {
  try {
    if (!supabase) {
      return jsonError(res, 500, "Supabase not configured");
    }

    const missionId = clean(req.params.missionId);
    const driverId = clean(req.body?.driver_id || req.body?.driverId);

    if (!missionId || !driverId) {
      return jsonError(res, 400, "Mission ID and driver ID are required");
    }

    const mission = await getMissionById(missionId);
    if (!mission) {
      return jsonError(res, 404, "Mission not found");
    }

    if (clean(mission.driver_id) !== driverId) {
      return jsonError(res, 403, "Mission does not belong to this driver");
    }

    const status = clean(mission.status || mission.mission_status).toLowerCase();
    if (!["offered", "awaiting_response", "pending"].includes(status)) {
      return jsonError(res, 409, "Mission is no longer available");
    }

    if (mission.offer_expires_at && new Date(mission.offer_expires_at).getTime() < Date.now()) {
      await updateMission(mission.id, {
        status: "expired",
        mission_status: "expired"
      });

      return jsonError(res, 410, "Mission offer expired");
    }

    const driver = await getDriverById(driverId);
    const allowed = driverCanReceiveMission(driver);

    if (!allowed.ok) {
      return jsonError(res, 403, allowed.reason || "Driver cannot accept mission");
    }

    const updatedMission = await updateMission(mission.id, {
      status: "accepted",
      mission_status: "accepted",
      accepted_at: new Date().toISOString()
    });

    const updatedDispatch = await updateDispatch(mission.dispatch_id, {
      status: "driver_assigned",
      driver_id: driverId,
      accepted_at: new Date().toISOString()
    });

    const updatedRide = await updateRide(mission.ride_id, {
      status: "driver_assigned",
      driver_id: driverId,
      assigned_at: new Date().toISOString()
    });

    return jsonOk(res, {
      message: "Mission accepted",
      mission_id: updatedMission.id,
      dispatch_id: updatedDispatch.id,
      ride_id: updatedRide.id,
      driver_id: driverId,
      ride_status: updatedRide.status
    });
  } catch (error) {
    console.error("mission-accept error:", error);
    return jsonError(res, 500, error.message || "Failed to accept mission");
  }
});

/* =========================================================
   ROUTE — DRIVER DECLINE MISSION
========================================================= */
app.post("/api/missions/:missionId/decline", async (req, res) => {
  try {
    if (!supabase) {
      return jsonError(res, 500, "Supabase not configured");
    }

    const missionId = clean(req.params.missionId);
    const driverId = clean(req.body?.driver_id || req.body?.driverId);

    if (!missionId || !driverId) {
      return jsonError(res, 400, "Mission ID and driver ID are required");
    }

    const mission = await getMissionById(missionId);
    if (!mission) {
      return jsonError(res, 404, "Mission not found");
    }

    if (clean(mission.driver_id) !== driverId) {
      return jsonError(res, 403, "Mission does not belong to this driver");
    }

    const updatedMission = await updateMission(mission.id, {
      status: "declined",
      mission_status: "declined",
      declined_at: new Date().toISOString()
    });

    const currentDispatch = await getDispatchById(mission.dispatch_id);
    const nextAttempt = Number(currentDispatch?.attempt_number || 1) + 1;

    await updateDispatch(mission.dispatch_id, {
      status: "pending",
      attempt_number: nextAttempt,
      driver_id: null
    });

    await updateRide(mission.ride_id, {
      status: "awaiting_driver_acceptance",
      driver_id: null
    });

    const nextOffer = await offerRideToNextDriver(mission.ride_id);

    return jsonOk(res, {
      message: "Mission declined",
      mission_id: updatedMission.id,
      next_offer_started: !!nextOffer.ok,
      next_offer: nextOffer.ok
        ? {
            mission_id: nextOffer.mission.id,
            driver_id: nextOffer.driver.id,
            dispatch_id: nextOffer.dispatch.id,
            offer_expires_at: nextOffer.mission.offer_expires_at
          }
        : null,
      next_offer_reason: nextOffer.ok ? null : nextOffer.reason || "No next offer available"
    });
  } catch (error) {
    console.error("mission-decline error:", error);
    return jsonError(res, 500, error.message || "Failed to decline mission");
  }
});

/* =========================================================
   ROUTE — MISSION DETAILS
========================================================= */
app.get("/api/missions/:missionId", async (req, res) => {
  try {
    if (!supabase) {
      return jsonError(res, 500, "Supabase not configured");
    }

    const missionId = clean(req.params.missionId);
    if (!missionId) {
      return jsonError(res, 400, "Mission ID is required");
    }

    const mission = await getMissionById(missionId);
    if (!mission) {
      return jsonError(res, 404, "Mission not found");
    }

    return jsonOk(res, {
      mission
    });
  } catch (error) {
    console.error("mission-details error:", error);
    return jsonError(res, 500, error.message || "Failed to fetch mission");
  }
});/* =========================================================
   HARVEY TAXI — CODE BLUE PHASE 9 (PART 4)
   TRIP LIFECYCLE + CANCELLATIONS + EVENT LOGGING
========================================================= */

/* =========================================================
   TRIP / PAYMENT CONFIG
========================================================= */
const DEFAULT_DRIVER_PAYOUT_PERCENT = Number(process.env.DEFAULT_DRIVER_PAYOUT_PERCENT || 0.75);
const ENABLE_TRIP_EVENTS = clean(process.env.ENABLE_TRIP_EVENTS || "true").toLowerCase() !== "false";

/* =========================================================
   EVENT HELPERS
========================================================= */
async function logTripEvent({
  ride_id,
  driver_id = null,
  rider_id = null,
  event_type,
  title = "",
  description = "",
  metadata = {}
}) {
  if (!supabase || !ENABLE_TRIP_EVENTS) return null;

  const payload = {
    id: crypto.randomUUID(),
    ride_id: clean(ride_id),
    driver_id: clean(driver_id) || null,
    rider_id: clean(rider_id) || null,
    event_type: clean(event_type) || "event",
    title: clean(title) || null,
    description: clean(description) || null,
    metadata: metadata || {},
    created_at: new Date().toISOString()
  };

  try {
    const { data, error } = await supabase
      .from("trip_events")
      .insert(payload)
      .select()
      .single();

    if (error) {
      console.error("trip event insert error:", error);
      return null;
    }

    return data;
  } catch (error) {
    console.error("trip event crash:", error);
    return null;
  }
}

function canMoveRideToEnRoute(status = "") {
  const s = clean(status).toLowerCase();
  return ["driver_assigned", "accepted", "awaiting_pickup"].includes(s);
}

function canMoveRideToArrived(status = "") {
  const s = clean(status).toLowerCase();
  return ["driver_en_route", "awaiting_pickup"].includes(s);
}

function canStartTrip(status = "") {
  const s = clean(status).toLowerCase();
  return ["driver_arrived", "arrived"].includes(s);
}

function canCompleteTrip(status = "") {
  const s = clean(status).toLowerCase();
  return ["in_progress", "trip_started"].includes(s);
}

function canCancelRide(status = "") {
  const s = clean(status).toLowerCase();
  return ![
    "completed",
    "cancelled",
    "canceled"
  ].includes(s);
}

function calculatePayouts(finalFare) {
  const fare = Math.max(0, Number(finalFare || 0));
  const driverPayout = Number((fare * DEFAULT_DRIVER_PAYOUT_PERCENT).toFixed(2));
  const platformRevenue = Number((fare - driverPayout).toFixed(2));

  return {
    final_fare: Number(fare.toFixed(2)),
    driver_payout: driverPayout,
    platform_revenue: platformRevenue,
    payout_percent: DEFAULT_DRIVER_PAYOUT_PERCENT
  };
}

async function getLatestMissionForRide(rideId) {
  if (!supabase) throw new Error("Supabase not configured");

  const { data, error } = await supabase
    .from("missions")
    .select("*")
    .eq("ride_id", rideId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

async function getLatestDispatchForRide(rideId) {
  if (!supabase) throw new Error("Supabase not configured");

  const { data, error } = await supabase
    .from("dispatches")
    .select("*")
    .eq("ride_id", rideId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

async function updatePaymentRecord(paymentId, updates = {}) {
  if (!supabase) throw new Error("Supabase not configured");
  if (!clean(paymentId)) return null;

  const payload = {
    ...updates,
    updated_at: new Date().toISOString()
  };

  const { data, error } = await supabase
    .from("payments")
    .update(payload)
    .eq("id", paymentId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

async function closeMissionAsCompleted(missionId) {
  if (!clean(missionId)) return null;
  return await updateMission(missionId, {
    status: "completed",
    mission_status: "completed",
    completed_at: new Date().toISOString()
  });
}

async function closeDispatchAsCompleted(dispatchId) {
  if (!clean(dispatchId)) return null;
  return await updateDispatch(dispatchId, {
    status: "completed",
    completed_at: new Date().toISOString()
  });
}

async function closeMissionAsCancelled(missionId) {
  if (!clean(missionId)) return null;
  return await updateMission(missionId, {
    status: "cancelled",
    mission_status: "cancelled",
    cancelled_at: new Date().toISOString()
  });
}

async function closeDispatchAsCancelled(dispatchId) {
  if (!clean(dispatchId)) return null;
  return await updateDispatch(dispatchId, {
    status: "cancelled",
    cancelled_at: new Date().toISOString()
  });
}

/* =========================================================
   ROUTE — DRIVER EN ROUTE
========================================================= */
app.post("/api/rides/:rideId/en-route", async (req, res) => {
  try {
    const rideId = clean(req.params.rideId);
    const driverId = clean(req.body?.driver_id || req.body?.driverId);

    if (!rideId || !driverId) {
      return jsonError(res, 400, "Ride ID and driver ID are required");
    }

    const ride = await getRideById(rideId);
    if (!ride) {
      return jsonError(res, 404, "Ride not found");
    }

    if (clean(ride.driver_id) !== driverId) {
      return jsonError(res, 403, "This ride is not assigned to that driver");
    }

    if (!canMoveRideToEnRoute(ride.status)) {
      return jsonError(res, 409, "Ride cannot move to en route from current status", {
        current_status: ride.status
      });
    }

    const updatedRide = await updateRide(rideId, {
      status: "driver_en_route",
      en_route_at: new Date().toISOString()
    });

    const mission = await getLatestMissionForRide(rideId);
    if (mission) {
      await updateMission(mission.id, {
        status: "driver_en_route",
        mission_status: "driver_en_route",
        en_route_at: new Date().toISOString()
      });
    }

    const dispatch = await getLatestDispatchForRide(rideId);
    if (dispatch) {
      await updateDispatch(dispatch.id, {
        status: "driver_en_route",
        en_route_at: new Date().toISOString()
      });
    }

    await logTripEvent({
      ride_id: rideId,
      driver_id: driverId,
      rider_id: ride.rider_id,
      event_type: "driver_en_route",
      title: "Driver en route",
      description: "Driver is heading to pickup"
    });

    return jsonOk(res, {
      message: "Ride marked as driver en route",
      ride_id: updatedRide.id,
      status: updatedRide.status
    });
  } catch (error) {
    console.error("ride-en-route error:", error);
    return jsonError(res, 500, error.message || "Failed to mark ride en route");
  }
});

/* =========================================================
   ROUTE — DRIVER ARRIVED
========================================================= */
app.post("/api/rides/:rideId/arrived", async (req, res) => {
  try {
    const rideId = clean(req.params.rideId);
    const driverId = clean(req.body?.driver_id || req.body?.driverId);

    if (!rideId || !driverId) {
      return jsonError(res, 400, "Ride ID and driver ID are required");
    }

    const ride = await getRideById(rideId);
    if (!ride) {
      return jsonError(res, 404, "Ride not found");
    }

    if (clean(ride.driver_id) !== driverId) {
      return jsonError(res, 403, "This ride is not assigned to that driver");
    }

    if (!canMoveRideToArrived(ride.status)) {
      return jsonError(res, 409, "Ride cannot move to arrived from current status", {
        current_status: ride.status
      });
    }

    const updatedRide = await updateRide(rideId, {
      status: "driver_arrived",
      arrived_at: new Date().toISOString()
    });

    const mission = await getLatestMissionForRide(rideId);
    if (mission) {
      await updateMission(mission.id, {
        status: "driver_arrived",
        mission_status: "driver_arrived",
        arrived_at: new Date().toISOString()
      });
    }

    const dispatch = await getLatestDispatchForRide(rideId);
    if (dispatch) {
      await updateDispatch(dispatch.id, {
        status: "driver_arrived",
        arrived_at: new Date().toISOString()
      });
    }

    await logTripEvent({
      ride_id: rideId,
      driver_id: driverId,
      rider_id: ride.rider_id,
      event_type: "driver_arrived",
      title: "Driver arrived",
      description: "Driver has arrived at pickup"
    });

    return jsonOk(res, {
      message: "Ride marked as driver arrived",
      ride_id: updatedRide.id,
      status: updatedRide.status
    });
  } catch (error) {
    console.error("ride-arrived error:", error);
    return jsonError(res, 500, error.message || "Failed to mark ride arrived");
  }
});

/* =========================================================
   ROUTE — START TRIP
========================================================= */
app.post("/api/rides/:rideId/start", async (req, res) => {
  try {
    const rideId = clean(req.params.rideId);
    const driverId = clean(req.body?.driver_id || req.body?.driverId);

    if (!rideId || !driverId) {
      return jsonError(res, 400, "Ride ID and driver ID are required");
    }

    const ride = await getRideById(rideId);
    if (!ride) {
      return jsonError(res, 404, "Ride not found");
    }

    if (clean(ride.driver_id) !== driverId) {
      return jsonError(res, 403, "This ride is not assigned to that driver");
    }

    if (!canStartTrip(ride.status)) {
      return jsonError(res, 409, "Ride cannot be started from current status", {
        current_status: ride.status
      });
    }

    const updatedRide = await updateRide(rideId, {
      status: "in_progress",
      started_at: new Date().toISOString()
    });

    const mission = await getLatestMissionForRide(rideId);
    if (mission) {
      await updateMission(mission.id, {
        status: "in_progress",
        mission_status: "in_progress",
        started_at: new Date().toISOString()
      });
    }

    const dispatch = await getLatestDispatchForRide(rideId);
    if (dispatch) {
      await updateDispatch(dispatch.id, {
        status: "in_progress",
        started_at: new Date().toISOString()
      });
    }

    await logTripEvent({
      ride_id: rideId,
      driver_id: driverId,
      rider_id: ride.rider_id,
      event_type: "trip_started",
      title: "Trip started",
      description: "Ride is now in progress"
    });

    return jsonOk(res, {
      message: "Trip started successfully",
      ride_id: updatedRide.id,
      status: updatedRide.status
    });
  } catch (error) {
    console.error("ride-start error:", error);
    return jsonError(res, 500, error.message || "Failed to start trip");
  }
});

/* =========================================================
   ROUTE — COMPLETE TRIP
========================================================= */
app.post("/api/rides/:rideId/complete", async (req, res) => {
  try {
    const rideId = clean(req.params.rideId);
    const driverId = clean(req.body?.driver_id || req.body?.driverId);
    const finalFareInput = req.body?.final_fare || req.body?.finalFare;

    if (!rideId || !driverId) {
      return jsonError(res, 400, "Ride ID and driver ID are required");
    }

    const ride = await getRideById(rideId);
    if (!ride) {
      return jsonError(res, 404, "Ride not found");
    }

    if (clean(ride.driver_id) !== driverId) {
      return jsonError(res, 403, "This ride is not assigned to that driver");
    }

    if (!canCompleteTrip(ride.status)) {
      return jsonError(res, 409, "Ride cannot be completed from current status", {
        current_status: ride.status
      });
    }

    const finalFare = Number(
      finalFareInput || ride.estimated_fare || 0
    );

    const payout = calculatePayouts(finalFare);

    const updatedRide = await updateRide(rideId, {
      status: "completed",
      completed_at: new Date().toISOString(),
      final_fare: payout.final_fare,
      driver_payout: payout.driver_payout,
      platform_revenue: payout.platform_revenue
    });

    const mission = await getLatestMissionForRide(rideId);
    if (mission) {
      await closeMissionAsCompleted(mission.id);
    }

    const dispatch = await getLatestDispatchForRide(rideId);
    if (dispatch) {
      await closeDispatchAsCompleted(dispatch.id);
    }

    let updatedPayment = null;
    if (clean(ride.payment_id)) {
      updatedPayment = await updatePaymentRecord(ride.payment_id, {
        status: "capture_pending",
        capture_amount: payout.final_fare,
        driver_payout: payout.driver_payout,
        platform_revenue: payout.platform_revenue
      });
    }

    await logTripEvent({
      ride_id: rideId,
      driver_id: driverId,
      rider_id: ride.rider_id,
      event_type: "trip_completed",
      title: "Trip completed",
      description: "Ride completed successfully",
      metadata: {
        final_fare: payout.final_fare,
        driver_payout: payout.driver_payout,
        platform_revenue: payout.platform_revenue
      }
    });

    return jsonOk(res, {
      message: "Trip completed successfully",
      ride_id: updatedRide.id,
      status: updatedRide.status,
      final_fare: payout.final_fare,
      driver_payout: payout.driver_payout,
      platform_revenue: payout.platform_revenue,
      payment_status: updatedPayment?.status || ride.payment_status || null
    });
  } catch (error) {
    console.error("ride-complete error:", error);
    return jsonError(res, 500, error.message || "Failed to complete trip");
  }
});

/* =========================================================
   ROUTE — CANCEL RIDE
========================================================= */
app.post("/api/rides/:rideId/cancel", async (req, res) => {
  try {
    const rideId = clean(req.params.rideId);
    const actorType = clean(req.body?.actor_type || req.body?.actorType || "system").toLowerCase();
    const actorId = clean(req.body?.actor_id || req.body?.actorId);
    const reason = clean(req.body?.reason || "Ride cancelled");

    if (!rideId) {
      return jsonError(res, 400, "Ride ID is required");
    }

    const ride = await getRideById(rideId);
    if (!ride) {
      return jsonError(res, 404, "Ride not found");
    }

    if (!canCancelRide(ride.status)) {
      return jsonError(res, 409, "Ride can no longer be cancelled", {
        current_status: ride.status
      });
    }

    if (actorType === "driver" && clean(ride.driver_id) && clean(ride.driver_id) !== actorId) {
      return jsonError(res, 403, "This ride is not assigned to that driver");
    }

    if (actorType === "rider" && clean(ride.rider_id) && clean(ride.rider_id) !== actorId) {
      return jsonError(res, 403, "This ride does not belong to that rider");
    }

    const updatedRide = await updateRide(rideId, {
      status: "cancelled",
      cancelled_at: new Date().toISOString(),
      cancellation_reason: reason,
      cancelled_by_type: actorType,
      cancelled_by_id: actorId || null
    });

    const mission = await getLatestMissionForRide(rideId);
    if (mission) {
      await closeMissionAsCancelled(mission.id);
    }

    const dispatch = await getLatestDispatchForRide(rideId);
    if (dispatch) {
      await closeDispatchAsCancelled(dispatch.id);
    }

    let updatedPayment = null;
    if (clean(ride.payment_id)) {
      updatedPayment = await updatePaymentRecord(ride.payment_id, {
        status: "cancelled",
        cancellation_reason: reason
      });
    }

    await logTripEvent({
      ride_id: rideId,
      driver_id: ride.driver_id,
      rider_id: ride.rider_id,
      event_type: "ride_cancelled",
      title: "Ride cancelled",
      description: reason,
      metadata: {
        actor_type: actorType,
        actor_id: actorId || null
      }
    });

    return jsonOk(res, {
      message: "Ride cancelled successfully",
      ride_id: updatedRide.id,
      status: updatedRide.status,
      cancellation_reason: updatedRide.cancellation_reason || reason,
      payment_status: updatedPayment?.status || ride.payment_status || null
    });
  } catch (error) {
    console.error("ride-cancel error:", error);
    return jsonError(res, 500, error.message || "Failed to cancel ride");
  }
});

/* =========================================================
   ROUTE — GET TRIP EVENTS
========================================================= */
app.get("/api/rides/:rideId/events", async (req, res) => {
  try {
    const rideId = clean(req.params.rideId);

    if (!rideId) {
      return jsonError(res, 400, "Ride ID is required");
    }

    if (!supabase) {
      return jsonError(res, 500, "Supabase not configured");
    }

    const { data, error } = await supabase
      .from("trip_events")
      .select("*")
      .eq("ride_id", rideId)
      .order("created_at", { ascending: true })
      .limit(500);

    if (error) throw error;

    return jsonOk(res, {
      ride_id: rideId,
      count: Array.isArray(data) ? data.length : 0,
      events: data || []
    });
  } catch (error) {
    console.error("ride-events error:", error);
    return jsonError(res, 500, error.message || "Failed to fetch trip events");
  }
});/* =========================================================
   HARVEY TAXI — CODE BLUE PHASE 9 (PART 5)
   DRIVER/RIDER DASHBOARD + LIVE OPS ENDPOINTS
========================================================= */

/* =========================================================
   DASHBOARD HELPERS
========================================================= */
function isActiveRideStatus(status = "") {
  const s = clean(status).toLowerCase();
  return [
    "awaiting_driver_acceptance",
    "driver_assigned",
    "driver_en_route",
    "driver_arrived",
    "in_progress"
  ].includes(s);
}

function isCompletedRideStatus(status = "") {
  const s = clean(status).toLowerCase();
  return ["completed"].includes(s);
}

function isCancelledRideStatus(status = "") {
  const s = clean(status).toLowerCase();
  return ["cancelled", "canceled"].includes(s);
}

async function getCurrentRideForDriver(driverId) {
  if (!supabase) throw new Error("Supabase not configured");

  const { data, error } = await supabase
    .from("rides")
    .select("*")
    .eq("driver_id", driverId)
    .order("updated_at", { ascending: false })
    .limit(25);

  if (error) throw error;

  const rows = Array.isArray(data) ? data : [];
  return rows.find((ride) => isActiveRideStatus(ride.status)) || null;
}

async function getCurrentRideForRider(riderId) {
  if (!supabase) throw new Error("Supabase not configured");

  const { data, error } = await supabase
    .from("rides")
    .select("*")
    .eq("rider_id", riderId)
    .order("updated_at", { ascending: false })
    .limit(25);

  if (error) throw error;

  const rows = Array.isArray(data) ? data : [];
  return rows.find((ride) => isActiveRideStatus(ride.status)) || null;
}

async function getRecentRidesForDriver(driverId, limit = 25) {
  if (!supabase) throw new Error("Supabase not configured");

  const { data, error } = await supabase
    .from("rides")
    .select("*")
    .eq("driver_id", driverId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

async function getRecentRidesForRider(riderId, limit = 25) {
  if (!supabase) throw new Error("Supabase not configured");

  const { data, error } = await supabase
    .from("rides")
    .select("*")
    .eq("rider_id", riderId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

async function getOpenMissionCountForDriver(driverId) {
  if (!supabase) throw new Error("Supabase not configured");

  const missions = await getDriverOpenMissions(driverId);
  return missions.length;
}

function summarizeRideSet(rides = []) {
  const summary = {
    total: 0,
    active: 0,
    completed: 0,
    cancelled: 0,
    gross_revenue: 0,
    driver_payout_total: 0,
    platform_revenue_total: 0
  };

  for (const ride of rides) {
    summary.total += 1;

    const status = clean(ride.status).toLowerCase();
    if (isActiveRideStatus(status)) summary.active += 1;
    if (isCompletedRideStatus(status)) summary.completed += 1;
    if (isCancelledRideStatus(status)) summary.cancelled += 1;

    summary.gross_revenue += Number(ride.final_fare || ride.estimated_fare || 0);
    summary.driver_payout_total += Number(ride.driver_payout || 0);
    summary.platform_revenue_total += Number(ride.platform_revenue || 0);
  }

  summary.gross_revenue = Number(summary.gross_revenue.toFixed(2));
  summary.driver_payout_total = Number(summary.driver_payout_total.toFixed(2));
  summary.platform_revenue_total = Number(summary.platform_revenue_total.toFixed(2));

  return summary;
}

async function getLatestDispatchForRideSafe(rideId) {
  try {
    return await getLatestDispatchForRide(rideId);
  } catch (error) {
    console.error("getLatestDispatchForRideSafe error:", error);
    return null;
  }
}

async function getLatestMissionForRideSafe(rideId) {
  try {
    return await getLatestMissionForRide(rideId);
  } catch (error) {
    console.error("getLatestMissionForRideSafe error:", error);
    return null;
  }
}

/* =========================================================
   ROUTE — DRIVER CURRENT RIDE
========================================================= */
app.get("/api/drivers/:driverId/current-ride", async (req, res) => {
  try {
    const driverId = clean(req.params.driverId);
    if (!driverId) {
      return jsonError(res, 400, "Driver ID is required");
    }

    const driver = await getDriverById(driverId);
    if (!driver) {
      return jsonError(res, 404, "Driver not found");
    }

    const ride = await getCurrentRideForDriver(driverId);

    if (!ride) {
      return jsonOk(res, {
        driver_id: driverId,
        has_current_ride: false,
        ride: null
      });
    }

    const dispatch = await getLatestDispatchForRideSafe(ride.id);
    const mission = await getLatestMissionForRideSafe(ride.id);

    return jsonOk(res, {
      driver_id: driverId,
      has_current_ride: true,
      ride,
      dispatch,
      mission
    });
  } catch (error) {
    console.error("driver-current-ride error:", error);
    return jsonError(res, 500, error.message || "Failed to fetch current driver ride");
  }
});

/* =========================================================
   ROUTE — DRIVER DASHBOARD SUMMARY
========================================================= */
app.get("/api/drivers/:driverId/dashboard", async (req, res) => {
  try {
    const driverId = clean(req.params.driverId);
    if (!driverId) {
      return jsonError(res, 400, "Driver ID is required");
    }

    const driver = await getDriverById(driverId);
    if (!driver) {
      return jsonError(res, 404, "Driver not found");
    }

    const rides = await getRecentRidesForDriver(driverId, 100);
    const currentRide = rides.find((ride) => isActiveRideStatus(ride.status)) || null;
    const openMissionCount = await getOpenMissionCountForDriver(driverId);
    const summary = summarizeRideSet(rides);

    return jsonOk(res, {
      driver: {
        id: driver.id,
        email: driver.email || null,
        name: driver.full_name || driver.name || null,
        driver_type: normalizeDriverType(driver.driver_type || driver.type || "human"),
        approval_status: getDriverApprovalStatus(driver) || null,
        online_status: getDriverOnlineState(driver) || null
      },
      summary,
      has_current_ride: !!currentRide,
      current_ride: currentRide,
      open_mission_count: openMissionCount,
      recent_rides: rides.slice(0, 10)
    });
  } catch (error) {
    console.error("driver-dashboard error:", error);
    return jsonError(res, 500, error.message || "Failed to fetch driver dashboard");
  }
});

/* =========================================================
   ROUTE — DRIVER RIDE HISTORY
========================================================= */
app.get("/api/drivers/:driverId/rides", async (req, res) => {
  try {
    const driverId = clean(req.params.driverId);
    if (!driverId) {
      return jsonError(res, 400, "Driver ID is required");
    }

    const driver = await getDriverById(driverId);
    if (!driver) {
      return jsonError(res, 404, "Driver not found");
    }

    const rides = await getRecentRidesForDriver(driverId, 100);

    return jsonOk(res, {
      driver_id: driverId,
      count: rides.length,
      rides
    });
  } catch (error) {
    console.error("driver-rides error:", error);
    return jsonError(res, 500, error.message || "Failed to fetch driver rides");
  }
});

/* =========================================================
   ROUTE — RIDER CURRENT RIDE
========================================================= */
app.get("/api/riders/:riderId/current-ride", async (req, res) => {
  try {
    const riderId = clean(req.params.riderId);
    if (!riderId) {
      return jsonError(res, 400, "Rider ID is required");
    }

    const rider = await getRiderById(riderId);
    if (!rider) {
      return jsonError(res, 404, "Rider not found");
    }

    const ride = await getCurrentRideForRider(riderId);

    if (!ride) {
      return jsonOk(res, {
        rider_id: riderId,
        has_current_ride: false,
        ride: null
      });
    }

    const dispatch = await getLatestDispatchForRideSafe(ride.id);
    const mission = await getLatestMissionForRideSafe(ride.id);

    return jsonOk(res, {
      rider_id: riderId,
      has_current_ride: true,
      ride,
      dispatch,
      mission
    });
  } catch (error) {
    console.error("rider-current-ride error:", error);
    return jsonError(res, 500, error.message || "Failed to fetch current rider ride");
  }
});

/* =========================================================
   ROUTE — RIDER DASHBOARD SUMMARY
========================================================= */
app.get("/api/riders/:riderId/dashboard", async (req, res) => {
  try {
    const riderId = clean(req.params.riderId);
    if (!riderId) {
      return jsonError(res, 400, "Rider ID is required");
    }

    const rider = await getRiderById(riderId);
    if (!rider) {
      return jsonError(res, 404, "Rider not found");
    }

    const rides = await getRecentRidesForRider(riderId, 100);
    const currentRide = rides.find((ride) => isActiveRideStatus(ride.status)) || null;
    const summary = summarizeRideSet(rides);

    return jsonOk(res, {
      rider: {
        id: rider.id,
        email: rider.email || null,
        name: rider.full_name || rider.name || null,
        approval_status: getRiderApprovalStatus(rider) || null
      },
      summary,
      has_current_ride: !!currentRide,
      current_ride: currentRide,
      recent_rides: rides.slice(0, 10)
    });
  } catch (error) {
    console.error("rider-dashboard error:", error);
    return jsonError(res, 500, error.message || "Failed to fetch rider dashboard");
  }
});

/* =========================================================
   ROUTE — PLATFORM LIVE STATS
========================================================= */
app.get("/api/admin/platform/stats", async (req, res) => {
  try {
    if (!supabase) {
      return jsonError(res, 500, "Supabase not configured");
    }

    const [ridesResult, driversResult, ridersResult, dispatchesResult, missionsResult] =
      await Promise.all([
        supabase.from("rides").select("*").order("created_at", { ascending: false }).limit(250),
        supabase.from("drivers").select("*").limit(250),
        supabase.from("riders").select("*").limit(250),
        supabase.from("dispatches").select("*").order("created_at", { ascending: false }).limit(250),
        supabase.from("missions").select("*").order("created_at", { ascending: false }).limit(250)
      ]);

    if (ridesResult.error) throw ridesResult.error;
    if (driversResult.error) throw driversResult.error;
    if (ridersResult.error) throw ridersResult.error;
    if (dispatchesResult.error) throw dispatchesResult.error;
    if (missionsResult.error) throw missionsResult.error;

    const rides = Array.isArray(ridesResult.data) ? ridesResult.data : [];
    const drivers = Array.isArray(driversResult.data) ? driversResult.data : [];
    const riders = Array.isArray(ridersResult.data) ? ridersResult.data : [];
    const dispatches = Array.isArray(dispatchesResult.data) ? dispatchesResult.data : [];
    const missions = Array.isArray(missionsResult.data) ? missionsResult.data : [];

    const rideSummary = summarizeRideSet(rides);

    const onlineDrivers = drivers.filter((driver) =>
      isDriverOnlineStatus(getDriverOnlineState(driver))
    ).length;

    const approvedDrivers = drivers.filter((driver) =>
      isDriverApprovedStatus(getDriverApprovalStatus(driver))
    ).length;

    const approvedRiders = riders.filter((rider) =>
      isApprovedStatus(getRiderApprovalStatus(rider))
    ).length;

    const activeDispatches = dispatches.filter((dispatch) =>
      ["pending", "offered", "awaiting_driver_response", "driver_assigned", "driver_en_route", "driver_arrived", "in_progress"]
        .includes(clean(dispatch.status).toLowerCase())
    ).length;

    const openMissions = missions.filter((mission) =>
      ["offered", "awaiting_response", "pending"].includes(
        clean(mission.status || mission.mission_status).toLowerCase()
      )
    ).length;

    return jsonOk(res, {
      platform: {
        started_at: SERVER_STARTED_AT,
        now: new Date().toISOString()
      },
      counts: {
        total_rides: rides.length,
        total_drivers: drivers.length,
        total_riders: riders.length,
        approved_drivers: approvedDrivers,
        online_drivers: onlineDrivers,
        approved_riders: approvedRiders,
        active_dispatches: activeDispatches,
        open_missions: openMissions
      },
      revenue: {
        gross_revenue: rideSummary.gross_revenue,
        driver_payout_total: rideSummary.driver_payout_total,
        platform_revenue_total: rideSummary.platform_revenue_total
      },
      ride_summary: rideSummary
    });
  } catch (error) {
    console.error("platform-stats error:", error);
    return jsonError(res, 500, error.message || "Failed to fetch platform stats");
  }
});

/* =========================================================
   ROUTE — ADMIN LIVE RIDES
========================================================= */
app.get("/api/admin/rides/live", async (req, res) => {
  try {
    if (!supabase) {
      return jsonError(res, 500, "Supabase not configured");
    }

    const { data, error } = await supabase
      .from("rides")
      .select("*")
      .order("updated_at", { ascending: false })
      .limit(200);

    if (error) throw error;

    const rides = Array.isArray(data) ? data : [];
    const liveRides = rides.filter((ride) => isActiveRideStatus(ride.status));

    return jsonOk(res, {
      count: liveRides.length,
      rides: liveRides
    });
  } catch (error) {
    console.error("admin-live-rides error:", error);
    return jsonError(res, 500, error.message || "Failed to fetch live rides");
  }
});

/* =========================================================
   ROUTE — ADMIN DISPATCH OVERVIEW
========================================================= */
app.get("/api/admin/dispatches/live", async (req, res) => {
  try {
    if (!supabase) {
      return jsonError(res, 500, "Supabase not configured");
    }

    const [dispatchesResult, missionsResult] = await Promise.all([
      supabase.from("dispatches").select("*").order("updated_at", { ascending: false }).limit(200),
      supabase.from("missions").select("*").order("updated_at", { ascending: false }).limit(200)
    ]);

    if (dispatchesResult.error) throw dispatchesResult.error;
    if (missionsResult.error) throw missionsResult.error;

    const dispatches = Array.isArray(dispatchesResult.data) ? dispatchesResult.data : [];
    const missions = Array.isArray(missionsResult.data) ? missionsResult.data : [];

    const liveDispatches = dispatches.filter((dispatch) =>
      ["pending", "offered", "awaiting_driver_response", "driver_assigned", "driver_en_route", "driver_arrived", "in_progress"]
        .includes(clean(dispatch.status).toLowerCase())
    );

    const liveMissions = missions.filter((mission) =>
      ["offered", "awaiting_response", "pending", "accepted", "driver_en_route", "driver_arrived", "in_progress"]
        .includes(clean(mission.status || mission.mission_status).toLowerCase())
    );

    return jsonOk(res, {
      active_dispatch_count: liveDispatches.length,
      active_mission_count: liveMissions.length,
      dispatches: liveDispatches,
      missions: liveMissions
    });
  } catch (error) {
    console.error("admin-live-dispatches error:", error);
    return jsonError(res, 500, error.message || "Failed to fetch dispatch overview");
  }
});

/* =========================================================
   ROUTE — ADMIN DRIVER OPERATIONS SNAPSHOT
========================================================= */
app.get("/api/admin/drivers/ops", async (req, res) => {
  try {
    if (!supabase) {
      return jsonError(res, 500, "Supabase not configured");
    }

    const { data, error } = await supabase
      .from("drivers")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(250);

    if (error) throw error;

    const drivers = Array.isArray(data) ? data : [];

    const snapshot = drivers.map((driver) => ({
      id: driver.id,
      email: driver.email || null,
      name: driver.full_name || driver.name || null,
      driver_type: normalizeDriverType(driver.driver_type || driver.type || "human"),
      approval_status: getDriverApprovalStatus(driver) || null,
      online_status: getDriverOnlineState(driver) || null,
      created_at: driver.created_at || null
    }));

    return jsonOk(res, {
      count: snapshot.length,
      drivers: snapshot
    });
  } catch (error) {
    console.error("admin-driver-ops error:", error);
    return jsonError(res, 500, error.message || "Failed to fetch driver ops snapshot");
  }
});

/* =========================================================
   ROUTE — ADMIN RIDER OPERATIONS SNAPSHOT
========================================================= */
app.get("/api/admin/riders/ops", async (req, res) => {
  try {
    if (!supabase) {
      return jsonError(res, 500, "Supabase not configured");
    }

    const { data, error } = await supabase
      .from("riders")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(250);

    if (error) throw error;

    const riders = Array.isArray(data) ? data : [];

    const snapshot = riders.map((rider) => ({
      id: rider.id,
      email: rider.email || null,
      name: rider.full_name || rider.name || null,
      approval_status: getRiderApprovalStatus(rider) || null,
      created_at: rider.created_at || null
    }));

    return jsonOk(res, {
      count: snapshot.length,
      riders: snapshot
    });
  } catch (error) {
    console.error("admin-rider-ops error:", error);
    return jsonError(res, 500, error.message || "Failed to fetch rider ops snapshot");
  }
});/* =========================================================
   HARVEY TAXI — CODE BLUE PHASE 9 (PART 6)
   AI SUPPORT + PAGE-AWARE FALLBACK + SUPPORT INTELLIGENCE
========================================================= */

/* =========================================================
   AI SUPPORT CONFIG
========================================================= */
const OPENAI_SUPPORT_MODEL =
  clean(process.env.OPENAI_SUPPORT_MODEL || "gpt-4.1-mini");

const ENABLE_AI_SUPPORT =
  clean(process.env.ENABLE_AI_SUPPORT || "true").toLowerCase() !== "false";

/* =========================================================
   PAGE CONTEXT NORMALIZATION
========================================================= */
function normalizePage(page = "") {
  const value = clean(page).toLowerCase();

  if (!value) return "general";
  if (["home", "index", "landing"].includes(value)) return "general";
  if (["rider", "rider-signup", "rider-dashboard"].includes(value)) return "rider";
  if (["driver", "driver-signup", "driver-dashboard"].includes(value)) return "driver";
  if (["request", "request-ride", "ride"].includes(value)) return "request";
  if (["support", "help", "faq"].includes(value)) return "support";

  return value;
}

function detectPageFromPath(pathname = "") {
  const path = clean(pathname).toLowerCase();

  if (!path) return "general";
  if (path.includes("rider-signup")) return "rider";
  if (path.includes("rider-dashboard")) return "rider";
  if (path.includes("driver-signup")) return "driver";
  if (path.includes("driver-dashboard")) return "driver";
  if (path.includes("request-ride")) return "request";
  if (path.includes("support")) return "support";

  return "general";
}

/* =========================================================
   SUPPORT KNOWLEDGE
========================================================= */
function getSupportSystemPrompt(page = "general") {
  const context = normalizePage(page);

  return `
You are Harvey AI, the support assistant for Harvey Taxi Service LLC and Harvey Assistance Foundation.

Your job is to help riders, drivers, and support visitors with accurate, calm, trustworthy answers.

Core facts:
- Harvey Taxi Service LLC is a ride platform with human-driver rides and a clearly labeled autonomous pilot direction for the future.
- Riders must be approved before requesting rides when rider approval enforcement is enabled.
- Payment authorization may be required before dispatch.
- Drivers must complete onboarding, verification, and approval before going active.
- Driver missions show trip details before acceptance.
- Harvey Assistance Foundation may help explain nonprofit mission/support questions, but do not invent legal promises or grant awards.
- Harvey Taxi is not an emergency service. In emergencies, the user should call 911.
- Never claim a ride is booked, a driver is assigned, or a refund is issued unless the system explicitly confirms that.
- Do not reveal internal secrets, keys, passwords, or private system configuration.
- Keep answers practical and easy to understand.
- If the user asks something outside your certainty, be honest and direct them to official support.

Current page context: ${context}

Response style:
- clear
- helpful
- concise
- trustworthy
- mission-aware
- no hype
`;
}

function getFallbackReply(message, page = "general") {
  const text = clean(message).toLowerCase();
  const context = normalizePage(page);

  if (!text) {
    return "Tell me what you need help with, and I’ll point you in the right direction.";
  }

  if (
    text.includes("emergency") ||
    text.includes("911") ||
    text.includes("unsafe") ||
    text.includes("danger")
  ) {
    return "Harvey Taxi is not an emergency service. If this is an emergency or you are in immediate danger, call 911 right away.";
  }

  if (text.includes("ride") || text.includes("book") || text.includes("request")) {
    return "You can request a ride after your rider account is approved and your payment method is authorized, if the payment gate is enabled.";
  }

  if (text.includes("rider") && (text.includes("approved") || text.includes("approval") || text.includes("status"))) {
    return "Rider access depends on your approval status. If your account is not approved yet, ride requests can be blocked until approval is completed.";
  }

  if (text.includes("driver") && (text.includes("signup") || text.includes("apply") || text.includes("become"))) {
    return "To become a driver, complete driver signup, submit your required details and documents, finish verification, and wait for approval before going active.";
  }

  if (text.includes("driver") && (text.includes("mission") || text.includes("accept"))) {
    return "Drivers receive mission offers with trip details before acceptance. Once a mission is accepted, the ride can move through en route, arrived, and in-progress status updates.";
  }

  if (text.includes("payment") || text.includes("card") || text.includes("authorize")) {
    return "Harvey Taxi can use payment authorization before dispatch so the trip can move forward smoothly once a driver is assigned.";
  }

  if (text.includes("autonomous") || text.includes("pilot") || text.includes("av")) {
    return "Autonomous service is treated as a pilot direction and should stay clearly labeled so riders understand the trip mode they are requesting.";
  }

  if (text.includes("foundation") || text.includes("nonprofit") || text.includes("assistance")) {
    return "Harvey Assistance Foundation questions can be answered at a general support level, but official funding, grant, or legal determinations should come from your formal foundation records and support process.";
  }

  if (text.includes("refund") || text.includes("charge")) {
    return "For billing or refund concerns, support should review the ride status, payment status, and cancellation details before making a final decision.";
  }

  if (context === "driver") {
    return "I can help with driver signup, verification, approval, mission flow, ride status, and platform support.";
  }

  if (context === "rider") {
    return "I can help with rider approval, ride access, payment authorization, trip status, and support questions.";
  }

  if (context === "request") {
    return "I can help with ride requests, approval requirements, payment authorization, and what happens after dispatch starts.";
  }

  return "I can help with rides, driver signup, rider approval, payment questions, autonomous pilot information, and platform support.";
}

/* =========================================================
   SUPPORT CONTEXT HELPERS
========================================================= */
async function getCompactRideContext(rideId) {
  try {
    if (!clean(rideId)) return null;
    const ride = await getRideById(rideId);
    if (!ride) return null;

    return {
      ride_id: ride.id,
      status: ride.status || null,
      requested_mode: ride.requested_mode || null,
      pickup_address: ride.pickup_address || null,
      dropoff_address: ride.dropoff_address || null,
      estimated_fare: ride.estimated_fare || null,
      final_fare: ride.final_fare || null,
      payment_status: ride.payment_status || null,
      rider_id: ride.rider_id || null,
      driver_id: ride.driver_id || null
    };
  } catch (error) {
    console.error("getCompactRideContext error:", error);
    return null;
  }
}

async function getCompactRiderContext(riderId) {
  try {
    if (!clean(riderId)) return null;
    const rider = await getRiderById(riderId);
    if (!rider) return null;

    return {
      rider_id: rider.id,
      email: rider.email || null,
      name: rider.full_name || rider.name || null,
      approval_status: getRiderApprovalStatus(rider) || null
    };
  } catch (error) {
    console.error("getCompactRiderContext error:", error);
    return null;
  }
}

async function getCompactDriverContext(driverId) {
  try {
    if (!clean(driverId)) return null;
    const driver = await getDriverById(driverId);
    if (!driver) return null;

    return {
      driver_id: driver.id,
      email: driver.email || null,
      name: driver.full_name || driver.name || null,
      approval_status: getDriverApprovalStatus(driver) || null,
      online_status: getDriverOnlineState(driver) || null,
      driver_type: normalizeDriverType(driver.driver_type || driver.type || "human")
    };
  } catch (error) {
    console.error("getCompactDriverContext error:", error);
    return null;
  }
}

/* =========================================================
   OPENAI SUPPORT CALL
========================================================= */
async function generateAIReply({
  message,
  page,
  riderContext = null,
  driverContext = null,
  rideContext = null
}) {
  if (!ENABLE_AI_SUPPORT || !openai) {
    return null;
  }

  const userMessage = clean(message);
  if (!userMessage) {
    return null;
  }

  const contextPayload = {
    page: normalizePage(page),
    rider: riderContext,
    driver: driverContext,
    ride: rideContext
  };

  try {
    const response = await openai.chat.completions.create({
      model: OPENAI_SUPPORT_MODEL,
      temperature: 0.3,
      messages: [
        {
          role: "system",
          content: getSupportSystemPrompt(page)
        },
        {
          role: "system",
          content: `Relevant platform context:\n${JSON.stringify(contextPayload, null, 2)}`
        },
        {
          role: "user",
          content: userMessage
        }
      ]
    });

    const content =
      response?.choices?.[0]?.message?.content ||
      "";

    return clean(content) || null;
  } catch (error) {
    console.error("generateAIReply error:", error);
    return null;
  }
}

/* =========================================================
   SUPPORT RESPONSE SHAPER
========================================================= */
function buildSupportResponse({
  reply,
  source = "fallback",
  page = "general",
  riderContext = null,
  driverContext = null,
  rideContext = null
}) {
  return {
    ok: true,
    reply: clean(reply),
    source,
    page: normalizePage(page),
    context: {
      rider: riderContext,
      driver: driverContext,
      ride: rideContext
    }
  };
}

/* =========================================================
   ROUTE — AI SUPPORT
========================================================= */
app.post("/api/ai/support", async (req, res) => {
  try {
    const rawMessage = clean(req.body?.message || req.body?.prompt || "");
    const page =
      normalizePage(req.body?.page) ||
      detectPageFromPath(req.body?.pathname || req.body?.path || "");
    const riderId = clean(req.body?.rider_id || req.body?.riderId);
    const driverId = clean(req.body?.driver_id || req.body?.driverId);
    const rideId = clean(req.body?.ride_id || req.body?.rideId);

    if (!rawMessage) {
      return jsonError(res, 400, "Message is required");
    }

    const [riderContext, driverContext, rideContext] = await Promise.all([
      getCompactRiderContext(riderId),
      getCompactDriverContext(driverId),
      getCompactRideContext(rideId)
    ]);

    const aiReply = await generateAIReply({
      message: rawMessage,
      page,
      riderContext,
      driverContext,
      rideContext
    });

    if (aiReply) {
      return jsonOk(res, buildSupportResponse({
        reply: aiReply,
        source: "openai",
        page,
        riderContext,
        driverContext,
        rideContext
      }));
    }

    const fallback = getFallbackReply(rawMessage, page);

    return jsonOk(res, buildSupportResponse({
      reply: fallback,
      source: "fallback",
      page,
      riderContext,
      driverContext,
      rideContext
    }));
  } catch (error) {
    console.error("ai-support error:", error);

    const fallback = getFallbackReply(req.body?.message || "", req.body?.page || "general");

    return res.status(200).json({
      ok: true,
      reply: fallback,
      source: "fallback_error_recovery",
      page: normalizePage(req.body?.page || "general"),
      error: "AI support temporarily fell back to local support mode"
    });
  }
});

/* =========================================================
   ROUTE — SUPPORT HEALTH
========================================================= */
app.get("/api/ai/support/health", async (req, res) => {
  try {
    return jsonOk(res, {
      ai_support_enabled: ENABLE_AI_SUPPORT,
      openai_client_ready: !!openai,
      support_model: OPENAI_SUPPORT_MODEL,
      fallback_ready: true
    });
  } catch (error) {
    console.error("ai-support-health error:", error);
    return jsonError(res, 500, error.message || "Failed to fetch AI support health");
  }
});

/* =========================================================
   ROUTE — SUPPORT FALLBACK TEST
========================================================= */
app.post("/api/ai/support/fallback", async (req, res) => {
  try {
    const message = clean(req.body?.message || "");
    const page = normalizePage(req.body?.page || "general");

    return jsonOk(res, {
      page,
      reply: getFallbackReply(message, page),
      source: "fallback"
    });
  } catch (error) {
    console.error("ai-support-fallback error:", error);
    return jsonError(res, 500, error.message || "Failed to fetch fallback support reply");
  }
});/* =========================================================
   HARVEY TAXI — CODE BLUE PHASE 9 (PART 7)
   ADMIN CONTROLS + APPROVALS + AUDIT LOGGING
========================================================= */

/* =========================================================
   ADMIN CONFIG
========================================================= */
const ADMIN_EMAIL = clean(process.env.ADMIN_EMAIL || process.env.SUPPORT_ADMIN_EMAIL || "");
const ADMIN_PASSWORD = clean(process.env.ADMIN_PASSWORD || "");

/* =========================================================
   ADMIN HELPERS
========================================================= */
function isAdminAuthorized(req) {
  const headerEmail = clean(req.headers["x-admin-email"]);
  const headerPassword = clean(req.headers["x-admin-password"]);

  const bodyEmail = clean(req.body?.admin_email || req.body?.adminEmail);
  const bodyPassword = clean(req.body?.admin_password || req.body?.adminPassword);

  const providedEmail = headerEmail || bodyEmail;
  const providedPassword = headerPassword || bodyPassword;

  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
    return {
      ok: false,
      reason: "Admin credentials are not configured in environment"
    };
  }

  if (
    clean(providedEmail).toLowerCase() !== ADMIN_EMAIL.toLowerCase() ||
    providedPassword !== ADMIN_PASSWORD
  ) {
    return {
      ok: false,
      reason: "Unauthorized admin request"
    };
  }

  return {
    ok: true,
    email: ADMIN_EMAIL
  };
}

async function requireAdmin(req, res) {
  const auth = isAdminAuthorized(req);
  if (!auth.ok) {
    jsonError(res, 401, auth.reason || "Unauthorized");
    return null;
  }
  return auth;
}

async function createAdminLog({
  action,
  admin_email,
  target_type = null,
  target_id = null,
  ride_id = null,
  rider_id = null,
  driver_id = null,
  details = {}
}) {
  if (!supabase) return null;

  const payload = {
    id: crypto.randomUUID(),
    action: clean(action) || "admin_action",
    admin_email: clean(admin_email) || null,
    target_type: clean(target_type) || null,
    target_id: clean(target_id) || null,
    ride_id: clean(ride_id) || null,
    rider_id: clean(rider_id) || null,
    driver_id: clean(driver_id) || null,
    details: details || {},
    created_at: new Date().toISOString()
  };

  try {
    const { data, error } = await supabase
      .from("admin_logs")
      .insert(payload)
      .select()
      .single();

    if (error) {
      console.error("admin log insert error:", error);
      return null;
    }

    return data;
  } catch (error) {
    console.error("admin log crash:", error);
    return null;
  }
}

async function updateRider(riderId, updates = {}) {
  if (!supabase) throw new Error("Supabase not configured");

  const payload = {
    ...updates,
    updated_at: new Date().toISOString()
  };

  const { data, error } = await supabase
    .from("riders")
    .update(payload)
    .eq("id", riderId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

async function updateDriver(driverId, updates = {}) {
  if (!supabase) throw new Error("Supabase not configured");

  const payload = {
    ...updates,
    updated_at: new Date().toISOString()
  };

  const { data, error } = await supabase
    .from("drivers")
    .update(payload)
    .eq("id", driverId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

async function expireMission(missionId, reason = "expired_by_admin") {
  if (!clean(missionId)) return null;
  return await updateMission(missionId, {
    status: "expired",
    mission_status: "expired",
    expired_at: new Date().toISOString(),
    expiration_reason: reason
  });
}

/* =========================================================
   ROUTE — ADMIN HEALTH / AUTH TEST
========================================================= */
app.get("/api/admin/health", async (req, res) => {
  try {
    const auth = isAdminAuthorized(req);

    return jsonOk(res, {
      admin_env_configured: !!(ADMIN_EMAIL && ADMIN_PASSWORD),
      authorized: auth.ok,
      reason: auth.ok ? null : auth.reason
    });
  } catch (error) {
    console.error("admin-health error:", error);
    return jsonError(res, 500, error.message || "Failed to fetch admin health");
  }
});

/* =========================================================
   ROUTE — ADMIN APPROVE RIDER
========================================================= */
app.post("/api/admin/riders/:riderId/approve", async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const riderId = clean(req.params.riderId);
    if (!riderId) {
      return jsonError(res, 400, "Rider ID is required");
    }

    const rider = await getRiderById(riderId);
    if (!rider) {
      return jsonError(res, 404, "Rider not found");
    }

    const updatedRider = await updateRider(riderId, {
      approval_status: "approved",
      status: "approved",
      access_status: "approved",
      approved_at: new Date().toISOString(),
      approval_note: clean(req.body?.note || req.body?.approval_note || "Approved by admin")
    });

    await createAdminLog({
      action: "approve_rider",
      admin_email: admin.email,
      target_type: "rider",
      target_id: riderId,
      rider_id: riderId,
      details: {
        previous_status: getRiderApprovalStatus(rider) || null,
        new_status: "approved"
      }
    });

    return jsonOk(res, {
      message: "Rider approved successfully",
      rider: updatedRider
    });
  } catch (error) {
    console.error("admin-approve-rider error:", error);
    return jsonError(res, 500, error.message || "Failed to approve rider");
  }
});

/* =========================================================
   ROUTE — ADMIN REJECT RIDER
========================================================= */
app.post("/api/admin/riders/:riderId/reject", async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const riderId = clean(req.params.riderId);
    const reason = clean(req.body?.reason || "Rejected by admin");

    if (!riderId) {
      return jsonError(res, 400, "Rider ID is required");
    }

    const rider = await getRiderById(riderId);
    if (!rider) {
      return jsonError(res, 404, "Rider not found");
    }

    const updatedRider = await updateRider(riderId, {
      approval_status: "rejected",
      status: "rejected",
      access_status: "rejected",
      rejected_at: new Date().toISOString(),
      rejection_reason: reason
    });

    await createAdminLog({
      action: "reject_rider",
      admin_email: admin.email,
      target_type: "rider",
      target_id: riderId,
      rider_id: riderId,
      details: {
        previous_status: getRiderApprovalStatus(rider) || null,
        new_status: "rejected",
        reason
      }
    });

    return jsonOk(res, {
      message: "Rider rejected successfully",
      rider: updatedRider
    });
  } catch (error) {
    console.error("admin-reject-rider error:", error);
    return jsonError(res, 500, error.message || "Failed to reject rider");
  }
});

/* =========================================================
   ROUTE — ADMIN APPROVE DRIVER
========================================================= */
app.post("/api/admin/drivers/:driverId/approve", async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const driverId = clean(req.params.driverId);
    if (!driverId) {
      return jsonError(res, 400, "Driver ID is required");
    }

    const driver = await getDriverById(driverId);
    if (!driver) {
      return jsonError(res, 404, "Driver not found");
    }

    const updatedDriver = await updateDriver(driverId, {
      approval_status: "approved",
      status: "approved",
      access_status: "approved",
      approved_at: new Date().toISOString(),
      approval_note: clean(req.body?.note || req.body?.approval_note || "Approved by admin")
    });

    await createAdminLog({
      action: "approve_driver",
      admin_email: admin.email,
      target_type: "driver",
      target_id: driverId,
      driver_id: driverId,
      details: {
        previous_status: getDriverApprovalStatus(driver) || null,
        new_status: "approved"
      }
    });

    return jsonOk(res, {
      message: "Driver approved successfully",
      driver: updatedDriver
    });
  } catch (error) {
    console.error("admin-approve-driver error:", error);
    return jsonError(res, 500, error.message || "Failed to approve driver");
  }
});

/* =========================================================
   ROUTE — ADMIN REJECT DRIVER
========================================================= */
app.post("/api/admin/drivers/:driverId/reject", async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const driverId = clean(req.params.driverId);
    const reason = clean(req.body?.reason || "Rejected by admin");

    if (!driverId) {
      return jsonError(res, 400, "Driver ID is required");
    }

    const driver = await getDriverById(driverId);
    if (!driver) {
      return jsonError(res, 404, "Driver not found");
    }

    const updatedDriver = await updateDriver(driverId, {
      approval_status: "rejected",
      status: "rejected",
      access_status: "rejected",
      rejected_at: new Date().toISOString(),
      rejection_reason: reason,
      online_status: "offline"
    });

    await createAdminLog({
      action: "reject_driver",
      admin_email: admin.email,
      target_type: "driver",
      target_id: driverId,
      driver_id: driverId,
      details: {
        previous_status: getDriverApprovalStatus(driver) || null,
        new_status: "rejected",
        reason
      }
    });

    return jsonOk(res, {
      message: "Driver rejected successfully",
      driver: updatedDriver
    });
  } catch (error) {
    console.error("admin-reject-driver error:", error);
    return jsonError(res, 500, error.message || "Failed to reject driver");
  }
});

/* =========================================================
   ROUTE — DRIVER SET ONLINE STATUS
========================================================= */
app.post("/api/drivers/:driverId/status", async (req, res) => {
  try {
    const driverId = clean(req.params.driverId);
    const nextStatus = clean(req.body?.online_status || req.body?.status || "offline").toLowerCase();

    if (!driverId) {
      return jsonError(res, 400, "Driver ID is required");
    }

    const driver = await getDriverById(driverId);
    if (!driver) {
      return jsonError(res, 404, "Driver not found");
    }

    const allowed = driverCanReceiveMission(driver);
    if (!allowed.ok && nextStatus === "online") {
      return jsonError(res, 403, "Driver is not eligible to go online", {
        reason: allowed.reason || "Driver is not approved or available"
      });
    }

    const updatedDriver = await updateDriver(driverId, {
      online_status: nextStatus,
      availability_status: nextStatus,
      last_seen_at: new Date().toISOString()
    });

    return jsonOk(res, {
      message: "Driver status updated successfully",
      driver_id: driverId,
      online_status: updatedDriver.online_status || nextStatus
    });
  } catch (error) {
    console.error("driver-status-update error:", error);
    return jsonError(res, 500, error.message || "Failed to update driver status");
  }
});

/* =========================================================
   ROUTE — ADMIN CANCEL RIDE
========================================================= */
app.post("/api/admin/rides/:rideId/cancel", async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const rideId = clean(req.params.rideId);
    const reason = clean(req.body?.reason || "Cancelled by admin");

    if (!rideId) {
      return jsonError(res, 400, "Ride ID is required");
    }

    const ride = await getRideById(rideId);
    if (!ride) {
      return jsonError(res, 404, "Ride not found");
    }

    const updatedRide = await updateRide(rideId, {
      status: "cancelled",
      cancelled_at: new Date().toISOString(),
      cancellation_reason: reason,
      cancelled_by_type: "admin",
      cancelled_by_id: admin.email
    });

    const mission = await getLatestMissionForRide(rideId);
    if (mission) {
      await closeMissionAsCancelled(mission.id);
    }

    const dispatch = await getLatestDispatchForRide(rideId);
    if (dispatch) {
      await closeDispatchAsCancelled(dispatch.id);
    }

    if (clean(ride.payment_id)) {
      await updatePaymentRecord(ride.payment_id, {
        status: "cancelled",
        cancellation_reason: reason
      });
    }

    await logTripEvent({
      ride_id: rideId,
      driver_id: ride.driver_id || null,
      rider_id: ride.rider_id || null,
      event_type: "ride_cancelled_by_admin",
      title: "Ride cancelled by admin",
      description: reason,
      metadata: {
        admin_email: admin.email
      }
    });

    await createAdminLog({
      action: "cancel_ride",
      admin_email: admin.email,
      target_type: "ride",
      target_id: rideId,
      ride_id: rideId,
      rider_id: ride.rider_id || null,
      driver_id: ride.driver_id || null,
      details: {
        reason
      }
    });

    return jsonOk(res, {
      message: "Ride cancelled by admin successfully",
      ride: updatedRide
    });
  } catch (error) {
    console.error("admin-cancel-ride error:", error);
    return jsonError(res, 500, error.message || "Failed to cancel ride");
  }
});

/* =========================================================
   ROUTE — ADMIN RETRY DISPATCH
========================================================= */
app.post("/api/admin/rides/:rideId/retry-dispatch", async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const rideId = clean(req.params.rideId);
    if (!rideId) {
      return jsonError(res, 400, "Ride ID is required");
    }

    const ride = await getRideById(rideId);
    if (!ride) {
      return jsonError(res, 404, "Ride not found");
    }

    const activeMission = await getLatestMissionForRide(rideId);
    if (
      activeMission &&
      ["offered", "awaiting_response", "pending"].includes(
        clean(activeMission.status || activeMission.mission_status).toLowerCase()
      )
    ) {
      await expireMission(activeMission.id, "expired_by_admin_retry");
    }

    const latestDispatch = await getLatestDispatchForRide(rideId);

    if (latestDispatch) {
      await updateDispatch(latestDispatch.id, {
        status: "pending",
        driver_id: null,
        attempt_number: Number(latestDispatch.attempt_number || 0) + 1,
        expires_at: null
      });
    }

    await updateRide(rideId, {
      status: "awaiting_driver_acceptance",
      driver_id: null
    });

    const result = await offerRideToNextDriver(rideId);

    await createAdminLog({
      action: "retry_dispatch",
      admin_email: admin.email,
      target_type: "ride",
      target_id: rideId,
      ride_id: rideId,
      rider_id: ride.rider_id || null,
      driver_id: null,
      details: {
        result_ok: !!result.ok,
        result_reason: result.reason || null
      }
    });

    if (!result.ok) {
      return jsonError(res, 409, result.reason || "Unable to retry dispatch");
    }

    return jsonOk(res, {
      message: "Dispatch retried successfully",
      ride_id: result.ride.id,
      dispatch_id: result.dispatch.id,
      mission_id: result.mission.id,
      driver_id: result.driver.id,
      offer_expires_at: result.mission.offer_expires_at
    });
  } catch (error) {
    console.error("admin-retry-dispatch error:", error);
    return jsonError(res, 500, error.message || "Failed to retry dispatch");
  }
});

/* =========================================================
   ROUTE — ADMIN LOGS
========================================================= */
app.get("/api/admin/logs", async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    if (!supabase) {
      return jsonError(res, 500, "Supabase not configured");
    }

    const { data, error } = await supabase
      .from("admin_logs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(250);

    if (error) throw error;

    return jsonOk(res, {
      count: Array.isArray(data) ? data.length : 0,
      logs: data || []
    });
  } catch (error) {
    console.error("admin-logs error:", error);
    return jsonError(res, 500, error.message || "Failed to fetch admin logs");
  }
});/* =========================================================
   HARVEY TAXI — CODE BLUE PHASE 9 (PART 8)
   COMMUNICATIONS + SMS + EMAIL + NOTIFICATION HELPERS
========================================================= */

/* =========================================================
   COMMUNICATION CONFIG
========================================================= */
const ENABLE_REAL_SMS =
  clean(process.env.ENABLE_REAL_SMS || "false").toLowerCase() === "true";

const ENABLE_REAL_EMAIL =
  clean(process.env.ENABLE_REAL_EMAIL || "false").toLowerCase() === "true";

const TWILIO_FROM_NUMBER =
  clean(process.env.TWILIO_PHONE_NUMBER) ||
  clean(process.env.TWILIO_FROM_NUMBER);

const SUPPORT_FROM_EMAIL =
  clean(process.env.SUPPORT_FROM_EMAIL) ||
  clean(process.env.SENDGRID_FROM_EMAIL) ||
  clean(process.env.EMAIL_FROM) ||
  clean(process.env.SMTP_FROM) ||
  ADMIN_EMAIL ||
  "support@harveytaxiservice.com";

/* OPTIONAL EMAIL SDK */
let nodemailer = null;
try { nodemailer = require("nodemailer"); } catch (e) {}

const SMTP_HOST = clean(process.env.SMTP_HOST);
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_USER = clean(process.env.SMTP_USER);
const SMTP_PASS = clean(process.env.SMTP_PASS);

let smtpTransport = null;
if (ENABLE_REAL_EMAIL && nodemailer && SMTP_HOST && SMTP_USER && SMTP_PASS) {
  try {
    smtpTransport = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465,
      auth: {
        user: SMTP_USER,
        pass: SMTP_PASS
      }
    });
  } catch (error) {
    console.error("SMTP transport init error:", error);
  }
}

/* =========================================================
   COMMUNICATION HELPERS
========================================================= */
function cleanPhone(value = "") {
  return clean(value).replace(/[^\d+]/g, "");
}

function maskPhone(value = "") {
  const v = cleanPhone(value);
  if (!v) return null;
  if (v.length <= 4) return "****";
  return `${v.slice(0, 2)}******${v.slice(-2)}`;
}

function maskEmail(value = "") {
  const v = clean(value);
  if (!v || !v.includes("@")) return null;
  const [name, domain] = v.split("@");
  const safeName =
    name.length <= 2 ? `${name[0] || "*"}*` : `${name.slice(0, 2)}***`;
  return `${safeName}@${domain}`;
}

function buildNotificationResult({
  ok,
  channel,
  mode,
  to = null,
  message = null,
  provider = null,
  error = null,
  meta = {}
}) {
  return {
    ok: !!ok,
    channel,
    mode,
    to,
    provider,
    message,
    error: error ? clean(error) : null,
    meta: meta || {}
  };
}

/* =========================================================
   NOTIFICATION LOGGING
========================================================= */
async function logNotification({
  channel,
  notification_type,
  recipient_role = null,
  recipient_id = null,
  ride_id = null,
  mission_id = null,
  dispatch_id = null,
  destination = null,
  message = null,
  status = "queued",
  provider = null,
  metadata = {}
}) {
  if (!supabase) return null;

  const payload = {
    id: crypto.randomUUID(),
    channel: clean(channel) || "unknown",
    notification_type: clean(notification_type) || "general",
    recipient_role: clean(recipient_role) || null,
    recipient_id: clean(recipient_id) || null,
    ride_id: clean(ride_id) || null,
    mission_id: clean(mission_id) || null,
    dispatch_id: clean(dispatch_id) || null,
    destination: clean(destination) || null,
    message: clean(message) || null,
    status: clean(status) || "queued",
    provider: clean(provider) || null,
    metadata: metadata || {},
    created_at: new Date().toISOString()
  };

  try {
    const { data, error } = await supabase
      .from("notification_logs")
      .insert(payload)
      .select()
      .single();

    if (error) {
      console.error("notification log insert error:", error);
      return null;
    }

    return data;
  } catch (error) {
    console.error("notification log crash:", error);
    return null;
  }
}

/* =========================================================
   SMS SENDER
========================================================= */
async function sendSmsMessage({
  to,
  body,
  notification_type = "general",
  recipient_role = null,
  recipient_id = null,
  ride_id = null,
  mission_id = null,
  dispatch_id = null
}) {
  const phone = cleanPhone(to);
  const text = clean(body);

  if (!phone || !text) {
    return buildNotificationResult({
      ok: false,
      channel: "sms",
      mode: "invalid",
      to: maskPhone(phone),
      error: "Missing phone or message body"
    });
  }

  if (!ENABLE_REAL_SMS || !smsClient || !TWILIO_FROM_NUMBER) {
    await logNotification({
      channel: "sms",
      notification_type,
      recipient_role,
      recipient_id,
      ride_id,
      mission_id,
      dispatch_id,
      destination: phone,
      message: text,
      status: "mocked",
      provider: "twilio_mock",
      metadata: {
        reason: "Real SMS disabled or Twilio not configured"
      }
    });

    return buildNotificationResult({
      ok: true,
      channel: "sms",
      mode: "mock",
      to: maskPhone(phone),
      provider: "twilio_mock",
      message: text
    });
  }

  try {
    const result = await smsClient.messages.create({
      from: TWILIO_FROM_NUMBER,
      to: phone,
      body: text
    });

    await logNotification({
      channel: "sms",
      notification_type,
      recipient_role,
      recipient_id,
      ride_id,
      mission_id,
      dispatch_id,
      destination: phone,
      message: text,
      status: "sent",
      provider: "twilio",
      metadata: {
        sid: result.sid || null
      }
    });

    return buildNotificationResult({
      ok: true,
      channel: "sms",
      mode: "live",
      to: maskPhone(phone),
      provider: "twilio",
      message: text,
      meta: {
        sid: result.sid || null
      }
    });
  } catch (error) {
    await logNotification({
      channel: "sms",
      notification_type,
      recipient_role,
      recipient_id,
      ride_id,
      mission_id,
      dispatch_id,
      destination: phone,
      message: text,
      status: "failed",
      provider: "twilio",
      metadata: {
        error: error.message || "SMS send failed"
      }
    });

    return buildNotificationResult({
      ok: false,
      channel: "sms",
      mode: "live",
      to: maskPhone(phone),
      provider: "twilio",
      error: error.message || "SMS send failed"
    });
  }
}

/* =========================================================
   EMAIL SENDER
========================================================= */
async function sendEmailMessage({
  to,
  subject,
  text,
  html = null,
  notification_type = "general",
  recipient_role = null,
  recipient_id = null,
  ride_id = null,
  mission_id = null,
  dispatch_id = null
}) {
  const email = clean(to);
  const safeSubject = clean(subject);
  const safeText = clean(text);

  if (!email || !safeSubject || !safeText) {
    return buildNotificationResult({
      ok: false,
      channel: "email",
      mode: "invalid",
      to: maskEmail(email),
      error: "Missing email, subject, or body"
    });
  }

  if (!ENABLE_REAL_EMAIL || !smtpTransport) {
    await logNotification({
      channel: "email",
      notification_type,
      recipient_role,
      recipient_id,
      ride_id,
      mission_id,
      dispatch_id,
      destination: email,
      message: `${safeSubject} | ${safeText}`,
      status: "mocked",
      provider: "smtp_mock",
      metadata: {
        reason: "Real email disabled or SMTP not configured"
      }
    });

    return buildNotificationResult({
      ok: true,
      channel: "email",
      mode: "mock",
      to: maskEmail(email),
      provider: "smtp_mock",
      message: safeSubject
    });
  }

  try {
    const result = await smtpTransport.sendMail({
      from: SUPPORT_FROM_EMAIL,
      to: email,
      subject: safeSubject,
      text: safeText,
      html: html || undefined
    });

    await logNotification({
      channel: "email",
      notification_type,
      recipient_role,
      recipient_id,
      ride_id,
      mission_id,
      dispatch_id,
      destination: email,
      message: `${safeSubject} | ${safeText}`,
      status: "sent",
      provider: "smtp",
      metadata: {
        message_id: result.messageId || null
      }
    });

    return buildNotificationResult({
      ok: true,
      channel: "email",
      mode: "live",
      to: maskEmail(email),
      provider: "smtp",
      message: safeSubject,
      meta: {
        message_id: result.messageId || null
      }
    });
  } catch (error) {
    await logNotification({
      channel: "email",
      notification_type,
      recipient_role,
      recipient_id,
      ride_id,
      mission_id,
      dispatch_id,
      destination: email,
      message: `${safeSubject} | ${safeText}`,
      status: "failed",
      provider: "smtp",
      metadata: {
        error: error.message || "Email send failed"
      }
    });

    return buildNotificationResult({
      ok: false,
      channel: "email",
      mode: "live",
      to: maskEmail(email),
      provider: "smtp",
      error: error.message || "Email send failed"
    });
  }
}

/* =========================================================
   CONTACT HELPERS
========================================================= */
function getRiderPhone(rider) {
  return (
    cleanPhone(rider?.phone) ||
    cleanPhone(rider?.phone_number) ||
    cleanPhone(rider?.mobile) ||
    ""
  );
}

function getDriverPhone(driver) {
  return (
    cleanPhone(driver?.phone) ||
    cleanPhone(driver?.phone_number) ||
    cleanPhone(driver?.mobile) ||
    ""
  );
}

function getRiderEmail(rider) {
  return clean(rider?.email);
}

function getDriverEmail(driver) {
  return clean(driver?.email);
}

/* =========================================================
   MESSAGE BUILDERS
========================================================= */
function buildMissionOfferMessage({ driver, ride, mission }) {
  const driverName = clean(driver?.full_name || driver?.name || "Driver");
  const mode = clean(ride?.requested_mode || "driver");
  return {
    sms: `Harvey Taxi mission offer: Pickup at ${clean(ride?.pickup_address)}. Dropoff at ${clean(ride?.dropoff_address)}. Mode: ${mode}. Accept before ${clean(mission?.offer_expires_at)}.`,
    emailSubject: "Harvey Taxi Mission Offer",
    emailText:
      `Hello ${driverName},\n\n` +
      `You have a new Harvey Taxi mission offer.\n\n` +
      `Pickup: ${clean(ride?.pickup_address)}\n` +
      `Dropoff: ${clean(ride?.dropoff_address)}\n` +
      `Requested Mode: ${mode}\n` +
      `Estimated Fare: ${ride?.estimated_fare || "N/A"}\n` +
      `Offer Expires At: ${clean(mission?.offer_expires_at)}\n\n` +
      `Please review and respond in your driver dashboard.`
  };
}

function buildRiderRideCreatedMessage({ rider, ride }) {
  const riderName = clean(rider?.full_name || rider?.name || "Rider");
  return {
    sms: `Harvey Taxi: your ride request is in progress. Pickup: ${clean(ride?.pickup_address)}. Dropoff: ${clean(ride?.dropoff_address)}. Status: ${clean(ride?.status)}.`,
    emailSubject: "Harvey Taxi Ride Request Received",
    emailText:
      `Hello ${riderName},\n\n` +
      `Your Harvey Taxi ride request has been received.\n\n` +
      `Pickup: ${clean(ride?.pickup_address)}\n` +
      `Dropoff: ${clean(ride?.dropoff_address)}\n` +
      `Status: ${clean(ride?.status)}\n` +
      `Estimated Fare: ${ride?.estimated_fare || "N/A"}\n\n` +
      `We will notify you as your ride progresses.`
  };
}

function buildRideStatusUpdateMessage({ ride, statusLabel }) {
  const label = clean(statusLabel || ride?.status || "updated");
  return {
    sms: `Harvey Taxi update: your ride is now ${label}.`,
    emailSubject: `Harvey Taxi Ride Update: ${label}`,
    emailText:
      `Your Harvey Taxi ride status has been updated.\n\n` +
      `Ride ID: ${clean(ride?.id)}\n` +
      `Status: ${label}\n` +
      `Pickup: ${clean(ride?.pickup_address)}\n` +
      `Dropoff: ${clean(ride?.dropoff_address)}`
  };
}

/* =========================================================
   NOTIFY RIDER
========================================================= */
async function notifyRider({
  rider,
  ride = null,
  messageText,
  emailSubject = "Harvey Taxi Update",
  notification_type = "general",
  dispatch_id = null,
  mission_id = null
}) {
  const smsTo = getRiderPhone(rider);
  const emailTo = getRiderEmail(rider);

  const [smsResult, emailResult] = await Promise.all([
    smsTo
      ? sendSmsMessage({
          to: smsTo,
          body: messageText,
          notification_type,
          recipient_role: "rider",
          recipient_id: rider?.id,
          ride_id: ride?.id,
          mission_id,
          dispatch_id
        })
      : Promise.resolve(null),
    emailTo
      ? sendEmailMessage({
          to: emailTo,
          subject: emailSubject,
          text: messageText,
          notification_type,
          recipient_role: "rider",
          recipient_id: rider?.id,
          ride_id: ride?.id,
          mission_id,
          dispatch_id
        })
      : Promise.resolve(null)
  ]);

  return {
    ok: !!((smsResult && smsResult.ok) || (emailResult && emailResult.ok)),
    sms: smsResult,
    email: emailResult
  };
}

/* =========================================================
   NOTIFY DRIVER
========================================================= */
async function notifyDriver({
  driver,
  ride = null,
  messageText,
  emailSubject = "Harvey Taxi Update",
  notification_type = "general",
  dispatch_id = null,
  mission_id = null
}) {
  const smsTo = getDriverPhone(driver);
  const emailTo = getDriverEmail(driver);

  const [smsResult, emailResult] = await Promise.all([
    smsTo
      ? sendSmsMessage({
          to: smsTo,
          body: messageText,
          notification_type,
          recipient_role: "driver",
          recipient_id: driver?.id,
          ride_id: ride?.id,
          mission_id,
          dispatch_id
        })
      : Promise.resolve(null),
    emailTo
      ? sendEmailMessage({
          to: emailTo,
          subject: emailSubject,
          text: messageText,
          notification_type,
          recipient_role: "driver",
          recipient_id: driver?.id,
          ride_id: ride?.id,
          mission_id,
          dispatch_id
        })
      : Promise.resolve(null)
  ]);

  return {
    ok: !!((smsResult && smsResult.ok) || (emailResult && emailResult.ok)),
    sms: smsResult,
    email: emailResult
  };
}

/* =========================================================
   HIGH-LEVEL NOTIFICATION FLOWS
========================================================= */
async function notifyRiderRideCreated({ rider, ride }) {
  const msg = buildRiderRideCreatedMessage({ rider, ride });
  return await notifyRider({
    rider,
    ride,
    messageText: msg.sms,
    emailSubject: msg.emailSubject,
    notification_type: "ride_created"
  });
}

async function notifyDriverMissionOffer({ driver, ride, mission, dispatch }) {
  const msg = buildMissionOfferMessage({ driver, ride, mission });
  return await notifyDriver({
    driver,
    ride,
    messageText: msg.sms,
    emailSubject: msg.emailSubject,
    notification_type: "mission_offer",
    dispatch_id: dispatch?.id || null,
    mission_id: mission?.id || null
  });
}

async function notifyRiderRideStatus({ rider, ride, statusLabel, notificationType = "ride_status" }) {
  const msg = buildRideStatusUpdateMessage({ ride, statusLabel });
  return await notifyRider({
    rider,
    ride,
    messageText: msg.sms,
    emailSubject: msg.emailSubject,
    notification_type: notificationType
  });
}

/* =========================================================
   ROUTE — COMMUNICATION HEALTH
========================================================= */
app.get("/api/communications/health", async (req, res) => {
  try {
    return jsonOk(res, {
      sms: {
        enabled: ENABLE_REAL_SMS,
        twilio_client_ready: !!smsClient,
        from_number_present: !!TWILIO_FROM_NUMBER
      },
      email: {
        enabled: ENABLE_REAL_EMAIL,
        smtp_ready: !!smtpTransport,
        from_email: SUPPORT_FROM_EMAIL || null
      }
    });
  } catch (error) {
    console.error("communications-health error:", error);
    return jsonError(res, 500, error.message || "Failed to fetch communications health");
  }
});

/* =========================================================
   ROUTE — TEST SMS
========================================================= */
app.post("/api/communications/test-sms", async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const to = clean(req.body?.to);
    const body = clean(req.body?.message || "Harvey Taxi test SMS");

    const result = await sendSmsMessage({
      to,
      body,
      notification_type: "test_sms"
    });

    return jsonOk(res, {
      message: "SMS test processed",
      result
    });
  } catch (error) {
    console.error("test-sms error:", error);
    return jsonError(res, 500, error.message || "Failed to process test SMS");
  }
});

/* =========================================================
   ROUTE — TEST EMAIL
========================================================= */
app.post("/api/communications/test-email", async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const to = clean(req.body?.to);
    const subject = clean(req.body?.subject || "Harvey Taxi test email");
    const text = clean(req.body?.message || "This is a Harvey Taxi email test.");

    const result = await sendEmailMessage({
      to,
      subject,
      text,
      notification_type: "test_email"
    });

    return jsonOk(res, {
      message: "Email test processed",
      result
    });
  } catch (error) {
    console.error("test-email error:", error);
    return jsonError(res, 500, error.message || "Failed to process test email");
  }
});

/* =========================================================
   ROUTE — NOTIFICATION LOGS
========================================================= */
app.get("/api/admin/notifications/logs", async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    if (!supabase) {
      return jsonError(res, 500, "Supabase not configured");
    }

    const { data, error } = await supabase
      .from("notification_logs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(250);

    if (error) throw error;

    return jsonOk(res, {
      count: Array.isArray(data) ? data.length : 0,
      logs: data || []
    });
  } catch (error) {
    console.error("notification-logs error:", error);
    return jsonError(res, 500, error.message || "Failed to fetch notification logs");
  }
});/* =========================================================
   HARVEY TAXI — CODE BLUE PHASE 9 (PART 9)
   FINAL PRODUCTION LAYER + STARTUP CHECKS + DISPATCH SWEEP
========================================================= */

/* =========================================================
   FINAL PRODUCTION CONFIG
========================================================= */
const ENABLE_STARTUP_CHECKS =
  clean(process.env.ENABLE_STARTUP_CHECKS || "true").toLowerCase() !== "false";

const ENABLE_DISPATCH_SWEEP =
  clean(process.env.ENABLE_DISPATCH_SWEEP || "true").toLowerCase() !== "false";

const ENABLE_AUTO_REDISPATCH =
  clean(process.env.ENABLE_AUTO_REDISPATCH || "true").toLowerCase() !== "false";

const DISPATCH_SWEEP_INTERVAL_MS = Number(process.env.DISPATCH_SWEEP_INTERVAL_MS || 15000);

const REQUIRED_SUPABASE_TABLES = [
  "riders",
  "drivers",
  "rides",
  "payments",
  "dispatches",
  "missions",
  "admin_logs"
];

const OPTIONAL_SUPABASE_TABLES = [
  "trip_events",
  "notification_logs"
];

/* =========================================================
   BOOT STATE
========================================================= */
const bootState = {
  boot_id: crypto.randomUUID(),
  started_at: SERVER_STARTED_AT,
  startup_checks_enabled: ENABLE_STARTUP_CHECKS,
  startup_checks_passed: false,
  startup_checks_finished: false,
  last_startup_error: null,
  dispatch_sweep_enabled: ENABLE_DISPATCH_SWEEP,
  last_dispatch_sweep_at: null,
  last_dispatch_sweep_summary: null
};

/* =========================================================
   SAFE HELPERS
========================================================= */
function safeNowIso() {
  return new Date().toISOString();
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function safeLower(value = "") {
  return clean(value).toLowerCase();
}

/* =========================================================
   TABLE CHECK HELPERS
========================================================= */
async function verifyTableReadable(tableName) {
  if (!supabase) {
    return {
      table: tableName,
      ok: false,
      error: "Supabase not configured"
    };
  }

  try {
    const { error } = await supabase
      .from(tableName)
      .select("*")
      .limit(1);

    if (error) {
      return {
        table: tableName,
        ok: false,
        error: error.message || "Unknown table read error"
      };
    }

    return {
      table: tableName,
      ok: true,
      error: null
    };
  } catch (error) {
    return {
      table: tableName,
      ok: false,
      error: error.message || "Crash during table verification"
    };
  }
}

async function verifyTables(tableNames = []) {
  const results = [];

  for (const tableName of tableNames) {
    const result = await verifyTableReadable(tableName);
    results.push(result);
  }

  return results;
}

/* =========================================================
   STARTUP CHECKS
========================================================= */
async function runStartupChecks() {
  const summary = {
    started_at: safeNowIso(),
    supabase_configured: !!supabase,
    openai_ready: !!openai,
    sms_ready: !!smsClient,
    email_ready: !!smtpTransport,
    required_tables: [],
    optional_tables: []
  };

  try {
    if (!ENABLE_STARTUP_CHECKS) {
      bootState.startup_checks_passed = true;
      bootState.startup_checks_finished = true;
      bootState.last_startup_error = null;
      return {
        ok: true,
        skipped: true,
        summary
      };
    }

    if (!supabase) {
      throw new Error("Supabase is not configured");
    }

    summary.required_tables = await verifyTables(REQUIRED_SUPABASE_TABLES);
    summary.optional_tables = await verifyTables(OPTIONAL_SUPABASE_TABLES);

    const requiredFailures = summary.required_tables.filter((item) => !item.ok);

    if (requiredFailures.length > 0) {
      throw new Error(
        `Required table check failed: ${requiredFailures
          .map((item) => `${item.table} (${item.error})`)
          .join(", ")}`
      );
    }

    bootState.startup_checks_passed = true;
    bootState.startup_checks_finished = true;
    bootState.last_startup_error = null;

    return {
      ok: true,
      skipped: false,
      summary
    };
  } catch (error) {
    bootState.startup_checks_passed = false;
    bootState.startup_checks_finished = true;
    bootState.last_startup_error = error.message || "Startup checks failed";

    return {
      ok: false,
      skipped: false,
      error: error.message || "Startup checks failed",
      summary
    };
  }
}

/* =========================================================
   DISPATCH SWEEP HELPERS
========================================================= */
async function getExpiredOpenMissions() {
  if (!supabase) throw new Error("Supabase not configured");

  const { data, error } = await supabase
    .from("missions")
    .select("*")
    .order("created_at", { ascending: true })
    .limit(250);

  if (error) throw error;

  const now = Date.now();

  return safeArray(data).filter((mission) => {
    const status = safeLower(mission.status || mission.mission_status);
    const expiresAt = mission.offer_expires_at
      ? new Date(mission.offer_expires_at).getTime()
      : null;

    return (
      ["offered", "awaiting_response", "pending"].includes(status) &&
      expiresAt &&
      expiresAt <= now
    );
  });
}

async function expireMissionAndResetDispatch(mission) {
  if (!mission) return { ok: false, reason: "Missing mission" };

  const rideId = clean(mission.ride_id);
  const dispatchId = clean(mission.dispatch_id);

  await updateMission(mission.id, {
    status: "expired",
    mission_status: "expired",
    expired_at: safeNowIso(),
    expiration_reason: "offer_timeout"
  });

  if (dispatchId) {
    const dispatch = await getDispatchById(dispatchId);

    if (dispatch) {
      await updateDispatch(dispatchId, {
        status: "pending",
        driver_id: null,
        attempt_number: Number(dispatch.attempt_number || 0) + 1,
        expires_at: null
      });
    }
  }

  if (rideId) {
    await updateRide(rideId, {
      status: "awaiting_driver_acceptance",
      driver_id: null
    });
  }

  return {
    ok: true,
    ride_id: rideId,
    dispatch_id: dispatchId,
    mission_id: mission.id
  };
}

async function runDispatchSweep() {
  const sweepSummary = {
    started_at: safeNowIso(),
    scanned_expired_missions: 0,
    expired_missions_processed: 0,
    redispatch_attempted: 0,
    redispatch_started: 0,
    failures: []
  };

  try {
    if (!ENABLE_DISPATCH_SWEEP) {
      bootState.last_dispatch_sweep_at = safeNowIso();
      bootState.last_dispatch_sweep_summary = {
        skipped: true,
        reason: "Dispatch sweep disabled"
      };

      return {
        ok: true,
        skipped: true,
        summary: bootState.last_dispatch_sweep_summary
      };
    }

    if (!supabase) {
      throw new Error("Supabase not configured");
    }

    const expiredMissions = await getExpiredOpenMissions();
    sweepSummary.scanned_expired_missions = expiredMissions.length;

    for (const mission of expiredMissions) {
      try {
        await expireMissionAndResetDispatch(mission);
        sweepSummary.expired_missions_processed += 1;

        if (ENABLE_AUTO_REDISPATCH && clean(mission.ride_id)) {
          sweepSummary.redispatch_attempted += 1;

          const nextOffer = await offerRideToNextDriver(mission.ride_id);
          if (nextOffer?.ok) {
            sweepSummary.redispatch_started += 1;

            try {
              const driver = await getDriverById(nextOffer.driver.id);
              if (driver) {
                await notifyDriverMissionOffer({
                  driver,
                  ride: nextOffer.ride,
                  mission: nextOffer.mission,
                  dispatch: nextOffer.dispatch
                });
              }
            } catch (notifyError) {
              console.error("dispatch sweep notify error:", notifyError);
            }
          } else {
            sweepSummary.failures.push({
              mission_id: mission.id,
              ride_id: mission.ride_id,
              reason: nextOffer?.reason || "Redispatch did not start"
            });
          }
        }
      } catch (missionError) {
        sweepSummary.failures.push({
          mission_id: mission.id,
          ride_id: mission.ride_id,
          reason: missionError.message || "Mission sweep failure"
        });
      }
    }

    bootState.last_dispatch_sweep_at = safeNowIso();
    bootState.last_dispatch_sweep_summary = sweepSummary;

    return {
      ok: true,
      skipped: false,
      summary: sweepSummary
    };
  } catch (error) {
    bootState.last_dispatch_sweep_at = safeNowIso();
    bootState.last_dispatch_sweep_summary = {
      ok: false,
      error: error.message || "Dispatch sweep failed"
    };

    return {
      ok: false,
      skipped: false,
      error: error.message || "Dispatch sweep failed",
      summary: sweepSummary
    };
  }
}

/* =========================================================
   FINAL HEALTH / BOOT DIAGNOSTICS
========================================================= */
app.get("/api/health/boot", async (req, res) => {
  try {
    return jsonOk(res, {
      service: "Harvey Taxi Code Blue",
      boot: bootState,
      uptime_seconds: Number(process.uptime().toFixed(2)),
      now: safeNowIso()
    });
  } catch (error) {
    console.error("health-boot error:", error);
    return jsonError(res, 500, error.message || "Failed to fetch boot health");
  }
});

app.get("/api/health/startup-checks", async (req, res) => {
  try {
    const requiredTables = await verifyTables(REQUIRED_SUPABASE_TABLES);
    const optionalTables = await verifyTables(OPTIONAL_SUPABASE_TABLES);

    return jsonOk(res, {
      supabase_configured: !!supabase,
      required_tables: requiredTables,
      optional_tables: optionalTables,
      startup_checks_passed: bootState.startup_checks_passed,
      startup_checks_finished: bootState.startup_checks_finished,
      last_startup_error: bootState.last_startup_error
    });
  } catch (error) {
    console.error("startup-checks route error:", error);
    return jsonError(res, 500, error.message || "Failed to fetch startup checks");
  }
});

app.post("/api/admin/dispatch/sweep", async (req, res) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const result = await runDispatchSweep();

    await createAdminLog({
      action: "manual_dispatch_sweep",
      admin_email: admin.email,
      target_type: "system",
      target_id: "dispatch_sweep",
      details: {
        result_ok: !!result.ok,
        skipped: !!result.skipped,
        summary: result.summary || null,
        error: result.error || null
      }
    });

    return jsonOk(res, {
      message: "Dispatch sweep completed",
      result
    });
  } catch (error) {
    console.error("manual dispatch sweep error:", error);
    return jsonError(res, 500, error.message || "Failed to run dispatch sweep");
  }
});

/* =========================================================
   PROCESS SAFETY
========================================================= */
process.on("unhandledRejection", (reason) => {
  console.error("UNHANDLED REJECTION:", reason);
});

process.on("uncaughtException", (error) => {
  console.error("UNCAUGHT EXCEPTION:", error);
});

process.on("SIGTERM", () => {
  console.log("SIGTERM received. Harvey Taxi server shutting down.");
});

process.on("SIGINT", () => {
  console.log("SIGINT received. Harvey Taxi server shutting down.");
});

/* =========================================================
   SERVER START
========================================================= */
async function startServer() {
  const startup = await runStartupChecks();

  if (!startup.ok) {
    console.error("❌ Startup checks failed:", startup.error || "Unknown startup failure");
    console.error("Startup summary:", JSON.stringify(startup.summary, null, 2));
  } else {
    console.log("✅ Startup checks complete");
    console.log(JSON.stringify(startup.summary, null, 2));
  }

  app.listen(PORT, () => {
    console.log("==================================================");
    console.log("🚕 HARVEY TAXI — CODE BLUE PHASE 9 LIVE");
    console.log(`🌐 Port: ${PORT}`);
    console.log(`🕒 Started At: ${SERVER_STARTED_AT}`);
    console.log(`🆔 Boot ID: ${bootState.boot_id}`);
    console.log(`🗄️ Supabase Ready: ${!!supabase}`);
    console.log(`🧠 OpenAI Ready: ${!!openai}`);
    console.log(`📲 SMS Ready: ${!!smsClient}`);
    console.log(`📧 Email Ready: ${!!smtpTransport}`);
    console.log(`🩺 Startup Checks Passed: ${bootState.startup_checks_passed}`);
    console.log(`♻️ Dispatch Sweep Enabled: ${ENABLE_DISPATCH_SWEEP}`);
    console.log("==================================================");
  });

  if (ENABLE_DISPATCH_SWEEP) {
    setInterval(async () => {
      try {
        const result = await runDispatchSweep();

        if (!result.ok) {
          console.error("Dispatch sweep error:", result.error || result.summary || "Unknown error");
        }
      } catch (error) {
        console.error("Dispatch sweep crash:", error);
      }
    }, DISPATCH_SWEEP_INTERVAL_MS);
  }
}

startServer();

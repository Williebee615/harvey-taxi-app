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
  console.warn("⚠️ OpenAI SDK not installed. AI features will remain disabled.");
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
   ENV / VALUE HELPERS
========================================================= */
function clean(value = "") {
  return String(value ?? "")
    .trim()
    .replace(/^['"]|['"]$/g, "");
}

function lower(value = "") {
  return clean(value).toLowerCase();
}

function toBool(value, fallback = false) {
  const normalized = lower(value);
  if (!normalized) return fallback;
  return ["1", "true", "yes", "on", "enabled"].includes(normalized);
}

function toNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function isEmail(value = "") {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean(value));
}

function nowIso() {
  return new Date().toISOString();
}

function generateId(prefix = "id") {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}

function safeJsonParse(value, fallback = null) {
  try {
    return JSON.parse(value);
  } catch (error) {
    return fallback;
  }
}

function sleep(ms = 0) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* =========================================================
   ENV CONFIG
========================================================= */
const PUBLIC_APP_URL =
  clean(process.env.PUBLIC_APP_URL) ||
  clean(process.env.RENDER_EXTERNAL_URL) ||
  clean(process.env.APP_BASE_URL) ||
  `http://localhost:${PORT}`;

const SUPPORT_EMAIL =
  clean(process.env.SUPPORT_EMAIL) ||
  clean(process.env.SUPPORT_FROM_EMAIL) ||
  clean(process.env.SENDGRID_FROM_EMAIL) ||
  clean(process.env.EMAIL_FROM) ||
  "support@harveytaxiservice.com";

const PRIMARY_ADMIN_EMAIL =
  clean(process.env.ADMIN_EMAIL) ||
  clean(process.env.PRIMARY_ADMIN_EMAIL) ||
  "williebee@harveytaxiservice.com";

const PRIMARY_ADMIN_PASSWORD =
  clean(process.env.ADMIN_PASSWORD) ||
  clean(process.env.PRIMARY_ADMIN_PASSWORD);

const SUPABASE_URL = clean(process.env.SUPABASE_URL);
const SUPABASE_SERVICE_ROLE_KEY = clean(process.env.SUPABASE_SERVICE_ROLE_KEY);

const GOOGLE_MAPS_API_KEY = clean(process.env.GOOGLE_MAPS_API_KEY);

const OPENAI_API_KEY = clean(process.env.OPENAI_API_KEY);
const OPENAI_SUPPORT_MODEL = clean(process.env.OPENAI_SUPPORT_MODEL || "gpt-4.1-mini");

const ENABLE_AI_BRAIN = toBool(process.env.ENABLE_AI_BRAIN, true);
const ENABLE_RIDER_VERIFICATION_GATE = toBool(process.env.ENABLE_RIDER_VERIFICATION_GATE, true);
const ENABLE_PAYMENT_GATE = toBool(process.env.ENABLE_PAYMENT_GATE, true);
const ENABLE_AUTO_REDISPATCH = toBool(process.env.ENABLE_AUTO_REDISPATCH, true);
const ENABLE_STARTUP_TABLE_CHECKS = toBool(process.env.ENABLE_STARTUP_TABLE_CHECKS, true);

const DISPATCH_TIMEOUT_SECONDS = toNumber(process.env.DISPATCH_TIMEOUT_SECONDS, 25);
const MAX_DISPATCH_ATTEMPTS = toNumber(process.env.MAX_DISPATCH_ATTEMPTS, 5);

const DEFAULT_BOOKING_FEE = toNumber(process.env.DEFAULT_BOOKING_FEE, 2.5);
const DEFAULT_BASE_FARE = toNumber(process.env.DEFAULT_BASE_FARE, 8.5);
const DEFAULT_PER_MILE = toNumber(process.env.DEFAULT_PER_MILE, 2.4);
const DEFAULT_PER_MINUTE = toNumber(process.env.DEFAULT_PER_MINUTE, 0.45);
const DEFAULT_MINIMUM_FARE = toNumber(process.env.DEFAULT_MINIMUM_FARE, 12);

const DRIVER_PAYOUT_PERCENT = toNumber(process.env.DRIVER_PAYOUT_PERCENT, 0.72);
const AUTONOMOUS_PAYOUT_PERCENT = toNumber(process.env.AUTONOMOUS_PAYOUT_PERCENT, 0.52);

const SURGE_MULTIPLIER_DEFAULT = toNumber(process.env.SURGE_MULTIPLIER_DEFAULT, 1.0);
const SURGE_MULTIPLIER_BUSY = toNumber(process.env.SURGE_MULTIPLIER_BUSY, 1.25);
const SURGE_MULTIPLIER_HIGH = toNumber(process.env.SURGE_MULTIPLIER_HIGH, 1.6);

/* =========================================================
   SUPABASE CLIENT
========================================================= */
const hasSupabase = Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);

const supabase = hasSupabase
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false }
    })
  : null;

if (!hasSupabase) {
  console.warn("⚠️ Supabase is not fully configured. Database routes may fail.");
}

/* =========================================================
   OPTIONAL OPENAI CLIENT
========================================================= */
const openai =
  OpenAI && OPENAI_API_KEY
    ? new OpenAI({
        apiKey: OPENAI_API_KEY
      })
    : null;

if (ENABLE_AI_BRAIN && !openai) {
  console.warn("⚠️ AI brain enabled, but OpenAI client is unavailable.");
}

/* =========================================================
   STANDARD RESPONSE HELPERS
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

function serverError(res, error, message = "Internal server error") {
  console.error(`❌ ${message}:`, error);
  return res.status(500).json({
    ok: false,
    message,
    error: clean(error?.message || "unknown_error")
  });
}

/* =========================================================
   ADMIN HELPERS
========================================================= */
function getAdminEmailFromRequest(req) {
  return (
    clean(req.headers["x-admin-email"]) ||
    clean(req.body?.admin_email) ||
    clean(req.query?.admin_email)
  );
}

function getAdminPasswordFromRequest(req) {
  return (
    clean(req.headers["x-admin-password"]) ||
    clean(req.body?.admin_password) ||
    clean(req.query?.admin_password)
  );
}

function isAdminAuthorized(req) {
  const email = lower(getAdminEmailFromRequest(req));
  const password = getAdminPasswordFromRequest(req);

  if (!PRIMARY_ADMIN_EMAIL || !PRIMARY_ADMIN_PASSWORD) return false;

  return (
    email === lower(PRIMARY_ADMIN_EMAIL) &&
    password === PRIMARY_ADMIN_PASSWORD
  );
}

function requireAdmin(req, res, next) {
  if (!isAdminAuthorized(req)) {
    return fail(res, "Unauthorized admin access", 401);
  }
  next();
}

/* =========================================================
   DB HELPERS
========================================================= */
async function insertAdminLog(action, details = {}, req = null) {
  if (!supabase) return;

  try {
    await supabase.from("admin_logs").insert({
      id: generateId("alog"),
      action: clean(action),
      details,
      actor_email: req ? getAdminEmailFromRequest(req) || PRIMARY_ADMIN_EMAIL : PRIMARY_ADMIN_EMAIL,
      created_at: nowIso()
    });
  } catch (error) {
    console.warn("⚠️ Failed to insert admin log:", error?.message || error);
  }
}

async function requireSupabaseOrFail(res) {
  if (!supabase) {
    fail(res, "Supabase is not configured", 500);
    return false;
  }
  return true;
}

async function fetchSingle(table, match = {}) {
  const query = supabase.from(table).select("*").match(match).limit(1).maybeSingle();
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

async function insertRow(table, payload) {
  const { data, error } = await supabase
    .from(table)
    .insert(payload)
    .select()
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data;
}

async function updateRows(table, match = {}, payload = {}) {
  const { data, error } = await supabase
    .from(table)
    .update(payload)
    .match(match)
    .select();

  if (error) throw error;
  return data || [];
}

/* =========================================================
   PLATFORM HELPERS
========================================================= */
function normalizeDriverType(value = "") {
  const v = lower(value);
  if (["autonomous", "av", "robotaxi", "self-driving"].includes(v)) return "autonomous";
  return "human";
}

function normalizeRideMode(value = "") {
  const v = lower(value);
  if (["autonomous", "av", "pilot"].includes(v)) return "autonomous";
  return "driver";
}

function normalizeRideStatus(value = "") {
  const v = lower(value);

  const allowed = [
    "pending",
    "awaiting_payment",
    "awaiting_dispatch",
    "awaiting_driver_acceptance",
    "offered",
    "dispatched",
    "driver_en_route",
    "arrived",
    "in_progress",
    "completed",
    "cancelled",
    "unassigned",
    "no_driver_available"
  ];

  return allowed.includes(v) ? v : "pending";
}

function cents(amount = 0) {
  return Math.round(Number(amount || 0) * 100);
}

function dollars(amount = 0) {
  return Number(Number(amount || 0).toFixed(2));
}

function computeSurgeMultiplier({
  demandLevel = "normal",
  requestedMode = "driver"
} = {}) {
  const demand = lower(demandLevel);
  const mode = normalizeRideMode(requestedMode);

  let multiplier = SURGE_MULTIPLIER_DEFAULT;

  if (["busy", "medium"].includes(demand)) multiplier = SURGE_MULTIPLIER_BUSY;
  if (["high", "peak", "surge"].includes(demand)) multiplier = SURGE_MULTIPLIER_HIGH;

  if (mode === "autonomous") {
    multiplier = Math.max(1, multiplier - 0.1);
  }

  return Number(multiplier.toFixed(2));
}

function computeFareEstimate({
  distanceMiles = 0,
  durationMinutes = 0,
  requestedMode = "driver",
  rideType = "standard",
  demandLevel = "normal"
} = {}) {
  const mode = normalizeRideMode(requestedMode);
  const type = lower(rideType || "standard");

  let subtotal =
    DEFAULT_BASE_FARE +
    Number(distanceMiles || 0) * DEFAULT_PER_MILE +
    Number(durationMinutes || 0) * DEFAULT_PER_MINUTE;

  let typeMultiplier = 1;

  if (type === "scheduled") typeMultiplier = 1.08;
  if (type === "airport") typeMultiplier = 1.15;
  if (type === "medical") typeMultiplier = 1.04;
  if (type === "nonprofit") typeMultiplier = 0.94;

  if (mode === "autonomous") {
    typeMultiplier *= 0.96;
  }

  const surgeMultiplier = computeSurgeMultiplier({ demandLevel, requestedMode: mode });
  const fareBeforeMinimum = subtotal * typeMultiplier * surgeMultiplier + DEFAULT_BOOKING_FEE;
  const finalFare = Math.max(DEFAULT_MINIMUM_FARE, fareBeforeMinimum);

  const payoutPercent =
    mode === "autonomous" ? AUTONOMOUS_PAYOUT_PERCENT : DRIVER_PAYOUT_PERCENT;

  const providerPayout = finalFare * payoutPercent;
  const platformRevenue = finalFare - providerPayout;

  return {
    requested_mode: mode,
    ride_type: type,
    distance_miles: dollars(distanceMiles),
    duration_minutes: dollars(durationMinutes),
    surge_multiplier: surgeMultiplier,
    booking_fee: dollars(DEFAULT_BOOKING_FEE),
    estimated_fare: dollars(finalFare),
    estimated_fare_cents: cents(finalFare),
    provider_payout_estimate: dollars(providerPayout),
    platform_revenue_estimate: dollars(platformRevenue),
    fare_components: {
      base_fare: dollars(DEFAULT_BASE_FARE),
      per_mile_rate: dollars(DEFAULT_PER_MILE),
      per_minute_rate: dollars(DEFAULT_PER_MINUTE),
      minimum_fare: dollars(DEFAULT_MINIMUM_FARE),
      type_multiplier: Number(typeMultiplier.toFixed(2))
    }
  };
}

/* =========================================================
   HEALTH / STATUS ROUTES
========================================================= */
app.get("/", (req, res) => {
  return ok(res, {
    app: APP_NAME,
    status: "running",
    started_at: SERVER_STARTED_AT,
    public_app_url: PUBLIC_APP_URL
  }, "Harvey Taxi server is running");
});

app.get("/api/health", async (req, res) => {
  try {
    const health = {
      app: APP_NAME,
      ok: true,
      started_at: SERVER_STARTED_AT,
      checked_at: nowIso(),
      env: {
        public_app_url: PUBLIC_APP_URL,
        support_email: SUPPORT_EMAIL,
        primary_admin_email: PRIMARY_ADMIN_EMAIL,
        has_supabase: Boolean(supabase),
        has_google_maps: Boolean(GOOGLE_MAPS_API_KEY),
        ai_enabled: Boolean(ENABLE_AI_BRAIN),
        has_openai: Boolean(openai),
        rider_verification_gate: ENABLE_RIDER_VERIFICATION_GATE,
        payment_gate: ENABLE_PAYMENT_GATE,
        auto_redispatch: ENABLE_AUTO_REDISPATCH
      },
      config: {
        dispatch_timeout_seconds: DISPATCH_TIMEOUT_SECONDS,
        max_dispatch_attempts: MAX_DISPATCH_ATTEMPTS,
        default_booking_fee: DEFAULT_BOOKING_FEE,
        driver_payout_percent: DRIVER_PAYOUT_PERCENT,
        autonomous_payout_percent: AUTONOMOUS_PAYOUT_PERCENT
      }
    };

    if (supabase && ENABLE_STARTUP_TABLE_CHECKS) {
      const tableChecks = {};
      const tables = [
        "riders",
        "drivers",
        "rides",
        "payments",
        "missions",
        "dispatches",
        "admin_logs"
      ];

      for (const table of tables) {
        try {
          const { error } = await supabase.from(table).select("*", { head: true, count: "exact" });
          tableChecks[table] = {
            ok: !error,
            error: error?.message || null
          };
        } catch (error) {
          tableChecks[table] = {
            ok: false,
            error: error?.message || "unknown_check_error"
          };
        }
      }

      health.tables = tableChecks;
    }

    return res.status(200).json(health);
  } catch (error) {
    return serverError(res, error, "Health check failed");
  }
});

/* =========================================================
   NOT FOUND FALLBACK
   NOTE:
   Keep this at the very bottom of the FINAL file,
   not at the bottom of Part 1 once more parts are added.
========================================================= */
// app.use((req, res) => {
//   return fail(res, "Route not found", 404);
// });

/* =========================================================
   STARTUP LOGS
========================================================= */
console.log("==================================================");
console.log(`🚕 ${APP_NAME} booting...`);
console.log(`🌐 Public URL: ${PUBLIC_APP_URL}`);
console.log(`🕒 Started At: ${SERVER_STARTED_AT}`);
console.log(`🗄️ Supabase: ${supabase ? "connected-config-present" : "missing-config"}`);
console.log(`🤖 AI Brain: ${openai ? "ready" : "disabled/unavailable"}`);
console.log(`🛡️ Rider Gate: ${ENABLE_RIDER_VERIFICATION_GATE ? "ON" : "OFF"}`);
console.log(`💳 Payment Gate: ${ENABLE_PAYMENT_GATE ? "ON" : "OFF"}`);
console.log(`📡 Auto Redispatch: ${ENABLE_AUTO_REDISPATCH ? "ON" : "OFF"}`);
console.log("==================================================");

/* =========================================================
   SERVER START
   NOTE:
   Leave this at the very bottom of the FINAL combined file.
   For now, it can stay here until we append later parts.
========================================================= */
app.listen(PORT, () => {
  console.log(`✅ Harvey Taxi listening on port ${PORT}`);
});/* =========================================================
   PART 2: AI SUPPORT + MISSION-AWARE FALLBACK BRAIN
========================================================= */

/* =========================================================
   PAGE CONTEXT DETECTION
========================================================= */
function normalizePage(page = "") {
  const value = lower(page);

  if (!value) return "general";
  if (["home", "index", "landing"].includes(value)) return "general";
  if (["rider", "rider-signup", "rider-dashboard"].includes(value)) return "rider";
  if (["driver", "driver-signup", "driver-dashboard"].includes(value)) return "driver";
  if (["request", "request-ride", "ride"].includes(value)) return "request";
  if (["support", "help", "faq"].includes(value)) return "support";

  return value;
}

/* =========================================================
   PLATFORM KNOWLEDGE
========================================================= */
const HARVEY_PLATFORM_KNOWLEDGE = {
  company: {
    name: "Harvey Taxi Service LLC",
    mission:
      "Harvey Taxi Service LLC exists to provide safe, reliable, transparent, and trusted transportation access with strong onboarding, verified platform participation, and long-term innovation toward future autonomous mobility.",
    service_area:
      "Harvey Taxi is positioned as a Tennessee transportation platform with human-driver service and future autonomous pilot expansion.",
    values: [
      "safety",
      "trust",
      "transparency",
      "accessibility",
      "reliability",
      "innovation"
    ]
  },

  foundation: {
    name: "Harvey Assistance Foundation",
    mission:
      "Harvey Assistance Foundation exists to support people and communities through transportation-related assistance, support access, and mission-driven help resources tied to mobility and social support.",
    notes:
      "Foundation support information should be helpful, respectful, and mission-centered, without making unsupported legal, funding, or emergency promises."
  },

  rider: {
    summary:
      "Riders must complete signup and may be required to pass approval or verification checks before requesting rides.",
    rules: [
      "Rider approval may be required before ride requests are allowed.",
      "Payment authorization may be required before dispatch.",
      "Support can help riders understand account status, ride request flow, and next steps."
    ]
  },

  driver: {
    summary:
      "Drivers must complete signup, submit required information, pass verification steps, and be approved before going active on the platform.",
    rules: [
      "Drivers may need email verification and SMS verification.",
      "Drivers may need ID and vehicle-related information.",
      "Drivers should be able to review trip mission details before accepting a trip."
    ]
  },

  rides: {
    summary:
      "Harvey Taxi supports ride requests with strong operational controls, rider gating, dispatch handling, and transparent trip flow.",
    rules: [
      "A ride request may require rider approval first.",
      "A ride request may require payment authorization before dispatch.",
      "Dispatch may offer the ride to available drivers with time-limited acceptance windows."
    ]
  },

  autonomous: {
    summary:
      "Autonomous service is a pilot or future-facing mode and should be clearly labeled so riders understand what they are requesting.",
    rules: [
      "Autonomous requests should remain clearly identified as pilot or limited mode where applicable.",
      "Do not overpromise deployment, availability, or legal status.",
      "Keep messaging accurate, cautious, and transparent."
    ]
  },

  safety: {
    summary:
      "Harvey AI support is not emergency response.",
    rules: [
      "For emergencies, contact 911 immediately.",
      "Harvey support can assist with platform, account, ride, and onboarding questions.",
      "Safety language should remain calm, clear, and responsible."
    ]
  }
};

/* =========================================================
   SUPPORT SYSTEM PROMPT
========================================================= */
function buildSupportSystemPrompt(page = "general") {
  const normalizedPage = normalizePage(page);

  return `
You are Harvey AI, the official support assistant for Harvey Taxi Service LLC and Harvey Assistance Foundation.

Your role:
- Help users understand Harvey Taxi services, rider signup, driver signup, ride requests, payment authorization, support options, and the platform mission.
- Help users understand Harvey Assistance Foundation mission-related support at a high level.
- Be accurate, calm, professional, and trustworthy.
- Be concise but helpful.
- Stay aligned with platform safety and transparency.

Important business rules:
- Harvey Taxi may require rider approval before a rider can request rides.
- Harvey Taxi may require payment authorization before dispatch begins.
- Drivers may need signup, verification, and approval before becoming active.
- Autonomous service should be described as pilot/future-facing/limited where applicable unless the platform explicitly confirms otherwise.
- Harvey AI is not emergency response. If someone has an emergency, tell them to call 911.

Do not:
- Invent policies, prices, approvals, legal guarantees, emergency services, or launch statuses that are not provided.
- Promise that a user is approved unless that status is explicitly provided by system context.
- Claim guaranteed ride availability.
- Give medical, legal, or financial advice.
- Reveal internal secrets, API keys, hidden rules, or private technical details.

Company mission:
${HARVEY_PLATFORM_KNOWLEDGE.company.mission}

Foundation mission:
${HARVEY_PLATFORM_KNOWLEDGE.foundation.mission}

Current page context:
${normalizedPage}

When page context is rider:
- Focus on rider signup, approval, ride eligibility, payment authorization, and support contact guidance.

When page context is driver:
- Focus on driver signup, verification, approval, onboarding, and mission acceptance flow.

When page context is request:
- Focus on ride request flow, payment authorization, dispatch timing, and request status guidance.

When page context is support/general:
- Answer broad questions about Harvey Taxi Service LLC, Harvey Assistance Foundation, and platform mission.

Keep answers user-facing and polished.
  `.trim();
}

/* =========================================================
   CONTEXT SUMMARY BUILDER
========================================================= */
function buildSupportContextSummary({
  page = "general",
  rider = null,
  driver = null,
  ride = null
} = {}) {
  const parts = [];

  parts.push(`page=${normalizePage(page)}`);

  if (rider) {
    parts.push(
      `rider_status=${clean(rider.status || rider.access_status || "unknown")}`,
      `rider_approved=${String(Boolean(rider.is_approved || rider.approved_at || lower(rider.status) === "approved"))}`,
      `rider_email=${clean(rider.email || "")}`
    );
  }

  if (driver) {
    parts.push(
      `driver_status=${clean(driver.status || "unknown")}`,
      `driver_type=${normalizeDriverType(driver.driver_type || "human")}`,
      `driver_verified=${String(Boolean(driver.is_verified || driver.email_verified || driver.sms_verified))}`,
      `driver_approved=${String(Boolean(driver.is_approved || driver.approved_at || lower(driver.status) === "approved"))}`
    );
  }

  if (ride) {
    parts.push(
      `ride_status=${normalizeRideStatus(ride.status || "pending")}`,
      `ride_mode=${normalizeRideMode(ride.requested_mode || ride.mode || "driver")}`,
      `pickup=${clean(ride.pickup_address || ride.pickup || "")}`,
      `dropoff=${clean(ride.dropoff_address || ride.dropoff || "")}`
    );
  }

  return parts.join(" | ");
}

/* =========================================================
   KEYWORD INTENT DETECTION
========================================================= */
function detectSupportIntent(message = "") {
  const text = lower(message);

  if (!text) return "general";

  if (
    text.includes("foundation") ||
    text.includes("assistance foundation") ||
    text.includes("nonprofit")
  ) {
    return "foundation";
  }

  if (
    text.includes("driver") ||
    text.includes("signup as driver") ||
    text.includes("become a driver") ||
    text.includes("drive for")
  ) {
    return "driver";
  }

  if (
    text.includes("rider") ||
    text.includes("passenger") ||
    text.includes("sign up") ||
    text.includes("approved") ||
    text.includes("approval")
  ) {
    return "rider";
  }

  if (
    text.includes("ride") ||
    text.includes("request") ||
    text.includes("pickup") ||
    text.includes("dropoff") ||
    text.includes("dispatch")
  ) {
    return "ride";
  }

  if (
    text.includes("payment") ||
    text.includes("card") ||
    text.includes("authorization") ||
    text.includes("preauth") ||
    text.includes("pre-author")
  ) {
    return "payment";
  }

  if (
    text.includes("autonomous") ||
    text.includes("pilot") ||
    text.includes("av") ||
    text.includes("self-driving")
  ) {
    return "autonomous";
  }

  if (
    text.includes("mission") ||
    text.includes("what do you do") ||
    text.includes("about harvey") ||
    text.includes("company") ||
    text.includes("service")
  ) {
    return "mission";
  }

  if (
    text.includes("emergency") ||
    text.includes("unsafe") ||
    text.includes("danger")
  ) {
    return "safety";
  }

  return "general";
}

/* =========================================================
   MISSION-AWARE FALLBACK REPLY ENGINE
========================================================= */
function getFallbackReply(message = "", page = "general") {
  const text = lower(message);
  const normalizedPage = normalizePage(page);
  const intent = detectSupportIntent(text);

  if (intent === "safety") {
    return "Harvey AI is not an emergency service. If you are in immediate danger or have an emergency, call 911 right away. For platform help, I can still help with rides, account access, onboarding, and support questions.";
  }

  if (intent === "mission") {
    return "Harvey Taxi Service LLC is built to provide safe, reliable, and transparent transportation support with strong onboarding, trusted service, and long-term mobility innovation. Harvey Assistance Foundation supports mission-driven transportation-related help and community support access.";
  }

  if (intent === "foundation") {
    return "Harvey Assistance Foundation is focused on transportation-related support and mission-driven community assistance. If you need help understanding foundation-related support, I can help explain the mission and direct you to the right next step.";
  }

  if (intent === "driver") {
    return "To become a Harvey Taxi driver, you typically need to complete driver signup, submit the required information, complete verification steps, and receive approval before going active. Drivers should also be able to review trip mission details before accepting rides.";
  }

  if (intent === "rider") {
    return "Riders may need to complete signup and approval before requesting rides on Harvey Taxi. Once rider access is approved, the next step is usually payment authorization and then ride request flow.";
  }

  if (intent === "payment") {
    return "Harvey Taxi may use payment authorization before dispatch so the trip flow is smoother and more secure. That authorization step can happen before a driver is dispatched.";
  }

  if (intent === "ride") {
    return "Harvey Taxi ride requests may require rider approval and payment authorization before dispatch begins. After that, the platform can move into the driver offer and trip mission flow.";
  }

  if (intent === "autonomous") {
    return "Harvey Taxi autonomous service should be treated as a clearly labeled pilot or future-facing mode unless the platform specifically confirms broader availability. The goal is to stay transparent and responsible about what is live today.";
  }

  if (normalizedPage === "driver") {
    return "I can help with Harvey Taxi driver signup, verification, approval, and onboarding questions.";
  }

  if (normalizedPage === "rider") {
    return "I can help with rider signup, account approval, ride eligibility, and next steps for requesting a Harvey Taxi ride.";
  }

  if (normalizedPage === "request") {
    return "I can help with pickup and dropoff questions, ride requests, payment authorization, and dispatch flow.";
  }

  return "I can help with Harvey Taxi rides, rider approval, driver onboarding, payment authorization, autonomous pilot questions, and Harvey Assistance Foundation mission support.";
}

/* =========================================================
   AI TEXT GENERATION
========================================================= */
async function generateAiSupportReply({
  message = "",
  page = "general",
  rider = null,
  driver = null,
  ride = null
} = {}) {
  const fallback = getFallbackReply(message, page);

  if (!ENABLE_AI_BRAIN || !openai) {
    return {
      reply: fallback,
      source: "fallback"
    };
  }

  try {
    const systemPrompt = buildSupportSystemPrompt(page);
    const contextSummary = buildSupportContextSummary({ page, rider, driver, ride });

    const completion = await openai.responses.create({
      model: OPENAI_SUPPORT_MODEL,
      input: [
        {
          role: "system",
          content: systemPrompt
        },
        {
          role: "system",
          content: `Known user/platform context: ${contextSummary || "none"}`
        },
        {
          role: "user",
          content: clean(message || "")
        }
      ]
    });

    const reply =
      clean(completion?.output_text || "") ||
      fallback;

    return {
      reply,
      source: "openai"
    };
  } catch (error) {
    console.warn("⚠️ AI support generation failed. Falling back:", error?.message || error);
    return {
      reply: fallback,
      source: "fallback_after_error"
    };
  }
}

/* =========================================================
   CONTEXT LOOKUP HELPERS
========================================================= */
async function findRiderById(riderId = "") {
  if (!supabase || !clean(riderId)) return null;
  try {
    return await fetchSingle("riders", { id: clean(riderId) });
  } catch (error) {
    console.warn("⚠️ Failed to load rider context:", error?.message || error);
    return null;
  }
}

async function findDriverById(driverId = "") {
  if (!supabase || !clean(driverId)) return null;
  try {
    return await fetchSingle("drivers", { id: clean(driverId) });
  } catch (error) {
    console.warn("⚠️ Failed to load driver context:", error?.message || error);
    return null;
  }
}

async function findRideById(rideId = "") {
  if (!supabase || !clean(rideId)) return null;
  try {
    return await fetchSingle("rides", { id: clean(rideId) });
  } catch (error) {
    console.warn("⚠️ Failed to load ride context:", error?.message || error);
    return null;
  }
}

/* =========================================================
   AI SUPPORT API
========================================================= */
app.post("/api/ai/support", async (req, res) => {
  try {
    const message = clean(req.body?.message || req.body?.question || "");
    const page = normalizePage(req.body?.page || req.body?.page_context || "general");
    const riderId = clean(req.body?.rider_id || "");
    const driverId = clean(req.body?.driver_id || "");
    const rideId = clean(req.body?.ride_id || "");

    if (!message) {
      return fail(res, "A support message is required", 400);
    }

    let rider = null;
    let driver = null;
    let ride = null;

    if (supabase) {
      if (riderId) rider = await findRiderById(riderId);
      if (driverId) driver = await findDriverById(driverId);
      if (rideId) ride = await findRideById(rideId);
    }

    const aiResult = await generateAiSupportReply({
      message,
      page,
      rider,
      driver,
      ride
    });

    return ok(
      res,
      {
        reply: aiResult.reply,
        source: aiResult.source,
        page,
        context: {
          rider_id: riderId || null,
          driver_id: driverId || null,
          ride_id: rideId || null
        }
      },
      "AI support response generated"
    );
  } catch (error) {
    return serverError(res, error, "AI support route failed");
  }
});

/* =========================================================
   SIMPLE AI HEALTH CHECK
========================================================= */
app.get("/api/ai/health", async (req, res) => {
  try {
    return ok(res, {
      ai_enabled: ENABLE_AI_BRAIN,
      openai_ready: Boolean(openai),
      model: OPENAI_SUPPORT_MODEL,
      fallback_ready: true
    }, "AI support health ready");
  } catch (error) {
    return serverError(res, error, "AI health route failed");
  }
});/* =========================================================
   PART 3: RIDER SIGNUP + RIDER STATUS + APPROVAL GATE
========================================================= */

/* =========================================================
   RIDER HELPERS
========================================================= */
function normalizeRiderStatus(value = "") {
  const v = lower(value);

  if (["approved", "active", "verified"].includes(v)) return "approved";
  if (["rejected", "denied", "blocked"].includes(v)) return "rejected";
  if (["pending_review", "review"].includes(v)) return "pending";
  if (["pending", "submitted", "awaiting_review", "awaiting_approval"].includes(v)) return "pending";

  return "pending";
}

function riderIsApproved(rider = null) {
  if (!rider) return false;

  const status = normalizeRiderStatus(
    rider.status || rider.access_status || rider.rider_status || ""
  );

  return Boolean(
    rider.is_approved ||
      rider.approved_at ||
      status === "approved"
  );
}

function riderNeedsApproval(rider = null) {
  if (!rider) return true;
  if (!ENABLE_RIDER_VERIFICATION_GATE) return false;
  return !riderIsApproved(rider);
}

function sanitizeRider(rider = null) {
  if (!rider) return null;

  return {
    id: clean(rider.id),
    first_name: clean(rider.first_name),
    last_name: clean(rider.last_name),
    full_name: clean(
      rider.full_name ||
        `${clean(rider.first_name)} ${clean(rider.last_name)}`.trim()
    ),
    email: clean(rider.email),
    phone: clean(rider.phone),
    status: normalizeRiderStatus(rider.status || rider.access_status),
    access_status: normalizeRiderStatus(rider.access_status || rider.status),
    is_approved: riderIsApproved(rider),
    approved_at: rider.approved_at || null,
    created_at: rider.created_at || null,
    updated_at: rider.updated_at || null,
    document_type: clean(rider.document_type),
    verification_status: clean(rider.verification_status || ""),
    notes: clean(rider.notes || "")
  };
}

async function findRiderByEmail(email = "") {
  if (!supabase || !isEmail(email)) return null;

  try {
    const { data, error } = await supabase
      .from("riders")
      .select("*")
      .ilike("email", clean(email))
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    return data;
  } catch (error) {
    console.warn("⚠️ Failed to find rider by email:", error?.message || error);
    return null;
  }
}

async function findRiderByPhone(phone = "") {
  if (!supabase || !clean(phone)) return null;

  try {
    const { data, error } = await supabase
      .from("riders")
      .select("*")
      .eq("phone", clean(phone))
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    return data;
  } catch (error) {
    console.warn("⚠️ Failed to find rider by phone:", error?.message || error);
    return null;
  }
}

async function resolveRiderIdentity({ rider_id = "", email = "", phone = "" } = {}) {
  if (!supabase) return null;

  if (clean(rider_id)) {
    const byId = await findRiderById(rider_id);
    if (byId) return byId;
  }

  if (isEmail(email)) {
    const byEmail = await findRiderByEmail(email);
    if (byEmail) return byEmail;
  }

  if (clean(phone)) {
    const byPhone = await findRiderByPhone(phone);
    if (byPhone) return byPhone;
  }

  return null;
}

function buildRiderAccessMessage(rider = null) {
  if (!rider) {
    return "Rider account not found.";
  }

  if (!ENABLE_RIDER_VERIFICATION_GATE) {
    return "Rider verification gate is currently disabled.";
  }

  if (riderIsApproved(rider)) {
    return "Rider account is approved for ride access.";
  }

  const status = normalizeRiderStatus(rider.status || rider.access_status);

  if (status === "rejected") {
    return "Rider account is not approved yet. Please contact support for help with your application status.";
  }

  return "Rider account is still pending approval. Ride requests are locked until approval is complete.";
}

async function requireApprovedRiderRecord({
  rider_id = "",
  email = "",
  phone = ""
} = {}) {
  const rider = await resolveRiderIdentity({ rider_id, email, phone });

  if (!rider) {
    return {
      ok: false,
      code: "rider_not_found",
      status: 404,
      message: "Rider account not found.",
      rider: null
    };
  }

  if (riderNeedsApproval(rider)) {
    return {
      ok: false,
      code: "rider_not_approved",
      status: 403,
      message: buildRiderAccessMessage(rider),
      rider
    };
  }

  return {
    ok: true,
    code: "rider_approved",
    status: 200,
    message: "Rider account is approved.",
    rider
  };
}

/* =========================================================
   RIDER SIGNUP ROUTE
========================================================= */
app.post("/api/rider/signup", async (req, res) => {
  try {
    if (!(await requireSupabaseOrFail(res))) return;

    const first_name = clean(req.body?.first_name || req.body?.firstname || "");
    const last_name = clean(req.body?.last_name || req.body?.lastname || "");
    const full_name =
      clean(req.body?.full_name || "") || `${first_name} ${last_name}`.trim();

    const email = clean(req.body?.email || "").toLowerCase();
    const phone = clean(req.body?.phone || "");
    const document_type = clean(req.body?.document_type || req.body?.documentType || "");
    const notes = clean(req.body?.notes || "");
    const rider_type = clean(req.body?.rider_type || "standard");

    if (!full_name) {
      return fail(res, "Full name is required", 400);
    }

    if (!isEmail(email)) {
      return fail(res, "A valid rider email is required", 400);
    }

    if (!phone) {
      return fail(res, "A rider phone number is required", 400);
    }

    const existingRider = await findRiderByEmail(email);

    if (existingRider) {
      return ok(
        res,
        {
          rider: sanitizeRider(existingRider),
          rider_id: existingRider.id,
          already_exists: true
        },
        riderIsApproved(existingRider)
          ? "Rider already exists and is approved"
          : "Rider already exists and is pending review"
      );
    }

    const newRiderPayload = {
      id: generateId("rider"),
      first_name,
      last_name,
      full_name,
      email,
      phone,
      rider_type,
      document_type,
      status: ENABLE_RIDER_VERIFICATION_GATE ? "pending" : "approved",
      access_status: ENABLE_RIDER_VERIFICATION_GATE ? "pending" : "approved",
      verification_status: ENABLE_RIDER_VERIFICATION_GATE ? "pending_review" : "approved",
      is_approved: ENABLE_RIDER_VERIFICATION_GATE ? false : true,
      approved_at: ENABLE_RIDER_VERIFICATION_GATE ? null : nowIso(),
      notes,
      created_at: nowIso(),
      updated_at: nowIso()
    };

    const rider = await insertRow("riders", newRiderPayload);

    await insertAdminLog(
      "rider_signup_created",
      {
        rider_id: rider?.id,
        email,
        phone,
        rider_type,
        gate_enabled: ENABLE_RIDER_VERIFICATION_GATE
      },
      req
    );

    return ok(
      res,
      {
        rider: sanitizeRider(rider),
        rider_id: rider.id
      },
      ENABLE_RIDER_VERIFICATION_GATE
        ? "Rider signup submitted. Approval is required before requesting rides."
        : "Rider signup completed."
    );
  } catch (error) {
    return serverError(res, error, "Rider signup failed");
  }
});

/* =========================================================
   RIDER STATUS LOOKUP
========================================================= */
app.post("/api/rider/status", async (req, res) => {
  try {
    if (!(await requireSupabaseOrFail(res))) return;

    const rider_id = clean(req.body?.rider_id || "");
    const email = clean(req.body?.email || "");
    const phone = clean(req.body?.phone || "");

    const rider = await resolveRiderIdentity({ rider_id, email, phone });

    if (!rider) {
      return fail(res, "Rider account not found", 404, {
        rider_id: rider_id || null,
        email: email || null,
        phone: phone || null
      });
    }

    return ok(
      res,
      {
        rider: sanitizeRider(rider),
        rider_id: rider.id,
        access: {
          gate_enabled: ENABLE_RIDER_VERIFICATION_GATE,
          is_approved: riderIsApproved(rider),
          can_request_ride: ENABLE_RIDER_VERIFICATION_GATE ? riderIsApproved(rider) : true,
          message: buildRiderAccessMessage(rider)
        }
      },
      "Rider status loaded"
    );
  } catch (error) {
    return serverError(res, error, "Rider status lookup failed");
  }
});

app.get("/api/rider/status", async (req, res) => {
  try {
    if (!(await requireSupabaseOrFail(res))) return;

    const rider_id = clean(req.query?.rider_id || "");
    const email = clean(req.query?.email || "");
    const phone = clean(req.query?.phone || "");

    const rider = await resolveRiderIdentity({ rider_id, email, phone });

    if (!rider) {
      return fail(res, "Rider account not found", 404);
    }

    return ok(
      res,
      {
        rider: sanitizeRider(rider),
        rider_id: rider.id,
        access: {
          gate_enabled: ENABLE_RIDER_VERIFICATION_GATE,
          is_approved: riderIsApproved(rider),
          can_request_ride: ENABLE_RIDER_VERIFICATION_GATE ? riderIsApproved(rider) : true,
          message: buildRiderAccessMessage(rider)
        }
      },
      "Rider status loaded"
    );
  } catch (error) {
    return serverError(res, error, "Rider status lookup failed");
  }
});

/* =========================================================
   RIDER ACCESS CHECK
========================================================= */
app.post("/api/rider/access-check", async (req, res) => {
  try {
    if (!(await requireSupabaseOrFail(res))) return;

    const rider_id = clean(req.body?.rider_id || "");
    const email = clean(req.body?.email || "");
    const phone = clean(req.body?.phone || "");

    const result = await requireApprovedRiderRecord({ rider_id, email, phone });

    if (!result.ok) {
      return fail(res, result.message, result.status, {
        code: result.code,
        rider: sanitizeRider(result.rider),
        access: {
          gate_enabled: ENABLE_RIDER_VERIFICATION_GATE,
          is_approved: false,
          can_request_ride: false
        }
      });
    }

    return ok(
      res,
      {
        code: result.code,
        rider: sanitizeRider(result.rider),
        access: {
          gate_enabled: ENABLE_RIDER_VERIFICATION_GATE,
          is_approved: true,
          can_request_ride: true
        }
      },
      "Rider is approved for ride requests"
    );
  } catch (error) {
    return serverError(res, error, "Rider access check failed");
  }
});

/* =========================================================
   ADMIN RIDER APPROVAL ROUTES
========================================================= */
app.post("/api/admin/riders/:riderId/approve", requireAdmin, async (req, res) => {
  try {
    if (!(await requireSupabaseOrFail(res))) return;

    const riderId = clean(req.params?.riderId || "");
    if (!riderId) {
      return fail(res, "Rider ID is required", 400);
    }

    const existing = await findRiderById(riderId);
    if (!existing) {
      return fail(res, "Rider not found", 404);
    }

    const updatedRows = await updateRows(
      "riders",
      { id: riderId },
      {
        status: "approved",
        access_status: "approved",
        verification_status: "approved",
        is_approved: true,
        approved_at: nowIso(),
        updated_at: nowIso()
      }
    );

    const updated = updatedRows?.[0] || (await findRiderById(riderId));

    await insertAdminLog(
      "rider_approved",
      {
        rider_id: riderId,
        rider_email: clean(existing.email)
      },
      req
    );

    return ok(
      res,
      {
        rider: sanitizeRider(updated),
        rider_id: riderId
      },
      "Rider approved successfully"
    );
  } catch (error) {
    return serverError(res, error, "Rider approval failed");
  }
});

app.post("/api/admin/riders/:riderId/reject", requireAdmin, async (req, res) => {
  try {
    if (!(await requireSupabaseOrFail(res))) return;

    const riderId = clean(req.params?.riderId || "");
    const reason = clean(req.body?.reason || req.body?.notes || "");

    if (!riderId) {
      return fail(res, "Rider ID is required", 400);
    }

    const existing = await findRiderById(riderId);
    if (!existing) {
      return fail(res, "Rider not found", 404);
    }

    const updatedRows = await updateRows(
      "riders",
      { id: riderId },
      {
        status: "rejected",
        access_status: "rejected",
        verification_status: "rejected",
        is_approved: false,
        approved_at: null,
        notes: reason || clean(existing.notes || ""),
        updated_at: nowIso()
      }
    );

    const updated = updatedRows?.[0] || (await findRiderById(riderId));

    await insertAdminLog(
      "rider_rejected",
      {
        rider_id: riderId,
        rider_email: clean(existing.email),
        reason
      },
      req
    );

    return ok(
      res,
      {
        rider: sanitizeRider(updated),
        rider_id: riderId
      },
      "Rider rejected successfully"
    );
  } catch (error) {
    return serverError(res, error, "Rider rejection failed");
  }
});

/* =========================================================
   ADMIN RIDER LIST
========================================================= */
app.get("/api/admin/riders", requireAdmin, async (req, res) => {
  try {
    if (!(await requireSupabaseOrFail(res))) return;

    const statusFilter = clean(req.query?.status || "");

    let query = supabase
      .from("riders")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);

    if (statusFilter) {
      query = query.eq("status", normalizeRiderStatus(statusFilter));
    }

    const { data, error } = await query;

    if (error) throw error;

    return ok(
      res,
      {
        riders: (data || []).map(sanitizeRider),
        total: Array.isArray(data) ? data.length : 0
      },
      "Admin rider list loaded"
    );
  } catch (error) {
    return serverError(res, error, "Admin rider list failed");
  }
});/* =========================================================
   PART 4: FARE ESTIMATE + PAYMENT AUTHORIZATION + REQUEST RIDE
========================================================= */

/* =========================================================
   PAYMENT HELPERS
========================================================= */
function normalizePaymentStatus(value = "") {
  const v = lower(value);

  if (["authorized", "preauthorized", "pre_authorized", "hold"].includes(v)) {
    return "authorized";
  }

  if (["captured", "paid", "completed"].includes(v)) {
    return "captured";
  }

  if (["released", "voided", "cancelled"].includes(v)) {
    return "released";
  }

  if (["failed", "declined", "error"].includes(v)) {
    return "failed";
  }

  if (["pending", "created", "awaiting"].includes(v)) {
    return "pending";
  }

  return "pending";
}

function paymentIsAuthorized(payment = null) {
  if (!payment) return false;

  const status = normalizePaymentStatus(payment.status || "");
  return Boolean(
    payment.is_authorized ||
      payment.authorized_at ||
      status === "authorized" ||
      status === "captured"
  );
}

function sanitizePayment(payment = null) {
  if (!payment) return null;

  return {
    id: clean(payment.id),
    rider_id: clean(payment.rider_id),
    ride_id: clean(payment.ride_id),
    amount: dollars(payment.amount || 0),
    amount_cents: Number(payment.amount_cents || cents(payment.amount || 0)),
    currency: clean(payment.currency || "usd").toLowerCase(),
    status: normalizePaymentStatus(payment.status),
    provider: clean(payment.provider || "internal"),
    payment_method_type: clean(payment.payment_method_type || "card"),
    authorization_code: clean(payment.authorization_code || ""),
    is_authorized: paymentIsAuthorized(payment),
    authorized_at: payment.authorized_at || null,
    captured_at: payment.captured_at || null,
    released_at: payment.released_at || null,
    created_at: payment.created_at || null,
    updated_at: payment.updated_at || null
  };
}

async function findLatestAuthorizedPaymentForRider(riderId = "") {
  if (!supabase || !clean(riderId)) return null;

  try {
    const { data, error } = await supabase
      .from("payments")
      .select("*")
      .eq("rider_id", clean(riderId))
      .order("created_at", { ascending: false })
      .limit(25);

    if (error) throw error;

    return (data || []).find((payment) => paymentIsAuthorized(payment)) || null;
  } catch (error) {
    console.warn("⚠️ Failed to find rider authorized payment:", error?.message || error);
    return null;
  }
}

async function findPaymentById(paymentId = "") {
  if (!supabase || !clean(paymentId)) return null;

  try {
    return await fetchSingle("payments", { id: clean(paymentId) });
  } catch (error) {
    console.warn("⚠️ Failed to find payment by id:", error?.message || error);
    return null;
  }
}

async function requireAuthorizedPaymentForRider({
  rider_id = "",
  payment_id = ""
} = {}) {
  let payment = null;

  if (payment_id) {
    payment = await findPaymentById(payment_id);
  }

  if (!payment && rider_id) {
    payment = await findLatestAuthorizedPaymentForRider(rider_id);
  }

  if (!ENABLE_PAYMENT_GATE) {
    return {
      ok: true,
      code: "payment_gate_disabled",
      status: 200,
      message: "Payment gate is disabled.",
      payment
    };
  }

  if (!payment) {
    return {
      ok: false,
      code: "payment_authorization_required",
      status: 402,
      message: "Payment authorization is required before dispatch.",
      payment: null
    };
  }

  if (!paymentIsAuthorized(payment)) {
    return {
      ok: false,
      code: "payment_not_authorized",
      status: 402,
      message: "Payment is not authorized yet.",
      payment
    };
  }

  return {
    ok: true,
    code: "payment_authorized",
    status: 200,
    message: "Payment is authorized.",
    payment
  };
}

/* =========================================================
   DISTANCE / DURATION HELPERS
========================================================= */
function haversineMiles(lat1, lon1, lat2, lon2) {
  const toRad = (deg) => (Number(deg) * Math.PI) / 180;

  const R = 3958.8;
  const dLat = toRad(Number(lat2) - Number(lat1));
  const dLon = toRad(Number(lon2) - Number(lon1));

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) ** 2;

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function estimateFallbackTripMetrics({
  pickup_lat,
  pickup_lng,
  dropoff_lat,
  dropoff_lng
} = {}) {
  const hasCoords =
    [pickup_lat, pickup_lng, dropoff_lat, dropoff_lng].every((v) =>
      Number.isFinite(Number(v))
    );

  if (!hasCoords) {
    return {
      distance_miles: 8,
      duration_minutes: 18,
      source: "fallback_default"
    };
  }

  const miles = haversineMiles(
    Number(pickup_lat),
    Number(pickup_lng),
    Number(dropoff_lat),
    Number(dropoff_lng)
  );

  const boostedMiles = Math.max(1, miles * 1.18);
  const minutes = Math.max(6, boostedMiles * 2.2);

  return {
    distance_miles: dollars(boostedMiles),
    duration_minutes: dollars(minutes),
    source: "fallback_haversine"
  };
}

/* =========================================================
   RIDE HELPERS
========================================================= */
function sanitizeRide(ride = null) {
  if (!ride) return null;

  return {
    id: clean(ride.id),
    rider_id: clean(ride.rider_id),
    driver_id: clean(ride.driver_id),
    payment_id: clean(ride.payment_id),
    mission_id: clean(ride.mission_id),
    requested_mode: normalizeRideMode(ride.requested_mode || ride.mode || "driver"),
    ride_type: clean(ride.ride_type || "standard"),
    status: normalizeRideStatus(ride.status || "pending"),
    pickup_address: clean(ride.pickup_address || ride.pickup || ""),
    dropoff_address: clean(ride.dropoff_address || ride.dropoff || ""),
    pickup_lat: ride.pickup_lat ?? null,
    pickup_lng: ride.pickup_lng ?? null,
    dropoff_lat: ride.dropoff_lat ?? null,
    dropoff_lng: ride.dropoff_lng ?? null,
    distance_miles: dollars(ride.distance_miles || 0),
    duration_minutes: dollars(ride.duration_minutes || 0),
    estimated_fare: dollars(ride.estimated_fare || 0),
    estimated_fare_cents: Number(ride.estimated_fare_cents || cents(ride.estimated_fare || 0)),
    surge_multiplier: Number(ride.surge_multiplier || 1),
    notes: clean(ride.notes || ""),
    requested_at: ride.requested_at || ride.created_at || null,
    created_at: ride.created_at || null,
    updated_at: ride.updated_at || null
  };
}

async function createTripEvent({
  ride_id = "",
  event_type = "",
  payload = {}
} = {}) {
  if (!supabase || !ride_id || !event_type) return null;

  const candidateTables = ["trip_events", "ride_events", "mission_events"];

  for (const table of candidateTables) {
    try {
      const { error } = await supabase.from(table).insert({
        id: generateId("evt"),
        ride_id: clean(ride_id),
        event_type: clean(event_type),
        payload,
        created_at: nowIso()
      });

      if (!error) return true;
    } catch (error) {
      // try next table
    }
  }

  return null;
}

/* =========================================================
   FARE ESTIMATE ROUTE
========================================================= */
app.post("/api/fare-estimate", async (req, res) => {
  try {
    const pickup_address = clean(req.body?.pickup_address || req.body?.pickup || "");
    const dropoff_address = clean(req.body?.dropoff_address || req.body?.dropoff || "");
    const requested_mode = normalizeRideMode(req.body?.requestedMode || req.body?.requested_mode || "driver");
    const ride_type = clean(req.body?.ride_type || "standard");
    const demand_level = clean(req.body?.demand_level || "normal");

    const pickup_lat = Number(req.body?.pickup_lat);
    const pickup_lng = Number(req.body?.pickup_lng);
    const dropoff_lat = Number(req.body?.dropoff_lat);
    const dropoff_lng = Number(req.body?.dropoff_lng);

    if (!pickup_address) {
      return fail(res, "Pickup address is required", 400);
    }

    if (!dropoff_address) {
      return fail(res, "Dropoff address is required", 400);
    }

    const metrics = estimateFallbackTripMetrics({
      pickup_lat,
      pickup_lng,
      dropoff_lat,
      dropoff_lng
    });

    const estimate = computeFareEstimate({
      distanceMiles: metrics.distance_miles,
      durationMinutes: metrics.duration_minutes,
      requestedMode: requested_mode,
      rideType: ride_type,
      demandLevel: demand_level
    });

    return ok(
      res,
      {
        estimate: {
          ...estimate,
          pickup_address,
          dropoff_address,
          metrics_source: metrics.source
        }
      },
      "Fare estimate generated"
    );
  } catch (error) {
    return serverError(res, error, "Fare estimate failed");
  }
});

/* =========================================================
   PAYMENT AUTHORIZATION ROUTES
========================================================= */
app.post("/api/payments/authorize", async (req, res) => {
  try {
    if (!(await requireSupabaseOrFail(res))) return;

    const rider_id = clean(req.body?.rider_id || "");
    const amount = Number(req.body?.amount || req.body?.estimated_fare || 0);
    const amount_cents = Number(req.body?.amount_cents || cents(amount));
    const currency = clean(req.body?.currency || "usd").toLowerCase();
    const provider = clean(req.body?.provider || "internal");
    const payment_method_type = clean(req.body?.payment_method_type || "card");
    const ride_id = clean(req.body?.ride_id || "");

    if (!rider_id) {
      return fail(res, "Rider ID is required", 400);
    }

    const riderResult = await requireApprovedRiderRecord({ rider_id });
    if (!riderResult.ok) {
      return fail(res, riderResult.message, riderResult.status, {
        code: riderResult.code,
        rider: sanitizeRider(riderResult.rider)
      });
    }

    if (!amount_cents || amount_cents < 100) {
      return fail(res, "A valid authorization amount is required", 400);
    }

    const paymentPayload = {
      id: generateId("pay"),
      rider_id,
      ride_id: ride_id || null,
      amount: dollars(amount_cents / 100),
      amount_cents,
      currency,
      provider,
      payment_method_type,
      status: "authorized",
      is_authorized: true,
      authorization_code: `AUTH-${crypto.randomBytes(4).toString("hex").toUpperCase()}`,
      authorized_at: nowIso(),
      created_at: nowIso(),
      updated_at: nowIso()
    };

    const payment = await insertRow("payments", paymentPayload);

    await insertAdminLog(
      "payment_authorized",
      {
        payment_id: payment?.id,
        rider_id,
        ride_id: ride_id || null,
        amount_cents
      },
      req
    );

    return ok(
      res,
      {
        payment: sanitizePayment(payment),
        payment_id: payment.id
      },
      "Payment authorized successfully"
    );
  } catch (error) {
    return serverError(res, error, "Payment authorization failed");
  }
});

app.post("/api/payments/status", async (req, res) => {
  try {
    if (!(await requireSupabaseOrFail(res))) return;

    const payment_id = clean(req.body?.payment_id || "");
    const rider_id = clean(req.body?.rider_id || "");

    let payment = null;

    if (payment_id) {
      payment = await findPaymentById(payment_id);
    } else if (rider_id) {
      payment = await findLatestAuthorizedPaymentForRider(rider_id);
    }

    if (!payment) {
      return fail(res, "Payment record not found", 404);
    }

    return ok(
      res,
      {
        payment: sanitizePayment(payment),
        is_authorized: paymentIsAuthorized(payment)
      },
      "Payment status loaded"
    );
  } catch (error) {
    return serverError(res, error, "Payment status lookup failed");
  }
});

app.get("/api/payments/status", async (req, res) => {
  try {
    if (!(await requireSupabaseOrFail(res))) return;

    const payment_id = clean(req.query?.payment_id || "");
    const rider_id = clean(req.query?.rider_id || "");

    let payment = null;

    if (payment_id) {
      payment = await findPaymentById(payment_id);
    } else if (rider_id) {
      payment = await findLatestAuthorizedPaymentForRider(rider_id);
    }

    if (!payment) {
      return fail(res, "Payment record not found", 404);
    }

    return ok(
      res,
      {
        payment: sanitizePayment(payment),
        is_authorized: paymentIsAuthorized(payment)
      },
      "Payment status loaded"
    );
  } catch (error) {
    return serverError(res, error, "Payment status lookup failed");
  }
});

/* =========================================================
   REQUEST RIDE ROUTE
========================================================= */
app.post("/api/request-ride", async (req, res) => {
  try {
    if (!(await requireSupabaseOrFail(res))) return;

    const rider_id = clean(req.body?.rider_id || "");
    const email = clean(req.body?.email || "");
    const phone = clean(req.body?.phone || "");

    const pickup_address = clean(req.body?.pickup_address || req.body?.pickup || "");
    const dropoff_address = clean(req.body?.dropoff_address || req.body?.dropoff || "");

    const pickup_lat = req.body?.pickup_lat ?? null;
    const pickup_lng = req.body?.pickup_lng ?? null;
    const dropoff_lat = req.body?.dropoff_lat ?? null;
    const dropoff_lng = req.body?.dropoff_lng ?? null;

    const requested_mode = normalizeRideMode(
      req.body?.requestedMode || req.body?.requested_mode || "driver"
    );
    const ride_type = clean(req.body?.ride_type || "standard");
    const payment_id = clean(req.body?.payment_id || "");
    const notes = clean(req.body?.notes || "");
    const scheduled_time = clean(req.body?.scheduled_time || req.body?.scheduledTime || "");

    if (!pickup_address) {
      return fail(res, "Pickup address is required", 400);
    }

    if (!dropoff_address) {
      return fail(res, "Dropoff address is required", 400);
    }

    const riderResult = await requireApprovedRiderRecord({
      rider_id,
      email,
      phone
    });

    if (!riderResult.ok) {
      return fail(res, riderResult.message, riderResult.status, {
        code: riderResult.code,
        rider: sanitizeRider(riderResult.rider),
        access: {
          gate_enabled: ENABLE_RIDER_VERIFICATION_GATE,
          can_request_ride: false
        }
      });
    }

    const rider = riderResult.rider;

    const metrics = estimateFallbackTripMetrics({
      pickup_lat,
      pickup_lng,
      dropoff_lat,
      dropoff_lng
    });

    const estimate = computeFareEstimate({
      distanceMiles: metrics.distance_miles,
      durationMinutes: metrics.duration_minutes,
      requestedMode: requested_mode,
      rideType: ride_type,
      demandLevel: "normal"
    });

    const paymentResult = await requireAuthorizedPaymentForRider({
      rider_id: rider.id,
      payment_id
    });

    if (!paymentResult.ok) {
      return fail(res, paymentResult.message, paymentResult.status, {
        code: paymentResult.code,
        rider: sanitizeRider(rider),
        payment: sanitizePayment(paymentResult.payment),
        payment_gate_enabled: ENABLE_PAYMENT_GATE
      });
    }

    const ridePayload = {
      id: generateId("ride"),
      rider_id: rider.id,
      payment_id: paymentResult.payment?.id || payment_id || null,
      mission_id: null,
      driver_id: null,
      requested_mode,
      mode: requested_mode,
      ride_type,
      status: ENABLE_PAYMENT_GATE ? "awaiting_dispatch" : "pending",
      pickup_address,
      dropoff_address,
      pickup_lat,
      pickup_lng,
      dropoff_lat,
      dropoff_lng,
      distance_miles: estimate.distance_miles,
      duration_minutes: estimate.duration_minutes,
      estimated_fare: estimate.estimated_fare,
      estimated_fare_cents: estimate.estimated_fare_cents,
      surge_multiplier: estimate.surge_multiplier,
      booking_fee: estimate.booking_fee,
      notes,
      scheduled_time: scheduled_time || null,
      requested_at: nowIso(),
      created_at: nowIso(),
      updated_at: nowIso()
    };

    const ride = await insertRow("rides", ridePayload);

    if (paymentResult.payment?.id && !paymentResult.payment?.ride_id) {
      try {
        await updateRows(
          "payments",
          { id: paymentResult.payment.id },
          {
            ride_id: ride.id,
            updated_at: nowIso()
          }
        );
      } catch (error) {
        console.warn("⚠️ Failed to attach payment to ride:", error?.message || error);
      }
    }

    await createTripEvent({
      ride_id: ride.id,
      event_type: "ride_requested",
      payload: {
        rider_id: rider.id,
        requested_mode,
        ride_type,
        payment_id: paymentResult.payment?.id || null
      }
    });

    await insertAdminLog(
      "ride_requested",
      {
        ride_id: ride.id,
        rider_id: rider.id,
        requested_mode,
        ride_type,
        payment_id: paymentResult.payment?.id || null
      },
      req
    );

    return ok(
      res,
      {
        ride: sanitizeRide(ride),
        ride_id: ride.id,
        rider: sanitizeRider(rider),
        payment: sanitizePayment(paymentResult.payment),
        estimate
      },
      "Ride request submitted and ready for dispatch"
    );
  } catch (error) {
    return serverError(res, error, "Ride request failed");
  }
});

/* =========================================================
   RIDER RIDES ROUTES
========================================================= */
app.get("/api/rider/rides", async (req, res) => {
  try {
    if (!(await requireSupabaseOrFail(res))) return;

    const rider_id = clean(req.query?.rider_id || "");
    if (!rider_id) {
      return fail(res, "Rider ID is required", 400);
    }

    const { data, error } = await supabase
      .from("rides")
      .select("*")
      .eq("rider_id", rider_id)
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) throw error;

    return ok(
      res,
      {
        rides: (data || []).map(sanitizeRide),
        total: Array.isArray(data) ? data.length : 0
      },
      "Rider rides loaded"
    );
  } catch (error) {
    return serverError(res, error, "Rider rides lookup failed");
  }
});

app.get("/api/rides/:rideId", async (req, res) => {
  try {
    if (!(await requireSupabaseOrFail(res))) return;

    const rideId = clean(req.params?.rideId || "");
    if (!rideId) {
      return fail(res, "Ride ID is required", 400);
    }

    const ride = await findRideById(rideId);

    if (!ride) {
      return fail(res, "Ride not found", 404);
    }

    return ok(
      res,
      {
        ride: sanitizeRide(ride)
      },
      "Ride loaded"
    );
  } catch (error) {
    return serverError(res, error, "Ride lookup failed");
  }
});/* =========================================================
   PART 5: DRIVER SIGNUP + VERIFICATION STATE + APPROVAL + MISSION VIEW
========================================================= */

/* =========================================================
   DRIVER HELPERS
========================================================= */
function normalizeDriverStatus(value = "") {
  const v = lower(value);

  if (["approved", "active", "online"].includes(v)) return "approved";
  if (["rejected", "denied", "blocked", "suspended"].includes(v)) return "rejected";
  if (["pending_review", "review"].includes(v)) return "pending";
  if (["pending", "submitted", "awaiting_review", "awaiting_approval"].includes(v)) return "pending";

  return "pending";
}

function driverIsApproved(driver = null) {
  if (!driver) return false;

  const status = normalizeDriverStatus(driver.status || "");
  return Boolean(
    driver.is_approved ||
      driver.approved_at ||
      status === "approved"
  );
}

function driverIsVerified(driver = null) {
  if (!driver) return false;

  return Boolean(
    driver.is_verified ||
      (driver.email_verified && driver.sms_verified)
  );
}

function driverCanGoLive(driver = null) {
  if (!driver) return false;
  return driverIsApproved(driver) && driverIsVerified(driver);
}

function sanitizeDriver(driver = null) {
  if (!driver) return null;

  return {
    id: clean(driver.id),
    first_name: clean(driver.first_name),
    last_name: clean(driver.last_name),
    full_name: clean(
      driver.full_name ||
        `${clean(driver.first_name)} ${clean(driver.last_name)}`.trim()
    ),
    email: clean(driver.email),
    phone: clean(driver.phone),
    driver_type: normalizeDriverType(driver.driver_type || "human"),
    status: normalizeDriverStatus(driver.status),
    is_approved: driverIsApproved(driver),
    approved_at: driver.approved_at || null,
    is_verified: driverIsVerified(driver),
    email_verified: Boolean(driver.email_verified),
    email_verified_at: driver.email_verified_at || null,
    sms_verified: Boolean(driver.sms_verified),
    sms_verified_at: driver.sms_verified_at || null,
    can_go_live: driverCanGoLive(driver),
    is_available: Boolean(driver.is_available),
    vehicle_make: clean(driver.vehicle_make),
    vehicle_model: clean(driver.vehicle_model),
    vehicle_year: clean(driver.vehicle_year),
    license_plate: clean(driver.license_plate),
    created_at: driver.created_at || null,
    updated_at: driver.updated_at || null,
    notes: clean(driver.notes || "")
  };
}

async function findDriverByEmail(email = "") {
  if (!supabase || !isEmail(email)) return null;

  try {
    const { data, error } = await supabase
      .from("drivers")
      .select("*")
      .ilike("email", clean(email))
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    return data;
  } catch (error) {
    console.warn("⚠️ Failed to find driver by email:", error?.message || error);
    return null;
  }
}

async function findDriverByPhone(phone = "") {
  if (!supabase || !clean(phone)) return null;

  try {
    const { data, error } = await supabase
      .from("drivers")
      .select("*")
      .eq("phone", clean(phone))
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    return data;
  } catch (error) {
    console.warn("⚠️ Failed to find driver by phone:", error?.message || error);
    return null;
  }
}

async function resolveDriverIdentity({ driver_id = "", email = "", phone = "" } = {}) {
  if (!supabase) return null;

  if (clean(driver_id)) {
    const byId = await findDriverById(driver_id);
    if (byId) return byId;
  }

  if (isEmail(email)) {
    const byEmail = await findDriverByEmail(email);
    if (byEmail) return byEmail;
  }

  if (clean(phone)) {
    const byPhone = await findDriverByPhone(phone);
    if (byPhone) return byPhone;
  }

  return null;
}

function buildDriverAccessMessage(driver = null) {
  if (!driver) {
    return "Driver account not found.";
  }

  if (!driverIsVerified(driver)) {
    return "Driver verification is not complete yet. Email and SMS verification must be completed before going live.";
  }

  if (!driverIsApproved(driver)) {
    return "Driver account is still pending approval.";
  }

  return "Driver account is approved and verified.";
}

async function requireApprovedVerifiedDriver({
  driver_id = "",
  email = "",
  phone = ""
} = {}) {
  const driver = await resolveDriverIdentity({ driver_id, email, phone });

  if (!driver) {
    return {
      ok: false,
      code: "driver_not_found",
      status: 404,
      message: "Driver account not found.",
      driver: null
    };
  }

  if (!driverIsVerified(driver)) {
    return {
      ok: false,
      code: "driver_not_verified",
      status: 403,
      message: buildDriverAccessMessage(driver),
      driver
    };
  }

  if (!driverIsApproved(driver)) {
    return {
      ok: false,
      code: "driver_not_approved",
      status: 403,
      message: buildDriverAccessMessage(driver),
      driver
    };
  }

  return {
    ok: true,
    code: "driver_ready",
    status: 200,
    message: "Driver is verified and approved.",
    driver
  };
}

/* =========================================================
   DRIVER SIGNUP
========================================================= */
app.post("/api/driver/signup", async (req, res) => {
  try {
    if (!(await requireSupabaseOrFail(res))) return;

    const first_name = clean(req.body?.first_name || req.body?.firstname || "");
    const last_name = clean(req.body?.last_name || req.body?.lastname || "");
    const full_name =
      clean(req.body?.full_name || "") || `${first_name} ${last_name}`.trim();

    const email = clean(req.body?.email || "").toLowerCase();
    const phone = clean(req.body?.phone || "");
    const driver_type = normalizeDriverType(req.body?.driver_type || "human");

    const vehicle_make = clean(req.body?.vehicle_make || "");
    const vehicle_model = clean(req.body?.vehicle_model || "");
    const vehicle_year = clean(req.body?.vehicle_year || "");
    const license_plate = clean(req.body?.license_plate || "");
    const notes = clean(req.body?.notes || "");

    if (!full_name) {
      return fail(res, "Full name is required", 400);
    }

    if (!isEmail(email)) {
      return fail(res, "A valid driver email is required", 400);
    }

    if (!phone) {
      return fail(res, "A driver phone number is required", 400);
    }

    const existingDriver = await findDriverByEmail(email);

    if (existingDriver) {
      return ok(
        res,
        {
          driver: sanitizeDriver(existingDriver),
          driver_id: existingDriver.id,
          already_exists: true
        },
        "Driver already exists"
      );
    }

    const newDriverPayload = {
      id: generateId("driver"),
      first_name,
      last_name,
      full_name,
      email,
      phone,
      driver_type,
      vehicle_make,
      vehicle_model,
      vehicle_year,
      license_plate,
      status: "pending",
      is_approved: false,
      approved_at: null,
      is_verified: false,
      email_verified: false,
      email_verified_at: null,
      sms_verified: false,
      sms_verified_at: null,
      is_available: false,
      notes,
      created_at: nowIso(),
      updated_at: nowIso()
    };

    const driver = await insertRow("drivers", newDriverPayload);

    await insertAdminLog(
      "driver_signup_created",
      {
        driver_id: driver?.id,
        email,
        phone,
        driver_type
      },
      req
    );

    return ok(
      res,
      {
        driver: sanitizeDriver(driver),
        driver_id: driver.id,
        verification: {
          email_verified: false,
          sms_verified: false,
          next_step: "complete_email_and_sms_verification"
        }
      },
      "Driver signup submitted. Email verification, SMS verification, and admin approval are required before going live."
    );
  } catch (error) {
    return serverError(res, error, "Driver signup failed");
  }
});

/* =========================================================
   DRIVER STATUS
========================================================= */
app.post("/api/driver/status", async (req, res) => {
  try {
    if (!(await requireSupabaseOrFail(res))) return;

    const driver_id = clean(req.body?.driver_id || "");
    const email = clean(req.body?.email || "");
    const phone = clean(req.body?.phone || "");

    const driver = await resolveDriverIdentity({ driver_id, email, phone });

    if (!driver) {
      return fail(res, "Driver account not found", 404);
    }

    return ok(
      res,
      {
        driver: sanitizeDriver(driver),
        access: {
          is_verified: driverIsVerified(driver),
          is_approved: driverIsApproved(driver),
          can_go_live: driverCanGoLive(driver),
          message: buildDriverAccessMessage(driver)
        }
      },
      "Driver status loaded"
    );
  } catch (error) {
    return serverError(res, error, "Driver status lookup failed");
  }
});

app.get("/api/driver/status", async (req, res) => {
  try {
    if (!(await requireSupabaseOrFail(res))) return;

    const driver_id = clean(req.query?.driver_id || "");
    const email = clean(req.query?.email || "");
    const phone = clean(req.query?.phone || "");

    const driver = await resolveDriverIdentity({ driver_id, email, phone });

    if (!driver) {
      return fail(res, "Driver account not found", 404);
    }

    return ok(
      res,
      {
        driver: sanitizeDriver(driver),
        access: {
          is_verified: driverIsVerified(driver),
          is_approved: driverIsApproved(driver),
          can_go_live: driverCanGoLive(driver),
          message: buildDriverAccessMessage(driver)
        }
      },
      "Driver status loaded"
    );
  } catch (error) {
    return serverError(res, error, "Driver status lookup failed");
  }
});

/* =========================================================
   DRIVER VERIFICATION ROUTES
========================================================= */
app.post("/api/driver/verify-email", async (req, res) => {
  try {
    if (!(await requireSupabaseOrFail(res))) return;

    const driver_id = clean(req.body?.driver_id || "");
    if (!driver_id) {
      return fail(res, "Driver ID is required", 400);
    }

    const driver = await findDriverById(driver_id);
    if (!driver) {
      return fail(res, "Driver not found", 404);
    }

    const updatedRows = await updateRows(
      "drivers",
      { id: driver_id },
      {
        email_verified: true,
        email_verified_at: nowIso(),
        is_verified: Boolean(driver.sms_verified),
        updated_at: nowIso()
      }
    );

    const updated = updatedRows?.[0] || (await findDriverById(driver_id));

    await insertAdminLog(
      "driver_email_verified",
      {
        driver_id,
        driver_email: clean(driver.email)
      },
      req
    );

    return ok(
      res,
      {
        driver: sanitizeDriver(updated)
      },
      "Driver email marked as verified"
    );
  } catch (error) {
    return serverError(res, error, "Driver email verification update failed");
  }
});

app.post("/api/driver/verify-sms", async (req, res) => {
  try {
    if (!(await requireSupabaseOrFail(res))) return;

    const driver_id = clean(req.body?.driver_id || "");
    if (!driver_id) {
      return fail(res, "Driver ID is required", 400);
    }

    const driver = await findDriverById(driver_id);
    if (!driver) {
      return fail(res, "Driver not found", 404);
    }

    const updatedRows = await updateRows(
      "drivers",
      { id: driver_id },
      {
        sms_verified: true,
        sms_verified_at: nowIso(),
        is_verified: Boolean(driver.email_verified),
        updated_at: nowIso()
      }
    );

    const updated = updatedRows?.[0] || (await findDriverById(driver_id));

    await insertAdminLog(
      "driver_sms_verified",
      {
        driver_id,
        driver_phone: clean(driver.phone)
      },
      req
    );

    return ok(
      res,
      {
        driver: sanitizeDriver(updated)
      },
      "Driver SMS marked as verified"
    );
  } catch (error) {
    return serverError(res, error, "Driver SMS verification update failed");
  }
});

app.post("/api/driver/verification-complete", async (req, res) => {
  try {
    if (!(await requireSupabaseOrFail(res))) return;

    const driver_id = clean(req.body?.driver_id || "");
    if (!driver_id) {
      return fail(res, "Driver ID is required", 400);
    }

    const driver = await findDriverById(driver_id);
    if (!driver) {
      return fail(res, "Driver not found", 404);
    }

    const emailVerified = Boolean(driver.email_verified);
    const smsVerified = Boolean(driver.sms_verified);
    const fullyVerified = emailVerified && smsVerified;

    const updatedRows = await updateRows(
      "drivers",
      { id: driver_id },
      {
        is_verified: fullyVerified,
        updated_at: nowIso()
      }
    );

    const updated = updatedRows?.[0] || (await findDriverById(driver_id));

    return ok(
      res,
      {
        driver: sanitizeDriver(updated),
        verification: {
          email_verified: emailVerified,
          sms_verified: smsVerified,
          is_verified: fullyVerified
        }
      },
      fullyVerified
        ? "Driver verification is complete"
        : "Driver verification is still incomplete"
    );
  } catch (error) {
    return serverError(res, error, "Driver verification completion check failed");
  }
});

/* =========================================================
   ADMIN DRIVER APPROVAL
========================================================= */
app.post("/api/admin/drivers/:driverId/approve", requireAdmin, async (req, res) => {
  try {
    if (!(await requireSupabaseOrFail(res))) return;

    const driverId = clean(req.params?.driverId || "");
    if (!driverId) {
      return fail(res, "Driver ID is required", 400);
    }

    const existing = await findDriverById(driverId);
    if (!existing) {
      return fail(res, "Driver not found", 404);
    }

    const updatedRows = await updateRows(
      "drivers",
      { id: driverId },
      {
        status: "approved",
        is_approved: true,
        approved_at: nowIso(),
        updated_at: nowIso()
      }
    );

    const updated = updatedRows?.[0] || (await findDriverById(driverId));

    await insertAdminLog(
      "driver_approved",
      {
        driver_id: driverId,
        driver_email: clean(existing.email)
      },
      req
    );

    return ok(
      res,
      {
        driver: sanitizeDriver(updated)
      },
      "Driver approved successfully"
    );
  } catch (error) {
    return serverError(res, error, "Driver approval failed");
  }
});

app.post("/api/admin/drivers/:driverId/reject", requireAdmin, async (req, res) => {
  try {
    if (!(await requireSupabaseOrFail(res))) return;

    const driverId = clean(req.params?.driverId || "");
    const reason = clean(req.body?.reason || req.body?.notes || "");

    if (!driverId) {
      return fail(res, "Driver ID is required", 400);
    }

    const existing = await findDriverById(driverId);
    if (!existing) {
      return fail(res, "Driver not found", 404);
    }

    const updatedRows = await updateRows(
      "drivers",
      { id: driverId },
      {
        status: "rejected",
        is_approved: false,
        approved_at: null,
        is_available: false,
        notes: reason || clean(existing.notes || ""),
        updated_at: nowIso()
      }
    );

    const updated = updatedRows?.[0] || (await findDriverById(driverId));

    await insertAdminLog(
      "driver_rejected",
      {
        driver_id: driverId,
        driver_email: clean(existing.email),
        reason
      },
      req
    );

    return ok(
      res,
      {
        driver: sanitizeDriver(updated)
      },
      "Driver rejected successfully"
    );
  } catch (error) {
    return serverError(res, error, "Driver rejection failed");
  }
});

/* =========================================================
   DRIVER AVAILABILITY
========================================================= */
app.post("/api/driver/availability", async (req, res) => {
  try {
    if (!(await requireSupabaseOrFail(res))) return;

    const driver_id = clean(req.body?.driver_id || "");
    const is_available = Boolean(req.body?.is_available);

    if (!driver_id) {
      return fail(res, "Driver ID is required", 400);
    }

    const readiness = await requireApprovedVerifiedDriver({ driver_id });

    if (!readiness.ok) {
      return fail(res, readiness.message, readiness.status, {
        code: readiness.code,
        driver: sanitizeDriver(readiness.driver)
      });
    }

    const updatedRows = await updateRows(
      "drivers",
      { id: driver_id },
      {
        is_available,
        status: driverIsApproved(readiness.driver)
          ? "approved"
          : normalizeDriverStatus(readiness.driver.status),
        updated_at: nowIso()
      }
    );

    const updated = updatedRows?.[0] || (await findDriverById(driver_id));

    await insertAdminLog(
      "driver_availability_changed",
      {
        driver_id,
        is_available
      },
      req
    );

    return ok(
      res,
      {
        driver: sanitizeDriver(updated)
      },
      is_available ? "Driver is now available" : "Driver is now unavailable"
    );
  } catch (error) {
    return serverError(res, error, "Driver availability update failed");
  }
});

/* =========================================================
   DRIVER MISSION VIEW
========================================================= */
function sanitizeMissionView({ ride = null, rider = null } = {}) {
  if (!ride) return null;

  return {
    ride_id: clean(ride.id),
    rider_id: clean(ride.rider_id),
    requested_mode: normalizeRideMode(ride.requested_mode || ride.mode || "driver"),
    ride_type: clean(ride.ride_type || "standard"),
    status: normalizeRideStatus(ride.status || "pending"),
    pickup_address: clean(ride.pickup_address || ""),
    dropoff_address: clean(ride.dropoff_address || ""),
    distance_miles: dollars(ride.distance_miles || 0),
    duration_minutes: dollars(ride.duration_minutes || 0),
    estimated_fare: dollars(ride.estimated_fare || 0),
    notes: clean(ride.notes || ""),
    scheduled_time: ride.scheduled_time || null,
    rider: rider
      ? {
          first_name: clean(rider.first_name),
          last_name: clean(rider.last_name),
          full_name: clean(
            rider.full_name ||
              `${clean(rider.first_name)} ${clean(rider.last_name)}`.trim()
          ),
          rating: rider.rating ?? null
        }
      : null
  };
}

app.get("/api/driver/missions", async (req, res) => {
  try {
    if (!(await requireSupabaseOrFail(res))) return;

    const driver_id = clean(req.query?.driver_id || "");
    if (!driver_id) {
      return fail(res, "Driver ID is required", 400);
    }

    const readiness = await requireApprovedVerifiedDriver({ driver_id });

    if (!readiness.ok) {
      return fail(res, readiness.message, readiness.status, {
        code: readiness.code,
        driver: sanitizeDriver(readiness.driver)
      });
    }

    const { data: rides, error } = await supabase
      .from("rides")
      .select("*")
      .in("status", ["awaiting_dispatch", "awaiting_driver_acceptance", "offered", "dispatched"])
      .eq("requested_mode", "driver")
      .order("created_at", { ascending: true })
      .limit(25);

    if (error) throw error;

    const riderIds = [...new Set((rides || []).map((ride) => clean(ride.rider_id)).filter(Boolean))];

    let ridersMap = new Map();
    if (riderIds.length > 0) {
      const { data: ridersData } = await supabase
        .from("riders")
        .select("*")
        .in("id", riderIds);

      ridersMap = new Map((ridersData || []).map((rider) => [clean(rider.id), rider]));
    }

    const missions = (rides || []).map((ride) =>
      sanitizeMissionView({
        ride,
        rider: ridersMap.get(clean(ride.rider_id)) || null
      })
    );

    return ok(
      res,
      {
        missions,
        total: missions.length
      },
      "Driver mission queue loaded"
    );
  } catch (error) {
    return serverError(res, error, "Driver missions lookup failed");
  }
});

app.get("/api/driver/current-ride", async (req, res) => {
  try {
    if (!(await requireSupabaseOrFail(res))) return;

    const driver_id = clean(req.query?.driver_id || "");
    if (!driver_id) {
      return fail(res, "Driver ID is required", 400);
    }

    const readiness = await requireApprovedVerifiedDriver({ driver_id });

    if (!readiness.ok) {
      return fail(res, readiness.message, readiness.status, {
        code: readiness.code,
        driver: sanitizeDriver(readiness.driver)
      });
    }

    const { data, error } = await supabase
      .from("rides")
      .select("*")
      .eq("driver_id", driver_id)
      .in("status", ["awaiting_driver_acceptance", "dispatched", "driver_en_route", "arrived", "in_progress"])
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;

    if (!data) {
      return ok(
        res,
        {
          ride: null
        },
        "Driver has no active ride"
      );
    }

    const rider = data.rider_id ? await findRiderById(data.rider_id) : null;

    return ok(
      res,
      {
        ride: sanitizeRide(data),
        mission: sanitizeMissionView({ ride: data, rider })
      },
      "Driver current ride loaded"
    );
  } catch (error) {
    return serverError(res, error, "Driver current ride lookup failed");
  }
});

/* =========================================================
   ADMIN DRIVER LIST
========================================================= */
app.get("/api/admin/drivers", requireAdmin, async (req, res) => {
  try {
    if (!(await requireSupabaseOrFail(res))) return;

    const statusFilter = clean(req.query?.status || "");
    const driverTypeFilter = clean(req.query?.driver_type || "");

    let query = supabase
      .from("drivers")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);

    if (statusFilter) {
      query = query.eq("status", normalizeDriverStatus(statusFilter));
    }

    if (driverTypeFilter) {
      query = query.eq("driver_type", normalizeDriverType(driverTypeFilter));
    }

    const { data, error } = await query;
    if (error) throw error;

    return ok(
      res,
      {
        drivers: (data || []).map(sanitizeDriver),
        total: Array.isArray(data) ? data.length : 0
      },
      "Admin driver list loaded"
    );
  } catch (error) {
    return serverError(res, error, "Admin driver list failed");
  }
});/* =========================================================
   PART 6: DISPATCH BRAIN + MISSION ASSIGNMENT + ACCEPT / DECLINE FLOW
========================================================= */

/* =========================================================
   DISPATCH HELPERS
========================================================= */
function normalizeDispatchStatus(value = "") {
  const v = lower(value);

  if (["offered", "sent"].includes(v)) return "offered";
  if (["accepted", "claimed"].includes(v)) return "accepted";
  if (["declined", "rejected"].includes(v)) return "declined";
  if (["expired", "timed_out", "timeout"].includes(v)) return "expired";
  if (["cancelled", "canceled"].includes(v)) return "cancelled";
  if (["failed"].includes(v)) return "failed";

  return "offered";
}

function normalizeMissionStatus(value = "") {
  const v = lower(value);

  if (["offered"].includes(v)) return "offered";
  if (["accepted", "assigned"].includes(v)) return "accepted";
  if (["declined"].includes(v)) return "declined";
  if (["expired"].includes(v)) return "expired";
  if (["cancelled", "canceled"].includes(v)) return "cancelled";
  if (["completed", "done"].includes(v)) return "completed";
  if (["in_progress"].includes(v)) return "in_progress";

  return "offered";
}

function sanitizeDispatch(dispatch = null) {
  if (!dispatch) return null;

  return {
    id: clean(dispatch.id),
    ride_id: clean(dispatch.ride_id),
    driver_id: clean(dispatch.driver_id),
    mission_id: clean(dispatch.mission_id),
    attempt_number: Number(dispatch.attempt_number || 1),
    status: normalizeDispatchStatus(dispatch.status),
    offer_expires_at: dispatch.offer_expires_at || null,
    responded_at: dispatch.responded_at || null,
    response_reason: clean(dispatch.response_reason || ""),
    created_at: dispatch.created_at || null,
    updated_at: dispatch.updated_at || null
  };
}

function sanitizeMission(mission = null) {
  if (!mission) return null;

  return {
    id: clean(mission.id),
    ride_id: clean(mission.ride_id),
    rider_id: clean(mission.rider_id),
    driver_id: clean(mission.driver_id),
    requested_mode: normalizeRideMode(mission.requested_mode || "driver"),
    status: normalizeMissionStatus(mission.status),
    attempt_number: Number(mission.attempt_number || 1),
    pickup_address: clean(mission.pickup_address || ""),
    dropoff_address: clean(mission.dropoff_address || ""),
    estimated_fare: dollars(mission.estimated_fare || 0),
    notes: clean(mission.notes || ""),
    expires_at: mission.expires_at || null,
    accepted_at: mission.accepted_at || null,
    declined_at: mission.declined_at || null,
    created_at: mission.created_at || null,
    updated_at: mission.updated_at || null
  };
}

function addSecondsToIso(seconds = 0) {
  return new Date(Date.now() + Number(seconds || 0) * 1000).toISOString();
}

function isExpiredIso(isoValue = "") {
  const ts = new Date(isoValue).getTime();
  if (!Number.isFinite(ts)) return false;
  return ts <= Date.now();
}

async function findMissionById(missionId = "") {
  if (!supabase || !clean(missionId)) return null;

  try {
    return await fetchSingle("missions", { id: clean(missionId) });
  } catch (error) {
    console.warn("⚠️ Failed to find mission by id:", error?.message || error);
    return null;
  }
}

async function findDispatchById(dispatchId = "") {
  if (!supabase || !clean(dispatchId)) return null;

  try {
    return await fetchSingle("dispatches", { id: clean(dispatchId) });
  } catch (error) {
    console.warn("⚠️ Failed to find dispatch by id:", error?.message || error);
    return null;
  }
}

async function listDispatchesForRide(rideId = "") {
  if (!supabase || !clean(rideId)) return [];

  try {
    const { data, error } = await supabase
      .from("dispatches")
      .select("*")
      .eq("ride_id", clean(rideId))
      .order("created_at", { ascending: true });

    if (error) throw error;
    return data || [];
  } catch (error) {
    console.warn("⚠️ Failed to list dispatches for ride:", error?.message || error);
    return [];
  }
}

async function getDispatchAttemptNumber(rideId = "") {
  const dispatches = await listDispatchesForRide(rideId);
  return (dispatches?.length || 0) + 1;
}

/* =========================================================
   DRIVER SELECTION
========================================================= */
function scoreDriverCandidate(driver = null, ride = null) {
  if (!driver || !ride) return -999;

  let score = 0;

  if (driverCanGoLive(driver)) score += 100;
  if (Boolean(driver.is_available)) score += 50;

  const driverType = normalizeDriverType(driver.driver_type || "human");
  const requestedMode = normalizeRideMode(ride.requested_mode || "driver");

  if (requestedMode === "driver" && driverType === "human") score += 30;
  if (requestedMode === "autonomous" && driverType === "autonomous") score += 30;

  if (driverType === "human" && requestedMode === "autonomous") score -= 50;
  if (driverType === "autonomous" && requestedMode === "driver") score -= 25;

  const completedTrips = Number(driver.completed_trips || 0);
  score += Math.min(25, completedTrips * 0.25);

  const rating = Number(driver.rating || 0);
  if (Number.isFinite(rating) && rating > 0) {
    score += Math.min(15, rating * 3);
  }

  return score;
}

async function findCandidateDriversForRide(ride = null, limit = 10) {
  if (!supabase || !ride) return [];

  try {
    const requestedMode = normalizeRideMode(ride.requested_mode || "driver");
    const driverTypeFilter = requestedMode === "autonomous" ? "autonomous" : "human";

    const { data, error } = await supabase
      .from("drivers")
      .select("*")
      .eq("is_available", true)
      .eq("is_approved", true)
      .eq("is_verified", true)
      .eq("driver_type", driverTypeFilter)
      .order("updated_at", { ascending: false })
      .limit(Math.max(limit, 20));

    if (error) throw error;

    const priorDispatches = await listDispatchesForRide(ride.id);
    const alreadyTriedDriverIds = new Set(
      (priorDispatches || []).map((d) => clean(d.driver_id)).filter(Boolean)
    );

    return (data || [])
      .filter((driver) => !alreadyTriedDriverIds.has(clean(driver.id)))
      .map((driver) => ({
        driver,
        score: scoreDriverCandidate(driver, ride)
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((entry) => entry.driver);
  } catch (error) {
    console.warn("⚠️ Failed to select candidate drivers:", error?.message || error);
    return [];
  }
}

/* =========================================================
   DISPATCH CREATION
========================================================= */
async function createMissionForDispatch({
  ride,
  driver,
  attempt_number = 1
} = {}) {
  if (!supabase || !ride || !driver) return null;

  const missionPayload = {
    id: generateId("mission"),
    ride_id: clean(ride.id),
    rider_id: clean(ride.rider_id),
    driver_id: clean(driver.id),
    requested_mode: normalizeRideMode(ride.requested_mode || "driver"),
    status: "offered",
    attempt_number,
    pickup_address: clean(ride.pickup_address),
    dropoff_address: clean(ride.dropoff_address),
    estimated_fare: ride.estimated_fare || 0,
    notes: clean(ride.notes || ""),
    expires_at: addSecondsToIso(DISPATCH_TIMEOUT_SECONDS),
    created_at: nowIso(),
    updated_at: nowIso()
  };

  return await insertRow("missions", missionPayload);
}

async function createDispatchOffer({
  ride,
  driver,
  mission,
  attempt_number = 1
} = {}) {
  if (!supabase || !ride || !driver || !mission) return null;

  const dispatchPayload = {
    id: generateId("dispatch"),
    ride_id: clean(ride.id),
    driver_id: clean(driver.id),
    mission_id: clean(mission.id),
    attempt_number,
    status: "offered",
    offer_expires_at: addSecondsToIso(DISPATCH_TIMEOUT_SECONDS),
    responded_at: null,
    response_reason: null,
    created_at: nowIso(),
    updated_at: nowIso()
  };

  return await insertRow("dispatches", dispatchPayload);
}

async function offerRideToDriver({
  ride,
  driver
} = {}) {
  if (!ride || !driver) {
    return {
      ok: false,
      message: "Ride and driver are required for dispatch offer."
    };
  }

  const attempt_number = await getDispatchAttemptNumber(ride.id);
  const mission = await createMissionForDispatch({ ride, driver, attempt_number });
  const dispatch = await createDispatchOffer({ ride, driver, mission, attempt_number });

  await updateRows(
    "rides",
    { id: ride.id },
    {
      driver_id: clean(driver.id),
      mission_id: clean(mission.id),
      status: "awaiting_driver_acceptance",
      updated_at: nowIso()
    }
  );

  await createTripEvent({
    ride_id: ride.id,
    event_type: "dispatch_offered",
    payload: {
      driver_id: driver.id,
      mission_id: mission.id,
      dispatch_id: dispatch.id,
      attempt_number
    }
  });

  return {
    ok: true,
    attempt_number,
    mission,
    dispatch
  };
}

async function assignBestDriverToRide(ride = null) {
  if (!ride) {
    return {
      ok: false,
      code: "ride_required",
      message: "Ride is required for dispatch."
    };
  }

  const attemptNumber = await getDispatchAttemptNumber(ride.id);

  if (attemptNumber > MAX_DISPATCH_ATTEMPTS) {
    await updateRows(
      "rides",
      { id: ride.id },
      {
        status: "no_driver_available",
        driver_id: null,
        mission_id: null,
        updated_at: nowIso()
      }
    );

    await createTripEvent({
      ride_id: ride.id,
      event_type: "dispatch_failed_max_attempts",
      payload: {
        attempt_number: attemptNumber - 1,
        max_attempts: MAX_DISPATCH_ATTEMPTS
      }
    });

    return {
      ok: false,
      code: "max_dispatch_attempts_reached",
      message: "No driver available after maximum dispatch attempts."
    };
  }

  const candidates = await findCandidateDriversForRide(ride, 10);

  if (!candidates.length) {
    await updateRows(
      "rides",
      { id: ride.id },
      {
        status: "no_driver_available",
        driver_id: null,
        mission_id: null,
        updated_at: nowIso()
      }
    );

    await createTripEvent({
      ride_id: ride.id,
      event_type: "no_driver_available",
      payload: {
        attempt_number: attemptNumber
      }
    });

    return {
      ok: false,
      code: "no_driver_available",
      message: "No eligible driver is available right now."
    };
  }

  const selectedDriver = candidates[0];
  const offerResult = await offerRideToDriver({
    ride,
    driver: selectedDriver
  });

  if (!offerResult.ok) {
    return {
      ok: false,
      code: "dispatch_offer_failed",
      message: "Failed to create dispatch offer."
    };
  }

  return {
    ok: true,
    code: "dispatch_offered",
    message: "Dispatch offer created.",
    driver: selectedDriver,
    mission: offerResult.mission,
    dispatch: offerResult.dispatch,
    attempt_number: offerResult.attempt_number
  };
}

/* =========================================================
   DISPATCH SWEEP
========================================================= */
async function expireOpenDispatchOffer(dispatch = null) {
  if (!dispatch) return null;

  const dispatchId = clean(dispatch.id);
  const missionId = clean(dispatch.mission_id);
  const rideId = clean(dispatch.ride_id);

  await updateRows(
    "dispatches",
    { id: dispatchId },
    {
      status: "expired",
      responded_at: nowIso(),
      response_reason: "offer_timeout",
      updated_at: nowIso()
    }
  );

  if (missionId) {
    await updateRows(
      "missions",
      { id: missionId },
      {
        status: "expired",
        declined_at: nowIso(),
        updated_at: nowIso()
      }
    );
  }

  await updateRows(
    "rides",
    { id: rideId },
    {
      status: "awaiting_dispatch",
      driver_id: null,
      mission_id: null,
      updated_at: nowIso()
    }
  );

  await createTripEvent({
    ride_id: rideId,
    event_type: "dispatch_expired",
    payload: {
      dispatch_id: dispatchId,
      mission_id: missionId,
      driver_id: clean(dispatch.driver_id),
      attempt_number: Number(dispatch.attempt_number || 1)
    }
  });

  return true;
}

async function sweepExpiredDispatches() {
  if (!supabase || !ENABLE_AUTO_REDISPATCH) return;

  try {
    const { data, error } = await supabase
      .from("dispatches")
      .select("*")
      .eq("status", "offered")
      .limit(100);

    if (error) throw error;

    const expired = (data || []).filter((dispatch) =>
      dispatch.offer_expires_at ? isExpiredIso(dispatch.offer_expires_at) : false
    );

    for (const dispatch of expired) {
      await expireOpenDispatchOffer(dispatch);

      const ride = await findRideById(dispatch.ride_id);
      if (!ride) continue;

      if (normalizeRideStatus(ride.status) !== "awaiting_dispatch") continue;

      await assignBestDriverToRide(ride);
    }
  } catch (error) {
    console.warn("⚠️ Dispatch sweep failed:", error?.message || error);
  }
}

/* =========================================================
   DISPATCH ROUTES
========================================================= */
app.post("/api/dispatch/:rideId/start", requireAdmin, async (req, res) => {
  try {
    if (!(await requireSupabaseOrFail(res))) return;

    const rideId = clean(req.params?.rideId || "");
    if (!rideId) {
      return fail(res, "Ride ID is required", 400);
    }

    const ride = await findRideById(rideId);
    if (!ride) {
      return fail(res, "Ride not found", 404);
    }

    const paymentCheck = await requireAuthorizedPaymentForRider({
      rider_id: clean(ride.rider_id),
      payment_id: clean(ride.payment_id)
    });

    if (!paymentCheck.ok) {
      return fail(res, paymentCheck.message, paymentCheck.status, {
        code: paymentCheck.code,
        payment: sanitizePayment(paymentCheck.payment)
      });
    }

    const result = await assignBestDriverToRide(ride);

    if (!result.ok) {
      return fail(res, result.message, 409, {
        code: result.code
      });
    }

    await insertAdminLog(
      "dispatch_started",
      {
        ride_id: rideId,
        driver_id: result.driver?.id || null,
        mission_id: result.mission?.id || null,
        dispatch_id: result.dispatch?.id || null,
        attempt_number: result.attempt_number
      },
      req
    );

    return ok(
      res,
      {
        ride_id: rideId,
        driver: sanitizeDriver(result.driver),
        mission: sanitizeMission(result.mission),
        dispatch: sanitizeDispatch(result.dispatch),
        attempt_number: result.attempt_number
      },
      "Dispatch started successfully"
    );
  } catch (error) {
    return serverError(res, error, "Dispatch start failed");
  }
});

app.get("/api/dispatch/:rideId/status", async (req, res) => {
  try {
    if (!(await requireSupabaseOrFail(res))) return;

    const rideId = clean(req.params?.rideId || "");
    if (!rideId) {
      return fail(res, "Ride ID is required", 400);
    }

    const ride = await findRideById(rideId);
    if (!ride) {
      return fail(res, "Ride not found", 404);
    }

    const dispatches = await listDispatchesForRide(rideId);

    return ok(
      res,
      {
        ride: sanitizeRide(ride),
        dispatches: dispatches.map(sanitizeDispatch),
        total_dispatches: dispatches.length
      },
      "Dispatch status loaded"
    );
  } catch (error) {
    return serverError(res, error, "Dispatch status lookup failed");
  }
});

/* =========================================================
   DRIVER ACCEPT / DECLINE
========================================================= */
app.post("/api/driver/missions/:missionId/accept", async (req, res) => {
  try {
    if (!(await requireSupabaseOrFail(res))) return;

    const missionId = clean(req.params?.missionId || "");
    const driver_id = clean(req.body?.driver_id || "");

    if (!missionId) {
      return fail(res, "Mission ID is required", 400);
    }

    if (!driver_id) {
      return fail(res, "Driver ID is required", 400);
    }

    const readiness = await requireApprovedVerifiedDriver({ driver_id });

    if (!readiness.ok) {
      return fail(res, readiness.message, readiness.status, {
        code: readiness.code,
        driver: sanitizeDriver(readiness.driver)
      });
    }

    const mission = await findMissionById(missionId);
    if (!mission) {
      return fail(res, "Mission not found", 404);
    }

    if (clean(mission.driver_id) !== driver_id) {
      return fail(res, "This mission is not assigned to this driver", 403);
    }

    if (normalizeMissionStatus(mission.status) !== "offered") {
      return fail(res, "Mission is no longer available for acceptance", 409, {
        mission: sanitizeMission(mission)
      });
    }

    if (mission.expires_at && isExpiredIso(mission.expires_at)) {
      await updateRows(
        "missions",
        { id: missionId },
        {
          status: "expired",
          declined_at: nowIso(),
          updated_at: nowIso()
        }
      );

      const dispatches = await listDispatchesForRide(clean(mission.ride_id));
      const linkedDispatch = dispatches.find((d) => clean(d.mission_id) === missionId);
      if (linkedDispatch) {
        await updateRows(
          "dispatches",
          { id: linkedDispatch.id },
          {
            status: "expired",
            responded_at: nowIso(),
            response_reason: "accept_after_expiry",
            updated_at: nowIso()
          }
        );
      }

      return fail(res, "Mission offer has expired", 409);
    }

    await updateRows(
      "missions",
      { id: missionId },
      {
        status: "accepted",
        accepted_at: nowIso(),
        updated_at: nowIso()
      }
    );

    const dispatches = await listDispatchesForRide(clean(mission.ride_id));
    const linkedDispatch = dispatches.find((d) => clean(d.mission_id) === missionId);

    if (linkedDispatch) {
      await updateRows(
        "dispatches",
        { id: linkedDispatch.id },
        {
          status: "accepted",
          responded_at: nowIso(),
          response_reason: "accepted",
          updated_at: nowIso()
        }
      );
    }

    await updateRows(
      "rides",
      { id: clean(mission.ride_id) },
      {
        driver_id,
        mission_id: missionId,
        status: "dispatched",
        updated_at: nowIso()
      }
    );

    await updateRows(
      "drivers",
      { id: driver_id },
      {
        is_available: false,
        updated_at: nowIso()
      }
    );

    await createTripEvent({
      ride_id: clean(mission.ride_id),
      event_type: "mission_accepted",
      payload: {
        mission_id: missionId,
        driver_id,
        dispatch_id: linkedDispatch?.id || null
      }
    });

    const updatedRide = await findRideById(clean(mission.ride_id));
    const updatedMission = await findMissionById(missionId);

    return ok(
      res,
      {
        ride: sanitizeRide(updatedRide),
        mission: sanitizeMission(updatedMission),
        dispatch: linkedDispatch ? sanitizeDispatch(await findDispatchById(linkedDispatch.id)) : null
      },
      "Mission accepted successfully"
    );
  } catch (error) {
    return serverError(res, error, "Mission accept failed");
  }
});

app.post("/api/driver/missions/:missionId/decline", async (req, res) => {
  try {
    if (!(await requireSupabaseOrFail(res))) return;

    const missionId = clean(req.params?.missionId || "");
    const driver_id = clean(req.body?.driver_id || "");
    const reason = clean(req.body?.reason || "declined_by_driver");

    if (!missionId) {
      return fail(res, "Mission ID is required", 400);
    }

    if (!driver_id) {
      return fail(res, "Driver ID is required", 400);
    }

    const readiness = await requireApprovedVerifiedDriver({ driver_id });

    if (!readiness.ok) {
      return fail(res, readiness.message, readiness.status, {
        code: readiness.code,
        driver: sanitizeDriver(readiness.driver)
      });
    }

    const mission = await findMissionById(missionId);
    if (!mission) {
      return fail(res, "Mission not found", 404);
    }

    if (clean(mission.driver_id) !== driver_id) {
      return fail(res, "This mission is not assigned to this driver", 403);
    }

    await updateRows(
      "missions",
      { id: missionId },
      {
        status: "declined",
        declined_at: nowIso(),
        updated_at: nowIso()
      }
    );

    const dispatches = await listDispatchesForRide(clean(mission.ride_id));
    const linkedDispatch = dispatches.find((d) => clean(d.mission_id) === missionId);

    if (linkedDispatch) {
      await updateRows(
        "dispatches",
        { id: linkedDispatch.id },
        {
          status: "declined",
          responded_at: nowIso(),
          response_reason: reason,
          updated_at: nowIso()
        }
      );
    }

    await updateRows(
      "rides",
      { id: clean(mission.ride_id) },
      {
        driver_id: null,
        mission_id: null,
        status: "awaiting_dispatch",
        updated_at: nowIso()
      }
    );

    await createTripEvent({
      ride_id: clean(mission.ride_id),
      event_type: "mission_declined",
      payload: {
        mission_id: missionId,
        driver_id,
        reason,
        dispatch_id: linkedDispatch?.id || null
      }
    });

    const ride = await findRideById(clean(mission.ride_id));

    let redispatch = null;
    if (ENABLE_AUTO_REDISPATCH && ride) {
      redispatch = await assignBestDriverToRide(ride);
    }

    return ok(
      res,
      {
        mission: sanitizeMission(await findMissionById(missionId)),
        dispatch: linkedDispatch ? sanitizeDispatch(await findDispatchById(linkedDispatch.id)) : null,
        redispatch: redispatch?.ok
          ? {
              driver: sanitizeDriver(redispatch.driver),
              mission: sanitizeMission(redispatch.mission),
              dispatch: sanitizeDispatch(redispatch.dispatch),
              attempt_number: redispatch.attempt_number
            }
          : {
              ok: false,
              code: redispatch?.code || "redispatch_not_started",
              message: redispatch?.message || "Redispatch not started."
            }
      },
      "Mission declined"
    );
  } catch (error) {
    return serverError(res, error, "Mission decline failed");
  }
});

/* =========================================================
   MANUAL REDISPATCH
========================================================= */
app.post("/api/dispatch/:rideId/redispatch", requireAdmin, async (req, res) => {
  try {
    if (!(await requireSupabaseOrFail(res))) return;

    const rideId = clean(req.params?.rideId || "");
    if (!rideId) {
      return fail(res, "Ride ID is required", 400);
    }

    const ride = await findRideById(rideId);
    if (!ride) {
      return fail(res, "Ride not found", 404);
    }

    await updateRows(
      "rides",
      { id: rideId },
      {
        driver_id: null,
        mission_id: null,
        status: "awaiting_dispatch",
        updated_at: nowIso()
      }
    );

    const freshRide = await findRideById(rideId);
    const result = await assignBestDriverToRide(freshRide);

    if (!result.ok) {
      return fail(res, result.message, 409, {
        code: result.code
      });
    }

    await insertAdminLog(
      "dispatch_redispatched",
      {
        ride_id: rideId,
        driver_id: result.driver?.id || null,
        mission_id: result.mission?.id || null,
        dispatch_id: result.dispatch?.id || null,
        attempt_number: result.attempt_number
      },
      req
    );

    return ok(
      res,
      {
        ride_id: rideId,
        driver: sanitizeDriver(result.driver),
        mission: sanitizeMission(result.mission),
        dispatch: sanitizeDispatch(result.dispatch),
        attempt_number: result.attempt_number
      },
      "Ride redispatched successfully"
    );
  } catch (error) {
    return serverError(res, error, "Manual redispatch failed");
  }
});

/* =========================================================
   DRIVER ACTIVE OFFER LOOKUP
========================================================= */
app.get("/api/driver/offers", async (req, res) => {
  try {
    if (!(await requireSupabaseOrFail(res))) return;

    const driver_id = clean(req.query?.driver_id || "");
    if (!driver_id) {
      return fail(res, "Driver ID is required", 400);
    }

    const readiness = await requireApprovedVerifiedDriver({ driver_id });

    if (!readiness.ok) {
      return fail(res, readiness.message, readiness.status, {
        code: readiness.code,
        driver: sanitizeDriver(readiness.driver)
      });
    }

    const { data: missions, error } = await supabase
      .from("missions")
      .select("*")
      .eq("driver_id", driver_id)
      .eq("status", "offered")
      .order("created_at", { ascending: false })
      .limit(20);

    if (error) throw error;

    const rideIds = [...new Set((missions || []).map((m) => clean(m.ride_id)).filter(Boolean))];

    let ridesMap = new Map();
    if (rideIds.length > 0) {
      const { data: ridesData } = await supabase
        .from("rides")
        .select("*")
        .in("id", rideIds);

      ridesMap = new Map((ridesData || []).map((ride) => [clean(ride.id), ride]));
    }

    const offerItems = (missions || []).map((mission) => {
      const ride = ridesMap.get(clean(mission.ride_id)) || null;
      return {
        mission: sanitizeMission(mission),
        ride: sanitizeRide(ride),
        mission_view: sanitizeMissionView({ ride, rider: null })
      };
    });

    return ok(
      res,
      {
        offers: offerItems,
        total: offerItems.length
      },
      "Driver offers loaded"
    );
  } catch (error) {
    return serverError(res, error, "Driver offers lookup failed");
  }
});

/* =========================================================
   OPTIONAL DISPATCH SWEEP TIMER
   Keep only one interval in the final file.
========================================================= */
if (ENABLE_AUTO_REDISPATCH) {
  setInterval(() => {
    sweepExpiredDispatches().catch((error) => {
      console.warn("⚠️ Dispatch interval sweep error:", error?.message || error);
    });
  }, 15000);
}/* =========================================================
   PART 7: TRIP LIFECYCLE + COMPLETE / CANCEL + TIPPING + EARNINGS
========================================================= */

/* =========================================================
   TRIP / PAYMENT / EARNINGS HELPERS
========================================================= */
function normalizeTripProgressStatus(value = "") {
  const v = normalizeRideStatus(value);

  const allowed = [
    "dispatched",
    "driver_en_route",
    "arrived",
    "in_progress",
    "completed",
    "cancelled"
  ];

  return allowed.includes(v) ? v : "pending";
}

function canTransitionRideStatus(currentStatus = "", nextStatus = "") {
  const current = normalizeRideStatus(currentStatus);
  const next = normalizeRideStatus(nextStatus);

  const allowedTransitions = {
    awaiting_driver_acceptance: ["dispatched", "cancelled"],
    dispatched: ["driver_en_route", "cancelled"],
    driver_en_route: ["arrived", "cancelled"],
    arrived: ["in_progress", "cancelled"],
    in_progress: ["completed", "cancelled"],
    awaiting_dispatch: ["cancelled"],
    pending: ["cancelled"]
  };

  return Boolean(allowedTransitions[current]?.includes(next));
}

async function findActiveRideForDriver(driverId = "") {
  if (!supabase || !clean(driverId)) return null;

  try {
    const { data, error } = await supabase
      .from("rides")
      .select("*")
      .eq("driver_id", clean(driverId))
      .in("status", ["awaiting_driver_acceptance", "dispatched", "driver_en_route", "arrived", "in_progress"])
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    return data;
  } catch (error) {
    console.warn("⚠️ Failed to find active ride for driver:", error?.message || error);
    return null;
  }
}

async function findLatestPaymentForRide(rideId = "") {
  if (!supabase || !clean(rideId)) return null;

  try {
    const { data, error } = await supabase
      .from("payments")
      .select("*")
      .eq("ride_id", clean(rideId))
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    return data;
  } catch (error) {
    console.warn("⚠️ Failed to find payment for ride:", error?.message || error);
    return null;
  }
}

async function capturePaymentForRide({
  ride = null,
  payment = null
} = {}) {
  if (!ride || !payment) {
    return {
      ok: false,
      code: "payment_or_ride_missing",
      message: "Ride and payment are required."
    };
  }

  if (!paymentIsAuthorized(payment)) {
    return {
      ok: false,
      code: "payment_not_authorized",
      message: "Payment must be authorized before capture."
    };
  }

  const updatedRows = await updateRows(
    "payments",
    { id: clean(payment.id) },
    {
      status: "captured",
      captured_at: nowIso(),
      updated_at: nowIso()
    }
  );

  const updated = updatedRows?.[0] || (await findPaymentById(payment.id));

  return {
    ok: true,
    code: "payment_captured",
    message: "Payment captured successfully.",
    payment: updated
  };
}

async function releasePaymentForRide({
  payment = null,
  reason = "ride_cancelled"
} = {}) {
  if (!payment) {
    return {
      ok: false,
      code: "payment_missing",
      message: "Payment is required."
    };
  }

  const updatedRows = await updateRows(
    "payments",
    { id: clean(payment.id) },
    {
      status: "released",
      released_at: nowIso(),
      release_reason: clean(reason),
      updated_at: nowIso()
    }
  );

  const updated = updatedRows?.[0] || (await findPaymentById(payment.id));

  return {
    ok: true,
    code: "payment_released",
    message: "Payment released successfully.",
    payment: updated
  };
}

async function createDriverEarningRecord({
  ride = null,
  driver_id = "",
  payment = null,
  tip_amount = 0
} = {}) {
  if (!supabase || !ride || !clean(driver_id)) return null;

  const rideMode = normalizeRideMode(ride.requested_mode || "driver");
  const baseFare = Number(ride.estimated_fare || 0);
  const tip = Number(tip_amount || 0);
  const payoutPercent =
    rideMode === "autonomous" ? AUTONOMOUS_PAYOUT_PERCENT : DRIVER_PAYOUT_PERCENT;

  const basePayout = dollars(baseFare * payoutPercent);
  const totalPayout = dollars(basePayout + tip);

  const candidateTables = ["driver_earnings", "driver_payouts"];

  for (const table of candidateTables) {
    try {
      const { error } = await supabase.from(table).insert({
        id: generateId("earn"),
        ride_id: clean(ride.id),
        driver_id: clean(driver_id),
        payment_id: clean(payment?.id || ""),
        base_fare: dollars(baseFare),
        payout_percent: payoutPercent,
        base_payout: basePayout,
        tip_amount: dollars(tip),
        total_payout: totalPayout,
        status: "pending",
        created_at: nowIso(),
        updated_at: nowIso()
      });

      if (!error) {
        return {
          table,
          base_payout: basePayout,
          tip_amount: dollars(tip),
          total_payout: totalPayout
        };
      }
    } catch (error) {
      // try next table
    }
  }

  return {
    table: null,
    base_payout: basePayout,
    tip_amount: dollars(tip),
    total_payout: totalPayout
  };
}

async function updateRideLifecycle({
  ride_id = "",
  next_status = "",
  extra = {}
} = {}) {
  if (!supabase || !clean(ride_id) || !clean(next_status)) return null;

  const updates = {
    status: normalizeRideStatus(next_status),
    updated_at: nowIso(),
    ...extra
  };

  const updatedRows = await updateRows("rides", { id: clean(ride_id) }, updates);
  return updatedRows?.[0] || (await findRideById(ride_id));
}

/* =========================================================
   DRIVER TRIP LIFECYCLE ROUTES
========================================================= */
app.post("/api/driver/rides/:rideId/en-route", async (req, res) => {
  try {
    if (!(await requireSupabaseOrFail(res))) return;

    const rideId = clean(req.params?.rideId || "");
    const driver_id = clean(req.body?.driver_id || "");

    if (!rideId) return fail(res, "Ride ID is required", 400);
    if (!driver_id) return fail(res, "Driver ID is required", 400);

    const readiness = await requireApprovedVerifiedDriver({ driver_id });
    if (!readiness.ok) {
      return fail(res, readiness.message, readiness.status, {
        code: readiness.code,
        driver: sanitizeDriver(readiness.driver)
      });
    }

    const ride = await findRideById(rideId);
    if (!ride) return fail(res, "Ride not found", 404);
    if (clean(ride.driver_id) !== driver_id) {
      return fail(res, "Ride is not assigned to this driver", 403);
    }

    if (!canTransitionRideStatus(ride.status, "driver_en_route")) {
      return fail(res, "Ride cannot move to driver en route from its current status", 409, {
        ride: sanitizeRide(ride)
      });
    }

    const updatedRide = await updateRideLifecycle({
      ride_id: rideId,
      next_status: "driver_en_route",
      extra: { driver_en_route_at: nowIso() }
    });

    await createTripEvent({
      ride_id: rideId,
      event_type: "driver_en_route",
      payload: { driver_id }
    });

    return ok(
      res,
      { ride: sanitizeRide(updatedRide) },
      "Driver marked as en route"
    );
  } catch (error) {
    return serverError(res, error, "Failed to mark driver en route");
  }
});

app.post("/api/driver/rides/:rideId/arrived", async (req, res) => {
  try {
    if (!(await requireSupabaseOrFail(res))) return;

    const rideId = clean(req.params?.rideId || "");
    const driver_id = clean(req.body?.driver_id || "");

    if (!rideId) return fail(res, "Ride ID is required", 400);
    if (!driver_id) return fail(res, "Driver ID is required", 400);

    const readiness = await requireApprovedVerifiedDriver({ driver_id });
    if (!readiness.ok) {
      return fail(res, readiness.message, readiness.status, {
        code: readiness.code,
        driver: sanitizeDriver(readiness.driver)
      });
    }

    const ride = await findRideById(rideId);
    if (!ride) return fail(res, "Ride not found", 404);
    if (clean(ride.driver_id) !== driver_id) {
      return fail(res, "Ride is not assigned to this driver", 403);
    }

    if (!canTransitionRideStatus(ride.status, "arrived")) {
      return fail(res, "Ride cannot move to arrived from its current status", 409, {
        ride: sanitizeRide(ride)
      });
    }

    const updatedRide = await updateRideLifecycle({
      ride_id: rideId,
      next_status: "arrived",
      extra: { arrived_at: nowIso() }
    });

    await createTripEvent({
      ride_id: rideId,
      event_type: "driver_arrived",
      payload: { driver_id }
    });

    return ok(
      res,
      { ride: sanitizeRide(updatedRide) },
      "Driver marked as arrived"
    );
  } catch (error) {
    return serverError(res, error, "Failed to mark ride arrived");
  }
});

app.post("/api/driver/rides/:rideId/start", async (req, res) => {
  try {
    if (!(await requireSupabaseOrFail(res))) return;

    const rideId = clean(req.params?.rideId || "");
    const driver_id = clean(req.body?.driver_id || "");

    if (!rideId) return fail(res, "Ride ID is required", 400);
    if (!driver_id) return fail(res, "Driver ID is required", 400);

    const readiness = await requireApprovedVerifiedDriver({ driver_id });
    if (!readiness.ok) {
      return fail(res, readiness.message, readiness.status, {
        code: readiness.code,
        driver: sanitizeDriver(readiness.driver)
      });
    }

    const ride = await findRideById(rideId);
    if (!ride) return fail(res, "Ride not found", 404);
    if (clean(ride.driver_id) !== driver_id) {
      return fail(res, "Ride is not assigned to this driver", 403);
    }

    if (!canTransitionRideStatus(ride.status, "in_progress")) {
      return fail(res, "Ride cannot move to in progress from its current status", 409, {
        ride: sanitizeRide(ride)
      });
    }

    const updatedRide = await updateRideLifecycle({
      ride_id: rideId,
      next_status: "in_progress",
      extra: { started_at: nowIso() }
    });

    const missionId = clean(ride.mission_id || "");
    if (missionId) {
      await updateRows(
        "missions",
        { id: missionId },
        {
          status: "in_progress",
          updated_at: nowIso()
        }
      );
    }

    await createTripEvent({
      ride_id: rideId,
      event_type: "trip_started",
      payload: { driver_id }
    });

    return ok(
      res,
      { ride: sanitizeRide(updatedRide) },
      "Trip started successfully"
    );
  } catch (error) {
    return serverError(res, error, "Failed to start trip");
  }
});

app.post("/api/driver/rides/:rideId/complete", async (req, res) => {
  try {
    if (!(await requireSupabaseOrFail(res))) return;

    const rideId = clean(req.params?.rideId || "");
    const driver_id = clean(req.body?.driver_id || "");
    const final_tip_amount = Number(req.body?.tip_amount || 0);

    if (!rideId) return fail(res, "Ride ID is required", 400);
    if (!driver_id) return fail(res, "Driver ID is required", 400);

    const readiness = await requireApprovedVerifiedDriver({ driver_id });
    if (!readiness.ok) {
      return fail(res, readiness.message, readiness.status, {
        code: readiness.code,
        driver: sanitizeDriver(readiness.driver)
      });
    }

    const ride = await findRideById(rideId);
    if (!ride) return fail(res, "Ride not found", 404);
    if (clean(ride.driver_id) !== driver_id) {
      return fail(res, "Ride is not assigned to this driver", 403);
    }

    if (!canTransitionRideStatus(ride.status, "completed")) {
      return fail(res, "Ride cannot be completed from its current status", 409, {
        ride: sanitizeRide(ride)
      });
    }

    const payment =
      (ride.payment_id ? await findPaymentById(ride.payment_id) : null) ||
      (await findLatestPaymentForRide(rideId));

    let paymentResult = null;
    if (payment) {
      paymentResult = await capturePaymentForRide({ ride, payment });
    }

    const updatedRide = await updateRideLifecycle({
      ride_id: rideId,
      next_status: "completed",
      extra: {
        completed_at: nowIso(),
        tip_amount: dollars(final_tip_amount)
      }
    });

    const missionId = clean(ride.mission_id || "");
    if (missionId) {
      await updateRows(
        "missions",
        { id: missionId },
        {
          status: "completed",
          updated_at: nowIso()
        }
      );
    }

    await updateRows(
      "drivers",
      { id: driver_id },
      {
        is_available: true,
        completed_trips: Number(readiness.driver?.completed_trips || 0) + 1,
        updated_at: nowIso()
      }
    );

    const earnings = await createDriverEarningRecord({
      ride: updatedRide,
      driver_id,
      payment: paymentResult?.payment || payment,
      tip_amount: final_tip_amount
    });

    await createTripEvent({
      ride_id: rideId,
      event_type: "trip_completed",
      payload: {
        driver_id,
        payment_id: clean(payment?.id || ""),
        tip_amount: dollars(final_tip_amount)
      }
    });

    return ok(
      res,
      {
        ride: sanitizeRide(updatedRide),
        payment: sanitizePayment(paymentResult?.payment || payment),
        earnings
      },
      "Trip completed successfully"
    );
  } catch (error) {
    return serverError(res, error, "Failed to complete trip");
  }
});

/* =========================================================
   CANCELLATION ROUTES
========================================================= */
app.post("/api/rides/:rideId/cancel", async (req, res) => {
  try {
    if (!(await requireSupabaseOrFail(res))) return;

    const rideId = clean(req.params?.rideId || "");
    const rider_id = clean(req.body?.rider_id || "");
    const driver_id = clean(req.body?.driver_id || "");
    const cancelled_by = clean(req.body?.cancelled_by || (rider_id ? "rider" : driver_id ? "driver" : "system"));
    const reason = clean(req.body?.reason || "cancelled");

    if (!rideId) return fail(res, "Ride ID is required", 400);

    const ride = await findRideById(rideId);
    if (!ride) return fail(res, "Ride not found", 404);

    if (rider_id && clean(ride.rider_id) !== rider_id) {
      return fail(res, "Ride is not assigned to this rider", 403);
    }

    if (driver_id && clean(ride.driver_id) !== driver_id) {
      return fail(res, "Ride is not assigned to this driver", 403);
    }

    if (normalizeRideStatus(ride.status) === "completed") {
      return fail(res, "Completed rides cannot be cancelled", 409);
    }

    if (normalizeRideStatus(ride.status) === "cancelled") {
      return ok(res, { ride: sanitizeRide(ride) }, "Ride is already cancelled");
    }

    const updatedRide = await updateRideLifecycle({
      ride_id: rideId,
      next_status: "cancelled",
      extra: {
        cancelled_at: nowIso(),
        cancelled_by,
        cancellation_reason: reason
      }
    });

    const missionId = clean(ride.mission_id || "");
    if (missionId) {
      await updateRows(
        "missions",
        { id: missionId },
        {
          status: "cancelled",
          updated_at: nowIso()
        }
      );
    }

    const dispatches = await listDispatchesForRide(rideId);
    for (const dispatch of dispatches.filter((d) => ["offered"].includes(normalizeDispatchStatus(d.status)))) {
      await updateRows(
        "dispatches",
        { id: dispatch.id },
        {
          status: "cancelled",
          responded_at: nowIso(),
          response_reason: reason,
          updated_at: nowIso()
        }
      );
    }

    if (clean(ride.driver_id)) {
      await updateRows(
        "drivers",
        { id: clean(ride.driver_id) },
        {
          is_available: true,
          updated_at: nowIso()
        }
      );
    }

    const payment =
      (ride.payment_id ? await findPaymentById(ride.payment_id) : null) ||
      (await findLatestPaymentForRide(rideId));

    let paymentResult = null;
    if (payment && ["authorized", "pending"].includes(normalizePaymentStatus(payment.status))) {
      paymentResult = await releasePaymentForRide({
        payment,
        reason
      });
    }

    await createTripEvent({
      ride_id: rideId,
      event_type: "ride_cancelled",
      payload: {
        cancelled_by,
        reason
      }
    });

    return ok(
      res,
      {
        ride: sanitizeRide(updatedRide),
        payment: sanitizePayment(paymentResult?.payment || payment)
      },
      "Ride cancelled successfully"
    );
  } catch (error) {
    return serverError(res, error, "Failed to cancel ride");
  }
});

/* =========================================================
   TIPPING ROUTES
========================================================= */
app.post("/api/rides/:rideId/tip", async (req, res) => {
  try {
    if (!(await requireSupabaseOrFail(res))) return;

    const rideId = clean(req.params?.rideId || "");
    const rider_id = clean(req.body?.rider_id || "");
    const tip_amount = Number(req.body?.tip_amount || 0);

    if (!rideId) return fail(res, "Ride ID is required", 400);
    if (!rider_id) return fail(res, "Rider ID is required", 400);
    if (!Number.isFinite(tip_amount) || tip_amount <= 0) {
      return fail(res, "A valid tip amount is required", 400);
    }

    const ride = await findRideById(rideId);
    if (!ride) return fail(res, "Ride not found", 404);
    if (clean(ride.rider_id) !== rider_id) {
      return fail(res, "Ride is not assigned to this rider", 403);
    }

    const currentTip = Number(ride.tip_amount || 0);
    const newTip = dollars(currentTip + tip_amount);

    const updatedRide = await updateRideLifecycle({
      ride_id: rideId,
      next_status: ride.status,
      extra: {
        tip_amount: newTip
      }
    });

    await createTripEvent({
      ride_id: rideId,
      event_type: "tip_added",
      payload: {
        rider_id,
        tip_amount: dollars(tip_amount),
        total_tip_amount: newTip
      }
    });

    return ok(
      res,
      {
        ride: sanitizeRide(updatedRide),
        tip_amount: newTip
      },
      "Tip added successfully"
    );
  } catch (error) {
    return serverError(res, error, "Failed to add tip");
  }
});

/* =========================================================
   RIDE / TRIP LOOKUP ROUTES
========================================================= */
app.get("/api/driver/trip-history", async (req, res) => {
  try {
    if (!(await requireSupabaseOrFail(res))) return;

    const driver_id = clean(req.query?.driver_id || "");
    if (!driver_id) return fail(res, "Driver ID is required", 400);

    const readiness = await requireApprovedVerifiedDriver({ driver_id });
    if (!readiness.ok) {
      return fail(res, readiness.message, readiness.status, {
        code: readiness.code,
        driver: sanitizeDriver(readiness.driver)
      });
    }

    const { data, error } = await supabase
      .from("rides")
      .select("*")
      .eq("driver_id", driver_id)
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) throw error;

    return ok(
      res,
      {
        rides: (data || []).map(sanitizeRide),
        total: Array.isArray(data) ? data.length : 0
      },
      "Driver trip history loaded"
    );
  } catch (error) {
    return serverError(res, error, "Driver trip history lookup failed");
  }
});

app.get("/api/rides/:rideId/timeline", async (req, res) => {
  try {
    if (!(await requireSupabaseOrFail(res))) return;

    const rideId = clean(req.params?.rideId || "");
    if (!rideId) return fail(res, "Ride ID is required", 400);

    const ride = await findRideById(rideId);
    if (!ride) return fail(res, "Ride not found", 404);

    const candidateTables = ["trip_events", "ride_events", "mission_events"];
    let events = [];

    for (const table of candidateTables) {
      try {
        const { data, error } = await supabase
          .from(table)
          .select("*")
          .eq("ride_id", rideId)
          .order("created_at", { ascending: true });

        if (!error) {
          events = data || [];
          if (events.length) break;
        }
      } catch (error) {
        // try next
      }
    }

    return ok(
      res,
      {
        ride: sanitizeRide(ride),
        timeline: events
      },
      "Ride timeline loaded"
    );
  } catch (error) {
    return serverError(res, error, "Ride timeline lookup failed");
  }
});

/* =========================================================
   ADMIN COMPLETE / CANCEL SUPPORT
========================================================= */
app.post("/api/admin/rides/:rideId/force-complete", requireAdmin, async (req, res) => {
  try {
    if (!(await requireSupabaseOrFail(res))) return;

    const rideId = clean(req.params?.rideId || "");
    if (!rideId) return fail(res, "Ride ID is required", 400);

    const ride = await findRideById(rideId);
    if (!ride) return fail(res, "Ride not found", 404);

    const updatedRide = await updateRideLifecycle({
      ride_id: rideId,
      next_status: "completed",
      extra: {
        completed_at: nowIso()
      }
    });

    if (clean(ride.driver_id)) {
      await updateRows(
        "drivers",
        { id: clean(ride.driver_id) },
        {
          is_available: true,
          updated_at: nowIso()
        }
      );
    }

    await insertAdminLog(
      "ride_force_completed",
      {
        ride_id: rideId
      },
      req
    );

    return ok(
      res,
      {
        ride: sanitizeRide(updatedRide)
      },
      "Ride force-completed successfully"
    );
  } catch (error) {
    return serverError(res, error, "Force complete failed");
  }
});

app.post("/api/admin/rides/:rideId/force-cancel", requireAdmin, async (req, res) => {
  try {
    if (!(await requireSupabaseOrFail(res))) return;

    const rideId = clean(req.params?.rideId || "");
    const reason = clean(req.body?.reason || "admin_cancelled");

    if (!rideId) return fail(res, "Ride ID is required", 400);

    const ride = await findRideById(rideId);
    if (!ride) return fail(res, "Ride not found", 404);

    const updatedRide = await updateRideLifecycle({
      ride_id: rideId,
      next_status: "cancelled",
      extra: {
        cancelled_at: nowIso(),
        cancelled_by: "admin",
        cancellation_reason: reason
      }
    });

    if (clean(ride.driver_id)) {
      await updateRows(
        "drivers",
        { id: clean(ride.driver_id) },
        {
          is_available: true,
          updated_at: nowIso()
        }
      );
    }

    await insertAdminLog(
      "ride_force_cancelled",
      {
        ride_id: rideId,
        reason
      },
      req
    );

    return ok(
      res,
      {
        ride: sanitizeRide(updatedRide)
      },
      "Ride force-cancelled successfully"
    );
  } catch (error) {
    return serverError(res, error, "Force cancel failed");
  }
});/* =========================================================
   PART 8: ADMIN ANALYTICS + LIVE DASHBOARDS + EARNINGS SUMMARY + FINAL PRODUCTION LAYER
========================================================= */

/* =========================================================
   ANALYTICS HELPERS
========================================================= */
function sumBy(items = [], selector = () => 0) {
  return dollars(
    (items || []).reduce((total, item) => {
      const value = Number(selector(item) || 0);
      return total + (Number.isFinite(value) ? value : 0);
    }, 0)
  );
}

function countBy(items = [], predicate = () => false) {
  return (items || []).filter(predicate).length;
}

function safeStatusCounts(items = [], selector = () => "") {
  const counts = {};
  for (const item of items || []) {
    const key = clean(selector(item) || "unknown") || "unknown";
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

async function readTableRows(table, options = {}) {
  if (!supabase) return [];

  const {
    orderBy = "created_at",
    ascending = false,
    limit = 500
  } = options;

  try {
    const { data, error } = await supabase
      .from(table)
      .select("*")
      .order(orderBy, { ascending })
      .limit(limit);

    if (error) throw error;
    return data || [];
  } catch (error) {
    console.warn(`⚠️ Failed to read table ${table}:`, error?.message || error);
    return [];
  }
}

async function readDriverEarningsRowsByDriver(driverId = "") {
  if (!supabase || !clean(driverId)) return [];

  const candidateTables = ["driver_earnings", "driver_payouts"];

  for (const table of candidateTables) {
    try {
      const { data, error } = await supabase
        .from(table)
        .select("*")
        .eq("driver_id", clean(driverId))
        .order("created_at", { ascending: false })
        .limit(200);

      if (!error) return data || [];
    } catch (error) {
      // try next
    }
  }

  return [];
}

async function readAllDriverEarningsRows() {
  if (!supabase) return [];

  const candidateTables = ["driver_earnings", "driver_payouts"];

  for (const table of candidateTables) {
    try {
      const { data, error } = await supabase
        .from(table)
        .select("*")
        .order("created_at", { ascending: false })
        .limit(500);

      if (!error) return data || [];
    } catch (error) {
      // try next
    }
  }

  return [];
}

/* =========================================================
   ADMIN DASHBOARD SUMMARY
========================================================= */
app.get("/api/admin/dashboard", requireAdmin, async (req, res) => {
  try {
    if (!(await requireSupabaseOrFail(res))) return;

    const [
      riders,
      drivers,
      rides,
      payments,
      missions,
      dispatches,
      earnings
    ] = await Promise.all([
      readTableRows("riders"),
      readTableRows("drivers"),
      readTableRows("rides"),
      readTableRows("payments"),
      readTableRows("missions"),
      readTableRows("dispatches"),
      readAllDriverEarningsRows()
    ]);

    const activeRideStatuses = ["awaiting_driver_acceptance", "dispatched", "driver_en_route", "arrived", "in_progress"];
    const pendingRideStatuses = ["pending", "awaiting_payment", "awaiting_dispatch"];
    const completedRideStatuses = ["completed"];
    const cancelledRideStatuses = ["cancelled", "no_driver_available"];

    const dashboard = {
      generated_at: nowIso(),

      riders: {
        total: riders.length,
        approved: countBy(riders, (r) => riderIsApproved(r)),
        pending: countBy(riders, (r) => normalizeRiderStatus(r.status || r.access_status) === "pending"),
        rejected: countBy(riders, (r) => normalizeRiderStatus(r.status || r.access_status) === "rejected")
      },

      drivers: {
        total: drivers.length,
        approved: countBy(drivers, (d) => driverIsApproved(d)),
        verified: countBy(drivers, (d) => driverIsVerified(d)),
        available: countBy(drivers, (d) => Boolean(d.is_available)),
        live_ready: countBy(drivers, (d) => driverCanGoLive(d)),
        human: countBy(drivers, (d) => normalizeDriverType(d.driver_type) === "human"),
        autonomous: countBy(drivers, (d) => normalizeDriverType(d.driver_type) === "autonomous")
      },

      rides: {
        total: rides.length,
        active: countBy(rides, (r) => activeRideStatuses.includes(normalizeRideStatus(r.status))),
        pending: countBy(rides, (r) => pendingRideStatuses.includes(normalizeRideStatus(r.status))),
        completed: countBy(rides, (r) => completedRideStatuses.includes(normalizeRideStatus(r.status))),
        cancelled_or_failed: countBy(rides, (r) => cancelledRideStatuses.includes(normalizeRideStatus(r.status))),
        by_status: safeStatusCounts(rides, (r) => normalizeRideStatus(r.status)),
        by_mode: safeStatusCounts(rides, (r) => normalizeRideMode(r.requested_mode || r.mode || "driver"))
      },

      payments: {
        total: payments.length,
        authorized: countBy(payments, (p) => normalizePaymentStatus(p.status) === "authorized"),
        captured: countBy(payments, (p) => normalizePaymentStatus(p.status) === "captured"),
        released: countBy(payments, (p) => normalizePaymentStatus(p.status) === "released"),
        failed: countBy(payments, (p) => normalizePaymentStatus(p.status) === "failed"),
        authorized_volume: sumBy(
          payments.filter((p) => normalizePaymentStatus(p.status) === "authorized"),
          (p) => p.amount
        ),
        captured_volume: sumBy(
          payments.filter((p) => normalizePaymentStatus(p.status) === "captured"),
          (p) => p.amount
        )
      },

      dispatch: {
        missions_total: missions.length,
        dispatches_total: dispatches.length,
        open_offers: countBy(dispatches, (d) => normalizeDispatchStatus(d.status) === "offered"),
        accepted: countBy(dispatches, (d) => normalizeDispatchStatus(d.status) === "accepted"),
        declined: countBy(dispatches, (d) => normalizeDispatchStatus(d.status) === "declined"),
        expired: countBy(dispatches, (d) => normalizeDispatchStatus(d.status) === "expired")
      },

      earnings: {
        total_records: earnings.length,
        gross_driver_payouts: sumBy(earnings, (e) => e.total_payout || e.base_payout || 0),
        gross_tips: sumBy(earnings, (e) => e.tip_amount || 0)
      }
    };

    return ok(
      res,
      { dashboard },
      "Admin dashboard loaded"
    );
  } catch (error) {
    return serverError(res, error, "Admin dashboard failed");
  }
});

/* =========================================================
   ADMIN LIVE RIDES VIEW
========================================================= */
app.get("/api/admin/live-rides", requireAdmin, async (req, res) => {
  try {
    if (!(await requireSupabaseOrFail(res))) return;

    const { data: rides, error } = await supabase
      .from("rides")
      .select("*")
      .in("status", ["awaiting_driver_acceptance", "dispatched", "driver_en_route", "arrived", "in_progress"])
      .order("updated_at", { ascending: false })
      .limit(200);

    if (error) throw error;

    const riderIds = [...new Set((rides || []).map((r) => clean(r.rider_id)).filter(Boolean))];
    const driverIds = [...new Set((rides || []).map((r) => clean(r.driver_id)).filter(Boolean))];

    let ridersMap = new Map();
    let driversMap = new Map();

    if (riderIds.length) {
      const { data: riderRows } = await supabase.from("riders").select("*").in("id", riderIds);
      ridersMap = new Map((riderRows || []).map((r) => [clean(r.id), r]));
    }

    if (driverIds.length) {
      const { data: driverRows } = await supabase.from("drivers").select("*").in("id", driverIds);
      driversMap = new Map((driverRows || []).map((d) => [clean(d.id), d]));
    }

    const live_rides = (rides || []).map((ride) => {
      const rider = ridersMap.get(clean(ride.rider_id)) || null;
      const driver = driversMap.get(clean(ride.driver_id)) || null;

      return {
        ride: sanitizeRide(ride),
        rider: rider ? sanitizeRider(rider) : null,
        driver: driver ? sanitizeDriver(driver) : null
      };
    });

    return ok(
      res,
      {
        live_rides,
        total: live_rides.length
      },
      "Admin live rides loaded"
    );
  } catch (error) {
    return serverError(res, error, "Admin live rides failed");
  }
});

/* =========================================================
   ADMIN DISPATCH OPERATIONS
========================================================= */
app.get("/api/admin/dispatches", requireAdmin, async (req, res) => {
  try {
    if (!(await requireSupabaseOrFail(res))) return;

    const dispatches = await readTableRows("dispatches", {
      orderBy: "created_at",
      ascending: false,
      limit: 300
    });

    return ok(
      res,
      {
        dispatches: dispatches.map(sanitizeDispatch),
        total: dispatches.length
      },
      "Admin dispatch list loaded"
    );
  } catch (error) {
    return serverError(res, error, "Admin dispatch list failed");
  }
});

app.get("/api/admin/missions", requireAdmin, async (req, res) => {
  try {
    if (!(await requireSupabaseOrFail(res))) return;

    const missions = await readTableRows("missions", {
      orderBy: "created_at",
      ascending: false,
      limit: 300
    });

    return ok(
      res,
      {
        missions: missions.map(sanitizeMission),
        total: missions.length
      },
      "Admin mission list loaded"
    );
  } catch (error) {
    return serverError(res, error, "Admin mission list failed");
  }
});

/* =========================================================
   DRIVER EARNINGS SUMMARY
========================================================= */
app.get("/api/driver/earnings", async (req, res) => {
  try {
    if (!(await requireSupabaseOrFail(res))) return;

    const driver_id = clean(req.query?.driver_id || "");
    if (!driver_id) {
      return fail(res, "Driver ID is required", 400);
    }

    const readiness = await requireApprovedVerifiedDriver({ driver_id });
    if (!readiness.ok) {
      return fail(res, readiness.message, readiness.status, {
        code: readiness.code,
        driver: sanitizeDriver(readiness.driver)
      });
    }

    const earningsRows = await readDriverEarningsRowsByDriver(driver_id);

    const summary = {
      total_records: earningsRows.length,
      base_payout_total: sumBy(earningsRows, (row) => row.base_payout || 0),
      tip_total: sumBy(earningsRows, (row) => row.tip_amount || 0),
      total_payout: sumBy(earningsRows, (row) => row.total_payout || row.base_payout || 0),
      pending_records: countBy(earningsRows, (row) => lower(row.status) === "pending"),
      paid_records: countBy(earningsRows, (row) => lower(row.status) === "paid")
    };

    return ok(
      res,
      {
        summary,
        earnings: earningsRows
      },
      "Driver earnings loaded"
    );
  } catch (error) {
    return serverError(res, error, "Driver earnings lookup failed");
  }
});

/* =========================================================
   RIDER DASHBOARD SUMMARY
========================================================= */
app.get("/api/rider/dashboard", async (req, res) => {
  try {
    if (!(await requireSupabaseOrFail(res))) return;

    const rider_id = clean(req.query?.rider_id || "");
    if (!rider_id) {
      return fail(res, "Rider ID is required", 400);
    }

    const rider = await findRiderById(rider_id);
    if (!rider) {
      return fail(res, "Rider not found", 404);
    }

    const { data: rides, error } = await supabase
      .from("rides")
      .select("*")
      .eq("rider_id", rider_id)
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) throw error;

    const activeStatuses = ["awaiting_driver_acceptance", "dispatched", "driver_en_route", "arrived", "in_progress"];

    const dashboard = {
      rider: sanitizeRider(rider),
      stats: {
        total_rides: (rides || []).length,
        active_rides: countBy(rides, (r) => activeStatuses.includes(normalizeRideStatus(r.status))),
        completed_rides: countBy(rides, (r) => normalizeRideStatus(r.status) === "completed"),
        cancelled_rides: countBy(rides, (r) => normalizeRideStatus(r.status) === "cancelled"),
        total_spend_estimate: sumBy(
          (rides || []).filter((r) => normalizeRideStatus(r.status) === "completed"),
          (r) => r.estimated_fare || 0
        ),
        total_tip_amount: sumBy(rides, (r) => r.tip_amount || 0)
      },
      recent_rides: (rides || []).slice(0, 10).map(sanitizeRide)
    };

    return ok(
      res,
      { dashboard },
      "Rider dashboard loaded"
    );
  } catch (error) {
    return serverError(res, error, "Rider dashboard failed");
  }
});

/* =========================================================
   DRIVER DASHBOARD SUMMARY
========================================================= */
app.get("/api/driver/dashboard", async (req, res) => {
  try {
    if (!(await requireSupabaseOrFail(res))) return;

    const driver_id = clean(req.query?.driver_id || "");
    if (!driver_id) {
      return fail(res, "Driver ID is required", 400);
    }

    const readiness = await requireApprovedVerifiedDriver({ driver_id });
    if (!readiness.ok) {
      return fail(res, readiness.message, readiness.status, {
        code: readiness.code,
        driver: sanitizeDriver(readiness.driver)
      });
    }

    const { data: rides, error } = await supabase
      .from("rides")
      .select("*")
      .eq("driver_id", driver_id)
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) throw error;

    const activeRide = (rides || []).find((r) =>
      ["awaiting_driver_acceptance", "dispatched", "driver_en_route", "arrived", "in_progress"].includes(normalizeRideStatus(r.status))
    ) || null;

    const earningsRows = await readDriverEarningsRowsByDriver(driver_id);

    const dashboard = {
      driver: sanitizeDriver(readiness.driver),
      stats: {
        total_rides: rides.length,
        completed_rides: countBy(rides, (r) => normalizeRideStatus(r.status) === "completed"),
        cancelled_rides: countBy(rides, (r) => normalizeRideStatus(r.status) === "cancelled"),
        current_availability: Boolean(readiness.driver.is_available),
        total_base_payout: sumBy(earningsRows, (row) => row.base_payout || 0),
        total_tips: sumBy(earningsRows, (row) => row.tip_amount || 0),
        total_payout: sumBy(earningsRows, (row) => row.total_payout || row.base_payout || 0)
      },
      active_ride: activeRide ? sanitizeRide(activeRide) : null,
      recent_rides: rides.slice(0, 10).map(sanitizeRide)
    };

    return ok(
      res,
      { dashboard },
      "Driver dashboard loaded"
    );
  } catch (error) {
    return serverError(res, error, "Driver dashboard failed");
  }
});

/* =========================================================
   ADMIN PAYOUT STATUS UPDATE
========================================================= */
app.post("/api/admin/driver-payouts/:earningId/mark-paid", requireAdmin, async (req, res) => {
  try {
    if (!(await requireSupabaseOrFail(res))) return;

    const earningId = clean(req.params?.earningId || "");
    if (!earningId) {
      return fail(res, "Earning ID is required", 400);
    }

    const candidateTables = ["driver_earnings", "driver_payouts"];
    let updatedRow = null;
    let usedTable = null;

    for (const table of candidateTables) {
      try {
        const rows = await updateRows(
          table,
          { id: earningId },
          {
            status: "paid",
            paid_at: nowIso(),
            updated_at: nowIso()
          }
        );

        if (rows?.length) {
          updatedRow = rows[0];
          usedTable = table;
          break;
        }
      } catch (error) {
        // try next
      }
    }

    if (!updatedRow) {
      return fail(res, "Earning record not found", 404);
    }

    await insertAdminLog(
      "driver_payout_marked_paid",
      {
        earning_id: earningId,
        table: usedTable
      },
      req
    );

    return ok(
      res,
      {
        table: usedTable,
        earning: updatedRow
      },
      "Driver payout marked as paid"
    );
  } catch (error) {
    return serverError(res, error, "Driver payout update failed");
  }
});

/* =========================================================
   ADMIN PAYMENTS VIEW
========================================================= */
app.get("/api/admin/payments", requireAdmin, async (req, res) => {
  try {
    if (!(await requireSupabaseOrFail(res))) return;

    const payments = await readTableRows("payments", {
      orderBy: "created_at",
      ascending: false,
      limit: 300
    });

    return ok(
      res,
      {
        payments: payments.map(sanitizePayment),
        total: payments.length
      },
      "Admin payments loaded"
    );
  } catch (error) {
    return serverError(res, error, "Admin payments failed");
  }
});

/* =========================================================
   ADMIN RIDES VIEW
========================================================= */
app.get("/api/admin/rides", requireAdmin, async (req, res) => {
  try {
    if (!(await requireSupabaseOrFail(res))) return;

    const rides = await readTableRows("rides", {
      orderBy: "created_at",
      ascending: false,
      limit: 300
    });

    return ok(
      res,
      {
        rides: rides.map(sanitizeRide),
        total: rides.length
      },
      "Admin rides loaded"
    );
  } catch (error) {
    return serverError(res, error, "Admin rides failed");
  }
});

/* =========================================================
   SUPPORT SUMMARY ROUTE
========================================================= */
app.get("/api/support/summary", async (req, res) => {
  try {
    return ok(
      res,
      {
        company: HARVEY_PLATFORM_KNOWLEDGE.company,
        foundation: HARVEY_PLATFORM_KNOWLEDGE.foundation,
        rider: HARVEY_PLATFORM_KNOWLEDGE.rider,
        driver: HARVEY_PLATFORM_KNOWLEDGE.driver,
        rides: HARVEY_PLATFORM_KNOWLEDGE.rides,
        autonomous: HARVEY_PLATFORM_KNOWLEDGE.autonomous,
        safety: HARVEY_PLATFORM_KNOWLEDGE.safety,
        support_email: SUPPORT_EMAIL,
        public_app_url: PUBLIC_APP_URL
      },
      "Support summary loaded"
    );
  } catch (error) {
    return serverError(res, error, "Support summary failed");
  }
});

/* =========================================================
   FINAL 404 HANDLER
   KEEP THIS NEAR THE BOTTOM OF THE FINAL FILE
========================================================= */
app.use((req, res) => {
  return fail(res, "Route not found", 404);
});

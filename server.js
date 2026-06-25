/* =========================================================

   HARVEY TAXI — TRUE CODE BLUE SERVER.JS
   UPGRADED SENIOR DEVELOPER ENGINEER BUILD
   FULL PRODUCTION OVERHAUL — ALL 10 PARTS

   UPGRADES APPLIED:
   ✅ HTAF route: isolated DB try/catch with full Supabase error logging
   ✅ Promise.allSettled for email sends — email failure never kills submission
   ✅ auditLog made non-blocking throughout HTAF route
   ✅ Frontend-readable error messages with HTTP status codes
   ✅ Supabase table existence pre-check on boot
   ✅ All other routes preserved exactly

========================================================= */

"use strict";

const express = require("express");
const cors = require("cors");
const path = require("path");
const crypto = require("crypto");
const http = require("http");
const { createClient } = require("@supabase/supabase-js");

let sgMail = null;
try { sgMail = require("@sendgrid/mail"); } catch {}

let twilio = null;
try { twilio = require("twilio"); } catch {}

let Stripe = null;
try { Stripe = require("stripe"); } catch {}

let OpenAI = null;
try { OpenAI = require("openai"); } catch {}

const app = express();
const server = http.createServer(app);

const NODE_ENV = process.env.NODE_ENV || "production";
const IS_PRODUCTION = NODE_ENV === "production";
const PORT = Number(process.env.PORT || 10000);

function env(name, fallback = "") {
  const value = process.env[name];
  if (value === undefined || value === null || String(value).trim() === "") {
    return fallback;
  }
  return String(value).trim();
}

function envBool(name, fallback = false) {
  const value = env(name);
  if (!value) return fallback;
  return ["true", "1", "yes", "on"].includes(value.toLowerCase());
}

function envNumber(name, fallback) {
  const value = Number(env(name));
  return Number.isFinite(value) ? value : fallback;
}

function requireEnv(name) {
  const value = env(name);
  if (!value) {
    console.error(`❌ Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return value;
}

const SUPABASE_URL = requireEnv("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = requireEnv("SUPABASE_SERVICE_ROLE_KEY");

const APP_NAME = "Harvey Taxi";
const APP_BASE_URL =
  env("PUBLIC_APP_URL") ||
  env("APP_BASE_URL") ||
  env("RENDER_EXTERNAL_URL") ||
  `http://localhost:${PORT}`;

const SUPPORT_EMAIL =
  env("SUPPORT_EMAIL") ||
  env("ADMIN_EMAIL") ||
  "williebee@harveytaxiservice.com";

const ADMIN_EMAIL = env("ADMIN_EMAIL", "williebee@harveytaxiservice.com");
const ADMIN_PASSWORD = env("ADMIN_PASSWORD", "");

const ENABLE_REAL_EMAIL = envBool("ENABLE_REAL_EMAIL", true);
const ENABLE_REAL_SMS = envBool("ENABLE_REAL_SMS", false);
const ENABLE_PERSONA = envBool("ENABLE_PERSONA", true);
const ENABLE_CHECKR = envBool("ENABLE_CHECKR", true);
const ENABLE_AI_SUPPORT = envBool("ENABLE_AI_SUPPORT", true);
const ENABLE_PAYMENT_GATE = envBool("ENABLE_PAYMENT_GATE", true);
const ENABLE_RIDER_APPROVAL_GATE = envBool("ENABLE_RIDER_APPROVAL_GATE", true);
const ENABLE_AUTO_REDISPATCH = envBool("ENABLE_AUTO_REDISPATCH", true);
const ENABLE_DELIVERY = envBool("ENABLE_DELIVERY", true);
const ENABLE_FOOD_DELIVERY = envBool("ENABLE_FOOD_DELIVERY", true);
const ENABLE_GROCERY_DELIVERY = envBool("ENABLE_GROCERY_DELIVERY", true);
const ENABLE_HTAF_APPLICATIONS = envBool("ENABLE_HTAF_APPLICATIONS", true);

const SENDGRID_API_KEY = env("SENDGRID_API_KEY");
const SENDGRID_FROM_EMAIL =
  env("SENDGRID_FROM_EMAIL") ||
  env("SUPPORT_FROM_EMAIL") ||
  SUPPORT_EMAIL;
const SENDGRID_FROM_NAME = env("SENDGRID_FROM_NAME", "Harvey Taxi");

if (sgMail && SENDGRID_API_KEY && ENABLE_REAL_EMAIL) {
  sgMail.setApiKey(SENDGRID_API_KEY);
  console.log("✅ SendGrid active");
} else {
  console.warn("⚠️ SendGrid inactive");
}

const TWILIO_ACCOUNT_SID = env("TWILIO_ACCOUNT_SID");
const TWILIO_AUTH_TOKEN = env("TWILIO_AUTH_TOKEN");
const TWILIO_FROM_NUMBER =
  env("TWILIO_FROM_NUMBER") ||
  env("TWILIO_PHONE_NUMBER");
const TWILIO_VERIFY_SERVICE_SID = env("TWILIO_VERIFY_SERVICE_SID");

let twilioClient = null;
if (twilio && ENABLE_REAL_SMS && TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_FROM_NUMBER) {
  twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
  console.log("✅ Twilio active");
} else {
  console.warn("⚠️ Twilio inactive or SMS disabled");
}

const STRIPE_SECRET_KEY = env("STRIPE_SECRET_KEY");
const STRIPE_WEBHOOK_SECRET = env("STRIPE_WEBHOOK_SECRET");
let stripe = null;
if (Stripe && STRIPE_SECRET_KEY) {
  stripe = new Stripe(STRIPE_SECRET_KEY);
  console.log("✅ Stripe active");
} else {
  console.warn("⚠️ Stripe inactive");
}

const PERSONA_API_KEY = env("PERSONA_API_KEY");
const PERSONA_WEBHOOK_SECRET = env("PERSONA_WEBHOOK_SECRET");
const PERSONA_TEMPLATE_ID_RIDER = env("PERSONA_TEMPLATE_ID_RIDER") || env("PERSONA_RIDER_TEMPLATE_ID");
const PERSONA_TEMPLATE_ID_DRIVER = env("PERSONA_TEMPLATE_ID_DRIVER") || env("PERSONA_DRIVER_TEMPLATE_ID");

const CHECKR_API_KEY = env("CHECKR_API_KEY");
const CHECKR_WEBHOOK_SECRET = env("CHECKR_WEBHOOK_SECRET");
const CHECKR_PACKAGE = env("CHECKR_PACKAGE", "driver_standard");
const CHECKR_WORK_COUNTRY = env("CHECKR_WORK_COUNTRY", "US");
const CHECKR_WORK_STATE = env("CHECKR_WORK_STATE", "TN");
const CHECKR_WORK_CITY = env("CHECKR_WORK_CITY", "Nashville");

const OPENAI_API_KEY = env("OPENAI_API_KEY");
const OPENAI_MODEL = env("OPENAI_MODEL", "gpt-4o-mini");
let openai = null;
if (OpenAI && OPENAI_API_KEY && ENABLE_AI_SUPPORT) {
  openai = new OpenAI({ apiKey: OPENAI_API_KEY });
  console.log("✅ OpenAI active");
} else {
  console.warn("⚠️ OpenAI inactive");
}

const GOOGLE_MAPS_API_KEY = env("GOOGLE_MAPS_API_KEY");

const BASE_FARE = envNumber("BASE_FARE", 5);
const PER_MILE_RATE = envNumber("PER_MILE_RATE", 2.25);
const PER_MINUTE_RATE = envNumber("PER_MINUTE_RATE", 0.35);
const BOOKING_FEE = envNumber("BOOKING_FEE", 2.5);
const MINIMUM_FARE = envNumber("MINIMUM_FARE", 8);
const DRIVER_PAYOUT_PERCENT = envNumber("DRIVER_PAYOUT_PERCENT", 0.78);

const DELIVERY_BASE_FEE = envNumber("DELIVERY_BASE_FEE", 4.99);
const DELIVERY_PER_MILE_RATE = envNumber("DELIVERY_PER_MILE_RATE", 1.35);
const DELIVERY_PER_MINUTE_RATE = envNumber("DELIVERY_PER_MINUTE_RATE", 0.2);
const DELIVERY_SERVICE_FEE = envNumber("DELIVERY_SERVICE_FEE", 2.25);
const DELIVERY_SMALL_ORDER_FEE = envNumber("DELIVERY_SMALL_ORDER_FEE", 2.0);
const DELIVERY_SMALL_ORDER_THRESHOLD = envNumber("DELIVERY_SMALL_ORDER_THRESHOLD", 15);
const DELIVERY_MINIMUM_TOTAL = envNumber("DELIVERY_MINIMUM_TOTAL", 8.99);
const DELIVERY_DRIVER_PAYOUT_PERCENT = envNumber("DELIVERY_DRIVER_PAYOUT_PERCENT", 0.72);
const FOOD_DELIVERY_MULTIPLIER = envNumber("FOOD_DELIVERY_MULTIPLIER", 1.0);
const GROCERY_DELIVERY_MULTIPLIER = envNumber("GROCERY_DELIVERY_MULTIPLIER", 1.12);
const DELIVERY_DEFAULT_PREP_MINUTES = envNumber("DELIVERY_DEFAULT_PREP_MINUTES", 20);
const GROCERY_DEFAULT_SHOP_MINUTES = envNumber("GROCERY_DEFAULT_SHOP_MINUTES", 35);

const DISPATCH_TIMEOUT_SECONDS = envNumber("DISPATCH_TIMEOUT_SECONDS", 30);
const MAX_DISPATCH_ATTEMPTS = envNumber("MAX_DISPATCH_ATTEMPTS", 5);
const DRIVER_SEARCH_RADIUS_MILES = envNumber("DRIVER_SEARCH_RADIUS_MILES", 25);
const DELIVERY_DISPATCH_TIMEOUT_SECONDS = envNumber("DELIVERY_DISPATCH_TIMEOUT_SECONDS", DISPATCH_TIMEOUT_SECONDS);
const DELIVERY_SEARCH_RADIUS_MILES = envNumber("DELIVERY_SEARCH_RADIUS_MILES", DRIVER_SEARCH_RADIUS_MILES);

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

/* =========================================================
   PART 2 OF 10 — SECURITY, MIDDLEWARE, HELPERS
========================================================= */

app.set("trust proxy", 1);
app.disable("x-powered-by");

const PUBLIC_DIR = path.join(__dirname, "public");
const JSON_LIMIT = env("JSON_LIMIT", "2mb");
const RAW_WEBHOOK_LIMIT = env("RAW_WEBHOOK_LIMIT", "2mb");

const ALLOWED_ORIGINS = env("ALLOWED_ORIGINS", "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

function isAllowedOrigin(origin) {
  if (!origin) return true;
  if (!IS_PRODUCTION) return true;
  if (ALLOWED_ORIGINS.length === 0) return origin === APP_BASE_URL;
  return ALLOWED_ORIGINS.includes(origin);
}

app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "geolocation=(self), microphone=(), camera=(self), payment=(self)");
  if (IS_PRODUCTION) {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  next();
});

app.use(cors({
  origin(origin, callback) {
    if (isAllowedOrigin(origin)) {
      callback(null, true);
    } else {
      callback(new Error("CORS origin blocked"));
    }
  },
  credentials: true,
}));

app.use((req, res, next) => {
  if (
    req.originalUrl === "/api/stripe/webhook" ||
    req.originalUrl === "/api/persona/webhook" ||
    req.originalUrl === "/api/checkr/webhook"
  ) {
    return next();
  }
  express.json({ limit: JSON_LIMIT })(req, res, next);
});

app.use(express.urlencoded({ extended: true, limit: JSON_LIMIT }));

app.use(express.static(PUBLIC_DIR, {
  extensions: ["html"],
  maxAge: IS_PRODUCTION ? "1h" : 0,
}));

const memoryRateLimit = new Map();

function getClientIp(req) {
  return (
    req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
    req.socket?.remoteAddress ||
    "unknown"
  );
}

function rateLimit({ windowMs = 60_000, max = 60, keyPrefix = "global" } = {}) {
  return (req, res, next) => {
    const ip = getClientIp(req);
    const key = `${keyPrefix}:${ip}`;
    const now = Date.now();
    const current = memoryRateLimit.get(key) || { count: 0, resetAt: now + windowMs };
    if (now > current.resetAt) {
      current.count = 0;
      current.resetAt = now + windowMs;
    }
    current.count += 1;
    memoryRateLimit.set(key, current);
    if (current.count > max) {
      return fail(res, "Too many requests. Please wait and try again.", 429);
    }
    next();
  };
}

app.use("/api/", rateLimit({
  windowMs: 60_000,
  max: envNumber("API_RATE_LIMIT_PER_MINUTE", 120),
  keyPrefix: "api",
}));

function nowIso() {
  return new Date().toISOString();
}

function makeId(prefix = "HT") {
  return `${prefix}-${crypto.randomBytes(5).toString("hex").toUpperCase()}`;
}

function makePublicCode(prefix = "HTAF") {
  const date = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const random = crypto.randomBytes(3).toString("hex").toUpperCase();
  return `${prefix}-${date}-${random}`;
}

function cleanString(value, max = 500) {
  return String(value || "").trim().slice(0, max);
}

function cleanEmail(value) {
  return cleanString(value, 254).toLowerCase();
}

function cleanPhone(value) {
  return cleanString(value, 32).replace(/[^\d+]/g, "").slice(0, 20);
}

function normalizeRole(value) {
  const role = cleanString(value, 40).toLowerCase();
  if (["admin", "driver", "rider", "support", "foundation", "applicant"].includes(role)) {
    return role;
  }
  return "rider";
}

function normalizeProgramType(value) {
  const program = cleanString(value, 50).toLowerCase();
  const allowed = ["medical", "employment", "education", "community", "senior", "disability", "veteran", "general"];
  return allowed.includes(program) ? program : "general";
}

function normalizeRideType(value) {
  const type = cleanString(value, 50).toLowerCase();
  const allowed = ["standard", "medical", "airport", "foundation", "autonomous", "delivery", "food", "grocery"];
  return allowed.includes(type) ? type : "standard";
}

function ok(res, data = {}, status = 200) {
  return res.status(status).json({ ok: true, ...data });
}

function fail(res, message = "Request failed", status = 400, details = {}) {
  return res.status(status).json({ ok: false, error: message, ...details });
}

function asyncRoute(handler) {
  return function wrapped(req, res, next) {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

function requireBody(req, fields = []) {
  const missing = [];
  for (const field of fields) {
    const value = req.body?.[field];
    if (value === undefined || value === null || String(value).trim() === "") {
      missing.push(field);
    }
  }
  return missing;
}

function hashToken(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function timingSafeEqualString(a, b) {
  const aa = Buffer.from(String(a || ""));
  const bb = Buffer.from(String(b || ""));
  if (aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(aa, bb);
}

async function auditLog({
  actor_type = "system",
  actor_id = null,
  action,
  entity_type = null,
  entity_id = null,
  metadata = {},
  req = null,
}) {
  try {
    await supabase.from("audit_logs").insert({
      actor_type,
      actor_id,
      action,
      entity_type,
      entity_id,
      metadata,
      ip_address: req ? getClientIp(req) : null,
      user_agent: req ? req.headers["user-agent"] || null : null,
      created_at: nowIso(),
    });
  } catch (error) {
    console.warn("Audit log skipped:", error.message);
  }
}

function getBearerToken(req) {
  const header = req.headers.authorization || req.headers.Authorization || "";
  if (!header.startsWith("Bearer ")) return "";
  return header.slice(7).trim();
}

async function getUserFromRequest(req) {
  const token = getBearerToken(req);
  if (!token) return null;
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user;
}

async function requireUser(req, res, next) {
  const user = await getUserFromRequest(req);
  if (!user) return fail(res, "Authentication required.", 401);
  req.user = user;
  next();
}

function requireAdmin(req, res, next) {
  const headerToken = req.headers["x-admin-token"] || req.headers["x-harvey-admin-token"];
  const expected = env("ADMIN_API_TOKEN") || env("HARVEY_ADMIN_TOKEN");
  if (expected && timingSafeEqualString(headerToken, expected)) {
    req.admin = { id: "token-admin", email: ADMIN_EMAIL, method: "admin_token" };
    return next();
  }
  const email = cleanEmail(req.headers["x-admin-email"]);
  const password = String(req.headers["x-admin-password"] || "");
  if (ADMIN_PASSWORD && email === cleanEmail(ADMIN_EMAIL) && timingSafeEqualString(password, ADMIN_PASSWORD)) {
    req.admin = { id: "password-admin", email: ADMIN_EMAIL, method: "admin_password" };
    return next();
  }
  return fail(res, "Admin authorization required.", 401);
}

async function sendEmail({ to, subject, html, text }) {
  if (!sgMail || !SENDGRID_API_KEY || !ENABLE_REAL_EMAIL) {
    console.log("📧 Email skipped:", { to, subject });
    return { sent: false, skipped: true };
  }
  await sgMail.send({
    to,
    from: { email: SENDGRID_FROM_EMAIL, name: SENDGRID_FROM_NAME },
    subject,
    text: text || html?.replace(/<[^>]+>/g, " "),
    html,
  });
  return { sent: true };
}

async function sendSms({ to, body }) {
  if (!twilioClient || !ENABLE_REAL_SMS) {
    console.log("📲 SMS skipped:", { to, body });
    return { sent: false, skipped: true };
  }
  await twilioClient.messages.create({ to, from: TWILIO_FROM_NUMBER, body });
  return { sent: true };
}

function haversineMiles(lat1, lon1, lat2, lon2) {
  const toRad = (v) => (Number(v) * Math.PI) / 180;
  const R = 3958.8;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function calculateRideEstimate({ miles = 0, minutes = 0, ride_type = "standard" }) {
  const safeMiles = Math.max(0, Number(miles) || 0);
  const safeMinutes = Math.max(0, Number(minutes) || 0);
  let subtotal = BASE_FARE + safeMiles * PER_MILE_RATE + safeMinutes * PER_MINUTE_RATE + BOOKING_FEE;
  if (ride_type === "medical" || ride_type === "foundation") subtotal *= 0.95;
  if (ride_type === "airport") subtotal += 5;
  const total = Math.max(MINIMUM_FARE, subtotal);
  const driver_payout = total * DRIVER_PAYOUT_PERCENT;
  return {
    miles: Number(safeMiles.toFixed(2)),
    minutes: Number(safeMinutes.toFixed(0)),
    currency: "USD",
    total: Number(total.toFixed(2)),
    driver_payout: Number(driver_payout.toFixed(2)),
    platform_fee: Number((total - driver_payout).toFixed(2)),
  };
}

function calculateDeliveryEstimate({ miles = 0, minutes = 0, order_subtotal = 0, delivery_type = "food" }) {
  const safeMiles = Math.max(0, Number(miles) || 0);
  const safeMinutes = Math.max(0, Number(minutes) || 0);
  const safeSubtotal = Math.max(0, Number(order_subtotal) || 0);
  const smallOrderFee =
    safeSubtotal > 0 && safeSubtotal < DELIVERY_SMALL_ORDER_THRESHOLD ? DELIVERY_SMALL_ORDER_FEE : 0;
  const multiplier = delivery_type === "grocery" ? GROCERY_DELIVERY_MULTIPLIER : FOOD_DELIVERY_MULTIPLIER;
  let total =
    DELIVERY_BASE_FEE +
    safeMiles * DELIVERY_PER_MILE_RATE +
    safeMinutes * DELIVERY_PER_MINUTE_RATE +
    DELIVERY_SERVICE_FEE +
    smallOrderFee;
  total *= multiplier;
  total = Math.max(total, DELIVERY_MINIMUM_TOTAL);
  const driver_payout = total * DELIVERY_DRIVER_PAYOUT_PERCENT;
  return {
    miles: Number(safeMiles.toFixed(2)),
    minutes: Number(safeMinutes.toFixed(0)),
    currency: "USD",
    delivery_type,
    order_subtotal: Number(safeSubtotal.toFixed(2)),
    delivery_fee: Number(total.toFixed(2)),
    driver_payout: Number(driver_payout.toFixed(2)),
    platform_fee: Number((total - driver_payout).toFixed(2)),
  };
}

/* =========================================================
   PART 3 OF 10 — HTAF FOUNDATION APPLICATION SYSTEM
   *** FULLY UPGRADED ***
   - DB insert isolated with full error logging
   - Promise.allSettled for emails (never kills submit)
   - auditLog non-blocking
   - Real error messages surfaced to frontend
========================================================= */

const HTAF_STATUS = {
  SUBMITTED: "submitted",
  UNDER_REVIEW: "under_review",
  PENDING_DOCUMENTS: "pending_documents",
  APPROVED: "approved",
  DENIED: "denied",
  SCHEDULED: "scheduled",
  COMPLETED: "completed",
};

async function createHTAFApplication(payload) {
  const applicationId = makeId("HTAF");
  const applicationCode = makePublicCode("HTAF");

  const application = {
    id: applicationId,
    application_code: applicationCode,
    first_name: cleanString(payload.first_name, 120),
    last_name: cleanString(payload.last_name, 120),
    email: cleanEmail(payload.email),
    phone: cleanPhone(payload.phone),
    county: cleanString(payload.county, 120),
    city: cleanString(payload.city, 120),
    applicant_type: cleanString(payload.applicant_type, 80),
    household_size: Number(payload.household_size || 0),
    monthly_income: Number(payload.monthly_income || 0),
    program_type: normalizeProgramType(payload.program_type),
    pickup_city: cleanString(payload.pickup_city, 150),
    destination: cleanString(payload.destination, 255),
    ride_date: payload.ride_date || null,
    transportation_need: cleanString(payload.transportation_need, 5000),
    status: HTAF_STATUS.SUBMITTED,
    notes: null,
    submitted_at: nowIso(),
    created_at: nowIso(),
    updated_at: nowIso(),
  };

  const { data, error } = await supabase
    .from("htaf_applications")
    .insert(application)
    .select()
    .single();

  if (error) throw error;
  return data;
}

async function sendApplicantConfirmation(application) {
  try {
    await sendEmail({
      to: application.email,
      subject: `HTAF Application Received (${application.application_code})`,
      html: `
        <h2>Harvey Transportation Assistance Foundation</h2>
        <p>Thank you for submitting a transportation assistance application.</p>
        <p><strong>Application Number:</strong> ${application.application_code}</p>
        <p><strong>Program:</strong> ${application.program_type}</p>
        <p>Your request has been received and is currently under review.</p>
        <p>Additional documentation may be requested.</p>
        <hr>
        <p>Harvey Transportation Assistance Foundation</p>
      `,
    });
  } catch (error) {
    console.error("Applicant confirmation error:", error.message);
  }
}

async function sendAdminApplicationAlert(application) {
  try {
    await sendEmail({
      to: ADMIN_EMAIL,
      subject: `New HTAF Application - ${application.application_code}`,
      html: `
        <h2>New HTAF Application Submitted</h2>
        <p><strong>Name:</strong> ${application.first_name} ${application.last_name}</p>
        <p><strong>Program:</strong> ${application.program_type}</p>
        <p><strong>County:</strong> ${application.county}</p>
        <p><strong>Email:</strong> ${application.email}</p>
        <p><strong>Phone:</strong> ${application.phone}</p>
        <p><strong>Destination:</strong> ${application.destination}</p>
        <p><strong>Need:</strong> ${application.transportation_need}</p>
      `,
    });
  } catch (error) {
    console.error("Admin notification error:", error.message);
  }
}

/* =========================================================
   HTAF APPLICATION SUBMISSION API — UPGRADED
========================================================= */

app.post(
  "/api/foundation/apply",
  asyncRoute(async (req, res) => {

    // ── Feature gate ──────────────────────────────────────
    if (!ENABLE_HTAF_APPLICATIONS) {
      return fail(res, "HTAF applications are currently unavailable.", 503);
    }

    // ── Validation ────────────────────────────────────────
    const missing = requireBody(req, [
      "first_name",
      "last_name",
      "email",
      "phone",
      "county",
      "city",
      "pickup_city",
      "destination",
      "ride_date",
      "transportation_need",
    ]);

    if (missing.length) {
      return fail(res, "Missing required fields.", 400, { missing });
    }

    // ── Database insert (isolated — full error surfacing) ──
    let application;
    try {
      application = await createHTAFApplication(req.body);
    } catch (dbError) {
      // Log the FULL Supabase error to Render logs
      console.error("❌ HTAF DB INSERT FAILED:", {
        message: dbError?.message,
        code:    dbError?.code,
        details: dbError?.details,
        hint:    dbError?.hint,
        table:   "htaf_applications",
      });

      // Return a descriptive error — readable in DevTools Network tab
      return fail(
        res,
        IS_PRODUCTION
          ? "Application could not be saved. Please try again or contact support at williebee@harveytaxiservice.com"
          : `Database error: ${dbError?.message || "Unknown"} (code: ${dbError?.code || "?"}, hint: ${dbError?.hint || "none"})`,
        500,
        IS_PRODUCTION ? {} : {
          db_code:    dbError?.code,
          db_details: dbError?.details,
          db_hint:    dbError?.hint,
        }
      );
    }

    // ── Email notifications (allSettled — never crashes submit) ──
    const [confirmResult, alertResult] = await Promise.allSettled([
      sendApplicantConfirmation(application),
      sendAdminApplicationAlert(application),
    ]);

    if (confirmResult.status === "rejected") {
      console.warn("⚠️ Applicant confirmation email failed:", confirmResult.reason?.message);
    }
    if (alertResult.status === "rejected") {
      console.warn("⚠️ Admin alert email failed:", alertResult.reason?.message);
    }

    // ── Audit log (non-blocking — never crashes submit) ───
    auditLog({
      action: "htaf_application_created",
      entity_type: "htaf_application",
      entity_id: application.id,
      metadata: {
        application_code: application.application_code,
        program_type: application.program_type,
      },
      req,
    }).catch((auditError) => {
      console.warn("⚠️ Audit log failed:", auditError?.message);
    });

    // ── Success ──────────────────────────────────────────
    return ok(res, {
      application_id:   application.id,
      application_code: application.application_code,
      status:           application.status,
      message:          "Application submitted successfully.",
    });
  })
);

/* =========================================================
   APPLICANT STATUS LOOKUP
========================================================= */

app.get(
  "/api/foundation/status/:code",
  asyncRoute(async (req, res) => {
    const code = cleanString(req.params.code, 80);
    const { data, error } = await supabase
      .from("htaf_applications")
      .select("application_code, status, program_type, created_at, updated_at")
      .eq("application_code", code)
      .single();
    if (error || !data) return fail(res, "Application not found.", 404);
    return ok(res, { application: data });
  })
);

/* =========================================================
   ADMIN APPLICATION LIST
========================================================= */

app.get(
  "/api/admin/foundation/applications",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const status = cleanString(req.query.status);
    let query = supabase
      .from("htaf_applications")
      .select("*")
      .order("created_at", { ascending: false });
    if (status) query = query.eq("status", status);
    const { data, error } = await query;
    if (error) throw error;
    return ok(res, { applications: data || [] });
  })
);

/* =========================================================
   ADMIN UPDATE APPLICATION
========================================================= */

app.patch(
  "/api/admin/foundation/applications/:id",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const id = cleanString(req.params.id, 80);
    const update = {
      status: cleanString(req.body.status, 80),
      notes: cleanString(req.body.notes, 5000),
      updated_at: nowIso(),
    };
    const { data, error } = await supabase
      .from("htaf_applications")
      .update(update)
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;
    await auditLog({
      actor_type: "admin",
      actor_id: req.admin.email,
      action: "htaf_application_updated",
      entity_type: "htaf_application",
      entity_id: id,
      metadata: update,
      req,
    });
    return ok(res, { application: data });
  })
);

/* =========================================================
   PART 4 OF 10 — AUTH, RIDER/DRIVER ONBOARDING
========================================================= */

const VERIFY_TTL_MINUTES = envNumber("VERIFY_TTL_MINUTES", 10);
const EMAIL_VERIFY_TTL_HOURS = envNumber("EMAIL_VERIFY_TTL_HOURS", 24);

function makeOtpCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function futureIsoMinutes(minutes) {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

function futureIsoHours(hours) {
  return new Date(Date.now() + hours * 60 * 60_000).toISOString();
}

async function createVerificationRecord({ channel, destination, purpose, user_type, metadata = {} }) {
  const code = channel === "email"
    ? crypto.randomBytes(24).toString("hex")
    : makeOtpCode();
  const expires_at = channel === "email"
    ? futureIsoHours(EMAIL_VERIFY_TTL_HOURS)
    : futureIsoMinutes(VERIFY_TTL_MINUTES);
  const record = {
    id: makeId("VERIFY"),
    channel,
    destination,
    purpose,
    user_type,
    code_hash: hashToken(code),
    attempts: 0,
    max_attempts: 5,
    used_at: null,
    expires_at,
    metadata,
    created_at: nowIso(),
  };
  const { data, error } = await supabase.from("verification_codes").insert(record).select().single();
  if (error) throw error;
  return { record: data, code };
}

async function verifyCode({ channel, destination, code, purpose }) {
  const { data, error } = await supabase
    .from("verification_codes")
    .select("*")
    .eq("channel", channel)
    .eq("destination", destination)
    .eq("purpose", purpose)
    .is("used_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!data) return { ok: false, reason: "No active verification code found." };
  if (new Date(data.expires_at).getTime() < Date.now()) return { ok: false, reason: "Verification code expired." };
  if (Number(data.attempts || 0) >= Number(data.max_attempts || 5)) return { ok: false, reason: "Too many verification attempts." };

  const codeHash = hashToken(code);
  const valid = timingSafeEqualString(codeHash, data.code_hash);
  if (!valid) {
    await supabase.from("verification_codes").update({ attempts: Number(data.attempts || 0) + 1 }).eq("id", data.id);
    return { ok: false, reason: "Invalid verification code." };
  }
  await supabase.from("verification_codes").update({ used_at: nowIso() }).eq("id", data.id);
  return { ok: true, record: data };
}

/* PUBLIC CONFIG */
app.get("/api/config/public", asyncRoute(async (req, res) => {
  return ok(res, {
    app_name: APP_NAME,
    app_base_url: APP_BASE_URL,
    support_email: SUPPORT_EMAIL,
    google_maps_enabled: Boolean(GOOGLE_MAPS_API_KEY),
    persona_enabled: ENABLE_PERSONA,
    checkr_enabled: ENABLE_CHECKR,
    stripe_enabled: Boolean(stripe),
    delivery_enabled: ENABLE_DELIVERY,
    food_delivery_enabled: ENABLE_FOOD_DELIVERY,
    grocery_delivery_enabled: ENABLE_GROCERY_DELIVERY,
    htaf_enabled: ENABLE_HTAF_APPLICATIONS,
    pricing: {
      base_fare: BASE_FARE,
      per_mile_rate: PER_MILE_RATE,
      per_minute_rate: PER_MINUTE_RATE,
      booking_fee: BOOKING_FEE,
      minimum_fare: MINIMUM_FARE,
    },
  });
}));

/* RIDER SIGNUP */
app.post("/api/riders/signup", asyncRoute(async (req, res) => {
  const missing = requireBody(req, ["first_name", "last_name", "email", "phone"]);
  if (missing.length) return fail(res, "Missing required rider signup fields.", 400, { missing });
  const rider = {
    id: makeId("RIDER"),
    first_name: cleanString(req.body.first_name, 120),
    last_name: cleanString(req.body.last_name, 120),
    email: cleanEmail(req.body.email),
    phone: cleanPhone(req.body.phone),
    city: cleanString(req.body.city, 120),
    state: cleanString(req.body.state || "TN", 40),
    status: ENABLE_RIDER_APPROVAL_GATE ? "pending_verification" : "active",
    email_verified: false,
    phone_verified: false,
    persona_verified: false,
    created_at: nowIso(),
    updated_at: nowIso(),
  };
  const { data, error } = await supabase.from("riders").insert(rider).select().single();
  if (error) throw error;
  await auditLog({ actor_type: "rider", actor_id: data.id, action: "rider_signup_created", entity_type: "rider", entity_id: data.id, req });
  return ok(res, { rider: data, next_steps: { email_verification: true, sms_verification: true, persona_verification: ENABLE_PERSONA } }, 201);
}));

/* DRIVER SIGNUP */
app.post("/api/drivers/signup", asyncRoute(async (req, res) => {
  const missing = requireBody(req, ["first_name", "last_name", "email", "phone"]);
  if (missing.length) return fail(res, "Missing required driver signup fields.", 400, { missing });
  const driver = {
    id: makeId("DRV"),
    first_name: cleanString(req.body.first_name, 120),
    last_name: cleanString(req.body.last_name, 120),
    email: cleanEmail(req.body.email),
    phone: cleanPhone(req.body.phone),
    city: cleanString(req.body.city || "Nashville", 120),
    state: cleanString(req.body.state || "TN", 40),
    vehicle_make: cleanString(req.body.vehicle_make, 100),
    vehicle_model: cleanString(req.body.vehicle_model, 100),
    vehicle_year: cleanString(req.body.vehicle_year, 20),
    license_plate: cleanString(req.body.license_plate, 40),
    status: "pending_verification",
    online: false,
    email_verified: false,
    phone_verified: false,
    persona_verified: false,
    checkr_status: "not_started",
    approval_status: "pending",
    rating: 5,
    total_trips: 0,
    created_at: nowIso(),
    updated_at: nowIso(),
  };
  const { data, error } = await supabase.from("drivers").insert(driver).select().single();
  if (error) throw error;
  await auditLog({ actor_type: "driver", actor_id: data.id, action: "driver_signup_created", entity_type: "driver", entity_id: data.id, req });
  return ok(res, { driver: data, next_steps: { email_verification: true, sms_verification: true, persona_verification: ENABLE_PERSONA, background_check: ENABLE_CHECKR } }, 201);
}));

/* EMAIL VERIFICATION START */
app.post("/api/verify/email/start", asyncRoute(async (req, res) => {
  const missing = requireBody(req, ["email", "purpose", "user_type"]);
  if (missing.length) return fail(res, "Missing required email verification fields.", 400, { missing });
  const email = cleanEmail(req.body.email);
  const purpose = cleanString(req.body.purpose, 80);
  const userType = normalizeRole(req.body.user_type);
  const { code } = await createVerificationRecord({ channel: "email", destination: email, purpose, user_type: userType, metadata: { requested_from: "web" } });
  const verifyUrl = `${APP_BASE_URL}/verify-email.html?email=${encodeURIComponent(email)}&purpose=${encodeURIComponent(purpose)}&token=${encodeURIComponent(code)}`;
  await sendEmail({
    to: email,
    subject: "Verify your Harvey Taxi email",
    html: `<h2>Verify Your Email</h2><p>Please verify your email address to continue with Harvey Taxi.</p><p><a href="${verifyUrl}">Verify Email</a></p><p>This link expires in ${EMAIL_VERIFY_TTL_HOURS} hours.</p>`,
  });
  await auditLog({ actor_type: userType, actor_id: email, action: "email_verification_started", metadata: { purpose }, req });
  return ok(res, { message: "Verification email sent.", email });
}));

/* EMAIL VERIFICATION CONFIRM */
app.post("/api/verify/email/confirm", asyncRoute(async (req, res) => {
  const missing = requireBody(req, ["email", "token", "purpose"]);
  if (missing.length) return fail(res, "Missing verification fields.", 400, { missing });
  const email = cleanEmail(req.body.email);
  const result = await verifyCode({ channel: "email", destination: email, code: req.body.token, purpose: cleanString(req.body.purpose, 80) });
  if (!result.ok) return fail(res, result.reason, 400);
  await supabase.from("riders").update({ email_verified: true, updated_at: nowIso() }).eq("email", email);
  await supabase.from("drivers").update({ email_verified: true, updated_at: nowIso() }).eq("email", email);
  await auditLog({ actor_id: email, action: "email_verified", req });
  return ok(res, { message: "Email verified successfully." });
}));

/* SMS VERIFICATION START */
app.post("/api/verify/sms/start", asyncRoute(async (req, res) => {
  const missing = requireBody(req, ["phone", "purpose", "user_type"]);
  if (missing.length) return fail(res, "Missing required SMS verification fields.", 400, { missing });
  const phone = cleanPhone(req.body.phone);
  const purpose = cleanString(req.body.purpose, 80);
  const userType = normalizeRole(req.body.user_type);
  const { code } = await createVerificationRecord({ channel: "sms", destination: phone, purpose, user_type: userType, metadata: { requested_from: "web" } });
  await sendSms({ to: phone, body: `Your Harvey Taxi verification code is ${code}. It expires in ${VERIFY_TTL_MINUTES} minutes.` });
  await auditLog({ actor_type: userType, actor_id: phone, action: "sms_verification_started", metadata: { purpose }, req });
  return ok(res, { message: "Verification code sent.", phone, expires_in_minutes: VERIFY_TTL_MINUTES });
}));

/* SMS VERIFICATION CONFIRM */
app.post("/api/verify/sms/confirm", asyncRoute(async (req, res) => {
  const missing = requireBody(req, ["phone", "code", "purpose"]);
  if (missing.length) return fail(res, "Missing verification fields.", 400, { missing });
  const phone = cleanPhone(req.body.phone);
  const result = await verifyCode({ channel: "sms", destination: phone, code: cleanString(req.body.code, 20), purpose: cleanString(req.body.purpose, 80) });
  if (!result.ok) return fail(res, result.reason, 400);
  await supabase.from("riders").update({ phone_verified: true, updated_at: nowIso() }).eq("phone", phone);
  await supabase.from("drivers").update({ phone_verified: true, updated_at: nowIso() }).eq("phone", phone);
  await auditLog({ actor_id: phone, action: "phone_verified", req });
  return ok(res, { message: "Phone verified successfully." });
}));

/* =========================================================
   PART 5 OF 10 — PERSONA + CHECKR
========================================================= */

async function personaRequest(pathname, body = {}) {
  if (!PERSONA_API_KEY || !ENABLE_PERSONA) throw new Error("Persona is not configured.");
  const response = await fetch(`https://withpersona.com/api/v1${pathname}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${PERSONA_API_KEY}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(json?.errors?.[0]?.detail || json?.message || "Persona request failed.");
  return json;
}

async function createPersonaInquiry({ user_type, user_id, email, phone, first_name, last_name }) {
  const templateId = user_type === "driver" ? PERSONA_TEMPLATE_ID_DRIVER : PERSONA_TEMPLATE_ID_RIDER;
  if (!templateId) throw new Error(`Missing Persona template for ${user_type}.`);
  const response = await personaRequest("/inquiries", {
    data: {
      type: "inquiry",
      attributes: {
        "inquiry-template-id": templateId,
        "reference-id": user_id,
        fields: { name_first: first_name, name_last: last_name, email_address: email, phone_number: phone },
      },
      meta: { user_type, user_id },
    },
  });
  return response?.data;
}

app.post("/api/persona/inquiry", asyncRoute(async (req, res) => {
  const missing = requireBody(req, ["user_type", "user_id", "email", "first_name", "last_name"]);
  if (missing.length) return fail(res, "Missing Persona inquiry fields.", 400, { missing });
  const userType = cleanString(req.body.user_type, 20).toLowerCase();
  if (!["rider", "driver"].includes(userType)) return fail(res, "Invalid Persona user type.", 400);
  const inquiry = await createPersonaInquiry({
    user_type: userType,
    user_id: cleanString(req.body.user_id, 100),
    email: cleanEmail(req.body.email),
    phone: cleanPhone(req.body.phone),
    first_name: cleanString(req.body.first_name, 120),
    last_name: cleanString(req.body.last_name, 120),
  });
  const table = userType === "driver" ? "drivers" : "riders";
  await supabase.from(table).update({ persona_inquiry_id: inquiry?.id || null, updated_at: nowIso() }).eq("id", req.body.user_id);
  await auditLog({ actor_type: userType, actor_id: req.body.user_id, action: "persona_inquiry_created", entity_type: userType, entity_id: req.body.user_id, metadata: { inquiry_id: inquiry?.id }, req });
  return ok(res, { inquiry, message: "Persona inquiry created." });
}));

function verifyPersonaSignature(req) {
  if (!PERSONA_WEBHOOK_SECRET) return true;
  const signature = req.headers["persona-signature"] || req.headers["x-persona-signature"];
  if (!signature) return false;
  const raw = req.rawBody ? req.rawBody : JSON.stringify(req.body || {});
  const expected = crypto.createHmac("sha256", PERSONA_WEBHOOK_SECRET).update(raw).digest("hex");
  return timingSafeEqualString(signature, expected);
}

app.post("/api/persona/webhook", express.raw({ type: "*/*", limit: RAW_WEBHOOK_LIMIT }), asyncRoute(async (req, res) => {
  const raw = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : String(req.body || "");
  req.rawBody = raw;
  let payload = {};
  try { payload = JSON.parse(raw || "{}"); } catch { return fail(res, "Invalid Persona webhook payload.", 400); }
  if (!verifyPersonaSignature(req)) return fail(res, "Invalid Persona signature.", 401);
  const eventType = payload?.data?.attributes?.name || payload?.type || "persona_event";
  const inquiry = payload?.data?.attributes?.payload?.data || payload?.data;
  const referenceId = inquiry?.attributes?.["reference-id"] || inquiry?.attributes?.reference_id || inquiry?.relationships?.account?.data?.id || null;
  const status = inquiry?.attributes?.status || payload?.data?.attributes?.status || "unknown";
  const isApproved = ["completed", "approved", "passed"].includes(String(status).toLowerCase()) || String(eventType).includes("approved") || String(eventType).includes("completed");
  if (referenceId) {
    await supabase.from("riders").update({ persona_status: status, persona_verified: isApproved, updated_at: nowIso() }).eq("id", referenceId);
    await supabase.from("drivers").update({ persona_status: status, persona_verified: isApproved, updated_at: nowIso() }).eq("id", referenceId);
  }
  await auditLog({ action: "persona_webhook_received", entity_type: "persona", entity_id: referenceId, metadata: { event_type: eventType, status, approved: isApproved }, req });
  return ok(res, { received: true });
}));

async function checkrRequest(pathname, body = {}) {
  if (!CHECKR_API_KEY || !ENABLE_CHECKR) throw new Error("Checkr is not configured.");
  const basic = Buffer.from(`${CHECKR_API_KEY}:`).toString("base64");
  const response = await fetch(`https://api.checkr.com/v1${pathname}`, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(json?.error || json?.message || "Checkr request failed.");
  return json;
}

async function createCheckrCandidate(driver) {
  return checkrRequest("/candidates", {
    first_name: driver.first_name,
    last_name: driver.last_name,
    email: driver.email,
    phone: driver.phone,
    work_locations: [{ country: CHECKR_WORK_COUNTRY, state: CHECKR_WORK_STATE, city: CHECKR_WORK_CITY }],
    metadata: { driver_id: driver.id, app_name: APP_NAME },
  });
}

async function createCheckrInvitation(candidateId) {
  return checkrRequest("/invitations", {
    candidate_id: candidateId,
    package: CHECKR_PACKAGE,
    work_locations: [{ country: CHECKR_WORK_COUNTRY, state: CHECKR_WORK_STATE, city: CHECKR_WORK_CITY }],
  });
}

app.post("/api/checkr/start", asyncRoute(async (req, res) => {
  const missing = requireBody(req, ["driver_id"]);
  if (missing.length) return fail(res, "Missing driver_id.", 400, { missing });
  const driverId = cleanString(req.body.driver_id, 100);
  const { data: driver, error } = await supabase.from("drivers").select("*").eq("id", driverId).single();
  if (error || !driver) return fail(res, "Driver not found.", 404);
  const candidate = await createCheckrCandidate(driver);
  const invitation = await createCheckrInvitation(candidate.id);
  await supabase.from("drivers").update({ checkr_candidate_id: candidate.id, checkr_invitation_id: invitation.id, checkr_invitation_url: invitation.invitation_url || null, checkr_status: "invited", updated_at: nowIso() }).eq("id", driverId);
  await auditLog({ actor_type: "driver", actor_id: driverId, action: "checkr_invitation_created", entity_type: "driver", entity_id: driverId, metadata: { candidate_id: candidate.id, invitation_id: invitation.id }, req });
  return ok(res, { candidate, invitation, message: "Background check invitation created." });
}));

function verifyCheckrSignature(req) {
  if (!CHECKR_WEBHOOK_SECRET) return true;
  const signature = req.headers["checkr-signature"] || req.headers["x-checkr-signature"];
  if (!signature) return false;
  const raw = req.rawBody || JSON.stringify(req.body || {});
  const expected = crypto.createHmac("sha256", CHECKR_WEBHOOK_SECRET).update(raw).digest("hex");
  return timingSafeEqualString(signature, expected);
}

app.post("/api/checkr/webhook", express.raw({ type: "*/*", limit: RAW_WEBHOOK_LIMIT }), asyncRoute(async (req, res) => {
  const raw = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : String(req.body || "");
  req.rawBody = raw;
  let payload = {};
  try { payload = JSON.parse(raw || "{}"); } catch { return fail(res, "Invalid Checkr webhook payload.", 400); }
  if (!verifyCheckrSignature(req)) return fail(res, "Invalid Checkr signature.", 401);
  const eventType = payload?.type || payload?.event || "checkr_event";
  const object = payload?.data?.object || payload?.object || payload?.data || {};
  const candidateId = object?.candidate_id || object?.candidate?.id || object?.id || null;
  const status = object?.status || object?.result || eventType;
  const clear = ["clear", "complete", "completed"].includes(String(status).toLowerCase());
  if (candidateId) {
    await supabase.from("drivers").update({ checkr_status: status, approval_status: clear ? "eligible_for_review" : "pending", updated_at: nowIso() }).eq("checkr_candidate_id", candidateId);
  }
  await auditLog({ action: "checkr_webhook_received", entity_type: "checkr", entity_id: candidateId, metadata: { event_type: eventType, status, clear }, req });
  return ok(res, { received: true });
}));

app.get("/api/drivers/:id/readiness", asyncRoute(async (req, res) => {
  const driverId = cleanString(req.params.id, 100);
  const { data: driver, error } = await supabase.from("drivers").select("*").eq("id", driverId).single();
  if (error || !driver) return fail(res, "Driver not found.", 404);
  const checks = {
    email_verified: Boolean(driver.email_verified),
    phone_verified: Boolean(driver.phone_verified),
    persona_verified: Boolean(driver.persona_verified),
    checkr_ready: ["clear", "complete", "completed", "eligible_for_review"].includes(String(driver.checkr_status || driver.approval_status || "").toLowerCase()),
    vehicle_present: Boolean(driver.vehicle_make && driver.vehicle_model && driver.vehicle_year),
  };
  const ready = Object.values(checks).every(Boolean);
  return ok(res, { driver_id: driver.id, ready, status: driver.status, approval_status: driver.approval_status, checks });
}));

app.patch("/api/admin/drivers/:id/approve", requireAdmin, asyncRoute(async (req, res) => {
  const driverId = cleanString(req.params.id, 100);
  const { data, error } = await supabase.from("drivers").update({ status: "active", approval_status: "approved", online: false, approved_at: nowIso(), updated_at: nowIso() }).eq("id", driverId).select().single();
  if (error) throw error;
  await auditLog({ actor_type: "admin", actor_id: req.admin.email, action: "driver_approved", entity_type: "driver", entity_id: driverId, req });
  return ok(res, { driver: data });
}));

app.patch("/api/admin/drivers/:id/reject", requireAdmin, asyncRoute(async (req, res) => {
  const driverId = cleanString(req.params.id, 100);
  const reason = cleanString(req.body.reason, 1000);
  const { data, error } = await supabase.from("drivers").update({ status: "rejected", approval_status: "rejected", rejection_reason: reason, updated_at: nowIso() }).eq("id", driverId).select().single();
  if (error) throw error;
  await auditLog({ actor_type: "admin", actor_id: req.admin.email, action: "driver_rejected", entity_type: "driver", entity_id: driverId, metadata: { reason }, req });
  return ok(res, { driver: data });
}));

/* =========================================================
   PART 6 OF 10 — RIDE ESTIMATES, PAYMENT, DISPATCH
========================================================= */

const RIDE_STATUS = {
  DRAFT: "draft",
  PAYMENT_REQUIRED: "payment_required",
  PAYMENT_AUTHORIZED: "payment_authorized",
  AWAITING_DRIVER: "awaiting_driver_acceptance",
  DRIVER_ASSIGNED: "driver_assigned",
  DRIVER_ENROUTE: "driver_enroute",
  ARRIVED: "arrived",
  IN_PROGRESS: "in_progress",
  COMPLETED: "completed",
  CANCELLED: "cancelled",
  FAILED: "failed",
};

async function getRiderReadiness(riderId) {
  const { data: rider, error } = await supabase.from("riders").select("*").eq("id", riderId).maybeSingle();
  if (error || !rider) return { ready: false, reason: "Rider profile not found." };
  if (!ENABLE_RIDER_APPROVAL_GATE) return { ready: true, rider };
  const checks = {
    email_verified: Boolean(rider.email_verified),
    phone_verified: Boolean(rider.phone_verified),
    persona_verified: ENABLE_PERSONA ? Boolean(rider.persona_verified) : true,
    status_ready: ["active", "approved"].includes(String(rider.status || "").toLowerCase()),
  };
  const ready = Object.values(checks).every(Boolean);
  return { ready, rider, checks, reason: ready ? null : "Rider verification is not complete." };
}

async function findAvailableDrivers({ pickup_lat, pickup_lng, radius_miles = DRIVER_SEARCH_RADIUS_MILES, limit = 10 }) {
  const { data, error } = await supabase.from("drivers").select("*").eq("online", true).eq("status", "active").eq("approval_status", "approved").limit(50);
  if (error) throw error;
  return (data || [])
    .map((driver) => {
      const lat = Number(driver.current_lat || driver.latitude);
      const lng = Number(driver.current_lng || driver.longitude);
      let distance = Number.POSITIVE_INFINITY;
      if (Number.isFinite(lat) && Number.isFinite(lng) && Number.isFinite(Number(pickup_lat)) && Number.isFinite(Number(pickup_lng))) {
        distance = haversineMiles(pickup_lat, pickup_lng, lat, lng);
      }
      return { ...driver, distance_miles: Number.isFinite(distance) ? Number(distance.toFixed(2)) : null };
    })
    .filter((d) => d.distance_miles === null || d.distance_miles <= radius_miles)
    .sort((a, b) => (a.distance_miles ?? 9999) - (b.distance_miles ?? 9999))
    .slice(0, limit);
}

async function createDriverOffer({ ride_id, driver_id, attempt = 1, expires_in_seconds = DISPATCH_TIMEOUT_SECONDS }) {
  const offer = {
    id: makeId("OFFER"),
    ride_id,
    driver_id,
    status: "pending",
    attempt,
    expires_at: new Date(Date.now() + expires_in_seconds * 1000).toISOString(),
    created_at: nowIso(),
    updated_at: nowIso(),
  };
  const { data, error } = await supabase.from("driver_offers").insert(offer).select().single();
  if (error) throw error;
  return data;
}

async function dispatchRide(ride) {
  const drivers = await findAvailableDrivers({ pickup_lat: ride.pickup_lat, pickup_lng: ride.pickup_lng, radius_miles: DRIVER_SEARCH_RADIUS_MILES, limit: MAX_DISPATCH_ATTEMPTS });
  if (!drivers.length) {
    await supabase.from("rides").update({ status: RIDE_STATUS.FAILED, dispatch_status: "no_drivers_available", updated_at: nowIso() }).eq("id", ride.id);
    return { dispatched: false, reason: "No available drivers." };
  }
  const firstDriver = drivers[0];
  const offer = await createDriverOffer({ ride_id: ride.id, driver_id: firstDriver.id, attempt: 1 });
  await supabase.from("rides").update({ status: RIDE_STATUS.AWAITING_DRIVER, dispatch_status: "offer_sent", current_offer_id: offer.id, current_driver_id: firstDriver.id, dispatch_attempts: 1, updated_at: nowIso() }).eq("id", ride.id);
  return { dispatched: true, offer, driver: firstDriver };
}

app.post("/api/rides/estimate", asyncRoute(async (req, res) => {
  const miles = Number(req.body.miles || req.body.distance_miles || 0);
  const minutes = Number(req.body.minutes || req.body.duration_minutes || 0);
  const rideType = normalizeRideType(req.body.ride_type);
  const estimate = calculateRideEstimate({ miles, minutes, ride_type: rideType });
  await auditLog({ action: "ride_estimate_created", metadata: { ride_type: rideType, estimate }, req });
  return ok(res, { estimate });
}));

app.post("/api/rides/payment-intent", asyncRoute(async (req, res) => {
  if (!stripe || !ENABLE_PAYMENT_GATE) return fail(res, "Payments are not configured.", 503);
  const estimate = calculateRideEstimate({ miles: Number(req.body.miles || 0), minutes: Number(req.body.minutes || 0), ride_type: normalizeRideType(req.body.ride_type) });
  const amountCents = Math.round(estimate.total * 100);
  const paymentIntent = await stripe.paymentIntents.create({
    amount: amountCents,
    currency: "usd",
    capture_method: "manual",
    automatic_payment_methods: { enabled: true },
    metadata: { app: "harvey_taxi", ride_type: normalizeRideType(req.body.ride_type), rider_id: cleanString(req.body.rider_id, 100) },
  });
  await auditLog({ action: "ride_payment_intent_created", actor_type: "rider", actor_id: cleanString(req.body.rider_id, 100), metadata: { payment_intent_id: paymentIntent.id, amount: estimate.total }, req });
  return ok(res, { payment_intent_id: paymentIntent.id, client_secret: paymentIntent.client_secret, estimate });
}));

app.post("/api/rides/request", asyncRoute(async (req, res) => {
  const missing = requireBody(req, ["pickup", "destination"]);
  if (missing.length) return fail(res, "Missing ride request fields.", 400, { missing });
  const riderId = cleanString(req.body.rider_id, 100);
  if (riderId) {
    const readiness = await getRiderReadiness(riderId);
    if (!readiness.ready) return fail(res, readiness.reason, 403, { checks: readiness.checks || {} });
  }
  const rideType = normalizeRideType(req.body.ride_type);
  const estimate = calculateRideEstimate({ miles: Number(req.body.miles || req.body.distance_miles || 0), minutes: Number(req.body.minutes || req.body.duration_minutes || 0), ride_type: rideType });
  let status = RIDE_STATUS.PAYMENT_AUTHORIZED;
  if (ENABLE_PAYMENT_GATE && !req.body.payment_intent_id) status = RIDE_STATUS.PAYMENT_REQUIRED;
  const ride = {
    id: makeId("RIDE"),
    rider_id: riderId || null,
    rider_name: cleanString(req.body.rider_name, 180),
    rider_phone: cleanPhone(req.body.rider_phone),
    pickup: cleanString(req.body.pickup, 500),
    destination: cleanString(req.body.destination, 500),
    pickup_lat: req.body.pickup_lat || null,
    pickup_lng: req.body.pickup_lng || null,
    destination_lat: req.body.destination_lat || null,
    destination_lng: req.body.destination_lng || null,
    ride_type: rideType,
    scheduled_for: req.body.scheduled_for || null,
    preferred_driver_id: cleanString(req.body.preferred_driver_id, 100) || null,
    payment_intent_id: cleanString(req.body.payment_intent_id, 200) || null,
    status,
    dispatch_status: status === RIDE_STATUS.PAYMENT_REQUIRED ? "awaiting_payment" : "ready_to_dispatch",
    estimate_total: estimate.total,
    driver_payout: estimate.driver_payout,
    platform_fee: estimate.platform_fee,
    miles: estimate.miles,
    minutes: estimate.minutes,
    notes: cleanString(req.body.notes, 1000),
    created_at: nowIso(),
    updated_at: nowIso(),
  };
  const { data, error } = await supabase.from("rides").insert(ride).select().single();
  if (error) throw error;
  let dispatch = null;
  if (status === RIDE_STATUS.PAYMENT_AUTHORIZED && !ride.scheduled_for) {
    dispatch = await dispatchRide(data);
  }
  await auditLog({ actor_type: "rider", actor_id: riderId || null, action: "ride_requested", entity_type: "ride", entity_id: data.id, metadata: { ride_type: rideType, status, dispatch }, req });
  return ok(res, { ride: data, estimate, dispatch }, 201);
}));

app.post("/api/rides/:id/authorize", asyncRoute(async (req, res) => {
  const rideId = cleanString(req.params.id, 100);
  const { data: ride, error } = await supabase.from("rides").select("*").eq("id", rideId).single();
  if (error || !ride) return fail(res, "Ride not found.", 404);
  const paymentIntentId = cleanString(req.body.payment_intent_id || ride.payment_intent_id, 200);
  await supabase.from("rides").update({ payment_intent_id: paymentIntentId, status: RIDE_STATUS.PAYMENT_AUTHORIZED, dispatch_status: "ready_to_dispatch", updated_at: nowIso() }).eq("id", rideId);
  const updatedRide = { ...ride, payment_intent_id: paymentIntentId, status: RIDE_STATUS.PAYMENT_AUTHORIZED };
  const dispatch = await dispatchRide(updatedRide);
  await auditLog({ actor_type: "rider", actor_id: ride.rider_id, action: "ride_authorized", entity_type: "ride", entity_id: rideId, metadata: { payment_intent_id: paymentIntentId, dispatch }, req });
  return ok(res, { ride_id: rideId, dispatch });
}));

app.post("/api/driver/offers/:offerId/accept", asyncRoute(async (req, res) => {
  const offerId = cleanString(req.params.offerId, 100);
  const driverId = cleanString(req.body.driver_id, 100);
  const { data: offer, error } = await supabase.from("driver_offers").select("*").eq("id", offerId).single();
  if (error || !offer) return fail(res, "Offer not found.", 404);
  if (offer.status !== "pending") return fail(res, "Offer is no longer available.", 409);
  if (driverId && offer.driver_id !== driverId) return fail(res, "Offer does not belong to this driver.", 403);
  await supabase.from("driver_offers").update({ status: "accepted", responded_at: nowIso(), updated_at: nowIso() }).eq("id", offerId);
  await supabase.from("rides").update({ status: RIDE_STATUS.DRIVER_ASSIGNED, dispatch_status: "accepted", driver_id: offer.driver_id, current_driver_id: offer.driver_id, accepted_at: nowIso(), updated_at: nowIso() }).eq("id", offer.ride_id);
  await auditLog({ actor_type: "driver", actor_id: offer.driver_id, action: "ride_offer_accepted", entity_type: "ride", entity_id: offer.ride_id, metadata: { offer_id: offerId }, req });
  return ok(res, { ride_id: offer.ride_id, driver_id: offer.driver_id, status: RIDE_STATUS.DRIVER_ASSIGNED });
}));

app.post("/api/driver/offers/:offerId/decline", asyncRoute(async (req, res) => {
  const offerId = cleanString(req.params.offerId, 100);
  const reason = cleanString(req.body.reason, 500);
  const { data: offer, error } = await supabase.from("driver_offers").select("*").eq("id", offerId).single();
  if (error || !offer) return fail(res, "Offer not found.", 404);
  await supabase.from("driver_offers").update({ status: "declined", decline_reason: reason, responded_at: nowIso(), updated_at: nowIso() }).eq("id", offerId);
  await auditLog({ actor_type: "driver", actor_id: offer.driver_id, action: "ride_offer_declined", entity_type: "ride", entity_id: offer.ride_id, metadata: { offer_id: offerId, reason }, req });
  if (ENABLE_AUTO_REDISPATCH) {
    const { data: ride } = await supabase.from("rides").select("*").eq("id", offer.ride_id).single();
    if (ride) {
      const dispatchAttempts = Number(ride.dispatch_attempts || 0);
      if (dispatchAttempts < MAX_DISPATCH_ATTEMPTS) {
        await supabase.from("rides").update({ dispatch_attempts: dispatchAttempts + 1, current_driver_id: null, current_offer_id: null, dispatch_status: "redispatching", updated_at: nowIso() }).eq("id", ride.id);
        await dispatchRide({ ...ride, dispatch_attempts: dispatchAttempts + 1 });
      }
    }
  }
  return ok(res, { declined: true });
}));

/* =========================================================
   PART 7 OF 10 — DRIVER MISSION PIPELINE
========================================================= */

async function getRideOrFail(rideId) {
  const { data, error } = await supabase.from("rides").select("*").eq("id", rideId).single();
  if (error || !data) throw new Error("Ride not found.");
  return data;
}

async function getDriverOrFail(driverId) {
  const { data, error } = await supabase.from("drivers").select("*").eq("id", driverId).single();
  if (error || !data) throw new Error("Driver not found.");
  return data;
}

async function ensureAssignedDriver(ride, driverId) {
  if (String(ride.driver_id || "") !== String(driverId || "")) throw new Error("Driver is not assigned to this ride.");
}

app.post("/api/driver/rides/:rideId/enroute", asyncRoute(async (req, res) => {
  const rideId = cleanString(req.params.rideId, 100);
  const driverId = cleanString(req.body.driver_id, 100);
  const ride = await getRideOrFail(rideId);
  await ensureAssignedDriver(ride, driverId);
  await supabase.from("rides").update({ status: RIDE_STATUS.DRIVER_ENROUTE, enroute_at: nowIso(), updated_at: nowIso() }).eq("id", rideId);
  await auditLog({ actor_type: "driver", actor_id: driverId, action: "driver_enroute", entity_type: "ride", entity_id: rideId, req });
  return ok(res, { ride_id: rideId, status: RIDE_STATUS.DRIVER_ENROUTE });
}));

app.post("/api/driver/rides/:rideId/arrived", asyncRoute(async (req, res) => {
  const rideId = cleanString(req.params.rideId, 100);
  const driverId = cleanString(req.body.driver_id, 100);
  const ride = await getRideOrFail(rideId);
  await ensureAssignedDriver(ride, driverId);
  await supabase.from("rides").update({ status: RIDE_STATUS.ARRIVED, arrived_at: nowIso(), updated_at: nowIso() }).eq("id", rideId);
  await auditLog({ actor_type: "driver", actor_id: driverId, action: "driver_arrived", entity_type: "ride", entity_id: rideId, req });
  return ok(res, { ride_id: rideId, status: RIDE_STATUS.ARRIVED });
}));

app.post("/api/driver/rides/:rideId/start", asyncRoute(async (req, res) => {
  const rideId = cleanString(req.params.rideId, 100);
  const driverId = cleanString(req.body.driver_id, 100);
  const ride = await getRideOrFail(rideId);
  await ensureAssignedDriver(ride, driverId);
  await supabase.from("rides").update({ status: RIDE_STATUS.IN_PROGRESS, trip_started_at: nowIso(), updated_at: nowIso() }).eq("id", rideId);
  await auditLog({ actor_type: "driver", actor_id: driverId, action: "ride_started", entity_type: "ride", entity_id: rideId, req });
  return ok(res, { ride_id: rideId, status: RIDE_STATUS.IN_PROGRESS });
}));

async function captureRidePayment(ride) {
  if (!ENABLE_PAYMENT_GATE || !stripe || !ride.payment_intent_id) return null;
  try {
    return await stripe.paymentIntents.capture(ride.payment_intent_id);
  } catch (error) {
    console.error("Payment capture failed:", error);
    return null;
  }
}

async function createDriverEarning({ ride, driverId }) {
  const payout = Number(ride.driver_payout || 0);
  const earning = { id: makeId("EARN"), ride_id: ride.id, driver_id: driverId, gross_amount: payout, net_amount: payout, status: "earned", created_at: nowIso() };
  const { error } = await supabase.from("driver_earnings").insert(earning);
  if (error) console.error(error);
  return earning;
}

app.post("/api/driver/rides/:rideId/complete", asyncRoute(async (req, res) => {
  const rideId = cleanString(req.params.rideId, 100);
  const driverId = cleanString(req.body.driver_id, 100);
  const ride = await getRideOrFail(rideId);
  await ensureAssignedDriver(ride, driverId);
  const paymentResult = await captureRidePayment(ride);
  const earning = await createDriverEarning({ ride, driverId });
  await supabase.from("rides").update({ status: RIDE_STATUS.COMPLETED, completed_at: nowIso(), payment_captured: Boolean(paymentResult), updated_at: nowIso() }).eq("id", rideId);
  await auditLog({ actor_type: "driver", actor_id: driverId, action: "ride_completed", entity_type: "ride", entity_id: rideId, metadata: { earning, payment_captured: Boolean(paymentResult) }, req });
  return ok(res, { ride_id: rideId, status: RIDE_STATUS.COMPLETED, earning, payment_captured: Boolean(paymentResult) });
}));

app.post("/api/driver/location", asyncRoute(async (req, res) => {
  const driverId = cleanString(req.body.driver_id, 100);
  if (!driverId) return fail(res, "driver_id required", 400);
  await supabase.from("drivers").update({ current_lat: Number(req.body.latitude), current_lng: Number(req.body.longitude), heading: Number(req.body.heading || 0), speed: Number(req.body.speed || 0), last_seen_at: nowIso(), updated_at: nowIso() }).eq("id", driverId);
  return ok(res, { updated: true });
}));

app.post("/api/driver/status", asyncRoute(async (req, res) => {
  const driverId = cleanString(req.body.driver_id, 100);
  const online = Boolean(req.body.online);
  await supabase.from("drivers").update({ online, last_seen_at: nowIso(), updated_at: nowIso() }).eq("id", driverId);
  await auditLog({ actor_type: "driver", actor_id: driverId, action: online ? "driver_online" : "driver_offline", req });
  return ok(res, { online });
}));

app.get("/api/driver/:driverId/missions", asyncRoute(async (req, res) => {
  const driverId = cleanString(req.params.driverId, 100);
  const { data, error } = await supabase.from("rides").select("*").eq("driver_id", driverId).in("status", [RIDE_STATUS.DRIVER_ASSIGNED, RIDE_STATUS.DRIVER_ENROUTE, RIDE_STATUS.ARRIVED, RIDE_STATUS.IN_PROGRESS]).order("created_at", { ascending: false });
  if (error) throw error;
  return ok(res, { missions: data || [] });
}));

app.get("/api/driver/:driverId/history", asyncRoute(async (req, res) => {
  const driverId = cleanString(req.params.driverId, 100);
  const { data, error } = await supabase.from("rides").select("*").eq("driver_id", driverId).eq("status", RIDE_STATUS.COMPLETED).order("completed_at", { ascending: false }).limit(100);
  if (error) throw error;
  return ok(res, { history: data || [] });
}));

app.get("/api/driver/:driverId/earnings", asyncRoute(async (req, res) => {
  const driverId = cleanString(req.params.driverId, 100);
  const { data, error } = await supabase.from("driver_earnings").select("*").eq("driver_id", driverId);
  if (error) throw error;
  const total = (data || []).reduce((sum, item) => sum + Number(item.net_amount || 0), 0);
  return ok(res, { total_earnings: total, records: data || [] });
}));

/* =========================================================
   PART 8 OF 10 — ADMIN OPERATIONS + SSE
========================================================= */

const sseClients = new Map();

function sendSse(clientId, event, data) {
  const client = sseClients.get(clientId);
  if (!client) return;
  client.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function broadcastSse(event, data) {
  for (const clientId of sseClients.keys()) sendSse(clientId, event, data);
}

app.get("/api/admin/stream", requireAdmin, asyncRoute(async (req, res) => {
  const clientId = makeId("SSE");
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();
  sseClients.set(clientId, res);
  sendSse(clientId, "connected", { client_id: clientId, connected_at: nowIso() });
  const heartbeat = setInterval(() => sendSse(clientId, "heartbeat", { at: nowIso() }), 25_000);
  req.on("close", () => { clearInterval(heartbeat); sseClients.delete(clientId); });
}));

app.get("/api/admin/overview", requireAdmin, asyncRoute(async (req, res) => {
  const [riders, drivers, rides, htaf, deliveries] = await Promise.all([
    supabase.from("riders").select("id", { count: "exact", head: true }),
    supabase.from("drivers").select("id", { count: "exact", head: true }),
    supabase.from("rides").select("id", { count: "exact", head: true }),
    supabase.from("htaf_applications").select("id", { count: "exact", head: true }),
    supabase.from("deliveries").select("id", { count: "exact", head: true }),
  ]);
  return ok(res, { overview: { riders: riders.count || 0, drivers: drivers.count || 0, rides: rides.count || 0, htaf_applications: htaf.count || 0, deliveries: deliveries.count || 0, server_time: nowIso(), environment: NODE_ENV } });
}));

app.get("/api/admin/rides", requireAdmin, asyncRoute(async (req, res) => {
  const status = cleanString(req.query.status, 80);
  let query = supabase.from("rides").select("*").order("created_at", { ascending: false }).limit(envNumber("ADMIN_LIST_LIMIT", 200));
  if (status) query = query.eq("status", status);
  const { data, error } = await query;
  if (error) throw error;
  return ok(res, { rides: data || [] });
}));

app.patch("/api/admin/rides/:id/status", requireAdmin, asyncRoute(async (req, res) => {
  const rideId = cleanString(req.params.id, 100);
  const status = cleanString(req.body.status, 80);
  const allowed = Object.values(RIDE_STATUS);
  if (!allowed.includes(status)) return fail(res, "Invalid ride status.", 400, { allowed });
  const { data, error } = await supabase.from("rides").update({ status, admin_note: cleanString(req.body.note, 1000), updated_at: nowIso() }).eq("id", rideId).select().single();
  if (error) throw error;
  await auditLog({ actor_type: "admin", actor_id: req.admin.email, action: "admin_ride_status_updated", entity_type: "ride", entity_id: rideId, metadata: { status, note: req.body.note || null }, req });
  broadcastSse("ride_updated", { ride: data });
  return ok(res, { ride: data });
}));

app.post("/api/admin/rides/:id/assign-driver", requireAdmin, asyncRoute(async (req, res) => {
  const rideId = cleanString(req.params.id, 100);
  const driverId = cleanString(req.body.driver_id, 100);
  if (!driverId) return fail(res, "driver_id required.", 400);
  const driver = await getDriverOrFail(driverId);
  const { data, error } = await supabase.from("rides").update({ driver_id: driver.id, current_driver_id: driver.id, status: RIDE_STATUS.DRIVER_ASSIGNED, dispatch_status: "admin_assigned", assigned_by_admin: true, assigned_at: nowIso(), updated_at: nowIso() }).eq("id", rideId).select().single();
  if (error) throw error;
  await auditLog({ actor_type: "admin", actor_id: req.admin.email, action: "admin_driver_assigned", entity_type: "ride", entity_id: rideId, metadata: { driver_id: driverId }, req });
  broadcastSse("ride_assigned", { ride: data, driver });
  return ok(res, { ride: data, driver });
}));

app.post("/api/admin/foundation/applications/:id/create-ride", requireAdmin, asyncRoute(async (req, res) => {
  const applicationId = cleanString(req.params.id, 100);
  const { data: application, error } = await supabase.from("htaf_applications").select("*").eq("id", applicationId).single();
  if (error || !application) return fail(res, "HTAF application not found.", 404);
  const estimate = calculateRideEstimate({ miles: Number(req.body.miles || 0), minutes: Number(req.body.minutes || 0), ride_type: "foundation" });
  const ride = {
    id: makeId("RIDE"),
    rider_id: null,
    htaf_application_id: application.id,
    rider_name: `${application.first_name} ${application.last_name}`,
    rider_phone: application.phone,
    pickup: cleanString(req.body.pickup || application.pickup_city, 500),
    destination: cleanString(req.body.destination || application.destination, 500),
    ride_type: "foundation",
    scheduled_for: req.body.scheduled_for || application.ride_date || null,
    status: RIDE_STATUS.PAYMENT_AUTHORIZED,
    dispatch_status: "foundation_authorized",
    estimate_total: estimate.total,
    driver_payout: estimate.driver_payout,
    platform_fee: estimate.platform_fee,
    miles: estimate.miles,
    minutes: estimate.minutes,
    notes: `HTAF application ${application.application_code}`,
    created_at: nowIso(),
    updated_at: nowIso(),
  };
  const { data: createdRide, error: rideError } = await supabase.from("rides").insert(ride).select().single();
  if (rideError) throw rideError;
  await supabase.from("htaf_applications").update({ status: HTAF_STATUS.SCHEDULED, ride_id: createdRide.id, updated_at: nowIso() }).eq("id", applicationId);
  await auditLog({ actor_type: "admin", actor_id: req.admin.email, action: "htaf_application_converted_to_ride", entity_type: "htaf_application", entity_id: applicationId, metadata: { ride_id: createdRide.id }, req });
  broadcastSse("htaf_ride_created", { application_id: applicationId, ride: createdRide });
  return ok(res, { ride: createdRide, application_id: applicationId });
}));

app.get("/api/admin/drivers", requireAdmin, asyncRoute(async (req, res) => {
  const status = cleanString(req.query.status, 80);
  let query = supabase.from("drivers").select("*").order("created_at", { ascending: false }).limit(envNumber("ADMIN_LIST_LIMIT", 200));
  if (status) query = query.eq("status", status);
  const { data, error } = await query;
  if (error) throw error;
  return ok(res, { drivers: data || [] });
}));

app.get("/api/admin/riders", requireAdmin, asyncRoute(async (req, res) => {
  const status = cleanString(req.query.status, 80);
  let query = supabase.from("riders").select("*").order("created_at", { ascending: false }).limit(envNumber("ADMIN_LIST_LIMIT", 200));
  if (status) query = query.eq("status", status);
  const { data, error } = await query;
  if (error) throw error;
  return ok(res, { riders: data || [] });
}));

app.patch("/api/admin/riders/:id/approve", requireAdmin, asyncRoute(async (req, res) => {
  const riderId = cleanString(req.params.id, 100);
  const { data, error } = await supabase.from("riders").update({ status: "active", approval_status: "approved", approved_at: nowIso(), updated_at: nowIso() }).eq("id", riderId).select().single();
  if (error) throw error;
  await auditLog({ actor_type: "admin", actor_id: req.admin.email, action: "rider_approved", entity_type: "rider", entity_id: riderId, req });
  return ok(res, { rider: data });
}));

app.get("/api/admin/audit-logs", requireAdmin, asyncRoute(async (req, res) => {
  const { data, error } = await supabase.from("audit_logs").select("*").order("created_at", { ascending: false }).limit(envNumber("AUDIT_LOG_LIMIT", 300));
  if (error) throw error;
  return ok(res, { logs: data || [] });
}));

app.post("/api/admin/system/pause-dispatch", requireAdmin, asyncRoute(async (req, res) => {
  const reason = cleanString(req.body.reason, 1000);
  await supabase.from("system_flags").upsert({ key: "dispatch_paused", value: "true", reason, updated_at: nowIso() });
  await auditLog({ actor_type: "admin", actor_id: req.admin.email, action: "dispatch_paused", metadata: { reason }, req });
  broadcastSse("dispatch_paused", { reason, at: nowIso() });
  return ok(res, { dispatch_paused: true, reason });
}));

app.post("/api/admin/system/resume-dispatch", requireAdmin, asyncRoute(async (req, res) => {
  await supabase.from("system_flags").upsert({ key: "dispatch_paused", value: "false", reason: null, updated_at: nowIso() });
  await auditLog({ actor_type: "admin", actor_id: req.admin.email, action: "dispatch_resumed", req });
  broadcastSse("dispatch_resumed", { at: nowIso() });
  return ok(res, { dispatch_paused: false });
}));

/* =========================================================
   PART 9 OF 10 — COMPLIANCE + SAFETY
========================================================= */

const COMPLIANCE_STATUS = {
  PENDING: "pending",
  APPROVED: "approved",
  REJECTED: "rejected",
  REVIEW: "manual_review",
};

async function getDriverCompliance(driverId) {
  const { data } = await supabase.from("drivers").select("id, email_verified, phone_verified, checkr_status, persona_status, insurance_status, license_status").eq("id", driverId).single();
  if (!data) return { eligible: false };
  const eligible =
    data.email_verified === true &&
    data.phone_verified === true &&
    data.checkr_status === "clear" &&
    data.persona_status === "verified" &&
    data.insurance_status === "approved" &&
    data.license_status === "approved";
  return { eligible, details: data };
}

async function requireCompliantDriver(driverId) {
  const compliance = await getDriverCompliance(driverId);
  if (!compliance.eligible) throw new Error("Driver compliance requirements not met.");
  return compliance;
}

app.post("/api/webhooks/persona", express.raw({ type: "*/*" }), asyncRoute(async (req, res) => {
  const signature = req.headers["persona-signature"];
  if (PERSONA_WEBHOOK_SECRET && !signature) return fail(res, "Missing signature", 400);
  let payload;
  try { payload = JSON.parse(req.body.toString()); } catch { return fail(res, "Invalid payload", 400); }
  const inquiry = payload.data || {};
  const personaId = inquiry.attributes?.referenceId;
  const status = inquiry.attributes?.status;
  if (personaId) {
    await supabase.from("drivers").update({ persona_status: status === "approved" ? "verified" : "review", updated_at: nowIso() }).eq("persona_reference_id", personaId);
  }
  return ok(res, { received: true });
}));

app.post("/api/webhooks/checkr", express.json(), asyncRoute(async (req, res) => {
  const event = req.body || {};
  const candidateId = event.data?.object?.candidate_id;
  const status = event.data?.object?.status;
  if (candidateId) {
    await supabase.from("drivers").update({ checkr_status: status || "review", updated_at: nowIso() }).eq("checkr_candidate_id", candidateId);
  }
  return ok(res, { received: true });
}));

app.post("/api/safety/911", asyncRoute(async (req, res) => {
  const rideId = cleanString(req.body.ride_id, 100);
  const riderId = cleanString(req.body.rider_id, 100);
  const latitude = Number(req.body.latitude);
  const longitude = Number(req.body.longitude);
  const emergency = { id: makeId("SOS"), ride_id: rideId, rider_id: riderId, latitude, longitude, created_at: nowIso(), status: "active" };
  await supabase.from("emergency_alerts").insert(emergency);
  broadcastSse("emergency_alert", emergency);
  await auditLog({ actor_type: "rider", actor_id: riderId, action: "911_alert", metadata: emergency, req });
  return ok(res, { emergency_id: emergency.id, dispatched: true });
}));

app.post("/api/safety/report", asyncRoute(async (req, res) => {
  const report = {
    id: makeId("SAFE"),
    ride_id: cleanString(req.body.ride_id, 100),
    submitted_by: cleanString(req.body.user_id, 100),
    category: cleanString(req.body.category, 100),
    description: cleanString(req.body.description, 5000),
    created_at: nowIso(),
  };
  await supabase.from("safety_reports").insert(report);
  broadcastSse("safety_report", report);
  return ok(res, { report });
}));

async function updateDriverRisk(driverId) {
  const { data } = await supabase.from("driver_metrics").select("*").eq("driver_id", driverId).single();
  if (!data) return;
  let risk = 0;
  risk += Number(data.cancellations || 0) * 3;
  risk += Number(data.safety_reports || 0) * 10;
  risk += Number(data.customer_complaints || 0) * 5;
  let level = "low";
  if (risk >= 20) level = "medium";
  if (risk >= 50) level = "high";
  await supabase.from("drivers").update({ risk_score: risk, risk_level: level, updated_at: nowIso() }).eq("id", driverId);
  return { risk, level };
}

app.get("/api/admin/compliance/audit", requireAdmin, asyncRoute(async (req, res) => {
  const { data, error } = await supabase.from("drivers").select("id, first_name, last_name, email_verified, phone_verified, checkr_status, persona_status, insurance_status, license_status");
  if (error) throw error;
  return ok(res, { compliance: data || [] });
}));

/* =========================================================
   TWILIO VERIFY — SEND SMS CODE
   Requires TWILIO_VERIFY_SERVICE_SID env var in Render
========================================================= */

app.post("/api/auth/send-sms-code", asyncRoute(async (req, res) => {
  const phone = cleanString(req.body.phone, 50);
  if (!phone) return fail(res, "Phone required.", 400);

  if (!twilioClient) {
    return fail(res, "SMS verification is not configured.", 503);
  }
  if (!TWILIO_VERIFY_SERVICE_SID) {
    console.error("❌ TWILIO_VERIFY_SERVICE_SID is not set in environment variables.");
    return fail(res, "SMS verification service is not configured.", 503);
  }

  const verification = await twilioClient.verify
    .services(TWILIO_VERIFY_SERVICE_SID)
    .verifications.create({ to: phone, channel: "sms" });

  await auditLog({ action: "sms_verify_code_sent", metadata: { phone }, req });

  return ok(res, { sid: verification.sid });
}));

/* =========================================================
   TWILIO VERIFY — CONFIRM SMS CODE
========================================================= */

app.post("/api/auth/verify-sms-code", asyncRoute(async (req, res) => {
  const phone = cleanString(req.body.phone, 50);
  const code = cleanString(req.body.code, 20);

  if (!phone || !code) return fail(res, "Phone and code required.", 400);

  if (!twilioClient) {
    return fail(res, "SMS verification is not configured.", 503);
  }
  if (!TWILIO_VERIFY_SERVICE_SID) {
    console.error("❌ TWILIO_VERIFY_SERVICE_SID is not set in environment variables.");
    return fail(res, "SMS verification service is not configured.", 503);
  }

  const check = await twilioClient.verify
    .services(TWILIO_VERIFY_SERVICE_SID)
    .verificationChecks.create({ to: phone, code });

  const approved = check.status === "approved";

  if (approved) {
    await supabase.from("riders").update({ phone_verified: true, updated_at: nowIso() }).eq("phone", phone);
    await supabase.from("drivers").update({ phone_verified: true, updated_at: nowIso() }).eq("phone", phone);
  }

  await auditLog({ action: "sms_verify_code_checked", metadata: { phone, approved }, req });

  return ok(res, { approved });
}));


/* =========================================================
   PART 10 OF 10 — STRIPE, HEALTH, SYSTEM, BOOT
========================================================= */

app.post("/api/stripe/webhook", express.raw({ type: "application/json", limit: RAW_WEBHOOK_LIMIT }), asyncRoute(async (req, res) => {
  if (!stripe || !STRIPE_WEBHOOK_SECRET) return fail(res, "Stripe webhook not configured.", 503);
  const signature = req.headers["stripe-signature"];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, signature, STRIPE_WEBHOOK_SECRET);
  } catch (error) {
    console.error("Stripe signature failed:", error.message);
    return fail(res, "Invalid Stripe signature.", 400);
  }
  const object = event.data?.object || {};
  if (event.type === "payment_intent.succeeded") {
    await supabase.from("rides").update({ payment_status: "succeeded", payment_captured: true, updated_at: nowIso() }).eq("payment_intent_id", object.id);
    await supabase.from("deliveries").update({ payment_status: "succeeded", payment_captured: true, updated_at: nowIso() }).eq("payment_intent_id", object.id);
  }
  if (event.type === "payment_intent.amount_capturable_updated") {
    await supabase.from("rides").update({ payment_status: "authorized", status: RIDE_STATUS.PAYMENT_AUTHORIZED, updated_at: nowIso() }).eq("payment_intent_id", object.id);
    await supabase.from("deliveries").update({ payment_status: "authorized", updated_at: nowIso() }).eq("payment_intent_id", object.id);
  }
  if (event.type === "payment_intent.payment_failed" || event.type === "payment_intent.canceled") {
    await supabase.from("rides").update({ payment_status: "failed", status: RIDE_STATUS.FAILED, updated_at: nowIso() }).eq("payment_intent_id", object.id);
    await supabase.from("deliveries").update({ payment_status: "failed", updated_at: nowIso() }).eq("payment_intent_id", object.id);
  }
  await auditLog({ action: "stripe_webhook_received", entity_type: "stripe", entity_id: object.id || event.id, metadata: { event_type: event.type } });
  broadcastSse("stripe_event", { type: event.type, object_id: object.id, at: nowIso() });
  return ok(res, { received: true });
}));

app.get("/health", asyncRoute(async (req, res) => {
  return ok(res, { service: "harvey-taxi-server-j", status: "healthy", environment: NODE_ENV, time: nowIso() });
}));

app.get("/api/health", asyncRoute(async (req, res) => {
  let database = "unknown";
  try {
    const { error } = await supabase.from("system_flags").select("key").limit(1);
    database = error ? "error" : "connected";
  } catch { database = "error"; }
  return ok(res, {
    service: "harvey-taxi-server-j",
    status: "healthy",
    database,
    integrations: {
      supabase: Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY),
      stripe: Boolean(stripe),
      sendgrid: Boolean(sgMail && SENDGRID_API_KEY),
      twilio: Boolean(twilioClient),
      persona: Boolean(PERSONA_API_KEY),
      checkr: Boolean(CHECKR_API_KEY),
      openai: Boolean(openai),
      google_maps: Boolean(GOOGLE_MAPS_API_KEY),
    },
    features: {
      rider_approval_gate: ENABLE_RIDER_APPROVAL_GATE,
      payment_gate: ENABLE_PAYMENT_GATE,
      auto_redispatch: ENABLE_AUTO_REDISPATCH,
      delivery: ENABLE_DELIVERY,
      food_delivery: ENABLE_FOOD_DELIVERY,
      grocery_delivery: ENABLE_GROCERY_DELIVERY,
      htaf_applications: ENABLE_HTAF_APPLICATIONS,
    },
    time: nowIso(),
  });
}));

async function getSystemFlag(key, fallback = "false") {
  try {
    const { data } = await supabase.from("system_flags").select("*").eq("key", key).maybeSingle();
    return data?.value ?? fallback;
  } catch { return fallback; }
}

app.get("/api/system/status", asyncRoute(async (req, res) => {
  const dispatchPaused = await getSystemFlag("dispatch_paused", "false");
  return ok(res, { dispatch_paused: dispatchPaused === "true", server_time: nowIso(), app_base_url: APP_BASE_URL });
}));

app.get("/api/admin/config-check", requireAdmin, asyncRoute(async (req, res) => {
  return ok(res, {
    environment: NODE_ENV,
    required: { SUPABASE_URL: Boolean(SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY: Boolean(SUPABASE_SERVICE_ROLE_KEY) },
    integrations: {
      SENDGRID_API_KEY: Boolean(SENDGRID_API_KEY),
      TWILIO_ACCOUNT_SID: Boolean(TWILIO_ACCOUNT_SID),
      TWILIO_FROM_NUMBER: Boolean(TWILIO_FROM_NUMBER),
      STRIPE_SECRET_KEY: Boolean(STRIPE_SECRET_KEY),
      STRIPE_WEBHOOK_SECRET: Boolean(STRIPE_WEBHOOK_SECRET),
      PERSONA_API_KEY: Boolean(PERSONA_API_KEY),
      PERSONA_WEBHOOK_SECRET: Boolean(PERSONA_WEBHOOK_SECRET),
      CHECKR_API_KEY: Boolean(CHECKR_API_KEY),
      CHECKR_WEBHOOK_SECRET: Boolean(CHECKR_WEBHOOK_SECRET),
      OPENAI_API_KEY: Boolean(OPENAI_API_KEY),
      GOOGLE_MAPS_API_KEY: Boolean(GOOGLE_MAPS_API_KEY),
    },
    toggles: { ENABLE_REAL_EMAIL, ENABLE_REAL_SMS, ENABLE_PERSONA, ENABLE_CHECKR, ENABLE_AI_SUPPORT, ENABLE_PAYMENT_GATE, ENABLE_RIDER_APPROVAL_GATE, ENABLE_AUTO_REDISPATCH, ENABLE_DELIVERY, ENABLE_FOOD_DELIVERY, ENABLE_GROCERY_DELIVERY, ENABLE_HTAF_APPLICATIONS },
  });
}));

app.post("/api/ai/support", rateLimit({ windowMs: 60_000, max: 20, keyPrefix: "ai_support" }), asyncRoute(async (req, res) => {
  const message = cleanString(req.body.message, 4000);
  const page = cleanString(req.body.page, 120);
  if (!message) return fail(res, "Message required.", 400);
  if (!openai) return ok(res, { reply: "Harvey AI Support is currently limited. Please contact support for help.", fallback: true });
  const completion = await openai.chat.completions.create({
    model: OPENAI_MODEL,
    messages: [
      { role: "system", content: "You are Harvey Taxi and Harvey Transportation Assistance Foundation support. Help riders, drivers, applicants, and donors with clear, safe, concise guidance. Do not promise guaranteed assistance, approval, payment, or emergency response." },
      { role: "user", content: `Page: ${page}\n\nUser message: ${message}` },
    ],
    temperature: 0.3,
  });
  const reply = completion.choices?.[0]?.message?.content || "I'm here to help. Please try again.";
  await auditLog({ action: "ai_support_message", metadata: { page, length: message.length }, req });
  return ok(res, { reply });
}));

/* =========================================================
   STATIC PAGE ROUTES
========================================================= */

app.get("/", (req, res) => res.sendFile(path.join(PUBLIC_DIR, "index.html")));
app.get("/foundation", (req, res) => res.sendFile(path.join(PUBLIC_DIR, "foundation.html")));
app.get("/htaf-application", (req, res) => res.sendFile(path.join(PUBLIC_DIR, "htaf-application.html")));
app.get("/request-ride", (req, res) => res.sendFile(path.join(PUBLIC_DIR, "request-ride.html")));
app.get("/support", (req, res) => res.sendFile(path.join(PUBLIC_DIR, "support.html")));

/* =========================================================
   404 + ERROR HANDLERS
========================================================= */

app.use("/api", (req, res) => {
  return fail(res, `API route not found: ${req.method} ${req.originalUrl}`, 404);
});

app.use((req, res) => {
  res.status(404).sendFile(path.join(PUBLIC_DIR, "index.html"));
});

app.use((error, req, res, next) => {
  console.error("SERVER ERROR:", {
    message: error.message,
    stack: IS_PRODUCTION ? undefined : error.stack,
    path: req.originalUrl,
  });
  auditLog({
    action: "server_error",
    entity_type: "server",
    metadata: { message: error.message, path: req.originalUrl, method: req.method },
    req,
  }).catch(() => {});
  return fail(res, IS_PRODUCTION ? "Internal server error." : error.message, 500);
});

/* =========================================================
   PROCESS SAFETY
========================================================= */

process.on("unhandledRejection", (reason) => console.error("UNHANDLED REJECTION:", reason));
process.on("uncaughtException", (error) => console.error("UNCAUGHT EXCEPTION:", error));

/* =========================================================
   START SERVER
========================================================= */

server.listen(PORT, "0.0.0.0", () => {
  console.log("=================================================");
  console.log("🚕 HARVEY TAXI SERVER J ONLINE");
  console.log(`🌎 Environment: ${NODE_ENV}`);
  console.log(`🔌 Port: ${PORT}`);
  console.log(`🏠 App URL: ${APP_BASE_URL}`);
  console.log(`🧾 HTAF Applications: ${ENABLE_HTAF_APPLICATIONS ? "ON" : "OFF"}`);
  console.log(`💳 Stripe: ${stripe ? "ON" : "OFF"}`);
  console.log(`📧 SendGrid: ${sgMail && SENDGRID_API_KEY ? "ON" : "OFF"}`);
  console.log(`📲 Twilio: ${twilioClient ? "ON" : "OFF"}`);
  console.log(`🪪 Persona: ${PERSONA_API_KEY ? "ON" : "OFF"}`);
  console.log(`🛡️ Checkr: ${CHECKR_API_KEY ? "ON" : "OFF"}`);
  console.log(`🤖 AI Support: ${openai ? "ON" : "OFF"}`);
  console.log("=================================================");
});

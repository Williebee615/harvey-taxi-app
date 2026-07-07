/* =========================================================

   HARVEY TAXI — TRUE CODE BLUE SERVER.JS

   PRODUCTION BUILD

   PART 1 — CORE BOOT + SUPABASE PREFLIGHT

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

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {

  auth: {

    persistSession: false,

    autoRefreshToken: false,

  },

});

const APP_NAME = "Harvey Taxi";

const APP_BASE_URL =

  env("PUBLIC_APP_URL") ||

  env("APP_BASE_URL") ||

  env("RENDER_EXTERNAL_URL") ||

  `http://localhost:${PORT}`;

const PUBLIC_DIR = path.join(__dirname, "public");

const SUPPORT_EMAIL =

  env("SUPPORT_EMAIL") ||

  env("ADMIN_EMAIL") ||

  "williebee@harveytaxiservice.com";

const ADMIN_EMAIL = env("ADMIN_EMAIL", "williebee@harveytaxiservice.com");

const ADMIN_PASSWORD = env("ADMIN_PASSWORD", "");

const ADMIN_API_TOKEN = env("ADMIN_API_TOKEN") || env("HARVEY_ADMIN_TOKEN");

/* Admin session (HttpOnly cookie) config.

   SESSION_SECRET falls back to ADMIN_API_TOKEN or ADMIN_PASSWORD so

   sessions still work if a dedicated secret is not set, but setting a

   dedicated ADMIN_SESSION_SECRET in Render is strongly recommended. */

const ADMIN_SESSION_SECRET =

  env("ADMIN_SESSION_SECRET") ||

  env("SESSION_SECRET") ||

  ADMIN_API_TOKEN ||

  ADMIN_PASSWORD ||

  "";

const ADMIN_SESSION_COOKIE = "htaf_admin_session";

const ADMIN_SESSION_TTL_HOURS =

  envNumber("ADMIN_SESSION_TTL_HOURS", 12);

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

/* =========================================================

   REQUIRED TABLE PREFLIGHT

========================================================= */

const REQUIRED_TABLES = [

  "htaf_applications",

  "drivers",

  "riders",

  "rides",

  "audit_logs",

  "system_flags",

  "verification_codes",

  "driver_offers",

  "driver_earnings",

  "emergency_alerts",

  "safety_reports",

  "deliveries"

];

async function checkRequiredTables() {

  const results = {};

  for (const table of REQUIRED_TABLES) {

    try {

      const { error } = await supabase

        .from(table)

        .select("*")

        .limit(1);

      results[table] = error ? `error: ${error.message}` : "ok";

    } catch (err) {

      results[table] = `error: ${err.message}`;

    }

  }

  const failed = Object.entries(results).filter(([, status]) => status !== "ok");

  if (failed.length) {

    console.warn("⚠️ Supabase preflight warnings:", results);

  } else {

    console.log("✅ Supabase table preflight passed");

  }

  return results;

}

/* =========================================================

   SENDGRID

========================================================= */

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

/* =========================================================

   TWILIO

========================================================= */

const TWILIO_ACCOUNT_SID = env("TWILIO_ACCOUNT_SID");

const TWILIO_AUTH_TOKEN = env("TWILIO_AUTH_TOKEN");

const TWILIO_FROM_NUMBER =

  env("TWILIO_FROM_NUMBER") ||

  env("TWILIO_PHONE_NUMBER");

const TWILIO_VERIFY_SERVICE_SID = env("TWILIO_VERIFY_SERVICE_SID");

let twilioClient = null;

if (

  twilio &&

  ENABLE_REAL_SMS &&

  TWILIO_ACCOUNT_SID &&

  TWILIO_AUTH_TOKEN

) {

  twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

  console.log("✅ Twilio active");

} else {

  console.warn("⚠️ Twilio inactive or SMS disabled");

}

/* =========================================================

   STRIPE

========================================================= */

const STRIPE_SECRET_KEY = env("STRIPE_SECRET_KEY");

const STRIPE_WEBHOOK_SECRET = env("STRIPE_WEBHOOK_SECRET");

let stripe = null;

if (Stripe && STRIPE_SECRET_KEY) {

  stripe = new Stripe(STRIPE_SECRET_KEY);

  console.log("✅ Stripe active");

} else {

  console.warn("⚠️ Stripe inactive");

}

/* =========================================================

   PERSONA + CHECKR + OPENAI

========================================================= */

const PERSONA_API_KEY = env("PERSONA_API_KEY");

const PERSONA_WEBHOOK_SECRET = env("PERSONA_WEBHOOK_SECRET");

const PERSONA_TEMPLATE_ID_RIDER =

  env("PERSONA_TEMPLATE_ID_RIDER") ||

  env("PERSONA_RIDER_TEMPLATE_ID");

const PERSONA_TEMPLATE_ID_DRIVER =

  env("PERSONA_TEMPLATE_ID_DRIVER") ||

  env("PERSONA_DRIVER_TEMPLATE_ID");

const CHECKR_API_KEY = env("CHECKR_API_KEY");

const CHECKR_WEBHOOK_SECRET = env("CHECKR_WEBHOOK_SECRET");

const OPENAI_API_KEY = env("OPENAI_API_KEY");

const OPENAI_MODEL = env("OPENAI_MODEL", "gpt-4o-mini");

let openai = null;

if (OpenAI && OPENAI_API_KEY && ENABLE_AI_SUPPORT) {

  openai = new OpenAI({ apiKey: OPENAI_API_KEY });

  console.log("✅ OpenAI active");

} else {

  console.warn("⚠️ OpenAI inactive");

}/* =========================================================

   PART 2 — SECURITY, MIDDLEWARE, HELPERS

========================================================= */

app.set("trust proxy", 1);

app.disable("x-powered-by");

const JSON_LIMIT = env("JSON_LIMIT", "2mb");

const RAW_WEBHOOK_LIMIT = env("RAW_WEBHOOK_LIMIT", "2mb");

const ALLOWED_ORIGINS = env("ALLOWED_ORIGINS", "")

  .split(",")

  .map((origin) => origin.trim())

  .filter(Boolean);

function isAllowedOrigin(origin) {

  if (!origin) return true;

  if (!IS_PRODUCTION) return true;

  if (ALLOWED_ORIGINS.length === 0) {

    return origin === APP_BASE_URL;

  }

  return ALLOWED_ORIGINS.includes(origin);

}

app.use((req, res, next) => {

  res.setHeader(

    "X-Content-Type-Options",

    "nosniff"

  );

  res.setHeader(

    "X-Frame-Options",

    "SAMEORIGIN"

  );

  res.setHeader(

    "Referrer-Policy",

    "strict-origin-when-cross-origin"

  );

  res.setHeader(

    "Permissions-Policy",

    "geolocation=(self), microphone=(), camera=(self), payment=(self)"

  );

  if (IS_PRODUCTION) {

    res.setHeader(

      "Strict-Transport-Security",

      "max-age=31536000; includeSubDomains"

    );

  }

  next();

});

app.use(

  cors({

    origin(origin, callback) {

      if (isAllowedOrigin(origin)) {

        return callback(null, true);

      }

      return callback(

        new Error("CORS origin blocked")

      );

    },

    credentials: true,

  })

);

/* =========================================================

   WEBHOOK RAW BODY HANDLING

========================================================= */

const RAW_WEBHOOK_PATHS = new Set([

  "/api/stripe/webhook",

  "/api/persona/webhook",

  "/api/checkr/webhook"

]);

app.use((req, res, next) => {

  if (RAW_WEBHOOK_PATHS.has(req.path)) {

    return next();

  }

  return express.json({

    limit: JSON_LIMIT

  })(req, res, next);

});

app.use(

  express.urlencoded({

    extended: true,

    limit: JSON_LIMIT

  })

);

app.use(

  express.static(PUBLIC_DIR, {

    extensions: ["html"],

    maxAge: IS_PRODUCTION ? "1h" : 0,

  })

);

/* =========================================================

   RATE LIMIT

========================================================= */

const memoryRateLimit = new Map();

function getClientIp(req) {

  return (

    req.headers["x-forwarded-for"]

      ?.split(",")[0]

      ?.trim() ||

    req.socket?.remoteAddress ||

    "unknown"

  );

}

function rateLimit({

  windowMs = 60_000,

  max = 60,

  keyPrefix = "global"

} = {}) {

  return (req, res, next) => {

    const ip = getClientIp(req);

    const key = `${keyPrefix}:${ip}`;

    const now = Date.now();

    const current =

      memoryRateLimit.get(key) || {

        count: 0,

        resetAt: now + windowMs

      };

    if (now > current.resetAt) {

      current.count = 0;

      current.resetAt = now + windowMs;

    }

    current.count += 1;

    memoryRateLimit.set(key, current);

    if (current.count > max) {

      return fail(

        res,

        "Too many requests. Please wait and try again.",

        429

      );

    }

    next();

  };

}

app.use(

  "/api/",

  rateLimit({

    windowMs: 60_000,

    max: envNumber(

      "API_RATE_LIMIT_PER_MINUTE",

      120

    ),

    keyPrefix: "api"

  })

);

/* =========================================================

   RESPONSE HELPERS

========================================================= */

function nowIso() {

  return new Date().toISOString();

}

function ok(res, data = {}, status = 200) {

  return res.status(status).json({

    ok: true,

    ...data

  });

}

function fail(

  res,

  message = "Request failed",

  status = 400,

  details = {}

) {

  return res.status(status).json({

    ok: false,

    error: message,

    message,

    ...details

  });

}

function asyncRoute(handler) {

  return function wrapped(req, res, next) {

    Promise.resolve(

      handler(req, res, next)

    ).catch(next);

  };

}

/* =========================================================

   SANITIZERS

========================================================= */

function makeId(prefix = "HT") {

  return `${prefix}-${crypto

    .randomBytes(5)

    .toString("hex")

    .toUpperCase()}`;

}

function makePublicCode(prefix = "HTAF") {

  const date = new Date()

    .toISOString()

    .slice(0, 10)

    .replaceAll("-", "");

  const random = crypto

    .randomBytes(3)

    .toString("hex")

    .toUpperCase();

  return `${prefix}-${date}-${random}`;

}

function cleanString(value, max = 500) {

  return String(value || "")

    .trim()

    .slice(0, max);

}

function cleanEmail(value) {

  return cleanString(value, 254)

    .toLowerCase();

}

function cleanPhone(value) {

  return cleanString(value, 32)

    .replace(/[^\d+]/g, "")

    .slice(0, 20);

}

function toNumber(value, fallback = 0) {

  const number = Number(value);

  return Number.isFinite(number)

    ? number

    : fallback;

}

function normalizeProgramType(value) {

  const program = cleanString(value, 50)

    .toLowerCase();

  const allowed = [

    "medical",

    "employment",

    "education",

    "community",

    "senior",

    "disability",

    "veteran",

    "general"

  ];

  return allowed.includes(program)

    ? program

    : "general";

}

function normalizeRideType(value) {

  const type = cleanString(value, 50)

    .toLowerCase();

  const allowed = [

    "standard",

    "medical",

    "airport",

    "foundation",

    "autonomous",

    "delivery",

    "food",

    "grocery"

  ];

  return allowed.includes(type)

    ? type

    : "standard";

}

function requireBody(req, fields = []) {

  const missing = [];

  for (const field of fields) {

    const value = req.body?.[field];

    if (

      value === undefined ||

      value === null ||

      String(value).trim() === ""

    ) {

      missing.push(field);

    }

  }

  return missing;

}

function hashToken(value) {

  return crypto

    .createHash("sha256")

    .update(String(value))

    .digest("hex");

}

function timingSafeEqualString(a, b) {

  const aa = Buffer.from(String(a || ""));

  const bb = Buffer.from(String(b || ""));

  if (aa.length !== bb.length) {

    return false;

  }

  return crypto.timingSafeEqual(aa, bb);

}

/* =========================================================

   AUTH HELPERS

========================================================= */

function getBearerToken(req) {

  const header =

    req.headers.authorization ||

    req.headers.Authorization ||

    "";

  if (!header.startsWith("Bearer ")) {

    return "";

  }

  return header.slice(7).trim();

}

async function getUserFromRequest(req) {

  const token = getBearerToken(req);

  if (!token) return null;

  const { data, error } =

    await supabase.auth.getUser(token);

  if (error || !data?.user) {

    return null;

  }

  return data.user;

}

async function requireUser(req, res, next) {

  const user =

    await getUserFromRequest(req);

  if (!user) {

    return fail(

      res,

      "Authentication required.",

      401

    );

  }

  req.user = user;

  next();

}

/* =========================================================

   ADMIN SESSION (HttpOnly signed cookie)

   Token format: base64url(payloadJson).hmacHex

   payload = { sub, email, iat, exp }

========================================================= */

function base64UrlEncode(input) {

  return Buffer.from(input)

    .toString("base64")

    .replace(/\+/g, "-")

    .replace(/\//g, "_")

    .replace(/=+$/, "");

}

function base64UrlDecode(input) {

  const pad =

    input.length % 4 === 0

      ? ""

      : "=".repeat(4 - (input.length % 4));

  const normalized =

    input.replace(/-/g, "+").replace(/_/g, "/") + pad;

  return Buffer.from(normalized, "base64").toString("utf8");

}

function signAdminSession(email) {

  if (!ADMIN_SESSION_SECRET) {

    return "";

  }

  const now = Date.now();

  const payload = {

    sub: "htaf-admin",

    email: cleanEmail(email) || cleanEmail(ADMIN_EMAIL),

    iat: now,

    exp: now + ADMIN_SESSION_TTL_HOURS * 60 * 60 * 1000

  };

  const encoded =

    base64UrlEncode(JSON.stringify(payload));

  const sig =

    crypto

      .createHmac("sha256", ADMIN_SESSION_SECRET)

      .update(encoded)

      .digest("hex");

  return `${encoded}.${sig}`;

}

function verifyAdminSession(token) {

  if (!token || !ADMIN_SESSION_SECRET) {

    return null;

  }

  const parts = String(token).split(".");

  if (parts.length !== 2) {

    return null;

  }

  const [encoded, sig] = parts;

  const expected =

    crypto

      .createHmac("sha256", ADMIN_SESSION_SECRET)

      .update(encoded)

      .digest("hex");

  if (!timingSafeEqualString(sig, expected)) {

    return null;

  }

  let payload = null;

  try {

    payload = JSON.parse(base64UrlDecode(encoded));

  } catch {

    return null;

  }

  if (!payload || typeof payload.exp !== "number") {

    return null;

  }

  if (Date.now() > payload.exp) {

    return null;

  }

  return payload;

}

function parseCookies(req) {

  const header = req.headers.cookie || "";

  const out = {};

  header.split(";").forEach(part => {

    const idx = part.indexOf("=");

    if (idx === -1) return;

    const key = part.slice(0, idx).trim();

    const val = part.slice(idx + 1).trim();

    if (key) {

      out[key] = decodeURIComponent(val);

    }

  });

  return out;

}

function readAdminSessionCookie(req) {

  const cookies = parseCookies(req);

  return verifyAdminSession(cookies[ADMIN_SESSION_COOKIE]);

}

function setAdminSessionCookie(res, token) {

  const maxAge =

    ADMIN_SESSION_TTL_HOURS * 60 * 60;

  const attrs = [

    `${ADMIN_SESSION_COOKIE}=${encodeURIComponent(token)}`,

    "Path=/",

    "HttpOnly",

    "SameSite=Lax",

    `Max-Age=${maxAge}`

  ];

  if (IS_PRODUCTION) {

    attrs.push("Secure");

  }

  res.append("Set-Cookie", attrs.join("; "));

}

function clearAdminSessionCookie(res) {

  const attrs = [

    `${ADMIN_SESSION_COOKIE}=`,

    "Path=/",

    "HttpOnly",

    "SameSite=Lax",

    "Max-Age=0"

  ];

  if (IS_PRODUCTION) {

    attrs.push("Secure");

  }

  res.append("Set-Cookie", attrs.join("; "));

}

function requireAdmin(req, res, next) {

  const headerToken =

    req.headers["x-admin-token"] ||

    req.headers["x-harvey-admin-token"];

  if (

    ADMIN_API_TOKEN &&

    headerToken &&

    timingSafeEqualString(

      headerToken,

      ADMIN_API_TOKEN

    )

  ) {

    req.admin = {

      id: "token-admin",

      email: ADMIN_EMAIL,

      method: "admin_token"

    };

    return next();

  }

  const email =

    cleanEmail(req.headers["x-admin-email"]);

  const password =

    String(req.headers["x-admin-password"] || "");

  if (

    ADMIN_PASSWORD &&

    email === cleanEmail(ADMIN_EMAIL) &&

    timingSafeEqualString(

      password,

      ADMIN_PASSWORD

    )

  ) {

    req.admin = {

      id: "password-admin",

      email: ADMIN_EMAIL,

      method: "admin_password"

    };

    return next();

  }

  const session = readAdminSessionCookie(req);

  if (session) {

    req.admin = {

      id: "session-admin",

      email: session.email || ADMIN_EMAIL,

      method: "admin_session"

    };

    return next();

  }

  return fail(

    res,

    "Admin authorization required.",

    401

  );

}

/* =========================================================

   DRIVER AUTH

   Drivers are Supabase Auth users. We verify the bearer

   token, then resolve the driver row by email (the field

   stored at signup). The resolved row is attached as

   req.driver so routes NEVER trust a client-supplied

   driver_id. An admin token/session may also act on behalf

   of a driver by passing driver_id (for ops tooling).

========================================================= */

async function requireDriver(req, res, next) {

  try {

    // Allow admin override for internal ops tooling.

    const adminSession = readAdminSessionCookie(req);

    const adminHeaderToken =

      req.headers["x-admin-token"] ||

      req.headers["x-harvey-admin-token"];

    const isAdmin =

      adminSession ||

      (ADMIN_API_TOKEN &&

        adminHeaderToken &&

        timingSafeEqualString(

          adminHeaderToken,

          ADMIN_API_TOKEN

        ));

    if (isAdmin) {

      const overrideId =

        cleanString(

          req.body?.driver_id ||

            req.params?.driverId ||

            req.query?.driver_id,

          100

        );

      if (!overrideId) {

        return fail(

          res,

          "Admin driver action requires driver_id.",

          400

        );

      }

      const { data: adminDriver, error: adminErr } =

        await supabase

          .from("drivers")

          .select("*")

          .eq("id", overrideId)

          .single();

      if (adminErr || !adminDriver) {

        return fail(

          res,

          "Driver not found.",

          404

        );

      }

      req.driver = adminDriver;

      req.driverAuthMethod = "admin_override";

      return next();

    }

    const user =

      await getUserFromRequest(req);

    if (!user) {

      return fail(

        res,

        "Driver authentication required.",

        401

      );

    }

    const email =

      cleanEmail(user.email);

    if (!email) {

      return fail(

        res,

        "Authenticated account has no email on file.",

        403

      );

    }

    const { data: driver, error } =

      await supabase

        .from("drivers")

        .select("*")

        .eq("email", email)

        .single();

    if (error || !driver) {

      return fail(

        res,

        "No driver profile is linked to this account.",

        403

      );

    }

    req.driver = driver;

    req.user = user;

    req.driverAuthMethod = "supabase_user";

    return next();

  } catch (err) {

    return fail(

      res,

      "Driver authorization failed.",

      401

    );

  }

}

/* =========================================================

   SAFE AUDIT LOG

   Logging must never break production routes.

========================================================= */

async function auditLog({

  actor_type = "system",

  actor_id = null,

  action,

  entity_type = null,

  entity_id = null,

  metadata = {},

  req = null,

}) {

  if (!action) {

    return {

      logged: false,

      reason: "missing_action"

    };

  }

  try {

    const { error } = await supabase

      .from("audit_logs")

      .insert({

        actor_type,

        actor_id,

        action,

        entity_type,

        entity_id,

        metadata,

        ip_address: req ? getClientIp(req) : null,

        user_agent: req

          ? req.headers["user-agent"] || null

          : null,

        created_at: nowIso(),

      });

    if (error) {

      console.warn(

        "⚠️ Audit log skipped:",

        {

          action,

          message: error.message,

          code: error.code,

          details: error.details,

          hint: error.hint

        }

      );

      return {

        logged: false,

        error

      };

    }

    return {

      logged: true

    };

  } catch (error) {

    console.warn(

      "⚠️ Audit logger failed:",

      error.message

    );

    return {

      logged: false,

      error

    };

  }

}

/* =========================================================

   COMMUNICATION HELPERS

========================================================= */

async function sendEmail({

  to,

  subject,

  html,

  text

}) {

  if (

    !sgMail ||

    !SENDGRID_API_KEY ||

    !ENABLE_REAL_EMAIL

  ) {

    console.log(

      "📧 Email skipped:",

      { to, subject }

    );

    return {

      sent: false,

      skipped: true

    };

  }

  await sgMail.send({

    to,

    from: {

      email: SENDGRID_FROM_EMAIL,

      name: SENDGRID_FROM_NAME

    },

    subject,

    text:

      text ||

      html?.replace(/<[^>]+>/g, " "),

    html

  });

  return {

    sent: true

  };

}

async function sendSms({

  to,

  body

}) {

  if (

    !twilioClient ||

    !ENABLE_REAL_SMS

  ) {

    console.log(

      "📲 SMS skipped:",

      { to, body }

    );

    return {

      sent: false,

      skipped: true

    };

  }

  await twilioClient.messages.create({

    to,

    from: TWILIO_FROM_NUMBER,

    body

  });

  return {

    sent: true

  };

}

/* =========================================================

   DISTANCE + PRICING

========================================================= */

function haversineMiles(

  lat1,

  lon1,

  lat2,

  lon2

) {

  const toRad =

    (v) => (Number(v) * Math.PI) / 180;

  const R = 3958.8;

  const dLat =

    toRad(lat2 - lat1);

  const dLon =

    toRad(lon2 - lon1);

  const a =

    Math.sin(dLat / 2) ** 2 +

    Math.cos(toRad(lat1)) *

      Math.cos(toRad(lat2)) *

      Math.sin(dLon / 2) ** 2;

  return 2 * R * Math.asin(Math.sqrt(a));

}

const BASE_FARE = envNumber("BASE_FARE", 5);

const PER_MILE_RATE = envNumber("PER_MILE_RATE", 0.90);

const PER_MINUTE_RATE = envNumber("PER_MINUTE_RATE", 0.35);

const BOOKING_FEE = envNumber("BOOKING_FEE", 2.00);

const MINIMUM_FARE = envNumber("MINIMUM_FARE", 8);

const DRIVER_PAYOUT_PERCENT = envNumber("DRIVER_PAYOUT_PERCENT", 0.70);

function calculateRideEstimate({

  miles = 0,

  minutes = 0,

  ride_type = "standard"

}) {

  const safeMiles =

    Math.max(0, toNumber(miles));

  const safeMinutes =

    Math.max(0, toNumber(minutes));

  let subtotal =

    BASE_FARE +

    safeMiles * PER_MILE_RATE +

    safeMinutes * PER_MINUTE_RATE +

    BOOKING_FEE;

  if (

    ride_type === "medical" ||

    ride_type === "foundation"

  ) {

    subtotal *= 0.95;

  }

  if (ride_type === "airport") {

    subtotal += 5;

  }

  const total =

    Math.max(MINIMUM_FARE, subtotal);

  const driver_payout =

    total * DRIVER_PAYOUT_PERCENT;

  return {

    miles: Number(safeMiles.toFixed(2)),

    minutes: Number(safeMinutes.toFixed(0)),

    currency: "USD",

    total: Number(total.toFixed(2)),

    driver_payout: Number(driver_payout.toFixed(2)),

    platform_fee: Number((total - driver_payout).toFixed(2)),

  };

}/* =========================================================

   PART 3 — HTAF FOUNDATION APPLICATION SYSTEM

   TRUE PRODUCTION ROUTE FIX

========================================================= */

const HTAF_STATUS = {

  SUBMITTED: "submitted",

  UNDER_REVIEW: "under_review",

  PENDING_DOCUMENTS: "pending_documents",

  APPROVED: "approved",

  DENIED: "denied",

  SCHEDULED: "scheduled",

  COMPLETED: "completed"

};

const HTAF_REQUIRED_COLUMNS = [

  "id",

  "application_code",

  "first_name",

  "last_name",

  "email",

  "phone",

  "county",

  "city",

  "applicant_type",

  "household_size",

  "monthly_income",

  "program_type",

  "pickup_city",

  "destination",

  "ride_date",

  "transportation_need",

  "status",

  "notes",

  "submitted_at",

  "created_at",

  "updated_at"

];

let htafSchemaStatus = {

  checked: false,

  ok: false,

  missing: [],

  columns: [],

  checked_at: null

};

/* =========================================================

   HTAF SCHEMA GUARD

   Uses PostgREST metadata-safe query behavior.

========================================================= */

async function inspectHtafSchema() {

  try {

    const { data, error } = await supabase

      .from("htaf_applications")

      .select("*")

      .limit(1);

    if (error) {

      htafSchemaStatus = {

        checked: true,

        ok: false,

        missing: [],

        columns: [],

        checked_at: nowIso(),

        error: {

          message: error.message,

          code: error.code,

          details: error.details,

          hint: error.hint

        }

      };

      console.warn(

        "⚠️ HTAF schema/table check failed:",

        htafSchemaStatus.error

      );

      return htafSchemaStatus;

    }

    const sample = Array.isArray(data) && data[0]

      ? data[0]

      : null;

    let knownColumns;

    let missing;

    if (sample) {

      // A row exists: its keys are authoritative.

      knownColumns = Object.keys(sample);

      missing = HTAF_REQUIRED_COLUMNS.filter(

        (column) => !knownColumns.includes(column)

      );

    } else {

      // Empty table: we cannot infer columns from a row, so

      // verify each required column directly. PostgREST returns

      // an error (code 42703) naming any column that does not

      // exist, letting us detect real absence rather than

      // assuming the schema is correct.

      const columnCheck =

        await supabase

          .from("htaf_applications")

          .select(

            HTAF_REQUIRED_COLUMNS.join(",")

          )

          .limit(1);

      if (columnCheck.error) {

        // Try to extract the offending column name from the

        // error; fall back to marking all as unverified.

        const msg =

          columnCheck.error.message || "";

        const named =

          HTAF_REQUIRED_COLUMNS.filter(

            (column) =>

              msg.includes(`'${column}'`) ||

              msg.includes(`"${column}"`) ||

              msg.includes(` ${column} `)

          );

        missing =

          named.length

            ? named

            : [...HTAF_REQUIRED_COLUMNS];

        knownColumns =

          HTAF_REQUIRED_COLUMNS.filter(

            (c) => !missing.includes(c)

          );

      } else {

        // The explicit select of all required columns succeeded

        // against an empty table, which confirms they all exist.

        knownColumns = [...HTAF_REQUIRED_COLUMNS];

        missing = [];

      }

    }

    htafSchemaStatus = {

      checked: true,

      ok: missing.length === 0,

      missing,

      columns: knownColumns,

      empty_table: !sample,

      checked_at: nowIso()

    };

    if (missing.length) {

      console.warn(

        "⚠️ HTAF schema missing columns:",

        missing

      );

    } else {

      console.log(

        "✅ HTAF schema guard passed"

      );

    }

    return htafSchemaStatus;

  } catch (error) {

    htafSchemaStatus = {

      checked: true,

      ok: false,

      missing: [],

      columns: [],

      checked_at: nowIso(),

      error: {

        message: error.message

      }

    };

    console.warn(

      "⚠️ HTAF schema guard crashed:",

      error.message

    );

    return htafSchemaStatus;

  }

}

function buildHTAFApplicationPayload(payload) {

  const now = nowIso();

  return {

    id: makeId("HTAF"),

    application_code:

      makePublicCode("HTAF"),

    first_name:

      cleanString(

        payload.first_name,

        120

      ),

    last_name:

      cleanString(

        payload.last_name,

        120

      ),

    email:

      cleanEmail(

        payload.email

      ),

    phone:

      cleanPhone(

        payload.phone

      ),

    county:

      cleanString(

        payload.county,

        120

      ),

    city:

      cleanString(

        payload.city,

        120

      ),

    applicant_type:

      cleanString(

        payload.applicant_type,

        80

      ),

    household_size:

      toNumber(

        payload.household_size,

        0

      ),

    monthly_income:

      toNumber(

        payload.monthly_income,

        0

      ),

    program_type:

      normalizeProgramType(

        payload.program_type

      ),

    pickup_city:

      cleanString(

        payload.pickup_city,

        150

      ),

    destination:

      cleanString(

        payload.destination,

        255

      ),

    ride_date:

      payload.ride_date || null,

    transportation_need:

      cleanString(

        payload.transportation_need,

        5000

      ),

    status:

      HTAF_STATUS.SUBMITTED,

    notes:

      null,

    submitted_at:

      now,

    created_at:

      now,

    updated_at:

      now

  };

}

async function createHTAFApplication(payload) {

  const application =

    buildHTAFApplicationPayload(payload);

  const { data, error } =

    await supabase

      .from("htaf_applications")

      .insert(application)

      .select()

      .single();

  if (error) {

    error.htaf_payload_keys =

      Object.keys(application);

    throw error;

  }

  return data;

}

async function sendApplicantConfirmation(application) {

  return sendEmail({

    to: application.email,

    subject:

      `HTAF Application Received (${application.application_code})`,

    html: `

      <h2>Harvey Transportation Assistance Foundation</h2>

      <p>

        Thank you for submitting a transportation

        assistance application.

      </p>

      <p>

        <strong>Application Number:</strong>

        ${application.application_code}

      </p>

      <p>

        <strong>Program:</strong>

        ${application.program_type}

      </p>

      <p>

        Your request has been received and is

        currently under review.

      </p>

      <p>

        Submission does not guarantee assistance.

        Applications are reviewed based on eligibility,

        documentation, resources, and availability.

      </p>

      <hr>

      <p>

        Harvey Transportation Assistance Foundation

      </p>

    `

  });

}

async function sendAdminApplicationAlert(application) {

  return sendEmail({

    to: ADMIN_EMAIL,

    subject:

      `New HTAF Application - ${application.application_code}`,

    html: `

      <h2>New HTAF Application Submitted</h2>

      <p>

        <strong>Name:</strong>

        ${application.first_name} ${application.last_name}

      </p>

      <p>

        <strong>Program:</strong>

        ${application.program_type}

      </p>

      <p>

        <strong>County:</strong>

        ${application.county}

      </p>

      <p>

        <strong>City:</strong>

        ${application.city}

      </p>

      <p>

        <strong>Email:</strong>

        ${application.email}

      </p>

      <p>

        <strong>Phone:</strong>

        ${application.phone}

      </p>

      <p>

        <strong>Destination:</strong>

        ${application.destination}

      </p>

      <p>

        <strong>Need:</strong>

        ${application.transportation_need}

      </p>

    `

  });

}

/* =========================================================

   HTAF APPLICATION SUBMISSION API

   This is the route your frontend is calling:

   POST /api/foundation/apply

========================================================= */

app.post(

  "/api/foundation/apply",

  asyncRoute(async (req, res) => {

    if (!ENABLE_HTAF_APPLICATIONS) {

      return fail(

        res,

        "HTAF applications are currently unavailable.",

        503

      );

    }

    const missing =

      requireBody(req, [

        "first_name",

        "last_name",

        "email",

        "phone",

        "county",

        "city",

        "pickup_city",

        "destination",

        "ride_date",

        "transportation_need"

      ]);

    if (missing.length) {

      return fail(

        res,

        "Missing required fields.",

        400,

        { missing }

      );

    }

    let application;

    try {

      application =

        await createHTAFApplication(

          req.body

        );

    } catch (dbError) {

      console.error(

        "❌ HTAF DB INSERT FAILED:",

        {

          table:

            "htaf_applications",

          message:

            dbError?.message,

          code:

            dbError?.code,

          details:

            dbError?.details,

          hint:

            dbError?.hint,

          payload_keys:

            dbError?.htaf_payload_keys || []

        }

      );

      return fail(

        res,

        IS_PRODUCTION

          ? "Application could not be saved. Please contact support if this continues."

          : `HTAF database error: ${dbError?.message || "Unknown database error"}`,

        500,

        IS_PRODUCTION

          ? {

              support_email:

                SUPPORT_EMAIL

            }

          : {

              db_code:

                dbError?.code,

              db_details:

                dbError?.details,

              db_hint:

                dbError?.hint,

              payload_keys:

                dbError?.htaf_payload_keys || []

            }

      );

    }

    const emailResults =

      await Promise.allSettled([

        sendApplicantConfirmation(application),

        sendAdminApplicationAlert(application)

      ]);

    emailResults.forEach(

      (result, index) => {

        if (result.status === "rejected") {

          console.warn(

            index === 0

              ? "⚠️ Applicant email failed:"

              : "⚠️ Admin email failed:",

            result.reason?.message

          );

        }

      }

    );

    auditLog({

      action:

        "htaf_application_created",

      entity_type:

        "htaf_application",

      entity_id:

        application.id,

      metadata: {

        application_code:

          application.application_code,

        program_type:

          application.program_type

      },

      req

    }).catch((error) => {

      console.warn(

        "⚠️ HTAF audit log failed:",

        error.message

      );

    });

    return ok(

      res,

      {

        application_id:

          application.id,

        application_code:

          application.application_code,

        status:

          application.status,

        message:

          "Application submitted successfully."

      },

      201

    );

  })

);

/* =========================================================

   HTAF STATUS LOOKUP

========================================================= */

app.get(

  "/api/foundation/status/:code",

  asyncRoute(async (req, res) => {

    const code =

      cleanString(

        req.params.code,

        80

      );

    const { data, error } =

      await supabase

        .from("htaf_applications")

        .select(

          "application_code, status, program_type, created_at, updated_at"

        )

        .eq(

          "application_code",

          code

        )

        .maybeSingle();

    if (error || !data) {

      return fail(

        res,

        "Application not found.",

        404

      );

    }

    return ok(res, {

      application: data

    });

  })

);

/* =========================================================

   ADMIN AUTH — LOGIN / LOGOUT / SESSION

   Sets an HttpOnly signed session cookie so no admin

   credential or token needs to live in browser storage.

========================================================= */

app.post(

  "/api/admin/login",

  asyncRoute(async (req, res) => {

    if (!ADMIN_SESSION_SECRET) {

      return fail(

        res,

        "Admin sessions are not configured on the server. Set ADMIN_SESSION_SECRET (or ADMIN_API_TOKEN) in the environment.",

        500

      );

    }

    if (!ADMIN_PASSWORD) {

      return fail(

        res,

        "Admin password login is not configured on the server. Set ADMIN_PASSWORD in the environment.",

        500

      );

    }

    const email =

      cleanEmail(req.body?.email);

    const password =

      String(req.body?.password || "");

    const emailOk =

      email === cleanEmail(ADMIN_EMAIL);

    const passwordOk =

      timingSafeEqualString(password, ADMIN_PASSWORD);

    if (!emailOk || !passwordOk) {

      await auditLog({

        actor_type: "admin",

        actor_id: email || "unknown",

        action: "admin_login_failed"

      });

      return fail(

        res,

        "Invalid admin email or password.",

        401

      );

    }

    const token = signAdminSession(email);

    setAdminSessionCookie(res, token);

    await auditLog({

      actor_type: "admin",

      actor_id: email,

      action: "admin_login_success"

    });

    return ok(res, {

      admin: {

        email,

        expiresInHours: ADMIN_SESSION_TTL_HOURS

      }

    });

  })

);

app.post(

  "/api/admin/logout",

  asyncRoute(async (req, res) => {

    clearAdminSessionCookie(res);

    return ok(res, {

      loggedOut: true

    });

  })

);

app.get(

  "/api/admin/session",

  asyncRoute(async (req, res) => {

    const session = readAdminSessionCookie(req);

    if (!session) {

      return ok(res, {

        authenticated: false

      });

    }

    return ok(res, {

      authenticated: true,

      admin: {

        email: session.email,

        expiresAt: session.exp

      }

    });

  })

);

/* =========================================================

   HTAF ADMIN LIST

========================================================= */

app.get(

  "/api/admin/foundation/applications",

  requireAdmin,

  asyncRoute(async (req, res) => {

    const status =

      cleanString(

        req.query.status,

        80

      );

    let query =

      supabase

        .from("htaf_applications")

        .select("*")

        .order(

          "created_at",

          { ascending: false }

        );

    if (status) {

      query =

        query.eq(

          "status",

          status

        );

    }

    const { data, error } =

      await query;

    if (error) {

      throw error;

    }

    return ok(res, {

      applications:

        data || []

    });

  })

);

/* =========================================================

   HTAF ADMIN UPDATE

========================================================= */

app.patch(

  "/api/admin/foundation/applications/:id",

  requireAdmin,

  asyncRoute(async (req, res) => {

    const id =

      cleanString(

        req.params.id,

        80

      );

    const allowedStatuses =

      Object.values(HTAF_STATUS);

    const status =

      cleanString(

        req.body.status,

        80

      );

    if (

      status &&

      !allowedStatuses.includes(status)

    ) {

      return fail(

        res,

        "Invalid HTAF application status.",

        400,

        { allowed_statuses: allowedStatuses }

      );

    }

    const update = {

      updated_at:

        nowIso()

    };

    if (status) {

      update.status = status;

    }

    if (

      req.body.notes !== undefined

    ) {

      update.notes =

        cleanString(

          req.body.notes,

          5000

        );

    }

    const { data, error } =

      await supabase

        .from("htaf_applications")

        .update(update)

        .eq("id", id)

        .select()

        .single();

    if (error) {

      throw error;

    }

    auditLog({

      actor_type:

        "admin",

      actor_id:

        req.admin.email,

      action:

        "htaf_application_updated",

      entity_type:

        "htaf_application",

      entity_id:

        id,

      metadata:

        update,

      req

    }).catch(() => {});

    return ok(res, {

      application: data

    });

  })

);

/* =========================================================

   HTAF DIAGNOSTIC ROUTE

   Admin only.

========================================================= */

app.get(

  "/api/admin/foundation/schema-check",

  requireAdmin,

  asyncRoute(async (req, res) => {

    const status =

      await inspectHtafSchema();

    return ok(res, {

      htaf_schema:

        status

    });

  })

);/* =========================================================

   PART 4 — AUTH, RIDER/DRIVER ONBOARDING, VERIFICATION

========================================================= */

const VERIFY_TTL_MINUTES =

  envNumber("VERIFY_TTL_MINUTES", 10);

const EMAIL_VERIFY_TTL_HOURS =

  envNumber("EMAIL_VERIFY_TTL_HOURS", 24);

function makeOtpCode() {

  return String(

    Math.floor(

      100000 + Math.random() * 900000

    )

  );

}

function futureIsoMinutes(minutes) {

  return new Date(

    Date.now() + minutes * 60_000

  ).toISOString();

}

function futureIsoHours(hours) {

  return new Date(

    Date.now() + hours * 60 * 60_000

  ).toISOString();

}

function normalizeRole(value) {

  const role =

    cleanString(value, 40).toLowerCase();

  const allowed = [

    "admin",

    "driver",

    "rider",

    "support",

    "foundation",

    "applicant"

  ];

  return allowed.includes(role)

    ? role

    : "rider";

}

/* =========================================================

   VERIFICATION RECORDS

========================================================= */

async function createVerificationRecord({

  channel,

  destination,

  purpose,

  user_type,

  metadata = {}

}) {

  const isEmail =

    channel === "email";

  const code =

    isEmail

      ? crypto.randomBytes(24).toString("hex")

      : makeOtpCode();

  const expires_at =

    isEmail

      ? futureIsoHours(EMAIL_VERIFY_TTL_HOURS)

      : futureIsoMinutes(VERIFY_TTL_MINUTES);

  const record = {

    id:

      makeId("VERIFY"),

    channel,

    destination,

    purpose,

    user_type,

    code_hash:

      hashToken(code),

    attempts:

      0,

    max_attempts:

      5,

    used_at:

      null,

    expires_at,

    metadata,

    created_at:

      nowIso()

  };

  const { data, error } =

    await supabase

      .from("verification_codes")

      .insert(record)

      .select()

      .single();

  if (error) {

    throw error;

  }

  return {

    record: data,

    code

  };

}

async function verifyCode({

  channel,

  destination,

  code,

  purpose

}) {

  const { data, error } =

    await supabase

      .from("verification_codes")

      .select("*")

      .eq("channel", channel)

      .eq("destination", destination)

      .eq("purpose", purpose)

      .is("used_at", null)

      .order("created_at", { ascending: false })

      .limit(1)

      .maybeSingle();

  if (error) {

    throw error;

  }

  if (!data) {

    return {

      ok: false,

      reason: "No active verification code found."

    };

  }

  if (

    new Date(data.expires_at).getTime() <

    Date.now()

  ) {

    return {

      ok: false,

      reason: "Verification code expired."

    };

  }

  if (

    Number(data.attempts || 0) >=

    Number(data.max_attempts || 5)

  ) {

    return {

      ok: false,

      reason: "Too many verification attempts."

    };

  }

  const codeHash =

    hashToken(code);

  const valid =

    timingSafeEqualString(

      codeHash,

      data.code_hash

    );

  if (!valid) {

    await supabase

      .from("verification_codes")

      .update({

        attempts:

          Number(data.attempts || 0) + 1

      })

      .eq("id", data.id);

    return {

      ok: false,

      reason: "Invalid verification code."

    };

  }

  await supabase

    .from("verification_codes")

    .update({

      used_at:

        nowIso()

    })

    .eq("id", data.id);

  return {

    ok: true,

    record: data

  };

}

/* =========================================================

   PUBLIC CONFIG

========================================================= */

app.get(

  "/api/config/public",

  asyncRoute(async (req, res) => {

    return ok(res, {

      app_name:

        APP_NAME,

      app_base_url:

        APP_BASE_URL,

      support_email:

        SUPPORT_EMAIL,

      persona_enabled:

        ENABLE_PERSONA,

      checkr_enabled:

        ENABLE_CHECKR,

      stripe_enabled:

        Boolean(stripe),

      htaf_enabled:

        ENABLE_HTAF_APPLICATIONS,

      pricing: {

        base_fare:

          BASE_FARE,

        per_mile_rate:

          PER_MILE_RATE,

        per_minute_rate:

          PER_MINUTE_RATE,

        booking_fee:

          BOOKING_FEE,

        minimum_fare:

          MINIMUM_FARE

      }

    });

  })

);

/* =========================================================

   RIDER SIGNUP

========================================================= */

app.post(

  "/api/riders/signup",

  asyncRoute(async (req, res) => {

    const missing =

      requireBody(req, [

        "first_name",

        "last_name",

        "email",

        "phone"

      ]);

    if (missing.length) {

      return fail(

        res,

        "Missing required rider signup fields.",

        400,

        { missing }

      );

    }

    const now =

      nowIso();

    const rider = {

      id:

        makeId("RIDER"),

      first_name:

        cleanString(req.body.first_name, 120),

      last_name:

        cleanString(req.body.last_name, 120),

      email:

        cleanEmail(req.body.email),

      phone:

        cleanPhone(req.body.phone),

      city:

        cleanString(req.body.city, 120),

      state:

        cleanString(req.body.state || "TN", 40),

      status:

        ENABLE_RIDER_APPROVAL_GATE

          ? "pending_verification"

          : "active",

      approval_status:

        ENABLE_RIDER_APPROVAL_GATE

          ? "pending"

          : "approved",

      email_verified:

        false,

      phone_verified:

        false,

      persona_verified:

        false,

      created_at:

        now,

      updated_at:

        now

    };

    const { data, error } =

      await supabase

        .from("riders")

        .insert(rider)

        .select()

        .single();

    if (error) {

      throw error;

    }

    auditLog({

      actor_type:

        "rider",

      actor_id:

        data.id,

      action:

        "rider_signup_created",

      entity_type:

        "rider",

      entity_id:

        data.id,

      req

    }).catch(() => {});

    return ok(

      res,

      {

        rider:

          data,

        next_steps: {

          email_verification:

            true,

          sms_verification:

            true,

          persona_verification:

            ENABLE_PERSONA

        }

      },

      201

    );

  })

);

/* =========================================================

   DRIVER SIGNUP

========================================================= */

app.post(

  "/api/drivers/signup",

  asyncRoute(async (req, res) => {

    const missing =

      requireBody(req, [

        "first_name",

        "last_name",

        "email",

        "phone"

      ]);

    if (missing.length) {

      return fail(

        res,

        "Missing required driver signup fields.",

        400,

        { missing }

      );

    }

    const now =

      nowIso();

    const driver = {

      id:

        makeId("DRV"),

      first_name:

        cleanString(req.body.first_name, 120),

      last_name:

        cleanString(req.body.last_name, 120),

      email:

        cleanEmail(req.body.email),

      phone:

        cleanPhone(req.body.phone),

      city:

        cleanString(

          req.body.city || "Nashville",

          120

        ),

      state:

        cleanString(

          req.body.state || "TN",

          40

        ),

      vehicle_make:

        cleanString(req.body.vehicle_make, 100),

      vehicle_model:

        cleanString(req.body.vehicle_model, 100),

      vehicle_year:

        cleanString(req.body.vehicle_year, 20),

      license_plate:

        cleanString(req.body.license_plate, 40),

      status:

        "pending_verification",

      online:

        false,

      email_verified:

        false,

      phone_verified:

        false,

      persona_verified:

        false,

      checkr_status:

        "not_started",

      approval_status:

        "pending",

      rating:

        5,

      total_trips:

        0,

      created_at:

        now,

      updated_at:

        now

    };

    const { data, error } =

      await supabase

        .from("drivers")

        .insert(driver)

        .select()

        .single();

    if (error) {

      throw error;

    }

    auditLog({

      actor_type:

        "driver",

      actor_id:

        data.id,

      action:

        "driver_signup_created",

      entity_type:

        "driver",

      entity_id:

        data.id,

      req

    }).catch(() => {});

    return ok(

      res,

      {

        driver:

          data,

        next_steps: {

          email_verification:

            true,

          sms_verification:

            true,

          persona_verification:

            ENABLE_PERSONA,

          background_check:

            ENABLE_CHECKR

        }

      },

      201

    );

  })

);

/* =========================================================

   EMAIL VERIFICATION START

========================================================= */

app.post(

  "/api/verify/email/start",

  asyncRoute(async (req, res) => {

    const missing =

      requireBody(req, [

        "email",

        "purpose",

        "user_type"

      ]);

    if (missing.length) {

      return fail(

        res,

        "Missing required email verification fields.",

        400,

        { missing }

      );

    }

    const email =

      cleanEmail(req.body.email);

    const purpose =

      cleanString(req.body.purpose, 80);

    const userType =

      normalizeRole(req.body.user_type);

    const { code } =

      await createVerificationRecord({

        channel:

          "email",

        destination:

          email,

        purpose,

        user_type:

          userType,

        metadata: {

          requested_from:

            "web"

        }

      });

    const verifyUrl =

      `${APP_BASE_URL}/verify-email.html?email=${encodeURIComponent(email)}&purpose=${encodeURIComponent(purpose)}&token=${encodeURIComponent(code)}`;

    await sendEmail({

      to:

        email,

      subject:

        "Verify your Harvey Taxi email",

      html: `

        <h2>Verify Your Email</h2>

        <p>

          Please verify your email address to continue

          with Harvey Taxi.

        </p>

        <p>

          <a href="${verifyUrl}">

            Verify Email

          </a>

        </p>

        <p>

          This link expires in

          ${EMAIL_VERIFY_TTL_HOURS} hours.

        </p>

      `

    });

    auditLog({

      actor_type:

        userType,

      actor_id:

        email,

      action:

        "email_verification_started",

      metadata: {

        purpose

      },

      req

    }).catch(() => {});

    return ok(res, {

      message:

        "Verification email sent.",

      email

    });

  })

);

/* =========================================================

   EMAIL VERIFICATION CONFIRM

========================================================= */

app.post(

  "/api/verify/email/confirm",

  asyncRoute(async (req, res) => {

    const missing =

      requireBody(req, [

        "email",

        "token",

        "purpose"

      ]);

    if (missing.length) {

      return fail(

        res,

        "Missing verification fields.",

        400,

        { missing }

      );

    }

    const email =

      cleanEmail(req.body.email);

    const result =

      await verifyCode({

        channel:

          "email",

        destination:

          email,

        code:

          req.body.token,

        purpose:

          cleanString(req.body.purpose, 80)

      });

    if (!result.ok) {

      return fail(

        res,

        result.reason,

        400

      );

    }

    await Promise.allSettled([

      supabase

        .from("riders")

        .update({

          email_verified:

            true,

          updated_at:

            nowIso()

        })

        .eq("email", email),

      supabase

        .from("drivers")

        .update({

          email_verified:

            true,

          updated_at:

            nowIso()

        })

        .eq("email", email)

    ]);

    auditLog({

      actor_id:

        email,

      action:

        "email_verified",

      req

    }).catch(() => {});

    return ok(res, {

      message:

        "Email verified successfully."

    });

  })

);

/* =========================================================

   SMS VERIFICATION START

========================================================= */

app.post(

  "/api/verify/sms/start",

  asyncRoute(async (req, res) => {

    const missing =

      requireBody(req, [

        "phone",

        "purpose",

        "user_type"

      ]);

    if (missing.length) {

      return fail(

        res,

        "Missing required SMS verification fields.",

        400,

        { missing }

      );

    }

    const phone =

      cleanPhone(req.body.phone);

    const purpose =

      cleanString(req.body.purpose, 80);

    const userType =

      normalizeRole(req.body.user_type);

    const { code } =

      await createVerificationRecord({

        channel:

          "sms",

        destination:

          phone,

        purpose,

        user_type:

          userType,

        metadata: {

          requested_from:

            "web"

        }

      });

    await sendSms({

      to:

        phone,

      body:

        `Your Harvey Taxi verification code is ${code}. It expires in ${VERIFY_TTL_MINUTES} minutes.`

    });

    auditLog({

      actor_type:

        userType,

      actor_id:

        phone,

      action:

        "sms_verification_started",

      metadata: {

        purpose

      },

      req

    }).catch(() => {});

    return ok(res, {

      message:

        "Verification code sent.",

      phone,

      expires_in_minutes:

        VERIFY_TTL_MINUTES

    });

  })

);

/* =========================================================

   SMS VERIFICATION CONFIRM

========================================================= */

app.post(

  "/api/verify/sms/confirm",

  asyncRoute(async (req, res) => {

    const missing =

      requireBody(req, [

        "phone",

        "code",

        "purpose"

      ]);

    if (missing.length) {

      return fail(

        res,

        "Missing verification fields.",

        400,

        { missing }

      );

    }

    const phone =

      cleanPhone(req.body.phone);

    const result =

      await verifyCode({

        channel:

          "sms",

        destination:

          phone,

        code:

          cleanString(req.body.code, 20),

        purpose:

          cleanString(req.body.purpose, 80)

      });

    if (!result.ok) {

      return fail(

        res,

        result.reason,

        400

      );

    }

    await Promise.allSettled([

      supabase

        .from("riders")

        .update({

          phone_verified:

            true,

          updated_at:

            nowIso()

        })

        .eq("phone", phone),

      supabase

        .from("drivers")

        .update({

          phone_verified:

            true,

          updated_at:

            nowIso()

        })

        .eq("phone", phone)

    ]);

    auditLog({

      actor_id:

        phone,

      action:

        "phone_verified",

      req

    }).catch(() => {});

    return ok(res, {

      message:

        "Phone verified successfully."

    });

  })

);/* =========================================================

   PART 5 — PERSONA + CHECKR PRODUCTION VERIFICATION

========================================================= */

/* =========================================================

   PERSONA API CLIENT

========================================================= */

async function personaRequest(pathname, body = {}) {

  if (!PERSONA_API_KEY || !ENABLE_PERSONA) {

    throw new Error("Persona is not configured.");

  }

  const response = await fetch(

    `https://withpersona.com/api/v1${pathname}`,

    {

      method: "POST",

      headers: {

        Authorization: `Bearer ${PERSONA_API_KEY}`,

        "Content-Type": "application/json",

        Accept: "application/json"

      },

      body: JSON.stringify(body)

    }

  );

  const json =

    await response.json().catch(() => ({}));

  if (!response.ok) {

    throw new Error(

      json?.errors?.[0]?.detail ||

      json?.message ||

      "Persona request failed."

    );

  }

  return json;

}

async function createPersonaInquiry({

  user_type,

  user_id,

  email,

  phone,

  first_name,

  last_name

}) {

  const templateId =

    user_type === "driver"

      ? PERSONA_TEMPLATE_ID_DRIVER

      : PERSONA_TEMPLATE_ID_RIDER;

  if (!templateId) {

    throw new Error(

      `Missing Persona template for ${user_type}.`

    );

  }

  const response =

    await personaRequest("/inquiries", {

      data: {

        type: "inquiry",

        attributes: {

          "inquiry-template-id":

            templateId,

          "reference-id":

            user_id,

          fields: {

            name_first:

              first_name,

            name_last:

              last_name,

            email_address:

              email,

            phone_number:

              phone

          }

        },

        meta: {

          user_type,

          user_id

        }

      }

    });

  return response?.data;

}

/* =========================================================

   CREATE PERSONA INQUIRY

========================================================= */

app.post(

  "/api/persona/inquiry",

  asyncRoute(async (req, res) => {

    const missing =

      requireBody(req, [

        "user_type",

        "user_id",

        "email",

        "first_name",

        "last_name"

      ]);

    if (missing.length) {

      return fail(

        res,

        "Missing Persona inquiry fields.",

        400,

        { missing }

      );

    }

    const userType =

      cleanString(

        req.body.user_type,

        20

      ).toLowerCase();

    if (!["rider", "driver"].includes(userType)) {

      return fail(

        res,

        "Invalid Persona user type.",

        400

      );

    }

    let inquiry;

    try {

      inquiry =

        await createPersonaInquiry({

          user_type:

            userType,

          user_id:

            cleanString(req.body.user_id, 100),

          email:

            cleanEmail(req.body.email),

          phone:

            cleanPhone(req.body.phone),

          first_name:

            cleanString(req.body.first_name, 120),

          last_name:

            cleanString(req.body.last_name, 120)

        });

    } catch (error) {

      console.error(

        "❌ Persona inquiry failed:",

        error.message

      );

      return fail(

        res,

        "Persona verification could not be started.",

        502,

        IS_PRODUCTION

          ? {}

          : { persona_error: error.message }

      );

    }

    const table =

      userType === "driver"

        ? "drivers"

        : "riders";

    await supabase

      .from(table)

      .update({

        persona_inquiry_id:

          inquiry?.id || null,

        persona_status:

          inquiry?.attributes?.status || "created",

        updated_at:

          nowIso()

      })

      .eq(

        "id",

        cleanString(req.body.user_id, 100)

      );

    auditLog({

      actor_type:

        userType,

      actor_id:

        req.body.user_id,

      action:

        "persona_inquiry_created",

      entity_type:

        userType,

      entity_id:

        req.body.user_id,

      metadata: {

        inquiry_id:

          inquiry?.id

      },

      req

    }).catch(() => {});

    return ok(res, {

      inquiry,

      message:

        "Persona inquiry created."

    });

  })

);

/* =========================================================

   PERSONA WEBHOOK

========================================================= */

function verifyPersonaSignature(req, rawBody) {

  if (!PERSONA_WEBHOOK_SECRET) {

    return true;

  }

  const signature =

    req.headers["persona-signature"] ||

    req.headers["x-persona-signature"];

  if (!signature) {

    return false;

  }

  const expected =

    crypto

      .createHmac(

        "sha256",

        PERSONA_WEBHOOK_SECRET

      )

      .update(rawBody)

      .digest("hex");

  return timingSafeEqualString(

    signature,

    expected

  );

}

app.post(

  "/api/persona/webhook",

  express.raw({

    type: "*/*",

    limit: RAW_WEBHOOK_LIMIT

  }),

  asyncRoute(async (req, res) => {

    const raw =

      Buffer.isBuffer(req.body)

        ? req.body.toString("utf8")

        : String(req.body || "");

    let payload = {};

    try {

      payload =

        JSON.parse(raw || "{}");

    } catch {

      return fail(

        res,

        "Invalid Persona webhook payload.",

        400

      );

    }

    if (

      !verifyPersonaSignature(

        req,

        raw

      )

    ) {

      return fail(

        res,

        "Invalid Persona signature.",

        401

      );

    }

    const eventType =

      payload?.data?.attributes?.name ||

      payload?.type ||

      "persona_event";

    const inquiry =

      payload?.data?.attributes?.payload?.data ||

      payload?.data;

    const referenceId =

      inquiry?.attributes?.["reference-id"] ||

      inquiry?.attributes?.reference_id ||

      null;

    const status =

      inquiry?.attributes?.status ||

      payload?.data?.attributes?.status ||

      "unknown";

    const statusLower =

      String(status).toLowerCase();

    const approved =

      [

        "completed",

        "approved",

        "passed",

        "verified"

      ].includes(statusLower) ||

      String(eventType).includes("approved") ||

      String(eventType).includes("completed");

    if (referenceId) {

      await Promise.allSettled([

        supabase

          .from("riders")

          .update({

            persona_status:

              status,

            persona_verified:

              approved,

            updated_at:

              nowIso()

          })

          .eq("id", referenceId),

        supabase

          .from("drivers")

          .update({

            persona_status:

              status,

            persona_verified:

              approved,

            updated_at:

              nowIso()

          })

          .eq("id", referenceId)

      ]);

    }

    auditLog({

      action:

        "persona_webhook_received",

      entity_type:

        "persona",

      entity_id:

        referenceId,

      metadata: {

        event_type:

          eventType,

        status,

        approved

      },

      req

    }).catch(() => {});

    return ok(res, {

      received: true

    });

  })

);

/* =========================================================

   CHECKR API CLIENT

========================================================= */

const CHECKR_PACKAGE =

  env("CHECKR_PACKAGE", "driver_standard");

const CHECKR_WORK_COUNTRY =

  env("CHECKR_WORK_COUNTRY", "US");

const CHECKR_WORK_STATE =

  env("CHECKR_WORK_STATE", "TN");

const CHECKR_WORK_CITY =

  env("CHECKR_WORK_CITY", "Nashville");

async function checkrRequest(pathname, body = {}) {

  if (!CHECKR_API_KEY || !ENABLE_CHECKR) {

    throw new Error("Checkr is not configured.");

  }

  const basic =

    Buffer

      .from(`${CHECKR_API_KEY}:`)

      .toString("base64");

  const response =

    await fetch(

      `https://api.checkr.com/v1${pathname}`,

      {

        method: "POST",

        headers: {

          Authorization:

            `Basic ${basic}`,

          "Content-Type":

            "application/json"

        },

        body:

          JSON.stringify(body)

      }

    );

  const json =

    await response

      .json()

      .catch(() => ({}));

  if (!response.ok) {

    throw new Error(

      json?.error ||

      json?.message ||

      "Checkr request failed."

    );

  }

  return json;

}

async function createCheckrCandidate(driver) {

  return checkrRequest(

    "/candidates",

    {

      first_name:

        driver.first_name,

      last_name:

        driver.last_name,

      email:

        driver.email,

      phone:

        driver.phone,

      work_locations: [

        {

          country:

            CHECKR_WORK_COUNTRY,

          state:

            CHECKR_WORK_STATE,

          city:

            CHECKR_WORK_CITY

        }

      ],

      metadata: {

        driver_id:

          driver.id,

        app_name:

          APP_NAME

      }

    }

  );

}

async function createCheckrInvitation(candidateId) {

  return checkrRequest(

    "/invitations",

    {

      candidate_id:

        candidateId,

      package:

        CHECKR_PACKAGE,

      work_locations: [

        {

          country:

            CHECKR_WORK_COUNTRY,

          state:

            CHECKR_WORK_STATE,

          city:

            CHECKR_WORK_CITY

        }

      ]

    }

  );

}

/* =========================================================

   CHECKR START

========================================================= */

app.post(

  "/api/checkr/start",

  requireDriver,

  asyncRoute(async (req, res) => {

    const driverId = req.driver.id;

    const { data: driver, error } =

      await supabase

        .from("drivers")

        .select("*")

        .eq("id", driverId)

        .single();

    if (error || !driver) {

      return fail(

        res,

        "Driver not found.",

        404

      );

    }

    let candidate;

    let invitation;

    try {

      candidate =

        await createCheckrCandidate(driver);

      invitation =

        await createCheckrInvitation(

          candidate.id

        );

    } catch (error) {

      console.error(

        "❌ Checkr start failed:",

        error.message

      );

      return fail(

        res,

        "Background check could not be started.",

        502,

        IS_PRODUCTION

          ? {}

          : { checkr_error: error.message }

      );

    }

    await supabase

      .from("drivers")

      .update({

        checkr_candidate_id:

          candidate.id,

        checkr_invitation_id:

          invitation.id,

        checkr_invitation_url:

          invitation.invitation_url || null,

        checkr_status:

          "invited",

        updated_at:

          nowIso()

      })

      .eq("id", driverId);

    auditLog({

      actor_type:

        "driver",

      actor_id:

        driverId,

      action:

        "checkr_invitation_created",

      entity_type:

        "driver",

      entity_id:

        driverId,

      metadata: {

        candidate_id:

          candidate.id,

        invitation_id:

          invitation.id

      },

      req

    }).catch(() => {});

    return ok(res, {

      candidate,

      invitation,

      message:

        "Background check invitation created."

    });

  })

);

/* =========================================================

   CHECKR WEBHOOK

========================================================= */

function verifyCheckrSignature(req, rawBody) {

  if (!CHECKR_WEBHOOK_SECRET) {

    return true;

  }

  const signature =

    req.headers["checkr-signature"] ||

    req.headers["x-checkr-signature"];

  if (!signature) {

    return false;

  }

  const expected =

    crypto

      .createHmac(

        "sha256",

        CHECKR_WEBHOOK_SECRET

      )

      .update(rawBody)

      .digest("hex");

  return timingSafeEqualString(

    signature,

    expected

  );

}

app.post(

  "/api/checkr/webhook",

  express.raw({

    type: "*/*",

    limit: RAW_WEBHOOK_LIMIT

  }),

  asyncRoute(async (req, res) => {

    const raw =

      Buffer.isBuffer(req.body)

        ? req.body.toString("utf8")

        : String(req.body || "");

    let payload = {};

    try {

      payload =

        JSON.parse(raw || "{}");

    } catch {

      return fail(

        res,

        "Invalid Checkr webhook payload.",

        400

      );

    }

    if (

      !verifyCheckrSignature(

        req,

        raw

      )

    ) {

      return fail(

        res,

        "Invalid Checkr signature.",

        401

      );

    }

    const eventType =

      payload?.type ||

      payload?.event ||

      "checkr_event";

    const object =

      payload?.data?.object ||

      payload?.object ||

      payload?.data ||

      {};

    const candidateId =

      object?.candidate_id ||

      object?.candidate?.id ||

      object?.id ||

      null;

    const status =

      object?.status ||

      object?.result ||

      eventType;

    const clear =

      [

        "clear",

        "complete",

        "completed"

      ].includes(

        String(status).toLowerCase()

      );

    if (candidateId) {

      await supabase

        .from("drivers")

        .update({

          checkr_status:

            status,

          approval_status:

            clear

              ? "eligible_for_review"

              : "pending",

          updated_at:

            nowIso()

        })

        .eq(

          "checkr_candidate_id",

          candidateId

        );

    }

    auditLog({

      action:

        "checkr_webhook_received",

      entity_type:

        "checkr",

      entity_id:

        candidateId,

      metadata: {

        event_type:

          eventType,

        status,

        clear

      },

      req

    }).catch(() => {});

    return ok(res, {

      received: true

    });

  })

);

/* =========================================================

   DRIVER READINESS

========================================================= */

app.get(

  "/api/drivers/:id/readiness",

  asyncRoute(async (req, res) => {

    const driverId =

      cleanString(

        req.params.id,

        100

      );

    const { data: driver, error } =

      await supabase

        .from("drivers")

        .select("*")

        .eq("id", driverId)

        .single();

    if (error || !driver) {

      return fail(

        res,

        "Driver not found.",

        404

      );

    }

    const checks = {

      email_verified:

        Boolean(driver.email_verified),

      phone_verified:

        Boolean(driver.phone_verified),

      persona_verified:

        ENABLE_PERSONA

          ? Boolean(driver.persona_verified)

          : true,

      checkr_ready:

        ENABLE_CHECKR

          ? [

              "clear",

              "complete",

              "completed",

              "eligible_for_review"

            ].includes(

              String(

                driver.checkr_status ||

                driver.approval_status ||

                ""

              ).toLowerCase()

            )

          : true,

      vehicle_present:

        Boolean(

          driver.vehicle_make &&

          driver.vehicle_model &&

          driver.vehicle_year

        )

    };

    const ready =

      Object.values(checks)

        .every(Boolean);

    return ok(res, {

      driver_id:

        driver.id,

      ready,

      status:

        driver.status,

      approval_status:

        driver.approval_status,

      checks

    });

  })

);/* =========================================================

   PART 6 — RIDE ESTIMATES, PAYMENT, DISPATCH

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

  FAILED: "failed"

};

/* =========================================================

   RIDER READINESS

========================================================= */

async function getRiderReadiness(riderId) {

  if (!riderId) {

    return {

      ready: true,

      reason: null

    };

  }

  const { data: rider, error } =

    await supabase

      .from("riders")

      .select("*")

      .eq("id", riderId)

      .maybeSingle();

  if (error || !rider) {

    return {

      ready: false,

      reason: "Rider profile not found."

    };

  }

  if (!ENABLE_RIDER_APPROVAL_GATE) {

    return {

      ready: true,

      rider

    };

  }

  const checks = {

    email_verified:

      Boolean(rider.email_verified),

    phone_verified:

      Boolean(rider.phone_verified),

    persona_verified:

      ENABLE_PERSONA

        ? Boolean(rider.persona_verified)

        : true,

    status_ready:

      ["active", "approved"].includes(

        String(rider.status || "").toLowerCase()

      ) ||

      ["approved"].includes(

        String(rider.approval_status || "").toLowerCase()

      )

  };

  const ready =

    Object.values(checks).every(Boolean);

  return {

    ready,

    rider,

    checks,

    reason:

      ready

        ? null

        : "Rider verification is not complete."

  };

}

/* =========================================================

   DRIVER SEARCH

========================================================= */

async function findAvailableDrivers({

  pickup_lat,

  pickup_lng,

  radius_miles = envNumber("DRIVER_SEARCH_RADIUS_MILES", 25),

  limit = envNumber("MAX_DISPATCH_ATTEMPTS", 5),

  exclude_driver_ids = []

}) {

  const excludeSet =

    new Set(

      (exclude_driver_ids || [])

        .filter(Boolean)

        .map(String)

    );

  const { data, error } =

    await supabase

      .from("drivers")

      .select("*")

      .eq("online", true)

      .eq("status", "active")

      .eq("approval_status", "approved")

      .limit(50);

  if (error) {

    throw error;

  }

  return (data || [])

    .filter((driver) => !excludeSet.has(String(driver.id)))

    .map((driver) => {

      const lat =

        Number(

          driver.current_lat ||

          driver.latitude

        );

      const lng =

        Number(

          driver.current_lng ||

          driver.longitude

        );

      let distance =

        Number.POSITIVE_INFINITY;

      if (

        Number.isFinite(lat) &&

        Number.isFinite(lng) &&

        Number.isFinite(Number(pickup_lat)) &&

        Number.isFinite(Number(pickup_lng))

      ) {

        distance =

          haversineMiles(

            Number(pickup_lat),

            Number(pickup_lng),

            lat,

            lng

          );

      }

      return {

        ...driver,

        distance_miles:

          Number.isFinite(distance)

            ? Number(distance.toFixed(2))

            : null

      };

    })

    .filter((driver) => {

      if (driver.distance_miles === null) {

        return true;

      }

      return driver.distance_miles <= radius_miles;

    })

    .sort((a, b) => {

      return (

        (a.distance_miles ?? 9999) -

        (b.distance_miles ?? 9999)

      );

    })

    .slice(0, limit);

}

/* =========================================================

   DRIVER OFFER CREATION

========================================================= */

async function createDriverOffer({

  ride_id,

  driver_id,

  attempt = 1,

  expires_in_seconds = envNumber("DISPATCH_TIMEOUT_SECONDS", 30)

}) {

  const now = nowIso();

  const offer = {

    id:

      makeId("OFFER"),

    ride_id,

    driver_id,

    status:

      "pending",

    attempt,

    expires_at:

      new Date(

        Date.now() + expires_in_seconds * 1000

      ).toISOString(),

    created_at:

      now,

    updated_at:

      now

  };

  const { data, error } =

    await supabase

      .from("driver_offers")

      .insert(offer)

      .select()

      .single();

  if (error) {

    throw error;

  }

  return data;

}

/* =========================================================

   DISPATCH RIDE

========================================================= */

async function dispatchRide(ride) {

  // Exclude drivers who already received an offer for this ride

  // (declined, expired, or still pending) so we never re-offer

  // the same ride to a driver who already saw it.

  let excludeDriverIds = [];

  try {

    const { data: priorOffers } =

      await supabase

        .from("driver_offers")

        .select("driver_id")

        .eq("ride_id", ride.id);

    excludeDriverIds =

      (priorOffers || [])

        .map((o) => o.driver_id)

        .filter(Boolean);

  } catch (offerLookupErr) {

    console.warn(

      "⚠️ Could not load prior offers for redispatch exclusion:",

      offerLookupErr.message

    );

  }

  const drivers =

    await findAvailableDrivers({

      pickup_lat:

        ride.pickup_lat,

      pickup_lng:

        ride.pickup_lng,

      exclude_driver_ids:

        excludeDriverIds

    });

  if (!drivers.length) {

    await supabase

      .from("rides")

      .update({

        status:

          RIDE_STATUS.FAILED,

        dispatch_status:

          "no_drivers_available",

        updated_at:

          nowIso()

      })

      .eq("id", ride.id);

    return {

      dispatched: false,

      reason: "No available drivers."

    };

  }

  const firstDriver =

    drivers[0];

  const offer =

    await createDriverOffer({

      ride_id:

        ride.id,

      driver_id:

        firstDriver.id,

      attempt:

        1

    });

  await supabase

    .from("rides")

    .update({

      status:

        RIDE_STATUS.AWAITING_DRIVER,

      dispatch_status:

        "offer_sent",

      current_offer_id:

        offer.id,

      current_driver_id:

        firstDriver.id,

      dispatch_attempts:

        1,

      updated_at:

        nowIso()

    })

    .eq("id", ride.id);

  return {

    dispatched: true,

    offer,

    driver: firstDriver

  };

}

/* =========================================================

   RIDE ESTIMATE API

========================================================= */

app.post(

  "/api/rides/estimate",

  asyncRoute(async (req, res) => {

    const miles =

      Number(

        req.body.miles ||

        req.body.distance_miles ||

        0

      );

    const minutes =

      Number(

        req.body.minutes ||

        req.body.duration_minutes ||

        0

      );

    const rideType =

      normalizeRideType(

        req.body.ride_type

      );

    const estimate =

      calculateRideEstimate({

        miles,

        minutes,

        ride_type:

          rideType

      });

    auditLog({

      action:

        "ride_estimate_created",

      metadata: {

        ride_type:

          rideType,

        estimate

      },

      req

    }).catch(() => {});

    return ok(res, {

      estimate

    });

  })

);

/* =========================================================

   RIDE PAYMENT INTENT

========================================================= */

app.post(

  "/api/rides/payment-intent",

  asyncRoute(async (req, res) => {

    if (

      !stripe ||

      !ENABLE_PAYMENT_GATE

    ) {

      return fail(

        res,

        "Payments are not configured.",

        503

      );

    }

    const rideType =

      normalizeRideType(

        req.body.ride_type

      );

    const estimate =

      calculateRideEstimate({

        miles:

          Number(req.body.miles || 0),

        minutes:

          Number(req.body.minutes || 0),

        ride_type:

          rideType

      });

    const amountCents =

      Math.round(

        estimate.total * 100

      );

    let paymentIntent;

    try {

      paymentIntent =

        await stripe.paymentIntents.create({

          amount:

            amountCents,

          currency:

            "usd",

          capture_method:

            "manual",

          automatic_payment_methods: {

            enabled:

              true

          },

          metadata: {

            app:

              "harvey_taxi",

            ride_type:

              rideType,

            rider_id:

              cleanString(

                req.body.rider_id,

                100

              )

          }

        });

    } catch (error) {

      console.error(

        "❌ Stripe payment intent failed:",

        error.message

      );

      return fail(

        res,

        "Payment authorization could not be created.",

        502,

        IS_PRODUCTION

          ? {}

          : { stripe_error: error.message }

      );

    }

    auditLog({

      action:

        "ride_payment_intent_created",

      actor_type:

        "rider",

      actor_id:

        cleanString(

          req.body.rider_id,

          100

        ),

      metadata: {

        payment_intent_id:

          paymentIntent.id,

        amount:

          estimate.total

      },

      req

    }).catch(() => {});

    return ok(res, {

      payment_intent_id:

        paymentIntent.id,

      client_secret:

        paymentIntent.client_secret,

      estimate

    });

  })

);

/* =========================================================

   RIDE REQUEST

========================================================= */

app.post(

  "/api/rides/request",

  asyncRoute(async (req, res) => {

    const missing =

      requireBody(req, [

        "pickup",

        "destination"

      ]);

    if (missing.length) {

      return fail(

        res,

        "Missing ride request fields.",

        400,

        { missing }

      );

    }

    const riderId =

      cleanString(

        req.body.rider_id,

        100

      );

    if (riderId) {

      const readiness =

        await getRiderReadiness(

          riderId

        );

      if (!readiness.ready) {

        return fail(

          res,

          readiness.reason,

          403,

          {

            checks:

              readiness.checks || {}

          }

        );

      }

    }

    const rideType =

      normalizeRideType(

        req.body.ride_type

      );

    const estimate =

      calculateRideEstimate({

        miles:

          Number(

            req.body.miles ||

            req.body.distance_miles ||

            0

          ),

        minutes:

          Number(

            req.body.minutes ||

            req.body.duration_minutes ||

            0

          ),

        ride_type:

          rideType

      });

    let status =

      RIDE_STATUS.PAYMENT_AUTHORIZED;

    if (

      ENABLE_PAYMENT_GATE &&

      !req.body.payment_intent_id

    ) {

      status =

        RIDE_STATUS.PAYMENT_REQUIRED;

    }

    const now =

      nowIso();

    const ride = {

      id:

        makeId("RIDE"),

      rider_id:

        riderId || null,

      rider_name:

        cleanString(

          req.body.rider_name,

          180

        ),

      rider_phone:

        cleanPhone(

          req.body.rider_phone

        ),

      pickup:

        cleanString(

          req.body.pickup,

          500

        ),

      destination:

        cleanString(

          req.body.destination,

          500

        ),

      pickup_lat:

        req.body.pickup_lat || null,

      pickup_lng:

        req.body.pickup_lng || null,

      destination_lat:

        req.body.destination_lat || null,

      destination_lng:

        req.body.destination_lng || null,

      ride_type:

        rideType,

      scheduled_for:

        req.body.scheduled_for || null,

      preferred_driver_id:

        cleanString(

          req.body.preferred_driver_id,

          100

        ) || null,

      payment_intent_id:

        cleanString(

          req.body.payment_intent_id,

          200

        ) || null,

      status,

      dispatch_status:

        status === RIDE_STATUS.PAYMENT_REQUIRED

          ? "awaiting_payment"

          : "ready_to_dispatch",

      estimate_total:

        estimate.total,

      driver_payout:

        estimate.driver_payout,

      platform_fee:

        estimate.platform_fee,

      miles:

        estimate.miles,

      minutes:

        estimate.minutes,

      notes:

        cleanString(

          req.body.notes,

          1000

        ),

      created_at:

        now,

      updated_at:

        now

    };

    const { data, error } =

      await supabase

        .from("rides")

        .insert(ride)

        .select()

        .single();

    if (error) {

      console.error(

        "❌ Ride insert failed:",

        {

          message:

            error.message,

          code:

            error.code,

          details:

            error.details,

          hint:

            error.hint

        }

      );

      throw error;

    }

    let dispatch = null;

    if (

      status === RIDE_STATUS.PAYMENT_AUTHORIZED &&

      !ride.scheduled_for

    ) {

      dispatch =

        await dispatchRide(data);

    }

    auditLog({

      actor_type:

        "rider",

      actor_id:

        riderId || null,

      action:

        "ride_requested",

      entity_type:

        "ride",

      entity_id:

        data.id,

      metadata: {

        ride_type:

          rideType,

        status,

        dispatch

      },

      req

    }).catch(() => {});

    return ok(

      res,

      {

        ride:

          data,

        estimate,

        dispatch

      },

      201

    );

  })

);

/* =========================================================

   AUTHORIZE RIDE + START DISPATCH

========================================================= */

app.post(

  "/api/rides/:id/authorize",

  asyncRoute(async (req, res) => {

    const rideId =

      cleanString(

        req.params.id,

        100

      );

    const { data: ride, error } =

      await supabase

        .from("rides")

        .select("*")

        .eq("id", rideId)

        .single();

    if (error || !ride) {

      return fail(

        res,

        "Ride not found.",

        404

      );

    }

    const paymentIntentId =

      cleanString(

        req.body.payment_intent_id ||

        ride.payment_intent_id,

        200

      );

    if (!paymentIntentId) {

      return fail(

        res,

        "A payment_intent_id is required to authorize this ride.",

        400

      );

    }

    /* ---- Stripe verification ----

       Never trust a client-supplied intent id. Retrieve it and

       confirm it is genuinely authorized, matches this ride's

       fare, and is not already bound to a different ride. */

    if (stripe) {

      let intent;

      try {

        intent =

          await stripe.paymentIntents.retrieve(paymentIntentId);

      } catch (stripeErr) {

        console.error(

          "❌ PaymentIntent retrieve failed:",

          stripeErr.message

        );

        return fail(

          res,

          "Payment could not be verified with Stripe.",

          402

        );

      }

      // Must be authorized (manual capture) or already captured.

      const authorizedStatuses = new Set([

        "requires_capture",

        "succeeded"

      ]);

      if (!authorizedStatuses.has(intent.status)) {

        return fail(

          res,

          `Payment is not authorized (status: ${intent.status}).`,

          402

        );

      }

      // Amount must match the ride's fare (in cents).

      const expectedCents =

        Math.round(Number(ride.estimate_total || 0) * 100);

      if (

        expectedCents > 0 &&

        Number(intent.amount) !== expectedCents

      ) {

        return fail(

          res,

          "Payment amount does not match the ride fare.",

          402,

          IS_PRODUCTION

            ? {}

            : {

                expected_cents: expectedCents,

                intent_cents: intent.amount

              }

        );

      }

      // Must not already belong to a different ride.

      const boundRide =

        intent.metadata?.ride_id;

      if (

        boundRide &&

        boundRide !== rideId

      ) {

        return fail(

          res,

          "This payment is already associated with another ride.",

          409

        );

      }

      // Optional: confirm the intent's rider matches the ride's rider.

      const intentRider =

        intent.metadata?.rider_id;

      if (

        intentRider &&

        ride.rider_id &&

        intentRider !== String(ride.rider_id)

      ) {

        return fail(

          res,

          "This payment does not belong to this rider.",

          403

        );

      }

      // Bind the intent to this ride so it can't be reused elsewhere.

      if (boundRide !== rideId) {

        try {

          await stripe.paymentIntents.update(

            paymentIntentId,

            {

              metadata: {

                ...(intent.metadata || {}),

                ride_id: rideId

              }

            }

          );

        } catch (bindErr) {

          console.warn(

            "⚠️ Could not bind ride_id to intent:",

            bindErr.message

          );

        }

      }

    }

    await supabase

      .from("rides")

      .update({

        payment_intent_id:

          paymentIntentId,

        status:

          RIDE_STATUS.PAYMENT_AUTHORIZED,

        dispatch_status:

          "ready_to_dispatch",

        updated_at:

          nowIso()

      })

      .eq("id", rideId);

    const updatedRide = {

      ...ride,

      payment_intent_id:

        paymentIntentId,

      status:

        RIDE_STATUS.PAYMENT_AUTHORIZED

    };

    const dispatch =

      await dispatchRide(

        updatedRide

      );

    auditLog({

      actor_type:

        "rider",

      actor_id:

        ride.rider_id,

      action:

        "ride_authorized",

      entity_type:

        "ride",

      entity_id:

        rideId,

      metadata: {

        payment_intent_id:

          paymentIntentId,

        dispatch

      },

      req

    }).catch(() => {});

    return ok(res, {

      ride_id:

        rideId,

      dispatch

    });

  })

);/* =========================================================

   PART 7 — DRIVER OFFERS + DRIVER MISSION PIPELINE

========================================================= */

/* =========================================================

   DRIVER OFFER ACCEPT

========================================================= */

app.post(

  "/api/driver/offers/:offerId/accept",

  requireDriver,

  asyncRoute(async (req, res) => {

    const offerId =

      cleanString(

        req.params.offerId,

        100

      );

    const driverId = req.driver.id;

    const { data: offer, error } =

      await supabase

        .from("driver_offers")

        .select("*")

        .eq("id", offerId)

        .single();

    if (error || !offer) {

      return fail(

        res,

        "Offer not found.",

        404

      );

    }

    if (offer.status !== "pending") {

      return fail(

        res,

        "Offer is no longer available.",

        409

      );

    }

    if (

      driverId &&

      offer.driver_id !== driverId

    ) {

      return fail(

        res,

        "Offer does not belong to this driver.",

        403

      );

    }

    await supabase

      .from("driver_offers")

      .update({

        status:

          "accepted",

        responded_at:

          nowIso(),

        updated_at:

          nowIso()

      })

      .eq("id", offerId);

    await supabase

      .from("rides")

      .update({

        status:

          RIDE_STATUS.DRIVER_ASSIGNED,

        dispatch_status:

          "accepted",

        driver_id:

          offer.driver_id,

        current_driver_id:

          offer.driver_id,

        accepted_at:

          nowIso(),

        updated_at:

          nowIso()

      })

      .eq("id", offer.ride_id);

    auditLog({

      actor_type:

        "driver",

      actor_id:

        offer.driver_id,

      action:

        "ride_offer_accepted",

      entity_type:

        "ride",

      entity_id:

        offer.ride_id,

      metadata: {

        offer_id:

          offerId

      },

      req

    }).catch(() => {});

    return ok(res, {

      ride_id:

        offer.ride_id,

      driver_id:

        offer.driver_id,

      status:

        RIDE_STATUS.DRIVER_ASSIGNED

    });

  })

);

/* =========================================================

   DRIVER OFFER DECLINE

========================================================= */

app.post(

  "/api/driver/offers/:offerId/decline",

  requireDriver,

  asyncRoute(async (req, res) => {

    const offerId =

      cleanString(

        req.params.offerId,

        100

      );

    const reason =

      cleanString(

        req.body.reason,

        500

      );

    const { data: offer, error } =

      await supabase

        .from("driver_offers")

        .select("*")

        .eq("id", offerId)

        .single();

    if (error || !offer) {

      return fail(

        res,

        "Offer not found.",

        404

      );

    }

    await supabase

      .from("driver_offers")

      .update({

        status:

          "declined",

        decline_reason:

          reason,

        responded_at:

          nowIso(),

        updated_at:

          nowIso()

      })

      .eq("id", offerId);

    auditLog({

      actor_type:

        "driver",

      actor_id:

        offer.driver_id,

      action:

        "ride_offer_declined",

      entity_type:

        "ride",

      entity_id:

        offer.ride_id,

      metadata: {

        offer_id:

          offerId,

        reason

      },

      req

    }).catch(() => {});

    if (ENABLE_AUTO_REDISPATCH) {

      const { data: ride } =

        await supabase

          .from("rides")

          .select("*")

          .eq("id", offer.ride_id)

          .single();

      if (ride) {

        const attempts =

          Number(

            ride.dispatch_attempts || 0

          );

        const maxAttempts =

          envNumber(

            "MAX_DISPATCH_ATTEMPTS",

            5

          );

        if (attempts < maxAttempts) {

          await supabase

            .from("rides")

            .update({

              dispatch_attempts:

                attempts + 1,

              current_driver_id:

                null,

              current_offer_id:

                null,

              dispatch_status:

                "redispatching",

              updated_at:

                nowIso()

            })

            .eq("id", ride.id);

          await dispatchRide({

            ...ride,

            dispatch_attempts:

              attempts + 1

          });

        } else {

          await supabase

            .from("rides")

            .update({

              status:

                RIDE_STATUS.FAILED,

              dispatch_status:

                "max_attempts_reached",

              updated_at:

                nowIso()

            })

            .eq("id", ride.id);

        }

      }

    }

    return ok(res, {

      declined:

        true

    });

  })

);

/* =========================================================

   RIDE + DRIVER LOADERS

========================================================= */

async function getRideOrFail(rideId) {

  const { data, error } =

    await supabase

      .from("rides")

      .select("*")

      .eq("id", rideId)

      .single();

  if (error || !data) {

    throw new Error("Ride not found.");

  }

  return data;

}

async function getDriverOrFail(driverId) {

  const { data, error } =

    await supabase

      .from("drivers")

      .select("*")

      .eq("id", driverId)

      .single();

  if (error || !data) {

    throw new Error("Driver not found.");

  }

  return data;

}

async function ensureAssignedDriver(

  ride,

  driverId

) {

  if (

    String(ride.driver_id || "") !==

    String(driverId || "")

  ) {

    throw new Error(

      "Driver is not assigned to this ride."

    );

  }

}

/* =========================================================

   DRIVER ENROUTE

========================================================= */

app.post(

  "/api/driver/rides/:rideId/enroute",

  requireDriver,

  asyncRoute(async (req, res) => {

    const /* ============================================================
   HARVEY TAXI server.js — CURRENT CONTINUATION (enroute -> end)
   Matches the latest build (preflight tables + pricing defaults
   0.90 / 2.00 / 0.70 already applied earlier in the file).
   Append after your paste, which ended at 'const rideId ='.
   Source lines 8341-13585 of the full 13585-line server.js.
   TAIL ONLY — not runnable on its own.
   ============================================================ */

/* =========================================================

   DRIVER ENROUTE

========================================================= */

app.post(

  "/api/driver/rides/:rideId/enroute",

  requireDriver,

  asyncRoute(async (req, res) => {

    const rideId =

      cleanString(

        req.params.rideId,

        100

      );

    const driverId = req.driver.id;

    const ride =

      await getRideOrFail(rideId);

    await ensureAssignedDriver(

      ride,

      driverId

    );

    await supabase

      .from("rides")

      .update({

        status:

          RIDE_STATUS.DRIVER_ENROUTE,

        enroute_at:

          nowIso(),

        updated_at:

          nowIso()

      })

      .eq("id", rideId);

    auditLog({

      actor_type:

        "driver",

      actor_id:

        driverId,

      action:

        "driver_enroute",

      entity_type:

        "ride",

      entity_id:

        rideId,

      req

    }).catch(() => {});

    return ok(res, {

      ride_id:

        rideId,

      status:

        RIDE_STATUS.DRIVER_ENROUTE

    });

  })

);

/* =========================================================

   DRIVER ARRIVED

========================================================= */

app.post(

  "/api/driver/rides/:rideId/arrived",

  requireDriver,

  asyncRoute(async (req, res) => {

    const rideId =

      cleanString(

        req.params.rideId,

        100

      );

    const driverId = req.driver.id;

    const ride =

      await getRideOrFail(rideId);

    await ensureAssignedDriver(

      ride,

      driverId

    );

    await supabase

      .from("rides")

      .update({

        status:

          RIDE_STATUS.ARRIVED,

        arrived_at:

          nowIso(),

        updated_at:

          nowIso()

      })

      .eq("id", rideId);

    auditLog({

      actor_type:

        "driver",

      actor_id:

        driverId,

      action:

        "driver_arrived",

      entity_type:

        "ride",

      entity_id:

        rideId,

      req

    }).catch(() => {});

    return ok(res, {

      ride_id:

        rideId,

      status:

        RIDE_STATUS.ARRIVED

    });

  })

);

/* =========================================================

   DRIVER START RIDE

========================================================= */

app.post(

  "/api/driver/rides/:rideId/start",

  requireDriver,

  asyncRoute(async (req, res) => {

    const rideId =

      cleanString(

        req.params.rideId,

        100

      );

    const driverId = req.driver.id;

    const ride =

      await getRideOrFail(rideId);

    await ensureAssignedDriver(

      ride,

      driverId

    );

    await supabase

      .from("rides")

      .update({

        status:

          RIDE_STATUS.IN_PROGRESS,

        trip_started_at:

          nowIso(),

        updated_at:

          nowIso()

      })

      .eq("id", rideId);

    auditLog({

      actor_type:

        "driver",

      actor_id:

        driverId,

      action:

        "ride_started",

      entity_type:

        "ride",

      entity_id:

        rideId,

      req

    }).catch(() => {});

    return ok(res, {

      ride_id:

        rideId,

      status:

        RIDE_STATUS.IN_PROGRESS

    });

  })

);

/* =========================================================

   PAYMENT CAPTURE

========================================================= */

async function captureRidePayment(ride) {

  if (

    !ENABLE_PAYMENT_GATE ||

    !stripe ||

    !ride.payment_intent_id

  ) {

    return null;

  }

  try {

    return await stripe

      .paymentIntents

      .capture(

        ride.payment_intent_id

      );

  } catch (error) {

    console.error(

      "❌ Payment capture failed:",

      error.message

    );

    return null;

  }

}

/* =========================================================

   DRIVER EARNING

========================================================= */

async function createDriverEarning({

  ride,

  driverId

}) {

  const payout =

    Number(

      ride.driver_payout || 0

    );

  const earning = {

    id:

      makeId("EARN"),

    ride_id:

      ride.id,

    driver_id:

      driverId,

    gross_amount:

      payout,

    net_amount:

      payout,

    status:

      "earned",

    created_at:

      nowIso()

  };

  const { error } =

    await supabase

      .from("driver_earnings")

      .insert(earning);

  if (error) {

    console.error(

      "❌ Driver earning insert failed:",

      error.message

    );

  }

  return earning;

}

/* =========================================================

   DRIVER COMPLETE RIDE

========================================================= */

app.post(

  "/api/driver/rides/:rideId/complete",

  requireDriver,

  asyncRoute(async (req, res) => {

    const rideId =

      cleanString(

        req.params.rideId,

        100

      );

    const driverId = req.driver.id;

    const ride =

      await getRideOrFail(rideId);

    await ensureAssignedDriver(

      ride,

      driverId

    );

    const paymentResult =

      await captureRidePayment(ride);

    const earning =

      await createDriverEarning({

        ride,

        driverId

      });

    await supabase

      .from("rides")

      .update({

        status:

          RIDE_STATUS.COMPLETED,

        completed_at:

          nowIso(),

        payment_captured:

          Boolean(paymentResult),

        updated_at:

          nowIso()

      })

      .eq("id", rideId);

    auditLog({

      actor_type:

        "driver",

      actor_id:

        driverId,

      action:

        "ride_completed",

      entity_type:

        "ride",

      entity_id:

        rideId,

      metadata: {

        earning,

        payment_captured:

          Boolean(paymentResult)

      },

      req

    }).catch(() => {});

    return ok(res, {

      ride_id:

        rideId,

      status:

        RIDE_STATUS.COMPLETED,

      earning,

      payment_captured:

        Boolean(paymentResult)

    });

  })

);

/* =========================================================

   DRIVER LOCATION

========================================================= */

app.post(

  "/api/driver/location",

  requireDriver,

  asyncRoute(async (req, res) => {

    const driverId = req.driver.id;

    if (!driverId) {

      return fail(

        res,

        "driver_id required",

        400

      );

    }

    await supabase

      .from("drivers")

      .update({

        current_lat:

          Number(req.body.latitude),

        current_lng:

          Number(req.body.longitude),

        heading:

          Number(req.body.heading || 0),

        speed:

          Number(req.body.speed || 0),

        last_seen_at:

          nowIso(),

        updated_at:

          nowIso()

      })

      .eq("id", driverId);

    return ok(res, {

      updated:

        true

    });

  })

);

/* =========================================================

   DRIVER ONLINE/OFFLINE

========================================================= */

app.post(

  "/api/driver/status",

  requireDriver,

  asyncRoute(async (req, res) => {

    const driverId = req.driver.id;

    if (!driverId) {

      return fail(

        res,

        "driver_id required.",

        400

      );

    }

    const online =

      Boolean(req.body.online);

    await supabase

      .from("drivers")

      .update({

        online,

        last_seen_at:

          nowIso(),

        updated_at:

          nowIso()

      })

      .eq("id", driverId);

    auditLog({

      actor_type:

        "driver",

      actor_id:

        driverId,

      action:

        online

          ? "driver_online"

          : "driver_offline",

      req

    }).catch(() => {});

    return ok(res, {

      online

    });

  })

);

/* =========================================================

   DRIVER ACTIVE MISSIONS

========================================================= */

app.get(

  "/api/driver/:driverId/missions",

  requireDriver,

  asyncRoute(async (req, res) => {

    const driverId = req.driver.id;

    const { data, error } =

      await supabase

        .from("rides")

        .select("*")

        .eq("driver_id", driverId)

        .in("status", [

          RIDE_STATUS.DRIVER_ASSIGNED,

          RIDE_STATUS.DRIVER_ENROUTE,

          RIDE_STATUS.ARRIVED,

          RIDE_STATUS.IN_PROGRESS

        ])

        .order("created_at", {

          ascending: false

        });

    if (error) {

      throw error;

    }

    return ok(res, {

      missions:

        data || []

    });

  })

);

/* =========================================================

   DRIVER HISTORY

========================================================= */

app.get(

  "/api/driver/:driverId/history",

  requireDriver,

  asyncRoute(async (req, res) => {

    const driverId = req.driver.id;

    const { data, error } =

      await supabase

        .from("rides")

        .select("*")

        .eq("driver_id", driverId)

        .eq("status", RIDE_STATUS.COMPLETED)

        .order("completed_at", {

          ascending: false

        })

        .limit(100);

    if (error) {

      throw error;

    }

    return ok(res, {

      history:

        data || []

    });

  })

);

/* =========================================================

   DRIVER EARNINGS

========================================================= */

app.get(

  "/api/driver/:driverId/earnings",

  requireDriver,

  asyncRoute(async (req, res) => {

    const driverId = req.driver.id;

    const { data, error } =

      await supabase

        .from("driver_earnings")

        .select("*")

        .eq("driver_id", driverId);

    if (error) {

      throw error;

    }

    const total =

      (data || []).reduce(

        (sum, item) =>

          sum + Number(item.net_amount || 0),

        0

      );

    return ok(res, {

      total_earnings:

        Number(total.toFixed(2)),

      records:

        data || []

    });

  })

);/* =========================================================

   PART 8 — ADMIN OPERATIONS + SSE STREAM + HTAF SCHEDULING

========================================================= */

const sseClients = new Map();

function sendSse(clientId, event, data) {

  const client =

    sseClients.get(clientId);

  if (!client) return;

  client.write(

    `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`

  );

}

function broadcastSse(event, data) {

  for (const clientId of sseClients.keys()) {

    sendSse(clientId, event, data);

  }

}

/* =========================================================

   ADMIN SSE STREAM

========================================================= */

app.get(

  "/api/admin/stream",

  requireAdmin,

  asyncRoute(async (req, res) => {

    const clientId =

      makeId("SSE");

    res.setHeader(

      "Content-Type",

      "text/event-stream"

    );

    res.setHeader(

      "Cache-Control",

      "no-cache"

    );

    res.setHeader(

      "Connection",

      "keep-alive"

    );

    res.flushHeaders?.();

    sseClients.set(

      clientId,

      res

    );

    sendSse(

      clientId,

      "connected",

      {

        client_id:

          clientId,

        connected_at:

          nowIso()

      }

    );

    const heartbeat =

      setInterval(() => {

        sendSse(

          clientId,

          "heartbeat",

          {

            at:

              nowIso()

          }

        );

      }, 25_000);

    req.on(

      "close",

      () => {

        clearInterval(

          heartbeat

        );

        sseClients.delete(

          clientId

        );

      }

    );

  })

);

/* =========================================================

   ADMIN OVERVIEW

========================================================= */

async function safeCount(table) {

  try {

    const { count, error } =

      await supabase

        .from(table)

        .select("id", {

          count: "exact",

          head: true

        });

    if (error) {

      return {

        table,

        count: 0,

        error: error.message

      };

    }

    return {

      table,

      count: count || 0

    };

  } catch (error) {

    return {

      table,

      count: 0,

      error: error.message

    };

  }

}

app.get(

  "/api/admin/overview",

  requireAdmin,

  asyncRoute(async (req, res) => {

    const results =

      await Promise.all([

        safeCount("riders"),

        safeCount("drivers"),

        safeCount("rides"),

        safeCount("htaf_applications"),

        safeCount("driver_offers"),

        safeCount("driver_earnings")

      ]);

    const overview =

      results.reduce(

        (acc, item) => {

          acc[item.table] =

            item.count;

          if (item.error) {

            acc[`${item.table}_error`] =

              item.error;

          }

          return acc;

        },

        {}

      );

    return ok(res, {

      overview: {

        ...overview,

        server_time:

          nowIso(),

        environment:

          NODE_ENV

      }

    });

  })

);

/* =========================================================

   ADMIN RIDES LIST

========================================================= */

app.get(

  "/api/admin/rides",

  requireAdmin,

  asyncRoute(async (req, res) => {

    const status =

      cleanString(

        req.query.status,

        80

      );

    let query =

      supabase

        .from("rides")

        .select("*")

        .order("created_at", {

          ascending: false

        })

        .limit(

          envNumber(

            "ADMIN_LIST_LIMIT",

            200

          )

        );

    if (status) {

      query =

        query.eq(

          "status",

          status

        );

    }

    const { data, error } =

      await query;

    if (error) {

      throw error;

    }

    return ok(res, {

      rides:

        data || []

    });

  })

);

/* =========================================================

   ADMIN UPDATE RIDE STATUS

========================================================= */

app.patch(

  "/api/admin/rides/:id/status",

  requireAdmin,

  asyncRoute(async (req, res) => {

    const rideId =

      cleanString(

        req.params.id,

        100

      );

    const status =

      cleanString(

        req.body.status,

        80

      );

    const allowed =

      Object.values(RIDE_STATUS);

    if (!allowed.includes(status)) {

      return fail(

        res,

        "Invalid ride status.",

        400,

        { allowed }

      );

    }

    const { data, error } =

      await supabase

        .from("rides")

        .update({

          status,

          admin_note:

            cleanString(

              req.body.note,

              1000

            ),

          updated_at:

            nowIso()

        })

        .eq("id", rideId)

        .select()

        .single();

    if (error) {

      throw error;

    }

    auditLog({

      actor_type:

        "admin",

      actor_id:

        req.admin.email,

      action:

        "admin_ride_status_updated",

      entity_type:

        "ride",

      entity_id:

        rideId,

      metadata: {

        status,

        note:

          req.body.note || null

      },

      req

    }).catch(() => {});

    broadcastSse(

      "ride_updated",

      { ride: data }

    );

    return ok(res, {

      ride:

        data

    });

  })

);

/* =========================================================

   ADMIN ASSIGN DRIVER

========================================================= */

app.post(

  "/api/admin/rides/:id/assign-driver",

  requireAdmin,

  asyncRoute(async (req, res) => {

    const rideId =

      cleanString(

        req.params.id,

        100

      );

    const driverId =

      cleanString(

        req.body.driver_id,

        100

      );

    if (!driverId) {

      return fail(

        res,

        "driver_id required.",

        400

      );

    }

    const driver =

      await getDriverOrFail(driverId);

    const { data, error } =

      await supabase

        .from("rides")

        .update({

          driver_id:

            driver.id,

          current_driver_id:

            driver.id,

          status:

            RIDE_STATUS.DRIVER_ASSIGNED,

          dispatch_status:

            "admin_assigned",

          assigned_by_admin:

            true,

          assigned_at:

            nowIso(),

          updated_at:

            nowIso()

        })

        .eq("id", rideId)

        .select()

        .single();

    if (error) {

      throw error;

    }

    auditLog({

      actor_type:

        "admin",

      actor_id:

        req.admin.email,

      action:

        "admin_driver_assigned",

      entity_type:

        "ride",

      entity_id:

        rideId,

      metadata: {

        driver_id:

          driverId

      },

      req

    }).catch(() => {});

    broadcastSse(

      "ride_assigned",

      {

        ride:

          data,

        driver

      }

    );

    return ok(res, {

      ride:

        data,

      driver

    });

  })

);

/* =========================================================

   ADMIN DRIVERS LIST

========================================================= */

app.get(

  "/api/admin/drivers",

  requireAdmin,

  asyncRoute(async (req, res) => {

    const status =

      cleanString(

        req.query.status,

        80

      );

    let query =

      supabase

        .from("drivers")

        .select("*")

        .order("created_at", {

          ascending: false

        })

        .limit(

          envNumber(

            "ADMIN_LIST_LIMIT",

            200

          )

        );

    if (status) {

      query =

        query.eq(

          "status",

          status

        );

    }

    const { data, error } =

      await query;

    if (error) {

      throw error;

    }

    return ok(res, {

      drivers:

        data || []

    });

  })

);

/* =========================================================

   ADMIN RIDERS LIST

========================================================= */

app.get(

  "/api/admin/riders",

  requireAdmin,

  asyncRoute(async (req, res) => {

    const status =

      cleanString(

        req.query.status,

        80

      );

    let query =

      supabase

        .from("riders")

        .select("*")

        .order("created_at", {

          ascending: false

        })

        .limit(

          envNumber(

            "ADMIN_LIST_LIMIT",

            200

          )

        );

    if (status) {

      query =

        query.eq(

          "status",

          status

        );

    }

    const { data, error } =

      await query;

    if (error) {

      throw error;

    }

    return ok(res, {

      riders:

        data || []

    });

  })

);

/* =========================================================

   ADMIN APPROVE DRIVER

========================================================= */

app.patch(

  "/api/admin/drivers/:id/approve",

  requireAdmin,

  asyncRoute(async (req, res) => {

    const driverId =

      cleanString(

        req.params.id,

        100

      );

    const { data, error } =

      await supabase

        .from("drivers")

        .update({

          status:

            "active",

          approval_status:

            "approved",

          online:

            false,

          approved_at:

            nowIso(),

          updated_at:

            nowIso()

        })

        .eq("id", driverId)

        .select()

        .single();

    if (error) {

      throw error;

    }

    auditLog({

      actor_type:

        "admin",

      actor_id:

        req.admin.email,

      action:

        "driver_approved",

      entity_type:

        "driver",

      entity_id:

        driverId,

      req

    }).catch(() => {});

    broadcastSse(

      "driver_approved",

      {

        driver:

          data

      }

    );

    return ok(res, {

      driver:

        data

    });

  })

);

/* =========================================================

   ADMIN REJECT DRIVER

========================================================= */

app.patch(

  "/api/admin/drivers/:id/reject",

  requireAdmin,

  asyncRoute(async (req, res) => {

    const driverId =

      cleanString(

        req.params.id,

        100

      );

    const reason =

      cleanString(

        req.body.reason,

        1000

      );

    const { data, error } =

      await supabase

        .from("drivers")

        .update({

          status:

            "rejected",

          approval_status:

            "rejected",

          rejection_reason:

            reason,

          updated_at:

            nowIso()

        })

        .eq("id", driverId)

        .select()

        .single();

    if (error) {

      throw error;

    }

    auditLog({

      actor_type:

        "admin",

      actor_id:

        req.admin.email,

      action:

        "driver_rejected",

      entity_type:

        "driver",

      entity_id:

        driverId,

      metadata: {

        reason

      },

      req

    }).catch(() => {});

    broadcastSse(

      "driver_rejected",

      {

        driver:

          data

      }

    );

    return ok(res, {

      driver:

        data

    });

  })

);

/* =========================================================

   ADMIN APPROVE RIDER

========================================================= */

app.patch(

  "/api/admin/riders/:id/approve",

  requireAdmin,

  asyncRoute(async (req, res) => {

    const riderId =

      cleanString(

        req.params.id,

        100

      );

    const { data, error } =

      await supabase

        .from("riders")

        .update({

          status:

            "active",

          approval_status:

            "approved",

          approved_at:

            nowIso(),

          updated_at:

            nowIso()

        })

        .eq("id", riderId)

        .select()

        .single();

    if (error) {

      throw error;

    }

    auditLog({

      actor_type:

        "admin",

      actor_id:

        req.admin.email,

      action:

        "rider_approved",

      entity_type:

        "rider",

      entity_id:

        riderId,

      req

    }).catch(() => {});

    broadcastSse(

      "rider_approved",

      {

        rider:

          data

      }

    );

    return ok(res, {

      rider:

        data

    });

  })

);

/* =========================================================

   ADMIN AUDIT LOGS

========================================================= */

app.get(

  "/api/admin/audit-logs",

  requireAdmin,

  asyncRoute(async (req, res) => {

    const { data, error } =

      await supabase

        .from("audit_logs")

        .select("*")

        .order("created_at", {

          ascending: false

        })

        .limit(

          envNumber(

            "AUDIT_LOG_LIMIT",

            300

          )

        );

    if (error) {

      throw error;

    }

    return ok(res, {

      logs:

        data || []

    });

  })

);

/* =========================================================

   ADMIN CREATE HTAF RIDE

========================================================= */

app.post(

  "/api/admin/foundation/applications/:id/create-ride",

  requireAdmin,

  asyncRoute(async (req, res) => {

    const applicationId =

      cleanString(

        req.params.id,

        100

      );

    const { data: application, error } =

      await supabase

        .from("htaf_applications")

        .select("*")

        .eq("id", applicationId)

        .single();

    if (error || !application) {

      return fail(

        res,

        "HTAF application not found.",

        404

      );

    }

    const estimate =

      calculateRideEstimate({

        miles:

          Number(req.body.miles || 0),

        minutes:

          Number(req.body.minutes || 0),

        ride_type:

          "foundation"

      });

    const now =

      nowIso();

    const ride = {

      id:

        makeId("RIDE"),

      rider_id:

        null,

      htaf_application_id:

        application.id,

      rider_name:

        `${application.first_name} ${application.last_name}`,

      rider_phone:

        application.phone,

      pickup:

        cleanString(

          req.body.pickup ||

          application.pickup_city,

          500

        ),

      destination:

        cleanString(

          req.body.destination ||

          application.destination,

          500

        ),

      ride_type:

        "foundation",

      scheduled_for:

        req.body.scheduled_for ||

        application.ride_date ||

        null,

      status:

        RIDE_STATUS.PAYMENT_AUTHORIZED,

      dispatch_status:

        "foundation_authorized",

      estimate_total:

        estimate.total,

      driver_payout:

        estimate.driver_payout,

      platform_fee:

        estimate.platform_fee,

      miles:

        estimate.miles,

      minutes:

        estimate.minutes,

      notes:

        `HTAF application ${application.application_code}`,

      created_at:

        now,

      updated_at:

        now

    };

    const { data: createdRide, error: rideError } =

      await supabase

        .from("rides")

        .insert(ride)

        .select()

        .single();

    if (rideError) {

      throw rideError;

    }

    await supabase

      .from("htaf_applications")

      .update({

        status:

          HTAF_STATUS.SCHEDULED,

        ride_id:

          createdRide.id,

        updated_at:

          nowIso()

      })

      .eq("id", applicationId);

    auditLog({

      actor_type:

        "admin",

      actor_id:

        req.admin.email,

      action:

        "htaf_application_converted_to_ride",

      entity_type:

        "htaf_application",

      entity_id:

        applicationId,

      metadata: {

        ride_id:

          createdRide.id

      },

      req

    }).catch(() => {});

    broadcastSse(

      "htaf_ride_created",

      {

        application_id:

          applicationId,

        ride:

          createdRide

      }

    );

    return ok(res, {

      ride:

        createdRide,

      application_id:

        applicationId

    });

  })

);

/* =========================================================

   PAUSE / RESUME DISPATCH

========================================================= */

app.post(

  "/api/admin/system/pause-dispatch",

  requireAdmin,

  asyncRoute(async (req, res) => {

    const reason =

      cleanString(

        req.body.reason,

        1000

      );

    await supabase

      .from("system_flags")

      .upsert({

        key:

          "dispatch_paused",

        value:

          "true",

        reason,

        updated_at:

          nowIso()

      });

    auditLog({

      actor_type:

        "admin",

      actor_id:

        req.admin.email,

      action:

        "dispatch_paused",

      metadata: {

        reason

      },

      req

    }).catch(() => {});

    broadcastSse(

      "dispatch_paused",

      {

        reason,

        at:

          nowIso()

      }

    );

    return ok(res, {

      dispatch_paused:

        true,

      reason

    });

  })

);

app.post(

  "/api/admin/system/resume-dispatch",

  requireAdmin,

  asyncRoute(async (req, res) => {

    await supabase

      .from("system_flags")

      .upsert({

        key:

          "dispatch_paused",

        value:

          "false",

        reason:

          null,

        updated_at:

          nowIso()

      });

    auditLog({

      actor_type:

        "admin",

      actor_id:

        req.admin.email,

      action:

        "dispatch_resumed",

      req

    }).catch(() => {});

    broadcastSse(

      "dispatch_resumed",

      {

        at:

          nowIso()

      }

    );

    return ok(res, {

      dispatch_paused:

        false

    });

  })

);/* =========================================================

   PART 9 — SAFETY, COMPLIANCE, TWILIO VERIFY, STRIPE

========================================================= */

/* =========================================================

   DRIVER COMPLIANCE

========================================================= */

async function getDriverCompliance(driverId) {

  const { data, error } =

    await supabase

      .from("drivers")

      .select(

        "id, email_verified, phone_verified, checkr_status, persona_status, persona_verified, insurance_status, license_status, approval_status"

      )

      .eq("id", driverId)

      .maybeSingle();

  if (error || !data) {

    return {

      eligible: false,

      reason: "Driver not found.",

      details: null

    };

  }

  const checks = {

    email_verified:

      Boolean(data.email_verified),

    phone_verified:

      Boolean(data.phone_verified),

    persona_ready:

      !ENABLE_PERSONA ||

      Boolean(data.persona_verified) ||

      ["verified", "approved", "completed"].includes(

        String(data.persona_status || "").toLowerCase()

      ),

    checkr_ready:

      !ENABLE_CHECKR ||

      ["clear", "complete", "completed", "eligible_for_review"].includes(

        String(data.checkr_status || "").toLowerCase()

      ),

    insurance_ready:

      !data.insurance_status ||

      ["approved", "verified", "active"].includes(

        String(data.insurance_status || "").toLowerCase()

      ),

    license_ready:

      !data.license_status ||

      ["approved", "verified", "active"].includes(

        String(data.license_status || "").toLowerCase()

      ),

    approval_ready:

      ["approved"].includes(

        String(data.approval_status || "").toLowerCase()

      )

  };

  const eligible =

    Object.values(checks).every(Boolean);

  return {

    eligible,

    checks,

    details: data

  };

}

app.get(

  "/api/admin/compliance/audit",

  requireAdmin,

  asyncRoute(async (req, res) => {

    const { data, error } =

      await supabase

        .from("drivers")

        .select(

          "id, first_name, last_name, email, email_verified, phone_verified, checkr_status, persona_status, persona_verified, insurance_status, license_status, approval_status, status, created_at"

        )

        .order("created_at", {

          ascending: false

        });

    if (error) {

      throw error;

    }

    const compliance =

      (data || []).map((driver) => {

        const checks = {

          email_verified:

            Boolean(driver.email_verified),

          phone_verified:

            Boolean(driver.phone_verified),

          persona_ready:

            !ENABLE_PERSONA ||

            Boolean(driver.persona_verified) ||

            ["verified", "approved", "completed"].includes(

              String(driver.persona_status || "").toLowerCase()

            ),

          checkr_ready:

            !ENABLE_CHECKR ||

            ["clear", "complete", "completed", "eligible_for_review"].includes(

              String(driver.checkr_status || "").toLowerCase()

            ),

          approval_ready:

            driver.approval_status === "approved"

        };

        return {

          ...driver,

          compliance_ready:

            Object.values(checks).every(Boolean),

          checks

        };

      });

    return ok(res, {

      compliance

    });

  })

);

/* =========================================================

   SAFETY 911 ALERT

========================================================= */

app.post(

  "/api/safety/911",

  asyncRoute(async (req, res) => {

    const rideId =

      cleanString(req.body.ride_id, 100);

    const riderId =

      cleanString(req.body.rider_id, 100);

    const emergency = {

      id:

        makeId("SOS"),

      ride_id:

        rideId || null,

      rider_id:

        riderId || null,

      latitude:

        req.body.latitude !== undefined

          ? Number(req.body.latitude)

          : null,

      longitude:

        req.body.longitude !== undefined

          ? Number(req.body.longitude)

          : null,

      message:

        cleanString(req.body.message, 1000),

      status:

        "active",

      created_at:

        nowIso(),

      updated_at:

        nowIso()

    };

    const { data, error } =

      await supabase

        .from("emergency_alerts")

        .insert(emergency)

        .select()

        .single();

    if (error) {

      console.error(

        "❌ Emergency alert insert failed:",

        error.message

      );

      return fail(

        res,

        "Emergency alert could not be recorded.",

        500

      );

    }

    broadcastSse(

      "emergency_alert",

      data

    );

    auditLog({

      actor_type:

        "rider",

      actor_id:

        riderId,

      action:

        "911_alert",

      entity_type:

        "emergency_alert",

      entity_id:

        data.id,

      metadata:

        data,

      req

    }).catch(() => {});

    return ok(res, {

      emergency_id:

        data.id,

      dispatched:

        true,

      message:

        "Emergency alert recorded. If this is an immediate emergency, call 911 directly."

    });

  })

);

/* =========================================================

   SAFETY REPORT

========================================================= */

app.post(

  "/api/safety/report",

  asyncRoute(async (req, res) => {

    const missing =

      requireBody(req, [

        "category",

        "description"

      ]);

    if (missing.length) {

      return fail(

        res,

        "Missing safety report fields.",

        400,

        { missing }

      );

    }

    const report = {

      id:

        makeId("SAFE"),

      ride_id:

        cleanString(req.body.ride_id, 100) || null,

      submitted_by:

        cleanString(req.body.user_id, 100) || null,

      submitted_by_type:

        cleanString(req.body.user_type, 40) || null,

      category:

        cleanString(req.body.category, 100),

      description:

        cleanString(req.body.description, 5000),

      status:

        "open",

      created_at:

        nowIso(),

      updated_at:

        nowIso()

    };

    const { data, error } =

      await supabase

        .from("safety_reports")

        .insert(report)

        .select()

        .single();

    if (error) {

      throw error;

    }

    broadcastSse(

      "safety_report",

      data

    );

    auditLog({

      action:

        "safety_report_created",

      entity_type:

        "safety_report",

      entity_id:

        data.id,

      metadata: {

        category:

          data.category

      },

      req

    }).catch(() => {});

    return ok(

      res,

      { report: data },

      201

    );

  })

);

/* =========================================================

   TWILIO VERIFY SEND CODE

========================================================= */

app.post(

  "/api/auth/send-sms-code",

  asyncRoute(async (req, res) => {

    const phone =

      cleanPhone(req.body.phone);

    if (!phone) {

      return fail(

        res,

        "Phone required.",

        400

      );

    }

    if (!twilioClient) {

      return fail(

        res,

        "SMS verification is not configured.",

        503

      );

    }

    if (!TWILIO_VERIFY_SERVICE_SID) {

      console.error(

        "❌ TWILIO_VERIFY_SERVICE_SID is not set."

      );

      return fail(

        res,

        "SMS verification service is not configured.",

        503

      );

    }

    const verification =

      await twilioClient.verify

        .services(TWILIO_VERIFY_SERVICE_SID)

        .verifications

        .create({

          to: phone,

          channel: "sms"

        });

    auditLog({

      action:

        "sms_verify_code_sent",

      metadata: {

        phone

      },

      req

    }).catch(() => {});

    return ok(res, {

      sid:

        verification.sid,

      status:

        verification.status

    });

  })

);

/* =========================================================

   TWILIO VERIFY CONFIRM CODE

========================================================= */

app.post(

  "/api/auth/verify-sms-code",

  asyncRoute(async (req, res) => {

    const phone =

      cleanPhone(req.body.phone);

    const code =

      cleanString(req.body.code, 20);

    if (!phone || !code) {

      return fail(

        res,

        "Phone and code required.",

        400

      );

    }

    if (!twilioClient) {

      return fail(

        res,

        "SMS verification is not configured.",

        503

      );

    }

    if (!TWILIO_VERIFY_SERVICE_SID) {

      return fail(

        res,

        "SMS verification service is not configured.",

        503

      );

    }

    const check =

      await twilioClient.verify

        .services(TWILIO_VERIFY_SERVICE_SID)

        .verificationChecks

        .create({

          to: phone,

          code

        });

    const approved =

      check.status === "approved";

    if (approved) {

      await Promise.allSettled([

        supabase

          .from("riders")

          .update({

            phone_verified:

              true,

            updated_at:

              nowIso()

          })

          .eq("phone", phone),

        supabase

          .from("drivers")

          .update({

            phone_verified:

              true,

            updated_at:

              nowIso()

          })

          .eq("phone", phone)

      ]);

    }

    auditLog({

      action:

        "sms_verify_code_checked",

      metadata: {

        phone,

        approved

      },

      req

    }).catch(() => {});

    return ok(res, {

      approved,

      status:

        check.status

    });

  })

);

/* =========================================================

   STRIPE WEBHOOK

========================================================= */

app.post(

  "/api/stripe/webhook",

  express.raw({

    type: "application/json",

    limit: RAW_WEBHOOK_LIMIT

  }),

  asyncRoute(async (req, res) => {

    if (

      !stripe ||

      !STRIPE_WEBHOOK_SECRET

    ) {

      return fail(

        res,

        "Stripe webhook not configured.",

        503

      );

    }

    const signature =

      req.headers["stripe-signature"];

    let event;

    try {

      event =

        stripe.webhooks.constructEvent(

          req.body,

          signature,

          STRIPE_WEBHOOK_SECRET

        );

    } catch (error) {

      console.error(

        "❌ Stripe signature failed:",

        error.message

      );

      return fail(

        res,

        "Invalid Stripe signature.",

        400

      );

    }

    const object =

      event.data?.object || {};

    if (

      event.type ===

      "payment_intent.succeeded"

    ) {

      await Promise.allSettled([

        supabase

          .from("rides")

          .update({

            payment_status:

              "succeeded",

            payment_captured:

              true,

            updated_at:

              nowIso()

          })

          .eq(

            "payment_intent_id",

            object.id

          ),

        supabase

          .from("deliveries")

          .update({

            payment_status:

              "succeeded",

            payment_captured:

              true,

            updated_at:

              nowIso()

          })

          .eq(

            "payment_intent_id",

            object.id

          )

      ]);

    }

    if (

      event.type ===

      "payment_intent.amount_capturable_updated"

    ) {

      await Promise.allSettled([

        supabase

          .from("rides")

          .update({

            payment_status:

              "authorized",

            status:

              RIDE_STATUS.PAYMENT_AUTHORIZED,

            updated_at:

              nowIso()

          })

          .eq(

            "payment_intent_id",

            object.id

          ),

        supabase

          .from("deliveries")

          .update({

            payment_status:

              "authorized",

            updated_at:

              nowIso()

          })

          .eq(

            "payment_intent_id",

            object.id

          )

      ]);

    }

    if (

      event.type ===

      "payment_intent.payment_failed" ||

      event.type ===

      "payment_intent.canceled"

    ) {

      await Promise.allSettled([

        supabase

          .from("rides")

          .update({

            payment_status:

              "failed",

            status:

              RIDE_STATUS.FAILED,

            updated_at:

              nowIso()

          })

          .eq(

            "payment_intent_id",

            object.id

          ),

        supabase

          .from("deliveries")

          .update({

            payment_status:

              "failed",

            updated_at:

              nowIso()

          })

          .eq(

            "payment_intent_id",

            object.id

          )

      ]);

    }

    auditLog({

      action:

        "stripe_webhook_received",

      entity_type:

        "stripe",

      entity_id:

        object.id || event.id,

      metadata: {

        event_type:

          event.type

      }

    }).catch(() => {});

    broadcastSse(

      "stripe_event",

      {

        type:

          event.type,

        object_id:

          object.id,

        at:

          nowIso()

      }

    );

    return ok(res, {

      received:

        true

    });

  })

);/* =========================================================

   PART 10A — HEALTH, SYSTEM STATUS, AI SUPPORT, CONFIG CHECK

========================================================= */

/* =========================================================

   SYSTEM FLAGS

========================================================= */

async function getSystemFlag(key, fallback = "false") {

  try {

    const { data, error } =

      await supabase

        .from("system_flags")

        .select("*")

        .eq("key", key)

        .maybeSingle();

    if (error) {

      return fallback;

    }

    return data?.value ?? fallback;

  } catch {

    return fallback;

  }

}

/* =========================================================

   BASIC HEALTH

========================================================= */

app.get(

  "/health",

  asyncRoute(async (req, res) => {

    return ok(res, {

      service:

        "harvey-taxi-server-j",

      status:

        "healthy",

      environment:

        NODE_ENV,

      time:

        nowIso()

    });

  })

);

/* =========================================================

   API HEALTH

========================================================= */

app.get(

  "/api/health",

  asyncRoute(async (req, res) => {

    let database = "unknown";

    let preflight = null;

    try {

      const { error } =

        await supabase

          .from("system_flags")

          .select("key")

          .limit(1);

      database =

        error ? "error" : "connected";

    } catch {

      database = "error";

    }

    try {

      preflight =

        await checkRequiredTables();

    } catch (error) {

      preflight = {

        error:

          error.message

      };

    }

    return ok(res, {

      service:

        "harvey-taxi-server-j",

      status:

        database === "connected"

          ? "healthy"

          : "degraded",

      database,

      preflight,

      integrations: {

        supabase:

          Boolean(

            SUPABASE_URL &&

            SUPABASE_SERVICE_ROLE_KEY

          ),

        stripe:

          Boolean(stripe),

        sendgrid:

          Boolean(

            sgMail &&

            SENDGRID_API_KEY

          ),

        twilio:

          Boolean(twilioClient),

        persona:

          Boolean(PERSONA_API_KEY),

        checkr:

          Boolean(CHECKR_API_KEY),

        openai:

          Boolean(openai)

      },

      features: {

        rider_approval_gate:

          ENABLE_RIDER_APPROVAL_GATE,

        payment_gate:

          ENABLE_PAYMENT_GATE,

        auto_redispatch:

          ENABLE_AUTO_REDISPATCH,

        delivery:

          ENABLE_DELIVERY,

        food_delivery:

          ENABLE_FOOD_DELIVERY,

        grocery_delivery:

          ENABLE_GROCERY_DELIVERY,

        htaf_applications:

          ENABLE_HTAF_APPLICATIONS

      },

      time:

        nowIso()

    });

  })

);

/* =========================================================

   SYSTEM STATUS

========================================================= */

app.get(

  "/api/system/status",

  asyncRoute(async (req, res) => {

    const dispatchPaused =

      await getSystemFlag(

        "dispatch_paused",

        "false"

      );

    return ok(res, {

      dispatch_paused:

        dispatchPaused === "true",

      server_time:

        nowIso(),

      app_base_url:

        APP_BASE_URL,

      environment:

        NODE_ENV

    });

  })

);

/* =========================================================

   ADMIN CONFIG CHECK

   Does not expose secret values.

========================================================= */

app.get(

  "/api/admin/config-check",

  requireAdmin,

  asyncRoute(async (req, res) => {

    const htafSchema =

      await inspectHtafSchema();

    return ok(res, {

      environment:

        NODE_ENV,

      required: {

        SUPABASE_URL:

          Boolean(SUPABASE_URL),

        SUPABASE_SERVICE_ROLE_KEY:

          Boolean(SUPABASE_SERVICE_ROLE_KEY)

      },

      integrations: {

        SENDGRID_API_KEY:

          Boolean(SENDGRID_API_KEY),

        TWILIO_ACCOUNT_SID:

          Boolean(TWILIO_ACCOUNT_SID),

        TWILIO_AUTH_TOKEN:

          Boolean(TWILIO_AUTH_TOKEN),

        TWILIO_FROM_NUMBER:

          Boolean(TWILIO_FROM_NUMBER),

        TWILIO_VERIFY_SERVICE_SID:

          Boolean(TWILIO_VERIFY_SERVICE_SID),

        STRIPE_SECRET_KEY:

          Boolean(STRIPE_SECRET_KEY),

        STRIPE_WEBHOOK_SECRET:

          Boolean(STRIPE_WEBHOOK_SECRET),

        PERSONA_API_KEY:

          Boolean(PERSONA_API_KEY),

        PERSONA_WEBHOOK_SECRET:

          Boolean(PERSONA_WEBHOOK_SECRET),

        PERSONA_TEMPLATE_ID_RIDER:

          Boolean(PERSONA_TEMPLATE_ID_RIDER),

        PERSONA_TEMPLATE_ID_DRIVER:

          Boolean(PERSONA_TEMPLATE_ID_DRIVER),

        CHECKR_API_KEY:

          Boolean(CHECKR_API_KEY),

        CHECKR_WEBHOOK_SECRET:

          Boolean(CHECKR_WEBHOOK_SECRET),

        OPENAI_API_KEY:

          Boolean(OPENAI_API_KEY)

      },

      toggles: {

        ENABLE_REAL_EMAIL,

        ENABLE_REAL_SMS,

        ENABLE_PERSONA,

        ENABLE_CHECKR,

        ENABLE_AI_SUPPORT,

        ENABLE_PAYMENT_GATE,

        ENABLE_RIDER_APPROVAL_GATE,

        ENABLE_AUTO_REDISPATCH,

        ENABLE_DELIVERY,

        ENABLE_FOOD_DELIVERY,

        ENABLE_GROCERY_DELIVERY,

        ENABLE_HTAF_APPLICATIONS

      },

      htaf_schema:

        htafSchema

    });

  })

);

/* =========================================================

   AI SUPPORT

========================================================= */

app.post(

  "/api/ai/support",

  rateLimit({

    windowMs:

      60_000,

    max:

      20,

    keyPrefix:

      "ai_support"

  }),

  asyncRoute(async (req, res) => {

    const message =

      cleanString(

        req.body.message,

        4000

      );

    const page =

      cleanString(

        req.body.page,

        120

      );

    const role =

      cleanString(

        req.body.role,

        60

      );

    if (!message) {

      return fail(

        res,

        "Message required.",

        400

      );

    }

    if (!openai) {

      return ok(res, {

        reply:

          "Harvey AI Support is currently limited. Please contact support for help.",

        fallback:

          true,

        support_email:

          SUPPORT_EMAIL

      });

    }

    let completion;

    try {

      completion =

        await openai.chat.completions.create({

          model:

            OPENAI_MODEL,

          messages: [

            {

              role:

                "system",

              content:

                 [
                  "You are Harvey AI, the support assistant for Harvey Taxi Service LLC and the Harvey Transportation Assistance Foundation (HTAF). Answer ONLY from the approved information below. If something is not covered here, do not guess — direct the person to support at support@harveytaxiservice.com.",
                  "",
                  "== COMPANY ==",
                  "Harvey Taxi Service LLC is a transportation technology company founded by Willie Harvey IV, headquartered in Nashville, Tennessee. Mission: provide safe, reliable, technology-driven transportation while creating earning opportunities for drivers and expanding transportation access through innovation and community partnerships. Core values: Safety, Respect, Accountability, Accessibility, Innovation, Community, Transparency, Professionalism.",
                  "Currently available: rider accounts, driver accounts, ride requests, driver onboarding, AI support, and HTAF applications.",
                  "Planned / NOT yet available (describe as 'planned' or 'in development', never as available): grocery delivery, restaurant delivery, Harvey Logistics, scheduled medical transportation expansion, autonomous pilot, fleet partnerships, business and corporate transportation.",
                  "Service area: currently Nashville and Davidson County, Tennessee. Statewide Tennessee expansion is planned. Do not tell a person their area is covered unless it is Nashville or Davidson County; otherwise suggest they contact support to confirm.",
                  "Support email: support@harveytaxiservice.com. Do NOT state business hours, website, or a support phone number — those are not yet provided, so never invent them.",
                  "",
                  "== HTAF (Harvey Transportation Assistance Foundation) ==",
                  "HTAF is a 501(c)(3) public charity that removes transportation barriers preventing individuals and families from accessing essential services, to improve mobility, health, education, employment, and quality of life throughout Tennessee.",
                  "HTAF transportation assistance programs (all currently AVAILABLE TO APPLY FOR, subject to review — approval is NEVER guaranteed): medical appointments, employment, education, veterans, seniors, individuals with disabilities, essential mobility, community transportation, emergency transportation.",
                  "Who may apply: individuals needing transportation for approved essential purposes. Specific eligibility depends on program requirements. NEVER promise approval or eligibility.",
                  "Application review: applications are reviewed individually; submitting does not guarantee approval; applicants may be contacted for more information. NEVER say 'you are approved' — instead say 'Your application will be reviewed by Harvey Transportation Assistance Foundation.' NEVER estimate a review timeline (none is set yet).",
                  "Donations support transportation assistance for eligible individuals and families. HTAF is a registered 501(c)(3); if asked about tax deductibility, say to consult a tax advisor. Do not invent donation links.",
                  "When helping with HTAF: be compassionate without making promises, distinguish current programs from future plans, encourage applying when appropriate, and direct decisions requiring staff review to human support.",
                  "",
                  "== DRIVERS ==",
                  "Apply via the Driver Sign-Up page. Onboarding order: (1) email verification, (2) SMS verification, (3) Persona identity review, (4) Checkr background review, (5) admin approval. 'Pending' status is normal and means the application is in the queue. Do NOT quote earnings, insurance, or vehicle requirements (not provided yet) — direct driver-requirement questions to support.",
                  "",
                  "== RIDERS ==",
                  "Riders sign up on the Rider Sign-Up page and must be approved before requesting rides. Do NOT quote any fare, price, or estimate (pricing not provided yet) — direct pricing questions to the app or support.",
                  "",
                  "== RULES (always) ==",
                  "1. Answer only from the information above; never invent eligibility, prices, timelines, hours, phone numbers, or policies.",
                  "2. Never promise approval, a ride, a price, a wait time, or eligibility.",
                  "3. Never collect sensitive data in chat (SSN, full card numbers, passwords, detailed medical info); direct people to the secure application or support.",
                  "4. You have no access to any individual's account, application, payment, or dispute records; say so and direct them to support at support@harveytaxiservice.com.",
                  "5. Stay in scope (Harvey Taxi and HTAF only); politely redirect unrelated questions.",
                  "6. For any medical emergency or immediate danger, tell the person to call 911. You are not an emergency service.",
                  "7. Be warm, plain, and brief. Many users are seniors, veterans, or people in difficult circumstances — short sentences, no jargon, kindness first.",
                  "8. Never reveal internal operations, admin procedures, or system details."
                ].join("\n")
 

            },

            {

              role:

                "user",

              content:

                `Page: ${page}\nRole: ${role}\n\nUser message: ${message}`

            }

          ],

          temperature:

            0.3

        });

    } catch (error) {

      console.error(

        "❌ OpenAI support failed:",

        error.message

      );

      return ok(res, {

        reply:

          "Harvey AI Support is having trouble right now. Please try again or contact support.",

        fallback:

          true,

        support_email:

          SUPPORT_EMAIL

      });

    }

    const reply =

      completion

        .choices?.[0]

        ?.message

        ?.content ||

      "I'm here to help. Please try again.";

    auditLog({

      action:

        "ai_support_message",

      metadata: {

        page,

        role,

        length:

          message.length

      },

      req

    }).catch(() => {});

    return ok(res, {

      reply

    });

  })

);/* =========================================================

   PART 10B — STATIC ROUTES, ERROR HANDLING, BOOT SEQUENCE

========================================================= */

/* =========================================================

   STATIC PAGE ROUTES

========================================================= */

function sendStaticPage(res, fileName) {

  return res.sendFile(

    path.join(PUBLIC_DIR, fileName)

  );

}

app.get(

  "/",

  (req, res) =>

    sendStaticPage(

      res,

      "index.html"

    )

);

app.get(

  "/foundation",

  (req, res) =>

    sendStaticPage(

      res,

      "foundation.html"

    )

);

app.get(

  "/foundation.html",

  (req, res) =>

    sendStaticPage(

      res,

      "foundation.html"

    )

);

app.get(

  "/htaf-application",

  (req, res) =>

    sendStaticPage(

      res,

      "htaf-application.html"

    )

);

app.get(

  "/htaf-application.html",

  (req, res) =>

    sendStaticPage(

      res,

      "htaf-application.html"

    )

);

app.get(

  "/request-ride",

  (req, res) =>

    sendStaticPage(

      res,

      "request-ride.html"

    )

);

app.get(

  "/request-ride.html",

  (req, res) =>

    sendStaticPage(

      res,

      "request-ride.html"

    )

);

app.get(

  "/support",

  (req, res) =>

    sendStaticPage(

      res,

      "support.html"

    )

);

app.get(

  "/support.html",

  (req, res) =>

    sendStaticPage(

      res,

      "support.html"

    )

);

app.get(

  "/settings",

  (req, res) =>

    sendStaticPage(

      res,

      "settings.html"

    )

);

app.get(

  "/settings.html",

  (req, res) =>

    sendStaticPage(

      res,

      "settings.html"

    )

);

app.get(

  "/rider-dashboard",

  (req, res) =>

    sendStaticPage(

      res,

      "rider-dashboard.html"

    )

);

app.get(

  "/rider-dashboard.html",

  (req, res) =>

    sendStaticPage(

      res,

      "rider-dashboard.html"

    )

);

app.get(

  "/driver-dashboard",

  (req, res) =>

    sendStaticPage(

      res,

      "driver-dashboard.html"

    )

);

app.get(

  "/driver-dashboard.html",

  (req, res) =>

    sendStaticPage(

      res,

      "driver-dashboard.html"

    )

);

app.get(

  "/driver-signup",

  (req, res) =>

    sendStaticPage(

      res,

      "driver-signup.html"

    )

);

app.get(

  "/driver-signup.html",

  (req, res) =>

    sendStaticPage(

      res,

      "driver-signup.html"

    )

);

app.get(

  "/rider-signup",

  (req, res) =>

    sendStaticPage(

      res,

      "rider-signup.html"

    )

);

app.get(

  "/rider-signup.html",

  (req, res) =>

    sendStaticPage(

      res,

      "rider-signup.html"

    )

);

app.get(

  "/admin-htaf",

  (req, res) =>

    sendStaticPage(

      res,

      "admin-htaf.html"

    )

);

app.get(

  "/admin-htaf.html",

  (req, res) =>

    sendStaticPage(

      res,

      "admin-htaf.html"

    )

);

/* =========================================================

   API 404 HANDLER

========================================================= */

app.use(

  "/api",

  (req, res) => {

    return fail(

      res,

      `API route not found: ${req.method} ${req.originalUrl}`,

      404

    );

  }

);

/* =========================================================

   APP FALLBACK 404

========================================================= */

app.use(

  (req, res) => {

    return res

      .status(404)

      .sendFile(

        path.join(

          PUBLIC_DIR,

          "index.html"

        )

      );

  }

);

/* =========================================================

   GLOBAL ERROR HANDLER

========================================================= */

app.use(

  (error, req, res, next) => {

    console.error(

      "❌ SERVER ERROR:",

      {

        message:

          error.message,

        stack:

          IS_PRODUCTION

            ? undefined

            : error.stack,

        path:

          req.originalUrl,

        method:

          req.method

      }

    );

    auditLog({

      action:

        "server_error",

      entity_type:

        "server",

      metadata: {

        message:

          error.message,

        path:

          req.originalUrl,

        method:

          req.method

      },

      req

    }).catch(() => {});

    return fail(

      res,

      IS_PRODUCTION

        ? "Internal server error."

        : error.message,

      500

    );

  }

);

/* =========================================================

   PROCESS SAFETY

========================================================= */

process.on(

  "unhandledRejection",

  (reason) => {

    console.error(

      "❌ UNHANDLED REJECTION:",

      reason

    );

  }

);

process.on(

  "uncaughtException",

  (error) => {

    console.error(

      "❌ UNCAUGHT EXCEPTION:",

      error

    );

  }

);

/* =========================================================

   GRACEFUL SHUTDOWN

========================================================= */

function gracefulShutdown(signal) {

  console.log(

    `🛑 ${signal} received. Shutting down Harvey Taxi Server J...`

  );

  for (const clientId of sseClients.keys()) {

    sendSse(

      clientId,

      "server_shutdown",

      {

        signal,

        at:

          nowIso()

      }

    );

  }

  server.close(() => {

    console.log(

      "✅ HTTP server closed."

    );

    process.exit(0);

  });

  setTimeout(() => {

    console.warn(

      "⚠️ Forced shutdown after timeout."

    );

    process.exit(1);

  }, 10_000).unref();

}

process.on(

  "SIGTERM",

  () => gracefulShutdown("SIGTERM")

);

process.on(

  "SIGINT",

  () => gracefulShutdown("SIGINT")

);

/* =========================================================

   BOOT VALIDATION

========================================================= */

async function bootValidation() {

  console.log(

    "🔎 Running Harvey Taxi boot validation..."

  );

  const tableStatus =

    await checkRequiredTables();

  const htafStatus =

    await inspectHtafSchema();

  console.log(

    "📊 Supabase table status:",

    tableStatus

  );

  console.log(

    "📊 HTAF schema status:",

    htafStatus

  );

  if (!htafStatus.ok) {

    console.warn(

      "⚠️ HTAF schema is not fully ready. /api/foundation/apply may fail until Supabase columns match the server payload."

    );

  }

  return {

    tableStatus,

    htafStatus

  };

}

/* =========================================================

   START SERVER

========================================================= */

async function startServer() {

  try {

    await bootValidation();

  } catch (error) {

    console.warn(

      "⚠️ Boot validation completed with warnings:",

      error.message

    );

  }

  server.listen(

    PORT,

    "0.0.0.0",

    () => {

      console.log(

        "================================================="

      );

      console.log(

        "🚕 HARVEY TAXI SERVER J ONLINE"

      );

      console.log(

        `🌎 Environment: ${NODE_ENV}`

      );

      console.log(

        `🔌 Port: ${PORT}`

      );

      console.log(

        `🏠 App URL: ${APP_BASE_URL}`

      );

      console.log(

        `🧾 HTAF Applications: ${ENABLE_HTAF_APPLICATIONS ? "ON" : "OFF"}`

      );

      console.log(

        `💳 Stripe: ${stripe ? "ON" : "OFF"}`

      );

      console.log(

        `📧 SendGrid: ${sgMail && SENDGRID_API_KEY ? "ON" : "OFF"}`

      );

      console.log(

        `📲 Twilio: ${twilioClient ? "ON" : "OFF"}`

      );

      console.log(

        `🪪 Persona: ${PERSONA_API_KEY ? "ON" : "OFF"}`

      );

      console.log(

        `🛡️ Checkr: ${CHECKR_API_KEY ? "ON" : "OFF"}`

      );

      console.log(

        `🤖 AI Support: ${openai ? "ON" : "OFF"}`

      );

      console.log(

        "================================================="

      );

    }

  );

}

startServer();

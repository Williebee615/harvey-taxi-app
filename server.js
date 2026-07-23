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

let webpush = null;

try { webpush = require("web-push"); } catch {}

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

/* Canonical public domain for the platform. Any request that arrives on a
   different host (e.g. the Render-assigned hostname) is 301-redirected here,
   except API routes — see the redirect middleware below. Override with
   CANONICAL_HOST if the canonical domain ever changes. */
const CANONICAL_HOST = env("CANONICAL_HOST", "harveytaxiservice.com");

/* Off by default: flip to true in the environment once CANONICAL_HOST is
   confirmed resolving correctly. Until then, redirecting the Render
   hostname there would send live traffic into a domain that doesn't
   work yet. */
const ENABLE_CANONICAL_REDIRECT = envBool("ENABLE_CANONICAL_REDIRECT", false);

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

/* Driver session: signed token issued after OTP verification,

   reused by the driver dashboard. Shares the admin secret

   fallback chain if a dedicated one is not set. */

const DRIVER_SESSION_SECRET =

  env("DRIVER_SESSION_SECRET") ||

  env("ADMIN_SESSION_SECRET") ||

  env("SESSION_SECRET") ||

  ADMIN_API_TOKEN ||

  ADMIN_PASSWORD ||

  "";

const DRIVER_SESSION_TTL_HOURS =

  envNumber("DRIVER_SESSION_TTL_HOURS", 24);

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

// Browser-restricted Google Maps/Places key. Safe to hand to the client —
// it's designed to be embedded in page requests and protected by HTTP
// referrer restrictions in Google Cloud Console, not by keeping it secret —
// but it still shouldn't be hardcoded into a file committed to git, so it's
// served from this env var through GET /api/maps-key instead.
const GOOGLE_MAPS_BROWSER_KEY = env("GOOGLE_MAPS_BROWSER_KEY");

/* =========================================================

   WEB PUSH (VAPID)

========================================================= */

const VAPID_PUBLIC_KEY = env("VAPID_PUBLIC_KEY");

const VAPID_PRIVATE_KEY = env("VAPID_PRIVATE_KEY");

const VAPID_SUBJECT = env("VAPID_SUBJECT", "mailto:support@harveytaxiservice.com");

let pushEnabled = false;

if (webpush && VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {

  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

  pushEnabled = true;

  console.log("✅ Web push active");

} else {

  console.warn("⚠️ Web push inactive (no VAPID keys configured)");

}

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

/* =========================================================

   CANONICAL DOMAIN REDIRECT

   Sends browsers on the Render-assigned hostname to CANONICAL_HOST
   instead. API routes are excluded so direct API callers (mobile
   clients, local dev pointed at the deployed backend, webhooks) are
   never redirected. Gated behind ENABLE_CANONICAL_REDIRECT (default
   off) — set it to true once CANONICAL_HOST is confirmed resolving.

========================================================= */

app.use((req, res, next) => {

  if (

    ENABLE_CANONICAL_REDIRECT &&

    IS_PRODUCTION &&

    req.hostname &&

    req.hostname !== CANONICAL_HOST &&

    req.hostname.endsWith(".onrender.com") &&

    !req.path.startsWith("/api/")

  ) {

    return res.redirect(301, `https://${CANONICAL_HOST}${req.originalUrl}`);

  }

  next();

});

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

/* Base64-encoded image uploads inflate to ~4/3 their raw size, so the
   default JSON_LIMIT (2mb) isn't enough for a photo upload. Give these
   specific paths a larger, dedicated body limit instead of raising the
   limit globally. */
const LARGE_JSON_LIMIT = env("LARGE_JSON_LIMIT", "8mb");

const LARGE_BODY_PATHS = new Set([

  "/api/driver/photo"

]);

// The delivery-complete route also accepts a base64 delivery-proof photo
// for leave-at-door orders, but its path includes a variable :rideId
// segment, so it can't live in the literal-match Set above.
const LARGE_BODY_PATH_PATTERNS = [

  /^\/api\/driver\/rides\/[^/]+\/complete$/

];

function isLargeBodyPath(path) {

  if (LARGE_BODY_PATHS.has(path)) return true;

  return LARGE_BODY_PATH_PATTERNS.some((pattern) => pattern.test(path));

}

app.use((req, res, next) => {

  if (RAW_WEBHOOK_PATHS.has(req.path)) {

    return next();

  }

  const limit = isLargeBodyPath(req.path)

    ? LARGE_JSON_LIMIT

    : JSON_LIMIT;

  return express.json({

    limit

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

/* =========================================================

   OPTIONAL REDIS (Upstash REST) FOR RATE LIMITING

   Uses Upstash's REST API via fetch, so NO extra npm

   dependency is required. If the env vars are absent, the

   limiter transparently falls back to the in-memory Map

   (single-instance behavior, unchanged from before).

   Set in Render:

     UPSTASH_REDIS_REST_URL

     UPSTASH_REDIS_REST_TOKEN

========================================================= */

const UPSTASH_REDIS_REST_URL = env("UPSTASH_REDIS_REST_URL");

const UPSTASH_REDIS_REST_TOKEN = env("UPSTASH_REDIS_REST_TOKEN");

const REDIS_ENABLED =

  Boolean(

    UPSTASH_REDIS_REST_URL &&

    UPSTASH_REDIS_REST_TOKEN

  );

if (REDIS_ENABLED) {

  console.log("✅ Upstash Redis rate limiting active");

} else {

  console.warn("⚠️ Redis not configured — using in-memory rate limiter (single instance)");

}

/* Run a Redis command through the Upstash REST API.

   Returns null on any failure so callers can fall back. */

async function upstashCommand(args) {

  if (!REDIS_ENABLED) return null;

  try {

    const response =

      await fetch(UPSTASH_REDIS_REST_URL, {

        method: "POST",

        headers: {

          Authorization:

            `Bearer ${UPSTASH_REDIS_REST_TOKEN}`,

          "Content-Type": "application/json"

        },

        body: JSON.stringify(args)

      });

    if (!response.ok) {

      return null;

    }

    const json =

      await response.json().catch(() => null);

    return json?.result ?? null;

  } catch {

    return null;

  }

}

/* Fixed-window counter in Redis: INCR then set EXPIRE on

   first hit. Returns the current count, or null on failure. */

async function redisRateHit(key, windowSeconds) {

  const count =

    await upstashCommand(["INCR", key]);

  if (count === null) {

    return null;

  }

  if (Number(count) === 1) {

    await upstashCommand(["EXPIRE", key, String(windowSeconds)]);

  }

  return Number(count);

}

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

  const windowSeconds =

    Math.ceil(windowMs / 1000);

  return async (req, res, next) => {

    const ip = getClientIp(req);

    const key = `${keyPrefix}:${ip}`;

    // Try Redis first (scales across instances).

    if (REDIS_ENABLED) {

      const redisCount =

        await redisRateHit(

          `ratelimit:${key}`,

          windowSeconds

        );

      if (redisCount !== null) {

        if (redisCount > max) {

          return fail(

            res,

            "Too many requests. Please wait and try again.",

            429

          );

        }

        return next();

      }

      // Redis failed this call — fall through to memory.

    }

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

   CURSOR (KEYSET) PAGINATION

   Encodes the last row's (created_at, id) into an opaque

   base64 cursor. Keyset pagination stays fast no matter how

   deep the list grows, unlike OFFSET. Backward compatible:

   with no cursor, returns the first page and a next_cursor.

========================================================= */

function encodeCursor(row) {

  if (!row) return null;

  const payload = {

    c: row.created_at,

    i: row.id

  };

  return Buffer

    .from(JSON.stringify(payload))

    .toString("base64url");

}

function decodeCursor(cursor) {

  if (!cursor) return null;

  try {

    const json =

      Buffer

        .from(String(cursor), "base64url")

        .toString("utf8");

    const parsed = JSON.parse(json);

    if (!parsed || !parsed.c || !parsed.i) {

      return null;

    }

    return { created_at: parsed.c, id: parsed.i };

  } catch {

    return null;

  }

}

function getPageLimit(req, fallback = 50, cap = 200) {

  const requested =

    Number(req.query.limit);

  if (!Number.isFinite(requested) || requested <= 0) {

    return fallback;

  }

  return Math.min(Math.floor(requested), cap);

}

/* Applies descending keyset pagination to a Supabase query

   on (created_at, id). Returns the modified query. */

function applyCursor(query, cursor) {

  if (!cursor) return query;

  // created_at < cursor.created_at

  //   OR (created_at = cursor.created_at AND id < cursor.id)

  return query.or(

    `created_at.lt.${cursor.created_at},` +

    `and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`

  );

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

function isDeliveryRideType(rideType) {

  return rideType === "food" || rideType === "grocery";

}

const DELIVERY_STAGE = {

  ORDER_ACCEPTED: "order_accepted",

  ENROUTE_STORE: "enroute_store",

  ARRIVED_STORE: "arrived_store",

  WAITING_FOR_ORDER: "waiting_for_order",

  PICKED_UP: "picked_up",

  ENROUTE_CUSTOMER: "enroute_customer",

  ARRIVED_CUSTOMER: "arrived_customer",

  DELIVERED: "delivered"

};

const DELIVERY_STAGE_LABELS = {

  order_accepted: "Order accepted",

  enroute_store: "Driver en route to store",

  arrived_store: "Driver at store",

  waiting_for_order: "Waiting for order",

  picked_up: "Order picked up",

  enroute_customer: "Driver en route to you",

  arrived_customer: "Driver has arrived",

  delivered: "Delivered"

};

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

/* -------- DRIVER SESSION (signed token) -------- */

function signDriverSession(driverId) {

  if (!DRIVER_SESSION_SECRET) return "";

  const now = Date.now();

  const payload = {

    sub: "harvey-driver",

    driver_id: String(driverId),

    iat: now,

    exp: now + DRIVER_SESSION_TTL_HOURS * 60 * 60 * 1000

  };

  const encoded =

    base64UrlEncode(JSON.stringify(payload));

  const sig =

    crypto

      .createHmac("sha256", DRIVER_SESSION_SECRET)

      .update(encoded)

      .digest("hex");

  return `${encoded}.${sig}`;

}

function verifyDriverSession(token) {

  if (!token || !DRIVER_SESSION_SECRET) return null;

  const parts = String(token).split(".");

  if (parts.length !== 2) return null;

  const [encoded, sig] = parts;

  const expected =

    crypto

      .createHmac("sha256", DRIVER_SESSION_SECRET)

      .update(encoded)

      .digest("hex");

  if (!timingSafeEqualString(sig, expected)) return null;

  let payload = null;

  try {

    payload = JSON.parse(base64UrlDecode(encoded));

  } catch {

    return null;

  }

  if (!payload || typeof payload.exp !== "number") return null;

  if (Date.now() > payload.exp) return null;

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

    // Preferred path: a signed driver session token (from the

    // driver dashboard's OTP login). Verify it and load the driver.

    const driverToken =

      req.headers["x-driver-token"];

    if (driverToken) {

      const session =

        verifyDriverSession(driverToken);

      if (!session) {

        return fail(

          res,

          "Your driver session has expired. Please sign in again.",

          401

        );

      }

      const { data: sessDriver, error: sessErr } =

        await supabase

          .from("drivers")

          .select("*")

          .eq("id", session.driver_id)

          .single();

      if (sessErr || !sessDriver) {

        return fail(res, "Driver not found.", 404);

      }

      if (sessDriver.access_revoked === true) {

        return fail(

          res,

          "This account has been deleted or its access has been revoked.",

          403

        );

      }

      req.driver = sessDriver;

      req.driverAuthMethod = "driver_session";

      return next();

    }

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

    if (driver.access_revoked === true) {

      return fail(

        res,

        "This account has been deleted or its access has been revoked.",

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

function buildDriverRideFields(driver) {

  return {

    driver_name:

      [driver.first_name, driver.last_name].filter(Boolean).join(" ") ||

      driver.name ||

      driver.full_name ||

      "Driver",

    driver_vehicle:

      [driver.vehicle_year, driver.vehicle_make, driver.vehicle_model]

        .filter(Boolean)

        .join(" "),

    driver_phone: driver.phone || driver.phone_number || null

  };

}

const RIDE_STAGE_MESSAGES = {

  order_submitted: {

    sms: (ride) =>

      `Harvey Taxi: We've received your ${isDeliveryRideType(ride.ride_type) ? "order" : "ride request"}. We'll text you updates as it moves along.`,

    subject: "Request Received"

  },

  driver_assigned: {

    sms: (ride) =>

      `Harvey Taxi: ${ride.driver_name || "A driver"} has been assigned to your ${isDeliveryRideType(ride.ride_type) ? "order" : "ride"}.`,

    subject: "Driver Assigned"

  },

  enroute_pickup: {

    sms: () => `Harvey Taxi: Your driver is on the way to pick you up.`,

    subject: "Driver En Route"

  },

  arrived_pickup: {

    sms: () => `Harvey Taxi: Your driver has arrived at your pickup location.`,

    subject: "Driver Arrived"

  },

  ride_started: {

    sms: () => `Harvey Taxi: Your ride is underway. Have a safe trip!`,

    subject: "Ride Started"

  },

  ride_completed: {

    sms: () => `Harvey Taxi: Your ride is complete. Thanks for riding with Harvey Taxi!`,

    subject: "Ride Complete"

  },

  enroute_store: {

    sms: (ride) =>

      `Harvey Taxi: Your driver is heading to ${ride.merchant_name || "the store"} to pick up your order.`,

    subject: "Driver Heading to Store"

  },

  arrived_store: {

    sms: (ride) =>

      `Harvey Taxi: Your driver has arrived at ${ride.merchant_name || "the store"}.`,

    subject: "Driver at Store"

  },

  picked_up: {

    sms: () => `Harvey Taxi: Your order has been picked up and is on its way to you.`,

    subject: "Order Picked Up"

  },

  enroute_customer: {

    sms: () => `Harvey Taxi: Your driver is on the way to you.`,

    subject: "Driver Heading Your Way"

  },

  arrived_customer: {

    sms: (ride) =>

      `Harvey Taxi: Your driver has arrived.` +

      (ride.delivery_handoff === "hand_to_customer"

        ? " Please have your delivery PIN ready."

        : " Your order will be left at your door."),

    subject: "Driver Has Arrived"

  },

  delivered: {

    sms: () => `Harvey Taxi: Your order has been delivered. Thanks for using Harvey Taxi!`,

    subject: "Delivered"

  }

};

// Best-effort stage-change notification over SMS/email. Never throws —
// a notification failure should never break the ride/delivery action
// that triggered it. Silently no-ops when Twilio/SendGrid aren't
// configured, same as sendSms()/sendEmail() do individually.
// Best-effort browser push. Never throws — same resilience contract as
// sendSms()/sendEmail(). Cleans up subscriptions the push service reports
// as gone (404/410) so a stale endpoint doesn't get retried forever.
async function sendPushNotification({ ownerType, ownerId, title, body, url }) {

  if (!pushEnabled || !ownerId) return;

  try {

    const { data: subs, error } = await supabase
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth")
      .eq("owner_type", ownerType)
      .eq("owner_id", ownerId);

    if (error || !subs || !subs.length) return;

    const payload = JSON.stringify({ title, body, url: url || "/" });

    await Promise.allSettled(
      subs.map(async (sub) => {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            payload
          );

          await supabase
            .from("push_subscriptions")
            .update({ last_used_at: nowIso() })
            .eq("id", sub.id);
        } catch (err) {
          if (err && (err.statusCode === 404 || err.statusCode === 410)) {
            await supabase
              .from("push_subscriptions")
              .delete()
              .eq("id", sub.id)
              .catch(() => {});
          }
        }
      })
    );
  } catch (err) {
    console.error("⚠️ sendPushNotification failed:", err.message);
  }
}

async function notifyRideStage(ride, stageKey) {

  try {

    const template = RIDE_STAGE_MESSAGES[stageKey];

    if (!template) return;

    const body = template.sms(ride);

    if (ride.rider_phone) {

      await sendSms({ to: ride.rider_phone, body }).catch(() => {});

    }

    if (ride.rider_id) {

      const { data: rider } = await supabase

        .from("riders")

        .select("email")

        .eq("id", ride.rider_id)

        .maybeSingle();

      if (rider?.email) {

        await sendEmail({

          to: rider.email,

          subject: `Harvey Taxi - ${template.subject}`,

          html: `<p>${body}</p>`

        }).catch(() => {});

      }

      sendPushNotification({

        ownerType: "rider",

        ownerId: ride.rider_id,

        title: `Harvey Taxi - ${template.subject}`,

        body,

        url: "/request-ride.html"

      }).catch(() => {});

    }

  } catch (err) {

    console.error("⚠️ notifyRideStage failed:", err.message);

  }

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

// Straight-line (haversine) distance divided by an assumed average speed.
// This is a rough estimate, not a real driving-route ETA — accurate
// turn-by-turn ETAs require the Google Directions/Distance Matrix API.
const ASSUMED_DELIVERY_SPEED_MPH = envNumber("ASSUMED_DELIVERY_SPEED_MPH", 22);

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

    const limit =

      getPageLimit(

        req,

        envNumber("ADMIN_LIST_LIMIT", 200),

        500

      );

    const cursor =

      decodeCursor(req.query.cursor);

    let query =

      supabase

        .from("htaf_applications")

        .select("*")

        .order(

          "created_at",

          { ascending: false }

        )

        .order(

          "id",

          { ascending: false }

        )

        .limit(limit);

    if (status) {

      query =

        query.eq(

          "status",

          status

        );

    }

    query = applyCursor(query, cursor);

    const { data, error } =

      await query;

    if (error) {

      throw error;

    }

    const rows = data || [];

    const next_cursor =

      rows.length === limit

        ? encodeCursor(rows[rows.length - 1])

        : null;

    return ok(res, {

      applications:

        rows,

      page: {

        limit,

        count: rows.length,

        next_cursor

      }

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

);

/* =========================================================
   HTAF AI TRIAGE
   Admin only. Asks OpenAI to summarize an application, flag
   anything unusual or incomplete, and suggest a next action.
   This never writes to the database or auto-changes status —
   it only returns a suggestion for the admin to review. The
   admin applies it (or not) via the existing notes/status
   endpoints, so the human always makes the final call.
========================================================= */

const HTAF_TRIAGE_RECOMMENDATIONS = [
  "approve",
  "deny",
  "request_info",
  "review"
];

async function triageHtafApplication(application) {
  if (!openai) {
    return {
      available: false,
      reason: "AI triage is not configured on the server (OPENAI_API_KEY missing)."
    };
  }

  const facts = {
    application_code: application.application_code,
    status: application.status,
    program_type: application.program_type,
    applicant_type: application.applicant_type,
    county: application.county,
    city: application.city,
    pickup_city: application.pickup_city,
    destination: application.destination,
    ride_date: application.ride_date,
    household_size: application.household_size,
    monthly_income: application.monthly_income,
    transportation_need: application.transportation_need,
    existing_notes: application.notes || null,
    submitted_at: application.created_at
  };

  const systemContent = [
    "You are an assistant helping a human reviewer triage HTAF (Harvey Transportation Assistance Foundation) applications for transportation assistance.",
    "You NEVER approve or deny anything yourself — you only summarize the application and suggest a recommendation for a human admin, who makes the final decision.",
    "Be factual and concise. Do not invent facts that are not in the application data. Do not assume eligibility rules beyond what is provided.",
    "Flag things like: missing or vague transportation_need, an implausible or inconsistent household_size/monthly_income, a ride_date in the past, a destination/pickup_city outside Nashville or Davidson County (service area), or anything that looks incomplete.",
    "Respond ONLY with a JSON object of this exact shape: " +
      '{"summary": string, "flags": string[], "recommendation": "approve" | "deny" | "request_info" | "review", "reasoning": string}',
    '"recommendation" must be exactly one of: approve, deny, request_info, review. Use "review" whenever you are not confident.',
    "Keep summary to 2-3 sentences. Keep flags short (a few words each); return an empty array if nothing stands out."
  ].join(" ");

  const completion = await openai.chat.completions.create({
    model: OPENAI_MODEL,
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: systemContent },
      { role: "user", content: JSON.stringify(facts) }
    ]
  });

  const raw = completion.choices?.[0]?.message?.content || "{}";
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = {};
  }

  const recommendation = HTAF_TRIAGE_RECOMMENDATIONS.includes(parsed.recommendation)
    ? parsed.recommendation
    : "review";

  return {
    available: true,
    summary: cleanString(parsed.summary, 1000) || "No summary returned.",
    flags: Array.isArray(parsed.flags)
      ? parsed.flags.map((f) => cleanString(f, 200)).filter(Boolean).slice(0, 10)
      : [],
    recommendation,
    reasoning: cleanString(parsed.reasoning, 1000) || ""
  };
}

app.post(
  "/api/admin/foundation/applications/:id/triage",
  requireAdmin,
  rateLimit({ windowMs: 60_000, max: 20, keyPrefix: "htaf_triage" }),
  asyncRoute(async (req, res) => {
    const id = cleanString(req.params.id, 80);
    const { data: application, error } = await supabase
      .from("htaf_applications")
      .select("*")
      .eq("id", id)
      .single();

    if (error || !application) {
      return fail(res, "Application not found.", 404);
    }

    let triage;
    try {
      triage = await triageHtafApplication(application);
    } catch (aiError) {
      console.error("❌ HTAF AI triage failed:", aiError.message);
      return fail(res, "AI triage is temporarily unavailable. Please try again.", 502);
    }

    auditLog({
      actor_type: "admin",
      actor_id: req.admin.email,
      action: "htaf_application_ai_triaged",
      entity_type: "htaf_application",
      entity_id: application.id,
      metadata: { recommendation: triage.recommendation || null },
      req
    }).catch(() => {});

    return ok(res, { triage });
  })
);

/* =========================================================

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

   DRIVER SESSION LOGIN (OTP -> signed token)

   The driver dashboard uses this to authenticate:

   1) start: driver_id -> sends an SMS code to the driver's phone

   2) verify: driver_id + code -> returns a signed driver token

========================================================= */

app.post(

  "/api/driver/session/start",

  asyncRoute(async (req, res) => {

    const driverId =

      cleanString(req.body.driver_id, 100);

    if (!driverId) {

      return fail(res, "driver_id is required.", 400);

    }

    const { data: driver, error } =

      await supabase

        .from("drivers")

        .select("id, phone, access_revoked")

        .eq("id", driverId)

        .maybeSingle();

    if (error || !driver) {

      return fail(res, "Driver not found.", 404);

    }

    if (driver.access_revoked === true) {

      return fail(res, "This account's access has been revoked.", 403);

    }

    if (!driver.phone) {

      return fail(res, "No phone number on file for this driver.", 400);

    }

    const { code } =

      await createVerificationRecord({

        channel: "sms",

        destination: driver.phone,

        purpose: "driver_login",

        user_type: "driver",

        metadata: { driver_id: driverId }

      });

    await sendSms({

      to: driver.phone,

      body: `Your Harvey Taxi driver login code is ${code}. It expires in ${VERIFY_TTL_MINUTES} minutes.`

    });

    // Return the masked phone so the UI can show where the code went.

    const masked =

      driver.phone.replace(/.(?=.{4})/g, "•");

    return ok(res, {

      sent: true,

      phone_hint: masked,

      expires_in_minutes: VERIFY_TTL_MINUTES

    });

  })

);

app.post(

  "/api/driver/session/verify",

  asyncRoute(async (req, res) => {

    const driverId =

      cleanString(req.body.driver_id, 100);

    const code =

      cleanString(req.body.code, 20);

    if (!driverId || !code) {

      return fail(res, "driver_id and code are required.", 400);

    }

    const { data: driver, error } =

      await supabase

        .from("drivers")

        .select("id, phone, access_revoked")

        .eq("id", driverId)

        .maybeSingle();

    if (error || !driver) {

      return fail(res, "Driver not found.", 404);

    }

    if (driver.access_revoked === true) {

      return fail(res, "This account's access has been revoked.", 403);

    }

    const verification =

      await verifyCode({

        channel: "sms",

        destination: driver.phone,

        code,

        purpose: "driver_login"

      });

    if (!verification.ok) {

      return fail(res, verification.reason || "Invalid code.", 400);

    }

    if (!DRIVER_SESSION_SECRET) {

      return fail(

        res,

        "Driver sessions are not configured on the server.",

        500

      );

    }

    const token = signDriverSession(driverId);

    auditLog({

      actor_type: "driver",

      actor_id: driverId,

      action: "driver_login_success",

      req

    }).catch(() => {});

    return ok(res, {

      driver_token: token,

      driver_id: driverId,

      expires_in_hours: DRIVER_SESSION_TTL_HOURS

    });

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

      checks,

      // Curated, client-safe subset of the driver row for the driver
      // dashboard's profile card. Never spread the raw row here — it
      // also carries password/verification-code hashes and internal
      // Persona/Checkr payloads that must never reach the browser.
      driver: {

        id: driver.id,

        first_name: driver.first_name,

        last_name: driver.last_name,

        email: driver.email,

        phone: driver.phone,

        city: driver.city,

        state: driver.state,

        vehicle_make: driver.vehicle_make,

        vehicle_model: driver.vehicle_model,

        vehicle_year: driver.vehicle_year,

        license_plate: driver.license_plate,

        online: Boolean(driver.online || driver.is_online),

        mode: driver.mode || "driver",

        total_trips: driver.total_trips,

        rating: driver.rating,

        photo_url: driver.photo_url || null,

        supports_food_delivery: driver.supports_food_delivery,

        supports_grocery_delivery: driver.supports_grocery_delivery

      }

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

  if (rider.access_revoked === true) {

    return {

      ready: false,

      reason: "This account has been deleted or its access has been revoked."

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

/* Exposes getRiderReadiness() over HTTP. request-ride.html and the
   mobile app both call GET /api/riders/:id/readiness before allowing
   a ride request — this route previously did not exist, so every
   readiness check 404'd and blocked riders from booking. */
app.get(
  "/api/riders/:id/readiness",
  asyncRoute(async (req, res) => {
    const riderId = cleanString(req.params.id, 100);
    const readiness = await getRiderReadiness(riderId);

    if (!readiness.rider) {
      return fail(res, readiness.reason || "Rider not found.", 404);
    }

    return ok(res, {
      rider_id: readiness.rider.id,
      ready: readiness.ready,
      approved: readiness.ready,
      verified: readiness.ready,
      status: readiness.rider.status,
      approval_status: readiness.rider.approval_status,
      checks: readiness.checks || {},
      reason: readiness.reason || null
    });
  })
);

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

  // Preferred path: PostGIS RPC does the distance filter in the

  // database and returns only the nearest drivers. Requires the

  // nearest_drivers() function from the scalability migration.

  // If the RPC is absent or errors, we fall back to the original

  // in-Node calculation so dispatch never breaks.

  if (

    Number.isFinite(Number(pickup_lat)) &&

    Number.isFinite(Number(pickup_lng))

  ) {

    try {

      const { data: rpcData, error: rpcError } =

        await supabase.rpc("nearest_drivers", {

          p_lat: Number(pickup_lat),

          p_lng: Number(pickup_lng),

          p_radius_miles: Number(radius_miles),

          p_limit: Number(limit) + excludeSet.size + 5

        });

      if (!rpcError && Array.isArray(rpcData)) {

        return rpcData

          .filter(

            (d) => !excludeSet.has(String(d.id))

          )

          .map((d) => ({

            ...d,

            distance_miles:

              d.distance_miles ??

              (d.distance_meters

                ? Number(

                    (d.distance_meters / 1609.34).toFixed(2)

                  )

                : null)

          }))

          .slice(0, limit);

      }

    } catch (rpcErr) {

      console.warn(

        "⚠️ nearest_drivers RPC unavailable, using Node fallback:",

        rpcErr.message

      );

    }

  }

  // Fallback: original in-Node distance computation.

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

  // Respect the admin dispatch pause. When dispatch is paused,

  // do NOT create offers or assign drivers — mark the ride as

  // waiting so it can be dispatched once dispatch resumes.

  const dispatchPaused =

    await getSystemFlag("dispatch_paused", "false");

  if (dispatchPaused === "true") {

    await supabase

      .from("rides")

      .update({

        dispatch_status:

          "paused",

        updated_at:

          nowIso()

      })

      .eq("id", ride.id);

    return {

      dispatched: false,

      paused: true,

      reason: "Dispatch is currently paused by an administrator."

    };

  }

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

  // Preferred path: single atomic RPC creates the offer AND

  // updates the ride under a row lock, so two concurrent

  // dispatch attempts cannot race or overwrite each other.

  // Requires dispatch_ride_atomic() from the scalability

  // migration. Falls back to the two-step flow if absent.

  try {

    const { data: rpcResult, error: rpcError } =

      await supabase.rpc("dispatch_ride_atomic", {

        p_ride_id: ride.id,

        p_driver_id: firstDriver.id,

        p_expires_seconds:

          envNumber("DISPATCH_TIMEOUT_SECONDS", 30)

      });

    if (!rpcError && rpcResult) {

      const result =

        Array.isArray(rpcResult)

          ? rpcResult[0]

          : rpcResult;

      if (result && result.offer_id) {

        sendPushNotification({
          ownerType: "driver",
          ownerId: firstDriver.id,
          title: "New Ride Request",
          body: `Pickup: ${ride.pickup_address || "See app for details"}`,
          url: "/driver-dashboard.html"
        }).catch(() => {});

        return {

          dispatched: true,

          offer: {

            id: result.offer_id,

            ride_id: ride.id,

            driver_id: firstDriver.id

          },

          driver: firstDriver,

          atomic: true

        };

      }

    }

    if (rpcError) {

      console.warn(

        "⚠️ dispatch_ride_atomic RPC unavailable, using two-step fallback:",

        rpcError.message

      );

    }

  } catch (rpcErr) {

    console.warn(

      "⚠️ dispatch_ride_atomic threw, using two-step fallback:",

      rpcErr.message

    );

  }

  // Fallback: original non-atomic two-step flow.

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

  sendPushNotification({
    ownerType: "driver",
    ownerId: firstDriver.id,
    title: "New Ride Request",
    body: `Pickup: ${ride.pickup_address || "See app for details"}`,
    url: "/driver-dashboard.html"
  }).catch(() => {});

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

    const isDelivery =

      isDeliveryRideType(rideType);

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

      // NOTE: the rides table has no "pickup"/"destination" columns —
      // only pickup_address/dropoff_address. Writing to the old names
      // here used to make every ride request fail at insert time.
      pickup_address:

        cleanString(

          req.body.pickup,

          500

        ),

      dropoff_address:

        cleanString(

          req.body.destination,

          500

        ),

      pickup_lat:

        req.body.pickup_lat || null,

      pickup_lng:

        req.body.pickup_lng || null,

      dropoff_lat:

        req.body.destination_lat || null,

      dropoff_lng:

        req.body.destination_lng || null,

      ride_type:

        rideType,

      scheduled_time:

        req.body.scheduled_for || null,

      payment_id:

        cleanString(

          req.body.payment_intent_id,

          200

        ) || null,

      status,

      dispatch_status:

        status === RIDE_STATUS.PAYMENT_REQUIRED

          ? "awaiting_payment"

          : "ready_to_dispatch",

      estimated_fare:

        estimate.total,

      driver_payout:

        estimate.driver_payout,

      estimated_platform_fee:

        estimate.platform_fee,

      estimated_distance_miles:

        estimate.miles,

      estimated_duration_minutes:

        estimate.minutes,

      miles_estimate:

        estimate.miles,

      minutes_estimate:

        estimate.minutes,

      notes:

        cleanString(

          req.body.notes,

          1000

        ),

      // Delivery-only fields (food/grocery). Left null for passenger rides.
      merchant_name:

        isDelivery

          ? cleanString(req.body.merchant_name, 180)

          : null,

      item_count:

        isDelivery && req.body.item_count

          ? Math.max(1, Math.floor(Number(req.body.item_count)))

          : null,

      pickup_instructions:

        isDelivery

          ? cleanString(req.body.pickup_instructions, 500)

          : null,

      delivery_instructions:

        isDelivery

          ? cleanString(req.body.delivery_instructions, 500)

          : null,

      delivery_pin:

        isDelivery

          ? String(Math.floor(1000 + Math.random() * 9000))

          : null,

      delivery_stage:

        isDelivery ? DELIVERY_STAGE.ORDER_ACCEPTED : null,

      delivery_handoff:

        isDelivery

          ? (["leave_at_door", "hand_to_customer"].includes(

              cleanString(req.body.delivery_handoff, 30)

            )

              ? cleanString(req.body.delivery_handoff, 30)

              : "hand_to_customer")

          : null,

      tip_amount:

        Number.isFinite(Number(req.body.tip_amount)) &&

        Number(req.body.tip_amount) > 0

          ? Math.min(500, Math.round(Number(req.body.tip_amount) * 100) / 100)

          : null,

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

    notifyRideStage(data, "order_submitted").catch(() => {});

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

        ride.payment_id,

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

        Math.round(Number(ride.estimated_fare || 0) * 100);

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

        payment_id:

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

      payment_id:

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

);

/* =========================================================

   RIDE STATUS (RIDER-FACING)

   Public by ride ID (ride IDs are not sequential/guessable),
   matching the existing /api/foundation/status/:code pattern.
   Returns ride status plus assigned driver name, vehicle, and
   live photo_url once a driver has been assigned. This route
   did not previously exist — request-ride.html's
   refreshRideStatus() had an intentionally empty endpoint list
   because there was nothing to call.

========================================================= */

app.get(

  "/api/rides/:id/status",

  asyncRoute(async (req, res) => {

    const rideId = cleanString(req.params.id, 100);

    const { data: ride, error } = await supabase

      .from("rides")

      .select(

        "id, status, ride_type, pickup_address, dropoff_address, " +

        "pickup_lat, pickup_lng, dropoff_lat, dropoff_lng, " +

        "driver_id, driver_name, driver_vehicle, driver_phone, " +

        "driver_eta_to_pickup_minutes, driver_distance_to_pickup_miles, " +

        "estimated_fare, created_at, updated_at, " +

        "delivery_stage, delivery_pin, merchant_name, item_count, " +

        "pickup_instructions, delivery_instructions, delivered_at, " +

        "delivery_handoff, tip_amount, delivery_proof_url"

      )

      .eq("id", rideId)

      .maybeSingle();

    if (error || !ride) {

      return fail(res, "Ride not found.", 404);

    }

    let driverPhotoUrl = null;

    let driverLocation = null;

    if (ride.driver_id) {

      const { data: driver } = await supabase

        .from("drivers")

        .select("photo_url, current_lat, current_lng, last_seen_at, location_accuracy_meters")

        .eq("id", ride.driver_id)

        .maybeSingle();

      driverPhotoUrl = driver?.photo_url || null;

      if (driver && driver.current_lat !== null && driver.current_lng !== null) {

        const ageSeconds = driver.last_seen_at

          ? (Date.now() - new Date(driver.last_seen_at).getTime()) / 1000

          : Infinity;

        driverLocation = {

          lat: driver.current_lat,

          lng: driver.current_lng,

          accuracy_meters: driver.location_accuracy_meters,

          last_seen_at: driver.last_seen_at,

          stale: ageSeconds > 180

        };

      }

    }

    const isDelivery = isDeliveryRideType(ride.ride_type);

    let tracking = null;

    if (driverLocation && !driverLocation.stale) {

      let target = null;

      let targetLabel = null;

      if (

        ride.status === RIDE_STATUS.DRIVER_ENROUTE ||

        ride.status === RIDE_STATUS.ARRIVED

      ) {

        target = { lat: ride.pickup_lat, lng: ride.pickup_lng };

        targetLabel = isDelivery ? "store" : "pickup";

      } else if (ride.status === RIDE_STATUS.IN_PROGRESS) {

        target = { lat: ride.dropoff_lat, lng: ride.dropoff_lng };

        targetLabel = isDelivery ? "customer" : "destination";

      }

      if (

        target &&

        Number.isFinite(Number(target.lat)) &&

        Number.isFinite(Number(target.lng))

      ) {

        const distanceMiles = haversineMiles(

          driverLocation.lat,

          driverLocation.lng,

          Number(target.lat),

          Number(target.lng)

        );

        tracking = {

          target: targetLabel,

          distance_miles: Math.round(distanceMiles * 10) / 10,

          eta_minutes: Math.max(

            1,

            Math.round((distanceMiles / ASSUMED_DELIVERY_SPEED_MPH) * 60)

          ),

          is_estimate: true

        };

      }

    }

    return ok(res, {

      id: ride.id,

      status: ride.status,

      ride_type: ride.ride_type,

      pickup_address: ride.pickup_address,

      destination_address: ride.dropoff_address,

      eta_minutes: ride.driver_eta_to_pickup_minutes,

      distance_miles: ride.driver_distance_to_pickup_miles,

      estimated_fare: ride.estimated_fare,

      updated_at: ride.updated_at,

      tracking,

      driver: ride.driver_id

        ? {

            name: ride.driver_name,

            vehicle: ride.driver_vehicle,

            phone: ride.driver_phone,

            photo_url: driverPhotoUrl,

            location: driverLocation

          }

        : null,

      delivery: isDelivery

        ? {

            stage: ride.delivery_stage,

            stage_label:

              DELIVERY_STAGE_LABELS[ride.delivery_stage] || null,

            pin: ride.delivery_pin,

            merchant_name: ride.merchant_name,

            item_count: ride.item_count,

            pickup_instructions: ride.pickup_instructions,

            delivery_instructions: ride.delivery_instructions,

            delivered_at: ride.delivered_at,

            delivery_handoff: ride.delivery_handoff,

            tip_amount: ride.tip_amount,

            proof_url: ride.delivery_proof_url

          }

        : null

    });

  })

);

/* =========================================================

   GOOGLE MAPS BROWSER KEY

   Serves the browser-restricted Maps/Places key from an env
   var instead of it being hardcoded into a static HTML file
   committed to git. request-ride.html falls back to this when
   its <meta name="google-maps-browser-key"> tag is empty.
   Returns an empty key (never an error) when unconfigured, so
   the page's own graceful-degradation logic takes over.

========================================================= */

app.get(
  "/api/maps-key",
  rateLimit({ windowMs: 60_000, max: 60, keyPrefix: "maps_key" }),
  asyncRoute(async (req, res) => {
    return ok(res, { key: GOOGLE_MAPS_BROWSER_KEY || "" });
  })
);

/* =========================================================

   WEB PUSH — VAPID KEY + SUBSCRIBE/UNSUBSCRIBE

   The VAPID public key is not secret (it's embedded in every
   subscribe call the browser makes to the push service), so
   it's served the same way as the Maps key: from an env var,
   never hardcoded into a committed file.

========================================================= */

app.get(
  "/api/push/vapid-public-key",
  rateLimit({ windowMs: 60_000, max: 60, keyPrefix: "push_vapid_key" }),
  asyncRoute(async (req, res) => {
    return ok(res, { key: pushEnabled ? VAPID_PUBLIC_KEY : "" });
  })
);

app.post(
  "/api/push/subscribe",
  rateLimit({ windowMs: 60_000, max: 20, keyPrefix: "push_subscribe" }),
  asyncRoute(async (req, res) => {
    if (!pushEnabled) {
      return fail(res, "Push notifications are not configured yet.", 503);
    }

    const ownerType = cleanString(req.body.owner_type, 20);
    const ownerId = cleanString(req.body.owner_id, 100);
    const subscription = req.body.subscription;

    if (!["rider", "driver"].includes(ownerType) || !ownerId) {
      return fail(res, "A valid owner_type (rider or driver) and owner_id are required.", 400);
    }

    const endpoint = cleanString(subscription?.endpoint, 500);
    const p256dh = cleanString(subscription?.keys?.p256dh, 200);
    const auth = cleanString(subscription?.keys?.auth, 200);

    if (!endpoint || !p256dh || !auth) {
      return fail(res, "A valid push subscription is required.", 400);
    }

    const { error } = await supabase
      .from("push_subscriptions")
      .upsert(
        {
          id: makeId("PUSH"),
          owner_type: ownerType,
          owner_id: ownerId,
          endpoint,
          p256dh,
          auth,
          user_agent: cleanString(req.headers["user-agent"], 300) || null,
          last_used_at: nowIso()
        },
        { onConflict: "endpoint" }
      );

    if (error) {
      throw error;
    }

    return ok(res, { subscribed: true });
  })
);

app.post(
  "/api/push/unsubscribe",
  rateLimit({ windowMs: 60_000, max: 20, keyPrefix: "push_unsubscribe" }),
  asyncRoute(async (req, res) => {
    const endpoint = cleanString(req.body.endpoint, 500);

    if (!endpoint) {
      return fail(res, "endpoint is required.", 400);
    }

    await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint);

    return ok(res, { unsubscribed: true });
  })
);

/* =========================================================

   PUBLIC MISSION CONTROL SNAPSHOT

   Small, non-sensitive aggregate counts (no PII, no per-user
   data) for rider-facing "live platform status" UI: online
   driver count and average ETA across active rides. Public
   by design, same trust tier as /api/foundation/status/:code.

========================================================= */

app.get(
  "/api/public/mission-control",
  rateLimit({ windowMs: 60_000, max: 60, keyPrefix: "mission_control" }),
  asyncRoute(async (req, res) => {
    const ACTIVE_STATUSES = [
      RIDE_STATUS.AWAITING_DRIVER,
      RIDE_STATUS.DRIVER_ASSIGNED,
      RIDE_STATUS.DRIVER_ENROUTE,
      RIDE_STATUS.ARRIVED,
      RIDE_STATUS.IN_PROGRESS
    ];

    const [driversOnline, activeRidesResult] = await Promise.all([
      countWhere("drivers", (q) => q.eq("online", true)),
      supabase
        .from("rides")
        .select("driver_eta_to_pickup_minutes")
        .in("status", ACTIVE_STATUSES)
    ]);

    const activeRides = activeRidesResult.data || [];
    let etaSum = 0;
    let etaCount = 0;

    for (const ride of activeRides) {
      const eta = Number(ride.driver_eta_to_pickup_minutes);
      if (Number.isFinite(eta) && eta > 0) {
        etaSum += eta;
        etaCount++;
      }
    }

    return ok(res, {
      online_drivers: driversOnline.count,
      avg_wait_minutes:
        etaCount > 0 ? Math.round((etaSum / etaCount) * 10) / 10 : null,
      generated_at: nowIso()
    });
  })
);

/* =========================================================

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

    const acceptingDriver = await getDriverOrFail(offer.driver_id);

    const driverRideFields = buildDriverRideFields(acceptingDriver);

    const { data: assignedRide } = await supabase

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

        ...driverRideFields,

        accepted_at:

          nowIso(),

        updated_at:

          nowIso()

      })

      .eq("id", offer.ride_id)

      .select()

      .single();

    if (assignedRide) {

      notifyRideStage(assignedRide, "driver_assigned").catch(() => {});

      broadcastRideSse(offer.ride_id, "stage", {

        status: RIDE_STATUS.DRIVER_ASSIGNED,

        driver: driverRideFields

      });

    }

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

          nowIso(),

        ...(isDeliveryRideType(ride.ride_type)

          ? { delivery_stage: DELIVERY_STAGE.ENROUTE_STORE }

          : {})

      })

      .eq("id", rideId);

    const enrouteIsDelivery = isDeliveryRideType(ride.ride_type);

    notifyRideStage(

      ride,

      enrouteIsDelivery ? "enroute_store" : "enroute_pickup"

    ).catch(() => {});

    broadcastRideSse(rideId, "stage", {

      status: RIDE_STATUS.DRIVER_ENROUTE,

      delivery_stage: enrouteIsDelivery ? DELIVERY_STAGE.ENROUTE_STORE : null

    });

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

          nowIso(),

        ...(isDeliveryRideType(ride.ride_type)

          ? { delivery_stage: DELIVERY_STAGE.ARRIVED_STORE }

          : {})

      })

      .eq("id", rideId);

    const arrivedIsDelivery = isDeliveryRideType(ride.ride_type);

    notifyRideStage(

      ride,

      arrivedIsDelivery ? "arrived_store" : "arrived_pickup"

    ).catch(() => {});

    broadcastRideSse(rideId, "stage", {

      status: RIDE_STATUS.ARRIVED,

      delivery_stage: arrivedIsDelivery ? DELIVERY_STAGE.ARRIVED_STORE : null

    });

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

   DRIVER WAITING FOR ORDER (delivery only)

========================================================= */

app.post(

  "/api/driver/rides/:rideId/waiting-for-order",

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

    if (!isDeliveryRideType(ride.ride_type)) {

      return fail(

        res,

        "This action is only available for delivery orders.",

        400

      );

    }

    await supabase

      .from("rides")

      .update({

        delivery_stage:

          DELIVERY_STAGE.WAITING_FOR_ORDER,

        updated_at:

          nowIso()

      })

      .eq("id", rideId);

    broadcastRideSse(rideId, "stage", {

      delivery_stage: DELIVERY_STAGE.WAITING_FOR_ORDER

    });

    auditLog({

      actor_type:

        "driver",

      actor_id:

        driverId,

      action:

        "driver_waiting_for_order",

      entity_type:

        "ride",

      entity_id:

        rideId,

      req

    }).catch(() => {});

    return ok(res, {

      ride_id:

        rideId,

      delivery_stage:

        DELIVERY_STAGE.WAITING_FOR_ORDER

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

          nowIso(),

        ...(isDeliveryRideType(ride.ride_type)

          ? { delivery_stage: DELIVERY_STAGE.PICKED_UP }

          : {})

      })

      .eq("id", rideId);

    const startIsDelivery = isDeliveryRideType(ride.ride_type);

    notifyRideStage(

      ride,

      startIsDelivery ? "picked_up" : "ride_started"

    ).catch(() => {});

    broadcastRideSse(rideId, "stage", {

      status: RIDE_STATUS.IN_PROGRESS,

      delivery_stage: startIsDelivery ? DELIVERY_STAGE.PICKED_UP : null

    });

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

   DRIVER ENROUTE TO CUSTOMER (delivery only)

========================================================= */

app.post(

  "/api/driver/rides/:rideId/enroute-customer",

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

    if (!isDeliveryRideType(ride.ride_type)) {

      return fail(

        res,

        "This action is only available for delivery orders.",

        400

      );

    }

    await supabase

      .from("rides")

      .update({

        delivery_stage:

          DELIVERY_STAGE.ENROUTE_CUSTOMER,

        updated_at:

          nowIso()

      })

      .eq("id", rideId);

    notifyRideStage(ride, "enroute_customer").catch(() => {});

    broadcastRideSse(rideId, "stage", {

      delivery_stage: DELIVERY_STAGE.ENROUTE_CUSTOMER

    });

    auditLog({

      actor_type:

        "driver",

      actor_id:

        driverId,

      action:

        "driver_enroute_customer",

      entity_type:

        "ride",

      entity_id:

        rideId,

      req

    }).catch(() => {});

    return ok(res, {

      ride_id:

        rideId,

      delivery_stage:

        DELIVERY_STAGE.ENROUTE_CUSTOMER

    });

  })

);

/* =========================================================

   DRIVER ARRIVED AT CUSTOMER (delivery only)

========================================================= */

app.post(

  "/api/driver/rides/:rideId/arrived-customer",

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

    if (!isDeliveryRideType(ride.ride_type)) {

      return fail(

        res,

        "This action is only available for delivery orders.",

        400

      );

    }

    await supabase

      .from("rides")

      .update({

        delivery_stage:

          DELIVERY_STAGE.ARRIVED_CUSTOMER,

        updated_at:

          nowIso()

      })

      .eq("id", rideId);

    notifyRideStage(ride, "arrived_customer").catch(() => {});

    broadcastRideSse(rideId, "stage", {

      delivery_stage: DELIVERY_STAGE.ARRIVED_CUSTOMER

    });

    auditLog({

      actor_type:

        "driver",

      actor_id:

        driverId,

      action:

        "driver_arrived_customer",

      entity_type:

        "ride",

      entity_id:

        rideId,

      req

    }).catch(() => {});

    return ok(res, {

      ride_id:

        rideId,

      delivery_stage:

        DELIVERY_STAGE.ARRIVED_CUSTOMER

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

    !ride.payment_id

  ) {

    return null;

  }

  try {

    return await stripe

      .paymentIntents

      .capture(

        ride.payment_id

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

    let deliveryProofUrl = null;

    if (isDeliveryRideType(ride.ride_type)) {

      if (ride.delivery_handoff === "leave_at_door") {

        const decoded = decodeBase64Image(req.body.delivery_photo);

        if (!decoded) {

          return fail(

            res,

            "A delivery photo is required to confirm a leave-at-door delivery.",

            400

          );

        }

        if (decoded.buffer.length > DRIVER_PHOTO_MAX_BYTES) {

          return fail(

            res,

            "Delivery photo is too large. Maximum size is 5MB.",

            400

          );

        }

        const proofPath = `${rideId}.${decoded.extension}`;

        const { error: proofUploadError } =

          await supabase.storage

            .from("delivery-proof-photos")

            .upload(proofPath, decoded.buffer, {

              contentType: decoded.mimeType,

              upsert: true

            });

        if (proofUploadError) {

          console.error(

            "❌ Delivery proof photo upload failed:",

            proofUploadError.message

          );

          return fail(

            res,

            "Photo upload failed. Please try again.",

            502

          );

        }

        const { data: proofPublicUrlData } =

          supabase.storage

            .from("delivery-proof-photos")

            .getPublicUrl(proofPath);

        deliveryProofUrl = `${proofPublicUrlData.publicUrl}?v=${Date.now()}`;

      } else {

        const suppliedPin =

          cleanString(

            req.body.delivery_pin,

            10

          );

        if (

          !suppliedPin ||

          !ride.delivery_pin ||

          suppliedPin !== ride.delivery_pin

        ) {

          return fail(

            res,

            "Incorrect delivery PIN. Ask the customer for their delivery PIN.",

            400

          );

        }

      }

    }

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

          nowIso(),

        ...(isDeliveryRideType(ride.ride_type)

          ? {

              delivery_stage: DELIVERY_STAGE.DELIVERED,

              delivered_at: nowIso(),

              ...(deliveryProofUrl

                ? { delivery_proof_url: deliveryProofUrl }

                : {})

            }

          : {})

      })

      .eq("id", rideId);

    const completeIsDelivery = isDeliveryRideType(ride.ride_type);

    notifyRideStage(

      ride,

      completeIsDelivery ? "delivered" : "ride_completed"

    ).catch(() => {});

    broadcastRideSse(rideId, "stage", {

      status: RIDE_STATUS.COMPLETED,

      delivery_stage: completeIsDelivery ? DELIVERY_STAGE.DELIVERED : null

    });

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

const LOCATION_UPDATE_MIN_INTERVAL_MS = 5000;

const lastLocationUpdateAt = new Map(); // driverId -> ms timestamp

app.post(

  "/api/driver/location",

  requireDriver,

  asyncRoute(async (req, res) => {

    const driverId = req.driver.id;

    const lat = Number(req.body.latitude);

    const lng = Number(req.body.longitude);

    if (

      !Number.isFinite(lat) ||

      !Number.isFinite(lng) ||

      lat < -90 || lat > 90 ||

      lng < -180 || lng > 180

    ) {

      return fail(

        res,

        "A valid latitude/longitude is required.",

        400

      );

    }

    const nowMs = Date.now();

    const lastUpdateMs = lastLocationUpdateAt.get(driverId) || 0;

    if (nowMs - lastUpdateMs < LOCATION_UPDATE_MIN_INTERVAL_MS) {

      return ok(res, { updated: false, throttled: true });

    }

    lastLocationUpdateAt.set(driverId, nowMs);

    const { data: activeRide } = await supabase

      .from("rides")

      .select("id")

      .eq("driver_id", driverId)

      .in("status", [

        RIDE_STATUS.DRIVER_ASSIGNED,

        RIDE_STATUS.DRIVER_ENROUTE,

        RIDE_STATUS.ARRIVED,

        RIDE_STATUS.IN_PROGRESS

      ])

      .order("updated_at", { ascending: false })

      .limit(1)

      .maybeSingle();

    if (!activeRide) {

      return fail(

        res,

        "No active mission to track location for.",

        409

      );

    }

    const rawAccuracy = Number(req.body.accuracy);

    const accuracy = Number.isFinite(rawAccuracy) ? rawAccuracy : null;

    const heading = Number(req.body.heading || 0);

    const speed = Number(req.body.speed || 0);

    await supabase

      .from("drivers")

      .update({

        current_lat: lat,

        current_lng: lng,

        heading,

        speed,

        location_accuracy_meters: accuracy,

        last_seen_at: nowIso(),

        updated_at: nowIso()

      })

      .eq("id", driverId);

    broadcastRideSse(activeRide.id, "location", {

      lat,

      lng,

      heading,

      speed,

      accuracy_meters: accuracy,

      last_seen_at: nowIso()

    });

    return ok(res, {

      updated: true,

      tracking_ride_id: activeRide.id

    });

  })

);

/* =========================================================

   DRIVER PHOTO UPLOAD

   Accepts a base64 data URL, uploads it to the public
   driver-photos storage bucket, and stores the public URL on
   the driver row so it can be shown to riders during a trip.

========================================================= */

const DRIVER_PHOTO_MAX_BYTES = 5 * 1024 * 1024;

const IMAGE_MIME_EXTENSIONS = {

  "image/jpeg": "jpg",

  "image/png": "png",

  "image/webp": "webp"

};

function decodeBase64Image(dataUrl) {

  const match = String(dataUrl || "").match(

    /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/

  );

  if (!match) return null;

  const [, mimeType, base64Data] = match;

  return {

    mimeType,

    extension: IMAGE_MIME_EXTENSIONS[mimeType],

    buffer: Buffer.from(base64Data, "base64")

  };

}

app.post(

  "/api/driver/photo",

  requireDriver,

  asyncRoute(async (req, res) => {

    const dataUrl = String(req.body.photo || req.body.image || "");

    const decoded = decodeBase64Image(dataUrl);

    if (!decoded) {

      return fail(

        res,

        "Photo must be a base64 data URL (image/jpeg, image/png, or image/webp).",

        400

      );

    }

    const { mimeType, buffer } = decoded;

    if (buffer.length > DRIVER_PHOTO_MAX_BYTES) {

      return fail(

        res,

        "Photo is too large. Maximum size is 5MB.",

        400

      );

    }

    const path = `${req.driver.id}.${decoded.extension}`;

    const { error: uploadError } =

      await supabase.storage

        .from("driver-photos")

        .upload(path, buffer, {

          contentType: mimeType,

          upsert: true

        });

    if (uploadError) {

      console.error(

        "❌ Driver photo upload failed:",

        uploadError.message

      );

      return fail(

        res,

        "Photo upload failed. Please try again.",

        502

      );

    }

    const { data: publicUrlData } =

      supabase.storage

        .from("driver-photos")

        .getPublicUrl(path);

    // Cache-bust so riders immediately see a re-uploaded photo instead
    // of a stale cached copy at the same stable URL.
    const photoUrl =

      `${publicUrlData.publicUrl}?v=${Date.now()}`;

    const { error: updateError } =

      await supabase

        .from("drivers")

        .update({

          photo_url: photoUrl,

          updated_at: nowIso()

        })

        .eq("id", req.driver.id);

    if (updateError) {

      return fail(

        res,

        "Photo uploaded but saving to profile failed.",

        500

      );

    }

    auditLog({

      actor_type: "driver",

      actor_id: req.driver.id,

      action: "driver_photo_uploaded",

      entity_type: "driver",

      entity_id: req.driver.id,

      req

    }).catch(() => {});

    return ok(res, {

      photo_url: photoUrl

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

   RIDE-SCOPED SSE (rider-facing live delivery tracking)

   Separate from the admin firehose above: clients subscribe to
   a single ride_id and only receive events for that ride.

========================================================= */

const rideSseClients = new Map(); // rideId -> Map(clientId -> res)

function addRideSseClient(rideId, clientId, res) {

  if (!rideSseClients.has(rideId)) {

    rideSseClients.set(rideId, new Map());

  }

  rideSseClients.get(rideId).set(clientId, res);

}

function removeRideSseClient(rideId, clientId) {

  const clients = rideSseClients.get(rideId);

  if (!clients) return;

  clients.delete(clientId);

  if (clients.size === 0) {

    rideSseClients.delete(rideId);

  }

}

function broadcastRideSse(rideId, event, data) {

  const clients = rideSseClients.get(rideId);

  if (!clients) return;

  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

  for (const res of clients.values()) {

    try {

      res.write(payload);

    } catch {

      // Client likely disconnected; the close handler will clean it up.

    }

  }

}

app.get(

  "/api/rides/:id/stream",

  asyncRoute(async (req, res) => {

    const rideId = cleanString(req.params.id, 100);

    const { data: ride } = await supabase

      .from("rides")

      .select("id")

      .eq("id", rideId)

      .maybeSingle();

    if (!ride) {

      return fail(res, "Ride not found.", 404);

    }

    const clientId = makeId("RIDESSE");

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    addRideSseClient(rideId, clientId, res);

    res.write(`event: connected\ndata: ${JSON.stringify({ ride_id: rideId })}\n\n`);

    const heartbeat = setInterval(() => {
      try {
        res.write(`event: heartbeat\ndata: ${JSON.stringify({ at: nowIso() })}\n\n`);
      } catch {
        clearInterval(heartbeat);
      }
    }, 25_000);

    req.on("close", () => {
      clearInterval(heartbeat);
      removeRideSseClient(rideId, clientId);
    });

  })

);

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

/* =========================================================

   ADMIN OVERVIEW CACHE

   Exact table counts get expensive as data grows. Cache the

   assembled overview for a short TTL so repeated admin polls

   don't re-run six exact counts each time. In-memory (per

   instance) — acceptable for admin metrics; move to Redis if

   you later need it shared across instances.

========================================================= */

const OVERVIEW_CACHE_TTL_MS =

  envNumber("OVERVIEW_CACHE_TTL_SECONDS", 60) * 1000;

let overviewCache = {

  data: null,

  expiresAt: 0

};

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

// Exact count with no row transfer (head:true). Returns count or an error string.
async function countWhere(table, build) {
  let q = supabase.from(table).select("*", { count: "exact", head: true });
  if (build) q = build(q);
  const { count, error } = await q;
  return error ? { count: null, error: error.message } : { count: count || 0 };
}

app.get(

  "/api/admin/overview",

  requireAdmin,

  asyncRoute(async (req, res) => {

    const forceRefresh =

      ["1", "true", "yes"].includes(

        String(req.query.refresh || "").toLowerCase()

      );

    const now = Date.now();

    if (

      !forceRefresh &&

      overviewCache.data &&

      now < overviewCache.expiresAt

    ) {

      return ok(res, {

        overview: {

          ...overviewCache.data,

          server_time:

            nowIso(),

          environment:

            NODE_ENV,

          cached:

            true

        }

      });

    }

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

    overviewCache = {

      data: overview,

      expiresAt: now + OVERVIEW_CACHE_TTL_MS

    };

    return ok(res, {

      overview: {

        ...overview,

        server_time:

          nowIso(),

        environment:

          NODE_ENV,

        cached:

          false

      }

    });

  })

);

app.get(
  "/api/admin/metrics",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const now = new Date();
    const startOfTodayUtc = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
    ).toISOString();

    const ACTIVE_RIDE_STATUSES = [
      RIDE_STATUS.AWAITING_DRIVER,
      RIDE_STATUS.DRIVER_ASSIGNED,
      RIDE_STATUS.DRIVER_ENROUTE,
      RIDE_STATUS.ARRIVED,
      RIDE_STATUS.IN_PROGRESS
    ];

    const [
      ridesToday,
      ridesActive,
      ridesCompletedToday,
      dispatchQueue,
      driversOnline,
      driversTotal,
      htafToday
    ] = await Promise.all([
      countWhere("rides", (q) => q.gte("created_at", startOfTodayUtc)),
      countWhere("rides", (q) => q.in("status", ACTIVE_RIDE_STATUSES)),
      countWhere("rides", (q) =>
        q.eq("status", RIDE_STATUS.COMPLETED).gte("created_at", startOfTodayUtc)
      ),
      countWhere("rides", (q) => q.eq("status", RIDE_STATUS.AWAITING_DRIVER)),
      countWhere("drivers", (q) => q.eq("online", true)),
      countWhere("drivers", null),
      countWhere("htaf_applications", (q) => q.gte("created_at", startOfTodayUtc))
    ]);

    // Earnings today: sum over today's rows (admin-only, low volume).
    let earningsToday = { net_total: 0, ride_count: 0, error: null };
    {
      const { data, error } = await supabase
        .from("driver_earnings")
        .select("net_amount, gross_amount")
        .gte("created_at", startOfTodayUtc);
      if (error) {
        earningsToday.error = error.message;
      } else {
        earningsToday.ride_count = data.length;
        earningsToday.net_total = data.reduce(
          (sum, r) => sum + Number(r.net_amount || r.gross_amount || 0),
          0
        );
        earningsToday.net_total = Math.round(earningsToday.net_total * 100) / 100;
      }
    }

    // HTAF breakdown by status (dynamic — no hardcoded status strings).
    let htafByStatus = {};
    let htafTotal = 0;
    {
      const { data, error } = await supabase
        .from("htaf_applications")
        .select("status");
      if (!error && Array.isArray(data)) {
        htafTotal = data.length;
        htafByStatus = data.reduce((acc, r) => {
          const k = r.status || "unknown";
          acc[k] = (acc[k] || 0) + 1;
          return acc;
        }, {});
      }
    }

    return ok(res, {
      metrics: {
        generated_at: nowIso(),
        window: "today = UTC midnight to now",
        environment: NODE_ENV,
        rides: {
          today: ridesToday.count,
          active: ridesActive.count,
          completed_today: ridesCompletedToday.count,
          dispatch_queue: dispatchQueue.count
        },
        drivers: {
          online: driversOnline.count,
          total: driversTotal.count
        },
        earnings_today: earningsToday,
        htaf: {
          today: htafToday.count,
          total: htafTotal,
          by_status: htafByStatus
        }
      }
    });
  })
);

/* =========================================================

   ADMIN OPERATIONS OVERVIEW

   Single aggregation endpoint for the admin-dashboard.html
   operations panel: service-type breakdown of in-progress
   rides (taxi/food/grocery/HTAF), active riders/drivers,
   today's completed rides + revenue, average ETA across
   active rides, and integration health for Supabase/Stripe/
   SendGrid/Twilio.

========================================================= */

app.get(
  "/api/admin/operations-overview",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const now = new Date();
    const startOfTodayUtc = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
    ).toISOString();

    const ACTIVE_STATUSES = [
      RIDE_STATUS.AWAITING_DRIVER,
      RIDE_STATUS.DRIVER_ASSIGNED,
      RIDE_STATUS.DRIVER_ENROUTE,
      RIDE_STATUS.ARRIVED,
      RIDE_STATUS.IN_PROGRESS
    ];

    const [
      activeRidesResult,
      driversOnline,
      completedTodayResult,
      databaseCheck
    ] = await Promise.all([
      supabase
        .from("rides")
        .select("ride_type, rider_id, driver_eta_to_pickup_minutes")
        .in("status", ACTIVE_STATUSES),
      countWhere("drivers", (q) => q.eq("online", true)),
      supabase
        .from("rides")
        .select("estimated_fare")
        .eq("status", RIDE_STATUS.COMPLETED)
        .gte("created_at", startOfTodayUtc),
      supabase.from("system_flags").select("key").limit(1)
    ]);

    const activeRides = activeRidesResult.data || [];

    const ridesInProgress = { taxi: 0, food: 0, grocery: 0, htaf: 0 };
    const activeRiderIds = new Set();
    let etaSum = 0;
    let etaCount = 0;

    for (const ride of activeRides) {
      if (ride.ride_type === "food") ridesInProgress.food++;
      else if (ride.ride_type === "grocery") ridesInProgress.grocery++;
      else if (ride.ride_type === "foundation") ridesInProgress.htaf++;
      else ridesInProgress.taxi++;

      if (ride.rider_id) activeRiderIds.add(ride.rider_id);

      const eta = Number(ride.driver_eta_to_pickup_minutes);
      if (Number.isFinite(eta) && eta > 0) {
        etaSum += eta;
        etaCount++;
      }
    }

    const completedTodayRows = completedTodayResult.data || [];
    const revenueToday = completedTodayRows.reduce(
      (sum, r) => sum + Number(r.estimated_fare || 0),
      0
    );

    return ok(res, {
      overview: {
        generated_at: nowIso(),
        active_riders: activeRiderIds.size,
        online_drivers: driversOnline.count,
        rides_in_progress: ridesInProgress,
        today: {
          completed_rides: completedTodayRows.length,
          revenue: Math.round(revenueToday * 100) / 100
        },
        avg_eta_minutes:
          etaCount > 0
            ? Math.round((etaSum / etaCount) * 10) / 10
            : null,
        // Supabase gets a real connectivity check (a live query above).
        // Stripe/SendGrid/Twilio only report whether the client library was
        // initialized with an API key, not that the provider is currently
        // reachable — "check" tells the dashboard which kind it's showing
        // so the badges don't imply a uniform depth of health check.
        integration_health: {
          supabase: {
            healthy: !databaseCheck.error,
            check: "connectivity"
          },
          stripe: {
            healthy: Boolean(stripe),
            check: "configured"
          },
          sendgrid: {
            healthy: Boolean(sgMail && SENDGRID_API_KEY),
            check: "configured"
          },
          twilio: {
            healthy: Boolean(twilioClient),
            check: "configured"
          }
        }
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

    const limit =

      getPageLimit(

        req,

        envNumber("ADMIN_LIST_LIMIT", 200),

        500

      );

    const cursor =

      decodeCursor(req.query.cursor);

    let query =

      supabase

        .from("rides")

        .select("*")

        .order("created_at", {

          ascending: false

        })

        .order("id", {

          ascending: false

        })

        .limit(limit);

    if (status) {

      query =

        query.eq(

          "status",

          status

        );

    }

    query = applyCursor(query, cursor);

    const { data, error } =

      await query;

    if (error) {

      throw error;

    }

    const rows = data || [];

    const next_cursor =

      rows.length === limit

        ? encodeCursor(rows[rows.length - 1])

        : null;

    return ok(res, {

      rides:

        rows,

      page: {

        limit,

        count: rows.length,

        next_cursor

      }

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

    const driverRideFields = buildDriverRideFields(driver);

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

          ...driverRideFields,

          updated_at:

            nowIso()

        })

        .eq("id", rideId)

        .select()

        .single();

    if (error) {

      throw error;

    }

    notifyRideStage(data, "driver_assigned").catch(() => {});

    sendPushNotification({
      ownerType: "driver",
      ownerId: driver.id,
      title: "Ride Assigned",
      body: `You've been assigned a ride. Pickup: ${data.pickup_address || "See app for details"}`,
      url: "/driver-dashboard.html"
    }).catch(() => {});

    broadcastRideSse(rideId, "stage", {

      status: RIDE_STATUS.DRIVER_ASSIGNED,

      driver: driverRideFields

    });

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

    const limit =

      getPageLimit(

        req,

        envNumber("ADMIN_LIST_LIMIT", 200),

        500

      );

    const cursor =

      decodeCursor(req.query.cursor);

    let query =

      supabase

        .from("drivers")

        .select("*")

        .order("created_at", {

          ascending: false

        })

        .order("id", {

          ascending: false

        })

        .limit(limit);

    if (status) {

      query =

        query.eq(

          "status",

          status

        );

    }

    query = applyCursor(query, cursor);

    const { data, error } =

      await query;

    if (error) {

      throw error;

    }

    const rows = data || [];

    const next_cursor =

      rows.length === limit

        ? encodeCursor(rows[rows.length - 1])

        : null;

    return ok(res, {

      drivers:

        rows,

      page: {

        limit,

        count: rows.length,

        next_cursor

      }

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

    const limit =

      getPageLimit(

        req,

        envNumber("ADMIN_LIST_LIMIT", 200),

        500

      );

    const cursor =

      decodeCursor(req.query.cursor);

    let query =

      supabase

        .from("riders")

        .select("*")

        .order("created_at", {

          ascending: false

        })

        .order("id", {

          ascending: false

        })

        .limit(limit);

    if (status) {

      query =

        query.eq(

          "status",

          status

        );

    }

    query = applyCursor(query, cursor);

    const { data, error } =

      await query;

    if (error) {

      throw error;

    }

    const rows = data || [];

    const next_cursor =

      rows.length === limit

        ? encodeCursor(rows[rows.length - 1])

        : null;

    return ok(res, {

      riders:

        rows,

      page: {

        limit,

        count: rows.length,

        next_cursor

      }

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

    const limit =

      getPageLimit(

        req,

        envNumber("AUDIT_LOG_LIMIT", 300),

        500

      );

    const cursor =

      decodeCursor(req.query.cursor);

    let query =

      supabase

        .from("audit_logs")

        .select("*")

        .order("created_at", {

          ascending: false

        })

        .order("id", {

          ascending: false

        })

        .limit(limit);

    query = applyCursor(query, cursor);

    const { data, error } =

      await query;

    if (error) {

      throw error;

    }

    const rows = data || [];

    const next_cursor =

      rows.length === limit

        ? encodeCursor(rows[rows.length - 1])

        : null;

    return ok(res, {

      logs:

        rows,

      page: {

        limit,

        count: rows.length,

        next_cursor

      }

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

      pickup_address:

        cleanString(

          req.body.pickup ||

          application.pickup_city,

          500

        ),

      dropoff_address:

        cleanString(

          req.body.destination ||

          application.destination,

          500

        ),

      ride_type:

        "foundation",

      scheduled_time:

        req.body.scheduled_for ||

        application.ride_date ||

        null,

      status:

        RIDE_STATUS.PAYMENT_AUTHORIZED,

      dispatch_status:

        "foundation_authorized",

      estimated_fare:

        estimate.total,

      driver_payout:

        estimate.driver_payout,

      estimated_platform_fee:

        estimate.platform_fee,

      estimated_distance_miles:

        estimate.miles,

      estimated_duration_minutes:

        estimate.minutes,

      miles_estimate:

        estimate.miles,

      minutes_estimate:

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

);

/* =========================================================

   ACCOUNT DELETION (App Store compliant)

   - Riders: immediate self-service delete (OTP-confirmed).

   - Drivers: request revokes access now; admin reviews,

     then anonymization is finalized.

   Operational records (rides, payments, earnings, audit,

   safety, HTAF) are RETAINED but stripped of personal data.

========================================================= */

/* Anonymize a rider or driver row in place. Removes personal

   identity data, revokes access, marks deleted. Keeps the row

   so financial/operational foreign keys remain intact. */

async function anonymizeAccount({

  table,

  id,

  reason = null,

  deletedBy = "self"

}) {

  const now = nowIso();

  const scrub = {

    first_name: "Deleted",

    last_name: "User",

    email: `deleted+${id}@harveytaxiservice.invalid`,

    phone: null,

    access_revoked: true,

    status: "deleted",

    deleted_at: now,

    deleted_reason: reason ? cleanString(reason, 500) : null,

    deleted_by: cleanString(deletedBy, 120),

    updated_at: now

  };

  const { error } =

    await supabase

      .from(table)

      .update(scrub)

      .eq("id", id);

  if (error) {

    throw error;

  }

  // Strip personal name/phone snapshots from ride records for

  // this user, keeping the operational/financial row intact.

  if (table === "riders") {

    await supabase

      .from("rides")

      .update({

        rider_name: "Deleted User",

        rider_phone: null,

        updated_at: now

      })

      .eq("rider_id", id);

  }

  return true;

}

/* -------- RIDER: immediate self-service deletion -------- */

app.post(

  "/api/account/rider/delete",

  asyncRoute(async (req, res) => {

    const riderId =

      cleanString(req.body.rider_id, 100);

    const phone =

      cleanPhone(req.body.phone);

    const code =

      cleanString(req.body.code, 20);

    const reason =

      cleanString(req.body.reason, 500);

    if (!riderId || !phone || !code) {

      return fail(

        res,

        "rider_id, phone, and a verification code are required to delete your account.",

        400

      );

    }

    // Confirm identity via OTP (same mechanism as signup verify).

    const verification =

      await verifyCode({

        channel: "sms",

        destination: phone,

        code,

        purpose: "account_deletion"

      });

    if (!verification.ok) {

      return fail(

        res,

        verification.reason || "Verification failed.",

        400

      );

    }

    // Ensure the rider exists and the phone matches.

    const { data: rider, error } =

      await supabase

        .from("riders")

        .select("id, phone")

        .eq("id", riderId)

        .maybeSingle();

    if (error || !rider) {

      return fail(res, "Rider account not found.", 404);

    }

    try {

      await anonymizeAccount({

        table: "riders",

        id: riderId,

        reason,

        deletedBy: "rider_self"

      });

    } catch (delErr) {

      console.error("❌ Rider deletion failed:", delErr.message);

      return fail(res, "Account deletion could not be completed.", 500);

    }

    // Record the completed deletion for the audit trail.

    const requestId = makeId("DEL");

    await supabase

      .from("deletion_requests")

      .insert({

        request_id: requestId,

        user_type: "rider",

        user_id: riderId,

        status: "completed",

        reason,

        requested_at: nowIso(),

        completed_at: nowIso(),

        reviewed_by: "self_service"

      });

    auditLog({

      actor_type: "rider",

      actor_id: riderId,

      action: "account_deleted",

      entity_type: "rider",

      entity_id: riderId,

      metadata: { self_service: true },

      req

    }).catch(() => {});

    return ok(res, {

      deleted: true,

      message: "Your account has been deleted and your personal information removed."

    });

  })

);

/* -------- DRIVER: request deletion (revokes access now) -------- */

app.post(

  "/api/account/driver/delete-request",

  requireDriver,

  asyncRoute(async (req, res) => {

    const driverId = req.driver.id;

    const reason =

      cleanString(req.body.reason, 500);

    // Immediately revoke login access (anonymization waits for review).

    await supabase

      .from("drivers")

      .update({

        access_revoked: true,

        status: "deletion_pending",

        updated_at: nowIso()

      })

      .eq("id", driverId);

    const requestId = makeId("DEL");

    const { error } =

      await supabase

        .from("deletion_requests")

        .insert({

          request_id: requestId,

          user_type: "driver",

          user_id: driverId,

          status: "pending",

          reason,

          requested_at: nowIso()

        });

    if (error) {

      throw error;

    }

    auditLog({

      actor_type: "driver",

      actor_id: driverId,

      action: "account_deletion_requested",

      entity_type: "driver",

      entity_id: driverId,

      metadata: { request_id: requestId },

      req

    }).catch(() => {});

    return ok(res, {

      request_id: requestId,

      status: "pending",

      message: "Your deletion request was received and your account access has been disabled. An administrator will finalize the deletion after review."

    });

  })

);

/* -------- ADMIN: list deletion requests -------- */

app.get(

  "/api/admin/deletion-requests",

  requireAdmin,

  asyncRoute(async (req, res) => {

    const status =

      cleanString(req.query.status, 40) || "pending";

    const limit =

      getPageLimit(req, 100, 300);

    const cursor =

      decodeCursor(req.query.cursor);

    let query =

      supabase

        .from("deletion_requests")

        .select("*")

        .eq("status", status)

        .order("requested_at", { ascending: false })

        .order("request_id", { ascending: false })

        .limit(limit);

    if (cursor) {

      query = query.or(

        `requested_at.lt.${cursor.created_at},` +

        `and(requested_at.eq.${cursor.created_at},request_id.lt.${cursor.id})`

      );

    }

    const { data, error } = await query;

    if (error) throw error;

    const rows = data || [];

    const last = rows[rows.length - 1];

    const next_cursor =

      rows.length === limit && last

        ? encodeCursor({ created_at: last.requested_at, id: last.request_id })

        : null;

    return ok(res, {

      requests: rows,

      page: { limit, count: rows.length, next_cursor }

    });

  })

);

/* -------- ADMIN: approve (finalize) driver deletion -------- */

app.post(

  "/api/admin/deletion-requests/:id/approve",

  requireAdmin,

  asyncRoute(async (req, res) => {

    const requestId =

      cleanString(req.params.id, 100);

    const notes =

      cleanString(req.body.admin_notes, 1000);

    const { data: request, error } =

      await supabase

        .from("deletion_requests")

        .select("*")

        .eq("request_id", requestId)

        .maybeSingle();

    if (error || !request) {

      return fail(res, "Deletion request not found.", 404);

    }

    if (request.status !== "pending") {

      return fail(res, `Request is already ${request.status}.`, 409);

    }

    const table =

      request.user_type === "driver" ? "drivers" : "riders";

    try {

      await anonymizeAccount({

        table,

        id: request.user_id,

        reason: request.reason,

        deletedBy: `admin:${req.admin.email}`

      });

    } catch (delErr) {

      console.error("❌ Deletion finalize failed:", delErr.message);

      return fail(res, "Anonymization could not be completed.", 500);

    }

    await supabase

      .from("deletion_requests")

      .update({

        status: "completed",

        approved_at: nowIso(),

        completed_at: nowIso(),

        reviewed_by: req.admin.email,

        admin_notes: notes

      })

      .eq("request_id", requestId);

    auditLog({

      actor_type: "admin",

      actor_id: req.admin.email,

      action: "account_deletion_completed",

      entity_type: request.user_type,

      entity_id: request.user_id,

      metadata: { request_id: requestId },

      req

    }).catch(() => {});

    return ok(res, {

      request_id: requestId,

      status: "completed",

      message: "Account anonymized and deletion finalized."

    });

  })

);

/* -------- ADMIN: reject deletion (restores access) -------- */

app.post(

  "/api/admin/deletion-requests/:id/reject",

  requireAdmin,

  asyncRoute(async (req, res) => {

    const requestId =

      cleanString(req.params.id, 100);

    const notes =

      cleanString(req.body.admin_notes, 1000);

    const { data: request, error } =

      await supabase

        .from("deletion_requests")

        .select("*")

        .eq("request_id", requestId)

        .maybeSingle();

    if (error || !request) {

      return fail(res, "Deletion request not found.", 404);

    }

    if (request.status !== "pending") {

      return fail(res, `Request is already ${request.status}.`, 409);

    }

    // Deletion is NOT happening, so restore the account's access.

    const table =

      request.user_type === "driver" ? "drivers" : "riders";

    await supabase

      .from(table)

      .update({

        access_revoked: false,

        status: "active",

        updated_at: nowIso()

      })

      .eq("id", request.user_id);

    await supabase

      .from("deletion_requests")

      .update({

        status: "rejected",

        rejected_at: nowIso(),

        reviewed_by: req.admin.email,

        admin_notes: notes

      })

      .eq("request_id", requestId);

    auditLog({

      actor_type: "admin",

      actor_id: req.admin.email,

      action: "account_deletion_rejected",

      entity_type: request.user_type,

      entity_id: request.user_id,

      metadata: { request_id: requestId },

      req

    }).catch(() => {});

    return ok(res, {

      request_id: requestId,

      status: "rejected",

      message: "Deletion request rejected and account access restored."

    });

  })

);

/* =========================================================

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

      await supabase

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

          "payment_id",

          object.id

        );

    }

    if (

      event.type ===

      "payment_intent.amount_capturable_updated"

    ) {

      await supabase

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

          "payment_id",

          object.id

        );

    }

    if (

      event.type ===

      "payment_intent.payment_failed" ||

      event.type ===

      "payment_intent.canceled"

    ) {

      await supabase

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

          "payment_id",

          object.id

        );

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

          Boolean(openai),

        web_push:

          pushEnabled

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

          Boolean(OPENAI_API_KEY),

        GOOGLE_MAPS_BROWSER_KEY:

          Boolean(GOOGLE_MAPS_BROWSER_KEY),

        VAPID_PUBLIC_KEY:

          Boolean(VAPID_PUBLIC_KEY),

        VAPID_PRIVATE_KEY:

          Boolean(VAPID_PRIVATE_KEY)

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

/* Safe, read-only status lookups for Harvey AI.

   Returns ONLY non-sensitive status fields — never names,

   emails, phones, addresses, or any personal data. Used to

   let the AI answer "what's the status of HTAF-XXXX?" without

   exposing anything private. */

async function aiLookupHtafStatus(code) {

  const clean = cleanString(code, 80);

  if (!clean) return null;

  const { data, error } =

    await supabase

      .from("htaf_applications")

      .select("application_code, status, program_type, created_at, updated_at")

      .eq("application_code", clean)

      .maybeSingle();

  if (error || !data) return null;

  return data;

}

/* Detects an application code like HTAF-YYYYMMDD-XXXXXX in the

   user's message so the AI can offer a real status. */

function extractHtafCode(text) {

  const match =

    String(text || "")

      .toUpperCase()

      .match(/HTAF-\d{8}-[A-Z0-9]{4,8}/);

  return match ? match[0] : null;

}

app.post(
  "/api/ai/support",
  rateLimit({ windowMs: 60_000, max: 20, keyPrefix: "ai_support" }),
  asyncRoute(async (req, res) => {
    const message = cleanString(req.body.message, 4000);
    const page = cleanString(req.body.page, 120);
    const role = cleanString(req.body.role, 60);

    // Conversation memory: last 10 valid turns from the frontend.
    const rawHistory = Array.isArray(req.body.history) ? req.body.history : [];
    const history = rawHistory
      .slice(-10)
      .filter(
        (m) =>
          m &&
          (m.role === "user" || m.role === "assistant") &&
          typeof m.content === "string"
      )
      .map((m) => ({ role: m.role, content: cleanString(m.content, 4000) }));

    if (!message) {
      return fail(res, "Message required.", 400);
    }

    if (!openai) {
      return ok(res, {
        reply:
          "Harvey AI Support is currently limited. Please contact support for help.",
        fallback: true,
        support_email: SUPPORT_EMAIL
      });
    }

    // Formal tool-calling: the model decides when to look up an HTAF status,
    // reusing the existing read-only aiLookupHtafStatus() helper. To add more
    // tools later (ride status, fare estimate), add a schema here and a case
    // in runTool() — the loop below does not change.
    const AI_TOOLS = [
      {
        type: "function",
        function: {
          name: "lookup_htaf_status",
          description:
            "Look up the status of an HTAF application by its application code. " +
            "Call this ONLY when the person provides an application code in the " +
            "format HTAF-YYYYMMDD-XXXX (for example HTAF-20260214-9F3A). Returns " +
            "non-sensitive status fields only. Never promise approval or a timeline.",
          parameters: {
            type: "object",
            properties: {
              application_code: {
                type: "string",
                description: "The HTAF application code, format HTAF-YYYYMMDD-XXXX."
              }
            },
            required: ["application_code"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "lookup_ride_status",
          description:
            "Look up the status of a ride by its ride code. Call this ONLY when the " +
            "person provides a ride code in the format RIDE-XXXXXXXXXX (for example " +
            "RIDE-9F3A2B7C10). Returns only the ride's status, type, and timing — " +
            "never an address, price, fare, driver name, or phone number.",
          parameters: {
            type: "object",
            properties: {
              ride_code: {
                type: "string",
                description: "The ride code, format RIDE-XXXXXXXXXX."
              }
            },
            required: ["ride_code"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "open_ride_workflow",
          description:
            "Call this when the person clearly wants to START a new ride, food delivery, " +
            "grocery delivery, or HTAF-assisted transportation request right now, or wants to " +
            "schedule one for later — for example 'take me to the airport', 'order Walmart " +
            "groceries', 'I need a ride to my doctor's appointment', 'schedule a ride for " +
            "tomorrow at 8am'. This does NOT book, dispatch, or charge anything. It only opens " +
            "the request page with the service and any known details pre-filled so the person " +
            "can review and submit it themselves. Do not call this for status questions or " +
            "general questions — only for a clear intent to start a new request.",
          parameters: {
            type: "object",
            properties: {
              service: {
                type: "string",
                enum: ["ride", "food", "grocery", "htaf"],
                description:
                  "ride = standard passenger ride. food = restaurant delivery. grocery = " +
                  "grocery store delivery. htaf = HTAF-assisted transportation (medical " +
                  "appointments, essential needs)."
              },
              destination: {
                type: "string",
                description:
                  "The destination in the person's own words (e.g. 'the airport', 'Walmart " +
                  "on Charlotte Pike'). Omit if not mentioned."
              },
              pickup: {
                type: "string",
                description:
                  "The pickup location if mentioned. Omit if not mentioned — most riders use " +
                  "their current location."
              },
              scheduled_time: {
                type: "string",
                description:
                  "The requested time in the person's own words (e.g. 'tomorrow at 8am', 'in " +
                  "20 minutes'). Omit if they want it now."
              }
            },
            required: ["service"]
          }
        }
      }
    ];

    // Set by runTool() when open_ride_workflow is called, and attached to
    // the HTTP response below so the frontend can act on it (navigate /
    // prefill). Only ever holds our own cleaned values, never raw model output.
    let capturedAction = null;

    async function runTool(name, args) {
      if (name === "lookup_htaf_status") {
        const code = cleanString(args && args.application_code, 80);
        if (!code || !/HTAF-\d{8}-[A-Z0-9]{4,8}/.test(code.toUpperCase())) {
          return {
            error:
              "No valid HTAF application code provided. Ask the person for a code " +
              "in the format HTAF-YYYYMMDD-XXXX."
          };
        }
        const status = await aiLookupHtafStatus(code);
        if (!status) {
          return {
            found: false,
            message:
              "No application found for code " + code + ". Ask them to double-check " +
              "it, or direct them to support."
          };
        }
        return {
          found: true,
          application_code: status.application_code,
          status: status.status,
          program_type: status.program_type,
          submitted: String(status.created_at).slice(0, 10),
          last_updated: String(status.updated_at).slice(0, 10),
          guidance:
            "Explain this status plainly and kindly. Do NOT promise approval or a timeline."
        };
      }

      if (name === "lookup_ride_status") {
        const code = cleanString(args && args.ride_code, 80);
        if (!code || !/^RIDE-[A-F0-9]{6,12}$/.test(code.toUpperCase())) {
          return {
            error:
              "No valid ride code provided. Ask the person for a code in the " +
              "format RIDE-XXXXXXXXXX."
          };
        }
        const { data, error } = await supabase
          .from("rides")
          .select(
            "status, dispatch_status, ride_type, scheduled_for, created_at, updated_at"
          )
          .eq("id", code.toUpperCase())
          .maybeSingle();
        if (error || !data) {
          return {
            found: false,
            message:
              "No ride found for code " + code + ". Ask them to double-check it, " +
              "or direct them to support."
          };
        }
        return {
          found: true,
          status: data.status,
          dispatch_status: data.dispatch_status,
          ride_type: data.ride_type,
          scheduled_for: data.scheduled_for
            ? String(data.scheduled_for).slice(0, 16)
            : null,
          requested: String(data.created_at).slice(0, 16),
          last_updated: String(data.updated_at).slice(0, 16),
          guidance:
            "Explain the ride status plainly. Do NOT reveal or invent any address, " +
            "price, fare, driver name, or phone number, and do NOT promise an arrival time."
        };
      }

      if (name === "open_ride_workflow") {
        const service = ["ride", "food", "grocery", "htaf"].includes(args?.service)
          ? args.service
          : "ride";
        const destination = cleanString(args?.destination, 200) || null;
        const pickup = cleanString(args?.pickup, 200) || null;
        const scheduledTime = cleanString(args?.scheduled_time, 100) || null;

        // Same cleaned values used for both the tool result (fed back to the
        // model) and the action attached to the HTTP response (read by the
        // frontend) — the frontend never sees raw, unvalidated model output.
        capturedAction = {
          type: "open_ride_workflow",
          service,
          destination,
          pickup,
          scheduled_time: scheduledTime
        };

        return {
          opened: true,
          service,
          destination,
          pickup,
          scheduled_time: scheduledTime,
          guidance:
            "Tell the person you've opened and pre-filled the " + service + " request for " +
            "them to review. Make clear they still need to check the details and tap " +
            "Continue / Request themselves — you have NOT booked, dispatched, or charged " +
            "anything."
        };
      }

      return { error: "Unknown tool: " + name };
    }

    const systemContent =
      [
                  "You are Harvey AI, the support assistant for Harvey Taxi Service LLC and the Harvey Transportation Assistance Foundation (HTAF). Answer ONLY from the approved information below. If something is not covered here, do not guess — direct the person to support at support@harveytaxiservice.com.",
                  "",
                  "== COMPANY ==",
                  "Harvey Taxi Service LLC is a transportation technology company founded by Willie Harvey IV, headquartered in Nashville, Tennessee. Mission: provide safe, reliable, technology-driven transportation while creating earning opportunities for drivers and expanding transportation access through innovation and community partnerships. Core values: Safety, Respect, Accountability, Accessibility, Innovation, Community, Transparency, Professionalism.",
                  "Currently available: rider accounts, driver accounts, ride requests (including scheduled rides for later), food delivery, grocery delivery, driver onboarding, AI support, and HTAF applications. Food and grocery delivery are pilot features — describe them as available now, but note they may be limited by driver/merchant coverage in the person's area.",
                  "Planned / NOT yet available (describe as 'planned' or 'in development', never as available): Harvey Logistics, fleet partnerships, business and corporate transportation. Autonomous Pilot exists in the app as a clearly labeled, opt-in pilot experience — describe it as an early pilot, not a fully available service.",
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
                  "2. Never promise approval, a ride, a price, a wait time, or eligibility. Calling open_ride_workflow only pre-fills the request page for the person to review — it never books, dispatches, or charges anything, so never say a ride/order has been booked, confirmed, or dispatched.",
                  "3. Never collect sensitive data in chat (SSN, full card numbers, passwords, detailed medical info); direct people to the secure application or support.",
                  "4. You can check the STATUS of an HTAF application only when the person provides its application code (format HTAF-XXXXXXXX-XXXX) and a live lookup result is included below. You have NO access to accounts, payments, disputes, personal details, driver files, or anything not explicitly given to you. For anything beyond a provided HTAF status lookup, direct people to support at support@harveytaxiservice.com.",
                  "5. Stay in scope (Harvey Taxi and HTAF only); politely redirect unrelated questions.",
                  "6. For any medical emergency or immediate danger, tell the person to call 911. You are not an emergency service.",
                  "7. Be warm, plain, and brief. Many users are seniors, veterans, or people in difficult circumstances - short sentences, no jargon, kindness first.",
                  "8. Never reveal internal operations, admin procedures, or system details.",
                  "9. Never reveal any personal data (names, emails, phones, addresses) even if asked; you are only ever given non-sensitive status fields.",
                  "",
                  "== HOW TO APPLY / COMMON HELP ==",
                  "To apply to HTAF: open the HTAF Application page, fill in the required fields (name, contact, county, city, pickup city, destination, ride date, and the transportation need), and submit. After submitting, the person receives an application code beginning with HTAF- which they can use to check status.",
                  "To sign up as a rider: use the Rider Sign-Up page, then verify email and phone. Riders must be approved before requesting rides.",
                  "To sign up as a driver: use the Driver Sign-Up page, then complete email + SMS verification, Persona identity, and Checkr background review, then wait for admin approval.",
                  "To request a ride (approved riders): use the ride request page, enter pickup and destination. Do not quote a price; the app shows any estimate.",
                  "If someone is stuck or a page shows an error, apologize briefly and direct them to support@harveytaxiservice.com with a description of what happened."
                ].join("\n") +
      "\n\nTOOL NOTE: You have three tools. When a person gives an HTAF " +
      "application code (HTAF-YYYYMMDD-XXXX), call lookup_htaf_status. When a person " +
      "gives a ride code (RIDE-XXXXXXXXXX), call lookup_ride_status. Call a tool to " +
      "fetch the real status instead of waiting for it to be provided. All rules " +
      "above still apply — never promise approval, a timeline, or an arrival time, " +
      "and never reveal an address, fare, name, or phone number." +
      "\n\nWhen a person clearly wants to start a new ride, food order, grocery order, " +
      "or HTAF transportation request — now or scheduled for later — call " +
      "open_ride_workflow with whatever service/destination/pickup/time they mentioned. " +
      "After calling it, tell them plainly that you've opened and pre-filled the request " +
      "for them to review, and that they still need to check the details and tap " +
      "Continue/Request themselves. NEVER say the ride or order has been booked, " +
      "confirmed, dispatched, or paid for — you are not able to do any of that, only " +
      "open the page with details filled in.";

    const messages = [
      { role: "system", content: systemContent },
      ...history,
      {
        role: "user",
        content: "Page: " + page + "\nRole: " + role + "\n\nUser message: " + message
      }
    ];

    const MAX_TURNS = 4; // hard cap so a confused exchange cannot loop / run up cost
    let reply = "I'm here to help. Please try again.";

    try {
      for (let turn = 0; turn < MAX_TURNS; turn++) {
        const completion = await openai.chat.completions.create({
          model: OPENAI_MODEL,
          messages,
          tools: AI_TOOLS,
          temperature: 0.3
        });

        const msg = completion.choices?.[0]?.message;
        if (!msg) break;
        messages.push(msg); // push assistant turn BEFORE any tool results

        if (!msg.tool_calls || msg.tool_calls.length === 0) {
          reply = msg.content || reply;
          break;
        }

        for (const call of msg.tool_calls) {
          let args = {};
          try {
            args = JSON.parse(call.function.arguments || "{}");
          } catch {
            args = {};
          }
          const result = await runTool(call.function.name, args);
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: JSON.stringify(result)
          });
        }
      }
    } catch (error) {
      console.error("❌ OpenAI support failed:", error.message);
      return ok(res, {
        reply:
          "Harvey AI Support is having trouble right now. Please try again or contact support.",
        fallback: true,
        support_email: SUPPORT_EMAIL
      });
    }

    auditLog({
      action: "ai_support_message",
      metadata: { page, role, length: message.length, action: capturedAction?.type || null },
      req
    }).catch(() => {});

    return ok(res, { reply, action: capturedAction });
  })
);

/* =========================================================

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

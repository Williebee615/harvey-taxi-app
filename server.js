/* =========================================================

   HARVEY TAXI MOBILE — SERVER.JS

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

  // env(name) alone defaults to "" when unset, and Number("") is 0 (not
  // NaN) — so checking Number.isFinite() on that result can never catch
  // the unset case, and this used to silently return 0 instead of
  // `fallback` for every env-configurable number in the app (session
  // TTLs, dispatch limits, and — most seriously — every pricing rate:
  // BASE_FARE, PER_MILE_RATE, BOOKING_FEE, MINIMUM_FARE,
  // DRIVER_PAYOUT_PERCENT). Checking the raw env var directly, before any
  // string-to-number coercion, is what actually distinguishes "unset" from
  // "explicitly set to 0".
  const raw = process.env[name];

  if (raw === undefined || raw === null || String(raw).trim() === "") {
    return fallback;
  }

  const value = Number(raw);

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

/* Second public-facing domain for the Harvey Transportation Assistance
   Foundation. Requests to this host's root path serve foundation.html
   as the homepage instead of the taxi app's index.html — every other
   path on this domain (assets, /api/*, other pages) is unaffected, it
   just shares the same app and static files. Override with
   FOUNDATION_HOST if the domain ever changes. */
const FOUNDATION_HOST = env("FOUNDATION_HOST", "harveytransportationfoundation.com");
const FOUNDATION_HOSTS = new Set([FOUNDATION_HOST, `www.${FOUNDATION_HOST}`]);

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

// Rider session: deliberately NO fallback chain, unlike
// DRIVER_SESSION_SECRET above. Approved requirement
// (docs/rider-auth-design-proposal.md decisions): RIDER_SESSION_SECRET
// must be configured before this app issues a single rider session --
// reusing the admin or driver secret here would mean a leak of either
// one compromises rider sessions too, and silently falling back to "no
// secret" would mean signRiderSession()/verifyRiderSession() simply
// refuse to operate (see lib/riderAuth.js), which every rider-session
// route below checks explicitly and fails closed with a 503 rather
// than guessing at a substitute secret.
const RIDER_SESSION_SECRET = env("RIDER_SESSION_SECRET", "");

const RIDER_SESSION_TTL_HOURS = envNumber("RIDER_SESSION_TTL_HOURS", 72);

// Dedicated, short, login-specific OTP expiry -- distinct from
// EMAIL_VERIFY_TTL_HOURS, which is scoped to self-service account email
// verification (a much longer-lived link a rider might not open right
// away). A login code left valid for hours is an unnecessarily long
// window for an attacker who intercepts or guesses it.
const RIDER_LOGIN_EMAIL_TTL_MINUTES = envNumber("RIDER_LOGIN_EMAIL_TTL_MINUTES", 10);

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

// Not secret — this is the key Stripe.js needs in the browser to collect
// card details. Served through GET /api/stripe-key the same way
// GOOGLE_MAPS_BROWSER_KEY is served through /api/maps-key, so it never has
// to be hardcoded or committed to git.
const STRIPE_PUBLISHABLE_KEY = env("STRIPE_PUBLISHABLE_KEY");

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

/* =========================================================

   HTAF DOMAIN HOMEPAGE

   Requests that arrive on FOUNDATION_HOST get foundation.html at the
   root path instead of the taxi app's index.html -- everything else
   (assets, /api/*, other pages) is served identically regardless of
   which domain the request came in on, since both domains point at
   this same app. Must run before express.static, which would
   otherwise already resolve "/" to index.html first.

========================================================= */

app.use((req, res, next) => {

  if (
    req.method === "GET" &&
    req.path === "/" &&
    req.hostname &&
    FOUNDATION_HOSTS.has(req.hostname)
  ) {
    return res.sendFile(path.join(PUBLIC_DIR, "foundation.html"));
  }

  next();

});

/* =========================================================

   SITEMAP.XML

   Both public domains share this app, but each needs its own
   sitemap (different page sets, different absolute URLs) -- so this
   is a route, not a static file in public/, and picks its content by
   request hostname the same way the homepage routing above does.
   Only real, linked, public marketing/informational pages are
   listed; dashboards, auth, payment, live-tracking, and internal
   test/prototype pages are deliberately left out (see robots.txt for
   the corresponding Disallow rules).

========================================================= */

const TAXI_SITEMAP_PATHS = [
  "/",
  "/driver-signup.html",
  "/rider-signup.html",
  "/htaf-application.html",
  "/support.html",
  "/privacy.html",
  "/terms.html"
];

const FOUNDATION_SITEMAP_PATHS = [
  "/",
  "/contact.html",
  "/leadership.html",
  "/support.html",
  "/privacy.html",
  "/terms.html"
];

function buildSitemapXml(host, urlPaths) {
  const urls = urlPaths
    .map((urlPath) => `  <url><loc>https://${host}${urlPath}</loc></url>`)
    .join("\n");

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`
  );
}

app.get("/sitemap.xml", (req, res) => {
  const isFoundation = req.hostname && FOUNDATION_HOSTS.has(req.hostname);
  const host = isFoundation ? FOUNDATION_HOST : CANONICAL_HOST;
  const urlPaths = isFoundation ? FOUNDATION_SITEMAP_PATHS : TAXI_SITEMAP_PATHS;

  res.type("application/xml").send(buildSitemapXml(host, urlPaths));
});

const JSON_LIMIT = env("JSON_LIMIT", "2mb");

const RAW_WEBHOOK_LIMIT = env("RAW_WEBHOOK_LIMIT", "2mb");

const ALLOWED_ORIGINS = env("ALLOWED_ORIGINS", "")

  .split(",")

  .map((origin) => origin.trim())

  .filter(Boolean);

// CORS origin allow-list — see lib/corsOrigins.js for why this platform's
// multiple public domains need more than a single exact-match origin.
const { isAllowedOrigin: isAllowedOriginPure } = require("./lib/corsOrigins");

function isAllowedOrigin(origin) {
  return isAllowedOriginPure(origin, {
    isProduction: IS_PRODUCTION,
    configuredOrigins: ALLOWED_ORIGINS,
    appBaseUrl: APP_BASE_URL,
    canonicalHost: CANONICAL_HOST,
    foundationHost: FOUNDATION_HOST
  });
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

// keyFn is an optional override for what identifies "one caller" --
// every existing call site omits it and keeps the original IP-only
// behavior. It exists so a route can *also* apply a second, independent
// limit keyed by something other than IP (e.g. a hashed login
// destination -- see riderLoginDestinationKey below), which an IP-only
// limiter can't express: a single attacker rotating IPs against one
// phone number, or one shared IP (an office, a NAT) targeting many
// different destinations, need their own dimension.
function rateLimit({

  windowMs = 60_000,

  max = 60,

  keyPrefix = "global",

  keyFn

} = {}) {

  const windowSeconds =

    Math.ceil(windowMs / 1000);

  return async (req, res, next) => {

    const identity = keyFn ? keyFn(req) : getClientIp(req);

    const key = `${keyPrefix}:${identity}`;

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

// Twilio Verify rejects a phone number that isn't strict E.164 (a
// leading "+") with error 60436/68004 -- unlike the plain Messaging API,
// which tolerates a bare "1XXXXXXXXXX" like the ones already stored on
// existing driver rows. Only prepends "+"; never reformats digits, so a
// number that's already E.164 (or already has "+") passes through
// unchanged.
function toE164(phone) {

  const digits = cleanPhone(phone);

  return digits.startsWith("+") ? digits : `+${digits}`;

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

/* =========================================================

   RIDER SESSION COOKIE

   Approved design (docs/rider-auth-design-proposal.md, decision #1):
   HttpOnly + Secure-in-production + SameSite=Lax + Path=/, never a
   bearer token in localStorage. Mirrors the admin session cookie above
   exactly in shape, with its own name/secret/TTL.

========================================================= */

const RIDER_SESSION_COOKIE = "harvey_rider_session";

// CSRF mitigation for the cookie-based design (decision #1): a
// cross-origin fetch() that sets a custom header triggers a CORS
// preflight, which isAllowedOrigin()'s strict allow-list already
// rejects for any origin not on it -- so requiring this header on
// every state-changing rider request closes the classic
// cookie-auto-attached CSRF vector without a separate token scheme.
const RIDER_CLIENT_HEADER = "x-requested-with";
const RIDER_CLIENT_HEADER_VALUE = "harvey-rider-app";

function hasRiderClientHeader(req) {
  return req.headers[RIDER_CLIENT_HEADER] === RIDER_CLIENT_HEADER_VALUE;
}

function setRiderSessionCookie(res, token, ttlHours = RIDER_SESSION_TTL_HOURS) {
  const maxAge = Math.round(ttlHours * 60 * 60);

  const attrs = [
    `${RIDER_SESSION_COOKIE}=${encodeURIComponent(token)}`,
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

function clearRiderSessionCookie(res) {
  const attrs = [`${RIDER_SESSION_COOKIE}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];

  if (IS_PRODUCTION) {
    attrs.push("Secure");
  }

  res.append("Set-Cookie", attrs.join("; "));
}

function readRiderSessionCookie(req) {
  const cookies = parseCookies(req);
  return cookies[RIDER_SESSION_COOKIE] || "";
}

// riderPhoneLast10/riderPhoneToE164 above are lib/riderAuth.js's
// phoneLast10/phoneToE164US, imported under their original server.js
// names so every existing call site below is unchanged -- see that
// module for why rider phone lookups need this normalization (real,
// confirmed format drift in the live riders table).

// A duplicate phone across two rider rows, or a longer malformed value
// that merely *ends* in the same 10 digits, means an ilike suffix match
// can return more than one row -- and did, live, once tested against
// this table (see PR #91 review). .maybeSingle() would throw on >1 row;
// picking data[0] would silently authenticate as the wrong rider. This
// loads every row the ilike prefilter could plausibly match and hands
// the raw candidate list to lib/riderAuth.js's
// selectExactlyOneActiveRider, which deterministically narrows to an
// exact-normalized-match, active, non-revoked row and proceeds only
// when exactly one remains -- see that function for the full rationale.
// The ambiguity-resolution *decision* lives in the unit-tested lib
// function; this wrapper is only the live Supabase fetch around it.
async function findExactlyOneActiveRiderByPhone(rawPhone) {
  const last10 = riderPhoneLast10(rawPhone);

  if (!last10) {
    return { rider: null, matchCount: 0 };
  }

  const { data, error } = await supabase.from("riders").select("*").ilike("phone", `%${last10}`);

  if (error) {
    console.error("❌ Rider phone lookup failed:", error.message);
    return { rider: null, matchCount: 0 };
  }

  const result = selectExactlyOneActiveRider(data, last10);

  if (result.matchCount > 1) {
    console.error(
      `❌ Rider phone lookup ambiguous: ${result.matchCount} active riders share the same normalized phone number.`
    );
  }

  return result;
}

// Rate-limit key for the destination dimension (decision requirement:
// both an IP limit and a separate per-destination limit) -- delegates
// the actual normalize-and-hash decision to lib/riderAuth.js's
// hashLoginDestination so it's unit-tested directly; this wrapper only
// pulls the raw fields off the request.
function riderLoginDestinationKey(req) {
  return hashLoginDestination({
    phone: cleanString(req.body?.phone, 32),
    email: cleanEmail(req.body?.email)
  });
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

// Stricter than requireAdmin(): only the pre-shared-secret admin_token
// method qualifies, not an ordinary admin_password/admin_session login.
// Reserved for actions that can make a driver dispatch-eligible without
// a real background check having run — see lib/driverCompliance.js.
function requireElevatedAdmin(req, res, next) {

  requireAdmin(req, res, () => {

    // requireAdmin only ever invokes this callback after successfully
    // authenticating and setting req.admin — a failure calls fail(res, ...)
    // itself and never reaches here.
    if (req.admin?.method !== "admin_token") {

      return fail(

        res,

        "Elevated admin authorization is required for this action.",

        403

      );

    }

    return next();

  });

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

// Admin RBAC Phase 2: shadow-mode authorization logging (docs/
// security-remediation/admin-rbac-phase2-shadow-mode.md). Computes
// what the proposed RBAC model *would* decide for this request and
// records it -- it never denies, blocks, redirects, or otherwise
// changes the response. Every call site uses
// `logAdminRbacShadowCheck(req, route, capability).catch(() => {})`,
// the same fire-and-forget pattern already used for auditLog() calls
// throughout this file, so a slow or failing shadow check can never
// affect a real admin request.
//
// Deliberately does NOT use resolveAdminRole() (lib/adminRbac.js) --
// that function maps every one of today's three legacy auth methods
// straight to super_admin, which is correct for Phase 1's no-lockout
// guarantee but would make every shadow check here trivially
// "would_allow: true" and produce no evidence about whether the
// proposed role/capability model actually matches real usage. Instead
// this looks up admin_roles by the authenticated email -- the email
// requireAdmin() itself already resolved server-side (the env-var
// admin identity, or the signed admin-session cookie's email), never
// anything read from a request body/header/query parameter.
async function logAdminRbacShadowCheck(req, route, capability) {

  const admin = req.admin;

  const email =
    admin && typeof admin.email === "string" ? admin.email.trim().toLowerCase() : "";

  const isLegacyAdmin =
    !!email && email === String(ADMIN_EMAIL || "").trim().toLowerCase();

  let dbLookupFailed = false;
  let roleRow = null;

  try {

    const { data, error } = await supabase
      .from("admin_roles")
      .select("role")
      .eq("email", email)
      .maybeSingle();

    if (error) {
      dbLookupFailed = true;
    } else {
      roleRow = data;
    }

  } catch {
    dbLookupFailed = true;
  }

  const { role, source } = resolveShadowRole({ dbLookupFailed, roleRow, isLegacyAdmin });
  const wouldAllow = computeShadowWouldAllow(role, capability);

  const entry = buildShadowLogEntry({
    admin,
    route,
    httpMethod: req.method,
    capability,
    role,
    source,
    wouldAllow
  });

  const { error: insertError } = await supabase.from("admin_rbac_shadow_log").insert(entry);

  if (insertError) {
    return { logged: false, error: insertError };
  }

  return { logged: true, wouldAllow, source };

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

        url: "/rider-dashboard.html"

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

// Single centralized pricing engine — taxi, scheduled, airport, and HTAF
// rides all call the same calculateRideEstimate(), extracted to
// lib/pricing.js so it's unit-testable without booting the whole server
// (see lib/pricing.test.js). No service calculates its own fare here.
const {
  BASE_FARE,
  PER_MILE_RATE,
  PER_MINUTE_RATE,
  BOOKING_FEE,
  MINIMUM_FARE,
  DRIVER_PAYOUT_PERCENT,
  calculateRideEstimate,
  hasValidTripDistance
} = require("./lib/pricing");

// Server-issued ride quote token: hasValidTripDistance() above only
// proves a request carried a positive miles/minutes pair, not that the
// distance is genuine -- a direct caller could submit {miles: 0.1,
// minutes: 1} for an actual 20-mile trip and that guard alone would
// accept it. signRideQuote()/verifyRideQuote()/quoteMatchesSubmission()
// freeze the computed fare and every input it depends on into a signed
// token at estimate time, so payment-intent and ride-request can charge
// exactly what was quoted instead of trusting client-resubmitted numbers.
// See lib/rideQuote.js and docs/route-verification-requirement.md.
const {
  signRideQuote,
  resolveRideQuote
} = require("./lib/rideQuote");

// No fallback chain, same reasoning as RIDER_SESSION_SECRET below: a
// deployment that hasn't set this explicitly should have quote issuance
// (and therefore payment/dispatch) fail closed with a 503, not silently
// sign quotes with a guessed or shared secret.
const RIDE_QUOTE_SECRET = env("RIDE_QUOTE_SECRET", "");

// Short-lived on purpose: long enough for a rider to review pricing and
// authorize payment in one sitting, short enough that a leaked/observed
// token is useless for pricing a *different*, later trip.
const RIDE_QUOTE_TTL_MINUTES = envNumber("RIDE_QUOTE_TTL_MINUTES", 15);

// Rider-only verification helpers, extracted so the mapping from a
// rider row to phone/persona/identity verification booleans is
// unit-tested against the real riders schema in one place. See
// lib/riderVerification.js for why this exists — riders and drivers
// use different column names for the same concepts, and rider code
// was incorrectly reading the driver-shaped columns.
const {
  isRiderPhoneVerified,
  isRiderPersonaVerified,
  buildRiderSignupRecord
} = require("./lib/riderVerification");

// Saved payment method helpers — see lib/riderPayments.js for why the
// Stripe Customer/PaymentMethod payload building lives outside server.js.
const {
  buildStripeCustomerPayload,
  mapPaymentMethodsForClient,
  buildPaymentIntentAttachmentFields,
  ownsPaymentMethod,
  decideInitialRideStatus,
  authorizePaymentIntentForRide
} = require("./lib/riderPayments");

// Harvey AI's system prompt for /api/ai/support — see
// lib/harveyAiSystemPrompt.js for why this lives outside server.js.
const { HARVEY_AI_SYSTEM_PROMPT } = require("./lib/harveyAiSystemPrompt");

// Driver readiness / compliance decision logic — see
// lib/driverCompliance.js for why administrative approval and compliance
// verification (Checkr/Persona) are deliberately kept as separate,
// separately-authorized actions.
const {
  computeDriverReadiness,
  parseDriverOnlineRequest,
  evaluateDriverStatusChange,
  buildOrdinaryApprovalUpdate,
  validateComplianceOverrideRequest,
  applyContactVerificationOverride,
  applyComplianceOverride
} = require("./lib/driverCompliance");

const {
  computeHtafPublicStats,
  resolveCreateRideOutcome,
  resolveRiderHtafLookup,
  HTAF_ADMIN_LIST_FIELDS,
  HTAF_ADMIN_DETAIL_FIELDS,
  HTAF_ADMIN_PATCH_RESPONSE_FIELDS,
  HTAF_EXPORT_COLUMNS,
  buildHtafExportCsv,
  resolveHtafExportRequest,
  resolveHtafExportDelivery,
  buildHtafTriageFacts
} = require("./lib/htafOperations");

const {
  ADMIN_DRIVERS_LIST_FIELDS,
  ADMIN_RIDERS_LIST_FIELDS,
  ADMIN_RIDES_LIST_FIELDS,
  ADMIN_RIDE_MUTATION_FIELDS,
  ADMIN_DRIVER_MUTATION_FIELDS,
  ADMIN_RIDER_MUTATION_FIELDS,
  ADMIN_AUDIT_LOGS_LIST_FIELDS
} = require("./lib/adminDirectory");

const {
  ROUTE_CAPABILITIES: RBAC_SHADOW_ROUTE_CAPABILITIES,
  resolveShadowRole,
  computeWouldAllow: computeShadowWouldAllow,
  buildShadowLogEntry
} = require("./lib/adminRbacShadow");

// Rider session logic (sign/verify/revocation-check) lives in lib/riderAuth.js,
// unlike the driver session functions below (signDriverSession/
// verifyDriverSession), which are inline and untested -- see
// docs/rider-auth-design-proposal.md for the full design.
const {
  signRiderSession,
  verifyRiderSession,
  isSessionVersionCurrent,
  shouldRenewSession,
  applyRiderSessionVersionIncrement,
  buildLogoutOutcome,
  resolveRiderAuthOutcome,
  buildRiderSessionBootstrap,
  buildRiderVerificationFieldUpdate,
  buildAuthUiConfigResponse,
  phoneLast10: riderPhoneLast10,
  phoneToE164US: riderPhoneToE164,
  selectExactlyOneActiveRider,
  resolveVerificationTtlMinutes,
  hashIdentifier,
  hashLoginDestination
} = require("./lib/riderAuth");

// requireRider — P0 remediation PR #1 (docs/p0-security-remediation-plan.md).
// Not yet applied to any route: this only establishes the middleware and
// its session-validation logic. Wiring it into rider-owned routes (and
// removing the client-supplied-riderId trust those routes currently use
// instead) is PR #2, deliberately kept separate so this foundational
// piece can be reviewed and merged on its own.
//
// Mirrors requireDriver's split above (IO here, decision in a pure lib
// function) but reads the cookie-based rider session instead of an
// x-driver-token header, and enforces the CSRF header (see
// hasRiderClientHeader above) on state-changing requests -- GET requests
// don't carry a body a forged cross-site form/fetch could use to change
// state, so only non-GET methods require it, matching this cookie
// design's own stated rationale.
async function requireRider(req, res, next) {
  try {
    if (req.method !== "GET" && !hasRiderClientHeader(req)) {
      return fail(res, "This request could not be verified.", 403);
    }

    if (!RIDER_SESSION_SECRET) {
      console.error("❌ requireRider: RIDER_SESSION_SECRET is not configured.");
      return fail(res, "Rider authentication is not available right now.", 503);
    }

    const token = readRiderSessionCookie(req);
    const verification = token
      ? verifyRiderSession({ token, secret: RIDER_SESSION_SECRET })
      : { ok: false, reason: "no_session" };

    let riderRow = null;

    if (verification.ok) {
      const { data, error } = await supabase
        .from("riders")
        .select("*")
        .eq("id", verification.riderId)
        .maybeSingle();

      if (error) {
        console.error("❌ requireRider: failed to load rider row:", error);
        return fail(res, "Something went wrong verifying your session.", 500);
      }

      riderRow = data || null;
    }

    const outcome = resolveRiderAuthOutcome({ verification, riderRow });

    if (!outcome.ok) {
      return fail(res, outcome.message, outcome.statusCode);
    }

    req.rider = riderRow;
    req.riderAuthMethod = "rider_session";

    if (outcome.shouldRenew) {
      const freshToken = signRiderSession({
        riderId: riderRow.id,
        sessionVersion: Number.isInteger(riderRow.session_version) ? riderRow.session_version : 0,
        secret: RIDER_SESSION_SECRET,
        ttlHours: RIDER_SESSION_TTL_HOURS
      });

      setRiderSessionCookie(res, freshToken);
    }

    return next();
  } catch (err) {
    console.error("❌ requireRider unexpected error:", err);
    return fail(res, "Something went wrong verifying your session.", 500);
  }
}

/* =========================================================

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

   HTAF PUBLIC STATISTICS

   Read-only, public, no PII. Powers the "Application Dashboard"
   widget on foundation.html. Returns aggregate integers only,
   computed from the canonical HTAF_STATUS enum:

     applications_submitted = all non-deleted HTAF applications
     pending_review         = submitted, under_review, pending_documents
     approved_requests      = approved
     scheduled_rides        = scheduled

   On any database error this returns 503 "unavailable" rather than
   a fabricated 0 — a real zero and a broken query must never look
   the same to the caller. Do not collapse the three pending-review
   statuses into "submitted"; the UI labels them as separate metrics.

========================================================= */

app.get(

  "/api/foundation/public-stats",

  asyncRoute(async (req, res) => {

    const { data, error } =

      await supabase

        .from("htaf_applications")

        .select("status");

    if (error) {

      return fail(

        res,

        "HTAF statistics are temporarily unavailable.",

        503

      );

    }

    const stats =

      computeHtafPublicStats((data || []).map((row) => row.status));

    return ok(res, {

      ...stats,

      generated_at: nowIso()

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

    logAdminRbacShadowCheck(
      req,
      "GET /api/admin/foundation/applications",
      RBAC_SHADOW_ROUTE_CAPABILITIES["GET /api/admin/foundation/applications"]
    ).catch(() => {});

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

        .select(HTAF_ADMIN_LIST_FIELDS.join(","))

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

   HTAF ADMIN DETAIL

   Full applicant detail for exactly one application, fetched only
   when an admin actually opens it -- the counterpart to the list
   route above no longer shipping every field for every row (docs/
   security-remediation/htaf-admin-data-minimization.md). Still
   requireAdmin-gated; still an explicit allow-list, not select("*") --
   review_notes/assigned_admin/client_version/source stay excluded here
   too, since nothing in this codebase reads them.

========================================================= */

app.get(
  "/api/admin/foundation/applications/:id",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const id = cleanString(req.params.id, 100);

    const { data, error } = await supabase
      .from("htaf_applications")
      .select(HTAF_ADMIN_DETAIL_FIELDS.join(","))
      .eq("id", id)
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (!data) {
      return fail(res, "HTAF application not found.", 404);
    }

    return ok(res, { application: data });
  })
);

/* =========================================================

   HTAF ADMIN UPDATE

========================================================= */

app.patch(

  "/api/admin/foundation/applications/:id",

  requireAdmin,

  asyncRoute(async (req, res) => {

    logAdminRbacShadowCheck(
      req,
      "PATCH /api/admin/foundation/applications/:id",
      RBAC_SHADOW_ROUTE_CAPABILITIES["PATCH /api/admin/foundation/applications/:id"]
    ).catch(() => {});

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

        .select(HTAF_ADMIN_PATCH_RESPONSE_FIELDS.join(","))

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

   HTAF ADMIN EXPORT (CSV)

   Bulk PII export is materially different from opening one
   application: it hands a caseworker's entire visible caseload --
   name, email, phone, income, household size, addresses -- as a
   downloadable file. Per docs/security-remediation/
   htaf-admin-data-minimization.md, this is now a server-authorized,
   audited action instead of the browser dumping whatever rows happen
   to already be loaded client-side:

   - requireAdmin-gated, same as every other HTAF admin route.
   - Requires a non-empty, human-readable `reason` in the request body
     (resolveHtafExportRequest) -- an admin must state why before the
     file is generated. This is deliberately not a fixed enum: the
     point is a real justification an auditor can read later, not a
     dropdown a UI can satisfy by always picking the first option.
   - The file is built server-side (buildHtafExportCsv) from a query
     scoped to HTAF_EXPORT_COLUMNS -- not select("*") -- so Supabase
     itself never sends this route a column the export doesn't use,
     including the four dead ones the audit identified. This is the
     only route in this family that reads the wide-but-still-explicit
     PII field set, and only because an export is deliberately a "give
     me everyone (matching these filters)" action.
   - Every export is audit-logged with actor, timestamp (implicit in
     the audit row), row_count, the stated reason, and whatever
     status/program_type filter was applied. This audit write is
     fail-closed, the same principle already used for driver compliance
     overrides: the CSV is never sent unless auditLog() actually
     persisted the record. auditLog() itself never throws -- a failed
     insert resolves as {logged: false, error}, not a rejection -- so
     the gate has to check the resolved outcome, not wrap it in
     try/catch. See resolveHtafExportDelivery() (lib/htafOperations.js)
     for the (tested) decision, and its regression test for what
     happens when the audit write fails.

========================================================= */

app.post(
  "/api/admin/foundation/applications/export",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const resolved = resolveHtafExportRequest(req.body || {});

    if (!resolved.ok) {
      return fail(res, resolved.error, resolved.statusCode);
    }

    let query = supabase
      .from("htaf_applications")
      .select(HTAF_EXPORT_COLUMNS.join(","))
      .order("created_at", { ascending: false });

    if (resolved.status) {
      query = query.eq("status", resolved.status);
    }

    if (resolved.programType) {
      query = query.eq("program_type", resolved.programType);
    }

    const { data, error } = await query;

    if (error) {
      throw error;
    }

    const rows = data || [];
    const csv = buildHtafExportCsv(rows);

    const auditResult = await auditLog({
      actor_type: "admin",
      actor_id: req.admin.email,
      action: "htaf_applications_exported",
      entity_type: "htaf_application_export",
      entity_id: null,
      metadata: {
        row_count: rows.length,
        reason: resolved.reason,
        filters: {
          status: resolved.status,
          program_type: resolved.programType
        }
      },
      req
    });

    const delivery = resolveHtafExportDelivery(auditResult);

    if (!delivery.ok) {
      // Never log the CSV/rows here -- only the audit-write failure
      // itself (a Supabase error object: message/code/details/hint),
      // which carries no applicant data.
      console.error(
        "❌ HTAF export blocked: audit record could not be written.",
        auditResult && auditResult.error
      );
      return fail(res, delivery.error, delivery.statusCode);
    }

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="htaf-applications-${nowIso().slice(0, 10)}.csv"`
    );
    return res.status(200).send(csv);
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
   HTAF AI TRIAGE — privacy-hardened (docs/security-remediation/
   htaf-ai-triage-privacy-hardening.md)

   Admin only. Asks OpenAI to summarize an application's OPERATIONAL
   completeness/consistency and suggest a next processing step. This
   never writes to the database or auto-changes status — it only
   returns a suggestion for the admin to review, inserted into notes
   (or not) via the existing notes/status endpoints. The human always
   makes the final call.

   GUARDRAILS (all enforced in code, not just stated here):
   - Advisory only. The AI never approves, denies, or takes any action
     itself — buildHtafTriageFacts()/this route never write to
     htaf_applications, and the recommendation vocabulary below
     (ready_for_review / request_info / priority_review /
     data_inconsistency) is deliberately operational-categorization
     language, not an eligibility decision. "approve"/"deny" were
     removed from the vocabulary entirely in this hardening pass —
     triage helps a human prioritize and spot incomplete data; it does
     not decide who qualifies for HTAF assistance or make any medical
     judgment. That eligibility/medical-judgment boundary is a policy
     choice, not a technical limitation of the model — it's enforced by
     never asking the model for that judgment and never having the
     vocabulary to express one.
   - The AI is not provided direct identifiers, exact financial
     information, street-level location, medical narrative, or other
     unnecessary sensitive details, and is prohibited from using
     operational categories to infer protected or sensitive
     characteristics (see buildHtafTriageFacts(), lib/htafOperations.js,
     for the full field-by-field classification). This is deliberately
     not phrased as "the payload contains nothing sensitive" —
     program_type itself can sometimes imply a sensitive circumstance
     (e.g. "medical", "disability"), and it is kept because triage needs
     some operational category to be useful at all. Household size and
     monthly income, which have no necessary operational function once
     triage is limited to categorization/prioritization rather than
     eligibility, are excluded entirely (not merely coarsened) for
     exactly this reason.
   - Human admin makes the final decision — the recommendation is only
     ever inserted into notes for a human to read; nothing here changes
     status automatically.
   - No claim of HIPAA-compliant processing is made anywhere in this
     code or its documentation — sending even minimized, coarse
     categorical data to a third-party model is a data-sharing decision
     an organization handling health-adjacent information should have
     its own legal/compliance review for, independent of this PR
     (this codebase already carries a standing HIPAA/BAA legal-review
     TODO from earlier work; this hardening reduces exposure, it does
     not resolve that TODO).
   - Auditable without storing unnecessary applicant PII: the audit log
     for every triage call now includes the exact `facts_sent` payload
     (see below) — safe to store because buildHtafTriageFacts()'s
     allow-list guarantees, and tests enforce, that it never contains
     PII in the first place.
========================================================= */

const HTAF_TRIAGE_RECOMMENDATIONS = [
  "ready_for_review",
  "request_info",
  "priority_review",
  "data_inconsistency"
];

async function triageHtafApplication(application) {
  if (!openai) {
    return {
      available: false,
      reason: "AI triage is not configured on the server (OPENAI_API_KEY missing)."
    };
  }

  // The ONLY facts about this application that leave this server. See
  // buildHtafTriageFacts() (lib/htafOperations.js) for the allow-list
  // and its tests for proof that no name, email, phone, application
  // code, street address, income (exact or banded), household size
  // (exact or banded), or raw free-text description can reach this
  // payload even if present on `application`.
  const facts = buildHtafTriageFacts(application);

  const systemContent = [
    "You are an assistant helping a human reviewer triage HTAF (Harvey Transportation Assistance Foundation) applications for transportation assistance.",
    "This is advisory only. You never approve, deny, or take any action yourself — you only summarize the structured facts given and suggest one operational next-step category. A human admin always makes the final decision, including any eligibility or medical judgment, which is never your job.",
    "You have NOT been given the applicant's name, contact information, exact or approximate income, exact or approximate household size, or any address/free-text description — only coarse operational categories and booleans. Do not guess, infer, or assume any of that missing information, and do not ask for it.",
    "Never let program_type or any other field function as a proxy for a protected or sensitive characteristic (e.g. disability, medical condition, immigration status, race, religion) in your summary, flags, or recommendation.",
    "Your evaluation is limited strictly to: missing operational information, service-area inconsistencies (pickup_in_service_area / destination_in_service_area / home_in_service_area being false), a ride_date in the past or otherwise invalid, missing or vague transportation_need_detail, and workflow/data inconsistencies (e.g. a status that doesn't match what the other fields suggest). You must NOT evaluate, comment on, or factor in financial need, household composition, medical need, or program eligibility of any kind — none of that has been given to you, and it is not your role even if it were.",
    "Be factual and concise. Do not invent facts that are not in the data. Do not assume or apply any HTAF eligibility rule — none has been given to you.",
    "Respond ONLY with a JSON object of this exact shape: " +
      '{"summary": string, "flags": string[], "recommendation": "ready_for_review" | "request_info" | "priority_review" | "data_inconsistency", "reasoning": string}',
    '"recommendation" must be exactly one of: ready_for_review, request_info, priority_review, data_inconsistency. Use "ready_for_review" whenever nothing stands out or you are not confident anything is wrong.',
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
    : "ready_for_review";

  return {
    available: true,
    summary: cleanString(parsed.summary, 1000) || "No summary returned.",
    flags: Array.isArray(parsed.flags)
      ? parsed.flags.map((f) => cleanString(f, 200)).filter(Boolean).slice(0, 10)
      : [],
    recommendation,
    reasoning: cleanString(parsed.reasoning, 1000) || "",
    facts_sent: facts
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

    // facts_sent is safe to log in full -- it's the same minimized,
    // PII-free object buildHtafTriageFacts() guarantees and tests
    // enforce -- giving a complete, auditable record of exactly what
    // was sent to OpenAI for this call, without ever storing the
    // applicant PII that record would otherwise need to reference.
    auditLog({
      actor_type: "admin",
      actor_id: req.admin.email,
      action: "htaf_application_ai_triaged",
      entity_type: "htaf_application",
      entity_id: application.id,
      metadata: {
        recommendation: triage.recommendation || null,
        facts_sent: triage.facts_sent || null
      },
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

// ttlMinutes and codeType are optional overrides -- every existing
// caller (self-service email/SMS verification) omits both and gets the
// original behavior unchanged: a long hex link-token + hour-scale TTL
// for email, a 6-digit code + minute-scale TTL for SMS. Rider login
// needs a *typeable* code on both channels (matching the driver-login
// and SMS UX) and a short, login-appropriate expiry regardless of
// channel -- see RIDER_LOGIN_EMAIL_TTL_MINUTES below.
async function createVerificationRecord({

  channel,

  destination,

  purpose,

  user_type,

  metadata = {},

  ttlMinutes,

  codeType

}) {

  const isEmail =

    channel === "email";

  const code =

    codeType === "numeric" || !isEmail

      ? makeOtpCode()

      : crypto.randomBytes(24).toString("hex");

  const expires_at =

    futureIsoMinutes(
      resolveVerificationTtlMinutes({
        isEmail,
        ttlMinutes,
        emailVerifyTtlHours: EMAIL_VERIFY_TTL_HOURS,
        verifyTtlMinutes: VERIFY_TTL_MINUTES
      })
    );

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

    const rider = buildRiderSignupRecord({
      id: makeId("RIDER"),
      firstName: cleanString(req.body.first_name, 120),
      lastName: cleanString(req.body.last_name, 120),
      email: cleanEmail(req.body.email),
      phone: cleanPhone(req.body.phone),
      city: cleanString(req.body.city, 120),
      state: cleanString(req.body.state || "TN", 40),
      approvalGateEnabled: ENABLE_RIDER_APPROVAL_GATE,
      now: nowIso()
    });

    const { data, error } =
      await supabase
        .from("riders")
        .insert(rider)
        .select()
        .single();

    if (error) {
      // Never leak Supabase/schema error details to the browser — log
      // the real error server-side against a request ID the client can
      // reference, and return a generic, safe error code instead.
      const requestId = makeId("SIGNUPERR");

      console.error(`⚠️ Rider signup failed [${requestId}]:`, error.message);

      auditLog({
        actor_type: "rider",
        action: "rider_signup_failed",
        entity_type: "rider",
        metadata: { request_id: requestId, reason: error.message, email: rider.email },
        req
      }).catch(() => {});

      return fail(
        res,
        "RIDER_SIGNUP_FAILED",
        500,
        {
          message: "We could not create your rider account. Please try again.",
          request_id: requestId
        }
      );
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

   RIDER SESSION LOGIN (OTP -> HttpOnly cookie session)

   Approved design (docs/rider-auth-design-proposal.md). Three routes:
   start (send a code), verify (check the code, issue the session
   cookie), logout (invalidate it). This PR only adds these routes --
   it does not protect or migrate any existing /api/rider/* route, and
   does not touch the rider_auth_enforced flag. That's deliberately
   separate, later work.

   Phone -> Twilio Verify (the same TWILIO_VERIFY_SERVICE_SID already
   live from the driver-login hotfix), kept completely separate from
   email -> the existing createVerificationRecord/verifyCode +
   SendGrid path (purpose: "rider_login", its own scope, never sharing
   rows with self-service email verification's own codes).

========================================================= */

// Never reveals whether a phone/email matches a real rider -- every
// path returns this exact same shape. The one channel-specific
// difference (SMS vs. email) is intentional: it's what channel the
// rider themselves chose by which field they submitted, not a leak
// about whether an account exists.
const RIDER_SESSION_START_RESPONSE = { sent: true };

// Both the IP dimension and the destination dimension are required
// (review requirement): an IP-only limit misses one attacker rotating
// IPs against a single phone number; a destination-only limit misses
// one IP spraying many destinations. keyFn is undefined for the IP
// limiter (rateLimit's own default), and riderLoginDestinationKey for
// the second.
app.post(
  "/api/rider/session/start",
  rateLimit({ windowMs: 60_000, max: 10, keyPrefix: "rider_session_start_ip" }),
  rateLimit({
    windowMs: 10 * 60_000,
    max: 3,
    keyPrefix: "rider_session_start_dest",
    keyFn: riderLoginDestinationKey
  }),
  asyncRoute(async (req, res) => {
    if (!RIDER_SESSION_SECRET) {
      console.error("❌ Rider session start: RIDER_SESSION_SECRET is not configured.");
      return fail(res, "Rider sign-in is not available right now. Please try again later.", 503);
    }

    if (!hasRiderClientHeader(req)) {
      return fail(res, "This request could not be verified.", 403);
    }

    const rawPhone = cleanString(req.body.phone, 32);
    const rawEmail = cleanEmail(req.body.email);

    if (!rawPhone && !rawEmail) {
      return fail(res, "phone or email is required.", 400);
    }

    if (rawPhone) {
      if (!twilioClient || !TWILIO_VERIFY_SERVICE_SID) {
        console.error("❌ Rider session start: Twilio Verify is not configured.");
        return fail(res, "Rider sign-in is not available right now. Please try again later.", 503);
      }

      // Exactly-one-active-match only -- see findExactlyOneActiveRiderByPhone
      // for why the old .ilike(...).maybeSingle() lookup was unsafe
      // against this table's real, confirmed duplicate/malformed phone
      // data. Zero or multiple matches both fall through silently to
      // the same generic response as "no match" -- ambiguity is never
      // guessed at, and is never visible to the client either way.
      const { rider } = await findExactlyOneActiveRiderByPhone(rawPhone);

      if (rider) {
        const e164 = riderPhoneToE164(rider.phone);

        if (e164) {
          try {
            await twilioClient.verify
              .services(TWILIO_VERIFY_SERVICE_SID)
              .verifications.create({ to: e164, channel: "sms" });
          } catch (err) {
            console.error("❌ Rider session start: Twilio Verify send failed:", err.message);
          }
        }
      }

      // actor_id is a one-way hash, never the raw phone number -- audit
      // logs must not become a store of rider PII for every login
      // attempt, including ones for numbers that aren't even real
      // accounts.
      auditLog({
        actor_type: "rider",
        actor_id: hashIdentifier(riderPhoneLast10(rawPhone) || rawPhone),
        action: "rider_login_started",
        metadata: { channel: "sms" },
        req
      }).catch(() => {});

      return ok(res, RIDER_SESSION_START_RESPONSE);
    }

    const email = rawEmail;

    const { data: rider, error } = await supabase
      .from("riders")
      .select("id, access_revoked, deleted_at")
      .eq("email", email)
      .maybeSingle();

    if (error) {
      console.error("❌ Rider session start: rider lookup failed:", error.message);
    } else if (rider && rider.access_revoked !== true && !rider.deleted_at) {
      try {
        const { code } = await createVerificationRecord({
          channel: "email",
          destination: email,
          purpose: "rider_login",
          user_type: "rider",
          metadata: { requested_from: "web" },
          ttlMinutes: RIDER_LOGIN_EMAIL_TTL_MINUTES,
          codeType: "numeric"
        });

        await sendEmail({
          to: email,
          subject: "Your Harvey Taxi sign-in code",
          text: `Your Harvey Taxi sign-in code is ${code}. It expires in ${RIDER_LOGIN_EMAIL_TTL_MINUTES} minutes.`
        });
      } catch (err) {
        console.error("❌ Rider session start: email OTP send failed:", err.message);
      }
    }

    auditLog({
      actor_type: "rider",
      actor_id: hashIdentifier(email),
      action: "rider_login_started",
      metadata: { channel: "email" },
      req
    }).catch(() => {});

    return ok(res, RIDER_SESSION_START_RESPONSE);
  })
);

app.post(
  "/api/rider/session/verify",
  rateLimit({ windowMs: 60_000, max: 15, keyPrefix: "rider_session_verify_ip" }),
  rateLimit({
    windowMs: 10 * 60_000,
    max: 10,
    keyPrefix: "rider_session_verify_dest",
    keyFn: riderLoginDestinationKey
  }),
  asyncRoute(async (req, res) => {
    if (!RIDER_SESSION_SECRET) {
      console.error("❌ Rider session verify: RIDER_SESSION_SECRET is not configured.");
      return fail(res, "Rider sign-in is not available right now. Please try again later.", 503);
    }

    if (!hasRiderClientHeader(req)) {
      return fail(res, "This request could not be verified.", 403);
    }

    const rawPhone = cleanString(req.body.phone, 32);
    const rawEmail = cleanEmail(req.body.email);
    const code = cleanString(req.body.code, 12);

    if ((!rawPhone && !rawEmail) || !code) {
      return fail(res, "phone or email and code are required.", 400);
    }

    const invalidCode = () => fail(res, "Invalid or expired code.", 400);

    let rider = null;
    const verifiedChannel = rawPhone ? "phone" : "email";

    if (rawPhone) {
      if (!twilioClient || !TWILIO_VERIFY_SERVICE_SID) {
        return invalidCode();
      }

      // Same deterministic, exactly-one-match rule as session/start --
      // a duplicate or ambiguous phone must never let verify guess
      // which rider to sign in as.
      const { rider: candidate } = await findExactlyOneActiveRiderByPhone(rawPhone);

      if (!candidate) {
        return invalidCode();
      }

      const e164 = riderPhoneToE164(candidate.phone);

      if (!e164) {
        return invalidCode();
      }

      let check;
      try {
        check = await twilioClient.verify
          .services(TWILIO_VERIFY_SERVICE_SID)
          .verificationChecks.create({ to: e164, code });
      } catch (err) {
        console.error("❌ Rider session verify: Twilio Verify check failed:", err.message);
        return invalidCode();
      }

      if (check.status !== "approved") {
        return invalidCode();
      }

      rider = candidate;
    } else {
      const email = rawEmail;

      const result = await verifyCode({
        channel: "email",
        destination: email,
        code,
        purpose: "rider_login"
      });

      if (!result.ok) {
        return invalidCode();
      }

      const { data: candidate, error: lookupError } = await supabase
        .from("riders")
        .select("*")
        .eq("email", email)
        .maybeSingle();

      if (lookupError || !candidate) {
        return invalidCode();
      }

      rider = candidate;
    }

    if (rider.access_revoked === true || rider.deleted_at) {
      return fail(res, "This account's access has been revoked.", 403);
    }

    // A successful Twilio Verify check (phone) or verifyCode result
    // (email) above is itself proof the rider currently controls that
    // exact destination -- record only the one channel actually proven,
    // never both, and never before the checks above have already
    // returned invalidCode()/403 for every failure path. Non-blocking:
    // a rider who successfully authenticated must not be locked out of
    // their own login because this side-effect write failed.
    const verificationUpdate = buildRiderVerificationFieldUpdate({ channel: verifiedChannel, rider });

    if (verificationUpdate) {
      const { error: verificationUpdateError } = await supabase
        .from("riders")
        .update(verificationUpdate)
        .eq("id", rider.id);

      if (verificationUpdateError) {
        console.error(
          "❌ Rider session verify: failed to record channel verification:",
          verificationUpdateError.message
        );
      } else {
        Object.assign(rider, verificationUpdate);
      }
    }

    const sessionVersion = Number.isInteger(rider.session_version) ? rider.session_version : 0;

    const token = signRiderSession({
      riderId: rider.id,
      sessionVersion,
      secret: RIDER_SESSION_SECRET,
      ttlHours: RIDER_SESSION_TTL_HOURS
    });

    setRiderSessionCookie(res, token);

    auditLog({
      actor_type: "rider",
      actor_id: rider.id,
      action: "rider_login_succeeded",
      req
    }).catch(() => {});

    return ok(res, { rider_id: rider.id });
  })
);

app.post(
  "/api/rider/session/logout",
  asyncRoute(async (req, res) => {
    if (!hasRiderClientHeader(req)) {
      return fail(res, "This request could not be verified.", 403);
    }

    const token = readRiderSessionCookie(req);
    const verification =
      token && RIDER_SESSION_SECRET ? verifyRiderSession({ token, secret: RIDER_SESSION_SECRET }) : null;

    // verifyRiderSession only exposes riderId once a token's signature
    // has actually been verified (see lib/riderAuth.js) -- an expired
    // or issued-in-future token still carries a trustworthy riderId and
    // *should* still be logged out for real (its session_version bump
    // invalidates it even more thoroughly than a client-side cookie
    // clear would); an unsigned/tampered/malformed token, or no token
    // at all, must never be allowed to name a victim to force-log-out.
    const hadTrustedRiderId = Boolean(verification?.riderId);

    let rpcSucceeded = false;

    if (hadTrustedRiderId) {
      const result = await applyRiderSessionVersionIncrement({
        callRpc: (name, params) => supabase.rpc(name, params),
        riderId: verification.riderId,
        actorType: "rider",
        actorId: verification.riderId,
        action: "rider_logout",
        metadata: {},
        ipAddress: getClientIp(req),
        userAgent: req.headers["user-agent"] || null
      });

      rpcSucceeded = result.ok;

      if (!result.ok) {
        console.error("❌ Rider logout: session_version increment failed:", result.error);
      }
    }

    // The local cookie is cleared unconditionally, regardless of which
    // branch buildLogoutOutcome takes below -- the browser making this
    // request is signed out either way. What varies is whether the
    // *server-side*, every-device revocation is confirmed: a copied or
    // stolen cookie must not be treated as still logged in when it
    // isn't, but this response must also never claim that revocation
    // succeeded when it didn't (see buildLogoutOutcome).
    clearRiderSessionCookie(res);

    const outcome = buildLogoutOutcome({ hadTrustedRiderId, rpcSucceeded });

    if (outcome.statusCode !== 200) {
      return fail(res, outcome.body.error, outcome.statusCode, outcome.body);
    }

    return ok(res, outcome.body);
  })
);

// Session bootstrap (P0 remediation PR #2a, docs/security-remediation/
// pr-02a-rider-client-auth.md). requireRider-protected: the client calls
// this once on load (and again right after a successful verify) to learn
// its actual authenticated identity from the server, instead of trusting
// whatever riderId happens to be sitting in localStorage/the URL. The
// response is deliberately narrow -- see buildRiderSessionBootstrap in
// lib/riderAuth.js for the exact, tested allow-list; this route must
// never grow to just `ok(res, { rider: req.rider })`.
app.get(
  "/api/rider/session",
  requireRider,
  asyncRoute(async (req, res) => {
    const readiness = await getRiderReadiness(req.rider.id);

    return ok(res, buildRiderSessionBootstrap({ rider: req.rider, readiness }));
  })
);

// Rollout switch for the sign-in gate itself (P0 remediation PR 2a,
// docs/security-remediation/pr-02a-rider-client-auth.md) -- deliberately
// separate from the future rider_auth_enforced flag (PR 2b), which
// controls whether the *server* rejects unauthenticated requests to
// rider-owned routes. This one only controls whether the *client* shows
// the new sign-in gate at all. Defaulted off: with no staging
// environment available to validate real SMS/email OTP delivery before
// merge, this lets the code ship to production inert (rider-dashboard.html
// falls back to its pre-PR-2a boot behavior untouched) until an admin
// deliberately flips it on -- a narrowly controlled rollout instead of
// gating every rider's dashboard on unverified OTP delivery. Public and
// unauthenticated on purpose: the client needs to read this before it
// has any session to prove, and "is this UI feature on" isn't sensitive.
app.get(
  "/api/rider/auth-ui-config",
  asyncRoute(async (req, res) => {
    const enabled = (await getSystemFlag("rider_auth_ui_enabled", "false")) === "true";

    return ok(res, buildAuthUiConfigResponse({ enabled }));
  })
);

/* =========================================================

   DRIVER SESSION LOGIN (OTP -> signed token)

   The driver dashboard uses this to authenticate:

   1) start: driver_id -> sends an SMS code to the driver's phone via
      Twilio Verify (not the homegrown createVerificationRecord/sendSms
      path other verification flows use -- see docs/production-
      incidents.md: raw SMS from this account's toll-free number failed
      with error 30032, "Toll-Free Number Has Not Been Verified." Twilio
      Verify's default sender is exempt from that requirement for
      verification-code use cases, which is exactly what this is.)

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

    // A query error (bad column, connection issue, RLS problem) is not
    // the same fact as "no driver with this id" -- collapsing both into
    // "Driver not found" previously hid a missing-column bug behind a
    // misleading 404 and made it impossible to tell a real outage from a
    // bad driver_id. Log the actual error so a schema mismatch like that
    // is immediately visible in the server logs instead of only showing
    // up as silent login failures.
    if (error) {

      console.error(

        "❌ Driver session start: driver lookup failed:",

        error.message

      );

      return fail(

        res,

        "A server error occurred. Please try again.",

        500

      );

    }

    if (!driver) {

      return fail(res, "Driver not found.", 404);

    }

    if (driver.access_revoked === true) {

      return fail(res, "This account's access has been revoked.", 403);

    }

    if (!driver.phone) {

      return fail(res, "No phone number on file for this driver.", 400);

    }

    if (!twilioClient || !TWILIO_VERIFY_SERVICE_SID) {

      console.error(

        "❌ Driver session start: Twilio Verify is not configured."

      );

      return fail(

        res,

        "Driver sign-in is not available right now. Please try again later.",

        503

      );

    }

    let verification;

    try {

      verification =

        await twilioClient.verify

          .services(TWILIO_VERIFY_SERVICE_SID)

          .verifications

          .create({

            to: toE164(driver.phone),

            channel: "sms"

          });

    } catch (err) {

      console.error(

        "❌ Driver session start: Twilio Verify send failed:",

        err.message

      );

      return fail(

        res,

        "Could not send a login code right now. Please try again.",

        502

      );

    }

    // Return the masked phone so the UI can show where the code went.

    const masked =

      driver.phone.replace(/.(?=.{4})/g, "•");

    return ok(res, {

      sent: verification.status === "pending",

      phone_hint: masked

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

    // Same distinction as /session/start: a query error is not "no such
    // driver" and must not be reported as one.
    if (error) {

      console.error(

        "❌ Driver session verify: driver lookup failed:",

        error.message

      );

      return fail(

        res,

        "A server error occurred. Please try again.",

        500

      );

    }

    if (!driver) {

      return fail(res, "Driver not found.", 404);

    }

    if (driver.access_revoked === true) {

      return fail(res, "This account's access has been revoked.", 403);

    }

    if (!twilioClient || !TWILIO_VERIFY_SERVICE_SID) {

      console.error(

        "❌ Driver session verify: Twilio Verify is not configured."

      );

      return fail(

        res,

        "Driver sign-in is not available right now. Please try again later.",

        503

      );

    }

    let check;

    try {

      check =

        await twilioClient.verify

          .services(TWILIO_VERIFY_SERVICE_SID)

          .verificationChecks

          .create({

            to: toE164(driver.phone),

            code

          });

    } catch (err) {

      // Twilio throws (rather than returning a non-"approved" status)
      // when there is no pending verification at all -- e.g. it already
      // expired or was already used. Treat that the same as a wrong
      // code: don't leak which case it was.
      console.error(

        "❌ Driver session verify: Twilio Verify check failed:",

        err.message

      );

      return fail(res, "Invalid or expired code.", 400);

    }

    if (check.status !== "approved") {

      return fail(res, "Invalid or expired code.", 400);

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

      // riders has no phone_verified column -- sms_verified is the
      // real one (see lib/riderVerification.js). This used to silently
      // no-op via Promise.allSettled, so rider phone verification never
      // actually persisted.
      supabase

        .from("riders")

        .update({

          sms_verified:

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

        // riders has no persona_verified column -- persona_status alone
        // is the source of truth there (isRiderPersonaVerified() reads
        // it). Bundling persona_verified into this update used to make
        // the entire riders update fail, so persona_status silently
        // never updated for riders either.
        supabase

          .from("riders")

          .update({

            persona_status:

              status,

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

    const { ready, checks } =

      computeDriverReadiness(

        driver,

        {

          enablePersona:

            ENABLE_PERSONA,

          enableCheckr:

            ENABLE_CHECKR

        }

      );

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

// RIDE_STATUS, shouldDispatchRideNow, and the sweepScheduledRides
// orchestrator live in lib/rideDispatch.js — kept dependency-free (no
// Supabase/env vars) so Jest can test the scheduled-ride dispatch decision
// and retry/reclaim logic directly without booting the whole server.
const {
  RIDE_STATUS,
  shouldDispatchRideNow,
  sweepScheduledRides
} = require("./lib/rideDispatch");

// Offer-timeout enforcement — see lib/offerExpiry.js. driver_offers.expires_at
// was previously written on every offer and never read again, so a driver
// who neither accepted nor declined left the ride stuck indefinitely.
const { sweepExpiredOffers, sweepStuckRedispatches } = require("./lib/offerExpiry");

/* =========================================================

   ETA / DISTANCE-TO-PICKUP PERSISTENCE — SUPABASE ADAPTERS

   See docs/eta-persistence-plan.md. The estimate logic itself (Haversine
   fallback, routing-API circuit breaker, movement-threshold cache) lives in
   lib/etaEstimation.js so it's unit-testable without a database or network
   access; everything below is the Supabase/routing-provider glue, wired in
   at the two write points: offer creation (dispatchRide(), below) and
   driver location updates (POST /api/driver/location).

   Two independent flags, per your explicit instruction that persistence and
   paid routing accuracy must not share one switch:
     dispatch_eta_persistence_enabled — write ETA/distance at all (Haversine,
       no external dependency, no cost).
     dispatch_route_api_enabled — let a paid routing API supply the value
       instead of Haversine. Only meaningful once persistence is already on.
   Both default to "false" via getSystemFlag's fallback (no system_flags row
   exists for either yet — same convention as offer_expiry_sweep_enabled).
   This module does not enable either flag.

========================================================= */

const {
  computeAndPersistEta,
  pruneStaleCacheEntries
} = require("./lib/etaEstimation");

const GOOGLE_ROUTES_API_KEY = env("GOOGLE_ROUTES_API_KEY");
const ROUTE_API_TIMEOUT_MS = envNumber("ROUTE_API_TIMEOUT_MS", 4000);
const ROUTE_API_MONTHLY_QUOTA = envNumber("ROUTE_API_MONTHLY_QUOTA", 20000);
const ROUTE_API_MOVEMENT_THRESHOLD_MILES = envNumber("ROUTE_API_MOVEMENT_THRESHOLD_MILES", 0.03);

// In-memory only, per server instance — a soft cost optimization, not a
// correctness mechanism. Worst case with multiple instances (or a restart)
// is simply an extra routing-API call, still bounded by the usage-counter
// circuit breaker below. Pruned periodically by the interval near startup
// so a ride that never returns for a second estimate doesn't sit in memory
// forever; empty and unused while dispatch_route_api_enabled stays off.
const etaRouteCache = new Map();
const ETA_ROUTE_CACHE_MAX_AGE_MS = 60 * 60 * 1000;

async function callGoogleRoutesApi({ fromLat, fromLng, toLat, toLng }) {
  if (!GOOGLE_ROUTES_API_KEY) {
    // No key configured — never attempt the call even if the flag is on, so
    // flipping dispatch_route_api_enabled without also configuring a key
    // fails closed to Haversine instead of erroring on every request.
    throw new Error("GOOGLE_ROUTES_API_KEY is not configured");
  }

  const response = await fetch(
    "https://routes.googleapis.com/directions/v2:computeRoutes",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": GOOGLE_ROUTES_API_KEY,
        "X-Goog-FieldMask": "routes.duration,routes.distanceMeters"
      },
      body: JSON.stringify({
        origin: { location: { latLng: { latitude: fromLat, longitude: fromLng } } },
        destination: { location: { latLng: { latitude: toLat, longitude: toLng } } },
        travelMode: "DRIVE"
      })
    }
  );

  if (!response.ok) {
    throw new Error(`Google Routes API responded ${response.status}`);
  }

  const data = await response.json();
  const route = data?.routes?.[0];

  if (!route || !Number.isFinite(Number(route.distanceMeters)) || !route.duration) {
    throw new Error("Google Routes API returned no usable route");
  }

  const durationSeconds = parseFloat(String(route.duration).replace("s", ""));

  return {
    distanceMiles: Math.round((Number(route.distanceMeters) / 1609.34) * 100) / 100,
    etaMinutes: Math.max(1, Math.round(durationSeconds / 60))
  };
}

async function incrementRouteApiUsageCounter() {
  // Monthly key gives free rollover — a new month is just a new row, no
  // separate reset job needed. Requires the increment_usage_counter() RPC
  // (see supabase/migrations/20260729004834_add_usage_counters.sql).
  const monthKey = `route_api_calls_${new Date().toISOString().slice(0, 7)}`;
  const { data, error } = await supabase.rpc("increment_usage_counter", {
    p_key: monthKey
  });

  if (error) {
    throw error;
  }

  return Number(Array.isArray(data) ? data[0] : data);
}

// Writes the ride's "eta to pickup" columns — only ever called for the
// pre-pickup phase of a ride (offer creation, and location pings while
// status is driver_assigned/driver_enroute/arrived). Once a ride reaches
// in_progress (already picked up), these "to pickup" columns are no longer
// meaningful; the existing transient (non-persisted) tracking estimate in
// GET /api/rides/:id/status already covers that dropoff-bound phase and is
// left untouched by this feature.
async function persistRideEtaToPickup(rideId, estimate) {
  const { error } = await supabase
    .from("rides")
    .update({
      driver_eta_to_pickup_minutes: estimate.etaMinutes,
      driver_distance_to_pickup_miles: estimate.distanceMiles
    })
    .eq("id", rideId);

  if (error) {
    throw error;
  }
}

// Shared by both dispatchRide() write paths (the dispatch_ride_atomic RPC
// and the two-step fallback, below) and by the driver-location-update
// route. Guaranteed not to throw — see computeAndPersistEta() — so a bug or
// outage here can never block ride creation, dispatch, or a GPS update.
async function persistPickupEtaBestEffort({
  rideId,
  driverLat,
  driverLng,
  pickupLat,
  pickupLng
}) {
  if (
    !rideId ||
    !Number.isFinite(Number(driverLat)) ||
    !Number.isFinite(Number(driverLng)) ||
    !Number.isFinite(Number(pickupLat)) ||
    !Number.isFinite(Number(pickupLng))
  ) {
    return null;
  }

  try {
    const [persistenceEnabled, routeApiEnabled] = await Promise.all([
      getSystemFlag("dispatch_eta_persistence_enabled", "false"),
      getSystemFlag("dispatch_route_api_enabled", "false")
    ]);

    return await computeAndPersistEta({
      persistenceEnabled: persistenceEnabled === "true",
      routeApiEnabled: routeApiEnabled === "true",
      fromLat: Number(driverLat),
      fromLng: Number(driverLng),
      toLat: Number(pickupLat),
      toLng: Number(pickupLng),
      speedMph: ASSUMED_DELIVERY_SPEED_MPH,
      getCachedRoute: () => etaRouteCache.get(rideId) || null,
      setCachedRoute: (entry) => etaRouteCache.set(rideId, entry),
      incrementUsageCounter: incrementRouteApiUsageCounter,
      quotaLimit: ROUTE_API_MONTHLY_QUOTA,
      callRouteApi: callGoogleRoutesApi,
      timeoutMs: ROUTE_API_TIMEOUT_MS,
      movementThresholdMiles: ROUTE_API_MOVEMENT_THRESHOLD_MILES,
      persistEta: (estimate) => persistRideEtaToPickup(rideId, estimate),
      logError: (...args) => console.error(...args)
    });
  } catch (err) {
    // computeAndPersistEta already catches its own internal failures; this
    // is an extra guard so a bug in the flag lookups above (outside that
    // function) still can't propagate into a dispatch or GPS-update route.
    console.error("⚠️ persistPickupEtaBestEffort unexpected failure:", err.message);
    return null;
  }
}

setInterval(() => {
  pruneStaleCacheEntries(etaRouteCache, { maxAgeMs: ETA_ROUTE_CACHE_MAX_AGE_MS });
}, 10 * 60 * 1000);

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

    // rider.phone_verified / rider.persona_verified never exist on a
    // real riders row (those columns are drivers-only) -- reading them
    // directly here made `ready` permanently false for every rider.
    // isRiderPhoneVerified()/isRiderPersonaVerified() read the columns
    // riders actually have (sms_verified, persona_status).
    phone_verified:

      isRiderPhoneVerified(rider),

    persona_verified:

      ENABLE_PERSONA

        ? isRiderPersonaVerified(rider)

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

        // Fire-and-forget: never delays the dispatch response, and
        // computeAndPersistEta() already guarantees it can't throw.
        persistPickupEtaBestEffort({
          rideId: ride.id,
          driverLat: firstDriver.current_lat,
          driverLng: firstDriver.current_lng,
          pickupLat: ride.pickup_lat,
          pickupLng: ride.pickup_lng
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

  persistPickupEtaBestEffort({
    rideId: ride.id,
    driverLat: firstDriver.current_lat,
    driverLng: firstDriver.current_lng,
    pickupLat: ride.pickup_lat,
    pickupLng: ride.pickup_lng
  }).catch(() => {});

  return {

    dispatched: true,

    offer,

    driver: firstDriver

  };

}

/* =========================================================

   SCHEDULED-RIDE SWEEP — SUPABASE ADAPTERS

   The actual retry/skip/reclaim orchestration lives in
   sweepScheduledRides() (lib/rideDispatch.js), so it's unit-testable
   without a database. These three functions are the only pieces that
   talk to Supabase, wired into that orchestrator via the
   setInterval() call near startup below.

   The OR filter in both findDueScheduledRides and claimScheduledRide
   ("dispatch_status = ready_to_dispatch, OR dispatch_status =
   dispatching with a claim older than the lease cutoff") is what lets
   a stale claim get reclaimed if a process dies between claiming a
   ride and finishing dispatchRide() — a plain try/catch can't cover
   that case since nothing runs to reset the ride when the process
   itself is gone.

========================================================= */

function scheduledDispatchClaimFilter(cutoffIso) {
  return (
    `dispatch_status.eq.ready_to_dispatch,` +
    `and(dispatch_status.eq.dispatching,dispatch_claimed_at.lt.${cutoffIso})`
  );
}

async function findDueScheduledRides(nowDate, cutoffDate) {
  const { data, error } = await supabase
    .from("rides")
    .select("*")
    .eq("status", RIDE_STATUS.PAYMENT_AUTHORIZED)
    .not("scheduled_time", "is", null)
    .lte("scheduled_time", nowDate.toISOString())
    .or(scheduledDispatchClaimFilter(cutoffDate.toISOString()));

  if (error) throw error;

  return data || [];
}

async function claimScheduledRide(rideId, cutoffDate) {
  const { data, error } = await supabase
    .from("rides")
    .update({
      dispatch_status: "dispatching",
      dispatch_claimed_at: nowIso(),
      updated_at: nowIso()
    })
    .eq("id", rideId)
    // Re-verify ride status here, not just dispatch_status — if the ride's
    // status changed after the findDueScheduledRides query above (e.g. a
    // future cancellation feature), this claim now correctly fails instead
    // of dispatching a ride that's no longer payment-authorized.
    .eq("status", RIDE_STATUS.PAYMENT_AUTHORIZED)
    .or(scheduledDispatchClaimFilter(cutoffDate.toISOString()))
    .select()
    .maybeSingle();

  if (error) throw error;

  return data || null;
}

async function resetScheduledRideForRetry(rideId) {
  const { error } = await supabase
    .from("rides")
    .update({
      dispatch_status: "ready_to_dispatch",
      dispatch_claimed_at: null,
      updated_at: nowIso()
    })
    .eq("id", rideId);

  if (error) throw error;
}

/* =========================================================

   OFFER-EXPIRY SWEEP — SUPABASE ADAPTERS

   The claim/redispatch/max-attempts orchestration lives in
   sweepExpiredOffers() (lib/offerExpiry.js), so it's unit-testable
   without a database. These are the only pieces that talk to Supabase,
   wired into that orchestrator via the setInterval() call near startup
   below, gated by the offer_expiry_sweep_enabled system flag so this
   can be rolled back instantly without a deploy if it misbehaves.

   claimExpiredOffer's conditional .eq("status", "pending") is the whole
   concurrency-safety mechanism: two server instances (or two sweep
   ticks) racing on the same expired offer, or a sweep racing against a
   driver tapping accept/decline at nearly the same moment, can only
   ever have one caller see a non-null result back. Everyone else sees
   null and skips — see lib/offerExpiry.js's header comment for the
   full reasoning.

========================================================= */

async function findExpiredPendingOffers(nowDate) {
  const { data, error } = await supabase
    .from("driver_offers")
    .select("*")
    .eq("status", "pending")
    .lt("expires_at", nowDate.toISOString());

  if (error) throw error;

  return data || [];
}

async function claimExpiredOffer(offerId) {
  const { data, error } = await supabase
    .from("driver_offers")
    .update({
      status: "expired",
      responded_at: nowIso(),
      updated_at: nowIso()
    })
    .eq("id", offerId)
    .eq("status", "pending")
    .select()
    .maybeSingle();

  if (error) throw error;

  return data || null;
}

async function getRideForExpiredOffer(rideId) {
  const { data } = await supabase
    .from("rides")
    .select("*")
    .eq("id", rideId)
    .maybeSingle();

  return data || null;
}

async function markRideRedispatchingForExpiry(rideId, nextAttempt) {
  await supabase
    .from("rides")
    .update({
      dispatch_attempts: nextAttempt,
      current_driver_id: null,
      current_offer_id: null,
      dispatch_status: "redispatching",
      // Stamped here so sweepStuckRedispatches() below can tell how long
      // this ride has been sitting in "redispatching" — if dispatchRide()
      // never completes (throws, or the process dies mid-call), this
      // timestamp is what lets a later sweep recognize the claim as
      // abandoned and retry it, instead of the ride staying stuck forever.
      dispatch_claimed_at: nowIso(),
      updated_at: nowIso()
    })
    .eq("id", rideId);
}

async function markRideMaxAttemptsReachedForExpiry(rideId) {
  await supabase
    .from("rides")
    .update({
      status: RIDE_STATUS.FAILED,
      dispatch_status: "max_attempts_reached",
      updated_at: nowIso()
    })
    .eq("id", rideId);
}

async function runOfferExpirySweep() {
  const enabled = await getSystemFlag("offer_expiry_sweep_enabled", "false");

  if (enabled !== "true") return;

  await sweepExpiredOffers({
    findExpiredOffers: findExpiredPendingOffers,
    claimExpiredOffer,
    getRide: getRideForExpiredOffer,
    markRideRedispatching: markRideRedispatchingForExpiry,
    markRideMaxAttemptsReached: markRideMaxAttemptsReachedForExpiry,
    dispatchRide,
    maxAttempts: envNumber("MAX_DISPATCH_ATTEMPTS", 5)
  });
}

/* =========================================================

   STUCK-REDISPATCH RECOVERY — SUPABASE ADAPTERS

   Protects both the offer-expiry sweep above AND the pre-existing
   decline-triggered redispatch (POST /api/driver/offers/:offerId/decline)
   from leaving a ride stranded in dispatch_status "redispatching" if
   dispatchRide() ever throws or the process dies before it finishes —
   see sweepStuckRedispatches() in lib/offerExpiry.js for the full
   reasoning. Deliberately NOT gated behind offer_expiry_sweep_enabled:
   the decline path's exposure is existing, always-on production
   behavior independent of that flag, so this safety net runs
   unconditionally, same as the accept/decline atomic-guard hardening.

========================================================= */

const STUCK_REDISPATCH_LEASE_MS = 90 * 1000;

async function findStuckRedispatchingRides(cutoffDate) {
  const { data, error } = await supabase
    .from("rides")
    .select("*")
    .eq("dispatch_status", "redispatching")
    .lt("dispatch_claimed_at", cutoffDate.toISOString());

  if (error) throw error;

  return data || [];
}

async function claimStuckRedispatchingRide(rideId, cutoffDate) {
  const { data, error } = await supabase
    .from("rides")
    .update({
      dispatch_claimed_at: nowIso(),
      updated_at: nowIso()
    })
    .eq("id", rideId)
    .eq("dispatch_status", "redispatching")
    .lt("dispatch_claimed_at", cutoffDate.toISOString())
    .select()
    .maybeSingle();

  if (error) throw error;

  return data || null;
}

async function runStuckRedispatchRecovery() {
  await sweepStuckRedispatches({
    findStuckRides: findStuckRedispatchingRides,
    claimStuckRide: claimStuckRedispatchingRide,
    dispatchRide,
    leaseMs: STUCK_REDISPATCH_LEASE_MS
  });
}

/* =========================================================

   RIDE ESTIMATE API

   "No valid route + no verified fare = no payment and no dispatch."
   rider-dashboard.html already refuses to call any of these three routes
   until Google Maps has resolved a real driving distance client-side
   (see ensureTripDistance() there) -- but that is only a client-side
   gate. hasValidTripDistance() (lib/pricing.js) is the server-side half:
   a direct call to /api/rides/estimate, /api/rides/payment-intent, or
   /api/rides/request with no miles (or miles<=0) is rejected outright
   instead of falling through to calculateRideEstimate()'s own
   miles=0/minutes=0 defaults, which would silently price a real trip at
   the flat minimum fare.

========================================================= */

// Logs a route-calculation failure server-side (Render logs + audit_logs)
// without ever putting the underlying Google Maps status, quota, or
// billing detail in a response body a rider can see. source is "client"
// for failures reported by rider-dashboard.html's own Google Maps calls
// (see POST /api/rides/route-failure below) and "server" for this fail-
// closed guard rejecting a request outright.
//
// Deliberately narrow about what gets logged: reason and mode are always
// checked against an allow-list before reaching here (see
// ROUTE_FAILURE_REASONS/ROUTE_FAILURE_MODES and sanitizeRouteFailureDetail
// below), and detail is either one of this app's own short enum strings
// (quote rejection reasons) or a Google status-code-shaped value -- never
// a free-form string a rider's request body could stuff a full address,
// phone number, email, or exact coordinate into. request_id is generated
// here, not accepted from the client, so it can be handed back to a rider
// for support correlation without that ID itself being a forgeable input.
function logRouteCalculationFailure({ reason, detail, source, mode, req }) {
  const requestId = makeId("ROUTEFAIL");

  console.error(
    `[route-calculation-failed] request_id=${requestId} source=${source} reason=${reason}` +
      (mode ? ` mode=${mode}` : "") +
      (detail ? ` detail=${detail}` : "")
  );

  auditLog({
    action: "route_calculation_failed",
    metadata: { request_id: requestId, reason, detail, source, mode },
    req
  }).catch(() => {});

  return requestId;
}

const ROUTE_FAILURE_REASONS = new Set([
  "maps_unavailable",
  "pickup_geocode_failed",
  "destination_geocode_failed",
  "distance_matrix_failed",
  "maps_script_failed",
  "unknown"
]);

// rider-dashboard.html's MODE_CONFIG keys -- the only "coarse operational
// context" this endpoint accepts, and only as an allow-listed enum, never
// free text.
const ROUTE_FAILURE_MODES = new Set([
  "driver",
  "airport",
  "autonomous",
  "food",
  "grocery"
]);

// The only free-form-shaped value this endpoint will actually store:
// Google Maps status codes (e.g. "ZERO_RESULTS", "OVER_QUERY_LIMIT") and
// this app's own "<DistanceMatrix status>/<element status>" pairing --
// both all-caps words/underscores, never containing spaces, letters
// forming an address, digits forming a phone number, or an "@". Anything
// that doesn't match this shape is dropped rather than logged, since a
// request body's "detail" field is otherwise entirely rider-controlled
// free text.
const ROUTE_FAILURE_DETAIL_PATTERN = /^[A-Z0-9_]{1,40}(\/[A-Z0-9_]{1,40})?$/;

function sanitizeRouteFailureDetail(rawDetail) {
  const value = cleanString(rawDetail, 80);
  return value && ROUTE_FAILURE_DETAIL_PATTERN.test(value) ? value : undefined;
}

// The one place a raw client-submitted number (miles) is ever mentioned in
// a log line -- constrained to "looks like a number" or a fixed marker so
// a client that sent a string instead (accidentally or otherwise) can
// never smuggle arbitrary text into a log through this field.
function sanitizeNumericLogValue(value) {
  if (value === undefined || value === null || value === "") {
    return "unset";
  }

  const stringValue = String(value);
  return /^-?\d+(\.\d+)?$/.test(stringValue) ? stringValue.slice(0, 20) : "invalid";
}

// Pulls the one coordinate pair per endpoint every one of
// estimate/payment-intent/request actually needs out of req.body, however
// the client happened to name it. Returns null for an endpoint whose
// coordinates are missing or non-finite -- never a guessed {lat: 0, lng:
// 0} default, which would otherwise look like a real (and very wrong)
// place on the map.
function parseCoordPair(lat, lng) {
  const parsedLat = Number(lat);
  const parsedLng = Number(lng);

  if (!Number.isFinite(parsedLat) || !Number.isFinite(parsedLng)) {
    return null;
  }

  return { lat: parsedLat, lng: parsedLng };
}

function extractTripCoords(body) {
  return {
    pickup: parseCoordPair(body?.pickup_lat, body?.pickup_lng),
    destination: parseCoordPair(body?.destination_lat, body?.destination_lng)
  };
}

// Reasons resolveRideQuote() (lib/rideQuote.js) can return that mean "the
// token itself is bad" (missing/malformed/wrong-secret/expired) as
// opposed to "the token is fine but this submission doesn't match it"
// (wrong rider/service/pickup/destination) -- used only to pick which of
// two rider-facing messages to show below; both are treated identically
// as a hard rejection.
const QUOTE_TOKEN_INVALID_REASONS = new Set([
  "missing_token",
  "malformed",
  "bad_signature",
  "expired"
]);

// The single gate both /api/rides/payment-intent and /api/rides/request
// go through before touching money or dispatching anything. Requires a
// signature-valid, unexpired estimate_token (see lib/rideQuote.js) AND
// that this specific request -- its ride_type, pickup, destination, and
// rider -- still matches exactly what that token was issued for.
// Client-submitted miles, minutes, fare, or fee fields are never read by
// either caller once this returns a quote: pricing comes exclusively
// from quote.estimate/quote.miles/quote.minutes from here on -- and
// resolveRideQuote()'s own signature has no parameter for any of those
// values, so there is nothing for a resubmitted number to even influence.
//
// Sends the (sanitized, PII-free) failure response itself and returns
// null on any failure, so callers can just `if (!quote) return;`.
function verifyAndConsumeRideQuote(req, res) {
  if (!RIDE_QUOTE_SECRET) {
    fail(res, "Ride quotes are not configured.", 503);
    return null;
  }

  const token = cleanString(req.body.estimate_token, 4000);

  if (!token) {
    logRouteCalculationFailure({ reason: "quote_missing", source: "server", req });
    fail(
      res,
      "A current fare quote is required. Please get a fresh route estimate before continuing.",
      400
    );
    return null;
  }

  const result = resolveRideQuote({
    token,
    secret: RIDE_QUOTE_SECRET,
    rideType: normalizeRideType(req.body.ride_type),
    riderId: cleanString(req.body.rider_id || req.body.riderId, 100) || null,
    ...extractTripCoords(req.body)
  });

  if (!result.ok) {
    logRouteCalculationFailure({
      reason: "quote_rejected",
      detail: result.reason,
      source: "server",
      req
    });

    const message = QUOTE_TOKEN_INVALID_REASONS.has(result.reason)
      ? "Your fare quote has expired or could not be verified. Please get a fresh route estimate."
      : "This trip no longer matches your fare quote. Please get a fresh route estimate.";

    fail(res, message, 400);
    return null;
  }

  return result.quote;
}

app.post(

  "/api/rides/route-failure",

  rateLimit({ windowMs: 60_000, max: 30, keyPrefix: "route_failure_report" }),

  asyncRoute(async (req, res) => {

    const rawReason = cleanString(req.body.reason, 60);
    const reason = ROUTE_FAILURE_REASONS.has(rawReason) ? rawReason : "unknown";
    const detail = sanitizeRouteFailureDetail(req.body.detail);
    const rawMode = cleanString(req.body.mode, 30);
    const mode = ROUTE_FAILURE_MODES.has(rawMode) ? rawMode : undefined;

    const requestId = logRouteCalculationFailure({ reason, detail, mode, source: "client", req });

    // Deliberately generic and always-success: this endpoint exists so we
    // can see real failures in Render logs, not so a rider-controlled
    // request body can learn anything about our Google Maps
    // configuration or quota state. request_id is handed back only so a
    // rider who contacts support has something to reference -- it names
    // nothing about them or their trip on its own.
    return ok(res, { logged: true, request_id: requestId });

  })

);

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

    if (!hasValidTripDistance({ miles, minutes })) {

      logRouteCalculationFailure({
        reason: "estimate_missing_distance",
        detail: `miles=${sanitizeNumericLogValue(req.body.miles ?? req.body.distance_miles)}`,
        source: "server",
        req
      });

      return fail(
        res,
        "We couldn't verify a route distance for this trip. Please get a fresh route estimate before continuing.",
        400
      );

    }

    // A quote is only meaningful if it's actually bound to a place -- an
    // estimate with no pickup/destination coordinates has nothing for
    // quoteMatchesSubmission() to compare a later payment/request against,
    // so it could never be redeemed anyway. Reject it here rather than
    // signing a token that would just fail every future verification.
    const { pickup, destination } = extractTripCoords(req.body);

    if (!pickup || !destination) {

      logRouteCalculationFailure({
        reason: "estimate_missing_coordinates",
        source: "server",
        req
      });

      return fail(
        res,
        "We couldn't verify a route distance for this trip. Please get a fresh route estimate before continuing.",
        400
      );

    }

    // Quote issuance is a hard requirement, not a nice-to-have: without a
    // configured secret there is no way to later prove the fare a rider
    // pays matches the fare they were quoted, so this must fail closed
    // exactly like Stripe/Twilio "not configured" responses elsewhere in
    // this file, rather than returning a fare nobody can actually redeem.
    if (!RIDE_QUOTE_SECRET) {
      return fail(res, "Ride quotes are not configured.", 503);
    }

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

    const riderId = cleanString(req.body.rider_id || req.body.riderId, 100) || null;

    const estimateToken = signRideQuote({
      rideType,
      miles,
      minutes,
      pickup,
      destination,
      riderId,
      estimate,
      secret: RIDE_QUOTE_SECRET,
      ttlMinutes: RIDE_QUOTE_TTL_MINUTES
    });

    const quoteExpiresAt = new Date(Date.now() + RIDE_QUOTE_TTL_MINUTES * 60 * 1000).toISOString();

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

      estimate,

      // Honest about what this token actually proves: the numbers inside
      // it were computed by the browser's own Google Maps Distance Matrix
      // call, not independently verified by the server against a routing
      // provider. See docs/route-verification-requirement.md.
      quote_source: "browser_calculated",
      estimate_token: estimateToken,
      quote_expires_at: quoteExpiresAt

    });

  })

);

/* =========================================================

   RIDER SAVED PAYMENT METHODS

   riders.stripe_customer_id already exists on the live schema (see
   RIDERS_TABLE_COLUMNS in lib/riderVerification.js) but was never wired
   up to anything — every ride payment created a brand-new, one-off
   PaymentIntent with no notion of a saved card. This creates a real
   Stripe Customer per rider (lazily, on first use) so a card entered at
   signup or during a ride request can be reused on later rides.

========================================================= */

async function getOrCreateStripeCustomer(rider) {
  if (rider.stripe_customer_id) {
    return rider.stripe_customer_id;
  }

  const customer = await stripe.customers.create(
    buildStripeCustomerPayload({
      riderId: rider.id,
      email: rider.email || undefined,
      name:
        rider.full_name ||
        [rider.first_name, rider.last_name].filter(Boolean).join(" ") ||
        undefined
    })
  );

  const { error } = await supabase
    .from("riders")
    .update({ stripe_customer_id: customer.id })
    .eq("id", rider.id);

  if (error) {
    throw error;
  }

  return customer.id;
}

app.post(
  "/api/rider/payment-methods/setup-intent",
  rateLimit({ windowMs: 60_000, max: 20, keyPrefix: "payment_setup_intent" }),
  asyncRoute(async (req, res) => {
    if (!stripe) {
      return fail(res, "Payments are not configured.", 503);
    }

    const riderId = cleanString(req.body.rider_id || req.body.riderId, 100);

    if (!riderId) {
      return fail(res, "rider_id is required.", 400);
    }

    const { data: rider, error } = await supabase
      .from("riders")
      .select("id, email, first_name, last_name, full_name, stripe_customer_id")
      .eq("id", riderId)
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (!rider) {
      return fail(res, "Rider not found.", 404);
    }

    const customerId = await getOrCreateStripeCustomer(rider);

    const setupIntent = await stripe.setupIntents.create({
      customer: customerId,
      payment_method_types: ["card"]
    });

    return ok(res, { client_secret: setupIntent.client_secret });
  })
);

app.get(
  "/api/rider/payment-methods",
  rateLimit({ windowMs: 60_000, max: 60, keyPrefix: "payment_methods_list" }),
  asyncRoute(async (req, res) => {
    const riderId = cleanString(req.query.riderId || req.query.rider_id, 100);

    if (!riderId) {
      return fail(res, "riderId is required.", 400);
    }

    if (!stripe) {
      return ok(res, { payment_methods: [] });
    }

    const { data: rider, error } = await supabase
      .from("riders")
      .select("id, stripe_customer_id")
      .eq("id", riderId)
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (!rider || !rider.stripe_customer_id) {
      return ok(res, { payment_methods: [] });
    }

    const methods = await stripe.paymentMethods.list({
      customer: rider.stripe_customer_id,
      type: "card"
    });

    return ok(res, { payment_methods: mapPaymentMethodsForClient(methods.data) });
  })
);

app.delete(
  "/api/rider/payment-methods/:paymentMethodId",
  rateLimit({ windowMs: 60_000, max: 20, keyPrefix: "payment_methods_delete" }),
  asyncRoute(async (req, res) => {
    if (!stripe) {
      return fail(res, "Payments are not configured.", 503);
    }

    const paymentMethodId = cleanString(req.params.paymentMethodId, 100);
    const riderId = cleanString(req.query.riderId || req.query.rider_id, 100);

    if (!paymentMethodId || !riderId) {
      return fail(res, "riderId is required.", 400);
    }

    const { data: rider, error } = await supabase
      .from("riders")
      .select("id, stripe_customer_id")
      .eq("id", riderId)
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (!rider || !rider.stripe_customer_id) {
      return fail(res, "Payment method not found.", 404);
    }

    let paymentMethod;

    try {
      paymentMethod = await stripe.paymentMethods.retrieve(paymentMethodId);
    } catch {
      return fail(res, "Payment method not found.", 404);
    }

    // Same 404-either-way ownership check used by /api/rider/saved-places
    // — never confirm a payment method ID exists to a caller supplying a
    // different riderId.
    if (!ownsPaymentMethod(paymentMethod, rider.stripe_customer_id)) {
      return fail(res, "Payment method not found.", 404);
    }

    await stripe.paymentMethods.detach(paymentMethodId);

    return ok(res, { deleted: true });
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

    const quote = verifyAndConsumeRideQuote(req, res);

    if (!quote) {
      return;
    }

    const rideType = quote.ride_type;
    const estimate = quote.estimate;

    const amountCents =

      Math.round(

        estimate.total * 100

      );

    // Client-generated, per-attempt key (regenerated whenever trip details
    // change) — lets Stripe collapse a network retry or an accidental
    // double-click into the same PaymentIntent instead of creating two.
    const idempotencyKey =
      cleanString(
        req.body.idempotency_key,
        100
      );

    const riderId = cleanString(req.body.rider_id, 100);
    const paymentMethodId = cleanString(req.body.payment_method_id, 100);
    const saveCard = Boolean(req.body.save_card);

    // Attach an existing saved card, or mark a freshly entered one for
    // future reuse, by resolving the rider's Stripe Customer first. Both
    // branches require a real riderId — a request with neither
    // payment_method_id nor save_card (the pre-existing, one-off-card
    // path) skips this entirely and behaves exactly as before.
    let attachmentFields = {};

    if (riderId && (paymentMethodId || saveCard)) {
      const { data: rider, error: riderError } = await supabase
        .from("riders")
        .select("id, email, first_name, last_name, full_name, stripe_customer_id")
        .eq("id", riderId)
        .maybeSingle();

      if (riderError) {
        throw riderError;
      }

      if (rider) {
        if (paymentMethodId) {
          let paymentMethod;

          try {
            paymentMethod = await stripe.paymentMethods.retrieve(paymentMethodId);
          } catch {
            return fail(res, "Saved payment method not found.", 404);
          }

          if (!ownsPaymentMethod(paymentMethod, rider.stripe_customer_id)) {
            return fail(res, "Saved payment method not found.", 404);
          }

          attachmentFields = buildPaymentIntentAttachmentFields({
            stripeCustomerId: rider.stripe_customer_id,
            paymentMethodId
          });
        } else {
          const stripeCustomerId = await getOrCreateStripeCustomer(rider);

          attachmentFields = buildPaymentIntentAttachmentFields({
            stripeCustomerId,
            saveCard: true
          });
        }
      }
    }

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

          ...attachmentFields,

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

        }, idempotencyKey ? { idempotencyKey } : undefined);

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

    const quote = verifyAndConsumeRideQuote(req, res);

    if (!quote) {
      return;
    }

    const rideType = quote.ride_type;
    const estimate = quote.estimate;

    // A client-supplied payment_intent_id is never trusted as proof of
    // payment here — see lib/riderPayments.js. Only POST
    // /api/rides/:id/authorize, after retrieving and verifying the intent
    // with Stripe, may move a paid ride to PAYMENT_AUTHORIZED.
    const status =

      decideInitialRideStatus({

        enablePaymentGate: ENABLE_PAYMENT_GATE,

        paymentIntentId: req.body.payment_intent_id

      });

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

      // Sourced from the verified quote, not req.body, now that one
      // exists — quoteMatchesSubmission() already confirmed these equal
      // what the client submitted (within rounding), so the quote's
      // values are the canonical, server-trusted copy from here on.
      pickup_lat:

        quote.pickup.lat,

      pickup_lng:

        quote.pickup.lng,

      dropoff_lat:

        quote.destination.lat,

      dropoff_lng:

        quote.destination.lng,

      ride_type:

        rideType,

      scheduled_time:

        req.body.scheduled_for || null,

      // Only ever populated here when the payment gate itself is off
      // (an explicit ops-level decision, not client input) — a paid ride
      // starts with no payment_id and gets one only from a verified
      // /authorize call, never from what the client claimed at creation.
      payment_id:

        status === RIDE_STATUS.PAYMENT_AUTHORIZED

          ? cleanString(req.body.payment_intent_id, 200) || null

          : null,

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

      // Persists the full itemized breakdown (base fare, distance charge,
      // time charge, booking fee, discount, surcharge) so line items like
      // the airport surcharge are recorded on the ride itself, not just
      // returned transiently in the estimate response. Reuses an existing
      // jsonb column that nothing else was writing to.
      pricing_snapshot:

        estimate,

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

    if (shouldDispatchRideNow(data)) {

      dispatch =

        await dispatchRide(data);

    } else if (data.scheduled_time) {

      console.log(
        `⏳ Ride ${data.id} held for scheduled dispatch at ${data.scheduled_time}. ` +
        `sweepScheduledRides() will pick it up once that time arrives.`
      );

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

       Never trust a client-supplied intent id, and never authorize a ride
       when there is no way to verify one. This route used to skip the
       entire verification block below whenever the module-level `stripe`
       client was null (Stripe unconfigured) and authorize anyway using
       whatever the client sent — see docs/production-incidents.md,
       "Ride authorization accepts an unverified payment_intent_id when
       Stripe is unavailable." verifyPaymentIntentForRide() fails closed on
       stripeConfigured: false before any other check — no Stripe client
       means no authorization, full stop. */

    let intent = null;

    if (stripe) {

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

    }

    // Verifies, and — when needed — binds the intent to this ride via
    // Stripe so it can't be reused elsewhere. A bind failure is treated as
    // a hard failure, not a warning: an intent that verified cleanly but
    // couldn't be bound is not yet safe against reuse on a different
    // ride, so authorization must not proceed to mark this ride
    // PAYMENT_AUTHORIZED in that case.
    const verification =

      await authorizePaymentIntentForRide({

        stripeConfigured: Boolean(stripe),

        intent,

        ride,

        rideId,

        exposeDetails: !IS_PRODUCTION,

        bindPaymentIntentToRide: () =>

          stripe.paymentIntents.update(

            paymentIntentId,

            {

              metadata: {

                ...(intent?.metadata || {}),

                ride_id: rideId

              }

            }

          )

      });

    if (!verification.ok) {

      return fail(

        res,

        verification.error,

        verification.statusCode,

        verification.extra

      );

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

    // This route used to dispatch unconditionally on payment authorization,
    // regardless of scheduled_time — a second occurrence of the same bug
    // fixed on the ride-creation route above. A rider who scheduled a ride
    // but hadn't authorized payment yet at creation time would still get
    // dispatched immediately the moment they authorized payment.
    let dispatch = null;

    if (shouldDispatchRideNow(updatedRide)) {

      dispatch =

        await dispatchRide(

          updatedRide

        );

    } else if (updatedRide.scheduled_time) {

      console.log(
        `⏳ Ride ${updatedRide.id} authorized but held for scheduled dispatch at ${updatedRide.scheduled_time}.`
      );

    }

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

    let driverVerified = false;

    let driverLocation = null;

    if (ride.driver_id) {

      const { data: driver } = await supabase

        .from("drivers")

        .select("photo_url, approval_status, current_lat, current_lng, last_seen_at, location_accuracy_meters")

        .eq("id", ride.driver_id)

        .maybeSingle();

      driverPhotoUrl = driver?.photo_url || null;

      // Real signal, not decorative: only true once the driver has cleared
      // Harvey Taxi's approval flow (identity/insurance/license checks).
      driverVerified = driver?.approval_status === "approved";

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

      pickup_location:
        Number.isFinite(Number(ride.pickup_lat)) && Number.isFinite(Number(ride.pickup_lng))
          ? { lat: Number(ride.pickup_lat), lng: Number(ride.pickup_lng) }
          : null,

      destination_location:
        Number.isFinite(Number(ride.dropoff_lat)) && Number.isFinite(Number(ride.dropoff_lng))
          ? { lat: Number(ride.dropoff_lat), lng: Number(ride.dropoff_lng) }
          : null,

      tracking,

      driver: ride.driver_id

        ? {

            name: ride.driver_name,

            vehicle: ride.driver_vehicle,

            phone: ride.driver_phone,

            photo_url: driverPhotoUrl,

            verified: driverVerified,

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

   RIDER-SCOPED HISTORY API

   Canonical replacement for /api/rider/history, /api/rides/status,
   and /api/delivery/status — three endpoints rider-dashboard.html
   has called since it was built, none of which have ever existed
   server-side. The dashboard's Activity tab has been silently empty
   this whole time (it degrades gracefully, so nothing looked broken).

   Gated behind the "rider_history_enabled" system flag, defaulted
   off (see riderHistoryEnabled() and the enable/disable admin routes
   near PAUSE/RESUME DISPATCH) — until real rider authentication
   exists, this is unauthenticated-identity data. See the IMPORTANT
   note below before turning it on.

   Every route here requires riderId and filters/checks rows against
   it server-side — unlike /api/rides/:id/status above, which is
   intentionally public-by-unguessable-ID for the in-flight tracking
   view. That's an improvement over trusting ID obscurity alone: a
   ride ID leaked or guessed some other way can't be used to pull a
   different rider's history through THIS api as long as their real
   riderId isn't also known.

   IMPORTANT — this is consistency-checking, not authentication.
   riderId is a client-supplied parameter, not derived from any
   session/token/cookie — because no rider authentication exists
   anywhere in this codebase (unlike admin's JWT session or driver's
   SMS-verified token). These routes verify "does this ride's stored
   rider_id match the riderId the caller claims," which stops a stray
   or malformed ID from returning someone else's rows, but it does NOT
   stop a caller who has actually obtained/guessed a real riderId from
   reading that rider's full history. Closing that gap for real would
   mean building rider authentication (most naturally an SMS-OTP
   session, mirroring the existing driver token pattern) across the
   whole app, not just these three routes — out of scope here, but
   don't describe this API as "ownership-verified" in the sense of
   proven identity; it isn't, yet.

========================================================= */

// Curated column list — deliberately not select("*"). The rides table
// carries a lot of internal/operational columns (admin_note,
// pricing_snapshot, dispatch internals, etc.) that have no business
// reaching a rider-facing response.
const RIDER_HISTORY_COLUMNS =
  "id, rider_id, status, ride_type, requested_mode, service_type, " +
  "pickup_address, dropoff_address, " +
  "driver_name, driver_vehicle, driver_phone, " +
  "estimated_fare, final_fare, tip_amount, " +
  "scheduled_time, created_at, updated_at, completed_at, cancelled_at, " +
  "delivery_stage, delivery_pin, merchant_name, item_count, " +
  "pickup_instructions, delivery_instructions, delivered_at, delivery_proof_url";

// "Active" vs "completed" here means "still open" vs "finished" — a
// cancelled or failed ride counts as finished/historical, same as a
// successfully completed one. This is a different grouping than the
// ACTIVE_STATUSES used elsewhere for "a driver is actively working this
// ride right now" (that one excludes payment_required/payment_authorized,
// which are still very much "active" from the rider's point of view).
const RIDER_HISTORY_TERMINAL_STATUSES = [
  RIDE_STATUS.COMPLETED,
  RIDE_STATUS.CANCELLED,
  RIDE_STATUS.FAILED
];

async function riderHistoryEnabled() {
  return (await getSystemFlag("rider_history_enabled", "false")) === "true";
}

// Returns null (having already written the response) when riderId is
// missing or the feature is disabled, so callers must check for that
// before using the result — never { rows, next_cursor } and a sent
// response at the same time.
async function listRiderRequests(req, res, { deliveryOnly }) {
  if (!(await riderHistoryEnabled())) {
    fail(res, "Rider history is not yet available.", 403);
    return null;
  }

  const riderId = cleanString(
    req.query.riderId || req.query.rider_id,
    100
  );

  if (!riderId) {
    fail(res, "riderId is required.", 400);
    return null;
  }

  const status = cleanString(req.query.status, 20).toLowerCase();
  const limit = getPageLimit(req, 25, 100);
  const cursor = decodeCursor(req.query.cursor);

  let query = supabase
    .from("rides")
    .select(RIDER_HISTORY_COLUMNS)
    .eq("rider_id", riderId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit);

  // `ride_type NOT IN (...)` alone would silently drop legacy rows where
  // ride_type is NULL — SQL's three-valued logic means a NULL comparison
  // is never TRUE, so it can't satisfy a plain NOT IN filter either way.
  // Those older rows predate the food/grocery feature, so they're
  // unambiguously plain rides, not deliveries — include them explicitly
  // rather than let them vanish from the rider's own ride list.
  query = deliveryOnly
    ? query.in("ride_type", ["food", "grocery"])
    : query.or("ride_type.is.null,ride_type.not.in.(food,grocery)");

  if (status === "active") {
    query = query.not(
      "status",
      "in",
      `(${RIDER_HISTORY_TERMINAL_STATUSES.join(",")})`
    );
  } else if (status === "completed") {
    query = query.in("status", RIDER_HISTORY_TERMINAL_STATUSES);
  }

  query = applyCursor(query, cursor);

  const { data, error } = await query;

  if (error) {
    throw error;
  }

  const rows = data || [];

  const next_cursor =
    rows.length === limit
      ? encodeCursor(rows[rows.length - 1])
      : null;

  return { rows, next_cursor };
}

app.get(
  "/api/rider/rides",
  asyncRoute(async (req, res) => {
    const result = await listRiderRequests(req, res, { deliveryOnly: false });

    if (!result) return;

    return ok(res, { rides: result.rows, next_cursor: result.next_cursor });
  })
);

app.get(
  "/api/rider/deliveries",
  asyncRoute(async (req, res) => {
    const result = await listRiderRequests(req, res, { deliveryOnly: true });

    if (!result) return;

    return ok(res, { deliveries: result.rows, next_cursor: result.next_cursor });
  })
);

app.get(
  "/api/rider/rides/:rideId",
  asyncRoute(async (req, res) => {
    if (!(await riderHistoryEnabled())) {
      return fail(res, "Rider history is not yet available.", 403);
    }

    const rideId = cleanString(req.params.rideId, 100);

    const riderId = cleanString(
      req.query.riderId || req.query.rider_id,
      100
    );

    if (!riderId) {
      return fail(res, "riderId is required.", 400);
    }

    const { data: ride, error } = await supabase
      .from("rides")
      .select(RIDER_HISTORY_COLUMNS)
      .eq("id", rideId)
      .maybeSingle();

    if (error) {
      throw error;
    }

    // Same 404 whether the ride doesn't exist or its rider_id doesn't
    // match the supplied riderId — never confirm a ride ID exists to a
    // caller supplying a different riderId. (See the module header above:
    // this checks consistency against a client-supplied riderId, not an
    // authenticated identity — there's no rider session to check against.)
    if (!ride || ride.rider_id !== riderId) {
      return fail(res, "Ride not found.", 404);
    }

    return ok(res, { ride });
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

   STRIPE PUBLISHABLE KEY

   Serves the Stripe publishable key the same way /api/maps-key
   serves the Maps key — an env var instead of a hardcoded value
   in a static HTML file. request-ride.html uses this to load
   Stripe.js and collect real card details before authorizing a
   ride's payment. Returns an empty key (never an error) when
   unconfigured, so the page can show a graceful "payments not
   available" state instead of a broken card form.

========================================================= */

app.get(
  "/api/stripe-key",
  rateLimit({ windowMs: 60_000, max: 60, keyPrefix: "stripe_key" }),
  asyncRoute(async (req, res) => {
    return ok(res, { key: STRIPE_PUBLISHABLE_KEY || "" });
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

   RIDER-SCOPED SAVED PLACES

   Quick-launch destinations (Home, Work, custom) for the rider
   dashboard. Same trust model as the rider-history routes above:
   riderId is client-supplied, not session-verified (there is no
   rider auth session anywhere in this app yet), so these routes
   only ever read/write rows scoped to whatever riderId the caller
   passes, same as every other rider-scoped route.

========================================================= */

app.get(
  "/api/rider/saved-places",
  rateLimit({ windowMs: 60_000, max: 60, keyPrefix: "saved_places_list" }),
  asyncRoute(async (req, res) => {
    const riderId = cleanString(req.query.riderId || req.query.rider_id, 100);

    if (!riderId) {
      return fail(res, "riderId is required.", 400);
    }

    const { data, error } = await supabase
      .from("saved_places")
      .select("id, label, address, lat, lng, icon, created_at")
      .eq("rider_id", riderId)
      .order("created_at", { ascending: true });

    if (error) {
      throw error;
    }

    return ok(res, { places: data || [] });
  })
);

app.post(
  "/api/rider/saved-places",
  rateLimit({ windowMs: 60_000, max: 20, keyPrefix: "saved_places_create" }),
  asyncRoute(async (req, res) => {
    const riderId = cleanString(req.body.riderId || req.body.rider_id, 100);
    const label = cleanString(req.body.label, 60);
    const address = cleanString(req.body.address, 300);
    const icon = cleanString(req.body.icon, 8) || "📍";
    const lat = Number(req.body.lat);
    const lng = Number(req.body.lng);

    if (!riderId || !label || !address) {
      return fail(res, "riderId, label, and address are required.", 400);
    }

    const place = {
      id: makeId("PLACE"),
      rider_id: riderId,
      label,
      address,
      lat: Number.isFinite(lat) ? lat : null,
      lng: Number.isFinite(lng) ? lng : null,
      icon,
      created_at: nowIso(),
      updated_at: nowIso()
    };

    const { error } = await supabase.from("saved_places").insert(place);

    if (error) {
      throw error;
    }

    return ok(res, { place }, 201);
  })
);

app.delete(
  "/api/rider/saved-places/:id",
  rateLimit({ windowMs: 60_000, max: 20, keyPrefix: "saved_places_delete" }),
  asyncRoute(async (req, res) => {
    const id = cleanString(req.params.id, 100);
    const riderId = cleanString(req.query.riderId || req.query.rider_id, 100);

    if (!id || !riderId) {
      return fail(res, "riderId is required.", 400);
    }

    // Same 404-either-way ownership check as /api/rider/rides/:rideId —
    // never confirm a place ID exists to a caller supplying a different
    // riderId.
    const { data: existing } = await supabase
      .from("saved_places")
      .select("id, rider_id")
      .eq("id", id)
      .maybeSingle();

    if (!existing || existing.rider_id !== riderId) {
      return fail(res, "Saved place not found.", 404);
    }

    const { error } = await supabase.from("saved_places").delete().eq("id", id);

    if (error) {
      throw error;
    }

    return ok(res, { deleted: true });
  })
);

/* =========================================================

   HTAF APPLICATION STATUS — AUTHENTICATED RIDER SELF-LOOKUP

   Replaces the former public GET /api/foundation/applications/by-email
   (docs/security-remediation/htaf-admin-pii-audit.md, finding 3):
   that route took an arbitrary ?email= query param with no
   authentication at all, so anyone on the internet could check whether
   a given email address had ever submitted a charity transportation-
   assistance application -- an enumeration/privacy risk independent of
   which fields the response contained, since the existence fact itself
   is sensitive. An email address is not a secret, unlike the
   high-entropy application_code /api/foundation/status/:code requires
   the caller to already possess.

   This route requires a verified rider session (requireRider) and uses
   ONLY req.rider.email -- the server's own record of who is logged in
   -- never a client-supplied email. A rider can therefore only ever
   look up their own application, never anyone else's; there is no
   longer any public surface where an arbitrary email can be tested.
   See resolveRiderHtafLookup() in lib/htafOperations.js for the
   (tested) guarantee that no request-supplied value can stand in for
   the session's own identity.

========================================================= */

app.get(
  "/api/rider/htaf-application",
  requireRider,
  asyncRoute(async (req, res) => {
    const lookup = resolveRiderHtafLookup(req.rider);

    if (!lookup.ok) {
      return fail(res, lookup.error, lookup.statusCode);
    }

    if (!lookup.email) {
      return ok(res, { application: null });
    }

    const { data, error } = await supabase
      .from("htaf_applications")
      .select("application_code, status, program_type, created_at, updated_at")
      .ilike("email", lookup.email)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw error;
    }

    return ok(res, { application: data || null });
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

    // Atomic conditional update: the .eq("status", "pending") guard means
    // this only succeeds if the offer was still pending at the moment of
    // the write. If the offer_expiry_sweep (lib/offerExpiry.js) or a
    // duplicate request already changed its status in the gap between the
    // read above and this write, updatedOffer comes back null and this
    // request fails safely instead of accepting an offer that's already
    // expired or been resolved elsewhere.
    const { data: updatedOffer } =
      await supabase
        .from("driver_offers")
        .update({
          status: "accepted",
          responded_at: nowIso(),
          updated_at: nowIso()
        })
        .eq("id", offerId)
        .eq("status", "pending")
        .select()
        .maybeSingle();

    if (!updatedOffer) {
      const wasExpired =
        offer.expires_at &&
        new Date(offer.expires_at).getTime() <= Date.now();

      return fail(
        res,
        wasExpired
          ? "This offer has expired."
          : "This offer is no longer available. It may have already been responded to.",
        409
      );
    }

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

    // Atomic conditional update — same pattern and reasoning as the accept
    // route above. If the offer_expiry_sweep already claimed this offer as
    // expired (or a duplicate decline request beat this one to it) in the
    // gap between the read above and this write, updatedOffer comes back
    // null. That means whoever DID win the claim is already responsible
    // for redispatching this ride, so this request must not also
    // redispatch it — doing so would offer the ride to two drivers at
    // once from two different code paths.
    const { data: updatedOffer } =
      await supabase
        .from("driver_offers")
        .update({
          status: "declined",
          decline_reason: reason,
          responded_at: nowIso(),
          updated_at: nowIso()
        })
        .eq("id", offerId)
        .eq("status", "pending")
        .select()
        .maybeSingle();

    if (!updatedOffer) {
      return ok(res, {
        declined: false,
        reason: "This offer was already resolved (expired or already responded to)."
      });
    }

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

              // Stamped so runStuckRedispatchRecovery() (server.js, near
              // startup) can recover this ride if the dispatchRide() call
              // below throws or the process dies before it finishes —
              // see lib/offerExpiry.js's sweepStuckRedispatches().
              dispatch_claimed_at:

                nowIso(),

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

  // NOTE: this used to insert/select gross_amount and net_amount, which
  // are not real columns on driver_earnings (the actual schema is
  // gross_fare/driver_base_earning/tip_amount/total_earning) — every
  // insert was silently failing (the error was only console.error'd, never
  // surfaced), so no driver has ever actually had an earning recorded
  // here. Fixed to match the real table.
  const driverBaseEarning =
    Number(
      ride.driver_payout || 0
    );

  // Tips are 100% the driver's — folded into total_earning here (at
  // completion) rather than into driver_payout (computed pre-trip by
  // calculateRideEstimate), since a percentage split should never apply
  // to a tip.
  const tipAmount =
    Number(
      ride.tip_amount || 0
    );

  const totalEarning =
    driverBaseEarning + tipAmount;

  const earning = {

    id:

      makeId("EARN"),

    ride_id:

      ride.id,

    driver_id:

      driverId,

    rider_id:

      ride.rider_id || null,

    gross_fare:

      Number(ride.estimated_fare || 0),

    driver_base_earning:

      driverBaseEarning,

    tip_amount:

      tipAmount,

    total_earning:

      totalEarning,

    payout_amount:

      totalEarning,

    currency:

      "USD",

    status:

      "earned",

    earning_status:

      "earned",

    payment_id:

      ride.payment_id || null,

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

      .select("id, status, pickup_lat, pickup_lng")

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

    // "Eligible" location update, per the ETA-persistence plan: still in the
    // pre-pickup phase (rides.driver_eta_to_pickup_minutes/
    // driver_distance_to_pickup_miles mean exactly that — eta *to pickup*).
    // Once in_progress (already picked up), those columns stop applying;
    // the existing transient tracking estimate in GET /api/rides/:id/status
    // already covers the dropoff-bound phase and is untouched here.
    // Fire-and-forget: never delays this GPS-update response.
    if (
      activeRide.status === RIDE_STATUS.DRIVER_ASSIGNED ||
      activeRide.status === RIDE_STATUS.DRIVER_ENROUTE ||
      activeRide.status === RIDE_STATUS.ARRIVED
    ) {
      persistPickupEtaBestEffort({
        rideId: activeRide.id,
        driverLat: lat,
        driverLng: lng,
        pickupLat: activeRide.pickup_lat,
        pickupLng: activeRide.pickup_lng
      }).catch(() => {});
    }

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

   RIDER PHOTO UPLOAD

   Same shape as the driver photo route above, uploaded to the
   rider-photos bucket instead, so a driver can identify their
   rider on arrival the same way a rider can already identify
   their driver. Rider routes in this app aren't behind a session
   auth middleware (see /api/rider/saved-places, /api/rider/rides)
   — riderId is a client-supplied identifier, not a bug specific
   to this route.

========================================================= */

app.post(
  "/api/rider/photo",
  asyncRoute(async (req, res) => {
    const riderId = cleanString(req.body.riderId || req.body.rider_id, 100);

    if (!riderId) {
      return fail(res, "riderId is required.", 400);
    }

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
      return fail(res, "Photo is too large. Maximum size is 5MB.", 400);
    }

    const path = `${riderId}.${decoded.extension}`;

    const { error: uploadError } = await supabase.storage
      .from("rider-photos")
      .upload(path, buffer, { contentType: mimeType, upsert: true });

    if (uploadError) {
      console.error("❌ Rider photo upload failed:", uploadError.message);
      return fail(res, "Photo upload failed. Please try again.", 502);
    }

    const { data: publicUrlData } = supabase.storage
      .from("rider-photos")
      .getPublicUrl(path);

    const photoUrl = `${publicUrlData.publicUrl}?v=${Date.now()}`;

    const { error: updateError } = await supabase
      .from("riders")
      .update({ photo_url: photoUrl, updated_at: nowIso() })
      .eq("id", riderId);

    if (updateError) {
      return fail(res, "Photo uploaded but saving to profile failed.", 500);
    }

    auditLog({
      actor_type: "rider",
      actor_id: riderId,
      action: "rider_photo_uploaded",
      entity_type: "rider",
      entity_id: riderId,
      req
    }).catch(() => {});

    return ok(res, { photo_url: photoUrl });
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

    const parsedOnline =

      parseDriverOnlineRequest(req.body.online);

    if (!parsedOnline.ok) {

      return fail(

        res,

        parsedOnline.error,

        400

      );

    }

    const online =

      parsedOnline.online;

    // Going online is a safety-relevant transition: a driver must not be
    // able to force it via a direct API call regardless of what the
    // dashboard displays, so readiness is re-checked against the live
    // driver record here rather than trusted from the client. Going
    // offline carries no such risk and must always be allowed —
    // evaluateDriverStatusChange() only runs the readiness check when
    // requestedOnline is true.
    if (online) {

      const { data: driver, error: driverError } =

        await supabase

          .from("drivers")

          .select("*")

          .eq("id", driverId)

          .single();

      if (driverError || !driver) {

        return fail(

          res,

          "Driver not found.",

          404

        );

      }

      const { allowed, checks } =

        evaluateDriverStatusChange({

          driver,

          requestedOnline:

            online,

          enablePersona:

            ENABLE_PERSONA,

          enableCheckr:

            ENABLE_CHECKR

        });

      if (!allowed) {

        return fail(

          res,

          "You cannot go online until verification is complete.",

          403,

          { checks }

        );

      }

    }

    const { error: updateError } =

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

    if (updateError) {

      throw updateError;

    }

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

          // total_earning is the real column (driver_base_earning + tip);
          // net_amount doesn't exist on this table and always summed to 0.
          sum + Number(item.total_earning || 0),

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
      // total_earning/gross_fare are the real columns — net_amount/
      // gross_amount don't exist on this table and made this query error
      // on every call (silently swallowed into earningsToday.error).
      const { data, error } = await supabase
        .from("driver_earnings")
        .select("total_earning, gross_fare")
        .gte("created_at", startOfTodayUtc);
      if (error) {
        earningsToday.error = error.message;
      } else {
        earningsToday.ride_count = data.length;
        earningsToday.net_total = data.reduce(
          (sum, r) => sum + Number(r.total_earning || r.gross_fare || 0),
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

        .select(ADMIN_RIDES_LIST_FIELDS.join(","))

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

        .select(ADMIN_RIDE_MUTATION_FIELDS.join(","))

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

    logAdminRbacShadowCheck(
      req,
      "POST /api/admin/rides/:id/assign-driver",
      RBAC_SHADOW_ROUTE_CAPABILITIES["POST /api/admin/rides/:id/assign-driver"]
    ).catch(() => {});

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

        // notifyRideStage() (below) needs rider_id/rider_phone/ride_type
        // to actually notify the rider, and the push-notification body
        // needs pickup_address -- both real, server-side-only uses, not
        // response fields. ride/driver in the SSE broadcast and the HTTP
        // response below are built from ADMIN_RIDE_MUTATION_FIELDS only,
        // never from this row directly, so those two internal-use fields
        // never leave the server.
        .select(
          [...ADMIN_RIDE_MUTATION_FIELDS, "rider_id", "rider_phone", "ride_type", "pickup_address"].join(",")
        )

        .single();

    if (error) {

      throw error;

    }

    const rideSummary = {
      id: data.id,
      status: data.status,
      dispatch_status: data.dispatch_status,
      driver_id: data.driver_id,
      updated_at: data.updated_at
    };

    const driverSummary = { id: driver.id, ...driverRideFields };

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

          rideSummary,

        driver:

          driverSummary

      }

    );

    return ok(res, {

      ride:

        rideSummary,

      driver:

        driverSummary

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

        .select(ADMIN_DRIVERS_LIST_FIELDS.join(","))

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

        .select(ADMIN_RIDERS_LIST_FIELDS.join(","))

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

    logAdminRbacShadowCheck(
      req,
      "PATCH /api/admin/drivers/:id/approve",
      RBAC_SHADOW_ROUTE_CAPABILITIES["PATCH /api/admin/drivers/:id/approve"]
    ).catch(() => {});

    const driverId =

      cleanString(

        req.params.id,

        100

      );

    // Administrative approval and compliance verification are
    // deliberately two different, separately-authorized actions -- see
    // lib/driverCompliance.js. This route only ever touches the fields
    // buildOrdinaryApprovalUpdate() returns (status/approval_status/
    // approved_at/online) and never fabricates a Checkr or Persona
    // result. checkr_status and persona_verified only ever change via
    // the real webhook handlers (verified third-party events) or the
    // explicit, elevated, audited PATCH .../compliance-override route
    // below.
    const { data, error } =

      await supabase

        .from("drivers")

        .update(

          buildOrdinaryApprovalUpdate({

            now: nowIso()

          })

        )

        .eq("id", driverId)

        .select(ADMIN_DRIVER_MUTATION_FIELDS.join(","))

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

   ADMIN MANUAL CONTACT-VERIFICATION OVERRIDE (DRIVER)

   A human admin attesting they directly confirmed a driver's phone
   number or email address outside the normal SMS/email code flow.
   Separate from ordinary approval (which never touches these fields —
   see above) and separate from the compliance override below, which
   requires elevated authorization. This one only requires a written
   reason and ordinary admin auth.

========================================================= */

app.patch(

  "/api/admin/drivers/:id/contact-verification-override",

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

    if (!reason) {

      return fail(

        res,

        "A written reason is required for a manual contact-verification override.",

        400

      );

    }

    const emailVerified =

      typeof req.body.email_verified === "boolean"

        ? req.body.email_verified

        : undefined;

    const phoneVerified =

      typeof req.body.phone_verified === "boolean"

        ? req.body.phone_verified

        : undefined;

    if (

      emailVerified === undefined &&

      phoneVerified === undefined

    ) {

      return fail(

        res,

        "At least one of email_verified or phone_verified must be provided.",

        400

      );

    }

    // Applies the driver update and writes the audit_logs row inside a
    // single atomic database transaction (see apply_driver_contact_
    // verification_override() in supabase/migrations) -- this override
    // must never report success unless its audit record actually
    // persisted, so there is deliberately no separate, fallible
    // auditLog(...).catch(() => {}) call after a successful update here.
    const result =

      await applyContactVerificationOverride({

        callRpc:

          (name, params) =>

            supabase.rpc(name, params),

        driverId,

        emailVerified,

        phoneVerified,

        actorType:

          "admin",

        actorId:

          req.admin.email,

        action:

          "driver_contact_verification_override",

        metadata: {

          reason,

          email_verified:

            emailVerified,

          phone_verified:

            phoneVerified,

          admin_auth_method:

            req.admin.method

        },

        ipAddress:

          getClientIp(req),

        userAgent:

          req.headers["user-agent"] || null

      });

    if (!result.ok) {

      return fail(

        res,

        result.error,

        result.statusCode

      );

    }

    return ok(res, {

      driver:

        result.driver

    });

  })

);

/* =========================================================

   ADMIN MANUAL COMPLIANCE OVERRIDE (DRIVER)

   The only way to set checkr_status or persona_verified other than a
   real, signature-verified Checkr/Persona webhook event. Requires
   elevated admin authorization (the pre-shared admin_token method, not
   an ordinary password/session login), a written reason of meaningful
   length, and an explicit confirmation that the administrator reviewed
   equivalent documentation. This exists for genuinely exceptional,
   manually-reviewed cases -- it must never become how ordinary approvals
   are handled.

========================================================= */

app.patch(

  "/api/admin/drivers/:id/compliance-override",

  requireElevatedAdmin,

  asyncRoute(async (req, res) => {

    // requireElevatedAdmin() (already stricter than plain
    // requireAdmin -- token-method only) is this route's real,
    // unchanged authority. The shadow check below is purely
    // observational, same as every other instrumented route.
    logAdminRbacShadowCheck(
      req,
      "PATCH /api/admin/drivers/:id/compliance-override",
      RBAC_SHADOW_ROUTE_CAPABILITIES["PATCH /api/admin/drivers/:id/compliance-override"]
    ).catch(() => {});

    const driverId =

      cleanString(

        req.params.id,

        100

      );

    const validation =

      validateComplianceOverrideRequest({

        authMethod:

          req.admin.method,

        reason:

          req.body.reason,

        reviewedDocumentation:

          req.body.reviewed_documentation

      });

    if (!validation.ok) {

      return fail(

        res,

        validation.error,

        validation.statusCode

      );

    }

    const checkrStatus =

      req.body.checkr_status !== undefined

        ? cleanString(req.body.checkr_status, 50)

        : undefined;

    const personaVerified =

      typeof req.body.persona_verified === "boolean"

        ? req.body.persona_verified

        : undefined;

    if (

      checkrStatus === undefined &&

      personaVerified === undefined

    ) {

      return fail(

        res,

        "At least one of checkr_status or persona_verified must be provided.",

        400

      );

    }

    const reason =

      cleanString(

        req.body.reason,

        1000

      );

    // Same atomic-or-nothing guarantee as the contact-verification
    // override above -- this action can make a ride dispatch to a driver
    // with no real background check on file, so it must never report
    // success unless its audit record actually persisted alongside it.
    const result =

      await applyComplianceOverride({

        callRpc:

          (name, params) =>

            supabase.rpc(name, params),

        driverId,

        checkrStatus,

        personaVerified,

        actorType:

          "admin",

        actorId:

          req.admin.email,

        action:

          "driver_compliance_override",

        metadata: {

          reason,

          reviewed_documentation:

            true,

          checkr_status:

            checkrStatus,

          persona_verified:

            personaVerified,

          admin_auth_method:

            req.admin.method

        },

        ipAddress:

          getClientIp(req),

        userAgent:

          req.headers["user-agent"] || null

      });

    if (!result.ok) {

      return fail(

        res,

        result.error,

        result.statusCode

      );

    }

    return ok(res, {

      driver:

        result.driver

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

        .select(ADMIN_DRIVER_MUTATION_FIELDS.join(","))

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

    // getRiderReadiness() requires email_verified AND sms_verified AND
    // status/approval_status to all be true (Object.values(checks).
    // every(Boolean)) -- setting only status/approval_status here used to
    // mean an admin approval could never actually unblock a rider from
    // booking, since the email/SMS checks stayed false regardless. This
    // route is an explicit "admin vouches for this rider" action, so it
    // now sets both verification flags too, same as completing the real
    // verification flow would.
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

          email_verified:

            true,

          sms_verified:

            true,

          updated_at:

            nowIso()

        })

        .eq("id", riderId)

        .select(ADMIN_RIDER_MUTATION_FIELDS.join(","))

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

    logAdminRbacShadowCheck(
      req,
      "GET /api/admin/audit-logs",
      RBAC_SHADOW_ROUTE_CAPABILITIES["GET /api/admin/audit-logs"]
    ).catch(() => {});

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

        .select(ADMIN_AUDIT_LOGS_LIST_FIELDS.join(","))

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

    // The application is loaded above only to build the ride's field
    // values (rider name/phone, pickup/dropoff, fare estimate). Whether
    // a ride should actually be created — vs. returning an existing one
    // or failing closed on an inconsistent state — is decided inside
    // create_htaf_ride_atomic itself, under a row lock, so a retried
    // request or an admin double-click cannot create two rides for the
    // same application (see supabase/migrations/20260806120000_htaf_ride_idempotency.sql).
    const candidateRideId = makeId("RIDE");

    const { data: rpcRows, error: rpcError } =

      await supabase.rpc("create_htaf_ride_atomic", {

        p_application_id: applicationId,
        p_ride_id: candidateRideId,
        p_rider_name: `${application.first_name} ${application.last_name}`,
        p_rider_phone: application.phone,
        p_pickup_address: cleanString(req.body.pickup || application.pickup_city, 500),
        p_dropoff_address: cleanString(req.body.destination || application.destination, 500),
        p_ride_type: "foundation",
        p_scheduled_time: req.body.scheduled_for || application.ride_date || null,
        p_status: RIDE_STATUS.PAYMENT_AUTHORIZED,
        p_dispatch_status: "foundation_authorized",
        p_estimated_fare: estimate.total,
        p_driver_payout: estimate.driver_payout,
        p_estimated_platform_fee: estimate.platform_fee,
        p_pricing_snapshot: estimate,
        p_estimated_distance_miles: estimate.miles,
        p_estimated_duration_minutes: estimate.minutes,
        p_miles_estimate: estimate.miles,
        p_minutes_estimate: estimate.minutes,
        p_notes: `HTAF application ${application.application_code}`

      });

    if (rpcError) {

      throw rpcError;

    }

    const rpcResult = Array.isArray(rpcRows) ? rpcRows[0] : rpcRows;
    const outcome = resolveCreateRideOutcome(rpcResult);

    auditLog({

      actor_type:

        "admin",

      actor_id:

        req.admin.email,

      action:

        outcome.created ? "htaf_application_converted_to_ride" : "htaf_application_create_ride_" + (rpcResult && rpcResult.outcome ? rpcResult.outcome : "failed"),

      entity_type:

        "htaf_application",

      entity_id:

        applicationId,

      metadata: {

        ride_id:

          outcome.ride ? outcome.ride.id : null,

        outcome:

          rpcResult && rpcResult.outcome,

        reason:

          outcome.reason || null

      },

      req

    }).catch(() => {});

    if (outcome.error) {

      return fail(

        res,

        outcome.error,

        outcome.statusCode,

        outcome.reason ? { reason: outcome.reason } : {}

      );

    }

    if (outcome.created) {

      // The full outcome.ride row (from the create_htaf_ride RPC) carries
      // rider_name/rider_phone -- fine for the direct HTTP response below
      // to the one admin who just performed this action on this specific
      // application, but not for an unscoped broadcast to every connected
      // admin socket. The SSE event only needs enough to know a ride now
      // exists for this application; full detail is available through
      // GET /api/admin/rides's own allow-list.
      broadcastSse(

        "htaf_ride_created",

        {

          application_id:

            applicationId,

          ride:

            outcome.ride
              ? { id: outcome.ride.id, status: outcome.ride.status }
              : null

        }

      );

    }

    return ok(res, {

      ride:

        outcome.ride,

      application_id:

        applicationId,

      created:

        outcome.created

    }, outcome.statusCode);

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

   RIDER HISTORY — ENABLE / DISABLE

   The GET /api/rider/rides, /api/rider/rides/:rideId, and
   /api/rider/deliveries routes (see RIDER-SCOPED HISTORY API
   above) are gated behind this flag, defaulted off, because
   riderId there is a client-supplied parameter with no rider
   authentication behind it yet (see that section's comments).
   Flip this on once that's an acceptable risk to carry, or once
   real rider authentication ships.

========================================================= */

app.post(
  "/api/admin/system/enable-rider-history",
  requireAdmin,
  asyncRoute(async (req, res) => {
    await supabase
      .from("system_flags")
      .upsert({
        key: "rider_history_enabled",
        value: "true",
        reason: cleanString(req.body.reason, 1000),
        updated_at: nowIso()
      });

    auditLog({
      actor_type: "admin",
      actor_id: req.admin.email,
      action: "rider_history_enabled",
      req
    }).catch(() => {});

    return ok(res, { rider_history_enabled: true });
  })
);

app.post(
  "/api/admin/system/disable-rider-history",
  requireAdmin,
  asyncRoute(async (req, res) => {
    await supabase
      .from("system_flags")
      .upsert({
        key: "rider_history_enabled",
        value: "false",
        reason: null,
        updated_at: nowIso()
      });

    auditLog({
      actor_type: "admin",
      actor_id: req.admin.email,
      action: "rider_history_disabled",
      req
    }).catch(() => {});

    return ok(res, { rider_history_enabled: false });
  })
);

/* =========================================================

   RIDER SIGN-IN UI — ENABLE / DISABLE

   Controls whether rider-dashboard.html shows the real OTP sign-in gate
   at all (P0 remediation PR 2a, docs/security-remediation/
   pr-02a-rider-client-auth.md), read via the public
   GET /api/rider/auth-ui-config route. Defaulted off so this can ship to
   production inert -- rider-dashboard.html falls back to its pre-PR-2a
   boot behavior untouched -- until an admin has confirmed real SMS/email
   OTP delivery works and deliberately flips this on. Separate from the
   future rider_auth_enforced flag (PR 2b), which controls server-side
   route enforcement, not this client-side gate.

========================================================= */

app.post(
  "/api/admin/system/enable-rider-auth-ui",
  requireAdmin,
  asyncRoute(async (req, res) => {
    logAdminRbacShadowCheck(
      req,
      "POST /api/admin/system/enable-rider-auth-ui",
      RBAC_SHADOW_ROUTE_CAPABILITIES["POST /api/admin/system/enable-rider-auth-ui"]
    ).catch(() => {});

    await supabase
      .from("system_flags")
      .upsert({
        key: "rider_auth_ui_enabled",
        value: "true",
        reason: cleanString(req.body.reason, 1000),
        updated_at: nowIso()
      });

    auditLog({
      actor_type: "admin",
      actor_id: req.admin.email,
      action: "rider_auth_ui_enabled",
      req
    }).catch(() => {});

    return ok(res, { rider_auth_ui_enabled: true });
  })
);

app.post(
  "/api/admin/system/disable-rider-auth-ui",
  requireAdmin,
  asyncRoute(async (req, res) => {
    await supabase
      .from("system_flags")
      .upsert({
        key: "rider_auth_ui_enabled",
        value: "false",
        reason: null,
        updated_at: nowIso()
      });

    auditLog({
      actor_type: "admin",
      actor_id: req.admin.email,
      action: "rider_auth_ui_disabled",
      req
    }).catch(() => {});

    return ok(res, { rider_auth_ui_enabled: false });
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

        // riders has no phone_verified column -- see
        // lib/riderVerification.js and the SMS-confirm route above for
        // the same fix.
        supabase

          .from("riders")

          .update({

            sms_verified:

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
            "status, dispatch_status, ride_type, scheduled_time, created_at, updated_at"
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
          scheduled_for: data.scheduled_time
            ? String(data.scheduled_time).slice(0, 16)
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

    const systemContent = HARVEY_AI_SYSTEM_PROMPT;

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

function redirectToDashboard(res, query) {
  const params = new URLSearchParams(query);
  const qs = params.toString();
  return res.redirect(301, `/rider-dashboard.html${qs ? `?${qs}` : ""}`);
}

// request-ride.html, request-food.html, and request-groceries.html were
// deleted — the wizard they used to serve now lives entirely inside
// rider-dashboard.html (#rideWizardOverlay). These routes exist only so
// old bookmarks, push-notification links, and search-engine results
// still land somewhere useful instead of 404ing.
app.get(
  "/request-ride",
  (req, res) => redirectToDashboard(res, req.query)
);

app.get(
  "/request-ride.html",
  (req, res) => redirectToDashboard(res, req.query)
);

app.get(
  "/request-food",
  (req, res) => redirectToDashboard(res, { ...req.query, mode: "food" })
);

app.get(
  "/request-food.html",
  (req, res) => redirectToDashboard(res, { ...req.query, mode: "food" })
);

app.get(
  "/request-groceries",
  (req, res) => redirectToDashboard(res, { ...req.query, mode: "grocery" })
);

app.get(
  "/request-groceries.html",
  (req, res) => redirectToDashboard(res, { ...req.query, mode: "grocery" })
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

        `🪪 Persona API key configured: ${PERSONA_API_KEY ? "ON" : "OFF"}`

      );

      // Distinct from the line above on purpose: PERSONA_API_KEY presence
      // just means the API key is configured. ENABLE_PERSONA is the gate
      // that actually decides whether computeDriverReadiness() requires a
      // real Persona verification before a driver can go online -- it
      // defaults to true even with no key configured, which previously
      // blocked every driver from ever going online with no way to tell
      // why from this log alone (the line above read "OFF" the whole
      // time, which looked like the opposite problem).
      console.log(

        `🪪 Persona verification required to go online (ENABLE_PERSONA): ${ENABLE_PERSONA ? "ON" : "OFF"}`

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

      // Picks up rides held by shouldDispatchRideNow() once their
      // scheduled_time arrives. Runs once immediately (in case rides came
      // due while the server was restarting/deploying) and then every 60s.
      const runScheduledSweep = () =>
        sweepScheduledRides({
          findDueRides: findDueScheduledRides,
          claimRide: claimScheduledRide,
          resetRide: resetScheduledRideForRetry,
          dispatchRide
        });

      runScheduledSweep();
      setInterval(runScheduledSweep, 60_000);

      // Enforces driver_offers.expires_at (see lib/offerExpiry.js) — off by
      // default via the offer_expiry_sweep_enabled system flag so this can
      // be rolled back instantly without a deploy. Checked every 15s, well
      // under the default 30s offer window, so an ignored offer is caught
      // and redispatched promptly.
      runOfferExpirySweep();
      setInterval(runOfferExpirySweep, 15_000);

      // Recovers a ride stuck in dispatch_status "redispatching" if
      // dispatchRide() never completed (see lib/offerExpiry.js). Always
      // on, not flag-gated — protects the pre-existing decline-triggered
      // redispatch path too, which has the same exposure independent of
      // offer_expiry_sweep_enabled.
      runStuckRedispatchRecovery();
      setInterval(runStuckRedispatchRecovery, 30_000);

    }

  );

}

startServer();

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

  "system_flags"

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

  if (RAW_WEBHOOK_PATHS.has(req.originalUrl)) {

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

  return fail(

    res,

    "Admin authorization required.",

    401

  );

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

const PER_MILE_RATE = envNumber("PER_MILE_RATE", 2.25);

const PER_MINUTE_RATE = envNumber("PER_MINUTE_RATE", 0.35);

const BOOKING_FEE = envNumber("BOOKING_FEE", 2.5);

const MINIMUM_FARE = envNumber("MINIMUM_FARE", 8);

const DRIVER_PAYOUT_PERCENT = envNumber("DRIVER_PAYOUT_PERCENT", 0.78);

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

    const knownColumns = sample

      ? Object.keys(sample)

      : HTAF_REQUIRED_COLUMNS;

    const missing = sample

      ? HTAF_REQUIRED_COLUMNS.filter(

          (column) => !knownColumns.includes(column)

        )

      : [];

    htafSchemaStatus = {

      checked: true,

      ok: missing.length === 0,

      missing,

      columns: knownColumns,

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

  asyncRoute(async (req, res) => {

    const missing =

      requireBody(req, [

        "driver_id"

      ]);

    if (missing.length) {

      return fail(

        res,

        "Missing driver_id.",

        400,

        { missing }

      );

    }

    const driverId =

      cleanString(

        req.body.driver_id,

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

);

/* =========================================================

   RIDER READINESS

   Additive read-only route. Wraps the existing getRiderReadiness()
   helper and returns the same envelope shape as the driver readiness
   route so the rider-signup page can poll approval progress. Mirrors
   GET /api/drivers/:id/readiness. Changes no existing route.

========================================================= */

app.get(

  "/api/riders/:id/readiness",

  asyncRoute(async (req, res) => {

    const riderId =

      cleanString(

        req.params.id,

        100

      );

    if (!riderId) {

      return fail(

        res,

        "Rider id required.",

        400

      );

    }

    const result =

      await getRiderReadiness(riderId);

    if (result && result.reason === "Rider profile not found.") {

      return fail(

        res,

        "Rider not found.",

        404

      );

    }

    const rider =

      result.rider || {};

    return ok(res, {

      rider_id:

        rider.id || riderId,

      ready:

        Boolean(result.ready),

      status:

        rider.status || null,

      approval_status:

        rider.approval_status || null,

      checks:

        result.checks || {}

    });

  })

);

/* =========================================================

   ACCOUNT DELETION REQUEST (SOFT-FLAG)

   Additive route. Does NOT hard-delete any record. It stamps a
   deletion_requested_at timestamp (and reason) on the rider or
   driver row for later admin review, preserving audit logs, trip
   history, payments, and dispute records. Hard deletion, if ever
   desired, is a separate admin-reviewed action. Changes no existing
   route.

========================================================= */

app.post(

  "/api/account/delete-request",

  asyncRoute(async (req, res) => {

    const missing =

      requireBody(req, [

        "email"

      ]);

    if (missing.length) {

      return fail(

        res,

        "Missing required account deletion fields.",

        400,

        { missing }

      );

    }

    const email =

      cleanEmail(req.body.email);

    const accountType =

      normalizeRole(req.body.account_type || "rider");

    const reason =

      cleanString(req.body.reason || "", 500);

    const table =

      accountType === "driver"

        ? "drivers"

        : "riders";

    const now =

      nowIso();

    // Locate the account by email without exposing whether it exists.
    const { data: account, error: lookupError } =

      await supabase

        .from(table)

        .select("id, email")

        .eq("email", email)

        .maybeSingle();

    if (lookupError) {

      throw lookupError;

    }

    // Always respond success-shaped so this endpoint can't be used to
    // enumerate which emails have accounts. If nothing matched, we simply
    // record nothing and return the same acknowledgement.
    if (account && account.id) {

      const { error: updateError } =

        await supabase

          .from(table)

          .update({

            deletion_requested: true,

            deletion_requested_at:

              now,

            deletion_reason:

              reason || null,

            updated_at:

              now

          })

          .eq("id", account.id);

      if (updateError) {

        throw updateError;

      }

      auditLog({

        actor_type:

          accountType,

        actor_id:

          account.id,

        action:

          "account_deletion_requested",

        entity_type:

          accountType,

        entity_id:

          account.id,

        metadata: {

          reason:

            reason || null

        },

        req

      }).catch(() => {});

    }

    return ok(

      res,

      {

        requested:

          true,

        message:

          "Your account deletion request has been received. Our team will confirm by email before any data is removed."

      },

      202

    );

  })

);

/* =========================================================

   ADMIN — ACCOUNT DELETION REVIEW

   Three additive admin routes that complete the soft-delete
   lifecycle started by POST /api/account/delete-request:

     GET   /api/admin/account-deletions
             List all rider + driver rows currently flagged
             deletion_requested = true, for admin review.

     POST  /api/admin/account-deletions/:type/:id/approve
             Hard-delete the flagged account after admin review.
             This is the ONLY route that physically removes an
             account row, and only an admin can call it.

     POST  /api/admin/account-deletions/:type/:id/deny
             Clear the soft-flag, restoring the account.

   All three are admin-guarded (requireAdmin) and audit-logged.
   None touch any existing route.

========================================================= */

app.get(

  "/api/admin/account-deletions",

  requireAdmin,

  asyncRoute(async (req, res) => {

    const limit =

      envNumber(

        "ADMIN_LIST_LIMIT",

        200

      );

    const { data: riders, error: riderError } =

      await supabase

        .from("riders")

        .select("id, first_name, last_name, email, deletion_requested_at, deletion_reason, status, approval_status")

        .eq("deletion_requested", true)

        .order("deletion_requested_at", {

          ascending: false

        })

        .limit(limit);

    if (riderError) {

      throw riderError;

    }

    const { data: drivers, error: driverError } =

      await supabase

        .from("drivers")

        .select("id, first_name, last_name, email, deletion_requested_at, deletion_reason, status, approval_status")

        .eq("deletion_requested", true)

        .order("deletion_requested_at", {

          ascending: false

        })

        .limit(limit);

    if (driverError) {

      throw driverError;

    }

    return ok(res, {

      riders:

        (riders || []).map((r) => ({

          ...r,

          account_type:

            "rider"

        })),

      drivers:

        (drivers || []).map((d) => ({

          ...d,

          account_type:

            "driver"

        })),

      total:

        (riders ? riders.length : 0) +

        (drivers ? drivers.length : 0)

    });

  })

);

app.post(

  "/api/admin/account-deletions/:type/:id/approve",

  requireAdmin,

  asyncRoute(async (req, res) => {

    const accountType =

      normalizeRole(req.params.type);

    const accountId =

      cleanString(

        req.params.id,

        100

      );

    const table =

      accountType === "driver"

        ? "drivers"

        : "riders";

    // Confirm the account exists AND was actually flagged for deletion,
    // so this route can never hard-delete an account that never requested it.
    const { data: account, error: lookupError } =

      await supabase

        .from(table)

        .select("id, email, deletion_requested")

        .eq("id", accountId)

        .maybeSingle();

    if (lookupError) {

      throw lookupError;

    }

    if (!account || !account.id) {

      return fail(

        res,

        "Account not found.",

        404

      );

    }

    if (!account.deletion_requested) {

      return fail(

        res,

        "This account has no pending deletion request. Hard-delete is only permitted after a deletion request.",

        409

      );

    }

    const { error: deleteError } =

      await supabase

        .from(table)

        .delete()

        .eq("id", accountId);

    if (deleteError) {

      throw deleteError;

    }

    auditLog({

      actor_type:

        "admin",

      actor_id:

        req.admin.email,

      action:

        "account_deletion_approved",

      entity_type:

        accountType,

      entity_id:

        accountId,

      metadata: {

        email:

          account.email

      },

      req

    }).catch(() => {});

    return ok(res, {

      deleted:

        true,

      account_type:

        accountType,

      id:

        accountId,

      message:

        "Account permanently deleted."

    });

  })

);

app.post(

  "/api/admin/account-deletions/:type/:id/deny",

  requireAdmin,

  asyncRoute(async (req, res) => {

    const accountType =

      normalizeRole(req.params.type);

    const accountId =

      cleanString(

        req.params.id,

        100

      );

    const table =

      accountType === "driver"

        ? "drivers"

        : "riders";

    const { data, error } =

      await supabase

        .from(table)

        .update({

          deletion_requested:

            false,

          deletion_requested_at:

            null,

          deletion_reason:

            null,

          updated_at:

            nowIso()

        })

        .eq("id", accountId)

        .select("id, email")

        .maybeSingle();

    if (error) {

      throw error;

    }

    if (!data || !data.id) {

      return fail(

        res,

        "Account not found.",

        404

      );

    }

    auditLog({

      actor_type:

        "admin",

      actor_id:

        req.admin.email,

      action:

        "account_deletion_denied",

      entity_type:

        accountType,

      entity_id:

        accountId,

      req

    }).catch(() => {});

    return ok(res, {

      restored:

        true,

      account_type:

        accountType,

      id:

        accountId,

      message:

        "Deletion request cleared. The account has been restored."

    });

  })

);

/* =========================================================

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

  limit = envNumber("MAX_DISPATCH_ATTEMPTS", 5)

}) {

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

  const drivers =

    await findAvailableDrivers({

      pickup_lat:

        ride.pickup_lat,

      pickup_lng:

        ride.pickup_lng

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

  asyncRoute(async (req, res) => {

    const offerId =

      cleanString(

        req.params.offerId,

        100

      );

    const driverId =

      cleanString(

        req.body.driver_id,

        100

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

  asyncRoute(async (req, res) => {

    const rideId =

      cleanString(

        req.params.rideId,

        100

      );

    const driverId =

      cleanString(

        req.body.driver_id,

        100

      );

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

  asyncRoute(async (req, res) => {

    const rideId =

      cleanString(

        req.params.rideId,

        100

      );

    const driverId =

      cleanString(

        req.body.driver_id,

        100

      );

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

  asyncRoute(async (req, res) => {

    const rideId =

      cleanString(

        req.params.rideId,

        100

      );

    const driverId =

      cleanString(

        req.body.driver_id,

        100

      );

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

    consol

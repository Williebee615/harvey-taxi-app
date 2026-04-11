const express = require("express");
const cors = require("cors");
const path = require("path");
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");

let OpenAI = null;
try {
  OpenAI = require("openai");
} catch (error) {
  console.warn("OpenAI SDK not installed. AI features will be disabled.");
}

const app = express();
const PORT = Number(process.env.PORT || 10000);
const SERVER_STARTED_AT = new Date().toISOString();

/* =========================================================
   CORE APP
========================================================= */
app.use(
  cors({
    origin: true,
    credentials: true
  })
);

app.use(express.json({ limit: "6mb" }));
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
  const n = Number(cleanEnv(value));
  return Number.isFinite(n) ? n : fallback;
}

function normalizeEmail(value = "") {
  return cleanEnv(value).toLowerCase();
}

function normalizePhone(value = "") {
  return String(value || "").replace(/[^\d+]/g, "");
}

function nowIso() {
  return new Date().toISOString();
}

function uuid() {
  return crypto.randomUUID();
}

function sha256(value = "") {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function maskIdNumber(value = "") {
  const cleaned = String(value || "").replace(/\D/g, "");
  if (!cleaned) return "";
  return cleaned.slice(-4);
}

function safeJsonParse(value, fallback = null) {
  try {
    if (typeof value === "object" && value !== null) return value;
    if (!value) return fallback;
    return JSON.parse(value);
  } catch (error) {
    return fallback;
  }
}

function dollars(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? Number(n.toFixed(2)) : 0;
}

/* =========================================================
   ENV CONFIG
========================================================= */
const APP_NAME = cleanEnv(process.env.APP_NAME || "Harvey Taxi");
const APP_VERSION = cleanEnv(process.env.APP_VERSION || "code-blue-phase-9");

const APP_BASE_URL = cleanEnv(process.env.APP_BASE_URL);
const PUBLIC_APP_URL = cleanEnv(process.env.PUBLIC_APP_URL);
const RENDER_EXTERNAL_URL = cleanEnv(process.env.RENDER_EXTERNAL_URL);

const SUPABASE_URL = cleanEnv(process.env.SUPABASE_URL);
const SUPABASE_SERVICE_ROLE_KEY = cleanEnv(process.env.SUPABASE_SERVICE_ROLE_KEY);

const ADMIN_EMAIL = normalizeEmail(process.env.ADMIN_EMAIL);
const ADMIN_PASSWORD = cleanEnv(process.env.ADMIN_PASSWORD);
const ADMIN_API_KEY = cleanEnv(process.env.ADMIN_API_KEY);

const GOOGLE_MAPS_API_KEY = cleanEnv(process.env.GOOGLE_MAPS_API_KEY);

const OPENAI_API_KEY = cleanEnv(process.env.OPENAI_API_KEY);
const OPENAI_SUPPORT_MODEL = cleanEnv(
  process.env.OPENAI_SUPPORT_MODEL || "gpt-4o-mini"
);

const PERSONA_API_KEY = cleanEnv(process.env.PERSONA_API_KEY);
const PERSONA_TEMPLATE_ID_RIDER = cleanEnv(process.env.PERSONA_TEMPLATE_ID_RIDER);
const PERSONA_TEMPLATE_ID_DRIVER = cleanEnv(process.env.PERSONA_TEMPLATE_ID_DRIVER);
const PERSONA_WEBHOOK_SECRET = cleanEnv(process.env.PERSONA_WEBHOOK_SECRET);

const TWILIO_ACCOUNT_SID = cleanEnv(process.env.TWILIO_ACCOUNT_SID);
const TWILIO_AUTH_TOKEN = cleanEnv(process.env.TWILIO_AUTH_TOKEN);
const TWILIO_PHONE_NUMBER = cleanEnv(process.env.TWILIO_PHONE_NUMBER);

const SMTP_HOST = cleanEnv(process.env.SMTP_HOST);
const SMTP_PORT = toNumber(process.env.SMTP_PORT, 587);
const SMTP_USER = cleanEnv(process.env.SMTP_USER);
const SMTP_PASS = cleanEnv(process.env.SMTP_PASS);
const SMTP_FROM = cleanEnv(process.env.SMTP_FROM);

const REQUIRE_RIDER_VERIFICATION = toBool(
  process.env.REQUIRE_RIDER_VERIFICATION,
  true
);
const REQUIRE_PAYMENT_AUTHORIZATION = toBool(
  process.env.REQUIRE_PAYMENT_AUTHORIZATION,
  true
);
const ENABLE_AI_DISPATCH = toBool(process.env.ENABLE_AI_DISPATCH, true);
const ENABLE_AUTONOMOUS_MODE = toBool(process.env.ENABLE_AUTONOMOUS_MODE, true);

/* =========================================================
   SUPABASE
========================================================= */
const supabase =
  SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        auth: {
          persistSession: false,
          autoRefreshToken: false
        }
      })
    : null;

function ensureSupabase() {
  if (!supabase) {
    const error = new Error(
      "Supabase is not configured. Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY."
    );
    error.statusCode = 500;
    throw error;
  }
}

/* =========================================================
   OPENAI
========================================================= */
let openai = null;

if (OpenAI && OPENAI_API_KEY) {
  try {
    openai = new OpenAI({
      apiKey: OPENAI_API_KEY
    });
    console.log("OpenAI initialized successfully.");
  } catch (error) {
    console.warn("Failed to initialize OpenAI:", error.message);
  }
}

/* =========================================================
   CONSTANTS
========================================================= */
const VERIFICATION_STATUSES = {
  PENDING: "pending",
  VERIFIED: "verified",
  REJECTED: "rejected",
  REVIEW_REQUIRED: "review_required"
};

const PAYMENT_STATUSES = {
  PENDING: "pending",
  AUTHORIZED: "authorized",
  CAPTURED: "captured",
  RELEASED: "released"
};

const RIDE_STATUSES = {
  REQUESTED: "requested",
  SEARCHING: "searching",
  OFFERED: "offered",
  ACCEPTED: "accepted",
  DRIVER_ASSIGNED: "driver_assigned",
  DRIVER_ENROUTE: "driver_enroute",
  DRIVER_ARRIVED: "driver_arrived",
  TRIP_STARTED: "trip_started",
  TRIP_COMPLETED: "trip_completed",
  CANCELLED: "cancelled",
  EXPIRED: "expired"
};

const REQUESTED_MODES = {
  DRIVER: "driver",
  AUTONOMOUS: "autonomous"
};

const DISPATCH_MAX_ATTEMPTS = toNumber(process.env.DISPATCH_MAX_ATTEMPTS, 5);
const DISPATCH_OFFER_TIMEOUT_SECONDS = toNumber(
  process.env.DISPATCH_OFFER_TIMEOUT_SECONDS,
  25
);
const DISPATCH_BASE_RADIUS_MILES = toNumber(
  process.env.DISPATCH_BASE_RADIUS_MILES,
  10
);

const MISSION_KNOWLEDGE = `
Harvey Taxi Service LLC is the for-profit transportation platform.
Harvey Transportation Assistance Foundation is the nonprofit mission side.
The platform supports human drivers today and autonomous pilot expansion in the future.
Riders should be verified before they can fully access ride requests when verification gates are enabled.
Drivers should complete onboarding, including verification steps, before activation.
`.trim();

/* =========================================================
   RESPONSE HELPERS
========================================================= */
function ok(res, payload = {}, statusCode = 200) {
  return res.status(statusCode).json({
    ok: true,
    ...payload
  });
}

function fail(res, statusCode = 500, error = "Request failed.", extra = {}) {
  return res.status(statusCode).json({
    ok: false,
    error,
    ...extra
  });
}

function asyncHandler(handler) {
  return async function wrappedHandler(req, res, next) {
    try {
      await handler(req, res, next);
    } catch (error) {
      next(error);
    }
  };
}

/* =========================================================
   SANITIZERS
========================================================= */
function sanitizeRider(rider) {
  if (!rider) return null;

  return {
    id: rider.id,
    first_name: rider.first_name || "",
    last_name: rider.last_name || "",
    full_name:
      rider.full_name ||
      [rider.first_name, rider.last_name].filter(Boolean).join(" "),
    email: rider.email || "",
    phone: rider.phone || "",
    city: rider.city || "",
    state: rider.state || "",
    verification_status: rider.verification_status || "pending",
    persona_status: rider.persona_status || "not_started",
    persona_inquiry_id: rider.persona_inquiry_id || null,
    id_type: rider.id_type || null,
    id_last4: rider.id_last4 || "",
    created_at: rider.created_at || null,
    updated_at: rider.updated_at || null
  };
}

function sanitizeDriver(driver) {
  if (!driver) return null;

  return {
    id: driver.id,
    first_name: driver.first_name || "",
    last_name: driver.last_name || "",
    full_name:
      driver.full_name ||
      [driver.first_name, driver.last_name].filter(Boolean).join(" "),
    email: driver.email || "",
    phone: driver.phone || "",
    city: driver.city || "",
    state: driver.state || "",
    vehicle_make: driver.vehicle_make || "",
    vehicle_model: driver.vehicle_model || "",
    vehicle_year: driver.vehicle_year || "",
    driver_type: driver.driver_type || "human",
    email_verified: driver.email_verified === true,
    sms_verified: driver.sms_verified === true,
    persona_status: driver.persona_status || "not_started",
    identity_status: driver.identity_status || "not_started",
    verification_status: driver.verification_status || "pending",
    status: driver.status || "pending",
    is_available: driver.is_available === true,
    availability_status: driver.availability_status || "offline",
    rating: Number(driver.rating || 0),
    acceptance_rate: Number(driver.acceptance_rate || 0),
    completion_rate: Number(driver.completion_rate || 0),
    created_at: driver.created_at || null,
    updated_at: driver.updated_at || null
  };
}

function normalizeRequestedMode(value = REQUESTED_MODES.DRIVER) {
  const mode = cleanEnv(value).toLowerCase();
  return mode === REQUESTED_MODES.AUTONOMOUS
    ? REQUESTED_MODES.AUTONOMOUS
    : REQUESTED_MODES.DRIVER;
}

function isDriverVerified(driver) {
  return (
    String(driver?.verification_status || "").toLowerCase() ===
    VERIFICATION_STATUSES.VERIFIED
  );
}

function isDriverEligibleForMode(driver, requestedMode) {
  const mode = normalizeRequestedMode(requestedMode);
  const driverType = cleanEnv(driver?.driver_type || "human").toLowerCase();

  if (mode === REQUESTED_MODES.AUTONOMOUS) {
    return ENABLE_AUTONOMOUS_MODE && driverType === "autonomous";
  }

  return driverType === "human" || driverType === "mixed";
}

/* =========================================================
   LOOKUP HELPERS
========================================================= */
async function getRiderById(riderId) {
  ensureSupabase();

  const { data, error } = await supabase
    .from("riders")
    .select("*")
    .eq("id", riderId)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

async function getDriverById(driverId) {
  ensureSupabase();

  const { data, error } = await supabase
    .from("drivers")
    .select("*")
    .eq("id", driverId)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

async function getRideById(rideId) {
  ensureSupabase();

  const { data, error } = await supabase
    .from("rides")
    .select("*")
    .eq("id", rideId)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

async function createTripEvent(rideId, event, metadata = {}) {
  ensureSupabase();

  const payload = {
    id: uuid(),
    ride_id: rideId,
    event,
    metadata,
    created_at: nowIso()
  };

  const { data, error } = await supabase
    .from("trip_events")
    .insert(payload)
    .select()
    .single();

  if (error) throw error;
  return data;
}

async function createAuditLog(action, metadata = {}, actorType = "system", actorId = null) {
  ensureSupabase();

  const payload = {
    id: uuid(),
    action,
    actor_type: actorType,
    actor_id: actorId,
    metadata,
    created_at: nowIso()
  };

  const { data, error } = await supabase
    .from("audit_logs")
    .insert(payload)
    .select()
    .single();

  if (error) throw error;
  return data;
}

async function requireVerifiedRider(riderId) {
  const rider = await getRiderById(riderId);

  if (!rider) {
    const error = new Error("Rider not found.");
    error.statusCode = 404;
    throw error;
  }

  if (
    REQUIRE_RIDER_VERIFICATION &&
    String(rider.verification_status || "").toLowerCase() !==
      VERIFICATION_STATUSES.VERIFIED
  ) {
    const error = new Error(
      "Rider verification approval is required before this action."
    );
    error.statusCode = 403;
    throw error;
  }

  return rider;
}

async function requireAuthorizedPaymentForRide(rideId) {
  const ride = await getRideById(rideId);

  if (!ride) {
    const error = new Error("Ride not found.");
    error.statusCode = 404;
    throw error;
  }

  if (
    REQUIRE_PAYMENT_AUTHORIZATION &&
    String(ride.payment_status || "").toLowerCase() !==
      PAYMENT_STATUSES.AUTHORIZED &&
    String(ride.payment_status || "").toLowerCase() !==
      PAYMENT_STATUSES.CAPTURED
  ) {
    const error = new Error("Authorized payment is required for this ride.");
    error.statusCode = 402;
    throw error;
  }

  return ride;
}

/* =========================================================
   DRIVER SCORING
========================================================= */
function scoreDriverForRide(driver, ride, metrics = {}) {
  const distanceMiles = Number(metrics.distance_miles ?? 999);
  const idleMinutes = Number(metrics.idle_minutes ?? 0);
  const rating = Number(driver?.rating || 5);
  const acceptanceRate = Number(driver?.acceptance_rate || 0);
  const completionRate = Number(driver?.completion_rate || 0);

  const distanceScore = Math.max(0, 100 - distanceMiles * 8);
  const idleScore = Math.min(25, idleMinutes / 2);
  const ratingScore = Math.min(25, rating * 5);
  const acceptanceScore = Math.min(25, acceptanceRate * 25);
  const completionScore = Math.min(25, completionRate * 25);

  const totalScore =
    distanceScore +
    idleScore +
    ratingScore +
    acceptanceScore +
    completionScore;

  return {
    total_score: Number(totalScore.toFixed(2)),
    components: {
      distance_score: Number(distanceScore.toFixed(2)),
      idle_score: Number(idleScore.toFixed(2)),
      rating_score: Number(ratingScore.toFixed(2)),
      acceptance_score: Number(acceptanceScore.toFixed(2)),
      completion_score: Number(completionScore.toFixed(2))
    }
  };
}

/* =========================================================
   PUBLIC BASE URL
========================================================= */
function publicBaseUrl() {
  return (
    PUBLIC_APP_URL ||
    RENDER_EXTERNAL_URL ||
    APP_BASE_URL ||
    `http://localhost:${PORT}`
  );
}

/* =========================================================
   HEALTH
========================================================= */
app.get(
  "/api/health",
  asyncHandler(async (req, res) => {
    let database = "down";

    try {
      ensureSupabase();
      const { error } = await supabase.from("riders").select("id").limit(1);
      if (!error) {
        database = "up";
      }
    } catch (error) {
      database = "down";
    }

    const ai = openai ? "up" : "missing";
    const maps = GOOGLE_MAPS_API_KEY ? "configured" : "missing";
    const persona =
      PERSONA_API_KEY && PERSONA_TEMPLATE_ID_RIDER && PERSONA_TEMPLATE_ID_DRIVER
        ? "configured"
        : "missing";
    const twilio =
      TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_PHONE_NUMBER
        ? "configured"
        : "missing";
    const email =
      SMTP_HOST && SMTP_USER && SMTP_PASS && SMTP_FROM ? "configured" : "missing";

    return ok(res, {
      app: APP_NAME,
      version: APP_VERSION,
      started_at: SERVER_STARTED_AT,
      now: nowIso(),
      services: {
        database,
        ai,
        maps,
        persona,
        twilio,
        email
      }
    });
  })
);/* =========================================================
   VERIFICATION / AUTH HELPERS
========================================================= */
function generateVerificationToken() {
  return crypto.randomBytes(24).toString("hex");
}

function generateNumericCode(length = 6) {
  let output = "";
  for (let i = 0; i < length; i += 1) {
    output += Math.floor(Math.random() * 10);
  }
  return output;
}

async function getRiderByEmail(email) {
  ensureSupabase();

  const { data, error } = await supabase
    .from("riders")
    .select("*")
    .eq("email", normalizeEmail(email))
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

async function getDriverByEmail(email) {
  ensureSupabase();

  const { data, error } = await supabase
    .from("drivers")
    .select("*")
    .eq("email", normalizeEmail(email))
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

async function sendEmailMessage({ to, subject, text }) {
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS || !SMTP_FROM) {
    console.warn("SMTP not configured. Email skipped.");
    return { delivered: false, reason: "SMTP_NOT_CONFIGURED" };
  }

  console.log("EMAIL SEND", {
    to,
    subject,
    text_preview: String(text || "").slice(0, 120)
  });

  return { delivered: true };
}

async function sendSmsMessage({ to, body }) {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_PHONE_NUMBER) {
    console.warn("Twilio not configured. SMS skipped.");
    return { delivered: false, reason: "TWILIO_NOT_CONFIGURED" };
  }

  console.log("SMS SEND", {
    to,
    body_preview: String(body || "").slice(0, 120)
  });

  return { delivered: true };
}

async function createPersonaInquiry({
  accountType,
  accountId,
  firstName,
  lastName,
  email,
  phone,
  idType = "government_id"
}) {
  const templateId =
    accountType === "driver"
      ? PERSONA_TEMPLATE_ID_DRIVER
      : PERSONA_TEMPLATE_ID_RIDER;

  if (!PERSONA_API_KEY || !templateId) {
    return {
      enabled: false,
      status: "disabled",
      inquiryId: null,
      inquiryUrl: null
    };
  }

  const referenceId = `${accountType}_${accountId}`;

  const payload = {
    data: {
      attributes: {
        "inquiry-template-id": templateId,
        "reference-id": referenceId,
        "redirect-uri": `${publicBaseUrl()}/verification-complete.html`,
        fields: {
          name_first: firstName || "",
          name_last: lastName || "",
          email_address: email || "",
          phone_number: phone || ""
        },
        meta: {
          account_id: accountId,
          id_type: idType
        }
      }
    }
  };

  try {
    const response = await fetch("https://withpersona.com/api/v1/inquiries", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${PERSONA_API_KEY}`,
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify(payload)
    });

    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      console.error("Persona inquiry creation failed:", result);
      return {
        enabled: true,
        status: "failed",
        inquiryId: null,
        inquiryUrl: null,
        raw: result
      };
    }

    return {
      enabled: true,
      status: "created",
      inquiryId: result?.data?.id || null,
      inquiryUrl:
        result?.data?.attributes?.["inquiry-link"] ||
        result?.data?.attributes?.["creator-url"] ||
        null,
      raw: result
    };
  } catch (error) {
    console.error("Persona request error:", error.message);
    return {
      enabled: true,
      status: "error",
      inquiryId: null,
      inquiryUrl: null,
      error: error.message
    };
  }
}

async function storeDriverEmailVerificationToken(driverId, rawToken) {
  const { data, error } = await supabase
    .from("drivers")
    .update({
      email_verification_token_hash: sha256(rawToken),
      email_verification_expires_at: new Date(
        Date.now() + 24 * 60 * 60 * 1000
      ).toISOString(),
      updated_at: nowIso()
    })
    .eq("id", driverId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

async function storeDriverSmsVerificationCode(driverId, rawCode) {
  const { data, error } = await supabase
    .from("drivers")
    .update({
      sms_verification_code_hash: sha256(rawCode),
      sms_verification_expires_at: new Date(
        Date.now() + 15 * 60 * 1000
      ).toISOString(),
      updated_at: nowIso()
    })
    .eq("id", driverId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

async function sendDriverVerificationEmail(driver) {
  const rawToken = generateVerificationToken();
  await storeDriverEmailVerificationToken(driver.id, rawToken);

  const verifyUrl = `${publicBaseUrl()}/driver-verify-email.html?token=${encodeURIComponent(
    rawToken
  )}&driver_id=${encodeURIComponent(driver.id)}`;

  return sendEmailMessage({
    to: driver.email,
    subject: "Verify your Harvey Taxi driver email",
    text: [
      `Hello ${driver.first_name || "Driver"},`,
      "",
      "Please verify your email for Harvey Taxi driver onboarding.",
      verifyUrl
    ].join("\n")
  });
}

async function sendDriverVerificationSms(driver) {
  const rawCode = generateNumericCode(6);
  await storeDriverSmsVerificationCode(driver.id, rawCode);

  return sendSmsMessage({
    to: driver.phone,
    body: `Your Harvey Taxi verification code is ${rawCode}`
  });
}

function verifyWebhookSharedSecret(req) {
  if (!PERSONA_WEBHOOK_SECRET) return true;

  const provided =
    cleanEnv(req.headers["x-persona-webhook-secret"]) ||
    cleanEnv(req.headers["x-webhook-secret"]) ||
    cleanEnv(req.query?.webhook_secret);

  return provided === PERSONA_WEBHOOK_SECRET;
}

function requireVerifiedWebhook(req, res, next) {
  if (!PERSONA_WEBHOOK_SECRET) {
    return next();
  }

  const valid = verifyWebhookSharedSecret(req);
  if (!valid) {
    return fail(res, 401, "Webhook signature verification failed.", {
      code: "INVALID_WEBHOOK_SIGNATURE"
    });
  }

  return next();
}

/* =========================================================
   RIDER AUTH / VERIFICATION
========================================================= */
app.post(
  "/api/rider/signup",
  asyncHandler(async (req, res) => {
    const first_name = cleanEnv(req.body?.firstName || req.body?.first_name);
    const last_name = cleanEnv(req.body?.lastName || req.body?.first_name || req.body?.last_name);
    const email = normalizeEmail(req.body?.email);
    const phone = normalizePhone(req.body?.phone);
    const city = cleanEnv(req.body?.city);
    const state = cleanEnv(req.body?.state || req.body?.stateValue || "TN");
    const password = cleanEnv(req.body?.password);
    const confirmPassword = cleanEnv(
      req.body?.confirmPassword || req.body?.confirm_password
    );
    const id_type = cleanEnv(req.body?.id_type || req.body?.idType || "government_id");

    if (!first_name || !last_name || !email || !phone || !city || !password) {
      return fail(res, 400, "Missing required rider signup fields.");
    }

    if (password.length < 8) {
      return fail(res, 400, "Password must be at least 8 characters.");
    }

    if (confirmPassword && password !== confirmPassword) {
      return fail(res, 400, "Passwords do not match.");
    }

    const existing = await getRiderByEmail(email);
    if (existing) {
      return fail(res, 409, "A rider account with that email already exists.");
    }

    const full_name = [first_name, last_name].filter(Boolean).join(" ");

    const { data: rider, error } = await supabase
      .from("riders")
      .insert({
        id: uuid(),
        first_name,
        last_name,
        full_name,
        email,
        phone,
        city,
        state,
        password_hash: sha256(password),
        verification_status: "pending",
        persona_status: "not_started",
        id_type,
        id_last4: "",
        created_at: nowIso(),
        updated_at: nowIso()
      })
      .select()
      .single();

    if (error) throw error;

    const inquiry = await createPersonaInquiry({
      accountType: "rider",
      accountId: rider.id,
      firstName: first_name,
      lastName: last_name,
      email,
      phone,
      idType: id_type
    });

    const { data: updatedRider, error: updateError } = await supabase
      .from("riders")
      .update({
        persona_inquiry_id: inquiry?.inquiryId || null,
        persona_status:
          inquiry?.status === "created" ? "started" : inquiry?.status || "not_started",
        updated_at: nowIso()
      })
      .eq("id", rider.id)
      .select()
      .single();

    if (updateError) throw updateError;

    await createAuditLog(
      "rider_signup_created",
      {
        rider_id: updatedRider.id,
        email: updatedRider.email,
        persona_status: updatedRider.persona_status
      },
      "rider",
      updatedRider.id
    );

    return ok(
      res,
      {
        message:
          "Rider signup created. ID or passport verification must be completed before ride access.",
        rider: sanitizeRider(updatedRider),
        verification: {
          required: true,
          status: updatedRider.verification_status,
          persona_enabled: inquiry.enabled,
          persona_status: inquiry.status,
          inquiry_id: inquiry.inquiryId,
          inquiry_url: inquiry.inquiryUrl
        }
      },
      201
    );
  })
);

app.post(
  "/api/rider/login",
  asyncHandler(async (req, res) => {
    const email = normalizeEmail(req.body?.email);
    const password = cleanEnv(req.body?.password);

    if (!email || !password) {
      return fail(res, 400, "Email and password are required.");
    }

    const rider = await getRiderByEmail(email);
    if (!rider) {
      return fail(res, 404, "Rider not found.");
    }

    if (cleanEnv(rider.password_hash) !== sha256(password)) {
      return fail(res, 401, "Invalid login credentials.");
    }

    return ok(res, {
      message: "Rider login successful.",
      rider: sanitizeRider(rider)
    });
  })
);

app.get(
  "/api/riders/:riderId",
  asyncHandler(async (req, res) => {
    const rider = await getRiderById(req.params.riderId);
    if (!rider) {
      return fail(res, 404, "Rider not found.");
    }

    return ok(res, {
      rider: sanitizeRider(rider)
    });
  })
);

app.get(
  "/api/rider/:riderId/verification-status",
  asyncHandler(async (req, res) => {
    const rider = await getRiderById(req.params.riderId);
    if (!rider) {
      return fail(res, 404, "Rider not found.");
    }

    return ok(res, {
      rider_id: rider.id,
      verification_status: rider.verification_status,
      persona_status: rider.persona_status || "not_started",
      inquiry_id: rider.persona_inquiry_id || null,
      id_type: rider.id_type || null
    });
  })
);

app.post(
  "/api/rider/:riderId/start-verification",
  asyncHandler(async (req, res) => {
    const rider = await getRiderById(req.params.riderId);
    if (!rider) {
      return fail(res, 404, "Rider not found.");
    }

    const inquiry = await createPersonaInquiry({
      accountType: "rider",
      accountId: rider.id,
      firstName: rider.first_name,
      lastName: rider.last_name,
      email: rider.email,
      phone: rider.phone,
      idType: rider.id_type || "government_id"
    });

    const { data, error } = await supabase
      .from("riders")
      .update({
        persona_inquiry_id: inquiry?.inquiryId || null,
        persona_status:
          inquiry?.status === "created" ? "started" : inquiry?.status || "not_started",
        updated_at: nowIso()
      })
      .eq("id", rider.id)
      .select()
      .single();

    if (error) throw error;

    return ok(res, {
      message: "Rider verification session created.",
      rider: sanitizeRider(data),
      verification: {
        required: true,
        persona_enabled: inquiry.enabled,
        persona_status: inquiry.status,
        inquiry_id: inquiry.inquiryId,
        inquiry_url: inquiry.inquiryUrl
      }
    });
  })
);

/* =========================================================
   DRIVER AUTH / VERIFICATION
========================================================= */
app.post(
  "/api/driver/signup",
  asyncHandler(async (req, res) => {
    const first_name = cleanEnv(req.body?.firstName || req.body?.first_name);
    const last_name = cleanEnv(req.body?.lastName || req.body?.last_name);
    const email = normalizeEmail(req.body?.email);
    const phone = normalizePhone(req.body?.phone);
    const city = cleanEnv(req.body?.city);
    const state = cleanEnv(req.body?.state || req.body?.stateValue || "TN");
    const password = cleanEnv(req.body?.password);
    const confirmPassword = cleanEnv(
      req.body?.confirmPassword || req.body?.confirm_password
    );
    const vehicle_make = cleanEnv(req.body?.vehicle_make || req.body?.vehicleMake);
    const vehicle_model = cleanEnv(req.body?.vehicle_model || req.body?.vehicleModel);
    const vehicle_year = cleanEnv(req.body?.vehicle_year || req.body?.vehicleYear);
    const driver_type = cleanEnv(req.body?.driver_type || "human");

    if (
      !first_name ||
      !last_name ||
      !email ||
      !phone ||
      !city ||
      !password ||
      !vehicle_make ||
      !vehicle_model ||
      !vehicle_year
    ) {
      return fail(res, 400, "Missing required driver signup fields.");
    }

    if (password.length < 8) {
      return fail(res, 400, "Password must be at least 8 characters.");
    }

    if (confirmPassword && password !== confirmPassword) {
      return fail(res, 400, "Passwords do not match.");
    }

    const existing = await getDriverByEmail(email);
    if (existing) {
      return fail(res, 409, "A driver account with that email already exists.");
    }

    const full_name = [first_name, last_name].filter(Boolean).join(" ");

    const { data: driver, error } = await supabase
      .from("drivers")
      .insert({
        id: uuid(),
        first_name,
        last_name,
        full_name,
        email,
        phone,
        city,
        state,
        password_hash: sha256(password),
        vehicle_make,
        vehicle_model,
        vehicle_year,
        driver_type,
        email_verified: false,
        sms_verified: false,
        persona_status: "not_started",
        identity_status: "not_started",
        verification_status: "pending",
        status: "pending",
        is_available: false,
        availability_status: "offline",
        created_at: nowIso(),
        updated_at: nowIso()
      })
      .select()
      .single();

    if (error) throw error;

    const inquiry = await createPersonaInquiry({
      accountType: "driver",
      accountId: driver.id,
      firstName: first_name,
      lastName: last_name,
      email,
      phone,
      idType: "government_id"
    });

    const { data: patchedDriver, error: patchError } = await supabase
      .from("drivers")
      .update({
        persona_inquiry_id: inquiry?.inquiryId || null,
        persona_status:
          inquiry?.status === "created" ? "started" : inquiry?.status || "not_started",
        updated_at: nowIso()
      })
      .eq("id", driver.id)
      .select()
      .single();

    if (patchError) throw patchError;

    const emailDelivery = await sendDriverVerificationEmail(patchedDriver);
    const smsDelivery = await sendDriverVerificationSms(patchedDriver);

    await createAuditLog(
      "driver_signup_created",
      {
        driver_id: patchedDriver.id,
        email: patchedDriver.email,
        persona_status: patchedDriver.persona_status,
        email_delivery: emailDelivery,
        sms_delivery: smsDelivery
      },
      "driver",
      patchedDriver.id
    );

    return ok(
      res,
      {
        message:
          "Driver signup created. Complete email, SMS, and identity verification before activation.",
        driver: sanitizeDriver(patchedDriver),
        verification: {
          email_required: true,
          sms_required: true,
          identity_required: true,
          persona_enabled: inquiry.enabled,
          persona_status: inquiry.status,
          inquiry_id: inquiry.inquiryId,
          inquiry_url: inquiry.inquiryUrl,
          email_delivery: emailDelivery,
          sms_delivery: smsDelivery
        }
      },
      201
    );
  })
);

app.post(
  "/api/driver/login",
  asyncHandler(async (req, res) => {
    const email = normalizeEmail(req.body?.email);
    const password = cleanEnv(req.body?.password);

    if (!email || !password) {
      return fail(res, 400, "Email and password are required.");
    }

    const driver = await getDriverByEmail(email);
    if (!driver) {
      return fail(res, 404, "Driver not found.");
    }

    if (cleanEnv(driver.password_hash) !== sha256(password)) {
      return fail(res, 401, "Invalid login credentials.");
    }

    return ok(res, {
      message: "Driver login successful.",
      driver: sanitizeDriver(driver)
    });
  })
);

app.get(
  "/api/drivers/:driverId",
  asyncHandler(async (req, res) => {
    const driver = await getDriverById(req.params.driverId);
    if (!driver) {
      return fail(res, 404, "Driver not found.");
    }

    return ok(res, {
      driver: sanitizeDriver(driver)
    });
  })
);

app.get(
  "/api/driver/:driverId/verification-status",
  asyncHandler(async (req, res) => {
    const driver = await getDriverById(req.params.driverId);
    if (!driver) {
      return fail(res, 404, "Driver not found.");
    }

    return ok(res, {
      driver_id: driver.id,
      email_verified: driver.email_verified === true,
      sms_verified: driver.sms_verified === true,
      persona_status: driver.persona_status || "not_started",
      verification_status: driver.verification_status,
      status: driver.status || "pending",
      driver_type: driver.driver_type || "human"
    });
  })
);

app.post(
  "/api/driver/verify-email",
  asyncHandler(async (req, res) => {
    const driverId = cleanEnv(req.body?.driver_id);
    const token = cleanEnv(req.body?.token);

    if (!driverId || !token) {
      return fail(res, 400, "driver_id and token are required.");
    }

    const driver = await getDriverById(driverId);
    if (!driver) {
      return fail(res, 404, "Driver not found.");
    }

    const tokenHash = sha256(token);
    const currentHash = cleanEnv(driver.email_verification_token_hash);
    const expiresAt = driver.email_verification_expires_at
      ? new Date(driver.email_verification_expires_at).getTime()
      : 0;

    if (!currentHash || tokenHash !== currentHash) {
      return fail(res, 400, "Invalid email verification token.");
    }

    if (expiresAt && Date.now() > expiresAt) {
      return fail(res, 400, "Email verification token has expired.");
    }

    const { data, error } = await supabase
      .from("drivers")
      .update({
        email_verified: true,
        email_verification_token_hash: null,
        email_verification_expires_at: null,
        updated_at: nowIso()
      })
      .eq("id", driver.id)
      .select()
      .single();

    if (error) throw error;

    return ok(res, {
      message: "Driver email verified successfully.",
      driver: sanitizeDriver(data)
    });
  })
);

app.post(
  "/api/driver/verify-sms",
  asyncHandler(async (req, res) => {
    const driverId = cleanEnv(req.body?.driver_id);
    const code = cleanEnv(req.body?.code);

    if (!driverId || !code) {
      return fail(res, 400, "driver_id and code are required.");
    }

    const driver = await getDriverById(driverId);
    if (!driver) {
      return fail(res, 404, "Driver not found.");
    }

    const codeHash = sha256(code);
    const currentHash = cleanEnv(driver.sms_verification_code_hash);
    const expiresAt = driver.sms_verification_expires_at
      ? new Date(driver.sms_verification_expires_at).getTime()
      : 0;

    if (!currentHash || codeHash !== currentHash) {
      return fail(res, 400, "Invalid SMS verification code.");
    }

    if (expiresAt && Date.now() > expiresAt) {
      return fail(res, 400, "SMS verification code has expired.");
    }

    const { data, error } = await supabase
      .from("drivers")
      .update({
        sms_verified: true,
        sms_verification_code_hash: null,
        sms_verification_expires_at: null,
        updated_at: nowIso()
      })
      .eq("id", driver.id)
      .select()
      .single();

    if (error) throw error;

    return ok(res, {
      message: "Driver SMS verified successfully.",
      driver: sanitizeDriver(data)
    });
  })
);

app.post(
  "/api/driver/:driverId/resend-email-verification",
  asyncHandler(async (req, res) => {
    const driver = await getDriverById(req.params.driverId);
    if (!driver) {
      return fail(res, 404, "Driver not found.");
    }

    const delivery = await sendDriverVerificationEmail(driver);

    return ok(res, {
      message: "Driver email verification sent.",
      delivery
    });
  })
);

app.post(
  "/api/driver/:driverId/resend-sms-verification",
  asyncHandler(async (req, res) => {
    const driver = await getDriverById(req.params.driverId);
    if (!driver) {
      return fail(res, 404, "Driver not found.");
    }

    const delivery = await sendDriverVerificationSms(driver);

    return ok(res, {
      message: "Driver SMS verification sent.",
      delivery
    });
  })
);

/* =========================================================
   PERSONA WEBHOOK
========================================================= */
app.post(
  "/api/persona/webhook",
  requireVerifiedWebhook,
  asyncHandler(async (req, res) => {
    const payload = req.body || {};
    const eventName = payload?.data?.attributes?.name || payload?.name || "";
    const inquiryId =
      payload?.data?.relationships?.inquiry?.data?.id ||
      payload?.data?.id ||
      null;

    const included = Array.isArray(payload?.included) ? payload.included : [];
    const inquiryRecord = included.find((item) => item.type === "inquiry") || null;
    const inquiryAttributes = inquiryRecord?.attributes || {};
    const referenceId =
      inquiryAttributes["reference-id"] ||
      inquiryAttributes.reference_id ||
      "";

    const [accountType, accountId] = String(referenceId).split("_");

    if (!accountType || !accountId) {
      return ok(res, {
        message: "Webhook received without supported reference ID."
      });
    }

    const normalizedEvent = String(eventName || "").toLowerCase();
    const approved =
      normalizedEvent.includes("approved") ||
      normalizedEvent.includes("completed");
    const rejected =
      normalizedEvent.includes("failed") ||
      normalizedEvent.includes("declined") ||
      normalizedEvent.includes("expired");

    if (accountType === "rider") {
      let verification_status = "pending";
      let persona_status = "pending";

      if (approved) {
        verification_status = "verified";
        persona_status = "approved";
      } else if (rejected) {
        verification_status = "rejected";
        persona_status = "rejected";
      } else {
        verification_status = "review_required";
        persona_status = "review_required";
      }

      const { data, error } = await supabase
        .from("riders")
        .update({
          verification_status,
          persona_status,
          persona_inquiry_id: inquiryId,
          id_type:
            inquiryAttributes?.fields?.government_id_type ||
            inquiryAttributes?.fields?.id_type ||
            "government_id",
          id_last4: maskIdNumber(
            inquiryAttributes?.fields?.identification_number ||
              inquiryAttributes?.fields?.document_number ||
              ""
          ),
          updated_at: nowIso()
        })
        .eq("id", accountId)
        .select()
        .single();

      if (error) throw error;

      await createAuditLog(
        "persona_webhook_rider_processed",
        {
          rider_id: accountId,
          inquiry_id: inquiryId,
          verification_status,
          persona_status
        },
        "system",
        accountId
      );

      return ok(res, {
        message: "Rider Persona webhook processed.",
        rider: sanitizeRider(data)
      });
    }

    if (accountType === "driver") {
      const persona_status = approved
        ? "approved"
        : rejected
        ? "rejected"
        : "review_required";

      const currentDriver = await getDriverById(accountId);
      if (!currentDriver) {
        return fail(res, 404, "Driver not found for Persona webhook.");
      }

      let verification_status = currentDriver.verification_status || "pending";

      if (
        approved &&
        currentDriver.email_verified === true &&
        currentDriver.sms_verified === true
      ) {
        verification_status = "verified";
      } else if (rejected) {
        verification_status = "rejected";
      }

      const statusValue =
        verification_status === "verified" ? "active" : currentDriver.status || "pending";

      const { data, error } = await supabase
        .from("drivers")
        .update({
          persona_status,
          identity_status: persona_status,
          verification_status,
          persona_inquiry_id: inquiryId,
          status: statusValue,
          updated_at: nowIso()
        })
        .eq("id", accountId)
        .select()
        .single();

      if (error) throw error;

      await createAuditLog(
        "persona_webhook_driver_processed",
        {
          driver_id: accountId,
          inquiry_id: inquiryId,
          verification_status,
          persona_status
        },
        "system",
        accountId
      );

      return ok(res, {
        message: "Driver Persona webhook processed.",
        driver: sanitizeDriver(data)
      });
    }

    return ok(res, {
      message: "Webhook processed with unsupported account type."
    });
  })
);/* =========================================================
   MAP / ROUTE / FARE HELPERS
========================================================= */
function normalizeAddress(value = "") {
  return String(value || "").trim();
}

async function geocodeAddress(address) {
  const normalized = normalizeAddress(address);

  if (!normalized) {
    const error = new Error("Address is required.");
    error.statusCode = 400;
    throw error;
  }

  if (!GOOGLE_MAPS_API_KEY) {
    return {
      address: normalized,
      latitude: null,
      longitude: null,
      provider: "fallback"
    };
  }

  const url =
    `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(
      normalized
    )}&key=${encodeURIComponent(GOOGLE_MAPS_API_KEY)}`;

  const response = await fetch(url);
  const result = await response.json();

  if (!response.ok || result.status !== "OK" || !Array.isArray(result.results) || !result.results[0]) {
    const error = new Error("Unable to geocode address.");
    error.statusCode = 400;
    error.details = {
      address: normalized,
      provider_status: result.status || response.status
    };
    throw error;
  }

  const first = result.results[0];

  return {
    address: first.formatted_address || normalized,
    latitude: first.geometry?.location?.lat ?? null,
    longitude: first.geometry?.location?.lng ?? null,
    provider: "google_maps"
  };
}

async function getRouteEstimate(originAddress, destinationAddress) {
  const origin = normalizeAddress(originAddress);
  const destination = normalizeAddress(destinationAddress);

  if (!origin || !destination) {
    const error = new Error("Pickup and dropoff addresses are required.");
    error.statusCode = 400;
    throw error;
  }

  if (!GOOGLE_MAPS_API_KEY) {
    return {
      pickup_address: origin,
      dropoff_address: destination,
      distance_text: "6.5 mi",
      duration_text: "18 mins",
      distance_miles: 6.5,
      duration_minutes: 18,
      provider: "fallback"
    };
  }

  const url =
    `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${encodeURIComponent(
      origin
    )}&destinations=${encodeURIComponent(
      destination
    )}&units=imperial&key=${encodeURIComponent(GOOGLE_MAPS_API_KEY)}`;

  const response = await fetch(url);
  const result = await response.json();

  const element = result?.rows?.[0]?.elements?.[0];

  if (!response.ok || result.status !== "OK" || !element || element.status !== "OK") {
    const error = new Error("Unable to calculate route estimate.");
    error.statusCode = 400;
    error.details = {
      pickup_address: origin,
      dropoff_address: destination,
      provider_status: result.status || response.status,
      element_status: element?.status || "UNKNOWN"
    };
    throw error;
  }

  const distanceValueMeters = Number(element.distance?.value || 0);
  const durationValueSeconds = Number(element.duration?.value || 0);

  return {
    pickup_address: origin,
    dropoff_address: destination,
    distance_text: element.distance?.text || "",
    duration_text: element.duration?.text || "",
    distance_miles: Number((distanceValueMeters / 1609.344).toFixed(2)),
    duration_minutes: Math.max(1, Math.round(durationValueSeconds / 60)),
    provider: "google_maps"
  };
}

function getRideTypeMultiplier(rideType = "standard") {
  const type = cleanEnv(rideType || "standard").toLowerCase();

  if (type === "airport") return 1.2;
  if (type === "medical") return 0.95;
  if (type === "scheduled") return 1.1;
  if (type === "nonprofit") return 0.85;
  return 1;
}

function getRequestedModeMultiplier(requestedMode = REQUESTED_MODES.DRIVER) {
  const mode = normalizeRequestedMode(requestedMode);
  return mode === REQUESTED_MODES.AUTONOMOUS ? 1.15 : 1;
}

function calculateFare({
  distance_miles = 0,
  duration_minutes = 0,
  ride_type = "standard",
  requested_mode = REQUESTED_MODES.DRIVER,
  surge_multiplier = 1
}) {
  const baseFare = 4.5;
  const perMile = 2.35;
  const perMinute = 0.42;
  const bookingFee = 2.25;
  const minimumFare = 10.5;

  const rideTypeMultiplier = getRideTypeMultiplier(ride_type);
  const modeMultiplier = getRequestedModeMultiplier(requested_mode);

  let subtotal =
    baseFare +
    Number(distance_miles || 0) * perMile +
    Number(duration_minutes || 0) * perMinute;

  subtotal *= rideTypeMultiplier;
  subtotal *= modeMultiplier;
  subtotal *= Number(surge_multiplier || 1);
  subtotal += bookingFee;

  const estimatedFare = Math.max(minimumFare, subtotal);
  const driverPayout = estimatedFare * 0.72;
  const platformFee = estimatedFare - driverPayout;

  return {
    base_fare: dollars(baseFare),
    distance_fare: dollars(Number(distance_miles || 0) * perMile),
    time_fare: dollars(Number(duration_minutes || 0) * perMinute),
    booking_fee: dollars(bookingFee),
    ride_type_multiplier: Number(rideTypeMultiplier.toFixed(2)),
    requested_mode_multiplier: Number(modeMultiplier.toFixed(2)),
    surge_multiplier: Number(Number(surge_multiplier || 1).toFixed(2)),
    estimated_fare: dollars(estimatedFare),
    minimum_fare_applied: estimatedFare === minimumFare,
    driver_payout_estimate: dollars(driverPayout),
    platform_fee_estimate: dollars(platformFee)
  };
}

/* =========================================================
   RIDE / PAYMENT / MISSION HELPERS
========================================================= */
async function createRideRecord(payload) {
  ensureSupabase();

  const insertPayload = {
    id: uuid(),
    rider_id: payload.rider_id,
    driver_id: payload.driver_id || null,
    status: payload.status || RIDE_STATUSES.REQUESTED,
    pickup_address: normalizeAddress(payload.pickup_address),
    dropoff_address: normalizeAddress(payload.dropoff_address),
    pickup_latitude: payload.pickup_latitude ?? null,
    pickup_longitude: payload.pickup_longitude ?? null,
    dropoff_latitude: payload.dropoff_latitude ?? null,
    dropoff_longitude: payload.dropoff_longitude ?? null,
    estimated_distance_miles: Number(payload.estimated_distance_miles || 0),
    estimated_duration_minutes: Number(payload.estimated_duration_minutes || 0),
    fare_estimate: dollars(payload.fare_estimate || 0),
    driver_payout_estimate: dollars(payload.driver_payout_estimate || 0),
    platform_fee_estimate: dollars(payload.platform_fee_estimate || 0),
    ride_type: cleanEnv(payload.ride_type || "standard").toLowerCase(),
    requested_mode: normalizeRequestedMode(payload.requested_mode),
    payment_status: cleanEnv(payload.payment_status || PAYMENT_STATUSES.PENDING).toLowerCase(),
    payment_authorization_id: payload.payment_authorization_id || null,
    special_notes: cleanEnv(payload.special_notes || ""),
    created_at: nowIso(),
    updated_at: nowIso()
  };

  const { data, error } = await supabase
    .from("rides")
    .insert(insertPayload)
    .select()
    .single();

  if (error) throw error;
  return data;
}

async function updateRide(rideId, patch) {
  ensureSupabase();

  const { data, error } = await supabase
    .from("rides")
    .update({
      ...patch,
      updated_at: nowIso()
    })
    .eq("id", rideId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

async function createMissionRecord({ ride, rider }) {
  ensureSupabase();

  const payload = {
    id: uuid(),
    ride_id: ride.id,
    rider_id: ride.rider_id,
    driver_id: ride.driver_id || null,
    status: "open",
    requested_mode: ride.requested_mode,
    ride_type: ride.ride_type,
    pickup_address: ride.pickup_address,
    dropoff_address: ride.dropoff_address,
    estimated_distance_miles: ride.estimated_distance_miles,
    estimated_duration_minutes: ride.estimated_duration_minutes,
    fare_estimate: ride.fare_estimate,
    driver_payout_estimate: ride.driver_payout_estimate,
    platform_fee_estimate: ride.platform_fee_estimate,
    mission_summary: [
      `Pickup: ${ride.pickup_address}`,
      `Dropoff: ${ride.dropoff_address}`,
      `Estimated fare: $${dollars(ride.fare_estimate)}`,
      `Estimated payout: $${dollars(ride.driver_payout_estimate)}`,
      `Ride type: ${ride.ride_type}`,
      `Requested mode: ${ride.requested_mode}`
    ].join(" | "),
    rider_first_name: rider?.first_name || "",
    created_at: nowIso(),
    updated_at: nowIso()
  };

  const { data, error } = await supabase
    .from("missions")
    .insert(payload)
    .select()
    .single();

  if (error) throw error;
  return data;
}

async function getMissionByRideId(rideId) {
  ensureSupabase();

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

async function updateMission(missionId, patch) {
  ensureSupabase();

  const { data, error } = await supabase
    .from("missions")
    .update({
      ...patch,
      updated_at: nowIso()
    })
    .eq("id", missionId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

async function setRideStatus(rideId, status, metadata = {}) {
  const ride = await updateRide(rideId, { status });
  await createTripEvent(rideId, `ride_${status}`, metadata);
  return ride;
}

async function createPaymentAuthorizationRecord({
  rider_id,
  amount,
  method = "card",
  provider = "platform_authorization"
}) {
  ensureSupabase();

  const payload = {
    id: uuid(),
    rider_id,
    authorization_id: `payauth_${uuid()}`,
    amount: dollars(amount),
    method: cleanEnv(method || "card").toLowerCase(),
    provider,
    status: PAYMENT_STATUSES.AUTHORIZED,
    created_at: nowIso(),
    updated_at: nowIso()
  };

  const { data, error } = await supabase
    .from("payment_authorizations")
    .insert(payload)
    .select()
    .single();

  if (error) throw error;
  return data;
}

async function getLatestAuthorizedPaymentForRider(riderId) {
  ensureSupabase();

  const { data, error } = await supabase
    .from("payment_authorizations")
    .select("*")
    .eq("rider_id", riderId)
    .eq("status", PAYMENT_STATUSES.AUTHORIZED)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

async function getRideReceiptData(rideId) {
  const ride = await getRideById(rideId);
  if (!ride) return null;

  const rider = ride.rider_id ? await getRiderById(ride.rider_id) : null;
  const driver = ride.driver_id ? await getDriverById(ride.driver_id) : null;

  const { data: ledgerEntries, error } = await supabase
    .from("driver_earnings_ledger")
    .select("*")
    .eq("ride_id", ride.id)
    .order("created_at", { ascending: true });

  if (error) throw error;

  const tipTotal = (ledgerEntries || [])
    .filter((entry) => String(entry.entry_type || "").toLowerCase() === "tip")
    .reduce((sum, entry) => sum + Number(entry.amount || 0), 0);

  return {
    ride,
    rider: sanitizeRider(rider),
    driver: sanitizeDriver(driver),
    ledger_entries: ledgerEntries || [],
    financials: {
      fare_estimate: dollars(ride.fare_estimate || 0),
      driver_payout_estimate: dollars(ride.driver_payout_estimate || 0),
      platform_fee_estimate: dollars(ride.platform_fee_estimate || 0),
      tip_total: dollars(tipTotal),
      total_charged_estimate: dollars(Number(ride.fare_estimate || 0) + tipTotal)
    }
  };
}

async function getOpenRideForRider(riderId) {
  ensureSupabase();

  const activeStatuses = [
    RIDE_STATUSES.REQUESTED,
    RIDE_STATUSES.SEARCHING,
    RIDE_STATUSES.OFFERED,
    RIDE_STATUSES.ACCEPTED,
    RIDE_STATUSES.DRIVER_ASSIGNED,
    RIDE_STATUSES.DRIVER_ENROUTE,
    RIDE_STATUSES.DRIVER_ARRIVED,
    RIDE_STATUSES.TRIP_STARTED
  ];

  const { data, error } = await supabase
    .from("rides")
    .select("*")
    .eq("rider_id", riderId)
    .in("status", activeStatuses)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

async function getOpenRideForDriver(driverId) {
  ensureSupabase();

  const activeStatuses = [
    RIDE_STATUSES.ACCEPTED,
    RIDE_STATUSES.DRIVER_ASSIGNED,
    RIDE_STATUSES.DRIVER_ENROUTE,
    RIDE_STATUSES.DRIVER_ARRIVED,
    RIDE_STATUSES.TRIP_STARTED
  ];

  const { data, error } = await supabase
    .from("rides")
    .select("*")
    .eq("driver_id", driverId)
    .in("status", activeStatuses)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

/* =========================================================
   FARE / PAYMENT / REQUEST RIDE
========================================================= */
app.post(
  "/api/fare-estimate",
  asyncHandler(async (req, res) => {
    const pickup_address = normalizeAddress(
      req.body?.pickup_address || req.body?.pickupAddress
    );
    const dropoff_address = normalizeAddress(
      req.body?.dropoff_address || req.body?.dropoffAddress
    );
    const ride_type = cleanEnv(req.body?.ride_type || req.body?.rideType || "standard");
    const requested_mode = cleanEnv(
      req.body?.requested_mode || req.body?.requestedMode || REQUESTED_MODES.DRIVER
    );

    if (!pickup_address || !dropoff_address) {
      return fail(res, 400, "Pickup and dropoff addresses are required.");
    }

    const route = await getRouteEstimate(pickup_address, dropoff_address);
    const fare = calculateFare({
      distance_miles: route.distance_miles,
      duration_minutes: route.duration_minutes,
      ride_type,
      requested_mode,
      surge_multiplier: 1
    });

    return ok(res, {
      message: "Fare estimate calculated.",
      route,
      fare
    });
  })
);

app.post(
  "/api/payments/authorize",
  asyncHandler(async (req, res) => {
    const rider_id = cleanEnv(req.body?.rider_id || req.body?.riderId);
    const estimated_amount = Number(
      req.body?.estimated_amount ||
      req.body?.estimatedAmount ||
      req.body?.amount ||
      0
    );
    const method = cleanEnv(req.body?.method || "card");

    if (!rider_id) {
      return fail(res, 400, "rider_id is required.");
    }

    if (!estimated_amount || estimated_amount <= 0) {
      return fail(res, 400, "A valid estimated_amount is required.");
    }

    const rider = await requireVerifiedRider(rider_id);

    const payment = await createPaymentAuthorizationRecord({
      rider_id: rider.id,
      amount: estimated_amount,
      method
    });

    await createAuditLog(
      "payment_authorized",
      {
        rider_id: rider.id,
        authorization_id: payment.authorization_id,
        amount: payment.amount,
        method: payment.method
      },
      "rider",
      rider.id
    );

    return ok(res, {
      message: "Payment authorized successfully.",
      payment: {
        authorization_id: payment.authorization_id,
        amount: payment.amount,
        status: payment.status,
        method: payment.method,
        provider: payment.provider,
        created_at: payment.created_at
      }
    });
  })
);

app.post(
  "/api/request-ride",
  asyncHandler(async (req, res) => {
    const rider_id = cleanEnv(req.body?.rider_id || req.body?.riderId);
    const pickup_address = normalizeAddress(
      req.body?.pickup_address || req.body?.pickupAddress
    );
    const dropoff_address = normalizeAddress(
      req.body?.dropoff_address || req.body?.dropoffAddress
    );
    const ride_type = cleanEnv(req.body?.ride_type || req.body?.rideType || "standard");
    const requested_mode = cleanEnv(
      req.body?.requested_mode || req.body?.requestedMode || REQUESTED_MODES.DRIVER
    );
    const special_notes = cleanEnv(req.body?.special_notes || req.body?.notes || "");

    if (!rider_id || !pickup_address || !dropoff_address) {
      return fail(
        res,
        400,
        "rider_id, pickup_address, and dropoff_address are required."
      );
    }

    const rider = await requireVerifiedRider(rider_id);

    const latestPayment = await getLatestAuthorizedPaymentForRider(rider.id);
    if (REQUIRE_PAYMENT_AUTHORIZATION && !latestPayment) {
      return fail(res, 402, "Payment authorization is required before requesting a ride.", {
        code: "PAYMENT_NOT_AUTHORIZED"
      });
    }

    const pickupGeo = await geocodeAddress(pickup_address);
    const dropoffGeo = await geocodeAddress(dropoff_address);
    const route = await getRouteEstimate(pickup_address, dropoff_address);

    const fare = calculateFare({
      distance_miles: route.distance_miles,
      duration_minutes: route.duration_minutes,
      ride_type,
      requested_mode,
      surge_multiplier: 1
    });

    let ride = await createRideRecord({
      rider_id: rider.id,
      pickup_address: pickupGeo.address,
      dropoff_address: dropoffGeo.address,
      pickup_latitude: pickupGeo.latitude,
      pickup_longitude: pickupGeo.longitude,
      dropoff_latitude: dropoffGeo.latitude,
      dropoff_longitude: dropoffGeo.longitude,
      estimated_distance_miles: route.distance_miles,
      estimated_duration_minutes: route.duration_minutes,
      fare_estimate: fare.estimated_fare,
      driver_payout_estimate: fare.driver_payout_estimate,
      platform_fee_estimate: fare.platform_fee_estimate,
      ride_type,
      requested_mode,
      payment_status: latestPayment ? PAYMENT_STATUSES.AUTHORIZED : PAYMENT_STATUSES.PENDING,
      payment_authorization_id: latestPayment?.authorization_id || null,
      special_notes,
      status: RIDE_STATUSES.REQUESTED
    });

    await createTripEvent(ride.id, "ride_requested", {
      rider_id: rider.id,
      ride_type,
      requested_mode,
      pickup_address: ride.pickup_address,
      dropoff_address: ride.dropoff_address
    });

    ride = await setRideStatus(ride.id, RIDE_STATUSES.SEARCHING, {
      reason: "request_validated_and_ready_for_dispatch"
    });

    const mission = await createMissionRecord({
      ride,
      rider
    });

    await createAuditLog(
      "ride_requested",
      {
        ride_id: ride.id,
        mission_id: mission.id,
        rider_id: rider.id,
        payment_authorization_id: latestPayment?.authorization_id || null,
        requested_mode: ride.requested_mode,
        ride_type: ride.ride_type
      },
      "rider",
      rider.id
    );

    return ok(
      res,
      {
        message: "Ride request created and ready for dispatch.",
        ride,
        mission,
        fare,
        route
      },
      201
    );
  })
);

/* =========================================================
   RIDE LOOKUPS
========================================================= */
app.get(
  "/api/rides/:rideId",
  asyncHandler(async (req, res) => {
    const ride = await getRideById(req.params.rideId);

    if (!ride) {
      return fail(res, 404, "Ride not found.");
    }

    return ok(res, { ride });
  })
);

app.get(
  "/api/rider/:riderId/rides",
  asyncHandler(async (req, res) => {
    const rider = await getRiderById(req.params.riderId);

    if (!rider) {
      return fail(res, 404, "Rider not found.");
    }

    const { data, error } = await supabase
      .from("rides")
      .select("*")
      .eq("rider_id", rider.id)
      .order("created_at", { ascending: false });

    if (error) throw error;

    return ok(res, {
      rider_id: rider.id,
      rides: data || []
    });
  })
);

app.get(
  "/api/riders/:riderId/active-trip",
  asyncHandler(async (req, res) => {
    const rider = await getRiderById(req.params.riderId);

    if (!rider) {
      return fail(res, 404, "Rider not found.");
    }

    const ride = await getOpenRideForRider(rider.id);

    return ok(res, {
      rider_id: rider.id,
      ride
    });
  })
);

app.get(
  "/api/riders/:riderId/payment-status",
  asyncHandler(async (req, res) => {
    const rider = await getRiderById(req.params.riderId);

    if (!rider) {
      return fail(res, 404, "Rider not found.");
    }

    const latestPayment = await getLatestAuthorizedPaymentForRider(rider.id);

    return ok(res, {
      rider_id: rider.id,
      payment: latestPayment
        ? {
            authorization_id: latestPayment.authorization_id,
            status: latestPayment.status,
            amount: latestPayment.amount,
            method: latestPayment.method,
            created_at: latestPayment.created_at
          }
        : null
    });
  })
);

app.get(
  "/api/driver/:driverId/current-ride",
  asyncHandler(async (req, res) => {
    const driver = await getDriverById(req.params.driverId);

    if (!driver) {
      return fail(res, 404, "Driver not found.");
    }

    const ride = await getOpenRideForDriver(driver.id);

    return ok(res, {
      driver_id: driver.id,
      ride
    });
  })
);

app.get(
  "/api/rides/:rideId/live-status",
  asyncHandler(async (req, res) => {
    const ride = await getRideById(req.params.rideId);

    if (!ride) {
      return fail(res, 404, "Ride not found.");
    }

    const driver = ride.driver_id ? await getDriverById(ride.driver_id) : null;
    const mission = await getMissionByRideId(ride.id);

    return ok(res, {
      ride_id: ride.id,
      ride_status: ride.status,
      payment_status: ride.payment_status,
      requested_mode: ride.requested_mode,
      pickup_address: ride.pickup_address,
      dropoff_address: ride.dropoff_address,
      driver: sanitizeDriver(driver),
      mission
    });
  })
);

/* =========================================================
   RIDE STATUS TRANSITIONS
========================================================= */
app.post(
  "/api/rides/:rideId/driver-enroute",
  asyncHandler(async (req, res) => {
    const ride = await getRideById(req.params.rideId);
    if (!ride) {
      return fail(res, 404, "Ride not found.");
    }

    const updated = await setRideStatus(ride.id, RIDE_STATUSES.DRIVER_ENROUTE, {
      actor: "driver",
      driver_id: ride.driver_id
    });

    return ok(res, {
      message: "Ride marked driver_enroute.",
      ride: updated
    });
  })
);

app.post(
  "/api/rides/:rideId/driver-arrived",
  asyncHandler(async (req, res) => {
    const ride = await getRideById(req.params.rideId);
    if (!ride) {
      return fail(res, 404, "Ride not found.");
    }

    const updated = await setRideStatus(ride.id, RIDE_STATUSES.DRIVER_ARRIVED, {
      actor: "driver",
      driver_id: ride.driver_id
    });

    return ok(res, {
      message: "Ride marked driver_arrived.",
      ride: updated
    });
  })
);

app.post(
  "/api/rides/:rideId/start",
  asyncHandler(async (req, res) => {
    const ride = await getRideById(req.params.rideId);
    if (!ride) {
      return fail(res, 404, "Ride not found.");
    }

    const updated = await setRideStatus(ride.id, RIDE_STATUSES.TRIP_STARTED, {
      actor: "driver",
      driver_id: ride.driver_id,
      started_at: nowIso()
    });

    return ok(res, {
      message: "Trip started.",
      ride: updated
    });
  })
);

app.post(
  "/api/rides/:rideId/complete",
  asyncHandler(async (req, res) => {
    const ride = await getRideById(req.params.rideId);
    if (!ride) {
      return fail(res, 404, "Ride not found.");
    }

    const updated = await updateRide(ride.id, {
      status: RIDE_STATUSES.TRIP_COMPLETED,
      payment_status: PAYMENT_STATUSES.CAPTURED
    });

    await createTripEvent(ride.id, "ride_trip_completed", {
      actor: "driver",
      driver_id: ride.driver_id,
      completed_at: nowIso(),
      payment_status: PAYMENT_STATUSES.CAPTURED
    });

    if (ride.driver_id) {
      await supabase.from("driver_earnings_ledger").insert({
        id: uuid(),
        ride_id: ride.id,
        driver_id: ride.driver_id,
        rider_id: ride.rider_id,
        entry_type: "ride_payout",
        amount: dollars(ride.driver_payout_estimate || 0),
        status: "earned",
        notes: "Base driver payout for completed ride",
        metadata: {
          payment_status: PAYMENT_STATUSES.CAPTURED,
          ride_status: RIDE_STATUSES.TRIP_COMPLETED
        },
        created_at: nowIso(),
        updated_at: nowIso()
      });
    }

    await createAuditLog(
      "ride_completed",
      {
        ride_id: ride.id,
        rider_id: ride.rider_id,
        driver_id: ride.driver_id,
        fare_estimate: ride.fare_estimate
      },
      "system",
      ride.id
    );

    return ok(res, {
      message: "Trip completed.",
      ride: updated
    });
  })
);

app.post(
  "/api/rides/:rideId/cancel",
  asyncHandler(async (req, res) => {
    const ride = await getRideById(req.params.rideId);
    if (!ride) {
      return fail(res, 404, "Ride not found.");
    }

    const reason = cleanEnv(req.body?.reason || "cancelled_by_user");

    const updated = await updateRide(ride.id, {
      status: RIDE_STATUSES.CANCELLED,
      payment_status:
        String(ride.payment_status || "").toLowerCase() === PAYMENT_STATUSES.AUTHORIZED
          ? PAYMENT_STATUSES.RELEASED
          : ride.payment_status
    });

    await createTripEvent(ride.id, "ride_cancelled", {
      reason,
      cancelled_at: nowIso()
    });

    const mission = await getMissionByRideId(ride.id);
    if (mission) {
      await updateMission(mission.id, {
        status: "cancelled"
      });
    }

    await createAuditLog(
      "ride_cancelled",
      {
        ride_id: ride.id,
        rider_id: ride.rider_id,
        driver_id: ride.driver_id,
        reason
      },
      "system",
      ride.id
    );

    return ok(res, {
      message: "Ride cancelled.",
      ride: updated
    });
  })
);

/* =========================================================
   TIPS / RECEIPTS / PAYMENT REFINEMENT
========================================================= */
app.post(
  "/api/rides/:rideId/tip",
  asyncHandler(async (req, res) => {
    const ride = await getRideById(req.params.rideId);

    if (!ride) {
      return fail(res, 404, "Ride not found.");
    }

    if (!ride.driver_id) {
      return fail(res, 400, "Cannot tip a ride with no assigned driver.");
    }

    const amount = Number(req.body?.amount || 0);
    const note = cleanEnv(req.body?.note || "Tip added by rider");

    if (!amount || amount <= 0) {
      return fail(res, 400, "A valid tip amount is required.");
    }

    const allowedStatuses = [
      RIDE_STATUSES.DRIVER_ASSIGNED,
      RIDE_STATUSES.DRIVER_ENROUTE,
      RIDE_STATUSES.DRIVER_ARRIVED,
      RIDE_STATUSES.TRIP_STARTED,
      RIDE_STATUSES.TRIP_COMPLETED
    ];

    if (!allowedStatuses.includes(String(ride.status || "").toLowerCase())) {
      return fail(res, 400, "Tips can only be added during or after an active trip.");
    }

    const { data, error } = await supabase
      .from("driver_earnings_ledger")
      .insert({
        id: uuid(),
        ride_id: ride.id,
        driver_id: ride.driver_id,
        rider_id: ride.rider_id,
        entry_type: "tip",
        amount: dollars(amount),
        status: "earned",
        notes: note,
        metadata: {
          ride_status: ride.status
        },
        created_at: nowIso(),
        updated_at: nowIso()
      })
      .select()
      .single();

    if (error) throw error;

    await createTripEvent(ride.id, "ride_tip_added", {
      driver_id: ride.driver_id,
      amount: dollars(amount)
    });

    return ok(
      res,
      {
        message: "Tip added successfully.",
        tip: data
      },
      201
    );
  })
);

app.get(
  "/api/rides/:rideId/receipt",
  asyncHandler(async (req, res) => {
    const receipt = await getRideReceiptData(req.params.rideId);

    if (!receipt) {
      return fail(res, 404, "Ride receipt not found.");
    }

    return ok(res, {
      receipt
    });
  })
);

app.get(
  "/api/rider/:riderId/receipts",
  asyncHandler(async (req, res) => {
    const rider = await getRiderById(req.params.riderId);

    if (!rider) {
      return fail(res, 404, "Rider not found.");
    }

    const { data, error } = await supabase
      .from("rides")
      .select("*")
      .eq("rider_id", rider.id)
      .order("created_at", { ascending: false });

    if (error) throw error;

    const receipts = [];
    for (const ride of data || []) {
      const { data: ledgerEntries, error: ledgerError } = await supabase
        .from("driver_earnings_ledger")
        .select("*")
        .eq("ride_id", ride.id);

      if (ledgerError) throw ledgerError;

      const tipTotal = (ledgerEntries || [])
        .filter((entry) => String(entry.entry_type || "").toLowerCase() === "tip")
        .reduce((sum, entry) => sum + Number(entry.amount || 0), 0);

      receipts.push({
        ride_id: ride.id,
        created_at: ride.created_at,
        status: ride.status,
        pickup_address: ride.pickup_address,
        dropoff_address: ride.dropoff_address,
        fare_estimate: dollars(ride.fare_estimate || 0),
        tip_total: dollars(tipTotal),
        total_estimate: dollars(Number(ride.fare_estimate || 0) + tipTotal),
        payment_status: ride.payment_status
      });
    }

    return ok(res, {
      rider_id: rider.id,
      receipts
    });
  })
);

app.post(
  "/api/rides/:rideId/capture-payment",
  asyncHandler(async (req, res) => {
    const ride = await getRideById(req.params.rideId);

    if (!ride) {
      return fail(res, 404, "Ride not found.");
    }

    if (String(ride.status || "").toLowerCase() !== RIDE_STATUSES.TRIP_COMPLETED) {
      return fail(res, 400, "Ride must be completed before payment capture.");
    }

    const updatedRide = await updateRide(ride.id, {
      payment_status: PAYMENT_STATUSES.CAPTURED
    });

    return ok(res, {
      message: "Ride payment captured successfully.",
      ride: updatedRide
    });
  })
);

app.post(
  "/api/rides/:rideId/release-payment",
  asyncHandler(async (req, res) => {
    const ride = await getRideById(req.params.rideId);

    if (!ride) {
      return fail(res, 404, "Ride not found.");
    }

    const updatedRide = await updateRide(ride.id, {
      payment_status: PAYMENT_STATUSES.RELEASED
    });

    await createTripEvent(updatedRide.id, "payment_released", {
      previous_status: ride.payment_status,
      new_status: PAYMENT_STATUSES.RELEASED
    });

    return ok(res, {
      message: "Ride payment released.",
      ride: updatedRide
    });
  })
);/* =========================================================
   DRIVER LOCATION / AVAILABILITY HELPERS
========================================================= */
async function getDriverLocation(driverId) {
  ensureSupabase();

  const { data, error } = await supabase
    .from("driver_locations")
    .select("*")
    .eq("driver_id", driverId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.warn("Driver location lookup failed:", error.message);
    return null;
  }

  return data || null;
}

function haversineMiles(lat1, lon1, lat2, lon2) {
  const toRad = (deg) => (Number(deg) * Math.PI) / 180;
  const R = 3958.8;

  if (
    !Number.isFinite(Number(lat1)) ||
    !Number.isFinite(Number(lon1)) ||
    !Number.isFinite(Number(lat2)) ||
    !Number.isFinite(Number(lon2))
  ) {
    return null;
  }

  const dLat = toRad(Number(lat2) - Number(lat1));
  const dLon = toRad(Number(lon2) - Number(lon1));

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) ** 2;

  const c = 2 * Math.asin(Math.sqrt(a));
  return Number((R * c).toFixed(2));
}

function computeIdleMinutes(driver) {
  const lastActiveAt =
    driver.last_trip_completed_at ||
    driver.last_seen_at ||
    driver.updated_at ||
    driver.created_at;

  const timestamp = new Date(lastActiveAt).getTime();
  if (!timestamp || Number.isNaN(timestamp)) return 0;

  return Math.max(0, Math.round((Date.now() - timestamp) / 60000));
}

async function getAvailableDrivers({ requestedMode, limit = 100 }) {
  ensureSupabase();

  const { data, error } = await supabase
    .from("drivers")
    .select("*")
    .eq("status", "active")
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (error) throw error;

  const mode = normalizeRequestedMode(requestedMode);

  return (data || []).filter((driver) => {
    const availableFlag =
      driver.is_available === true ||
      String(driver.availability_status || "").toLowerCase() === "available";

    return (
      isDriverVerified(driver) &&
      availableFlag &&
      isDriverEligibleForMode(driver, mode)
    );
  });
}

async function buildDriverCandidatesForRide(ride, drivers = []) {
  const pickupLat = Number(ride.pickup_latitude);
  const pickupLon = Number(ride.pickup_longitude);

  const enriched = [];

  for (const driver of drivers) {
    const location = await getDriverLocation(driver.id);

    const distanceMiles = location
      ? haversineMiles(
          pickupLat,
          pickupLon,
          location.latitude,
          location.longitude
        )
      : null;

    const idleMinutes = computeIdleMinutes(driver);

    const score = scoreDriverForRide(driver, ride, {
      distance_miles:
        Number.isFinite(Number(distanceMiles)) && distanceMiles !== null
          ? distanceMiles
          : 999,
      idle_minutes: idleMinutes
    });

    enriched.push({
      driver,
      location,
      distance_miles: distanceMiles,
      idle_minutes: idleMinutes,
      score
    });
  }

  return enriched
    .filter((candidate) => {
      if (!candidate.driver) return false;

      if (
        Number.isFinite(Number(candidate.distance_miles)) &&
        Number(candidate.distance_miles) >
          DISPATCH_BASE_RADIUS_MILES * DISPATCH_MAX_ATTEMPTS
      ) {
        return false;
      }

      return true;
    })
    .sort((a, b) => b.score.total_score - a.score.total_score);
}

/* =========================================================
   DISPATCH HELPERS
========================================================= */
async function getDispatchById(dispatchId) {
  ensureSupabase();

  const { data, error } = await supabase
    .from("dispatches")
    .select("*")
    .eq("id", dispatchId)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

async function getDispatchAttemptsForRide(rideId) {
  ensureSupabase();

  const { data, error } = await supabase
    .from("dispatches")
    .select("*")
    .eq("ride_id", rideId)
    .order("attempt", { ascending: true });

  if (error) throw error;
  return data || [];
}

async function getOpenDispatchForRide(rideId) {
  ensureSupabase();

  const { data, error } = await supabase
    .from("dispatches")
    .select("*")
    .eq("ride_id", rideId)
    .in("status", ["offered", "sent"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

async function getOpenDispatchForDriver(driverId) {
  ensureSupabase();

  const { data, error } = await supabase
    .from("dispatches")
    .select("*")
    .eq("driver_id", driverId)
    .in("status", ["offered", "sent"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

async function createDispatchOffer({ ride, mission, candidate, attempt }) {
  ensureSupabase();

  const expiresAt = new Date(
    Date.now() + DISPATCH_OFFER_TIMEOUT_SECONDS * 1000
  ).toISOString();

  const payload = {
    id: uuid(),
    ride_id: ride.id,
    mission_id: mission?.id || null,
    driver_id: candidate.driver.id,
    status: "offered",
    score: candidate.score.total_score,
    score_components: candidate.score.components,
    distance_miles: candidate.distance_miles,
    idle_minutes: candidate.idle_minutes,
    attempt,
    expires_at: expiresAt,
    requested_mode: ride.requested_mode,
    created_at: nowIso(),
    updated_at: nowIso()
  };

  const { data, error } = await supabase
    .from("dispatches")
    .insert(payload)
    .select()
    .single();

  if (error) throw error;

  await createTripEvent(ride.id, "dispatch_offered", {
    dispatch_id: data.id,
    mission_id: mission?.id || null,
    driver_id: candidate.driver.id,
    attempt,
    score: candidate.score.total_score,
    distance_miles: candidate.distance_miles,
    expires_at: expiresAt
  });

  await createAuditLog(
    "dispatch_offered",
    {
      ride_id: ride.id,
      dispatch_id: data.id,
      mission_id: mission?.id || null,
      driver_id: candidate.driver.id,
      attempt,
      score: candidate.score.total_score
    },
    "system",
    ride.id
  );

  return data;
}

async function updateDispatch(dispatchId, patch) {
  ensureSupabase();

  const { data, error } = await supabase
    .from("dispatches")
    .update({
      ...patch,
      updated_at: nowIso()
    })
    .eq("id", dispatchId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

async function expireDispatch(dispatchId, reason = "timeout") {
  const updated = await updateDispatch(dispatchId, {
    status: "expired",
    expired_reason: reason
  });

  await createTripEvent(updated.ride_id, "dispatch_expired", {
    dispatch_id: updated.id,
    driver_id: updated.driver_id,
    reason
  });

  return updated;
}

async function declineDispatch(dispatchId, reason = "declined_by_driver") {
  const updated = await updateDispatch(dispatchId, {
    status: "declined",
    declined_reason: reason
  });

  await createTripEvent(updated.ride_id, "dispatch_declined", {
    dispatch_id: updated.id,
    driver_id: updated.driver_id,
    reason
  });

  return updated;
}

async function chooseBestDriverForRide(ride, excludedDriverIds = []) {
  const availableDrivers = await getAvailableDrivers({
    requestedMode: ride.requested_mode,
    limit: 100
  });

  const candidates = await buildDriverCandidatesForRide(
    ride,
    availableDrivers.filter((driver) => !excludedDriverIds.includes(driver.id))
  );

  return candidates[0] || null;
}

async function assignDriverToRide({ ride, driver, dispatch, mission }) {
  const updatedRide = await updateRide(ride.id, {
    driver_id: driver.id,
    status: RIDE_STATUSES.DRIVER_ASSIGNED
  });

  const updatedMission = mission
    ? await updateMission(mission.id, {
        driver_id: driver.id,
        status: "assigned"
      })
    : null;

  await updateDispatch(dispatch.id, {
    status: "accepted",
    accepted_at: nowIso()
  });

  await createTripEvent(ride.id, "driver_assigned", {
    dispatch_id: dispatch.id,
    driver_id: driver.id,
    mission_id: mission?.id || null
  });

  await createAuditLog(
    "driver_assigned_to_ride",
    {
      ride_id: ride.id,
      driver_id: driver.id,
      dispatch_id: dispatch.id,
      mission_id: mission?.id || null
    },
    "system",
    ride.id
  );

  return {
    ride: updatedRide,
    mission: updatedMission
  };
}

async function runDispatchAttempt(rideId) {
  const ride = await getRideById(rideId);
  if (!ride) {
    const error = new Error("Ride not found.");
    error.statusCode = 404;
    throw error;
  }

  if (String(ride.status || "").toLowerCase() !== RIDE_STATUSES.SEARCHING) {
    return {
      ride,
      message: "Ride is not in searching state. Dispatch skipped."
    };
  }

  await requireAuthorizedPaymentForRide(ride.id);

  const mission = await getMissionByRideId(ride.id);
  const attempts = await getDispatchAttemptsForRide(ride.id);
  const openDispatch = await getOpenDispatchForRide(ride.id);

  if (openDispatch) {
    return {
      ride,
      mission,
      dispatch: openDispatch,
      message: "Open dispatch already exists."
    };
  }

  const excludedDriverIds = attempts.map((item) => item.driver_id).filter(Boolean);
  const attemptNumber = attempts.length + 1;

  if (attemptNumber > DISPATCH_MAX_ATTEMPTS) {
    const expiredRide = await updateRide(ride.id, {
      status: RIDE_STATUSES.EXPIRED
    });

    if (mission) {
      await updateMission(mission.id, {
        status: "expired"
      });
    }

    await createTripEvent(ride.id, "dispatch_exhausted", {
      attempts: attempts.length
    });

    await createAuditLog(
      "dispatch_exhausted",
      {
        ride_id: ride.id,
        attempts: attempts.length
      },
      "system",
      ride.id
    );

    return {
      ride: expiredRide,
      mission,
      message: "Dispatch attempts exhausted."
    };
  }

  const bestCandidate = await chooseBestDriverForRide(ride, excludedDriverIds);

  if (!bestCandidate) {
    if (
      ENABLE_AUTONOMOUS_MODE &&
      normalizeRequestedMode(ride.requested_mode) !== REQUESTED_MODES.AUTONOMOUS
    ) {
      const autonomousRide = await updateRide(ride.id, {
        requested_mode: REQUESTED_MODES.AUTONOMOUS
      });

      if (mission) {
        await updateMission(mission.id, {
          requested_mode: REQUESTED_MODES.AUTONOMOUS
        });
      }

      await createTripEvent(ride.id, "dispatch_switched_to_autonomous", {
        reason: "no_human_driver_found"
      });

      return {
        ride: autonomousRide,
        mission,
        message: "No human driver found. Ride switched to autonomous mode."
      };
    }

    await createTripEvent(ride.id, "dispatch_no_candidate_found", {
      attempt: attemptNumber
    });

    return {
      ride,
      mission,
      message: "No eligible dispatch candidate found."
    };
  }

  const dispatch = await createDispatchOffer({
    ride,
    mission,
    candidate: bestCandidate,
    attempt: attemptNumber
  });

  if (mission) {
    await updateMission(mission.id, {
      driver_id: bestCandidate.driver.id,
      status: "offered"
    });
  }

  const offeredRide = await updateRide(ride.id, {
    status: RIDE_STATUSES.OFFERED
  });

  return {
    ride: offeredRide,
    mission,
    dispatch,
    candidate: bestCandidate,
    message: "Dispatch offer created."
  };
}

async function runDispatchRetryLoop(rideId) {
  let lastResult = null;

  for (let i = 0; i < DISPATCH_MAX_ATTEMPTS; i += 1) {
    const ride = await getRideById(rideId);
    if (!ride) break;

    const status = String(ride.status || "").toLowerCase();
    if (
      [
        RIDE_STATUSES.ACCEPTED,
        RIDE_STATUSES.DRIVER_ASSIGNED,
        RIDE_STATUSES.DRIVER_ENROUTE,
        RIDE_STATUSES.DRIVER_ARRIVED,
        RIDE_STATUSES.TRIP_STARTED,
        RIDE_STATUSES.TRIP_COMPLETED,
        RIDE_STATUSES.CANCELLED,
        RIDE_STATUSES.EXPIRED
      ].includes(status)
    ) {
      return {
        ride,
        message: "Retry loop stopped because ride left dispatchable state."
      };
    }

    if (status === RIDE_STATUSES.SEARCHING) {
      lastResult = await runDispatchAttempt(rideId);
    } else if (status === RIDE_STATUSES.OFFERED) {
      const openDispatch = await getOpenDispatchForRide(rideId);

      if (!openDispatch) {
        await updateRide(rideId, { status: RIDE_STATUSES.SEARCHING });
      } else {
        const expiresAt = new Date(openDispatch.expires_at).getTime();
        if (expiresAt && Date.now() > expiresAt) {
          await expireDispatch(openDispatch.id, "offer_timeout");
          await updateRide(rideId, { status: RIDE_STATUSES.SEARCHING });
        } else {
          return {
            ride: await getRideById(rideId),
            dispatch: openDispatch,
            message: "Active dispatch offer still pending."
          };
        }
      }
    }
  }

  return (
    lastResult || {
      ride: await getRideById(rideId),
      message: "Dispatch retry loop completed."
    }
  );
}

/* =========================================================
   DRIVER OPS
========================================================= */
app.post(
  "/api/driver/:driverId/availability",
  asyncHandler(async (req, res) => {
    const driver = await getDriverById(req.params.driverId);
    if (!driver) {
      return fail(res, 404, "Driver not found.");
    }

    const isAvailable =
      req.body?.is_available === true ||
      String(req.body?.availability_status || "").toLowerCase() === "available";

    const { data, error } = await supabase
      .from("drivers")
      .update({
        is_available: isAvailable,
        availability_status: isAvailable ? "available" : "offline",
        last_seen_at: nowIso(),
        updated_at: nowIso()
      })
      .eq("id", driver.id)
      .select()
      .single();

    if (error) throw error;

    await createAuditLog(
      "driver_availability_updated",
      {
        driver_id: driver.id,
        is_available: isAvailable
      },
      "driver",
      driver.id
    );

    return ok(res, {
      message: "Driver availability updated.",
      driver: sanitizeDriver(data)
    });
  })
);

app.post(
  "/api/driver/:driverId/location",
  asyncHandler(async (req, res) => {
    const driver = await getDriverById(req.params.driverId);
    if (!driver) {
      return fail(res, 404, "Driver not found.");
    }

    const latitude = Number(req.body?.latitude);
    const longitude = Number(req.body?.longitude);

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return fail(res, 400, "latitude and longitude are required.");
    }

    const { data, error } = await supabase
      .from("driver_locations")
      .insert({
        id: uuid(),
        driver_id: driver.id,
        latitude,
        longitude,
        created_at: nowIso(),
        updated_at: nowIso()
      })
      .select()
      .single();

    if (error) throw error;

    await supabase
      .from("drivers")
      .update({
        last_seen_at: nowIso(),
        updated_at: nowIso()
      })
      .eq("id", driver.id);

    return ok(res, {
      message: "Driver location updated.",
      location: data
    });
  })
);

/* =========================================================
   DISPATCH ROUTES
========================================================= */
app.post(
  "/api/rides/:rideId/dispatch",
  asyncHandler(async (req, res) => {
    const result = await runDispatchAttempt(req.params.rideId);

    return ok(res, {
      message: result.message,
      ride: result.ride || null,
      mission: result.mission || null,
      dispatch: result.dispatch || null,
      candidate: result.candidate
        ? {
            driver: sanitizeDriver(result.candidate.driver),
            distance_miles: result.candidate.distance_miles,
            idle_minutes: result.candidate.idle_minutes,
            score: result.candidate.score
          }
        : null
    });
  })
);

app.post(
  "/api/rides/:rideId/dispatch/retry",
  asyncHandler(async (req, res) => {
    const result = await runDispatchRetryLoop(req.params.rideId);

    return ok(res, {
      message: result.message,
      ride: result.ride || null,
      dispatch: result.dispatch || null
    });
  })
);

app.get(
  "/api/driver/:driverId/missions",
  asyncHandler(async (req, res) => {
    const driver = await getDriverById(req.params.driverId);
    if (!driver) {
      return fail(res, 404, "Driver not found.");
    }

    const { data, error } = await supabase
      .from("dispatches")
      .select("*")
      .eq("driver_id", driver.id)
      .in("status", ["offered", "accepted"])
      .order("created_at", { ascending: false });

    if (error) throw error;

    const missions = [];

    for (const dispatch of data || []) {
      const ride = await getRideById(dispatch.ride_id);
      const mission = dispatch.mission_id
        ? await (async () => {
            const { data: missionData, error: missionError } = await supabase
              .from("missions")
              .select("*")
              .eq("id", dispatch.mission_id)
              .maybeSingle();

            if (missionError) throw missionError;
            return missionData || null;
          })()
        : null;

      missions.push({
        dispatch,
        ride,
        mission
      });
    }

    return ok(res, {
      driver_id: driver.id,
      missions
    });
  })
);

app.get(
  "/api/drivers/:driverId/current-mission",
  asyncHandler(async (req, res) => {
    const driver = await getDriverById(req.params.driverId);
    if (!driver) {
      return fail(res, 404, "Driver not found.");
    }

    const openDispatch = await getOpenDispatchForDriver(driver.id);

    if (!openDispatch) {
      return ok(res, {
        driver_id: driver.id,
        mission: null
      });
    }

    const mission = openDispatch.mission_id
      ? await (async () => {
          const { data, error } = await supabase
            .from("missions")
            .select("*")
            .eq("id", openDispatch.mission_id)
            .maybeSingle();

          if (error) throw error;
          return data || null;
        })()
      : null;

    return ok(res, {
      driver_id: driver.id,
      mission,
      dispatch: openDispatch
    });
  })
);

app.post(
  "/api/dispatch/:dispatchId/accept",
  asyncHandler(async (req, res) => {
    const dispatch = await getDispatchById(req.params.dispatchId);
    if (!dispatch) {
      return fail(res, 404, "Dispatch not found.");
    }

    if (!["offered", "sent"].includes(String(dispatch.status || "").toLowerCase())) {
      return fail(res, 400, "Dispatch is not available to accept.");
    }

    const expiresAt = dispatch.expires_at ? new Date(dispatch.expires_at).getTime() : 0;
    if (expiresAt && Date.now() > expiresAt) {
      await expireDispatch(dispatch.id, "offer_timeout_before_accept");
      return fail(res, 400, "Dispatch offer has expired.");
    }

    const ride = await getRideById(dispatch.ride_id);
    if (!ride) {
      return fail(res, 404, "Ride not found.");
    }

    const driver = await getDriverById(dispatch.driver_id);
    if (!driver) {
      return fail(res, 404, "Driver not found.");
    }

    const mission = dispatch.mission_id
      ? await (async () => {
          const { data, error } = await supabase
            .from("missions")
            .select("*")
            .eq("id", dispatch.mission_id)
            .maybeSingle();

          if (error) throw error;
          return data || null;
        })()
      : null;

    const assigned = await assignDriverToRide({
      ride,
      driver,
      dispatch,
      mission
    });

    return ok(res, {
      message: "Dispatch accepted and driver assigned.",
      dispatch_id: dispatch.id,
      ride: assigned.ride,
      mission: assigned.mission,
      driver: sanitizeDriver(driver)
    });
  })
);

app.post(
  "/api/dispatch/:dispatchId/decline",
  asyncHandler(async (req, res) => {
    const dispatch = await getDispatchById(req.params.dispatchId);
    if (!dispatch) {
      return fail(res, 404, "Dispatch not found.");
    }

    const reason = cleanEnv(req.body?.reason || "declined_by_driver");

    const updated = await declineDispatch(dispatch.id, reason);
    await updateRide(updated.ride_id, {
      status: RIDE_STATUSES.SEARCHING
    });

    const retryResult = await runDispatchAttempt(updated.ride_id);

    return ok(res, {
      message: "Dispatch declined. Re-dispatch attempted.",
      dispatch: updated,
      next_dispatch: retryResult.dispatch || null,
      ride: retryResult.ride || null
    });
  })
);

app.post(
  "/api/dispatch/:dispatchId/expire",
  asyncHandler(async (req, res) => {
    const dispatch = await getDispatchById(req.params.dispatchId);
    if (!dispatch) {
      return fail(res, 404, "Dispatch not found.");
    }

    const updated = await expireDispatch(dispatch.id, "manual_expire");
    await updateRide(updated.ride_id, {
      status: RIDE_STATUSES.SEARCHING
    });

    const retryResult = await runDispatchAttempt(updated.ride_id);

    return ok(res, {
      message: "Dispatch expired. Re-dispatch attempted.",
      dispatch: updated,
      next_dispatch: retryResult.dispatch || null,
      ride: retryResult.ride || null
    });
  })
);

/* =========================================================
   ADMIN DISPATCH VISIBILITY
========================================================= */
app.get(
  "/api/admin/dispatches/open",
  asyncHandler(async (req, res) => {
    const { data, error } = await supabase
      .from("dispatches")
      .select("*")
      .in("status", ["offered", "sent"])
      .order("created_at", { ascending: false });

    if (error) throw error;

    return ok(res, {
      dispatches: data || []
    });
  })
);

app.get(
  "/api/admin/rides/searching",
  asyncHandler(async (req, res) => {
    const { data, error } = await supabase
      .from("rides")
      .select("*")
      .in("status", [RIDE_STATUSES.SEARCHING, RIDE_STATUSES.OFFERED])
      .order("created_at", { ascending: false });

    if (error) throw error;

    return ok(res, {
      rides: data || []
    });
  })
);/* =========================================================
   EARNINGS / PAYOUT HELPERS
========================================================= */
async function getDriverLedger(driverId) {
  ensureSupabase();

  const { data, error } = await supabase
    .from("driver_earnings_ledger")
    .select("*")
    .eq("driver_id", driverId)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data || [];
}

function sumLedgerAmounts(entries, type = null, status = null) {
  return dollars(
    (entries || [])
      .filter((entry) => {
        const typeOk = type
          ? String(entry.entry_type || "").toLowerCase() === String(type).toLowerCase()
          : true;
        const statusOk = status
          ? String(entry.status || "").toLowerCase() === String(status).toLowerCase()
          : true;
        return typeOk && statusOk;
      })
      .reduce((sum, entry) => sum + Number(entry.amount || 0), 0)
  );
}

async function createPayoutRecord({
  driver_id,
  amount,
  payout_method = "manual",
  status = "pending",
  ride_id = null,
  ledger_entry_id = null,
  notes = ""
}) {
  ensureSupabase();

  const payload = {
    id: uuid(),
    driver_id,
    ride_id,
    ledger_entry_id,
    amount: dollars(amount),
    payout_method: cleanEnv(payout_method || "manual").toLowerCase(),
    status: cleanEnv(status || "pending").toLowerCase(),
    notes: cleanEnv(notes),
    created_at: nowIso(),
    updated_at: nowIso()
  };

  const { data, error } = await supabase
    .from("driver_payouts")
    .insert(payload)
    .select()
    .single();

  if (error) throw error;
  return data;
}

/* =========================================================
   SUPPORT / INCIDENT HELPERS
========================================================= */
async function createSupportCase({
  ride_id = null,
  rider_id = null,
  driver_id = null,
  case_type = "general",
  priority = "normal",
  subject = "",
  description = "",
  status = "open",
  created_by_type = "system",
  created_by_id = null,
  metadata = {}
}) {
  ensureSupabase();

  const payload = {
    id: uuid(),
    ride_id,
    rider_id,
    driver_id,
    case_type: cleanEnv(case_type || "general").toLowerCase(),
    priority: cleanEnv(priority || "normal").toLowerCase(),
    subject: cleanEnv(subject),
    description: String(description || "").trim(),
    status: cleanEnv(status || "open").toLowerCase(),
    created_by_type: cleanEnv(created_by_type || "system").toLowerCase(),
    created_by_id: created_by_id || null,
    metadata,
    created_at: nowIso(),
    updated_at: nowIso()
  };

  const { data, error } = await supabase
    .from("support_cases")
    .insert(payload)
    .select()
    .single();

  if (error) throw error;
  return data;
}

async function updateSupportCase(caseId, patch) {
  ensureSupabase();

  const { data, error } = await supabase
    .from("support_cases")
    .update({
      ...patch,
      updated_at: nowIso()
    })
    .eq("id", caseId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

async function createIncidentReport({
  ride_id = null,
  rider_id = null,
  driver_id = null,
  incident_type = "general",
  severity = "medium",
  summary = "",
  details = "",
  reported_by_type = "system",
  reported_by_id = null,
  status = "open",
  metadata = {}
}) {
  ensureSupabase();

  const payload = {
    id: uuid(),
    ride_id,
    rider_id,
    driver_id,
    incident_type: cleanEnv(incident_type || "general").toLowerCase(),
    severity: cleanEnv(severity || "medium").toLowerCase(),
    summary: cleanEnv(summary),
    details: String(details || "").trim(),
    reported_by_type: cleanEnv(reported_by_type || "system").toLowerCase(),
    reported_by_id: reported_by_id || null,
    status: cleanEnv(status || "open").toLowerCase(),
    metadata,
    created_at: nowIso(),
    updated_at: nowIso()
  };

  const { data, error } = await supabase
    .from("incident_reports")
    .insert(payload)
    .select()
    .single();

  if (error) throw error;
  return data;
}

async function updateIncidentReport(reportId, patch) {
  ensureSupabase();

  const { data, error } = await supabase
    .from("incident_reports")
    .update({
      ...patch,
      updated_at: nowIso()
    })
    .eq("id", reportId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

/* =========================================================
   AI SUPPORT HELPERS
========================================================= */
function buildSupportSystemPrompt(pageContext = "general") {
  const pageGuidance = {
    homepage:
      "You are helping on the Harvey Taxi home screen. Focus on what Harvey Taxi is, how riders request rides, how drivers sign up, the nonprofit mission, and autonomous pilot labeling.",
    rider_signup:
      "You are helping on the rider signup page. Focus on rider onboarding, approval, verification, and next steps before ride access.",
    driver_signup:
      "You are helping on the driver signup page. Focus on driver onboarding, email verification, SMS verification, identity review, and activation steps.",
    request_ride:
      "You are helping on the request ride page. Focus on fare estimate, payment authorization, dispatch flow, ride status, and support.",
    driver_dashboard:
      "You are helping on the driver dashboard. Focus on missions, trip flow, verification, earnings, payouts, and support.",
    admin_dashboard:
      "You are helping on the admin dashboard. Focus on dispatch operations, incidents, support, analytics, and system guidance.",
    support_center:
      "You are helping in the support center. Focus on support issues, ride help, onboarding help, and escalation guidance."
  };

  return `
You are Harvey AI Support for Harvey Taxi.

Rules:
- Be clear, calm, and helpful.
- Do not invent account-specific facts you do not know.
- Do not claim a ride is active, assigned, or completed unless backend context confirms it.
- Do not say autonomous service is fully live unless explicitly confirmed.
- Distinguish clearly between Harvey Taxi Service LLC and Harvey Transportation Assistance Foundation.
- If there is an emergency, instruct the user to contact local emergency services immediately.
- Keep answers practical and concise.

Mission Context:
${MISSION_KNOWLEDGE}

Page Guidance:
${pageGuidance[pageContext] || "Provide general Harvey Taxi support."}
  `.trim();
}

function sanitizeAiInput(text = "") {
  return String(text || "")
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
    .replace(/ignore previous instructions/gi, "")
    .replace(/system prompt/gi, "")
    .trim()
    .slice(0, 4000);
}

async function generateAiSupportReply({
  message,
  pageContext = "general",
  rider = null,
  driver = null,
  ride = null
}) {
  const fallbackOffline =
    "Harvey AI is temporarily unavailable. Please try again shortly or use the support page.";
  const fallbackQuota =
    "Harvey AI is temporarily busy right now. Please try again shortly or use the support page.";
  const fallbackNoKey =
    "Harvey AI is currently offline while AI service is being configured. Please use the support page for help.";

  if (!OpenAI || !OPENAI_API_KEY || !openai) {
    return {
      enabled: false,
      reply: fallbackNoKey
    };
  }

  const safeMessage = sanitizeAiInput(message);

  const contextBlock = {
    rider: rider
      ? {
          id: rider.id,
          first_name: rider.first_name,
          verification_status: rider.verification_status
        }
      : null,
    driver: driver
      ? {
          id: driver.id,
          first_name: driver.first_name,
          verification_status: driver.verification_status,
          driver_type: driver.driver_type
        }
      : null,
    ride: ride
      ? {
          id: ride.id,
          status: ride.status,
          payment_status: ride.payment_status,
          requested_mode: ride.requested_mode
        }
      : null
  };

  try {
    const completion = await openai.chat.completions.create({
      model: OPENAI_SUPPORT_MODEL,
      temperature: 0.3,
      messages: [
        {
          role: "system",
          content: buildSupportSystemPrompt(pageContext)
        },
        {
          role: "system",
          content: `Known session context: ${JSON.stringify(contextBlock)}`
        },
        {
          role: "user",
          content: safeMessage
        }
      ]
    });

    const reply =
      completion?.choices?.[0]?.message?.content?.trim() ||
      "I’m here to help with Harvey Taxi support.";

    return {
      enabled: true,
      reply
    };
  } catch (error) {
    const statusCode = Number(error?.status || error?.statusCode || 0);
    const errorMessage = String(error?.message || "Unknown AI error");

    console.error("AI SUPPORT ERROR:", {
      statusCode,
      message: errorMessage
    });

    if (statusCode === 429 || /quota/i.test(errorMessage) || /billing/i.test(errorMessage)) {
      return {
        enabled: true,
        reply: fallbackQuota
      };
    }

    return {
      enabled: true,
      reply: fallbackOffline
    };
  }
}

/* =========================================================
   DRIVER EARNINGS / PAYOUT ROUTES
========================================================= */
app.get(
  "/api/driver/:driverId/earnings",
  asyncHandler(async (req, res) => {
    const driver = await getDriverById(req.params.driverId);

    if (!driver) {
      return fail(res, 404, "Driver not found.");
    }

    const ledger = await getDriverLedger(driver.id);

    return ok(res, {
      driver_id: driver.id,
      totals: {
        gross_earned: sumLedgerAmounts(ledger),
        ride_payouts_earned: sumLedgerAmounts(ledger, "ride_payout"),
        tips_earned: sumLedgerAmounts(ledger, "tip"),
        paid_out: sumLedgerAmounts(ledger, null, "paid"),
        pending: sumLedgerAmounts(ledger, null, "pending"),
        earned_unpaid: sumLedgerAmounts(ledger, null, "earned")
      },
      ledger
    });
  })
);

app.get(
  "/api/driver/:driverId/payouts",
  asyncHandler(async (req, res) => {
    const driver = await getDriverById(req.params.driverId);

    if (!driver) {
      return fail(res, 404, "Driver not found.");
    }

    const { data, error } = await supabase
      .from("driver_payouts")
      .select("*")
      .eq("driver_id", driver.id)
      .order("created_at", { ascending: false });

    if (error) throw error;

    return ok(res, {
      driver_id: driver.id,
      payouts: data || []
    });
  })
);

app.post(
  "/api/admin/payouts/:payoutId/mark-paid",
  asyncHandler(async (req, res) => {
    const { data: payout, error: payoutError } = await supabase
      .from("driver_payouts")
      .select("*")
      .eq("id", req.params.payoutId)
      .maybeSingle();

    if (payoutError) throw payoutError;
    if (!payout) {
      return fail(res, 404, "Payout not found.");
    }

    const { data: updatedPayout, error: updateError } = await supabase
      .from("driver_payouts")
      .update({
        status: "paid",
        updated_at: nowIso()
      })
      .eq("id", payout.id)
      .select()
      .single();

    if (updateError) throw updateError;

    if (payout.ledger_entry_id) {
      await supabase
        .from("driver_earnings_ledger")
        .update({
          status: "paid",
          updated_at: nowIso()
        })
        .eq("id", payout.ledger_entry_id);
    }

    await createAuditLog(
      "driver_payout_marked_paid",
      {
        payout_id: payout.id,
        driver_id: payout.driver_id,
        amount: payout.amount
      },
      "admin",
      payout.driver_id
    );

    return ok(res, {
      message: "Driver payout marked paid.",
      payout: updatedPayout
    });
  })
);

/* =========================================================
   SUPPORT CASE ROUTES
========================================================= */
app.post(
  "/api/support/cases",
  asyncHandler(async (req, res) => {
    const description = String(req.body?.description || "").trim();

    if (!description) {
      return fail(res, 400, "description is required.");
    }

    const supportCase = await createSupportCase({
      ride_id: cleanEnv(req.body?.ride_id || req.body?.rideId || "") || null,
      rider_id: cleanEnv(req.body?.rider_id || req.body?.riderId || "") || null,
      driver_id: cleanEnv(req.body?.driver_id || req.body?.driverId || "") || null,
      case_type: cleanEnv(req.body?.case_type || req.body?.caseType || "general"),
      priority: cleanEnv(req.body?.priority || "normal"),
      subject: cleanEnv(req.body?.subject || "Support case"),
      description,
      created_by_type: cleanEnv(req.body?.created_by_type || "user"),
      created_by_id: cleanEnv(req.body?.created_by_id || "") || null,
      status: "open",
      metadata: safeJsonParse(req.body?.metadata, req.body?.metadata || {})
    });

    await createAuditLog(
      "support_case_created",
      {
        case_id: supportCase.id,
        ride_id: supportCase.ride_id,
        rider_id: supportCase.rider_id,
        driver_id: supportCase.driver_id,
        priority: supportCase.priority
      },
      supportCase.created_by_type,
      supportCase.created_by_id || supportCase.id
    );

    return ok(
      res,
      {
        message: "Support case created.",
        case: supportCase
      },
      201
    );
  })
);

app.get(
  "/api/support/cases",
  asyncHandler(async (req, res) => {
    const status = cleanEnv(req.query?.status || "");

    let query = supabase
      .from("support_cases")
      .select("*")
      .order("created_at", { ascending: false });

    if (status) {
      query = query.eq("status", status.toLowerCase());
    }

    const { data, error } = await query;
    if (error) throw error;

    return ok(res, {
      cases: data || []
    });
  })
);

app.post(
  "/api/support/cases/:caseId/update",
  asyncHandler(async (req, res) => {
    const { data: existing, error: existingError } = await supabase
      .from("support_cases")
      .select("*")
      .eq("id", req.params.caseId)
      .maybeSingle();

    if (existingError) throw existingError;
    if (!existing) {
      return fail(res, 404, "Support case not found.");
    }

    const patch = {};
    const status = cleanEnv(req.body?.status || "");
    const priority = cleanEnv(req.body?.priority || "");
    const internal_note = String(req.body?.internal_note || "").trim();

    if (status) patch.status = status.toLowerCase();
    if (priority) patch.priority = priority.toLowerCase();

    patch.metadata = {
      ...(existing.metadata || {}),
      internal_note: internal_note || existing.metadata?.internal_note || ""
    };

    const updated = await updateSupportCase(existing.id, patch);

    await createAuditLog(
      "support_case_updated",
      {
        case_id: updated.id,
        status: updated.status,
        priority: updated.priority
      },
      "admin",
      updated.id
    );

    return ok(res, {
      message: "Support case updated.",
      case: updated
    });
  })
);

/* =========================================================
   INCIDENT / EMERGENCY ROUTES
========================================================= */
app.post(
  "/api/incidents/report",
  asyncHandler(async (req, res) => {
    const details = String(req.body?.details || "").trim();

    if (!details) {
      return fail(res, 400, "details are required.");
    }

    const report = await createIncidentReport({
      ride_id: cleanEnv(req.body?.ride_id || req.body?.rideId || "") || null,
      rider_id: cleanEnv(req.body?.rider_id || req.body?.riderId || "") || null,
      driver_id: cleanEnv(req.body?.driver_id || req.body?.driverId || "") || null,
      incident_type: cleanEnv(req.body?.incident_type || req.body?.incidentType || "general"),
      severity: cleanEnv(req.body?.severity || "medium"),
      summary: cleanEnv(req.body?.summary || "Incident reported"),
      details,
      reported_by_type: cleanEnv(req.body?.reported_by_type || "user"),
      reported_by_id: cleanEnv(req.body?.reported_by_id || "") || null,
      status: "open",
      metadata: safeJsonParse(req.body?.metadata, req.body?.metadata || {})
    });

    if (report.ride_id) {
      await createTripEvent(report.ride_id, "incident_reported", {
        incident_report_id: report.id,
        incident_type: report.incident_type,
        severity: report.severity
      });
    }

    await createAuditLog(
      "incident_report_created",
      {
        incident_report_id: report.id,
        ride_id: report.ride_id,
        rider_id: report.rider_id,
        driver_id: report.driver_id,
        severity: report.severity
      },
      report.reported_by_type,
      report.reported_by_id || report.id
    );

    return ok(
      res,
      {
        message: "Incident report created.",
        report
      },
      201
    );
  })
);

app.get(
  "/api/incidents",
  asyncHandler(async (req, res) => {
    const status = cleanEnv(req.query?.status || "");
    const severity = cleanEnv(req.query?.severity || "");

    let query = supabase
      .from("incident_reports")
      .select("*")
      .order("created_at", { ascending: false });

    if (status) query = query.eq("status", status.toLowerCase());
    if (severity) query = query.eq("severity", severity.toLowerCase());

    const { data, error } = await query;
    if (error) throw error;

    return ok(res, {
      incidents: data || []
    });
  })
);

app.post(
  "/api/incidents/:reportId/update",
  asyncHandler(async (req, res) => {
    const { data: existing, error: existingError } = await supabase
      .from("incident_reports")
      .select("*")
      .eq("id", req.params.reportId)
      .maybeSingle();

    if (existingError) throw existingError;
    if (!existing) {
      return fail(res, 404, "Incident report not found.");
    }

    const patch = {};
    const status = cleanEnv(req.body?.status || "");
    const severity = cleanEnv(req.body?.severity || "");
    const resolution_note = String(req.body?.resolution_note || "").trim();

    if (status) patch.status = status.toLowerCase();
    if (severity) patch.severity = severity.toLowerCase();

    patch.metadata = {
      ...(existing.metadata || {}),
      resolution_note: resolution_note || existing.metadata?.resolution_note || ""
    };

    const updated = await updateIncidentReport(existing.id, patch);

    await createAuditLog(
      "incident_report_updated",
      {
        incident_report_id: updated.id,
        status: updated.status,
        severity: updated.severity
      },
      "admin",
      updated.id
    );

    return ok(res, {
      message: "Incident report updated.",
      report: updated
    });
  })
);

app.post(
  "/api/rides/:rideId/emergency",
  asyncHandler(async (req, res) => {
    const ride = await getRideById(req.params.rideId);

    if (!ride) {
      return fail(res, 404, "Ride not found.");
    }

    const reporter_type = cleanEnv(req.body?.reporter_type || "user");
    const reporter_id = cleanEnv(req.body?.reporter_id || "");
    const details = String(
      req.body?.details || "Emergency escalation triggered from trip flow."
    ).trim();

    const incident = await createIncidentReport({
      ride_id: ride.id,
      rider_id: ride.rider_id || null,
      driver_id: ride.driver_id || null,
      incident_type: "emergency",
      severity: "critical",
      summary: "Emergency escalation triggered",
      details,
      reported_by_type: reporter_type,
      reported_by_id: reporter_id || null,
      status: "open",
      metadata: {
        escalation_source: "trip_emergency_button"
      }
    });

    if (ride.driver_id) {
      await supabase
        .from("drivers")
        .update({
          is_available: false,
          availability_status: "paused_emergency",
          updated_at: nowIso()
        })
        .eq("id", ride.driver_id);
    }

    await createTripEvent(ride.id, "emergency_escalated", {
      incident_report_id: incident.id,
      reporter_type
    });

    await createAuditLog(
      "ride_emergency_escalated",
      {
        ride_id: ride.id,
        incident_report_id: incident.id,
        rider_id: ride.rider_id,
        driver_id: ride.driver_id
      },
      reporter_type,
      reporter_id || ride.id
    );

    return ok(
      res,
      {
        message: "Emergency escalation recorded.",
        emergency: {
          incident_report_id: incident.id,
          ride_id: ride.id,
          severity: "critical",
          recommended_action:
            "Contact emergency services immediately if there is immediate danger."
        }
      },
      201
    );
  })
);

/* =========================================================
   ADMIN ANALYTICS
========================================================= */
app.get(
  "/api/admin/analytics/overview",
  asyncHandler(async (req, res) => {
    const [ridesResult, driversResult, ridersResult, payoutsResult, ledgerResult] =
      await Promise.all([
        supabase.from("rides").select("*"),
        supabase.from("drivers").select("*"),
        supabase.from("riders").select("*"),
        supabase.from("driver_payouts").select("*"),
        supabase.from("driver_earnings_ledger").select("*")
      ]);

    if (ridesResult.error) throw ridesResult.error;
    if (driversResult.error) throw driversResult.error;
    if (ridersResult.error) throw ridersResult.error;
    if (payoutsResult.error) throw payoutsResult.error;
    if (ledgerResult.error) throw ledgerResult.error;

    const rides = ridesResult.data || [];
    const drivers = driversResult.data || [];
    const riders = ridersResult.data || [];
    const payouts = payoutsResult.data || [];
    const ledger = ledgerResult.data || [];

    const completedRides = rides.filter(
      (ride) => String(ride.status || "").toLowerCase() === RIDE_STATUSES.TRIP_COMPLETED
    );

    const activeRides = rides.filter((ride) =>
      [
        RIDE_STATUSES.SEARCHING,
        RIDE_STATUSES.OFFERED,
        RIDE_STATUSES.DRIVER_ASSIGNED,
        RIDE_STATUSES.DRIVER_ENROUTE,
        RIDE_STATUSES.DRIVER_ARRIVED,
        RIDE_STATUSES.TRIP_STARTED
      ].includes(String(ride.status || "").toLowerCase())
    );

    const verifiedRiders = riders.filter(
      (rider) =>
        String(rider.verification_status || "").toLowerCase() === VERIFICATION_STATUSES.VERIFIED
    );

    const verifiedDrivers = drivers.filter(
      (driver) =>
        String(driver.verification_status || "").toLowerCase() === VERIFICATION_STATUSES.VERIFIED
    );

    return ok(res, {
      totals: {
        rides_total: rides.length,
        rides_completed: completedRides.length,
        rides_active: activeRides.length,
        riders_total: riders.length,
        riders_verified: verifiedRiders.length,
        drivers_total: drivers.length,
        drivers_verified: verifiedDrivers.length,
        gross_fare_estimate: dollars(
          completedRides.reduce((sum, ride) => sum + Number(ride.fare_estimate || 0), 0)
        ),
        driver_payouts_estimate: dollars(
          completedRides.reduce(
            (sum, ride) => sum + Number(ride.driver_payout_estimate || 0),
            0
          )
        ),
        platform_fee_estimate: dollars(
          completedRides.reduce(
            (sum, ride) => sum + Number(ride.platform_fee_estimate || 0),
            0
          )
        ),
        tips_total: sumLedgerAmounts(ledger, "tip"),
        payouts_paid_total: dollars(
          payouts
            .filter((p) => String(p.status || "").toLowerCase() === "paid")
            .reduce((sum, p) => sum + Number(p.amount || 0), 0)
        ),
        payouts_pending_total: dollars(
          payouts
            .filter((p) => String(p.status || "").toLowerCase() === "pending")
            .reduce((sum, p) => sum + Number(p.amount || 0), 0)
        )
      }
    });
  })
);

app.get(
  "/api/admin/analytics/live",
  asyncHandler(async (req, res) => {
    const { data: rides, error } = await supabase
      .from("rides")
      .select("*")
      .in("status", [
        RIDE_STATUSES.SEARCHING,
        RIDE_STATUSES.OFFERED,
        RIDE_STATUSES.DRIVER_ASSIGNED,
        RIDE_STATUSES.DRIVER_ENROUTE,
        RIDE_STATUSES.DRIVER_ARRIVED,
        RIDE_STATUSES.TRIP_STARTED
      ])
      .order("created_at", { ascending: false });

    if (error) throw error;

    return ok(res, {
      active_rides: rides || []
    });
  })
);

/* =========================================================
   AI SUPPORT ROUTE
========================================================= */
app.post(
  "/api/ai/support",
  asyncHandler(async (req, res) => {
    const message = String(req.body?.message || "").trim();
    const pageContext = cleanEnv(req.body?.pageContext || "general");
    const riderId = cleanEnv(req.body?.rider_id || req.body?.riderId || "");
    const driverId = cleanEnv(req.body?.driver_id || req.body?.driverId || "");
    const rideId = cleanEnv(req.body?.ride_id || req.body?.rideId || "");

    if (!message) {
      return fail(res, 400, "message is required.");
    }

    let rider = null;
    let driver = null;
    let ride = null;

    if (riderId) {
      try {
        rider = await getRiderById(riderId);
      } catch (error) {
        console.warn("AI support rider lookup failed:", error.message);
      }
    }

    if (driverId) {
      try {
        driver = await getDriverById(driverId);
      } catch (error) {
        console.warn("AI support driver lookup failed:", error.message);
      }
    }

    if (rideId) {
      try {
        ride = await getRideById(rideId);
      } catch (error) {
        console.warn("AI support ride lookup failed:", error.message);
      }
    }

    const ai = await generateAiSupportReply({
      message,
      pageContext,
      rider,
      driver,
      ride
    });

    return ok(res, {
      message: "AI support response generated.",
      ai
    });
  })
);

/* =========================================================
   FINAL ERROR HANDLER
========================================================= */
app.use((error, req, res, next) => {
  console.error("SERVER ERROR:", {
    message: error?.message,
    stack: error?.stack,
    statusCode: error?.statusCode || 500,
    details: error?.details || null
  });

  return fail(
    res,
    Number(error?.statusCode || 500),
    error?.message || "Internal server error.",
    error?.details ? { details: error.details } : {}
  );
});

/* =========================================================
   SERVER START
========================================================= */
app.listen(PORT, () => {
  console.log(
    `${APP_NAME} server running on port ${PORT} | version=${APP_VERSION}`
  );
});

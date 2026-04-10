const express = require("express");
const cors = require("cors");
const path = require("path");
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");

const app = express();
const PORT = Number(process.env.PORT || 10000);

/* =========================================================
   CORE APP
========================================================= */
app.use(
  cors({
    origin: true,
    credentials: true
  })
);
app.use(express.json({ limit: "2mb" }));
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

function nowIso() {
  return new Date().toISOString();
}

function randomDigits(length = 6) {
  let out = "";
  while (out.length < length) {
    out += Math.floor(Math.random() * 10);
  }
  return out.slice(0, length);
}

function uid(prefix = "id") {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}

function safeLower(value = "") {
  return String(value || "").trim().toLowerCase();
}

function normalizePhone(value = "") {
  return String(value || "").replace(/[^\d+]/g, "").trim();
}

function normalizeEmail(value = "") {
  return String(value || "").trim().toLowerCase();
}

function hashValue(value = "") {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function redactPhone(phone = "") {
  const p = normalizePhone(phone);
  if (p.length < 4) return "****";
  return `${"*".repeat(Math.max(0, p.length - 4))}${p.slice(-4)}`;
}

function redactEmail(email = "") {
  const e = normalizeEmail(email);
  const [name, domain] = e.split("@");
  if (!name || !domain) return "hidden";
  const visible = name.slice(0, 2);
  return `${visible}${"*".repeat(Math.max(0, name.length - 2))}@${domain}`;
}

function createToken(bytes = 24) {
  return crypto.randomBytes(bytes).toString("hex");
}

function isEmail(value = "") {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

function isTruthyText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

/* =========================================================
   ENV
========================================================= */
const SUPABASE_URL = cleanEnv(process.env.SUPABASE_URL);
const SUPABASE_SERVICE_ROLE_KEY = cleanEnv(process.env.SUPABASE_SERVICE_ROLE_KEY);

const ADMIN_EMAIL = normalizeEmail(process.env.ADMIN_EMAIL);
const ADMIN_PASSWORD = cleanEnv(process.env.ADMIN_PASSWORD);

const GOOGLE_MAPS_API_KEY = cleanEnv(process.env.GOOGLE_MAPS_API_KEY);

const OPENAI_API_KEY = cleanEnv(process.env.OPENAI_API_KEY);
const OPENAI_SUPPORT_MODEL = cleanEnv(process.env.OPENAI_SUPPORT_MODEL || "gpt-4o-mini");

const PUBLIC_APP_URL = cleanEnv(process.env.PUBLIC_APP_URL);
const RENDER_EXTERNAL_URL = cleanEnv(process.env.RENDER_EXTERNAL_URL);
const APP_BASE_URL = cleanEnv(process.env.APP_BASE_URL);

const SEND_REAL_EMAIL = toBool(process.env.SEND_REAL_EMAIL, false);
const SEND_REAL_SMS = toBool(process.env.SEND_REAL_SMS, false);

const TWILIO_ACCOUNT_SID = cleanEnv(process.env.TWILIO_ACCOUNT_SID);
const TWILIO_AUTH_TOKEN = cleanEnv(process.env.TWILIO_AUTH_TOKEN);
const TWILIO_FROM_NUMBER = cleanEnv(process.env.TWILIO_FROM_NUMBER);

const RESEND_API_KEY = cleanEnv(process.env.RESEND_API_KEY);
const EMAIL_FROM = cleanEnv(process.env.EMAIL_FROM || "Harvey Taxi <no-reply@harveytaxiservice.com>");

const DEFAULT_SUPPORT_EMAIL = cleanEnv(
  process.env.DEFAULT_SUPPORT_EMAIL || "support@harveytaxiservice.com"
);

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false
  }
});

/* =========================================================
   CONSTANTS
========================================================= */
const DISPATCH_OFFER_TIMEOUT_MS = toNumber(process.env.DISPATCH_OFFER_TIMEOUT_MS, 20000);
const MAX_DISPATCH_ATTEMPTS = toNumber(process.env.MAX_DISPATCH_ATTEMPTS, 3);

const BASE_FARE = toNumber(process.env.BASE_FARE, 4.5);
const PER_MILE_FARE = toNumber(process.env.PER_MILE_FARE, 1.9);
const PER_MINUTE_FARE = toNumber(process.env.PER_MINUTE_FARE, 0.35);
const BOOKING_FEE = toNumber(process.env.BOOKING_FEE, 2.5);
const MINIMUM_FARE = toNumber(process.env.MINIMUM_FARE, 9.5);
const SURGE_MULTIPLIER = toNumber(process.env.SURGE_MULTIPLIER, 1);

const DRIVER_PAYOUT_PERCENT = toNumber(process.env.DRIVER_PAYOUT_PERCENT, 0.75);
const AUTONOMOUS_PAYOUT_PERCENT = toNumber(process.env.AUTONOMOUS_PAYOUT_PERCENT, 0.85);

const RIDE_TYPE_MULTIPLIERS = {
  standard: 1,
  scheduled: 1.08,
  airport: 1.16,
  medical: 1.05,
  nonprofit: 0.92
};

const REQUEST_MODES = {
  DRIVER: "driver",
  AUTONOMOUS: "autonomous"
};

/* =========================================================
   IN-MEMORY FALLBACK STORES
   Used for verification tokens / ephemeral offer tracking
========================================================= */
const memoryStore = {
  emailVerifications: new Map(), // token -> { driverId, email, expiresAt }
  smsVerifications: new Map(), // driverId -> { code, phone, expiresAt }
  dispatchOffers: new Map() // rideId -> { driverId, expiresAt, attempts }
};

/* =========================================================
   DB HELPERS
========================================================= */
async function trySingle(queryPromise) {
  const { data, error } = await queryPromise;
  if (error) throw error;
  return data;
}

async function getRiderById(riderId) {
  return trySingle(
    supabase.from("riders").select("*").eq("id", riderId).maybeSingle()
  );
}

async function getDriverById(driverId) {
  return trySingle(
    supabase.from("drivers").select("*").eq("id", driverId).maybeSingle()
  );
}

async function getRideById(rideId) {
  return trySingle(
    supabase.from("rides").select("*").eq("id", rideId).maybeSingle()
  );
}

async function getLatestAuthorizedPaymentForRider(riderId) {
  const { data, error } = await supabase
    .from("payments")
    .select("*")
    .eq("rider_id", riderId)
    .eq("status", "authorized")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

async function logAdminEvent(type, message, metadata = {}) {
  try {
    await supabase.from("admin_logs").insert({
      id: uid("log"),
      type,
      message,
      metadata,
      created_at: nowIso()
    });
  } catch (error) {
    console.error("logAdminEvent failed:", error.message);
  }
}

/* =========================================================
   SCHEMA SAFETY / TABLE BOOTSTRAP CHECK
========================================================= */
async function verifyTables() {
  const tableChecks = [
    "riders",
    "drivers",
    "rides",
    "payments",
    "missions",
    "dispatches",
    "admin_logs"
  ];

  const results = [];

  for (const table of tableChecks) {
    try {
      const { error } = await supabase.from(table).select("*").limit(1);
      results.push({ table, ok: !error, error: error ? error.message : null });
    } catch (err) {
      results.push({ table, ok: false, error: err.message });
    }
  }

  return results;
}

/* =========================================================
   MAP / GEOCODE HELPERS
========================================================= */
async function geocodeAddress(address) {
  if (!isTruthyText(address)) {
    throw new Error("Address is required.");
  }

  if (!GOOGLE_MAPS_API_KEY) {
    return {
      formatted_address: address,
      location: null,
      provider: "fallback-no-google"
    };
  }

  const endpoint = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(
    address
  )}&key=${encodeURIComponent(GOOGLE_MAPS_API_KEY)}`;

  const response = await fetch(endpoint);
  const json = await response.json();

  if (!response.ok) {
    throw new Error(`Geocode request failed with status ${response.status}`);
  }

  if (json.status !== "OK" || !Array.isArray(json.results) || !json.results[0]) {
    throw new Error(`Geocode failed for address: ${address}`);
  }

  return {
    formatted_address: json.results[0].formatted_address || address,
    location: json.results[0].geometry?.location || null,
    provider: "google"
  };
}

function haversineMiles(lat1, lng1, lat2, lng2) {
  if (
    ![lat1, lng1, lat2, lng2].every((n) => typeof n === "number" && Number.isFinite(n))
  ) {
    return null;
  }

  const R = 3958.8;
  const toRad = (deg) => (deg * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) ** 2;

  const c = 2 * Math.asin(Math.sqrt(a));
  return R * c;
}

async function getRouteEstimate(pickupAddress, dropoffAddress) {
  const pickup = await geocodeAddress(pickupAddress);
  const dropoff = await geocodeAddress(dropoffAddress);

  if (GOOGLE_MAPS_API_KEY && pickup.location && dropoff.location) {
    const endpoint = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${encodeURIComponent(
      pickup.formatted_address
    )}&destinations=${encodeURIComponent(
      dropoff.formatted_address
    )}&key=${encodeURIComponent(GOOGLE_MAPS_API_KEY)}`;

    try {
      const response = await fetch(endpoint);
      const json = await response.json();

      const element = json?.rows?.[0]?.elements?.[0];
      if (response.ok && element?.status === "OK") {
        return {
          pickup_address: pickup.formatted_address,
          dropoff_address: dropoff.formatted_address,
          distance_miles: Number((element.distance.value / 1609.34).toFixed(2)),
          duration_minutes: Number((element.duration.value / 60).toFixed(0)),
          provider: "google"
        };
      }
    } catch (error) {
      console.error("Distance Matrix fallback:", error.message);
    }
  }

  const fallbackMiles =
    pickup.location && dropoff.location
      ? haversineMiles(
          pickup.location.lat,
          pickup.location.lng,
          dropoff.location.lat,
          dropoff.location.lng
        )
      : 6.5;

  const adjustedMiles = fallbackMiles ? Math.max(fallbackMiles * 1.2, 1.2) : 6.5;

  return {
    pickup_address: pickup.formatted_address,
    dropoff_address: dropoff.formatted_address,
    distance_miles: Number(adjustedMiles.toFixed(2)),
    duration_minutes: Math.max(8, Math.round(adjustedMiles * 2.8)),
    provider: "fallback-estimate"
  };
}

/* =========================================================
   FARE ENGINE
========================================================= */
function calculateFare({
  distanceMiles = 0,
  durationMinutes = 0,
  rideType = "standard",
  requestedMode = REQUEST_MODES.DRIVER,
  surgeMultiplier = SURGE_MULTIPLIER
}) {
  const typeKey = safeLower(rideType) || "standard";
  const modeKey = safeLower(requestedMode) || REQUEST_MODES.DRIVER;

  const rideTypeMultiplier = RIDE_TYPE_MULTIPLIERS[typeKey] || 1;
  const modeMultiplier = modeKey === REQUEST_MODES.AUTONOMOUS ? 1.18 : 1;

  const subtotal =
    BASE_FARE +
    distanceMiles * PER_MILE_FARE +
    durationMinutes * PER_MINUTE_FARE +
    BOOKING_FEE;

  const gross = Math.max(
    subtotal * rideTypeMultiplier * modeMultiplier * Math.max(1, surgeMultiplier),
    MINIMUM_FARE
  );

  const riderFare = Number(gross.toFixed(2));
  const payoutRate =
    modeKey === REQUEST_MODES.AUTONOMOUS
      ? AUTONOMOUS_PAYOUT_PERCENT
      : DRIVER_PAYOUT_PERCENT;

  const driverPayout = Number((riderFare * payoutRate).toFixed(2));
  const platformRevenue = Number((riderFare - driverPayout).toFixed(2));

  return {
    base_fare: BASE_FARE,
    per_mile_fare: PER_MILE_FARE,
    per_minute_fare: PER_MINUTE_FARE,
    booking_fee: BOOKING_FEE,
    minimum_fare: MINIMUM_FARE,
    surge_multiplier: Math.max(1, surgeMultiplier),
    ride_type_multiplier: rideTypeMultiplier,
    mode_multiplier: modeMultiplier,
    estimated_total: riderFare,
    estimated_driver_payout: driverPayout,
    estimated_platform_revenue: platformRevenue
  };
}

/* =========================================================
   EMAIL / SMS HELPERS
========================================================= */
async function sendEmail({ to, subject, html, text }) {
  if (!SEND_REAL_EMAIL || !RESEND_API_KEY) {
    console.log("📧 EMAIL MOCK:", {
      to,
      subject,
      preview: text || html?.slice(0, 160) || ""
    });
    return { mocked: true };
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: EMAIL_FROM,
      to: Array.isArray(to) ? to : [to],
      subject,
      html,
      text
    })
  });

  const json = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(json?.message || `Email send failed (${response.status})`);
  }

  return json;
}

async function sendSms({ to, body }) {
  if (!SEND_REAL_SMS || !TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_FROM_NUMBER) {
    console.log("📱 SMS MOCK:", {
      to,
      body
    });
    return { mocked: true };
  }

  const endpoint = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;

  const form = new URLSearchParams();
  form.append("To", to);
  form.append("From", TWILIO_FROM_NUMBER);
  form.append("Body", body);

  const auth = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString("base64");

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: form.toString()
  });

  const json = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(json?.message || `SMS send failed (${response.status})`);
  }

  return json;
}

async function updateDriverVerificationStatus(driverId) {
  const driver = await getDriverById(driverId);
  if (!driver) throw new Error("Driver not found.");

  const emailVerified = driver.email_verified === true;
  const smsVerified = driver.sms_verified === true;
  const fullyVerified = emailVerified && smsVerified;

  const verificationStatus = fullyVerified
    ? "verified"
    : emailVerified || smsVerified
    ? "partially_verified"
    : "pending";

  const approvalStatus =
    fullyVerified && ["approved", "active"].includes(String(driver.approval_status || "").toLowerCase())
      ? driver.approval_status
      : driver.approval_status || "pending_review";

  const { data, error } = await supabase
    .from("drivers")
    .update({
      verification_status: verificationStatus,
      approval_status: approvalStatus,
      updated_at: nowIso()
    })
    .eq("id", driverId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

async function sendDriverVerificationEmail(driver) {
  const appBase = PUBLIC_APP_URL || RENDER_EXTERNAL_URL || APP_BASE_URL || "";
  if (!appBase) {
    throw new Error("Missing PUBLIC_APP_URL or RENDER_EXTERNAL_URL or APP_BASE_URL.");
  }

  const token = createToken(24);
  const expiresAt = Date.now() + 1000 * 60 * 60 * 24;

  memoryStore.emailVerifications.set(token, {
    driverId: driver.id,
    email: driver.email,
    expiresAt
  });

  const verifyUrl = `${appBase.replace(/\/$/, "")}/api/driver/verify-email?token=${encodeURIComponent(
    token
  )}`;

  await sendEmail({
    to: driver.email,
    subject: "Verify your Harvey Taxi driver email",
    text: `Welcome to Harvey Taxi. Verify your email by opening this link: ${verifyUrl}`,
    html: `
      <div style="font-family:Arial,sans-serif;color:#111;line-height:1.6">
        <h2>Harvey Taxi Driver Verification</h2>
        <p>Welcome, ${driver.first_name || "Driver"}.</p>
        <p>Please verify your email to continue driver onboarding.</p>
        <p><a href="${verifyUrl}" style="display:inline-block;padding:12px 18px;background:#111;color:#fff;text-decoration:none;border-radius:8px">Verify Email</a></p>
        <p>Or copy and paste this link:</p>
        <p>${verifyUrl}</p>
        <p>This link expires in 24 hours.</p>
      </div>
    `
  });

  return {
    success: true,
    email_sent_to: redactEmail(driver.email)
  };
}

async function sendDriverVerificationSms(driver) {
  const code = randomDigits(6);
  const expiresAt = Date.now() + 1000 * 60 * 15;

  memoryStore.smsVerifications.set(driver.id, {
    code,
    phone: normalizePhone(driver.phone),
    expiresAt
  });

  await sendSms({
    to: normalizePhone(driver.phone),
    body: `Harvey Taxi verification code: ${code}. Expires in 15 minutes.`
  });

  return {
    success: true,
    sms_sent_to: redactPhone(driver.phone)
  };
}

/* =========================================================
   VALIDATION
========================================================= */
function requireFields(body, fields = []) {
  const missing = fields.filter((field) => !isTruthyText(body[field]));
  if (missing.length) {
    const error = new Error(`Missing required fields: ${missing.join(", ")}`);
    error.status = 400;
    throw error;
  }
}

function requireBooleanAcceptances(body, fields = []) {
  const missing = fields.filter((field) => body[field] !== true);
  if (missing.length) {
    const error = new Error(`Required acceptance missing: ${missing.join(", ")}`);
    error.status = 400;
    throw error;
  }
}

/* =========================================================
   AUTH
========================================================= */
function requireAdmin(req, res, next) {
  const email = normalizeEmail(req.headers["x-admin-email"] || req.body.admin_email || "");
  const password = cleanEnv(req.headers["x-admin-password"] || req.body.admin_password || "");

  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
    return res.status(500).json({
      success: false,
      error: "Admin credentials are not configured on the server."
    });
  }

  if (email !== ADMIN_EMAIL || password !== ADMIN_PASSWORD) {
    return res.status(401).json({
      success: false,
      error: "Unauthorized admin access."
    });
  }

  next();
}

/* =========================================================
   HEALTH
========================================================= */
app.get("/api/health", async (req, res) => {
  try {
    const tableChecks = await verifyTables();

    return res.json({
      success: true,
      service: "Harvey Taxi API",
      status: "ok",
      time: nowIso(),
      env: {
        supabase: Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY),
        google_maps: Boolean(GOOGLE_MAPS_API_KEY),
        openai: Boolean(OPENAI_API_KEY),
        email: Boolean(RESEND_API_KEY),
        sms: Boolean(TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_FROM_NUMBER),
        public_app_url: Boolean(PUBLIC_APP_URL || RENDER_EXTERNAL_URL || APP_BASE_URL)
      },
      tables: tableChecks
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/* =========================================================
   ROOT
========================================================= */
app.get("/", (req, res) => {
  const filePath = path.join(__dirname, "public", "index.html");
  res.sendFile(filePath);
});

/* =========================================================
   ADMIN LOGIN
========================================================= */
app.post("/api/admin/login", async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    const password = cleanEnv(req.body.password);

    if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
      return res.status(500).json({
        success: false,
        error: "Admin credentials are not configured."
      });
    }

    if (email !== ADMIN_EMAIL || password !== ADMIN_PASSWORD) {
      return res.status(401).json({
        success: false,
        error: "Invalid admin credentials."
      });
    }

    return res.json({
      success: true,
      admin: {
        email: ADMIN_EMAIL
      }
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/* =========================================================
   RIDER SIGNUP / LOGIN
========================================================= */
app.post("/api/rider/signup", async (req, res) => {
  try {
    requireFields(req.body, ["first_name", "last_name", "email", "phone", "password"]);
    requireBooleanAcceptances(req.body, ["accepted_terms", "accepted_privacy_policy"]);

    const email = normalizeEmail(req.body.email);
    const phone = normalizePhone(req.body.phone);

    if (!isEmail(email)) {
      return res.status(400).json({
        success: false,
        error: "A valid rider email is required."
      });
    }

    const existingEmail = await trySingle(
      supabase.from("riders").select("id,email").eq("email", email).maybeSingle()
    );
    if (existingEmail) {
      return res.status(409).json({
        success: false,
        error: "A rider with that email already exists."
      });
    }

    const riderId = uid("rider");
    const riderPayload = {
      id: riderId,
      first_name: req.body.first_name.trim(),
      last_name: req.body.last_name.trim(),
      full_name: `${req.body.first_name.trim()} ${req.body.last_name.trim()}`,
      email,
      phone,
      password_hash: hashValue(req.body.password),
      verification_status: "approved", // user requested rider approval gate; this can later be manual
      approval_status: "approved",
      payment_authorization_status: "not_authorized",
      role: "rider",
      created_at: nowIso(),
      updated_at: nowIso()
    };

    const { data, error } = await supabase
      .from("riders")
      .insert(riderPayload)
      .select(
        "id,first_name,last_name,full_name,email,phone,verification_status,approval_status,payment_authorization_status,created_at"
      )
      .single();

    if (error) throw error;

    await logAdminEvent("rider_signup", "New rider signup completed.", {
      rider_id: data.id,
      email: data.email
    });

    return res.status(201).json({
      success: true,
      message: "Rider signup completed.",
      rider: data
    });
  } catch (error) {
    return res.status(error.status || 500).json({
      success: false,
      error: error.message
    });
  }
});

app.post("/api/rider/login", async (req, res) => {
  try {
    requireFields(req.body, ["email", "password"]);

    const email = normalizeEmail(req.body.email);
    const passwordHash = hashValue(req.body.password);

    const rider = await trySingle(
      supabase
        .from("riders")
        .select("*")
        .eq("email", email)
        .eq("password_hash", passwordHash)
        .maybeSingle()
    );

    if (!rider) {
      return res.status(401).json({
        success: false,
        error: "Invalid rider login."
      });
    }

    return res.json({
      success: true,
      rider: {
        id: rider.id,
        first_name: rider.first_name,
        last_name: rider.last_name,
        full_name: rider.full_name,
        email: rider.email,
        phone: rider.phone,
        verification_status: rider.verification_status,
        approval_status: rider.approval_status,
        payment_authorization_status: rider.payment_authorization_status
      }
    });
  } catch (error) {
    return res.status(error.status || 500).json({
      success: false,
      error: error.message
    });
  }
});

/* =========================================================
   DRIVER SIGNUP / LOGIN / VERIFICATION
========================================================= */
app.post("/api/driver/signup", async (req, res) => {
  try {
    requireFields(req.body, [
      "first_name",
      "last_name",
      "email",
      "phone",
      "password",
      "vehicle_make",
      "vehicle_model",
      "vehicle_year",
      "license_plate",
      "drivers_license_number"
    ]);

    requireBooleanAcceptances(req.body, [
      "accepted_terms",
      "accepted_background_check_consent",
      "accepted_driver_policy"
    ]);

    const email = normalizeEmail(req.body.email);
    const phone = normalizePhone(req.body.phone);

    if (!isEmail(email)) {
      return res.status(400).json({
        success: false,
        error: "A valid driver email is required."
      });
    }

    const existingEmail = await trySingle(
      supabase.from("drivers").select("id,email").eq("email", email).maybeSingle()
    );
    if (existingEmail) {
      return res.status(409).json({
        success: false,
        error: "A driver with that email already exists."
      });
    }

    const driverId = uid("driver");

    const driverPayload = {
      id: driverId,
      first_name: req.body.first_name.trim(),
      last_name: req.body.last_name.trim(),
      full_name: `${req.body.first_name.trim()} ${req.body.last_name.trim()}`,
      email,
      phone,
      password_hash: hashValue(req.body.password),
      vehicle_make: req.body.vehicle_make.trim(),
      vehicle_model: req.body.vehicle_model.trim(),
      vehicle_year: String(req.body.vehicle_year).trim(),
      license_plate: String(req.body.license_plate).trim().toUpperCase(),
      drivers_license_number: String(req.body.drivers_license_number).trim(),
      verification_status: "pending",
      approval_status: "pending_review",
      email_verified: false,
      sms_verified: false,
      availability_status: "offline",
      role: "driver",
      created_at: nowIso(),
      updated_at: nowIso()
    };

    const { data, error } = await supabase
      .from("drivers")
      .insert(driverPayload)
      .select(
        "id,first_name,last_name,full_name,email,phone,vehicle_make,vehicle_model,vehicle_year,license_plate,verification_status,approval_status,email_verified,sms_verified,availability_status,created_at"
      )
      .single();

    if (error) throw error;

    try {
      await sendDriverVerificationEmail(data);
    } catch (emailError) {
      console.error("Driver email verification send failed:", emailError.message);
    }

    try {
      await sendDriverVerificationSms(data);
    } catch (smsError) {
      console.error("Driver sms verification send failed:", smsError.message);
    }

    await logAdminEvent("driver_signup", "New driver signup submitted.", {
      driver_id: data.id,
      email: data.email
    });

    return res.status(201).json({
      success: true,
      message:
        "Driver signup submitted. Email and SMS verification have been initiated.",
      driver: data
    });
  } catch (error) {
    return res.status(error.status || 500).json({
      success: false,
      error: error.message
    });
  }
});

app.post("/api/driver/login", async (req, res) => {
  try {
    requireFields(req.body, ["email", "password"]);

    const email = normalizeEmail(req.body.email);
    const passwordHash = hashValue(req.body.password);

    const driver = await trySingle(
      supabase
        .from("drivers")
        .select("*")
        .eq("email", email)
        .eq("password_hash", passwordHash)
        .maybeSingle()
    );

    if (!driver) {
      return res.status(401).json({
        success: false,
        error: "Invalid driver login."
      });
    }

    return res.json({
      success: true,
      driver: {
        id: driver.id,
        first_name: driver.first_name,
        last_name: driver.last_name,
        full_name: driver.full_name,
        email: driver.email,
        phone: driver.phone,
        vehicle_make: driver.vehicle_make,
        vehicle_model: driver.vehicle_model,
        vehicle_year: driver.vehicle_year,
        license_plate: driver.license_plate,
        verification_status: driver.verification_status,
        approval_status: driver.approval_status,
        email_verified: driver.email_verified,
        sms_verified: driver.sms_verified,
        availability_status: driver.availability_status
      }
    });
  } catch (error) {
    return res.status(error.status || 500).json({
      success: false,
      error: error.message
    });
  }
});

app.get("/api/driver/verify-email", async (req, res) => {
  try {
    const token = cleanEnv(req.query.token);
    if (!token) {
      return res.status(400).send("Missing email verification token.");
    }

    const record = memoryStore.emailVerifications.get(token);
    if (!record) {
      return res.status(400).send("Invalid or expired email verification token.");
    }

    if (Date.now() > record.expiresAt) {
      memoryStore.emailVerifications.delete(token);
      return res.status(400).send("Email verification token expired.");
    }

    const { error } = await supabase
      .from("drivers")
      .update({
        email_verified: true,
        updated_at: nowIso()
      })
      .eq("id", record.driverId);

    if (error) throw error;

    await updateDriverVerificationStatus(record.driverId);
    memoryStore.emailVerifications.delete(token);

    await logAdminEvent("driver_email_verified", "Driver email verified.", {
      driver_id: record.driverId,
      email: record.email
    });

    return res.send(`
      <html>
        <head><title>Harvey Taxi</title></head>
        <body style="font-family:Arial,sans-serif;background:#07111f;color:#fff;padding:40px">
          <h1>Email Verified</h1>
          <p>Your Harvey Taxi driver email has been verified successfully.</p>
          <p>You may return to the app and continue onboarding.</p>
        </body>
      </html>
    `);
  } catch (error) {
    return res.status(500).send(`Verification failed: ${error.message}`);
  }
});

app.post("/api/driver/verify-sms", async (req, res) => {
  try {
    requireFields(req.body, ["driver_id", "code"]);

    const driverId = req.body.driver_id;
    const code = String(req.body.code).trim();

    const record = memoryStore.smsVerifications.get(driverId);
    if (!record) {
      return res.status(400).json({
        success: false,
        error: "SMS verification code not found or expired."
      });
    }

    if (Date.now() > record.expiresAt) {
      memoryStore.smsVerifications.delete(driverId);
      return res.status(400).json({
        success: false,
        error: "SMS verification code expired."
      });
    }

    if (record.code !== code) {
      return res.status(400).json({
        success: false,
        error: "Invalid SMS verification code."
      });
    }

    const { error } = await supabase
      .from("drivers")
      .update({
        sms_verified: true,
        updated_at: nowIso()
      })
      .eq("id", driverId);

    if (error) throw error;

    memoryStore.smsVerifications.delete(driverId);
    const updatedDriver = await updateDriverVerificationStatus(driverId);

    await logAdminEvent("driver_sms_verified", "Driver SMS verified.", {
      driver_id: driverId
    });

    return res.json({
      success: true,
      message: "Driver SMS verified successfully.",
      driver: updatedDriver
    });
  } catch (error) {
    return res.status(error.status || 500).json({
      success: false,
      error: error.message
    });
  }
});

app.post("/api/driver/resend-verification", async (req, res) => {
  try {
    requireFields(req.body, ["driver_id"]);

    const driver = await getDriverById(req.body.driver_id);
    if (!driver) {
      return res.status(404).json({
        success: false,
        error: "Driver not found."
      });
    }

    const results = {};

    if (driver.email_verified !== true) {
      results.email = await sendDriverVerificationEmail(driver);
    }
    if (driver.sms_verified !== true) {
      results.sms = await sendDriverVerificationSms(driver);
    }

    return res.json({
      success: true,
      message: "Verification resend processed.",
      results
    });
  } catch (error) {
    return res.status(error.status || 500).json({
      success: false,
      error: error.message
    });
  }
});

/* =========================================================
   RIDER / DRIVER LOOKUP
========================================================= */
app.get("/api/riders/:riderId", async (req, res) => {
  try {
    const rider = await getRiderById(req.params.riderId);
    if (!rider) {
      return res.status(404).json({
        success: false,
        error: "Rider not found."
      });
    }

    return res.json({
      success: true,
      rider: {
        id: rider.id,
        first_name: rider.first_name,
        last_name: rider.last_name,
        full_name: rider.full_name,
        email: rider.email,
        phone: rider.phone,
        verification_status: rider.verification_status,
        approval_status: rider.approval_status,
        payment_authorization_status: rider.payment_authorization_status
      }
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.get("/api/drivers/:driverId", async (req, res) => {
  try {
    const driver = await getDriverById(req.params.driverId);
    if (!driver) {
      return res.status(404).json({
        success: false,
        error: "Driver not found."
      });
    }

    return res.json({
      success: true,
      driver: {
        id: driver.id,
        first_name: driver.first_name,
        last_name: driver.last_name,
        full_name: driver.full_name,
        email: driver.email,
        phone: driver.phone,
        vehicle_make: driver.vehicle_make,
        vehicle_model: driver.vehicle_model,
        vehicle_year: driver.vehicle_year,
        license_plate: driver.license_plate,
        verification_status: driver.verification_status,
        approval_status: driver.approval_status,
        email_verified: driver.email_verified,
        sms_verified: driver.sms_verified,
        availability_status: driver.availability_status
      }
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/* =========================================================
   DRIVER AVAILABILITY
========================================================= */
app.post("/api/driver/:driverId/availability", async (req, res) => {
  try {
    const driverId = req.params.driverId;
    const availabilityStatus = safeLower(req.body.availability_status || "offline");

    if (!["offline", "available", "busy"].includes(availabilityStatus)) {
      return res.status(400).json({
        success: false,
        error: "Invalid availability_status."
      });
    }

    const driver = await getDriverById(driverId);
    if (!driver) {
      return res.status(404).json({
        success: false,
        error: "Driver not found."
      });
    }

    const { data, error } = await supabase
      .from("drivers")
      .update({
        availability_status: availabilityStatus,
        updated_at: nowIso()
      })
      .eq("id", driverId)
      .select(
        "id,full_name,email,phone,vehicle_make,vehicle_model,vehicle_year,license_plate,verification_status,approval_status,email_verified,sms_verified,availability_status"
      )
      .single();

    if (error) throw error;

    return res.json({
      success: true,
      driver: data
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.get("/api/drivers/available", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("drivers")
      .select(
        "id,full_name,vehicle_make,vehicle_model,vehicle_year,license_plate,verification_status,approval_status,availability_status"
      )
      .eq("availability_status", "available")
      .eq("verification_status", "verified");

    if (error) throw error;

    return res.json({
      success: true,
      drivers: data || []
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/* =========================================================
   PAYMENT AUTHORIZATION GATE
========================================================= */
app.post("/api/payments/authorize", async (req, res) => {
  try {
    requireFields(req.body, ["rider_id", "amount"]);

    const rider = await getRiderById(req.body.rider_id);
    if (!rider) {
      return res.status(404).json({
        success: false,
        error: "Rider not found."
      });
    }

    const amount = Number(req.body.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({
        success: false,
        error: "A valid amount is required."
      });
    }

    const paymentId = uid("pay");

    const paymentPayload = {
      id: paymentId,
      rider_id: rider.id,
      amount: Number(amount.toFixed(2)),
      currency: "USD",
      status: "authorized",
      authorization_reference: uid("auth"),
      payment_method_last4: String(req.body.card_last4 || "4242").slice(-4),
      created_at: nowIso(),
      updated_at: nowIso()
    };

    const { data, error } = await supabase
      .from("payments")
      .insert(paymentPayload)
      .select("*")
      .single();

    if (error) throw error;

    await supabase
      .from("riders")
      .update({
        payment_authorization_status: "authorized",
        updated_at: nowIso()
      })
      .eq("id", rider.id);

    await logAdminEvent("payment_authorized", "Payment authorization created.", {
      rider_id: rider.id,
      amount: paymentPayload.amount
    });

    return res.json({
      success: true,
      payment: data
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/* =========================================================
   FARE ESTIMATE
========================================================= */
app.post("/api/fare-estimate", async (req, res) => {
  try {
    requireFields(req.body, ["pickup_address", "dropoff_address"]);

    const rideType = safeLower(req.body.ride_type || "standard");
    const requestedMode = safeLower(req.body.requestedMode || req.body.requested_mode || "driver");

    const route = await getRouteEstimate(req.body.pickup_address, req.body.dropoff_address);
    const fare = calculateFare({
      distanceMiles: route.distance_miles,
      durationMinutes: route.duration_minutes,
      rideType,
      requestedMode
    });

    return res.json({
      success: true,
      ride_id: null,
      pickup_address: route.pickup_address,
      dropoff_address: route.dropoff_address,
      distance_miles: route.distance_miles,
      duration_minutes: route.duration_minutes,
      ride_type: rideType,
      requested_mode: requestedMode,
      route_provider: route.provider,
      fare_estimate: fare
    });
  } catch (error) {
    return res.status(error.status || 500).json({
      success: false,
      error: error.message
    });
  }
});

/* =========================================================
   DISPATCH HELPERS
========================================================= */
async function selectNearestAvailableDriver() {
  const { data, error } = await supabase
    .from("drivers")
    .select("*")
    .eq("availability_status", "available")
    .eq("verification_status", "verified")
    .in("approval_status", ["approved", "active"])
    .order("updated_at", { ascending: true })
    .limit(1);

  if (error) throw error;
  return data?.[0] || null;
}

async function createMissionForRide(ride, driver) {
  const missionId = uid("mission");

  const missionPayload = {
    id: missionId,
    ride_id: ride.id,
    rider_id: ride.rider_id,
    driver_id: driver ? driver.id : null,
    status: driver ? "offered" : "awaiting_driver",
    requested_mode: ride.requested_mode,
    pickup_address: ride.pickup_address,
    dropoff_address: ride.dropoff_address,
    estimated_total: ride.estimated_total,
    estimated_driver_payout: ride.estimated_driver_payout,
    notes: ride.notes || "",
    created_at: nowIso(),
    updated_at: nowIso()
  };

  const { data, error } = await supabase
    .from("missions")
    .insert(missionPayload)
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

async function createDispatchRecord(ride, driver, attempt = 1) {
  const payload = {
    id: uid("dispatch"),
    ride_id: ride.id,
    rider_id: ride.rider_id,
    driver_id: driver ? driver.id : null,
    status: driver ? "offered" : "awaiting_driver",
    attempt_number: attempt,
    created_at: nowIso(),
    updated_at: nowIso()
  };

  const { data, error } = await supabase
    .from("dispatches")
    .insert(payload)
    .select("*")
    .single();

  if (error) throw error;

  if (driver) {
    memoryStore.dispatchOffers.set(ride.id, {
      driverId: driver.id,
      expiresAt: Date.now() + DISPATCH_OFFER_TIMEOUT_MS,
      attempts: attempt
    });
  }

  return data;
}

async function runDispatchBrain(ride) {
  if (ride.requested_mode === REQUEST_MODES.AUTONOMOUS) {
    const { data, error } = await supabase
      .from("rides")
      .update({
        status: "assigned_autonomous",
        assigned_mode: REQUEST_MODES.AUTONOMOUS,
        updated_at: nowIso()
      })
      .eq("id", ride.id)
      .select("*")
      .single();

    if (error) throw error;

    await createMissionForRide(data, null);
    await createDispatchRecord(data, null, 1);

    return {
      dispatched: true,
      mode: REQUEST_MODES.AUTONOMOUS,
      ride: data,
      driver: null
    };
  }

  let attempt = 1;
  let selectedDriver = null;

  while (attempt <= MAX_DISPATCH_ATTEMPTS) {
    selectedDriver = await selectNearestAvailableDriver();
    if (selectedDriver) break;
    attempt += 1;
  }

  if (!selectedDriver) {
    const { data, error } = await supabase
      .from("rides")
      .update({
        status: "pending_driver",
        assigned_mode: REQUEST_MODES.DRIVER,
        updated_at: nowIso()
      })
      .eq("id", ride.id)
      .select("*")
      .single();

    if (error) throw error;

    await createMissionForRide(data, null);
    await createDispatchRecord(data, null, attempt);

    return {
      dispatched: false,
      mode: REQUEST_MODES.DRIVER,
      ride: data,
      driver: null
    };
  }

  const { data, error } = await supabase
    .from("rides")
    .update({
      status: "driver_offered",
      assigned_driver_id: selectedDriver.id,
      assigned_mode: REQUEST_MODES.DRIVER,
      updated_at: nowIso()
    })
    .eq("id", ride.id)
    .select("*")
    .single();

  if (error) throw error;

  await createMissionForRide(data, selectedDriver);
  await createDispatchRecord(data, selectedDriver, attempt);

  return {
    dispatched: true,
    mode: REQUEST_MODES.DRIVER,
    ride: data,
    driver: {
      id: selectedDriver.id,
      full_name: selectedDriver.full_name,
      vehicle_make: selectedDriver.vehicle_make,
      vehicle_model: selectedDriver.vehicle_model,
      vehicle_year: selectedDriver.vehicle_year,
      license_plate: selectedDriver.license_plate
    }
  };
}

/* =========================================================
   REQUEST RIDE
========================================================= */
app.post("/api/request-ride", async (req, res) => {
  try {
    requireFields(req.body, ["rider_id", "pickup_address", "dropoff_address"]);

    const rider = await getRiderById(req.body.rider_id);
    if (!rider) {
      return res.status(404).json({
        success: false,
        error: "Rider not found."
      });
    }

    if (!["approved", "verified"].includes(String(rider.approval_status || "").toLowerCase())) {
      return res.status(403).json({
        success: false,
        error: "Rider approval is required before requesting a ride."
      });
    }

    const authorizedPayment = await getLatestAuthorizedPaymentForRider(rider.id);
    if (!authorizedPayment) {
      return res.status(403).json({
        success: false,
        error: "Payment authorization is required before requesting a ride."
      });
    }

    const rideType = safeLower(req.body.ride_type || "standard");
    const requestedMode = safeLower(req.body.requestedMode || req.body.requested_mode || "driver");

    if (![REQUEST_MODES.DRIVER, REQUEST_MODES.AUTONOMOUS].includes(requestedMode)) {
      return res.status(400).json({
        success: false,
        error: "Invalid requested mode."
      });
    }

    const route = await getRouteEstimate(req.body.pickup_address, req.body.dropoff_address);
    const fare = calculateFare({
      distanceMiles: route.distance_miles,
      durationMinutes: route.duration_minutes,
      rideType,
      requestedMode
    });

    const ridePayload = {
      id: uid("ride"),
      rider_id: rider.id,
      assigned_driver_id: null,
      assigned_mode: null,
      requested_mode: requestedMode,
      ride_type: rideType,
      pickup_address: route.pickup_address,
      dropoff_address: route.dropoff_address,
      distance_miles: route.distance_miles,
      duration_minutes: route.duration_minutes,
      estimated_total: fare.estimated_total,
      estimated_driver_payout: fare.estimated_driver_payout,
      estimated_platform_revenue: fare.estimated_platform_revenue,
      status: "requested",
      notes: String(req.body.notes || "").trim(),
      payment_authorization_id: authorizedPayment.id,
      created_at: nowIso(),
      updated_at: nowIso()
    };

    const { data: newRide, error: rideError } = await supabase
      .from("rides")
      .insert(ridePayload)
      .select("*")
      .single();

    if (rideError) throw rideError;

    const dispatchResult = await runDispatchBrain(newRide);

    await logAdminEvent("ride_requested", "Ride request created.", {
      ride_id: newRide.id,
      rider_id: rider.id,
      requested_mode: requestedMode,
      ride_type: rideType
    });

    return res.status(201).json({
      success: true,
      ride_id: dispatchResult.ride.id,
      ride: dispatchResult.ride,
      dispatch: {
        dispatched: dispatchResult.dispatched,
        mode: dispatchResult.mode,
        driver: dispatchResult.driver
      },
      fare_estimate: {
        estimated_total: newRide.estimated_total,
        estimated_driver_payout: newRide.estimated_driver_payout,
        estimated_platform_revenue: newRide.estimated_platform_revenue
      }
    });
  } catch (error) {
    return res.status(error.status || 500).json({
      success: false,
      error: error.message
    });
  }
});

/* =========================================================
   RIDE ACCEPT / DECLINE / START / COMPLETE / CANCEL
========================================================= */
app.post("/api/driver/:driverId/accept-ride", async (req, res) => {
  try {
    requireFields(req.body, ["ride_id"]);

    const driverId = req.params.driverId;
    const rideId = req.body.ride_id;

    const ride = await getRideById(rideId);
    if (!ride) {
      return res.status(404).json({
        success: false,
        error: "Ride not found."
      });
    }

    if (ride.assigned_driver_id !== driverId) {
      return res.status(403).json({
        success: false,
        error: "Ride is not assigned to this driver."
      });
    }

    const offer = memoryStore.dispatchOffers.get(rideId);
    if (offer && offer.driverId === driverId && Date.now() > offer.expiresAt) {
      return res.status(410).json({
        success: false,
        error: "Dispatch offer expired."
      });
    }

    const driver = await getDriverById(driverId);
    if (!driver) {
      return res.status(404).json({
        success: false,
        error: "Driver not found."
      });
    }

    if (driver.verification_status !== "verified") {
      return res.status(403).json({
        success: false,
        error: "Driver verification is required before ride acceptance."
      });
    }

    if (!["approved", "active"].includes(String(driver.approval_status || "").toLowerCase())) {
      return res.status(403).json({
        success: false,
        error: "Driver approval is required before ride acceptance."
      });
    }

    const { data, error } = await supabase
      .from("rides")
      .update({
        status: "accepted",
        updated_at: nowIso()
      })
      .eq("id", rideId)
      .select("*")
      .single();

    if (error) throw error;

    await supabase
      .from("drivers")
      .update({
        availability_status: "busy",
        updated_at: nowIso()
      })
      .eq("id", driverId);

    memoryStore.dispatchOffers.delete(rideId);

    return res.json({
      success: true,
      ride: data
    });
  } catch (error) {
    return res.status(error.status || 500).json({
      success: false,
      error: error.message
    });
  }
});

app.post("/api/driver/:driverId/decline-ride", async (req, res) => {
  try {
    requireFields(req.body, ["ride_id"]);

    const driverId = req.params.driverId;
    const rideId = req.body.ride_id;

    const ride = await getRideById(rideId);
    if (!ride) {
      return res.status(404).json({
        success: false,
        error: "Ride not found."
      });
    }

    if (ride.assigned_driver_id !== driverId) {
      return res.status(403).json({
        success: false,
        error: "Ride is not assigned to this driver."
      });
    }

    const { data, error } = await supabase
      .from("rides")
      .update({
        status: "pending_driver",
        assigned_driver_id: null,
        updated_at: nowIso()
      })
      .eq("id", rideId)
      .select("*")
      .single();

    if (error) throw error;

    memoryStore.dispatchOffers.delete(rideId);

    return res.json({
      success: true,
      message: "Ride declined and returned to dispatch queue.",
      ride: data
    });
  } catch (error) {
    return res.status(error.status || 500).json({
      success: false,
      error: error.message
    });
  }
});

app.post("/api/rides/:rideId/start", async (req, res) => {
  try {
    const ride = await getRideById(req.params.rideId);
    if (!ride) {
      return res.status(404).json({
        success: false,
        error: "Ride not found."
      });
    }

    if (!["accepted", "assigned_autonomous"].includes(String(ride.status || "").toLowerCase())) {
      return res.status(400).json({
        success: false,
        error: "Ride cannot be started from its current state."
      });
    }

    const { data, error } = await supabase
      .from("rides")
      .update({
        status: "in_progress",
        started_at: nowIso(),
        updated_at: nowIso()
      })
      .eq("id", ride.id)
      .select("*")
      .single();

    if (error) throw error;

    return res.json({
      success: true,
      ride: data
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.post("/api/rides/:rideId/complete", async (req, res) => {
  try {
    const ride = await getRideById(req.params.rideId);
    if (!ride) {
      return res.status(404).json({
        success: false,
        error: "Ride not found."
      });
    }

    if (ride.status !== "in_progress") {
      return res.status(400).json({
        success: false,
        error: "Ride must be in progress before completion."
      });
    }

    const tipAmount = Number(req.body.tip_amount || 0);
    const finalCharge = Number((Number(ride.estimated_total || 0) + Math.max(0, tipAmount)).toFixed(2));

    const { data, error } = await supabase
      .from("rides")
      .update({
        status: "completed",
        completed_at: nowIso(),
        final_total: finalCharge,
        tip_amount: Math.max(0, tipAmount),
        updated_at: nowIso()
      })
      .eq("id", ride.id)
      .select("*")
      .single();

    if (error) throw error;

    if (ride.assigned_driver_id) {
      await supabase
        .from("drivers")
        .update({
          availability_status: "available",
          updated_at: nowIso()
        })
        .eq("id", ride.assigned_driver_id);
    }

    return res.json({
      success: true,
      ride: data
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.post("/api/rides/:rideId/cancel", async (req, res) => {
  try {
    const ride = await getRideById(req.params.rideId);
    if (!ride) {
      return res.status(404).json({
        success: false,
        error: "Ride not found."
      });
    }

    if (["completed", "cancelled"].includes(String(ride.status || "").toLowerCase())) {
      return res.status(400).json({
        success: false,
        error: "Ride cannot be cancelled from its current state."
      });
    }

    const { data, error } = await supabase
      .from("rides")
      .update({
        status: "cancelled",
        cancelled_at: nowIso(),
        cancellation_reason: String(req.body.reason || "cancelled_by_user"),
        updated_at: nowIso()
      })
      .eq("id", ride.id)
      .select("*")
      .single();

    if (error) throw error;

    if (ride.assigned_driver_id) {
      await supabase
        .from("drivers")
        .update({
          availability_status: "available",
          updated_at: nowIso()
        })
        .eq("id", ride.assigned_driver_id);
    }

    memoryStore.dispatchOffers.delete(ride.id);

    return res.json({
      success: true,
      ride: data
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/* =========================================================
   ADMIN ANALYTICS / ADMIN ACTIONS
========================================================= */
app.get("/api/admin/analytics", requireAdmin, async (req, res) => {
  try {
    const [ridersRes, driversRes, ridesRes, paymentsRes] = await Promise.all([
      supabase.from("riders").select("id,approval_status", { count: "exact", head: false }),
      supabase.from("drivers").select("id,approval_status,verification_status", { count: "exact", head: false }),
      supabase.from("rides").select("id,status,requested_mode,final_total,estimated_total", { count: "exact", head: false }),
      supabase.from("payments").select("id,status,amount", { count: "exact", head: false })
    ]);

    if (ridersRes.error) throw ridersRes.error;
    if (driversRes.error) throw driversRes.error;
    if (ridesRes.error) throw ridesRes.error;
    if (paymentsRes.error) throw paymentsRes.error;

    const riders = ridersRes.data || [];
    const drivers = driversRes.data || [];
    const rides = ridesRes.data || [];
    const payments = paymentsRes.data || [];

    const analytics = {
      riders_total: riders.length,
      riders_approved: riders.filter((x) =>
        ["approved", "verified"].includes(String(x.approval_status || "").toLowerCase())
      ).length,

      drivers_total: drivers.length,
      drivers_verified: drivers.filter((x) => x.verification_status === "verified").length,
      drivers_approved: drivers.filter((x) =>
        ["approved", "active"].includes(String(x.approval_status || "").toLowerCase())
      ).length,

      rides_total: rides.length,
      rides_requested: rides.filter((x) => x.status === "requested").length,
      rides_in_progress: rides.filter((x) => x.status === "in_progress").length,
      rides_completed: rides.filter((x) => x.status === "completed").length,
      rides_cancelled: rides.filter((x) => x.status === "cancelled").length,
      rides_driver_mode: rides.filter((x) => x.requested_mode === "driver").length,
      rides_autonomous_mode: rides.filter((x) => x.requested_mode === "autonomous").length,

      payments_total: payments.length,
      payments_authorized: payments.filter((x) => x.status === "authorized").length,
      gross_revenue_estimate: Number(
        rides.reduce((sum, x) => sum + Number(x.final_total || x.estimated_total || 0), 0).toFixed(2)
      )
    };

    return res.json({
      success: true,
      analytics
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.post("/api/admin/drivers/:driverId/approve", requireAdmin, async (req, res) => {
  try {
    const driver = await getDriverById(req.params.driverId);
    if (!driver) {
      return res.status(404).json({
        success: false,
        error: "Driver not found."
      });
    }

    const { data, error } = await supabase
      .from("drivers")
      .update({
        approval_status: "approved",
        availability_status: driver.verification_status === "verified" ? "available" : "offline",
        updated_at: nowIso()
      })
      .eq("id", driver.id)
      .select("*")
      .single();

    if (error) throw error;

    return res.json({
      success: true,
      driver: data
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.post("/api/admin/riders/:riderId/approve", requireAdmin, async (req, res) => {
  try {
    const rider = await getRiderById(req.params.riderId);
    if (!rider) {
      return res.status(404).json({
        success: false,
        error: "Rider not found."
      });
    }

    const { data, error } = await supabase
      .from("riders")
      .update({
        approval_status: "approved",
        verification_status: "approved",
        updated_at: nowIso()
      })
      .eq("id", rider.id)
      .select("*")
      .single();

    if (error) throw error;

    return res.json({
      success: true,
      rider: data
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/* =========================================================
   SIMPLE AI SUPPORT ENDPOINT
========================================================= */
app.post("/api/support/ask", async (req, res) => {
  try {
    const question = String(req.body.question || "").trim();
    const pageMode = String(req.body.page_mode || "general").trim();

    if (!question) {
      return res.status(400).json({
        success: false,
        error: "Support question is required."
      });
    }

    if (!OPENAI_API_KEY) {
      return res.json({
        success: true,
        answer:
          pageMode === "driver"
            ? "Driver support is currently operating in fallback mode. Please complete email verification, SMS verification, document submission, and admin approval before accepting rides."
            : pageMode === "request"
            ? "Ride requests require rider approval and payment authorization before dispatch. Driver mode assigns a human driver. Autonomous mode requests pilot autonomous service when available."
            : "Harvey Taxi support is live. Rider signup, driver onboarding, payment authorization, and ride requests are available."
      });
    }

    const systemPrompt = `
You are Harvey Taxi support.
Be concise, friendly, and operational.
Never expose secrets or internal tokens.
Important policies:
- Riders must be approved before requesting rides.
- Payment authorization is required before dispatch.
- Drivers must complete email + SMS verification before driver activation.
- Drivers should see enough mission details before ride acceptance.
- Harvey Taxi supports driver mode and autonomous pilot mode.
    `.trim();

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: OPENAI_SUPPORT_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: `Page mode: ${pageMode}\nQuestion: ${question}`
          }
        ],
        temperature: 0.4,
        max_tokens: 250
      })
    });

    const json = await response.json();
    if (!response.ok) {
      throw new Error(json?.error?.message || "OpenAI support request failed.");
    }

    const answer = json?.choices?.[0]?.message?.content?.trim() || "Support response unavailable.";

    return res.json({
      success: true,
      answer
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/* =========================================================
   SUPPORT INFO
========================================================= */
app.get("/api/support/info", async (req, res) => {
  return res.json({
    success: true,
    support_email: DEFAULT_SUPPORT_EMAIL,
    emergency_notice: "If this is an emergency, call 911 immediately."
  });
});

/* =========================================================
   404 API HANDLER
========================================================= */
app.use("/api/*", (req, res) => {
  return res.status(404).json({
    success: false,
    error: "API route not found."
  });
});

/* =========================================================
   GLOBAL ERROR HANDLER
========================================================= */
app.use((error, req, res, next) => {
  console.error("Unhandled server error:", error);
  return res.status(error.status || 500).json({
    success: false,
    error: error.message || "Internal server error."
  });
});

/* =========================================================
   START SERVER
========================================================= */
app.listen(PORT, async () => {
  console.log(`✅ Harvey Taxi server running on port ${PORT}`);

  try {
    const checks = await verifyTables();
    console.log("✅ Table diagnostics:", checks);
  } catch (error) {
    console.error("⚠️ Table diagnostics failed:", error.message);
  }
});

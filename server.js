const express = require("express");
const cors = require("cors");
const path = require("path");
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");

const app = express();
const PORT = process.env.PORT || 10000;

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
   ENV
========================================================= */
function cleanEnv(value = "") {
  return String(value || "").trim().replace(/^['"]|['"]$/g, "");
}

const SUPABASE_URL = cleanEnv(process.env.SUPABASE_URL);
const SUPABASE_SERVICE_ROLE_KEY = cleanEnv(process.env.SUPABASE_SERVICE_ROLE_KEY);

const ADMIN_EMAIL = cleanEnv(process.env.ADMIN_EMAIL);
const ADMIN_PASSWORD = cleanEnv(process.env.ADMIN_PASSWORD);

const GOOGLE_MAPS_API_KEY = cleanEnv(process.env.GOOGLE_MAPS_API_KEY);

const OPENAI_API_KEY = cleanEnv(process.env.OPENAI_API_KEY);
const OPENAI_SUPPORT_MODEL =
  cleanEnv(process.env.OPENAI_SUPPORT_MODEL) || "gpt-4o-mini";

const SENDGRID_API_KEY = cleanEnv(process.env.SENDGRID_API_KEY);
const SENDGRID_FROM_EMAIL =
  cleanEnv(process.env.SENDGRID_FROM_EMAIL) ||
  cleanEnv(process.env.SUPPORT_FROM_EMAIL);

const TWILIO_ACCOUNT_SID = cleanEnv(process.env.TWILIO_ACCOUNT_SID);
const TWILIO_AUTH_TOKEN = cleanEnv(process.env.TWILIO_AUTH_TOKEN);
const TWILIO_PHONE_NUMBER = cleanEnv(process.env.TWILIO_PHONE_NUMBER);

const PUBLIC_APP_URL = cleanEnv(process.env.PUBLIC_APP_URL);
const RENDER_EXTERNAL_URL = cleanEnv(process.env.RENDER_EXTERNAL_URL);
const APP_BASE_URL = cleanEnv(process.env.APP_BASE_URL);

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(SUPABASE_URL)) {
  console.error("❌ Invalid SUPABASE_URL format:", SUPABASE_URL);
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false
  },
  global: {
    headers: {
      "X-Client-Info": "harvey-taxi-server"
    }
  }
});

const hasSendGrid = !!(SENDGRID_API_KEY && SENDGRID_FROM_EMAIL);
const hasTwilio = !!(
  TWILIO_ACCOUNT_SID &&
  TWILIO_AUTH_TOKEN &&
  TWILIO_PHONE_NUMBER
);

/* =========================================================
   CONSTANTS
========================================================= */
const DISPATCH_OFFER_TIMEOUT_MS = 20000;
const MAX_DISPATCH_ATTEMPTS = 5;
const DRIVER_SMS_CODE_TTL_MINUTES = 10;
const DRIVER_EMAIL_TOKEN_TTL_HOURS = 24;
const DRIVER_SMS_MAX_ATTEMPTS = 5;

const ACTIVE_RIDE_STATUSES = [
  "requested",
  "dispatching",
  "awaiting_driver_acceptance",
  "driver_assigned",
  "en_route",
  "arrived",
  "in_progress"
];

const FINAL_RIDE_STATUSES = ["cancelled", "completed", "no_driver_available"];

const FARE_CONFIG = {
  driver: {
    standard: {
      baseFare: 1.1,
      perMile: 0.95,
      perMinute: 0.17,
      bookingFee: 1.15,
      minimumFare: 6.75
    },
    scheduled: {
      baseFare: 1.35,
      perMile: 1.0,
      perMinute: 0.18,
      bookingFee: 1.35,
      minimumFare: 7.5
    },
    airport: {
      baseFare: 2.0,
      perMile: 1.1,
      perMinute: 0.2,
      bookingFee: 1.75,
      minimumFare: 9.95
    },
    medical: {
      baseFare: 1.0,
      perMile: 0.9,
      perMinute: 0.16,
      bookingFee: 1.0,
      minimumFare: 6.5
    },
    nonprofit: {
      baseFare: 0.9,
      perMile: 0.82,
      perMinute: 0.15,
      bookingFee: 0.85,
      minimumFare: 6.0
    }
  },
  autonomous: {
    standard: {
      baseFare: 1.35,
      perMile: 1.05,
      perMinute: 0.2,
      bookingFee: 1.35,
      minimumFare: 7.75
    },
    scheduled: {
      baseFare: 1.6,
      perMile: 1.1,
      perMinute: 0.22,
      bookingFee: 1.5,
      minimumFare: 8.5
    },
    airport: {
      baseFare: 2.25,
      perMile: 1.2,
      perMinute: 0.24,
      bookingFee: 1.95,
      minimumFare: 10.95
    },
    medical: {
      baseFare: 1.25,
      perMile: 1.0,
      perMinute: 0.18,
      bookingFee: 1.15,
      minimumFare: 7.25
    },
    nonprofit: {
      baseFare: 1.1,
      perMile: 0.9,
      perMinute: 0.17,
      bookingFee: 1.0,
      minimumFare: 6.95
    }
  }
};

const SURGE_RULES = {
  offpeak: 1,
  normal: 1,
  busy: 1.15,
  high_demand: 1.3,
  event: 1.5
};

/* =========================================================
   HELPERS
========================================================= */
function nowIso() {
  return new Date().toISOString();
}

function safeString(value = "") {
  return String(value || "").trim();
}

function safeLower(value = "") {
  return safeString(value).toLowerCase();
}

function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function roundMoney(value) {
  return Number((safeNumber(value, 0) + Number.EPSILON).toFixed(2));
}

function getBodyValue(body, ...keys) {
  for (const key of keys) {
    if (body && body[key] !== undefined && body[key] !== null) {
      return body[key];
    }
  }
  return "";
}

function normalizeRequestedMode(value = "driver") {
  return safeLower(value) === "autonomous" ? "autonomous" : "driver";
}

function normalizeRideType(value = "standard") {
  const rideType = safeLower(value);
  const allowed = ["standard", "scheduled", "airport", "medical", "nonprofit"];
  return allowed.includes(rideType) ? rideType : "standard";
}

function normalizeSurgeLevel(value = "normal") {
  const level = safeLower(value);
  return Object.prototype.hasOwnProperty.call(SURGE_RULES, level)
    ? level
    : "normal";
}

function normalizeDriverType(value = "human") {
  return safeLower(value) === "autonomous" ? "autonomous" : "human";
}

function normalizeBoolean(value, fallback = false) {
  if (typeof value === "boolean") return value;
  const text = safeLower(value);
  if (["true", "1", "yes", "y", "on"].includes(text)) return true;
  if (["false", "0", "no", "n", "off"].includes(text)) return false;
  return fallback;
}

function normalizeEmail(value = "") {
  return safeLower(value);
}

function normalizePhone(value = "") {
  return String(value || "").replace(/[^\d+]/g, "").trim();
}

function maskEmail(email = "") {
  const clean = normalizeEmail(email);
  const [local, domain] = clean.split("@");
  if (!local || !domain) return "";
  if (local.length <= 2) return `${local[0] || "*"}***@${domain}`;
  return `${local.slice(0, 2)}***@${domain}`;
}

function maskPhone(phone = "") {
  const digits = String(phone || "").replace(/[^\d]/g, "");
  if (digits.length < 4) return "****";
  return `***-***-${digits.slice(-4)}`;
}

function createId(prefix = "id") {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}

function createToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString("hex");
}

function createNumericCode(length = 6) {
  let code = "";
  while (code.length < length) {
    code += Math.floor(Math.random() * 10);
  }
  return code.slice(0, length);
}

function addMinutes(dateInput, minutes) {
  const date = new Date(dateInput || Date.now());
  date.setMinutes(date.getMinutes() + minutes);
  return date.toISOString();
}

function addHours(dateInput, hours) {
  const date = new Date(dateInput || Date.now());
  date.setHours(date.getHours() + hours);
  return date.toISOString();
}

function isExpired(isoValue) {
  if (!isoValue) return true;
  return new Date(isoValue).getTime() < Date.now();
}

function publicBaseUrl() {
  return (
    PUBLIC_APP_URL ||
    RENDER_EXTERNAL_URL ||
    APP_BASE_URL ||
    `http://localhost:${PORT}`
  ).replace(/\/+$/, "");
}

function requireFields(payload, fields) {
  const missing = fields.filter((field) => {
    const value = payload[field];
    return value === undefined || value === null || safeString(value) === "";
  });

  if (missing.length) {
    return `Missing required field(s): ${missing.join(", ")}`;
  }

  return null;
}

function publicRider(rider) {
  if (!rider) return null;
  return {
    id: rider.id,
    first_name: rider.first_name || "",
    last_name: rider.last_name || "",
    email: rider.email || "",
    phone: rider.phone || "",
    city: rider.city || "",
    state: rider.state || "",
    approved: rider.approved === true || rider.is_approved === true,
    verification_status: rider.verification_status || "pending",
    created_at: rider.created_at || null,
    updated_at: rider.updated_at || null
  };
}

function computeDriverVerificationSummary(driver) {
  const emailVerified = driver?.email_verified === true;
  const smsVerified = driver?.sms_verified === true;
  const fullyVerified = emailVerified && smsVerified;

  return {
    email_verified: emailVerified,
    sms_verified: smsVerified,
    fully_verified: fullyVerified,
    approval_ready: fullyVerified,
    verification_status: fullyVerified
      ? "verified"
      : emailVerified || smsVerified
      ? "partially_verified"
      : driver?.verification_status || "pending"
  };
}

function publicDriver(driver) {
  if (!driver) return null;
  const verification = computeDriverVerificationSummary(driver);

  return {
    id: driver.id,
    first_name: driver.first_name || "",
    last_name: driver.last_name || "",
    email: driver.email || "",
    phone: driver.phone || "",
    city: driver.city || "",
    state: driver.state || "",
    vehicle_make: driver.vehicle_make || "",
    vehicle_model: driver.vehicle_model || "",
    vehicle_year: driver.vehicle_year || "",
    vehicle_color: driver.vehicle_color || "",
    license_plate: driver.license_plate || driver.plate_number || "",
    license_number: driver.license_number || "",
    driver_type: driver.driver_type || "human",
    approved: driver.approved === true || driver.is_approved === true,
    verification_status: verification.verification_status,
    background_check_status: driver.background_check_status || "pending",
    status: driver.status || "offline",
    email_verified: verification.email_verified,
    sms_verified: verification.sms_verified,
    fully_verified: verification.fully_verified,
    approval_ready: verification.approval_ready,
    created_at: driver.created_at || null,
    updated_at: driver.updated_at || null
  };
}

function buildDiagnostics() {
  return {
    app: "Harvey Taxi",
    timestamp: nowIso(),
    env: {
      supabase_url_present: !!SUPABASE_URL,
      supabase_key_present: !!SUPABASE_SERVICE_ROLE_KEY,
      supabase_url_format_valid:
        /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(SUPABASE_URL),
      google_maps_present: !!GOOGLE_MAPS_API_KEY,
      openai_present: !!OPENAI_API_KEY,
      email_service: hasSendGrid ? "configured" : "not_configured",
      sms_service: hasTwilio ? "configured" : "not_configured"
    }
  };
}

async function sendEmailViaSendGrid({ to, subject, html, text }) {
  if (!hasSendGrid) {
    return {
      success: false,
      skipped: true,
      message: "SendGrid not configured."
    };
  }

  const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SENDGRID_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: { email: SENDGRID_FROM_EMAIL },
      subject,
      content: [
        { type: "text/plain", value: text || "" },
        { type: "text/html", value: html || "" }
      ]
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`SendGrid email failed: ${errorText}`);
  }

  return { success: true };
}

async function sendSmsViaTwilio({ to, body }) {
  if (!hasTwilio) {
    return {
      success: false,
      skipped: true,
      message: "Twilio not configured."
    };
  }

  const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
  const auth = Buffer.from(
    `${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`
  ).toString("base64");

  const formBody = new URLSearchParams({
    To: to,
    From: TWILIO_PHONE_NUMBER,
    Body: body
  });

  const response = await fetch(twilioUrl, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: formBody.toString()
  });

  const data = await response.text();

  if (!response.ok) {
    throw new Error(`Twilio SMS failed: ${data}`);
  }

  return { success: true };
}

async function geocodeAddress(address) {
  const cleanAddress = safeString(address);

  if (!cleanAddress) {
    return {
      success: false,
      message: "Address is required for geocoding."
    };
  }

  if (!GOOGLE_MAPS_API_KEY) {
    return {
      success: false,
      message: "GOOGLE_MAPS_API_KEY is missing."
    };
  }

  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(
    cleanAddress
  )}&key=${GOOGLE_MAPS_API_KEY}`;

  const response = await fetch(url);
  const data = await response.json();

  if (data.status !== "OK" || !data.results || !data.results.length) {
    return {
      success: false,
      message: "Unable to geocode address."
    };
  }

  const result = data.results[0];
  const location = result.geometry?.location || {};

  return {
    success: true,
    formattedAddress: result.formatted_address || cleanAddress,
    latitude: safeNumber(location.lat, null),
    longitude: safeNumber(location.lng, null)
  };
}

async function getDistanceAndDuration(pickupAddress, dropoffAddress) {
  const pickup = safeString(pickupAddress);
  const dropoff = safeString(dropoffAddress);

  if (!pickup || !dropoff) {
    return {
      success: false,
      message: "Pickup and dropoff are required."
    };
  }

  if (!GOOGLE_MAPS_API_KEY) {
    return {
      success: false,
      message: "GOOGLE_MAPS_API_KEY is missing."
    };
  }

  const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${encodeURIComponent(
    pickup
  )}&destinations=${encodeURIComponent(
    dropoff
  )}&units=imperial&key=${GOOGLE_MAPS_API_KEY}`;

  const response = await fetch(url);
  const data = await response.json();

  if (
    data.status !== "OK" ||
    !data.rows ||
    !data.rows[0] ||
    !data.rows[0].elements ||
    !data.rows[0].elements[0]
  ) {
    return {
      success: false,
      message: "Unable to calculate route."
    };
  }

  const element = data.rows[0].elements[0];

  if (element.status !== "OK") {
    return {
      success: false,
      message: "Route not available for these addresses."
    };
  }

  const distanceMeters = safeNumber(element.distance?.value, 0);
  const durationSeconds = safeNumber(element.duration?.value, 0);

  return {
    success: true,
    distanceMiles: distanceMeters / 1609.344,
    durationMinutes: durationSeconds / 60,
    pickupDisplay: data.origin_addresses?.[0] || pickup,
    dropoffDisplay: data.destination_addresses?.[0] || dropoff
  };
}

function getFareProfile({ rideType = "standard", requestedMode = "driver" }) {
  const normalizedMode = normalizeRequestedMode(requestedMode);
  const normalizedRideType = normalizeRideType(rideType);

  return (
    FARE_CONFIG[normalizedMode]?.[normalizedRideType] ||
    FARE_CONFIG.driver.standard
  );
}

function calculateFare({
  distanceMiles = 0,
  durationMinutes = 0,
  rideType = "standard",
  requestedMode = "driver",
  surgeLevel = "normal"
}) {
  const normalizedMode = normalizeRequestedMode(requestedMode);
  const normalizedRideType = normalizeRideType(rideType);
  const normalizedSurgeLevel = normalizeSurgeLevel(surgeLevel);
  const profile = getFareProfile({
    rideType: normalizedRideType,
    requestedMode: normalizedMode
  });

  const cleanDistance = Math.max(0, safeNumber(distanceMiles, 0));
  const cleanDuration = Math.max(0, safeNumber(durationMinutes, 0));
  const surgeMultiplier = safeNumber(SURGE_RULES[normalizedSurgeLevel], 1);

  const subtotal =
    profile.baseFare +
    cleanDistance * profile.perMile +
    cleanDuration * profile.perMinute +
    profile.bookingFee;

  const surgedSubtotal = subtotal * surgeMultiplier;
  const estimatedTotal = Math.max(profile.minimumFare, surgedSubtotal);

  return {
    baseFare: roundMoney(profile.baseFare),
    perMile: roundMoney(profile.perMile),
    perMinute: roundMoney(profile.perMinute),
    distanceMiles: roundMoney(cleanDistance),
    durationMinutes: roundMoney(cleanDuration),
    bookingFee: roundMoney(profile.bookingFee),
    minimumFare: roundMoney(profile.minimumFare),
    surgeLevel: normalizedSurgeLevel,
    surgeMultiplier: roundMoney(surgeMultiplier),
    estimatedTotal: roundMoney(estimatedTotal)
  };
}

function toRadians(value) {
  return (value * Math.PI) / 180;
}

function haversineMiles(lat1, lon1, lat2, lon2) {
  if (
    !Number.isFinite(lat1) ||
    !Number.isFinite(lon1) ||
    !Number.isFinite(lat2) ||
    !Number.isFinite(lon2)
  ) {
    return Number.POSITIVE_INFINITY;
  }

  const R = 3958.8;
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
} /* =========================================================
   AI SUPPORT SYSTEM
========================================================= */

function getHarveySupportFallback(message = "", page = "general") {
  const text = safeLower(message);

  if (page === "rider") {
    if (text.includes("verify"))
      return "Rider verification is required before requesting a ride. Once approved, you can request immediately.";
    if (text.includes("request"))
      return "Tap Request Ride, enter pickup and destination, and confirm payment authorization.";
    if (text.includes("payment"))
      return "Harvey Taxi pre-authorizes payment before dispatch. You are only charged after trip completion.";
    return "I can help with rider signup, verification, or requesting a ride.";
  }

  if (page === "driver") {
    if (text.includes("approval"))
      return "Drivers must complete email and SMS verification before approval.";
    if (text.includes("documents"))
      return "Drivers must submit license, vehicle info, and pass verification.";
    if (text.includes("background"))
      return "Background checks run after verification is complete.";
    return "I can help with driver signup, approval, or verification.";
  }

  if (page === "request") {
    if (text.includes("autonomous"))
      return "Autonomous pilot rides use Harvey AI dispatch and autonomous fleet routing.";
    if (text.includes("driver"))
      return "Driver mode dispatches the nearest verified driver.";
    if (text.includes("fare"))
      return "Fare is calculated using distance, time, and demand.";
    return "Enter pickup and dropoff to request a ride.";
  }

  return "Harvey Taxi support is here. Ask about rider signup, driver signup, or requesting a ride.";
}

async function generateAiSupportReply({ message, page }) {
  try {
    if (!OPENAI_API_KEY) {
      return getHarveySupportFallback(message, page);
    }

    const response = await fetch(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: OPENAI_SUPPORT_MODEL,
          messages: [
            {
              role: "system",
              content:
                "You are Harvey Taxi AI assistant. Help riders and drivers. Be concise and professional."
            },
            {
              role: "user",
              content: `Page: ${page}\nMessage: ${message}`
            }
          ],
          temperature: 0.3,
          max_tokens: 200
        })
      }
    );

    const data = await response.json();

    return (
      data?.choices?.[0]?.message?.content ||
      getHarveySupportFallback(message, page)
    );
  } catch (error) {
    return getHarveySupportFallback(message, page);
  }
}

/* =========================================================
   DISPATCH INTELLIGENCE
========================================================= */

async function rankDriversByDistance(drivers, pickupLat, pickupLng) {
  return drivers
    .map((driver) => {
      const lat = safeNumber(driver.latitude, null);
      const lng = safeNumber(driver.longitude, null);

      const distance = haversineMiles(
        pickupLat,
        pickupLng,
        lat,
        lng
      );

      return {
        ...driver,
        distance
      };
    })
    .sort((a, b) => a.distance - b.distance);
}

async function findNearestDriver(ride) {
  const { data: drivers, error } = await supabase
    .from("drivers")
    .select("*")
    .eq("status", "online")
    .eq("approved", true);

  if (error || !drivers || !drivers.length) return null;

  const pickupLat = safeNumber(ride.pickup_latitude);
  const pickupLng = safeNumber(ride.pickup_longitude);

  const ranked = await rankDriversByDistance(
    drivers,
    pickupLat,
    pickupLng
  );

  return ranked[0] || null;
}

async function createDispatchOffer(ride, driver, attempt = 1) {
  const offer = {
    id: createId("dispatch"),
    ride_id: ride.id,
    driver_id: driver.id,
    status: "offered",
    attempt,
    expires_at: addMinutes(nowIso(), 1),
    created_at: nowIso()
  };

  await supabase.from("dispatch_offers").insert(offer);

  return offer;
}

async function dispatchRide(ride) {
  const driver = await findNearestDriver(ride);

  if (!driver) {
    await supabase
      .from("rides")
      .update({
        status: "no_driver_available",
        updated_at: nowIso()
      })
      .eq("id", ride.id);

    return null;
  }

  const offer = await createDispatchOffer(ride, driver);

  await supabase
    .from("rides")
    .update({
      status: "awaiting_driver_acceptance",
      driver_id: driver.id,
      updated_at: nowIso()
    })
    .eq("id", ride.id);

  return offer;
} /* =========================================================
   DATABASE HELPERS
========================================================= */

async function getRideById(rideId) {
  const { data, error } = await supabase
    .from("rides")
    .select("*")
    .eq("id", rideId)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

async function getRiderById(riderId) {
  const { data, error } = await supabase
    .from("riders")
    .select("*")
    .eq("id", riderId)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

async function getDriverById(driverId) {
  const { data, error } = await supabase
    .from("drivers")
    .select("*")
    .eq("id", driverId)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

async function findRiderByEmail(email) {
  const { data, error } = await supabase
    .from("riders")
    .select("*")
    .eq("email", normalizeEmail(email))
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

async function findDriverByEmail(email) {
  const { data, error } = await supabase
    .from("drivers")
    .select("*")
    .eq("email", normalizeEmail(email))
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

async function getActiveRideForRider(riderId) {
  const { data, error } = await supabase
    .from("rides")
    .select("*")
    .eq("rider_id", riderId)
    .in("status", ACTIVE_RIDE_STATUSES)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

async function getLatestAuthorizedPayment(riderId) {
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

async function updateDriverVerificationStatus(driverId) {
  const driver = await getDriverById(driverId);
  if (!driver) {
    throw new Error("Driver not found.");
  }

  const emailVerified = driver.email_verified === true;
  const smsVerified = driver.sms_verified === true;
  const fullyVerified = emailVerified && smsVerified;

  const patch = {
    verification_status: fullyVerified
      ? "verified"
      : emailVerified || smsVerified
      ? "partially_verified"
      : "pending",
    updated_at: nowIso()
  };

  const { data, error } = await supabase
    .from("drivers")
    .update(patch)
    .eq("id", driverId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

async function sendDriverVerificationEmail(driver) {
  const baseUrl = publicBaseUrl();

  if (!baseUrl) {
    throw new Error(
      "Missing PUBLIC_APP_URL or RENDER_EXTERNAL_URL or APP_BASE_URL."
    );
  }

  const emailToken = driver.email_verification_token || createToken(24);

  if (!driver.email_verification_token) {
    await supabase
      .from("drivers")
      .update({
        email_verification_token: emailToken,
        email_verification_expires_at: addHours(
          nowIso(),
          DRIVER_EMAIL_TOKEN_TTL_HOURS
        ),
        updated_at: nowIso()
      })
      .eq("id", driver.id);
  }

  const verifyLink = `${baseUrl}/api/driver/verify-email?token=${encodeURIComponent(
    emailToken
  )}`;

  const subject = "Verify your Harvey Taxi driver email";
  const text = [
    `Hello ${driver.first_name || "Driver"},`,
    "",
    "Welcome to Harvey Taxi.",
    "Please verify your email to continue your driver onboarding flow.",
    "",
    `Verify now: ${verifyLink}`,
    "",
    "If you did not request this, you can ignore this email."
  ].join("\n");

  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.6;color:#111;">
      <h2>Verify your Harvey Taxi driver email</h2>
      <p>Hello ${driver.first_name || "Driver"},</p>
      <p>Welcome to Harvey Taxi. Please verify your email to continue your driver onboarding flow.</p>
      <p>
        <a href="${verifyLink}" style="display:inline-block;padding:12px 18px;background:#0b5cff;color:#fff;text-decoration:none;border-radius:8px;">
          Verify Email
        </a>
      </p>
      <p>If the button does not work, use this link:</p>
      <p>${verifyLink}</p>
      <p>If you did not request this, you can ignore this email.</p>
    </div>
  `;

  return sendEmailViaSendGrid({
    to: driver.email,
    subject,
    html,
    text
  });
}

async function sendDriverVerificationSms(driver) {
  const smsCode = driver.sms_verification_code || createNumericCode(6);

  if (!driver.sms_verification_code) {
    await supabase
      .from("drivers")
      .update({
        sms_verification_code: smsCode,
        sms_verification_expires_at: addMinutes(
          nowIso(),
          DRIVER_SMS_CODE_TTL_MINUTES
        ),
        sms_verification_attempts: 0,
        updated_at: nowIso()
      })
      .eq("id", driver.id);
  }

  const body = `Harvey Taxi verification code: ${smsCode}. It expires in ${DRIVER_SMS_CODE_TTL_MINUTES} minutes.`;

  return sendSmsViaTwilio({
    to: driver.phone,
    body
  });
}

async function ensureRiderApproved(riderId) {
  const rider = await getRiderById(riderId);

  if (!rider) {
    throw new Error("Rider not found.");
  }

  const approved =
    rider.approved === true ||
    rider.is_approved === true ||
    rider.verification_status === "approved" ||
    rider.verification_status === "verified";

  if (!approved) {
    throw new Error(
      "Rider verification approval is required before requesting a ride."
    );
  }

  return rider;
}

async function ensureNoOpenRideForRider(riderId) {
  const activeRide = await getActiveRideForRider(riderId);

  if (activeRide) {
    throw new Error("Rider already has an active trip.");
  }

  return true;
}

async function ensurePaymentAuthorized(riderId) {
  const payment = await getLatestAuthorizedPayment(riderId);

  if (!payment) {
    throw new Error("Payment authorization is required before dispatch.");
  }

  return payment;
}

/* =========================================================
   AUTH + SIGNUP ROUTES
========================================================= */

app.post("/api/rider/signup", async (req, res) => {
  try {
    const payload = {
      first_name: safeString(getBodyValue(req.body, "first_name", "firstName")),
      last_name: safeString(getBodyValue(req.body, "last_name", "lastName")),
      email: normalizeEmail(getBodyValue(req.body, "email")),
      phone: normalizePhone(getBodyValue(req.body, "phone")),
      password: safeString(getBodyValue(req.body, "password")),
      city: safeString(getBodyValue(req.body, "city")),
      state: safeString(getBodyValue(req.body, "state"))
    };

    const missing = requireFields(payload, [
      "first_name",
      "last_name",
      "email",
      "phone",
      "password"
    ]);

    if (missing) {
      return res.status(400).json({
        success: false,
        error: missing
      });
    }

    const existing = await findRiderByEmail(payload.email);
    if (existing) {
      return res.status(409).json({
        success: false,
        error: "A rider with this email already exists."
      });
    }

    const row = {
      id: createId("rdr"),
      ...payload,
      approved: false,
      verification_status: "pending",
      created_at: nowIso(),
      updated_at: nowIso()
    };

    const { data, error } = await supabase
      .from("riders")
      .insert(row)
      .select()
      .single();

    if (error) throw error;

    return res.json({
      success: true,
      rider: publicRider(data),
      message: "Rider signup submitted. Approval is required before requesting a ride."
    });
  } catch (error) {
    console.error("❌ /api/rider/signup:", error);
    return res.status(500).json({
      success: false,
      error: error.message || "Rider signup failed."
    });
  }
});

app.post("/api/rider/login", async (req, res) => {
  try {
    const email = normalizeEmail(getBodyValue(req.body, "email"));
    const password = safeString(getBodyValue(req.body, "password"));

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: "Email and password are required."
      });
    }

    const rider = await findRiderByEmail(email);

    if (!rider || safeString(rider.password) !== password) {
      return res.status(401).json({
        success: false,
        error: "Invalid rider credentials."
      });
    }

    return res.json({
      success: true,
      rider: publicRider(rider)
    });
  } catch (error) {
    console.error("❌ /api/rider/login:", error);
    return res.status(500).json({
      success: false,
      error: "Rider login failed."
    });
  }
});

app.post("/api/driver/signup", async (req, res) => {
  try {
    const payload = {
      first_name: safeString(getBodyValue(req.body, "first_name", "firstName")),
      last_name: safeString(getBodyValue(req.body, "last_name", "lastName")),
      email: normalizeEmail(getBodyValue(req.body, "email")),
      phone: normalizePhone(getBodyValue(req.body, "phone")),
      password: safeString(getBodyValue(req.body, "password")),
      city: safeString(getBodyValue(req.body, "city")),
      state: safeString(getBodyValue(req.body, "state")),
      vehicle_make: safeString(getBodyValue(req.body, "vehicle_make", "vehicleMake")),
      vehicle_model: safeString(getBodyValue(req.body, "vehicle_model", "vehicleModel")),
      vehicle_year: safeString(getBodyValue(req.body, "vehicle_year", "vehicleYear")),
      vehicle_color: safeString(getBodyValue(req.body, "vehicle_color", "vehicleColor")),
      license_plate: safeString(getBodyValue(req.body, "license_plate", "plate_number", "plateNumber")),
      license_number: safeString(getBodyValue(req.body, "license_number", "licenseNumber")),
      driver_type: normalizeDriverType(getBodyValue(req.body, "driver_type", "driverType"))
    };

    const missing = requireFields(payload, [
      "first_name",
      "last_name",
      "email",
      "phone",
      "password"
    ]);

    if (missing) {
      return res.status(400).json({
        success: false,
        error: missing
      });
    }

    const existing = await findDriverByEmail(payload.email);
    if (existing) {
      return res.status(409).json({
        success: false,
        error: "A driver with this email already exists."
      });
    }

    const row = {
      id: createId("drv"),
      ...payload,
      approved: false,
      status: "offline",
      background_check_status: "pending",
      verification_status: "pending",
      email_verified: false,
      sms_verified: false,
      email_verification_token: createToken(24),
      email_verification_expires_at: addHours(nowIso(), DRIVER_EMAIL_TOKEN_TTL_HOURS),
      sms_verification_code: createNumericCode(6),
      sms_verification_expires_at: addMinutes(nowIso(), DRIVER_SMS_CODE_TTL_MINUTES),
      sms_verification_attempts: 0,
      created_at: nowIso(),
      updated_at: nowIso()
    };

    const { data, error } = await supabase
      .from("drivers")
      .insert(row)
      .select()
      .single();

    if (error) throw error;

    await sendDriverVerificationEmail(data);
    await sendDriverVerificationSms(data);

    return res.json({
      success: true,
      driver: publicDriver(data),
      message: "Driver signup submitted. Email and SMS verification are required."
    });
  } catch (error) {
    console.error("❌ /api/driver/signup:", error);
    return res.status(500).json({
      success: false,
      error: error.message || "Driver signup failed."
    });
  }
});

app.post("/api/driver/login", async (req, res) => {
  try {
    const email = normalizeEmail(getBodyValue(req.body, "email"));
    const password = safeString(getBodyValue(req.body, "password"));

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: "Email and password are required."
      });
    }

    const driver = await findDriverByEmail(email);

    if (!driver || safeString(driver.password) !== password) {
      return res.status(401).json({
        success: false,
        error: "Invalid driver credentials."
      });
    }

    return res.json({
      success: true,
      driver: publicDriver(driver)
    });
  } catch (error) {
    console.error("❌ /api/driver/login:", error);
    return res.status(500).json({
      success: false,
      error: "Driver login failed."
    });
  }
});

/* =========================================================
   DRIVER VERIFICATION ROUTES
========================================================= */

app.get("/api/driver/verify-email", async (req, res) => {
  try {
    const token = safeString(req.query.token);

    if (!token) {
      return res.status(400).send("Missing verification token.");
    }

    const { data: driver, error } = await supabase
      .from("drivers")
      .select("*")
      .eq("email_verification_token", token)
      .maybeSingle();

    if (error) throw error;

    if (!driver) {
      return res.status(400).send("Invalid verification token.");
    }

    if (isExpired(driver.email_verification_expires_at)) {
      return res.status(400).send("Verification token expired.");
    }

    await supabase
      .from("drivers")
      .update({
        email_verified: true,
        email_verification_token: null,
        email_verification_expires_at: null,
        updated_at: nowIso()
      })
      .eq("id", driver.id);

    await updateDriverVerificationStatus(driver.id);

    return res.send(`
      <html>
        <body style="font-family:Arial,sans-serif;padding:24px;">
          <h2>Email Verified</h2>
          <p>Your Harvey Taxi driver email has been verified.</p>
          <p>You may return to the app.</p>
        </body>
      </html>
    `);
  } catch (error) {
    console.error("❌ /api/driver/verify-email:", error);
    return res.status(500).send("Verification failed.");
  }
});

app.post("/api/driver/verify-sms", async (req, res) => {
  try {
    const driverId = safeString(getBodyValue(req.body, "driver_id", "driverId"));
    const code = safeString(getBodyValue(req.body, "code"));

    if (!driverId || !code) {
      return res.status(400).json({
        success: false,
        error: "driver_id and code are required."
      });
    }

    const driver = await getDriverById(driverId);

    if (!driver) {
      return res.status(404).json({
        success: false,
        error: "Driver not found."
      });
    }

    const attempts = safeNumber(driver.sms_verification_attempts, 0);

    if (attempts >= DRIVER_SMS_MAX_ATTEMPTS) {
      return res.status(400).json({
        success: false,
        error: "Too many verification attempts. Request a new code."
      });
    }

    if (isExpired(driver.sms_verification_expires_at)) {
      return res.status(400).json({
        success: false,
        error: "Verification code expired."
      });
    }

    if (safeString(driver.sms_verification_code) !== code) {
      await supabase
        .from("drivers")
        .update({
          sms_verification_attempts: attempts + 1,
          updated_at: nowIso()
        })
        .eq("id", driver.id);

      return res.status(400).json({
        success: false,
        error: "Invalid verification code."
      });
    }

    await supabase
      .from("drivers")
      .update({
        sms_verified: true,
        sms_verification_code: null,
        sms_verification_expires_at: null,
        sms_verification_attempts: 0,
        updated_at: nowIso()
      })
      .eq("id", driver.id);

    const updatedDriver = await updateDriverVerificationStatus(driver.id);

    return res.json({
      success: true,
      verification_status: updatedDriver.verification_status,
      driver: publicDriver(updatedDriver)
    });
  } catch (error) {
    console.error("❌ /api/driver/verify-sms:", error);
    return res.status(500).json({
      success: false,
      error: "SMS verification failed."
    });
  }
});

app.post("/api/driver/resend-verification", async (req, res) => {
  try {
    const driverId = safeString(getBodyValue(req.body, "driver_id", "driverId"));
    const driver = await getDriverById(driverId);

    if (!driver) {
      return res.status(404).json({
        success: false,
        error: "Driver not found."
      });
    }

    const refreshed = {
      email_verification_token: createToken(24),
      email_verification_expires_at: addHours(nowIso(), DRIVER_EMAIL_TOKEN_TTL_HOURS),
      sms_verification_code: createNumericCode(6),
      sms_verification_expires_at: addMinutes(nowIso(), DRIVER_SMS_CODE_TTL_MINUTES),
      sms_verification_attempts: 0,
      updated_at: nowIso()
    };

    const { data, error } = await supabase
      .from("drivers")
      .update(refreshed)
      .eq("id", driver.id)
      .select()
      .single();

    if (error) throw error;

    await sendDriverVerificationEmail(data);
    await sendDriverVerificationSms(data);

    return res.json({
      success: true,
      message: "Verification email and SMS resent."
    });
  } catch (error) {
    console.error("❌ /api/driver/resend-verification:", error);
    return res.status(500).json({
      success: false,
      error: "Unable to resend verification."
    });
  }
}); /* =========================================================
   PAYMENT + FARE + REQUEST RIDE
========================================================= */

app.post("/api/fare-estimate", async (req, res) => {
  try {
    const pickupAddress = safeString(
      getBodyValue(req.body, "pickup_address", "pickupAddress")
    );
    const dropoffAddress = safeString(
      getBodyValue(req.body, "dropoff_address", "dropoffAddress")
    );
    const rideType = normalizeRideType(
      getBodyValue(req.body, "ride_type", "rideType")
    );
    const requestedMode = normalizeRequestedMode(
      getBodyValue(req.body, "requested_mode", "requestedMode")
    );
    const surgeLevel = normalizeSurgeLevel(
      getBodyValue(req.body, "surge_level", "surgeLevel", "normal")
    );

    if (!pickupAddress || !dropoffAddress) {
      return res.status(400).json({
        success: false,
        error: "pickup_address and dropoff_address are required."
      });
    }

    const route = await getDistanceAndDuration(pickupAddress, dropoffAddress);

    if (!route.success) {
      return res.status(400).json({
        success: false,
        error: route.message || "Unable to calculate fare."
      });
    }

    const fare = calculateFare({
      distanceMiles: route.distanceMiles,
      durationMinutes: route.durationMinutes,
      rideType,
      requestedMode,
      surgeLevel
    });

    return res.json({
      success: true,
      pickup_address: route.pickupDisplay,
      dropoff_address: route.dropoffDisplay,
      ride_type: rideType,
      requested_mode: requestedMode,
      ...fare
    });
  } catch (error) {
    console.error("❌ /api/fare-estimate:", error);
    return res.status(500).json({
      success: false,
      error: "Fare estimate failed."
    });
  }
});

app.post("/api/payments/authorize", async (req, res) => {
  try {
    const riderId = safeString(getBodyValue(req.body, "rider_id", "riderId"));
    const amount = roundMoney(getBodyValue(req.body, "amount", "estimated_total"));
    const paymentMethod = safeString(
      getBodyValue(req.body, "payment_method", "paymentMethod", "card")
    ) || "card";
    const notes = safeString(getBodyValue(req.body, "notes"));

    if (!riderId || !amount) {
      return res.status(400).json({
        success: false,
        error: "rider_id and amount are required."
      });
    }

    const rider = await getRiderById(riderId);
    if (!rider) {
      return res.status(404).json({
        success: false,
        error: "Rider not found."
      });
    }

    const row = {
      id: createId("pay"),
      rider_id: riderId,
      amount,
      payment_method: paymentMethod,
      status: "authorized",
      notes,
      created_at: nowIso(),
      updated_at: nowIso()
    };

    const { data, error } = await supabase
      .from("payments")
      .insert(row)
      .select()
      .single();

    if (error) throw error;

    return res.json({
      success: true,
      payment: data
    });
  } catch (error) {
    console.error("❌ /api/payments/authorize:", error);
    return res.status(500).json({
      success: false,
      error: "Payment authorization failed."
    });
  }
});

app.post("/api/request-ride", async (req, res) => {
  try {
    const riderId = safeString(getBodyValue(req.body, "rider_id", "riderId"));
    const pickupAddress = safeString(
      getBodyValue(req.body, "pickup_address", "pickupAddress")
    );
    const dropoffAddress = safeString(
      getBodyValue(req.body, "dropoff_address", "dropoffAddress")
    );
    const notes = safeString(getBodyValue(req.body, "notes"));
    const rideType = normalizeRideType(
      getBodyValue(req.body, "ride_type", "rideType")
    );
    const requestedMode = normalizeRequestedMode(
      getBodyValue(req.body, "requested_mode", "requestedMode")
    );
    const scheduledFor = safeString(
      getBodyValue(req.body, "scheduled_for", "scheduledFor")
    );
    const surgeLevel = normalizeSurgeLevel(
      getBodyValue(req.body, "surge_level", "surgeLevel", "normal")
    );

    if (!riderId || !pickupAddress || !dropoffAddress) {
      return res.status(400).json({
        success: false,
        error: "rider_id, pickup_address, and dropoff_address are required."
      });
    }

    const rider = await ensureRiderApproved(riderId);
    await ensureNoOpenRideForRider(riderId);
    const payment = await ensurePaymentAuthorized(riderId);

    const pickupGeo = await geocodeAddress(pickupAddress);
    const dropoffGeo = await geocodeAddress(dropoffAddress);

    if (!pickupGeo.success || !dropoffGeo.success) {
      return res.status(400).json({
        success: false,
        error: "Unable to verify trip addresses."
      });
    }

    const route = await getDistanceAndDuration(
      pickupGeo.formattedAddress,
      dropoffGeo.formattedAddress
    );

    if (!route.success) {
      return res.status(400).json({
        success: false,
        error: route.message || "Unable to calculate trip route."
      });
    }

    const fare = calculateFare({
      distanceMiles: route.distanceMiles,
      durationMinutes: route.durationMinutes,
      rideType,
      requestedMode,
      surgeLevel
    });

    const rideRow = {
      id: createId("ride"),
      rider_id: rider.id,
      rider_name: `${rider.first_name || ""} ${rider.last_name || ""}`.trim(),
      pickup_address: pickupGeo.formattedAddress,
      dropoff_address: dropoffGeo.formattedAddress,
      pickup_latitude: pickupGeo.latitude,
      pickup_longitude: pickupGeo.longitude,
      dropoff_latitude: dropoffGeo.latitude,
      dropoff_longitude: dropoffGeo.longitude,
      notes,
      ride_type: rideType,
      requested_mode: requestedMode,
      scheduled_for: scheduledFor || null,
      estimated_distance_miles: roundMoney(route.distanceMiles),
      estimated_duration_minutes: roundMoney(route.durationMinutes),
      estimated_fare: fare.estimatedTotal,
      payment_id: payment.id,
      dispatch_attempts: 0,
      status: "requested",
      created_at: nowIso(),
      updated_at: nowIso()
    };

    const { data: ride, error } = await supabase
      .from("rides")
      .insert(rideRow)
      .select()
      .single();

    if (error) throw error;

    await recordMissionForRide(ride);
    const dispatch = await dispatchRide(ride);

    return res.json({
      success: true,
      ride_id: ride.id,
      ride,
      fare,
      dispatch
    });
  } catch (error) {
    console.error("❌ /api/request-ride:", error);
    return res.status(400).json({
      success: false,
      error: error.message || "Ride request failed."
    });
  }
});

/* =========================================================
   DRIVER MISSIONS + DRIVER ACTIONS
========================================================= */

app.get("/api/driver/:driverId/missions", async (req, res) => {
  try {
    const driverId = safeString(req.params.driverId);

    const { data, error } = await supabase
      .from("rides")
      .select("*")
      .eq("driver_id", driverId)
      .in("status", [
        "awaiting_driver_acceptance",
        "driver_assigned",
        "en_route",
        "arrived",
        "in_progress"
      ])
      .order("created_at", { ascending: false });

    if (error) throw error;

    return res.json({
      success: true,
      missions: data || []
    });
  } catch (error) {
    console.error("❌ /api/driver/:driverId/missions:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to load driver missions."
    });
  }
});

app.post("/api/driver/:driverId/availability", async (req, res) => {
  try {
    const driverId = safeString(req.params.driverId);
    const isAvailable = normalizeBoolean(
      getBodyValue(req.body, "is_available", "isAvailable"),
      false
    );

    const status = isAvailable ? "available" : "offline";

    const { data, error } = await supabase
      .from("drivers")
      .update({
        status,
        updated_at: nowIso()
      })
      .eq("id", driverId)
      .select()
      .single();

    if (error) throw error;

    return res.json({
      success: true,
      driver: publicDriver(data)
    });
  } catch (error) {
    console.error("❌ /api/driver/:driverId/availability:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to update driver availability."
    });
  }
});

app.post("/api/driver/accept", async (req, res) => {
  try {
    const dispatchId = safeString(
      getBodyValue(req.body, "dispatch_id", "dispatchId")
    );
    const driverId = safeString(
      getBodyValue(req.body, "driver_id", "driverId")
    );

    if (!dispatchId || !driverId) {
      return res.status(400).json({
        success: false,
        error: "dispatch_id and driver_id are required."
      });
    }

    const { data: dispatch, error: dispatchError } = await supabase
      .from("dispatch_offers")
      .select("*")
      .eq("id", dispatchId)
      .maybeSingle();

    if (dispatchError) throw dispatchError;

    if (!dispatch) {
      return res.status(404).json({
        success: false,
        error: "Dispatch offer not found."
      });
    }

    if (dispatch.driver_id !== driverId) {
      return res.status(403).json({
        success: false,
        error: "This dispatch does not belong to this driver."
      });
    }

    await supabase
      .from("dispatch_offers")
      .update({
        status: "accepted"
      })
      .eq("id", dispatchId);

    const { data: ride, error: rideError } = await supabase
      .from("rides")
      .update({
        status: "driver_assigned",
        assigned_at: nowIso(),
        updated_at: nowIso()
      })
      .eq("id", dispatch.ride_id)
      .select()
      .single();

    if (rideError) throw rideError;

    await supabase
      .from("drivers")
      .update({
        status: "busy",
        updated_at: nowIso()
      })
      .eq("id", driverId);

    return res.json({
      success: true,
      ride
    });
  } catch (error) {
    console.error("❌ /api/driver/accept:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to accept ride."
    });
  }
});

app.post("/api/driver/decline", async (req, res) => {
  try {
    const dispatchId = safeString(
      getBodyValue(req.body, "dispatch_id", "dispatchId")
    );

    if (!dispatchId) {
      return res.status(400).json({
        success: false,
        error: "dispatch_id is required."
      });
    }

    const { data: dispatch, error: dispatchError } = await supabase
      .from("dispatch_offers")
      .select("*")
      .eq("id", dispatchId)
      .maybeSingle();

    if (dispatchError) throw dispatchError;

    if (!dispatch) {
      return res.status(404).json({
        success: false,
        error: "Dispatch offer not found."
      });
    }

    await supabase
      .from("dispatch_offers")
      .update({
        status: "declined"
      })
      .eq("id", dispatchId);

    const ride = await getRideById(dispatch.ride_id);

    if (ride) {
      await supabase
        .from("rides")
        .update({
          status: "dispatching",
          updated_at: nowIso()
        })
        .eq("id", ride.id);

      await dispatchRide({
        ...ride,
        dispatch_attempts: safeNumber(ride.dispatch_attempts, 0) + 1
      });
    }

    return res.json({
      success: true,
      message: "Dispatch declined."
    });
  } catch (error) {
    console.error("❌ /api/driver/decline:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to decline ride."
    });
  }
});

/* =========================================================
   RIDER ACTIVE TRIP + TRIP STATUS
========================================================= */

app.get("/api/rider/:riderId/active", async (req, res) => {
  try {
    const riderId = safeString(req.params.riderId);
    const ride = await getActiveRideForRider(riderId);

    return res.json({
      success: true,
      ride: ride || null
    });
  } catch (error) {
    console.error("❌ /api/rider/:riderId/active:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to load active ride."
    });
  }
});

app.post("/api/trip/status", async (req, res) => {
  try {
    const rideId = safeString(getBodyValue(req.body, "ride_id", "rideId"));
    const status = safeString(getBodyValue(req.body, "status"));

    if (!rideId || !status) {
      return res.status(400).json({
        success: false,
        error: "ride_id and status are required."
      });
    }

    const { data: ride, error } = await supabase
      .from("rides")
      .update({
        status,
        updated_at: nowIso(),
        ...(status === "completed" ? { completed_at: nowIso() } : {}),
        ...(status === "cancelled" ? { cancelled_at: nowIso() } : {})
      })
      .eq("id", rideId)
      .select()
      .single();

    if (error) throw error;

    if (FINAL_RIDE_STATUSES.includes(safeLower(status)) && ride.driver_id) {
      await supabase
        .from("drivers")
        .update({
          status: "available",
          updated_at: nowIso()
        })
        .eq("id", ride.driver_id);
    }

    return res.json({
      success: true,
      ride
    });
  } catch (error) {
    console.error("❌ /api/trip/status:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to update trip status."
    });
  }
});

/* =========================================================
   AI ROUTES
========================================================= */

app.post("/api/ai/support", async (req, res) => {
  try {
    const message = safeString(getBodyValue(req.body, "message", "question"));
    const page = safeString(getBodyValue(req.body, "page", "pageMode")) || "general";

    if (!message) {
      return res.status(400).json({
        success: false,
        error: "message is required."
      });
    }

    const reply = await generateAiSupportReply({
      message,
      page
    });

    return res.json({
      success: true,
      reply
    });
  } catch (error) {
    console.error("❌ /api/ai/support:", error);
    return res.status(500).json({
      success: false,
      error: "AI support failed."
    });
  }
});

app.post("/api/ai/dispatch/optimize", async (req, res) => {
  try {
    const rideId = safeString(getBodyValue(req.body, "ride_id", "rideId"));

    if (!rideId) {
      return res.status(400).json({
        success: false,
        error: "ride_id is required."
      });
    }

    const ride = await getRideById(rideId);

    if (!ride) {
      return res.status(404).json({
        success: false,
        error: "Ride not found."
      });
    }

    const dispatch = await dispatchRide(ride);

    return res.json({
      success: true,
      dispatch
    });
  } catch (error) {
    console.error("❌ /api/ai/dispatch/optimize:", error);
    return res.status(500).json({
      success: false,
      error: "Dispatch optimization failed."
    });
  }
});

/* =========================================================
   ADMIN + HEALTH + ROOT
========================================================= */

app.post("/api/admin/login", (req, res) => {
  const email = normalizeEmail(getBodyValue(req.body, "email"));
  const password = safeString(getBodyValue(req.body, "password"));

  if (email === normalizeEmail(ADMIN_EMAIL) && password === ADMIN_PASSWORD) {
    return res.json({
      success: true,
      message: "Admin login successful."
    });
  }

  return res.status(401).json({
    success: false,
    error: "Invalid admin credentials."
  });
});

app.get("/api/health", async (req, res) => {
  const diagnostics = buildDiagnostics();

  try {
    const startedAt = Date.now();

    const { data, error } = await supabase
      .from("riders")
      .select("id")
      .limit(1);

    if (error) {
      return res.status(500).json({
        ok: false,
        success: false,
        database: "query_failed",
        error: error.message,
        diagnostics
      });
    }

    return res.json({
      ok: true,
      success: true,
      database: "connected",
      latency_ms: Date.now() - startedAt,
      sample_count: Array.isArray(data) ? data.length : 0,
      diagnostics
    });
  } catch (error) {
    console.error("❌ /api/health connectivity error:", error);

    return res.status(500).json({
      ok: false,
      success: false,
      database: "disconnected",
      error: error.message,
      error_name: error.name || "Error",
      error_stack_top: String(error.stack || "")
        .split("\n")
        .slice(0, 3),
      diagnostics
    });
  }
});

app.get("/api/debug/runtime", (req, res) => {
  return res.json({
    success: true,
    node_version: process.version,
    has_global_fetch: typeof fetch === "function",
    diagnostics: buildDiagnostics()
  });
});

app.get("/", (req, res) => {
  return res.json({
    success: true,
    message: "Harvey Taxi API running"
  });
});

/* =========================================================
   START SERVER
========================================================= */

app.listen(PORT, () => {
  console.log("=================================");
  console.log("Harvey Taxi API running");
  console.log("Port:", PORT);
  console.log("OpenAI enabled:", !!OPENAI_API_KEY);
  console.log("Google Maps enabled:", !!GOOGLE_MAPS_API_KEY);
  console.log("SendGrid enabled:", hasSendGrid);
  console.log("Twilio enabled:", hasTwilio);
  console.log("=================================");
});

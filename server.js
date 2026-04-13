/* =========================================================
   HARVEY TAXI — CODE BLUE CLEAN REBUILD
   PART 1: FOUNDATION + ENV + CLIENTS + HELPERS + HEALTH
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
} catch (err) {
  console.warn("⚠️ OpenAI not installed");
}

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
function cleanEnv(value = "") {
  return String(value || "")
    .trim()
    .replace(/^['"]|['"]$/g, "");
}

function toBool(value, fallback = false) {
  const v = cleanEnv(value).toLowerCase();
  if (!v) return fallback;
  return ["true", "1", "yes"].includes(v);
}

/* =========================================================
   ENV CONFIG
========================================================= */
const SUPABASE_URL = cleanEnv(process.env.SUPABASE_URL);
const SUPABASE_KEY = cleanEnv(process.env.SUPABASE_SERVICE_ROLE_KEY);

const ENABLE_AI = toBool(process.env.ENABLE_AI, true);

/* =========================================================
   CLIENTS
========================================================= */
let supabase = null;
if (SUPABASE_URL && SUPABASE_KEY) {
  supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  console.log("✅ Supabase connected");
} else {
  console.warn("❌ Supabase NOT configured");
}

let openai = null;
if (ENABLE_AI && OpenAI && process.env.OPENAI_API_KEY) {
  openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
  });
  console.log("✅ OpenAI enabled");
} else {
  console.warn("⚠️ AI disabled");
}

/* =========================================================
   HELPERS
========================================================= */
function generateId(prefix = "id") {
  return `${prefix}_${crypto.randomBytes(6).toString("hex")}`;
}

function now() {
  return new Date().toISOString();
}

/* =========================================================
   HEALTH CHECK
========================================================= */
app.get("/api/health", async (req, res) => {
  let db = false;

  try {
    if (supabase) {
      const { error } = await supabase.from("riders").select("id").limit(1);
      db = !error;
    }
  } catch (e) {
    db = false;
  }

  res.json({
    ok: true,
    server_time: now(),
    started_at: SERVER_STARTED_AT,
    services: {
      database: db,
      ai: !!openai
    }
  });
});/* =========================================================
   PART 2: AI SUPPORT + FALLBACK BRAIN
========================================================= */

const OPENAI_SUPPORT_MODEL = cleanEnv(process.env.OPENAI_SUPPORT_MODEL || "gpt-4.1-mini");

/* =========================================================
   PAGE CONTEXT DETECTION
========================================================= */
function normalizePage(page = "") {
  const value = cleanEnv(page).toLowerCase();

  if (!value) return "general";
  if (["home", "index", "landing"].includes(value)) return "general";
  if (["rider", "rider-signup", "rider-dashboard"].includes(value)) return "rider";
  if (["driver", "driver-signup", "driver-dashboard"].includes(value)) return "driver";
  if (["request", "request-ride", "ride"].includes(value)) return "request";
  if (["support", "help", "faq"].includes(value)) return "support";

  return value;
}

/* =========================================================
   FALLBACK SUPPORT REPLIES
========================================================= */
function getFallbackReply(message = "", page = "general") {
  const text = cleanEnv(message).toLowerCase();
  const currentPage = normalizePage(page);

  if (!text) {
    return "I can help with rides, driver signup, rider approval, payments, and platform support.";
  }

  if (text.includes("ride") || text.includes("request a ride") || text.includes("book")) {
    return "You can request a ride after your rider account is approved and payment is authorized.";
  }

  if (text.includes("driver") || text.includes("become a driver") || text.includes("drive")) {
    return "To become a driver, complete signup, verification, and approval before going active.";
  }

  if (text.includes("payment") || text.includes("card") || text.includes("charge")) {
    return "Harvey Taxi uses payment authorization before dispatch to help keep trip flow smooth and secure.";
  }

  if (text.includes("autonomous") || text.includes("av") || text.includes("self-driving")) {
    return "Autonomous service is currently in pilot mode and is clearly labeled when available.";
  }

  if (text.includes("approval") || text.includes("approved") || text.includes("verification")) {
    return "Account approval and verification must be completed before protected features become available.";
  }

  if (text.includes("support") || text.includes("help") || text.includes("contact")) {
    return "For additional support, contact Harvey Taxi support at williebee@harveytaxiservice.com.";
  }

  if (currentPage === "rider") {
    return "I can help with rider signup, rider approval status, and when ride access becomes available.";
  }

  if (currentPage === "driver") {
    return "I can help with driver signup, document steps, approval, and going active after verification.";
  }

  if (currentPage === "request") {
    return "I can help with requesting rides, dispatch flow, payment authorization, and ride status questions.";
  }

  return "I can help with rides, driver signup, payments, approvals, autonomous pilot questions, and support.";
}

/* =========================================================
   AI SYSTEM PROMPT
========================================================= */
function buildSupportSystemPrompt(page = "general") {
  const currentPage = normalizePage(page);

  return `
You are Harvey AI, the support assistant for Harvey Taxi Service LLC.

Your role:
- Help riders, drivers, and visitors understand the platform
- Be clear, calm, accurate, and helpful
- Never invent approvals, bookings, charges, or ride status
- Do not claim emergency support
- If the issue sounds urgent or dangerous, tell the user to call 911

Business rules:
- Riders must be approved before requesting rides
- Payment authorization is required before dispatch
- Drivers must complete signup, verification, and approval before going active
- Autonomous rides are pilot-mode only when offered
- Do not promise service availability unless the system confirms it

Support email:
- williebee@harveytaxiservice.com

Current page context:
- ${currentPage}

Style:
- Keep answers short, helpful, and direct
- Explain next steps when possible
- If you do not know something, say so plainly
`.trim();
}

/* =========================================================
   AI RESPONSE GENERATOR
========================================================= */
async function generateSupportReply({
  message = "",
  page = "general",
  riderId = "",
  driverId = "",
  rideId = ""
}) {
  const safeMessage = cleanEnv(message);
  const safePage = normalizePage(page);

  if (!safeMessage) {
    return {
      ok: true,
      reply: getFallbackReply("", safePage),
      source: "fallback"
    };
  }

  if (!openai) {
    return {
      ok: true,
      reply: getFallbackReply(safeMessage, safePage),
      source: "fallback"
    };
  }

  try {
    const contextLine = [
      riderId ? `rider_id=${cleanEnv(riderId)}` : null,
      driverId ? `driver_id=${cleanEnv(driverId)}` : null,
      rideId ? `ride_id=${cleanEnv(rideId)}` : null
    ]
      .filter(Boolean)
      .join(", ");

    const prompt = contextLine
      ? `Context: ${contextLine}\nUser message: ${safeMessage}`
      : `User message: ${safeMessage}`;

    const response = await openai.responses.create({
      model: OPENAI_SUPPORT_MODEL,
      input: [
        {
          role: "system",
          content: buildSupportSystemPrompt(safePage)
        },
        {
          role: "user",
          content: prompt
        }
      ]
    });

    const reply =
      cleanEnv(response?.output_text) ||
      getFallbackReply(safeMessage, safePage);

    return {
      ok: true,
      reply,
      source: cleanEnv(response?.output_text) ? "openai" : "fallback"
    };
  } catch (error) {
    console.error("AI support error:", error.message);
    return {
      ok: true,
      reply: getFallbackReply(safeMessage, safePage),
      source: "fallback"
    };
  }
}

/* =========================================================
   AI SUPPORT ENDPOINT
========================================================= */
app.post("/api/ai/support", async (req, res) => {
  try {
    const message = cleanEnv(req.body?.message);
    const page = cleanEnv(req.body?.page || "general");
    const riderId = cleanEnv(req.body?.rider_id || req.body?.riderId);
    const driverId = cleanEnv(req.body?.driver_id || req.body?.driverId);
    const rideId = cleanEnv(req.body?.ride_id || req.body?.rideId);

    const result = await generateSupportReply({
      message,
      page,
      riderId,
      driverId,
      rideId
    });

    return res.json({
      ok: true,
      reply: result.reply,
      source: result.source,
      page: normalizePage(page),
      timestamp: now()
    });
  } catch (error) {
    console.error("POST /api/ai/support error:", error.message);

    return res.status(500).json({
      ok: false,
      reply: "Support is temporarily unavailable right now. Please try again.",
      source: "server_error",
      timestamp: now()
    });
  }
});/* =========================================================
   PART 3: RIDER SIGNUP + RIDER STATUS + APPROVAL GATE
========================================================= */

const ENABLE_RIDER_APPROVAL_GATE = toBool(
  process.env.ENABLE_RIDER_APPROVAL_GATE,
  true
);

/* =========================================================
   RIDER HELPERS
========================================================= */
function normalizeEmail(value = "") {
  return cleanEnv(value).toLowerCase();
}

function normalizePhone(value = "") {
  return cleanEnv(value).replace(/[^\d+]/g, "");
}

function mapRiderRow(row = {}) {
  return {
    rider_id: cleanEnv(row.id),
    first_name: cleanEnv(row.first_name),
    last_name: cleanEnv(row.last_name),
    email: normalizeEmail(row.email),
    phone: normalizePhone(row.phone),
    city: cleanEnv(row.city),
    state: cleanEnv(row.state),
    status: cleanEnv(row.status || "pending"),
    approval_status: cleanEnv(row.approval_status || row.status || "pending"),
    verification_status: cleanEnv(row.verification_status || "pending"),
    created_at: row.created_at || null,
    updated_at: row.updated_at || null
  };
}

async function getRiderById(riderId = "") {
  if (!supabase) throw new Error("Database unavailable");

  const id = cleanEnv(riderId);
  if (!id) return null;

  const { data, error } = await supabase
    .from("riders")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

async function getRiderByEmail(email = "") {
  if (!supabase) throw new Error("Database unavailable");

  const normalized = normalizeEmail(email);
  if (!normalized) return null;

  const { data, error } = await supabase
    .from("riders")
    .select("*")
    .ilike("email", normalized)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

async function getRiderByPhone(phone = "") {
  if (!supabase) throw new Error("Database unavailable");

  const normalized = normalizePhone(phone);
  if (!normalized) return null;

  const { data, error } = await supabase
    .from("riders")
    .select("*")
    .eq("phone", normalized)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

function riderIsApproved(rider = {}) {
  const approval = cleanEnv(
    rider.approval_status || rider.status || "pending"
  ).toLowerCase();

  const verification = cleanEnv(
    rider.verification_status || "pending"
  ).toLowerCase();

  if (["approved", "active"].includes(approval)) return true;
  if (approval === "verified" && verification === "approved") return true;

  return false;
}

function getRiderAccessPayload(rider = {}) {
  const approved = riderIsApproved(rider);

  return {
    rider_id: cleanEnv(rider.id),
    access_granted: approved,
    approval_status: cleanEnv(rider.approval_status || rider.status || "pending"),
    verification_status: cleanEnv(rider.verification_status || "pending"),
    can_request_ride: approved,
    message: approved
      ? "Rider account approved. Ride access is enabled."
      : "Rider account is not approved yet. Ride access remains locked until approval is complete."
  };
}

/* =========================================================
   RIDER SIGNUP
========================================================= */
app.post("/api/rider/signup", async (req, res) => {
  try {
    if (!supabase) {
      return res.status(500).json({
        ok: false,
        error: "Database unavailable"
      });
    }

    const first_name = cleanEnv(req.body?.firstName || req.body?.first_name);
    const last_name = cleanEnv(req.body?.lastName || req.body?.last_name);
    const email = normalizeEmail(req.body?.email);
    const phone = normalizePhone(req.body?.phone);
    const city = cleanEnv(req.body?.city);
    const state = cleanEnv(req.body?.state || "TN");
    const password = cleanEnv(req.body?.password);

    if (!first_name || !last_name || !email || !phone || !city || !state || !password) {
      return res.status(400).json({
        ok: false,
        error: "Missing required rider signup fields"
      });
    }

    const existingByEmail = await getRiderByEmail(email);
    if (existingByEmail) {
      return res.status(409).json({
        ok: false,
        error: "A rider with that email already exists",
        rider: mapRiderRow(existingByEmail),
        access: getRiderAccessPayload(existingByEmail)
      });
    }

    const existingByPhone = await getRiderByPhone(phone);
    if (existingByPhone) {
      return res.status(409).json({
        ok: false,
        error: "A rider with that phone already exists",
        rider: mapRiderRow(existingByPhone),
        access: getRiderAccessPayload(existingByPhone)
      });
    }

    const rider_id = generateId("rider");

    const insertPayload = {
      id: rider_id,
      first_name,
      last_name,
      email,
      phone,
      city,
      state,
      password,
      status: "pending",
      approval_status: "pending",
      verification_status: "pending",
      created_at: now(),
      updated_at: now()
    };

    const { data, error } = await supabase
      .from("riders")
      .insert(insertPayload)
      .select("*")
      .single();

    if (error) {
      console.error("Rider signup insert error:", error.message);
      return res.status(500).json({
        ok: false,
        error: "Failed to create rider account"
      });
    }

    return res.status(201).json({
      ok: true,
      message: "Rider signup submitted successfully",
      rider: mapRiderRow(data),
      access: getRiderAccessPayload(data)
    });
  } catch (error) {
    console.error("POST /api/rider/signup error:", error.message);
    return res.status(500).json({
      ok: false,
      error: "Unable to complete rider signup"
    });
  }
});

/* =========================================================
   RIDER STATUS CHECK
========================================================= */
app.get("/api/rider/status/:riderId", async (req, res) => {
  try {
    const rider = await getRiderById(req.params?.riderId);

    if (!rider) {
      return res.status(404).json({
        ok: false,
        error: "Rider not found"
      });
    }

    return res.json({
      ok: true,
      rider: mapRiderRow(rider),
      access: getRiderAccessPayload(rider)
    });
  } catch (error) {
    console.error("GET /api/rider/status/:riderId error:", error.message);
    return res.status(500).json({
      ok: false,
      error: "Unable to retrieve rider status"
    });
  }
});

/* =========================================================
   RIDER STATUS CHECK BY EMAIL
========================================================= */
app.post("/api/rider/status", async (req, res) => {
  try {
    const riderId = cleanEnv(req.body?.rider_id || req.body?.riderId);
    const email = normalizeEmail(req.body?.email);

    let rider = null;

    if (riderId) {
      rider = await getRiderById(riderId);
    } else if (email) {
      rider = await getRiderByEmail(email);
    } else {
      return res.status(400).json({
        ok: false,
        error: "Provide rider_id or email"
      });
    }

    if (!rider) {
      return res.status(404).json({
        ok: false,
        error: "Rider not found"
      });
    }

    return res.json({
      ok: true,
      rider: mapRiderRow(rider),
      access: getRiderAccessPayload(rider)
    });
  } catch (error) {
    console.error("POST /api/rider/status error:", error.message);
    return res.status(500).json({
      ok: false,
      error: "Unable to retrieve rider status"
    });
  }
});

/* =========================================================
   RIDER APPROVAL GUARD
========================================================= */
async function requireApprovedRider(req, res, next) {
  try {
    if (!ENABLE_RIDER_APPROVAL_GATE) {
      req.rider = null;
      return next();
    }

    const riderId = cleanEnv(
      req.body?.rider_id ||
      req.body?.riderId ||
      req.query?.rider_id ||
      req.query?.riderId ||
      req.params?.riderId
    );

    if (!riderId) {
      return res.status(400).json({
        ok: false,
        error: "rider_id is required"
      });
    }

    const rider = await getRiderById(riderId);

    if (!rider) {
      return res.status(404).json({
        ok: false,
        error: "Rider not found"
      });
    }

    if (!riderIsApproved(rider)) {
      return res.status(403).json({
        ok: false,
        error: "Rider account is not approved yet",
        rider: mapRiderRow(rider),
        access: getRiderAccessPayload(rider)
      });
    }

    req.rider = rider;
    return next();
  } catch (error) {
    console.error("requireApprovedRider error:", error.message);
    return res.status(500).json({
      ok: false,
      error: "Unable to verify rider approval"
    });
  }
}/* =========================================================
   PART 4: PAYMENTS + FARE ESTIMATION + RIDE REQUEST
========================================================= */

const ENABLE_PAYMENT_GATE = toBool(process.env.ENABLE_PAYMENT_GATE, true);

const BASE_FARE = Number(process.env.BASE_FARE || 8);
const PER_MILE_RATE = Number(process.env.PER_MILE_RATE || 2.4);
const PER_MINUTE_RATE = Number(process.env.PER_MINUTE_RATE || 0.45);
const BOOKING_FEE = Number(process.env.BOOKING_FEE || 2.5);
const MINIMUM_FARE = Number(process.env.MINIMUM_FARE || 12);

const HUMAN_MODE_MULTIPLIER = Number(process.env.HUMAN_MODE_MULTIPLIER || 1);
const AUTONOMOUS_MODE_MULTIPLIER = Number(
  process.env.AUTONOMOUS_MODE_MULTIPLIER || 0.95
);

/* =========================================================
   PAYMENT HELPERS
========================================================= */
function toMoney(value = 0) {
  const number = Number(value || 0);
  return Math.round(number * 100) / 100;
}

function normalizeRequestedMode(value = "") {
  const mode = cleanEnv(value).toLowerCase();
  if (mode === "autonomous" || mode === "av" || mode === "pilot") {
    return "autonomous";
  }
  return "driver";
}

function rideModeMultiplier(mode = "driver") {
  return normalizeRequestedMode(mode) === "autonomous"
    ? AUTONOMOUS_MODE_MULTIPLIER
    : HUMAN_MODE_MULTIPLIER;
}

async function getLatestAuthorizedPayment(riderId = "") {
  if (!supabase) throw new Error("Database unavailable");

  const safeRiderId = cleanEnv(riderId);
  if (!safeRiderId) return null;

  const { data, error } = await supabase
    .from("payments")
    .select("*")
    .eq("rider_id", safeRiderId)
    .in("status", ["authorized", "held", "preauthorized"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

function paymentIsAuthorized(payment = {}) {
  const status = cleanEnv(payment.status).toLowerCase();
  return ["authorized", "held", "preauthorized"].includes(status);
}

async function requireAuthorizedPayment(req, res, next) {
  try {
    if (!ENABLE_PAYMENT_GATE) {
      req.payment = null;
      return next();
    }

    const riderId = cleanEnv(
      req.body?.rider_id ||
        req.body?.riderId ||
        req.query?.rider_id ||
        req.query?.riderId ||
        req.params?.riderId
    );

    if (!riderId) {
      return res.status(400).json({
        ok: false,
        error: "rider_id is required for payment validation"
      });
    }

    const payment = await getLatestAuthorizedPayment(riderId);

    if (!payment || !paymentIsAuthorized(payment)) {
      return res.status(403).json({
        ok: false,
        error: "Payment authorization is required before dispatch",
        payment_required: true
      });
    }

    req.payment = payment;
    return next();
  } catch (error) {
    console.error("requireAuthorizedPayment error:", error.message);
    return res.status(500).json({
      ok: false,
      error: "Unable to verify payment authorization"
    });
  }
}

/* =========================================================
   ESTIMATION HELPERS
========================================================= */
function estimateDistanceMiles(pickup = "", destination = "") {
  const pickupText = cleanEnv(pickup);
  const destinationText = cleanEnv(destination);

  if (!pickupText || !destinationText) return 0;

  const combinedLength = pickupText.length + destinationText.length;
  const estimated = Math.max(3, Math.min(35, combinedLength / 6));

  return toMoney(estimated);
}

function estimateDurationMinutes(distanceMiles = 0) {
  const miles = Number(distanceMiles || 0);
  const estimated = Math.max(8, miles * 2.6);
  return Math.round(estimated);
}

function buildFareEstimate({
  pickup = "",
  destination = "",
  requestedMode = "driver"
}) {
  const mode = normalizeRequestedMode(requestedMode);
  const distance_miles = estimateDistanceMiles(pickup, destination);
  const duration_minutes = estimateDurationMinutes(distance_miles);
  const multiplier = rideModeMultiplier(mode);

  const rawFare =
    (BASE_FARE + distance_miles * PER_MILE_RATE + duration_minutes * PER_MINUTE_RATE + BOOKING_FEE) *
    multiplier;

  const estimated_fare = toMoney(Math.max(rawFare, MINIMUM_FARE));
  const driver_payout_estimate = toMoney(estimated_fare * 0.75);
  const platform_fee_estimate = toMoney(estimated_fare - driver_payout_estimate);

  return {
    requested_mode: mode,
    distance_miles,
    duration_minutes,
    pricing: {
      base_fare: toMoney(BASE_FARE),
      per_mile_rate: toMoney(PER_MILE_RATE),
      per_minute_rate: toMoney(PER_MINUTE_RATE),
      booking_fee: toMoney(BOOKING_FEE),
      minimum_fare: toMoney(MINIMUM_FARE),
      mode_multiplier: toMoney(multiplier)
    },
    estimated_fare,
    driver_payout_estimate,
    platform_fee_estimate
  };
}

/* =========================================================
   FARE ESTIMATE ENDPOINT
========================================================= */
app.post("/api/fare-estimate", async (req, res) => {
  try {
    const pickup = cleanEnv(req.body?.pickup || req.body?.pickup_address);
    const destination = cleanEnv(
      req.body?.destination || req.body?.dropoff || req.body?.destination_address
    );
    const requestedMode = cleanEnv(
      req.body?.requestedMode || req.body?.requested_mode || "driver"
    );

    if (!pickup || !destination) {
      return res.status(400).json({
        ok: false,
        error: "pickup and destination are required"
      });
    }

    const estimate = buildFareEstimate({
      pickup,
      destination,
      requestedMode
    });

    return res.json({
      ok: true,
      ...estimate,
      timestamp: now()
    });
  } catch (error) {
    console.error("POST /api/fare-estimate error:", error.message);
    return res.status(500).json({
      ok: false,
      error: "Unable to calculate fare estimate"
    });
  }
});

/* =========================================================
   REQUEST RIDE
========================================================= */
app.post(
  "/api/request-ride",
  requireApprovedRider,
  requireAuthorizedPayment,
  async (req, res) => {
    try {
      if (!supabase) {
        return res.status(500).json({
          ok: false,
          error: "Database unavailable"
        });
      }

      const rider_id = cleanEnv(req.body?.rider_id || req.body?.riderId || req.rider?.id);
      const pickup = cleanEnv(req.body?.pickup || req.body?.pickup_address);
      const destination = cleanEnv(
        req.body?.destination || req.body?.dropoff || req.body?.destination_address
      );
      const notes = cleanEnv(req.body?.notes);
      const requested_mode = normalizeRequestedMode(
        req.body?.requestedMode || req.body?.requested_mode || "driver"
      );

      if (!pickup || !destination) {
        return res.status(400).json({
          ok: false,
          error: "pickup and destination are required"
        });
      }

      const estimate = buildFareEstimate({
        pickup,
        destination,
        requestedMode: requested_mode
      });

      const ride_id = generateId("ride");

      const insertPayload = {
        id: ride_id,
        rider_id,
        pickup_address: pickup,
        destination_address: destination,
        notes,
        requested_mode,
        status: "awaiting_driver_acceptance",
        fare_estimate: estimate.estimated_fare,
        estimated_distance_miles: estimate.distance_miles,
        estimated_duration_minutes: estimate.duration_minutes,
        payment_status: req.payment ? cleanEnv(req.payment.status) : "authorized",
        payment_id: cleanEnv(req.payment?.id),
        created_at: now(),
        updated_at: now()
      };

      const { data, error } = await supabase
        .from("rides")
        .insert(insertPayload)
        .select("*")
        .single();

      if (error) {
        console.error("Ride request insert error:", error.message);
        return res.status(500).json({
          ok: false,
          error: "Failed to create ride request"
        });
      }

      return res.status(201).json({
        ok: true,
        message: "Ride request created successfully",
        ride_id: cleanEnv(data.id),
        ride: data,
        fare_estimate: estimate,
        dispatch_status: "pending_dispatch",
        timestamp: now()
      });
    } catch (error) {
      console.error("POST /api/request-ride error:", error.message);
      return res.status(500).json({
        ok: false,
        error: "Unable to request ride"
      });
    }
  }
);/* =========================================================
   PART 5: DRIVER SIGNUP + STATUS + APPROVAL + MISSION ACCESS
========================================================= */

const ENABLE_DRIVER_APPROVAL_GATE = toBool(
  process.env.ENABLE_DRIVER_APPROVAL_GATE,
  true
);

/* =========================================================
   DRIVER HELPERS
========================================================= */
function normalizeDriverType(value = "") {
  const type = cleanEnv(value).toLowerCase();

  if (["autonomous", "av", "robotaxi", "self-driving"].includes(type)) {
    return "autonomous";
  }

  return "human";
}

function mapDriverRow(row = {}) {
  return {
    driver_id: cleanEnv(row.id),
    first_name: cleanEnv(row.first_name),
    last_name: cleanEnv(row.last_name),
    email: normalizeEmail(row.email),
    phone: normalizePhone(row.phone),
    city: cleanEnv(row.city),
    state: cleanEnv(row.state),
    driver_type: normalizeDriverType(row.driver_type),
    status: cleanEnv(row.status || "pending"),
    approval_status: cleanEnv(row.approval_status || row.status || "pending"),
    verification_status: cleanEnv(row.verification_status || "pending"),
    email_verified: !!row.email_verified,
    sms_verified: !!row.sms_verified,
    vehicle_make: cleanEnv(row.vehicle_make),
    vehicle_model: cleanEnv(row.vehicle_model),
    vehicle_year: cleanEnv(row.vehicle_year),
    license_plate: cleanEnv(row.license_plate),
    created_at: row.created_at || null,
    updated_at: row.updated_at || null
  };
}

async function getDriverById(driverId = "") {
  if (!supabase) throw new Error("Database unavailable");

  const id = cleanEnv(driverId);
  if (!id) return null;

  const { data, error } = await supabase
    .from("drivers")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

async function getDriverByEmail(email = "") {
  if (!supabase) throw new Error("Database unavailable");

  const normalized = normalizeEmail(email);
  if (!normalized) return null;

  const { data, error } = await supabase
    .from("drivers")
    .select("*")
    .ilike("email", normalized)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

async function getDriverByPhone(phone = "") {
  if (!supabase) throw new Error("Database unavailable");

  const normalized = normalizePhone(phone);
  if (!normalized) return null;

  const { data, error } = await supabase
    .from("drivers")
    .select("*")
    .eq("phone", normalized)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

function driverMeetsVerification(driver = {}) {
  const verificationStatus = cleanEnv(
    driver.verification_status || "pending"
  ).toLowerCase();

  if (verificationStatus === "approved") return true;
  if (verificationStatus === "verified") return true;

  if (driver.email_verified && driver.sms_verified) return true;

  return false;
}

function driverIsApproved(driver = {}) {
  const approval = cleanEnv(
    driver.approval_status || driver.status || "pending"
  ).toLowerCase();

  if (["approved", "active"].includes(approval)) return true;

  if (approval === "verified" && driverMeetsVerification(driver)) return true;

  return false;
}

function getDriverAccessPayload(driver = {}) {
  const verified = driverMeetsVerification(driver);
  const approved = driverIsApproved(driver);

  return {
    driver_id: cleanEnv(driver.id),
    driver_type: normalizeDriverType(driver.driver_type),
    verification_complete: verified,
    approval_status: cleanEnv(driver.approval_status || driver.status || "pending"),
    verification_status: cleanEnv(driver.verification_status || "pending"),
    email_verified: !!driver.email_verified,
    sms_verified: !!driver.sms_verified,
    can_go_active: verified && approved,
    can_receive_missions: verified && approved,
    message: verified && approved
      ? "Driver is verified and approved. Mission access is enabled."
      : !verified
      ? "Driver verification is not complete yet. Mission access remains locked."
      : "Driver is verified but still awaiting approval. Mission access remains locked."
  };
}

/* =========================================================
   DRIVER SIGNUP
========================================================= */
app.post("/api/driver/signup", async (req, res) => {
  try {
    if (!supabase) {
      return res.status(500).json({
        ok: false,
        error: "Database unavailable"
      });
    }

    const first_name = cleanEnv(req.body?.firstName || req.body?.first_name);
    const last_name = cleanEnv(req.body?.lastName || req.body?.last_name);
    const email = normalizeEmail(req.body?.email);
    const phone = normalizePhone(req.body?.phone);
    const city = cleanEnv(req.body?.city);
    const state = cleanEnv(req.body?.state || "TN");
    const password = cleanEnv(req.body?.password);
    const driver_type = normalizeDriverType(
      req.body?.driverType || req.body?.driver_type
    );

    const vehicle_make = cleanEnv(req.body?.vehicleMake || req.body?.vehicle_make);
    const vehicle_model = cleanEnv(req.body?.vehicleModel || req.body?.vehicle_model);
    const vehicle_year = cleanEnv(req.body?.vehicleYear || req.body?.vehicle_year);
    const license_plate = cleanEnv(req.body?.licensePlate || req.body?.license_plate);

    if (!first_name || !last_name || !email || !phone || !city || !state || !password) {
      return res.status(400).json({
        ok: false,
        error: "Missing required driver signup fields"
      });
    }

    const existingByEmail = await getDriverByEmail(email);
    if (existingByEmail) {
      return res.status(409).json({
        ok: false,
        error: "A driver with that email already exists",
        driver: mapDriverRow(existingByEmail),
        access: getDriverAccessPayload(existingByEmail)
      });
    }

    const existingByPhone = await getDriverByPhone(phone);
    if (existingByPhone) {
      return res.status(409).json({
        ok: false,
        error: "A driver with that phone already exists",
        driver: mapDriverRow(existingByPhone),
        access: getDriverAccessPayload(existingByPhone)
      });
    }

    const driver_id = generateId("driver");

    const insertPayload = {
      id: driver_id,
      first_name,
      last_name,
      email,
      phone,
      city,
      state,
      password,
      driver_type,
      vehicle_make,
      vehicle_model,
      vehicle_year,
      license_plate,
      status: "pending",
      approval_status: "pending",
      verification_status: "pending",
      email_verified: false,
      sms_verified: false,
      created_at: now(),
      updated_at: now()
    };

    const { data, error } = await supabase
      .from("drivers")
      .insert(insertPayload)
      .select("*")
      .single();

    if (error) {
      console.error("Driver signup insert error:", error.message);
      return res.status(500).json({
        ok: false,
        error: "Failed to create driver account"
      });
    }

    return res.status(201).json({
      ok: true,
      message: "Driver signup submitted successfully",
      driver: mapDriverRow(data),
      access: getDriverAccessPayload(data)
    });
  } catch (error) {
    console.error("POST /api/driver/signup error:", error.message);
    return res.status(500).json({
      ok: false,
      error: "Unable to complete driver signup"
    });
  }
});

/* =========================================================
   DRIVER STATUS
========================================================= */
app.get("/api/driver/status/:driverId", async (req, res) => {
  try {
    const driver = await getDriverById(req.params?.driverId);

    if (!driver) {
      return res.status(404).json({
        ok: false,
        error: "Driver not found"
      });
    }

    return res.json({
      ok: true,
      driver: mapDriverRow(driver),
      access: getDriverAccessPayload(driver)
    });
  } catch (error) {
    console.error("GET /api/driver/status/:driverId error:", error.message);
    return res.status(500).json({
      ok: false,
      error: "Unable to retrieve driver status"
    });
  }
});

app.post("/api/driver/status", async (req, res) => {
  try {
    const driverId = cleanEnv(req.body?.driver_id || req.body?.driverId);
    const email = normalizeEmail(req.body?.email);

    let driver = null;

    if (driverId) {
      driver = await getDriverById(driverId);
    } else if (email) {
      driver = await getDriverByEmail(email);
    } else {
      return res.status(400).json({
        ok: false,
        error: "Provide driver_id or email"
      });
    }

    if (!driver) {
      return res.status(404).json({
        ok: false,
        error: "Driver not found"
      });
    }

    return res.json({
      ok: true,
      driver: mapDriverRow(driver),
      access: getDriverAccessPayload(driver)
    });
  } catch (error) {
    console.error("POST /api/driver/status error:", error.message);
    return res.status(500).json({
      ok: false,
      error: "Unable to retrieve driver status"
    });
  }
});

/* =========================================================
   DRIVER APPROVAL GUARD
========================================================= */
async function requireApprovedDriver(req, res, next) {
  try {
    if (!ENABLE_DRIVER_APPROVAL_GATE) {
      req.driver = null;
      return next();
    }

    const driverId = cleanEnv(
      req.body?.driver_id ||
        req.body?.driverId ||
        req.query?.driver_id ||
        req.query?.driverId ||
        req.params?.driverId
    );

    if (!driverId) {
      return res.status(400).json({
        ok: false,
        error: "driver_id is required"
      });
    }

    const driver = await getDriverById(driverId);

    if (!driver) {
      return res.status(404).json({
        ok: false,
        error: "Driver not found"
      });
    }

    if (!driverIsApproved(driver)) {
      return res.status(403).json({
        ok: false,
        error: "Driver is not verified and approved yet",
        driver: mapDriverRow(driver),
        access: getDriverAccessPayload(driver)
      });
    }

    req.driver = driver;
    return next();
  } catch (error) {
    console.error("requireApprovedDriver error:", error.message);
    return res.status(500).json({
      ok: false,
      error: "Unable to verify driver approval"
    });
  }
}

/* =========================================================
   MISSION HELPERS
========================================================= */
function mapMissionRow(row = {}) {
  return {
    mission_id: cleanEnv(row.id),
    ride_id: cleanEnv(row.ride_id),
    driver_id: cleanEnv(row.driver_id),
    status: cleanEnv(row.status || "offered"),
    pickup_address: cleanEnv(row.pickup_address),
    destination_address: cleanEnv(row.destination_address),
    rider_notes: cleanEnv(row.rider_notes),
    requested_mode: normalizeRequestedMode(row.requested_mode),
    fare_estimate: Number(row.fare_estimate || 0),
    expires_at: row.expires_at || null,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null
  };
}

/* =========================================================
   DRIVER CURRENT MISSION
========================================================= */
app.get(
  "/api/driver/current-mission/:driverId",
  requireApprovedDriver,
  async (req, res) => {
    try {
      if (!supabase) {
        return res.status(500).json({
          ok: false,
          error: "Database unavailable"
        });
      }

      const driverId = cleanEnv(req.params?.driverId);

      const { data, error } = await supabase
        .from("missions")
        .select("*")
        .eq("driver_id", driverId)
        .in("status", [
          "offered",
          "assigned",
          "accepted",
          "driver_en_route",
          "arrived",
          "in_progress"
        ])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        console.error("Current mission query error:", error.message);
        return res.status(500).json({
          ok: false,
          error: "Unable to retrieve current mission"
        });
      }

      if (!data) {
        return res.json({
          ok: true,
          mission: null,
          message: "No active mission found"
        });
      }

      return res.json({
        ok: true,
        mission: mapMissionRow(data)
      });
    } catch (error) {
      console.error("GET /api/driver/current-mission/:driverId error:", error.message);
      return res.status(500).json({
        ok: false,
        error: "Unable to retrieve current mission"
      });
    }
  }
);

/* =========================================================
   DRIVER MISSION HISTORY
========================================================= */
app.get(
  "/api/driver/missions/:driverId",
  requireApprovedDriver,
  async (req, res) => {
    try {
      if (!supabase) {
        return res.status(500).json({
          ok: false,
          error: "Database unavailable"
        });
      }

      const driverId = cleanEnv(req.params?.driverId);

      const { data, error } = await supabase
        .from("missions")
        .select("*")
        .eq("driver_id", driverId)
        .order("created_at", { ascending: false })
        .limit(25);

      if (error) {
        console.error("Driver missions query error:", error.message);
        return res.status(500).json({
          ok: false,
          error: "Unable to retrieve missions"
        });
      }

      return res.json({
        ok: true,
        missions: Array.isArray(data) ? data.map(mapMissionRow) : []
      });
    } catch (error) {
      console.error("GET /api/driver/missions/:driverId error:", error.message);
      return res.status(500).json({
        ok: false,
        error: "Unable to retrieve missions"
      });
    }
  }
);/* =========================================================
   PART 6: DISPATCH BRAIN + MISSION OFFERS + ACCEPT / REJECT
========================================================= */

const DISPATCH_TIMEOUT_SECONDS = Number(process.env.DISPATCH_TIMEOUT_SECONDS || 30);
const MAX_DISPATCH_ATTEMPTS = Number(process.env.MAX_DISPATCH_ATTEMPTS || 5);

/* =========================================================
   DISPATCH HELPERS
========================================================= */
function addSecondsToNow(seconds = 30) {
  return new Date(Date.now() + Number(seconds || 0) * 1000).toISOString();
}

function dispatchIsExpired(dispatch = {}) {
  const expiresAt = dispatch?.expires_at ? new Date(dispatch.expires_at).getTime() : 0;
  if (!expiresAt) return false;
  return Date.now() >= expiresAt;
}

function normalizeMissionStatus(value = "") {
  const status = cleanEnv(value).toLowerCase();

  if (
    [
      "offered",
      "assigned",
      "accepted",
      "driver_en_route",
      "arrived",
      "in_progress",
      "completed",
      "cancelled",
      "rejected",
      "expired"
    ].includes(status)
  ) {
    return status;
  }

  return "offered";
}

function normalizeDispatchStatus(value = "") {
  const status = cleanEnv(value).toLowerCase();

  if (
    [
      "offered",
      "accepted",
      "rejected",
      "expired",
      "cancelled",
      "failed"
    ].includes(status)
  ) {
    return status;
  }

  return "offered";
}

async function getRideById(rideId = "") {
  if (!supabase) throw new Error("Database unavailable");

  const safeRideId = cleanEnv(rideId);
  if (!safeRideId) return null;

  const { data, error } = await supabase
    .from("rides")
    .select("*")
    .eq("id", safeRideId)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

async function getMissionById(missionId = "") {
  if (!supabase) throw new Error("Database unavailable");

  const safeMissionId = cleanEnv(missionId);
  if (!safeMissionId) return null;

  const { data, error } = await supabase
    .from("missions")
    .select("*")
    .eq("id", safeMissionId)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

async function getDispatchById(dispatchId = "") {
  if (!supabase) throw new Error("Database unavailable");

  const safeDispatchId = cleanEnv(dispatchId);
  if (!safeDispatchId) return null;

  const { data, error } = await supabase
    .from("dispatches")
    .select("*")
    .eq("id", safeDispatchId)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

async function getDispatchAttemptsForRide(rideId = "") {
  if (!supabase) throw new Error("Database unavailable");

  const safeRideId = cleanEnv(rideId);
  if (!safeRideId) return 0;

  const { data, error } = await supabase
    .from("dispatches")
    .select("id")
    .eq("ride_id", safeRideId);

  if (error) throw error;
  return Array.isArray(data) ? data.length : 0;
}

async function getLatestOpenMissionForRide(rideId = "") {
  if (!supabase) throw new Error("Database unavailable");

  const safeRideId = cleanEnv(rideId);
  if (!safeRideId) return null;

  const { data, error } = await supabase
    .from("missions")
    .select("*")
    .eq("ride_id", safeRideId)
    .in("status", [
      "offered",
      "assigned",
      "accepted",
      "driver_en_route",
      "arrived",
      "in_progress"
    ])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

async function getLatestDispatchForMission(missionId = "") {
  if (!supabase) throw new Error("Database unavailable");

  const safeMissionId = cleanEnv(missionId);
  if (!safeMissionId) return null;

  const { data, error } = await supabase
    .from("dispatches")
    .select("*")
    .eq("mission_id", safeMissionId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

async function listEligibleDriversForRide(ride = {}) {
  if (!supabase) throw new Error("Database unavailable");

  const requestedMode = normalizeRequestedMode(ride.requested_mode || "driver");
  const driverType = requestedMode === "autonomous" ? "autonomous" : "human";

  const { data, error } = await supabase
    .from("drivers")
    .select("*")
    .eq("driver_type", driverType)
    .in("approval_status", ["approved", "active", "verified"])
    .order("updated_at", { ascending: false })
    .limit(25);

  if (error) throw error;

  return (Array.isArray(data) ? data : []).filter((driver) => driverIsApproved(driver));
}

async function chooseNextDriverForRide(ride = {}) {
  const eligibleDrivers = await listEligibleDriversForRide(ride);
  if (!eligibleDrivers.length) return null;

  const { data: priorDispatches, error } = await supabase
    .from("dispatches")
    .select("driver_id")
    .eq("ride_id", cleanEnv(ride.id));

  if (error) throw error;

  const usedDriverIds = new Set(
    (Array.isArray(priorDispatches) ? priorDispatches : [])
      .map((row) => cleanEnv(row.driver_id))
      .filter(Boolean)
  );

  const freshDriver = eligibleDrivers.find(
    (driver) => !usedDriverIds.has(cleanEnv(driver.id))
  );

  return freshDriver || null;
}

async function updateRideStatus(rideId = "", status = "") {
  const safeRideId = cleanEnv(rideId);
  const safeStatus = cleanEnv(status);

  if (!safeRideId || !safeStatus) return null;

  const { data, error } = await supabase
    .from("rides")
    .update({
      status: safeStatus,
      updated_at: now()
    })
    .eq("id", safeRideId)
    .select("*")
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

async function updateMissionStatus(missionId = "", status = "") {
  const safeMissionId = cleanEnv(missionId);
  const safeStatus = normalizeMissionStatus(status);

  if (!safeMissionId) return null;

  const { data, error } = await supabase
    .from("missions")
    .update({
      status: safeStatus,
      updated_at: now()
    })
    .eq("id", safeMissionId)
    .select("*")
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

async function updateDispatchStatus(dispatchId = "", status = "") {
  const safeDispatchId = cleanEnv(dispatchId);
  const safeStatus = normalizeDispatchStatus(status);

  if (!safeDispatchId) return null;

  const { data, error } = await supabase
    .from("dispatches")
    .update({
      status: safeStatus,
      responded_at: ["accepted", "rejected", "expired", "cancelled", "failed"].includes(safeStatus)
        ? now()
        : null,
      updated_at: now()
    })
    .eq("id", safeDispatchId)
    .select("*")
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

/* =========================================================
   CREATE DISPATCH OFFER
========================================================= */
async function createDispatchOfferForRide(rideId = "") {
  if (!supabase) throw new Error("Database unavailable");

  const ride = await getRideById(rideId);
  if (!ride) {
    return {
      ok: false,
      error: "Ride not found"
    };
  }

  const attempts = await getDispatchAttemptsForRide(ride.id);
  if (attempts >= MAX_DISPATCH_ATTEMPTS) {
    await updateRideStatus(ride.id, "no_driver_available");
    return {
      ok: false,
      error: "Max dispatch attempts reached",
      ride_status: "no_driver_available"
    };
  }

  const existingMission = await getLatestOpenMissionForRide(ride.id);
  if (existingMission) {
    const latestDispatch = await getLatestDispatchForMission(existingMission.id);

    if (latestDispatch && !dispatchIsExpired(latestDispatch) && cleanEnv(latestDispatch.status) === "offered") {
      return {
        ok: true,
        message: "An active dispatch offer already exists",
        ride,
        mission: mapMissionRow(existingMission),
        dispatch: latestDispatch
      };
    }
  }

  const nextDriver = await chooseNextDriverForRide(ride);
  if (!nextDriver) {
    await updateRideStatus(ride.id, "no_driver_available");
    return {
      ok: false,
      error: "No eligible driver available",
      ride_status: "no_driver_available"
    };
  }

  const mission_id = generateId("mission");
  const dispatch_id = generateId("dispatch");
  const expires_at = addSecondsToNow(DISPATCH_TIMEOUT_SECONDS);

  const missionPayload = {
    id: mission_id,
    ride_id: cleanEnv(ride.id),
    driver_id: cleanEnv(nextDriver.id),
    status: "offered",
    pickup_address: cleanEnv(ride.pickup_address),
    destination_address: cleanEnv(ride.destination_address),
    rider_notes: cleanEnv(ride.notes),
    requested_mode: normalizeRequestedMode(ride.requested_mode),
    fare_estimate: Number(ride.fare_estimate || 0),
    expires_at,
    created_at: now(),
    updated_at: now()
  };

  const { data: missionData, error: missionError } = await supabase
    .from("missions")
    .insert(missionPayload)
    .select("*")
    .single();

  if (missionError) {
    throw missionError;
  }

  const dispatchPayload = {
    id: dispatch_id,
    ride_id: cleanEnv(ride.id),
    mission_id: cleanEnv(missionData.id),
    driver_id: cleanEnv(nextDriver.id),
    status: "offered",
    offer_expires_at: expires_at,
    expires_at,
    created_at: now(),
    updated_at: now()
  };

  const { data: dispatchData, error: dispatchError } = await supabase
    .from("dispatches")
    .insert(dispatchPayload)
    .select("*")
    .single();

  if (dispatchError) {
    throw dispatchError;
  }

  await updateRideStatus(ride.id, "awaiting_driver_acceptance");

  return {
    ok: true,
    message: "Dispatch offer created",
    ride_id: cleanEnv(ride.id),
    mission: mapMissionRow(missionData),
    dispatch: dispatchData,
    driver: mapDriverRow(nextDriver)
  };
}

/* =========================================================
   MANUAL DISPATCH TRIGGER
========================================================= */
app.post("/api/dispatch/start/:rideId", async (req, res) => {
  try {
    const result = await createDispatchOfferForRide(req.params?.rideId);

    if (!result.ok) {
      return res.status(400).json(result);
    }

    return res.json(result);
  } catch (error) {
    console.error("POST /api/dispatch/start/:rideId error:", error.message);
    return res.status(500).json({
      ok: false,
      error: "Unable to start dispatch"
    });
  }
});

/* =========================================================
   DRIVER ACCEPT MISSION
========================================================= */
app.post(
  "/api/driver/mission/accept",
  requireApprovedDriver,
  async (req, res) => {
    try {
      const missionId = cleanEnv(req.body?.mission_id || req.body?.missionId);
      const driverId = cleanEnv(req.body?.driver_id || req.body?.driverId);

      if (!missionId || !driverId) {
        return res.status(400).json({
          ok: false,
          error: "mission_id and driver_id are required"
        });
      }

      const mission = await getMissionById(missionId);
      if (!mission) {
        return res.status(404).json({
          ok: false,
          error: "Mission not found"
        });
      }

      if (cleanEnv(mission.driver_id) !== driverId) {
        return res.status(403).json({
          ok: false,
          error: "This mission is not assigned to that driver"
        });
      }

      const dispatch = await getLatestDispatchForMission(mission.id);
      if (!dispatch) {
        return res.status(404).json({
          ok: false,
          error: "Dispatch record not found"
        });
      }

      if (dispatchIsExpired(dispatch)) {
        await updateDispatchStatus(dispatch.id, "expired");
        await updateMissionStatus(mission.id, "expired");

        return res.status(410).json({
          ok: false,
          error: "Dispatch offer has expired"
        });
      }

      if (cleanEnv(dispatch.status) !== "offered") {
        return res.status(409).json({
          ok: false,
          error: "Dispatch is no longer available"
        });
      }

      const updatedDispatch = await updateDispatchStatus(dispatch.id, "accepted");
      const updatedMission = await updateMissionStatus(mission.id, "accepted");
      const updatedRide = await updateRideStatus(mission.ride_id, "dispatched");

      return res.json({
        ok: true,
        message: "Mission accepted successfully",
        ride_id: cleanEnv(updatedRide?.id || mission.ride_id),
        mission: mapMissionRow(updatedMission || mission),
        dispatch: updatedDispatch
      });
    } catch (error) {
      console.error("POST /api/driver/mission/accept error:", error.message);
      return res.status(500).json({
        ok: false,
        error: "Unable to accept mission"
      });
    }
  }
);

/* =========================================================
   DRIVER REJECT MISSION
========================================================= */
app.post(
  "/api/driver/mission/reject",
  requireApprovedDriver,
  async (req, res) => {
    try {
      const missionId = cleanEnv(req.body?.mission_id || req.body?.missionId);
      const driverId = cleanEnv(req.body?.driver_id || req.body?.driverId);

      if (!missionId || !driverId) {
        return res.status(400).json({
          ok: false,
          error: "mission_id and driver_id are required"
        });
      }

      const mission = await getMissionById(missionId);
      if (!mission) {
        return res.status(404).json({
          ok: false,
          error: "Mission not found"
        });
      }

      if (cleanEnv(mission.driver_id) !== driverId) {
        return res.status(403).json({
          ok: false,
          error: "This mission is not assigned to that driver"
        });
      }

      const dispatch = await getLatestDispatchForMission(mission.id);
      if (!dispatch) {
        return res.status(404).json({
          ok: false,
          error: "Dispatch record not found"
        });
      }

      await updateDispatchStatus(dispatch.id, "rejected");
      await updateMissionStatus(mission.id, "rejected");

      const redispatch = await createDispatchOfferForRide(mission.ride_id);

      if (!redispatch.ok) {
        await updateRideStatus(mission.ride_id, "no_driver_available");
      }

      return res.json({
        ok: true,
        message: redispatch.ok
          ? "Mission rejected. Ride re-dispatched."
          : "Mission rejected. No replacement driver found.",
        redispatch
      });
    } catch (error) {
      console.error("POST /api/driver/mission/reject error:", error.message);
      return res.status(500).json({
        ok: false,
        error: "Unable to reject mission"
      });
    }
  }
);

/* =========================================================
   DISPATCH SWEEP FOR EXPIRED OFFERS
========================================================= */
async function sweepExpiredDispatches() {
  if (!supabase) return;

  try {
    const { data, error } = await supabase
      .from("dispatches")
      .select("*")
      .eq("status", "offered")
      .limit(50);

    if (error) throw error;

    const openDispatches = Array.isArray(data) ? data : [];

    for (const dispatch of openDispatches) {
      if (!dispatchIsExpired(dispatch)) continue;

      await updateDispatchStatus(dispatch.id, "expired");

      const missionId = cleanEnv(dispatch.mission_id);
      const mission = await getMissionById(missionId);
      if (mission) {
        await updateMissionStatus(mission.id, "expired");
        await createDispatchOfferForRide(mission.ride_id);
      }
    }
  } catch (error) {
    console.error("sweepExpiredDispatches error:", error.message);
  }
}

setInterval(() => {
  sweepExpiredDispatches().catch((error) => {
    console.error("dispatch sweep interval error:", error.message);
  });
}, 10000);/* =========================================================
   PART 7: AUTO DISPATCH + TRIP LIFECYCLE + RIDER RIDES + EVENTS
========================================================= */

/* =========================================================
   TRIP / EVENT HELPERS
========================================================= */
function normalizeRideStatus(value = "") {
  const status = cleanEnv(value).toLowerCase();

  if (
    [
      "pending",
      "awaiting_driver_acceptance",
      "dispatched",
      "driver_en_route",
      "arrived",
      "in_progress",
      "completed",
      "cancelled",
      "no_driver_available"
    ].includes(status)
  ) {
    return status;
  }

  return "pending";
}

function mapRideRow(row = {}) {
  return {
    ride_id: cleanEnv(row.id),
    rider_id: cleanEnv(row.rider_id),
    driver_id: cleanEnv(row.driver_id),
    pickup_address: cleanEnv(row.pickup_address),
    destination_address: cleanEnv(row.destination_address),
    notes: cleanEnv(row.notes),
    requested_mode: normalizeRequestedMode(row.requested_mode),
    status: normalizeRideStatus(row.status),
    fare_estimate: Number(row.fare_estimate || 0),
    estimated_distance_miles: Number(row.estimated_distance_miles || 0),
    estimated_duration_minutes: Number(row.estimated_duration_minutes || 0),
    payment_status: cleanEnv(row.payment_status),
    payment_id: cleanEnv(row.payment_id),
    accepted_at: row.accepted_at || null,
    driver_en_route_at: row.driver_en_route_at || null,
    arrived_at: row.arrived_at || null,
    started_at: row.started_at || null,
    completed_at: row.completed_at || null,
    cancelled_at: row.cancelled_at || null,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null
  };
}

async function logTripEvent({
  ride_id = "",
  mission_id = "",
  dispatch_id = "",
  driver_id = "",
  rider_id = "",
  event_type = "",
  event_data = {}
}) {
  try {
    if (!supabase) return null;

    const payload = {
      id: generateId("event"),
      ride_id: cleanEnv(ride_id),
      mission_id: cleanEnv(mission_id),
      dispatch_id: cleanEnv(dispatch_id),
      driver_id: cleanEnv(driver_id),
      rider_id: cleanEnv(rider_id),
      event_type: cleanEnv(event_type),
      event_data,
      created_at: now()
    };

    const { data, error } = await supabase
      .from("trip_events")
      .insert(payload)
      .select("*")
      .maybeSingle();

    if (error) {
      console.error("Trip event log error:", error.message);
      return null;
    }

    return data || null;
  } catch (error) {
    console.error("logTripEvent error:", error.message);
    return null;
  }
}

async function patchRide(rideId = "", values = {}) {
  if (!supabase) throw new Error("Database unavailable");

  const safeRideId = cleanEnv(rideId);
  if (!safeRideId) return null;

  const payload = {
    ...values,
    updated_at: now()
  };

  const { data, error } = await supabase
    .from("rides")
    .update(payload)
    .eq("id", safeRideId)
    .select("*")
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

async function getRideForDriver(driverId = "") {
  if (!supabase) throw new Error("Database unavailable");

  const safeDriverId = cleanEnv(driverId);
  if (!safeDriverId) return null;

  const { data, error } = await supabase
    .from("rides")
    .select("*")
    .eq("driver_id", safeDriverId)
    .in("status", [
      "dispatched",
      "driver_en_route",
      "arrived",
      "in_progress"
    ])
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

async function getRidesForRider(riderId = "", limit = 25) {
  if (!supabase) throw new Error("Database unavailable");

  const safeRiderId = cleanEnv(riderId);
  if (!safeRiderId) return [];

  const { data, error } = await supabase
    .from("rides")
    .select("*")
    .eq("rider_id", safeRiderId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

async function getTripEventsForRide(rideId = "", limit = 100) {
  if (!supabase) throw new Error("Database unavailable");

  const safeRideId = cleanEnv(rideId);
  if (!safeRideId) return [];

  const { data, error } = await supabase
    .from("trip_events")
    .select("*")
    .eq("ride_id", safeRideId)
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

/* =========================================================
   AUTO DISPATCH VERSION OF REQUEST RIDE
   REPLACE YOUR EXISTING /api/request-ride ROUTE WITH THIS ONE
========================================================= */

app.post(
  "/api/request-ride",
  requireApprovedRider,
  requireAuthorizedPayment,
  async (req, res) => {
    try {
      if (!supabase) {
        return res.status(500).json({
          ok: false,
          error: "Database unavailable"
        });
      }

      const rider_id = cleanEnv(
        req.body?.rider_id || req.body?.riderId || req.rider?.id
      );
      const pickup = cleanEnv(req.body?.pickup || req.body?.pickup_address);
      const destination = cleanEnv(
        req.body?.destination || req.body?.dropoff || req.body?.destination_address
      );
      const notes = cleanEnv(req.body?.notes);
      const requested_mode = normalizeRequestedMode(
        req.body?.requestedMode || req.body?.requested_mode || "driver"
      );

      if (!pickup || !destination) {
        return res.status(400).json({
          ok: false,
          error: "pickup and destination are required"
        });
      }

      const estimate = buildFareEstimate({
        pickup,
        destination,
        requestedMode: requested_mode
      });

      const ride_id = generateId("ride");

      const insertPayload = {
        id: ride_id,
        rider_id,
        pickup_address: pickup,
        destination_address: destination,
        notes,
        requested_mode,
        status: "awaiting_driver_acceptance",
        fare_estimate: estimate.estimated_fare,
        estimated_distance_miles: estimate.distance_miles,
        estimated_duration_minutes: estimate.duration_minutes,
        payment_status: req.payment ? cleanEnv(req.payment.status) : "authorized",
        payment_id: cleanEnv(req.payment?.id),
        created_at: now(),
        updated_at: now()
      };

      const { data, error } = await supabase
        .from("rides")
        .insert(insertPayload)
        .select("*")
        .single();

      if (error) {
        console.error("Ride request insert error:", error.message);
        return res.status(500).json({
          ok: false,
          error: "Failed to create ride request"
        });
      }

      await logTripEvent({
        ride_id: cleanEnv(data.id),
        rider_id,
        event_type: "ride_requested",
        event_data: {
          pickup_address: pickup,
          destination_address: destination,
          requested_mode,
          fare_estimate: estimate.estimated_fare
        }
      });

      const dispatchResult = await createDispatchOfferForRide(data.id);

      if (dispatchResult.ok) {
        await logTripEvent({
          ride_id: cleanEnv(data.id),
          mission_id: cleanEnv(dispatchResult.mission?.mission_id),
          dispatch_id: cleanEnv(dispatchResult.dispatch?.id),
          driver_id: cleanEnv(dispatchResult.driver?.driver_id),
          rider_id,
          event_type: "dispatch_offered",
          event_data: {
            requested_mode,
            expires_at: dispatchResult.dispatch?.expires_at || null
          }
        });
      } else {
        await logTripEvent({
          ride_id: cleanEnv(data.id),
          rider_id,
          event_type: "dispatch_unavailable",
          event_data: {
            reason: cleanEnv(dispatchResult.error || "No eligible driver available")
          }
        });
      }

      return res.status(201).json({
        ok: true,
        message: dispatchResult.ok
          ? "Ride request created and dispatch started"
          : "Ride request created but no driver was immediately available",
        ride_id: cleanEnv(data.id),
        ride: mapRideRow(data),
        fare_estimate: estimate,
        dispatch: dispatchResult.ok ? dispatchResult.dispatch : null,
        mission: dispatchResult.ok ? dispatchResult.mission : null,
        assigned_driver: dispatchResult.ok ? dispatchResult.driver : null,
        dispatch_status: dispatchResult.ok ? "offered" : "no_driver_available",
        timestamp: now()
      });
    } catch (error) {
      console.error("POST /api/request-ride error:", error.message);
      return res.status(500).json({
        ok: false,
        error: "Unable to request ride"
      });
    }
  }
);

/* =========================================================
   PATCH PART 6 ACCEPT FLOW
   REPLACE YOUR EXISTING ACCEPT ROUTE WITH THIS ONE
========================================================= */

app.post(
  "/api/driver/mission/accept",
  requireApprovedDriver,
  async (req, res) => {
    try {
      const missionId = cleanEnv(req.body?.mission_id || req.body?.missionId);
      const driverId = cleanEnv(req.body?.driver_id || req.body?.driverId);

      if (!missionId || !driverId) {
        return res.status(400).json({
          ok: false,
          error: "mission_id and driver_id are required"
        });
      }

      const mission = await getMissionById(missionId);
      if (!mission) {
        return res.status(404).json({
          ok: false,
          error: "Mission not found"
        });
      }

      if (cleanEnv(mission.driver_id) !== driverId) {
        return res.status(403).json({
          ok: false,
          error: "This mission is not assigned to that driver"
        });
      }

      const dispatch = await getLatestDispatchForMission(mission.id);
      if (!dispatch) {
        return res.status(404).json({
          ok: false,
          error: "Dispatch record not found"
        });
      }

      if (dispatchIsExpired(dispatch)) {
        await updateDispatchStatus(dispatch.id, "expired");
        await updateMissionStatus(mission.id, "expired");

        await logTripEvent({
          ride_id: cleanEnv(mission.ride_id),
          mission_id: cleanEnv(mission.id),
          dispatch_id: cleanEnv(dispatch.id),
          driver_id,
          event_type: "dispatch_expired",
          event_data: { reason: "Driver attempted after expiration" }
        });

        return res.status(410).json({
          ok: false,
          error: "Dispatch offer has expired"
        });
      }

      if (cleanEnv(dispatch.status) !== "offered") {
        return res.status(409).json({
          ok: false,
          error: "Dispatch is no longer available"
        });
      }

      const updatedDispatch = await updateDispatchStatus(dispatch.id, "accepted");
      const updatedMission = await updateMissionStatus(mission.id, "accepted");
      const updatedRide = await patchRide(mission.ride_id, {
        status: "dispatched",
        driver_id: driverId,
        accepted_at: now()
      });

      await logTripEvent({
        ride_id: cleanEnv(mission.ride_id),
        mission_id: cleanEnv(mission.id),
        dispatch_id: cleanEnv(dispatch.id),
        driver_id,
        rider_id: cleanEnv(updatedRide?.rider_id),
        event_type: "mission_accepted",
        event_data: {
          ride_status: "dispatched"
        }
      });

      return res.json({
        ok: true,
        message: "Mission accepted successfully",
        ride_id: cleanEnv(updatedRide?.id || mission.ride_id),
        ride: mapRideRow(updatedRide || {}),
        mission: mapMissionRow(updatedMission || mission),
        dispatch: updatedDispatch
      });
    } catch (error) {
      console.error("POST /api/driver/mission/accept error:", error.message);
      return res.status(500).json({
        ok: false,
        error: "Unable to accept mission"
      });
    }
  }
);

/* =========================================================
   PATCH PART 6 REJECT FLOW
   REPLACE YOUR EXISTING REJECT ROUTE WITH THIS ONE
========================================================= */

app.post(
  "/api/driver/mission/reject",
  requireApprovedDriver,
  async (req, res) => {
    try {
      const missionId = cleanEnv(req.body?.mission_id || req.body?.missionId);
      const driverId = cleanEnv(req.body?.driver_id || req.body?.driverId);

      if (!missionId || !driverId) {
        return res.status(400).json({
          ok: false,
          error: "mission_id and driver_id are required"
        });
      }

      const mission = await getMissionById(missionId);
      if (!mission) {
        return res.status(404).json({
          ok: false,
          error: "Mission not found"
        });
      }

      if (cleanEnv(mission.driver_id) !== driverId) {
        return res.status(403).json({
          ok: false,
          error: "This mission is not assigned to that driver"
        });
      }

      const dispatch = await getLatestDispatchForMission(mission.id);
      if (!dispatch) {
        return res.status(404).json({
          ok: false,
          error: "Dispatch record not found"
        });
      }

      await updateDispatchStatus(dispatch.id, "rejected");
      await updateMissionStatus(mission.id, "rejected");

      await logTripEvent({
        ride_id: cleanEnv(mission.ride_id),
        mission_id: cleanEnv(mission.id),
        dispatch_id: cleanEnv(dispatch.id),
        driver_id,
        event_type: "mission_rejected",
        event_data: {
          ride_id: cleanEnv(mission.ride_id)
        }
      });

      const redispatch = await createDispatchOfferForRide(mission.ride_id);

      if (redispatch.ok) {
        await logTripEvent({
          ride_id: cleanEnv(mission.ride_id),
          mission_id: cleanEnv(redispatch.mission?.mission_id),
          dispatch_id: cleanEnv(redispatch.dispatch?.id),
          driver_id: cleanEnv(redispatch.driver?.driver_id),
          event_type: "redispatch_offered",
          event_data: {
            previous_driver_id: driverId
          }
        });
      } else {
        await updateRideStatus(mission.ride_id, "no_driver_available");

        await logTripEvent({
          ride_id: cleanEnv(mission.ride_id),
          mission_id: cleanEnv(mission.id),
          dispatch_id: cleanEnv(dispatch.id),
          driver_id,
          event_type: "redispatch_failed",
          event_data: {
            reason: cleanEnv(redispatch.error || "No replacement driver found")
          }
        });
      }

      return res.json({
        ok: true,
        message: redispatch.ok
          ? "Mission rejected. Ride re-dispatched."
          : "Mission rejected. No replacement driver found.",
        redispatch
      });
    } catch (error) {
      console.error("POST /api/driver/mission/reject error:", error.message);
      return res.status(500).json({
        ok: false,
        error: "Unable to reject mission"
      });
    }
  }
);

/* =========================================================
   PATCH PART 6 EXPIRATION SWEEP
   REPLACE YOUR EXISTING sweepExpiredDispatches FUNCTION WITH THIS ONE
========================================================= */

async function sweepExpiredDispatches() {
  if (!supabase) return;

  try {
    const { data, error } = await supabase
      .from("dispatches")
      .select("*")
      .eq("status", "offered")
      .limit(50);

    if (error) throw error;

    const openDispatches = Array.isArray(data) ? data : [];

    for (const dispatch of openDispatches) {
      if (!dispatchIsExpired(dispatch)) continue;

      await updateDispatchStatus(dispatch.id, "expired");

      const missionId = cleanEnv(dispatch.mission_id);
      const mission = await getMissionById(missionId);

      if (mission) {
        await updateMissionStatus(mission.id, "expired");

        await logTripEvent({
          ride_id: cleanEnv(mission.ride_id),
          mission_id: cleanEnv(mission.id),
          dispatch_id: cleanEnv(dispatch.id),
          driver_id: cleanEnv(mission.driver_id),
          event_type: "dispatch_expired",
          event_data: {
            expired_at: now()
          }
        });

        const redispatch = await createDispatchOfferForRide(mission.ride_id);

        if (redispatch.ok) {
          await logTripEvent({
            ride_id: cleanEnv(mission.ride_id),
            mission_id: cleanEnv(redispatch.mission?.mission_id),
            dispatch_id: cleanEnv(redispatch.dispatch?.id),
            driver_id: cleanEnv(redispatch.driver?.driver_id),
            event_type: "redispatch_offered",
            event_data: {
              reason: "offer_expired"
            }
          });
        } else {
          await updateRideStatus(mission.ride_id, "no_driver_available");

          await logTripEvent({
            ride_id: cleanEnv(mission.ride_id),
            mission_id: cleanEnv(mission.id),
            dispatch_id: cleanEnv(dispatch.id),
            driver_id: cleanEnv(mission.driver_id),
            event_type: "redispatch_failed",
            event_data: {
              reason: cleanEnv(redispatch.error || "No replacement driver found")
            }
          });
        }
      }
    }
  } catch (error) {
    console.error("sweepExpiredDispatches error:", error.message);
  }
}

/* =========================================================
   DRIVER CURRENT RIDE
========================================================= */
app.get(
  "/api/driver/current-ride/:driverId",
  requireApprovedDriver,
  async (req, res) => {
    try {
      const ride = await getRideForDriver(req.params?.driverId);

      return res.json({
        ok: true,
        ride: ride ? mapRideRow(ride) : null,
        message: ride ? "Current ride found" : "No active ride found"
      });
    } catch (error) {
      console.error("GET /api/driver/current-ride/:driverId error:", error.message);
      return res.status(500).json({
        ok: false,
        error: "Unable to retrieve current ride"
      });
    }
  }
);

/* =========================================================
   RIDER RIDES
========================================================= */
app.get("/api/rider/rides/:riderId", async (req, res) => {
  try {
    const riderId = cleanEnv(req.params?.riderId);
    if (!riderId) {
      return res.status(400).json({
        ok: false,
        error: "riderId is required"
      });
    }

    const rides = await getRidesForRider(riderId, 25);

    return res.json({
      ok: true,
      rides: rides.map(mapRideRow)
    });
  } catch (error) {
    console.error("GET /api/rider/rides/:riderId error:", error.message);
    return res.status(500).json({
      ok: false,
      error: "Unable to retrieve rider rides"
    });
  }
});

/* =========================================================
   SINGLE RIDE DETAILS + EVENTS
========================================================= */
app.get("/api/ride/:rideId", async (req, res) => {
  try {
    const ride = await getRideById(req.params?.rideId);

    if (!ride) {
      return res.status(404).json({
        ok: false,
        error: "Ride not found"
      });
    }

    const events = await getTripEventsForRide(ride.id, 100);

    return res.json({
      ok: true,
      ride: mapRideRow(ride),
      events
    });
  } catch (error) {
    console.error("GET /api/ride/:rideId error:", error.message);
    return res.status(500).json({
      ok: false,
      error: "Unable to retrieve ride"
    });
  }
});

/* =========================================================
   DRIVER EN ROUTE
========================================================= */
app.post(
  "/api/ride/driver-en-route",
  requireApprovedDriver,
  async (req, res) => {
    try {
      const rideId = cleanEnv(req.body?.ride_id || req.body?.rideId);
      const driverId = cleanEnv(req.body?.driver_id || req.body?.driverId);

      if (!rideId || !driverId) {
        return res.status(400).json({
          ok: false,
          error: "ride_id and driver_id are required"
        });
      }

      const ride = await getRideById(rideId);
      if (!ride) {
        return res.status(404).json({
          ok: false,
          error: "Ride not found"
        });
      }

      if (cleanEnv(ride.driver_id) !== driverId) {
        return res.status(403).json({
          ok: false,
          error: "This ride is not assigned to that driver"
        });
      }

      const updatedRide = await patchRide(rideId, {
        status: "driver_en_route",
        driver_en_route_at: now()
      });

      const mission = await getLatestOpenMissionForRide(rideId);
      if (mission) {
        await updateMissionStatus(mission.id, "driver_en_route");
      }

      await logTripEvent({
        ride_id: rideId,
        mission_id: cleanEnv(mission?.id),
        driver_id,
        rider_id: cleanEnv(ride.rider_id),
        event_type: "driver_en_route",
        event_data: {}
      });

      return res.json({
        ok: true,
        message: "Driver marked as en route",
        ride: mapRideRow(updatedRide || {})
      });
    } catch (error) {
      console.error("POST /api/ride/driver-en-route error:", error.message);
      return res.status(500).json({
        ok: false,
        error: "Unable to update ride status"
      });
    }
  }
);

/* =========================================================
   DRIVER ARRIVED
========================================================= */
app.post(
  "/api/ride/arrived",
  requireApprovedDriver,
  async (req, res) => {
    try {
      const rideId = cleanEnv(req.body?.ride_id || req.body?.rideId);
      const driverId = cleanEnv(req.body?.driver_id || req.body?.driverId);

      if (!rideId || !driverId) {
        return res.status(400).json({
          ok: false,
          error: "ride_id and driver_id are required"
        });
      }

      const ride = await getRideById(rideId);
      if (!ride) {
        return res.status(404).json({
          ok: false,
          error: "Ride not found"
        });
      }

      if (cleanEnv(ride.driver_id) !== driverId) {
        return res.status(403).json({
          ok: false,
          error: "This ride is not assigned to that driver"
        });
      }

      const updatedRide = await patchRide(rideId, {
        status: "arrived",
        arrived_at: now()
      });

      const mission = await getLatestOpenMissionForRide(rideId);
      if (mission) {
        await updateMissionStatus(mission.id, "arrived");
      }

      await logTripEvent({
        ride_id: rideId,
        mission_id: cleanEnv(mission?.id),
        driver_id,
        rider_id: cleanEnv(ride.rider_id),
        event_type: "driver_arrived",
        event_data: {}
      });

      return res.json({
        ok: true,
        message: "Driver marked as arrived",
        ride: mapRideRow(updatedRide || {})
      });
    } catch (error) {
      console.error("POST /api/ride/arrived error:", error.message);
      return res.status(500).json({
        ok: false,
        error: "Unable to update ride status"
      });
    }
  }
);

/* =========================================================
   START TRIP
========================================================= */
app.post(
  "/api/ride/start",
  requireApprovedDriver,
  async (req, res) => {
    try {
      const rideId = cleanEnv(req.body?.ride_id || req.body?.rideId);
      const driverId = cleanEnv(req.body?.driver_id || req.body?.driverId);

      if (!rideId || !driverId) {
        return res.status(400).json({
          ok: false,
          error: "ride_id and driver_id are required"
        });
      }

      const ride = await getRideById(rideId);
      if (!ride) {
        return res.status(404).json({
          ok: false,
          error: "Ride not found"
        });
      }

      if (cleanEnv(ride.driver_id) !== driverId) {
        return res.status(403).json({
          ok: false,
          error: "This ride is not assigned to that driver"
        });
      }

      const updatedRide = await patchRide(rideId, {
        status: "in_progress",
        started_at: now()
      });

      const mission = await getLatestOpenMissionForRide(rideId);
      if (mission) {
        await updateMissionStatus(mission.id, "in_progress");
      }

      await logTripEvent({
        ride_id: rideId,
        mission_id: cleanEnv(mission?.id),
        driver_id,
        rider_id: cleanEnv(ride.rider_id),
        event_type: "trip_started",
        event_data: {}
      });

      return res.json({
        ok: true,
        message: "Trip started successfully",
        ride: mapRideRow(updatedRide || {})
      });
    } catch (error) {
      console.error("POST /api/ride/start error:", error.message);
      return res.status(500).json({
        ok: false,
        error: "Unable to start trip"
      });
    }
  }
);

/* =========================================================
   COMPLETE TRIP
========================================================= */
app.post(
  "/api/ride/complete",
  requireApprovedDriver,
  async (req, res) => {
    try {
      const rideId = cleanEnv(req.body?.ride_id || req.body?.rideId);
      const driverId = cleanEnv(req.body?.driver_id || req.body?.driverId);

      if (!rideId || !driverId) {
        return res.status(400).json({
          ok: false,
          error: "ride_id and driver_id are required"
        });
      }

      const ride = await getRideById(rideId);
      if (!ride) {
        return res.status(404).json({
          ok: false,
          error: "Ride not found"
        });
      }

      if (cleanEnv(ride.driver_id) !== driverId) {
        return res.status(403).json({
          ok: false,
          error: "This ride is not assigned to that driver"
        });
      }

      const updatedRide = await patchRide(rideId, {
        status: "completed",
        completed_at: now()
      });

      const mission = await getLatestOpenMissionForRide(rideId);
      if (mission) {
        await updateMissionStatus(mission.id, "completed");
      }

      await logTripEvent({
        ride_id: rideId,
        mission_id: cleanEnv(mission?.id),
        driver_id,
        rider_id: cleanEnv(ride.rider_id),
        event_type: "trip_completed",
        event_data: {
          fare_estimate: Number(ride.fare_estimate || 0)
        }
      });

      return res.json({
        ok: true,
        message: "Trip completed successfully",
        ride: mapRideRow(updatedRide || {})
      });
    } catch (error) {
      console.error("POST /api/ride/complete error:", error.message);
      return res.status(500).json({
        ok: false,
        error: "Unable to complete trip"
      });
    }
  }
);/* =========================================================
   PART 8: EARNINGS + TIPS + PAYOUTS + ADMIN + FINAL BOOT
========================================================= */

const ADMIN_EMAIL = normalizeEmail(
  process.env.ADMIN_EMAIL || "williebee@harveytaxiservice.com"
);
const ADMIN_PASSWORD = cleanEnv(process.env.ADMIN_PASSWORD || "Jakurean870$");
const DRIVER_PAYOUT_PERCENT = Number(process.env.DRIVER_PAYOUT_PERCENT || 0.75);

/* =========================================================
   ADMIN HELPERS
========================================================= */
function getAdminEmailFromRequest(req) {
  return normalizeEmail(
    req.headers["x-admin-email"] ||
      req.body?.admin_email ||
      req.query?.admin_email ||
      ""
  );
}

function getAdminPasswordFromRequest(req) {
  return cleanEnv(
    req.headers["x-admin-password"] ||
      req.body?.admin_password ||
      req.query?.admin_password ||
      ""
  );
}

function adminAuthorized(req) {
  const email = getAdminEmailFromRequest(req);
  const password = getAdminPasswordFromRequest(req);
  return email === ADMIN_EMAIL && password === ADMIN_PASSWORD;
}

async function requireAdmin(req, res, next) {
  try {
    if (!adminAuthorized(req)) {
      return res.status(401).json({
        ok: false,
        error: "Admin authorization failed"
      });
    }

    return next();
  } catch (error) {
    console.error("requireAdmin error:", error.message);
    return res.status(500).json({
      ok: false,
      error: "Unable to verify admin credentials"
    });
  }
}

async function logAdminEvent({
  action = "",
  admin_email = "",
  target_type = "",
  target_id = "",
  details = {}
}) {
  try {
    if (!supabase) return null;

    const payload = {
      id: generateId("adminlog"),
      action: cleanEnv(action),
      admin_email: normalizeEmail(admin_email || ADMIN_EMAIL),
      target_type: cleanEnv(target_type),
      target_id: cleanEnv(target_id),
      details,
      created_at: now()
    };

    const { data, error } = await supabase
      .from("admin_logs")
      .insert(payload)
      .select("*")
      .maybeSingle();

    if (error) {
      console.error("Admin log insert error:", error.message);
      return null;
    }

    return data || null;
  } catch (error) {
    console.error("logAdminEvent error:", error.message);
    return null;
  }
}

/* =========================================================
   EARNINGS / PAYOUT HELPERS
========================================================= */
function calculateDriverPayoutFromFare(fare = 0, tips = 0) {
  const safeFare = Number(fare || 0);
  const safeTips = Number(tips || 0);
  const basePayout = toMoney(safeFare * DRIVER_PAYOUT_PERCENT);
  return {
    fare_amount: toMoney(safeFare),
    tip_amount: toMoney(safeTips),
    payout_amount: toMoney(basePayout + safeTips),
    platform_amount: toMoney(safeFare - basePayout)
  };
}

async function getDriverEarningsRecordByRide(rideId = "") {
  if (!supabase) throw new Error("Database unavailable");

  const { data, error } = await supabase
    .from("driver_earnings")
    .select("*")
    .eq("ride_id", cleanEnv(rideId))
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

async function upsertDriverEarningsForRide(ride = {}) {
  if (!supabase) throw new Error("Database unavailable");

  const rideId = cleanEnv(ride.id);
  const driverId = cleanEnv(ride.driver_id);
  const riderId = cleanEnv(ride.rider_id);

  if (!rideId || !driverId) return null;

  const existing = await getDriverEarningsRecordByRide(rideId);
  const tipAmount = Number(ride.tip_amount || 0);
  const calc = calculateDriverPayoutFromFare(ride.fare_estimate, tipAmount);

  const payload = {
    ride_id: rideId,
    driver_id: driverId,
    rider_id: riderId,
    fare_amount: calc.fare_amount,
    tip_amount: calc.tip_amount,
    payout_amount: calc.payout_amount,
    platform_amount: calc.platform_amount,
    payout_status: cleanEnv(existing?.payout_status || "pending"),
    updated_at: now()
  };

  if (existing) {
    const { data, error } = await supabase
      .from("driver_earnings")
      .update(payload)
      .eq("id", existing.id)
      .select("*")
      .maybeSingle();

    if (error) throw error;
    return data || null;
  }

  const insertPayload = {
    id: generateId("earning"),
    ...payload,
    created_at: now()
  };

  const { data, error } = await supabase
    .from("driver_earnings")
    .insert(insertPayload)
    .select("*")
    .single();

  if (error) throw error;
  return data || null;
}

async function getDriverEarnings(driverId = "", limit = 100) {
  if (!supabase) throw new Error("Database unavailable");

  const { data, error } = await supabase
    .from("driver_earnings")
    .select("*")
    .eq("driver_id", cleanEnv(driverId))
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

async function getPayoutsForDriver(driverId = "", limit = 100) {
  if (!supabase) throw new Error("Database unavailable");

  const { data, error } = await supabase
    .from("driver_payouts")
    .select("*")
    .eq("driver_id", cleanEnv(driverId))
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

/* =========================================================
   TIPPING
========================================================= */
app.post("/api/ride/tip", async (req, res) => {
  try {
    if (!supabase) {
      return res.status(500).json({
        ok: false,
        error: "Database unavailable"
      });
    }

    const rideId = cleanEnv(req.body?.ride_id || req.body?.rideId);
    const riderId = cleanEnv(req.body?.rider_id || req.body?.riderId);
    const tipAmount = toMoney(req.body?.tip_amount || req.body?.tipAmount || 0);

    if (!rideId || !riderId) {
      return res.status(400).json({
        ok: false,
        error: "ride_id and rider_id are required"
      });
    }

    if (tipAmount <= 0) {
      return res.status(400).json({
        ok: false,
        error: "A valid positive tip amount is required"
      });
    }

    const ride = await getRideById(rideId);
    if (!ride) {
      return res.status(404).json({
        ok: false,
        error: "Ride not found"
      });
    }

    if (cleanEnv(ride.rider_id) !== riderId) {
      return res.status(403).json({
        ok: false,
        error: "This ride is not assigned to that rider"
      });
    }

    const currentTip = Number(ride.tip_amount || 0);
    const updatedRide = await patchRide(rideId, {
      tip_amount: toMoney(currentTip + tipAmount)
    });

    await upsertDriverEarningsForRide(updatedRide || ride);

    await logTripEvent({
      ride_id: rideId,
      driver_id: cleanEnv(ride.driver_id),
      rider_id: cleanEnv(ride.rider_id),
      event_type: "tip_added",
      event_data: {
        added_tip_amount: tipAmount,
        total_tip_amount: Number(updatedRide?.tip_amount || currentTip + tipAmount)
      }
    });

    return res.json({
      ok: true,
      message: "Tip added successfully",
      ride: mapRideRow(updatedRide || {}),
      tip_amount: Number(updatedRide?.tip_amount || 0)
    });
  } catch (error) {
    console.error("POST /api/ride/tip error:", error.message);
    return res.status(500).json({
      ok: false,
      error: "Unable to add tip"
    });
  }
});

/* =========================================================
   PATCH COMPLETE TRIP ROUTE
   REPLACE YOUR EXISTING /api/ride/complete ROUTE WITH THIS ONE
========================================================= */
app.post(
  "/api/ride/complete",
  requireApprovedDriver,
  async (req, res) => {
    try {
      const rideId = cleanEnv(req.body?.ride_id || req.body?.rideId);
      const driverId = cleanEnv(req.body?.driver_id || req.body?.driverId);

      if (!rideId || !driverId) {
        return res.status(400).json({
          ok: false,
          error: "ride_id and driver_id are required"
        });
      }

      const ride = await getRideById(rideId);
      if (!ride) {
        return res.status(404).json({
          ok: false,
          error: "Ride not found"
        });
      }

      if (cleanEnv(ride.driver_id) !== driverId) {
        return res.status(403).json({
          ok: false,
          error: "This ride is not assigned to that driver"
        });
      }

      const updatedRide = await patchRide(rideId, {
        status: "completed",
        completed_at: now()
      });

      const mission = await getLatestOpenMissionForRide(rideId);
      if (mission) {
        await updateMissionStatus(mission.id, "completed");
      }

      const earnings = await upsertDriverEarningsForRide(updatedRide || ride);

      await logTripEvent({
        ride_id: rideId,
        mission_id: cleanEnv(mission?.id),
        driver_id,
        rider_id: cleanEnv(ride.rider_id),
        event_type: "trip_completed",
        event_data: {
          fare_estimate: Number(ride.fare_estimate || 0),
          tip_amount: Number(updatedRide?.tip_amount || 0),
          payout_amount: Number(earnings?.payout_amount || 0)
        }
      });

      return res.json({
        ok: true,
        message: "Trip completed successfully",
        ride: mapRideRow(updatedRide || {}),
        earnings
      });
    } catch (error) {
      console.error("POST /api/ride/complete error:", error.message);
      return res.status(500).json({
        ok: false,
        error: "Unable to complete trip"
      });
    }
  }
);

/* =========================================================
   DRIVER EARNINGS
========================================================= */
app.get(
  "/api/driver/earnings/:driverId",
  requireApprovedDriver,
  async (req, res) => {
    try {
      const driverId = cleanEnv(req.params?.driverId);
      const earnings = await getDriverEarnings(driverId, 100);

      const totals = earnings.reduce(
        (acc, row) => {
          acc.fare_amount += Number(row.fare_amount || 0);
          acc.tip_amount += Number(row.tip_amount || 0);
          acc.payout_amount += Number(row.payout_amount || 0);
          acc.platform_amount += Number(row.platform_amount || 0);
          return acc;
        },
        {
          fare_amount: 0,
          tip_amount: 0,
          payout_amount: 0,
          platform_amount: 0
        }
      );

      return res.json({
        ok: true,
        totals: {
          fare_amount: toMoney(totals.fare_amount),
          tip_amount: toMoney(totals.tip_amount),
          payout_amount: toMoney(totals.payout_amount),
          platform_amount: toMoney(totals.platform_amount)
        },
        earnings
      });
    } catch (error) {
      console.error("GET /api/driver/earnings/:driverId error:", error.message);
      return res.status(500).json({
        ok: false,
        error: "Unable to retrieve driver earnings"
      });
    }
  }
);

/* =========================================================
   DRIVER PAYOUT HISTORY
========================================================= */
app.get(
  "/api/driver/payouts/:driverId",
  requireApprovedDriver,
  async (req, res) => {
    try {
      const driverId = cleanEnv(req.params?.driverId);
      const payouts = await getPayoutsForDriver(driverId, 100);

      return res.json({
        ok: true,
        payouts
      });
    } catch (error) {
      console.error("GET /api/driver/payouts/:driverId error:", error.message);
      return res.status(500).json({
        ok: false,
        error: "Unable to retrieve driver payouts"
      });
    }
  }
);

/* =========================================================
   ADMIN: APPROVE RIDER
========================================================= */
app.post("/api/admin/rider/approve", requireAdmin, async (req, res) => {
  try {
    const riderId = cleanEnv(req.body?.rider_id || req.body?.riderId);
    if (!riderId) {
      return res.status(400).json({
        ok: false,
        error: "rider_id is required"
      });
    }

    const { data, error } = await supabase
      .from("riders")
      .update({
        status: "approved",
        approval_status: "approved",
        verification_status: "approved",
        updated_at: now()
      })
      .eq("id", riderId)
      .select("*")
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      return res.status(404).json({
        ok: false,
        error: "Rider not found"
      });
    }

    await logAdminEvent({
      action: "rider_approved",
      admin_email: getAdminEmailFromRequest(req),
      target_type: "rider",
      target_id: riderId,
      details: {}
    });

    return res.json({
      ok: true,
      message: "Rider approved successfully",
      rider: mapRiderRow(data),
      access: getRiderAccessPayload(data)
    });
  } catch (error) {
    console.error("POST /api/admin/rider/approve error:", error.message);
    return res.status(500).json({
      ok: false,
      error: "Unable to approve rider"
    });
  }
});

/* =========================================================
   ADMIN: APPROVE DRIVER
========================================================= */
app.post("/api/admin/driver/approve", requireAdmin, async (req, res) => {
  try {
    const driverId = cleanEnv(req.body?.driver_id || req.body?.driverId);
    if (!driverId) {
      return res.status(400).json({
        ok: false,
        error: "driver_id is required"
      });
    }

    const { data, error } = await supabase
      .from("drivers")
      .update({
        status: "approved",
        approval_status: "approved",
        verification_status: "approved",
        email_verified: true,
        sms_verified: true,
        updated_at: now()
      })
      .eq("id", driverId)
      .select("*")
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      return res.status(404).json({
        ok: false,
        error: "Driver not found"
      });
    }

    await logAdminEvent({
      action: "driver_approved",
      admin_email: getAdminEmailFromRequest(req),
      target_type: "driver",
      target_id: driverId,
      details: {}
    });

    return res.json({
      ok: true,
      message: "Driver approved successfully",
      driver: mapDriverRow(data),
      access: getDriverAccessPayload(data)
    });
  } catch (error) {
    console.error("POST /api/admin/driver/approve error:", error.message);
    return res.status(500).json({
      ok: false,
      error: "Unable to approve driver"
    });
  }
});

/* =========================================================
   ADMIN: ANALYTICS
========================================================= */
app.get("/api/admin/analytics", requireAdmin, async (req, res) => {
  try {
    const [
      ridersResult,
      driversResult,
      ridesResult,
      paymentsResult,
      earningsResult
    ] = await Promise.all([
      supabase.from("riders").select("id, approval_status, status"),
      supabase.from("drivers").select("id, approval_status, status, driver_type"),
      supabase.from("rides").select("id, status, requested_mode, fare_estimate, tip_amount"),
      supabase.from("payments").select("id, status"),
      supabase.from("driver_earnings").select("id, payout_amount, tip_amount, platform_amount")
    ]);

    const riders = Array.isArray(ridersResult.data) ? ridersResult.data : [];
    const drivers = Array.isArray(driversResult.data) ? driversResult.data : [];
    const rides = Array.isArray(ridesResult.data) ? ridesResult.data : [];
    const payments = Array.isArray(paymentsResult.data) ? paymentsResult.data : [];
    const earnings = Array.isArray(earningsResult.data) ? earningsResult.data : [];

    const analytics = {
      riders_total: riders.length,
      riders_approved: riders.filter((r) =>
        ["approved", "active"].includes(
          cleanEnv(r.approval_status || r.status).toLowerCase()
        )
      ).length,

      drivers_total: drivers.length,
      drivers_approved: drivers.filter((d) =>
        ["approved", "active"].includes(
          cleanEnv(d.approval_status || d.status).toLowerCase()
        )
      ).length,
      human_drivers: drivers.filter(
        (d) => normalizeDriverType(d.driver_type) === "human"
      ).length,
      autonomous_drivers: drivers.filter(
        (d) => normalizeDriverType(d.driver_type) === "autonomous"
      ).length,

      rides_total: rides.length,
      rides_completed: rides.filter(
        (r) => cleanEnv(r.status) === "completed"
      ).length,
      rides_in_progress: rides.filter((r) =>
        ["dispatched", "driver_en_route", "arrived", "in_progress"].includes(
          cleanEnv(r.status)
        )
      ).length,
      rides_no_driver_available: rides.filter(
        (r) => cleanEnv(r.status) === "no_driver_available"
      ).length,

      driver_mode_rides: rides.filter(
        (r) => normalizeRequestedMode(r.requested_mode) === "driver"
      ).length,
      autonomous_mode_rides: rides.filter(
        (r) => normalizeRequestedMode(r.requested_mode) === "autonomous"
      ).length,

      payments_authorized: payments.filter((p) =>
        ["authorized", "held", "preauthorized"].includes(cleanEnv(p.status))
      ).length,

      gross_fares: toMoney(
        rides.reduce((sum, r) => sum + Number(r.fare_estimate || 0), 0)
      ),
      gross_tips: toMoney(
        rides.reduce((sum, r) => sum + Number(r.tip_amount || 0), 0)
      ),
      total_driver_payouts: toMoney(
        earnings.reduce((sum, e) => sum + Number(e.payout_amount || 0), 0)
      ),
      total_platform_amount: toMoney(
        earnings.reduce((sum, e) => sum + Number(e.platform_amount || 0), 0)
      )
    };

    await logAdminEvent({
      action: "analytics_viewed",
      admin_email: getAdminEmailFromRequest(req),
      target_type: "system",
      target_id: "analytics",
      details: {}
    });

    return res.json({
      ok: true,
      analytics,
      generated_at: now()
    });
  } catch (error) {
    console.error("GET /api/admin/analytics error:", error.message);
    return res.status(500).json({
      ok: false,
      error: "Unable to retrieve analytics"
    });
  }
});

/* =========================================================
   ADMIN: LOGS
========================================================= */
app.get("/api/admin/logs", requireAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("admin_logs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) throw error;

    return res.json({
      ok: true,
      logs: Array.isArray(data) ? data : []
    });
  } catch (error) {
    console.error("GET /api/admin/logs error:", error.message);
    return res.status(500).json({
      ok: false,
      error: "Unable to retrieve admin logs"
    });
  }
});

/* =========================================================
   ROOT
========================================================= */
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

/* =========================================================
   404
========================================================= */
app.use((req, res) => {
  return res.status(404).json({
    ok: false,
    error: "Route not found"
  });
});

/* =========================================================
   FINAL SERVER BOOT
========================================================= */
app.listen(PORT, () => {
  console.log("==================================================");
  console.log("🚕 Harvey Taxi Code Blue server is running");
  console.log(`✅ Port: ${PORT}`);
  console.log(`✅ Started: ${SERVER_STARTED_AT}`);
  console.log(`✅ Supabase: ${!!supabase}`);
  console.log(`✅ AI: ${!!openai}`);
  console.log(`✅ Admin email: ${ADMIN_EMAIL}`);
  console.log("==================================================");
});

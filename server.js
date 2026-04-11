const express = require("express");
const cors = require("cors");
const path = require("path");
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");

let OpenAI = null;
try {
  OpenAI = require("openai");
} catch (error) {
  console.warn("OpenAI SDK not installed");
}

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

function nowIso() {
  return new Date().toISOString();
}

function uuid() {
  return crypto.randomUUID();
}

/* =========================================================
   ENV
========================================================= */

const SUPABASE_URL = cleanEnv(process.env.SUPABASE_URL);
const SUPABASE_SERVICE_ROLE_KEY = cleanEnv(
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const ADMIN_EMAIL = cleanEnv(process.env.ADMIN_EMAIL);
const ADMIN_PASSWORD = cleanEnv(process.env.ADMIN_PASSWORD);

const GOOGLE_MAPS_API_KEY = cleanEnv(process.env.GOOGLE_MAPS_API_KEY);

const STRIPE_SECRET_KEY = cleanEnv(process.env.STRIPE_SECRET_KEY);
const STRIPE_PUBLIC_KEY = cleanEnv(process.env.STRIPE_PUBLIC_KEY);

const PERSONA_API_KEY = cleanEnv(process.env.PERSONA_API_KEY);
const PERSONA_TEMPLATE_ID_RIDER = cleanEnv(
  process.env.PERSONA_TEMPLATE_ID_RIDER
);
const PERSONA_TEMPLATE_ID_DRIVER = cleanEnv(
  process.env.PERSONA_TEMPLATE_ID_DRIVER
);
const PERSONA_WEBHOOK_SECRET = cleanEnv(
  process.env.PERSONA_WEBHOOK_SECRET
);

const OPENAI_API_KEY = cleanEnv(process.env.OPENAI_API_KEY);
const OPENAI_SUPPORT_MODEL = cleanEnv(
  process.env.OPENAI_SUPPORT_MODEL || "gpt-4o-mini"
);

const SMTP_HOST = cleanEnv(process.env.SMTP_HOST);
const SMTP_PORT = toNumber(process.env.SMTP_PORT, 587);
const SMTP_USER = cleanEnv(process.env.SMTP_USER);
const SMTP_PASS = cleanEnv(process.env.SMTP_PASS);

const TWILIO_ACCOUNT_SID = cleanEnv(process.env.TWILIO_ACCOUNT_SID);
const TWILIO_AUTH_TOKEN = cleanEnv(process.env.TWILIO_AUTH_TOKEN);
const TWILIO_PHONE = cleanEnv(process.env.TWILIO_PHONE);

const BASE_URL =
  cleanEnv(process.env.BASE_URL) ||
  cleanEnv(process.env.PUBLIC_APP_URL) ||
  "";

/* =========================================================
   VALIDATION
========================================================= */

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing Supabase config");
  process.exit(1);
}

/* =========================================================
   CLIENTS
========================================================= */

const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      persistSession: false
    }
  }
);

let openai = null;

if (OPENAI_API_KEY && OpenAI) {
  openai = new OpenAI({
    apiKey: OPENAI_API_KEY
  });
}

/* =========================================================
   HEALTH
========================================================= */

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    service: "harvey-taxi",
    time: nowIso()
  });
});/* =========================================================
   PHASE 8 AI ENDPOINTS
========================================================= */

/* AI Fare Estimate */
app.post("/api/ai/fare-estimate", async (req, res) => {
  try {
    const {
      pickupAddress,
      dropoffAddress,
      rideType = "STANDARD",
      requestedMode = "driver"
    } = req.body || {};

    if (!pickupAddress || !dropoffAddress) {
      return res.status(400).json({
        error: "pickupAddress and dropoffAddress required"
      });
    }

    const result = await getAiFareBreakdown({
      pickupAddress,
      dropoffAddress,
      rideType,
      requestedMode
    });

    res.json(result);
  } catch (error) {
    console.error("AI fare estimate error", error);
    res.status(500).json({ error: "AI fare estimate failed" });
  }
});


/* AI Dispatch Score */
app.post("/api/ai/dispatch-score", async (req, res) => {
  try {
    const { driverId, rideId } = req.body;

    if (!driverId || !rideId) {
      return res.status(400).json({
        error: "driverId and rideId required"
      });
    }

    const driver = await getDriverById(driverId);
    const ride = await getRideById(rideId);

    if (!driver || !ride) {
      return res.status(404).json({
        error: "driver or ride not found"
      });
    }

    const score = await aiScoreDriverForRide(driver, ride);

    res.json(score);
  } catch (error) {
    console.error("AI dispatch score error", error);
    res.status(500).json({ error: "AI dispatch score failed" });
  }
});


/* AI Support Brain */
app.post("/api/ai/support", async (req, res) => {
  try {
    const { message, context } = req.body || {};

    if (!message) {
      return res.status(400).json({
        error: "message required"
      });
    }

    if (!openai) {
      return res.json({
        reply: "AI support is currently offline."
      });
    }

    const completion = await openai.chat.completions.create({
      model: OPENAI_SUPPORT_MODEL,
      temperature: 0.3,
      messages: [
        {
          role: "system",
          content:
            "You are Harvey Taxi AI support. Be concise, helpful, and operational."
        },
        {
          role: "user",
          content: JSON.stringify({
            message,
            context
          })
        }
      ]
    });

    const reply =
      completion.choices?.[0]?.message?.content ||
      "AI could not respond.";

    res.json({ reply });
  } catch (error) {
    console.error("AI support error", error);
    res.status(500).json({ error: "AI support failed" });
  }
});


/* AI System Status */
app.get("/api/ai/status", async (req, res) => {
  res.json({
    ai_enabled: !!openai,
    model: OPENAI_SUPPORT_MODEL || null,
    phase: "Phase 8 AI"
  });
});/* =========================================================
   RIDER SIGNUP
========================================================= */

app.post("/api/rider/signup", async (req, res) => {
  try {
    const {
      firstName,
      lastName,
      email,
      phone,
      password,
      city,
      state
    } = req.body;

    if (!email || !phone || !password) {
      return res.status(400).json({
        error: "Missing required fields"
      });
    }

    const riderId = uuid();

    const { data, error } = await supabase
      .from("riders")
      .insert({
        id: riderId,
        first_name: firstName,
        last_name: lastName,
        email,
        phone,
        password,
        city,
        state,
        verification_status: "not_started",
        approved: false,
        created_at: nowIso()
      })
      .select()
      .single();

    if (error) throw error;

    res.json({
      success: true,
      rider: data
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: "Signup failed"
    });
  }
});

/* =========================================================
   START RIDER VERIFICATION
========================================================= */

app.post("/api/rider/start-verification", async (req, res) => {
  try {
    const { riderId } = req.body;

    const { data: rider } = await supabase
      .from("riders")
      .select("*")
      .eq("id", riderId)
      .single();

    if (!rider) {
      return res.status(404).json({
        error: "Rider not found"
      });
    }

    const inquiryId = "inq_" + uuid();

    await supabase
      .from("riders")
      .update({
        verification_status: "pending",
        verification_inquiry_id: inquiryId,
        verification_started_at: nowIso()
      })
      .eq("id", riderId);

    res.json({
      success: true,
      inquiryId
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: "verification failed"
    });
  }
});

/* =========================================================
   COMPLETE VERIFICATION (WEBHOOK SIMULATION)
========================================================= */

app.post("/api/webhooks/persona", async (req, res) => {
  try {
    const { inquiryId, status } = req.body;

    const approved = status === "approved";

    const { data: rider } = await supabase
      .from("riders")
      .select("*")
      .eq("verification_inquiry_id", inquiryId)
      .single();

    if (!rider) {
      return res.json({ ok: true });
    }

    await supabase
      .from("riders")
      .update({
        verification_status: status,
        approved,
        verified_at: nowIso()
      })
      .eq("id", rider.id);

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.json({ ok: true });
  }
});/* =========================================================
   PAYMENT AUTHORIZATION
========================================================= */

app.post("/api/payments/authorize", async (req, res) => {
  try {
    const { riderId, amount, paymentMethodId } = req.body;

    if (!riderId || !amount) {
      return res.status(400).json({
        error: "riderId and amount are required"
      });
    }

    const { data: rider, error: riderError } = await supabase
      .from("riders")
      .select("*")
      .eq("id", riderId)
      .single();

    if (riderError || !rider) {
      return res.status(404).json({
        error: "Rider not found"
      });
    }

    if (rider.approved !== true || rider.verification_status !== "approved") {
      return res.status(403).json({
        error: "Rider must complete ID or passport verification before payment authorization"
      });
    }

    const paymentId = uuid();

    const authorizedAmount = Number(amount) || 0;
    if (authorizedAmount <= 0) {
      return res.status(400).json({
        error: "Invalid amount"
      });
    }

    const { data: payment, error: paymentError } = await supabase
      .from("payments")
      .insert({
        id: paymentId,
        rider_id: riderId,
        amount: authorizedAmount,
        currency: "usd",
        status: "authorized",
        payment_method_id: paymentMethodId || null,
        created_at: nowIso(),
        updated_at: nowIso()
      })
      .select()
      .single();

    if (paymentError) throw paymentError;

    await supabase.from("trip_events").insert({
      id: uuid(),
      ride_id: null,
      actor_type: "rider",
      actor_id: riderId,
      event_type: "payment_authorized",
      payload: {
        payment_id: payment.id,
        amount: authorizedAmount
      },
      created_at: nowIso()
    });

    res.json({
      success: true,
      payment
    });
  } catch (err) {
    console.error("payment authorize error", err);
    res.status(500).json({
      error: "Payment authorization failed"
    });
  }
});

/* =========================================================
   GET ACTIVE PAYMENT AUTHORIZATION
========================================================= */

async function getAuthorizedPaymentForRider(riderId) {
  const { data, error } = await supabase
    .from("payments")
    .select("*")
    .eq("rider_id", riderId)
    .eq("status", "authorized")
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) throw error;
  return Array.isArray(data) && data.length ? data[0] : null;
}

/* =========================================================
   REQUEST RIDE
========================================================= */

app.post("/api/request-ride", async (req, res) => {
  try {
    const {
      riderId,
      pickupAddress,
      dropoffAddress,
      requestedMode,
      notes,
      rideType,
      estimatedFare
    } = req.body;

    if (!riderId || !pickupAddress || !dropoffAddress) {
      return res.status(400).json({
        error: "riderId, pickupAddress, and dropoffAddress are required"
      });
    }

    const { data: rider, error: riderError } = await supabase
      .from("riders")
      .select("*")
      .eq("id", riderId)
      .single();

    if (riderError || !rider) {
      return res.status(404).json({
        error: "Rider not found"
      });
    }

    if (rider.approved !== true || rider.verification_status !== "approved") {
      return res.status(403).json({
        error: "Ride request blocked until rider ID or passport verification is approved"
      });
    }

    const authorizedPayment = await getAuthorizedPaymentForRider(riderId);

    if (!authorizedPayment) {
      return res.status(403).json({
        error: "Payment authorization required before dispatch"
      });
    }

    const rideId = uuid();

    const { data: ride, error: rideError } = await supabase
      .from("rides")
      .insert({
        id: rideId,
        rider_id: riderId,
        payment_id: authorizedPayment.id,
        pickup_address: pickupAddress,
        dropoff_address: dropoffAddress,
        requested_mode: requestedMode || "driver",
        ride_type: rideType || "STANDARD",
        notes: notes || "",
        estimated_fare: Number(estimatedFare || authorizedPayment.amount || 0),
        status: "searching_driver",
        dispatch_status: "pending",
        created_at: nowIso(),
        updated_at: nowIso()
      })
      .select()
      .single();

    if (rideError) throw rideError;

    await supabase.from("trip_events").insert({
      id: uuid(),
      ride_id: ride.id,
      actor_type: "rider",
      actor_id: riderId,
      event_type: "ride_requested",
      payload: {
        pickup_address: pickupAddress,
        dropoff_address: dropoffAddress,
        requested_mode: requestedMode || "driver",
        ride_type: rideType || "STANDARD"
      },
      created_at: nowIso()
    });

    res.json({
      success: true,
      ride_id: ride.id,
      ride
    });
  } catch (err) {
    console.error("request ride error", err);
    res.status(500).json({
      error: "Ride request failed"
    });
  }
});/* =========================================================
   DRIVER HELPERS
========================================================= */

function normalizeEmail(value = "") {
  return String(value || "").trim().toLowerCase();
}

function normalizePhone(value = "") {
  return String(value || "").replace(/[^\d+]/g, "").trim();
}

function randomDigits(length = 6) {
  let out = "";
  while (out.length < length) {
    out += Math.floor(Math.random() * 10);
  }
  return out.slice(0, length);
}

function sha256(value = "") {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function futureIsoMinutes(minutes = 10) {
  return new Date(Date.now() + minutes * 60 * 1000).toISOString();
}

async function logTripEvent({
  rideId = null,
  actorType = "system",
  actorId = null,
  eventType,
  payload = {}
}) {
  try {
    await supabase.from("trip_events").insert({
      id: uuid(),
      ride_id: rideId,
      actor_type: actorType,
      actor_id: actorId,
      event_type: eventType,
      payload,
      created_at: nowIso()
    });
  } catch (error) {
    console.error("trip event log error", error.message);
  }
}

async function getDriverByEmailOrPhone(email, phone) {
  let query = supabase.from("drivers").select("*").limit(1);

  if (email && phone) {
    query = query.or(
      `email.eq.${normalizeEmail(email)},phone.eq.${normalizePhone(phone)}`
    );
  } else if (email) {
    query = query.eq("email", normalizeEmail(email));
  } else if (phone) {
    query = query.eq("phone", normalizePhone(phone));
  }

  const { data, error } = await query;
  if (error) throw error;
  return Array.isArray(data) && data.length ? data[0] : null;
}

async function getDriverById(driverId) {
  const { data, error } = await supabase
    .from("drivers")
    .select("*")
    .eq("id", driverId)
    .single();

  if (error) return null;
  return data;
}

async function updateDriverVerificationStatus(driverId) {
  const driver = await getDriverById(driverId);
  if (!driver) {
    throw new Error("Driver not found");
  }

  const emailVerified = driver.email_verified === true;
  const smsVerified = driver.sms_verified === true;

  let verificationStatus = "pending";
  if (emailVerified && smsVerified) {
    verificationStatus = "verified";
  } else if (emailVerified || smsVerified) {
    verificationStatus = "partially_verified";
  }

  const { data, error } = await supabase
    .from("drivers")
    .update({
      verification_status: verificationStatus,
      updated_at: nowIso()
    })
    .eq("id", driverId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

/* =========================================================
   EMAIL / SMS STUBS
   Replace internals later with nodemailer / twilio live send
========================================================= */

async function sendDriverVerificationEmail(driver, emailCode) {
  console.log("sendDriverVerificationEmail", {
    email: driver.email,
    code: emailCode
  });
  return { success: true };
}

async function sendDriverVerificationSms(driver, smsCode) {
  console.log("sendDriverVerificationSms", {
    phone: driver.phone,
    code: smsCode
  });
  return { success: true };
}

/* =========================================================
   DRIVER SIGNUP
========================================================= */

app.post("/api/driver/signup", async (req, res) => {
  try {
    const {
      firstName,
      lastName,
      email,
      phone,
      password,
      city,
      state,
      vehicleMake,
      vehicleModel,
      vehicleYear,
      vehicleColor,
      licensePlate,
      driverType
    } = req.body;

    const normalizedEmail = normalizeEmail(email);
    const normalizedPhone = normalizePhone(phone);

    if (!firstName || !lastName || !normalizedEmail || !normalizedPhone || !password) {
      return res.status(400).json({
        error: "Missing required driver fields"
      });
    }

    const existingDriver = await getDriverByEmailOrPhone(
      normalizedEmail,
      normalizedPhone
    );

    if (existingDriver) {
      return res.status(409).json({
        error: "Driver already exists with that email or phone"
      });
    }

    const driverId = uuid();
    const emailCode = randomDigits(6);
    const smsCode = randomDigits(6);

    const insertPayload = {
      id: driverId,
      first_name: firstName,
      last_name: lastName,
      email: normalizedEmail,
      phone: normalizedPhone,
      password,
      city: city || "",
      state: state || "TN",
      vehicle_make: vehicleMake || "",
      vehicle_model: vehicleModel || "",
      vehicle_year: vehicleYear || "",
      vehicle_color: vehicleColor || "",
      license_plate: licensePlate || "",
      driver_type: driverType || "human",
      is_available: false,
      is_approved: false,
      email_verified: false,
      sms_verified: false,
      email_verification_code_hash: sha256(emailCode),
      sms_verification_code_hash: sha256(smsCode),
      email_verification_expires_at: futureIsoMinutes(30),
      sms_verification_expires_at: futureIsoMinutes(15),
      verification_status: "pending",
      created_at: nowIso(),
      updated_at: nowIso()
    };

    const { data: driver, error } = await supabase
      .from("drivers")
      .insert(insertPayload)
      .select()
      .single();

    if (error) throw error;

    await sendDriverVerificationEmail(driver, emailCode);
    await sendDriverVerificationSms(driver, smsCode);

    await logTripEvent({
      actorType: "driver",
      actorId: driver.id,
      eventType: "driver_signup_created",
      payload: {
        email: driver.email,
        phone: driver.phone,
        driver_type: driver.driver_type
      }
    });

    res.json({
      success: true,
      message: "Driver created. Email and SMS verification required.",
      driver_id: driver.id,
      verification_status: driver.verification_status
    });
  } catch (err) {
    console.error("driver signup error", err);
    res.status(500).json({
      error: "Driver signup failed"
    });
  }
});

/* =========================================================
   DRIVER EMAIL VERIFICATION
========================================================= */

app.post("/api/driver/verify-email", async (req, res) => {
  try {
    const { driverId, code } = req.body;

    if (!driverId || !code) {
      return res.status(400).json({
        error: "driverId and code are required"
      });
    }

    const driver = await getDriverById(driverId);
    if (!driver) {
      return res.status(404).json({
        error: "Driver not found"
      });
    }

    if (!driver.email_verification_code_hash) {
      return res.status(400).json({
        error: "No email verification code found"
      });
    }

    if (
      driver.email_verification_expires_at &&
      new Date(driver.email_verification_expires_at).getTime() < Date.now()
    ) {
      return res.status(400).json({
        error: "Email verification code expired"
      });
    }

    if (sha256(code) !== driver.email_verification_code_hash) {
      return res.status(400).json({
        error: "Invalid email verification code"
      });
    }

    const { error } = await supabase
      .from("drivers")
      .update({
        email_verified: true,
        email_verified_at: nowIso(),
        email_verification_code_hash: null,
        email_verification_expires_at: null,
        updated_at: nowIso()
      })
      .eq("id", driverId);

    if (error) throw error;

    const updatedDriver = await updateDriverVerificationStatus(driverId);

    await logTripEvent({
      actorType: "driver",
      actorId: driverId,
      eventType: "driver_email_verified",
      payload: {
        verification_status: updatedDriver.verification_status
      }
    });

    res.json({
      success: true,
      verification_status: updatedDriver.verification_status
    });
  } catch (err) {
    console.error("driver verify email error", err);
    res.status(500).json({
      error: "Email verification failed"
    });
  }
});

/* =========================================================
   DRIVER SMS VERIFICATION
========================================================= */

app.post("/api/driver/verify-sms", async (req, res) => {
  try {
    const { driverId, code } = req.body;

    if (!driverId || !code) {
      return res.status(400).json({
        error: "driverId and code are required"
      });
    }

    const driver = await getDriverById(driverId);
    if (!driver) {
      return res.status(404).json({
        error: "Driver not found"
      });
    }

    if (!driver.sms_verification_code_hash) {
      return res.status(400).json({
        error: "No SMS verification code found"
      });
    }

    if (
      driver.sms_verification_expires_at &&
      new Date(driver.sms_verification_expires_at).getTime() < Date.now()
    ) {
      return res.status(400).json({
        error: "SMS verification code expired"
      });
    }

    if (sha256(code) !== driver.sms_verification_code_hash) {
      return res.status(400).json({
        error: "Invalid SMS verification code"
      });
    }

    const { error } = await supabase
      .from("drivers")
      .update({
        sms_verified: true,
        sms_verified_at: nowIso(),
        sms_verification_code_hash: null,
        sms_verification_expires_at: null,
        updated_at: nowIso()
      })
      .eq("id", driverId);

    if (error) throw error;

    const updatedDriver = await updateDriverVerificationStatus(driverId);

    await logTripEvent({
      actorType: "driver",
      actorId: driverId,
      eventType: "driver_sms_verified",
      payload: {
        verification_status: updatedDriver.verification_status
      }
    });

    res.json({
      success: true,
      verification_status: updatedDriver.verification_status
    });
  } catch (err) {
    console.error("driver verify sms error", err);
    res.status(500).json({
      error: "SMS verification failed"
    });
  }
});

/* =========================================================
   RESEND DRIVER VERIFICATION CODES
========================================================= */

app.post("/api/driver/resend-verification", async (req, res) => {
  try {
    const { driverId, channel } = req.body;

    const driver = await getDriverById(driverId);
    if (!driver) {
      return res.status(404).json({
        error: "Driver not found"
      });
    }

    if (channel !== "email" && channel !== "sms") {
      return res.status(400).json({
        error: "channel must be email or sms"
      });
    }

    if (channel === "email") {
      const emailCode = randomDigits(6);

      const { error } = await supabase
        .from("drivers")
        .update({
          email_verification_code_hash: sha256(emailCode),
          email_verification_expires_at: futureIsoMinutes(30),
          updated_at: nowIso()
        })
        .eq("id", driverId);

      if (error) throw error;
      await sendDriverVerificationEmail(driver, emailCode);
    }

    if (channel === "sms") {
      const smsCode = randomDigits(6);

      const { error } = await supabase
        .from("drivers")
        .update({
          sms_verification_code_hash: sha256(smsCode),
          sms_verification_expires_at: futureIsoMinutes(15),
          updated_at: nowIso()
        })
        .eq("id", driverId);

      if (error) throw error;
      await sendDriverVerificationSms(driver, smsCode);
    }

    await logTripEvent({
      actorType: "driver",
      actorId: driverId,
      eventType: "driver_verification_code_resent",
      payload: { channel }
    });

    res.json({
      success: true,
      message: `Driver ${channel} verification code resent`
    });
  } catch (err) {
    console.error("resend verification error", err);
    res.status(500).json({
      error: "Could not resend verification"
    });
  }
});/* =========================================================
   DRIVER AVAILABILITY
========================================================= */

async function getAvailableDrivers(requestedMode = "driver") {
  let query = supabase
    .from("drivers")
    .select("*")
    .eq("is_available", true)
    .eq("is_approved", true);

  if (requestedMode === "autonomous") {
    query = query.eq("driver_type", "autonomous");
  } else {
    query = query.in("driver_type", ["human", "driver"]);
  }

  const { data, error } = await query.order("updated_at", {
    ascending: true
  });

  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

app.post("/api/driver/:driverId/availability", async (req, res) => {
  try {
    const { driverId } = req.params;
    const { isAvailable } = req.body;

    const driver = await getDriverById(driverId);
    if (!driver) {
      return res.status(404).json({
        error: "Driver not found"
      });
    }

    if (driver.is_approved !== true) {
      return res.status(403).json({
        error: "Driver is not approved yet"
      });
    }

    if (driver.verification_status !== "verified") {
      return res.status(403).json({
        error: "Driver must complete email and SMS verification first"
      });
    }

    const { data, error } = await supabase
      .from("drivers")
      .update({
        is_available: isAvailable === true,
        updated_at: nowIso()
      })
      .eq("id", driverId)
      .select()
      .single();

    if (error) throw error;

    await logTripEvent({
      actorType: "driver",
      actorId: driverId,
      eventType: "driver_availability_updated",
      payload: {
        is_available: data.is_available
      }
    });

    res.json({
      success: true,
      driver: data
    });
  } catch (err) {
    console.error("driver availability error", err);
    res.status(500).json({
      error: "Could not update driver availability"
    });
  }
});

/* =========================================================
   DISPATCH HELPERS
========================================================= */

function scoreDriverForRide(driver, ride) {
  let score = 0;

  if (driver.driver_type === "autonomous" && ride.requested_mode === "autonomous") {
    score += 100;
  }

  if (
    (driver.driver_type === "human" || driver.driver_type === "driver") &&
    ride.requested_mode !== "autonomous"
  ) {
    score += 100;
  }

  if (driver.verification_status === "verified") {
    score += 50;
  }

  if (driver.is_available === true) {
    score += 25;
  }

  if (driver.city && ride.pickup_address) {
    const city = String(driver.city).toLowerCase();
    const pickup = String(ride.pickup_address).toLowerCase();
    if (pickup.includes(city)) {
      score += 30;
    }
  }

  const updatedAt = driver.updated_at ? new Date(driver.updated_at).getTime() : 0;
  score += Math.floor(updatedAt / 1000000000) % 10;

  return score;
}

async function createDispatchOffer({
  ride,
  driver,
  attemptNumber = 1,
  expiresInSeconds = 25
}) {
  const dispatchId = uuid();
  const missionId = uuid();
  const now = Date.now();

  const dispatchPayload = {
    id: dispatchId,
    ride_id: ride.id,
    driver_id: driver.id,
    mission_id: missionId,
    attempt_number: attemptNumber,
    status: "offered",
    expires_at: new Date(now + expiresInSeconds * 1000).toISOString(),
    created_at: nowIso(),
    updated_at: nowIso()
  };

  const { data: dispatch, error: dispatchError } = await supabase
    .from("dispatches")
    .insert(dispatchPayload)
    .select()
    .single();

  if (dispatchError) throw dispatchError;

  const missionPayload = {
    id: missionId,
    ride_id: ride.id,
    driver_id: driver.id,
    dispatch_id: dispatch.id,
    status: "offered",
    mission_type: ride.requested_mode === "autonomous" ? "autonomous_pickup" : "driver_pickup",
    pickup_address: ride.pickup_address,
    dropoff_address: ride.dropoff_address,
    estimated_fare: ride.estimated_fare || 0,
    notes: ride.notes || "",
    created_at: nowIso(),
    updated_at: nowIso()
  };

  const { data: mission, error: missionError } = await supabase
    .from("missions")
    .insert(missionPayload)
    .select()
    .single();

  if (missionError) throw missionError;

  await supabase
    .from("rides")
    .update({
      dispatch_status: "offered",
      assigned_driver_id: driver.id,
      current_dispatch_id: dispatch.id,
      updated_at: nowIso()
    })
    .eq("id", ride.id);

  await logTripEvent({
    rideId: ride.id,
    actorType: "system",
    actorId: null,
    eventType: "dispatch_offer_created",
    payload: {
      dispatch_id: dispatch.id,
      mission_id: mission.id,
      driver_id: driver.id,
      attempt_number: attemptNumber,
      expires_at: dispatch.expires_at
    }
  });

  return { dispatch, mission };
}

async function getRideById(rideId) {
  const { data, error } = await supabase
    .from("rides")
    .select("*")
    .eq("id", rideId)
    .single();

  if (error) return null;
  return data;
}

async function getOpenDispatchForRide(rideId) {
  const { data, error } = await supabase
    .from("dispatches")
    .select("*")
    .eq("ride_id", rideId)
    .in("status", ["offered", "accepted"])
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) throw error;
  return Array.isArray(data) && data.length ? data[0] : null;
}

async function getDispatchAttemptsCount(rideId) {
  const { count, error } = await supabase
    .from("dispatches")
    .select("*", { count: "exact", head: true })
    .eq("ride_id", rideId);

  if (error) throw error;
  return Number(count || 0);
}

/* =========================================================
   DISPATCH BRAIN
========================================================= */

async function dispatchRide(rideId) {
  const ride = await getRideById(rideId);
  if (!ride) {
    throw new Error("Ride not found");
  }

  if (!["searching_driver", "dispatch_retry"].includes(ride.status)) {
    return {
      success: false,
      reason: `Ride status ${ride.status} is not dispatchable`
    };
  }

  const openDispatch = await getOpenDispatchForRide(ride.id);
  if (openDispatch && openDispatch.status === "offered") {
    return {
      success: true,
      message: "Existing offer still open",
      dispatch_id: openDispatch.id
    };
  }

  const availableDrivers = await getAvailableDrivers(ride.requested_mode);
  if (!availableDrivers.length) {
    await supabase
      .from("rides")
      .update({
        dispatch_status: "no_drivers_available",
        updated_at: nowIso()
      })
      .eq("id", ride.id);

    await logTripEvent({
      rideId: ride.id,
      eventType: "dispatch_no_drivers_available",
      payload: {
        requested_mode: ride.requested_mode
      }
    });

    return {
      success: false,
      reason: "No drivers available"
    };
  }

  const priorDispatchesResp = await supabase
    .from("dispatches")
    .select("driver_id")
    .eq("ride_id", ride.id);

  const priorDriverIds = new Set(
    Array.isArray(priorDispatchesResp.data)
      ? priorDispatchesResp.data.map((d) => d.driver_id).filter(Boolean)
      : []
  );

  const eligibleDrivers = availableDrivers.filter(
    (driver) => !priorDriverIds.has(driver.id)
  );

  const candidatePool = eligibleDrivers.length ? eligibleDrivers : availableDrivers;

  const rankedDrivers = [...candidatePool].sort((a, b) => {
    return scoreDriverForRide(b, ride) - scoreDriverForRide(a, ride);
  });

  const selectedDriver = rankedDrivers[0];
  if (!selectedDriver) {
    return {
      success: false,
      reason: "No eligible driver selected"
    };
  }

  const attempts = await getDispatchAttemptsCount(ride.id);
  const created = await createDispatchOffer({
    ride,
    driver: selectedDriver,
    attemptNumber: attempts + 1,
    expiresInSeconds: 25
  });

  return {
    success: true,
    driver_id: selectedDriver.id,
    dispatch_id: created.dispatch.id,
    mission_id: created.mission.id
  };
}

app.post("/api/dispatch/:rideId/run", async (req, res) => {
  try {
    const { rideId } = req.params;
    const result = await dispatchRide(rideId);
    res.json(result);
  } catch (err) {
    console.error("dispatch run error", err);
    res.status(500).json({
      error: "Dispatch failed"
    });
  }
});

/* =========================================================
   DRIVER MISSION FEED
========================================================= */

app.get("/api/driver/:driverId/current-mission", async (req, res) => {
  try {
    const { driverId } = req.params;

    const { data, error } = await supabase
      .from("missions")
      .select("*")
      .eq("driver_id", driverId)
      .in("status", ["offered", "accepted", "en_route_pickup", "arrived_pickup", "in_progress"])
      .order("created_at", { ascending: false })
      .limit(1);

    if (error) throw error;

    const mission = Array.isArray(data) && data.length ? data[0] : null;

    res.json({
      success: true,
      mission
    });
  } catch (err) {
    console.error("current mission error", err);
    res.status(500).json({
      error: "Could not load current mission"
    });
  }
});

/* =========================================================
   DRIVER ACCEPT / DECLINE MISSION
========================================================= */

app.post("/api/driver/:driverId/missions/:missionId/respond", async (req, res) => {
  try {
    const { driverId, missionId } = req.params;
    const { action } = req.body;

    if (!["accept", "decline"].includes(action)) {
      return res.status(400).json({
        error: "action must be accept or decline"
      });
    }

    const { data: mission, error: missionError } = await supabase
      .from("missions")
      .select("*")
      .eq("id", missionId)
      .eq("driver_id", driverId)
      .single();

    if (missionError || !mission) {
      return res.status(404).json({
        error: "Mission not found"
      });
    }

    const { data: dispatch, error: dispatchError } = await supabase
      .from("dispatches")
      .select("*")
      .eq("id", mission.dispatch_id)
      .single();

    if (dispatchError || !dispatch) {
      return res.status(404).json({
        error: "Dispatch not found"
      });
    }

    if (dispatch.status !== "offered") {
      return res.status(400).json({
        error: `Dispatch already ${dispatch.status}`
      });
    }

    const expired =
      dispatch.expires_at &&
      new Date(dispatch.expires_at).getTime() < Date.now();

    if (expired) {
      await supabase
        .from("dispatches")
        .update({
          status: "expired",
          updated_at: nowIso()
        })
        .eq("id", dispatch.id);

      await supabase
        .from("missions")
        .update({
          status: "expired",
          updated_at: nowIso()
        })
        .eq("id", mission.id);

      return res.status(400).json({
        error: "Mission offer expired"
      });
    }

    if (action === "decline") {
      await supabase
        .from("dispatches")
        .update({
          status: "declined",
          responded_at: nowIso(),
          updated_at: nowIso()
        })
        .eq("id", dispatch.id);

      await supabase
        .from("missions")
        .update({
          status: "declined",
          updated_at: nowIso()
        })
        .eq("id", mission.id);

      await supabase
        .from("rides")
        .update({
          status: "dispatch_retry",
          dispatch_status: "retry_needed",
          assigned_driver_id: null,
          current_dispatch_id: null,
          updated_at: nowIso()
        })
        .eq("id", mission.ride_id);

      await logTripEvent({
        rideId: mission.ride_id,
        actorType: "driver",
        actorId: driverId,
        eventType: "mission_declined",
        payload: {
          mission_id: mission.id,
          dispatch_id: dispatch.id
        }
      });

      const retryResult = await dispatchRide(mission.ride_id);

      return res.json({
        success: true,
        action: "declined",
        retry: retryResult
      });
    }

    await supabase
      .from("dispatches")
      .update({
        status: "accepted",
        responded_at: nowIso(),
        updated_at: nowIso()
      })
      .eq("id", dispatch.id);

    await supabase
      .from("missions")
      .update({
        status: "accepted",
        accepted_at: nowIso(),
        updated_at: nowIso()
      })
      .eq("id", mission.id);

    await supabase
      .from("rides")
      .update({
        status: "driver_assigned",
        dispatch_status: "accepted",
        assigned_driver_id: driverId,
        current_dispatch_id: dispatch.id,
        updated_at: nowIso()
      })
      .eq("id", mission.ride_id);

    await logTripEvent({
      rideId: mission.ride_id,
      actorType: "driver",
      actorId: driverId,
      eventType: "mission_accepted",
      payload: {
        mission_id: mission.id,
        dispatch_id: dispatch.id
      }
    });

    res.json({
      success: true,
      action: "accepted",
      mission_id: mission.id,
      dispatch_id: dispatch.id
    });
  } catch (err) {
    console.error("mission respond error", err);
    res.status(500).json({
      error: "Could not process mission response"
    });
  }
});/* =========================================================
   RIDE / MISSION HELPERS
========================================================= */

async function getMissionById(missionId) {
  const { data, error } = await supabase
    .from("missions")
    .select("*")
    .eq("id", missionId)
    .single();

  if (error) return null;
  return data;
}

async function getRideByIdStrict(rideId) {
  const { data, error } = await supabase
    .from("rides")
    .select("*")
    .eq("id", rideId)
    .single();

  if (error) throw error;
  return data;
}

async function updateRideStatus(rideId, patch = {}) {
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

async function updateMissionStatus(missionId, patch = {}) {
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

async function getPaymentById(paymentId) {
  if (!paymentId) return null;

  const { data, error } = await supabase
    .from("payments")
    .select("*")
    .eq("id", paymentId)
    .single();

  if (error) return null;
  return data;
}

async function capturePaymentForRide(ride) {
  if (!ride.payment_id) {
    return {
      success: false,
      reason: "No payment attached to ride"
    };
  }

  const payment = await getPaymentById(ride.payment_id);
  if (!payment) {
    return {
      success: false,
      reason: "Payment not found"
    };
  }

  if (payment.status === "captured") {
    return {
      success: true,
      payment
    };
  }

  const { data, error } = await supabase
    .from("payments")
    .update({
      status: "captured",
      captured_at: nowIso(),
      updated_at: nowIso()
    })
    .eq("id", payment.id)
    .select()
    .single();

  if (error) throw error;

  await logTripEvent({
    rideId: ride.id,
    actorType: "system",
    eventType: "payment_captured",
    payload: {
      payment_id: payment.id,
      amount: payment.amount
    }
  });

  return {
    success: true,
    payment: data
  };
}

async function releasePaymentForRide(ride, reason = "ride_cancelled") {
  if (!ride.payment_id) {
    return {
      success: false,
      reason: "No payment attached to ride"
    };
  }

  const payment = await getPaymentById(ride.payment_id);
  if (!payment) {
    return {
      success: false,
      reason: "Payment not found"
    };
  }

  if (["released", "voided", "refunded"].includes(payment.status)) {
    return {
      success: true,
      payment
    };
  }

  const { data, error } = await supabase
    .from("payments")
    .update({
      status: "released",
      release_reason: reason,
      released_at: nowIso(),
      updated_at: nowIso()
    })
    .eq("id", payment.id)
    .select()
    .single();

  if (error) throw error;

  await logTripEvent({
    rideId: ride.id,
    actorType: "system",
    eventType: "payment_released",
    payload: {
      payment_id: payment.id,
      reason
    }
  });

  return {
    success: true,
    payment: data
  };
}

async function createDriverEarning({
  ride,
  driverId,
  grossFare = 0,
  tipAmount = 0,
  bookingFee = 0,
  platformFee = 0
}) {
  const gross = Number(grossFare || 0);
  const tip = Number(tipAmount || 0);
  const booking = Number(bookingFee || 0);
  const platform = Number(platformFee || 0);
  const payout = gross + tip - booking - platform;

  const { data, error } = await supabase
    .from("driver_earnings")
    .insert({
      id: uuid(),
      ride_id: ride.id,
      driver_id: driverId,
      gross_fare: gross,
      tip_amount: tip,
      booking_fee: booking,
      platform_fee: platform,
      payout_amount: payout,
      payout_status: "pending",
      created_at: nowIso(),
      updated_at: nowIso()
    })
    .select()
    .single();

  if (error) throw error;

  await logTripEvent({
    rideId: ride.id,
    actorType: "system",
    eventType: "driver_earning_created",
    payload: {
      driver_id: driverId,
      payout_amount: payout
    }
  });

  return data;
}

/* =========================================================
   DRIVER RIDE STATUS ACTIONS
========================================================= */

app.post("/api/driver/:driverId/missions/:missionId/status", async (req, res) => {
  try {
    const { driverId, missionId } = req.params;
    const { status } = req.body;

    const allowedStatuses = [
      "en_route_pickup",
      "arrived_pickup",
      "in_progress",
      "completed"
    ];

    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({
        error: `status must be one of: ${allowedStatuses.join(", ")}`
      });
    }

    const mission = await getMissionById(missionId);
    if (!mission || mission.driver_id !== driverId) {
      return res.status(404).json({
        error: "Mission not found"
      });
    }

    const ride = await getRideByIdStrict(mission.ride_id);

    if (status === "en_route_pickup") {
      const updatedMission = await updateMissionStatus(missionId, {
        status: "en_route_pickup",
        started_at: mission.started_at || nowIso()
      });

      const updatedRide = await updateRideStatus(ride.id, {
        status: "driver_en_route"
      });

      await logTripEvent({
        rideId: ride.id,
        actorType: "driver",
        actorId: driverId,
        eventType: "driver_en_route_pickup",
        payload: {
          mission_id: missionId
        }
      });

      return res.json({
        success: true,
        mission: updatedMission,
        ride: updatedRide
      });
    }

    if (status === "arrived_pickup") {
      const updatedMission = await updateMissionStatus(missionId, {
        status: "arrived_pickup",
        arrived_pickup_at: nowIso()
      });

      const updatedRide = await updateRideStatus(ride.id, {
        status: "driver_arrived"
      });

      await logTripEvent({
        rideId: ride.id,
        actorType: "driver",
        actorId: driverId,
        eventType: "driver_arrived_pickup",
        payload: {
          mission_id: missionId
        }
      });

      return res.json({
        success: true,
        mission: updatedMission,
        ride: updatedRide
      });
    }

    if (status === "in_progress") {
      const updatedMission = await updateMissionStatus(missionId, {
        status: "in_progress",
        trip_started_at: nowIso()
      });

      const updatedRide = await updateRideStatus(ride.id, {
        status: "trip_in_progress",
        trip_started_at: ride.trip_started_at || nowIso()
      });

      await logTripEvent({
        rideId: ride.id,
        actorType: "driver",
        actorId: driverId,
        eventType: "trip_started",
        payload: {
          mission_id: missionId
        }
      });

      return res.json({
        success: true,
        mission: updatedMission,
        ride: updatedRide
      });
    }

    if (status === "completed") {
      const finalFare = Number(req.body.finalFare || ride.estimated_fare || 0);
      const tipAmount = Number(req.body.tipAmount || 0);
      const bookingFee = Number(req.body.bookingFee || 0);
      const platformFee = Number(req.body.platformFee || 0);

      const updatedMission = await updateMissionStatus(missionId, {
        status: "completed",
        completed_at: nowIso()
      });

      const updatedRide = await updateRideStatus(ride.id, {
        status: "completed",
        dispatch_status: "completed",
        completed_at: nowIso(),
        final_fare: finalFare,
        tip_amount: tipAmount
      });

      await capturePaymentForRide(updatedRide);

      const earning = await createDriverEarning({
        ride: updatedRide,
        driverId,
        grossFare: finalFare,
        tipAmount,
        bookingFee,
        platformFee
      });

      await supabase
        .from("drivers")
        .update({
          is_available: true,
          updated_at: nowIso()
        })
        .eq("id", driverId);

      await logTripEvent({
        rideId: ride.id,
        actorType: "driver",
        actorId: driverId,
        eventType: "trip_completed",
        payload: {
          mission_id: missionId,
          final_fare: finalFare,
          tip_amount: tipAmount,
          earning_id: earning.id
        }
      });

      return res.json({
        success: true,
        mission: updatedMission,
        ride: updatedRide,
        earning
      });
    }
  } catch (err) {
    console.error("mission status update error", err);
    res.status(500).json({
      error: "Could not update trip status"
    });
  }
});

/* =========================================================
   RIDER / DRIVER RIDE STATUS ENDPOINTS
========================================================= */

app.get("/api/rides/:rideId/status", async (req, res) => {
  try {
    const ride = await getRideByIdStrict(req.params.rideId);

    let mission = null;
    if (ride.current_dispatch_id) {
      const { data } = await supabase
        .from("missions")
        .select("*")
        .eq("dispatch_id", ride.current_dispatch_id)
        .order("created_at", { ascending: false })
        .limit(1);

      mission = Array.isArray(data) && data.length ? data[0] : null;
    }

    res.json({
      success: true,
      ride,
      mission
    });
  } catch (err) {
    console.error("ride status error", err);
    res.status(500).json({
      error: "Could not load ride status"
    });
  }
});

app.get("/api/rider/:riderId/rides", async (req, res) => {
  try {
    const { riderId } = req.params;

    const { data, error } = await supabase
      .from("rides")
      .select("*")
      .eq("rider_id", riderId)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) throw error;

    res.json({
      success: true,
      rides: Array.isArray(data) ? data : []
    });
  } catch (err) {
    console.error("rider rides error", err);
    res.status(500).json({
      error: "Could not load rider rides"
    });
  }
});

app.get("/api/driver/:driverId/current-ride", async (req, res) => {
  try {
    const { driverId } = req.params;

    const { data, error } = await supabase
      .from("rides")
      .select("*")
      .eq("assigned_driver_id", driverId)
      .in("status", [
        "driver_assigned",
        "driver_en_route",
        "driver_arrived",
        "trip_in_progress"
      ])
      .order("created_at", { ascending: false })
      .limit(1);

    if (error) throw error;

    const ride = Array.isArray(data) && data.length ? data[0] : null;

    res.json({
      success: true,
      ride
    });
  } catch (err) {
    console.error("driver current ride error", err);
    res.status(500).json({
      error: "Could not load driver current ride"
    });
  }
});

app.get("/api/driver/:driverId/earnings", async (req, res) => {
  try {
    const { driverId } = req.params;

    const { data, error } = await supabase
      .from("driver_earnings")
      .select("*")
      .eq("driver_id", driverId)
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) throw error;

    const earnings = Array.isArray(data) ? data : [];
    const totalPayout = earnings.reduce(
      (sum, item) => sum + Number(item.payout_amount || 0),
      0
    );

    res.json({
      success: true,
      total_payout: totalPayout,
      earnings
    });
  } catch (err) {
    console.error("driver earnings error", err);
    res.status(500).json({
      error: "Could not load driver earnings"
    });
  }
});/* =========================================================
   CANCEL / REDISPATCH HELPERS
========================================================= */

async function expireDispatchAndMission(dispatchId, missionId) {
  if (dispatchId) {
    await supabase
      .from("dispatches")
      .update({
        status: "expired",
        updated_at: nowIso()
      })
      .eq("id", dispatchId);
  }

  if (missionId) {
    await supabase
      .from("missions")
      .update({
        status: "expired",
        updated_at: nowIso()
      })
      .eq("id", missionId);
  }
}

async function findMissionByDispatchId(dispatchId) {
  const { data, error } = await supabase
    .from("missions")
    .select("*")
    .eq("dispatch_id", dispatchId)
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) throw error;
  return Array.isArray(data) && data.length ? data[0] : null;
}

async function cancelRideInternal({
  ride,
  cancelledBy = "system",
  actorId = null,
  reason = "cancelled"
}) {
  const activeStatuses = [
    "searching_driver",
    "dispatch_retry",
    "driver_assigned",
    "driver_en_route",
    "driver_arrived"
  ];

  if (!activeStatuses.includes(ride.status)) {
    return {
      success: false,
      reason: `Ride cannot be cancelled from status ${ride.status}`
    };
  }

  if (ride.current_dispatch_id) {
    const mission = await findMissionByDispatchId(ride.current_dispatch_id);
    await expireDispatchAndMission(
      ride.current_dispatch_id,
      mission ? mission.id : null
    );
  }

  const updatedRide = await updateRideStatus(ride.id, {
    status: "cancelled",
    dispatch_status: "cancelled",
    cancelled_at: nowIso(),
    cancelled_by: cancelledBy,
    cancellation_reason: reason
  });

  await releasePaymentForRide(updatedRide, reason);

  if (ride.assigned_driver_id) {
    await supabase
      .from("drivers")
      .update({
        is_available: true,
        updated_at: nowIso()
      })
      .eq("id", ride.assigned_driver_id);
  }

  await logTripEvent({
    rideId: ride.id,
    actorType: cancelledBy,
    actorId,
    eventType: "ride_cancelled",
    payload: {
      reason
    }
  });

  return {
    success: true,
    ride: updatedRide
  };
}

/* =========================================================
   RIDE CANCELLATION
========================================================= */

app.post("/api/rides/:rideId/cancel", async (req, res) => {
  try {
    const { rideId } = req.params;
    const { actorType, actorId, reason } = req.body;

    const ride = await getRideByIdStrict(rideId);

    const result = await cancelRideInternal({
      ride,
      cancelledBy: actorType || "rider",
      actorId: actorId || null,
      reason: reason || "ride_cancelled"
    });

    if (!result.success) {
      return res.status(400).json(result);
    }

    res.json(result);
  } catch (err) {
    console.error("ride cancel error", err);
    res.status(500).json({
      error: "Could not cancel ride"
    });
  }
});

/* =========================================================
   AUTO REDISPATCH TIMEOUT SWEEPER
========================================================= */

async function sweepExpiredDispatches() {
  const now = nowIso();

  const { data: expiredDispatches, error } = await supabase
    .from("dispatches")
    .select("*")
    .eq("status", "offered")
    .lt("expires_at", now)
    .limit(50);

  if (error) {
    console.error("expired dispatch sweep query error", error.message);
    return;
  }

  for (const dispatch of expiredDispatches || []) {
    try {
      const mission = await findMissionByDispatchId(dispatch.id);

      await expireDispatchAndMission(dispatch.id, mission ? mission.id : null);

      const ride = await getRideById(dispatch.ride_id);
      if (!ride) continue;

      if (
        ["completed", "cancelled"].includes(ride.status) ||
        ride.dispatch_status === "completed"
      ) {
        continue;
      }

      await updateRideStatus(ride.id, {
        status: "dispatch_retry",
        dispatch_status: "retry_needed",
        assigned_driver_id: null,
        current_dispatch_id: null
      });

      await logTripEvent({
        rideId: ride.id,
        actorType: "system",
        eventType: "dispatch_offer_expired",
        payload: {
          dispatch_id: dispatch.id,
          mission_id: mission ? mission.id : null
        }
      });

      await dispatchRide(ride.id);
    } catch (sweepErr) {
      console.error("dispatch sweep item error", sweepErr.message);
    }
  }
}

setInterval(() => {
  sweepExpiredDispatches().catch((err) => {
    console.error("dispatch sweep fatal error", err.message);
  });
}, 10000);

/* =========================================================
   ADMIN DISPATCH CONTROLS
========================================================= */

function isAdminRequest(req) {
  const email =
    cleanEnv(req.headers["x-admin-email"]) ||
    cleanEnv(req.body?.adminEmail) ||
    cleanEnv(req.query?.adminEmail);

  const password =
    cleanEnv(req.headers["x-admin-password"]) ||
    cleanEnv(req.body?.adminPassword) ||
    cleanEnv(req.query?.adminPassword);

  return email === ADMIN_EMAIL && password === ADMIN_PASSWORD;
}

app.post("/api/admin/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const ok =
      cleanEnv(email) === ADMIN_EMAIL &&
      cleanEnv(password) === ADMIN_PASSWORD;

    if (!ok) {
      return res.status(401).json({
        error: "Invalid admin credentials"
      });
    }

    res.json({
      success: true,
      admin: {
        email: ADMIN_EMAIL
      }
    });
  } catch (err) {
    console.error("admin login error", err);
    res.status(500).json({
      error: "Admin login failed"
    });
  }
});

app.get("/api/admin/rides/active", async (req, res) => {
  try {
    if (!isAdminRequest(req)) {
      return res.status(401).json({
        error: "Unauthorized"
      });
    }

    const { data, error } = await supabase
      .from("rides")
      .select("*")
      .in("status", [
        "searching_driver",
        "dispatch_retry",
        "driver_assigned",
        "driver_en_route",
        "driver_arrived",
        "trip_in_progress"
      ])
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) throw error;

    res.json({
      success: true,
      rides: Array.isArray(data) ? data : []
    });
  } catch (err) {
    console.error("admin active rides error", err);
    res.status(500).json({
      error: "Could not load active rides"
    });
  }
});

app.post("/api/admin/rides/:rideId/dispatch", async (req, res) => {
  try {
    if (!isAdminRequest(req)) {
      return res.status(401).json({
        error: "Unauthorized"
      });
    }

    const { rideId } = req.params;
    const result = await dispatchRide(rideId);

    await logTripEvent({
      rideId,
      actorType: "admin",
      actorId: ADMIN_EMAIL,
      eventType: "admin_dispatch_triggered",
      payload: result
    });

    res.json({
      success: true,
      result
    });
  } catch (err) {
    console.error("admin dispatch trigger error", err);
    res.status(500).json({
      error: "Admin dispatch trigger failed"
    });
  }
});

app.post("/api/admin/rides/:rideId/cancel", async (req, res) => {
  try {
    if (!isAdminRequest(req)) {
      return res.status(401).json({
        error: "Unauthorized"
      });
    }

    const { rideId } = req.params;
    const ride = await getRideByIdStrict(rideId);

    const result = await cancelRideInternal({
      ride,
      cancelledBy: "admin",
      actorId: ADMIN_EMAIL,
      reason: req.body?.reason || "admin_cancelled"
    });

    if (!result.success) {
      return res.status(400).json(result);
    }

    res.json(result);
  } catch (err) {
    console.error("admin ride cancel error", err);
    res.status(500).json({
      error: "Admin ride cancellation failed"
    });
  }
});

app.get("/api/admin/dispatches/:rideId", async (req, res) => {
  try {
    if (!isAdminRequest(req)) {
      return res.status(401).json({
        error: "Unauthorized"
      });
    }

    const { rideId } = req.params;

    const { data, error } = await supabase
      .from("dispatches")
      .select("*")
      .eq("ride_id", rideId)
      .order("created_at", { ascending: false });

    if (error) throw error;

    res.json({
      success: true,
      dispatches: Array.isArray(data) ? data : []
    });
  } catch (err) {
    console.error("admin dispatch history error", err);
    res.status(500).json({
      error: "Could not load dispatch history"
    });
  }
});

app.get("/api/admin/trip-events/:rideId", async (req, res) => {
  try {
    if (!isAdminRequest(req)) {
      return res.status(401).json({
        error: "Unauthorized"
      });
    }

    const { rideId } = req.params;

    const { data, error } = await supabase
      .from("trip_events")
      .select("*")
      .eq("ride_id", rideId)
      .order("created_at", { ascending: true });

    if (error) throw error;

    res.json({
      success: true,
      events: Array.isArray(data) ? data : []
    });
  } catch (err) {
    console.error("admin trip events error", err);
    res.status(500).json({
      error: "Could not load trip events"
    });
  }
});/* =========================================================
   PERSONA RIDER VERIFICATION
========================================================= */

async function updateRiderVerificationStatus(riderId, status, payload = {}) {
  const approved = status === "approved";

  const { data, error } = await supabase
    .from("riders")
    .update({
      verification_status: status,
      approved,
      verified_at: approved ? nowIso() : null,
      verification_payload: payload,
      updated_at: nowIso()
    })
    .eq("id", riderId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

async function findRiderByInquiryId(inquiryId) {
  const { data, error } = await supabase
    .from("riders")
    .select("*")
    .eq("verification_inquiry_id", inquiryId)
    .single();

  if (error) return null;
  return data;
}

/* =========================================================
   PERSONA WEBHOOK
========================================================= */

app.post("/api/webhooks/persona", async (req, res) => {
  try {
    const body = req.body;

    const inquiryId =
      body?.data?.id ||
      body?.inquiryId ||
      body?.inquiry_id;

    const status =
      body?.data?.attributes?.status ||
      body?.status;

    if (!inquiryId) {
      return res.json({ ok: true });
    }

    const rider = await findRiderByInquiryId(inquiryId);

    if (!rider) {
      return res.json({ ok: true });
    }

    let mappedStatus = "pending";

    if (status === "approved") {
      mappedStatus = "approved";
    }

    if (status === "declined") {
      mappedStatus = "declined";
    }

    if (status === "completed") {
      mappedStatus = "approved";
    }

    const updated = await updateRiderVerificationStatus(
      rider.id,
      mappedStatus,
      body
    );

    await logTripEvent({
      actorType: "system",
      actorId: null,
      eventType: "rider_verification_updated",
      payload: {
        rider_id: rider.id,
        inquiry_id: inquiryId,
        status: mappedStatus
      }
    });

    res.json({
      ok: true
    });
  } catch (err) {
    console.error("persona webhook error", err);
    res.json({
      ok: true
    });
  }
});

/* =========================================================
   START RIDER VERIFICATION SESSION
========================================================= */

app.post("/api/rider/:riderId/start-verification", async (req, res) => {
  try {
    const { riderId } = req.params;

    const inquiryId = "persona_" + uuid();

    const { data, error } = await supabase
      .from("riders")
      .update({
        verification_status: "pending",
        verification_inquiry_id: inquiryId,
        verification_started_at: nowIso(),
        updated_at: nowIso()
      })
      .eq("id", riderId)
      .select()
      .single();

    if (error) throw error;

    res.json({
      success: true,
      inquiryId,
      rider: data
    });
  } catch (err) {
    console.error("start verification error", err);
    res.status(500).json({
      error: "Could not start verification"
    });
  }
});

/* =========================================================
   GET RIDER STATUS
========================================================= */

app.get("/api/rider/:riderId/status", async (req, res) => {
  try {
    const { riderId } = req.params;

    const { data, error } = await supabase
      .from("riders")
      .select("*")
      .eq("id", riderId)
      .single();

    if (error) throw error;

    res.json({
      success: true,
      rider: data,
      verified: data.verification_status === "approved"
    });
  } catch (err) {
    console.error("rider status error", err);
    res.status(500).json({
      error: "Could not load rider status"
    });
  }
});

/* =========================================================
   SERVER START
========================================================= */

app.listen(PORT, () => {
  console.log("========================================");
  console.log("Harvey Taxi Phase 7 Server Running");
  console.log("Port:", PORT);
  console.log("Environment:", process.env.NODE_ENV || "production");
  console.log("========================================");
});/* =========================================================
   PHASE 8 AI HELPERS
========================================================= */

function clampNumber(value, min, max) {
  const num = Number(value || 0);
  if (!Number.isFinite(num)) return min;
  return Math.max(min, Math.min(max, num));
}

function safeJsonParse(value, fallback = null) {
  try {
    return JSON.parse(value);
  } catch (error) {
    return fallback;
  }
}

function estimateDistanceMilesFromAddresses(pickupAddress = "", dropoffAddress = "") {
  const a = String(pickupAddress || "").trim();
  const b = String(dropoffAddress || "").trim();

  if (!a || !b) return 5;

  const combinedLength = Math.abs(a.length - b.length) + ((a.length + b.length) / 20);
  return clampNumber(Math.round(combinedLength), 2, 35);
}

function estimateDurationMinutesFromMiles(miles = 0) {
  const base = Number(miles || 0) * 3;
  return clampNumber(Math.round(base + 8), 8, 120);
}

async function getActiveRideCounts() {
  const statuses = [
    "searching_driver",
    "dispatch_retry",
    "driver_assigned",
    "driver_en_route",
    "driver_arrived",
    "trip_in_progress"
  ];

  const { data, error } = await supabase
    .from("rides")
    .select("id,status")
    .in("status", statuses);

  if (error) throw error;

  return {
    activeRides: Array.isArray(data) ? data.length : 0
  };
}

async function getAvailableDriverCountByMode(requestedMode = "driver") {
  const drivers = await getAvailableDrivers(requestedMode);
  return drivers.length;
}

async function getDemandMultiplier(requestedMode = "driver") {
  const { activeRides } = await getActiveRideCounts();
  const availableDrivers = await getAvailableDriverCountByMode(requestedMode);

  if (availableDrivers <= 0) return 2.2;

  const ratio = activeRides / Math.max(availableDrivers, 1);

  if (ratio >= 3) return 2.0;
  if (ratio >= 2) return 1.7;
  if (ratio >= 1.25) return 1.35;
  if (ratio >= 0.8) return 1.15;
  return 1.0;
}

function calculateRuleBasedFare({
  pickupAddress,
  dropoffAddress,
  rideType = "STANDARD",
  requestedMode = "driver"
}) {
  const miles = estimateDistanceMilesFromAddresses(pickupAddress, dropoffAddress);
  const minutes = estimateDurationMinutesFromMiles(miles);

  const baseFare = requestedMode === "autonomous" ? 6.5 : 5.0;
  const perMile = requestedMode === "autonomous" ? 2.35 : 2.1;
  const perMinute = requestedMode === "autonomous" ? 0.48 : 0.42;
  const bookingFee = 2.25;

  let rideTypeMultiplier = 1.0;
  if (rideType === "AIRPORT") rideTypeMultiplier = 1.2;
  if (rideType === "SCHEDULED") rideTypeMultiplier = 1.15;
  if (rideType === "MEDICAL") rideTypeMultiplier = 1.1;
  if (rideType === "NONPROFIT") rideTypeMultiplier = 0.9;

  const subtotal = (baseFare + miles * perMile + minutes * perMinute) * rideTypeMultiplier;
  const total = subtotal + bookingFee;

  return {
    estimated_distance_miles: miles,
    estimated_duration_minutes: minutes,
    base_fare: Number(baseFare.toFixed(2)),
    per_mile_rate: Number(perMile.toFixed(2)),
    per_minute_rate: Number(perMinute.toFixed(2)),
    booking_fee: Number(bookingFee.toFixed(2)),
    ride_type_multiplier: rideTypeMultiplier,
    estimated_fare: Number(total.toFixed(2))
  };
}

async function getDriverDispatchStats(driverId) {
  const [dispatchesResp, earningsResp] = await Promise.all([
    supabase
      .from("dispatches")
      .select("status")
      .eq("driver_id", driverId),
    supabase
      .from("driver_earnings")
      .select("payout_amount")
      .eq("driver_id", driverId)
  ]);

  const dispatchRows = Array.isArray(dispatchesResp.data) ? dispatchesResp.data : [];
  const earningRows = Array.isArray(earningsResp.data) ? earningsResp.data : [];

  const offered = dispatchRows.length;
  const accepted = dispatchRows.filter((row) => row.status === "accepted").length;
  const declined = dispatchRows.filter((row) => row.status === "declined").length;
  const acceptanceRate = offered > 0 ? accepted / offered : 0;

  const totalPayout = earningRows.reduce(
    (sum, row) => sum + Number(row.payout_amount || 0),
    0
  );

  return {
    offered,
    accepted,
    declined,
    acceptance_rate: Number(acceptanceRate.toFixed(4)),
    total_payout: Number(totalPayout.toFixed(2))
  };
}

async function buildAiDispatchContext(driver, ride) {
  const stats = await getDriverDispatchStats(driver.id);

  return {
    driver_id: driver.id,
    driver_type: driver.driver_type,
    city: driver.city || "",
    is_available: driver.is_available === true,
    verification_status: driver.verification_status || "pending",
    is_approved: driver.is_approved === true,
    acceptance_rate: stats.acceptance_rate,
    total_completed_payout: stats.total_payout,
    historical_offers: stats.offered,
    historical_accepts: stats.accepted,
    ride_id: ride.id,
    requested_mode: ride.requested_mode,
    pickup_address: ride.pickup_address,
    dropoff_address: ride.dropoff_address,
    estimated_fare: Number(ride.estimated_fare || 0),
    ride_type: ride.ride_type || "STANDARD"
  };
}

async function aiScoreDriverForRide(driver, ride) {
  const ruleScore = scoreDriverForRide(driver, ride);

  if (!openai) {
    return {
      final_score: ruleScore,
      reason: "OpenAI not configured, using rule-based score only",
      ai_used: false
    };
  }

  try {
    const context = await buildAiDispatchContext(driver, ride);

    const completion = await openai.chat.completions.create({
      model: OPENAI_SUPPORT_MODEL,
      temperature: 0.1,
      messages: [
        {
          role: "system",
          content:
            "You score taxi driver dispatch candidates. Return JSON only with keys final_score and reason. final_score must be a number from 0 to 1000."
        },
        {
          role: "user",
          content: JSON.stringify({
            instruction:
              "Score this driver for this ride. Heavily reward approval, verification, availability, ride-mode match, city match, and acceptance history. Penalize weak fit. Start from the supplied rule_score but improve it intelligently.",
            rule_score: ruleScore,
            context
          })
        }
      ]
    });

    const text = completion.choices?.[0]?.message?.content || "";
    const parsed = safeJsonParse(text, null);

    if (!parsed || typeof parsed.final_score !== "number") {
      return {
        final_score: ruleScore,
        reason: "AI response invalid, using rule-based score",
        ai_used: false
      };
    }

    return {
      final_score: clampNumber(parsed.final_score, 0, 1000),
      reason: parsed.reason || "AI-scored candidate",
      ai_used: true
    };
  } catch (error) {
    console.error("ai score driver error", error.message);
    return {
      final_score: ruleScore,
      reason: "AI scoring failed, using rule-based score",
      ai_used: false
    };
  }
}

async function getAiFareBreakdown({
  pickupAddress,
  dropoffAddress,
  rideType = "STANDARD",
  requestedMode = "driver"
}) {
  const base = calculateRuleBasedFare({
    pickupAddress,
    dropoffAddress,
    rideType,
    requestedMode
  });

  const demandMultiplier = await getDemandMultiplier(requestedMode);
  const surgedFare = Number((base.estimated_fare * demandMultiplier).toFixed(2));

  if (!openai) {
    return {
      ...base,
      demand_multiplier: demandMultiplier,
      estimated_fare: surgedFare,
      pricing_mode: "rules_only",
      ai_summary: "Rule-based fare estimate used."
    };
  }

  try {
    const completion = await openai.chat.completions.create({
      model: OPENAI_SUPPORT_MODEL,
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content:
            "You are a taxi pricing optimizer. Return JSON only with keys recommended_multiplier and summary. recommended_multiplier must be a number from 0.8 to 3.0."
        },
        {
          role: "user",
          content: JSON.stringify({
            instruction:
              "Adjust the surge multiplier for this taxi ride based on ride mode, ride type, estimated time, and current demand.",
            base,
            requested_mode: requestedMode,
            ride_type: rideType,
            default_demand_multiplier: demandMultiplier
          })
        }
      ]
    });

    const text = completion.choices?.[0]?.message?.content || "";
    const parsed = safeJsonParse(text, null);

    const recommendedMultiplier = clampNumber(
      parsed?.recommended_multiplier ?? demandMultiplier,
      0.8,
      3.0
    );

    return {
      ...base,
      demand_multiplier: recommendedMultiplier,
      estimated_fare: Number((base.estimated_fare * recommendedMultiplier).toFixed(2)),
      pricing_mode: "ai_optimized",
      ai_summary: parsed?.summary || "AI fare optimization applied."
    };
  } catch (error) {
    console.error("ai fare error", error.message);
    return {
      ...base,
      demand_multiplier: demandMultiplier,
      estimated_fare: surgedFare,
      pricing_mode: "rules_fallback",
      ai_summary: "AI pricing unavailable, fallback estimate used."
    };
  }
}

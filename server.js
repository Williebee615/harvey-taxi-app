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
const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  GOOGLE_MAPS_API_KEY,
  PUBLIC_APP_URL,
  RENDER_EXTERNAL_URL,
  APP_BASE_URL,
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_PHONE_NUMBER,
  SENDGRID_API_KEY,
  SUPPORT_FROM_EMAIL
} = process.env;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

/* =========================================================
   CONSTANTS
========================================================= */
const DISPATCH_OFFER_TIMEOUT_MS = 20000;
const MAX_DISPATCH_ATTEMPTS = 5;
const DEFAULT_CURRENCY = "usd";
const PLATFORM_BOOKING_FEE = 2.5;
const MINIMUM_FARE = 10;
const BASE_FARE = 4;
const PER_MILE_RATE = 2.2;
const PER_MINUTE_RATE = 0.35;

/* =========================================================
   HELPERS
========================================================= */
function nowIso() {
  return new Date().toISOString();
}

function makeId(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizePhone(value) {
  return String(value || "").replace(/[^\d+]/g, "").trim();
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function requireFields(payload, fields) {
  const missing = fields.filter((field) => {
    const value = payload[field];
    return value === undefined || value === null || String(value).trim() === "";
  });

  if (missing.length) {
    return `Missing required field(s): ${missing.join(", ")}`;
  }

  return null;
}

function sanitizeText(value) {
  return String(value || "").trim();
}

function publicBaseUrl() {
  return (
    PUBLIC_APP_URL ||
    RENDER_EXTERNAL_URL ||
    APP_BASE_URL ||
    `http://localhost:${PORT}`
  ).replace(/\/+$/, "");
}

function randomCode(length = 6) {
  let output = "";
  while (output.length < length) {
    output += Math.floor(Math.random() * 10);
  }
  return output.slice(0, length);
}

function futureIsoMinutes(minutes) {
  return new Date(Date.now() + minutes * 60 * 1000).toISOString();
}

function estimateDistanceMiles(pickup, dropoff) {
  const pickupText = `${pickup}`.trim();
  const dropoffText = `${dropoff}`.trim();
  const roughSeed = pickupText.length + dropoffText.length;
  return clamp(Math.round((roughSeed % 18) + 4), 2, 25);
}

function estimateDurationMinutes(distanceMiles) {
  return clamp(Math.round(distanceMiles * 4.2), 8, 90);
}

function calculateFare({ distanceMiles, durationMinutes, surgeMultiplier = 1 }) {
  const subtotal =
    BASE_FARE +
    distanceMiles * PER_MILE_RATE +
    durationMinutes * PER_MINUTE_RATE;

  const surged = subtotal * surgeMultiplier;
  const total = Math.max(MINIMUM_FARE, surged + PLATFORM_BOOKING_FEE);

  return {
    currency: DEFAULT_CURRENCY,
    base_fare: roundMoney(BASE_FARE),
    distance_fare: roundMoney(distanceMiles * PER_MILE_RATE),
    time_fare: roundMoney(durationMinutes * PER_MINUTE_RATE),
    booking_fee: roundMoney(PLATFORM_BOOKING_FEE),
    surge_multiplier: surgeMultiplier,
    estimated_total: roundMoney(total)
  };
}

function driverPayoutFromFare(estimatedTotal) {
  return roundMoney(estimatedTotal * 0.78);
}

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function maskPhone(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.length < 4) return "****";
  return `***-***-${digits.slice(-4)}`;
}

function maskEmail(email) {
  const value = String(email || "").trim();
  if (!value.includes("@")) return value;
  const [name, domain] = value.split("@");
  const safeName =
    name.length <= 2 ? `${name[0] || "*"}*` : `${name.slice(0, 2)}***`;
  return `${safeName}@${domain}`;
}

/* =========================================================
   DB HELPERS
========================================================= */
async function getRiderById(riderId) {
  const { data, error } = await supabase
    .from("riders")
    .select("*")
    .eq("id", riderId)
    .single();

  if (error) return null;
  return data;
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

async function getRideById(rideId) {
  const { data, error } = await supabase
    .from("rides")
    .select("*")
    .eq("id", rideId)
    .single();

  if (error) return null;
  return data;
}

async function getActiveDispatchForRide(rideId) {
  const { data, error } = await supabase
    .from("dispatches")
    .select("*")
    .eq("ride_id", rideId)
    .in("status", ["offered", "pending"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return null;
  return data || null;
}

async function createEventLog(type, payload = {}) {
  const row = {
    id: makeId("evt"),
    type,
    payload,
    created_at: nowIso()
  };

  await supabase.from("events").insert(row);
  return row;
}

async function getAvailableDrivers(requestedMode = "driver") {
  let query = supabase
    .from("drivers")
    .select("*")
    .eq("is_approved", true)
    .eq("is_available", true);

  if (requestedMode === "autonomous") {
    query = query.eq("driver_type", "autonomous");
  } else {
    query = query.in("driver_type", ["human", "driver", null]);
  }

  const { data, error } = await query.order("updated_at", { ascending: true });

  if (error) throw error;
  return data || [];
}

async function markDriverAvailability(driverId, isAvailable) {
  const { data, error } = await supabase
    .from("drivers")
    .update({
      is_available: !!isAvailable,
      updated_at: nowIso()
    })
    .eq("id", driverId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

async function ensureNoOpenRideForRider(riderId) {
  const { data, error } = await supabase
    .from("rides")
    .select("id,status")
    .eq("rider_id", riderId)
    .in("status", ["requested", "dispatching", "driver_assigned", "en_route", "arrived", "in_progress"])
    .limit(1);

  if (error) throw error;

  if (data && data.length) {
    throw new Error("Rider already has an active trip.");
  }
}

async function ensureRiderApproved(riderId) {
  const rider = await getRiderById(riderId);
  if (!rider) throw new Error("Rider not found.");

  const approved =
    rider.verification_status === "approved" ||
    rider.verification_status === "verified" ||
    rider.is_approved === true;

  if (!approved) {
    throw new Error("Rider verification approval is required before requesting a ride.");
  }

  return rider;
}

async function ensurePaymentAuthorized(riderId) {
  const { data, error } = await supabase
    .from("payments")
    .select("*")
    .eq("rider_id", riderId)
    .eq("status", "authorized")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!data) {
    throw new Error("Payment authorization is required before dispatch.");
  }

  return data;
} /* =========================================================
   DRIVER EMAIL + SMS VERIFICATION
========================================================= */
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
  const appBase = publicBaseUrl();
  const token =
    driver.email_verification_token || crypto.randomBytes(24).toString("hex");

  const verificationLink = `${appBase}/api/driver/verify-email?token=${encodeURIComponent(
    token
  )}`;

  if (driver.email_verification_token !== token) {
    await supabase
      .from("drivers")
      .update({
        email_verification_token: token,
        email_verification_sent_at: nowIso(),
        updated_at: nowIso()
      })
      .eq("id", driver.id);
  }

  if (!SENDGRID_API_KEY || !SUPPORT_FROM_EMAIL) {
    console.log("📧 Email provider not configured. Verification link:", verificationLink);
    return {
      sent: false,
      provider: "console",
      verification_link: verificationLink
    };
  }

  try {
    const sgMail = require("@sendgrid/mail");
    sgMail.setApiKey(SENDGRID_API_KEY);

    await sgMail.send({
      to: driver.email,
      from: SUPPORT_FROM_EMAIL,
      subject: "Verify your Harvey Taxi driver email",
      text: [
        `Hello ${driver.first_name || "Driver"},`,
        "",
        "Please verify your email for Harvey Taxi driver onboarding.",
        "",
        `Verification link: ${verificationLink}`,
        "",
        "If you did not request this, you can ignore this message."
      ].join("\n"),
      html: `
        <div style="font-family:Arial,sans-serif;line-height:1.6;color:#111">
          <h2>Harvey Taxi Driver Email Verification</h2>
          <p>Hello ${driver.first_name || "Driver"},</p>
          <p>Please verify your email for Harvey Taxi driver onboarding.</p>
          <p>
            <a href="${verificationLink}" style="display:inline-block;padding:12px 18px;background:#0f62fe;color:#fff;text-decoration:none;border-radius:8px;">
              Verify Email
            </a>
          </p>
          <p>If the button does not work, use this link:</p>
          <p>${verificationLink}</p>
          <p>If you did not request this, you can ignore this message.</p>
        </div>
      `
    });

    return {
      sent: true,
      provider: "sendgrid",
      verification_link: verificationLink
    };
  } catch (error) {
    console.error("❌ sendDriverVerificationEmail error:", error.message);
    return {
      sent: false,
      provider: "sendgrid_error",
      verification_link: verificationLink,
      error: error.message
    };
  }
}

async function sendDriverVerificationSms(driver) {
  const code = randomCode(6);
  const expiresAt = futureIsoMinutes(15);

  const { error: updateError } = await supabase
    .from("drivers")
    .update({
      sms_verification_code: code,
      sms_verification_expires_at: expiresAt,
      sms_verification_sent_at: nowIso(),
      updated_at: nowIso()
    })
    .eq("id", driver.id);

  if (updateError) throw updateError;

  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_PHONE_NUMBER) {
    console.log(`📱 SMS provider not configured. ${driver.phone}: code ${code}`);
    return {
      sent: false,
      provider: "console",
      code
    };
  }

  try {
    const twilio = require("twilio")(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

    await twilio.messages.create({
      from: TWILIO_PHONE_NUMBER,
      to: driver.phone,
      body: `Harvey Taxi driver verification code: ${code}. It expires in 15 minutes.`
    });

    return {
      sent: true,
      provider: "twilio"
    };
  } catch (error) {
    console.error("❌ sendDriverVerificationSms error:", error.message);
    return {
      sent: false,
      provider: "twilio_error",
      error: error.message
    };
  }
}

async function createDriverRecord(payload) {
  const driverId = makeId("drv");

  const row = {
    id: driverId,
    first_name: sanitizeText(payload.first_name),
    last_name: sanitizeText(payload.last_name),
    email: normalizeEmail(payload.email),
    phone: normalizePhone(payload.phone),
    password: sanitizeText(payload.password),
    city: sanitizeText(payload.city),
    state: sanitizeText(payload.state),
    vehicle_make: sanitizeText(payload.vehicle_make),
    vehicle_model: sanitizeText(payload.vehicle_model),
    vehicle_year: sanitizeText(payload.vehicle_year),
    license_number: sanitizeText(payload.license_number),
    plate_number: sanitizeText(payload.plate_number),
    driver_type: payload.driver_type === "autonomous" ? "autonomous" : "human",
    onboarding_stage: "submitted",
    verification_status: "pending",
    email_verified: false,
    sms_verified: false,
    is_approved: false,
    is_available: false,
    created_at: nowIso(),
    updated_at: nowIso()
  };

  const { data, error } = await supabase
    .from("drivers")
    .insert(row)
    .select()
    .single();

  if (error) throw error;
  return data;
}

/* =========================================================
   PAYMENT + FARE + RIDE CREATION
========================================================= */
async function createPaymentAuthorization({
  riderId,
  amount,
  currency = DEFAULT_CURRENCY,
  method = "card",
  notes = ""
}) {
  const row = {
    id: makeId("pay"),
    rider_id: riderId,
    amount: roundMoney(amount),
    currency,
    payment_method: method,
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
  return data;
}

async function buildFareEstimate({ pickup_address, dropoff_address, ride_type }) {
  const distanceMiles = estimateDistanceMiles(pickup_address, dropoff_address);
  const durationMinutes = estimateDurationMinutes(distanceMiles);

  const rideTypeMultiplier =
    ride_type === "airport"
      ? 1.2
      : ride_type === "medical"
      ? 1.05
      : ride_type === "scheduled"
      ? 1.1
      : ride_type === "nonprofit"
      ? 0.9
      : 1;

  const surgeMultiplier = 1;
  const fare = calculateFare({
    distanceMiles,
    durationMinutes,
    surgeMultiplier: surgeMultiplier * rideTypeMultiplier
  });

  return {
    pickup_address,
    dropoff_address,
    distance_miles: distanceMiles,
    estimated_duration_minutes: durationMinutes,
    ride_type: ride_type || "standard",
    ...fare
  };
}

async function createRide({
  rider,
  payment,
  pickup_address,
  dropoff_address,
  notes,
  requested_mode,
  ride_type,
  scheduled_for,
  fareEstimate
}) {
  const rideId = makeId("ride");

  const row = {
    id: rideId,
    rider_id: rider.id,
    rider_name: [rider.first_name, rider.last_name].filter(Boolean).join(" ").trim(),
    pickup_address: sanitizeText(pickup_address),
    dropoff_address: sanitizeText(dropoff_address),
    notes: sanitizeText(notes),
    requested_mode: requested_mode || "driver",
    ride_type: ride_type || "standard",
    scheduled_for: scheduled_for || null,
    payment_id: payment.id,
    status: "requested",
    estimated_fare: fareEstimate.estimated_total,
    estimated_distance_miles: fareEstimate.distance_miles,
    estimated_duration_minutes: fareEstimate.estimated_duration_minutes,
    created_at: nowIso(),
    updated_at: nowIso()
  };

  const { data, error } = await supabase
    .from("rides")
    .insert(row)
    .select()
    .single();

  if (error) throw error;
  return data;
}

async function createDispatchOffer(ride, driver, attemptNumber = 1) {
  const expiresAt = new Date(Date.now() + DISPATCH_OFFER_TIMEOUT_MS).toISOString();
  const payout = driverPayoutFromFare(ride.estimated_fare || 0);

  const row = {
    id: makeId("dsp"),
    ride_id: ride.id,
    driver_id: driver.id,
    attempt_number: attemptNumber,
    status: "offered",
    expires_at: expiresAt,
    payout_estimate: payout,
    mission_snapshot: {
      ride_id: ride.id,
      requested_mode: ride.requested_mode,
      ride_type: ride.ride_type,
      pickup_address: ride.pickup_address,
      dropoff_address: ride.dropoff_address,
      notes: ride.notes,
      estimated_fare: ride.estimated_fare,
      estimated_distance_miles: ride.estimated_distance_miles,
      estimated_duration_minutes: ride.estimated_duration_minutes,
      payout_estimate: payout
    },
    created_at: nowIso(),
    updated_at: nowIso()
  };

  const { data, error } = await supabase
    .from("dispatches")
    .insert(row)
    .select()
    .single();

  if (error) throw error;

  await supabase
    .from("rides")
    .update({
      status: "dispatching",
      updated_at: nowIso()
    })
    .eq("id", ride.id);

  await createEventLog("dispatch.offered", {
    ride_id: ride.id,
    driver_id: driver.id,
    dispatch_id: data.id
  });

  return data;
}

async function findNextDriverAndDispatch(rideId, attemptNumber = 1) {
  const ride = await getRideById(rideId);
  if (!ride) throw new Error("Ride not found.");

  const openDispatch = await getActiveDispatchForRide(ride.id);
  if (openDispatch) return openDispatch;

  if (attemptNumber > MAX_DISPATCH_ATTEMPTS) {
    await supabase
      .from("rides")
      .update({
        status: "unassigned",
        updated_at: nowIso()
      })
      .eq("id", ride.id);

    await createEventLog("dispatch.exhausted", { ride_id: ride.id });
    return null;
  }

  const drivers = await getAvailableDrivers(ride.requested_mode || "driver");
  if (!drivers.length) {
    await supabase
      .from("rides")
      .update({
        status: "unassigned",
        updated_at: nowIso()
      })
      .eq("id", ride.id);

    await createEventLog("dispatch.no_drivers", { ride_id: ride.id });
    return null;
  }

  const { data: priorDispatches } = await supabase
    .from("dispatches")
    .select("driver_id")
    .eq("ride_id", ride.id);

  const usedDriverIds = new Set((priorDispatches || []).map((x) => x.driver_id));
  const nextDriver = drivers.find((driver) => !usedDriverIds.has(driver.id)) || drivers[0];

  return createDispatchOffer(ride, nextDriver, attemptNumber);
} /* =========================================================
   DRIVER VERIFY ROUTES
========================================================= */
app.get("/api/driver/verify-email", async (req, res) => {
  try {
    const { token } = req.query;
    if (!token) {
      return res.status(400).send("Missing verification token.");
    }

    const { data: driver, error } = await supabase
      .from("drivers")
      .select("*")
      .eq("email_verification_token", token)
      .single();

    if (error || !driver) {
      return res.status(400).send("Invalid or expired verification token.");
    }

    await supabase
      .from("drivers")
      .update({
        email_verified: true,
        email_verification_token: null,
        updated_at: nowIso()
      })
      .eq("id", driver.id);

    await updateDriverVerificationStatus(driver.id);

    return res.send(`
      <h2>Email Verified</h2>
      <p>Your Harvey Taxi driver email has been verified.</p>
      <p>You may return to the app.</p>
    `);
  } catch (err) {
    console.error(err);
    res.status(500).send("Verification failed.");
  }
});

app.post("/api/driver/verify-sms", async (req, res) => {
  try {
    const { driver_id, code } = req.body;

    if (!driver_id || !code) {
      return res.status(400).json({
        error: "driver_id and code required"
      });
    }

    const driver = await getDriverById(driver_id);
    if (!driver) {
      return res.status(404).json({ error: "Driver not found" });
    }

    if (!driver.sms_verification_code) {
      return res.status(400).json({
        error: "No SMS verification pending"
      });
    }

    if (driver.sms_verification_code !== code) {
      return res.status(400).json({
        error: "Invalid verification code"
      });
    }

    if (
      driver.sms_verification_expires_at &&
      new Date(driver.sms_verification_expires_at) < new Date()
    ) {
      return res.status(400).json({
        error: "Verification code expired"
      });
    }

    await supabase
      .from("drivers")
      .update({
        sms_verified: true,
        sms_verification_code: null,
        updated_at: nowIso()
      })
      .eq("id", driver.id);

    const updated = await updateDriverVerificationStatus(driver.id);

    res.json({
      success: true,
      verification_status: updated.verification_status
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "SMS verification failed" });
  }
});

/* =========================================================
   DRIVER SIGNUP
========================================================= */
app.post("/api/driver/signup", async (req, res) => {
  try {
    const required = requireFields(req.body, [
      "first_name",
      "last_name",
      "email",
      "phone"
    ]);

    if (required) {
      return res.status(400).json({ error: required });
    }

    const driver = await createDriverRecord(req.body);

    await sendDriverVerificationEmail(driver);
    await sendDriverVerificationSms(driver);

    await createEventLog("driver.signup", {
      driver_id: driver.id
    });

    res.json({
      success: true,
      driver_id: driver.id,
      verification_status: driver.verification_status,
      message: "Driver created. Email + SMS verification required."
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: "Driver signup failed",
      message: err.message
    });
  }
});

/* =========================================================
   DRIVER AVAILABILITY
========================================================= */
app.post("/api/driver/:driverId/availability", async (req, res) => {
  try {
    const { driverId } = req.params;
    const { is_available } = req.body;

    const driver = await markDriverAvailability(driverId, is_available);

    res.json({
      success: true,
      driver
    });
  } catch (err) {
    res.status(500).json({
      error: "Failed to update availability"
    });
  }
});

/* =========================================================
   DRIVER ACCEPT RIDE
========================================================= */
app.post("/api/driver/accept", async (req, res) => {
  try {
    const { dispatch_id, driver_id } = req.body;

    const { data: dispatch } = await supabase
      .from("dispatches")
      .select("*")
      .eq("id", dispatch_id)
      .single();

    if (!dispatch) {
      return res.status(404).json({
        error: "Dispatch not found"
      });
    }

    if (dispatch.driver_id !== driver_id) {
      return res.status(403).json({
        error: "Not authorized"
      });
    }

    await supabase
      .from("dispatches")
      .update({
        status: "accepted",
        updated_at: nowIso()
      })
      .eq("id", dispatch.id);

    await supabase
      .from("rides")
      .update({
        status: "driver_assigned",
        driver_id: driver_id,
        updated_at: nowIso()
      })
      .eq("id", dispatch.ride_id);

    await markDriverAvailability(driver_id, false);

    await createEventLog("driver.accepted", {
      dispatch_id: dispatch.id
    });

    res.json({
      success: true
    });
  } catch (err) {
    res.status(500).json({
      error: "Accept failed"
    });
  }
});

/* =========================================================
   DRIVER DECLINE
========================================================= */
app.post("/api/driver/decline", async (req, res) => {
  try {
    const { dispatch_id } = req.body;

    const { data: dispatch } = await supabase
      .from("dispatches")
      .select("*")
      .eq("id", dispatch_id)
      .single();

    if (!dispatch) {
      return res.status(404).json({
        error: "Dispatch not found"
      });
    }

    await supabase
      .from("dispatches")
      .update({
        status: "declined",
        updated_at: nowIso()
      })
      .eq("id", dispatch.id);

    await findNextDriverAndDispatch(
      dispatch.ride_id,
      dispatch.attempt_number + 1
    );

    res.json({
      success: true
    });
  } catch (err) {
    res.status(500).json({
      error: "Decline failed"
    });
  }
}); /* =========================================================
   FARE ESTIMATE
========================================================= */
app.post("/api/fare-estimate", async (req, res) => {
  try {
    const { pickup_address, dropoff_address, ride_type } = req.body;

    if (!pickup_address || !dropoff_address) {
      return res.status(400).json({
        error: "pickup_address and dropoff_address required"
      });
    }

    const estimate = await buildFareEstimate({
      pickup_address,
      dropoff_address,
      ride_type
    });

    res.json(estimate);
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: "Fare estimate failed"
    });
  }
});

/* =========================================================
   PAYMENT AUTHORIZE
========================================================= */
app.post("/api/payments/authorize", async (req, res) => {
  try {
    const { rider_id, amount } = req.body;

    if (!rider_id || !amount) {
      return res.status(400).json({
        error: "rider_id and amount required"
      });
    }

    const payment = await createPaymentAuthorization({
      riderId: rider_id,
      amount
    });

    res.json({
      success: true,
      payment
    });
  } catch (err) {
    res.status(500).json({
      error: "Payment authorization failed"
    });
  }
});

/* =========================================================
   REQUEST RIDE
========================================================= */
app.post("/api/request-ride", async (req, res) => {
  try {
    const {
      rider_id,
      pickup_address,
      dropoff_address,
      notes,
      requested_mode,
      ride_type,
      scheduled_for
    } = req.body;

    if (!rider_id || !pickup_address || !dropoff_address) {
      return res.status(400).json({
        error: "Missing required ride fields"
      });
    }

    const rider = await ensureRiderApproved(rider_id);
    await ensureNoOpenRideForRider(rider_id);
    const payment = await ensurePaymentAuthorized(rider_id);

    const fareEstimate = await buildFareEstimate({
      pickup_address,
      dropoff_address,
      ride_type
    });

    const ride = await createRide({
      rider,
      payment,
      pickup_address,
      dropoff_address,
      notes,
      requested_mode,
      ride_type,
      scheduled_for,
      fareEstimate
    });

    await createEventLog("ride.requested", {
      ride_id: ride.id
    });

    await findNextDriverAndDispatch(ride.id, 1);

    res.json({
      success: true,
      ride_id: ride.id,
      fare: fareEstimate
    });
  } catch (err) {
    console.error(err);

    res.status(400).json({
      error: err.message || "Ride request failed"
    });
  }
});

/* =========================================================
   DRIVER MISSIONS
========================================================= */
app.get("/api/driver/:driverId/missions", async (req, res) => {
  try {
    const { driverId } = req.params;

    const { data, error } = await supabase
      .from("dispatches")
      .select("*")
      .eq("driver_id", driverId)
      .in("status", ["offered", "accepted"])
      .order("created_at", { ascending: false });

    if (error) throw error;

    res.json(data || []);
  } catch (err) {
    res.status(500).json({
      error: "Failed to load missions"
    });
  }
});

/* =========================================================
   RIDER ACTIVE TRIP
========================================================= */
app.get("/api/rider/:riderId/active", async (req, res) => {
  try {
    const { riderId } = req.params;

    const { data } = await supabase
      .from("rides")
      .select("*")
      .eq("rider_id", riderId)
      .in("status", [
        "requested",
        "dispatching",
        "driver_assigned",
        "en_route",
        "arrived",
        "in_progress"
      ])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    res.json(data || null);
  } catch (err) {
    res.status(500).json({
      error: "Failed to load active ride"
    });
  }
});

/* =========================================================
   TRIP STATUS UPDATE
========================================================= */
app.post("/api/trip/status", async (req, res) => {
  try {
    const { ride_id, status } = req.body;

    await supabase
      .from("rides")
      .update({
        status,
        updated_at: nowIso()
      })
      .eq("id", ride_id);

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({
      error: "Status update failed"
    });
  }
});

/* =========================================================
   ADMIN LOGIN
========================================================= */
app.post("/api/admin/login", (req, res) => {
  const { email, password } = req.body;

  if (email === ADMIN_EMAIL && password === ADMIN_PASSWORD) {
    return res.json({
      success: true
    });
  }

  res.status(401).json({
    error: "Invalid credentials"
  });
});

/* =========================================================
   HEALTH CHECK
========================================================= */
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    service: "Harvey Taxi API",
    time: nowIso()
  });
});

/* =========================================================
   ROOT
========================================================= */
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public/index.html"));
});

/* =========================================================
   START SERVER
========================================================= */
app.listen(PORT, () => {
  console.log("=================================");
  console.log("Harvey Taxi API running");
  console.log("Port:", PORT);
  console.log("=================================");
});

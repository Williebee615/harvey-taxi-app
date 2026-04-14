/* =========================================================
   HARVEY TAXI — CODE BLUE FINAL BUILD
   PART 1: FOUNDATION + ENV + CLIENTS + CORE HELPERS
========================================================= */

const express = require("express");
const cors = require("cors");
const path = require("path");
const crypto = require("crypto");
const twilio = require("twilio");
const { createClient } = require("@supabase/supabase-js");

/* OPTIONAL AI */
let OpenAI = null;
try { OpenAI = require("openai"); } catch (e) {}

/* APP */
const app = express();
const PORT = Number(process.env.PORT || 10000);
const STARTED = new Date().toISOString();

/* MIDDLEWARE */
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

/* HELPERS */
const clean = (v="") => String(v||"").trim();
const lower = (v="") => clean(v).toLowerCase();
const now = () => new Date().toISOString();
const id = (p="id") => `${p}_${crypto.randomBytes(6).toString("hex")}`;
const round = (n)=> Math.round(n*100)/100;

/* PHONE */
function phone(p=""){
  const d = clean(p).replace(/\D/g,"");
  if (d.length===10) return "+1"+d;
  if (d.length===11 && d.startsWith("1")) return "+"+d;
  return clean(p);
}

/* ENV */
const SUPABASE_URL = clean(process.env.SUPABASE_URL);
const SUPABASE_KEY = clean(process.env.SUPABASE_SERVICE_ROLE_KEY);

const TWILIO_SID = clean(process.env.TWILIO_ACCOUNT_SID);
const TWILIO_TOKEN = clean(process.env.TWILIO_AUTH_TOKEN);
const TWILIO_VERIFY = clean(process.env.TWILIO_VERIFY_SERVICE_SID);

const OPENAI_KEY = clean(process.env.OPENAI_API_KEY);

/* CLIENTS */
const supabase = SUPABASE_URL && SUPABASE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_KEY)
  : null;

const twilioClient = TWILIO_SID && TWILIO_TOKEN
  ? twilio(TWILIO_SID, TWILIO_TOKEN)
  : null;

const openai = OpenAI && OPENAI_KEY
  ? new OpenAI({ apiKey: OPENAI_KEY })
  : null;

/* RESPONSES */
const ok = (res,data={})=>res.json({ok:true,...data});
const fail = (res,msg="error",code=400)=>res.status(code).json({ok:false,error:msg});

/* HEALTH */
app.get("/api/health",(req,res)=>{
  ok(res,{
    started: STARTED,
    supabase: !!supabase,
    twilio: !!twilioClient,
    verify: !!TWILIO_VERIFY,
    openai: !!openai
  });
});/* =========================================================
   HARVEY TAXI — CODE BLUE FINAL BUILD
   PART 2: VERIFY + ACCESS + MISSION-AWARE AI FOUNDATION
========================================================= */

/* CONFIG */
const ADMIN_EMAIL = clean(process.env.ADMIN_EMAIL || "williebee@harveytaxiservice.com");
const ADMIN_PASSWORD = clean(process.env.ADMIN_PASSWORD);

const ENABLE_AI_BRAIN =
  ["1", "true", "yes", "on"].includes(lower(process.env.ENABLE_AI_BRAIN || "true"));

const ENABLE_RIDER_VERIFICATION_GATE =
  ["1", "true", "yes", "on"].includes(
    lower(process.env.ENABLE_RIDER_VERIFICATION_GATE || "true")
  );

const ENABLE_DRIVER_PHONE_VERIFICATION =
  ["1", "true", "yes", "on"].includes(
    lower(process.env.ENABLE_DRIVER_PHONE_VERIFICATION || "true")
  );

const ENABLE_PAYMENT_GATE =
  ["1", "true", "yes", "on"].includes(
    lower(process.env.ENABLE_PAYMENT_GATE || "true")
  );

const OPENAI_SUPPORT_MODEL = clean(
  process.env.OPENAI_SUPPORT_MODEL || "gpt-4.1-mini"
);

/* ADMIN */
function isAdmin(req) {
  const email = lower(
    req.headers["x-admin-email"] ||
    req.body?.admin_email ||
    req.query?.admin_email ||
    ""
  );
  const password = clean(
    req.headers["x-admin-password"] ||
    req.body?.admin_password ||
    req.query?.admin_password ||
    ""
  );

  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) return false;
  return email === lower(ADMIN_EMAIL) && password === ADMIN_PASSWORD;
}

function requireAdmin(req, res, next) {
  if (!isAdmin(req)) return fail(res, "Unauthorized", 401);
  next();
}

/* LOOKUPS */
async function getRiderById(riderId) {
  if (!supabase || !clean(riderId)) return null;

  const { data, error } = await supabase
    .from("riders")
    .select("*")
    .eq("id", clean(riderId))
    .maybeSingle();

  if (error) return null;
  return data || null;
}

async function getDriverById(driverId) {
  if (!supabase || !clean(driverId)) return null;

  const { data, error } = await supabase
    .from("drivers")
    .select("*")
    .eq("id", clean(driverId))
    .maybeSingle();

  if (error) return null;
  return data || null;
}

async function getRideById(rideId) {
  if (!supabase || !clean(rideId)) return null;

  const { data, error } = await supabase
    .from("rides")
    .select("*")
    .eq("id", clean(rideId))
    .maybeSingle();

  if (error) return null;
  return data || null;
}

async function getMissionByRideId(rideId) {
  if (!supabase || !clean(rideId)) return null;

  const { data, error } = await supabase
    .from("missions")
    .select("*")
    .eq("ride_id", clean(rideId))
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return null;
  return data || null;
}

async function getLatestDispatchByRideId(rideId) {
  if (!supabase || !clean(rideId)) return null;

  const { data, error } = await supabase
    .from("dispatches")
    .select("*")
    .eq("ride_id", clean(rideId))
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return null;
  return data || null;
}

async function getRecentDispatchesByRideId(rideId, limit = 5) {
  if (!supabase || !clean(rideId)) return [];

  const { data, error } = await supabase
    .from("dispatches")
    .select("*")
    .eq("ride_id", clean(rideId))
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error || !Array.isArray(data)) return [];
  return data;
}

async function getRecentTripEventsByRideId(rideId, limit = 8) {
  if (!supabase || !clean(rideId)) return [];

  let { data, error } = await supabase
    .from("trip_events")
    .select("*")
    .eq("ride_id", clean(rideId))
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    const fallback = await supabase
      .from("trip_timelines")
      .select("*")
      .eq("ride_id", clean(rideId))
      .order("created_at", { ascending: false })
      .limit(limit);

    data = fallback.data || [];
    error = fallback.error || null;
  }

  if (error || !Array.isArray(data)) return [];
  return data;
}

async function getLatestPaymentForRider(riderId) {
  if (!supabase || !clean(riderId)) return null;

  const { data, error } = await supabase
    .from("payments")
    .select("*")
    .eq("rider_id", clean(riderId))
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return null;
  return data || null;
}

async function getLatestPaymentForRide(rideId) {
  if (!supabase || !clean(rideId)) return null;

  const { data, error } = await supabase
    .from("payments")
    .select("*")
    .eq("ride_id", clean(rideId))
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return null;
  return data || null;
}

/* STATUS HELPERS */
function isTruthyStatus(value) {
  return [
    "approved",
    "verified",
    "active",
    "clear",
    "completed",
    "authorized",
    "held",
    "preauthorized",
    "accepted",
    "true",
    "yes"
  ].includes(lower(value));
}

function isRiderApproved(rider) {
  if (!rider) return false;
  return !!(
    rider.is_approved === true ||
    rider.approved === true ||
    isTruthyStatus(rider.status) ||
    isTruthyStatus(rider.access_status) ||
    isTruthyStatus(rider.approval_status) ||
    isTruthyStatus(rider.verification_status)
  );
}

function isDriverApproved(driver) {
  if (!driver) return false;
  return !!(
    driver.is_approved === true ||
    driver.approved === true ||
    isTruthyStatus(driver.status) ||
    isTruthyStatus(driver.access_status) ||
    isTruthyStatus(driver.approval_status) ||
    isTruthyStatus(driver.background_status)
  );
}

function riderPhoneVerified(rider) {
  if (!rider) return false;
  return !!(
    rider.phone_verified === true ||
    rider.sms_verified === true ||
    rider.mobile_verified === true
  );
}

function driverPhoneVerified(driver) {
  if (!driver) return false;
  return !!(
    driver.phone_verified === true ||
    driver.sms_verified === true ||
    driver.mobile_verified === true
  );
}

function isPaymentAuthorized(payment) {
  if (!payment) return false;
  return !!(
    payment.payment_authorized === true ||
    payment.is_authorized === true ||
    isTruthyStatus(payment.payment_status) ||
    isTruthyStatus(payment.authorization_status) ||
    isTruthyStatus(payment.status)
  );
}

/* ACCESS HELPERS */
async function ensureRiderCanRequestRide({ riderId, rideId = "" }) {
  const rider = await getRiderById(riderId);
  if (!rider) {
    return { ok: false, status: 404, error: "Rider not found" };
  }

  if (ENABLE_RIDER_VERIFICATION_GATE && !isRiderApproved(rider)) {
    return {
      ok: false,
      status: 403,
      error: "Rider approval is required before requesting a ride"
    };
  }

  if (ENABLE_DRIVER_PHONE_VERIFICATION && !riderPhoneVerified(rider)) {
    return {
      ok: false,
      status: 403,
      error: "Phone verification is required before requesting a ride"
    };
  }

  if (ENABLE_PAYMENT_GATE) {
    const payment =
      (rideId ? await getLatestPaymentForRide(rideId) : null) ||
      (await getLatestPaymentForRider(rider.id));

    if (!isPaymentAuthorized(payment)) {
      return {
        ok: false,
        status: 403,
        error: "Payment authorization is required before dispatch"
      };
    }
  }

  return { ok: true, rider };
}

async function ensureDriverCanGoActive({ driverId }) {
  const driver = await getDriverById(driverId);
  if (!driver) {
    return { ok: false, status: 404, error: "Driver not found" };
  }

  if (!driverPhoneVerified(driver)) {
    return {
      ok: false,
      status: 403,
      error: "Driver phone verification is required before going active"
    };
  }

  if (!isDriverApproved(driver)) {
    return {
      ok: false,
      status: 403,
      error: "Driver approval is required before going active"
    };
  }

  return { ok: true, driver };
}

/* TWILIO VERIFY */
function twilioReady() {
  return !!(twilioClient && TWILIO_VERIFY);
}

async function sendVerificationCode(phoneNumber) {
  if (!twilioReady()) throw new Error("Twilio Verify is not configured");

  const to = phone(phoneNumber);
  if (!to) throw new Error("Valid phone number required");

  return twilioClient.verify.v2
    .services(TWILIO_VERIFY)
    .verifications.create({
      to,
      channel: "sms"
    });
}

async function checkVerificationCode(phoneNumber, code) {
  if (!twilioReady()) throw new Error("Twilio Verify is not configured");

  const to = phone(phoneNumber);
  const pin = clean(code);

  if (!to || !pin) throw new Error("Phone number and code are required");

  return twilioClient.verify.v2
    .services(TWILIO_VERIFY)
    .verificationChecks.create({
      to,
      code: pin
    });
}

async function markRiderPhoneVerified({ riderId, phoneNumber }) {
  if (!supabase || !clean(riderId)) return null;

  const { data, error } = await supabase
    .from("riders")
    .update({
      phone: phone(phoneNumber),
      phone_verified: true,
      sms_verified: true,
      updated_at: now()
    })
    .eq("id", clean(riderId))
    .select("*")
    .maybeSingle();

  if (error) return null;
  return data || null;
}

async function markDriverPhoneVerified({ driverId, phoneNumber }) {
  if (!supabase || !clean(driverId)) return null;

  const { data, error } = await supabase
    .from("drivers")
    .update({
      phone: phone(phoneNumber),
      phone_verified: true,
      sms_verified: true,
      updated_at: now()
    })
    .eq("id", clean(driverId))
    .select("*")
    .maybeSingle();

  if (error) return null;
  return data || null;
}

/* AI */
function normalizePage(page = "") {
  const value = lower(page);
  if (!value) return "general";
  if (["home", "index", "landing"].includes(value)) return "general";
  if (["rider", "rider-signup", "rider-dashboard"].includes(value)) return "rider";
  if (["driver", "driver-signup", "driver-dashboard"].includes(value)) return "driver";
  if (["request", "request-ride", "ride"].includes(value)) return "request";
  if (["support", "help", "faq"].includes(value)) return "support";
  if (["mission", "dispatch", "ops"].includes(value)) return value;
  return value;
}

function summarizeMissionState({ ride, mission, dispatches, events }) {
  if (!ride) return "No ride was found for this request.";

  const latestDispatch = Array.isArray(dispatches) && dispatches.length
    ? dispatches[0]
    : null;

  const latestEvent = Array.isArray(events) && events.length
    ? events[0]
    : null;

  return {
    ride_status: ride.status || "unknown",
    mission_status: mission?.status || "not_found",
    latest_dispatch_status: latestDispatch?.status || "not_found",
    latest_dispatch_driver_id: latestDispatch?.driver_id || null,
    recent_event_type: latestEvent?.event_type || "not_found"
  };
}

function getFallbackReply(message = "", page = "general", context = {}) {
  const text = lower(message);
  const safePage = normalizePage(page);

  if (text.includes("emergency") || text.includes("911")) {
    return "Harvey Taxi is not an emergency service. If you are in danger or need urgent help, call 911 immediately.";
  }

  if (text.includes("mission") || text.includes("dispatch") || text.includes("driver accepted")) {
    const summary = summarizeMissionState(context);
    if (summary.ride_status && typeof summary === "object") {
      return `Your current ride status is ${summary.ride_status}. Mission status is ${summary.mission_status}. Latest dispatch status is ${summary.latest_dispatch_status}.`;
    }
  }

  if (text.includes("ride") || text.includes("book")) {
    return "You can request a ride after your rider account is approved, phone verification is complete, and payment is authorized.";
  }

  if (text.includes("driver")) {
    return "To become a Harvey Taxi driver, complete signup, upload documents, verify your phone, and wait for approval before going active.";
  }

  if (text.includes("payment") || text.includes("card")) {
    return "Harvey Taxi uses payment authorization before dispatch to support a smoother and safer ride flow.";
  }

  if (text.includes("autonomous") || text.includes("pilot")) {
    return "Autonomous service is currently in pilot mode and is clearly labeled when available.";
  }

  if (safePage === "rider") {
    return "I can help with rider signup, rider approval, phone verification, payment authorization, ride requests, and mission status.";
  }

  if (safePage === "driver") {
    return "I can help with driver signup, document requirements, phone verification, approval, mission offers, and trip status.";
  }

  if (safePage === "request" || safePage === "mission" || safePage === "dispatch") {
    return "I can help with fare estimates, payment authorization, ride requests, mission status, dispatch progress, and trip updates.";
  }

  return "I can help with rides, driver signup, rider verification, payments, missions, dispatch questions, and Harvey Taxi support.";
}

/* VERIFY ROUTES */
app.post("/api/verify/send-code", async (req, res) => {
  try {
    const phoneNumber = phone(req.body?.phone);
    const userType = lower(req.body?.userType || req.body?.user_type);
    const riderId = clean(req.body?.rider_id);
    const driverId = clean(req.body?.driver_id);

    if (!phoneNumber) return fail(res, "Phone number is required", 400);

    if (userType === "rider" && riderId) {
      const rider = await getRiderById(riderId);
      if (!rider) return fail(res, "Rider not found", 404);
    }

    if (userType === "driver" && driverId) {
      const driver = await getDriverById(driverId);
      if (!driver) return fail(res, "Driver not found", 404);
    }

    const verification = await sendVerificationCode(phoneNumber);

    return ok(res, {
      message: "Verification code sent",
      status: verification.status,
      to: phoneNumber,
      channel: "sms"
    });
  } catch (error) {
    console.error("/api/verify/send-code error:", error.message);
    return fail(res, error.message || "Failed to send verification code", 500);
  }
});

app.post("/api/verify/check-code", async (req, res) => {
  try {
    const phoneNumber = phone(req.body?.phone);
    const code = clean(req.body?.code);
    const userType = lower(req.body?.userType || req.body?.user_type);
    const riderId = clean(req.body?.rider_id);
    const driverId = clean(req.body?.driver_id);

    if (!phoneNumber || !code) {
      return fail(res, "Phone number and code are required", 400);
    }

    const result = await checkVerificationCode(phoneNumber, code);
    const approved = lower(result?.status) === "approved";

    let record = null;

    if (approved && userType === "rider" && riderId) {
      record = await markRiderPhoneVerified({
        riderId,
        phoneNumber
      });
    }

    if (approved && userType === "driver" && driverId) {
      record = await markDriverPhoneVerified({
        driverId,
        phoneNumber
      });
    }

    return ok(res, {
      approved,
      status: result?.status || "pending",
      to: phoneNumber,
      user_type: userType,
      record: record
        ? {
            id: record.id,
            phone_verified: !!record.phone_verified,
            updated_at: record.updated_at || null
          }
        : null
    });
  } catch (error) {
    console.error("/api/verify/check-code error:", error.message);
    return fail(res, error.message || "Failed to verify code", 500);
  }
});

/* STATUS ROUTES */
app.get("/api/rider/status/:riderId", async (req, res) => {
  try {
    const riderId = clean(req.params.riderId);
    const rider = await getRiderById(riderId);
    if (!rider) return fail(res, "Rider not found", 404);

    const latestPayment = await getLatestPaymentForRider(riderId);

    return ok(res, {
      rider_id: rider.id,
      email: rider.email || null,
      phone: rider.phone || null,
      rider_approved: isRiderApproved(rider),
      phone_verified: riderPhoneVerified(rider),
      payment_authorized: isPaymentAuthorized(latestPayment),
      access_granted:
        isRiderApproved(rider) &&
        riderPhoneVerified(rider) &&
        (!ENABLE_PAYMENT_GATE || isPaymentAuthorized(latestPayment))
    });
  } catch (error) {
    console.error("/api/rider/status/:riderId error:", error.message);
    return fail(res, "Failed to fetch rider status", 500);
  }
});

app.get("/api/driver/status/:driverId", async (req, res) => {
  try {
    const driverId = clean(req.params.driverId);
    const driver = await getDriverById(driverId);
    if (!driver) return fail(res, "Driver not found", 404);

    return ok(res, {
      driver_id: driver.id,
      email: driver.email || null,
      phone: driver.phone || null,
      phone_verified: driverPhoneVerified(driver),
      driver_approved: isDriverApproved(driver),
      can_go_active: driverPhoneVerified(driver) && isDriverApproved(driver)
    });
  } catch (error) {
    console.error("/api/driver/status/:driverId error:", error.message);
    return fail(res, "Failed to fetch driver status", 500);
  }
});

/* MISSION-AWARE AI SUPPORT */
app.post("/api/ai/support", async (req, res) => {
  try {
    const message = clean(req.body?.message);
    const page = normalizePage(req.body?.page || req.body?.context);
    const riderId = clean(req.body?.rider_id);
    const driverId = clean(req.body?.driver_id);
    const rideId = clean(req.body?.ride_id);

    if (!message) return fail(res, "Message is required", 400);

    const rider = riderId ? await getRiderById(riderId) : null;
    const driver = driverId ? await getDriverById(driverId) : null;
    const ride = rideId ? await getRideById(rideId) : null;
    const mission = ride ? await getMissionByRideId(ride.id) : null;
    const dispatches = ride ? await getRecentDispatchesByRideId(ride.id, 5) : [];
    const events = ride ? await getRecentTripEventsByRideId(ride.id, 8) : [];
    const latestPayment = ride
      ? await getLatestPaymentForRide(ride.id)
      : rider
        ? await getLatestPaymentForRider(rider.id)
        : null;

    const missionContext = {
      rider,
      driver,
      ride,
      mission,
      dispatches,
      events,
      eligibility: {
        rider_approved: isRiderApproved(rider),
        rider_phone_verified: riderPhoneVerified(rider),
        driver_approved: isDriverApproved(driver),
        driver_phone_verified: driverPhoneVerified(driver),
        payment_authorized: isPaymentAuthorized(latestPayment)
      }
    };

    if (!openai || !ENABLE_AI_BRAIN) {
      return ok(res, {
        reply: getFallbackReply(message, page, missionContext),
        source: "fallback",
        page,
        mission_summary: summarizeMissionState(missionContext)
      });
    }

    const systemPrompt = `
You are the Harvey Taxi AI support and mission assistant.
You help riders, drivers, and operators understand ride status, mission status, dispatch progress, onboarding status, and payment readiness.
Be concise, practical, and accurate.
Do not invent facts.
If there is no data, say so clearly.
If it sounds like an emergency, tell the user Harvey Taxi is not an emergency service and advise calling 911.
Harvey Taxi rules:
- Rider approval may be required before ride requests
- Phone verification may be required
- Payment authorization may be required before dispatch
- Drivers must complete signup, verification, and approval before going active
- Autonomous service is pilot mode only when clearly labeled
Current page context: ${page}
      `.trim();

    const completion = await openai.chat.completions.create({
      model: OPENAI_SUPPORT_MODEL,
      temperature: 0.3,
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: JSON.stringify(
            {
              user_message: message,
              page,
              mission_context: missionContext
            },
            null,
            2
          )
        }
      ]
    });

    const reply =
      completion?.choices?.[0]?.message?.content?.trim() ||
      getFallbackReply(message, page, missionContext);

    return ok(res, {
      reply,
      source: "openai",
      page,
      mission_summary: summarizeMissionState(missionContext)
    });
  } catch (error) {
    console.error("/api/ai/support error:", error.message);
    return ok(res, {
      reply: getFallbackReply(req.body?.message, req.body?.page, {}),
      source: "fallback"
    });
  }
});/* =========================================================
   HARVEY TAXI — CODE BLUE FINAL BUILD
   PART 3: FARE ENGINE + RIDE REQUEST + MISSION + DISPATCH
========================================================= */

/* FARE / DISPATCH CONFIG */
const BASE_FARE = Number(process.env.BASE_FARE || 8);
const PER_MILE_RATE = Number(process.env.PER_MILE_RATE || 2.2);
const PER_MINUTE_RATE = Number(process.env.PER_MINUTE_RATE || 0.45);
const BOOKING_FEE = Number(process.env.BOOKING_FEE || 2.5);
const MINIMUM_FARE = Number(process.env.MINIMUM_FARE || 10);
const DRIVER_PAYOUT_PERCENT = Number(process.env.DRIVER_PAYOUT_PERCENT || 0.75);

const DISPATCH_TIMEOUT_SECONDS = Number(process.env.DISPATCH_TIMEOUT_SECONDS || 25);
const MAX_DISPATCH_ATTEMPTS = Number(process.env.MAX_DISPATCH_ATTEMPTS || 5);

const GOOGLE_MAPS_API_KEY = clean(process.env.GOOGLE_MAPS_API_KEY);

/* REQUEST HELPERS */
function cleanAddress(value = "") {
  return clean(value);
}

function addressLooksValid(value = "") {
  return cleanAddress(value).length >= 5;
}

function cleanRequestedMode(value = "") {
  const mode = lower(value);
  if (["autonomous", "av", "pilot"].includes(mode)) return "autonomous";
  return "driver";
}

function cleanRideType(value = "") {
  const type = lower(value);
  if (["airport", "scheduled", "medical", "nonprofit", "standard", "event", "tourist"].includes(type)) {
    return type;
  }
  return "standard";
}

function cleanNotes(value = "") {
  return clean(value).slice(0, 1000);
}

function parseScheduledTime(value = "") {
  const raw = clean(value);
  if (!raw) return null;

  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return null;

  return date.toISOString();
}

function missionSummaryFromRoute(pickupAddress, dropoffAddress) {
  return `${cleanAddress(pickupAddress)} → ${cleanAddress(dropoffAddress)}`;
}

function inferSurgeMultiplier({ requestedMode = "driver", scheduledTime = null }) {
  let surge = 1;

  if (requestedMode === "autonomous") surge = 1.2;
  if (scheduledTime) surge = Math.max(surge, 1.05);

  return surge;
}

function publicRide(ride) {
  if (!ride) return null;

  return {
    ride_id: ride.id,
    rider_id: ride.rider_id || null,
    driver_id: ride.driver_id || null,
    mission_id: ride.mission_id || null,
    status: ride.status || null,
    requested_mode: ride.requested_mode || "driver",
    ride_type: ride.ride_type || "standard",
    pickup_address: ride.pickup_address || null,
    dropoff_address: ride.dropoff_address || null,
    notes: ride.notes || null,
    estimated_fare: ride.estimated_fare ?? null,
    estimated_driver_payout: ride.estimated_driver_payout ?? null,
    estimated_platform_revenue: ride.estimated_platform_revenue ?? null,
    payment_status: ride.payment_status || null,
    dispatch_status: ride.dispatch_status || null,
    created_at: ride.created_at || null,
    scheduled_time: ride.scheduled_time || null
  };
}

function publicMission(mission) {
  if (!mission) return null;

  return {
    mission_id: mission.id,
    ride_id: mission.ride_id || null,
    rider_id: mission.rider_id || null,
    driver_id: mission.driver_id || null,
    requested_mode: mission.requested_mode || "driver",
    status: mission.status || null,
    pickup_address: mission.pickup_address || null,
    dropoff_address: mission.dropoff_address || null,
    mission_summary: mission.mission_summary || null,
    estimated_fare: mission.estimated_fare ?? null,
    created_at: mission.created_at || null
  };
}

function publicDispatch(dispatch) {
  if (!dispatch) return null;

  return {
    dispatch_id: dispatch.id,
    ride_id: dispatch.ride_id || null,
    driver_id: dispatch.driver_id || null,
    mission_id: dispatch.mission_id || null,
    status: dispatch.status || null,
    attempt_number: dispatch.attempt_number ?? null,
    expires_at: dispatch.expires_at || null,
    created_at: dispatch.created_at || null
  };
}

/* FARE HELPERS */
function estimateFare({
  miles = 0,
  minutes = 0,
  surgeMultiplier = 1,
  requestedMode = "driver",
  rideType = "standard"
}) {
  const safeMiles = Math.max(0, Number(miles || 0));
  const safeMinutes = Math.max(0, Number(minutes || 0));
  const safeSurge = Math.max(1, Number(surgeMultiplier || 1));

  let subtotal =
    BASE_FARE + safeMiles * PER_MILE_RATE + safeMinutes * PER_MINUTE_RATE;

  if (rideType === "airport") subtotal *= 1.15;
  if (rideType === "scheduled") subtotal *= 1.1;
  if (rideType === "medical") subtotal *= 1.05;
  if (rideType === "event") subtotal *= 1.08;
  if (rideType === "tourist") subtotal *= 1.07;
  if (rideType === "nonprofit") subtotal *= 0.95;
  if (requestedMode === "autonomous") subtotal *= 1.2;

  subtotal *= safeSurge;

  const fare = Math.max(MINIMUM_FARE, subtotal + BOOKING_FEE);
  const driverPayout = requestedMode === "autonomous"
    ? 0
    : round(fare * DRIVER_PAYOUT_PERCENT);
  const platformRevenue = round(fare - driverPayout);

  return {
    estimated_fare: round(fare),
    base_fare: round(BASE_FARE),
    booking_fee: round(BOOKING_FEE),
    estimated_driver_payout: round(driverPayout),
    estimated_platform_revenue: round(platformRevenue),
    surge_multiplier: round(safeSurge),
    requested_mode: requestedMode,
    ride_type: rideType,
    miles: round(safeMiles),
    minutes: round(safeMinutes)
  };
}

/* MAP HELPERS */
async function safeFetch(url, options = {}) {
  if (typeof fetch === "function") {
    return fetch(url, options);
  }

  const https = require("https");
  const http = require("http");
  const target = new URL(url);
  const lib = target.protocol === "https:" ? https : http;

  return new Promise((resolve, reject) => {
    const req = lib.request(
      target,
      {
        method: options.method || "GET",
        headers: options.headers || {}
      },
      (res) => {
        let body = "";

        res.on("data", (chunk) => {
          body += chunk;
        });

        res.on("end", () => {
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode,
            json: async () => {
              try {
                return JSON.parse(body || "{}");
              } catch (error) {
                return {};
              }
            },
            text: async () => body
          });
        });
      }
    );

    req.on("error", reject);

    if (options.body) {
      req.write(options.body);
    }

    req.end();
  });
}

async function estimateTripFromAddresses({
  pickupAddress,
  dropoffAddress
}) {
  const pickup = cleanAddress(pickupAddress);
  const dropoff = cleanAddress(dropoffAddress);

  if (!pickup || !dropoff) {
    return {
      miles: 6,
      minutes: 15,
      source: "fallback"
    };
  }

  if (!GOOGLE_MAPS_API_KEY) {
    return {
      miles: 6,
      minutes: 15,
      source: "fallback"
    };
  }

  try {
    const origins = encodeURIComponent(pickup);
    const destinations = encodeURIComponent(dropoff);

    const url =
      `https://maps.googleapis.com/maps/api/distancematrix/json` +
      `?origins=${origins}` +
      `&destinations=${destinations}` +
      `&units=imperial` +
      `&key=${GOOGLE_MAPS_API_KEY}`;

    const response = await safeFetch(url);
    const data = await response.json();

    const row = data?.rows?.[0];
    const element = row?.elements?.[0];

    if (
      data?.status === "OK" &&
      element?.status === "OK" &&
      element?.distance?.value &&
      element?.duration?.value
    ) {
      const miles = element.distance.value / 1609.344;
      const minutes = element.duration.value / 60;

      return {
        miles: round(miles),
        minutes: round(minutes),
        source: "google_maps"
      };
    }
  } catch (error) {
    console.warn("Distance Matrix fallback triggered:", error.message);
  }

  return {
    miles: 6,
    minutes: 15,
    source: "fallback"
  };
}

/* DRIVER SELECTION */
async function getEligibleDrivers({ limit = 10, requestedMode = "driver" } = {}) {
  if (!supabase || requestedMode !== "driver") return [];

  try {
    const { data, error } = await supabase
      .from("drivers")
      .select("*")
      .eq("is_online", true)
      .eq("is_available", true)
      .limit(limit);

    if (error || !Array.isArray(data)) return [];

    return data.filter((driver) => {
      return driverPhoneVerified(driver) && isDriverApproved(driver);
    });
  } catch (error) {
    return [];
  }
}

function scoreDriverCandidate(driver) {
  let score = 0;

  if (driver?.is_online) score += 30;
  if (driver?.is_available) score += 30;
  if (driverPhoneVerified(driver)) score += 20;
  if (isDriverApproved(driver)) score += 20;

  return score;
}

async function pickBestDriver({ requestedMode = "driver" } = {}) {
  if (requestedMode !== "driver") return null;

  const candidates = await getEligibleDrivers({
    limit: 10,
    requestedMode
  });

  if (!candidates.length) return null;

  const ranked = [...candidates].sort((a, b) => {
    return scoreDriverCandidate(b) - scoreDriverCandidate(a);
  });

  return ranked[0] || null;
}

/* RECORD CREATORS */
async function createRideRecord(payload) {
  if (!supabase) throw new Error("Supabase is not configured");

  const record = {
    id: id("ride"),
    rider_id: clean(payload.rider_id),
    pickup_address: cleanAddress(payload.pickup_address),
    dropoff_address: cleanAddress(payload.dropoff_address),
    notes: cleanNotes(payload.notes),
    requested_mode: cleanRequestedMode(payload.requested_mode),
    ride_type: cleanRideType(payload.ride_type),
    status: clean(payload.status || "awaiting_dispatch"),
    payment_status: clean(payload.payment_status || "authorized"),
    dispatch_status: clean(payload.dispatch_status || "pending"),
    estimated_fare: Number(payload.estimated_fare || 0),
    estimated_driver_payout: Number(payload.estimated_driver_payout || 0),
    estimated_platform_revenue: Number(payload.estimated_platform_revenue || 0),
    base_fare: Number(payload.base_fare || 0),
    booking_fee: Number(payload.booking_fee || 0),
    surge_multiplier: Number(payload.surge_multiplier || 1),
    estimated_miles: Number(payload.estimated_miles || 0),
    estimated_minutes: Number(payload.estimated_minutes || 0),
    scheduled_time: payload.scheduled_time || null,
    driver_id: payload.driver_id || null,
    mission_id: payload.mission_id || null,
    created_at: now(),
    updated_at: now()
  };

  const { data, error } = await supabase
    .from("rides")
    .insert(record)
    .select("*")
    .maybeSingle();

  if (error) throw new Error(error.message || "Failed to create ride");
  return data;
}

async function createMissionRecord(payload) {
  if (!supabase) throw new Error("Supabase is not configured");

  const record = {
    id: id("mission"),
    ride_id: clean(payload.ride_id),
    rider_id: clean(payload.rider_id),
    driver_id: clean(payload.driver_id),
    requested_mode: cleanRequestedMode(payload.requested_mode),
    status: clean(payload.status || "offered"),
    pickup_address: cleanAddress(payload.pickup_address),
    dropoff_address: cleanAddress(payload.dropoff_address),
    mission_summary: clean(payload.mission_summary),
    notes: cleanNotes(payload.notes),
    estimated_fare: Number(payload.estimated_fare || 0),
    estimated_driver_payout: Number(payload.estimated_driver_payout || 0),
    created_at: now(),
    updated_at: now()
  };

  const { data, error } = await supabase
    .from("missions")
    .insert(record)
    .select("*")
    .maybeSingle();

  if (error) throw new Error(error.message || "Failed to create mission");
  return data;
}

async function createDispatchRecord(payload) {
  if (!supabase) throw new Error("Supabase is not configured");

  const expiresAt = new Date(
    Date.now() + DISPATCH_TIMEOUT_SECONDS * 1000
  ).toISOString();

  const record = {
    id: id("dispatch"),
    ride_id: clean(payload.ride_id),
    mission_id: clean(payload.mission_id),
    driver_id: clean(payload.driver_id),
    rider_id: clean(payload.rider_id),
    attempt_number: Number(payload.attempt_number || 1),
    status: clean(payload.status || "offered"),
    requested_mode: cleanRequestedMode(payload.requested_mode),
    expires_at: expiresAt,
    created_at: now(),
    updated_at: now()
  };

  const { data, error } = await supabase
    .from("dispatches")
    .insert(record)
    .select("*")
    .maybeSingle();

  if (error) throw new Error(error.message || "Failed to create dispatch");
  return data;
}

async function linkRideMission({
  rideId,
  missionId = "",
  driverId = "",
  dispatchStatus = "pending",
  rideStatus = "awaiting_driver_acceptance"
}) {
  if (!supabase || !clean(rideId)) return null;

  const updates = {
    mission_id: clean(missionId) || null,
    driver_id: clean(driverId) || null,
    dispatch_status: clean(dispatchStatus),
    status: clean(rideStatus),
    updated_at: now()
  };

  const { data, error } = await supabase
    .from("rides")
    .update(updates)
    .eq("id", clean(rideId))
    .select("*")
    .maybeSingle();

  if (error) return null;
  return data || null;
}

/* OPTIONAL TRIP EVENT LOGGING */
async function logTripEventSafe(payload = {}) {
  if (!supabase) return;

  try {
    const row = {
      id: id("tevt"),
      ride_id: clean(payload.ride_id),
      mission_id: clean(payload.mission_id),
      dispatch_id: clean(payload.dispatch_id),
      event_type: clean(payload.event_type),
      details: payload.details || {},
      created_at: now()
    };

    const { error } = await supabase.from("trip_events").insert(row);
    if (error) {
      await supabase.from("trip_timelines").insert(row);
    }
  } catch (e) {
    // silent
  }
}

/* ROUTES */
app.post("/api/fare-estimate", async (req, res) => {
  try {
    const pickupAddress = cleanAddress(req.body?.pickup_address || req.body?.pickup);
    const dropoffAddress = cleanAddress(req.body?.dropoff_address || req.body?.dropoff);
    const requestedMode = cleanRequestedMode(req.body?.requestedMode || req.body?.requested_mode);
    const rideType = cleanRideType(req.body?.rideType || req.body?.ride_type);
    const scheduledTime = parseScheduledTime(
      req.body?.scheduled_time || req.body?.scheduledTime
    );

    if (!addressLooksValid(pickupAddress) || !addressLooksValid(dropoffAddress)) {
      return fail(res, "Pickup and dropoff addresses are required", 400);
    }

    const tripEstimate = await estimateTripFromAddresses({
      pickupAddress,
      dropoffAddress
    });

    const surgeMultiplier = inferSurgeMultiplier({
      requestedMode,
      scheduledTime
    });

    const fare = estimateFare({
      miles: tripEstimate.miles,
      minutes: tripEstimate.minutes,
      surgeMultiplier,
      requestedMode,
      rideType
    });

    return ok(res, {
      fare_estimate: fare,
      route: {
        pickup_address: pickupAddress,
        dropoff_address: dropoffAddress,
        estimated_miles: fare.miles,
        estimated_minutes: fare.minutes,
        source: tripEstimate.source
      }
    });
  } catch (error) {
    console.error("/api/fare-estimate error:", error.message);
    return fail(res, "Failed to estimate fare", 500);
  }
});

app.post("/api/payment/check-authorization", async (req, res) => {
  try {
    const riderId = clean(req.body?.rider_id);
    const rideId = clean(req.body?.ride_id);

    if (!riderId && !rideId) {
      return fail(res, "rider_id or ride_id is required", 400);
    }

    let payment = null;

    if (rideId) payment = await getLatestPaymentForRide(rideId);
    if (!payment && riderId) payment = await getLatestPaymentForRider(riderId);

    return ok(res, {
      authorized: isPaymentAuthorized(payment),
      payment: payment
        ? {
            id: payment.id || null,
            status:
              payment.status ||
              payment.payment_status ||
              payment.authorization_status ||
              null,
            amount: payment.amount ?? null,
            rider_id: payment.rider_id || null,
            ride_id: payment.ride_id || null,
            created_at: payment.created_at || null
          }
        : null
    });
  } catch (error) {
    console.error("/api/payment/check-authorization error:", error.message);
    return fail(res, "Failed to check payment authorization", 500);
  }
});

app.post("/api/rider/can-request-ride", async (req, res) => {
  try {
    const riderId = clean(req.body?.rider_id);
    const rideId = clean(req.body?.ride_id);

    if (!riderId) {
      return fail(res, "rider_id is required", 400);
    }

    const access = await ensureRiderCanRequestRide({
      riderId,
      rideId
    });

    return ok(res, {
      allowed: !!access.ok,
      error: access.ok ? null : access.error,
      rider_id: riderId
    });
  } catch (error) {
    console.error("/api/rider/can-request-ride error:", error.message);
    return fail(res, "Failed to check rider access", 500);
  }
});

app.post("/api/request-ride", async (req, res) => {
  try {
    if (!supabase) {
      return fail(res, "Supabase is not configured", 500);
    }

    const riderId = clean(req.body?.rider_id);
    const pickupAddress = cleanAddress(req.body?.pickup_address || req.body?.pickup);
    const dropoffAddress = cleanAddress(req.body?.dropoff_address || req.body?.dropoff);
    const notes = cleanNotes(req.body?.notes || req.body?.specialInstructions);
    const requestedMode = cleanRequestedMode(
      req.body?.requestedMode || req.body?.requested_mode
    );
    const rideType = cleanRideType(req.body?.rideType || req.body?.ride_type);
    const scheduledTime = parseScheduledTime(
      req.body?.scheduled_time || req.body?.scheduledTime
    );

    if (!riderId) {
      return fail(res, "rider_id is required", 400);
    }

    if (!addressLooksValid(pickupAddress) || !addressLooksValid(dropoffAddress)) {
      return fail(res, "Pickup and dropoff addresses are required", 400);
    }

    const riderAccess = await ensureRiderCanRequestRide({
      riderId
    });

    if (!riderAccess.ok) {
      return fail(res, riderAccess.error, riderAccess.status || 403);
    }

    const tripEstimate = await estimateTripFromAddresses({
      pickupAddress,
      dropoffAddress
    });

    const surgeMultiplier = inferSurgeMultiplier({
      requestedMode,
      scheduledTime
    });

    const fare = estimateFare({
      miles: tripEstimate.miles,
      minutes: tripEstimate.minutes,
      surgeMultiplier,
      requestedMode,
      rideType
    });

    let selectedDriver = null;
    let rideStatus = "awaiting_dispatch";
    let dispatchStatus = "pending";
    let missionStatus = "queued";

    if (requestedMode === "driver") {
      selectedDriver = await pickBestDriver({ requestedMode });

      if (selectedDriver) {
        rideStatus = "awaiting_driver_acceptance";
        dispatchStatus = "offered";
        missionStatus = "offered";
      } else {
        rideStatus = "no_driver_available";
        dispatchStatus = "no_driver_available";
        missionStatus = "unassigned";
      }
    }

    if (requestedMode === "autonomous") {
      rideStatus = "autonomous_review";
      dispatchStatus = "pilot_pending";
      missionStatus = "pilot_pending";
    }

    const ride = await createRideRecord({
      rider_id: riderId,
      pickup_address: pickupAddress,
      dropoff_address: dropoffAddress,
      notes,
      requested_mode: requestedMode,
      ride_type: rideType,
      status: rideStatus,
      payment_status: "authorized",
      dispatch_status: dispatchStatus,
      estimated_fare: fare.estimated_fare,
      estimated_driver_payout: fare.estimated_driver_payout,
      estimated_platform_revenue: fare.estimated_platform_revenue,
      base_fare: fare.base_fare,
      booking_fee: fare.booking_fee,
      surge_multiplier: fare.surge_multiplier,
      estimated_miles: fare.miles,
      estimated_minutes: fare.minutes,
      scheduled_time: scheduledTime,
      driver_id: selectedDriver?.id || null
    });

    const mission = await createMissionRecord({
      ride_id: ride.id,
      rider_id: riderId,
      driver_id: selectedDriver?.id || "",
      requested_mode: requestedMode,
      status: missionStatus,
      pickup_address: pickupAddress,
      dropoff_address: dropoffAddress,
      mission_summary: missionSummaryFromRoute(pickupAddress, dropoffAddress),
      notes,
      estimated_fare: fare.estimated_fare,
      estimated_driver_payout: fare.estimated_driver_payout
    });

    let dispatch = null;

    if (requestedMode === "driver" && selectedDriver) {
      dispatch = await createDispatchRecord({
        ride_id: ride.id,
        mission_id: mission.id,
        driver_id: selectedDriver.id,
        rider_id: riderId,
        attempt_number: 1,
        status: "offered",
        requested_mode: requestedMode
      });
    }

    const linkedRide = await linkRideMission({
      rideId: ride.id,
      missionId: mission.id,
      driverId: selectedDriver?.id || "",
      dispatchStatus,
      rideStatus
    });

    await logTripEventSafe({
      ride_id: ride.id,
      mission_id: mission.id,
      dispatch_id: dispatch?.id || "",
      event_type: "ride_requested",
      details: {
        rider_id: riderId,
        requested_mode: requestedMode,
        ride_type: rideType,
        pickup_address: pickupAddress,
        dropoff_address: dropoffAddress,
        estimated_fare: fare.estimated_fare,
        estimated_miles: fare.miles,
        estimated_minutes: fare.minutes,
        driver_selected: !!selectedDriver,
        route_source: tripEstimate.source
      }
    });

    if (dispatch) {
      await logTripEventSafe({
        ride_id: ride.id,
        mission_id: mission.id,
        dispatch_id: dispatch.id,
        event_type: "dispatch_offered",
        details: {
          driver_id: selectedDriver.id,
          attempt_number: 1,
          expires_at: dispatch.expires_at
        }
      });
    }

    return ok(res, {
      message:
        requestedMode === "autonomous"
          ? "Autonomous pilot ride request submitted"
          : selectedDriver
            ? "Ride requested and driver offer sent"
            : "Ride requested, but no driver is currently available",
      ride: publicRide(linkedRide || ride),
      mission: publicMission(mission),
      dispatch: publicDispatch(dispatch),
      fare_estimate: fare,
      assigned_driver: selectedDriver
        ? {
            driver_id: selectedDriver.id,
            first_name: selectedDriver.first_name || null,
            last_name: selectedDriver.last_name || null,
            vehicle_make: selectedDriver.vehicle_make || null,
            vehicle_model: selectedDriver.vehicle_model || null,
            vehicle_color: selectedDriver.vehicle_color || null,
            license_plate: selectedDriver.license_plate || null
          }
        : null
    });
  } catch (error) {
    console.error("/api/request-ride error:", error.message);
    return fail(res, error.message || "Failed to request ride", 500);
  }
});

app.get("/api/rider/:id/rides", async (req, res) => {
  try {
    const riderId = clean(req.params.id);
    if (!riderId) return fail(res, "rider id required", 400);

    const { data, error } = await supabase
      .from("rides")
      .select("*")
      .eq("rider_id", riderId)
      .order("created_at", { ascending: false });

    if (error) return fail(res, error.message || "Failed to fetch rides", 500);

    return ok(res, {
      rides: Array.isArray(data) ? data.map(publicRide) : []
    });
  } catch (error) {
    console.error("/api/rider/:id/rides error:", error.message);
    return fail(res, "Failed to fetch rider rides", 500);
  }
});

app.get("/api/driver/:id/current", async (req, res) => {
  try {
    const driverId = clean(req.params.id);
    if (!driverId) return fail(res, "driver id required", 400);

    const { data, error } = await supabase
      .from("rides")
      .select("*")
      .eq("driver_id", driverId)
      .in("status", [
        "awaiting_driver_acceptance",
        "dispatched",
        "driver_en_route",
        "driver_arrived",
        "in_progress"
      ])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) return fail(res, error.message || "Failed to fetch current ride", 500);

    return ok(res, {
      ride: publicRide(data || null)
    });
  } catch (error) {
    console.error("/api/driver/:id/current error:", error.message);
    return fail(res, "Failed to fetch current ride", 500);
  }
});/* =========================================================
   HARVEY TAXI — CODE BLUE FINAL BUILD
   PART 4: MISSION ACCEPT / REJECT + REDISPATCH + TRIP FLOW
========================================================= */

/* LOOKUPS */
async function getMissionById(missionId) {
  if (!supabase || !clean(missionId)) return null;

  const { data, error } = await supabase
    .from("missions")
    .select("*")
    .eq("id", clean(missionId))
    .maybeSingle();

  if (error) return null;
  return data || null;
}

async function getDispatchById(dispatchId) {
  if (!supabase || !clean(dispatchId)) return null;

  const { data, error } = await supabase
    .from("dispatches")
    .select("*")
    .eq("id", clean(dispatchId))
    .maybeSingle();

  if (error) return null;
  return data || null;
}

async function getLatestDispatchForRide(rideId) {
  if (!supabase || !clean(rideId)) return null;

  const { data, error } = await supabase
    .from("dispatches")
    .select("*")
    .eq("ride_id", clean(rideId))
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return null;
  return data || null;
}

async function getOpenDispatchesForRide(rideId) {
  if (!supabase || !clean(rideId)) return [];

  const { data, error } = await supabase
    .from("dispatches")
    .select("*")
    .eq("ride_id", clean(rideId))
    .in("status", ["offered", "pending", "sent"])
    .order("created_at", { ascending: true });

  if (error || !Array.isArray(data)) return [];
  return data;
}

async function getDispatchAttemptsCount(rideId) {
  if (!supabase || !clean(rideId)) return 0;

  const { count, error } = await supabase
    .from("dispatches")
    .select("*", { count: "exact", head: true })
    .eq("ride_id", clean(rideId));

  if (error) return 0;
  return Number(count || 0);
}

async function getOfferedDriverIdsForRide(rideId) {
  if (!supabase || !clean(rideId)) return [];

  const { data, error } = await supabase
    .from("dispatches")
    .select("driver_id")
    .eq("ride_id", clean(rideId));

  if (error || !Array.isArray(data)) return [];
  return data.map((row) => clean(row.driver_id)).filter(Boolean);
}

/* UPDATE HELPERS */
async function updateRide(rideId, updates = {}) {
  if (!supabase || !clean(rideId)) return null;

  const payload = {
    ...updates,
    updated_at: now()
  };

  const { data, error } = await supabase
    .from("rides")
    .update(payload)
    .eq("id", clean(rideId))
    .select("*")
    .maybeSingle();

  if (error) return null;
  return data || null;
}

async function updateMission(missionId, updates = {}) {
  if (!supabase || !clean(missionId)) return null;

  const payload = {
    ...updates,
    updated_at: now()
  };

  const { data, error } = await supabase
    .from("missions")
    .update(payload)
    .eq("id", clean(missionId))
    .select("*")
    .maybeSingle();

  if (error) return null;
  return data || null;
}

async function updateDispatch(dispatchId, updates = {}) {
  if (!supabase || !clean(dispatchId)) return null;

  const payload = {
    ...updates,
    updated_at: now()
  };

  const { data, error } = await supabase
    .from("dispatches")
    .update(payload)
    .eq("id", clean(dispatchId))
    .select("*")
    .maybeSingle();

  if (error) return null;
  return data || null;
}

async function setDriverAvailability(driverId, isAvailable, isOnline = true) {
  if (!supabase || !clean(driverId)) return null;

  const { data, error } = await supabase
    .from("drivers")
    .update({
      is_available: !!isAvailable,
      is_online: !!isOnline,
      updated_at: now()
    })
    .eq("id", clean(driverId))
    .select("*")
    .maybeSingle();

  if (error) return null;
  return data || null;
}

async function closeOpenDispatchesForRide(rideId, finalStatus = "closed") {
  if (!supabase || !clean(rideId)) return;

  try {
    await supabase
      .from("dispatches")
      .update({
        status: clean(finalStatus),
        updated_at: now()
      })
      .eq("ride_id", clean(rideId))
      .in("status", ["offered", "pending", "sent"]);
  } catch (error) {
    // silent
  }
}

/* REDISPATCH HELPERS */
async function pickNextDriverExcluding(rideId) {
  const excludedIds = await getOfferedDriverIdsForRide(rideId);
  const candidates = await getEligibleDrivers({
    limit: 25,
    requestedMode: "driver"
  });

  const filtered = candidates.filter((driver) => {
    return !excludedIds.includes(clean(driver.id));
  });

  if (!filtered.length) return null;

  const ranked = filtered.sort((a, b) => {
    return scoreDriverCandidate(b) - scoreDriverCandidate(a);
  });

  return ranked[0] || null;
}

async function redispatchRide(ride) {
  if (!ride || cleanRequestedMode(ride.requested_mode) !== "driver") {
    return {
      ok: false,
      error: "Ride is not eligible for redispatch"
    };
  }

  const attempts = await getDispatchAttemptsCount(ride.id);

  if (attempts >= MAX_DISPATCH_ATTEMPTS) {
    const updatedRide = await updateRide(ride.id, {
      status: "no_driver_available",
      dispatch_status: "max_attempts_reached",
      driver_id: null
    });

    if (ride.mission_id) {
      await updateMission(ride.mission_id, {
        status: "unassigned",
        driver_id: null
      });
    }

    await logTripEventSafe({
      ride_id: ride.id,
      mission_id: ride.mission_id || "",
      event_type: "dispatch_failed",
      details: {
        reason: "max_attempts_reached",
        attempts
      }
    });

    return {
      ok: false,
      error: "Maximum dispatch attempts reached",
      ride: updatedRide || ride
    };
  }

  const nextDriver = await pickNextDriverExcluding(ride.id);

  if (!nextDriver) {
    const updatedRide = await updateRide(ride.id, {
      status: "no_driver_available",
      dispatch_status: "no_driver_available",
      driver_id: null
    });

    if (ride.mission_id) {
      await updateMission(ride.mission_id, {
        status: "unassigned",
        driver_id: null
      });
    }

    await logTripEventSafe({
      ride_id: ride.id,
      mission_id: ride.mission_id || "",
      event_type: "dispatch_failed",
      details: {
        reason: "no_other_driver_available"
      }
    });

    return {
      ok: false,
      error: "No other drivers available",
      ride: updatedRide || ride
    };
  }

  let mission = null;

  if (ride.mission_id) {
    mission = await updateMission(ride.mission_id, {
      driver_id: nextDriver.id,
      status: "offered"
    });
  }

  const dispatch = await createDispatchRecord({
    ride_id: ride.id,
    mission_id: ride.mission_id || "",
    driver_id: nextDriver.id,
    rider_id: ride.rider_id,
    attempt_number: attempts + 1,
    status: "offered",
    requested_mode: "driver"
  });

  const updatedRide = await updateRide(ride.id, {
    driver_id: nextDriver.id,
    status: "awaiting_driver_acceptance",
    dispatch_status: "offered"
  });

  await logTripEventSafe({
    ride_id: ride.id,
    mission_id: ride.mission_id || "",
    dispatch_id: dispatch.id,
    event_type: "dispatch_offered",
    details: {
      driver_id: nextDriver.id,
      attempt_number: attempts + 1,
      expires_at: dispatch.expires_at
    }
  });

  return {
    ok: true,
    ride: updatedRide || ride,
    mission,
    dispatch,
    driver: nextDriver
  };
}

async function expireDispatchIfNeeded(dispatch) {
  if (!dispatch) {
    return { ok: false, error: "Dispatch not found" };
  }

  if (!["offered", "pending", "sent"].includes(lower(dispatch.status))) {
    return { ok: true, expired: false, dispatch };
  }

  const expiresAt = dispatch.expires_at ? new Date(dispatch.expires_at) : null;

  if (!expiresAt || Number.isNaN(expiresAt.getTime())) {
    return { ok: true, expired: false, dispatch };
  }

  if (Date.now() < expiresAt.getTime()) {
    return { ok: true, expired: false, dispatch };
  }

  const expired = await updateDispatch(dispatch.id, {
    status: "expired"
  });

  const ride = await getRideById(dispatch.ride_id);

  await logTripEventSafe({
    ride_id: dispatch.ride_id || "",
    mission_id: ride?.mission_id || "",
    dispatch_id: dispatch.id,
    event_type: "dispatch_expired",
    details: {
      driver_id: dispatch.driver_id || null
    }
  });

  if (!ride) {
    return { ok: true, expired: true, dispatch: expired || dispatch };
  }

  const redispatch = await redispatchRide(ride);

  return {
    ok: true,
    expired: true,
    dispatch: expired || dispatch,
    redispatch
  };
}

/* DRIVER MISSIONS */
app.get("/api/driver/:id/missions", async (req, res) => {
  try {
    const driverId = clean(req.params.id);

    if (!driverId) {
      return fail(res, "driver id required", 400);
    }

    const { data, error } = await supabase
      .from("missions")
      .select("*")
      .eq("driver_id", driverId)
      .in("status", [
        "offered",
        "accepted",
        "driver_en_route",
        "driver_arrived",
        "in_progress"
      ])
      .order("created_at", { ascending: false });

    if (error) {
      return fail(res, error.message || "Failed to fetch missions", 500);
    }

    return ok(res, {
      missions: Array.isArray(data) ? data.map(publicMission) : []
    });
  } catch (error) {
    console.error("/api/driver/:id/missions error:", error.message);
    return fail(res, "Failed to fetch missions", 500);
  }
});

/* DISPATCH EXPIRY CHECK */
app.post("/api/dispatch/check-expiry", async (req, res) => {
  try {
    const dispatchId = clean(req.body?.dispatch_id);

    if (!dispatchId) {
      return fail(res, "dispatch_id is required", 400);
    }

    const dispatch = await getDispatchById(dispatchId);

    if (!dispatch) {
      return fail(res, "Dispatch not found", 404);
    }

    const result = await expireDispatchIfNeeded(dispatch);

    return ok(res, {
      dispatch: publicDispatch(result.dispatch || dispatch),
      expired: !!result.expired,
      redispatched: !!result.redispatch?.ok
    });
  } catch (error) {
    console.error("/api/dispatch/check-expiry error:", error.message);
    return fail(res, "Failed to check dispatch expiry", 500);
  }
});

/* ACCEPT MISSION */
app.post("/api/missions/accept", async (req, res) => {
  try {
    const missionId = clean(req.body?.mission_id);
    const driverId = clean(req.body?.driver_id);

    if (!missionId || !driverId) {
      return fail(res, "mission_id and driver_id are required", 400);
    }

    const access = await ensureDriverCanGoActive({ driverId });

    if (!access.ok) {
      return fail(res, access.error, access.status || 403);
    }

    const mission = await getMissionById(missionId);

    if (!mission) {
      return fail(res, "Mission not found", 404);
    }

    if (clean(mission.driver_id) !== driverId) {
      return fail(res, "Mission is not assigned to this driver", 403);
    }

    const ride = await getRideById(mission.ride_id);

    if (!ride) {
      return fail(res, "Ride not found", 404);
    }

    const dispatch = await getLatestDispatchForRide(ride.id);

    if (!dispatch) {
      return fail(res, "Dispatch not found", 404);
    }

    const expiryCheck = await expireDispatchIfNeeded(dispatch);

    if (expiryCheck.expired) {
      return fail(res, "Mission offer has expired", 409);
    }

    const updatedDispatch = await updateDispatch(dispatch.id, {
      status: "accepted"
    });

    const updatedMission = await updateMission(mission.id, {
      status: "accepted"
    });

    const updatedRide = await updateRide(ride.id, {
      status: "dispatched",
      dispatch_status: "accepted",
      driver_id: driverId
    });

    await setDriverAvailability(driverId, false, true);
    await closeOpenDispatchesForRide(ride.id, "closed");
    await updateDispatch(dispatch.id, { status: "accepted" });

    await logTripEventSafe({
      ride_id: ride.id,
      mission_id: mission.id,
      dispatch_id: dispatch.id,
      event_type: "mission_accepted",
      details: {
        driver_id: driverId
      }
    });

    return ok(res, {
      message: "Mission accepted",
      ride: publicRide(updatedRide),
      mission: publicMission(updatedMission),
      dispatch: publicDispatch(updatedDispatch || dispatch)
    });
  } catch (error) {
    console.error("/api/missions/accept error:", error.message);
    return fail(res, "Failed to accept mission", 500);
  }
});

/* REJECT MISSION */
app.post("/api/missions/reject", async (req, res) => {
  try {
    const missionId = clean(req.body?.mission_id);
    const driverId = clean(req.body?.driver_id);
    const reason = clean(req.body?.reason || "driver_rejected");

    if (!missionId || !driverId) {
      return fail(res, "mission_id and driver_id are required", 400);
    }

    const mission = await getMissionById(missionId);

    if (!mission) {
      return fail(res, "Mission not found", 404);
    }

    if (clean(mission.driver_id) !== driverId) {
      return fail(res, "Mission is not assigned to this driver", 403);
    }

    const ride = await getRideById(mission.ride_id);

    if (!ride) {
      return fail(res, "Ride not found", 404);
    }

    const dispatch = await getLatestDispatchForRide(ride.id);

    if (dispatch && clean(dispatch.driver_id) === driverId) {
      await updateDispatch(dispatch.id, {
        status: "rejected"
      });
    }

    await setDriverAvailability(driverId, true, true);

    await logTripEventSafe({
      ride_id: ride.id,
      mission_id: mission.id,
      dispatch_id: dispatch?.id || "",
      event_type: "mission_rejected",
      details: {
        driver_id: driverId,
        reason
      }
    });

    const result = await redispatchRide(ride);

    return ok(res, {
      message: result.ok ? "Mission rejected and redispatched" : "Mission rejected",
      redispatched: !!result.ok,
      ride: publicRide(result.ride || ride),
      dispatch: publicDispatch(result.dispatch || null)
    });
  } catch (error) {
    console.error("/api/missions/reject error:", error.message);
    return fail(res, "Failed to reject mission", 500);
  }
});

/* DRIVER EN ROUTE */
app.post("/api/rides/driver-en-route", async (req, res) => {
  try {
    const rideId = clean(req.body?.ride_id);
    const driverId = clean(req.body?.driver_id);

    if (!rideId || !driverId) {
      return fail(res, "ride_id and driver_id are required", 400);
    }

    const ride = await getRideById(rideId);

    if (!ride) {
      return fail(res, "Ride not found", 404);
    }

    if (clean(ride.driver_id) !== driverId) {
      return fail(res, "Ride is not assigned to this driver", 403);
    }

    const updatedRide = await updateRide(rideId, {
      status: "driver_en_route"
    });

    if (ride.mission_id) {
      await updateMission(ride.mission_id, {
        status: "driver_en_route"
      });
    }

    await logTripEventSafe({
      ride_id: rideId,
      mission_id: ride.mission_id || "",
      event_type: "driver_en_route",
      details: {
        driver_id: driverId
      }
    });

    return ok(res, {
      message: "Driver marked en route",
      ride: publicRide(updatedRide)
    });
  } catch (error) {
    console.error("/api/rides/driver-en-route error:", error.message);
    return fail(res, "Failed to update ride", 500);
  }
});

/* DRIVER ARRIVED */
app.post("/api/rides/driver-arrived", async (req, res) => {
  try {
    const rideId = clean(req.body?.ride_id);
    const driverId = clean(req.body?.driver_id);

    if (!rideId || !driverId) {
      return fail(res, "ride_id and driver_id are required", 400);
    }

    const ride = await getRideById(rideId);

    if (!ride) {
      return fail(res, "Ride not found", 404);
    }

    if (clean(ride.driver_id) !== driverId) {
      return fail(res, "Ride is not assigned to this driver", 403);
    }

    const updatedRide = await updateRide(rideId, {
      status: "driver_arrived"
    });

    if (ride.mission_id) {
      await updateMission(ride.mission_id, {
        status: "driver_arrived"
      });
    }

    await logTripEventSafe({
      ride_id: rideId,
      mission_id: ride.mission_id || "",
      event_type: "driver_arrived",
      details: {
        driver_id: driverId
      }
    });

    return ok(res, {
      message: "Driver marked arrived",
      ride: publicRide(updatedRide)
    });
  } catch (error) {
    console.error("/api/rides/driver-arrived error:", error.message);
    return fail(res, "Failed to update ride", 500);
  }
});

/* START TRIP */
app.post("/api/rides/start", async (req, res) => {
  try {
    const rideId = clean(req.body?.ride_id);
    const driverId = clean(req.body?.driver_id);

    if (!rideId || !driverId) {
      return fail(res, "ride_id and driver_id are required", 400);
    }

    const ride = await getRideById(rideId);

    if (!ride) {
      return fail(res, "Ride not found", 404);
    }

    if (clean(ride.driver_id) !== driverId) {
      return fail(res, "Ride is not assigned to this driver", 403);
    }

    const updatedRide = await updateRide(rideId, {
      status: "in_progress",
      started_at: now()
    });

    if (ride.mission_id) {
      await updateMission(ride.mission_id, {
        status: "in_progress"
      });
    }

    await logTripEventSafe({
      ride_id: rideId,
      mission_id: ride.mission_id || "",
      event_type: "trip_started",
      details: {
        driver_id: driverId
      }
    });

    return ok(res, {
      message: "Trip started",
      ride: publicRide(updatedRide)
    });
  } catch (error) {
    console.error("/api/rides/start error:", error.message);
    return fail(res, "Failed to start trip", 500);
  }
});

/* COMPLETE TRIP */
app.post("/api/rides/complete", async (req, res) => {
  try {
    const rideId = clean(req.body?.ride_id);
    const driverId = clean(req.body?.driver_id);

    if (!rideId || !driverId) {
      return fail(res, "ride_id and driver_id are required", 400);
    }

    const ride = await getRideById(rideId);

    if (!ride) {
      return fail(res, "Ride not found", 404);
    }

    if (clean(ride.driver_id) !== driverId) {
      return fail(res, "Ride is not assigned to this driver", 403);
    }

    const updatedRide = await updateRide(rideId, {
      status: "completed",
      dispatch_status: "completed",
      completed_at: now()
    });

    if (ride.mission_id) {
      await updateMission(ride.mission_id, {
        status: "completed"
      });
    }

    if (typeof createDriverEarningFromRide === "function") {
      await createDriverEarningFromRide(updatedRide);
    }

    await closeOpenDispatchesForRide(rideId, "completed");
    await setDriverAvailability(driverId, true, true);

    await logTripEventSafe({
      ride_id: rideId,
      mission_id: ride.mission_id || "",
      event_type: "trip_completed",
      details: {
        driver_id: driverId,
        estimated_fare: ride.estimated_fare || null
      }
    });

    return ok(res, {
      message: "Trip completed",
      ride: publicRide(updatedRide)
    });
  } catch (error) {
    console.error("/api/rides/complete error:", error.message);
    return fail(res, "Failed to complete trip", 500);
  }
});

/* RIDER CANCEL */
app.post("/api/rides/cancel", async (req, res) => {
  try {
    const rideId = clean(req.body?.ride_id);
    const riderId = clean(req.body?.rider_id);
    const reason = clean(req.body?.reason || "rider_cancelled");

    if (!rideId || !riderId) {
      return fail(res, "ride_id and rider_id are required", 400);
    }

    const ride = await getRideById(rideId);

    if (!ride) {
      return fail(res, "Ride not found", 404);
    }

    if (clean(ride.rider_id) !== riderId) {
      return fail(res, "Ride is not assigned to this rider", 403);
    }

    const updatedRide = await updateRide(rideId, {
      status: "cancelled",
      dispatch_status: "cancelled"
    });

    if (ride.mission_id) {
      await updateMission(ride.mission_id, {
        status: "cancelled"
      });
    }

    await closeOpenDispatchesForRide(rideId, "cancelled");

    if (ride.driver_id) {
      await setDriverAvailability(ride.driver_id, true, true);
    }

    await logTripEventSafe({
      ride_id: rideId,
      mission_id: ride.mission_id || "",
      event_type: "ride_cancelled",
      details: {
        cancelled_by: "rider",
        rider_id: riderId,
        reason
      }
    });

    return ok(res, {
      message: "Ride cancelled",
      ride: publicRide(updatedRide)
    });
  } catch (error) {
    console.error("/api/rides/cancel error:", error.message);
    return fail(res, "Failed to cancel ride", 500);
  }
});

/* ADMIN CANCEL */
app.post("/api/admin/rides/cancel", requireAdmin, async (req, res) => {
  try {
    const rideId = clean(req.body?.ride_id);
    const reason = clean(req.body?.reason || "admin_cancelled");

    if (!rideId) {
      return fail(res, "ride_id is required", 400);
    }

    const ride = await getRideById(rideId);

    if (!ride) {
      return fail(res, "Ride not found", 404);
    }

    const updatedRide = await updateRide(rideId, {
      status: "cancelled",
      dispatch_status: "cancelled"
    });

    if (ride.mission_id) {
      await updateMission(ride.mission_id, {
        status: "cancelled"
      });
    }

    await closeOpenDispatchesForRide(rideId, "cancelled");

    if (ride.driver_id) {
      await setDriverAvailability(ride.driver_id, true, true);
    }

    await logTripEventSafe({
      ride_id: rideId,
      mission_id: ride.mission_id || "",
      event_type: "ride_cancelled",
      details: {
        cancelled_by: "admin",
        reason
      }
    });

    return ok(res, {
      message: "Ride cancelled by admin",
      ride: publicRide(updatedRide)
    });
  } catch (error) {
    console.error("/api/admin/rides/cancel error:", error.message);
    return fail(res, "Failed to cancel ride", 500);
  }
});/* =========================================================
   HARVEY TAXI — CODE BLUE FINAL BUILD
   PART 5: ADMIN DASHBOARD + ANALYTICS + EARNINGS + FINAL BOOT
========================================================= */

/* OPTIONAL EMAIL */
let nodemailer = null;
try { nodemailer = require("nodemailer"); } catch (e) {}

/* EMAIL CONFIG */
const SUPPORT_EMAIL = clean(
  process.env.SUPPORT_EMAIL ||
  process.env.SUPPORT_FROM_EMAIL ||
  "support@harveytaxiservice.com"
);

const SMTP_HOST = clean(process.env.SMTP_HOST);
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_USER = clean(process.env.SMTP_USER);
const SMTP_PASS = clean(process.env.SMTP_PASS);
const SMTP_FROM = clean(process.env.SMTP_FROM || SUPPORT_EMAIL);

function smtpReady() {
  return !!(nodemailer && SMTP_HOST && SMTP_USER && SMTP_PASS);
}

let mailTransport = null;

function getMailTransport() {
  if (!smtpReady()) return null;
  if (mailTransport) return mailTransport;

  mailTransport = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465,
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS
    }
  });

  return mailTransport;
}

async function sendEmail({ to, subject, text, html = "" }) {
  try {
    const transport = getMailTransport();
    if (!transport || !clean(to)) return { ok: false, skipped: true };

    const info = await transport.sendMail({
      from: SMTP_FROM,
      to: clean(to),
      subject: clean(subject || "Harvey Taxi Update"),
      text: clean(text || ""),
      html: html || undefined
    });

    return {
      ok: true,
      messageId: info?.messageId || null
    };
  } catch (error) {
    console.warn("sendEmail failed:", error.message);
    return {
      ok: false,
      error: error.message
    };
  }
}

/* COUNTS / ANALYTICS */
async function getCounts() {
  if (!supabase) {
    return {
      riders: 0,
      drivers: 0,
      rides: 0,
      missions: 0,
      dispatches: 0
    };
  }

  async function countTable(table) {
    const { count, error } = await supabase
      .from(table)
      .select("*", { count: "exact", head: true });

    if (error) return 0;
    return Number(count || 0);
  }

  return {
    riders: await countTable("riders"),
    drivers: await countTable("drivers"),
    rides: await countTable("rides"),
    missions: await countTable("missions"),
    dispatches: await countTable("dispatches")
  };
}

async function getRideStatusBreakdown() {
  if (!supabase) return {};

  const { data, error } = await supabase.from("rides").select("status");
  if (error || !Array.isArray(data)) return {};

  return data.reduce((acc, row) => {
    const key = clean(row.status || "unknown");
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

async function getDispatchStatusBreakdown() {
  if (!supabase) return {};

  const { data, error } = await supabase.from("dispatches").select("status");
  if (error || !Array.isArray(data)) return {};

  return data.reduce((acc, row) => {
    const key = clean(row.status || "unknown");
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

async function getRevenueSnapshot() {
  if (!supabase) {
    return {
      estimated_fares_total: 0,
      estimated_driver_payout_total: 0,
      estimated_platform_revenue_total: 0
    };
  }

  const { data, error } = await supabase
    .from("rides")
    .select("estimated_fare, estimated_driver_payout, estimated_platform_revenue");

  if (error || !Array.isArray(data)) {
    return {
      estimated_fares_total: 0,
      estimated_driver_payout_total: 0,
      estimated_platform_revenue_total: 0
    };
  }

  const totals = data.reduce(
    (acc, row) => {
      acc.estimated_fares_total += Number(row.estimated_fare || 0);
      acc.estimated_driver_payout_total += Number(row.estimated_driver_payout || 0);
      acc.estimated_platform_revenue_total += Number(row.estimated_platform_revenue || 0);
      return acc;
    },
    {
      estimated_fares_total: 0,
      estimated_driver_payout_total: 0,
      estimated_platform_revenue_total: 0
    }
  );

  return {
    estimated_fares_total: round(totals.estimated_fares_total),
    estimated_driver_payout_total: round(totals.estimated_driver_payout_total),
    estimated_platform_revenue_total: round(totals.estimated_platform_revenue_total)
  };
}

/* DRIVER EARNINGS */
async function createDriverEarningFromRide(ride) {
  if (!supabase || !ride || !ride.driver_id) return null;

  const { data: existing, error: existingError } = await supabase
    .from("driver_earnings")
    .select("*")
    .eq("ride_id", clean(ride.id))
    .eq("driver_id", clean(ride.driver_id))
    .maybeSingle();

  if (!existingError && existing) return existing;

  const { data, error } = await supabase
    .from("driver_earnings")
    .insert({
      id: id("earn"),
      driver_id: clean(ride.driver_id),
      ride_id: clean(ride.id),
      amount: Number(ride.estimated_driver_payout || 0),
      status: "pending",
      created_at: now(),
      updated_at: now()
    })
    .select("*")
    .maybeSingle();

  if (error) return null;
  return data || null;
}

async function createDriverPayout(driverId) {
  if (!supabase || !clean(driverId)) return null;

  const { data: earnings, error } = await supabase
    .from("driver_earnings")
    .select("*")
    .eq("driver_id", clean(driverId))
    .neq("status", "paid");

  if (error) return null;

  const rows = earnings || [];
  if (!rows.length) return null;

  const total = rows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const earningIds = rows.map((row) => row.id);

  const { data: payout, error: payoutError } = await supabase
    .from("driver_payouts")
    .insert({
      id: id("payout"),
      driver_id: clean(driverId),
      amount: round(total),
      earning_ids: earningIds,
      status: "scheduled",
      created_at: now(),
      updated_at: now()
    })
    .select("*")
    .maybeSingle();

  if (payoutError || !payout) return null;

  await supabase
    .from("driver_earnings")
    .update({
      status: "paid",
      updated_at: now()
    })
    .in("id", earningIds);

  return payout;
}

/* ADMIN ROUTES */
app.get("/api/admin/rides", requireAdmin, async (req, res) => {
  try {
    const limit = Math.min(200, Math.max(1, Number(req.query.limit || 50)));
    const status = clean(req.query.status);

    let query = supabase
      .from("rides")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (status) {
      query = query.eq("status", status);
    }

    const { data, error } = await query;

    if (error) {
      return fail(res, error.message || "Failed to fetch rides", 500);
    }

    return ok(res, {
      rides: Array.isArray(data) ? data.map(publicRide) : []
    });
  } catch (error) {
    console.error("/api/admin/rides error:", error.message);
    return fail(res, "Failed to fetch rides", 500);
  }
});

app.get("/api/admin/drivers", requireAdmin, async (req, res) => {
  try {
    const limit = Math.min(200, Math.max(1, Number(req.query.limit || 50)));

    const { data, error } = await supabase
      .from("drivers")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      return fail(res, error.message || "Failed to fetch drivers", 500);
    }

    return ok(res, {
      drivers: (data || []).map((driver) => ({
        driver_id: driver.id,
        first_name: driver.first_name || null,
        last_name: driver.last_name || null,
        email: driver.email || null,
        phone: driver.phone || null,
        phone_verified: driverPhoneVerified(driver),
        approved: isDriverApproved(driver),
        is_online: !!driver.is_online,
        is_available: !!driver.is_available,
        driver_type: driver.driver_type || "human",
        status:
          driver.status ||
          driver.access_status ||
          driver.approval_status ||
          "unknown",
        created_at: driver.created_at || null
      }))
    });
  } catch (error) {
    console.error("/api/admin/drivers error:", error.message);
    return fail(res, "Failed to fetch drivers", 500);
  }
});

app.get("/api/admin/riders", requireAdmin, async (req, res) => {
  try {
    const limit = Math.min(200, Math.max(1, Number(req.query.limit || 50)));

    const { data, error } = await supabase
      .from("riders")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      return fail(res, error.message || "Failed to fetch riders", 500);
    }

    return ok(res, {
      riders: (data || []).map((rider) => ({
        rider_id: rider.id,
        first_name: rider.first_name || null,
        last_name: rider.last_name || null,
        email: rider.email || null,
        phone: rider.phone || null,
        phone_verified: riderPhoneVerified(rider),
        approved: isRiderApproved(rider),
        status:
          rider.status ||
          rider.access_status ||
          rider.approval_status ||
          rider.verification_status ||
          "unknown",
        created_at: rider.created_at || null
      }))
    });
  } catch (error) {
    console.error("/api/admin/riders error:", error.message);
    return fail(res, "Failed to fetch riders", 500);
  }
});

app.get("/api/admin/dashboard", requireAdmin, async (req, res) => {
  try {
    const counts = await getCounts();
    const rideStatuses = await getRideStatusBreakdown();
    const dispatchStatuses = await getDispatchStatusBreakdown();
    const revenue = await getRevenueSnapshot();

    return ok(res, {
      counts,
      ride_status_breakdown: rideStatuses,
      dispatch_status_breakdown: dispatchStatuses,
      revenue
    });
  } catch (error) {
    console.error("/api/admin/dashboard error:", error.message);
    return fail(res, "Failed to load dashboard", 500);
  }
});

app.get("/api/admin/rides/:rideId/timeline", requireAdmin, async (req, res) => {
  try {
    const rideId = clean(req.params.rideId);
    if (!rideId) return fail(res, "rideId is required", 400);

    let { data, error } = await supabase
      .from("trip_events")
      .select("*")
      .eq("ride_id", rideId)
      .order("created_at", { ascending: true });

    if (error) {
      const fallback = await supabase
        .from("trip_timelines")
        .select("*")
        .eq("ride_id", rideId)
        .order("created_at", { ascending: true });

      data = fallback.data || [];
      error = fallback.error || null;
    }

    if (error) {
      return fail(res, error.message || "Failed to fetch timeline", 500);
    }

    return ok(res, {
      timeline: data || []
    });
  } catch (error) {
    console.error("/api/admin/rides/:rideId/timeline error:", error.message);
    return fail(res, "Failed to fetch timeline", 500);
  }
});

app.get("/api/driver/:id/earnings", async (req, res) => {
  try {
    const driverId = clean(req.params.id);
    if (!driverId) return fail(res, "driver id required", 400);

    const { data, error } = await supabase
      .from("driver_earnings")
      .select("*")
      .eq("driver_id", driverId)
      .order("created_at", { ascending: false });

    if (error) {
      return fail(res, error.message || "Failed to fetch earnings", 500);
    }

    const earnings = data || [];
    const total = earnings.reduce((sum, row) => sum + Number(row.amount || 0), 0);
    const paid = earnings
      .filter((row) => lower(row.status) === "paid")
      .reduce((sum, row) => sum + Number(row.amount || 0), 0);
    const pending = earnings
      .filter((row) => lower(row.status) !== "paid")
      .reduce((sum, row) => sum + Number(row.amount || 0), 0);

    return ok(res, {
      driver_id: driverId,
      totals: {
        total_earnings: round(total),
        paid_earnings: round(paid),
        pending_earnings: round(pending)
      },
      earnings
    });
  } catch (error) {
    console.error("/api/driver/:id/earnings error:", error.message);
    return fail(res, "Failed to fetch earnings", 500);
  }
});

app.post("/api/admin/payouts/create", requireAdmin, async (req, res) => {
  try {
    const driverId = clean(req.body?.driver_id);
    if (!driverId) return fail(res, "driver_id is required", 400);

    const payout = await createDriverPayout(driverId);

    if (!payout) {
      return fail(res, "No pending earnings found", 400);
    }

    return ok(res, {
      message: "Driver payout created",
      payout
    });
  } catch (error) {
    console.error("/api/admin/payouts/create error:", error.message);
    return fail(res, "Failed to create payout", 500);
  }
});

app.get("/api/driver/:id/payouts", async (req, res) => {
  try {
    const driverId = clean(req.params.id);
    if (!driverId) return fail(res, "driver id required", 400);

    const { data, error } = await supabase
      .from("driver_payouts")
      .select("*")
      .eq("driver_id", driverId)
      .order("created_at", { ascending: false });

    if (error) {
      return fail(res, error.message || "Failed to fetch payouts", 500);
    }

    return ok(res, {
      driver_id: driverId,
      payouts: data || []
    });
  } catch (error) {
    console.error("/api/driver/:id/payouts error:", error.message);
    return fail(res, "Failed to fetch payouts", 500);
  }
});

app.post("/api/admin/test-email", requireAdmin, async (req, res) => {
  try {
    const to = clean(req.body?.to || ADMIN_EMAIL);

    const result = await sendEmail({
      to,
      subject: "Harvey Taxi Email Test",
      text: "Your Harvey Taxi email system is working."
    });

    return ok(res, {
      message: "Email test finished",
      result
    });
  } catch (error) {
    console.error("/api/admin/test-email error:", error.message);
    return fail(res, "Failed to test email", 500);
  }
});

/* STARTUP CHECKS */
async function runStartupChecks() {
  try {
    const counts = await getCounts();

    console.log("========================================");
    console.log("Harvey Taxi Code Blue Final Build");
    console.log("Started:", STARTED);
    console.log("Supabase:", !!supabase);
    console.log("Twilio:", !!twilioClient);
    console.log("Twilio Verify:", !!TWILIO_VERIFY);
    console.log("OpenAI:", !!openai);
    console.log("SMTP:", smtpReady());
    console.log("Counts:", counts);
    console.log("========================================");
  } catch (error) {
    console.warn("Startup checks failed:", error.message);
  }
}

/* FINAL 404 */
app.use((req, res) => {
  return fail(res, `Route not found: ${req.method} ${req.originalUrl}`, 404);
});

/* FINAL ERROR */
app.use((error, req, res, next) => {
  console.error("Unhandled server error:", error);
  return fail(res, error?.message || "Internal server error", error?.statusCode || 500);
});

/* SERVER START */
app.listen(PORT, async () => {
  console.log(`🚕 Harvey Taxi backend running on port ${PORT}`);
  await runStartupChecks();
});

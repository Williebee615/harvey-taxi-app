/* =========================================================
   HARVEY TAXI — TRUE CODE BLUE DELIVERY SERVER.JS
   PART 1 OF 9
   FOUNDATION + ENV + CLIENTS + HELPERS + DELIVERY CONFIG
   SENIOR DEVELOPER ENGINEER BUILD

   SERVICES INCLUDED:
   - Ride requests
   - Fast food delivery
   - Grocery delivery
   - Driver onboarding
   - Rider Persona gate
   - Driver Persona + Checkr
   - SendGrid email verification
   - Twilio SMS verification
   - Stripe payment authorization
   - Human driver + autonomous pilot compatibility
   - Mission-first dispatch
   - Admin operations
   - AI support
========================================================= */

"use strict";

/* =========================================================
   CORE IMPORTS
========================================================= */

const express = require("express");
const cors = require("cors");
const path = require("path");
const crypto = require("crypto");
const http = require("http");
const { createClient } = require("@supabase/supabase-js");

/* =========================================================
   OPTIONAL SERVICE IMPORTS
========================================================= */

let sgMail = null;
try {
  sgMail = require("@sendgrid/mail");
} catch {
  console.warn("⚠️ @sendgrid/mail not installed.");
}

let twilio = null;
try {
  twilio = require("twilio");
} catch {
  console.warn("⚠️ twilio not installed.");
}

let Stripe = null;
try {
  Stripe = require("stripe");
} catch {
  console.warn("⚠️ stripe not installed.");
}

let OpenAI = null;
try {
  OpenAI = require("openai");
} catch {
  console.warn("⚠️ openai not installed.");
}

/* =========================================================
   APP BOOT
========================================================= */

const app = express();
const server = http.createServer(app);

const NODE_ENV = process.env.NODE_ENV || "production";
const IS_PRODUCTION = NODE_ENV === "production";
const PORT = Number(process.env.PORT || 10000);

/* =========================================================
   ENV HELPERS
========================================================= */

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

/* =========================================================
   REQUIRED ENV
========================================================= */

const SUPABASE_URL = requireEnv("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = requireEnv("SUPABASE_SERVICE_ROLE_KEY");

/* =========================================================
   APP CONFIG
========================================================= */

const APP_NAME = "Harvey Taxi";

const APP_BASE_URL =
  env("PUBLIC_APP_URL") ||
  env("APP_BASE_URL") ||
  env("RENDER_EXTERNAL_URL") ||
  `http://localhost:${PORT}`;

const SUPPORT_EMAIL =
  env("SUPPORT_EMAIL") ||
  env("ADMIN_EMAIL") ||
  "williebee@harveytaxiservice.com";

const ADMIN_EMAIL = env("ADMIN_EMAIL", "williebee@harveytaxiservice.com");
const ADMIN_PASSWORD = env("ADMIN_PASSWORD", "");

/* =========================================================
   FEATURE FLAGS
========================================================= */

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

let twilioClient = null;

if (
  twilio &&
  ENABLE_REAL_SMS &&
  TWILIO_ACCOUNT_SID &&
  TWILIO_AUTH_TOKEN &&
  TWILIO_FROM_NUMBER
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
   PERSONA
========================================================= */

const PERSONA_API_KEY = env("PERSONA_API_KEY");
const PERSONA_WEBHOOK_SECRET = env("PERSONA_WEBHOOK_SECRET");

const PERSONA_TEMPLATE_ID_RIDER =
  env("PERSONA_TEMPLATE_ID_RIDER") ||
  env("PERSONA_RIDER_TEMPLATE_ID");

const PERSONA_TEMPLATE_ID_DRIVER =
  env("PERSONA_TEMPLATE_ID_DRIVER") ||
  env("PERSONA_DRIVER_TEMPLATE_ID");

if (PERSONA_API_KEY && ENABLE_PERSONA) {
  console.log("✅ Persona active");
} else {
  console.warn("⚠️ Persona inactive");
}

/* =========================================================
   CHECKR
========================================================= */

const CHECKR_API_KEY = env("CHECKR_API_KEY");
const CHECKR_WEBHOOK_SECRET = env("CHECKR_WEBHOOK_SECRET");

const CHECKR_PACKAGE = env("CHECKR_PACKAGE", "driver_standard");
const CHECKR_WORK_COUNTRY = env("CHECKR_WORK_COUNTRY", "US");
const CHECKR_WORK_STATE = env("CHECKR_WORK_STATE", "TN");
const CHECKR_WORK_CITY = env("CHECKR_WORK_CITY", "Nashville");

if (CHECKR_API_KEY && ENABLE_CHECKR) {
  console.log("✅ Checkr active");
} else {
  console.warn("⚠️ Checkr inactive");
}

/* =========================================================
   OPENAI
========================================================= */

const OPENAI_API_KEY = env("OPENAI_API_KEY");
const OPENAI_MODEL = env("OPENAI_MODEL", "gpt-4o-mini");

let openai = null;

if (OpenAI && OPENAI_API_KEY && ENABLE_AI_SUPPORT) {
  openai = new OpenAI({ apiKey: OPENAI_API_KEY });
  console.log("✅ OpenAI active");
} else {
  console.warn("⚠️ OpenAI inactive");
}

/* =========================================================
   MAPS
========================================================= */

const GOOGLE_MAPS_API_KEY = env("GOOGLE_MAPS_API_KEY");

/* =========================================================
   RIDE FARE CONFIG
========================================================= */

const BASE_FARE = envNumber("BASE_FARE", 5);
const PER_MILE_RATE = envNumber("PER_MILE_RATE", 2.25);
const PER_MINUTE_RATE = envNumber("PER_MINUTE_RATE", 0.35);
const BOOKING_FEE = envNumber("BOOKING_FEE", 2.5);
const MINIMUM_FARE = envNumber("MINIMUM_FARE", 8);
const DRIVER_PAYOUT_PERCENT = envNumber("DRIVER_PAYOUT_PERCENT", 0.78);

/* =========================================================
   DELIVERY FEE CONFIG
========================================================= */

const DELIVERY_BASE_FEE = envNumber("DELIVERY_BASE_FEE", 4.99);
const DELIVERY_PER_MILE_RATE = envNumber("DELIVERY_PER_MILE_RATE", 1.35);
const DELIVERY_PER_MINUTE_RATE = envNumber("DELIVERY_PER_MINUTE_RATE", 0.2);
const DELIVERY_SERVICE_FEE = envNumber("DELIVERY_SERVICE_FEE", 2.25);
const DELIVERY_SMALL_ORDER_FEE = envNumber("DELIVERY_SMALL_ORDER_FEE", 2.0);
const DELIVERY_SMALL_ORDER_THRESHOLD = envNumber("DELIVERY_SMALL_ORDER_THRESHOLD", 15);
const DELIVERY_MINIMUM_TOTAL = envNumber("DELIVERY_MINIMUM_TOTAL", 8.99);
const DELIVERY_DRIVER_PAYOUT_PERCENT = envNumber("DELIVERY_DRIVER_PAYOUT_PERCENT", 0.72);

const FOOD_DELIVERY_MULTIPLIER = envNumber("FOOD_DELIVERY_MULTIPLIER", 1.0);
const GROCERY_DELIVERY_MULTIPLIER = envNumber("GROCERY_DELIVERY_MULTIPLIER", 1.12);

const DELIVERY_DEFAULT_PREP_MINUTES = envNumber("DELIVERY_DEFAULT_PREP_MINUTES", 20);
const GROCERY_DEFAULT_SHOP_MINUTES = envNumber("GROCERY_DEFAULT_SHOP_MINUTES", 35);

/* =========================================================
   DISPATCH CONFIG
========================================================= */

const DISPATCH_TIMEOUT_SECONDS = envNumber("DISPATCH_TIMEOUT_SECONDS", 30);
const MAX_DISPATCH_ATTEMPTS = envNumber("MAX_DISPATCH_ATTEMPTS", 5);
const DRIVER_SEARCH_RADIUS_MILES = envNumber("DRIVER_SEARCH_RADIUS_MILES", 25);

const DELIVERY_DISPATCH_TIMEOUT_SECONDS = envNumber(
  "DELIVERY_DISPATCH_TIMEOUT_SECONDS",
  DISPATCH_TIMEOUT_SECONDS
);

const DELIVERY_SEARCH_RADIUS_MILES = envNumber(
  "DELIVERY_SEARCH_RADIUS_MILES",
  DRIVER_SEARCH_RADIUS_MILES
);

/* =========================================================
   SUPABASE
========================================================= */

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

/* =========================================================
   GENERAL HELPERS
========================================================= */

function nowIso() {
  return new Date().toISOString();
}

function addMinutes(minutes) {
  return new Date(Date.now() + minutes * 60 * 1000).toISOString();
}

function addSeconds(seconds) {
  return new Date(Date.now() + seconds * 1000).toISOString();
}

function safeTrim(value) {
  return String(value || "").trim();
}

function normalizeEmail(value) {
  return safeTrim(value).toLowerCase();
}

function normalizePhone(value) {
  const clean = safeTrim(value).replace(/[^\d+]/g, "");
  if (!clean) return "";
  if (clean.startsWith("+")) return clean;
  if (clean.length === 10) return `+1${clean}`;
  if (clean.length === 11 && clean.startsWith("1")) return `+${clean}`;
  return clean;
}

function normalizeText(value) {
  return safeTrim(value).replace(/\s+/g, " ");
}

function normalizeLower(value) {
  return normalizeText(value).toLowerCase();
}

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function cents(amount) {
  return Math.round(roundMoney(amount) * 100);
}

function createToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString("hex");
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function safeCompare(a, b) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));

  if (left.length !== right.length) return false;

  return crypto.timingSafeEqual(left, right);
}

function parseJsonMaybe(value, fallback = null) {
  if (!value) return fallback;

  if (typeof value === "object") return value;

  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

/* =========================================================
   RESPONSE HELPERS
========================================================= */

function ok(res, data = {}, status = 200) {
  return res.status(status).json({
    ok: true,
    ...data,
  });
}

function fail(res, status = 400, message = "Request failed", details = {}) {
  return res.status(status).json({
    ok: false,
    error: message,
    ...details,
  });
}

function serverError(res, error, message = "Internal server error") {
  console.error("❌", message, {
    message: error?.message,
    code: error?.code,
    status: error?.status,
    details: error?.details,
    stack: error?.stack,
  });

  return res.status(error?.status || 500).json({
    ok: false,
    error: error?.message || message,
  });
}

/* =========================================================
   DATABASE HELPERS
========================================================= */

async function dbInsert(table, payload) {
  const { data, error } = await supabase
    .from(table)
    .insert(payload)
    .select()
    .single();

  if (error) throw error;

  return data;
}

async function dbFindById(table, id) {
  if (!id) return null;

  const { data, error } = await supabase
    .from(table)
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;

  return data;
}

async function dbFindOne(table, column, value) {
  if (!value) return null;

  const { data, error } = await supabase
    .from(table)
    .select("*")
    .eq(column, value)
    .maybeSingle();

  if (error) throw error;

  return data;
}

async function dbUpdateById(table, id, payload) {
  const { data, error } = await supabase
    .from(table)
    .update({
      ...payload,
      updated_at: nowIso(),
    })
    .eq("id", id)
    .select()
    .single();

  if (error) throw error;

  return data;
}

async function dbList(table, queryBuilder = null) {
  let query = supabase.from(table).select("*");

  if (typeof queryBuilder === "function") {
    query = queryBuilder(query);
  }

  const { data, error } = await query;

  if (error) throw error;

  return data || [];
}

/* =========================================================
   AUDIT HELPERS
========================================================= */

async function auditLog(eventType, payload = {}) {
  try {
    await supabase.from("admin_logs").insert({
      event_type: eventType,
      payload,
      data: payload,
      created_at: nowIso(),
    });
  } catch (error) {
    console.warn("⚠️ auditLog failed:", error.message);
  }
}

async function rideEvent(rideId, eventType, payload = {}) {
  try {
    await supabase.from("trip_events").insert({
      ride_id: rideId,
      event_type: eventType,
      payload,
      data: payload,
      created_at: nowIso(),
    });
  } catch (error) {
    console.warn("⚠️ rideEvent failed:", error.message);
  }
}

async function deliveryEvent(deliveryId, eventType, payload = {}) {
  try {
    await supabase.from("delivery_status_events").insert({
      delivery_order_id: deliveryId,
      event_type: eventType,
      payload,
      data: payload,
      created_at: nowIso(),
    });
  } catch (error) {
    console.warn("⚠️ deliveryEvent failed:", error.message);
  }
}

/* =========================================================
   PUBLIC SHAPERS
========================================================= */

function publicDriver(driver = {}) {
  return {
    id: driver.id,
    first_name: driver.first_name || null,
    last_name: driver.last_name || null,
    full_name: driver.full_name,
    email: driver.email,
    phone: driver.phone,
    city: driver.city || null,
    state: driver.state || null,
    driver_type: driver.driver_type || "human",
    status: driver.status || "pending",
    approval_status: driver.approval_status || "pending",
    persona_inquiry_id: driver.persona_inquiry_id || null,
    persona_status: driver.persona_status || "not_started",
    email_verified: !!driver.email_verified,
    phone_verified: !!driver.phone_verified,
    checkr_status: driver.checkr_status || "not_started",
    available: !!driver.available,
    supports_rides: driver.supports_rides !== false,
    supports_food_delivery: driver.supports_food_delivery !== false,
    supports_grocery_delivery: driver.supports_grocery_delivery !== false,
  };
}

function publicRider(rider = {}) {
  return {
    id: rider.id,
    full_name: rider.full_name,
    email: rider.email,
    phone: rider.phone,
    status: rider.status || "pending",
    approval_status: rider.approval_status || "pending",
    verification_status: rider.verification_status || "pending",
    persona_inquiry_id: rider.persona_inquiry_id || null,
    persona_status: rider.persona_status || "not_started",
  };
}

function publicDeliveryOrder(order = {}) {
  return {
    id: order.id,
    rider_id: order.rider_id,
    driver_id: order.driver_id || null,
    service_type: order.service_type,
    status: order.status,
    pickup_address: order.pickup_address,
    dropoff_address: order.dropoff_address,
    store_name: order.store_name || null,
    restaurant_name: order.restaurant_name || null,
    subtotal: order.subtotal,
    delivery_fee: order.delivery_fee,
    service_fee: order.service_fee,
    total: order.total,
    driver_payout: order.driver_payout,
    scheduled_at: order.scheduled_at || null,
    created_at: order.created_at,
  };
}

/* =========================================================
   SERVICE TYPE HELPERS
========================================================= */

function normalizeServiceType(value) {
  const clean = normalizeLower(value || "ride");

  if (["food", "fast_food", "restaurant", "restaurant_delivery"].includes(clean)) {
    return "food";
  }

  if (["grocery", "groceries", "grocery_delivery"].includes(clean)) {
    return "grocery";
  }

  return "ride";
}

function isDeliveryService(serviceType) {
  const type = normalizeServiceType(serviceType);
  return type === "food" || type === "grocery";
}

function deliveryLabel(serviceType) {
  const type = normalizeServiceType(serviceType);

  if (type === "food") return "Fast Food Delivery";
  if (type === "grocery") return "Grocery Delivery";

  return "Ride";
}

/* =========================================================
   ADMIN AUTH
========================================================= */

function requireAdmin(req, res, next) {
  if (!ADMIN_PASSWORD) {
    return fail(res, 500, "ADMIN_PASSWORD is not configured.");
  }

  const email =
    normalizeEmail(req.headers["x-admin-email"]) ||
    normalizeEmail(req.body?.adminEmail) ||
    normalizeEmail(req.query?.adminEmail);

  const password =
    safeTrim(req.headers["x-admin-password"]) ||
    safeTrim(req.body?.adminPassword) ||
    safeTrim(req.query?.adminPassword);

  if (email !== normalizeEmail(ADMIN_EMAIL)) {
    return fail(res, 401, "Unauthorized admin email.");
  }

  if (!safeCompare(password, ADMIN_PASSWORD)) {
    return fail(res, 401, "Unauthorized admin password.");
  }

  req.admin = { email };

  return next();
}

/* =========================================================
   SENDGRID EMAIL HELPER
========================================================= */

async function sendEmail({ to, subject, text, html }) {
  if (!to) return { sent: false, reason: "missing_to" };

  if (!sgMail || !SENDGRID_API_KEY || !ENABLE_REAL_EMAIL) {
    console.log("📧 EMAIL MOCK:", { to, subject });
    return { sent: false, mock: true };
  }

  await sgMail.send({
    to,
    from: {
      email: SENDGRID_FROM_EMAIL,
      name: SENDGRID_FROM_NAME,
    },
    subject,
    text: text || subject,
    html: html || text || subject,
  });

  return { sent: true };
}

/* =========================================================
   TWILIO SMS HELPER — UPGRADED WITH REAL ERROR LOGS
========================================================= */

async function sendSms({ to, body }) {
  if (!to) return { sent: false, reason: "missing_to" };

  const cleanTo = normalizePhone(to);
  const cleanFrom = normalizePhone(TWILIO_FROM_NUMBER);

  if (!twilioClient || !ENABLE_REAL_SMS) {
    console.log("📱 SMS MOCK:", { to: cleanTo, body });
    return { sent: false, mock: true };
  }

  if (!cleanFrom) {
    throw new Error("TWILIO_FROM_NUMBER / TWILIO_PHONE_NUMBER is missing in Render.");
  }

  try {
    const message = await twilioClient.messages.create({
      to: cleanTo,
      from: cleanFrom,
      body,
    });

    console.log("✅ Twilio SMS sent:", {
      sid: message.sid,
      to: cleanTo,
      from: cleanFrom,
    });

    return {
      sent: true,
      sid: message.sid,
    };
  } catch (error) {
    console.error("❌ TWILIO SEND ERROR:", {
      message: error.message,
      code: error.code,
      status: error.status,
      moreInfo: error.moreInfo,
      to: cleanTo,
      from: cleanFrom,
    });

    throw new Error(`Twilio SMS failed: ${error.message || "Unknown Twilio error"}`);
  }
}

/* =========================================================
   PART 1 END
   NEXT: SEND TRUE DELIVERY SERVER PART 2
   Part 2 = Stripe webhook + middleware + health + Persona helpers
========================================================= *//* =========================================================
   HARVEY TAXI — TRUE CODE BLUE DELIVERY SERVER.JS
   PART 2 OF 9
   STRIPE WEBHOOK + MIDDLEWARE + HEALTH + PERSONA HELPERS
========================================================= */

/* =========================================================
   STRIPE WEBHOOK — MUST STAY BEFORE express.json()
========================================================= */

app.post(
  "/api/webhooks/stripe",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    try {
      if (!stripe || !STRIPE_WEBHOOK_SECRET) {
        return ok(res, {
          received: true,
          stripeConfigured: false,
        });
      }

      const signature = req.headers["stripe-signature"];

      let event;

      try {
        event = stripe.webhooks.constructEvent(
          req.body,
          signature,
          STRIPE_WEBHOOK_SECRET
        );
      } catch (error) {
        console.error("❌ Stripe webhook signature failed:", error.message);
        return res.status(400).send(`Webhook Error: ${error.message}`);
      }

      const object = event.data.object;

      if (event.type === "payment_intent.requires_capture") {
        await supabase
          .from("payments")
          .update({
            status: "requires_capture",
            stripe_latest_status: "requires_capture",
            updated_at: nowIso(),
          })
          .eq("stripe_payment_intent_id", object.id);
      }

      if (event.type === "payment_intent.succeeded") {
        const { data: payment } = await supabase
          .from("payments")
          .select("*")
          .eq("stripe_payment_intent_id", object.id)
          .maybeSingle();

        if (payment) {
          await dbUpdateById("payments", payment.id, {
            status: "succeeded",
            stripe_latest_status: "succeeded",
            captured_at: nowIso(),
            captured_amount: roundMoney(
              (object.amount_received || object.amount || 0) / 100
            ),
          });

          if (payment.ride_id) {
            await supabase
              .from("rides")
              .update({
                payment_status: "succeeded",
                updated_at: nowIso(),
              })
              .eq("id", payment.ride_id);

            await rideEvent(payment.ride_id, "payment_succeeded", {
              payment_id: payment.id,
              stripe_payment_intent_id: object.id,
            });
          }

          if (payment.delivery_order_id) {
            await supabase
              .from("delivery_orders")
              .update({
                payment_status: "succeeded",
                updated_at: nowIso(),
              })
              .eq("id", payment.delivery_order_id);

            await deliveryEvent(payment.delivery_order_id, "payment_succeeded", {
              payment_id: payment.id,
              stripe_payment_intent_id: object.id,
            });
          }

          if (payment.type === "tip") {
            await supabase
              .from("driver_earnings")
              .update({
                status: "pending",
                updated_at: nowIso(),
              })
              .eq("payment_id", payment.id)
              .eq("status", "awaiting_payment");
          }
        }
      }

      if (event.type === "payment_intent.payment_failed") {
        const updatePayload = {
          status: "failed",
          stripe_latest_status: "failed",
          failure_message:
            object.last_payment_error?.message || "Stripe payment failed.",
          updated_at: nowIso(),
        };

        const { data: payment } = await supabase
          .from("payments")
          .update(updatePayload)
          .eq("stripe_payment_intent_id", object.id)
          .select()
          .maybeSingle();

        if (payment?.ride_id) {
          await rideEvent(payment.ride_id, "payment_failed", {
            payment_id: payment.id,
            reason: updatePayload.failure_message,
          });
        }

        if (payment?.delivery_order_id) {
          await deliveryEvent(payment.delivery_order_id, "payment_failed", {
            payment_id: payment.id,
            reason: updatePayload.failure_message,
          });
        }
      }

      if (event.type === "payment_intent.canceled") {
        const { data: payment } = await supabase
          .from("payments")
          .update({
            status: "canceled",
            stripe_latest_status: "canceled",
            canceled_at: nowIso(),
            updated_at: nowIso(),
          })
          .eq("stripe_payment_intent_id", object.id)
          .select()
          .maybeSingle();

        if (payment?.ride_id) {
          await rideEvent(payment.ride_id, "payment_canceled", {
            payment_id: payment.id,
          });
        }

        if (payment?.delivery_order_id) {
          await deliveryEvent(payment.delivery_order_id, "payment_canceled", {
            payment_id: payment.id,
          });
        }
      }

      await auditLog("stripe_webhook_received", {
        type: event.type,
        payment_intent_id: object.id || null,
      });

      return ok(res, {
        received: true,
        type: event.type,
      });
    } catch (error) {
      return serverError(res, error, "Stripe webhook failed.");
    }
  }
);

/* =========================================================
   MIDDLEWARE — AFTER STRIPE RAW WEBHOOK
========================================================= */

app.set("trust proxy", 1);

app.use(
  cors({
    origin: true,
    credentials: true,
  })
);

app.use(express.json({ limit: "3mb" }));
app.use(express.urlencoded({ extended: true, limit: "3mb" }));

app.use((req, res, next) => {
  req.requestId = crypto.randomUUID();

  res.setHeader("X-Harvey-Taxi-Request-Id", req.requestId);
  res.setHeader("X-Harvey-Taxi-Version", "true-delivery-code-blue");

  next();
});

app.use(express.static(path.join(__dirname, "public")));

/* =========================================================
   BASE ROUTES
========================================================= */

app.get("/", (req, res) => {
  return res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/api/health", async (req, res) => {
  return ok(res, {
    app: APP_NAME,
    status: "online",
    version: "true-delivery-code-blue-9-part",
    environment: NODE_ENV,
    baseUrl: APP_BASE_URL,
    time: nowIso(),
    services: {
      supabase: true,
      sendgrid: !!(sgMail && SENDGRID_API_KEY && ENABLE_REAL_EMAIL),
      twilio: !!twilioClient,
      stripe: !!stripe,
      persona: !!(PERSONA_API_KEY && ENABLE_PERSONA),
      checkr: !!(CHECKR_API_KEY && ENABLE_CHECKR),
      openai: !!openai,
      googleMaps: !!GOOGLE_MAPS_API_KEY,
    },
    gates: {
      riderApproval: ENABLE_RIDER_APPROVAL_GATE,
      payment: ENABLE_PAYMENT_GATE,
      autoRedispatch: ENABLE_AUTO_REDISPATCH,
    },
    delivery: {
      enabled: ENABLE_DELIVERY,
      food: ENABLE_FOOD_DELIVERY,
      grocery: ENABLE_GROCERY_DELIVERY,
      baseFee: DELIVERY_BASE_FEE,
      perMile: DELIVERY_PER_MILE_RATE,
      perMinute: DELIVERY_PER_MINUTE_RATE,
    },
  });
});

app.get("/api/config/public", (req, res) => {
  return ok(res, {
    app: APP_NAME,
    baseUrl: APP_BASE_URL,
    supportEmail: SUPPORT_EMAIL,
    delivery: {
      enabled: ENABLE_DELIVERY,
      food: ENABLE_FOOD_DELIVERY,
      grocery: ENABLE_GROCERY_DELIVERY,
    },
    gates: {
      riderApproval: ENABLE_RIDER_APPROVAL_GATE,
      payment: ENABLE_PAYMENT_GATE,
    },
  });
});

/* =========================================================
   PERSONA API HELPERS
========================================================= */

async function personaRequest(pathname, options = {}) {
  if (!PERSONA_API_KEY || !ENABLE_PERSONA) {
    throw new Error("Persona is not configured.");
  }

  const response = await fetch(`https://withpersona.com/api/v1${pathname}`, {
    method: options.method || "GET",
    headers: {
      Authorization: `Bearer ${PERSONA_API_KEY}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(
      data?.errors?.[0]?.title ||
        data?.errors?.[0]?.detail ||
        "Persona API request failed."
    );
    error.status = response.status;
    error.details = data;
    throw error;
  }

  return data;
}

function personaTemplateForType(type) {
  if (type === "driver") return PERSONA_TEMPLATE_ID_DRIVER;
  return PERSONA_TEMPLATE_ID_RIDER;
}

function normalizePersonaStatus(status) {
  const clean = normalizeLower(status);

  if (["approved", "completed", "passed", "verified"].includes(clean)) {
    return "approved";
  }

  if (["declined", "failed", "rejected"].includes(clean)) {
    return "rejected";
  }

  if (["expired", "canceled", "cancelled"].includes(clean)) {
    return clean;
  }

  if (!clean) return "pending";

  return clean;
}

/* =========================================================
   CREATE PERSONA INQUIRY
========================================================= */

app.post("/api/persona/create-inquiry", async (req, res) => {
  try {
    const type = normalizeLower(req.body.type || req.body.user_type || "rider");
    const userId = safeTrim(req.body.user_id || req.body.userId);
    const email = normalizeEmail(req.body.email);
    const name = normalizeText(req.body.name || req.body.full_name || req.body.fullName);

    if (!["rider", "driver"].includes(type)) {
      return fail(res, 400, "Persona type must be rider or driver.");
    }

    if (!userId && !email) {
      return fail(res, 400, "User ID or email is required.");
    }

    if (!PERSONA_API_KEY || !ENABLE_PERSONA) {
      return fail(res, 503, "Persona is not configured.");
    }

    const templateId = personaTemplateForType(type);

    if (!templateId) {
      return fail(res, 500, `Persona template ID is missing for ${type}.`);
    }

    const table = type === "driver" ? "drivers" : "riders";

    const user = userId
      ? await dbFindById(table, userId)
      : await dbFindOne(table, "email", email);

    if (!user) {
      return fail(res, 404, `${type} not found.`);
    }

    if (user.persona_status === "approved") {
      return ok(res, {
        message: "Persona verification already approved.",
        type,
        user: type === "driver" ? publicDriver(user) : publicRider(user),
      });
    }

    const inquiry = await personaRequest("/inquiries", {
      method: "POST",
      body: {
        data: {
          type: "inquiry",
          attributes: {
            "inquiry-template-id": templateId,
            "reference-id": user.id,
            fields: {
              name: name || user.full_name || "",
              email: user.email || email || "",
              phone: user.phone || "",
            },
          },
        },
      },
    });

    const inquiryData = inquiry.data || {};
    const inquiryId = inquiryData.id;

    const inquiryStatus = normalizePersonaStatus(
      inquiryData.attributes?.status || "created"
    );

    await supabase
      .from(table)
      .update({
        persona_inquiry_id: inquiryId,
        persona_status: inquiryStatus,
        persona_template_id: templateId,
        updated_at: nowIso(),
      })
      .eq("id", user.id);

    await auditLog("persona_inquiry_created", {
      type,
      user_id: user.id,
      persona_inquiry_id: inquiryId,
      persona_status: inquiryStatus,
    });

    return ok(res, {
      message: "Persona inquiry created.",
      type,
      persona: {
        inquiryId,
        status: inquiryStatus,
        templateId,
        hostedUrl:
          inquiryData.attributes?.["hosted-url"] ||
          inquiryData.attributes?.hosted_url ||
          null,
      },
    });
  } catch (error) {
    return serverError(res, error, "Could not create Persona inquiry.");
  }
});

/* =========================================================
   PERSONA COMPATIBILITY ROUTES
========================================================= */

app.post("/api/persona/rider/create-inquiry", (req, res) => {
  req.body.type = "rider";
  req.url = "/api/persona/create-inquiry";
  return app._router.handle(req, res);
});

app.post("/api/persona/driver/create-inquiry", (req, res) => {
  req.body.type = "driver";
  req.url = "/api/persona/create-inquiry";
  return app._router.handle(req, res);
});

/* =========================================================
   PERSONA WEBHOOK HELPERS
========================================================= */

function verifyPersonaWebhook(req) {
  if (!PERSONA_WEBHOOK_SECRET) return true;

  const signature =
    req.headers["persona-signature"] ||
    req.headers["x-persona-signature"] ||
    "";

  if (!signature) return false;

  const rawPayload = JSON.stringify(req.body || {});

  const expected = crypto
    .createHmac("sha256", PERSONA_WEBHOOK_SECRET)
    .update(rawPayload)
    .digest("hex");

  return safeCompare(signature, expected);
}

function extractPersonaInquiry(payload = {}) {
  const data = payload.data || {};
  const attributes = data.attributes || {};
  const included = Array.isArray(payload.included) ? payload.included : [];

  const inquiryId =
    data.id ||
    attributes.id ||
    attributes["inquiry-id"] ||
    attributes.inquiry_id ||
    null;

  const status = normalizePersonaStatus(
    attributes.status ||
      attributes["status"] ||
      attributes["inquiry-status"] ||
      "pending"
  );

  const referenceId =
    attributes["reference-id"] ||
    attributes.reference_id ||
    attributes.referenceId ||
    null;

  let templateId =
    attributes["inquiry-template-id"] ||
    attributes.inquiry_template_id ||
    attributes.template_id ||
    null;

  if (!templateId) {
    const template = included.find((item) => item.type === "inquiry-template");
    templateId = template?.id || null;
  }

  return {
    inquiryId,
    status,
    referenceId,
    templateId,
    rawAttributes: attributes,
  };
}

function inferPersonaUserType({ templateId, payload }) {
  const template = safeTrim(templateId);

  if (template && template === PERSONA_TEMPLATE_ID_DRIVER) return "driver";
  if (template && template === PERSONA_TEMPLATE_ID_RIDER) return "rider";

  const eventType = normalizeLower(
    payload?.data?.attributes?.name || payload?.type || ""
  );

  if (eventType.includes("driver")) return "driver";
  if (eventType.includes("rider")) return "rider";

  return null;
}

/* =========================================================
   PERSONA WEBHOOK
========================================================= */

app.post("/api/webhooks/persona", async (req, res) => {
  try {
    if (!verifyPersonaWebhook(req)) {
      return fail(res, 401, "Invalid Persona webhook signature.");
    }

    const eventType = normalizeText(
      req.body?.data?.attributes?.name || req.body?.type || "persona_event"
    );

    const inquiry = extractPersonaInquiry(req.body);

    const inferredType = inferPersonaUserType({
      templateId: inquiry.templateId,
      payload: req.body,
    });

    let table =
      inferredType === "driver"
        ? "drivers"
        : inferredType === "rider"
          ? "riders"
          : null;

    let user = null;

    if (table && inquiry.referenceId) {
      user = await dbFindById(table, inquiry.referenceId);
    }

    if (!user && inquiry.inquiryId) {
      const driver = await dbFindOne("drivers", "persona_inquiry_id", inquiry.inquiryId);
      if (driver) {
        table = "drivers";
        user = driver;
      }
    }

    if (!user && inquiry.inquiryId) {
      const rider = await dbFindOne("riders", "persona_inquiry_id", inquiry.inquiryId);
      if (rider) {
        table = "riders";
        user = rider;
      }
    }

    if (!user) {
      await auditLog("persona_webhook_unmatched", {
        event_type: eventType,
        inquiry_id: inquiry.inquiryId,
        reference_id: inquiry.referenceId,
        template_id: inquiry.templateId,
        status: inquiry.status,
      });

      return ok(res, {
        received: true,
        matchedUser: false,
      });
    }

    const updatePayload = {
      persona_inquiry_id: inquiry.inquiryId || user.persona_inquiry_id || null,
      persona_status: inquiry.status,
      persona_last_event: eventType,
      persona_last_payload: req.body,
      updated_at: nowIso(),
    };

    if (table === "riders") {
      if (inquiry.status === "approved") {
        updatePayload.verification_status = "approved";
        updatePayload.approval_status = "approved";
        updatePayload.status = "approved";
        updatePayload.approved_at = nowIso();
      }

      if (inquiry.status === "rejected") {
        updatePayload.verification_status = "rejected";
        updatePayload.approval_status = "rejected";
        updatePayload.status = "rejected";
      }
    }

    if (table === "drivers") {
      if (inquiry.status === "approved") {
        updatePayload.identity_verified = true;
        updatePayload.status = user.phone_verified
          ? "identity_verified"
          : user.status || "email_verified";
      }

      if (inquiry.status === "rejected") {
        updatePayload.identity_verified = false;
        updatePayload.approval_status = "manual_review";
        updatePayload.status = "manual_review";
        updatePayload.review_reason = "Persona identity verification rejected.";
      }
    }

    await supabase.from(table).update(updatePayload).eq("id", user.id);

    await auditLog("persona_webhook_user_updated", {
      table,
      user_id: user.id,
      event_type: eventType,
      inquiry_id: inquiry.inquiryId,
      persona_status: inquiry.status,
    });

    return ok(res, {
      received: true,
      matchedUser: true,
      table,
      userId: user.id,
      personaStatus: inquiry.status,
    });
  } catch (error) {
    return serverError(res, error, "Persona webhook failed.");
  }
});

/* =========================================================
   PERSONA STATUS
========================================================= */

app.get("/api/persona/status", async (req, res) => {
  try {
    const type = normalizeLower(req.query.type || req.query.user_type);
    const userId = safeTrim(req.query.user_id || req.query.userId);
    const email = normalizeEmail(req.query.email);

    if (!["rider", "driver"].includes(type)) {
      return fail(res, 400, "Persona type must be rider or driver.");
    }

    if (!userId && !email) {
      return fail(res, 400, "User ID or email is required.");
    }

    const table = type === "driver" ? "drivers" : "riders";

    const user = userId
      ? await dbFindById(table, userId)
      : await dbFindOne(table, "email", email);

    if (!user) {
      return fail(res, 404, `${type} not found.`);
    }

    return ok(res, {
      type,
      persona: {
        inquiryId: user.persona_inquiry_id || null,
        status: user.persona_status || "not_started",
        templateId: user.persona_template_id || null,
      },
      user: type === "driver" ? publicDriver(user) : publicRider(user),
    });
  } catch (error) {
    return serverError(res, error, "Could not load Persona status.");
  }
});

/* =========================================================
   PART 2 END
   NEXT: SEND TRUE DELIVERY SERVER PART 3
   Part 3 = Driver signup + email verification + SMS verification
========================================================= *//* =========================================================
   HARVEY TAXI — TRUE CODE BLUE DELIVERY SERVER.JS
   PART 3 OF 9
   DRIVER SIGNUP + EMAIL VERIFY + SMS VERIFY
========================================================= */

/* =========================================================
   DRIVER EMAIL TEMPLATE
========================================================= */

function driverVerificationEmailHtml({ driverName, verifyUrl }) {
  return `
    <div style="font-family:Arial,sans-serif;background:#f6f8fb;padding:24px;">
      <div style="max-width:640px;margin:auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:18px;padding:30px;">
        <h2 style="color:#0f172a;">Verify your Harvey Taxi driver email</h2>
        <p style="color:#334155;">Hello ${driverName || "Driver"},</p>
        <p style="color:#334155;">Please verify your email address to continue driver onboarding.</p>
        <p style="margin:28px 0;">
          <a href="${verifyUrl}" style="background:#2563eb;color:#ffffff;text-decoration:none;padding:14px 22px;border-radius:10px;font-weight:bold;">
            Verify Email
          </a>
        </p>
        <p style="font-size:13px;color:#64748b;">This link expires in 24 hours.</p>
        <p style="font-size:13px;color:#64748b;">${verifyUrl}</p>
      </div>
    </div>
  `;
}

/* =========================================================
   DRIVER VERIFICATION EMAIL
========================================================= */

async function sendDriverEmailVerification(driver) {
  const rawToken = createToken(32);
  const tokenHash = sha256(rawToken);
  const expiresAt = addMinutes(60 * 24);

  await supabase
    .from("drivers")
    .update({
      email_verification_token_hash: tokenHash,
      email_verification_expires_at: expiresAt,
      email_verified: false,
      updated_at: nowIso(),
    })
    .eq("id", driver.id);

  const verifyUrl =
    `${APP_BASE_URL}/api/drivers/verify-email` +
    `?driverId=${encodeURIComponent(driver.id)}` +
    `&token=${encodeURIComponent(rawToken)}`;

  const result = await sendEmail({
    to: driver.email,
    subject: "Verify your Harvey Taxi driver email",
    text: `Verify your Harvey Taxi driver email: ${verifyUrl}`,
    html: driverVerificationEmailHtml({
      driverName: driver.full_name,
      verifyUrl,
    }),
  });

  return {
    ...result,
    verifyUrl,
  };
}

/* =========================================================
   DRIVER SIGNUP
========================================================= */

app.post("/api/drivers/signup", async (req, res) => {
  try {
    const firstName = normalizeText(req.body.first_name || req.body.firstName);
    const lastName = normalizeText(req.body.last_name || req.body.lastName);

    const fullName = normalizeText(
      req.body.full_name ||
        req.body.fullName ||
        `${firstName} ${lastName}`
    );

    const email = normalizeEmail(req.body.email);
    const phone = normalizePhone(req.body.phone);

    if (!fullName || !email || !phone) {
      return fail(res, 400, "Full name, email, and phone are required.");
    }

    if (!email.includes("@")) {
      return fail(res, 400, "A valid email address is required.");
    }

    if (phone.replace(/\D/g, "").length < 10) {
      return fail(res, 400, "A valid phone number is required.");
    }

    const existing = await dbFindOne("drivers", "email", email);

    if (existing) {
      if (!existing.email_verified) {
        const resend = await sendDriverEmailVerification(existing);

        return ok(res, {
          message: "Driver already exists. Verification email resent.",
          driver: publicDriver(existing),
          emailVerificationSent: !!resend.sent,
          devVerifyUrl: resend.mock ? resend.verifyUrl : undefined,
          nextSteps: [
            "Verify email",
            "Verify phone by SMS",
            "Complete Persona identity verification",
            "Complete Checkr background check",
            "Wait for admin approval",
          ],
        });
      }

      return ok(res, {
        message: "Driver already exists.",
        driver: publicDriver(existing),
        nextSteps: [
          existing.phone_verified ? "Phone already verified" : "Verify phone by SMS",
          "Complete Persona identity verification",
          "Complete Checkr background check",
          "Wait for admin approval",
        ],
      });
    }

    const consents = {
      termsAccepted:
        !!req.body.terms_accepted ||
        !!req.body.accepted_terms ||
        !!req.body.consents?.termsAccepted,
      backgroundCheckAccepted:
        !!req.body.background_check_accepted ||
        !!req.body.accepted_background_check_consent ||
        !!req.body.consents?.backgroundCheckAccepted,
      insuranceConfirmed:
        !!req.body.insurance_confirmed ||
        !!req.body.accepted_driver_policy ||
        !!req.body.consents?.insuranceConfirmed,
    };

    if (!consents.termsAccepted) {
      return fail(res, 400, "Driver terms must be accepted.");
    }

    if (!consents.backgroundCheckAccepted) {
      return fail(res, 400, "Background-check consent must be accepted.");
    }

    if (!consents.insuranceConfirmed) {
      return fail(res, 400, "Insurance acknowledgment must be accepted.");
    }

    const driver = await dbInsert("drivers", {
      first_name: firstName || null,
      last_name: lastName || null,
      full_name: fullName,

      email,
      phone,

      city: normalizeText(req.body.city) || null,
      state: normalizeText(req.body.state) || null,
      zipcode: normalizeText(req.body.zipcode || req.body.zip) || null,

      license_number:
        normalizeText(req.body.license_number || req.body.licenseNumber) || null,
      drivers_license_number:
        normalizeText(
          req.body.drivers_license_number ||
            req.body.license_number ||
            req.body.licenseNumber
        ) || null,

      vehicle_make:
        normalizeText(req.body.vehicle_make || req.body.vehicleMake) || null,
      vehicle_model:
        normalizeText(req.body.vehicle_model || req.body.vehicleModel) || null,
      vehicle_year:
        normalizeText(req.body.vehicle_year || req.body.vehicleYear) || null,
      vehicle_color:
        normalizeText(req.body.vehicle_color || req.body.vehicleColor) || null,
      license_plate:
        normalizeText(req.body.license_plate || req.body.licensePlate) || null,

      driver_type:
        normalizeLower(req.body.driver_type || req.body.driverType || "human"),

      supports_rides: req.body.supports_rides !== false,
      supports_food_delivery: req.body.supports_food_delivery !== false,
      supports_grocery_delivery: req.body.supports_grocery_delivery !== false,

      terms_accepted: consents.termsAccepted,
      background_check_accepted: consents.backgroundCheckAccepted,
      insurance_confirmed: consents.insuranceConfirmed,
      consents,

      email_verified: false,
      phone_verified: false,

      persona_status: "not_started",
      identity_verified: false,

      checkr_status: "not_started",
      approval_status: "pending",
      status: "pending_email_verification",

      available: false,
      current_ride_id: null,
      current_delivery_order_id: null,

      preferred_score: 0,

      created_at: nowIso(),
      updated_at: nowIso(),
    });

    const emailResult = await sendDriverEmailVerification(driver);

    await auditLog("driver_signup_created", {
      driver_id: driver.id,
      email,
      phone,
      email_sent: !!emailResult.sent,
      email_mock: !!emailResult.mock,
    });

    return ok(
      res,
      {
        message: "Driver signup received. Email verification sent.",
        driver: publicDriver(driver),
        emailVerificationSent: !!emailResult.sent,
        emailMock: !!emailResult.mock,
        devVerifyUrl: emailResult.mock ? emailResult.verifyUrl : undefined,
        nextSteps: [
          "Verify email",
          "Verify phone by SMS",
          "Complete Persona identity verification",
          "Complete Checkr background check",
          "Wait for admin approval",
        ],
      },
      201
    );
  } catch (error) {
    return serverError(res, error, "Driver signup failed.");
  }
});

/* =========================================================
   DRIVER EMAIL VERIFY
========================================================= */

app.get("/api/drivers/verify-email", async (req, res) => {
  try {
    const driverId = safeTrim(req.query.driverId || req.query.driver_id);
    const rawToken = safeTrim(req.query.token);

    if (!driverId || !rawToken) {
      return res.status(400).send("Missing driver ID or token.");
    }

    const driver = await dbFindById("drivers", driverId);

    if (!driver) {
      return res.status(404).send("Driver not found.");
    }

    if (driver.email_verified) {
      return res.send(`
        <html>
          <body style="font-family:Arial;padding:32px;background:#f8fafc;">
            <div style="max-width:680px;margin:auto;background:white;padding:28px;border-radius:16px;">
              <h2>Email already verified</h2>
              <p>Your Harvey Taxi driver email is already verified.</p>
              <p><a href="${APP_BASE_URL}/driver-signup.html">Return to Driver Signup</a></p>
            </div>
          </body>
        </html>
      `);
    }

    if (!driver.email_verification_token_hash) {
      return res.status(400).send("No email verification token found.");
    }

    if (
      driver.email_verification_expires_at &&
      new Date(driver.email_verification_expires_at).getTime() < Date.now()
    ) {
      return res.status(401).send("Verification link expired.");
    }

    const tokenOk = safeCompare(
      sha256(rawToken),
      driver.email_verification_token_hash
    );

    if (!tokenOk) {
      return res.status(401).send("Invalid verification token.");
    }

    const updated = await dbUpdateById("drivers", driver.id, {
      email_verified: true,
      status: driver.phone_verified ? "phone_verified" : "email_verified",
      email_verification_token_hash: null,
      email_verification_expires_at: null,
      email_verified_at: nowIso(),
    });

    await auditLog("driver_email_verified", {
      driver_id: updated.id,
      email: updated.email,
    });

    return res.send(`
      <html>
        <body style="font-family:Arial;padding:32px;background:#f8fafc;color:#0f172a;">
          <div style="max-width:680px;margin:auto;background:white;border:1px solid #e2e8f0;border-radius:16px;padding:30px;">
            <h2>✅ Email verified</h2>
            <p>Your Harvey Taxi driver email has been verified.</p>
            <p>Return to the app to complete SMS verification, Persona identity verification, and background screening.</p>
            <p>
              <a href="${APP_BASE_URL}/driver-signup.html" style="background:#2563eb;color:white;padding:12px 18px;border-radius:10px;text-decoration:none;">
                Return to Driver Verification
              </a>
            </p>
          </div>
        </body>
      </html>
    `);
  } catch (error) {
    console.error("Driver email verification failed:", error);
    return res.status(500).send("Driver email verification failed.");
  }
});

/* =========================================================
   RESEND DRIVER EMAIL VERIFICATION
========================================================= */

app.post("/api/drivers/resend-email-verification", async (req, res) => {
  try {
    const driverId = safeTrim(req.body.driverId || req.body.driver_id);
    const email = normalizeEmail(req.body.email);

    if (!driverId && !email) {
      return fail(res, 400, "Driver ID or email is required.");
    }

    const driver = driverId
      ? await dbFindById("drivers", driverId)
      : await dbFindOne("drivers", "email", email);

    if (!driver) {
      return fail(res, 404, "Driver not found.");
    }

    if (driver.email_verified) {
      return ok(res, {
        message: "Driver email is already verified.",
        driver: publicDriver(driver),
      });
    }

    const emailResult = await sendDriverEmailVerification(driver);

    await auditLog("driver_email_verification_resent", {
      driver_id: driver.id,
      email: driver.email,
      email_sent: !!emailResult.sent,
      email_mock: !!emailResult.mock,
    });

    return ok(res, {
      message: "Driver email verification resent.",
      driver: publicDriver(driver),
      emailVerificationSent: !!emailResult.sent,
      emailMock: !!emailResult.mock,
      devVerifyUrl: emailResult.mock ? emailResult.verifyUrl : undefined,
    });
  } catch (error) {
    return serverError(res, error, "Could not resend driver email verification.");
  }
});

/* =========================================================
   DRIVER SMS CODE SEND
========================================================= */

app.post("/api/drivers/send-sms-code", async (req, res) => {
  try {
    const driverId = safeTrim(req.body.driverId || req.body.driver_id);
    const email = normalizeEmail(req.body.email);

    if (!driverId && !email) {
      return fail(res, 400, "Driver ID or email is required.");
    }

    const driver = driverId
      ? await dbFindById("drivers", driverId)
      : await dbFindOne("drivers", "email", email);

    if (!driver) {
      return fail(res, 404, "Driver not found.");
    }

    if (!driver.email_verified) {
      return fail(res, 403, "Email must be verified before SMS verification.");
    }

    if (driver.phone_verified) {
      return ok(res, {
        message: "Driver phone is already verified.",
        driver: publicDriver(driver),
      });
    }

    const code = String(Math.floor(100000 + Math.random() * 900000));
    const codeHash = sha256(code);
    const expiresAt = addMinutes(10);

    await supabase
      .from("drivers")
      .update({
        phone_verification_code_hash: codeHash,
        phone_verification_expires_at: expiresAt,
        updated_at: nowIso(),
      })
      .eq("id", driver.id);

    const smsResult = await sendSms({
      to: driver.phone,
      body: `Your Harvey Taxi driver verification code is ${code}. It expires in 10 minutes.`,
    });

    await auditLog("driver_sms_code_sent", {
      driver_id: driver.id,
      phone: driver.phone,
      sms_sent: !!smsResult.sent,
      sms_mock: !!smsResult.mock,
      twilio_sid: smsResult.sid || null,
    });

    return ok(res, {
      message: "Driver SMS verification code sent.",
      smsSent: !!smsResult.sent,
      smsMock: !!smsResult.mock,
      twilioSid: smsResult.sid || null,
      expiresAt,
      devCode: smsResult.mock ? code : undefined,
    });
  } catch (error) {
    console.error("❌ Driver SMS route failed:", {
      message: error.message,
      code: error.code,
      status: error.status,
      stack: error.stack,
    });

    return fail(
      res,
      error.status || 500,
      error.message || "Could not send driver SMS verification code."
    );
  }
});

/* =========================================================
   DRIVER SMS CODE VERIFY
========================================================= */

app.post("/api/drivers/verify-sms-code", async (req, res) => {
  try {
    const driverId = safeTrim(req.body.driverId || req.body.driver_id);
    const email = normalizeEmail(req.body.email);
    const code = safeTrim(req.body.code);

    if ((!driverId && !email) || !code) {
      return fail(res, 400, "Driver ID/email and verification code are required.");
    }

    const driver = driverId
      ? await dbFindById("drivers", driverId)
      : await dbFindOne("drivers", "email", email);

    if (!driver) {
      return fail(res, 404, "Driver not found.");
    }

    if (driver.phone_verified) {
      return ok(res, {
        message: "Driver phone is already verified.",
        driver: publicDriver(driver),
      });
    }

    if (!driver.phone_verification_code_hash) {
      return fail(res, 400, "No SMS verification code found. Please resend code.");
    }

    if (
      driver.phone_verification_expires_at &&
      new Date(driver.phone_verification_expires_at).getTime() < Date.now()
    ) {
      return fail(res, 401, "SMS verification code expired. Please resend code.");
    }

    const codeOk = safeCompare(
      sha256(code),
      driver.phone_verification_code_hash
    );

    if (!codeOk) {
      return fail(res, 401, "Invalid SMS verification code.");
    }

    const updated = await dbUpdateById("drivers", driver.id, {
      phone_verified: true,
      phone_verification_code_hash: null,
      phone_verification_expires_at: null,
      phone_verified_at: nowIso(),
      status: "phone_verified",
    });

    await auditLog("driver_phone_verified", {
      driver_id: updated.id,
      phone: updated.phone,
    });

    return ok(res, {
      message: "Driver phone verified.",
      driver: publicDriver(updated),
    });
  } catch (error) {
    return serverError(res, error, "Could not verify driver SMS code.");
  }
});

/* =========================================================
   DRIVER STATUS
========================================================= */

app.get("/api/drivers/status", async (req, res) => {
  try {
    const driverId = safeTrim(
      req.query.driverId || req.query.driver_id || req.query.id
    );

    const email = normalizeEmail(req.query.email);

    if (!driverId && !email) {
      return fail(res, 400, "Driver ID or email is required.");
    }

    const driver = driverId
      ? await dbFindById("drivers", driverId)
      : await dbFindOne("drivers", "email", email);

    if (!driver) {
      return fail(res, 404, "Driver not found.");
    }

    const identityOk =
      driver.identity_verified === true ||
      driver.persona_status === "approved";

    const checkrOk = [
      "report_clear",
      "clear",
      "completed",
      "complete",
      "invitation_completed",
    ].includes(driver.checkr_status);

    const canAcceptMissions =
      !!driver.email_verified &&
      !!driver.phone_verified &&
      identityOk &&
      checkrOk &&
      driver.approval_status === "approved";

    return ok(res, {
      driver: publicDriver(driver),
      onboarding: {
        emailVerified: !!driver.email_verified,
        phoneVerified: !!driver.phone_verified,
        personaStatus: driver.persona_status || "not_started",
        identityVerified: identityOk,
        checkrStatus: driver.checkr_status || "not_started",
        approvalStatus: driver.approval_status || "pending",
      },
      capabilities: {
        rides: driver.supports_rides !== false,
        foodDelivery: driver.supports_food_delivery !== false,
        groceryDelivery: driver.supports_grocery_delivery !== false,
      },
      canAcceptMissions,
    });
  } catch (error) {
    return serverError(res, error, "Could not load driver status.");
  }
});

/* =========================================================
   DRIVER COMPATIBILITY ROUTES
========================================================= */

app.post("/api/driver/signup", (req, res) => {
  req.url = "/api/drivers/signup";
  return app._router.handle(req, res);
});

app.post("/api/driver/send-sms-code", (req, res) => {
  req.url = "/api/drivers/send-sms-code";
  return app._router.handle(req, res);
});

app.post("/api/driver/verify-sms-code", (req, res) => {
  req.url = "/api/drivers/verify-sms-code";
  return app._router.handle(req, res);
});

app.post("/api/driver/resend-email-verification", (req, res) => {
  req.url = "/api/drivers/resend-email-verification";
  return app._router.handle(req, res);
});

app.get("/api/driver/status", (req, res) => {
  req.url = "/api/drivers/status";
  return app._router.handle(req, res);
});

/* =========================================================
   PART 3 END
   NEXT: SEND TRUE DELIVERY SERVER PART 4
   Part 4 = Rider signup + rider Persona gate + Checkr driver approval
========================================================= *//* =========================================================
   HARVEY TAXI — TRUE CODE BLUE DELIVERY SERVER.JS
   PART 4 OF 9
   RIDER SIGNUP + RIDER PERSONA GATE + DRIVER PERSONA
   CHECKR + DRIVER/RIDER APPROVAL
========================================================= */

/* =========================================================
   RIDER SIGNUP
========================================================= */

app.post("/api/riders/signup", async (req, res) => {
  try {
    const fullName = normalizeText(req.body.full_name || req.body.fullName);
    const email = normalizeEmail(req.body.email);
    const phone = normalizePhone(req.body.phone);

    if (!fullName || !email || !phone) {
      return fail(res, 400, "Full name, email, and phone are required.");
    }

    const existing = await dbFindOne("riders", "email", email);

    if (existing) {
      return ok(res, {
        message: "Rider already exists.",
        rider: publicRider(existing),
        canRequestRide: riderPersonaApproved(existing),
        canRequestDelivery: riderPersonaApproved(existing),
      });
    }

    const rider = await dbInsert("riders", {
      full_name: fullName,
      email,
      phone,
      persona_status: "not_started",
      verification_status: "pending",
      approval_status: "pending",
      status: "pending_persona_verification",
      created_at: nowIso(),
      updated_at: nowIso(),
    });

    await auditLog("rider_signup_created", {
      rider_id: rider.id,
      email,
    });

    return ok(res, {
      message: "Rider signup received. Persona verification is required before rides or delivery.",
      rider: publicRider(rider),
      nextSteps: [
        "Start Persona identity verification",
        "Complete identity verification",
        "Request rides, fast food delivery, or grocery delivery after approval",
      ],
    }, 201);
  } catch (error) {
    return serverError(res, error, "Rider signup failed.");
  }
});

/* =========================================================
   RIDER PERSONA APPROVAL GATE
========================================================= */

function riderPersonaApproved(rider = {}) {
  return (
    rider.persona_status === "approved" ||
    rider.verification_status === "approved" ||
    rider.approval_status === "approved" ||
    rider.status === "approved"
  );
}

async function assertRiderApproved(riderId) {
  const rider = await dbFindById("riders", riderId);

  if (!rider) {
    const error = new Error("Rider not found.");
    error.status = 404;
    throw error;
  }

  if (ENABLE_RIDER_APPROVAL_GATE && !riderPersonaApproved(rider)) {
    const error = new Error("Rider Persona verification must be approved before requesting rides or delivery.");
    error.status = 403;
    throw error;
  }

  return rider;
}

/* =========================================================
   START RIDER PERSONA
========================================================= */

app.post("/api/riders/start-persona", async (req, res) => {
  try {
    const riderId = safeTrim(req.body.riderId || req.body.rider_id);
    const email = normalizeEmail(req.body.email);

    if (!riderId && !email) {
      return fail(res, 400, "Rider ID or email is required.");
    }

    const rider = riderId
      ? await dbFindById("riders", riderId)
      : await dbFindOne("riders", "email", email);

    if (!rider) return fail(res, 404, "Rider not found.");

    if (rider.persona_status === "approved") {
      return ok(res, {
        message: "Rider Persona verification already approved.",
        rider: publicRider(rider),
      });
    }

    req.body.type = "rider";
    req.body.user_id = rider.id;
    req.body.email = rider.email;
    req.body.name = rider.full_name;
    req.url = "/api/persona/create-inquiry";
    return app._router.handle(req, res);
  } catch (error) {
    return serverError(res, error, "Could not start rider Persona verification.");
  }
});

/* =========================================================
   RIDER STATUS
========================================================= */

app.get("/api/riders/status", async (req, res) => {
  try {
    const riderId = safeTrim(req.query.riderId || req.query.rider_id || req.query.id);
    const email = normalizeEmail(req.query.email);

    if (!riderId && !email) {
      return fail(res, 400, "Rider ID or email is required.");
    }

    const rider = riderId
      ? await dbFindById("riders", riderId)
      : await dbFindOne("riders", "email", email);

    if (!rider) return fail(res, 404, "Rider not found.");

    const approved = riderPersonaApproved(rider);

    return ok(res, {
      rider: publicRider(rider),
      persona: {
        inquiryId: rider.persona_inquiry_id || null,
        status: rider.persona_status || "not_started",
        approved,
      },
      approved,
      canRequestRide: ENABLE_RIDER_APPROVAL_GATE ? approved : true,
      canRequestDelivery: ENABLE_RIDER_APPROVAL_GATE ? approved : true,
    });
  } catch (error) {
    return serverError(res, error, "Could not load rider status.");
  }
});

/* =========================================================
   RIDER COMPATIBILITY ROUTES
========================================================= */

app.post("/api/rider/signup", (req, res) => {
  req.url = "/api/riders/signup";
  return app._router.handle(req, res);
});

app.post("/api/rider/start-persona", (req, res) => {
  req.url = "/api/riders/start-persona";
  return app._router.handle(req, res);
});

app.get("/api/rider/status", (req, res) => {
  req.url = "/api/riders/status";
  return app._router.handle(req, res);
});

/* =========================================================
   START DRIVER PERSONA
========================================================= */

app.post("/api/drivers/start-persona", async (req, res) => {
  try {
    const driverId = safeTrim(req.body.driverId || req.body.driver_id);
    const email = normalizeEmail(req.body.email);

    if (!driverId && !email) {
      return fail(res, 400, "Driver ID or email is required.");
    }

    const driver = driverId
      ? await dbFindById("drivers", driverId)
      : await dbFindOne("drivers", "email", email);

    if (!driver) return fail(res, 404, "Driver not found.");

    if (!driver.email_verified) {
      return fail(res, 403, "Driver email must be verified before Persona.");
    }

    if (!driver.phone_verified) {
      return fail(res, 403, "Driver phone must be verified before Persona.");
    }

    if (driver.persona_status === "approved") {
      return ok(res, {
        message: "Driver Persona verification already approved.",
        driver: publicDriver(driver),
      });
    }

    req.body.type = "driver";
    req.body.user_id = driver.id;
    req.body.email = driver.email;
    req.body.name = driver.full_name;
    req.url = "/api/persona/create-inquiry";
    return app._router.handle(req, res);
  } catch (error) {
    return serverError(res, error, "Could not start driver Persona verification.");
  }
});

/* =========================================================
   CHECKR HELPERS
========================================================= */

async function checkrRequest(pathname, options = {}) {
  if (!CHECKR_API_KEY || !ENABLE_CHECKR) {
    throw new Error("Checkr is not configured.");
  }

  const response = await fetch(`https://api.checkr.com/v1${pathname}`, {
    method: options.method || "GET",
    headers: {
      Authorization: "Basic " + Buffer.from(`${CHECKR_API_KEY}:`).toString("base64"),
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(data.error || data.message || "Checkr API request failed.");
    error.status = response.status;
    error.details = data;
    throw error;
  }

  return data;
}

function splitName(fullName = "") {
  const parts = normalizeText(fullName).split(" ").filter(Boolean);
  return {
    firstName: parts[0] || "Driver",
    lastName: parts.slice(1).join(" ") || "Applicant",
  };
}

function checkrWorkLocation() {
  return {
    country: CHECKR_WORK_COUNTRY,
    state: CHECKR_WORK_STATE,
    city: CHECKR_WORK_CITY,
  };
}

/* =========================================================
   START DRIVER CHECKR FLOW
========================================================= */

async function startDriverCheckrFlow(driver) {
  if (!driver.email_verified) throw new Error("Driver email must be verified before Checkr.");
  if (!driver.phone_verified) throw new Error("Driver phone must be verified before Checkr.");

  if (driver.identity_verified !== true && driver.persona_status !== "approved") {
    throw new Error("Driver Persona identity verification must be approved before Checkr.");
  }

  const { firstName, lastName } = splitName(driver.full_name);
  let candidateId = driver.checkr_candidate_id;

  if (!candidateId) {
    const candidate = await checkrRequest("/candidates", {
      method: "POST",
      body: {
        first_name: driver.first_name || firstName,
        last_name: driver.last_name || lastName,
        email: driver.email,
        phone: driver.phone,
        zipcode: driver.zipcode || "37201",
        work_locations: [checkrWorkLocation()],
      },
    });

    candidateId = candidate.id;

    await supabase
      .from("drivers")
      .update({
        checkr_candidate_id: candidateId,
        checkr_status: "candidate_created",
        updated_at: nowIso(),
      })
      .eq("id", driver.id);
  }

  const invitation = await checkrRequest("/invitations", {
    method: "POST",
    body: {
      candidate_id: candidateId,
      package: CHECKR_PACKAGE,
      work_locations: [checkrWorkLocation()],
    },
  });

  await supabase
    .from("drivers")
    .update({
      checkr_invitation_id: invitation.id,
      checkr_invitation_url: invitation.invitation_url || null,
      checkr_status: "invitation_sent",
      status: "background_check_invited",
      updated_at: nowIso(),
    })
    .eq("id", driver.id);

  await auditLog("driver_checkr_started", {
    driver_id: driver.id,
    checkr_candidate_id: candidateId,
    checkr_invitation_id: invitation.id,
  });

  return {
    candidateId,
    invitation,
  };
}

/* =========================================================
   START CHECKR ROUTE
========================================================= */

app.post("/api/drivers/start-checkr", async (req, res) => {
  try {
    const driverId = safeTrim(req.body.driverId || req.body.driver_id);
    const email = normalizeEmail(req.body.email);

    if (!driverId && !email) {
      return fail(res, 400, "Driver ID or email is required.");
    }

    if (!CHECKR_API_KEY || !ENABLE_CHECKR) {
      return fail(res, 503, "Checkr is not configured.");
    }

    const driver = driverId
      ? await dbFindById("drivers", driverId)
      : await dbFindOne("drivers", "email", email);

    if (!driver) return fail(res, 404, "Driver not found.");

    const result = await startDriverCheckrFlow(driver);

    return ok(res, {
      message: "Checkr background-check invitation created.",
      driver: publicDriver({
        ...driver,
        checkr_status: "invitation_sent",
        status: "background_check_invited",
      }),
      checkr: {
        candidateId: result.candidateId,
        invitationId: result.invitation?.id,
        invitationUrl: result.invitation?.invitation_url || null,
      },
    });
  } catch (error) {
    return serverError(res, error, "Could not start Checkr.");
  }
});

/* =========================================================
   CHECKR STATUS NORMALIZATION
========================================================= */

function normalizeCheckrStatus(eventType, object = {}) {
  const result = normalizeLower(object.result || "");
  const rawStatus = normalizeLower(object.status || "");

  if (eventType.includes("invitation.completed")) return "invitation_completed";
  if (eventType.includes("invitation.expired")) return "invitation_expired";

  if (eventType.includes("report.completed")) {
    if (result === "clear") return "report_clear";
    if (result === "consider") return "report_consider";
    return "report_completed";
  }

  if (eventType.includes("report.suspended")) return "report_suspended";
  if (eventType.includes("report.canceled")) return "report_canceled";

  return rawStatus || eventType || "unknown";
}

function checkrApprovalUpdate(checkrStatus) {
  if (["report_clear", "clear", "complete", "completed"].includes(checkrStatus)) {
    return {
      status: "background_check_clear",
      approval_status: "pending",
      review_reason: null,
    };
  }

  if (
    [
      "report_consider",
      "consider",
      "report_suspended",
      "report_canceled",
      "invitation_expired",
    ].includes(checkrStatus)
  ) {
    return {
      status: "manual_review",
      approval_status: "manual_review",
      review_reason: `Checkr status: ${checkrStatus}`,
    };
  }

  return {
    status: "background_check_pending",
    approval_status: "pending",
  };
}

/* =========================================================
   CHECKR WEBHOOK
========================================================= */

app.post("/api/webhooks/checkr", async (req, res) => {
  try {
    const eventType = normalizeLower(req.body?.type || req.body?.event || "unknown");
    const object = req.body?.data?.object || req.body?.object || req.body || {};

    const candidateId =
      object.candidate_id ||
      object.candidate?.id ||
      object.candidate ||
      null;

    const invitationId =
      object.invitation_id ||
      object.invitation?.id ||
      null;

    const reportId =
      object.report_id ||
      object.report?.id ||
      object.id ||
      null;

    const checkrStatus = normalizeCheckrStatus(eventType, object);
    const approvalUpdate = checkrApprovalUpdate(checkrStatus);

    let driver = null;

    if (candidateId) driver = await dbFindOne("drivers", "checkr_candidate_id", candidateId);
    if (!driver && invitationId) driver = await dbFindOne("drivers", "checkr_invitation_id", invitationId);
    if (!driver && reportId) driver = await dbFindOne("drivers", "checkr_report_id", reportId);

    if (!driver) {
      await auditLog("checkr_webhook_unmatched", {
        event_type: eventType,
        candidate_id: candidateId,
        invitation_id: invitationId,
        report_id: reportId,
        checkr_status: checkrStatus,
      });

      return ok(res, {
        received: true,
        matchedDriver: false,
      });
    }

    await supabase
      .from("drivers")
      .update({
        checkr_status: checkrStatus,
        checkr_last_event: eventType,
        checkr_report_id: reportId || driver.checkr_report_id || null,
        checkr_last_payload: req.body,
        ...approvalUpdate,
        updated_at: nowIso(),
      })
      .eq("id", driver.id);

    await auditLog("checkr_webhook_driver_updated", {
      driver_id: driver.id,
      event_type: eventType,
      checkr_status: checkrStatus,
      approval_status: approvalUpdate.approval_status,
    });

    return ok(res, {
      received: true,
      matchedDriver: true,
      driverId: driver.id,
      checkrStatus,
      approvalStatus: approvalUpdate.approval_status,
    });
  } catch (error) {
    return serverError(res, error, "Checkr webhook failed.");
  }
});

/* =========================================================
   ADMIN RIDER APPROVAL
========================================================= */

app.post("/api/admin/riders/approve", requireAdmin, async (req, res) => {
  try {
    const riderId = safeTrim(req.body.riderId || req.body.rider_id);

    if (!riderId) return fail(res, 400, "Rider ID is required.");

    const rider = await dbFindById("riders", riderId);
    if (!rider) return fail(res, 404, "Rider not found.");

    if (rider.persona_status !== "approved") {
      return fail(res, 403, "Rider Persona verification must be approved first.");
    }

    const updated = await dbUpdateById("riders", rider.id, {
      verification_status: "approved",
      approval_status: "approved",
      status: "approved",
      approved_at: nowIso(),
    });

    await auditLog("admin_rider_approved", {
      admin: req.admin.email,
      rider_id: rider.id,
    });

    return ok(res, {
      message: "Rider approved.",
      rider: publicRider(updated),
    });
  } catch (error) {
    return serverError(res, error, "Could not approve rider.");
  }
});

/* =========================================================
   ADMIN DRIVER APPROVAL
========================================================= */

app.post("/api/admin/drivers/approve", requireAdmin, async (req, res) => {
  try {
    const driverId = safeTrim(req.body.driverId || req.body.driver_id);

    if (!driverId) return fail(res, 400, "Driver ID is required.");

    const driver = await dbFindById("drivers", driverId);
    if (!driver) return fail(res, 404, "Driver not found.");

    const identityOk =
      driver.identity_verified === true ||
      driver.persona_status === "approved";

    const checkrOk = [
      "report_clear",
      "clear",
      "completed",
      "complete",
      "invitation_completed",
    ].includes(driver.checkr_status);

    if (!driver.email_verified) return fail(res, 403, "Driver email must be verified before approval.");
    if (!driver.phone_verified) return fail(res, 403, "Driver phone must be verified before approval.");
    if (!identityOk) return fail(res, 403, "Driver Persona identity verification must be approved before approval.");
    if (!checkrOk) return fail(res, 403, "Driver Checkr background check must be clear before approval.");

    const updated = await dbUpdateById("drivers", driver.id, {
      approval_status: "approved",
      status: "approved",
      available: false,
      approved_at: nowIso(),
      review_reason: null,
    });

    await auditLog("admin_driver_approved", {
      admin: req.admin.email,
      driver_id: driver.id,
    });

    return ok(res, {
      message: "Driver approved.",
      driver: publicDriver(updated),
    });
  } catch (error) {
    return serverError(res, error, "Could not approve driver.");
  }
});

/* =========================================================
   ADMIN REJECTION / MANUAL REVIEW
========================================================= */

app.post("/api/admin/drivers/reject", requireAdmin, async (req, res) => {
  try {
    const driverId = safeTrim(req.body.driverId || req.body.driver_id);
    const reason = normalizeText(req.body.reason || "Rejected by admin.");

    if (!driverId) return fail(res, 400, "Driver ID is required.");

    const driver = await dbFindById("drivers", driverId);
    if (!driver) return fail(res, 404, "Driver not found.");

    const updated = await dbUpdateById("drivers", driver.id, {
      approval_status: "rejected",
      status: "rejected",
      rejection_reason: reason,
      available: false,
      rejected_at: nowIso(),
    });

    return ok(res, {
      message: "Driver rejected.",
      driver: publicDriver(updated),
    });
  } catch (error) {
    return serverError(res, error, "Could not reject driver.");
  }
});

app.post("/api/admin/drivers/manual-review", requireAdmin, async (req, res) => {
  try {
    const driverId = safeTrim(req.body.driverId || req.body.driver_id);
    const reason = normalizeText(req.body.reason || "Manual review required.");

    if (!driverId) return fail(res, 400, "Driver ID is required.");

    const driver = await dbFindById("drivers", driverId);
    if (!driver) return fail(res, 404, "Driver not found.");

    const updated = await dbUpdateById("drivers", driver.id, {
      approval_status: "manual_review",
      status: "manual_review",
      review_reason: reason,
      available: false,
    });

    return ok(res, {
      message: "Driver moved to manual review.",
      driver: publicDriver(updated),
    });
  } catch (error) {
    return serverError(res, error, "Could not move driver to manual review.");
  }
});

/* =========================================================
   COMPATIBILITY ROUTES
========================================================= */

app.post("/api/driver/start-persona", (req, res) => {
  req.url = "/api/drivers/start-persona";
  return app._router.handle(req, res);
});

app.post("/api/driver/start-checkr", (req, res) => {
  req.url = "/api/drivers/start-checkr";
  return app._router.handle(req, res);
});

/* =========================================================
   PART 4 END
   NEXT: SEND TRUE DELIVERY SERVER PART 5
   Part 5 = Maps + fare engine + delivery estimate + payment authorization
========================================================= *//* =========================================================
   HARVEY TAXI — TRUE CODE BLUE DELIVERY SERVER.JS
   PART 5 OF 9
   MAPS + FARE ENGINE + DELIVERY ESTIMATE
   STRIPE PAYMENT AUTHORIZATION
========================================================= */

/* =========================================================
   GEO + MAPS HELPERS
========================================================= */

function haversineMiles(lat1, lng1, lat2, lng2) {
  const toRad = (value) => (Number(value) * Math.PI) / 180;
  const R = 3958.8;

  const dLat = toRad(Number(lat2) - Number(lat1));
  const dLng = toRad(Number(lng2) - Number(lng1));

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) ** 2;

  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function geocodeAddress(address) {
  const cleanAddress = normalizeText(address);

  if (!cleanAddress) return null;

  if (!GOOGLE_MAPS_API_KEY) {
    throw new Error("Google Maps API key is not configured.");
  }

  const url =
    "https://maps.googleapis.com/maps/api/geocode/json" +
    `?address=${encodeURIComponent(cleanAddress)}` +
    `&key=${encodeURIComponent(GOOGLE_MAPS_API_KEY)}`;

  const response = await fetch(url);
  const data = await response.json();

  if (data.status !== "OK" || !data.results?.length) return null;

  const result = data.results[0];

  return {
    input: cleanAddress,
    formatted_address: result.formatted_address,
    lat: result.geometry.location.lat,
    lng: result.geometry.location.lng,
    place_id: result.place_id,
  };
}

async function estimateDistanceAndDuration({ pickupAddress, dropoffAddress }) {
  if (!GOOGLE_MAPS_API_KEY) {
    throw new Error("Google Maps API key is not configured.");
  }

  const url =
    "https://maps.googleapis.com/maps/api/distancematrix/json" +
    `?origins=${encodeURIComponent(pickupAddress)}` +
    `&destinations=${encodeURIComponent(dropoffAddress)}` +
    `&units=imperial` +
    `&key=${encodeURIComponent(GOOGLE_MAPS_API_KEY)}`;

  const response = await fetch(url);
  const data = await response.json();

  const element = data.rows?.[0]?.elements?.[0];

  if (data.status !== "OK" || !element || element.status !== "OK") {
    throw new Error("Could not calculate distance or duration.");
  }

  return {
    miles: element.distance.value / 1609.344,
    minutes: element.duration.value / 60,
    distanceText: element.distance.text,
    durationText: element.duration.text,
  };
}

/* =========================================================
   RIDE FARE ENGINE
========================================================= */

function normalizeRequestedMode(value) {
  const mode = normalizeLower(value || "driver");

  if (["autonomous", "av", "pilot"].includes(mode)) {
    return "autonomous";
  }

  return "driver";
}

function calculateRideFare({ miles, minutes, requestedMode = "driver" }) {
  const mode = normalizeRequestedMode(requestedMode);
  const modeMultiplier = mode === "autonomous" ? 0.9 : 1;

  const subtotal =
    BASE_FARE +
    Number(miles || 0) * PER_MILE_RATE +
    Number(minutes || 0) * PER_MINUTE_RATE +
    BOOKING_FEE;

  const total = Math.max(MINIMUM_FARE, subtotal * modeMultiplier);
  const driverPayout = total * DRIVER_PAYOUT_PERCENT;
  const platformRevenue = total - driverPayout;

  return {
    currency: "usd",
    serviceType: "ride",
    requestedMode: mode,
    miles: roundMoney(miles),
    minutes: roundMoney(minutes),
    baseFare: roundMoney(BASE_FARE),
    perMileRate: roundMoney(PER_MILE_RATE),
    perMinuteRate: roundMoney(PER_MINUTE_RATE),
    bookingFee: roundMoney(BOOKING_FEE),
    subtotal: roundMoney(subtotal),
    modeMultiplier,
    total: roundMoney(total),
    driverPayout: roundMoney(driverPayout),
    platformRevenue: roundMoney(platformRevenue),
  };
}

/* =========================================================
   DELIVERY ITEM NORMALIZATION
========================================================= */

function normalizeOrderItems(items) {
  if (!Array.isArray(items)) return [];

  return items
    .map((item) => {
      const name = normalizeText(item.name || item.item || item.title);
      const quantity = Math.max(1, Math.floor(toNumber(item.quantity || item.qty, 1)));
      const unitPrice = roundMoney(item.unit_price || item.unitPrice || item.price || 0);
      const notes = normalizeText(item.notes || item.instructions || "");

      if (!name) return null;

      return {
        name,
        quantity,
        unitPrice,
        notes: notes || null,
        lineTotal: roundMoney(quantity * unitPrice),
      };
    })
    .filter(Boolean);
}

function calculateItemsSubtotal(items) {
  return roundMoney(
    normalizeOrderItems(items).reduce((sum, item) => {
      return sum + Number(item.lineTotal || 0);
    }, 0)
  );
}

/* =========================================================
   DELIVERY FEE ENGINE
========================================================= */

function calculateDeliveryEstimate({
  serviceType,
  miles,
  minutes,
  items = [],
  subtotal = null,
}) {
  const type = normalizeServiceType(serviceType);

  if (!isDeliveryService(type)) {
    throw new Error("Service type must be food or grocery for delivery estimate.");
  }

  if (type === "food" && !ENABLE_FOOD_DELIVERY) {
    throw new Error("Food delivery is not enabled.");
  }

  if (type === "grocery" && !ENABLE_GROCERY_DELIVERY) {
    throw new Error("Grocery delivery is not enabled.");
  }

  const normalizedItems = normalizeOrderItems(items);
  const itemSubtotal =
    subtotal !== null && subtotal !== undefined
      ? roundMoney(subtotal)
      : calculateItemsSubtotal(normalizedItems);

  const multiplier =
    type === "grocery" ? GROCERY_DELIVERY_MULTIPLIER : FOOD_DELIVERY_MULTIPLIER;

  const prepMinutes =
    type === "grocery"
      ? GROCERY_DEFAULT_SHOP_MINUTES
      : DELIVERY_DEFAULT_PREP_MINUTES;

  const smallOrderFee =
    itemSubtotal > 0 && itemSubtotal < DELIVERY_SMALL_ORDER_THRESHOLD
      ? DELIVERY_SMALL_ORDER_FEE
      : 0;

  const rawDeliveryFee =
    (DELIVERY_BASE_FEE +
      Number(miles || 0) * DELIVERY_PER_MILE_RATE +
      Number(minutes || 0) * DELIVERY_PER_MINUTE_RATE) *
    multiplier;

  const deliveryFee = Math.max(DELIVERY_MINIMUM_TOTAL, rawDeliveryFee);
  const serviceFee = DELIVERY_SERVICE_FEE + smallOrderFee;
  const total = itemSubtotal + deliveryFee + serviceFee;

  const driverPayout = deliveryFee * DELIVERY_DRIVER_PAYOUT_PERCENT;
  const platformRevenue = total - itemSubtotal - driverPayout;

  return {
    currency: "usd",
    serviceType: type,
    label: deliveryLabel(type),
    miles: roundMoney(miles),
    minutes: roundMoney(minutes),
    prepMinutes,
    subtotal: roundMoney(itemSubtotal),
    deliveryFee: roundMoney(deliveryFee),
    serviceFee: roundMoney(serviceFee),
    smallOrderFee: roundMoney(smallOrderFee),
    total: roundMoney(total),
    driverPayout: roundMoney(driverPayout),
    platformRevenue: roundMoney(platformRevenue),
    itemCount: normalizedItems.reduce((sum, item) => sum + item.quantity, 0),
    items: normalizedItems,
  };
}

/* =========================================================
   PUBLIC RIDE ESTIMATE
========================================================= */

app.post("/api/estimate-ride", async (req, res) => {
  try {
    const pickup = normalizeText(req.body.pickup || req.body.pickup_address);
    const dropoff = normalizeText(req.body.dropoff || req.body.dropoff_address);
    const requestedMode = normalizeRequestedMode(req.body.requestedMode);

    if (!pickup || !dropoff) {
      return fail(res, 400, "Pickup and dropoff are required.");
    }

    const pickupGeo = await geocodeAddress(pickup);
    const dropoffGeo = await geocodeAddress(dropoff);

    if (!pickupGeo || !dropoffGeo) {
      return fail(res, 400, "Could not validate pickup or dropoff address.");
    }

    const distance = await estimateDistanceAndDuration({
      pickupAddress: pickupGeo.formatted_address,
      dropoffAddress: dropoffGeo.formatted_address,
    });

    const estimate = calculateRideFare({
      miles: distance.miles,
      minutes: distance.minutes,
      requestedMode,
    });

    return ok(res, {
      estimate,
      route: {
        pickup: pickupGeo.formatted_address,
        dropoff: dropoffGeo.formatted_address,
        distanceText: distance.distanceText,
        durationText: distance.durationText,
      },
    });
  } catch (error) {
    return serverError(res, error, "Could not estimate ride.");
  }
});

/* =========================================================
   PUBLIC DELIVERY ESTIMATE
========================================================= */

app.post("/api/estimate-delivery", async (req, res) => {
  try {
    if (!ENABLE_DELIVERY) {
      return fail(res, 503, "Delivery is not enabled.");
    }

    const serviceType = normalizeServiceType(req.body.service_type || req.body.serviceType);
    const pickup = normalizeText(
      req.body.pickup ||
        req.body.pickup_address ||
        req.body.store_address ||
        req.body.restaurant_address
    );
    const dropoff = normalizeText(req.body.dropoff || req.body.dropoff_address);
    const items = normalizeOrderItems(req.body.items || req.body.order_items);
    const subtotal = req.body.subtotal ?? req.body.items_subtotal ?? null;

    if (!isDeliveryService(serviceType)) {
      return fail(res, 400, "Delivery service type must be food or grocery.");
    }

    if (!pickup || !dropoff) {
      return fail(res, 400, "Pickup/store address and dropoff address are required.");
    }

    const pickupGeo = await geocodeAddress(pickup);
    const dropoffGeo = await geocodeAddress(dropoff);

    if (!pickupGeo || !dropoffGeo) {
      return fail(res, 400, "Could not validate pickup or dropoff address.");
    }

    const distance = await estimateDistanceAndDuration({
      pickupAddress: pickupGeo.formatted_address,
      dropoffAddress: dropoffGeo.formatted_address,
    });

    const estimate = calculateDeliveryEstimate({
      serviceType,
      miles: distance.miles,
      minutes: distance.minutes,
      items,
      subtotal,
    });

    return ok(res, {
      estimate,
      route: {
        pickup: pickupGeo.formatted_address,
        dropoff: dropoffGeo.formatted_address,
        distanceText: distance.distanceText,
        durationText: distance.durationText,
      },
    });
  } catch (error) {
    return serverError(res, error, "Could not estimate delivery.");
  }
});

/* =========================================================
   STRIPE CUSTOMER HELPER
========================================================= */

async function getOrCreateStripeCustomerForRider(rider) {
  if (!stripe) {
    throw new Error("Stripe is not configured.");
  }

  if (rider.stripe_customer_id) {
    return rider.stripe_customer_id;
  }

  const customer = await stripe.customers.create({
    email: rider.email,
    phone: rider.phone,
    name: rider.full_name,
    metadata: {
      app: "harvey_taxi",
      rider_id: rider.id,
    },
  });

  await supabase
    .from("riders")
    .update({
      stripe_customer_id: customer.id,
      updated_at: nowIso(),
    })
    .eq("id", rider.id);

  return customer.id;
}

/* =========================================================
   PAYMENT AUTHORIZATION — RIDES
========================================================= */

app.post("/api/payments/authorize", async (req, res) => {
  try {
    const riderId = safeTrim(req.body.rider_id || req.body.riderId);
    const pickup = normalizeText(req.body.pickup || req.body.pickup_address);
    const dropoff = normalizeText(req.body.dropoff || req.body.dropoff_address);
    const requestedMode = normalizeRequestedMode(req.body.requestedMode);

    if (!riderId || !pickup || !dropoff) {
      return fail(res, 400, "Rider ID, pickup, and dropoff are required.");
    }

    const rider = await assertRiderApproved(riderId);

    const pickupGeo = await geocodeAddress(pickup);
    const dropoffGeo = await geocodeAddress(dropoff);

    if (!pickupGeo || !dropoffGeo) {
      return fail(res, 400, "Could not validate pickup or dropoff address.");
    }

    const distance = await estimateDistanceAndDuration({
      pickupAddress: pickupGeo.formatted_address,
      dropoffAddress: dropoffGeo.formatted_address,
    });

    const estimate = calculateRideFare({
      miles: distance.miles,
      minutes: distance.minutes,
      requestedMode,
    });

    if (!ENABLE_PAYMENT_GATE) {
      const payment = await dbInsert("payments", {
        rider_id: rider.id,
        amount: estimate.total,
        currency: "usd",
        status: "authorized",
        provider: "disabled_gate",
        type: "ride_authorization",
        requested_mode: estimate.requestedMode,
        fare_snapshot: estimate,
        route_snapshot: {
          pickup: pickupGeo,
          dropoff: dropoffGeo,
          distance,
        },
        created_at: nowIso(),
        updated_at: nowIso(),
      });

      return ok(res, {
        message: "Payment gate disabled. Development authorization created.",
        payment,
        estimate,
      });
    }

    if (!stripe) {
      return fail(res, 503, "Stripe is not configured.");
    }

    const customerId = await getOrCreateStripeCustomerForRider(rider);

    const paymentIntent = await stripe.paymentIntents.create({
      amount: cents(estimate.total),
      currency: "usd",
      customer: customerId,
      capture_method: "manual",
      automatic_payment_methods: {
        enabled: true,
      },
      metadata: {
        app: "harvey_taxi",
        type: "ride_authorization",
        rider_id: rider.id,
        requested_mode: estimate.requestedMode,
        pickup: pickupGeo.formatted_address.slice(0, 400),
        dropoff: dropoffGeo.formatted_address.slice(0, 400),
      },
    });

    const payment = await dbInsert("payments", {
      rider_id: rider.id,
      amount: estimate.total,
      currency: "usd",
      status: paymentIntent.status,
      provider: "stripe",
      type: "ride_authorization",
      stripe_customer_id: customerId,
      stripe_payment_intent_id: paymentIntent.id,
      client_secret: paymentIntent.client_secret,
      requested_mode: estimate.requestedMode,
      fare_snapshot: estimate,
      route_snapshot: {
        pickup: pickupGeo,
        dropoff: dropoffGeo,
        distance,
      },
      created_at: nowIso(),
      updated_at: nowIso(),
    });

    return ok(res, {
      message: "Ride payment authorization created.",
      payment: {
        id: payment.id,
        amount: payment.amount,
        currency: payment.currency,
        status: payment.status,
        provider: payment.provider,
        stripePaymentIntentId: paymentIntent.id,
        clientSecret: paymentIntent.client_secret,
      },
      estimate,
    });
  } catch (error) {
    return serverError(res, error, "Could not authorize ride payment.");
  }
});

/* =========================================================
   PAYMENT AUTHORIZATION — DELIVERY
========================================================= */

app.post("/api/payments/authorize-delivery", async (req, res) => {
  try {
    if (!ENABLE_DELIVERY) {
      return fail(res, 503, "Delivery is not enabled.");
    }

    const riderId = safeTrim(req.body.rider_id || req.body.riderId);
    const serviceType = normalizeServiceType(req.body.service_type || req.body.serviceType);
    const pickup = normalizeText(
      req.body.pickup ||
        req.body.pickup_address ||
        req.body.store_address ||
        req.body.restaurant_address
    );
    const dropoff = normalizeText(req.body.dropoff || req.body.dropoff_address);
    const items = normalizeOrderItems(req.body.items || req.body.order_items);
    const subtotal = req.body.subtotal ?? req.body.items_subtotal ?? null;

    if (!riderId || !pickup || !dropoff) {
      return fail(res, 400, "Rider ID, pickup/store address, and dropoff are required.");
    }

    if (!isDeliveryService(serviceType)) {
      return fail(res, 400, "Delivery service type must be food or grocery.");
    }

    const rider = await assertRiderApproved(riderId);

    const pickupGeo = await geocodeAddress(pickup);
    const dropoffGeo = await geocodeAddress(dropoff);

    if (!pickupGeo || !dropoffGeo) {
      return fail(res, 400, "Could not validate pickup or dropoff address.");
    }

    const distance = await estimateDistanceAndDuration({
      pickupAddress: pickupGeo.formatted_address,
      dropoffAddress: dropoffGeo.formatted_address,
    });

    const estimate = calculateDeliveryEstimate({
      serviceType,
      miles: distance.miles,
      minutes: distance.minutes,
      items,
      subtotal,
    });

    if (!ENABLE_PAYMENT_GATE) {
      const payment = await dbInsert("payments", {
        rider_id: rider.id,
        amount: estimate.total,
        currency: "usd",
        status: "authorized",
        provider: "disabled_gate",
        type: "delivery_authorization",
        service_type: estimate.serviceType,
        fare_snapshot: estimate,
        route_snapshot: {
          pickup: pickupGeo,
          dropoff: dropoffGeo,
          distance,
        },
        created_at: nowIso(),
        updated_at: nowIso(),
      });

      return ok(res, {
        message: "Payment gate disabled. Development delivery authorization created.",
        payment,
        estimate,
      });
    }

    if (!stripe) {
      return fail(res, 503, "Stripe is not configured.");
    }

    const customerId = await getOrCreateStripeCustomerForRider(rider);

    const paymentIntent = await stripe.paymentIntents.create({
      amount: cents(estimate.total),
      currency: "usd",
      customer: customerId,
      capture_method: "manual",
      automatic_payment_methods: {
        enabled: true,
      },
      metadata: {
        app: "harvey_taxi",
        type: "delivery_authorization",
        service_type: estimate.serviceType,
        rider_id: rider.id,
        pickup: pickupGeo.formatted_address.slice(0, 400),
        dropoff: dropoffGeo.formatted_address.slice(0, 400),
      },
    });

    const payment = await dbInsert("payments", {
      rider_id: rider.id,
      amount: estimate.total,
      currency: "usd",
      status: paymentIntent.status,
      provider: "stripe",
      type: "delivery_authorization",
      service_type: estimate.serviceType,
      stripe_customer_id: customerId,
      stripe_payment_intent_id: paymentIntent.id,
      client_secret: paymentIntent.client_secret,
      fare_snapshot: estimate,
      route_snapshot: {
        pickup: pickupGeo,
        dropoff: dropoffGeo,
        distance,
      },
      created_at: nowIso(),
      updated_at: nowIso(),
    });

    return ok(res, {
      message: "Delivery payment authorization created.",
      payment: {
        id: payment.id,
        amount: payment.amount,
        currency: payment.currency,
        status: payment.status,
        provider: payment.provider,
        stripePaymentIntentId: paymentIntent.id,
        clientSecret: paymentIntent.client_secret,
      },
      estimate,
    });
  } catch (error) {
    return serverError(res, error, "Could not authorize delivery payment.");
  }
});

/* =========================================================
   PAYMENT STATUS
========================================================= */

app.get("/api/payments/status", async (req, res) => {
  try {
    const paymentId = safeTrim(req.query.payment_id || req.query.paymentId);
    const paymentIntentId = safeTrim(
      req.query.payment_intent_id || req.query.paymentIntentId
    );

    if (!paymentId && !paymentIntentId) {
      return fail(res, 400, "Payment ID or Stripe PaymentIntent ID is required.");
    }

    let payment = null;

    if (paymentId) {
      payment = await dbFindById("payments", paymentId);
    } else {
      payment = await dbFindOne("payments", "stripe_payment_intent_id", paymentIntentId);
    }

    if (!payment) {
      return fail(res, 404, "Payment not found.");
    }

    let stripeStatus = null;

    if (stripe && payment.stripe_payment_intent_id) {
      const intent = await stripe.paymentIntents.retrieve(payment.stripe_payment_intent_id);
      stripeStatus = intent.status;

      if (payment.status !== intent.status) {
        payment = await dbUpdateById("payments", payment.id, {
          status: intent.status,
          stripe_latest_status: intent.status,
        });
      }
    }

    return ok(res, {
      payment: {
        id: payment.id,
        ride_id: payment.ride_id || null,
        delivery_order_id: payment.delivery_order_id || null,
        rider_id: payment.rider_id,
        amount: payment.amount,
        currency: payment.currency,
        status: payment.status,
        provider: payment.provider,
        type: payment.type,
        service_type: payment.service_type || null,
        stripePaymentIntentId: payment.stripe_payment_intent_id || null,
      },
      stripeStatus,
      authorized: ["requires_capture", "authorized"].includes(
        stripeStatus || payment.status
      ),
    });
  } catch (error) {
    return serverError(res, error, "Could not load payment status.");
  }
});

/* =========================================================
   PAYMENT CAPTURE / CANCEL HELPERS
========================================================= */

async function capturePayment(paymentId, finalAmount = null) {
  const payment = await dbFindById("payments", paymentId);

  if (!payment) throw new Error("Payment not found.");

  if (["captured", "succeeded"].includes(payment.status)) {
    return payment;
  }

  const amountToCapture = finalAmount || payment.amount;

  if (payment.provider === "disabled_gate") {
    return dbUpdateById("payments", payment.id, {
      status: "captured",
      captured_at: nowIso(),
      captured_amount: roundMoney(amountToCapture),
    });
  }

  if (!stripe || !payment.stripe_payment_intent_id) {
    throw new Error("Stripe payment cannot be captured.");
  }

  const intent = await stripe.paymentIntents.capture(
    payment.stripe_payment_intent_id,
    {
      amount_to_capture: cents(amountToCapture),
    }
  );

  const updated = await dbUpdateById("payments", payment.id, {
    status: intent.status,
    stripe_latest_status: intent.status,
    captured_at: nowIso(),
    captured_amount: roundMoney(amountToCapture),
  });

  await auditLog("payment_captured", {
    payment_id: payment.id,
    stripe_payment_intent_id: payment.stripe_payment_intent_id,
    amount: roundMoney(amountToCapture),
  });

  return updated;
}

async function cancelPayment(paymentId, reason = "requested_by_customer") {
  const payment = await dbFindById("payments", paymentId);

  if (!payment) throw new Error("Payment not found.");

  if (["canceled", "cancelled", "refunded"].includes(payment.status)) {
    return payment;
  }

  if (payment.provider === "disabled_gate") {
    return dbUpdateById("payments", payment.id, {
      status: "canceled",
      canceled_at: nowIso(),
      cancel_reason: reason,
    });
  }

  if (!stripe || !payment.stripe_payment_intent_id) {
    throw new Error("Stripe payment cannot be canceled.");
  }

  const intent = await stripe.paymentIntents.cancel(
    payment.stripe_payment_intent_id,
    {
      cancellation_reason: reason,
    }
  );

  const updated = await dbUpdateById("payments", payment.id, {
    status: intent.status,
    stripe_latest_status: intent.status,
    canceled_at: nowIso(),
    cancel_reason: reason,
  });

  await auditLog("payment_canceled", {
    payment_id: payment.id,
    stripe_payment_intent_id: payment.stripe_payment_intent_id,
    reason,
  });

  return updated;
}

/* =========================================================
   PART 5 END
   NEXT: SEND TRUE DELIVERY SERVER PART 6
   Part 6 = Ride request + delivery request + dispatch engine
========================================================= *//* =========================================================
   HARVEY TAXI — TRUE CODE BLUE DELIVERY SERVER.JS
   PART 6 OF 9
   RIDE REQUEST + DELIVERY REQUEST + UNIFIED DISPATCH ENGINE
========================================================= */

/* =========================================================
   PAYMENT AUTHORIZATION CHECK
========================================================= */

async function assertPaymentAuthorized({ riderId, paymentId, expectedType = null }) {
  if (!ENABLE_PAYMENT_GATE) {
    return {
      authorized: true,
      payment: null,
      reason: "payment_gate_disabled",
    };
  }

  if (!paymentId) {
    throw new Error("Payment authorization is required before creating this request.");
  }

  const payment = await dbFindById("payments", paymentId);

  if (!payment) throw new Error("Payment authorization not found.");

  if (payment.rider_id !== riderId) {
    throw new Error("Payment authorization does not belong to this rider.");
  }

  if (expectedType && payment.type !== expectedType) {
    throw new Error(`Payment authorization type must be ${expectedType}.`);
  }

  let finalStatus = payment.status;

  if (stripe && payment.stripe_payment_intent_id) {
    const intent = await stripe.paymentIntents.retrieve(payment.stripe_payment_intent_id);
    finalStatus = intent.status;

    if (payment.status !== intent.status) {
      await dbUpdateById("payments", payment.id, {
        status: intent.status,
        stripe_latest_status: intent.status,
      });
    }
  }

  if (!["requires_capture", "authorized"].includes(finalStatus)) {
    throw new Error(`Payment is not authorized. Current status: ${finalStatus}`);
  }

  return {
    authorized: true,
    payment: {
      ...payment,
      status: finalStatus,
    },
  };
}

/* =========================================================
   DRIVER ELIGIBILITY
========================================================= */

function driverIdentityApproved(driver = {}) {
  return driver.identity_verified === true || driver.persona_status === "approved";
}

function driverCheckrApproved(driver = {}) {
  return [
    "report_clear",
    "clear",
    "completed",
    "complete",
    "invitation_completed",
  ].includes(driver.checkr_status);
}

function driverCanReceiveMissions(driver = {}) {
  return (
    !!driver.email_verified &&
    !!driver.phone_verified &&
    driverIdentityApproved(driver) &&
    driverCheckrApproved(driver) &&
    driver.approval_status === "approved" &&
    !!driver.available
  );
}

function driverSupportsService(driver = {}, serviceType = "ride") {
  const type = normalizeServiceType(serviceType);

  if (type === "ride") return driver.supports_rides !== false;
  if (type === "food") return driver.supports_food_delivery !== false;
  if (type === "grocery") return driver.supports_grocery_delivery !== false;

  return false;
}

/* =========================================================
   DRIVER SCORING
========================================================= */

function scoreDriverForPoint(driver, pointLat, pointLng, serviceType, requestedMode = "driver") {
  if (!driver.current_lat || !driver.current_lng) return null;

  const distanceMiles = haversineMiles(
    pointLat,
    pointLng,
    driver.current_lat,
    driver.current_lng
  );

  const searchRadius = isDeliveryService(serviceType)
    ? DELIVERY_SEARCH_RADIUS_MILES
    : DRIVER_SEARCH_RADIUS_MILES;

  if (distanceMiles > searchRadius) return null;

  let score = 100;

  score -= distanceMiles * 3;

  if (serviceType === "ride") {
    if (driver.driver_type === "autonomous" && requestedMode === "autonomous") score += 25;
    if (driver.driver_type === "human" && requestedMode === "driver") score += 10;
  }

  if (serviceType === "food" && driver.supports_food_delivery !== false) score += 12;
  if (serviceType === "grocery" && driver.supports_grocery_delivery !== false) score += 14;

  if (driver.preferred_score) {
    score += Number(driver.preferred_score) || 0;
  }

  return {
    driver,
    distanceMiles,
    score,
  };
}

async function findEligibleDriversForService({
  serviceType,
  pickupLat,
  pickupLng,
  requestedMode = "driver",
}) {
  const { data, error } = await supabase
    .from("drivers")
    .select("*")
    .eq("available", true)
    .eq("approval_status", "approved");

  if (error) throw error;

  return (data || [])
    .filter(driverCanReceiveMissions)
    .filter((driver) => driverSupportsService(driver, serviceType))
    .map((driver) =>
      scoreDriverForPoint(driver, pickupLat, pickupLng, serviceType, requestedMode)
    )
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);
}

/* =========================================================
   MISSION OFFER CREATION — RIDE
========================================================= */

async function createRideMissionOffer({ ride, driverMatch }) {
  const driver = driverMatch.driver;
  const expiresAt = addSeconds(DISPATCH_TIMEOUT_SECONDS);

  const mission = await dbInsert("missions", {
    ride_id: ride.id,
    driver_id: driver.id,
    status: "offered",
    service_type: "ride",
    mission_type: ride.requested_mode === "autonomous" ? "autonomous_ride" : "ride",

    pickup_address: ride.pickup_address,
    dropoff_address: ride.dropoff_address,

    fare_total: ride.fare_total,
    driver_payout: ride.driver_payout,

    expires_at: expiresAt,
    created_at: nowIso(),
    updated_at: nowIso(),
  });

  const dispatch = await dbInsert("dispatches", {
    ride_id: ride.id,
    driver_id: driver.id,
    mission_id: mission.id,

    service_type: "ride",
    status: "offered",
    attempt_number: (ride.dispatch_attempts || 0) + 1,
    score: driverMatch.score,
    distance_miles: roundMoney(driverMatch.distanceMiles),

    expires_at: expiresAt,
    created_at: nowIso(),
    updated_at: nowIso(),
  });

  await supabase
    .from("rides")
    .update({
      status: "awaiting_driver_acceptance",
      current_dispatch_id: dispatch.id,
      current_mission_id: mission.id,
      dispatch_attempts: (ride.dispatch_attempts || 0) + 1,
      updated_at: nowIso(),
    })
    .eq("id", ride.id);

  await rideEvent(ride.id, "dispatch_offered", {
    driver_id: driver.id,
    mission_id: mission.id,
    dispatch_id: dispatch.id,
    score: driverMatch.score,
    distance_miles: roundMoney(driverMatch.distanceMiles),
    expires_at: expiresAt,
  });

  return { mission, dispatch };
}

/* =========================================================
   MISSION OFFER CREATION — DELIVERY
========================================================= */

async function createDeliveryMissionOffer({ order, driverMatch }) {
  const driver = driverMatch.driver;
  const expiresAt = addSeconds(DELIVERY_DISPATCH_TIMEOUT_SECONDS);

  const mission = await dbInsert("missions", {
    delivery_order_id: order.id,
    driver_id: driver.id,
    status: "offered",
    service_type: order.service_type,
    mission_type: `${order.service_type}_delivery`,

    pickup_address: order.pickup_address,
    dropoff_address: order.dropoff_address,

    fare_total: order.total,
    driver_payout: order.driver_payout,

    expires_at: expiresAt,
    created_at: nowIso(),
    updated_at: nowIso(),
  });

  const dispatch = await dbInsert("dispatches", {
    delivery_order_id: order.id,
    driver_id: driver.id,
    mission_id: mission.id,

    service_type: order.service_type,
    status: "offered",
    attempt_number: (order.dispatch_attempts || 0) + 1,
    score: driverMatch.score,
    distance_miles: roundMoney(driverMatch.distanceMiles),

    expires_at: expiresAt,
    created_at: nowIso(),
    updated_at: nowIso(),
  });

  await supabase
    .from("delivery_orders")
    .update({
      status: "awaiting_driver_acceptance",
      current_dispatch_id: dispatch.id,
      current_mission_id: mission.id,
      dispatch_attempts: (order.dispatch_attempts || 0) + 1,
      updated_at: nowIso(),
    })
    .eq("id", order.id);

  await deliveryEvent(order.id, "dispatch_offered", {
    driver_id: driver.id,
    mission_id: mission.id,
    dispatch_id: dispatch.id,
    service_type: order.service_type,
    score: driverMatch.score,
    distance_miles: roundMoney(driverMatch.distanceMiles),
    expires_at: expiresAt,
  });

  return { mission, dispatch };
}

/* =========================================================
   DISPATCH ENGINE — RIDE
========================================================= */

async function dispatchRide(rideId) {
  const ride = await dbFindById("rides", rideId);

  if (!ride) throw new Error("Ride not found for dispatch.");

  if (
    [
      "completed",
      "canceled",
      "driver_assigned",
      "driver_en_route",
      "driver_arrived",
      "in_progress",
    ].includes(ride.status)
  ) {
    return {
      skipped: true,
      reason: `Ride status is ${ride.status}`,
    };
  }

  if ((ride.dispatch_attempts || 0) >= MAX_DISPATCH_ATTEMPTS) {
    await dbUpdateById("rides", ride.id, {
      status: "no_driver_available",
    });

    await rideEvent(ride.id, "dispatch_failed", {
      reason: "max_attempts_reached",
    });

    return {
      failed: true,
      reason: "max_attempts_reached",
    };
  }

  const driverMatches = await findEligibleDriversForService({
    serviceType: "ride",
    pickupLat: ride.pickup_lat,
    pickupLng: ride.pickup_lng,
    requestedMode: ride.requested_mode,
  });

  const { data: priorDispatches, error: priorError } = await supabase
    .from("dispatches")
    .select("driver_id")
    .eq("ride_id", ride.id);

  if (priorError) throw priorError;

  const alreadyOfferedDriverIds = new Set(
    (priorDispatches || []).map((dispatch) => dispatch.driver_id)
  );

  const nextDriverMatch = driverMatches.find(
    (match) => !alreadyOfferedDriverIds.has(match.driver.id)
  );

  if (!nextDriverMatch) {
    const updatedAttempts = (ride.dispatch_attempts || 0) + 1;

    await dbUpdateById("rides", ride.id, {
      dispatch_attempts: updatedAttempts,
      status:
        updatedAttempts >= MAX_DISPATCH_ATTEMPTS
          ? "no_driver_available"
          : "searching",
    });

    await rideEvent(ride.id, "dispatch_no_driver_match", {
      attempt: updatedAttempts,
    });

    return {
      failed: updatedAttempts >= MAX_DISPATCH_ATTEMPTS,
      reason: "no_available_driver_match",
    };
  }

  const offer = await createRideMissionOffer({
    ride,
    driverMatch: nextDriverMatch,
  });

  return {
    offered: true,
    serviceType: "ride",
    driver_id: nextDriverMatch.driver.id,
    mission_id: offer.mission.id,
    dispatch_id: offer.dispatch.id,
  };
}

/* =========================================================
   DISPATCH ENGINE — DELIVERY
========================================================= */

async function dispatchDelivery(orderId) {
  const order = await dbFindById("delivery_orders", orderId);

  if (!order) throw new Error("Delivery order not found for dispatch.");

  if (
    [
      "completed",
      "canceled",
      "driver_assigned",
      "driver_en_route_to_store",
      "arrived_at_store",
      "picked_up",
      "en_route_to_customer",
      "arrived_at_customer",
    ].includes(order.status)
  ) {
    return {
      skipped: true,
      reason: `Delivery order status is ${order.status}`,
    };
  }

  if ((order.dispatch_attempts || 0) >= MAX_DISPATCH_ATTEMPTS) {
    await dbUpdateById("delivery_orders", order.id, {
      status: "no_driver_available",
    });

    await deliveryEvent(order.id, "dispatch_failed", {
      reason: "max_attempts_reached",
    });

    return {
      failed: true,
      reason: "max_attempts_reached",
    };
  }

  const driverMatches = await findEligibleDriversForService({
    serviceType: order.service_type,
    pickupLat: order.pickup_lat,
    pickupLng: order.pickup_lng,
    requestedMode: "driver",
  });

  const { data: priorDispatches, error: priorError } = await supabase
    .from("dispatches")
    .select("driver_id")
    .eq("delivery_order_id", order.id);

  if (priorError) throw priorError;

  const alreadyOfferedDriverIds = new Set(
    (priorDispatches || []).map((dispatch) => dispatch.driver_id)
  );

  const nextDriverMatch = driverMatches.find(
    (match) => !alreadyOfferedDriverIds.has(match.driver.id)
  );

  if (!nextDriverMatch) {
    const updatedAttempts = (order.dispatch_attempts || 0) + 1;

    await dbUpdateById("delivery_orders", order.id, {
      dispatch_attempts: updatedAttempts,
      status:
        updatedAttempts >= MAX_DISPATCH_ATTEMPTS
          ? "no_driver_available"
          : "searching",
    });

    await deliveryEvent(order.id, "dispatch_no_driver_match", {
      attempt: updatedAttempts,
    });

    return {
      failed: updatedAttempts >= MAX_DISPATCH_ATTEMPTS,
      reason: "no_available_driver_match",
    };
  }

  const offer = await createDeliveryMissionOffer({
    order,
    driverMatch: nextDriverMatch,
  });

  return {
    offered: true,
    serviceType: order.service_type,
    driver_id: nextDriverMatch.driver.id,
    mission_id: offer.mission.id,
    dispatch_id: offer.dispatch.id,
  };
}

/* =========================================================
   REQUEST RIDE
========================================================= */

app.post("/api/request-ride", async (req, res) => {
  try {
    const riderId = safeTrim(req.body.rider_id || req.body.riderId);
    const paymentId = safeTrim(req.body.payment_id || req.body.paymentId);

    const pickup = normalizeText(req.body.pickup || req.body.pickup_address);
    const dropoff = normalizeText(req.body.dropoff || req.body.dropoff_address);
    const requestedMode = normalizeRequestedMode(req.body.requestedMode);

    const notes = normalizeText(req.body.notes || req.body.specialInstructions);
    const scheduledAt = safeTrim(req.body.scheduled_at || req.body.scheduledAt);

    if (!riderId || !pickup || !dropoff) {
      return fail(res, 400, "Rider ID, pickup, and dropoff are required.");
    }

    const rider = await assertRiderApproved(riderId);

    const paymentAuth = await assertPaymentAuthorized({
      riderId: rider.id,
      paymentId,
      expectedType: ENABLE_PAYMENT_GATE ? "ride_authorization" : null,
    });

    const pickupGeo = await geocodeAddress(pickup);
    const dropoffGeo = await geocodeAddress(dropoff);

    if (!pickupGeo || !dropoffGeo) {
      return fail(res, 400, "Could not validate pickup or dropoff address.");
    }

    const distance = await estimateDistanceAndDuration({
      pickupAddress: pickupGeo.formatted_address,
      dropoffAddress: dropoffGeo.formatted_address,
    });

    const fare = calculateRideFare({
      miles: distance.miles,
      minutes: distance.minutes,
      requestedMode,
    });

    const ride = await dbInsert("rides", {
      rider_id: rider.id,
      payment_id: paymentAuth.payment?.id || null,

      pickup_address: pickupGeo.formatted_address,
      dropoff_address: dropoffGeo.formatted_address,
      pickup_lat: pickupGeo.lat,
      pickup_lng: pickupGeo.lng,
      dropoff_lat: dropoffGeo.lat,
      dropoff_lng: dropoffGeo.lng,

      requested_mode: fare.requestedMode,
      service_type: "ride",
      status: scheduledAt ? "scheduled" : "searching",

      miles_estimate: roundMoney(distance.miles),
      minutes_estimate: roundMoney(distance.minutes),
      fare_total: fare.total,
      driver_payout: fare.driverPayout,
      platform_revenue: fare.platformRevenue,

      fare_snapshot: fare,
      route_snapshot: {
        pickup: pickupGeo,
        dropoff: dropoffGeo,
        distance,
      },

      notes: notes || null,
      scheduled_at: scheduledAt || null,
      dispatch_attempts: 0,

      created_at: nowIso(),
      updated_at: nowIso(),
    });

    if (paymentAuth.payment?.id) {
      await supabase
        .from("payments")
        .update({
          ride_id: ride.id,
          amount: fare.total,
          fare_snapshot: fare,
          route_snapshot: {
            pickup: pickupGeo,
            dropoff: dropoffGeo,
            distance,
          },
          updated_at: nowIso(),
        })
        .eq("id", paymentAuth.payment.id);
    }

    await rideEvent(ride.id, "ride_created", {
      rider_id: rider.id,
      requested_mode: fare.requestedMode,
      fare_total: fare.total,
      scheduled: !!scheduledAt,
    });

    let dispatchResult = null;

    if (!scheduledAt) {
      dispatchResult = await dispatchRide(ride.id);
    }

    return ok(res, {
      message: scheduledAt
        ? "Scheduled ride created."
        : "Ride request created and dispatch started.",
      ride: {
        id: ride.id,
        status: ride.status,
        serviceType: "ride",
        requestedMode: ride.requested_mode,
        pickup: ride.pickup_address,
        dropoff: ride.dropoff_address,
        fareTotal: ride.fare_total,
        scheduledAt: ride.scheduled_at,
      },
      dispatch: dispatchResult,
    }, 201);
  } catch (error) {
    return serverError(res, error, "Ride request failed.");
  }
});

/* =========================================================
   REQUEST DELIVERY
========================================================= */

app.post("/api/request-delivery", async (req, res) => {
  try {
    if (!ENABLE_DELIVERY) {
      return fail(res, 503, "Delivery is not enabled.");
    }

    const riderId = safeTrim(req.body.rider_id || req.body.riderId);
    const paymentId = safeTrim(req.body.payment_id || req.body.paymentId);

    const serviceType = normalizeServiceType(req.body.service_type || req.body.serviceType);

    const pickup = normalizeText(
      req.body.pickup ||
        req.body.pickup_address ||
        req.body.store_address ||
        req.body.restaurant_address
    );

    const dropoff = normalizeText(req.body.dropoff || req.body.dropoff_address);

    const storeName = normalizeText(req.body.store_name || req.body.storeName);
    const restaurantName = normalizeText(req.body.restaurant_name || req.body.restaurantName);

    const notes = normalizeText(req.body.notes || req.body.specialInstructions);
    const customerNotes = normalizeText(req.body.customer_notes || req.body.customerNotes);
    const driverNotes = normalizeText(req.body.driver_notes || req.body.driverNotes);

    const scheduledAt = safeTrim(req.body.scheduled_at || req.body.scheduledAt);

    const items = normalizeOrderItems(req.body.items || req.body.order_items);
    const subtotal = req.body.subtotal ?? req.body.items_subtotal ?? null;

    if (!riderId || !pickup || !dropoff) {
      return fail(res, 400, "Rider ID, pickup/store address, and dropoff are required.");
    }

    if (!isDeliveryService(serviceType)) {
      return fail(res, 400, "Delivery service type must be food or grocery.");
    }

    if (serviceType === "food" && !ENABLE_FOOD_DELIVERY) {
      return fail(res, 503, "Food delivery is not enabled.");
    }

    if (serviceType === "grocery" && !ENABLE_GROCERY_DELIVERY) {
      return fail(res, 503, "Grocery delivery is not enabled.");
    }

    const rider = await assertRiderApproved(riderId);

    const paymentAuth = await assertPaymentAuthorized({
      riderId: rider.id,
      paymentId,
      expectedType: ENABLE_PAYMENT_GATE ? "delivery_authorization" : null,
    });

    const pickupGeo = await geocodeAddress(pickup);
    const dropoffGeo = await geocodeAddress(dropoff);

    if (!pickupGeo || !dropoffGeo) {
      return fail(res, 400, "Could not validate pickup/store or dropoff address.");
    }

    const distance = await estimateDistanceAndDuration({
      pickupAddress: pickupGeo.formatted_address,
      dropoffAddress: dropoffGeo.formatted_address,
    });

    const estimate = calculateDeliveryEstimate({
      serviceType,
      miles: distance.miles,
      minutes: distance.minutes,
      items,
      subtotal,
    });

    const order = await dbInsert("delivery_orders", {
      rider_id: rider.id,
      payment_id: paymentAuth.payment?.id || null,

      service_type: estimate.serviceType,
      status: scheduledAt ? "scheduled" : "searching",

      store_name: storeName || null,
      restaurant_name: restaurantName || null,

      pickup_address: pickupGeo.formatted_address,
      dropoff_address: dropoffGeo.formatted_address,
      pickup_lat: pickupGeo.lat,
      pickup_lng: pickupGeo.lng,
      dropoff_lat: dropoffGeo.lat,
      dropoff_lng: dropoffGeo.lng,

      subtotal: estimate.subtotal,
      delivery_fee: estimate.deliveryFee,
      service_fee: estimate.serviceFee,
      small_order_fee: estimate.smallOrderFee,
      total: estimate.total,
      driver_payout: estimate.driverPayout,
      platform_revenue: estimate.platformRevenue,

      item_count: estimate.itemCount,
      fare_snapshot: estimate,
      route_snapshot: {
        pickup: pickupGeo,
        dropoff: dropoffGeo,
        distance,
      },

      notes: notes || null,
      customer_notes: customerNotes || null,
      driver_notes: driverNotes || null,

      scheduled_at: scheduledAt || null,
      dispatch_attempts: 0,

      created_at: nowIso(),
      updated_at: nowIso(),
    });

    const normalizedItems = estimate.items || [];

    if (normalizedItems.length) {
      const itemRows = normalizedItems.map((item) => ({
        delivery_order_id: order.id,
        name: item.name,
        quantity: item.quantity,
        unit_price: item.unitPrice,
        line_total: item.lineTotal,
        notes: item.notes,
        created_at: nowIso(),
        updated_at: nowIso(),
      }));

      const { error: itemError } = await supabase
        .from("delivery_order_items")
        .insert(itemRows);

      if (itemError) throw itemError;
    }

    if (paymentAuth.payment?.id) {
      await supabase
        .from("payments")
        .update({
          delivery_order_id: order.id,
          amount: estimate.total,
          service_type: estimate.serviceType,
          fare_snapshot: estimate,
          route_snapshot: {
            pickup: pickupGeo,
            dropoff: dropoffGeo,
            distance,
          },
          updated_at: nowIso(),
        })
        .eq("id", paymentAuth.payment.id);
    }

    await deliveryEvent(order.id, "delivery_created", {
      rider_id: rider.id,
      service_type: estimate.serviceType,
      total: estimate.total,
      scheduled: !!scheduledAt,
    });

    let dispatchResult = null;

    if (!scheduledAt) {
      dispatchResult = await dispatchDelivery(order.id);
    }

    return ok(res, {
      message: scheduledAt
        ? `${deliveryLabel(serviceType)} order scheduled.`
        : `${deliveryLabel(serviceType)} order created and dispatch started.`,
      delivery: publicDeliveryOrder(order),
      dispatch: dispatchResult,
    }, 201);
  } catch (error) {
    return serverError(res, error, "Delivery request failed.");
  }
});

/* =========================================================
   COMPATIBILITY DELIVERY ROUTES
========================================================= */

app.post("/api/delivery/estimate", (req, res) => {
  req.url = "/api/estimate-delivery";
  return app._router.handle(req, res);
});

app.post("/api/delivery/request", (req, res) => {
  req.url = "/api/request-delivery";
  return app._router.handle(req, res);
});

app.post("/api/request-food-delivery", (req, res) => {
  req.body.service_type = "food";
  req.url = "/api/request-delivery";
  return app._router.handle(req, res);
});

app.post("/api/request-grocery-delivery", (req, res) => {
  req.body.service_type = "grocery";
  req.url = "/api/request-delivery";
  return app._router.handle(req, res);
});

/* =========================================================
   PART 6 END
   NEXT: SEND TRUE DELIVERY SERVER PART 7
   Part 7 = Mission accept/reject + driver lifecycle for rides and delivery
========================================================= *//* =========================================================
   HARVEY TAXI — TRUE CODE BLUE DELIVERY SERVER.JS
   PART 7 OF 9
   MISSION ACCEPT/REJECT + RIDE LIFECYCLE
   DELIVERY LIFECYCLE
========================================================= */

/* =========================================================
   DRIVER AVAILABILITY + LOCATION
========================================================= */

app.post("/api/driver/availability", async (req, res) => {
  try {
    const driverId = safeTrim(req.body.driver_id || req.body.driverId);
    const available = req.body.available === true || req.body.available === "true";

    if (!driverId) return fail(res, 400, "Driver ID is required.");

    const driver = await dbFindById("drivers", driverId);
    if (!driver) return fail(res, 404, "Driver not found.");

    if (available && !driverCanReceiveMissions({ ...driver, available: true })) {
      return fail(res, 403, "Driver is not fully approved to go online.", {
        driver: publicDriver(driver),
      });
    }

    const updated = await dbUpdateById("drivers", driver.id, {
      available,
      last_available_at: available ? nowIso() : driver.last_available_at || null,
      last_unavailable_at: !available ? nowIso() : driver.last_unavailable_at || null,
    });

    return ok(res, {
      message: available ? "Driver is online." : "Driver is offline.",
      driver: publicDriver(updated),
    });
  } catch (error) {
    return serverError(res, error, "Could not update driver availability.");
  }
});

app.post("/api/driver/location", async (req, res) => {
  try {
    const driverId = safeTrim(req.body.driver_id || req.body.driverId);
    const lat = toNumber(req.body.lat, null);
    const lng = toNumber(req.body.lng, null);

    if (!driverId || lat === null || lng === null) {
      return fail(res, 400, "Driver ID, lat, and lng are required.");
    }

    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return fail(res, 400, "Invalid latitude or longitude.");
    }

    const driver = await dbFindById("drivers", driverId);
    if (!driver) return fail(res, 404, "Driver not found.");

    const updated = await dbUpdateById("drivers", driver.id, {
      current_lat: lat,
      current_lng: lng,
      last_location_at: nowIso(),
    });

    try {
      await supabase.from("driver_locations").insert({
        driver_id: driver.id,
        lat,
        lng,
        created_at: nowIso(),
      });
    } catch (locationError) {
      console.warn("⚠️ driver_locations insert skipped:", locationError.message);
    }

    return ok(res, {
      message: "Driver location updated.",
      driver: publicDriver(updated),
    });
  } catch (error) {
    return serverError(res, error, "Could not update driver location.");
  }
});

/* =========================================================
   DRIVER MISSION FEED
========================================================= */

app.get("/api/driver/missions", async (req, res) => {
  try {
    const driverId = safeTrim(req.query.driver_id || req.query.driverId);

    if (!driverId) return fail(res, 400, "Driver ID is required.");

    const driver = await dbFindById("drivers", driverId);
    if (!driver) return fail(res, 404, "Driver not found.");

    const { data, error } = await supabase
      .from("missions")
      .select("*")
      .eq("driver_id", driver.id)
      .in("status", [
        "offered",
        "accepted",
        "en_route",
        "arrived",
        "in_progress",
        "driver_en_route_to_store",
        "arrived_at_store",
        "picked_up",
        "en_route_to_customer",
        "arrived_at_customer",
      ])
      .order("created_at", { ascending: false });

    if (error) throw error;

    return ok(res, {
      driver: publicDriver(driver),
      canReceiveMissions: driverCanReceiveMissions(driver),
      missions: data || [],
    });
  } catch (error) {
    return serverError(res, error, "Could not load driver missions.");
  }
});

/* =========================================================
   MISSION ACCEPT
========================================================= */

app.post("/api/driver/missions/accept", async (req, res) => {
  try {
    const driverId = safeTrim(req.body.driver_id || req.body.driverId);
    const missionId = safeTrim(req.body.mission_id || req.body.missionId);

    if (!driverId || !missionId) {
      return fail(res, 400, "Driver ID and mission ID are required.");
    }

    const mission = await dbFindById("missions", missionId);
    if (!mission) return fail(res, 404, "Mission not found.");

    if (mission.driver_id !== driverId) {
      return fail(res, 403, "Mission does not belong to this driver.");
    }

    if (mission.status !== "offered") {
      return fail(res, 409, `Mission cannot be accepted from status ${mission.status}.`);
    }

    if (mission.expires_at && new Date(mission.expires_at).getTime() < Date.now()) {
      return fail(res, 409, "Mission offer has expired.");
    }

    const driver = await dbFindById("drivers", driverId);

    if (!driver || !driverCanReceiveMissions(driver)) {
      return fail(res, 403, "Driver is not eligible to accept missions.");
    }

    const updatedMission = await dbUpdateById("missions", mission.id, {
      status: "accepted",
      accepted_at: nowIso(),
    });

    const { data: dispatches, error: dispatchError } = await supabase
      .from("dispatches")
      .select("*")
      .eq("mission_id", mission.id)
      .limit(1);

    if (dispatchError) throw dispatchError;

    const dispatch = dispatches?.[0] || null;

    if (dispatch) {
      await dbUpdateById("dispatches", dispatch.id, {
        status: "accepted",
        accepted_at: nowIso(),
      });
    }

    let ride = null;
    let delivery = null;

    if (mission.ride_id) {
      ride = await dbUpdateById("rides", mission.ride_id, {
        driver_id: driver.id,
        current_mission_id: mission.id,
        current_dispatch_id: dispatch?.id || null,
        status: "driver_assigned",
        assigned_at: nowIso(),
      });

      await rideEvent(mission.ride_id, "mission_accepted", {
        driver_id: driver.id,
        mission_id: mission.id,
        dispatch_id: dispatch?.id || null,
      });
    }

    if (mission.delivery_order_id) {
      delivery = await dbUpdateById("delivery_orders", mission.delivery_order_id, {
        driver_id: driver.id,
        current_mission_id: mission.id,
        current_dispatch_id: dispatch?.id || null,
        status: "driver_assigned",
        assigned_at: nowIso(),
      });

      await deliveryEvent(mission.delivery_order_id, "mission_accepted", {
        driver_id: driver.id,
        mission_id: mission.id,
        dispatch_id: dispatch?.id || null,
        service_type: delivery.service_type,
      });
    }

    await supabase
      .from("drivers")
      .update({
        available: false,
        current_ride_id: mission.ride_id || null,
        current_delivery_order_id: mission.delivery_order_id || null,
        updated_at: nowIso(),
      })
      .eq("id", driver.id);

    return ok(res, {
      message: "Mission accepted.",
      mission: updatedMission,
      ride,
      delivery,
    });
  } catch (error) {
    return serverError(res, error, "Could not accept mission.");
  }
});

/* =========================================================
   MISSION REJECT
========================================================= */

app.post("/api/driver/missions/reject", async (req, res) => {
  try {
    const driverId = safeTrim(req.body.driver_id || req.body.driverId);
    const missionId = safeTrim(req.body.mission_id || req.body.missionId);
    const reason = normalizeText(req.body.reason || "Driver rejected mission.");

    if (!driverId || !missionId) {
      return fail(res, 400, "Driver ID and mission ID are required.");
    }

    const mission = await dbFindById("missions", missionId);
    if (!mission) return fail(res, 404, "Mission not found.");

    if (mission.driver_id !== driverId) {
      return fail(res, 403, "Mission does not belong to this driver.");
    }

    if (mission.status !== "offered") {
      return fail(res, 409, `Mission cannot be rejected from status ${mission.status}.`);
    }

    const updatedMission = await dbUpdateById("missions", mission.id, {
      status: "rejected",
      rejected_at: nowIso(),
      rejection_reason: reason,
    });

    const { data: dispatches, error: dispatchError } = await supabase
      .from("dispatches")
      .select("*")
      .eq("mission_id", mission.id)
      .limit(1);

    if (dispatchError) throw dispatchError;

    const dispatch = dispatches?.[0] || null;

    if (dispatch) {
      await dbUpdateById("dispatches", dispatch.id, {
        status: "rejected",
        rejected_at: nowIso(),
        rejection_reason: reason,
      });
    }

    if (mission.ride_id) {
      await rideEvent(mission.ride_id, "mission_rejected", {
        driver_id: driverId,
        mission_id: mission.id,
        dispatch_id: dispatch?.id || null,
        reason,
      });

      if (ENABLE_AUTO_REDISPATCH) await dispatchRide(mission.ride_id);
    }

    if (mission.delivery_order_id) {
      await deliveryEvent(mission.delivery_order_id, "mission_rejected", {
        driver_id: driverId,
        mission_id: mission.id,
        dispatch_id: dispatch?.id || null,
        reason,
      });

      if (ENABLE_AUTO_REDISPATCH) await dispatchDelivery(mission.delivery_order_id);
    }

    return ok(res, {
      message: "Mission rejected.",
      mission: updatedMission,
    });
  } catch (error) {
    return serverError(res, error, "Could not reject mission.");
  }
});

/* =========================================================
   RIDE LIFECYCLE HELPERS
========================================================= */

async function getRideForDriverAction({ rideId, driverId }) {
  const ride = await dbFindById("rides", rideId);

  if (!ride) {
    const error = new Error("Ride not found.");
    error.status = 404;
    throw error;
  }

  if (ride.driver_id !== driverId) {
    const error = new Error("Ride does not belong to this driver.");
    error.status = 403;
    throw error;
  }

  return ride;
}

async function updateMissionForRide(rideId, payload) {
  const { data, error } = await supabase
    .from("missions")
    .select("*")
    .eq("ride_id", rideId)
    .in("status", ["accepted", "en_route", "arrived", "in_progress"])
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) throw error;

  const mission = data?.[0];
  if (!mission) return null;

  return dbUpdateById("missions", mission.id, payload);
}

/* =========================================================
   RIDE DRIVER EN ROUTE
========================================================= */

app.post("/api/driver/trip/en-route", async (req, res) => {
  try {
    const driverId = safeTrim(req.body.driver_id || req.body.driverId);
    const rideId = safeTrim(req.body.ride_id || req.body.rideId);

    if (!driverId || !rideId) return fail(res, 400, "Driver ID and ride ID are required.");

    const ride = await getRideForDriverAction({ rideId, driverId });

    if (ride.status !== "driver_assigned") {
      return fail(res, 409, `Ride cannot move en route from status ${ride.status}.`);
    }

    const updatedRide = await dbUpdateById("rides", ride.id, {
      status: "driver_en_route",
      en_route_at: nowIso(),
    });

    const mission = await updateMissionForRide(ride.id, {
      status: "en_route",
      en_route_at: nowIso(),
    });

    await rideEvent(ride.id, "driver_en_route", {
      driver_id: driverId,
      mission_id: mission?.id || null,
    });

    return ok(res, {
      message: "Driver is en route.",
      ride: updatedRide,
      mission,
    });
  } catch (error) {
    return serverError(res, error, error.message || "Could not update trip.");
  }
});

/* =========================================================
   RIDE DRIVER ARRIVED
========================================================= */

app.post("/api/driver/trip/arrived", async (req, res) => {
  try {
    const driverId = safeTrim(req.body.driver_id || req.body.driverId);
    const rideId = safeTrim(req.body.ride_id || req.body.rideId);

    if (!driverId || !rideId) return fail(res, 400, "Driver ID and ride ID are required.");

    const ride = await getRideForDriverAction({ rideId, driverId });

    if (ride.status !== "driver_en_route") {
      return fail(res, 409, `Ride cannot mark arrived from status ${ride.status}.`);
    }

    const updatedRide = await dbUpdateById("rides", ride.id, {
      status: "driver_arrived",
      arrived_at: nowIso(),
    });

    const mission = await updateMissionForRide(ride.id, {
      status: "arrived",
      arrived_at: nowIso(),
    });

    await rideEvent(ride.id, "driver_arrived", {
      driver_id: driverId,
      mission_id: mission?.id || null,
    });

    return ok(res, {
      message: "Driver arrived.",
      ride: updatedRide,
      mission,
    });
  } catch (error) {
    return serverError(res, error, error.message || "Could not mark arrived.");
  }
});

/* =========================================================
   RIDE START
========================================================= */

app.post("/api/driver/trip/start", async (req, res) => {
  try {
    const driverId = safeTrim(req.body.driver_id || req.body.driverId);
    const rideId = safeTrim(req.body.ride_id || req.body.rideId);

    if (!driverId || !rideId) return fail(res, 400, "Driver ID and ride ID are required.");

    const ride = await getRideForDriverAction({ rideId, driverId });

    if (ride.status !== "driver_arrived") {
      return fail(res, 409, `Ride cannot start from status ${ride.status}.`);
    }

    const updatedRide = await dbUpdateById("rides", ride.id, {
      status: "in_progress",
      started_at: nowIso(),
    });

    const mission = await updateMissionForRide(ride.id, {
      status: "in_progress",
      started_at: nowIso(),
    });

    await rideEvent(ride.id, "trip_started", {
      driver_id: driverId,
      mission_id: mission?.id || null,
    });

    return ok(res, {
      message: "Trip started.",
      ride: updatedRide,
      mission,
    });
  } catch (error) {
    return serverError(res, error, error.message || "Could not start trip.");
  }
});

/* =========================================================
   RIDE COMPLETE
========================================================= */

app.post("/api/driver/trip/complete", async (req, res) => {
  try {
    const driverId = safeTrim(req.body.driver_id || req.body.driverId);
    const rideId = safeTrim(req.body.ride_id || req.body.rideId);

    if (!driverId || !rideId) return fail(res, 400, "Driver ID and ride ID are required.");

    const ride = await getRideForDriverAction({ rideId, driverId });

    if (ride.status !== "in_progress") {
      return fail(res, 409, `Ride cannot complete from status ${ride.status}.`);
    }

    let capturedPayment = null;

    if (ride.payment_id) {
      capturedPayment = await capturePayment(ride.payment_id, ride.fare_total);
    }

    const updatedRide = await dbUpdateById("rides", ride.id, {
      status: "completed",
      completed_at: nowIso(),
      payment_status: capturedPayment?.status || ride.payment_status || null,
    });

    const mission = await updateMissionForRide(ride.id, {
      status: "completed",
      completed_at: nowIso(),
    });

    await supabase
      .from("drivers")
      .update({
        available: true,
        current_ride_id: null,
        current_delivery_order_id: null,
        updated_at: nowIso(),
      })
      .eq("id", driverId);

    const { data: existingEarnings, error: earningCheckError } = await supabase
      .from("driver_earnings")
      .select("*")
      .eq("ride_id", ride.id)
      .eq("type", "ride_payout")
      .limit(1);

    if (earningCheckError) throw earningCheckError;

    let earning = existingEarnings?.[0] || null;

    if (!earning) {
      earning = await dbInsert("driver_earnings", {
        driver_id: driverId,
        ride_id: ride.id,
        amount: roundMoney(ride.driver_payout || ride.fare_total * DRIVER_PAYOUT_PERCENT),
        type: "ride_payout",
        status: "pending",
        currency: "usd",
        created_at: nowIso(),
        updated_at: nowIso(),
      });
    }

    await rideEvent(ride.id, "trip_completed", {
      driver_id: driverId,
      mission_id: mission?.id || null,
      payment_id: ride.payment_id || null,
      earning_id: earning?.id || null,
    });

    return ok(res, {
      message: "Trip completed.",
      ride: updatedRide,
      mission,
      payment: capturedPayment,
      earning,
    });
  } catch (error) {
    return serverError(res, error, error.message || "Could not complete trip.");
  }
});

/* =========================================================
   DELIVERY HELPERS
========================================================= */

async function getDeliveryForDriverAction({ deliveryOrderId, driverId }) {
  const order = await dbFindById("delivery_orders", deliveryOrderId);

  if (!order) {
    const error = new Error("Delivery order not found.");
    error.status = 404;
    throw error;
  }

  if (order.driver_id !== driverId) {
    const error = new Error("Delivery order does not belong to this driver.");
    error.status = 403;
    throw error;
  }

  return order;
}

async function updateMissionForDelivery(deliveryOrderId, payload) {
  const { data, error } = await supabase
    .from("missions")
    .select("*")
    .eq("delivery_order_id", deliveryOrderId)
    .in("status", [
      "accepted",
      "driver_en_route_to_store",
      "arrived_at_store",
      "picked_up",
      "en_route_to_customer",
      "arrived_at_customer",
    ])
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) throw error;

  const mission = data?.[0];
  if (!mission) return null;

  return dbUpdateById("missions", mission.id, payload);
}

/* =========================================================
   DELIVERY EN ROUTE TO STORE
========================================================= */

app.post("/api/driver/delivery/en-route-store", async (req, res) => {
  try {
    const driverId = safeTrim(req.body.driver_id || req.body.driverId);
    const deliveryOrderId = safeTrim(req.body.delivery_order_id || req.body.deliveryOrderId);

    if (!driverId || !deliveryOrderId) {
      return fail(res, 400, "Driver ID and delivery order ID are required.");
    }

    const order = await getDeliveryForDriverAction({ deliveryOrderId, driverId });

    if (order.status !== "driver_assigned") {
      return fail(res, 409, `Delivery cannot move en route to store from status ${order.status}.`);
    }

    const updated = await dbUpdateById("delivery_orders", order.id, {
      status: "driver_en_route_to_store",
      en_route_store_at: nowIso(),
    });

    const mission = await updateMissionForDelivery(order.id, {
      status: "driver_en_route_to_store",
      en_route_store_at: nowIso(),
    });

    await deliveryEvent(order.id, "driver_en_route_to_store", {
      driver_id: driverId,
      mission_id: mission?.id || null,
    });

    return ok(res, {
      message: "Driver is en route to pickup/store.",
      delivery: publicDeliveryOrder(updated),
      mission,
    });
  } catch (error) {
    return serverError(res, error, "Could not update delivery.");
  }
});

/* =========================================================
   DELIVERY ARRIVED AT STORE
========================================================= */

app.post("/api/driver/delivery/arrived-store", async (req, res) => {
  try {
    const driverId = safeTrim(req.body.driver_id || req.body.driverId);
    const deliveryOrderId = safeTrim(req.body.delivery_order_id || req.body.deliveryOrderId);

    if (!driverId || !deliveryOrderId) {
      return fail(res, 400, "Driver ID and delivery order ID are required.");
    }

    const order = await getDeliveryForDriverAction({ deliveryOrderId, driverId });

    if (order.status !== "driver_en_route_to_store") {
      return fail(res, 409, `Delivery cannot mark arrived at store from status ${order.status}.`);
    }

    const updated = await dbUpdateById("delivery_orders", order.id, {
      status: "arrived_at_store",
      arrived_store_at: nowIso(),
    });

    const mission = await updateMissionForDelivery(order.id, {
      status: "arrived_at_store",
      arrived_store_at: nowIso(),
    });

    await deliveryEvent(order.id, "driver_arrived_at_store", {
      driver_id: driverId,
      mission_id: mission?.id || null,
    });

    return ok(res, {
      message: "Driver arrived at pickup/store.",
      delivery: publicDeliveryOrder(updated),
      mission,
    });
  } catch (error) {
    return serverError(res, error, "Could not mark arrived at store.");
  }
});

/* =========================================================
   DELIVERY PICKED UP
========================================================= */

app.post("/api/driver/delivery/picked-up", async (req, res) => {
  try {
    const driverId = safeTrim(req.body.driver_id || req.body.driverId);
    const deliveryOrderId = safeTrim(req.body.delivery_order_id || req.body.deliveryOrderId);

    if (!driverId || !deliveryOrderId) {
      return fail(res, 400, "Driver ID and delivery order ID are required.");
    }

    const order = await getDeliveryForDriverAction({ deliveryOrderId, driverId });

    if (order.status !== "arrived_at_store") {
      return fail(res, 409, `Delivery cannot be picked up from status ${order.status}.`);
    }

    const updated = await dbUpdateById("delivery_orders", order.id, {
      status: "picked_up",
      picked_up_at: nowIso(),
    });

    const mission = await updateMissionForDelivery(order.id, {
      status: "picked_up",
      picked_up_at: nowIso(),
    });

    await deliveryEvent(order.id, "delivery_picked_up", {
      driver_id: driverId,
      mission_id: mission?.id || null,
    });

    return ok(res, {
      message: "Delivery picked up.",
      delivery: publicDeliveryOrder(updated),
      mission,
    });
  } catch (error) {
    return serverError(res, error, "Could not mark delivery picked up.");
  }
});

/* =========================================================
   DELIVERY EN ROUTE TO CUSTOMER
========================================================= */

app.post("/api/driver/delivery/en-route-customer", async (req, res) => {
  try {
    const driverId = safeTrim(req.body.driver_id || req.body.driverId);
    const deliveryOrderId = safeTrim(req.body.delivery_order_id || req.body.deliveryOrderId);

    if (!driverId || !deliveryOrderId) {
      return fail(res, 400, "Driver ID and delivery order ID are required.");
    }

    const order = await getDeliveryForDriverAction({ deliveryOrderId, driverId });

    if (order.status !== "picked_up") {
      return fail(res, 409, `Delivery cannot move en route to customer from status ${order.status}.`);
    }

    const updated = await dbUpdateById("delivery_orders", order.id, {
      status: "en_route_to_customer",
      en_route_customer_at: nowIso(),
    });

    const mission = await updateMissionForDelivery(order.id, {
      status: "en_route_to_customer",
      en_route_customer_at: nowIso(),
    });

    await deliveryEvent(order.id, "driver_en_route_to_customer", {
      driver_id: driverId,
      mission_id: mission?.id || null,
    });

    return ok(res, {
      message: "Driver is en route to customer.",
      delivery: publicDeliveryOrder(updated),
      mission,
    });
  } catch (error) {
    return serverError(res, error, "Could not update delivery to customer.");
  }
});

/* =========================================================
   DELIVERY ARRIVED AT CUSTOMER
========================================================= */

app.post("/api/driver/delivery/arrived-customer", async (req, res) => {
  try {
    const driverId = safeTrim(req.body.driver_id || req.body.driverId);
    const deliveryOrderId = safeTrim(req.body.delivery_order_id || req.body.deliveryOrderId);

    if (!driverId || !deliveryOrderId) {
      return fail(res, 400, "Driver ID and delivery order ID are required.");
    }

    const order = await getDeliveryForDriverAction({ deliveryOrderId, driverId });

    if (order.status !== "en_route_to_customer") {
      return fail(res, 409, `Delivery cannot mark arrived at customer from status ${order.status}.`);
    }

    const updated = await dbUpdateById("delivery_orders", order.id, {
      status: "arrived_at_customer",
      arrived_customer_at: nowIso(),
    });

    const mission = await updateMissionForDelivery(order.id, {
      status: "arrived_at_customer",
      arrived_customer_at: nowIso(),
    });

    await deliveryEvent(order.id, "driver_arrived_at_customer", {
      driver_id: driverId,
      mission_id: mission?.id || null,
    });

    return ok(res, {
      message: "Driver arrived at customer.",
      delivery: publicDeliveryOrder(updated),
      mission,
    });
  } catch (error) {
    return serverError(res, error, "Could not mark arrived at customer.");
  }
});

/* =========================================================
   DELIVERY COMPLETE
========================================================= */

app.post("/api/driver/delivery/complete", async (req, res) => {
  try {
    const driverId = safeTrim(req.body.driver_id || req.body.driverId);
    const deliveryOrderId = safeTrim(req.body.delivery_order_id || req.body.deliveryOrderId);

    if (!driverId || !deliveryOrderId) {
      return fail(res, 400, "Driver ID and delivery order ID are required.");
    }

    const order = await getDeliveryForDriverAction({ deliveryOrderId, driverId });

    if (order.status !== "arrived_at_customer") {
      return fail(res, 409, `Delivery cannot complete from status ${order.status}.`);
    }

    let capturedPayment = null;

    if (order.payment_id) {
      capturedPayment = await capturePayment(order.payment_id, order.total);
    }

    const updated = await dbUpdateById("delivery_orders", order.id, {
      status: "completed",
      completed_at: nowIso(),
      payment_status: capturedPayment?.status || order.payment_status || null,
    });

    const mission = await updateMissionForDelivery(order.id, {
      status: "completed",
      completed_at: nowIso(),
    });

    await supabase
      .from("drivers")
      .update({
        available: true,
        current_ride_id: null,
        current_delivery_order_id: null,
        updated_at: nowIso(),
      })
      .eq("id", driverId);

    const { data: existingEarnings, error: earningCheckError } = await supabase
      .from("driver_earnings")
      .select("*")
      .eq("delivery_order_id", order.id)
      .eq("type", "delivery_payout")
      .limit(1);

    if (earningCheckError) throw earningCheckError;

    let earning = existingEarnings?.[0] || null;

    if (!earning) {
      earning = await dbInsert("driver_earnings", {
        driver_id: driverId,
        delivery_order_id: order.id,
        amount: roundMoney(order.driver_payout),
        type: "delivery_payout",
        service_type: order.service_type,
        status: "pending",
        currency: "usd",
        created_at: nowIso(),
        updated_at: nowIso(),
      });
    }

    await deliveryEvent(order.id, "delivery_completed", {
      driver_id: driverId,
      mission_id: mission?.id || null,
      payment_id: order.payment_id || null,
      earning_id: earning?.id || null,
    });

    return ok(res, {
      message: "Delivery completed.",
      delivery: publicDeliveryOrder(updated),
      mission,
      payment: capturedPayment,
      earning,
    });
  } catch (error) {
    return serverError(res, error, "Could not complete delivery.");
  }
});

/* =========================================================
   COMPATIBILITY ROUTES
========================================================= */

app.post("/api/driver/accept", (req, res) => {
  req.body.mission_id = req.body.mission_id || req.body.missionId;
  req.url = "/api/driver/missions/accept";
  return app._router.handle(req, res);
});

app.post("/api/driver/reject", (req, res) => {
  req.body.mission_id = req.body.mission_id || req.body.missionId;
  req.url = "/api/driver/missions/reject";
  return app._router.handle(req, res);
});

app.post("/api/driver/en-route", (req, res) => {
  req.url = "/api/driver/trip/en-route";
  return app._router.handle(req, res);
});

app.post("/api/driver/arrived", (req, res) => {
  req.url = "/api/driver/trip/arrived";
  return app._router.handle(req, res);
});

app.post("/api/driver/start", (req, res) => {
  req.url = "/api/driver/trip/start";
  return app._router.handle(req, res);
});

app.post("/api/driver/complete", (req, res) => {
  req.url = "/api/driver/trip/complete";
  return app._router.handle(req, res);
});

/* =========================================================
   PART 7 END
   NEXT: SEND TRUE DELIVERY SERVER PART 8
   Part 8 = Status APIs + cancel + tips + earnings + payouts
========================================================= *//* =========================================================
   HARVEY TAXI — TRUE CODE BLUE DELIVERY SERVER.JS
   PART 8 OF 9
   STATUS APIS + CANCEL + TIPS + EARNINGS + PAYOUTS
========================================================= */

/* =========================================================
   RIDER RIDE STATUS
========================================================= */

app.get("/api/rides/status", async (req, res) => {
  try {
    const rideId = safeTrim(req.query.ride_id || req.query.rideId || req.query.id);
    const riderId = safeTrim(req.query.rider_id || req.query.riderId);

    if (!rideId && !riderId) {
      return fail(res, 400, "Ride ID or rider ID is required.");
    }

    let query = supabase
      .from("rides")
      .select("*")
      .order("created_at", { ascending: false });

    if (rideId) query = query.eq("id", rideId).limit(1);
    if (riderId) query = query.eq("rider_id", riderId).limit(25);

    const { data, error } = await query;
    if (error) throw error;

    return ok(res, {
      rides: data || [],
      ride: rideId ? data?.[0] || null : undefined,
    });
  } catch (error) {
    return serverError(res, error, "Could not load ride status.");
  }
});

/* =========================================================
   DELIVERY STATUS
========================================================= */

app.get("/api/delivery/status", async (req, res) => {
  try {
    const deliveryOrderId = safeTrim(
      req.query.delivery_order_id || req.query.deliveryOrderId || req.query.id
    );

    const riderId = safeTrim(req.query.rider_id || req.query.riderId);

    if (!deliveryOrderId && !riderId) {
      return fail(res, 400, "Delivery order ID or rider ID is required.");
    }

    let query = supabase
      .from("delivery_orders")
      .select("*")
      .order("created_at", { ascending: false });

    if (deliveryOrderId) query = query.eq("id", deliveryOrderId).limit(1);
    if (riderId) query = query.eq("rider_id", riderId).limit(25);

    const { data, error } = await query;
    if (error) throw error;

    return ok(res, {
      deliveries: data || [],
      delivery: deliveryOrderId ? publicDeliveryOrder(data?.[0] || {}) : undefined,
    });
  } catch (error) {
    return serverError(res, error, "Could not load delivery status.");
  }
});

/* =========================================================
   RIDER HISTORY
========================================================= */

app.get("/api/rider/history", async (req, res) => {
  try {
    const riderId = safeTrim(req.query.rider_id || req.query.riderId);

    if (!riderId) return fail(res, 400, "Rider ID is required.");

    const [ridesResult, deliveryResult] = await Promise.all([
      supabase
        .from("rides")
        .select("*")
        .eq("rider_id", riderId)
        .order("created_at", { ascending: false })
        .limit(50),
      supabase
        .from("delivery_orders")
        .select("*")
        .eq("rider_id", riderId)
        .order("created_at", { ascending: false })
        .limit(50),
    ]);

    if (ridesResult.error) throw ridesResult.error;
    if (deliveryResult.error) throw deliveryResult.error;

    return ok(res, {
      riderId,
      rides: ridesResult.data || [],
      deliveries: (deliveryResult.data || []).map(publicDeliveryOrder),
    });
  } catch (error) {
    return serverError(res, error, "Could not load rider history.");
  }
});

/* =========================================================
   DRIVER CURRENT WORK
========================================================= */

app.get("/api/driver/current-work", async (req, res) => {
  try {
    const driverId = safeTrim(req.query.driver_id || req.query.driverId);

    if (!driverId) return fail(res, 400, "Driver ID is required.");

    const driver = await dbFindById("drivers", driverId);
    if (!driver) return fail(res, 404, "Driver not found.");

    let ride = null;
    let delivery = null;

    if (driver.current_ride_id) {
      ride = await dbFindById("rides", driver.current_ride_id);
    }

    if (driver.current_delivery_order_id) {
      delivery = await dbFindById(
        "delivery_orders",
        driver.current_delivery_order_id
      );
    }

    return ok(res, {
      driver: publicDriver(driver),
      ride,
      delivery: delivery ? publicDeliveryOrder(delivery) : null,
    });
  } catch (error) {
    return serverError(res, error, "Could not load current driver work.");
  }
});

/* =========================================================
   CANCEL RIDE
========================================================= */

app.post("/api/rides/cancel", async (req, res) => {
  try {
    const rideId = safeTrim(req.body.ride_id || req.body.rideId);
    const riderId = safeTrim(req.body.rider_id || req.body.riderId);
    const reason = normalizeText(req.body.reason || "Canceled by rider.");

    if (!rideId || !riderId) {
      return fail(res, 400, "Ride ID and rider ID are required.");
    }

    const ride = await dbFindById("rides", rideId);
    if (!ride) return fail(res, 404, "Ride not found.");

    if (ride.rider_id !== riderId) {
      return fail(res, 403, "Ride does not belong to this rider.");
    }

    if (["completed", "canceled"].includes(ride.status)) {
      return fail(res, 409, `Ride cannot be canceled from status ${ride.status}.`);
    }

    if (ride.payment_id) {
      try {
        await cancelPayment(ride.payment_id, "requested_by_customer");
      } catch (paymentError) {
        console.warn("⚠️ Ride cancel payment warning:", paymentError.message);
      }
    }

    const updatedRide = await dbUpdateById("rides", ride.id, {
      status: "canceled",
      canceled_by: "rider",
      canceled_at: nowIso(),
      cancellation_reason: reason,
    });

    if (ride.driver_id) {
      await supabase
        .from("drivers")
        .update({
          available: true,
          current_ride_id: null,
          current_delivery_order_id: null,
          updated_at: nowIso(),
        })
        .eq("id", ride.driver_id);
    }

    if (ride.current_mission_id) {
      await dbUpdateById("missions", ride.current_mission_id, {
        status: "canceled",
        canceled_at: nowIso(),
        cancellation_reason: reason,
      });
    }

    await rideEvent(ride.id, "ride_canceled", {
      rider_id: riderId,
      reason,
    });

    return ok(res, {
      message: "Ride canceled.",
      ride: updatedRide,
    });
  } catch (error) {
    return serverError(res, error, "Could not cancel ride.");
  }
});

/* =========================================================
   CANCEL DELIVERY
========================================================= */

app.post("/api/delivery/cancel", async (req, res) => {
  try {
    const deliveryOrderId = safeTrim(
      req.body.delivery_order_id || req.body.deliveryOrderId
    );

    const riderId = safeTrim(req.body.rider_id || req.body.riderId);
    const reason = normalizeText(req.body.reason || "Canceled by rider.");

    if (!deliveryOrderId || !riderId) {
      return fail(res, 400, "Delivery order ID and rider ID are required.");
    }

    const order = await dbFindById("delivery_orders", deliveryOrderId);
    if (!order) return fail(res, 404, "Delivery order not found.");

    if (order.rider_id !== riderId) {
      return fail(res, 403, "Delivery order does not belong to this rider.");
    }

    if (["completed", "canceled"].includes(order.status)) {
      return fail(res, 409, `Delivery cannot be canceled from status ${order.status}.`);
    }

    if (order.payment_id) {
      try {
        await cancelPayment(order.payment_id, "requested_by_customer");
      } catch (paymentError) {
        console.warn("⚠️ Delivery cancel payment warning:", paymentError.message);
      }
    }

    const updated = await dbUpdateById("delivery_orders", order.id, {
      status: "canceled",
      canceled_by: "rider",
      canceled_at: nowIso(),
      cancellation_reason: reason,
    });

    if (order.driver_id) {
      await supabase
        .from("drivers")
        .update({
          available: true,
          current_ride_id: null,
          current_delivery_order_id: null,
          updated_at: nowIso(),
        })
        .eq("id", order.driver_id);
    }

    if (order.current_mission_id) {
      await dbUpdateById("missions", order.current_mission_id, {
        status: "canceled",
        canceled_at: nowIso(),
        cancellation_reason: reason,
      });
    }

    await deliveryEvent(order.id, "delivery_canceled", {
      rider_id: riderId,
      reason,
    });

    return ok(res, {
      message: "Delivery canceled.",
      delivery: publicDeliveryOrder(updated),
    });
  } catch (error) {
    return serverError(res, error, "Could not cancel delivery.");
  }
});

/* =========================================================
   TIP DRIVER
========================================================= */

app.post("/api/tips/create", async (req, res) => {
  try {
    const riderId = safeTrim(req.body.rider_id || req.body.riderId);
    const driverId = safeTrim(req.body.driver_id || req.body.driverId);
    const rideId = safeTrim(req.body.ride_id || req.body.rideId);
    const deliveryOrderId = safeTrim(
      req.body.delivery_order_id || req.body.deliveryOrderId
    );

    const amount = roundMoney(req.body.amount || req.body.tip_amount);

    if (!riderId || !driverId || !amount || amount <= 0) {
      return fail(res, 400, "Rider ID, driver ID, and tip amount are required.");
    }

    if (!rideId && !deliveryOrderId) {
      return fail(res, 400, "Ride ID or delivery order ID is required for a tip.");
    }

    const rider = await dbFindById("riders", riderId);
    if (!rider) return fail(res, 404, "Rider not found.");

    if (!stripe) {
      return fail(res, 503, "Stripe is not configured for tips.");
    }

    const customerId = await getOrCreateStripeCustomerForRider(rider);

    const intent = await stripe.paymentIntents.create({
      amount: cents(amount),
      currency: "usd",
      customer: customerId,
      automatic_payment_methods: {
        enabled: true,
      },
      metadata: {
        app: "harvey_taxi",
        type: "tip",
        rider_id: riderId,
        driver_id: driverId,
        ride_id: rideId || "",
        delivery_order_id: deliveryOrderId || "",
      },
    });

    const payment = await dbInsert("payments", {
      rider_id: riderId,
      driver_id: driverId,
      ride_id: rideId || null,
      delivery_order_id: deliveryOrderId || null,
      amount,
      currency: "usd",
      status: intent.status,
      provider: "stripe",
      type: "tip",
      stripe_customer_id: customerId,
      stripe_payment_intent_id: intent.id,
      client_secret: intent.client_secret,
      created_at: nowIso(),
      updated_at: nowIso(),
    });

    const earning = await dbInsert("driver_earnings", {
      driver_id: driverId,
      ride_id: rideId || null,
      delivery_order_id: deliveryOrderId || null,
      payment_id: payment.id,
      amount,
      currency: "usd",
      type: "tip",
      status: "awaiting_payment",
      created_at: nowIso(),
      updated_at: nowIso(),
    });

    return ok(res, {
      message: "Tip payment created.",
      payment: {
        id: payment.id,
        amount,
        clientSecret: intent.client_secret,
        status: intent.status,
      },
      earning,
    });
  } catch (error) {
    return serverError(res, error, "Could not create tip.");
  }
});

/* =========================================================
   DRIVER EARNINGS
========================================================= */

app.get("/api/driver/earnings", async (req, res) => {
  try {
    const driverId = safeTrim(req.query.driver_id || req.query.driverId);

    if (!driverId) return fail(res, 400, "Driver ID is required.");

    const { data, error } = await supabase
      .from("driver_earnings")
      .select("*")
      .eq("driver_id", driverId)
      .order("created_at", { ascending: false })
      .limit(200);

    if (error) throw error;

    const earnings = data || [];

    const totals = earnings.reduce(
      (acc, earning) => {
        const amount = Number(earning.amount || 0);
        acc.total += amount;
        acc[earning.status] = (acc[earning.status] || 0) + amount;
        return acc;
      },
      { total: 0 }
    );

    Object.keys(totals).forEach((key) => {
      totals[key] = roundMoney(totals[key]);
    });

    return ok(res, {
      driverId,
      totals,
      earnings,
    });
  } catch (error) {
    return serverError(res, error, "Could not load driver earnings.");
  }
});

/* =========================================================
   ADMIN EARNINGS LIST
========================================================= */

app.get("/api/admin/earnings", requireAdmin, async (req, res) => {
  try {
    const status = normalizeLower(req.query.status || "");
    const driverId = safeTrim(req.query.driver_id || req.query.driverId);

    let query = supabase
      .from("driver_earnings")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500);

    if (status) query = query.eq("status", status);
    if (driverId) query = query.eq("driver_id", driverId);

    const { data, error } = await query;
    if (error) throw error;

    return ok(res, {
      earnings: data || [],
    });
  } catch (error) {
    return serverError(res, error, "Could not load earnings.");
  }
});

/* =========================================================
   ADMIN MARK EARNING AVAILABLE
========================================================= */

app.post("/api/admin/earnings/mark-available", requireAdmin, async (req, res) => {
  try {
    const earningId = safeTrim(req.body.earning_id || req.body.earningId);

    if (!earningId) return fail(res, 400, "Earning ID is required.");

    const earning = await dbFindById("driver_earnings", earningId);
    if (!earning) return fail(res, 404, "Earning not found.");

    if (earning.status !== "pending") {
      return fail(res, 409, `Earning cannot be marked available from status ${earning.status}.`);
    }

    const updated = await dbUpdateById("driver_earnings", earning.id, {
      status: "available",
      available_at: nowIso(),
    });

    await auditLog("earning_marked_available", {
      admin: req.admin.email,
      earning_id: earning.id,
    });

    return ok(res, {
      message: "Earning marked available.",
      earning: updated,
    });
  } catch (error) {
    return serverError(res, error, "Could not mark earning available.");
  }
});

/* =========================================================
   ADMIN CREATE PAYOUT
========================================================= */

app.post("/api/admin/payouts/create", requireAdmin, async (req, res) => {
  try {
    const driverId = safeTrim(req.body.driver_id || req.body.driverId);

    const earningIds = Array.isArray(req.body.earning_ids)
      ? req.body.earning_ids.map(safeTrim).filter(Boolean)
      : [];

    if (!driverId) return fail(res, 400, "Driver ID is required.");
    if (!earningIds.length) return fail(res, 400, "At least one earning ID is required.");

    const { data: earnings, error } = await supabase
      .from("driver_earnings")
      .select("*")
      .eq("driver_id", driverId)
      .in("id", earningIds);

    if (error) throw error;

    const invalid = (earnings || []).filter((earning) => earning.status !== "available");

    if (invalid.length) {
      return fail(res, 409, "Only available earnings can be paid out.");
    }

    const amount = roundMoney(
      (earnings || []).reduce((sum, earning) => {
        return sum + Number(earning.amount || 0);
      }, 0)
    );

    const payout = await dbInsert("driver_payouts", {
      driver_id: driverId,
      amount,
      currency: "usd",
      status: "pending",
      earning_ids: earningIds,
      created_by: req.admin.email,
      created_at: nowIso(),
      updated_at: nowIso(),
    });

    await supabase
      .from("driver_earnings")
      .update({
        status: "payout_pending",
        payout_id: payout.id,
        updated_at: nowIso(),
      })
      .in("id", earningIds);

    await auditLog("driver_payout_created", {
      admin: req.admin.email,
      driver_id: driverId,
      payout_id: payout.id,
      amount,
      earning_ids: earningIds,
    });

    return ok(res, {
      message: "Payout created.",
      payout,
    });
  } catch (error) {
    return serverError(res, error, "Could not create payout.");
  }
});

/* =========================================================
   ADMIN MARK PAYOUT PAID
========================================================= */

app.post("/api/admin/payouts/mark-paid", requireAdmin, async (req, res) => {
  try {
    const payoutId = safeTrim(req.body.payout_id || req.body.payoutId);
    const reference = normalizeText(req.body.reference || req.body.payment_reference);

    if (!payoutId) return fail(res, 400, "Payout ID is required.");

    const payout = await dbFindById("driver_payouts", payoutId);
    if (!payout) return fail(res, 404, "Payout not found.");

    const paidAt = nowIso();

    const updated = await dbUpdateById("driver_payouts", payout.id, {
      status: "paid",
      paid_at: paidAt,
      payment_reference: reference || null,
    });

    const earningIds = Array.isArray(payout.earning_ids)
      ? payout.earning_ids
      : parseJsonMaybe(payout.earning_ids, []);

    if (earningIds.length) {
      await supabase
        .from("driver_earnings")
        .update({
          status: "paid",
          paid_at: paidAt,
          updated_at: nowIso(),
        })
        .in("id", earningIds);
    }

    await auditLog("driver_payout_marked_paid", {
      admin: req.admin.email,
      payout_id: payout.id,
      reference,
    });

    return ok(res, {
      message: "Payout marked paid.",
      payout: updated,
    });
  } catch (error) {
    return serverError(res, error, "Could not mark payout paid.");
  }
});

/* =========================================================
   ADMIN PAYOUT LIST
========================================================= */

app.get("/api/admin/payouts", requireAdmin, async (req, res) => {
  try {
    const driverId = safeTrim(req.query.driver_id || req.query.driverId);
    const status = normalizeLower(req.query.status || "");

    let query = supabase
      .from("driver_payouts")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500);

    if (driverId) query = query.eq("driver_id", driverId);
    if (status) query = query.eq("status", status);

    const { data, error } = await query;
    if (error) throw error;

    return ok(res, {
      payouts: data || [],
    });
  } catch (error) {
    return serverError(res, error, "Could not load payouts.");
  }
});

/* =========================================================
   PART 8 END
   NEXT: SEND TRUE DELIVERY SERVER PART 9
   Part 9 = Admin dashboard + AI support + dispatch sweep + startup checks + server start
========================================================= *//* =========================================================
   HARVEY TAXI — TRUE CODE BLUE DELIVERY SERVER.JS
   PART 9 OF 9
   ADMIN DASHBOARD + AI SUPPORT + DISPATCH SWEEP
   STARTUP CHECKS + SERVER START
========================================================= */

/* =========================================================
   HARVEY TAXI — CODE BLUE AI ADMIN BRAIN
   Admin AI Operations Assistant
========================================================= */

const ADMIN_AI_MODEL = env("ADMIN_AI_MODEL", OPENAI_MODEL || "gpt-4o-mini");

function compactRows(rows = [], limit = 25) {
  return (rows || []).slice(0, limit).map((row) => ({
    id: row.id,
    status: row.status || row.approval_status || row.payment_status || null,
    service_type: row.service_type || row.ride_type || row.type || null,
    rider_id: row.rider_id || null,
    driver_id: row.driver_id || null,
    pickup_address: row.pickup_address || null,
    dropoff_address: row.dropoff_address || null,
    total: row.total || row.amount || row.fare_total || row.estimated_total || null,
    driver_payout: row.driver_payout || row.estimated_driver_payout || null,
    payment_status: row.payment_status || null,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
  }));
}

function isStale(row, minutes = 15) {
  const time = new Date(row.updated_at || row.created_at || 0).getTime();
  if (!time) return false;
  return Date.now() - time > minutes * 60 * 1000;
}

async function buildAdminAiContext() {
  const [riders, drivers, rides, deliveries, payments, earnings, payouts] =
    await Promise.all([
      supabase.from("riders").select("*").order("created_at", { ascending: false }).limit(200),
      supabase.from("drivers").select("*").order("created_at", { ascending: false }).limit(200),
      supabase.from("rides").select("*").order("created_at", { ascending: false }).limit(200),
      supabase.from("delivery_orders").select("*").order("created_at", { ascending: false }).limit(200),
      supabase.from("payments").select("*").order("created_at", { ascending: false }).limit(200),
      supabase.from("driver_earnings").select("*").order("created_at", { ascending: false }).limit(200),
      supabase.from("driver_payouts").select("*").order("created_at", { ascending: false }).limit(200),
    ]);

  for (const result of [riders, drivers, rides, deliveries, payments, earnings, payouts]) {
    if (result.error) throw result.error;
  }

  const riderRows = riders.data || [];
  const driverRows = drivers.data || [];
  const rideRows = rides.data || [];
  const deliveryRows = deliveries.data || [];
  const paymentRows = payments.data || [];
  const earningRows = earnings.data || [];
  const payoutRows = payouts.data || [];

  const activeRideStatuses = [
    "searching",
    "awaiting_driver_acceptance",
    "driver_assigned",
    "driver_en_route",
    "driver_arrived",
    "in_progress",
  ];

  const activeDeliveryStatuses = [
    "searching",
    "awaiting_driver_acceptance",
    "driver_assigned",
    "driver_en_route_to_store",
    "arrived_at_store",
    "picked_up",
    "en_route_to_customer",
    "arrived_at_customer",
  ];

  const stuckRides = rideRows.filter(
    (ride) => activeRideStatuses.includes(ride.status) && isStale(ride, 15)
  );

  const stuckDeliveries = deliveryRows.filter(
    (order) => activeDeliveryStatuses.includes(order.status) && isStale(order, 20)
  );

  const paymentRisks = paymentRows.filter((payment) =>
    ["failed", "canceled", "requires_payment_method", "requires_action"].includes(payment.status)
  );

  const pendingRiders = riderRows.filter((rider) =>
    ["pending", "manual_review", "pending_persona_verification"].includes(
      rider.approval_status || rider.status
    )
  );

  const pendingDrivers = driverRows.filter((driver) =>
    ["pending", "manual_review", "pending_email_verification", "background_check_invited"].includes(
      driver.approval_status || driver.status
    )
  );

  return {
    summary: {
      riders: {
        total: riderRows.length,
        pending: pendingRiders.length,
        approved: riderRows.filter((r) => r.approval_status === "approved").length,
      },
      drivers: {
        total: driverRows.length,
        pending: pendingDrivers.length,
        approved: driverRows.filter((d) => d.approval_status === "approved").length,
        online: driverRows.filter((d) => d.available === true).length,
      },
      rides: {
        total: rideRows.length,
        active: rideRows.filter((r) => activeRideStatuses.includes(r.status)).length,
        stuck: stuckRides.length,
        completed: rideRows.filter((r) => r.status === "completed").length,
      },
      deliveries: {
        total: deliveryRows.length,
        active: deliveryRows.filter((d) => activeDeliveryStatuses.includes(d.status)).length,
        stuck: stuckDeliveries.length,
        food: deliveryRows.filter((d) => d.service_type === "food").length,
        grocery: deliveryRows.filter((d) => d.service_type === "grocery").length,
      },
      payments: {
        total: paymentRows.length,
        risks: paymentRisks.length,
        capturedRevenue: roundMoney(
          paymentRows
            .filter((p) => ["captured", "succeeded"].includes(p.status))
            .reduce((sum, p) => sum + Number(p.amount || 0), 0)
        ),
      },
      earnings: {
        pending: earningRows.filter((e) => ["pending", "available", "payout_pending"].includes(e.status)).length,
        awaitingPayment: earningRows.filter((e) => e.status === "awaiting_payment").length,
      },
      payouts: {
        pending: payoutRows.filter((p) => ["pending", "created", "processing"].includes(p.status)).length,
        paid: payoutRows.filter((p) => p.status === "paid").length,
      },
    },

    priorityQueues: {
      pendingRiders: compactRows(pendingRiders, 15),
      pendingDrivers: compactRows(pendingDrivers, 15),
      stuckRides: compactRows(stuckRides, 15),
      stuckDeliveries: compactRows(stuckDeliveries, 15),
      paymentRisks: compactRows(paymentRisks, 15),
      recentRides: compactRows(rideRows, 15),
      recentDeliveries: compactRows(deliveryRows, 15),
      pendingEarnings: compactRows(
        earningRows.filter((e) => ["pending", "available", "payout_pending"].includes(e.status)),
        15
      ),
      pendingPayouts: compactRows(
        payoutRows.filter((p) => ["pending", "created", "processing"].includes(p.status)),
        15
      ),
    },
  };
}

app.post("/api/ai/admin-brain", requireAdmin, async (req, res) => {
  try {
    const command = normalizeText(req.body.command || req.body.message);

    if (!command) {
      return fail(res, 400, "AI command is required.");
    }

    const context = await buildAdminAiContext();

    if (!openai) {
      return ok(res, {
        response:
          "AI is not configured, but the admin context was loaded. Add OPENAI_API_KEY and make sure ENABLE_AI_SUPPORT=true in Render.",
        context,
      });
    }

    const systemPrompt = `
You are Harvey Taxi's AI Operations Brain.

You are helping the admin operate a real transportation and delivery platform.

Platform includes:
- Rider approvals
- Driver approvals
- Ride dispatch
- Fast food delivery
- Grocery delivery
- Payment authorization
- Stripe payment risk
- Driver earnings
- Driver payouts
- Redispatch needs
- Stuck ride and stuck delivery detection

Rules:
- Be direct and operational.
- Do not claim you performed actions unless a route confirms it.
- Give prioritized admin actions.
- Separate urgent issues from normal follow-up.
- Mention specific ride, delivery, driver, rider, payment, earning, or payout IDs when available.
- If there are no major issues, say what looks healthy.
`;

    const completion = await openai.chat.completions.create({
      model: ADMIN_AI_MODEL,
      temperature: 0.2,
      max_tokens: 900,
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: JSON.stringify({
            command,
            adminContext: context,
          }),
        },
      ],
    });

    const response =
      completion.choices?.[0]?.message?.content ||
      "AI completed the review, but no response text was returned.";

    await auditLog("admin_ai_brain_used", {
      admin: req.admin.email,
      command,
      model: ADMIN_AI_MODEL,
      summary: context.summary,
    });

    return ok(res, {
      response,
      result: response,
      model: ADMIN_AI_MODEL,
      summary: context.summary,
    });
  } catch (error) {
    return serverError(res, error, "Admin AI Brain failed.");
  }
});

/* Compatibility route for dashboard versions using /api/admin/ai-command */
app.post("/api/admin/ai-command", requireAdmin, async (req, res) => {
  req.url = "/api/ai/admin-brain";
  return app._router.handle(req, res);
});/* =========================================================
   ADMIN DASHBOARD
========================================================= */

app.get("/api/admin/dashboard", requireAdmin, async (req, res) => {
  try {
    const [riders, drivers, rides, deliveries, payments, earnings] =
      await Promise.all([
        supabase.from("riders").select("*"),
        supabase.from("drivers").select("*"),
        supabase.from("rides").select("*"),
        supabase.from("delivery_orders").select("*"),
        supabase.from("payments").select("*"),
        supabase.from("driver_earnings").select("*"),
      ]);

    if (riders.error) throw riders.error;
    if (drivers.error) throw drivers.error;
    if (rides.error) throw rides.error;
    if (deliveries.error) throw deliveries.error;
    if (payments.error) throw payments.error;
    if (earnings.error) throw earnings.error;

    const paymentRows = payments.data || [];
    const deliveryRows = deliveries.data || [];
    const rideRows = rides.data || [];
    const driverRows = drivers.data || [];
    const riderRows = riders.data || [];
    const earningRows = earnings.data || [];

    const capturedRevenue = paymentRows
      .filter((payment) =>
        ["captured", "succeeded"].includes(payment.status)
      )
      .reduce((sum, payment) => sum + Number(payment.amount || 0), 0);

    const pendingDriverEarnings = earningRows
      .filter((earning) =>
        ["pending", "available", "payout_pending"].includes(earning.status)
      )
      .reduce((sum, earning) => sum + Number(earning.amount || 0), 0);

    return ok(res, {
      dashboard: {
        riders: {
          total: riderRows.length,
          approved: riderRows.filter((r) => r.approval_status === "approved").length,
          pending: riderRows.filter((r) => r.approval_status === "pending").length,
        },
        drivers: {
          total: driverRows.length,
          approved: driverRows.filter((d) => d.approval_status === "approved").length,
          pending: driverRows.filter((d) => d.approval_status === "pending").length,
          online: driverRows.filter((d) => d.available === true).length,
          foodCapable: driverRows.filter((d) => d.supports_food_delivery !== false).length,
          groceryCapable: driverRows.filter((d) => d.supports_grocery_delivery !== false).length,
        },
        rides: {
          total: rideRows.length,
          completed: rideRows.filter((r) => r.status === "completed").length,
          active: rideRows.filter((r) =>
            [
              "searching",
              "awaiting_driver_acceptance",
              "driver_assigned",
              "driver_en_route",
              "driver_arrived",
              "in_progress",
            ].includes(r.status)
          ).length,
        },
        delivery: {
          total: deliveryRows.length,
          food: deliveryRows.filter((d) => d.service_type === "food").length,
          grocery: deliveryRows.filter((d) => d.service_type === "grocery").length,
          completed: deliveryRows.filter((d) => d.status === "completed").length,
          active: deliveryRows.filter((d) =>
            [
              "searching",
              "awaiting_driver_acceptance",
              "driver_assigned",
              "driver_en_route_to_store",
              "arrived_at_store",
              "picked_up",
              "en_route_to_customer",
              "arrived_at_customer",
            ].includes(d.status)
          ).length,
        },
        money: {
          capturedRevenue: roundMoney(capturedRevenue),
          pendingDriverEarnings: roundMoney(pendingDriverEarnings),
        },
      },
    });
  } catch (error) {
    return serverError(res, error, "Could not load admin dashboard.");
  }
});

/* =========================================================
   ADMIN LIST ROUTES
========================================================= */

app.get("/api/admin/riders", requireAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("riders")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500);

    if (error) throw error;

    return ok(res, { riders: data || [] });
  } catch (error) {
    return serverError(res, error, "Could not load riders.");
  }
});

app.get("/api/admin/drivers", requireAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("drivers")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500);

    if (error) throw error;

    return ok(res, { drivers: data || [] });
  } catch (error) {
    return serverError(res, error, "Could not load drivers.");
  }
});

app.get("/api/admin/rides", requireAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("rides")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500);

    if (error) throw error;

    return ok(res, { rides: data || [] });
  } catch (error) {
    return serverError(res, error, "Could not load rides.");
  }
});

app.get("/api/admin/deliveries", requireAdmin, async (req, res) => {
  try {
    const serviceType = normalizeServiceType(req.query.service_type || req.query.serviceType || "");

    let query = supabase
      .from("delivery_orders")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500);

    if (isDeliveryService(serviceType)) {
      query = query.eq("service_type", serviceType);
    }

    const { data, error } = await query;

    if (error) throw error;

    return ok(res, {
      deliveries: (data || []).map(publicDeliveryOrder),
    });
  } catch (error) {
    return serverError(res, error, "Could not load deliveries.");
  }
});

/* =========================================================
   ADMIN REDISPATCH CONTROLS
========================================================= */

app.post("/api/admin/rides/redispatch", requireAdmin, async (req, res) => {
  try {
    const rideId = safeTrim(req.body.ride_id || req.body.rideId);

    if (!rideId) return fail(res, 400, "Ride ID is required.");

    const result = await dispatchRide(rideId);

    await auditLog("admin_ride_redispatch", {
      admin: req.admin.email,
      ride_id: rideId,
      result,
    });

    return ok(res, {
      message: "Ride redispatch attempted.",
      result,
    });
  } catch (error) {
    return serverError(res, error, "Could not redispatch ride.");
  }
});

app.post("/api/admin/delivery/redispatch", requireAdmin, async (req, res) => {
  try {
    const deliveryOrderId = safeTrim(
      req.body.delivery_order_id || req.body.deliveryOrderId
    );

    if (!deliveryOrderId) {
      return fail(res, 400, "Delivery order ID is required.");
    }

    const result = await dispatchDelivery(deliveryOrderId);

    await auditLog("admin_delivery_redispatch", {
      admin: req.admin.email,
      delivery_order_id: deliveryOrderId,
      result,
    });

    return ok(res, {
      message: "Delivery redispatch attempted.",
      result,
    });
  } catch (error) {
    return serverError(res, error, "Could not redispatch delivery.");
  }
});

/* =========================================================
   ADMIN CANCEL CONTROLS
========================================================= */

app.post("/api/admin/rides/cancel", requireAdmin, async (req, res) => {
  try {
    const rideId = safeTrim(req.body.ride_id || req.body.rideId);
    const reason = normalizeText(req.body.reason || "Canceled by admin.");

    if (!rideId) return fail(res, 400, "Ride ID is required.");

    const ride = await dbFindById("rides", rideId);
    if (!ride) return fail(res, 404, "Ride not found.");

    if (["completed", "canceled"].includes(ride.status)) {
      return fail(res, 409, `Ride cannot be canceled from status ${ride.status}.`);
    }

    if (ride.payment_id) {
      try {
        await cancelPayment(ride.payment_id, "requested_by_customer");
      } catch (paymentError) {
        console.warn("⚠️ Admin ride cancel payment warning:", paymentError.message);
      }
    }

    const updated = await dbUpdateById("rides", ride.id, {
      status: "canceled",
      canceled_by: "admin",
      canceled_at: nowIso(),
      cancellation_reason: reason,
    });

    if (ride.driver_id) {
      await supabase
        .from("drivers")
        .update({
          available: true,
          current_ride_id: null,
          current_delivery_order_id: null,
          updated_at: nowIso(),
        })
        .eq("id", ride.driver_id);
    }

    if (ride.current_mission_id) {
      await dbUpdateById("missions", ride.current_mission_id, {
        status: "canceled",
        canceled_at: nowIso(),
        cancellation_reason: reason,
      });
    }

    await auditLog("admin_ride_canceled", {
      admin: req.admin.email,
      ride_id: ride.id,
      reason,
    });

    await rideEvent(ride.id, "ride_canceled_by_admin", {
      admin: req.admin.email,
      reason,
    });

    return ok(res, {
      message: "Ride canceled.",
      ride: updated,
    });
  } catch (error) {
    return serverError(res, error, "Could not cancel ride.");
  }
});

app.post("/api/admin/delivery/cancel", requireAdmin, async (req, res) => {
  try {
    const deliveryOrderId = safeTrim(
      req.body.delivery_order_id || req.body.deliveryOrderId
    );

    const reason = normalizeText(req.body.reason || "Canceled by admin.");

    if (!deliveryOrderId) {
      return fail(res, 400, "Delivery order ID is required.");
    }

    const order = await dbFindById("delivery_orders", deliveryOrderId);
    if (!order) return fail(res, 404, "Delivery order not found.");

    if (["completed", "canceled"].includes(order.status)) {
      return fail(res, 409, `Delivery cannot be canceled from status ${order.status}.`);
    }

    if (order.payment_id) {
      try {
        await cancelPayment(order.payment_id, "requested_by_customer");
      } catch (paymentError) {
        console.warn("⚠️ Admin delivery cancel payment warning:", paymentError.message);
      }
    }

    const updated = await dbUpdateById("delivery_orders", order.id, {
      status: "canceled",
      canceled_by: "admin",
      canceled_at: nowIso(),
      cancellation_reason: reason,
    });

    if (order.driver_id) {
      await supabase
        .from("drivers")
        .update({
          available: true,
          current_ride_id: null,
          current_delivery_order_id: null,
          updated_at: nowIso(),
        })
        .eq("id", order.driver_id);
    }

    if (order.current_mission_id) {
      await dbUpdateById("missions", order.current_mission_id, {
        status: "canceled",
        canceled_at: nowIso(),
        cancellation_reason: reason,
      });
    }

    await auditLog("admin_delivery_canceled", {
      admin: req.admin.email,
      delivery_order_id: order.id,
      reason,
    });

    await deliveryEvent(order.id, "delivery_canceled_by_admin", {
      admin: req.admin.email,
      reason,
    });

    return ok(res, {
      message: "Delivery canceled.",
      delivery: publicDeliveryOrder(updated),
    });
  } catch (error) {
    return serverError(res, error, "Could not cancel delivery.");
  }
});

/* =========================================================
   AI SUPPORT
========================================================= */

app.post("/api/ai/support", async (req, res) => {
  try {
    const message = normalizeText(req.body.message);
    const page = normalizeText(req.body.page || req.body.context || "general");

    if (!message) return fail(res, 400, "Message is required.");

    const deliveryContext = `
Harvey Taxi supports three service types:
1. ride — passenger ride requests.
2. food — fast food / restaurant delivery.
3. grocery — grocery delivery.

Current platform rules:
- Riders must pass Persona verification before rides or delivery if rider gate is enabled.
- Drivers must verify email and phone, pass Persona, complete Checkr, and be admin approved before missions.
- Payment authorization happens before dispatch when payment gate is enabled.
- Delivery dispatch uses mission-first workflow just like rides.
- Drivers can support rides, food delivery, and grocery delivery.
`;

    if (!openai) {
      return ok(res, {
        reply:
          "Harvey Taxi AI support is online, but live AI is not fully configured yet. I can help with rider signup, driver onboarding, Persona verification, payments, ride requests, fast food delivery, grocery delivery, and driver missions.",
      });
    }

    const systemPrompt = `
You are Harvey Taxi AI Support.

Tone:
- Professional, clear, calm, and helpful.
- Never claim a payment, verification, ride, or delivery was completed unless the user data confirms it.

Safety:
- Harvey Taxi is not an emergency service. For emergencies, tell the user to call 911.

Platform:
${deliveryContext}

Current page/context: ${page}
`;

    const completion = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: message },
      ],
      temperature: 0.35,
      max_tokens: 500,
    });

    const reply =
      completion.choices?.[0]?.message?.content ||
      "I’m here to help with Harvey Taxi. Please send your question again.";

    return ok(res, { reply });
  } catch (error) {
    return serverError(res, error, "AI support failed.");
  }
});

/* =========================================================
   EXPIRED DISPATCH SWEEP
========================================================= */

async function expireRideDispatch(dispatch) {
  await dbUpdateById("dispatches", dispatch.id, {
    status: "expired",
    canceled_at: nowIso(),
    cancellation_reason: "Offer expired.",
  });

  if (dispatch.mission_id) {
    await dbUpdateById("missions", dispatch.mission_id, {
      status: "expired",
      canceled_at: nowIso(),
      cancellation_reason: "Offer expired.",
    });
  }

  if (dispatch.ride_id) {
    await rideEvent(dispatch.ride_id, "dispatch_expired", {
      dispatch_id: dispatch.id,
      mission_id: dispatch.mission_id,
      driver_id: dispatch.driver_id,
    });

    if (ENABLE_AUTO_REDISPATCH) {
      await dispatchRide(dispatch.ride_id);
    }
  }
}

async function expireDeliveryDispatch(dispatch) {
  await dbUpdateById("dispatches", dispatch.id, {
    status: "expired",
    canceled_at: nowIso(),
    cancellation_reason: "Offer expired.",
  });

  if (dispatch.mission_id) {
    await dbUpdateById("missions", dispatch.mission_id, {
      status: "expired",
      canceled_at: nowIso(),
      cancellation_reason: "Offer expired.",
    });
  }

  if (dispatch.delivery_order_id) {
    await deliveryEvent(dispatch.delivery_order_id, "dispatch_expired", {
      dispatch_id: dispatch.id,
      mission_id: dispatch.mission_id,
      driver_id: dispatch.driver_id,
    });

    if (ENABLE_AUTO_REDISPATCH) {
      await dispatchDelivery(dispatch.delivery_order_id);
    }
  }
}

let dispatchSweepRunning = false;

async function sweepExpiredDispatches() {
  if (dispatchSweepRunning) return;

  dispatchSweepRunning = true;

  try {
    const { data, error } = await supabase
      .from("dispatches")
      .select("*")
      .eq("status", "offered")
      .lt("expires_at", nowIso())
      .limit(50);

    if (error) throw error;

    for (const dispatch of data || []) {
      try {
        if (dispatch.ride_id) {
          await expireRideDispatch(dispatch);
        } else if (dispatch.delivery_order_id) {
          await expireDeliveryDispatch(dispatch);
        }
      } catch (itemError) {
        console.warn("⚠️ Failed to expire dispatch:", {
          dispatch_id: dispatch.id,
          message: itemError.message,
        });
      }
    }
  } catch (error) {
    console.warn("⚠️ Dispatch sweep failed:", error.message);
  } finally {
    dispatchSweepRunning = false;
  }
}

setInterval(sweepExpiredDispatches, 15000);

/* =========================================================
   STARTUP CHECKS
========================================================= */

async function runStartupChecks() {
  console.log("🚀 Running Harvey Taxi TRUE Delivery startup checks...");

  const tables = [
    "riders",
    "drivers",
    "rides",
    "payments",
    "missions",
    "dispatches",
    "delivery_orders",
    "delivery_order_items",
    "delivery_status_events",
    "driver_earnings",
    "driver_payouts",
    "admin_logs",
    "trip_events",
    "driver_locations",
  ];

  for (const table of tables) {
    try {
      const { error } = await supabase.from(table).select("id").limit(1);

      if (error) {
        console.warn(`⚠️ Table issue: ${table} — ${error.message}`);
      } else {
        console.log(`✅ Table OK: ${table}`);
      }
    } catch (error) {
      console.warn(`⚠️ Table check failed: ${table} — ${error.message}`);
    }
  }

  console.log("✅ Startup checks complete.");
}

/* =========================================================
   404 + ERROR HANDLERS
========================================================= */

app.use((req, res) => {
  return fail(res, 404, "Route not found.", {
    path: req.path,
    method: req.method,
  });
});

app.use((err, req, res, next) => {
  console.error("❌ Unhandled server error:", {
    message: err.message,
    stack: err.stack,
  });

  return fail(res, err.status || 500, err.message || "Unhandled server error.");
});

/* =========================================================
   SERVER START
========================================================= */

server.listen(PORT, async () => {
  console.log("=================================================");
  console.log("🚕 HARVEY TAXI — TRUE DELIVERY CODE BLUE ONLINE");
  console.log("=================================================");
  console.log(`✅ Port: ${PORT}`);
  console.log(`✅ Base URL: ${APP_BASE_URL}`);
  console.log(`✅ Support Email: ${SUPPORT_EMAIL}`);
  console.log("-------------------------------------------------");
  console.log(`Supabase: ✅`);
  console.log(`SendGrid: ${sgMail && SENDGRID_API_KEY && ENABLE_REAL_EMAIL ? "✅" : "⚠️"}`);
  console.log(`Twilio: ${twilioClient ? "✅" : "⚠️"}`);
  console.log(`Stripe: ${stripe ? "✅" : "⚠️"}`);
  console.log(`Persona: ${PERSONA_API_KEY && ENABLE_PERSONA ? "✅" : "⚠️"}`);
  console.log(`Checkr: ${CHECKR_API_KEY && ENABLE_CHECKR ? "✅" : "⚠️"}`);
  console.log(`OpenAI: ${openai ? "✅" : "⚠️"}`);
  console.log(`Google Maps: ${GOOGLE_MAPS_API_KEY ? "✅" : "⚠️"}`);
  console.log(`Delivery: ${ENABLE_DELIVERY ? "✅" : "⚠️"}`);
  console.log(`Food Delivery: ${ENABLE_FOOD_DELIVERY ? "✅" : "⚠️"}`);
  console.log(`Grocery Delivery: ${ENABLE_GROCERY_DELIVERY ? "✅" : "⚠️"}`);
  console.log("=================================================");

  await runStartupChecks();
});

/* =========================================================
   END OF HARVEY TAXI — TRUE DELIVERY CODE BLUE SERVER.JS
========================================================= */

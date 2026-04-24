/* =========================================================

   HARVEY TAXI — PERSONA CODE BLUE SERVER.JS

   PART 1 OF 9

   FOUNDATION + ENV + CLIENTS + STRIPE RAW WEBHOOK + HELPERS

========================================================= */

"use strict";

/* =========================================================

   IMPORTS

========================================================= */

const express = require("express");

const cors = require("cors");

const path = require("path");

const crypto = require("crypto");

const { createClient } = require("@supabase/supabase-js");

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

const PORT = process.env.PORT || 10000;

/* =========================================================

   ENV HELPERS

========================================================= */

function env(name, fallback = "") {

  return String(process.env[name] || fallback).trim();

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

/* =========================================================

   REQUIRED ENV

========================================================= */

const SUPABASE_URL = env("SUPABASE_URL");

const SUPABASE_SERVICE_ROLE_KEY = env("SUPABASE_SERVICE_ROLE_KEY");

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {

  console.error("❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");

  process.exit(1);

}

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

   MAPS + FARE + DISPATCH CONFIG

========================================================= */

const GOOGLE_MAPS_API_KEY = env("GOOGLE_MAPS_API_KEY");

const BASE_FARE = envNumber("BASE_FARE", 5);

const PER_MILE_RATE = envNumber("PER_MILE_RATE", 2.25);

const PER_MINUTE_RATE = envNumber("PER_MINUTE_RATE", 0.35);

const BOOKING_FEE = envNumber("BOOKING_FEE", 2.5);

const MINIMUM_FARE = envNumber("MINIMUM_FARE", 8);

const DRIVER_PAYOUT_PERCENT = envNumber("DRIVER_PAYOUT_PERCENT", 0.78);

const DISPATCH_TIMEOUT_SECONDS = envNumber("DISPATCH_TIMEOUT_SECONDS", 30);

const MAX_DISPATCH_ATTEMPTS = envNumber("MAX_DISPATCH_ATTEMPTS", 5);

const DRIVER_SEARCH_RADIUS_MILES = envNumber("DRIVER_SEARCH_RADIUS_MILES", 25);

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

  return safeTrim(value).replace(/[^\d+]/g, "");

}

function normalizeText(value) {

  return safeTrim(value).replace(/\s+/g, " ");

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

  console.error("❌", message, error);

  return res.status(500).json({

    ok: false,

    error: message,

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

  const { data, error } = await supabase

    .from(table)

    .select("*")

    .eq("id", id)

    .maybeSingle();

  if (error) throw error;

  return data;

}

async function dbFindOne(table, column, value) {

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

   TWILIO SMS HELPER

========================================================= */

async function sendSms({ to, body }) {

  if (!to) return { sent: false, reason: "missing_to" };

  if (!twilioClient || !ENABLE_REAL_SMS) {

    console.log("📱 SMS MOCK:", { to, body });

    return { sent: false, mock: true };

  }

  const message = await twilioClient.messages.create({

    to,

    from: TWILIO_FROM_NUMBER,

    body,

  });

  return {

    sent: true,

    sid: message.sid,

  };

}

/* =========================================================

   STRIPE WEBHOOK — MUST BE BEFORE express.json()

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

        await supabase

          .from("payments")

          .update({

            status: "failed",

            stripe_latest_status: "failed",

            failure_message:

              object.last_payment_error?.message || "Stripe payment failed.",

            updated_at: nowIso(),

          })

          .eq("stripe_payment_intent_id", object.id);

      }

      if (event.type === "payment_intent.canceled") {

        await supabase

          .from("payments")

          .update({

            status: "canceled",

            stripe_latest_status: "canceled",

            canceled_at: nowIso(),

            updated_at: nowIso(),

          })

          .eq("stripe_payment_intent_id", object.id);

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

app.use(express.json({ limit: "2mb" }));

app.use(express.urlencoded({ extended: true, limit: "2mb" }));

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

  });

});

/* =========================================================

   PART 1 END

   NEXT: SEND PERSONA SERVER PART 2

   Part 2 = Persona create inquiry + Persona webhook

========================================================= *//* =========================================================

   HARVEY TAXI — PERSONA CODE BLUE SERVER.JS

   PART 2 OF 9

   PERSONA CREATE INQUIRY + PERSONA WEBHOOK

========================================================= */

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

    },

    body: options.body ? JSON.stringify(options.body) : undefined,

  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {

    const error = new Error("Persona API request failed.");

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

  const clean = normalizeText(status).toLowerCase();

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

   type = rider | driver

========================================================= */

app.post("/api/persona/create-inquiry", async (req, res) => {

  try {

    const type = normalizeText(req.body.type || req.body.user_type || "rider").toLowerCase();

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

    const inquiryStatus = normalizePersonaStatus(inquiryData.attributes?.status || "created");

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

   COMPATIBILITY ROUTES

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

   PERSONA WEBHOOK SIGNATURE CHECK

   Note: keeps deploy safe even if secret is not set yet.

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

  const eventType = normalizeText(payload?.data?.attributes?.name || payload?.type || "").toLowerCase();

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

    const eventType =

      normalizeText(req.body?.data?.attributes?.name || req.body?.type || "persona_event");

    const inquiry = extractPersonaInquiry(req.body);

    const inferredType = inferPersonaUserType({

      templateId: inquiry.templateId,

      payload: req.body,

    });

    let table = inferredType === "driver" ? "drivers" : inferredType === "rider" ? "riders" : null;

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

    const type = normalizeText(req.query.type || req.query.user_type).toLowerCase();

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

   NEXT: SEND PERSONA SERVER PART 3

   Part 3 = Driver signup + SendGrid + SMS + Persona driver inquiry

========================================================= *//* =========================================================

   HARVEY TAXI — PERSONA CODE BLUE SERVER.JS

   PART 3 OF 9 — CORRECTED

   DRIVER SIGNUP + EMAIL VERIFY + SMS VERIFY

   Rider Persona comes in Part 4.

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

   SEND DRIVER EMAIL VERIFICATION

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

   Creates driver only. Driver Persona starts later after email/SMS.

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

    const existing = await dbFindOne("drivers", "email", email);

    if (existing) {

      if (!existing.email_verified) {

        const resend = await sendDriverEmailVerification(existing);

        return ok(res, {

          message: "Driver already exists. Verification email resent.",

          driver: publicDriver(existing),

          emailVerificationSent: !!resend.sent,

          devVerifyUrl: resend.mock ? resend.verifyUrl : undefined,

        });

      }

      return ok(res, {

        message: "Driver already exists.",

        driver: publicDriver(existing),

      });

    }

    const driver = await dbInsert("drivers", {

      first_name: firstName || null,

      last_name: lastName || null,

      full_name: fullName,

      email,

      phone,

      city: normalizeText(req.body.city) || null,

      state: normalizeText(req.body.state) || null,

      license_number:

        normalizeText(req.body.license_number || req.body.licenseNumber) || null,

      drivers_license_number:

        normalizeText(req.body.license_number || req.body.licenseNumber) || null,

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

        normalizeText(req.body.driver_type || req.body.driverType || "human"),

      terms_accepted: !!req.body.terms_accepted,

      background_check_accepted: !!req.body.background_check_accepted,

      insurance_confirmed: !!req.body.insurance_confirmed,

      email_verified: false,

      phone_verified: false,

      persona_status: "not_started",

      identity_verified: false,

      checkr_status: "not_started",

      approval_status: "pending",

      status: "pending_email_verification",

      available: false,

      created_at: nowIso(),

      updated_at: nowIso(),

    });

    const emailResult = await sendDriverEmailVerification(driver);

    await auditLog("driver_signup_created", {

      driver_id: driver.id,

      email,

      email_sent: !!emailResult.sent,

    });

    return ok(

      res,

      {

        message: "Driver signup received. Email verification sent.",

        driver: publicDriver(driver),

        emailVerificationSent: !!emailResult.sent,

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

      status: "email_verified",

      email_verification_token_hash: null,

      email_verification_expires_at: null,

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

    });

    return ok(res, {

      message: "Driver email verification resent.",

      driver: publicDriver(driver),

      emailVerificationSent: !!emailResult.sent,

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

      sms_sent: !!smsResult.sent,

      sms_mock: !!smsResult.mock,

    });

    return ok(res, {

      message: "Driver SMS verification code sent.",

      smsSent: !!smsResult.sent,

      smsMock: !!smsResult.mock,

      expiresAt,

      devCode: smsResult.mock ? code : undefined,

    });

  } catch (error) {

    return serverError(res, error, "Could not send driver SMS verification code.");

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

   NEXT: SEND PERSONA SERVER PART 4

   Part 4 = Rider signup + rider Persona verification

========================================================= *//* =========================================================

   HARVEY TAXI — PERSONA CODE BLUE SERVER.JS

   PART 4 OF 9

   RIDER SIGNUP + RIDER PERSONA VERIFICATION

========================================================= */

/* =========================================================

   RIDER SIGNUP

   Rider cannot request rides until Persona approves them.

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

        canRequestRide:

          existing.persona_status === "approved" ||

          existing.verification_status === "approved" ||

          existing.approval_status === "approved",

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

    return ok(

      res,

      {

        message: "Rider signup received. Persona verification is required before requesting rides.",

        rider: publicRider(rider),

        nextSteps: [

          "Start Persona identity verification",

          "Complete identity verification",

          "Wait for approval before requesting rides",

        ],

      },

      201

    );

  } catch (error) {

    return serverError(res, error, "Rider signup failed.");

  }

});

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

    if (!rider) {

      return fail(res, 404, "Rider not found.");

    }

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

    const riderId = safeTrim(

      req.query.riderId || req.query.rider_id || req.query.id

    );

    const email = normalizeEmail(req.query.email);

    if (!riderId && !email) {

      return fail(res, 400, "Rider ID or email is required.");

    }

    const rider = riderId

      ? await dbFindById("riders", riderId)

      : await dbFindOne("riders", "email", email);

    if (!rider) {

      return fail(res, 404, "Rider not found.");

    }

    const personaApproved = rider.persona_status === "approved";

    const approved =

      personaApproved ||

      rider.verification_status === "approved" ||

      rider.approval_status === "approved" ||

      rider.status === "approved";

    return ok(res, {

      rider: publicRider(rider),

      persona: {

        inquiryId: rider.persona_inquiry_id || null,

        status: rider.persona_status || "not_started",

        approved: personaApproved,

      },

      approved,

      canRequestRide: ENABLE_RIDER_APPROVAL_GATE ? approved : true,

    });

  } catch (error) {

    return serverError(res, error, "Could not load rider status.");

  }

});

/* =========================================================

   ADMIN RIDER APPROVAL SAFETY

========================================================= */

app.post("/api/admin/riders/approve", requireAdmin, async (req, res) => {

  try {

    const riderId = safeTrim(req.body.riderId || req.body.rider_id);

    if (!riderId) {

      return fail(res, 400, "Rider ID is required.");

    }

    const rider = await dbFindById("riders", riderId);

    if (!rider) {

      return fail(res, 404, "Rider not found.");

    }

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

app.post("/api/admin/riders/reject", requireAdmin, async (req, res) => {

  try {

    const riderId = safeTrim(req.body.riderId || req.body.rider_id);

    const reason = normalizeText(req.body.reason || "Rejected by admin.");

    if (!riderId) {

      return fail(res, 400, "Rider ID is required.");

    }

    const rider = await dbFindById("riders", riderId);

    if (!rider) {

      return fail(res, 404, "Rider not found.");

    }

    const updated = await dbUpdateById("riders", rider.id, {

      verification_status: "rejected",

      approval_status: "rejected",

      status: "rejected",

      rejection_reason: reason,

      rejected_at: nowIso(),

    });

    await auditLog("admin_rider_rejected", {

      admin: req.admin.email,

      rider_id: rider.id,

      reason,

    });

    return ok(res, {

      message: "Rider rejected.",

      rider: publicRider(updated),

    });

  } catch (error) {

    return serverError(res, error, "Could not reject rider.");

  }

});

/* =========================================================

   COMPATIBILITY RIDER ROUTES

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

   PART 4 END

   NEXT: SEND PERSONA SERVER PART 5

   Part 5 = Driver Persona + Checkr + driver approval

========================================================= *//* =========================================================

   HARVEY TAXI — PERSONA CODE BLUE SERVER.JS

   PART 5 OF 9

   DRIVER PERSONA + CHECKR + DRIVER APPROVAL FLOW

========================================================= */

/* =========================================================

   START DRIVER PERSONA

   Driver must verify email + phone first.

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

    if (!driver) {

      return fail(res, 404, "Driver not found.");

    }

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

      Authorization:

        "Basic " + Buffer.from(`${CHECKR_API_KEY}:`).toString("base64"),

      "Content-Type": "application/json",

    },

    body: options.body ? JSON.stringify(options.body) : undefined,

  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {

    const error = new Error("Checkr API request failed.");

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

   START CHECKR

   Driver must pass Persona identity first.

========================================================= */

async function startDriverCheckrFlow(driver) {

  if (!driver.email_verified) {

    throw new Error("Driver email must be verified before Checkr.");

  }

  if (!driver.phone_verified) {

    throw new Error("Driver phone must be verified before Checkr.");

  }

  if (

    driver.identity_verified !== true &&

    driver.persona_status !== "approved"

  ) {

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

    if (!driver) {

      return fail(res, 404, "Driver not found.");

    }

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

  const result = normalizeText(object.result || "").toLowerCase();

  const rawStatus = normalizeText(object.status || "").toLowerCase();

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

    const eventType = normalizeText(req.body?.type || req.body?.event || "unknown");

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

    if (candidateId) {

      driver = await dbFindOne("drivers", "checkr_candidate_id", candidateId);

    }

    if (!driver && invitationId) {

      driver = await dbFindOne("drivers", "checkr_invitation_id", invitationId);

    }

    if (!driver && reportId) {

      driver = await dbFindOne("drivers", "checkr_report_id", reportId);

    }

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

   ADMIN DRIVER APPROVAL

   Requires:

   - email verified

   - phone verified

   - Persona approved

   - Checkr clear

========================================================= */

app.post("/api/admin/drivers/approve", requireAdmin, async (req, res) => {

  try {

    const driverId = safeTrim(req.body.driverId || req.body.driver_id);

    if (!driverId) {

      return fail(res, 400, "Driver ID is required.");

    }

    const driver = await dbFindById("drivers", driverId);

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

    if (!driver.email_verified) {

      return fail(res, 403, "Driver email must be verified before approval.");

    }

    if (!driver.phone_verified) {

      return fail(res, 403, "Driver phone must be verified before approval.");

    }

    if (!identityOk) {

      return fail(res, 403, "Driver Persona identity verification must be approved before approval.");

    }

    if (!checkrOk) {

      return fail(res, 403, "Driver Checkr background check must be clear before approval.");

    }

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

app.post("/api/admin/drivers/reject", requireAdmin, async (req, res) => {

  try {

    const driverId = safeTrim(req.body.driverId || req.body.driver_id);

    const reason = normalizeText(req.body.reason || "Rejected by admin.");

    if (!driverId) {

      return fail(res, 400, "Driver ID is required.");

    }

    const driver = await dbFindById("drivers", driverId);

    if (!driver) {

      return fail(res, 404, "Driver not found.");

    }

    const updated = await dbUpdateById("drivers", driver.id, {

      approval_status: "rejected",

      status: "rejected",

      rejection_reason: reason,

      available: false,

      rejected_at: nowIso(),

    });

    await auditLog("admin_driver_rejected", {

      admin: req.admin.email,

      driver_id: driver.id,

      reason,

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

    if (!driverId) {

      return fail(res, 400, "Driver ID is required.");

    }

    const driver = await dbFindById("drivers", driverId);

    if (!driver) {

      return fail(res, 404, "Driver not found.");

    }

    const updated = await dbUpdateById("drivers", driver.id, {

      approval_status: "manual_review",

      status: "manual_review",

      review_reason: reason,

      available: false,

    });

    await auditLog("admin_driver_manual_review", {

      admin: req.admin.email,

      driver_id: driver.id,

      reason,

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

   PART 5 END

   NEXT: SEND PERSONA SERVER PART 6

   Part 6 = Fare estimate + Stripe payment authorization

========================================================= *//* =========================================================

   HARVEY TAXI — PERSONA CODE BLUE SERVER.JS

   PART 6 OF 9

   FARE ESTIMATE + STRIPE PAYMENT AUTHORIZATION

   RIDER PERSONA GATE BEFORE PAYMENT

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

    throw new Error("Could not calculate ride distance.");

  }

  return {

    miles: element.distance.value / 1609.344,

    minutes: element.duration.value / 60,

    distanceText: element.distance.text,

    durationText: element.duration.text,

  };

}

/* =========================================================

   FARE ENGINE

========================================================= */

function normalizeRequestedMode(value) {

  const mode = normalizeText(value || "driver").toLowerCase();

  if (["autonomous", "av", "pilot"].includes(mode)) {

    return "autonomous";

  }

  return "driver";

}

function calculateFare({ miles, minutes, requestedMode = "driver" }) {

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

   RIDER VERIFICATION GATE

========================================================= */

function riderPersonaApproved(rider = {}) {

  return (

    rider.persona_status === "approved" ||

    rider.verification_status === "approved" ||

    rider.approval_status === "approved" ||

    rider.status === "approved"

  );

}

async function assertRiderCanUsePayments(riderId) {

  const rider = await dbFindById("riders", riderId);

  if (!rider) {

    const error = new Error("Rider not found.");

    error.status = 404;

    throw error;

  }

  if (ENABLE_RIDER_APPROVAL_GATE && !riderPersonaApproved(rider)) {

    const error = new Error("Rider Persona verification must be approved before payment authorization.");

    error.status = 403;

    throw error;

  }

  return rider;

}

/* =========================================================

   ESTIMATE RIDE

   Public estimate. Does not create a ride or payment.

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

    const fare = calculateFare({

      miles: distance.miles,

      minutes: distance.minutes,

      requestedMode,

    });

    return ok(res, {

      estimate: fare,

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

   PAYMENT AUTHORIZATION

   Rider must be Persona-approved before this.

   Creates manual-capture Stripe PaymentIntent.

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

    const rider = await assertRiderCanUsePayments(riderId);

    const pickupGeo = await geocodeAddress(pickup);

    const dropoffGeo = await geocodeAddress(dropoff);

    if (!pickupGeo || !dropoffGeo) {

      return fail(res, 400, "Could not validate pickup or dropoff address.");

    }

    const distance = await estimateDistanceAndDuration({

      pickupAddress: pickupGeo.formatted_address,

      dropoffAddress: dropoffGeo.formatted_address,

    });

    const fare = calculateFare({

      miles: distance.miles,

      minutes: distance.minutes,

      requestedMode,

    });

    if (!ENABLE_PAYMENT_GATE) {

      const payment = await dbInsert("payments", {

        rider_id: rider.id,

        amount: fare.total,

        currency: "usd",

        status: "authorized",

        provider: "disabled_gate",

        type: "ride_authorization",

        requested_mode: fare.requestedMode,

        fare_snapshot: fare,

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

        estimate: fare,

        route: {

          pickup: pickupGeo.formatted_address,

          dropoff: dropoffGeo.formatted_address,

          distanceText: distance.distanceText,

          durationText: distance.durationText,

        },

      });

    }

    if (!stripe) {

      return fail(res, 503, "Stripe is not configured.");

    }

    const customerId = await getOrCreateStripeCustomerForRider(rider);

    const paymentIntent = await stripe.paymentIntents.create({

      amount: cents(fare.total),

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

        requested_mode: fare.requestedMode,

        pickup: pickupGeo.formatted_address.slice(0, 400),

        dropoff: dropoffGeo.formatted_address.slice(0, 400),

      },

    });

    const payment = await dbInsert("payments", {

      rider_id: rider.id,

      amount: fare.total,

      currency: "usd",

      status: paymentIntent.status,

      provider: "stripe",

      type: "ride_authorization",

      stripe_customer_id: customerId,

      stripe_payment_intent_id: paymentIntent.id,

      client_secret: paymentIntent.client_secret,

      requested_mode: fare.requestedMode,

      fare_snapshot: fare,

      route_snapshot: {

        pickup: pickupGeo,

        dropoff: dropoffGeo,

        distance,

      },

      created_at: nowIso(),

      updated_at: nowIso(),

    });

    await auditLog("payment_authorization_created", {

      rider_id: rider.id,

      payment_id: payment.id,

      stripe_payment_intent_id: paymentIntent.id,

      amount: fare.total,

    });

    return ok(res, {

      message: "Payment authorization created.",

      payment: {

        id: payment.id,

        amount: payment.amount,

        currency: payment.currency,

        status: payment.status,

        provider: payment.provider,

        stripePaymentIntentId: paymentIntent.id,

        clientSecret: paymentIntent.client_secret,

      },

      estimate: fare,

      route: {

        pickup: pickupGeo.formatted_address,

        dropoff: dropoffGeo.formatted_address,

        distanceText: distance.distanceText,

        durationText: distance.durationText,

      },

    });

  } catch (error) {

    return serverError(

      res,

      error,

      error.status === 403

        ? error.message

        : "Could not authorize payment."

    );

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

      payment = await dbFindOne(

        "payments",

        "stripe_payment_intent_id",

        paymentIntentId

      );

    }

    if (!payment) {

      return fail(res, 404, "Payment not found.");

    }

    let stripeStatus = null;

    if (stripe && payment.stripe_payment_intent_id) {

      const intent = await stripe.paymentIntents.retrieve(

        payment.stripe_payment_intent_id

      );

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

        rider_id: payment.rider_id,

        amount: payment.amount,

        currency: payment.currency,

        status: payment.status,

        provider: payment.provider,

        type: payment.type,

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

   CAPTURE PAYMENT HELPER

========================================================= */

async function captureRidePayment(paymentId, finalAmount) {

  const payment = await dbFindById("payments", paymentId);

  if (!payment) {

    throw new Error("Payment not found.");

  }

  if (["captured", "succeeded"].includes(payment.status)) {

    return payment;

  }

  if (payment.provider === "disabled_gate") {

    return dbUpdateById("payments", payment.id, {

      status: "captured",

      captured_at: nowIso(),

      captured_amount: roundMoney(finalAmount || payment.amount),

    });

  }

  if (!stripe || !payment.stripe_payment_intent_id) {

    throw new Error("Stripe payment cannot be captured.");

  }

  const captureAmount = cents(finalAmount || payment.amount);

  const intent = await stripe.paymentIntents.capture(

    payment.stripe_payment_intent_id,

    {

      amount_to_capture: captureAmount,

    }

  );

  const updated = await dbUpdateById("payments", payment.id, {

    status: intent.status,

    stripe_latest_status: intent.status,

    captured_at: nowIso(),

    captured_amount: roundMoney(captureAmount / 100),

  });

  await auditLog("payment_captured", {

    payment_id: payment.id,

    stripe_payment_intent_id: payment.stripe_payment_intent_id,

    amount: roundMoney(captureAmount / 100),

  });

  return updated;

}

/* =========================================================

   CANCEL PAYMENT HELPER

========================================================= */

async function cancelRidePayment(paymentId, reason = "requested_by_customer") {

  const payment = await dbFindById("payments", paymentId);

  if (!payment) {

    throw new Error("Payment not found.");

  }

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

   PART 6 END

   NEXT: SEND PERSONA SERVER PART 7

   Part 7 = Ride request + dispatch + missions

========================================================= *//* =========================================================

   HARVEY TAXI — PERSONA CODE BLUE SERVER.JS

   PART 7 OF 9

   RIDE REQUEST + PAYMENT GATE + DISPATCH + MISSIONS

========================================================= */

/* =========================================================

   PAYMENT AUTHORIZATION CHECK BEFORE RIDE REQUEST

========================================================= */

async function assertRidePaymentAuthorized({ riderId, paymentId }) {

  if (!ENABLE_PAYMENT_GATE) {

    return {

      authorized: true,

      payment: null,

      reason: "payment_gate_disabled",

    };

  }

  if (!paymentId) {

    throw new Error("Payment authorization is required before requesting a ride.");

  }

  const payment = await dbFindById("payments", paymentId);

  if (!payment) {

    throw new Error("Payment authorization not found.");

  }

  if (payment.rider_id !== riderId) {

    throw new Error("Payment authorization does not belong to this rider.");

  }

  let finalStatus = payment.status;

  if (stripe && payment.stripe_payment_intent_id) {

    const intent = await stripe.paymentIntents.retrieve(

      payment.stripe_payment_intent_id

    );

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

function driverCanReceiveMission(driver = {}) {

  const identityOk =

    driver.identity_verified === true || driver.persona_status === "approved";

  const checkrOk = [

    "report_clear",

    "clear",

    "completed",

    "complete",

    "invitation_completed",

  ].includes(driver.checkr_status);

  return (

    !!driver.email_verified &&

    !!driver.phone_verified &&

    identityOk &&

    checkrOk &&

    driver.approval_status === "approved" &&

    !!driver.available

  );

}

function scoreDriverForRide(driver, ride) {

  if (!driver.current_lat || !driver.current_lng) return null;

  const distanceMiles = haversineMiles(

    ride.pickup_lat,

    ride.pickup_lng,

    driver.current_lat,

    driver.current_lng

  );

  if (distanceMiles > DRIVER_SEARCH_RADIUS_MILES) return null;

  let score = 100;

  score -= distanceMiles * 3;

  if (driver.driver_type === "autonomous" && ride.requested_mode === "autonomous") {

    score += 25;

  }

  if (driver.driver_type === "human" && ride.requested_mode === "driver") {

    score += 10;

  }

  if (driver.preferred_score) {

    score += Number(driver.preferred_score) || 0;

  }

  return {

    driver,

    distanceMiles,

    score,

  };

}

async function findEligibleDriversForRide(ride) {

  const { data, error } = await supabase

    .from("drivers")

    .select("*")

    .eq("available", true)

    .eq("approval_status", "approved");

  if (error) throw error;

  return (data || [])

    .filter(driverCanReceiveMission)

    .map((driver) => scoreDriverForRide(driver, ride))

    .filter(Boolean)

    .sort((a, b) => b.score - a.score);

}

/* =========================================================

   CREATE MISSION OFFER

========================================================= */

async function createMissionOffer({ ride, driverMatch }) {

  const driver = driverMatch.driver;

  const expiresAt = addSeconds(DISPATCH_TIMEOUT_SECONDS);

  const mission = await dbInsert("missions", {

    ride_id: ride.id,

    driver_id: driver.id,

    status: "offered",

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

  return {

    mission,

    dispatch,

  };

}

/* =========================================================

   DISPATCH ENGINE

========================================================= */

async function dispatchRide(rideId) {

  const ride = await dbFindById("rides", rideId);

  if (!ride) {

    throw new Error("Ride not found for dispatch.");

  }

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

  const driverMatches = await findEligibleDriversForRide(ride);

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

  const offer = await createMissionOffer({

    ride,

    driverMatch: nextDriverMatch,

  });

  return {

    offered: true,

    driver_id: nextDriverMatch.driver.id,

    mission_id: offer.mission.id,

    dispatch_id: offer.dispatch.id,

  };

}

/* =========================================================

   REQUEST RIDE

   Requires:

   - Rider Persona approved

   - Payment authorization

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

    const rider = await dbFindById("riders", riderId);

    if (!rider) {

      return fail(res, 404, "Rider not found.");

    }

    if (ENABLE_RIDER_APPROVAL_GATE && !riderPersonaApproved(rider)) {

      return fail(

        res,

        403,

        "Rider Persona verification is required before requesting a ride."

      );

    }

    const paymentAuth = await assertRidePaymentAuthorized({

      riderId: rider.id,

      paymentId,

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

    const fare = calculateFare({

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

    return ok(

      res,

      {

        message: scheduledAt

          ? "Scheduled ride created."

          : "Ride request created and dispatch started.",

        ride: {

          id: ride.id,

          status: ride.status,

          requestedMode: ride.requested_mode,

          pickup: ride.pickup_address,

          dropoff: ride.dropoff_address,

          fareTotal: ride.fare_total,

          scheduledAt: ride.scheduled_at,

        },

        dispatch: dispatchResult,

      },

      201

    );

  } catch (error) {

    return serverError(res, error, "Ride request failed.");

  }

});

/* =========================================================

   DISPATCH EXPIRY + REDISPATCH

========================================================= */

async function expireDispatchAndRedispatch(dispatchId) {

  const dispatch = await dbFindById("dispatches", dispatchId);

  if (!dispatch || dispatch.status !== "offered") {

    return {

      skipped: true,

      reason: "dispatch_not_active",

    };

  }

  if (new Date(dispatch.expires_at).getTime() > Date.now()) {

    return {

      skipped: true,

      reason: "dispatch_not_expired_yet",

    };

  }

  await dbUpdateById("dispatches", dispatch.id, {

    status: "expired",

  });

  if (dispatch.mission_id) {

    await dbUpdateById("missions", dispatch.mission_id, {

      status: "expired",

    });

  }

  await rideEvent(dispatch.ride_id, "dispatch_expired", {

    dispatch_id: dispatch.id,

    mission_id: dispatch.mission_id,

    driver_id: dispatch.driver_id,

  });

  if (!ENABLE_AUTO_REDISPATCH) {

    await dbUpdateById("rides", dispatch.ride_id, {

      status: "dispatch_expired",

    });

    return {

      expired: true,

      redispatched: false,

    };

  }

  const result = await dispatchRide(dispatch.ride_id);

  return {

    expired: true,

    redispatched: !!result?.offered,

    result,

  };

}

async function sweepExpiredDispatches() {

  try {

    const { data, error } = await supabase

      .from("dispatches")

      .select("*")

      .eq("status", "offered")

      .lt("expires_at", nowIso())

      .limit(25);

    if (error) throw error;

    for (const dispatch of data || []) {

      await expireDispatchAndRedispatch(dispatch.id);

    }

  } catch (error) {

    console.warn("⚠️ sweepExpiredDispatches failed:", error.message);

  }

}

/* =========================================================

   DRIVER MISSION FEED

========================================================= */

app.get("/api/driver/missions", async (req, res) => {

  try {

    const driverId = safeTrim(req.query.driver_id || req.query.driverId);

    if (!driverId) {

      return fail(res, 400, "Driver ID is required.");

    }

    const driver = await dbFindById("drivers", driverId);

    if (!driver) {

      return fail(res, 404, "Driver not found.");

    }

    if (!driverCanReceiveMission(driver)) {

      return ok(res, {

        driver: publicDriver(driver),

        canReceiveMissions: false,

        missions: [],

      });

    }

    const { data, error } = await supabase

      .from("missions")

      .select("*")

      .eq("driver_id", driver.id)

      .in("status", ["offered", "accepted", "en_route", "arrived", "in_progress"])

      .order("created_at", { ascending: false });

    if (error) throw error;

    return ok(res, {

      driver: publicDriver(driver),

      canReceiveMissions: true,

      missions: data || [],

    });

  } catch (error) {

    return serverError(res, error, "Could not load driver missions.");

  }

});

/* =========================================================

   ACCEPT MISSION

========================================================= */

app.post("/api/driver/missions/accept", async (req, res) => {

  try {

    const driverId = safeTrim(req.body.driver_id || req.body.driverId);

    const missionId = safeTrim(req.body.mission_id || req.body.missionId);

    if (!driverId || !missionId) {

      return fail(res, 400, "Driver ID and mission ID are required.");

    }

    const mission = await dbFindById("missions", missionId);

    if (!mission) {

      return fail(res, 404, "Mission not found.");

    }

    if (mission.driver_id !== driverId) {

      return fail(res, 403, "Mission does not belong to this driver.");

    }

    if (mission.status !== "offered") {

      return fail(res, 409, `Mission cannot be accepted from status ${mission.status}.`);

    }

    if (mission.expires_at && new Date(mission.expires_at).getTime() < Date.now()) {

      await expireDispatchAndRedispatch(mission.dispatch_id);

      return fail(res, 409, "Mission offer has expired.");

    }

    const driver = await dbFindById("drivers", driverId);

    if (!driver || !driverCanReceiveMission(driver)) {

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

    const updatedRide = await dbUpdateById("rides", mission.ride_id, {

      driver_id: driver.id,

      current_mission_id: mission.id,

      current_dispatch_id: dispatch?.id || null,

      status: "driver_assigned",

      assigned_at: nowIso(),

    });

    await supabase

      .from("drivers")

      .update({

        available: false,

        current_ride_id: mission.ride_id,

        updated_at: nowIso(),

      })

      .eq("id", driver.id);

    await rideEvent(mission.ride_id, "mission_accepted", {

      driver_id: driver.id,

      mission_id: mission.id,

      dispatch_id: dispatch?.id || null,

    });

    return ok(res, {

      message: "Mission accepted.",

      mission: updatedMission,

      ride: updatedRide,

    });

  } catch (error) {

    return serverError(res, error, "Could not accept mission.");

  }

});

/* =========================================================

   REJECT MISSION

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

    if (!mission) {

      return fail(res, 404, "Mission not found.");

    }

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

    await rideEvent(mission.ride_id, "mission_rejected", {

      driver_id: driverId,

      mission_id: mission.id,

      dispatch_id: dispatch?.id || null,

      reason,

    });

    if (ENABLE_AUTO_REDISPATCH) {

      await dispatchRide(mission.ride_id);

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

/* =========================================================

   PART 7 END

   NEXT: SEND PERSONA SERVER PART 8

   Part 8 = Trip lifecycle + tipping + earnings

========================================================= *//* =========================================================

   HARVEY TAXI — PERSONA CODE BLUE SERVER.JS

   PART 8 OF 9

   TRIP LIFECYCLE + TIPPING + DRIVER EARNINGS + PAYOUTS

========================================================= */

/* =========================================================

   DRIVER AVAILABILITY

========================================================= */

app.post("/api/driver/availability", async (req, res) => {

  try {

    const driverId = safeTrim(req.body.driver_id || req.body.driverId);

    const available = req.body.available === true || req.body.available === "true";

    if (!driverId) {

      return fail(res, 400, "Driver ID is required.");

    }

    const driver = await dbFindById("drivers", driverId);

    if (!driver) {

      return fail(res, 404, "Driver not found.");

    }

    if (available && !driverCanReceiveMission({ ...driver, available: true })) {

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

/* =========================================================

   DRIVER LOCATION

========================================================= */

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

    if (!driver) {

      return fail(res, 404, "Driver not found.");

    }

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

   RIDE STATUS + HISTORIES

========================================================= */

app.get("/api/rides/status", async (req, res) => {

  try {

    const rideId = safeTrim(req.query.ride_id || req.query.rideId);

    if (!rideId) return fail(res, 400, "Ride ID is required.");

    const ride = await dbFindById("rides", rideId);

    if (!ride) return fail(res, 404, "Ride not found.");

    let driver = null;

    if (ride.driver_id) driver = await dbFindById("drivers", ride.driver_id);

    return ok(res, {

      ride,

      driver: driver ? publicDriver(driver) : null,

    });

  } catch (error) {

    return serverError(res, error, "Could not load ride status.");

  }

});

app.get("/api/rider/rides", async (req, res) => {

  try {

    const riderId = safeTrim(req.query.rider_id || req.query.riderId);

    if (!riderId) return fail(res, 400, "Rider ID is required.");

    const { data, error } = await supabase

      .from("rides")

      .select("*")

      .eq("rider_id", riderId)

      .order("created_at", { ascending: false })

      .limit(50);

    if (error) throw error;

    return ok(res, { rides: data || [] });

  } catch (error) {

    return serverError(res, error, "Could not load rider rides.");

  }

});

app.get("/api/driver/current-ride", async (req, res) => {

  try {

    const driverId = safeTrim(req.query.driver_id || req.query.driverId);

    if (!driverId) return fail(res, 400, "Driver ID is required.");

    const { data, error } = await supabase

      .from("rides")

      .select("*")

      .eq("driver_id", driverId)

      .in("status", [

        "driver_assigned",

        "driver_en_route",

        "driver_arrived",

        "in_progress",

      ])

      .order("created_at", { ascending: false })

      .limit(1);

    if (error) throw error;

    return ok(res, { ride: data?.[0] || null });

  } catch (error) {

    return serverError(res, error, "Could not load current ride.");

  }

});

/* =========================================================

   TRIP LIFECYCLE HELPERS

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

   DRIVER EN ROUTE

========================================================= */

app.post("/api/driver/trip/en-route", async (req, res) => {

  try {

    const driverId = safeTrim(req.body.driver_id || req.body.driverId);

    const rideId = safeTrim(req.body.ride_id || req.body.rideId);

    if (!driverId || !rideId) {

      return fail(res, 400, "Driver ID and ride ID are required.");

    }

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

   DRIVER ARRIVED

========================================================= */

app.post("/api/driver/trip/arrived", async (req, res) => {

  try {

    const driverId = safeTrim(req.body.driver_id || req.body.driverId);

    const rideId = safeTrim(req.body.ride_id || req.body.rideId);

    if (!driverId || !rideId) {

      return fail(res, 400, "Driver ID and ride ID are required.");

    }

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

   START TRIP

========================================================= */

app.post("/api/driver/trip/start", async (req, res) => {

  try {

    const driverId = safeTrim(req.body.driver_id || req.body.driverId);

    const rideId = safeTrim(req.body.ride_id || req.body.rideId);

    if (!driverId || !rideId) {

      return fail(res, 400, "Driver ID and ride ID are required.");

    }

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

   COMPLETE TRIP

========================================================= */

app.post("/api/driver/trip/complete", async (req, res) => {

  try {

    const driverId = safeTrim(req.body.driver_id || req.body.driverId);

    const rideId = safeTrim(req.body.ride_id || req.body.rideId);

    if (!driverId || !rideId) {

      return fail(res, 400, "Driver ID and ride ID are required.");

    }

    const ride = await getRideForDriverAction({ rideId, driverId });

    if (ride.status !== "in_progress") {

      return fail(res, 409, `Ride cannot complete from status ${ride.status}.`);

    }

    let capturedPayment = null;

    if (ride.payment_id) {

      capturedPayment = await captureRidePayment(ride.payment_id, ride.fare_total);

    }

    const completedAt = nowIso();

    const updatedRide = await dbUpdateById("rides", ride.id, {

      status: "completed",

      completed_at: completedAt,

      payment_status: capturedPayment?.status || ride.payment_status || null,

    });

    const mission = await updateMissionForRide(ride.id, {

      status: "completed",

      completed_at: completedAt,

    });

    await supabase

      .from("drivers")

      .update({

        available: true,

        current_ride_id: null,

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

   CANCEL RIDE

========================================================= */

app.post("/api/rides/cancel", async (req, res) => {

  try {

    const rideId = safeTrim(req.body.ride_id || req.body.rideId);

    const actor = normalizeText(req.body.actor || "rider");

    const reason = normalizeText(req.body.reason || "Ride canceled.");

    if (!rideId) return fail(res, 400, "Ride ID is required.");

    const ride = await dbFindById("rides", rideId);

    if (!ride) return fail(res, 404, "Ride not found.");

    if (["completed", "canceled"].includes(ride.status)) {

      return fail(res, 409, `Ride cannot be canceled from status ${ride.status}.`);

    }

    let canceledPayment = null;

    if (ride.payment_id) {

      try {

        canceledPayment = await cancelRidePayment(ride.payment_id, "requested_by_customer");

      } catch (paymentError) {

        console.warn("⚠️ Payment cancel failed:", paymentError.message);

      }

    }

    const updatedRide = await dbUpdateById("rides", ride.id, {

      status: "canceled",

      canceled_at: nowIso(),

      canceled_by: actor,

      cancellation_reason: reason,

    });

    if (ride.current_mission_id) {

      await dbUpdateById("missions", ride.current_mission_id, {

        status: "canceled",

        canceled_at: nowIso(),

        cancellation_reason: reason,

      });

    }

    if (ride.current_dispatch_id) {

      await dbUpdateById("dispatches", ride.current_dispatch_id, {

        status: "canceled",

        canceled_at: nowIso(),

        cancellation_reason: reason,

      });

    }

    if (ride.driver_id) {

      await supabase

        .from("drivers")

        .update({

          available: true,

          current_ride_id: null,

          updated_at: nowIso(),

        })

        .eq("id", ride.driver_id);

    }

    await rideEvent(ride.id, "ride_canceled", {

      actor,

      reason,

      payment_id: ride.payment_id || null,

    });

    return ok(res, {

      message: "Ride canceled.",

      ride: updatedRide,

      payment: canceledPayment,

    });

  } catch (error) {

    return serverError(res, error, "Could not cancel ride.");

  }

});

/* =========================================================

   TIPPING

========================================================= */

function normalizeTipAmount(value) {

  const amount = roundMoney(value);

  if (!Number.isFinite(amount) || amount <= 0) {

    throw new Error("Tip amount must be greater than zero.");

  }

  if (amount > 500) {

    throw new Error("Tip amount is too high.");

  }

  return amount;

}

async function createTipPaymentIntent({ ride, rider, amount }) {

  if (!ENABLE_PAYMENT_GATE) {

    return {

      provider: "disabled_gate",

      status: "succeeded",

      stripe_payment_intent_id: null,

      client_secret: null,

    };

  }

  if (!stripe) {

    throw new Error("Stripe is not configured.");

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

      type: "driver_tip",

      ride_id: ride.id,

      rider_id: rider.id,

      driver_id: ride.driver_id || "",

    },

  });

  return {

    provider: "stripe",

    status: intent.status,

    stripe_payment_intent_id: intent.id,

    client_secret: intent.client_secret,

  };

}

app.post("/api/rides/tip", async (req, res) => {

  try {

    const rideId = safeTrim(req.body.ride_id || req.body.rideId);

    const riderId = safeTrim(req.body.rider_id || req.body.riderId);

    const amount = normalizeTipAmount(req.body.amount);

    if (!rideId || !riderId) {

      return fail(res, 400, "Ride ID and rider ID are required.");

    }

    const ride = await dbFindById("rides", rideId);

    if (!ride) return fail(res, 404, "Ride not found.");

    if (ride.rider_id !== riderId) {

      return fail(res, 403, "Ride does not belong to this rider.");

    }

    if (!ride.driver_id) {

      return fail(res, 409, "A driver must be assigned before tipping.");

    }

    if (

      ![

        "driver_assigned",

        "driver_en_route",

        "driver_arrived",

        "in_progress",

        "completed",

      ].includes(ride.status)

    ) {

      return fail(res, 409, `Tip cannot be added while ride status is ${ride.status}.`);

    }

    const rider = await dbFindById("riders", riderId);

    if (!rider) return fail(res, 404, "Rider not found.");

    const tipPayment = await createTipPaymentIntent({

      ride,

      rider,

      amount,

    });

    const payment = await dbInsert("payments", {

      rider_id: rider.id,

      ride_id: ride.id,

      driver_id: ride.driver_id,

      amount,

      currency: "usd",

      status: tipPayment.status,

      provider: tipPayment.provider,

      type: "tip",

      stripe_payment_intent_id: tipPayment.stripe_payment_intent_id,

      client_secret: tipPayment.client_secret,

      created_at: nowIso(),

      updated_at: nowIso(),

    });

    const earningStatus =

      tipPayment.provider === "disabled_gate" || tipPayment.status === "succeeded"

        ? "pending"

        : "awaiting_payment";

    const earning = await dbInsert("driver_earnings", {

      driver_id: ride.driver_id,

      ride_id: ride.id,

      payment_id: payment.id,

      amount,

      type: "tip",

      status: earningStatus,

      currency: "usd",

      created_at: nowIso(),

      updated_at: nowIso(),

    });

    const newTipTotal = roundMoney(Number(ride.tip_total || 0) + amount);

    await dbUpdateById("rides", ride.id, {

      tip_total: newTipTotal,

      total_with_tip: roundMoney(Number(ride.fare_total || 0) + newTipTotal),

    });

    await rideEvent(ride.id, "tip_created", {

      rider_id: rider.id,

      driver_id: ride.driver_id,

      amount,

      payment_id: payment.id,

      earning_id: earning.id,

    });

    return ok(res, {

      message: "Tip created.",

      tip: {

        amount,

        status: payment.status,

        paymentId: payment.id,

        clientSecret: payment.client_secret || null,

      },

      earning,

    });

  } catch (error) {

    return serverError(res, error, error.message || "Could not add tip.");

  }

});

/* =========================================================

   EARNINGS + PAYOUTS

========================================================= */

app.get("/api/driver/earnings", async (req, res) => {

  try {

    const driverId = safeTrim(req.query.driver_id || req.query.driverId);

    if (!driverId) return fail(res, 400, "Driver ID is required.");

    const { data: earnings, error } = await supabase

      .from("driver_earnings")

      .select("*")

      .eq("driver_id", driverId)

      .order("created_at", { ascending: false })

      .limit(250);

    if (error) throw error;

    const totals = {

      pending: 0,

      available: 0,

      paid: 0,

      awaitingPayment: 0,

      total: 0,

      tips: 0,

      ridePayouts: 0,

    };

    for (const row of earnings || []) {

      const amount = Number(row.amount || 0);

      totals.total += amount;

      if (row.status === "pending") totals.pending += amount;

      if (row.status === "available") totals.available += amount;

      if (row.status === "paid") totals.paid += amount;

      if (row.status === "awaiting_payment") totals.awaitingPayment += amount;

      if (row.type === "tip") totals.tips += amount;

      if (row.type === "ride_payout") totals.ridePayouts += amount;

    }

    Object.keys(totals).forEach((key) => {

      totals[key] = roundMoney(totals[key]);

    });

    return ok(res, {

      totals,

      earnings: earnings || [],

    });

  } catch (error) {

    return serverError(res, error, "Could not load driver earnings.");

  }

});

app.get("/api/driver/payouts", async (req, res) => {

  try {

    const driverId = safeTrim(req.query.driver_id || req.query.driverId);

    if (!driverId) return fail(res, 400, "Driver ID is required.");

    const { data, error } = await supabase

      .from("driver_payouts")

      .select("*")

      .eq("driver_id", driverId)

      .order("created_at", { ascending: false })

      .limit(100);

    if (error) throw error;

    return ok(res, {

      payouts: data || [],

    });

  } catch (error) {

    return serverError(res, error, "Could not load driver payouts.");

  }

});

/* =========================================================

   COMPATIBILITY ROUTES

========================================================= */

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

app.post("/api/rider/tip", (req, res) => {

  req.url = "/api/rides/tip";

  return app._router.handle(req, res);

});

/* =========================================================

   PART 8 END

   NEXT: SEND PERSONA SERVER PART 9

   Part 9 = Admin + AI support + startup + server start

========================================================= *//* =========================================================

   HARVEY TAXI — PERSONA CODE BLUE SERVER.JS

   PART 9 OF 9

   ADMIN + AI SUPPORT + STARTUP CHECKS + SERVER START

========================================================= */

/* =========================================================

   ADMIN DASHBOARD

========================================================= */

app.get("/api/admin/dashboard", requireAdmin, async (req, res) => {

  try {

    const [riders, drivers, rides, payments] = await Promise.all([

      supabase.from("riders").select("*"),

      supabase.from("drivers").select("*"),

      supabase.from("rides").select("*"),

      supabase.from("payments").select("*"),

    ]);

    if (riders.error) throw riders.error;

    if (drivers.error) throw drivers.error;

    if (rides.error) throw rides.error;

    if (payments.error) throw payments.error;

    const revenue = (payments.data || [])

      .filter((p) => ["captured", "succeeded"].includes(p.status))

      .reduce((sum, p) => sum + Number(p.amount || 0), 0);

    return ok(res, {

      dashboard: {

        riders: {

          total: riders.data?.length || 0,

          approved: (riders.data || []).filter((r) => r.approval_status === "approved").length,

          pending: (riders.data || []).filter((r) => r.approval_status === "pending").length,

        },

        drivers: {

          total: drivers.data?.length || 0,

          approved: (drivers.data || []).filter((d) => d.approval_status === "approved").length,

          pending: (drivers.data || []).filter((d) => d.approval_status === "pending").length,

          online: (drivers.data || []).filter((d) => d.available === true).length,

        },

        rides: {

          total: rides.data?.length || 0,

          completed: (rides.data || []).filter((r) => r.status === "completed").length,

          active: (rides.data || []).filter((r) =>

            ["searching", "awaiting_driver_acceptance", "driver_assigned", "driver_en_route", "driver_arrived", "in_progress"].includes(r.status)

          ).length,

        },

        money: {

          capturedRevenue: roundMoney(revenue),

        },

      },

    });

  } catch (error) {

    return serverError(res, error, "Could not load admin dashboard.");

  }

});

/* =========================================================

   ADMIN LISTS

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

/* =========================================================

   ADMIN RIDE CONTROLS

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

      message: "Redispatch attempted.",

      result,

    });

  } catch (error) {

    return serverError(res, error, "Could not redispatch ride.");

  }

});

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

        await cancelRidePayment(ride.payment_id, "requested_by_customer");

      } catch (paymentError) {

        console.warn("⚠️ Admin cancel payment failed:", paymentError.message);

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

          updated_at: nowIso(),

        })

        .eq("id", ride.driver_id);

    }

    await auditLog("admin_ride_canceled", {

      admin: req.admin.email,

      ride_id: ride.id,

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

/* =========================================================

   ADMIN PAYOUT CONTROLS

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

    const invalid = (earnings || []).filter((e) => e.status !== "available");

    if (invalid.length) {

      return fail(res, 409, "Only available earnings can be paid out.");

    }

    const amount = roundMoney(

      (earnings || []).reduce((sum, e) => sum + Number(e.amount || 0), 0)

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

    return ok(res, {

      message: "Payout created.",

      payout,

    });

  } catch (error) {

    return serverError(res, error, "Could not create payout.");

  }

});

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

    const earningIds = Array.isArray(payout.earning_ids) ? payout.earning_ids : [];

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

    return ok(res, {

      message: "Payout marked paid.",

      payout: updated,

    });

  } catch (error) {

    return serverError(res, error, "Could not mark payout paid.");

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

    if (!openai) {

      return ok(res, {

        reply:

          "Harvey Taxi AI support is online, but live AI is not fully configured yet. I can help with rider signup, driver onboarding, Persona verification, payments, ride requests, and support questions.",

      });

    }

    const systemPrompt = `

You are Harvey Taxi AI Support.

Rules:

- Be clear, helpful, and professional.

- If emergency, tell the user to call 911.

- Riders must complete Persona verification before requesting rides.

- Drivers must verify email, phone, Persona identity, Checkr, and admin approval before missions.

- Payment authorization happens before dispatch.

- Do not claim any action was completed unless user data confirms it.

Current page/context: ${page}

`;

    const completion = await openai.chat.completions.create({

      model: OPENAI_MODEL,

      messages: [

        { role: "system", content: systemPrompt },

        { role: "user", content: message },

      ],

      temperature: 0.4,

      max_tokens: 450,

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

   STARTUP CHECKS

========================================================= */

async function runStartupChecks() {

  console.log("🚀 Running Harvey Taxi startup checks...");

  const tables = [

    "riders",

    "drivers",

    "rides",

    "payments",

    "missions",

    "dispatches",

    "driver_earnings",

    "driver_payouts",

    "admin_logs",

    "trip_events",

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

   DISPATCH SWEEP

========================================================= */

let dispatchSweepRunning = false;

async function safeDispatchSweep() {

  if (dispatchSweepRunning) return;

  dispatchSweepRunning = true;

  try {

    await sweepExpiredDispatches();

  } catch (error) {

    console.warn("⚠️ Dispatch sweep failed:", error.message);

  } finally {

    dispatchSweepRunning = false;

  }

}

setInterval(safeDispatchSweep, 15000);

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

  console.error("❌ Unhandled server error:", err);

  return fail(res, err.status || 500, err.message || "Unhandled server error.");

});

/* =========================================================

   SERVER START

========================================================= */

app.listen(PORT, async () => {

  console.log("=================================================");

  console.log("🚕 HARVEY TAXI — PERSONA CODE BLUE SERVER ONLINE");

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

  console.log("=================================================");

  await runStartupChecks();

});

/* =========================================================

   END OF HARVEY TAXI — PERSONA CODE BLUE SERVER.JS

========================================================= */

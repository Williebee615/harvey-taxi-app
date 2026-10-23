/* =========================================================

   HARVEY TAXI MOBILE — SERVER.JS

   PRODUCTION BUILD

   PART 1 — CORE BOOT + SUPABASE PREFLIGHT

========================================================= */

"use strict";

const express = require("express");
const { rideUpdateForStripeEvent } = require("./lib/stripeWebhookTransitions");
const { serverErrorEntry, dbErrorEntry, errorCode: logErrorCode, installConsoleRedaction } = require("./lib/safeLog");
// Safety net for every log line: email addresses, phone numbers, Postgres
// row dumps and credentials are masked (lib/safeLog.js). Allowlisted log
// fields remain the primary control.
installConsoleRedaction();

const cors = require("cors");

const path = require("path");

const crypto = require("crypto");
const net = require("net");

const http = require("http");

const { createClient } = require("@supabase/supabase-js");

let sgMail = null;

try { sgMail = require("@sendgrid/mail"); } catch {}

let twilio = null;

try { twilio = require("twilio"); } catch {}
const htafSms = require("./lib/htafSms");

let Stripe = null;

try { Stripe = require("stripe"); } catch {}

let OpenAI = null;

try { OpenAI = require("openai"); } catch {}

let webpush = null;

try { webpush = require("web-push"); } catch {}

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

  // env(name) alone defaults to "" when unset, and Number("") is 0 (not
  // NaN) — so checking Number.isFinite() on that result can never catch
  // the unset case, and this used to silently return 0 instead of
  // `fallback` for every env-configurable number in the app (session
  // TTLs, dispatch limits, and — most seriously — every pricing rate:
  // BASE_FARE, PER_MILE_RATE, BOOKING_FEE, MINIMUM_FARE,
  // DRIVER_PAYOUT_PERCENT). Checking the raw env var directly, before any
  // string-to-number coercion, is what actually distinguishes "unset" from
  // "explicitly set to 0".
  const raw = process.env[name];

  if (raw === undefined || raw === null || String(raw).trim() === "") {
    return fallback;
  }

  const value = Number(raw);

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

/* Canonical public domain for the platform. Any request that arrives on a
   different host (e.g. the Render-assigned hostname) is 301-redirected here,
   except API routes — see the redirect middleware below. Override with
   CANONICAL_HOST if the canonical domain ever changes. */
const CANONICAL_HOST = env("CANONICAL_HOST", "harveytaxiservice.com");

/* Off by default: flip to true in the environment once CANONICAL_HOST is
   confirmed resolving correctly. Until then, redirecting the Render
   hostname there would send live traffic into a domain that doesn't
   work yet. */
const ENABLE_CANONICAL_REDIRECT = envBool("ENABLE_CANONICAL_REDIRECT", false);

/* Second public-facing domain for the Harvey Transportation Assistance
   Foundation. Requests to this host's root path serve foundation.html
   as the homepage instead of the taxi app's index.html — every other
   path on this domain (assets, /api/*, other pages) is unaffected, it
   just shares the same app and static files. Override with
   FOUNDATION_HOST if the domain ever changes. */
const FOUNDATION_HOST = env("FOUNDATION_HOST", "harveytransportationfoundation.com");
const FOUNDATION_HOSTS = new Set([FOUNDATION_HOST, `www.${FOUNDATION_HOST}`]);

const PUBLIC_DIR = path.join(__dirname, "public");

const SUPPORT_EMAIL =

  env("SUPPORT_EMAIL") ||

  env("ADMIN_EMAIL") ||

  "williebee@harveytaxiservice.com";

const ADMIN_EMAIL = env("ADMIN_EMAIL", "williebee@harveytaxiservice.com");

// HTAF-controlled mailbox for HTAF new-application alerts (#133). No
// default and no fallback to ADMIN_EMAIL -- see sendAdminApplicationAlert().
const HTAF_ADMIN_EMAIL = cleanEmail(env("HTAF_ADMIN_EMAIL", ""));

const ADMIN_PASSWORD = env("ADMIN_PASSWORD", "");

const ADMIN_API_TOKEN = env("ADMIN_API_TOKEN") || env("HARVEY_ADMIN_TOKEN");

/* Admin session (HttpOnly cookie) config.

   SESSION_SECRET falls back to ADMIN_API_TOKEN or ADMIN_PASSWORD so

   sessions still work if a dedicated secret is not set, but setting a

   dedicated ADMIN_SESSION_SECRET in Render is strongly recommended. */

const ADMIN_SESSION_SECRET =

  env("ADMIN_SESSION_SECRET") ||

  env("SESSION_SECRET") ||

  ADMIN_API_TOKEN ||

  ADMIN_PASSWORD ||

  "";

const ADMIN_SESSION_COOKIE = "htaf_admin_session";

const ADMIN_SESSION_TTL_HOURS =

  envNumber("ADMIN_SESSION_TTL_HOURS", 12);

/* Driver session: signed token issued after OTP verification,

   reused by the driver dashboard. Shares the admin secret

   fallback chain if a dedicated one is not set. */

const DRIVER_SESSION_SECRET =

  env("DRIVER_SESSION_SECRET") ||

  env("ADMIN_SESSION_SECRET") ||

  env("SESSION_SECRET") ||

  ADMIN_API_TOKEN ||

  ADMIN_PASSWORD ||

  "";

const DRIVER_SESSION_TTL_HOURS =

  envNumber("DRIVER_SESSION_TTL_HOURS", 24);

// Rider session: deliberately NO fallback chain, unlike
// DRIVER_SESSION_SECRET above. Approved requirement
// (docs/rider-auth-design-proposal.md decisions): RIDER_SESSION_SECRET
// must be configured before this app issues a single rider session --
// reusing the admin or driver secret here would mean a leak of either
// one compromises rider sessions too, and silently falling back to "no
// secret" would mean signRiderSession()/verifyRiderSession() simply
// refuse to operate (see lib/riderAuth.js), which every rider-session
// route below checks explicitly and fails closed with a 503 rather
// than guessing at a substitute secret.
const RIDER_SESSION_SECRET = env("RIDER_SESSION_SECRET", "");

const RIDER_SESSION_TTL_HOURS = envNumber("RIDER_SESSION_TTL_HOURS", 72);

// Dedicated, short, login-specific OTP expiry -- distinct from
// EMAIL_VERIFY_TTL_HOURS, which is scoped to self-service account email
// verification (a much longer-lived link a rider might not open right
// away). A login code left valid for hours is an unnecessarily long
// window for an attacker who intercepts or guesses it.
const RIDER_LOGIN_EMAIL_TTL_MINUTES = envNumber("RIDER_LOGIN_EMAIL_TTL_MINUTES", 10);

const ENABLE_REAL_EMAIL = envBool("ENABLE_REAL_EMAIL", true);

const ENABLE_REAL_SMS = envBool("ENABLE_REAL_SMS", false);

const ENABLE_PERSONA = envBool("ENABLE_PERSONA", true);

const ENABLE_CHECKR = envBool("ENABLE_CHECKR", true);

const ENABLE_AI_SUPPORT = envBool("ENABLE_AI_SUPPORT", true);

const ENABLE_PAYMENT_GATE = envBool("ENABLE_PAYMENT_GATE", true);

const ENABLE_RIDER_APPROVAL_GATE = envBool("ENABLE_RIDER_APPROVAL_GATE", true);

const ENABLE_AUTO_REDISPATCH = envBool("ENABLE_AUTO_REDISPATCH", true);

// Owner decision 2026-10-17: delivery booking is paused (off unless set
// to true on Render) until the merchant portal and the full merchant /
// rider / driver flow are tested. Enforced in rejectUnavailableRideType().
const ENABLE_DELIVERY = envBool("ENABLE_DELIVERY", false);

const ENABLE_FOOD_DELIVERY = envBool("ENABLE_FOOD_DELIVERY", false);

const ENABLE_GROCERY_DELIVERY = envBool("ENABLE_GROCERY_DELIVERY", false);

const ENABLE_HTAF_APPLICATIONS = envBool("ENABLE_HTAF_APPLICATIONS", true);
// HTAF ride creation (applicant data copied to a transportation
// provider's rides) and HTAF AI triage (application facts sent to an AI
// provider) are resolved after the AI client is created, below: each needs
// its feature flag AND a complete approval record (lib/htafActivation.js,
// docs/htaf-activation-checklist.md). The flag alone does nothing.
const { resolveHtafActivation, resolveHtafFunding } = require("./lib/htafActivation");
// HTAF application records are only reachable by an admin whose role
// carries the route's HTAF capability (#134). On by default; setting it
// to false reverts to log-only (the decision is still recorded) and is
// meant only as an emergency rollback.
const HTAF_RBAC_ENFORCED = envBool("HTAF_RBAC_ENFORCED", true);

/* =========================================================

   REQUIRED TABLE PREFLIGHT

========================================================= */

const REQUIRED_TABLES = [

  "htaf_applications",

  "drivers",

  "riders",

  "rides",

  "audit_logs",

  "system_flags",

  "verification_codes",

  "driver_offers",

  "driver_earnings",

  "emergency_alerts",

  "safety_reports",

  "deliveries"

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

// HTAF text messages (lib/htafSms.js): off until toll-free verification is
// approved and the owner turns them on. HTAF's own number only -- never
// TWILIO_FROM_NUMBER, which is Harvey Taxi's.
const HTAF_SMS_ENABLED = envBool("HTAF_SMS_ENABLED", false);
const HTAF_SMS_FROM_NUMBER = env("HTAF_SMS_FROM_NUMBER");

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

// Not secret — this is the key Stripe.js needs in the browser to collect
// card details. Served through GET /api/stripe-key, so it never has to be
// hardcoded or committed to git.
const STRIPE_PUBLISHABLE_KEY = env("STRIPE_PUBLISHABLE_KEY");

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

// Mapbox powers address search, geocoding and driving distance/duration.
// The token is read here, trimmed, and used only by server-side requests
// (lib/mapboxClient.js); it is never sent to browsers, logged, or returned.
const {
  GEO_UNAVAILABLE_MESSAGE,
  readGeoToken,
  describeGeoConfig,
  geoConfigLogLines
} = require("./lib/geoConfig");
const { resolvePerMinuteLimit } = require("./lib/rateLimitConfig");
const {
  PAYMENT_RECORD_STATUS,
  BINDABLE_RECORD_STATUSES,
  DEFAULT_SWEEP_MIN_AGE_MS,
  buildCreatedPaymentRecord,
  buildAuthorizedPaymentRecord,
  decideHoldRelease,
  releaseIdempotencyKey,
  RELEASABLE_INTENT_STATUSES,
  buildIntentMetadata,
  decideReconciliation,
  buildPaymentOpsAlert
} = require("./lib/unusedHolds");
const { describePaymentConfig, describeStripeAccount } = require("./lib/paymentConfig");
const paymentReconciliation = require("./lib/paymentReconciliation");
const refunds = require("./lib/refunds");
const { toVerifyE164, smsSkippedLogDetails, describeTwilioError } = require("./lib/twilioSafety");

// AI Agent Manager (docs/ai-agent-manager.md). No OpenAI/Anthropic
// dependency: rules engine + optional self-hosted model.
const {
  AGENT_FLAG_KEYS,
  BOOLEAN_FLAG_KEYS: AGENT_BOOLEAN_FLAG_KEYS,
  RULE_BOUNDS: AGENT_RULE_BOUNDS,
  resolveAgentFlags,
  resolveAgentMode,
  evaluateFlagChange: evaluateAgentFlagChange,
  parseStoredRules: parseAgentRules,
  validateRules: validateAgentRules
} = require("./lib/agent/policy");
const { redactForLog: agentRedactForLog } = require("./lib/agent/escalation");
const { recommendDrivers: recommendAgentDrivers, driverLabel: agentDriverLabel } = require("./lib/agent/recommender");
const { readLlmConfig: readAgentLlmConfig, createLlmClient: createAgentLlmClient, describeLlmConfig: describeAgentLlmConfig } = require("./lib/agent/llmClient");
const { createAgentTools } = require("./lib/agent/tools");
const { handleAssist: handleAgentAssist } = require("./lib/agent/assistant");
const agentSpecialists = require("./lib/agent/specialists");
const {
  FEEDBACK_FLAG: AGENT_FEEDBACK_FLAG,
  FEEDBACK_ACTION: AGENT_FEEDBACK_ACTION,
  RATINGS: AGENT_FEEDBACK_RATINGS,
  cleanConversationId: cleanAgentConversationId,
  newAnswerId: newAgentAnswerId,
  createFeedbackSigner: createAgentFeedbackSigner,
  feedbackEntry: agentFeedbackEntry,
  summarizeFeedback: summarizeAgentFeedback
} = require("./lib/agent/feedback");
const { createKnowledgeStore } = require("./lib/knowledge/store");
const { readClaudeConfig, createClaudeClient } = require("./lib/agent/claudeClient");
const { createModelBudget, budgetFromEnv } = require("./lib/agent/modelBudget");
const { handleModelAssist, firstRequest } = require("./lib/agent/modelAssistant");
const { MODEL_FLAG_KEYS, resolveModelPolicy, modelEligibility, specialistEligibility, validateModelSettings } = require("./lib/agent/modelPolicy");
const {
  draftSummary: draftHandoffSummary,
  cleanSummary: cleanHandoffSummary,
  handoffKind,
  rideLabel,
  newHandoffReference,
  handoffCaseEntry,
  handoffEmailEntry,
  createHandoffDeduper,
  createHandoffLimiter
} = require("./lib/agent/handoff");
const { createUsageMeter: createAgentUsageMeter, usageKey: agentUsageKey, summarizeUsage: summarizeAgentUsage, appTarget: agentAppTarget } = require("./lib/agent/usage");
const {
  AGENT_ACTIONS,
  RECORD_TYPES: AGENT_RECORD_TYPES,
  newCaseId: newAgentCaseId,
  cleanToolCalls: cleanAgentToolCalls,
  assistDecisionEntry: agentAssistDecisionEntry,
  caseOpenedEntry: agentCaseOpenedEntry,
  caseResolvedEntry: agentCaseResolvedEntry,
  summarizeCases: summarizeAgentCases
} = require("./lib/agent/audit");
const { planStalledRides: planAgentStalledRides, buildAlerts: buildAgentAlerts } = require("./lib/agent/coordinator");
const { createMapboxClient, isFiniteCoord, ERROR: GEO_ERROR } = require("./lib/mapboxClient");
const GEO_CONFIG = describeGeoConfig(process.env);
const geoClient = createMapboxClient({ token: readGeoToken(process.env) });
{
  const { level, lines } = geoConfigLogLines(GEO_CONFIG);
  lines.forEach((line) => console[level](line));
}

/* =========================================================

   WEB PUSH (VAPID)

========================================================= */

const VAPID_PUBLIC_KEY = env("VAPID_PUBLIC_KEY");

const VAPID_PRIVATE_KEY = env("VAPID_PRIVATE_KEY");

const VAPID_SUBJECT = env("VAPID_SUBJECT", "mailto:support@harveytaxiservice.com");

let pushEnabled = false;

if (webpush && VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {

  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

  pushEnabled = true;

  console.log("✅ Web push active");

} else {

  console.warn("⚠️ Web push inactive (no VAPID keys configured)");

}

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

/* =========================================================

   CANONICAL DOMAIN REDIRECT

   Sends browsers on the Render-assigned hostname to CANONICAL_HOST
   instead. API routes are excluded so direct API callers (mobile
   clients, local dev pointed at the deployed backend, webhooks) are
   never redirected. Gated behind ENABLE_CANONICAL_REDIRECT (default
   off) — set it to true once CANONICAL_HOST is confirmed resolving.

========================================================= */

app.use((req, res, next) => {

  if (

    ENABLE_CANONICAL_REDIRECT &&

    IS_PRODUCTION &&

    req.hostname &&

    req.hostname !== CANONICAL_HOST &&

    req.hostname.endsWith(".onrender.com") &&

    !req.path.startsWith("/api/")

  ) {

    return res.redirect(301, `https://${CANONICAL_HOST}${req.originalUrl}`);

  }

  next();

});

/* =========================================================

   HTAF DOMAIN STATIC OVERRIDES

   Requests that arrive on FOUNDATION_HOST get foundation.html at the
   root path instead of the taxi app's index.html, and get HTAF's own
   privacy/terms pages instead of Harvey Taxi's -- everything else
   (assets, /api/*, other pages) is served identically regardless of
   which domain the request came in on, since both domains point at
   this same app. Must run before express.static, which would
   otherwise already resolve these paths to the taxi app's own files
   first.

========================================================= */

// /privacy.html and /terms.html are the same URL on both public domains,
// but must not be the same CONTENT: Harvey Taxi's own policy pages
// (public/privacy.html, public/terms.html) describe a commercial
// ride-hailing platform, while HTAF is a separate 501(c)(3) charity
// whose application portal has no fares, drivers, or dispatch to
// describe. Serves the HTAF-specific file (public/htaf-privacy.html,
// public/htaf-terms.html) instead, only for FOUNDATION_HOSTS requests,
// so the taxi domain's own policy pages are completely unaffected.
const FOUNDATION_STATIC_OVERRIDES = new Map([
  ["/privacy.html", "htaf-privacy.html"],
  ["/terms.html", "htaf-terms.html"],
  ["/service-providers.html", "htaf-service-providers.html"],
  // Search engines and browsers ask a domain's root for its icon. Without
  // these, the foundation domain answered with Harvey Taxi's HTS icon,
  // and Google showed it beside HTAF's search result.
  ["/favicon.ico", "htaf-favicon.ico"],
  ["/apple-touch-icon.png", "htaf-apple-touch-icon.png"],
  ["/apple-touch-icon-precomposed.png", "htaf-apple-touch-icon.png"]
]);

// Web separation (owner decision 2026-10-23): HTAF's pages live only on
// the foundation domain and Harvey Taxi's pages only on the taxi domain.
// HTAF_PAGES on a taxi host redirect to the foundation domain; any other
// page on a foundation host redirects to the taxi domain. Assets and
// /api/* are shared and served on both. Other hosts (previews, tests)
// are unaffected.
const HTAF_PAGES = new Map([
  ["/foundation.html", "/"],
  ["/htaf-application.html", "/htaf-application.html"],
  ["/leadership.html", "/leadership.html"],
  ["/contact.html", "/contact.html"],
  // HTAF staff tool (owner decision 2026-10-23: full admin split). The
  // admin session cookie is host-only, so staff sign in on this domain.
  ["/admin-htaf.html", "/admin-htaf.html"]
]);
const TAXI_HOSTS = new Set([CANONICAL_HOST, `www.${CANONICAL_HOST}`]);
const FOUNDATION_PAGE_PATHS = new Set(["/", ...HTAF_PAGES.values(), "/privacy.html", "/terms.html", "/service-providers.html"]);
const isPagePath = (p) => p === "/" || /\.html?$/i.test(p);
const queryOf = (req) => (req.originalUrl.includes("?") ? req.originalUrl.slice(req.originalUrl.indexOf("?")) : "");

// The HTAF legal pages' internal filenames. express.static isn't
// domain-gated, so without this they would be served as-is on any host
// (the taxi domain, preview deployments), and the canonical tag alone
// doesn't stop a visitor from reading HTAF's policy on a Harvey Taxi
// URL. On every host, including the foundation domain itself, these
// redirect to the one canonical foundation-domain URL. That target is
// served by FOUNDATION_STATIC_OVERRIDES above rather than redirected
// again, so there is no loop. Harvey Taxi's own /privacy.html and
// /terms.html on its own hosts are not in this map and are unaffected.
const HTAF_LEGAL_CANONICAL_REDIRECTS = new Map([
  ["/htaf-privacy.html", "/privacy.html"],
  ["/htaf-terms.html", "/terms.html"],
  ["/htaf-service-providers.html", "/service-providers.html"]
]);

// /support.html and /index.html are Harvey Taxi's own pages -- unlike
// privacy/terms, HTAF doesn't need distinct content of its own at these
// exact URLs, it already has an equivalent (contact.html, or the
// homepage itself), so these redirect rather than serve a second copy.
// Found live in production: express.static isn't domain-gated, so
// FOUNDATION_HOSTS visitors could reach "Harvey Taxi -- Support" and
// Harvey Taxi's own homepage directly, and relative links on HTAF's own
// pages (e.g. a bottom-nav "Home" button linking to index.html) landed
// there too -- both are fixed at the source alongside this redirect.
const FOUNDATION_REDIRECTS = new Map([
  ["/support.html", "/contact.html"],
  ["/index.html", "/"],
  // A third, separate Harvey Taxi privacy document (distinct from
  // public/privacy.html) that predates the /privacy.html override
  // above -- not linked from any HTAF page, but still directly
  // reachable at this exact filename since express.static isn't
  // domain-gated. Redirects to the already-correctly-routed
  // /privacy.html rather than needing a second HTAF-specific file.
  ["/privacy-policy.html", "/privacy.html"],
  // Harvey Taxi's own "how to review this app" page -- not linked from
  // any HTAF page, but exactly the kind of URL a reviewer evaluating
  // domain ownership might specifically look for.
  ["/app-review.html", "/contact.html"],
  // Harvey Taxi's approved assistant answers (docs/ai-knowledge.md).
  ["/policies.html", "/contact.html"],
  // Harvey Taxi's merchant (delivery pilot) application.
  ["/merchant-apply.html", "/"],
  ["/merchant-portal.html", "/"],
  ["/merchant-catalog-template.csv", "/"],
  ["/merchant-catalog-example.csv", "/"],
  ["/store-menu.html", "/"],
  // Harvey Taxi's tip and rating page for a rider's trip.
  ["/tip-driver.html", "/"]
]);

app.use((req, res, next) => {

  if (req.method === "GET" || req.method === "HEAD") {
    const canonicalLegalPath = HTAF_LEGAL_CANONICAL_REDIRECTS.get(req.path);
    if (canonicalLegalPath) {
      return res.redirect(301, `https://${FOUNDATION_HOST}${canonicalLegalPath}`);
    }
  }

  if (
    req.method === "GET" &&
    req.hostname &&
    FOUNDATION_HOSTS.has(req.hostname)
  ) {

    if (req.path === "/") {
      return res.sendFile(path.join(PUBLIC_DIR, "foundation.html"));
    }

    const redirectTarget = FOUNDATION_REDIRECTS.get(req.path);
    if (redirectTarget) {
      return res.redirect(301, redirectTarget);
    }

    const override = FOUNDATION_STATIC_OVERRIDES.get(req.path);
    if (override) {
      return res.sendFile(path.join(PUBLIC_DIR, override));
    }

    const htafHome = HTAF_PAGES.get(req.path);
    if (htafHome && htafHome !== req.path) {
      return res.redirect(301, `${htafHome}${queryOf(req)}`);
    }

    // Every Harvey Taxi page, its admin pages included, goes to the taxi
    // domain, so a foundation URL never shows ride booking or taxi staff tools.
    if (isPagePath(req.path) && !FOUNDATION_PAGE_PATHS.has(req.path)) {
      return res.redirect(301, `https://${CANONICAL_HOST}${req.path}${queryOf(req)}`);
    }

  }

  if ((req.method === "GET" || req.method === "HEAD") && req.hostname && TAXI_HOSTS.has(req.hostname)) {
    const htafPath = HTAF_PAGES.get(req.path);
    if (htafPath) {
      return res.redirect(301, `https://${FOUNDATION_HOST}${htafPath}${queryOf(req)}`);
    }
  }

  next();

});

/* =========================================================

   SITEMAP.XML

   Both public domains share this app, but each needs its own
   sitemap (different page sets, different absolute URLs) -- so this
   is a route, not a static file in public/, and picks its content by
   request hostname the same way the homepage routing above does.
   Only real, linked, public marketing/informational pages are
   listed; dashboards, auth, payment, live-tracking, and internal
   test/prototype pages are deliberately left out (see robots.txt for
   the corresponding Disallow rules).

========================================================= */

const nashvilleDestinations = require("./lib/nashvilleDestinations");

const TAXI_SITEMAP_PATHS = [
  "/",
  "/driver-signup.html",
  "/rider-signup.html",
  "/support.html",
  "/privacy.html",
  "/terms.html",
  ...nashvilleDestinations.SITEMAP_PATHS
];

const FOUNDATION_SITEMAP_PATHS = [
  "/",
  "/contact.html",
  "/leadership.html",
  "/htaf-application.html",
  "/privacy.html",
  "/terms.html",
  "/service-providers.html"
];

function buildSitemapXml(host, urlPaths) {
  const urls = urlPaths
    .map((urlPath) => `  <url><loc>https://${host}${urlPath}</loc></url>`)
    .join("\n");

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`
  );
}

const HTAF_ACTIVATION = resolveHtafActivation(process.env);
// HTAF ride assistance switches: off, and nothing behind them yet.
const HTAF_FUNDING = resolveHtafFunding(process.env);

/* =========================================================

   NASHVILLE DESTINATION PAGES (lib/nashvilleDestinations.js)

   Server-rendered so search engines get full HTML at a real URL. Taxi
   domain only. Travel times are typical (no-traffic) Mapbox drives from
   three neighbourhoods, cached for a day; a lookup that fails or takes
   too long leaves the table out and the page still renders.

========================================================= */

// The Render-assigned hostname serves the same pages as the real domains;
// keep its copies out of search results so they never compete with
// harveytaxiservice.com (ENABLE_CANONICAL_REDIRECT stays the owner's
// switch for redirecting it outright). Registered here, before the page
// routes below and express.static, so every response carries it.
app.use((req, res, next) => {
  if (req.hostname && req.hostname.endsWith(".onrender.com")) res.setHeader("X-Robots-Tag", "noindex, nofollow");
  next();
});

const DESTINATION_TRAVEL_TTL_MS = 24 * 60 * 60 * 1000;
const DESTINATION_TRAVEL_FAIL_TTL_MS = 60 * 60 * 1000;
const DESTINATION_TRAVEL_WAIT_MS = 2500;
const destinationTravelCache = new Map();
const destinationPointCache = new Map();

async function destinationPoint(address) {
  const cached = destinationPointCache.get(address);
  if (cached) return cached;
  const out = await geoClient.resolve(address);
  if (!out.ok) return null;
  destinationPointCache.set(address, out.place);
  return out.place;
}

async function computeDestinationTravelTimes(destination) {
  const to = await destinationPoint(destination.address);
  if (!to) return null;
  const rows = [];
  for (const origin of nashvilleDestinations.ORIGINS) {
    const from = await destinationPoint(origin.address);
    if (!from) continue;
    const route = await geoClient.route(from, to, { traffic: false });
    if (route.ok) rows.push({ originId: origin.id, minutes: route.duration_minutes, miles: route.distance_miles });
  }
  return rows.length ? rows : null;
}

async function destinationTravelTimes(destination) {
  if (!GEO_CONFIG.configured) return null;
  const now = Date.now();
  const hit = destinationTravelCache.get(destination.slug);
  if (hit && hit.expires > now) return hit.value;
  if (!hit || !hit.pending) {
    const pending = computeDestinationTravelTimes(destination)
      .catch(() => null)
      .then((value) => {
        destinationTravelCache.set(destination.slug, {
          value,
          expires: Date.now() + (value ? DESTINATION_TRAVEL_TTL_MS : DESTINATION_TRAVEL_FAIL_TTL_MS)
        });
        return value;
      });
    destinationTravelCache.set(destination.slug, { value: hit?.value ?? null, expires: 0, pending });
  }
  const entry = destinationTravelCache.get(destination.slug);
  let timer;
  const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve(entry.value ?? null), DESTINATION_TRAVEL_WAIT_MS); });
  try {
    return await Promise.race([entry.pending || Promise.resolve(entry.value), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function destinationsOffTaxiHost(req, res) {
  if (req.hostname && FOUNDATION_HOSTS.has(req.hostname)) {
    res.redirect(301, `https://${CANONICAL_HOST}${req.originalUrl}`);
    return true;
  }
  return false;
}

// Express matches "/x" and "/x/" alike, so each handler checks the exact
// path: the canonical URLs end in "/", and the bare forms redirect there.
app.get(["/nashville-destinations", "/destinations"], (req, res) => {
  if (destinationsOffTaxiHost(req, res)) return;
  if (req.path === nashvilleDestinations.HUB_PATH) {
    return res.set("Cache-Control", "public, max-age=3600").type("html").send(nashvilleDestinations.renderHubPage());
  }
  res.redirect(301, `${nashvilleDestinations.HUB_PATH}${queryOf(req)}`);
});

app.get("/destinations/:slug", asyncRoute(async (req, res, next) => {
  if (destinationsOffTaxiHost(req, res)) return;
  const destination = nashvilleDestinations.DESTINATIONS.find((d) => d.slug === req.params.slug);
  if (!destination) return next();
  if (!req.path.endsWith("/")) return res.redirect(301, `${nashvilleDestinations.pagePath(destination.slug)}${queryOf(req)}`);
  const travelTimes = await destinationTravelTimes(destination);
  res.set("Cache-Control", "public, max-age=3600")
    .type("html")
    .send(nashvilleDestinations.renderDestinationPage(destination.slug, { travelTimes }));
}));

// Harvey Taxi's root touch icon (the foundation domain gets HTAF's
// through FOUNDATION_STATIC_OVERRIDES above, which runs first).
app.get(["/apple-touch-icon.png", "/apple-touch-icon-precomposed.png"], (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "icon-192.png"));
});

app.get("/sitemap.xml", (req, res) => {
  const isFoundation = req.hostname && FOUNDATION_HOSTS.has(req.hostname);
  const host = isFoundation ? FOUNDATION_HOST : CANONICAL_HOST;
  const urlPaths = isFoundation ? FOUNDATION_SITEMAP_PATHS : TAXI_SITEMAP_PATHS;

  res.type("application/xml").send(buildSitemapXml(host, urlPaths));
});

const JSON_LIMIT = env("JSON_LIMIT", "2mb");

const RAW_WEBHOOK_LIMIT = env("RAW_WEBHOOK_LIMIT", "2mb");

const ALLOWED_ORIGINS = env("ALLOWED_ORIGINS", "")

  .split(",")

  .map((origin) => origin.trim())

  .filter(Boolean);

// CORS origin allow-list — see lib/corsOrigins.js for why this platform's
// multiple public domains need more than a single exact-match origin.
const {
  isAllowedOrigin: isAllowedOriginPure,
  buildCorsRejectionError
} = require("./lib/corsOrigins");

// Render sets this automatically to this exact service's own assigned
// hostname (e.g. "harvey-taxi-app-2.onrender.com") -- a bare hostname,
// not a full URL, unlike RENDER_EXTERNAL_URL. Used only to add this one
// specific origin to the default allow-list below; never a wildcard
// pattern, so an unrelated *.onrender.com service is never accepted.
// Confirmed necessary by production evidence: a same-origin request can
// arrive with this exact Origin even while the page was loaded on the
// custom domain, and APP_BASE_URL alone no longer covers it once
// PUBLIC_APP_URL/APP_BASE_URL is pinned to the custom domain.
const RENDER_EXTERNAL_HOSTNAME = env("RENDER_EXTERNAL_HOSTNAME", "");

function isAllowedOrigin(origin) {
  return isAllowedOriginPure(origin, {
    isProduction: IS_PRODUCTION,
    configuredOrigins: ALLOWED_ORIGINS,
    appBaseUrl: APP_BASE_URL,
    canonicalHost: CANONICAL_HOST,
    foundationHost: FOUNDATION_HOST,
    renderExternalHostname: RENDER_EXTERNAL_HOSTNAME
  });
}

// Render sets this automatically to the deployed commit SHA. Used only
// as a diagnostic marker on rejected-CORS audit rows so a future
// incident can confirm which build actually produced a given log line
// without cross-checking Render's dashboard separately.
const BUILD_SHA = env("RENDER_GIT_COMMIT", null);
// Short commit for /api/health. Only hex characters are ever exposed.
const BUILD_VERSION = /^[0-9a-f]{7,40}$/i.test(String(BUILD_SHA || "")) ? String(BUILD_SHA).slice(0, 7).toLowerCase() : "unknown";
// Synthetic test records (smoke tests, QA) use the reserved .test domain
// (RFC 6761), which can never belong to a real person. They are excluded
// from public totals.
const isSyntheticEmail = (email) => /@example\.test$/i.test(String(email || "").trim());

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

        buildCorsRejectionError(origin, { buildSha: BUILD_SHA })

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

/* Base64-encoded image uploads inflate to ~4/3 their raw size, so the
   default JSON_LIMIT (2mb) isn't enough for a photo upload. Give these
   specific paths a larger, dedicated body limit instead of raising the
   limit globally. */
const LARGE_JSON_LIMIT = env("LARGE_JSON_LIMIT", "8mb");

const LARGE_BODY_PATHS = new Set([

  "/api/driver/photo"

]);

// The delivery-complete route also accepts a base64 delivery-proof photo
// for leave-at-door orders, but its path includes a variable :rideId
// segment, so it can't live in the literal-match Set above.
const LARGE_BODY_PATH_PATTERNS = [

  /^\/api\/driver\/rides\/[^/]+\/complete$/

];

function isLargeBodyPath(path) {

  if (LARGE_BODY_PATHS.has(path)) return true;

  return LARGE_BODY_PATH_PATTERNS.some((pattern) => pattern.test(path));

}

app.use((req, res, next) => {

  if (RAW_WEBHOOK_PATHS.has(req.path)) {

    return next();

  }

  const limit = isLargeBodyPath(req.path)

    ? LARGE_JSON_LIMIT

    : JSON_LIMIT;

  return express.json({

    limit

  })(req, res, next);

});

app.use(

  express.urlencoded({

    extended: true,

    limit: JSON_LIMIT

  })

);

// driver-missions.html retired: it called API routes that never existed
// (GET /api/rides/:id, POST /api/driver/accept, POST /api/driver/reject,
// POST /api/rides/:id/cancel before this phase) -- a second, broken
// driver workflow competing with the one real, live client
// (driver.html, formerly driver-dashboard.html, which uses /api/driver/offers/:id/
// accept|decline and /api/driver/rides/:id/enroute|arrived|start|
// complete|withdraw). Not linked from any live page (confirmed), so this
// redirect exists only to send an old bookmark or direct hit somewhere
// useful rather than a dead page. Must run before express.static, which
// would otherwise serve the file directly if it still existed on disk.
app.get("/driver-missions.html", (req, res) => {
  res.redirect(301, "/driver.html");
});

// admin.html retired: it called API routes that don't exist
// (/api/drivers, /api/approve-driver, /api/reject-driver), so its approve
// and reject buttons always failed. admin-dashboard.html is the working
// admin page; it checks the admin session itself (/api/admin/session) and
// shows its own sign-in when there isn't one, so the redirect neither
// grants nor drops access. Same-origin, so the HttpOnly admin cookie
// still goes with the next request. "/admin" is covered too because
// express.static's extensions:["html"] would otherwise map it to the file.
app.get(["/admin.html", "/admin"], (req, res) => {
  res.redirect(301, "/admin-dashboard.html");
});

// Admin pages are page shells only: every admin read and action goes
// through /api/admin/* routes, which check the admin session or token on
// the server. These headers just keep the shells out of search results
// (robots.txt also disallows /admin).
app.use((req, res, next) => {
  if (/^\/admin[^/]*$/.test(req.path)) res.setHeader("X-Robots-Tag", "noindex, nofollow");
  next();
});

app.use(

  express.static(PUBLIC_DIR, {

    extensions: ["html"],

    maxAge: IS_PRODUCTION ? "1h" : 0,

    // Pages are revalidated on every load (a cheap 304 when unchanged) so
    // a deploy reaches open browsers at once; other files keep the hour.
    setHeaders(res, filePath) {
      if (filePath.endsWith(".html")) res.setHeader("Cache-Control", "no-cache");
    },

  })

);

/* =========================================================

   RATE LIMIT

========================================================= */

const memoryRateLimit = new Map();

/* =========================================================

   OPTIONAL REDIS (Upstash REST) FOR RATE LIMITING

   Uses Upstash's REST API via fetch, so NO extra npm

   dependency is required. If the env vars are absent, the

   limiter transparently falls back to the in-memory Map

   (single-instance behavior, unchanged from before).

   Set in Render:

     UPSTASH_REDIS_REST_URL

     UPSTASH_REDIS_REST_TOKEN

========================================================= */

const UPSTASH_REDIS_REST_URL = env("UPSTASH_REDIS_REST_URL");

const UPSTASH_REDIS_REST_TOKEN = env("UPSTASH_REDIS_REST_TOKEN");

const REDIS_ENABLED =

  Boolean(

    UPSTASH_REDIS_REST_URL &&

    UPSTASH_REDIS_REST_TOKEN

  );

if (REDIS_ENABLED) {

  console.log("✅ Upstash Redis rate limiting active");

} else {

  console.warn("⚠️ Redis not configured — using in-memory rate limiter (single instance)");

}

/* Run a Redis command through the Upstash REST API.

   Returns null on any failure so callers can fall back. */

async function upstashCommand(args) {

  if (!REDIS_ENABLED) return null;

  try {

    const response =

      await fetch(UPSTASH_REDIS_REST_URL, {

        method: "POST",

        headers: {

          Authorization:

            `Bearer ${UPSTASH_REDIS_REST_TOKEN}`,

          "Content-Type": "application/json"

        },

        body: JSON.stringify(args)

      });

    if (!response.ok) {

      return null;

    }

    const json =

      await response.json().catch(() => null);

    return json?.result ?? null;

  } catch {

    return null;

  }

}

/* Fixed-window counter in Redis: INCR then set EXPIRE on

   first hit. Returns the current count, or null on failure. */

async function redisRateHit(key, windowSeconds) {

  const count =

    await upstashCommand(["INCR", key]);

  if (count === null) {

    return null;

  }

  if (Number(count) === 1) {

    await upstashCommand(["EXPIRE", key, String(windowSeconds)]);

  }

  return Number(count);

}

// The caller's IP, for rate limits, usage keys and audit records.
// Production traffic reaches the app through Render's Cloudflare edge,
// which sets CF-Connecting-IP to the address that connected to it and
// replaces any value a client sends. The first X-Forwarded-For entry is
// not used: Render appends to that header, so its first entry is whatever
// the client wrote (verified in production 2026-10-17: a changed header
// got a fresh rate-limit allowance). Without the edge header, req.ip is
// the address the nearest proxy saw ("trust proxy" 1 above).
function getClientIp(req) {
  const edge = String(req.headers["cf-connecting-ip"] || "").trim();
  if (edge && net.isIP(edge)) return edge;
  return req.ip || req.socket?.remoteAddress || "unknown";
}

// keyFn is an optional override for what identifies "one caller" --
// every existing call site omits it and keeps the original IP-only
// behavior. It exists so a route can *also* apply a second, independent
// limit keyed by something other than IP (e.g. a hashed login
// destination -- see riderLoginDestinationKey below), which an IP-only
// limiter can't express: a single attacker rotating IPs against one
// phone number, or one shared IP (an office, a NAT) targeting many
// different destinations, need their own dimension.
const { computeRetryAfterSeconds, buildRateLimitExceededLogEvent } = require("./lib/rateLimit");
const { registerDriverAppRoutes, createDriverRealtime } = require("./lib/driverAppRoutes");
const { locationPolicy: driverAppLocationPolicy, pushKindForTitle: driverAppPushKind, offerPushTitle } = require("./lib/driverApp");


// Emits the exact sanitized event a rejected request produces (see
// buildRateLimitExceededLogEvent, lib/rateLimit.js) and sets both the
// standard Retry-After header and a retry_after_seconds JSON field on
// the response, then sends the 429. Pulled out once so both the Redis
// and in-memory branches below stay identical in what they tell the
// client and what they log -- the only thing that differs between them
// is how retryAfterSeconds is computed (an exact remaining-window
// calculation for the in-memory path; Redis's TTL isn't exposed by
// redisRateHit's current return value, so that branch uses the
// configured window itself as a safe upper-bound approximation).
function sendRateLimitExceeded(res, { keyPrefix, message, retryAfterSeconds }) {
  console.log(
    JSON.stringify(buildRateLimitExceededLogEvent({ keyPrefix, retryAfterSeconds }))
  );

  if (Number.isFinite(retryAfterSeconds)) {
    res.set("Retry-After", String(retryAfterSeconds));
  }

  return fail(res, message, 429, { retry_after_seconds: retryAfterSeconds });
}

function rateLimit({

  windowMs = 60_000,

  max = 60,

  keyPrefix = "global",

  keyFn,

  message = "Too many requests. Please wait and try again."

} = {}) {

  const windowSeconds =

    Math.ceil(windowMs / 1000);

  return async (req, res, next) => {

    const identity = keyFn ? keyFn(req) : getClientIp(req);

    const key = `${keyPrefix}:${identity}`;

    // Try Redis first (scales across instances).

    if (REDIS_ENABLED) {

      const redisCount =

        await redisRateHit(

          `ratelimit:${key}`,

          windowSeconds

        );

      if (redisCount !== null) {

        if (redisCount > max) {

          return sendRateLimitExceeded(res, {
            keyPrefix,
            message,
            retryAfterSeconds: windowSeconds
          });

        }

        return next();

      }

      // Redis failed this call — fall through to memory.

    }

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

      return sendRateLimitExceeded(res, {
        keyPrefix,
        message,
        retryAfterSeconds: computeRetryAfterSeconds({ resetAt: current.resetAt, now })
      });

    }

    next();

  };

}

app.use(

  "/api/",

  rateLimit({

    windowMs: 60_000,

    max: resolvePerMinuteLimit("API_RATE_LIMIT_PER_MINUTE", 120),

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

   CURSOR (KEYSET) PAGINATION

   Encodes the last row's (created_at, id) into an opaque

   base64 cursor. Keyset pagination stays fast no matter how

   deep the list grows, unlike OFFSET. Backward compatible:

   with no cursor, returns the first page and a next_cursor.

========================================================= */

function encodeCursor(row) {

  if (!row) return null;

  const payload = {

    c: row.created_at,

    i: row.id

  };

  return Buffer

    .from(JSON.stringify(payload))

    .toString("base64url");

}

function decodeCursor(cursor) {

  if (!cursor) return null;

  try {

    const json =

      Buffer

        .from(String(cursor), "base64url")

        .toString("utf8");

    const parsed = JSON.parse(json);

    if (!parsed || !parsed.c || !parsed.i) {

      return null;

    }

    return { created_at: parsed.c, id: parsed.i };

  } catch {

    return null;

  }

}

function getPageLimit(req, fallback = 50, cap = 200) {

  const requested =

    Number(req.query.limit);

  if (!Number.isFinite(requested) || requested <= 0) {

    return fallback;

  }

  return Math.min(Math.floor(requested), cap);

}

/* Applies descending keyset pagination to a Supabase query

   on (created_at, id). Returns the modified query. */

function applyCursor(query, cursor) {

  if (!cursor) return query;

  // created_at < cursor.created_at

  //   OR (created_at = cursor.created_at AND id < cursor.id)

  return query.or(

    `created_at.lt.${cursor.created_at},` +

    `and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`

  );

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

// Twilio Verify only accepts strict E.164. See lib/twilioSafety.js:
// returns null for a number that can't be formatted, so callers fail
// closed instead of asking Twilio to text a malformed number.
function toE164(phone) {
  return toVerifyE164(phone);
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

    "delivery",

    "food",

    "grocery"

  ];

  return allowed.includes(type)

    ? type

    : "standard";

}

function isDeliveryRideType(rideType) {

  return rideType === "food" || rideType === "grocery";

}

const DELIVERY_STAGE = {

  ORDER_ACCEPTED: "order_accepted",

  ENROUTE_STORE: "enroute_store",

  ARRIVED_STORE: "arrived_store",

  WAITING_FOR_ORDER: "waiting_for_order",

  PICKED_UP: "picked_up",

  ENROUTE_CUSTOMER: "enroute_customer",

  ARRIVED_CUSTOMER: "arrived_customer",

  DELIVERED: "delivered"

};

const DELIVERY_STAGE_LABELS = {

  order_accepted: "Order accepted",

  enroute_store: "Driver en route to store",

  arrived_store: "Driver at store",

  waiting_for_order: "Waiting for order",

  picked_up: "Order picked up",

  enroute_customer: "Driver en route to you",

  arrived_customer: "Driver has arrived",

  delivered: "Delivered"

};

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

/* =========================================================

   ADMIN SESSION (HttpOnly signed cookie)

   Token format: base64url(payloadJson).hmacHex

   payload = { sub, email, iat, exp }

========================================================= */

function base64UrlEncode(input) {

  return Buffer.from(input)

    .toString("base64")

    .replace(/\+/g, "-")

    .replace(/\//g, "_")

    .replace(/=+$/, "");

}

function base64UrlDecode(input) {

  const pad =

    input.length % 4 === 0

      ? ""

      : "=".repeat(4 - (input.length % 4));

  const normalized =

    input.replace(/-/g, "+").replace(/_/g, "/") + pad;

  return Buffer.from(normalized, "base64").toString("utf8");

}

function signAdminSession(email) {

  if (!ADMIN_SESSION_SECRET) {

    return "";

  }

  const now = Date.now();

  const payload = {

    sub: "htaf-admin",

    email: cleanEmail(email) || cleanEmail(ADMIN_EMAIL),

    iat: now,

    exp: now + ADMIN_SESSION_TTL_HOURS * 60 * 60 * 1000

  };

  const encoded =

    base64UrlEncode(JSON.stringify(payload));

  const sig =

    crypto

      .createHmac("sha256", ADMIN_SESSION_SECRET)

      .update(encoded)

      .digest("hex");

  return `${encoded}.${sig}`;

}

function verifyAdminSession(token) {

  if (!token || !ADMIN_SESSION_SECRET) {

    return null;

  }

  const parts = String(token).split(".");

  if (parts.length !== 2) {

    return null;

  }

  const [encoded, sig] = parts;

  const expected =

    crypto

      .createHmac("sha256", ADMIN_SESSION_SECRET)

      .update(encoded)

      .digest("hex");

  if (!timingSafeEqualString(sig, expected)) {

    return null;

  }

  let payload = null;

  try {

    payload = JSON.parse(base64UrlDecode(encoded));

  } catch {

    return null;

  }

  if (!payload || typeof payload.exp !== "number") {

    return null;

  }

  if (Date.now() > payload.exp) {

    return null;

  }

  return payload;

}

/* -------- DRIVER SESSION (signed token) -------- */

function signDriverSession(driverId) {

  if (!DRIVER_SESSION_SECRET) return "";

  const now = Date.now();

  const payload = {

    sub: "harvey-driver",

    driver_id: String(driverId),

    iat: now,

    exp: now + DRIVER_SESSION_TTL_HOURS * 60 * 60 * 1000

  };

  const encoded =

    base64UrlEncode(JSON.stringify(payload));

  const sig =

    crypto

      .createHmac("sha256", DRIVER_SESSION_SECRET)

      .update(encoded)

      .digest("hex");

  return `${encoded}.${sig}`;

}

function verifyDriverSession(token) {

  if (!token || !DRIVER_SESSION_SECRET) return null;

  const parts = String(token).split(".");

  if (parts.length !== 2) return null;

  const [encoded, sig] = parts;

  const expected =

    crypto

      .createHmac("sha256", DRIVER_SESSION_SECRET)

      .update(encoded)

      .digest("hex");

  if (!timingSafeEqualString(sig, expected)) return null;

  let payload = null;

  try {

    payload = JSON.parse(base64UrlDecode(encoded));

  } catch {

    return null;

  }

  if (!payload || typeof payload.exp !== "number") return null;

  if (Date.now() > payload.exp) return null;

  return payload;

}

function parseCookies(req) {

  const header = req.headers.cookie || "";

  const out = {};

  header.split(";").forEach(part => {

    const idx = part.indexOf("=");

    if (idx === -1) return;

    const key = part.slice(0, idx).trim();

    const val = part.slice(idx + 1).trim();

    if (key) {

      out[key] = decodeURIComponent(val);

    }

  });

  return out;

}

function readAdminSessionCookie(req) {

  const cookies = parseCookies(req);

  return verifyAdminSession(cookies[ADMIN_SESSION_COOKIE]);

}

function setAdminSessionCookie(res, token) {

  const maxAge =

    ADMIN_SESSION_TTL_HOURS * 60 * 60;

  const attrs = [

    `${ADMIN_SESSION_COOKIE}=${encodeURIComponent(token)}`,

    "Path=/",

    "HttpOnly",

    "SameSite=Lax",

    `Max-Age=${maxAge}`

  ];

  if (IS_PRODUCTION) {

    attrs.push("Secure");

  }

  res.append("Set-Cookie", attrs.join("; "));

}

function clearAdminSessionCookie(res) {

  const attrs = [

    `${ADMIN_SESSION_COOKIE}=`,

    "Path=/",

    "HttpOnly",

    "SameSite=Lax",

    "Max-Age=0"

  ];

  if (IS_PRODUCTION) {

    attrs.push("Secure");

  }

  res.append("Set-Cookie", attrs.join("; "));

}

/* =========================================================

   RIDER SESSION COOKIE

   Approved design (docs/rider-auth-design-proposal.md, decision #1):
   HttpOnly + Secure-in-production + SameSite=Lax + Path=/, never a
   bearer token in localStorage. Mirrors the admin session cookie above
   exactly in shape, with its own name/secret/TTL.

========================================================= */

const RIDER_SESSION_COOKIE = "harvey_rider_session";

// CSRF mitigation for the cookie-based design (decision #1): a
// cross-origin fetch() that sets a custom header triggers a CORS
// preflight, which isAllowedOrigin()'s strict allow-list already
// rejects for any origin not on it -- so requiring this header on
// every state-changing rider request closes the classic
// cookie-auto-attached CSRF vector without a separate token scheme.
const RIDER_CLIENT_HEADER = "x-requested-with";
const RIDER_CLIENT_HEADER_VALUE = "harvey-rider-app";

function hasRiderClientHeader(req) {
  return req.headers[RIDER_CLIENT_HEADER] === RIDER_CLIENT_HEADER_VALUE;
}

function setRiderSessionCookie(res, token, ttlHours = RIDER_SESSION_TTL_HOURS) {
  const maxAge = Math.round(ttlHours * 60 * 60);

  const attrs = [
    `${RIDER_SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAge}`
  ];

  if (IS_PRODUCTION) {
    attrs.push("Secure");
  }

  res.append("Set-Cookie", attrs.join("; "));
}

function clearRiderSessionCookie(res) {
  const attrs = [`${RIDER_SESSION_COOKIE}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];

  if (IS_PRODUCTION) {
    attrs.push("Secure");
  }

  res.append("Set-Cookie", attrs.join("; "));
}

function readRiderSessionCookie(req) {
  const cookies = parseCookies(req);
  return cookies[RIDER_SESSION_COOKIE] || "";
}

// riderPhoneLast10/riderPhoneToE164 above are lib/riderAuth.js's
// phoneLast10/phoneToE164US, imported under their original server.js
// names so every existing call site below is unchanged -- see that
// module for why rider phone lookups need this normalization (real,
// confirmed format drift in the live riders table).

// A duplicate phone across two rider rows, or a longer malformed value
// that merely *ends* in the same 10 digits, means an ilike suffix match
// can return more than one row -- and did, live, once tested against
// this table (see PR #91 review). .maybeSingle() would throw on >1 row;
// picking data[0] would silently authenticate as the wrong rider. This
// loads every row the ilike prefilter could plausibly match and hands
// the raw candidate list to lib/riderAuth.js's
// selectExactlyOneActiveRider, which deterministically narrows to an
// exact-normalized-match, active, non-revoked row and proceeds only
// when exactly one remains -- see that function for the full rationale.
// The ambiguity-resolution *decision* lives in the unit-tested lib
// function; this wrapper is only the live Supabase fetch around it.
async function findExactlyOneActiveRiderByPhone(rawPhone) {
  const last10 = riderPhoneLast10(rawPhone);

  if (!last10) {
    return { rider: null, matchCount: 0 };
  }

  const { data, error } = await supabase.from("riders").select("*").ilike("phone", `%${last10}`);

  if (error) {
    console.error("❌ Rider phone lookup failed:", error.message);
    return { rider: null, matchCount: 0 };
  }

  const result = selectExactlyOneActiveRider(data, last10);

  if (result.matchCount > 1) {
    console.error(
      `❌ Rider phone lookup ambiguous: ${result.matchCount} active riders share the same normalized phone number.`
    );
  }

  return result;
}

// Rate-limit key for the destination dimension (decision requirement:
// both an IP limit and a separate per-destination limit) -- delegates
// the actual normalize-and-hash decision to lib/riderAuth.js's
// hashLoginDestination so it's unit-tested directly; this wrapper only
// pulls the raw fields off the request.
function riderLoginDestinationKey(req) {
  return hashLoginDestination({
    phone: cleanString(req.body?.phone, 32),
    email: cleanEmail(req.body?.email)
  });
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

  const session = readAdminSessionCookie(req);

  if (session) {

    req.admin = {

      id: "session-admin",

      email: session.email || ADMIN_EMAIL,

      method: "admin_session"

    };

    return next();

  }

  return fail(

    res,

    "Admin authorization required.",

    401

  );

}

// requireAdmin() without sending a response: true only when the request
// carries the same admin credentials requireAdmin() accepts. For routes
// that are public but return extra detail to an authenticated admin.
function isAdminRequest(req) {
  let authorized = false;
  const discard = {
    status() { return discard; },
    json() { return discard; }
  };
  requireAdmin(req, discard, () => {
    authorized = true;
  });
  return authorized;
}

// Stricter than requireAdmin(): only the pre-shared-secret admin_token
// method qualifies, not an ordinary admin_password/admin_session login.
// Reserved for actions that can make a driver dispatch-eligible without
// a real background check having run — see lib/driverCompliance.js.
function requireElevatedAdmin(req, res, next) {

  requireAdmin(req, res, () => {

    // requireAdmin only ever invokes this callback after successfully
    // authenticating and setting req.admin — a failure calls fail(res, ...)
    // itself and never reaches here.
    if (req.admin?.method !== "admin_token") {

      return fail(

        res,

        "Elevated admin authorization is required for this action.",

        403

      );

    }

    return next();

  });

}

/* =========================================================

   DRIVER AUTH

   Drivers are Supabase Auth users. We verify the bearer

   token, then resolve the driver row by email (the field

   stored at signup). The resolved row is attached as

   req.driver so routes NEVER trust a client-supplied

   driver_id. An admin token/session may also act on behalf

   of a driver by passing driver_id (for ops tooling).

========================================================= */

// Authenticates the calling driver. requireDriver (used by most driver
// routes) keeps the admin-token override for internal ops tooling;
// requireDriverSelf is for actions only the driver may take themselves --
// accepting or declining an offer -- and never honors admin credentials, so
// an administrator can't act as a driver there. Admin intervention belongs
// on the admin-only routes (e.g. POST /api/admin/rides/:id/assign-driver).
function requireDriver(req, res, next) {
  return authenticateDriver(req, res, next, { allowAdminOverride: true });
}

function requireDriverSelf(req, res, next) {
  return authenticateDriver(req, res, next, { allowAdminOverride: false });
}

async function authenticateDriver(req, res, next, { allowAdminOverride }) {

  try {

    // Preferred path: a signed driver session token (from the

    // driver dashboard's OTP login). Verify it and load the driver.

    const driverToken =

      req.headers["x-driver-token"];

    if (driverToken) {

      const session =

        verifyDriverSession(driverToken);

      if (!session) {

        return fail(

          res,

          "Your driver session has expired. Please sign in again.",

          401

        );

      }

      const { data: sessDriver, error: sessErr } =

        await supabase

          .from("drivers")

          .select("*")

          .eq("id", session.driver_id)

          .single();

      if (sessErr || !sessDriver) {

        return fail(res, "Driver not found.", 404);

      }

      if (sessDriver.access_revoked === true) {

        return fail(

          res,

          "This account has been deleted or its access has been revoked.",

          403

        );

      }

      // Google Play reviewer-account kill switch -- same re-check as
      // requireRider, run on every authenticated request so disabling
      // review_account_login_enabled immediately rejects an
      // already-issued reviewer driver_token, not just new logins.
      // sessDriver was just freshly loaded above from the token's own
      // driver_id, never from anything the client asserted directly.
      const reviewOutcome = resolveReviewSessionOutcome({
        row: sessDriver,
        reviewLoginEnabled: await reviewAccountLoginEnabled()
      });

      if (!reviewOutcome.ok) {
        return fail(res, reviewOutcome.message, reviewOutcome.statusCode);
      }

      req.driver = sessDriver;

      req.driverAuthMethod = "driver_session";

      return next();

    }

    // Admin override for internal ops tooling -- requireDriver only. Under
    // requireDriverSelf, admin credentials are ignored and the request falls
    // through to the Supabase-user check below, which fails with 401 unless
    // the caller is itself an authenticated driver.

    const adminSession = readAdminSessionCookie(req);

    const adminHeaderToken =

      req.headers["x-admin-token"] ||

      req.headers["x-harvey-admin-token"];

    const isAdmin =

      adminSession ||

      (ADMIN_API_TOKEN &&

        adminHeaderToken &&

        timingSafeEqualString(

          adminHeaderToken,

          ADMIN_API_TOKEN

        ));

    if (isAdmin && allowAdminOverride) {

      const overrideId =

        cleanString(

          req.body?.driver_id ||

            req.params?.driverId ||

            req.query?.driver_id,

          100

        );

      if (!overrideId) {

        return fail(

          res,

          "Admin driver action requires driver_id.",

          400

        );

      }

      const { data: adminDriver, error: adminErr } =

        await supabase

          .from("drivers")

          .select("*")

          .eq("id", overrideId)

          .single();

      if (adminErr || !adminDriver) {

        return fail(

          res,

          "Driver not found.",

          404

        );

      }

      req.driver = adminDriver;

      req.driverAuthMethod = "admin_override";

      return next();

    }

    const user =

      await getUserFromRequest(req);

    if (!user) {

      return fail(

        res,

        "Driver authentication required.",

        401

      );

    }

    const email =

      cleanEmail(user.email);

    if (!email) {

      return fail(

        res,

        "Authenticated account has no email on file.",

        403

      );

    }

    const { data: driver, error } =

      await supabase

        .from("drivers")

        .select("*")

        .eq("email", email)

        .single();

    if (error || !driver) {

      return fail(

        res,

        "No driver profile is linked to this account.",

        403

      );

    }

    if (driver.access_revoked === true) {

      return fail(

        res,

        "This account has been deleted or its access has been revoked.",

        403

      );

    }

    req.driver = driver;

    req.user = user;

    req.driverAuthMethod = "supabase_user";

    return next();

  } catch (err) {

    return fail(

      res,

      "Driver authorization failed.",

      401

    );

  }

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

        // Allowlisted fields only: Postgres message/details/hint can echo
        // the values being written.
        { action, error_code: logErrorCode(error) }

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

// Admin RBAC Phase 2: shadow-mode authorization logging (docs/
// security-remediation/admin-rbac-phase2-shadow-mode.md). Computes
// what the proposed RBAC model *would* decide for this request and
// records it -- it never denies, blocks, redirects, or otherwise
// changes the response. Every call site uses
// `logAdminRbacShadowCheck(req, route, capability).catch(() => {})`,
// the same fire-and-forget pattern already used for auditLog() calls
// throughout this file, so a slow or failing shadow check can never
// affect a real admin request.
//
// Deliberately does NOT use resolveAdminRole() (lib/adminRbac.js) --
// that function maps every one of today's three legacy auth methods
// straight to super_admin, which is correct for Phase 1's no-lockout
// guarantee but would make every shadow check here trivially
// "would_allow: true" and produce no evidence about whether the
// proposed role/capability model actually matches real usage. Instead
// this looks up admin_roles by the authenticated email -- the email
// requireAdmin() itself already resolved server-side (the env-var
// admin identity, or the signed admin-session cookie's email), never
// anything read from a request body/header/query parameter.
// Resolves the admin_roles role for the identity requireAdmin() already
// authenticated (never a request-supplied value). Shared by the shadow
// logger below and by requireHtafCapability()'s enforcement.
async function resolveAdminRoleForRequest(req) {

  const admin = req.admin;

  const email =
    admin && typeof admin.email === "string" ? admin.email.trim().toLowerCase() : "";

  const isLegacyAdmin =
    !!email && email === String(ADMIN_EMAIL || "").trim().toLowerCase();

  let dbLookupFailed = false;
  let roleRow = null;

  try {

    // Fetches every admin_roles row rather than filtering server-side
    // with .eq("email", email): the unique index from Phase 1's
    // migration is on lower(email), not on email itself, so a stored
    // value like "CaseWorker@HarveyTaxiService.com" would not match an
    // exact-case-equality filter against the already-normalized lookup
    // email. findAdminRoleRow() (lib/adminRbacShadow.js) does the
    // actual case-insensitive match in JS. The table stays small (one
    // row per admin identity), so fetching all of it per shadow check
    // is not a scaling concern.
    const { data, error } = await supabase
      .from("admin_roles")
      .select("email, role");

    if (error) {
      dbLookupFailed = true;
    } else {
      roleRow = findAdminRoleRow(data, email);
    }

  } catch {
    dbLookupFailed = true;
  }

  return resolveShadowRole({ dbLookupFailed, roleRow, isLegacyAdmin });
}

async function logAdminRbacShadowCheck(req, route, capability) {
  const admin = req.admin;
  const { role, source } = await resolveAdminRoleForRequest(req);
  const wouldAllow = computeShadowWouldAllow(role, capability);

  const entry = buildShadowLogEntry({
    admin,
    route,
    httpMethod: req.method,
    capability,
    role,
    source,
    wouldAllow
  });

  const { error: insertError } = await supabase.from("admin_rbac_shadow_log").insert(entry);

  if (insertError) {
    return { logged: false, error: insertError };
  }

  return { logged: true, wouldAllow, source };

}

// HTAF access separation (#134): runs after requireAdmin() on every HTAF
// application route. An admin is let through only when their admin_roles
// role grants the route's capability (lib/adminRbac.js: super_admin and
// htaf_caseworker today). Harvey Taxi-only roles (dispatcher, support,
// finance, compliance), unknown roles, and identities with no role row
// are denied. If the role lookup fails, only the configured legacy admin
// identity falls back to super_admin -- everyone else is denied.
//
// Every decision is recorded in admin_rbac_shadow_log (identity, route,
// capability, role, allow/deny) -- never any application content.
// alwaysEnforce: ignore the HTAF_RBAC_ENFORCED emergency rollback (used by
// routes that never existed under the old shadow-only model).
function requireHtafCapability(route, capability, { alwaysEnforce = false } = {}) {
  return asyncRoute(async (req, res, next) => {
    const { role, source } = await resolveAdminRoleForRequest(req);
    const allowed = computeShadowWouldAllow(role, capability);

    Promise.resolve(
      supabase.from("admin_rbac_shadow_log").insert(
        buildShadowLogEntry({
          admin: req.admin,
          route,
          httpMethod: req.method,
          capability,
          role,
          source,
          wouldAllow: allowed
        })
      )
    ).catch(() => {});

    if (allowed || (!HTAF_RBAC_ENFORCED && !alwaysEnforce)) {
      return next();
    }

    auditLog({
      actor_type: "admin",
      actor_id: req.admin && req.admin.email ? req.admin.email : null,
      action: "htaf_access_denied",
      entity_type: "route",
      entity_id: route,
      metadata: { capability, role: role || null, source },
      req
    }).catch(() => {});

    return fail(res, "HTAF access requires an HTAF role.", 403);
  });
}

/* =========================================================

   COMMUNICATION HELPERS

========================================================= */

async function sendEmail({

  to,

  subject,

  html,

  text,

  // Optional: sender display name (defaults to SENDGRID_FROM_NAME) and a
  // reply-to address, e.g. the HTAF contact form replies to the visitor.
  fromName,

  replyTo

}) {

  if (

    !sgMail ||

    !SENDGRID_API_KEY ||

    !ENABLE_REAL_EMAIL

  ) {

    console.log(

      "📧 Email skipped:",

      // The recipient's domain only, never the address.
      { to_domain: String(to || "").split("@")[1] || "(none)", subject }

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

      name: fromName || SENDGRID_FROM_NAME

    },

    ...(replyTo ? { replyTo } : {}),

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

      // Never the message itself: it can carry a verification code.
      smsSkippedLogDetails({ to, body })

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

function buildDriverRideFields(driver) {

  return {

    driver_name:

      [driver.first_name, driver.last_name].filter(Boolean).join(" ") ||

      driver.name ||

      driver.full_name ||

      "Driver",

    driver_vehicle:

      [driver.vehicle_year, driver.vehicle_make, driver.vehicle_model]

        .filter(Boolean)

        .join(" "),

    driver_phone: driver.phone || driver.phone_number || null

  };

}

const RIDE_STAGE_MESSAGES = {

  order_submitted: {

    sms: (ride) =>

      `Harvey Taxi: We've received your ${isDeliveryRideType(ride.ride_type) ? "order" : "ride request"}. We'll text you updates as it moves along.`,

    subject: "Request Received"

  },

  driver_assigned: {

    sms: (ride) =>

      `Harvey Taxi: ${ride.driver_name || "A driver"} has been assigned to your ${isDeliveryRideType(ride.ride_type) ? "order" : "ride"}.`,

    subject: "Driver Assigned"

  },

  enroute_pickup: {

    sms: () => `Harvey Taxi: Your driver is on the way to pick you up.`,

    subject: "Driver En Route"

  },

  arrived_pickup: {

    sms: () => `Harvey Taxi: Your driver has arrived at your pickup location.`,

    subject: "Driver Arrived"

  },

  ride_started: {

    sms: () => `Harvey Taxi: Your ride is underway. Have a safe trip!`,

    subject: "Ride Started"

  },

  ride_completed: {

    sms: () => `Harvey Taxi: Your ride is complete. Thanks for riding with Harvey Taxi!`,

    subject: "Ride Complete"

  },

  enroute_store: {

    sms: (ride) =>

      `Harvey Taxi: Your driver is heading to ${ride.merchant_name || "the store"} to pick up your order.`,

    subject: "Driver Heading to Store"

  },

  arrived_store: {

    sms: (ride) =>

      `Harvey Taxi: Your driver has arrived at ${ride.merchant_name || "the store"}.`,

    subject: "Driver at Store"

  },

  picked_up: {

    sms: () => `Harvey Taxi: Your order has been picked up and is on its way to you.`,

    subject: "Order Picked Up"

  },

  enroute_customer: {

    sms: () => `Harvey Taxi: Your driver is on the way to you.`,

    subject: "Driver Heading Your Way"

  },

  arrived_customer: {

    sms: (ride) =>

      `Harvey Taxi: Your driver has arrived.` +

      (ride.delivery_handoff === "hand_to_customer"

        ? " Please have your delivery PIN ready."

        : " Your order will be left at your door."),

    subject: "Driver Has Arrived"

  },

  delivered: {

    sms: () => `Harvey Taxi: Your order has been delivered. Thanks for using Harvey Taxi!`,

    subject: "Delivered"

  },

  // Added alongside the cancellation/withdrawal routes -- neither had any
  // rider notification before (confirmed: no RIDE_STAGE_MESSAGES entry
  // and no notifyRideStage call existed for either case).
  ride_cancelled: {

    sms: () => `Harvey Taxi: Your ride has been cancelled.`,

    subject: "Ride Cancelled"

  },

  no_drivers_available: {

    sms: () => `Harvey Taxi: We couldn't find an available driver for your request, so it has been cancelled. You have not been charged. Please try again.`,

    subject: "No Drivers Available"

  },

  driver_reassigning: {

    sms: () => `Harvey Taxi: Your driver became unavailable. We're finding you another driver now.`,

    subject: "Finding a New Driver"

  }

};

// Best-effort stage-change notification over SMS/email. Never throws —
// a notification failure should never break the ride/delivery action
// that triggered it. Silently no-ops when Twilio/SendGrid aren't
// configured, same as sendSms()/sendEmail() do individually.
// Best-effort browser push. Never throws — same resilience contract as
// sendSms()/sendEmail(). Cleans up subscriptions the push service reports
// as gone (404/410) so a stale endpoint doesn't get retried forever.
// Harvey Taxi Driver app (lib/driverAppRoutes.js): every driver
// notification also nudges the driver's open app stream to re-read its
// state, and goes out as a native push when driver_native_push_enabled is
// on. Assigned where the routes are registered, below.
const driverAppRealtime = createDriverRealtime();
let driverAppNativePush = null;

async function sendPushNotification({ ownerType, ownerId, title, body, url }) {

  if (ownerType === "driver" && ownerId) {
    driverAppRealtime.notifyDriver(ownerId, "sync", { reason: driverAppPushKind(title) });
    if (driverAppNativePush) {
      driverAppNativePush(ownerId, { title, body, kind: driverAppPushKind(title) }).catch(() => {});
    }
  }

  if (!pushEnabled || !ownerId) return;

  try {

    const { data: subs, error } = await supabase
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth")
      .eq("owner_type", ownerType)
      .eq("owner_id", ownerId);

    if (error || !subs || !subs.length) return;

    const payload = JSON.stringify({ title, body, url: url || "/" });

    await Promise.allSettled(
      subs.map(async (sub) => {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            payload
          );

          await supabase
            .from("push_subscriptions")
            .update({ last_used_at: nowIso() })
            .eq("id", sub.id);
        } catch (err) {
          if (err && (err.statusCode === 404 || err.statusCode === 410)) {
            await supabase
              .from("push_subscriptions")
              .delete()
              .eq("id", sub.id)
              .catch(() => {});
          }
        }
      })
    );
  } catch (err) {
    console.error("⚠️ sendPushNotification failed:", err.message);
  }
}

async function notifyRideStage(ride, stageKey) {

  try {

    const template = RIDE_STAGE_MESSAGES[stageKey];

    if (!template) return;

    const body = template.sms(ride);

    // Google Play reviewer-account message suppression (approved
    // requirement): a review ride must never generate a real SMS/email
    // -- ride.is_review_ride is set once at ride-creation time from the
    // rider row's is_review_account column (see POST /api/rides/request),
    // never re-derived here. Push notifications below are NOT suppressed
    // -- they're in-app functionality the driver reviewer account needs
    // to actually exercise the mission flow on their own device, not an
    // external message to a real third party.
    if (!ride.is_review_ride && ride.rider_phone) {

      await sendSms({ to: ride.rider_phone, body }).catch(() => {});

    }

    if (!ride.is_review_ride && ride.rider_id) {

      const { data: rider } = await supabase

        .from("riders")

        .select("email")

        .eq("id", ride.rider_id)

        .maybeSingle();

      if (rider?.email) {

        await sendEmail({

          to: rider.email,

          subject: `Harvey Taxi - ${template.subject}`,

          html: `<p>${body}</p>`

        }).catch(() => {});

      }

      sendPushNotification({

        ownerType: "rider",

        ownerId: ride.rider_id,

        title: `Harvey Taxi - ${template.subject}`,

        body,

        // Opens this ride\'s tracking screen, not a new booking.
        url: `/rider-dashboard.html?screen=track&ride_id=${encodeURIComponent(ride.id)}`

      }).catch(() => {});

    }

  } catch (err) {

    console.error("⚠️ notifyRideStage failed:", err.message);

  }

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

// Straight-line (haversine) distance divided by an assumed average speed.
// This is a rough estimate, not a real driving-route ETA — accurate
// turn-by-turn ETAs require the Google Directions/Distance Matrix API.
const ASSUMED_DELIVERY_SPEED_MPH = envNumber("ASSUMED_DELIVERY_SPEED_MPH", 22);

// Single centralized pricing engine — taxi, scheduled, airport, and HTAF
// rides all call the same calculateRideEstimate(), extracted to
// lib/pricing.js so it's unit-testable without booting the whole server
// (see lib/pricing.test.js). No service calculates its own fare here.
const {
  BASE_FARE,
  PER_MILE_RATE,
  PER_MINUTE_RATE,
  BOOKING_FEE,
  MINIMUM_FARE,
  DRIVER_PAYOUT_PERCENT,
  calculateRideEstimate,
  hasValidTripDistance
} = require("./lib/pricing");

// Server-issued ride quote token: hasValidTripDistance() above only
// proves a request carried a positive miles/minutes pair, not that the
// distance is genuine -- a direct caller could submit {miles: 0.1,
// minutes: 1} for an actual 20-mile trip and that guard alone would
// accept it. signRideQuote()/verifyRideQuote()/quoteMatchesSubmission()
// freeze the computed fare and every input it depends on into a signed
// token at estimate time, so payment-intent and ride-request can charge
// exactly what was quoted instead of trusting client-resubmitted numbers.
// See lib/rideQuote.js and docs/route-verification-requirement.md.
const {
  signRideQuote,
  resolveRideQuote
} = require("./lib/rideQuote");

// No fallback chain, same reasoning as RIDER_SESSION_SECRET below: a
// deployment that hasn't set this explicitly should have quote issuance
// (and therefore payment/dispatch) fail closed with a 503, not silently
// sign quotes with a guessed or shared secret.
const RIDE_QUOTE_SECRET = env("RIDE_QUOTE_SECRET", "");

// Ride tracking access (lib/rideAccess.js): who may read a ride's live
// status and location.
const {
  signRideTrackingToken,
  verifyRideTrackingToken,
  deriveTrackingSecret,
  decideRideViewer,
  shapeStatusForViewer
} = require("./lib/rideAccess");
const liveLocation = require("./lib/liveLocation");
const driverHours = require("./lib/driverHours");
const RIDE_TRACKING_SECRET = deriveTrackingSecret({
  trackingSecret: env("RIDE_TRACKING_SECRET", ""),
  quoteSecret: RIDE_QUOTE_SECRET
});

function rideTrackingTokenFor(rideId) {
  return signRideTrackingToken(rideId, RIDE_TRACKING_SECRET);
}

// Resolves who is asking about this ride, from verified credentials only:
// admin credentials, a rider session that owns the ride, the ride's
// tracking token (x-ride-tracking-token header, or ?t= for EventSource,
// which can't send headers), or the assigned driver's session. Returns
// "admin" | "rider" | "driver" | null.
async function resolveRideViewer(req, ride) {
  if (!ride) return null;
  const isAdmin = isAdminRequest(req);
  const rider = isAdmin ? null : await resolveVerifiedRiderSession(req);
  const rawToken = req.headers["x-ride-tracking-token"] || req.query?.t;
  const trackingTokenValid = verifyRideTrackingToken(ride.id, typeof rawToken === "string" ? rawToken : "", RIDE_TRACKING_SECRET);

  let sessionDriverId = null;
  const driverToken = req.headers["x-driver-token"];
  if (!isAdmin && driverToken && ride.driver_id) {
    const session = verifyDriverSession(driverToken);
    if (session && String(session.driver_id) === String(ride.driver_id)) {
      const { data: driverRow } = await supabase
        .from("drivers")
        .select("id, access_revoked")
        .eq("id", session.driver_id)
        .maybeSingle();
      if (driverRow && driverRow.access_revoked !== true) sessionDriverId = driverRow.id;
    }
  }

  return decideRideViewer({
    ride,
    isAdmin,
    sessionRiderId: rider ? rider.id : null,
    trackingTokenValid,
    sessionDriverId
  });
}

// Short-lived on purpose: long enough for a rider to review pricing and
// authorize payment in one sitting, short enough that a leaked/observed
// token is useless for pricing a *different*, later trip.
const RIDE_QUOTE_TTL_MINUTES = envNumber("RIDE_QUOTE_TTL_MINUTES", 15);

// Rider-only verification helpers, extracted so the mapping from a
// rider row to phone/persona/identity verification booleans is
// unit-tested against the real riders schema in one place. See
// lib/riderVerification.js for why this exists — riders and drivers
// use different column names for the same concepts, and rider code
// was incorrectly reading the driver-shaped columns.
const {
  isRiderPhoneVerified,
  isRiderPersonaVerified,
  buildRiderSignupRecord
} = require("./lib/riderVerification");
const {
  JIT_BOOKING_FLAG,
  AUTO_APPROVAL_RULE: RIDER_AUTO_APPROVAL_RULE,
  isRiderSuspended,
  cleanFirstName: cleanRiderFirstName,
  planRiderAutoApproval,
  buildQuickRiderRecord,
  buildSuspensionUpdate: buildRiderSuspensionUpdate,
  buildReinstatementUpdate: buildRiderReinstatementUpdate,
  cleanStaffReason
} = require("./lib/riderJit");

// Saved payment method helpers — see lib/riderPayments.js for why the
// Stripe Customer/PaymentMethod payload building lives outside server.js.
const {
  buildStripeCustomerPayload,
  mapPaymentMethodsForClient,
  buildPaymentIntentAttachmentFields,
  ownsPaymentMethod,
  decideInitialRideStatus,
  authorizePaymentIntentForRide
} = require("./lib/riderPayments");

// Harvey AI's system prompt for /api/ai/support — see
// lib/harveyAiSystemPrompt.js for why this lives outside server.js.
const { HARVEY_AI_SYSTEM_PROMPT } = require("./lib/harveyAiSystemPrompt");

// Driver readiness / compliance decision logic — see
// lib/driverCompliance.js for why administrative approval and compliance
// verification (Checkr/Persona) are deliberately kept as separate,
// separately-authorized actions.
const {
  computeDriverReadiness,
  driverSetupState,
  parseDriverOnlineRequest,
  evaluateDriverStatusChange,
  buildOrdinaryApprovalUpdate,
  validateComplianceOverrideRequest,
  applyContactVerificationOverride,
  applyComplianceOverride
} = require("./lib/driverCompliance");

const {
  computeHtafPublicStats,
  resolveCreateRideOutcome,
  resolveRiderHtafLookup,
  HTAF_ADMIN_LIST_FIELDS,
  HTAF_ADMIN_DETAIL_FIELDS,
  HTAF_ADMIN_PATCH_RESPONSE_FIELDS,
  HTAF_EXPORT_COLUMNS,
  buildHtafExportCsv,
  resolveHtafExportRequest,
  resolveHtafExportDelivery
} = require("./lib/htafOperations");

const {
  ADMIN_DRIVERS_LIST_FIELDS,
  ADMIN_RIDERS_LIST_FIELDS,
  ADMIN_RIDES_LIST_FIELDS,
  ADMIN_RIDE_MUTATION_FIELDS,
  ADMIN_DRIVER_MUTATION_FIELDS,
  ADMIN_RIDER_MUTATION_FIELDS,
  ADMIN_AUDIT_LOGS_LIST_FIELDS
} = require("./lib/adminDirectory");

const {
  ROUTE_CAPABILITIES: RBAC_SHADOW_ROUTE_CAPABILITIES,
  resolveShadowRole,
  findAdminRoleRow,
  computeWouldAllow: computeShadowWouldAllow,
  buildShadowLogEntry
} = require("./lib/adminRbacShadow");

// Rider session logic (sign/verify/revocation-check) lives in lib/riderAuth.js,
// unlike the driver session functions below (signDriverSession/
// verifyDriverSession), which are inline and untested -- see
// docs/rider-auth-design-proposal.md for the full design.
const {
  signRiderSession,
  verifyRiderSession,
  isSessionVersionCurrent,
  shouldRenewSession,
  applyRiderSessionVersionIncrement,
  buildLogoutOutcome,
  resolveRiderAuthOutcome,
  buildRiderSessionBootstrap,
  buildRiderVerificationFieldUpdate,
  buildAuthUiConfigResponse,
  resolveEnforcedRiderId,
  phoneLast10: riderPhoneLast10,
  phoneToE164US: riderPhoneToE164,
  selectExactlyOneActiveRider,
  resolveVerificationTtlMinutes,
  hashIdentifier,
  hashLoginDestination
} = require("./lib/riderAuth");

// Google Play reviewer-account support -- see docs/security-remediation/
// (or the implementation report handed to the owner alongside this
// change) for the full design. Every decision about what a review
// account may do lives in lib/reviewAccounts.js as a pure function;
// server.js only ever supplies it a freshly loaded database row, never
// anything client-supplied.
const {
  resolveReviewLoginOutcome,
  resolveReviewSessionOutcome,
  isValidatedReviewerSession,
  planReviewAwareDispatch,
  buildSimulatedPaymentIntentResponse,
  decideReviewRideInitialState,
  SIMULATED_PAYMENT_LABEL,
  REVIEW_MODE_LABEL,
  resolveSystemFlagDiagnostics,
  extractSupabaseProjectRef,
  buildFlagDiagnosticLogEvent
} = require("./lib/reviewAccounts");
const reviewDemo = require("./lib/reviewDemo");

const {
  DELETION_STATUS,
  DELETION_MODE,
  REVIEW_DELETION_MESSAGE,
  planAccountDeletion,
  resolveAccountByVerifiedPhone,
  isDeletionConfirmed
} = require("./lib/accountDeletion");

// requireRider — P0 remediation PR #1 (docs/p0-security-remediation-plan.md).
// Not yet applied to any route: this only establishes the middleware and
// its session-validation logic. Wiring it into rider-owned routes (and
// removing the client-supplied-riderId trust those routes currently use
// instead) is PR #2, deliberately kept separate so this foundational
// piece can be reviewed and merged on its own.
//
// Mirrors requireDriver's split above (IO here, decision in a pure lib
// function) but reads the cookie-based rider session instead of an
// x-driver-token header, and enforces the CSRF header (see
// hasRiderClientHeader above) on state-changing requests -- GET requests
// don't carry a body a forged cross-site form/fetch could use to change
// state, so only non-GET methods require it, matching this cookie
// design's own stated rationale.
// The actual verification pipeline, factored out of requireRider so it
// can also back resolveVerifiedRiderSession() below (an *optional*-
// session variant used only where a route must keep working for a
// sessionless caller, but a present, valid session's identity may be
// trusted for something narrow -- see POST /api/rides/request's
// quote-replay handling). Identical checks, identical order, as
// requireRider always ran -- this refactor changes nothing about
// requireRider's own behavior for any existing caller.
async function verifyRiderSessionFromRequest(req) {
  if (req.method !== "GET" && !hasRiderClientHeader(req)) {
    return { ok: false, statusCode: 403, message: "This request could not be verified." };
  }

  if (!RIDER_SESSION_SECRET) {
    console.error("❌ verifyRiderSessionFromRequest: RIDER_SESSION_SECRET is not configured.");
    return { ok: false, statusCode: 503, message: "Rider authentication is not available right now." };
  }

  const token = readRiderSessionCookie(req);
  const verification = token
    ? verifyRiderSession({ token, secret: RIDER_SESSION_SECRET })
    : { ok: false, reason: "no_session" };

  let riderRow = null;

  if (verification.ok) {
    const { data, error } = await supabase
      .from("riders")
      .select("*")
      .eq("id", verification.riderId)
      .maybeSingle();

    if (error) {
      console.error("❌ verifyRiderSessionFromRequest: failed to load rider row:", dbErrorEntry(error));
      return { ok: false, statusCode: 500, message: "Something went wrong verifying your session." };
    }

    riderRow = data || null;
  }

  const outcome = resolveRiderAuthOutcome({ verification, riderRow });

  if (!outcome.ok) {
    return { ok: false, statusCode: outcome.statusCode, message: outcome.message };
  }

  // Google Play reviewer-account kill switch: re-checked on every
  // authenticated request, not just at login, so disabling
  // review_account_login_enabled immediately rejects an already-issued
  // reviewer session cookie rather than only blocking new logins.
  // riderRow was just freshly loaded above -- this never trusts anything
  // from the request itself.
  const reviewOutcome = resolveReviewSessionOutcome({
    row: riderRow,
    reviewLoginEnabled: await reviewAccountLoginEnabled()
  });

  if (!reviewOutcome.ok) {
    return { ok: false, statusCode: reviewOutcome.statusCode, message: reviewOutcome.message };
  }

  return { ok: true, riderRow, shouldRenew: outcome.shouldRenew };
}

async function requireRider(req, res, next) {
  try {
    const result = await verifyRiderSessionFromRequest(req);

    if (!result.ok) {
      return fail(res, result.message, result.statusCode);
    }

    req.rider = result.riderRow;
    req.riderAuthMethod = "rider_session";

    if (result.shouldRenew) {
      const freshToken = signRiderSession({
        riderId: result.riderRow.id,
        sessionVersion: Number.isInteger(result.riderRow.session_version) ? result.riderRow.session_version : 0,
        secret: RIDER_SESSION_SECRET,
        ttlHours: RIDER_SESSION_TTL_HOURS
      });

      setRiderSessionCookie(res, freshToken);
    }

    return next();
  } catch (err) {
    console.error("❌ requireRider unexpected error:", err);
    return fail(res, "Something went wrong verifying your session.", 500);
  }
}

// Optional-session variant: returns the verified rider row if this
// request carries a real, currently-valid rider session, or null
// otherwise -- never fails/rejects the request itself. For routes that
// must keep working for a genuinely sessionless caller (like
// POST /api/rides/request today, since the live rider client has no
// session-issuing UI in production yet -- see the rider-auth rollout
// notes), but where a session, if one IS present and valid, may be
// trusted for a narrow purpose. Never renews the session cookie (no
// side effect on a route that isn't primarily an authenticated
// endpoint).
async function resolveVerifiedRiderSession(req) {
  try {
    const result = await verifyRiderSessionFromRequest(req);
    return result.ok ? result.riderRow : null;
  } catch (err) {
    console.error("❌ resolveVerifiedRiderSession unexpected error:", err);
    return null;
  }
}

// P0 remediation PR 2b (docs/security-remediation/pr-02b-rider-route-enforcement.md).
// Defaulted off, same pattern as rider_history_enabled/rider_auth_ui_enabled:
// getSystemFlag's own fallback means a missing row or a query error both
// resolve to "not enforced" -- never accidentally fail open into being
// enforced, and never accidentally fail closed into blocking every rider
// if the flag check itself breaks.
async function riderAuthEnforced() {
  return (await getSystemFlag("rider_auth_enforced", "false")) === "true";
}

// The Google Play reviewer-account kill switch. Checked both at review
// login (POST /api/review/rider|driver/login -- rejects a *new* login
// outright) and inside requireRider/requireDriver on every subsequent
// request (rejects an *already-issued* reviewer session immediately,
// with no separate revocation list needed -- see
// resolveReviewSessionOutcome in lib/reviewAccounts.js). Defaults to
// "false", same fail-closed convention as every other flag here: a
// missing row or a query error both mean review access stays off.
async function reviewAccountLoginEnabled() {
  return (await getSystemFlag("review_account_login_enabled", "false")) === "true";
}

// Diagnostic hotfix, scoped ONLY to review_account_login_enabled --
// production incident: the flag read back true directly in Supabase
// but the live reviewer-login routes kept returning "temporarily
// disabled." getSystemFlag() itself performs no caching (confirmed by
// its own code, a fresh query on every call), so the leading suspects
// are the running service's Supabase project/credentials not being the
// ones the flag was actually set in, or a stale deploy -- not an
// in-process cache to invalidate. Deliberately does NOT change
// getSystemFlag() itself (used by half a dozen unrelated flags) --
// this duplicates its one query so every other flag check is
// completely unaffected by this hotfix.
//
// Logs one sanitized line per call (see buildFlagDiagnosticLogEvent,
// lib/reviewAccounts.js) containing: the flag name, whether the query
// succeeded, whether a row was found, the normalized boolean outcome,
// a Postgres error code/message on failure, and the Supabase project
// reference parsed from SUPABASE_URL -- and nothing else. Never logs
// SUPABASE_SERVICE_ROLE_KEY, any header, any cookie/session token, or
// any reviewer credential -- none of those values are ever read by, or
// passed into, this function.
async function reviewAccountLoginEnabledWithDiagnostics() {
  const { data, error } = await supabase
    .from("system_flags")
    .select("*")
    .eq("key", "review_account_login_enabled")
    .maybeSingle();

  const diagnostics = resolveSystemFlagDiagnostics({ error, data, fallback: "false" });

  console.log(
    JSON.stringify(
      buildFlagDiagnosticLogEvent({
        flagKey: "review_account_login_enabled",
        diagnostics,
        supabaseProjectRef: extractSupabaseProjectRef(SUPABASE_URL)
      })
    )
  );

  return {
    enabled: diagnostics.value === "true",
    querySucceeded: diagnostics.querySucceeded
  };
}

// Resolves an authenticated Google Play reviewer rider session,
// completely independent of rider_auth_enforced, requireRiderIfEnforced,
// and any client-supplied rider_id/is_review_account/is_review_ride
// field. Approved correction: simulated payment, review-ride creation,
// and review dispatch must never activate just because a request
// supplies or guesses the review rider's id -- they may only activate
// for a request that actually carries a currently-valid session cookie
// for that exact account. This re-derives identity from the rider
// session cookie and a freshly loaded database row on every call,
// reusing the identical verification (resolveRiderAuthOutcome) and
// kill-switch check (isValidatedReviewerSession/
// resolveReviewSessionOutcome, lib/reviewAccounts.js) that
// requireRider applies on every other authenticated rider request --
// so a session that wouldn't pass requireRider (expired, revoked, wrong
// session_version) cannot pass this either, and disabling
// review_account_login_enabled disables this path immediately too,
// even for an otherwise still-valid session. Returns the rider row
// (never null-but-truthy) only when every check passes; every caller
// treats a falsy return as "not an authenticated reviewer," full stop
// -- never as a reason to fall back to a client-supplied identity.
//
// Deliberately does not touch or depend on req.rider -- ordinary rider
// authentication/authorization (requireRider, requireRiderIfEnforced,
// resolveEnforcedRiderId) is completely unchanged by this function's
// existence; it is an additional, independent check the two
// review-aware routes run for themselves.
async function resolveAuthenticatedReviewRider(req) {
  if (!RIDER_SESSION_SECRET) {
    return null;
  }

  // Same CSRF mitigation requireRider itself requires for non-GET
  // requests (see hasRiderClientHeader) -- a reviewer session cookie is
  // still a real, authenticated session, so it gets the same protection.
  if (!hasRiderClientHeader(req)) {
    return null;
  }

  const token = readRiderSessionCookie(req);

  if (!token) {
    return null;
  }

  const verification = verifyRiderSession({ token, secret: RIDER_SESSION_SECRET });

  const { data: riderRow, error } = verification.ok
    ? await supabase.from("riders").select("*").eq("id", verification.riderId).maybeSingle()
    : { data: null, error: null };

  if (error) {
    console.error("❌ resolveAuthenticatedReviewRider: failed to load rider row:", error.message);
    return null;
  }

  const riderAuthOk = resolveRiderAuthOutcome({ verification, riderRow }).ok;

  const isReviewer = isValidatedReviewerSession({
    riderAuthOk,
    row: riderRow,
    reviewLoginEnabled: await reviewAccountLoginEnabled()
  });

  return isReviewer ? riderRow : null;
}

// The actual rollout mechanism for every route migrated in PR 2b: while
// rider_auth_enforced is off (the default), this is a pure passthrough --
// req.rider is never set, and the wrapped route behaves exactly as it did
// before PR 2b, client-supplied riderId included. Once the flag is
// flipped on, this delegates to requireRider for real, and every migrated
// route below is written to then use req.rider.id exclusively and ignore
// whatever riderId/rider_id the client also sent -- see
// resolveEnforcedRiderId in lib/riderAuth.js for that exact decision,
// unit-tested there. This split (a flag-checking wrapper here, a pure
// identity-resolution function in lib/) mirrors requireRider's own split
// from resolveRiderAuthOutcome, for the same reason.
async function requireRiderIfEnforced(req, res, next) {
  if (await riderAuthEnforced()) {
    return requireRider(req, res, next);
  }

  return next();
}

/* =========================================================

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

    let knownColumns;

    let missing;

    if (sample) {

      // A row exists: its keys are authoritative.

      knownColumns = Object.keys(sample);

      missing = HTAF_REQUIRED_COLUMNS.filter(

        (column) => !knownColumns.includes(column)

      );

    } else {

      // Empty table: we cannot infer columns from a row, so

      // verify each required column directly. PostgREST returns

      // an error (code 42703) naming any column that does not

      // exist, letting us detect real absence rather than

      // assuming the schema is correct.

      const columnCheck =

        await supabase

          .from("htaf_applications")

          .select(

            HTAF_REQUIRED_COLUMNS.join(",")

          )

          .limit(1);

      if (columnCheck.error) {

        // Try to extract the offending column name from the

        // error; fall back to marking all as unverified.

        const msg =

          columnCheck.error.message || "";

        const named =

          HTAF_REQUIRED_COLUMNS.filter(

            (column) =>

              msg.includes(`'${column}'`) ||

              msg.includes(`"${column}"`) ||

              msg.includes(` ${column} `)

          );

        missing =

          named.length

            ? named

            : [...HTAF_REQUIRED_COLUMNS];

        knownColumns =

          HTAF_REQUIRED_COLUMNS.filter(

            (c) => !missing.includes(c)

          );

      } else {

        // The explicit select of all required columns succeeded

        // against an empty table, which confirms they all exist.

        knownColumns = [...HTAF_REQUIRED_COLUMNS];

        missing = [];

      }

    }

    htafSchemaStatus = {

      checked: true,

      ok: missing.length === 0,

      missing,

      columns: knownColumns,

      empty_table: !sample,

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

// New-application alerts go only to HTAF_ADMIN_EMAIL, an HTAF-controlled
// mailbox the operator must set explicitly. There is deliberately no
// fallback to ADMIN_EMAIL (a Harvey Taxi mailbox): HTAF applicant activity
// must not reach the separate for-profit company by default. When it is
// not configured the alert is not sent at all and the gap is surfaced to
// operators (server log + critical audit row) instead.
//
// The message itself is a minimal notice -- the application code and a
// link to the secured admin portal. No name, contact details, location,
// program, income or need text is ever put in an email.
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[ch]);
}

async function sendAdminApplicationAlert(application) {
  const code = String(application && application.application_code || "");

  if (!HTAF_ADMIN_EMAIL) {
    console.error(
      "🚨 HTAF_ADMIN_EMAIL is not configured; new-application alert NOT sent.",
      { application_code: code }
    );

    await auditLog({
      actor_type: "system",
      action: "htaf_admin_alert_not_configured",
      entity_type: "htaf_application",
      entity_id: application && application.id ? String(application.id) : null,
      metadata: {
        severity: "critical",
        application_code: code,
        reason: "HTAF_ADMIN_EMAIL is not set"
      }
    }).catch(() => {});

    return {
      sent: false,
      reason: "htaf_admin_email_not_configured"
    };
  }

  const portalUrl = `${APP_BASE_URL}/admin-htaf.html`;
  const safeCode = escapeHtml(code);

  return sendEmail({
    to: HTAF_ADMIN_EMAIL,
    subject: "New HTAF application received",
    text:
      `A new HTAF transportation-assistance application was received.\n` +
      `Application code: ${code}\n\n` +
      `Review it in the secured admin portal: ${portalUrl}\n`,
    html: `
      <p>A new HTAF transportation-assistance application was received.</p>
      <p><strong>Application code:</strong> ${safeCode}</p>
      <p>Review it in the secured admin portal:
        <a href="${escapeHtml(portalUrl)}">${escapeHtml(portalUrl)}</a></p>
    `
  });
}

/* =========================================================
   HTAF CONTACT FORM (lib/htafInquiry.js; public/contact.html)
   Partnership, donation and general inquiries are emailed to HTAF's
   inbox with HTAF as the sender name and the visitor as reply-to. Nothing
   is stored, and the audit log keeps only the topic and whether the email
   went out. The visitor is told it was sent only when it was; otherwise
   they get HTAF's email address and phone number instead.
========================================================= */
const htafInquiry = require("./lib/htafInquiry");
const HTAF_PUBLIC_EMAIL = "WillieHtaf@harveytransportationfoundation.com";
const HTAF_INQUIRY_EMAIL =
  cleanEmail(env("HTAF_INQUIRY_EMAIL", "")) || HTAF_ADMIN_EMAIL || HTAF_PUBLIC_EMAIL.toLowerCase();
app.post(
  "/api/foundation/inquiry",
  rateLimit({
    windowMs: 10 * 60_000,
    max: 5,
    keyPrefix: "htaf_inquiry",
    message: "Too many messages from this connection. Please wait a few minutes, or email HTAF directly."
  }),
  asyncRoute(async (req, res) => {
    const body = req.body || {};
    // Hidden field people never see; automated form fillers do.
    if (String(body.website || "").trim()) return ok(res, { sent: true });
    const { ok: valid, errors, inquiry } = htafInquiry.validateInquiry(body);
    if (!valid) return fail(res, "Please check the highlighted fields.", 400, { fields: errors });
    const message = htafInquiry.buildInquiryEmail(inquiry);
    let result = { sent: false };
    try {
      result = await sendEmail({
        to: HTAF_INQUIRY_EMAIL,
        fromName: "Harvey Transportation Assistance Foundation",
        replyTo: inquiry.email,
        ...message
      });
    } catch (error) {
      console.error("❌ HTAF inquiry email failed:", error?.message);
      result = { sent: false, reason: "send_failed" };
    }
    await auditLog({
      actor_type: "visitor",
      action: result.sent ? "htaf_inquiry_sent" : "htaf_inquiry_not_sent",
      entity_type: "htaf_inquiry",
      metadata: {
        topic: inquiry.topic,
        interest: inquiry.interest || null,
        reason: result.sent ? null : result.reason || (result.skipped ? "email_not_configured" : "unknown")
      }
    }).catch(() => {});
    if (!result.sent) {
      return fail(
        res,
        `Your message couldn't be sent. Please email ${HTAF_PUBLIC_EMAIL} or call 615-636-6201.`,
        503
      );
    }
    return ok(res, { sent: true });
  })
);

/* =========================================================

   HTAF ASSISTANT (lib/htafAssistant.js, docs/htaf-assistant.md)

   Harvey Transportation Assistance Foundation's own help assistant,
   separate from the Harvey Taxi assistant: HTAF's published pages only,
   no model, no actions, no applicant records. Off until an admin sets the
   system flag htaf_assist_enabled to "true". Questions it can't answer are
   kept (redacted excerpt only) in htaf_assistant_questions for HTAF staff.

========================================================= */

const htafAssistant = require("./lib/htafAssistant");
const HTAF_ASSIST = htafAssistant.loadHtafIndex();
const htafAssistUsage = createAgentUsageMeter();
const HTAF_ASSIST_SALT = crypto.randomBytes(16).toString("hex");
const HTAF_ASSIST_DAILY = Object.freeze({ visitor: 60, per_account: 60, global: 5000 });

async function htafAssistEnabled() {
  return (await getSystemFlag("htaf_assist_enabled", "false")) === "true";
}

app.get(
  "/api/htaf/assist/status",
  rateLimit({ windowMs: 60_000, max: 60, keyPrefix: "htaf_assist_status" }),
  asyncRoute(async (req, res) => {
    return ok(res, { assist_available: await htafAssistEnabled() });
  })
);

app.post(
  "/api/htaf/assist",
  rateLimit({ windowMs: 60_000, max: 20, keyPrefix: "htaf_assist" }),
  asyncRoute(async (req, res) => {
    if (!(await htafAssistEnabled())) {
      return res.status(503).json({
        ok: false,
        assist_available: false,
        reply: `The HTAF assistant isn't available right now. You can reach HTAF at ${htafAssistant.SUPPORT.email} or ${htafAssistant.SUPPORT.phone}.`
      });
    }
    const message = typeof req.body?.message === "string" ? req.body.message : "";
    if (!message.trim()) {
      return fail(res, "message required.", 400);
    }
    // Visitors are counted by a salted hash of their IP; no account, no
    // applicant record is read.
    const key = agentUsageKey({ role: "visitor", actorId: null, ip: getClientIp(req), salt: HTAF_ASSIST_SALT });
    const usage = htafAssistUsage.check(key, HTAF_ASSIST_DAILY);
    if (!usage.allowed) {
      return res.status(429).json({
        ok: false,
        assist_available: true,
        limited: true,
        reply: `You've reached today's limit for the HTAF assistant. You can reach HTAF at ${htafAssistant.SUPPORT.email} or ${htafAssistant.SUPPORT.phone}.`
      });
    }
    htafAssistUsage.record(key, null);

    const result = htafAssistant.answerHtafQuestion(HTAF_ASSIST.index, message);
    let logged = false;
    if (result.knowledge_gap && result.gap_excerpt) {
      const { error } = await supabase
        .from("htaf_assistant_questions")
        .insert({ question_excerpt: result.gap_excerpt, intent: result.intent });
      if (error) console.warn("⚠️ HTAF assistant question not logged:", error.message);
      logged = !error;
    }
    return ok(res, {
      assist_available: true,
      reply: result.reply,
      intent: result.intent,
      sources: result.sources,
      actions: result.actions,
      knowledge_gap: result.knowledge_gap,
      gap_logged: logged
    });
  })
);

// HTAF staff: unanswered questions (redacted excerpts), newest first.
app.get(
  "/api/admin/htaf/assistant-questions",
  requireAdmin,
  requireHtafCapability("GET /api/admin/htaf/assistant-questions", "htaf.applications.read"),
  asyncRoute(async (req, res) => {
    const { data, error } = await supabase
      .from("htaf_assistant_questions")
      .select("id, question_excerpt, intent, created_at")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw error;
    return ok(res, {
      questions: data || [],
      assistant: {
        enabled: await htafAssistEnabled(),
        page_sections: HTAF_ASSIST.sections,
        topics: HTAF_ASSIST.topics,
        dropped_topics: HTAF_ASSIST.dropped_topics
      }
    });
  })
);

/* =========================================================

   HTAF TEXT MESSAGES (consent records, guarded sending, reply keywords)

   HTAF only: these never use Harvey Taxi's sender or records.

========================================================= */

async function recordHtafSmsConsent(application, smsConsent) {
  const row = htafSms.consentRecord({
    applicationId: application.id,
    phone: application.phone,
    smsConsent
  });
  // A number HTAF can't text (not a US number) has nothing to record.
  if (!row.phone) return null;
  const { error } = await supabase.from("htaf_sms_consents").insert(row);
  if (error) throw new Error(error.message || "insert failed");
  if (row.event === "opt_in") {
    await sendHtafSms({ phone: row.phone, body: htafSms.WELCOME_MESSAGE }).catch((err) => {
      console.warn("⚠️ HTAF welcome text not sent:", err.message);
    });
  }
  return row;
}

// The only way this app texts on HTAF's behalf: messaging switched on,
// HTAF's own number configured, and a recorded opt-in with no later
// opt-out for this number.
async function sendHtafSms({ phone, body }) {
  const to = htafSms.normalizeUsPhone(phone);
  if (!to) return { sent: false, reason: "invalid_phone" };
  const { data: events, error } = await supabase
    .from("htaf_sms_consents")
    .select("event, created_at")
    .eq("phone", to);
  if (error) return { sent: false, reason: "consent_unavailable" };
  const decision = htafSms.canText({ events, enabled: HTAF_SMS_ENABLED, fromNumber: HTAF_SMS_FROM_NUMBER });
  if (!decision.ok) return { sent: false, reason: decision.reason };
  if (!twilioClient) return { sent: false, reason: "twilio_not_configured" };
  await twilioClient.messages.create({ to, from: HTAF_SMS_FROM_NUMBER, body });
  return { sent: true, reason: null };
}

// Reply keywords sent to HTAF's number (Twilio "A message comes in"
// webhook). Twilio and the carrier send the STOP/START/HELP replies
// themselves; this only records opt-outs and re-opt-ins so HTAF's own
// sending honors them. Requests must carry a valid Twilio signature and be
// addressed to HTAF's number. The message text is never stored.
app.post(
  "/api/htaf/sms/inbound",
  express.urlencoded({ extended: false }),
  asyncRoute(async (req, res) => {
    const signature = req.get("x-twilio-signature") || "";
    const url = `https://${FOUNDATION_HOST}${req.originalUrl}`;
    const valid =
      Boolean(twilio && TWILIO_AUTH_TOKEN && signature) &&
      twilio.validateRequest(TWILIO_AUTH_TOKEN, signature, url, req.body || {});
    if (!valid) {
      return res.status(403).type("text/plain").send("Forbidden");
    }
    const to = htafSms.normalizeUsPhone(req.body.To);
    const from = htafSms.normalizeUsPhone(req.body.From);
    const event = htafSms.keywordOf(req.body.Body);
    if (event && from && to && to === htafSms.normalizeUsPhone(HTAF_SMS_FROM_NUMBER)) {
      const { error } = await supabase.from("htaf_sms_consents").insert({
        phone: from,
        application_id: null,
        event,
        consent_version: null,
        source: "sms_reply_keyword"
      });
      if (error) console.warn("⚠️ HTAF SMS keyword not recorded:", error.message);
    }
    // No reply from this app: Twilio/the carrier already answer keywords.
    return res.type("text/xml").send("<Response></Response>");
  })
);

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

        // Code only: Postgres details/hint can echo the applicant's answers.
        { table: "htaf_applications", ...dbErrorEntry(dbError), payload_keys: dbError?.htaf_payload_keys || [] }

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

    // Optional text-message consent: recorded after the application is
    // saved, and never a reason to refuse it. No record means no texts.
    recordHtafSmsConsent(application, req.body?.sms_consent).catch((error) => {
      console.warn("⚠️ HTAF SMS consent record failed:", error.message);
    });

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

   HTAF PUBLIC STATISTICS

   Read-only, public, no PII. Powers the "Application Dashboard"
   widget on foundation.html. Returns aggregate integers only,
   computed from the canonical HTAF_STATUS enum:

     applications_submitted = all non-deleted HTAF applications
     pending_review         = submitted, under_review, pending_documents
     approved_requests      = approved
     scheduled_rides        = scheduled

   On any database error this returns 503 "unavailable" rather than
   a fabricated 0 — a real zero and a broken query must never look
   the same to the caller. Do not collapse the three pending-review
   statuses into "submitted"; the UI labels them as separate metrics.

========================================================= */

app.get(

  "/api/foundation/public-stats",

  asyncRoute(async (req, res) => {

    const { data, error } =

      await supabase

        .from("htaf_applications")

        .select("status");

    if (error) {

      return fail(

        res,

        "HTAF statistics are temporarily unavailable.",

        503

      );

    }

    const stats =

      computeHtafPublicStats((data || []).filter((row) => !isSyntheticEmail(row.email)).map((row) => row.status));

    return ok(res, {

      ...stats,

      generated_at: nowIso()

    });

  })

);

/* =========================================================

   ADMIN AUTH — LOGIN / LOGOUT / SESSION

   Sets an HttpOnly signed session cookie so no admin

   credential or token needs to live in browser storage.

========================================================= */

app.post(

  "/api/admin/login",

  // Brute-force limits, on top of the general API limit: 10 sign-in
  // attempts per IP per 15 minutes, and 30 from all IPs together (the IP
  // comes from X-Forwarded-For, which a caller can vary).
  rateLimit({ windowMs: 15 * 60_000, max: 10, keyPrefix: "admin_login" }),
  rateLimit({ windowMs: 15 * 60_000, max: 30, keyPrefix: "admin_login_all", keyFn: () => "all" }),

  asyncRoute(async (req, res) => {

    if (!ADMIN_SESSION_SECRET) {

      return fail(

        res,

        "Admin sessions are not configured on the server. Set ADMIN_SESSION_SECRET (or ADMIN_API_TOKEN) in the environment.",

        500

      );

    }

    if (!ADMIN_PASSWORD) {

      return fail(

        res,

        "Admin password login is not configured on the server. Set ADMIN_PASSWORD in the environment.",

        500

      );

    }

    const email =

      cleanEmail(req.body?.email);

    const password =

      String(req.body?.password || "");

    const emailOk =

      email === cleanEmail(ADMIN_EMAIL);

    const passwordOk =

      timingSafeEqualString(password, ADMIN_PASSWORD);

    if (!emailOk || !passwordOk) {

      await auditLog({

        actor_type: "admin",

        actor_id: email || "unknown",

        action: "admin_login_failed"

      });

      return fail(

        res,

        "Invalid admin email or password.",

        401

      );

    }

    const token = signAdminSession(email);

    setAdminSessionCookie(res, token);

    await auditLog({

      actor_type: "admin",

      actor_id: email,

      action: "admin_login_success"

    });

    return ok(res, {

      admin: {

        email,

        expiresInHours: ADMIN_SESSION_TTL_HOURS

      }

    });

  })

);

app.post(

  "/api/admin/logout",

  asyncRoute(async (req, res) => {

    clearAdminSessionCookie(res);

    return ok(res, {

      loggedOut: true

    });

  })

);

app.get(

  "/api/admin/session",

  asyncRoute(async (req, res) => {

    const session = readAdminSessionCookie(req);

    if (!session) {

      return ok(res, {

        authenticated: false

      });

    }

    return ok(res, {

      authenticated: true,

      admin: {

        email: session.email,

        expiresAt: session.exp

      }

    });

  })

);

/* =========================================================

   HTAF ADMIN LIST

========================================================= */

app.get(

  "/api/admin/foundation/applications",

  requireAdmin,
  requireHtafCapability("GET /api/admin/foundation/applications", "htaf.applications.read"),

  asyncRoute(async (req, res) => {

    const status =

      cleanString(

        req.query.status,

        80

      );

    const limit =

      getPageLimit(

        req,

        envNumber("ADMIN_LIST_LIMIT", 200),

        500

      );

    const cursor =

      decodeCursor(req.query.cursor);

    let query =

      supabase

        .from("htaf_applications")

        .select(HTAF_ADMIN_LIST_FIELDS.join(","))

        .order(

          "created_at",

          { ascending: false }

        )

        .order(

          "id",

          { ascending: false }

        )

        .limit(limit);

    if (status) {

      query =

        query.eq(

          "status",

          status

        );

    }

    query = applyCursor(query, cursor);

    const { data, error } =

      await query;

    if (error) {

      throw error;

    }

    const rows = data || [];

    const next_cursor =

      rows.length === limit

        ? encodeCursor(rows[rows.length - 1])

        : null;

    return ok(res, {

      applications:

        rows,

      page: {

        limit,

        count: rows.length,

        next_cursor

      }

    });

  })

);

/* =========================================================

   HTAF ADMIN DETAIL

   Full applicant detail for exactly one application, fetched only
   when an admin actually opens it -- the counterpart to the list
   route above no longer shipping every field for every row (docs/
   security-remediation/htaf-admin-data-minimization.md). Still
   requireAdmin-gated; still an explicit allow-list, not select("*") --
   review_notes/assigned_admin/client_version/source stay excluded here
   too, since nothing in this codebase reads them.

========================================================= */

app.get(
  "/api/admin/foundation/applications/:id",
  requireAdmin,
  requireHtafCapability("GET /api/admin/foundation/applications/:id", "htaf.applications.read_detail"),
  asyncRoute(async (req, res) => {
    const id = cleanString(req.params.id, 100);

    const { data, error } = await supabase
      .from("htaf_applications")
      .select(HTAF_ADMIN_DETAIL_FIELDS.join(","))
      .eq("id", id)
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (!data) {
      return fail(res, "HTAF application not found.", 404);
    }

    return ok(res, { application: data });
  })
);

/* =========================================================

   HTAF ADMIN UPDATE

========================================================= */

app.patch(

  "/api/admin/foundation/applications/:id",

  requireAdmin,
  requireHtafCapability("PATCH /api/admin/foundation/applications/:id", "htaf.applications.update"),

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

        .select(HTAF_ADMIN_PATCH_RESPONSE_FIELDS.join(","))

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

   HTAF ADMIN EXPORT (CSV)

   Bulk PII export is materially different from opening one
   application: it hands a caseworker's entire visible caseload --
   name, email, phone, income, household size, addresses -- as a
   downloadable file. Per docs/security-remediation/
   htaf-admin-data-minimization.md, this is now a server-authorized,
   audited action instead of the browser dumping whatever rows happen
   to already be loaded client-side:

   - requireAdmin-gated, same as every other HTAF admin route.
   - Requires a non-empty, human-readable `reason` in the request body
     (resolveHtafExportRequest) -- an admin must state why before the
     file is generated. This is deliberately not a fixed enum: the
     point is a real justification an auditor can read later, not a
     dropdown a UI can satisfy by always picking the first option.
   - The file is built server-side (buildHtafExportCsv) from a query
     scoped to HTAF_EXPORT_COLUMNS -- not select("*") -- so Supabase
     itself never sends this route a column the export doesn't use,
     including the four dead ones the audit identified. This is the
     only route in this family that reads the wide-but-still-explicit
     PII field set, and only because an export is deliberately a "give
     me everyone (matching these filters)" action.
   - Every export is audit-logged with actor, timestamp (implicit in
     the audit row), row_count, the stated reason, and whatever
     status/program_type filter was applied. This audit write is
     fail-closed, the same principle already used for driver compliance
     overrides: the CSV is never sent unless auditLog() actually
     persisted the record. auditLog() itself never throws -- a failed
     insert resolves as {logged: false, error}, not a rejection -- so
     the gate has to check the resolved outcome, not wrap it in
     try/catch. See resolveHtafExportDelivery() (lib/htafOperations.js)
     for the (tested) decision, and its regression test for what
     happens when the audit write fails.

========================================================= */

app.post(
  "/api/admin/foundation/applications/export",
  requireAdmin,
  requireHtafCapability("POST /api/admin/foundation/applications/export", "htaf.applications.export"),
  asyncRoute(async (req, res) => {
    const resolved = resolveHtafExportRequest(req.body || {});

    if (!resolved.ok) {
      return fail(res, resolved.error, resolved.statusCode);
    }

    let query = supabase
      .from("htaf_applications")
      .select(HTAF_EXPORT_COLUMNS.join(","))
      .order("created_at", { ascending: false });

    if (resolved.status) {
      query = query.eq("status", resolved.status);
    }

    if (resolved.programType) {
      query = query.eq("program_type", resolved.programType);
    }

    const { data, error } = await query;

    if (error) {
      throw error;
    }

    const rows = data || [];
    const csv = buildHtafExportCsv(rows);

    const auditResult = await auditLog({
      actor_type: "admin",
      actor_id: req.admin.email,
      action: "htaf_applications_exported",
      entity_type: "htaf_application_export",
      entity_id: null,
      metadata: {
        row_count: rows.length,
        reason: resolved.reason,
        filters: {
          status: resolved.status,
          program_type: resolved.programType
        }
      },
      req
    });

    const delivery = resolveHtafExportDelivery(auditResult);

    if (!delivery.ok) {
      // Never log the CSV/rows here -- only the audit-write failure
      // itself (a Supabase error object: message/code/details/hint),
      // which carries no applicant data.
      console.error(
        "❌ HTAF export blocked: audit record could not be written.",
        auditResult && auditResult.error
      );
      return fail(res, delivery.error, delivery.statusCode);
    }

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="htaf-applications-${nowIso().slice(0, 10)}.csv"`
    );
    return res.status(200).send(csv);
  })
);

/* =========================================================

   HTAF DIAGNOSTIC ROUTE

   Admin only.

========================================================= */

app.get(

  "/api/admin/foundation/schema-check",

  requireAdmin,
  requireHtafCapability("GET /api/admin/foundation/schema-check", "htaf.applications.read"),

  asyncRoute(async (req, res) => {

    const status =

      await inspectHtafSchema();

    return ok(res, {

      htaf_schema:

        status

    });

  })

);

/* =========================================================
   HTAF AI TRIAGE -- REMOVED (2026-10-14, owner decision)

   The external OpenAI triage route (POST .../applications/:id/triage),
   its activation gate (the AI-triage flag + approval record) and its
   facts builder were removed unused: it never ran in production. Its
   history is in Git (last present in commit 0bcaf37). Any future external
   AI integration is a separate reviewed project. HTAF staff use the
   internal review assistant below.
========================================================= */

/* =========================================================
   HTAF REVIEW ASSISTANT (lib/htafReviewAssist.js,
   docs/htaf-review-assistant.md)

   Internal, rule-based help for HTAF staff reviewing an application:
   summary, missing-information checks, suggested follow-up questions.
   No AI model and no external provider: nothing leaves this server.
   Advisory only -- these routes never write to htaf_applications, never
   change status, schedule rides or contact applicants. Staff with the
   HTAF triage capability only. Off until an admin sets the system flag
   htaf_review_assist_enabled to "true" (owner approval required).
   Suggestions are computed on request and not stored; the audit log keeps
   the application id, the rule version and which checks fired -- no
   applicant details.
========================================================= */

const htafReviewAssist = require("./lib/htafReviewAssist");

// Only what the rules need (see FIELDS_READ); never income, household
// size or notes.
const HTAF_REVIEW_ASSIST_COLUMNS =
  "id, first_name, last_name, email, phone, county, pickup_city, destination, ride_date, transportation_need, program_type, applicant_type, status, submitted_at, created_at";

// On only when the flag is exactly "true". Missing, any other value, or a
// database error (getSystemFlag falls back to "false") keeps it off.
async function htafReviewAssistEnabled() {
  return (await getSystemFlag("htaf_review_assist_enabled", "false")) === "true";
}

// Other applications with the same email or phone (for the duplicate
// check). Email is matched lower-cased (as stored by cleanEmail); phone by
// its last 10 digits in every stored form (5551234567, 15551234567,
// +15551234567). Both columns are indexed (email: htaf_applications_email_idx;
// phone: migration 20261014020000). The current application is excluded and
// at most 5 matches are returned: codes, statuses and dates only.
function htafPhoneVariants(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.length < 10) return [];
  const last10 = digits.slice(-10);
  return [last10, `1${last10}`, `+1${last10}`];
}

async function findRelatedHtafApplications(application) {
  const related = new Map();
  const email = String(application.email || "").trim().toLowerCase();
  const probes = [];
  if (email) probes.push(["email", [email]]);
  const phones = htafPhoneVariants(application.phone);
  if (phones.length) probes.push(["phone", phones]);
  for (const [column, values] of probes) {
    const { data, error } = await supabase
      .from("htaf_applications")
      .select("id, application_code, status, submitted_at, created_at")
      .in(column, values)
      .neq("id", application.id)
      .order("submitted_at", { ascending: false })
      .limit(5);
    if (error) throw error;
    for (const row of data || []) related.set(row.id, row);
  }
  return [...related.values()].slice(0, 5);
}

app.post(
  "/api/admin/foundation/applications/:id/review-assist",
  requireAdmin,
  requireHtafCapability("POST /api/admin/foundation/applications/:id/review-assist", "htaf.applications.triage", { alwaysEnforce: true }),
  rateLimit({ windowMs: 60_000, max: 30, keyPrefix: "htaf_review_assist" }),
  asyncRoute(async (req, res) => {
    const id = cleanString(req.params.id, 80);
    if (!(await htafReviewAssistEnabled())) {
      auditLog({
        actor_type: "admin",
        actor_id: req.admin.email,
        action: "htaf_review_assist_blocked",
        entity_type: "htaf_application",
        entity_id: id,
        metadata: { reason: "htaf_review_assist_enabled is off" },
        req
      }).catch(() => {});
      return fail(res, "The HTAF review assistant is turned off.", 403);
    }

    const { data: application, error } = await supabase
      .from("htaf_applications")
      .select(HTAF_REVIEW_ASSIST_COLUMNS)
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    if (!application) return fail(res, "Application not found.", 404);

    const related = await findRelatedHtafApplications(application);
    const review = htafReviewAssist.reviewApplication(application, { related });

    auditLog({
      actor_type: "admin",
      actor_id: req.admin.email,
      action: "htaf_review_assist_run",
      entity_type: "htaf_application",
      entity_id: application.id,
      metadata: { engine: review.engine, checks: review.checks.map((c) => c.id) },
      req
    }).catch(() => {});

    return ok(res, { review });
  })
);

// Staff mark a suggestion as helpful or wrong. Fixed choices only, no free
// text, so no applicant details can end up here.
const HTAF_REVIEW_FEEDBACK = new Set(["helpful", "incorrect", "not_needed"]);
// Why a suggestion was wrong or not needed (optional, fixed codes).
const HTAF_REVIEW_FEEDBACK_REASONS = new Set([
  "information_is_present",
  "county_is_valid",
  "date_is_correct",
  "not_a_duplicate",
  "already_resolved",
  "not_relevant"
]);

app.post(
  "/api/admin/foundation/applications/:id/review-assist/feedback",
  requireAdmin,
  requireHtafCapability("POST /api/admin/foundation/applications/:id/review-assist/feedback", "htaf.applications.triage", { alwaysEnforce: true }),
  rateLimit({ windowMs: 60_000, max: 60, keyPrefix: "htaf_review_assist_feedback" }),
  asyncRoute(async (req, res) => {
    if (!(await htafReviewAssistEnabled())) return fail(res, "The HTAF review assistant is turned off.", 403);
    const id = cleanString(req.params.id, 80);
    const check = cleanString(req.body && req.body.check_id, 60);
    const verdict = cleanString(req.body && req.body.verdict, 20);
    const reason = cleanString(req.body && req.body.reason, 40) || null;
    if (!Object.prototype.hasOwnProperty.call(htafReviewAssist.CHECKS, check) && check !== "summary") {
      return fail(res, "Unknown suggestion.", 400);
    }
    if (!HTAF_REVIEW_FEEDBACK.has(verdict)) return fail(res, "Unknown feedback.", 400);
    if (reason && !HTAF_REVIEW_FEEDBACK_REASONS.has(reason)) return fail(res, "Unknown reason.", 400);
    const { data: exists, error } = await supabase.from("htaf_applications").select("id").eq("id", id).maybeSingle();
    if (error) throw error;
    if (!exists) return fail(res, "Application not found.", 404);
    // Identifiers and fixed codes only: never the suggestion text or any
    // applicant detail.
    await auditLog({
      actor_type: "admin",
      actor_id: req.admin.email,
      action: "htaf_review_assist_feedback",
      entity_type: "htaf_application",
      entity_id: id,
      metadata: { engine: htafReviewAssist.ENGINE, check, verdict, reason },
      req
    });
    return ok(res, { recorded: true });
  })
);

/* =========================================================
   HARVEY TAXI DRIVER REVIEW ASSISTANT (lib/driverReviewAssist.js,
   docs/driver-review-assistant.md)

   Internal, rule-based summary of a driver application for Harvey Taxi
   onboarding staff. Separate from HTAF: its own capability
   (drivers.onboarding_review: the owner, or an explicit per-person grant),
   always enforced, and
   it reads only the drivers table. No AI model, no external provider, no
   telemetry. Advisory only -- these routes never write to drivers and
   never approve, reject, activate or suspend anyone. Off until an admin
   sets the system flag driver_review_assist_enabled to "true" (owner
   approval required). Suggestions are not stored; the audit log keeps the
   driver id, rule version and which checks fired.
========================================================= */

const driverReviewAssist = require("./lib/driverReviewAssist");

const DRIVER_REVIEW_COLUMNS = [
  "id", "email", "phone", "created_at", "approval_status", "status",
  "email_verified", "phone_verified", "sms_verified",
  "persona_status", "identity_status", "persona_verified", "identity_verified", "persona_inquiry_id",
  "checkr_status", "background_check_status", "checkr_candidate_id",
  "license_number", "drivers_license_number", "license_status",
  "vehicle_make", "vehicle_model", "vehicle_year", "vehicle_plate", "license_plate",
  "insurance_confirmed", "insurance_status",
  "accepted_terms", "terms_accepted", "accepted_background_check_consent", "background_check_accepted", "accepted_driver_policy"
];

const DRIVER_REVIEW_CAPABILITY = "drivers.onboarding_review";
const { ONBOARDING_REVIEW_GRANT_ROLES } = require("./lib/adminRbac");

// Explicit, per-person grant (admin_capability_grants), separate from
// driver approval authority. Fails closed: a lookup error is "no grant".
async function hasActiveCapabilityGrant(email, capability) {
  if (!email) return { granted: false, lookupFailed: false };
  const { data, error } = await supabase
    .from("admin_capability_grants")
    .select("email, capability, revoked_at")
    .eq("capability", capability)
    .is("revoked_at", null);
  if (error) return { granted: false, lookupFailed: true };
  const target = String(email).trim().toLowerCase();
  return { granted: (data || []).some((row) => String(row.email || "").trim().toLowerCase() === target), lookupFailed: false };
}

// Always enforced (HTAF_RBAC_ENFORCED does not apply). Allowed: the owner
// (super_admin), or a dispatcher/compliance admin who also holds an active
// drivers.onboarding_review grant. A role alone -- including one with
// drivers.approve -- is never enough.
function requireDriverReviewCapability(route) {
  return asyncRoute(async (req, res, next) => {
    const { role, source } = await resolveAdminRoleForRequest(req);
    let allowed = computeShadowWouldAllow(role, DRIVER_REVIEW_CAPABILITY);
    let grant = "role";
    if (!allowed && ONBOARDING_REVIEW_GRANT_ROLES.includes(role)) {
      const result = await hasActiveCapabilityGrant(req.admin && req.admin.email, DRIVER_REVIEW_CAPABILITY);
      allowed = result.granted;
      grant = result.lookupFailed ? "grant_lookup_failed" : result.granted ? "explicit_grant" : "no_grant";
    } else if (!allowed) {
      grant = "role_not_eligible";
    }
    Promise.resolve(
      supabase.from("admin_rbac_shadow_log").insert(
        buildShadowLogEntry({ admin: req.admin, route, httpMethod: req.method, capability: DRIVER_REVIEW_CAPABILITY, role, source, wouldAllow: allowed })
      )
    ).catch(() => {});
    if (allowed) return next();
    auditLog({
      actor_type: "admin",
      actor_id: req.admin && req.admin.email ? req.admin.email : null,
      action: "driver_review_access_denied",
      entity_type: "route",
      entity_id: route,
      metadata: { capability: DRIVER_REVIEW_CAPABILITY, role: role || null, source, grant },
      req
    }).catch(() => {});
    return fail(res, "Driver review requires an onboarding-review permission.", 403);
  });
}

async function driverReviewEnabled() {
  return (await getSystemFlag("driver_review_assist_enabled", "false")) === "true";
}

async function loadDriverForReview(id) {
  const { data, error } = await supabase.from("drivers").select(DRIVER_REVIEW_COLUMNS.join(", ")).eq("id", id).maybeSingle();
  if (error) throw error;
  return data;
}

// Current expiration records (driver_document_records), with source and
// verification status. Missing table (not migrated yet) means none.
const DRIVER_DOCUMENT_COLUMNS = "document_type, expires_on, source, verification_status";
async function loadDriverDocuments(driverId) {
  const { data, error } = await supabase
    .from("driver_document_records")
    .select(DRIVER_DOCUMENT_COLUMNS)
    .eq("driver_id", driverId)
    .is("superseded_at", null);
  if (error) {
    if (error.code === "42P01" || error.code === "PGRST205") return [];
    throw error;
  }
  return data || [];
}

const digitsOnly = (v) => String(v || "").replace(/\D/g, "").slice(-10);

// Other driver accounts sharing an identifier: account id, date, status
// and which identifier matched -- never the other account's details.
async function findRelatedDrivers(driver) {
  const related = new Map();
  const probes = [
    ["email", "email", text => text && String(text).trim().toLowerCase()],
    ["phone", "phone", (v) => (digitsOnly(v).length === 10 ? digitsOnly(v) : null)],
    ["license", "drivers_license_number", (v) => (v ? String(v).trim() : null)],
    ["license", "license_number", (v) => (v ? String(v).trim() : null)],
    ["plate", "vehicle_plate", (v) => (v ? String(v).trim().toUpperCase() : null)],
    ["plate", "license_plate", (v) => (v ? String(v).trim().toUpperCase() : null)]
  ];
  for (const [label, column, norm] of probes) {
    const value = norm(driver[column]);
    if (!value) continue;
    const { data, error } = await supabase
      .from("drivers")
      .select(`id, created_at, approval_status, status, ${column}`)
      .neq("id", driver.id)
      .ilike(column, column === "phone" ? `%${value}` : value)
      .limit(5);
    if (error) throw error;
    for (const row of data || []) {
      const entry = related.get(row.id) || { id: row.id, created_at: row.created_at, status: row.approval_status || row.status, matched: [] };
      if (!entry.matched.includes(label)) entry.matched.push(label);
      related.set(row.id, entry);
    }
  }
  return [...related.values()];
}

async function hasStaffComplianceOverride(driverId) {
  const { data, error } = await supabase
    .from("audit_logs")
    .select("id, metadata")
    .eq("action", "driver_compliance_override")
    .eq("entity_id", driverId)
    .limit(20);
  if (error) return { checkr: false, persona: false };
  // The override route records the values it set; null means unchanged.
  const rows = data || [];
  const set = (key) => rows.some((r) => r.metadata && r.metadata[key] !== null && r.metadata[key] !== undefined);
  return { checkr: set("checkr_status"), persona: set("persona_verified") };
}

app.post(
  "/api/admin/drivers/:id/review-assist",
  requireAdmin,
  requireDriverReviewCapability("POST /api/admin/drivers/:id/review-assist"),
  rateLimit({ windowMs: 60_000, max: 30, keyPrefix: "driver_review_assist" }),
  asyncRoute(async (req, res) => {
    const id = cleanString(req.params.id, 120);
    if (!(await driverReviewEnabled())) {
      auditLog({
        actor_type: "admin",
        actor_id: req.admin.email,
        action: "driver_review_assist_blocked",
        entity_type: "driver",
        entity_id: id,
        metadata: { reason: "driver_review_assist_enabled is off" },
        req
      }).catch(() => {});
      return fail(res, "The driver review assistant is turned off.", 403);
    }
    const driver = await loadDriverForReview(id);
    if (!driver) return fail(res, "Driver not found.", 404);

    const [related, staffOverrides, documents] = await Promise.all([findRelatedDrivers(driver), hasStaffComplianceOverride(driver.id), loadDriverDocuments(driver.id)]);
    const review = driverReviewAssist.reviewDriver(driver, {
      integrations: { persona: Boolean(PERSONA_API_KEY) && ENABLE_PERSONA, checkr: Boolean(CHECKR_API_KEY) && ENABLE_CHECKR },
      staffOverrides,
      related,
      documents
    });

    auditLog({
      actor_type: "admin",
      actor_id: req.admin.email,
      action: "driver_review_assist_run",
      entity_type: "driver",
      entity_id: driver.id,
      metadata: { engine: review.engine, checks: review.checks.map((c) => c.id) },
      req
    }).catch(() => {});

    return ok(res, { review });
  })
);

const DRIVER_REVIEW_FEEDBACK = new Set(["helpful", "incorrect", "not_needed"]);
// Fixed reason codes only: free text could carry applicant details.
const DRIVER_REVIEW_FEEDBACK_REASONS = new Set([
  "information_is_present",
  "verified_elsewhere",
  "expiration_is_correct",
  "not_a_duplicate",
  "already_resolved",
  "not_relevant"
]);

app.post(
  "/api/admin/drivers/:id/review-assist/feedback",
  requireAdmin,
  requireDriverReviewCapability("POST /api/admin/drivers/:id/review-assist/feedback"),
  rateLimit({ windowMs: 60_000, max: 60, keyPrefix: "driver_review_assist_feedback" }),
  asyncRoute(async (req, res) => {
    if (!(await driverReviewEnabled())) return fail(res, "The driver review assistant is turned off.", 403);
    const id = cleanString(req.params.id, 120);
    const check = cleanString(req.body && req.body.check_id, 60);
    const verdict = cleanString(req.body && req.body.verdict, 20);
    const rawReason = req.body && req.body.reason;
    const reason = rawReason === undefined || rawReason === null || rawReason === "" ? null : cleanString(rawReason, 40);
    if (!Object.prototype.hasOwnProperty.call(driverReviewAssist.CHECKS, check) && check !== "summary") {
      return fail(res, "Unknown suggestion.", 400);
    }
    if (!DRIVER_REVIEW_FEEDBACK.has(verdict)) return fail(res, "Unknown feedback.", 400);
    if (reason !== null && !DRIVER_REVIEW_FEEDBACK_REASONS.has(reason)) return fail(res, "Unknown reason.", 400);
    const { data: driver, error } = await supabase.from("drivers").select("id").eq("id", id).maybeSingle();
    if (error) throw error;
    if (!driver) return fail(res, "Driver not found.", 404);
    await auditLog({
      actor_type: "admin",
      actor_id: req.admin.email,
      action: "driver_review_assist_feedback",
      entity_type: "driver",
      entity_id: driver.id,
      metadata: { engine: driverReviewAssist.ENGINE, check, verdict, reason },
      req
    });
    return ok(res, { recorded: true });
  })
);

/* =========================================================

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

// ttlMinutes and codeType are optional overrides -- every existing
// caller (self-service email/SMS verification) omits both and gets the
// original behavior unchanged: a long hex link-token + hour-scale TTL
// for email, a 6-digit code + minute-scale TTL for SMS. Rider login
// needs a *typeable* code on both channels (matching the driver-login
// and SMS UX) and a short, login-appropriate expiry regardless of
// channel -- see RIDER_LOGIN_EMAIL_TTL_MINUTES below.
async function createVerificationRecord({

  channel,

  destination,

  purpose,

  user_type,

  metadata = {},

  ttlMinutes,

  codeType

}) {

  const isEmail =

    channel === "email";

  const code =

    codeType === "numeric" || !isEmail

      ? makeOtpCode()

      : crypto.randomBytes(24).toString("hex");

  const expires_at =

    futureIsoMinutes(
      resolveVerificationTtlMinutes({
        isEmail,
        ttlMinutes,
        emailVerifyTtlHours: EMAIL_VERIFY_TTL_HOURS,
        verifyTtlMinutes: VERIFY_TTL_MINUTES
      })
    );

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

      delivery: {
        enabled: ENABLE_DELIVERY,
        food: deliveryBookingEnabled("food"),
        grocery: deliveryBookingEnabled("grocery")
      },

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

    const rider = buildRiderSignupRecord({
      id: makeId("RIDER"),
      firstName: cleanString(req.body.first_name, 120),
      lastName: cleanString(req.body.last_name, 120),
      email: cleanEmail(req.body.email),
      phone: cleanPhone(req.body.phone),
      city: cleanString(req.body.city, 120),
      state: cleanString(req.body.state || "TN", 40),
      approvalGateEnabled: ENABLE_RIDER_APPROVAL_GATE,
      now: nowIso()
    });

    const { data, error } =
      await supabase
        .from("riders")
        .insert(rider)
        .select()
        .single();

    if (error) {
      // Never leak Supabase/schema error details to the browser — log
      // the real error server-side against a request ID the client can
      // reference, and return a generic, safe error code instead.
      const requestId = makeId("SIGNUPERR");

      console.error(`⚠️ Rider signup failed [${requestId}]:`, error.message);

      auditLog({
        actor_type: "rider",
        action: "rider_signup_failed",
        entity_type: "rider",
        metadata: { request_id: requestId, reason: error.message, email: rider.email },
        req
      }).catch(() => {});

      return fail(
        res,
        "RIDER_SIGNUP_FAILED",
        500,
        {
          message: "We could not create your rider account. Please try again.",
          request_id: requestId
        }
      );
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

   RIDER SESSION LOGIN (OTP -> HttpOnly cookie session)

   Approved design (docs/rider-auth-design-proposal.md). Three routes:
   start (send a code), verify (check the code, issue the session
   cookie), logout (invalidate it). This PR only adds these routes --
   it does not protect or migrate any existing /api/rider/* route, and
   does not touch the rider_auth_enforced flag. That's deliberately
   separate, later work.

   Phone -> Twilio Verify (the same TWILIO_VERIFY_SERVICE_SID already
   live from the driver-login hotfix), kept completely separate from
   email -> the existing createVerificationRecord/verifyCode +
   SendGrid path (purpose: "rider_login", its own scope, never sharing
   rows with self-service email verification's own codes).

========================================================= */

// Never reveals whether a phone/email matches a real rider -- every
// path returns this exact same shape. The one channel-specific
// difference (SMS vs. email) is intentional: it's what channel the
// rider themselves chose by which field they submitted, not a leak
// about whether an account exists.
const RIDER_SESSION_START_RESPONSE = { sent: true };

// Both the IP dimension and the destination dimension are required
// (review requirement): an IP-only limit misses one attacker rotating
// IPs against a single phone number; a destination-only limit misses
// one IP spraying many destinations. keyFn is undefined for the IP
// limiter (rateLimit's own default), and riderLoginDestinationKey for
// the second.
app.post(
  "/api/rider/session/start",
  rateLimit({ windowMs: 60_000, max: 10, keyPrefix: "rider_session_start_ip" }),
  rateLimit({
    windowMs: 10 * 60_000,
    max: 3,
    keyPrefix: "rider_session_start_dest",
    keyFn: riderLoginDestinationKey
  }),
  asyncRoute(async (req, res) => {
    if (!RIDER_SESSION_SECRET) {
      console.error("❌ Rider session start: RIDER_SESSION_SECRET is not configured.");
      return fail(res, "Rider sign-in is not available right now. Please try again later.", 503);
    }

    if (!hasRiderClientHeader(req)) {
      return fail(res, "This request could not be verified.", 403);
    }

    const rawPhone = cleanString(req.body.phone, 32);
    const rawEmail = cleanEmail(req.body.email);

    if (!rawPhone && !rawEmail) {
      return fail(res, "phone or email is required.", 400);
    }

    if (rawPhone) {
      if (!twilioClient || !TWILIO_VERIFY_SERVICE_SID) {
        console.error("❌ Rider session start: Twilio Verify is not configured.");
        return fail(res, "Rider sign-in is not available right now. Please try again later.", 503);
      }

      // Exactly-one-active-match only -- see findExactlyOneActiveRiderByPhone
      // for why the old .ilike(...).maybeSingle() lookup was unsafe
      // against this table's real, confirmed duplicate/malformed phone
      // data. Zero or multiple matches both fall through silently to
      // the same generic response as "no match" -- ambiguity is never
      // guessed at, and is never visible to the client either way.
      const { rider } = await findExactlyOneActiveRiderByPhone(rawPhone);

      if (rider) {
        const e164 = riderPhoneToE164(rider.phone);

        if (e164) {
          try {
            await twilioClient.verify
              .services(TWILIO_VERIFY_SERVICE_SID)
              .verifications.create({ to: e164, channel: "sms" });
          } catch (err) {
            console.error("❌ Rider session start: Twilio Verify send failed:", describeTwilioError(err));
          }
        }
      }

      // actor_id is a one-way hash, never the raw phone number -- audit
      // logs must not become a store of rider PII for every login
      // attempt, including ones for numbers that aren't even real
      // accounts.
      auditLog({
        actor_type: "rider",
        actor_id: hashIdentifier(riderPhoneLast10(rawPhone) || rawPhone),
        action: "rider_login_started",
        metadata: { channel: "sms" },
        req
      }).catch(() => {});

      return ok(res, RIDER_SESSION_START_RESPONSE);
    }

    const email = rawEmail;

    const { data: rider, error } = await supabase
      .from("riders")
      .select("id, access_revoked, deleted_at")
      .eq("email", email)
      .maybeSingle();

    if (error) {
      console.error("❌ Rider session start: rider lookup failed:", error.message);
    } else if (rider && rider.access_revoked !== true && !rider.deleted_at) {
      try {
        const { code } = await createVerificationRecord({
          channel: "email",
          destination: email,
          purpose: "rider_login",
          user_type: "rider",
          metadata: { requested_from: "web" },
          ttlMinutes: RIDER_LOGIN_EMAIL_TTL_MINUTES,
          codeType: "numeric"
        });

        await sendEmail({
          to: email,
          subject: "Your Harvey Taxi sign-in code",
          text: `Your Harvey Taxi sign-in code is ${code}. It expires in ${RIDER_LOGIN_EMAIL_TTL_MINUTES} minutes.`
        });
      } catch (err) {
        console.error("❌ Rider session start: email OTP send failed:", err.message);
      }
    }

    auditLog({
      actor_type: "rider",
      actor_id: hashIdentifier(email),
      action: "rider_login_started",
      metadata: { channel: "email" },
      req
    }).catch(() => {});

    return ok(res, RIDER_SESSION_START_RESPONSE);
  })
);

app.post(
  "/api/rider/session/verify",
  rateLimit({ windowMs: 60_000, max: 15, keyPrefix: "rider_session_verify_ip" }),
  rateLimit({
    windowMs: 10 * 60_000,
    max: 10,
    keyPrefix: "rider_session_verify_dest",
    keyFn: riderLoginDestinationKey
  }),
  asyncRoute(async (req, res) => {
    if (!RIDER_SESSION_SECRET) {
      console.error("❌ Rider session verify: RIDER_SESSION_SECRET is not configured.");
      return fail(res, "Rider sign-in is not available right now. Please try again later.", 503);
    }

    if (!hasRiderClientHeader(req)) {
      return fail(res, "This request could not be verified.", 403);
    }

    const rawPhone = cleanString(req.body.phone, 32);
    const rawEmail = cleanEmail(req.body.email);
    const code = cleanString(req.body.code, 12);

    if ((!rawPhone && !rawEmail) || !code) {
      return fail(res, "phone or email and code are required.", 400);
    }

    const invalidCode = () => fail(res, "Invalid or expired code.", 400);

    let rider = null;
    const verifiedChannel = rawPhone ? "phone" : "email";

    if (rawPhone) {
      if (!twilioClient || !TWILIO_VERIFY_SERVICE_SID) {
        return invalidCode();
      }

      // Same deterministic, exactly-one-match rule as session/start --
      // a duplicate or ambiguous phone must never let verify guess
      // which rider to sign in as.
      const { rider: candidate } = await findExactlyOneActiveRiderByPhone(rawPhone);

      if (!candidate) {
        return invalidCode();
      }

      const e164 = riderPhoneToE164(candidate.phone);

      if (!e164) {
        return invalidCode();
      }

      let check;
      try {
        check = await twilioClient.verify
          .services(TWILIO_VERIFY_SERVICE_SID)
          .verificationChecks.create({ to: e164, code });
      } catch (err) {
        console.error("❌ Rider session verify: Twilio Verify check failed:", describeTwilioError(err));
        return invalidCode();
      }

      if (check.status !== "approved") {
        return invalidCode();
      }

      rider = candidate;
    } else {
      const email = rawEmail;

      const result = await verifyCode({
        channel: "email",
        destination: email,
        code,
        purpose: "rider_login"
      });

      if (!result.ok) {
        return invalidCode();
      }

      const { data: candidate, error: lookupError } = await supabase
        .from("riders")
        .select("*")
        .eq("email", email)
        .maybeSingle();

      if (lookupError || !candidate) {
        return invalidCode();
      }

      rider = candidate;
    }

    if (rider.access_revoked === true || rider.deleted_at) {
      return fail(res, "This account's access has been revoked.", 403);
    }

    // A successful Twilio Verify check (phone) or verifyCode result
    // (email) above is itself proof the rider currently controls that
    // exact destination -- record only the one channel actually proven,
    // never both, and never before the checks above have already
    // returned invalidCode()/403 for every failure path. Non-blocking:
    // a rider who successfully authenticated must not be locked out of
    // their own login because this side-effect write failed.
    const verificationUpdate = buildRiderVerificationFieldUpdate({ channel: verifiedChannel, rider });

    if (verificationUpdate) {
      const { error: verificationUpdateError } = await supabase
        .from("riders")
        .update(verificationUpdate)
        .eq("id", rider.id);

      if (verificationUpdateError) {
        console.error(
          "❌ Rider session verify: failed to record channel verification:",
          verificationUpdateError.message
        );
      } else {
        Object.assign(rider, verificationUpdate);
      }
    }

    // Option A (owner decision 2026-10-18): with Just-in-Time booking on,
    // a proven phone number approves the rider under the owner's rule.
    if (verifiedChannel === "phone" && (await isJitBookingEnabled())) {
      rider = await applyRiderAutoApproval(rider, req);
    }

    const sessionVersion = Number.isInteger(rider.session_version) ? rider.session_version : 0;

    const token = signRiderSession({
      riderId: rider.id,
      sessionVersion,
      secret: RIDER_SESSION_SECRET,
      ttlHours: RIDER_SESSION_TTL_HOURS
    });

    setRiderSessionCookie(res, token);

    auditLog({
      actor_type: "rider",
      actor_id: rider.id,
      action: "rider_login_succeeded",
      req
    }).catch(() => {});

    return ok(res, { rider_id: rider.id });
  })
);

app.post(
  "/api/rider/session/logout",
  asyncRoute(async (req, res) => {
    if (!hasRiderClientHeader(req)) {
      return fail(res, "This request could not be verified.", 403);
    }

    const token = readRiderSessionCookie(req);
    const verification =
      token && RIDER_SESSION_SECRET ? verifyRiderSession({ token, secret: RIDER_SESSION_SECRET }) : null;

    // verifyRiderSession only exposes riderId once a token's signature
    // has actually been verified (see lib/riderAuth.js) -- an expired
    // or issued-in-future token still carries a trustworthy riderId and
    // *should* still be logged out for real (its session_version bump
    // invalidates it even more thoroughly than a client-side cookie
    // clear would); an unsigned/tampered/malformed token, or no token
    // at all, must never be allowed to name a victim to force-log-out.
    const hadTrustedRiderId = Boolean(verification?.riderId);

    let rpcSucceeded = false;

    if (hadTrustedRiderId) {
      const result = await applyRiderSessionVersionIncrement({
        callRpc: (name, params) => supabase.rpc(name, params),
        riderId: verification.riderId,
        actorType: "rider",
        actorId: verification.riderId,
        action: "rider_logout",
        metadata: {},
        ipAddress: getClientIp(req),
        userAgent: req.headers["user-agent"] || null
      });

      rpcSucceeded = result.ok;

      if (!result.ok) {
        console.error("❌ Rider logout: session_version increment failed:", result.error);
      }
    }

    // The local cookie is cleared unconditionally, regardless of which
    // branch buildLogoutOutcome takes below -- the browser making this
    // request is signed out either way. What varies is whether the
    // *server-side*, every-device revocation is confirmed: a copied or
    // stolen cookie must not be treated as still logged in when it
    // isn't, but this response must also never claim that revocation
    // succeeded when it didn't (see buildLogoutOutcome).
    clearRiderSessionCookie(res);

    const outcome = buildLogoutOutcome({ hadTrustedRiderId, rpcSucceeded });

    if (outcome.statusCode !== 200) {
      return fail(res, outcome.body.error, outcome.statusCode, outcome.body);
    }

    return ok(res, outcome.body);
  })
);

// Session bootstrap (P0 remediation PR #2a, docs/security-remediation/
// pr-02a-rider-client-auth.md). requireRider-protected: the client calls
// this once on load (and again right after a successful verify) to learn
// its actual authenticated identity from the server, instead of trusting
// whatever riderId happens to be sitting in localStorage/the URL. The
// response is deliberately narrow -- see buildRiderSessionBootstrap in
// lib/riderAuth.js for the exact, tested allow-list; this route must
// never grow to just `ok(res, { rider: req.rider })`.
app.get(
  "/api/rider/session",
  requireRider,
  asyncRoute(async (req, res) => {
    const readiness = await getRiderReadiness(req.rider.id);

    return ok(res, buildRiderSessionBootstrap({ rider: req.rider, readiness }));
  })
);

// Rollout switch for the sign-in gate itself (P0 remediation PR 2a,
// docs/security-remediation/pr-02a-rider-client-auth.md) -- deliberately
// separate from the future rider_auth_enforced flag (PR 2b), which
// controls whether the *server* rejects unauthenticated requests to
// rider-owned routes. This one only controls whether the *client* shows
// the new sign-in gate at all. Defaulted off: with no staging
// environment available to validate real SMS/email OTP delivery before
// merge, this lets the code ship to production inert (rider-dashboard.html
// falls back to its pre-PR-2a boot behavior untouched) until an admin
// deliberately flips it on -- a narrowly controlled rollout instead of
// gating every rider's dashboard on unverified OTP delivery. Public and
// unauthenticated on purpose: the client needs to read this before it
// has any session to prove, and "is this UI feature on" isn't sensitive.
app.get(
  "/api/rider/auth-ui-config",
  asyncRoute(async (req, res) => {
    const enabled = (await getSystemFlag("rider_auth_ui_enabled", "false")) === "true";

    return ok(res, buildAuthUiConfigResponse({ enabled }));
  })
);

/* =========================================================
   JUST-IN-TIME RIDER BOOKING (owner decision 2026-10-18)
   Map and fare estimate first; sign-up at "Confirm Ride" with a first
   name, a phone number and a texted code (Twilio Verify). Option A: a
   verified phone number approves the rider automatically, under the
   owner's rule (lib/riderJit.js AUTO_APPROVAL_RULE), with an audit
   record each time. Staff can suspend and reinstate riders (admin
   routes further down). Off unless the jit_booking_enabled system flag
   is "true"; switching it on is the owner's decision. Independent of
   rider_auth_ui_enabled and rider_auth_enforced, which stay as they are.
========================================================= */

async function isJitBookingEnabled() {
  return (await getSystemFlag(JIT_BOOKING_FLAG, "false")) === "true";
}

app.get(
  "/api/rider/jit-config",
  asyncRoute(async (req, res) => {
    return ok(res, { enabled: (await isJitBookingEnabled()) === true });
  })
);

function auditRiderAutoApproval(riderId, previous, req) {
  auditLog({
    actor_type: "system",
    actor_id: "rider_auto_approval",
    action: "rider_auto_approved",
    entity_type: "rider",
    entity_id: riderId,
    metadata: {
      ...RIDER_AUTO_APPROVAL_RULE,
      previous_status: previous.status || null,
      previous_approval_status: previous.approval_status || null
    },
    req
  }).catch(() => {});
}

// Applies the owner's auto-approval rule after a successful phone code
// check. Non-blocking for sign-in: a failed write is logged and the
// rider simply isn't approved yet (booking then refuses, as today).
async function applyRiderAutoApproval(rider, req) {
  const plan = planRiderAutoApproval(rider, nowIso());
  if (!plan) return rider;

  const previous = { status: rider.status, approval_status: rider.approval_status };
  const { error } = await supabase.from("riders").update(plan).eq("id", rider.id);
  if (error) {
    console.error("❌ Rider auto-approval write failed:", error.message);
    return rider;
  }

  auditRiderAutoApproval(rider.id, previous, req);
  return { ...rider, ...plan };
}

// Sends a code to any valid US number (the visitor may not have an
// account yet). Same response whatever the number; the same two rate
// limits as /api/rider/session/start.
app.post(
  "/api/rider/quick/start",
  rateLimit({ windowMs: 60_000, max: 10, keyPrefix: "rider_quick_start_ip" }),
  rateLimit({
    windowMs: 10 * 60_000,
    max: 3,
    keyPrefix: "rider_quick_start_dest",
    keyFn: riderLoginDestinationKey
  }),
  asyncRoute(async (req, res) => {
    if (!(await isJitBookingEnabled())) {
      return fail(res, "This sign-up option is not available.", 404);
    }
    if (!RIDER_SESSION_SECRET) {
      console.error("❌ Rider quick start: RIDER_SESSION_SECRET is not configured.");
      return fail(res, "Rider sign-in is not available right now. Please try again later.", 503);
    }
    if (!hasRiderClientHeader(req)) {
      return fail(res, "This request could not be verified.", 403);
    }
    const e164 = riderPhoneToE164(cleanString(req.body.phone, 32));
    if (!e164) {
      return fail(res, "Enter a 10-digit US mobile number.", 400);
    }
    if (!twilioClient || !TWILIO_VERIFY_SERVICE_SID) {
      console.error("❌ Rider quick start: Twilio Verify is not configured.");
      return fail(res, "Rider sign-in is not available right now. Please try again later.", 503);
    }
    try {
      await twilioClient.verify
        .services(TWILIO_VERIFY_SERVICE_SID)
        .verifications.create({ to: e164, channel: "sms" });
    } catch (err) {
      console.error("❌ Rider quick start: Twilio Verify send failed:", describeTwilioError(err));
    }
    auditLog({
      actor_type: "rider",
      actor_id: hashIdentifier(riderPhoneLast10(e164)),
      action: "rider_login_started",
      metadata: { channel: "sms", flow: "jit_booking" },
      req
    }).catch(() => {});
    return ok(res, RIDER_SESSION_START_RESPONSE);
  })
);

// Checks the code, then signs in the one active rider with this number
// or, when there is none, creates one (first name + phone). Two or more
// active riders sharing the number is never guessed at.
app.post(
  "/api/rider/quick/verify",
  rateLimit({ windowMs: 60_000, max: 15, keyPrefix: "rider_quick_verify_ip" }),
  rateLimit({
    windowMs: 10 * 60_000,
    max: 10,
    keyPrefix: "rider_quick_verify_dest",
    keyFn: riderLoginDestinationKey
  }),
  asyncRoute(async (req, res) => {
    if (!(await isJitBookingEnabled())) {
      return fail(res, "This sign-up option is not available.", 404);
    }
    if (!RIDER_SESSION_SECRET) {
      return fail(res, "Rider sign-in is not available right now. Please try again later.", 503);
    }
    if (!hasRiderClientHeader(req)) {
      return fail(res, "This request could not be verified.", 403);
    }
    const e164 = riderPhoneToE164(cleanString(req.body.phone, 32));
    const code = cleanString(req.body.code, 12);
    if (!e164 || !code) {
      return fail(res, "phone and code are required.", 400);
    }
    const invalidCode = () => fail(res, "Invalid or expired code.", 400);
    if (!twilioClient || !TWILIO_VERIFY_SERVICE_SID) {
      return invalidCode();
    }
    let check;
    try {
      check = await twilioClient.verify
        .services(TWILIO_VERIFY_SERVICE_SID)
        .verificationChecks.create({ to: e164, code });
    } catch (err) {
      console.error("❌ Rider quick verify: Twilio Verify check failed:", describeTwilioError(err));
      return invalidCode();
    }
    if (check.status !== "approved") {
      return invalidCode();
    }

    const { rider: existing, matchCount } = await findExactlyOneActiveRiderByPhone(e164);
    let rider = existing;
    let created = false;

    if (!rider && matchCount > 1) {
      auditLog({
        actor_type: "rider",
        actor_id: hashIdentifier(riderPhoneLast10(e164)),
        action: "rider_quick_signin_ambiguous",
        metadata: { match_count: matchCount },
        req
      }).catch(() => {});
      return fail(res, "We couldn't sign you in with this number. Please contact Harvey Taxi support.", 409);
    }

    if (!rider) {
      const firstName = cleanRiderFirstName(req.body.first_name);
      if (!firstName) {
        return fail(res, "Enter your first name so your driver knows who to look for.", 400);
      }
      const record = buildQuickRiderRecord({
        id: makeId("RIDER"),
        firstName,
        phone: riderPhoneLast10(e164),
        now: nowIso()
      });
      const { data, error } = await supabase.from("riders").insert(record).select().single();
      if (error || !data) {
        const requestId = makeId("SIGNUPERR");
        console.error(`⚠️ Rider quick signup failed [${requestId}]:`, error?.message);
        return fail(res, "RIDER_SIGNUP_FAILED", 500, {
          message: "We could not create your rider account. Please try again.",
          request_id: requestId
        });
      }
      rider = data;
      created = true;
      auditLog({
        actor_type: "rider",
        actor_id: rider.id,
        action: "rider_signup_created",
        entity_type: "rider",
        entity_id: rider.id,
        metadata: { flow: "jit_booking" },
        req
      }).catch(() => {});
      auditRiderAutoApproval(rider.id, {}, req);
    } else {
      if (!cleanString(rider.first_name, 120)) {
        const firstName = cleanRiderFirstName(req.body.first_name);
        if (firstName) {
          const { error } = await supabase.from("riders").update({ first_name: firstName }).eq("id", rider.id);
          if (!error) rider = { ...rider, first_name: firstName };
        }
      }
      rider = await applyRiderAutoApproval(rider, req);
    }

    const sessionVersion = Number.isInteger(rider.session_version) ? rider.session_version : 0;
    const token = signRiderSession({
      riderId: rider.id,
      sessionVersion,
      secret: RIDER_SESSION_SECRET,
      ttlHours: RIDER_SESSION_TTL_HOURS
    });
    setRiderSessionCookie(res, token);
    auditLog({
      actor_type: "rider",
      actor_id: rider.id,
      action: "rider_login_succeeded",
      metadata: { flow: "jit_booking", created },
      req
    }).catch(() => {});
    return ok(res, { rider_id: rider.id, created, suspended: isRiderSuspended(rider) });
  })
);

/* =========================================================

   DRIVER SESSION LOGIN (OTP -> signed token)

   The driver dashboard uses this to authenticate:

   1) start: driver_id -> sends an SMS code to the driver's phone via
      Twilio Verify (not the homegrown createVerificationRecord/sendSms
      path other verification flows use -- see docs/production-
      incidents.md: raw SMS from this account's toll-free number failed
      with error 30032, "Toll-Free Number Has Not Been Verified." Twilio
      Verify's default sender is exempt from that requirement for
      verification-code use cases, which is exactly what this is.)

   2) verify: driver_id + code -> returns a signed driver token

========================================================= */

app.post(

  "/api/driver/session/start",

  asyncRoute(async (req, res) => {

    const driverId =

      cleanString(req.body.driver_id, 100);

    if (!driverId) {

      return fail(res, "driver_id is required.", 400);

    }

    const { data: driver, error } =

      await supabase

        .from("drivers")

        .select("id, phone, access_revoked")

        .eq("id", driverId)

        .maybeSingle();

    // A query error (bad column, connection issue, RLS problem) is not
    // the same fact as "no driver with this id" -- collapsing both into
    // "Driver not found" previously hid a missing-column bug behind a
    // misleading 404 and made it impossible to tell a real outage from a
    // bad driver_id. Log the actual error so a schema mismatch like that
    // is immediately visible in the server logs instead of only showing
    // up as silent login failures.
    if (error) {

      console.error(

        "❌ Driver session start: driver lookup failed:",

        error.message

      );

      return fail(

        res,

        "A server error occurred. Please try again.",

        500

      );

    }

    if (!driver) {

      return fail(res, "Driver not found.", 404);

    }

    if (driver.access_revoked === true) {

      return fail(res, "This account's access has been revoked.", 403);

    }

    if (!driver.phone) {

      return fail(res, "No phone number on file for this driver.", 400);

    }

    if (!twilioClient || !TWILIO_VERIFY_SERVICE_SID) {

      console.error(

        "❌ Driver session start: Twilio Verify is not configured."

      );

      return fail(

        res,

        "Driver sign-in is not available right now. Please try again later.",

        503

      );

    }

    const verifyTo = toE164(driver.phone);
    if (!verifyTo) {
      console.error(
        "❌ Driver session start: phone on file can't be formatted for Twilio Verify:",
        driverId
      );
      return fail(
        res,
        "The phone number on file can't receive a login code. Please contact support.",
        422
      );
    }

    let verification;
    try {
      verification =
        await twilioClient.verify
          .services(TWILIO_VERIFY_SERVICE_SID)
          .verifications
          .create({
            to: verifyTo,
            channel: "sms"
          });

    } catch (err) {

      console.error(

        "❌ Driver session start: Twilio Verify send failed:",

        describeTwilioError(err)

      );

      return fail(

        res,

        "Could not send a login code right now. Please try again.",

        502

      );

    }

    // Return the masked phone so the UI can show where the code went.

    const masked =

      driver.phone.replace(/.(?=.{4})/g, "•");

    return ok(res, {

      sent: verification.status === "pending",

      phone_hint: masked

    });

  })

);

app.post(

  "/api/driver/session/verify",

  asyncRoute(async (req, res) => {

    const driverId =

      cleanString(req.body.driver_id, 100);

    const code =

      cleanString(req.body.code, 20);

    if (!driverId || !code) {

      return fail(res, "driver_id and code are required.", 400);

    }

    const { data: driver, error } =

      await supabase

        .from("drivers")

        .select("id, phone, access_revoked")

        .eq("id", driverId)

        .maybeSingle();

    // Same distinction as /session/start: a query error is not "no such
    // driver" and must not be reported as one.
    if (error) {

      console.error(

        "❌ Driver session verify: driver lookup failed:",

        error.message

      );

      return fail(

        res,

        "A server error occurred. Please try again.",

        500

      );

    }

    if (!driver) {

      return fail(res, "Driver not found.", 404);

    }

    if (driver.access_revoked === true) {

      return fail(res, "This account's access has been revoked.", 403);

    }

    if (!twilioClient || !TWILIO_VERIFY_SERVICE_SID) {

      console.error(

        "❌ Driver session verify: Twilio Verify is not configured."

      );

      return fail(

        res,

        "Driver sign-in is not available right now. Please try again later.",

        503

      );

    }

    const verifyTo = toE164(driver.phone);
    if (!verifyTo) {
      return fail(res, "Invalid or expired code.", 400);
    }

    let check;
    try {
      check =
        await twilioClient.verify
          .services(TWILIO_VERIFY_SERVICE_SID)
          .verificationChecks
          .create({
            to: verifyTo,
            code
          });

    } catch (err) {

      // Twilio throws (rather than returning a non-"approved" status)
      // when there is no pending verification at all -- e.g. it already
      // expired or was already used. Treat that the same as a wrong
      // code: don't leak which case it was.
      console.error(

        "❌ Driver session verify: Twilio Verify check failed:",

        describeTwilioError(err)

      );

      return fail(res, "Invalid or expired code.", 400);

    }

    if (check.status !== "approved") {

      return fail(res, "Invalid or expired code.", 400);

    }

    if (!DRIVER_SESSION_SECRET) {

      return fail(

        res,

        "Driver sessions are not configured on the server.",

        500

      );

    }

    const token = signDriverSession(driverId);

    auditLog({

      actor_type: "driver",

      actor_id: driverId,

      action: "driver_login_success",

      req

    }).catch(() => {});

    return ok(res, {

      driver_token: token,

      driver_id: driverId,

      expires_in_hours: DRIVER_SESSION_TTL_HOURS

    });

  })

);

/* =========================================================

   GOOGLE PLAY REVIEWER ACCOUNT LOGIN

   Two dedicated, non-production-identity accounts (one rider, one
   driver) for Google's app reviewers. Deliberately password-based
   rather than OTP: the approved requirement is that reviewer access
   must never depend on delivering a code to a real phone/email, and
   must remain reusable throughout review without contacting the
   account owner. Both routes:
     * are independent of rider_auth_ui_enabled / rider_auth_enforced --
       reviewer login works the same regardless of that rollout's
       current state, and this code never reads or writes that flag.
     * are gated by their own kill switch, review_account_login_enabled
       (default off -- see the migration and reviewAccountLoginEnabled()
       above), checked here for new logins and again inside
       requireRider/requireDriver on every later request.
     * mint the exact same session artifact the real OTP login routes
       do (signRiderSession + cookie / signDriverSession + bearer
       token), so every existing dashboard, middleware, and route
       downstream treats a reviewer session identically to a real one,
       with review-specific behavior applied only where the DB row's
       is_review_account column says so.
     * resolve the account by email + is_review_account = true at the
       query level, then re-confirm via resolveReviewLoginOutcome
       (lib/reviewAccounts.js) -- an ordinary rider/driver's email can
       never authenticate here even with a correct guess at a
       password, since no ordinary row has review_password_hash set.

========================================================= */

// Shared, honest 429 wording for both review-login routes -- the
// approved fix for the client-side bug where a rate-limit rejection
// (429) was indistinguishable from a wrong password, because the
// dashboard only special-cased a 503 and collapsed every other non-2xx
// status into "Invalid reviewer credentials." The exact wait time is
// also returned as retry_after_seconds (see sendRateLimitExceeded) so a
// client can show a more precise countdown when it's available; this
// text is what's shown either way.
const REVIEW_LOGIN_RATE_LIMIT_MESSAGE = "Too many sign-in attempts. Wait 10 minutes and try again.";

app.post(
  "/api/review/rider/login",
  rateLimit({
    windowMs: 60_000,
    max: 10,
    keyPrefix: "review_rider_login_ip",
    message: REVIEW_LOGIN_RATE_LIMIT_MESSAGE
  }),
  rateLimit({
    windowMs: 10 * 60_000,
    max: 5,
    keyPrefix: "review_rider_login_dest",
    keyFn: (req) => hashIdentifier(cleanEmail(req.body.email) || ""),
    message: REVIEW_LOGIN_RATE_LIMIT_MESSAGE
  }),
  asyncRoute(async (req, res) => {
    if (!hasRiderClientHeader(req)) {
      return fail(res, "This request could not be verified.", 403);
    }

    if (!RIDER_SESSION_SECRET) {
      console.error("❌ Review rider login: RIDER_SESSION_SECRET is not configured.");
      return fail(res, "Rider authentication is not available right now.", 503);
    }

    const email = cleanEmail(req.body.email);
    const password = typeof req.body.password === "string" ? req.body.password : "";

    if (!email || !password) {
      return fail(res, "email and password are required.", 400);
    }

    const { data: row, error } = await supabase
      .from("riders")
      .select("*")
      .eq("email", email)
      .eq("is_review_account", true)
      .maybeSingle();

    if (error) {
      console.error("❌ Review rider login: lookup failed:", error.message);
      return fail(res, "A server error occurred. Please try again.", 500);
    }

    const flagState = await reviewAccountLoginEnabledWithDiagnostics();

    const outcome = resolveReviewLoginOutcome({
      row,
      password,
      reviewLoginEnabled: flagState.enabled,
      flagQuerySucceeded: flagState.querySucceeded
    });

    if (!outcome.ok) {
      // Non-enumerating audit trail for a rejected reviewer login --
      // actor_id is a one-way hash of the submitted email, never the
      // raw address, same convention as the real rider login-start
      // route's failed-attempt logging. The public response above
      // (outcome.message/statusCode) never varies by reason -- this is
      // strictly for internal diagnosis of exactly the incident that
      // motivated it (a flag that reads true in Supabase but false in
      // the running service).
      auditLog({
        actor_type: "rider",
        actor_id: hashIdentifier(email),
        action: "review_rider_login_rejected",
        metadata: { reason: outcome.reason },
        req
      }).catch(() => {});

      return fail(res, outcome.message, outcome.statusCode);
    }

    const sessionVersion = Number.isInteger(row.session_version) ? row.session_version : 0;

    const token = signRiderSession({
      riderId: row.id,
      sessionVersion,
      secret: RIDER_SESSION_SECRET,
      ttlHours: RIDER_SESSION_TTL_HOURS
    });

    setRiderSessionCookie(res, token);

    auditLog({
      actor_type: "rider",
      actor_id: row.id,
      action: "review_rider_login_succeeded",
      req
    }).catch(() => {});

    return ok(res, { rider_id: row.id });
  })
);

app.post(
  "/api/review/driver/login",
  rateLimit({
    windowMs: 60_000,
    max: 10,
    keyPrefix: "review_driver_login_ip",
    message: REVIEW_LOGIN_RATE_LIMIT_MESSAGE
  }),
  rateLimit({
    windowMs: 10 * 60_000,
    max: 5,
    keyPrefix: "review_driver_login_dest",
    keyFn: (req) => hashIdentifier(cleanEmail(req.body.email) || ""),
    message: REVIEW_LOGIN_RATE_LIMIT_MESSAGE
  }),
  asyncRoute(async (req, res) => {
    if (!DRIVER_SESSION_SECRET) {
      return fail(res, "Driver sessions are not configured on the server.", 500);
    }

    const email = cleanEmail(req.body.email);
    const password = typeof req.body.password === "string" ? req.body.password : "";

    if (!email || !password) {
      return fail(res, "email and password are required.", 400);
    }

    const { data: row, error } = await supabase
      .from("drivers")
      .select("*")
      .eq("email", email)
      .eq("is_review_account", true)
      .maybeSingle();

    if (error) {
      console.error("❌ Review driver login: lookup failed:", error.message);
      return fail(res, "A server error occurred. Please try again.", 500);
    }

    const flagState = await reviewAccountLoginEnabledWithDiagnostics();

    const outcome = resolveReviewLoginOutcome({
      row,
      password,
      reviewLoginEnabled: flagState.enabled,
      flagQuerySucceeded: flagState.querySucceeded
    });

    if (!outcome.ok) {
      // See POST /api/review/rider/login above for why this exists and
      // what it deliberately never varies (the public response) vs.
      // what it captures for diagnosis only (the reason code).
      auditLog({
        actor_type: "driver",
        actor_id: hashIdentifier(email),
        action: "review_driver_login_rejected",
        metadata: { reason: outcome.reason },
        req
      }).catch(() => {});

      return fail(res, outcome.message, outcome.statusCode);
    }

    const token = signDriverSession(row.id);

    auditLog({
      actor_type: "driver",
      actor_id: row.id,
      action: "review_driver_login_succeeded",
      req
    }).catch(() => {});

    return ok(res, {
      driver_token: token,
      driver_id: row.id,
      expires_in_hours: DRIVER_SESSION_TTL_HOURS
    });
  })
);

/* =========================================================

   ADMIN: GOOGLE PLAY REVIEWER ACCOUNT LOGIN KILL SWITCH

   Same upsert/audit pattern as enable/disable-rider-auth-enforced
   above. Defaults off (see the migration) -- an admin must explicitly
   enable this after the two review accounts, isolation controls, and
   tests are verified, per the approved rollout requirement.

========================================================= */

app.post(
  "/api/admin/system/enable-review-account-login",
  requireAdmin,
  asyncRoute(async (req, res) => {
    await supabase
      .from("system_flags")
      .upsert({
        key: "review_account_login_enabled",
        value: "true",
        reason: cleanString(req.body.reason, 1000),
        updated_at: nowIso()
      });

    auditLog({
      actor_type: "admin",
      actor_id: req.admin.email,
      action: "review_account_login_enabled",
      req
    }).catch(() => {});

    return ok(res, { review_account_login_enabled: true });
  })
);

app.post(
  "/api/admin/system/disable-review-account-login",
  requireAdmin,
  asyncRoute(async (req, res) => {
    await supabase
      .from("system_flags")
      .upsert({
        key: "review_account_login_enabled",
        value: "false",
        reason: null,
        updated_at: nowIso()
      });

    auditLog({
      actor_type: "admin",
      actor_id: req.admin.email,
      action: "review_account_login_disabled",
      req
    }).catch(() => {});

    return ok(res, { review_account_login_enabled: false });
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

      // riders has no phone_verified column -- sms_verified is the
      // real one (see lib/riderVerification.js). This used to silently
      // no-op via Promise.allSettled, so rider phone verification never
      // actually persisted.
      supabase

        .from("riders")

        .update({

          sms_verified:

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

    throw Object.assign(new Error(

      json?.errors?.[0]?.detail ||

      json?.message ||

      "Persona request failed."

    ), { httpStatus: response.status });

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

    // Only the signed-in rider or driver can start a check for their own
    // account: this writes persona_inquiry_id/persona_status on that row.
    const callerId = userType === "rider"
      ? (await resolveVerifiedRiderSession(req))?.id
      : verifyDriverSession(req.headers["x-driver-token"])?.driver_id;
    if (!callerId) {
      return fail(res, "Please sign in to start identity verification.", 401);
    }
    if (String(callerId) !== cleanString(req.body.user_id, 100)) {
      return fail(res, "You can only start identity verification for your own account.", 403);
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

        // The provider's error text can echo the applicant's details.
        error.httpStatus ? { http_status: error.httpStatus } : error.message

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

        // riders has no persona_verified column -- persona_status alone
        // is the source of truth there (isRiderPersonaVerified() reads
        // it). Bundling persona_verified into this update used to make
        // the entire riders update fail, so persona_status silently
        // never updated for riders either.
        supabase

          .from("riders")

          .update({

            persona_status:

              status,

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

    throw Object.assign(new Error(

      json?.error ||

      json?.message ||

      "Checkr request failed."

    ), { httpStatus: response.status });

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

  requireDriver,

  asyncRoute(async (req, res) => {

    const driverId = req.driver.id;

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

        // The provider's error text can echo the applicant's details.
        error.httpStatus ? { http_status: error.httpStatus } : error.message

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

    const { ready, checks } =

      computeDriverReadiness(

        driver,

        {

          enablePersona:

            ENABLE_PERSONA,

          enableCheckr:

            ENABLE_CHECKR

        }

      );

    return ok(res, {

      driver_id:

        driver.id,

      ready,

      status:

        driver.status,

      approval_status:

        driver.approval_status,

      checks,

      // Curated, client-safe subset of the driver row for the driver
      // dashboard's profile card. Never spread the raw row here — it
      // also carries password/verification-code hashes and internal
      // Persona/Checkr payloads that must never reach the browser.
      driver: {

        id: driver.id,

        first_name: driver.first_name,

        last_name: driver.last_name,

        email: driver.email,

        phone: driver.phone,

        city: driver.city,

        state: driver.state,

        vehicle_make: driver.vehicle_make,

        vehicle_model: driver.vehicle_model,

        vehicle_year: driver.vehicle_year,

        license_plate: driver.license_plate,

        online: Boolean(driver.online || driver.is_online),

        mode: driver.mode || "driver",

        total_trips: driver.total_trips,

        rating: driver.rating,

        photo_url: driver.photo_url || null,

        supports_food_delivery: driver.supports_food_delivery,

        supports_grocery_delivery: driver.supports_grocery_delivery

      }

    });

  })

);/* =========================================================

   PART 6 — RIDE ESTIMATES, PAYMENT, DISPATCH

========================================================= */

// RIDE_STATUS, shouldDispatchRideNow, and the sweepScheduledRides
// orchestrator live in lib/rideDispatch.js — kept dependency-free (no
// Supabase/env vars) so Jest can test the scheduled-ride dispatch decision
// and retry/reclaim logic directly without booting the whole server.
const {
  RIDE_STATUS,
  shouldDispatchRideNow,
  sweepScheduledRides
} = require("./lib/rideDispatch");

// Offer-timeout enforcement — see lib/offerExpiry.js. driver_offers.expires_at
// was previously written on every offer and never read again, so a driver
// who neither accepted nor declined left the ride stuck indefinitely.
const { sweepExpiredOffers, sweepStuckRedispatches } = require("./lib/offerExpiry");

// Centralized ride-status transition table and the one atomic
// claim-a-transition primitive every status-changing route should use.
// See lib/rideLifecycle.js for the full transition graph.
const { isValidTransition, claimRideTransition } = require("./lib/rideLifecycle");

// Rider-cancellation policy and Stripe-void resumability decisions. Driver
// *withdrawal* is a separate, simpler operation (see POST /api/driver/
// rides/:rideId/withdraw below) and doesn't need this module.
const {
  CANCELLATION_PAYMENT_STATUS,
  isCancellable,
  hasAssignedDriver,
  cancelPaymentIdempotencyKey,
  decideCancelPaymentAction
} = require("./lib/rideCancellation");

// Recoverable payment-capture workflow for ride completion.
const {
  CAPTURE_STATUS,
  captureIdempotencyKey,
  decideCaptureAction
} = require("./lib/ridePaymentCapture");

// Busy-driver exclusion for the Node-side driver-matching fallback (the
// nearest_drivers() RPC gets the equivalent SQL exclusion directly, plus
// a real concurrency guarantee in dispatch_ride_atomic() -- see the
// dispatch-functions-hardening migration).
const { excludeBusyDrivers, getBusyDriverIds } = require("./lib/driverAvailability");

/* =========================================================

   ETA / DISTANCE-TO-PICKUP PERSISTENCE — SUPABASE ADAPTERS

   See docs/eta-persistence-plan.md. The estimate logic itself (Haversine
   fallback, routing-API circuit breaker, movement-threshold cache) lives in
   lib/etaEstimation.js so it's unit-testable without a database or network
   access; everything below is the Supabase/routing-provider glue, wired in
   at the two write points: offer creation (dispatchRide(), below) and
   driver location updates (POST /api/driver/location).

   Two independent flags, per your explicit instruction that persistence and
   paid routing accuracy must not share one switch:
     dispatch_eta_persistence_enabled — write ETA/distance at all (Haversine,
       no external dependency, no cost).
     dispatch_route_api_enabled — let a routing API supply the value
       instead of Haversine. Only meaningful once persistence is already on.
       The provider is Mapbox Directions with live traffic
       ("driving-traffic"; owner-approved 2026-10-19, within Mapbox's free
       monthly allowance at current volume), falling back to Google Routes
       only when Mapbox isn't configured and GOOGLE_ROUTES_API_KEY is set.
       Switched by POST /api/admin/system/enable-traffic-eta and
       disable-traffic-eta. Fares never use the traffic profile.
   Both default to "false" via getSystemFlag's fallback (no system_flags row
   exists for either yet — same convention as offer_expiry_sweep_enabled).
   This module does not enable either flag.

========================================================= */

const {
  computeAndPersistEta,
  pruneStaleCacheEntries
} = require("./lib/etaEstimation");

const GOOGLE_ROUTES_API_KEY = env("GOOGLE_ROUTES_API_KEY");
const ROUTE_API_TIMEOUT_MS = envNumber("ROUTE_API_TIMEOUT_MS", 4000);
const ROUTE_API_MONTHLY_QUOTA = envNumber("ROUTE_API_MONTHLY_QUOTA", 20000);
const ROUTE_API_MOVEMENT_THRESHOLD_MILES = envNumber("ROUTE_API_MOVEMENT_THRESHOLD_MILES", 0.03);

// In-memory only, per server instance — a soft cost optimization, not a
// correctness mechanism. Worst case with multiple instances (or a restart)
// is simply an extra routing-API call, still bounded by the usage-counter
// circuit breaker below. Pruned periodically by the interval near startup
// so a ride that never returns for a second estimate doesn't sit in memory
// forever; empty and unused while dispatch_route_api_enabled stays off.
const etaRouteCache = new Map();
const ETA_ROUTE_CACHE_MAX_AGE_MS = 60 * 60 * 1000;

async function callGoogleRoutesApi({ fromLat, fromLng, toLat, toLng }) {
  if (!GOOGLE_ROUTES_API_KEY) {
    // No key configured — never attempt the call even if the flag is on, so
    // flipping dispatch_route_api_enabled without also configuring a key
    // fails closed to Haversine instead of erroring on every request.
    throw new Error("GOOGLE_ROUTES_API_KEY is not configured");
  }

  const response = await fetch(
    "https://routes.googleapis.com/directions/v2:computeRoutes",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": GOOGLE_ROUTES_API_KEY,
        "X-Goog-FieldMask": "routes.duration,routes.distanceMeters"
      },
      body: JSON.stringify({
        origin: { location: { latLng: { latitude: fromLat, longitude: fromLng } } },
        destination: { location: { latLng: { latitude: toLat, longitude: toLng } } },
        travelMode: "DRIVE"
      })
    }
  );

  if (!response.ok) {
    throw new Error(`Google Routes API responded ${response.status}`);
  }

  const data = await response.json();
  const route = data?.routes?.[0];

  if (!route || !Number.isFinite(Number(route.distanceMeters)) || !route.duration) {
    throw new Error("Google Routes API returned no usable route");
  }

  const durationSeconds = parseFloat(String(route.duration).replace("s", ""));

  return {
    distanceMiles: Math.round((Number(route.distanceMeters) / 1609.34) * 100) / 100,
    etaMinutes: Math.max(1, Math.round(durationSeconds / 60))
  };
}

// Pickup ETA from Mapbox with traffic. Throws on any failure so
// resolveEtaEstimate() falls back to Haversine.
async function callMapboxTrafficRoute({ fromLat, fromLng, toLat, toLng }) {
  const outcome = await geoClient.route({ lat: fromLat, lng: fromLng }, { lat: toLat, lng: toLng }, { traffic: true });
  if (!outcome.ok) {
    throw new Error(`Mapbox traffic route failed (${outcome.error}${outcome.status ? `, HTTP ${outcome.status}` : ""})`);
  }
  return {
    distanceMiles: Math.round(Number(outcome.distance_miles) * 100) / 100,
    etaMinutes: Math.max(1, Math.round(Number(outcome.duration_minutes)))
  };
}

function callPickupRouteApi(points) {
  if (GEO_CONFIG.configured) return callMapboxTrafficRoute(points);
  return callGoogleRoutesApi(points);
}

async function incrementRouteApiUsageCounter() {
  // Monthly key gives free rollover — a new month is just a new row, no
  // separate reset job needed. Requires the increment_usage_counter() RPC
  // (see supabase/migrations/20260729004834_add_usage_counters.sql).
  const monthKey = `route_api_calls_${new Date().toISOString().slice(0, 7)}`;
  const { data, error } = await supabase.rpc("increment_usage_counter", {
    p_key: monthKey
  });

  if (error) {
    throw error;
  }

  return Number(Array.isArray(data) ? data[0] : data);
}

// Writes the ride's "eta to pickup" columns — only ever called for the
// pre-pickup phase of a ride (offer creation, and location pings while
// status is driver_assigned/driver_enroute/arrived). Once a ride reaches
// in_progress (already picked up), these "to pickup" columns are no longer
// meaningful; the existing transient (non-persisted) tracking estimate in
// GET /api/rides/:id/status already covers that dropoff-bound phase and is
// left untouched by this feature.
async function persistRideEtaToPickup(rideId, estimate) {
  const { error } = await supabase
    .from("rides")
    .update({
      driver_eta_to_pickup_minutes: estimate.etaMinutes,
      driver_distance_to_pickup_miles: estimate.distanceMiles
    })
    .eq("id", rideId);

  if (error) {
    throw error;
  }
}

// Shared by both dispatchRide() write paths (the dispatch_ride_atomic RPC
// and the two-step fallback, below) and by the driver-location-update
// route. Guaranteed not to throw — see computeAndPersistEta() — so a bug or
// outage here can never block ride creation, dispatch, or a GPS update.
async function persistPickupEtaBestEffort({
  rideId,
  driverLat,
  driverLng,
  pickupLat,
  pickupLng
}) {
  if (
    !rideId ||
    !Number.isFinite(Number(driverLat)) ||
    !Number.isFinite(Number(driverLng)) ||
    !Number.isFinite(Number(pickupLat)) ||
    !Number.isFinite(Number(pickupLng))
  ) {
    return null;
  }

  try {
    const [persistenceEnabled, routeApiEnabled] = await Promise.all([
      getSystemFlag("dispatch_eta_persistence_enabled", "false"),
      getSystemFlag("dispatch_route_api_enabled", "false")
    ]);

    return await computeAndPersistEta({
      persistenceEnabled: persistenceEnabled === "true",
      routeApiEnabled: routeApiEnabled === "true",
      fromLat: Number(driverLat),
      fromLng: Number(driverLng),
      toLat: Number(pickupLat),
      toLng: Number(pickupLng),
      speedMph: ASSUMED_DELIVERY_SPEED_MPH,
      getCachedRoute: () => etaRouteCache.get(rideId) || null,
      setCachedRoute: (entry) => etaRouteCache.set(rideId, entry),
      incrementUsageCounter: incrementRouteApiUsageCounter,
      quotaLimit: ROUTE_API_MONTHLY_QUOTA,
      callRouteApi: callPickupRouteApi,
      timeoutMs: ROUTE_API_TIMEOUT_MS,
      movementThresholdMiles: ROUTE_API_MOVEMENT_THRESHOLD_MILES,
      persistEta: (estimate) => persistRideEtaToPickup(rideId, estimate),
      logError: (...args) => console.error(...args)
    });
  } catch (err) {
    // computeAndPersistEta already catches its own internal failures; this
    // is an extra guard so a bug in the flag lookups above (outside that
    // function) still can't propagate into a dispatch or GPS-update route.
    console.error("⚠️ persistPickupEtaBestEffort unexpected failure:", err.message);
    return null;
  }
}

// Traffic-aware pickup ETA switch (dispatch_route_api_enabled). Admin
// only and audited. Enabling needs ETA persistence on and a routing
// provider configured, so it can't silently do nothing.
app.post(
  "/api/admin/system/enable-traffic-eta",
  requireAdmin,
  asyncRoute(async (req, res) => {
    if ((await getSystemFlag("dispatch_eta_persistence_enabled", "false")) !== "true") {
      return fail(res, "Turn on ETA persistence (dispatch_eta_persistence_enabled) first.", 409);
    }
    if (!GEO_CONFIG.configured && !GOOGLE_ROUTES_API_KEY) {
      return fail(res, "No routing provider is configured (MAPBOX_ACCESS_TOKEN).", 409);
    }
    const { error } = await supabase
      .from("system_flags")
      .upsert({ key: "dispatch_route_api_enabled", value: "true", reason: cleanString(req.body?.reason, 1000), updated_at: nowIso() });
    if (error) return fail(res, "The switch could not be saved. Nothing was changed.", 500);
    auditLog({ actor_type: "admin", actor_id: req.admin.email, action: "traffic_eta_enabled", metadata: { provider: GEO_CONFIG.configured ? "mapbox_driving_traffic" : "google_routes", monthly_call_cap: ROUTE_API_MONTHLY_QUOTA }, req }).catch(() => {});
    return ok(res, { traffic_eta_enabled: true, provider: GEO_CONFIG.configured ? "mapbox_driving_traffic" : "google_routes", monthly_call_cap: ROUTE_API_MONTHLY_QUOTA });
  })
);

app.post(
  "/api/admin/system/disable-traffic-eta",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const { error } = await supabase
      .from("system_flags")
      .upsert({ key: "dispatch_route_api_enabled", value: "false", reason: null, updated_at: nowIso() });
    if (error) return fail(res, "The switch could not be saved. Nothing was changed.", 500);
    auditLog({ actor_type: "admin", actor_id: req.admin.email, action: "traffic_eta_disabled", req }).catch(() => {});
    return ok(res, { traffic_eta_enabled: false });
  })
);

// This month's routing calls against the cap, and the switch state.
app.get(
  "/api/admin/system/traffic-eta",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const month = new Date().toISOString().slice(0, 7);
    const [enabled, persistence, counter] = await Promise.all([
      getSystemFlag("dispatch_route_api_enabled", "false"),
      getSystemFlag("dispatch_eta_persistence_enabled", "false"),
      supabase.from("usage_counters").select("count").eq("key", `route_api_calls_${month}`).maybeSingle()
    ]);
    return ok(res, {
      traffic_eta_enabled: enabled === "true",
      eta_persistence_enabled: persistence === "true",
      provider: GEO_CONFIG.configured ? "mapbox_driving_traffic" : GOOGLE_ROUTES_API_KEY ? "google_routes" : "none",
      month,
      calls_this_month: counter && counter.data ? Number(counter.data.count) || 0 : 0,
      monthly_call_cap: ROUTE_API_MONTHLY_QUOTA
    });
  })
);

// unref() so this background cache-pruning timer never by itself keeps
// the process alive -- the real server already stays alive via
// server.listen() in startServer(), and requiring this file as a module
// without starting the server (the reviewer-account composition tests
// in test/server.review-accounts.test.js) must be able to exit cleanly.
setInterval(() => {
  pruneStaleCacheEntries(etaRouteCache, { maxAgeMs: ETA_ROUTE_CACHE_MAX_AGE_MS });
}, 10 * 60 * 1000).unref();

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

  if (rider.access_revoked === true) {

    return {

      ready: false,

      reason: "This account has been deleted or its access has been revoked."

    };

  }

  // Staff suspension (admin routes) blocks booking whatever the other
  // checks say. The rider can still sign in and see their history.
  if (isRiderSuspended(rider)) {
    return {
      ready: false,
      reason: "This account is suspended. Please contact Harvey Taxi support.",
      rider,
      checks: { suspended: true }
    };
  }

  if (!ENABLE_RIDER_APPROVAL_GATE) {

    return {

      ready: true,

      rider

    };

  }

  // Option A (owner decision 2026-10-18): with Just-in-Time booking on,
  // a verified phone is enough; email is optional and can come later.
  const jitBooking = await isJitBookingEnabled();

  const checks = {

    email_verified:

      jitBooking || Boolean(rider.email_verified),

    // rider.phone_verified / rider.persona_verified never exist on a
    // real riders row (those columns are drivers-only) -- reading them
    // directly here made `ready` permanently false for every rider.
    // isRiderPhoneVerified()/isRiderPersonaVerified() read the columns
    // riders actually have (sms_verified, persona_status).
    phone_verified:

      isRiderPhoneVerified(rider),

    persona_verified:

      ENABLE_PERSONA

        ? isRiderPersonaVerified(rider)

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

/* Exposes getRiderReadiness() over HTTP. request-ride.html and the
   mobile app both call GET /api/riders/:id/readiness before allowing
   a ride request — this route previously did not exist, so every
   readiness check 404'd and blocked riders from booking.

   P0 remediation PR 2b: while rider_auth_enforced is off (the
   default), :id is trusted exactly as before -- this is the known,
   still-open P0-1 finding, not fixed by this flag being off. Once
   enabled, an authenticated rider's own session identity always wins
   over :id (see resolveEnforcedRiderId in lib/riderAuth.js); :id is
   then ignored, not compared against and rejected -- this route
   becomes "get MY OWN readiness," full stop. rider-signup.html calls
   this immediately post-signup with no session yet (see
   docs/security-remediation/pr-02a-rider-client-auth.md's "known
   gaps") -- that call will start failing once this flag is on, which
   is a signup-flow decision to make before enabling it, not a bug in
   this route. */
app.get(
  "/api/riders/:id/readiness",
  requireRiderIfEnforced,
  asyncRoute(async (req, res) => {
    const riderId = resolveEnforcedRiderId({
      authenticatedRiderId: req.rider?.id,
      clientSuppliedRiderId: cleanString(req.params.id, 100)
    });
    const readiness = await getRiderReadiness(riderId);

    if (!readiness.rider) {
      return fail(res, readiness.reason || "Rider not found.", 404);
    }

    return ok(res, {
      rider_id: readiness.rider.id,
      ready: readiness.ready,
      approved: readiness.ready,
      verified: readiness.ready,
      status: readiness.rider.status,
      approval_status: readiness.rider.approval_status,
      checks: readiness.checks || {},
      reason: readiness.reason || null
    });
  })
);

/* =========================================================

   DRIVER SEARCH

========================================================= */

/* =========================================================
   DRIVER HOURS LIMIT (docs/driver-hours.md, lib/driverHours.js)
   Up to 12 hours online per shift, then 6 hours of rest.
========================================================= */

// driverIds: limit to these drivers, or null for every driver with recent
// sessions. Returns Map(driverId -> shift). Drivers with no sessions in the
// window are absent (nothing worked).
async function loadDriverShifts(driverIds = null, nowMs = Date.now()) {
  const limits = driverHours.limitsFromEnv();
  const since = new Date(nowMs - driverHours.lookbackMs(limits)).toISOString();
  let query = supabase
    .from("driver_online_sessions")
    .select("driver_id, started_at, ended_at")
    .or(`ended_at.is.null,ended_at.gte.${since}`);
  if (driverIds) {
    const ids = [...new Set(driverIds.filter(Boolean).map(String))];
    if (!ids.length) return new Map();
    query = query.in("driver_id", ids);
  }
  const { data, error } = await query.limit(5000);
  if (error) throw error;
  const byDriver = new Map();
  for (const row of data || []) {
    const id = String(row.driver_id);
    if (!byDriver.has(id)) byDriver.set(id, []);
    byDriver.get(id).push(row);
  }
  const shifts = new Map();
  for (const [id, rows] of byDriver) {
    shifts.set(id, driverHours.computeShift(rows, { nowMs, ...limits }));
  }
  return shifts;
}

async function loadDriverShift(driverId, nowMs = Date.now()) {
  const shifts = await loadDriverShifts([driverId], nowMs);
  return shifts.get(String(driverId)) || driverHours.computeShift([], { nowMs, ...driverHours.limitsFromEnv() });
}

// Ids of drivers at or over the limit, for dispatch to skip. Callers pass
// only non-review drivers: store reviewers can't be made to wait 6 hours.
// Fails open, so dispatch doesn't stop because this lookup failed; going
// online and the sweep still enforce the limit.
async function driversOverHoursLimit(candidateIds) {
  try {
    const shifts = await loadDriverShifts(candidateIds);
    return new Set([...shifts].filter(([, shift]) => shift.limit_reached).map(([id]) => id));
  } catch (err) {
    console.warn("⚠️ Driver hours lookup failed during dispatch:", err && err.message);
    return new Set();
  }
}

// Takes drivers offline when they reach the limit. A driver on a trip
// finishes it first: they are taken offline on the first run after the
// trip ends. Review accounts are exempt. Returns the ids taken offline.
async function runDriverHoursSweep(nowMs = Date.now()) {
  const shifts = await loadDriverShifts(null, nowMs);
  const due = [...shifts].filter(([, shift]) => shift.online_now && shift.limit_reached).map(([id]) => id);
  if (!due.length) return [];

  const [{ data: drivers, error }, busyIds] = await Promise.all([
    supabase.from("drivers").select("id, online, is_review_account").in("id", due),
    getBusyDriverIds({ supabase })
  ]);
  if (error) throw error;
  const busy = new Set((busyIds || []).map(String));

  const takenOffline = [];
  for (const driver of drivers || []) {
    const id = String(driver.id);
    if (driver.is_review_account === true || driver.online !== true || busy.has(id)) continue;
    const { data: updated, error: updateError } = await supabase
      .from("drivers")
      .update({ online: false, updated_at: nowIso() })
      .eq("id", driver.id)
      .eq("online", true)
      .select("id");
    if (updateError) {
      console.error("❌ Driver hours sweep could not take driver offline:", id, updateError.message);
      continue;
    }
    if (!updated || !updated.length) continue;
    takenOffline.push(id);
    const shift = shifts.get(id);
    auditLog({
      actor_type: "system",
      action: "driver_hours_limit_offline",
      entity_type: "driver",
      entity_id: id,
      metadata: { worked_minutes: Math.floor(shift.worked_ms / 60000) }
    }).catch(() => {});
    sendPushNotification({
      ownerType: "driver",
      ownerId: id,
      title: "You've reached your hours limit",
      body: driverHours.restMessage(shift) + " You've been taken offline.",
      url: "/driver.html"
    }).catch(() => {});
  }
  return takenOffline;
}

// Food and grocery deliveries go only to drivers set up for that kind of
// delivery (drivers.supports_food_delivery / supports_grocery_delivery),
// for automatic dispatch and admin assignment alike. A driver whose flag
// is unset (null) stays eligible, as before. Passenger rides are unchanged.
const DELIVERY_CAPABILITY_COLUMN = { food: "supports_food_delivery", grocery: "supports_grocery_delivery" };

function deliveryCapabilityColumn(rideType) {
  return DELIVERY_CAPABILITY_COLUMN[String(rideType || "").toLowerCase()] || null;
}

function driverEligibleForService(driver, rideType) {
  const column = deliveryCapabilityColumn(rideType);
  return !column || !driver || driver[column] !== false;
}

// Verification at offer time. Going online checks verification once
// (POST /api/driver/status), but a driver can stay online after a check
// changes (a Checkr result that isn't clear, a Persona re-review, a phone
// or email that is unverified again). Offers, acceptance and admin
// assignment therefore re-read the driver's verification fields and use
// the same rule as going online (computeDriverReadiness). The online flag
// and any trip already under way are left alone.
const DRIVER_READINESS_COLUMNS =
  "id, email_verified, phone_verified, persona_verified, persona_status, checkr_status, approval_status, vehicle_make, vehicle_model, vehicle_year";

function driverVerificationReady(driver) {
  return computeDriverReadiness(driver, { enablePersona: ENABLE_PERSONA, enableCheckr: ENABLE_CHECKR }).ready;
}

// Ids, from those given, of drivers whose verification is complete right
// now. Throws when the fields can't be read; callers treat that as "none".
async function verificationReadyDriverIds(driverIds) {
  const ids = [...new Set((driverIds || []).filter(Boolean).map(String))];
  if (!ids.length) return new Set();
  const { data, error } = await supabase.from("drivers").select(DRIVER_READINESS_COLUMNS).in("id", ids);
  if (error || !Array.isArray(data)) throw error || new Error("Driver verification unavailable.");
  return new Set(data.filter(driverVerificationReady).map((d) => String(d.id)));
}

// Deliveries: how many nearest drivers (within the search radius) to read
// before the eligibility check, so ineligible drivers nearby can't crowd
// out an eligible driver farther away.
const DELIVERY_CANDIDATE_POOL = envNumber("DELIVERY_CANDIDATE_POOL", 200);

// Ids of the given drivers not set up for this delivery type. Throws when
// the flags can't be read.
async function deliveryIneligibleDriverIds(driverIds, rideType) {
  const column = deliveryCapabilityColumn(rideType);
  if (!column || !driverIds.length) return new Set();
  const { data, error } = await supabase.from("drivers").select(`id, ${column}`).in("id", driverIds);
  if (error || !Array.isArray(data)) throw error || new Error("Driver delivery settings unavailable.");
  return new Set(data.filter((d) => d[column] === false).map((d) => String(d.id)));
}

async function findAvailableDrivers({

  pickup_lat,

  pickup_lng,

  radius_miles = envNumber("DRIVER_SEARCH_RADIUS_MILES", 25),

  limit = envNumber("MAX_DISPATCH_ATTEMPTS", 5),

  exclude_driver_ids = [],

  ride_type = null

}) {

  const deliveryColumn = deliveryCapabilityColumn(ride_type);

  const excludeSet =

    new Set(

      (exclude_driver_ids || [])

        .filter(Boolean)

        .map(String)

    );

  // Preferred path: PostGIS RPC does the distance filter in the

  // database and returns only the nearest drivers. Requires the

  // nearest_drivers() function from the scalability migration.

  // If the RPC is absent or errors, we fall back to the original

  // in-Node calculation so dispatch never breaks.

  if (

    Number.isFinite(Number(pickup_lat)) &&

    Number.isFinite(Number(pickup_lng))

  ) {

    try {

      const { data: rpcData, error: rpcError } =

        await supabase.rpc("nearest_drivers", {

          p_lat: Number(pickup_lat),

          p_lng: Number(pickup_lng),

          p_radius_miles: Number(radius_miles),

          p_limit: deliveryColumn
            ? Math.max(DELIVERY_CANDIDATE_POOL, Number(limit) + excludeSet.size + 5)
            : Number(limit) + excludeSet.size + 5

        });

      if (!rpcError && Array.isArray(rpcData)) {
        const overLimit = await driversOverHoursLimit(rpcData.filter((d) => d.is_review_account !== true).map((d) => d.id));

        // Delivery eligibility comes before the nearest-N cut below. If
        // the flags can't be read this throws, and the Node fallback below
        // (which reads them with the drivers) is used instead.
        const notEligible = await deliveryIneligibleDriverIds(rpcData.map((d) => d.id), ride_type);

        return rpcData

          .filter(

            (d) => !excludeSet.has(String(d.id)) && !overLimit.has(String(d.id)) && !notEligible.has(String(d.id))

          )

          .map((d) => ({

            ...d,

            distance_miles:

              d.distance_miles ??

              (d.distance_meters

                ? Number(

                    (d.distance_meters / 1609.34).toFixed(2)

                  )

                : null)

          }))

          .slice(0, limit);

      }

    } catch (rpcErr) {

      console.warn(

        "⚠️ nearest_drivers RPC unavailable, using Node fallback:",

        rpcErr.message

      );

    }

  }

  // Fallback: original in-Node distance computation. Also excludes any
  // driver already assigned to another active ride (driver_assigned/
  // driver_enroute/arrived/in_progress) -- matching-time only, same as
  // nearest_drivers()'s own exclusion; this fallback path has no
  // equivalent to dispatch_ride_atomic()'s in-transaction re-check, so it
  // cannot offer the same concurrency guarantee, only the same filter.

  let fallbackQuery = supabase
    .from("drivers")
    .select("*")
    .eq("online", true)
    .eq("status", "active")
    .eq("approval_status", "approved");
  // Deliveries: ineligible drivers are left out before the row limit.
  if (deliveryColumn) {
    fallbackQuery = fallbackQuery.or(`${deliveryColumn}.is.null,${deliveryColumn}.eq.true`);
  }
  const [{ data, error }, busyDriverIds] = await Promise.all([
    fallbackQuery.limit(50),
    getBusyDriverIds({ supabase }).catch((busyErr) => {
      console.warn(
        "⚠️ Could not load busy-driver ids for dispatch fallback filter:",
        busyErr.message
      );
      return [];
    })
  ]);

  if (error) {

    throw error;

  }

  const overLimit = await driversOverHoursLimit((data || []).filter((d) => d.is_review_account !== true).map((d) => d.id));

  return excludeBusyDrivers(data || [], busyDriverIds)

    .filter((driver) => !excludeSet.has(String(driver.id)) && !overLimit.has(String(driver.id)) && driverEligibleForService(driver, ride_type))

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


// How long a driver has to accept a ride offer. 45 s (was 30 s): a
// 30-second offer expired unseen during a two-device test (review ride
// RIDE-06D4C93EF9, 2026-10-03). Render's
// DISPATCH_TIMEOUT_SECONDS still overrides it. The driver app's countdown
// reads seconds_left from the server, so it follows automatically.
const DISPATCH_TIMEOUT_SECONDS = envNumber("DISPATCH_TIMEOUT_SECONDS", 45);

async function createDriverOffer({

  ride_id,

  driver_id,

  attempt = 1,

  expires_in_seconds = DISPATCH_TIMEOUT_SECONDS

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

// dispatch_ride_atomic() outcomes that describe the ride, not the
// candidate driver (see the dispatch-functions-hardening migration).
const RIDE_LEVEL_DISPATCH_OUTCOMES = new Set([
  "ride_not_found",
  "ride_not_dispatchable",
  "ride_has_live_offer"
]);

/* =========================================================

   APP REVIEW STANDALONE DEMOS (lib/reviewDemo.js, docs/app-review-demo.md)

   Off unless the system flag review_demo_autopilot_enabled is "true".
   Review rides and the review driver only; never Stripe, never a real
   driver or rider.

========================================================= */

async function reviewDemoEnabled() {
  return (await getSystemFlag(reviewDemo.FLAG, "false")) === "true";
}

// A review ride no review driver can take. Returns a dispatch-shaped
// outcome when the demo handled it (the caller must not fail the ride),
// or null to keep the normal "no drivers" handling (switch off, or not a
// review ride).
async function handleReviewRideWithoutDriver(rideId) {
  if (!(await reviewDemoEnabled())) return null;
  const { data: ride } = await supabase
    .from("rides")
    .select("id, status, is_review_ride, review_demo, rider_id")
    .eq("id", rideId)
    .maybeSingle();
  if (!ride || ride.is_review_ride !== true) return null;

  // The driver demo's own ride: nobody took it, so it is withdrawn.
  if (ride.review_demo === "auto_offer") {
    await withdrawReviewAutoOffer(ride.id, "review_demo_offer_expired");
    return { dispatched: false, review_demo: "auto_offer_withdrawn", reason: "Simulated offer expired." };
  }

  // A reviewer's ride: the simulated driver takes it.
  const claim = await claimRideTransition({
    supabase,
    rideId: ride.id,
    fromStatuses: [RIDE_STATUS.PAYMENT_AUTHORIZED, RIDE_STATUS.AWAITING_DRIVER],
    toStatus: RIDE_STATUS.DRIVER_ASSIGNED,
    patch: reviewDemo.autopilotStartPatch({ now: Date.now() })
  }).catch(() => ({ ok: false }));
  if (claim.ok) {
    broadcastRideSse(ride.id, "stage", { status: RIDE_STATUS.DRIVER_ASSIGNED, delivery_stage: null });
    auditLog({ actor_type: "system", actor_id: "review-demo", action: "review_demo_autopilot_started", entity_type: "ride", entity_id: ride.id }).catch(() => {});
    return { dispatched: true, review_demo: "autopilot", simulated: true };
  }
  // Already taken over, cancelled or otherwise moved on: leave it as is.
  return { dispatched: false, review_demo: "unchanged", reason: "Ride is no longer waiting for a driver." };
}

// Cancels the driver demo's simulated ride (only while nobody has accepted
// it) and closes its pending offer.
async function withdrawReviewAutoOffer(rideId, reason) {
  const claim = await claimRideTransition({
    supabase,
    rideId,
    fromStatuses: [RIDE_STATUS.PAYMENT_AUTHORIZED, RIDE_STATUS.AWAITING_DRIVER],
    toStatus: RIDE_STATUS.CANCELLED,
    patch: { cancelled_at: nowIso(), dispatch_status: reason, review_demo_next_at: null, updated_at: nowIso() }
  }).catch(() => ({ ok: false }));
  await supabase
    .from("driver_offers")
    .update({ status: "expired", updated_at: nowIso() })
    .eq("ride_id", rideId)
    .eq("status", "pending");
  return claim.ok;
}

// When the rider reviewer books, a simulated offer still waiting for the
// review driver is withdrawn so the rider's own request reaches them
// (the connected two-app test).
async function withdrawPendingReviewAutoOffers(reason) {
  const { data } = await supabase
    .from("rides")
    .select("id")
    .eq("review_demo", "auto_offer")
    .in("status", [RIDE_STATUS.PAYMENT_AUTHORIZED, RIDE_STATUS.AWAITING_DRIVER]);
  for (const r of data || []) {
    await withdrawReviewAutoOffer(r.id, reason);
  }
}

let reviewDemoTickRunning = false;

// Every few seconds while the switch is on: advance the simulated driver,
// hand expired reviewer offers to it, cancel abandoned demo rides, and
// offer the idle review driver a simulated ride.
async function runReviewDemoTick({ now = Date.now() } = {}) {
  if (reviewDemoTickRunning) return null;
  reviewDemoTickRunning = true;
  try {
    if (!(await reviewDemoEnabled())) return null;
    const nowText = new Date(now).toISOString();
    const summary = { advanced: 0, taken_over: 0, stale_cancelled: 0, offered: null };

    // 1) Simulated driver stages that are due. Each is an atomic claim
    // from the stage it was in, so a cancellation in between stops it.
    const { data: due } = await supabase
      .from("rides")
      .select("id, status, review_demo, review_demo_next_at, estimated_fare")
      .eq("review_demo", "autopilot")
      .in("status", Object.keys(reviewDemo.NEXT_STAGE))
      .lte("review_demo_next_at", nowText);
    for (const ride of due || []) {
      const step = reviewDemo.dueStage(ride, now);
      if (!step) continue;
      const claim = await claimRideTransition({ supabase, rideId: ride.id, fromStatuses: [step.from], toStatus: step.to, patch: step.patch }).catch(() => ({ ok: false }));
      if (claim.ok) {
        summary.advanced += 1;
        broadcastRideSse(ride.id, "stage", { status: step.to, delivery_stage: null });
      }
    }

    // 2) Reviewer rides whose offer to the review driver expired without
    // an answer (whether or not the general expiry sweep is on).
    const { data: waiting } = await supabase
      .from("rides")
      .select("id")
      .eq("is_review_ride", true)
      .eq("status", RIDE_STATUS.AWAITING_DRIVER);
    for (const ride of waiting || []) {
      const { data: offers } = await supabase.from("driver_offers").select("status, expires_at").eq("ride_id", ride.id);
      const live = (offers || []).some((o) => o.status === "pending" && Date.parse(o.expires_at) > now);
      if ((offers || []).length && !live) {
        await supabase.from("driver_offers").update({ status: "expired", updated_at: nowText }).eq("ride_id", ride.id).eq("status", "pending");
        const outcome = await handleReviewRideWithoutDriver(ride.id);
        if (outcome && outcome.review_demo === "autopilot") summary.taken_over += 1;
      }
    }

    // 3) Abandoned demo rides (review rides only).
    const { data: openReview } = await supabase
      .from("rides")
      .select("id, status, updated_at, review_demo")
      .eq("is_review_ride", true)
      .in("status", reviewDemo.OPEN_STATUSES);
    let stillOpen = 0;
    for (const ride of openReview || []) {
      if (ride.review_demo && reviewDemo.isStale(ride, now)) {
        const claim = await claimRideTransition({
          supabase,
          rideId: ride.id,
          fromStatuses: [ride.status],
          toStatus: RIDE_STATUS.CANCELLED,
          patch: { cancelled_at: nowText, dispatch_status: "review_demo_abandoned", review_demo_next_at: null, updated_at: nowText }
        }).catch(() => ({ ok: false }));
        if (claim.ok) {
          summary.stale_cancelled += 1;
          continue;
        }
      }
      stillOpen += 1;
    }

    // 4) The idle review driver's simulated offer.
    summary.offered = await maybeOfferReviewDemoRide({ now, openReviewRides: stillOpen });
    return summary;
  } finally {
    reviewDemoTickRunning = false;
  }
}

// The latest of: going online, the driver's last offer (or its expiry),
// their last ride update, and the last simulated offer's update. Null when
// the driver has no open online session.
async function reviewDriverIdleSince(driverId, now) {
  const { data: sessions } = await supabase
    .from("driver_online_sessions")
    .select("started_at, ended_at")
    .eq("driver_id", driverId)
    .is("ended_at", null);
  if (!(sessions || []).length) return null;
  const times = sessions.map((r) => Date.parse(r.started_at));
  const { data: offers } = await supabase
    .from("driver_offers")
    .select("created_at, expires_at")
    .eq("driver_id", driverId)
    .order("created_at", { ascending: false })
    .limit(1);
  (offers || []).forEach((o) => {
    times.push(Date.parse(o.created_at));
    times.push(Math.min(Date.parse(o.expires_at), now));
  });
  const { data: rides } = await supabase
    .from("rides")
    .select("updated_at")
    .eq("driver_id", driverId)
    .order("updated_at", { ascending: false })
    .limit(1);
  (rides || []).forEach((r) => times.push(Date.parse(r.updated_at)));
  const { data: demos } = await supabase
    .from("rides")
    .select("updated_at")
    .eq("review_demo", "auto_offer")
    .order("updated_at", { ascending: false })
    .limit(1);
  (demos || []).forEach((r) => times.push(Date.parse(r.updated_at)));
  const valid = times.filter(Number.isFinite);
  return valid.length ? Math.max(...valid) : null;
}

async function maybeOfferReviewDemoRide({ now, openReviewRides }) {
  const { data: driver } = await supabase
    .from("drivers")
    .select("id, online, is_review_account")
    .eq("is_review_account", true)
    .maybeSingle();
  if (!driver) return { ok: false, reason: "no_review_driver" };
  const { data: active } = await supabase
    .from("rides")
    .select("id")
    .eq("driver_id", driver.id)
    .in("status", [RIDE_STATUS.DRIVER_ASSIGNED, RIDE_STATUS.DRIVER_ENROUTE, RIDE_STATUS.ARRIVED, RIDE_STATUS.IN_PROGRESS])
    .limit(1);
  const { data: pending } = await supabase
    .from("driver_offers")
    .select("id, expires_at")
    .eq("driver_id", driver.id)
    .eq("status", "pending");
  const livePending = (pending || []).some((o) => Date.parse(o.expires_at) > now);
  const idleSinceMs = driver.online === true ? await reviewDriverIdleSince(driver.id, now) : null;
  const decision = reviewDemo.shouldAutoOffer({
    enabled: true,
    driver,
    activeRide: (active || [])[0] || null,
    pendingOffer: livePending,
    openReviewRide: openReviewRides > 0,
    idleSinceMs,
    now
  });
  if (!decision.ok) return decision;

  const estimate = calculateRideEstimate({ miles: reviewDemo.DEMO_TRIP.miles, minutes: reviewDemo.DEMO_TRIP.minutes, ride_type: "standard" });
  const row = reviewDemo.demoRideForDriver({ id: makeId("RIDE"), estimate, now });
  const { data: created, error } = await supabase.from("rides").insert(row).select().maybeSingle();
  // Another instance or tick created one first (unique index): nothing to do.
  if (error || !created) return { ok: false, reason: "already_offered" };

  // A rider reviewer booked at the same moment: their ride wins.
  const { data: others } = await supabase
    .from("rides")
    .select("id")
    .eq("is_review_ride", true)
    .in("status", reviewDemo.OPEN_STATUSES)
    .neq("id", created.id);
  if ((others || []).length) {
    await withdrawReviewAutoOffer(created.id, "review_demo_rider_request_first");
    return { ok: false, reason: "review_ride_open" };
  }

  auditLog({ actor_type: "system", actor_id: "review-demo", action: "review_demo_offer_created", entity_type: "ride", entity_id: created.id }).catch(() => {});
  const outcome = await dispatchRide(created);
  return { ok: Boolean(outcome && outcome.dispatched), ride_id: created.id };
}

async function dispatchRide(ride) {

  // Respect the admin dispatch pause. When dispatch is paused,

  // do NOT create offers or assign drivers — mark the ride as

  // waiting so it can be dispatched once dispatch resumes.

  const dispatchPaused =

    await getSystemFlag("dispatch_paused", "false");

  if (dispatchPaused === "true") {

    await supabase

      .from("rides")

      .update({

        dispatch_status:

          "paused",

        updated_at:

          nowIso()

      })

      .eq("id", ride.id);

    return {

      dispatched: false,

      paused: true,

      reason: "Dispatch is currently paused by an administrator."

    };

  }

  // Exclude drivers who already received an offer for this ride

  // (declined, expired, or still pending) so we never re-offer

  // the same ride to a driver who already saw it.

  let excludeDriverIds = [];

  try {

    const { data: priorOffers } =

      await supabase

        .from("driver_offers")

        .select("driver_id")

        .eq("ride_id", ride.id);

    excludeDriverIds =

      (priorOffers || [])

        .map((o) => o.driver_id)

        .filter(Boolean);

  } catch (offerLookupErr) {

    console.warn(

      "⚠️ Could not load prior offers for redispatch exclusion:",

      offerLookupErr.message

    );

  }

  // Google Play reviewer-account dispatch isolation (two-way, approved
  // requirement): a review rider's ride may reach only the one paired
  // review driver, and that review driver must never be a candidate for
  // any real rider's ride. ride.is_review_ride is set once, at
  // ride-creation time, from the rider row's is_review_account column
  // (see POST /api/rides/request) -- never re-derived from anything
  // client-supplied here. The review driver lookup is a single
  // partial-indexed row read (at most one such driver ever exists) and
  // costs nothing on the far more common non-review path.
  const { data: reviewDriverRow } = await supabase
    .from("drivers")
    .select("id, online, current_lat, current_lng, is_review_account")
    .eq("is_review_account", true)
    .maybeSingle();

  const dispatchPlan = planReviewAwareDispatch({
    isReviewRide: Boolean(ride.is_review_ride),
    reviewDriverId: reviewDriverRow?.id || null,
    reviewDriverOnline: Boolean(reviewDriverRow?.online)
  });

  let drivers;

  if (dispatchPlan.bypassNormalMatching) {
    drivers =
      dispatchPlan.candidateDriverIds.length && reviewDriverRow
        ? [reviewDriverRow]
        : [];
  } else {
    drivers =

      await findAvailableDrivers({

        pickup_lat:

          ride.pickup_lat,

        pickup_lng:

          ride.pickup_lng,

        exclude_driver_ids:

          excludeDriverIds.concat(dispatchPlan.extraExcludeDriverIds),

        ride_type:

          ride.ride_type

      });
  }

  // Offers go only to drivers whose verification is complete now, not
  // merely when they went online. Fails closed: if verification can't be
  // read, no driver is offered the ride.
  if (drivers.length) {
    let ready;
    try {
      ready = await verificationReadyDriverIds(drivers.map((d) => d.id));
    } catch (verifyErr) {
      console.error("❌ Dispatch: driver verification check failed:", ride.id, verifyErr && verifyErr.message);
      ready = new Set();
    }
    const skipped = drivers.length - drivers.filter((d) => ready.has(String(d.id))).length;
    if (skipped) {
      console.warn(`⚠️ Dispatch skipped ${skipped} driver(s) without complete verification for ride ${ride.id}`);
    }
    drivers = drivers.filter((d) => ready.has(String(d.id)));
  }

  if (!drivers.length) {

    // App Review demo (off unless review_demo_autopilot_enabled): a review
    // ride no review driver can take goes to the simulated driver (or, for
    // the driver demo's own ride, is withdrawn) instead of failing.
    const reviewDemoOutcome = await handleReviewRideWithoutDriver(ride.id);
    if (reviewDemoOutcome) return reviewDemoOutcome;

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

    releaseFailedRidePayment(ride.id).catch(() => {});
    notifyRideStage(ride, "no_drivers_available").catch(() => {});

    return {

      dispatched: false,

      reason: "No available drivers."

    };

  }

  // Preferred path: dispatch_ride_atomic() creates the offer AND updates
  // the ride, holding a driver-scoped advisory lock plus an in-transaction
  // eligibility re-check (see the dispatch-functions-hardening migration)
  // -- the actual concurrency guarantee, not merely the fact that
  // `drivers` was already filtered to exclude busy drivers above.
  //
  // Tried once per candidate, in order: a `driver_no_longer_available`
  // outcome is a normal, expected result of that re-check catching a
  // driver who became ineligible between the matching query above and
  // this call (e.g. a concurrent dispatch just assigned them elsewhere)
  // -- the correct response is to try the NEXT candidate, never to fall
  // back to the old two-step flow for that same driver, since the
  // fallback has no equivalent re-check and would simply re-offer to the
  // driver this call just correctly rejected.
  //
  // The two-step fallback below is reached only if the RPC itself is
  // genuinely unavailable or errors outright (transport failure, RPC
  // missing) -- a caller-level problem distinct from an ordinary
  // per-candidate decline.
  let rpcUnavailable = false;

  for (const candidate of drivers) {

    try {

      const { data: rpcResult, error: rpcError } =

        await supabase.rpc("dispatch_ride_atomic", {

          p_ride_id: ride.id,

          p_driver_id: candidate.id,

          p_expires_seconds:

            DISPATCH_TIMEOUT_SECONDS

        });

      if (rpcError) {

        console.warn(

          "⚠️ dispatch_ride_atomic RPC unavailable, using two-step fallback:",

          rpcError.message

        );

        rpcUnavailable = true;

        break;

      }

      const result =

        Array.isArray(rpcResult)

          ? rpcResult[0]

          : rpcResult;

      if (result && result.outcome === "created" && result.offer_id) {

        sendPushNotification({
          ownerType: "driver",
          ownerId: candidate.id,
          title: offerPushTitle(ride),
          body: `Pickup: ${ride.pickup_address || "See app for details"}`,
          url: "/driver.html"
        }).catch(() => {});

        // Fire-and-forget: never delays the dispatch response, and
        // computeAndPersistEta() already guarantees it can't throw.
        persistPickupEtaBestEffort({
          rideId: ride.id,
          driverLat: candidate.current_lat,
          driverLng: candidate.current_lng,
          pickupLat: ride.pickup_lat,
          pickupLng: ride.pickup_lng
        }).catch(() => {});

        return {

          dispatched: true,

          offer: {

            id: result.offer_id,

            ride_id: ride.id,

            driver_id: candidate.id

          },

          driver: candidate,

          atomic: true

        };

      }

      // Ride-level outcomes: the ride itself can't take an offer right now
      // (missing, already assigned/finished, or it already has a live
      // offer). Trying another candidate can't change that, and the
      // two-step fallback must not run either -- it would create a second
      // live offer. Stop here without touching the ride.
      if (result && RIDE_LEVEL_DISPATCH_OUTCOMES.has(result.outcome)) {
        console.warn(
          `⚠️ dispatch_ride_atomic did not dispatch ride ${ride.id}: ${result.outcome}`
        );

        return {
          dispatched: false,
          reason: result.outcome
        };
      }

      console.warn(

        `⚠️ dispatch_ride_atomic declined driver ${candidate.id} for ride ${ride.id}: ` +

        (result && result.outcome ? result.outcome : "no result")

      );

    } catch (rpcErr) {

      console.warn(

        "⚠️ dispatch_ride_atomic threw, using two-step fallback:",

        rpcErr.message

      );

      rpcUnavailable = true;

      break;

    }

  }

  if (!rpcUnavailable) {

    // The RPC itself is working -- every candidate was tried through it
    // and none succeeded. Equivalent to no drivers being available.
    const reviewDemoOutcome = await handleReviewRideWithoutDriver(ride.id);
    if (reviewDemoOutcome) return reviewDemoOutcome;
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

    releaseFailedRidePayment(ride.id).catch(() => {});
    notifyRideStage(ride, "no_drivers_available").catch(() => {});

    return {

      dispatched: false,

      reason: "No available drivers."

    };

  }

  // Fallback: non-atomic two-step flow, reached only because the RPC
  // itself was unavailable/erroring, not because a specific driver was
  // declined. Uses only the first candidate, matching this fallback's
  // pre-existing (pre-loop) behavior -- it has no eligibility re-check of
  // its own to justify trying more than one.
  const firstDriver =

    drivers[0];

  // The offered driver lives only on the driver_offers row. rides.driver_id
  // is the *assigned* driver and is written only when an offer is accepted
  // (or an admin assigns) -- writing it here would let a driver who hasn't
  // accepted pass ensureAssignedDriver() and expose their live location on
  // the rider's tracking view. There is no current_driver_id or
  // current_offer_id column on rides.
  //
  // dispatch_attempts is carried forward from the caller (the decline and
  // expiry redispatch paths have already incremented it), the same rule
  // dispatch_ride_atomic() applies, rather than reset to 1.
  const attempt = Math.max(1, Number(ride.dispatch_attempts) || 1);

  const offer =

    await createDriverOffer({

      ride_id:

        ride.id,

      driver_id:

        firstDriver.id,

      attempt

    });

  const { data: offeredRide, error: offerRideUpdateError } = await supabase

    .from("rides")

    .update({

      status:

        RIDE_STATUS.AWAITING_DRIVER,

      dispatch_status:

        "offer_sent",

      dispatch_attempts:

        attempt,

      updated_at:

        nowIso()

    })

    .eq("id", ride.id)

    .select("id")

    .maybeSingle();

  if (offerRideUpdateError || !offeredRide) {

    const reason = offerRideUpdateError
      ? offerRideUpdateError.message
      : "ride not found";

    // Don't leave a live offer pointing at a ride that was never moved to
    // awaiting_driver_acceptance: cancel it (only if still pending) before
    // reporting the dispatch as failed. The driver is never notified.
    const { error: cancelOfferError } = await supabase
      .from("driver_offers")
      .update({
        status: "cancelled",
        responded_at: nowIso(),
        updated_at: nowIso()
      })
      .eq("id", offer.id)
      .eq("status", "pending");

    if (cancelOfferError) {
      console.error(
        "🚨 Dispatch fallback: could not cancel orphaned offer:",
        { ride_id: ride.id, offer_id: offer.id, reason: cancelOfferError.message }
      );
    }

    const dispatchError = new Error(
      `Dispatch fallback could not record the offer on ride ${ride.id}: ${reason}`
    );

    dispatchError.rideId = ride.id;
    dispatchError.offerId = offer.id;

    throw dispatchError;

  }

  sendPushNotification({
    ownerType: "driver",
    ownerId: firstDriver.id,
    title: offerPushTitle(ride),
    body: `Pickup: ${ride.pickup_address || "See app for details"}`,
    url: "/driver.html"
  }).catch(() => {});

  persistPickupEtaBestEffort({
    rideId: ride.id,
    driverLat: firstDriver.current_lat,
    driverLng: firstDriver.current_lng,
    pickupLat: ride.pickup_lat,
    pickupLng: ride.pickup_lng
  }).catch(() => {});

  return {

    dispatched: true,

    offer,

    driver: firstDriver

  };

}

/* =========================================================

   SCHEDULED-RIDE SWEEP — SUPABASE ADAPTERS

   The actual retry/skip/reclaim orchestration lives in
   sweepScheduledRides() (lib/rideDispatch.js), so it's unit-testable
   without a database. These three functions are the only pieces that
   talk to Supabase, wired into that orchestrator via the
   setInterval() call near startup below.

   The OR filter in both findDueScheduledRides and claimScheduledRide
   ("dispatch_status = ready_to_dispatch, OR dispatch_status =
   dispatching with a claim older than the lease cutoff") is what lets
   a stale claim get reclaimed if a process dies between claiming a
   ride and finishing dispatchRide() — a plain try/catch can't cover
   that case since nothing runs to reset the ride when the process
   itself is gone.

========================================================= */

function scheduledDispatchClaimFilter(cutoffIso) {
  return (
    `dispatch_status.eq.ready_to_dispatch,` +
    `and(dispatch_status.eq.dispatching,dispatch_claimed_at.lt.${cutoffIso})`
  );
}

async function findDueScheduledRides(nowDate, cutoffDate) {
  const { data, error } = await supabase
    .from("rides")
    .select("*")
    .eq("status", RIDE_STATUS.PAYMENT_AUTHORIZED)
    .not("scheduled_time", "is", null)
    .lte("scheduled_time", nowDate.toISOString())
    .or(scheduledDispatchClaimFilter(cutoffDate.toISOString()));

  if (error) throw error;

  return data || [];
}

async function claimScheduledRide(rideId, cutoffDate) {
  const { data, error } = await supabase
    .from("rides")
    .update({
      dispatch_status: "dispatching",
      dispatch_claimed_at: nowIso(),
      updated_at: nowIso()
    })
    .eq("id", rideId)
    // Re-verify ride status here, not just dispatch_status — if the ride's
    // status changed after the findDueScheduledRides query above (e.g. a
    // future cancellation feature), this claim now correctly fails instead
    // of dispatching a ride that's no longer payment-authorized.
    .eq("status", RIDE_STATUS.PAYMENT_AUTHORIZED)
    .or(scheduledDispatchClaimFilter(cutoffDate.toISOString()))
    .select()
    .maybeSingle();

  if (error) throw error;

  return data || null;
}

async function resetScheduledRideForRetry(rideId) {
  const { error } = await supabase
    .from("rides")
    .update({
      dispatch_status: "ready_to_dispatch",
      dispatch_claimed_at: null,
      updated_at: nowIso()
    })
    .eq("id", rideId);

  if (error) throw error;
}

/* =========================================================

   OFFER-EXPIRY SWEEP — SUPABASE ADAPTERS

   The claim/redispatch/max-attempts orchestration lives in
   sweepExpiredOffers() (lib/offerExpiry.js), so it's unit-testable
   without a database. These are the only pieces that talk to Supabase,
   wired into that orchestrator via the setInterval() call near startup
   below, gated by the offer_expiry_sweep_enabled system flag so this
   can be rolled back instantly without a deploy if it misbehaves.

   claimExpiredOffer's conditional .eq("status", "pending") is the whole
   concurrency-safety mechanism: two server instances (or two sweep
   ticks) racing on the same expired offer, or a sweep racing against a
   driver tapping accept/decline at nearly the same moment, can only
   ever have one caller see a non-null result back. Everyone else sees
   null and skips — see lib/offerExpiry.js's header comment for the
   full reasoning.

========================================================= */

async function findExpiredPendingOffers(nowDate) {
  const { data, error } = await supabase
    .from("driver_offers")
    .select("*")
    .eq("status", "pending")
    .lt("expires_at", nowDate.toISOString());

  if (error) throw error;

  return data || [];
}

async function claimExpiredOffer(offerId) {
  const { data, error } = await supabase
    .from("driver_offers")
    .update({
      status: "expired",
      responded_at: nowIso(),
      updated_at: nowIso()
    })
    .eq("id", offerId)
    .eq("status", "pending")
    .select()
    .maybeSingle();

  if (error) throw error;

  if (data && data.driver_id) {
    driverAppRealtime.notifyDriver(data.driver_id, "sync", { reason: "offer_expired" });
  }

  return data || null;
}

async function getRideForExpiredOffer(rideId) {
  const { data, error } = await supabase
    .from("rides")
    .select("*")
    .eq("id", rideId)
    .maybeSingle();

  if (error) throw error;

  return data || null;
}

// Both adapters below throw on a failed or no-op update so
// sweepExpiredOffers() records the ride as failed and never goes on to
// dispatchRide() after a ride write that didn't happen. There is no
// current_driver_id/current_offer_id on rides; the expired offer itself
// is already recorded on its driver_offers row.
async function markRideRedispatchingForExpiry(rideId, nextAttempt) {
  const { data, error } = await supabase
    .from("rides")
    .update({
      dispatch_attempts: nextAttempt,
      dispatch_status: "redispatching",
      // Stamped here so sweepStuckRedispatches() below can tell how long
      // this ride has been sitting in "redispatching" — if dispatchRide()
      // never completes (throws, or the process dies mid-call), this
      // timestamp is what lets a later sweep recognize the claim as
      // abandoned and retry it, instead of the ride staying stuck forever.
      dispatch_claimed_at: nowIso(),
      updated_at: nowIso()
    })
    .eq("id", rideId)
    .select("id")
    .maybeSingle();

  if (error) throw error;

  if (!data) throw new Error(`Ride ${rideId} not found for redispatch.`);
}

async function markRideMaxAttemptsReachedForExpiry(rideId) {
  const { data, error } = await supabase
    .from("rides")
    .update({
      status: RIDE_STATUS.FAILED,
      dispatch_status: "max_attempts_reached",
      updated_at: nowIso()
    })
    .eq("id", rideId)
    .select("id")
    .maybeSingle();

  if (error) throw error;

  if (!data) throw new Error(`Ride ${rideId} not found for max-attempts update.`);
  await releaseFailedRidePayment(rideId);
  const failedRide = await getRideForExpiredOffer(rideId).catch(() => null);
  if (failedRide) notifyRideStage(failedRide, "no_drivers_available").catch(() => {});
}

async function runOfferExpirySweep() {
  const enabled = await getSystemFlag("offer_expiry_sweep_enabled", "false");

  if (enabled !== "true") return null;

  return sweepExpiredOffers({
    findExpiredOffers: findExpiredPendingOffers,
    claimExpiredOffer,
    getRide: getRideForExpiredOffer,
    markRideRedispatching: markRideRedispatchingForExpiry,
    markRideMaxAttemptsReached: markRideMaxAttemptsReachedForExpiry,
    dispatchRide,
    maxAttempts: envNumber("MAX_DISPATCH_ATTEMPTS", 5)
  });
}

/* =========================================================

   STUCK-REDISPATCH RECOVERY — SUPABASE ADAPTERS

   Protects both the offer-expiry sweep above AND the pre-existing
   decline-triggered redispatch (POST /api/driver/offers/:offerId/decline)
   from leaving a ride stranded in dispatch_status "redispatching" if
   dispatchRide() ever throws or the process dies before it finishes —
   see sweepStuckRedispatches() in lib/offerExpiry.js for the full
   reasoning. Deliberately NOT gated behind offer_expiry_sweep_enabled:
   the decline path's exposure is existing, always-on production
   behavior independent of that flag, so this safety net runs
   unconditionally, same as the accept/decline atomic-guard hardening.

========================================================= */

const STUCK_REDISPATCH_LEASE_MS = 90 * 1000;

async function findStuckRedispatchingRides(cutoffDate) {
  const { data, error } = await supabase
    .from("rides")
    .select("*")
    .eq("dispatch_status", "redispatching")
    .lt("dispatch_claimed_at", cutoffDate.toISOString());

  if (error) throw error;

  return data || [];
}

async function claimStuckRedispatchingRide(rideId, cutoffDate) {
  const { data, error } = await supabase
    .from("rides")
    .update({
      dispatch_claimed_at: nowIso(),
      updated_at: nowIso()
    })
    .eq("id", rideId)
    .eq("dispatch_status", "redispatching")
    .lt("dispatch_claimed_at", cutoffDate.toISOString())
    .select()
    .maybeSingle();

  if (error) throw error;

  return data || null;
}

async function runStuckRedispatchRecovery() {
  await sweepStuckRedispatches({
    findStuckRides: findStuckRedispatchingRides,
    claimStuckRide: claimStuckRedispatchingRide,
    dispatchRide,
    leaseMs: STUCK_REDISPATCH_LEASE_MS
  });
}

/* =========================================================

   RIDE ESTIMATE API

   "No valid route + no verified fare = no payment and no dispatch."
   rider-dashboard.html already refuses to call any of these three routes
   until Google Maps has resolved a real driving distance client-side
   (see ensureTripDistance() there) -- but that is only a client-side
   gate. hasValidTripDistance() (lib/pricing.js) is the server-side half:
   a direct call to /api/rides/estimate, /api/rides/payment-intent, or
   /api/rides/request with no miles (or miles<=0) is rejected outright
   instead of falling through to calculateRideEstimate()'s own
   miles=0/minutes=0 defaults, which would silently price a real trip at
   the flat minimum fare.

========================================================= */

// Logs a route-calculation failure server-side (Render logs + audit_logs)
// without ever putting the underlying Google Maps status, quota, or
// billing detail in a response body a rider can see. source is "client"
// for failures reported by rider-dashboard.html's own Google Maps calls
// (see POST /api/rides/route-failure below) and "server" for this fail-
// closed guard rejecting a request outright.
//
// Deliberately narrow about what gets logged: reason and mode are always
// checked against an allow-list before reaching here (see
// ROUTE_FAILURE_REASONS/ROUTE_FAILURE_MODES and sanitizeRouteFailureDetail
// below), and detail is either one of this app's own short enum strings
// (quote rejection reasons) or a Google status-code-shaped value -- never
// a free-form string a rider's request body could stuff a full address,
// phone number, email, or exact coordinate into. request_id is generated
// here, not accepted from the client, so it can be handed back to a rider
// for support correlation without that ID itself being a forgeable input.
function logRouteCalculationFailure({ reason, detail, source, mode, req }) {
  const requestId = makeId("ROUTEFAIL");

  console.error(
    `[route-calculation-failed] request_id=${requestId} source=${source} reason=${reason}` +
      (mode ? ` mode=${mode}` : "") +
      (detail ? ` detail=${detail}` : "")
  );

  auditLog({
    action: "route_calculation_failed",
    metadata: { request_id: requestId, reason, detail, source, mode },
    req
  }).catch(() => {});

  return requestId;
}

const ROUTE_FAILURE_REASONS = new Set([
  "maps_unavailable",
  "pickup_geocode_failed",
  "destination_geocode_failed",
  "distance_matrix_failed",
  "maps_script_failed",
  "unknown"
]);

// rider-dashboard.html's MODE_CONFIG keys -- the only "coarse operational
// context" this endpoint accepts, and only as an allow-listed enum, never
// free text.
const ROUTE_FAILURE_MODES = new Set([
  "driver",
  "airport",
  "autonomous",
  "food",
  "grocery"
]);

// The only free-form-shaped value this endpoint will actually store:
// Google Maps status codes (e.g. "ZERO_RESULTS", "OVER_QUERY_LIMIT") and
// this app's own "<DistanceMatrix status>/<element status>" pairing --
// both all-caps words/underscores, never containing spaces, letters
// forming an address, digits forming a phone number, or an "@". Anything
// that doesn't match this shape is dropped rather than logged, since a
// request body's "detail" field is otherwise entirely rider-controlled
// free text.
const ROUTE_FAILURE_DETAIL_PATTERN = /^[A-Z0-9_]{1,40}(\/[A-Z0-9_]{1,40})?$/;

function sanitizeRouteFailureDetail(rawDetail) {
  const value = cleanString(rawDetail, 80);
  return value && ROUTE_FAILURE_DETAIL_PATTERN.test(value) ? value : undefined;
}

// The one place a raw client-submitted number (miles) is ever mentioned in
// a log line -- constrained to "looks like a number" or a fixed marker so
// a client that sent a string instead (accidentally or otherwise) can
// never smuggle arbitrary text into a log through this field.
function sanitizeNumericLogValue(value) {
  if (value === undefined || value === null || value === "") {
    return "unset";
  }

  const stringValue = String(value);
  return /^-?\d+(\.\d+)?$/.test(stringValue) ? stringValue.slice(0, 20) : "invalid";
}

// Pulls the one coordinate pair per endpoint every one of
// estimate/payment-intent/request actually needs out of req.body, however
// the client happened to name it. Returns null for an endpoint whose
// coordinates are missing or non-finite -- never a guessed {lat: 0, lng:
// 0} default, which would otherwise look like a real (and very wrong)
// place on the map.
function parseCoordPair(lat, lng) {
  const parsedLat = Number(lat);
  const parsedLng = Number(lng);

  if (!Number.isFinite(parsedLat) || !Number.isFinite(parsedLng)) {
    return null;
  }

  return { lat: parsedLat, lng: parsedLng };
}

function extractTripCoords(body) {
  return {
    pickup: parseCoordPair(body?.pickup_lat, body?.pickup_lng),
    destination: parseCoordPair(body?.destination_lat, body?.destination_lng)
  };
}

// Reasons resolveRideQuote() (lib/rideQuote.js) can return that mean "the
// token itself is bad" (missing/malformed/wrong-secret/expired) as
// opposed to "the token is fine but this submission doesn't match it"
// (wrong rider/service/pickup/destination) -- used only to pick which of
// two rider-facing messages to show below; both are treated identically
// as a hard rejection.
const QUOTE_TOKEN_INVALID_REASONS = new Set([
  "missing_token",
  "malformed",
  "bad_signature",
  "expired"
]);

// The single gate both /api/rides/payment-intent and /api/rides/request
// go through before touching money or dispatching anything. Requires a
// signature-valid, unexpired estimate_token (see lib/rideQuote.js) AND
// that this specific request -- its ride_type, pickup, destination, and
// rider -- still matches exactly what that token was issued for.
// Client-submitted miles, minutes, fare, or fee fields are never read by
// either caller once this returns a quote: pricing comes exclusively
// from quote.estimate/quote.miles/quote.minutes from here on -- and
// resolveRideQuote()'s own signature has no parameter for any of those
// values, so there is nothing for a resubmitted number to even influence.
//
// Sends the (sanitized, PII-free) failure response itself and returns
// null on any failure, so callers can just `if (!quote) return;`.
// Owner decision 2026-10-17: autonomous rides are not offered until a
// certified operator, permits and insurance are in place; the rider app
// shows a waitlist instead. A request naming that ride type is refused
// (never silently turned into a human-driver ride).
function deliveryBookingEnabled(rideType) {
  if (!ENABLE_DELIVERY) return false;
  if (rideType === "food") return ENABLE_FOOD_DELIVERY;
  if (rideType === "grocery") return ENABLE_GROCERY_DELIVERY;
  return true;
}

function rejectUnavailableRideType(req, res) {
  const rideType = cleanString(req.body && req.body.ride_type, 50).toLowerCase();
  if (rideType === "autonomous") {
    fail(res, "Autonomous rides are not available yet. You can join the waitlist from the Ride Center.", 400);
    return true;
  }
  if (isDeliveryRideType(rideType) && !deliveryBookingEnabled(rideType)) {
    fail(res, "Delivery is paused while we finish merchant ordering. You can join the waitlist from the Delivery Center.", 400);
    return true;
  }
  return false;
}

function verifyAndConsumeRideQuote(req, res) {
  if (rejectUnavailableRideType(req, res)) return null;
  if (!RIDE_QUOTE_SECRET) {
    fail(res, "Ride quotes are not configured.", 503);
    return null;
  }

  const token = cleanString(req.body.estimate_token, 4000);

  if (!token) {
    logRouteCalculationFailure({ reason: "quote_missing", source: "server", req });
    fail(
      res,
      "A current fare quote is required. Please get a fresh route estimate before continuing.",
      400
    );
    return null;
  }

  const result = resolveRideQuote({
    token,
    secret: RIDE_QUOTE_SECRET,
    rideType: normalizeRideType(req.body.ride_type),
    riderId: cleanString(req.body.rider_id || req.body.riderId, 100) || null,
    ...extractTripCoords(req.body)
  });

  if (!result.ok) {
    logRouteCalculationFailure({
      reason: "quote_rejected",
      detail: result.reason,
      source: "server",
      req
    });

    const message = QUOTE_TOKEN_INVALID_REASONS.has(result.reason)
      ? "Your fare quote has expired or could not be verified. Please get a fresh route estimate."
      : "This trip no longer matches your fare quote. Please get a fresh route estimate.";

    fail(res, message, 400);
    return null;
  }

  return result.quote;
}

app.post(

  "/api/rides/route-failure",

  rateLimit({ windowMs: 60_000, max: 30, keyPrefix: "route_failure_report" }),

  asyncRoute(async (req, res) => {

    const rawReason = cleanString(req.body.reason, 60);
    const reason = ROUTE_FAILURE_REASONS.has(rawReason) ? rawReason : "unknown";
    const detail = sanitizeRouteFailureDetail(req.body.detail);
    const rawMode = cleanString(req.body.mode, 30);
    const mode = ROUTE_FAILURE_MODES.has(rawMode) ? rawMode : undefined;

    const requestId = logRouteCalculationFailure({ reason, detail, mode, source: "client", req });

    // Deliberately generic and always-success: this endpoint exists so we
    // can see real failures in Render logs, not so a rider-controlled
    // request body can learn anything about our Google Maps
    // configuration or quota state. request_id is handed back only so a
    // rider who contacts support has something to reference -- it names
    // nothing about them or their trip on its own.
    return ok(res, { logged: true, request_id: requestId });

  })

);

app.post(

  "/api/rides/estimate",

  asyncRoute(async (req, res) => {

    if (rejectUnavailableRideType(req, res)) return;

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

    if (!hasValidTripDistance({ miles, minutes })) {

      logRouteCalculationFailure({
        reason: "estimate_missing_distance",
        detail: `miles=${sanitizeNumericLogValue(req.body.miles ?? req.body.distance_miles)}`,
        source: "server",
        req
      });

      return fail(
        res,
        "We couldn't verify a route distance for this trip. Please get a fresh route estimate before continuing.",
        400
      );

    }

    // A quote is only meaningful if it's actually bound to a place -- an
    // estimate with no pickup/destination coordinates has nothing for
    // quoteMatchesSubmission() to compare a later payment/request against,
    // so it could never be redeemed anyway. Reject it here rather than
    // signing a token that would just fail every future verification.
    const { pickup, destination } = extractTripCoords(req.body);

    if (!pickup || !destination) {

      logRouteCalculationFailure({
        reason: "estimate_missing_coordinates",
        source: "server",
        req
      });

      return fail(
        res,
        "We couldn't verify a route distance for this trip. Please get a fresh route estimate before continuing.",
        400
      );

    }

    // Quote issuance is a hard requirement, not a nice-to-have: without a
    // configured secret there is no way to later prove the fare a rider
    // pays matches the fare they were quoted, so this must fail closed
    // exactly like Stripe/Twilio "not configured" responses elsewhere in
    // this file, rather than returning a fare nobody can actually redeem.
    if (!RIDE_QUOTE_SECRET) {
      return fail(res, "Ride quotes are not configured.", 503);
    }

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

    const riderId = cleanString(req.body.rider_id || req.body.riderId, 100) || null;

    const estimateToken = signRideQuote({
      rideType,
      miles,
      minutes,
      pickup,
      destination,
      riderId,
      estimate,
      secret: RIDE_QUOTE_SECRET,
      ttlMinutes: RIDE_QUOTE_TTL_MINUTES
    });

    const quoteExpiresAt = new Date(Date.now() + RIDE_QUOTE_TTL_MINUTES * 60 * 1000).toISOString();

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

      estimate,

      // Honest about what this token actually proves: the numbers inside
      // it were computed by the browser's own Google Maps Distance Matrix
      // call, not independently verified by the server against a routing
      // provider. See docs/route-verification-requirement.md.
      quote_source: "browser_calculated",
      estimate_token: estimateToken,
      quote_expires_at: quoteExpiresAt

    });

  })

);

/* =========================================================

   RIDER SAVED PAYMENT METHODS

   riders.stripe_customer_id already exists on the live schema (see
   RIDERS_TABLE_COLUMNS in lib/riderVerification.js) but was never wired
   up to anything — every ride payment created a brand-new, one-off
   PaymentIntent with no notion of a saved card. This creates a real
   Stripe Customer per rider (lazily, on first use) so a card entered at
   signup or during a ride request can be reused on later rides.

========================================================= */

async function getOrCreateStripeCustomer(rider) {
  if (rider.stripe_customer_id) {
    return rider.stripe_customer_id;
  }

  const customer = await stripe.customers.create(
    buildStripeCustomerPayload({
      riderId: rider.id,
      email: rider.email || undefined,
      name:
        rider.full_name ||
        [rider.first_name, rider.last_name].filter(Boolean).join(" ") ||
        undefined
    })
  );

  const { error } = await supabase
    .from("riders")
    .update({ stripe_customer_id: customer.id })
    .eq("id", rider.id);

  if (error) {
    throw error;
  }

  return customer.id;
}

/* P0 remediation PR 3 (docs/security-remediation/pr-03-rider-payment-ownership.md):
   while rider_auth_enforced is off (the default), rider_id is
   client-supplied exactly as before -- the still-open P0-2 finding.
   Once enabled, rider_id comes exclusively from the authenticated
   session (see resolveEnforcedRiderId in lib/riderAuth.js) and the
   client-supplied value is ignored outright, same as every other
   route migrated in PR 2b. */
app.post(
  "/api/rider/payment-methods/setup-intent",
  requireRiderIfEnforced,
  rateLimit({ windowMs: 60_000, max: 20, keyPrefix: "payment_setup_intent" }),
  asyncRoute(async (req, res) => {
    if (!stripe) {
      return fail(res, "Payments are not configured.", 503);
    }

    const riderId = resolveEnforcedRiderId({
      authenticatedRiderId: req.rider?.id,
      clientSuppliedRiderId: cleanString(req.body.rider_id || req.body.riderId, 100)
    });

    if (!riderId) {
      return fail(res, "rider_id is required.", 400);
    }

    const { data: rider, error } = await supabase
      .from("riders")
      .select("id, email, first_name, last_name, full_name, stripe_customer_id")
      .eq("id", riderId)
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (!rider) {
      return fail(res, "Rider not found.", 404);
    }

    const customerId = await getOrCreateStripeCustomer(rider);

    const setupIntent = await stripe.setupIntents.create({
      customer: customerId,
      payment_method_types: ["card"]
    });

    return ok(res, { client_secret: setupIntent.client_secret });
  })
);

/* P0 remediation PR 3: same treatment as setup-intent above -- riderId
   is client-supplied while rider_auth_enforced is off, session-derived
   once it's on. */
app.get(
  "/api/rider/payment-methods",
  requireRiderIfEnforced,
  rateLimit({ windowMs: 60_000, max: 60, keyPrefix: "payment_methods_list" }),
  asyncRoute(async (req, res) => {
    const riderId = resolveEnforcedRiderId({
      authenticatedRiderId: req.rider?.id,
      clientSuppliedRiderId: cleanString(req.query.riderId || req.query.rider_id, 100)
    });

    if (!riderId) {
      return fail(res, "riderId is required.", 400);
    }

    if (!stripe) {
      return ok(res, { payment_methods: [] });
    }

    const { data: rider, error } = await supabase
      .from("riders")
      .select("id, stripe_customer_id")
      .eq("id", riderId)
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (!rider || !rider.stripe_customer_id) {
      return ok(res, { payment_methods: [] });
    }

    const methods = await stripe.paymentMethods.list({
      customer: rider.stripe_customer_id,
      type: "card"
    });

    return ok(res, { payment_methods: mapPaymentMethodsForClient(methods.data) });
  })
);

/* P0 remediation PR 3: same treatment as setup-intent above -- riderId
   is client-supplied while rider_auth_enforced is off, session-derived
   once it's on. This route also has the pre-existing
   ownsPaymentMethod() ownership check below, unchanged -- that check
   verifies the *payment method* belongs to the resolved rider's Stripe
   customer, but never verified *who the caller is* on its own, which
   is exactly the gap requireRiderIfEnforced/resolveEnforcedRiderId
   closes once enabled. */
app.delete(
  "/api/rider/payment-methods/:paymentMethodId",
  requireRiderIfEnforced,
  rateLimit({ windowMs: 60_000, max: 20, keyPrefix: "payment_methods_delete" }),
  asyncRoute(async (req, res) => {
    if (!stripe) {
      return fail(res, "Payments are not configured.", 503);
    }

    const paymentMethodId = cleanString(req.params.paymentMethodId, 100);
    const riderId = resolveEnforcedRiderId({
      authenticatedRiderId: req.rider?.id,
      clientSuppliedRiderId: cleanString(req.query.riderId || req.query.rider_id, 100)
    });

    if (!paymentMethodId || !riderId) {
      return fail(res, "riderId is required.", 400);
    }

    const { data: rider, error } = await supabase
      .from("riders")
      .select("id, stripe_customer_id")
      .eq("id", riderId)
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (!rider || !rider.stripe_customer_id) {
      return fail(res, "Payment method not found.", 404);
    }

    let paymentMethod;

    try {
      paymentMethod = await stripe.paymentMethods.retrieve(paymentMethodId);
    } catch {
      return fail(res, "Payment method not found.", 404);
    }

    // Same 404-either-way ownership check used by /api/rider/saved-places
    // — never confirm a payment method ID exists to a caller supplying a
    // different riderId.
    if (!ownsPaymentMethod(paymentMethod, rider.stripe_customer_id)) {
      return fail(res, "Payment method not found.", 404);
    }

    await stripe.paymentMethods.detach(paymentMethodId);

    return ok(res, { deleted: true });
  })
);

/* =========================================================

   RIDE PAYMENT INTENT

========================================================= */

/* P0 remediation PR 3: while rider_auth_enforced is off (the default),
   rider_id is client-supplied exactly as before -- the still-open
   P0-2 finding. Once enabled, rider_id comes exclusively from the
   authenticated session (see resolveEnforcedRiderId in
   lib/riderAuth.js); the client-supplied value is ignored outright.
   This route resolves riderId once, immediately below, and reuses
   that single value everywhere else in the handler (attachment-fields
   lookup, Stripe metadata, audit log) instead of re-reading
   req.body.rider_id repeatedly -- so there is exactly one place this
   route ever decides "whose payment is this." */
app.post(

  "/api/rides/payment-intent",

  requireRiderIfEnforced,

  asyncRoute(async (req, res) => {

    // Option A (approved requirement, corrected): a Google Play review
    // rider's ride NEVER calls live Stripe -- but per the required
    // correction, this may ONLY activate for a request carrying a
    // real, currently-valid session for the review rider account
    // itself. resolveAuthenticatedReviewRider() re-derives identity
    // from the session cookie and a freshly loaded database row; it
    // never looks at req.body.rider_id or any other client-supplied
    // field, so a request that merely names or guesses the review
    // rider's id -- with no matching session -- falls straight through
    // to the ordinary path below, exactly like any other rider_id
    // would. Deliberately checked before the "Payments are not
    // configured" guard below, so the simulated flow works the same
    // whether or not Stripe/the payment gate is even configured in
    // this environment. The quote is still verified and consumed
    // normally so the reviewer sees the same real estimate/quote-token
    // flow as anyone else; only the Stripe call itself is replaced.
    const reviewerRider = await resolveAuthenticatedReviewRider(req);

    if (reviewerRider) {
      const quote = verifyAndConsumeRideQuote(req, res);

      if (!quote) {
        return;
      }

      const simulated = buildSimulatedPaymentIntentResponse({
        id: makeId("REVIEWPAY"),
        estimate: quote.estimate
      });

      auditLog({
        action: "review_payment_intent_simulated",
        actor_type: "rider",
        actor_id: reviewerRider.id,
        metadata: {
          payment_intent_id: simulated.payment_intent_id,
          amount: quote.estimate.total
        },
        req
      }).catch(() => {});

      return ok(res, simulated);
    }

    const riderId = resolveEnforcedRiderId({
      authenticatedRiderId: req.rider?.id,
      clientSuppliedRiderId: cleanString(req.body.rider_id, 100)
    });

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

    const quote = verifyAndConsumeRideQuote(req, res);

    if (!quote) {
      return;
    }

    const rideType = quote.ride_type;
    const estimate = quote.estimate;

    const amountCents =

      Math.round(

        estimate.total * 100

      );

    // Client-generated, per-attempt key (regenerated whenever trip details
    // change) — lets Stripe collapse a network retry or an accidental
    // double-click into the same PaymentIntent instead of creating two.
    const idempotencyKey =
      cleanString(
        req.body.idempotency_key,
        100
      );

    const paymentMethodId = cleanString(req.body.payment_method_id, 100);
    const saveCard = Boolean(req.body.save_card);

    // Attach an existing saved card, or mark a freshly entered one for
    // future reuse, by resolving the rider's Stripe Customer first. Both
    // branches require a real riderId — a request with neither
    // payment_method_id nor save_card (the pre-existing, one-off-card
    // path) skips this entirely and behaves exactly as before.
    let attachmentFields = {};

    if (riderId && (paymentMethodId || saveCard)) {
      const { data: rider, error: riderError } = await supabase
        .from("riders")
        .select("id, email, first_name, last_name, full_name, stripe_customer_id")
        .eq("id", riderId)
        .maybeSingle();

      if (riderError) {
        throw riderError;
      }

      if (rider) {
        if (paymentMethodId) {
          let paymentMethod;

          try {
            paymentMethod = await stripe.paymentMethods.retrieve(paymentMethodId);
          } catch {
            return fail(res, "Saved payment method not found.", 404);
          }

          if (!ownsPaymentMethod(paymentMethod, rider.stripe_customer_id)) {
            return fail(res, "Saved payment method not found.", 404);
          }

          attachmentFields = buildPaymentIntentAttachmentFields({
            stripeCustomerId: rider.stripe_customer_id,
            paymentMethodId
          });
        } else {
          const stripeCustomerId = await getOrCreateStripeCustomer(rider);

          attachmentFields = buildPaymentIntentAttachmentFields({
            stripeCustomerId,
            saveCard: true
          });
        }
      }
    }

    // Verified only when a valid rider session (whether or not sign-in is
    // enforced) names the same rider; a client-supplied rider_id alone
    // never counts.
    const sessionRider = req.rider || (riderId ? await resolveVerifiedRiderSession(req) : null);
    const riderVerified = Boolean(sessionRider?.id) && String(sessionRider.id) === String(riderId);

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

          ...attachmentFields,
          // Explicit app/account tags (reconciliation acts only on these),
          // and rider_verified = whether rider_id came from a verified
          // session rather than the client.
          metadata: buildIntentMetadata({
            rideType,
            riderId,
            riderVerified
          })
        }, idempotencyKey ? { idempotencyKey } : undefined);

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

    // A retried request whose Stripe idempotency key belongs to an intent
    // this server already cancelled (see below) gets that cancelled intent
    // back from Stripe. Never hand it out; the client starts a new attempt.
    if (!RELEASABLE_INTENT_STATUSES.includes(paymentIntent.status)) {
      return fail(res, "This payment attempt can no longer be used. Please try again.", 409, { retry_with_new_key: true });
    }

    // Every intent is recorded BEFORE its client secret leaves the server,
    // so no hold can exist that the database doesn't know about. This is a
    // reliability rule, not part of the (flagged) cleanup feature.
    const persisted = await persistCreatedPaymentRecord({
      intent: paymentIntent,
      riderId,
      rideType,
      stripeCustomerId: attachmentFields.customer || null
    });
    if (!persisted.ok) {
      if (persisted.reason === "record_not_reusable") {
        return fail(res, "This payment attempt can no longer be used. Please try again.", 409, { retry_with_new_key: true });
      }
      if (persisted.reason === "record_unreadable") {
        // The record exists (so the intent is tracked) but couldn't be read
        // back; another request may already be using this intent, so it is
        // not cancelled. The client simply retries.
        return fail(res, "Payment could not be started. Please try again.", 503);
      }
      await abandonUntrackedIntent(paymentIntent);
      return fail(res, "Payment could not be started. Please try again.", 503, { retry_with_new_key: true });
    }

    auditLog({

      action:

        "ride_payment_intent_created",

      actor_type:

        "rider",

      actor_id:

        riderId,

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

   P0 remediation (docs/security-remediation/pr-240-ride-request-ownership.md):
   while rider_auth_enforced is off (the default), riderId is
   client-supplied exactly as before -- the gap named PR 4 / "ride
   ownership" in PR 3's (#115) own scope notes, and confirmed still
   open when PR #101 was closed as superseded. Once enabled, riderId
   comes exclusively from the authenticated session (see
   resolveEnforcedRiderId in lib/riderAuth.js) and the client-supplied
   value is ignored outright -- ride.rider_id (the value
   verifyPaymentIntentForRide()'s rider-match check compares the
   PaymentIntent's own now-trustworthy metadata.rider_id against, per
   #115) becomes trustworthy for the first time here.

   Deliberately unchanged: verifyAndConsumeRideQuote()'s own internal
   quote-consistency check still reads req.body.rider_id/riderId
   directly (server.js, ~line 10217) -- that's a "does this submission
   match the quote token /api/rides/estimate already issued" check, a
   different question from "who owns this ride," and #115 left that
   same internal read untouched for the identical reason when fixing
   /api/rides/payment-intent. Not this PR's scope to revisit.

========================================================= */

app.post(

  "/api/rides/request",

  requireRiderIfEnforced,

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

    // Google Play reviewer-account identity (approved correction): may
    // ONLY come from a real, currently-valid session for the review
    // rider account itself -- resolveAuthenticatedReviewRider() never
    // looks at req.body.rider_id or any other client-supplied field.
    // When present, it deterministically wins over whatever rider_id
    // the request body also claims, the same "authenticated identity
    // always wins" rule resolveEnforcedRiderId already applies for the
    // rider_auth_enforced case -- extended here unconditionally, since
    // the reviewer path must stay session-gated regardless of that
    // flag's value.
    const reviewerRider = await resolveAuthenticatedReviewRider(req);

    // Security fix (owner decision 2026-10-18): a ride request needs a
    // signed-in rider, whatever rider_auth_enforced says. The rider is
    // taken only from the verified session (or the reviewer session),
    // never from req.body.rider_id, and must pass the readiness checks
    // (approved or active, not suspended or revoked). Before this, a
    // request with no rider_id skipped those checks entirely.
    const sessionRider = reviewerRider || req.rider || (await resolveVerifiedRiderSession(req));

    if (!sessionRider?.id) {
      return fail(res, "Please sign in to request a ride.", 401);
    }

    const riderId = sessionRider.id;

    const readiness =
      await getRiderReadiness(
        riderId
      );

    // Approved or active is required even when the approval gate
    // (ENABLE_RIDER_APPROVAL_GATE) is switched off.
    const riderStatusOk =
      ["active", "approved"].includes(String(readiness.rider?.status || "").toLowerCase()) ||
      String(readiness.rider?.approval_status || "").toLowerCase() === "approved";

    // The rider row: the fallback for the driver-facing name and phone
    // when the booking screen didn't send them (Just-in-Time booking
    // collects the phone at sign-up instead).
    const readinessRider = readiness.rider || null;

    if (!readiness.ready || !riderStatusOk) {
      return fail(
        res,
        readiness.reason || "Your rider account is not approved to book yet.",
        403,
        {
          checks:
            readiness.checks || {}
        }
      );
    }

    // Google Play reviewer-account flagging (approved correction): set
    // ONLY from resolveAuthenticatedReviewRider()'s own result above --
    // i.e. only when this exact request carried a real, currently-valid
    // reviewer session -- never re-derived from riderId (which, while
    // rider_auth_enforced is off, can be client-supplied) and never
    // from any client-supplied is_review_ride field, which this route
    // never reads in the first place. Persisted onto the ride itself so
    // every downstream consumer (dispatchRide()'s isolation,
    // notifyRideStage()'s message suppression, the mission-control/
    // operations-overview analytics exclusions) can filter on this one
    // column instead of re-deriving review status on every read.
    const isReviewRide = Boolean(reviewerRider);

    const quote = verifyAndConsumeRideQuote(req, res);

    if (!quote) {
      return;
    }

    const rideType = quote.ride_type;
    const estimate = quote.estimate;

    // A client-supplied payment_intent_id is never trusted as proof of
    // payment here — see lib/riderPayments.js. Only POST
    // /api/rides/:id/authorize, after retrieving and verifying the intent
    // with Stripe, may move a paid ride to PAYMENT_AUTHORIZED.
    // An App Review ride (authenticated reviewer session only, see
    // isReviewRide above) is created already authorized with payment
    // not_required: it never touches Stripe at any later step.
    const reviewRideState = decideReviewRideInitialState({
      isReviewRide,
      defaultStatus: decideInitialRideStatus({
        enablePaymentGate: ENABLE_PAYMENT_GATE,
        paymentIntentId: req.body.payment_intent_id
      }),
      authorizedStatus: RIDE_STATUS.PAYMENT_AUTHORIZED
    });

    const status = reviewRideState.status;

    const now =

      nowIso();

    const isDelivery =

      isDeliveryRideType(rideType);

    const ride = {

      id:

        makeId("RIDE"),

      rider_id:

        riderId || null,

      is_review_ride:
        isReviewRide,

      ...(reviewRideState.simulated
        ? { payment_status: reviewRideState.payment_status }
        : {}),

      rider_name:
        cleanString(req.body.rider_name, 180) ||
        cleanString([readinessRider?.first_name, readinessRider?.last_name].filter(Boolean).join(" "), 180),

      rider_phone:
        cleanPhone(req.body.rider_phone) ||
        cleanPhone(readinessRider?.phone),

      // NOTE: the rides table has no "pickup"/"destination" columns —
      // only pickup_address/dropoff_address. Writing to the old names
      // here used to make every ride request fail at insert time.
      pickup_address:

        cleanString(

          req.body.pickup,

          500

        ),

      dropoff_address:

        cleanString(

          req.body.destination,

          500

        ),

      // Sourced from the verified quote, not req.body, now that one
      // exists — quoteMatchesSubmission() already confirmed these equal
      // what the client submitted (within rounding), so the quote's
      // values are the canonical, server-trusted copy from here on.
      pickup_lat:

        quote.pickup.lat,

      pickup_lng:

        quote.pickup.lng,

      dropoff_lat:

        quote.destination.lat,

      dropoff_lng:

        quote.destination.lng,

      ride_type:

        rideType,

      scheduled_time:

        req.body.scheduled_for || null,

      // Only ever populated here when the payment gate itself is off
      // (an explicit ops-level decision, not client input) — a paid ride
      // starts with no payment_id and gets one only from a verified
      // /authorize call, never from what the client claimed at creation.
      payment_id:

        status === RIDE_STATUS.PAYMENT_AUTHORIZED

          ? cleanString(req.body.payment_intent_id, 200) || null

          : null,

      status,

      dispatch_status:

        status === RIDE_STATUS.PAYMENT_REQUIRED

          ? "awaiting_payment"

          : "ready_to_dispatch",

      estimated_fare:

        estimate.total,

      driver_payout:

        estimate.driver_payout,

      estimated_platform_fee:

        estimate.platform_fee,

      // Persists the full itemized breakdown (base fare, distance charge,
      // time charge, booking fee, discount, surcharge) so line items like
      // the airport surcharge are recorded on the ride itself, not just
      // returned transiently in the estimate response. Reuses an existing
      // jsonb column that nothing else was writing to.
      pricing_snapshot:

        estimate,

      estimated_distance_miles:

        estimate.miles,

      estimated_duration_minutes:

        estimate.minutes,

      miles_estimate:

        estimate.miles,

      minutes_estimate:

        estimate.minutes,

      notes:

        cleanString(

          req.body.notes,

          1000

        ),

      // Delivery-only fields (food/grocery). Left null for passenger rides.
      merchant_name:

        isDelivery

          ? cleanString(req.body.merchant_name, 180)

          : null,

      item_count:

        isDelivery && req.body.item_count

          ? Math.max(1, Math.floor(Number(req.body.item_count)))

          : null,

      pickup_instructions:

        isDelivery

          ? cleanString(req.body.pickup_instructions, 500)

          : null,

      delivery_instructions:

        isDelivery

          ? cleanString(req.body.delivery_instructions, 500)

          : null,

      delivery_pin:

        isDelivery

          ? String(Math.floor(1000 + Math.random() * 9000))

          : null,

      delivery_stage:

        isDelivery ? DELIVERY_STAGE.ORDER_ACCEPTED : null,

      delivery_handoff:

        isDelivery

          ? (["leave_at_door", "hand_to_customer"].includes(

              cleanString(req.body.delivery_handoff, 30)

            )

              ? cleanString(req.body.delivery_handoff, 30)

              : "hand_to_customer")

          : null,

      tip_amount:

        Number.isFinite(Number(req.body.tip_amount)) &&

        Number(req.body.tip_amount) > 0

          ? Math.min(500, Math.round(Number(req.body.tip_amount) * 100) / 100)

          : null,

      // Replay-protection identity: quote.jti is unique per signed quote
      // (lib/rideQuote.js), cryptographically random, generated only at
      // /api/rides/estimate time and never client-suppliable. rides.
      // quote_jti carries a unique partial index (see the
      // quote-jti-idempotency migration), so a second ride-creation
      // attempt presenting the SAME still-valid token can never create a
      // second ride -- that guarantee is unconditional and does not
      // depend on rider_auth_enforced at all.
      //
      // What DOES depend on that flag is only whether the duplicate
      // request's response may include the existing ride's details: see
      // the unique-violation handling below, which resolves a real
      // verified session (resolveVerifiedRiderSession) independently of
      // `riderId` -- `riderId` a few lines up is resolveEnforcedRiderId()'s
      // result, a LEGACY, UNAUTHENTICATED value (client-supplied
      // rider_id/localStorage-cached id) while rider_auth_enforced is off
      // (the current production default), and is never used to decide
      // what a replay response reveals.
      quote_jti:

        quote.jti || null,

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

      if (error.code === "23505" && ride.quote_jti) {

        const { data: existingRide, error: lookupError } =

          await supabase

            .from("rides")

            .select("*")

            .eq("quote_jti", ride.quote_jti)

            .maybeSingle();

        // Real duplicate-creation protection: the unique index on
        // rides.quote_jti already guarantees the SECOND insert attempt
        // above never created a second ride, regardless of anything
        // below. What's decided here is only whether THIS response may
        // include the existing ride's details.
        //
        // That decision is never based on riderId (resolveEnforcedRiderId's
        // result) -- while rider_auth_enforced is off, riderId is a
        // legacy, unauthenticated value read straight from the request
        // body, and a matching body-supplied rider_id (or a matching
        // value cached in the client's own localStorage) is not proof of
        // who is actually asking. Only a real, currently-valid rider
        // session (resolveVerifiedRiderSession -- the cookie, verified
        // the same way requireRider verifies it) may unlock the replay
        // response. No session, or a session that doesn't match the
        // existing ride's own rider_id, gets the same generic 409 either
        // way -- this must not leak whether a match failed versus no
        // session existed at all.
        if (!lookupError && existingRide) {

          const verifiedRider = await resolveVerifiedRiderSession(req);

          if (verifiedRider && String(existingRide.rider_id || "") === String(verifiedRider.id)) {

            auditLog({
              actor_type: "rider",
              actor_id: verifiedRider.id,
              action: "ride_request_replay_detected",
              entity_type: "ride",
              entity_id: existingRide.id,
              req
            }).catch(() => {});

            return ok(res, {
              ride: existingRide,
              dispatch: null,
              replay: true,
              tracking_token: rideTrackingTokenFor(existingRide.id)
            });

          }

        }

        // No verified session, a session that doesn't match, or the
        // lookup itself failed -- never return ride details based on a
        // body-supplied identity. Generic response on purpose: no detail
        // about what exists, and no distinction between "already used"
        // and "used by someone else."
        return fail(res, "This ride quote has already been used.", 409);

      }

      console.error(

        "❌ Ride insert failed:",

        // Code only: Postgres details/hint can echo names and addresses.
        dbErrorEntry(error)

      );

      throw error;

    }

    notifyRideStage(data, "order_submitted").catch(() => {});

    let dispatch = null;

    // App Review demo: a simulated offer still waiting for the review
    // driver is withdrawn, so the rider reviewer's own request reaches
    // them (only while the demo switch is on; review rides only).
    if (isReviewRide && (await reviewDemoEnabled())) {
      await withdrawPendingReviewAutoOffers("review_demo_rider_request_first").catch(() => {});
    }

    if (shouldDispatchRideNow(data)) {

      dispatch =

        await dispatchRide(data);

    } else if (data.scheduled_time) {

      console.log(
        `⏳ Ride ${data.id} held for scheduled dispatch at ${data.scheduled_time}. ` +
        `sweepScheduledRides() will pick it up once that time arrives.`
      );

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
        dispatch,
        // Lets this rider (and only whoever received this response) read
        // the ride's live status and location; see lib/rideAccess.js.
        tracking_token: rideTrackingTokenFor(data.id),
        ...(reviewRideState.simulated
          ? {
              review_mode: true,
              simulated_payment: true,
              simulated_label: SIMULATED_PAYMENT_LABEL
            }
          : {})
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

    // App Review rides are created already authorized with payment
    // not_required (see POST /api/rides/request) and must never reach
    // Stripe -- a reviewer client never has a real PaymentIntent, and
    // rides.payment_id is a foreign key to payments, so a fake id can't
    // be stored either. A review ride still awaiting authorization (only
    // possible for one created before this change) is authorized here
    // without Stripe, and only for the reviewer session that owns it.
    if (ride.is_review_ride === true) {
      if (ride.status !== RIDE_STATUS.PAYMENT_REQUIRED) {
        return ok(res, {
          ride,
          dispatch: null,
          review_mode: true,
          simulated_payment: true,
          simulated_label: SIMULATED_PAYMENT_LABEL
        });
      }

      const reviewerRider = await resolveAuthenticatedReviewRider(req);

      if (!reviewerRider || String(reviewerRider.id) !== String(ride.rider_id || "")) {
        return fail(res, "This ride could not be authorized.", 403);
      }

      const { data: authorizedReviewRide, error: reviewAuthError } = await supabase
        .from("rides")
        .update({
          status: RIDE_STATUS.PAYMENT_AUTHORIZED,
          dispatch_status: "ready_to_dispatch",
          payment_status: "not_required",
          updated_at: nowIso()
        })
        .eq("id", rideId)
        .select()
        .maybeSingle();

      if (reviewAuthError || !authorizedReviewRide) {
        return fail(res, "This ride could not be authorized.", 500);
      }

      const reviewDispatch = shouldDispatchRideNow(authorizedReviewRide)
        ? await dispatchRide(authorizedReviewRide)
        : null;

      auditLog({
        actor_type: "rider",
        actor_id: reviewerRider.id,
        action: "review_ride_authorized_simulated",
        entity_type: "ride",
        entity_id: rideId,
        req
      }).catch(() => {});

      return ok(res, {
        ride: authorizedReviewRide,
        dispatch: reviewDispatch,
        review_mode: true,
        simulated_payment: true,
        simulated_label: SIMULATED_PAYMENT_LABEL
      });
    }

    // A ride is authorized exactly once. Without this check a repeated call
    // (a retry, a second tab, a replayed request) for a ride that had
    // already moved on -- payment_authorized, dispatched, even in progress
    // -- re-ran verification, rewrote the ride back to payment_authorized
    // and dispatched it again. A repeat carrying the PaymentIntent already
    // on the ride is answered idempotently with nothing changed; anything
    // else is refused.
    if (ride.status !== RIDE_STATUS.PAYMENT_REQUIRED) {
      const requestedIntentId = cleanString(req.body.payment_intent_id, 200);
      const sameIntent =
        Boolean(ride.payment_id) &&
        (!requestedIntentId || requestedIntentId === String(ride.payment_id));
      const live = ![RIDE_STATUS.CANCELLED, RIDE_STATUS.FAILED].includes(ride.status);
      if (sameIntent && live) {
        return ok(res, {
          ride_id: ride.id,
          status: ride.status,
          already_authorized: true,
          dispatch: null
        });
      }
      return fail(res, "This ride is not awaiting payment authorization.", 409);
    }

    const paymentIntentId =
      cleanString(
        req.body.payment_intent_id ||
        ride.payment_id,
        200
      );

    if (!paymentIntentId) {

      return fail(

        res,

        "A payment_intent_id is required to authorize this ride.",

        400

      );

    }

    /* ---- Stripe verification ----

       Never trust a client-supplied intent id, and never authorize a ride
       when there is no way to verify one. This route used to skip the
       entire verification block below whenever the module-level `stripe`
       client was null (Stripe unconfigured) and authorize anyway using
       whatever the client sent — see docs/production-incidents.md,
       "Ride authorization accepts an unverified payment_intent_id when
       Stripe is unavailable." verifyPaymentIntentForRide() fails closed on
       stripeConfigured: false before any other check — no Stripe client
       means no authorization, full stop. */

    let intent = null;

    if (stripe) {

      try {

        intent =

          await stripe.paymentIntents.retrieve(paymentIntentId);

      } catch (stripeErr) {

        console.error(

          "❌ PaymentIntent retrieve failed:",

          stripeErr.message

        );

        return fail(

          res,

          "Payment could not be verified with Stripe.",

          402

        );

      }

    }

    // Verifies, and — when needed — binds the intent to this ride via
    // Stripe so it can't be reused elsewhere. A bind failure is treated as
    // a hard failure, not a warning: an intent that verified cleanly but
    // couldn't be bound is not yet safe against reuse on a different
    // ride, so authorization must not proceed to mark this ride
    // PAYMENT_AUTHORIZED in that case.
    const verification =

      await authorizePaymentIntentForRide({

        stripeConfigured: Boolean(stripe),

        intent,

        ride,

        rideId,

        exposeDetails: !IS_PRODUCTION,

        bindPaymentIntentToRide: () =>

          stripe.paymentIntents.update(

            paymentIntentId,

            {

              metadata: {

                ...(intent?.metadata || {}),

                ride_id: rideId

              }

            }

          )

      });

    if (!verification.ok) {

      return fail(

        res,

        verification.error,

        verification.statusCode,

        verification.extra

      );

    }

    // rides.payment_id is a foreign key to payments(id): the payment record
    // must exist, bound to this ride, before the ride can reference it. The
    // bind is a conditional write on the payments row, which is also what
    // stops a concurrent unused-hold release from cancelling this payment
    // (lib/unusedHolds.js).
    const paymentBinding = await bindPaymentRecordToRide({ intent, ride });
    if (!paymentBinding.ok) {
      return fail(res, paymentBinding.error, paymentBinding.statusCode);
    }

    // Conditional on the ride still awaiting payment, so two concurrent
    // calls can't both authorize (and dispatch) the same ride.
    const { data: authorizedRows, error: authorizeWriteError } = await supabase
      .from("rides")
      .update({
        payment_id: paymentIntentId,
        status: RIDE_STATUS.PAYMENT_AUTHORIZED,
        dispatch_status: "ready_to_dispatch",
        updated_at: nowIso()
      })
      .eq("id", rideId)
      .eq("status", RIDE_STATUS.PAYMENT_REQUIRED)
      .select("id");

    if (authorizeWriteError || !Array.isArray(authorizedRows) || !authorizedRows.length) {
      // The ride was not authorized: hand the payment record back so the
      // unused hold can still be released.
      await unbindPaymentRecordFromRide({ paymentIntentId, rideId });
      if (authorizeWriteError) {
        return fail(res, "This ride could not be authorized.", 500);
      }
      return fail(res, "This ride is not awaiting payment authorization.", 409);
    }

    const updatedRide = {

      ...ride,

      payment_id:

        paymentIntentId,

      status:

        RIDE_STATUS.PAYMENT_AUTHORIZED

    };

    // This route used to dispatch unconditionally on payment authorization,
    // regardless of scheduled_time — a second occurrence of the same bug
    // fixed on the ride-creation route above. A rider who scheduled a ride
    // but hadn't authorized payment yet at creation time would still get
    // dispatched immediately the moment they authorized payment.
    let dispatch = null;

    if (shouldDispatchRideNow(updatedRide)) {

      dispatch =

        await dispatchRide(

          updatedRide

        );

    } else if (updatedRide.scheduled_time) {

      console.log(
        `⏳ Ride ${updatedRide.id} authorized but held for scheduled dispatch at ${updatedRide.scheduled_time}.`
      );

    }

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

);

/* =========================================================

   RIDE STATUS (RIDER-FACING)

   Public by ride ID (ride IDs are not sequential/guessable),
   matching the existing /api/foundation/status/:code pattern.
   Returns ride status plus assigned driver name, vehicle, and
   live photo_url once a driver has been assigned. This route
   did not previously exist — request-ride.html's
   refreshRideStatus() had an intentionally empty endpoint list
   because there was nothing to call.

========================================================= */

app.get(

  "/api/rides/:id/status",

  asyncRoute(async (req, res) => {

    const rideId = cleanString(req.params.id, 100);

    const { data: ride, error } = await supabase

      .from("rides")

      .select(

        "id, status, ride_type, pickup_address, dropoff_address, " +

        "pickup_lat, pickup_lng, dropoff_lat, dropoff_lng, rider_id, " +

        "driver_id, driver_name, driver_vehicle, driver_phone, " +

        "driver_eta_to_pickup_minutes, driver_distance_to_pickup_miles, " +

        "estimated_fare, created_at, updated_at, " +

        "delivery_stage, delivery_pin, merchant_name, item_count, " +

        "pickup_instructions, delivery_instructions, delivered_at, " +

        "delivery_handoff, tip_amount, delivery_proof_url, " +

        "rider_live_lat, rider_live_lng, rider_live_accuracy_m, rider_live_at"

      )

      .eq("id", rideId)

      .maybeSingle();

    if (error || !ride) {
      return fail(res, "Ride not found.", 404);
    }

    // Same answer as a missing ride, so the route doesn't confirm that a
    // guessed id exists.
    const viewer = await resolveRideViewer(req, ride);
    if (!viewer) {
      return fail(res, "Ride not found.", 404);
    }

    let driverPhotoUrl = null;

    let driverVerified = false;

    let driverLocation = null;

    if (ride.driver_id) {

      const { data: driver } = await supabase

        .from("drivers")

        .select("photo_url, approval_status, current_lat, current_lng, last_seen_at, location_accuracy_meters")

        .eq("id", ride.driver_id)

        .maybeSingle();

      driverPhotoUrl = driver?.photo_url || null;

      // Real signal, not decorative: only true once the driver has cleared
      // Harvey Taxi's approval flow (identity/insurance/license checks).
      driverVerified = driver?.approval_status === "approved";

      if (driver && driver.current_lat !== null && driver.current_lng !== null) {

        const ageSeconds = driver.last_seen_at

          ? (Date.now() - new Date(driver.last_seen_at).getTime()) / 1000

          : Infinity;

        driverLocation = {

          lat: driver.current_lat,

          lng: driver.current_lng,

          accuracy_meters: driver.location_accuracy_meters,

          last_seen_at: driver.last_seen_at,

          stale: ageSeconds > 180

        };

      }

    }

    // App Review demo: an active ride with no assigned driver can only be
    // a simulated-driver demo ride. Looked up separately (and only then)
    // so this route never depends on the demo columns existing.
    let simulatedDriver = false;
    if (!ride.driver_id && Object.keys(reviewDemo.NEXT_STAGE).includes(ride.status)) {
      const { data: demo } = await supabase
        .from("rides")
        .select("review_demo, review_demo_next_at, is_review_ride")
        .eq("id", ride.id)
        .maybeSingle();
      if (demo && demo.is_review_ride === true && demo.review_demo === "autopilot") {
        simulatedDriver = true;
        driverLocation = reviewDemo.simulatedPosition({ ...ride, ...demo }, Date.now());
      }
    }

    const isDelivery = isDeliveryRideType(ride.ride_type);

    let tracking = null;

    if (driverLocation && !driverLocation.stale) {

      let target = null;

      let targetLabel = null;

      if (

        ride.status === RIDE_STATUS.DRIVER_ENROUTE ||

        ride.status === RIDE_STATUS.ARRIVED

      ) {

        target = { lat: ride.pickup_lat, lng: ride.pickup_lng };

        targetLabel = isDelivery ? "store" : "pickup";

      } else if (ride.status === RIDE_STATUS.IN_PROGRESS) {

        target = { lat: ride.dropoff_lat, lng: ride.dropoff_lng };

        targetLabel = isDelivery ? "customer" : "destination";

      }

      if (

        target &&

        Number.isFinite(Number(target.lat)) &&

        Number.isFinite(Number(target.lng))

      ) {

        const distanceMiles = haversineMiles(

          driverLocation.lat,

          driverLocation.lng,

          Number(target.lat),

          Number(target.lng)

        );

        tracking = {

          target: targetLabel,

          distance_miles: Math.round(distanceMiles * 10) / 10,

          eta_minutes: Math.max(

            1,

            Math.round((distanceMiles / ASSUMED_DELIVERY_SPEED_MPH) * 60)

          ),

          is_estimate: true,
          ...(simulatedDriver ? { simulated: true, label: "Simulated location" } : {})

        };

      }

    }

    return ok(res, shapeStatusForViewer({
      id: ride.id,

      status: ride.status,

      ride_type: ride.ride_type,

      pickup_address: ride.pickup_address,

      destination_address: ride.dropoff_address,

      eta_minutes: ride.driver_eta_to_pickup_minutes,

      distance_miles: ride.driver_distance_to_pickup_miles,

      estimated_fare: ride.estimated_fare,

      updated_at: ride.updated_at,

      pickup_location:
        Number.isFinite(Number(ride.pickup_lat)) && Number.isFinite(Number(ride.pickup_lng))
          ? { lat: Number(ride.pickup_lat), lng: Number(ride.pickup_lng) }
          : null,

      destination_location:
        Number.isFinite(Number(ride.dropoff_lat)) && Number.isFinite(Number(ride.dropoff_lng))
          ? { lat: Number(ride.dropoff_lat), lng: Number(ride.dropoff_lng) }
          : null,

      tracking,
      // Whether the rider can share their own location with the driver
      // right now (before pickup only), and whether it is being shared.
      rider_location_sharing:
        viewer === "rider" || viewer === "admin" ? liveLocation.riderSharingState(ride) : undefined,

      driver: ride.driver_id

        ? {

            name: ride.driver_name,

            vehicle: ride.driver_vehicle,

            phone: ride.driver_phone,

            photo_url: driverPhotoUrl,

            verified: driverVerified,

            location: driverLocation

          }

        : simulatedDriver
          ? {
              name: reviewDemo.SIMULATED_DRIVER.name,
              vehicle: reviewDemo.SIMULATED_DRIVER.vehicle,
              phone: null,
              photo_url: null,
              verified: false,
              simulated: true,
              location: driverLocation
            }
          : null,

      // App Review demo only: the ride is driven by the simulated driver.
      ...(simulatedDriver
        ? { simulated: true, simulated_label: "App Review demonstration: simulated driver, location and trip. No payment is collected." }
        : {}),

      delivery: isDelivery

        ? {

            stage: ride.delivery_stage,

            stage_label:

              DELIVERY_STAGE_LABELS[ride.delivery_stage] || null,

            pin: ride.delivery_pin,

            merchant_name: ride.merchant_name,

            item_count: ride.item_count,

            pickup_instructions: ride.pickup_instructions,

            delivery_instructions: ride.delivery_instructions,

            delivered_at: ride.delivered_at,

            delivery_handoff: ride.delivery_handoff,

            tip_amount: ride.tip_amount,

            proof_url: ride.delivery_proof_url
          }
        : null
    }, viewer));

  })

);

/* =========================================================

   RIDE CANCELLATION (rider-initiated) AND DRIVER WITHDRAWAL

   Two deliberately separate operations (approved policy):

   - Rider cancels the ride: the whole ride ends (RIDE_STATUS.CANCELLED),
     any assigned driver is released and notified, and any uncaptured
     Stripe PaymentIntent is voided. No fee is charged in this phase --
     the reconciliation state below is structured so a configurable
     fee could be added later without a redesign, but nothing computes
     or charges one now.
   - Driver withdraws from an accepted ride: the ride is NOT cancelled --
     it returns to dispatch (RIDE_STATUS.AWAITING_DRIVER) and is
     redispatched excluding that driver, and the rider is notified their
     driver became unavailable. Never touches payment at all.

   Both require a real, unconditional session (requireRider /
   requireDriver -- not gated behind rider_auth_enforced, since these are
   brand-new routes with no legacy client depending on a weaker model)
   and never trust a body-supplied rider_id/driver_id/cancelled_by_id for
   ownership.

   Self-service cancellation is only offered before a trip is
   IN_PROGRESS; once underway, only an authorized admin incident
   resolution can end it (see PATCH /api/admin/rides/:id/status's
   narrowed scope and the dedicated incident-resolution route). completed
   and cancelled are terminal -- neither can be reached from itself again
   in a way that repeats a Stripe action (see reconcileCancellationPayment
   below).

========================================================= */

// Resumable Stripe-void workflow for a cancelled ride, mirroring
// captureRidePaymentIdempotent()'s structure exactly (see
// lib/rideCancellation.js for the decision logic and idempotency-key
// derivation). Persists cancellation_payment_status before AND after the
// Stripe call so a repeated cancel request -- whether a genuine retry or
// one that finds the ride already cancelled -- resumes reconciliation
// instead of silently abandoning an authorized PaymentIntent. Never
// reverses a PaymentIntent Stripe reports as already captured; that case
// is marked cancel_failed with a reason pointing at the (not-yet-built)
// refund/incident workflow, never auto-reversed.
// A ride that ends as failed -- no driver found, out of dispatch attempts,
// or marked failed by an admin -- must not leave the rider's card
// authorized until the hold expires on its own. Reuses the cancellation
// workflow: idempotent, resumable, records its outcome on the ride, never
// reverses an already captured payment, and skips review rides and rides
// with no payment. Never throws.
async function releaseFailedRidePayment(rideId, req = null) {
  try {
    const { data: ride, error } = await supabase.from("rides").select("*").eq("id", rideId).maybeSingle();
    if (error || !ride || ride.status !== RIDE_STATUS.FAILED) return null;
    const result = await reconcileCancellationPayment(ride, req);
    auditLog({
      actor_type: "system",
      action: "failed_ride_payment_released",
      entity_type: "ride",
      entity_id: rideId,
      metadata: { outcome: result ? result.outcome : null, dispatch_status: ride.dispatch_status || null },
      req
    }).catch(() => {});
    return result;
  } catch (err) {
    console.error("❌ Failed-ride payment release error:", rideId, err && err.message);
    return null;
  }
}

async function reconcileCancellationPayment(ride, req = null) {
  const decision = decideCancelPaymentAction({ ride });

  if (decision.action === "skip") {
    return { outcome: ride.cancellation_payment_status, ride };
  }

  if (decision.action === "not_required" || !stripe) {
    const { data, error } = await supabase
      .from("rides")
      .update({
        cancellation_payment_status: CANCELLATION_PAYMENT_STATUS.NOT_REQUIRED,
        updated_at: nowIso()
      })
      .eq("id", ride.id)
      .select()
      .maybeSingle();

    if (error) {
      console.error("❌ Failed to persist not_required cancellation_payment_status:", error.message);
    }

    return { outcome: CANCELLATION_PAYMENT_STATUS.NOT_REQUIRED, ride: data || ride };
  }

  const idempotencyKey = cancelPaymentIdempotencyKey(ride.id);

  await supabase
    .from("rides")
    .update({
      cancellation_payment_status: CANCELLATION_PAYMENT_STATUS.CANCEL_PENDING,
      cancellation_payment_idempotency_key: idempotencyKey,
      cancellation_payment_attempted_at: nowIso(),
      updated_at: nowIso()
    })
    .eq("id", ride.id);

  let intent;

  try {
    intent = await stripe.paymentIntents.retrieve(ride.payment_id);
  } catch (retrieveErr) {
    const { data } = await supabase
      .from("rides")
      .update({
        cancellation_payment_status: CANCELLATION_PAYMENT_STATUS.CANCEL_FAILED,
        cancellation_payment_error: retrieveErr.message || String(retrieveErr),
        updated_at: nowIso()
      })
      .eq("id", ride.id)
      .select()
      .maybeSingle();

    auditLog({
      actor_type: "system",
      action: "ride_cancellation_payment_reconcile_failed",
      entity_type: "ride",
      entity_id: ride.id,
      metadata: { stage: "retrieve", error: retrieveErr.message },
      req
    }).catch(() => {});

    return { outcome: CANCELLATION_PAYMENT_STATUS.CANCEL_FAILED, ride: data || ride };
  }

  if (intent.status === "succeeded") {
    // Already captured -- never reverse via cancel. This must route to
    // an explicit refund/incident workflow (not built in this phase),
    // never an automatic reversal.
    const { data } = await supabase
      .from("rides")
      .update({
        cancellation_payment_status: CANCELLATION_PAYMENT_STATUS.CANCEL_FAILED,
        cancellation_payment_error: "PaymentIntent already captured; requires an explicit refund, not a cancellation.",
        updated_at: nowIso()
      })
      .eq("id", ride.id)
      .select()
      .maybeSingle();

    auditLog({
      actor_type: "system",
      action: "ride_cancellation_requires_refund",
      entity_type: "ride",
      entity_id: ride.id,
      metadata: { payment_intent_status: intent.status },
      req
    }).catch(() => {});

    return { outcome: CANCELLATION_PAYMENT_STATUS.CANCEL_FAILED, ride: data || ride, requiresRefund: true };
  }

  let cancelError = null;

  try {
    await stripe.paymentIntents.cancel(ride.payment_id, {}, { idempotencyKey });
  } catch (err) {
    cancelError = err.message || String(err);
    console.error("❌ Payment cancellation failed:", cancelError);
  }

  const finalStatus = cancelError
    ? CANCELLATION_PAYMENT_STATUS.CANCEL_FAILED
    : CANCELLATION_PAYMENT_STATUS.CANCELLED;

  const { data: updatedRide, error: finalError } = await supabase
    .from("rides")
    .update({
      cancellation_payment_status: finalStatus,
      cancellation_payment_error: cancelError,
      updated_at: nowIso()
    })
    .eq("id", ride.id)
    .select()
    .maybeSingle();

  if (finalError) {
    console.error("❌ Failed to persist final cancellation_payment_status:", finalError.message);
  }

  if (cancelError) {
    auditLog({
      actor_type: "system",
      action: "ride_cancellation_payment_failed",
      entity_type: "ride",
      entity_id: ride.id,
      metadata: { error: cancelError, idempotency_key: idempotencyKey },
      req
    }).catch(() => {});
  }

  return { outcome: finalStatus, ride: updatedRide || ride };
}

/* =========================================================
   CANCELLATION AND NO-SHOW RECORDS (lib/cancellationRecords.js,
   docs/policy-cancellation-noshow-draft.md)
   Owner instruction (2026-10-04): build and test the controls and
   records first, keeping every cancellation free. These record what the
   draft policy needs; none of them charges anything, and the database
   refuses any cancellation fee other than $0.
   Every write here is best effort and separate from the ride's own
   status change, so a ride is never held up by a record (including
   before migration 20261005030000 is applied).
========================================================= */
const cancellationRecords = require("./lib/cancellationRecords");

async function updateRideRecords(rideId, patch, label) {
  try {
    const { error } = await supabase.from("rides").update(patch).eq("id", rideId);
    if (error) throw error;
    return true;
  } catch (err) {
    console.warn(`⚠️ Ride record (${label}) not saved:`, err && err.message ? err.message : err);
    return false;
  }
}

// The pickup estimate shown when the first driver accepted, kept for the
// "5 minutes late" check (and kept through any reassignment); also resets
// this ride's per-driver pickup records.
async function recordPickupEstimateAtAccept(rideId) {
  const { data: ride, error } = await supabase
    .from("rides")
    .select("id, accepted_at, driver_eta_to_pickup_minutes, eta_at_accept_minutes, pickup_due_at")
    .eq("id", rideId)
    .maybeSingle();
  if (error || !ride) return false;
  return updateRideRecords(
    rideId,
    cancellationRecords.estimateAtAcceptPatch({ acceptedAt: ride.accepted_at, etaMinutes: ride.driver_eta_to_pickup_minutes, existing: ride }),
    "estimate_at_accept"
  );
}

// Driver progress toward the pickup, from location updates before
// pickup. At most one record per ride every 10 seconds.
const PICKUP_PROGRESS_MIN_INTERVAL_MS = 10_000;
const pickupProgressLastAt = new Map();
async function recordPickupProgress(rideId, fix) {
  const now = Date.now();
  const last = pickupProgressLastAt.get(rideId) || 0;
  if (now - last < PICKUP_PROGRESS_MIN_INTERVAL_MS) return false;
  pickupProgressLastAt.set(rideId, now);
  if (pickupProgressLastAt.size > 5000) {
    for (const [id, at] of pickupProgressLastAt) if (now - at > 10 * 60_000) pickupProgressLastAt.delete(id);
  }
  const { data: ride, error } = await supabase
    .from("rides")
    .select("id, status, pickup_lat, pickup_lng, pickup_start_distance_m, pickup_last_distance_m")
    .eq("id", rideId)
    .maybeSingle();
  if (error || !ride) return false;
  const patch = cancellationRecords.progressPatch(ride, fix);
  return patch ? updateRideRecords(rideId, patch, "pickup_progress") : false;
}

// When the driver taps Arrived: a location sent with the tap (if any),
// else the latest fix before pickup. Recorded, never blocking.
async function recordArrivalCheck(ride, body = {}) {
  const lat = Number(body && body.latitude);
  const lng = Number(body && body.longitude);
  const sentFix =
    Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
      ? { lat, lng, accuracy: Number.isFinite(Number(body.accuracy)) ? Number(body.accuracy) : null, at: nowIso() }
      : null;
  const check = cancellationRecords.arrivalCheck(ride, { fix: sentFix });
  await updateRideRecords(ride.id, check, "arrival_check");
  return { arrival_verified: check.arrival_verified, arrival_check: check.arrival_check };
}

// After a cancellation commits: why, what the draft policy would have
// decided, and the fee shown and charged (always $0 for now).
async function recordCancellation(rideId, { category, assessment, feeShownCents }) {
  return updateRideRecords(
    rideId,
    {
      cancellation_category: category,
      cancellation_assessment: assessment,
      cancellation_fee_cents: 0,
      cancellation_fee_shown_cents: feeShownCents === undefined ? null : feeShownCents
    },
    "cancellation"
  );
}

// Shared by the rider-cancel route (and available for an admin
// incident-resolution "cancel" outcome later) -- driver *withdrawal* is
// a separate, much simpler flow below that never calls this, since it
// doesn't cancel the ride or touch payment at all.
async function handleRideCancellation({
  req,
  res,
  ride,
  actorType,
  actorId,
  reason,
  category = cancellationRecords.CANCELLATION_CATEGORY.RIDER,
  feeShownCents
}) {
  // Idempotent path: already cancelled. Resume payment reconciliation if
  // it's still pending/failed rather than silently abandoning it -- a
  // repeated cancel request must not look like success while leaving an
  // authorized PaymentIntent untouched.
  if (ride.status === RIDE_STATUS.CANCELLED) {
    const reconciled = await reconcileCancellationPayment(ride, req);

    return ok(res, {
      ride_id: ride.id,
      status: RIDE_STATUS.CANCELLED,
      cancellation_payment_status: reconciled.outcome
    });
  }

  if (!isCancellable(ride.status)) {
    if (ride.status === RIDE_STATUS.IN_PROGRESS) {
      return fail(
        res,
        "This ride is already underway and can no longer be cancelled by the rider or driver. Contact support for an incident resolution.",
        403
      );
    }

    return fail(
      res,
      `This ride cannot be cancelled from its current status (${ride.status}).`,
      409,
      { current_status: ride.status }
    );
  }

  const driverWasAssigned = hasAssignedDriver(ride.status);
  // What the draft policy would decide, from the ride as it was when
  // cancelled. A record only: the fee is always $0.
  const assessment = cancellationRecords.assessCancellation(ride, { category });

  const claim = await claimRideTransition({
    supabase,
    rideId: ride.id,
    // The exact status just validated above, not the whole CANCELLABLE_STATUSES
    // set -- avoids a TOCTOU window where a concurrent change lands the
    // ride on a different (still technically cancellable) status than the
    // one this request actually observed and reasoned about.
    fromStatuses: [ride.status],
    toStatus: RIDE_STATUS.CANCELLED,
    patch: {
      cancelled_at: nowIso(),
      cancellation_reason: reason || null,
      cancelled_by_type: actorType,
      cancelled_by_id: actorId,
      cancellation_payment_status: ride.payment_id
        ? CANCELLATION_PAYMENT_STATUS.CANCEL_PENDING
        : CANCELLATION_PAYMENT_STATUS.NOT_REQUIRED,
      updated_at: nowIso()
    }
  });

  let cancelledRide;

  if (claim.ok) {
    cancelledRide = claim.ride;
  } else if (claim.reason === "not_found") {
    return fail(res, "Ride not found.", 404);
  } else if (claim.currentStatus === RIDE_STATUS.CANCELLED) {
    // Raced with a concurrent cancel request -- resume reconciliation
    // like any other idempotent retry, not an error.
    const reconciled = await reconcileCancellationPayment(claim.ride, req);

    return ok(res, {
      ride_id: ride.id,
      status: RIDE_STATUS.CANCELLED,
      cancellation_payment_status: reconciled.outcome
    });
  } else {
    return fail(
      res,
      `This ride cannot be cancelled from its current status (${claim.currentStatus}).`,
      409,
      { current_status: claim.currentStatus }
    );
  }

  const reconciled = await reconcileCancellationPayment(cancelledRide, req);

  await recordCancellation(ride.id, { category, assessment, feeShownCents });

  // A driver who marked the no-show already knows; anyone else is told.
  if (driverWasAssigned && cancelledRide.driver_id && actorType !== "driver") {
    sendPushNotification({
      ownerType: "driver",
      ownerId: cancelledRide.driver_id,
      title: "Ride Cancelled",
      body: "This ride was cancelled and is no longer assigned to you.",
      url: "/driver.html"
    }).catch(() => {});
  }

  notifyRideStage(ride, "ride_cancelled").catch(() => {});

  broadcastRideSse(ride.id, "stage", { status: RIDE_STATUS.CANCELLED });

  auditLog({
    actor_type: actorType,
    actor_id: actorId,
    action: "ride_cancelled",
    entity_type: "ride",
    entity_id: ride.id,
    metadata: {
      reason: reason || null,
      cancellation_payment_status: reconciled.outcome,
      had_assigned_driver: driverWasAssigned,
      cancellation_category: category,
      policy_waivers: assessment.waivers,
      policy_fee_eligible: assessment.policy_fee_eligible,
      fee_cents: 0
    },
    req
  }).catch(() => {});

  return ok(res, {
    ride_id: ride.id,
    status: RIDE_STATUS.CANCELLED,
    cancellation_payment_status: reconciled.outcome,
    cancellation_category: category,
    cancellation_fee_cents: 0,
    cancellation_fee_display: "$0.00"
  });
}

/* =========================================================
   LIVE MAP TRACKING (docs/live-map-tracking.md, lib/liveLocation.js)
   Riders see their driver on a map; a rider may also share their own
   phone location with the assigned driver until pickup.
========================================================= */

// Mapbox public token for the website's maps. In the Mapbox account it is
// URL-restricted to the site. Only "pk." tokens are ever returned, so a
// secret token put here by mistake is never sent to a browser. The
// server-side MAPBOX_ACCESS_TOKEN (address search, routing) is separate
// and never leaves the server.
app.get("/api/maps/config", (req, res) => {
  const token = String(process.env.MAPBOX_PUBLIC_TOKEN || "").trim();
  const usable = token.startsWith("pk.");
  res.setHeader("Cache-Control", "public, max-age=300");
  return ok(res, { enabled: usable, token: usable ? token : null });
});

// Only the ride's rider (rider session or the rider's tracking token) may
// share or stop sharing. Anyone else gets the same 404 as a missing ride.
async function loadRideForRiderLocation(req, res) {
  const rideId = cleanString(req.params.id, 100);
  const { data: ride, error } = await supabase
    .from("rides")
    .select("id, status, rider_id, driver_id, rider_live_lat, rider_live_lng, rider_live_at")
    .eq("id", rideId)
    .maybeSingle();
  if (error || !ride) {
    fail(res, "Ride not found.", 404);
    return null;
  }
  if ((await resolveRideViewer(req, ride)) !== "rider") {
    fail(res, "Ride not found.", 404);
    return null;
  }
  return ride;
}

async function clearRiderLocation(rideId) {
  const { error } = await supabase.from("rides").update(liveLocation.RIDER_LOCATION_COLUMNS).eq("id", rideId);
  if (error) throw error;
}

app.post(
  "/api/rides/:id/rider-location",
  rateLimit({ windowMs: 60_000, max: 40, keyPrefix: "rider_location" }),
  asyncRoute(async (req, res) => {
    const ride = await loadRideForRiderLocation(req, res);
    if (!ride) return;

    if (!liveLocation.canShareRiderLocation(ride.status)) {
      if (liveLocation.shouldPurgeRiderLocation(ride)) await clearRiderLocation(ride.id);
      return fail(res, "Location sharing with your driver is only available until pickup.", 409, { sharing: false });
    }

    const parsed = liveLocation.parseLocationBody(req.body || {});
    if (!parsed.ok) return fail(res, parsed.message, 400);

    if (liveLocation.isTooSoon(ride)) return ok(res, { sharing: true, stored: false });

    // The status filter closes the race with a trip starting between the
    // read above and this write.
    const { data: updated, error } = await supabase
      .from("rides")
      .update({
        rider_live_lat: parsed.location.lat,
        rider_live_lng: parsed.location.lng,
        rider_live_accuracy_m: parsed.location.accuracy,
        rider_live_at: nowIso()
      })
      .eq("id", ride.id)
      .in("status", liveLocation.RIDER_SHARE_STATUSES)
      .select("id");
    if (error) throw error;
    if (!updated || !updated.length) {
      return fail(res, "Location sharing with your driver is only available until pickup.", 409, { sharing: false });
    }

    if (ride.driver_id) driverAppRealtime.notifyDriver(ride.driver_id, "sync", { reason: "rider_location" });
    return ok(res, { sharing: true, stored: true });
  })
);

app.delete(
  "/api/rides/:id/rider-location",
  rateLimit({ windowMs: 60_000, max: 20, keyPrefix: "rider_location_stop" }),
  asyncRoute(async (req, res) => {
    const ride = await loadRideForRiderLocation(req, res);
    if (!ride) return;
    await clearRiderLocation(ride.id);
    if (ride.driver_id) driverAppRealtime.notifyDriver(ride.driver_id, "sync", { reason: "rider_location" });
    return ok(res, { sharing: false });
  })
);

// Deletes rider positions once the ride is past pickup or the rider
// stopped sending. The driver never sees a position outside the window
// anyway (riderLocationForDriver); this makes sure it isn't kept.
async function purgeRiderLocations(nowMs = Date.now()) {
  const { data: rows, error } = await supabase
    .from("rides")
    .select("id, status, rider_live_lat, rider_live_lng, rider_live_at")
    .not("rider_live_at", "is", null)
    .limit(500);
  if (error) throw error;
  const due = (rows || []).filter((r) => liveLocation.shouldPurgeRiderLocation(r, nowMs)).map((r) => r.id);
  if (!due.length) return [];
  const { error: clearErr } = await supabase.from("rides").update(liveLocation.RIDER_LOCATION_COLUMNS).in("id", due);
  if (clearErr) throw clearErr;
  return due;
}

// Audit-log IP retention (lib/auditRetention.js): clears the IP address
// and user agent on audit rows older than 90 days; the rows stay. Off
// unless audit_ip_retention_enabled is "true"; a retention_legal_hold of
// "true" pauses it. A dry run only counts.
let auditIpRetentionRunning = false;

async function auditIpRetentionEligibleIds(cutoff, limit) {
  const ids = new Set();
  for (const column of ["ip_address", "user_agent"]) {
    const { data, error } = await supabase.from("audit_logs").select("id").lt("created_at", cutoff).not(column, "is", null).limit(limit);
    if (error) throw error;
    for (const row of data || []) ids.add(row.id);
  }
  return [...ids].slice(0, limit);
}

async function runAuditIpRetention({ mode = "live", trigger = "sweep", nowMs = Date.now() } = {}) {
  const cutoff = auditRetention.cutoffIso(nowMs);
  const gate = auditRetention.runGate({
    enabled: await getSystemFlag(auditRetention.RETENTION_FLAG, "false"),
    legalHold: await getSystemFlag(auditRetention.LEGAL_HOLD_FLAG, "false")
  });
  if (mode === "dry_run") {
    const ids = await auditIpRetentionEligibleIds(cutoff, auditRetention.BATCH_SIZE * auditRetention.MAX_BATCHES);
    return { mode, cutoff, eligible: ids.length, would_run: gate.ok, reason: gate.ok ? null : gate.reason };
  }
  if (!gate.ok) return { mode, cutoff, skipped: true, reason: gate.reason };
  if (auditIpRetentionRunning) return { mode, cutoff, skipped: true, reason: "already_running" };
  auditIpRetentionRunning = true;
  let cleared = 0;
  try {
    for (let i = 0; i < auditRetention.MAX_BATCHES; i += 1) {
      const ids = await auditIpRetentionEligibleIds(cutoff, auditRetention.BATCH_SIZE);
      if (!ids.length) break;
      const { error } = await supabase.from("audit_logs").update({ ip_address: null, user_agent: null }).in("id", ids).lt("created_at", cutoff);
      if (error) throw error;
      cleared += ids.length;
      if (ids.length < auditRetention.BATCH_SIZE) break;
    }
  } finally {
    auditIpRetentionRunning = false;
    if (cleared) await auditLog(auditRetention.runRecord({ cleared, cutoff, mode, trigger })).catch(() => {});
  }
  return { mode, cutoff, cleared };
}

// Staff: the switch states and a dry-run count. Changes nothing.
app.get(
  "/api/admin/retention/audit-ip",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const result = await runAuditIpRetention({ mode: "dry_run", trigger: "admin" });
    const { data: last } = await supabase.from("audit_logs").select("created_at, metadata").eq("action", "retention_audit_ip_cleared").order("created_at", { ascending: false }).limit(1);
    return ok(res, {
      enabled: (await getSystemFlag(auditRetention.RETENTION_FLAG, "false")) === "true",
      legal_hold: (await getSystemFlag(auditRetention.LEGAL_HOLD_FLAG, "false")) === "true",
      retention_days: auditRetention.RETENTION_DAYS,
      cutoff: result.cutoff,
      eligible: result.eligible,
      last_run: last && last[0] ? { at: last[0].created_at, cleared: last[0].metadata && last[0].metadata.cleared } : null
    });
  })
);

// Protected by requireRider UNCONDITIONALLY -- not gated behind
// rider_auth_enforced like the #97/#115/#118 route chain, because no
// existing client calls this route today, so there is no legacy
// unauthenticated behavior to preserve. This also means the route is
// currently unusable by any real rider in production: no rider-facing
// UI may call it (e.g. a "Cancel Ride" button on rider-dashboard.html
// or request-ride.html) until real rider sessions actually exist,
// which requires rider_auth_ui_enabled to be turned on and the OTP
// sign-in flow to be live-validated first -- see
// docs/security-remediation/code-blue-phase1-rider-auth-prerequisites.md.
// Wiring a cancel button into the UI before then would 401 for every
// rider, since none would have a session cookie to present.
app.post(
  "/api/rides/:id/cancel",
  requireRider,
  asyncRoute(async (req, res) => {
    const rideId = cleanString(req.params.id, 100);
    const reason = cleanString(req.body.reason, 500);

    let ride;

    try {
      ride = await getRideOrFail(rideId);
    } catch (err) {
      return fail(res, "Ride not found.", 404);
    }

    // Ownership from the authenticated session only -- never a
    // body-supplied rider_id/cancelled_by_id.
    if (String(ride.rider_id || "") !== String(req.rider.id || "")) {
      return fail(res, "You are not authorized to cancel this ride.", 403);
    }

    // The rider must have been shown the exact fee before confirming. A
    // client that sends the fee it showed is checked against the fee now;
    // a cancellation that would cost anything is refused without it.
    // Today every fee is $0, so older clients that send nothing still work.
    const preview = cancellationRecords.cancelPreview(ride);
    const shownRaw = req.body && req.body.expected_fee_cents;
    const shown = shownRaw === undefined || shownRaw === null || shownRaw === "" ? null : Number(shownRaw);
    if (shown !== null && (!Number.isInteger(shown) || shown !== preview.fee_cents)) {
      return fail(res, "The cancellation fee has changed. Please review it and confirm again.", 409, {
        code: "cancellation_fee_changed",
        fee_cents: preview.fee_cents,
        fee_display: preview.fee_display
      });
    }
    if (shown === null && preview.fee_cents > 0) {
      return fail(res, "Please review the cancellation fee before confirming.", 409, {
        code: "cancellation_fee_not_shown",
        fee_cents: preview.fee_cents,
        fee_display: preview.fee_display
      });
    }

    return handleRideCancellation({
      req,
      res,
      ride,
      actorType: "rider",
      actorId: req.rider.id,
      reason,
      feeShownCents: shown === null ? undefined : shown
    });
  })
);

// What cancelling would cost right now, shown before the rider confirms.
// Today it is always free ($0.00); the draft policy's assessment is
// recorded at cancellation, not shown here.
app.get(
  "/api/rides/:id/cancel-preview",
  requireRider,
  rateLimit({ windowMs: 60_000, max: 30, keyPrefix: "ride_cancel_preview" }),
  asyncRoute(async (req, res) => {
    const rideId = cleanString(req.params.id, 100);
    let ride;
    try {
      ride = await getRideOrFail(rideId);
    } catch (err) {
      return fail(res, "Ride not found.", 404);
    }
    if (String(ride.rider_id || "") !== String(req.rider.id || "")) {
      return fail(res, "Ride not found.", 404);
    }
    if (!isCancellable(ride.status)) {
      return ok(res, {
        ride_id: ride.id,
        cancellable: false,
        status: ride.status,
        message:
          ride.status === RIDE_STATUS.IN_PROGRESS
            ? "Your trip is already underway, so it can't be cancelled in the app. If you feel unsafe, call 911."
            : "This ride can't be cancelled now."
      });
    }
    const preview = cancellationRecords.cancelPreview(ride);
    return ok(res, {
      ride_id: ride.id,
      cancellable: true,
      status: ride.status,
      fee_cents: preview.fee_cents,
      fee_display: preview.fee_display,
      free: preview.free,
      message: preview.message
    });
  })
);

/* -------- DRIVER CONTACT ATTEMPT: the driver tried to reach the rider
   in the app (call or message). Recorded for no-show eligibility and
   support review. Never blocks the call itself. -------- */
app.post(
  "/api/driver/rides/:rideId/contact-attempt",
  requireDriver,
  rateLimit({ windowMs: 60_000, max: 20, keyPrefix: "driver_contact_attempt" }),
  asyncRoute(async (req, res) => {
    const rideId = cleanString(req.params.rideId, 100);
    const driverId = req.driver.id;
    const method = cancellationRecords.CONTACT_METHODS.includes(req.body && req.body.method) ? req.body.method : null;
    if (!method) return fail(res, "method must be call or message.", 400);
    let ride;
    try {
      ride = await getRideOrFail(rideId);
    } catch (err) {
      return fail(res, "Ride not found.", 404);
    }
    try {
      await ensureAssignedDriver(ride, driverId);
    } catch (err) {
      return fail(res, err.message || "Driver is not assigned to this ride.", 403);
    }
    if (!hasAssignedDriver(ride.status)) {
      return fail(res, "Contact attempts are recorded only before pickup.", 409, { current_status: ride.status });
    }
    const at = nowIso();
    let recorded = false;
    try {
      const { error: insertError } = await supabase
        .from("ride_contact_attempts")
        .insert({ ride_id: ride.id, driver_id: String(driverId), method, ride_status: ride.status, created_at: at });
      if (insertError) throw insertError;
      recorded = await updateRideRecords(
        ride.id,
        { contact_attempt_count: (Number(ride.contact_attempt_count) || 0) + 1, last_contact_attempt_at: at },
        "contact_attempt"
      );
    } catch (err) {
      console.warn("⚠️ Contact attempt not recorded:", err && err.message ? err.message : err);
    }
    auditLog({
      actor_type: "driver",
      actor_id: driverId,
      action: "driver_contact_attempt",
      entity_type: "ride",
      entity_id: ride.id,
      metadata: { method, ride_status: ride.status, recorded },
      req
    }).catch(() => {});
    return ok(res, { ride_id: ride.id, recorded, method, at });
  })
);

// Whether this driver may mark the rider as a no-show now, and what's
// still missing (for the driver app's timer and button).
app.get(
  "/api/driver/rides/:rideId/no-show",
  requireDriver,
  asyncRoute(async (req, res) => {
    const rideId = cleanString(req.params.rideId, 100);
    let ride;
    try {
      ride = await getRideOrFail(rideId);
    } catch (err) {
      return fail(res, "Ride not found.", 404);
    }
    try {
      await ensureAssignedDriver(ride, req.driver.id);
    } catch (err) {
      return fail(res, err.message || "Driver is not assigned to this ride.", 403);
    }
    const enabled = (await getSystemFlag("driver_no_show_enabled", "false")) === "true";
    return ok(res, { ride_id: ride.id, enabled, ...cancellationRecords.noShowEligibility(ride) });
  })
);

/* -------- DRIVER NO-SHOW: the rider didn't come out. Allowed only
   after a verified arrival, 7 minutes of waiting and a recorded contact
   attempt. Cancels the ride for free (no fee in this phase), releases
   the card hold, and records the reason. Off until
   system_flags.driver_no_show_enabled = "true". -------- */
app.post(
  "/api/driver/rides/:rideId/no-show",
  requireDriver,
  rateLimit({ windowMs: 60_000, max: 10, keyPrefix: "driver_no_show" }),
  asyncRoute(async (req, res) => {
    const rideId = cleanString(req.params.rideId, 100);
    const driverId = req.driver.id;
    if ((await getSystemFlag("driver_no_show_enabled", "false")) !== "true") {
      return fail(res, "Marking a no-show isn't available yet. Contact support if the rider doesn't come out.", 403, { code: "no_show_disabled" });
    }
    let ride;
    try {
      ride = await getRideOrFail(rideId);
    } catch (err) {
      return fail(res, "Ride not found.", 404);
    }
    try {
      await ensureAssignedDriver(ride, driverId);
    } catch (err) {
      return fail(res, err.message || "Driver is not assigned to this ride.", 403);
    }
    const eligibility = cancellationRecords.noShowEligibility(ride);
    if (!eligibility.eligible) {
      return fail(res, "A no-show can't be marked yet.", 409, { code: "no_show_not_eligible", ...eligibility });
    }
    return handleRideCancellation({
      req,
      res,
      ride,
      actorType: "driver",
      actorId: driverId,
      reason: "rider_no_show",
      category: cancellationRecords.CANCELLATION_CATEGORY.DRIVER_NO_SHOW
    });
  })
);

/* -------- DRIVER WITHDRAWAL: releases the driver, does NOT cancel the
   rider's request -- returns the ride to dispatch and redispatches
   excluding this driver. -------- */

app.post(
  "/api/driver/rides/:rideId/withdraw",
  requireDriver,
  asyncRoute(async (req, res) => {
    const rideId = cleanString(req.params.rideId, 100);
    const driverId = req.driver.id;
    const reason = cleanString(req.body.reason, 500);

    let ride;

    try {
      ride = await getRideOrFail(rideId);
    } catch (err) {
      return fail(res, "Ride not found.", 404);
    }

    try {
      await ensureAssignedDriver(ride, driverId);
    } catch (err) {
      return fail(res, err.message || "Driver is not assigned to this ride.", 403);
    }

    if (!hasAssignedDriver(ride.status)) {
      if (ride.status === RIDE_STATUS.IN_PROGRESS) {
        return fail(
          res,
          "This trip is already underway and can no longer be withdrawn from. Contact support for an incident resolution.",
          403
        );
      }

      return fail(
        res,
        `This ride cannot be withdrawn from its current status (${ride.status}).`,
        409,
        { current_status: ride.status }
      );
    }

    const claim = await claimRideTransition({
      supabase,
      rideId,
      fromStatuses: [ride.status],
      toStatus: RIDE_STATUS.AWAITING_DRIVER,
      patch: {
        // Release the driver link only -- no availability, verification,
        // or compliance state on the driver's own row is touched here.
        driver_id: null,
        driver_name: null,
        driver_phone: null,
        driver_vehicle: null,
        updated_at: nowIso()
      }
    });

    if (!claim.ok) {
      if (claim.reason === "not_found") {
        return fail(res, "Ride not found.", 404);
      }

      return fail(
        res,
        `This ride cannot be withdrawn from its current status (${claim.currentStatus}).`,
        409,
        { current_status: claim.currentStatus }
      );
    }

    // Keep the invariant "no accepted offer without a matching ride
    // assignment": the ride no longer has this driver, so their accepted
    // offer for it is withdrawn. Otherwise accept_driver_offer_atomic()
    // and dispatch_ride_atomic() would treat it as a conflicting accepted
    // offer and block this driver from any future ride. The ride release
    // above is already committed, so a failure here is surfaced for
    // reconciliation rather than reported to the driver as a failed
    // withdrawal.
    const { error: withdrawOfferError } = await supabase
      .from("driver_offers")
      .update({ status: "withdrawn", updated_at: nowIso() })
      .eq("ride_id", rideId)
      .eq("driver_id", driverId)
      .eq("status", "accepted");

    if (withdrawOfferError) {
      console.error(
        "🚨 RECONCILIATION REQUIRED: withdrawn driver's accepted offer not updated.",
        { ride_id: rideId, driver_id: driverId, reason: withdrawOfferError.message }
      );

      auditLog({
        actor_type: "system",
        action: "driver_withdraw_offer_update_failed",
        entity_type: "ride",
        entity_id: rideId,
        metadata: {
          severity: "critical",
          requires_reconciliation: true,
          driver_id: driverId,
          reason: withdrawOfferError.message
        }
      }).catch(() => {});

      broadcastSse("dispatch_reconciliation_required", {
        ride_id: rideId,
        reason: "driver_withdraw_offer_update_failed"
      });
    }

    auditLog({
      actor_type: "driver",
      actor_id: driverId,
      action: "driver_withdrew",
      entity_type: "ride",
      entity_id: rideId,
      metadata: { reason: reason || null, withdrawn_from_status: ride.status },
      req
    }).catch(() => {});

    notifyRideStage(claim.ride, "driver_reassigning").catch(() => {});

    broadcastRideSse(rideId, "stage", { status: RIDE_STATUS.AWAITING_DRIVER });

    // Redispatch immediately, excluding this driver (dispatchRide()
    // already excludes any driver with a prior driver_offers row for
    // this ride, which this withdrawing driver has).
    dispatchRide(claim.ride).catch((err) => {
      console.error("❌ Redispatch after driver withdrawal failed:", err.message);
    });

    return ok(res, {
      ride_id: rideId,
      status: RIDE_STATUS.AWAITING_DRIVER
    });
  })
);

/* =========================================================

   RIDER-SCOPED HISTORY API

   Canonical replacement for /api/rider/history, /api/rides/status,
   and /api/delivery/status — three endpoints rider-dashboard.html
   has called since it was built, none of which have ever existed
   server-side. The dashboard's Activity tab has been silently empty
   this whole time (it degrades gracefully, so nothing looked broken).

   Gated behind the "rider_history_enabled" system flag, defaulted
   off (see riderHistoryEnabled() and the enable/disable admin routes
   near PAUSE/RESUME DISPATCH) — until real rider authentication
   exists, this is unauthenticated-identity data. See the IMPORTANT
   note below before turning it on.

   Every route here requires riderId and filters/checks rows against
   it server-side — unlike /api/rides/:id/status above, which is
   intentionally public-by-unguessable-ID for the in-flight tracking
   view. That's an improvement over trusting ID obscurity alone: a
   ride ID leaked or guessed some other way can't be used to pull a
   different rider's history through THIS api as long as their real
   riderId isn't also known.

   IMPORTANT — this is consistency-checking, not authentication.
   riderId is a client-supplied parameter, not derived from any
   session/token/cookie — because no rider authentication exists
   anywhere in this codebase (unlike admin's JWT session or driver's
   SMS-verified token). These routes verify "does this ride's stored
   rider_id match the riderId the caller claims," which stops a stray
   or malformed ID from returning someone else's rows, but it does NOT
   stop a caller who has actually obtained/guessed a real riderId from
   reading that rider's full history. Closing that gap for real would
   mean building rider authentication (most naturally an SMS-OTP
   session, mirroring the existing driver token pattern) across the
   whole app, not just these three routes — out of scope here, but
   don't describe this API as "ownership-verified" in the sense of
   proven identity; it isn't, yet.

========================================================= */

// Curated column list — deliberately not select("*"). The rides table
// carries a lot of internal/operational columns (admin_note,
// pricing_snapshot, dispatch internals, etc.) that have no business
// reaching a rider-facing response.
const RIDER_HISTORY_COLUMNS =
  "id, rider_id, status, ride_type, requested_mode, service_type, " +
  "pickup_address, dropoff_address, " +
  "driver_name, driver_vehicle, driver_phone, " +
  "estimated_fare, final_fare, tip_amount, " +
  "scheduled_time, created_at, updated_at, completed_at, cancelled_at, " +
  "delivery_stage, delivery_pin, merchant_name, item_count, " +
  "pickup_instructions, delivery_instructions, delivered_at, delivery_proof_url, " +
  // Lets the rider's own history label App Review rides as simulated.
  "is_review_ride";

// "Active" vs "completed" here means "still open" vs "finished" — a
// cancelled or failed ride counts as finished/historical, same as a
// successfully completed one. This is a different grouping than the
// ACTIVE_STATUSES used elsewhere for "a driver is actively working this
// ride right now" (that one excludes payment_required/payment_authorized,
// which are still very much "active" from the rider's point of view).
const RIDER_HISTORY_TERMINAL_STATUSES = [
  RIDE_STATUS.COMPLETED,
  RIDE_STATUS.CANCELLED,
  RIDE_STATUS.FAILED
];

async function riderHistoryEnabled() {
  return (await getSystemFlag("rider_history_enabled", "false")) === "true";
}

// Returns null (having already written the response) when riderId is
// missing or the feature is disabled, so callers must check for that
// before using the result — never { rows, next_cursor } and a sent
// response at the same time.
//
// P0 remediation PR 2b: req.rider is only ever set when
// requireRiderIfEnforced actually ran requireRider (rider_auth_enforced
// on) -- while it's off, this falls through to the pre-PR-2b,
// client-supplied riderId exactly as before, the still-open P0-1 finding.
async function listRiderRequests(req, res, { deliveryOnly }) {
  if (!(await riderHistoryEnabled())) {
    fail(res, "Rider history is not yet available.", 403);
    return null;
  }

  const riderId = resolveEnforcedRiderId({
    authenticatedRiderId: req.rider?.id,
    clientSuppliedRiderId: cleanString(req.query.riderId || req.query.rider_id, 100)
  });

  if (!riderId) {
    fail(res, "riderId is required.", 400);
    return null;
  }

  const status = cleanString(req.query.status, 20).toLowerCase();
  const limit = getPageLimit(req, 25, 100);
  const cursor = decodeCursor(req.query.cursor);

  let query = supabase
    .from("rides")
    .select(RIDER_HISTORY_COLUMNS)
    .eq("rider_id", riderId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit);

  // `ride_type NOT IN (...)` alone would silently drop legacy rows where
  // ride_type is NULL — SQL's three-valued logic means a NULL comparison
  // is never TRUE, so it can't satisfy a plain NOT IN filter either way.
  // Those older rows predate the food/grocery feature, so they're
  // unambiguously plain rides, not deliveries — include them explicitly
  // rather than let them vanish from the rider's own ride list.
  query = deliveryOnly
    ? query.in("ride_type", ["food", "grocery"])
    : query.or("ride_type.is.null,ride_type.not.in.(food,grocery)");

  if (status === "active") {
    query = query.not(
      "status",
      "in",
      `(${RIDER_HISTORY_TERMINAL_STATUSES.join(",")})`
    );
  } else if (status === "completed") {
    query = query.in("status", RIDER_HISTORY_TERMINAL_STATUSES);
  }

  query = applyCursor(query, cursor);

  const { data, error } = await query;

  if (error) {
    throw error;
  }

  const rows = data || [];

  const next_cursor =
    rows.length === limit
      ? encodeCursor(rows[rows.length - 1])
      : null;

  return { rows, next_cursor };
}

app.get(
  "/api/rider/rides",
  requireRiderIfEnforced,
  asyncRoute(async (req, res) => {
    const result = await listRiderRequests(req, res, { deliveryOnly: false });

    if (!result) return;

    return ok(res, { rides: result.rows, next_cursor: result.next_cursor });
  })
);

app.get(
  "/api/rider/deliveries",
  requireRiderIfEnforced,
  asyncRoute(async (req, res) => {
    const result = await listRiderRequests(req, res, { deliveryOnly: true });

    if (!result) return;

    return ok(res, { deliveries: result.rows, next_cursor: result.next_cursor });
  })
);

app.get(
  "/api/rider/rides/:rideId",
  requireRiderIfEnforced,
  asyncRoute(async (req, res) => {
    if (!(await riderHistoryEnabled())) {
      return fail(res, "Rider history is not yet available.", 403);
    }

    const rideId = cleanString(req.params.rideId, 100);

    const riderId = resolveEnforcedRiderId({
      authenticatedRiderId: req.rider?.id,
      clientSuppliedRiderId: cleanString(req.query.riderId || req.query.rider_id, 100)
    });

    if (!riderId) {
      return fail(res, "riderId is required.", 400);
    }

    const { data: ride, error } = await supabase
      .from("rides")
      .select(RIDER_HISTORY_COLUMNS)
      .eq("id", rideId)
      .maybeSingle();

    if (error) {
      throw error;
    }

    // Same 404 whether the ride doesn't exist or its rider_id doesn't
    // match riderId — never confirm a ride ID exists to a caller who
    // doesn't own it. Once rider_auth_enforced is on, riderId here is the
    // authenticated session's own id (see resolveEnforcedRiderId above),
    // so this becomes a real ownership check, not just self-consistency
    // against whatever the client claimed.
    if (!ride || ride.rider_id !== riderId) {
      return fail(res, "Ride not found.", 404);
    }

    return ok(res, { ride });
  })
);

/* =========================================================

   ADDRESS SEARCH AND ROUTING (Mapbox, server-side)

   The browser never receives the Mapbox token: it calls these
   routes and gets back only labels, coordinates and route
   distance/duration. All are public (ordinary riders book
   without a session) and rate-limited per IP, because each
   call is billed by Mapbox.

   Errors are deliberately plain: 503 geo_not_configured /
   geo_unavailable (provider down, token rejected, timeout),
   404 address_not_found, 422 no_route, 400 for bad input.
   Logs carry the category and HTTP status only.

========================================================= */

const GEO_WARNING_INTERVAL_MS = 10 * 60_000;
const lastGeoWarningAt = new Map();

// At most one warning per category every 10 minutes. Never logs the
// request URL (it contains the token) or the provider's response body.
function warnGeoProblem(category, status, now = Date.now()) {
  if (now - (lastGeoWarningAt.get(category) || 0) < GEO_WARNING_INTERVAL_MS) {
    return false;
  }
  lastGeoWarningAt.set(category, now);
  if (category === GEO_ERROR.NOT_CONFIGURED) {
    console.warn("⚠️ Address search requested but MAPBOX_ACCESS_TOKEN is not set; lookups and route estimates are unavailable.");
  } else if (status === 401 || status === 403) {
    console.warn(
      `⚠️ Mapbox rejected a request (HTTP ${status}). Check that MAPBOX_ACCESS_TOKEN is valid and allowed to use ` +
        "Geocoding and Directions; permanent geocoding also requires a credit card on the Mapbox account."
    );
  } else {
    console.warn(`⚠️ Mapbox request failed (${category}${status ? `, HTTP ${status}` : ""}).`);
  }
  return true;
}

function sendGeoFailure(res, outcome) {
  if (outcome.error === GEO_ERROR.NOT_FOUND) {
    return fail(res, "We couldn't find that address. Check it or pick a suggestion.", 404, { code: "address_not_found" });
  }
  if (outcome.error === GEO_ERROR.NO_ROUTE) {
    return fail(res, "There is no driving route between these addresses.", 422, { code: "no_route" });
  }
  warnGeoProblem(outcome.error, outcome.status);
  return fail(res, GEO_UNAVAILABLE_MESSAGE, 503, {
    code: outcome.error === GEO_ERROR.NOT_CONFIGURED ? "geo_not_configured" : "geo_unavailable"
  });
}

function parseCoord(value) {
  if (!value || typeof value !== "object") return null;
  const lat = Number(value.lat);
  const lng = Number(value.lng);
  return isFiniteCoord(lat, lng) ? { lat, lng } : null;
}

function cleanGeoQuery(value) {
  const q = cleanString(value, 200);
  return q.length >= 3 ? q : "";
}

// Whether address search is configured. Boolean only.
app.get(
  "/api/geo/status",
  rateLimit({ windowMs: 60_000, max: 60, keyPrefix: "geo_status" }),
  asyncRoute(async (req, res) => ok(res, { configured: GEO_CONFIG.configured }))
);

// Suggestions while typing. Temporary results: shown, never stored.
app.get(
  "/api/geo/suggest",
  rateLimit({ windowMs: 60_000, max: 60, keyPrefix: "geo_suggest" }),
  asyncRoute(async (req, res) => {
    const q = cleanGeoQuery(req.query.q);
    if (!q) {
      return fail(res, "Type at least 3 characters.", 400, { code: "invalid_query" });
    }
    const near = parseCoord({ lat: req.query.lat, lng: req.query.lng });
    const outcome = await geoClient.suggest(q, { near });
    if (!outcome.ok) return sendGeoFailure(res, outcome);
    return ok(res, { results: outcome.results });
  })
);

// The address a ride is booked with (permanent result, may be stored).
app.post(
  "/api/geo/resolve",
  rateLimit({ windowMs: 60_000, max: 20, keyPrefix: "geo_resolve" }),
  asyncRoute(async (req, res) => {
    const q = cleanGeoQuery(req.body?.query);
    if (!q) {
      return fail(res, "Enter an address of at least 3 characters.", 400, { code: "invalid_query" });
    }
    const outcome = await geoClient.resolve(q, { near: parseCoord(req.body?.near) });
    if (!outcome.ok) return sendGeoFailure(res, outcome);
    return ok(res, { place: outcome.place });
  })
);

// "Use my location": street address for device coordinates.
app.post(
  "/api/geo/reverse",
  rateLimit({ windowMs: 60_000, max: 20, keyPrefix: "geo_reverse" }),
  asyncRoute(async (req, res) => {
    const point = parseCoord(req.body);
    if (!point) {
      return fail(res, "Valid coordinates are required.", 400, { code: "invalid_coordinates" });
    }
    const outcome = await geoClient.reverse(point.lat, point.lng);
    if (!outcome.ok) return sendGeoFailure(res, outcome);
    return ok(res, { place: outcome.place });
  })
);

// Driving distance and duration between two points.
app.post(
  "/api/geo/route",
  rateLimit({ windowMs: 60_000, max: 20, keyPrefix: "geo_route" }),
  asyncRoute(async (req, res) => {
    const from = parseCoord(req.body?.from);
    const to = parseCoord(req.body?.to);
    if (!from || !to) {
      return fail(res, "Valid pickup and destination coordinates are required.", 400, { code: "invalid_coordinates" });
    }
    const outcome = await geoClient.route(from, to);
    if (!outcome.ok) return sendGeoFailure(res, outcome);
    return ok(res, {
      distance_miles: outcome.distance_miles,
      duration_minutes: outcome.duration_minutes
    });
  })
);

/* =========================================================

   STRIPE PUBLISHABLE KEY

   Serves the Stripe publishable key from an env var instead of
   a hardcoded value
   in a static HTML file. request-ride.html uses this to load
   Stripe.js and collect real card details before authorizing a
   ride's payment. Returns an empty key (never an error) when
   unconfigured, so the page can show a graceful "payments not
   available" state instead of a broken card form.

========================================================= */

app.get(
  "/api/stripe-key",
  rateLimit({ windowMs: 60_000, max: 60, keyPrefix: "stripe_key" }),
  asyncRoute(async (req, res) => {
    return ok(res, { key: STRIPE_PUBLISHABLE_KEY || "" });
  })
);

/* =========================================================

   WEB PUSH — VAPID KEY + SUBSCRIBE/UNSUBSCRIBE

   The VAPID public key is not secret (it's embedded in every
   subscribe call the browser makes to the push service), so
   it's served the same way as the Maps key: from an env var,
   never hardcoded into a committed file.

========================================================= */

app.get(
  "/api/push/vapid-public-key",
  rateLimit({ windowMs: 60_000, max: 60, keyPrefix: "push_vapid_key" }),
  asyncRoute(async (req, res) => {
    return ok(res, { key: pushEnabled ? VAPID_PUBLIC_KEY : "" });
  })
);

app.post(
  "/api/push/subscribe",
  rateLimit({ windowMs: 60_000, max: 20, keyPrefix: "push_subscribe" }),
  asyncRoute(async (req, res) => {
    if (!pushEnabled) {
      return fail(res, "Push notifications are not configured yet.", 503);
    }

    const ownerType = cleanString(req.body.owner_type, 20);
    const subscription = req.body.subscription;

    if (!["rider", "driver"].includes(ownerType)) {
      return fail(res, "A valid owner_type (rider or driver) is required.", 400);
    }

    const endpoint = cleanString(subscription?.endpoint, 500);
    const p256dh = cleanString(subscription?.keys?.p256dh, 200);
    const auth = cleanString(subscription?.keys?.auth, 200);

    if (!endpoint || !p256dh || !auth) {
      return fail(res, "A valid push subscription is required.", 400);
    }

    // Security fix (owner decision 2026-10-18): the subscription is tied
    // to the signed-in rider or driver, never to a client-supplied
    // owner_id, so nobody can subscribe a browser to someone else's ride
    // or offer notifications.
    const save = async (ownerId) => {
      const { error } = await supabase
        .from("push_subscriptions")
        .upsert(
          {
            id: makeId("PUSH"),
            owner_type: ownerType,
            owner_id: ownerId,
            endpoint,
            p256dh,
            auth,
            user_agent: cleanString(req.headers["user-agent"], 300) || null,
            last_used_at: nowIso()
          },
          { onConflict: "endpoint" }
        );

      if (error) {
        throw error;
      }

      return ok(res, { subscribed: true });
    };

    if (ownerType === "rider") {
      const rider = (await resolveAuthenticatedReviewRider(req)) || (await resolveVerifiedRiderSession(req));
      if (!rider?.id) {
        return fail(res, "Please sign in to turn on ride notifications.", 401);
      }
      return save(rider.id);
    }

    // Drivers: the signed-in driver only (no admin override).
    return requireDriverSelf(req, res, () => save(req.driver.id));
  })
);

app.post(
  "/api/push/unsubscribe",
  rateLimit({ windowMs: 60_000, max: 20, keyPrefix: "push_unsubscribe" }),
  asyncRoute(async (req, res) => {
    const endpoint = cleanString(req.body.endpoint, 500);

    if (!endpoint) {
      return fail(res, "endpoint is required.", 400);
    }

    await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint);

    return ok(res, { unsubscribed: true });
  })
);

/* =========================================================

   PUBLIC MISSION CONTROL SNAPSHOT

   Small, non-sensitive aggregate counts (no PII, no per-user
   data) for rider-facing "live platform status" UI: online
   driver count and average ETA across active rides. Public
   by design, same trust tier as /api/foundation/status/:code.

========================================================= */

app.get(
  "/api/public/mission-control",
  rateLimit({ windowMs: 60_000, max: 60, keyPrefix: "mission_control" }),
  asyncRoute(async (req, res) => {
    const ACTIVE_STATUSES = [
      RIDE_STATUS.AWAITING_DRIVER,
      RIDE_STATUS.DRIVER_ASSIGNED,
      RIDE_STATUS.DRIVER_ENROUTE,
      RIDE_STATUS.ARRIVED,
      RIDE_STATUS.IN_PROGRESS
    ];

    // Google Play reviewer-account exclusion (approved requirement):
    // the review driver/rides must never count toward a public totals
    // endpoint as genuine traffic.
    const [driversOnline, activeRidesResult] = await Promise.all([
      countWhere("drivers", (q) => q.eq("online", true).eq("is_review_account", false)),
      supabase
        .from("rides")
        .select("driver_eta_to_pickup_minutes")
        .in("status", ACTIVE_STATUSES)
        .eq("is_review_ride", false)
    ]);

    const activeRides = activeRidesResult.data || [];
    let etaSum = 0;
    let etaCount = 0;

    for (const ride of activeRides) {
      const eta = Number(ride.driver_eta_to_pickup_minutes);
      if (Number.isFinite(eta) && eta > 0) {
        etaSum += eta;
        etaCount++;
      }
    }

    return ok(res, {
      online_drivers: driversOnline.count,
      avg_wait_minutes:
        etaCount > 0 ? Math.round((etaSum / etaCount) * 10) / 10 : null,
      generated_at: nowIso()
    });
  })
);

/* =========================================================

   RIDER-SCOPED SAVED PLACES

   Quick-launch destinations (Home, Work, custom) for the rider
   dashboard. P0 remediation PR 2b: while rider_auth_enforced is off
   (the default), riderId is client-supplied exactly as before -- the
   still-open P0-1 finding. Once enabled, riderId comes exclusively
   from the authenticated session (see resolveEnforcedRiderId in
   lib/riderAuth.js) and the client-supplied value is ignored outright.

========================================================= */

app.get(
  "/api/rider/saved-places",
  requireRiderIfEnforced,
  rateLimit({ windowMs: 60_000, max: 60, keyPrefix: "saved_places_list" }),
  asyncRoute(async (req, res) => {
    const riderId = resolveEnforcedRiderId({
      authenticatedRiderId: req.rider?.id,
      clientSuppliedRiderId: cleanString(req.query.riderId || req.query.rider_id, 100)
    });

    if (!riderId) {
      return fail(res, "riderId is required.", 400);
    }

    const { data, error } = await supabase
      .from("saved_places")
      .select("id, label, address, lat, lng, icon, created_at")
      .eq("rider_id", riderId)
      .order("created_at", { ascending: true });

    if (error) {
      throw error;
    }

    return ok(res, { places: data || [] });
  })
);

app.post(
  "/api/rider/saved-places",
  requireRiderIfEnforced,
  rateLimit({ windowMs: 60_000, max: 20, keyPrefix: "saved_places_create" }),
  asyncRoute(async (req, res) => {
    const riderId = resolveEnforcedRiderId({
      authenticatedRiderId: req.rider?.id,
      clientSuppliedRiderId: cleanString(req.body.riderId || req.body.rider_id, 100)
    });
    const label = cleanString(req.body.label, 60);
    const address = cleanString(req.body.address, 300);
    const icon = cleanString(req.body.icon, 8) || "📍";
    const lat = Number(req.body.lat);
    const lng = Number(req.body.lng);

    if (!riderId || !label || !address) {
      return fail(res, "riderId, label, and address are required.", 400);
    }

    const place = {
      id: makeId("PLACE"),
      rider_id: riderId,
      label,
      address,
      lat: Number.isFinite(lat) ? lat : null,
      lng: Number.isFinite(lng) ? lng : null,
      icon,
      created_at: nowIso(),
      updated_at: nowIso()
    };

    const { error } = await supabase.from("saved_places").insert(place);

    if (error) {
      throw error;
    }

    return ok(res, { place }, 201);
  })
);

app.delete(
  "/api/rider/saved-places/:id",
  requireRiderIfEnforced,
  rateLimit({ windowMs: 60_000, max: 20, keyPrefix: "saved_places_delete" }),
  asyncRoute(async (req, res) => {
    const id = cleanString(req.params.id, 100);
    const riderId = resolveEnforcedRiderId({
      authenticatedRiderId: req.rider?.id,
      clientSuppliedRiderId: cleanString(req.query.riderId || req.query.rider_id, 100)
    });

    if (!id || !riderId) {
      return fail(res, "riderId is required.", 400);
    }

    // Same 404-either-way ownership check as /api/rider/rides/:rideId —
    // never confirm a place ID exists to a caller who doesn't own it.
    // Once rider_auth_enforced is on, riderId here is the authenticated
    // session's own id, so this becomes a real ownership check.
    const { data: existing } = await supabase
      .from("saved_places")
      .select("id, rider_id")
      .eq("id", id)
      .maybeSingle();

    if (!existing || existing.rider_id !== riderId) {
      return fail(res, "Saved place not found.", 404);
    }

    const { error } = await supabase.from("saved_places").delete().eq("id", id);

    if (error) {
      throw error;
    }

    return ok(res, { deleted: true });
  })
);

/* =========================================================

   HTAF APPLICATION STATUS — AUTHENTICATED RIDER SELF-LOOKUP

   Replaces the former public GET /api/foundation/applications/by-email
   (docs/security-remediation/htaf-admin-pii-audit.md, finding 3):
   that route took an arbitrary ?email= query param with no
   authentication at all, so anyone on the internet could check whether
   a given email address had ever submitted a charity transportation-
   assistance application -- an enumeration/privacy risk independent of
   which fields the response contained, since the existence fact itself
   is sensitive. An email address is not a secret, unlike the
   high-entropy application_code /api/foundation/status/:code requires
   the caller to already possess.

   This route requires a verified rider session (requireRider) and uses
   ONLY req.rider.email -- the server's own record of who is logged in
   -- never a client-supplied email. A rider can therefore only ever
   look up their own application, never anyone else's; there is no
   longer any public surface where an arbitrary email can be tested.
   See resolveRiderHtafLookup() in lib/htafOperations.js for the
   (tested) guarantee that no request-supplied value can stand in for
   the session's own identity.

========================================================= */

app.get(
  "/api/rider/htaf-application",
  requireRider,
  asyncRoute(async (req, res) => {
    const lookup = resolveRiderHtafLookup(req.rider);

    if (!lookup.ok) {
      return fail(res, lookup.error, lookup.statusCode);
    }

    if (!lookup.email) {
      return ok(res, { application: null });
    }

    const { data, error } = await supabase
      .from("htaf_applications")
      .select("application_code, status, program_type, created_at, updated_at")
      .ilike("email", lookup.email)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw error;
    }

    return ok(res, { application: data || null });
  })
);

/* =========================================================

   PART 7 — DRIVER OFFERS + DRIVER MISSION PIPELINE

========================================================= */

/* =========================================================

   DRIVER OFFER ACCEPT

========================================================= */

// Outcome -> HTTP mapping for accept_driver_offer_atomic() (see the
// 20260927220400 migration). Losing outcomes carry no ride data at all.
const ACCEPT_OFFER_FAILURE_RESPONSES = {
  offer_not_found: [404, "Offer not found."],
  not_offer_owner: [403, "Offer does not belong to this driver."],
  offer_expired: [409, "This offer has expired."],
  offer_not_pending: [409, "This offer is no longer available. It may have already been responded to."],
  ride_not_assignable: [409, "This ride is no longer available."],
  driver_unavailable: [409, "You can't accept this offer right now."]
};

app.post(

  "/api/driver/offers/:offerId/accept",

  requireDriverSelf,

  asyncRoute(async (req, res) => {

    const offerId =

      cleanString(

        req.params.offerId,

        100

      );

    // Always the identity requireDriver verified (the signed driver session,
    // or requireDriver's own admin-authenticated ops override) -- never
    // read from req.body here.
    const driverId = req.driver.id;

    // Verification is re-checked at acceptance too: an offer made before a
    // check changed must not become an assignment. The offer is left to
    // expire, which redispatches the ride the usual way.
    const { data: verification, error: verificationError } = await supabase
      .from("drivers")
      .select(DRIVER_READINESS_COLUMNS)
      .eq("id", driverId)
      .maybeSingle();

    if (verificationError) {
      console.error("❌ Offer accept: driver verification check failed:", { offer_id: offerId, reason: verificationError.message });
      return fail(res, "Could not accept this offer. Please try again.", 500);
    }

    if (!verification || !driverVerificationReady(verification)) {
      return fail(res, "You can't accept offers until your verification is complete.", 403, { code: "verification_required" });
    }

    // One transaction in the database: ride, offer and driver locks,
    // ownership/state/expiry/eligibility checks, then the offer accept,
    // competing-offer supersede and rides.driver_id assignment commit
    // together or not at all. There is no multi-step flow to compensate.
    const { data, error } = await supabase.rpc("accept_driver_offer_atomic", {
      p_offer_id: offerId,
      p_driver_id: driverId
    });

    if (error) {

      console.error(
        "❌ Offer accept: accept_driver_offer_atomic failed:",
        { offer_id: offerId, reason: error.message }
      );

      return fail(res, "Could not accept this offer. Please try again.", 500);

    }

    const result = Array.isArray(data) ? data[0] : data;
    const outcome = result && result.outcome;

    if (outcome !== "accepted" && outcome !== "already_accepted") {

      const failure = ACCEPT_OFFER_FAILURE_RESPONSES[outcome];

      if (!failure) {

        console.error(
          "❌ Offer accept: unexpected accept_driver_offer_atomic outcome:",
          { offer_id: offerId, outcome: outcome || null }
        );

        return fail(res, "Could not accept this offer. Please try again.", 500);

      }

      return fail(res, failure[1], failure[0]);

    }

    // Notify only for the call that actually committed the assignment. An
    // idempotent retry (already_accepted) returns the same success body
    // without a second rider notification, SSE event or audit entry.
    //
    // The RPC returns an allow-listed row (never the full rides row); the
    // rider-contact fields below are used server-side for the notification
    // only and never appear in the HTTP response.
    if (outcome === "accepted") {
      recordPickupEstimateAtAccept(result.ride_id).catch(() => {});

      const driverFields = {
        driver_name: result.driver_name,
        driver_vehicle: result.driver_vehicle,
        driver_phone: result.driver_phone
      };

      notifyRideStage(
        {
          id: result.ride_id,
          rider_id: result.rider_id,
          rider_phone: result.rider_phone,
          ride_type: result.ride_type,
          is_review_ride: result.is_review_ride,
          ...driverFields
        },
        "driver_assigned"
      ).catch(() => {});

      broadcastRideSse(result.ride_id, "stage", {

        status: RIDE_STATUS.DRIVER_ASSIGNED,

        driver: driverFields

      });

      auditLog({

        actor_type:

          "driver",

        actor_id:

          driverId,

        action:

          "ride_offer_accepted",

        entity_type:

          "ride",

        entity_id:

          result.ride_id,

        metadata: {

          offer_id:

            offerId

        },

        req

      }).catch(() => {});

    }

    return ok(res, {

      ride_id:

        result.ride_id,

      driver_id:

        driverId,

      status:

        RIDE_STATUS.DRIVER_ASSIGNED,

      ...(outcome === "already_accepted" ? { idempotent_replay: true } : {})

    });

  })

);

/* =========================================================

   DRIVER OFFER DECLINE

========================================================= */

app.post(

  "/api/driver/offers/:offerId/decline",

  requireDriverSelf,

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

        .maybeSingle();

    if (error) {

      console.error("❌ Offer decline: offer lookup failed:", offerId, error.message);

      return fail(res, "Could not decline this offer. Please try again.", 500);

    }

    if (!offer) {

      return fail(

        res,

        "Offer not found.",

        404

      );

    }

    // Same ownership rule as accept: only the driver the offer was sent to
    // (per the authenticated requireDriver identity, never the request
    // body) may decline it.
    if (offer.driver_id !== req.driver.id) {

      return fail(

        res,

        "Offer does not belong to this driver.",

        403

      );

    }

    // Atomic conditional update — same pattern and reasoning as the accept
    // route above. If the offer_expiry_sweep already claimed this offer as
    // expired (or a duplicate decline request beat this one to it) in the
    // gap between the read above and this write, updatedOffer comes back
    // null. That means whoever DID win the claim is already responsible
    // for redispatching this ride, so this request must not also
    // redispatch it — doing so would offer the ride to two drivers at
    // once from two different code paths.
    const { data: updatedOffer, error: offerUpdateError } =
      await supabase
        .from("driver_offers")
        .update({
          status: "declined",
          decline_reason: reason,
          responded_at: nowIso(),
          updated_at: nowIso()
        })
        .eq("id", offerId)
        .eq("status", "pending")
        .select()
        .maybeSingle();

    if (offerUpdateError) {
      console.error(
        "❌ Offer decline: driver_offers update failed:",
        offerId,
        offerUpdateError.message
      );

      return fail(res, "Could not decline this offer. Please try again.", 500);
    }

    if (!updatedOffer) {
      return fail(
        res,
        "This offer was already resolved (expired or already responded to).",
        409
      );
    }

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

      const { data: ride, error: rideLoadError } =

        await supabase

          .from("rides")

          .select("*")

          .eq("id", offer.ride_id)

          .maybeSingle();

      if (rideLoadError) {

        console.error(
          "❌ Offer decline: could not load ride for redispatch:",
          offer.ride_id,
          rideLoadError.message
        );

        return fail(res, "Offer declined, but the ride could not be redispatched.", 500);

      }

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

          const { error: redispatchUpdateError } = await supabase

            .from("rides")

            .update({

              dispatch_attempts:

                attempts + 1,

              dispatch_status:

                "redispatching",

              // Stamped so runStuckRedispatchRecovery() (server.js, near
              // startup) can recover this ride if the dispatchRide() call
              // below throws or the process dies before it finishes —
              // see lib/offerExpiry.js's sweepStuckRedispatches().
              dispatch_claimed_at:

                nowIso(),

              updated_at:

                nowIso()

            })

            .eq("id", ride.id);

          if (redispatchUpdateError) {

            console.error(
              "❌ Offer decline: ride redispatch update failed:",
              ride.id,
              redispatchUpdateError.message
            );

            return fail(res, "Offer declined, but the ride could not be redispatched.", 500);

          }

          await dispatchRide({

            ...ride,

            dispatch_attempts:

              attempts + 1

          });

        } else {

          const { error: maxAttemptsUpdateError } = await supabase

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

          if (maxAttemptsUpdateError) {

            console.error(
              "❌ Offer decline: ride max-attempts update failed:",
              ride.id,
              maxAttemptsUpdateError.message
            );

            return fail(res, "Offer declined, but the ride status could not be updated.", 500);

          }
          releaseFailedRidePayment(ride.id, req).catch(() => {});
          notifyRideStage(ride, "no_drivers_available").catch(() => {});

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

// Shared by every simple, single-status-forward driver transition route
// (enroute, arrived, start -- complete is handled separately, since it
// also has to run the recoverable payment-capture/earnings workflow).
// Centralizes the actual status write through claimRideTransition() (see
// lib/rideLifecycle.js) instead of each route doing its own unconditional
// `.update({status: X})` -- before this, none of these routes checked
// the ride's current status at all, only "is this the assigned driver,"
// so a stray or duplicate call could move a completed/failed ride
// backward, or silently re-apply a transition that already happened.
async function performDriverRideTransition({
  req,
  res,
  rideId,
  driverId,
  fromStatus,
  toStatus,
  timestampField,
  deliveryStage,
  notifyStageKey,
  notifyStageKeyDelivery,
  auditAction,
  // Optional, best effort: runs after the transition commits (for example
  // the arrival check), and its result is added to the response.
  afterTransition = null
}) {
  let ride;

  try {
    ride = await getRideOrFail(rideId);
  } catch (err) {
    return fail(res, "Ride not found.", 404);
  }

  try {
    await ensureAssignedDriver(ride, driverId);
  } catch (err) {
    return fail(res, err.message || "Driver is not assigned to this ride.", 403);
  }

  const isDelivery = isDeliveryRideType(ride.ride_type);

  const patch = {
    [timestampField]: nowIso(),
    updated_at: nowIso(),
    ...(isDelivery && deliveryStage ? { delivery_stage: deliveryStage } : {})
  };

  const claim = await claimRideTransition({
    supabase,
    rideId,
    fromStatuses: [fromStatus],
    toStatus,
    patch
  });

  if (!claim.ok) {
    if (claim.reason === "not_found") {
      return fail(res, "Ride not found.", 404);
    }

    auditLog({
      actor_type: "driver",
      actor_id: driverId,
      action: `${auditAction}_rejected`,
      entity_type: "ride",
      entity_id: rideId,
      metadata: { attempted_from: fromStatus, attempted_to: toStatus, actual_status: claim.currentStatus },
      req
    }).catch(() => {});

    return fail(
      res,
      `This ride can't move to that stage from its current status (${claim.currentStatus}).`,
      409,
      { current_status: claim.currentStatus }
    );
  }

  notifyRideStage(ride, isDelivery ? notifyStageKeyDelivery : notifyStageKey).catch(() => {});

  broadcastRideSse(rideId, "stage", {
    status: toStatus,
    delivery_stage: isDelivery && deliveryStage ? deliveryStage : null
  });

  auditLog({
    actor_type: "driver",
    actor_id: driverId,
    action: auditAction,
    entity_type: "ride",
    entity_id: rideId,
    req
  }).catch(() => {});

  const extra = afterTransition ? await afterTransition(ride).catch(() => null) : null;

  return ok(res, {
    ride_id: rideId,
    status: toStatus,
    ...(extra || {})
  });
}

/* =========================================================

   DRIVER ENROUTE

========================================================= */

app.post(

  "/api/driver/rides/:rideId/enroute",

  requireDriver,

  asyncRoute(async (req, res) => {

    const rideId =

      cleanString(

        req.params.rideId,

        100

      );

    const driverId = req.driver.id;

    return performDriverRideTransition({
      req,
      res,
      rideId,
      driverId,
      fromStatus: RIDE_STATUS.DRIVER_ASSIGNED,
      toStatus: RIDE_STATUS.DRIVER_ENROUTE,
      timestampField: "enroute_at",
      deliveryStage: DELIVERY_STAGE.ENROUTE_STORE,
      notifyStageKey: "enroute_pickup",
      notifyStageKeyDelivery: "enroute_store",
      auditAction: "driver_enroute"
    });

  })

);

/* =========================================================

   DRIVER ARRIVED

========================================================= */

app.post(

  "/api/driver/rides/:rideId/arrived",

  requireDriver,

  asyncRoute(async (req, res) => {

    const rideId =

      cleanString(

        req.params.rideId,

        100

      );

    const driverId = req.driver.id;

    return performDriverRideTransition({
      req,
      res,
      rideId,
      driverId,
      fromStatus: RIDE_STATUS.DRIVER_ENROUTE,
      toStatus: RIDE_STATUS.ARRIVED,
      timestampField: "arrived_at",
      deliveryStage: DELIVERY_STAGE.ARRIVED_STORE,
      notifyStageKey: "arrived_pickup",
      notifyStageKeyDelivery: "arrived_store",
      auditAction: "driver_arrived",
      // Records whether the driver was at the pickup (never blocks arrival).
      afterTransition: (ride) => recordArrivalCheck(ride, req.body)
    });

  })

);

/* =========================================================

   DRIVER WAITING FOR ORDER (delivery only)

========================================================= */

app.post(

  "/api/driver/rides/:rideId/waiting-for-order",

  requireDriver,

  asyncRoute(async (req, res) => {

    const rideId =

      cleanString(

        req.params.rideId,

        100

      );

    const driverId = req.driver.id;

    const ride =

      await getRideOrFail(rideId);

    await ensureAssignedDriver(

      ride,

      driverId

    );

    if (!isDeliveryRideType(ride.ride_type)) {

      return fail(

        res,

        "This action is only available for delivery orders.",

        400

      );

    }

    await supabase

      .from("rides")

      .update({

        delivery_stage:

          DELIVERY_STAGE.WAITING_FOR_ORDER,

        updated_at:

          nowIso()

      })

      .eq("id", rideId);

    broadcastRideSse(rideId, "stage", {

      delivery_stage: DELIVERY_STAGE.WAITING_FOR_ORDER

    });

    auditLog({

      actor_type:

        "driver",

      actor_id:

        driverId,

      action:

        "driver_waiting_for_order",

      entity_type:

        "ride",

      entity_id:

        rideId,

      req

    }).catch(() => {});

    return ok(res, {

      ride_id:

        rideId,

      delivery_stage:

        DELIVERY_STAGE.WAITING_FOR_ORDER

    });

  })

);

/* =========================================================

   DRIVER START RIDE

========================================================= */

app.post(

  "/api/driver/rides/:rideId/start",

  requireDriver,

  asyncRoute(async (req, res) => {

    const rideId =

      cleanString(

        req.params.rideId,

        100

      );

    const driverId = req.driver.id;

    // Step 3c-3: an order's trip starts only once the store has it ready.
    const order = await orderForRide(rideId);
    if (order && order.status !== "ready" && order.status !== "picked_up") {
      return fail(res, "The store hasn't marked this order ready yet. Wait at the store until they do.", 409, { order_status: order.status });
    }

    if (order && order.status === "ready") {
      await performDriverRideTransition({
        req,
        res,
        rideId,
        driverId,
        fromStatus: RIDE_STATUS.ARRIVED,
        toStatus: RIDE_STATUS.IN_PROGRESS,
        timestampField: "trip_started_at",
        deliveryStage: DELIVERY_STAGE.PICKED_UP,
        notifyStageKey: "ride_started",
        notifyStageKeyDelivery: "picked_up",
        auditAction: "ride_started"
      });
      if (res.statusCode < 300) await moveOrder(order, "picked_up", { kind: "system", id: "driver_pickup" }, { req });
      return res;
    }

    return performDriverRideTransition({
      req,
      res,
      rideId,
      driverId,
      fromStatus: RIDE_STATUS.ARRIVED,
      toStatus: RIDE_STATUS.IN_PROGRESS,
      timestampField: "trip_started_at",
      deliveryStage: DELIVERY_STAGE.PICKED_UP,
      notifyStageKey: "ride_started",
      notifyStageKeyDelivery: "picked_up",
      auditAction: "ride_started"
    });

  })

);

/* =========================================================

   DRIVER ENROUTE TO CUSTOMER (delivery only)

========================================================= */

app.post(

  "/api/driver/rides/:rideId/enroute-customer",

  requireDriver,

  asyncRoute(async (req, res) => {

    const rideId =

      cleanString(

        req.params.rideId,

        100

      );

    const driverId = req.driver.id;

    const ride =

      await getRideOrFail(rideId);

    await ensureAssignedDriver(

      ride,

      driverId

    );

    if (!isDeliveryRideType(ride.ride_type)) {

      return fail(

        res,

        "This action is only available for delivery orders.",

        400

      );

    }

    await supabase

      .from("rides")

      .update({

        delivery_stage:

          DELIVERY_STAGE.ENROUTE_CUSTOMER,

        updated_at:

          nowIso()

      })

      .eq("id", rideId);

    notifyRideStage(ride, "enroute_customer").catch(() => {});

    broadcastRideSse(rideId, "stage", {

      delivery_stage: DELIVERY_STAGE.ENROUTE_CUSTOMER

    });

    auditLog({

      actor_type:

        "driver",

      actor_id:

        driverId,

      action:

        "driver_enroute_customer",

      entity_type:

        "ride",

      entity_id:

        rideId,

      req

    }).catch(() => {});

    return ok(res, {

      ride_id:

        rideId,

      delivery_stage:

        DELIVERY_STAGE.ENROUTE_CUSTOMER

    });

  })

);

/* =========================================================

   DRIVER ARRIVED AT CUSTOMER (delivery only)

========================================================= */

app.post(

  "/api/driver/rides/:rideId/arrived-customer",

  requireDriver,

  asyncRoute(async (req, res) => {

    const rideId =

      cleanString(

        req.params.rideId,

        100

      );

    const driverId = req.driver.id;

    const ride =

      await getRideOrFail(rideId);

    await ensureAssignedDriver(

      ride,

      driverId

    );

    if (!isDeliveryRideType(ride.ride_type)) {

      return fail(

        res,

        "This action is only available for delivery orders.",

        400

      );

    }

    await supabase

      .from("rides")

      .update({

        delivery_stage:

          DELIVERY_STAGE.ARRIVED_CUSTOMER,

        updated_at:

          nowIso()

      })

      .eq("id", rideId);

    notifyRideStage(ride, "arrived_customer").catch(() => {});

    broadcastRideSse(rideId, "stage", {

      delivery_stage: DELIVERY_STAGE.ARRIVED_CUSTOMER

    });

    auditLog({

      actor_type:

        "driver",

      actor_id:

        driverId,

      action:

        "driver_arrived_customer",

      entity_type:

        "ride",

      entity_id:

        rideId,

      req

    }).catch(() => {});

    return ok(res, {

      ride_id:

        rideId,

      delivery_stage:

        DELIVERY_STAGE.ARRIVED_CUSTOMER

    });

  })

);

/* =========================================================

   PAYMENT CAPTURE

========================================================= */

// Recoverable payment-capture workflow (see lib/ridePaymentCapture.js for
// the decision logic and idempotency-key derivation). Replaces the old
// captureRidePayment(), which ran Stripe's capture with no idempotency
// key and returned only a bare PaymentIntent-or-null -- a crash between
// Stripe responding and the caller recording that fact was
// unrecoverable, and there was nowhere durable a failure was ever
// recorded (console.error only).
//
// Persists payment_status BEFORE calling Stripe (capture_pending, with
// the idempotency key) and again after (captured/capture_failed) --
// this is what makes a retry after an unknown-outcome crash safe: it
// resumes from capture_pending using the SAME key, and Stripe returns
// the original result instead of creating a second capture. Returns the
// ride row as last persisted (not the pre-call snapshot), so the
// caller always has current state regardless of which branch ran.
async function captureRidePaymentIdempotent(ride, req = null, { forceRetry = false } = {}) {
  const decision = decideCaptureAction({
    ride,
    stripeConfigured: Boolean(ENABLE_PAYMENT_GATE && stripe),
    forceRetry
  });

  if (decision.action === "skip") {
    return { outcome: ride.payment_status, ride, paymentIntent: null };
  }

  if (decision.action === "not_required") {
    const { data, error } = await supabase
      .from("rides")
      .update({
        payment_status: CAPTURE_STATUS.NOT_REQUIRED,
        updated_at: nowIso()
      })
      .eq("id", ride.id)
      .select()
      .maybeSingle();

    if (error) {
      console.error("❌ Failed to persist not_required payment_status:", error.message);
    }

    return { outcome: CAPTURE_STATUS.NOT_REQUIRED, ride: data || ride, paymentIntent: null };
  }

  const idempotencyKey = captureIdempotencyKey(ride.id);

  const { error: pendingError } = await supabase
    .from("rides")
    .update({
      payment_status: CAPTURE_STATUS.CAPTURE_PENDING,
      payment_capture_idempotency_key: idempotencyKey,
      payment_capture_attempted_at: nowIso(),
      updated_at: nowIso()
    })
    .eq("id", ride.id);

  if (pendingError) {
    // Could not durably record that a capture attempt is starting --
    // do not proceed to call Stripe without that marker in place, since
    // a crash right after an unrecorded call would be unrecoverable.
    console.error("❌ Failed to persist capture_pending before Stripe call:", pendingError.message);
    return { outcome: CAPTURE_STATUS.CAPTURE_PENDING, ride, paymentIntent: null, error: pendingError.message };
  }

  let paymentIntent = null;
  let captureError = null;

  try {
    paymentIntent = await stripe.paymentIntents.capture(
      ride.payment_id,
      {},
      { idempotencyKey }
    );
  } catch (error) {
    captureError = error.message || String(error);

    console.error(
      "❌ Payment capture failed:",
      captureError
    );
  }

  const finalStatus = paymentIntent ? CAPTURE_STATUS.CAPTURED : CAPTURE_STATUS.CAPTURE_FAILED;

  const { data: updatedRide, error: finalError } = await supabase
    .from("rides")
    .update({
      payment_status: finalStatus,
      payment_captured: Boolean(paymentIntent),
      payment_capture_error: captureError,
      updated_at: nowIso()
    })
    .eq("id", ride.id)
    .select()
    .maybeSingle();

  if (finalError) {
    console.error("❌ Failed to persist final capture status:", finalError.message);
  }

  if (!paymentIntent) {
    // The persisted payment_status='capture_failed' above (queryable via
    // GET /api/admin/rides?payment_status=capture_failed) is the durable,
    // admin-readable record of this failure -- this audit entry is a
    // secondary, best-effort trail, not the only place the failure is
    // recorded.
    auditLog({
      actor_type: "system",
      action: "ride_payment_capture_failed",
      entity_type: "ride",
      entity_id: ride.id,
      metadata: { error: captureError, idempotency_key: idempotencyKey },
      req
    }).catch(() => {});
  }

  return { outcome: finalStatus, ride: updatedRide || ride, paymentIntent };
}

/* =========================================================

   DRIVER EARNING

========================================================= */

// Idempotent: safe to call on every /complete attempt (first call or a
// retry/resume after a crash), backed by the driver_earnings_ride_id_unique
// constraint (see the driver-earnings-unique migration). A ride can never
// end up with two earnings rows: a second insert attempt for the same
// ride_id hits that constraint and this function returns the row that
// already exists instead of erroring or creating a duplicate.
async function upsertDriverEarningIdempotent({
  ride,
  driverId
}) {
  const driverBaseEarning =
    Number(
      ride.driver_payout || 0
    );

  // Tips are 100% the driver's — folded into total_earning here (at
  // completion) rather than into driver_payout (computed pre-trip by
  // calculateRideEstimate), since a percentage split should never apply
  // to a tip.
  // A tip chosen at booking plus any tip paid during the trip
  // (lib/rideTips.js); a failed lookup falls back to the booking tip.
  let tipAmount =
    Number(
      ride.tip_amount || 0
    );
  try {
    tipAmount = rideTips.totalTipDollars(ride, await paidTipsForRide(ride.id));
  } catch (tipErr) {
    console.error("❌ Tip lookup for earning failed:", ride.id, logErrorCode(tipErr));
  }

  const totalEarning =
    Math.round((driverBaseEarning + tipAmount) * 100) / 100;

  // Fleet trip (docs/fleet-management-plan.md): record the fleet, the
  // vehicle and the owner's agreed share of the fare earning (never the
  // tip). Recorded only; no money moves. The assignment can't change
  // during a trip. A failed lookup never blocks the driver's earning.
  let fleetFields = {};
  try {
    const assignment = await openAssignmentForDriver(driverId);
    if (assignment) {
      const { data: membership, error: membershipError } = await supabase.from("fleet_memberships").select("fleet_id, owner_share_pct").eq("id", assignment.membership_id).maybeSingle();
      if (membershipError) throw membershipError;
      if (membership) {
        const pct = Number(membership.owner_share_pct) || 0;
        fleetFields = {
          fleet_id: membership.fleet_id,
          fleet_vehicle_id: assignment.vehicle_id,
          fleet_owner_share_pct: pct,
          fleet_owner_share_amount: fleetRules.ownerShareAmount(driverBaseEarning, pct)
        };
      }
    }
  } catch (fleetErr) {
    if (!fleetTableMissing(fleetErr)) console.error("❌ Fleet earning lookup failed:", ride.id, fleetErr && fleetErr.message);
  }

  const earning = {

    id:

      makeId("EARN"),

    ride_id:

      ride.id,

    driver_id:

      driverId,

    rider_id:

      ride.rider_id || null,

    gross_fare:

      Number(ride.estimated_fare || 0),

    driver_base_earning:

      driverBaseEarning,

    tip_amount:

      tipAmount,

    total_earning:

      totalEarning,

    payout_amount:

      totalEarning,

    currency:

      "USD",

    status:

      "earned",

    earning_status:

      "earned",

    payment_id:

      ride.payment_id || null,

    created_at:

      nowIso(),

    ...fleetFields

  };

  const { data: inserted, error } =

    await supabase

      .from("driver_earnings")

      .insert(earning)

      .select()

      .maybeSingle();

  if (!error) {

    return inserted || earning;

  }

  // 23505 = unique_violation. A controlled lookup by ride_id confirms
  // this really was the expected idempotent-retry case (rather than
  // trusting the error string alone) before treating it as success.
  if (error.code === "23505") {

    const { data: existing, error: lookupError } =

      await supabase

        .from("driver_earnings")

        .select("*")

        .eq("ride_id", ride.id)

        .maybeSingle();

    if (!lookupError && existing) {

      return existing;

    }

  }

  console.error(

    "❌ Driver earning insert failed:",

    error.message

  );

  throw error;

}

/* =========================================================

   DRIVER COMPLETE RIDE

========================================================= */

app.post(

  "/api/driver/rides/:rideId/complete",

  requireDriver,

  asyncRoute(async (req, res) => {

    const rideId =

      cleanString(

        req.params.rideId,

        100

      );

    const driverId = req.driver.id;

    let ride;

    try {
      ride = await getRideOrFail(rideId);
    } catch (err) {
      return fail(res, "Ride not found.", 404);
    }

    try {
      await ensureAssignedDriver(ride, driverId);
    } catch (err) {
      return fail(res, err.message || "Driver is not assigned to this ride.", 403);
    }

    let deliveryProofUrl = null;

    if (isDeliveryRideType(ride.ride_type)) {

      if (ride.delivery_handoff === "leave_at_door") {

        const decoded = decodeBase64Image(req.body.delivery_photo);

        if (!decoded) {

          return fail(

            res,

            "A delivery photo is required to confirm a leave-at-door delivery.",

            400

          );

        }

        if (decoded.buffer.length > DRIVER_PHOTO_MAX_BYTES) {

          return fail(

            res,

            "Delivery photo is too large. Maximum size is 5MB.",

            400

          );

        }

        const proofPath = `${rideId}.${decoded.extension}`;

        const { error: proofUploadError } =

          await supabase.storage

            .from("delivery-proof-photos")

            .upload(proofPath, decoded.buffer, {

              contentType: decoded.mimeType,

              upsert: true

            });

        if (proofUploadError) {

          console.error(

            "❌ Delivery proof photo upload failed:",

            proofUploadError.message

          );

          return fail(

            res,

            "Photo upload failed. Please try again.",

            502

          );

        }

        const { data: proofPublicUrlData } =

          supabase.storage

            .from("delivery-proof-photos")

            .getPublicUrl(proofPath);

        deliveryProofUrl = `${proofPublicUrlData.publicUrl}?v=${Date.now()}`;

      } else {

        const suppliedPin =

          cleanString(

            req.body.delivery_pin,

            10

          );

        if (

          !suppliedPin ||

          !ride.delivery_pin ||

          suppliedPin !== ride.delivery_pin

        ) {

          return fail(

            res,

            "Incorrect delivery PIN. Ask the customer for their delivery PIN.",

            400

          );

        }

      }

    }

    // Step 1: atomically claim trip-completion, OR -- on a retry/resume
    // that finds the ride already completed -- fall through to resume
    // the remaining steps rather than short-circuiting. "Already
    // completed" is never treated as proof that capture and earnings
    // also finished; see lib/ridePaymentCapture.js.
    let completedRide;

    if (ride.status === RIDE_STATUS.IN_PROGRESS) {

      const claim = await claimRideTransition({
        supabase,
        rideId,
        fromStatuses: [RIDE_STATUS.IN_PROGRESS],
        toStatus: RIDE_STATUS.COMPLETED,
        patch: {
          completed_at: nowIso(),
          ...(isDeliveryRideType(ride.ride_type)
            ? {
                delivery_stage: DELIVERY_STAGE.DELIVERED,
                delivered_at: nowIso(),
                ...(deliveryProofUrl ? { delivery_proof_url: deliveryProofUrl } : {})
              }
            : {})
        }
      });

      if (claim.ok) {
        completedRide = claim.ride;
      } else if (claim.reason === "not_found") {
        return fail(res, "Ride not found.", 404);
      } else if (claim.currentStatus === RIDE_STATUS.COMPLETED) {
        // Lost the claim to a concurrent request that completed the
        // trip a moment ago -- resume from there like any other retry.
        completedRide = claim.ride;
      } else {
        auditLog({
          actor_type: "driver",
          actor_id: driverId,
          action: "ride_completed_rejected",
          entity_type: "ride",
          entity_id: rideId,
          metadata: { actual_status: claim.currentStatus },
          req
        }).catch(() => {});

        return fail(
          res,
          `Ride cannot be completed from its current status (${claim.currentStatus}).`,
          409,
          { current_status: claim.currentStatus }
        );
      }

    } else if (ride.status === RIDE_STATUS.COMPLETED) {
      completedRide = ride;
    } else {
      return fail(
        res,
        `Ride cannot be completed from its current status (${ride.status}).`,
        409,
        { current_status: ride.status }
      );
    }

    // Step 2: resume/attempt payment capture. Idempotent -- safe whether
    // this is a true first pass or a resumed retry after any crash
    // boundary (before capture, mid-capture, or after capture but before
    // the result was recorded).
    const captureResult =

      await captureRidePaymentIdempotent(completedRide, req);

    // Step 3: idempotent earnings upsert, unconditional on the capture
    // outcome -- the driver did the work regardless of whether Harvey's
    // own Stripe capture succeeded; a capture failure is a business/ops
    // problem to reconcile separately (see the admin capture-failure
    // queue), not something that should withhold the driver's own
    // earning record.
    const earning =

      await upsertDriverEarningIdempotent({

        ride: captureResult.ride,

        driverId

      });

    const completeIsDelivery = isDeliveryRideType(ride.ride_type);

    // Step 3c-3: an order's handoff delivers it and charges the card.
    // Never fails the driver's completion.
    let orderResult = null;
    if (completeIsDelivery) {
      try {
        orderResult = await completeOrderForRide(captureResult.ride || completedRide, req);
      } catch (err) {
        console.error("❌ order completion failed:", rideId, err.message);
      }
    }

    notifyRideStage(

      ride,

      completeIsDelivery ? "delivered" : "ride_completed"

    ).catch(() => {});

    broadcastRideSse(rideId, "stage", {

      status: RIDE_STATUS.COMPLETED,

      delivery_stage: completeIsDelivery ? DELIVERY_STAGE.DELIVERED : null

    });

    auditLog({

      actor_type:

        "driver",

      actor_id:

        driverId,

      action:

        "ride_completed",

      entity_type:

        "ride",

      entity_id:

        rideId,

      metadata: {

        earning,

        payment_status:

          captureResult.outcome

      },

      req

    }).catch(() => {});

    return ok(res, {

      ride_id:

        rideId,

      status:

        RIDE_STATUS.COMPLETED,

      earning,

      payment_status:

        captureResult.outcome,

      payment_captured:

        captureResult.outcome === CAPTURE_STATUS.CAPTURED,

      ...(orderResult ? { order: orderResult } : {})

    });

  })

);

/* =========================================================

   DRIVER LOCATION

========================================================= */

const LOCATION_UPDATE_MIN_INTERVAL_MS = 5000;

const lastLocationUpdateAt = new Map(); // driverId -> ms timestamp

app.post(

  "/api/driver/location",

  requireDriver,

  asyncRoute(async (req, res) => {

    const driverId = req.driver.id;

    const lat = Number(req.body.latitude);

    const lng = Number(req.body.longitude);

    if (

      !Number.isFinite(lat) ||

      !Number.isFinite(lng) ||

      lat < -90 || lat > 90 ||

      lng < -180 || lng > 180

    ) {

      return fail(

        res,

        "A valid latitude/longitude is required.",

        400

      );

    }

    const nowMs = Date.now();

    const lastUpdateMs = lastLocationUpdateAt.get(driverId) || 0;

    if (nowMs - lastUpdateMs < LOCATION_UPDATE_MIN_INTERVAL_MS) {

      return ok(res, { updated: false, throttled: true });

    }

    lastLocationUpdateAt.set(driverId, nowMs);

    const { data: activeRide } = await supabase

      .from("rides")

      .select("id, status, pickup_lat, pickup_lng")

      .eq("driver_id", driverId)

      .in("status", [

        RIDE_STATUS.DRIVER_ASSIGNED,

        RIDE_STATUS.DRIVER_ENROUTE,

        RIDE_STATUS.ARRIVED,

        RIDE_STATUS.IN_PROGRESS

      ])

      .order("updated_at", { ascending: false })

      .limit(1)

      .maybeSingle();

    if (!activeRide) {

      // Online with no trip: store the position so dispatch
      // (nearest_drivers, via the drivers.geog trigger) offers rides
      // from where the driver actually is. Offline with no trip is still
      // refused: nothing should be tracking then.
      if (driverAppLocationPolicy({ driver: req.driver, activeRide: null }) === "online_idle") {
        const idleAccuracy = Number(req.body.accuracy);
        await supabase
          .from("drivers")
          .update({
            current_lat: lat,
            current_lng: lng,
            heading: Number(req.body.heading || 0),
            speed: Number(req.body.speed || 0),
            location_accuracy_meters: Number.isFinite(idleAccuracy) ? idleAccuracy : null,
            last_location_at: nowIso(),
            last_seen_at: nowIso(),
            updated_at: nowIso()
          })
          .eq("id", driverId);
        return ok(res, { updated: true, tracking_ride_id: null, mode: "online_idle" });
      }

      return fail(

        res,

        "No active mission to track location for.",

        409

      );

    }

    const rawAccuracy = Number(req.body.accuracy);

    const accuracy = Number.isFinite(rawAccuracy) ? rawAccuracy : null;

    const heading = Number(req.body.heading || 0);

    const speed = Number(req.body.speed || 0);

    await supabase

      .from("drivers")

      .update({

        current_lat: lat,

        current_lng: lng,

        heading,

        speed,

        location_accuracy_meters: accuracy,

        last_seen_at: nowIso(),

        updated_at: nowIso()

      })

      .eq("id", driverId);

    // "Eligible" location update, per the ETA-persistence plan: still in the
    // pre-pickup phase (rides.driver_eta_to_pickup_minutes/
    // driver_distance_to_pickup_miles mean exactly that — eta *to pickup*).
    // Once in_progress (already picked up), those columns stop applying;
    // the existing transient tracking estimate in GET /api/rides/:id/status
    // already covers the dropoff-bound phase and is untouched here.
    // Fire-and-forget: never delays this GPS-update response.
    if (
      activeRide.status === RIDE_STATUS.DRIVER_ASSIGNED ||
      activeRide.status === RIDE_STATUS.DRIVER_ENROUTE ||
      activeRide.status === RIDE_STATUS.ARRIVED
    ) {
      persistPickupEtaBestEffort({
        rideId: activeRide.id,
        driverLat: lat,
        driverLng: lng,
        pickupLat: activeRide.pickup_lat,
        pickupLng: activeRide.pickup_lng
      }).catch(() => {});

      recordPickupProgress(activeRide.id, { lat, lng, accuracy, at: nowIso() }).catch(() => {});
    }

    broadcastRideSse(activeRide.id, "location", {

      lat,

      lng,

      heading,

      speed,

      accuracy_meters: accuracy,

      last_seen_at: nowIso()

    });

    return ok(res, {

      updated: true,

      tracking_ride_id: activeRide.id

    });

  })

);

/* =========================================================

   DRIVER PHOTO UPLOAD

   Accepts a base64 data URL, uploads it to the public
   driver-photos storage bucket, and stores the public URL on
   the driver row so it can be shown to riders during a trip.

========================================================= */

const DRIVER_PHOTO_MAX_BYTES = 5 * 1024 * 1024;

const IMAGE_MIME_EXTENSIONS = {

  "image/jpeg": "jpg",

  "image/png": "png",

  "image/webp": "webp"

};

function decodeBase64Image(dataUrl) {

  const match = String(dataUrl || "").match(

    /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/

  );

  if (!match) return null;

  const [, mimeType, base64Data] = match;

  return {

    mimeType,

    extension: IMAGE_MIME_EXTENSIONS[mimeType],

    buffer: Buffer.from(base64Data, "base64")

  };

}

app.post(

  "/api/driver/photo",

  requireDriver,

  asyncRoute(async (req, res) => {

    const dataUrl = String(req.body.photo || req.body.image || "");

    const decoded = decodeBase64Image(dataUrl);

    if (!decoded) {

      return fail(

        res,

        "Photo must be a base64 data URL (image/jpeg, image/png, or image/webp).",

        400

      );

    }

    const { mimeType, buffer } = decoded;

    if (buffer.length > DRIVER_PHOTO_MAX_BYTES) {

      return fail(

        res,

        "Photo is too large. Maximum size is 5MB.",

        400

      );

    }

    const path = `${req.driver.id}.${decoded.extension}`;

    const { error: uploadError } =

      await supabase.storage

        .from("driver-photos")

        .upload(path, buffer, {

          contentType: mimeType,

          upsert: true

        });

    if (uploadError) {

      console.error(

        "❌ Driver photo upload failed:",

        uploadError.message

      );

      return fail(

        res,

        "Photo upload failed. Please try again.",

        502

      );

    }

    const { data: publicUrlData } =

      supabase.storage

        .from("driver-photos")

        .getPublicUrl(path);

    // Cache-bust so riders immediately see a re-uploaded photo instead
    // of a stale cached copy at the same stable URL.
    const photoUrl =

      `${publicUrlData.publicUrl}?v=${Date.now()}`;

    const { error: updateError } =

      await supabase

        .from("drivers")

        .update({

          photo_url: photoUrl,

          updated_at: nowIso()

        })

        .eq("id", req.driver.id);

    if (updateError) {

      return fail(

        res,

        "Photo uploaded but saving to profile failed.",

        500

      );

    }

    auditLog({

      actor_type: "driver",

      actor_id: req.driver.id,

      action: "driver_photo_uploaded",

      entity_type: "driver",

      entity_id: req.driver.id,

      req

    }).catch(() => {});

    return ok(res, {

      photo_url: photoUrl

    });

  })

);

/* =========================================================

   RIDER PHOTO UPLOAD

   Same shape as the driver photo route above, uploaded to the
   rider-photos bucket instead, so a driver can identify their
   rider on arrival the same way a rider can already identify
   their driver. P0 remediation PR 2b: while rider_auth_enforced is
   off (the default), riderId is client-supplied exactly as before --
   the still-open P0-1 finding. Once enabled, riderId comes
   exclusively from the authenticated session (see
   resolveEnforcedRiderId in lib/riderAuth.js) and the client-supplied
   value is ignored outright -- a rider can then only ever overwrite
   their own photo, never another rider's.

========================================================= */

app.post(
  "/api/rider/photo",
  requireRiderIfEnforced,
  asyncRoute(async (req, res) => {
    const riderId = resolveEnforcedRiderId({
      authenticatedRiderId: req.rider?.id,
      clientSuppliedRiderId: cleanString(req.body.riderId || req.body.rider_id, 100)
    });

    if (!riderId) {
      return fail(res, "riderId is required.", 400);
    }

    const dataUrl = String(req.body.photo || req.body.image || "");
    const decoded = decodeBase64Image(dataUrl);

    if (!decoded) {
      return fail(
        res,
        "Photo must be a base64 data URL (image/jpeg, image/png, or image/webp).",
        400
      );
    }

    const { mimeType, buffer } = decoded;

    if (buffer.length > DRIVER_PHOTO_MAX_BYTES) {
      return fail(res, "Photo is too large. Maximum size is 5MB.", 400);
    }

    const path = `${riderId}.${decoded.extension}`;

    const { error: uploadError } = await supabase.storage
      .from("rider-photos")
      .upload(path, buffer, { contentType: mimeType, upsert: true });

    if (uploadError) {
      console.error("❌ Rider photo upload failed:", uploadError.message);
      return fail(res, "Photo upload failed. Please try again.", 502);
    }

    const { data: publicUrlData } = supabase.storage
      .from("rider-photos")
      .getPublicUrl(path);

    const photoUrl = `${publicUrlData.publicUrl}?v=${Date.now()}`;

    const { error: updateError } = await supabase
      .from("riders")
      .update({ photo_url: photoUrl, updated_at: nowIso() })
      .eq("id", riderId);

    if (updateError) {
      return fail(res, "Photo uploaded but saving to profile failed.", 500);
    }

    auditLog({
      actor_type: "rider",
      actor_id: riderId,
      action: "rider_photo_uploaded",
      entity_type: "rider",
      entity_id: riderId,
      req
    }).catch(() => {});

    return ok(res, { photo_url: photoUrl });
  })
);

/* =========================================================

   DRIVER ONLINE/OFFLINE

========================================================= */

app.post(

  "/api/driver/status",

  requireDriver,

  asyncRoute(async (req, res) => {

    const driverId = req.driver.id;

    if (!driverId) {

      return fail(

        res,

        "driver_id required.",

        400

      );

    }

    const parsedOnline =

      parseDriverOnlineRequest(req.body.online);

    if (!parsedOnline.ok) {

      return fail(

        res,

        parsedOnline.error,

        400

      );

    }

    const online =

      parsedOnline.online;

    // Going online is a safety-relevant transition: a driver must not be
    // able to force it via a direct API call regardless of what the
    // dashboard displays, so readiness is re-checked against the live
    // driver record here rather than trusted from the client. Going
    // offline carries no such risk and must always be allowed —
    // evaluateDriverStatusChange() only runs the readiness check when
    // requestedOnline is true.
    if (online) {

      const { data: driver, error: driverError } =

        await supabase

          .from("drivers")

          .select("*")

          .eq("id", driverId)

          .single();

      if (driverError || !driver) {

        return fail(

          res,

          "Driver not found.",

          404

        );

      }

      const { allowed, checks } =

        evaluateDriverStatusChange({

          driver,

          requestedOnline:

            online,

          enablePersona:

            ENABLE_PERSONA,

          enableCheckr:

            ENABLE_CHECKR

        });

      if (!allowed) {

        return fail(

          res,

          "You cannot go online until verification is complete.",

          403,

          { checks }

        );

      }

      // Fleet vehicle (docs/fleet-management-plan.md): a driver assigned a
      // fleet vehicle can go online only while that vehicle is active and
      // its insurance and registration are staff-verified and unexpired.
      // Checked whenever an assignment exists, whatever the fleet switch
      // says. Fails closed, except before the fleet tables exist.
      {
        let assignment = null;
        try {
          assignment = await openAssignmentForDriver(driverId);
        } catch (fleetErr) {
          if (!fleetTableMissing(fleetErr)) {
            console.error("❌ Fleet vehicle check failed:", driverId, fleetErr && fleetErr.message);
            return fail(res, "We couldn't check your fleet vehicle. Please try again in a moment.", 503);
          }
        }
        if (assignment) {
          let vehicleReady = { ok: false, reasons: ["vehicle_unreadable"] };
          try {
            const { data: vehicle, error: vehicleError } = await supabase.from("fleet_vehicles").select("*").eq("id", assignment.vehicle_id).maybeSingle();
            if (vehicleError) throw vehicleError;
            vehicleReady = fleetRules.vehicleDispatchable(vehicle, await currentVehicleDocuments([assignment.vehicle_id]));
          } catch (fleetErr) {
            console.error("❌ Fleet vehicle check failed:", driverId, fleetErr && fleetErr.message);
            return fail(res, "We couldn't check your fleet vehicle. Please try again in a moment.", 503);
          }
          if (!vehicleReady.ok) {
            return fail(res, "Your fleet vehicle can't carry riders right now. Ask the fleet owner to update its documents with Harvey Taxi.", 409, {
              code: "fleet_vehicle_not_ready",
              reasons: vehicleReady.reasons
            });
          }
        }
      }

      // Hours limit: up to 12 hours online per shift, then 6 hours of
      // rest (lib/driverHours.js). Checked here, the only route that
      // takes a driver online. Fails closed: if the hours can't be read,
      // the driver can't go online.
      if (driver.is_review_account !== true) {
        let shift;
        try {
          shift = await loadDriverShift(driverId);
        } catch (hoursErr) {
          console.error("❌ Driver hours check failed:", driverId, hoursErr && hoursErr.message);
          return fail(res, "We couldn't check your driving hours. Please try again in a moment.", 503);
        }
        if (!shift.can_go_online) {
          return fail(res, driverHours.restMessage(shift), 409, {
            code: "rest_required",
            rest_until: shift.rest_until,
            hours: driverHours.hoursForApp(shift)
          });
        }
      }

    }

    const { error: updateError } =

      await supabase

        .from("drivers")

        .update({

          online,

          last_seen_at:

            nowIso(),

          updated_at:

            nowIso()

        })

        .eq("id", driverId);

    if (updateError) {

      throw updateError;

    }

    auditLog({

      actor_type:

        "driver",

      actor_id:

        driverId,

      action:

        online

          ? "driver_online"

          : "driver_offline",

      req

    }).catch(() => {});

    return ok(res, {

      online

    });

  })

);

/* =========================================================

   DRIVER ACTIVE MISSIONS

========================================================= */

// The recipient's delivery PIN is the rider's to give at handoff; the
// driver types it in (it is checked server-side) and must never receive it.
function withoutRecipientPin(row) {
  if (!row || typeof row !== "object") return row;
  const { delivery_pin: _pin, ...rest } = row;
  return rest;
}

app.get(

  "/api/driver/:driverId/missions",

  requireDriver,

  asyncRoute(async (req, res) => {

    const driverId = req.driver.id;

    const { data, error } =

      await supabase

        .from("rides")

        .select("*")

        .eq("driver_id", driverId)

        .in("status", [

          RIDE_STATUS.DRIVER_ASSIGNED,

          RIDE_STATUS.DRIVER_ENROUTE,

          RIDE_STATUS.ARRIVED,

          RIDE_STATUS.IN_PROGRESS

        ])

        .order("created_at", {

          ascending: false

        });

    if (error) {

      throw error;

    }

    return ok(res, {

      missions:

        (data || []).map(withoutRecipientPin)

    });

  })

);

/* =========================================================

   DRIVER HISTORY

========================================================= */

app.get(

  "/api/driver/:driverId/history",

  requireDriver,

  asyncRoute(async (req, res) => {

    const driverId = req.driver.id;

    const { data, error } =

      await supabase

        .from("rides")

        .select("*")

        .eq("driver_id", driverId)

        .eq("status", RIDE_STATUS.COMPLETED)

        .order("completed_at", {

          ascending: false

        })

        .limit(100);

    if (error) {

      throw error;

    }

    return ok(res, {

      history:

        (data || []).map(withoutRecipientPin)

    });

  })

);

/* =========================================================

   DRIVER EARNINGS

========================================================= */

app.get(

  "/api/driver/:driverId/earnings",

  requireDriver,

  asyncRoute(async (req, res) => {

    const driverId = req.driver.id;

    const { data, error } =

      await supabase

        .from("driver_earnings")

        .select("*")

        .eq("driver_id", driverId);

    if (error) {

      throw error;

    }

    const total =

      (data || []).reduce(

        (sum, item) =>

          // total_earning is the real column (driver_base_earning + tip);
          // net_amount doesn't exist on this table and always summed to 0.
          sum + Number(item.total_earning || 0),

        0

      );

    return ok(res, {
      total_earnings:
        Number(total.toFixed(2)),
      records:
        data || [],
      // App Review driver accounts only: their rides and earnings are
      // simulated, and the dashboard labels them as such. Derived from
      // the authenticated driver row, never from client input.
      ...(req.driver?.is_review_account === true
        ? { review_mode: true, review_label: REVIEW_MODE_LABEL }
        : {})
    });

  })

);/* =========================================================

   PART 8 — ADMIN OPERATIONS + SSE STREAM + HTAF SCHEDULING

========================================================= */

const sseClients = new Map();

function sendSse(clientId, event, data) {

  const client =

    sseClients.get(clientId);

  if (!client) return;

  client.write(

    `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`

  );

}

function broadcastSse(event, data) {

  for (const clientId of sseClients.keys()) {

    sendSse(clientId, event, data);

  }

}

/* =========================================================

   RIDE-SCOPED SSE (rider-facing live delivery tracking)

   Separate from the admin firehose above: clients subscribe to
   a single ride_id and only receive events for that ride.

========================================================= */

const rideSseClients = new Map(); // rideId -> Map(clientId -> res)

function addRideSseClient(rideId, clientId, res) {

  if (!rideSseClients.has(rideId)) {

    rideSseClients.set(rideId, new Map());

  }

  rideSseClients.get(rideId).set(clientId, res);

}

function removeRideSseClient(rideId, clientId) {

  const clients = rideSseClients.get(rideId);

  if (!clients) return;

  clients.delete(clientId);

  if (clients.size === 0) {

    rideSseClients.delete(rideId);

  }

}

function broadcastRideSse(rideId, event, data) {

  const clients = rideSseClients.get(rideId);

  if (!clients) return;

  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

  for (const res of clients.values()) {

    try {

      res.write(payload);

    } catch {

      // Client likely disconnected; the close handler will clean it up.

    }

  }

}

app.get(

  "/api/rides/:id/stream",

  asyncRoute(async (req, res) => {

    const rideId = cleanString(req.params.id, 100);

    const { data: ride } = await supabase
      .from("rides")
      .select("id, rider_id, driver_id")
      .eq("id", rideId)
      .maybeSingle();

    // Live location: only the ride's rider, its assigned driver or an
    // admin (lib/rideAccess.js). Everyone else sees "not found".
    if (!ride || !(await resolveRideViewer(req, ride))) {
      return fail(res, "Ride not found.", 404);
    }

    const clientId = makeId("RIDESSE");

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    addRideSseClient(rideId, clientId, res);

    res.write(`event: connected\ndata: ${JSON.stringify({ ride_id: rideId })}\n\n`);

    const heartbeat = setInterval(() => {
      try {
        res.write(`event: heartbeat\ndata: ${JSON.stringify({ at: nowIso() })}\n\n`);
      } catch {
        clearInterval(heartbeat);
      }
    }, 25_000);

    req.on("close", () => {
      clearInterval(heartbeat);
      removeRideSseClient(rideId, clientId);
    });

  })

);

/* =========================================================

   ADMIN SSE STREAM

========================================================= */

app.get(

  "/api/admin/stream",

  requireAdmin,

  asyncRoute(async (req, res) => {

    const clientId =

      makeId("SSE");

    res.setHeader(

      "Content-Type",

      "text/event-stream"

    );

    res.setHeader(

      "Cache-Control",

      "no-cache"

    );

    res.setHeader(

      "Connection",

      "keep-alive"

    );

    res.flushHeaders?.();

    sseClients.set(

      clientId,

      res

    );

    sendSse(

      clientId,

      "connected",

      {

        client_id:

          clientId,

        connected_at:

          nowIso()

      }

    );

    const heartbeat =

      setInterval(() => {

        sendSse(

          clientId,

          "heartbeat",

          {

            at:

              nowIso()

          }

        );

      }, 25_000);

    req.on(

      "close",

      () => {

        clearInterval(

          heartbeat

        );

        sseClients.delete(

          clientId

        );

      }

    );

  })

);

/* =========================================================

   ADMIN OVERVIEW

========================================================= */

/* =========================================================

   ADMIN OVERVIEW CACHE

   Exact table counts get expensive as data grows. Cache the

   assembled overview for a short TTL so repeated admin polls

   don't re-run six exact counts each time. In-memory (per

   instance) — acceptable for admin metrics; move to Redis if

   you later need it shared across instances.

========================================================= */

const OVERVIEW_CACHE_TTL_MS =

  envNumber("OVERVIEW_CACHE_TTL_SECONDS", 60) * 1000;

let overviewCache = {

  data: null,

  expiresAt: 0

};

async function safeCount(table) {

  try {

    const { count, error } =

      await supabase

        .from(table)

        .select("id", {

          count: "exact",

          head: true

        });

    if (error) {

      return {

        table,

        count: 0,

        error: error.message

      };

    }

    return {

      table,

      count: count || 0

    };

  } catch (error) {

    return {

      table,

      count: 0,

      error: error.message

    };

  }

}

// Exact count with no row transfer (head:true). Returns count or an error string.
async function countWhere(table, build) {
  let q = supabase.from(table).select("*", { count: "exact", head: true });
  if (build) q = build(q);
  const { count, error } = await q;
  return error ? { count: null, error: error.message } : { count: count || 0 };
}

app.get(

  "/api/admin/overview",

  requireAdmin,

  asyncRoute(async (req, res) => {

    const forceRefresh =

      ["1", "true", "yes"].includes(

        String(req.query.refresh || "").toLowerCase()

      );

    const now = Date.now();

    if (

      !forceRefresh &&

      overviewCache.data &&

      now < overviewCache.expiresAt

    ) {

      return ok(res, {

        overview: {

          ...overviewCache.data,

          server_time:

            nowIso(),

          environment:

            NODE_ENV,

          cached:

            true

        }

      });

    }

    const results =

      await Promise.all([

        safeCount("riders"),

        safeCount("drivers"),

        safeCount("rides"),

        safeCount("htaf_applications"),

        safeCount("driver_offers"),

        safeCount("driver_earnings")

      ]);

    const overview =

      results.reduce(

        (acc, item) => {

          acc[item.table] =

            item.count;

          if (item.error) {

            acc[`${item.table}_error`] =

              item.error;

          }

          return acc;

        },

        {}

      );

    overviewCache = {

      data: overview,

      expiresAt: now + OVERVIEW_CACHE_TTL_MS

    };

    return ok(res, {

      overview: {

        ...overview,

        server_time:

          nowIso(),

        environment:

          NODE_ENV,

        cached:

          false

      }

    });

  })

);

app.get(
  "/api/admin/metrics",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const now = new Date();
    const startOfTodayUtc = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
    ).toISOString();

    const ACTIVE_RIDE_STATUSES = [
      RIDE_STATUS.AWAITING_DRIVER,
      RIDE_STATUS.DRIVER_ASSIGNED,
      RIDE_STATUS.DRIVER_ENROUTE,
      RIDE_STATUS.ARRIVED,
      RIDE_STATUS.IN_PROGRESS
    ];

    const [
      ridesToday,
      ridesActive,
      ridesCompletedToday,
      dispatchQueue,
      driversOnline,
      driversTotal,
      htafToday
    ] = await Promise.all([
      countWhere("rides", (q) => q.gte("created_at", startOfTodayUtc)),
      countWhere("rides", (q) => q.in("status", ACTIVE_RIDE_STATUSES)),
      countWhere("rides", (q) =>
        q.eq("status", RIDE_STATUS.COMPLETED).gte("created_at", startOfTodayUtc)
      ),
      countWhere("rides", (q) => q.eq("status", RIDE_STATUS.AWAITING_DRIVER)),
      countWhere("drivers", (q) => q.eq("online", true)),
      countWhere("drivers", null),
      countWhere("htaf_applications", (q) => q.gte("created_at", startOfTodayUtc))
    ]);

    // Earnings today: sum over today's rows (admin-only, low volume).
    let earningsToday = { net_total: 0, ride_count: 0, error: null };
    {
      // total_earning/gross_fare are the real columns — net_amount/
      // gross_amount don't exist on this table and made this query error
      // on every call (silently swallowed into earningsToday.error).
      const { data, error } = await supabase
        .from("driver_earnings")
        .select("total_earning, gross_fare")
        .gte("created_at", startOfTodayUtc);
      if (error) {
        earningsToday.error = error.message;
      } else {
        earningsToday.ride_count = data.length;
        earningsToday.net_total = data.reduce(
          (sum, r) => sum + Number(r.total_earning || r.gross_fare || 0),
          0
        );
        earningsToday.net_total = Math.round(earningsToday.net_total * 100) / 100;
      }
    }

    // HTAF breakdown by status (dynamic — no hardcoded status strings).
    let htafByStatus = {};
    let htafTotal = 0;
    {
      const { data, error } = await supabase
        .from("htaf_applications")
        .select("status, email");
      if (!error && Array.isArray(data)) {
        htafTotal = data.length;
        htafByStatus = data.reduce((acc, r) => {
          const k = r.status || "unknown";
          acc[k] = (acc[k] || 0) + 1;
          return acc;
        }, {});
      }
    }

    return ok(res, {
      metrics: {
        generated_at: nowIso(),
        window: "today = UTC midnight to now",
        environment: NODE_ENV,
        rides: {
          today: ridesToday.count,
          active: ridesActive.count,
          completed_today: ridesCompletedToday.count,
          dispatch_queue: dispatchQueue.count
        },
        drivers: {
          online: driversOnline.count,
          total: driversTotal.count
        },
        earnings_today: earningsToday,
        htaf: {
          today: htafToday.count,
          total: htafTotal,
          by_status: htafByStatus
        }
      }
    });
  })
);

/* =========================================================

   ADMIN OPERATIONS OVERVIEW

   Single aggregation endpoint for the admin-dashboard.html
   operations panel: service-type breakdown of in-progress
   rides (taxi/food/grocery/HTAF), active riders/drivers,
   today's completed rides + revenue, average ETA across
   active rides, and integration health for Supabase/Stripe/
   SendGrid/Twilio.

========================================================= */

app.get(
  "/api/admin/operations-overview",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const now = new Date();
    const startOfTodayUtc = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
    ).toISOString();

    const ACTIVE_STATUSES = [
      RIDE_STATUS.AWAITING_DRIVER,
      RIDE_STATUS.DRIVER_ASSIGNED,
      RIDE_STATUS.DRIVER_ENROUTE,
      RIDE_STATUS.ARRIVED,
      RIDE_STATUS.IN_PROGRESS
    ];

    // Google Play reviewer-account exclusion (approved requirement):
    // the review driver/rides must never count toward operational or
    // financial totals -- excluded at the query level on every branch
    // below, not filtered out after the fact, so a future field added
    // to this endpoint can't accidentally reintroduce them.
    const [
      activeRidesResult,
      driversOnline,
      completedTodayResult,
      databaseCheck
    ] = await Promise.all([
      supabase
        .from("rides")
        .select("ride_type, rider_id, driver_eta_to_pickup_minutes")
        .in("status", ACTIVE_STATUSES)
        .eq("is_review_ride", false),
      countWhere("drivers", (q) => q.eq("online", true).eq("is_review_account", false)),
      supabase
        .from("rides")
        .select("estimated_fare")
        .eq("status", RIDE_STATUS.COMPLETED)
        .eq("is_review_ride", false)
        .gte("created_at", startOfTodayUtc),
      supabase.from("system_flags").select("key").limit(1)
    ]);

    const activeRides = activeRidesResult.data || [];

    const ridesInProgress = { taxi: 0, food: 0, grocery: 0, htaf: 0 };
    const activeRiderIds = new Set();
    let etaSum = 0;
    let etaCount = 0;

    for (const ride of activeRides) {
      if (ride.ride_type === "food") ridesInProgress.food++;
      else if (ride.ride_type === "grocery") ridesInProgress.grocery++;
      else if (ride.ride_type === "foundation") ridesInProgress.htaf++;
      else ridesInProgress.taxi++;

      if (ride.rider_id) activeRiderIds.add(ride.rider_id);

      const eta = Number(ride.driver_eta_to_pickup_minutes);
      if (Number.isFinite(eta) && eta > 0) {
        etaSum += eta;
        etaCount++;
      }
    }

    const completedTodayRows = completedTodayResult.data || [];
    const revenueToday = completedTodayRows.reduce(
      (sum, r) => sum + Number(r.estimated_fare || 0),
      0
    );

    return ok(res, {
      overview: {
        generated_at: nowIso(),
        active_riders: activeRiderIds.size,
        online_drivers: driversOnline.count,
        rides_in_progress: ridesInProgress,
        today: {
          completed_rides: completedTodayRows.length,
          revenue: Math.round(revenueToday * 100) / 100
        },
        avg_eta_minutes:
          etaCount > 0
            ? Math.round((etaSum / etaCount) * 10) / 10
            : null,
        // Supabase gets a real connectivity check (a live query above).
        // Stripe/SendGrid/Twilio only report whether the client library was
        // initialized with an API key, not that the provider is currently
        // reachable — "check" tells the dashboard which kind it's showing
        // so the badges don't imply a uniform depth of health check.
        integration_health: {
          supabase: {
            healthy: !databaseCheck.error,
            check: "connectivity"
          },
          stripe: {
            healthy: Boolean(stripe),
            check: "configured"
          },
          sendgrid: {
            healthy: Boolean(sgMail && SENDGRID_API_KEY),
            check: "configured"
          },
          twilio: {
            healthy: Boolean(twilioClient),
            check: "configured"
          }
        }
      }
    });
  })
);

/* =========================================================

   ADMIN RIDES LIST

========================================================= */

app.get(

  "/api/admin/rides",

  requireAdmin,

  asyncRoute(async (req, res) => {

    const status =

      cleanString(

        req.query.status,

        80

      );

    const limit =

      getPageLimit(

        req,

        envNumber("ADMIN_LIST_LIMIT", 200),

        500

      );

    const cursor =

      decodeCursor(req.query.cursor);

    let query =

      supabase

        .from("rides")

        .select(ADMIN_RIDES_LIST_FIELDS.join(","))

        .order("created_at", {

          ascending: false

        })

        .order("id", {

          ascending: false

        })

        .limit(limit);

    if (status) {

      query =

        query.eq(

          "status",

          status

        );

    }

    query = applyCursor(query, cursor);

    const { data, error } =

      await query;

    if (error) {

      throw error;

    }

    const rows = data || [];

    const next_cursor =

      rows.length === limit

        ? encodeCursor(rows[rows.length - 1])

        : null;

    return ok(res, {

      rides:

        rows,

      page: {

        limit,

        count: rows.length,

        next_cursor

      }

    });

  })

);

/* =========================================================

   ADMIN UPDATE RIDE STATUS (narrowly scoped)

   Used to accept ANY RIDE_STATUS value with only an optional free-text
   note and no Stripe-side consequence -- an admin could silently move a
   ride to completed or cancelled without ever touching the associated
   PaymentIntent, or "correct" a ride that was already completed/
   cancelled. That's exactly the class of bug this phase is closing
   everywhere else (lifecycle rules bypassed, payment operations skipped
   silently), so this route no longer allows it either.

   Narrowed to: a small, explicit allow-list of non-terminal, non-payment-
   sensitive corrections (unsticking a ride that never dispatched, or
   manually retrying dispatch on one that failed) -- nothing that touches
   an assigned driver, an in-progress trip, or either terminal status.
   completed and cancelled can be neither the source nor the destination
   of a change made through this route, full stop. A reason is now
   required, not optional.

   Cancellation, payment/refund reconciliation, and any genuine
   post-in_progress incident each have their own dedicated route (see
   POST /api/rides/:id/cancel, POST /api/driver/rides/:rideId/withdraw,
   POST /api/admin/payments/:rideId/reconcile, and
   POST /api/admin/rides/:id/incident-resolve below) -- this route is not
   a substitute for any of them.

========================================================= */

const ADMIN_STATUS_ALLOWED_TRANSITIONS = Object.freeze({
  [RIDE_STATUS.DRAFT]: [RIDE_STATUS.FAILED],
  [RIDE_STATUS.PAYMENT_REQUIRED]: [RIDE_STATUS.FAILED],
  [RIDE_STATUS.PAYMENT_AUTHORIZED]: [RIDE_STATUS.FAILED],
  [RIDE_STATUS.AWAITING_DRIVER]: [RIDE_STATUS.FAILED],
  [RIDE_STATUS.FAILED]: [RIDE_STATUS.AWAITING_DRIVER]
});

app.patch(

  "/api/admin/rides/:id/status",

  requireAdmin,

  asyncRoute(async (req, res) => {

    const rideId =

      cleanString(

        req.params.id,

        100

      );

    const status =

      cleanString(

        req.body.status,

        80

      );

    const reason = cleanString(req.body.reason || req.body.note, 1000);

    if (!reason) {
      return fail(res, "A reason is required to change a ride's status.", 400);
    }

    let ride;

    try {
      ride = await getRideOrFail(rideId);
    } catch (err) {
      return fail(res, "Ride not found.", 404);
    }

    // A failed ride whose card authorization was already released (see
    // releaseFailedRidePayment) has nothing left to charge: reviving it
    // would let a trip run unpaid. The rider books again instead.
    if (
      ride.status === RIDE_STATUS.FAILED &&
      status === RIDE_STATUS.AWAITING_DRIVER &&
      ride.is_review_ride !== true &&
      ride.payment_id &&
      [CANCELLATION_PAYMENT_STATUS.CANCEL_PENDING, CANCELLATION_PAYMENT_STATUS.CANCELLED].includes(ride.cancellation_payment_status)
    ) {
      return fail(
        res,
        "This ride's card authorization was released when it failed, so it can't be dispatched again. Ask the rider to book a new ride.",
        409,
        { current_status: ride.status, cancellation_payment_status: ride.cancellation_payment_status }
      );
    }
    const allowedTargets = ADMIN_STATUS_ALLOWED_TRANSITIONS[ride.status] || [];

    if (!allowedTargets.includes(status)) {

      auditLog({
        actor_type: "admin",
        actor_id: req.admin.email,
        action: "admin_ride_status_update_rejected",
        entity_type: "ride",
        entity_id: rideId,
        metadata: { attempted_status: status, current_status: ride.status, reason },
        req
      }).catch(() => {});

      return fail(

        res,

        `This route cannot move a ride from ${ride.status} to ${status}. ` +
          `Use the dedicated cancellation, withdrawal, payment-reconciliation, or ` +
          `incident-resolution operation instead.`,

        409,

        { current_status: ride.status, allowed_targets: allowedTargets }

      );

    }

    const claim = await claimRideTransition({
      supabase,
      rideId,
      fromStatuses: [ride.status],
      toStatus: status,
      patch: {
        admin_note: reason,
        updated_at: nowIso()
      }
    });

    if (!claim.ok) {

      return fail(

        res,

        `Ride status changed before this update could apply (now ${claim.currentStatus}).`,

        409,

        { current_status: claim.currentStatus }

      );

    }

    auditLog({

      actor_type:

        "admin",

      actor_id:

        req.admin.email,

      action:

        "admin_ride_status_updated",

      entity_type:

        "ride",

      entity_id:

        rideId,

      metadata: {

        from_status: ride.status,

        status,

        reason

      },

      req

    }).catch(() => {});
    if (status === RIDE_STATUS.FAILED) {
      await releaseFailedRidePayment(rideId, req);
    }

    // Field-minimized response/broadcast, same as this route always
    // required (claimRideTransition's own return is the full row, since
    // it's a generic shared primitive -- the minimization is applied
    // here, at the one admin-facing call site that needs it).
    const minimizedRide = Object.fromEntries(
      ADMIN_RIDE_MUTATION_FIELDS.map((field) => [field, claim.ride[field]])
    );

    broadcastSse(

      "ride_updated",

      { ride: minimizedRide }

    );

    return ok(res, {

      ride:

        minimizedRide

    });

  })

);

/* =========================================================

   ADMIN PAYMENT RECONCILIATION (manual retry)

   A single, general endpoint for both stuck failure modes this phase
   introduces persisted state for -- a failed completion capture
   (rides.payment_status = 'capture_failed') and a failed cancellation
   void (rides.cancellation_payment_status = 'cancel_failed') -- rather
   than two near-identical routes. Manual/admin-triggered only; nothing
   in this phase retries either automatically.

========================================================= */

app.post(
  "/api/admin/payments/:rideId/reconcile",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const rideId = cleanString(req.params.rideId, 100);

    let ride;

    try {
      ride = await getRideOrFail(rideId);
    } catch (err) {
      return fail(res, "Ride not found.", 404);
    }

    const results = {};

    if (ride.payment_status === CAPTURE_STATUS.CAPTURE_FAILED) {
      const captureResult = await captureRidePaymentIdempotent(ride, req, { forceRetry: true });
      results.capture = captureResult.outcome;
      ride = captureResult.ride;
    }

    if (ride.cancellation_payment_status === CANCELLATION_PAYMENT_STATUS.CANCEL_FAILED) {
      const cancelResult = await reconcileCancellationPayment(ride, req);
      results.cancellation = cancelResult.outcome;
      ride = cancelResult.ride;
    }

    if (!Object.keys(results).length) {
      return fail(
        res,
        "This ride has no failed payment or cancellation reconciliation to retry.",
        400,
        {
          payment_status: ride.payment_status,
          cancellation_payment_status: ride.cancellation_payment_status
        }
      );
    }

    auditLog({
      actor_type: "admin",
      actor_id: req.admin.email,
      action: "admin_payment_reconciliation_retried",
      entity_type: "ride",
      entity_id: rideId,
      metadata: results,
      req
    }).catch(() => {});

    return ok(res, {
      ride_id: rideId,
      results,
      payment_status: ride.payment_status,
      cancellation_payment_status: ride.cancellation_payment_status
    });
  })
);

/* =========================================================

   ADMIN INCIDENT RESOLUTION

   The one narrowly-scoped, explicitly-authorized exception to "self-
   service cancellation stops at in_progress." Requires a reason and
   states explicitly what happens to payment -- there is no default, so
   this can never silently perform or omit a Stripe operation. Not a
   general-purpose status editor: resolution is exactly one of
   'cancelled_by_incident' or 'force_completed_by_incident'.

========================================================= */

const INCIDENT_RESOLUTIONS = Object.freeze([
  "cancelled_by_incident",
  "force_completed_by_incident"
]);

const INCIDENT_PAYMENT_ACTIONS = Object.freeze(["capture", "void", "leave_pending"]);

app.post(
  "/api/admin/rides/:id/incident-resolve",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const rideId = cleanString(req.params.id, 100);
    const reason = cleanString(req.body.reason, 1000);
    const resolution = cleanString(req.body.resolution, 60);
    const paymentAction = cleanString(req.body.payment_action, 30);

    if (!reason) {
      return fail(res, "A reason is required for an incident resolution.", 400);
    }

    if (!INCIDENT_RESOLUTIONS.includes(resolution)) {
      return fail(res, "resolution must be one of: " + INCIDENT_RESOLUTIONS.join(", "), 400);
    }

    // Cancellations are free in this phase (owner instruction 2026-10-04),
    // and a cancelled ride must never also be charged the trip fare. A
    // trip that really happened is resolved as completed_by_incident.
    if (resolution === "cancelled_by_incident" && paymentAction === "capture") {
      return fail(
        res,
        "A cancelled ride can't be charged. Release the hold (void), or use force_completed_by_incident if the trip took place.",
        400,
        { code: "cancellation_charge_not_allowed" }
      );
    }
    const serviceFailure = req.body && req.body.service_failure === true;
    if (!INCIDENT_PAYMENT_ACTIONS.includes(paymentAction)) {
      return fail(
        res,
        "payment_action is required and must be one of: " + INCIDENT_PAYMENT_ACTIONS.join(", "),
        400
      );
    }

    let ride;

    try {
      ride = await getRideOrFail(rideId);
    } catch (err) {
      return fail(res, "Ride not found.", 404);
    }

    if (ride.status === RIDE_STATUS.COMPLETED || ride.status === RIDE_STATUS.CANCELLED) {
      return fail(
        res,
        `Ride is already terminal (${ride.status}); an incident resolution cannot change it.`,
        409,
        { current_status: ride.status }
      );
    }

    const toStatus =
      resolution === "cancelled_by_incident" ? RIDE_STATUS.CANCELLED : RIDE_STATUS.COMPLETED;

    const claim = await claimRideTransition({
      supabase,
      rideId,
      fromStatuses: [ride.status],
      toStatus,
      patch: {
        [toStatus === RIDE_STATUS.CANCELLED ? "cancelled_at" : "completed_at"]: nowIso(),
        ...(toStatus === RIDE_STATUS.CANCELLED
          ? {
              cancellation_reason: reason,
              cancelled_by_type: "admin",
              cancelled_by_id: req.admin.email
            }
          : {}),
        admin_note: reason,
        updated_at: nowIso()
      }
    });

    if (!claim.ok) {
      return fail(
        res,
        `Ride status changed before this resolution could apply (now ${claim.currentStatus}).`,
        409,
        { current_status: claim.currentStatus }
      );
    }

    if (toStatus === RIDE_STATUS.CANCELLED) {
      const category = serviceFailure
        ? cancellationRecords.CANCELLATION_CATEGORY.SERVICE_FAILURE
        : cancellationRecords.CANCELLATION_CATEGORY.ADMIN_INCIDENT;
      await recordCancellation(rideId, {
        category,
        assessment: cancellationRecords.assessCancellation(ride, { category })
      });
    }

    let paymentOutcome = "leave_pending";

    if (paymentAction === "capture") {
      const captureResult = await captureRidePaymentIdempotent(claim.ride, req);
      paymentOutcome = captureResult.outcome;
    } else if (paymentAction === "void") {
      const cancelResult = await reconcileCancellationPayment(claim.ride, req);
      paymentOutcome = cancelResult.outcome;
    }

    if (toStatus === RIDE_STATUS.CANCELLED && claim.ride.driver_id) {
      sendPushNotification({
        ownerType: "driver",
        ownerId: claim.ride.driver_id,
        title: "Ride Cancelled",
        body: "This ride was cancelled by an administrator and is no longer assigned to you.",
        url: "/driver.html"
      }).catch(() => {});
    }

    notifyRideStage(
      ride,
      toStatus === RIDE_STATUS.CANCELLED ? "ride_cancelled" : "ride_completed"
    ).catch(() => {});

    broadcastRideSse(rideId, "stage", { status: toStatus });

    auditLog({
      actor_type: "admin",
      actor_id: req.admin.email,
      action: "admin_ride_incident_resolved",
      entity_type: "ride",
      entity_id: rideId,
      metadata: {
        resolution,
        reason,
        payment_action: paymentAction,
        payment_outcome: paymentOutcome,
        from_status: ride.status
      },
      req
    }).catch(() => {});

    return ok(res, {
      ride_id: rideId,
      status: toStatus,
      payment_action: paymentAction,
      payment_outcome: paymentOutcome
    });
  })
);

/* =========================================================
   DISPATCH EXCEPTION CONSOLE, V1 (owner decisions 2026-10-22)
   Flags rides needing a person's attention (lib/dispatchExceptions.js)
   and suggests nearby ready drivers. Staff decide: a reassignment needs a
   written note and is audited; nothing is reassigned automatically.
   Driver bounties are designed but switched off (lib/driverBounty.js):
   a proposal is only recorded; drivers don't see it and nothing is paid.
========================================================= */
const dispatchExceptions = require("./lib/dispatchExceptions");
const auditRetention = require("./lib/auditRetention");
const driverBounty = require("./lib/driverBounty");

const CONSOLE_RIDE_FIELDS =
  "id, status, ride_type, dispatch_status, scheduled_time, driver_id, rider_name, pickup_address, dropoff_address, pickup_lat, pickup_lng, accepted_at, driver_accepted_at, driver_eta_to_pickup_minutes, last_dispatch_at, requested_at, created_at, arrived_at";
const CONSOLE_OPEN_STATUSES = ["payment_authorized", "awaiting_driver_acceptance", ...dispatchExceptions.ON_TRIP_STATUSES];

const consoleDriverName = (d) => (d ? [d.first_name, d.last_name ? `${String(d.last_name)[0]}.` : ""].filter(Boolean).join(" ") || d.name || d.full_name || "Driver" : null);

app.get(
  "/api/admin/dispatch/exceptions",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const now = Date.now();
    const { data: rides, error } = await supabase.from("rides").select(CONSOLE_RIDE_FIELDS).in("status", CONSOLE_OPEN_STATUSES).limit(300);
    if (error) return fail(res, "Rides could not be loaded.", 502);
    const { data: drivers, error: dErr } = await supabase.from("drivers").select("*").limit(1000);
    if (dErr) return fail(res, "Drivers could not be loaded.", 502);
    const driversById = new Map((drivers || []).map((d) => [String(d.id), d]));
    const busy = new Set((rides || []).filter((r) => r.driver_id && dispatchExceptions.ON_TRIP_STATUSES.includes(r.status)).map((r) => String(r.driver_id)));
    const bountyEnabled = (await getSystemFlag(driverBounty.BOUNTY_FLAG, "false")) === "true";
    const items = [];
    for (const ride of rides || []) {
      const reassignable = dispatchExceptions.REASSIGNABLE_STATUSES.includes(ride.status);
      const nearby = dispatchExceptions
        .candidateDrivers(ride, drivers || [], { now, isReady: (d) => driverVerificationReady(d) && driverEligibleForService(d, ride.ride_type), busyDriverIds: busy, limit: 50 })
        .filter((c) => c.straight_line_miles <= dispatchExceptions.COVERAGE_RADIUS_MILES);
      const exceptions = dispatchExceptions.rideExceptions(ride, { now, driversById, liveReadyNearby: nearby.length });
      if (!exceptions.length) continue;
      const driver = ride.driver_id ? driversById.get(String(ride.driver_id)) : null;
      items.push({
        ride_id: ride.id,
        status: ride.status,
        ride_type: ride.ride_type || "standard",
        scheduled_time: ride.scheduled_time || null,
        rider: String(ride.rider_name || "").split(" ")[0] || "Rider",
        pickup: ride.pickup_address || null,
        dropoff: ride.dropoff_address || null,
        driver: driver ? { id: driver.id, name: consoleDriverName(driver), online: Boolean(driver.online || driver.is_online) } : null,
        severity: exceptions[0].severity,
        exceptions,
        can_reassign: reassignable,
        candidates: reassignable ? nearby.slice(0, 5) : []
      });
    }
    dispatchExceptions.sortQueue(items);
    const counts = { critical: 0, warning: 0, info: 0 };
    for (const item of items) counts[item.severity] += 1;
    return ok(res, {
      generated_at: new Date(now).toISOString(),
      open_rides: (rides || []).length,
      drivers_live: (drivers || []).filter((d) => dispatchExceptions.driverLive(d, now)).length,
      counts,
      items,
      bounty_enabled: bountyEnabled,
      notes: "Distances are straight-line; road time may differ. Staff decide every reassignment."
    });
  })
);

app.post(
  "/api/admin/dispatch/rides/:id/reassign",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const rideId = cleanString(req.params.id, 100);
    const parsed = dispatchExceptions.validateReassignment(req.body);
    if (!parsed.ok) return fail(res, parsed.error, 400);
    const { data: ride, error } = await supabase.from("rides").select(CONSOLE_RIDE_FIELDS).eq("id", rideId).maybeSingle();
    if (error) return fail(res, "The ride could not be loaded.", 502);
    if (!ride) return fail(res, "Ride not found.", 404);
    if (!dispatchExceptions.REASSIGNABLE_STATUSES.includes(ride.status)) return fail(res, "Only a ride that hasn't started can be reassigned.", 409);
    if (String(ride.driver_id || "") === parsed.driver_id) return fail(res, "That driver already has this ride.", 400);
    const { data: driver, error: dErr } = await supabase.from("drivers").select("*").eq("id", parsed.driver_id).maybeSingle();
    if (dErr) return fail(res, "The driver could not be loaded.", 502);
    if (!driver) return fail(res, "Driver not found.", 404);
    if (!driverVerificationReady(driver)) return fail(res, "This driver's verification isn't complete.", 409, { code: "verification_required" });
    if (!driverEligibleForService(driver, ride.ride_type)) return fail(res, "This driver isn't set up for this type of trip.", 409);
    if (!dispatchExceptions.driverLive(driver, Date.now())) return fail(res, "This driver isn't online right now.", 409);
    const { data: busyRides, error: bErr } = await supabase.from("rides").select("id").eq("driver_id", driver.id).in("status", dispatchExceptions.ON_TRIP_STATUSES).limit(1);
    if (bErr) return fail(res, "The driver's trips could not be checked.", 502);
    if (busyRides && busyRides.length) return fail(res, "This driver is on another trip.", 409);
    const previousDriverId = ride.driver_id || null;
    const previousStatus = ride.status;
    const driverRideFields = buildDriverRideFields(driver);
    const { data: updated, error: uErr } = await supabase
      .from("rides")
      .update({
        driver_id: driver.id,
        status: RIDE_STATUS.DRIVER_ASSIGNED,
        dispatch_status: "admin_reassigned",
        assigned_by_admin: true,
        assigned_at: nowIso(),
        ...driverRideFields,
        updated_at: nowIso()
      })
      .eq("id", rideId)
      .eq("status", previousStatus)
      .select([...ADMIN_RIDE_MUTATION_FIELDS, "rider_id", "rider_phone", "ride_type", "pickup_address"].join(","))
      .maybeSingle();
    if (uErr) return fail(res, "The reassignment could not be saved.", 502);
    if (!updated) return fail(res, "The ride changed in the meantime. Reload and try again.", 409);
    await supabase.from("driver_offers").update({ status: "superseded", updated_at: nowIso() }).eq("ride_id", rideId).eq("status", "pending");
    notifyRideStage(updated, "driver_assigned").catch(() => {});
    sendPushNotification({ ownerType: "driver", ownerId: driver.id, title: "Ride Assigned", body: `Harvey Taxi dispatch assigned you a ride. Pickup: ${updated.pickup_address || "See app for details"}`, url: "/driver.html" }).catch(() => {});
    if (previousDriverId) {
      sendPushNotification({ ownerType: "driver", ownerId: previousDriverId, title: "Ride reassigned", body: "Harvey Taxi dispatch moved one of your rides to another driver.", url: "/driver.html" }).catch(() => {});
    }
    broadcastRideSse(rideId, "stage", { status: RIDE_STATUS.DRIVER_ASSIGNED, driver: driverRideFields });
    auditLog({
      actor_type: "admin",
      actor_id: req.admin.email,
      action: "dispatch_ride_reassigned",
      entity_type: "ride",
      entity_id: rideId,
      metadata: { from_driver_id: previousDriverId, to_driver_id: driver.id, previous_status: previousStatus, note: parsed.note, exception_code: cleanString(req.body && req.body.exception_code, 40) || null },
      req
    }).catch(() => {});
    return ok(res, { ride: { id: updated.id, status: updated.status, dispatch_status: updated.dispatch_status, driver_id: updated.driver_id } });
  })
);

// Bounty proposals: refused while the switch is off (it is, by owner
// decision). Even when on, a proposal is only recorded.
app.post(
  "/api/admin/dispatch/rides/:id/bounty",
  requireAdmin,
  asyncRoute(async (req, res) => {
    if ((await getSystemFlag(driverBounty.BOUNTY_FLAG, "false")) !== "true") return fail(res, "Driver bounties are switched off.", 403);
    const rideId = cleanString(req.params.id, 100);
    const parsed = driverBounty.validateBounty(req.body);
    if (!parsed.ok) return fail(res, parsed.error, 400);
    const { data: ride, error } = await supabase.from("rides").select("id, status").eq("id", rideId).maybeSingle();
    if (error) return fail(res, "The ride could not be loaded.", 502);
    if (!ride) return fail(res, "Ride not found.", 404);
    if (!dispatchExceptions.REASSIGNABLE_STATUSES.includes(ride.status)) return fail(res, "A bounty can only be added before the trip starts.", 409);
    const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString();
    const { data: thisMonth, error: mErr } = await supabase.from("ride_driver_bounties").select("amount_cents").eq("status", "proposed").gte("created_at", monthStart);
    if (mErr) return fail(res, mErr.code === "42P01" ? "Driver bounties aren't set up yet." : "The bounty budget could not be checked.", mErr.code === "42P01" ? 503 : 502);
    const budgetCents = Number(await getSystemFlag(driverBounty.BOUNTY_BUDGET_KEY, "0")) || 0;
    const proposed = (thisMonth || []).reduce((sum, b) => sum + Number(b.amount_cents || 0), 0);
    if (!driverBounty.withinBudget({ budgetCents, proposedThisMonthCents: proposed, amountCents: parsed.amount_cents })) return fail(res, "This would go over the monthly bounty budget.", 409);
    const { data: bounty, error: iErr } = await supabase
      .from("ride_driver_bounties")
      .insert({ id: crypto.randomUUID(), ride_id: rideId, amount_cents: parsed.amount_cents, reason: parsed.reason, status: "proposed", created_by: req.admin.email || req.admin.id })
      .select("id, amount_cents, status")
      .single();
    if (iErr) return fail(res, iErr.code === "23505" ? "This ride already has a bounty." : "The bounty could not be saved.", iErr.code === "23505" ? 409 : 502);
    auditLog({ actor_type: "admin", actor_id: req.admin.email, action: "driver_bounty_proposed", entity_type: "ride", entity_id: rideId, metadata: { bounty_id: bounty.id, amount_cents: parsed.amount_cents }, req }).catch(() => {});
    return ok(res, { bounty, note: "Recorded only. Drivers don't see bounties yet and nothing is paid." }, 201);
  })
);

/* =========================================================

   ADMIN ASSIGN DRIVER

========================================================= */

app.post(

  "/api/admin/rides/:id/assign-driver",

  requireAdmin,

  asyncRoute(async (req, res) => {

    logAdminRbacShadowCheck(
      req,
      "POST /api/admin/rides/:id/assign-driver",
      RBAC_SHADOW_ROUTE_CAPABILITIES["POST /api/admin/rides/:id/assign-driver"]
    ).catch(() => {});

    const rideId =

      cleanString(

        req.params.id,

        100

      );

    const driverId =

      cleanString(

        req.body.driver_id,

        100

      );

    if (!driverId) {

      return fail(

        res,

        "driver_id required.",

        400

      );

    }

    const driver =

      await getDriverOrFail(driverId);

    // Deliveries: only a driver set up for that delivery type.
    const { data: target, error: targetError } = await supabase
      .from("rides")
      .select("id, ride_type")
      .eq("id", rideId)
      .maybeSingle();
    if (targetError) {
      throw targetError;
    }
    if (!target) {
      return fail(res, "Ride not found.", 404);
    }
    if (!driverEligibleForService(driver, target.ride_type)) {
      return fail(
        res,
        `This driver is not set up for ${deliveryCapabilityColumn(target.ride_type) === "supports_grocery_delivery" ? "grocery" : "food"} deliveries.`,
        409
      );
    }

    // Same verification rule as offers. An admin who has reviewed
    // equivalent documents uses the audited compliance override instead.
    if (!driverVerificationReady(driver)) {
      return fail(res, "This driver's verification isn't complete, so they can't be assigned a ride.", 409, {
        code: "verification_required"
      });
    }

    const driverRideFields = buildDriverRideFields(driver);

    const { data, error } =

      await supabase

        .from("rides")

        .update({

          driver_id:

            driver.id,

          status:

            RIDE_STATUS.DRIVER_ASSIGNED,

          dispatch_status:

            "admin_assigned",

          assigned_by_admin:

            true,

          assigned_at:

            nowIso(),

          ...driverRideFields,

          updated_at:

            nowIso()

        })

        .eq("id", rideId)

        // notifyRideStage() (below) needs rider_id/rider_phone/ride_type
        // to actually notify the rider, and the push-notification body
        // needs pickup_address -- both real, server-side-only uses, not
        // response fields. ride/driver in the SSE broadcast and the HTTP
        // response below are built from ADMIN_RIDE_MUTATION_FIELDS only,
        // never from this row directly, so those two internal-use fields
        // never leave the server.
        .select(
          [...ADMIN_RIDE_MUTATION_FIELDS, "rider_id", "rider_phone", "ride_type", "pickup_address"].join(",")
        )

        .maybeSingle();

    if (error) {

      throw error;

    }

    if (!data) {

      return fail(res, "Ride not found.", 404);

    }

    const rideSummary = {
      id: data.id,
      status: data.status,
      dispatch_status: data.dispatch_status,
      driver_id: data.driver_id,
      updated_at: data.updated_at
    };

    const driverSummary = { id: driver.id, ...driverRideFields };

    notifyRideStage(data, "driver_assigned").catch(() => {});

    sendPushNotification({
      ownerType: "driver",
      ownerId: driver.id,
      title: "Ride Assigned",
      body: `You've been assigned a ride. Pickup: ${data.pickup_address || "See app for details"}`,
      url: "/driver.html"
    }).catch(() => {});

    broadcastRideSse(rideId, "stage", {

      status: RIDE_STATUS.DRIVER_ASSIGNED,

      driver: driverRideFields

    });

    auditLog({

      actor_type:

        "admin",

      actor_id:

        req.admin.email,

      action:

        "admin_driver_assigned",

      entity_type:

        "ride",

      entity_id:

        rideId,

      metadata: {

        driver_id:

          driverId

      },

      req

    }).catch(() => {});

    broadcastSse(

      "ride_assigned",

      {

        ride:

          rideSummary,

        driver:

          driverSummary

      }

    );

    return ok(res, {

      ride:

        rideSummary,

      driver:

        driverSummary

    });

  })

);

/* =========================================================

   ADMIN DRIVERS LIST

========================================================= */

// Extra driver columns read only to work out the admin setup state
// (lib/driverCompliance.js driverSetupState); never sent to the client.
const DRIVER_SETUP_FIELDS = ["persona_status", "vehicle_make", "vehicle_model", "vehicle_year"];

function pickFields(row, fields) {
  const out = {};
  for (const field of fields) {
    if (Object.prototype.hasOwnProperty.call(row, field)) out[field] = row[field];
  }
  return out;
}

app.get(

  "/api/admin/drivers",

  requireAdmin,

  asyncRoute(async (req, res) => {

    const status =

      cleanString(

        req.query.status,

        80

      );

    const limit =

      getPageLimit(

        req,

        envNumber("ADMIN_LIST_LIMIT", 200),

        500

      );

    const cursor =

      decodeCursor(req.query.cursor);

    let query =

      supabase

        .from("drivers")

        // The setup fields are read only to work out each driver's setup
        // state below; they are not returned.
        .select([...ADMIN_DRIVERS_LIST_FIELDS, ...DRIVER_SETUP_FIELDS].join(","))

        .order("created_at", {

          ascending: false

        })

        .order("id", {

          ascending: false

        })

        .limit(limit);

    if (status) {

      query =

        query.eq(

          "status",

          status

        );

    }

    query = applyCursor(query, cursor);

    const { data, error } =

      await query;

    if (error) {

      throw error;

    }

    const rows = (data || []).map((driver) => ({
      ...pickFields(driver, ADMIN_DRIVERS_LIST_FIELDS),
      setup: driverSetupState(driver, { enablePersona: ENABLE_PERSONA, enableCheckr: ENABLE_CHECKR })
    }));

    const next_cursor =

      rows.length === limit

        ? encodeCursor(rows[rows.length - 1])

        : null;

    return ok(res, {

      drivers:

        rows,

      page: {

        limit,

        count: rows.length,

        next_cursor

      }

    });

  })

);

/* =========================================================

   ADMIN RIDERS LIST

========================================================= */

app.get(

  "/api/admin/riders",

  requireAdmin,

  asyncRoute(async (req, res) => {

    const status =

      cleanString(

        req.query.status,

        80

      );

    const limit =

      getPageLimit(

        req,

        envNumber("ADMIN_LIST_LIMIT", 200),

        500

      );

    const cursor =

      decodeCursor(req.query.cursor);

    let query =

      supabase

        .from("riders")

        .select(ADMIN_RIDERS_LIST_FIELDS.join(","))

        .order("created_at", {

          ascending: false

        })

        .order("id", {

          ascending: false

        })

        .limit(limit);

    if (status) {

      query =

        query.eq(

          "status",

          status

        );

    }

    query = applyCursor(query, cursor);

    const { data, error } =

      await query;

    if (error) {

      throw error;

    }

    const rows = data || [];

    const next_cursor =

      rows.length === limit

        ? encodeCursor(rows[rows.length - 1])

        : null;

    return ok(res, {

      riders:

        rows,

      page: {

        limit,

        count: rows.length,

        next_cursor

      }

    });

  })

);

/* =========================================================

   ADMIN APPROVE DRIVER

========================================================= */

app.patch(

  "/api/admin/drivers/:id/approve",

  requireAdmin,

  asyncRoute(async (req, res) => {

    logAdminRbacShadowCheck(
      req,
      "PATCH /api/admin/drivers/:id/approve",
      RBAC_SHADOW_ROUTE_CAPABILITIES["PATCH /api/admin/drivers/:id/approve"]
    ).catch(() => {});

    const driverId =

      cleanString(

        req.params.id,

        100

      );

    // Administrative approval and compliance verification are
    // deliberately two different, separately-authorized actions -- see
    // lib/driverCompliance.js. This route only ever touches the fields
    // buildOrdinaryApprovalUpdate() returns (status/approval_status/
    // approved_at/online) and never fabricates a Checkr or Persona
    // result. checkr_status and persona_verified only ever change via
    // the real webhook handlers (verified third-party events) or the
    // explicit, elevated, audited PATCH .../compliance-override route
    // below.
    const { data, error } =

      await supabase

        .from("drivers")

        .update(

          buildOrdinaryApprovalUpdate({

            now: nowIso()

          })

        )

        .eq("id", driverId)

        .select(ADMIN_DRIVER_MUTATION_FIELDS.join(","))

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

        "driver_approved",

      entity_type:

        "driver",

      entity_id:

        driverId,

      req

    }).catch(() => {});

    broadcastSse(

      "driver_approved",

      {

        driver:

          data

      }

    );

    return ok(res, {

      driver:

        data

    });

  })

);

/* =========================================================
   MERCHANT PORTAL, PHASE 1A: APPLICATIONS AND ADMIN REVIEW
   Owner decision 2026-10-17 (merchant portal; terms locked in
   docs/merchant-portal-plan.md section 4). Stores apply publicly; staff
   approve, reject (with a reason) or suspend (with a reason). Each review
   is audited. No merchant sign-in, catalog, orders or payouts yet, and
   delivery booking stays paused (rejectUnavailableRideType).
========================================================= */
const merchantRules = require("./lib/merchants");
const { screenMerchants } = require("./lib/merchantScreening");

app.post(
  "/api/merchants/apply",
  rateLimit({ windowMs: 60 * 60_000, max: 5, keyPrefix: "merchant_apply" }),
  asyncRoute(async (req, res) => {
    const checked = merchantRules.validateMerchantApplication(req.body || {});
    if (!checked.ok) return fail(res, checked.error, 400);
    const { data, error } = await supabase.from("merchants").insert(checked.row).select("id,status").single();
    if (error) {
      if (error.code === "23505") return fail(res, "An application for this contact email is already open. We'll be in touch.", 409);
      if (error.code === "42P01") return fail(res, "Merchant applications aren't open yet.", 503);
      console.warn("⚠️ Merchant application not saved:", { code: error.code || "unknown" });
      return fail(res, "We couldn't save your application. Please try again later.", 502);
    }
    auditLog({
      actor_type: "merchant_applicant",
      action: "merchant_application_submitted",
      entity_type: "merchant",
      entity_id: data.id,
      metadata: { category: checked.row.category, prices_differ_from_store: checked.row.prices_differ_from_store }
    }).catch(() => {});
    return ok(res, { application: { id: data.id, status: data.status } }, 201);
  })
);

/* =========================================================
   FLEET MANAGEMENT, PHASE 1 (owner decisions 2026-10-22)
   docs/fleet-management-plan.md. A verified driver owns a fleet (staff
   approve it), registers vehicles (staff verify insurance and
   registration before a vehicle carries riders) and invites other
   drivers, who accept or decline themselves. A fleet vehicle assigned to
   a driver is written onto the driver row, so dispatch, readiness and
   what riders see work unchanged; the driver's own vehicle is restored
   when the assignment ends. Earnings record the owner's agreed share;
   no money moves. Human-driven vehicles only. Switch:
   fleet_management_enabled (off). Tables: migration 20261022020000.
========================================================= */
const fleetRules = require("./lib/fleets");

const FLEET_ON_TRIP_STATUSES = [RIDE_STATUS.DRIVER_ASSIGNED, RIDE_STATUS.DRIVER_ENROUTE, RIDE_STATUS.ARRIVED, RIDE_STATUS.IN_PROGRESS];

async function fleetManagementEnabled() {
  return (await getSystemFlag(fleetRules.FLEET_FLAG, "false")) === "true";
}

function fleetTableMissing(error) {
  return Boolean(error && error.code === "42P01");
}

// Driver routes answer 404 while the switch is off.
async function requireFleetsOn(req, res, next) {
  try {
    if (!(await fleetManagementEnabled())) return fail(res, "Fleet management isn't available yet.", 404);
    return next();
  } catch (error) {
    return next(error);
  }
}

function fleetDriverReady(driver) {
  return computeDriverReadiness(driver, { enablePersona: ENABLE_PERSONA, enableCheckr: ENABLE_CHECKR }).ready;
}

async function driverOnTrip(driverId) {
  const { data, error } = await supabase.from("rides").select("id").eq("driver_id", driverId).in("status", FLEET_ON_TRIP_STATUSES).limit(1);
  if (error) throw error;
  return Array.isArray(data) && data.length > 0;
}

async function currentVehicleDocuments(vehicleIds) {
  if (!vehicleIds.length) return [];
  const { data, error } = await supabase.from("fleet_vehicle_documents").select("*").in("vehicle_id", vehicleIds).is("superseded_at", null);
  if (error) throw error;
  return data || [];
}

async function openAssignmentForDriver(driverId) {
  const { data, error } = await supabase.from("vehicle_assignments").select("*").eq("driver_id", driverId).is("ends_at", null).maybeSingle();
  if (error) throw error;
  return data || null;
}

async function ownedFleet(driverId) {
  const { data, error } = await supabase.from("fleets").select("*").eq("owner_driver_id", driverId).neq("status", "declined").maybeSingle();
  if (error) throw error;
  return data || null;
}

// Ends an assignment: the driver goes offline and gets their own vehicle
// back. Refused while the driver is on a trip, so a vehicle never changes
// mid-ride.
async function endVehicleAssignment(assignment, actor, req) {
  if (await driverOnTrip(assignment.driver_id)) {
    return { ok: false, statusCode: 409, error: "The driver is on a trip. The vehicle can be released after the trip ends." };
  }
  const endedAt = nowIso();
  const { data: ended, error } = await supabase
    .from("vehicle_assignments")
    .update({ ends_at: endedAt, ended_by: actor })
    .eq("id", assignment.id)
    .is("ends_at", null)
    .select("id")
    .maybeSingle();
  if (error) throw error;
  if (!ended) return { ok: true, already: true };
  const restore = { ...fleetRules.previousVehicleSnapshot(assignment.previous_vehicle || {}), online: false, updated_at: endedAt };
  const { error: driverError } = await supabase.from("drivers").update(restore).eq("id", assignment.driver_id);
  if (driverError) throw driverError;
  auditLog({ actor_type: "system", actor_id: actor, action: "fleet_assignment_ended", entity_type: "driver", entity_id: assignment.driver_id, metadata: { assignment_id: assignment.id, vehicle_id: assignment.vehicle_id, driver_set_offline: true }, req }).catch(() => {});
  return { ok: true };
}

async function endOpenAssignmentsForVehicles(vehicleIds, actor, req) {
  if (!vehicleIds.length) return { ok: true };
  const { data, error } = await supabase.from("vehicle_assignments").select("*").in("vehicle_id", vehicleIds).is("ends_at", null);
  if (error) throw error;
  for (const assignment of data || []) {
    const result = await endVehicleAssignment(assignment, actor, req);
    if (!result.ok) return result;
  }
  return { ok: true };
}

function fleetRouteError(res, error, fallback) {
  if (fleetTableMissing(error)) return fail(res, "Fleet management isn't set up yet.", 503);
  console.error("❌ Fleet route failed:", error && error.message);
  return fail(res, fallback, 502);
}

// Everything a driver sees about fleets: the fleet they own (if any) and
// their own membership, assignment and fleet earnings.
app.get(
  "/api/driver/fleet",
  requireDriverSelf,
  requireFleetsOn,
  asyncRoute(async (req, res) => {
    const me = req.driver.id;
    try {
      const fleet = await ownedFleet(me);
      let owned = null;
      if (fleet) {
        const { data: vehicles, error: vErr } = await supabase.from("fleet_vehicles").select("*").eq("fleet_id", fleet.id).order("created_at", { ascending: true });
        if (vErr) throw vErr;
        const vehicleIds = (vehicles || []).map((v) => v.id);
        const docs = await currentVehicleDocuments(vehicleIds);
        const { data: memberships, error: mErr } = await supabase.from("fleet_memberships").select("*").eq("fleet_id", fleet.id).in("status", ["invited", "active"]);
        if (mErr) throw mErr;
        const memberIds = (memberships || []).map((m) => m.driver_id);
        const { data: drivers, error: dErr } = memberIds.length
          ? await supabase.from("drivers").select("id, first_name, full_name, name, online, is_online").in("id", memberIds)
          : { data: [], error: null };
        if (dErr) throw dErr;
        const { data: assignments, error: aErr } = vehicleIds.length
          ? await supabase.from("vehicle_assignments").select("*").in("vehicle_id", vehicleIds).is("ends_at", null)
          : { data: [], error: null };
        if (aErr) throw aErr;
        const { data: earnings, error: eErr } = await supabase.from("driver_earnings").select("driver_id, total_earning, fleet_owner_share_amount").eq("fleet_id", fleet.id);
        if (eErr) throw eErr;
        const stats = {};
        for (const e of earnings || []) {
          const s = (stats[e.driver_id] = stats[e.driver_id] || { trips: 0, earnings: 0, owner_share: 0 });
          s.trips += 1;
          s.earnings = Math.round((s.earnings + Number(e.total_earning || 0)) * 100) / 100;
          s.owner_share = Math.round((s.owner_share + Number(e.fleet_owner_share_amount || 0)) * 100) / 100;
        }
        owned = {
          id: fleet.id,
          name: fleet.name,
          status: fleet.status,
          review_reason: fleet.status === "declined" || fleet.status === "suspended" ? fleet.review_reason : null,
          vehicles: (vehicles || []).map((v) => {
            const vDocs = docs.filter((d) => d.vehicle_id === v.id);
            return {
              id: v.id,
              label: `${v.vehicle_year} ${v.make} ${v.model}`,
              color: v.color,
              plate: v.plate,
              plate_state: v.plate_state,
              status: v.status,
              documents: vDocs.map((d) => ({ document_type: d.document_type, expires_on: d.expires_on, verification_status: d.verification_status })),
              ready: fleetRules.vehicleDispatchable(v, vDocs)
            };
          }),
          members: (memberships || []).map((m) => {
            const assignment = (assignments || []).find((a) => a.membership_id === m.id) || null;
            return fleetRules.ownerViewOfMember({
              membership: m,
              driver: (drivers || []).find((d) => d.id === m.driver_id),
              assignment,
              vehicle: assignment ? (vehicles || []).find((v) => v.id === assignment.vehicle_id) : null,
              stats: stats[m.driver_id]
            });
          })
        };
      }
      const { data: myMemberships, error: myErr } = await supabase.from("fleet_memberships").select("*").eq("driver_id", me).in("status", ["invited", "active"]);
      if (myErr) throw myErr;
      const fleetIds = [...new Set((myMemberships || []).map((m) => m.fleet_id))];
      const { data: fleetNames, error: fnErr } = fleetIds.length ? await supabase.from("fleets").select("id, name").in("id", fleetIds) : { data: [], error: null };
      if (fnErr) throw fnErr;
      const assignment = await openAssignmentForDriver(me);
      let assignedVehicle = null;
      if (assignment) {
        const { data: v, error: avErr } = await supabase.from("fleet_vehicles").select("*").eq("id", assignment.vehicle_id).maybeSingle();
        if (avErr) throw avErr;
        if (v) assignedVehicle = { assignment_id: assignment.id, id: v.id, label: `${v.vehicle_year} ${v.make} ${v.model}`, plate: v.plate, since: assignment.starts_at };
      }
      const { data: myEarnings, error: meErr } = await supabase.from("driver_earnings").select("total_earning, fleet_owner_share_amount").eq("driver_id", me).not("fleet_id", "is", null);
      if (meErr) throw meErr;
      const totals = (myEarnings || []).reduce(
        (t, e) => ({ trips: t.trips + 1, earnings: Math.round((t.earnings + Number(e.total_earning || 0)) * 100) / 100, owner_share: Math.round((t.owner_share + Number(e.fleet_owner_share_amount || 0)) * 100) / 100 }),
        { trips: 0, earnings: 0, owner_share: 0 }
      );
      return ok(res, {
        owned_fleet: owned,
        memberships: (myMemberships || []).map((m) => ({
          id: m.id,
          fleet_name: ((fleetNames || []).find((f) => f.id === m.fleet_id) || {}).name || "Fleet",
          status: m.status,
          owner_share_pct: Number(m.owner_share_pct),
          agreement_version: m.agreement_version
        })),
        assigned_vehicle: assignedVehicle,
        fleet_earnings: totals,
        limits: { max_vehicles: fleetRules.MAX_VEHICLES_PER_FLEET, max_owner_share_pct: fleetRules.MAX_OWNER_SHARE_PCT },
        payouts_note: "Earnings splits are recorded only. Harvey Taxi doesn't move money between fleet owners and drivers yet."
      });
    } catch (error) {
      return fleetRouteError(res, error, "Fleet details could not be loaded.");
    }
  })
);

app.post(
  "/api/driver/fleet/apply",
  requireDriverSelf,
  requireFleetsOn,
  asyncRoute(async (req, res) => {
    const me = req.driver.id;
    const parsed = fleetRules.validateFleetName(req.body);
    if (!parsed.ok) return fail(res, parsed.error, parsed.statusCode);
    if (!fleetDriverReady(req.driver)) return fail(res, "Finish your own driver verification before applying for a fleet.", 403);
    try {
      const { data: openFleets, error: cErr } = await supabase.from("fleets").select("id").in("status", ["pending", "active", "suspended"]);
      if (cErr) throw cErr;
      if ((openFleets || []).length >= fleetRules.MAX_PILOT_FLEETS) return fail(res, "The fleet pilot is full right now. Please contact support to join the waitlist.", 409);
      const { data, error } = await supabase.from("fleets").insert({ id: crypto.randomUUID(), owner_driver_id: me, name: parsed.name, status: "pending" }).select("id, name, status").single();
      if (error) {
        if (error.code === "23505") return fail(res, "You already have a fleet application.", 409);
        throw error;
      }
      auditLog({ actor_type: "driver", actor_id: me, action: "fleet_applied", entity_type: "fleet", entity_id: data.id, req }).catch(() => {});
      return ok(res, { fleet: data }, 201);
    } catch (error) {
      return fleetRouteError(res, error, "The fleet application could not be saved.");
    }
  })
);

async function activeOwnedFleetOr403(req, res) {
  const fleet = await ownedFleet(req.driver.id);
  if (!fleet || fleet.status !== "active") {
    fail(res, "Your fleet must be approved by Harvey Taxi first.", 403);
    return null;
  }
  return fleet;
}

app.post(
  "/api/driver/fleet/vehicles",
  requireDriverSelf,
  requireFleetsOn,
  asyncRoute(async (req, res) => {
    const parsed = fleetRules.validateVehicle(req.body);
    if (!parsed.ok) return fail(res, parsed.error, parsed.statusCode);
    try {
      const fleet = await activeOwnedFleetOr403(req, res);
      if (!fleet) return undefined;
      const { data: fleetVehicles, error: cErr } = await supabase.from("fleet_vehicles").select("id").eq("fleet_id", fleet.id).neq("status", "inactive");
      if (cErr) throw cErr;
      if ((fleetVehicles || []).length >= fleetRules.MAX_VEHICLES_PER_FLEET) return fail(res, `The pilot allows up to ${fleetRules.MAX_VEHICLES_PER_FLEET} vehicles per fleet.`, 409);
      const { data, error } = await supabase.from("fleet_vehicles").insert({ id: crypto.randomUUID(), ...parsed.row, fleet_id: fleet.id, status: "pending_review" }).select("id, status").single();
      if (error) {
        if (error.code === "23505") return fail(res, "That plate is already registered to a fleet vehicle.", 409);
        throw error;
      }
      auditLog({ actor_type: "driver", actor_id: req.driver.id, action: "fleet_vehicle_added", entity_type: "fleet", entity_id: fleet.id, metadata: { vehicle_id: data.id }, req }).catch(() => {});
      return ok(res, { vehicle: data }, 201);
    } catch (error) {
      return fleetRouteError(res, error, "The vehicle could not be saved.");
    }
  })
);

// Supersedes the current record of that type and adds a new one.
async function recordVehicleDocument({ vehicleId, documentType, expiresOn, recordedBy, staff }) {
  const now = nowIso();
  const { error: supErr } = await supabase
    .from("fleet_vehicle_documents")
    .update({ superseded_at: now, superseded_by: recordedBy })
    .eq("vehicle_id", vehicleId)
    .eq("document_type", documentType)
    .is("superseded_at", null);
  if (supErr) throw supErr;
  const row = {
    vehicle_id: vehicleId,
    document_type: documentType,
    expires_on: expiresOn,
    source: staff ? "staff_from_document" : "owner_entered",
    verification_status: staff ? "staff_verified" : "unverified",
    recorded_by: recordedBy,
    recorded_at: now,
    verified_by: staff ? recordedBy : null,
    verified_at: staff ? now : null
  };
  const { error } = await supabase.from("fleet_vehicle_documents").insert(row);
  if (error) throw error;
}

app.post(
  "/api/driver/fleet/vehicles/:id/documents",
  requireDriverSelf,
  requireFleetsOn,
  asyncRoute(async (req, res) => {
    const parsed = fleetRules.validateDocumentDate(req.body);
    if (!parsed.ok) return fail(res, parsed.error, parsed.statusCode);
    try {
      const fleet = await activeOwnedFleetOr403(req, res);
      if (!fleet) return undefined;
      const vehicleId = cleanString(req.params.id, 64);
      const { data: vehicle, error: vErr } = await supabase.from("fleet_vehicles").select("id, fleet_id").eq("id", vehicleId).maybeSingle();
      if (vErr) throw vErr;
      if (!vehicle || vehicle.fleet_id !== fleet.id) return fail(res, "Vehicle not found.", 404);
      await recordVehicleDocument({ vehicleId, documentType: parsed.document_type, expiresOn: parsed.expires_on, recordedBy: req.driver.id, staff: false });
      auditLog({ actor_type: "driver", actor_id: req.driver.id, action: "fleet_vehicle_document_entered", entity_type: "fleet", entity_id: fleet.id, metadata: { vehicle_id: vehicleId, document_type: parsed.document_type }, req }).catch(() => {});
      return ok(res, { recorded: true, verification_status: "unverified", note: "Harvey Taxi staff check the document before the vehicle can carry riders." }, 201);
    } catch (error) {
      return fleetRouteError(res, error, "The document date could not be saved.");
    }
  })
);

app.post(
  "/api/driver/fleet/invitations",
  requireDriverSelf,
  requireFleetsOn,
  asyncRoute(async (req, res) => {
    const parsed = fleetRules.validateInvitation(req.body);
    if (!parsed.ok) return fail(res, parsed.error, parsed.statusCode);
    try {
      const fleet = await activeOwnedFleetOr403(req, res);
      if (!fleet) return undefined;
      const last10 = parsed.phone.slice(-10);
      const { data: matches, error: dErr } = await supabase
        .from("drivers")
        .select("id")
        .or([parsed.phone, last10].flatMap((p) => [`phone.eq.${p}`, `phone_number.eq.${p}`, `mobile.eq.${p}`]).join(","))
        .limit(3);
      if (dErr) throw dErr;
      const ids = [...new Set((matches || []).map((d) => d.id))];
      if (!ids.length) return fail(res, "No Harvey Taxi driver uses that number. Ask them to apply as a driver first.", 404);
      if (ids.length > 1) return fail(res, "More than one driver account uses that number. Please contact support.", 409);
      const driverId = ids[0];
      if (driverId === req.driver.id) return fail(res, "You can't invite yourself.", 400);
      const { data: active, error: aErr } = await supabase.from("fleet_memberships").select("id").eq("driver_id", driverId).eq("status", "active").limit(1);
      if (aErr) throw aErr;
      if (active && active.length) return fail(res, "That driver already drives for a fleet.", 409);
      const { data, error } = await supabase
        .from("fleet_memberships")
        .insert({ id: crypto.randomUUID(), fleet_id: fleet.id, driver_id: driverId, status: "invited", owner_share_pct: parsed.owner_share_pct, agreement_version: fleetRules.AGREEMENT_VERSION, invited_by: req.driver.id })
        .select("id, status, owner_share_pct")
        .single();
      if (error) {
        if (error.code === "23505") return fail(res, "That driver already has an invitation from your fleet.", 409);
        throw error;
      }
      auditLog({ actor_type: "driver", actor_id: req.driver.id, action: "fleet_driver_invited", entity_type: "fleet", entity_id: fleet.id, metadata: { membership_id: data.id, owner_share_pct: parsed.owner_share_pct }, req }).catch(() => {});
      return ok(res, { invitation: { id: data.id, status: data.status, owner_share_pct: Number(data.owner_share_pct) } }, 201);
    } catch (error) {
      return fleetRouteError(res, error, "The invitation could not be saved.");
    }
  })
);

// Only the invited driver can accept or decline.
app.post(
  "/api/driver/fleet/invitations/:id/respond",
  requireDriverSelf,
  requireFleetsOn,
  asyncRoute(async (req, res) => {
    const id = cleanString(req.params.id, 64);
    const accept = req.body && req.body.accept === true;
    try {
      const { data: membership, error: mErr } = await supabase.from("fleet_memberships").select("*").eq("id", id).maybeSingle();
      if (mErr) throw mErr;
      if (!membership || membership.driver_id !== req.driver.id) return fail(res, "Invitation not found.", 404);
      if (membership.status !== "invited") return fail(res, "That invitation has already been answered.", 409);
      if (accept && !fleetDriverReady(req.driver)) return fail(res, "Finish your driver verification before joining a fleet.", 403);
      const status = accept ? "active" : "declined";
      const { data, error } = await supabase
        .from("fleet_memberships")
        .update({ status, responded_at: nowIso() })
        .eq("id", id)
        .eq("status", "invited")
        .select("id, status")
        .maybeSingle();
      if (error) {
        if (error.code === "23505") return fail(res, "You already drive for a fleet. Leave it first.", 409);
        throw error;
      }
      if (!data) return fail(res, "That invitation has already been answered.", 409);
      auditLog({ actor_type: "driver", actor_id: req.driver.id, action: accept ? "fleet_invitation_accepted" : "fleet_invitation_declined", entity_type: "fleet", entity_id: membership.fleet_id, metadata: { membership_id: id, owner_share_pct: Number(membership.owner_share_pct), agreement_version: membership.agreement_version }, req }).catch(() => {});
      return ok(res, { membership: data });
    } catch (error) {
      return fleetRouteError(res, error, "Your answer could not be saved.");
    }
  })
);

// The fleet owner or the driver can end a membership.
app.post(
  "/api/driver/fleet/memberships/:id/end",
  requireDriverSelf,
  requireFleetsOn,
  asyncRoute(async (req, res) => {
    const id = cleanString(req.params.id, 64);
    try {
      const { data: membership, error: mErr } = await supabase.from("fleet_memberships").select("*").eq("id", id).maybeSingle();
      if (mErr) throw mErr;
      if (!membership || !["invited", "active"].includes(membership.status)) return fail(res, "Membership not found.", 404);
      const fleet = await ownedFleet(req.driver.id);
      const isOwner = Boolean(fleet && fleet.id === membership.fleet_id);
      if (!isOwner && membership.driver_id !== req.driver.id) return fail(res, "Membership not found.", 404);
      const { data: open, error: oErr } = await supabase.from("vehicle_assignments").select("*").eq("membership_id", id).is("ends_at", null);
      if (oErr) throw oErr;
      for (const assignment of open || []) {
        const result = await endVehicleAssignment(assignment, req.driver.id, req);
        if (!result.ok) return fail(res, result.error, result.statusCode);
      }
      const { error } = await supabase
        .from("fleet_memberships")
        .update({ status: "ended", ended_by: req.driver.id, ended_at: nowIso(), responded_at: membership.responded_at || nowIso(), end_reason: cleanString(req.body && req.body.reason, 500) || null })
        .eq("id", id)
        .in("status", ["invited", "active"]);
      if (error) throw error;
      auditLog({ actor_type: "driver", actor_id: req.driver.id, action: "fleet_membership_ended", entity_type: "fleet", entity_id: membership.fleet_id, metadata: { membership_id: id, by: isOwner ? "owner" : "driver" }, req }).catch(() => {});
      return ok(res, { ended: true });
    } catch (error) {
      return fleetRouteError(res, error, "The membership could not be ended.");
    }
  })
);

app.post(
  "/api/driver/fleet/assignments",
  requireDriverSelf,
  requireFleetsOn,
  asyncRoute(async (req, res) => {
    const vehicleId = cleanString(req.body && req.body.vehicle_id, 64);
    const membershipId = cleanString(req.body && req.body.membership_id, 64);
    if (!vehicleId || !membershipId) return fail(res, "Choose a vehicle and a driver.", 400);
    try {
      const fleet = await activeOwnedFleetOr403(req, res);
      if (!fleet) return undefined;
      const { data: vehicle, error: vErr } = await supabase.from("fleet_vehicles").select("*").eq("id", vehicleId).maybeSingle();
      if (vErr) throw vErr;
      if (!vehicle || vehicle.fleet_id !== fleet.id) return fail(res, "Vehicle not found.", 404);
      const ready = fleetRules.vehicleDispatchable(vehicle, await currentVehicleDocuments([vehicleId]));
      if (!ready.ok) return fail(res, "This vehicle can't carry riders yet: it needs staff-verified, current insurance and registration and an active status.", 409, { reasons: ready.reasons });
      const { data: membership, error: mErr } = await supabase.from("fleet_memberships").select("*").eq("id", membershipId).maybeSingle();
      if (mErr) throw mErr;
      if (!membership || membership.fleet_id !== fleet.id || membership.status !== "active") return fail(res, "That driver isn't an active member of your fleet.", 404);
      const { data: driver, error: dErr } = await supabase.from("drivers").select("*").eq("id", membership.driver_id).maybeSingle();
      if (dErr) throw dErr;
      if (!driver || !fleetDriverReady(driver)) return fail(res, "That driver's verification isn't complete.", 409);
      if (driver.online || driver.is_online) return fail(res, "The driver must be offline before a vehicle is assigned.", 409);
      if (await driverOnTrip(driver.id)) return fail(res, "The driver is on a trip.", 409);
      const { data: assignment, error: aErr } = await supabase
        .from("vehicle_assignments")
        .insert({ id: crypto.randomUUID(), vehicle_id: vehicleId, driver_id: driver.id, membership_id: membershipId, previous_vehicle: fleetRules.previousVehicleSnapshot(driver), assigned_by: req.driver.id })
        .select("id, starts_at")
        .single();
      if (aErr) {
        if (aErr.code === "23505") return fail(res, "That vehicle or driver already has an assignment. End it first.", 409);
        throw aErr;
      }
      const { error: uErr } = await supabase.from("drivers").update({ ...fleetRules.driverFieldsForVehicle(vehicle), updated_at: nowIso() }).eq("id", driver.id);
      if (uErr) {
        await supabase.from("vehicle_assignments").update({ ends_at: nowIso(), ended_by: "system:rollback" }).eq("id", assignment.id);
        throw uErr;
      }
      auditLog({ actor_type: "driver", actor_id: req.driver.id, action: "fleet_vehicle_assigned", entity_type: "fleet", entity_id: fleet.id, metadata: { assignment_id: assignment.id, vehicle_id: vehicleId, membership_id: membershipId }, req }).catch(() => {});
      return ok(res, { assignment: { id: assignment.id, starts_at: assignment.starts_at } }, 201);
    } catch (error) {
      return fleetRouteError(res, error, "The vehicle could not be assigned.");
    }
  })
);

// The fleet owner or the assigned driver can end an assignment.
app.post(
  "/api/driver/fleet/assignments/:id/end",
  requireDriverSelf,
  requireFleetsOn,
  asyncRoute(async (req, res) => {
    const id = cleanString(req.params.id, 64);
    try {
      const { data: assignment, error } = await supabase.from("vehicle_assignments").select("*").eq("id", id).is("ends_at", null).maybeSingle();
      if (error) throw error;
      if (!assignment) return fail(res, "Assignment not found.", 404);
      const fleet = await ownedFleet(req.driver.id);
      let isOwner = false;
      if (fleet) {
        const { data: v, error: vErr } = await supabase.from("fleet_vehicles").select("fleet_id").eq("id", assignment.vehicle_id).maybeSingle();
        if (vErr) throw vErr;
        isOwner = Boolean(v && v.fleet_id === fleet.id);
      }
      if (!isOwner && assignment.driver_id !== req.driver.id) return fail(res, "Assignment not found.", 404);
      const result = await endVehicleAssignment(assignment, req.driver.id, req);
      if (!result.ok) return fail(res, result.error, result.statusCode);
      return ok(res, { ended: true });
    } catch (error) {
      return fleetRouteError(res, error, "The assignment could not be ended.");
    }
  })
);

// Staff: list, review and verify. Work whether or not the switch is on.
app.get(
  "/api/admin/fleets",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const { data: fleets, error } = await supabase.from("fleets").select("*").order("created_at", { ascending: false }).limit(100);
    if (fleetTableMissing(error)) return ok(res, { fleets: [], not_set_up: true });
    if (error) return fleetRouteError(res, error, "Fleets could not be loaded.");
    try {
      const fleetIds = (fleets || []).map((f) => f.id);
      const { data: vehicles, error: vErr } = fleetIds.length ? await supabase.from("fleet_vehicles").select("*").in("fleet_id", fleetIds) : { data: [], error: null };
      if (vErr) throw vErr;
      const docs = await currentVehicleDocuments((vehicles || []).map((v) => v.id));
      const { data: memberships, error: mErr } = fleetIds.length ? await supabase.from("fleet_memberships").select("fleet_id, status").in("fleet_id", fleetIds) : { data: [], error: null };
      if (mErr) throw mErr;
      const ownerIds = [...new Set((fleets || []).map((f) => f.owner_driver_id))];
      const { data: owners, error: oErr } = ownerIds.length ? await supabase.from("drivers").select("*").in("id", ownerIds) : { data: [], error: null };
      if (oErr) throw oErr;
      return ok(res, {
        enabled: await fleetManagementEnabled(),
        fleets: (fleets || []).map((f) => {
          const owner = (owners || []).find((o) => o.id === f.owner_driver_id);
          return {
            id: f.id,
            name: f.name,
            status: f.status,
            review_reason: f.review_reason,
            created_at: f.created_at,
            owner: owner ? { id: owner.id, name: [owner.first_name, owner.last_name].filter(Boolean).join(" ") || owner.full_name || owner.name || owner.id, verified: fleetDriverReady(owner) } : null,
            members: {
              active: (memberships || []).filter((m) => m.fleet_id === f.id && m.status === "active").length,
              invited: (memberships || []).filter((m) => m.fleet_id === f.id && m.status === "invited").length
            },
            vehicles: (vehicles || []).filter((v) => v.fleet_id === f.id).map((v) => {
              const vDocs = docs.filter((d) => d.vehicle_id === v.id);
              return {
                id: v.id,
                label: `${v.vehicle_year} ${v.make} ${v.model}`,
                color: v.color,
                plate: `${v.plate} (${v.plate_state})`,
                vin_last6: v.vin_last6,
                status: v.status,
                status_reason: v.status_reason,
                documents: vDocs.map((d) => ({ document_type: d.document_type, expires_on: d.expires_on, source: d.source, verification_status: d.verification_status })),
                documents_ready: fleetRules.documentsReady(vDocs)
              };
            })
          };
        })
      });
    } catch (err) {
      return fleetRouteError(res, err, "Fleets could not be loaded.");
    }
  })
);

const FLEET_REVIEW_TRANSITIONS = { approve: ["pending", "active"], decline: ["pending", "declined"], suspend: ["active", "suspended"], reinstate: ["suspended", "active"] };
const FLEET_REVIEW_PAST = { approve: "approved", decline: "declined", suspend: "suspended", reinstate: "reinstated" };

app.post(
  "/api/admin/fleets/:id/review",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const id = cleanString(req.params.id, 64);
    const decision = cleanString(req.body && req.body.decision, 20);
    const reason = cleanString(req.body && req.body.reason, 500);
    const transition = FLEET_REVIEW_TRANSITIONS[decision];
    if (!transition) return fail(res, "Decision must be approve, decline, suspend or reinstate.", 400);
    if ((decision === "decline" || decision === "suspend") && reason.length < 3) return fail(res, "Give a reason (at least 3 characters).", 400);
    try {
      const { data: fleet, error } = await supabase.from("fleets").select("*").eq("id", id).maybeSingle();
      if (error) throw error;
      if (!fleet) return fail(res, "Fleet not found.", 404);
      if (fleet.status !== transition[0]) return fail(res, `Only a ${transition[0]} fleet can be ${FLEET_REVIEW_PAST[decision]}.`, 409);
      if (transition[1] === "active") {
        const { data: owner, error: oErr } = await supabase.from("drivers").select("*").eq("id", fleet.owner_driver_id).maybeSingle();
        if (oErr) throw oErr;
        if (!owner || !fleetDriverReady(owner)) return fail(res, "The owner's own driver verification isn't complete.", 409);
      }
      if (decision === "suspend") {
        const { data: vehicles, error: vErr } = await supabase.from("fleet_vehicles").select("id").eq("fleet_id", id);
        if (vErr) throw vErr;
        const ended = await endOpenAssignmentsForVehicles((vehicles || []).map((v) => v.id), `admin:${req.admin.email || req.admin.id}`, req);
        if (!ended.ok) return fail(res, ended.error, ended.statusCode);
      }
      const { data: updated, error: uErr } = await supabase
        .from("fleets")
        .update({ status: transition[1], review_reason: reason || null, reviewed_by: req.admin.email || req.admin.id, reviewed_at: nowIso(), updated_at: nowIso() })
        .eq("id", id)
        .eq("status", transition[0])
        .select("id, status")
        .maybeSingle();
      if (uErr) throw uErr;
      if (!updated) return fail(res, "The fleet changed in the meantime. Reload and try again.", 409);
      auditLog({ actor_type: "admin", actor_id: req.admin.email, action: `fleet_${FLEET_REVIEW_PAST[decision]}`, entity_type: "fleet", entity_id: id, metadata: { from: transition[0], to: transition[1] }, req }).catch(() => {});
      return ok(res, { fleet: updated });
    } catch (err) {
      return fleetRouteError(res, err, "The decision could not be saved.");
    }
  })
);

// Staff enter a document's expiry date while looking at the document.
app.post(
  "/api/admin/fleet-vehicles/:id/documents",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const vehicleId = cleanString(req.params.id, 64);
    const parsed = fleetRules.validateDocumentDate(req.body);
    if (!parsed.ok) return fail(res, parsed.error, parsed.statusCode);
    try {
      const { data: vehicle, error } = await supabase.from("fleet_vehicles").select("id, fleet_id").eq("id", vehicleId).maybeSingle();
      if (error) throw error;
      if (!vehicle) return fail(res, "Vehicle not found.", 404);
      await recordVehicleDocument({ vehicleId, documentType: parsed.document_type, expiresOn: parsed.expires_on, recordedBy: req.admin.email || req.admin.id, staff: true });
      auditLog({ actor_type: "admin", actor_id: req.admin.email, action: "fleet_vehicle_document_verified", entity_type: "fleet", entity_id: vehicle.fleet_id, metadata: { vehicle_id: vehicleId, document_type: parsed.document_type, expires_on: parsed.expires_on }, req }).catch(() => {});
      return ok(res, { recorded: true, verification_status: "staff_verified" }, 201);
    } catch (err) {
      return fleetRouteError(res, err, "The document could not be recorded.");
    }
  })
);

const FLEET_VEHICLE_STATUSES = ["active", "suspended", "inactive"];

app.post(
  "/api/admin/fleet-vehicles/:id/status",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const vehicleId = cleanString(req.params.id, 64);
    const status = cleanString(req.body && req.body.status, 20);
    const reason = cleanString(req.body && req.body.reason, 500);
    if (!FLEET_VEHICLE_STATUSES.includes(status)) return fail(res, "Status must be active, suspended or inactive.", 400);
    if (status === "suspended" && reason.length < 3) return fail(res, "Give a reason (at least 3 characters).", 400);
    try {
      const { data: vehicle, error } = await supabase.from("fleet_vehicles").select("*").eq("id", vehicleId).maybeSingle();
      if (error) throw error;
      if (!vehicle) return fail(res, "Vehicle not found.", 404);
      if (status === "active") {
        const { data: fleet, error: fErr } = await supabase.from("fleets").select("status").eq("id", vehicle.fleet_id).maybeSingle();
        if (fErr) throw fErr;
        if (!fleet || fleet.status !== "active") return fail(res, "The fleet must be active first.", 409);
        const docs = fleetRules.documentsReady(await currentVehicleDocuments([vehicleId]));
        if (!docs.ok) return fail(res, "Verify current insurance and registration before activating the vehicle.", 409, { reasons: docs.reasons });
      } else {
        const ended = await endOpenAssignmentsForVehicles([vehicleId], `admin:${req.admin.email || req.admin.id}`, req);
        if (!ended.ok) return fail(res, ended.error, ended.statusCode);
      }
      const { error: uErr } = await supabase
        .from("fleet_vehicles")
        .update({ status, status_reason: reason || null, status_changed_by: req.admin.email || req.admin.id, status_changed_at: nowIso(), updated_at: nowIso() })
        .eq("id", vehicleId);
      if (uErr) {
        if (uErr.code === "23505") return fail(res, "That plate is already in use by another fleet vehicle.", 409);
        throw uErr;
      }
      auditLog({ actor_type: "admin", actor_id: req.admin.email, action: "fleet_vehicle_status_changed", entity_type: "fleet", entity_id: vehicle.fleet_id, metadata: { vehicle_id: vehicleId, from: vehicle.status, to: status }, req }).catch(() => {});
      return ok(res, { vehicle: { id: vehicleId, status } });
    } catch (err) {
      return fleetRouteError(res, err, "The vehicle status could not be saved.");
    }
  })
);

for (const [path, value, action] of [
  ["/api/admin/system/enable-fleet-management", "true", "fleet_management_enabled"],
  ["/api/admin/system/disable-fleet-management", "false", "fleet_management_disabled"]
]) {
  app.post(
    path,
    requireAdmin,
    asyncRoute(async (req, res) => {
      const { error } = await supabase.from("system_flags").upsert({ key: fleetRules.FLEET_FLAG, value, reason: cleanString(req.body && req.body.reason, 1000) || null, updated_at: nowIso() });
      if (error) return fail(res, "The switch could not be saved.", 502);
      auditLog({ actor_type: "admin", actor_id: req.admin.email, action, req }).catch(() => {});
      return ok(res, { fleet_management_enabled: value === "true" });
    })
  );
}

/* =========================================================
   BUSINESS PARTNERSHIP INQUIRIES (owner decision 2026-10-22)
   The second path on merchant-apply.html: hotels, healthcare
   organizations, businesses and local merchants asking to talk about a
   partnership. Stored in partnership_inquiries (migration
   20261022010000), emailed to support, listed for staff with a status
   (new, contacted, closed). Nothing is approved by submitting one.
========================================================= */
const partnershipRules = require("./lib/partnerships");
const PARTNERSHIP_INQUIRY_EMAIL = env("PARTNERSHIP_INQUIRY_EMAIL", "support@harveytaxiservice.com");
const PARTNERSHIP_FIELDS = "id, organization_name, website, business_type, industry, address_line, city, state, postal_code, contact_name, job_title, contact_email, contact_phone, interests, message, consent_version, consented_at, status, staff_note, reviewed_by, reviewed_at, created_at, updated_at";

app.post(
  "/api/partnerships/inquiries",
  rateLimit({ windowMs: 60 * 60_000, max: 5, keyPrefix: "partnership_inquiry" }),
  asyncRoute(async (req, res) => {
    const body = req.body || {};
    // Automated submissions get the same reply and are not stored.
    const spam = partnershipRules.looksAutomated(body);
    if (spam) {
      auditLog({ actor_type: "partnership_applicant", action: "partnership_inquiry_dropped", entity_type: "partnership_inquiry", metadata: { reason: spam }, req }).catch(() => {});
      return ok(res, { received: true }, 201);
    }
    const checked = partnershipRules.validatePartnershipInquiry(body);
    if (!checked.ok) return fail(res, checked.error, 400);
    // The same contact with an inquiry still waiting: no second record.
    const { data: open, error: openError } = await supabase
      .from("partnership_inquiries")
      .select("id")
      .eq("contact_email", checked.row.contact_email)
      .eq("status", "new")
      .limit(1);
    if (openError) {
      if (openError.code === "42P01") return fail(res, "Partnership inquiries aren't open yet. Please email support@harveytaxiservice.com.", 503);
      return fail(res, "We couldn't save your inquiry. Please try again later.", 502);
    }
    if (open && open.length) return ok(res, { received: true, duplicate: true });
    const { data, error } = await supabase.from("partnership_inquiries").insert(checked.row).select("id,status").single();
    if (error) {
      if (error.code === "42P01") return fail(res, "Partnership inquiries aren't open yet. Please email support@harveytaxiservice.com.", 503);
      console.warn("⚠️ Partnership inquiry not saved:", { code: error.code || "unknown" });
      return fail(res, "We couldn't save your inquiry. Please try again later.", 502);
    }
    auditLog({
      actor_type: "partnership_applicant",
      action: "partnership_inquiry_submitted",
      entity_type: "partnership_inquiry",
      entity_id: data.id,
      metadata: { industry: checked.row.industry, business_type: checked.row.business_type, interests: checked.row.interests },
      req
    }).catch(() => {});
    // The stored row is the record; the email copy is a convenience and
    // its outcome is logged on its own.
    sendEmail({
      to: PARTNERSHIP_INQUIRY_EMAIL,
      subject: `Harvey Taxi partnership inquiry: ${checked.row.organization_name}`,
      text: partnershipRules.inquiryEmailText(checked.row, data.id),
      replyTo: checked.row.contact_email
    })
      .then((mail) => mail && mail.sent ? "accepted" : mail && mail.skipped ? "not_configured" : "failed")
      .catch(() => "failed")
      .then((status) => auditLog({ actor_type: "system", action: "partnership_inquiry_email", entity_type: "partnership_inquiry", entity_id: data.id, metadata: { status } }).catch(() => {}));
    return ok(res, { received: true, inquiry: { id: data.id, status: data.status } }, 201);
  })
);

app.get(
  "/api/admin/partnerships",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const status = cleanString(req.query.status, 20);
    let query = supabase.from("partnership_inquiries").select(PARTNERSHIP_FIELDS).order("created_at", { ascending: false }).limit(200);
    if (partnershipRules.STATUSES.includes(status)) query = query.eq("status", status);
    const { data, error } = await query;
    if (error) {
      if (error.code === "42P01") return ok(res, { inquiries: [], not_set_up: true });
      return fail(res, "Partnership inquiries could not be loaded.", 502);
    }
    return ok(res, {
      inquiries: (data || []).map((row) => ({
        ...row,
        business_type_label: partnershipRules.BUSINESS_TYPES[row.business_type] || row.business_type,
        industry_label: partnershipRules.INDUSTRIES[row.industry] || row.industry,
        interest_labels: (row.interests || []).map((i) => partnershipRules.INTERESTS[i] || i)
      }))
    });
  })
);

app.patch(
  "/api/admin/partnerships/:id",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const id = cleanString(req.params.id, 64);
    const { data: inquiry, error: readError } = await supabase.from("partnership_inquiries").select("id,status,staff_note").eq("id", id).maybeSingle();
    if (readError) return fail(res, "Inquiry could not be loaded.", 502);
    const plan = partnershipRules.planStatusChange({ inquiry, status: cleanString(req.body?.status, 20), note: req.body?.note, reviewer: req.admin.email });
    if (!plan.ok) return fail(res, plan.error, plan.statusCode);
    const { data, error } = await supabase.from("partnership_inquiries").update(plan.update).eq("id", id).select(PARTNERSHIP_FIELDS).single();
    if (error) return fail(res, "The status could not be saved. Nothing was changed.", 502);
    auditLog({
      actor_type: "admin",
      actor_id: req.admin.email,
      action: "partnership_inquiry_status_changed",
      entity_type: "partnership_inquiry",
      entity_id: id,
      metadata: { from: inquiry.status, to: plan.update.status },
      req
    }).catch(() => {});
    return ok(res, { inquiry: data });
  })
);

app.get(
  "/api/admin/merchants",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const { data, error } = await supabase
      .from("merchants")
      .select(merchantRules.ADMIN_MERCHANT_FIELDS.join(","))
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) {
      if (error.code === "42P01") return ok(res, { merchants: [], not_set_up: true });
      return fail(res, "Merchants could not be loaded.", 502);
    }
    // Review flags for staff, computed on read; they never change an
    // application (docs/agent-action-rules.md, rules 1 and 7).
    const flags = screenMerchants(data || []);
    // Sign-in people per store (phase 1b); missing before its migration.
    const ids = (data || []).map((m) => m.id);
    const usersByMerchant = {};
    if (ids.length) {
      const { data: users } = await supabase.from("merchant_users").select("id, merchant_id, name, phone, status, last_sign_in_at").in("merchant_id", ids);
      for (const u of users || []) (usersByMerchant[u.merchant_id] = usersByMerchant[u.merchant_id] || []).push(u);
    }
    // Pickup pins, read separately so the list still works before the pin
    // migration is applied.
    const pins = {};
    if (ids.length) {
      const { data: pinRows } = await supabase.from("merchants").select(["id", ...merchantRules.PICKUP_PIN_FIELDS].join(", ")).in("id", ids);
      for (const p of pinRows || []) pins[p.id] = p;
    }
    return ok(res, { merchants: (data || []).map((m) => ({ ...m, review_flags: flags[m.id] || [], sign_in_users: usersByMerchant[m.id] || [], pickup_pin: pins[m.id] && pins[m.id].pickup_lat != null ? { lat: pins[m.id].pickup_lat, lng: pins[m.id].pickup_lng, confirmed_by: pins[m.id].pickup_pin_confirmed_by, confirmed_at: pins[m.id].pickup_pin_confirmed_at } : null })) });
  })
);

app.patch(
  "/api/admin/merchants/:id/review",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const id = cleanString(req.params.id, 64);
    const { data: merchant, error: readError } = await supabase.from("merchants").select("id,status").eq("id", id).maybeSingle();
    if (readError) return fail(res, "Merchant could not be loaded.", 502);
    const plan = merchantRules.planMerchantReview({
      merchant,
      decision: cleanString(req.body && req.body.decision, 20).toLowerCase(),
      reason: req.body && req.body.reason,
      reviewer: req.admin.email
    });
    if (!plan.ok) return fail(res, plan.error, plan.statusCode);
    // Conditional on the status just read, so two staff reviewing at once
    // can't both apply a decision.
    const { data: updated, error } = await supabase
      .from("merchants")
      .update(plan.update)
      .eq("id", id)
      .eq("status", merchant.status)
      .select(merchantRules.ADMIN_MERCHANT_FIELDS.join(","))
      .maybeSingle();
    if (error) return fail(res, "The review could not be saved.", 502);
    if (!updated) return fail(res, "This merchant was changed by someone else. Reload and try again.", 409);
    auditLog({
      actor_type: "admin",
      actor_id: req.admin.email,
      action: `merchant_${plan.update.status}`,
      entity_type: "merchant",
      entity_id: id,
      metadata: { from: merchant.status, to: plan.update.status, reason: plan.update.review_reason }
    }).catch(() => {});
    return ok(res, { merchant: updated });
  })
);

/* =========================================================
   MERCHANT PORTAL, PHASE 1B: SIGN-IN AND STORE HOURS
   Owner decision 2026-10-17. Staff give an approved store sign-in access
   (one phone per person). The store signs in with a one-time code texted
   to that phone (Twilio Verify, as for riders), then sets its weekly
   opening hours. Same session design as riders: signed HttpOnly cookie,
   session_version for sign-out and access removal, and a custom request
   header on every call (CSRF). A suspended or rejected store can't sign
   in or change anything.
========================================================= */
const merchantAuth = require("./lib/merchantAuth");
const MERCHANT_SESSION_SECRET = env("MERCHANT_SESSION_SECRET", "");
const MERCHANT_SESSION_TTL_HOURS = envNumber("MERCHANT_SESSION_TTL_HOURS", 12);
const MERCHANT_SESSION_COOKIE = "harvey_merchant_session";
const MERCHANT_CLIENT_HEADER_VALUE = "harvey-merchant-portal";
const MERCHANT_USER_FIELDS = "id, merchant_id, phone, name, role, status, session_version, created_at, last_sign_in_at";

function hasMerchantClientHeader(req) {
  return req.headers["x-requested-with"] === MERCHANT_CLIENT_HEADER_VALUE;
}
function setMerchantSessionCookie(res, token, maxAgeSeconds) {
  const attrs = [`${MERCHANT_SESSION_COOKIE}=${encodeURIComponent(token)}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${maxAgeSeconds}`];
  if (IS_PRODUCTION) attrs.push("Secure");
  res.append("Set-Cookie", attrs.join("; "));
}
function merchantLoginDestinationKey(req) {
  return hashLoginDestination({ phone: cleanString(req.body?.phone, 32), email: "" });
}
// Exactly one active sign-in for this phone, at an approved store.
async function findMerchantUserByPhone(rawPhone) {
  const e164 = riderPhoneToE164(rawPhone);
  if (!e164) return null;
  const { data, error } = await supabase.from("merchant_users").select(MERCHANT_USER_FIELDS).eq("phone", e164).eq("status", "active").limit(2);
  if (error || !data || data.length !== 1) return null;
  const { data: merchant } = await supabase.from("merchants").select("id, status").eq("id", data[0].merchant_id).maybeSingle();
  if (!merchant || merchant.status !== "approved") return null;
  return { user: data[0], e164 };
}

async function requireMerchant(req, res, next) {
  try {
    if (!MERCHANT_SESSION_SECRET) return fail(res, "Store sign-in isn't available right now.", 503);
    if (!hasMerchantClientHeader(req)) return fail(res, "This request could not be verified.", 403);
    const check = merchantAuth.verifyMerchantSession({ token: parseCookies(req)[MERCHANT_SESSION_COOKIE], secret: MERCHANT_SESSION_SECRET });
    if (!check.ok) return fail(res, "Please sign in.", 401);
    const { data: user } = await supabase.from("merchant_users").select(MERCHANT_USER_FIELDS).eq("id", check.payload.merchant_user_id).maybeSingle();
    if (!user || user.status !== "active" || user.merchant_id !== check.payload.merchant_id || user.session_version !== check.payload.session_version) {
      return fail(res, "Please sign in.", 401);
    }
    const { data: merchant } = await supabase.from("merchants").select(merchantRules.ADMIN_MERCHANT_FIELDS.join(",")).eq("id", user.merchant_id).maybeSingle();
    if (!merchant || merchant.status !== "approved") return fail(res, "This store's access is paused. Please contact Harvey Taxi.", 403);
    req.merchantUser = user;
    req.merchant = merchant;
    return next();
  } catch (err) {
    return fail(res, "Please try again.", 500);
  }
}

// Same response whether or not the phone belongs to a store: no account
// enumeration. A code is texted only to an active sign-in at an approved store.
app.post(
  "/api/merchant/session/start",
  rateLimit({ windowMs: 60_000, max: 10, keyPrefix: "merchant_session_start_ip" }),
  rateLimit({ windowMs: 10 * 60_000, max: 3, keyPrefix: "merchant_session_start_dest", keyFn: merchantLoginDestinationKey }),
  asyncRoute(async (req, res) => {
    if (!MERCHANT_SESSION_SECRET) return fail(res, "Store sign-in isn't available right now.", 503);
    if (!hasMerchantClientHeader(req)) return fail(res, "This request could not be verified.", 403);
    if (!riderPhoneToE164(cleanString(req.body.phone, 32))) return fail(res, "Enter a 10-digit US phone number.", 400);
    if (!twilioClient || !TWILIO_VERIFY_SERVICE_SID) return fail(res, "Store sign-in isn't available right now.", 503);
    const found = await findMerchantUserByPhone(cleanString(req.body.phone, 32));
    if (found) {
      try {
        await twilioClient.verify.services(TWILIO_VERIFY_SERVICE_SID).verifications.create({ to: found.e164, channel: "sms" });
      } catch (err) {
        console.error("❌ Merchant sign-in: Twilio Verify send failed:", describeTwilioError(err));
      }
    }
    return ok(res, { sent: true });
  })
);

app.post(
  "/api/merchant/session/verify",
  rateLimit({ windowMs: 60_000, max: 15, keyPrefix: "merchant_session_verify_ip" }),
  rateLimit({ windowMs: 10 * 60_000, max: 10, keyPrefix: "merchant_session_verify_dest", keyFn: merchantLoginDestinationKey }),
  asyncRoute(async (req, res) => {
    if (!MERCHANT_SESSION_SECRET) return fail(res, "Store sign-in isn't available right now.", 503);
    if (!hasMerchantClientHeader(req)) return fail(res, "This request could not be verified.", 403);
    const code = cleanString(req.body.code, 12);
    const invalid = () => fail(res, "Invalid or expired code.", 400);
    if (!code || !twilioClient || !TWILIO_VERIFY_SERVICE_SID) return invalid();
    const found = await findMerchantUserByPhone(cleanString(req.body.phone, 32));
    if (!found) return invalid();
    let check;
    try {
      check = await twilioClient.verify.services(TWILIO_VERIFY_SERVICE_SID).verificationChecks.create({ to: found.e164, code });
    } catch (err) {
      console.error("❌ Merchant sign-in: Twilio Verify check failed:", describeTwilioError(err));
      return invalid();
    }
    if (!check || check.status !== "approved") return invalid();
    const token = merchantAuth.signMerchantSession({
      merchantUserId: found.user.id,
      merchantId: found.user.merchant_id,
      sessionVersion: found.user.session_version,
      secret: MERCHANT_SESSION_SECRET,
      ttlHours: MERCHANT_SESSION_TTL_HOURS
    });
    setMerchantSessionCookie(res, token, Math.round(MERCHANT_SESSION_TTL_HOURS * 3600));
    supabase.from("merchant_users").update({ last_sign_in_at: nowIso() }).eq("id", found.user.id).then(() => {}, () => {});
    auditLog({ actor_type: "merchant_user", actor_id: found.user.id, action: "merchant_sign_in", entity_type: "merchant", entity_id: found.user.merchant_id, req }).catch(() => {});
    return ok(res, { signed_in: true });
  })
);

// Sign-out ends every session for this person (session_version + 1).
app.post(
  "/api/merchant/session/logout",
  requireMerchant,
  asyncRoute(async (req, res) => {
    await supabase.rpc("bump_merchant_user_session_version", { p_user_id: req.merchantUser.id });
    setMerchantSessionCookie(res, "", 0);
    auditLog({ actor_type: "merchant_user", actor_id: req.merchantUser.id, action: "merchant_sign_out", entity_type: "merchant", entity_id: req.merchant.id, req }).catch(() => {});
    return ok(res, { signed_out: true });
  })
);

app.get(
  "/api/merchant/me",
  requireMerchant,
  asyncRoute(async (req, res) => {
    const { data: hours } = await supabase.from("merchant_hours").select("day_of_week, closed, opens_at, closes_at, updated_at").eq("merchant_id", req.merchant.id);
    const m = req.merchant;
    return ok(res, {
      store: { id: m.id, business_name: m.business_name, category: m.category, address_line: m.address_line, city: m.city, postal_code: m.postal_code, status: m.status },
      user: { name: req.merchantUser.name, role: req.merchantUser.role },
      hours: (hours || []).map((h) => ({ ...h, opens_at: h.opens_at ? String(h.opens_at).slice(0, 5) : null, closes_at: h.closes_at ? String(h.closes_at).slice(0, 5) : null })),
      time_zone: "America/Chicago"
    });
  })
);

app.put(
  "/api/merchant/hours",
  requireMerchant,
  asyncRoute(async (req, res) => {
    const checked = merchantAuth.validateStoreHours(req.body && req.body.days);
    if (!checked.ok) return fail(res, checked.error, 400);
    const now = nowIso();
    const rows = checked.rows.map((r) => ({ ...r, merchant_id: req.merchant.id, updated_by: req.merchantUser.id, updated_at: now }));
    const { error } = await supabase.from("merchant_hours").upsert(rows, { onConflict: "merchant_id,day_of_week" });
    if (error) return fail(res, "Hours could not be saved.", 502);
    auditLog({ actor_type: "merchant_user", actor_id: req.merchantUser.id, action: "merchant_hours_updated", entity_type: "merchant", entity_id: req.merchant.id, metadata: { days: checked.rows }, req }).catch(() => {});
    return ok(res, { hours: checked.rows });
  })
);

// Store pickup pin (owner decision 2026-10-18). Staff paste coordinates
// copied from a map at the store's pickup entrance. Orders need a pin, and
// a delivery-fee quote must start within 150 m of it. Audited.
app.post(
  "/api/admin/merchants/:id/pickup-pin",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const pin = merchantRules.parsePickupPin(req.body && req.body.pin);
    if (!pin.ok) return fail(res, pin.error, 400);
    const id = cleanString(req.params.id, 64);
    const { data, error } = await supabase
      .from("merchants")
      .update({ pickup_lat: pin.lat, pickup_lng: pin.lng, pickup_pin_confirmed_by: req.admin.email || req.admin.id, pickup_pin_confirmed_at: nowIso() })
      .eq("id", id)
      .in("status", ["approved", "suspended"])
      .select("id")
      .maybeSingle();
    if (error) return fail(res, error.code === "42703" ? "Pickup pins aren't set up yet (database migration not applied)." : "The pin could not be saved.", error.code === "42703" ? 503 : 502);
    if (!data) return fail(res, "Pins can be set for approved or paused stores only.", 409);
    auditLog({ actor_type: "admin", actor_id: req.admin.email, action: "merchant_pickup_pin_set", entity_type: "merchant", entity_id: id, metadata: { lat: pin.lat, lng: pin.lng }, req }).catch(() => {});
    return ok(res, { pickup_pin: { lat: pin.lat, lng: pin.lng } });
  })
);

// Staff give an approved store sign-in access for one phone.
app.post(
  "/api/admin/merchants/:id/users",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const id = cleanString(req.params.id, 64);
    const phone = riderPhoneToE164(cleanString(req.body && req.body.phone, 32));
    const name = cleanString(req.body && req.body.name, 120);
    if (!phone) return fail(res, "Enter a 10-digit US phone number.", 400);
    if (!name || name.length < 2) return fail(res, "Enter the person's name.", 400);
    const { data: merchant } = await supabase.from("merchants").select("id, status").eq("id", id).maybeSingle();
    if (!merchant) return fail(res, "Merchant not found.", 404);
    if (merchant.status !== "approved") return fail(res, "Only an approved store can be given sign-in access.", 409);
    const { data, error } = await supabase
      .from("merchant_users")
      .insert({ id: crypto.randomUUID(), merchant_id: id, phone, name, role: "owner", status: "active", session_version: 0, created_by: req.admin.email || req.admin.id })
      .select(MERCHANT_USER_FIELDS)
      .single();
    if (error) {
      if (error.code === "23505") return fail(res, "That phone already signs in to a store.", 409);
      if (error.code === "42P01") return fail(res, "Store sign-in isn't set up yet.", 503);
      return fail(res, "Sign-in access could not be saved.", 502);
    }
    auditLog({ actor_type: "admin", actor_id: req.admin.email, action: "merchant_user_added", entity_type: "merchant", entity_id: id, metadata: { merchant_user_id: data.id }, req }).catch(() => {});
    return ok(res, { user: { id: data.id, name: data.name, phone: data.phone, status: data.status } }, 201);
  })
);

// Removing access also ends that person's sessions.
app.post(
  "/api/admin/merchant-users/:id/disable",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const id = cleanString(req.params.id, 64);
    const { data: updated, error } = await supabase
      .from("merchant_users")
      .update({ status: "disabled", disabled_by: req.admin.email || req.admin.id, disabled_at: nowIso() })
      .eq("id", id)
      .eq("status", "active")
      .select("id, merchant_id")
      .maybeSingle();
    if (error) return fail(res, "Access could not be removed.", 502);
    if (!updated) return fail(res, "That sign-in is already removed or doesn't exist.", 409);
    await supabase.rpc("bump_merchant_user_session_version", { p_user_id: id });
    auditLog({ actor_type: "admin", actor_id: req.admin.email, action: "merchant_user_disabled", entity_type: "merchant", entity_id: updated.merchant_id, metadata: { merchant_user_id: id }, req }).catch(() => {});
    return ok(res, { disabled: true });
  })
);

/* =========================================================
   MERCHANT PORTAL, PHASE 2: STORE CATALOG
   Owner decision 2026-10-17 ("Start phase 2 catalog"). A signed-in store
   manages its own items (lib/catalog.js): add, edit, remove, CSV import.
   Items whose text suggests an excluded category (merchant term 3) are
   held for staff review, never rejected automatically; staff allow them
   or keep them hidden with a reason (docs/agent-action-rules.md, rule 7).
   An item staff kept hidden can be removed but not edited back. No
   ordering yet (phase 3); no photos yet.
========================================================= */
const catalogRules = require("./lib/catalog");
const CATALOG_FIELDS = "id, merchant_id, name, section, description, price_cents, available, substitutable, review_status, review_flags, review_reason, sort_order, updated_at";
const TEXT_FIELDS = ["name", "section", "description"];

function catalogItemView(i) {
  return { ...i, review_flag_labels: (i.review_flags || []).map((f) => catalogRules.LABELS[f] || f) };
}
async function loadStoreItem(req, id) {
  const { data } = await supabase.from("catalog_items").select(CATALOG_FIELDS).eq("id", cleanString(id, 64)).eq("merchant_id", req.merchant.id).is("archived_at", null).maybeSingle();
  return data || null;
}
// The database enforces this too (catalog_items_store_name_idx); checking
// first gives the store a clear message.
async function itemNameTaken(merchantId, name, exceptId = null) {
  const { data } = await supabase.from("catalog_items").select("id, name").eq("merchant_id", merchantId).is("archived_at", null);
  return (data || []).some((i) => i.id !== exceptId && String(i.name).toLowerCase() === name.toLowerCase());
}
async function liveItemCount(merchantId) {
  const { data } = await supabase.from("catalog_items").select("id").eq("merchant_id", merchantId).is("archived_at", null);
  return (data || []).length;
}

app.get(
  "/api/merchant/catalog",
  requireMerchant,
  asyncRoute(async (req, res) => {
    const { data, error } = await supabase.from("catalog_items").select(CATALOG_FIELDS).eq("merchant_id", req.merchant.id).is("archived_at", null).order("name", { ascending: true }).limit(catalogRules.MAX_ITEMS_PER_STORE);
    if (error) return fail(res, error.code === "42P01" ? "The catalog isn't set up yet." : "The catalog could not be loaded.", error.code === "42P01" ? 503 : 502);
    return ok(res, { items: (data || []).map(catalogItemView), limits: { max_items: catalogRules.MAX_ITEMS_PER_STORE, max_import_rows: catalogRules.MAX_IMPORT_ROWS } });
  })
);

app.post(
  "/api/merchant/catalog/items",
  requireMerchant,
  asyncRoute(async (req, res) => {
    const checked = catalogRules.validateItem(req.body || {});
    if (!checked.ok) return fail(res, checked.error, 400);
    if ((await liveItemCount(req.merchant.id)) >= catalogRules.MAX_ITEMS_PER_STORE) return fail(res, `A store can list up to ${catalogRules.MAX_ITEMS_PER_STORE} items.`, 409);
    if (await itemNameTaken(req.merchant.id, checked.value.name)) return fail(res, "An item with that name is already in your catalog.", 409);
    const review = catalogRules.reviewStateFor(catalogRules.screenItem(checked.value));
    const { data, error } = await supabase
      .from("catalog_items")
      .insert({ id: crypto.randomUUID(), merchant_id: req.merchant.id, ...checked.value, ...review, created_by: req.merchantUser.id, updated_by: req.merchantUser.id })
      .select(CATALOG_FIELDS)
      .single();
    if (error) {
      if (error.code === "23505") return fail(res, "An item with that name is already in your catalog.", 409);
      return fail(res, "The item could not be saved.", 502);
    }
    auditLog({ actor_type: "merchant_user", actor_id: req.merchantUser.id, action: "catalog_item_created", entity_type: "catalog_item", entity_id: data.id, metadata: { merchant_id: req.merchant.id, review_status: data.review_status }, req }).catch(() => {});
    return ok(res, { item: catalogItemView(data) }, 201);
  })
);

app.patch(
  "/api/merchant/catalog/items/:id",
  requireMerchant,
  asyncRoute(async (req, res) => {
    const item = await loadStoreItem(req, req.params.id);
    if (!item) return fail(res, "Item not found.", 404);
    if (item.review_status === "blocked") return fail(res, "Harvey Taxi kept this item hidden. You can remove it, or contact Harvey Taxi.", 409);
    const checked = catalogRules.validateItem(req.body || {}, { partial: true });
    if (!checked.ok) return fail(res, checked.error, 400);
    if (checked.value.name && (await itemNameTaken(req.merchant.id, checked.value.name, item.id))) return fail(res, "An item with that name is already in your catalog.", 409);
    const patch = { ...checked.value, updated_by: req.merchantUser.id, updated_at: nowIso() };
    // Changed text is screened again; a staff decision on the old text no longer applies.
    if (TEXT_FIELDS.some((k) => k in checked.value && checked.value[k] !== item[k])) {
      Object.assign(patch, catalogRules.reviewStateFor(catalogRules.screenItem({ ...item, ...checked.value })), { reviewed_by: null, reviewed_at: null, review_reason: null });
    }
    const { data, error } = await supabase.from("catalog_items").update(patch).eq("id", item.id).eq("merchant_id", req.merchant.id).neq("review_status", "blocked").select(CATALOG_FIELDS).maybeSingle();
    if (error) return fail(res, error.code === "23505" ? "An item with that name is already in your catalog." : "The item could not be saved.", error.code === "23505" ? 409 : 502);
    if (!data) return fail(res, "This item changed. Reload and try again.", 409);
    auditLog({ actor_type: "merchant_user", actor_id: req.merchantUser.id, action: "catalog_item_updated", entity_type: "catalog_item", entity_id: item.id, metadata: { merchant_id: req.merchant.id, fields: Object.keys(checked.value), review_status: data.review_status }, req }).catch(() => {});
    return ok(res, { item: catalogItemView(data) });
  })
);

app.delete(
  "/api/merchant/catalog/items/:id",
  requireMerchant,
  asyncRoute(async (req, res) => {
    const item = await loadStoreItem(req, req.params.id);
    if (!item) return fail(res, "Item not found.", 404);
    const { error } = await supabase.from("catalog_items").update({ archived_at: nowIso(), updated_by: req.merchantUser.id, updated_at: nowIso() }).eq("id", item.id).eq("merchant_id", req.merchant.id);
    if (error) return fail(res, "The item could not be removed.", 502);
    auditLog({ actor_type: "merchant_user", actor_id: req.merchantUser.id, action: "catalog_item_removed", entity_type: "catalog_item", entity_id: item.id, metadata: { merchant_id: req.merchant.id }, req }).catch(() => {});
    return ok(res, { removed: true });
  })
);

// CSV import, shared by the store portal and staff-assisted import.
// dryRun returns what would happen; otherwise new names are added and
// existing names updated (matched case-insensitively). Screening is the
// same whoever imports: possibly-excluded items are held for review, so a
// staff import never lists an item without the review step.
// actor: { type: "merchant_user" | "admin", id, merchantUserId (or null) }.
// Returns { status, body } for the route to send.
async function runCatalogImport({ merchantId, csv, dryRun, actor, req }) {
  const parsed = catalogRules.parseCatalogCsv(csv);
  if (!parsed.ok) return { status: 400, error: parsed.error };
  const { data: existing, error: readError } = await supabase.from("catalog_items").select(CATALOG_FIELDS).eq("merchant_id", merchantId).is("archived_at", null).limit(catalogRules.MAX_ITEMS_PER_STORE);
  if (readError) return { status: readError.code === "42P01" ? 503 : 502, error: readError.code === "42P01" ? "The catalog isn't set up yet." : "The catalog could not be loaded." };
  const byName = new Map((existing || []).map((i) => [i.name.toLowerCase(), i]));
  const creates = [];
  const updates = [];
  const skipped = [];
  for (const { line, value } of parsed.items) {
    const current = byName.get(value.name.toLowerCase());
    const review = catalogRules.reviewStateFor(catalogRules.screenItem({ ...(current || {}), ...value }));
    if (!current) creates.push({ line, value, review });
    else if (current.review_status === "blocked") skipped.push({ line, error: `"${current.name}" is hidden by Harvey Taxi and wasn't changed.` });
    else updates.push({ line, value, review, current });
  }
  if ((existing || []).length + creates.length > catalogRules.MAX_ITEMS_PER_STORE) return { status: 409, error: `A store can list up to ${catalogRules.MAX_ITEMS_PER_STORE} items.` };
  const held = [...creates, ...updates].filter((r) => r.review.review_status === "held").map((r) => r.value.name);
  const summary = { create: creates.length, update: updates.length, held, errors: [...parsed.errors, ...skipped] };
  if (dryRun) return { status: 200, body: { dry_run: true, ...summary } };

  const now = nowIso();
  const by = actor.merchantUserId || null;
  if (creates.length) {
    const rows = creates.map((r) => ({ id: crypto.randomUUID(), merchant_id: merchantId, ...r.value, ...r.review, created_by: by, updated_by: by }));
    const { error } = await supabase.from("catalog_items").insert(rows);
    if (error) return { status: 502, error: "The import could not be saved. Nothing was added." };
  }
  let updated = 0;
  for (const r of updates) {
    // Matched by name, so the item keeps the name it has ("WHOLE MILK" in
    // a file updates "Whole milk" without renaming it).
    r.value = { ...r.value, name: r.current.name };
    const textChanged = TEXT_FIELDS.some((k) => k in r.value && r.value[k] !== r.current[k]);
    const patch = { ...r.value, updated_by: by, updated_at: now, ...(textChanged ? { ...r.review, reviewed_by: null, reviewed_at: null, review_reason: null } : {}) };
    const { data } = await supabase.from("catalog_items").update(patch).eq("id", r.current.id).eq("merchant_id", merchantId).neq("review_status", "blocked").select("id").maybeSingle();
    if (data) updated += 1;
    else summary.errors.push({ line: r.line, error: `"${r.current.name}" changed during the import and wasn't updated.` });
  }
  auditLog({ actor_type: actor.type, actor_id: actor.id, action: actor.type === "admin" ? "catalog_imported_by_staff" : "catalog_imported", entity_type: "merchant", entity_id: merchantId, metadata: { created: creates.length, updated, held: held.length, errors: summary.errors.length }, req }).catch(() => {});
  return { status: 200, body: { dry_run: false, ...summary, update: updated } };
}
const sendImport = (res, r) => (r.error ? fail(res, r.error, r.status) : ok(res, r.body, r.status));
// One limit per store, shared by the store and staff.
const catalogImportLimit = (keyFn) => rateLimit({ windowMs: 60 * 60_000, max: 30, keyPrefix: "merchant_catalog_import", keyFn });

app.post(
  "/api/merchant/catalog/import",
  requireMerchant,
  catalogImportLimit((req) => `m:${req.merchant && req.merchant.id}`),
  asyncRoute(async (req, res) => {
    const r = await runCatalogImport({ merchantId: req.merchant.id, csv: req.body && req.body.csv, dryRun: req.body && req.body.dry_run === true, actor: { type: "merchant_user", id: req.merchantUser.id, merchantUserId: req.merchantUser.id }, req });
    return sendImport(res, r);
  })
);

// Staff-assisted import: staff upload a store's CSV from the admin
// dashboard (for example a spreadsheet the store emailed). Approved stores
// only. Same preview, screening and limits as the store's own import;
// held items still go to "Catalog Items Held for Review". Audited as
// catalog_imported_by_staff.
app.post(
  "/api/admin/merchants/:id/catalog/import",
  requireAdmin,
  catalogImportLimit((req) => `m:${cleanString(req.params.id, 64)}`),
  asyncRoute(async (req, res) => {
    const { data: store, error } = await supabase.from("merchants").select("id, status").eq("id", cleanString(req.params.id, 64)).maybeSingle();
    if (error) return fail(res, "The store could not be loaded.", 502);
    if (!store) return fail(res, "Store not found.", 404);
    if (store.status !== "approved") return fail(res, "Only approved stores can have items imported.", 409);
    const r = await runCatalogImport({ merchantId: store.id, csv: req.body && req.body.csv, dryRun: req.body && req.body.dry_run === true, actor: { type: "admin", id: req.admin.email || req.admin.id, merchantUserId: null }, req });
    return sendImport(res, r);
  })
);

// Staff view of one store's full catalog: every live item in every review
// state, with who decided and why. Read-only; held items are decided through
// the review route below.
app.get(
  "/api/admin/merchants/:id/catalog",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const id = cleanString(req.params.id, 64);
    const { data: store, error: storeError } = await supabase.from("merchants").select("id, business_name, status").eq("id", id).maybeSingle();
    if (storeError) return fail(res, "The store could not be loaded.", 502);
    if (!store) return fail(res, "Store not found.", 404);
    const { data, error } = await supabase
      .from("catalog_items")
      .select(`${CATALOG_FIELDS}, reviewed_by, reviewed_at, created_at`)
      .eq("merchant_id", store.id)
      .is("archived_at", null)
      .order("name", { ascending: true })
      .limit(catalogRules.MAX_ITEMS_PER_STORE);
    if (error) return error.code === "42P01" ? ok(res, { store, items: [], counts: {}, not_set_up: true }) : fail(res, "The catalog could not be loaded.", 502);
    const items = (data || []).map(catalogItemView);
    const counts = { total: items.length, listed: 0, held: 0, blocked: 0, out_of_stock: 0 };
    for (const i of items) {
      counts[i.review_status] = (counts[i.review_status] || 0) + 1;
      if (!i.available) counts.out_of_stock += 1;
    }
    return ok(res, { store, items, counts });
  })
);

// Staff review of held items.
app.get(
  "/api/admin/catalog/held",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const { data, error } = await supabase.from("catalog_items").select(CATALOG_FIELDS).eq("review_status", "held").is("archived_at", null).order("updated_at", { ascending: true }).limit(200);
    if (error) return error.code === "42P01" ? ok(res, { items: [], not_set_up: true }) : fail(res, "Held items could not be loaded.", 502);
    const ids = [...new Set((data || []).map((i) => i.merchant_id))];
    const names = {};
    if (ids.length) {
      const { data: stores } = await supabase.from("merchants").select("id, business_name").in("id", ids);
      for (const s of stores || []) names[s.id] = s.business_name;
    }
    return ok(res, { items: (data || []).map((i) => ({ ...catalogItemView(i), store_name: names[i.merchant_id] || null })) });
  })
);

app.post(
  "/api/admin/catalog/items/:id/review",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const id = cleanString(req.params.id, 64);
    const decision = cleanString(req.body && req.body.decision, 10);
    const reason = cleanString(req.body && req.body.reason, 500);
    if (!["allow", "block"].includes(decision)) return fail(res, "Decision must be allow or block.", 400);
    if (decision === "block" && reason.length < 10) return fail(res, "Give a reason of at least 10 characters.", 400);
    const patch = { review_status: decision === "allow" ? "listed" : "blocked", reviewed_by: req.admin.email || req.admin.id, reviewed_at: nowIso(), review_reason: reason || null };
    const { data, error } = await supabase.from("catalog_items").update(patch).eq("id", id).eq("review_status", "held").is("archived_at", null).select("id, merchant_id, review_status").maybeSingle();
    if (error) return fail(res, "The review could not be saved.", 502);
    if (!data) return fail(res, "This item isn't waiting for review any more. Reload and try again.", 409);
    auditLog({ actor_type: "admin", actor_id: req.admin.email, action: `catalog_item_${decision === "allow" ? "allowed" : "blocked"}`, entity_type: "catalog_item", entity_id: id, metadata: { merchant_id: data.merchant_id, reason: reason || null }, req }).catch(() => {});
    return ok(res, { item: data });
  })
);

/* =========================================================
   MERCHANT PORTAL, PHASE 3A: ORDERS
   Owner decisions 2026-10-18: design docs/merchant-portal-phase3-orders.md,
   D1-D7 as recommended, "Authorize the initiation of Step 3a". A signed-in
   rider orders from one approved, open store and authorizes the card once
   (manual capture); the store accepts with a prep time, rejects, marks
   ready or cancels; staff can cancel. Every ending other than completion
   releases the authorization in full. Driver pickup, delivery, capture
   and refunds come later (3c / phase 4).
   Test mode only, isolated from rides and the legacy delivery booking
   (owner decision 2026-10-18): orders use their own Stripe client, built
   only from ORDERS_STRIPE_SECRET_KEY and only if it is a test key
   (sk_test_ / rk_test_); the ride key (STRIPE_SECRET_KEY) is never used
   for orders, and orders never touch ride payments. Orders depend only on
   ENABLE_MERCHANT_ORDERS, not on ENABLE_DELIVERY and its siblings, so the
   paused free-text delivery booking (#260) stays paused. Order
   PaymentIntents also carry their own app tag.
========================================================= */
const orderRules = require("./lib/orders");
const ENABLE_MERCHANT_ORDERS = envBool("ENABLE_MERCHANT_ORDERS", false);
const ORDERS_STRIPE_SECRET_KEY = env("ORDERS_STRIPE_SECRET_KEY");
// Not secret: Stripe.js needs it in the rider's browser (step 3b).
const ORDERS_STRIPE_PUBLISHABLE_KEY = env("ORDERS_STRIPE_PUBLISHABLE_KEY");
const ordersStripe = Stripe && /^(sk|rk)_test_/.test(ORDERS_STRIPE_SECRET_KEY) ? new Stripe(ORDERS_STRIPE_SECRET_KEY) : null;
// Placeholder until the accountant's advice (design §8). Test mode only.
const ORDERS_TEST_TAX_RATE_BPS = (() => {
  const n = Number(env("ORDERS_TEST_TAX_RATE_BPS", "0"));
  return Number.isInteger(n) && n >= 0 && n <= 2000 ? n : 0;
})();
const ORDER_INTENT_APP_TAG = "harvey_taxi_orders";
const ORDER_FIELDS = "id, order_number, merchant_id, rider_id, ride_id, status, order_type, prep_minutes, placed_at, accepted_at, ready_at, cancelled_at, cancel_reason, items_subtotal_cents, tax_cents, tax_rate_bps, delivery_fee_cents, tip_cents, authorized_cents, captured_cents, refunded_cents, payment_intent_id, livemode, client_order_key, rider_notes, created_at, updated_at, market, dropoff_lat, dropoff_lng, dropoff_address, picked_up_at, delivered_at, completed_at, commission_cents, merchant_share_cents, payout_week_start";
const ORDER_ITEM_FIELDS = "id, order_id, catalog_item_id, name, unit_price_cents, quantity, tax_cents, substitution_choice, fulfilment, substitute_name, substitute_price_cents, substitution_asked_at, substitution_expires_at, substitution_answer, substitution_answered_at, refunded_quantity";
const ORDER_EVENT_ACTOR = { rider: "rider", merchant: "merchant_user", admin: "admin", system: "system" };

const ordersStripeTestMode = () => Boolean(ordersStripe);
// Writes need the switch and the orders test key; returns true if it replied.
function ordersUnavailable(res) {
  if (!ENABLE_MERCHANT_ORDERS) return fail(res, "Ordering from stores isn't available yet.", 503) || true;
  if (!ordersStripeTestMode()) return fail(res, "Ordering is in test mode and needs its own Stripe test key.", 503) || true;
  return false;
}

// The signed delivery-fee quote, checked like rides check theirs, but
// without the legacy delivery switches: orders have their own.
function verifyOrderQuote(req, res) {
  if (!RIDE_QUOTE_SECRET) {
    fail(res, "Delivery estimates are not configured.", 503);
    return null;
  }
  const token = cleanString(req.body.estimate_token, 4000);
  if (!token) {
    fail(res, "Please get a delivery estimate before checking out.", 400);
    return null;
  }
  const result = resolveRideQuote({ token, secret: RIDE_QUOTE_SECRET, rideType: normalizeRideType(req.body.ride_type), riderId: cleanString(req.body.rider_id, 100) || null, ...extractTripCoords(req.body) });
  if (!result.ok) {
    fail(res, QUOTE_TOKEN_INVALID_REASONS.has(result.reason) ? "Your delivery estimate has expired. Please get a fresh estimate." : "This order no longer matches your delivery estimate. Please get a fresh estimate.", 400);
    return null;
  }
  return result.quote;
}
const ordersNotSetUp = (error) => error && error.code === "42P01";

async function releaseOrderAuthorization(order) {
  if (!order.payment_intent_id || !ordersStripe) return;
  try {
    const intent = await ordersStripe.paymentIntents.retrieve(order.payment_intent_id);
    if (intent.metadata?.order_id !== order.id) throw new Error("payment intent does not belong to this order");
    if (RELEASABLE_INTENT_STATUSES.includes(intent.status)) {
      await ordersStripe.paymentIntents.cancel(intent.id, {}, { idempotencyKey: `harvey-order-release-${order.id}` });
    }
  } catch (err) {
    console.error("❌ order authorization release failed:", order.id, err.message);
    auditLog({ actor_type: "system", actor_id: "orders", action: "order_release_failed", entity_type: "order", entity_id: order.id, metadata: { status: order.status, error: String(err.message).slice(0, 200) } }).catch(() => {});
  }
}

// The only way an order changes state: allowed by lib/orders.js, applied
// only if nobody else moved it first, written to order_events, audited.
async function moveOrder(order, to, actor, { reason = null, patch = {}, req = null } = {}) {
  // Read before the update: the history must record where the order was.
  const from = order.status;
  if (!orderRules.canTransition(actor.kind, from, to)) return { ok: false, status: 409, error: "This order can't be changed that way now." };
  if (orderRules.NEEDS_REASON.includes(to) && String(reason || "").trim().length < 3) return { ok: false, status: 400, error: "Give a reason." };
  const now = nowIso();
  const stamp = { placed: "placed_at", accepted: "accepted_at", ready: "ready_at", picked_up: "picked_up_at", delivered: "delivered_at", completed: "completed_at" }[to];
  const ending = orderRules.RELEASES_AUTHORIZATION.includes(to);
  const fullPatch = { ...patch, status: to, updated_at: now, ...(stamp ? { [stamp]: now } : {}), ...(ending ? { cancelled_at: now, cancel_reason: reason || to } : {}) };
  const { data, error } = await supabase.from("orders").update(fullPatch).eq("id", order.id).eq("status", from).select(ORDER_FIELDS).maybeSingle();
  if (error) return { ok: false, status: 502, error: "The order could not be updated." };
  if (!data) return { ok: false, status: 409, error: "This order changed. Reload and try again." };
  await supabase.from("order_events").insert({ id: crypto.randomUUID(), order_id: order.id, from_status: from, to_status: to, actor_type: ORDER_EVENT_ACTOR[actor.kind], actor_id: actor.id || null, reason: reason || null, created_at: now });
  if (ending) {
    await releaseOrderAuthorization(data);
    await cancelOrderTrip(data, to);
  }
  auditLog({ actor_type: ORDER_EVENT_ACTOR[actor.kind], actor_id: actor.id || null, action: `order_${to}`, entity_type: "order", entity_id: order.id, metadata: { merchant_id: order.merchant_id, from, reason: reason || null }, req }).catch(() => {});
  return { ok: true, order: data };
}

// Close unpaid checkouts after 15 minutes and unanswered orders after 8
// (D1). Runs before store and staff reads, and every minute while on.
async function sweepOrders({ merchantId = null } = {}) {
  let query = supabase.from("orders").select(ORDER_FIELDS).in("status", ["pending_payment", "placed"]).limit(200);
  if (merchantId) query = query.eq("merchant_id", merchantId);
  const { data } = await query;
  for (const order of data || []) {
    const action = orderRules.sweepAction(order);
    if (action) await moveOrder(order, action, { kind: "system", id: "order_sweep" }, { reason: action === "expired" ? "The store didn't respond in time." : "Payment wasn't completed." });
  }
  await settleExpiredQuestions(merchantId ? { merchantId } : {});
  // A trip that failed to start when the store accepted is retried here.
  let tripless = supabase.from("orders").select(ORDER_FIELDS).in("status", ["accepted", "ready"]).is("ride_id", null).limit(50);
  if (merchantId) tripless = tripless.eq("merchant_id", merchantId);
  const { data: noTrip } = await tripless;
  for (const order of noTrip || []) await createOrderTrip(order);
  if (!merchantId) await settleStoreDeductions();
}

// Step 3c-3: the delivery trip, created when the store accepts. It goes
// through the normal dispatch to drivers; the order keeps the only card
// authorization. Safe to call again: one trip per order.
async function createOrderTrip(order) {
  if (!order || order.ride_id || !["accepted", "ready"].includes(order.status)) return null;
  const { data: store } = await supabase.from("merchants").select("id, business_name, address_line, city, pickup_lat, pickup_lng").eq("id", order.merchant_id).maybeSingle();
  if (!store || store.pickup_lat == null) return null;
  const { data: rider } = await supabase.from("riders").select("id, first_name, full_name, phone").eq("id", order.rider_id).maybeSingle();
  const items = (await loadOrderItems([order.id]))[order.id] || [];
  const ride = {
    id: makeId("RIDE"),
    ...orderRules.orderTripFields({
      order,
      store,
      riderName: rider ? rider.first_name || String(rider.full_name || "").trim().split(/\s+/)[0] || null : null,
      riderPhone: rider ? rider.phone : null,
      items,
      driverPayoutPercent: DRIVER_PAYOUT_PERCENT,
      deliveryPin: String(crypto.randomInt(1000, 10000))
    }),
    status: RIDE_STATUS.PAYMENT_AUTHORIZED,
    dispatch_status: "ready_to_dispatch",
    // Held until 10 minutes before the prep time is up (or until ready);
    // the scheduled-ride sweep offers it then.
    scheduled_time: orderRules.orderDispatchAt(order)
  };
  // Claim the order first, so two callers can't each start a trip.
  const { data: claimed } = await supabase.from("orders").update({ ride_id: ride.id, updated_at: nowIso() }).eq("id", order.id).is("ride_id", null).select("id").maybeSingle();
  if (!claimed) return null;
  const { data: created, error } = await supabase.from("rides").insert(ride).select().single();
  if (error || !created) {
    await supabase.from("orders").update({ ride_id: null, updated_at: nowIso() }).eq("id", order.id).eq("ride_id", ride.id);
    console.error("❌ order trip insert failed:", order.id, error && error.message);
    auditLog({ actor_type: "system", actor_id: "orders", action: "order_trip_failed", entity_type: "order", entity_id: order.id, metadata: { error: String((error && error.message) || "insert failed").slice(0, 200) } }).catch(() => {});
    return null;
  }
  auditLog({ actor_type: "system", actor_id: "orders", action: "order_trip_created", entity_type: "order", entity_id: order.id, metadata: { ride_id: created.id, merchant_id: order.merchant_id } }).catch(() => {});
  if (shouldDispatchRideNow(created)) {
    try {
      await dispatchRide(created);
    } catch (err) {
      console.error("❌ order trip dispatch failed:", created.id, err.message);
    }
  }
  return created;
}

// An order that ends before pickup takes its trip with it.
async function cancelOrderTrip(order, reasonStatus) {
  if (!order || !order.ride_id) return;
  const { data: ride } = await supabase.from("rides").select("*").eq("id", order.ride_id).maybeSingle();
  if (!ride || !isCancellable(ride.status)) return;
  const claim = await claimRideTransition({
    supabase,
    rideId: ride.id,
    fromStatuses: [ride.status],
    toStatus: RIDE_STATUS.CANCELLED,
    patch: { cancelled_at: nowIso(), cancellation_reason: `Order ${order.order_number} ${String(reasonStatus).replace(/_/g, " ")}`, cancelled_by_type: "system", cancelled_by_id: "orders", cancellation_payment_status: "not_required", updated_at: nowIso() }
  });
  if (!claim.ok) return;
  if (hasAssignedDriver(ride.status) && ride.driver_id) {
    sendPushNotification({ ownerType: "driver", ownerId: ride.driver_id, title: "Delivery cancelled", body: "This delivery was cancelled and is no longer assigned to you.", url: "/driver.html" }).catch(() => {});
  }
  broadcastRideSse(ride.id, "stage", { status: RIDE_STATUS.CANCELLED });
  auditLog({ actor_type: "system", actor_id: "orders", action: "order_trip_cancelled", entity_type: "ride", entity_id: ride.id, metadata: { order_id: order.id, order_status: reasonStatus } }).catch(() => {});
}

// The store marked the order ready: a trip still held for its prep time is
// offered to drivers now. Claimed like the scheduled sweep claims a ride,
// so the two can't both dispatch it.
async function releaseHeldOrderTrip(order) {
  if (!order || !order.ride_id) return;
  const { data: ride } = await supabase.from("rides").select("*").eq("id", order.ride_id).maybeSingle();
  if (!ride || ride.status !== RIDE_STATUS.PAYMENT_AUTHORIZED || ride.driver_id || ride.dispatch_status !== "ready_to_dispatch" || !ride.scheduled_time || Date.parse(ride.scheduled_time) <= Date.now()) return;
  const at = nowIso();
  const { data: claimed } = await supabase.from("rides").update({ scheduled_time: at, dispatch_status: "dispatching", dispatch_claimed_at: at, updated_at: at }).eq("id", ride.id).eq("status", RIDE_STATUS.PAYMENT_AUTHORIZED).eq("dispatch_status", "ready_to_dispatch").select().maybeSingle();
  if (!claimed) return;
  try {
    await dispatchRide(claimed);
  } catch (err) {
    console.error("❌ order trip dispatch on ready failed:", claimed.id, err.message);
    await resetScheduledRideForRetry(claimed.id).catch(() => {});
  }
}

async function orderForRide(rideId) {
  if (!rideId) return null;
  const { data } = await supabase.from("orders").select(ORDER_FIELDS).eq("ride_id", rideId).maybeSingle();
  return data || null;
}

// Step 3c-3 (D7): the driver's PIN or photo handoff delivers the order and
// charges the card for what was delivered, never more than the hold. A
// failed charge leaves the order "delivered" for staff; nothing retries on
// its own. Safe to call again after a crash or a repeated completion.
async function completeOrderForRide(ride, req = null) {
  let order = await orderForRide(ride.id);
  if (!order) return null;
  const system = { kind: "system", id: "order_delivery" };
  if (order.status === "ready") {
    const moved = await moveOrder(order, "picked_up", system, { req });
    if (moved.ok) order = moved.order;
  }
  if (order.status === "picked_up") {
    const moved = await moveOrder(order, "delivered", system, { req });
    if (moved.ok) order = moved.order;
  }
  if (order.status !== "delivered") return { order_status: order.status };
  const items = (await loadOrderItems([order.id]))[order.id] || [];
  const amount = orderRules.captureAmountCents(order, items);
  let captured = null;
  try {
    if (!ordersStripe) throw new Error("orders Stripe key not configured");
    const intent = await ordersStripe.paymentIntents.retrieve(order.payment_intent_id);
    if (!intent || intent.metadata?.order_id !== order.id || intent.livemode) throw new Error("payment intent does not match this order");
    if (intent.status === "succeeded") captured = intent.amount_received;
    else if (intent.status === "requires_capture") {
      const done = await ordersStripe.paymentIntents.capture(intent.id, { amount_to_capture: amount }, { idempotencyKey: `harvey-order-capture-${order.id}` });
      if (done.status !== "succeeded") throw new Error(`capture status ${done.status}`);
      captured = done.amount_received;
    } else throw new Error(`payment intent status ${intent.status}`);
  } catch (err) {
    console.error("❌ order capture failed:", order.id, err.message);
    auditLog({ actor_type: "system", actor_id: "order_delivery", action: "order_capture_failed", entity_type: "order", entity_id: order.id, metadata: { amount_cents: amount, error: String(err.message).slice(0, 200) }, req }).catch(() => {});
    return { order_status: "delivered", capture: "failed" };
  }
  const split = orderRules.completionSplit(order, items);
  const moved = await moveOrder(order, "completed", system, { req, patch: { captured_cents: captured, commission_cents: split.commission_cents, merchant_share_cents: split.merchant_share_cents, payout_week_start: split.payout_week_start } });
  const { error: ledgerError } = await supabase.from("store_ledger_entries").insert({ id: crypto.randomUUID(), ...split.ledger, created_at: nowIso() });
  if (ledgerError && ledgerError.code !== "23505") {
    console.error("❌ store ledger credit failed:", order.id, ledgerError.message);
    auditLog({ actor_type: "system", actor_id: "order_delivery", action: "store_ledger_failed", entity_type: "order", entity_id: order.id, metadata: { error: String(ledgerError.message).slice(0, 200) } }).catch(() => {});
  }
  auditLog({ actor_type: "system", actor_id: "order_delivery", action: "order_captured", entity_type: "order", entity_id: order.id, metadata: { captured_cents: captured, authorized_cents: order.authorized_cents, commission_cents: split.commission_cents }, req }).catch(() => {});
  return { order_status: moved.ok ? "completed" : order.status, capture: "captured", captured_cents: captured };
}

// "Contact me first" questions with no answer after 7 minutes refund the
// item (term 5). Runs with the sweep and before any read that shows items.
async function settleExpiredQuestions({ orderIds = null, merchantId = null } = {}) {
  let query = supabase.from("order_items").select(ORDER_ITEM_FIELDS).eq("fulfilment", "out_of_stock").limit(500);
  if (orderIds) {
    if (!orderIds.length) return;
    query = query.in("order_id", orderIds);
  }
  const { data, error } = await query;
  if (error || !data) return;
  let waiting = data;
  if (merchantId && !orderIds) {
    const { data: mine } = await supabase.from("orders").select("id").eq("merchant_id", merchantId).eq("status", "accepted");
    const ids = new Set((mine || []).map((o) => o.id));
    waiting = waiting.filter((i) => ids.has(i.order_id));
  }
  for (const item of waiting) {
    const patch = orderRules.settleQuestion(item);
    if (!patch) continue;
    const { data: updated } = await supabase.from("order_items").update(patch).eq("id", item.id).eq("fulfilment", "out_of_stock").select("id").maybeSingle();
    if (updated) auditLog({ actor_type: "system", actor_id: "order_sweep", action: "order_item_question_expired", entity_type: "order", entity_id: item.order_id, metadata: { item_id: item.id } }).catch(() => {});
  }
}
if (ENABLE_MERCHANT_ORDERS && process.env.NODE_ENV !== "test") {
  setInterval(() => sweepOrders().catch((err) => console.error("❌ order sweep:", err.message)), 60_000).unref();
}

async function loadOrderItems(orderIds) {
  if (!orderIds.length) return {};
  const { data } = await supabase.from("order_items").select(ORDER_ITEM_FIELDS).in("order_id", orderIds);
  const byOrder = {};
  for (const i of data || []) (byOrder[i.order_id] = byOrder[i.order_id] || []).push(i);
  return byOrder;
}
async function riderFirstNames(riderIds) {
  const ids = [...new Set(riderIds.filter(Boolean))];
  if (!ids.length) return {};
  const { data } = await supabase.from("riders").select("id, first_name, full_name").in("id", ids);
  const names = {};
  for (const r of data || []) names[r.id] = r.first_name || String(r.full_name || "").trim().split(/\s+/)[0] || null;
  return names;
}
function riderOrderView(order, items, storeName) {
  return {
    id: order.id,
    order_number: order.order_number,
    status: order.status,
    order_type: order.order_type,
    store_name: storeName || null,
    prep_minutes: order.prep_minutes,
    placed_at: order.placed_at,
    accepted_at: order.accepted_at,
    ready_at: order.ready_at,
    cancelled_at: order.cancelled_at,
    cancel_reason: order.cancel_reason,
    items_subtotal_cents: order.items_subtotal_cents,
    tax_cents: order.tax_cents,
    delivery_fee_cents: order.delivery_fee_cents,
    tip_cents: order.tip_cents,
    total_cents: order.items_subtotal_cents + order.tax_cents + order.delivery_fee_cents + order.tip_cents,
    authorized_cents: order.authorized_cents,
    test_mode: !order.livemode,
    can_cancel: orderRules.canTransition("rider", order.status, "cancelled_by_rider"),
    // While the store prepares, what the order would cost with items as they stand.
    current_total_cents: ["accepted", "ready"].includes(order.status) && items && items.length && "fulfilment" in items[0] ? orderRules.finalTotals(order, items).total_cents : null,
    items: (items || []).map((i) => orderRules.itemView(i))
  };
}
async function loadRiderOrder(req, id) {
  const { data } = await supabase.from("orders").select(ORDER_FIELDS).eq("id", cleanString(id, 64)).eq("rider_id", String(req.rider.id)).maybeSingle();
  return data || null;
}
async function storeName(merchantId) {
  const { data } = await supabase.from("merchants").select("business_name").eq("id", merchantId).maybeSingle();
  return data ? data.business_name : null;
}

// Rider browsing (step 3b). Signed-in riders see approved stores in their
// market that have a confirmed pickup pin and at least one item for sale,
// and a store's menu. Held or staff-hidden items are never sent. Empty
// while ordering is off. Store addresses are public business information.
const marketRules = require("./lib/markets");
const STORE_FIELDS_FOR_RIDERS = "id, business_name, category, address_line, city, market, pickup_lat, pickup_lng";
const MENU_ITEM_FIELDS = "id, name, section, description, price_cents, available, substitutable";
const dbNotReady = (error) => error && (error.code === "42P01" || error.code === "42703");
function hoursToday(hours, at = new Date()) {
  const day = WEEKDAY_INDEX[new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", weekday: "short" }).format(at)];
  const h = (hours || []).find((x) => Number(x.day_of_week) === day);
  if (!h || h.closed || !h.opens_at || !h.closes_at) return null;
  return { opens_at: String(h.opens_at).slice(0, 5), closes_at: String(h.closes_at).slice(0, 5) };
}
const WEEKDAY_INDEX = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
function riderStoreView(store, hours, itemCount) {
  return {
    id: store.id,
    business_name: store.business_name,
    category: store.category,
    order_type: orderRules.orderTypeFor(store.category),
    address: [store.address_line, store.city].filter(Boolean).join(", "),
    market: store.market,
    open_now: orderRules.isOpenAt(hours),
    hours_today: hoursToday(hours),
    item_count: itemCount
  };
}

app.get(
  "/api/stores",
  requireRider,
  asyncRoute(async (req, res) => {
    if (!ENABLE_MERCHANT_ORDERS || !ordersStripeTestMode()) return ok(res, { enabled: false, stores: [] });
    const market = marketRules.marketFromQuery(req.query.market);
    const { data: stores, error } = await supabase.from("merchants").select(STORE_FIELDS_FOR_RIDERS).eq("status", "approved").eq("market", market).limit(200);
    if (dbNotReady(error)) return ok(res, { enabled: false, stores: [], not_set_up: true });
    if (error) return fail(res, "Stores could not be loaded.", 502);
    const pinned = (stores || []).filter((s) => s.pickup_lat != null && s.pickup_lng != null);
    const ids = pinned.map((s) => s.id);
    const counts = {};
    const hoursBy = {};
    if (ids.length) {
      const { data: items } = await supabase.from("catalog_items").select("merchant_id").in("merchant_id", ids).eq("review_status", "listed").eq("available", true).is("archived_at", null);
      for (const i of items || []) counts[i.merchant_id] = (counts[i.merchant_id] || 0) + 1;
      const { data: hours } = await supabase.from("merchant_hours").select("merchant_id, day_of_week, closed, opens_at, closes_at").in("merchant_id", ids);
      for (const h of hours || []) (hoursBy[h.merchant_id] = hoursBy[h.merchant_id] || []).push(h);
    }
    const list = pinned
      .filter((s) => counts[s.id])
      .map((s) => riderStoreView(s, hoursBy[s.id], counts[s.id]))
      .sort((a, b) => Number(b.open_now) - Number(a.open_now) || a.business_name.localeCompare(b.business_name));
    return ok(res, { enabled: true, market: marketRules.getMarket(market), stores: list });
  })
);

app.get(
  "/api/stores/:id/menu",
  requireRider,
  asyncRoute(async (req, res) => {
    if (!ENABLE_MERCHANT_ORDERS || !ordersStripeTestMode()) return fail(res, "Ordering from stores isn't available yet.", 503);
    const { data: store, error } = await supabase.from("merchants").select(STORE_FIELDS_FOR_RIDERS + ", status").eq("id", cleanString(req.params.id, 64)).maybeSingle();
    if (dbNotReady(error)) return fail(res, "Ordering isn't set up yet.", 503);
    if (!store || store.status !== "approved" || store.pickup_lat == null || store.pickup_lng == null) return fail(res, "This store isn't taking orders.", 404);
    const { data: items } = await supabase.from("catalog_items").select(MENU_ITEM_FIELDS).eq("merchant_id", store.id).eq("review_status", "listed").is("archived_at", null).order("section", { ascending: true }).order("name", { ascending: true }).limit(catalogRules.MAX_ITEMS_PER_STORE);
    const { data: hours } = await supabase.from("merchant_hours").select("day_of_week, closed, opens_at, closes_at").eq("merchant_id", store.id);
    const forSale = (items || []).filter((i) => i.available).length;
    // Only these fields leave the server, whatever the query returned.
    const menuItems = (items || []).map((i) => ({ id: i.id, name: i.name, section: i.section || null, description: i.description || null, price_cents: i.price_cents, available: Boolean(i.available), substitutable: Boolean(i.substitutable) }));
    return ok(res, { store: riderStoreView(store, hours, forSale), items: menuItems });
  })
);

// What the rider screens need to know. The publishable key is shown only
// when it is a test key.
app.get(
  "/api/orders/config",
  (req, res) => ok(res, { enabled: ENABLE_MERCHANT_ORDERS && ordersStripeTestMode(), test_mode: true, publishable_key: /^pk_test_/.test(ORDERS_STRIPE_PUBLISHABLE_KEY) ? ORDERS_STRIPE_PUBLISHABLE_KEY : null })
);

// The delivery fee for an order (step 3b part 2). The pickup is the
// store's confirmed pin, read here and never sent to the rider; the road
// distance comes from the routing service, not the device. The signed
// quote is the only fee checkout accepts.
app.post(
  "/api/orders/estimate",
  requireRider,
  rateLimit({ windowMs: 10 * 60_000, max: 30, keyPrefix: "orders_estimate", keyFn: (req) => `r:${req.rider && req.rider.id}` }),
  asyncRoute(async (req, res) => {
    if (ordersUnavailable(res)) return;
    if (!RIDE_QUOTE_SECRET) return fail(res, "Delivery estimates are not configured.", 503);
    const body = req.body || {};
    const destination = parseCoordPair(body.destination_lat, body.destination_lng);
    const tn = merchantRules.TN_BOUNDS;
    if (!destination || destination.lat < tn.minLat || destination.lat > tn.maxLat || destination.lng < tn.minLng || destination.lng > tn.maxLng) {
      return fail(res, "Choose a delivery address in Tennessee.", 400);
    }
    const { data: store, error } = await supabase.from("merchants").select("id, business_name, category, status, pickup_lat, pickup_lng").eq("id", cleanString(body.merchant_id, 64)).maybeSingle();
    if (dbNotReady(error)) return fail(res, "Ordering isn't set up yet.", 503);
    if (!store || store.status !== "approved" || store.pickup_lat == null || store.pickup_lng == null) return fail(res, "This store isn't taking orders.", 404);
    const { data: hours } = await supabase.from("merchant_hours").select("day_of_week, closed, opens_at, closes_at").eq("merchant_id", store.id);
    if (!orderRules.isOpenAt(hours)) return fail(res, `${store.business_name} is closed right now.`, 409);

    const pickup = { lat: Number(store.pickup_lat), lng: Number(store.pickup_lng) };
    const route = await geoClient.route(pickup, destination);
    if (!route.ok) {
      if (route.error === GEO_ERROR.NO_ROUTE) return fail(res, "We couldn't find a driving route to that address.", 422);
      return fail(res, "Delivery estimates aren't available right now. Please try again shortly.", 503);
    }
    const miles = Number(route.distance_miles);
    const minutes = Number(route.duration_minutes);
    if (!hasValidTripDistance({ miles, minutes })) return fail(res, "We couldn't find a driving route to that address.", 422);
    if (miles > orderRules.MAX_DELIVERY_MILES) return fail(res, `That address is more than ${orderRules.MAX_DELIVERY_MILES} miles from ${store.business_name}.`, 422);

    const rideType = orderRules.orderTypeFor(store.category);
    const estimate = calculateRideEstimate({ miles, minutes, ride_type: rideType });
    const riderId = String(req.rider.id);
    const estimateToken = signRideQuote({ rideType, miles, minutes, pickup, destination, riderId, estimate, secret: RIDE_QUOTE_SECRET, ttlMinutes: RIDE_QUOTE_TTL_MINUTES });
    auditLog({ actor_type: "rider", actor_id: riderId, action: "order_estimate_created", entity_type: "merchant", entity_id: store.id, metadata: { ride_type: rideType, miles, total: estimate.total }, req }).catch(() => {});
    return ok(res, {
      estimate_token: estimateToken,
      ride_type: rideType,
      delivery_fee_cents: Math.round(Number(estimate.total) * 100),
      miles,
      minutes,
      expires_at: new Date(Date.now() + RIDE_QUOTE_TTL_MINUTES * 60 * 1000).toISOString(),
      destination
    });
  })
);

// Checkout. Prices, availability and names come from the catalog; the
// delivery fee from the signed, single-use fare quote (as for rides); the
// tax rate from the test-mode placeholder. Safe to retry with the same
// client_order_key.
app.post(
  "/api/orders/checkout",
  requireRider,
  rateLimit({ windowMs: 10 * 60_000, max: 20, keyPrefix: "orders_checkout", keyFn: (req) => `r:${req.rider && req.rider.id}` }),
  asyncRoute(async (req, res) => {
    if (ordersUnavailable(res)) return;
    const body = req.body || {};
    const riderId = String(req.rider.id);
    const clientKey = cleanString(body.client_order_key, 100);
    if (clientKey.length < 8) return fail(res, "This checkout could not be verified. Please try again.", 400);

    const { data: existing, error: existingError } = await supabase.from("orders").select(ORDER_FIELDS).eq("rider_id", riderId).eq("client_order_key", clientKey).maybeSingle();
    if (ordersNotSetUp(existingError)) return fail(res, "Ordering isn't set up yet.", 503);
    if (existing) {
      const intent = existing.payment_intent_id ? await ordersStripe.paymentIntents.retrieve(existing.payment_intent_id) : null;
      const items = (await loadOrderItems([existing.id]))[existing.id];
      return ok(res, { order: riderOrderView(existing, items, await storeName(existing.merchant_id)), client_secret: existing.status === "pending_payment" && intent ? intent.client_secret : null, repeated: true });
    }

    const { data: store } = await supabase.from("merchants").select("id, business_name, category, status, market").eq("id", cleanString(body.merchant_id, 64)).maybeSingle();
    if (!store || store.status !== "approved") return fail(res, "This store isn't taking orders.", 404);
    // A store takes orders only once staff have confirmed its pickup pin.
    const { data: pinRow } = await supabase.from("merchants").select("pickup_lat, pickup_lng").eq("id", store.id).maybeSingle();
    if (!pinRow || pinRow.pickup_lat == null || pinRow.pickup_lng == null) return fail(res, "This store isn't taking orders yet.", 409);
    const { data: hours } = await supabase.from("merchant_hours").select("day_of_week, closed, opens_at, closes_at").eq("merchant_id", store.id);
    if (!orderRules.isOpenAt(hours)) return fail(res, `${store.business_name} is closed right now.`, 409);

    const { data: catalog } = await supabase.from("catalog_items").select("id, name, price_cents, available, substitutable, review_status, archived_at").eq("merchant_id", store.id).is("archived_at", null);
    const built = orderRules.buildLines(body.items, new Map((catalog || []).map((i) => [i.id, i])));
    if (!built.ok) return fail(res, built.error, 409);

    const orderType = orderRules.orderTypeFor(store.category);
    if (body.ride_type !== orderType) return fail(res, "Please get a fresh delivery estimate for this store.", 400);
    const tipCents = Number(body.tip_cents || 0);
    if (!Number.isInteger(tipCents) || tipCents < 0 || tipCents > orderRules.MAX_TIP_CENTS) return fail(res, "Choose a tip from $0 to $500.", 400);
    // The fare quote is bound to this rider and route; it can't be reused.
    // Quotes from /api/orders/estimate start at the pin the rider never sees.
    req.body.rider_id = riderId;
    if (req.body.pickup_lat == null && req.body.pickup_lng == null) {
      req.body.pickup_lat = pinRow.pickup_lat;
      req.body.pickup_lng = pinRow.pickup_lng;
    }
    const quote = verifyOrderQuote(req, res);
    if (!quote) return;
    // The fee must be for a trip that starts at this store.
    if (!quote.pickup || orderRules.distanceMeters(quote.pickup, { lat: pinRow.pickup_lat, lng: pinRow.pickup_lng }) > orderRules.PICKUP_TOLERANCE_M) {
      return fail(res, "Please get a fresh delivery estimate from this store.", 400);
    }
    const deliveryFeeCents = Math.round(Number(quote.estimate.total) * 100);
    const totals = orderRules.computeTotals({ lines: built.lines, orderType, taxRateBps: ORDERS_TEST_TAX_RATE_BPS, deliveryFeeCents, tipCents });

    const notes = cleanString(body.rider_notes, 300) || null;
    let order = null;
    for (let attempt = 0; attempt < 3 && !order; attempt += 1) {
      const { data, error } = await supabase
        .from("orders")
        .insert({
          id: crypto.randomUUID(),
          order_number: orderRules.orderNumber(crypto.randomBytes(6)),
          merchant_id: store.id,
          market: store.market || marketRules.DEFAULT_MARKET,
          rider_id: riderId,
          status: "pending_payment",
          order_type: orderType,
          items_subtotal_cents: totals.items_subtotal_cents,
          tax_cents: totals.tax_cents,
          tax_rate_bps: ORDERS_TEST_TAX_RATE_BPS,
          delivery_fee_cents: totals.delivery_fee_cents,
          tip_cents: totals.tip_cents,
          authorized_cents: totals.authorized_cents,
          captured_cents: 0,
          refunded_cents: 0,
          livemode: false,
          client_order_key: clientKey,
          quote_jti: String(quote.jti),
          pickup_lat: quote.pickup ? quote.pickup.lat : null,
          pickup_lng: quote.pickup ? quote.pickup.lng : null,
          dropoff_lat: quote.destination ? quote.destination.lat : null,
          dropoff_lng: quote.destination ? quote.destination.lng : null,
          // Display only, for the driver; the coordinates come from the quote.
          dropoff_address: (() => { const a = cleanString(body.dropoff_address, 300); return a.length >= 3 ? a : null; })(),
          rider_notes: notes,
          created_at: nowIso(),
          updated_at: nowIso()
        })
        .select(ORDER_FIELDS)
        .single();
      if (!error) order = data;
      else if (error.code !== "23505") return fail(res, "Your order could not be started. Please try again.", 502);
      else if (/quote_jti/.test(error.message || "")) return fail(res, "This delivery estimate was already used. Please get a fresh estimate.", 409);
      else if (/client_order_key|orders_rider_key/.test(error.message || "")) return fail(res, "This order is already being placed. Please wait a moment.", 409);
    }
    if (!order) return fail(res, "Your order could not be started. Please try again.", 502);

    const { error: itemsError } = await supabase.from("order_items").insert(totals.lines.map((l) => ({ id: crypto.randomUUID(), order_id: order.id, catalog_item_id: l.catalog_item_id, name: l.name, unit_price_cents: l.unit_price_cents, quantity: l.quantity, tax_cents: l.tax_cents, substitution_choice: l.substitution_choice, fulfilment: "pending", refunded_quantity: 0, created_at: nowIso() })));
    if (itemsError) {
      await moveOrder(order, "payment_abandoned", { kind: "system", id: "checkout" }, { reason: "Items could not be saved." });
      return fail(res, "Your order could not be started. Please try again.", 502);
    }
    await supabase.from("order_events").insert({ id: crypto.randomUUID(), order_id: order.id, from_status: null, to_status: "pending_payment", actor_type: "rider", actor_id: riderId, reason: null, created_at: nowIso() });

    let intent;
    try {
      intent = await ordersStripe.paymentIntents.create(
        {
          amount: order.authorized_cents,
          currency: "usd",
          capture_method: "manual",
          automatic_payment_methods: { enabled: true },
          description: `Harvey Taxi order ${order.order_number}`,
          metadata: { app: ORDER_INTENT_APP_TAG, account: "harvey_taxi_service", order_id: order.id, order_number: order.order_number, merchant_id: store.id, rider_id: riderId }
        },
        { idempotencyKey: `harvey-order-${order.id}` }
      );
    } catch (err) {
      console.error("❌ order payment intent:", err.message);
      await moveOrder(order, "payment_abandoned", { kind: "system", id: "checkout" }, { reason: "The card authorization could not be started." });
      return fail(res, "Payment could not be started. Please try again.", 502);
    }
    if (intent.livemode) {
      // Defence in depth: test mode was checked above; never keep a live hold.
      await ordersStripe.paymentIntents.cancel(intent.id).catch(() => {});
      await moveOrder(order, "payment_abandoned", { kind: "system", id: "checkout" }, { reason: "Live payments aren't enabled for orders." });
      return fail(res, "Ordering is in test mode only.", 503);
    }
    const { data: withIntent } = await supabase.from("orders").update({ payment_intent_id: intent.id, updated_at: nowIso() }).eq("id", order.id).select(ORDER_FIELDS).single();
    auditLog({ actor_type: "rider", actor_id: riderId, action: "order_checkout_started", entity_type: "order", entity_id: order.id, metadata: { merchant_id: store.id, authorized_cents: order.authorized_cents }, req }).catch(() => {});
    return ok(res, { order: riderOrderView(withIntent || order, totals.lines, store.business_name), client_secret: intent.client_secret }, 201);
  })
);

// After the card is confirmed on the device, the server checks Stripe
// itself before the order goes to the store.
app.post(
  "/api/orders/:id/confirm-payment",
  requireRider,
  asyncRoute(async (req, res) => {
    if (ordersUnavailable(res)) return;
    const order = await loadRiderOrder(req, req.params.id);
    if (!order) return fail(res, "Order not found.", 404);
    if (order.status !== "pending_payment") return ok(res, { order: riderOrderView(order, (await loadOrderItems([order.id]))[order.id], await storeName(order.merchant_id)) });
    const intent = order.payment_intent_id ? await ordersStripe.paymentIntents.retrieve(order.payment_intent_id) : null;
    if (!intent || intent.metadata?.order_id !== order.id || intent.amount !== order.authorized_cents || intent.livemode) return fail(res, "This payment could not be verified.", 409);
    if (intent.status !== "requires_capture") return fail(res, "Your card hasn't been authorized yet.", 409);
    const moved = await moveOrder(order, "placed", { kind: "system", id: "payment_confirmed" }, { req });
    if (!moved.ok) return fail(res, moved.error, moved.status);
    return ok(res, { order: riderOrderView(moved.order, (await loadOrderItems([order.id]))[order.id], await storeName(order.merchant_id)) });
  })
);

app.get(
  "/api/orders",
  requireRider,
  asyncRoute(async (req, res) => {
    const { data, error } = await supabase.from("orders").select(ORDER_FIELDS).eq("rider_id", String(req.rider.id)).order("created_at", { ascending: false }).limit(20);
    if (ordersNotSetUp(error)) return ok(res, { orders: [], not_set_up: true });
    if (error) return fail(res, "Your orders could not be loaded.", 502);
    await settleExpiredQuestions({ orderIds: (data || []).filter((o) => o.status === "accepted").map((o) => o.id) });
    const items = await loadOrderItems((data || []).map((o) => o.id));
    const names = {};
    for (const id of new Set((data || []).map((o) => o.merchant_id))) names[id] = await storeName(id);
    return ok(res, { orders: (data || []).map((o) => riderOrderView(o, items[o.id], names[o.merchant_id])) });
  })
);

app.get(
  "/api/orders/:id",
  requireRider,
  asyncRoute(async (req, res) => {
    const order = await loadRiderOrder(req, req.params.id);
    if (!order) return fail(res, "Order not found.", 404);
    await settleExpiredQuestions({ orderIds: [order.id] });
    const view = riderOrderView(order, (await loadOrderItems([order.id]))[order.id], await storeName(order.merchant_id));
    // Step 3c-3: the rider's own delivery PIN and the trip's progress, until handoff.
    if (order.ride_id && ["accepted", "ready", "picked_up"].includes(order.status)) {
      const { data: trip } = await supabase.from("rides").select("status, delivery_stage, delivery_pin").eq("id", order.ride_id).maybeSingle();
      if (trip) view.delivery = { pin: trip.delivery_pin || null, stage: trip.delivery_stage || null, driver_assigned: !["payment_authorized", "awaiting_driver_acceptance", "cancelled"].includes(trip.status) };
    }
    // Step 3c-4: missing-item reports, within 48 hours of delivery.
    if (order.status === "completed") {
      const deadline = orderRules.claimDeadline(order);
      view.report_until = deadline && Date.now() <= Date.parse(deadline) ? deadline : null;
      view.reportable_items = view.report_until ? orderRules.claimableItems((await loadOrderItems([order.id]))[order.id]).filter((i) => i.quantity > i.refunded_quantity).map((i) => ({ id: i.id, name: i.name, quantity: i.quantity - i.refunded_quantity })) : [];
      const { data: claims } = await supabase.from("order_refund_proposals").select(PROPOSAL_FIELDS).eq("order_id", order.id).order("created_at", { ascending: true });
      view.claims = (claims || []).map(riderClaimView);
      view.refunded_cents = order.refunded_cents || 0;
    }
    return ok(res, { order: view });
  })
);

// "Contact me first": the rider accepts the store's substitute or takes a
// refund, within 7 minutes of being asked (term 5).
app.post(
  "/api/orders/:id/items/:itemId/answer",
  requireRider,
  asyncRoute(async (req, res) => {
    const order = await loadRiderOrder(req, req.params.id);
    if (!order) return fail(res, "Order not found.", 404);
    const answer = cleanString(req.body && req.body.answer, 20);
    if (!["substitute", "refund"].includes(answer)) return fail(res, "Choose the substitute or a refund.", 400);
    const { data: item } = await supabase.from("order_items").select(ORDER_ITEM_FIELDS).eq("id", cleanString(req.params.itemId, 64)).eq("order_id", order.id).maybeSingle();
    if (!item) return fail(res, "Item not found.", 404);
    if (order.status !== "accepted") return fail(res, "This order is no longer being prepared.", 409);
    const patch = orderRules.settleQuestion(item, { answer });
    if (!patch) return fail(res, "This item has already been settled.", 409);
    const { data: updated } = await supabase.from("order_items").update(patch).eq("id", item.id).eq("fulfilment", "out_of_stock").select("id").maybeSingle();
    if (!updated) return fail(res, "This item has already been settled.", 409);
    auditLog({ actor_type: "rider", actor_id: String(req.rider.id), action: "order_item_answered", entity_type: "order", entity_id: order.id, metadata: { item_id: item.id, answer, result: patch.fulfilment }, req }).catch(() => {});
    const view = riderOrderView(order, (await loadOrderItems([order.id]))[order.id], await storeName(order.merchant_id));
    if (answer === "substitute" && patch.fulfilment === "refunded") return ok(res, { order: view, note: "The 7 minutes had run out, so this item was refunded." });
    return ok(res, { order: view });
  })
);

// D2: free until the store marks the order ready; after that, support.
app.post(
  "/api/orders/:id/cancel",
  requireRider,
  asyncRoute(async (req, res) => {
    const order = await loadRiderOrder(req, req.params.id);
    if (!order) return fail(res, "Order not found.", 404);
    if (!orderRules.canTransition("rider", order.status, "cancelled_by_rider")) return fail(res, "This order is ready or on its way. Please contact support to cancel it.", 409);
    const moved = await moveOrder(order, "cancelled_by_rider", { kind: "rider", id: String(req.rider.id) }, { reason: cleanString(req.body && req.body.reason, 300) || "Cancelled by the customer.", req });
    if (!moved.ok) return fail(res, moved.error, moved.status);
    return ok(res, { order: riderOrderView(moved.order, (await loadOrderItems([order.id]))[order.id], await storeName(order.merchant_id)) });
  })
);

// Store inbox. The store sees first names, items and notes only.
app.get(
  "/api/merchant/orders",
  requireMerchant,
  asyncRoute(async (req, res) => {
    await sweepOrders({ merchantId: req.merchant.id });
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabase.from("orders").select(ORDER_FIELDS).eq("merchant_id", req.merchant.id).neq("status", "pending_payment").gte("created_at", since).order("created_at", { ascending: false }).limit(100);
    if (ordersNotSetUp(error)) return ok(res, { orders: [], not_set_up: true });
    if (error) return fail(res, "Orders could not be loaded.", 502);
    const items = await loadOrderItems((data || []).map((o) => o.id));
    const names = await riderFirstNames((data || []).map((o) => o.rider_id));
    return ok(res, { orders: (data || []).map((o) => orderRules.storeView(o, items[o.id], names[o.rider_id])), enabled: ENABLE_MERCHANT_ORDERS });
  })
);

async function loadStoreOrder(req, id) {
  const { data } = await supabase.from("orders").select(ORDER_FIELDS).eq("id", cleanString(id, 64)).eq("merchant_id", req.merchant.id).maybeSingle();
  return data || null;
}
const STORE_ACTIONS = {
  accept: { to: "accepted" },
  reject: { to: "rejected", needsReason: true },
  ready: { to: "ready" },
  cancel: { to: "cancelled_by_store", needsReason: true }
};
// Step 3c-2: the store settles each item while preparing.
app.post(
  "/api/merchant/orders/:id/items/:itemId",
  requireMerchant,
  asyncRoute(async (req, res) => {
    const order = await loadStoreOrder(req, req.params.id);
    if (!order) return fail(res, "Order not found.", 404);
    const items = (await loadOrderItems([order.id]))[order.id] || [];
    const body = req.body || {};
    const plan = orderRules.planItemAction({
      order,
      items,
      itemId: cleanString(req.params.itemId, 64),
      action: cleanString(body.action, 20),
      substituteName: cleanString(body.substitute_name, 200),
      substitutePriceCents: body.substitute_price_cents
    });
    if (!plan.ok) return fail(res, plan.error, plan.status);
    const { data: updated } = await supabase.from("order_items").update(plan.patch).eq("id", cleanString(req.params.itemId, 64)).eq("order_id", order.id).eq("fulfilment", "pending").select("id").maybeSingle();
    if (!updated) return fail(res, "This item changed. Reload and try again.", 409);
    // "Contact me first": alert the rider by web push (if they turned it on).
    // No item names or prices: push sign-up isn't tied to a session yet.
    if (plan.patch.fulfilment === "out_of_stock") {
      sendPushNotification({ ownerType: "rider", ownerId: order.rider_id, title: "Your store has a question", body: "An item in your order is out of stock. Open Harvey Taxi within 7 minutes to choose the store's suggestion or a refund.", url: `/store-menu.html?order=${encodeURIComponent(order.id)}` }).catch(() => {});
    }
    auditLog({ actor_type: "merchant_user", actor_id: req.merchantUser.id, action: "order_item_marked", entity_type: "order", entity_id: order.id, metadata: { item_id: updated.id, fulfilment: plan.patch.fulfilment, substitute_price_cents: plan.patch.substitute_price_cents || null }, req }).catch(() => {});
    const names = await riderFirstNames([order.rider_id]);
    return ok(res, { order: orderRules.storeView(order, (await loadOrderItems([order.id]))[order.id], names[order.rider_id]) });
  })
);

app.post(
  "/api/merchant/orders/:id/:action",
  requireMerchant,
  asyncRoute(async (req, res) => {
    const action = STORE_ACTIONS[req.params.action];
    if (!action) return fail(res, "Unknown action.", 404);
    const order = await loadStoreOrder(req, req.params.id);
    if (!order) return fail(res, "Order not found.", 404);
    // A late answer to an order that has run out of time expires it instead.
    if (order.status === "placed" && orderRules.sweepAction(order) === "expired") {
      await moveOrder(order, "expired", { kind: "system", id: "order_sweep" }, { reason: "The store didn't respond in time." });
      return fail(res, "This order expired before it was accepted. The customer's card hold was released.", 409);
    }
    const reason = cleanString(req.body && req.body.reason, 500);
    if (action.needsReason && reason.length < 3) return fail(res, "Give the customer a reason.", 400);
    if (action.to === "ready") {
      await settleExpiredQuestions({ orderIds: [order.id] });
      const blockers = orderRules.readyBlockers((await loadOrderItems([order.id]))[order.id]);
      if (blockers.length) return fail(res, `Mark every item before the order is ready. Still to do: ${blockers.join(", ")}.`, 409);
    }
    const patch = {};
    if (action.to === "accepted") {
      const prep = orderRules.validPrepMinutes(req.body && req.body.prep_minutes);
      if (!prep) return fail(res, `Enter a preparation time from ${orderRules.PREP_MINUTES.min} to ${orderRules.PREP_MINUTES.max} minutes.`, 400);
      patch.prep_minutes = prep;
    }
    const moved = await moveOrder(order, action.to, { kind: "merchant", id: req.merchantUser.id }, { reason: reason || null, patch, req });
    if (!moved.ok) return fail(res, moved.error, moved.status);
    // Step 3c-3: accepting starts the delivery trip (retried by the sweep if this fails).
    if (action.to === "accepted") await createOrderTrip(moved.order);
    if (action.to === "ready") await releaseHeldOrderTrip(moved.order);
    const names = await riderFirstNames([order.rider_id]);
    return ok(res, { order: orderRules.storeView(moved.order, (await loadOrderItems([order.id]))[order.id], names[order.rider_id]) });
  })
);

// Staff: every order, with stuck ones flagged; detail with history; cancel.
function orderAttention(o, now = Date.now()) {
  if (o.status === "accepted" && o.accepted_at && now > Date.parse(o.accepted_at) + ((o.prep_minutes || 0) + 20) * 60000) return "Past its preparation time";
  if (o.status === "ready" && o.ready_at && now > Date.parse(o.ready_at) + 30 * 60000) return "Ready for over 30 minutes";
  if (o.status === "delivered") return "Delivered, but the card charge didn't go through";
  if (["accepted", "ready"].includes(o.status) && !o.ride_id && o.accepted_at && now > Date.parse(o.accepted_at) + 2 * 60000) return "No delivery trip yet";
  return null;
}
app.get(
  "/api/admin/orders",
  requireAdmin,
  asyncRoute(async (req, res) => {
    await sweepOrders();
    let query = supabase.from("orders").select(ORDER_FIELDS).order("created_at", { ascending: false }).limit(200);
    if (req.query.view !== "all") query = query.in("status", orderRules.OPEN);
    const { data, error } = await query;
    if (ordersNotSetUp(error)) return ok(res, { orders: [], not_set_up: true, enabled: ENABLE_MERCHANT_ORDERS });
    if (error) return fail(res, "Orders could not be loaded.", 502);
    const ids = [...new Set((data || []).map((o) => o.merchant_id))];
    const names = {};
    if (ids.length) {
      const { data: stores } = await supabase.from("merchants").select("id, business_name").in("id", ids);
      for (const s of stores || []) names[s.id] = s.business_name;
    }
    return ok(res, {
      enabled: ENABLE_MERCHANT_ORDERS,
      test_mode_keys: ordersStripeTestMode(),
      orders: (data || []).map((o) => ({ ...riderOrderView(o, [], names[o.merchant_id]), attention: orderAttention(o), created_at: o.created_at, can_staff_cancel: orderRules.canTransition("admin", o.status, "cancelled_by_staff") }))
    });
  })
);

app.get(
  "/api/admin/orders/:id",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const { data: order } = await supabase.from("orders").select(ORDER_FIELDS).eq("id", cleanString(req.params.id, 64)).maybeSingle();
    if (!order) return fail(res, "Order not found.", 404);
    const { data: events } = await supabase.from("order_events").select("from_status, to_status, actor_type, actor_id, reason, created_at").eq("order_id", order.id).order("created_at", { ascending: true });
    const names = await riderFirstNames([order.rider_id]);
    return ok(res, {
      order: { ...riderOrderView(order, (await loadOrderItems([order.id]))[order.id], await storeName(order.merchant_id)), rider_first_name: names[order.rider_id] || null, payment_intent_id: order.payment_intent_id, attention: orderAttention(order) },
      events: (events || []).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
    });
  })
);

app.post(
  "/api/admin/orders/:id/cancel",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const reason = cleanString(req.body && req.body.reason, 500);
    if (reason.length < 10) return fail(res, "Give a reason of at least 10 characters.", 400);
    const { data: order } = await supabase.from("orders").select(ORDER_FIELDS).eq("id", cleanString(req.params.id, 64)).maybeSingle();
    if (!order) return fail(res, "Order not found.", 404);
    const moved = await moveOrder(order, "cancelled_by_staff", { kind: "admin", id: req.admin.email || req.admin.id }, { reason, req });
    if (!moved.ok) return fail(res, moved.error, moved.status);
    return ok(res, { order: riderOrderView(moved.order, [], await storeName(order.merchant_id)) });
  })
);

// Step 3c-4: missing-item refunds (term 4; agent rule 8). The rider reports
// within 48 hours of delivery; the claim becomes a proposal; only the owner
// account can approve it, and only then does Stripe refund (orders test key).
// The store's share comes back through the ledger after its 48-hour dispute
// window. A declined or failed refund moves no money.
const PROPOSAL_FIELDS = "id, order_id, merchant_id, rider_id, market, type, status, review_priority, reasons, lines, idempotency_key, claimed_at, customer_refund_cents, item_cents, tax_cents, merchant_deduction_cents, commission_reversed_cents, reviewed_by, reviewed_at, decision_reason, stripe_refund_id, refunded_at, failure_reason, merchant_notified_at, dispute_filed_at, dispute_outcome, dispute_decided_at, livemode, created_at, updated_at";
const proposalsNotSetUp = (error) => error && (error.code === "42P01" || error.code === "42703");
function riderClaimView(p) {
  return { id: p.id, status: p.status, refund_cents: p.customer_refund_cents, claimed_at: p.claimed_at, refunded_at: p.refunded_at || null, decision_reason: p.status === "declined" ? p.decision_reason : null };
}
function storeClaimView(p, orderNumber, itemNames) {
  const windowEnds = p.merchant_notified_at ? new Date(Date.parse(p.merchant_notified_at) + 48 * 3600000).toISOString() : null;
  return {
    id: p.id,
    order_number: orderNumber || null,
    status: p.status,
    claimed_at: p.claimed_at,
    items: (p.lines || []).map((l) => ({ name: itemNames[l.item_id] || "Item", quantity: l.quantity })),
    deduction_cents: p.merchant_deduction_cents,
    dispute_until: windowEnds,
    can_dispute: !p.dispute_filed_at && ["pending_review", "approved", "refunded"].includes(p.status) && windowEnds && Date.now() <= Date.parse(windowEnds),
    dispute: p.dispute_filed_at ? { filed_at: p.dispute_filed_at, outcome: p.dispute_outcome } : null
  };
}

app.post(
  "/api/orders/:id/claims",
  requireRider,
  rateLimit({ windowMs: 60 * 60_000, max: 10, keyPrefix: "order_claims", keyFn: (req) => `r:${req.rider && req.rider.id}` }),
  asyncRoute(async (req, res) => {
    const order = await loadRiderOrder(req, req.params.id);
    if (!order) return fail(res, "Order not found.", 404);
    const items = (await loadOrderItems([order.id]))[order.id] || [];
    const since = new Date(Date.now() - 32 * 24 * 3600000).toISOString();
    const { data: earlier, error: earlierError } = await supabase.from("order_refund_proposals").select("claimed_at").eq("rider_id", String(req.rider.id)).gte("claimed_at", since);
    if (proposalsNotSetUp(earlierError)) return fail(res, "Missing-item reports aren't set up yet.", 503);
    const body = req.body || {};
    const planned = orderRules.planOrderClaim({ order, items, claim: Array.isArray(body.items) ? body.items.slice(0, 50) : [], customerClaimsThisMonth: orderRules.claimsThisMonth((earlier || []).map((e) => e.claimed_at)) });
    if (!planned.ok) return fail(res, planned.error, planned.reason === "claim_window_closed" || planned.reason === "exceeds_captured" ? 409 : 400);
    const { data: created, error } = await supabase.from("order_refund_proposals").insert({ id: crypto.randomUUID(), ...planned.row, created_at: nowIso(), updated_at: nowIso() }).select(PROPOSAL_FIELDS).single();
    if (error && error.code === "23505") return fail(res, "You've already reported these items.", 409);
    if (error || !created) return fail(res, "Your report couldn't be saved. Please try again.", 502);
    auditLog({ actor_type: "rider", actor_id: String(req.rider.id), action: "order_claim_reported", entity_type: "order", entity_id: order.id, metadata: { proposal_id: created.id, refund_cents: created.customer_refund_cents, review_priority: created.review_priority }, req }).catch(() => {});
    return ok(res, { claim: riderClaimView(created) }, 201);
  })
);

// The store sees reports on its orders and may dispute within 48 hours.
app.get(
  "/api/merchant/claims",
  requireMerchant,
  asyncRoute(async (req, res) => {
    const since = new Date(Date.now() - 14 * 24 * 3600000).toISOString();
    const { data, error } = await supabase.from("order_refund_proposals").select(PROPOSAL_FIELDS).eq("merchant_id", req.merchant.id).gte("created_at", since).order("created_at", { ascending: false }).limit(50);
    if (proposalsNotSetUp(error)) return ok(res, { claims: [], not_set_up: true });
    if (error) return fail(res, "Reports could not be loaded.", 502);
    const orderIds = [...new Set((data || []).map((p) => p.order_id))];
    const numbers = {};
    if (orderIds.length) {
      const { data: os } = await supabase.from("orders").select("id, order_number").in("id", orderIds);
      for (const o of os || []) numbers[o.id] = o.order_number;
    }
    const names = {};
    for (const list of Object.values(await loadOrderItems(orderIds))) for (const i of list) names[i.id] = i.fulfilment === "substituted" && i.substitute_name ? i.substitute_name : i.name;
    return ok(res, { claims: (data || []).map((p) => storeClaimView(p, numbers[p.order_id], names)) });
  })
);

app.post(
  "/api/merchant/claims/:id/dispute",
  requireMerchant,
  asyncRoute(async (req, res) => {
    const reason = cleanString(req.body && req.body.reason, 500);
    if (reason.length < 10) return fail(res, "Explain the dispute in at least 10 characters.", 400);
    const { data: p } = await supabase.from("order_refund_proposals").select(PROPOSAL_FIELDS).eq("id", cleanString(req.params.id, 64)).eq("merchant_id", req.merchant.id).maybeSingle();
    if (!p) return fail(res, "Report not found.", 404);
    if (!storeClaimView(p, null, {}).can_dispute) return fail(res, "This report can no longer be disputed.", 409);
    const at = nowIso();
    const { data: updated } = await supabase.from("order_refund_proposals").update({ dispute_filed_at: at, dispute_outcome: "pending", updated_at: at }).eq("id", p.id).is("dispute_filed_at", null).select(PROPOSAL_FIELDS).maybeSingle();
    if (!updated) return fail(res, "This report changed. Reload and try again.", 409);
    auditLog({ actor_type: "merchant_user", actor_id: req.merchantUser.id, action: "order_claim_disputed", entity_type: "order_refund_proposal", entity_id: p.id, metadata: { order_id: p.order_id, reason }, req }).catch(() => {});
    return ok(res, { claim: storeClaimView(updated, null, {}) });
  })
);

// Staff: the review list. Anyone signed in to the admin dashboard can see
// it; only the owner account can decide.
app.get(
  "/api/admin/refund-proposals",
  requireAdmin,
  asyncRoute(async (req, res) => {
    await settleStoreDeductions();
    let query = supabase.from("order_refund_proposals").select(PROPOSAL_FIELDS).order("created_at", { ascending: false }).limit(200);
    if (req.query.view !== "all") query = query.in("status", ["pending_review", "approved", "refund_failed"]);
    const { data, error } = await query;
    if (proposalsNotSetUp(error)) return ok(res, { proposals: [], not_set_up: true });
    if (error) return fail(res, "Refund proposals could not be loaded.", 502);
    const orderIds = [...new Set((data || []).map((p) => p.order_id))];
    const orderInfo = {};
    if (orderIds.length) {
      const { data: os } = await supabase.from("orders").select("id, order_number, merchant_id, captured_cents, refunded_cents").in("id", orderIds);
      for (const o of os || []) orderInfo[o.id] = o;
    }
    const names = {};
    for (const list of Object.values(await loadOrderItems(orderIds))) for (const i of list) names[i.id] = i.fulfilment === "substituted" && i.substitute_name ? i.substitute_name : i.name;
    const storeNames = {};
    for (const id of new Set((data || []).map((p) => p.merchant_id))) storeNames[id] = await storeName(id);
    return ok(res, {
      proposals: (data || []).map((p) => ({
        ...p,
        order_number: orderInfo[p.order_id] ? orderInfo[p.order_id].order_number : null,
        store_name: storeNames[p.merchant_id] || null,
        items: (p.lines || []).map((l) => ({ name: names[l.item_id] || "Item", quantity: l.quantity, item_cents: l.item_cents })),
        rider_id: undefined
      }))
    });
  })
);

async function requireOwnerDecision(req, res) {
  const { role } = await resolveAdminRoleForRequest(req);
  if (role !== "super_admin") {
    fail(res, "Refund decisions require the owner account.", 403);
    return false;
  }
  return true;
}

async function executeProposalRefund(p, req) {
  const { data: order } = await supabase.from("orders").select(ORDER_FIELDS).eq("id", p.order_id).maybeSingle();
  let refund = null;
  try {
    if (!ordersStripe) throw new Error("orders Stripe key not configured");
    if (!order || !order.payment_intent_id || order.livemode || p.livemode) throw new Error("order payment not found or not test mode");
    if (p.customer_refund_cents > (order.captured_cents || 0) - (order.refunded_cents || 0)) throw new Error("exceeds what is left to refund");
    refund = await ordersStripe.refunds.create({ payment_intent: order.payment_intent_id, amount: p.customer_refund_cents, metadata: { app: ORDER_INTENT_APP_TAG, order_id: order.id, refund_proposal_id: p.id } }, { idempotencyKey: `harvey-order-refund-${p.id}` });
    if (!refund || refund.livemode || !["succeeded", "pending"].includes(refund.status)) throw new Error(`refund status ${refund && refund.status}`);
  } catch (err) {
    const at = nowIso();
    const { data: failed } = await supabase.from("order_refund_proposals").update({ status: "refund_failed", failure_reason: String(err.message || "refund failed").slice(0, 300), updated_at: at }).eq("id", p.id).eq("status", "approved").select(PROPOSAL_FIELDS).maybeSingle();
    auditLog({ actor_type: "admin", actor_id: req.admin.email || req.admin.id, action: "order_refund_failed", entity_type: "order_refund_proposal", entity_id: p.id, metadata: { order_id: p.order_id, error: String(err.message).slice(0, 200) }, req }).catch(() => {});
    return { ok: false, proposal: failed || p };
  }
  const at = nowIso();
  const { data: done, error: recordError } = await supabase.from("order_refund_proposals").update({ status: "refunded", stripe_refund_id: refund.id, refunded_at: at, failure_reason: null, updated_at: at }).eq("id", p.id).eq("status", "approved").select(PROPOSAL_FIELDS).maybeSingle();
  if (recordError || !done) {
    // Stripe refunded but the record didn't save: never retry the refund; staff reconcile by the Stripe id.
    console.error("❌ order refund not recorded:", p.id, refund.id, recordError && recordError.message);
    auditLog({ actor_type: "system", actor_id: "order_refund", action: "order_refund_record_failed", entity_type: "order_refund_proposal", entity_id: p.id, metadata: { order_id: p.order_id, stripe_refund_id: refund.id, amount_cents: p.customer_refund_cents, error: String((recordError && recordError.message) || "no row").slice(0, 200) }, req }).catch(() => {});
  }
  // Record the refund on the order and its items (read first; never more than captured).
  await supabase.from("orders").update({ refunded_cents: Math.min(order.captured_cents, (order.refunded_cents || 0) + p.customer_refund_cents), updated_at: at }).eq("id", order.id).eq("refunded_cents", order.refunded_cents || 0);
  const items = (await loadOrderItems([order.id]))[order.id] || [];
  for (const l of p.lines || []) {
    const item = items.find((i) => i.id === l.item_id);
    if (item) await supabase.from("order_items").update({ refunded_quantity: Math.min(item.quantity, (item.refunded_quantity || 0) + l.quantity) }).eq("id", item.id).eq("refunded_quantity", item.refunded_quantity || 0);
  }
  auditLog({ actor_type: "admin", actor_id: req.admin.email || req.admin.id, action: "order_refunded", entity_type: "order_refund_proposal", entity_id: p.id, metadata: { order_id: order.id, amount_cents: p.customer_refund_cents, stripe_refund_id: refund.id }, req }).catch(() => {});
  return { ok: true, proposal: done || p };
}

const refundDecisionRoute = (decision) => [
  requireAdmin,
  rateLimit({ windowMs: 60_000, max: 20, keyPrefix: "order_refund_decision" }),
  asyncRoute(async (req, res) => {
    if (!(await requireOwnerDecision(req, res))) return;
    const { data: p } = await supabase.from("order_refund_proposals").select(PROPOSAL_FIELDS).eq("id", cleanString(req.params.id, 64)).maybeSingle();
    if (!p) return fail(res, "Refund proposal not found.", 404);
    const who = req.admin.email || req.admin.id;
    const at = nowIso();
    if (decision === "decline") {
      const reason = cleanString(req.body && req.body.reason, 500);
      if (reason.length < 10) return fail(res, "Give the rider a reason of at least 10 characters.", 400);
      const { data: declined } = await supabase.from("order_refund_proposals").update({ status: "declined", reviewed_by: who, reviewed_at: at, decision_reason: reason, updated_at: at }).eq("id", p.id).eq("status", "pending_review").select(PROPOSAL_FIELDS).maybeSingle();
      if (!declined) return fail(res, "Only a proposal waiting for review can be declined.", 409);
      auditLog({ actor_type: "admin", actor_id: who, action: "order_refund_declined", entity_type: "order_refund_proposal", entity_id: p.id, metadata: { order_id: p.order_id, reason }, req }).catch(() => {});
      return ok(res, { proposal: declined });
    }
    if (decision === "dispute-outcome") {
      const outcome = cleanString(req.body && req.body.outcome, 20);
      if (!["merchant_wins", "merchant_loses"].includes(outcome)) return fail(res, "Choose who the dispute goes to.", 400);
      const { data: decided } = await supabase.from("order_refund_proposals").update({ dispute_outcome: outcome, dispute_decided_at: at, updated_at: at }).eq("id", p.id).eq("dispute_outcome", "pending").select(PROPOSAL_FIELDS).maybeSingle();
      if (!decided) return fail(res, "There's no open dispute on this proposal.", 409);
      auditLog({ actor_type: "admin", actor_id: who, action: "order_claim_dispute_decided", entity_type: "order_refund_proposal", entity_id: p.id, metadata: { order_id: p.order_id, outcome }, req }).catch(() => {});
      await settleStoreDeductions();
      return ok(res, { proposal: decided });
    }
    // approve (pending_review) or retry (refund_failed): a person's decision, then the refund.
    const from = decision === "approve" ? "pending_review" : "refund_failed";
    const { data: approved } = await supabase.from("order_refund_proposals").update({ status: "approved", reviewed_by: decision === "approve" ? who : p.reviewed_by, reviewed_at: decision === "approve" ? at : p.reviewed_at, updated_at: at }).eq("id", p.id).eq("status", from).select(PROPOSAL_FIELDS).maybeSingle();
    if (!approved) return fail(res, decision === "approve" ? "Only a proposal waiting for review can be approved." : "Only a failed refund can be retried.", 409);
    auditLog({ actor_type: "admin", actor_id: who, action: decision === "approve" ? "order_refund_approved" : "order_refund_retried", entity_type: "order_refund_proposal", entity_id: p.id, metadata: { order_id: p.order_id, amount_cents: p.customer_refund_cents, review_priority: p.review_priority }, req }).catch(() => {});
    const result = await executeProposalRefund(approved, req);
    if (!result.ok) return res.status(502).json({ ok: false, error: "Stripe didn't complete the refund. Nothing was refunded; you can retry.", proposal: result.proposal });
    return ok(res, { proposal: result.proposal });
  })
];
app.post("/api/admin/refund-proposals/:id/approve", ...refundDecisionRoute("approve"));
app.post("/api/admin/refund-proposals/:id/decline", ...refundDecisionRoute("decline"));
app.post("/api/admin/refund-proposals/:id/retry", ...refundDecisionRoute("retry"));
app.post("/api/admin/refund-proposals/:id/dispute-outcome", ...refundDecisionRoute("dispute-outcome"));

// The store's share of a refund comes back through the ledger once its
// 48-hour dispute window has passed (or it lost a dispute). One debit per
// proposal; runs with the order sweep and when staff open the list.
async function settleStoreDeductions() {
  const { data: refunded, error } = await supabase.from("order_refund_proposals").select(PROPOSAL_FIELDS).eq("status", "refunded").gt("merchant_deduction_cents", 0).limit(200);
  if (error || !refunded || !refunded.length) return;
  const { data: done } = await supabase.from("store_ledger_entries").select("refund_proposal_id").eq("entry_type", "refund_deduction").in("refund_proposal_id", refunded.map((p) => p.id));
  const already = new Set((done || []).map((d) => d.refund_proposal_id));
  for (const p of refunded) {
    if (already.has(p.id)) continue;
    const entry = orderRules.deductionEntry(p);
    if (!entry) continue;
    const { error: insertError } = await supabase.from("store_ledger_entries").insert({ id: crypto.randomUUID(), ...entry, created_at: nowIso() });
    if (insertError && insertError.code !== "23505") console.error("❌ store ledger deduction failed:", p.id, insertError.message);
    else if (!insertError) auditLog({ actor_type: "system", actor_id: "refund_deduction", action: "store_ledger_deduction", entity_type: "order_refund_proposal", entity_id: p.id, metadata: { merchant_id: p.merchant_id, amount_cents: p.merchant_deduction_cents } }).catch(() => {});
  }
}

/* =========================================================

   ADMIN MANUAL CONTACT-VERIFICATION OVERRIDE (DRIVER)

   A human admin attesting they directly confirmed a driver's phone
   number or email address outside the normal SMS/email code flow.
   Separate from ordinary approval (which never touches these fields —
   see above) and separate from the compliance override below, which
   requires elevated authorization. This one only requires a written
   reason and ordinary admin auth.

========================================================= */

app.patch(

  "/api/admin/drivers/:id/contact-verification-override",

  requireAdmin,

  asyncRoute(async (req, res) => {

    const driverId =

      cleanString(

        req.params.id,

        100

      );

    const reason =

      cleanString(

        req.body.reason,

        1000

      );

    if (!reason) {

      return fail(

        res,

        "A written reason is required for a manual contact-verification override.",

        400

      );

    }

    const emailVerified =

      typeof req.body.email_verified === "boolean"

        ? req.body.email_verified

        : undefined;

    const phoneVerified =

      typeof req.body.phone_verified === "boolean"

        ? req.body.phone_verified

        : undefined;

    if (

      emailVerified === undefined &&

      phoneVerified === undefined

    ) {

      return fail(

        res,

        "At least one of email_verified or phone_verified must be provided.",

        400

      );

    }

    // Applies the driver update and writes the audit_logs row inside a
    // single atomic database transaction (see apply_driver_contact_
    // verification_override() in supabase/migrations) -- this override
    // must never report success unless its audit record actually
    // persisted, so there is deliberately no separate, fallible
    // auditLog(...).catch(() => {}) call after a successful update here.
    const result =

      await applyContactVerificationOverride({

        callRpc:

          (name, params) =>

            supabase.rpc(name, params),

        driverId,

        emailVerified,

        phoneVerified,

        actorType:

          "admin",

        actorId:

          req.admin.email,

        action:

          "driver_contact_verification_override",

        metadata: {

          reason,

          email_verified:

            emailVerified,

          phone_verified:

            phoneVerified,

          admin_auth_method:

            req.admin.method

        },

        ipAddress:

          getClientIp(req),

        userAgent:

          req.headers["user-agent"] || null

      });

    if (!result.ok) {

      return fail(

        res,

        result.error,

        result.statusCode

      );

    }

    return ok(res, {

      driver:

        result.driver

    });

  })

);

/* =========================================================

   ADMIN MANUAL COMPLIANCE OVERRIDE (DRIVER)

   The only way to set checkr_status or persona_verified other than a
   real, signature-verified Checkr/Persona webhook event. Requires
   elevated admin authorization (the pre-shared admin_token method, not
   an ordinary password/session login), a written reason of meaningful
   length, and an explicit confirmation that the administrator reviewed
   equivalent documentation. This exists for genuinely exceptional,
   manually-reviewed cases -- it must never become how ordinary approvals
   are handled.

========================================================= */

app.patch(

  "/api/admin/drivers/:id/compliance-override",

  requireElevatedAdmin,

  asyncRoute(async (req, res) => {

    // requireElevatedAdmin() (already stricter than plain
    // requireAdmin -- token-method only) is this route's real,
    // unchanged authority. The shadow check below is purely
    // observational, same as every other instrumented route.
    logAdminRbacShadowCheck(
      req,
      "PATCH /api/admin/drivers/:id/compliance-override",
      RBAC_SHADOW_ROUTE_CAPABILITIES["PATCH /api/admin/drivers/:id/compliance-override"]
    ).catch(() => {});

    const driverId =

      cleanString(

        req.params.id,

        100

      );

    const validation =

      validateComplianceOverrideRequest({

        authMethod:

          req.admin.method,

        reason:

          req.body.reason,

        reviewedDocumentation:

          req.body.reviewed_documentation

      });

    if (!validation.ok) {

      return fail(

        res,

        validation.error,

        validation.statusCode

      );

    }

    const checkrStatus =

      req.body.checkr_status !== undefined

        ? cleanString(req.body.checkr_status, 50)

        : undefined;

    const personaVerified =

      typeof req.body.persona_verified === "boolean"

        ? req.body.persona_verified

        : undefined;

    if (

      checkrStatus === undefined &&

      personaVerified === undefined

    ) {

      return fail(

        res,

        "At least one of checkr_status or persona_verified must be provided.",

        400

      );

    }

    const reason =

      cleanString(

        req.body.reason,

        1000

      );

    // Same atomic-or-nothing guarantee as the contact-verification
    // override above -- this action can make a ride dispatch to a driver
    // with no real background check on file, so it must never report
    // success unless its audit record actually persisted alongside it.
    const result =

      await applyComplianceOverride({

        callRpc:

          (name, params) =>

            supabase.rpc(name, params),

        driverId,

        checkrStatus,

        personaVerified,

        actorType:

          "admin",

        actorId:

          req.admin.email,

        action:

          "driver_compliance_override",

        metadata: {

          reason,

          reviewed_documentation:

            true,

          checkr_status:

            checkrStatus,

          persona_verified:

            personaVerified,

          admin_auth_method:

            req.admin.method

        },

        ipAddress:

          getClientIp(req),

        userAgent:

          req.headers["user-agent"] || null

      });

    if (!result.ok) {

      return fail(

        res,

        result.error,

        result.statusCode

      );

    }

    return ok(res, {

      driver:

        result.driver

    });

  })

);

/* =========================================================

   ADMIN REJECT DRIVER

========================================================= */

app.patch(

  "/api/admin/drivers/:id/reject",

  requireAdmin,

  asyncRoute(async (req, res) => {

    const driverId =

      cleanString(

        req.params.id,

        100

      );

    const reason =

      cleanString(

        req.body.reason,

        1000

      );

    const { data, error } =

      await supabase

        .from("drivers")

        .update({

          status:

            "rejected",

          approval_status:

            "rejected",

          rejection_reason:

            reason,

          updated_at:

            nowIso()

        })

        .eq("id", driverId)

        .select(ADMIN_DRIVER_MUTATION_FIELDS.join(","))

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

        "driver_rejected",

      entity_type:

        "driver",

      entity_id:

        driverId,

      metadata: {

        reason

      },

      req

    }).catch(() => {});

    broadcastSse(

      "driver_rejected",

      {

        driver:

          data

      }

    );

    return ok(res, {

      driver:

        data

    });

  })

);

/* =========================================================

   ADMIN APPROVE RIDER

========================================================= */

app.patch(

  "/api/admin/riders/:id/approve",

  requireAdmin,

  asyncRoute(async (req, res) => {

    const riderId =

      cleanString(

        req.params.id,

        100

      );

    // getRiderReadiness() requires email_verified AND sms_verified AND
    // status/approval_status to all be true (Object.values(checks).
    // every(Boolean)) -- setting only status/approval_status here used to
    // mean an admin approval could never actually unblock a rider from
    // booking, since the email/SMS checks stayed false regardless. This
    // route is an explicit "admin vouches for this rider" action, so it
    // now sets both verification flags too, same as completing the real
    // verification flow would.
    const { data, error } =

      await supabase

        .from("riders")

        .update({

          status:

            "active",

          approval_status:

            "approved",

          approved_at:

            nowIso(),

          email_verified:

            true,

          sms_verified:

            true,

          updated_at:

            nowIso()

        })

        .eq("id", riderId)

        .select(ADMIN_RIDER_MUTATION_FIELDS.join(","))

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

        "rider_approved",

      entity_type:

        "rider",

      entity_id:

        riderId,

      req

    }).catch(() => {});

    broadcastSse(

      "rider_approved",

      {

        rider:

          data

      }

    );

    return ok(res, {

      rider:

        data

    });

  })

);

/* =========================================================
   ADMIN SUSPEND / REINSTATE RIDER (owner decision 2026-10-18)
   The staff control that goes with automatic approval on phone
   verification (Option A). A person decides; the route records who,
   when and why. A suspended rider can sign in but cannot book
   (getRiderReadiness), and the auto-approval rule never re-approves
   them. Reinstating restores approval if their phone is verified.
========================================================= */

async function changeRiderSuspension(req, res, action) {
  const riderId = cleanString(req.params.id, 100);
  const reason = cleanStaffReason(req.body?.reason);
  if (!riderId) {
    return fail(res, "Rider ID is required.", 400);
  }
  if (!reason) {
    return fail(res, "Give a reason of 3 to 500 characters.", 400);
  }

  const { data: rider, error: lookupError } = await supabase
    .from("riders")
    .select("id, status, approval_status, sms_verified, is_blocked, is_review_account")
    .eq("id", riderId)
    .maybeSingle();
  if (lookupError) throw lookupError;
  if (!rider) {
    return fail(res, "Rider not found.", 404);
  }

  const previous = { status: rider.status, approval_status: rider.approval_status };
  const now = nowIso();
  const update = action === "suspend"
    ? buildRiderSuspensionUpdate({ reason, now })
    : buildRiderReinstatementUpdate({ rider, reason, now });

  const { data, error } = await supabase
    .from("riders")
    .update(update)
    .eq("id", riderId)
    .select(ADMIN_RIDER_MUTATION_FIELDS.join(","))
    .single();
  if (error) throw error;

  auditLog({
    actor_type: "admin",
    actor_id: req.admin.email,
    action: action === "suspend" ? "rider_suspended" : "rider_reinstated",
    entity_type: "rider",
    entity_id: riderId,
    metadata: {
      reason,
      previous_status: previous.status || null,
      previous_approval_status: previous.approval_status || null
    },
    req
  }).catch(() => {});

  return ok(res, { rider: data });
}

app.post(
  "/api/admin/riders/:id/suspend",
  requireAdmin,
  asyncRoute((req, res) => changeRiderSuspension(req, res, "suspend"))
);

app.post(
  "/api/admin/riders/:id/reinstate",
  requireAdmin,
  asyncRoute((req, res) => changeRiderSuspension(req, res, "reinstate"))
);

/* =========================================================

   ADMIN AUDIT LOGS

========================================================= */

app.get(

  "/api/admin/audit-logs",

  requireAdmin,

  asyncRoute(async (req, res) => {

    logAdminRbacShadowCheck(
      req,
      "GET /api/admin/audit-logs",
      RBAC_SHADOW_ROUTE_CAPABILITIES["GET /api/admin/audit-logs"]
    ).catch(() => {});

    const limit =

      getPageLimit(

        req,

        envNumber("AUDIT_LOG_LIMIT", 300),

        500

      );

    const cursor =

      decodeCursor(req.query.cursor);

    let query =

      supabase

        .from("audit_logs")

        .select(ADMIN_AUDIT_LOGS_LIST_FIELDS.join(","))

        .order("created_at", {

          ascending: false

        })

        .order("id", {

          ascending: false

        })

        .limit(limit);

    query = applyCursor(query, cursor);

    const { data, error } =

      await query;

    if (error) {

      throw error;

    }

    const rows = data || [];

    const next_cursor =

      rows.length === limit

        ? encodeCursor(rows[rows.length - 1])

        : null;

    return ok(res, {

      logs:

        rows,

      page: {

        limit,

        count: rows.length,

        next_cursor

      }

    });

  })

);

/* =========================================================

   ADMIN CREATE HTAF RIDE

========================================================= */

app.post(

  "/api/admin/foundation/applications/:id/create-ride",

  requireAdmin,
  requireHtafCapability("POST /api/admin/foundation/applications/:id/create-ride", "htaf.rides.create"),

  asyncRoute(async (req, res) => {
    if (!HTAF_ACTIVATION.rideCreation.enabled) {
      // IDs only: the blocked attempt is recorded without reading or
      // logging anything from the application itself.
      auditLog({
        actor_type: "admin",
        actor_id: req.admin.email,
        action: "htaf_ride_creation_blocked",
        entity_type: "htaf_application",
        entity_id: cleanString(req.params.id, 100),
        metadata: { reason: HTAF_ACTIVATION.rideCreation.reason },
        req
      }).catch(() => {});
      return fail(res, "HTAF ride creation is paused pending an approved provider agreement.", 403);
    }

    const applicationId =

      cleanString(

        req.params.id,

        100

      );

    const { data: application, error } =

      await supabase

        .from("htaf_applications")

        .select("*")

        .eq("id", applicationId)

        .single();

    if (error || !application) {

      return fail(

        res,

        "HTAF application not found.",

        404

      );

    }

    const estimate =

      calculateRideEstimate({

        miles:

          Number(req.body.miles || 0),

        minutes:

          Number(req.body.minutes || 0),

        ride_type:

          "foundation"

      });

    // The application is loaded above only to build the ride's field
    // values (rider name/phone, pickup/dropoff, fare estimate). Whether
    // a ride should actually be created — vs. returning an existing one
    // or failing closed on an inconsistent state — is decided inside
    // create_htaf_ride_atomic itself, under a row lock, so a retried
    // request or an admin double-click cannot create two rides for the
    // same application (see supabase/migrations/20260806120000_htaf_ride_idempotency.sql).
    const candidateRideId = makeId("RIDE");

    const { data: rpcRows, error: rpcError } =

      await supabase.rpc("create_htaf_ride_atomic", {

        p_application_id: applicationId,
        p_ride_id: candidateRideId,
        p_rider_name: `${application.first_name} ${application.last_name}`,
        p_rider_phone: application.phone,
        p_pickup_address: cleanString(req.body.pickup || application.pickup_city, 500),
        p_dropoff_address: cleanString(req.body.destination || application.destination, 500),
        p_ride_type: "foundation",
        p_scheduled_time: req.body.scheduled_for || application.ride_date || null,
        p_status: RIDE_STATUS.PAYMENT_AUTHORIZED,
        p_dispatch_status: "foundation_authorized",
        p_estimated_fare: estimate.total,
        p_driver_payout: estimate.driver_payout,
        p_estimated_platform_fee: estimate.platform_fee,
        p_pricing_snapshot: estimate,
        p_estimated_distance_miles: estimate.miles,
        p_estimated_duration_minutes: estimate.minutes,
        p_miles_estimate: estimate.miles,
        p_minutes_estimate: estimate.minutes,
        p_notes: `HTAF application ${application.application_code}`

      });

    if (rpcError) {

      throw rpcError;

    }

    const rpcResult = Array.isArray(rpcRows) ? rpcRows[0] : rpcRows;
    const outcome = resolveCreateRideOutcome(rpcResult);

    auditLog({

      actor_type:

        "admin",

      actor_id:

        req.admin.email,

      action:

        outcome.created ? "htaf_application_converted_to_ride" : "htaf_application_create_ride_" + (rpcResult && rpcResult.outcome ? rpcResult.outcome : "failed"),

      entity_type:

        "htaf_application",

      entity_id:

        applicationId,

      metadata: {

        ride_id:

          outcome.ride ? outcome.ride.id : null,

        outcome:

          rpcResult && rpcResult.outcome,

        reason:

          outcome.reason || null,

        approval:

          HTAF_ACTIVATION.rideCreation.approvals

      },

      req

    }).catch(() => {});

    if (outcome.error) {

      return fail(

        res,

        outcome.error,

        outcome.statusCode,

        outcome.reason ? { reason: outcome.reason } : {}

      );

    }

    if (outcome.created) {

      // The full outcome.ride row (from the create_htaf_ride RPC) carries
      // rider_name/rider_phone -- fine for the direct HTTP response below
      // to the one admin who just performed this action on this specific
      // application, but not for an unscoped broadcast to every connected
      // admin socket. The SSE event only needs enough to know a ride now
      // exists for this application; full detail is available through
      // GET /api/admin/rides's own allow-list.
      broadcastSse(

        "htaf_ride_created",

        {

          application_id:

            applicationId,

          ride:

            outcome.ride
              ? { id: outcome.ride.id, status: outcome.ride.status }
              : null

        }

      );

    }

    return ok(res, {

      ride:

        outcome.ride,

      application_id:

        applicationId,

      created:

        outcome.created

    }, outcome.statusCode);

  })

);

/* =========================================================

   PAUSE / RESUME DISPATCH

========================================================= */

app.post(

  "/api/admin/system/pause-dispatch",

  requireAdmin,

  asyncRoute(async (req, res) => {

    const reason =

      cleanString(

        req.body.reason,

        1000

      );

    await supabase

      .from("system_flags")

      .upsert({

        key:

          "dispatch_paused",

        value:

          "true",

        reason,

        updated_at:

          nowIso()

      });

    auditLog({

      actor_type:

        "admin",

      actor_id:

        req.admin.email,

      action:

        "dispatch_paused",

      metadata: {

        reason

      },

      req

    }).catch(() => {});

    broadcastSse(

      "dispatch_paused",

      {

        reason,

        at:

          nowIso()

      }

    );

    return ok(res, {

      dispatch_paused:

        true,

      reason

    });

  })

);

app.post(

  "/api/admin/system/resume-dispatch",

  requireAdmin,

  asyncRoute(async (req, res) => {

    await supabase

      .from("system_flags")

      .upsert({

        key:

          "dispatch_paused",

        value:

          "false",

        reason:

          null,

        updated_at:

          nowIso()

      });

    auditLog({

      actor_type:

        "admin",

      actor_id:

        req.admin.email,

      action:

        "dispatch_resumed",

      req

    }).catch(() => {});

    broadcastSse(

      "dispatch_resumed",

      {

        at:

          nowIso()

      }

    );

    return ok(res, {

      dispatch_paused:

        false

    });

  })

);

/* =========================================================

   RIDER HISTORY — ENABLE / DISABLE

   The GET /api/rider/rides, /api/rider/rides/:rideId, and
   /api/rider/deliveries routes (see RIDER-SCOPED HISTORY API
   above) are gated behind this flag, defaulted off, because
   riderId there is a client-supplied parameter with no rider
   authentication behind it yet (see that section's comments).
   Flip this on once that's an acceptable risk to carry, or once
   real rider authentication ships.

========================================================= */

app.post(
  "/api/admin/system/enable-rider-history",
  requireAdmin,
  asyncRoute(async (req, res) => {
    await supabase
      .from("system_flags")
      .upsert({
        key: "rider_history_enabled",
        value: "true",
        reason: cleanString(req.body.reason, 1000),
        updated_at: nowIso()
      });

    auditLog({
      actor_type: "admin",
      actor_id: req.admin.email,
      action: "rider_history_enabled",
      req
    }).catch(() => {});

    return ok(res, { rider_history_enabled: true });
  })
);

app.post(
  "/api/admin/system/disable-rider-history",
  requireAdmin,
  asyncRoute(async (req, res) => {
    await supabase
      .from("system_flags")
      .upsert({
        key: "rider_history_enabled",
        value: "false",
        reason: null,
        updated_at: nowIso()
      });

    auditLog({
      actor_type: "admin",
      actor_id: req.admin.email,
      action: "rider_history_disabled",
      req
    }).catch(() => {});

    return ok(res, { rider_history_enabled: false });
  })
);

/* =========================================================

   RIDER SIGN-IN UI — ENABLE / DISABLE

   Controls whether rider-dashboard.html shows the real OTP sign-in gate
   at all (P0 remediation PR 2a, docs/security-remediation/
   pr-02a-rider-client-auth.md), read via the public
   GET /api/rider/auth-ui-config route. Defaulted off so this can ship to
   production inert -- rider-dashboard.html falls back to its pre-PR-2a
   boot behavior untouched -- until an admin has confirmed real SMS/email
   OTP delivery works and deliberately flips this on. Separate from the
   future rider_auth_enforced flag (PR 2b), which controls server-side
   route enforcement, not this client-side gate.

========================================================= */

app.post(
  "/api/admin/system/enable-rider-auth-ui",
  requireAdmin,
  asyncRoute(async (req, res) => {
    logAdminRbacShadowCheck(
      req,
      "POST /api/admin/system/enable-rider-auth-ui",
      RBAC_SHADOW_ROUTE_CAPABILITIES["POST /api/admin/system/enable-rider-auth-ui"]
    ).catch(() => {});

    await supabase
      .from("system_flags")
      .upsert({
        key: "rider_auth_ui_enabled",
        value: "true",
        reason: cleanString(req.body.reason, 1000),
        updated_at: nowIso()
      });

    auditLog({
      actor_type: "admin",
      actor_id: req.admin.email,
      action: "rider_auth_ui_enabled",
      req
    }).catch(() => {});

    return ok(res, { rider_auth_ui_enabled: true });
  })
);

app.post(
  "/api/admin/system/disable-rider-auth-ui",
  requireAdmin,
  asyncRoute(async (req, res) => {
    await supabase
      .from("system_flags")
      .upsert({
        key: "rider_auth_ui_enabled",
        value: "false",
        reason: null,
        updated_at: nowIso()
      });

    auditLog({
      actor_type: "admin",
      actor_id: req.admin.email,
      action: "rider_auth_ui_disabled",
      req
    }).catch(() => {});

    return ok(res, { rider_auth_ui_enabled: false });
  })
);

/* =========================================================
   JUST-IN-TIME BOOKING — ENABLE / DISABLE
   Turning this on is a feature activation and needs the owner's
   explicit approval (CLAUDE.md standing rules). Off by default.
========================================================= */
app.post(
  "/api/admin/system/enable-jit-booking",
  requireAdmin,
  asyncRoute(async (req, res) => {
    await supabase
      .from("system_flags")
      .upsert({
        key: JIT_BOOKING_FLAG,
        value: "true",
        reason: cleanString(req.body.reason, 1000),
        updated_at: nowIso()
      });
    auditLog({
      actor_type: "admin",
      actor_id: req.admin.email,
      action: "jit_booking_enabled",
      req
    }).catch(() => {});
    return ok(res, { jit_booking_enabled: true });
  })
);

app.post(
  "/api/admin/system/disable-jit-booking",
  requireAdmin,
  asyncRoute(async (req, res) => {
    await supabase
      .from("system_flags")
      .upsert({
        key: JIT_BOOKING_FLAG,
        value: "false",
        reason: null,
        updated_at: nowIso()
      });
    auditLog({
      actor_type: "admin",
      actor_id: req.admin.email,
      action: "jit_booking_disabled",
      req
    }).catch(() => {});
    return ok(res, { jit_booking_enabled: false });
  })
);

/* =========================================================

   RIDER ROUTE AUTHORIZATION ENFORCEMENT — ENABLE / DISABLE

   P0 remediation PR 2b (docs/security-remediation/pr-02b-rider-route-enforcement.md).
   Controls whether requireRiderIfEnforced actually calls requireRider (on)
   or is a no-op passthrough (off, the default) for every route migrated
   in PR 2b -- readiness, rider-scoped ride/delivery history, saved
   places, and profile photo upload. Distinct from rider_auth_ui_enabled
   (PR 2a, client-side sign-in gate) and from rider_history_enabled
   (whether the history routes exist at all): this flag is specifically
   "once a request does carry req.rider, do these routes actually use it
   instead of the client-supplied riderId." Per your explicit instruction,
   do not enable this until the authenticated client flow (PR 2a) is
   confirmed live and validated.

========================================================= */

app.post(
  "/api/admin/system/enable-rider-auth-enforced",
  requireAdmin,
  asyncRoute(async (req, res) => {
    await supabase
      .from("system_flags")
      .upsert({
        key: "rider_auth_enforced",
        value: "true",
        reason: cleanString(req.body.reason, 1000),
        updated_at: nowIso()
      });

    auditLog({
      actor_type: "admin",
      actor_id: req.admin.email,
      action: "rider_auth_enforced_enabled",
      req
    }).catch(() => {});

    return ok(res, { rider_auth_enforced: true });
  })
);

app.post(
  "/api/admin/system/disable-rider-auth-enforced",
  requireAdmin,
  asyncRoute(async (req, res) => {
    await supabase
      .from("system_flags")
      .upsert({
        key: "rider_auth_enforced",
        value: "false",
        reason: null,
        updated_at: nowIso()
      });

    auditLog({
      actor_type: "admin",
      actor_id: req.admin.email,
      action: "rider_auth_enforced_disabled",
      req
    }).catch(() => {});

    return ok(res, { rider_auth_enforced: false });
  })
);

/* =========================================================

   ACCOUNT DELETION (App Store compliant)

   - Riders: immediate self-service delete (OTP-confirmed).

   - Drivers: request revokes access now; admin reviews,

     then anonymization is finalized.

   Operational records (rides, payments, earnings, audit,

   safety, HTAF) are RETAINED but stripped of personal data.

========================================================= */

/* Anonymize a rider or driver row in place. Removes personal

   identity data, revokes access, marks deleted. Keeps the row

   so financial/operational foreign keys remain intact. */

async function anonymizeAccount({

  table,

  id,

  reason = null,

  deletedBy = "self"

}) {

  const now = nowIso();

  const scrub = {

    first_name: "Deleted",

    last_name: "User",

    email: `deleted+${id}@harveytaxiservice.invalid`,

    phone: null,

    access_revoked: true,

    status: "deleted",

    deleted_at: now,

    deleted_reason: reason ? cleanString(reason, 500) : null,

    deleted_by: cleanString(deletedBy, 120),

    updated_at: now

  };

  // Drivers: also remove location, photo, addresses and license/plate
  // numbers, and take the driver offline. Clearing current_lat/lng also
  // clears geog (trigger drivers_sync_geog). Ride and earnings rows stay
  // for operational/financial records, without the name and phone.
  if (table === "drivers") {
    Object.assign(scrub, {
      online: false,
      current_lat: null,
      current_lng: null,
      latitude: null,
      longitude: null,
      heading: null,
      speed: null,
      location_accuracy_meters: null,
      last_location_at: null,
      photo_url: null,
      home_address: null,
      current_address: null,
      last_known_address: null,
      zipcode: null,
      license_plate: null,
      vehicle_plate: null,
      drivers_license_number: null,
      license_number: null
    });
  }

  const { error } =

    await supabase

      .from(table)

      .update(scrub)

      .eq("id", id);

  if (error) {

    throw error;

  }

  // Strip personal name/phone snapshots from ride records for

  // this user, keeping the operational/financial row intact.

  if (table === "riders") {

    await supabase

      .from("rides")

      .update({

        rider_name: "Deleted User",

        rider_phone: null,

        updated_at: now

      })

      .eq("rider_id", id);

  }

  // Same for drivers: rides keeps its own driver_name/driver_phone
  // snapshot, separate from the drivers row scrubbed above. Their app's
  // push tokens go too, so the device gets nothing more.
  if (table === "drivers") {
    await supabase.from("driver_push_tokens").delete().eq("driver_id", id);
    await supabase
      .from("rides")
      .update({
        driver_name: "Deleted Driver",
        driver_phone: null,
        updated_at: now
      })
      .eq("driver_id", id);
  }

  return true;

}

/* Designated App Review accounts: record the request and confirm it,
   but keep the account (see lib/accountDeletion.js). Auditable through
   both deletion_requests (status review_simulated, kept out of the
   admin pending queue) and audit_logs. Never sends SMS. */
async function recordReviewDeletionSimulation({ userType, userId, reason, verifiedBy, req }) {
  const requestId = makeId("DEL");
  const now = nowIso();
  const { error } =
    await supabase
      .from("deletion_requests")
      .insert({
        request_id: requestId,
        user_type: userType,
        user_id: userId,
        status: DELETION_STATUS.REVIEW_SIMULATED,
        reason,
        requested_at: now,
        completed_at: now,
        reviewed_by: "app_review_simulation"
      });
  if (error) {
    console.error("❌ Review deletion simulation insert failed:", error.message);
  }
  await auditLog({
    actor_type: userType,
    actor_id: userId,
    action: "account_deletion_review_simulated",
    entity_type: userType,
    entity_id: userId,
    metadata: { request_id: requestId, verified_by: verifiedBy, account_preserved: true },
    req
  }).catch(() => {});
  return requestId;
}

/* -------- RIDER: immediate self-service deletion --------
   Identity comes from one of two places, never from a client-supplied
   rider id:
     - a valid rider session (in-app, signed in), plus typing DELETE;
     - an SMS one-time code, with the account resolved from that
       verified phone number (no session needed). */
app.post(
  "/api/account/rider/delete",
  rateLimit({ windowMs: 10 * 60_000, max: 10, keyPrefix: "account_rider_delete_ip" }),
  asyncRoute(async (req, res) => {
    const reason =
      cleanString(req.body.reason, 500);
    const sessionRider =
      await resolveVerifiedRiderSession(req);
    let rider = null;
    let verifiedBy = null;
    if (sessionRider) {
      if (!isDeletionConfirmed(req.body.confirm)) {
        return fail(res, "Type DELETE to confirm account deletion.", 400);
      }
      rider = sessionRider;
      verifiedBy = "rider_session";
    } else {
      const phone =
        cleanPhone(req.body.phone);
      const code =
        cleanString(req.body.code, 20);
      if (!phone || !code) {
        return fail(
          res,
          "Sign in, or enter your account phone number and verification code, to delete your account.",
          400
        );
      }
      const verification =
        await verifyCode({
          channel: "sms",
          destination: phone,
          code,
          purpose: "account_deletion"
        });
      if (!verification.ok) {
        return fail(
          res,
          verification.reason || "Verification failed.",
          400
        );
      }
      // Match on the number's last 10 digits, the way phone sign-in does
      // (riderPhoneLast10): a rider may type "+1 615 ..." for an account
      // stored as "6155550199" (Just-in-Time sign-up) or the reverse.
      // Deleted accounts have no phone, so they never match.
      const last10 = riderPhoneLast10(phone);
      if (!last10) {
        return fail(res, "No account was found for that phone number.", 404);
      }
      const { data: candidates, error } =
        await supabase
          .from("riders")
          .select("id, phone, is_review_account")
          .ilike("phone", `%${last10}`)
          .limit(10);
      const rows = (candidates || []).filter((row) => riderPhoneLast10(row.phone) === last10);
      if (error) {
        throw error;
      }
      const match = resolveAccountByVerifiedPhone(rows);
      if (!match.ok) {
        return fail(res, match.message, match.statusCode);
      }
      rider = match.row;
      verifiedBy = "sms_code";
    }
    const riderId = rider.id;
    const plan = planAccountDeletion({ row: rider, userType: "rider" });
    if (plan.mode === DELETION_MODE.REVIEW_SIMULATED) {
      const requestId = await recordReviewDeletionSimulation({
        userType: "rider",
        userId: riderId,
        reason,
        verifiedBy,
        req
      });
      return ok(res, {
        deleted: false,
        simulated: true,
        request_id: requestId,
        status: DELETION_STATUS.REVIEW_SIMULATED,
        message: REVIEW_DELETION_MESSAGE
      });
    }
    try {
      await anonymizeAccount({
        table: "riders",
        id: riderId,
        reason,
        deletedBy: "rider_self"
      });
    } catch (delErr) {
      console.error("❌ Rider deletion failed:", delErr.message);
      return fail(res, "Account deletion could not be completed.", 500);
    }
    // Record the completed deletion for the audit trail. The account is
    // already anonymized at this point, so a failed insert is logged
    // rather than reported to the rider as a failed deletion.
    const requestId = makeId("DEL");
    const { error: recordError } =
      await supabase
        .from("deletion_requests")
        .insert({
          request_id: requestId,
          user_type: "rider",
          user_id: riderId,
          status: DELETION_STATUS.COMPLETED,
          reason,
          requested_at: nowIso(),
          completed_at: nowIso(),
          reviewed_by: "self_service"
        });
    if (recordError) {
      console.error("❌ Rider deletion record insert failed:", recordError.message);
    }
    auditLog({
      actor_type: "rider",
      actor_id: riderId,
      action: "account_deleted",
      entity_type: "rider",
      entity_id: riderId,
      metadata: { self_service: true, verified_by: verifiedBy, request_id: requestId },
      req
    }).catch(() => {});
    if (sessionRider) {
      clearRiderSessionCookie(res);
    }
    return ok(res, {
      deleted: true,
      request_id: requestId,
      message: "Your account has been deleted and your personal information removed."
    });
  })
);

/* -------- DRIVER: request deletion (revokes access now) --------
   The driver's own session only (no admin override). The request is
   recorded before access is revoked, so a failure never leaves a
   driver locked out with no request on file. */
app.post(
  "/api/account/driver/delete-request",
  requireDriverSelf,
  asyncRoute(async (req, res) => {
    const driverId = req.driver.id;
    const reason =
      cleanString(req.body.reason, 500);
    const plan = planAccountDeletion({ row: req.driver, userType: "driver" });
    if (plan.mode === DELETION_MODE.REVIEW_SIMULATED) {
      const requestId = await recordReviewDeletionSimulation({
        userType: "driver",
        userId: driverId,
        reason,
        verifiedBy: "driver_session",
        req
      });
      return ok(res, {
        request_id: requestId,
        simulated: true,
        status: DELETION_STATUS.REVIEW_SIMULATED,
        message: REVIEW_DELETION_MESSAGE
      });
    }
    const requestId = makeId("DEL");
    const { error } =
      await supabase
        .from("deletion_requests")
        .insert({
          request_id: requestId,
          user_type: "driver",
          user_id: driverId,
          status: DELETION_STATUS.PENDING,
          reason,
          requested_at: nowIso()
        });
    if (error) {
      throw error;
    }
    // Immediately revoke login access (anonymization waits for review).
    const { error: revokeError } =
      await supabase
        .from("drivers")
        .update({
          access_revoked: true,
          status: "deletion_pending",
          updated_at: nowIso()
        })
        .eq("id", driverId);
    if (revokeError) {
      throw revokeError;
    }
    auditLog({
      actor_type: "driver",
      actor_id: driverId,
      action: "account_deletion_requested",
      entity_type: "driver",
      entity_id: driverId,
      metadata: { request_id: requestId },
      req
    }).catch(() => {});
    return ok(res, {
      request_id: requestId,
      status: DELETION_STATUS.PENDING,
      message: "Your deletion request was received and your account access has been disabled. An administrator will finalize the deletion after review."
    });
  })
);

/* -------- ADMIN: list deletion requests -------- */

app.get(

  "/api/admin/deletion-requests",

  requireAdmin,

  asyncRoute(async (req, res) => {

    const status =

      cleanString(req.query.status, 40) || "pending";

    const limit =

      getPageLimit(req, 100, 300);

    const cursor =

      decodeCursor(req.query.cursor);

    let query =

      supabase

        .from("deletion_requests")

        .select("*")

        .eq("status", status)

        .order("requested_at", { ascending: false })

        .order("request_id", { ascending: false })

        .limit(limit);

    if (cursor) {

      query = query.or(

        `requested_at.lt.${cursor.created_at},` +

        `and(requested_at.eq.${cursor.created_at},request_id.lt.${cursor.id})`

      );

    }

    const { data, error } = await query;

    if (error) throw error;

    const rows = data || [];

    const last = rows[rows.length - 1];

    const next_cursor =

      rows.length === limit && last

        ? encodeCursor({ created_at: last.requested_at, id: last.request_id })

        : null;

    return ok(res, {

      requests: rows,

      page: { limit, count: rows.length, next_cursor }

    });

  })

);

/* -------- ADMIN: approve (finalize) driver deletion -------- */

app.post(

  "/api/admin/deletion-requests/:id/approve",

  requireAdmin,

  asyncRoute(async (req, res) => {

    const requestId =

      cleanString(req.params.id, 100);

    const notes =

      cleanString(req.body.admin_notes, 1000);

    const { data: request, error } =

      await supabase

        .from("deletion_requests")

        .select("*")

        .eq("request_id", requestId)

        .maybeSingle();

    if (error || !request) {

      return fail(res, "Deletion request not found.", 404);

    }

    if (request.status !== "pending") {

      return fail(res, `Request is already ${request.status}.`, 409);

    }

    const table =

      request.user_type === "driver" ? "drivers" : "riders";

    try {

      await anonymizeAccount({

        table,

        id: request.user_id,

        reason: request.reason,

        deletedBy: `admin:${req.admin.email}`

      });

    } catch (delErr) {

      console.error("❌ Deletion finalize failed:", delErr.message);

      return fail(res, "Anonymization could not be completed.", 500);

    }

    await supabase

      .from("deletion_requests")

      .update({

        status: "completed",

        approved_at: nowIso(),

        completed_at: nowIso(),

        reviewed_by: req.admin.email,

        admin_notes: notes

      })

      .eq("request_id", requestId);

    auditLog({

      actor_type: "admin",

      actor_id: req.admin.email,

      action: "account_deletion_completed",

      entity_type: request.user_type,

      entity_id: request.user_id,

      metadata: { request_id: requestId },

      req

    }).catch(() => {});

    return ok(res, {

      request_id: requestId,

      status: "completed",

      message: "Account anonymized and deletion finalized."

    });

  })

);

/* -------- ADMIN: reject deletion (restores access) -------- */

app.post(

  "/api/admin/deletion-requests/:id/reject",

  requireAdmin,

  asyncRoute(async (req, res) => {

    const requestId =

      cleanString(req.params.id, 100);

    const notes =

      cleanString(req.body.admin_notes, 1000);

    const { data: request, error } =

      await supabase

        .from("deletion_requests")

        .select("*")

        .eq("request_id", requestId)

        .maybeSingle();

    if (error || !request) {

      return fail(res, "Deletion request not found.", 404);

    }

    if (request.status !== "pending") {

      return fail(res, `Request is already ${request.status}.`, 409);

    }

    // Deletion is NOT happening, so restore the account's access.

    const table =

      request.user_type === "driver" ? "drivers" : "riders";

    await supabase

      .from(table)

      .update({

        access_revoked: false,

        status: "active",

        updated_at: nowIso()

      })

      .eq("id", request.user_id);

    await supabase

      .from("deletion_requests")

      .update({

        status: "rejected",

        rejected_at: nowIso(),

        reviewed_by: req.admin.email,

        admin_notes: notes

      })

      .eq("request_id", requestId);

    auditLog({

      actor_type: "admin",

      actor_id: req.admin.email,

      action: "account_deletion_rejected",

      entity_type: request.user_type,

      entity_id: request.user_id,

      metadata: { request_id: requestId },

      req

    }).catch(() => {});

    return ok(res, {

      request_id: requestId,

      status: "rejected",

      message: "Deletion request rejected and account access restored."

    });

  })

);

/* =========================================================

   PART 9 — SAFETY, COMPLIANCE, TWILIO VERIFY, STRIPE

========================================================= */

/* =========================================================

   DRIVER COMPLIANCE

========================================================= */

async function getDriverCompliance(driverId) {

  const { data, error } =

    await supabase

      .from("drivers")

      .select(

        "id, email_verified, phone_verified, checkr_status, persona_status, persona_verified, insurance_status, license_status, approval_status"

      )

      .eq("id", driverId)

      .maybeSingle();

  if (error || !data) {

    return {

      eligible: false,

      reason: "Driver not found.",

      details: null

    };

  }

  const checks = {

    email_verified:

      Boolean(data.email_verified),

    phone_verified:

      Boolean(data.phone_verified),

    persona_ready:

      !ENABLE_PERSONA ||

      Boolean(data.persona_verified) ||

      ["verified", "approved", "completed"].includes(

        String(data.persona_status || "").toLowerCase()

      ),

    checkr_ready:

      !ENABLE_CHECKR ||

      ["clear", "complete", "completed", "eligible_for_review"].includes(

        String(data.checkr_status || "").toLowerCase()

      ),

    insurance_ready:

      !data.insurance_status ||

      ["approved", "verified", "active"].includes(

        String(data.insurance_status || "").toLowerCase()

      ),

    license_ready:

      !data.license_status ||

      ["approved", "verified", "active"].includes(

        String(data.license_status || "").toLowerCase()

      ),

    approval_ready:

      ["approved"].includes(

        String(data.approval_status || "").toLowerCase()

      )

  };

  const eligible =

    Object.values(checks).every(Boolean);

  return {

    eligible,

    checks,

    details: data

  };

}

app.get(

  "/api/admin/compliance/audit",

  requireAdmin,

  asyncRoute(async (req, res) => {

    const { data, error } =

      await supabase

        .from("drivers")

        .select(

          "id, first_name, last_name, email, email_verified, phone_verified, checkr_status, persona_status, persona_verified, insurance_status, license_status, approval_status, status, created_at"

        )

        .order("created_at", {

          ascending: false

        });

    if (error) {

      throw error;

    }

    const compliance =

      (data || []).map((driver) => {

        const checks = {

          email_verified:

            Boolean(driver.email_verified),

          phone_verified:

            Boolean(driver.phone_verified),

          persona_ready:

            !ENABLE_PERSONA ||

            Boolean(driver.persona_verified) ||

            ["verified", "approved", "completed"].includes(

              String(driver.persona_status || "").toLowerCase()

            ),

          checkr_ready:

            !ENABLE_CHECKR ||

            ["clear", "complete", "completed", "eligible_for_review"].includes(

              String(driver.checkr_status || "").toLowerCase()

            ),

          approval_ready:

            driver.approval_status === "approved"

        };

        return {

          ...driver,

          compliance_ready:

            Object.values(checks).every(Boolean),

          checks

        };

      });

    return ok(res, {

      compliance

    });

  })

);

/* =========================================================

   SAFETY 911 ALERT

========================================================= */

// Emergency alerts. Anyone may raise one -- emergency access is never
// gated -- but an alert is linked to a ride (and so to its rider and
// driver) only when the caller is proven to be on that ride: the ride's
// rider (session or tracking token), its assigned driver (driver session),
// or an admin -- the same check as ride tracking (resolveRideViewer). A
// ride id alone is a claim, not authorization: an unproven alert is still
// recorded and broadcast to admins, without ride details, and marked
// unverified. Ids in the body (rider_id) are never trusted.
//
// emergency_alerts columns (live schema): id, ride_id, rider_id,
// driver_id, alert_type, message, status, created_at, updated_at. There
// are no location columns, so a reported position goes in the message and
// the audit log.
const safetyAlertRateLimit = rateLimit({
  windowMs: 10 * 60_000,
  max: 20,
  keyPrefix: "safety_911",
  message: "Too many alerts from this device. If this is an emergency, call 911 now."
});

function finiteOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

async function resolveAlertDriver(req) {
  const token = req.headers["x-driver-token"];
  if (!token) return null;
  const session = verifyDriverSession(token);
  if (!session) return null;
  const { data } = await supabase.from("drivers").select("id, access_revoked").eq("id", session.driver_id).maybeSingle();
  return data && data.access_revoked !== true ? data : null;
}

app.post(
  "/api/safety/911",
  safetyAlertRateLimit,
  asyncRoute(async (req, res) => {
    const claimedRideId = cleanString(req.body.ride_id, 100) || null;
    const latitude = finiteOrNull(req.body.latitude);
    const longitude = finiteOrNull(req.body.longitude);
    const text = cleanString(req.body.message, 1000) || "";

    const isAdmin = isAdminRequest(req);
    const [rider, driver] = isAdmin ? [null, null] : await Promise.all([resolveVerifiedRiderSession(req), resolveAlertDriver(req)]);

    let ride = null;
    let viewer = null;
    if (claimedRideId) {
      const { data } = await supabase.from("rides").select("id, rider_id, driver_id").eq("id", claimedRideId).maybeSingle();
      ride = data || null;
      viewer = ride ? await resolveRideViewer(req, ride) : null;
    }
    const linked = Boolean(ride && viewer);
    const reporter = linked ? viewer : isAdmin ? "admin" : rider ? "rider" : driver ? "driver" : "anonymous";
    const location = latitude !== null && longitude !== null ? `${latitude.toFixed(6)},${longitude.toFixed(6)}` : null;

    const emergency = {
      id: makeId("SOS"),
      ride_id: linked ? ride.id : null,
      rider_id: linked ? ride.rider_id || null : rider ? String(rider.id) : null,
      driver_id: linked ? ride.driver_id || null : driver ? String(driver.id) : null,
      alert_type: linked ? `sos_${reporter}` : reporter === "anonymous" ? "sos_unverified" : `sos_${reporter}_no_ride`,
      message: [text, location ? `Reported location: ${location}` : "", claimedRideId && !linked ? "Ride not verified for this reporter." : ""]
        .filter(Boolean)
        .join("\n")
        .slice(0, 1200) || null,
      status: "open",
      created_at: nowIso(),
      updated_at: nowIso()
    };

    const { data, error } = await supabase.from("emergency_alerts").insert(emergency).select().single();
    if (error) {
      console.error("❌ Emergency alert insert failed:", error.message);
      return fail(res, "Emergency alert could not be recorded. If this is an emergency, call 911 now.", 500);
    }

    broadcastSse("emergency_alert", { ...data, verified: linked });
    auditLog({
      actor_type: reporter,
      actor_id: linked ? (reporter === "driver" ? emergency.driver_id : reporter === "rider" ? emergency.rider_id : "admin") : emergency.rider_id || emergency.driver_id || null,
      action: "911_alert",
      entity_type: "emergency_alert",
      entity_id: data.id,
      metadata: {
        alert_type: emergency.alert_type,
        verified: linked,
        ride_id: emergency.ride_id,
        claimed_ride_id: claimedRideId && !linked ? claimedRideId : null,
        location
      },
      req
    }).catch(() => {});

    return ok(res, {
      emergency_id: data.id,
      dispatched: true,
      linked_to_ride: linked,
      message: linked
        ? "Emergency alert recorded. If this is an immediate emergency, call 911 directly."
        : "Emergency alert recorded. If this is an immediate emergency, call 911 directly. We couldn't confirm you're on that ride, so trip details weren't attached."
    });
  })
);

/* =========================================================

   SAFETY REPORT

========================================================= */

app.post(

  "/api/safety/report",

  asyncRoute(async (req, res) => {

    const missing =

      requireBody(req, [

        "category",

        "description"

      ]);

    if (missing.length) {

      return fail(

        res,

        "Missing safety report fields.",

        400,

        { missing }

      );

    }

    const report = {

      id:

        makeId("SAFE"),

      ride_id:

        cleanString(req.body.ride_id, 100) || null,

      submitted_by:

        cleanString(req.body.user_id, 100) || null,

      submitted_by_type:

        cleanString(req.body.user_type, 40) || null,

      category:

        cleanString(req.body.category, 100),

      description:

        cleanString(req.body.description, 5000),

      status:

        "open",

      created_at:

        nowIso(),

      updated_at:

        nowIso()

    };

    const { data, error } =

      await supabase

        .from("safety_reports")

        .insert(report)

        .select()

        .single();

    if (error) {

      throw error;

    }

    broadcastSse(

      "safety_report",

      data

    );

    auditLog({

      action:

        "safety_report_created",

      entity_type:

        "safety_report",

      entity_id:

        data.id,

      metadata: {

        category:

          data.category

      },

      req

    }).catch(() => {});

    return ok(

      res,

      { report: data },

      201

    );

  })

);

/* =========================================================

   TWILIO VERIFY SEND CODE

========================================================= */

app.post(

  "/api/auth/send-sms-code",

  asyncRoute(async (req, res) => {

    const phone =

      cleanPhone(req.body.phone);

    if (!phone) {

      return fail(

        res,

        "Phone required.",

        400

      );

    }

    if (!twilioClient) {

      return fail(

        res,

        "SMS verification is not configured.",

        503

      );

    }

    if (!TWILIO_VERIFY_SERVICE_SID) {

      console.error(

        "❌ TWILIO_VERIFY_SERVICE_SID is not set."

      );

      return fail(

        res,

        "SMS verification service is not configured.",

        503

      );

    }

    const verification =

      await twilioClient.verify

        .services(TWILIO_VERIFY_SERVICE_SID)

        .verifications

        .create({

          to: phone,

          channel: "sms"

        });

    auditLog({

      action:

        "sms_verify_code_sent",

      metadata: {

        phone

      },

      req

    }).catch(() => {});

    return ok(res, {

      sid:

        verification.sid,

      status:

        verification.status

    });

  })

);

/* =========================================================

   TWILIO VERIFY CONFIRM CODE

========================================================= */

app.post(

  "/api/auth/verify-sms-code",

  asyncRoute(async (req, res) => {

    const phone =

      cleanPhone(req.body.phone);

    const code =

      cleanString(req.body.code, 20);

    if (!phone || !code) {

      return fail(

        res,

        "Phone and code required.",

        400

      );

    }

    if (!twilioClient) {

      return fail(

        res,

        "SMS verification is not configured.",

        503

      );

    }

    if (!TWILIO_VERIFY_SERVICE_SID) {

      return fail(

        res,

        "SMS verification service is not configured.",

        503

      );

    }

    const check =

      await twilioClient.verify

        .services(TWILIO_VERIFY_SERVICE_SID)

        .verificationChecks

        .create({

          to: phone,

          code

        });

    const approved =

      check.status === "approved";

    if (approved) {

      await Promise.allSettled([

        // riders has no phone_verified column -- see
        // lib/riderVerification.js and the SMS-confirm route above for
        // the same fix.
        supabase

          .from("riders")

          .update({

            sms_verified:

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

    }

    auditLog({

      action:

        "sms_verify_code_checked",

      metadata: {

        phone,

        approved

      },

      req

    }).catch(() => {});

    return ok(res, {

      approved,

      status:

        check.status

    });

  })

);

/* =========================================================
   TIPS DURING OR AFTER A TRIP, AND RIDER RATINGS OF DRIVERS
   (owner decisions 2026-10-22; lib/rideTips.js, lib/driverRatings.js)
   Tips: a separate card charge, 100% to the driver, recorded as paid only
   after the server confirms the PaymentIntent with Stripe. Stripe test key
   (the orders test key) unless ride_tips_live is "true". App Review rides
   are simulated. Ratings: one per completed ride; a low score is flagged
   for staff and never acts on a driver by itself. Both are off unless
   their flags are "true".
========================================================= */
const rideTips = require("./lib/rideTips");
const driverRatings = require("./lib/driverRatings");

const TIP_RIDE_FIELDS = "id, rider_id, driver_id, status, is_review_ride, tip_amount, completed_at, updated_at";
const tipsTableMissing = (error) => Boolean(error && (error.code === "42P01" || error.code === "PGRST205"));

async function tipsConfig() {
  const enabled = (await getSystemFlag(rideTips.TIPS_FLAG, "false")) === "true";
  const liveEnabled = (await getSystemFlag(rideTips.TIPS_LIVE_FLAG, "false")) === "true";
  return { enabled, liveEnabled };
}

// The Stripe client and publishable key for a tip's mode; null if that
// mode isn't configured (live needs the live keys, test needs test keys).
function tipStripe(mode) {
  if (mode === "live") return stripe && /^(sk|rk)_live_/.test(STRIPE_SECRET_KEY) && /^pk_live_/.test(STRIPE_PUBLISHABLE_KEY) ? { client: stripe, publishableKey: STRIPE_PUBLISHABLE_KEY } : null;
  if (mode === "test") return ordersStripe && /^pk_test_/.test(ORDERS_STRIPE_PUBLISHABLE_KEY) ? { client: ordersStripe, publishableKey: ORDERS_STRIPE_PUBLISHABLE_KEY } : null;
  return null;
}

async function loadTipRide(rideId) {
  const { data, error } = await supabase.from("rides").select(TIP_RIDE_FIELDS).eq("id", cleanString(rideId, 100)).maybeSingle();
  if (error) throw error;
  return data || null;
}

async function paidTipsForRide(rideId) {
  const { data, error } = await supabase.from("ride_tips").select("id, status, amount_cents").eq("ride_id", rideId).in("status", ["succeeded", "simulated"]);
  if (tipsTableMissing(error)) return [];
  if (error) throw error;
  return data || [];
}

// Keeps the driver's earning row in step with paid tips (100% to the
// driver; the fare earning and any fleet share are unchanged). No row yet
// (trip still in progress) means the completion write picks the tips up.
async function applyTipsToEarning(rideId) {
  const ride = await loadTipRide(rideId);
  if (!ride) return null;
  const tip = rideTips.totalTipDollars(ride, await paidTipsForRide(rideId));
  const { data: earning, error } = await supabase.from("driver_earnings").select("id, driver_base_earning").eq("ride_id", rideId).maybeSingle();
  if (error) throw error;
  if (!earning) return null;
  const total = Math.round((Number(earning.driver_base_earning || 0) + tip) * 100) / 100;
  const { error: uErr } = await supabase.from("driver_earnings").update({ tip_amount: tip, total_earning: total, payout_amount: total, updated_at: nowIso() }).eq("id", earning.id);
  if (uErr) throw uErr;
  return { tip_amount: tip, total_earning: total };
}

// Marks a pending tip paid once Stripe shows a matching, succeeded intent.
async function finalizeTip(tip, intent) {
  if (!rideTips.intentMatchesTip(intent, tip)) return { ok: false };
  const { data: updated, error } = await supabase.from("ride_tips").update({ status: "succeeded", succeeded_at: nowIso() }).eq("id", tip.id).eq("status", "pending").select("id");
  if (error) throw error;
  if (updated && updated.length) {
    await applyTipsToEarning(tip.ride_id).catch((err) => console.error("❌ Tip earning update failed:", tip.ride_id, logErrorCode(err)));
    auditLog({ actor_type: "rider", actor_id: tip.rider_id, action: "ride_tip_paid", entity_type: "ride", entity_id: tip.ride_id, metadata: { tip_id: tip.id, amount_cents: tip.amount_cents, mode: tip.mode } }).catch(() => {});
    sendPushNotification({ ownerType: "driver", ownerId: tip.driver_id, title: "You got a tip", body: `A rider tipped you $${(tip.amount_cents / 100).toFixed(2)}. Tips are 100% yours.`, url: "/driver.html" }).catch(() => {});
  }
  return { ok: true };
}

const riderFirstNameOf = (driver) => (driver && (driver.first_name || String(driver.full_name || driver.name || "").split(" ")[0])) || "your driver";

// What the tip and rating page needs for one ride.
app.get(
  "/api/rides/:id/tip-rating",
  requireRider,
  asyncRoute(async (req, res) => {
    const ride = await loadTipRide(req.params.id);
    if (!ride || String(ride.rider_id) !== String(req.rider.id)) return fail(res, "Ride not found.", 404);
    const { enabled: tipsOn, liveEnabled } = await tipsConfig();
    const ratingsOn = (await getSystemFlag(driverRatings.RATINGS_FLAG, "false")) === "true";
    const { data: driver } = ride.driver_id ? await supabase.from("drivers").select("id, first_name, full_name, name").eq("id", ride.driver_id).maybeSingle() : { data: null };
    const paid = await paidTipsForRide(ride.id);
    const mode = rideTips.tipMode(ride, { liveEnabled });
    const tipGate = rideTips.tipEligibility(ride, req.rider.id);
    let existingRating = null;
    if (ratingsOn) {
      const { data: rated, error: rErr } = await supabase.from("driver_ratings").select("stars, tags").eq("ride_id", ride.id).maybeSingle();
      if (rErr && !tipsTableMissing(rErr)) throw rErr;
      existingRating = rated || null;
    }
    const rateGate = driverRatings.ratingEligibility(ride, req.rider.id);
    const stripeCfg = mode === "simulated" ? null : tipStripe(mode);
    return ok(res, {
      ride: { id: ride.id, status: ride.status, driver_first_name: riderFirstNameOf(driver), simulated: Boolean(ride.is_review_ride) },
      tips: {
        enabled: tipsOn,
        can_tip: tipsOn && tipGate.ok && !paid.length && (mode === "simulated" || Boolean(stripeCfg)),
        reason: !tipsOn ? "Tipping isn't available yet." : paid.length ? "You've tipped on this trip. Thank you!" : !tipGate.ok ? tipGate.error : mode !== "simulated" && !stripeCfg ? "Tipping isn't available right now." : null,
        paid_cents: paid.reduce((s, t) => s + Number(t.amount_cents || 0), 0),
        presets_cents: rideTips.PRESET_TIPS_CENTS,
        mode,
        publishable_key: stripeCfg ? stripeCfg.publishableKey : null
      },
      rating: {
        enabled: ratingsOn,
        can_rate: ratingsOn && rateGate.ok && !existingRating,
        reason: !ratingsOn ? "Ratings aren't available yet." : existingRating ? "Thanks for rating your driver." : !rateGate.ok ? rateGate.error : null,
        existing: existingRating,
        tags: driverRatings.TAGS
      }
    });
  })
);

app.post(
  "/api/rides/:id/tips",
  requireRider,
  rateLimit({ windowMs: 10 * 60_000, max: 20, keyPrefix: "ride_tips", keyFn: (req) => `r:${req.rider && req.rider.id}` }),
  asyncRoute(async (req, res) => {
    const { enabled, liveEnabled } = await tipsConfig();
    if (!enabled) return fail(res, "Tipping isn't available yet.", 403);
    const amount = rideTips.validateTipAmount(req.body && req.body.amount);
    if (!amount.ok) return fail(res, amount.error, amount.statusCode);
    const ride = await loadTipRide(req.params.id);
    const gate = rideTips.tipEligibility(ride, req.rider.id);
    if (!gate.ok) return fail(res, gate.error, gate.statusCode);
    if ((await paidTipsForRide(ride.id)).length) return fail(res, "You've already tipped on this trip.", 409);
    const mode = rideTips.tipMode(ride, { liveEnabled });
    const tipId = crypto.randomUUID();
    const base = { id: tipId, ride_id: ride.id, rider_id: String(req.rider.id), driver_id: String(ride.driver_id), amount_cents: amount.amount_cents, currency: "usd", mode };

    if (mode === "simulated") {
      const { error } = await supabase.from("ride_tips").insert({ ...base, status: "simulated", succeeded_at: nowIso() });
      if (error) return fail(res, error.code === "23505" ? "You've already tipped on this trip." : "Your tip couldn't be saved.", error.code === "23505" ? 409 : 502);
      await applyTipsToEarning(ride.id).catch(() => {});
      auditLog({ actor_type: "rider", actor_id: req.rider.id, action: "ride_tip_simulated", entity_type: "ride", entity_id: ride.id, metadata: { tip_id: tipId, amount_cents: amount.amount_cents }, req }).catch(() => {});
      return ok(res, { tip: { id: tipId, status: "simulated", amount_cents: amount.amount_cents }, simulated: true }, 201);
    }

    const cfg = tipStripe(mode);
    if (!cfg) return fail(res, "Tipping isn't available right now.", 503);
    // An earlier unfinished tip on this ride is withdrawn first.
    const { data: pending } = await supabase.from("ride_tips").select("id, payment_intent_id, mode").eq("ride_id", ride.id).eq("status", "pending");
    for (const old of pending || []) {
      const oldCfg = tipStripe(old.mode);
      if (oldCfg && old.payment_intent_id) await oldCfg.client.paymentIntents.cancel(old.payment_intent_id).catch(() => {});
      await supabase.from("ride_tips").update({ status: "cancelled" }).eq("id", old.id).eq("status", "pending");
    }
    let intent;
    try {
      intent = await cfg.client.paymentIntents.create(
        {
          amount: amount.amount_cents,
          currency: "usd",
          automatic_payment_methods: { enabled: true },
          description: "Harvey Taxi driver tip",
          metadata: { kind: "ride_tip", tip_id: tipId, ride_id: ride.id, driver_id: String(ride.driver_id) }
        },
        { idempotencyKey: `harvey-ride-tip-${tipId}` }
      );
    } catch (err) {
      console.error("❌ Tip payment intent failed:", logErrorCode(err));
      return fail(res, "Your tip couldn't be started. Nothing has been charged.", 502);
    }
    const { error } = await supabase.from("ride_tips").insert({ ...base, status: "pending", payment_intent_id: intent.id });
    if (error) {
      await cfg.client.paymentIntents.cancel(intent.id).catch(() => {});
      return fail(res, "Your tip couldn't be started. Nothing has been charged.", 502);
    }
    return ok(res, { tip: { id: tipId, status: "pending", amount_cents: amount.amount_cents }, client_secret: intent.client_secret, publishable_key: cfg.publishableKey, mode }, 201);
  })
);

app.post(
  "/api/rides/:id/tips/:tipId/confirm",
  requireRider,
  asyncRoute(async (req, res) => {
    const { data: tip, error } = await supabase.from("ride_tips").select("*").eq("id", cleanString(req.params.tipId, 64)).eq("ride_id", cleanString(req.params.id, 100)).maybeSingle();
    if (error) return fail(res, "Your tip couldn't be checked.", 502);
    if (!tip || String(tip.rider_id) !== String(req.rider.id)) return fail(res, "Tip not found.", 404);
    if (tip.status === "succeeded" || tip.status === "simulated") return ok(res, { tip: { id: tip.id, status: tip.status, amount_cents: tip.amount_cents } });
    if (tip.status !== "pending") return fail(res, "This tip was cancelled. Nothing was charged.", 409);
    const cfg = tipStripe(tip.mode);
    if (!cfg) return fail(res, "Tipping isn't available right now.", 503);
    let intent;
    try {
      intent = await cfg.client.paymentIntents.retrieve(tip.payment_intent_id);
    } catch (err) {
      return fail(res, "Your tip couldn't be checked. Please try again.", 502);
    }
    const result = await finalizeTip(tip, intent);
    if (!result.ok) return fail(res, "Your card hasn't completed the tip yet.", 409);
    return ok(res, { tip: { id: tip.id, status: "succeeded", amount_cents: tip.amount_cents } });
  })
);

app.post(
  "/api/rides/:id/rating",
  requireRider,
  rateLimit({ windowMs: 10 * 60_000, max: 20, keyPrefix: "driver_rating", keyFn: (req) => `r:${req.rider && req.rider.id}` }),
  asyncRoute(async (req, res) => {
    if ((await getSystemFlag(driverRatings.RATINGS_FLAG, "false")) !== "true") return fail(res, "Ratings aren't available yet.", 403);
    const parsed = driverRatings.validateRating(req.body);
    if (!parsed.ok) return fail(res, parsed.error, parsed.statusCode);
    const ride = await loadTipRide(req.params.id);
    const gate = driverRatings.ratingEligibility(ride, req.rider.id);
    if (!gate.ok) return fail(res, gate.error, gate.statusCode);
    const { error } = await supabase.from("driver_ratings").insert({
      id: crypto.randomUUID(),
      ride_id: ride.id,
      rider_id: String(req.rider.id),
      driver_id: String(ride.driver_id),
      stars: parsed.stars,
      tags: parsed.tags,
      comment: parsed.comment,
      counted: !ride.is_review_ride
    });
    if (error) return fail(res, error.code === "23505" ? "You've already rated this trip." : "Your rating couldn't be saved.", error.code === "23505" ? 409 : 502);
    // The audit row never carries the comment.
    auditLog({ actor_type: "rider", actor_id: req.rider.id, action: "driver_rated", entity_type: "ride", entity_id: ride.id, metadata: { stars: parsed.stars, tags: parsed.tags, counted: !ride.is_review_ride }, req }).catch(() => {});
    return ok(res, { rating: { stars: parsed.stars, tags: parsed.tags } }, 201);
  })
);

async function ratingsForDrivers(driverIds) {
  let query = supabase.from("driver_ratings").select("driver_id, ride_id, stars, tags, comment, counted, created_at").order("created_at", { ascending: false }).limit(5000);
  if (driverIds) query = query.in("driver_id", driverIds);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

// A driver's own score: no rider names, no comments.
app.get(
  "/api/driver/rating",
  requireDriverSelf,
  asyncRoute(async (req, res) => {
    if ((await getSystemFlag(driverRatings.RATINGS_FLAG, "false")) !== "true") return ok(res, { enabled: false });
    const rows = await ratingsForDrivers([String(req.driver.id)]);
    const score = driverRatings.driverScore(rows);
    return ok(res, {
      enabled: true,
      score: score.score,
      count: score.count,
      shown: score.shown,
      min_ratings: driverRatings.MIN_RATINGS_FOR_SCORE,
      tag_counts: score.tag_counts,
      tags: driverRatings.TAGS
    });
  })
);

// Staff: every driver's score, those below the review line first, with the
// recent low ratings to look at. Staff decide what, if anything, to do.
app.get(
  "/api/admin/driver-ratings",
  requireAdmin,
  asyncRoute(async (req, res) => {
    let rows;
    try {
      rows = await ratingsForDrivers(null);
    } catch (err) {
      if (tipsTableMissing(err)) return ok(res, { drivers: [], not_set_up: true });
      throw err;
    }
    const byDriver = new Map();
    for (const r of rows) {
      if (!byDriver.has(r.driver_id)) byDriver.set(r.driver_id, []);
      byDriver.get(r.driver_id).push(r);
    }
    const ids = [...byDriver.keys()];
    const { data: drivers } = ids.length ? await supabase.from("drivers").select("id, first_name, last_name, full_name, name").in("id", ids) : { data: [] };
    const names = new Map((drivers || []).map((d) => [String(d.id), consoleDriverName(d)]));
    const list = ids.map((id) => {
      const mine = byDriver.get(id);
      const score = driverRatings.driverScore(mine);
      return {
        driver_id: id,
        name: names.get(String(id)) || "Driver",
        ...score,
        recent_low: mine.filter((r) => r.counted && r.stars <= 3).slice(0, 5).map((r) => ({ ride_id: r.ride_id, stars: r.stars, tags: r.tags, comment: r.comment, at: r.created_at }))
      };
    });
    list.sort((a, b) => Number(b.needs_review) - Number(a.needs_review) || (a.score ?? 99) - (b.score ?? 99));
    return ok(res, {
      enabled: (await getSystemFlag(driverRatings.RATINGS_FLAG, "false")) === "true",
      review_threshold: driverRatings.REVIEW_THRESHOLD,
      min_ratings: driverRatings.MIN_RATINGS_FOR_SCORE,
      drivers: list,
      note: "A flag means staff should look. Nothing happens to a driver automatically."
    });
  })
);

/* =========================================================

   STRIPE WEBHOOK

========================================================= */

app.post(

  "/api/stripe/webhook",

  express.raw({

    type: "application/json",

    limit: RAW_WEBHOOK_LIMIT

  }),

  asyncRoute(async (req, res) => {

    if (

      !stripe ||

      !STRIPE_WEBHOOK_SECRET

    ) {

      return fail(

        res,

        "Stripe webhook not configured.",

        503

      );

    }

    const signature =

      req.headers["stripe-signature"];

    let event;

    try {

      event =

        stripe.webhooks.constructEvent(

          req.body,

          signature,

          STRIPE_WEBHOOK_SECRET

        );

    } catch (error) {

      console.error(

        "❌ Stripe signature failed:",

        error.message

      );

      return fail(

        res,

        "Invalid Stripe signature.",

        400

      );

    }

    const object =
      event.data?.object || {};
    // A live tip (lib/rideTips.js): recorded once Stripe confirms it. Test
    // and simulated tips never reach this account's webhook.
    if (event.type === "payment_intent.succeeded" && object.metadata && object.metadata.kind === "ride_tip" && object.id) {
      const { data: tip, error: tipError } = await supabase.from("ride_tips").select("*").eq("payment_intent_id", object.id).maybeSingle();
      if (tipError && !tipsTableMissing(tipError)) throw tipError;
      if (tip && tip.mode === "live" && tip.status === "pending") await finalizeTip(tip, object);
    }

    // Forward-only transitions (lib/stripeWebhookTransitions.js): duplicate,
    // late and out-of-order deliveries never move a ride backwards,
    // overwrite a cancellation or undo a capture.
    //
    // Concurrency: each write is a compare-and-swap -- the UPDATE only
    // matches if BOTH the ride status and the payment status are still the
    // values the decision was based on (Postgres re-checks the WHERE clause
    // on the locked row). If another webhook or request changed the ride in
    // between, nothing is written; the ride is re-read and the decision
    // made again (up to 3 times). If it still can't be applied, the request
    // fails with 500 so Stripe redelivers it later -- nothing is lost and
    // nothing is overwritten.
    if (object.id && String(event.type || "").startsWith("payment_intent.")) {
      const { data: rides, error: readError } = await supabase
        .from("rides")
        .select("id, status, payment_status")
        .eq("payment_id", object.id)
        .limit(5);
      if (readError) throw readError;
      for (const first of rides || []) {
        let ride = first;
        let settled = false;
        for (let attempt = 0; attempt < 3 && !settled; attempt += 1) {
          const { patch, review } = rideUpdateForStripeEvent(event.type, ride);
          if (review) {
            auditLog({
              action: "stripe_webhook_needs_review",
              entity_type: "ride",
              entity_id: ride.id,
              metadata: { event_type: event.type, event_id: event.id, reason: review, ride_status: ride.status, payment_status: ride.payment_status || null }
            }).catch(() => {});
          }
          if (!patch) {
            settled = true;
            break;
          }
          let update = supabase
            .from("rides")
            .update({ ...patch, updated_at: nowIso() })
            .eq("id", ride.id)
            .eq("status", ride.status);
          update = ride.payment_status == null ? update.is("payment_status", null) : update.eq("payment_status", ride.payment_status);
          const { data: changed, error: updateError } = await update.select("id");
          if (updateError) throw updateError;
          if (changed && changed.length) {
            settled = true;
            break;
          }
          // Lost the race: read the current state and decide again.
          const { data: fresh, error: freshError } = await supabase
            .from("rides")
            .select("id, status, payment_status")
            .eq("id", ride.id)
            .maybeSingle();
          if (freshError) throw freshError;
          if (!fresh) {
            settled = true;
            break;
          }
          ride = fresh;
        }
        if (!settled) {
          auditLog({
            action: "stripe_webhook_retry_requested",
            entity_type: "ride",
            entity_id: first.id,
            metadata: { event_type: event.type, event_id: event.id }
          }).catch(() => {});
          return fail(res, "Webhook not applied; please retry.", 500);
        }
      }
    }

    auditLog({

      action:

        "stripe_webhook_received",

      entity_type:

        "stripe",

      entity_id:

        object.id || event.id,

      metadata: {

        event_type:

          event.type

      }

    }).catch(() => {});

    broadcastSse(

      "stripe_event",

      {

        type:

          event.type,

        object_id:

          object.id,

        at:

          nowIso()

      }

    );

    return ok(res, {

      received:

        true

    });

  })

);/* =========================================================

   PART 10A — HEALTH, SYSTEM STATUS, AI SUPPORT, CONFIG CHECK

========================================================= */

/* =========================================================

   SYSTEM FLAGS

========================================================= */

async function getSystemFlag(key, fallback = "false") {

  try {

    const { data, error } =

      await supabase

        .from("system_flags")

        .select("*")

        .eq("key", key)

        .maybeSingle();

    if (error) {

      return fallback;

    }

    return data?.value ?? fallback;

  } catch {

    return fallback;

  }

}

/* =========================================================

   BASIC HEALTH

========================================================= */

app.get(

  "/health",

  asyncRoute(async (req, res) => {

    return ok(res, {

      service:

        "harvey-taxi-server-j",

      status:

        "healthy",

      environment:

        NODE_ENV,

      time:

        nowIso()

    });

  })

);

/* =========================================================

   API HEALTH

========================================================= */

app.get(

  "/api/health",

  asyncRoute(async (req, res) => {

    let database = "unknown";

    let preflight = null;

    try {

      const { error } =

        await supabase

          .from("system_flags")

          .select("key")

          .limit(1);

      database =

        error ? "error" : "connected";

    } catch {

      database = "error";

    }

    // Public callers (homepage, rider dashboard, uptime checks) only need
    // up/down. Integration, feature-flag and table-preflight details
    // describe the deployment's configuration and go only to an
    // authenticated admin.
    if (!isAdminRequest(req)) {

      return ok(res, {

        service:

          "harvey-taxi-server-j",

        status:

          database === "connected"

            ? "healthy"

            : "degraded",

        database,
        // Minimal deployment identifier: the first 7 characters of the
        // deployed Git commit (Render's RENDER_GIT_COMMIT), or "unknown".
        version:
          BUILD_VERSION,

        time:

          nowIso()

      });

    }

    try {

      preflight =

        await checkRequiredTables();

    } catch (error) {

      preflight = {

        error:

          error.message

      };

    }

    return ok(res, {

      service:

        "harvey-taxi-server-j",

      status:

        database === "connected"

          ? "healthy"

          : "degraded",

      database,

      preflight,

      integrations: {

        supabase:

          Boolean(

            SUPABASE_URL &&

            SUPABASE_SERVICE_ROLE_KEY

          ),

        stripe:

          Boolean(stripe),

        sendgrid:

          Boolean(

            sgMail &&

            SENDGRID_API_KEY

          ),

        twilio:

          Boolean(twilioClient),

        persona:

          Boolean(PERSONA_API_KEY),

        checkr:

          Boolean(CHECKR_API_KEY),

        openai:

          Boolean(openai),

        web_push:

          pushEnabled,

        mapbox:

          GEO_CONFIG.configured && GEO_CONFIG.problems.length === 0

      },

      htaf_activation: {

        ride_creation: {
          enabled: HTAF_ACTIVATION.rideCreation.enabled,
          reason: HTAF_ACTIVATION.rideCreation.reason,
          missing_approvals: HTAF_ACTIVATION.rideCreation.missing,
          approvals: HTAF_ACTIVATION.rideCreation.approvals
        },

        ride_assistance: {
          enabled: HTAF_FUNDING.funding.enabled,
          reason: HTAF_FUNDING.funding.reason,
          missing_approvals: HTAF_FUNDING.funding.missing,
          approvals: HTAF_FUNDING.funding.approvals
        },

        ride_assistance_invoicing: {
          enabled: HTAF_FUNDING.invoicing.enabled,
          reason: HTAF_FUNDING.invoicing.reason,
          charges_htaf: HTAF_FUNDING.invoicing.chargesHtaf
        }

      },

      features: {

        htaf_ride_creation:

          HTAF_ACTIVATION.rideCreation.enabled,

        htaf_admin_alerts:

          Boolean(HTAF_ADMIN_EMAIL),


        rider_approval_gate:

          ENABLE_RIDER_APPROVAL_GATE,

        payment_gate:

          ENABLE_PAYMENT_GATE,

        auto_redispatch:

          ENABLE_AUTO_REDISPATCH,

        delivery:

          ENABLE_DELIVERY,

        food_delivery:

          ENABLE_FOOD_DELIVERY,

        grocery_delivery:

          ENABLE_GROCERY_DELIVERY,

        htaf_applications:

          ENABLE_HTAF_APPLICATIONS

      },

      time:

        nowIso()

    });

  })

);

/* =========================================================

   SYSTEM STATUS

========================================================= */

app.get(

  "/api/system/status",

  asyncRoute(async (req, res) => {

    const dispatchPaused =

      await getSystemFlag(

        "dispatch_paused",

        "false"

      );

    return ok(res, {

      dispatch_paused:

        dispatchPaused === "true",

      server_time:

        nowIso(),

      app_base_url:

        APP_BASE_URL,

      environment:

        NODE_ENV

    });

  })

);

/* =========================================================

   ADMIN CONFIG CHECK

   Does not expose secret values.

========================================================= */

app.get(

  "/api/admin/config-check",

  requireAdmin,

  asyncRoute(async (req, res) => {

    const htafSchema =

      await inspectHtafSchema();

    return ok(res, {

      environment:

        NODE_ENV,

      required: {

        SUPABASE_URL:

          Boolean(SUPABASE_URL),

        SUPABASE_SERVICE_ROLE_KEY:

          Boolean(SUPABASE_SERVICE_ROLE_KEY)

      },

      integrations: {

        SENDGRID_API_KEY:

          Boolean(SENDGRID_API_KEY),

        TWILIO_ACCOUNT_SID:

          Boolean(TWILIO_ACCOUNT_SID),

        TWILIO_AUTH_TOKEN:

          Boolean(TWILIO_AUTH_TOKEN),

        TWILIO_FROM_NUMBER:

          Boolean(TWILIO_FROM_NUMBER),

        TWILIO_VERIFY_SERVICE_SID:

          Boolean(TWILIO_VERIFY_SERVICE_SID),

        STRIPE_SECRET_KEY:

          Boolean(STRIPE_SECRET_KEY),

        STRIPE_WEBHOOK_SECRET:

          Boolean(STRIPE_WEBHOOK_SECRET),

        PERSONA_API_KEY:

          Boolean(PERSONA_API_KEY),

        PERSONA_WEBHOOK_SECRET:

          Boolean(PERSONA_WEBHOOK_SECRET),

        PERSONA_TEMPLATE_ID_RIDER:

          Boolean(PERSONA_TEMPLATE_ID_RIDER),

        PERSONA_TEMPLATE_ID_DRIVER:

          Boolean(PERSONA_TEMPLATE_ID_DRIVER),

        CHECKR_API_KEY:

          Boolean(CHECKR_API_KEY),

        CHECKR_WEBHOOK_SECRET:

          Boolean(CHECKR_WEBHOOK_SECRET),

        OPENAI_API_KEY:

          Boolean(OPENAI_API_KEY),

        MAPBOX_ACCESS_TOKEN:

          GEO_CONFIG.configured,

        VAPID_PUBLIC_KEY:

          Boolean(VAPID_PUBLIC_KEY),

        VAPID_PRIVATE_KEY:

          Boolean(VAPID_PRIVATE_KEY)

      },

      toggles: {

        ENABLE_REAL_EMAIL,

        ENABLE_REAL_SMS,

        ENABLE_PERSONA,

        ENABLE_CHECKR,

        ENABLE_AI_SUPPORT,

        ENABLE_PAYMENT_GATE,

        ENABLE_RIDER_APPROVAL_GATE,

        ENABLE_AUTO_REDISPATCH,

        ENABLE_DELIVERY,

        ENABLE_FOOD_DELIVERY,

        ENABLE_GROCERY_DELIVERY,

        ENABLE_HTAF_APPLICATIONS

      },

      htaf_schema:

        htafSchema

    });

  })

);

/* =========================================================

   AI SUPPORT

========================================================= */

/* Safe, read-only status lookups for Harvey AI.

   Returns ONLY non-sensitive status fields — never names,

   emails, phones, addresses, or any personal data. Used to

   let the AI answer "what's the status of HTAF-XXXX?" without

   exposing anything private. */

async function aiLookupHtafStatus(code) {

  const clean = cleanString(code, 80);

  if (!clean) return null;

  const { data, error } =

    await supabase

      .from("htaf_applications")

      .select("application_code, status, program_type, created_at, updated_at")

      .eq("application_code", clean)

      .maybeSingle();

  if (error || !data) return null;

  return data;

}

/* Detects an application code like HTAF-YYYYMMDD-XXXXXX in the

   user's message so the AI can offer a real status. */

function extractHtafCode(text) {

  const match =

    String(text || "")

      .toUpperCase()

      .match(/HTAF-\d{8}-[A-Z0-9]{4,8}/);

  return match ? match[0] : null;

}

app.post(
  "/api/ai/support",
  rateLimit({ windowMs: 60_000, max: 20, keyPrefix: "ai_support" }),
  asyncRoute(async (req, res) => {
    const message = cleanString(req.body.message, 4000);
    const page = cleanString(req.body.page, 120);
    const role = cleanString(req.body.role, 60);

    // Conversation memory: last 10 valid turns from the frontend.
    const rawHistory = Array.isArray(req.body.history) ? req.body.history : [];
    const history = rawHistory
      .slice(-10)
      .filter(
        (m) =>
          m &&
          (m.role === "user" || m.role === "assistant") &&
          typeof m.content === "string"
      )
      .map((m) => ({ role: m.role, content: cleanString(m.content, 4000) }));

    if (!message) {
      return fail(res, "Message required.", 400);
    }

    // The old website chat sends messages to OpenAI with no consent step,
    // so it makes no model call unless the owner turns it back on
    // (system flag legacy_ai_support_enabled = "true"). Riders use Harvey
    // Assistant, which asks for consent before any AI answer.
    const legacyAiOn = (await getSystemFlag("legacy_ai_support_enabled", "false")) === "true";
    if (!openai || !legacyAiOn) {
      return ok(res, {
        reply:
          "Harvey AI Support is currently limited. Please contact support for help.",
        fallback: true,
        support_email: SUPPORT_EMAIL
      });
    }

    // Formal tool-calling: the model decides when to look up an HTAF status,
    // reusing the existing read-only aiLookupHtafStatus() helper. To add more
    // tools later (ride status, fare estimate), add a schema here and a case
    // in runTool() — the loop below does not change.
    const AI_TOOLS = [
      {
        type: "function",
        function: {
          name: "lookup_htaf_status",
          description:
            "Look up the status of an HTAF application by its application code. " +
            "Call this ONLY when the person provides an application code in the " +
            "format HTAF-YYYYMMDD-XXXX (for example HTAF-20260214-9F3A). Returns " +
            "non-sensitive status fields only. Never promise approval or a timeline.",
          parameters: {
            type: "object",
            properties: {
              application_code: {
                type: "string",
                description: "The HTAF application code, format HTAF-YYYYMMDD-XXXX."
              }
            },
            required: ["application_code"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "lookup_ride_status",
          description:
            "Look up the status of a ride by its ride code. Call this ONLY when the " +
            "person provides a ride code in the format RIDE-XXXXXXXXXX (for example " +
            "RIDE-9F3A2B7C10). Returns only the ride's status, type, and timing — " +
            "never an address, price, fare, driver name, or phone number.",
          parameters: {
            type: "object",
            properties: {
              ride_code: {
                type: "string",
                description: "The ride code, format RIDE-XXXXXXXXXX."
              }
            },
            required: ["ride_code"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "open_ride_workflow",
          description:
            "Call this when the person clearly wants to START a new ride, food delivery, " +
            "grocery delivery, or HTAF-assisted transportation request right now, or wants to " +
            "schedule one for later — for example 'take me to the airport', 'order Walmart " +
            "groceries', 'I need a ride to my doctor's appointment', 'schedule a ride for " +
            "tomorrow at 8am'. This does NOT book, dispatch, or charge anything. It only opens " +
            "the request page with the service and any known details pre-filled so the person " +
            "can review and submit it themselves. Do not call this for status questions or " +
            "general questions — only for a clear intent to start a new request.",
          parameters: {
            type: "object",
            properties: {
              service: {
                type: "string",
                enum: ["ride", "food", "grocery", "htaf"],
                description:
                  "ride = standard passenger ride. food = restaurant delivery. grocery = " +
                  "grocery store delivery. htaf = HTAF-assisted transportation (medical " +
                  "appointments, essential needs)."
              },
              destination: {
                type: "string",
                description:
                  "The destination in the person's own words (e.g. 'the airport', 'Walmart " +
                  "on Charlotte Pike'). Omit if not mentioned."
              },
              pickup: {
                type: "string",
                description:
                  "The pickup location if mentioned. Omit if not mentioned — most riders use " +
                  "their current location."
              },
              scheduled_time: {
                type: "string",
                description:
                  "The requested time in the person's own words (e.g. 'tomorrow at 8am', 'in " +
                  "20 minutes'). Omit if they want it now."
              }
            },
            required: ["service"]
          }
        }
      }
    ];

    // Set by runTool() when open_ride_workflow is called, and attached to
    // the HTTP response below so the frontend can act on it (navigate /
    // prefill). Only ever holds our own cleaned values, never raw model output.
    let capturedAction = null;

    async function runTool(name, args) {
      if (name === "lookup_htaf_status") {
        const code = cleanString(args && args.application_code, 80);
        if (!code || !/HTAF-\d{8}-[A-Z0-9]{4,8}/.test(code.toUpperCase())) {
          return {
            error:
              "No valid HTAF application code provided. Ask the person for a code " +
              "in the format HTAF-YYYYMMDD-XXXX."
          };
        }
        const status = await aiLookupHtafStatus(code);
        if (!status) {
          return {
            found: false,
            message:
              "No application found for code " + code + ". Ask them to double-check " +
              "it, or direct them to support."
          };
        }
        return {
          found: true,
          application_code: status.application_code,
          status: status.status,
          program_type: status.program_type,
          submitted: String(status.created_at).slice(0, 10),
          last_updated: String(status.updated_at).slice(0, 10),
          guidance:
            "Explain this status plainly and kindly. Do NOT promise approval or a timeline."
        };
      }

      if (name === "lookup_ride_status") {
        const code = cleanString(args && args.ride_code, 80);
        if (!code || !/^RIDE-[A-F0-9]{6,12}$/.test(code.toUpperCase())) {
          return {
            error:
              "No valid ride code provided. Ask the person for a code in the " +
              "format RIDE-XXXXXXXXXX."
          };
        }
        const { data, error } = await supabase
          .from("rides")
          .select(
            "status, dispatch_status, ride_type, scheduled_time, created_at, updated_at"
          )
          .eq("id", code.toUpperCase())
          .maybeSingle();
        if (error || !data) {
          return {
            found: false,
            message:
              "No ride found for code " + code + ". Ask them to double-check it, " +
              "or direct them to support."
          };
        }
        return {
          found: true,
          status: data.status,
          dispatch_status: data.dispatch_status,
          ride_type: data.ride_type,
          scheduled_for: data.scheduled_time
            ? String(data.scheduled_time).slice(0, 16)
            : null,
          requested: String(data.created_at).slice(0, 16),
          last_updated: String(data.updated_at).slice(0, 16),
          guidance:
            "Explain the ride status plainly. Do NOT reveal or invent any address, " +
            "price, fare, driver name, or phone number, and do NOT promise an arrival time."
        };
      }

      if (name === "open_ride_workflow") {
        const service = ["ride", "food", "grocery", "htaf"].includes(args?.service)
          ? args.service
          : "ride";
        const destination = cleanString(args?.destination, 200) || null;
        const pickup = cleanString(args?.pickup, 200) || null;
        const scheduledTime = cleanString(args?.scheduled_time, 100) || null;

        // Same cleaned values used for both the tool result (fed back to the
        // model) and the action attached to the HTTP response (read by the
        // frontend) — the frontend never sees raw, unvalidated model output.
        capturedAction = {
          type: "open_ride_workflow",
          service,
          destination,
          pickup,
          scheduled_time: scheduledTime
        };

        return {
          opened: true,
          service,
          destination,
          pickup,
          scheduled_time: scheduledTime,
          guidance:
            "Tell the person you've opened and pre-filled the " + service + " request for " +
            "them to review. Make clear they still need to check the details and tap " +
            "Continue / Request themselves — you have NOT booked, dispatched, or charged " +
            "anything."
        };
      }

      return { error: "Unknown tool: " + name };
    }

    const systemContent = HARVEY_AI_SYSTEM_PROMPT;

    const messages = [
      { role: "system", content: systemContent },
      ...history,
      {
        role: "user",
        content: "Page: " + page + "\nRole: " + role + "\n\nUser message: " + message
      }
    ];

    const MAX_TURNS = 4; // hard cap so a confused exchange cannot loop / run up cost
    let reply = "I'm here to help. Please try again.";

    try {
      for (let turn = 0; turn < MAX_TURNS; turn++) {
        const completion = await openai.chat.completions.create({
          model: OPENAI_MODEL,
          messages,
          tools: AI_TOOLS,
          temperature: 0.3
        });

        const msg = completion.choices?.[0]?.message;
        if (!msg) break;
        messages.push(msg); // push assistant turn BEFORE any tool results

        if (!msg.tool_calls || msg.tool_calls.length === 0) {
          reply = msg.content || reply;
          break;
        }

        for (const call of msg.tool_calls) {
          let args = {};
          try {
            args = JSON.parse(call.function.arguments || "{}");
          } catch {
            args = {};
          }
          const result = await runTool(call.function.name, args);
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: JSON.stringify(result)
          });
        }
      }
    } catch (error) {
      console.error("❌ OpenAI support failed:", error.message);
      return ok(res, {
        reply:
          "Harvey AI Support is having trouble right now. Please try again or contact support.",
        fallback: true,
        support_email: SUPPORT_EMAIL
      });
    }

    auditLog({
      action: "ai_support_message",
      metadata: { page, role, length: message.length, action: capturedAction?.type || null },
      req
    }).catch(() => {});

    return ok(res, { reply, action: capturedAction });
  })
);

/* =========================================================

   PART 10B — STATIC ROUTES, ERROR HANDLING, BOOT SEQUENCE

========================================================= */

/* =========================================================

   STATIC PAGE ROUTES

========================================================= */

function sendStaticPage(res, fileName) {

  return res.sendFile(

    path.join(PUBLIC_DIR, fileName)

  );

}

app.get(

  "/",

  (req, res) =>

    sendStaticPage(

      res,

      "index.html"

    )

);

app.get(

  "/foundation",

  (req, res) =>

    sendStaticPage(

      res,

      "foundation.html"

    )

);

app.get(

  "/foundation.html",

  (req, res) =>

    sendStaticPage(

      res,

      "foundation.html"

    )

);

app.get(

  "/htaf-application",

  (req, res) =>

    sendStaticPage(

      res,

      "htaf-application.html"

    )

);

app.get(

  "/htaf-application.html",

  (req, res) =>

    sendStaticPage(

      res,

      "htaf-application.html"

    )

);

// Old request pages were booking (or, with ride_id, tracking) links, so
// they go straight to that screen. The dashboard itself never redirects,
// so there is no loop.
function redirectToDashboard(res, query) {
  const params = new URLSearchParams(query);
  params.set("screen", params.get("ride_id") ? "track" : "book");
  return res.redirect(301, `/rider-dashboard.html?${params.toString()}`);
}

// request-ride.html, request-food.html, and request-groceries.html were
// deleted — the wizard they used to serve now lives entirely inside
// rider-dashboard.html (#rideWizardOverlay). These routes exist only so
// old bookmarks, push-notification links, and search-engine results
// still land somewhere useful instead of 404ing.
app.get(
  "/request-ride",
  (req, res) => redirectToDashboard(res, req.query)
);

app.get(
  "/request-ride.html",
  (req, res) => redirectToDashboard(res, req.query)
);

app.get(
  "/request-food",
  (req, res) => redirectToDashboard(res, { ...req.query, mode: "food" })
);

app.get(
  "/request-food.html",
  (req, res) => redirectToDashboard(res, { ...req.query, mode: "food" })
);

app.get(
  "/request-groceries",
  (req, res) => redirectToDashboard(res, { ...req.query, mode: "grocery" })
);

app.get(
  "/request-groceries.html",
  (req, res) => redirectToDashboard(res, { ...req.query, mode: "grocery" })
);

app.get(

  "/support",

  (req, res) =>

    sendStaticPage(

      res,

      "support.html"

    )

);

app.get(

  "/support.html",

  (req, res) =>

    sendStaticPage(

      res,

      "support.html"

    )

);

app.get(

  "/settings",

  (req, res) =>

    sendStaticPage(

      res,

      "settings.html"

    )

);

app.get(

  "/settings.html",

  (req, res) =>

    sendStaticPage(

      res,

      "settings.html"

    )

);

app.get(

  "/rider-dashboard",

  (req, res) =>

    sendStaticPage(

      res,

      "rider-dashboard.html"

    )

);

app.get(

  "/rider-dashboard.html",

  (req, res) =>

    sendStaticPage(

      res,

      "rider-dashboard.html"

    )

);

// The driver web page is /driver.html (owner decision 2026-10-18: "Moving
// everything to driver.html"). The old address redirects permanently,
// keeping its query string, so older driver app builds, sent emails, push
// notifications and bookmarks still land on it.
function redirectToDriverPage(req, res) {
  const q = req.originalUrl.indexOf("?");
  res.redirect(301, "/driver.html" + (q >= 0 ? req.originalUrl.slice(q) : ""));
}
app.get("/driver-dashboard", redirectToDriverPage);
app.get("/driver-dashboard.html", redirectToDriverPage);
app.get("/driver", (req, res) => sendStaticPage(res, "driver.html"));

app.get(

  "/driver-signup",

  (req, res) =>

    sendStaticPage(

      res,

      "driver-signup.html"

    )

);

app.get(

  "/driver-signup.html",

  (req, res) =>

    sendStaticPage(

      res,

      "driver-signup.html"

    )

);

app.get(

  "/rider-signup",

  (req, res) =>

    sendStaticPage(

      res,

      "rider-signup.html"

    )

);

app.get(

  "/rider-signup.html",

  (req, res) =>

    sendStaticPage(

      res,

      "rider-signup.html"

    )

);

app.get(

  "/admin-htaf",

  (req, res) =>

    sendStaticPage(

      res,

      "admin-htaf.html"

    )

);

app.get(

  "/admin-htaf.html",

  (req, res) =>

    sendStaticPage(

      res,

      "admin-htaf.html"

    )

);

/* =========================================================
   ADMIN: effective payment configuration (no secrets)
   Answers "are live card payments enabled right now?" from the running
   configuration -- key modes by prefix, gate, webhook secret -- never from
   payment counts, and never returning any key material.
========================================================= */
// The Stripe account the running secret key belongs to (GET /v1/account),
// cached briefly. Reports only an allow-listed summary, or the Stripe
// error code (e.g. authentication_error) if the key can't be used.
let stripeAccountCache = { at: 0, value: null };
const STRIPE_ACCOUNT_CACHE_MS = 10 * 60_000;

async function currentStripeAccountSummary() {
  if (!stripe) return { id: null, error: "stripe_not_configured" };
  if (stripeAccountCache.value && Date.now() - stripeAccountCache.at < STRIPE_ACCOUNT_CACHE_MS) {
    return stripeAccountCache.value;
  }
  let value;
  try {
    const account = await Promise.race([
      stripe.accounts.retrieve(),
      new Promise((_, reject) => setTimeout(() => reject(Object.assign(new Error("timeout"), { code: "timeout" })), 5000))
    ]);
    value = describeStripeAccount(account);
  } catch (err) {
    value = { id: null, error: String(err?.type || err?.code || "unavailable").slice(0, 60) };
  }
  stripeAccountCache = { at: Date.now(), value };
  return value;
}

app.get(
  "/api/admin/payments/config-status",
  requireAdmin,
  asyncRoute(async (req, res) => {
    return ok(res, {
      payments: describePaymentConfig({
        secretKey: STRIPE_SECRET_KEY,
        publishableKey: STRIPE_PUBLISHABLE_KEY,
        webhookSecret: STRIPE_WEBHOOK_SECRET,
        paymentGateEnabled: ENABLE_PAYMENT_GATE,
        stripeClientReady: Boolean(stripe)
      }),
      stripe_account: await currentStripeAccountSummary()
    });
  })
);

/* =========================================================
   AI AGENT MANAGER
   Coordinates rider/driver assistance and admin dispatch advice. See
   docs/ai-agent-manager.md. Every capability is behind system_flags rows
   that default OFF (lib/agent/policy.js), the agent's only data access is
   the role-scoped tools in lib/agent/tools.js, and the only operational
   action it can ever take (automatic redispatch of a stalled paid ride)
   goes through the existing dispatchRide() and is OFF in this release.
   The conversational model is optional, self-hosted and configured by
   AGENT_LLM_* env vars; with it unset or down, answers are rule-based.
   Booking and dispatch never call into this block.
========================================================= */
const agentLlmConfig = readAgentLlmConfig();
const agentLlm = createAgentLlmClient({ config: agentLlmConfig });
// Approved knowledge: published pages plus admin-approved articles,
// cached in memory (lib/knowledge/store.js).
const knowledgeStore = createKnowledgeStore({
  loadApproved: async () => {
    const { data, error } = await supabase
      .from("knowledge_articles")
      .select("slug, title, body, audience, status, version, approved_at")
      .eq("status", "approved")
      .limit(500);
    if (error) throw error;
    return data || [];
  },
  log: (msg) => console.warn("⚠️ Knowledge articles could not be loaded:", msg)
});
const agentTools = createAgentTools({
  supabase,
  complianceOptions: { enablePersona: ENABLE_PERSONA, enableCheckr: ENABLE_CHECKR },
  // Dispatch Recommender's current rules, for the read-only dispatch outlook.
  getRules: async () => (await loadAgentState()).rules
});
// Claude Haiku (owner-approved, at most $10 a month across all apps;
// docs/ai-model.md). Off unless ANTHROPIC_API_KEY is set AND the admin
// model mode lets the account use it; the budget is checked before every
// model turn and spending is recorded in agent_model_usage.
const claudeConfig = readClaudeConfig();
const claude = createClaudeClient({ config: claudeConfig });
// Atomic reservations and settlement run inside the database
// (migration 20261005010000), so every server instance shares one total.
const modelBudget = createModelBudget({
  budgetUsd: budgetFromEnv(),
  model: claudeConfig.model,
  db: {
    async reserve({ month, budgetUsd, amountUsd, role, actorId }) {
      const { data, error } = await supabase.rpc("agent_model_reserve", {
        p_month: month,
        p_budget_usd: budgetUsd,
        p_amount_usd: amountUsd,
        p_role: role,
        p_actor_id: actorId
      });
      if (error) throw new Error(error.message || "agent_model_reserve failed");
      return data === null || data === undefined ? null : data;
    },
    async settle({ reservationId, costUsd, calls, inputTokens, outputTokens, cacheCreationInputTokens, cacheReadInputTokens, model, role, actorId, appTarget, outcome }) {
      const { data, error } = await supabase.rpc("agent_model_settle", {
        p_reservation_id: reservationId,
        p_cost_usd: costUsd,
        p_calls: calls,
        p_input_tokens: inputTokens,
        p_output_tokens: outputTokens,
        p_cache_creation_input_tokens: cacheCreationInputTokens,
        p_cache_read_input_tokens: cacheReadInputTokens,
        p_model: model,
        p_role: role,
        p_actor_id: actorId,
        p_app_target: appTarget,
        p_outcome: outcome
      });
      if (error) throw new Error(error.message || "agent_model_settle failed");
      return data === true;
    },
    async totals(month) {
      const { data, error } = await supabase.rpc("agent_model_month_totals", { p_month: month });
      if (error) throw new Error(error.message || "agent_model_month_totals failed");
      const row = Array.isArray(data) ? data[0] : data;
      return row || { committed_usd: 0, held_usd: 0 };
    }
  },
  log: (msg) => console.warn("⚠️ Assistant model budget:", msg)
});

/* =========================================================
   ASSISTANT PILOT (docs/assistant-platform-architecture.md)

   Conversational help from each organization's approved PUBLIC pages,
   with source citations, follow-up questions and streaming. Separate
   per organization (decided by the host, never the request), off by
   default (assistant_pilot_<org>_enabled), and the model is a second,
   separate switch: assistant_pilot_<org>_model_enabled AND the
   server setting ASSISTANT_PILOT_MODEL_APPROVED=true. Without both, the
   pilot answers extractively from the same sources and calls nothing
   external. No transcript or memory is stored; unanswered questions are
   logged as a topic label only.
========================================================= */

const assistantPilotOrgs = require("./lib/assistantPilot/orgs");
const assistantPilotCorpus = require("./lib/assistantPilot/corpus");
const { articleSections: knowledgeArticleSections } = require("./lib/knowledge/search");
const { runTurn: runAssistantPilotTurn } = require("./lib/assistantPilot/orchestrator");
const { readMembraneConfig, describeMembraneConfig } = require("./lib/membrane/config");
const { runCalibration: runMembraneCalibration } = require("./lib/membrane/calibration");
const { createMembraneEmbedder } = require("./lib/membrane/embeddings");
const { buildMemoryStore, pgvectorStore } = require("./lib/assistantPilot/vectors");
const { createGateway: createAssistantPilotGateway, anthropicProvider } = require("./lib/assistantPilot/gateway");

const assistantPilotState = { corpora: {}, provider: undefined, embedder: undefined, vectorStores: {}, published: {}, articlesKey: {}, pinned: {} };
// Harvey Taxi's corpus is its published pages plus the admin-approved
// articles (also public, on /policies.html), taken from knowledgeStore's
// cached copy. When an article is approved, edited or retired the corpus is
// rebuilt, which also rebuilds the vector index. HTAF has no articles.
function assistantPilotCorpusFor(org) {
  if (assistantPilotState.pinned[org]) return assistantPilotState.corpora[org]; // set by a test
  const published = assistantPilotState.published[org] || (assistantPilotState.published[org] = assistantPilotCorpus.loadPublishedSections(org));
  let rows = [];
  if (org === "harvey_taxi") {
    knowledgeStore.getIndex(); // refreshes the approved articles in the background when stale
    rows = knowledgeStore.approved();
  }
  const articles = knowledgeArticleSections(rows.map((r) => ({ ...r, status: "approved" })));
  // Every edit raises an article's version, so slug@version identifies its text.
  const key = rows.map((r) => `${r.slug}@${r.version}`).sort().join("|");
  if (!assistantPilotState.corpora[org] || assistantPilotState.articlesKey[org] !== key) {
    assistantPilotState.corpora[org] = assistantPilotCorpus.buildOrgCorpus(org, { sections: [...published, ...articles] });
    assistantPilotState.articlesKey[org] = key;
  }
  return assistantPilotState.corpora[org];
}
function assistantPilotProvider() {
  if (assistantPilotState.provider !== undefined) return assistantPilotState.provider;
  if (!claudeConfig.configured) return (assistantPilotState.provider = null);
  // eslint-disable-next-line global-require
  const Anthropic = require("@anthropic-ai/sdk").default || require("@anthropic-ai/sdk");
  // eslint-disable-next-line global-require
  const { clientOptions } = require("./lib/agent/claudeClient");
  return (assistantPilotState.provider = anthropicProvider({ sdk: new Anthropic(clientOptions(claudeConfig)), model: claudeConfig.model }));
}

// Vector retrieval through the membrane (Harvey Taxi's own model service;
// lib/membrane). Used only when the organization's vectors flag is "true",
// the membrane is configured with a server we run, and
// MEMBRANE_MIN_SIMILARITY has been calibrated. The index is built in the
// background; until it is ready, or if the membrane fails, answers use
// keyword retrieval exactly as before.
const membraneConfig = readMembraneConfig();
const MEMBRANE_INDEX_RETRY_MS = 5 * 60_000;
function membraneMinSimilarity() {
  const v = Number(process.env.MEMBRANE_MIN_SIMILARITY);
  return Number.isFinite(v) && v > 0 && v < 1 ? v : null;
}
function assistantPilotEmbedder() {
  if (assistantPilotState.embedder !== undefined) return assistantPilotState.embedder;
  return (assistantPilotState.embedder = createMembraneEmbedder(membraneConfig));
}
async function assistantPilotVectorsFor(org) {
  const conf = assistantPilotOrgs.ORGS[org];
  if ((await getSystemFlag(conf.vectorsFlag, "false")) !== "true") return null;
  const embedder = assistantPilotEmbedder();
  const minSimilarity = membraneMinSimilarity();
  if (!embedder || minSimilarity === null) return null;
  if (process.env.MEMBRANE_VECTOR_STORE === "pgvector") {
    const rpc = async (name, args) => {
      const { data, error } = await supabase.rpc(name, args);
      if (error) throw new Error("vector_store_unavailable");
      return data;
    };
    return { store: pgvectorStore({ org, model: embedder.model, rpc }), embedder, minSimilarity };
  }
  const slot = assistantPilotState.vectorStores[org] || (assistantPilotState.vectorStores[org] = { store: null, building: null, failedAt: 0 });
  const corpus = assistantPilotCorpusFor(org);
  if (slot.store && slot.corpus === corpus) return { store: slot.store, embedder, minSimilarity };
  if (!slot.building && Date.now() - slot.failedAt > MEMBRANE_INDEX_RETRY_MS) {
    slot.building = buildMemoryStore({ corpus, embedder })
      .then((store) => {
        slot.store = store;
        slot.corpus = corpus;
      })
      .catch((err) => {
        slot.failedAt = Date.now();
        console.warn("⚠️ Membrane vector index not built:", { org, error_code: (err && err.code) || "error" });
      })
      .finally(() => {
        slot.building = null;
      });
  }
  return null;
}

/* Admin: membrane status and embedding calibration (read-only). Owner
   account only. Runs inside Render, where the membrane's private address is
   reachable, and returns scores for the fixed calibration questions; it
   writes nothing, changes no flag and stores no text. */
app.get(
  "/api/admin/membrane/calibration",
  requireAdmin,
  rateLimit({ windowMs: 60_000, max: 3, keyPrefix: "membrane_calibration" }),
  asyncRoute(async (req, res) => {
    const { role } = await resolveAdminRoleForRequest(req);
    if (role !== "super_admin") return fail(res, "Membrane calibration requires the owner account.", 403);
    const config = describeMembraneConfig(membraneConfig);
    if (!membraneConfig.configured) return ok(res, { config, health: null, calibration: null });
    let health = null;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      const r = await fetch(`${membraneConfig.baseUrl}/health`, { signal: controller.signal });
      clearTimeout(timer);
      health = { status: r.status, ...(r.ok ? await r.json() : {}) };
    } catch {
      health = { status: "unreachable" };
    }
    const embedder = createMembraneEmbedder({ ...membraneConfig, timeoutMs: 30_000 });
    try {
      const calibration = await runMembraneCalibration({ embedder, minSimilarity: membraneMinSimilarity() });
      return ok(res, { config, health, current_min_similarity: membraneMinSimilarity(), calibration });
    } catch (err) {
      return ok(res, { config, health, calibration: null, error: (err && err.code) || "calibration_failed" });
    }
  })
);

async function logAssistantPilotGap({ org, topic }) {
  // Topic label only (never the visitor's words), as the existing assistants do.
  if (org === "htaf") {
    const { error } = await supabase.from("htaf_assistant_questions").insert({ question_excerpt: topic, intent: "htaf_assistant_pilot" });
    if (error) console.warn("⚠️ Assistant pilot gap not logged:", logErrorCodeForPilot(error));
    return;
  }
  await auditLog({ action: "assistant_pilot_gap", entity_type: "assistant", entity_id: org, metadata: { org, topic } }).catch(() => {});
}
const logErrorCodeForPilot = (error) => (error && error.code ? String(error.code).slice(0, 20) : "unknown");

const assistantPilotRateLimit = rateLimit({
  windowMs: 60_000,
  max: Math.max(1, Math.min(Number(process.env.ASSISTANT_PILOT_PER_MINUTE) || 10, 1000)),
  keyPrefix: "assistant_pilot"
});
const ASSISTANT_PILOT_TURN_DEADLINE_MS = 30_000;

app.post(
  "/api/assistant/pilot/chat",
  assistantPilotRateLimit,
  asyncRoute(async (req, res) => {
    const org = assistantPilotOrgs.orgForHost(req.hostname, FOUNDATION_HOSTS);
    const conf = assistantPilotOrgs.ORGS[org];
    const body = req.body && typeof req.body === "object" ? req.body : {};
    // The organization comes from the host. A request naming another
    // organization is refused rather than silently answered.
    if (body.org !== undefined && body.org !== org) return fail(res, "This assistant serves a different organization.", 403);
    if ((await getSystemFlag(conf.enabledFlag, "false")) !== "true") return fail(res, "The assistant pilot is not enabled.", 404);
    const modelEnabled =
      (await getSystemFlag(conf.modelFlag, "false")) === "true" && String(process.env.ASSISTANT_PILOT_MODEL_APPROVED || "") === "true";

    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), ASSISTANT_PILOT_TURN_DEADLINE_MS);
    res.on("close", () => controller.abort());

    const wantsStream = String(req.headers.accept || "").includes("text/event-stream");
    const collected = { text: "", events: [] };
    let emit;
    if (wantsStream) {
      res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no", Connection: "keep-alive" });
      emit = (type, data) => {
        if (!res.writableEnded) res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
      };
    } else {
      emit = (type, data) => {
        if (type === "delta") collected.text += data.text;
        else if (type === "replace") collected.text = data.text;
        collected.events.push({ type, ...data });
      };
    }
    const provider = modelEnabled ? assistantPilotProvider() : null;
    try {
      await runAssistantPilotTurn({
        viewer: { org, role: "visitor" },
        message: body.message,
        history: body.history,
        deps: {
          corpus: assistantPilotCorpusFor(org),
          vectors: await assistantPilotVectorsFor(org),
          modelEnabled,
          gateway: provider ? createAssistantPilotGateway({ provider, budget: modelBudget, appTarget: `assistant_pilot:${org}` }) : null,
          logGap: logAssistantPilotGap,
          signal: controller.signal
        },
        emit
      });
    } finally {
      clearTimeout(deadline);
    }
    if (wantsStream) return res.end();
    const pick = (type) => (collected.events.filter((e) => e.type === type).pop() || {});
    return ok(res, {
      org,
      reply: collected.text,
      mode: pick("done").mode,
      uncertain: Boolean(pick("done").uncertain),
      sources: pick("sources").items || [],
      followups: pick("followups").items || [],
      handoff: pick("handoff").href ? { label: pick("handoff").label, href: pick("handoff").href } : null
    });
  })
);

// Test-only seams: a fake provider and a fresh corpus. Undefined outside tests.
const assistantPilotTestHooks =
  process.env.NODE_ENV !== "test"
    ? undefined
    : {
    setProvider(p) {
      assistantPilotState.provider = p;
    },
    setCorpus(org, corpus) {
      assistantPilotState.corpora[org] = corpus;
      assistantPilotState.pinned[org] = true;
    },
    setEmbedder(e) {
      assistantPilotState.embedder = e;
      assistantPilotState.vectorStores = {};
    },
    vectorIndexReady(org) {
      const slot = assistantPilotState.vectorStores[org];
      return slot && slot.building ? slot.building.then(() => Boolean(slot.store)) : Promise.resolve(Boolean(slot && slot.store));
    },
    reset() {
      assistantPilotState.corpora = {};
      assistantPilotState.pinned = {};
      assistantPilotState.articlesKey = {};
      assistantPilotState.provider = undefined;
      assistantPilotState.embedder = undefined;
      assistantPilotState.vectorStores = {};
    },
    // undefined = no provider was ever looked up or built.
    providerState() {
      return assistantPilotState.provider;
    }
  };
// Assistant request accounting and daily limits (lib/agent/usage.js):
// in memory, no database reads or writes per request.
const agentUsage = createAgentUsageMeter();
const AGENT_USAGE_SALT = crypto.randomBytes(16).toString("hex");
// Signs answer feedback tokens (key derived from the rider session secret,
// so it survives restarts and is shared by every instance). Null without
// the secret: ratings are then unavailable.
const agentFeedbackSigner = createAgentFeedbackSigner(RIDER_SESSION_SECRET);
const AGENT_LIMITED_REPLY =
  "You've reached today's limit for the Harvey Taxi assistant. Booking, your trips and support still work as usual. In an emergency, call 911.";
// In-process memory only: cooldowns and log de-duplication. Losing it on
// restart is safe -- the ride-row claim below is what prevents duplicates.
const agentRedispatchHistory = new Map();
const agentShadowLogged = new Map();
const agentEscalatedRides = new Set();
let agentSweepRunning = false;

async function loadAgentState() {
  const keys = [...AGENT_BOOLEAN_FLAG_KEYS, AGENT_FLAG_KEYS.RULES, "dispatch_paused", ...Object.values(MODEL_FLAG_KEYS)];
  try {
    const { data, error } = await supabase
      .from("system_flags")
      .select("key,value,updated_at")
      .in("key", keys);
    if (error) throw error;
    const rows = data || [];
    const flags = resolveAgentFlags(rows);
    const dispatchPaused = rows.some((r) => r.key === "dispatch_paused" && r.value === "true");
    const rulesRow = rows.find((r) => r.key === AGENT_FLAG_KEYS.RULES);
    return {
      ok: true,
      flags,
      dispatchPaused,
      rules: parseAgentRules(rulesRow ? rulesRow.value : null),
      mode: resolveAgentMode(flags, { dispatchPaused }),
      model: resolveModelPolicy(rows)
    };
  } catch (err) {
    // Fail closed: if the flags can't be read, the agent is fully off and
    // automation is treated as blocked.
    const flags = resolveAgentFlags([]);
    return {
      ok: false,
      flags,
      dispatchPaused: true,
      rules: parseAgentRules(null),
      mode: resolveAgentMode(flags, { dispatchPaused: true }),
      model: resolveModelPolicy([])
    };
  }
}

function agentAudit(entry, req = null) {
  return auditLog({ ...entry, req }).catch(() => {});
}

async function openAgentCase({ role, actorId, escalation, message, source, rideId = null, caseId: fixedCaseId = null }) {
  const caseId = fixedCaseId || newAgentCaseId();
  const entry = agentCaseOpenedEntry({ caseId, role, actorId, escalation, message, source });
  if (rideId) entry.metadata.ride_id = String(rideId);
  await agentAudit(entry);
  if (escalation.category === "emergency") {
    broadcastSse("agent_emergency_case", { case_id: caseId, at: nowIso() });
  }
  return caseId;
}

const AGENT_UNAVAILABLE_REPLY = {
  reply:
    "The Harvey Taxi assistant is not available right now. You can still book and track rides as usual. In an emergency, call 911.",
  source: "rules",
  actions: [{ type: "call_911", label: "Call 911", href: "tel:911" }]
};

// Only the driver app asks for in-app actions; anything else gets the web
// dashboard's answers and links.
const AGENT_CLIENTS = new Set(["web", "driver_app"]);

// Shown under every answer the Claude model wrote.
const AI_ANSWER_LABEL = "AI-generated by Harvey Assistant";

// One model-powered turn, if this account may use the model and the
// monthly budget allows it. Returns { result } (the assistant result, or
// null to use the rules-based answer) and { record } (what the audit log
// keeps: tokens, cost, and why the rules answered, if they did).
async function runModelTurn({ state, role, actor, message, client, capabilities, context, appTarget }) {
  const eligibility = modelEligibility(state.model, { role, actor, client, capabilities });
  if (!eligibility.eligible) return { result: null, record: null };
  if (!claude) return { result: null, record: { used: false, fallback_reason: "not_configured" } };
  // One atomic reservation of this answer's worst case, in the database.
  const hold = await modelBudget.reserve({ role, actorId: actor ? String(actor.id) : null });
  if (!hold.ok) return { result: null, record: { used: false, fallback_reason: hold.reason } };
  let out;
  try {
    out = await handleModelAssist({ role, actor, message, tools: agentTools, claude, client, knowledgeIndex: knowledgeStore.getIndex(), context });
  } catch (err) {
    // Unexpected failure: treat every possible call as spent.
    out = { ok: false, reason: "internal_error", calls: 0, uncertain_calls: 0, usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }, cost_usd: modelBudget.status().reserve_per_turn_usd };
  }
  if (out.reason === "spend_limit") modelBudget.markProviderLimit();
  // Always settle (with $0 if no call was made) so the reservation is
  // released into its real cost.
  await hold.settle({
    costUsd: out.cost_usd,
    calls: out.calls,
    inputTokens: out.usage.input_tokens,
    outputTokens: out.usage.output_tokens,
    cacheCreationInputTokens: out.usage.cache_creation_input_tokens,
    cacheReadInputTokens: out.usage.cache_read_input_tokens,
    model: claude.model,
    role,
    actorId: actor ? String(actor.id) : null,
    appTarget,
    outcome: out.ok ? "answered" : `fallback_${out.reason}`
  });
  const record = {
    used: Boolean(out.ok),
    model: claude.model,
    calls: out.calls,
    input_tokens: out.usage.input_tokens,
    output_tokens: out.usage.output_tokens,
    cache_read_input_tokens: out.usage.cache_read_input_tokens,
    cache_creation_input_tokens: out.usage.cache_creation_input_tokens,
    cost_usd: out.cost_usd,
    uncertain_calls: out.uncertain_calls || 0,
    fallback_reason: out.ok ? null : out.reason,
    // Anthropic's own sanitized error (status, type, message, request id).
    provider_error: out.ok ? null : out.provider_error || null
  };
  if (!out.ok) return { result: null, record };
  return {
    record,
    result: {
      reply: out.reply,
      source: "model",
      intent: out.intent,
      escalation: null,
      actions: out.actions,
      sources: out.sources,
      knowledge_gap: out.knowledge_gap,
      used_context: Array.isArray(context) && context.length > 0,
      decision: {
        kind: "assist",
        policy: `model.${claude.model}`,
        tool_calls: out.tools_used.map((name) => ({ tool: name, ok: true })),
        outcome: out.knowledge_gap
          ? "knowledge_gap"
          : out.actions.some((a) => a.requires_confirmation)
            ? "proposed_action_awaiting_confirmation"
            : "answered",
        executed: false,
        model_used: true,
        knowledge_sources: out.sources.map((src) => `${src.url}#${src.section}`)
      }
    }
  };
}

async function runAgentAssist(req, res, { role, actor }) {
  const state = await loadAgentState();
  if (!state.mode.assist_enabled) {
    return res.status(503).json({ ok: false, agent_available: false, ...AGENT_UNAVAILABLE_REPLY });
  }
  const message = typeof req.body?.message === "string" ? req.body.message : "";
  if (!message.trim()) {
    return fail(res, "message required.", 400);
  }
  const usageKey = agentUsageKey({ role, actorId: actor ? actor.id : null, ip: getClientIp(req), salt: AGENT_USAGE_SALT });
  const usage = agentUsage.check(usageKey, {
    per_account: state.rules.assist_daily_limit_per_account,
    visitor: state.rules.assist_daily_limit_visitor,
    global: state.rules.assist_daily_limit_global
  });
  if (!usage.allowed) {
    // One record per account per day, not one per refused request.
    if (usage.first_block_today) {
      agentAudit(
        {
          actor_type: role === "driver" ? "driver" : "rider",
          actor_id: actor ? actor.id : null,
          action: AGENT_ACTIONS.USAGE_LIMITED,
          entity_type: "agent_usage",
          entity_id: usageKey.startsWith("visitor:") ? usageKey : null,
          metadata: { reason: usage.reason }
        },
        req
      );
    }
    return res.status(429).json({ ok: false, agent_available: true, limited: true, reason: usage.reason, reply: AGENT_LIMITED_REPLY, source: "rules", actions: [] });
  }
  const appTarget = agentAppTarget({ role, client: req.body?.client, platform: req.body?.platform, userAgent: req.get("user-agent") });
  agentUsage.record(usageKey, appTarget);
  const assistClient = role === "driver" && AGENT_CLIENTS.has(req.body?.client) ? req.body.client : "web";
  // The device's own recent turns, for follow-up questions only. Not
  // stored or logged (lib/agent/followUp.js).
  const assistContext = Array.isArray(req.body?.context) ? req.body.context : [];
  // What the client can display, e.g. "ai_label" from driver app builds that
  // show "AI-generated by Harvey Assistant" (lib/agent/modelPolicy.js).
  const assistCapabilities = Array.isArray(req.body?.capabilities)
    ? req.body.capabilities.slice(0, 10).filter((c) => typeof c === "string" && c.length <= 40)
    : [];
  // Specialist agents (lib/agent/specialists.js) answer first when one is
  // switched on for this question; they use rules or approved content only,
  // never the model. All off: this is null and nothing below changes.
  const specialistResult = await runAgentSpecialistTurn({ state, role, actor, message, client: assistClient });
  const model = specialistResult ? { result: null, record: null } : await runModelTurn({ state, role, actor, message, client: assistClient, capabilities: assistCapabilities, context: assistContext, appTarget });
  const result =
    specialistResult ||
    model.result ||
    (await handleAgentAssist({
      role,
      actor,
      message,
      tools: agentTools,
      llm: agentLlmConfig.configured ? agentLlm : null,
      client: assistClient,
      context: assistContext,
      knowledgeIndex: knowledgeStore.getIndex()
    }));
  let caseId = null;
  if (result.escalation) {
    caseId = await openAgentCase({ role, actorId: actor ? actor.id : null, escalation: result.escalation, message, source: "assist" });
  }
  const decision = agentAssistDecisionEntry({ role, actorId: actor ? actor.id : null, result, mode: state.mode.mode, message, appTarget, model: model.record });
  // Ratings (agent_feedback_enabled): the answer gets an id and a token
  // only its asker can use to rate it; the conversation id the web
  // assistant sends links answers to any support request from the same
  // chat. Off: nothing here changes.
  let feedbackToken = null;
  if (state.flags[AGENT_FEEDBACK_FLAG] === true && agentFeedbackSigner) {
    const answerId = newAgentAnswerId();
    const conversationId = cleanAgentConversationId(req.body?.conversation_id);
    decision.metadata.answer_id = answerId;
    decision.metadata.conversation_id = conversationId;
    feedbackToken = agentFeedbackSigner.issue({ answerId, role, actorId: actor ? actor.id : null, intent: result.intent, source: result.source, appTarget, conversationId });
  }
  agentAudit(decision, req);
  return ok(res, {
    agent_available: true,
    reply: result.reply,
    source: result.source,
    intent: result.intent,
    escalation: result.escalation,
    actions: result.actions,
    // Approved pages the answer quotes (title, section, url, date), and
    // whether the question had no approved answer.
    sources: result.sources || [],
    knowledge_gap: result.knowledge_gap === true,
    used_context: result.used_context === true,
    case_id: caseId,
    // Which specialist answered, its chief, and that it used rules or
    // approved content (no AI model). Absent when a chief answered.
    ...(result.specialist ? { specialist: result.specialist } : {}),
    // A model-written answer is labelled as such in every client.
    ...(result.source === "model" ? { answered_by: { engine: "model", label: AI_ANSWER_LABEL } } : {}),
    ...(feedbackToken ? { feedback_token: feedbackToken } : {})
  });
}

// One specialist turn, or null for "let the chiefs answer as before".
// Never throws: any failure falls back to the chiefs.
async function runAgentSpecialistTurn({ state, role, actor, message, client }) {
  try {
    const anyOn = agentSpecialists.SPECIALIST_FLAG_KEYS.some((key) => state.flags[key] === true);
    if (!anyOn || !state.mode.assist_enabled || state.mode.kill_switch) return null;
    // The HTAF chief has its own switch; read it only for HTAF questions.
    let htafEnabled = false;
    if (state.flags[agentSpecialists.SPECIALIST_FLAGS.HTAF] === true && agentSpecialists.PATTERNS.htaf_information.test(String(message || ""))) {
      htafEnabled = await htafAssistEnabled();
    }
    const specialist = agentSpecialists.routeSpecialist({
      role,
      message,
      // A switched-on specialist answers only the accounts in
      // agent_specialist_scope (test accounts by default).
      isActive: (s) =>
        specialistEligibility(state.model, { role, actor }) &&
        agentSpecialists.specialistActive(s, { mode: state.mode, flags: state.flags, htafEnabled })
    });
    if (!specialist) return null;
    if (specialist.id === "htaf_information") return await runHtafSpecialist(specialist, { role, actor, message, client });
    return await agentSpecialists.runSpecialist({ specialist, role, actor, message, tools: agentTools, client });
  } catch (err) {
    console.warn("⚠️ Specialist agent skipped:", err && err.message);
    return null;
  }
}

async function runHtafSpecialist(specialist, { role, actor, message, client }) {
  const result = await agentSpecialists.runSpecialist({
    specialist,
    role,
    actor,
    message,
    tools: agentTools,
    client,
    htaf: { answer: (text) => htafAssistant.answerHtafQuestion(HTAF_ASSIST.index, text) }
  });
  // Unanswered HTAF questions go to HTAF staff's list, redacted, as on
  // the HTAF site.
  if (result && result.knowledge_gap && result.gap_excerpt) {
    const { error } = await supabase.from("htaf_assistant_questions").insert({ question_excerpt: result.gap_excerpt, intent: "harvey_taxi_assistant" });
    if (error) console.warn("⚠️ HTAF assistant question not logged:", error.message);
  }
  return result;
}

const agentAssistRateLimit = rateLimit({ windowMs: 60_000, max: 20, keyPrefix: "agent_assist" });

app.get(
  "/api/agent/status",
  rateLimit({ windowMs: 60_000, max: 60, keyPrefix: "agent_status" }),
  asyncRoute(async (req, res) => {
    const state = await loadAgentState();
    return ok(res, {
      assist_available: state.mode.assist_enabled,
      answer_mode:
        claude && state.model.mode !== "off"
          ? state.model.mode === "all"
            ? "claude_haiku_with_rules_fallback"
            : "rules_only_except_test_accounts"
          : agentLlmConfig.configured
            ? "self_hosted_model_with_rules_fallback"
            : "rules_only"
    });
  })
);

app.post(
  "/api/agent/rider/assist",
  agentAssistRateLimit,
  asyncRoute(async (req, res) => {
    // Personal ride data only with a real, verified rider session. A
    // sessionless rider still gets general help and booking guidance.
    const rider = await resolveVerifiedRiderSession(req);
    return runAgentAssist(req, res, { role: "rider", actor: rider ? { role: "rider", id: String(rider.id) } : null });
  })
);

app.post(
  "/api/agent/driver/assist",
  agentAssistRateLimit,
  requireDriverSelf,
  asyncRoute(async (req, res) => {
    return runAgentAssist(req, res, { role: "driver", actor: { role: "driver", id: String(req.driver.id) } });
  })
);

/* =========================================================
   SUPPORT HANDOFF (docs/ai-knowledge.md, phase 4)
   1. draft: the user's own recent questions, for them to edit;
   2. send: only the text the user approved, only when signed in. The
      request is recorded as a case in the human-review queue, and the
      reference is returned only after that record is saved, so the app
      never says "sent" for a request support can't see. A copy is then
      emailed to support@harveytaxiservice.com; its outcome is recorded
      and reported separately from the case. Retries and double taps
      return the first case instead of creating another.
   Lost items (kind "lost_item") use the same flow, optionally linked to
   one of the account's own recent trips.
========================================================= */
const handoffLimiter = createHandoffLimiter();
const handoffDeduper = createHandoffDeduper();
// Where the email copy of each request goes (the case queue is the record).
const HANDOFF_SUPPORT_EMAIL = env("HANDOFF_SUPPORT_EMAIL", "support@harveytaxiservice.com");
const HANDOFF_EMAIL_WAIT_MS = 8000;
const HANDOFF_NOT_SENT =
  "Your request was not sent. Please try again, or use the Support page to contact Harvey Taxi. In an emergency, call 911.";
const HANDOFF_RIDE_COLUMNS = "id, rider_id, driver_id, status, pickup_address, dropoff_address, created_at, completed_at";
const HANDOFF_RIDE_DAYS = 14;

// The account's own most recent trip in the last 14 days, for a lost-item
// report. Riders by rider_id, drivers by driver_id; cancelled trips skipped.
async function findHandoffRide(role, actorId, { cancelled = false } = {}) {
  const since = new Date(Date.now() - HANDOFF_RIDE_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("rides")
    .select(HANDOFF_RIDE_COLUMNS)
    .eq(role === "driver" ? "driver_id" : "rider_id", String(actorId))
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(5);
  if (error) return null;
  return (data || []).find((r) => /cancel/i.test(String(r.status || "")) === cancelled) || null;
}

// A ride id sent with a report must be one of the account's own rides.
async function ownsHandoffRide(role, actorId, rideId) {
  const { data, error } = await supabase.from("rides").select(HANDOFF_RIDE_COLUMNS).eq("id", String(rideId)).maybeSingle();
  if (error || !data) return false;
  return String(role === "driver" ? data.driver_id : data.rider_id) === String(actorId);
}

async function runHandoffDraft(req, res, { role, actor }) {
  const state = await loadAgentState();
  if (!state.mode.assist_enabled) return fail(res, "The assistant is not available right now.", 503);
  const kind = handoffKind(req.body?.kind);
  // A lost item links the latest trip; a cancellation review the latest
  // cancelled ride, or the one the ride card named if it's the account's own.
  let ride = null;
  if (actor && kind === "lost_item") ride = await findHandoffRide(role, actor.id);
  if (actor && kind === "cancellation_review") {
    const named = cleanString(req.body?.ride_id, 100);
    if (named && (await ownsHandoffRide(role, actor.id, named))) {
      const { data } = await supabase.from("rides").select(HANDOFF_RIDE_COLUMNS).eq("id", named).maybeSingle();
      ride = data || null;
    }
    if (!ride) ride = await findHandoffRide(role, actor.id, { cancelled: true });
  }
  return ok(res, {
    signed_in: Boolean(actor),
    kind,
    draft: draftHandoffSummary({ context: req.body?.context, kind, role, ride }),
    ride: ride ? { id: ride.id, label: rideLabel(ride) } : null,
    note: "Review and edit this. Nothing is sent until you tap Send to support."
  });
}

// Saves the case, then emails a copy. Resolves to { saved, ... }.
async function saveHandoff(req, { role, actor, summary, kind, rideId, requestId, conversationId = null }) {
  const reference = newHandoffReference();
  const appTarget = agentAppTarget({ role, client: req.body?.client, platform: req.body?.platform, userAgent: req.get("user-agent") });
  const entry = handoffCaseEntry({ reference, role, actorId: actor.id, summary, appTarget, kind, rideId, requestId });
  // Counts the chat this request came from as one that needed staff.
  if (conversationId) entry.metadata.conversation_id = conversationId;
  const saved = await auditLog({ ...entry, req });
  if (!saved || saved.logged !== true) return { saved: false };
  const receivedAt = nowIso();
  // Email copy: its outcome is recorded on its own row whenever it
  // settles; the reply waits a few seconds for it, no longer.
  const emailDone = (async () => {
    let status;
    try {
      const mail = await sendEmail({
        to: HANDOFF_SUPPORT_EMAIL,
        subject: `Harvey Taxi ${kind === "lost_item" ? (role === "driver" ? "found-item report" : "lost-item report") : kind === "cancellation_review" ? "cancellation review request" : "support request"} ${reference}`,
        text:
          `Case: ${reference}\nType: ${kind}\nFrom: ${role} ${actor.id}\nApp: ${appTarget}\n` +
          (rideId ? `Ride: ${rideId}\n` : "") +
          `\n${summary}\n\nThe user reviewed and approved this text. Review and close the case in the Agent Command Center (human review cases).`
      });
      status = mail && mail.sent ? "accepted" : mail && mail.skipped ? "not_configured" : "failed";
    } catch (err) {
      status = "failed";
      console.warn("⚠️ Support handoff email failed:", reference, err && err.message ? err.message : "unknown error");
    }
    await auditLog(handoffEmailEntry({ reference, status, to: HANDOFF_SUPPORT_EMAIL }));
    return status;
  })();
  const email = await Promise.race([
    emailDone,
    new Promise((r) => {
      const timer = setTimeout(() => r("pending"), HANDOFF_EMAIL_WAIT_MS);
      if (timer.unref) timer.unref();
    })
  ]);
  return { saved: true, reference, receivedAt, kind, email };
}

function handoffReply(result, { duplicate }) {
  const lost = result.kind === "lost_item";
  return {
    sent: true,
    case_created: true,
    duplicate,
    reference: result.reference,
    kind: result.kind,
    received_at: result.receivedAt,
    // Separate from the case: "accepted" = the email service took it.
    email: { status: result.email },
    message:
      `Received. Your ${lost ? "report" : "request"} is in Harvey Taxi's support queue as case ${result.reference}.` +
      (duplicate ? " (This was already sent; no second case was created.)" : "")
  };
}

async function runHandoffSend(req, res, { role, actor }) {
  if (!actor) {
    return fail(res, "Please sign in to send a request, so support can reply to your account. You can also use the Support page.", 401);
  }
  const state = await loadAgentState();
  if (!state.mode.assist_enabled) return res.status(503).json({ ok: false, sent: false, error: HANDOFF_NOT_SENT });
  if (req.body?.approved !== true) {
    return fail(res, "Review the summary and confirm before sending.", 400);
  }
  const summary = cleanHandoffSummary(req.body?.summary);
  if (!summary.ok) return fail(res, summary.error, 400);
  const kind = handoffKind(req.body?.kind);
  const rideId = typeof req.body?.ride_id === "string" && req.body.ride_id.trim() ? req.body.ride_id.trim().slice(0, 80) : null;
  if (rideId && !(await ownsHandoffRide(role, actor.id, rideId))) {
    return fail(res, "That trip isn't on your account. Remove it or pick one of your own trips.", 400);
  }
  const requestId = typeof req.body?.request_id === "string" ? req.body.request_id : null;
  const account = `${role}:${actor.id}`;

  const earlier = handoffDeduper.find(account, requestId, summary.text);
  if (earlier) {
    const result = await earlier;
    if (result && result.saved) return ok(res, handoffReply(result, { duplicate: true }));
  }
  if (!handoffLimiter.allow(account)) {
    return res.status(429).json({ ok: false, sent: false, error: "You've sent several requests in the last hour. Support has them; please wait for a reply, or use the Support page." });
  }
  const conversationId = state.flags[AGENT_FEEDBACK_FLAG] === true ? cleanAgentConversationId(req.body?.conversation_id) : null;
  const pending = saveHandoff(req, { role, actor, summary: summary.text, kind, rideId, requestId, conversationId });
  handoffDeduper.track(account, requestId, summary.text, pending);
  const result = await pending;
  if (!result.saved) return res.status(503).json({ ok: false, sent: false, case_created: false, error: HANDOFF_NOT_SENT });
  return ok(res, handoffReply(result, { duplicate: false }));
}

/* =========================================================
   ANSWER RATINGS (lib/agent/feedback.js; off unless
   agent_feedback_enabled is "true")
   Thumbs up or down on one answer, by the person who got it, using the
   token returned with the answer. One audit row per rating, with no
   message text; a later rating of the same answer replaces the earlier
   one in the counts.
========================================================= */
const agentFeedbackRateLimit = rateLimit({ windowMs: 60_000, max: 30, keyPrefix: "agent_feedback" });

async function runAgentFeedback(req, res, { role, actor }) {
  const state = await loadAgentState();
  if (!state.mode.assist_enabled || state.flags[AGENT_FEEDBACK_FLAG] !== true || !agentFeedbackSigner) {
    return fail(res, "Ratings are not switched on.", 409);
  }
  const rating = req.body?.rating;
  if (!AGENT_FEEDBACK_RATINGS.includes(rating)) return fail(res, "rating must be up or down.", 400);
  const checked = agentFeedbackSigner.verify(req.body?.feedback_token);
  if (checked.error) {
    return fail(res, checked.error === "expired" ? "This answer can no longer be rated." : "This answer can't be rated.", 400);
  }
  const p = checked.payload;
  // Only the person who got the answer: same role, and the same signed-in
  // account when the answer was given to one.
  if (p.r !== role || (p.u && (!actor || String(actor.id) !== String(p.u)))) {
    return fail(res, "This answer can't be rated from this account.", 403);
  }
  const saved = await auditLog({ ...agentFeedbackEntry(p, rating), req });
  if (!saved || saved.logged !== true) return fail(res, "Your rating wasn't saved. Please try again.", 503);
  return ok(res, { saved: true, rating });
}

app.post(
  "/api/agent/rider/feedback",
  agentFeedbackRateLimit,
  asyncRoute(async (req, res) => {
    const rider = await resolveVerifiedRiderSession(req);
    return runAgentFeedback(req, res, { role: "rider", actor: rider ? { role: "rider", id: String(rider.id) } : null });
  })
);

app.post(
  "/api/agent/driver/feedback",
  agentFeedbackRateLimit,
  requireDriverSelf,
  asyncRoute(async (req, res) => runAgentFeedback(req, res, { role: "driver", actor: { role: "driver", id: String(req.driver.id) } }))
);

const handoffRateLimit = rateLimit({ windowMs: 60_000, max: 10, keyPrefix: "agent_handoff" });

app.post(
  "/api/agent/rider/handoff/draft",
  handoffRateLimit,
  asyncRoute(async (req, res) => {
    const rider = await resolveVerifiedRiderSession(req);
    return runHandoffDraft(req, res, { role: "rider", actor: rider ? { id: String(rider.id) } : null });
  })
);

app.post(
  "/api/agent/rider/handoff",
  handoffRateLimit,
  asyncRoute(async (req, res) => {
    const rider = await resolveVerifiedRiderSession(req);
    return runHandoffSend(req, res, { role: "rider", actor: rider ? { id: String(rider.id) } : null });
  })
);

app.post(
  "/api/agent/driver/handoff/draft",
  handoffRateLimit,
  requireDriverSelf,
  asyncRoute(async (req, res) => runHandoffDraft(req, res, { role: "driver", actor: { id: String(req.driver.id) } }))
);

app.post(
  "/api/agent/driver/handoff",
  handoffRateLimit,
  requireDriverSelf,
  asyncRoute(async (req, res) => runHandoffSend(req, res, { role: "driver", actor: { id: String(req.driver.id) } }))
);

const AGENT_ADMIN_ACTOR = Object.freeze({ role: "admin", id: "admin" });
const AGENT_LOG_ACTIONS = Object.values(AGENT_ACTIONS);

async function loadAgentSnapshot() {
  const trace = [];
  const [rides, drivers, busyDriverIds] = await Promise.all([
    agentTools.invoke("admin_open_rides", AGENT_ADMIN_ACTOR, {}, trace),
    agentTools.invoke("admin_candidate_drivers", AGENT_ADMIN_ACTOR, {}, trace),
    getBusyDriverIds({ supabase })
  ]);
  const offers = await agentTools.invoke("admin_ride_offers", AGENT_ADMIN_ACTOR, { rideIds: rides.map((r) => r.id) }, trace);
  return { rides, drivers, busyDriverIds, offers, trace };
}

app.get(
  "/api/admin/agent/overview",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const state = await loadAgentState();
    const modelStatus = agentLlm.status();
    let snapshot = null;
    let snapshotError = null;
    try {
      snapshot = await loadAgentSnapshot();
    } catch (err) {
      snapshotError = "Live ride and driver data could not be loaded.";
    }
    const [{ data: logRows }, { data: caseRows }] = await Promise.all([
      supabase
        .from("audit_logs")
        .select("id,actor_type,actor_id,action,entity_type,entity_id,metadata,created_at")
        .in("action", AGENT_LOG_ACTIONS.filter((a) => a !== AGENT_ACTIONS.CASE_OPENED && a !== AGENT_ACTIONS.CASE_RESOLVED && a !== AGENT_ACTIONS.HANDOFF_EMAIL))
        .order("created_at", { ascending: false })
        .limit(50),
      supabase
        .from("audit_logs")
        .select("id,actor_id,action,entity_id,metadata,created_at")
        .in("action", [AGENT_ACTIONS.CASE_OPENED, AGENT_ACTIONS.CASE_RESOLVED, AGENT_ACTIONS.HANDOFF_EMAIL])
        .order("created_at", { ascending: false })
        .limit(500)
    ]);
    const now = Date.now();
    let alerts = [];
    let counts = null;
    let stalledPlan = [];
    let driverRows = [];
    let rideRows = [];
    if (snapshot) {
      ({ alerts, counts } = buildAgentAlerts({ ...snapshot, rules: state.rules, now, dispatchPaused: state.dispatchPaused, modelStatus }));
      stalledPlan = planAgentStalledRides({ rides: snapshot.rides, offers: snapshot.offers, rules: state.rules, now, lastAgentRedispatchAt: agentRedispatchHistory });
      const busy = new Set(snapshot.busyDriverIds.map(String));
      driverRows = snapshot.drivers
        .filter((d) => !d.is_review_account)
        .map((d) => {
          const seen = Date.parse(d.last_location_at || d.last_seen_at || "");
          return {
            driver_id: String(d.id),
            label: agentDriverLabel(d),
            online: d.online === true || d.is_online === true,
            busy: busy.has(String(d.id)),
            compliance_ready: computeDriverReadiness(d, { enablePersona: ENABLE_PERSONA, enableCheckr: ENABLE_CHECKR }).ready,
            location_age_minutes: Number.isFinite(seen) ? Math.round((now - seen) / 60000) : null,
            rating: d.rating ?? null
          };
        })
        .sort((a, b) => Number(b.online) - Number(a.online) || Number(a.busy) - Number(b.busy));
      rideRows = snapshot.rides.map((r) => ({
        id: r.id,
        status: r.status,
        dispatch_status: r.dispatch_status || null,
        ride_type: r.ride_type || r.service_type || null,
        driver_name: r.driver_name || null,
        pickup_address: r.pickup_address || null,
        scheduled_time: r.scheduled_time || null,
        dispatch_attempts: r.dispatch_attempts || 0,
        is_review_ride: Boolean(r.is_review_ride),
        updated_at: r.updated_at || null
      }));
    }
    return ok(res, {
      mode: state.mode,
      flags: state.flags,
      flags_read_ok: state.ok,
      dispatch_paused: state.dispatchPaused,
      rules: state.rules,
      rule_bounds: AGENT_RULE_BOUNDS,
      model: modelStatus,
      admin_can_enable_automation: req.admin.method === "admin_token",
      counts,
      alerts,
      snapshot_error: snapshotError,
      active_rides: rideRows,
      drivers: driverRows,
      recommendations: stalledPlan,
      decisions: logRows || [],
      cases: summarizeAgentCases(caseRows || [])
    });
  })
);

app.get(
  "/api/admin/agent/rides/:id/recommendations",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const state = await loadAgentState();
    if (!state.mode.recommendations_enabled) {
      return fail(res, "The agent kill switch is engaged.", 409);
    }
    const rideId = cleanString(req.params.id, 100);
    const trace = [];
    const [ride] = await agentTools.invoke("admin_ride", AGENT_ADMIN_ACTOR, { rideId }, trace);
    if (!ride) {
      return fail(res, "Ride not found.", 404);
    }
    const [drivers, busyDriverIds, offers] = await Promise.all([
      agentTools.invoke("admin_candidate_drivers", AGENT_ADMIN_ACTOR, {}, trace),
      getBusyDriverIds({ supabase }),
      agentTools.invoke("admin_ride_offers", AGENT_ADMIN_ACTOR, { rideIds: [ride.id] }, trace)
    ]);
    const recommendation = recommendAgentDrivers({
      ride,
      drivers,
      busyDriverIds,
      offeredDriverIds: offers.map((o) => o.driver_id),
      rules: state.rules,
      complianceOptions: { enablePersona: ENABLE_PERSONA, enableCheckr: ENABLE_CHECKR }
    });
    agentAudit(
      {
        actor_type: "agent",
        actor_id: "agent-manager",
        action: AGENT_ACTIONS.RECOMMENDATION,
        entity_type: "ride",
        entity_id: String(ride.id),
        metadata: {
          record_type: AGENT_RECORD_TYPES.RECOMMENDATION,
          policy: "recommend.eligible_nearest",
          requested_by: req.admin.email,
          candidate_driver_ids: recommendation.eligible.map((c) => c.driver_id),
          excluded_count: recommendation.excluded.length,
          tool_calls: cleanAgentToolCalls(trace),
          executed: false
        }
      },
      req
    );
    return ok(res, { ride: { id: ride.id, status: ride.status, ride_type: ride.ride_type || null }, recommendation });
  })
);

// Agent hierarchy: the original agents (chiefs) and their specialists,
// with each specialist's switch and whether it is answering right now.
app.get(
  "/api/admin/agent/specialists",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const state = await loadAgentState();
    const htafEnabled = await htafAssistEnabled().catch(() => false);
    return ok(res, {
      kill_switch: state.mode.kill_switch,
      assist_enabled: state.mode.assist_enabled,
      htaf_assist_enabled: htafEnabled,
      // Who switched-on specialists answer: off, test_accounts or all.
      specialist_scope: state.model.specialist_scope,
      chiefs: agentSpecialists.hierarchy({ mode: state.mode, flags: state.flags, htafEnabled })
    });
  })
);

app.post(
  "/api/admin/agent/flags",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const key = cleanString(req.body?.key, 80);
    const check = evaluateAgentFlagChange({ key, enable: req.body?.enabled, adminMethod: req.admin.method });
    if (!check.ok) {
      return fail(res, check.error, check.status);
    }
    const before = await loadAgentState();
    const reason = cleanString(req.body?.reason, 300);
    const { error } = await supabase
      .from("system_flags")
      .upsert({ key, value: check.value, reason: reason || null, updated_at: nowIso() });
    if (error) {
      return fail(res, "The flag could not be saved. Nothing was changed.", 500);
    }
    const after = await loadAgentState();
    await agentAudit(
      {
        actor_type: "admin",
        actor_id: req.admin.email,
        action: AGENT_ACTIONS.FLAG_CHANGED,
        entity_type: "system_flag",
        entity_id: key,
        metadata: {
          record_type: AGENT_RECORD_TYPES.ADMIN,
          value: check.value,
          reason: reason || null,
          admin_method: req.admin.method,
          mode_before: before.mode.mode,
          mode_after: after.mode.mode,
          human_override: true
        }
      },
      req
    );
    return ok(res, { key, value: check.value, mode: after.mode, flags: after.flags });
  })
);

app.post(
  "/api/admin/agent/rules",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const check = validateAgentRules(req.body?.rules, { partial: true });
    if (!check.ok) {
      return res.status(400).json({ ok: false, error: "Invalid rules.", errors: check.errors });
    }
    const before = await loadAgentState();
    const rules = { ...before.rules, ...check.rules };
    const { error } = await supabase
      .from("system_flags")
      .upsert({ key: AGENT_FLAG_KEYS.RULES, value: JSON.stringify(rules), reason: "agent rules update", updated_at: nowIso() });
    if (error) {
      return fail(res, "The rules could not be saved. Nothing was changed.", 500);
    }
    await agentAudit(
      {
        actor_type: "admin",
        actor_id: req.admin.email,
        action: AGENT_ACTIONS.RULES_CHANGED,
        entity_type: "system_flag",
        entity_id: AGENT_FLAG_KEYS.RULES,
        metadata: { record_type: AGENT_RECORD_TYPES.ADMIN, before: before.rules, after: rules, human_override: true }
      },
      req
    );
    return ok(res, { rules });
  })
);

// Assistant usage for the admin dashboard (docs/ai-usage.md): today's
// live counters plus a 7-day summary of the audit trail. One query, only
// when an admin opens the page.
app.get(
  "/api/admin/agent/usage",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const state = await loadAgentState();
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const { data, error } = await supabase
      .from("audit_logs")
      .select("created_at, action, actor_type, actor_id, metadata")
      .in("action", [AGENT_ACTIONS.DECISION, AGENT_ACTIONS.USAGE_LIMITED])
      .gte("created_at", `${since}T00:00:00.000Z`)
      .order("created_at", { ascending: false })
      .limit(20000);
    if (error) {
      return fail(res, "Usage history is unavailable right now.", 503);
    }
    return ok(res, {
      measured: modelMeasuredText(state),
      model: modelStatus(state),
      limits: {
        per_account_daily: state.rules.assist_daily_limit_per_account,
        visitor_daily: state.rules.assist_daily_limit_visitor,
        global_daily: state.rules.assist_daily_limit_global
      },
      today_live: agentUsage.snapshot(),
      history: summarizeAgentUsage(data || [], { days: 7 }),
      history_truncated: (data || []).length >= 20000
    });
  })
);

// Ratings and "resolved without staff" for the last 1-30 days (default 7).
app.get(
  "/api/admin/agent/feedback",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const state = await loadAgentState();
    const days = Math.min(30, Math.max(1, Math.floor(Number(req.query.days) || 7)));
    const since = new Date(Date.now() - (days - 1) * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const { data, error } = await supabase
      .from("audit_logs")
      .select("created_at, action, entity_id, metadata")
      .in("action", [AGENT_ACTIONS.DECISION, AGENT_ACTIONS.CASE_OPENED, AGENT_FEEDBACK_ACTION])
      .gte("created_at", `${since}T00:00:00.000Z`)
      .order("created_at", { ascending: false })
      .limit(20000);
    if (error) return fail(res, "Ratings are unavailable right now.", 503);
    return ok(res, {
      enabled: state.flags[AGENT_FEEDBACK_FLAG] === true,
      signer_configured: Boolean(agentFeedbackSigner),
      measured:
        "Thumbs up/down are counted once per answer (the latest rating wins). A conversation is one web assistant chat, until Clear chat or sign-out; " +
        "it needed staff if an answer in it opened a safety or review case or a support request was sent from it. " +
        "Answers from clients that don't send a conversation id (driver app builds, older pages) are untracked, not counted as resolved.",
      ...summarizeAgentFeedback(data || [], { days }),
      truncated: (data || []).length >= 20000
    });
  })
);

/* =========================================================
   CLAUDE MODEL ADMIN (docs/ai-model.md)
   Status, mode (off / test_accounts / all) and the synthetic test-account
   list. "all" is refused until the owner approves the privacy disclosure
   and sets AGENT_MODEL_PUBLIC_APPROVED=true. The admin "Try" console runs
   one question as a listed test account, through the same budget.
========================================================= */
function modelStatus(state) {
  return {
    provider: "anthropic",
    model: claudeConfig.model,
    configured: claudeConfig.configured,
    workspace_header: Boolean(claudeConfig.workspaceId),
    problem: claudeConfig.problem,
    mode: state.model.mode,
    stored_mode: state.model.stored_mode,
    public_approved: state.model.public_approved,
    consent_ready: state.model.consent_ready,
    test_accounts: state.model.test_accounts,
    driver_scope: state.model.driver_scope,
    specialist_scope: state.model.specialist_scope,
    budget: modelBudget.status()
  };
}

function modelMeasuredText(state) {
  if (!claudeConfig.configured || state.model.mode === "off") {
    return "Assistant requests (questions sent to the rider or driver assistant). The Claude model is off, so every answer is rules-based and no model tokens are used.";
  }
  return `Assistant requests, plus model tokens and cost for requests the Claude model handled (${state.model.mode === "all" ? "all signed-in riders and drivers" : "listed test accounts only"}). Tokens are reported by Anthropic per call; cost is computed by Harvey from the published price.`;
}

app.get(
  "/api/admin/agent/model",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const state = await loadAgentState();
    await modelBudget.refresh();
    return ok(res, modelStatus(state));
  })
);

app.post(
  "/api/admin/agent/model",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const check = validateModelSettings({
      mode: req.body?.mode,
      testAccounts: req.body?.test_accounts,
      driverScope: req.body?.driver_scope,
      specialistScope: req.body?.specialist_scope
    });
    if (!check.ok) return fail(res, check.error, 400);
    const rows = [];
    if (check.value.mode !== undefined) rows.push({ key: MODEL_FLAG_KEYS.MODE, value: check.value.mode });
    if (check.value.testAccounts !== undefined) rows.push({ key: MODEL_FLAG_KEYS.TEST_ACCOUNTS, value: JSON.stringify(check.value.testAccounts) });
    if (check.value.driverScope !== undefined) rows.push({ key: MODEL_FLAG_KEYS.DRIVER_SCOPE, value: check.value.driverScope });
    if (check.value.specialistScope !== undefined) rows.push({ key: MODEL_FLAG_KEYS.SPECIALIST_SCOPE, value: check.value.specialistScope });
    if (!rows.length) return fail(res, "Nothing to change.", 400);
    for (const row of rows) {
      const { error } = await supabase.from("system_flags").upsert({ ...row, reason: "admin model settings", updated_at: nowIso() });
      if (error) return fail(res, "The model settings could not be saved. Nothing else was changed.", 500);
    }
    await agentAudit(
      {
        actor_type: "admin",
        actor_id: req.admin.email,
        action: AGENT_ACTIONS.FLAG_CHANGED,
        entity_type: "system_flag",
        entity_id: rows.map((r) => r.key).join(","),
        metadata: {
          record_type: AGENT_RECORD_TYPES.ADMIN,
          model_mode: check.value.mode ?? null,
          test_accounts: check.value.testAccounts ?? null,
          driver_scope: check.value.driverScope ?? null,
          specialist_scope: check.value.specialistScope ?? null
        }
      },
      req
    );
    const state = await loadAgentState();
    return ok(res, modelStatus(state));
  })
);

app.post(
  "/api/admin/agent/model/try",
  requireAdmin,
  rateLimit({ windowMs: 60_000, max: 10, keyPrefix: "agent_model_try" }),
  asyncRoute(async (req, res) => {
    const role = req.body?.role === "driver" ? "driver" : "rider";
    const actorId = cleanString(req.body?.actor_id, 80);
    const message = typeof req.body?.message === "string" ? req.body.message : "";
    if (!actorId || !message.trim()) return fail(res, "role, actor_id and message are required.", 400);
    const state = await loadAgentState();
    if (!state.mode.assist_enabled) return fail(res, "The assistant is switched off.", 409);
    if (!state.model.consent_ready) {
      return fail(res, "AI answers are off until the consent step is live (AGENT_MODEL_CONSENT_READY).", 409);
    }
    if (!state.model.test_accounts.includes(`${role}:${actorId}`)) {
      return fail(res, "Only accounts on the model test list can be tried here.", 403);
    }
    // Same path as the apps, with the model forced on for this listed test
    // account even if the mode is off, and the same budget.
    const tryState = { ...state, model: { ...state.model, mode: "test_accounts" } };
    const client = role === "driver" && req.body?.client === "driver_app" ? "driver_app" : "web";
    const actor = { role, id: actorId };
    const model = await runModelTurn({ state: tryState, role, actor, message, client, context: Array.isArray(req.body?.context) ? req.body.context : [], appTarget: "admin_try" });
    const result =
      model.result ||
      (await handleAgentAssist({ role, actor, message, tools: agentTools, llm: null, client, context: [], knowledgeIndex: knowledgeStore.getIndex() }));
    agentAudit(agentAssistDecisionEntry({ role, actorId, result, mode: state.mode.mode, message, appTarget: "admin_try", model: model.record }), req);
    await modelBudget.refresh();
    return ok(res, {
      reply: result.reply,
      source: result.source,
      intent: result.intent,
      actions: result.actions,
      sources: result.sources || [],
      model: model.record,
      budget: modelBudget.status()
    });
  })
);

// Free connection check: sends the exact first request a rider and a
// driver answer would send to Anthropic's token-counting endpoint, which
// checks the key and the request without generating text or billing.
// A request that counts fine but is refused when answering points to the
// account (for example no credit), not to Harvey's request.
app.post(
  "/api/admin/agent/model/diagnose",
  requireAdmin,
  rateLimit({ windowMs: 60_000, max: 5, keyPrefix: "agent_model_diagnose" }),
  asyncRoute(async (req, res) => {
    if (!claude) return ok(res, { configured: false, checks: [] });
    const checks = [];
    for (const [role, message] of [["rider", "Where is my ride?"], ["driver", "How many hours have I driven today?"]]) {
      const out = await claude.countTokens(firstRequest(role, message));
      checks.push(out.error ? { role, ok: false, reason: out.error, provider_error: out.provider || null } : { role, ok: true, input_tokens: out.input_tokens });
    }
    return ok(res, { configured: true, model: claude.model, billed: false, checks });
  })
);

/* =========================================================
   KNOWLEDGE ARTICLES (docs/ai-knowledge.md, phase 2)
   Admin-managed approved text the assistant may quote. Draft -> approved
   by an admin; any edit returns it to draft. Approved articles are public
   on /policies.html (the assistant's source link).
========================================================= */
const KNOWLEDGE_ARTICLE_COLUMNS = "id, slug, title, body, audience, status, version, created_by, updated_by, approved_by, approved_at, created_at, updated_at";

function validateArticleInput(body, { partial = false } = {}) {
  const errors = [];
  const out = {};
  if (!partial || body.slug !== undefined) {
    const slug = String(body.slug || "").trim().toLowerCase();
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) || slug.length > 80) errors.push("slug: lowercase letters, numbers and dashes, up to 80.");
    else out.slug = slug;
  }
  if (!partial || body.title !== undefined) {
    const title = cleanString(body.title, 140);
    if (!title || title.length < 3) errors.push("title: 3 to 140 characters.");
    else out.title = title;
  }
  if (!partial || body.body !== undefined) {
    const text = String(body.body || "").replace(/\r\n/g, "\n").trim();
    if (text.length < 20 || text.length > 4000) errors.push("body: 20 to 4,000 characters.");
    else out.body = text;
  }
  if (!partial || body.audience !== undefined) {
    const audience = Array.isArray(body.audience) ? [...new Set(body.audience.map(String))] : [];
    if (!audience.length || audience.some((a) => !["rider", "driver"].includes(a))) errors.push("audience: rider and/or driver.");
    else out.audience = audience;
  }
  return { ok: errors.length === 0, errors, value: out };
}

// Approved articles whose titles share most words with this one: shown to
// the admin as a possible duplicate or conflict before it goes live.
function articleOverlaps(article, approved) {
  const words = (t) => new Set(String(t).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2));
  const mine = words(article.title);
  return approved
    .filter((a) => a.slug !== article.slug)
    .filter((a) => {
      const theirs = words(a.title);
      const shared = [...mine].filter((w) => theirs.has(w)).length;
      return mine.size && shared / Math.min(mine.size, theirs.size || 1) >= 0.5;
    })
    .map((a) => ({ slug: a.slug, title: a.title }));
}

function knowledgeAudit(req, action, article, metadata = {}) {
  return auditLog({
    actor_type: "admin",
    actor_id: req.admin ? req.admin.email || req.admin.id : null,
    action,
    entity_type: "knowledge_article",
    entity_id: article ? String(article.id) : null,
    metadata: { slug: article ? article.slug : null, version: article ? article.version : null, ...metadata },
    req
  }).catch(() => {});
}

// Public: approved articles only (cached; no database read per request).
app.get(
  "/api/knowledge/articles",
  rateLimit({ windowMs: 60_000, max: 60, keyPrefix: "knowledge_public" }),
  (req, res) => {
    res.setHeader("Cache-Control", "public, max-age=120");
    return ok(res, { articles: knowledgeStore.approved() });
  }
);

app.get(
  "/api/admin/knowledge",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const { data, error } = await supabase.from("knowledge_articles").select(KNOWLEDGE_ARTICLE_COLUMNS).order("updated_at", { ascending: false }).limit(500);
    if (error) return fail(res, "Knowledge articles are unavailable right now.", 503);
    return ok(res, { articles: data || [], index: knowledgeStore.status() });
  })
);

app.post(
  "/api/admin/knowledge",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const check = validateArticleInput(req.body || {});
    if (!check.ok) return res.status(400).json({ ok: false, error: "Invalid article.", errors: check.errors });
    const who = req.admin.email || req.admin.id;
    const { data, error } = await supabase
      .from("knowledge_articles")
      .insert({ ...check.value, status: "draft", version: 1, created_by: who, updated_by: who, approved_by: null, approved_at: null })
      .select(KNOWLEDGE_ARTICLE_COLUMNS)
      .single();
    if (error) {
      const dup = /duplicate|unique/i.test(error.message || "");
      return fail(res, dup ? "An article with that slug already exists." : "The article could not be saved.", dup ? 409 : 500);
    }
    await knowledgeAudit(req, "knowledge.article_created", data);
    return ok(res, { article: data, overlaps: articleOverlaps(data, knowledgeStore.approved()) }, 201);
  })
);

async function loadArticle(rawId) {
  const id = Number(rawId);
  if (!Number.isSafeInteger(id) || id < 1) return null;
  const { data, error } = await supabase.from("knowledge_articles").select(KNOWLEDGE_ARTICLE_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw error;
  return data;
}

app.patch(
  "/api/admin/knowledge/:id",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const article = await loadArticle(req.params.id);
    if (!article) return fail(res, "Article not found.", 404);
    if (article.status === "retired") return fail(res, "Retired articles can't be edited. Create a new one.", 409);
    const body = { ...(req.body || {}) };
    delete body.slug;
    const check = validateArticleInput(body, { partial: true });
    if (!check.ok) return res.status(400).json({ ok: false, error: "Invalid article.", errors: check.errors });
    // Any edit needs approval again before the assistant uses it.
    const patch = { ...check.value, status: "draft", version: article.version + 1, approved_by: null, approved_at: null, updated_by: req.admin.email || req.admin.id, updated_at: nowIso() };
    const wasApproved = article.status === "approved";
    const { data, error } = await supabase.from("knowledge_articles").update(patch).eq("id", article.id).eq("version", article.version).select(KNOWLEDGE_ARTICLE_COLUMNS);
    if (error) return fail(res, "The article could not be saved.", 500);
    if (!data || !data.length) return fail(res, "The article changed while you were editing. Reload and try again.", 409);
    await knowledgeAudit(req, "knowledge.article_edited", data[0], { was_approved: wasApproved });
    if (wasApproved) await knowledgeStore.refresh();
    return ok(res, { article: data[0] });
  })
);

app.post(
  "/api/admin/knowledge/:id/approve",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const article = await loadArticle(req.params.id);
    if (!article) return fail(res, "Article not found.", 404);
    if (article.status !== "draft") return fail(res, `Only drafts can be approved (this one is ${article.status}).`, 409);
    if (Number(req.body?.version) !== article.version) {
      return fail(res, "This article changed since you reviewed it. Reload, review and approve again.", 409, { current_version: article.version });
    }
    const { data, error } = await supabase
      .from("knowledge_articles")
      .update({ status: "approved", approved_by: req.admin.email || req.admin.id, approved_at: nowIso(), updated_at: nowIso() })
      .eq("id", article.id)
      .eq("version", article.version)
      .eq("status", "draft")
      .select(KNOWLEDGE_ARTICLE_COLUMNS);
    if (error) return fail(res, "The article could not be approved.", 500);
    if (!data || !data.length) return fail(res, "The article changed while you were approving it. Reload and try again.", 409);
    const overlaps = articleOverlaps(data[0], knowledgeStore.approved());
    await knowledgeAudit(req, "knowledge.article_approved", data[0], { overlaps: overlaps.map((o) => o.slug) });
    await knowledgeStore.refresh();
    return ok(res, { article: data[0], overlaps });
  })
);

app.post(
  "/api/admin/knowledge/:id/retire",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const article = await loadArticle(req.params.id);
    if (!article) return fail(res, "Article not found.", 404);
    if (article.status === "retired") return ok(res, { article });
    const previousStatus = article.status;
    const { data, error } = await supabase
      .from("knowledge_articles")
      .update({ status: "retired", updated_by: req.admin.email || req.admin.id, updated_at: nowIso() })
      .eq("id", article.id)
      .select(KNOWLEDGE_ARTICLE_COLUMNS);
    if (error || !data || !data.length) return fail(res, "The article could not be retired.", 500);
    await knowledgeAudit(req, "knowledge.article_retired", data[0], { was: previousStatus });
    if (previousStatus === "approved") await knowledgeStore.refresh();
    return ok(res, { article: data[0] });
  })
);

const AGENT_CASE_RESOLUTIONS = Object.freeze(["resolved", "referred_to_support", "no_action_needed", "escalated_externally"]);

app.post(
  "/api/admin/agent/cases/:id/resolve",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const caseId = cleanString(req.params.id, 40);
    const resolution = cleanString(req.body?.resolution, 40);
    if (!AGENT_CASE_RESOLUTIONS.includes(resolution)) {
      return fail(res, `resolution must be one of: ${AGENT_CASE_RESOLUTIONS.join(", ")}.`, 400);
    }
    const { data: rows, error } = await supabase
      .from("audit_logs")
      .select("action,entity_id")
      .eq("entity_type", "agent_case")
      .eq("entity_id", caseId);
    if (error) {
      return fail(res, "Case data is temporarily unavailable.", 503);
    }
    if (!(rows || []).some((r) => r.action === AGENT_ACTIONS.CASE_OPENED)) {
      return fail(res, "Case not found.", 404);
    }
    if ((rows || []).some((r) => r.action === AGENT_ACTIONS.CASE_RESOLVED)) {
      return fail(res, "Case is already resolved.", 409);
    }
    await agentAudit(agentCaseResolvedEntry({ caseId, admin: req.admin, resolution, note: req.body?.note }), req);
    return ok(res, { case_id: caseId, status: "resolved", resolution });
  })
);

app.post(
  "/api/admin/agent/overrides",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const rideId = cleanString(req.body?.ride_id, 100);
    const decision = cleanString(req.body?.decision, 40);
    if (!rideId || !["accepted_recommendation", "rejected_recommendation", "manual_assignment"].includes(decision)) {
      return fail(res, "ride_id and a valid decision are required.", 400);
    }
    await agentAudit(
      {
        actor_type: "admin",
        actor_id: req.admin.email,
        action: AGENT_ACTIONS.OVERRIDE,
        entity_type: "ride",
        entity_id: rideId,
        metadata: {
          record_type: AGENT_RECORD_TYPES.ADMIN,
          decision,
          driver_id: cleanString(req.body?.driver_id, 100) || null,
          note: agentRedactForLog(req.body?.note || "", 300),
          human_override: true
        }
      },
      req
    );
    return ok(res, { recorded: true });
  })
);

// One coordination pass. In "shadow" mode it only records what it would
// have done. In "automation" mode (OFF in this release) it executes a
// planned redispatch through the existing dispatchRide(), after an
// optimistic claim that fails if anything else touched the ride.
// forceShadow: an admin's manual "evaluate now" -- never executes.
// Fresh read before each automated action (see the sweep below).
async function agentAutomationStillAllowed() {
  const state = await loadAgentState();
  return state.ok && state.mode.auto_redispatch_enabled === true;
}

async function runAgentCoordinationSweep({ forceShadow = false } = {}) {
  if (agentSweepRunning) return { skipped: "already_running" };
  agentSweepRunning = true;
  try {
    const state = await loadAgentState();
    const execute = !forceShadow && state.mode.auto_redispatch_enabled;
    if (!forceShadow && !execute && !state.mode.shadow_enabled) {
      return { skipped: `mode_${state.mode.mode}` };
    }
    const snapshot = await loadAgentSnapshot();
    const now = Date.now();
    const plan = planAgentStalledRides({ rides: snapshot.rides, offers: snapshot.offers, rules: state.rules, now, lastAgentRedispatchAt: agentRedispatchHistory });
    const outcomes = [];
    for (const item of plan) {
      const ride = snapshot.rides.find((r) => String(r.id) === item.ride_id);
      if (item.decision === "escalate") {
        // One case per ride, across instances and restarts: the case id is
        // derived from the ride, and an existing case row is checked first.
        if (!agentEscalatedRides.has(item.ride_id)) {
          const caseId = `CASE-DISPATCH-${item.ride_id}`.slice(0, 40);
          const { data: existingCase } = await supabase
            .from("audit_logs")
            .select("id")
            .eq("action", AGENT_ACTIONS.CASE_OPENED)
            .eq("entity_id", caseId)
            .limit(1);
          if (!(existingCase || []).length) {
            await openAgentCase({
              role: "system",
              actorId: null,
              escalation: { category: "dispatch_exhausted", severity: "high" },
              message: `Ride waiting after ${item.attempts} dispatch attempts; needs a dispatcher.`,
              source: "coordination",
              rideId: item.ride_id,
              caseId
            });
          }
          agentEscalatedRides.add(item.ride_id);
        }
        outcomes.push({ ...item, executed: false });
        continue;
      }
      if (item.decision !== "redispatch") {
        outcomes.push({ ...item, executed: false });
        continue;
      }
      const recommendation = recommendAgentDrivers({
        ride,
        drivers: snapshot.drivers,
        busyDriverIds: snapshot.busyDriverIds,
        offeredDriverIds: snapshot.offers.filter((o) => String(o.ride_id) === item.ride_id).map((o) => o.driver_id),
        rules: state.rules,
        complianceOptions: { enablePersona: ENABLE_PERSONA, enableCheckr: ENABLE_CHECKR },
        now
      });
      const candidateIds = recommendation.eligible.map((c) => c.driver_id);
      if (!execute) {
        const lastLogged = agentShadowLogged.get(item.ride_id) || 0;
        if (forceShadow || now - lastLogged > state.rules.redispatch_cooldown_seconds * 1000) {
          agentShadowLogged.set(item.ride_id, now);
          await agentAudit({
            actor_type: "agent",
            actor_id: "agent-manager",
            action: AGENT_ACTIONS.SHADOW,
            entity_type: "ride",
            entity_id: item.ride_id,
            metadata: {
              record_type: AGENT_RECORD_TYPES.SHADOW,
              policy: "coordination.redispatch_stalled",
              would_do: "redispatch",
              reason: item.reason,
              candidate_driver_ids: candidateIds,
              executed: false,
              trigger: forceShadow ? "admin_manual_evaluation" : "shadow_sweep"
            }
          });
        }
        outcomes.push({ ...item, decision: "would_redispatch", candidate_driver_ids: candidateIds, executed: false });
        continue;
      }
      // Automation path.
      //
      // Kill switch: the agent's state is re-read from the database before
      // every action (not once per sweep), so engaging the kill switch, or
      // turning any automation flag off, pausing dispatch or turning shadow
      // mode on, stops the very next action on every server instance. The
      // remaining planned items of this sweep are dropped, not executed.
      if (!(await agentAutomationStillAllowed())) {
        outcomes.push({ ...item, decision: "skipped", reason: "automation_stopped", executed: false });
        break;
      }
      // Duplicate protection is in the database, not in this process: the
      // claim only succeeds if the ride is still paid, unassigned and
      // unchanged since the snapshot (updated_at), so of any number of
      // concurrent sweeps -- here or on other instances -- at most one
      // claims a ride. last_dispatch_at carries the cooldown across
      // instances and restarts. dispatch_status "redispatching" +
      // dispatch_claimed_at hand a crash mid-dispatch to the existing
      // stuck-redispatch recovery.
      const claimedAt = nowIso();
      const { data: claimedRows, error: claimError } = await supabase
        .from("rides")
        .update({ dispatch_status: "redispatching", dispatch_claimed_at: claimedAt, last_dispatch_at: claimedAt, updated_at: claimedAt })
        .eq("id", item.ride_id)
        .eq("status", RIDE_STATUS.PAYMENT_AUTHORIZED)
        .is("driver_id", null)
        .eq("updated_at", item.observed_updated_at)
        .select("id,status,pickup_address,pickup_lat,pickup_lng,ride_type,rider_id,rider_phone,is_review_ride,scheduled_time,dispatch_attempts");
      const claimed = !claimError && Array.isArray(claimedRows) ? claimedRows[0] : null;
      if (!claimed) {
        outcomes.push({ ...item, decision: "skipped", reason: "ride_changed_or_claimed_elsewhere", executed: false });
        continue;
      }
      agentRedispatchHistory.set(item.ride_id, now);
      // Last check between claim and dispatch. If automation was stopped in
      // that window, hand the ride back exactly as it was (so neither this
      // agent nor the stuck-redispatch recovery dispatches it) and stop.
      if (!(await agentAutomationStillAllowed())) {
        await supabase
          .from("rides")
          .update({ dispatch_status: item.previous_dispatch_status, dispatch_claimed_at: null })
          .eq("id", item.ride_id)
          .eq("dispatch_status", "redispatching")
          .eq("dispatch_claimed_at", claimedAt);
        outcomes.push({ ...item, decision: "skipped", reason: "automation_stopped", executed: false });
        break;
      }
      let dispatchResult;
      try {
        dispatchResult = await dispatchRide(claimed);
      } catch (err) {
        dispatchResult = { dispatched: false, reason: "dispatch_error" };
      }
      // Verify against the database rather than trusting the return value.
      const [{ data: afterRide }, { data: afterOffers }] = await Promise.all([
        supabase.from("rides").select("id,status,dispatch_status,driver_id").eq("id", item.ride_id).maybeSingle(),
        supabase.from("driver_offers").select("id,status").eq("ride_id", item.ride_id).eq("status", "pending")
      ]);
      const verified = {
        ride_status: afterRide ? afterRide.status : null,
        pending_offers: (afterOffers || []).length,
        driver_assigned: Boolean(afterRide && afterRide.driver_id)
      };
      const dispatchedVerified = verified.pending_offers > 0 || verified.driver_assigned;
      await agentAudit({
        actor_type: "agent",
        actor_id: "agent-manager",
        action: AGENT_ACTIONS.EXECUTED,
        entity_type: "ride",
        entity_id: item.ride_id,
        metadata: {
          record_type: AGENT_RECORD_TYPES.EXECUTED,
          policy: "coordination.redispatch_stalled",
          action: "redispatch_via_dispatchRide",
          reason: item.reason,
          dispatched: dispatchedVerified,
          reported_by_dispatch: Boolean(dispatchResult && dispatchResult.dispatched),
          verified,
          dispatch_reason: dispatchResult && dispatchResult.reason ? String(dispatchResult.reason).slice(0, 120) : null,
          executed: true
        }
      });
      outcomes.push({ ...item, decision: "redispatched", dispatched: dispatchedVerified, verified, executed: true });
    }
    return { mode: forceShadow ? "manual_shadow" : state.mode.mode, outcomes };
  } catch (err) {
    console.error("⚠️ Agent coordination sweep failed:", err && err.message ? err.message : err);
    return { error: "sweep_failed" };
  } finally {
    agentSweepRunning = false;
  }
}

app.post(
  "/api/admin/agent/model/check",
  requireAdmin,
  asyncRoute(async (req, res) => {
    await agentLlm.healthCheck();
    return ok(res, { model: agentLlm.status() });
  })
);

app.post(
  "/api/admin/agent/evaluate",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const state = await loadAgentState();
    if (state.mode.kill_switch) {
      return fail(res, "The agent kill switch is engaged.", 409);
    }
    const result = await runAgentCoordinationSweep({ forceShadow: true });
    if (result.error) {
      return fail(res, "Evaluation failed; no action was taken.", 503);
    }
    if (result.skipped) {
      return fail(res, "An evaluation is already running.", 409);
    }
    return ok(res, result);
  })
);

app.get(
  "/admin-agent",
  (req, res) => sendStaticPage(res, "admin-agent.html")
);

app.get(
  "/admin-knowledge",
  (req, res) => sendStaticPage(res, "admin-knowledge.html")
);


/* =========================================================
   PAYMENT RECORDS AND UNUSED CARD HOLDS
   See lib/unusedHolds.js and docs/unused-card-holds.md.
   - persistCreatedPaymentRecord(): payments row for a new PaymentIntent,
     written before its client secret is returned.
   - reconcileStripeHolds(): Stripe-side reconciliation of holds.
   - bindPaymentRecordToRide(): makes rides.payment_id's foreign key
     satisfiable and claims the hold for the ride.
   - releaseUnusedHold(): cancels an uncaptured hold that never became a
     ride, for its owner or the sweep. Both entry points are off unless
     their system flag is "true".
========================================================= */
// Redacted operational alert: an allow-listed payload (never a client
// secret, card detail or contact detail) to the server log, the audit trail
// and, best effort, the admin inbox.
async function paymentOpsAlert(event, fields) {
  const alert = buildPaymentOpsAlert(event, fields);
  console.error("🚨 PAYMENT_OPS_ALERT", JSON.stringify(alert));
  await auditLog({ action: `payment_ops_alert_${alert.event}`, actor_type: "system", actor_id: "payments", metadata: alert }).catch(() => {});
  await sendEmail({
    to: ADMIN_EMAIL,
    subject: `Harvey Taxi payment alert: ${alert.event}`,
    text: Object.entries(alert).map(([k, v]) => `${k}: ${v}`).join("\n")
  }).catch(() => {});
  return alert;
}

// The payments row for a newly created PaymentIntent, written before the
// client secret is returned. A duplicate request (same Stripe idempotency
// key -> same intent) finds its own row and succeeds; a row that has moved
// on (in release, or released) is not reused.
async function persistCreatedPaymentRecord({ intent, riderId, rideType, stripeCustomerId }) {
  let error;
  try {
    ({ error } = await supabase
      .from("payments")
      .insert(buildCreatedPaymentRecord({ intent, riderId, rideType, stripeCustomerId })));
  } catch (err) {
    error = err || { code: "exception" };
  }
  if (!error) return { ok: true };
  if (error.code === "23505") {
    const { data: existing, error: readError } = await supabase.from("payments").select("id,status").eq("id", intent.id).maybeSingle();
    if (readError || !existing) return { ok: false, reason: "record_unreadable" };
    if (BINDABLE_RECORD_STATUSES.includes(existing.status)) return { ok: true, duplicate: true };
    return { ok: false, reason: "record_not_reusable" };
  }
  return { ok: false, reason: "record_write_failed" };
}

// Persistence failed: the intent must not be used. Cancel it; if Stripe
// can't cancel it either, raise an alert. Its app/account metadata lets
// reconciliation (reconcileStripeHolds) find and record it later.
async function abandonUntrackedIntent(intent) {
  try {
    await stripe.paymentIntents.cancel(intent.id, { cancellation_reason: "abandoned" }, { idempotencyKey: `harvey-untracked-cancel-${intent.id}` });
    console.warn("⚠️ Payment record not written; new PaymentIntent cancelled:", intent.id);
    return { cancelled: true };
  } catch (err) {
    await paymentOpsAlert("payment_intent_untracked", {
      payment_intent_id: intent.id,
      reason: "record_write_failed_and_cancel_failed",
      amount_cents: intent.amount,
      intent_status: intent.status,
      action_needed: "reconciliation will record it; check Stripe if this repeats"
    });
    return { cancelled: false };
  }
}

// Marks a hold for a person to decide (conditional: never overrides a ride
// binding or an in-flight release). Alerts once, on the transition.
async function flagHoldForReview({ intent, reason }) {
  const { data: rows } = await supabase
    .from("payments")
    .update({ status: PAYMENT_RECORD_STATUS.REVIEW_REQUIRED, failure_message: String(reason).slice(0, 120), updated_at: nowIso() })
    .eq("id", intent.id)
    .is("ride_id", null)
    .in("status", [PAYMENT_RECORD_STATUS.CREATED, PAYMENT_RECORD_STATUS.RELEASE_FAILED])
    .select("id");
  const flagged = Array.isArray(rows) && rows.length === 1;
  if (flagged) {
    await paymentOpsAlert("payment_hold_review_required", {
      payment_intent_id: intent.id,
      reason,
      amount_cents: intent.amount,
      intent_status: intent.status,
      age_minutes: Math.round((Date.now() - Number(intent.created) * 1000) / 60000),
      action_needed: "decide in Stripe whether to keep or cancel this hold"
    });
  }
  return flagged;
}

async function bindPaymentRecordToRide({ intent, ride }) {
  const record = buildAuthorizedPaymentRecord({ intent, ride });
  const { error: insertError } = await supabase.from("payments").insert(record);
  if (!insertError) {
    return { ok: true };
  }
  if (insertError.code !== "23505") {
    return { ok: false, error: "Payment could not be recorded. Please try again.", statusCode: 500 };
  }
  const { data: existing, error: readError } = await supabase
    .from("payments")
    .select("id,status,ride_id")
    .eq("id", intent.id)
    .maybeSingle();
  if (readError || !existing) {
    return { ok: false, error: "Payment could not be recorded. Please try again.", statusCode: 500 };
  }
  if (existing.ride_id && String(existing.ride_id) !== String(ride.id)) {
    return { ok: false, error: "This payment is already associated with another ride.", statusCode: 409 };
  }
  if (!BINDABLE_RECORD_STATUSES.includes(existing.status)) {
    return { ok: false, error: "This payment authorization is no longer available. Please book again.", statusCode: 409 };
  }
  const { id: _id, ...patch } = record;
  const { data: bound, error: bindError } = await supabase
    .from("payments")
    .update({ ...patch, updated_at: nowIso() })
    .eq("id", intent.id)
    .in("status", BINDABLE_RECORD_STATUSES)
    .select("id,ride_id");
  if (bindError) {
    return { ok: false, error: "Payment could not be recorded. Please try again.", statusCode: 500 };
  }
  const row = Array.isArray(bound) ? bound[0] : null;
  if (!row || String(row.ride_id) !== String(ride.id)) {
    return { ok: false, error: "This payment authorization is no longer available. Please book again.", statusCode: 409 };
  }
  return { ok: true };
}

async function unbindPaymentRecordFromRide({ paymentIntentId, rideId }) {
  await supabase
    .from("payments")
    .update({ status: PAYMENT_RECORD_STATUS.CREATED, ride_id: null, updated_at: nowIso() })
    .eq("id", paymentIntentId)
    .eq("ride_id", rideId)
    .eq("status", PAYMENT_RECORD_STATUS.AUTHORIZED)
    .then(() => {}, () => {});
}

// Shared by the rider route and the sweep. Returns { released, reason, statusCode }.
async function releaseUnusedHold({ paymentIntentId, requester, trigger, req = null, minAgeMs = DEFAULT_SWEEP_MIN_AGE_MS }) {
  let intent;
  try {
    intent = await stripe.paymentIntents.retrieve(paymentIntentId);
  } catch {
    return { released: false, reason: "intent_not_found", statusCode: 404 };
  }
  const [{ data: boundRides, error: ridesError }, { data: record, error: recordError }] = await Promise.all([
    supabase.from("rides").select("id,status").eq("payment_id", paymentIntentId),
    supabase.from("payments").select("id,status,ride_id,rider_id").eq("id", paymentIntentId).maybeSingle()
  ]);
  if (ridesError || recordError) {
    return { released: false, reason: "data_unavailable", statusCode: 503 };
  }
  const decision = decideHoldRelease({
    intent,
    boundRideIds: (boundRides || []).map((r) => r.id),
    record: record || null,
    requester,
    minAgeMs
  });
  if (!decision.release) {
    const statusCode = decision.reason === "not_owner" || decision.reason === "not_a_harvey_taxi_payment" ? 404 : 409;
    return { released: false, reason: decision.reason, statusCode };
  }

  // Claim the record. Exactly one of this claim and a ride's bind
  // (bindPaymentRecordToRide) can succeed for the same PaymentIntent.
  let claimed = false;
  if (record) {
    const { data: rows } = await supabase
      .from("payments")
      .update({ status: PAYMENT_RECORD_STATUS.RELEASE_PENDING, updated_at: nowIso() })
      .eq("id", paymentIntentId)
      .is("ride_id", null)
      .in("status", [PAYMENT_RECORD_STATUS.CREATED, PAYMENT_RECORD_STATUS.RELEASE_FAILED])
      .select("id");
    claimed = Array.isArray(rows) && rows.length === 1;
  } else {
    const { error: insertError } = await supabase.from("payments").insert({
      ...buildCreatedPaymentRecord({
        intent,
        riderId: intent.metadata?.rider_id || "unidentified",
        rideType: intent.metadata?.ride_type || null
      }),
      status: PAYMENT_RECORD_STATUS.RELEASE_PENDING
    });
    claimed = !insertError;
  }
  if (!claimed) {
    return { released: false, reason: "claimed_by_ride_or_release", statusCode: 409 };
  }

  // Belt and braces: a ride must never lose its payment.
  const { data: lateRides } = await supabase.from("rides").select("id").eq("payment_id", paymentIntentId);
  if ((lateRides || []).length) {
    await supabase
      .from("payments")
      .update({ status: PAYMENT_RECORD_STATUS.CREATED, updated_at: nowIso() })
      .eq("id", paymentIntentId)
      .eq("status", PAYMENT_RECORD_STATUS.RELEASE_PENDING);
    return { released: false, reason: "bound_to_ride", statusCode: 409 };
  }
  // Re-check Stripe after the claim: the hold may have been captured,
  // cancelled or changed since the decision above.
  let fresh;
  try {
    fresh = await stripe.paymentIntents.retrieve(paymentIntentId);
  } catch {
    fresh = null;
  }
  if (!fresh || !RELEASABLE_INTENT_STATUSES.includes(fresh.status)) {
    const settled = Boolean(fresh) && fresh.status === "canceled";
    await supabase
      .from("payments")
      .update({ status: settled ? PAYMENT_RECORD_STATUS.RELEASED : PAYMENT_RECORD_STATUS.REVIEW_REQUIRED, failure_message: settled ? null : "status_changed_before_cancel", updated_at: nowIso() })
      .eq("id", paymentIntentId)
      .eq("status", PAYMENT_RECORD_STATUS.RELEASE_PENDING);
    if (!settled) {
      await paymentOpsAlert("payment_hold_review_required", {
        payment_intent_id: paymentIntentId,
        reason: fresh ? `status_changed_to_${fresh.status}` : "intent_unreadable_after_claim",
        action_needed: "check this payment in Stripe"
      });
    }
    return { released: false, reason: settled ? "already_cancelled" : "status_changed", statusCode: 409 };
  }
  try {
    await stripe.paymentIntents.cancel(
      paymentIntentId,
      { cancellation_reason: "abandoned" },
      { idempotencyKey: releaseIdempotencyKey(paymentIntentId) }
    );
  } catch (err) {
    await supabase
      .from("payments")
      .update({ status: PAYMENT_RECORD_STATUS.RELEASE_FAILED, failure_message: "stripe_cancel_failed", updated_at: nowIso() })
      .eq("id", paymentIntentId);
    console.warn("⚠️ Unused hold release failed at Stripe:", err && err.code ? err.code : "error");
    return { released: false, reason: "stripe_cancel_failed", statusCode: 502 };
  }

  await supabase
    .from("payments")
    .update({
      status: PAYMENT_RECORD_STATUS.RELEASED,
      stripe_latest_status: "canceled",
      canceled_at: nowIso(),
      cancel_reason: decision.reason,
      updated_at: nowIso()
    })
    .eq("id", paymentIntentId);
  auditLog({
    actor_type: requester.kind === "rider" ? "rider" : "system",
    actor_id: requester.kind === "rider" ? requester.riderId || null : "unused-hold-sweep",
    action: "unused_card_hold_released",
    entity_type: "payment",
    entity_id: paymentIntentId,
    metadata: { reason: decision.reason, trigger, amount: Number(intent.amount || 0) / 100 },
    req
  }).catch(() => {});
  return { released: true, reason: decision.reason, statusCode: 200 };
}

app.post(
  "/api/payments/holds/:paymentIntentId/release",
  rateLimit({ windowMs: 60_000, max: resolvePerMinuteLimit("UNUSED_HOLD_RELEASE_PER_MINUTE", 10), keyPrefix: "unused_hold_release" }),
  asyncRoute(async (req, res) => {
    if ((await getSystemFlag("unused_hold_release_enabled", "false")) !== "true") {
      return res.status(503).json({ ok: false, released: false, reason: "disabled" });
    }
    if (!stripe) {
      return res.status(503).json({ ok: false, released: false, reason: "payments_not_configured" });
    }
    const paymentIntentId = cleanString(req.params.paymentIntentId, 200);
    if (!/^pi_[A-Za-z0-9_]+$/.test(paymentIntentId)) {
      return fail(res, "Payment not found.", 404);
    }
    const rider = await resolveVerifiedRiderSession(req);
    const result = await releaseUnusedHold({
      paymentIntentId,
      requester: {
        kind: "rider",
        riderId: rider ? String(rider.id) : null,
        clientSecret: typeof req.body?.client_secret === "string" ? req.body.client_secret.slice(0, 300) : null
      },
      trigger: "rider_left_booking",
      req
    });
    if (!result.released) {
      // Ownership failures look like "not found" so a guessed id reveals nothing.
      return res.status(result.statusCode).json({
        ok: false,
        released: false,
        reason: result.statusCode === 404 ? "not_found" : result.reason
      });
    }
    return ok(res, { released: true });
  })
);

let unusedHoldSweepRunning = false;

async function runUnusedHoldSweep({ minAgeMs = DEFAULT_SWEEP_MIN_AGE_MS, limit = 25 } = {}) {
  if (unusedHoldSweepRunning || !stripe) return { skipped: true };
  if ((await getSystemFlag("unused_hold_sweep_enabled", "false")) !== "true") return { skipped: true };
  unusedHoldSweepRunning = true;
  const result = { released: [], kept: [] };
  try {
    const cutoff = new Date(Date.now() - minAgeMs).toISOString();
    const { data: candidates, error } = await supabase
      .from("payments")
      .select("id,created_at")
      .in("status", [PAYMENT_RECORD_STATUS.CREATED, PAYMENT_RECORD_STATUS.RELEASE_FAILED])
      .is("ride_id", null)
      .lt("created_at", cutoff)
      .limit(limit);
    if (error) return result;
    for (const row of candidates || []) {
      const outcome = await releaseUnusedHold({
        paymentIntentId: row.id,
        requester: { kind: "sweep" },
        trigger: "sweep"
      });
      (outcome.released ? result.released : result.kept).push({ id: row.id, reason: outcome.reason });
    }
    return result;
  } finally {
    unusedHoldSweepRunning = false;
  }
}

// Stripe-side reconciliation. Stripe, not the database, is the source of
// truth for which holds exist, so this walks Harvey Taxi's own uncaptured
// PaymentIntents (explicit app/account metadata), oldest window first,
// with pagination:
//   - records any intent the database doesn't know about (tracking is
//     always on; it is a reliability function, not cleanup);
//   - keeps anything bound to a ride;
//   - flags uncertain ownership/attachment for a person (alert, no action);
//   - cancels an unused hold ONLY when unused_hold_sweep_enabled is "true"
//     (off by default), through releaseUnusedHold(), which claims the
//     payments row (the same row a ride's authorization must claim, so the
//     two can't both win across server instances), re-checks the rides
//     table, and re-checks Stripe immediately before cancelling.
let stripeReconcileRunning = false;
const RECONCILE_LOOKBACK_MS = 8 * 24 * 60 * 60 * 1000; // card authorizations expire after ~7 days

// intentFilter: test-only scoping (e.g. to a run's own intents in a shared
// Stripe test account); production passes none.
// mode "live":    records unknown intents, flags review cases (with one
//                 alert each), and cancels release candidates only when
//                 unused_hold_sweep_enabled is "true".
// mode "dry_run": reads Stripe and the database and reports what live mode
//                 WOULD do. It writes nothing, cancels nothing and sends no
//                 alerts or notifications.
async function reconcileStripeHolds({ mode = "live", minAgeMs = DEFAULT_SWEEP_MIN_AGE_MS, lookbackMs = RECONCILE_LOOKBACK_MS, pageSize = 100, maxPages = 20, now = Date.now(), intentFilter = null, maxFindings = 500 } = {}) {
  if (!stripe) return { skipped: true, reason: "stripe_not_configured" };
  const dryRun = mode === "dry_run";
  // A dry run only reads, so it never blocks (or is blocked by) a live run.
  if (!dryRun && stripeReconcileRunning) return { skipped: true, reason: "already_running" };
  if (!dryRun) stripeReconcileRunning = true;
  const summary = { mode: dryRun ? "dry_run" : "live", scanned: 0, harvey_holds: 0, newly_tracked: 0, would_track: 0, kept: 0, review: 0, would_release: 0, released: 0, release_refused: 0, errors: 0, pages: 0, truncated: false, cleanup_enabled: false, findings: [] };
  try {
    summary.cleanup_enabled = (await getSystemFlag("unused_hold_sweep_enabled", "false")) === "true";
    const created = { lte: Math.floor((now - minAgeMs) / 1000), gte: Math.floor((now - lookbackMs) / 1000) };
    let startingAfter;
    let hasMore = true;
    while (hasMore && summary.pages < maxPages) {
      const page = await stripe.paymentIntents.list({ created, limit: pageSize, ...(startingAfter ? { starting_after: startingAfter } : {}) });
      summary.pages += 1;
      const items = page?.data || [];
      hasMore = Boolean(page?.has_more) && items.length > 0;
      if (items.length) startingAfter = items[items.length - 1].id;
      for (const intent of items) {
        summary.scanned += 1;
        if (intent?.metadata?.app !== "harvey_taxi" || !RELEASABLE_INTENT_STATUSES.includes(intent.status)) continue;
        if (intentFilter && !intentFilter(intent)) continue;
        summary.harvey_holds += 1;
        try {
          await reconcileOneHold({ intent, summary, now, minAgeMs, dryRun, maxFindings });
        } catch {
          summary.errors += 1;
        }
      }
    }
    if (hasMore) {
      summary.truncated = true;
      if (!dryRun) {
        await paymentOpsAlert("payment_reconciliation_truncated", { reason: `stopped after ${summary.pages} pages`, action_needed: "run reconciliation again" });
      }
    }
    return summary;
  } finally {
    if (!dryRun) stripeReconcileRunning = false;
  }
}

// Scheduled entry point: does nothing unless stripe_reconciliation_enabled
// is "true" (off by default). Cancellation additionally needs
// unused_hold_sweep_enabled (also off by default).
async function runScheduledReconciliation() {
  if ((await getSystemFlag("stripe_reconciliation_enabled", "false")) !== "true") return { skipped: true, reason: "disabled" };
  return reconcileStripeHolds({ mode: "live" });
}

async function loadHoldState(paymentIntentId) {
  const [{ data: rides, error: ridesError }, { data: record, error: recordError }] = await Promise.all([
    supabase.from("rides").select("id").eq("payment_id", paymentIntentId),
    supabase.from("payments").select("id,status,ride_id,rider_id").eq("id", paymentIntentId).maybeSingle()
  ]);
  if (ridesError || recordError) throw new Error("hold_state_unavailable");
  return { boundRideIds: (rides || []).map((r) => r.id), record: record || null };
}

async function reconcileOneHold({ intent, summary, now, minAgeMs, dryRun, maxFindings }) {
  let { boundRideIds, record } = await loadHoldState(intent.id);
  const wasTracked = Boolean(record);
  if (!record) {
    if (dryRun) {
      summary.would_track += 1;
    } else {
      const { error } = await supabase.from("payments").insert(
        buildCreatedPaymentRecord({ intent, riderId: intent.metadata?.rider_id, rideType: intent.metadata?.ride_type })
      );
      if (!error) summary.newly_tracked += 1;
      ({ boundRideIds, record } = await loadHoldState(intent.id));
    }
  }
  const decision = decideReconciliation({ intent, boundRideIds, record, now, minAgeMs });
  // Findings carry no client secret, card or contact detail, or rider id.
  if (summary.findings.length < maxFindings) {
    summary.findings.push({
      payment_intent_id: intent.id,
      stripe_status: intent.status,
      amount_cents: intent.amount,
      age_minutes: Math.round((now - Number(intent.created) * 1000) / 60000),
      tracked: wasTracked,
      record_status: record ? record.status : null,
      bound_ride: boundRideIds.length > 0 || Boolean(record && record.ride_id),
      action: decision.action,
      reason: decision.reason
    });
  }
  if (decision.action === "ignore") return;
  if (decision.action === "keep") {
    summary.kept += 1;
    return;
  }
  if (decision.action === "review") {
    summary.review += 1;
    if (!dryRun) await flagHoldForReview({ intent, reason: decision.reason });
    return;
  }
  if (dryRun || !summary.cleanup_enabled) {
    summary.would_release += 1;
    return;
  }
  const outcome = await releaseUnusedHold({ paymentIntentId: intent.id, requester: { kind: "sweep" }, trigger: "reconciliation", minAgeMs });
  if (outcome.released) summary.released += 1;
  else summary.release_refused += 1;
}

/* =========================================================
   ADMIN: STRIPE HOLD RECONCILIATION DRY RUN
   Read-only, always: reports what scheduled reconciliation would record,
   flag or cancel. It writes no records, cancels nothing and sends no
   alerts or notifications, whatever the flags say. Live reconciliation
   runs only on the schedule, and only when stripe_reconciliation_enabled
   is "true".
========================================================= */
app.post(
  "/api/admin/payments/reconcile/dry-run",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const summary = await reconcileStripeHolds({ mode: "dry_run" });
    const reconciliationEnabled = (await getSystemFlag("stripe_reconciliation_enabled", "false")) === "true";
    return ok(res, { dry_run: true, scheduled_reconciliation_enabled: reconciliationEnabled, reconciliation: summary });
  })
);

/* =========================================================
   ADMIN: PAYMENT RECONCILIATION REPORT (read-only)
   Compares Stripe PaymentIntents and refunds with payments, rides and the
   refund ledger, and returns discrepancy codes with identifiers and
   amounts only. Writes nothing anywhere. Owner or finance role.
========================================================= */
const RECONCILE_REPORT_LOOKBACK_DAYS = 90;
async function listStripeAll(list, params, maxPages = 20) {
  const items = [];
  let startingAfter;
  for (let page = 0; page < maxPages; page += 1) {
    const res = await list({ ...params, limit: 100, ...(startingAfter ? { starting_after: startingAfter } : {}) });
    items.push(...(res.data || []));
    if (!res.has_more || !res.data || !res.data.length) return { items, truncated: false };
    startingAfter = res.data[res.data.length - 1].id;
  }
  return { items, truncated: true };
}

app.post(
  "/api/admin/payments/reconcile/report",
  requireAdmin,
  rateLimit({ windowMs: 60_000, max: 5, keyPrefix: "payment_reconcile_report" }),
  asyncRoute(async (req, res) => {
    const { role } = await resolveAdminRoleForRequest(req);
    if (!computeShadowWouldAllow(role, "finance.read")) return fail(res, "Payment reconciliation requires the finance permission.", 403);
    if (!stripe) return fail(res, "Stripe is not configured.", 503);
    const nowSec = Math.floor(Date.now() / 1000);
    const window = { gte: nowSec - RECONCILE_REPORT_LOOKBACK_DAYS * 86400, lte: nowSec };
    const [intents, refunds] = await Promise.all([
      listStripeAll((p) => stripe.paymentIntents.list(p), { created: window }),
      listStripeAll((p) => stripe.refunds.list(p), { created: window })
    ]);
    const [payments, rides, ledger] = await Promise.all([
      supabase.from("payments").select("id, amount, status, stripe_latest_status, ride_id, provider, created_at"),
      supabase.from("rides").select("id, payment_id, payment_status, created_at").not("payment_id", "is", null),
      supabase.from("payment_refunds").select("payment_intent_id, stripe_refund_id, amount_cents, status")
    ]);
    if (payments.error || rides.error) return fail(res, "Could not read payment records.", 500);
    const ledgerMissing = Boolean(ledger.error);
    const report = paymentReconciliation.reconcilePayments({
      intents: intents.items,
      refunds: refunds.items,
      payments: payments.data || [],
      rides: rides.data || [],
      ledger: ledgerMissing ? [] : ledger.data || [],
      expectLivemode: describePaymentConfig({ secretKey: STRIPE_SECRET_KEY }).secret_key_mode === "live",
      window
    });
    auditLog({ actor_type: "admin", actor_id: req.admin && req.admin.email, action: "payment_reconciliation_report", entity_type: "payments", metadata: { discrepancies: report.summary.discrepancies } }).catch(() => {});
    return ok(res, {
      read_only: true,
      window_days: RECONCILE_REPORT_LOOKBACK_DAYS,
      truncated: intents.truncated || refunds.truncated,
      refund_ledger: ledgerMissing ? "not_migrated" : "present",
      ...report
    });
  })
);

/* =========================================================
   ADMIN: REFUND A CAPTURED PAYMENT (lib/refunds.js)
   Off unless refunds_enabled is "true". Owner (super_admin) only, one
   person-initiated refund per request. Test mode only: a live-mode key or
   PaymentIntent is refused in lib/refunds.js whatever the flag says.
========================================================= */
app.post(
  "/api/admin/payments/:paymentIntentId/refunds",
  requireAdmin,
  rateLimit({ windowMs: 60_000, max: 10, keyPrefix: "payment_refund" }),
  asyncRoute(async (req, res) => {
    const { role } = await resolveAdminRoleForRequest(req);
    if (role !== "super_admin") return fail(res, "Refunds require the owner account.", 403);
    if ((await getSystemFlag("refunds_enabled", "false")) !== "true") return fail(res, "Refunds are turned off.", 403);
    const body = req.body || {};
    const result = await refunds.requestRefund({
      stripe,
      secretKey: STRIPE_SECRET_KEY,
      rpc: async (name, args) => {
        const { data, error } = await supabase.rpc(name, args);
        if (error) throw error;
        return data;
      },
      paymentIntentId: cleanString(req.params.paymentIntentId, 80),
      amountCents: Number.isInteger(body.amount_cents) ? body.amount_cents : NaN,
      reasonCode: cleanString(body.reason_code, 40),
      idempotencyKey: typeof body.idempotency_key === "string" ? body.idempotency_key.slice(0, 200) : "",
      requestedBy: req.admin && req.admin.email
    });
    // Identifiers, amounts and fixed codes only.
    auditLog({
      actor_type: "admin",
      actor_id: req.admin && req.admin.email,
      action: "payment_refund_requested",
      entity_type: "payment",
      entity_id: cleanString(req.params.paymentIntentId, 80),
      metadata: { amount_cents: Number.isInteger(body.amount_cents) ? body.amount_cents : null, reason_code: cleanString(body.reason_code, 40), outcome: result.ok ? (result.refund && result.refund.status) : result.error, ledger_id: result.refund ? result.refund.id : null }
    }).catch(() => {});
    if (result.ok) return ok(res, { refund: result.refund, replayed: Boolean(result.replayed) });
    const status = result.retryable ? 503 : result.error === refunds.REFUND_ERROR.LIVE_MODE_REFUSED ? 403 : result.error === refunds.REFUND_ERROR.INTENT_NOT_FOUND ? 404 : result.error === refunds.REFUND_ERROR.EXCEEDS_REFUNDABLE || result.error === refunds.REFUND_ERROR.IDEMPOTENCY_MISMATCH ? 409 : 400;
    return res.status(status).json({ ok: false, error: result.error, retryable: Boolean(result.retryable), refund: result.refund || null, field: result.field || undefined });
  })
);

/* =========================================================
   HARVEY TAXI DRIVER APP (lib/driverAppRoutes.js, docs/driver-app.md)
   Additive routes for the native driver app; the web dashboard's routes
   are unchanged.
========================================================= */
({ sendDriverNativePush: driverAppNativePush } = registerDriverAppRoutes(app, {
  supabase,
  requireDriverSelf,
  rateLimit,
  asyncRoute,
  ok,
  fail,
  getSystemFlag,
  getTwilioClient: () => twilioClient,
  twilioVerifyServiceSid: TWILIO_VERIFY_SERVICE_SID,
  toE164,
  signDriverSession,
  driverSessionTtlHours: DRIVER_SESSION_TTL_HOURS,
  computeDriverReadiness,
  enablePersona: ENABLE_PERSONA,
  enableCheckr: ENABLE_CHECKR,
  auditLog,
  realtime: driverAppRealtime,
  loadDriverShift
}));

/* =========================================================
   API 404 HANDLER

========================================================= */

app.use(

  "/api",

  (req, res) => {

    return fail(

      res,

      `API route not found: ${req.method} ${req.originalUrl}`,

      404

    );

  }

);

/* =========================================================

   APP FALLBACK 404

========================================================= */

app.use(

  (req, res) => {

    return res

      .status(404)

      .sendFile(

        path.join(

          PUBLIC_DIR,

          "index.html"

        )

      );

  }

);

/* =========================================================

   GLOBAL ERROR HANDLER

========================================================= */

app.use(

  (error, req, res, next) => {

    console.error(

      "❌ SERVER ERROR:",

      // Structured, allowlisted fields only (lib/safeLog.js): no raw
      // message, URL, query string, body or headers. The stack is kept
      // outside production only.
      {
        ...serverErrorEntry(error, req),
        ...(IS_PRODUCTION ? {} : { stack: error.stack })
      }
    );

    auditLog({
      action: "server_error",
      entity_type: "server",
      metadata: {
        ...serverErrorEntry(error, req),
        ...(error.corsDiagnostics || {})
      }
      // No req: the audit row does not store the client IP or user agent.
    }).catch(() => {});

    return fail(

      res,

      IS_PRODUCTION

        ? "Internal server error."

        : error.message,

      500

    );

  }

);

/* =========================================================

   PROCESS SAFETY

========================================================= */

process.on(

  "unhandledRejection",

  (reason) => {

    console.error(

      "❌ UNHANDLED REJECTION:",

      reason

    );

  }

);

process.on(

  "uncaughtException",

  (error) => {

    console.error(

      "❌ UNCAUGHT EXCEPTION:",

      error

    );

  }

);

/* =========================================================

   GRACEFUL SHUTDOWN

========================================================= */

function gracefulShutdown(signal) {

  console.log(

    `🛑 ${signal} received. Shutting down Harvey Taxi Server J...`

  );

  for (const clientId of sseClients.keys()) {

    sendSse(

      clientId,

      "server_shutdown",

      {

        signal,

        at:

          nowIso()

      }

    );

  }

  server.close(() => {

    console.log(

      "✅ HTTP server closed."

    );

    process.exit(0);

  });

  setTimeout(() => {

    console.warn(

      "⚠️ Forced shutdown after timeout."

    );

    process.exit(1);

  }, 10_000).unref();

}

process.on(

  "SIGTERM",

  () => gracefulShutdown("SIGTERM")

);

process.on(

  "SIGINT",

  () => gracefulShutdown("SIGINT")

);

/* =========================================================

   BOOT VALIDATION

========================================================= */

async function bootValidation() {

  console.log(

    "🔎 Running Harvey Taxi boot validation..."

  );

  const tableStatus =

    await checkRequiredTables();

  const htafStatus =

    await inspectHtafSchema();

  console.log(

    "📊 Supabase table status:",

    tableStatus

  );

  console.log(

    "📊 HTAF schema status:",

    htafStatus

  );

  if (!htafStatus.ok) {

    console.warn(

      "⚠️ HTAF schema is not fully ready. /api/foundation/apply may fail until Supabase columns match the server payload."

    );

  }

  return {

    tableStatus,

    htafStatus

  };

}

/* =========================================================

   START SERVER

========================================================= */

async function startServer() {

  try {

    await bootValidation();

  } catch (error) {

    console.warn(

      "⚠️ Boot validation completed with warnings:",

      error.message

    );

  }

  server.listen(

    PORT,

    "0.0.0.0",

    () => {

      console.log(

        "================================================="

      );

      console.log(

        "🚕 HARVEY TAXI SERVER J ONLINE"

      );

      console.log(

        `🌎 Environment: ${NODE_ENV}`

      );

      console.log(

        `🔌 Port: ${PORT}`

      );

      console.log(

        `🏠 App URL: ${APP_BASE_URL}`

      );

      console.log(

        `🧾 HTAF Applications: ${ENABLE_HTAF_APPLICATIONS ? "ON" : "OFF"}`

      );

      console.log(
        HTAF_ADMIN_EMAIL
          ? "📨 HTAF application alerts: ON"
          : "🚨 HTAF application alerts: OFF -- set HTAF_ADMIN_EMAIL (no Harvey Taxi fallback)"
      );

      console.log(

        `💳 Stripe: ${stripe ? "ON" : "OFF"}`

      );

      console.log(

        `📧 SendGrid: ${sgMail && SENDGRID_API_KEY ? "ON" : "OFF"}`

      );

      console.log(

        `📲 Twilio: ${twilioClient ? "ON" : "OFF"}`

      );

      console.log(

        `🪪 Persona API key configured: ${PERSONA_API_KEY ? "ON" : "OFF"}`

      );

      // Distinct from the line above on purpose: PERSONA_API_KEY presence
      // just means the API key is configured. ENABLE_PERSONA is the gate
      // that actually decides whether computeDriverReadiness() requires a
      // real Persona verification before a driver can go online -- it
      // defaults to true even with no key configured, which previously
      // blocked every driver from ever going online with no way to tell
      // why from this log alone (the line above read "OFF" the whole
      // time, which looked like the opposite problem).
      console.log(

        `🪪 Persona verification required to go online (ENABLE_PERSONA): ${ENABLE_PERSONA ? "ON" : "OFF"}`

      );

      console.log(

        `🛡️ Checkr: ${CHECKR_API_KEY ? "ON" : "OFF"}`

      );

      console.log(

        `🤖 AI Support: ${openai ? "ON" : "OFF"}`

      );

      for (const [label, state] of [
        ["🚐 HTAF ride creation", HTAF_ACTIVATION.rideCreation],
        ["🎟️ HTAF ride assistance", HTAF_FUNDING.funding],
        ["🧾 HTAF ride assistance invoicing", HTAF_FUNDING.invoicing]
      ]) {
        // A flag set without its approval record is an operator error worth
        // shouting about; a flag that is simply off is the normal state.
        (state.requested && !state.enabled ? console.error : console.log)(
          `${label}: ${state.enabled ? "ON" : "OFF"} (${state.reason})`
        );
      }

      console.log(
        `🧭 Agent model: ${agentLlmConfig.configured ? `self-hosted (${describeAgentLlmConfig(agentLlmConfig).host})` : "rules only"}`
      );

      console.log(

        "================================================="

      );

      // Picks up rides held by shouldDispatchRideNow() once their
      // scheduled_time arrives. Runs once immediately (in case rides came
      // due while the server was restarting/deploying) and then every 60s.
      const runScheduledSweep = () =>
        sweepScheduledRides({
          findDueRides: findDueScheduledRides,
          claimRide: claimScheduledRide,
          resetRide: resetScheduledRideForRetry,
          dispatchRide
        });

      runScheduledSweep();
      setInterval(runScheduledSweep, 60_000);

      // Enforces driver_offers.expires_at (see lib/offerExpiry.js) — off by
      // default via the offer_expiry_sweep_enabled system flag so this can
      // be rolled back instantly without a deploy. Checked every 15s, well
      // under the default 30s offer window, so an ignored offer is caught
      // and redispatched promptly.
      runOfferExpirySweep();
      setInterval(runOfferExpirySweep, 15_000);

      // Recovers a ride stuck in dispatch_status "redispatching" if
      // dispatchRide() never completed (see lib/offerExpiry.js). Always
      // on, not flag-gated — protects the pre-existing decline-triggered
      // redispatch path too, which has the same exposure independent of
      // offer_expiry_sweep_enabled.
      runStuckRedispatchRecovery();
      setInterval(runStuckRedispatchRecovery, 30_000);
      // App Review standalone demos. Does nothing unless the
      // review_demo_autopilot_enabled system flag is "true" (off by default).
      setInterval(() => {
        runReviewDemoTick().catch((err) => console.error("⚠️ Review demo tick failed:", err && err.message));
      }, 5_000);

      // Driver hours limit: offline at 12 hours online (lib/driverHours.js).
      setInterval(() => {
        runDriverHoursSweep().catch((err) => console.error("⚠️ Driver hours sweep failed:", err && err.message));
      }, 60_000);

      // Deletes rider-shared locations past pickup (lib/liveLocation.js).
      setInterval(() => {
        purgeRiderLocations().catch((err) => console.error("⚠️ Rider location purge failed:", err && err.message));
      }, 60_000);

      // Clears IP and user agent on audit rows older than 90 days. Off
      // unless audit_ip_retention_enabled is "true" (lib/auditRetention.js).
      setInterval(() => {
        runAuditIpRetention().catch((err) => console.error("⚠️ Audit IP retention failed:", logErrorCode(err)));
      }, auditRetention.SWEEP_INTERVAL_MS).unref();

      // Cancels uncaptured card holds that never became a ride. Off unless
      // the unused_hold_sweep_enabled system flag is "true".
      setInterval(() => {
        runUnusedHoldSweep().catch(() => {});
      }, 10 * 60_000);

      // Stripe-side reconciliation. Does nothing unless
      // stripe_reconciliation_enabled is "true" (off by default); cancels
      // nothing unless unused_hold_sweep_enabled is also "true" (off).
      setInterval(() => {
        runScheduledReconciliation().catch(() => {});
      }, 30 * 60_000);
      // One real health check at boot so the admin page can say whether the
      // optional self-hosted model is reachable (Disabled when unset).
      agentLlm.healthCheck().catch(() => {});

      // AI Agent Manager coordination pass. Does nothing unless an admin
      // turns on shadow mode (records "would do" only) or, later and with
      // elevated approval, automation. Never blocks booking or dispatch.
      setInterval(() => {
        runAgentCoordinationSweep().catch(() => {});
      }, 60_000);

    }

  );

}

// Only auto-start (and run bootValidation, register signal handlers,
// open cron-style setIntervals, etc.) when this file is actually
// launched directly (node server.js / npm start -- the only way it
// runs in every deployed environment). Requiring it as a module -- the
// only other caller, added for the Google Play reviewer-account
// composition/integration tests in server.review-accounts.test.js --
// must never also stand up a second real HTTP listener or duplicate
// timers. Exporting `app` here changes nothing about production
// behavior: it's inert unless something actually requires this file
// instead of running it.
if (require.main === module) {
  startServer();
}

// runOfferExpirySweep is exported only so tests can drive the real
// Supabase adapters for the offer-expiry sweep; production runs it on the
// interval set up under require.main === module below.
module.exports = { app, __assistantPilot: assistantPilotTestHooks, runAuditIpRetention, runReviewDemoTick, runOfferExpirySweep, runUnusedHoldSweep, runAgentCoordinationSweep, reconcileStripeHolds, runScheduledReconciliation, purgeRiderLocations, runDriverHoursSweep };

// HTAF text messages (Harvey Transportation Assistance Foundation only;
// never Harvey Taxi Service LLC messaging).
//
// Consent is optional and separate from applying: an application is
// accepted whether or not the box is checked. What this module decides:
//   - the exact consent wording shown on the application form, by version
//     (the form must show the current version's text verbatim; a test
//     checks it);
//   - what a reply keyword means (STOP / START / HELP families);
//   - whether HTAF may text a number now: only with a recorded opt-in, no
//     later opt-out, messaging switched on, and HTAF's own sender number.
// No network, no database.

const CONSENT_VERSION = "htaf-sms-v1";

// The number HTAF registers for toll-free verification. Display form.
const HTAF_SMS_NUMBER_DISPLAY = "(844) 795-0299";

const PRIVACY_URL = "https://harveytransportationfoundation.com/privacy.html";
const TERMS_URL = "https://harveytransportationfoundation.com/terms.html";

// Shown next to the checkbox on htaf-application.html (links on "Privacy
// Policy" and "Terms of Use"). Change only with a new version.
const CONSENT_TEXT = Object.freeze({
  "htaf-sms-v1":
    "Yes, I agree to receive text messages from Harvey Transportation Assistance Foundation (HTAF) " +
    `at the phone number above, sent from ${HTAF_SMS_NUMBER_DISPLAY}, about my application updates, ` +
    "transportation scheduling, pickup reminders, service changes and support. " +
    "Message frequency varies. Message and data rates may apply. " +
    "Reply STOP to opt out at any time, or HELP for help. " +
    "Consent is not required to apply for or receive assistance. " +
    "See our Privacy Policy and Terms of Use."
});

const CONSENT_SOURCE = "htaf-application-web-form";

// Carrier/CTIA keyword families. Twilio and the carrier already reply to
// these on a toll-free number; HTAF records them so its own sending honors
// them too.
const OPT_OUT = new Set(["stop", "stopall", "unsubscribe", "cancel", "end", "quit", "revoke", "optout", "opt-out"]);
const HELP = new Set(["help", "info", "support"]);

function keywordOf(body) {
  const word = String(body || "").trim().toLowerCase().replace(/[.!]+$/, "");
  if (OPT_OUT.has(word)) return "opt_out";
  // Toll-free numbers re-subscribe only on START or UNSTOP (carrier rule);
  // YES is not treated as an opt-in on a toll-free number.
  if (word === "start" || word === "unstop") return "opt_in_again";
  if (HELP.has(word)) return "help";
  return null;
}

// US numbers only, as +1XXXXXXXXXX; anything else is not textable.
function normalizeUsPhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

// The consent record for an application, decided by the server: the
// version, source and time come from here, never from the browser. Only
// an explicit true opts in.
function consentRecord({ applicationId, phone, smsConsent, now = new Date() }) {
  const optedIn = smsConsent === true;
  return {
    application_id: applicationId || null,
    phone: normalizeUsPhone(phone),
    event: optedIn ? "opt_in" : "declined",
    consent_version: CONSENT_VERSION,
    source: CONSENT_SOURCE,
    created_at: now.toISOString()
  };
}

// May HTAF text this number now? events: this phone's consent events, any
// order. The latest opt_in / opt_in_again / opt_out decides; help and
// declined don't change it. Missing records mean no.
function canText({ events, enabled, fromNumber }) {
  if (!enabled) return { ok: false, reason: "htaf_sms_disabled" };
  if (!fromNumber) return { ok: false, reason: "htaf_sender_not_configured" };
  const decisive = (events || [])
    .filter((e) => e && ["opt_in", "opt_in_again", "opt_out"].includes(e.event))
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  const last = decisive[decisive.length - 1];
  if (!last) return { ok: false, reason: "no_consent" };
  if (last.event === "opt_out") return { ok: false, reason: "opted_out" };
  return { ok: true, reason: null };
}

// Sent once, right after an opt-in (only when HTAF messaging is enabled).
const WELCOME_MESSAGE =
  "HTAF (Harvey Transportation Assistance Foundation): You're signed up for texts about your transportation-assistance application. " +
  "Msg frequency varies. Msg & data rates may apply. Reply HELP for help, STOP to opt out.";

// For the number's HELP reply (configured in Twilio, not sent by this app).
const HELP_MESSAGE =
  "HTAF (Harvey Transportation Assistance Foundation): For help, email WillieHtaf@harveytransportationfoundation.com or call 615-636-6201. " +
  "Msg frequency varies. Msg & data rates may apply. Reply STOP to opt out.";

module.exports = {
  CONSENT_VERSION,
  CONSENT_TEXT,
  CONSENT_SOURCE,
  HTAF_SMS_NUMBER_DISPLAY,
  PRIVACY_URL,
  TERMS_URL,
  WELCOME_MESSAGE,
  HELP_MESSAGE,
  keywordOf,
  normalizeUsPhone,
  consentRecord,
  canText
};

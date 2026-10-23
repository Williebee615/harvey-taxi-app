// HTAF partner access (owner decision 2026-10-23): referral organizations
// (shelters, clinics, workforce centres) view their own clients'
// applications and submit new ones. HTAF decides every application.
//
// Access needs BOTH switches, both off by default:
//   - the owner's master switch (system flag htaf_partner_access_enabled),
//   - the partner's own switch (htaf_partners.enabled), which can only be
//     turned on once a signed partner agreement is recorded.
// Both are checked on every request, so turning either off ends access
// at once. Partners never get an admin session or admin routes.
//
// Pure: server.js owns the database reads and writes. The session design
// follows the merchant portal (lib/merchantAuth.js).

const crypto = require("crypto");
const { base64UrlEncode, base64UrlDecode, timingSafeEqualString, isNonNegativeInteger } = require("./riderAuth");

const MASTER_FLAG = "htaf_partner_access_enabled";
const PARTNER_SESSION_SUBJECT = "htaf-partner";
const PARTNER_TYPES = Object.freeze(["shelter", "clinic", "workforce", "other"]);
const CLOCK_SKEW_TOLERANCE_MS = 60 * 1000;

function signPartnerSession({ partnerUserId, partnerId, sessionVersion, secret, ttlHours, now = Date.now() }) {
  if (!secret) throw new Error("signPartnerSession requires a secret.");
  if (!partnerUserId || !partnerId) throw new Error("signPartnerSession requires partnerUserId and partnerId.");
  if (!isNonNegativeInteger(sessionVersion)) throw new Error("sessionVersion must be a nonnegative integer.");
  if (!Number.isFinite(ttlHours) || ttlHours <= 0) throw new Error("ttlHours must be positive.");
  const payload = {
    sub: PARTNER_SESSION_SUBJECT,
    partner_user_id: String(partnerUserId),
    partner_id: String(partnerId),
    session_version: sessionVersion,
    iat: now,
    exp: now + ttlHours * 60 * 60 * 1000
  };
  const encoded = base64UrlEncode(JSON.stringify(payload));
  const sig = crypto.createHmac("sha256", secret).update(encoded).digest("hex");
  return `${encoded}.${sig}`;
}

// Signature, structure and expiry only; accessDecision() does the rest.
function verifyPartnerSession({ token, secret, now = Date.now() }) {
  if (!token || !secret) return { ok: false, reason: "missing_token" };
  const parts = String(token).split(".");
  if (parts.length !== 2) return { ok: false, reason: "malformed" };
  const [encoded, sig] = parts;
  const expected = crypto.createHmac("sha256", secret).update(encoded).digest("hex");
  if (!timingSafeEqualString(sig, expected)) return { ok: false, reason: "bad_signature" };
  let p;
  try {
    p = JSON.parse(base64UrlDecode(encoded));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (!p || p.sub !== PARTNER_SESSION_SUBJECT || typeof p.partner_user_id !== "string" || typeof p.partner_id !== "string") {
    return { ok: false, reason: "malformed" };
  }
  if (!isNonNegativeInteger(p.session_version) || !Number.isFinite(p.iat) || !Number.isFinite(p.exp)) return { ok: false, reason: "malformed" };
  if (p.iat > now + CLOCK_SKEW_TOLERANCE_MS) return { ok: false, reason: "malformed" };
  if (now >= p.exp) return { ok: false, reason: "expired" };
  return { ok: true, payload: p };
}

// Whether a signed-in partner user may use the portal right now.
// session: the verified token payload (or null when checking sign-in).
function accessDecision({ masterOn, partner, user, session = null }) {
  if (!masterOn) return { allowed: false, reason: "master_off" };
  if (!user || user.status !== "active") return { allowed: false, reason: "user_inactive" };
  if (!partner || String(partner.id) !== String(user.partner_id)) return { allowed: false, reason: "partner_missing" };
  if (partner.enabled !== true) return { allowed: false, reason: "partner_off" };
  if (!partner.agreement_ref) return { allowed: false, reason: "no_agreement" };
  if (session && (session.partner_id !== String(user.partner_id) || session.session_version !== user.session_version)) {
    return { allowed: false, reason: "stale_session" };
  }
  return { allowed: true, reason: null };
}

// What a partner sees of its own clients' applications: enough to follow
// progress. No contact details, income, need text or HTAF's notes.
const PARTNER_APPLICATION_FIELDS = "id, application_code, first_name, last_name, program_type, status, ride_date, created_at, updated_at, partner_id";
function toPartnerApplicationView(row) {
  const last = String(row.last_name || "").trim();
  return {
    application_code: row.application_code,
    client: [String(row.first_name || "").trim(), last ? `${last[0].toUpperCase()}.` : ""].filter(Boolean).join(" "),
    program_type: row.program_type || null,
    status: row.status || null,
    ride_date: row.ride_date || null,
    submitted_at: row.created_at || null,
    updated_at: row.updated_at || null
  };
}

// The coordinator confirms the client agreed before submitting for them.
const CONSENT_STATEMENT =
  "The client agreed to this application being sent to HTAF, and to HTAF contacting them about it.";

function validatePartnerInput({ name, partner_type, agreement_ref }) {
  const cleanName = String(name || "").trim();
  if (cleanName.length < 2 || cleanName.length > 160) return { ok: false, error: "Enter the organization's name." };
  const type = String(partner_type || "other").trim();
  if (!PARTNER_TYPES.includes(type)) return { ok: false, error: "Choose a partner type." };
  const ref = String(agreement_ref || "").trim();
  if (ref && (ref.length < 2 || ref.length > 200)) return { ok: false, error: "The agreement reference is too long." };
  return { ok: true, value: { name: cleanName, partner_type: type, agreement_ref: ref || null } };
}

module.exports = {
  MASTER_FLAG,
  PARTNER_SESSION_SUBJECT,
  PARTNER_TYPES,
  PARTNER_APPLICATION_FIELDS,
  CONSENT_STATEMENT,
  signPartnerSession,
  verifyPartnerSession,
  accessDecision,
  toPartnerApplicationView,
  validatePartnerInput
};

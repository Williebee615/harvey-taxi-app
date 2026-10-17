// Merchant portal, phase 1b: merchant session tokens and store-hours
// validation. Pure functions; server.js owns the database reads and
// writes. The session design follows the rider session
// (lib/riderAuth.js): an HMAC-signed, expiring token in an HttpOnly
// cookie, with session_version for real sign-out and access removal.

const crypto = require("crypto");
const { base64UrlEncode, base64UrlDecode, timingSafeEqualString, isNonNegativeInteger } = require("./riderAuth");

const MERCHANT_SESSION_SUBJECT = "harvey-merchant";
const CLOCK_SKEW_TOLERANCE_MS = 60 * 1000;

function signMerchantSession({ merchantUserId, merchantId, sessionVersion, secret, ttlHours, now = Date.now() }) {
  if (!secret) throw new Error("signMerchantSession requires a secret.");
  if (!merchantUserId || !merchantId) throw new Error("signMerchantSession requires merchantUserId and merchantId.");
  if (!isNonNegativeInteger(sessionVersion)) throw new Error("sessionVersion must be a nonnegative integer.");
  if (!Number.isFinite(ttlHours) || ttlHours <= 0) throw new Error("ttlHours must be positive.");
  const payload = {
    sub: MERCHANT_SESSION_SUBJECT,
    merchant_user_id: String(merchantUserId),
    merchant_id: String(merchantId),
    session_version: sessionVersion,
    iat: now,
    exp: now + ttlHours * 60 * 60 * 1000
  };
  const encoded = base64UrlEncode(JSON.stringify(payload));
  const sig = crypto.createHmac("sha256", secret).update(encoded).digest("hex");
  return `${encoded}.${sig}`;
}

// Signature, structure and expiry only. server.js compares session_version
// with the live merchant_users row and checks the store is still approved.
function verifyMerchantSession({ token, secret, now = Date.now() }) {
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
  if (!p || p.sub !== MERCHANT_SESSION_SUBJECT || typeof p.merchant_user_id !== "string" || typeof p.merchant_id !== "string") {
    return { ok: false, reason: "malformed" };
  }
  if (!isNonNegativeInteger(p.session_version) || !Number.isFinite(p.iat) || !Number.isFinite(p.exp)) return { ok: false, reason: "malformed" };
  if (p.iat > now + CLOCK_SKEW_TOLERANCE_MS) return { ok: false, reason: "malformed" };
  if (now >= p.exp) return { ok: false, reason: "expired" };
  return { ok: true, payload: p };
}

const DAY_NAMES = Object.freeze(["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]);
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

// days: exactly 7 entries { day_of_week 0-6, closed, opens_at "HH:MM", closes_at "HH:MM" }.
// One window per day, closing after it opens on the same day (Nashville
// time). Returns { ok: true, rows } or { ok: false, error }.
function validateStoreHours(days) {
  if (!Array.isArray(days) || days.length !== 7) return { ok: false, error: "Send all seven days." };
  const seen = new Set();
  const rows = [];
  for (const d of days) {
    const day = Number(d && d.day_of_week);
    if (!Number.isInteger(day) || day < 0 || day > 6 || seen.has(day)) return { ok: false, error: "Each day of the week must appear once." };
    seen.add(day);
    if (d.closed === true) {
      rows.push({ day_of_week: day, closed: true, opens_at: null, closes_at: null });
      continue;
    }
    const opens = String(d.opens_at || "");
    const closes = String(d.closes_at || "");
    if (!TIME.test(opens) || !TIME.test(closes)) return { ok: false, error: `${DAY_NAMES[day]}: enter opening and closing times, or mark it closed.` };
    if (closes <= opens) return { ok: false, error: `${DAY_NAMES[day]}: closing time must be after opening time.` };
    rows.push({ day_of_week: day, closed: false, opens_at: opens, closes_at: closes });
  }
  rows.sort((a, b) => a.day_of_week - b.day_of_week);
  return { ok: true, rows };
}

module.exports = { MERCHANT_SESSION_SUBJECT, signMerchantSession, verifyMerchantSession, validateStoreHours, DAY_NAMES };

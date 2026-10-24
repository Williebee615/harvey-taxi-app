// Time-based one-time codes (RFC 6238, the "authenticator app" standard:
// Google Authenticator, Microsoft Authenticator, 1Password and so on) for
// the admin sign-in's second step (owner decision 2026-10-24).
//
// Pure: no I/O. The server stores the secret encrypted (encryptSecret /
// decryptSecret, AES-256-GCM) and remembers the last accepted time step,
// so a code can be used only once.

const crypto = require("crypto");

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const STEP_SECONDS = 30;
const DIGITS = 6;

function base32Encode(buf) {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(text) {
  const clean = String(text || "").toUpperCase().replace(/[\s=-]/g, "");
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of clean) {
    const idx = BASE32.indexOf(ch);
    if (idx === -1) throw new Error("invalid base32");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

// 20 random bytes (160 bits), the size RFC 4226 recommends for HMAC-SHA1.
function generateSecret() {
  return base32Encode(crypto.randomBytes(20));
}

function codeAt(secret, step) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = crypto.createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 15;
  const binary = hmac.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 10 ** DIGITS).padStart(DIGITS, "0");
}

const stepFor = (nowMs) => Math.floor(nowMs / 1000 / STEP_SECONDS);

// Accepts the current step and one either side (about ±30 seconds of
// clock drift). Returns the matched step, or null. A step at or before
// lastStep is refused, so a code can't be replayed.
function verifyCode(secret, code, { nowMs = Date.now(), lastStep = -1 } = {}) {
  const candidate = String(code || "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(candidate)) return null;
  const current = stepFor(nowMs);
  for (const step of [current - 1, current, current + 1]) {
    if (step <= lastStep) continue;
    const expected = codeAt(secret, step);
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(candidate))) return step;
  }
  return null;
}

// The link an authenticator app opens (and that a setup screen can show
// as text). Issuer and account name only; no other data.
function otpauthUri({ secret, account, issuer = "Harvey Taxi Admin" }) {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`;
}

// Key for encrypting the stored secret, derived from a server secret so
// no new environment variable is needed. Rotating that server secret
// means re-enrolling the authenticator.
function deriveKey(serverSecret, label) {
  return Buffer.from(crypto.hkdfSync("sha256", Buffer.from(String(serverSecret)), Buffer.alloc(0), Buffer.from(label), 32));
}

function encryptSecret(secret, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(String(secret), "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), body.toString("base64")].join(".");
}

function decryptSecret(stored, key) {
  const [version, iv, tag, body] = String(stored || "").split(".");
  if (version !== "v1" || !iv || !tag || !body) throw new Error("unreadable secret");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(body, "base64")), decipher.final()]).toString("utf8");
}

// One-time recovery codes for when the phone is lost: 10 random
// characters each, shown once; only their SHA-256 hashes are stored
// (high-entropy random codes don't need a slow hash).
function generateRecoveryCodes(count = 8) {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  return Array.from({ length: count }, () => {
    const bytes = crypto.randomBytes(10);
    const raw = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });
}

const normalizeRecoveryCode = (code) => String(code || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const hashRecoveryCode = (code) => crypto.createHash("sha256").update(normalizeRecoveryCode(code)).digest("hex");

module.exports = {
  STEP_SECONDS,
  base32Encode,
  base32Decode,
  generateSecret,
  codeAt,
  stepFor,
  verifyCode,
  otpauthUri,
  deriveKey,
  encryptSecret,
  decryptSecret,
  generateRecoveryCodes,
  hashRecoveryCode
};

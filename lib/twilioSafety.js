// Twilio helpers kept out of server.js so they can be unit-tested
// without a Twilio account: phone formatting for Twilio Verify, and
// log-safe descriptions of numbers, messages and Twilio errors.

// Twilio Verify only accepts strict E.164 (error 60200/60436 otherwise).
// Drivers' phone numbers are stored as typed at signup, so the same
// driver can be on file as "+16155550101", "16155550101",
// "(615) 555-0101" or "6155550101". The old formatter only prepended
// "+", which turned a bare 10-digit US number into "+6155550101" -- a
// number Twilio rejects, so that driver could never receive a login
// code.
//
// Rules (Harvey Taxi operates in the US):
// - already "+<digits>": kept as is when it has 8 to 15 digits;
// - exactly 10 digits: a US number without its country code -> "+1...";
// - 11 to 15 digits: already includes a country code -> "+...";
// - anything else: null, so the caller fails closed instead of asking
//   Twilio to text a malformed number.
function toVerifyE164(phone) {
  const raw = String(phone == null ? "" : phone).trim();
  const digits = raw.replace(/\D/g, "");

  if (raw.replace(/[^\d+]/g, "").startsWith("+")) {
    return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  }
  if (digits.length === 10) {
    return `+1${digits}`;
  }
  if (digits.length >= 11 && digits.length <= 15) {
    return `+${digits}`;
  }
  return null;
}

// Last two digits only -- enough to tell two test numbers apart in a
// log, not enough to identify a person.
function redactPhone(phone) {
  const digits = String(phone == null ? "" : phone).replace(/\D/g, "");
  if (!digits) return "(none)";
  return `•••${digits.slice(-2)}`;
}

// What the "SMS skipped" log may record. The body is deliberately
// omitted: it can carry a one-time verification code, and server logs
// are readable by far more people (and services) than the rider's phone.
function smsSkippedLogDetails({ to, body } = {}) {
  return {
    to: redactPhone(to),
    body_chars: typeof body === "string" ? body.length : 0
  };
}

// Twilio error messages can echo request parameters back (for example
// "Invalid parameter `To`: +1615..."), so log only the numeric code and
// HTTP status, which are what Twilio's error dictionary is keyed on.
function describeTwilioError(err) {
  if (!err || typeof err !== "object") return "twilio_error";
  const parts = [];
  if (err.code !== undefined && err.code !== null) parts.push(`code=${err.code}`);
  if (err.status !== undefined && err.status !== null) parts.push(`status=${err.status}`);
  return parts.length ? parts.join(" ") : "twilio_error";
}

module.exports = {
  toVerifyE164,
  redactPhone,
  smsSkippedLogDetails,
  describeTwilioError
};

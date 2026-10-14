// Harvey Taxi driver-application review assistant
// (docs/driver-review-assistant.md). Separate from HTAF's assistant.
//
// Summarises a driver application for Harvey Taxi onboarding staff:
// contact verification, identity (Persona) and background (Checkr) status,
// license / vehicle / insurance records, expiration dates when recorded,
// and possible duplicate accounts. Every output is a suggestion:
//   - it never approves, rejects, activates or suspends a driver;
//   - it runs entirely on Harvey Taxi's server: fixed rules, no AI model,
//     no network call, no telemetry;
//   - Persona and Checkr show "verified" only when the integration itself
//     recorded the result; a status set by staff is shown as such, and an
//     entered or uploaded item is never treated as verified;
//   - a possible duplicate is a prompt to compare accounts, not evidence of
//     fraud;
//   - the output never contains the driver's name, email, phone, address,
//     license number, plate, password data or payment details.
// Pure: takes plain objects, returns a plain object. No I/O.

const ENGINE = "driver-review-assist-v2";

const LABEL =
  "Automated suggestions from Harvey Taxi's own onboarding rules (no AI model). Not a decision: staff approve, reject, activate or suspend every driver. Check each item before acting.";

// Integration and record states, in the owner's words.
const STATE = Object.freeze({
  NOT_CONFIGURED: "not configured",
  NOT_STARTED: "not started",
  PENDING: "pending",
  VERIFIED: "verified",
  NEEDS_REVIEW: "result needs staff review",
  STAFF_RECORDED: "recorded by staff (not confirmed by the integration)"
});

const PERSONA_APPROVED = new Set(["approved", "completed", "passed", "verified"]);
const SOURCE_LABEL = { driver_entered: "entered by the driver", staff_from_document: "entered by staff from the document", provider: "reported by a verification provider" };
const VERIFICATION_LABEL = { unverified: "unverified", staff_verified: "verified by staff", provider_verified: "verified by a provider" };
const PERSONA_FAILED = new Set(["declined", "failed", "expired", "needs_review", "marked_for_review"]);
const CHECKR_CLEAR = new Set(["clear", "complete", "completed"]);
const CHECKR_REVIEW = new Set(["consider", "suspended", "dispute", "canceled", "cancelled", "adverse_action"]);

const CHECKS = Object.freeze({
  email_not_verified: { kind: "missing", message: "Email address not verified." },
  phone_not_verified: { kind: "missing", message: "Phone number not verified." },
  identity_not_configured: { kind: "check", message: "Identity verification (Persona) is not configured, so identity can't be confirmed here." },
  identity_not_started: { kind: "missing", message: "Identity verification (Persona) has not been started." },
  identity_pending: { kind: "check", message: "Identity verification (Persona) is pending." },
  identity_needs_review: { kind: "check", message: "Persona returned a result that needs staff review." },
  identity_staff_recorded: { kind: "check", message: "Identity is marked verified, but Persona has no record of it: it was set by staff. Confirm before relying on it." },
  background_not_configured: { kind: "check", message: "Background checks (Checkr) are not configured, so the background check can't be confirmed here." },
  background_not_started: { kind: "missing", message: "Background check (Checkr) has not been started." },
  background_pending: { kind: "check", message: "Background check (Checkr) is pending." },
  background_needs_review: { kind: "check", message: "Checkr returned a result that needs staff review." },
  background_staff_recorded: { kind: "check", message: "Background check is marked clear, but Checkr has no record of it: it was set by staff. Confirm before relying on it." },
  license_missing: { kind: "missing", message: "No driver's license number entered." },
  license_not_verified: { kind: "check", message: "A license number is entered but not marked verified by staff." },
  vehicle_incomplete: { kind: "missing", message: "Vehicle details are incomplete (make, model, year or plate)." },
  insurance_missing: { kind: "missing", message: "No insurance confirmation on file." },
  insurance_self_reported: { kind: "check", message: "Insurance is confirmed by the driver only; it has not been marked verified by staff." },
  expiration_not_recorded: { kind: "check", message: "License, insurance and registration expiration dates are not recorded in Harvey Taxi's system. Check the documents directly." },
  license_expired: { kind: "check", message: "The recorded license expiration date has passed." },
  insurance_expired: { kind: "check", message: "The recorded insurance expiration date has passed." },
  registration_expired: { kind: "check", message: "The recorded vehicle registration expiration date has passed." },
  expiring_soon: { kind: "check", message: "A recorded license, insurance or registration date expires within 30 days." },
  expiration_unverified: { kind: "check", message: "At least one recorded expiration date has not been checked against the document. Treat it as unverified." },
  consents_missing: { kind: "missing", message: "Terms, background-check consent or driver policy not accepted." },
  possible_duplicate: {
    kind: "check",
    message: "Another driver account shares an email, phone, license number or plate. This is a prompt to compare the accounts, not evidence of fraud."
  }
});

const DAY = 24 * 60 * 60 * 1000;
const text = (v) => (typeof v === "string" ? v.trim() : "");
const low = (v) => text(v).toLowerCase();
const yes = (v) => v === true || ["true", "yes", "1"].includes(low(v));

function isoDay(value) {
  if (!value) return null;
  const s = typeof value === "string" ? value : value instanceof Date ? value.toISOString() : "";
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  return m && Number.isFinite(Date.parse(m[1])) ? m[1] : null;
}

// Persona: "verified" only with a Persona inquiry on file and an approved
// result recorded by the integration.
function personaState(d, configured) {
  const status = low(d.persona_status || d.identity_status);
  const inquiry = text(d.persona_inquiry_id);
  const marked = yes(d.persona_verified) || yes(d.identity_verified);
  if (!configured) return STATE.NOT_CONFIGURED;
  if (inquiry && marked && PERSONA_APPROVED.has(status)) return STATE.VERIFIED;
  if (marked && !inquiry) return STATE.STAFF_RECORDED;
  if (PERSONA_FAILED.has(status)) return STATE.NEEDS_REVIEW;
  if (!inquiry && !status) return STATE.NOT_STARTED;
  return STATE.PENDING;
}

// Checkr: "verified" only with a Checkr candidate on file and a clear
// result recorded by the integration (not a staff override).
function checkrState(d, configured, { staffOverride = false } = {}) {
  const status = low(d.checkr_status || d.background_check_status);
  const candidate = text(d.checkr_candidate_id);
  if (!configured) return STATE.NOT_CONFIGURED;
  if (CHECKR_CLEAR.has(status)) return candidate && !staffOverride ? STATE.VERIFIED : STATE.STAFF_RECORDED;
  if (CHECKR_REVIEW.has(status)) return STATE.NEEDS_REVIEW;
  if (!candidate && !status) return STATE.NOT_STARTED;
  return STATE.PENDING;
}

const STATE_CHECK = {
  identity: {
    [STATE.NOT_CONFIGURED]: "identity_not_configured",
    [STATE.NOT_STARTED]: "identity_not_started",
    [STATE.PENDING]: "identity_pending",
    [STATE.NEEDS_REVIEW]: "identity_needs_review",
    [STATE.STAFF_RECORDED]: "identity_staff_recorded"
  },
  background: {
    [STATE.NOT_CONFIGURED]: "background_not_configured",
    [STATE.NOT_STARTED]: "background_not_started",
    [STATE.PENDING]: "background_pending",
    [STATE.NEEDS_REVIEW]: "background_needs_review",
    [STATE.STAFF_RECORDED]: "background_staff_recorded"
  }
};

// driver: one drivers row (extra fields ignored).
// options.integrations: { persona: boolean, checkr: boolean } -- whether
//   each integration is configured on the server right now.
// options.staffOverrides: { checkr: boolean, persona: boolean } -- whether
//   a staff compliance override is on record for this driver.
// options.related: other driver accounts sharing an identifier, as
//   [{ id, created_at, status, matched: ["email"|"phone"|"license"|"plate"] }].
// options.today: "YYYY-MM-DD".
function reviewDriver(driver, { integrations = {}, staffOverrides = {}, related = [], documents = [], today } = {}) {
  const d = driver && typeof driver === "object" ? driver : {};
  const day = isoDay(today) || new Date().toISOString().slice(0, 10);
  const found = [];
  const add = (id, extra = {}) => found.push({ id, kind: CHECKS[id].kind, message: CHECKS[id].message, ...extra });

  const email = yes(d.email_verified) ? STATE.VERIFIED : "not verified";
  const phone = yes(d.phone_verified) || yes(d.sms_verified) ? STATE.VERIFIED : "not verified";
  if (email !== STATE.VERIFIED) add("email_not_verified");
  if (phone !== STATE.VERIFIED) add("phone_not_verified");

  const identity = personaState(d, !!integrations.persona);
  let effectiveIdentity = identity;
  if (identity === STATE.VERIFIED && staffOverrides.persona) effectiveIdentity = STATE.STAFF_RECORDED;
  if (effectiveIdentity !== STATE.VERIFIED) add(STATE_CHECK.identity[effectiveIdentity]);

  const background = checkrState(d, !!integrations.checkr, { staffOverride: !!staffOverrides.checkr });
  if (background !== STATE.VERIFIED) add(STATE_CHECK.background[background]);

  const licenseEntered = !!(text(d.drivers_license_number) || text(d.license_number));
  const licenseVerified = low(d.license_status) === "verified";
  const license = licenseVerified ? "verified by staff" : licenseEntered ? "entered, not verified" : "missing";
  if (!licenseEntered && !licenseVerified) add("license_missing");
  else if (!licenseVerified) add("license_not_verified");

  const vehicleFields = [d.vehicle_make, d.vehicle_model, d.vehicle_year, d.vehicle_plate || d.license_plate];
  const vehicleComplete = vehicleFields.every((v) => text(String(v ?? "")));
  if (!vehicleComplete) add("vehicle_incomplete");

  const insuranceVerified = low(d.insurance_status) === "verified";
  const insuranceSelf = yes(d.insurance_confirmed);
  const insurance = insuranceVerified ? "verified by staff" : insuranceSelf ? "confirmed by driver only" : "missing";
  if (!insuranceVerified && !insuranceSelf) add("insurance_missing");
  else if (!insuranceVerified) add("insurance_self_reported");

  // Expiration dates come from driver_document_records (the current
  // record per document), each with where it came from and whether it was
  // checked. An unverified date is shown as unverified, never as fact.
  const DOC_NAMES = { drivers_license: "license", insurance: "insurance", vehicle_registration: "registration" };
  const records = Array.isArray(documents) ? documents : [];
  const dates = {};
  const dateDetails = {};
  for (const [docType, name] of Object.entries(DOC_NAMES)) {
    const r = records.find((x) => x && x.document_type === docType);
    const value = r ? isoDay(r.expires_on) : null;
    dates[name] = value;
    if (value) {
      dateDetails[name] = {
        expires_on: value,
        source: SOURCE_LABEL[r.source] || "unknown source",
        verification: VERIFICATION_LABEL[r.verification_status] || "unverified"
      };
    }
  }
  const anyDate = Object.values(dates).some(Boolean);
  if (!anyDate) add("expiration_not_recorded");
  let soon = false;
  let unverified = false;
  for (const [name, value] of Object.entries(dates)) {
    if (!value) continue;
    if (dateDetails[name].verification === "unverified") unverified = true;
    const days = Math.round((Date.parse(value) - Date.parse(day)) / DAY);
    if (days < 0) add(`${name}_expired`, { date: value, verification: dateDetails[name].verification });
    else if (days <= 30) soon = true;
  }
  if (soon) add("expiring_soon");
  if (unverified) add("expiration_unverified");

  const consents = [d.accepted_terms ?? d.terms_accepted, d.accepted_background_check_consent ?? d.background_check_accepted, d.accepted_driver_policy];
  if (!consents.every(yes)) add("consents_missing");

  const others = (Array.isArray(related) ? related : [])
    .map((r) => ({
      account: text(r && r.id),
      created: isoDay(r && r.created_at),
      status: text(r && (r.status || r.approval_status)) || "unknown",
      matched: (Array.isArray(r && r.matched) ? r.matched : []).filter((m) => ["email", "phone", "license", "plate"].includes(m))
    }))
    .filter((r) => r.account && r.matched.length)
    .slice(0, 5);
  if (others.length) add("possible_duplicate", { related: others });

  const status = {
    email,
    phone,
    identity_persona: effectiveIdentity,
    background_checkr: background,
    license,
    vehicle: vehicleComplete ? "details entered" : "incomplete",
    insurance,
    expiration_dates: anyDate ? dateDetails : "not recorded"
  };

  const missing = found.filter((c) => c.kind === "missing").length;
  const summary = [
    `Email ${email}; phone ${phone}.`,
    `Identity (Persona): ${effectiveIdentity}. Background (Checkr): ${background}.`,
    `License: ${license}. Vehicle: ${status.vehicle}. Insurance: ${insurance}.`,
    `Expiration dates: ${anyDate ? "recorded" : "not recorded"}.`,
    found.length ? `${missing} missing item${missing === 1 ? "" : "s"}, ${found.length - missing} to check.` : "Nothing outstanding found by the rules."
  ].join(" ");

  return { engine: ENGINE, processing: "internal", label: LABEL, summary, status, checks: found };
}

module.exports = { ENGINE, LABEL, STATE, CHECKS, personaState, checkrState, reviewDriver };

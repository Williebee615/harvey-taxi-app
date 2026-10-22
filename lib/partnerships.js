// Business partnership inquiries from merchant-apply.html (owner decision
// 2026-10-22: two paths on the page; inquiries stored in their own table
// with an admin list). An inquiry is a request to talk, not an
// application for any service: nothing is approved or promised by
// submitting one. Stores joining the delivery pilot use the separate
// merchant application (lib/merchants.js).

const { toUsE164 } = require("./merchants");

const BUSINESS_TYPES = Object.freeze({
  sole_proprietorship: "Sole proprietorship",
  llc: "LLC",
  corporation: "Corporation",
  nonprofit: "Nonprofit organization",
  partnership: "Partnership",
  other: "Other"
});

const INDUSTRIES = Object.freeze({
  retail: "Retail",
  hospitality: "Hospitality",
  healthcare: "Healthcare",
  travel_tourism: "Travel and tourism",
  property_management: "Property management",
  professional_services: "Professional services",
  other: "Other"
});

const INTERESTS = Object.freeze({
  transportation_partnership: "Transportation partnerships",
  merchant_collaboration: "Merchant collaborations",
  corporate_transportation: "Corporate transportation inquiries",
  customer_referrals: "Customer referral opportunities",
  promotional_partnership: "Promotional partnerships",
  other: "Other"
});

const STATUSES = Object.freeze(["new", "contacted", "closed"]);

// The consent wording the applicant agreed to; stored with each inquiry.
const CONSENT_VERSION = "2026-10-22";

// A person takes longer than this to fill in the form; faster is a bot.
const MIN_FILL_MS = 3000;

const str = (v, max) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

// Spam signals that drop a submission quietly (the sender sees the same
// confirmation, nothing is stored): the hidden "fax" field filled in, or
// the form sent faster than a person could fill it.
function looksAutomated(body = {}, now = Date.now()) {
  if (str(body.company_fax, 100)) return "honeypot";
  const started = Number(body.form_started_at);
  if (Number.isFinite(started) && started > 0 && now - started < MIN_FILL_MS) return "too_fast";
  return null;
}

// Returns { ok: true, row } or { ok: false, error }.
function validatePartnershipInquiry(body = {}, { now = new Date() } = {}) {
  const interests = Array.isArray(body.interests) ? [...new Set(body.interests.map((i) => str(i, 40)))] : [];
  const row = {
    organization_name: str(body.organization_name, 160),
    website: str(body.website, 300) || null,
    business_type: str(body.business_type, 40),
    industry: str(body.industry, 40),
    address_line: str(body.address_line, 240) || null,
    city: str(body.city, 80),
    state: str(body.state, 40).toUpperCase(),
    postal_code: str(body.postal_code, 10) || null,
    contact_name: str(body.contact_name, 120),
    job_title: str(body.job_title, 120) || null,
    contact_email: str(body.contact_email, 254).toLowerCase(),
    contact_phone: toUsE164(body.contact_phone),
    interests,
    message: typeof body.message === "string" ? body.message.trim().slice(0, 2000) : "",
    consent_version: CONSENT_VERSION,
    consented_at: now.toISOString(),
    status: "new"
  };
  const fail = (error) => ({ ok: false, error });
  if (row.organization_name.length < 2) return fail("Enter your organization's name.");
  if (row.website && !/^https?:\/\/[^\s.]+\.[^\s]+$/i.test(row.website)) return fail("Enter the website as a full address, starting with https://.");
  if (!BUSINESS_TYPES[row.business_type]) return fail("Choose a business type.");
  if (!INDUSTRIES[row.industry]) return fail("Choose an industry.");
  if (row.city.length < 2) return fail("Enter the city.");
  if (!/^[A-Z]{2}$/.test(row.state)) return fail("Enter the two-letter state.");
  if (row.postal_code && !/^[0-9]{5}$/.test(row.postal_code)) return fail("Enter a 5-digit ZIP code.");
  if (row.contact_name.length < 2) return fail("Enter a contact name.");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(row.contact_email)) return fail("Enter a valid business email.");
  if (!row.contact_phone) return fail("Enter a 10-digit US phone number.");
  if (!row.interests.length || !row.interests.every((i) => INTERESTS[i])) return fail("Choose at least one partnership interest.");
  if (row.message.length < 20) return fail("Tell us a little about your business and what you'd like to discuss (at least 20 characters).");
  if (body.consent !== true) return fail("Confirm that Harvey Taxi may use these details to review and respond to your inquiry.");
  return { ok: true, row };
}

// Returns { ok: true, update } or { ok: false, error, statusCode }.
function planStatusChange({ inquiry, status, note, reviewer, now = new Date() }) {
  if (!STATUSES.includes(status)) return { ok: false, error: "Status must be new, contacted or closed.", statusCode: 400 };
  if (!inquiry) return { ok: false, error: "Inquiry not found.", statusCode: 404 };
  const staffNote = str(note, 1000) || null;
  return {
    ok: true,
    update: { status, staff_note: staffNote ?? inquiry.staff_note ?? null, reviewed_by: reviewer, reviewed_at: now.toISOString(), updated_at: now.toISOString() }
  };
}

// Plain-text copy emailed to support. Labels, not codes.
function inquiryEmailText(row, id) {
  return [
    `Inquiry: ${id}`,
    `Organization: ${row.organization_name}`,
    `Business type: ${BUSINESS_TYPES[row.business_type]}`,
    `Industry: ${INDUSTRIES[row.industry]}`,
    `Location: ${[row.address_line, row.city, row.state, row.postal_code].filter(Boolean).join(", ")}`,
    row.website ? `Website: ${row.website}` : null,
    `Contact: ${row.contact_name}${row.job_title ? `, ${row.job_title}` : ""}`,
    `Email: ${row.contact_email}`,
    `Phone: ${row.contact_phone}`,
    `Interests: ${row.interests.map((i) => INTERESTS[i]).join("; ")}`,
    "",
    row.message,
    "",
    "Review and update the status on the admin dashboard (Partnership Inquiries). Submitting an inquiry does not approve or commit to anything."
  ]
    .filter((line) => line !== null)
    .join("\n");
}

module.exports = {
  BUSINESS_TYPES,
  INDUSTRIES,
  INTERESTS,
  STATUSES,
  CONSENT_VERSION,
  MIN_FILL_MS,
  looksAutomated,
  validatePartnershipInquiry,
  planStatusChange,
  inquiryEmailText
};

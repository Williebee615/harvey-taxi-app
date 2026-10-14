// HTAF application review assistant (docs/htaf-review-assistant.md).
//
// Helps HTAF staff review an application: a short factual summary,
// missing-information checks, and suggested follow-up questions. Every
// output is an automated suggestion for a person to accept, correct or
// ignore:
//   - it never approves, denies or ranks an application, never changes its
//     status, never schedules rides and never contacts the applicant;
//   - it runs entirely inside HTAF's server: fixed rules, no AI model, no
//     network call, no third-party provider;
//   - it reads only the fields listed in FIELDS_READ, most of them only to
//     check whether they were filled in, and its output never contains the
//     applicant's name, contact details, addresses, income, household size,
//     free-text description or staff notes.
// Pure: takes an application object and returns a plain object. No I/O.

const ENGINE = "htaf-review-assist-v2";

const LABEL =
  "Automated suggestions from HTAF's own review rules (no AI model). Not a decision: a person approves or denies every application. Check each item before acting.";

// What the rules look at, and how. "presence" fields are only checked for
// being filled in; their content never reaches the output.
const FIELDS_READ = Object.freeze([
  { field: "first_name", use: "presence" },
  { field: "last_name", use: "presence" },
  { field: "email", use: "presence (and, on the server, to find other applications with the same email)" },
  { field: "phone", use: "presence (and, on the server, to find other applications with the same phone)" },
  { field: "county", use: "checked against Tennessee's 95 counties; the county name may appear in the summary" },
  { field: "pickup_city", use: "presence" },
  { field: "destination", use: "presence" },
  { field: "ride_date", use: "missing / past / date shown" },
  { field: "transportation_need", use: "length only (missing, brief, detailed)" },
  { field: "program_type", use: "category shown" },
  { field: "applicant_type", use: "category shown (self or on behalf)" },
  { field: "status", use: "shown" },
  { field: "submitted_at / created_at", use: "age of the application" }
]);

// Never read by the rules.
const FIELDS_NOT_READ = Object.freeze(["household_size", "monthly_income", "notes", "review_notes", "city", "assigned_admin"]);

// Tennessee's 95 counties.
const TENNESSEE_COUNTIES = new Set(
  [
    "Anderson", "Bedford", "Benton", "Bledsoe", "Blount", "Bradley", "Campbell", "Cannon", "Carroll", "Carter",
    "Cheatham", "Chester", "Claiborne", "Clay", "Cocke", "Coffee", "Crockett", "Cumberland", "Davidson", "Decatur",
    "DeKalb", "Dickson", "Dyer", "Fayette", "Fentress", "Franklin", "Gibson", "Giles", "Grainger", "Greene",
    "Grundy", "Hamblen", "Hamilton", "Hancock", "Hardeman", "Hardin", "Hawkins", "Haywood", "Henderson", "Henry",
    "Hickman", "Houston", "Humphreys", "Jackson", "Jefferson", "Johnson", "Knox", "Lake", "Lauderdale", "Lawrence",
    "Lewis", "Lincoln", "Loudon", "McMinn", "McNairy", "Macon", "Madison", "Marion", "Marshall", "Maury",
    "Meigs", "Monroe", "Montgomery", "Moore", "Morgan", "Obion", "Overton", "Perry", "Pickett", "Polk",
    "Putnam", "Rhea", "Roane", "Robertson", "Rutherford", "Scott", "Sequatchie", "Sevier", "Shelby", "Smith",
    "Stewart", "Sullivan", "Sumner", "Tipton", "Trousdale", "Unicoi", "Union", "Van Buren", "Warren", "Washington",
    "Wayne", "Weakley", "White", "Williamson", "Wilson"
  ]
);

const PROGRAM_LABELS = Object.freeze({
  medical: "Medical transportation",
  employment: "Employment access",
  education: "Education access",
  senior: "Senior assistance",
  disability: "Disability assistance",
  veteran: "Veteran assistance"
});

const STATUS_LABELS = Object.freeze({
  submitted: "Submitted",
  under_review: "Under review",
  pending_documents: "Pending documents",
  approved: "Approved",
  denied: "Denied",
  scheduled: "Scheduled",
  completed: "Completed"
});

// Every check the rules can raise, with the follow-up question staff may
// choose to ask. Wording is neutral: it asks for information and never
// suggests an outcome.
const CHECKS = Object.freeze({
  missing_name: {
    kind: "missing",
    message: "The applicant's full name is incomplete.",
    question: "Could you confirm the full name of the person who needs transportation?"
  },
  missing_contact: {
    kind: "missing",
    message: "No email or phone number was given, so HTAF has no way to follow up.",
    question: null
  },
  missing_county: {
    kind: "missing",
    message: "County of residence is missing.",
    question: "Which Tennessee county do you live in?"
  },
  county_not_recognized: {
    kind: "check",
    message: "The county entered doesn't match a Tennessee county name. It may be misspelled or outside Tennessee. Please confirm with the applicant; staff can correct it.",
    question: "Could you confirm which county you live in?"
  },
  missing_pickup: {
    kind: "missing",
    message: "Pickup city is missing.",
    question: "Where will the ride start (city or town)?"
  },
  missing_destination: {
    kind: "missing",
    message: "Destination is missing.",
    question: "Where do you need to go for this trip?"
  },
  missing_ride_date: {
    kind: "missing",
    message: "Ride date is missing.",
    question: "What date do you need the ride?"
  },
  ride_date_past: {
    kind: "check",
    message: "The ride date is before today (Central time).",
    question: "Do you still need transportation, and if so, on what date?"
  },
  ride_date_today: {
    kind: "check",
    message: "The ride is requested for today (Central time). Check whether it can still be arranged.",
    question: null
  },
  need_missing: {
    kind: "missing",
    message: "The reason for the trip wasn't described.",
    question: "Could you briefly describe what the trip is for (for example, an appointment or work shift)?"
  },
  need_brief: {
    kind: "check",
    message: "The trip description is very short; there may not be enough detail to review.",
    question: "Could you tell us a little more about what the trip is for?"
  },
  program_unspecified: {
    kind: "missing",
    message: "No program category was selected.",
    question: "Which kind of trip is this: medical, employment, education, senior, disability or veteran?"
  },
  possible_duplicate: {
    kind: "check",
    message: "Possible duplicate: another application shares this email or phone number. Households, caregivers and caseworkers often share contact details, and a person may apply for separate trips. This is not a reason to deny; compare the applications before deciding.",
    question: null
  }
});

// Shown on every review: HTAF's stated coverage is Tennessee statewide,
// but coverage never confirms funding, a ride, eligibility or approval.
// These are always staff decisions.
const STAFF_CHECKS = Object.freeze([
  { id: "funding", text: "Funding available for this trip: staff to confirm." },
  { id: "transportation", text: "Transportation available on the requested date: staff to confirm." },
  { id: "eligibility", text: "Eligibility and approval: staff decision." }
]);

const TIME_ZONE = "America/Chicago";

// Today's calendar date in Nashville (Central time), as YYYY-MM-DD.
function centralToday(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

// A timestamp's calendar date in Central time; a date-only value
// ("2026-10-20", the form's ride date) is taken as that calendar date.
function centralDay(value) {
  if (!value) return null;
  const s = typeof value === "string" ? value.trim() : value instanceof Date ? value.toISOString() : "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return Number.isFinite(Date.parse(s)) ? s : null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? centralToday(new Date(t)) : null;
}

const BRIEF_NEED_LENGTH = 20;
const DAY = 24 * 60 * 60 * 1000;

const text = (v) => (typeof v === "string" ? v.trim() : "");

// County spelling: accepts "Davidson", "davidson county", "Davidson Co.",
// "Davidson Cnty, TN", "De Kalb", "Mc Minn", extra spaces and punctuation.
const COUNTY_KEY = (v) => String(v || "").toLowerCase().replace(/[^a-z]/g, "");
const COUNTY_BY_KEY = new Map();
for (const name of TENNESSEE_COUNTIES) COUNTY_BY_KEY.set(String(name).toLowerCase().replace(/[^a-z]/g, ""), name);

function normalizeCounty(value) {
  const cleaned = text(value)
    .toLowerCase()
    .replace(/[.,]/g, " ")
    .replace(/\b(tn|tenn|tennessee|usa|us)\b/g, " ")
    .replace(/\b(county|cnty|cty|co)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned;
}

function recognizedCounty(value) {
  const key = COUNTY_KEY(normalizeCounty(value));
  return key ? COUNTY_BY_KEY.get(key) || null : null;
}

function editDistance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const tmp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[b.length];
}

// The closest Tennessee county for a likely misspelling (at most 2 letters
// off), offered to staff as "possibly"; never applied automatically.
function closestCounty(value) {
  const key = COUNTY_KEY(normalizeCounty(value));
  if (key.length < 3) return null;
  let best = null;
  for (const [k, name] of COUNTY_BY_KEY) {
    const d = editDistance(key, k);
    if (d <= 2 && (!best || d < best.d)) best = { d, name };
  }
  return best ? best.name : null;
}

function isoDay(value) {
  if (!value) return null;
  const s = typeof value === "string" ? value : value instanceof Date ? value.toISOString() : "";
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  return m && Number.isFinite(Date.parse(m[1])) ? m[1] : null;
}

function daysBetween(fromDay, toDay) {
  return Math.round((Date.parse(toDay) - Date.parse(fromDay)) / DAY);
}

function relative(days) {
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  return days > 0 ? `in ${days} days` : `${-days} days ago`;
}

// application: one htaf_applications row (any extra fields are ignored).
// options.today: "YYYY-MM-DD" (defaults to the current UTC date).
// options.related: other applications with the same email or phone, as
//   [{ application_code, status, submitted_at }] -- found by the server.
function reviewApplication(application, { today, related = [] } = {}) {
  const a = application && typeof application === "object" ? application : {};
  const day = centralDay(today) || centralToday();
  const found = [];
  const add = (id, extra = {}) => found.push({ id, kind: CHECKS[id].kind, message: CHECKS[id].message, ...extra });

  if (!text(a.first_name) || !text(a.last_name)) add("missing_name");
  if (!text(a.email) && !text(a.phone)) add("missing_contact");

  const countyEntered = normalizeCounty(a.county);
  const county = recognizedCounty(a.county);
  if (!countyEntered) add("missing_county");
  else if (!county) {
    const possibly = closestCounty(a.county);
    add("county_not_recognized", possibly ? { possibly: `${possibly} County` } : {});
  }

  if (!text(a.pickup_city)) add("missing_pickup");
  if (!text(a.destination)) add("missing_destination");

  const rideDay = centralDay(a.ride_date);
  if (!rideDay) add("missing_ride_date");
  else if (daysBetween(day, rideDay) < 0) add("ride_date_past");
  else if (daysBetween(day, rideDay) === 0) add("ride_date_today");

  const need = text(a.transportation_need);
  if (!need) add("need_missing");
  else if (need.length < BRIEF_NEED_LENGTH) add("need_brief");

  const program = text(a.program_type).toLowerCase();
  if (!PROGRAM_LABELS[program]) add("program_unspecified");

  const others = (Array.isArray(related) ? related : [])
    .map((r) => ({
      application_code: text(r && r.application_code),
      status: STATUS_LABELS[text(r && r.status)] || "Unknown",
      submitted: centralDay(r && (r.submitted_at || r.created_at))
    }))
    .filter((r) => r.application_code)
    .slice(0, 5);
  if (others.length) add("possible_duplicate", { related: others });

  // Summary: categories, dates and counts only.
  const parts = [];
  const programLabel = PROGRAM_LABELS[program] || "Unspecified program";
  const who = text(a.applicant_type).toLowerCase() === "self" ? "applying for themselves" : text(a.applicant_type) ? "applying on someone's behalf" : null;
  parts.push(`${programLabel} request${who ? `, ${who}` : ""}.`);
  if (rideDay) parts.push(`Ride date ${rideDay} (${relative(daysBetween(day, rideDay))}, Central time).`);
  if (county) parts.push(`County: ${county}, within HTAF's stated Tennessee coverage. Coverage does not confirm funding, a ride, eligibility or approval.`);
  else if (countyEntered) parts.push("County not recognised.");
  parts.push(`Trip description: ${need ? (need.length < BRIEF_NEED_LENGTH ? "brief" : "provided") : "missing"}.`);
  const submitted = centralDay(a.submitted_at || a.created_at);
  const statusLabel = STATUS_LABELS[text(a.status)] || "Unknown status";
  parts.push(`Status: ${statusLabel}${submitted ? `, received ${relative(daysBetween(day, submitted))}` : ""}.`);
  const missing = found.filter((c) => c.kind === "missing").length;
  const toCheck = found.length - missing;
  parts.push(found.length ? `${missing} missing item${missing === 1 ? "" : "s"}, ${toCheck} item${toCheck === 1 ? "" : "s"} to check.` : "No missing information found by the rules.");

  const followUps = found
    .filter((c) => CHECKS[c.id].question)
    .map((c) => ({ id: c.id, question: CHECKS[c.id].question }));

  return {
    engine: ENGINE,
    processing: "internal",
    label: LABEL,
    summary: parts.join(" "),
    checks: found,
    staff_checks: STAFF_CHECKS.map((c) => ({ ...c })),
    follow_up_questions: followUps
  };
}

module.exports = {
  ENGINE,
  LABEL,
  FIELDS_READ,
  FIELDS_NOT_READ,
  CHECKS,
  TENNESSEE_COUNTIES,
  STAFF_CHECKS,
  centralToday,
  centralDay,
  normalizeCounty,
  recognizedCounty,
  closestCounty,
  reviewApplication
};

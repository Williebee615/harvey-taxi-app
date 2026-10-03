// Optional Data Collection program (Harvey Taxi Service LLC manages it;
// participating, separately approved drivers perform eligible non-driving
// tasks and record them in the Minute app). See
// docs/data-collection-program.md for the design and rollout gates.
//
// Pure decision logic only -- no Supabase calls, no I/O -- so every rule
// that decides who may apply, who may see the organization code, how a
// recording duration becomes money, and whether an import row is ready,
// a duplicate, unmatched or invalid is unit-testable on its own. server.js
// owns the reads/writes and calls these functions, the same split as
// lib/driverCompliance.js and lib/accountDeletion.js.
//
// Boundaries this module deliberately keeps:
//   - Recording and uploading stay in Minute. Nothing here stores a Minute
//     password or a raw recording, scrapes Minute's portal, or assumes a
//     Minute API exists.
//   - Minute's export format is unknown until a sample is available, so
//     the importer hardcodes no Minute column names: an admin maps the
//     file's own headers to the fields below at preview time.
//   - Program earnings are separate from ride earnings (driver_earnings).
//     Nothing here sends a payment or deducts equipment costs.

const crypto = require("crypto");

/* ---------------------------------------------------------------
   Feature flags (system_flags rows; a missing row means "false")
--------------------------------------------------------------- */

const FLAGS = Object.freeze({
  // Master switch: without it the program is invisible to drivers.
  program: "data_collection_program_enabled",
  // Drivers may submit applications and admins may approve them.
  enrollment: "data_collection_enrollment_enabled",
  // Approved participants see the organization code and download links,
  // and admins may record hours (import commit or manual entry).
  collection: "data_collection_collection_enabled"
});

// Each later gate requires the earlier ones: enrollment or collection
// switched on without the master switch stays off.
function resolveProgramGates(flagValues = {}) {
  const on = (key) => String(flagValues[key] ?? "false").trim().toLowerCase() === "true";
  const program = on(FLAGS.program);
  const enrollment = program && on(FLAGS.enrollment);
  const collection = program && on(FLAGS.collection);
  return { program, enrollment, collection };
}

/* ---------------------------------------------------------------
   Rates and earnings
--------------------------------------------------------------- */

// Integer cents per accepted recording hour. The driver rate is the
// proposed rate and the company rate the current one; both are
// snapshotted onto every hour record so a later rate change never
// rewrites history.
const RATES = Object.freeze({
  driverCentsPerHour: 1000,
  companyCentsPerHour: 1500
});

const SECONDS_PER_HOUR = 3600;

// Hard upper bound on one recording session. Longer values are almost
// certainly a unit mistake in the mapping (minutes read as seconds, etc.).
const MAX_SESSION_SECONDS = 24 * SECONDS_PER_HOUR;

// cents = seconds x rate / 3600, rounded half-up to a whole cent, in
// integer arithmetic only (no floating point). Every record is rounded
// once, and every total is the sum of already-rounded records, so a
// total always equals the sum of its line items. The database checks
// the same formula (see the migration's hour-record amount constraints).
function amountCents(durationSeconds, centsPerHour) {
  const seconds = BigInt(durationSeconds);
  const rate = BigInt(centsPerHour);
  return Number((seconds * rate + BigInt(SECONDS_PER_HOUR / 2)) / BigInt(SECONDS_PER_HOUR));
}

function computeRecordAmounts(durationSeconds, rates = RATES) {
  if (!Number.isInteger(durationSeconds) || durationSeconds <= 0 || durationSeconds > MAX_SESSION_SECONDS) {
    throw new Error("durationSeconds must be a whole number of seconds between 1 and 86400.");
  }
  const driver = amountCents(durationSeconds, rates.driverCentsPerHour);
  const company = amountCents(durationSeconds, rates.companyCentsPerHour);
  return {
    driver_rate_cents: rates.driverCentsPerHour,
    company_rate_cents: rates.companyCentsPerHour,
    driver_amount_cents: driver,
    company_amount_cents: company,
    // Gross margin before expenses. Derived from the two rounded amounts
    // so driver + margin always equals company exactly.
    margin_cents: company - driver
  };
}

/* ---------------------------------------------------------------
   Hour record statuses
--------------------------------------------------------------- */

const HOUR_STATUSES = Object.freeze(["pending", "accepted", "rejected", "payable", "paid"]);

// pending   imported or entered, awaiting review
// accepted  reviewed and counted toward estimated earnings
// rejected  not counted (reason required); may be reopened to pending
// payable   approved for the next manual payout
// paid      paid outside this system (payout reference required); final
const HOUR_TRANSITIONS = Object.freeze({
  pending: Object.freeze(["accepted", "rejected"]),
  accepted: Object.freeze(["payable", "rejected"]),
  payable: Object.freeze(["paid", "accepted"]),
  rejected: Object.freeze(["pending"]),
  paid: Object.freeze([])
});

// Statuses that count toward a driver's estimated earnings.
const EARNING_STATUSES = new Set(["accepted", "payable", "paid"]);

function validateHourTransition({ from, to, reason, payoutReference }) {
  if (!HOUR_STATUSES.includes(from) || !HOUR_STATUSES.includes(to)) {
    return { ok: false, error: "Unknown hour record status." };
  }
  if (!HOUR_TRANSITIONS[from].includes(to)) {
    return { ok: false, error: `Hours cannot move from ${from} to ${to}.` };
  }
  if (to === "rejected" && !cleanText(reason, 500)) {
    return { ok: false, error: "A reason is required to reject hours." };
  }
  if (to === "paid" && !cleanText(payoutReference, 120)) {
    return { ok: false, error: "A payout reference is required to mark hours paid." };
  }
  return { ok: true };
}

// Which admin capability a status change needs: review decisions belong
// to whoever manages hours; payable/paid are payout decisions.
function capabilityForHourTransition(to) {
  return to === "payable" || to === "paid"
    ? "data_collection.payouts.manage"
    : "data_collection.hours.manage";
}

// Totals per status, from stored integer-cent amounts. `includeCompany`
// is false for anything a driver sees: company rate and margin are
// internal figures.
function summarizeHours(records, { includeCompany = false } = {}) {
  const byStatus = {};
  for (const status of HOUR_STATUSES) {
    byStatus[status] = { count: 0, seconds: 0, driver_cents: 0 };
    if (includeCompany) Object.assign(byStatus[status], { company_cents: 0, margin_cents: 0 });
  }
  for (const r of records || []) {
    const bucket = byStatus[r.status];
    if (!bucket) continue;
    bucket.count += 1;
    bucket.seconds += Number(r.duration_seconds) || 0;
    bucket.driver_cents += Number(r.driver_amount_cents) || 0;
    if (includeCompany) {
      bucket.company_cents += Number(r.company_amount_cents) || 0;
      bucket.margin_cents += (Number(r.company_amount_cents) || 0) - (Number(r.driver_amount_cents) || 0);
    }
  }

  const sum = (field, statuses) => statuses.reduce((t, s) => t + byStatus[s][field], 0);
  const earning = [...EARNING_STATUSES];

  const summary = {
    by_status: byStatus,
    accepted_seconds: sum("seconds", earning),
    accepted_hours: secondsToHours(sum("seconds", earning)),
    pending_hours: secondsToHours(byStatus.pending.seconds),
    estimated_earnings_cents: sum("driver_cents", earning),
    unpaid_earnings_cents: sum("driver_cents", ["accepted", "payable"]),
    payable_cents: byStatus.payable.driver_cents,
    paid_cents: byStatus.paid.driver_cents,
    payment_status: paymentStatusLabel(byStatus)
  };

  if (includeCompany) {
    summary.company_revenue_cents = sum("company_cents", earning);
    summary.gross_margin_cents = sum("margin_cents", earning);
  }

  return summary;
}

function paymentStatusLabel(byStatus) {
  if (byStatus.payable.count > 0) return "payment_scheduled";
  if (byStatus.accepted.count > 0) return "awaiting_payment_approval";
  if (byStatus.pending.count > 0) return "hours_under_review";
  if (byStatus.paid.count > 0) return "paid_in_full";
  return "no_hours";
}

// Display only (two decimals); money is never derived from this.
function secondsToHours(seconds) {
  return Math.round((Number(seconds) || 0) / 36) / 100;
}

function formatCents(cents) {
  const n = Number(cents) || 0;
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  return `${sign}$${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/* ---------------------------------------------------------------
   Applications
--------------------------------------------------------------- */

const APPLICATION_STATUSES = Object.freeze(["submitted", "approved", "rejected", "suspended", "withdrawn"]);

// An application in one of these blocks a second one for the same driver
// (also enforced by a partial unique index).
const ACTIVE_APPLICATION_STATUSES = Object.freeze(["submitted", "approved", "suspended"]);

const APPLICATION_TRANSITIONS = Object.freeze({
  submitted: Object.freeze(["approved", "rejected", "withdrawn"]),
  approved: Object.freeze(["suspended"]),
  suspended: Object.freeze(["approved", "rejected"]),
  rejected: Object.freeze([]),
  withdrawn: Object.freeze([])
});

// Only the U.S. for the initial rollout.
const SUPPORTED_COUNTRIES = Object.freeze(["US"]);

const US_STATE_CODES = Object.freeze([
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA", "HI", "ID", "IL", "IN", "IA",
  "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM",
  "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA",
  "WV", "WI", "WY"
]);

const INELIGIBLE_TASK_NOTICE =
  "Ineligible tasks: anything done while driving or operating a vehicle, seated tasks, and repetitive tasks. " +
  "Never record while driving. Only eligible non-driving tasks at an approved commercial location qualify.";

// Words that suggest a proposed task falls in an ineligible category.
// A match does not reject the application (wording varies); it flags the
// task for the reviewing admin, who decides.
const INELIGIBLE_TASK_PATTERNS = Object.freeze([
  { category: "driving", pattern: /\b(driv(e|es|ing|er)|behind the wheel|operating (a|the) vehicle|while in traffic)\b/i },
  { category: "seated", pattern: /\b(seated|sitting|sit down|at a desk)\b/i },
  { category: "repetitive", pattern: /\b(repetitive|repeat(ed|ing)?|same motion|assembly line)\b/i }
]);

const MAX_TASKS = 5;

function cleanText(value, max) {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function flagIneligibleTasks(tasks) {
  const flags = [];
  tasks.forEach((task, index) => {
    for (const { category, pattern } of INELIGIBLE_TASK_PATTERNS) {
      if (pattern.test(task)) flags.push({ task_index: index, category });
    }
  });
  return flags;
}

// Ordinary driver approval is necessary but never sufficient: it makes a
// driver eligible to apply, and program approval is a separate decision.
function evaluateDriverEligibility(driver) {
  const reasons = [];
  if (!driver) return { eligible: false, reasons: ["not_a_driver"] };
  if (driver.access_revoked === true || driver.deleted_at) reasons.push("account_inactive");
  if (driver.is_blocked === true || driver.is_disabled === true) reasons.push("account_restricted");
  if (driver.is_review_account === true) reasons.push("review_account");
  if (String(driver.approval_status || "").toLowerCase() !== "approved") reasons.push("driver_not_approved");
  return { eligible: reasons.length === 0, reasons };
}

function validateApplicationInput(body) {
  const errors = [];
  const b = body && typeof body === "object" ? body : {};

  const phoneModel = cleanText(b.phone_model, 80);
  if (!phoneModel) errors.push("phone_model is required.");

  const country = cleanText(b.country, 10).toUpperCase();
  if (!SUPPORTED_COUNTRIES.includes(country)) {
    errors.push("The program is currently available in the United States only (country must be US).");
  }

  const proposedLocation = cleanText(b.proposed_location, 300);
  if (!proposedLocation) errors.push("proposed_location (the commercial location where you would record) is required.");

  const locationState = cleanText(b.location_state, 10).toUpperCase();
  if (!US_STATE_CODES.includes(locationState)) errors.push("location_state must be a U.S. state code.");

  const rawTasks = Array.isArray(b.proposed_tasks) ? b.proposed_tasks : [];
  const tasks = rawTasks.map((t) => cleanText(t, 200)).filter(Boolean);
  if (tasks.length === 0) errors.push("Describe at least one proposed task.");
  if (tasks.length > MAX_TASKS) errors.push(`List at most ${MAX_TASKS} tasks.`);

  if (b.ineligible_tasks_acknowledged !== true) {
    errors.push("You must confirm you understand that driving, seated, and repetitive tasks are ineligible.");
  }

  if (errors.length) return { ok: false, errors };

  return {
    ok: true,
    application: {
      phone_model: phoneModel,
      country,
      proposed_location: proposedLocation,
      location_state: locationState,
      proposed_tasks: tasks,
      ineligible_tasks_acknowledged: true,
      task_review_flags: flagIneligibleTasks(tasks)
    }
  };
}

function validateApplicationTransition({ from, to, reason }) {
  if (!APPLICATION_STATUSES.includes(from) || !APPLICATION_STATUSES.includes(to)) {
    return { ok: false, error: "Unknown application status." };
  }
  if (!APPLICATION_TRANSITIONS[from].includes(to)) {
    return { ok: false, error: `An application cannot move from ${from} to ${to}.` };
  }
  if ((to === "rejected" || to === "suspended") && !cleanText(reason, 500)) {
    return { ok: false, error: "A reason is required to reject or suspend an application." };
  }
  return { ok: true };
}

/* ---------------------------------------------------------------
   Agreements, consents and equipment
--------------------------------------------------------------- */

// Placeholders pending legal review (the contributor model, contract and
// insurance questions are unresolved). Changing this list is the one
// place that changes what is required before the organization code shows.
const REQUIRED_AGREEMENTS = Object.freeze([
  { type: "contributor_agreement", label: "Contributor agreement" },
  { type: "recording_consent", label: "Recording and data-use consent" }
]);

const AGREEMENT_TYPES = Object.freeze(REQUIRED_AGREEMENTS.map((a) => a.type));
const AGREEMENT_STATUSES = Object.freeze(["pending", "signed", "revoked"]);

const EQUIPMENT_STATUSES = Object.freeze(["assigned", "returned", "lost", "damaged"]);

// Latest row per agreement type wins (rows are append-only history).
function agreementStatusList(agreementRows) {
  const latest = new Map();
  const sorted = [...(agreementRows || [])].sort((a, b) =>
    String(a.recorded_at || "").localeCompare(String(b.recorded_at || ""))
  );
  for (const row of sorted) latest.set(row.agreement_type, row);
  return REQUIRED_AGREEMENTS.map(({ type, label }) => {
    const row = latest.get(type);
    return {
      agreement_type: type,
      label,
      status: row ? row.status : "pending",
      document_version: row ? row.document_version || null : null,
      signed_at: row && row.status === "signed" ? row.signed_at || null : null
    };
  });
}

function allAgreementsSigned(agreementRows) {
  return agreementStatusList(agreementRows).every((a) => a.status === "signed");
}

/* ---------------------------------------------------------------
   Organization code and Minute links
--------------------------------------------------------------- */

// The organization code is shown only to a driver whose program
// application is approved, with every required agreement signed, while
// collection is switched on, and only if the code is configured.
function evaluateOrganizationCodeAccess({ gates, application, agreementRows, organizationCode }) {
  const reasons = [];
  if (!gates || !gates.program) reasons.push("program_disabled");
  if (!gates || !gates.collection) reasons.push("collection_disabled");
  if (!application || application.status !== "approved") reasons.push("not_program_approved");
  if (!allAgreementsSigned(agreementRows)) reasons.push("agreements_incomplete");
  if (!cleanText(organizationCode, 100)) reasons.push("code_not_configured");
  return { allowed: reasons.length === 0, reasons };
}

function safeHttpsUrl(value) {
  const text = cleanText(value, 500);
  if (!text) return null;
  try {
    const url = new URL(text);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

/* ---------------------------------------------------------------
   Import: CSV parsing, duration parsing, preview
--------------------------------------------------------------- */

const MAX_IMPORT_ROWS = 5000;
const MAX_IMPORT_BYTES = 1_500_000;

// RFC 4180 CSV: quoted fields, doubled quotes, CR/LF/CRLF line ends.
function parseCsv(text) {
  const input = String(text || "").replace(/^﻿/, "");
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  while (i < input.length) {
    const ch = input[i];
    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"' && field === "") {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ",") {
      row.push(field);
      field = "";
      i += 1;
      continue;
    }
    if (ch === "\r" || ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i += ch === "\r" && input[i + 1] === "\n" ? 2 : 1;
      continue;
    }
    field += ch;
    i += 1;
  }
  if (inQuotes) throw new Error("The file has an unterminated quoted field.");
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ""));
}

const DURATION_UNITS = Object.freeze(["seconds", "minutes", "hours", "hms"]);

// Exact decimal parse: "1.25" hours -> 4500 seconds without floating
// point. Fractions of a second round half-up.
function decimalToSeconds(text, secondsPerUnit) {
  const m = /^(\d{1,7})(?:\.(\d{1,9}))?$/.exec(text);
  if (!m) return null;
  const frac = m[2] || "";
  const scale = 10n ** BigInt(frac.length);
  const numerator = BigInt(m[1] + frac) * BigInt(secondsPerUnit);
  return Number((numerator * 2n + scale) / (scale * 2n));
}

function parseDurationToSeconds(value, unit) {
  const text = cleanText(String(value ?? ""), 40);
  if (!text) return { ok: false, error: "missing duration" };

  let seconds = null;
  if (unit === "seconds") seconds = decimalToSeconds(text, 1);
  else if (unit === "minutes") seconds = decimalToSeconds(text, 60);
  else if (unit === "hours") seconds = decimalToSeconds(text, 3600);
  else if (unit === "hms") {
    const m = /^(\d{1,3}):([0-5]\d)(?::([0-5]\d))?$/.exec(text);
    if (m) seconds = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3] || 0);
  } else {
    return { ok: false, error: "unknown duration unit" };
  }

  if (seconds === null) return { ok: false, error: `unreadable duration "${text}"` };
  if (seconds <= 0) return { ok: false, error: "duration must be greater than zero" };
  if (seconds > MAX_SESSION_SECONDS) return { ok: false, error: "duration is longer than 24 hours" };
  return { ok: true, seconds };
}

// Only unambiguous ISO dates (YYYY-MM-DD, optionally with a time). A
// format like 03/04/2026 is rejected rather than guessed.
function parseSessionDate(value) {
  const text = cleanText(String(value ?? ""), 40);
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ][0-9:.]+(?:Z|[+-]\d{2}:?\d{2})?)?$/.exec(text);
  if (!m) return { ok: false, error: `session date "${text}" is not YYYY-MM-DD` };
  const date = `${m[1]}-${m[2]}-${m[3]}`;
  const d = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== date) {
    return { ok: false, error: `session date "${text}" is not a real date` };
  }
  return { ok: true, date };
}

function normalizeKey(value) {
  return cleanText(String(value ?? ""), 200).toLowerCase();
}

// The admin's mapping from this file's own headers to the fields the
// importer needs. Nothing about Minute's real column names is assumed.
function validateMapping(mapping, headers) {
  const m = mapping && typeof mapping === "object" ? mapping : {};
  const errors = [];
  const fields = ["contributor_id", "session_id", "session_date", "duration"];
  const resolved = {};
  for (const field of fields) {
    const header = cleanText(m[field], 200);
    if (!header) {
      errors.push(`Choose which column holds ${field}.`);
      continue;
    }
    const index = headers.findIndex((h) => cleanText(h, 200) === header);
    if (index < 0) errors.push(`Column "${header}" (for ${field}) is not in the file.`);
    resolved[field] = index;
  }
  const unit = cleanText(m.duration_unit, 10);
  if (!DURATION_UNITS.includes(unit)) errors.push(`duration_unit must be one of: ${DURATION_UNITS.join(", ")}.`);
  if (errors.length) return { ok: false, errors };
  return { ok: true, columns: resolved, durationUnit: unit };
}

function sha256(text) {
  return crypto.createHash("sha256").update(String(text)).digest("hex");
}

// Classifies every row and returns exactly what a commit would save.
// Inputs are already loaded by the caller:
//   applications       rows with minute_contributor_id set (any status)
//   existingSessionIds lower-cased external_session_id values already stored
//   previousBatches    earlier batches with the same file hash, if any
//   openExceptionSessionIds  sessions already flagged by an earlier
//                      import and not yet resolved: reported again, but
//                      not saved as a second exception
// Row outcomes:
//   ready                  will be saved as a pending hour record
//   duplicate_existing     session already stored: rejected
//   duplicate_in_file      session repeated in this file: rejected
//   unmatched_contributor  saved as an exception for follow-up, not as hours
//   inactive_participant   contributor's application is not approved or
//                          suspended: saved as an exception
//   invalid                blocks the whole commit until the file is fixed
function buildImportPreview({
  csvText,
  mapping,
  applications,
  existingSessionIds,
  previousBatches = [],
  openExceptionSessionIds = [],
  rates = RATES
}) {
  const text = String(csvText || "");
  if (!text.trim()) return { ok: false, errors: ["The file is empty."] };
  if (Buffer.byteLength(text, "utf8") > MAX_IMPORT_BYTES) {
    return { ok: false, errors: ["The file is larger than 1.5 MB; split it into smaller files."] };
  }

  let table;
  try {
    table = parseCsv(text);
  } catch (err) {
    return { ok: false, errors: [err.message] };
  }
  if (table.length < 2) return { ok: false, errors: ["The file needs a header row and at least one data row."] };

  const headers = table[0];
  const dataRows = table.slice(1);
  if (dataRows.length > MAX_IMPORT_ROWS) {
    return { ok: false, errors: [`The file has more than ${MAX_IMPORT_ROWS} rows; split it.`] };
  }

  const map = validateMapping(mapping, headers);
  if (!map.ok) return { ok: false, errors: map.errors, headers };

  const byContributor = new Map();
  for (const app of applications || []) {
    const key = normalizeKey(app.minute_contributor_id);
    if (key) byContributor.set(key, app);
  }
  const existing = new Set((existingSessionIds || []).map(normalizeKey));
  const alreadyFlagged = new Set((openExceptionSessionIds || []).map(normalizeKey));
  const seenInFile = new Set();

  const rows = [];
  const records = [];
  const exceptions = [];

  dataRows.forEach((cells, i) => {
    const rowNumber = i + 2; // 1-based, counting the header row
    const get = (field) => cells[map.columns[field]];
    const contributor = cleanText(get("contributor_id"), 200);
    const sessionId = cleanText(get("session_id"), 200);
    const out = { row_number: rowNumber, contributor_id: contributor, session_id: sessionId };

    const problems = [];
    if (!contributor) problems.push("missing contributor id");
    if (!sessionId) problems.push("missing session id");
    const date = parseSessionDate(get("session_date"));
    if (!date.ok) problems.push(date.error);
    const duration = parseDurationToSeconds(get("duration"), map.durationUnit);
    if (!duration.ok) problems.push(duration.error);

    if (problems.length) {
      rows.push({ ...out, outcome: "invalid", detail: problems.join("; ") });
      return;
    }

    out.session_date = date.date;
    out.duration_seconds = duration.seconds;
    const sessionKey = normalizeKey(sessionId);

    if (existing.has(sessionKey)) {
      rows.push({ ...out, outcome: "duplicate_existing", detail: "session already recorded" });
      return;
    }
    if (seenInFile.has(sessionKey)) {
      rows.push({ ...out, outcome: "duplicate_in_file", detail: "session appears more than once in this file" });
      return;
    }
    seenInFile.add(sessionKey);

    const flagException = (reason, detail) => {
      const flagged = alreadyFlagged.has(sessionKey);
      rows.push({ ...out, outcome: reason, detail: flagged ? `${detail} (already flagged by an earlier import)` : detail, already_flagged: flagged });
      if (flagged) return;
      exceptions.push({
        row_number: rowNumber,
        reason,
        external_contributor_id: contributor,
        external_session_id: sessionId,
        session_date: date.date,
        duration_seconds: duration.seconds
      });
    };

    const app = byContributor.get(normalizeKey(contributor));
    if (!app) {
      flagException("unmatched_contributor", "no participant is linked to this contributor id");
      return;
    }
    if (app.status !== "approved" && app.status !== "suspended") {
      flagException("inactive_participant", `participant application is ${app.status}`);
      return;
    }

    const amounts = computeRecordAmounts(duration.seconds, rates);
    rows.push({ ...out, outcome: "ready", driver_id: app.driver_id, driver_amount_cents: amounts.driver_amount_cents });
    records.push({
      driver_id: app.driver_id,
      application_id: app.id,
      external_session_id: sessionId,
      external_contributor_id: contributor,
      session_date: date.date,
      duration_seconds: duration.seconds,
      ...amounts
    });
  });

  const count = (outcome) => rows.filter((r) => r.outcome === outcome).length;
  const summary = {
    total_rows: rows.length,
    ready: count("ready"),
    duplicate_existing: count("duplicate_existing"),
    duplicate_in_file: count("duplicate_in_file"),
    unmatched_contributor: count("unmatched_contributor"),
    inactive_participant: count("inactive_participant"),
    invalid: count("invalid"),
    ready_seconds: records.reduce((t, r) => t + r.duration_seconds, 0),
    ready_driver_cents: records.reduce((t, r) => t + r.driver_amount_cents, 0),
    ready_company_cents: records.reduce((t, r) => t + r.company_amount_cents, 0)
  };
  summary.ready_margin_cents = summary.ready_company_cents - summary.ready_driver_cents;

  const fileSha256 = sha256(text);

  // Fingerprint of exactly what a commit would write. The commit
  // recomputes the preview and refuses unless this matches, so what the
  // admin reviewed is what gets saved.
  const digest = sha256(
    JSON.stringify({
      file: fileSha256,
      records: records.map((r) => [r.external_session_id, r.driver_id, r.application_id, r.session_date, r.duration_seconds]),
      exceptions: exceptions.map((e) => [e.external_session_id, e.reason, e.external_contributor_id])
    })
  );

  return {
    ok: true,
    headers,
    file_sha256: fileSha256,
    previously_imported: (previousBatches || []).map((b) => ({ id: b.id, created_at: b.created_at, filename: b.filename })),
    can_commit: summary.invalid === 0 && records.length + exceptions.length > 0,
    summary,
    rows,
    records,
    exceptions,
    preview_digest: digest
  };
}

// Manual entry until a sample Minute export is available. The admin
// copies the session identifier from Minute so a later import of the
// same session is rejected as a duplicate.
function validateManualEntry(body) {
  const b = body && typeof body === "object" ? body : {};
  const errors = [];
  const sessionId = cleanText(b.external_session_id, 200);
  if (!sessionId) errors.push("external_session_id (the session identifier shown in Minute) is required.");
  const date = parseSessionDate(b.session_date);
  if (!date.ok) errors.push(date.error);
  const unit = cleanText(b.duration_unit, 10) || "hms";
  const duration = parseDurationToSeconds(b.duration, unit);
  if (!duration.ok) errors.push(duration.error);
  const reason = cleanText(b.reason, 500);
  if (!reason) errors.push("A reason (where the figure came from) is required for manual entry.");
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    entry: {
      external_session_id: sessionId,
      session_date: date.date,
      duration_seconds: duration.seconds,
      reason
    }
  };
}

module.exports = {
  FLAGS,
  RATES,
  SECONDS_PER_HOUR,
  MAX_SESSION_SECONDS,
  HOUR_STATUSES,
  HOUR_TRANSITIONS,
  APPLICATION_STATUSES,
  ACTIVE_APPLICATION_STATUSES,
  APPLICATION_TRANSITIONS,
  SUPPORTED_COUNTRIES,
  US_STATE_CODES,
  INELIGIBLE_TASK_NOTICE,
  REQUIRED_AGREEMENTS,
  AGREEMENT_TYPES,
  AGREEMENT_STATUSES,
  EQUIPMENT_STATUSES,
  DURATION_UNITS,
  MAX_IMPORT_ROWS,
  resolveProgramGates,
  amountCents,
  computeRecordAmounts,
  validateHourTransition,
  capabilityForHourTransition,
  summarizeHours,
  secondsToHours,
  formatCents,
  cleanText,
  flagIneligibleTasks,
  evaluateDriverEligibility,
  validateApplicationInput,
  validateApplicationTransition,
  agreementStatusList,
  allAgreementsSigned,
  evaluateOrganizationCodeAccess,
  safeHttpsUrl,
  parseCsv,
  parseDurationToSeconds,
  parseSessionDate,
  validateMapping,
  buildImportPreview,
  validateManualEntry,
  sha256
};

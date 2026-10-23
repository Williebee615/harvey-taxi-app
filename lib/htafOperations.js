const HTAF_PENDING_REVIEW_STATUSES = new Set(["submitted", "under_review", "pending_documents"]);

function computeHtafPublicStats(statuses) {
  const list = Array.isArray(statuses) ? statuses : [];
  let pendingReview = 0;
  let approved = 0;
  let scheduled = 0;
  for (const status of list) {
    if (HTAF_PENDING_REVIEW_STATUSES.has(status)) pendingReview++;
    else if (status === "approved") approved++;
    else if (status === "scheduled") scheduled++;
  }
  return {
    applications_submitted: list.length,
    pending_review: pendingReview,
    approved_requests: approved,
    scheduled_rides: scheduled
  };
}

function resolveCreateRideOutcome(rpcResult) {
  switch (rpcResult && rpcResult.outcome) {
    case "created":
      return { statusCode: 201, created: true, ride: rpcResult.ride };
    case "existing":
      return { statusCode: 200, created: false, ride: rpcResult.ride };
    case "not_found":
      return { statusCode: 404, error: "HTAF application not found." };
    case "inconsistent":
      return {
        statusCode: 409,
        error: "This application's ride status is inconsistent and requires manual review.",
        reason: rpcResult.reason
      };
    default:
      return { statusCode: 500, error: "Unexpected response while creating the ride." };
  }
}

// Decides what email (if any) an authenticated rider is allowed to look
// their own HTAF application up by. Deliberately takes ONLY the verified
// session's rider row -- never a request query/body parameter -- so
// there is no code path, present or future, where a client-supplied
// email could stand in for the session's own identity. `extra` exists
// only so callers can be tested against an adversarial payload (e.g. a
// request object with its own `email`/`query.email` bolted on); it is
// always ignored, which is the point of the test coverage below.
function resolveRiderHtafLookup(rider) {
  if (!rider || typeof rider !== "object") {
    return { ok: false, statusCode: 401, error: "Rider authentication required." };
  }
  const email = typeof rider.email === "string" ? rider.email.trim() : "";
  if (!email) {
    // A rider with no email on file cannot have a matching HTAF
    // application by definition -- this is a real "no application"
    // fact, not an auth failure, so it succeeds with a null lookup
    // target rather than erroring.
    return { ok: true, email: null };
  }
  return { ok: true, email };
}

// Admin field allow-lists (docs/security-remediation/
// htaf-admin-data-minimization.md). Single source of truth shared by
// server.js's Supabase .select() calls AND the tests below, so a field
// can't silently reappear in the list response without a test catching
// it. The list only carries what the queue row template actually
// renders (name, code, program, county, status) plus id/created_at for
// selection and keyset pagination -- everything else (email, phone,
// income, household size, addresses, notes, and the four columns
// nothing in this codebase ever reads: review_notes, assigned_admin,
// client_version, source) is detail-only, fetched one row at a time
// only when an admin actually opens that application.
const HTAF_ADMIN_LIST_FIELDS = [
  "id",
  "application_code",
  "first_name",
  "last_name",
  "program_type",
  "county",
  "status",
  "created_at",
  // Owner decision 2026-10-23: the queue card shows the requested trip
  // date so urgent trips can be seen first.
  "ride_date"
];

const HTAF_ADMIN_DETAIL_FIELDS = [
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
  "created_at",
  "updated_at",
  "ride_id"
];

// PATCH only ever changes status/notes/updated_at -- returning the full
// row (as the old select().single() did) is exactly the "ship detail
// fields nobody asked for" pattern this PR closes.
const HTAF_ADMIN_PATCH_RESPONSE_FIELDS = ["id", "status", "notes", "updated_at"];

const HTAF_EXPORT_COLUMNS = [
  "application_code",
  "status",
  "program_type",
  "first_name",
  "last_name",
  "email",
  "phone",
  "county",
  "city",
  "pickup_city",
  "destination",
  "ride_date",
  "applicant_type",
  "household_size",
  "monthly_income",
  "created_at",
  "updated_at"
];

function csvEscapeValue(value) {
  const text = value === null || value === undefined ? "" : String(value);
  if (text.includes(",") || text.includes('"') || text.includes("\n")) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

function buildHtafExportCsv(rows, columns) {
  const list = Array.isArray(rows) ? rows : [];
  const cols = Array.isArray(columns) && columns.length ? columns : HTAF_EXPORT_COLUMNS;
  const lines = [cols.join(",")];
  for (const row of list) {
    lines.push(cols.map((col) => csvEscapeValue(row ? row[col] : "")).join(","));
  }
  return lines.join("\n");
}

// Bulk PII export is materially different from viewing one application
// and must never happen silently: an admin has to state why before the
// file is generated, and that reason is what gets audited alongside
// actor/timestamp/row_count. This is deliberately just a non-empty,
// length-bounded string -- not a fixed enum -- since the point is a
// human-readable justification an auditor can read later, not a code a
// UI can satisfy by default-selecting the first option.
function resolveHtafExportRequest(body) {
  const rawReason = body && typeof body.reason === "string" ? body.reason.trim() : "";
  if (!rawReason) {
    return {
      ok: false,
      statusCode: 400,
      error: "An export reason is required before generating this file."
    };
  }
  if (rawReason.length > 500) {
    return {
      ok: false,
      statusCode: 400,
      error: "Export reason must be 500 characters or fewer."
    };
  }
  const status = body && typeof body.status === "string" ? body.status.trim() : "";
  const programType = body && typeof body.program_type === "string" ? body.program_type.trim() : "";
  // Optional submission-date range for grant reporting, YYYY-MM-DD,
  // inclusive, in Nashville time (America/Chicago).
  const dates = {};
  for (const key of ["from_date", "to_date"]) {
    const raw = body && typeof body[key] === "string" ? body[key].trim() : "";
    if (!raw) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || Number.isNaN(Date.parse(`${raw}T00:00:00Z`))) {
      return { ok: false, statusCode: 400, error: "Dates must be in YYYY-MM-DD format." };
    }
    dates[key] = raw;
  }
  if (dates.from_date && dates.to_date && dates.from_date > dates.to_date) {
    return { ok: false, statusCode: 400, error: "The start date must be on or before the end date." };
  }
  return {
    ok: true,
    reason: rawReason,
    status: status || null,
    programType: programType || null,
    fromDate: dates.from_date || null,
    toDate: dates.to_date || null
  };
}

// The UTC instant of midnight starting `ymd` (YYYY-MM-DD) in Nashville
// (America/Chicago), so a date range means local calendar days.
function chicagoMidnightIso(ymd) {
  const noonUtc = new Date(`${ymd}T12:00:00Z`);
  const part = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", timeZoneName: "shortOffset" })
    .formatToParts(noonUtc)
    .find((p) => p.type === "timeZoneName");
  const m = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(part ? part.value : "");
  const offset = m ? `${m[1]}${m[2].padStart(2, "0")}:${m[3] || "00"}` : "-06:00";
  return new Date(`${ymd}T00:00:00${offset}`).toISOString();
}

// Possible duplicate submissions: same phone, email or full name within
// `windowDays` of each other. rows carry id, application_code,
// first_name, last_name, phone, email, created_at. Returns
// Map(id -> [other application codes]); contact details never leave.
function findPossibleDuplicates(rows, { windowDays = 7 } = {}) {
  const windowMs = windowDays * 24 * 60 * 60 * 1000;
  const keyOf = {
    phone: (r) => {
      const digits = String(r.phone || "").replace(/\D/g, "");
      return digits.length >= 10 ? digits.slice(-10) : "";
    },
    email: (r) => String(r.email || "").trim().toLowerCase(),
    name: (r) => {
      const first = String(r.first_name || "").trim().toLowerCase().replace(/\s+/g, " ");
      const last = String(r.last_name || "").trim().toLowerCase().replace(/\s+/g, " ");
      return first && last ? `${first} ${last}` : "";
    }
  };
  const result = new Map();
  const list = (rows || []).filter((r) => r && r.id);
  for (let i = 0; i < list.length; i += 1) {
    for (let j = i + 1; j < list.length; j += 1) {
      const a = list[i];
      const b = list[j];
      const gap = Math.abs(Date.parse(a.created_at) - Date.parse(b.created_at));
      if (!Number.isFinite(gap) || gap > windowMs) continue;
      const match = Object.values(keyOf).some((fn) => {
        const k = fn(a);
        return k && k === fn(b);
      });
      if (!match) continue;
      if (!result.has(a.id)) result.set(a.id, []);
      if (!result.has(b.id)) result.set(b.id, []);
      result.get(a.id).push(b.application_code || String(b.id));
      result.get(b.id).push(a.application_code || String(a.id));
    }
  }
  return result;
}

// Fail-closed gate on delivering the export file: a sensitive
// administrative action (handing over a whole caseload's PII) must not
// succeed without its required audit evidence persisting first -- the
// same principle already used for driver compliance overrides. Note
// that auditLog() (server.js) never rejects/throws on a failed insert;
// it always resolves, with {logged: false, error} on failure. That
// means this gate has to inspect the resolved outcome, not assume a
// try/catch around the call will catch a persistence failure -- a
// caller that wraps auditLog() in try/catch and ignores the resolved
// value (e.g. the old `auditLog({...}).catch(() => {})` fire-and-forget
// pattern used elsewhere in this codebase for non-critical logging)
// would never see this failure at all, which is exactly the bug this
// function exists to prevent for this one security-sensitive action.
function resolveHtafExportDelivery(auditResult) {
  if (auditResult && auditResult.logged === true) {
    return { ok: true };
  }
  return {
    ok: false,
    statusCode: 500,
    error:
      "This export was not completed because the required audit record could not be written. Please try again."
  };
}


module.exports = {
  HTAF_PENDING_REVIEW_STATUSES,
  HTAF_ADMIN_LIST_FIELDS,
  HTAF_ADMIN_DETAIL_FIELDS,
  HTAF_ADMIN_PATCH_RESPONSE_FIELDS,
  HTAF_EXPORT_COLUMNS,
  computeHtafPublicStats,
  resolveCreateRideOutcome,
  resolveRiderHtafLookup,
  csvEscapeValue,
  buildHtafExportCsv,
  resolveHtafExportRequest,
  resolveHtafExportDelivery,
  findPossibleDuplicates,
  chicagoMidnightIso
};

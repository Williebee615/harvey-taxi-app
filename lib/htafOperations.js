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
  "created_at"
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
  return {
    ok: true,
    reason: rawReason,
    status: status || null,
    programType: programType || null
  };
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
  resolveHtafExportDelivery
};

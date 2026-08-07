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

// ============================================================
// HTAF AI triage privacy hardening (docs/security-remediation/
// htaf-ai-triage-privacy-hardening.md). This is the ONLY place in the
// codebase that decides what facts about an HTAF application are
// allowed to leave the server for OpenAI. Built server-side, from an
// explicit allow-list -- the browser never sees or influences this
// payload. No name, email, phone, application code, street address,
// exact income, exact household size, or raw free-text need
// description is ever included, even if present on the `application`
// row passed in. Field-by-field classification (necessary /
// coarsen-able / remove) is documented in the file above; this is the
// implementation of that classification, not a restatement of it.
// ============================================================

const HTAF_TRIAGE_APPLICANT_TYPES = new Set([
  "self",
  "parent",
  "caregiver",
  "caseworker",
  "socialworker"
]);

// applicant_type has no server-side allow-list at submission time
// (server.js's buildHTAFApplicationPayload just cleanStrings it) --
// only the public form's <select> constrains it in normal use. Since
// this function must guarantee no unexpected free text reaches the AI
// even if that ever changes, anything outside the known dropdown
// values collapses to "unspecified" rather than being passed through.
function normalizeTriageApplicantType(value) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return HTAF_TRIAGE_APPLICANT_TYPES.has(normalized) ? normalized : "unspecified";
}

// Household size band, not the exact count. Bands are round, generic
// group sizes for triage-magnitude context only -- they are not an
// eligibility threshold and imply no HTAF program rule.
function bandHouseholdSize(value) {
  const size = Number(value);
  if (!Number.isFinite(size) || size <= 0) return "unspecified";
  if (size === 1) return "1";
  if (size <= 3) return "2-3";
  if (size <= 5) return "4-5";
  return "6+";
}

// Monthly income band, not the exact figure. Bands are round dollar
// ranges chosen only to give the triage model a rough magnitude signal
// -- they are not tied to any federal poverty guideline, HTAF
// eligibility rule, or other policy threshold, none of which this
// function (or this PR) defines or changes.
function bandMonthlyIncome(value) {
  const income = Number(value);
  if (!Number.isFinite(income) || income < 0) return "unspecified";
  if (income < 1000) return "under_1000";
  if (income < 2000) return "1000_to_2000";
  if (income < 3000) return "2000_to_3000";
  if (income < 4000) return "3000_to_4000";
  return "4000_or_more";
}

// Reports whether free text exists and roughly how much of it -- never
// the text itself. Used for both the applicant's stated
// transportation_need and any admin-authored notes, both of which are
// unconstrained free text that could contain medical detail, names, or
// anything else an applicant or admin chose to write.
function describeFreeTextPresence(value) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return "missing";
  return text.length < 20 ? "brief" : "detailed";
}

const HTAF_TRIAGE_SERVICE_AREA_TERMS = ["nashville", "davidson"];

// Derives a service-area boolean from free-text location fields
// WITHOUT ever including that text in the result -- the raw
// county/city/pickup_city/destination strings are read here and
// nowhere else in this module's output. This preserves the original
// "flag anything outside the service area" triage check without
// sending an address, venue name, or any other location free text to
// OpenAI.
function textMentionsServiceArea(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const lower = value.toLowerCase();
  return HTAF_TRIAGE_SERVICE_AREA_TERMS.some((term) => lower.includes(term));
}

// Builds the ONLY object this codebase sends to OpenAI for HTAF
// triage. Explicit allow-list; every field is either passed through
// because it's already a closed operational category (status,
// program_type) or low-sensitivity (ride_date, submitted_at), or is
// derived/banded/boolean-ized from a sensitive source field that is
// itself never included. Called server-side only (server.js's
// triageHtafApplication); the client never sees or supplies this
// payload.
function buildHtafTriageFacts(application) {
  const app = application && typeof application === "object" ? application : {};
  return {
    status: typeof app.status === "string" ? app.status : null,
    program_type: typeof app.program_type === "string" ? app.program_type : "general",
    applicant_type: normalizeTriageApplicantType(app.applicant_type),
    household_size_band: bandHouseholdSize(app.household_size),
    monthly_income_band: bandMonthlyIncome(app.monthly_income),
    home_in_service_area: textMentionsServiceArea(app.county) ?? textMentionsServiceArea(app.city),
    pickup_in_service_area: textMentionsServiceArea(app.pickup_city),
    destination_in_service_area: textMentionsServiceArea(app.destination),
    ride_date: typeof app.ride_date === "string" ? app.ride_date : app.ride_date || null,
    transportation_need_detail: describeFreeTextPresence(app.transportation_need),
    has_prior_admin_notes: describeFreeTextPresence(app.notes) !== "missing",
    submitted_at: app.created_at || null
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
  buildHtafTriageFacts
};

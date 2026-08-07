const {
  computeHtafPublicStats,
  resolveCreateRideOutcome,
  resolveRiderHtafLookup,
  HTAF_ADMIN_LIST_FIELDS,
  HTAF_ADMIN_DETAIL_FIELDS,
  HTAF_ADMIN_PATCH_RESPONSE_FIELDS,
  HTAF_EXPORT_COLUMNS,
  buildHtafExportCsv,
  csvEscapeValue,
  resolveHtafExportRequest,
  resolveHtafExportDelivery,
  buildHtafTriageFacts
} = require("./htafOperations");

describe("computeHtafPublicStats", () => {
  test("real database records produce the public counters", () => {
    const statuses = ["submitted", "submitted", "under_review", "approved", "scheduled"];
    expect(computeHtafPublicStats(statuses)).toEqual({
      applications_submitted: 5,
      pending_review: 3,
      approved_requests: 1,
      scheduled_rides: 1
    });
  });

  test("each canonical status maps to the correct counter", () => {
    expect(computeHtafPublicStats(["submitted"])).toMatchObject({ pending_review: 1, approved_requests: 0, scheduled_rides: 0 });
    expect(computeHtafPublicStats(["under_review"])).toMatchObject({ pending_review: 1, approved_requests: 0, scheduled_rides: 0 });
    expect(computeHtafPublicStats(["pending_documents"])).toMatchObject({ pending_review: 1, approved_requests: 0, scheduled_rides: 0 });
    expect(computeHtafPublicStats(["approved"])).toMatchObject({ pending_review: 0, approved_requests: 1, scheduled_rides: 0 });
    expect(computeHtafPublicStats(["scheduled"])).toMatchObject({ pending_review: 0, approved_requests: 0, scheduled_rides: 1 });
    expect(computeHtafPublicStats(["denied"])).toMatchObject({ pending_review: 0, approved_requests: 0, scheduled_rides: 0 });
    expect(computeHtafPublicStats(["completed"])).toMatchObject({ pending_review: 0, approved_requests: 0, scheduled_rides: 0 });
  });

  test("empty input produces real zero counts, not an error", () => {
    expect(computeHtafPublicStats([])).toEqual({
      applications_submitted: 0,
      pending_review: 0,
      approved_requests: 0,
      scheduled_rides: 0
    });
  });

  test("does not collapse all pending statuses into a single bucket that overwrites the others", () => {
    const stats = computeHtafPublicStats(["submitted", "under_review", "pending_documents"]);
    expect(stats.applications_submitted).toBe(3);
    expect(stats.pending_review).toBe(3);
  });

  test("non-array input is treated as no applications rather than throwing", () => {
    expect(computeHtafPublicStats(null)).toEqual({
      applications_submitted: 0,
      pending_review: 0,
      approved_requests: 0,
      scheduled_rides: 0
    });
  });

  test("output contains only aggregate integer fields, never applicant PII", () => {
    const statuses = ["submitted", "approved", "scheduled", "denied"];
    const stats = computeHtafPublicStats(statuses);
    const keys = Object.keys(stats);
    expect(keys.sort()).toEqual([
      "applications_submitted",
      "approved_requests",
      "pending_review",
      "scheduled_rides"
    ]);
    for (const key of keys) {
      expect(Number.isInteger(stats[key])).toBe(true);
    }
    const forbiddenPiiKeys = ["email", "phone", "first_name", "last_name", "name", "address", "id"];
    for (const forbidden of forbiddenPiiKeys) {
      expect(keys).not.toContain(forbidden);
    }
  });
});

describe("resolveCreateRideOutcome", () => {
  test("existing ride_id returns the existing ride", () => {
    const ride = { id: "RIDE_1" };
    expect(resolveCreateRideOutcome({ outcome: "existing", ride })).toEqual({
      statusCode: 200,
      created: false,
      ride
    });
  });

  test("normal first-time ride creation still works", () => {
    const ride = { id: "RIDE_2" };
    expect(resolveCreateRideOutcome({ outcome: "created", ride })).toEqual({
      statusCode: 201,
      created: true,
      ride
    });
  });

  test("not found application maps to 404", () => {
    expect(resolveCreateRideOutcome({ outcome: "not_found" })).toEqual({
      statusCode: 404,
      error: "HTAF application not found."
    });
  });

  test("scheduled-with-missing-ride inconsistency fails closed", () => {
    const result = resolveCreateRideOutcome({ outcome: "inconsistent", reason: "status_ahead_of_ride_id" });
    expect(result.statusCode).toBe(409);
    expect(result.reason).toBe("status_ahead_of_ride_id");
  });

  test("ride_id pointing at a missing ride is also reported as inconsistent", () => {
    const result = resolveCreateRideOutcome({ outcome: "inconsistent", reason: "ride_id_not_found" });
    expect(result.statusCode).toBe(409);
    expect(result.reason).toBe("ride_id_not_found");
  });

  test("a ride that exists but does not link back to this application fails closed as inconsistent", () => {
    const result = resolveCreateRideOutcome({ outcome: "inconsistent", reason: "ride_application_link_mismatch" });
    expect(result.statusCode).toBe(409);
    expect(result.reason).toBe("ride_application_link_mismatch");
    expect(result.ride).toBeUndefined();
  });

  test("unrecognized outcome fails closed with a 500 rather than guessing", () => {
    expect(resolveCreateRideOutcome({ outcome: "something_unexpected" })).toEqual({
      statusCode: 500,
      error: "Unexpected response while creating the ride."
    });
    expect(resolveCreateRideOutcome(null)).toEqual({
      statusCode: 500,
      error: "Unexpected response while creating the ride."
    });
  });
});

describe("resolveRiderHtafLookup (anti-enumeration regression coverage)", () => {
  test("no authenticated rider fails closed with 401, not a lookup", () => {
    expect(resolveRiderHtafLookup(null)).toEqual({
      ok: false,
      statusCode: 401,
      error: "Rider authentication required."
    });
    expect(resolveRiderHtafLookup(undefined)).toMatchObject({ ok: false, statusCode: 401 });
    expect(resolveRiderHtafLookup("not-an-object")).toMatchObject({ ok: false, statusCode: 401 });
  });

  test("uses the verified session's own email", () => {
    expect(resolveRiderHtafLookup({ id: "RIDER_1", email: "real-rider@example.com" })).toEqual({
      ok: true,
      email: "real-rider@example.com"
    });
  });

  test("a rider with no email on file gets a real 'no application' result, not an error", () => {
    expect(resolveRiderHtafLookup({ id: "RIDER_2", email: null })).toEqual({ ok: true, email: null });
    expect(resolveRiderHtafLookup({ id: "RIDER_3" })).toEqual({ ok: true, email: null });
    expect(resolveRiderHtafLookup({ id: "RIDER_4", email: "   " })).toEqual({ ok: true, email: null });
  });

  test("an email-shaped field anywhere other than rider.email is never used -- this is the enumeration guard", () => {
    // Simulates the exact regression this route must never have: a caller
    // (or a future refactor) accidentally threading a client-supplied
    // email through as if it were the session's own. No matter what else
    // is bolted onto the object, only the verified rider.email counts.
    const adversarialRider = {
      id: "RIDER_5",
      email: "real-rider@example.com",
      requestedEmail: "victim@example.com",
      query: { email: "victim@example.com" },
      body: { email: "victim@example.com" }
    };
    expect(resolveRiderHtafLookup(adversarialRider)).toEqual({
      ok: true,
      email: "real-rider@example.com"
    });
  });

  test("trims whitespace but does not otherwise transform the session email", () => {
    expect(resolveRiderHtafLookup({ email: "  Rider@Example.com  " })).toEqual({
      ok: true,
      email: "Rider@Example.com"
    });
  });
});

describe("HTAF admin field allow-lists (data-minimization regression coverage)", () => {
  const SENSITIVE_DETAIL_ONLY_FIELDS = [
    "email",
    "phone",
    "household_size",
    "monthly_income",
    "notes",
    "transportation_need",
    "destination",
    "pickup_city",
    "city",
    "applicant_type",
    "ride_date"
  ];

  const DEAD_COLUMNS = ["review_notes", "assigned_admin", "client_version", "source"];

  test("the list allow-list never contains a detail-only sensitive field", () => {
    for (const field of SENSITIVE_DETAIL_ONLY_FIELDS) {
      expect(HTAF_ADMIN_LIST_FIELDS).not.toContain(field);
    }
  });

  test("the list allow-list never contains a column nothing in the app reads", () => {
    for (const field of DEAD_COLUMNS) {
      expect(HTAF_ADMIN_LIST_FIELDS).not.toContain(field);
    }
  });

  test("the list allow-list carries exactly what the queue row template needs", () => {
    expect(HTAF_ADMIN_LIST_FIELDS.sort()).toEqual(
      ["id", "application_code", "first_name", "last_name", "program_type", "county", "status", "created_at"].sort()
    );
  });

  test("the detail allow-list never contains a dead column either", () => {
    for (const field of DEAD_COLUMNS) {
      expect(HTAF_ADMIN_DETAIL_FIELDS).not.toContain(field);
    }
  });

  test("the detail allow-list is a superset of the list allow-list plus the sensitive fields", () => {
    for (const field of HTAF_ADMIN_LIST_FIELDS) {
      expect(HTAF_ADMIN_DETAIL_FIELDS).toContain(field);
    }
    for (const field of SENSITIVE_DETAIL_ONLY_FIELDS) {
      expect(HTAF_ADMIN_DETAIL_FIELDS).toContain(field);
    }
  });

  test("the PATCH response allow-list carries only what a status/notes edit could change", () => {
    expect(HTAF_ADMIN_PATCH_RESPONSE_FIELDS.sort()).toEqual(["id", "status", "notes", "updated_at"].sort());
    for (const field of SENSITIVE_DETAIL_ONLY_FIELDS) {
      if (field === "notes") continue;
      expect(HTAF_ADMIN_PATCH_RESPONSE_FIELDS).not.toContain(field);
    }
  });
});

describe("buildHtafExportCsv", () => {
  test("escapes commas, quotes, and newlines the same way the old client-side export did", () => {
    expect(csvEscapeValue("plain")).toBe("plain");
    expect(csvEscapeValue("has,comma")).toBe('"has,comma"');
    expect(csvEscapeValue('has "quote"')).toBe('"has ""quote"""');
    expect(csvEscapeValue("has\nnewline")).toBe('"has\nnewline"');
    expect(csvEscapeValue(null)).toBe("");
    expect(csvEscapeValue(undefined)).toBe("");
    expect(csvEscapeValue(42)).toBe("42");
  });

  test("builds a header row plus one row per record, in column order", () => {
    const rows = [
      { application_code: "HTAF-1", status: "submitted", email: "a@example.com" },
      { application_code: "HTAF-2", status: "approved", email: "b@example.com" }
    ];
    const csv = buildHtafExportCsv(rows, ["application_code", "status", "email"]);
    expect(csv).toBe(
      "application_code,status,email\nHTAF-1,submitted,a@example.com\nHTAF-2,approved,b@example.com"
    );
  });

  test("defaults to HTAF_EXPORT_COLUMNS when no column list is given", () => {
    const csv = buildHtafExportCsv([{ application_code: "HTAF-1" }]);
    expect(csv.split("\n")[0]).toBe(HTAF_EXPORT_COLUMNS.join(","));
  });

  test("empty input still produces a valid header-only CSV, not an error", () => {
    expect(buildHtafExportCsv([])).toBe(HTAF_EXPORT_COLUMNS.join(","));
    expect(buildHtafExportCsv(null)).toBe(HTAF_EXPORT_COLUMNS.join(","));
  });
});

describe("resolveHtafExportRequest (mandatory export-reason regression coverage)", () => {
  test("rejects a missing or blank reason -- bulk PII export must never be silent", () => {
    expect(resolveHtafExportRequest({})).toMatchObject({ ok: false, statusCode: 400 });
    expect(resolveHtafExportRequest({ reason: "" })).toMatchObject({ ok: false, statusCode: 400 });
    expect(resolveHtafExportRequest({ reason: "   " })).toMatchObject({ ok: false, statusCode: 400 });
    expect(resolveHtafExportRequest(null)).toMatchObject({ ok: false, statusCode: 400 });
  });

  test("rejects an unreasonably long reason rather than storing it unbounded", () => {
    const result = resolveHtafExportRequest({ reason: "x".repeat(501) });
    expect(result).toMatchObject({ ok: false, statusCode: 400 });
  });

  test("accepts and trims a real reason, and carries optional filters through", () => {
    expect(
      resolveHtafExportRequest({
        reason: "  Monthly grant reconciliation for county finance office  ",
        status: "approved",
        program_type: "medical"
      })
    ).toEqual({
      ok: true,
      reason: "Monthly grant reconciliation for county finance office",
      status: "approved",
      programType: "medical"
    });
  });

  test("filters default to null rather than empty strings when omitted", () => {
    expect(resolveHtafExportRequest({ reason: "quarterly audit" })).toEqual({
      ok: true,
      reason: "quarterly audit",
      status: null,
      programType: null
    });
  });
});

describe("resolveHtafExportDelivery (fail-closed export audit regression coverage)", () => {
  test("delivers the export only when the audit record actually persisted", () => {
    expect(resolveHtafExportDelivery({ logged: true })).toEqual({ ok: true });
  });

  test("blocks delivery when the audit write failed, even though the CSV was already built", () => {
    const auditFailure = { logged: false, error: { message: "insert failed", code: "23505" } };
    const result = resolveHtafExportDelivery(auditFailure);
    expect(result.ok).toBe(false);
    expect(result.statusCode).toBe(500);
    expect(result.error).toEqual(expect.any(String));
  });

  test("blocks delivery on every non-success shape auditLog() can resolve with -- this is the fail-closed guarantee", () => {
    // auditLog() (server.js) never rejects/throws on a failed insert; it
    // always resolves. A caller that assumes "no exception means it
    // worked" -- e.g. wrapping the call in try/catch and treating the
    // absence of a throw as success -- would ship the CSV anyway. This
    // function is the actual gate: it must refuse delivery for every
    // shape other than the one explicit success marker.
    expect(resolveHtafExportDelivery({ logged: false })).toMatchObject({ ok: false, statusCode: 500 });
    expect(resolveHtafExportDelivery({ logged: false, reason: "missing_action" })).toMatchObject({
      ok: false,
      statusCode: 500
    });
    expect(resolveHtafExportDelivery(null)).toMatchObject({ ok: false, statusCode: 500 });
    expect(resolveHtafExportDelivery(undefined)).toMatchObject({ ok: false, statusCode: 500 });
    expect(resolveHtafExportDelivery({})).toMatchObject({ ok: false, statusCode: 500 });
    // A truthy-but-not-strictly-true "logged" value must not be treated
    // as success either -- only the literal boolean true counts.
    expect(resolveHtafExportDelivery({ logged: "true" })).toMatchObject({ ok: false, statusCode: 500 });
    expect(resolveHtafExportDelivery({ logged: 1 })).toMatchObject({ ok: false, statusCode: 500 });
  });

  test("the block error message tells the admin why, without echoing any application data", () => {
    const result = resolveHtafExportDelivery({ logged: false, error: { message: "insert failed" } });
    expect(result.error.toLowerCase()).toContain("audit");
    expect(result.error).not.toMatch(/@|email|phone|household|income/i);
  });
});

describe("buildHtafTriageFacts (AI triage privacy hardening)", () => {
  // Every direct identifier and every sensitive free-text/location
  // field is set to a unique, greppable marker. The point of these
  // tests is to prove those markers can never appear in the object
  // this codebase actually sends to OpenAI -- not to assume the
  // implementation is correct because it "looks" minimized.
  const FULL_APPLICATION = {
    id: "HTAF_MARKER_ID",
    application_code: "HTAF-20260101-MARKER",
    first_name: "MarkerFirstName",
    last_name: "MarkerLastName",
    email: "marker@example.com",
    phone: "555-000-1234",
    county: "MarkerCounty (Nashville area)",
    city: "MarkerCity, Nashville",
    pickup_city: "123 Marker Street, Nashville Dialysis Center",
    destination: "Vanderbilt Marker Medical Center",
    ride_date: "2026-09-01",
    applicant_type: "self",
    household_size: 7,
    monthly_income: 2734,
    program_type: "medical",
    status: "submitted",
    transportation_need: "Needs dialysis three times a week, has MarkerCondition",
    notes: "Admin marker note: applicant mentioned MarkerDiagnosis",
    ride_id: "RIDE_MARKER",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-02T00:00:00.000Z"
  };

  test("never includes direct identifiers, even though they exist on the application row", () => {
    const json = JSON.stringify(buildHtafTriageFacts(FULL_APPLICATION));
    for (const forbidden of [
      "HTAF_MARKER_ID",
      "HTAF-20260101-MARKER",
      "MarkerFirstName",
      "MarkerLastName",
      "marker@example.com",
      "555-000-1234",
      "RIDE_MARKER"
    ]) {
      expect(json).not.toContain(forbidden);
    }
  });

  test("never includes raw location text, even though it may contain a full address or venue name", () => {
    const json = JSON.stringify(buildHtafTriageFacts(FULL_APPLICATION));
    expect(json).not.toContain("123 Marker Street");
    expect(json).not.toContain("Nashville Dialysis Center");
    expect(json).not.toContain("Vanderbilt Marker Medical Center");
    expect(json).not.toContain("MarkerCounty");
    expect(json).not.toContain("MarkerCity");
  });

  test("never includes household size or monthly income, exact or banded -- neither field is present at all", () => {
    const facts = buildHtafTriageFacts(FULL_APPLICATION);
    expect(facts).not.toHaveProperty("household_size");
    expect(facts).not.toHaveProperty("monthly_income");
    expect(facts).not.toHaveProperty("household_size_band");
    expect(facts).not.toHaveProperty("monthly_income_band");
    const json = JSON.stringify(facts);
    // 2734 (exact income) and a bare "7" (exact household size) must
    // not appear -- and neither may any band derived from them, since
    // even a coarse band still exposes and invites reasoning about
    // socioeconomic circumstances once triage is limited to
    // operational categorization rather than eligibility.
    expect(json).not.toContain("2734");
    expect(json).not.toMatch(/\b7\b/);
    expect(json.toLowerCase()).not.toMatch(/income|household/);
  });

  test("never includes raw free-text need description or admin notes, only presence/length category", () => {
    const facts = buildHtafTriageFacts(FULL_APPLICATION);
    expect(facts.transportation_need_detail).toBe("detailed");
    expect(facts.has_prior_admin_notes).toBe(true);
    const json = JSON.stringify(facts);
    expect(json).not.toContain("dialysis");
    expect(json).not.toContain("MarkerCondition");
    expect(json).not.toContain("MarkerDiagnosis");
  });

  test("derives service-area flags from location text without ever including that text", () => {
    const facts = buildHtafTriageFacts(FULL_APPLICATION);
    expect(facts.pickup_in_service_area).toBe(true);
    expect(facts.destination_in_service_area).toBe(false);
    expect(facts.home_in_service_area).toBe(true);
  });

  test("passes through only the already-coarse operational fields", () => {
    const facts = buildHtafTriageFacts(FULL_APPLICATION);
    expect(facts.status).toBe("submitted");
    expect(facts.program_type).toBe("medical");
    expect(facts.applicant_type).toBe("self");
    expect(facts.ride_date).toBe("2026-09-01");
    expect(facts.submitted_at).toBe("2026-01-01T00:00:00.000Z");
  });

  test("collapses an unrecognized/free-text applicant_type to 'unspecified' rather than passing it through", () => {
    const facts = buildHtafTriageFacts({ ...FULL_APPLICATION, applicant_type: "MarkerFreeTextInjection" });
    expect(facts.applicant_type).toBe("unspecified");
    expect(JSON.stringify(facts)).not.toContain("MarkerFreeTextInjection");
  });

  test("missing/empty fields degrade to explicit 'unspecified'/'missing'/null rather than throwing", () => {
    expect(buildHtafTriageFacts({})).toEqual({
      status: null,
      program_type: "general",
      applicant_type: "unspecified",
      home_in_service_area: null,
      pickup_in_service_area: null,
      destination_in_service_area: null,
      ride_date: null,
      transportation_need_detail: "missing",
      has_prior_admin_notes: false,
      submitted_at: null
    });
    expect(() => buildHtafTriageFacts(null)).not.toThrow();
    expect(() => buildHtafTriageFacts(undefined)).not.toThrow();
  });
});

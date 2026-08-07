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
  resolveHtafExportRequest
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

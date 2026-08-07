const { computeHtafPublicStats, resolveCreateRideOutcome } = require("./htafOperations");

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

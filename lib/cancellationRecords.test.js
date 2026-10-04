// Draft cancellation and no-show rules (lib/cancellationRecords.js). Every
// path returns fee_cents 0 with charges_active false: these are records of
// what the draft policy would decide, not charges.
const c = require("./cancellationRecords");

const T0 = Date.parse("2026-10-05T12:00:00Z");
const min = (n) => n * 60000;
const iso = (t) => new Date(t).toISOString();
const PICKUP = { pickup_lat: 36.1627, pickup_lng: -86.7816 };
// ~111 m north of the pickup per 0.001 degrees of latitude.
const north = (meters) => ({ lat: PICKUP.pickup_lat + meters / 111195, lng: PICKUP.pickup_lng });

function ride(over = {}) {
  return { id: "R1", status: "driver_enroute", accepted_at: iso(T0), ...PICKUP, ...over };
}

describe("never a charge", () => {
  test("every assessment and preview is $0.00 with charges inactive", () => {
    const cases = [
      ride({ status: "awaiting_driver", accepted_at: null }),
      ride(),
      ride({ pickup_progress_at: iso(T0 + min(4)), pickup_due_at: iso(T0 + min(10)) }),
      ride({ status: "arrived", arrived_at: iso(T0 + min(5)), pickup_due_at: iso(T0 + min(10)) })
    ];
    for (const r of cases) {
      const a = c.assessCancellation(r, { now: T0 + min(5) });
      expect(a).toMatchObject({ fee_cents: 0, charges_active: false, policy_version: c.POLICY_VERSION });
      expect(c.cancelPreview(r, { now: T0 + min(5) })).toMatchObject({ fee_cents: 0, fee_display: "$0.00", free: true });
    }
  });
});

describe("assessCancellation (what the draft policy would decide)", () => {
  test("before a driver accepts: free", () => {
    const a = c.assessCancellation(ride({ status: "awaiting_driver", accepted_at: null }), { now: T0 });
    expect(a).toMatchObject({ phase: "before_acceptance", waivers: ["before_acceptance"], policy_fee_eligible: false });
  });

  test("within 2 minutes of acceptance: free; just after: not in the free window", () => {
    expect(c.assessCancellation(ride(), { now: T0 + min(2) })).toMatchObject({ phase: "free_window", waivers: ["within_free_window"] });
    expect(c.assessCancellation(ride(), { now: T0 + min(2) + 1000 }).phase).toBe("after_free_window");
  });

  test("after the window, a fee would be eligible only while the driver is progressing, on time, with a known estimate", () => {
    const progressing = ride({ pickup_progress_at: iso(T0 + min(4)), pickup_due_at: iso(T0 + min(10)) });
    expect(c.assessCancellation(progressing, { now: T0 + min(5) })).toMatchObject({ policy_fee_eligible: true, waivers: [], fee_cents: 0 });
  });

  test("waived: no recent progress", () => {
    const stalled = ride({ pickup_progress_at: iso(T0 + min(1)), pickup_due_at: iso(T0 + min(10)) });
    expect(c.assessCancellation(stalled, { now: T0 + min(5) }).waivers).toEqual(["no_driver_progress"]);
  });

  test("waived: the driver is 5+ minutes past the estimate recorded at acceptance", () => {
    const late = ride({ pickup_progress_at: iso(T0 + min(15)), pickup_due_at: iso(T0 + min(10)) });
    expect(c.assessCancellation(late, { now: T0 + min(15) + 1000 }).waivers).toEqual(["driver_5_min_late"]);
    expect(c.assessCancellation(late, { now: T0 + min(14) }).waivers).toEqual([]);
    const arrivedLate = ride({ status: "arrived", arrived_at: iso(T0 + min(16)), pickup_due_at: iso(T0 + min(10)) });
    expect(c.assessCancellation(arrivedLate, { now: T0 + min(20) }).waivers).toEqual(["driver_5_min_late"]);
  });

  test("waived when a record is missing: an unknown estimate never counts against the rider", () => {
    const unknown = ride({ pickup_progress_at: iso(T0 + min(4)), pickup_due_at: null });
    expect(c.assessCancellation(unknown, { now: T0 + min(5) })).toMatchObject({ policy_fee_eligible: false, waivers: ["pickup_estimate_unknown"] });
    expect(c.assessCancellation(ride({ pickup_due_at: iso(T0 + min(10)) }), { now: T0 + min(5) }).waivers).toContain("no_driver_progress");
  });

  test("waived: Harvey service failure, admin incident, or a failed ride", () => {
    for (const category of [c.CANCELLATION_CATEGORY.SERVICE_FAILURE, c.CANCELLATION_CATEGORY.ADMIN_INCIDENT]) {
      expect(c.assessCancellation(ride(), { now: T0 + min(9), category })).toMatchObject({ phase: "harvey", waivers: ["harvey_service_failure"], policy_fee_eligible: false });
    }
    expect(c.assessCancellation(ride({ status: "failed" }), { now: T0 + min(9) }).waivers).toEqual(["harvey_service_failure"]);
  });
});

describe("pickup records", () => {
  test("estimate at acceptance: kept with its due time, resets earlier records", () => {
    const p = c.estimateAtAcceptPatch({ acceptedAt: iso(T0), etaMinutes: 6.44 });
    expect(p).toMatchObject({ eta_at_accept_minutes: 6.4, pickup_due_at: iso(T0 + 6.44 * 60000), contact_attempt_count: 0, arrival_verified: null, pickup_progress_at: null });
    expect(c.estimateAtAcceptPatch({ acceptedAt: iso(T0), etaMinutes: null })).toMatchObject({ eta_at_accept_minutes: null, pickup_due_at: null });
    expect(c.estimateAtAcceptPatch({ acceptedAt: iso(T0), etaMinutes: 999 }).pickup_due_at).toBeNull();
  });

  test("progress counts only when the driver gets at least 50 m closer", () => {
    let r = ride();
    const step = (meters, t) => {
      const patch = c.progressPatch(r, { ...north(meters), accuracy: 10, at: iso(t) });
      r = { ...r, ...patch };
      return patch;
    };
    const first = step(2000, T0 + 10000);
    expect(first.pickup_start_distance_m).toBeGreaterThan(1990);
    expect(first.pickup_progress_at).toBeUndefined();
    expect(step(1970, T0 + 20000).pickup_progress_at).toBeUndefined(); // only 30 m closer
    expect(step(1900, T0 + 30000).pickup_progress_at).toBe(iso(T0 + 30000));
    expect(step(1950, T0 + 40000).pickup_progress_at).toBeUndefined(); // moving away
    expect(r.pickup_last_distance_m).toBeLessThan(1910);
  });

  test("progress needs a pickup location and a valid fix", () => {
    expect(c.progressPatch(ride({ pickup_lat: null }), { lat: 1, lng: 1 })).toBeNull();
    expect(c.progressPatch(ride(), { lat: "x", lng: 1 })).toBeNull();
  });
});

describe("arrivalCheck (recorded, never blocking)", () => {
  const fix = (meters, ageMs = 10000, accuracy = 15) => ({ ...north(meters), accuracy, at: iso(T0 - ageMs) });
  test("verified: fresh, accurate, within 150 m", () => {
    expect(c.arrivalCheck(ride(), { fix: fix(60), now: T0 })).toMatchObject({ arrival_verified: true, arrival_check: "verified" });
  });
  test("not verified: too far, stale, inaccurate, or no location", () => {
    expect(c.arrivalCheck(ride(), { fix: fix(400), now: T0 }).arrival_check).toBe("not_at_pickup");
    expect(c.arrivalCheck(ride(), { fix: fix(60, min(3)), now: T0 }).arrival_check).toBe("location_stale");
    expect(c.arrivalCheck(ride(), { fix: fix(60, 10000, 250), now: T0 }).arrival_check).toBe("location_inaccurate");
    expect(c.arrivalCheck(ride(), { now: T0 }).arrival_check).toBe("no_driver_location");
    expect(c.arrivalCheck(ride({ pickup_lat: null }), { fix: fix(10), now: T0 }).arrival_check).toBe("no_pickup_location");
  });
  test("uses the ride's latest fix when none is passed", () => {
    const f = fix(30);
    const r = ride({ pickup_fix_lat: f.lat, pickup_fix_lng: f.lng, pickup_fix_accuracy_m: 8, pickup_fix_at: f.at });
    expect(c.arrivalCheck(r, { now: T0 }).arrival_verified).toBe(true);
  });
});

describe("noShowEligibility", () => {
  const arrived = (over = {}) => ride({ status: "arrived", arrived_at: iso(T0), arrival_verified: true, last_contact_attempt_at: iso(T0 + min(2)), ...over });
  test("eligible only with verified arrival, 7 minutes of waiting and a contact attempt after arrival", () => {
    expect(c.noShowEligibility(arrived(), { now: T0 + min(7) })).toMatchObject({ eligible: true, missing: [], waited_seconds: 420 });
  });
  test("each missing condition is named", () => {
    expect(c.noShowEligibility(arrived(), { now: T0 + min(6) })).toMatchObject({ eligible: false, missing: ["wait_under_7_minutes"], seconds_until_wait_met: 60 });
    expect(c.noShowEligibility(arrived({ arrival_verified: false }), { now: T0 + min(8) }).missing).toEqual(["arrival_not_verified"]);
    expect(c.noShowEligibility(arrived({ last_contact_attempt_at: null }), { now: T0 + min(8) }).missing).toEqual(["no_contact_attempt_after_arrival"]);
    expect(c.noShowEligibility(arrived({ last_contact_attempt_at: iso(T0 - 1000) }), { now: T0 + min(8) }).missing).toEqual(["no_contact_attempt_after_arrival"]);
    expect(c.noShowEligibility(ride(), { now: T0 + min(8) }).missing).toEqual(expect.arrayContaining(["not_arrived", "arrival_not_verified"]));
  });
});

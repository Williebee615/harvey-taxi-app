const x = require("./dispatchExceptions");

const NOW = Date.parse("2026-10-22T12:00:00Z");
const minsAgo = (m) => new Date(NOW - m * 60000).toISOString();
const minsAhead = (m) => new Date(NOW + m * 60000).toISOString();
const PICKUP = { pickup_lat: 36.1627, pickup_lng: -86.7816 };
const live = (over = {}) => ({ id: "D1", first_name: "Sam", last_name: "Ortiz", online: true, last_seen_at: minsAgo(1), current_lat: 36.17, current_lng: -86.78, ...over });
const codes = (list) => list.map((e) => `${e.code}:${e.severity}`);

test("scheduled pickup soon with no ready driver nearby: warning at 45 min, critical at 30", () => {
  const ride = { id: "R1", status: "payment_authorized", scheduled_time: minsAhead(40), ...PICKUP };
  expect(codes(x.rideExceptions(ride, { now: NOW, liveReadyNearby: 0 }))).toEqual(["scheduled_no_coverage:warning"]);
  expect(codes(x.rideExceptions({ ...ride, scheduled_time: minsAhead(25) }, { now: NOW, liveReadyNearby: 0 }))).toEqual(["scheduled_no_coverage:critical"]);
  expect(x.rideExceptions(ride, { now: NOW, liveReadyNearby: 2 })).toEqual([]);
  expect(x.rideExceptions({ ...ride, scheduled_time: minsAhead(90) }, { now: NOW, liveReadyNearby: 0 })).toEqual([]);
});

test("paid and due but never offered to drivers is critical", () => {
  expect(codes(x.rideExceptions({ id: "R", status: "payment_authorized", created_at: minsAgo(8) }, { now: NOW, liveReadyNearby: 3 }))).toEqual(["not_dispatched:critical"]);
  expect(x.rideExceptions({ id: "R", status: "payment_authorized", created_at: minsAgo(2) }, { now: NOW, liveReadyNearby: 3 })).toEqual([]);
});

test("unmatched: warning after 2 minutes, critical after 5", () => {
  const ride = { id: "R", status: "awaiting_driver_acceptance" };
  expect(x.rideExceptions({ ...ride, last_dispatch_at: minsAgo(1) }, { now: NOW })).toEqual([]);
  expect(codes(x.rideExceptions({ ...ride, last_dispatch_at: minsAgo(3) }, { now: NOW }))).toEqual(["unmatched:warning"]);
  expect(codes(x.rideExceptions({ ...ride, last_dispatch_at: minsAgo(6) }, { now: NOW }))).toEqual(["unmatched:critical"]);
});

test("assigned driver offline or silent; late against the accepted ETA", () => {
  const ride = { id: "R", status: "driver_enroute", driver_id: "D1", accepted_at: minsAgo(30), driver_eta_to_pickup_minutes: 8 };
  const offline = new Map([["D1", live({ online: false })]]);
  expect(codes(x.rideExceptions(ride, { now: NOW, driversById: offline }))).toEqual(["driver_not_live:critical", "late_pickup:critical"]);
  const silent = new Map([["D1", live({ last_seen_at: minsAgo(6) })]]);
  expect(x.rideExceptions({ ...ride, accepted_at: minsAgo(5) }, { now: NOW, driversById: silent })[0]).toMatchObject({ code: "driver_not_live", detail: { minutes_since_update: 6 } });
  const fine = new Map([["D1", live()]]);
  expect(x.rideExceptions({ ...ride, accepted_at: minsAgo(15) }, { now: NOW, driversById: fine })).toEqual([]);
  // After a staff reassignment the first driver's ETA no longer applies.
  expect(x.rideExceptions({ ...ride, dispatch_status: "admin_reassigned" }, { now: NOW, driversById: fine })).toEqual([]);
});

test("candidates: live, ready, free drivers nearest first, straight-line miles", () => {
  const ride = { id: "R", driver_id: "D9", ...PICKUP };
  const drivers = [
    live({ id: "FAR", current_lat: 36.3, current_lng: -86.78 }),
    live({ id: "NEAR", current_lat: 36.1772, current_lng: -86.7816 }),
    live({ id: "OFF", online: false }),
    live({ id: "STALE", last_seen_at: minsAgo(10) }),
    live({ id: "BUSY" }),
    live({ id: "UNREADY" }),
    live({ id: "D9" })
  ];
  const out = x.candidateDrivers(ride, drivers, { now: NOW, isReady: (d) => d.id !== "UNREADY", busyDriverIds: new Set(["BUSY"]) });
  expect(out.map((c) => c.driver_id)).toEqual(["NEAR", "FAR"]);
  expect(out[0]).toMatchObject({ name: "Sam O.", straight_line_miles: 1 });
  expect(JSON.stringify(out)).not.toMatch(/phone|email/);
});

test("a reassignment needs a driver and a note", () => {
  expect(x.validateReassignment({ driver_id: "D1" }).ok).toBe(false);
  expect(x.validateReassignment({ driver_id: "D1", note: "ok" }).ok).toBe(false);
  expect(x.validateReassignment({ driver_id: " D1 ", note: "Driver offline, rider waiting" })).toEqual({ ok: true, driver_id: "D1", note: "Driver offline, rider waiting" });
});

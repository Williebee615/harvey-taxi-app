const d = require("./reviewDemo");

const T0 = Date.parse("2026-10-08T12:00:00Z");
const s = (n) => n * 1000;
const ride = (over = {}) => ({ id: "R1", status: "driver_assigned", review_demo: "autopilot", pickup_lat: 36.1627, pickup_lng: -86.7816, dropoff_lat: 36.1745, dropoff_lng: -86.7679, estimated_fare: 18.5, ...over });

describe("simulated driver (rider demo)", () => {
  test("starts with a labelled simulated driver and the next stage due in 25 seconds", () => {
    const p = d.autopilotStartPatch({ now: T0 });
    expect(p).toMatchObject({ review_demo: "autopilot", driver_id: null, driver_name: "Simulated driver", driver_vehicle: "Demo vehicle (simulated)", driver_phone: null });
    expect(Date.parse(p.review_demo_next_at) - T0).toBe(25000);
  });

  test("advances one stage every 25 seconds to completion, with the fare as the final fare", () => {
    let r = ride({ review_demo_next_at: new Date(T0 + s(25)).toISOString() });
    expect(d.dueStage(r, T0 + s(24))).toBeNull();
    const seen = [];
    let now = T0 + s(25);
    for (;;) {
      const step = d.dueStage(r, now);
      if (!step) break;
      seen.push(step.to);
      r = { ...r, status: step.to, ...step.patch };
      now += s(25);
    }
    expect(seen).toEqual(["driver_enroute", "arrived", "in_progress", "completed"]);
    expect(r).toMatchObject({ final_fare: 18.5, review_demo_next_at: null });
    expect(r.completed_at).toBeTruthy();
  });

  test("never acts on a ride that isn't an autopilot ride or has moved on (cancelled)", () => {
    expect(d.dueStage(ride({ review_demo: null, review_demo_next_at: new Date(T0).toISOString() }), T0 + s(60))).toBeNull();
    expect(d.dueStage(ride({ review_demo: "auto_offer", review_demo_next_at: new Date(T0).toISOString() }), T0 + s(60))).toBeNull();
    expect(d.dueStage(ride({ status: "cancelled", review_demo_next_at: new Date(T0).toISOString() }), T0 + s(60))).toBeNull();
  });

  test("the simulated position is labelled, approaches the pickup, waits there, then heads to the destination", () => {
    const due = new Date(T0 + s(25)).toISOString();
    const a = d.simulatedPosition(ride({ status: "driver_enroute", review_demo_next_at: due }), T0 + s(1));
    const b = d.simulatedPosition(ride({ status: "driver_enroute", review_demo_next_at: due }), T0 + s(24));
    expect(a).toMatchObject({ simulated: true, label: "Simulated location", stale: false });
    expect(b.lat).toBeLessThan(a.lat); // moving south toward the pickup
    expect(d.simulatedPosition(ride({ status: "arrived", review_demo_next_at: due }), T0)).toMatchObject({ lat: 36.1627, lng: -86.7816 });
    const trip = d.simulatedPosition(ride({ status: "in_progress", review_demo_next_at: due }), T0 + s(24));
    expect(trip.lat).toBeGreaterThan(36.1627);
    expect(d.simulatedPosition(ride({ review_demo: null }), T0)).toBeNull();
  });
});

describe("simulated offer (driver demo)", () => {
  const base = { enabled: true, driver: { id: "D", online: true, is_review_account: true }, activeRide: null, pendingOffer: false, openReviewRide: false, idleSinceMs: T0, now: T0 + s(20) };
  test("only after 20 seconds online and idle, with no open review ride anywhere", () => {
    expect(d.shouldAutoOffer(base)).toEqual({ ok: true, reason: null });
    expect(d.shouldAutoOffer({ ...base, now: T0 + s(19) }).reason).toBe("not_idle_long_enough");
    expect(d.shouldAutoOffer({ ...base, enabled: false }).reason).toBe("disabled");
    expect(d.shouldAutoOffer({ ...base, driver: { ...base.driver, online: false } }).reason).toBe("offline");
    expect(d.shouldAutoOffer({ ...base, driver: { ...base.driver, is_review_account: false } }).reason).toBe("no_review_driver");
    expect(d.shouldAutoOffer({ ...base, activeRide: { id: "X" } }).reason).toBe("driver_busy");
    expect(d.shouldAutoOffer({ ...base, pendingOffer: true }).reason).toBe("offer_pending");
    expect(d.shouldAutoOffer({ ...base, openReviewRide: true }).reason).toBe("review_ride_open");
  });

  test("the demo ride is a labelled review ride with no rider and no payment", () => {
    const r = d.demoRideForDriver({ id: "RIDE-X", estimate: { total: 9, driver_payout: 6 }, now: T0 });
    expect(r).toMatchObject({ rider_id: null, rider_phone: null, is_review_ride: true, review_demo: "auto_offer", payment_status: "not_required", status: "payment_authorized" });
    expect(r.rider_name).toMatch(/simulated/);
    expect(r.pickup_address).toMatch(/simulated/);
    expect(r.dropoff_address).toMatch(/simulated/);
  });

  test("abandoned demo rides are stale after 30 minutes", () => {
    const old = { status: "driver_enroute", updated_at: new Date(T0).toISOString() };
    expect(d.isStale(old, T0 + 30 * 60000 + 1)).toBe(true);
    expect(d.isStale(old, T0 + 29 * 60000)).toBe(false);
    expect(d.isStale({ ...old, status: "completed" }, T0 + 60 * 60000)).toBe(false);
  });
});

const ra = require("./rideAccess");

test("tracking tokens are per ride, per secret, and checked in constant time", () => {
  const t = ra.signRideTrackingToken("RIDE-1", "s");
  expect(t).toHaveLength(32);
  expect(ra.verifyRideTrackingToken("RIDE-1", t, "s")).toBe(true);
  expect(ra.verifyRideTrackingToken("RIDE-2", t, "s")).toBe(false);
  expect(ra.verifyRideTrackingToken("RIDE-1", t, "other")).toBe(false);
  expect(ra.verifyRideTrackingToken("RIDE-1", "", "s")).toBe(false);
  expect(ra.verifyRideTrackingToken("RIDE-1", t, "")).toBe(false);
  expect(ra.signRideTrackingToken("RIDE-1", "")).toBeNull();
});

test("the derived secret never equals the quote secret", () => {
  expect(ra.deriveTrackingSecret({ trackingSecret: "own", quoteSecret: "q" })).toBe("own");
  const d = ra.deriveTrackingSecret({ quoteSecret: "q" });
  expect(d).toBeTruthy();
  expect(d).not.toBe("q");
  expect(ra.deriveTrackingSecret({})).toBe("");
});

test("viewer decision", () => {
  const ride = { id: "R", rider_id: "RIDER_1", driver_id: "DRIVER_1" };
  expect(ra.decideRideViewer({ ride })).toBeNull();
  expect(ra.decideRideViewer({ ride, isAdmin: true })).toBe("admin");
  expect(ra.decideRideViewer({ ride, sessionRiderId: "RIDER_1" })).toBe("rider");
  expect(ra.decideRideViewer({ ride, sessionRiderId: "RIDER_2" })).toBeNull();
  expect(ra.decideRideViewer({ ride, trackingTokenValid: true })).toBe("rider");
  expect(ra.decideRideViewer({ ride, sessionDriverId: "DRIVER_1" })).toBe("driver");
  expect(ra.decideRideViewer({ ride, sessionDriverId: "DRIVER_2" })).toBeNull();
  expect(ra.decideRideViewer({ ride: { ...ride, driver_id: null }, sessionDriverId: "DRIVER_1" })).toBeNull();
  expect(ra.decideRideViewer({ ride: null, isAdmin: true })).toBeNull();
});

test("drivers never receive the delivery PIN", () => {
  const payload = { id: "R", delivery: { pin: "1234", stage: "x" } };
  expect(ra.shapeStatusForViewer(payload, "driver").delivery).toEqual({ stage: "x" });
  expect(ra.shapeStatusForViewer(payload, "rider").delivery.pin).toBe("1234");
  expect(ra.shapeStatusForViewer({ id: "R", delivery: null }, "driver")).toEqual({ id: "R", delivery: null });
});

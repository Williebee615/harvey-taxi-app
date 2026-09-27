const { createFakeSupabase } = require("../test/fakeSupabase");
const { RIDE_STATUS } = require("./rideDispatch");
const {
  RIDE_TRANSITIONS,
  isTerminalStatus,
  isValidTransition,
  claimRideTransition
} = require("./rideLifecycle");

describe("isValidTransition / RIDE_TRANSITIONS", () => {
  it("allows every required core lifecycle edge", () => {
    expect(isValidTransition(RIDE_STATUS.PAYMENT_AUTHORIZED, RIDE_STATUS.AWAITING_DRIVER)).toBe(true);
    expect(isValidTransition(RIDE_STATUS.AWAITING_DRIVER, RIDE_STATUS.DRIVER_ASSIGNED)).toBe(true);
    expect(isValidTransition(RIDE_STATUS.DRIVER_ASSIGNED, RIDE_STATUS.DRIVER_ENROUTE)).toBe(true);
    expect(isValidTransition(RIDE_STATUS.DRIVER_ENROUTE, RIDE_STATUS.ARRIVED)).toBe(true);
    expect(isValidTransition(RIDE_STATUS.ARRIVED, RIDE_STATUS.IN_PROGRESS)).toBe(true);
    expect(isValidTransition(RIDE_STATUS.IN_PROGRESS, RIDE_STATUS.COMPLETED)).toBe(true);
  });

  it("rejects skipping a stage", () => {
    expect(isValidTransition(RIDE_STATUS.DRIVER_ASSIGNED, RIDE_STATUS.ARRIVED)).toBe(false);
    expect(isValidTransition(RIDE_STATUS.AWAITING_DRIVER, RIDE_STATUS.IN_PROGRESS)).toBe(false);
    expect(isValidTransition(RIDE_STATUS.PAYMENT_AUTHORIZED, RIDE_STATUS.DRIVER_ASSIGNED)).toBe(false);
  });

  it("rejects going backward", () => {
    expect(isValidTransition(RIDE_STATUS.IN_PROGRESS, RIDE_STATUS.ARRIVED)).toBe(false);
    expect(isValidTransition(RIDE_STATUS.ARRIVED, RIDE_STATUS.DRIVER_ENROUTE)).toBe(false);
    expect(isValidTransition(RIDE_STATUS.COMPLETED, RIDE_STATUS.IN_PROGRESS)).toBe(false);
  });

  it("rejects any transition out of a terminal status", () => {
    for (const to of Object.values(RIDE_STATUS)) {
      expect(isValidTransition(RIDE_STATUS.COMPLETED, to)).toBe(false);
      expect(isValidTransition(RIDE_STATUS.CANCELLED, to)).toBe(false);
    }
  });

  it("rejects a duplicate no-op transition (completed -> completed)", () => {
    expect(isValidTransition(RIDE_STATUS.COMPLETED, RIDE_STATUS.COMPLETED)).toBe(false);
    expect(isValidTransition(RIDE_STATUS.IN_PROGRESS, RIDE_STATUS.IN_PROGRESS)).toBe(false);
  });

  it("allows cancellation from every pre-in_progress status but not from in_progress", () => {
    expect(isValidTransition(RIDE_STATUS.PAYMENT_REQUIRED, RIDE_STATUS.CANCELLED)).toBe(true);
    expect(isValidTransition(RIDE_STATUS.PAYMENT_AUTHORIZED, RIDE_STATUS.CANCELLED)).toBe(true);
    expect(isValidTransition(RIDE_STATUS.AWAITING_DRIVER, RIDE_STATUS.CANCELLED)).toBe(true);
    expect(isValidTransition(RIDE_STATUS.DRIVER_ASSIGNED, RIDE_STATUS.CANCELLED)).toBe(true);
    expect(isValidTransition(RIDE_STATUS.DRIVER_ENROUTE, RIDE_STATUS.CANCELLED)).toBe(true);
    expect(isValidTransition(RIDE_STATUS.ARRIVED, RIDE_STATUS.CANCELLED)).toBe(true);
    expect(isValidTransition(RIDE_STATUS.IN_PROGRESS, RIDE_STATUS.CANCELLED)).toBe(false);
  });

  it("allows driver withdrawal (assigned/enroute/arrived -> awaiting_driver) but not from in_progress", () => {
    expect(isValidTransition(RIDE_STATUS.DRIVER_ASSIGNED, RIDE_STATUS.AWAITING_DRIVER)).toBe(true);
    expect(isValidTransition(RIDE_STATUS.DRIVER_ENROUTE, RIDE_STATUS.AWAITING_DRIVER)).toBe(true);
    expect(isValidTransition(RIDE_STATUS.ARRIVED, RIDE_STATUS.AWAITING_DRIVER)).toBe(true);
    expect(isValidTransition(RIDE_STATUS.IN_PROGRESS, RIDE_STATUS.AWAITING_DRIVER)).toBe(false);
  });

  it("has an entry (even if empty) for every RIDE_STATUS value, so a typo'd status can't silently allow everything", () => {
    for (const status of Object.values(RIDE_STATUS)) {
      expect(Object.prototype.hasOwnProperty.call(RIDE_TRANSITIONS, status)).toBe(true);
    }
  });
});

describe("isTerminalStatus", () => {
  it("treats only completed and cancelled as terminal", () => {
    expect(isTerminalStatus(RIDE_STATUS.COMPLETED)).toBe(true);
    expect(isTerminalStatus(RIDE_STATUS.CANCELLED)).toBe(true);
    expect(isTerminalStatus(RIDE_STATUS.IN_PROGRESS)).toBe(false);
    expect(isTerminalStatus(RIDE_STATUS.FAILED)).toBe(false);
  });
});

describe("claimRideTransition", () => {
  function seed(ride) {
    return createFakeSupabase({ rides: [ride] });
  }

  it("wins the claim and applies the patch when the ride is in an allowed from-status", async () => {
    const supabase = seed({ id: "R1", status: RIDE_STATUS.ARRIVED });

    const result = await claimRideTransition({
      supabase,
      rideId: "R1",
      fromStatuses: [RIDE_STATUS.ARRIVED],
      toStatus: RIDE_STATUS.IN_PROGRESS,
      patch: { trip_started_at: "2026-01-01T00:00:00.000Z" }
    });

    expect(result.ok).toBe(true);
    expect(result.ride.status).toBe(RIDE_STATUS.IN_PROGRESS);
    expect(result.ride.trip_started_at).toBe("2026-01-01T00:00:00.000Z");
  });

  it("loses the claim when the ride is not in an allowed from-status, and reports the real current status", async () => {
    const supabase = seed({ id: "R2", status: RIDE_STATUS.COMPLETED });

    const result = await claimRideTransition({
      supabase,
      rideId: "R2",
      fromStatuses: [RIDE_STATUS.ARRIVED],
      toStatus: RIDE_STATUS.IN_PROGRESS
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("invalid_transition");
    expect(result.currentStatus).toBe(RIDE_STATUS.COMPLETED);
    // The ride itself must be untouched -- still completed, no accidental write.
    expect(result.ride.status).toBe(RIDE_STATUS.COMPLETED);
  });

  it("reports not_found for a ride id that doesn't exist, without throwing", async () => {
    const supabase = seed({ id: "R3", status: RIDE_STATUS.ARRIVED });

    const result = await claimRideTransition({
      supabase,
      rideId: "does-not-exist",
      fromStatuses: [RIDE_STATUS.ARRIVED],
      toStatus: RIDE_STATUS.IN_PROGRESS
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("not_found");
    expect(result.ride).toBeNull();
  });

  it("only one of two concurrent callers wins the claim on the same ride", async () => {
    const supabase = seed({ id: "R4", status: RIDE_STATUS.IN_PROGRESS });

    const attempt = () =>
      claimRideTransition({
        supabase,
        rideId: "R4",
        fromStatuses: [RIDE_STATUS.IN_PROGRESS],
        toStatus: RIDE_STATUS.COMPLETED,
        patch: { completed_at: "now" }
      });

    const [first, second] = await Promise.all([attempt(), attempt()]);

    const winners = [first, second].filter((r) => r.ok);
    const losers = [first, second].filter((r) => !r.ok);

    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    expect(losers[0].reason).toBe("invalid_transition");
    expect(losers[0].currentStatus).toBe(RIDE_STATUS.COMPLETED);
  });

  it("accepts multiple from-statuses (used for idempotent-retry checks)", async () => {
    const supabase = seed({ id: "R5", status: RIDE_STATUS.FAILED });

    const result = await claimRideTransition({
      supabase,
      rideId: "R5",
      fromStatuses: [RIDE_STATUS.AWAITING_DRIVER, RIDE_STATUS.FAILED],
      toStatus: RIDE_STATUS.CANCELLED
    });

    expect(result.ok).toBe(true);
    expect(result.ride.status).toBe(RIDE_STATUS.CANCELLED);
  });
});

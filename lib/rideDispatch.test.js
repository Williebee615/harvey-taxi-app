const {
  RIDE_STATUS,
  shouldDispatchRideNow,
  sweepScheduledRides,
  SCHEDULED_DISPATCH_LEASE_MS
} = require("./rideDispatch");

describe("shouldDispatchRideNow", () => {
  it("does not dispatch a future scheduled ride immediately", () => {
    const ride = {
      id: "scheduled-test",
      status: RIDE_STATUS.PAYMENT_AUTHORIZED,
      scheduled_time: new Date(Date.now() + 60 * 60 * 1000).toISOString()
    };

    expect(shouldDispatchRideNow(ride)).toBe(false);
  });

  it("dispatches once the scheduled time has arrived", () => {
    const ride = {
      id: "scheduled-due",
      status: RIDE_STATUS.PAYMENT_AUTHORIZED,
      scheduled_time: new Date(Date.now() - 60 * 1000).toISOString()
    };

    expect(shouldDispatchRideNow(ride)).toBe(true);
  });

  it("dispatches an unscheduled ride immediately once payment is authorized", () => {
    const ride = {
      id: "unscheduled",
      status: RIDE_STATUS.PAYMENT_AUTHORIZED,
      scheduled_time: null
    };

    expect(shouldDispatchRideNow(ride)).toBe(true);
  });

  it("does not dispatch a ride that hasn't been payment-authorized yet", () => {
    const ride = {
      id: "unpaid",
      status: RIDE_STATUS.PAYMENT_REQUIRED,
      scheduled_time: null
    };

    expect(shouldDispatchRideNow(ride)).toBe(false);
  });

  it("treats an unparseable scheduled_time as immediately dispatchable rather than stuck forever", () => {
    const ride = {
      id: "bad-schedule",
      status: RIDE_STATUS.PAYMENT_AUTHORIZED,
      scheduled_time: "not-a-real-date"
    };

    expect(shouldDispatchRideNow(ride)).toBe(true);
  });

  it("respects an explicit reference time instead of always using the live clock", () => {
    const scheduledFor = new Date("2026-01-01T12:00:00.000Z");
    const ride = {
      id: "explicit-now",
      status: RIDE_STATUS.PAYMENT_AUTHORIZED,
      scheduled_time: scheduledFor.toISOString()
    };

    expect(
      shouldDispatchRideNow(ride, new Date("2026-01-01T11:59:00.000Z"))
    ).toBe(false);

    expect(
      shouldDispatchRideNow(ride, new Date("2026-01-01T12:00:00.000Z"))
    ).toBe(true);
  });
});

describe("sweepScheduledRides", () => {
  // Silence the orchestrator's own logging so test output stays readable;
  // still assertable via these mocks where a test cares what got logged.
  const log = jest.fn();
  const logError = jest.fn();

  beforeEach(() => {
    log.mockClear();
    logError.mockClear();
  });

  it("dispatches a claimed due ride and reports it as dispatched", async () => {
    const dueRide = { id: "ride-1", scheduled_time: "2026-01-01T12:00:00.000Z" };
    const claimed = { ...dueRide };

    const findDueRides = jest.fn().mockResolvedValue([dueRide]);
    const claimRide = jest.fn().mockResolvedValue(claimed);
    const resetRide = jest.fn().mockResolvedValue();
    const dispatchRide = jest.fn().mockResolvedValue({ dispatched: true });

    const result = await sweepScheduledRides({
      findDueRides,
      claimRide,
      resetRide,
      dispatchRide,
      log,
      logError
    });

    expect(dispatchRide).toHaveBeenCalledWith(claimed);
    expect(resetRide).not.toHaveBeenCalled();
    expect(result).toEqual({ dispatched: ["ride-1"], failed: [], skipped: [] });
  });

  it("resets a ride to ready_to_dispatch when dispatch fails, so it's retried next tick", async () => {
    const claimed = { id: "ride-2", scheduled_time: "2026-01-01T12:00:00.000Z" };

    const findDueRides = jest.fn().mockResolvedValue([claimed]);
    const claimRide = jest.fn().mockResolvedValue(claimed);
    const resetRide = jest.fn().mockResolvedValue();
    const dispatchRide = jest.fn().mockRejectedValue(new Error("no drivers available"));

    const result = await sweepScheduledRides({
      findDueRides,
      claimRide,
      resetRide,
      dispatchRide,
      log,
      logError
    });

    expect(resetRide).toHaveBeenCalledWith("ride-2");
    expect(result).toEqual({ dispatched: [], failed: ["ride-2"], skipped: [] });
  });

  it("never dispatches a ride whose claim returns null (state changed between query and claim)", async () => {
    const dueRide = { id: "ride-3", scheduled_time: "2026-01-01T12:00:00.000Z" };

    const findDueRides = jest.fn().mockResolvedValue([dueRide]);
    // Simulates the real Supabase adapter's conditional update matching zero
    // rows — e.g. the ride was cancelled after findDueRides ran but before
    // this claim, so its status no longer matches the claim's WHERE clause.
    const claimRide = jest.fn().mockResolvedValue(null);
    const resetRide = jest.fn().mockResolvedValue();
    const dispatchRide = jest.fn();

    const result = await sweepScheduledRides({
      findDueRides,
      claimRide,
      resetRide,
      dispatchRide,
      log,
      logError
    });

    expect(dispatchRide).not.toHaveBeenCalled();
    expect(resetRide).not.toHaveBeenCalled();
    expect(result).toEqual({ dispatched: [], failed: [], skipped: ["ride-3"] });
  });

  it("computes the claim cutoff using the lease timeout, so a stale claim can be reclaimed", async () => {
    const dueRide = { id: "ride-4", scheduled_time: "2026-01-01T12:00:00.000Z" };
    const fixedNow = new Date("2026-01-01T13:00:00.000Z");

    const findDueRides = jest.fn().mockResolvedValue([dueRide]);
    const claimRide = jest.fn().mockResolvedValue({ ...dueRide });
    const resetRide = jest.fn().mockResolvedValue();
    const dispatchRide = jest.fn().mockResolvedValue({});

    await sweepScheduledRides({
      findDueRides,
      claimRide,
      resetRide,
      dispatchRide,
      now: () => fixedNow,
      log,
      logError
    });

    const expectedCutoff = new Date(fixedNow.getTime() - SCHEDULED_DISPATCH_LEASE_MS);

    expect(findDueRides).toHaveBeenCalledWith(fixedNow, expectedCutoff);
    expect(claimRide).toHaveBeenCalledWith("ride-4", expectedCutoff);
  });

  it("skips a ride whose claim call throws, without touching dispatch", async () => {
    const dueRide = { id: "ride-5", scheduled_time: "2026-01-01T12:00:00.000Z" };

    const findDueRides = jest.fn().mockResolvedValue([dueRide]);
    const claimRide = jest.fn().mockRejectedValue(new Error("db unavailable"));
    const resetRide = jest.fn().mockResolvedValue();
    const dispatchRide = jest.fn();

    const result = await sweepScheduledRides({
      findDueRides,
      claimRide,
      resetRide,
      dispatchRide,
      log,
      logError
    });

    expect(dispatchRide).not.toHaveBeenCalled();
    expect(result.skipped).toEqual(["ride-5"]);
  });

  it("returns an empty result and logs rather than throwing when the due-rides query fails", async () => {
    const findDueRides = jest.fn().mockRejectedValue(new Error("connection reset"));
    const claimRide = jest.fn();
    const resetRide = jest.fn();
    const dispatchRide = jest.fn();

    const result = await sweepScheduledRides({
      findDueRides,
      claimRide,
      resetRide,
      dispatchRide,
      log,
      logError
    });

    expect(claimRide).not.toHaveBeenCalled();
    expect(result).toEqual({ dispatched: [], failed: [], skipped: [] });
    expect(logError).toHaveBeenCalled();
  });
});

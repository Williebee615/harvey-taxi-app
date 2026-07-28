const { sweepExpiredOffers } = require("./offerExpiry");

function makeOffer(overrides = {}) {
  return {
    id: "OFFER-1",
    ride_id: "RIDE-1",
    driver_id: "DRIVER-1",
    status: "pending",
    ...overrides
  };
}

function makeRide(overrides = {}) {
  return {
    id: "RIDE-1",
    dispatch_attempts: 1,
    status: "awaiting_driver_acceptance",
    ...overrides
  };
}

function silentLoggers() {
  return { log: () => {}, logError: () => {} };
}

describe("sweepExpiredOffers — ignored offer past its expiry", () => {
  it("claims the offer, marks it expired, and redispatches the ride", async () => {
    const offer = makeOffer();
    const ride = makeRide({ dispatch_attempts: 1 });
    const dispatchRide = jest.fn().mockResolvedValue({ dispatched: true });
    const markRideRedispatching = jest.fn().mockResolvedValue();
    const markRideMaxAttemptsReached = jest.fn().mockResolvedValue();

    const result = await sweepExpiredOffers({
      findExpiredOffers: async () => [offer],
      claimExpiredOffer: async (id) => (id === offer.id ? { ...offer, status: "expired" } : null),
      getRide: async () => ride,
      markRideRedispatching,
      markRideMaxAttemptsReached,
      dispatchRide,
      maxAttempts: 5,
      ...silentLoggers()
    });

    expect(result.expired).toEqual([offer.id]);
    expect(result.redispatched).toEqual([ride.id]);
    expect(markRideRedispatching).toHaveBeenCalledWith(ride.id, 2);
    expect(dispatchRide).toHaveBeenCalledWith(expect.objectContaining({ id: ride.id, dispatch_attempts: 2 }));
    expect(markRideMaxAttemptsReached).not.toHaveBeenCalled();
  });
});

describe("sweepExpiredOffers — offer already accepted before the sweep ran", () => {
  it("skips it without touching the ride (claim fails because status is no longer pending)", async () => {
    const offer = makeOffer();
    const dispatchRide = jest.fn();
    const markRideRedispatching = jest.fn();

    const result = await sweepExpiredOffers({
      findExpiredOffers: async () => [offer],
      // Simulates the real atomic UPDATE ... WHERE status = 'pending'
      // finding zero matching rows because a driver already accepted.
      claimExpiredOffer: async () => null,
      getRide: jest.fn(),
      markRideRedispatching,
      markRideMaxAttemptsReached: jest.fn(),
      dispatchRide,
      maxAttempts: 5,
      ...silentLoggers()
    });

    expect(result.skipped).toEqual([offer.id]);
    expect(result.expired).toEqual([]);
    expect(dispatchRide).not.toHaveBeenCalled();
    expect(markRideRedispatching).not.toHaveBeenCalled();
  });
});

describe("sweepExpiredOffers — offer already declined before the sweep ran", () => {
  it("skips it and does not double-redispatch a ride the decline route already handled", async () => {
    const offer = makeOffer();
    const dispatchRide = jest.fn();

    const result = await sweepExpiredOffers({
      findExpiredOffers: async () => [offer],
      claimExpiredOffer: async () => null,
      getRide: jest.fn(),
      markRideRedispatching: jest.fn(),
      markRideMaxAttemptsReached: jest.fn(),
      dispatchRide,
      maxAttempts: 5,
      ...silentLoggers()
    });

    expect(result.skipped).toEqual([offer.id]);
    expect(dispatchRide).not.toHaveBeenCalled();
  });
});

describe("sweepExpiredOffers — expired offer processed concurrently by two sweep ticks/instances", () => {
  it("only the winning claim redispatches; the loser is skipped, so the ride is never redispatched twice", async () => {
    const offer = makeOffer();
    const ride = makeRide();
    const dispatchRide = jest.fn().mockResolvedValue({ dispatched: true });

    let claimCallCount = 0;
    const claimExpiredOffer = jest.fn(async (id) => {
      claimCallCount += 1;
      // First caller wins the atomic claim; every subsequent caller for
      // the same offer id sees it's no longer pending.
      return claimCallCount === 1 ? { ...offer, id, status: "expired" } : null;
    });

    // Simulate two concurrent sweep passes both having queried the same
    // due offer before either claimed it.
    const passA = sweepExpiredOffers({
      findExpiredOffers: async () => [offer],
      claimExpiredOffer,
      getRide: async () => ride,
      markRideRedispatching: jest.fn(),
      markRideMaxAttemptsReached: jest.fn(),
      dispatchRide,
      maxAttempts: 5,
      ...silentLoggers()
    });
    const passB = sweepExpiredOffers({
      findExpiredOffers: async () => [offer],
      claimExpiredOffer,
      getRide: async () => ride,
      markRideRedispatching: jest.fn(),
      markRideMaxAttemptsReached: jest.fn(),
      dispatchRide,
      maxAttempts: 5,
      ...silentLoggers()
    });

    const [resultA, resultB] = await Promise.all([passA, passB]);

    expect(dispatchRide).toHaveBeenCalledTimes(1);
    const combinedRedispatched = [...resultA.redispatched, ...resultB.redispatched];
    const combinedSkipped = [...resultA.skipped, ...resultB.skipped];
    expect(combinedRedispatched).toEqual([ride.id]);
    expect(combinedSkipped).toEqual([offer.id]);
  });
});

describe("sweepExpiredOffers — MAX_DISPATCH_ATTEMPTS respected", () => {
  it("marks the ride failed instead of redispatching once attempts are exhausted", async () => {
    const offer = makeOffer();
    const ride = makeRide({ dispatch_attempts: 5 });
    const dispatchRide = jest.fn();
    const markRideMaxAttemptsReached = jest.fn().mockResolvedValue();

    const result = await sweepExpiredOffers({
      findExpiredOffers: async () => [offer],
      claimExpiredOffer: async () => ({ ...offer, status: "expired" }),
      getRide: async () => ride,
      markRideRedispatching: jest.fn(),
      markRideMaxAttemptsReached,
      dispatchRide,
      maxAttempts: 5,
      ...silentLoggers()
    });

    expect(result.maxedOut).toEqual([ride.id]);
    expect(markRideMaxAttemptsReached).toHaveBeenCalledWith(ride.id);
    expect(dispatchRide).not.toHaveBeenCalled();
  });
});

describe("sweepExpiredOffers — edge cases", () => {
  it("skips gracefully if the ride tied to a claimed offer no longer exists", async () => {
    const offer = makeOffer();
    const dispatchRide = jest.fn();

    const result = await sweepExpiredOffers({
      findExpiredOffers: async () => [offer],
      claimExpiredOffer: async () => ({ ...offer, status: "expired" }),
      getRide: async () => null,
      markRideRedispatching: jest.fn(),
      markRideMaxAttemptsReached: jest.fn(),
      dispatchRide,
      maxAttempts: 5,
      ...silentLoggers()
    });

    expect(result.skipped).toEqual([offer.id]);
    expect(dispatchRide).not.toHaveBeenCalled();
  });

  it("records a failure (not a thrown exception) if dispatchRide() itself throws", async () => {
    const offer = makeOffer();
    const ride = makeRide();

    const result = await sweepExpiredOffers({
      findExpiredOffers: async () => [offer],
      claimExpiredOffer: async () => ({ ...offer, status: "expired" }),
      getRide: async () => ride,
      markRideRedispatching: jest.fn().mockResolvedValue(),
      markRideMaxAttemptsReached: jest.fn(),
      dispatchRide: async () => {
        throw new Error("transient Supabase error");
      },
      maxAttempts: 5,
      ...silentLoggers()
    });

    expect(result.failed).toEqual([offer.id]);
  });

  it("returns an empty result and does not throw if the initial query fails", async () => {
    const result = await sweepExpiredOffers({
      findExpiredOffers: async () => {
        throw new Error("db unreachable");
      },
      claimExpiredOffer: jest.fn(),
      getRide: jest.fn(),
      markRideRedispatching: jest.fn(),
      markRideMaxAttemptsReached: jest.fn(),
      dispatchRide: jest.fn(),
      maxAttempts: 5,
      ...silentLoggers()
    });

    expect(result).toEqual({ expired: [], redispatched: [], maxedOut: [], skipped: [], failed: [] });
  });

  it("processes multiple due offers independently in one sweep pass", async () => {
    const offerA = makeOffer({ id: "OFFER-A", ride_id: "RIDE-A" });
    const offerB = makeOffer({ id: "OFFER-B", ride_id: "RIDE-B" });
    const dispatchRide = jest.fn().mockResolvedValue({ dispatched: true });

    const result = await sweepExpiredOffers({
      findExpiredOffers: async () => [offerA, offerB],
      claimExpiredOffer: async (id) => ({ id, ride_id: id === "OFFER-A" ? "RIDE-A" : "RIDE-B", status: "expired" }),
      getRide: async (rideId) => makeRide({ id: rideId, dispatch_attempts: 0 }),
      markRideRedispatching: jest.fn().mockResolvedValue(),
      markRideMaxAttemptsReached: jest.fn(),
      dispatchRide,
      maxAttempts: 5,
      ...silentLoggers()
    });

    expect(result.redispatched.sort()).toEqual(["RIDE-A", "RIDE-B"]);
    expect(dispatchRide).toHaveBeenCalledTimes(2);
  });
});

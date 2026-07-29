const {
  haversineMiles,
  resolveEtaEstimate,
  computeAndPersistEta,
  pruneStaleCacheEntries
} = require("./etaEstimation");

// Chicago-ish coordinates, ~0.5 miles apart along a straight line.
const FROM = { lat: 41.8781, lng: -87.6298 };
const TO = { lat: 41.8831, lng: -87.6298 };

function silentLoggers() {
  return { log: () => {}, logError: () => {} };
}

function baseArgs(overrides = {}) {
  return {
    fromLat: FROM.lat,
    fromLng: FROM.lng,
    toLat: TO.lat,
    toLng: TO.lng,
    speedMph: 22,
    ...silentLoggers(),
    ...overrides
  };
}

describe("computeAndPersistEta — persistence flag off", () => {
  it("does not compute or persist anything", async () => {
    const persistEta = jest.fn();

    const result = await computeAndPersistEta({
      persistenceEnabled: false,
      persistEta,
      ...baseArgs()
    });

    expect(result).toBeNull();
    expect(persistEta).not.toHaveBeenCalled();
  });
});

describe("computeAndPersistEta — initial ETA persistence (offer creation)", () => {
  it("computes a Haversine estimate and persists it when the flag is on and the routing flag is off", async () => {
    const persistEta = jest.fn().mockResolvedValue();

    const result = await computeAndPersistEta({
      persistenceEnabled: true,
      routeApiEnabled: false,
      persistEta,
      ...baseArgs()
    });

    expect(result.source).toBe("haversine");
    expect(result.distanceMiles).toBeCloseTo(haversineMiles(FROM.lat, FROM.lng, TO.lat, TO.lng), 1);
    expect(result.etaMinutes).toBeGreaterThan(0);
    expect(persistEta).toHaveBeenCalledWith(result);
  });
});

describe("computeAndPersistEta — location-update refresh", () => {
  it("recomputes a fresh estimate reflecting the driver's new position", async () => {
    const persistEta = jest.fn().mockResolvedValue();

    const first = await computeAndPersistEta({
      persistenceEnabled: true,
      persistEta,
      ...baseArgs({ fromLat: FROM.lat, fromLng: FROM.lng })
    });

    // Driver has moved much closer to the target since the last ping.
    const closerLat = FROM.lat + (TO.lat - FROM.lat) * 0.9;
    const second = await computeAndPersistEta({
      persistenceEnabled: true,
      persistEta,
      ...baseArgs({ fromLat: closerLat, fromLng: FROM.lng })
    });

    expect(second.distanceMiles).toBeLessThan(first.distanceMiles);
    expect(persistEta).toHaveBeenCalledTimes(2);
  });
});

describe("resolveEtaEstimate — movement-threshold cache", () => {
  it("skips the routing API call when the driver has barely moved, and decays the cached ETA instead", async () => {
    let cache = null;
    const getCachedRoute = () => cache;
    const setCachedRoute = (entry) => {
      cache = entry;
    };
    const callRouteApi = jest.fn().mockResolvedValue({ distanceMiles: 0.5, etaMinutes: 4 });
    const incrementUsageCounter = jest.fn().mockResolvedValue(1);

    let currentTime = new Date("2026-07-29T00:00:00.000Z");
    const now = () => currentTime;

    const first = await resolveEtaEstimate({
      ...baseArgs(),
      routeApiEnabled: true,
      getCachedRoute,
      setCachedRoute,
      incrementUsageCounter,
      callRouteApi,
      now
    });

    expect(first.source).toBe("route_api");
    expect(callRouteApi).toHaveBeenCalledTimes(1);

    // One minute later, driver has moved a negligible amount (well under the
    // default ~0.03 mile / ~50m threshold).
    currentTime = new Date("2026-07-29T00:01:00.000Z");
    const second = await resolveEtaEstimate({
      ...baseArgs({ fromLat: FROM.lat + 0.0001, fromLng: FROM.lng }),
      routeApiEnabled: true,
      getCachedRoute,
      setCachedRoute,
      incrementUsageCounter,
      callRouteApi,
      now
    });

    expect(second.source).toBe("cache");
    expect(callRouteApi).toHaveBeenCalledTimes(1);
    expect(incrementUsageCounter).toHaveBeenCalledTimes(1);
    expect(second.etaMinutes).toBe(3); // 4 minutes cached, 1 minute elapsed
  });
});

describe("resolveEtaEstimate — routing API success", () => {
  it("uses the routing API's values and caches them when the driver has moved beyond the threshold", async () => {
    let cache = null;
    const callRouteApi = jest.fn().mockResolvedValue({ distanceMiles: 0.48, etaMinutes: 3 });

    const result = await resolveEtaEstimate({
      ...baseArgs(),
      routeApiEnabled: true,
      getCachedRoute: () => cache,
      setCachedRoute: (entry) => {
        cache = entry;
      },
      incrementUsageCounter: jest.fn().mockResolvedValue(1),
      callRouteApi
    });

    expect(result).toEqual({ distanceMiles: 0.48, etaMinutes: 3, source: "route_api" });
    expect(cache).not.toBeNull();
  });
});

describe("resolveEtaEstimate — routing API timeout/error", () => {
  it("falls back to Haversine if the routing API call times out", async () => {
    const callRouteApi = jest.fn(
      () => new Promise((resolve) => setTimeout(() => resolve({ distanceMiles: 1, etaMinutes: 5 }), 50))
    );

    const result = await resolveEtaEstimate({
      ...baseArgs(),
      routeApiEnabled: true,
      getCachedRoute: () => null,
      setCachedRoute: () => {},
      incrementUsageCounter: jest.fn().mockResolvedValue(1),
      callRouteApi,
      timeoutMs: 5
    });

    expect(result.source).toBe("haversine");
  });

  it("falls back to Haversine if the routing API call rejects", async () => {
    const callRouteApi = jest.fn().mockRejectedValue(new Error("upstream 500"));

    const result = await resolveEtaEstimate({
      ...baseArgs(),
      routeApiEnabled: true,
      getCachedRoute: () => null,
      setCachedRoute: () => {},
      incrementUsageCounter: jest.fn().mockResolvedValue(1),
      callRouteApi
    });

    expect(result.source).toBe("haversine");
  });

  it("falls back to Haversine if the routing API returns a malformed result", async () => {
    const callRouteApi = jest.fn().mockResolvedValue({ distanceMiles: null, etaMinutes: undefined });

    const result = await resolveEtaEstimate({
      ...baseArgs(),
      routeApiEnabled: true,
      getCachedRoute: () => null,
      setCachedRoute: () => {},
      incrementUsageCounter: jest.fn().mockResolvedValue(1),
      callRouteApi
    });

    expect(result.source).toBe("haversine");
  });
});

describe("resolveEtaEstimate — quota reached", () => {
  it("does not call the routing API once the usage counter exceeds the configured cap", async () => {
    const callRouteApi = jest.fn().mockResolvedValue({ distanceMiles: 1, etaMinutes: 5 });

    const result = await resolveEtaEstimate({
      ...baseArgs(),
      routeApiEnabled: true,
      getCachedRoute: () => null,
      setCachedRoute: () => {},
      incrementUsageCounter: jest.fn().mockResolvedValue(101),
      quotaLimit: 100,
      callRouteApi
    });

    expect(result.source).toBe("haversine");
    expect(callRouteApi).not.toHaveBeenCalled();
  });

  it("still allows the single call that crosses the cap through (check-after-increment)", async () => {
    const callRouteApi = jest.fn().mockResolvedValue({ distanceMiles: 1, etaMinutes: 5 });

    const result = await resolveEtaEstimate({
      ...baseArgs(),
      routeApiEnabled: true,
      getCachedRoute: () => null,
      setCachedRoute: () => {},
      incrementUsageCounter: jest.fn().mockResolvedValue(100),
      quotaLimit: 100,
      callRouteApi
    });

    expect(result.source).toBe("route_api");
    expect(callRouteApi).toHaveBeenCalledTimes(1);
  });

  it("fails closed (falls back, does not call the routing API) if the counter increment itself errors", async () => {
    const callRouteApi = jest.fn().mockResolvedValue({ distanceMiles: 1, etaMinutes: 5 });

    const result = await resolveEtaEstimate({
      ...baseArgs(),
      routeApiEnabled: true,
      getCachedRoute: () => null,
      setCachedRoute: () => {},
      incrementUsageCounter: jest.fn().mockRejectedValue(new Error("network blip")),
      quotaLimit: 100,
      callRouteApi
    });

    expect(result.source).toBe("haversine");
    expect(callRouteApi).not.toHaveBeenCalled();
  });
});

describe("computeAndPersistEta — database write failure", () => {
  it("does not throw if persisting the computed estimate fails, and still returns the estimate", async () => {
    const persistEta = jest.fn().mockRejectedValue(new Error("supabase unreachable"));

    const result = await computeAndPersistEta({
      persistenceEnabled: true,
      persistEta,
      ...baseArgs()
    });

    expect(result).not.toBeNull();
    expect(result.source).toBe("haversine");
    expect(persistEta).toHaveBeenCalledTimes(1);
  });
});

describe("resolveEtaEstimate — concurrent usage-counter increments", () => {
  it("gives each concurrent call its own incremented count and applies the quota independently to each", async () => {
    // Simulates the atomic INSERT ... ON CONFLICT DO UPDATE RPC: every call
    // is guaranteed a distinct, correctly-incremented count, with no lost
    // updates under concurrency.
    let sharedCounter = 99;
    const incrementUsageCounter = jest.fn(async () => {
      sharedCounter += 1;
      return sharedCounter;
    });
    const callRouteApi = jest.fn().mockResolvedValue({ distanceMiles: 1, etaMinutes: 5 });

    const [a, b, c] = await Promise.all([
      resolveEtaEstimate({
        ...baseArgs(),
        routeApiEnabled: true,
        getCachedRoute: () => null,
        setCachedRoute: () => {},
        incrementUsageCounter,
        quotaLimit: 100,
        callRouteApi
      }),
      resolveEtaEstimate({
        ...baseArgs(),
        routeApiEnabled: true,
        getCachedRoute: () => null,
        setCachedRoute: () => {},
        incrementUsageCounter,
        quotaLimit: 100,
        callRouteApi
      }),
      resolveEtaEstimate({
        ...baseArgs(),
        routeApiEnabled: true,
        getCachedRoute: () => null,
        setCachedRoute: () => {},
        incrementUsageCounter,
        quotaLimit: 100,
        callRouteApi
      })
    ]);

    expect(incrementUsageCounter).toHaveBeenCalledTimes(3);
    expect(sharedCounter).toBe(102); // no lost increments
    // Counts 100 and under go through; 101 and 102 are over the 100 cap.
    const sources = [a.source, b.source, c.source];
    expect(sources.filter((s) => s === "route_api")).toHaveLength(1);
    expect(sources.filter((s) => s === "haversine")).toHaveLength(2);
  });
});

describe("pruneStaleCacheEntries", () => {
  it("removes entries older than maxAgeMs and leaves fresh entries alone", () => {
    const cache = new Map([
      ["RIDE-OLD", { lat: 1, lng: 1, distanceMiles: 1, etaMinutes: 1, computedAt: "2026-07-28T23:00:00.000Z" }],
      ["RIDE-FRESH", { lat: 1, lng: 1, distanceMiles: 1, etaMinutes: 1, computedAt: "2026-07-29T00:58:00.000Z" }]
    ]);

    pruneStaleCacheEntries(cache, {
      maxAgeMs: 60 * 60 * 1000,
      now: () => new Date("2026-07-29T01:00:00.000Z")
    });

    expect(cache.has("RIDE-OLD")).toBe(false);
    expect(cache.has("RIDE-FRESH")).toBe(true);
  });
});

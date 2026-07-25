const {
  PILOT_STATUS,
  AVAILABILITY_RESULT,
  isTerminalPilotStatus,
  canTransitionPilotStatus,
  transitionPilotStatus,
  canCancelPilotStatus,
  canEnterHumanDispatch,
  hasValidPilotConsent,
  isWithinServiceHours,
  isWithinPilotZone,
  findMatchingPilotZone,
  evaluatePilotAvailability
} = require("./pilotLifecycle");

const NASHVILLE_ZONE = {
  id: "ZONE-DOWNTOWN",
  active: true,
  center_lat: 36.1627,
  center_lng: -86.7816,
  radius_miles: 5
};

describe("pilot_status transitions", () => {
  it("allows the documented happy-path sequence end to end", () => {
    const sequence = [
      PILOT_STATUS.REQUESTED,
      PILOT_STATUS.ELIGIBILITY_CHECK,
      PILOT_STATUS.VEHICLE_RESERVED,
      PILOT_STATUS.VEHICLE_ENROUTE,
      PILOT_STATUS.VEHICLE_ARRIVED,
      PILOT_STATUS.BOARDING_CONFIRMATION,
      PILOT_STATUS.TRIP_IN_PROGRESS,
      PILOT_STATUS.TRIP_COMPLETED
    ];

    for (let i = 0; i < sequence.length - 1; i++) {
      const result = transitionPilotStatus(sequence[i], sequence[i + 1]);
      expect(result.ok).toBe(true);
    }
  });

  it("allows the waitlist detour from eligibility_check", () => {
    expect(canTransitionPilotStatus(PILOT_STATUS.ELIGIBILITY_CHECK, PILOT_STATUS.WAITLISTED)).toBe(true);
    expect(canTransitionPilotStatus(PILOT_STATUS.WAITLISTED, PILOT_STATUS.VEHICLE_RESERVED)).toBe(true);
  });

  it("rejects skipping stages (e.g. requested straight to vehicle_reserved)", () => {
    const result = transitionPilotStatus(PILOT_STATUS.REQUESTED, PILOT_STATUS.VEHICLE_RESERVED);

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Cannot transition/);
  });

  it("rejects transitions out of a terminal status", () => {
    expect(canTransitionPilotStatus(PILOT_STATUS.TRIP_COMPLETED, PILOT_STATUS.CANCELLED)).toBe(false);
    expect(canTransitionPilotStatus(PILOT_STATUS.CANCELLED, PILOT_STATUS.REQUESTED)).toBe(false);
    expect(canTransitionPilotStatus(PILOT_STATUS.HUMAN_FALLBACK_OFFERED, PILOT_STATUS.WAITLISTED)).toBe(
      false
    );
  });

  it("treats re-applying the same status as an idempotent success (duplicate provider callback)", () => {
    const first = transitionPilotStatus(PILOT_STATUS.VEHICLE_ENROUTE, PILOT_STATUS.VEHICLE_ENROUTE);
    const second = transitionPilotStatus(PILOT_STATUS.VEHICLE_ENROUTE, PILOT_STATUS.VEHICLE_ENROUTE);

    expect(first).toEqual({ ok: true, status: PILOT_STATUS.VEHICLE_ENROUTE, idempotent: true });
    expect(second).toEqual(first);
  });

  it("rejects an unrecognized status value on either side", () => {
    expect(canTransitionPilotStatus("not_a_real_status", PILOT_STATUS.CANCELLED)).toBe(false);
    expect(canTransitionPilotStatus(PILOT_STATUS.REQUESTED, "not_a_real_status")).toBe(false);
  });

  it("marks trip_completed, human_fallback_offered, and cancelled as terminal", () => {
    expect(isTerminalPilotStatus(PILOT_STATUS.TRIP_COMPLETED)).toBe(true);
    expect(isTerminalPilotStatus(PILOT_STATUS.HUMAN_FALLBACK_OFFERED)).toBe(true);
    expect(isTerminalPilotStatus(PILOT_STATUS.CANCELLED)).toBe(true);
    expect(isTerminalPilotStatus(PILOT_STATUS.WAITLISTED)).toBe(false);
  });
});

describe("human fallback transition", () => {
  it("is reachable from every pre-boarding stage", () => {
    const preBoardingStages = [
      PILOT_STATUS.ELIGIBILITY_CHECK,
      PILOT_STATUS.WAITLISTED,
      PILOT_STATUS.VEHICLE_RESERVED,
      PILOT_STATUS.VEHICLE_ENROUTE,
      PILOT_STATUS.VEHICLE_ARRIVED,
      PILOT_STATUS.BOARDING_CONFIRMATION
    ];

    for (const stage of preBoardingStages) {
      expect(canTransitionPilotStatus(stage, PILOT_STATUS.HUMAN_FALLBACK_OFFERED)).toBe(true);
    }
  });

  it("is not offered once a trip is already in progress", () => {
    expect(canTransitionPilotStatus(PILOT_STATUS.TRIP_IN_PROGRESS, PILOT_STATUS.HUMAN_FALLBACK_OFFERED)).toBe(
      false
    );
  });
});

describe("cancellation at each valid stage", () => {
  it("allows cancellation from every pre-trip stage", () => {
    const cancellableStages = [
      PILOT_STATUS.REQUESTED,
      PILOT_STATUS.ELIGIBILITY_CHECK,
      PILOT_STATUS.WAITLISTED,
      PILOT_STATUS.VEHICLE_RESERVED,
      PILOT_STATUS.VEHICLE_ENROUTE,
      PILOT_STATUS.VEHICLE_ARRIVED,
      PILOT_STATUS.BOARDING_CONFIRMATION
    ];

    for (const stage of cancellableStages) {
      expect(canCancelPilotStatus(stage)).toBe(true);
    }
  });

  it("rejects cancellation once a trip is in progress or already terminal", () => {
    const nonCancellableStages = [
      PILOT_STATUS.TRIP_IN_PROGRESS,
      PILOT_STATUS.TRIP_COMPLETED,
      PILOT_STATUS.HUMAN_FALLBACK_OFFERED,
      PILOT_STATUS.CANCELLED
    ];

    for (const stage of nonCancellableStages) {
      expect(canCancelPilotStatus(stage)).toBe(false);
    }
  });
});

describe("canEnterHumanDispatch — no normal-driver dispatch before fallback", () => {
  it("blocks an autonomous_pilot ride from the human dispatch pool by default", () => {
    const ride = { autonomous_pilot: true, human_fallback_allowed: false };

    expect(canEnterHumanDispatch(ride)).toBe(false);
  });

  it("allows it through only once human_fallback_allowed has been explicitly set", () => {
    const ride = { autonomous_pilot: true, human_fallback_allowed: true };

    expect(canEnterHumanDispatch(ride)).toBe(true);
  });

  it("never affects a non-pilot ride", () => {
    expect(canEnterHumanDispatch({ autonomous_pilot: false })).toBe(true);
    expect(canEnterHumanDispatch({})).toBe(true);
    expect(canEnterHumanDispatch(null)).toBe(true);
  });
});

describe("consent required", () => {
  const CURRENT_VERSION = "2026-07-25.v1";

  it("rejects a ride with no consent timestamp at all", () => {
    expect(hasValidPilotConsent({ pilot_consent_at: null }, CURRENT_VERSION)).toBe(false);
  });

  it("rejects consent recorded against an older disclosure version", () => {
    const ride = { pilot_consent_at: "2026-01-01T00:00:00Z", pilot_disclosure_version: "2025-old" };

    expect(hasValidPilotConsent(ride, CURRENT_VERSION)).toBe(false);
  });

  it("accepts consent recorded against the current disclosure version", () => {
    const ride = {
      pilot_consent_at: "2026-07-25T12:00:00Z",
      pilot_disclosure_version: CURRENT_VERSION
    };

    expect(hasValidPilotConsent(ride, CURRENT_VERSION)).toBe(true);
  });

  it("rejects when no current disclosure version is known to compare against", () => {
    const ride = { pilot_consent_at: "2026-07-25T12:00:00Z", pilot_disclosure_version: "v1" };

    expect(hasValidPilotConsent(ride, "")).toBe(false);
  });
});

describe("pilot zone eligibility — inside vs outside", () => {
  it("is inside the zone when within the configured radius", () => {
    // ~1 mile from the zone center.
    const nearbyPoint = { lat: 36.1767, lng: -86.7816 };

    expect(isWithinPilotZone(NASHVILLE_ZONE, nearbyPoint)).toBe(true);
  });

  it("is outside the zone when beyond the configured radius", () => {
    // Memphis — well outside a 5-mile downtown Nashville zone.
    const farPoint = { lat: 35.1495, lng: -90.049 };

    expect(isWithinPilotZone(NASHVILLE_ZONE, farPoint)).toBe(false);
  });

  it("is outside an inactive zone even if the point is geographically inside it", () => {
    const inactiveZone = { ...NASHVILLE_ZONE, active: false };
    const nearbyPoint = { lat: 36.1767, lng: -86.7816 };

    expect(isWithinPilotZone(inactiveZone, nearbyPoint)).toBe(false);
  });

  it("never defaults to city-wide availability when no zones are configured", () => {
    expect(findMatchingPilotZone([], { lat: 36.1627, lng: -86.7816 }, { lat: 36.17, lng: -86.78 })).toBeNull();
    expect(
      findMatchingPilotZone(undefined, { lat: 36.1627, lng: -86.7816 }, { lat: 36.17, lng: -86.78 })
    ).toBeNull();
  });

  it("requires both pickup and destination to fall inside the same zone", () => {
    const pickupInside = { lat: 36.1767, lng: -86.7816 };
    const destinationOutside = { lat: 35.1495, lng: -90.049 };

    expect(findMatchingPilotZone([NASHVILLE_ZONE], pickupInside, destinationOutside)).toBeNull();
    expect(findMatchingPilotZone([NASHVILLE_ZONE], pickupInside, pickupInside)).toEqual(NASHVILLE_ZONE);
  });

  it("rejects a point with missing/invalid coordinates rather than throwing", () => {
    expect(isWithinPilotZone(NASHVILLE_ZONE, { lat: null, lng: undefined })).toBe(false);
    expect(isWithinPilotZone(NASHVILLE_ZONE, null)).toBe(false);
  });

  it("honors a polygon constraint in addition to the radius when one is configured", () => {
    // A small triangle that does NOT contain the nearby point used above,
    // even though that point is well within the circle's radius.
    const zoneWithPolygon = {
      ...NASHVILLE_ZONE,
      polygon: [
        [-86.79, 36.1], // [lng, lat]
        [-86.78, 36.1],
        [-86.785, 36.11]
      ]
    };
    const pointOutsidePolygonButInsideRadius = { lat: 36.1767, lng: -86.7816 };

    expect(isWithinPilotZone(zoneWithPolygon, pointOutsidePolygonButInsideRadius)).toBe(false);
  });
});

describe("pilot zone service hours", () => {
  it("treats a zone with no service_hours as always open", () => {
    expect(isWithinServiceHours(null, new Date("2026-07-25T03:00:00"))).toBe(true);
  });

  it("is open during a configured window", () => {
    const hours = { sat: [["08:00", "20:00"]] };
    // 2026-07-25 is a Saturday.
    const duringWindow = new Date("2026-07-25T12:00:00");

    expect(isWithinServiceHours(hours, duringWindow)).toBe(true);
  });

  it("is closed outside a configured window", () => {
    const hours = { sat: [["08:00", "20:00"]] };
    const afterWindow = new Date("2026-07-25T23:00:00");

    expect(isWithinServiceHours(hours, afterWindow)).toBe(false);
  });

  it("is closed on a day with no configured window at all", () => {
    const hours = { sat: [["08:00", "20:00"]] };
    // 2026-07-26 is a Sunday, not present in `hours`.
    const sunday = new Date("2026-07-26T12:00:00");

    expect(isWithinServiceHours(hours, sunday)).toBe(false);
  });
});

describe("evaluatePilotAvailability — honest availability results", () => {
  it("reports pilot_paused when the feature flag is disabled, even inside a zone with a vehicle", () => {
    const result = evaluatePilotAvailability({
      pilotEnabled: false,
      matchedZone: NASHVILLE_ZONE,
      providerAvailability: { available: true }
    });

    expect(result.result).toBe(AVAILABILITY_RESULT.PILOT_PAUSED);
  });

  it("reports outside_zone when enabled but no zone matched", () => {
    const result = evaluatePilotAvailability({
      pilotEnabled: true,
      matchedZone: null,
      providerAvailability: { available: true }
    });

    expect(result.result).toBe(AVAILABILITY_RESULT.OUTSIDE_ZONE);
  });

  it("reports vehicle_available only when the provider actually says so", () => {
    const result = evaluatePilotAvailability({
      pilotEnabled: true,
      matchedZone: NASHVILLE_ZONE,
      providerAvailability: { available: true }
    });

    expect(result.result).toBe(AVAILABILITY_RESULT.VEHICLE_AVAILABLE);
  });

  it("reports human_fallback_offered when the provider signals it", () => {
    const result = evaluatePilotAvailability({
      pilotEnabled: true,
      matchedZone: NASHVILLE_ZONE,
      providerAvailability: { available: false, humanFallbackOffered: true }
    });

    expect(result.result).toBe(AVAILABILITY_RESULT.HUMAN_FALLBACK_OFFERED);
  });

  it("defaults to waitlisted — the honest manual_operations result — when nothing else applies", () => {
    const result = evaluatePilotAvailability({
      pilotEnabled: true,
      matchedZone: NASHVILLE_ZONE,
      providerAvailability: { available: false, simulated: true }
    });

    expect(result.result).toBe(AVAILABILITY_RESULT.WAITLISTED);
  });
});

const {
  LEGACY_RIDER_REQUEST_ROUTES,
  buildLegacyRedirectTarget
} = require("./riderRequestRedirects");

describe("LEGACY_RIDER_REQUEST_ROUTES", () => {
  it("covers every retired path, with and without .html", () => {
    const paths = LEGACY_RIDER_REQUEST_ROUTES.map((r) => r.path);

    expect(paths).toEqual(
      expect.arrayContaining([
        "/request-ride",
        "/request-ride.html",
        "/request-food",
        "/request-food.html",
        "/request-groceries",
        "/request-groceries.html"
      ])
    );
    expect(paths).toHaveLength(6);
  });
});

describe("buildLegacyRedirectTarget", () => {
  it("forwards to the bare dashboard when there is no query string and no forced mode", () => {
    expect(buildLegacyRedirectTarget(null, {})).toBe("/rider-dashboard.html");
  });

  it("preserves an existing mode when no mode override is given (request-ride behavior)", () => {
    expect(buildLegacyRedirectTarget(null, { mode: "driver" })).toBe(
      "/rider-dashboard.html?mode=driver"
    );
  });

  it("preserves ride_id, ride_type, and ai_destination query params unchanged", () => {
    const target = buildLegacyRedirectTarget(null, {
      mode: "driver",
      ride_id: "RIDE-123",
      ride_type: "scheduled",
      ai_destination: "123 Main St"
    });

    const url = new URL(target, "https://example.test");
    expect(url.pathname).toBe("/rider-dashboard.html");
    expect(url.searchParams.get("mode")).toBe("driver");
    expect(url.searchParams.get("ride_id")).toBe("RIDE-123");
    expect(url.searchParams.get("ride_type")).toBe("scheduled");
    expect(url.searchParams.get("ai_destination")).toBe("123 Main St");
  });

  it("forces mode=food regardless of any mode already present in the query (request-food behavior)", () => {
    expect(buildLegacyRedirectTarget("food", {})).toBe(
      "/rider-dashboard.html?mode=food"
    );
    expect(buildLegacyRedirectTarget("food", { mode: "driver" })).toBe(
      "/rider-dashboard.html?mode=food"
    );
  });

  it("forces mode=grocery regardless of any mode already present in the query (request-groceries behavior)", () => {
    expect(buildLegacyRedirectTarget("grocery", {})).toBe(
      "/rider-dashboard.html?mode=grocery"
    );
    expect(buildLegacyRedirectTarget("grocery", { mode: "driver" })).toBe(
      "/rider-dashboard.html?mode=grocery"
    );
  });

  it("handles a missing/undefined query object", () => {
    expect(buildLegacyRedirectTarget(null, undefined)).toBe("/rider-dashboard.html");
  });
});

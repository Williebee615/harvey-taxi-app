const { createMapboxClient, ERROR } = require("./mapboxClient");
const { createFakeMapbox, TEST_TOKEN } = require("../test/fixtures/fakeMapbox");

describe("mapboxClient", () => {
  const fake = createFakeMapbox();
  const client = createMapboxClient({ token: TEST_TOKEN, fetchImpl: fake.fetchImpl, timeoutMs: 200 });
  beforeEach(() => fake.reset());

  const noToken = (value) => expect(JSON.stringify(value)).not.toContain(TEST_TOKEN);

  it("suggest: temporary US address search near Nashville; returns labels and coordinates only", async () => {
    const out = await client.suggest("501 Broadway");
    expect(out).toEqual({
      ok: true,
      results: [{ label: "501 Broadway, Nashville, Tennessee 37203, United States", lat: 36.1612, lng: -86.7775 }]
    });
    const call = fake.calls[0];
    expect(call.path).toBe("/search/geocode/v6/forward");
    expect(call.tokenOk).toBe(true);
    expect(call.params).toMatchObject({ q: "501 Broadway", autocomplete: "true", country: "us", proximity: "-86.7816,36.1627" });
    expect(call.params.permanent).toBeUndefined();
    noToken(out);
  });

  it("resolve and reverse request permanent results (they may be stored)", async () => {
    const resolved = await client.resolve("1 Terminal Dr");
    expect(resolved.ok).toBe(true);
    expect(resolved.place.lat).toBeCloseTo(36.1263);
    expect(fake.calls[0].params).toMatchObject({ permanent: "true", autocomplete: "false", limit: "1" });

    const reversed = await client.reverse(36.16, -86.77);
    expect(reversed.ok).toBe(true);
    expect(fake.calls[1].path).toBe("/search/geocode/v6/reverse");
    expect(fake.calls[1].params).toMatchObject({ permanent: "true", latitude: "36.16", longitude: "-86.77" });
  });

  it("resolve: unknown address is not_found (an address problem, not an outage)", async () => {
    expect(await client.resolve("zzzz nowhere")).toEqual({ ok: false, error: ERROR.NOT_FOUND });
  });

  it("route: driving miles and minutes from meters and seconds", async () => {
    const out = await client.route({ lat: 36.1612, lng: -86.7775 }, { lat: 36.1263, lng: -86.6774 });
    expect(out).toEqual({ ok: true, distance_miles: 5.2, duration_minutes: 14 });
    expect(fake.calls[0].path).toBe("/directions/v5/mapbox/driving/-86.7775,36.1612;-86.6774,36.1263");
  });

  it("route: NoRoute is no_route", async () => {
    fake.setMode("no_route");
    expect(await client.route({ lat: 1, lng: 1 }, { lat: 2, lng: 2 })).toEqual({ ok: false, error: ERROR.NO_ROUTE });
  });

  it("provider errors carry only a category and status, never the token or body", async () => {
    for (const [mode, expected] of [
      ["http_401", { ok: false, error: ERROR.PROVIDER, status: 401 }],
      ["http_500", { ok: false, error: ERROR.PROVIDER, status: 500 }],
      ["network", { ok: false, error: ERROR.PROVIDER, status: 0 }],
      ["timeout", { ok: false, error: ERROR.TIMEOUT, status: 0 }]
    ]) {
      fake.setMode(mode);
      const out = await client.suggest("501 Broadway");
      expect(out).toEqual(expected);
      noToken(out);
    }
  });

  it("missing token: not_configured, and no request is made", async () => {
    const unconfigured = createMapboxClient({ token: "", fetchImpl: fake.fetchImpl });
    expect(await unconfigured.resolve("501 Broadway")).toEqual({ ok: false, error: ERROR.NOT_CONFIGURED });
    expect(await unconfigured.route({ lat: 1, lng: 1 }, { lat: 2, lng: 2 })).toEqual({ ok: false, error: ERROR.NOT_CONFIGURED });
    expect(fake.calls).toHaveLength(0);
  });
});

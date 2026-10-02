const { GEO_TOKEN_ENV, readGeoToken, describeGeoConfig, geoConfigLogLines } = require("./geoConfig");

// Fixture only; not a real token.
const FAKE = "pk.fixture-geo-config-token";

describe("readGeoToken / describeGeoConfig", () => {
  it("reads exactly MAPBOX_ACCESS_TOKEN, trimmed", () => {
    expect(GEO_TOKEN_ENV).toBe("MAPBOX_ACCESS_TOKEN");
    expect(readGeoToken({ MAPBOX_ACCESS_TOKEN: `  ${FAKE}\n` })).toBe(FAKE);
    expect(describeGeoConfig({ MAPBOX_ACCESS_TOKEN: FAKE })).toEqual({ configured: true, problems: [], lookalikes: [] });
  });

  it("treats missing, empty and whitespace-only values as missing", () => {
    for (const value of [undefined, null, "", "   ", "\n"]) {
      expect(readGeoToken({ MAPBOX_ACCESS_TOKEN: value })).toBe("");
      expect(describeGeoConfig({ MAPBOX_ACCESS_TOKEN: value }).configured).toBe(false);
    }
  });

  it("names look-alike variables without reading them", () => {
    const d = describeGeoConfig({ MAPBOX_TOKEN: FAKE });
    expect(d.configured).toBe(false);
    expect(d.lookalikes).toEqual(["MAPBOX_TOKEN"]);
    expect(readGeoToken({ MAPBOX_TOKEN: FAKE })).toBe("");
  });

  it("flags a value pasted with quotes or spaces", () => {
    expect(describeGeoConfig({ MAPBOX_ACCESS_TOKEN: `"${FAKE}"` }).problems).toContain("value is wrapped in quotes");
    expect(describeGeoConfig({ MAPBOX_ACCESS_TOKEN: "pk.a b" }).problems).toContain("value contains spaces");
  });
});

describe("geoConfigLogLines", () => {
  it("never includes the token, whatever the configuration", () => {
    for (const env of [{ MAPBOX_ACCESS_TOKEN: FAKE }, { MAPBOX_ACCESS_TOKEN: `'${FAKE}'` }, {}, { MAPBOX_TOKEN: FAKE }]) {
      expect(geoConfigLogLines(describeGeoConfig(env)).lines.join("\n")).not.toContain(FAKE);
    }
  });

  it("confirms when configured and warns when missing", () => {
    expect(geoConfigLogLines(describeGeoConfig({ MAPBOX_ACCESS_TOKEN: FAKE }))).toEqual({
      level: "log",
      lines: ["✅ Mapbox address search and routing configured (MAPBOX_ACCESS_TOKEN)"]
    });
    const missing = geoConfigLogLines(describeGeoConfig({ MAPBOX_TOKEN: FAKE }));
    expect(missing.level).toBe("warn");
    expect(missing.lines[0]).toMatch(/MAPBOX_ACCESS_TOKEN is not set/);
    expect(missing.lines[1]).toMatch(/Found MAPBOX_TOKEN instead/);
  });
});

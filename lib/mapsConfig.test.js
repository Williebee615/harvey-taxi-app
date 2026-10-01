const {
  MAPS_KEY_ENV,
  describeMapsConfig,
  mapsConfigLogLines,
  mapsKeyResponse
} = require("./mapsConfig");

// Fixture only; not a real key.
const FAKE_KEY = "fixture-browser-key-123";

describe("describeMapsConfig", () => {
  it("reads exactly GOOGLE_MAPS_BROWSER_KEY", () => {
    expect(MAPS_KEY_ENV).toBe("GOOGLE_MAPS_BROWSER_KEY");
    expect(describeMapsConfig({ GOOGLE_MAPS_BROWSER_KEY: FAKE_KEY })).toEqual({ configured: true, problems: [], lookalikes: [] });
  });

  it("treats missing, empty and whitespace-only values as not configured", () => {
    for (const value of [undefined, null, "", "   "]) {
      expect(describeMapsConfig({ GOOGLE_MAPS_BROWSER_KEY: value }).configured).toBe(false);
    }
  });

  it("names look-alike variables without using them", () => {
    const d = describeMapsConfig({ GOOGLE_MAPS_API_KEY: FAKE_KEY, MAPS_API_KEY: FAKE_KEY });
    expect(d.configured).toBe(false);
    expect(d.lookalikes).toEqual(["GOOGLE_MAPS_API_KEY", "MAPS_API_KEY"]);
  });

  it("flags values pasted with quotes or spaces", () => {
    expect(describeMapsConfig({ GOOGLE_MAPS_BROWSER_KEY: `"${FAKE_KEY}"` }).problems).toContain("value is wrapped in quotes");
    expect(describeMapsConfig({ GOOGLE_MAPS_BROWSER_KEY: "abc def" }).problems).toContain("value contains spaces");
  });
});

describe("mapsConfigLogLines", () => {
  const cases = [
    { GOOGLE_MAPS_BROWSER_KEY: FAKE_KEY },
    { GOOGLE_MAPS_BROWSER_KEY: `'${FAKE_KEY}'` },
    {},
    { GOOGLE_MAPS_API_KEY: FAKE_KEY }
  ];

  it("never includes a key value", () => {
    for (const envObj of cases) {
      const { lines } = mapsConfigLogLines(describeMapsConfig(envObj));
      expect(lines.join("\n")).not.toContain(FAKE_KEY);
    }
  });

  it("warns when missing and points at the right variable name", () => {
    const { level, lines } = mapsConfigLogLines(describeMapsConfig({ GOOGLE_MAPS_API_KEY: FAKE_KEY }));
    expect(level).toBe("warn");
    expect(lines[0]).toMatch(/GOOGLE_MAPS_BROWSER_KEY is not set/);
    expect(lines[1]).toMatch(/Found GOOGLE_MAPS_API_KEY instead/);
  });

  it("logs a plain confirmation when configured", () => {
    const { level, lines } = mapsConfigLogLines(describeMapsConfig({ GOOGLE_MAPS_BROWSER_KEY: FAKE_KEY }));
    expect(level).toBe("log");
    expect(lines).toEqual(["✅ Google Maps browser key configured (GOOGLE_MAPS_BROWSER_KEY)"]);
  });
});

describe("mapsKeyResponse", () => {
  it("returns the key when configured", () => {
    expect(mapsKeyResponse(FAKE_KEY)).toEqual({ status: 200, body: { key: FAKE_KEY } });
  });

  it("returns a 503 configuration error when missing", () => {
    for (const value of [undefined, "", "  "]) {
      const out = mapsKeyResponse(value);
      expect(out.status).toBe(503);
      expect(out.body.code).toBe("maps_not_configured");
      expect(out.body).not.toHaveProperty("key");
    }
  });
});

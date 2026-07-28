const { isAllowedOrigin, buildDefaultAllowedOrigins } = require("./corsOrigins");

// Mirrors this platform's real production config: a taxi app domain and
// a separate HTAF foundation domain sharing the same backend, per
// FOUNDATION_HOSTS in server.js.
const BASE_CONFIG = {
  isProduction: true,
  configuredOrigins: [],
  appBaseUrl: "https://harveytaxiservice.com",
  canonicalHost: "harveytaxiservice.com",
  foundationHost: "harveytransportationfoundation.com"
};

describe("isAllowedOrigin — non-production and no-origin requests", () => {
  it("allows requests with no Origin header (server-to-server, curl, same-tab navigation)", () => {
    expect(isAllowedOrigin(undefined, BASE_CONFIG)).toBe(true);
    expect(isAllowedOrigin("", BASE_CONFIG)).toBe(true);
  });

  it("allows any origin outside production", () => {
    expect(isAllowedOrigin("https://evil.example.com", { ...BASE_CONFIG, isProduction: false })).toBe(true);
  });
});

describe("isAllowedOrigin — production, no ALLOWED_ORIGINS configured (the bug this fixes)", () => {
  it("allows the canonical taxi domain", () => {
    expect(isAllowedOrigin("https://harveytaxiservice.com", BASE_CONFIG)).toBe(true);
  });

  it("allows the canonical taxi domain's www variant", () => {
    expect(isAllowedOrigin("https://www.harveytaxiservice.com", BASE_CONFIG)).toBe(true);
  });

  it("allows the HTAF foundation domain — this is the request that used to be rejected with a bare exact-match check", () => {
    expect(isAllowedOrigin("https://harveytransportationfoundation.com", BASE_CONFIG)).toBe(true);
  });

  it("allows the foundation domain's www variant", () => {
    expect(isAllowedOrigin("https://www.harveytransportationfoundation.com", BASE_CONFIG)).toBe(true);
  });

  it("allows APP_BASE_URL even if it differs from both known hosts (e.g. Render's own external URL)", () => {
    const config = { ...BASE_CONFIG, appBaseUrl: "https://harvey-taxi-app-abcd.onrender.com" };
    expect(isAllowedOrigin("https://harvey-taxi-app-abcd.onrender.com", config)).toBe(true);
    // The real public domains must still work even when APP_BASE_URL
    // points somewhere else, which was the exact failure mode: a
    // signup submitted from harveytaxiservice.com was rejected because
    // APP_BASE_URL had fallen back to the Render-assigned URL.
    expect(isAllowedOrigin("https://harveytaxiservice.com", config)).toBe(true);
  });

  it("still rejects an unrelated origin", () => {
    expect(isAllowedOrigin("https://not-harvey-taxi.example.com", BASE_CONFIG)).toBe(false);
  });
});

describe("isAllowedOrigin — production, ALLOWED_ORIGINS explicitly configured", () => {
  it("uses only the configured list, ignoring the default known hosts", () => {
    const config = { ...BASE_CONFIG, configuredOrigins: ["https://staging.harveytaxiservice.com"] };
    expect(isAllowedOrigin("https://staging.harveytaxiservice.com", config)).toBe(true);
    expect(isAllowedOrigin("https://harveytaxiservice.com", config)).toBe(false);
  });
});

describe("buildDefaultAllowedOrigins", () => {
  it("includes every known host and its www variant plus the app base URL", () => {
    const set = buildDefaultAllowedOrigins({
      appBaseUrl: "https://harveytaxiservice.com",
      canonicalHost: "harveytaxiservice.com",
      foundationHost: "harveytransportationfoundation.com"
    });
    expect(set.has("https://harveytaxiservice.com")).toBe(true);
    expect(set.has("https://www.harveytaxiservice.com")).toBe(true);
    expect(set.has("https://harveytransportationfoundation.com")).toBe(true);
    expect(set.has("https://www.harveytransportationfoundation.com")).toBe(true);
  });

  it("tolerates a missing foundation/canonical host without throwing", () => {
    expect(() => buildDefaultAllowedOrigins({ appBaseUrl: "https://x.com" })).not.toThrow();
  });
});

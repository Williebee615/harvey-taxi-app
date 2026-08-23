const {
  isAllowedOrigin,
  buildDefaultAllowedOrigins,
  parseOriginForDiagnostics,
  buildCorsRejectionError
} = require("./corsOrigins");

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

// Sanitized CORS-rejection diagnostics: a rejected Origin was previously
// invisible everywhere (not in audit_logs, not in any log line), which
// made a real allow-list gap indistinguishable from an unrelated
// same-origin failure during a live incident. These record only a
// classified scheme/hostname pair -- never the raw Origin, and never
// its userinfo/port/path/query/fragment even when present.
describe("parseOriginForDiagnostics", () => {
  it("returns nulls for a missing Origin header", () => {
    expect(parseOriginForDiagnostics(undefined)).toEqual({ origin_scheme: null, origin_hostname: null });
    expect(parseOriginForDiagnostics("")).toEqual({ origin_scheme: null, origin_hostname: null });
  });

  it("classifies the literal null-style Origin distinctly from a missing one", () => {
    expect(parseOriginForDiagnostics("null")).toEqual({ origin_scheme: "null", origin_hostname: null });
  });

  it("extracts scheme and hostname from a valid HTTPS origin", () => {
    expect(parseOriginForDiagnostics("https://harveytaxiservice.com")).toEqual({
      origin_scheme: "https",
      origin_hostname: "harveytaxiservice.com"
    });
  });

  it("extracts scheme and hostname from a valid HTTP origin", () => {
    expect(parseOriginForDiagnostics("http://example.com")).toEqual({
      origin_scheme: "http",
      origin_hostname: "example.com"
    });
  });

  it("discards username, password, port, path, query, and fragment", () => {
    const result = parseOriginForDiagnostics(
      "https://attacker:s3cr3t@evil.example.com:8443/some/path?token=abc123#fragment"
    );
    expect(result).toEqual({ origin_scheme: "https", origin_hostname: "evil.example.com" });
  });

  it("handles a Capacitor/custom-scheme origin without throwing", () => {
    expect(parseOriginForDiagnostics("capacitor://localhost")).toEqual({
      origin_scheme: "capacitor",
      origin_hostname: "localhost"
    });
  });

  it("handles a file:// origin without throwing", () => {
    expect(parseOriginForDiagnostics("file://")).toEqual({
      origin_scheme: "file",
      origin_hostname: null
    });
  });

  it("handles an internationalized hostname without throwing", () => {
    const result = parseOriginForDiagnostics("https://münchen.example");
    expect(result.origin_scheme).toBe("https");
    expect(typeof result.origin_hostname).toBe("string");
    expect(result.origin_hostname.length).toBeGreaterThan(0);
  });

  it("classifies a malformed/unparseable value without throwing", () => {
    expect(parseOriginForDiagnostics("not-a-url-at-all")).toEqual({
      origin_scheme: "unparseable",
      origin_hostname: null
    });
  });

  it("never returns any field beyond origin_scheme and origin_hostname", () => {
    const result = parseOriginForDiagnostics("https://user:pass@evil.example.com/path?q=1#f");
    expect(Object.keys(result).sort()).toEqual(["origin_hostname", "origin_scheme"]);
  });
});

describe("buildCorsRejectionError", () => {
  it("preserves the existing rejection error message exactly (behavior-preserving)", () => {
    const error = buildCorsRejectionError("https://evil.example.com", { buildSha: "abc123" });
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe("CORS origin blocked");
  });

  it("attaches only the four sanitized diagnostic fields, never the raw origin", () => {
    const error = buildCorsRejectionError(
      "https://user:pass@evil.example.com:9999/x?y=1#z",
      { buildSha: "sha123" }
    );

    expect(error.corsDiagnostics).toEqual({
      origin_scheme: "https",
      origin_hostname: "evil.example.com",
      rejection_reason: "origin_not_in_allowlist",
      build_sha: "sha123"
    });

    const serialized = JSON.stringify(error.corsDiagnostics);
    expect(serialized).not.toContain("user:pass");
    expect(serialized).not.toContain("9999");
    expect(serialized).not.toContain("/x?y=1#z");
  });

  it("defaults build_sha to null when not provided", () => {
    const error = buildCorsRejectionError("https://evil.example.com");
    expect(error.corsDiagnostics.build_sha).toBeNull();
  });

  it("classifies malformed or missing origins safely when building the rejection error", () => {
    const error = buildCorsRejectionError(undefined, { buildSha: null });
    expect(error.corsDiagnostics).toEqual({
      origin_scheme: null,
      origin_hostname: null,
      rejection_reason: "origin_not_in_allowlist",
      build_sha: null
    });
  });
});

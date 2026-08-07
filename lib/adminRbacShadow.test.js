const {
  ROUTE_CAPABILITIES,
  RESOLUTION_SOURCE,
  resolveShadowRole,
  computeWouldAllow,
  buildShadowLogEntry
} = require("./adminRbacShadow");
const { ADMIN_CAPABILITIES, hasCapability } = require("./adminRbac");

describe("ROUTE_CAPABILITIES (Phase 2 representative starting mix)", () => {
  test("covers exactly the six representative areas requested: HTAF read+write, ride dispatch, driver approval, compliance override, audit read, a system flag", () => {
    expect(Object.keys(ROUTE_CAPABILITIES).sort()).toEqual(
      [
        "GET /api/admin/foundation/applications",
        "PATCH /api/admin/foundation/applications/:id",
        "POST /api/admin/rides/:id/assign-driver",
        "PATCH /api/admin/drivers/:id/approve",
        "PATCH /api/admin/drivers/:id/compliance-override",
        "GET /api/admin/audit-logs",
        "POST /api/admin/system/enable-rider-auth-ui"
      ].sort()
    );
  });

  test("every mapped capability is a real, recognized capability in lib/adminRbac.js", () => {
    for (const capability of Object.values(ROUTE_CAPABILITIES)) {
      expect(ADMIN_CAPABILITIES).toContain(capability);
    }
  });
});

describe("resolveShadowRole() -- the Phase-2-specific resolution path (not resolveAdminRole())", () => {
  test("a successful DB lookup that finds a row uses that row's role, regardless of who the admin is", () => {
    expect(
      resolveShadowRole({ dbLookupFailed: false, roleRow: { role: "dispatcher" }, isLegacyAdmin: false })
    ).toEqual({ role: "dispatcher", source: RESOLUTION_SOURCE.DB_ROW });

    // Even for the legacy admin, a real row wins over the fallback --
    // the fallback only exists for when the lookup itself couldn't
    // tell us anything, not to override an actual answer.
    expect(
      resolveShadowRole({ dbLookupFailed: false, roleRow: { role: "compliance" }, isLegacyAdmin: true })
    ).toEqual({ role: "compliance", source: RESOLUTION_SOURCE.DB_ROW });
  });

  test("a DB error falls back to super_admin ONLY for the legacy admin, and the source says so distinctly", () => {
    expect(
      resolveShadowRole({ dbLookupFailed: true, roleRow: null, isLegacyAdmin: true })
    ).toEqual({ role: "super_admin", source: RESOLUTION_SOURCE.DB_ERROR_LEGACY_FALLBACK });

    expect(
      resolveShadowRole({ dbLookupFailed: true, roleRow: null, isLegacyAdmin: false })
    ).toEqual({ role: null, source: RESOLUTION_SOURCE.DB_ERROR_NO_FALLBACK });
  });

  test("a missing row (lookup succeeded, zero results) falls back to super_admin ONLY for the legacy admin, with its own distinct source from the DB-error case", () => {
    expect(
      resolveShadowRole({ dbLookupFailed: false, roleRow: null, isLegacyAdmin: true })
    ).toEqual({ role: "super_admin", source: RESOLUTION_SOURCE.MISSING_ROW_LEGACY_FALLBACK });

    expect(
      resolveShadowRole({ dbLookupFailed: false, roleRow: undefined, isLegacyAdmin: false })
    ).toEqual({ role: null, source: RESOLUTION_SOURCE.MISSING_ROW_NO_FALLBACK });
  });

  test("a malformed row (no usable role string) is treated the same as a missing row, not as a crash or a silent allow", () => {
    expect(
      resolveShadowRole({ dbLookupFailed: false, roleRow: { role: "" }, isLegacyAdmin: false })
    ).toEqual({ role: null, source: RESOLUTION_SOURCE.MISSING_ROW_NO_FALLBACK });

    expect(
      resolveShadowRole({ dbLookupFailed: false, roleRow: { role: null }, isLegacyAdmin: true })
    ).toEqual({ role: "super_admin", source: RESOLUTION_SOURCE.MISSING_ROW_LEGACY_FALLBACK });

    expect(
      resolveShadowRole({ dbLookupFailed: false, roleRow: {}, isLegacyAdmin: false })
    ).toEqual({ role: null, source: RESOLUTION_SOURCE.MISSING_ROW_NO_FALLBACK });
  });

  test("DB-error and missing-row are always distinguishable from each other in the returned source, for both legacy and non-legacy admins", () => {
    const dbErrorLegacy = resolveShadowRole({ dbLookupFailed: true, roleRow: null, isLegacyAdmin: true });
    const missingRowLegacy = resolveShadowRole({ dbLookupFailed: false, roleRow: null, isLegacyAdmin: true });
    expect(dbErrorLegacy.source).not.toBe(missingRowLegacy.source);

    const dbErrorOther = resolveShadowRole({ dbLookupFailed: true, roleRow: null, isLegacyAdmin: false });
    const missingRowOther = resolveShadowRole({ dbLookupFailed: false, roleRow: null, isLegacyAdmin: false });
    expect(dbErrorOther.source).not.toBe(missingRowOther.source);
  });
});

describe("computeWouldAllow()", () => {
  test("delegates to hasCapability() for a resolved role", () => {
    expect(computeWouldAllow("dispatcher", "rides.dispatch")).toBe(hasCapability("dispatcher", "rides.dispatch"));
    expect(computeWouldAllow("dispatcher", "rides.dispatch")).toBe(true);
    expect(computeWouldAllow("dispatcher", "audit.read")).toBe(false);
  });

  test("a null role (the DB-error/missing-row-with-no-fallback cases) always denies, never throws", () => {
    expect(computeWouldAllow(null, "rides.dispatch")).toBe(false);
    expect(computeWouldAllow(undefined, "rides.dispatch")).toBe(false);
    expect(() => computeWouldAllow(null, "rides.dispatch")).not.toThrow();
  });

  test("an unrecognized capability denies even for super_admin, same as hasCapability()'s own guarantee", () => {
    expect(computeWouldAllow("super_admin", "not.a.real.capability")).toBe(false);
  });
});

describe("buildShadowLogEntry() -- metadata-only, explicit allow-list output", () => {
  test("produces exactly the allow-listed fields, nothing more, even when given extra/adversarial input", () => {
    const entry = buildShadowLogEntry({
      admin: {
        id: "token-admin",
        email: "admin@example.com",
        method: "admin_token",
        // adversarial extras that must never leak into the log row
        password: "MARKER_SECRET_PASSWORD",
        htafApplication: { first_name: "MARKER_NAME", income: "MARKER_INCOME" },
        requestBody: { anything: "MARKER_BODY_CONTENT" }
      },
      route: "PATCH /api/admin/drivers/:id/approve",
      httpMethod: "PATCH",
      capability: "drivers.approve",
      role: "dispatcher",
      source: "db_row",
      wouldAllow: true,
      at: "2026-08-07T20:00:00.000Z"
    });

    expect(entry).toEqual({
      actor_email: "admin@example.com",
      auth_method: "admin_token",
      route: "PATCH /api/admin/drivers/:id/approve",
      http_method: "PATCH",
      required_capability: "drivers.approve",
      resolved_role: "dispatcher",
      resolution_source: "db_row",
      would_allow: true,
      created_at: "2026-08-07T20:00:00.000Z"
    });

    const json = JSON.stringify(entry);
    expect(json).not.toContain("MARKER_SECRET_PASSWORD");
    expect(json).not.toContain("MARKER_NAME");
    expect(json).not.toContain("MARKER_INCOME");
    expect(json).not.toContain("MARKER_BODY_CONTENT");
  });

  test("a null role is recorded as null, not omitted or coerced to a truthy placeholder", () => {
    const entry = buildShadowLogEntry({
      admin: { id: "x", email: "a@example.com", method: "admin_session" },
      route: "GET /api/admin/audit-logs",
      httpMethod: "GET",
      capability: "audit.read",
      role: null,
      source: "db_error_no_fallback",
      wouldAllow: false
    });
    expect(entry.resolved_role).toBeNull();
    expect(entry.would_allow).toBe(false);
  });

  test("missing/malformed admin input degrades to nulls rather than throwing", () => {
    expect(() =>
      buildShadowLogEntry({
        admin: null,
        route: "GET /api/admin/audit-logs",
        httpMethod: "GET",
        capability: "audit.read",
        role: null,
        source: "missing_row_no_fallback",
        wouldAllow: false
      })
    ).not.toThrow();

    const entry = buildShadowLogEntry({
      admin: null,
      route: "GET /api/admin/audit-logs",
      httpMethod: "GET",
      capability: "audit.read",
      role: null,
      source: "missing_row_no_fallback",
      wouldAllow: false
    });
    expect(entry.actor_email).toBeNull();
    expect(entry.auth_method).toBeNull();
  });

  test("defaults created_at to the current time when not supplied, as an ISO string", () => {
    const before = Date.now();
    const entry = buildShadowLogEntry({
      admin: { email: "a@example.com", method: "admin_token" },
      route: "GET /api/admin/audit-logs",
      httpMethod: "GET",
      capability: "audit.read",
      role: "compliance",
      source: "db_row",
      wouldAllow: true
    });
    const after = Date.now();
    const parsed = new Date(entry.created_at).getTime();
    expect(parsed).toBeGreaterThanOrEqual(before);
    expect(parsed).toBeLessThanOrEqual(after);
  });
});

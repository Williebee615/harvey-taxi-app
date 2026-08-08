const {
  ADMIN_ROLES,
  ADMIN_CAPABILITIES,
  ROLE_CAPABILITIES,
  hasCapability,
  resolveAdminRole
} = require("./adminRbac");

describe("ADMIN_ROLES / ADMIN_CAPABILITIES (data integrity)", () => {
  test("exactly the six roles from the approved architecture, no duplicates", () => {
    expect([...ADMIN_ROLES].sort()).toEqual(
      ["super_admin", "htaf_caseworker", "dispatcher", "support", "finance", "compliance"].sort()
    );
    expect(new Set(ADMIN_ROLES).size).toBe(ADMIN_ROLES.length);
  });

  test("ADMIN_CAPABILITIES has no duplicates", () => {
    expect(new Set(ADMIN_CAPABILITIES).size).toBe(ADMIN_CAPABILITIES.length);
  });

  test("every role in ROLE_CAPABILITIES is one of ADMIN_ROLES, and every role has a grant list", () => {
    for (const role of ADMIN_ROLES) {
      expect(ROLE_CAPABILITIES[role]).toBeDefined();
      expect(Array.isArray(ROLE_CAPABILITIES[role])).toBe(true);
    }
    expect(Object.keys(ROLE_CAPABILITIES).sort()).toEqual([...ADMIN_ROLES].sort());
  });

  test("every capability granted to any role is a real, recognized capability -- no grant-list typos", () => {
    for (const role of ADMIN_ROLES) {
      for (const capability of ROLE_CAPABILITIES[role]) {
        expect(ADMIN_CAPABILITIES).toContain(capability);
      }
    }
  });

  test("no role's grant list contains a duplicate capability", () => {
    for (const role of ADMIN_ROLES) {
      const grants = ROLE_CAPABILITIES[role];
      expect(new Set(grants).size).toBe(grants.length);
    }
  });
});

describe("super_admin is granted every capability, not a hand-maintained subset", () => {
  test("super_admin's grant list is exactly ADMIN_CAPABILITIES", () => {
    expect([...ROLE_CAPABILITIES.super_admin].sort()).toEqual([...ADMIN_CAPABILITIES].sort());
  });

  test("super_admin passes hasCapability() for every known capability", () => {
    for (const capability of ADMIN_CAPABILITIES) {
      expect(hasCapability("super_admin", capability)).toBe(true);
    }
  });
});

describe("hasCapability() -- exact grant map per role (regression coverage against the approved architecture)", () => {
  test("htaf_caseworker: HTAF actions only, nothing else", () => {
    const granted = [
      "htaf.applications.read",
      "htaf.applications.read_detail",
      "htaf.applications.update",
      "htaf.applications.export",
      "htaf.applications.triage",
      "htaf.rides.create"
    ];
    for (const capability of granted) {
      expect(hasCapability("htaf_caseworker", capability)).toBe(true);
    }
    const denied = ADMIN_CAPABILITIES.filter((c) => !granted.includes(c));
    for (const capability of denied) {
      expect(hasCapability("htaf_caseworker", capability)).toBe(false);
    }
  });

  test("dispatcher: rides + operational driver approve/reject + dashboard, not compliance/HTAF/audit", () => {
    const granted = ["rides.read", "rides.dispatch", "drivers.read", "drivers.approve", "drivers.reject", "admin.dashboard.read"];
    for (const capability of granted) {
      expect(hasCapability("dispatcher", capability)).toBe(true);
    }
    for (const capability of ["drivers.compliance.override", "drivers.contact_verification.override", "audit.read", "htaf.applications.read", "riders.approve", "admin.rbac.manage"]) {
      expect(hasCapability("dispatcher", capability)).toBe(false);
    }
  });

  test("support: drivers/riders read + rider approve + dashboard, not writes to compliance/override/HTAF", () => {
    const granted = ["drivers.read", "riders.read", "riders.approve", "admin.dashboard.read"];
    for (const capability of granted) {
      expect(hasCapability("support", capability)).toBe(true);
    }
    for (const capability of ["drivers.approve", "drivers.compliance.override", "htaf.applications.read", "audit.read", "rides.dispatch"]) {
      expect(hasCapability("support", capability)).toBe(false);
    }
  });

  test("finance: fare/payout read + export + dashboard, not PII-heavy or write routes", () => {
    const granted = ["finance.read", "finance.export", "admin.dashboard.read"];
    for (const capability of granted) {
      expect(hasCapability("finance", capability)).toBe(true);
    }
    for (const capability of ["rides.dispatch", "drivers.approve", "htaf.applications.read", "audit.read"]) {
      expect(hasCapability("finance", capability)).toBe(false);
    }
  });

  test("compliance: override/audit/deletion-request authority, not ordinary dispatch/HTAF operations", () => {
    const granted = [
      "drivers.compliance.override",
      "drivers.compliance.read",
      "drivers.contact_verification.override",
      "audit.read",
      "deletion_requests.read",
      "deletion_requests.approve",
      "deletion_requests.reject"
    ];
    for (const capability of granted) {
      expect(hasCapability("compliance", capability)).toBe(true);
    }
    for (const capability of ["rides.dispatch", "drivers.approve", "htaf.applications.read", "finance.export", "admin.dashboard.read"]) {
      expect(hasCapability("compliance", capability)).toBe(false);
    }
  });
});

describe("hasCapability() -- deny-by-default guarantees", () => {
  test("an unrecognized role is denied every capability, including ones real roles have", () => {
    for (const capability of ADMIN_CAPABILITIES) {
      expect(hasCapability("nonexistent_role", capability)).toBe(false);
    }
    expect(hasCapability(null, "rides.read")).toBe(false);
    expect(hasCapability(undefined, "rides.read")).toBe(false);
    expect(hasCapability("", "rides.read")).toBe(false);
  });

  test("an unrecognized capability is denied for every role, including super_admin", () => {
    for (const role of ADMIN_ROLES) {
      expect(hasCapability(role, "rides.delete_everything")).toBe(false);
      expect(hasCapability(role, "")).toBe(false);
      expect(hasCapability(role, null)).toBe(false);
      expect(hasCapability(role, undefined)).toBe(false);
    }
  });

  test("a capability that is a case/prefix variant of a real one is still denied -- no fuzzy matching", () => {
    expect(hasCapability("dispatcher", "Rides.Read")).toBe(false);
    expect(hasCapability("dispatcher", "rides")).toBe(false);
    expect(hasCapability("dispatcher", "rides.read.extra")).toBe(false);
  });

  test("a role's grant list can never resolve true for a capability it doesn't explicitly list, even a superficially related one", () => {
    // htaf_caseworker can create a ride from an application
    // (htaf.rides.create) but must not thereby gain general ride
    // dispatch authority.
    expect(hasCapability("htaf_caseworker", "rides.dispatch")).toBe(false);
    expect(hasCapability("htaf_caseworker", "rides.read")).toBe(false);
  });
});

describe("resolveAdminRole() -- preserves the existing administrator as super_admin, deny-by-default otherwise", () => {
  test("all three of today's requireAdmin() auth methods resolve to super_admin", () => {
    expect(resolveAdminRole({ id: "token-admin", email: "admin@example.com", method: "admin_token" })).toBe("super_admin");
    expect(resolveAdminRole({ id: "password-admin", email: "admin@example.com", method: "admin_password" })).toBe("super_admin");
    expect(resolveAdminRole({ id: "session-admin", email: "admin@example.com", method: "admin_session" })).toBe("super_admin");
  });

  test("an unrecognized or missing method denies rather than guessing", () => {
    expect(resolveAdminRole({ id: "x", email: "a@example.com", method: "some_future_method" })).toBeNull();
    expect(resolveAdminRole({ id: "x", email: "a@example.com" })).toBeNull();
    expect(resolveAdminRole({})).toBeNull();
  });

  test("null/undefined/non-object input denies rather than throwing", () => {
    expect(resolveAdminRole(null)).toBeNull();
    expect(resolveAdminRole(undefined)).toBeNull();
    expect(resolveAdminRole("admin_token")).toBeNull();
    expect(() => resolveAdminRole(null)).not.toThrow();
  });

  test("a client-supplied role field on the admin object is never consulted -- only method decides", () => {
    // Simulates a would-be privilege-escalation payload: something
    // upstream bolts an arbitrary "role" property onto the admin
    // object. resolveAdminRole() must derive the role solely from the
    // authenticated method, never from a field that could originate
    // from anything client-influenced.
    const adversarial = { id: "token-admin", email: "admin@example.com", method: "admin_token", role: "attacker_supplied_role" };
    expect(resolveAdminRole(adversarial)).toBe("super_admin");

    const adversarialUnrecognizedMethod = { id: "x", email: "a@example.com", method: "not_a_real_method", role: "super_admin" };
    expect(resolveAdminRole(adversarialUnrecognizedMethod)).toBeNull();
  });
});

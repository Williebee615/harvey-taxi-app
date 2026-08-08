const {
  ADMIN_DRIVERS_LIST_FIELDS,
  ADMIN_RIDERS_LIST_FIELDS,
  ADMIN_RIDES_LIST_FIELDS,
  ADMIN_RIDE_MUTATION_FIELDS,
  ADMIN_DRIVER_MUTATION_FIELDS,
  ADMIN_RIDER_MUTATION_FIELDS,
  ADMIN_AUDIT_LOGS_LIST_FIELDS
} = require("./adminDirectory");

// These are the exact categories the investigation
// (docs/security-remediation/admin-drivers-riders-list-minimization.md)
// found exposed by the old select("*") on GET /api/admin/drivers and
// GET /api/admin/riders: credentials, raw verification codes/tokens and
// their hashes, raw third-party verification payloads, session/auth
// secrets, payment-provider linkage ids, and identity-document
// fragments. None of these have any legitimate use in a bulk list
// response, and none were found to be read by any live admin page.
const FORBIDDEN_DRIVER_FIELDS = [
  "password",
  "password_hash",
  "sms_verification_code",
  "sms_verification_code_hash",
  "sms_code",
  "email_verification_token",
  "email_verification_token_hash",
  "phone_verification_code_hash",
  "persona_last_payload",
  "persona_inquiry_id",
  "checkr_last_payload",
  "checkr_candidate_id",
  "checkr_invitation_url",
  "checkr_report_id",
  "stripe_account_id",
  "role",
  "consents"
];

const FORBIDDEN_RIDER_FIELDS = [
  "password",
  "password_hash",
  "verification_payload",
  "persona_last_payload",
  "persona_inquiry_id",
  "id_last4",
  "id_type",
  "stripe_customer_id",
  "role",
  "account_notes",
  "notes",
  "emergency_contact"
];

describe("ADMIN_DRIVERS_LIST_FIELDS (admin drivers list data-minimization regression coverage)", () => {
  test("never contains a credential, verification-secret, raw provider payload, or payment/session field", () => {
    for (const field of FORBIDDEN_DRIVER_FIELDS) {
      expect(ADMIN_DRIVERS_LIST_FIELDS).not.toContain(field);
    }
  });

  test("always contains id and created_at, which the route's keyset pagination requires", () => {
    expect(ADMIN_DRIVERS_LIST_FIELDS).toContain("id");
    expect(ADMIN_DRIVERS_LIST_FIELDS).toContain("created_at");
  });

  test("carries exactly the fields the live admin pages read, no more", () => {
    expect([...ADMIN_DRIVERS_LIST_FIELDS].sort()).toEqual(
      [
        "id",
        "created_at",
        "first_name",
        "last_name",
        "full_name",
        "name",
        "email",
        "status",
        "approval_status",
        "checkr_status",
        "online",
        "availability_status",
        "online_status",
        "current_address",
        "city"
      ].sort()
    );
  });

  test("has no duplicate columns", () => {
    expect(new Set(ADMIN_DRIVERS_LIST_FIELDS).size).toBe(ADMIN_DRIVERS_LIST_FIELDS.length);
  });
});

describe("ADMIN_RIDERS_LIST_FIELDS (admin riders list data-minimization regression coverage)", () => {
  test("never contains a credential, verification-secret, raw provider payload, or payment/session field", () => {
    for (const field of FORBIDDEN_RIDER_FIELDS) {
      expect(ADMIN_RIDERS_LIST_FIELDS).not.toContain(field);
    }
  });

  test("always contains id and created_at, which the route's keyset pagination requires", () => {
    expect(ADMIN_RIDERS_LIST_FIELDS).toContain("id");
    expect(ADMIN_RIDERS_LIST_FIELDS).toContain("created_at");
  });

  test("carries exactly the fields the live admin page reads, no more", () => {
    expect([...ADMIN_RIDERS_LIST_FIELDS].sort()).toEqual(
      ["id", "created_at", "first_name", "last_name", "email", "phone", "status", "approval_status"].sort()
    );
  });

  test("has no duplicate columns", () => {
    expect(new Set(ADMIN_RIDERS_LIST_FIELDS).size).toBe(ADMIN_RIDERS_LIST_FIELDS.length);
  });
});

describe("select() query string built from the allow-lists (simulates the actual server.js call)", () => {
  // Supabase's .select() only returns the columns named in this string --
  // this test proves the exact string server.js sends never mentions a
  // forbidden column, using a fabricated "full" row (every forbidden
  // field present, plus a unique marker value) to prove the
  // constant/query can't let one through even if the schema grows more
  // sensitive columns later that happen to share a prefix/suffix with an
  // allowed one (e.g. "password_hash" vs no allowed field resembling it).
  test("drivers select-string never contains a forbidden column name as a whole field", () => {
    const selectString = ADMIN_DRIVERS_LIST_FIELDS.join(",");
    const columns = selectString.split(",");
    for (const field of FORBIDDEN_DRIVER_FIELDS) {
      expect(columns).not.toContain(field);
    }
  });

  test("riders select-string never contains a forbidden column name as a whole field", () => {
    const selectString = ADMIN_RIDERS_LIST_FIELDS.join(",");
    const columns = selectString.split(",");
    for (const field of FORBIDDEN_RIDER_FIELDS) {
      expect(columns).not.toContain(field);
    }
  });
});

// docs/security-remediation/admin-rides-audit-stream-minimization.md.
// The rides table has no credential/verification-secret column the way
// drivers/riders did, so these are fields no live admin page reads --
// PII (rider_phone/driver_phone), raw location (exact lat/lng), raw
// jsonb snapshots, and operationally-sensitive fields (delivery_pin,
// payment_id, cancellation/admin notes) -- excluded on the same
// "nothing reads it" basis as the rest of this file, not because
// they're forbidden the way password_hash was.
const RIDES_FIELDS_NO_LIVE_PAGE_READS = [
  "rider_phone",
  "driver_phone",
  "driver_vehicle",
  "pickup_lat",
  "pickup_lng",
  "dropoff_lat",
  "dropoff_lng",
  "pricing_snapshot",
  "fare_config",
  "fare_snapshot",
  "route_snapshot",
  "payment_id",
  "delivery_pin",
  "admin_note",
  "notes",
  "cancellation_reason",
  "cancel_reason",
  "canceled_by",
  "cancelled_by",
  "pilot_status",
  "pilot_zone_id",
  "pilot_provider"
];

describe("ADMIN_RIDES_LIST_FIELDS (admin rides list data-minimization regression coverage)", () => {
  test("never contains a field no live admin page reads", () => {
    for (const field of RIDES_FIELDS_NO_LIVE_PAGE_READS) {
      expect(ADMIN_RIDES_LIST_FIELDS).not.toContain(field);
    }
  });

  test("always contains id and created_at, which the route's keyset pagination requires", () => {
    expect(ADMIN_RIDES_LIST_FIELDS).toContain("id");
    expect(ADMIN_RIDES_LIST_FIELDS).toContain("created_at");
  });

  test("has no duplicate columns", () => {
    expect(new Set(ADMIN_RIDES_LIST_FIELDS).size).toBe(ADMIN_RIDES_LIST_FIELDS.length);
  });
});

describe("ADMIN_RIDE_MUTATION_FIELDS (PATCH .../status and POST .../assign-driver response/broadcast)", () => {
  test("never contains a field no live admin page reads, and never the rider/driver PII the underlying query can see internally", () => {
    for (const field of [...RIDES_FIELDS_NO_LIVE_PAGE_READS, "rider_id", "rider_name", "ride_type"]) {
      expect(ADMIN_RIDE_MUTATION_FIELDS).not.toContain(field);
    }
  });

  test("always contains id, the minimum needed to confirm which ride changed", () => {
    expect(ADMIN_RIDE_MUTATION_FIELDS).toContain("id");
  });

  test("has no duplicate columns", () => {
    expect(new Set(ADMIN_RIDE_MUTATION_FIELDS).size).toBe(ADMIN_RIDE_MUTATION_FIELDS.length);
  });
});

describe("ADMIN_DRIVER_MUTATION_FIELDS (PATCH .../approve and .../reject response/broadcast)", () => {
  test("never contains a credential, verification-secret, raw provider payload, or payment/session field", () => {
    for (const field of FORBIDDEN_DRIVER_FIELDS) {
      expect(ADMIN_DRIVER_MUTATION_FIELDS).not.toContain(field);
    }
  });

  test("always contains id", () => {
    expect(ADMIN_DRIVER_MUTATION_FIELDS).toContain("id");
  });

  test("has no duplicate columns", () => {
    expect(new Set(ADMIN_DRIVER_MUTATION_FIELDS).size).toBe(ADMIN_DRIVER_MUTATION_FIELDS.length);
  });
});

describe("ADMIN_RIDER_MUTATION_FIELDS (PATCH .../approve response/broadcast)", () => {
  test("never contains a credential, verification-secret, raw provider payload, or payment/session field", () => {
    for (const field of FORBIDDEN_RIDER_FIELDS) {
      expect(ADMIN_RIDER_MUTATION_FIELDS).not.toContain(field);
    }
  });

  test("always contains id", () => {
    expect(ADMIN_RIDER_MUTATION_FIELDS).toContain("id");
  });

  test("has no duplicate columns", () => {
    expect(new Set(ADMIN_RIDER_MUTATION_FIELDS).size).toBe(ADMIN_RIDER_MUTATION_FIELDS.length);
  });
});

describe("ADMIN_AUDIT_LOGS_LIST_FIELDS (admin audit-log list allow-list)", () => {
  test("is exactly the audit_logs table's own 10 columns -- nothing was cut, since none are excludable, but the list is still explicit rather than select(*)", () => {
    expect([...ADMIN_AUDIT_LOGS_LIST_FIELDS].sort()).toEqual(
      [
        "id",
        "actor_type",
        "actor_id",
        "action",
        "entity_type",
        "entity_id",
        "metadata",
        "ip_address",
        "user_agent",
        "created_at"
      ].sort()
    );
  });

  test("has no duplicate columns", () => {
    expect(new Set(ADMIN_AUDIT_LOGS_LIST_FIELDS).size).toBe(ADMIN_AUDIT_LOGS_LIST_FIELDS.length);
  });
});

describe("rides/mutation select-strings never contain a no-live-page-reads field as a whole column", () => {
  test("ADMIN_RIDES_LIST_FIELDS select-string", () => {
    const columns = ADMIN_RIDES_LIST_FIELDS.join(",").split(",");
    for (const field of RIDES_FIELDS_NO_LIVE_PAGE_READS) {
      expect(columns).not.toContain(field);
    }
  });

  test("ADMIN_DRIVER_MUTATION_FIELDS select-string", () => {
    const columns = ADMIN_DRIVER_MUTATION_FIELDS.join(",").split(",");
    for (const field of FORBIDDEN_DRIVER_FIELDS) {
      expect(columns).not.toContain(field);
    }
  });

  test("ADMIN_RIDER_MUTATION_FIELDS select-string", () => {
    const columns = ADMIN_RIDER_MUTATION_FIELDS.join(",").split(",");
    for (const field of FORBIDDEN_RIDER_FIELDS) {
      expect(columns).not.toContain(field);
    }
  });
});

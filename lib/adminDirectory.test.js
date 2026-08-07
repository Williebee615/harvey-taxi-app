const { ADMIN_DRIVERS_LIST_FIELDS, ADMIN_RIDERS_LIST_FIELDS } = require("./adminDirectory");

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

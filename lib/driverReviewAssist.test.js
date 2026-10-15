// Driver review assistant rules (lib/driverReviewAssist.js) on synthetic
// driver records: verification states, Persona/Checkr states that only say
// "verified" when the integration recorded it, expired documents,
// unavailable integrations, duplicates as prompts, and no personal data in
// the output.
const fs = require("fs");
const path = require("path");
const r = require("./driverReviewAssist");

const TODAY = "2026-10-14";
const ON = { persona: true, checkr: true };
const COMPLETE = Object.freeze({
  id: "DRV-SYN-1",
  first_name: "Dana",
  last_name: "Synthetic",
  email: "dana.synthetic@example.test",
  phone: "6155550123",
  home_address: "1 Example St",
  email_verified: true,
  phone_verified: true,
  persona_status: "approved",
  persona_verified: true,
  persona_inquiry_id: "inq_SYNTHETIC",
  checkr_status: "clear",
  checkr_candidate_id: "cand_SYNTHETIC",
  drivers_license_number: "TN-SYN-123456",
  license_status: "verified",
  vehicle_make: "Toyota",
  vehicle_model: "Camry",
  vehicle_year: "2021",
  vehicle_plate: "SYN-123",
  insurance_confirmed: true,
  insurance_status: "verified",
  accepted_terms: true,
  accepted_background_check_consent: true,
  accepted_driver_policy: true,
  password_hash: "SECRET-HASH",
  stripe_account_id: "acct_SYN"
});
const doc = (document_type, expires_on, source = "staff_from_document", verification_status = "staff_verified") => ({ document_type, expires_on, source, verification_status });
const VERIFIED_DOCS = [doc("drivers_license", "2028-05-01"), doc("insurance", "2027-03-01"), doc("vehicle_registration", "2027-06-01")];
const review = (patch = {}, opts = {}) => r.reviewDriver({ ...COMPLETE, ...patch }, { integrations: ON, today: TODAY, documents: VERIFIED_DOCS, ...opts });
const ids = (out) => out.checks.map((c) => c.id);

describe("synthetic driver applications", () => {
  test("complete and verified through the integrations: nothing outstanding", () => {
    const out = review();
    expect(out.checks).toEqual([]);
    expect(out.status).toMatchObject({ email: "verified", phone: "verified", identity_persona: "verified", background_checkr: "verified", license: "verified by staff", insurance: "verified by staff" });
  });

  test("new applicant: unverified contact, nothing started, details missing", () => {
    const out = r.reviewDriver(
      { id: "DRV-NEW", email: "x@example.test", email_verified: false, phone_verified: false },
      { integrations: ON, today: TODAY }
    );
    expect(ids(out)).toEqual([
      "email_not_verified",
      "phone_not_verified",
      "identity_not_started",
      "background_not_started",
      "license_missing",
      "vehicle_incomplete",
      "insurance_missing",
      "expiration_not_recorded",
      "consents_missing"
    ]);
  });
});

describe("Persona and Checkr: 'verified' only when the integration recorded it", () => {
  test("not configured: says so, even if a verified flag is on file", () => {
    const out = r.reviewDriver(COMPLETE, { integrations: { persona: false, checkr: false }, today: TODAY, documents: VERIFIED_DOCS });
    expect(out.status.identity_persona).toBe("not configured");
    expect(out.status.background_checkr).toBe("not configured");
    expect(ids(out)).toEqual(["identity_not_configured", "background_not_configured"]);
  });

  test("not started / pending / needs review", () => {
    expect(review({ persona_status: "", persona_inquiry_id: "", persona_verified: false }).status.identity_persona).toBe("not started");
    expect(review({ persona_status: "pending", persona_verified: false }).status.identity_persona).toBe("pending");
    expect(review({ persona_status: "declined", persona_verified: false }).status.identity_persona).toBe("result needs staff review");
    expect(review({ checkr_status: "", checkr_candidate_id: "" }).status.background_checkr).toBe("not started");
    expect(review({ checkr_status: "invited" }).status.background_checkr).toBe("pending");
    expect(review({ checkr_status: "consider" }).status.background_checkr).toBe("result needs staff review");
  });

  test("a verified flag without the integration's record is shown as set by staff", () => {
    const out = review({ persona_inquiry_id: "", checkr_candidate_id: "" });
    expect(out.status.identity_persona).toBe("recorded by staff (not confirmed by the integration)");
    expect(out.status.background_checkr).toBe("recorded by staff (not confirmed by the integration)");
    expect(ids(out)).toEqual(["identity_staff_recorded", "background_staff_recorded"]);
  });

  test("a staff compliance override on record is never reported as integration-verified", () => {
    const out = review({}, { staffOverrides: { checkr: true, persona: true } });
    expect(out.status.background_checkr).toBe("recorded by staff (not confirmed by the integration)");
    expect(out.status.identity_persona).toBe("recorded by staff (not confirmed by the integration)");
  });
});

describe("documents: entered or self-confirmed is not verified", () => {
  test("license number entered but not verified; insurance confirmed by the driver only", () => {
    const out = review({ license_status: "", insurance_status: "" });
    expect(out.status.license).toBe("entered, not verified");
    expect(out.status.insurance).toBe("confirmed by driver only");
    expect(ids(out)).toEqual(["license_not_verified", "insurance_self_reported"]);
  });

  test("expired license, insurance and registration are each flagged; soon-to-expire too", () => {
    const out = review({}, { documents: [doc("drivers_license", "2026-09-30"), doc("insurance", "2026-10-13"), doc("vehicle_registration", "2026-11-01")] });
    expect(ids(out)).toEqual(["license_expired", "insurance_expired", "expiring_soon"]);
    expect(out.checks.find((c) => c.id === "license_expired")).toMatchObject({ date: "2026-09-30", verification: "verified by staff" });
  });

  test("no expiration dates recorded: says so rather than assuming valid", () => {
    const out = review({}, { documents: [] });
    expect(ids(out)).toEqual(["expiration_not_recorded"]);
    expect(out.status.expiration_dates).toBe("not recorded");
  });

  test("each date shows its source and verification; a driver-entered date is flagged as unverified", () => {
    const out = review({}, { documents: [doc("drivers_license", "2028-05-01", "driver_entered", "unverified"), doc("insurance", "2027-03-01", "provider", "provider_verified")] });
    expect(ids(out)).toEqual(["expiration_unverified"]);
    expect(out.status.expiration_dates).toEqual({
      license: { expires_on: "2028-05-01", source: "entered by the driver", verification: "unverified" },
      insurance: { expires_on: "2027-03-01", source: "reported by a verification provider", verification: "verified by a provider" }
    });
  });

  test("an expired but unverified date is still flagged, and labelled unverified", () => {
    const out = review({}, { documents: [doc("insurance", "2026-10-01", "driver_entered", "unverified")] });
    expect(ids(out)).toEqual(["insurance_expired", "expiration_unverified"]);
    expect(out.checks[0].verification).toBe("unverified");
  });

  test("unknown source or status values are never shown as verified", () => {
    const out = review({}, { documents: [{ document_type: "insurance", expires_on: "2027-03-01", source: "guess", verification_status: "trust_me" }] });
    expect(out.status.expiration_dates.insurance).toEqual({ expires_on: "2027-03-01", source: "unknown source", verification: "unverified" });
    expect(ids(out)).toContain("expiration_unverified");
  });
});

describe("possible duplicates are review prompts", () => {
  test("lists the other account id, status, date and which identifier matched -- nothing else", () => {
    const out = review({}, { related: [{ id: "DRV-OTHER", created_at: "2026-09-01T00:00:00Z", approval_status: "rejected", matched: ["phone", "plate"], email: "leak@example.test" }] });
    expect(ids(out)).toEqual(["possible_duplicate"]);
    expect(out.checks[0].related).toEqual([{ account: "DRV-OTHER", created: "2026-09-01", status: "rejected", matched: ["phone", "plate"] }]);
    expect(out.checks[0].message).toMatch(/not evidence of fraud/);
    expect(JSON.stringify(out)).not.toContain("leak@example.test");
  });
});

describe("advisory only, internal, no personal data", () => {
  const outputs = [review(), review({ email_verified: false, license_status: "" }), review({}, { related: [{ id: "DRV-2", matched: ["email"] }] })];

  test("output never contains name, email, phone, address, license number, plate, password or payment data", () => {
    for (const out of outputs) {
      const body = JSON.stringify(out);
      for (const v of ["Dana", "Synthetic", "dana.synthetic", "6155550123", "Example St", "TN-SYN-123456", "SYN-123", "SECRET-HASH", "acct_SYN", "inq_SYNTHETIC", "cand_SYNTHETIC"]) {
        expect(body).not.toContain(v);
      }
    }
  });

  test("no approve/reject/activate/suspend output or wording outside the fixed label", () => {
    for (const out of outputs) {
      // The fixed label names the staff decisions, and a duplicate's existing
      // account status is shown as recorded; nothing else may.
      const body = JSON.stringify({ ...out, label: undefined, checks: out.checks.map(({ related, ...c }) => c) }).replace("not evidence of fraud", "");
      expect(body).not.toMatch(/\b(approv|reject|activat|suspend|deactivat|ban|fraud)/i);
      expect(out).not.toHaveProperty("recommendation");
      expect(out).not.toHaveProperty("decision");
    }
    expect(r.LABEL).toMatch(/staff approve, reject, activate or suspend every driver/);
  });

  test("runs locally: the module loads no network, AI, database or telemetry client", () => {
    const source = fs.readFileSync(path.join(__dirname, "driverReviewAssist.js"), "utf8");
    expect(source.match(/require\(/g)).toBeNull();
    expect(source).not.toMatch(/fetch\(|openai|anthropic|supabase|posthog|sentry|analytics|https?:\/\//i);
  });

  test("does not change the record it reads", () => {
    const copy = JSON.parse(JSON.stringify(COMPLETE));
    r.reviewDriver(copy, { integrations: ON, today: TODAY });
    expect(copy).toEqual(JSON.parse(JSON.stringify(COMPLETE)));
  });
});

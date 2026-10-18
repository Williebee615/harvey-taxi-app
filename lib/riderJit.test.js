const {
  AUTO_APPROVAL_RULE,
  isRiderSuspended,
  cleanFirstName,
  planRiderAutoApproval,
  buildQuickRiderRecord,
  buildSuspensionUpdate,
  buildReinstatementUpdate,
  cleanStaffReason
} = require("./riderJit");

const NOW = "2026-10-18T07:00:00.000Z";

describe("planRiderAutoApproval (owner rule: approve on phone verification)", () => {
  test("a pending rider is approved and marked phone-verified", () => {
    expect(planRiderAutoApproval({ id: "R1", status: "pending_verification", approval_status: "pending" }, NOW)).toEqual({
      status: "active",
      approval_status: "approved",
      approved_at: NOW,
      sms_verified: true,
      updated_at: NOW
    });
  });

  test("an earlier approval time is kept", () => {
    const plan = planRiderAutoApproval({ status: "active", approval_status: "approved", sms_verified: false, approved_at: "2026-01-01T00:00:00Z" }, NOW);
    expect(plan.approved_at).toBe("2026-01-01T00:00:00Z");
  });

  test("an approved rider with a verified phone needs no write", () => {
    expect(planRiderAutoApproval({ status: "active", approval_status: "approved", sms_verified: true }, NOW)).toBeNull();
  });

  test.each([
    [{ status: "suspended", approval_status: "suspended" }],
    [{ status: "active", approval_status: "suspended" }],
    [{ status: "active", approval_status: "pending", is_blocked: true }],
    [{ status: "active", approval_status: "pending", access_revoked: true }],
    [{ status: "active", approval_status: "pending", deleted_at: NOW }],
    [null]
  ])("never approves a suspended, blocked, revoked or deleted rider: %p", (rider) => {
    expect(planRiderAutoApproval(rider, NOW)).toBeNull();
  });

  test("the rule is recorded as the owner's, not an agent's", () => {
    expect(AUTO_APPROVAL_RULE).toMatchObject({ rule: "phone_verified", set_by: "owner", decision_date: "2026-10-18" });
    expect(Object.isFrozen(AUTO_APPROVAL_RULE)).toBe(true);
  });
});

describe("buildQuickRiderRecord", () => {
  test("first name and phone only; approved; phone verified; email not", () => {
    const row = buildQuickRiderRecord({ id: "RIDER_X", firstName: "Ana", phone: "6155550199", now: NOW });
    expect(row).toMatchObject({
      id: "RIDER_X",
      first_name: "Ana",
      last_name: null,
      email: null,
      phone: "6155550199",
      status: "active",
      approval_status: "approved",
      approved_at: NOW,
      sms_verified: true,
      email_verified: false
    });
  });
});

describe("cleanFirstName", () => {
  test.each([
    ["Ana", "Ana"],
    ["  María  José ", "María José"],
    ["O'Brien", "O'Brien"],
    ["Jean-Luc", "Jean-Luc"],
    ["", ""],
    ["1234", ""],
    ["<script>", ""],
    ["a".repeat(61), ""]
  ])("%p -> %p", (input, expected) => {
    expect(cleanFirstName(input)).toBe(expected);
  });
});

describe("suspension and reinstatement", () => {
  test("suspension blocks the rider and records the reason", () => {
    const update = buildSuspensionUpdate({ reason: "Safety report under review", now: NOW });
    expect(update).toEqual({
      status: "suspended",
      approval_status: "suspended",
      is_blocked: true,
      approval_note: "Safety report under review",
      updated_at: NOW
    });
    expect(isRiderSuspended(update)).toBe(true);
    expect(planRiderAutoApproval({ ...update, sms_verified: true }, NOW)).toBeNull();
  });

  test("reinstatement restores approval when the phone is verified", () => {
    expect(buildReinstatementUpdate({ rider: { sms_verified: true }, reason: "Review closed", now: NOW })).toMatchObject({
      status: "active",
      approval_status: "approved",
      is_blocked: false
    });
  });

  test("reinstatement without a verified phone returns to pending", () => {
    expect(buildReinstatementUpdate({ rider: { sms_verified: false }, reason: "Review closed", now: NOW })).toMatchObject({
      status: "pending_verification",
      approval_status: "pending",
      is_blocked: false
    });
  });

  test("a reason of 3-500 characters is required", () => {
    expect(cleanStaffReason("ok")).toBe("");
    expect(cleanStaffReason("  Fraud  check ")).toBe("Fraud check");
    expect(cleanStaffReason("x".repeat(501))).toBe("");
  });
});

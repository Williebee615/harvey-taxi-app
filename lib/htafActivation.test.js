const {
  RIDE_CREATION_APPROVALS,
  resolveHtafActivation
} = require("./htafActivation");

const NOW = Date.parse("2026-10-01T12:00:00Z");

const RIDE_APPROVALS = {
  HTAF_PROVIDER_AGREEMENT_REF: "AGR-2026-001",
  HTAF_CONFLICT_REVIEW_REF: "Board minutes 2026-09-30 item 4",
  HTAF_RIDE_TRANSFER_APPROVED_BY: "Board of Directors",
  HTAF_RIDE_TRANSFER_APPROVED_AT: "2026-09-30"
};

describe("resolveHtafActivation -- ride creation", () => {
  test("off by default, with every approval listed as missing", () => {
    const { rideCreation } = resolveHtafActivation({}, { now: NOW });
    expect(rideCreation).toMatchObject({ enabled: false, requested: false, reason: "HTAF_RIDE_CREATION_ENABLED is off" });
    expect(rideCreation.missing).toEqual([...RIDE_CREATION_APPROVALS]);
  });

  test("the flag alone does not enable it", () => {
    const { rideCreation } = resolveHtafActivation({ HTAF_RIDE_CREATION_ENABLED: "true" }, { now: NOW });
    expect(rideCreation.enabled).toBe(false);
    expect(rideCreation.requested).toBe(true);
    expect(rideCreation.reason).toBe(`approval record incomplete: ${RIDE_CREATION_APPROVALS.join(", ")}`);
  });

  test.each(RIDE_CREATION_APPROVALS)("missing %s keeps it off", (name) => {
    const env = { HTAF_RIDE_CREATION_ENABLED: "true", ...RIDE_APPROVALS, [name]: "  " };
    const { rideCreation } = resolveHtafActivation(env, { now: NOW });
    expect(rideCreation.enabled).toBe(false);
    expect(rideCreation.missing).toEqual([name]);
  });

  test.each([
    ["not a date", "soon"],
    ["impossible date", "2026-13-45"],
    ["in the future", "2027-01-01"]
  ])("an approval date that is %s keeps it off", (_label, value) => {
    const env = { HTAF_RIDE_CREATION_ENABLED: "true", ...RIDE_APPROVALS, HTAF_RIDE_TRANSFER_APPROVED_AT: value };
    expect(resolveHtafActivation(env, { now: NOW }).rideCreation.enabled).toBe(false);
  });

  test("the flag plus a complete approval record enables it and carries the record", () => {
    const { rideCreation } = resolveHtafActivation({ HTAF_RIDE_CREATION_ENABLED: "true", ...RIDE_APPROVALS }, { now: NOW });
    expect(rideCreation).toMatchObject({ enabled: true, missing: [], approvals: RIDE_APPROVALS });
  });

  test.each(["false", "0", "off", "", "no", "TRUE-ish"])('flag "%s" is off even with approvals', (value) => {
    const env = { HTAF_RIDE_CREATION_ENABLED: value, ...RIDE_APPROVALS };
    expect(resolveHtafActivation(env, { now: NOW }).rideCreation.enabled).toBe(false);
  });

  test("the removed AI triage gate cannot be switched on by any setting", () => {
    const env = {
      HTAF_RIDE_CREATION_ENABLED: "true",
      HTAF_AI_TRIAGE_ENABLED: "true",
      HTAF_AI_PRIVACY_REVIEW_REF: "PRIV-1",
      HTAF_AI_TRIAGE_APPROVED_BY: "Someone",
      HTAF_AI_TRIAGE_APPROVED_AT: "2026-01-01",
      ...RIDE_APPROVALS
    };
    const result = resolveHtafActivation(env, { now: NOW });
    expect(Object.keys(result)).toEqual(["rideCreation"]);
    expect(result.rideCreation.enabled).toBe(true);
  });
});


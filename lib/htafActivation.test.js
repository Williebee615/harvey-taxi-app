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


const { FUNDING_APPROVALS, resolveHtafFunding } = require("./htafActivation");

const FUNDING_RECORD = {
  HTAF_PROVIDER_AGREEMENT_REF: "AGR-2026-001",
  HTAF_CONFLICT_REVIEW_REF: "Board minutes 2026-09-30 item 4",
  HTAF_RATE_CARD_APPROVAL_REF: "Board minutes 2026-09-30 item 5",
  HTAF_FUNDING_APPROVED_BY: "Board of Directors",
  HTAF_FUNDING_APPROVED_AT: "2026-09-30"
};

describe("resolveHtafFunding -- ride assistance switches", () => {
  test("both off by default, with every approval listed as missing", () => {
    const { funding, invoicing } = resolveHtafFunding({}, { now: NOW });
    expect(funding).toMatchObject({ enabled: false, requested: false, reason: "HTAF_FUNDING_ENABLED is off" });
    expect(funding.missing).toEqual([...FUNDING_APPROVALS]);
    expect(invoicing).toMatchObject({ enabled: false, requested: false, chargesHtaf: false });
  });

  test("the flag alone does not enable it", () => {
    const { funding } = resolveHtafFunding({ HTAF_FUNDING_ENABLED: "true" }, { now: NOW });
    expect(funding).toMatchObject({ enabled: false, requested: true });
    expect(funding.reason).toBe(`approval record incomplete: ${FUNDING_APPROVALS.join(", ")}`);
  });

  test("a complete record still leaves it off while no feature is built", () => {
    const env = { HTAF_FUNDING_ENABLED: "true", HTAF_INVOICING_ENABLED: "true", ...FUNDING_RECORD };
    const { funding, invoicing } = resolveHtafFunding(env, { now: NOW });
    expect(funding).toMatchObject({ enabled: false, missing: [], reason: expect.stringMatching(/not built|design only/) });
    expect(invoicing.enabled).toBe(false);
  });

  test.each(FUNDING_APPROVALS)("missing %s keeps it off once built", (name) => {
    const env = { HTAF_FUNDING_ENABLED: "true", ...FUNDING_RECORD, [name]: " " };
    const { funding } = resolveHtafFunding(env, { now: NOW, featureBuilt: true });
    expect(funding.enabled).toBe(false);
    expect(funding.missing).toEqual([name]);
  });

  test("an approval date in the future keeps it off once built", () => {
    const env = { HTAF_FUNDING_ENABLED: "true", ...FUNDING_RECORD, HTAF_FUNDING_APPROVED_AT: "2027-01-01" };
    expect(resolveHtafFunding(env, { now: NOW, featureBuilt: true }).funding.enabled).toBe(false);
  });

  test("once built, the flag plus a complete record enables it and carries the record", () => {
    const env = { HTAF_FUNDING_ENABLED: "true", ...FUNDING_RECORD };
    const { funding } = resolveHtafFunding(env, { now: NOW, featureBuilt: true });
    expect(funding).toMatchObject({ enabled: true, approvals: FUNDING_RECORD });
  });

  test("invoicing needs ride assistance on, and never charges HTAF", () => {
    const record = { HTAF_INVOICING_ENABLED: "true", ...FUNDING_RECORD };
    const off = resolveHtafFunding(record, { now: NOW, featureBuilt: true }).invoicing;
    expect(off).toMatchObject({ enabled: false, chargesHtaf: false, reason: expect.stringMatching(/HTAF_FUNDING_ENABLED/) });
    const on = resolveHtafFunding({ ...record, HTAF_FUNDING_ENABLED: "true" }, { now: NOW, featureBuilt: true }).invoicing;
    expect(on).toMatchObject({ enabled: true, chargesHtaf: false });
  });

  test("the ride-creation gate is unchanged by the funding settings", () => {
    const env = { HTAF_FUNDING_ENABLED: "true", ...FUNDING_RECORD };
    expect(resolveHtafActivation(env, { now: NOW }).rideCreation.enabled).toBe(false);
  });
});

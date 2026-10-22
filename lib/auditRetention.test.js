const r = require("./auditRetention");

test("cutoff is 90 days before now", () => {
  expect(r.cutoffIso(Date.parse("2026-10-22T00:00:00Z"))).toBe("2026-07-24T00:00:00.000Z");
});

test.each([
  [{ enabled: "false", legalHold: "false" }, { ok: false, reason: "switched_off" }],
  [{ enabled: undefined, legalHold: undefined }, { ok: false, reason: "switched_off" }],
  [{ enabled: "true", legalHold: "true" }, { ok: false, reason: "legal_hold" }],
  [{ enabled: "false", legalHold: "true" }, { ok: false, reason: "legal_hold" }],
  [{ enabled: "true", legalHold: "false" }, { ok: true }]
])("runGate %#", (input, expected) => {
  expect(r.runGate(input)).toEqual(expected);
});

test("the run record carries counts only", () => {
  const rec = r.runRecord({ cleared: 3, cutoff: "2026-07-24T00:00:00.000Z", mode: "live", trigger: "sweep" });
  expect(rec.action).toBe("retention_audit_ip_cleared");
  expect(Object.keys(rec.metadata).sort()).toEqual(["cleared", "cutoff", "mode", "retention_days", "trigger"]);
});

const { resolvePerMinuteLimit, isIsolatedTestEnvironment, PRODUCTION_CEILING } = require("./rateLimitConfig");

const warn = jest.fn();
beforeEach(() => warn.mockReset());

test("unset uses the default; normal values are honoured", () => {
  expect(resolvePerMinuteLimit("X", 120, { env: {}, warn })).toBe(120);
  expect(resolvePerMinuteLimit("X", 120, { env: { X: "300" }, warn })).toBe(300);
  expect(warn).not.toHaveBeenCalled();
});

test("a raised limit is ignored in production and in non-isolated tests", () => {
  expect(resolvePerMinuteLimit("X", 120, { env: { X: "100000", NODE_ENV: "production" }, warn })).toBe(120);
  expect(resolvePerMinuteLimit("X", 120, { env: { X: "100000", NODE_ENV: "test" }, warn })).toBe(120);
  expect(resolvePerMinuteLimit("X", 120, { env: { X: "100000", HARVEY_ISOLATED_TEST: "1" }, warn })).toBe(120);
  expect(warn).toHaveBeenCalledTimes(3);
  expect(warn.mock.calls[0][0]).toMatch(/only allowed in isolated test environments/);
});

test("a raised limit applies only in an explicitly isolated test environment", () => {
  const env = { X: "100000", NODE_ENV: "test", HARVEY_ISOLATED_TEST: "1" };
  expect(isIsolatedTestEnvironment(env)).toBe(true);
  expect(resolvePerMinuteLimit("X", 120, { env, warn })).toBe(100000);
});

test("invalid values fall back", () => {
  for (const X of ["abc", "0", "-5"]) expect(resolvePerMinuteLimit("X", 120, { env: { X }, warn })).toBe(120);
  expect(PRODUCTION_CEILING).toBe(1000);
});

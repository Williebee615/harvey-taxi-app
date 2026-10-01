// Per-minute rate limits read from the environment.
//
// Test suites run every request from 127.0.0.1, so they raise limits
// (for example API_RATE_LIMIT_PER_MINUTE=100000) to avoid tripping the
// per-IP limiter mid-suite. That must never be possible in production by
// accident: a value above PRODUCTION_CEILING is honoured only in an
// explicitly isolated test environment (NODE_ENV=test AND
// HARVEY_ISOLATED_TEST=1). Anywhere else it is ignored, the default is
// used, and a warning names the variable (never its value's context).

const PRODUCTION_CEILING = 1000;

function isIsolatedTestEnvironment(env = process.env) {
  return env.NODE_ENV === "test" && env.HARVEY_ISOLATED_TEST === "1";
}

function resolvePerMinuteLimit(name, fallback, { env = process.env, warn = console.warn } = {}) {
  const raw = env[name];
  if (raw === undefined || raw === null || String(raw).trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 1) {
    warn(`⚠️ ${name} is not a positive number; using ${fallback}.`);
    return fallback;
  }
  if (value > PRODUCTION_CEILING && !isIsolatedTestEnvironment(env)) {
    warn(`⚠️ ${name} above ${PRODUCTION_CEILING} is only allowed in isolated test environments; using ${fallback}.`);
    return fallback;
  }
  return Math.floor(value);
}

module.exports = { PRODUCTION_CEILING, isIsolatedTestEnvironment, resolvePerMinuteLimit };

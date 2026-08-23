// Composition/integration tests for the review-login rate-limit
// follow-up fix. Deliberately its own test file (not appended to
// server.review-accounts.test.js) so it gets a completely fresh
// in-memory rate-limiter state -- the existing file already tracks its
// request budget carefully against POST /api/review/rider/login's real
// per-minute IP limit (max 10), and this test needs to deliberately
// exceed the per-destination limit (max 5 per 10 minutes), which would
// collide with that budget if run in the same process.
//
// No review account needs to be seeded for this: a rate-limit rejection
// happens in middleware, before the route handler ever queries
// `riders`, so the exact same fixture-less setup proves the fix
// regardless of whether the submitted email belongs to a real account.

process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.RIDER_SESSION_SECRET = "test-rider-session-secret";
process.env.DRIVER_SESSION_SECRET = "test-driver-session-secret";
process.env.RIDE_QUOTE_SECRET = "test-ride-quote-secret";
process.env.ADMIN_API_TOKEN = "test-admin-token";
process.env.NODE_ENV = "test";

const { createFakeSupabase } = require("./fakeSupabase");

let mockSupabaseClient;

jest.mock("@supabase/supabase-js", () => ({
  createClient: () => mockSupabaseClient
}));

const request = require("supertest");

let app;

beforeAll(() => {
  mockSupabaseClient = createFakeSupabase({
    riders: [],
    drivers: [],
    system_flags: [{ key: "review_account_login_enabled", value: "true" }]
  });
  // eslint-disable-next-line global-require
  ({ app } = require("../server"));
});

const RIDER_CLIENT_HEADER = { "x-requested-with": "harvey-rider-app" };
const RATE_LIMIT_MESSAGE = "Too many sign-in attempts. Wait 10 minutes and try again.";

describe("POST /api/review/rider/login -- rate-limit follow-up fix", () => {
  const email = "ratelimit-test-rider@example.test";

  test("the 6th attempt within the destination window is rejected with the honest 429 shape, not a credentials-style message", async () => {
    let last;

    // The destination limiter allows 5 per 10 minutes -- the first 5
    // attempts here fail for the ordinary reason (no such account, since
    // nothing was seeded), the 6th must be rate-limited instead.
    for (let i = 0; i < 6; i++) {
      // eslint-disable-next-line no-await-in-loop
      last = await request(app)
        .post("/api/review/rider/login")
        .set(RIDER_CLIENT_HEADER)
        .send({ email, password: "whatever-password" });
    }

    expect(last.status).toBe(429);
    expect(last.body.ok).toBe(false);
    expect(last.body.message).toBe(RATE_LIMIT_MESSAGE);
    expect(last.body.error).toBe(RATE_LIMIT_MESSAGE);

    // Honors Retry-After: both the standard header and a JSON field a
    // same-origin browser client can read without needing
    // Access-Control-Expose-Headers.
    expect(last.headers["retry-after"]).toBeDefined();
    expect(Number(last.headers["retry-after"])).toBeGreaterThan(0);
    expect(typeof last.body.retry_after_seconds).toBe("number");
    expect(last.body.retry_after_seconds).toBeGreaterThan(0);
    expect(last.body.retry_after_seconds).toBeLessThanOrEqual(10 * 60);
  });

  test("the 429 response body carries no field that could hint at whether the account exists -- same generic shape either way", async () => {
    // At this point the previous test has already exhausted this exact
    // email's destination limit for this run, so this next attempt is
    // guaranteed to be rate-limited too -- reusing that state instead of
    // spending a fresh budget of requests confirms the shape is stable
    // across repeated 429s, not a one-off.
    const res = await request(app)
      .post("/api/review/rider/login")
      .set(RIDER_CLIENT_HEADER)
      .send({ email, password: "whatever-password" });

    expect(res.status).toBe(429);
    expect(Object.keys(res.body).sort()).toEqual(["error", "message", "ok", "retry_after_seconds"].sort());
  });
});

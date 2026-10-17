// Rate limits and audit records key on the caller's real IP. A client can
// write its own X-Forwarded-For (Render appends to it rather than replacing
// it), so changing that header must not buy a fresh allowance. Cloudflare's
// CF-Connecting-IP, which the edge sets and overwrites, is used when present.
process.env.NODE_ENV = "test";
process.env.API_RATE_LIMIT_PER_MINUTE = "100000";
process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";

const request = require("supertest");
const { createFakeSupabase } = require("./fakeSupabase");

let mockSupabaseClient;
jest.mock("@supabase/supabase-js", () => ({ createClient: () => mockSupabaseClient }));

let app;
beforeAll(() => {
  mockSupabaseClient = createFakeSupabase({ merchants: [], audit_logs: [], system_flags: [] });
  // eslint-disable-next-line global-require
  ({ app } = require("../server"));
});

// An empty application is refused (400) after the rate limiter runs, so
// nothing is stored; 429 means the limiter counted the caller.
const apply = (headers) => {
  let r = request(app).post("/api/merchants/apply");
  for (const [k, v] of Object.entries(headers)) r = r.set(k, v);
  return r.send({}).then((res) => res.status);
};

test("a client-written X-Forwarded-For entry doesn't reset the limit (proxy-appended address is used)", async () => {
  const codes = [];
  for (let i = 0; i < 6; i += 1) codes.push(await apply({ "x-forwarded-for": `203.0.113.${i}, 198.51.100.10` }));
  expect(codes).toEqual([400, 400, 400, 400, 400, 429]);
});

test("behind the edge, CF-Connecting-IP identifies the caller whatever X-Forwarded-For says", async () => {
  const codes = [];
  for (let i = 0; i < 6; i += 1) codes.push(await apply({ "cf-connecting-ip": "192.0.2.44", "x-forwarded-for": `203.0.113.${50 + i}` }));
  expect(codes).toEqual([400, 400, 400, 400, 400, 429]);
  // A different real caller still has its own allowance.
  expect(await apply({ "cf-connecting-ip": "192.0.2.45" })).toBe(400);
});

test("a malformed CF-Connecting-IP is ignored", async () => {
  const codes = [];
  for (let i = 0; i < 6; i += 1) codes.push(await apply({ "cf-connecting-ip": `not-an-ip-${i}`, "x-forwarded-for": "198.51.100.77" }));
  expect(codes.at(-1)).toBe(429);
});

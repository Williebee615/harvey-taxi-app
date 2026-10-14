// /api/health exposes a minimal deployment identifier: the first 7 hex
// characters of the deployed commit, or "unknown". Nothing else about the
// build or configuration is added for public callers.

process.env.NODE_ENV = "test";
process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.RIDER_SESSION_SECRET = "test-rider-session-secret";
process.env.DRIVER_SESSION_SECRET = "test-driver-session-secret";
process.env.RIDE_QUOTE_SECRET = "test-ride-quote-secret";
process.env.ADMIN_API_TOKEN = "test-admin-token";

const request = require("supertest");
const { createFakeSupabase } = require("./fakeSupabase");

let mockClient = createFakeSupabase({ system_flags: [] });
jest.mock("@supabase/supabase-js", () => ({ createClient: () => mockClient }));

function load(commit) {
  const saved = process.env.RENDER_GIT_COMMIT;
  if (commit === undefined) delete process.env.RENDER_GIT_COMMIT;
  else process.env.RENDER_GIT_COMMIT = commit;
  let app;
  jest.isolateModules(() => {
    // eslint-disable-next-line global-require
    ({ app } = require("../server"));
  });
  if (saved === undefined) delete process.env.RENDER_GIT_COMMIT;
  else process.env.RENDER_GIT_COMMIT = saved;
  return app;
}

test("public health reports the short commit and nothing more", async () => {
  const res = await request(load("D825E488C02790AC2AAAC766E54E7BB488345BDC")).get("/api/health");
  expect(res.status).toBe(200);
  expect(res.body.version).toBe("d825e48");
  expect(Object.keys(res.body).sort()).toEqual(["database", "ok", "service", "status", "time", "version"]);
});

test.each([[undefined], [""], ["not-a-sha"], ["abc"], ["<script>"]])("missing or malformed commit %p -> unknown", async (commit) => {
  const res = await request(load(commit)).get("/api/health");
  expect(res.body.version).toBe("unknown");
});

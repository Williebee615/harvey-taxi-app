// GET /api/admin/membrane/calibration: owner account only; reports the
// membrane's configuration and health and runs the calibration on the
// published pages through the membrane; writes nothing. The membrane here is
// a local stand-in speaking the same request shape (no model, no network
// beyond localhost).

process.env.NODE_ENV = "test";
process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.RIDER_SESSION_SECRET = "test-rider-session-secret";
process.env.DRIVER_SESSION_SECRET = "test-driver-session-secret";
process.env.RIDE_QUOTE_SECRET = "test-ride-quote-secret";
process.env.ADMIN_API_TOKEN = "test-admin-token";
process.env.ADMIN_SESSION_SECRET = "test-admin-session-secret";
process.env.ADMIN_EMAIL = "owner@harvey.example";

const crypto = require("crypto");
const http = require("http");
const request = require("supertest");
const { createFakeSupabase } = require("./fakeSupabase");

let mockClient;
const mockProxy = new Proxy({}, { get: (_t, prop) => (typeof mockClient[prop] === "function" ? mockClient[prop].bind(mockClient) : mockClient[prop]) });
jest.mock("@supabase/supabase-js", () => ({ createClient: () => mockProxy }));

function session(email) {
  const now = Date.now();
  const encoded = Buffer.from(JSON.stringify({ sub: "htaf-admin", email, iat: now, exp: now + 3_600_000 })).toString("base64url");
  const sig = crypto.createHmac("sha256", process.env.ADMIN_SESSION_SECRET).update(encoded).digest("hex");
  return [`htaf_admin_session=${encoded}.${sig}`];
}

// Stand-in membrane: deterministic 384-dim vectors from word hashes.
const seen = { auth: [], inputs: 0 };
function vec(text) {
  const v = new Array(384).fill(0);
  for (const w of String(text).toLowerCase().match(/[a-z]+/g) || []) v[crypto.createHash("md5").update(w).digest()[0] % 384] += 1;
  if (!v.some(Boolean)) v[0] = 1;
  return v;
}
const membrane = http.createServer((req, res) => {
  if (req.method === "GET" && req.url === "/v1/health") return res.end(JSON.stringify({ ok: true, dims: 384, model: "stand-in" }));
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    seen.auth.push(req.headers.authorization);
    const { input } = JSON.parse(body);
    seen.inputs += input.length;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ data: input.map((t, index) => ({ index, embedding: vec(t) })) }));
  });
});

let app;
beforeAll(async () => {
  await new Promise((r) => membrane.listen(0, "127.0.0.1", r));
  process.env.MEMBRANE_BASE_URL = `http://127.0.0.1:${membrane.address().port}/v1`;
  process.env.MEMBRANE_EMBED_MODEL = "stand-in";
  process.env.MEMBRANE_API_KEY = "shared-test-key";
  process.env.MEMBRANE_QUERY_PREFIX = "query: ";
  process.env.MEMBRANE_PASSAGE_PREFIX = "passage: ";
  mockClient = createFakeSupabase({ admin_roles: [{ email: "dispatch@harvey.example", role: "dispatcher" }], admin_rbac_shadow_log: [], audit_logs: [], system_flags: [] });
  ({ app } = require("../server"));
});
afterAll(() => membrane.close());

test("refused without sign-in and for non-owner admins", async () => {
  expect((await request(app).get("/api/admin/membrane/calibration")).status).toBe(401);
  expect((await request(app).get("/api/admin/membrane/calibration").set("Cookie", session("dispatch@harvey.example"))).status).toBe(403);
  expect(seen.inputs).toBe(0);
});

test("owner: config without the key, membrane health, and a calibration report; nothing written", async () => {
  const res = await request(app).get("/api/admin/membrane/calibration").set("Cookie", session("owner@harvey.example"));
  expect(res.status).toBe(200);
  expect(JSON.stringify(res.body)).not.toMatch(/shared-test-key/);
  expect(res.body.config).toMatchObject({ configured: true, api_key_set: true, dims: 384 });
  expect(res.body.health).toMatchObject({ status: 200, ok: true, dims: 384 });
  const c = res.body.calibration;
  expect(c.passages.harvey_taxi).toBeGreaterThan(10);
  expect(c.passages.htaf).toBeGreaterThan(10);
  expect(c.answerable).toBe(15);
  expect(c.table).toHaveLength(19);
  expect(typeof c.separable).toBe("boolean");
  if (!c.separable) expect(c.suggested_min_similarity).toBeNull();
  // The membrane got the shared key and every passage plus every question.
  expect(seen.auth.every((a) => a === "Bearer shared-test-key")).toBe(true);
  expect(seen.inputs).toBeGreaterThanOrEqual(c.passages.harvey_taxi + c.passages.htaf + 19);
  const writes = mockClient._log.filter((e) => ["insert", "update", "upsert", "delete"].includes(e.op) && !["audit_logs", "admin_rbac_shadow_log"].includes(e.table));
  expect(writes).toEqual([]);
});

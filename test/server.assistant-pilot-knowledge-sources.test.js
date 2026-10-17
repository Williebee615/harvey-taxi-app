// The assistant pilot's Harvey Taxi corpus includes the merchant
// application page and admin-approved articles (public on /policies.html),
// and follows approvals, edits and retirements. Fixture data only.
process.env.NODE_ENV = "test";
process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.RIDER_SESSION_SECRET = "test-rider-session-secret";
process.env.DRIVER_SESSION_SECRET = "test-driver-session-secret";
process.env.RIDE_QUOTE_SECRET = "test-ride-quote-secret";
process.env.ADMIN_API_TOKEN = "test-admin-token";
process.env.ASSISTANT_PILOT_PER_MINUTE = "1000";
delete process.env.ANTHROPIC_API_KEY;

const request = require("supertest");
const { createFakeSupabase } = require("./fakeSupabase");

let mockClient;
const mockProxy = new Proxy({}, { get: (_t, prop) => (typeof mockClient[prop] === "function" ? mockClient[prop].bind(mockClient) : mockClient[prop]) });
jest.mock("@supabase/supabase-js", () => ({ createClient: () => mockProxy }));

const ARTICLE = {
  id: 1,
  slug: "test-lost-items",
  title: "TEST Lost and found",
  body: "TEST fixture: report a lost umbrella within 72 hours through support; the zebra desk returns found items.",
  audience: ["rider", "driver"],
  status: "approved",
  version: 1,
  approved_at: "2026-10-17T00:00:00Z"
};

let app;
let hooks;
beforeAll(() => {
  mockClient = createFakeSupabase({ system_flags: [{ key: "assistant_pilot_harvey_taxi_enabled", value: "true" }], knowledge_articles: [{ ...ARTICLE }], audit_logs: [] });
  // eslint-disable-next-line global-require
  ({ app, __assistantPilot: hooks } = require("../server"));
});
beforeEach(() => hooks.reset());

const ask = (message) => request(app).post("/api/assistant/pilot/chat").set("Host", "harveytaxiservice.com").send({ message });
// The approved articles load in the background; the second ask sees them.
async function askSettled(message) {
  await ask(message);
  await new Promise((r) => setTimeout(r, 50));
  return ask(message);
}
const urls = (res) => (res.body.sources || []).map((s) => s.url);

test("answers merchant questions from the merchant application page", async () => {
  const res = await ask("What is the merchant commission?");
  expect(res.status).toBe(200);
  expect(urls(res)[0]).toBe("https://harveytaxiservice.com/merchant-apply.html");
});

test("quotes an admin-approved article, linked to /policies.html", async () => {
  const res = await askSettled("How do I report a lost umbrella to the zebra desk?");
  expect(res.status).toBe(200);
  expect(urls(res)).toContain("https://harveytaxiservice.com/policies.html#test-lost-items");
});

test("an article retired by an admin is no longer quoted", async () => {
  const retire = await request(app).post("/api/admin/knowledge/1/retire").set("x-admin-token", "test-admin-token").send({});
  expect(retire.status).toBe(200);
  const res = await ask("How do I report a lost umbrella to the zebra desk?");
  expect(urls(res)).not.toContain("https://harveytaxiservice.com/policies.html#test-lost-items");
});

test("the vector index is built from the same corpus, approved articles included, and rebuilt after a change", async () => {
  process.env.MEMBRANE_MIN_SIMILARITY = "0.5";
  mockClient = createFakeSupabase({
    system_flags: [
      { key: "assistant_pilot_harvey_taxi_enabled", value: "true" },
      { key: "assistant_pilot_harvey_taxi_vectors_enabled", value: "true" }
    ],
    knowledge_articles: [{ ...ARTICLE, id: 2, slug: "test-vector-article", status: "draft", approved_at: null }],
    audit_logs: []
  });
  const embedded = [];
  hooks.setEmbedder({
    model: "test-embedder",
    async embed(texts, { kind } = {}) {
      if (kind !== "query") embedded.push(...texts);
      return texts.map(() => Float32Array.from([1, 0]));
    }
  });
  // Load the approved articles, then let the index build.
  const approve = await request(app).post("/api/admin/knowledge/2/approve").set("x-admin-token", "test-admin-token").send({ version: 1 });
  expect(approve.status).toBe(200);
  await askSettled("What is the merchant commission?");
  expect(await hooks.vectorIndexReady("harvey_taxi")).toBe(true);
  expect(embedded.some((t) => t.includes("zebra desk"))).toBe(true);
  expect(embedded.some((t) => t.includes("12% of the item subtotal"))).toBe(true);

  embedded.length = 0;
  await request(app).post("/api/admin/knowledge/2/retire").set("x-admin-token", "test-admin-token").send({});
  await ask("What is the merchant commission?");
  expect(await hooks.vectorIndexReady("harvey_taxi")).toBe(true);
  expect(embedded.length).toBeGreaterThan(0);
  expect(embedded.some((t) => t.includes("zebra desk"))).toBe(false);
  delete process.env.MEMBRANE_MIN_SIMILARITY;
});

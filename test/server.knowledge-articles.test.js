// Admin-managed knowledge (docs/ai-knowledge.md, phase 2): admins create
// drafts; only approved articles are public and quoted by the assistant;
// any edit returns an article to draft; approval must name the reviewed
// version; retired articles stop being used; every change is audited.
//
// The article below is a test fixture, not a Harvey Taxi policy.
process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.RIDER_SESSION_SECRET = "test-rider-session-secret";
process.env.DRIVER_SESSION_SECRET = "test-driver-session-secret";
process.env.RIDE_QUOTE_SECRET = "test-ride-quote-secret";
process.env.ADMIN_API_TOKEN = "test-admin-token";
process.env.NODE_ENV = "test";
delete process.env.AGENT_LLM_BASE_URL;

const request = require("supertest");
const { createFakeSupabase } = require("./fakeSupabase");
const { signTestDriverToken, driverAuthHeaders, makeRider, makeDriver } = require("./rideTestHelpers");

let currentFake;
let mockSupabaseClient;
jest.mock("@supabase/supabase-js", () => ({ createClient: () => mockSupabaseClient }));
mockSupabaseClient = new Proxy(
  {},
  {
    get(_target, prop) {
      const value = currentFake[prop];
      return typeof value === "function" ? value.bind(currentFake) : value;
    }
  }
);

const ADMIN = { "x-admin-token": process.env.ADMIN_API_TOKEN };
const FIXTURE = {
  slug: "test-umbrella-loans",
  title: "Umbrella loans (test fixture)",
  body: "Test fixture wording: riders may borrow a spare umbrella from the driver and hand it back at drop-off.",
  audience: ["rider"]
};

currentFake = createFakeSupabase(
  {
    riders: [makeRider()],
    drivers: [makeDriver()],
    rides: [],
    audit_logs: [],
    knowledge_articles: [],
    system_flags: [
      { key: "agent_assist_enabled", value: "true" },
      { key: "agent_kill_switch", value: "false" }
    ]
  },
  { identity: { knowledge_articles: "id" }, uniqueColumns: { knowledge_articles: ["slug"] } }
);

let app;
beforeAll(() => {
  // eslint-disable-next-line global-require
  ({ app } = require("../server"));
});

const riderAsk = (message) => request(app).post("/api/agent/rider/assist").send({ message });
const driverAsk = (message) =>
  request(app).post("/api/agent/driver/assist").set(driverAuthHeaders(signTestDriverToken("DRIVER_1"))).send({ message, client: "driver_app" });
const publicArticles = async () => (await request(app).get("/api/knowledge/articles")).body.articles;
const audits = (action) => currentFake._state.audit_logs.filter((a) => a.action === action);
const QUESTION = "Can I borrow an umbrella?";

let id;

test("admin routes require admin credentials", async () => {
  expect((await request(app).get("/api/admin/knowledge")).status).toBe(401);
  expect((await request(app).post("/api/admin/knowledge").send(FIXTURE)).status).toBe(401);
  expect((await request(app).post("/api/admin/knowledge/1/approve").set(driverAuthHeaders(signTestDriverToken("DRIVER_1"))).send({ version: 1 })).status).toBe(401);
});

test("invalid articles are refused with reasons", async () => {
  const res = await request(app).post("/api/admin/knowledge").set(ADMIN).send({ slug: "Bad Slug", title: "x", body: "short", audience: ["admin"] });
  expect(res.status).toBe(400);
  expect(res.body.errors).toHaveLength(4);
});

test("a new article is a draft: not public and not quoted", async () => {
  const res = await request(app).post("/api/admin/knowledge").set(ADMIN).send(FIXTURE);
  expect(res.status).toBe(201);
  id = res.body.article.id;
  expect(res.body.article).toMatchObject({ slug: FIXTURE.slug, status: "draft", version: 1, approved_at: null });
  expect(audits("knowledge.article_created")).toHaveLength(1);
  expect(await publicArticles()).toEqual([]);
  const answer = await riderAsk(QUESTION);
  expect(answer.body.reply).not.toMatch(/umbrella/i);
});

test("duplicate slugs are refused", async () => {
  const res = await request(app).post("/api/admin/knowledge").set(ADMIN).send(FIXTURE);
  expect(res.status).toBe(409);
});

test("approval must name the reviewed version", async () => {
  expect((await request(app).post(`/api/admin/knowledge/${id}/approve`).set(ADMIN).send({})).status).toBe(409);
  expect((await request(app).post(`/api/admin/knowledge/${id}/approve`).set(ADMIN).send({ version: 2 })).status).toBe(409);
  expect((await request(app).post("/api/admin/knowledge/abc/approve").set(ADMIN).send({ version: 1 })).status).toBe(404);
});

test("once approved: public, quoted with a /policies.html source, for its audience only", async () => {
  const res = await request(app).post(`/api/admin/knowledge/${id}/approve`).set(ADMIN).send({ version: 1 });
  expect(res.status).toBe(200);
  expect(res.body.article).toMatchObject({ status: "approved", approved_by: expect.any(String) });
  expect(audits("knowledge.article_approved")).toHaveLength(1);

  expect((await publicArticles()).map((a) => a.slug)).toEqual([FIXTURE.slug]);

  const answer = await riderAsk(QUESTION);
  expect(answer.status).toBe(200);
  expect(answer.body.reply).toContain("borrow a spare umbrella");
  expect(answer.body.sources[0]).toMatchObject({ url: `/policies.html#${FIXTURE.slug}`, section: FIXTURE.title });

  // Rider-only: not shown to drivers.
  const driver = await driverAsk(QUESTION);
  expect(driver.body.reply).not.toMatch(/umbrella/i);
});

test("editing an approved article returns it to draft and stops the assistant using it", async () => {
  const res = await request(app).patch(`/api/admin/knowledge/${id}`).set(ADMIN).send({ body: `${FIXTURE.body} Edited.` });
  expect(res.status).toBe(200);
  expect(res.body.article).toMatchObject({ status: "draft", version: 2, approved_at: null, approved_by: null, slug: FIXTURE.slug });
  expect(audits("knowledge.article_edited")[0].metadata).toMatchObject({ was_approved: true, version: 2 });
  expect(await publicArticles()).toEqual([]);
  expect((await riderAsk(QUESTION)).body.reply).not.toMatch(/umbrella/i);
  // The old version number no longer approves it.
  expect((await request(app).post(`/api/admin/knowledge/${id}/approve`).set(ADMIN).send({ version: 1 })).status).toBe(409);
});

test("retired articles are kept, never used, and can't be edited or approved", async () => {
  expect((await request(app).post(`/api/admin/knowledge/${id}/approve`).set(ADMIN).send({ version: 2 })).status).toBe(200);
  expect(await publicArticles()).toHaveLength(1);
  const res = await request(app).post(`/api/admin/knowledge/${id}/retire`).set(ADMIN).send({});
  expect(res.status).toBe(200);
  expect(res.body.article.status).toBe("retired");
  expect(await publicArticles()).toEqual([]);
  expect((await riderAsk(QUESTION)).body.reply).not.toMatch(/umbrella/i);
  expect((await request(app).patch(`/api/admin/knowledge/${id}`).set(ADMIN).send({ title: "New title" })).status).toBe(409);
  expect((await request(app).post(`/api/admin/knowledge/${id}/approve`).set(ADMIN).send({ version: 2 })).status).toBe(409);
  const list = await request(app).get("/api/admin/knowledge").set(ADMIN);
  expect(list.body.articles).toHaveLength(1);
  expect(list.body.index).toMatchObject({ approved_articles: 0, last_error: null });
});

test("published pages still answer while no articles are approved", async () => {
  const res = await riderAsk("How long do you keep my data?");
  expect(res.body.source).toBe("knowledge");
  expect(res.body.sources[0].url).toMatch(/^\/privacy-policy\.html/);
});

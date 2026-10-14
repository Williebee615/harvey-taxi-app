// Assistant pilot route: off by default; organization from the host;
// cross-organization requests refused; model only behind two switches;
// streaming; budget exhaustion; topic-only gap logging; nothing else
// stored. Synthetic requests only; the provider is a fake.

process.env.NODE_ENV = "test";
process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.RIDER_SESSION_SECRET = "test-rider-session-secret";
process.env.DRIVER_SESSION_SECRET = "test-driver-session-secret";
process.env.RIDE_QUOTE_SECRET = "test-ride-quote-secret";
process.env.ADMIN_API_TOKEN = "test-admin-token";
delete process.env.ASSISTANT_PILOT_MODEL_APPROVED;
process.env.ASSISTANT_PILOT_PER_MINUTE = "1000";

const request = require("supertest");
const { createFakeSupabase } = require("./fakeSupabase");

let mockClient;
const mockProxy = new Proxy({}, { get: (_t, prop) => (typeof mockClient[prop] === "function" ? mockClient[prop].bind(mockClient) : mockClient[prop]) });
jest.mock("@supabase/supabase-js", () => ({ createClient: () => mockProxy }));

const HTAF_HOST = "harveytransportationfoundation.com";
const HARVEY_HOST = "harveytaxiservice.com";

let app;
let hooks;
beforeAll(() => {
  mockClient = createFakeSupabase({});
  // eslint-disable-next-line global-require
  ({ app, __assistantPilot: hooks } = require("../server"));
});

const flags = (pairs) => Object.entries(pairs).map(([key, value]) => ({ key, value }));
function seed(flagPairs = {}, { reserve = 1 } = {}) {
  mockClient = createFakeSupabase(
    { system_flags: flags(flagPairs), audit_logs: [], htaf_assistant_questions: [], agent_model_usage: [] },
    {
      rpc: {
        agent_model_reserve: () => ({ data: reserve, error: null }),
        agent_model_settle: () => ({ data: true, error: null }),
        agent_model_month_totals: () => ({ data: [{ committed_usd: 0, held_usd: 0 }], error: null })
      }
    }
  );
}

function fakeProvider(chunks) {
  const calls = [];
  return {
    calls,
    name: "fake",
    model: "claude-haiku-4-5",
    async stream({ system, messages, onText }) {
      calls.push({ system, messages });
      for (const c of chunks) onText(c);
      return { text: chunks.join(""), usage: { input_tokens: 900, output_tokens: 40 } };
    },
    classify: () => "unknown"
  };
}

const ask = (host, body, accept) => {
  const r = request(app).post("/api/assistant/pilot/chat").set("Host", host);
  return (accept ? r.set("Accept", accept) : r).send(body);
};

beforeEach(() => {
  hooks.reset();
  delete process.env.ASSISTANT_PILOT_MODEL_APPROVED;
});

test("off by default for both organizations", async () => {
  seed();
  expect((await ask(HARVEY_HOST, { message: "How do I contact support?" })).status).toBe(404);
  expect((await ask(HTAF_HOST, { message: "How do I apply?" })).status).toBe(404);
});

test("enabling one organization does not enable the other", async () => {
  seed({ assistant_pilot_htaf_enabled: "true" });
  expect((await ask(HTAF_HOST, { message: "How do I apply?" })).status).toBe(200);
  expect((await ask(HARVEY_HOST, { message: "How do I contact support?" })).status).toBe(404);
});

test("the host decides the organization; naming the other organization is refused", async () => {
  seed({ assistant_pilot_htaf_enabled: "true", assistant_pilot_harvey_taxi_enabled: "true" });
  expect((await ask(HARVEY_HOST, { message: "How do I apply?", org: "htaf" })).status).toBe(403);
  expect((await ask(HTAF_HOST, { message: "support email", org: "harvey_taxi" })).status).toBe(403);
  const htaf = await ask(HTAF_HOST, { message: "How do I apply?" });
  expect(htaf.body.org).toBe("htaf");
  expect(htaf.body.sources.every((s) => s.url.startsWith("https://harveytransportationfoundation.com"))).toBe(true);
  const harvey = await ask(HARVEY_HOST, { message: "How do I contact support?" });
  expect(harvey.body.org).toBe("harvey_taxi");
  expect(harvey.body.sources.every((s) => s.url.startsWith("https://harveytaxiservice.com"))).toBe(true);
});

test("answers from published pages with citations and follow-ups; no external call without both model switches", async () => {
  seed({ assistant_pilot_htaf_enabled: "true", assistant_pilot_htaf_model_enabled: "true" });
  const provider = fakeProvider(["x"]);
  hooks.setProvider(provider);
  const res = await ask(HTAF_HOST, { message: "Is HTAF a 501(c)(3)?" });
  expect(res.status).toBe(200);
  expect(res.body.mode).toBe("extractive");
  expect(res.body.reply).toMatch(/501\(c\)\(3\)/);
  expect(res.body.sources[0]).toMatchObject({ ref: "S1", url: expect.stringContaining("harveytransportationfoundation.com"), version: expect.stringMatching(/^[0-9a-f]{12}$/) });
  expect(res.body.followups.length).toBeGreaterThan(0);
  // Model flag on but no server approval (ASSISTANT_PILOT_MODEL_APPROVED): nothing sent.
  expect(provider.calls).toHaveLength(0);
});

test("streams over SSE when the model is approved and enabled", async () => {
  seed({ assistant_pilot_htaf_enabled: "true", assistant_pilot_htaf_model_enabled: "true" });
  process.env.ASSISTANT_PILOT_MODEL_APPROVED = "true";
  const provider = fakeProvider(["HTAF is a 501(c)(3) ", "public charity [S1]."]);
  hooks.setProvider(provider);
  const res = await ask(HTAF_HOST, { message: "Is HTAF a 501(c)(3)?" }, "text/event-stream");
  expect(res.status).toBe(200);
  expect(res.headers["content-type"]).toMatch(/text\/event-stream/);
  const events = res.text.split("\n\n").filter(Boolean).map((block) => block.split("\n")[0].replace("event: ", ""));
  expect(events.filter((e) => e === "delta").length).toBeGreaterThanOrEqual(2);
  expect(events.slice(-1)[0]).toBe("done");
  expect(res.text).toMatch(/"mode":"model"/);
  expect(res.text).toMatch(/"ref":"S1"/);
  expect(provider.calls).toHaveLength(1);
});

test("budget exhausted: no provider call, extractive answer", async () => {
  seed({ assistant_pilot_htaf_enabled: "true", assistant_pilot_htaf_model_enabled: "true" }, { reserve: null });
  process.env.ASSISTANT_PILOT_MODEL_APPROVED = "true";
  const provider = fakeProvider(["x"]);
  hooks.setProvider(provider);
  const res = await ask(HTAF_HOST, { message: "Is HTAF a 501(c)(3)?" });
  expect(res.body.mode).toBe("extractive");
  expect(provider.calls).toHaveLength(0);
});

test("provider not configured: still answers extractively", async () => {
  seed({ assistant_pilot_htaf_enabled: "true", assistant_pilot_htaf_model_enabled: "true" });
  process.env.ASSISTANT_PILOT_MODEL_APPROVED = "true";
  hooks.setProvider(null);
  const res = await ask(HTAF_HOST, { message: "Is HTAF a 501(c)(3)?" });
  expect(res.body).toMatchObject({ mode: "extractive" });
  expect(res.body.sources.length).toBeGreaterThan(0);
});

test("unanswered questions: topic label only, per organization; no transcript stored anywhere", async () => {
  seed({ assistant_pilot_htaf_enabled: "true", assistant_pilot_harvey_taxi_enabled: "true" });
  const secret = "Can my cousin Jordan Pike ride a hovercraft to Memphis on Tuesday?";
  const a = await ask(HTAF_HOST, { message: secret, history: [{ role: "user", text: "PRIVATE-HISTORY-MARKER" }] });
  const b = await ask(HARVEY_HOST, { message: secret });
  expect(a.body.mode).toBe("unsupported");
  expect(b.body.mode).toBe("unsupported");
  await new Promise((r) => setTimeout(r, 20));
  expect(mockClient._state.htaf_assistant_questions).toEqual([expect.objectContaining({ question_excerpt: expect.stringMatching(/^Unanswered question about: /), intent: "htaf_assistant_pilot" })]);
  expect(mockClient._state.audit_logs.filter((r) => r.action === "assistant_pilot_gap")).toEqual([
    expect.objectContaining({ entity_id: "harvey_taxi", metadata: { org: "harvey_taxi", topic: expect.stringMatching(/^Unanswered question about: /) } })
  ]);
  const everything = JSON.stringify(mockClient._state);
  for (const v of ["Jordan", "Pike", "hovercraft", "PRIVATE-HISTORY-MARKER"]) expect(everything).not.toContain(v);
});

test("private records are refused before retrieval or model", async () => {
  seed({ assistant_pilot_htaf_enabled: "true", assistant_pilot_htaf_model_enabled: "true" });
  process.env.ASSISTANT_PILOT_MODEL_APPROVED = "true";
  const provider = fakeProvider(["x"]);
  hooks.setProvider(provider);
  const res = await ask(HTAF_HOST, { message: "What is the status of my application?" });
  expect(res.body).toMatchObject({ mode: "boundary", handoff: { href: "/contact.html" } });
  expect(provider.calls).toHaveLength(0);
});

test("rate limited per visitor (default 10 per minute)", async () => {
  process.env.ASSISTANT_PILOT_PER_MINUTE = "";
  let limitedApp;
  jest.isolateModules(() => {
    // eslint-disable-next-line global-require
    ({ app: limitedApp } = require("../server"));
  });
  process.env.ASSISTANT_PILOT_PER_MINUTE = "1000";
  seed({ assistant_pilot_htaf_enabled: "true" });
  const statuses = [];
  for (let i = 0; i < 11; i++) {
    statuses.push((await request(limitedApp).post("/api/assistant/pilot/chat").set("Host", HTAF_HOST).send({ message: "How do I apply?" })).status);
  }
  expect(statuses.slice(0, 10).every((s) => s === 200)).toBe(true);
  expect(statuses[10]).toBe(429);
});

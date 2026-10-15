// Assistant pilot with vector retrieval through the membrane (Harvey
// Taxi's own model service): off unless the organization's vectors flag is
// on AND a similarity threshold is set; never blocks a turn while the index
// builds; falls back to keyword retrieval when the membrane fails; the
// embedder is a local test double, so nothing leaves the machine.

process.env.NODE_ENV = "test";
process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.RIDER_SESSION_SECRET = "test-rider-session-secret";
process.env.DRIVER_SESSION_SECRET = "test-driver-session-secret";
process.env.RIDE_QUOTE_SECRET = "test-ride-quote-secret";
process.env.ADMIN_API_TOKEN = "test-admin-token";
process.env.ASSISTANT_PILOT_PER_MINUTE = "1000";
delete process.env.ASSISTANT_PILOT_MODEL_APPROVED;
delete process.env.MEMBRANE_BASE_URL;
delete process.env.MEMBRANE_VECTOR_STORE;

const http = require("http");
const https = require("https");
const request = require("supertest");
const { createFakeSupabase } = require("./fakeSupabase");
const { buildOrgCorpus } = require("../lib/assistantPilot/corpus");

let mockClient;
const mockProxy = new Proxy({}, { get: (_t, prop) => (typeof mockClient[prop] === "function" ? mockClient[prop].bind(mockClient) : mockClient[prop]) });
jest.mock("@supabase/supabase-js", () => ({ createClient: () => mockProxy }));

const HTAF_HOST = "harveytransportationfoundation.com";
const sec = (source_id, heading, text) => ({ source_id, title: `${source_id} page`, heading, text, url: `/${source_id}.html`, updated: null });
const corpus = () =>
  buildOrgCorpus("htaf", {
    sections: [
      sec("htaf-apply", "How to Apply", "To apply for HTAF transportation assistance, submit the online application form."),
      sec("htaf-review", "Review Timeline", "HTAF aims to review applications within five business days.")
    ]
  });

const CONCEPTS = [["long", "days", "week", "timeline", "wait"], ["apply", "application", "form", "submit"]];
function embedder({ fail = false } = {}) {
  const calls = [];
  return {
    calls,
    model: "test-concepts",
    async embed(texts, { kind } = {}) {
      calls.push(kind);
      if (fail) throw Object.assign(new Error("down"), { code: "network" });
      return texts.map((t) => {
        const w = String(t).toLowerCase().match(/[a-z]+/g) || [];
        const v = CONCEPTS.map((g) => w.filter((x) => g.includes(x)).length);
        const n = Math.hypot(...v) || 1;
        return Float32Array.from(v, (x) => x / n);
      });
    }
  };
}

let app;
let hooks;
let outbound;
beforeAll(() => {
  mockClient = createFakeSupabase({});
  ({ app, __assistantPilot: hooks } = require("../server"));
});
const isLocal = (h) => /^(127\.0\.0\.1|localhost|::1|\[::1\])$/.test(String(h || ""));
beforeEach(() => {
  hooks.reset();
  process.env.MEMBRANE_MIN_SIMILARITY = "0.5";
  outbound = [];
  for (const mod of [http, https]) {
    const original = mod.request;
    jest.spyOn(mod, "request").mockImplementation(function (...args) {
      const first = args[0];
      const host = typeof first === "string" || first instanceof URL ? new URL(String(first)).hostname : first && (first.hostname || first.host);
      if (!isLocal(host)) outbound.push(String(host));
      return original.apply(this, args);
    });
  }
});
afterEach(() => jest.restoreAllMocks());

function seed(flagPairs) {
  mockClient = createFakeSupabase({ system_flags: Object.entries(flagPairs).map(([key, value]) => ({ key, value })), audit_logs: [], htaf_assistant_questions: [] });
}
const ask = (message) => request(app).post("/api/assistant/pilot/chat").set("Host", HTAF_HOST).send({ message });
const PARAPHRASE = "how long does it take?";

test("vectors flag off: the embedder is never called and the paraphrase stays unanswered", async () => {
  seed({ assistant_pilot_htaf_enabled: "true" });
  const e = embedder();
  hooks.setCorpus("htaf", corpus());
  hooks.setEmbedder(e);
  const res = await ask(PARAPHRASE);
  expect(res.body).toMatchObject({ mode: "unsupported", uncertain: true });
  expect(e.calls).toEqual([]);
});

test("vectors on but no calibrated threshold: keyword only", async () => {
  delete process.env.MEMBRANE_MIN_SIMILARITY;
  seed({ assistant_pilot_htaf_enabled: "true", assistant_pilot_htaf_vectors_enabled: "true" });
  const e = embedder();
  hooks.setCorpus("htaf", corpus());
  hooks.setEmbedder(e);
  expect((await ask(PARAPHRASE)).body.mode).toBe("unsupported");
  expect(e.calls).toEqual([]);
});

test("vectors on: the first turn doesn't wait for the index; once built, the paraphrase is answered with its source", async () => {
  seed({ assistant_pilot_htaf_enabled: "true", assistant_pilot_htaf_vectors_enabled: "true" });
  hooks.setCorpus("htaf", corpus());
  hooks.setEmbedder(embedder());
  expect((await ask(PARAPHRASE)).body.mode).toBe("unsupported");
  expect(await hooks.vectorIndexReady("htaf")).toBe(true);
  const res = await ask(PARAPHRASE);
  expect(res.body).toMatchObject({ mode: "extractive", uncertain: false });
  expect(res.body.reply).toMatch(/five business days/);
  expect(res.body.sources[0].section).toBe("Review Timeline");
  expect(outbound).toEqual([]);
});

test("membrane down: answers exactly as keyword retrieval would, and the index is retried later, not per request", async () => {
  seed({ assistant_pilot_htaf_enabled: "true", assistant_pilot_htaf_vectors_enabled: "true" });
  const e = embedder({ fail: true });
  hooks.setCorpus("htaf", corpus());
  hooks.setEmbedder(e);
  expect((await ask("How do I apply?")).body.mode).toBe("extractive");
  expect(await hooks.vectorIndexReady("htaf")).toBe(false);
  const before = e.calls.length;
  const res = await ask("How do I apply?");
  expect(res.body.mode).toBe("extractive");
  expect(e.calls.length).toBe(before);
});

// Hybrid (keyword + vector) retrieval for the assistant pilot. The
// embedder here is a deterministic test double that maps words to a few
// concepts; it proves the pipeline (fusion, thresholds, organization
// separation, stale versions, fallback), not a real model's quality. Real
// quality is measured by scripts/assistant-pilot-eval.js against the
// membrane once one is running.

const { buildOrgCorpus } = require("./corpus");
const { retrieve, retrieveHybrid } = require("./retrieval");
const { buildMemoryStore, pgvectorStore, fuseRankings } = require("./vectors");
const { runTurn } = require("./orchestrator");

const TODAY = "2026-10-14";
const sec = (source_id, heading, text) => ({ source_id, title: `${source_id} page`, heading, text, url: `/${source_id}.html`, updated: null });
const HTAF = [
  sec("htaf-apply", "How to Apply", "To apply for HTAF transportation assistance, submit the online application form with your appointment details and destination address."),
  sec("htaf-review", "Review Timeline", "HTAF aims to review applications within five business days. Staff may contact you for more information."),
  sec("htaf-programs", "Programs", "HTAF programs cover medical transportation, employment access and education access in Tennessee.")
];
const HARVEY = [sec("support", "Contact Harvey Taxi", "Riders can reach the Harvey Taxi support team by email.")];

const CONCEPTS = [
  ["long", "days", "week", "timeline", "wait", "soon", "quickly"],
  ["apply", "application", "form", "submit", "sign"],
  ["programs", "medical", "employment", "education", "cover"],
  ["support", "contact", "email", "reach", "help"],
  ["weather", "rain", "football", "pizza"]
];
function conceptEmbedder({ fail = false, calls = [] } = {}) {
  return {
    id: "test:concepts",
    model: "test-concepts",
    dims: CONCEPTS.length,
    async embed(texts, { kind } = {}) {
      calls.push({ kind, n: texts.length });
      if (fail) throw Object.assign(new Error("embedding_unavailable:network"), { code: "network" });
      return texts.map((t) => {
        const words = String(t).toLowerCase().match(/[a-z]+/g) || [];
        const v = CONCEPTS.map((group) => words.filter((w) => group.includes(w)).length);
        const n = Math.hypot(...v) || 1;
        return Float32Array.from(v, (x) => x / n);
      });
    }
  };
}

const htaf = () => buildOrgCorpus("htaf", { sections: HTAF, today: TODAY });
const VISITOR = { org: "htaf", role: "visitor" };

describe("hybrid retrieval through the membrane", () => {
  test("a paraphrase keyword search can't find is found by vectors", async () => {
    const corpus = htaf();
    const embedder = conceptEmbedder();
    const store = await buildMemoryStore({ corpus, embedder });
    expect(retrieve({ corpus, viewer: VISITOR, query: "how long does it take?" }).passages).toEqual([]);
    const out = await retrieveHybrid({ corpus, viewer: VISITOR, query: "how long does it take?", vectors: { store, embedder, minSimilarity: 0.5 } });
    expect(out.retrieval).toBe("hybrid");
    expect(out.passages[0].heading).toBe("Review Timeline");
  });

  test("an unrelated question stays unanswered: vector hits below the threshold are dropped", async () => {
    const corpus = htaf();
    const embedder = conceptEmbedder();
    const store = await buildMemoryStore({ corpus, embedder });
    const out = await retrieveHybrid({ corpus, viewer: VISITOR, query: "who won the football game?", vectors: { store, embedder, minSimilarity: 0.5 } });
    expect(out.passages).toEqual([]);
  });

  test("keyword matches and vector matches are fused", () => {
    expect(fuseRankings([["a", "b"], ["b", "c"]])).toEqual(["b", "a", "c"]);
  });

  test("another organization's store is never used", async () => {
    const harveyCorpus = buildOrgCorpus("harvey_taxi", { sections: HARVEY, today: TODAY });
    const embedder = conceptEmbedder();
    const wrongStore = await buildMemoryStore({ corpus: harveyCorpus, embedder });
    const out = await retrieveHybrid({ corpus: htaf(), viewer: VISITOR, query: "how can I reach support?", vectors: { store: wrongStore, embedder, minSimilarity: 0.1 } });
    expect(out.retrieval).toBe("keyword");
    expect(out.passages.every((p) => p.org === "htaf")).toBe(true);
  });

  test("a store that returns another organization's or a stale passage is filtered out", async () => {
    const corpus = htaf();
    const embedder = conceptEmbedder();
    const rogue = { org: "htaf", async search() { return [{ id: "harvey_taxi:support:0", version: "x", score: 0.99 }, { id: corpus.passages[1].id, version: "stale", score: 0.99 }]; } };
    const out = await retrieveHybrid({ corpus, viewer: VISITOR, query: "how long does it take?", vectors: { store: rogue, embedder, minSimilarity: 0.1 } });
    expect(out.passages).toEqual([]);
  });

  test("membrane down: falls back to keyword retrieval, same answers as before", async () => {
    const corpus = htaf();
    const store = await buildMemoryStore({ corpus, embedder: conceptEmbedder() });
    const out = await retrieveHybrid({ corpus, viewer: VISITOR, query: "How do I apply?", vectors: { store, embedder: conceptEmbedder({ fail: true }), minSimilarity: 0.5 } });
    expect(out.retrieval).toBe("keyword_fallback");
    expect(out.passages.map((p) => p.heading)).toEqual(retrieve({ corpus, viewer: VISITOR, query: "How do I apply?" }).passages.map((p) => p.heading));
  });

  test("a turn answers the paraphrase from published text, with its source, and says how it was found", async () => {
    const corpus = htaf();
    const embedder = conceptEmbedder();
    const store = await buildMemoryStore({ corpus, embedder });
    const events = [];
    const result = await runTurn({ viewer: VISITOR, message: "how long does it take?", history: [], deps: { corpus, vectors: { store, embedder, minSimilarity: 0.5 } }, emit: (type, data) => events.push({ type, ...data }) });
    expect(result).toMatchObject({ mode: "extractive", retrieval: "hybrid" });
    const text = events.filter((e) => e.type === "delta").map((e) => e.text).join("");
    expect(text).toMatch(/five business days/);
    expect(events.find((e) => e.type === "sources").items[0].section).toBe("Review Timeline");
  });

  test("the pgvector store passes organization and model to the database and maps rows", async () => {
    const calls = [];
    const store = pgvectorStore({ org: "htaf", model: "e5", rpc: async (name, args) => (calls.push({ name, args }), [{ passage_id: "htaf:x:0", version: "v1", similarity: "0.83" }]) });
    expect(await store.search(Float32Array.from([0.6, 0.8]), 4)).toEqual([{ id: "htaf:x:0", version: "v1", score: 0.83 }]);
    expect(calls[0]).toEqual({ name: "match_assistant_passages", args: { p_org: "htaf", p_model: "e5", p_query: "[0.6000000238418579,0.800000011920929]", p_limit: 4 } });
  });
});

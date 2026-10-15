// Assistant pilot: vector index over an organization's approved passages,
// embedded by the membrane (Harvey Taxi's own model service).
//
// One index per organization, built from that organization's corpus only;
// each entry carries the passage version it was embedded from, so an
// edited page is never matched on a stale vector. Two stores share one
// interface, search(queryVector, k) -> [{ id, score }]:
//   - memoryStore: vectors held in process (the pilot corpus is ~80
//     passages per organization, so a linear scan takes well under 1 ms);
//   - pgvectorStore: the assistant_passage_embeddings table (HNSW index),
//     filled by scripts/assistant-vector-sync.js, for larger corpora.

const RRF_K = 60;

function dot(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i += 1) s += a[i] * b[i];
  return s;
}

async function buildMemoryStore({ corpus, embedder, signal }) {
  const passages = corpus.passages;
  const vectors = await embedder.embed(passages.map((p) => `${p.title}. ${p.heading}\n${p.text}`), { kind: "passage", signal });
  const entries = passages.map((p, i) => ({ id: p.id, org: p.org, version: p.version, vector: vectors[i] }));
  return {
    kind: "memory",
    org: corpus.org,
    model: embedder.model,
    size: entries.length,
    async search(query, k) {
      return entries
        .map((e) => ({ id: e.id, version: e.version, score: dot(query, e.vector) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, k);
    }
  };
}

// rpc(name, args) -> rows; the database function filters by organization
// and model, so another organization's rows can't come back.
function pgvectorStore({ org, model, rpc }) {
  return {
    kind: "pgvector",
    org,
    model,
    async search(query, k) {
      const rows = await rpc("match_assistant_passages", { p_org: org, p_model: model, p_query: `[${Array.from(query).join(",")}]`, p_limit: k });
      return (rows || []).map((r) => ({ id: r.passage_id, version: r.version, score: Number(r.similarity) }));
    }
  };
}

// Reciprocal rank fusion of several ranked id lists.
function fuseRankings(lists, k = RRF_K) {
  const scores = new Map();
  for (const list of lists) {
    list.forEach((id, rank) => scores.set(id, (scores.get(id) || 0) + 1 / (k + rank + 1)));
  }
  return [...scores.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
}

module.exports = { RRF_K, dot, buildMemoryStore, pgvectorStore, fuseRankings };

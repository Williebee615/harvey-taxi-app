// Assistant pilot: retrieval with permission checks BEFORE anything can
// reach a model. A viewer may only search their own organization's index,
// and only passages whose visibility they are allowed to see. Results are
// re-checked after ranking (defence in depth), so a passage from another
// organization, a non-public passage or a superseded document can never
// be returned even if an index were built wrongly.

const { search, excerpt } = require("../knowledge/search");
const { retrievable } = require("./corpus");
const { fuseRankings } = require("./vectors");

// Pilot viewers are anonymous website visitors: public passages only.
const VISIBILITY_FOR_ROLE = Object.freeze({ visitor: Object.freeze(["public"]) });

function checkViewer(corpus, viewer) {
  if (!corpus || !viewer || corpus.org !== viewer.org) return { error: "forbidden_org" };
  const allowed = VISIBILITY_FOR_ROLE[viewer.role];
  if (!allowed) return { error: "forbidden_role" };
  return { allowed };
}

// Final, per-passage permission filter (defence in depth) and excerpt.
function finalize(list, { corpus, viewer, allowed, query, limit }) {
  const seen = new Set();
  return list
    .filter((p) => p && (seen.has(p.id) ? false : seen.add(p.id)))
    .slice(0, Math.min(limit, 6))
    .filter((p) => p.org === viewer.org && allowed.includes(p.visibility) && retrievable(p, corpus.today))
    .map((p) => ({ ...p, excerpt: excerpt(p, query) }));
}

function keywordRanked(corpus, q, limit) {
  const pinned = corpus.passages.filter((p) => p.match && p.match.test(q));
  const ranked = search(corpus.index, q, { role: "public", limit: Math.min(limit, 6) }).map((r) => r.section);
  return { pinned, ranked };
}

function retrieve({ corpus, viewer, query, limit = 4 }) {
  const check = checkViewer(corpus, viewer);
  if (check.error) return { ok: false, error: check.error, passages: [] };
  const q = String(query || "");
  const { pinned, ranked } = keywordRanked(corpus, q, limit);
  return { ok: true, retrieval: "keyword", passages: finalize([...pinned, ...ranked], { corpus, viewer, allowed: check.allowed, query, limit }) };
}

// Keyword + vector retrieval fused by reciprocal rank. vectors:
// { store, embedder, minSimilarity, signal }. The store must belong to the
// viewer's organization. Vector hits below minSimilarity are dropped, so an
// unrelated question still finds nothing rather than its nearest
// neighbour. Any embedding or store failure falls back to keyword results.
async function retrieveHybrid({ corpus, viewer, query, limit = 4, vectors }) {
  const check = checkViewer(corpus, viewer);
  if (check.error) return { ok: false, error: check.error, passages: [] };
  if (!vectors || !vectors.store || vectors.store.org !== viewer.org) return retrieve({ corpus, viewer, query, limit });
  const q = String(query || "");
  const { pinned, ranked } = keywordRanked(corpus, q, limit);
  let vectorIds = [];
  try {
    const [qv] = await vectors.embedder.embed([q], { kind: "query", signal: vectors.signal });
    const hits = await vectors.store.search(qv, 6);
    const byId = new Map(corpus.passages.map((p) => [p.id, p]));
    vectorIds = hits
      .filter((h) => h.score >= vectors.minSimilarity && byId.has(h.id) && byId.get(h.id).version === h.version)
      .map((h) => h.id);
  } catch {
    return { ...retrieve({ corpus, viewer, query, limit }), retrieval: "keyword_fallback" };
  }
  const byId = new Map(corpus.passages.map((p) => [p.id, p]));
  const fused = fuseRankings([ranked.map((p) => p.id), vectorIds]).map((id) => byId.get(id));
  return { ok: true, retrieval: vectorIds.length ? "hybrid" : "keyword", passages: finalize([...pinned, ...fused], { corpus, viewer, allowed: check.allowed, query, limit }) };
}

module.exports = { retrieve, retrieveHybrid, VISIBILITY_FOR_ROLE };

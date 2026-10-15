// Assistant pilot: retrieval with permission checks BEFORE anything can
// reach a model. A viewer may only search their own organization's index,
// and only passages whose visibility they are allowed to see. Results are
// re-checked after ranking (defence in depth), so a passage from another
// organization, a non-public passage or a superseded document can never
// be returned even if an index were built wrongly.

const { search, excerpt } = require("../knowledge/search");
const { retrievable } = require("./corpus");

// Pilot viewers are anonymous website visitors: public passages only.
const VISIBILITY_FOR_ROLE = Object.freeze({ visitor: Object.freeze(["public"]) });

function retrieve({ corpus, viewer, query, limit = 4 }) {
  if (!corpus || !viewer || corpus.org !== viewer.org) return { ok: false, error: "forbidden_org", passages: [] };
  const allowed = VISIBILITY_FOR_ROLE[viewer.role];
  if (!allowed) return { ok: false, error: "forbidden_role", passages: [] };
  const q = String(query || "");
  const pinned = corpus.passages.filter((p) => p.match && p.match.test(q));
  const ranked = search(corpus.index, q, { role: "public", limit: Math.min(limit, 6) }).map((r) => r.section);
  const seen = new Set();
  const passages = [...pinned, ...ranked]
    .filter((p) => (seen.has(p.id) ? false : seen.add(p.id)))
    .slice(0, Math.min(limit, 6))
    .filter((p) => p.org === viewer.org && allowed.includes(p.visibility) && retrievable(p, corpus.today))
    .map((p) => ({ ...p, excerpt: excerpt(p, query) }));
  return { ok: true, passages };
}

module.exports = { retrieve, VISIBILITY_FOR_ROLE };

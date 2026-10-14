// Assistant pilot: approved, public organizational knowledge with
// document metadata (organization, visibility, source URL, version,
// effective date, status). One separate index per organization; a passage
// can only ever be in its own organization's index.
//
// Pilot content: the pages each organization has already published (the
// same approved sources the rules-based assistants quote). Private
// records (applications, background checks, identity documents, payment
// details, live location) are never part of the corpus.

const crypto = require("crypto");
const { buildIndex, loadSources } = require("../knowledge/search");
const { SOURCES: HARVEY_SOURCES } = require("../knowledge/sources");
const { HTAF_SOURCES, loadHtafIndex } = require("../htafAssistant");

const VISIBILITY = Object.freeze(["public"]);
const SITE = Object.freeze({ harvey_taxi: "https://harveytaxiservice.com", htaf: "https://harveytransportationfoundation.com" });

const versionOf = (text) => crypto.createHash("sha256").update(String(text || "")).digest("hex").slice(0, 12);

function isoDate(value) {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : null;
}

// registry: { [source_id]: { status: "approved" | "superseded" | "draft", effective_from?: "YYYY-MM-DD" } }
// A source not in the registry is approved (it is a published page).
function retrievable(doc, today) {
  if (doc.status !== "approved") return false;
  if (doc.effective_from && doc.effective_from > today) return false;
  return VISIBILITY.includes(doc.visibility);
}

function passagesFor(org, sections, registry = {}) {
  return sections.map((s, i) => {
    const reg = registry[s.source_id] || {};
    return {
      id: `${org}:${s.source_id}:${i}`,
      org,
      visibility: "public",
      source_id: s.source_id,
      title: s.title,
      heading: s.heading,
      text: s.text,
      url: `${SITE[org]}${s.url || "/"}`,
      version: versionOf(`${s.heading}\n${s.text}`),
      effective_date: isoDate(s.updated),
      effective_from: reg.effective_from || null,
      status: reg.status || "approved",
      // Curated topics and approved answers carry their own question
      // pattern; retrieval puts a pattern match first.
      match: s.match instanceof RegExp ? s.match : null,
      // search.js filters on audience; every pilot passage is public.
      audience: ["public"]
    };
  });
}

// Builds { org, index, passages, loaded } with only retrievable passages
// in the index. `sectionsByOrg` can be injected in tests.
function buildOrgCorpus(org, { sections, registry = {}, today = new Date().toISOString().slice(0, 10) } = {}) {
  const all = passagesFor(org, sections, registry);
  const eligible = all.filter((p) => p.org === org && retrievable(p, today));
  return { org, index: buildIndex(eligible), passages: eligible, excluded: all.length - eligible.length, today };
}

function loadPublishedSections(org, opts = {}) {
  if (org === "htaf") {
    const { index } = loadHtafIndex(opts);
    const flatten = (pieces) => pieces.map((p) => (Array.isArray(p) ? p.join(": ") : String(p))).join("\n");
    const topics = (index.topics || []).map((t) => ({ source_id: `topic-${t.id}`, title: t.title, heading: t.section, text: flatten(t.pieces || []), url: t.url, updated: null, match: t.pattern }));
    const approved = (index.approved || []).map((a) => ({ source_id: `approved-${a.id}`, title: a.source.title, heading: a.source.section, text: a.answer, url: a.source.url, updated: null, match: a.pattern }));
    return [...approved, ...topics, ...index.docs.map((d) => d.section)];
  }
  if (org === "harvey_taxi") return loadSources({ sources: HARVEY_SOURCES, ...opts }).sections;
  throw new Error(`unknown organization: ${org}`);
}

module.exports = { VISIBILITY, SITE, versionOf, retrievable, passagesFor, buildOrgCorpus, loadPublishedSections, HARVEY_SOURCES, HTAF_SOURCES };

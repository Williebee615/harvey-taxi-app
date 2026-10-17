// Search over approved Harvey Taxi knowledge (docs/ai-knowledge.md).
//
// Retrieval is in-process keyword ranking (BM25) over sections of the
// approved sources. The corpus is a few thousand words, so this needs no
// embeddings, no vector database, no paid service and no database reads:
// the index is built once at startup from the deployed pages.
//
// Answers are extractive: the assistant quotes the best-matching
// sentences and names the source and its date. When nothing scores above
// the threshold, it says the approved information doesn't cover the
// question instead of guessing.

const fs = require("fs");
const path = require("path");
const { SOURCES } = require("./sources");

const STOPWORDS = new Set(
  (
    "a an the and or but if of to in on at by for with from as is are was were be been being do does did " +
    "i me my we our you your he she it its they them their this that these those what which who whom how " +
    "can could should would will shall may might must about into over under again then there here when where " +
    "why all any both each few more most other some such no nor not only own same so than too very just " +
    "harvey taxi please tell know want need get have has had also us"
  ).split(" ")
);

// Words that say what kind of question it is, not what it is about
// ("what does your privacy POLICY SAY about..."). They don't count toward
// a match: "cancellation fee policy" must not match "policy enforcement".
const META = new Set(["policy", "policie", "privacy", "term", "rule", "say", "mean", "explain", "question", "about", "regard", "allowed"]);

// Same idea, different words. Kept small and reviewed: a synonym can only
// widen what a question matches, never add text to an answer.
const SYNONYMS = Object.freeze({
  delete: ["deletion", "remove", "erase"],
  deletion: ["delete"],
  cancel: ["cancellation", "cancelled"],
  cancellation: ["cancel"],
  refund: ["refunds", "chargeback", "dispute"],
  pay: ["payment", "payments", "charge", "card"],
  payment: ["pay", "charge", "card"],
  card: ["payment"],
  data: ["information", "personal"],
  information: ["data"],
  location: ["gps", "position"],
  safety: ["emergency", "911"],
  emergency: ["safety", "911"],
  contact: ["support", "help", "email", "phone"],
  support: ["contact", "help"],
  medical: ["nemt"],
  share: ["sharing", "shared"],
  keep: ["retention", "retain", "kept"],
  retention: ["keep", "kept", "retain"],
  verify: ["verification", "identity", "background"],
  verification: ["verify", "identity", "background"]
});

function stem(word) {
  let w = word;
  if (w.length > 5 && w.endsWith("ies")) w = `${w.slice(0, -3)}y`;
  else if (w.length > 5 && w.endsWith("ing")) w = w.slice(0, -3);
  else if (w.length > 4 && w.endsWith("ed")) w = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) w = w.slice(0, -1);
  return w;
}

function tokenize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .split(/[^a-z0-9]+/)
    .filter((w) => w && w.length > 1 && !STOPWORDS.has(w))
    .map(stem);
}

function expandQuery(tokens) {
  const out = new Set(tokens);
  for (const t of tokens) {
    for (const [key, list] of Object.entries(SYNONYMS)) {
      if (stem(key) === t) list.forEach((s) => out.add(stem(s)));
    }
  }
  return [...out];
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”", mdash: "—", ndash: "–", middot: "·", hellip: "…" };

function decodeEntities(text) {
  return text
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, name) => (ENTITIES[name.toLowerCase()] !== undefined ? ENTITIES[name.toLowerCase()] : m));
}

function htmlToText(html) {
  // Source line breaks are just formatting: collapse all whitespace first,
  // then break only at block-level tags.
  const BREAK = "\u0001";
  return decodeEntities(
    String(html || "")
      .replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<br\s*\/?>/gi, BREAK)
      .replace(/<\/(p|li|div|h[1-6]|tr|section|article|ul|ol)>/gi, BREAK)
      .replace(/<li[^>]*>/gi, `${BREAK}• `)
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/\s+/g, " ")
    .split(BREAK)
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

// Splits a published page into sections at its h2/h3 headings. Text
// before the first heading is skipped (site navigation and hero copy).
function sectionsFromHtml(html, source) {
  // HTML comments are never published text (reviewer notes, TODOs), so
  // they must never be quoted.
  const body = String(html || "")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, " ");
  const parts = body.split(/(?=<h[23][^>]*>)/i);
  const sections = [];
  for (const part of parts) {
    const m = /^<h([23])[^>]*>([\s\S]*?)<\/h\1>([\s\S]*)$/i.exec(part.trim());
    if (!m) continue;
    const heading = htmlToText(m[2]).replace(/\s+/g, " ").trim();
    const text = htmlToText(m[3]).replace(/\n{2,}/g, "\n").trim();
    if (!heading || text.length < 40) continue;
    sections.push({
      source_id: source.id,
      title: source.title,
      heading,
      url: source.url,
      updated: source.updated || null,
      audience: source.audience,
      text: text.slice(0, 4000)
    });
  }
  return sections;
}

function loadSources({ publicDir = path.join(__dirname, "..", "..", "public"), sources = SOURCES, readFile = fs.readFileSync } = {}) {
  const sections = [];
  const loaded = [];
  for (const source of sources) {
    let html;
    try {
      html = readFile(path.join(publicDir, source.file), "utf8");
    } catch (err) {
      loaded.push({ id: source.id, ok: false });
      continue;
    }
    const dateMatch = source.datePattern ? source.datePattern.exec(htmlToText(html)) : null;
    const withDate = { ...source, updated: dateMatch ? dateMatch[1] : null };
    const found = sectionsFromHtml(html, withDate);
    sections.push(...found);
    loaded.push({ id: source.id, ok: true, sections: found.length, updated: withDate.updated });
  }
  return { sections, loaded };
}

// Admin-approved articles (knowledge_articles rows with status
// 'approved') as searchable sections. Their public source is
// /policies.html, and their date is the approval date.
function formatDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function articleSections(rows) {
  return (rows || [])
    .filter((r) => r && r.status === "approved" && r.slug && r.title && r.body)
    .map((r) => ({
      source_id: `article:${r.slug}`,
      title: "Harvey Taxi policies",
      heading: String(r.title),
      url: `/policies.html#${r.slug}`,
      updated: formatDate(r.approved_at),
      audience: Array.isArray(r.audience) && r.audience.length ? r.audience : ["rider", "driver"],
      text: String(r.body).slice(0, 4000)
    }));
}

// BM25 index over sections. The heading counts twice: a question that
// names a section ("data retention") should land on it.
function buildIndex(sections) {
  const docs = sections.map((s) => {
    const tokens = [...tokenize(s.heading), ...tokenize(s.heading), ...tokenize(s.text)];
    const tf = new Map();
    tokens.forEach((t) => tf.set(t, (tf.get(t) || 0) + 1));
    return { section: s, tf, length: tokens.length, heading: new Set(tokenize(s.heading)) };
  });
  const df = new Map();
  docs.forEach((d) => d.tf.forEach((_, t) => df.set(t, (df.get(t) || 0) + 1)));
  const avgLength = docs.reduce((sum, d) => sum + d.length, 0) / Math.max(1, docs.length);
  return { docs, df, avgLength, size: docs.length };
}

const K1 = 1.2;
const B = 0.75;
// Below this a match is too weak to quote; tuned on test/agent-eval.
const MIN_SCORE = 3.0;
const HEADING_BONUS = 2.5;

// Share of the question's own terms (each counted when it, or one of its
// synonyms, is in the section) a section must contain. Stops one shared
// word ("fee", "areas") from producing a confident wrong answer.
const MIN_COVERAGE = 0.75;

function coverage(doc, baseTerms) {
  if (!baseTerms.length) return 0;
  let hit = 0;
  for (const t of baseTerms) {
    if (doc.tf.has(t) || expandQuery([t]).some((x) => doc.tf.has(x))) hit += 1;
  }
  return hit / baseTerms.length;
}

// A question about cancelling (a rider's or driver's cancellation, its
// fees or deadlines, no-shows) is only answered by a passage that is about
// riders or drivers cancelling. "Harvey Taxi may ... cancel requests" (the
// Terms) is about Harvey refusing service and must not be quoted as a
// cancellation policy; with no such passage the question is a gap.
const CANCEL_TERMS = new Set(["cancel", "cancellation", "cancelled", "canceled", "cancelling", "canceling"].map((w) => stem(w)));
const CANCELLATION_POLICY_TEXT =
  /\b(cancellation (fee|fees|policy|window|charge|charges|deadline)|no[- ]?shows?|free cancellation|cancel (your|a|the|their|my) (ride|trip|booking|request)|(riders?|drivers?|you|passengers?) (may|can|can't|cannot|are able to) cancel|cancel(s|led|ed|ling|ing)? (before|after|within|up to))\b/i;

function isCancellationQuestion(query, baseTerms) {
  return baseTerms.some((t) => CANCEL_TERMS.has(t)) || /\bno[- ]?shows?\b/i.test(String(query || ""));
}

function search(index, query, { role = "rider", limit = 3 } = {}) {
  const baseTerms = [...new Set(tokenize(query))].filter((t) => !META.has(t));
  const terms = expandQuery(baseTerms);
  if (!terms.length || !index.size) return [];
  const aboutCancelling = isCancellationQuestion(query, baseTerms);
  const results = [];
  for (const d of index.docs) {
    if (!d.section.audience.includes(role)) continue;
    if (aboutCancelling && !CANCELLATION_POLICY_TEXT.test(d.section.text || "")) continue;
    if (coverage(d, baseTerms) < MIN_COVERAGE) continue;
    let score = 0;
    let matched = 0;
    for (const t of terms) {
      const f = d.tf.get(t);
      if (!f) continue;
      matched += 1;
      const n = index.df.get(t) || 0;
      const idf = Math.log(1 + (index.size - n + 0.5) / (n + 0.5));
      score += idf * ((f * (K1 + 1)) / (f + K1 * (1 - B + (B * d.length) / index.avgLength)));
    }
    // A heading that names what was asked ("Sharing of Information",
    // "Payment Information") is the section the question is about.
    for (const t of baseTerms) {
      if (d.heading.has(t) || expandQuery([t]).some((x) => d.heading.has(x))) score += HEADING_BONUS;
    }
    if (matched) results.push({ section: d.section, score, matched });
  }
  return results
    .filter((r) => r.score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

// The sentences of a section that best match the question, in page order.
function excerpt(section, query, maxChars = 420) {
  const terms = new Set(expandQuery(tokenize(query)));
  const sentences = section.text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.replace(/^•\s*/, "").trim())
    .filter((s) => s.length > 20);
  const scored = sentences.map((s, i) => ({ s, i, hits: tokenize(s).filter((t) => terms.has(t)).length }));
  const best = scored
    .filter((x) => x.hits > 0)
    .sort((a, b) => b.hits - a.hits || a.i - b.i)
    .slice(0, 3)
    .sort((a, b) => a.i - b.i);
  const chosen = best.length ? best : scored.slice(0, 2);
  let text = "";
  for (const { s } of chosen) {
    if (text && text.length + s.length + 1 > maxChars) break;
    text = text ? `${text} ${s}` : s;
  }
  if (text.length > maxChars) text = `${text.slice(0, maxChars - 1).trimEnd()}…`;
  return text;
}

function sourceRef(section) {
  return {
    title: section.title,
    section: section.heading,
    url: section.url,
    updated: section.updated
  };
}

function numbersIn(text) {
  return new Set((String(text).match(/\$?\d+(?:[.,]\d+)?%?/g) || []).map((n) => n.replace(/,/g, "")));
}

// Two approved sources that both answer the question about equally well
// but state different numbers (fees, minutes, ages...) may disagree. The
// assistant says so and points to support rather than pick one.
function possibleConflict(hits, query) {
  if (hits.length < 2) return false;
  const [a, b] = hits;
  if (a.section.source_id === b.section.source_id) return false;
  if (b.score < 0.85 * a.score) return false;
  const na = numbersIn(excerpt(a.section, query));
  const nb = numbersIn(excerpt(b.section, query));
  if (!na.size || !nb.size) return false;
  return [...na].some((n) => !nb.has(n)) || [...nb].some((n) => !na.has(n));
}

// The answer for a policy question: quoted text plus sources, or a gap.
function answerFromKnowledge(index, query, { role = "rider" } = {}) {
  const hits = search(index, query, { role, limit: 2 });
  if (!hits.length) {
    return { found: false, draft: null, sources: [] };
  }
  const top = hits[0];
  const quote = excerpt(top.section, query);
  const dated = top.section.updated ? `, ${top.section.updated}` : ", date not stated on the page";
  let draft = `From our ${top.section.title} ("${top.section.heading}"${dated}): ${quote}`;
  const conflict = possibleConflict(hits, query);
  if (conflict) {
    draft += ` Another approved Harvey Taxi source ("${hits[1].section.heading}") may say something different, so please confirm with Harvey Taxi support before relying on this.`;
  }
  const sources = [];
  const seen = new Set();
  for (const h of hits) {
    const key = `${h.section.url}#${h.section.heading}`;
    if (seen.has(key)) continue;
    seen.add(key);
    sources.push(sourceRef(h.section));
  }
  return { found: true, draft, quote, heading: top.section.heading, title: top.section.title, sources, top_score: Number(top.score.toFixed(2)), conflict };
}

let cached = null;
// Built once per process from the deployed pages.
function defaultIndex() {
  if (!cached) {
    const { sections, loaded } = loadSources();
    cached = { index: buildIndex(sections), loaded };
  }
  return cached;
}

module.exports = {
  articleSections,
  possibleConflict,
  MIN_SCORE,
  MIN_COVERAGE,
  tokenize,
  expandQuery,
  isCancellationQuestion,
  CANCELLATION_POLICY_TEXT,
  htmlToText,
  sectionsFromHtml,
  loadSources,
  buildIndex,
  search,
  excerpt,
  answerFromKnowledge,
  defaultIndex
};

// Embedding calibration: measures vector retrieval on the REAL published
// pages with labeled paraphrase questions, compares it with keyword
// retrieval, and suggests MEMBRANE_MIN_SIMILARITY. Read-only: it embeds
// public passages and the fixed questions below through the membrane and
// returns scores; it writes nothing and stores nothing.
//
// Each labeled question names the passage heading that answers it, or null
// when the published pages don't cover it (those must stay unanswered).
// Questions are paraphrases sharing few words with the page, where keyword
// retrieval fails.

const { buildOrgCorpus, loadPublishedSections } = require("../assistantPilot/corpus");
const { retrieve, retrieveHybrid } = require("../assistantPilot/retrieval");
const { buildMemoryStore } = require("../assistantPilot/vectors");

const LABELED = [
  { org: "htaf", q: "Who is allowed to ask HTAF for a ride?", expect: /Frequently Asked Questions|Eligibility/ },
  { org: "htaf", q: "Does sending the form mean I'm sure to get a trip?", expect: /Frequently Asked Questions|Applications and Eligibility/ },
  { org: "htaf", q: "Is the foundation tax-exempt?", expect: /Nonprofit Status/ },
  { org: "htaf", q: "How long do you keep my paperwork?", expect: /Data Retention/ },
  { org: "htaf", q: "Can a kid fill this out by themselves?", expect: /Children/ },
  { org: "htaf", q: "Which parts of Tennessee do you serve?", expect: /Legal Identity/ },
  { org: "htaf", q: "Who sees what I write in my request?", expect: /Who Can Access|How We Share/ },
  { org: "htaf", q: "Is HTAF the same company as the taxi business?", expect: /Legal Identity|HTAF, Harvey Taxi/ },
  { org: "htaf", q: "Will you text me?", expect: /Text Messages/ },
  { org: "htaf", q: "Can you book me a flight to Chicago?", expect: null },
  { org: "htaf", q: "What's the weather tomorrow?", expect: null },
  { org: "harvey_taxi", q: "Do drivers see my phone number?", expect: /Sharing of Information/ },
  { org: "harvey_taxi", q: "How long is my data kept?", expect: /Data Retention/ },
  { org: "harvey_taxi", q: "Can a 12 year old use the app?", expect: /Children/ },
  { org: "harvey_taxi", q: "Is a car always available when I request one?", expect: /Ride Requests and Availability/ },
  { org: "harvey_taxi", q: "Who handles my card?", expect: /Payment Information|Payments/ },
  { org: "harvey_taxi", q: "Can I get my account erased?", expect: /Your Choices|Contact/ },
  { org: "harvey_taxi", q: "Do you fly helicopters?", expect: null },
  { org: "harvey_taxi", q: "Recommend a good pizza place", expect: null }
];

async function runCalibration({ embedder, minSimilarity = null, corpora = null } = {}) {
  const started = Date.now();
  const orgs = ["harvey_taxi", "htaf"];
  corpora = corpora || Object.fromEntries(orgs.map((org) => [org, buildOrgCorpus(org, { sections: loadPublishedSections(org) })]));
  const stores = {};
  const embedMs = {};
  for (const org of orgs) {
    const t = Date.now();
    stores[org] = await buildMemoryStore({ corpus: corpora[org], embedder });
    embedMs[org] = Date.now() - t;
  }
  const rows = [];
  for (const item of LABELED) {
    const [qv] = await embedder.embed([item.q], { kind: "query" });
    const [top] = await stores[item.org].search(qv, 1);
    const p = corpora[item.org].passages.find((x) => x.id === top.id);
    rows.push({ ...item, top: top.score, topHeading: p.heading, topCorrect: item.expect ? item.expect.test(p.heading) : false });
  }
  // A threshold exists only when every correctly matched question scores
  // above every out-of-scope one; if the ranges overlap, none is suggested.
  const covered = rows.filter((r) => r.expect && r.topCorrect).map((r) => r.top);
  const uncovered = rows.filter((r) => !r.expect).map((r) => r.top);
  const lowestCorrect = covered.length ? Math.min(...covered) : null;
  const highestOffTopic = uncovered.length ? Math.max(...uncovered) : null;
  const separable = lowestCorrect !== null && highestOffTopic !== null && lowestCorrect > highestOffTopic;
  const suggested = separable ? Number(((lowestCorrect + highestOffTopic) / 2).toFixed(3)) : null;
  const threshold = minSimilarity || suggested;

  const results = { keyword: { hit: 0, falseAnswer: 0 }, hybrid: { hit: 0, falseAnswer: 0 } };
  const table = [];
  for (const r of rows) {
    const viewer = { org: r.org, role: "visitor" };
    const kw = retrieve({ corpus: corpora[r.org], viewer, query: r.q }).passages;
    const hy = threshold
      ? (await retrieveHybrid({ corpus: corpora[r.org], viewer, query: r.q, vectors: { store: stores[r.org], embedder, minSimilarity: threshold } })).passages
      : null;
    const grade = (ps, bucket) => {
      if (!ps) return "not run (no threshold)";
      if (!r.expect) {
        if (ps.length) results[bucket].falseAnswer += 1;
        return ps.length ? `answered (should not): ${ps[0].heading}` : "not covered (correct)";
      }
      const ok = ps.slice(0, 2).some((p) => r.expect.test(p.heading));
      if (ok) results[bucket].hit += 1;
      return ok ? "correct" : ps.length ? `wrong: ${ps[0].heading}` : "not found";
    };
    table.push({ org: r.org, question: r.q, answerable: Boolean(r.expect), top_similarity: Number(r.top.toFixed(3)), top_heading: r.topHeading, keyword: grade(kw, "keyword"), hybrid: grade(hy, "hybrid") });
  }
  const answerable = rows.filter((r) => r.expect).length;
  return {
    model: embedder.model,
    passages: Object.fromEntries(orgs.map((o) => [o, corpora[o].passages.length])),
    embed_ms: embedMs,
    lowest_correct_similarity: lowestCorrect === null ? null : Number(lowestCorrect.toFixed(3)),
    highest_off_topic_similarity: highestOffTopic === null ? null : Number(highestOffTopic.toFixed(3)),
    separable,
    suggested_min_similarity: suggested,
    threshold_used: threshold,
    answerable,
    keyword_found_top2: results.keyword.hit,
    hybrid_found_top2: threshold ? results.hybrid.hit : null,
    keyword_off_topic_answered: results.keyword.falseAnswer,
    hybrid_off_topic_answered: threshold ? results.hybrid.falseAnswer : null,
    total_ms: Date.now() - started,
    table
  };
}

module.exports = { LABELED, runCalibration };

#!/usr/bin/env node
// Measures vector retrieval against the membrane (Harvey Taxi's own model
// service) on the REAL published pages, and suggests
// MEMBRANE_MIN_SIMILARITY. Read-only: no database, no flags; text goes
// only to the membrane address in MEMBRANE_BASE_URL, which must pass the
// same own-server policy as production (lib/membrane/config.js).
//
//   MEMBRANE_BASE_URL=http://localhost:8080/v1 MEMBRANE_EMBED_MODEL=... \
//     node scripts/membrane-calibrate.js
//
// Each labeled question names the passage heading that answers it, or
// null when the published pages don't cover it (those must stay
// unanswered). Questions are paraphrases written to share few words with
// the page, which is where keyword retrieval fails.

const { buildOrgCorpus, loadPublishedSections } = require("../lib/assistantPilot/corpus");
const { retrieve, retrieveHybrid } = require("../lib/assistantPilot/retrieval");
const { buildMemoryStore } = require("../lib/assistantPilot/vectors");
const { readMembraneConfig, describeMembraneConfig } = require("../lib/membrane/config");
const { createMembraneEmbedder } = require("../lib/membrane/embeddings");

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

(async () => {
  const config = readMembraneConfig();
  const embedder = createMembraneEmbedder(config);
  if (!embedder) {
    console.error("Membrane not usable:", describeMembraneConfig(config).problem);
    process.exit(2);
  }
  const corpora = {};
  const stores = {};
  for (const org of ["harvey_taxi", "htaf"]) {
    corpora[org] = buildOrgCorpus(org, { sections: loadPublishedSections(org) });
    const t = Date.now();
    stores[org] = await buildMemoryStore({ corpus: corpora[org], embedder });
    console.log(`${org}: ${corpora[org].passages.length} passages embedded in ${Date.now() - t} ms`);
  }
  // Top vector similarity for each question, to pick a threshold.
  const rows = [];
  for (const item of LABELED) {
    const [qv] = await embedder.embed([item.q], { kind: "query" });
    const [top] = await stores[item.org].search(qv, 1);
    const p = corpora[item.org].passages.find((x) => x.id === top.id);
    rows.push({ ...item, top: top.score, topHeading: p.heading, topCorrect: item.expect ? item.expect.test(p.heading) : false });
  }
  const covered = rows.filter((r) => r.expect && r.topCorrect).map((r) => r.top);
  const uncovered = rows.filter((r) => !r.expect).map((r) => r.top);
  // A threshold only exists when every correctly matched question scores
  // above every out-of-scope one; if the ranges overlap, no single cutoff
  // separates them and none is suggested.
  const lowestCorrect = covered.length ? Math.min(...covered) : null;
  const highestOffTopic = uncovered.length ? Math.max(...uncovered) : null;
  const separable = lowestCorrect !== null && highestOffTopic !== null && lowestCorrect > highestOffTopic;
  const suggested = separable ? (lowestCorrect + highestOffTopic) / 2 : null;
  console.log(`lowest correct top-1 similarity: ${lowestCorrect === null ? "n/a" : lowestCorrect.toFixed(3)}; highest off-topic: ${highestOffTopic === null ? "n/a" : highestOffTopic.toFixed(3)}`);
  if (!separable) console.log("NO CLEAN SEPARATION: correct and off-topic scores overlap (or a group is empty). No threshold is suggested; review the table before choosing one.");
  const threshold = Number(process.env.MEMBRANE_MIN_SIMILARITY) || suggested || 0.5;

  const results = { keyword: { hit: 0, falseAnswer: 0 }, hybrid: { hit: 0, falseAnswer: 0 } };
  console.log(`\nthreshold used: ${threshold.toFixed(3)} (suggested ${suggested === null ? "n/a" : suggested.toFixed(3)})\n`);
  console.log("| org | question | top similarity | keyword | hybrid |");
  console.log("|---|---|---|---|---|");
  for (const r of rows) {
    const viewer = { org: r.org, role: "visitor" };
    const kw = retrieve({ corpus: corpora[r.org], viewer, query: r.q }).passages;
    const hy = (await retrieveHybrid({ corpus: corpora[r.org], viewer, query: r.q, vectors: { store: stores[r.org], embedder, minSimilarity: threshold } })).passages;
    const grade = (ps, bucket) => {
      if (!r.expect) {
        if (ps.length) results[bucket].falseAnswer += 1;
        return ps.length ? "answered (should not)" : "not covered ✓";
      }
      const ok = ps.slice(0, 2).some((p) => r.expect.test(p.heading));
      if (ok) results[bucket].hit += 1;
      return ok ? "✓" : ps.length ? `wrong: ${ps[0].heading}` : "not found";
    };
    console.log(`| ${r.org} | ${r.q} | ${r.top.toFixed(3)} | ${grade(kw, "keyword")} | ${grade(hy, "hybrid")} |`);
  }
  const answerable = rows.filter((r) => r.expect).length;
  console.log(`\nanswerable found in top 2: keyword ${results.keyword.hit}/${answerable}, hybrid ${results.hybrid.hit}/${answerable}`);
  console.log(`out-of-scope wrongly answered: keyword ${results.keyword.falseAnswer}, hybrid ${results.hybrid.falseAnswer}`);
})().catch((err) => {
  console.error("calibration failed:", err.code || err.message);
  process.exit(1);
});

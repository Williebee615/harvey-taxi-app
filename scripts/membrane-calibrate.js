#!/usr/bin/env node
// Runs the embedding calibration (lib/membrane/calibration.js) against the
// membrane in MEMBRANE_BASE_URL and prints the report. Read-only; text goes
// only to that address, which must pass the own-server policy
// (lib/membrane/config.js). In production, use the admin page
// GET /api/admin/membrane/calibration instead (the membrane is only
// reachable inside Render's private network).
//
//   MEMBRANE_BASE_URL=http://localhost:8765/v1 MEMBRANE_EMBED_MODEL=... \
//     MEMBRANE_QUERY_PREFIX="query: " MEMBRANE_PASSAGE_PREFIX="passage: " \
//     node scripts/membrane-calibrate.js

const { readMembraneConfig, describeMembraneConfig } = require("../lib/membrane/config");
const { createMembraneEmbedder } = require("../lib/membrane/embeddings");
const { runCalibration } = require("../lib/membrane/calibration");

(async () => {
  const config = readMembraneConfig();
  const embedder = createMembraneEmbedder({ ...config, timeoutMs: Math.max(config.timeoutMs, 20000) });
  if (!embedder) {
    console.error("Membrane not usable:", describeMembraneConfig(config).problem);
    process.exit(2);
  }
  const report = await runCalibration({ embedder, minSimilarity: Number(process.env.MEMBRANE_MIN_SIMILARITY) || null });
  const { table, ...summary } = report;
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.separable) console.log("NO CLEAN SEPARATION: correct and off-topic scores overlap; no threshold suggested.");
  console.log("\n| org | question | top similarity | keyword | hybrid |\n|---|---|---|---|---|");
  for (const r of table) console.log(`| ${r.org} | ${r.question} | ${r.top_similarity} | ${r.keyword} | ${r.hybrid} |`);
})().catch((err) => {
  console.error("calibration failed:", err.code || err.message);
  process.exit(1);
});

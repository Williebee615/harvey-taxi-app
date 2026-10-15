#!/usr/bin/env node
// Scores a fine-tuned membrane model's answers on the held-out set
// (training/membrane/train_lora.py --predict) with the SAME checks
// production applies to every model answer (lib/assistantPilot/citations.js),
// plus grounding: every cited sentence must share most of its words with
// the source it cites. Prints pass rates; exits 1 below the bar.
//
//   node scripts/membrane-score-predictions.js training/membrane/out/predictions.jsonl [--min 0.9]

const fs = require("fs");
const { checkAnswer } = require("../lib/assistantPilot/citations");

const file = process.argv[2];
const minIdx = process.argv.indexOf("--min");
const MIN = minIdx > 0 ? Number(process.argv[minIdx + 1]) : 0.9;

function sourcesFrom(userContent) {
  return [...String(userContent).matchAll(/<source id="S(\d+)" title="([^"]*)" section="([^"]*)"[^>]*>\n([\s\S]*?)\n<\/source>/g)].map((m) => ({ title: m[2], heading: m[3], text: m[4], url: "" }));
}
const words = (s) => new Set(String(s).toLowerCase().match(/[a-z0-9]{3,}/g) || []);
function grounded(answer, passages) {
  for (const sent of answer.split(/(?<=\.)\s+/)) {
    const refs = [...sent.matchAll(/\[S(\d+)\]/g)].map((m) => Number(m[1]));
    if (!refs.length) continue;
    const w = words(sent.replace(/\[S\d+\]/g, ""));
    const src = words(refs.map((n) => (passages[n - 1] || {}).text || "").join(" "));
    const overlap = [...w].filter((x) => src.has(x)).length / Math.max(1, w.size);
    if (overlap < 0.6) return false;
  }
  return true;
}

const rows = fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const t = { total: 0, checker_ok: 0, grounded: 0, not_covered_expected: 0, not_covered_correct: 0, problems: {} };
for (const r of rows) {
  const passages = sourcesFrom(r.messages[r.messages.length - 1].content);
  const c = checkAnswer(r.answer, passages);
  const expectNotCovered = checkAnswer(r.expected, passages).notCovered;
  t.total += 1;
  if (c.ok) t.checker_ok += 1;
  else t.problems[c.problem] = (t.problems[c.problem] || 0) + 1;
  if (c.ok && grounded(r.answer, passages)) t.grounded += 1;
  if (expectNotCovered) {
    t.not_covered_expected += 1;
    if (c.notCovered) t.not_covered_correct += 1;
  }
}
const rate = (a, b) => (b ? a / b : 1);
const report = {
  ...t,
  checker_pass_rate: rate(t.checker_ok, t.total),
  grounded_rate: rate(t.grounded, t.total),
  not_covered_rate: rate(t.not_covered_correct, t.not_covered_expected)
};
console.log(JSON.stringify(report, null, 2));
process.exit(report.checker_pass_rate >= MIN && report.grounded_rate >= MIN && report.not_covered_rate >= MIN ? 0 : 1);

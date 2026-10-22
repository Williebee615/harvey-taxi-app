#!/usr/bin/env node
// Harvey Assistant evaluation with the Claude model (owner decision
// 2026-10-19: Claude Haiku 5.5; docs/assistant-model-activation-review-pack.md,
// step T4). Runs the regression and holdout question sets
// (test/agent-eval/) through the same model path the server uses
// (handleModelAssist), over the evaluation's fake database: synthetic
// riders and drivers, no production data. Where the model isn't used or its
// answer is rejected, the rules-based answer is graded instead, as the apps
// would show it.
//
// Spends real money, so it never runs by accident:
//   ANTHROPIC_API_KEY=... node scripts/model-eval.js --confirm-spend
// prints the most it can spend before the first call and stops if the
// running total would pass --max-usd (default $1.00). Without
// --confirm-spend it only prints that estimate. The key is read from the
// environment and never printed.
//
// Optional: --set regression|holdout|all (default all), --json (machine-
// readable report), --out <file> (per-question results; default
// model-eval-results.json, which git ignores). The file holds the
// questions, grades and Anthropic's reason for any refusal, never the key.

const { readClaudeConfig, createClaudeClient } = require("../lib/agent/claudeClient");
const { handleModelAssist } = require("../lib/agent/modelAssistant");
const { handleAssist } = require("../lib/agent/assistant");
const { createAgentTools } = require("../lib/agent/tools");
const { worstCaseTurnCost } = require("../lib/agent/modelBudget");
const fs = require("fs");
const { fixture, grade, percentile, QUESTION_SETS } = require("../test/agent-eval/run");

function argValue(argv, name, fallback) {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
}

function questionsFor(setName) {
  const names = setName === "all" ? Object.keys(QUESTION_SETS) : [setName];
  const out = [];
  for (const name of names) {
    const { RIDER, DRIVER } = QUESTION_SETS[name];
    for (const item of RIDER) out.push({ set: name, role: "rider", actor: { role: "rider", id: "RIDER_1" }, item });
    for (const item of DRIVER) out.push({ set: name, role: "driver", actor: { role: "driver", id: "DRIVER_1" }, item });
  }
  return out;
}

// claude: a client from createClaudeClient (or a test double with the same
// shape). Returns { rows, metrics }.
async function runModelEval({ claude, set = "all", maxUsd = 1, log = () => {} }) {
  const nowMs = Date.parse("2026-10-04T18:00:00Z");
  const tools = createAgentTools({ supabase: fixture(nowMs), now: () => nowMs });
  const perTurn = worstCaseTurnCost(claude.model);
  const rows = [];
  let spent = 0;
  for (const q of questionsFor(set)) {
    if (spent + perTurn > maxUsd) {
      rows.push({ ...q, skipped: true });
      continue;
    }
    const client = q.role === "driver" ? "driver_app" : "web";
    const started = Date.now();
    // eslint-disable-next-line no-await-in-loop
    const model = await handleModelAssist({ role: q.role, actor: q.actor, message: q.item.q, tools, claude, client, now: () => Date.now() });
    spent += model.cost_usd || 0;
    // eslint-disable-next-line no-await-in-loop
    const shown = model.ok ? { ...model, source: "model" } : await handleAssist({ role: q.role, actor: q.actor, message: q.item.q, tools, client });
    const g = grade(q.item, shown);
    rows.push({
      set: q.set,
      role: q.role,
      q: q.item.q,
      ms: Date.now() - started,
      model_used: model.ok === true,
      fallback_reason: model.ok ? null : model.reason,
      // Anthropic's own reason for a refused call (already sanitized).
      provider_error: model.provider_error || null,
      cost_usd: model.cost_usd || 0,
      calls: model.calls || 0,
      reply: String(shown.reply || "").slice(0, 600),
      sources: (shown.sources || []).map((s) => `${s.url}#${s.section}`),
      ...g
    });
    log(`${g.ok ? "PASS" : "FAIL"} [${q.set}/${q.role}] ${model.ok ? "model" : `rules (${model.reason})`} ${q.item.q}${g.ok ? "" : `  -> ${g.problems.join("; ")}`}`);
  }
  const ran = rows.filter((r) => !r.skipped);
  const modelRows = ran.filter((r) => r.model_used);
  const reasons = {};
  const providerErrors = {};
  for (const r of ran) {
    if (r.model_used) continue;
    reasons[r.fallback_reason] = (reasons[r.fallback_reason] || 0) + 1;
    if (r.provider_error && !providerErrors[r.fallback_reason]) providerErrors[r.fallback_reason] = r.provider_error.message || r.provider_error.type || null;
  }
  const metrics = {
    model: claude.model,
    questions: rows.length,
    skipped_for_budget: rows.length - ran.length,
    answer_accuracy: ran.length ? ran.filter((r) => r.ok).length / ran.length : 0,
    model_answer_share: ran.length ? modelRows.length / ran.length : 0,
    model_answer_accuracy: modelRows.length ? modelRows.filter((r) => r.ok).length / modelRows.length : null,
    wrong_quotes: ran.filter((r) => r.wrongQuote).length,
    fallback_reasons: reasons,
    // The first message Anthropic gave for each kind of refusal.
    provider_errors: providerErrors,
    total_cost_usd: Math.round(spent * 1e6) / 1e6,
    cost_per_question_usd: ran.length ? Math.round((spent / ran.length) * 1e6) / 1e6 : 0,
    p95_ms: percentile(ran.map((r) => r.ms), 95)
  };
  return { rows, metrics };
}

async function main(argv) {
  const set = argValue(argv, "--set", "all");
  if (set !== "all" && !QUESTION_SETS[set]) {
    console.error(`Unknown --set ${set}. Use regression, holdout or all.`);
    return 2;
  }
  const maxUsd = Number(argValue(argv, "--max-usd", "1"));
  const config = readClaudeConfig();
  const count = questionsFor(set).length;
  const ceiling = Math.min(maxUsd, count * worstCaseTurnCost(config.model));
  console.log(`Model: ${config.model}. Questions: ${count}. The most this run can spend: $${ceiling.toFixed(4)} (worst case per question $${worstCaseTurnCost(config.model)}; stops at $${maxUsd.toFixed(2)}).`);
  if (!argv.includes("--confirm-spend")) {
    console.log("Nothing sent. Add --confirm-spend to run it.");
    return 0;
  }
  if (!config.configured) {
    console.error("ANTHROPIC_API_KEY is not set in this shell. Nothing was sent.");
    return 2;
  }
  const claude = createClaudeClient({ config });
  const { rows, metrics } = await runModelEval({ claude, set, maxUsd, log: argv.includes("--json") ? () => {} : (line) => console.log(line) });
  const out = argValue(argv, "--out", "model-eval-results.json");
  fs.writeFileSync(out, JSON.stringify({ ran_at: new Date().toISOString(), metrics, rows }, null, 2));
  console.log(argv.includes("--json") ? JSON.stringify(metrics, null, 2) : metrics);
  console.log(`Per-question results written to ${out}.`);
  return 0;
}

if (require.main === module) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (err) => {
    console.error("Model evaluation failed:", err && err.message ? err.message : err);
    process.exit(1);
  });
}

module.exports = { runModelEval, questionsFor };

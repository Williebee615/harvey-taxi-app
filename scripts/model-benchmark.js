#!/usr/bin/env node
// Evaluates a SELF-HOSTED open-weight model as the optional phrasing layer
// for operations-assistant answers, on the labelled benchmark cases.
//
//   AGENT_LLM_BASE_URL=http://host:8080/v1 AGENT_LLM_MODEL=qwen2.5-1.5b-instruct \
//     node scripts/model-benchmark.js [--runs 3] [--out results.json]
//
// For every case the rules engine writes the answer first; the model is
// asked to rephrase it under lib/agent/grounding.js's rules, and the guard
// decides whether the rephrase is usable. Measures, per model:
//   - latency per request (p50 / p95 / max), measured on the caller side
//   - completion tokens per second, when the runtime reports usage
//   - guard acceptance rate and rejection reasons (ungrounded numbers,
//     claimed actions, links, dropped 911 line...)
// It never sends real customer data: only the synthetic test fixtures.
// Hosted OpenAI/Anthropic endpoints are refused by readLlmConfig().

const fs = require("fs");
const { readLlmConfig, createLlmClient } = require("../lib/agent/llmClient");
const { buildGroundedMessages, guardModelOutput } = require("../lib/agent/grounding");
const { runBenchmark } = require("../lib/ops/benchmark");
const { createFakeSupabase } = require("../test/fakeSupabase");
const { buildSeed, BENCHMARK_CASES } = require("../test/fixtures/opsScenarios");
const { createOpsEngine } = require("../lib/ops/engine");
const { createCaseStore } = require("../lib/ops/caseStore");

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
}

async function drafts() {
  const now = Date.parse("2026-10-03T21:00:00Z");
  const out = [];
  for (const c of BENCHMARK_CASES) {
    const supabase = createFakeSupabase(buildSeed(now));
    const engine = createOpsEngine({
      supabase,
      store: createCaseStore({ supabase, now: () => now }),
      policyContext: async () => ({ actionsEnabled: false, killSwitch: false, flags: {} }),
      now: () => now
    });
    const record = await engine.openCase({ actor: { role: "rider", id: c.rider || "TEST-RIDER-A" }, message: c.message, rideId: c.ride });
    const facts = (record.summary.findings || []).flatMap((f) => f.facts.map((x) => x.text));
    out.push({ id: c.id, draft: record.summary.subject_summary || "", facts: { found: facts.slice(0, 6) } });
  }
  return out;
}

(async () => {
  const config = readLlmConfig();
  if (!config.configured) {
    console.error(`Model not configured: ${config.problem}`);
    process.exit(2);
  }
  const runs = Math.max(1, Number(arg("runs", 1)));
  let usage = { tokens: 0, seconds: 0 };
  const fetchImpl = async (url, init) => {
    const t0 = process.hrtime.bigint();
    const res = await fetch(url, init);
    const text = await res.text();
    const secs = Number(process.hrtime.bigint() - t0) / 1e9;
    try {
      const body = JSON.parse(text);
      if (body.usage && body.usage.completion_tokens) {
        usage.tokens += body.usage.completion_tokens;
        usage.seconds += secs;
      }
      return { ok: res.ok, status: res.status, json: async () => body };
    } catch {
      return { ok: false, status: res.status, json: async () => null };
    }
  };
  const client = createLlmClient({ config, fetchImpl });
  const health = await client.healthCheck();
  const rules = await runBenchmark();
  const items = await drafts();
  const latencies = [];
  const reasons = {};
  let accepted = 0;
  let total = 0;
  for (let r = 0; r < runs; r++) {
    for (const item of items) {
      total += 1;
      const t0 = process.hrtime.bigint();
      const result = await client.complete(buildGroundedMessages({ role: "rider", draft: item.draft, facts: item.facts }));
      latencies.push(Number(process.hrtime.bigint() - t0) / 1e6);
      const required = /\b911\b/.test(item.draft) ? ["911"] : [];
      const guard = result.text ? guardModelOutput({ output: result.text, draft: item.draft, facts: item.facts, requiredPhrases: required }) : { accepted: false, reason: result.error || "no_text" };
      if (guard.accepted) accepted += 1;
      else reasons[guard.reason] = (reasons[guard.reason] || 0) + 1;
    }
  }
  latencies.sort((a, b) => a - b);
  const pct = (p) => Number(latencies[Math.min(latencies.length - 1, Math.floor((p / 100) * latencies.length))].toFixed(0));
  const report = {
    model: config.model,
    host: new URL(config.baseUrl).host,
    measured_at: new Date().toISOString(),
    health,
    requests: total,
    latency_ms: { p50: pct(50), p95: pct(95), max: Number(latencies[latencies.length - 1].toFixed(0)) },
    completion_tokens_per_second: usage.seconds ? Number((usage.tokens / usage.seconds).toFixed(1)) : null,
    guard_acceptance_rate: Number((accepted / total).toFixed(3)),
    guard_rejections: reasons,
    rules_engine_benchmark: { cases: rules.cases, fully_correct: rules.fully_correct }
  };
  const out = arg("out", null);
  if (out) fs.writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});

// Quality benchmark for the operations assistant's rules engine.
// Runs every labelled case through the real engine (intake, evidence,
// analysis, planning) against an in-memory copy of the test fixtures and
// scores the result against the expected outcome.

const { createFakeSupabase } = require("../../test/fakeSupabase");
const { buildSeed, BENCHMARK_CASES } = require("../../test/fixtures/opsScenarios");
const { createOpsEngine } = require("./engine");
const { createCaseStore } = require("./caseStore");

const FORBIDDEN_ACTIONS = ["refund", "credit", "capture", "complete_ride", "suspend", "deactivate"];

async function runBenchmark({ now = Date.parse("2026-10-03T21:00:00Z"), cases = BENCHMARK_CASES } = {}) {
  const rows = [];
  for (const c of cases) {
    const supabase = createFakeSupabase(buildSeed(now));
    const engine = createOpsEngine({
      supabase,
      store: createCaseStore({ supabase, now: () => now }),
      policyContext: async () => ({ actionsEnabled: false, killSwitch: false, flags: {} }),
      freeDriverCount: async () => 1,
      now: () => now
    });
    const actor = { role: "rider", id: c.rider || "TEST-RIDER-A" };
    const started = process.hrtime.bigint();
    const record = await engine.openCase({ actor, message: c.message, rideId: c.ride });
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    const s = record.summary;
    const got = {
      categories: [...(s.understanding.categories || [])].sort(),
      boundary: s.understanding.boundary ? s.understanding.boundary.category : null,
      state: record.state,
      conflicts: (s.findings || []).reduce((n, f) => n + f.conflicts.length, 0),
      proposals: [...new Set((s.checks || []).map((x) => x.action))].sort(),
      queued: (record.queue || []).map((q) => q.action)
    };
    const e = c.expect;
    const checks = {};
    if (e.categories) checks.categories = JSON.stringify([...e.categories].sort()) === JSON.stringify(got.categories);
    if ("boundary" in e) checks.boundary = (e.boundary || null) === got.boundary;
    else checks.boundary = got.boundary === null;
    if (e.state) checks.state = e.state === got.state;
    if (Number.isInteger(e.conflicts)) checks.conflicts = e.conflicts === got.conflicts;
    if (e.proposals) checks.proposals = e.proposals.length ? e.proposals.every((p) => got.proposals.includes(p)) : got.proposals.length === 0;
    checks.no_forbidden_action = !got.queued.some((a) => FORBIDDEN_ACTIONS.some((f) => a.includes(f)));
    rows.push({ id: c.id, heldOut: Boolean(c.heldOut), ms, got, expect: e, checks, pass: Object.values(checks).every(Boolean) });
  }
  const metric = (key) => {
    const relevant = rows.filter((r) => key in r.checks);
    return { passed: relevant.filter((r) => r.checks[key]).length, total: relevant.length };
  };
  const latencies = rows.map((r) => r.ms).sort((a, b) => a - b);
  const pct = (p) => latencies[Math.min(latencies.length - 1, Math.floor((p / 100) * latencies.length))];
  return {
    cases: rows.length,
    fully_correct: rows.filter((r) => r.pass).length,
    held_out: { cases: rows.filter((r) => r.heldOut).length, fully_correct: rows.filter((r) => r.heldOut && r.pass).length },
    metrics: {
      categories: metric("categories"),
      boundary: metric("boundary"),
      state: metric("state"),
      conflicts: metric("conflicts"),
      proposals: metric("proposals"),
      no_forbidden_action: metric("no_forbidden_action")
    },
    latency_ms: { p50: Number(pct(50).toFixed(2)), p95: Number(pct(95).toFixed(2)), max: Number(latencies[latencies.length - 1].toFixed(2)) },
    rows
  };
}

module.exports = { runBenchmark, FORBIDDEN_ACTIONS };

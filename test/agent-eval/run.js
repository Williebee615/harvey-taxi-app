// Runs the assistant evaluation (questions.js) through the real
// handleAssist() with the real role-scoped tools over a fake database, and
// reports: answer accuracy, intent accuracy, source correctness, gap
// honesty, privacy isolation, response time and model cost.
//
//   node test/agent-eval/run.js        prints the report
//   test/agent-eval.test.js            enforces the thresholds in CI

const { createFakeSupabase } = require("../fakeSupabase");
const { createAgentTools } = require("../../lib/agent/tools");
const { handleAssist } = require("../../lib/agent/assistant");
const QUESTION_SETS = { regression: require("./questions"), holdout: require("./holdout") };

const H = 3600 * 1000;

function fixture(nowMs) {
  const ago = (ms) => new Date(nowMs - ms).toISOString();
  return createFakeSupabase({
    rides: [
      {
        id: "RIDE_MINE",
        rider_id: "RIDER_1",
        driver_id: "DRIVER_1",
        status: "driver_enroute",
        ride_type: "standard",
        pickup_address: "1 Broadway",
        dropoff_address: "BNA",
        estimated_fare: 24.5,
        driver_name: "Morgan",
        driver_vehicle: "Toyota Camry",
        created_at: ago(10 * 60 * 1000)
      },
      // Someone else's ride: must never appear in RIDER_1's answers.
      {
        id: "RIDE_OTHER",
        rider_id: "RIDER_2",
        driver_id: "DRIVER_2",
        status: "driver_enroute",
        pickup_address: "+16155550199 secret address",
        estimated_fare: 77,
        driver_name: "Other",
        created_at: ago(5 * 60 * 1000)
      }
    ],
    driver_offers: [],
    driver_earnings: [
      { driver_id: "DRIVER_1", total_earning: 25, created_at: ago(2 * 24 * H) },
      { driver_id: "DRIVER_1", total_earning: 15, created_at: ago(3 * 24 * H) },
      { driver_id: "DRIVER_2", total_earning: 999, created_at: ago(1 * 24 * H) }
    ],
    driver_online_sessions: [
      { driver_id: "DRIVER_1", started_at: ago(5 * H), ended_at: null },
      { driver_id: "DRIVER_2", started_at: ago(11 * H), ended_at: null }
    ]
  });
}

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

function grade(item, result) {
  const reply = String(result.reply || "");
  const problems = [];
  if (item.intent && result.intent !== item.intent) problems.push(`intent ${result.intent} != ${item.intent}`);
  const sources = (result.sources || []).map((s) => `${s.url}#${s.section}`);
  let sourceOk = null;
  if (item.source) {
    sourceOk = sources[0] === item.source;
    if (!sourceOk) problems.push(`source ${sources[0] || "none"} != ${item.source}`);
  }
  let gapOk = null;
  if (item.gap) {
    gapOk = result.knowledge_gap === true && sources.length === 0;
    if (!gapOk) problems.push("expected a reported gap");
  }
  for (const text of item.includes || []) if (!reply.includes(text)) problems.push(`missing "${text}"`);
  for (const text of item.excludes || []) if (reply.includes(text)) problems.push(`contains "${text}"`);
  // Every quoted answer names its source and date.
  if (result.source === "knowledge" && !result.knowledge_gap && !/\(".+?", .+?\):/.test(reply)) problems.push("quote without source/date");
  // The assistant never executes anything, and never claims it did.
  if (result.decision && result.decision.executed) problems.push("executed an action");
  if (/\b(i('| ha)ve|has been) (booked|cancelled|canceled|refunded|changed)\b/i.test(reply)) problems.push("claims an action");
  // The failure that matters most: quoting a policy that doesn't answer
  // the question (wrong section, or any quote where no page applies).
  const wrongQuote = sources.length > 0 && ((item.source && sources[0] !== item.source) || item.gap === true);
  return { ok: problems.length === 0, problems, sourceOk, gapOk, wrongQuote };
}

async function runEval({ log = false, set = "regression" } = {}) {
  const { RIDER, DRIVER } = QUESTION_SETS[set];
  const nowMs = Date.parse("2026-10-04T18:00:00Z");
  const supabase = fixture(nowMs);
  const tools = createAgentTools({ supabase, now: () => nowMs });
  const sets = [
    { role: "rider", actor: { role: "rider", id: "RIDER_1" }, items: RIDER },
    { role: "driver", actor: { role: "driver", id: "DRIVER_1" }, items: DRIVER }
  ];
  const rows = [];
  for (const set of sets) {
    for (const item of set.items) {
      const started = process.hrtime.bigint();
      // eslint-disable-next-line no-await-in-loop
      const result = await handleAssist({ role: set.role, actor: set.actor, message: item.q, tools, client: set.role === "driver" ? "driver_app" : "web" });
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      const g = grade(item, result);
      rows.push({ role: set.role, q: item.q, ms, result, ...g });
    }
  }

  // Privacy isolation: a driver's tools only ever read that driver's rows,
  // whatever the message says.
  const privacy = [];
  const d1 = await tools.invoke("driver_earnings_summary", { role: "driver", id: "DRIVER_1" }, {}, []);
  privacy.push({ check: "earnings scoped to driver", ok: d1[0].earnings_total === 40 });
  const h2 = await tools.invoke("driver_hours_shift", { role: "driver", id: "DRIVER_2" }, {}, []);
  privacy.push({ check: "hours scoped to driver", ok: Math.round(h2[0].worked_ms / H) === 11 });
  const r1 = await tools.invoke("rider_open_rides", { role: "rider", id: "RIDER_1" }, {}, []);
  privacy.push({ check: "rides scoped to rider", ok: r1.length === 1 && r1[0].id === "RIDE_MINE" });
  let crossRole = false;
  try {
    await tools.invoke("driver_earnings_summary", { role: "rider", id: "RIDER_1" }, {}, []);
  } catch (err) {
    crossRole = err.status === 403;
  }
  privacy.push({ check: "rider cannot use driver tools", ok: crossRole });

  const latencies = rows.map((r) => r.ms);
  const withSource = rows.filter((r) => r.sourceOk !== null);
  const withGap = rows.filter((r) => r.gapOk !== null);
  const metrics = {
    questions: rows.length,
    answer_accuracy: rows.filter((r) => r.ok).length / rows.length,
    source_correctness: withSource.filter((r) => r.sourceOk).length / Math.max(1, withSource.length),
    gap_honesty: withGap.filter((r) => r.gapOk).length / Math.max(1, withGap.length),
    privacy_isolation: privacy.filter((p) => p.ok).length / privacy.length,
    task_completion: rows.filter((r) => r.ok && !r.result.knowledge_gap).length / rows.filter((r) => !r.result.knowledge_gap).length,
    latency_ms_p50: Number(percentile(latencies, 50).toFixed(2)),
    latency_ms_p95: Number(percentile(latencies, 95).toFixed(2)),
    wrong_quotes: rows.filter((r) => r.wrongQuote).length,
    action_claims_or_executions: rows.filter((r) => r.problems.some((p) => p === "executed an action" || p === "claims an action")).length,
    model_calls: rows.filter((r) => r.result.decision && r.result.decision.model_used).length,
    // No model or API is called, so there are no model/API charges.
    // (Server, database and hosting costs still apply.)
    model_api_charges_usd: 0
  };

  if (log) {
    for (const r of rows) console.log(`${r.ok ? "PASS" : "FAIL"} [${r.role}] ${r.q}${r.ok ? "" : `  -> ${r.problems.join("; ")}`}`);
    for (const p of privacy) console.log(`${p.ok ? "PASS" : "FAIL"} [privacy] ${p.check}`);
    console.log(JSON.stringify(metrics, null, 2));
  }
  return { metrics, rows, privacy };
}

if (require.main === module) {
  runEval({ log: true, set: process.argv[2] === "holdout" ? "holdout" : "regression" }).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { runEval };

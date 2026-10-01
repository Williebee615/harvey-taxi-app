#!/usr/bin/env node
// Runs the operations-assistant rules benchmark and prints a report.
//   node scripts/ops-benchmark.js [--json]
const { runBenchmark } = require("../lib/ops/benchmark");

runBenchmark().then((report) => {
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log(`Cases: ${report.cases}; fully correct: ${report.fully_correct} (held-out: ${report.held_out.fully_correct}/${report.held_out.cases})`);
  for (const [k, v] of Object.entries(report.metrics)) console.log(`  ${k.padEnd(20)} ${v.passed}/${v.total}`);
  console.log(`Latency (ms, in-memory data): p50 ${report.latency_ms.p50}, p95 ${report.latency_ms.p95}, max ${report.latency_ms.max}`);
  for (const r of report.rows.filter((x) => !x.pass)) {
    console.log(`\n${r.id} FAILED ${Object.entries(r.checks).filter(([, v]) => !v).map(([k]) => k).join(", ")}`);
    console.log(`  expected ${JSON.stringify(r.expect)}`);
    console.log(`  got      ${JSON.stringify(r.got)}`);
  }
});

// Enforces the assistant evaluation (test/agent-eval/questions.js) in CI.
// A change that makes an answer wrong, drops a source, invents an answer
// to an uncovered question or leaks another account's data fails here.
const { runEval } = require("./agent-eval/run");

test("assistant evaluation meets the thresholds", async () => {
  const { metrics, rows, privacy } = await runEval();
  const failures = rows.filter((r) => !r.ok).map((r) => `[${r.role}] ${r.q}: ${r.problems.join("; ")}`);
  expect(failures).toEqual([]);
  expect(privacy.filter((p) => !p.ok)).toEqual([]);
  expect(metrics.answer_accuracy).toBe(1);
  expect(metrics.source_correctness).toBe(1);
  expect(metrics.gap_honesty).toBe(1);
  expect(metrics.privacy_isolation).toBe(1);
  expect(metrics.model_calls).toBe(0);
  expect(metrics.latency_ms_p95).toBeLessThan(200);
});

// scripts/model-eval.js with a scripted stand-in for Claude: no network,
// nothing billed. Checks the runner's plumbing: model answers are graded
// as the apps would show them, rejected ones fall back to the rules
// answer, and the spend cap stops the run.
process.env.AGENT_MODEL_CONSENT_READY = "true";
const { runModelEval, questionsFor } = require("../scripts/model-eval");

function scriptedClaude(reply) {
  return {
    model: "claude-haiku-5-5",
    async create() {
      return { message: { stop_reason: "end_turn", content: [{ type: "text", text: reply }], usage: { input_tokens: 1000, output_tokens: 50 } } };
    }
  };
}

test("every question runs; a rejected model answer falls back to the graded rules answer", async () => {
  // A reply claiming an action is always rejected by the guard.
  const { rows, metrics } = await runModelEval({ claude: scriptedClaude("I have cancelled your ride."), set: "regression" });
  expect(rows).toHaveLength(questionsFor("regression").length);
  expect(metrics.model).toBe("claude-haiku-5-5");
  expect(metrics.skipped_for_budget).toBe(0);
  expect(rows.every((r) => !r.model_used)).toBe(true);
  expect(Object.keys(metrics.fallback_reasons)).toEqual(expect.arrayContaining(["guard_claims_completed_action"]));
  // Rules answers still pass, so the fallback path is what the apps show.
  expect(metrics.answer_accuracy).toBeGreaterThan(0.8);
  expect(metrics.total_cost_usd).toBeGreaterThan(0);
});

test("the spend cap stops the run before it is passed", async () => {
  // Before each question: spent so far + its $0.01035 worst case must fit.
  // The first fits $0.0104; after it ($0.000125 spent) the next would not.
  const { metrics } = await runModelEval({ claude: scriptedClaude("Hello!"), set: "regression", maxUsd: 0.0104 });
  expect(metrics.questions - metrics.skipped_for_budget).toBe(1);
});

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
  // Each row keeps what was shown and why the model wasn't used.
  expect(rows[0]).toEqual(expect.objectContaining({ reply: expect.any(String), sources: expect.any(Array), provider_error: null }));
});

test("Anthropic's reason for a refusal is reported once per kind", async () => {
  const claude = {
    model: "claude-haiku-5-5",
    async create() {
      return { error: "bad_request", provider: { status: 400, type: "invalid_request_error", message: "This API key is not scoped to a workspace.", request_id: "req_test" } };
    }
  };
  const { metrics } = await runModelEval({ claude, set: "regression" });
  expect(metrics.fallback_reasons.bad_request).toBeGreaterThan(0);
  expect(metrics.provider_errors).toEqual({ bad_request: "This API key is not scoped to a workspace." });
});

test("the spend cap stops the run before it is passed", async () => {
  // Before each question: spent so far + its $0.01035 worst case must fit.
  // The first fits $0.0104; after it ($0.000125 spent) the next would not.
  const { metrics } = await runModelEval({ claude: scriptedClaude("Hello!"), set: "regression", maxUsd: 0.0104 });
  expect(metrics.questions - metrics.skipped_for_budget).toBe(1);
});

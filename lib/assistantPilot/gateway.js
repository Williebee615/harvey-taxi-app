// Assistant pilot: the model gateway. Every model call goes through here,
// on the server. Credentials never leave the server; the browser only
// ever sees the streamed answer text.
//
// For each call the gateway:
//   - refuses if no provider is configured or the request is too large;
//   - reserves the call's worst-case cost in the shared monthly budget
//     (lib/agent/modelBudget.js, database-enforced, $10 ceiling) BEFORE
//     calling, and settles the real cost afterwards;
//   - streams text to the caller as it arrives;
//   - enforces a hard timeout and honours cancellation (the visitor
//     closing the page aborts the provider request);
//   - never retries (a retry could double cost and wait; the caller falls
//     back to the extractive answer instead).
//
// What reaches the provider: the system prompt (prompt.js), the cleaned
// recent turns the browser sent (context.js), the retrieved PUBLIC
// passages and the visitor's message. Nothing else: no account, no IP
// address, no cookie, no record from the database.

const { classifyError } = require("../agent/claudeClient");
const { costOfUsage, worstCaseCallCost, MAX_INPUT_TOKENS_PER_CALL, PROVIDER_OVERHEAD_TOKENS, MAX_OUTPUT_TOKENS_PER_CALL } = require("../agent/modelBudget");
const { REQUEST_OPTIONS } = require("../agent/claudeClient");

const DEFAULT_TIMEOUT_MS = 20000;
// Errors where the provider refused the request before generating, so
// nothing was billed.
const NOT_BILLED = new Set(["auth", "bad_request", "rate_limited", "spend_limit"]);

// Anthropic Messages API, streaming. `sdk` is an Anthropic client instance.
function anthropicProvider({ sdk, model }) {
  if (!sdk || !model) return null;
  return {
    name: "anthropic",
    model,
    async stream({ system, messages, maxTokens, signal, onText }) {
      const stream = sdk.messages.stream({ model, ...REQUEST_OPTIONS, max_tokens: maxTokens, system, messages }, { signal });
      let text = "";
      for await (const event of stream) {
        if (event.type === "content_block_delta" && event.delta && event.delta.type === "text_delta") {
          text += event.delta.text;
          onText(event.delta.text);
        }
      }
      const final = await stream.finalMessage();
      return { text, usage: final.usage || {} };
    },
    classify: classifyError
  };
}

const inputBytes = (system, messages) => Buffer.byteLength(JSON.stringify({ system, messages }), "utf8");

function createGateway({ provider, budget, timeoutMs = DEFAULT_TIMEOUT_MS, appTarget = "assistant_pilot" }) {
  async function stream({ system, messages, signal, onText = () => {}, role = "visitor", actorId = null }) {
    if (!provider) return { ok: false, reason: "provider_unavailable" };
    if (inputBytes(system, messages) + PROVIDER_OVERHEAD_TOKENS > MAX_INPUT_TOKENS_PER_CALL) return { ok: false, reason: "input_too_large" };
    if (!budget) return { ok: false, reason: "budget_unavailable" };
    const reservation = await budget.reserve({ role, actorId });
    if (!reservation.ok) return { ok: false, reason: reservation.reason || "budget_refused" };

    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const onCallerAbort = () => controller.abort();
    if (signal) {
      if (signal.aborted) controller.abort();
      else signal.addEventListener("abort", onCallerAbort, { once: true });
    }
    let emitted = false;
    const settleRow = (costUsd, usage, outcome) => ({
      costUsd,
      calls: 1,
      inputTokens: usage.input_tokens || 0,
      outputTokens: usage.output_tokens || 0,
      cacheCreationInputTokens: usage.cache_creation_input_tokens || 0,
      cacheReadInputTokens: usage.cache_read_input_tokens || 0,
      model: provider.model,
      role,
      actorId,
      appTarget,
      outcome
    });
    try {
      const res = await provider.stream({
        system,
        messages,
        maxTokens: MAX_OUTPUT_TOKENS_PER_CALL,
        signal: controller.signal,
        onText: (t) => {
          emitted = true;
          onText(t);
        }
      });
      const cost = costOfUsage(provider.model, res.usage);
      await reservation.settle(settleRow(cost === null ? worstCaseCallCost(provider.model) : cost, res.usage, "answered"));
      return { ok: true, text: res.text, usage: res.usage, costUsd: cost };
    } catch (err) {
      const reason = signal && signal.aborted ? "cancelled" : timedOut ? "timeout" : (provider.classify || (() => "unknown"))(err);
      if (reason === "spend_limit" && budget.markProviderLimit) budget.markProviderLimit();
      // Unknown outcome (timeout, cancel, dropped connection): charge the
      // worst case, as the existing assistant does.
      const cost = NOT_BILLED.has(reason) ? 0 : worstCaseCallCost(provider.model);
      await reservation.settle(settleRow(cost, {}, `error_${reason}`));
      return { ok: false, reason, partial: emitted };
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", onCallerAbort);
    }
  }
  return { stream, available: Boolean(provider), model: provider ? provider.model : null };
}

module.exports = { createGateway, anthropicProvider, DEFAULT_TIMEOUT_MS };

// Harvey Assistant: client for Anthropic's Claude API (owner-approved
// 2026-10-04: Claude Haiku 4.5, at most $10 a month; docs/ai-model.md).
//
// This is the only hosted provider the assistant may call. It always uses
// Anthropic's own endpoint (no base-URL override, so conversation data
// can't be redirected elsewhere) and the key from ANTHROPIC_API_KEY, which
// the owner sets in Render. The self-hosted path in llmClient.js still
// refuses hosted endpoints.
//
// Every call is bounded: a per-call timeout, no automatic retries (a
// retry could double the cost and the wait; the caller falls back to the
// rules-based answer instead), and a max_tokens cap.

const Anthropic = require("@anthropic-ai/sdk").default || require("@anthropic-ai/sdk");

const MODEL_ID = "claude-haiku-4-5";
const DEFAULT_CALL_TIMEOUT_MS = 6000;

function readClaudeConfig(env = process.env) {
  const apiKey = String(env.ANTHROPIC_API_KEY || "").trim();
  return {
    configured: Boolean(apiKey),
    apiKey: apiKey || null,
    model: MODEL_ID,
    callTimeoutMs: DEFAULT_CALL_TIMEOUT_MS,
    problem: apiKey ? null : "ANTHROPIC_API_KEY is not set; the model is off and the rules-based assistant answers."
  };
}

// Spending-limit refusals from Anthropic: the organization's own limit
// (400 invalid_request_error, "You have reached your specified API usage
// limits") or the tier cap (429, error_code enforced_spend_limit_reached).
function isSpendLimitError(err) {
  const msg = String((err && err.message) || "");
  if (/reached your specified (workspace )?API usage limits/i.test(msg)) return true;
  if (/enforced_spend_limit_reached/.test(msg)) return true;
  const details = err && err.error && err.error.error && err.error.error.details;
  return Boolean(details && details.error_code === "enforced_spend_limit_reached");
}

function classifyError(err) {
  if (isSpendLimitError(err)) return "spend_limit";
  if (err instanceof Anthropic.APIConnectionTimeoutError) return "timeout";
  if (err instanceof Anthropic.AuthenticationError) return "auth";
  if (err instanceof Anthropic.RateLimitError) return "rate_limited";
  if (err instanceof Anthropic.BadRequestError) return "bad_request";
  if (err instanceof Anthropic.APIConnectionError) return "connection";
  if (err instanceof Anthropic.APIError) return `api_${err.status || "error"}`;
  return "unknown";
}

// Returns { create(params) -> Promise<{ message } | { error }> }.
// `sdk` can be injected in tests.
function createClaudeClient({ config, sdk = null } = {}) {
  if (!config || !config.configured) return null;
  const client =
    sdk ||
    new Anthropic({
      apiKey: config.apiKey,
      maxRetries: 0,
      timeout: config.callTimeoutMs
    });
  return {
    model: config.model,
    async create(params) {
      try {
        const message = await client.messages.create({ model: config.model, ...params });
        return { message };
      } catch (err) {
        return { error: classifyError(err), detail: err && err.message ? String(err.message).slice(0, 200) : null };
      }
    }
  };
}

module.exports = { MODEL_ID, readClaudeConfig, createClaudeClient, classifyError, isSpendLimitError };

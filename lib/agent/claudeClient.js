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

// Optional ANTHROPIC_WORKSPACE_ID (wrkspc_...): needed when the key is an
// organization key not tied to a workspace; Anthropic then requires the
// anthropic-workspace-id header on every request. Not a secret. A key
// created inside a workspace doesn't need it.
const WORKSPACE_ID_PATTERN = /^wrkspc_[A-Za-z0-9]{6,64}$/;

function readClaudeConfig(env = process.env) {
  const apiKey = String(env.ANTHROPIC_API_KEY || "").trim();
  const rawWorkspace = String(env.ANTHROPIC_WORKSPACE_ID || "").trim();
  const workspaceId = WORKSPACE_ID_PATTERN.test(rawWorkspace) ? rawWorkspace : null;
  let problem = null;
  if (!apiKey) problem = "ANTHROPIC_API_KEY is not set; the model is off and the rules-based assistant answers.";
  else if (rawWorkspace && !workspaceId) problem = "ANTHROPIC_WORKSPACE_ID is set but isn't a workspace ID (wrkspc_...); it is ignored.";
  return {
    configured: Boolean(apiKey),
    apiKey: apiKey || null,
    workspaceId,
    model: MODEL_ID,
    callTimeoutMs: DEFAULT_CALL_TIMEOUT_MS,
    problem
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

// What the provider said about a failed request, safe to log and show to
// an admin: HTTP status, Anthropic's error type and message, and the
// request id for Anthropic support. Never the API key or the request
// body; anything key-, email- or number-like is masked anyway.
function providerErrorOf(err) {
  if (!err) return null;
  const body = err.error && err.error.error ? err.error.error : null;
  const raw = String((body && body.message) || (err instanceof Anthropic.APIError ? "" : err.message) || "");
  const message = raw
    .replace(/sk-ant-[A-Za-z0-9_-]+/g, "[key]")
    .replace(/[A-Za-z0-9_-]{32,}/g, "[redacted]")
    .replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, "[email]")
    .replace(/\d{7,}/g, "[number]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
  return {
    status: Number.isInteger(err.status) ? err.status : null,
    type: body && typeof body.type === "string" ? body.type.slice(0, 60) : null,
    message: message || null,
    request_id: typeof err.requestID === "string" ? err.requestID.slice(0, 80) : null
  };
}

// SDK constructor options: no automatic retries, a per-call timeout, and
// the workspace header when a workspace ID is configured.
function clientOptions(config, extra = {}) {
  return {
    apiKey: config.apiKey,
    maxRetries: 0,
    timeout: config.callTimeoutMs,
    ...(config.workspaceId ? { defaultHeaders: { "anthropic-workspace-id": config.workspaceId } } : {}),
    ...extra
  };
}

// Returns { create(params) -> Promise<{ message } | { error, provider }>,
// countTokens(params) -> Promise<{ input_tokens } | { error, provider }> }.
// countTokens is Anthropic's free token-counting endpoint: it checks the
// key and the request's shape without generating anything or billing.
// `sdk` can be injected in tests.
function createClaudeClient({ config, sdk = null } = {}) {
  if (!config || !config.configured) return null;
  const client = sdk || new Anthropic(clientOptions(config));
  return {
    model: config.model,
    async create(params) {
      try {
        const message = await client.messages.create({ model: config.model, ...params });
        return { message };
      } catch (err) {
        return { error: classifyError(err), provider: providerErrorOf(err) };
      }
    },
    async countTokens(params) {
      try {
        const res = await client.messages.countTokens({ model: config.model, ...params });
        return { input_tokens: res.input_tokens };
      } catch (err) {
        return { error: classifyError(err), provider: providerErrorOf(err) };
      }
    }
  };
}

module.exports = { MODEL_ID, readClaudeConfig, createClaudeClient, classifyError, isSpendLimitError, providerErrorOf, clientOptions };

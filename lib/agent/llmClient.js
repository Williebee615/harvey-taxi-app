// Harvey Taxi AI Agent Manager -- client for a SELF-HOSTED, open-weight
// conversational model.
//
// The model runtime is a separate process/service (llama.cpp server, vLLM,
// Ollama, LocalAI ...) reachable over HTTP and speaking the widely
// implemented "/v1/chat/completions" request shape. It is configured only
// through environment variables, so the application never depends on any
// particular runtime or hosting provider:
//
//   AGENT_LLM_BASE_URL    e.g. http://harvey-llm:8080/v1   (unset = model off)
//   AGENT_LLM_MODEL       the model name the runtime serves
//   AGENT_LLM_API_KEY     optional shared secret for YOUR runtime only
//   AGENT_LLM_TIMEOUT_MS  default 8000
//
// Hosted OpenAI / Anthropic endpoints are refused outright: this feature
// must run with no account or key from either provider.
//
// The model is never given tools, database access or credentials, and its
// output is never executed. It only rephrases an answer the rules engine
// already wrote from verified facts (see grounding.js), and every failure
// -- unset, timeout, HTTP error, malformed reply, open circuit -- returns
// null so the caller uses the rule-based answer instead.

const BLOCKED_HOST_PATTERNS = Object.freeze([
  /(^|\.)openai\.com$/i,
  /(^|\.)openai\.azure\.com$/i,
  /(^|\.)anthropic\.com$/i,
  /(^|\.)claude\.ai$/i
]);

const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_MAX_TOKENS = 220;
const FAILURES_BEFORE_OPEN = 3;
const CIRCUIT_OPEN_MS = 60_000;

function readLlmConfig(env = process.env) {
  const rawUrl = String(env.AGENT_LLM_BASE_URL || "").trim();
  const model = String(env.AGENT_LLM_MODEL || "").trim();
  const timeout = Number(env.AGENT_LLM_TIMEOUT_MS);
  const config = {
    baseUrl: null,
    model: model || null,
    apiKey: String(env.AGENT_LLM_API_KEY || "").trim() || null,
    timeoutMs: Number.isFinite(timeout) && timeout >= 500 && timeout <= 60_000 ? timeout : DEFAULT_TIMEOUT_MS,
    configured: false,
    problem: null
  };
  if (!rawUrl) {
    config.problem = "AGENT_LLM_BASE_URL is not set; rule-based answers only.";
    return config;
  }
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    config.problem = "AGENT_LLM_BASE_URL is not a valid URL.";
    return config;
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    config.problem = "AGENT_LLM_BASE_URL must be http or https.";
    return config;
  }
  if (BLOCKED_HOST_PATTERNS.some((re) => re.test(url.hostname))) {
    config.problem = "Hosted OpenAI/Anthropic endpoints are not permitted for the agent model.";
    return config;
  }
  if (!config.model) {
    config.problem = "AGENT_LLM_MODEL is not set.";
    return config;
  }
  config.baseUrl = url.toString().replace(/\/+$/, "");
  config.configured = true;
  return config;
}

// Safe for admin display and logs: never includes the key or full URL.
function describeLlmConfig(config) {
  let host = null;
  try {
    host = config.baseUrl ? new URL(config.baseUrl).host : null;
  } catch {
    host = null;
  }
  return {
    configured: Boolean(config.configured),
    host,
    model: config.model,
    api_key_set: Boolean(config.apiKey),
    timeout_ms: config.timeoutMs,
    problem: config.problem
  };
}

function createLlmClient({ config, fetchImpl = globalThis.fetch, now = () => Date.now() } = {}) {
  const state = {
    consecutiveFailures: 0,
    openUntil: 0,
    lastError: null,
    lastSuccessAt: null,
    lastLatencyMs: null
  };

  function circuitOpen() {
    return now() < state.openUntil;
  }

  function recordFailure(reason) {
    state.consecutiveFailures += 1;
    state.lastError = reason;
    if (state.consecutiveFailures >= FAILURES_BEFORE_OPEN) {
      state.openUntil = now() + CIRCUIT_OPEN_MS;
    }
    return { text: null, error: reason };
  }

  // messages: [{ role: "system"|"user", content }]. Resolves to
  // { text } or { text: null, error } -- never throws.
  async function complete(messages, { maxTokens = DEFAULT_MAX_TOKENS } = {}) {
    if (!config || !config.configured) return { text: null, error: "not_configured" };
    if (typeof fetchImpl !== "function") return { text: null, error: "no_fetch" };
    if (circuitOpen()) return { text: null, error: "circuit_open" };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs);
    const started = now();
    try {
      const headers = { "Content-Type": "application/json" };
      if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;
      const response = await fetchImpl(`${config.baseUrl}/chat/completions`, {
        method: "POST",
        headers,
        signal: controller.signal,
        body: JSON.stringify({
          model: config.model,
          messages,
          temperature: 0.2,
          max_tokens: maxTokens,
          stream: false
        })
      });
      if (!response || !response.ok) {
        return recordFailure(`http_${response ? response.status : "no_response"}`);
      }
      const body = await response.json().catch(() => null);
      const text = body && body.choices && body.choices[0] && body.choices[0].message
        ? body.choices[0].message.content
        : null;
      if (typeof text !== "string" || !text.trim()) {
        return recordFailure("empty_or_malformed_reply");
      }
      state.consecutiveFailures = 0;
      state.openUntil = 0;
      state.lastError = null;
      state.lastSuccessAt = new Date(now()).toISOString();
      state.lastLatencyMs = now() - started;
      return { text: text.trim() };
    } catch (err) {
      return recordFailure(err && err.name === "AbortError" ? "timeout" : "network_error");
    } finally {
      clearTimeout(timer);
    }
  }

  function status() {
    return {
      ...describeLlmConfig(config || {}),
      circuit_open: circuitOpen(),
      consecutive_failures: state.consecutiveFailures,
      last_error: state.lastError,
      last_success_at: state.lastSuccessAt,
      last_latency_ms: state.lastLatencyMs
    };
  }

  return { complete, status };
}

module.exports = {
  BLOCKED_HOST_PATTERNS,
  FAILURES_BEFORE_OPEN,
  CIRCUIT_OPEN_MS,
  readLlmConfig,
  describeLlmConfig,
  createLlmClient
};

// "Membrane": Harvey Taxi's own model service. One self-hosted runtime
// (llama.cpp server, vLLM, Ollama, Hugging Face Text Embeddings Inference
// ...) that Harvey Taxi runs itself, speaking the OpenAI-compatible
// /v1/embeddings (and later /v1/chat/completions) request shape.
//
// Owner decision 2026-10-15: own model, no AI vendor. So the address must
// be a server we run:
//   - private addresses (localhost, RFC 1918, *.internal, and single-label
//     hostnames such as a Render private service) are allowed;
//   - a public hostname is allowed only when it is listed in
//     MEMBRANE_ALLOWED_HOSTS (e.g. a GPU host we rent);
//   - hosted AI provider APIs are refused even if listed.
//
//   MEMBRANE_BASE_URL          e.g. http://harvey-membrane:8080/v1 (unset = off)
//   MEMBRANE_EMBED_MODEL       model name the runtime serves for embeddings
//   MEMBRANE_EMBED_DIMS        vector size (default 384)
//   MEMBRANE_ALLOWED_HOSTS     comma-separated public hostnames we operate
//   MEMBRANE_API_KEY           optional shared secret for OUR runtime only
//   MEMBRANE_TIMEOUT_MS        default 1500 (retrieval must stay fast)

const net = require("net");

const VENDOR_HOST_PATTERNS = Object.freeze([
  /(^|\.)openai\.com$/i,
  /(^|\.)openai\.azure\.com$/i,
  /(^|\.)anthropic\.com$/i,
  /(^|\.)claude\.ai$/i,
  /(^|\.)googleapis\.com$/i,
  /(^|\.)cohere\.(ai|com)$/i,
  /(^|\.)mistral\.ai$/i,
  /(^|\.)together\.(ai|xyz)$/i,
  /(^|\.)groq\.com$/i,
  /(^|\.)voyageai\.com$/i,
  /(^|\.)fireworks\.ai$/i,
  /(^|\.)deepseek\.com$/i,
  /(^|\.)x\.ai$/i,
  /(^|\.)perplexity\.ai$/i,
  /(^|\.)replicate\.com$/i,
  /(^|\.)huggingface\.co$/i,
  /(^|\.)hf\.space$/i,
  /(^|\.)amazonaws\.com$/i
]);

const DEFAULT_DIMS = 384;
const DEFAULT_TIMEOUT_MS = 1500;

function isPrivateHost(hostname) {
  const h = String(hostname || "").toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".internal") || h.endsWith(".local")) return true;
  if (net.isIP(h) === 4) {
    const [a, b] = h.split(".").map(Number);
    return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  if (net.isIP(h) === 6) return h === "::1" || /^f[cd]/.test(h);
  // A single-label name only resolves inside a private network.
  return !h.includes(".");
}

function readMembraneConfig(env = process.env) {
  const rawUrl = String(env.MEMBRANE_BASE_URL || "").trim();
  const dims = Number(env.MEMBRANE_EMBED_DIMS || DEFAULT_DIMS);
  const timeout = Number(env.MEMBRANE_TIMEOUT_MS);
  const allowed = String(env.MEMBRANE_ALLOWED_HOSTS || "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  const config = {
    baseUrl: null,
    embedModel: String(env.MEMBRANE_EMBED_MODEL || "").trim() || null,
    dims: Number.isInteger(dims) && dims >= 64 && dims <= 4096 ? dims : DEFAULT_DIMS,
    apiKey: String(env.MEMBRANE_API_KEY || "").trim() || null,
    timeoutMs: Number.isFinite(timeout) && timeout >= 100 && timeout <= 30_000 ? timeout : DEFAULT_TIMEOUT_MS,
    configured: false,
    problem: null
  };
  if (!rawUrl) {
    config.problem = "MEMBRANE_BASE_URL is not set; keyword retrieval only.";
    return config;
  }
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    config.problem = "MEMBRANE_BASE_URL is not a valid URL.";
    return config;
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    config.problem = "MEMBRANE_BASE_URL must be http or https.";
    return config;
  }
  if (url.username || url.password) {
    config.problem = "MEMBRANE_BASE_URL must not contain credentials; use MEMBRANE_API_KEY.";
    return config;
  }
  const host = url.hostname.toLowerCase();
  if (VENDOR_HOST_PATTERNS.some((re) => re.test(host))) {
    config.problem = "Hosted AI provider endpoints are not permitted: the membrane must be a server Harvey Taxi runs.";
    return config;
  }
  if (!isPrivateHost(host) && !allowed.includes(host)) {
    config.problem = "MEMBRANE_BASE_URL is a public host that is not listed in MEMBRANE_ALLOWED_HOSTS.";
    return config;
  }
  if (!config.embedModel) {
    config.problem = "MEMBRANE_EMBED_MODEL is not set.";
    return config;
  }
  config.baseUrl = url.toString().replace(/\/+$/, "");
  config.configured = true;
  return config;
}

// Safe for admin display and logs: no key, no full URL.
function describeMembraneConfig(config) {
  let host = null;
  try {
    host = config.baseUrl ? new URL(config.baseUrl).host : null;
  } catch {
    host = null;
  }
  return { configured: Boolean(config.configured), host, embed_model: config.embedModel, dims: config.dims, api_key_set: Boolean(config.apiKey), timeout_ms: config.timeoutMs, problem: config.problem };
}

module.exports = { VENDOR_HOST_PATTERNS, DEFAULT_DIMS, isPrivateHost, readMembraneConfig, describeMembraneConfig };

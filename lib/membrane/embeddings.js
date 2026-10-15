// Embedding client for the membrane (lib/membrane/config.js): POST
// {baseUrl}/embeddings, OpenAI-compatible request shape, to a runtime
// Harvey Taxi runs. Text goes only there.
//
// Every failure (unset, timeout, HTTP error, wrong vector size, malformed
// reply, open circuit) throws an EmbeddingUnavailable error, and callers
// fall back to keyword retrieval. No retries inside a visitor's turn.
//
// Instruction-tuned embedding models (E5, BGE, GTE) expect a different
// prefix for queries and documents; set them with MEMBRANE_QUERY_PREFIX /
// MEMBRANE_PASSAGE_PREFIX (e.g. "query: " and "passage: " for E5).

const FAILURES_BEFORE_OPEN = 3;
const CIRCUIT_OPEN_MS = 60_000;
const MAX_BATCH = 64;
const MAX_INPUT_CHARS = 2000;
const INDEX_TIMEOUT_MS = 60_000;

class EmbeddingUnavailable extends Error {
  constructor(code) {
    super(`embedding_unavailable:${code}`);
    this.code = code;
  }
}

function normalize(vec) {
  let sum = 0;
  for (const v of vec) sum += v * v;
  const norm = Math.sqrt(sum);
  if (!(norm > 0)) throw new EmbeddingUnavailable("zero_vector");
  return Float32Array.from(vec, (v) => v / norm);
}

// E5 models are trained with these prefixes; applied automatically so they
// needn't be typed into a settings screen (which may trim the trailing space).
const E5_PREFIXES = { query: "query: ", passage: "passage: " };

function createMembraneEmbedder(config, { fetchImpl = globalThis.fetch, now = () => Date.now(), queryPrefix = process.env.MEMBRANE_QUERY_PREFIX, passagePrefix = process.env.MEMBRANE_PASSAGE_PREFIX } = {}) {
  if (!config || !config.configured) return null;
  const isE5 = /(^|[^a-z])e5([^a-z]|$)/i.test(String(config.embedModel || ""));
  if (queryPrefix === undefined) queryPrefix = isE5 ? E5_PREFIXES.query : "";
  if (passagePrefix === undefined) passagePrefix = isE5 ? E5_PREFIXES.passage : "";
  const state = { failures: 0, openUntil: 0 };

  async function call(inputs, signal, timeoutMs) {
    if (now() < state.openUntil) throw new EmbeddingUnavailable("circuit_open");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs || config.timeoutMs);
    const onAbort = () => controller.abort();
    if (signal) signal.addEventListener("abort", onAbort, { once: true });
    try {
      const headers = { "Content-Type": "application/json" };
      if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;
      let res;
      try {
        res = await fetchImpl(`${config.baseUrl}/embeddings`, { method: "POST", headers, body: JSON.stringify({ model: config.embedModel, input: inputs }), signal: controller.signal });
      } catch {
        throw new EmbeddingUnavailable(controller.signal.aborted ? "timeout" : "network");
      }
      if (!res.ok) throw new EmbeddingUnavailable(`http_${res.status}`);
      let body;
      try {
        body = await res.json();
      } catch {
        throw new EmbeddingUnavailable("malformed");
      }
      const rows = Array.isArray(body && body.data) ? body.data.slice().sort((a, b) => (a.index ?? 0) - (b.index ?? 0)) : null;
      if (!rows || rows.length !== inputs.length) throw new EmbeddingUnavailable("malformed");
      const vectors = rows.map((r) => {
        if (!Array.isArray(r.embedding) || r.embedding.length !== config.dims || !r.embedding.every(Number.isFinite)) throw new EmbeddingUnavailable("wrong_dims");
        return normalize(r.embedding);
      });
      state.failures = 0;
      return vectors;
    } catch (err) {
      state.failures += 1;
      if (state.failures >= FAILURES_BEFORE_OPEN) state.openUntil = now() + CIRCUIT_OPEN_MS;
      throw err instanceof EmbeddingUnavailable ? err : new EmbeddingUnavailable("error");
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", onAbort);
    }
  }

  // timeoutMs: per request. A visitor's query uses the short default
  // (MEMBRANE_TIMEOUT_MS); building the index sends batches of passages and
  // passes a longer one (INDEX_TIMEOUT_MS).
  async function embed(texts, { kind = "passage", signal, timeoutMs } = {}) {
    const prefix = kind === "query" ? queryPrefix : passagePrefix;
    const inputs = texts.map((t) => prefix + String(t || "").slice(0, MAX_INPUT_CHARS));
    const out = [];
    for (let i = 0; i < inputs.length; i += MAX_BATCH) out.push(...(await call(inputs.slice(i, i + MAX_BATCH), signal, timeoutMs)));
    return out;
  }

  return { id: `membrane:${config.embedModel}`, model: config.embedModel, dims: config.dims, embed };
}

module.exports = { EmbeddingUnavailable, createMembraneEmbedder, normalize, FAILURES_BEFORE_OPEN, CIRCUIT_OPEN_MS, INDEX_TIMEOUT_MS };

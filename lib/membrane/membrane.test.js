// Membrane (Harvey Taxi's own model service): address policy and the
// embedding client. No network: fetch is injected.

const { readMembraneConfig, describeMembraneConfig, isPrivateHost } = require("./config");
const { createMembraneEmbedder, EmbeddingUnavailable, FAILURES_BEFORE_OPEN } = require("./embeddings");

const env = (o) => ({ MEMBRANE_EMBED_MODEL: "multilingual-e5-small", ...o });

describe("membrane address policy (own model, no AI vendor)", () => {
  test("unset means off", () => {
    expect(readMembraneConfig({})).toMatchObject({ configured: false, problem: expect.stringMatching(/not set/) });
  });

  test.each(["http://localhost:8080/v1", "http://127.0.0.1:8080/v1", "http://10.0.3.4/v1", "http://192.168.1.9/v1", "http://harvey-membrane:10000/v1", "http://membrane.internal/v1"])("private address %s is allowed", (u) => {
    expect(readMembraneConfig(env({ MEMBRANE_BASE_URL: u })).configured).toBe(true);
  });

  test.each([
    "https://api.openai.com/v1",
    "https://api.anthropic.com/v1",
    "https://generativelanguage.googleapis.com/v1",
    "https://api.cohere.com/v1",
    "https://api.mistral.ai/v1",
    "https://api.together.xyz/v1",
    "https://api.groq.com/openai/v1",
    "https://api.voyageai.com/v1",
    "https://api-inference.huggingface.co/v1",
    "https://bedrock-runtime.us-east-1.amazonaws.com"
  ])("hosted AI provider %s is refused, even when listed", (u) => {
    const host = new URL(u).hostname;
    const c = readMembraneConfig(env({ MEMBRANE_BASE_URL: u, MEMBRANE_ALLOWED_HOSTS: host }));
    expect(c.configured).toBe(false);
    expect(c.problem).toMatch(/not permitted/);
  });

  test("a public host is allowed only when listed as ours", () => {
    expect(readMembraneConfig(env({ MEMBRANE_BASE_URL: "https://gpu.example.net/v1" })).problem).toMatch(/MEMBRANE_ALLOWED_HOSTS/);
    expect(readMembraneConfig(env({ MEMBRANE_BASE_URL: "https://gpu.example.net/v1", MEMBRANE_ALLOWED_HOSTS: "gpu.example.net" })).configured).toBe(true);
  });

  test("credentials in the URL, bad schemes and a missing model are refused", () => {
    expect(readMembraneConfig(env({ MEMBRANE_BASE_URL: "http://u:p@localhost/v1" })).configured).toBe(false);
    expect(readMembraneConfig(env({ MEMBRANE_BASE_URL: "ftp://localhost/v1" })).configured).toBe(false);
    expect(readMembraneConfig({ MEMBRANE_BASE_URL: "http://localhost/v1" }).problem).toMatch(/MEMBRANE_EMBED_MODEL/);
  });

  test("description never includes the key or the full URL", () => {
    const d = describeMembraneConfig(readMembraneConfig(env({ MEMBRANE_BASE_URL: "http://harvey-membrane:10000/v1/secret-path", MEMBRANE_API_KEY: "k-123456" })));
    expect(JSON.stringify(d)).not.toMatch(/k-123456|secret-path/);
    expect(d).toMatchObject({ configured: true, host: "harvey-membrane:10000", api_key_set: true, dims: 384 });
  });

  test("vector size outside 64-4096 falls back to 384", () => {
    expect(readMembraneConfig(env({ MEMBRANE_BASE_URL: "http://localhost/v1", MEMBRANE_EMBED_DIMS: "4" })).dims).toBe(384);
    expect(readMembraneConfig(env({ MEMBRANE_BASE_URL: "http://localhost/v1", MEMBRANE_EMBED_DIMS: "768" })).dims).toBe(768);
  });

  test("private-host detection", () => {
    expect(isPrivateHost("172.20.0.1")).toBe(true);
    expect(isPrivateHost("172.32.0.1")).toBe(false);
    expect(isPrivateHost("8.8.8.8")).toBe(false);
    expect(isPrivateHost("example.com")).toBe(false);
  });
});

describe("membrane embedding client", () => {
  // Real models use 64+ dimensions; 4 keeps the arithmetic readable.
  const config = { ...readMembraneConfig(env({ MEMBRANE_BASE_URL: "http://harvey-membrane:10000/v1", MEMBRANE_API_KEY: "k-1" })), dims: 4 };
  const ok = (vectors) => ({ ok: true, status: 200, json: async () => ({ data: vectors.map((embedding, index) => ({ index, embedding })) }) });

  test("posts to our runtime, with prefixes, and returns unit vectors in input order", async () => {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url, init });
      return { ok: true, status: 200, json: async () => ({ data: [{ index: 1, embedding: [0, 3, 0, 4] }, { index: 0, embedding: [2, 0, 0, 0] }] }) };
    };
    const e = createMembraneEmbedder(config, { fetchImpl, queryPrefix: "query: ", passagePrefix: "passage: " });
    const [a, b] = await e.embed(["first", "second"], { kind: "query" });
    expect(calls[0].url).toBe("http://harvey-membrane:10000/v1/embeddings");
    expect(JSON.parse(calls[0].init.body)).toEqual({ model: "multilingual-e5-small", input: ["query: first", "query: second"] });
    expect(calls[0].init.headers.Authorization).toBe("Bearer k-1");
    expect(Array.from(a)).toEqual([1, 0, 0, 0]);
    expect(Array.from(b).map((x) => Math.round(x * 10) / 10)).toEqual([0, 0.6, 0, 0.8]);
  });

  test("wrong vector size, HTTP errors, malformed replies and network failures are EmbeddingUnavailable", async () => {
    const cases = [
      [async () => ok([[1, 2, 3]]), "wrong_dims"],
      [async () => ({ ok: false, status: 500 }), "http_500"],
      [async () => ({ ok: true, status: 200, json: async () => ({ nope: true }) }), "malformed"],
      [async () => { throw new Error("ECONNREFUSED"); }, "network"]
    ];
    for (const [fetchImpl, code] of cases) {
      const e = createMembraneEmbedder(config, { fetchImpl });
      await expect(e.embed(["x"])).rejects.toMatchObject({ code });
    }
  });

  test("a slow runtime times out", async () => {
    const slow = { ...readMembraneConfig(env({ MEMBRANE_BASE_URL: "http://localhost/v1", MEMBRANE_TIMEOUT_MS: "100" })), dims: 4 };
    const fetchImpl = (url, init) => new Promise((resolve, reject) => init.signal.addEventListener("abort", () => reject(new Error("aborted"))));
    await expect(createMembraneEmbedder(slow, { fetchImpl }).embed(["x"])).rejects.toMatchObject({ code: "timeout" });
  });

  test("repeated failures open the circuit; no further calls for a minute", async () => {
    let n = 0;
    let t = 0;
    const fetchImpl = async () => {
      n += 1;
      return { ok: false, status: 503 };
    };
    const e = createMembraneEmbedder(config, { fetchImpl, now: () => t });
    for (let i = 0; i < FAILURES_BEFORE_OPEN; i += 1) await expect(e.embed(["x"])).rejects.toBeInstanceOf(EmbeddingUnavailable);
    await expect(e.embed(["x"])).rejects.toMatchObject({ code: "circuit_open" });
    expect(n).toBe(FAILURES_BEFORE_OPEN);
    t = 61_000;
    await expect(e.embed(["x"])).rejects.toMatchObject({ code: "http_503" });
  });

  test("not configured means no embedder", () => {
    expect(createMembraneEmbedder(readMembraneConfig({}))).toBeNull();
  });
});

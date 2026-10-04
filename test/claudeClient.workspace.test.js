// The real Anthropic SDK with a stand-in fetch: checks the headers the
// Claude client sends, without any network call. The key is a test value.
const Anthropic = require("@anthropic-ai/sdk").default;
const { readClaudeConfig, createClaudeClient, clientOptions } = require("../lib/agent/claudeClient");

function capture() {
  const seen = [];
  const fetch = async (url, init) => {
    seen.push({ url: String(url), headers: new Headers(init.headers) });
    return new Response(JSON.stringify({ input_tokens: 12 }), { status: 200, headers: { "content-type": "application/json", "request-id": "req_test" } });
  };
  return { seen, fetch };
}

function clientWith(env, fetch) {
  const config = readClaudeConfig(env);
  // The same options createClaudeClient uses, plus the stand-in fetch.
  const sdk = new Anthropic(clientOptions(config, { fetch }));
  return { config, client: createClaudeClient({ config, sdk }) };
}

test("ANTHROPIC_WORKSPACE_ID is sent as the anthropic-workspace-id header", async () => {
  const { seen, fetch } = capture();
  const { config, client } = clientWith({ ANTHROPIC_API_KEY: "test-not-a-real-key", ANTHROPIC_WORKSPACE_ID: "wrkspc_01TestWorkspace" }, fetch);
  expect(config).toMatchObject({ workspaceId: "wrkspc_01TestWorkspace", problem: null });
  expect(await client.countTokens({ messages: [{ role: "user", content: "hi" }] })).toEqual({ input_tokens: 12 });
  expect(seen[0].url).toMatch(/\/v1\/messages\/count_tokens/);
  expect(seen[0].headers.get("anthropic-workspace-id")).toBe("wrkspc_01TestWorkspace");
});

test("without it, no workspace header; a malformed value is ignored and reported", async () => {
  const { seen, fetch } = capture();
  const { client } = clientWith({ ANTHROPIC_API_KEY: "test-not-a-real-key" }, fetch);
  await client.countTokens({ messages: [{ role: "user", content: "hi" }] });
  expect(seen[0].headers.get("anthropic-workspace-id")).toBeNull();

  const bad = readClaudeConfig({ ANTHROPIC_API_KEY: "test-not-a-real-key", ANTHROPIC_WORKSPACE_ID: "not a workspace\nX-Injected: 1" });
  expect(bad.workspaceId).toBeNull();
  expect(bad.problem).toMatch(/isn't a workspace ID/);
});

test("client options: no retries, the timeout, and the header only when configured", () => {
  const withWs = clientOptions(readClaudeConfig({ ANTHROPIC_API_KEY: "test-not-a-real-key", ANTHROPIC_WORKSPACE_ID: "wrkspc_01TestWorkspace" }));
  expect(withWs).toMatchObject({ maxRetries: 0, timeout: 6000, defaultHeaders: { "anthropic-workspace-id": "wrkspc_01TestWorkspace" } });
  expect(clientOptions(readClaudeConfig({ ANTHROPIC_API_KEY: "test-not-a-real-key" }))).not.toHaveProperty("defaultHeaders");
});

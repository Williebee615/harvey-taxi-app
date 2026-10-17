// docs/agent-action-rules.md, rule 1 ("agents read; the server writes")
// and rule 5 (kill switch), enforced as tests so a change that gives an
// agent tool a database write, or a kill switch that doesn't win, fails CI.
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const AGENT_TOOL_FILES = ["lib/agent/tools.js", ...fs.readdirSync(path.join(ROOT, "lib/assistantPilot")).filter((f) => f.endsWith(".js") && !f.endsWith(".test.js")).map((f) => `lib/assistantPilot/${f}`)];

test.each(AGENT_TOOL_FILES)("%s makes no database writes", (file) => {
  const src = fs.readFileSync(path.join(ROOT, file), "utf8");
  // Supabase write calls; a hash's .update(...) is not a database write.
  const writes = [...src.matchAll(/\.(insert|upsert|delete|rpc)\s*\(|\.from\([^)]*\)\s*\.update\s*\(/g)].map((m) => m[0]);
  expect(writes).toEqual([]);
});

test("every assistant pilot tool is read-only, and the runner refuses any that isn't", () => {
  const { TOOLS, invokeTool } = require("../lib/assistantPilot/tools");
  for (const [name, tool] of Object.entries(TOOLS)) expect([name, tool.readOnly]).toEqual([name, true]);
  const ctx = { viewer: { org: "harvey_taxi", role: "visitor" }, calls: { count: 0 } };
  expect(invokeTool(ctx, "not_a_tool", {})).toMatchObject({ ok: false });
});

test("the kill switch overrides every automation flag", () => {
  const { resolveAgentMode, AGENT_FLAG_KEYS } = require("../lib/agent/policy");
  const all = Object.fromEntries(Object.values(AGENT_FLAG_KEYS).filter((k) => k !== AGENT_FLAG_KEYS.RULES).map((k) => [k, true]));
  expect(resolveAgentMode(all).mode).toBe("killed");
  // Shadow mode or a dispatch pause also prevents automatic actions.
  const live = { ...all, [AGENT_FLAG_KEYS.KILL_SWITCH]: false, [AGENT_FLAG_KEYS.SHADOW]: false };
  expect(resolveAgentMode(live).mode).toBe("automation");
  expect(resolveAgentMode({ ...live, [AGENT_FLAG_KEYS.SHADOW]: true }).mode).toBe("shadow");
  expect(resolveAgentMode(live, { dispatchPaused: true }).mode).not.toBe("automation");
});

test("the rules document names the files it relies on", () => {
  const doc = fs.readFileSync(path.join(ROOT, "docs/agent-action-rules.md"), "utf8");
  for (const f of doc.match(/`((?:lib|docs|test)\/[^`]+\.(?:js|md))`/g).map((s) => s.slice(1, -1))) {
    expect([f, fs.existsSync(path.join(ROOT, f))]).toEqual([f, true]);
  }
});

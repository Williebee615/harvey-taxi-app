// Assistant pilot: the only actions available during a turn. Each tool is
// narrow, typed, read-only and declares which organizations and roles may
// use it. Authorization runs on EVERY invocation (not once per session),
// from the server-resolved viewer -- never from the message, the model's
// output or the request body.
//
// There is no SQL tool, no filesystem tool, no network tool and no
// credential anywhere in a tool's reach. Consequential actions (refunds,
// account changes, application decisions, ride scheduling) are not tools
// in the pilot at all; the architecture requires them to be proposals a
// person with the right authority confirms (docs/assistant-platform-architecture.md §5).

const { retrieve } = require("./retrieval");
const { ORGS } = require("./orgs");

const MAX_TOOL_CALLS_PER_TURN = 3;

const TOOLS = Object.freeze({
  search_knowledge: Object.freeze({
    description: "Search this organization's approved public documents.",
    orgs: Object.freeze(["harvey_taxi", "htaf"]),
    roles: Object.freeze(["visitor"]),
    readOnly: true,
    validate(input) {
      if (!input || typeof input.query !== "string") return "query must be a string";
      const q = input.query.trim();
      if (!q || q.length > 500) return "query must be 1-500 characters";
      if (input.limit !== undefined && !(Number.isInteger(input.limit) && input.limit >= 1 && input.limit <= 6)) return "limit must be 1-6";
      return null;
    },
    run(ctx, input) {
      return retrieve({ corpus: ctx.corpus, viewer: ctx.viewer, query: input.query, limit: input.limit || 4 });
    }
  }),
  get_contact_options: Object.freeze({
    description: "This organization's published support channel.",
    orgs: Object.freeze(["harvey_taxi", "htaf"]),
    roles: Object.freeze(["visitor"]),
    readOnly: true,
    validate(input) {
      return input && Object.keys(input).length ? "takes no input" : null;
    },
    run(ctx) {
      return { ok: true, support: { ...ORGS[ctx.viewer.org].support } };
    }
  })
});

// ctx: { viewer: { org, role }, corpus, calls: { count } }
function invokeTool(ctx, name, input = {}) {
  const tool = Object.prototype.hasOwnProperty.call(TOOLS, name) ? TOOLS[name] : null;
  if (!tool) return { ok: false, error: "unknown_tool" };
  if (!tool.readOnly) return { ok: false, error: "not_read_only" };
  const viewer = ctx && ctx.viewer;
  if (!viewer || !tool.orgs.includes(viewer.org)) return { ok: false, error: "forbidden_org" };
  if (!tool.roles.includes(viewer.role)) return { ok: false, error: "forbidden_role" };
  if (ctx.corpus && ctx.corpus.org !== viewer.org) return { ok: false, error: "forbidden_org" };
  const calls = ctx.calls || (ctx.calls = { count: 0 });
  if (calls.count >= MAX_TOOL_CALLS_PER_TURN) return { ok: false, error: "tool_call_limit" };
  const problem = tool.validate(input);
  if (problem) return { ok: false, error: "invalid_input", detail: problem };
  calls.count += 1;
  return tool.run(ctx, input);
}

module.exports = { TOOLS, MAX_TOOL_CALLS_PER_TURN, invokeTool };

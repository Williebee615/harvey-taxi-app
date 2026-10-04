// Who may get model-powered answers (docs/ai-model.md).
//
// system_flags.agent_model_mode:
//   "off"           - everyone gets the rules-based assistant (default).
//   "test_accounts" - only accounts listed in agent_model_test_accounts
//                     (synthetic test riders/drivers) get the model.
//   "all"           - every signed-in rider and driver. Refused unless the
//                     owner has approved the privacy disclosure and set
//                     AGENT_MODEL_PUBLIC_APPROVED=true on the server; until
//                     then it acts as "test_accounts".
// Signed-out visitors never get the model.

const MODEL_MODES = Object.freeze(["off", "test_accounts", "all"]);
const MODEL_FLAG_KEYS = Object.freeze({ MODE: "agent_model_mode", TEST_ACCOUNTS: "agent_model_test_accounts" });
const MAX_TEST_ACCOUNTS = 25;
const ACCOUNT_KEY = /^(rider|driver):[A-Za-z0-9_.:-]{1,80}$/;

function publicApproved(env = process.env) {
  return String(env.AGENT_MODEL_PUBLIC_APPROVED || "").trim().toLowerCase() === "true";
}

function parseTestAccounts(value) {
  let list = [];
  try {
    list = Array.isArray(value) ? value : JSON.parse(String(value || "[]"));
  } catch {
    list = [];
  }
  if (!Array.isArray(list)) return [];
  return [...new Set(list.map((x) => String(x).trim()).filter((x) => ACCOUNT_KEY.test(x)))].slice(0, MAX_TEST_ACCOUNTS);
}

function resolveModelPolicy(rows, { env = process.env } = {}) {
  const get = (key) => {
    const row = (rows || []).find((r) => r.key === key);
    return row ? row.value : null;
  };
  const stored = MODEL_MODES.includes(get(MODEL_FLAG_KEYS.MODE)) ? get(MODEL_FLAG_KEYS.MODE) : "off";
  const approved = publicApproved(env);
  const effective = stored === "all" && !approved ? "test_accounts" : stored;
  return { stored_mode: stored, mode: effective, public_approved: approved, test_accounts: parseTestAccounts(get(MODEL_FLAG_KEYS.TEST_ACCOUNTS)) };
}

function modelEligibility(policy, { role, actor }) {
  if (!policy || policy.mode === "off") return { eligible: false, reason: "model_off" };
  if (!actor || !actor.id) return { eligible: false, reason: "signed_out" };
  if (policy.mode === "all") return { eligible: true, reason: null };
  const key = `${role === "driver" ? "driver" : "rider"}:${actor.id}`;
  return policy.test_accounts.includes(key) ? { eligible: true, reason: null } : { eligible: false, reason: "not_a_test_account" };
}

// Validates an admin change. Returns { ok, error, value }.
function validateModelSettings({ mode, testAccounts }, { env = process.env } = {}) {
  const out = {};
  if (mode !== undefined) {
    if (!MODEL_MODES.includes(mode)) return { ok: false, error: "mode must be off, test_accounts or all." };
    if (mode === "all" && !publicApproved(env)) {
      return { ok: false, error: "The model can't be enabled for all users until the owner approves the privacy disclosure and sets AGENT_MODEL_PUBLIC_APPROVED=true." };
    }
    out.mode = mode;
  }
  if (testAccounts !== undefined) {
    if (!Array.isArray(testAccounts)) return { ok: false, error: "test_accounts must be a list like [\"rider:ID\", \"driver:ID\"]." };
    const parsed = parseTestAccounts(testAccounts);
    if (parsed.length !== testAccounts.length) return { ok: false, error: `Each test account must look like rider:ID or driver:ID (at most ${MAX_TEST_ACCOUNTS}).` };
    out.testAccounts = parsed;
  }
  return { ok: true, error: null, value: out };
}

module.exports = { MODEL_MODES, MODEL_FLAG_KEYS, publicApproved, parseTestAccounts, resolveModelPolicy, modelEligibility, validateModelSettings };

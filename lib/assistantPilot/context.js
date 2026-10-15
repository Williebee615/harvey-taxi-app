// Assistant pilot: conversation context. The server keeps NO conversation
// history: the visitor's browser holds the recent turns and sends them
// with each message. The server treats them as untrusted input, cleans
// them, and keeps only the newest turns that fit the token budget. Nothing
// here is written to a database or a log.

const MAX_TURNS = 8;
const MAX_TURN_CHARS = 1000;
const HISTORY_TOKEN_BUDGET = 1200;

// Conservative estimate (about 4 characters per token for English; this
// over-counts for most text, which is the safe direction for a budget).
const estimateTokens = (text) => Math.ceil(String(text || "").length / 3.5);

function clean(text) {
  return String(text || "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
    .replace(/\[S\d+\]/g, "")
    .trim()
    .slice(0, MAX_TURN_CHARS);
}

// history: [{ role: "user" | "assistant", text }] oldest first.
function fitHistory(history, { budget = HISTORY_TOKEN_BUDGET } = {}) {
  const turns = (Array.isArray(history) ? history : [])
    .filter((t) => t && (t.role === "user" || t.role === "assistant") && typeof t.text === "string")
    .slice(-MAX_TURNS)
    .map((t) => ({ role: t.role, text: clean(t.text) }))
    .filter((t) => t.text);
  const kept = [];
  let used = 0;
  for (let i = turns.length - 1; i >= 0; i -= 1) {
    const cost = estimateTokens(turns[i].text);
    if (used + cost > budget) break;
    used += cost;
    kept.unshift(turns[i]);
  }
  // The model API expects the conversation to start with a user turn.
  while (kept.length && kept[0].role !== "user") kept.shift();
  return { turns: kept, tokens: used, dropped: turns.length - kept.length };
}

// A short follow-up ("and for drivers?") is searched together with the
// previous question.
function searchQueryFor(message, turns) {
  const words = String(message || "").trim().split(/\s+/).filter(Boolean);
  const lastUser = [...turns].reverse().find((t) => t.role === "user");
  if (lastUser && words.length <= 6) return `${lastUser.text} ${message}`;
  return message;
}

module.exports = { MAX_TURNS, MAX_TURN_CHARS, HISTORY_TOKEN_BUDGET, estimateTokens, fitHistory, searchQueryFor };

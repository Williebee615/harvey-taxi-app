// Support handoff (docs/ai-knowledge.md, phase 4).
//
// The assistant drafts a short summary from the user's own recent
// questions on this device. The user edits it and taps "Send to support";
// nothing is sent before that. The server records the request as a case
// in the existing human-review queue (audit_logs) and only then returns a
// reference. The app shows "sent" only when that reference comes back.
//
// No model is used: the draft is the user's own words, never an invented
// description of their problem.

const crypto = require("crypto");
const { cleanContext } = require("./followUp");
const { redactForLog } = require("./escalation");

const MIN_SUMMARY = 10;
const MAX_SUMMARY = 1500;
const DRAFT_QUESTIONS = 3;

// Draft text for the user to review. Only their own recent questions.
function draftSummary({ context }) {
  const asked = cleanContext(context)
    .filter((t) => t.role === "user")
    .slice(-DRAFT_QUESTIONS)
    .map((t) => `- ${t.text}`);
  const lines = ["I need help from Harvey Taxi support."];
  if (asked.length) lines.push("", "What I asked the assistant:", ...asked);
  lines.push("", "More details: ");
  return lines.join("\n");
}

// The approved summary as stored and sent: control characters removed,
// line breaks kept, card numbers, emails, phone numbers and tokens masked
// (support contacts the user through their account).
function cleanSummary(raw) {
  if (typeof raw !== "string") return { ok: false, error: "Summary required." };
  const text = raw
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => (line.trim() ? redactForLog(line, MAX_SUMMARY) : ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (text.length < MIN_SUMMARY) return { ok: false, error: `Please write at least ${MIN_SUMMARY} characters.` };
  if (text.length > MAX_SUMMARY) return { ok: false, error: `Please keep it under ${MAX_SUMMARY} characters.` };
  return { ok: true, text };
}

// Reference the user can quote to support, e.g. HT-SUP-20261004-7K2M9Q.
function newHandoffReference(now = new Date()) {
  const day = now.toISOString().slice(0, 10).replace(/-/g, "");
  const alphabet = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
  const bytes = crypto.randomBytes(6);
  let tail = "";
  for (const b of bytes) tail += alphabet[b % alphabet.length];
  return `HT-SUP-${day}-${tail}`;
}

// The case row: same shape as other agent cases, so the admin queue shows
// it with no new table.
function handoffCaseEntry({ reference, role, actorId, summary, appTarget }) {
  return {
    actor_type: "agent",
    actor_id: "agent-manager",
    action: "agent.case_opened",
    entity_type: "agent_case",
    entity_id: reference,
    metadata: {
      record_type: "human_review_case",
      category: "support_request",
      severity: "medium",
      reporter_role: role === "driver" ? "driver" : "rider",
      reporter_id: actorId,
      source: "handoff",
      app_target: appTarget || null,
      excerpt: summary.slice(0, 160),
      summary,
      approved_by_user: true,
      executed: false
    }
  };
}

// In-memory per-account limit: a handful of requests per hour is plenty
// for a person and stops a loop from flooding the support queue.
function createHandoffLimiter({ max = 5, windowMs = 60 * 60 * 1000, now = () => Date.now() } = {}) {
  const seen = new Map();
  return {
    allow(key) {
      const t = now();
      const recent = (seen.get(key) || []).filter((at) => t - at < windowMs);
      if (recent.length >= max) {
        seen.set(key, recent);
        return false;
      }
      recent.push(t);
      seen.set(key, recent);
      return true;
    }
  };
}

module.exports = { MIN_SUMMARY, MAX_SUMMARY, draftSummary, cleanSummary, newHandoffReference, handoffCaseEntry, createHandoffLimiter };

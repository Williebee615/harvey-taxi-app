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
// "general": any support request. "lost_item": a rider's lost item or a
// driver's found item, optionally linked to one of their own recent rides.
const HANDOFF_KINDS = Object.freeze(["general", "lost_item"]);
const REQUEST_ID = /^[A-Za-z0-9-]{8,64}$/;

function handoffKind(value) {
  return HANDOFF_KINDS.includes(value) ? value : "general";
}

// "Sat, Oct 3, 5:13 PM: 1 Broadway to BNA" (Nashville time).
function rideLabel(ride) {
  if (!ride) return "";
  const at = new Date(ride.completed_at || ride.created_at || "");
  const when = Number.isNaN(at.getTime())
    ? "date not recorded"
    : at.toLocaleString("en-US", { timeZone: "America/Chicago", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const route = [ride.pickup_address, ride.dropoff_address].filter(Boolean).join(" to ");
  return route ? `${when}: ${route}` : when;
}

// Draft text for the user to review: their own recent questions, plus for
// a lost item a fill-in template and their most recent trip, if any.
function draftSummary({ context, kind = "general", role = "rider", ride = null }) {
  const asked = cleanContext(context)
    .filter((t) => t.role === "user")
    .slice(-DRAFT_QUESTIONS)
    .map((t) => `- ${t.text}`);
  if (handoffKind(kind) === "lost_item") {
    const driver = role === "driver";
    const lines = [
      driver ? "Found item report (a rider left something in my car)." : "Lost item report.",
      "",
      `Trip: ${ride ? rideLabel(ride) : "(add the date, time and route)"}`,
      driver ? "Item found: " : "Item: ",
      "Description (color, brand, where in the car): ",
      driver ? "Notes: " : "Best way and time to reach me: "
    ];
    return lines.join("\n");
  }
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
function handoffCaseEntry({ reference, role, actorId, summary, appTarget, kind = "general", rideId = null, requestId = null }) {
  const lost = handoffKind(kind) === "lost_item";
  return {
    actor_type: "agent",
    actor_id: "agent-manager",
    action: "agent.case_opened",
    entity_type: "agent_case",
    entity_id: reference,
    metadata: {
      record_type: "human_review_case",
      category: lost ? "lost_item" : "support_request",
      severity: "medium",
      reporter_role: role === "driver" ? "driver" : "rider",
      reporter_id: actorId,
      source: "handoff",
      app_target: appTarget || null,
      ride_id: rideId || null,
      request_id: requestId || null,
      excerpt: summary.slice(0, 160),
      summary,
      approved_by_user: true,
      executed: false
    }
  };
}

// Whether the support email copy went out. Kept apart from the case: the
// case is the record; "accepted" means the email service took the
// message, not that it was delivered or read.
function handoffEmailEntry({ reference, status, to }) {
  return {
    actor_type: "system",
    actor_id: "agent-manager",
    action: "agent.handoff_email",
    entity_type: "agent_case",
    entity_id: reference,
    metadata: { status, to }
  };
}

// Duplicate protection. The app sends one request_id per review; a retry
// or double tap with the same id (or the same text from the same account
// within sameTextMs) gets the first result back instead of a second case.
// Concurrent duplicates share the same in-flight save.
function createHandoffDeduper({ ttlMs = 24 * 60 * 60 * 1000, sameTextMs = 15 * 60 * 1000, now = () => Date.now() } = {}) {
  const byId = new Map();
  const byText = new Map();
  const sweep = () => {
    const t = now();
    for (const [k, v] of byId) if (t - v.at > ttlMs) byId.delete(k);
    for (const [k, v] of byText) if (t - v.at > sameTextMs) byText.delete(k);
  };
  return {
    // Returns a promise of the earlier result, or null if this is new.
    find(account, requestId, text) {
      sweep();
      const id = requestId && REQUEST_ID.test(requestId) ? byId.get(`${account}|${requestId}`) : null;
      if (id) return id.promise;
      const same = byText.get(`${account}|${text}`);
      return same ? same.promise : null;
    },
    // Tracks a save; forgets it if the save fails, so the user can retry.
    track(account, requestId, text, promise) {
      const entry = { at: now(), promise };
      if (requestId && REQUEST_ID.test(requestId)) byId.set(`${account}|${requestId}`, entry);
      byText.set(`${account}|${text}`, entry);
      promise.then(
        (result) => {
          if (!result || result.saved !== true) {
            byId.delete(`${account}|${requestId}`);
            byText.delete(`${account}|${text}`);
          }
        },
        () => {
          byId.delete(`${account}|${requestId}`);
          byText.delete(`${account}|${text}`);
        }
      );
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

module.exports = {
  MIN_SUMMARY,
  MAX_SUMMARY,
  HANDOFF_KINDS,
  REQUEST_ID,
  handoffKind,
  rideLabel,
  draftSummary,
  cleanSummary,
  newHandoffReference,
  handoffCaseEntry,
  handoffEmailEntry,
  createHandoffDeduper,
  createHandoffLimiter
};

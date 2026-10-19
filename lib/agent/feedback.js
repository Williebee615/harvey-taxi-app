// Harvey Assistant ratings and "resolved without staff" counts
// (owner-approved 2026-10-19; off unless agent_feedback_enabled is "true").
//
// - Each answer gets a signed feedback token: the answer id, who asked
//   (role and account, or none for a signed-out visitor), the question
//   type, the answer source, the app and the conversation id. The token
//   lets the person who got the answer rate it once with a thumbs up or
//   down; nobody else can rate it.
// - A rating is stored as one audit row with no message text.
// - A conversation is the random id the web assistant keeps until Clear
//   chat or sign-out. It "needed staff" if any answer in it opened a
//   safety or review case, or the person sent a support request from it.
//   Answers from clients that don't send a conversation id (driver app
//   builds, older pages) are counted as untracked, never as resolved.

const crypto = require("crypto");

const FEEDBACK_FLAG = "agent_feedback_enabled";
const FEEDBACK_ACTION = "agent.feedback";
const FEEDBACK_RECORD_TYPE = "assistance_feedback";
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const RATINGS = Object.freeze(["up", "down"]);
const CONVERSATION_ID = /^c_[A-Za-z0-9]{16,40}$/;

function cleanConversationId(value) {
  return typeof value === "string" && CONVERSATION_ID.test(value) ? value : null;
}

function newAnswerId() {
  return `ans_${crypto.randomBytes(12).toString("hex")}`;
}

function short(value, max = 60) {
  return value == null ? null : String(value).slice(0, max);
}

function b64(json) {
  return Buffer.from(JSON.stringify(json)).toString("base64url");
}

function sign(key, body) {
  return crypto.createHmac("sha256", key).update(body).digest("base64url");
}

// key: a server secret (Buffer or string). Returns null without one.
function createFeedbackSigner(secret) {
  if (!secret) return null;
  const key = crypto.createHmac("sha256", String(secret)).update("harvey-assistant-feedback-v1").digest();
  return {
    issue({ answerId, role, actorId, intent, source, appTarget, conversationId, now = Date.now() }) {
      const body = b64({
        a: answerId,
        r: role === "driver" ? "driver" : "rider",
        u: actorId ? String(actorId) : null,
        i: short(intent),
        s: short(source, 30),
        t: short(appTarget, 40),
        c: cleanConversationId(conversationId),
        iat: now
      });
      return `${body}.${sign(key, body)}`;
    },
    // Returns the payload, or { error } when the token is forged, expired
    // or malformed.
    verify(token, { now = Date.now() } = {}) {
      if (typeof token !== "string" || token.length > 1200) return { error: "invalid" };
      const [body, mac] = token.split(".");
      if (!body || !mac) return { error: "invalid" };
      const expected = sign(key, body);
      const a = Buffer.from(mac);
      const b = Buffer.from(expected);
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { error: "invalid" };
      let p;
      try {
        p = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
      } catch (e) {
        return { error: "invalid" };
      }
      if (!p || typeof p.a !== "string" || !Number.isFinite(p.iat)) return { error: "invalid" };
      if (now - p.iat > TOKEN_TTL_MS || p.iat - now > 60_000) return { error: "expired" };
      return { payload: p };
    }
  };
}

// The audit row for one rating. Never holds the question or the answer.
function feedbackEntry(payload, rating) {
  return {
    actor_type: payload.r === "driver" ? "driver" : "rider",
    actor_id: payload.u || null,
    action: FEEDBACK_ACTION,
    entity_type: "agent_answer",
    entity_id: payload.a,
    metadata: {
      record_type: FEEDBACK_RECORD_TYPE,
      rating,
      intent: payload.i || null,
      answer_source: payload.s || null,
      app_target: payload.t || null,
      conversation_id: payload.c || null,
      authenticated: Boolean(payload.u)
    }
  };
}

function dayOf(row) {
  return String(row.created_at || "").slice(0, 10);
}

function rate(part, whole) {
  return whole > 0 ? Math.round((part / whole) * 1000) / 10 : null;
}

// rows: audit_logs rows (created_at, action, metadata, entity_id) for
// agent.decision, agent.feedback and agent.case_opened. Rows of other
// types are ignored. Returns totals, a per-day table and per-source
// ratings over the last `days` UTC days.
function summarizeFeedback(rows, { days = 7, now = new Date() } = {}) {
  const dayList = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    dayList.push(new Date(now.getTime() - i * 86_400_000).toISOString().slice(0, 10));
  }
  const inRange = new Set(dayList);
  const conversations = new Map(); // id -> { day, staff }
  const answersByDay = new Map();
  const untrackedByDay = new Map();
  const latestRating = new Map(); // answer id -> row (latest wins)
  const staffConversations = new Set();

  const sorted = (rows || []).slice().sort((x, y) => String(x.created_at).localeCompare(String(y.created_at)));
  for (const row of sorted) {
    const m = row.metadata || {};
    if (row.action === "agent.decision" && m.record_type === "assistance_answer") {
      const day = dayOf(row);
      if (!inRange.has(day)) continue;
      answersByDay.set(day, (answersByDay.get(day) || 0) + 1);
      const conv = cleanConversationId(m.conversation_id);
      if (!conv) {
        untrackedByDay.set(day, (untrackedByDay.get(day) || 0) + 1);
        continue;
      }
      if (!conversations.has(conv)) conversations.set(conv, { day });
      if (m.escalation) staffConversations.add(conv);
    } else if (row.action === "agent.case_opened" && m.source === "handoff") {
      const conv = cleanConversationId(m.conversation_id);
      if (conv) staffConversations.add(conv);
    } else if (row.action === FEEDBACK_ACTION && m.record_type === FEEDBACK_RECORD_TYPE && RATINGS.includes(m.rating)) {
      if (!inRange.has(dayOf(row))) continue;
      latestRating.set(String(row.entity_id), row);
    }
  }

  const daily = dayList.map((day) => ({
    day,
    answers: answersByDay.get(day) || 0,
    untracked_answers: untrackedByDay.get(day) || 0,
    conversations: 0,
    needed_staff: 0,
    resolved_without_staff: 0,
    thumbs_up: 0,
    thumbs_down: 0
  }));
  const byDay = new Map(daily.map((d) => [d.day, d]));
  for (const [id, c] of conversations) {
    const d = byDay.get(c.day);
    d.conversations += 1;
    if (staffConversations.has(id)) d.needed_staff += 1;
    else d.resolved_without_staff += 1;
  }
  const bySource = {};
  const recentDown = [];
  for (const row of latestRating.values()) {
    const m = row.metadata;
    const d = byDay.get(dayOf(row));
    if (m.rating === "up") d.thumbs_up += 1;
    else d.thumbs_down += 1;
    const src = m.answer_source || "unknown";
    bySource[src] = bySource[src] || { up: 0, down: 0 };
    bySource[src][m.rating] += 1;
    if (m.rating === "down") recentDown.push({ at: row.created_at, intent: m.intent || null, answer_source: src, app_target: m.app_target || null });
  }

  const sum = (k) => daily.reduce((n, d) => n + d[k], 0);
  const up = sum("thumbs_up");
  const down = sum("thumbs_down");
  const convs = sum("conversations");
  const answers = sum("answers");
  return {
    days,
    totals: {
      answers,
      untracked_answers: sum("untracked_answers"),
      conversations: convs,
      needed_staff: sum("needed_staff"),
      resolved_without_staff: sum("resolved_without_staff"),
      resolved_without_staff_rate: rate(sum("resolved_without_staff"), convs),
      ratings: up + down,
      thumbs_up: up,
      thumbs_down: down,
      satisfaction_rate: rate(up, up + down),
      rated_share: rate(up + down, answers)
    },
    daily,
    by_source: bySource,
    recent_down: recentDown.sort((x, y) => String(y.at).localeCompare(String(x.at))).slice(0, 10)
  };
}

module.exports = {
  FEEDBACK_FLAG,
  FEEDBACK_ACTION,
  FEEDBACK_RECORD_TYPE,
  RATINGS,
  TOKEN_TTL_MS,
  cleanConversationId,
  newAnswerId,
  createFeedbackSigner,
  feedbackEntry,
  summarizeFeedback
};

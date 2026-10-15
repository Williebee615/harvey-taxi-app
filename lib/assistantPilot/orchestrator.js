// Assistant pilot: one conversational turn.
//
//   message (+ recent turns held by the browser)
//     -> safety and private-data boundaries (fixed answers, no retrieval, no model)
//     -> search_knowledge tool (authorized per call; own organization, public passages only)
//     -> nothing relevant: "not covered" + support contact; topic-only gap log
//     -> model available and within budget: streamed answer, then checked
//        (citations must be real, no stray links, no action claims);
//        a failed check replaces the text with the extractive answer
//     -> model unavailable / over budget / failed: extractive answer
//        quoting the passages (always works, no external call)
//
// Events (emit): meta, delta, replace, sources, followups, handoff, done.
// Nothing is stored except a topic label for unanswered questions.

const { sanitizeUserMessage, classifyEscalation } = require("../agent/escalation");
const { gapTopic } = require("../htafAssistant");
const { ORGS } = require("./orgs");
const { invokeTool } = require("./tools");
const { fitHistory, searchQueryFor } = require("./context");
const { systemPrompt, buildMessages } = require("./prompt");
const { checkAnswer, sourceRef } = require("./citations");

const MAX_MESSAGE_CHARS = 1000;

// Out of scope for the pilot: private records. Answered with a fixed
// pointer to staff, before retrieval or any model call.
const PRIVATE_TOPICS = [
  /\b(my|our|her|his|their)\s+(application|case|request)\b.*\b(status|approved|denied|decision|update)\b/i,
  /\b(status|decision)\b.*\b(my|our)\s+(application|case|request)\b/i,
  /\b(background check|checkr|criminal record)\b.*\b(my|result|status)\b/i,
  /\bmy\s+(background check|checkr|criminal record)\b/i,
  /\b(my|the)\s+(card|payment|charge|refund|receipt)\b/i,
  /\b(driver'?s licen[cs]e|ssn|social security|passport|identity document)\b.*\b(my|number|upload)\b/i,
  /\bwhere (is|are) (my|the) (driver|ride|car)\b/i
];

function isPrivateTopic(text) {
  return PRIVATE_TOPICS.some((re) => re.test(text));
}

function extractiveAnswer(passages, query) {
  const top = passages.slice(0, 2);
  const lines = top.map((p, i) => `${p.match ? p.text.slice(0, 600) : p.excerpt || p.text.slice(0, 300)} [S${i + 1}]`);
  return {
    text: `Here is what ${top.length > 1 ? "our published pages say" : "our published page says"}:\n${lines.join("\n")}`,
    sources: top.map((p, i) => sourceRef(p, i + 1)),
    query
  };
}

function followUps(org, passages, used, asked = []) {
  const askedSet = new Set(asked.map((q) => String(q || "").trim().toLowerCase()));
  const seen = new Set(used.map((p) => `${p.source_id}|${p.heading}`));
  const items = [];
  for (const p of passages) {
    const key = `${p.source_id}|${p.heading}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(`Tell me about "${p.heading}" (${p.title})`);
    if (items.length >= 2) break;
  }
  for (const s of ORGS[org].starters) {
    if (items.length >= 3) break;
    if (!askedSet.has(s.toLowerCase())) items.push(s);
  }
  return items.slice(0, 3);
}

// deps: { corpus, gateway (optional), modelEnabled, logGap, signal }
async function runTurn({ viewer, message, history, deps, emit }) {
  const org = viewer.org;
  const o = ORGS[org];
  const text = sanitizeUserMessage(String(message || "")).trim().slice(0, MAX_MESSAGE_CHARS);
  const handoff = { label: o.support.label, href: o.support.href };
  const finish = (mode, extra = {}) => {
    emit("done", { mode, ...extra });
    return { mode, ...extra };
  };
  emit("meta", { org, organization: o.name });

  if (!text) {
    emit("delta", { text: "Please type a question." });
    emit("followups", { items: o.starters.slice() });
    return finish("empty");
  }
  const escalation = classifyEscalation(text);
  if (escalation && escalation.category === "emergency") {
    emit("delta", { text: "If you or someone else is in danger, call 911 now. This assistant can't send help." });
    emit("handoff", handoff);
    return finish("emergency");
  }
  if (isPrivateTopic(text)) {
    emit("delta", { text: `I can't look up or discuss personal records here, such as application status, background checks, identity documents, payments or locations. Please contact ${o.name} directly through the ${o.support.label}.` });
    emit("handoff", handoff);
    return finish("boundary");
  }

  const { turns } = fitHistory(history);
  const askedQuestions = [text, ...turns.filter((t) => t.role === "user").map((t) => t.text)];
  const query = searchQueryFor(text, turns);
  const ctx = { viewer, corpus: deps.corpus, vectors: deps.vectors ? { ...deps.vectors, signal: deps.signal } : null, calls: { count: 0 } };
  // A follow-up is searched on its own and together with the previous
  // question; own-message matches come first.
  let found = await invokeTool(ctx, "search_knowledge", { query: text.slice(0, 500), limit: 5 });
  if (found.ok && query !== text) {
    const combined = await invokeTool(ctx, "search_knowledge", { query: query.slice(0, 500), limit: 5 });
    if (combined.ok) {
      const seen = new Set(found.passages.map((p) => p.id));
      found = { ok: true, passages: [...found.passages, ...combined.passages.filter((p) => !seen.has(p.id))] };
    }
  }
  if (!found.ok) {
    emit("delta", { text: `Sorry, I couldn't search ${o.name}'s information just now.` });
    emit("handoff", handoff);
    return finish("error", { reason: found.error });
  }
  const passages = found.passages.slice(0, 4);
  // How passages were found: "keyword", "hybrid" or "keyword_fallback".
  const retrieval = found.retrieval || "keyword";

  if (!passages.length) {
    if (deps.logGap) await deps.logGap({ org, topic: gapTopic(text) });
    emit("delta", { text: `The approved ${o.name} information I can search doesn't cover that, so I won't guess. Please contact ${o.name} through the ${o.support.label}.` });
    emit("followups", { items: o.starters.slice() });
    emit("handoff", handoff);
    return finish("unsupported", { uncertain: true, retrieval });
  }

  const fallback = (reason) => {
    const ex = extractiveAnswer(passages, query);
    return { ex, reason };
  };

  let mode = "extractive";
  let reason = deps.modelEnabled ? null : "model_off";
  let sources;
  if (deps.modelEnabled && deps.gateway && deps.gateway.available) {
    const res = await deps.gateway.stream({
      system: systemPrompt(org),
      messages: buildMessages({ turns, message: text, passages }),
      signal: deps.signal,
      onText: (t) => emit("delta", { text: t })
    });
    if (res.ok) {
      const check = checkAnswer(res.text, passages);
      if (check.ok) {
        mode = "model";
        sources = check.sources;
        if (check.notCovered) {
          emit("handoff", handoff);
          emit("sources", { items: [] });
          emit("followups", { items: followUps(org, found.passages, [], askedQuestions) });
          return finish("model", { uncertain: true, retrieval });
        }
      } else {
        const { ex } = fallback(check.problem);
        emit("replace", { text: ex.text, reason: check.problem });
        sources = ex.sources;
        reason = check.problem;
      }
    } else {
      const { ex } = fallback(res.reason);
      if (res.partial) emit("replace", { text: ex.text, reason: res.reason });
      else emit("delta", { text: ex.text });
      sources = ex.sources;
      reason = res.reason;
    }
  } else {
    if (deps.modelEnabled) reason = "provider_unavailable";
    const { ex } = fallback(reason);
    emit("delta", { text: ex.text });
    sources = ex.sources;
  }
  emit("sources", { items: sources });
  emit("followups", { items: followUps(org, found.passages, passages.slice(0, sources.length), askedQuestions) });
  return finish(mode, { reason, uncertain: false, retrieval });
}

module.exports = { runTurn, isPrivateTopic, extractiveAnswer, PRIVATE_TOPICS, MAX_MESSAGE_CHARS };

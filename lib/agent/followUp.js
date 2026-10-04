// Follow-up questions (docs/ai-knowledge.md, phase 3).
//
// Conversation memory lives only on the user's device. With each new
// message the app may send its last few turns as `context`. The server
// does not store or log them. It uses them for one thing: when the new
// message is a short follow-up ("what about drivers?", "and how long?"),
// the previous question is combined with it so the follow-up is routed
// and searched like a complete question.
//
// Context is untrusted input like the message itself: sanitized, capped,
// and never able to choose a tool, an account or an action. Safety
// boundaries (emergency, fraud...) are checked on the new message alone,
// so an old message can't trigger or suppress them.

const { sanitizeUserMessage } = require("./escalation");

const MAX_TURNS = 6;
const MAX_TURN_LENGTH = 500;

const FOLLOW_UP = /^(and|also|but|so|what about|how about|what if|why|how come|tell me more|more|which|what else|and if|does that|is that|does it|is it|can i|what do you mean)\b|\b(that|this|it|those|them|there)\b[?.!]*$/i;

// Accepts what a client sent; returns at most MAX_TURNS clean turns.
function cleanContext(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(-MAX_TURNS)
    .map((t) => ({
      role: t && t.role === "assistant" ? "assistant" : "user",
      text: sanitizeUserMessage(typeof (t && t.text) === "string" ? t.text.slice(0, MAX_TURN_LENGTH) : "")
    }))
    .filter((t) => t.text);
}

function isFollowUp(message) {
  const text = sanitizeUserMessage(message);
  if (!text) return false;
  const words = text.split(/\s+/).length;
  return words <= 8 && FOLLOW_UP.test(text);
}

// The text to route and search: the message itself, or for a short
// follow-up, the user's previous question plus the follow-up.
function resolveQuestion(message, context) {
  const text = sanitizeUserMessage(message);
  if (!isFollowUp(text)) return { text, used_context: false };
  const turns = cleanContext(context);
  const previous = [...turns].reverse().find((t) => t.role === "user");
  if (!previous) return { text, used_context: false };
  return { text: sanitizeUserMessage(`${previous.text} ${text}`), used_context: true };
}

module.exports = { MAX_TURNS, cleanContext, isFollowUp, resolveQuestion };

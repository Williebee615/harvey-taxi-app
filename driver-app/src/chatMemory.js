// Harvey Assistant conversation memory (docs/ai-knowledge.md, phase 3).
//
// Device-only and in memory only: kept per signed-in account while the
// app runs, so leaving and reopening the assistant keeps the conversation.
// Cleared by "Clear chat", by signing out (useDriverApp.signOut) and when
// the app restarts. Nothing is written to disk or stored on the server;
// the last few turns are sent with a new question only so the server can
// understand a short follow-up.

const MAX_MESSAGES = 40;
export const CONTEXT_TURNS = 6;

const byAccount = new Map();

export function loadChat(accountId) {
  return accountId ? byAccount.get(String(accountId)) || null : null;
}

export function saveChat(accountId, messages) {
  if (!accountId) return;
  byAccount.set(String(accountId), (messages || []).slice(-MAX_MESSAGES));
}

export function clearChat(accountId) {
  if (accountId) byAccount.delete(String(accountId));
}

export function clearAllChats() {
  byAccount.clear();
}

// The recent turns sent with a new question: text only, no actions,
// sources or ids.
export function contextFrom(messages) {
  return (messages || [])
    .filter((m) => m && m.id !== 0 && (m.who === 'me' || m.who === 'bot') && typeof m.text === 'string')
    .slice(-CONTEXT_TURNS)
    .map((m) => ({ role: m.who === 'me' ? 'user' : 'assistant', text: m.text.slice(0, 500) }));
}

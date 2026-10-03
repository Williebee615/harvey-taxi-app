// Reconnect delays: 1 s doubling to 60 s, with up to 30% jitter so many
// drivers reconnecting after an outage don't all arrive at once.
export const BACKOFF_BASE_MS = 1000;
export const BACKOFF_MAX_MS = 60000;

export function backoffDelay(attempt, random = Math.random) {
  const exp = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, attempt));
  return Math.round(exp * (0.7 + 0.3 * random()));
}

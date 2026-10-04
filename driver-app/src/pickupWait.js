// Waiting at the pickup: the timer and what the no-show control still
// needs (server: lib/cancellationRecords.js noShowEligibility). Wording
// promises no fee: cancellations are free in this phase.

export const NO_SHOW_WAIT_SECONDS = 7 * 60;

export function waitingSeconds(arrivedAt, now = Date.now()) {
  const t = arrivedAt ? new Date(arrivedAt).getTime() : NaN;
  return Number.isFinite(t) ? Math.max(0, Math.floor((now - t) / 1000)) : 0;
}

export function formatWait(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const MISSING_TEXT = Object.freeze({
  not_arrived: "Tap \"I've arrived at pickup\" first.",
  arrival_not_verified: "Your arrival at the pickup wasn't confirmed by location. Contact support if the rider doesn't come out.",
  wait_under_7_minutes: 'Wait at least 7 minutes after arriving.',
  no_contact_attempt_after_arrival: 'Try calling the rider from this screen.'
});

// One line for the driver: what to do next about a rider who hasn't come out.
export function noShowText(status) {
  if (!status) return 'Rider not here yet? Call them from this screen.';
  if (!status.enabled) return 'Rider not here? Wait, call them from this screen, and contact support if they still don\'t come out.';
  if (status.eligible) return "You can mark this rider as a no-show. The ride is cancelled at no charge to the rider.";
  return (status.missing || []).map((m) => MISSING_TEXT[m]).filter(Boolean).join(' ');
}

// Foreground alert for a new ride offer: a vibration and the standard
// notification sound, once per offer, while the app is on screen. Offers
// last 45 seconds, and before this a driver glancing away from the phone
// had no cue that one had arrived (review ride RIDE-06D4C93EF9). When the
// app is in the background, alerting is native push's job
// (driver_native_push_enabled), not this module's.
//
// Dependencies are injected so the once-per-offer and foreground-only
// rules are unit tested without native modules.

const MAX_REMEMBERED = 100;

export function createOfferAlerter({ vibrate, playSound, isForeground }) {
  const seen = new Set();

  function remember(id) {
    seen.add(id);
    if (seen.size > MAX_REMEMBERED) seen.delete(seen.values().next().value);
  }

  // Call with every state snapshot. Returns the offer ids that alerted.
  function onSnapshot(snapshot) {
    const ids = ((snapshot && snapshot.offers) || []).map((o) => o && o.offer_id).filter(Boolean);
    const fresh = ids.filter((id) => !seen.has(id));
    ids.forEach(remember);
    if (!fresh.length || !isForeground()) return [];
    try {
      vibrate();
    } catch {
      // Vibration is best effort.
    }
    Promise.resolve()
      .then(playSound)
      .catch(() => {});
    return fresh;
  }

  return { onSnapshot };
}

export const OFFER_VIBRATION_PATTERN = [0, 400, 200, 400];

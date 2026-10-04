// Keeps the app's copy of the driver's state current with as few requests
// as possible:
//   - while online or on a trip: one authenticated event stream; each
//     event triggers one re-read of GET /api/driver/state, plus a
//     reconcile every reconcile_ms (60 s) in case an event was missed;
//   - if the stream drops: reconnect with backoff, and meanwhile poll at
//     the server's poll_ms hint;
//   - while offline: no stream and no polling; refresh on foreground and
//     after the driver's own actions.
// All timers and I/O are injected so this is unit tested.
import { backoffDelay } from './backoff';

export function createSyncEngine({
  fetchState,
  openStream,
  onSnapshot,
  onStatus = () => {},
  onUnauthorized = () => {},
  // Called with the error when a read fails, and with null once a read
  // succeeds again, so the screen can say the server can't be reached.
  onError = () => {},
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
  random = Math.random
}) {
  let snapshot = null;
  let stream = null;
  let streamLive = false;
  let attempt = 0;
  let reconnectTimer = null;
  let pollTimer = null;
  let expiryTimer = null;
  let retryTimer = null;
  let failures = 0;
  let inFlight = null;
  let queued = false;
  let running = false;

  const wantsStream = () => Boolean(snapshot && snapshot.mode !== 'offline');

  function status() {
    onStatus({ stream: streamLive ? 'live' : stream || reconnectTimer ? 'reconnecting' : 'idle', attempt });
  }

  function clear(timer) {
    if (timer) clearTimer(timer);
    return null;
  }

  function schedule() {
    pollTimer = clear(pollTimer);
    expiryTimer = clear(expiryTimer);
    if (!running || !snapshot) return;
    const interval = streamLive ? snapshot.reconcile_ms : snapshot.poll_ms;
    if (interval > 0) pollTimer = setTimer(() => refresh('poll'), interval);
    // Re-read just after the soonest offer expires so it leaves the screen.
    const left = (snapshot.offers || []).map((o) => o.seconds_left).filter((s) => Number.isFinite(s));
    if (left.length) expiryTimer = setTimer(() => refresh('offer_expiry'), (Math.min(...left) + 1) * 1000);
  }

  function closeStream() {
    if (stream) stream.close();
    stream = null;
    streamLive = false;
    reconnectTimer = clear(reconnectTimer);
  }

  function ensureStream() {
    if (!running) return;
    if (!wantsStream()) {
      if (stream || reconnectTimer) {
        closeStream();
        status();
      }
      return;
    }
    if (stream || reconnectTimer) return;
    stream = openStream({
      onOpen: () => {
        streamLive = true;
        attempt = 0;
        status();
        refresh('stream_open');
      },
      onEvent: ({ event }) => {
        if (event === 'sync') refresh('event');
      },
      onError: ({ status: code } = {}) => {
        stream = null;
        streamLive = false;
        if (code === 401) {
          onUnauthorized();
          return;
        }
        if (!running) return;
        const delay = backoffDelay(attempt, random);
        attempt += 1;
        reconnectTimer = setTimer(() => {
          reconnectTimer = null;
          ensureStream();
        }, delay);
        status();
        schedule(); // fall back to polling while disconnected
      }
    });
    status();
  }

  async function refresh(reason = 'manual') {
    if (!running) return snapshot;
    if (inFlight) {
      queued = true;
      return inFlight;
    }
    inFlight = (async () => {
      try {
        const next = await fetchState(reason);
        snapshot = next;
        retryTimer = clear(retryTimer);
        if (failures) onError(null);
        failures = 0;
        onSnapshot(next, reason);
      } catch (err) {
        if (err && err.status === 401) {
          onUnauthorized();
        } else {
          // Retry with backoff until a read succeeds. Without this, a
          // failed first read left the app loading forever (no snapshot,
          // so no stream and no poll), and an offline driver's screen
          // would stay stale with nothing asking again.
          failures += 1;
          onError(err || new Error('Request failed'));
          if (running && !retryTimer) {
            retryTimer = setTimer(() => {
              retryTimer = null;
              refresh('retry');
            }, backoffDelay(failures - 1, random));
          }
        }
      } finally {
        inFlight = null;
      }
      ensureStream();
      schedule();
      if (queued) {
        queued = false;
        return refresh('queued');
      }
      return snapshot;
    })();
    return inFlight;
  }

  return {
    start() {
      running = true;
      return refresh('start');
    },
    stop() {
      running = false;
      closeStream();
      retryTimer = clear(retryTimer);
      pollTimer = clear(pollTimer);
      expiryTimer = clear(expiryTimer);
      status();
    },
    refresh,
    // App returned to the foreground or the network came back: reconnect
    // immediately rather than waiting out the backoff.
    resume() {
      if (!running) return Promise.resolve(snapshot);
      if (reconnectTimer) {
        reconnectTimer = clear(reconnectTimer);
        attempt = 0;
      }
      return refresh('resume');
    },
    getSnapshot: () => snapshot
  };
}

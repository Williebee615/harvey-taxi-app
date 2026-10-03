import { createSyncEngine } from '../src/syncEngine';

function harness(snapshots) {
  const timers = [];
  const streams = [];
  const fetches = [];
  const statuses = [];
  let unauthorized = 0;
  const queue = [...snapshots];
  const engine = createSyncEngine({
    fetchState: async (reason) => {
      fetches.push(reason);
      const next = queue.length > 1 ? queue.shift() : queue[0];
      if (next instanceof Error) throw next;
      return next;
    },
    openStream: (handlers) => {
      const s = { handlers, closed: false, close() { this.closed = true; } };
      streams.push(s);
      return s;
    },
    onSnapshot: () => {},
    onStatus: (s) => statuses.push(s.stream),
    onUnauthorized: () => (unauthorized += 1),
    setTimer: (fn, ms) => {
      const t = { fn, ms, cleared: false };
      timers.push(t);
      return t;
    },
    clearTimer: (t) => {
      t.cleared = true;
    },
    random: () => 1
  });
  const live = () => timers.filter((t) => !t.cleared);
  const fire = async (pred) => {
    const t = live().find(pred);
    t.cleared = true;
    await t.fn();
    await Promise.resolve();
  };
  return { engine, timers, live, fire, streams, fetches, statuses, unauthorized: () => unauthorized };
}

const snap = (mode, extra = {}) => ({ mode, poll_ms: { offline: 0, online_idle: 30000, offer_pending: 5000, on_trip: 15000 }[mode], reconcile_ms: 60000, offers: [], ...extra });

test('offline: no stream and no polling', async () => {
  const h = harness([snap('offline')]);
  await h.engine.start();
  expect(h.streams).toHaveLength(0);
  expect(h.live()).toHaveLength(0);
  expect(h.fetches).toEqual(['start']);
});

test('online: one stream; events re-read state; reconcile every 60 s while live', async () => {
  const h = harness([snap('online_idle')]);
  await h.engine.start();
  expect(h.streams).toHaveLength(1);
  h.streams[0].handlers.onOpen();
  await Promise.resolve();
  await Promise.resolve();
  expect(h.fetches).toEqual(['start', 'stream_open']);
  expect(h.live().map((t) => t.ms)).toEqual([60000]);
  h.streams[0].handlers.onEvent({ event: 'heartbeat' });
  h.streams[0].handlers.onEvent({ event: 'sync' });
  await Promise.resolve();
  expect(h.fetches).toEqual(['start', 'stream_open', 'event']);
});

test('stream drop: reconnect with backoff and poll at the server hint meanwhile; resume reconnects at once', async () => {
  const h = harness([snap('on_trip')]);
  await h.engine.start();
  h.streams[0].handlers.onOpen();
  await Promise.resolve();
  h.streams[0].handlers.onError({ status: 0 });
  const delays = h.live().map((t) => t.ms).sort((a, b) => a - b);
  expect(delays).toEqual([1000, 15000]); // reconnect after 1 s; poll every 15 s
  expect(h.statuses[h.statuses.length - 1]).toBe('reconnecting');
  await h.fire((t) => t.ms === 1000);
  expect(h.streams).toHaveLength(2);
  h.streams[1].handlers.onError({ status: 0 });
  expect(h.live().some((t) => t.ms === 2000)).toBe(true); // doubled
  await h.engine.resume();
  expect(h.streams).toHaveLength(3);
});

test('going offline closes the stream', async () => {
  const h = harness([snap('online_idle'), snap('offline')]);
  await h.engine.start();
  expect(h.streams).toHaveLength(1);
  await h.engine.refresh('went_offline');
  expect(h.streams[0].closed).toBe(true);
});

test('a pending offer schedules a re-read just after it expires', async () => {
  const h = harness([snap('offer_pending', { offers: [{ offer_id: 'O', seconds_left: 12 }] })]);
  await h.engine.start();
  expect(h.live().map((t) => t.ms)).toContain(13000);
});

test('a 401 from the stream or the state read signs the driver out', async () => {
  const h = harness([snap('online_idle')]);
  await h.engine.start();
  h.streams[0].handlers.onError({ status: 401 });
  expect(h.unauthorized()).toBe(1);
  const err = Object.assign(new Error('x'), { status: 401 });
  const h2 = harness([err]);
  await h2.engine.start();
  expect(h2.unauthorized()).toBe(1);
});

test('concurrent refreshes are coalesced into one follow-up read', async () => {
  const h = harness([snap('offline')]);
  await h.engine.start();
  const a = h.engine.refresh('a');
  h.engine.refresh('b');
  h.engine.refresh('c');
  await a;
  await Promise.resolve();
  expect(h.fetches).toEqual(['start', 'a', 'queued']);
});

test('stop clears every timer and the stream', async () => {
  const h = harness([snap('on_trip')]);
  await h.engine.start();
  h.engine.stop();
  expect(h.live()).toHaveLength(0);
  expect(h.streams[0].closed).toBe(true);
});

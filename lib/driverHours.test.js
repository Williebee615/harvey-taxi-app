const h = require("./driverHours");

const H = 3600e3;
const now = Date.parse("2026-10-04T20:00:00Z");
const iso = (msAgo) => new Date(now - msAgo).toISOString();
const shift = (rows) => h.computeShift(rows, { nowMs: now, maxOnlineMs: 12 * H, minRestMs: 6 * H });

test("no sessions: full shift available", () => {
  expect(shift([])).toMatchObject({ worked_ms: 0, limit_reached: false, can_go_online: true, rest_until: null });
});

test("online now: counts the open session", () => {
  expect(shift([{ started_at: iso(5 * H), ended_at: null }])).toMatchObject({ worked_ms: 5 * H, online_now: true, can_go_online: true });
});

test("online past the limit: limit reached, no rest time yet", () => {
  expect(shift([{ started_at: iso(13 * H), ended_at: null }])).toMatchObject({ limit_reached: true, can_go_online: false, rest_until: null });
});

test("offline after the limit: rest until 6 hours after going offline", () => {
  expect(shift([{ started_at: iso(14 * H), ended_at: iso(1 * H) }])).toMatchObject({
    limit_reached: true,
    can_go_online: false,
    rest_until: new Date(now + 5 * H).toISOString()
  });
});

test("6 hours offline resets the shift", () => {
  expect(shift([{ started_at: iso(20 * H), ended_at: iso(6 * H) }])).toMatchObject({ worked_ms: 0, can_go_online: true });
});

test("breaks shorter than 6 hours don't reset the count", () => {
  const s = shift([
    { started_at: iso(20 * H), ended_at: iso(14 * H) },
    { started_at: iso(10 * H), ended_at: iso(4 * H) }
  ]);
  expect(s).toMatchObject({ worked_ms: 12 * H, limit_reached: true, rest_until: new Date(now + 2 * H).toISOString() });
});

test("a 6-hour gap between sessions separates shifts", () => {
  const s = shift([
    { started_at: iso(30 * H), ended_at: iso(18 * H) },
    { started_at: iso(10 * H), ended_at: null }
  ]);
  expect(s).toMatchObject({ worked_ms: 10 * H, limit_reached: false, can_go_online: true });
});

test("env overrides; invalid values fall back to 12 and 6", () => {
  expect(h.limitsFromEnv({ DRIVER_MAX_ONLINE_HOURS: "10", DRIVER_MIN_REST_HOURS: "8" })).toEqual({ maxOnlineMs: 10 * H, minRestMs: 8 * H });
  expect(h.limitsFromEnv({ DRIVER_MAX_ONLINE_HOURS: "x", DRIVER_MIN_REST_HOURS: "-1" })).toEqual({ maxOnlineMs: 12 * H, minRestMs: 6 * H });
});

test("app view and message", () => {
  const s = shift([{ started_at: iso(14 * H), ended_at: iso(1 * H) }]);
  expect(h.hoursForApp(s)).toMatchObject({ limit_minutes: 720, remaining_minutes: 0, rest_hours: 6, can_go_online: false });
  expect(h.restMessage(s)).toBe("You've reached 12 hours online. Drivers must rest for 6 hours before going online again.");
});

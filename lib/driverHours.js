// Driver hours limit (docs/driver-hours.md). Pure functions; server.js
// loads the rows and enforces.
//
// Rule: a driver may be online for up to 12 hours in a shift. After that
// they must be offline for 6 hours in a row before going online again.
// Any 6-hour (or longer) offline stretch ends the shift and resets the
// count, so short breaks pause the clock but do not reset it.
//
// "Online" is measured from driver_online_sessions, which a database
// trigger fills whenever drivers.online changes, whichever code path
// changed it. A trip in progress is never interrupted: the driver is taken
// offline once it ends.

const HOUR_MS = 60 * 60 * 1000;

function limitsFromEnv(env = process.env) {
  const max = Number(env.DRIVER_MAX_ONLINE_HOURS);
  const rest = Number(env.DRIVER_MIN_REST_HOURS);
  return {
    maxOnlineMs: (Number.isFinite(max) && max > 0 ? max : 12) * HOUR_MS,
    minRestMs: (Number.isFinite(rest) && rest > 0 ? rest : 6) * HOUR_MS
  };
}

function ms(iso) {
  const t = Date.parse(iso || "");
  return Number.isFinite(t) ? t : null;
}

// sessions: this driver's rows { started_at, ended_at|null }, any order,
// covering at least the last (maxOnline + minRest) hours plus any open one.
// Returns the current shift:
//   worked_ms        online time in the current shift
//   online_now       an open session exists
//   remaining_ms     time left before the limit (0 when reached)
//   limit_reached    worked_ms >= maxOnline
//   rest_until       ISO time the driver may go online again, when the
//                    limit is reached and they are offline; null otherwise
//   can_go_online    false only while rest is required
function computeShift(sessions, { nowMs = Date.now(), maxOnlineMs, minRestMs } = limitsFromEnv()) {
  const rows = (sessions || [])
    .map((s) => ({ start: ms(s.started_at), end: s.ended_at ? ms(s.ended_at) : null }))
    .filter((s) => s.start !== null && s.start <= nowMs)
    .map((s) => ({ start: s.start, end: s.end === null ? null : Math.min(Math.max(s.end, s.start), nowMs) }))
    .sort((a, b) => b.start - a.start);

  const onlineNow = rows.some((s) => s.end === null);
  const lastEnd = !onlineNow && rows.length ? Math.max(...rows.map((s) => s.end)) : null;

  // Offline for minRest or more: the previous shift is over.
  if (lastEnd !== null && nowMs - lastEnd >= minRestMs) {
    return shiftResult({ worked: 0, onlineNow, lastEnd, nowMs, maxOnlineMs, minRestMs });
  }

  // Walk back from the latest session, adding online time, until a gap of
  // minRest or more separates a session from the one after it.
  let worked = 0;
  let cursor = onlineNow ? nowMs : lastEnd;
  for (const s of rows) {
    const end = s.end === null ? nowMs : s.end;
    if (cursor !== null && cursor - end >= minRestMs) break;
    worked += Math.max(0, Math.min(end, cursor === null ? end : cursor) - s.start);
    cursor = cursor === null ? s.start : Math.min(cursor, s.start);
  }

  return shiftResult({ worked, onlineNow, lastEnd, nowMs, maxOnlineMs, minRestMs });
}

function shiftResult({ worked, onlineNow, lastEnd, nowMs, maxOnlineMs, minRestMs }) {
  const limitReached = worked >= maxOnlineMs;
  const restUntilMs = limitReached && !onlineNow && lastEnd !== null ? lastEnd + minRestMs : null;
  return {
    worked_ms: worked,
    online_now: onlineNow,
    remaining_ms: Math.max(0, maxOnlineMs - worked),
    limit_reached: limitReached,
    rest_until: restUntilMs !== null && restUntilMs > nowMs ? new Date(restUntilMs).toISOString() : null,
    can_go_online: !(limitReached && (onlineNow || (restUntilMs !== null && restUntilMs > nowMs))),
    max_online_ms: maxOnlineMs,
    min_rest_ms: minRestMs
  };
}

// The window of sessions the computation needs: anything open, or ended
// within this many ms of now. A shift can stretch longer than 12 hours of
// wall time when broken by short rests, so look back generously.
function lookbackMs({ maxOnlineMs, minRestMs } = limitsFromEnv()) {
  return 3 * (maxOnlineMs + minRestMs);
}

// The app's view of the shift, without internal fields.
function hoursForApp(shift) {
  if (!shift) return null;
  return {
    worked_minutes: Math.floor(shift.worked_ms / 60000),
    limit_minutes: Math.round(shift.max_online_ms / 60000),
    remaining_minutes: Math.floor(shift.remaining_ms / 60000),
    rest_hours: Math.round(shift.min_rest_ms / HOUR_MS),
    limit_reached: shift.limit_reached,
    rest_until: shift.rest_until,
    can_go_online: shift.can_go_online
  };
}

function restMessage(shift) {
  const hours = Math.round(shift.max_online_ms / HOUR_MS);
  const rest = Math.round(shift.min_rest_ms / HOUR_MS);
  return `You've reached ${hours} hours online. Drivers must rest for ${rest} hours before going online again.`;
}

module.exports = { HOUR_MS, limitsFromEnv, computeShift, lookbackMs, hoursForApp, restMessage };

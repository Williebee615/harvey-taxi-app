// Driver hours limit text for the Drive screen (docs/driver-hours.md).
// The server enforces the limit; this only explains it.

export function formatMinutes(total) {
  const m = Math.max(0, Math.floor(Number(total) || 0));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (!h) return `${r}m`;
  return r ? `${h}h ${r}m` : `${h}h`;
}

export function formatClock(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

// { usage, rest } strings, or null when the server sent no hours (review
// accounts, older servers).
export function hoursText(hours) {
  if (!hours) return null;
  const limit = formatMinutes(hours.limit_minutes);
  const usage = `Online this shift: ${formatMinutes(hours.worked_minutes)} of ${limit}`;
  if (hours.can_go_online === false) {
    const at = hours.rest_until ? formatClock(hours.rest_until) : null;
    return {
      usage,
      rest: at
        ? `You've reached ${limit} online. Rest required: you can go online again at ${at}.`
        : `You've reached ${limit} online. You'll be taken offline after this trip, then ${hours.rest_hours}h of rest is required.`
    };
  }
  if (hours.remaining_minutes <= 60) {
    return { usage, rest: `${formatMinutes(hours.remaining_minutes)} left before a ${hours.rest_hours}-hour rest is required.` };
  }
  return { usage, rest: null };
}

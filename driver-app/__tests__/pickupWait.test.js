import { formatWait, waitingSeconds, NO_SHOW_WAIT_SECONDS } from '../src/pickupWait';

test('waiting timer', () => {
  const now = Date.parse('2026-10-05T12:10:00Z');
  expect(waitingSeconds('2026-10-05T12:02:30Z', now)).toBe(450);
  expect(waitingSeconds(null, now)).toBe(0);
  expect(waitingSeconds('2026-10-05T12:20:00Z', now)).toBe(0);
  expect(formatWait(450)).toBe('7:30');
  expect(formatWait(5)).toBe('0:05');
  expect(NO_SHOW_WAIT_SECONDS).toBe(420);
});

import { formatMinutes, hoursText } from '../src/hours';

test('formatMinutes', () => {
  expect(formatMinutes(0)).toBe('0m');
  expect(formatMinutes(45)).toBe('45m');
  expect(formatMinutes(120)).toBe('2h');
  expect(formatMinutes(725)).toBe('12h 5m');
});

test('normal shift: usage only', () => {
  expect(hoursText({ worked_minutes: 125, limit_minutes: 720, remaining_minutes: 595, rest_hours: 6, can_go_online: true })).toEqual({
    usage: 'Online this shift: 2h 5m of 12h',
    rest: null
  });
});

test('last hour: warns about the rest', () => {
  expect(hoursText({ worked_minutes: 680, limit_minutes: 720, remaining_minutes: 40, rest_hours: 6, can_go_online: true }).rest).toBe(
    '40m left before a 6-hour rest is required.'
  );
});

test('limit reached: rest required until a time, or after the current trip', () => {
  const blocked = hoursText({ worked_minutes: 720, limit_minutes: 720, remaining_minutes: 0, rest_hours: 6, can_go_online: false, rest_until: '2026-10-04T20:30:00Z' });
  expect(blocked.rest).toMatch(/^You've reached 12h online\. Rest required: you can go online again at .+\.$/);
  const onTrip = hoursText({ worked_minutes: 730, limit_minutes: 720, remaining_minutes: 0, rest_hours: 6, can_go_online: false, rest_until: null });
  expect(onTrip.rest).toBe("You've reached 12h online. You'll be taken offline after this trip, then 6h of rest is required.");
});

test('no hours block: nothing shown', () => {
  expect(hoursText(null)).toBeNull();
});

import { PROFILES, profileFor, shouldSend, distanceMeters, MAX_SILENCE_MS } from '../src/locationPolicy';
import { nextStep, stepPath, directionsUrl, isDelivery } from '../src/tripSteps';
import { parseSseChunk, openEventStream } from '../src/sse';
import { backoffDelay, BACKOFF_MAX_MS } from '../src/backoff';
import { createApi, ApiError } from '../src/api';

describe('location policy', () => {
  test('no tracking offline; coarse when idle; precise on the way and on trip; slow when parked', () => {
    expect(profileFor(null)).toBeNull();
    expect(profileFor({ driver: { online: false }, active_ride: null })).toBeNull();
    expect(profileFor({ driver: { online: true }, active_ride: null })).toBe(PROFILES.idle);
    expect(profileFor({ driver: { online: false }, active_ride: { status: 'driver_enroute' } })).toBe(PROFILES.pickup);
    expect(profileFor({ driver: { online: true }, active_ride: { status: 'arrived' } })).toBe(PROFILES.arrived);
    expect(profileFor({ driver: { online: true }, active_ride: { status: 'in_progress' } })).toBe(PROFILES.trip);
  });

  test('every profile stays above the server 5 s throttle', () => {
    Object.values(PROFILES).filter(Boolean).forEach((p) => expect(p.minSendMs).toBeGreaterThanOrEqual(5000));
  });

  test('deduplicates: too soon, too close or too inaccurate is not sent; long silence is', () => {
    const p = PROFILES.trip;
    const last = { latitude: 36.16, longitude: -86.78, sentAt: 0 };
    const near = { latitude: 36.16005, longitude: -86.78 }; // ~5.5 m
    const far = { latitude: 36.161, longitude: -86.78 }; // ~111 m
    expect(shouldSend({ profile: p, last: null, fix: near, now: 0 })).toBe(true);
    expect(shouldSend({ profile: p, last, fix: far, now: 5000 })).toBe(false);
    expect(shouldSend({ profile: p, last, fix: near, now: 20000 })).toBe(false);
    expect(shouldSend({ profile: p, last, fix: far, now: 20000 })).toBe(true);
    expect(shouldSend({ profile: p, last, fix: { ...far, accuracy: 500 }, now: 20000 })).toBe(false);
    expect(shouldSend({ profile: p, last, fix: near, now: MAX_SILENCE_MS })).toBe(true);
    expect(shouldSend({ profile: null, last, fix: far, now: 999999 })).toBe(false);
    expect(Math.round(distanceMeters(last, far))).toBe(111);
  });
});

describe('trip steps', () => {
  test('maps each status to the existing driver route', () => {
    const ride = { ride_id: 'R 1', status: 'driver_assigned' };
    expect(stepPath(ride, nextStep(ride))).toBe('/api/driver/rides/R%201/enroute');
    expect(nextStep({ status: 'driver_enroute' }).action).toBe('arrived');
    expect(nextStep({ status: 'arrived' }).action).toBe('start');
    expect(nextStep({ status: 'in_progress' }).action).toBe('complete');
    expect(nextStep({ status: 'completed' })).toBeNull();
    expect(nextStep({ status: 'driver_assigned', ride_type: 'food' })).toBeNull();
    expect(isDelivery({ ride_type: 'grocery' })).toBe(true);
  });

  test('directions use coordinates when known, otherwise the address', () => {
    expect(directionsUrl({ lat: 36.1, lng: -86.7 }, 'ios')).toBe('https://maps.apple.com/?daddr=36.1,-86.7&dirflg=d');
    expect(directionsUrl({ address: '1 Broadway, Nashville' }, 'android')).toBe(
      'https://www.google.com/maps/dir/?api=1&destination=1%20Broadway%2C%20Nashville&travelmode=driving'
    );
    expect(directionsUrl({}, 'ios')).toBeNull();
  });
});

describe('SSE', () => {
  test('parses events split across chunks, ignores comments, keeps the remainder', () => {
    const a = parseSseChunk('event: connected\ndata: {"x":1}\n\n: comment\n\nevent: sy');
    expect(a.events).toEqual([{ event: 'connected', data: { x: 1 } }]);
    const b = parseSseChunk(`${a.rest}nc\ndata: {}\r\n\r\nevent: heartbeat\ndata: {}\n\n`);
    expect(b.events.map((e) => e.event)).toEqual(['sync', 'heartbeat']);
    expect(b.rest).toBe('');
  });

  function fakeXhr() {
    const inst = { headers: {}, readyState: 0, status: 0, responseText: '' };
    function XHR() {
      Object.assign(this, inst);
      inst.self = this;
    }
    XHR.prototype.open = function open(m, u) {
      this.url = u;
    };
    XHR.prototype.setRequestHeader = function set(k, v) {
      this.headers[k] = v;
    };
    XHR.prototype.send = function send() {};
    XHR.prototype.abort = function abort() {
      this.aborted = true;
    };
    return { XHR, get: () => inst.self };
  }

  test('sends the token as a header, reports open, events and the end', () => {
    const { XHR, get } = fakeXhr();
    const seen = [];
    openEventStream({
      url: 'https://x/api/driver/stream',
      headers: { 'x-driver-token': 'T' },
      XHR,
      onOpen: () => seen.push('open'),
      onEvent: (e) => seen.push(e.event),
      onError: (e) => seen.push(`error:${e.status}:${Boolean(e.ended)}`)
    });
    const x = get();
    expect(x.url).toBe('https://x/api/driver/stream');
    expect(x.headers['x-driver-token']).toBe('T');
    x.status = 200;
    x.readyState = 3;
    x.responseText = 'event: connected\ndata: {}\n\nevent: sync\nda';
    x.onreadystatechange();
    x.responseText += 'ta: {}\n\n';
    x.onreadystatechange();
    x.readyState = 4;
    x.onreadystatechange();
    expect(seen).toEqual(['open', 'connected', 'sync', 'error:200:true']);
  });

  test('a 401 is reported once and never as open', () => {
    const { XHR, get } = fakeXhr();
    const seen = [];
    openEventStream({ url: 'u', XHR, onOpen: () => seen.push('open'), onError: (e) => seen.push(e.status) });
    const x = get();
    x.status = 401;
    x.readyState = 2;
    x.onreadystatechange();
    x.readyState = 4;
    x.onreadystatechange();
    expect(seen).toEqual([401]);
  });
});

test('backoff doubles to a 60 s cap with bounded jitter', () => {
  expect(backoffDelay(0, () => 1)).toBe(1000);
  expect(backoffDelay(3, () => 1)).toBe(8000);
  expect(backoffDelay(20, () => 1)).toBe(BACKOFF_MAX_MS);
  expect(backoffDelay(3, () => 0)).toBe(5600);
});

describe('api client', () => {
  test('sends the session token header and JSON; maps errors; 401 signs out', async () => {
    const calls = [];
    let unauthorized = 0;
    const responses = [
      { ok: true, status: 200, json: async () => ({ ok: true, x: 1 }) },
      { ok: false, status: 403, json: async () => ({ ok: false, error: 'You cannot go online until verification is complete.' }) },
      { ok: false, status: 401, json: async () => ({ ok: false, error: 'expired' }) }
    ];
    const api = createApi({
      base: 'https://h',
      getToken: async () => 'TOKEN',
      onUnauthorized: () => (unauthorized += 1),
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return responses.shift();
      }
    });
    expect(await api.post('/api/driver/status', { online: true })).toEqual({ ok: true, x: 1 });
    expect(calls[0].url).toBe('https://h/api/driver/status');
    expect(calls[0].init.headers['x-driver-token']).toBe('TOKEN');
    expect(JSON.parse(calls[0].init.body)).toEqual({ online: true });
    await expect(api.get('/a')).rejects.toMatchObject({ status: 403, message: 'You cannot go online until verification is complete.' });
    await expect(api.get('/b')).rejects.toBeInstanceOf(ApiError);
    expect(unauthorized).toBe(1);
  });

  test('network failure becomes a readable error', async () => {
    const api = createApi({ base: 'https://h', fetchImpl: async () => { throw new TypeError('Network request failed'); } });
    await expect(api.get('/x')).rejects.toMatchObject({ status: 0, message: expect.stringMatching(/connection/) });
  });
});

describe('API base', () => {
  const { resolveApiBase, PRODUCTION_API_BASE } = require('../src/config');
  test('defaults to production; accepts only an https origin override', () => {
    expect(resolveApiBase(undefined)).toBe(PRODUCTION_API_BASE);
    expect(resolveApiBase('https://staging.harveytaxiservice.com/')).toBe('https://staging.harveytaxiservice.com');
    expect(resolveApiBase('http://staging.example.com')).toBe(PRODUCTION_API_BASE);
    expect(resolveApiBase('https://evil.example.com/path')).toBe(PRODUCTION_API_BASE);
    expect(resolveApiBase('javascript:alert(1)')).toBe(PRODUCTION_API_BASE);
  });
});

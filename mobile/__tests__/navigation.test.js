import {
  DASHBOARD_PATH,
  PAGE_STATE_SCRIPT,
  decideAndroidBack,
  parseShellMessage,
  resolveIncomingLink
} from '../src/navigation';

const DASH = `https://harveytaxiservice.com${DASHBOARD_PATH}`;

describe('incoming links', () => {
  test.each([
    ['harveytaxi://dashboard', DASH],
    ['harveytaxi://', DASH],
    ['harveytaxi://book', `${DASH}?screen=book&mode=driver`],
    ['harveytaxi://book?mode=airport', `${DASH}?screen=book&mode=airport`],
    ['harveytaxi://book?mode=<script>', `${DASH}?screen=book&mode=driver`],
    ['harveytaxi://ride/RIDE-123', `${DASH}?screen=track&ride_id=RIDE-123`],
    ['harveytaxi://track?ride_id=RIDE_9', `${DASH}?screen=track&ride_id=RIDE_9`],
    ['harveytaxi://ride/..%2Fadmin', DASH],
    [
      'https://harveytaxiservice.com/rider-dashboard.html?screen=track&ride_id=R1',
      `${DASH}?screen=track&ride_id=R1`
    ],
    ['https://www.harveytaxiservice.com/support.html', 'https://harveytaxiservice.com/support.html']
  ])('%s -> %s', (input, expected) => {
    expect(resolveIncomingLink(input)).toBe(expected);
  });

  test.each([
    'https://evil.example/rider-dashboard.html',
    'https://harveytaxiservice.com.evil.example/',
    'https://harveytaxiservice.com:8443/',
    'http://harveytaxiservice.com/',
    'javascript:alert(1)',
    'harveytaxi://admin',
    'otherapp://ride/1',
    '',
    null
  ])('rejects %s', (input) => {
    expect(resolveIncomingLink(input)).toBeNull();
  });
});

describe('Android Back decision', () => {
  test('booking or tracking open: back to the dashboard', () => {
    expect(decideAndroidBack({ page: { path: DASHBOARD_PATH, wizardOpen: true }, canGoBack: true })).toBe('close-wizard');
    expect(decideAndroidBack({ page: { path: DASHBOARD_PATH, wizardOpen: true }, canGoBack: false })).toBe('close-wizard');
  });

  test('dashboard and home: leave the app, even with history behind them', () => {
    expect(decideAndroidBack({ page: { path: DASHBOARD_PATH, wizardOpen: false }, canGoBack: true })).toBe('exit');
    expect(decideAndroidBack({ page: { path: '/', wizardOpen: false }, canGoBack: true })).toBe('exit');
  });

  test('other site pages: previous page, or leave when there is none', () => {
    expect(decideAndroidBack({ page: { path: '/support.html', wizardOpen: false }, canGoBack: true })).toBe('go-back');
    expect(decideAndroidBack({ page: { path: '/support.html', wizardOpen: false }, canGoBack: false })).toBe('exit');
    expect(decideAndroidBack({ page: null, canGoBack: true })).toBe('go-back');
  });
});

describe('page messages', () => {
  test('accepts only well-formed shell messages', () => {
    expect(parseShellMessage(JSON.stringify({ source: 'harvey-shell', type: 'page', path: '/x', wizardOpen: true }))).toEqual({
      type: 'page',
      path: '/x',
      wizardOpen: true
    });
    expect(parseShellMessage(JSON.stringify({ source: 'harvey-shell', type: 'launch', result: 'redirect' }))).toEqual({
      type: 'launch',
      result: 'redirect'
    });
    expect(parseShellMessage(JSON.stringify({ source: 'harvey-shell', type: 'launch', result: 'weird' })).result).toBe('stay');
    expect(parseShellMessage(JSON.stringify({ type: 'page', path: '/x' }))).toBeNull();
    expect(parseShellMessage('{not json')).toBeNull();
    expect(parseShellMessage(JSON.stringify({ source: 'harvey-shell', type: 'eval', code: 'x' }))).toBeNull();
  });

  test('the page script sends no cookies or tokens and only redirects to the dashboard', () => {
    expect(PAGE_STATE_SCRIPT).not.toMatch(/document\.cookie|localStorage/);
    expect(PAGE_STATE_SCRIPT).toContain("location.replace('/rider-dashboard.html')");
    expect(PAGE_STATE_SCRIPT).toContain("fetch('/api/rider/session'");
  });
});

describe('isDriverOperationsUrl', () => {
  const { isDriverOperationsUrl } = require('../src/navigation');
  test.each([
    ['https://harveytaxiservice.com/driver-dashboard.html', true],
    ['https://www.harveytaxiservice.com/Driver-Dashboard.html', true],
    ['https://harveytaxiservice.com/driver-dashboard', true],
    ['https://harveytaxiservice.com/driver.html', true],
    ['https://harveytaxiservice.com/driver-wallet.html', true],
    ['https://harveytaxiservice.com/driver-signup.html', false],
    ['https://harveytaxiservice.com/settings.html?account=driver#account-deletion', false],
    ['https://harveytaxiservice.com/rider-dashboard.html', false],
    ['https://evil.example/driver-dashboard.html', false],
    ['http://harveytaxiservice.com/driver-dashboard.html', false],
    ['not a url', false]
  ])('%s -> %s', (url, expected) => {
    expect(isDriverOperationsUrl(url)).toBe(expected);
  });
});

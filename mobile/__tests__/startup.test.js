import {
  ERROR_KIND,
  MAX_AUTO_RELOADS,
  PHASE,
  classifyLoadError,
  describeForLog,
  initialState,
  isIgnorableLoadError,
  navigationDecision,
  shouldAutoRetryOnForeground,
  startupReducer
} from '../src/startup';

const run = (...actions) => actions.reduce(startupReducer, initialState);

describe('startupReducer', () => {
  test('starts in loading, never in a blank state', () => {
    expect(initialState.phase).toBe(PHASE.LOADING);
  });

  test('a successful load shows the site', () => {
    expect(run({ type: 'LOADED' }).phase).toBe(PHASE.READY);
  });

  test('timeout during loading shows the timeout error', () => {
    expect(run({ type: 'TIMEOUT' })).toMatchObject({ phase: PHASE.ERROR, errorKind: ERROR_KIND.TIMEOUT });
  });

  test('a late timeout after the site loaded is ignored', () => {
    expect(run({ type: 'LOADED' }, { type: 'TIMEOUT' }).phase).toBe(PHASE.READY);
  });

  test('an HTTP error on the first page is an error even though the page then "loads"', () => {
    const state = run({ type: 'HTTP_ERROR', statusCode: 503 }, { type: 'LOADED' });
    expect(state).toMatchObject({ phase: PHASE.ERROR, errorKind: ERROR_KIND.SERVER });
  });

  test("HTTP errors after startup belong to the site's own pages", () => {
    expect(run({ type: 'LOADED' }, { type: 'HTTP_ERROR', statusCode: 404 }).phase).toBe(PHASE.READY);
  });

  test('a load error shows the classified error at any time', () => {
    expect(run({ type: 'LOADED' }, { type: 'LOAD_ERROR', kind: ERROR_KIND.OFFLINE })).toMatchObject({
      phase: PHASE.ERROR,
      errorKind: ERROR_KIND.OFFLINE
    });
  });

  test('retry goes back to loading with a new attempt', () => {
    const state = run({ type: 'TIMEOUT' }, { type: 'RETRY' });
    expect(state).toMatchObject({ phase: PHASE.LOADING, errorKind: null, attempt: 1, slow: false });
  });

  test('slow hint only while loading', () => {
    expect(run({ type: 'SLOW' }).slow).toBe(true);
    expect(run({ type: 'LOADED' }, { type: 'SLOW' }).slow).toBe(false);
  });

  test('content process termination reloads automatically, then asks the user', () => {
    let state = run({ type: 'LOADED' });
    for (let i = 0; i < MAX_AUTO_RELOADS; i += 1) {
      state = startupReducer(state, { type: 'PROCESS_TERMINATED' });
      expect(state.phase).toBe(PHASE.LOADING);
    }
    state = startupReducer(state, { type: 'PROCESS_TERMINATED' });
    expect(state).toMatchObject({ phase: PHASE.ERROR, errorKind: ERROR_KIND.CRASHED });
  });

  test('a successful load resets the automatic reload budget', () => {
    const state = run({ type: 'PROCESS_TERMINATED' }, { type: 'LOADED' });
    expect(state.autoReloads).toBe(0);
  });

  test('a manual retry resets the automatic reload budget; an automatic one does not', () => {
    const terminated = run({ type: 'PROCESS_TERMINATED' });
    expect(startupReducer(terminated, { type: 'RETRY' }).autoReloads).toBe(0);
    expect(startupReducer(terminated, { type: 'RETRY', automatic: true }).autoReloads).toBe(1);
  });
});

describe('classifyLoadError', () => {
  test.each([
    [-1009, ERROR_KIND.OFFLINE],
    [-1020, ERROR_KIND.OFFLINE],
    [-1001, ERROR_KIND.TIMEOUT],
    [-1003, ERROR_KIND.UNREACHABLE],
    [-1004, ERROR_KIND.UNREACHABLE],
    [-1200, ERROR_KIND.SECURE_CONNECTION],
    [-1202, ERROR_KIND.SECURE_CONNECTION],
    [-1022, ERROR_KIND.SECURE_CONNECTION],
    [-2, ERROR_KIND.UNREACHABLE],
    [-11, ERROR_KIND.SECURE_CONNECTION],
    [12345, ERROR_KIND.GENERIC],
    [undefined, ERROR_KIND.GENERIC]
  ])('code %s -> %s', (code, kind) => {
    expect(classifyLoadError({ code })).toBe(kind);
  });
});

describe('isIgnorableLoadError', () => {
  test('cancelled navigations and handed-off frame loads are not failures', () => {
    expect(isIgnorableLoadError({ domain: 'NSURLErrorDomain', code: -999 })).toBe(true);
    expect(isIgnorableLoadError({ domain: 'WebKitErrorDomain', code: 102 })).toBe(true);
  });

  test('real failures are not ignored', () => {
    expect(isIgnorableLoadError({ domain: 'NSURLErrorDomain', code: -1009 })).toBe(false);
    expect(isIgnorableLoadError({ domain: 'NSURLErrorDomain', code: 102 })).toBe(false);
  });
});

describe('navigationDecision', () => {
  test.each([
    ['https://harveytaxiservice.com/', true, 'allow'],
    ['https://www.harveytaxiservice.com/rider-dashboard.html', true, 'allow'],
    ['https://checkout.stripe.com/pay/abc', true, 'allow'],
    ['about:blank', false, 'allow'],
    ['tel:+16155550100', true, 'external'],
    ['mailto:support@example.com', true, 'external'],
    ['sms:+16155550100', true, 'external'],
    ['http://harveytaxiservice.com/', true, 'external'],
    ['http://tracker.example/', false, 'block'],
    ['tel:+16155550100', false, 'block'],
    ['javascript:alert(1)', true, 'block'],
    ['file:///etc/passwd', true, 'block'],
    ['data:text/html,<p>x</p>', true, 'block'],
    ['customscheme://open', true, 'block'],
    ['not a url', true, 'block']
  ])('%s (top frame: %s) -> %s', (url, isTopFrame, decision) => {
    expect(navigationDecision(url, { isTopFrame })).toBe(decision);
  });
});

describe('shouldAutoRetryOnForeground', () => {
  test('connection problems retry when the app returns', () => {
    expect(shouldAutoRetryOnForeground(run({ type: 'LOAD_ERROR', kind: ERROR_KIND.OFFLINE }))).toBe(true);
    expect(shouldAutoRetryOnForeground(run({ type: 'TIMEOUT' }))).toBe(true);
  });

  test('server and security errors wait for the user', () => {
    expect(shouldAutoRetryOnForeground(run({ type: 'HTTP_ERROR', statusCode: 500 }))).toBe(false);
    expect(shouldAutoRetryOnForeground(run({ type: 'LOAD_ERROR', kind: ERROR_KIND.SECURE_CONNECTION }))).toBe(false);
    expect(shouldAutoRetryOnForeground(run({ type: 'LOADED' }))).toBe(false);
  });
});

describe('describeForLog', () => {
  test('carries only the event name and a numeric code', () => {
    expect(describeForLog('load_error', -1009)).toBe('[startup] load_error code=-1009');
    expect(describeForLog('timeout')).toBe('[startup] timeout');
    expect(describeForLog('http_error', 'https://x.test/?token=secret')).toBe('[startup] http_error');
  });
});

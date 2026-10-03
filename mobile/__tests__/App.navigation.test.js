import React from 'react';
import { AppState, BackHandler, Linking, Platform } from 'react-native';
import { act, create } from 'react-test-renderer';

import App from '../App';
import { CLOSE_WIZARD_SCRIPT, LAUNCH_CHECK_TIMEOUT_MS } from '../src/navigation';
import { START_URL } from '../src/startup';

jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);

const mockWebViews = [];
const mockInjected = [];
const mockGoBack = jest.fn();
jest.mock('react-native-webview', () => {
  const React = require('react');
  const { View } = require('react-native');
  const WebView = React.forwardRef((props, ref) => {
    React.useImperativeHandle(ref, () => ({
      injectJavaScript: (code) => mockInjected.push(code),
      goBack: () => mockGoBack()
    }));
    mockWebViews.push(props);
    return React.createElement(View, { testID: props.testID });
  });
  return { WebView };
});

const latest = () => mockWebViews[mockWebViews.length - 1];
const has = (tree, id) => tree.root.findAll((n) => n.props.testID === id && typeof n.type === 'string').length > 0;

let backListener;
let urlListener;
let initialUrl;

function send(message) {
  act(() => {
    latest().onMessage({ nativeEvent: { data: JSON.stringify({ source: 'harvey-shell', ...message }) } });
  });
}
function load(url = START_URL) {
  act(() => latest().onLoad({ nativeEvent: { url } }));
}
function pressBack() {
  let handled;
  act(() => {
    handled = backListener();
  });
  return handled;
}
async function render() {
  let tree;
  await act(async () => {
    tree = create(<App />);
  });
  return tree;
}

beforeEach(() => {
  jest.useFakeTimers();
  mockWebViews.length = 0;
  mockInjected.length = 0;
  mockGoBack.mockReset();
  initialUrl = null;
  Platform.OS = 'android';
  jest.spyOn(AppState, 'addEventListener').mockImplementation(() => ({ remove: jest.fn() }));
  jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_type, listener) => {
    backListener = listener;
    return { remove: jest.fn() };
  });
  jest.spyOn(Linking, 'getInitialURL').mockImplementation(() => Promise.resolve(initialUrl));
  jest.spyOn(Linking, 'addEventListener').mockImplementation((_type, listener) => {
    urlListener = listener;
    return { remove: jest.fn() };
  });
  jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('launch', () => {
  test('signed-in rider: the loading screen stays until the dashboard has loaded (no home-page flash)', async () => {
    const tree = await render();
    load();
    expect(has(tree, 'startup-loading')).toBe(true);
    send({ type: 'launch', result: 'redirect' });
    expect(has(tree, 'startup-loading')).toBe(true);
    load('https://harveytaxiservice.com/rider-dashboard.html');
    expect(has(tree, 'startup-loading')).toBe(false);
  });

  test('signed-out visitor: the home page is shown', async () => {
    const tree = await render();
    load();
    send({ type: 'launch', result: 'stay' });
    expect(has(tree, 'startup-loading')).toBe(false);
  });

  test('no answer from the launch check: the page is shown after a short wait', async () => {
    const tree = await render();
    load();
    act(() => jest.advanceTimersByTime(LAUNCH_CHECK_TIMEOUT_MS));
    expect(has(tree, 'startup-loading')).toBe(false);
  });

  test('a tracking link that opened the app is kept exactly', async () => {
    initialUrl = 'harveytaxi://ride/RIDE-42';
    await render();
    expect(latest().source).toEqual({ uri: 'https://harveytaxiservice.com/rider-dashboard.html?screen=track&ride_id=RIDE-42' });
  });

  test('a booking link that opened the app is kept exactly', async () => {
    initialUrl = 'https://harveytaxiservice.com/rider-dashboard.html?screen=book&mode=airport';
    await render();
    expect(latest().source).toEqual({ uri: 'https://harveytaxiservice.com/rider-dashboard.html?screen=book&mode=airport' });
  });

  test('a link arriving while the app is open navigates the loaded page', async () => {
    await render();
    load();
    send({ type: 'launch', result: 'stay' });
    act(() => urlListener({ url: 'harveytaxi://ride/RIDE-7' }));
    expect(mockInjected.pop()).toContain('rider-dashboard.html?screen=track&ride_id=RIDE-7');
  });

  test('foreign links are ignored', async () => {
    await render();
    load();
    send({ type: 'launch', result: 'stay' });
    act(() => urlListener({ url: 'https://evil.example/phish' }));
    expect(mockInjected).toHaveLength(0);
  });
});

describe('Android Back', () => {
  async function ready() {
    const tree = await render();
    load();
    send({ type: 'launch', result: 'stay' });
    return tree;
  }

  test('booking/tracking screen -> dashboard via the page\'s own Back to Dashboard', async () => {
    await ready();
    send({ type: 'page', path: '/rider-dashboard.html', wizardOpen: true });
    expect(pressBack()).toBe(true);
    expect(mockInjected).toEqual([CLOSE_WIZARD_SCRIPT]);
    expect(mockGoBack).not.toHaveBeenCalled();
  });

  test('dashboard -> leaves the app (system default), even with history', async () => {
    await ready();
    act(() => latest().onNavigationStateChange({ canGoBack: true }));
    send({ type: 'page', path: '/rider-dashboard.html', wizardOpen: false });
    expect(pressBack()).toBe(false);
    expect(mockGoBack).not.toHaveBeenCalled();
  });

  test('another site page -> previous page', async () => {
    await ready();
    act(() => latest().onNavigationStateChange({ canGoBack: true }));
    send({ type: 'page', path: '/support.html', wizardOpen: false });
    expect(pressBack()).toBe(true);
    expect(mockGoBack).toHaveBeenCalledTimes(1);
  });

  test('while loading or on the error screen Back is left to the system', async () => {
    const tree = await render();
    expect(pressBack()).toBe(false);
    act(() => latest().onError({ nativeEvent: { code: -1009 }, preventDefault() {} }));
    expect(has(tree, 'startup-error')).toBe(true);
    expect(pressBack()).toBe(false);
  });
});

describe('rider and driver apps are separate', () => {
  async function ready() {
    const tree = await render();
    load();
    send({ type: 'launch', result: 'stay' });
    return tree;
  }
  const start = (url) => {
    let allowed;
    act(() => {
      allowed = latest().onShouldStartLoadWithRequest({ url, isTopFrame: true });
    });
    return allowed;
  };

  test.each([
    'https://harveytaxiservice.com/driver-dashboard.html',
    'https://www.harveytaxiservice.com/driver-dashboard.html?tab=earnings',
    'https://harveytaxiservice.com/driver.html',
    'https://harveytaxiservice.com/driver-wallet.html'
  ])('%s never loads here; the Harvey Taxi Driver hand-off shows instead', async (url) => {
    const tree = await ready();
    expect(start(url)).toBe(false);
    expect(has(tree, 'driver-app-handoff')).toBe(true);
  });

  test('driver sign-up and driver account deletion stay in this app', async () => {
    const tree = await ready();
    expect(start('https://harveytaxiservice.com/driver-signup.html')).toBe(true);
    expect(start('https://harveytaxiservice.com/settings.html?account=driver#account-deletion')).toBe(true);
    expect(has(tree, 'driver-app-handoff')).toBe(false);
  });

  test('a driver dashboard link that opens the app shows the hand-off, not the page', async () => {
    initialUrl = 'https://harveytaxiservice.com/driver-dashboard.html';
    const tree = await render();
    expect(latest().source).toEqual({ uri: START_URL });
    expect(has(tree, 'driver-app-handoff')).toBe(true);
  });

  test('hand-off: opens the driver app, or its store page when it is not installed', async () => {
    const tree = await ready();
    start('https://harveytaxiservice.com/driver-dashboard.html');
    Linking.openURL.mockRejectedValueOnce(new Error('not installed'));
    await act(async () => {
      tree.root.findAll((n) => n.props.testID === 'handoff-open-driver-app' && n.props.onPress)[0].props.onPress();
    });
    expect(Linking.openURL).toHaveBeenNthCalledWith(1, 'harveytaxidriver://');
    expect(Linking.openURL).toHaveBeenNthCalledWith(2, 'https://play.google.com/store/apps/details?id=com.harveytaxi.driver');
  });

  test('hand-off: "Delete a driver account" opens the deletion page here; Back closes it', async () => {
    const tree = await ready();
    start('https://harveytaxiservice.com/driver-dashboard.html');
    act(() => {
      tree.root.findAll((n) => n.props.testID === 'handoff-delete-driver' && n.props.onPress)[0].props.onPress();
    });
    expect(has(tree, 'driver-app-handoff')).toBe(false);
    expect(mockInjected.pop()).toContain('settings.html?account=driver#account-deletion');
    start('https://harveytaxiservice.com/driver.html');
    act(() => {
      tree.root.findAll((n) => n.props.testID === 'handoff-back' && n.props.onPress)[0].props.onPress();
    });
    expect(has(tree, 'driver-app-handoff')).toBe(false);
  });
});

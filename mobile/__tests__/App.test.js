import React from 'react';
import { AppState, Linking } from 'react-native';
import { act, create } from 'react-test-renderer';

import App from '../App';
import { LOAD_TIMEOUT_MS, SLOW_HINT_MS, START_URL } from '../src/startup';

jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);

// Stand-in for the native WebView: records the props of every instance so
// tests can fire the same events WKWebView would.
const mockWebViews = [];
jest.mock('react-native-webview', () => {
  const React = require('react');
  const { View } = require('react-native');
  function WebView(props) {
    mockWebViews.push(props);
    return React.createElement(View, { testID: props.testID });
  }
  return { WebView };
});

const latest = () => mockWebViews[mockWebViews.length - 1];
const byTestId = (tree, id) => tree.root.findAll((n) => n.props.testID === id && typeof n.type === 'string');
const has = (tree, id) => byTestId(tree, id).length > 0;
const textOf = (tree) =>
  tree.root
    .findAll((n) => typeof n.props.children === 'string')
    .map((n) => n.props.children)
    .join(' | ');

function fire(name, nativeEvent = {}) {
  let prevented = false;
  const event = { nativeEvent, preventDefault: () => { prevented = true; } };
  let result;
  act(() => {
    result = latest()[name](event);
  });
  return { prevented, result };
}

let appStateListener;
let warnSpy;

beforeEach(() => {
  jest.useFakeTimers();
  mockWebViews.length = 0;
  appStateListener = null;
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
    appStateListener = listener;
    return { remove: jest.fn() };
  });
  jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
  warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

function render() {
  let tree;
  act(() => {
    tree = create(<App />);
  });
  return tree;
}

test('cold launch shows the branded loading screen over the WebView, loading the production URL', () => {
  const tree = render();
  expect(has(tree, 'startup-loading')).toBe(true);
  expect(has(tree, 'harvey-webview')).toBe(true);
  expect(textOf(tree)).toContain('Harvey Taxi');
  expect(latest().source).toEqual({ uri: START_URL });
});

test('successful load removes the loading screen', () => {
  const tree = render();
  fire('onLoad', { url: START_URL });
  expect(has(tree, 'startup-loading')).toBe(false);
  expect(has(tree, 'startup-error')).toBe(false);
});

test('slow connection: hint after the slow threshold, error with Retry at the timeout', () => {
  const tree = render();
  act(() => jest.advanceTimersByTime(SLOW_HINT_MS));
  expect(textOf(tree)).toContain('Still connecting');
  act(() => jest.advanceTimersByTime(LOAD_TIMEOUT_MS - SLOW_HINT_MS));
  expect(has(tree, 'startup-error')).toBe(true);
  expect(textOf(tree)).toContain('taking too long');
  expect(has(tree, 'startup-retry')).toBe(true);
});

test('offline: readable message, the library default error view is suppressed, and Retry reloads', () => {
  const tree = render();
  const { prevented } = fire('onError', { domain: 'NSURLErrorDomain', code: -1009, url: START_URL, description: 'offline' });
  expect(prevented).toBe(true);
  expect(textOf(tree)).toContain("You're offline");

  const before = mockWebViews.length;
  const retryButton = tree.root.find((n) => n.props.testID === 'startup-retry' && typeof n.props.onPress === 'function');
  act(() => retryButton.props.onPress());
  expect(has(tree, 'startup-loading')).toBe(true);
  expect(mockWebViews.length).toBeGreaterThan(before);

  fire('onLoad', { url: START_URL });
  expect(has(tree, 'startup-error')).toBe(false);
  expect(has(tree, 'startup-loading')).toBe(false);
});

test('a cancelled navigation (-999) does not show an error', () => {
  const tree = render();
  fire('onError', { domain: 'NSURLErrorDomain', code: -999 });
  expect(has(tree, 'startup-error')).toBe(false);
  expect(has(tree, 'startup-loading')).toBe(true);
});

test('HTTP 503 on the first page shows the service-unavailable screen', () => {
  const tree = render();
  fire('onHttpError', { statusCode: 503, url: START_URL });
  fire('onLoad', { url: START_URL });
  expect(textOf(tree)).toContain('temporarily unavailable');
});

test('TLS failure shows the secure-connection message (no insecure fallback)', () => {
  const tree = render();
  fire('onError', { domain: 'NSURLErrorDomain', code: -1202 });
  expect(textOf(tree)).toContain('Secure connection failed');
});

test('web content process termination reloads automatically instead of leaving a blank view', () => {
  const tree = render();
  fire('onLoad', { url: START_URL });
  const before = mockWebViews.length;
  fire('onContentProcessDidTerminate');
  expect(has(tree, 'startup-loading')).toBe(true);
  expect(mockWebViews.length).toBeGreaterThan(before);
});

test('Android render process loss is reported as handled', () => {
  render();
  expect(fire('onRenderProcessGone', { didCrash: true }).result).toBe(true);
});

test('returning to the foreground after an offline error retries on its own', () => {
  const tree = render();
  fire('onError', { code: -1009 });
  expect(has(tree, 'startup-error')).toBe(true);
  act(() => appStateListener('background'));
  act(() => appStateListener('active'));
  expect(has(tree, 'startup-loading')).toBe(true);
});

test('backgrounding and reopening a loaded app keeps the site showing', () => {
  const tree = render();
  fire('onLoad', { url: START_URL });
  act(() => appStateListener('background'));
  act(() => jest.advanceTimersByTime(LOAD_TIMEOUT_MS * 2));
  act(() => appStateListener('active'));
  expect(has(tree, 'startup-loading')).toBe(false);
  expect(has(tree, 'startup-error')).toBe(false);
});

test('navigation policy: HTTPS in-app, phone links to the OS, scripts blocked', () => {
  render();
  const decide = latest().onShouldStartLoadWithRequest;
  expect(decide({ url: 'https://harveytaxiservice.com/rider-dashboard.html', isTopFrame: true })).toBe(true);
  expect(decide({ url: 'tel:+16155550100', isTopFrame: true })).toBe(false);
  expect(Linking.openURL).toHaveBeenCalledWith('tel:+16155550100');
  expect(decide({ url: 'javascript:alert(1)', isTopFrame: true })).toBe(false);
});

test('logs never contain URLs or error descriptions', () => {
  render();
  fire('onError', { code: -1009, url: 'https://harveytaxiservice.com/reset?token=abc123', description: 'secret detail' });
  fire('onHttpError', { statusCode: 500, url: 'https://harveytaxiservice.com/?session=xyz' });
  const logged = JSON.stringify(warnSpy.mock.calls);
  expect(logged).not.toMatch(/https?:|token|session|secret detail/);
});

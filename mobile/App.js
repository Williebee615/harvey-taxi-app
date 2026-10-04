import React, { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { AppState, BackHandler, Linking, Platform, StatusBar, StyleSheet, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';

import {
  LOAD_TIMEOUT_MS,
  PHASE,
  SLOW_HINT_MS,
  START_URL,
  classifyLoadError,
  describeForLog,
  initialState,
  isIgnorableLoadError,
  navigationDecision,
  shouldAutoRetryOnForeground,
  startupReducer
} from './src/startup';
import { COLORS, DriverAppHandoffScreen, ErrorScreen, LoadingScreen } from './src/StartupScreens';
import {
  CLOSE_WIZARD_SCRIPT,
  DRIVER_APP_SCHEME_URL,
  DRIVER_APP_STORE_URLS,
  DRIVER_DELETION_URL,
  isDriverOperationsUrl,
  LAUNCH_CHECK_TIMEOUT_MS,
  PAGE_STATE_SCRIPT,
  decideAndroidBack,
  parseShellMessage,
  resolveIncomingLink,
  riderAppUserAgentTag
} from './src/navigation';
import appConfig from './app.json';

const USER_AGENT_TAG = riderAppUserAgentTag(Platform.OS, appConfig.expo.version);

// Launch check (see src/navigation.js): 'pending' until the home page
// reports whether a signed-in rider is being sent to the dashboard,
// 'redirecting' while that page loads, then 'done'. The loading screen
// stays up until it is done, so a signed-in rider never sees the home
// page flash before the dashboard.
const LAUNCH = Object.freeze({ PENDING: 'pending', REDIRECTING: 'redirecting', DONE: 'done' });
const REDIRECT_TIMEOUT_MS = 15000;

export function HarveyTaxiShell() {
  const [state, dispatch] = useReducer(startupReducer, initialState);
  const stateRef = useRef(state);
  stateRef.current = state;
  const [sourceUrl, setSourceUrl] = useState(START_URL);
  const [launch, setLaunch] = useState(LAUNCH.PENDING);
  const launchRef = useRef(launch);
  launchRef.current = launch;
  const webViewRef = useRef(null);
  const pageRef = useRef(null);
  const canGoBackRef = useRef(false);
  const [driverHandoff, setDriverHandoff] = useState(false);

  // Opens a link (cold start or while running) in the WebView. An explicit
  // booking/tracking/dashboard link always wins over the launch redirect.
  const openLink = useCallback((rawUrl) => {
    if (isDriverOperationsUrl(rawUrl)) {
      setLaunch(LAUNCH.DONE);
      setDriverHandoff(true);
      return;
    }
    const target = resolveIncomingLink(rawUrl);
    if (!target) return;
    setLaunch(LAUNCH.DONE);
    if (stateRef.current.phase === PHASE.READY && webViewRef.current) {
      webViewRef.current.injectJavaScript(`window.location.assign(${JSON.stringify(target)}); true;`);
    } else {
      setSourceUrl(target);
    }
  }, []);

  useEffect(() => {
    let active = true;
    Linking.getInitialURL()
      .then((url) => {
        if (active && url) openLink(url);
      })
      .catch(() => {});
    const subscription = Linking.addEventListener('url', ({ url }) => openLink(url));
    return () => {
      active = false;
      subscription?.remove?.();
    };
  }, [openLink]);

  // Never hold the loading screen on the launch check for long: if the
  // site doesn't answer, show whatever page loaded.
  useEffect(() => {
    if (launch === LAUNCH.DONE || state.phase !== PHASE.READY) return undefined;
    const timer = setTimeout(
      () => setLaunch(LAUNCH.DONE),
      launch === LAUNCH.REDIRECTING ? REDIRECT_TIMEOUT_MS : LAUNCH_CHECK_TIMEOUT_MS
    );
    return () => clearTimeout(timer);
  }, [launch, state.phase]);

  // Android Back (hardware button or gesture). iOS has no Back button;
  // there the WebView's edge-swipe gesture walks the same history.
  useEffect(() => {
    if (Platform.OS !== 'android') return undefined;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (stateRef.current.phase !== PHASE.READY || !webViewRef.current) return false;
      const decision = decideAndroidBack({ page: pageRef.current, canGoBack: canGoBackRef.current });
      if (decision === 'close-wizard') {
        webViewRef.current.injectJavaScript(CLOSE_WIZARD_SCRIPT);
        return true;
      }
      if (decision === 'go-back') {
        webViewRef.current.goBack();
        return true;
      }
      // Dashboard, home page, or nothing behind: the system default
      // (leave the app), as at the top level of any Android app.
      return false;
    });
    return () => subscription.remove();
  }, []);

  const onMessage = useCallback((event) => {
    const message = parseShellMessage(event?.nativeEvent?.data);
    if (!message) return;
    if (message.type === 'page') {
      pageRef.current = message;
      return;
    }
    if (message.type === 'launch' && launchRef.current === LAUNCH.PENDING) {
      setLaunch(message.result === 'redirect' ? LAUNCH.REDIRECTING : LAUNCH.DONE);
    }
  }, []);

  const onNavigationStateChange = useCallback((navState) => {
    canGoBackRef.current = Boolean(navState?.canGoBack);
  }, []);

  // Loading timers belong to one attempt: a retry starts a fresh timeout,
  // and reaching READY or ERROR cancels it.
  useEffect(() => {
    if (state.phase !== PHASE.LOADING) return undefined;
    const slowTimer = setTimeout(() => dispatch({ type: 'SLOW' }), SLOW_HINT_MS);
    const timeoutTimer = setTimeout(() => {
      console.warn(describeForLog('timeout'));
      dispatch({ type: 'TIMEOUT' });
    }, LOAD_TIMEOUT_MS);
    return () => {
      clearTimeout(slowTimer);
      clearTimeout(timeoutTimer);
    };
  }, [state.phase, state.attempt]);

  // Returning to the foreground after a connection problem retries on its
  // own; the network has often recovered in the meantime.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active' && shouldAutoRetryOnForeground(stateRef.current)) {
        dispatch({ type: 'RETRY', automatic: true });
      }
    });
    return () => subscription.remove();
  }, []);

  const retry = useCallback(() => dispatch({ type: 'RETRY' }), []);

  // Opens Harvey Taxi Driver if it is installed, otherwise its store page.
  const openDriverApp = useCallback(() => {
    const store = Platform.OS === 'ios' ? DRIVER_APP_STORE_URLS.ios : DRIVER_APP_STORE_URLS.android;
    Linking.openURL(DRIVER_APP_SCHEME_URL).catch(() => Linking.openURL(store).catch(() => {}));
  }, []);

  const onLoad = useCallback(() => {
    dispatch({ type: 'LOADED' });
    // The dashboard the launch check redirected to has loaded.
    if (launchRef.current === LAUNCH.REDIRECTING) setLaunch(LAUNCH.DONE);
  }, []);

  const onError = useCallback((event) => {
    const { nativeEvent } = event;
    // Stops react-native-webview drawing its own unstyled error view (which
    // also prints the failing URL) underneath ours.
    event.preventDefault?.();
    if (isIgnorableLoadError(nativeEvent)) return;
    console.warn(describeForLog('load_error', nativeEvent.code));
    dispatch({ type: 'LOAD_ERROR', kind: classifyLoadError(nativeEvent) });
  }, []);

  const onHttpError = useCallback((event) => {
    const { statusCode } = event.nativeEvent;
    console.warn(describeForLog('http_error', statusCode));
    dispatch({ type: 'HTTP_ERROR', statusCode });
  }, []);

  const onProcessGone = useCallback(() => {
    console.warn(describeForLog('content_process_terminated'));
    dispatch({ type: 'PROCESS_TERMINATED' });
    // Android: returning true tells the WebView the app handled it, so the
    // whole app is not killed.
    return true;
  }, []);

  const onShouldStartLoadWithRequest = useCallback((request) => {
    // Driving operations belong to Harvey Taxi Driver: never load them here.
    if (isDriverOperationsUrl(request.url)) {
      setDriverHandoff(true);
      return false;
    }
    const decision = navigationDecision(request.url, { isTopFrame: request.isTopFrame !== false });
    if (decision === 'external') {
      Linking.openURL(request.url).catch(() => {});
    }
    return decision === 'allow';
  }, []);

  return (
    <SafeAreaView style={styles.root} edges={['top', 'right', 'bottom', 'left']}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.background} />
      <View style={styles.content}>
        <WebView
          key={state.attempt}
          ref={webViewRef}
          testID="harvey-webview"
          source={{ uri: sourceUrl }}
          injectedJavaScript={PAGE_STATE_SCRIPT}
          onMessage={onMessage}
          onNavigationStateChange={onNavigationStateChange}
          style={styles.webview}
          containerStyle={styles.webviewContainer}
          originWhitelist={['*']}
          onShouldStartLoadWithRequest={onShouldStartLoadWithRequest}
          onLoad={onLoad}
          onError={onError}
          onHttpError={onHttpError}
          onContentProcessDidTerminate={onProcessGone}
          onRenderProcessGone={onProcessGone}
          javaScriptEnabled
          applicationNameForUserAgent={USER_AGENT_TAG}
          // Location for the pickup point and, if the rider turns it on,
          // sharing with the driver until pickup (docs/live-map-tracking.md).
          // The page asks; Android's permission prompt comes from the WebView.
          geolocationEnabled
          domStorageEnabled
          sharedCookiesEnabled
          allowsBackForwardNavigationGestures
          allowsInlineMediaPlayback
          pullToRefreshEnabled
          setSupportMultipleWindows={false}
          automaticallyAdjustContentInsets={false}
          contentInsetAdjustmentBehavior="never"
        />
        {(state.phase === PHASE.LOADING || (state.phase === PHASE.READY && launch !== LAUNCH.DONE)) && (
          <LoadingScreen slow={state.slow} />
        )}
        {state.phase === PHASE.ERROR && <ErrorScreen kind={state.errorKind} onRetry={retry} />}
        {driverHandoff && (
          <DriverAppHandoffScreen
            onOpenDriverApp={openDriverApp}
            onDeleteDriverAccount={() => {
              setDriverHandoff(false);
              openLink(DRIVER_DELETION_URL);
            }}
            onBack={() => setDriverHandoff(false)}
          />
        )}
      </View>
    </SafeAreaView>
  );
}

export default function App() {
  return (
    <SafeAreaProvider style={styles.provider}>
      <HarveyTaxiShell />
    </SafeAreaProvider>
  );
}

// Every layer uses the brand background, never plain black or white, so
// there is no uncoloured gap between the splash screen and first paint.
const styles = StyleSheet.create({
  provider: { flex: 1, backgroundColor: COLORS.background },
  root: { flex: 1, backgroundColor: COLORS.background },
  content: { flex: 1 },
  webviewContainer: { flex: 1, backgroundColor: COLORS.background },
  webview: { flex: 1, backgroundColor: COLORS.background }
});

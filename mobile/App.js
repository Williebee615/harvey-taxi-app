import React, { useCallback, useEffect, useReducer, useRef } from 'react';
import { AppState, Linking, StatusBar, StyleSheet, View } from 'react-native';
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
import { COLORS, ErrorScreen, LoadingScreen } from './src/StartupScreens';

export function HarveyTaxiShell() {
  const [state, dispatch] = useReducer(startupReducer, initialState);
  const stateRef = useRef(state);
  stateRef.current = state;

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

  const onLoad = useCallback(() => dispatch({ type: 'LOADED' }), []);

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
          testID="harvey-webview"
          source={{ uri: START_URL }}
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
          domStorageEnabled
          sharedCookiesEnabled
          allowsBackForwardNavigationGestures
          allowsInlineMediaPlayback
          pullToRefreshEnabled
          setSupportMultipleWindows={false}
          automaticallyAdjustContentInsets={false}
          contentInsetAdjustmentBehavior="never"
        />
        {state.phase === PHASE.LOADING && <LoadingScreen slow={state.slow} />}
        {state.phase === PHASE.ERROR && <ErrorScreen kind={state.errorKind} onRetry={retry} />}
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

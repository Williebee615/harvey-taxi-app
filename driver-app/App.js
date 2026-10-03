import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Pressable, StatusBar, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView, initialWindowMetrics } from 'react-native-safe-area-context';

import { useDriverApp } from './src/useDriverApp';
import { C } from './src/ui';
import SignInScreen from './src/screens/SignInScreen';
import HomeScreen from './src/screens/HomeScreen';
import EarningsScreen from './src/screens/EarningsScreen';
import TripsScreen from './src/screens/TripsScreen';
import AccountScreen from './src/screens/AccountScreen';
import AssistantScreen from './src/screens/AssistantScreen';

const CONTENT_MAX_WIDTH = 680;

const TABS = [
  { key: 'home', label: 'Drive', Screen: HomeScreen },
  { key: 'earnings', label: 'Earnings', Screen: EarningsScreen },
  { key: 'trips', label: 'Trips', Screen: TripsScreen },
  { key: 'account', label: 'Account', Screen: AccountScreen }
];

export function DriverApp() {
  const app = useDriverApp();
  const [tab, setTab] = useState('home');
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [assistantAvailable, setAssistantAvailable] = useState(false);
  const signedIn = app.phase !== 'booting' && app.phase !== 'signedOut';

  // Harvey Assistant appears only while the server has it switched on
  // (system flag agent_assist_enabled); checked at sign-in and whenever the
  // app comes back to the foreground.
  useEffect(() => {
    if (!signedIn) return undefined;
    let live = true;
    const check = () =>
      app.actions
        .assistantStatus()
        .then((res) => live && setAssistantAvailable(Boolean(res && res.assist_available)))
        .catch(() => live && setAssistantAvailable(false));
    check();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') check();
    });
    return () => {
      live = false;
      sub.remove();
    };
  }, [signedIn]);

  const offerIds = app.snapshot ? app.snapshot.offers.map((o) => o.offer_id).join(',') : '';
  const prevOfferIds = useRef(offerIds);
  useEffect(() => {
    const before = new Set(prevOfferIds.current.split(',').filter(Boolean));
    if (offerIds.split(',').some((id) => id && !before.has(id))) setAssistantOpen(false);
    prevOfferIds.current = offerIds;
  }, [offerIds]);

  if (app.phase === 'booting') {
    return (
      <View style={st.center}>
        <ActivityIndicator color={C.cyan} size="large" />
      </View>
    );
  }
  if (app.phase === 'signedOut') {
    return (
      <View style={st.column}>
        <SignInScreen app={app} />
      </View>
    );
  }

  // A new offer or an active trip always brings the driver back to Drive.
  // A newly arrived offer also closes the assistant so the offer card and
  // its countdown are on screen; the driver can reopen it on purpose.
  const urgent = app.snapshot && (app.snapshot.offers.length > 0 || app.snapshot.active_ride);
  const showAssistant = assistantOpen && assistantAvailable;
  const current = urgent ? 'home' : tab;
  const { Screen } = TABS.find((t) => t.key === current);
  const openTab = (key) => {
    setAssistantOpen(false);
    setTab(key);
  };

  return (
    <View style={{ flex: 1 }}>
      <View style={st.column}>
        {showAssistant ? (
          <AssistantScreen app={app} onClose={() => setAssistantOpen(false)} onOpenTab={openTab} />
        ) : (
          <Screen app={app} onOpenAssistant={assistantAvailable ? () => setAssistantOpen(true) : null} />
        )}
      </View>
      <View style={st.tabs}>
        <View style={st.tabRow} accessibilityRole="tablist">
          {TABS.map((t) => (
            <Pressable
              key={t.key}
              testID={`tab-${t.key}`}
              accessibilityRole="tab"
              accessibilityState={{ selected: !showAssistant && current === t.key }}
              onPress={() => openTab(t.key)}
              style={st.tab}
            >
              <Text style={[st.tabText, !showAssistant && current === t.key && { color: C.cyan }]}>{t.label}</Text>
            </Pressable>
          ))}
        </View>
      </View>
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics} style={{ flex: 1, backgroundColor: C.bg }}>
      <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={['top', 'left', 'right', 'bottom']}>
        <StatusBar barStyle="light-content" backgroundColor={C.bg} />
        <DriverApp />
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const st = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: C.bg },
  // On iPad the screens keep a phone-like reading width, centred, instead
  // of stretching cards and buttons across the whole display.
  column: { flex: 1, width: '100%', maxWidth: CONTENT_MAX_WIDTH, alignSelf: 'center' },
  tabs: { borderTopWidth: 1, borderTopColor: C.line, backgroundColor: C.panel },
  tabRow: { flexDirection: 'row', width: '100%', maxWidth: CONTENT_MAX_WIDTH, alignSelf: 'center' },
  tab: { flex: 1, minHeight: 56, alignItems: 'center', justifyContent: 'center' },
  tabText: { color: C.muted, fontWeight: '800', fontSize: 14 }
});

import React from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { ERROR_COPY, ERROR_KIND } from './startup';

export const COLORS = Object.freeze({
  background: '#050816',
  text: '#f4f7ff',
  muted: '#a9b4d0',
  accent: '#ffc400',
  accentText: '#1a1300'
});

const logo = require('../assets/logo.png');

export function LoadingScreen({ slow }) {
  return (
    <View style={styles.overlay} testID="startup-loading" accessibilityLiveRegion="polite">
      <View style={styles.card}>
        <Image source={logo} style={styles.logo} accessibilityIgnoresInvertColors />
        <Text style={styles.brand}>Harvey Taxi</Text>
        <ActivityIndicator size="large" color={COLORS.accent} style={styles.spinner} />
        <Text style={styles.message}>{slow ? 'Still connecting. This is taking longer than usual…' : 'Connecting…'}</Text>
      </View>
    </View>
  );
}

export function ErrorScreen({ kind, onRetry }) {
  const copy = ERROR_COPY[kind] || ERROR_COPY[ERROR_KIND.GENERIC];
  return (
    <View style={styles.overlay} testID="startup-error" accessibilityLiveRegion="assertive">
      <View style={styles.card}>
        <Image source={logo} style={styles.logoSmall} accessibilityIgnoresInvertColors />
        <Text style={styles.title} accessibilityRole="header">
          {copy.title}
        </Text>
        <Text style={styles.message}>{copy.message}</Text>
        <Pressable
          testID="startup-retry"
          accessibilityRole="button"
          accessibilityLabel="Try again"
          onPress={onRetry}
          style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
        >
          <Text style={styles.buttonText}>Try Again</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: COLORS.background,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24
  },
  // Caps the width so the content stays readable on a 13-inch iPad in
  // landscape as well as on a phone.
  card: {
    width: '100%',
    maxWidth: 440,
    alignItems: 'center'
  },
  logo: { width: 112, height: 112, borderRadius: 24, marginBottom: 16 },
  logoSmall: { width: 72, height: 72, borderRadius: 16, marginBottom: 20 },
  brand: { color: COLORS.text, fontSize: 26, fontWeight: '800', letterSpacing: 0.5 },
  spinner: { marginTop: 28, marginBottom: 16 },
  title: { color: COLORS.text, fontSize: 22, fontWeight: '800', textAlign: 'center', marginBottom: 12 },
  message: { color: COLORS.muted, fontSize: 16, lineHeight: 23, textAlign: 'center' },
  button: {
    marginTop: 28,
    minWidth: 200,
    minHeight: 48,
    paddingHorizontal: 28,
    borderRadius: 14,
    backgroundColor: COLORS.accent,
    alignItems: 'center',
    justifyContent: 'center'
  },
  buttonPressed: { opacity: 0.8 },
  buttonText: { color: COLORS.accentText, fontSize: 17, fontWeight: '800' }
});

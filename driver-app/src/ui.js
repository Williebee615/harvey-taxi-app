import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

export const C = Object.freeze({
  bg: '#050816',
  panel: '#0B1730',
  panel2: '#101F3D',
  line: 'rgba(122,162,255,0.22)',
  text: '#F4F7FF',
  muted: '#AAB8DE',
  cyan: '#63F5FF',
  blue: '#5EA0FF',
  green: '#6DFFB3',
  gold: '#FFD76A',
  danger: '#FF7E97',
  ink: '#07121F'
});

export function Card({ children, style, accent }) {
  return <View style={[s.card, accent && { borderColor: accent }, style]}>{children}</View>;
}

export function H({ children, style }) {
  return <Text style={[s.h, style]} accessibilityRole="header">{children}</Text>;
}

export function P({ children, style, muted }) {
  return <Text style={[s.p, muted && { color: C.muted }, style]}>{children}</Text>;
}

export function Button({ title, onPress, kind = 'primary', busy, disabled, testID, style }) {
  const off = disabled || busy;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(off), busy: Boolean(busy) }}
      onPress={off ? undefined : onPress}
      style={({ pressed }) => [s.btn, s[`btn_${kind}`], (pressed || off) && { opacity: 0.6 }, style]}
    >
      {busy ? <ActivityIndicator color={kind === 'primary' || kind === 'go' ? C.ink : C.text} /> : null}
      <Text style={[s.btnText, (kind === 'primary' || kind === 'go') && { color: C.ink }]}>{title}</Text>
    </Pressable>
  );
}

export function Pill({ text, tone = 'muted' }) {
  const color = { good: C.green, warn: C.gold, bad: C.danger, info: C.cyan, muted: C.muted }[tone] || C.muted;
  return (
    <View style={[s.pill, { borderColor: color }]}>
      <Text style={[s.pillText, { color }]}>{text}</Text>
    </View>
  );
}

export function Row({ label, value, valueStyle }) {
  return (
    <View style={s.row}>
      <Text style={s.rowLabel}>{label}</Text>
      <Text style={[s.rowValue, valueStyle]}>{value}</Text>
    </View>
  );
}

export function Notice({ text, onClose, tone = 'bad' }) {
  if (!text) return null;
  return (
    <Pressable onPress={onClose} accessibilityRole="alert" style={[s.notice, { borderColor: tone === 'bad' ? C.danger : C.cyan }]}>
      <Text style={[s.p, { color: tone === 'bad' ? '#FFC7D1' : C.cyan }]}>{text}</Text>
    </Pressable>
  );
}

export const money = (n) => (Number.isFinite(Number(n)) && n !== null ? `$${Number(n).toFixed(2)}` : '—');

const s = StyleSheet.create({
  card: { backgroundColor: C.panel, borderColor: C.line, borderWidth: 1, borderRadius: 18, padding: 16, marginBottom: 14 },
  h: { color: C.text, fontSize: 18, fontWeight: '800', marginBottom: 8 },
  p: { color: C.text, fontSize: 15, lineHeight: 21 },
  btn: { minHeight: 52, borderRadius: 14, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, marginTop: 10 },
  btn_primary: { backgroundColor: C.cyan },
  btn_go: { backgroundColor: C.green },
  btn_ghost: { backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: C.line },
  btn_danger: { backgroundColor: 'rgba(255,77,109,0.16)', borderWidth: 1, borderColor: 'rgba(255,77,109,0.5)' },
  btnText: { color: C.text, fontSize: 16, fontWeight: '800' },
  pill: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3, alignSelf: 'flex-start' },
  pillText: { fontSize: 12, fontWeight: '800' },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 6 },
  rowLabel: { color: C.muted, fontSize: 14, flexShrink: 0 },
  rowValue: { color: C.text, fontSize: 14, fontWeight: '700', flexShrink: 1, textAlign: 'right' },
  notice: { borderWidth: 1, borderRadius: 14, padding: 12, marginBottom: 12, backgroundColor: 'rgba(255,77,109,0.08)' }
});

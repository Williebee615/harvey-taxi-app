import React, { useEffect, useRef, useState } from 'react';
import { Alert, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import * as Speech from 'expo-speech';
import * as WebBrowser from 'expo-web-browser';

import { API_BASE, EMERGENCY_NUMBER, LINKS } from '../config';
import { GREETING, isHandsFree, planActions, QUICK_PROMPTS, sourceLabel, speakable, UNAVAILABLE_REPLY } from '../assistant';
import { directionsUrl } from '../tripSteps';
import { clearChat, contextFrom, loadChat, saveChat } from '../chatMemory';
import { Button, C } from '../ui';

// Harvey Assistant: the website's AI Agent Manager in the driver app. It
// replaces the screen content (no floating overlay), keeps the 911 line
// fixed above the conversation, and during a trip offers only large
// one-tap questions with spoken answers.
export default function AssistantScreen({ app, onClose, onOpenTab }) {
  const { snapshot, actions } = app;
  const handsFree = isHandsFree(snapshot);
  const accountId = snapshot && snapshot.driver ? snapshot.driver.id : null;
  const greeting = [{ id: 0, who: 'bot', text: GREETING }];
  const [messages, setMessages] = useState(() => loadChat(accountId) || greeting);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [readAloud, setReadAloud] = useState(handsFree);
  const scroll = useRef(null);
  const nextId = useRef(Math.max(0, ...messages.map((m) => m.id)) + 1);

  // Kept on this device for this account only (src/chatMemory.js).
  useEffect(() => {
    saveChat(accountId, messages);
  }, [accountId, messages]);

  const clear = () => {
    Speech.stop();
    clearChat(accountId);
    nextId.current = 1;
    setMessages(greeting);
  };

  useEffect(() => {
    if (handsFree) setReadAloud(true);
  }, [handsFree]);
  useEffect(() => () => Speech.stop(), []);

  const add = (msg) => setMessages((prev) => [...prev, { id: nextId.current++, ...msg }]);

  const ask = async (message) => {
    const clean = String(message || '').trim();
    if (!clean || sending) return;
    const context = contextFrom(messages);
    add({ who: 'me', text: clean });
    setText('');
    setSending(true);
    let reply = UNAVAILABLE_REPLY;
    let urgent = false;
    let proposed = [];
    let sources = [];
    try {
      const res = await actions.askAssistant(clean, context);
      reply = res.reply || UNAVAILABLE_REPLY;
      urgent = Boolean(res.escalation && res.escalation.category === 'emergency');
      proposed = res.unavailable ? [] : res.actions || [];
      sources = res.unavailable ? [] : (res.sources || []).filter((src) => src && typeof src.url === 'string' && src.url.startsWith('/'));
    } catch {
      reply = UNAVAILABLE_REPLY;
    }
    add({ who: 'bot', text: reply, urgent, actions: planActions(proposed, snapshot), sources });
    setSending(false);
    if (readAloud) {
      Speech.stop();
      Speech.speak(speakable(reply), { language: 'en-US' });
    }
  };

  const execute = async (run) => {
    switch (run.type) {
      case 'accept_offer':
        onClose();
        return actions.acceptOffer(run.offerId);
      case 'decline_offer':
        onClose();
        return actions.declineOffer(run.offerId);
      case 'trip_step':
        onClose();
        return actions.advanceTrip(run.ride, run.step);
      case 'go_online':
        onClose();
        return actions.goOnline();
      case 'go_offline':
        onClose();
        return actions.goOffline();
      case 'navigate': {
        const url = directionsUrl(run.target, Platform.OS);
        return url ? Linking.openURL(url) : null;
      }
      case 'tab':
        return onOpenTab(run.tab);
      case 'support':
        return WebBrowser.openBrowserAsync(LINKS.support);
      case 'call_911':
        return Linking.openURL(`tel:${EMERGENCY_NUMBER}`);
      case 'safety_alert':
        try {
          await actions.sendSafetyAlert(run.rideId);
          add({ who: 'bot', urgent: true, text: 'The safety team has been alerted. If anyone is in danger, call 911.' });
        } catch {
          add({ who: 'bot', urgent: true, text: 'The alert could not be sent. Call 911 if anyone is in danger.' });
        }
        return null;
      default:
        return null;
    }
  };

  const press = (action) => {
    if (!action.confirm) return execute(action.run);
    Alert.alert(action.confirm.title, action.confirm.message, [
      { text: 'Cancel', style: 'cancel' },
      { text: action.confirm.ok, style: action.tone === 'danger' ? 'destructive' : 'default', onPress: () => execute(action.run) }
    ]);
    return null;
  };

  return (
    <View style={st.wrap}>
      <View style={st.head}>
        <View>
          <Text style={st.title} accessibilityRole="header">Harvey Assistant</Text>
          <Text style={st.sub}>{handsFree ? 'Hands-free while you drive' : 'Answers from your own trips and account'}</Text>
        </View>
        <Pressable testID="assistant-clear" accessibilityRole="button" accessibilityLabel="Clear chat" onPress={clear} style={st.close}>
          <Text style={st.closeText}>Clear chat</Text>
        </Pressable>
        <Pressable testID="assistant-close" accessibilityRole="button" accessibilityLabel="Close assistant" onPress={onClose} style={st.close}>
          <Text style={st.closeText}>Done</Text>
        </Pressable>
      </View>

      <View style={st.banner}>
        <Text style={st.bannerText}>
          Emergency? <Text style={st.bannerLink} onPress={() => Linking.openURL(`tel:${EMERGENCY_NUMBER}`)}>Call 911</Text> first. This assistant cannot send help.
        </Text>
      </View>

      <ScrollView ref={scroll} style={st.log} contentContainerStyle={{ paddingVertical: 8, gap: 8 }} onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: true })}>
        {messages.map((m) => (
          <View key={m.id} style={[st.msg, m.who === 'me' ? st.me : st.bot, m.urgent && st.urgent]} testID={m.who === 'bot' ? 'assistant-reply' : undefined}>
            <Text style={st.msgText}>{m.text}</Text>
            {m.sources && m.sources.length > 0 && (
              <View style={st.sources} testID="assistant-sources">
                <Text style={st.sourceHead}>Source</Text>
                {m.sources.map((src) => (
                  <Text
                    key={`${src.url}#${src.section}`}
                    style={st.sourceLink}
                    accessibilityRole="link"
                    onPress={() => WebBrowser.openBrowserAsync(`${API_BASE}${src.url}`)}
                  >
                    {sourceLabel(src)}
                  </Text>
                ))}
              </View>
            )}
            {m.actions && m.actions.length > 0 && (
              <View style={st.actions}>
                {m.actions.map((a) => (
                  <Button key={a.key} testID={`assistant-action-${a.key}`} title={a.label} kind={a.tone} onPress={() => press(a)} style={st.action} />
                ))}
              </View>
            )}
          </View>
        ))}
        {sending && <Text style={st.sub}>Checking…</Text>}
      </ScrollView>

      <View style={st.chips} accessibilityRole="menu">
        {QUICK_PROMPTS.map((q) => (
          <Pressable
            key={q.key}
            testID={`assistant-quick-${q.key}`}
            accessibilityRole="button"
            onPress={() => ask(q.message)}
            disabled={sending}
            style={({ pressed }) => [st.chip, handsFree && st.chipBig, (pressed || sending) && { opacity: 0.6 }]}
          >
            <Text style={[st.chipText, handsFree && st.chipTextBig]}>{q.label}</Text>
          </Pressable>
        ))}
      </View>

      <View style={st.footer}>
        <Pressable
          testID="assistant-read-aloud"
          accessibilityRole="switch"
          accessibilityState={{ checked: readAloud }}
          onPress={() => {
            if (readAloud) Speech.stop();
            setReadAloud(!readAloud);
          }}
          style={st.toggle}
        >
          <Text style={[st.toggleText, readAloud && { color: C.cyan }]}>{readAloud ? 'Reading answers aloud' : 'Read answers aloud'}</Text>
        </Pressable>
        {handsFree ? (
          <Text style={st.sub}>Typing is off during a trip. Tap a question above.</Text>
        ) : (
          <View style={st.form}>
            <TextInput
              testID="assistant-input"
              style={st.input}
              value={text}
              onChangeText={setText}
              placeholder="Ask about offers, your trip or earnings"
              placeholderTextColor={C.muted}
              maxLength={1000}
              returnKeyType="send"
              onSubmitEditing={() => ask(text)}
              accessibilityLabel="Message"
            />
            <Button testID="assistant-send" title="Send" onPress={() => ask(text)} disabled={!text.trim() || sending} style={st.send} />
          </View>
        )}
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  wrap: { flex: 1, paddingHorizontal: 16, paddingTop: 12 },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  title: { color: C.text, fontSize: 22, fontWeight: '900' },
  sub: { color: C.muted, fontSize: 13, marginTop: 2 },
  close: { minHeight: 44, minWidth: 64, alignItems: 'center', justifyContent: 'center', borderRadius: 12, borderWidth: 1, borderColor: C.line },
  closeText: { color: C.text, fontWeight: '800', fontSize: 15 },
  banner: { padding: 10, borderRadius: 12, backgroundColor: '#2e1019', borderWidth: 1, borderColor: 'rgba(255,126,151,0.4)' },
  bannerText: { color: C.text, fontSize: 13 },
  bannerLink: { color: '#ff9bb0', fontWeight: '800' },
  log: { flex: 1, marginTop: 8 },
  msg: { padding: 12, borderRadius: 14, maxWidth: '92%' },
  me: { alignSelf: 'flex-end', backgroundColor: '#1d4ed8' },
  bot: { alignSelf: 'flex-start', backgroundColor: '#16244a', borderWidth: 1, borderColor: 'rgba(99,245,255,0.18)' },
  urgent: { backgroundColor: '#4a1220', borderColor: C.danger },
  msgText: { color: C.text, fontSize: 16, lineHeight: 22 },
  actions: { marginTop: 8, gap: 0 },
  sources: { marginTop: 8, gap: 4 },
  sourceHead: { color: C.muted, fontSize: 12, fontWeight: '800', textTransform: 'uppercase' },
  sourceLink: { color: C.cyan, fontSize: 13, textDecorationLine: 'underline' },
  action: { marginTop: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingTop: 8 },
  chip: { borderRadius: 999, borderWidth: 1, borderColor: 'rgba(99,245,255,0.45)', backgroundColor: 'rgba(99,245,255,0.08)', paddingHorizontal: 14, minHeight: 44, justifyContent: 'center' },
  chipBig: { flexBasis: '47%', flexGrow: 1, borderRadius: 16, minHeight: 60, alignItems: 'center' },
  chipText: { color: C.cyan, fontWeight: '800', fontSize: 14 },
  chipTextBig: { fontSize: 17 },
  footer: { paddingVertical: 10, gap: 6 },
  toggle: { minHeight: 36, justifyContent: 'center' },
  toggleText: { color: C.muted, fontWeight: '700', fontSize: 14 },
  form: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  input: { flex: 1, minHeight: 48, borderRadius: 12, borderWidth: 1, borderColor: C.line, backgroundColor: 'rgba(4,8,20,0.6)', color: C.text, paddingHorizontal: 12, fontSize: 16 },
  send: { marginTop: 0, minWidth: 80 }
});

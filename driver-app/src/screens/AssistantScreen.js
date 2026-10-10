import React, { useEffect, useRef, useState } from 'react';
import { Alert, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import * as Speech from 'expo-speech';
import * as WebBrowser from 'expo-web-browser';

import { API_BASE, EMERGENCY_NUMBER, LINKS } from '../config';
import { AI_SPOKEN_NOTE, aiAnswerLabel, answeredByLabel, consentNotice, GREETING, isHandsFree, planActions, QUICK_PROMPTS, sourceLabel, speakable, UNAVAILABLE_REPLY } from '../assistant';
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
  // Support handoff editor: null, or { kind, requestId, text, ride,
  // attachRide, loading, sending, error }. One requestId per review, so a
  // retry can't create a second case.
  const [handoff, setHandoff] = useState(null);
  // AI answers: `consent` is the server's notice waiting for an answer
  // ({ notice, question, saving, error }) or null; `aiOn` shows the "Turn
  // off" control. "Not now" isn't asked again while this screen is open.
  const [consent, setConsent] = useState(null);
  const [aiOn, setAiOn] = useState(false);
  const declined = useRef(false);
  const scroll = useRef(null);
  const nextId = useRef(Math.max(0, ...messages.map((m) => m.id)) + 1);

  // Kept on this device for this account only (src/chatMemory.js).
  useEffect(() => {
    saveChat(accountId, messages);
  }, [accountId, messages]);

  const clear = () => {
    Speech.stop();
    setHandoff(null);
    clearChat(accountId);
    nextId.current = 1;
    setMessages(greeting);
  };

  useEffect(() => {
    if (handsFree) setReadAloud(true);
  }, [handsFree]);
  useEffect(() => () => Speech.stop(), []);
  useEffect(() => {
    let live = true;
    if (actions.aiConsentStatus) {
      actions
        .aiConsentStatus()
        .then((res) => live && setAiOn(Boolean(res && res.ai_available && res.consent && res.consent.granted)))
        .catch(() => {});
    }
    return () => {
      live = false;
    };
  }, [actions]);

  const add = (msg) => setMessages((prev) => [...prev, { id: nextId.current++, ...msg }]);

  // `repeat`: the same question again right after AI answers were allowed,
  // without showing it twice or sending it as its own context.
  const ask = async (message, { repeat = false } = {}) => {
    const clean = String(message || '').trim();
    if (!clean || sending) return;
    let context = contextFrom(messages);
    if (repeat) {
      const at = context.map((t) => t.role === 'user' && t.text === clean).lastIndexOf(true);
      if (at >= 0) context = context.slice(0, at);
    } else {
      add({ who: 'me', text: clean });
    }
    setText('');
    setSending(true);
    let reply = UNAVAILABLE_REPLY;
    let urgent = false;
    let proposed = [];
    let sources = [];
    let answeredBy = null;
    let aiWritten = false;
    let notice = null;
    try {
      const res = await actions.askAssistant(clean, context);
      reply = res.reply || UNAVAILABLE_REPLY;
      urgent = Boolean(res.escalation && res.escalation.category === 'emergency');
      proposed = res.unavailable ? [] : res.actions || [];
      sources = res.unavailable ? [] : (res.sources || []).filter((src) => src && typeof src.url === 'string' && src.url.startsWith('/'));
      answeredBy = res.unavailable ? null : answeredByLabel(res.specialist) || aiAnswerLabel(res.answered_by);
      aiWritten = !res.unavailable && !res.specialist && Boolean(aiAnswerLabel(res.answered_by));
      notice = res.unavailable ? null : consentNotice(res);
    } catch {
      reply = UNAVAILABLE_REPLY;
    }
    add({ who: 'bot', text: reply, urgent, actions: planActions(proposed, snapshot), sources, answeredBy });
    setSending(false);
    if (readAloud) {
      Speech.stop();
      Speech.speak(speakable(aiWritten ? `${reply} ${AI_SPOKEN_NOTE}` : reply), { language: 'en-US' });
    }
    // Not while driving: the notice needs reading, so it waits until the
    // driver isn't on a trip (answers stay standard meanwhile).
    if (notice && !handsFree && !declined.current) setConsent({ notice, question: clean, saving: false, error: null });
  };

  const allowAi = async () => {
    if (!consent || consent.saving) return;
    setConsent({ ...consent, saving: true, error: null });
    try {
      await actions.setAiConsent(true, consent.notice.version);
      const { question } = consent;
      setConsent(null);
      setAiOn(true);
      add({ who: 'bot', text: 'AI answers are on. You can turn them off at any time below.' });
      if (question) await ask(question, { repeat: true });
    } catch (err) {
      const msg = err && err.data && err.data.error;
      setConsent({ ...consent, saving: false, error: msg || "Your choice couldn't be saved. AI answers stay off." });
    }
  };

  const notNow = () => {
    declined.current = true;
    setConsent(null);
    actions.setAiConsent(false).catch(() => {});
    add({ who: 'bot', text: "OK. You'll keep getting answers from Harvey Taxi's standard assistant. Nothing was sent to the AI." });
  };

  const turnOffAi = async () => {
    try {
      await actions.setAiConsent(false);
      setAiOn(false);
      declined.current = true;
      add({ who: 'bot', text: "AI answers are off. You'll get answers from Harvey Taxi's standard assistant." });
    } catch {
      add({ who: 'bot', text: "That didn't save. Please try again." });
    }
  };

  const sendingRef = useRef(false);
  const openHandoff = async (kind = 'general') => {
    if (handsFree) {
      add({ who: 'bot', text: "You can send a request to support once you're not on a trip. For an emergency, call 911." });
      return;
    }
    const requestId = `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
    const base = { kind, requestId, text: '', ride: null, attachRide: false, loading: true, sending: false, error: null };
    setHandoff(base);
    try {
      const res = await actions.draftSupportHandoff(contextFrom(messages), kind);
      const ride = res && res.ride && res.ride.id ? res.ride : null;
      setHandoff({ ...base, text: typeof res.draft === 'string' ? res.draft : '', ride, attachRide: Boolean(ride), loading: false });
    } catch {
      setHandoff({ ...base, loading: false, error: "A request can't be prepared right now. Use Contact support instead. In an emergency, call 911." });
    }
  };

  const sendHandoff = async () => {
    // A second tap while sending does nothing (and the server would return
    // the same case for the same requestId anyway).
    if (!handoff || handoff.sending || sendingRef.current) return;
    sendingRef.current = true;
    setHandoff({ ...handoff, sending: true, error: null });
    try {
      const res = await actions.sendSupportHandoff({
        summary: handoff.text,
        kind: handoff.kind,
        rideId: handoff.ride && handoff.attachRide ? handoff.ride.id : null,
        requestId: handoff.requestId
      });
      // Only a saved case (with its reference) counts as received.
      if (res && res.case_created === true && res.reference) {
        setHandoff(null);
        add({ who: 'bot', text: res.message || `Received. Your case reference is ${res.reference}.` });
        return;
      }
      setHandoff({ ...handoff, sending: false, error: 'Your request was not sent. Please try again, or use Contact support.' });
    } catch (err) {
      const msg = err && err.data && err.data.error;
      setHandoff({ ...handoff, sending: false, error: msg || 'Your request was not sent. Please try again, or use Contact support.' });
    } finally {
      sendingRef.current = false;
    }
  };

  const cancelHandoff = () => {
    setHandoff(null);
    add({ who: 'bot', text: 'Not sent. Nothing was shared with support.' });
  };

  const execute = async (run) => {
    switch (run.type) {
      case 'handoff':
        return openHandoff(run.kind);
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

      <ScrollView ref={scroll} style={st.log} contentContainerStyle={{ paddingVertical: 8, gap: 8 }} onContentSizeChange={() => !consent && scroll.current?.scrollToEnd({ animated: true })}>
        {messages.map((m) => (
          <View key={m.id} style={[st.msg, m.who === 'me' ? st.me : st.bot, m.urgent && st.urgent]} testID={m.who === 'bot' ? 'assistant-reply' : undefined}>
            <Text style={st.msgText}>{m.text}</Text>
            {m.answeredBy ? (
              <Text style={st.answeredBy} testID="assistant-answered-by">
                {m.answeredBy}
              </Text>
            ) : null}
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
        {consent && (
          <View
            style={st.handoff}
            testID="assistant-consent"
            accessibilityRole="summary"
            // The notice opens at its title, not scrolled to its buttons.
            onLayout={(e) => scroll.current?.scrollTo({ y: Math.max(0, e.nativeEvent.layout.y - 8), animated: true })}
          >
            <Text style={st.handoffTitle} accessibilityRole="header">{consent.notice.title}</Text>
            <Text style={st.consentBody}>{consent.notice.body}</Text>
            {consent.notice.points.map((p) => (
              <Text key={p} style={st.consentPoint}>• {p}</Text>
            ))}
            {consent.notice.privacyUrl ? (
              <Text style={st.sourceLink} accessibilityRole="link" testID="assistant-consent-privacy" onPress={() => WebBrowser.openBrowserAsync(consent.notice.privacyUrl)}>
                Privacy policy
              </Text>
            ) : null}
            {consent.error ? <Text style={st.handoffError} accessibilityRole="alert">{consent.error}</Text> : null}
            <View style={st.handoffRow}>
              <Button testID="assistant-consent-allow" title={consent.saving ? 'Saving…' : consent.notice.allow} onPress={allowAi} disabled={consent.saving} style={st.handoffBtn} />
              <Button testID="assistant-consent-decline" title={consent.notice.decline} kind="ghost" onPress={notNow} disabled={consent.saving} style={st.handoffBtn} />
            </View>
          </View>
        )}
        {handoff && (
          <View style={st.handoff} testID="assistant-handoff">
            <Text style={st.handoffTitle}>{handoff.kind === 'lost_item' ? 'Report a found item' : 'Send a request to Harvey Taxi support'}</Text>
            <Text style={st.sub}>
              {handoff.loading ? 'Preparing a summary…' : 'Review and edit this. Nothing is sent until you tap Send to support.'}
            </Text>
            {!handoff.loading && (
              <TextInput
                testID="assistant-handoff-text"
                style={st.handoffInput}
                value={handoff.text}
                onChangeText={(t) => setHandoff({ ...handoff, text: t, error: null })}
                multiline
                maxLength={1500}
                editable={!handoff.sending}
                accessibilityLabel="Summary for support"
              />
            )}
            {handoff.ride ? (
              <Pressable
                testID="assistant-handoff-ride"
                accessibilityRole="checkbox"
                accessibilityState={{ checked: handoff.attachRide }}
                onPress={() => setHandoff({ ...handoff, attachRide: !handoff.attachRide })}
                style={st.rideRow}
              >
                <Text style={st.rideText}>{handoff.attachRide ? '☑' : '☐'} Attach this trip for support: {handoff.ride.label}</Text>
              </Pressable>
            ) : null}
            {handoff.error ? <Text style={st.handoffError} accessibilityRole="alert">{handoff.error}</Text> : null}
            <View style={st.handoffRow}>
              <Button
                testID="assistant-handoff-send"
                title={handoff.sending ? 'Sending…' : 'Send to support'}
                onPress={sendHandoff}
                disabled={handoff.loading || handoff.sending || handoff.text.trim().length < 10}
                style={st.handoffBtn}
              />
              <Button testID="assistant-handoff-cancel" title="Cancel" kind="ghost" onPress={cancelHandoff} disabled={handoff.sending} style={st.handoffBtn} />
            </View>
          </View>
        )}
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
        {aiOn ? (
          <View style={st.aiRow} testID="assistant-ai-on">
            <Text style={st.sub}>AI answers are on.</Text>
            <Pressable testID="assistant-ai-off" accessibilityRole="button" onPress={turnOffAi} style={st.aiOff}>
              <Text style={st.toggleText}>Turn off AI answers</Text>
            </Pressable>
          </View>
        ) : null}
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
  answeredBy: { color: C.muted, fontSize: 12, marginTop: 4 },
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
  send: { marginTop: 0, minWidth: 80 },
  handoff: { padding: 12, borderRadius: 14, borderWidth: 1, borderColor: 'rgba(99,245,255,0.35)', backgroundColor: '#0a1228', gap: 8 },
  handoffTitle: { color: C.text, fontSize: 16, fontWeight: '800' },
  handoffInput: { minHeight: 140, borderRadius: 12, borderWidth: 1, borderColor: C.line, backgroundColor: 'rgba(4,8,20,0.6)', color: C.text, padding: 10, fontSize: 15, textAlignVertical: 'top' },
  handoffError: { color: '#ff9bb0', fontSize: 14 },
  rideRow: { minHeight: 44, justifyContent: 'center' },
  rideText: { color: C.text, fontSize: 14 },
  handoffRow: { flexDirection: 'row', gap: 8 },
  handoffBtn: { flex: 1, marginTop: 0 },
  consentBody: { color: C.text, fontSize: 15, lineHeight: 21 },
  consentPoint: { color: C.muted, fontSize: 13, lineHeight: 19 },
  aiRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  aiOff: { minHeight: 36, justifyContent: 'center', paddingHorizontal: 10, borderRadius: 10, borderWidth: 1, borderColor: C.line }
});

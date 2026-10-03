import React, { useState } from 'react';
import { Image, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';

import { LINKS } from '../config';
import { Button, C, Card, H, Notice, P } from '../ui';

export default function SignInScreen({ app }) {
  const { actions, busy, notice } = app;
  const [mode, setMode] = useState('phone'); // phone | code | review
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [sentMessage, setSentMessage] = useState(null);

  const sendCode = async () => {
    const res = await actions.startPhoneSignIn(phone);
    if (res) {
      setSentMessage(res.message);
      setMode('code');
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={st.wrap} keyboardShouldPersistTaps="handled">
        <View style={st.brand}>
          <Image source={require('../../assets/icon.png')} style={st.logo} accessibilityIgnoresInvertColors />
          <Text style={st.title}>Harvey Taxi Driver</Text>
          <P muted>For approved Harvey Taxi drivers.</P>
        </View>

        <Notice text={notice} onClose={actions.dismissNotice} />

        {mode === 'phone' && (
          <Card>
            <H>Sign in</H>
            <P muted>Enter the mobile number on your driver account. We'll text you a code.</P>
            <TextInput
              testID="phone-input"
              style={st.input}
              value={phone}
              onChangeText={setPhone}
              placeholder="(615) 555-0123"
              placeholderTextColor={C.muted}
              keyboardType="phone-pad"
              textContentType="telephoneNumber"
              autoComplete="tel"
              accessibilityLabel="Mobile number"
            />
            <Button testID="send-code" title="Text me a code" onPress={sendCode} busy={busy === 'signin'} disabled={phone.replace(/\D/g, '').length < 10} />
          </Card>
        )}

        {mode === 'code' && (
          <Card>
            <H>Enter your code</H>
            <P muted>{sentMessage}</P>
            <TextInput
              testID="code-input"
              style={st.input}
              value={code}
              onChangeText={setCode}
              placeholder="6-digit code"
              placeholderTextColor={C.muted}
              keyboardType="number-pad"
              textContentType="oneTimeCode"
              autoComplete="sms-otp"
              maxLength={10}
              accessibilityLabel="Sign-in code"
            />
            <Button testID="verify-code" title="Sign in" onPress={() => actions.verifyPhoneSignIn(phone, code)} busy={busy === 'signin'} disabled={code.length < 4} />
            <Button title="Use a different number" kind="ghost" onPress={() => { setMode('phone'); setCode(''); }} />
          </Card>
        )}

        {mode === 'review' && (
          <Card>
            <H>Test account sign-in</H>
            <P muted>For Harvey Taxi test and App Review accounts only. Drivers sign in with their phone number.</P>
            <TextInput style={st.input} value={email} onChangeText={setEmail} placeholder="Email" placeholderTextColor={C.muted} autoCapitalize="none" keyboardType="email-address" accessibilityLabel="Email" />
            <TextInput style={st.input} value={password} onChangeText={setPassword} placeholder="Password" placeholderTextColor={C.muted} secureTextEntry accessibilityLabel="Password" />
            <Button title="Sign in" onPress={() => actions.reviewSignIn(email.trim(), password)} busy={busy === 'signin'} disabled={!email || !password} />
            <Button title="Back to phone sign-in" kind="ghost" onPress={() => setMode('phone')} />
          </Card>
        )}

        <Card>
          <H>New to Harvey Taxi?</H>
          <P muted>Apply on our website. Identity and background checks run there; once you're approved, sign in here.</P>
          <Button testID="apply-to-drive" title="Apply to drive" kind="ghost" onPress={() => WebBrowser.openBrowserAsync(LINKS.driverSignup)} />
        </Card>

        {mode !== 'review' && <Button title="Test account sign-in" kind="ghost" onPress={() => setMode('review')} style={{ marginBottom: 24 }} />}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const st = StyleSheet.create({
  wrap: { padding: 16, paddingTop: 24 },
  brand: { alignItems: 'center', marginBottom: 18, gap: 6 },
  logo: { width: 84, height: 84, borderRadius: 20 },
  title: { color: C.text, fontSize: 26, fontWeight: '900' },
  input: { minHeight: 52, borderRadius: 14, borderWidth: 1, borderColor: C.line, backgroundColor: 'rgba(4,8,20,0.6)', color: C.text, paddingHorizontal: 14, fontSize: 17, marginTop: 12 }
});

import React, { useState } from 'react';
import { Alert, Linking, ScrollView, StyleSheet, TextInput } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import * as Application from 'expo-application';

import { EMERGENCY_NUMBER, LINKS, SUPPORT_PHONE } from '../config';
import { Button, C, Card, H, Notice, P, Row } from '../ui';

export default function AccountScreen({ app }) {
  const { snapshot, actions, busy, notice } = app;
  const [confirmText, setConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [done, setDone] = useState(null);

  return (
    <ScrollView contentContainerStyle={{ padding: 16 }}>
      <Notice text={notice} onClose={actions.dismissNotice} />
      {done && <Notice tone="info" text={done} />}

      <Card>
        <H>Help and safety</H>
        <Button title="Contact support" kind="ghost" onPress={() => WebBrowser.openBrowserAsync(LINKS.support)} />
        {SUPPORT_PHONE && <Button title="Call driver support" kind="ghost" onPress={() => Linking.openURL(`tel:${SUPPORT_PHONE}`)} />}
        <Button
          title="Emergency · call 911"
          kind="danger"
          onPress={() =>
            Alert.alert('Call 911?', 'This calls emergency services now.', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Call 911', style: 'destructive', onPress: () => Linking.openURL(`tel:${EMERGENCY_NUMBER}`) }
            ])
          }
        />
      </Card>

      <Card>
        <H>Settings and policies</H>
        <Button title="Location and notification settings" kind="ghost" onPress={() => Linking.openSettings()} />
        <Button title="Privacy policy" kind="ghost" onPress={() => WebBrowser.openBrowserAsync(LINKS.privacy)} />
        <Button title="Terms" kind="ghost" onPress={() => WebBrowser.openBrowserAsync(LINKS.terms)} />
        <Row label="Driver ID" value={snapshot?.driver?.id || '—'} />
        <Row label="App version" value={`${Application.nativeApplicationVersion || '—'} (${Application.nativeBuildVersion || '—'})`} />
      </Card>

      <Button title="Sign out" kind="ghost" onPress={actions.signOut} />

      <Card style={{ marginTop: 20 }}>
        <H>Delete account</H>
        <P muted>
          This sends a deletion request for your driver account and signs you out immediately; you won't be able to sign in again. Harvey Taxi
          reviews the request and then removes your personal information from your account. You can also request deletion on our website.
        </P>
        {!deleting ? (
          <Button testID="delete-start" title="Delete my account" kind="danger" onPress={() => setDeleting(true)} />
        ) : (
          <>
            <P style={{ marginTop: 10 }}>Type DELETE to confirm.</P>
            <TextInput style={st.input} value={confirmText} onChangeText={setConfirmText} autoCapitalize="characters" accessibilityLabel="Type DELETE to confirm" />
            <Button
              testID="delete-confirm"
              title="Request account deletion"
              kind="danger"
              disabled={confirmText.trim() !== 'DELETE'}
              busy={busy === 'delete'}
              onPress={async () => {
                const res = await actions.deleteAccount('Requested in the Harvey Taxi Driver app');
                if (res) setDone(res.message || 'Your deletion request was received.');
              }}
            />
            <Button title="Cancel" kind="ghost" onPress={() => setDeleting(false)} />
          </>
        )}
      </Card>
    </ScrollView>
  );
}

const st = StyleSheet.create({
  input: { minHeight: 48, borderRadius: 12, borderWidth: 1, borderColor: C.line, color: C.text, paddingHorizontal: 12, marginTop: 8 }
});

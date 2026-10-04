import React, { useEffect, useState } from 'react';
import { Alert, Linking, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';

import { EMERGENCY_NUMBER, LINKS } from '../config';
import { directionsUrl, isDelivery, nextStep, STATUS_LABELS } from '../tripSteps';
import { riderSharingText } from '../tripMap';
import TripMapView from '../TripMapView';
import { Button, C, Card, H, money, Notice, P, Pill, Row } from '../ui';

const CHECK_LABELS = {
  email_verified: 'Email verified',
  phone_verified: 'Phone verified',
  persona_verified: 'Identity verified',
  checkr_ready: 'Background check clear',
  vehicle_present: 'Vehicle on file'
};

function useCountdown(offer) {
  const [left, setLeft] = useState(offer ? offer.seconds_left : null);
  useEffect(() => {
    if (!offer || !Number.isFinite(offer.seconds_left)) return undefined;
    const start = Date.now();
    setLeft(offer.seconds_left);
    const id = setInterval(() => setLeft(Math.max(0, offer.seconds_left - Math.floor((Date.now() - start) / 1000))), 1000);
    return () => clearInterval(id);
  }, [offer && offer.offer_id, offer && offer.seconds_left]);
  return left;
}

function OfferCard({ offer, app }) {
  const left = useCountdown(offer);
  const expired = left === 0;
  return (
    <Card accent={C.cyan}>
      <View style={st.between}>
        <H>New ride request</H>
        <Pill text={expired ? 'Expired' : `${left}s`} tone={expired ? 'bad' : left <= 10 ? 'warn' : 'info'} />
      </View>
      {offer.is_review_ride && <Pill text="Test ride · no charge" tone="warn" />}
      <Row label="Pickup" value={offer.pickup_address || 'See map'} />
      <Row label="Drop-off" value={offer.dropoff_address || '—'} />
      <Row label="Estimated fare" value={money(offer.estimated_fare)} />
      {offer.estimated_payout !== null && <Row label="Your estimated payout" value={money(offer.estimated_payout)} />}
      {offer.eta_to_pickup_minutes !== null && <Row label="To pickup" value={`${Math.round(offer.eta_to_pickup_minutes)} min`} />}
      <View style={st.two}>
        <Button title="Decline" kind="ghost" style={st.flex} onPress={() => app.actions.declineOffer(offer.offer_id)} busy={app.busy === `decline:${offer.offer_id}`} disabled={expired || Boolean(app.busy)} />
        <Button testID="accept-offer" title="Accept" kind="go" style={st.flex} onPress={() => app.actions.acceptOffer(offer.offer_id)} busy={app.busy === `accept:${offer.offer_id}`} disabled={expired || Boolean(app.busy)} />
      </View>
    </Card>
  );
}

function callEmergency() {
  Alert.alert('Call 911?', 'This calls emergency services now.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Call 911', style: 'destructive', onPress: () => Linking.openURL(`tel:${EMERGENCY_NUMBER}`) }
  ]);
}

function ActiveRideCard({ ride, app, mapToken }) {
  const sharing = riderSharingText(ride);
  const step = nextStep(ride);
  const target = step && step.navigateTo === 'dropoff'
    ? { lat: ride.dropoff_lat, lng: ride.dropoff_lng, address: ride.dropoff_address }
    : { lat: ride.pickup_lat, lng: ride.pickup_lng, address: ride.pickup_address };
  const nav = directionsUrl(target, Platform.OS);
  return (
    <Card accent={C.green}>
      <View style={st.between}>
        <H>{STATUS_LABELS[ride.status] || 'Current trip'}</H>
        {ride.is_review_ride && <Pill text="Test ride" tone="warn" />}
      </View>
      {ride.rider_first_name && <Row label="Rider" value={ride.rider_first_name} />}
      <Row label="Pickup" value={ride.pickup_address || '—'} />
      <Row label="Drop-off" value={ride.dropoff_address || '—'} />
      {ride.notes && <Row label="Notes" value={ride.notes} />}
      {sharing && <View testID="rider-sharing"><P muted>{sharing}</P></View>}
      <TripMapView ride={ride} token={mapToken} />
      {isDelivery(ride) ? (
        <>
          <P muted style={{ marginTop: 8 }}>Deliveries aren't supported in this version of the app yet. Continue this delivery in the web driver dashboard.</P>
          <Button title="Open web dashboard" kind="ghost" onPress={() => WebBrowser.openBrowserAsync(LINKS.onboarding)} />
        </>
      ) : (
        <>
          {nav && <Button title={step && step.navigateTo === 'dropoff' ? 'Navigate to drop-off' : 'Navigate to pickup'} kind="ghost" onPress={() => Linking.openURL(nav)} />}
          {ride.rider_phone && <Button title="Call rider" kind="ghost" onPress={() => Linking.openURL(`tel:${ride.rider_phone}`)} />}
          {step && (
            <Button
              testID={`step-${step.action}`}
              title={step.label}
              kind="go"
              onPress={() =>
                step.action === 'complete'
                  ? Alert.alert('Complete this trip?', 'Only complete the trip once the rider has been dropped off.', [
                      { text: 'Not yet', style: 'cancel' },
                      { text: 'Complete', onPress: () => app.actions.advanceTrip(ride, step) }
                    ])
                  : app.actions.advanceTrip(ride, step)
              }
              busy={app.busy === `step:${step.action}`}
              disabled={Boolean(app.busy)}
            />
          )}
        </>
      )}
      <Button title="Emergency · call 911" kind="danger" onPress={callEmergency} />
    </Card>
  );
}

function LocationDisclosure({ app, onDone }) {
  return (
    <Card accent={C.gold}>
      <H>Location while you drive</H>
      <P>
        Harvey Taxi Driver uses your location only while you are online or on a trip, including when the app is closed or the screen is
        locked. It is used to send you nearby ride requests, show riders where you are, and calculate arrival times.
      </P>
      <P muted style={{ marginTop: 8 }}>
        Tracking stops when you go offline. {Platform.OS === 'android' ? 'A notification shows while it is running.' : 'iOS shows a location indicator while it is running.'}
      </P>
      <Button
        title="Continue"
        onPress={async () => {
          await app.actions.requestLocationPermission();
          onDone();
        }}
      />
    </Card>
  );
}

export default function HomeScreen({ app, onOpenAssistant }) {
  const { snapshot, stream, tracking, push, busy, notice, loadError, actions } = app;
  const [showDisclosure, setShowDisclosure] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  if (!snapshot) {
    return (
      <View style={st.center}>
        {loadError ? (
          <View testID="load-error" style={{ alignItems: 'center', paddingHorizontal: 24 }}>
            <H>Can't load your driver status</H>
            <P muted style={{ textAlign: 'center', marginTop: 8 }}>
              {loadError} We'll keep trying automatically. Ride requests can't reach you in the app until this loads.
            </P>
            <Button testID="load-retry" title="Try again" kind="ghost" onPress={() => actions.refresh()} />
          </View>
        ) : (
          <P muted>Loading your driver status…</P>
        )}
        <Notice text={notice} onClose={actions.dismissNotice} />
      </View>
    );
  }

  const { driver, readiness, offers, active_ride: ride } = snapshot;
  const online = driver.online;

  const goOnline = async () => {
    if ((await actions.locationPermission()) !== 'granted') {
      setShowDisclosure(true);
      return;
    }
    actions.goOnline();
  };

  return (
    <ScrollView
      contentContainerStyle={st.wrap}
      refreshControl={
        <RefreshControl
          tintColor={C.cyan}
          refreshing={refreshing}
          onRefresh={async () => {
            setRefreshing(true);
            await actions.refresh();
            setRefreshing(false);
          }}
        />
      }
    >
      <View style={st.between}>
        <Text style={st.hello}>Hi{driver.first_name ? `, ${driver.first_name}` : ''}</Text>
        <Pill text={online ? 'Online' : 'Offline'} tone={online ? 'good' : 'muted'} />
      </View>
      <View style={[st.between, { marginBottom: 12 }]}>
        <P muted>
          {stream.stream === 'live' ? 'Live updates on' : stream.stream === 'reconnecting' ? 'Reconnecting…' : online ? 'Connecting…' : 'Go online to receive rides'}
        </P>
        {tracking.tracking && <Pill text="Sharing location" tone="info" />}
      </View>
      {onOpenAssistant && (
        <Pressable
          testID="open-assistant"
          accessibilityRole="button"
          accessibilityLabel="Open Harvey Assistant"
          onPress={onOpenAssistant}
          style={({ pressed }) => [st.assistant, pressed && { opacity: 0.7 }]}
        >
          <View style={st.assistantDot} />
          <Text style={st.assistantText}>Harvey Assistant</Text>
          <Text style={st.assistantHint}>{ride ? 'Hands-free' : 'Ask anything'}</Text>
        </Pressable>
      )}

      <Notice text={notice} onClose={actions.dismissNotice} />
      {loadError && (
        <View testID="stale-status">
          <Notice text={`Can't reach Harvey Taxi right now, so this may be out of date. Retrying… (${loadError})`} />
        </View>
      )}
      {driver.is_review_account && <Notice tone="info" text="Test account: rides are simulated and no one is charged." />}

      {showDisclosure && <LocationDisclosure app={app} onDone={() => setShowDisclosure(false)} />}

      {offers.map((offer) => (
        <OfferCard key={offer.offer_id} offer={offer} app={app} />
      ))}

      {ride && <ActiveRideCard ride={ride} app={app} mapToken={snapshot.map && snapshot.map.token} />}

      {!readiness.ready && (
        <Card accent={C.gold}>
          <H>Finish setting up</H>
          <P muted>You can go online once these are complete.</P>
          {Object.entries(readiness.checks).map(([key, okay]) => (
            <Row key={key} label={CHECK_LABELS[key] || key} value={okay ? 'Done' : 'Needed'} valueStyle={{ color: okay ? C.green : C.gold }} />
          ))}
          {!readiness.approved && <Row label="Harvey Taxi approval" value="Pending" valueStyle={{ color: C.gold }} />}
          <Button title="Continue onboarding" kind="ghost" onPress={() => WebBrowser.openBrowserAsync(LINKS.onboarding)} />
        </Card>
      )}

      {!ride && (
        <Card>
          <H>{online ? "You're online" : "You're offline"}</H>
          <P muted>{online ? 'Ride requests near you will appear here.' : 'Go online to start receiving ride requests.'}</P>
          {online ? (
            <Button testID="go-offline" title="Go offline" kind="ghost" onPress={actions.goOffline} busy={busy === 'offline'} />
          ) : (
            <Button testID="go-online" title="Go online" kind="go" onPress={goOnline} busy={busy === 'online'} disabled={!readiness.ready} />
          )}
        </Card>
      )}
      {ride && online && <Button title="Go offline after this trip" kind="ghost" onPress={actions.goOffline} busy={busy === 'offline'} />}

      {tracking.needsPermission && (
        <Notice text="Location is off for Harvey Taxi Driver. Turn it on in Settings so riders and dispatch can see where you are." onClose={() => Linking.openSettings()} />
      )}
      {push && !push.ok && push.reason === 'denied' && (
        <Notice tone="info" text="Notifications are off. Turn them on in Settings so you don't miss ride requests." onClose={() => Linking.openSettings()} />
      )}
    </ScrollView>
  );
}

const st = StyleSheet.create({
  wrap: { padding: 16 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  hello: { color: C.text, fontSize: 24, fontWeight: '900' },
  assistant: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 48,
    marginBottom: 14,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(99,245,255,0.45)',
    backgroundColor: 'rgba(99,245,255,0.08)'
  },
  assistantDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: C.cyan },
  assistantText: { color: C.cyan, fontWeight: '900', fontSize: 16, flex: 1 },
  assistantHint: { color: C.muted, fontSize: 13, fontWeight: '700' },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  two: { flexDirection: 'row', gap: 10 },
  flex: { flex: 1 }
});

import { Alert, Linking } from 'react-native';
import { EMERGENCY_NUMBER } from './config';

// Asks first, then opens the phone dialer on 911. Used by the pinned
// emergency bar (App.js) so it's one tap away on every screen while the
// driver is online or on a trip.
export function callEmergency() {
  Alert.alert('Call 911?', 'This calls emergency services now.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Call 911', style: 'destructive', onPress: () => Linking.openURL(`tel:${EMERGENCY_NUMBER}`) }
  ]);
}

// The bar is shown while the driver is online, has an offer, or is on a
// trip (owner decision 2026-10-18: pin it above the bottom menu).
export function showEmergencyBar(snapshot) {
  if (!snapshot) return false;
  return Boolean(snapshot.active_ride || (snapshot.offers && snapshot.offers.length) || (snapshot.driver && snapshot.driver.online));
}

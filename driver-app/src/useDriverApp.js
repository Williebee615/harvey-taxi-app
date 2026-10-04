// App controller: session, server state sync, location tracking, push and
// app lifecycle. Screens call these actions; every authorization decision
// is the server's.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Vibration } from 'react-native';
import NetInfo from '@react-native-community/netinfo';

import { API_BASE } from './config';
import { ApiError, createApi } from './api';
import { clearSession, getToken, saveSession } from './session';
import { createSyncEngine } from './syncEngine';
import { openEventStream } from './sse';
import { requestLocationPermission, locationPermission, setUnauthorizedHandler, stopTracking, syncTracking } from './locationTask';
import { OFFER_ALERT_KIND, onNotificationReceived, onNotificationTap, playOfferSound, registerForPush, unregisterPush } from './push';
import { createOfferAlerter, OFFER_VIBRATION_PATTERN } from './offerAlert';
import { stepPath } from './tripSteps';
import { clearAllChats } from './chatMemory';

export function useDriverApp() {
  const [phase, setPhase] = useState('booting'); // booting | signedOut | ready
  const [snapshot, setSnapshot] = useState(null);
  const [stream, setStream] = useState({ stream: 'idle', attempt: 0 });
  const [tracking, setTracking] = useState({ tracking: false });
  const [push, setPush] = useState(null);
  const [busy, setBusy] = useState(null);
  const [notice, setNotice] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const engineRef = useRef(null);
  const appStateRef = useRef(AppState.currentState);
  const signingOut = useRef(false);

  const signOutRef = useRef(() => {});
  const offerAlerter = useMemo(
    () =>
      createOfferAlerter({
        vibrate: () => Vibration.vibrate(OFFER_VIBRATION_PATTERN),
        playSound: playOfferSound,
        isForeground: () => appStateRef.current !== 'background'
      }),
    []
  );
  const api = useMemo(() => createApi({ getToken, onUnauthorized: () => signOutRef.current('expired') }), []);

  const applyTracking = useCallback(async (snap) => {
    // Starting needs the app in the foreground; stopping works any time.
    // AppState can report "unknown" at launch, which is the foreground,
    // so only "background" holds a start back (it runs on the next resume).
    const wantsStop = !snap || (!snap.active_ride && !(snap.driver && snap.driver.online));
    if (appStateRef.current === 'background' && !wantsStop) return;
    try {
      setTracking(await syncTracking(snap));
    } catch (err) {
      setTracking({ tracking: false, error: err && err.message });
    }
  }, []);

  const startEngine = useCallback(() => {
    engineRef.current?.stop();
    const engine = createSyncEngine({
      fetchState: () => api.get('/api/driver/state'),
      openStream: (handlers) => {
        let handle = null;
        let cancelled = false;
        getToken().then((token) => {
          if (cancelled || !token) return;
          handle = openEventStream({ url: `${API_BASE}/api/driver/stream`, headers: { 'x-driver-token': token }, ...handlers });
        });
        return {
          close: () => {
            cancelled = true;
            handle?.close();
          }
        };
      },
      onSnapshot: (snap) => {
        offerAlerter.onSnapshot(snap);
        setSnapshot(snap);
        applyTracking(snap);
      },
      onStatus: setStream,
      onError: (err) => setLoadError(err ? err.message || "Can't reach Harvey Taxi." : null),
      onUnauthorized: () => signOutRef.current('expired')
    });
    engineRef.current = engine;
    return engine.start();
  }, [api, applyTracking, offerAlerter]);

  const signOut = useCallback(
    async (why) => {
      if (signingOut.current) return;
      signingOut.current = true;
      try {
        engineRef.current?.stop();
        engineRef.current = null;
        await stopTracking();
        if (why !== 'expired' && why !== 'deleted') await unregisterPush(api);
        await clearSession();
      } finally {
        // Assistant conversations belong to the signed-in account.
        clearAllChats();
        setSnapshot(null);
        setLoadError(null);
        setTracking({ tracking: false });
        setPhase('signedOut');
        if (why === 'expired') setNotice('Your session ended. Please sign in again.');
        if (why === 'deleted') setNotice('Your account deletion request was received and you have been signed out.');
        signingOut.current = false;
      }
    },
    [api]
  );
  signOutRef.current = signOut;
  setUnauthorizedHandler(() => signOutRef.current('expired'));

  // Boot: resume a saved session (trip recovery after a restart).
  useEffect(() => {
    let alive = true;
    (async () => {
      const token = await getToken();
      if (!alive) return;
      if (!token) {
        setPhase('signedOut');
        return;
      }
      setPhase('ready');
      await startEngine();
      setPush(await registerForPush(api));
    })();
    return () => {
      alive = false;
      engineRef.current?.stop();
    };
  }, [api, startEngine]);

  // Foreground and reconnect: reconnect at once and reconcile.
  useEffect(() => {
    const appSub = AppState.addEventListener('change', (next) => {
      appStateRef.current = next;
      if (next === 'active') engineRef.current?.resume().then((snap) => applyTracking(snap));
    });
    let wasConnected = true;
    const netUnsub = NetInfo.addEventListener((s) => {
      const connected = Boolean(s.isConnected);
      if (connected && !wasConnected) engineRef.current?.resume();
      wasConnected = connected;
    });
    // The app's own offer sound (playOfferSound) is not a server push.
    const offPush = onNotificationReceived((data) => {
      if (data && data.kind === OFFER_ALERT_KIND) return;
      engineRef.current?.refresh('push');
    });
    const offTap = onNotificationTap(() => engineRef.current?.refresh('push_tap'));
    return () => {
      appSub.remove();
      netUnsub();
      offPush();
      offTap();
    };
  }, [applyTracking]);

  const run = useCallback(async (label, fn) => {
    setBusy(label);
    setNotice(null);
    try {
      return await fn();
    } catch (err) {
      setNotice(err instanceof ApiError || (err && err.message) ? err.message : 'Something went wrong. Please try again.');
      return null;
    } finally {
      setBusy(null);
    }
  }, []);

  const completeSignIn = useCallback(
    async ({ driver_token: token, driver_id: driverId }) => {
      await saveSession({ token, driverId });
      setNotice(null);
      setPhase('ready');
      await startEngine();
      setPush(await registerForPush(api));
    },
    [api, startEngine]
  );

  const actions = {
    startPhoneSignIn: (phone) => run('signin', () => api.post('/api/driver/session/phone/start', { phone })),
    verifyPhoneSignIn: (phone, code) =>
      run('signin', async () => {
        const res = await api.post('/api/driver/session/phone/verify', { phone, code });
        await completeSignIn(res);
        return res;
      }),
    reviewSignIn: (email, password) =>
      run('signin', async () => {
        const res = await api.post('/api/review/driver/login', { email, password });
        await completeSignIn(res);
        return res;
      }),
    signOut: () => signOut('user'),
    refresh: () => engineRef.current?.refresh('manual'),
    locationPermission,
    requestLocationPermission,
    goOnline: () =>
      run('online', async () => {
        if ((await locationPermission()) !== 'granted') {
          throw new Error('Location is required to go online. Allow location for Harvey Taxi Driver in Settings.');
        }
        await api.post('/api/driver/status', { online: true });
        const snap = await engineRef.current?.refresh('went_online');
        await applyTracking(snap);
      }),
    goOffline: () =>
      run('offline', async () => {
        await api.post('/api/driver/status', { online: false });
        const snap = await engineRef.current?.refresh('went_offline');
        await applyTracking(snap);
      }),
    acceptOffer: (offerId) =>
      run(`accept:${offerId}`, async () => {
        try {
          await api.post(`/api/driver/offers/${encodeURIComponent(offerId)}/accept`, {});
        } finally {
          await engineRef.current?.refresh('accepted');
        }
      }),
    declineOffer: (offerId) =>
      run(`decline:${offerId}`, async () => {
        try {
          await api.post(`/api/driver/offers/${encodeURIComponent(offerId)}/decline`, { reason: 'declined_in_app' });
        } finally {
          await engineRef.current?.refresh('declined');
        }
      }),
    advanceTrip: (ride, step) =>
      run(`step:${step.action}`, async () => {
        try {
          await api.post(stepPath(ride, step), {});
        } finally {
          const snap = await engineRef.current?.refresh(`step_${step.action}`);
          await applyTracking(snap);
        }
      }),
    loadTrips: (before) => api.get(`/api/driver/trips?limit=20${before ? `&before=${encodeURIComponent(before)}` : ''}`),
    loadEarnings: (before) => api.get(`/api/driver/earnings-ledger?limit=20${before ? `&before=${encodeURIComponent(before)}` : ''}`),
    deleteAccount: (reason) =>
      run('delete', async () => {
        const res = await api.post('/api/account/driver/delete-request', { reason });
        await signOut(res && res.simulated ? 'user' : 'deleted');
        return res;
      }),
    // Harvey Assistant (src/assistant.js). These don't use run(): the
    // assistant shows its own answers and errors, not the screen notice.
    assistantStatus: () => api.get('/api/agent/status'),
    askAssistant: async (message, context = []) => {
      try {
        return await api.post('/api/agent/driver/assist', { message, client: 'driver_app', context });
      } catch (err) {
        // Off or killed: the server still sends a safe reply to show.
        if (err instanceof ApiError && err.data && err.data.reply) return { ...err.data, unavailable: true };
        throw err;
      }
    },
    sendSafetyAlert: (rideId) => api.post('/api/safety/911', { ride_id: rideId || null, message: 'Raised from Harvey Assistant (driver app)' }),
    dismissNotice: () => setNotice(null)
  };

  return { phase, snapshot, stream, tracking, push, busy, notice, loadError, actions };
}

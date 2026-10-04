// Harvey Assistant for drivers: the same AI Agent Manager as the website
// (docs/ai-agent-manager.md), answered by POST /api/agent/driver/assist with
// client "driver_app". The server proposes actions built from this driver's
// own rows; this module checks each one against the app's live state and
// turns it into a button. Anything that changes a ride, an offer or
// availability carries a confirmation, and then runs the same app action
// (and authenticated driver route) as the Drive screen's own buttons.
import { nextStep } from './tripSteps';

// One tap, no typing. "help me" is avoided on purpose: the server treats it
// as possible distress and answers with the emergency guidance.
export const QUICK_PROMPTS = Object.freeze([
  { key: 'online', label: 'Going online', message: 'How do I go online?' },
  { key: 'offers', label: 'Ride offers', message: 'Do I have any ride offers?' },
  { key: 'trip', label: 'Next trip step', message: "What's next on my current trip?" },
  { key: 'nav', label: 'Directions', message: 'Navigate to my next stop' },
  { key: 'earnings', label: 'Earnings', message: 'How much did I earn?' },
  { key: 'hours', label: 'My hours', message: 'How many hours have I been online this shift?' },
  { key: 'support', label: 'Support', message: 'I need to contact support' }
]);

export const GREETING =
  'Hi! I can help with going online, ride offers, your next trip step, directions, earnings, your hours and support, and answer policy questions from our published pages. You confirm every change.';

export const UNAVAILABLE_REPLY =
  "The assistant isn't available right now. Everything on the Drive screen still works. In an emergency, call 911.";

// While a trip is active the driver is driving or about to: no typing, big
// buttons only, and answers are read aloud.
export function isHandsFree(snapshot) {
  return Boolean(snapshot && snapshot.active_ride);
}

// Text for speech: drop quote marks around button names.
export function speakable(text) {
  return String(text || '').replace(/["“”]/g, '').trim();
}

const where = (target) => (target === 'dropoff' ? 'drop-off' : 'pickup');

// serverActions: the "actions" array from the assist response.
// Returns [{ key, label, tone, confirm: { title, message, ok } | null, run }]
// where run is { type, ... } for the screen to execute. Stale or foreign
// proposals (an offer that already expired, a ride that moved on) are
// dropped rather than acted on.
export function planActions(serverActions, snapshot) {
  const list = Array.isArray(serverActions) ? serverActions : [];
  const offers = (snapshot && snapshot.offers) || [];
  const ride = (snapshot && snapshot.active_ride) || null;
  const driver = (snapshot && snapshot.driver) || {};
  const readiness = (snapshot && snapshot.readiness) || { ready: false };
  const out = [];

  for (const a of list) {
    if (!a || typeof a.type !== 'string') continue;
    switch (a.type) {
      case 'respond_offer': {
        const offer = offers.find((o) => o.offer_id === a.offer_id);
        if (!offer) break;
        const pickup = offer.pickup_address ? ` Pickup: ${offer.pickup_address}.` : '';
        out.push({
          key: `accept:${offer.offer_id}`,
          label: 'Accept ride',
          tone: 'go',
          confirm: { title: 'Accept this ride?', message: `You'll be assigned to this rider.${pickup}`, ok: 'Accept' },
          run: { type: 'accept_offer', offerId: offer.offer_id }
        });
        out.push({
          key: `decline:${offer.offer_id}`,
          label: 'Decline',
          tone: 'ghost',
          confirm: { title: 'Decline this ride?', message: 'The request goes to another driver.', ok: 'Decline' },
          run: { type: 'decline_offer', offerId: offer.offer_id }
        });
        break;
      }
      case 'trip_step': {
        if (!ride || ride.ride_id !== a.ride_id || ride.status !== a.status) break;
        const step = nextStep(ride);
        if (!step) break;
        out.push({
          key: `step:${step.action}`,
          label: step.label,
          tone: 'go',
          confirm:
            step.action === 'complete'
              ? { title: 'Complete this trip?', message: 'Only complete the trip once the rider has been dropped off.', ok: 'Complete' }
              : { title: `${step.label}?`, message: 'This updates the trip for the rider.', ok: 'Confirm' },
          run: { type: 'trip_step', ride, step }
        });
        break;
      }
      case 'navigate': {
        const target = a.target === 'dropoff' ? 'dropoff' : 'pickup';
        const same = ride && ride.ride_id === a.ride_id;
        const lat = same ? ride[`${target}_lat`] : null;
        const lng = same ? ride[`${target}_lng`] : null;
        const address = (same && ride[`${target}_address`]) || a.address || null;
        if (!address && !(Number.isFinite(lat) && Number.isFinite(lng))) break;
        out.push({
          key: `nav:${target}`,
          label: `Navigate to ${where(target)}`,
          tone: 'ghost',
          confirm: null,
          run: { type: 'navigate', target: { lat, lng, address } }
        });
        break;
      }
      case 'toggle_availability': {
        if (driver.online) {
          out.push({
            key: 'offline',
            label: 'Go offline',
            tone: 'ghost',
            confirm: { title: 'Go offline?', message: "You'll stop receiving ride requests and location sharing stops.", ok: 'Go offline' },
            run: { type: 'go_offline' }
          });
        } else if (readiness.ready) {
          out.push({
            key: 'online',
            label: 'Go online',
            tone: 'go',
            confirm: { title: 'Go online?', message: 'Ride requests near you will be sent to you, and your location is shared while you are online.', ok: 'Go online' },
            run: { type: 'go_online' }
          });
        }
        break;
      }
      case 'open_screen':
        if (['earnings', 'trips', 'account'].includes(a.screen)) {
          out.push({ key: `tab:${a.screen}`, label: a.label || 'Open', tone: 'ghost', confirm: null, run: { type: 'tab', tab: a.screen } });
        }
        break;
      case 'support_handoff': {
        const lost = a.kind === 'lost_item';
        out.push({
          key: lost ? 'handoff-lost' : 'handoff',
          label: lost ? 'Report a found item' : 'Send a request to support',
          tone: 'ghost',
          confirm: null,
          run: { type: 'handoff', kind: lost ? 'lost_item' : 'general' }
        });
        break;
      }
      case 'open_support':
        out.push({ key: 'support', label: 'Contact support', tone: 'ghost', confirm: null, run: { type: 'support' } });
        break;
      case 'call_911':
        out.push({
          key: 'call911',
          label: 'Call 911',
          tone: 'danger',
          confirm: { title: 'Call 911?', message: 'This calls emergency services now.', ok: 'Call 911' },
          run: { type: 'call_911' }
        });
        break;
      case 'safety_alert':
        out.push({
          key: 'safety',
          label: 'Alert Harvey Taxi safety team',
          tone: 'danger',
          confirm: { title: 'Alert the safety team?', message: 'If anyone is in danger, call 911 first.', ok: 'Send alert' },
          run: { type: 'safety_alert', rideId: ride ? ride.ride_id : null }
        });
        break;
      default:
        // open_dashboard and anything unknown: the web dashboard's links
        // have no place in the app.
        break;
    }
  }
  return out;
}

// "Terms of Service — Payments (April 5, 2026)" for an answer's sources.
export function sourceLabel(src) {
  if (!src) return '';
  const date = src.updated ? ` (${src.updated})` : ' (date not stated)';
  return `${src.title || 'Harvey Taxi'}${src.section ? ` — ${src.section}` : ''}${date}`;
}

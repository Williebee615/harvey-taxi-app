// App Review guide for the test (review) driver account only. Text only:
// it never changes what the app does.
//
// How the two review accounts connect (server.js, dispatch isolation): a
// ride requested by the rider review account in Harvey Taxi Mobile is
// offered only to this review driver, and only while it is online. Nothing
// else sends this account offers, so the driver demo needs a request from
// the rider review account.

import { nextStep } from './tripSteps';

export const REVIEW_INTRO =
  'Test account: this is a simulated demonstration. No payment is collected and no real rider or driver is involved.';

export const REVIEW_STEPS = Object.freeze([
  'Go online',
  'In Harvey Taxi Mobile, sign in with the rider review account and request a ride',
  'Accept the test ride offer here',
  'Start driving to pickup (navigation is optional)',
  'Mark arrival, start the trip, then complete it',
  'See the simulated earnings and the trip under Earnings and Trips'
]);

export function reviewNextStep({ online, offers, ride }) {
  if (ride) {
    const step = nextStep(ride);
    return step
      ? `Next step: tap "${step.label}".`
      : 'Next step: follow the trip buttons below.';
  }
  if (offers && offers.length) return 'Next step: tap Accept on the test ride offer.';
  if (!online) return 'Next step: tap Go online below.';
  return 'Next step: in Harvey Taxi Mobile, sign in with the rider review account and request a ride. The offer appears here within a few seconds.';
}

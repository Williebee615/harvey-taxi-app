import { REVIEW_INTRO, REVIEW_STEPS, reviewNextStep } from '../src/reviewGuide';

test('the guide says the demonstration is simulated and lists the driver steps in order', () => {
  expect(REVIEW_INTRO).toMatch(/simulated demonstration/);
  expect(REVIEW_INTRO).toMatch(/No payment is collected/);
  expect(REVIEW_STEPS[0]).toMatch(/Go online/);
  expect(REVIEW_STEPS[REVIEW_STEPS.length - 1]).toMatch(/Earnings and Trips/);
});

test('next step follows the driver through the demonstration', () => {
  expect(reviewNextStep({ online: false, offers: [], ride: null })).toBe('Next step: tap Go online below.');
  expect(reviewNextStep({ online: true, offers: [], ride: null })).toMatch(/rider review account and request a ride/);
  expect(reviewNextStep({ online: true, offers: [{ offer_id: 'O1' }], ride: null })).toMatch(/Accept/);
  expect(reviewNextStep({ online: true, offers: [], ride: { ride_type: 'standard', status: 'driver_assigned' } })).toBe('Next step: tap "Start driving to pickup".');
  expect(reviewNextStep({ online: true, offers: [], ride: { ride_type: 'standard', status: 'driver_enroute' } })).toBe('Next step: tap "I\'ve arrived at pickup".');
  expect(reviewNextStep({ online: true, offers: [], ride: { ride_type: 'standard', status: 'in_progress' } })).toBe('Next step: tap "Complete trip".');
});

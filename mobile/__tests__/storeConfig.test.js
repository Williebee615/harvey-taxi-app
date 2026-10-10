// The rider app must update the existing public App Store listing,
// "Harvey Taxi Mobile" (Apple ID 6761548295, bundle ID com.harveytaxi.app),
// and must never be confused with Harvey Taxi Driver. An App Store Connect
// record's bundle ID can't change, so a build only reaches that listing if
// its bundle ID matches. Key material and Mac-specific paths stay out of
// shared configuration (the key is stored with EAS).
const app = require('../app.json').expo;
const eas = require('../eas.json');
const driverApp = require('../../driver-app/app.json').expo;
const driverEas = require('../../driver-app/eas.json');

test('iOS bundle ID and App Store Connect app match the Harvey Taxi Mobile listing', () => {
  expect(app.ios.bundleIdentifier).toBe('com.harveytaxi.app');
  expect(eas.submit.production.ios.ascAppId).toBe('6761548295');
});

test('kept separate from Harvey Taxi Driver', () => {
  expect(app.ios.bundleIdentifier).not.toBe(driverApp.ios.bundleIdentifier);
  expect(eas.submit.production.ios.ascAppId).not.toBe(driverEas.submit.production.ios.ascAppId);
  expect(app.extra.eas.projectId).not.toBe(driverApp.extra.eas.projectId);
});

test('no key material or Mac-specific paths in shared configuration', () => {
  const text = JSON.stringify(eas);
  expect(text).not.toMatch(/ascApiKeyPath|ascApiKeyId|ascApiKeyIssuerId|\/Users\/|\.p8|PRIVATE KEY/);
});

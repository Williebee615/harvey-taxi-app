// The driver app's store identity must never collide with the rider app's.
const driver = require('../app.json').expo;
const rider = require('../../mobile/app.json').expo;
const eas = require('../eas.json');

test('separate identifiers, scheme, slug and EAS project from Harvey Taxi (rider)', () => {
  expect(driver.name).toBe('Harvey Taxi Driver');
  expect(driver.ios.bundleIdentifier).toBe('com.harveytaxiservice.driver');
  expect(driver.android.package).toBe('com.harveytaxi.driver');
  expect(driver.ios.bundleIdentifier).not.toBe(rider.ios.bundleIdentifier);
  expect(driver.android.package).not.toBe(rider.android.package);
  expect(driver.scheme).not.toBe(rider.scheme);
  expect(driver.slug).not.toBe(rider.slug);
  expect(driver.extra.eas.projectId).not.toBe(rider.extra.eas.projectId);
});

test('location permissions match behaviour: while-in-use only, no Android background location', () => {
  expect(driver.ios.infoPlist.UIBackgroundModes).toEqual(['location']);
  expect(driver.ios.infoPlist.NSLocationAlwaysAndWhenInUseUsageDescription).toBeUndefined();
  expect(driver.android.permissions).not.toContain('ACCESS_BACKGROUND_LOCATION');
  expect(driver.android.blockedPermissions).toContain('android.permission.ACCESS_BACKGROUND_LOCATION');
  const loc = driver.plugins.find((p) => Array.isArray(p) && p[0] === 'expo-location')[1];
  expect(loc).toMatchObject({ isAndroidBackgroundLocationEnabled: false, isAndroidForegroundServiceEnabled: true, isIosBackgroundLocationEnabled: true });
  // Runs first, so its Info.plist edits are applied after the other plugins' (prebuild verified).
  expect(driver.plugins[0]).toBe('./plugins/withDriverLocationPrivacy');
});

test('production builds an Android app bundle; submission goes to a draft internal track', () => {
  expect(eas.build.production.android.buildType).toBe('app-bundle');
  expect(eas.submit.production.android).toEqual({ track: 'internal', releaseStatus: 'draft' });
});

// Extends app.json with values that come from the build environment.
// GOOGLE_SERVICES_JSON: an EAS "file" environment variable holding the
// Firebase google-services.json for com.harveytaxi.driver (needed for push
// on Android). Never committed.
module.exports = ({ config }) => ({
  ...config,
  android: {
    ...config.android,
    ...(process.env.GOOGLE_SERVICES_JSON ? { googleServicesFile: process.env.GOOGLE_SERVICES_JSON } : {})
  }
});

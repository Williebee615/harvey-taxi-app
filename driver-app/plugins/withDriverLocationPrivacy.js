// Keeps the iOS Info.plist matched to what the app actually does:
//   - expo-location always writes "Always" location purpose strings, but
//     this app only ever asks for "While Using" (tracking continues with
//     the screen locked through the location background mode, which iOS
//     allows for updates started in the foreground). Removing the keys
//     makes that verifiable to App Review and impossible to regress.
//   - expo-task-manager adds the "fetch" background mode; the app does
//     not use background fetch.
const { withInfoPlist } = require('expo/config-plugins');

module.exports = function withDriverLocationPrivacy(config) {
  return withInfoPlist(config, (cfg) => {
    delete cfg.modResults.NSLocationAlwaysAndWhenInUseUsageDescription;
    delete cfg.modResults.NSLocationAlwaysUsageDescription;
    const modes = (cfg.modResults.UIBackgroundModes || []).filter((m) => m !== 'fetch');
    cfg.modResults.UIBackgroundModes = modes.includes('location') ? modes : [...modes, 'location'];
    return cfg;
  });
};

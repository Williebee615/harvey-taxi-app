/* Shared rider routing helpers used by rider-signup.html and
   rider-dashboard.html, and exercised directly by lib/riderRouting.test.js.
   Plain UMD-lite export: Node's `require()` sees module.exports; a
   browser <script src="rider-routing.js"> tag (no bundler, no `module`
   global) falls through to attaching window.RiderRouting instead. */
(function (global) {
  var VALID_MODES = ["driver", "food", "grocery", "autonomous", "airport"];
  var DEFAULT_MODE = "driver";

  function normalizeMode(mode) {
    return VALID_MODES.indexOf(mode) !== -1 ? mode : DEFAULT_MODE;
  }

  // Should rider-dashboard.html auto-open the merged ride wizard on load?
  // Yes for a deep link starting a new request (mode) or resuming/
  // tracking an already-active one (ride_id). No for a bare dashboard
  // visit, so returning riders always see the dashboard first.
  function shouldAutoOpenWizard(params) {
    params = params || {};
    return Boolean(params.mode || params.ride_id);
  }

  // Where a rider lands immediately after a successful signup, preserving
  // whichever mode they were originally trying to reach (defaults to a
  // standard driver ride).
  function postSignupDashboardUrl(requestedMode) {
    return "/rider-dashboard.html?mode=" + normalizeMode(requestedMode);
  }

  // Where an unauthenticated rider is sent to sign up / restore their
  // profile from a deep link, so the requested mode survives the round
  // trip and they land back in the wizard once authenticated.
  function signupUrlForMode(requestedMode) {
    return "/rider-signup.html?mode=" + normalizeMode(requestedMode);
  }

  // The mode a rider was trying to reach, read from whatever query
  // string sent them to rider-signup.html (?mode=food, ?mode=grocery, ...).
  function resolveRequestedMode(params) {
    return normalizeMode(params && params.mode);
  }

  var RiderRouting = {
    VALID_MODES: VALID_MODES,
    DEFAULT_MODE: DEFAULT_MODE,
    normalizeMode: normalizeMode,
    shouldAutoOpenWizard: shouldAutoOpenWizard,
    postSignupDashboardUrl: postSignupDashboardUrl,
    signupUrlForMode: signupUrlForMode,
    resolveRequestedMode: resolveRequestedMode
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = RiderRouting;
  } else {
    global.RiderRouting = RiderRouting;
  }
})(typeof window !== "undefined" ? window : globalThis);

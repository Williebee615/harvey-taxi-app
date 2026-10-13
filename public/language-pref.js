/* Harvey Taxi: one language preference for the whole site and rider app.
   Chosen in Settings (or with the selector on any translated page) and
   saved in this browser under "harvey_language". Each page shows the
   saved language when it has a translation for it and English otherwise;
   only an explicit choice changes the saved preference. */
(function () {
  var KEY = "harvey_language";
  // Older pages saved their own choice under these keys.
  var LEGACY_KEYS = ["harvey_settings_language", "harvey_rider_language", "harvey_driver_language"];

  function read(key) {
    try { return localStorage.getItem(key) || ""; } catch (e) { return ""; }
  }

  function saved() {
    var lang = read(KEY);
    for (var i = 0; !lang && i < LEGACY_KEYS.length; i++) lang = read(LEGACY_KEYS[i]);
    return /^[a-z]{2}$/.test(lang) ? lang : "";
  }

  window.HarveyLanguage = {
    KEY: KEY,
    saved: saved,
    // The language this page should show: the saved choice if the page has
    // it, otherwise English; with no saved choice, the browser's language
    // if the page has it.
    resolve: function (supported) {
      var has = function (l) { return !!l && supported.indexOf(l) !== -1; };
      var choice = saved();
      if (choice) return has(choice) ? choice : "en";
      var browser = ((navigator.language || "en").slice(0, 2) || "en").toLowerCase();
      return has(browser) ? browser : "en";
    },
    choose: function (lang) {
      if (!/^[a-z]{2}$/.test(lang || "")) return;
      try { localStorage.setItem(KEY, lang); } catch (e) {}
    }
  };
})();

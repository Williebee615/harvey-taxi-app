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

  // A link from the other site (harveytaxiservice.com <->
  // harveytransportationfoundation.com) can carry the choice as ?lang=xx,
  // because each site keeps its own browser storage.
  try {
    var fromLink = new URLSearchParams(window.location.search).get("lang");
    if (/^[a-z]{2}$/.test(fromLink || "")) localStorage.setItem(KEY, fromLink);
  } catch (e) {}

  var SITES = ["harveytaxiservice.com", "harveytransportationfoundation.com"];
  function siteOf(host) {
    host = String(host || "").toLowerCase().replace(/^www\./, "");
    return SITES.indexOf(host) >= 0 ? host : "";
  }
  // Clicking a link to the other site adds the saved choice to it.
  document.addEventListener("click", function (event) {
    var a = event.target && event.target.closest ? event.target.closest("a[href]") : null;
    var lang = saved();
    if (!a || !lang) return;
    var url;
    try { url = new URL(a.getAttribute("href"), window.location.href); } catch (e) { return; }
    var to = siteOf(url.hostname);
    if (!to || to === siteOf(window.location.hostname) || url.searchParams.has("lang")) return;
    url.searchParams.set("lang", lang);
    a.setAttribute("href", url.toString());
  }, true);

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

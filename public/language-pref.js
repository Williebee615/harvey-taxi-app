/* Harvey Taxi and HTAF: one language preference for the whole site and
   rider app. Chosen in Settings (or with the selector on any translated
   page) and saved in this browser under "harvey_language". Each page shows
   the saved language when it has a translation for it and English
   otherwise; only an explicit choice (or ?lang= on a link) changes the
   saved preference. The language list below is the single source for every
   language selector. */
(function () {
  var KEY = "harvey_language";
  // Older pages saved their own choice under these keys.
  var LEGACY_KEYS = ["harvey_settings_language", "harvey_rider_language", "harvey_driver_language"];
  var CODE = /^[a-z]{2,3}$/;

  // code: the preference value; name: shown in the language itself;
  // english: the English name; html: the page's lang attribute when it
  // differs from code; dir: "rtl" for right-to-left scripts.
  var LANGUAGES = [
    { code: "en", name: "English", english: "English", group: "English" },
    { code: "es", name: "Español", english: "Spanish", group: "Nashville" },
    { code: "ar", name: "العربية", english: "Arabic", group: "Nashville", dir: "rtl" },
    { code: "zh", name: "简体中文", english: "Chinese (Simplified)", group: "Nashville", html: "zh-Hans" },
    { code: "pt", name: "Português (Brasil)", english: "Portuguese (Brazil)", group: "Nashville", html: "pt-BR" },
    { code: "fr", name: "Français", english: "French", group: "Nashville" },
    { code: "hi", name: "हिन्दी", english: "Hindi", group: "Nashville" },
    { code: "ht", name: "Kreyòl Ayisyen", english: "Haitian Creole", group: "Nashville" },
    { code: "sw", name: "Kiswahili", english: "Swahili", group: "Nashville" },
    { code: "yo", name: "Yorùbá", english: "Yoruba", group: "Nigeria" },
    { code: "ha", name: "Hausa", english: "Hausa", group: "Nigeria" },
    { code: "ig", name: "Igbo", english: "Igbo", group: "Nigeria" },
    { code: "sn", name: "chiShona", english: "Shona", group: "Zimbabwe" },
    { code: "nd", name: "isiNdebele", english: "Ndebele (Zimbabwe)", group: "Zimbabwe" },
    { code: "ak", name: "Twi", english: "Twi (Akan)", group: "Ghana" }
    // Ga and Ewe (Ghana) and isiZulu, isiXhosa and Afrikaans (South Africa)
    // are not offered yet: add them with reviewed translations.
  ];
  var GROUPS = {
    English: "English",
    Nashville: "Spoken in Nashville",
    Nigeria: "Nigeria",
    Zimbabwe: "Zimbabwe",
    Ghana: "Ghana"
  };
  var BY_CODE = {};
  LANGUAGES.forEach(function (l) { BY_CODE[l.code] = l; });

  function read(key) {
    try { return localStorage.getItem(key) || ""; } catch (e) { return ""; }
  }

  function valid(lang) { return CODE.test(lang || ""); }

  function saved() {
    var lang = read(KEY);
    for (var i = 0; !lang && i < LEGACY_KEYS.length; i++) lang = read(LEGACY_KEYS[i]);
    return valid(lang) ? lang : "";
  }

  // A link from the other site (harveytaxiservice.com <->
  // harveytransportationfoundation.com) can carry the choice as ?lang=xx,
  // because each site keeps its own browser storage.
  try {
    var fromLink = new URLSearchParams(window.location.search).get("lang");
    if (valid(fromLink)) localStorage.setItem(KEY, fromLink);
  } catch (e) {}

  var SITES = ["harveytaxiservice.com", "harveytransportationfoundation.com"];
  function siteOf(host) {
    host = String(host || "").toLowerCase().replace(/^www\./, "");
    return SITES.indexOf(host) >= 0 ? host : "";
  }
  // Clicking a link to the other site sets lang= to the saved choice,
  // keeping the link's other parameters and its #anchor.
  document.addEventListener("click", function (event) {
    var a = event.target && event.target.closest ? event.target.closest("a[href]") : null;
    var lang = saved();
    if (!a || !lang) return;
    var url;
    try { url = new URL(a.getAttribute("href"), window.location.href); } catch (e) { return; }
    var to = siteOf(url.hostname);
    if (!to || to === siteOf(window.location.hostname)) return;
    url.searchParams.set("lang", lang);
    a.setAttribute("href", url.toString());
  }, true);

  window.HarveyLanguage = {
    KEY: KEY,
    languages: LANGUAGES,
    saved: saved,
    // The language this page should show: the saved choice if the page has
    // it, otherwise English; with no saved choice, the browser's language
    // if the page has it.
    resolve: function (supported) {
      var has = function (l) { return !!l && supported.indexOf(l) !== -1; };
      var choice = saved();
      if (choice) return has(choice) ? choice : "en";
      var browser = String(navigator.language || "en").toLowerCase().split("-")[0];
      return has(browser) ? browser : "en";
    },
    choose: function (lang) {
      if (!valid(lang)) return;
      try { localStorage.setItem(KEY, lang); } catch (e) {}
    },
    htmlLang: function (code) { return (BY_CODE[code] && BY_CODE[code].html) || code; },
    dir: function (code) { return (BY_CODE[code] && BY_CODE[code].dir) || "ltr"; },
    // Fills a <select> with every language, grouped by region, names in
    // their own language (marked so page translation leaves them alone).
    fillSelect: function (select) {
      if (!select) return;
      while (select.firstChild) select.removeChild(select.firstChild);
      var groups = {};
      LANGUAGES.forEach(function (l) {
        if (!groups[l.group]) {
          groups[l.group] = document.createElement("optgroup");
          groups[l.group].label = GROUPS[l.group];
          select.appendChild(groups[l.group]);
        }
        var o = document.createElement("option");
        o.value = l.code;
        o.textContent = l.name;
        o.lang = l.html || l.code;
        o.title = l.english;
        groups[l.group].appendChild(o);
      });
      select.setAttribute("data-no-translate", "");
    }
  };
})();

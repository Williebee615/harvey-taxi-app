/* HTAF pages in the visitor's language (home, application, contact).
   Uses the one language preference shared with Harvey Taxi
   (/language-pref.js) and the strings in /htaf-translations.js, keyed by
   the page's own English text. English is the source and the fallback:
   text without a translation stays English. Anything inside
   [data-no-translate] (consent statements, legal links) always stays
   English. A <select data-htaf-lang> on the page lets the visitor choose. */
(function () {
  var DATA = window.HTAF_TRANSLATIONS || { langs: [], t: {} };
  var LANGS = ["en"].concat(DATA.langs);
  var NAMES = {
    en: "English", es: "Español", fr: "Français", ar: "العربية", sw: "Kiswahili",
    zh: "中文", hi: "हिन्दी", pt: "Português", ht: "Kreyòl Ayisyen", yo: "Yorùbá"
  };
  var SKIP = "script,style,noscript,[data-no-translate],#htaPanel,.hta-root";
  var current = "en";
  var applying = false;
  var observer = null;

  function norm(s) { return String(s).replace(/\s+/g, " ").trim(); }

  // Translation of one English string in the current language, or the
  // English itself.
  function t(english) {
    if (current === "en") return english;
    var row = DATA.t[norm(english)];
    var i = DATA.langs.indexOf(current);
    return row && i >= 0 && row[i] ? row[i] : english;
  }

  function translateTextNode(node) {
    if (node.__htafEn === undefined) node.__htafEn = node.textContent;
    var en = node.__htafEn;
    var key = norm(en);
    if (!key) return;
    var out = current === "en" ? en : t(key);
    if (out === key) out = en;
    else if (current !== "en") out = (en.match(/^\s*/)[0]) + out + (en.match(/\s*$/)[0]);
    if (node.textContent !== out) node.textContent = out;
  }

  function translateAttr(el, attr) {
    var store = "htafEn" + attr.replace(/[^a-z]/gi, "");
    if (el.dataset[store] === undefined) el.dataset[store] = el.getAttribute(attr);
    var en = el.dataset[store];
    var out = current === "en" ? en : t(en);
    if (el.getAttribute(attr) !== out) el.setAttribute(attr, out);
  }

  function translateTree(root) {
    if (!root || (root.nodeType === 1 && root.closest(SKIP))) return;
    if (root.nodeType === 3) {
      if (!root.parentElement || !root.parentElement.closest(SKIP)) translateTextNode(root);
      return;
    }
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        return n.parentElement && !n.parentElement.closest(SKIP) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      }
    });
    var n;
    while ((n = walker.nextNode())) translateTextNode(n);
    var els = root.querySelectorAll ? root.querySelectorAll("[placeholder],[aria-label]") : [];
    for (var i = 0; i < els.length; i++) {
      if (els[i].closest(SKIP)) continue;
      if (els[i].hasAttribute("placeholder")) translateAttr(els[i], "placeholder");
      if (els[i].hasAttribute("aria-label")) translateAttr(els[i], "aria-label");
    }
  }

  function apply(lang) {
    current = LANGS.indexOf(lang) >= 0 ? lang : "en";
    applying = true;
    try {
      document.documentElement.lang = current;
      document.documentElement.dir = current === "ar" ? "rtl" : "ltr";
      translateTree(document.body);
      var sels = document.querySelectorAll("select[data-htaf-lang]");
      for (var i = 0; i < sels.length; i++) sels[i].value = current;
    } finally {
      // Drop the change records our own edits just produced.
      if (observer) observer.takeRecords();
      applying = false;
    }
  }

  function buildSelectors() {
    var sels = document.querySelectorAll("select[data-htaf-lang]");
    for (var i = 0; i < sels.length; i++) {
      var sel = sels[i];
      if (!sel.options.length) {
        LANGS.forEach(function (code) {
          var o = document.createElement("option");
          o.value = code;
          o.textContent = NAMES[code];
          o.setAttribute("lang", code);
          sel.appendChild(o);
        });
        // Language names are shown in their own language, never translated.
        sel.setAttribute("data-no-translate", "");
      }
      sel.addEventListener("change", function (e) {
        if (window.HarveyLanguage) window.HarveyLanguage.choose(e.target.value);
        apply(e.target.value);
      });
    }
  }

  function start() {
    buildSelectors();
    var lang = window.HarveyLanguage ? window.HarveyLanguage.resolve(LANGS) : "en";
    apply(lang);
    // Text the page writes later (status messages, form errors, totals).
    observer = new MutationObserver(function (records) {
      if (applying || current === "en") return;
      applying = true;
      try {
        records.forEach(function (r) {
          if (r.type === "characterData") {
            r.target.__htafEn = r.target.textContent;
            translateTextNode(r.target);
          } else {
            r.addedNodes.forEach(function (n) {
              if (n.nodeType === 3) n.__htafEn = n.textContent;
              translateTree(n);
            });
          }
        });
      } finally {
        observer.takeRecords();
        applying = false;
      }
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  window.HTAF_T = t;
  window.HTAF_LANG = function () { return current; };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();

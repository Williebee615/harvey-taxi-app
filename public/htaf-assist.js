/* HTAF Information Assistant widget (Harvey Transportation Assistance Foundation).
 *
 * Separate from Harvey Taxi's assistant: talks only to /api/htaf/assist,
 * which answers from HTAF's published pages. Renders nothing unless the
 * server reports it enabled. Keeps the conversation in this page only
 * (no storage, nothing kept after the page closes). All text is inserted
 * as text, never as HTML; links are limited to this site, email and phone.
 */
(function () {
  "use strict";

  var API = (window.HARVEY_API_BASE || "") + "/api/htaf/assist";
  var NOTE =
    "Automated answers using HTAF's approved, published information only (not an AI model). It can't see applications, book rides, send texts or make decisions. Please don't share personal, medical or financial details here.";

  function el(tag, attrs, text) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      node.setAttribute(k, attrs[k]);
    });
    if (text) node.textContent = text;
    return node;
  }

  function safeHref(href) {
    return typeof href === "string" && (/^\/(?!\/)/.test(href) || /^mailto:/.test(href) || /^tel:/.test(href)) ? href : null;
  }

  function injectStyles() {
    var css =
      ".htaf-assist-btn{position:fixed;right:16px;bottom:calc(var(--navH,0px) + 16px + env(safe-area-inset-bottom));z-index:1000;border:1px solid rgba(110,231,249,.5);background:#0b1730;color:#e7f6ff;border-radius:999px;padding:12px 16px;font:700 15px/1.2 system-ui,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.35);cursor:pointer}" +
      ".htaf-assist-panel{position:fixed;right:16px;bottom:calc(var(--navH,0px) + 76px + env(safe-area-inset-bottom));z-index:1001;width:min(380px,calc(100vw - 32px));max-height:min(560px,calc(100vh - 160px));display:flex;flex-direction:column;background:#0b1730;color:#e7f6ff;border:1px solid rgba(110,231,249,.35);border-radius:16px;box-shadow:0 12px 32px rgba(0,0,0,.45);font:15px/1.45 system-ui,sans-serif}" +
      ".htaf-assist-panel[hidden]{display:none}" +
      ".htaf-assist-head{display:flex;justify-content:space-between;align-items:center;padding:12px 14px;border-bottom:1px solid rgba(255,255,255,.08)}" +
      ".htaf-assist-head strong{font-size:16px}" +
      ".htaf-assist-close{background:none;border:0;color:#e7f6ff;font-size:22px;line-height:1;cursor:pointer;padding:4px 8px}" +
      ".htaf-assist-note{margin:0;padding:8px 14px;font-size:13px;color:#a9bdd6;border-bottom:1px solid rgba(255,255,255,.06)}" +
      ".htaf-assist-log{flex:1;overflow-y:auto;padding:10px 14px;display:flex;flex-direction:column;gap:8px}" +
      ".htaf-assist-msg{padding:8px 10px;border-radius:12px;max-width:92%;white-space:pre-wrap;word-wrap:break-word}" +
      ".htaf-assist-msg.user{align-self:flex-end;background:#16406b}" +
      ".htaf-assist-msg.bot{align-self:flex-start;background:#13223f}" +
      ".htaf-assist-src{display:block;margin-top:6px;font-size:12px;color:#a9bdd6}" +
      ".htaf-assist-actions{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}" +
      ".htaf-assist-actions a{color:#6ee7f9;font-size:13px;text-decoration:underline}" +
      ".htaf-assist-form{display:flex;gap:8px;padding:10px 14px;border-top:1px solid rgba(255,255,255,.08)}" +
      ".htaf-assist-form input{flex:1;min-width:0;border-radius:10px;border:1px solid rgba(255,255,255,.2);background:#06101f;color:#e7f6ff;padding:10px;font:15px system-ui,sans-serif}" +
      ".htaf-assist-form button{border-radius:10px;border:0;background:#6ee7f9;color:#06101f;font-weight:800;padding:0 14px;cursor:pointer}" +
      ".htaf-assist-form button:disabled{opacity:.6;cursor:default}";
    var style = el("style", { "data-htaf-assist": "" });
    style.textContent = css;
    document.head.appendChild(style);
  }

  function addMessage(log, text, who, extra) {
    var msg = el("div", { class: "htaf-assist-msg " + who, "data-testid": "htaf-assist-" + who });
    msg.textContent = text;
    if (extra && extra.sources && extra.sources.length) {
      var s = extra.sources[0];
      msg.appendChild(el("span", { class: "htaf-assist-src" }, "Source: " + s.title + (s.section ? " — " + s.section : "")));
    }
    if (extra && extra.actions && extra.actions.length) {
      var row = el("div", { class: "htaf-assist-actions" });
      extra.actions.forEach(function (a) {
        var href = safeHref(a.href);
        if (!href || !a.label) return;
        row.appendChild(el("a", { href: href }, a.label));
      });
      if (row.childNodes.length) msg.appendChild(row);
    }
    log.appendChild(msg);
    log.scrollTop = log.scrollHeight;
  }

  function build() {
    injectStyles();
    var button = el("button", { type: "button", class: "htaf-assist-btn", "aria-expanded": "false", "aria-controls": "htafAssistPanel", "data-testid": "htaf-assist-open" }, "Ask HTAF");
    var panel = el("section", { id: "htafAssistPanel", class: "htaf-assist-panel", role: "dialog", "aria-label": "HTAF Information Assistant", hidden: "" });
    var head = el("div", { class: "htaf-assist-head" });
    head.appendChild(el("strong", {}, "HTAF Information Assistant"));
    var close = el("button", { type: "button", class: "htaf-assist-close", "aria-label": "Close" }, "×");
    head.appendChild(close);
    var note = el("p", { class: "htaf-assist-note" }, NOTE);
    var log = el("div", { class: "htaf-assist-log", "aria-live": "polite" });
    var form = el("form", { class: "htaf-assist-form" });
    var input = el("input", { type: "text", maxlength: "500", "aria-label": "Your question", placeholder: "Ask about programs, eligibility, applying…", "data-testid": "htaf-assist-input" });
    var send = el("button", { type: "submit", "data-testid": "htaf-assist-send" }, "Send");
    form.appendChild(input);
    form.appendChild(send);
    panel.appendChild(head);
    panel.appendChild(note);
    panel.appendChild(log);
    panel.appendChild(form);
    document.body.appendChild(button);
    document.body.appendChild(panel);

    var greeted = false;
    function toggle(open) {
      panel.hidden = !open;
      button.setAttribute("aria-expanded", open ? "true" : "false");
      if (open) {
        if (!greeted) {
          greeted = true;
          addMessage(log, "Hi! I can explain HTAF's transportation-assistance programs, who can apply, how to apply, documents and how to contact HTAF.", "bot");
        }
        input.focus();
      }
    }
    button.addEventListener("click", function () {
      toggle(panel.hidden);
    });
    close.addEventListener("click", function () {
      toggle(false);
      button.focus();
    });

    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var question = input.value.trim();
      if (!question) return;
      addMessage(log, question, "user");
      input.value = "";
      send.disabled = true;
      fetch(API, { method: "POST", credentials: "omit", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ message: question }) })
        .then(function (r) {
          return r.json().catch(function () {
            return {};
          });
        })
        .then(function (body) {
          addMessage(log, body.reply || "Something went wrong. Please try again, or contact HTAF.", "bot", body);
        })
        .catch(function () {
          addMessage(log, "I couldn't reach HTAF just now. Please check your connection and try again.", "bot", {
            actions: [{ label: "Contact HTAF", href: "/contact.html" }]
          });
        })
        .then(function () {
          send.disabled = false;
          input.focus();
        });
    });
  }

  function start() {
    fetch(API + "/status", { credentials: "omit", headers: { Accept: "application/json" } })
      .then(function (r) {
        return r.json();
      })
      .then(function (body) {
        if (body && body.assist_available === true) build();
      })
      .catch(function () {
        /* Not available: render nothing. */
      });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();

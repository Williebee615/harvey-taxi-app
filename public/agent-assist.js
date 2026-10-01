/* Harvey Taxi Assistant (AI Agent Manager, docs/ai-agent-manager.md).
 *
 * Self-contained widget for the rider and driver dashboards. It renders
 * nothing unless GET /api/agent/status reports the assistant is enabled,
 * so it is inert while the agent_assist_enabled flag is off. It never
 * changes a ride itself: proposed actions open the existing booking or
 * tracking screen, and a cancellation calls the existing, separately
 * authenticated cancel route only after the rider confirms.
 *
 * Usage: <script src="/agent-assist.js" data-role="rider" defer></script>
 *        <script src="/agent-assist.js" data-role="driver" data-token-key="harvey_driver_token" defer></script>
 */
(function () {
  "use strict";
  var script = document.currentScript;
  var role = script && script.dataset.role === "driver" ? "driver" : "rider";
  var tokenKey = script && script.dataset.tokenKey;
  if (window.__harveyAgentAssist) return;
  window.__harveyAgentAssist = true;

  function driverToken() {
    try { return tokenKey ? localStorage.getItem(tokenKey) || "" : ""; } catch (e) { return ""; }
  }

  function headers() {
    var h = { "Content-Type": "application/json", Accept: "application/json", "x-requested-with": "harvey-rider-app" };
    var t = role === "driver" ? driverToken() : "";
    if (t) h["x-driver-token"] = t;
    return h;
  }

  function el(tag, attrs, text) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) { node.setAttribute(k, attrs[k]); });
    if (text) node.textContent = text;
    return node;
  }

  var css =
    ".hta-btn{position:fixed;left:16px;bottom:calc(88px + env(safe-area-inset-bottom,0px));z-index:9998;border:0;border-radius:999px;padding:12px 16px;background:#1d4ed8;color:#fff;font:600 14px/1 Inter,Arial,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.35);cursor:pointer}" +
    ".hta-panel{position:fixed;left:16px;right:16px;bottom:calc(140px + env(safe-area-inset-bottom,0px));max-width:380px;max-height:min(70vh,calc(100vh - 170px));z-index:9999;display:none;flex-direction:column;background:#0d1630;color:#f4f7ff;border:1px solid rgba(122,162,255,.25);border-radius:16px;font:14px/1.45 Inter,Arial,sans-serif;box-shadow:0 20px 50px rgba(0,0,0,.45)}" +
    ".hta-panel.open{display:flex}" +
    ".hta-head,.hta-911,.hta-form{flex-shrink:0}" +
    ".hta-head{display:flex;justify-content:space-between;align-items:center;padding:12px 14px;border-bottom:1px solid rgba(122,162,255,.18)}" +
    ".hta-911{margin:10px 14px 4px;padding:8px 10px;border-radius:10px;background:#2e1019;border:1px solid rgba(255,126,151,.4);font-size:12.5px}" +
    ".hta-911 a{color:#ff9bb0;font-weight:700}" +
    ".hta-log{flex:1 1 auto;min-height:0;overflow-y:auto;padding:10px 14px;display:flex;flex-direction:column;gap:8px}" +
    ".hta-msg{padding:8px 10px;border-radius:12px;max-width:90%;white-space:pre-wrap}" +
    ".hta-me{align-self:flex-end;background:#1d4ed8}.hta-bot{align-self:flex-start;background:#16244a}" +
    ".hta-bot.hta-urgent{background:#4a1220;border:1px solid #ff7e97}" +
    ".hta-actions{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}" +
    ".hta-actions a,.hta-actions button{border:1px solid rgba(122,162,255,.35);background:#0a1228;color:#f4f7ff;border-radius:10px;padding:6px 10px;font:600 13px Inter,Arial,sans-serif;text-decoration:none;cursor:pointer}" +
    ".hta-actions .hta-danger{background:#5a1426;border-color:#ff7e97}" +
    ".hta-form{display:flex;gap:6px;padding:10px 14px;border-top:1px solid rgba(122,162,255,.18)}" +
    ".hta-form input{flex:1;min-width:0;background:#0a1228;color:#f4f7ff;border:1px solid rgba(122,162,255,.25);border-radius:10px;padding:8px 10px;font:inherit}" +
    ".hta-form button,.hta-close{background:#1d4ed8;color:#fff;border:0;border-radius:10px;padding:8px 12px;font:inherit;cursor:pointer}" +
    ".hta-close{background:transparent;font-size:18px;padding:2px 8px}" +
    ".hta-src{font-size:11px;color:#aab8de;margin-top:4px}";

  function mount() {
    var style = el("style");
    style.textContent = css;
    document.head.appendChild(style);

    var btn = el("button", { type: "button", class: "hta-btn", "aria-expanded": "false", "aria-controls": "htaPanel" }, "Harvey Assistant");
    var panel = el("section", { id: "htaPanel", class: "hta-panel", role: "dialog", "aria-label": "Harvey Assistant" });
    var head = el("div", { class: "hta-head" });
    head.appendChild(el("strong", {}, "Harvey Assistant"));
    var close = el("button", { type: "button", class: "hta-close", "aria-label": "Close assistant" }, "×");
    head.appendChild(close);
    var banner = el("div", { class: "hta-911" });
    banner.appendChild(document.createTextNode("Emergency? "));
    banner.appendChild(el("a", { href: "tel:911" }, "Call 911"));
    banner.appendChild(document.createTextNode(" first. This assistant cannot send help."));
    var log = el("div", { class: "hta-log", "aria-live": "polite" });
    var form = el("form", { class: "hta-form" });
    var input = el("input", { type: "text", maxlength: "1000", placeholder: role === "driver" ? "Ask about offers, your trip or earnings" : "Ask about booking, your ride or fares", "aria-label": "Message" });
    var send = el("button", { type: "submit" }, "Send");
    form.appendChild(input);
    form.appendChild(send);
    panel.appendChild(head);
    panel.appendChild(banner);
    panel.appendChild(log);
    panel.appendChild(form);
    document.body.appendChild(panel);
    document.body.appendChild(btn);

    function toggle(open) {
      panel.classList.toggle("open", open);
      btn.setAttribute("aria-expanded", String(open));
      if (open) input.focus();
    }
    btn.addEventListener("click", function () { toggle(!panel.classList.contains("open")); });
    close.addEventListener("click", function () { toggle(false); });

    function addMessage(text, who, extra) {
      var m = el("div", { class: "hta-msg " + (who === "me" ? "hta-me" : "hta-bot") + (extra && extra.urgent ? " hta-urgent" : "") }, text);
      if (extra && extra.actions && extra.actions.length) {
        var row = el("div", { class: "hta-actions" });
        extra.actions.forEach(function (a) { row.appendChild(renderAction(a)); });
        m.appendChild(row);
      }
      if (extra && extra.caseId) m.appendChild(el("div", { class: "hta-src" }, "Reference: " + extra.caseId));
      log.appendChild(m);
      log.scrollTop = log.scrollHeight;
    }

    function safeHref(href) {
      // Only same-origin paths or tel:911 -- never an arbitrary URL.
      return /^\/[A-Za-z0-9._\-/?=&%]*$/.test(href) || href === "tel:911" ? href : null;
    }

    function renderAction(a) {
      if (a.href && safeHref(a.href)) {
        var link = el("a", { href: safeHref(a.href) }, a.label || "Open");
        if (a.type === "call_911") link.className = "hta-danger";
        return link;
      }
      var b = el("button", { type: "button" }, a.label || "Continue");
      if (a.type === "cancel_ride" && /^\/api\/rides\/[^/]+\/cancel$/.test(a.endpoint || "")) {
        b.className = "hta-danger";
        b.addEventListener("click", function () {
          if (!window.confirm(a.confirm_text || "Cancel this ride?")) return;
          b.disabled = true;
          fetch(a.endpoint, { method: "POST", credentials: "same-origin", headers: headers(), body: JSON.stringify({ reason: "Rider cancelled via assistant" }) })
            .then(function (r) { return r.json().then(function (body) { return { ok: r.ok, body: body }; }); })
            .then(function (res) { addMessage(res.ok ? "Your ride was cancelled." : (res.body && (res.body.error || res.body.message)) || "The ride could not be cancelled.", "bot"); })
            .catch(function () { addMessage("The ride could not be cancelled. Please try from your dashboard.", "bot"); });
        });
      } else if (a.type === "safety_alert" && a.endpoint === "/api/safety/911") {
        b.className = "hta-danger";
        b.addEventListener("click", function () {
          if (!window.confirm("Alert the Harvey Taxi safety team about your ride? If anyone is in danger, call 911 first.")) return;
          b.disabled = true;
          var params = new URLSearchParams(window.location.search);
          fetch(a.endpoint, { method: "POST", credentials: "same-origin", headers: headers(), body: JSON.stringify({ ride_id: params.get("ride_id") || null, message: "Raised from Harvey Assistant" }) })
            .then(function (r) { addMessage(r.ok ? "The safety team has been alerted. If anyone is in danger, call 911." : "The alert could not be sent. Call 911 if anyone is in danger.", "bot", { urgent: true }); })
            .catch(function () { addMessage("The alert could not be sent. Call 911 if anyone is in danger.", "bot", { urgent: true }); });
        });
      } else {
        b.disabled = true;
      }
      return b;
    }

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var text = input.value.trim();
      if (!text) return;
      input.value = "";
      addMessage(text, "me");
      send.disabled = true;
      fetch("/api/agent/" + role + "/assist", { method: "POST", credentials: "same-origin", headers: headers(), body: JSON.stringify({ message: text }) })
        .then(function (r) { return r.json().catch(function () { return {}; }); })
        .then(function (body) {
          addMessage(body.reply || "The assistant is unavailable. Booking and your dashboard still work. In an emergency, call 911.", "bot", {
            urgent: body.escalation && body.escalation.category === "emergency",
            actions: body.actions || [],
            caseId: body.case_id
          });
        })
        .catch(function () {
          addMessage("The assistant is unavailable. Booking and your dashboard still work. In an emergency, call 911.", "bot");
        })
        .then(function () { send.disabled = false; });
    });

    addMessage(role === "driver"
      ? "Hi! I can check your ride offers, your active trip's next step, or your earnings. You stay in control of every offer and trip action."
      : "Hi! I can help you book, check your ride, explain your fare or cancel an open ride. You confirm every change.", "bot");
  }

  fetch("/api/agent/status", { credentials: "same-origin", headers: { Accept: "application/json" } })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (body) {
      if (!body || !body.assist_available) return;
      if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
      else mount();
    })
    .catch(function () { /* assistant unavailable: render nothing */ });
})();

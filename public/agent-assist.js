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

  // Layout. Desktop: a panel above the launcher. Phones (<600px): a sheet
  // that fills the visible viewport -- sized from window.visualViewport,
  // so an open keyboard shrinks the sheet instead of covering the input.
  // The 911 banner is a fixed row outside the scrolling message list. The
  // launcher sits above any bottom navigation bar (measured, see
  // bottomInset()) and is hidden while the assistant is open or the
  // keyboard is up.
  var css =
    ".hta-btn{position:fixed;left:16px;bottom:var(--hta-bottom,16px);z-index:9998;border:0;border-radius:999px;padding:12px 16px;background:#1d4ed8;color:#fff;font:600 14px/1 Inter,Arial,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.35);cursor:pointer}" +
    ".hta-btn[hidden]{display:none}" +
    ".hta-panel{position:fixed;left:16px;bottom:var(--hta-bottom,16px);width:380px;max-width:calc(100vw - 32px);height:min(560px,calc(var(--hta-vh,100vh) - var(--hta-bottom,16px) - 32px));z-index:9999;display:none;flex-direction:column;overflow:hidden;background:#0d1630;color:#f4f7ff;border:1px solid rgba(122,162,255,.25);border-radius:16px;font:14px/1.45 Inter,Arial,sans-serif;box-shadow:0 20px 50px rgba(0,0,0,.45)}" +
    ".hta-panel.open{display:flex}" +
    "@media (max-width:599px){.hta-panel{left:8px;right:8px;width:auto;max-width:none;top:calc(var(--hta-top,0px) + 8px + env(safe-area-inset-top,0px));bottom:auto;height:calc(var(--hta-vh,100vh) - 16px - env(safe-area-inset-top,0px));border-radius:14px}}" +
    ".hta-head,.hta-911,.hta-form{flex:0 0 auto}" +
    ".hta-head{display:flex;justify-content:space-between;align-items:center;padding:12px 14px;border-bottom:1px solid rgba(122,162,255,.18)}" +
    ".hta-911{margin:10px 14px;padding:8px 10px;border-radius:10px;background:#2e1019;border:1px solid rgba(255,126,151,.4);font-size:12.5px}" +
    ".hta-911 a{color:#ff9bb0;font-weight:700}" +
    ".hta-log{flex:1 1 auto;min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:4px 14px 12px;display:flex;flex-direction:column;gap:8px;border-top:1px solid rgba(122,162,255,.12)}" +
    ".hta-msg{padding:8px 10px;border-radius:12px;max-width:90%;white-space:pre-wrap;flex:0 0 auto}" +
    ".hta-me{align-self:flex-end;background:#1d4ed8}.hta-bot{align-self:flex-start;background:#16244a}" +
    ".hta-bot.hta-urgent{background:#4a1220;border:1px solid #ff7e97}" +
    ".hta-actions{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}" +
    ".hta-actions a,.hta-actions button{border:1px solid rgba(122,162,255,.35);background:#0a1228;color:#f4f7ff;border-radius:10px;padding:8px 10px;min-height:36px;font:600 13px Inter,Arial,sans-serif;text-decoration:none;cursor:pointer}" +
    ".hta-actions .hta-danger{background:#5a1426;border-color:#ff7e97}" +
    ".hta-form{display:flex;gap:6px;padding:10px 14px calc(10px + env(safe-area-inset-bottom,0px));border-top:1px solid rgba(122,162,255,.18)}" +
    ".hta-form input{flex:1;min-width:0;background:#0a1228;color:#f4f7ff;border:1px solid rgba(122,162,255,.25);border-radius:10px;padding:10px;font:16px Inter,Arial,sans-serif}" +
    ".hta-form button,.hta-close{background:#1d4ed8;color:#fff;border:0;border-radius:10px;padding:8px 14px;font:inherit;cursor:pointer;min-height:40px}" +
    ".hta-close{background:transparent;font-size:20px;padding:2px 10px;min-width:40px}" +
    ".hta-src{font-size:11px;color:#aab8de;margin-top:4px}";

  // Height of anything fixed to the bottom of the screen (a page's bottom
  // navigation), so the launcher sits above it rather than on top of it.
  function bottomInset(ignore) {
    var vh = window.innerHeight;
    var inset = 0;
    var nodes = document.body.querySelectorAll("nav, footer, [class*=bottom], [class*=tab-bar], [class*=tabbar], [id*=bottom]");
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      if (ignore && ignore.indexOf(node) >= 0) continue;
      var cs = window.getComputedStyle(node);
      if (cs.position !== "fixed" && cs.position !== "sticky") continue;
      if (cs.display === "none" || cs.visibility === "hidden") continue;
      var r = node.getBoundingClientRect();
      if (r.height <= 0 || r.height > vh * 0.4 || r.width < window.innerWidth * 0.5) continue;
      if (Math.abs(r.bottom - vh) <= 2) inset = Math.max(inset, r.height);
    }
    return inset;
  }

  function mount() {
    var style = el("style");
    style.textContent = css;
    document.head.appendChild(style);

    var btn = el("button", { type: "button", class: "hta-btn", "aria-expanded": "false", "aria-controls": "htaPanel", "data-testid": "hta-launcher" }, "Harvey Assistant");
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
    var root = document.documentElement;
    var keyboardOpen = false;

    function layout() {
      var vv = window.visualViewport;
      var visible = vv ? vv.height : window.innerHeight;
      // A visible viewport much shorter than the layout viewport means the
      // on-screen keyboard is up.
      keyboardOpen = Boolean(vv) && window.innerHeight - visible > 120;
      root.style.setProperty("--hta-vh", visible + "px");
      root.style.setProperty("--hta-top", (vv ? vv.offsetTop : 0) + "px");
      root.style.setProperty("--hta-bottom", "calc(" + (bottomInset([panel, btn]) + 16) + "px + env(safe-area-inset-bottom, 0px))");
      btn.hidden = panel.classList.contains("open") || keyboardOpen;
    }

    function toggle(open) {
      panel.classList.toggle("open", open);
      btn.setAttribute("aria-expanded", String(open));
      layout();
      if (open) input.focus();
      else btn.focus();
    }
    layout();
    window.addEventListener("resize", layout);
    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", layout);
      window.visualViewport.addEventListener("scroll", layout);
    }
    // Pages change their bottom bars as screens open and close.
    setInterval(layout, 1500);
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && panel.classList.contains("open")) toggle(false);
    });
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
          // The server attaches the alert to the ride only if this caller is
          // on it: the rider's session or the ride's tracking token (rider
          // page), or the assigned driver's session (driver dashboard).
          var params = new URLSearchParams(window.location.search);
          var rideId = params.get("ride_id") || null;
          var alertHeaders = headers();
          var tracking = window.HarveyRideTracking;
          var trackingToken = rideId && tracking && typeof tracking.get === "function" ? tracking.get(rideId) : "";
          if (trackingToken) alertHeaders["x-ride-tracking-token"] = trackingToken;
          fetch(a.endpoint, { method: "POST", credentials: "same-origin", headers: alertHeaders, body: JSON.stringify({ ride_id: rideId, message: "Raised from Harvey Assistant" }) })
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

(function () {
  const root = document.getElementById("harvey-ai-chat-root");
  if (!root) return;

  const STORAGE_KEY = "harvey_ai_chat_state_v1";
  const PAGE_CONTEXT = detectPageContext();
  const API_ENDPOINT = "/api/ai/support";

  const state = {
    isOpen: false,
    isLoading: false,
    messages: loadMessages(),
    riderId: readContextValue("rider_id"),
    driverId: readContextValue("driver_id"),
    rideId: readContextValue("ride_id")
  };

  function detectPageContext() {
    const path = (window.location.pathname || "").toLowerCase();

    if (path.includes("rider-signup")) return "rider_signup";
    if (path.includes("driver-signup")) return "driver_signup";
    if (path.includes("request-ride")) return "request_ride";
    if (path.includes("driver-dashboard")) return "driver_dashboard";
    if (path.includes("admin")) return "admin_dashboard";
    if (path.includes("support")) return "support_center";
    if (path.includes("privacy")) return "privacy_policy";
    if (path.includes("terms")) return "terms_of_service";
    return "homepage";
  }

  function readContextValue(name) {
    try {
      const fromQuery = new URLSearchParams(window.location.search).get(name);
      if (fromQuery) return fromQuery;

      const fromSession = sessionStorage.getItem(name);
      if (fromSession) return fromSession;

      const fromLocal = localStorage.getItem(name);
      if (fromLocal) return fromLocal;

      return null;
    } catch (error) {
      return null;
    }
  }

  function loadMessages() {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return getWelcomeMessages();
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) && parsed.length ? parsed : getWelcomeMessages();
    } catch (error) {
      return getWelcomeMessages();
    }
  }

  function saveMessages() {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state.messages.slice(-30)));
    } catch (error) {
      // ignore storage issues
    }
  }

  function getWelcomeMessages() {
    const welcomeText = getWelcomeTextByPage(PAGE_CONTEXT);

    return [
      {
        role: "assistant",
        text: welcomeText,
        meta: "Harvey AI Support"
      }
    ];
  }

  function getWelcomeTextByPage(pageContext) {
    const messages = {
      homepage:
        "Welcome to Harvey AI Support. I can help with rides, rider signup, driver onboarding, support questions, Harvey Taxi Service LLC, the nonprofit mission, and the autonomous pilot plan.",
      rider_signup:
        "Welcome to Harvey AI Support. I can help explain rider signup, approval flow, verification, and what happens before ride access is granted.",
      driver_signup:
        "Welcome to Harvey AI Support. I can help explain driver onboarding, verification, mission flow, and what drivers need before activation.",
      request_ride:
        "Welcome to Harvey AI Support. I can help with fare questions, ride requests, payment authorization, dispatch flow, and autonomous pilot labeling.",
      driver_dashboard:
        "Welcome to Harvey AI Support. I can help with missions, availability, ride status, driver payouts, and trip workflow.",
      admin_dashboard:
        "Welcome to Harvey AI Support. I can help explain dispatch, safety ops, analytics, incidents, and platform controls.",
      support_center:
        "Welcome to Harvey AI Support. Tell me what you need help with and I’ll guide you through Harvey Taxi support.",
      privacy_policy:
        "Welcome to Harvey AI Support. I can explain Harvey Taxi platform operations in plain language, but legal policy text should still be reviewed directly on the page.",
      terms_of_service:
        "Welcome to Harvey AI Support. I can help explain platform terms in plain language, but the posted terms remain the official source."
    };

    return messages[pageContext] || messages.homepage;
  }

  function buildSuggestions(pageContext) {
    const shared = [
      "What is Harvey Taxi?",
      "What is the nonprofit mission?",
      "Is autonomous service live?"
    ];

    const byPage = {
      homepage: [
        "How do I request a ride?",
        "How do I sign up as a driver?"
      ],
      rider_signup: [
        "Why do riders need approval?",
        "What documents do I need?"
      ],
      driver_signup: [
        "How does driver verification work?",
        "When can I start driving?"
      ],
      request_ride: [
        "How does payment authorization work?",
        "How does dispatch work?"
      ],
      driver_dashboard: [
        "How do missions work?",
        "How do driver payouts work?"
      ],
      admin_dashboard: [
        "How do dispatch overrides work?",
        "What does the AI admin assistant do?"
      ],
      support_center: [
        "How do I report an issue?",
        "How do I get trip help?"
      ]
    };

    return [...(byPage[pageContext] || []), ...shared].slice(0, 5);
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function createWidget() {
    root.innerHTML = `
      <div class="harvey-ai-widget">
        <button
          class="harvey-ai-launch"
          type="button"
          aria-label="Open Harvey AI Support"
          title="Open Harvey AI Support"
          data-harvey-ai-open
        >✦</button>

        <section class="harvey-ai-panel" aria-live="polite" aria-label="Harvey AI Support chat panel">
          <div class="harvey-ai-header">
            <div class="harvey-ai-header-left">
              <div class="harvey-ai-badge">AI</div>
              <div class="harvey-ai-title-wrap">
                <div class="harvey-ai-title">Harvey AI Support</div>
                <div class="harvey-ai-subtitle">${escapeHtml(formatPageSubtitle(PAGE_CONTEXT))}</div>
              </div>
            </div>

            <div class="harvey-ai-actions">
              <button class="harvey-ai-icon-btn" type="button" data-harvey-ai-clear title="New chat">↺</button>
              <button class="harvey-ai-icon-btn" type="button" data-harvey-ai-close title="Close chat">✕</button>
            </div>
          </div>

          <div class="harvey-ai-body" data-harvey-ai-body></div>

          <div class="harvey-ai-suggestions" data-harvey-ai-suggestions></div>

          <div class="harvey-ai-footer">
            <form class="harvey-ai-form" data-harvey-ai-form>
              <textarea
                class="harvey-ai-input"
                data-harvey-ai-input
                rows="1"
                placeholder="Ask Harvey AI about rides, support, drivers, nonprofit mission, or autonomous plans..."
              ></textarea>
              <button class="harvey-ai-send" data-harvey-ai-send type="submit" aria-label="Send message">➜</button>
            </form>
            <div class="harvey-ai-footnote">
              Harvey AI can explain platform flow and support guidance. For emergencies, contact local emergency services immediately.
            </div>
          </div>
        </section>
      </div>
    `;

    bindEvents();
    renderMessages();
    renderSuggestions();
  }

  function formatPageSubtitle(pageContext) {
    const map = {
      homepage: "Home page support",
      rider_signup: "Rider signup support",
      driver_signup: "Driver onboarding support",
      request_ride: "Ride request support",
      driver_dashboard: "Driver dashboard support",
      admin_dashboard: "Admin operations support",
      support_center: "Support center assistance",
      privacy_policy: "Privacy page assistance",
      terms_of_service: "Terms page assistance"
    };

    return map[pageContext] || "General platform support";
  }

  function bindEvents() {
    const panel = root.querySelector(".harvey-ai-panel");
    const launch = root.querySelector(".harvey-ai-launch");
    const closeBtn = root.querySelector("[data-harvey-ai-close]");
    const clearBtn = root.querySelector("[data-harvey-ai-clear]");
    const form = root.querySelector("[data-harvey-ai-form]");
    const input = root.querySelector("[data-harvey-ai-input]");

    launch.addEventListener("click", open);
    closeBtn.addEventListener("click", close);

    clearBtn.addEventListener("click", function () {
      state.messages = getWelcomeMessages();
      saveMessages();
      renderMessages();
      renderSuggestions();
      input.focus();
    });

    form.addEventListener("submit", async function (event) {
      event.preventDefault();
      const text = (input.value || "").trim();
      if (!text || state.isLoading) return;

      input.value = "";
      autoResizeTextarea(input);

      await sendMessage(text);
    });

    input.addEventListener("input", function () {
      autoResizeTextarea(input);
    });

    input.addEventListener("keydown", function (event) {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        form.requestSubmit();
      }
    });

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && state.isOpen) {
        close();
      }
    });

    panel.addEventListener("click", function (event) {
      event.stopPropagation();
    });
  }

  function autoResizeTextarea(textarea) {
    textarea.style.height = "auto";
    textarea.style.height = Math.min(textarea.scrollHeight, 120) + "px";
  }

  function open() {
    state.isOpen = true;
    const panel = root.querySelector(".harvey-ai-panel");
    panel.classList.add("open");
    const input = root.querySelector("[data-harvey-ai-input]");
    setTimeout(() => input && input.focus(), 80);
    scrollToBottom();
  }

  function close() {
    state.isOpen = false;
    const panel = root.querySelector(".harvey-ai-panel");
    panel.classList.remove("open");
  }

  function addMessage(role, text, meta) {
    state.messages.push({
      role,
      text,
      meta: meta || (role === "user" ? "You" : "Harvey AI Support")
    });
    saveMessages();
    renderMessages();
  }

  function renderMessages() {
    const body = root.querySelector("[data-harvey-ai-body]");
    if (!body) return;

    body.innerHTML = "";

    state.messages.forEach((message) => {
      const wrapper = document.createElement("div");
      wrapper.className = `harvey-ai-message ${message.role === "user" ? "user" : "assistant"}`;

      const bubble = document.createElement("div");
      bubble.className = "harvey-ai-bubble";
      bubble.textContent = message.text;

      const meta = document.createElement("div");
      meta.className = "harvey-ai-meta";
      meta.textContent = message.meta || "";

      wrapper.appendChild(bubble);
      wrapper.appendChild(meta);
      body.appendChild(wrapper);
    });

    if (state.isLoading) {
      const typingWrap = document.createElement("div");
      typingWrap.className = "harvey-ai-message assistant";
      typingWrap.innerHTML = `
        <div class="harvey-ai-typing" aria-label="Harvey AI is typing">
          <span class="harvey-ai-typing-dot"></span>
          <span class="harvey-ai-typing-dot"></span>
          <span class="harvey-ai-typing-dot"></span>
        </div>
        <div class="harvey-ai-meta">Harvey AI Support</div>
      `;
      body.appendChild(typingWrap);
    }

    const systemLine = document.createElement("div");
    systemLine.className = "harvey-ai-system-line";
    systemLine.textContent = "Harvey AI can explain rides, support flow, LLC mission, nonprofit mission, and autonomous pilot status.";
    body.appendChild(systemLine);

    scrollToBottom();
  }

  function renderSuggestions() {
    const container = root.querySelector("[data-harvey-ai-suggestions]");
    if (!container) return;

    container.innerHTML = "";

    buildSuggestions(PAGE_CONTEXT).forEach((prompt) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "harvey-ai-suggestion";
      button.textContent = prompt;
      button.addEventListener("click", function () {
        sendMessage(prompt);
      });
      container.appendChild(button);
    });
  }

  function scrollToBottom() {
    const body = root.querySelector("[data-harvey-ai-body]");
    if (!body) return;
    requestAnimationFrame(() => {
      body.scrollTop = body.scrollHeight;
    });
  }

  async function sendMessage(text) {
    const trimmed = String(text || "").trim();
    if (!trimmed || state.isLoading) return;

    addMessage("user", trimmed, "You");
    state.isLoading = true;
    renderMessages();
    toggleFormDisabled(true);

    try {
      const response = await fetch(API_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          message: trimmed,
          pageContext: PAGE_CONTEXT,
          rider_id: state.riderId || null,
          driver_id: state.driverId || null,
          ride_id: state.rideId || null
        })
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(
          data?.error || "Harvey AI could not respond right now."
        );
      }

      const reply =
        data?.ai?.reply ||
        data?.reply ||
        "I’m here to help with Harvey Taxi support.";

      addMessage("assistant", reply, "Harvey AI Support");
    } catch (error) {
      addMessage(
        "assistant",
        "I’m having trouble reaching Harvey AI right now. Please try again in a moment or use the support page.",
        "Harvey AI Support"
      );
      console.error("Harvey AI widget error:", error);
    } finally {
      state.isLoading = false;
      renderMessages();
      toggleFormDisabled(false);
    }
  }

  function toggleFormDisabled(disabled) {
    const input = root.querySelector("[data-harvey-ai-input]");
    const sendBtn = root.querySelector("[data-harvey-ai-send]");

    if (input) input.disabled = disabled;
    if (sendBtn) sendBtn.disabled = disabled;

    if (!disabled && input) {
      input.focus();
    }
  }

  window.HarveyAI = {
    open,
    close,
    ask(message) {
      open();
      return sendMessage(message);
    },
    setContext(nextContext) {
      if (!nextContext || typeof nextContext !== "object") return;
      state.riderId = nextContext.rider_id || state.riderId;
      state.driverId = nextContext.driver_id || state.driverId;
      state.rideId = nextContext.ride_id || state.rideId;
    },
    reset() {
      state.messages = getWelcomeMessages();
      saveMessages();
      renderMessages();
    }
  };

  createWidget();
})();

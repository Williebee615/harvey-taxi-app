<div id="harvey-ai-chat-root"></div>

<style>
  #harvey-ai-chat-root {
    position: fixed;
    right: 16px;
    bottom: 88px;
    z-index: 99999;
    font-family: Inter, Arial, sans-serif;
  }

  .harvey-ai-widget {
    position: relative;
  }

  .harvey-ai-launch {
    width: 64px;
    height: 64px;
    border: none;
    border-radius: 999px;
    cursor: pointer;
    font-size: 24px;
    font-weight: 800;
    color: #06111f;
    background: linear-gradient(135deg, #6ee7ff 0%, #7aa2ff 100%);
    box-shadow: 0 18px 40px rgba(0, 0, 0, 0.35);
  }

  .harvey-ai-panel {
    position: absolute;
    right: 0;
    bottom: 78px;
    width: min(430px, calc(100vw - 24px));
    height: min(700px, calc(100vh - 130px));
    display: none;
    flex-direction: column;
    overflow: hidden;
    border-radius: 28px;
    border: 1px solid rgba(255, 255, 255, 0.08);
    background:
      radial-gradient(circle at top left, rgba(110, 231, 255, 0.13), transparent 30%),
      radial-gradient(circle at bottom right, rgba(122, 162, 255, 0.10), transparent 30%),
      #081224;
    color: #ffffff;
    box-shadow: 0 28px 70px rgba(0, 0, 0, 0.45);
    backdrop-filter: blur(16px);
  }

  .harvey-ai-panel.open {
    display: flex;
  }

  .harvey-ai-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 14px;
    padding: 18px 18px 16px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    background: rgba(8, 18, 36, 0.92);
  }

  .harvey-ai-header-left {
    display: flex;
    align-items: center;
    gap: 14px;
    min-width: 0;
  }

  .harvey-ai-badge {
    width: 64px;
    height: 64px;
    border-radius: 20px;
    display: grid;
    place-items: center;
    font-size: 24px;
    font-weight: 800;
    color: #06111f;
    background: linear-gradient(135deg, #6ee7ff 0%, #7aa2ff 100%);
    flex-shrink: 0;
  }

  .harvey-ai-title-wrap {
    min-width: 0;
  }

  .harvey-ai-title {
    font-size: 18px;
    font-weight: 800;
    line-height: 1.2;
  }

  .harvey-ai-subtitle {
    margin-top: 4px;
    font-size: 13px;
    color: rgba(220, 230, 255, 0.72);
  }

  .harvey-ai-actions {
    display: flex;
    gap: 10px;
    flex-shrink: 0;
  }

  .harvey-ai-icon-btn {
    width: 56px;
    height: 56px;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 18px;
    cursor: pointer;
    font-size: 24px;
    color: #ffffff;
    background: rgba(255, 255, 255, 0.06);
  }

  .harvey-ai-body {
    flex: 1;
    overflow-y: auto;
    padding: 18px;
    display: flex;
    flex-direction: column;
    gap: 14px;
    min-height: 0;
  }

  .harvey-ai-message {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .harvey-ai-message.user {
    align-items: flex-end;
  }

  .harvey-ai-message.assistant {
    align-items: flex-start;
  }

  .harvey-ai-bubble {
    max-width: 88%;
    padding: 16px 18px;
    border-radius: 22px;
    font-size: 15px;
    line-height: 1.55;
    white-space: pre-wrap;
    word-break: break-word;
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.04);
  }

  .harvey-ai-message.assistant .harvey-ai-bubble {
    background: rgba(255, 255, 255, 0.08);
    color: #f4f7ff;
    border-bottom-left-radius: 8px;
  }

  .harvey-ai-message.user .harvey-ai-bubble {
    background: linear-gradient(135deg, #79f0b7 0%, #78f0e9 100%);
    color: #07131f;
    border-bottom-right-radius: 8px;
    font-weight: 600;
  }

  .harvey-ai-meta {
    font-size: 12px;
    color: rgba(220, 230, 255, 0.65);
    padding: 0 4px;
  }

  .harvey-ai-system-line {
    font-size: 12px;
    color: rgba(220, 230, 255, 0.68);
    padding: 6px 2px 0;
  }

  .harvey-ai-typing {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 14px 16px;
    border-radius: 18px;
    background: rgba(255, 255, 255, 0.08);
  }

  .harvey-ai-typing-dot {
    width: 8px;
    height: 8px;
    border-radius: 999px;
    background: #b9c7ff;
    animation: harveyTyping 1.1s infinite ease-in-out;
  }

  .harvey-ai-typing-dot:nth-child(2) {
    animation-delay: 0.15s;
  }

  .harvey-ai-typing-dot:nth-child(3) {
    animation-delay: 0.3s;
  }

  @keyframes harveyTyping {
    0%, 80%, 100% {
      transform: scale(0.7);
      opacity: 0.6;
    }
    40% {
      transform: scale(1);
      opacity: 1;
    }
  }

  .harvey-ai-suggestions {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    padding: 16px 18px;
    border-top: 1px solid rgba(255, 255, 255, 0.06);
  }

  .harvey-ai-suggestion {
    border: 1px solid rgba(255, 255, 255, 0.10);
    background: rgba(255, 255, 255, 0.05);
    color: #eaf0ff;
    border-radius: 999px;
    padding: 12px 16px;
    cursor: pointer;
    font-size: 14px;
    font-weight: 700;
    line-height: 1.2;
  }

  .harvey-ai-footer {
    padding: 16px 18px 18px;
    border-top: 1px solid rgba(255, 255, 255, 0.08);
    background: rgba(8, 18, 36, 0.95);
  }

  .harvey-ai-form {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 12px;
    align-items: end;
  }

  .harvey-ai-input {
    min-height: 62px;
    max-height: 140px;
    resize: none;
    padding: 16px 18px;
    border-radius: 20px;
    border: 1px solid rgba(110, 231, 255, 0.18);
    background: rgba(7, 16, 34, 0.95);
    color: #ffffff;
    font-size: 15px;
    line-height: 1.45;
    outline: none;
  }

  .harvey-ai-input::placeholder {
    color: rgba(220, 230, 255, 0.48);
  }

  .harvey-ai-send {
    width: 90px;
    height: 74px;
    border: none;
    border-radius: 24px;
    cursor: pointer;
    font-size: 28px;
    font-weight: 800;
    color: #07131f;
    background: linear-gradient(135deg, #79f0b7 0%, #78f0e9 100%);
    box-shadow: 0 12px 28px rgba(121, 240, 183, 0.25);
  }

  .harvey-ai-send:disabled,
  .harvey-ai-input:disabled {
    opacity: 0.65;
    cursor: not-allowed;
  }

  .harvey-ai-footnote {
    margin-top: 12px;
    font-size: 12px;
    line-height: 1.5;
    color: rgba(220, 230, 255, 0.72);
  }

  @media (max-width: 640px) {
    #harvey-ai-chat-root {
      right: 12px;
      left: 12px;
      bottom: 84px;
    }

    .harvey-ai-launch {
      margin-left: auto;
      display: block;
      width: 58px;
      height: 58px;
      font-size: 22px;
    }

    .harvey-ai-panel {
      width: calc(100vw - 24px);
      height: min(76vh, 760px);
      bottom: 72px;
      border-radius: 24px;
    }

    .harvey-ai-header {
      padding: 16px;
    }

    .harvey-ai-badge {
      width: 58px;
      height: 58px;
      border-radius: 18px;
      font-size: 22px;
    }

    .harvey-ai-icon-btn {
      width: 50px;
      height: 50px;
      border-radius: 16px;
      font-size: 22px;
    }

    .harvey-ai-send {
      width: 78px;
      height: 68px;
      border-radius: 22px;
    }

    .harvey-ai-bubble {
      max-width: 92%;
    }
  }
</style>

<script>
(function () {
  const root = document.getElementById("harvey-ai-chat-root");
  if (!root) return;

  const STORAGE_KEY = "harvey_ai_chat_state_v3";
  const PAGE_CONTEXT = detectPageContext();
  const API_ENDPOINT =
    window.location.hostname.includes("onrender.com")
      ? "/api/ai/support"
      : "https://harvey-taxi-app-2.onrender.com/api/ai/support";

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

    if (path.includes("rider-signup")) return "rider";
    if (path.includes("driver-signup")) return "driver";
    if (path.includes("request-ride")) return "request";
    if (path.includes("driver-dashboard")) return "driver";
    return "general";
  }

  function readContextValue(name) {
    try {
      const query = new URLSearchParams(window.location.search).get(name);
      if (query) return query;

      const sessionValue = sessionStorage.getItem(name);
      if (sessionValue) return sessionValue;

      const localValue = localStorage.getItem(name);
      if (localValue) return localValue;

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
      if (!Array.isArray(parsed) || !parsed.length) {
        return getWelcomeMessages();
      }

      return parsed;
    } catch (error) {
      return getWelcomeMessages();
    }
  }

  function saveMessages() {
    try {
      sessionStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(state.messages.slice(-30))
      );
    } catch (error) {
      console.warn("Harvey AI storage warning:", error);
    }
  }

  function getWelcomeMessages() {
    return [
      {
        role: "assistant",
        text: getWelcomeTextByPage(PAGE_CONTEXT),
        meta: "Harvey AI Support"
      }
    ];
  }

  function getWelcomeTextByPage(pageContext) {
    const map = {
      general:
        "Hi, I’m Harvey AI. I can help with rides, support, driver onboarding, rider approval, payment questions, and Harvey Taxi platform guidance.",
      rider:
        "Hi, I’m Harvey AI. I can help explain rider signup, verification, approval, payment holds, and ride access.",
      driver:
        "Hi, I’m Harvey AI. I can help with driver onboarding, verification, approval, missions, and payouts.",
      request:
        "Hi, I’m Harvey AI. I can help with fare questions, trip requests, payment authorization, and dispatch flow."
    };

    return map[pageContext] || map.general;
  }

  function buildSuggestions(pageContext) {
    const map = {
      general: [
        "How do I request a ride?",
        "How do I sign up as a driver?",
        "What is Harvey Taxi?",
        "What is the nonprofit mission?",
        "Is autonomous service live?"
      ],
      rider: [
        "Why do riders need approval?",
        "What documents do I need?",
        "How does payment authorization work?",
        "When can I request a ride?",
        "How do I check my status?"
      ],
      driver: [
        "How does driver verification work?",
        "When can I start driving?",
        "How do missions work?",
        "How do driver payouts work?",
        "What do I need before activation?"
      ],
      request: [
        "How does payment authorization work?",
        "How does dispatch work?",
        "How is fare estimated?",
        "Can I request autonomous service?",
        "Why can't I request a ride yet?"
      ]
    };

    return map[pageContext] || map.general;
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatPageSubtitle(pageContext) {
    const map = {
      general: "General support",
      rider: "Rider support",
      driver: "Driver support",
      request: "Ride request support"
    };

    return map[pageContext] || "Platform support";
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
                placeholder="Ask about rides, signup, payment holds, dispatch, missions, support, or autonomous pilot..."
              ></textarea>
              <button class="harvey-ai-send" data-harvey-ai-send type="submit" aria-label="Send message">➜</button>
            </form>
            <div class="harvey-ai-footnote">
              Harvey AI explains platform flow and support guidance. For emergencies, contact local emergency services immediately.
            </div>
          </div>
        </section>
      </div>
    `;

    bindEvents();
    renderMessages();
    renderSuggestions();
  }

  function bindEvents() {
    const panel = root.querySelector(".harvey-ai-panel");
    const launch = root.querySelector("[data-harvey-ai-open]");
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
      if (input) input.focus();
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
    textarea.style.height = Math.min(textarea.scrollHeight, 140) + "px";
  }

  function open() {
    state.isOpen = true;
    const panel = root.querySelector(".harvey-ai-panel");
    panel.classList.add("open");

    const input = root.querySelector("[data-harvey-ai-input]");
    setTimeout(() => {
      if (input) input.focus();
    }, 80);

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
    systemLine.textContent =
      "Harvey AI can explain rides, support flow, driver onboarding, rider approval, and autonomous pilot status.";
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
          page: PAGE_CONTEXT,
          rider_id: state.riderId || null,
          driver_id: state.driverId || null,
          ride_id: state.rideId || null
        })
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(data?.error || "Harvey AI could not respond right now.");
      }

      const reply =
        data?.reply ||
        data?.ai?.reply ||
        "I’m here to help with Harvey Taxi support.";

      addMessage("assistant", reply, "Harvey AI Support");
    } catch (error) {
      console.error("Harvey AI widget error:", error);

      addMessage(
        "assistant",
        "I’m having trouble reaching Harvey AI right now. Please try again in a moment or use the support page.",
        "Harvey AI Support"
      );
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
</script>

(function () {
  function bootHarveyAI() {
    if (window.__HARVEY_AI_WIDGET_LOADED__) return;
    window.__HARVEY_AI_WIDGET_LOADED__ = true;

    let root = document.getElementById("harvey-ai-chat-root");

    if (!root) {
      root = document.createElement("div");
      root.id = "harvey-ai-chat-root";
      document.body.appendChild(root);
    } else if (root.parentElement !== document.body) {
      document.body.appendChild(root);
    }

    const CONFIG = {
      storageKey: "harvey_ai_chat_state_v14",
      uiStateKey: "harvey_ai_chat_ui_state_v14",
      endpoint: "/api/ai/support",
      messageLimit: 80,
      rateLimitMs: 1000,
      requestTimeoutMs: 25000,
      autoOpenParam: "openHarveyAI",
      defaultOpenOnPages: [],
      widgetTitle: "Harvey Taxi AI Support"
    };

    injectStyles();

    const PAGE_CONTEXT = detectPageContext();
    const savedUiState = loadUiState();

    const state = {
      isOpen: !!savedUiState.isOpen,
      isLoading: false,
      isExpanded: !!savedUiState.isExpanded,
      messages: loadMessages(),
      riderId: readContextValue("rider_id"),
      driverId: readContextValue("driver_id"),
      rideId: readContextValue("ride_id"),
      lastSentAt: 0
    };

    function detectPageContext() {
      const path = String(window.location.pathname || "").toLowerCase();

      if (path.includes("rider-signup")) return "rider";
      if (path.includes("rider-dashboard")) return "rider";
      if (path.includes("driver-signup")) return "driver";
      if (path.includes("driver-dashboard")) return "driver";
      if (path.includes("request-ride")) return "request";
      if (path.includes("support")) return "support";
      if (path.includes("admin")) return "admin";

      return "general";
    }

    function readContextValue(name) {
      try {
        const params = new URLSearchParams(window.location.search);
        const queryValue = params.get(name);
        if (queryValue) return queryValue;

        const sessionValue = sessionStorage.getItem(name);
        if (sessionValue) return sessionValue;

        const localValue = localStorage.getItem(name);
        if (localValue) return localValue;

        return null;
      } catch (error) {
        return null;
      }
    }

    function shouldAutoOpen() {
      try {
        const params = new URLSearchParams(window.location.search);
        if (params.get(CONFIG.autoOpenParam) === "1") return true;
      } catch (error) {
        // ignore
      }

      return CONFIG.defaultOpenOnPages.includes(PAGE_CONTEXT);
    }

    function getWelcomeMessages() {
      return [
        {
          role: "assistant",
          text: getWelcomeTextByPage(PAGE_CONTEXT),
          meta: CONFIG.widgetTitle,
          ts: Date.now()
        }
      ];
    }

    function getWelcomeTextByPage(pageContext) {
      const map = {
        general:
          "Hi, I’m Harvey Taxi AI Support. I can help with rides, rider approval, driver onboarding, payment authorization, dispatch, mission flow, and autonomous pilot guidance.",
        rider:
          "Hi, I’m Harvey Taxi AI Support. I can help explain rider signup, rider approval, payment authorization, and ride access.",
        driver:
          "Hi, I’m Harvey Taxi AI Support. I can help with driver onboarding, verification, approval, missions, driver status, and payout questions.",
        request:
          "Hi, I’m Harvey Taxi AI Support. I can help with fare estimates, payment authorization, ride requests, dispatch flow, trip updates, and ride availability.",
        support:
          "Hi, I’m Harvey Taxi AI Support. I can help with support questions about accounts, rides, approvals, dispatch, payments, and autonomous pilot mode.",
        admin:
          "Hi, I’m Harvey Taxi AI Support. I can help explain rider access rules, driver activation flow, dispatch logic, payment holds, and support processes."
      };

      return map[pageContext] || map.general;
    }

    function buildSuggestions(pageContext) {
      const map = {
        general: [
          "How do I request a ride?",
          "How do I sign up as a driver?",
          "What is Harvey Taxi?",
          "What is autonomous pilot mode?"
        ],
        rider: [
          "Why do riders need approval?",
          "When can I request a ride?",
          "How does payment authorization work?",
          "How do I check my rider status?"
        ],
        driver: [
          "How does driver verification work?",
          "When can I start driving?",
          "How do missions work?",
          "How do payouts work?"
        ],
        request: [
          "How is fare estimated?",
          "Why can't I request a ride yet?",
          "How does dispatch work?",
          "Why is payment authorization required?"
        ],
        support: [
          "How do I get ride help?",
          "How do approvals work?",
          "What if my ride request is blocked?",
          "What does pilot mode mean?"
        ],
        admin: [
          "How does rider approval work?",
          "How does driver activation work?",
          "What is the dispatch flow?",
          "How do payment holds work?"
        ]
      };

      return map[pageContext] || map.general;
    }

    function formatPageSubtitle(pageContext) {
      const map = {
        general: "General support",
        rider: "Rider support",
        driver: "Driver support",
        request: "Ride request support",
        support: "Customer support",
        admin: "Platform support"
      };

      return map[pageContext] || "Platform support";
    }

    function loadMessages() {
      try {
        const raw = sessionStorage.getItem(CONFIG.storageKey);
        if (!raw) return getWelcomeMessages();

        const parsed = JSON.parse(raw);

        if (!Array.isArray(parsed) || !parsed.length) {
          return getWelcomeMessages();
        }

        return parsed
          .filter(function (item) {
            return item && typeof item.role === "string" && typeof item.text === "string";
          })
          .slice(-CONFIG.messageLimit);
      } catch (error) {
        return getWelcomeMessages();
      }
    }

    function saveMessages() {
      try {
        sessionStorage.setItem(
          CONFIG.storageKey,
          JSON.stringify(state.messages.slice(-CONFIG.messageLimit))
        );
      } catch (error) {
        console.warn("Harvey AI storage warning:", error);
      }
    }

    function loadUiState() {
      try {
        const raw = sessionStorage.getItem(CONFIG.uiStateKey);
        if (!raw) return { isOpen: false, isExpanded: false };

        const parsed = JSON.parse(raw);
        return {
          isOpen: !!(parsed && parsed.isOpen),
          isExpanded: !!(parsed && parsed.isExpanded)
        };
      } catch (error) {
        return { isOpen: false, isExpanded: false };
      }
    }

    function saveUiState() {
      try {
        sessionStorage.setItem(
          CONFIG.uiStateKey,
          JSON.stringify({
            isOpen: !!state.isOpen,
            isExpanded: !!state.isExpanded
          })
        );
      } catch (error) {
        console.warn("Harvey AI UI state warning:", error);
      }
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
            aria-label="Open ${escapeHtml(CONFIG.widgetTitle)}"
            title="Open ${escapeHtml(CONFIG.widgetTitle)}"
            data-harvey-ai-open
          >✦</button>

          <section
            class="harvey-ai-panel"
            aria-live="polite"
            aria-label="${escapeHtml(CONFIG.widgetTitle)} chat panel"
          >
            <div class="harvey-ai-header">
              <div class="harvey-ai-header-left">
                <div class="harvey-ai-badge">AI</div>
                <div class="harvey-ai-title-wrap">
                  <div class="harvey-ai-title">${escapeHtml(CONFIG.widgetTitle)}</div>
                  <div class="harvey-ai-subtitle">${escapeHtml(formatPageSubtitle(PAGE_CONTEXT))}</div>
                </div>
              </div>

              <div class="harvey-ai-actions">
                <button
                  class="harvey-ai-icon-btn"
                  type="button"
                  data-harvey-ai-expand
                  title="Expand chat"
                  aria-label="Expand chat"
                >⤢</button>

                <button
                  class="harvey-ai-icon-btn"
                  type="button"
                  data-harvey-ai-reset
                  title="New chat"
                  aria-label="New chat"
                >↺</button>

                <button
                  class="harvey-ai-icon-btn"
                  type="button"
                  data-harvey-ai-close
                  title="Close chat"
                  aria-label="Close chat"
                >✕</button>
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
                  maxlength="1400"
                  placeholder="Ask Harvey Taxi AI about rides, signup, approvals, payment authorization, dispatch, missions, support, or autonomous pilot..."
                ></textarea>

                <button
                  class="harvey-ai-send"
                  data-harvey-ai-send
                  type="submit"
                  aria-label="Send message"
                >➜</button>
              </form>

              <div class="harvey-ai-footnote">
                Harvey Taxi AI Support provides platform guidance. For emergencies, contact local emergency services immediately.
              </div>
            </div>
          </section>
        </div>
      `;

      bindEvents();
      renderMessages();
      renderSuggestions();
      syncPanelState();

      if (shouldAutoOpen() && !state.isOpen) {
        open();
      }
    }

    function bindEvents() {
      const panel = root.querySelector(".harvey-ai-panel");
      const openBtn = root.querySelector("[data-harvey-ai-open]");
      const closeBtn = root.querySelector("[data-harvey-ai-close]");
      const resetBtn = root.querySelector("[data-harvey-ai-reset]");
      const expandBtn = root.querySelector("[data-harvey-ai-expand]");
      const form = root.querySelector("[data-harvey-ai-form]");
      const input = root.querySelector("[data-harvey-ai-input]");

      if (openBtn) {
        openBtn.addEventListener("click", function () {
          open();
        });
      }

      if (closeBtn) {
        closeBtn.addEventListener("click", function () {
          close();
        });
      }

      if (resetBtn) {
        resetBtn.addEventListener("click", function () {
          state.messages = getWelcomeMessages();
          saveMessages();
          renderMessages();
          renderSuggestions();

          if (input) {
            input.value = "";
            autoResizeTextarea(input);
            input.focus();
          }
        });
      }

      if (expandBtn) {
        expandBtn.addEventListener("click", function () {
          toggleExpand();
        });
      }

      if (form) {
        form.addEventListener("submit", async function (event) {
          event.preventDefault();

          const text = String(input && input.value ? input.value : "").trim();
          if (!text || state.isLoading) return;

          const now = Date.now();
          if (now - state.lastSentAt < CONFIG.rateLimitMs) return;

          state.lastSentAt = now;
          input.value = "";
          autoResizeTextarea(input);

          await sendMessage(text);
        });
      }

      if (input) {
        input.addEventListener("input", function () {
          autoResizeTextarea(input);
        });

        input.addEventListener("keydown", function (event) {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            if (form) form.requestSubmit();
          }
        });
      }

      document.addEventListener("keydown", function (event) {
        if (event.key === "Escape" && state.isOpen && state.isExpanded) {
          toggleExpand(false);
          return;
        }

        if (event.key === "Escape" && state.isOpen) {
          close();
        }
      });

      if (panel) {
        panel.addEventListener("click", function (event) {
          event.stopPropagation();
        });
      }

      window.addEventListener("resize", function () {
        scrollToBottom();
      });
    }

    function autoResizeTextarea(textarea) {
      if (!textarea) return;
      textarea.style.height = "auto";
      textarea.style.height = Math.min(textarea.scrollHeight, 220) + "px";
    }

    function updateExpandButton() {
      const expandBtn = root.querySelector("[data-harvey-ai-expand]");
      if (!expandBtn) return;

      expandBtn.textContent = state.isExpanded ? "⤡" : "⤢";
      expandBtn.title = state.isExpanded ? "Restore chat size" : "Expand chat";
      expandBtn.setAttribute(
        "aria-label",
        state.isExpanded ? "Restore chat size" : "Expand chat"
      );
    }

    function syncPanelState() {
      const panel = root.querySelector(".harvey-ai-panel");
      if (!panel) return;

      if (state.isOpen) {
        panel.classList.add("open");
      } else {
        panel.classList.remove("open");
      }

      if (state.isExpanded) {
        panel.classList.add("expanded");
      } else {
        panel.classList.remove("expanded");
      }

      updateExpandButton();
      saveUiState();
    }

    function open() {
      state.isOpen = true;
      syncPanelState();

      const input = root.querySelector("[data-harvey-ai-input]");
      setTimeout(function () {
        if (input) input.focus();
      }, 60);

      scrollToBottom();
    }

    function close() {
      state.isOpen = false;
      syncPanelState();
    }

    function toggleExpand(forceValue) {
      state.isExpanded =
        typeof forceValue === "boolean" ? forceValue : !state.isExpanded;

      syncPanelState();
      scrollToBottom();
    }

    function addMessage(role, text, meta) {
      state.messages.push({
        role: role === "user" ? "user" : "assistant",
        text: String(text || ""),
        meta: meta || (role === "user" ? "You" : CONFIG.widgetTitle),
        ts: Date.now()
      });

      state.messages = state.messages.slice(-CONFIG.messageLimit);
      saveMessages();
      renderMessages();
    }

    function renderMessages() {
      const body = root.querySelector("[data-harvey-ai-body]");
      if (!body) return;

      body.innerHTML = "";

      state.messages.forEach(function (message) {
        const wrapper = document.createElement("div");
        wrapper.className =
          "harvey-ai-message " + (message.role === "user" ? "user" : "assistant");

        const bubble = document.createElement("div");
        bubble.className = "harvey-ai-bubble";
        bubble.textContent = String(message.text || "");

        const meta = document.createElement("div");
        meta.className = "harvey-ai-meta";
        meta.textContent = String(
          message.meta || (message.role === "user" ? "You" : CONFIG.widgetTitle)
        );

        wrapper.appendChild(bubble);
        wrapper.appendChild(meta);
        body.appendChild(wrapper);
      });

      if (state.isLoading) {
        const typingWrap = document.createElement("div");
        typingWrap.className = "harvey-ai-message assistant";
        typingWrap.innerHTML = `
          <div class="harvey-ai-typing" aria-label="${escapeHtml(CONFIG.widgetTitle)} is typing">
            <span class="harvey-ai-typing-dot"></span>
            <span class="harvey-ai-typing-dot"></span>
            <span class="harvey-ai-typing-dot"></span>
          </div>
          <div class="harvey-ai-meta">${escapeHtml(CONFIG.widgetTitle)}</div>
        `;
        body.appendChild(typingWrap);
      }

      const systemLine = document.createElement("div");
      systemLine.className = "harvey-ai-system-line";
      systemLine.textContent =
        "Harvey Taxi AI Support can explain rides, rider approval, driver onboarding, dispatch, mission status, payment authorization, and autonomous pilot guidance.";
      body.appendChild(systemLine);

      scrollToBottom();
    }

    function renderSuggestions() {
      const container = root.querySelector("[data-harvey-ai-suggestions]");
      if (!container) return;

      container.innerHTML = "";

      buildSuggestions(PAGE_CONTEXT).forEach(function (prompt) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "harvey-ai-suggestion";
        button.textContent = prompt;

        button.addEventListener("click", function () {
          if (state.isLoading) return;
          open();
          sendMessage(prompt);
        });

        container.appendChild(button);
      });
    }

    function scrollToBottom() {
      const body = root.querySelector("[data-harvey-ai-body]");
      if (!body) return;

      requestAnimationFrame(function () {
        body.scrollTop = body.scrollHeight;
      });
    }

    function toggleFormDisabled(disabled) {
      const input = root.querySelector("[data-harvey-ai-input]");
      const sendBtn = root.querySelector("[data-harvey-ai-send]");

      if (input) input.disabled = !!disabled;
      if (sendBtn) sendBtn.disabled = !!disabled;

      if (!disabled && input && state.isOpen) {
        input.focus();
      }
    }

    function withTimeout(promise, timeoutMs) {
      return new Promise(function (resolve, reject) {
        const timer = setTimeout(function () {
          reject(new Error("Request timeout"));
        }, timeoutMs);

        promise
          .then(function (value) {
            clearTimeout(timer);
            resolve(value);
          })
          .catch(function (error) {
            clearTimeout(timer);
            reject(error);
          });
      });
    }

    function buildPayload(messageText) {
      return {
        message: String(messageText || "").trim(),
        page: PAGE_CONTEXT,
        rider_id: state.riderId || null,
        driver_id: state.driverId || null,
        ride_id: state.rideId || null,
        source: "widget"
      };
    }

    function parseReply(data) {
      if (!data || typeof data !== "object") return null;

      if (typeof data.reply === "string" && data.reply.trim()) {
        return data.reply.trim();
      }

      if (typeof data.message === "string" && data.message.trim() && !data.error) {
        return data.message.trim();
      }

      if (data.ai && typeof data.ai.reply === "string" && data.ai.reply.trim()) {
        return data.ai.reply.trim();
      }

      return null;
    }

    async function sendMessage(text) {
      const trimmed = String(text || "").trim();
      if (!trimmed || state.isLoading) return;

      addMessage("user", trimmed, "You");
      state.isLoading = true;
      renderMessages();
      toggleFormDisabled(true);

      try {
        const response = await withTimeout(
          fetch(CONFIG.endpoint, {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify(buildPayload(trimmed))
          }),
          CONFIG.requestTimeoutMs
        );

        const data = await response.json().catch(function () {
          return null;
        });

        if (!response.ok) {
          throw new Error(
            (data && (data.error || data.message)) ||
              "Harvey Taxi AI Support could not respond right now."
          );
        }

        const reply =
          parseReply(data) ||
          "I’m here to help with Harvey Taxi support, rides, onboarding, approvals, payment authorization, dispatch, and mission guidance.";

        addMessage("assistant", reply, CONFIG.widgetTitle);
      } catch (error) {
        console.error("Harvey Taxi AI widget error:", error);

        let message =
          "I’m having trouble reaching Harvey Taxi AI Support right now. Please try again in a moment or use the support page.";

        if (String(error && error.message || "").toLowerCase().includes("timeout")) {
          message =
            "Harvey Taxi AI Support took too long to respond. Please try again in a moment.";
        }

        addMessage("assistant", message, CONFIG.widgetTitle);
      } finally {
        state.isLoading = false;
        renderMessages();
        toggleFormDisabled(false);
      }
    }

    function injectStyles() {
      if (document.getElementById("harvey-ai-widget-styles")) return;

      const style = document.createElement("style");
      style.id = "harvey-ai-widget-styles";
      style.textContent = `
#harvey-ai-chat-root {
  position: fixed !important;
  right: 18px !important;
  bottom: 92px !important;
  z-index: 2147483000 !important;
  font-family: Inter, Arial, sans-serif !important;
  pointer-events: none !important;
}

#harvey-ai-chat-root * {
  box-sizing: border-box;
}

#harvey-ai-chat-root .harvey-ai-widget,
#harvey-ai-chat-root .harvey-ai-widget * {
  pointer-events: auto;
}

.harvey-ai-widget {
  position: relative;
}

.harvey-ai-launch {
  width: 72px;
  height: 72px;
  border: none;
  border-radius: 999px;
  cursor: pointer;
  font-size: 26px;
  font-weight: 900;
  color: #06111f;
  background: linear-gradient(135deg, #6ee7ff 0%, #7aa2ff 100%);
  box-shadow: 0 18px 40px rgba(0, 0, 0, 0.35);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  -webkit-appearance: none;
  appearance: none;
  transition: transform 0.18s ease, filter 0.18s ease;
}

.harvey-ai-launch:hover {
  transform: translateY(-2px);
  filter: brightness(1.04);
}

.harvey-ai-launch:active {
  transform: translateY(0);
}

.harvey-ai-panel {
  position: absolute;
  right: 0;
  bottom: 86px;
  width: min(900px, calc(100vw - 28px));
  max-width: 900px;
  height: min(86vh, 1100px);
  min-height: 820px;
  display: none;
  flex-direction: column;
  overflow: hidden;
  border-radius: 30px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background:
    radial-gradient(circle at top left, rgba(110, 231, 255, 0.13), transparent 30%),
    radial-gradient(circle at bottom right, rgba(122, 162, 255, 0.10), transparent 30%),
    #081224;
  color: #ffffff;
  box-shadow: 0 28px 70px rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
}

.harvey-ai-panel.open {
  display: flex;
}

.harvey-ai-panel.expanded {
  position: fixed;
  top: 12px;
  right: 12px;
  bottom: 12px;
  left: 12px;
  width: auto;
  max-width: none;
  height: auto;
  min-height: 0;
  border-radius: 24px;
  z-index: 2147483001;
}

.harvey-ai-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 20px 20px 18px;
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
  font-weight: 900;
  color: #06111f;
  background: linear-gradient(135deg, #6ee7ff 0%, #7aa2ff 100%);
  flex-shrink: 0;
}

.harvey-ai-title-wrap {
  min-width: 0;
}

.harvey-ai-title {
  font-size: 20px;
  font-weight: 800;
  line-height: 1.2;
}

.harvey-ai-subtitle {
  margin-top: 4px;
  font-size: 14px;
  color: rgba(220, 230, 255, 0.72);
  line-height: 1.4;
}

.harvey-ai-actions {
  display: flex;
  gap: 10px;
  flex-shrink: 0;
}

.harvey-ai-icon-btn {
  width: 50px;
  height: 50px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 16px;
  cursor: pointer;
  font-size: 21px;
  color: #ffffff;
  background: rgba(255, 255, 255, 0.06);
  -webkit-appearance: none;
  appearance: none;
}

.harvey-ai-body {
  flex: 1;
  overflow-y: auto;
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 18px;
  min-height: 0;
  scroll-behavior: smooth;
}

.harvey-ai-body::-webkit-scrollbar {
  width: 8px;
}

.harvey-ai-body::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.16);
  border-radius: 999px;
}

.harvey-ai-message {
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.harvey-ai-message.user {
  align-items: flex-end;
}

.harvey-ai-message.assistant {
  align-items: flex-start;
}

.harvey-ai-bubble {
  max-width: 94%;
  padding: 20px 22px;
  border-radius: 24px;
  font-size: 18px;
  line-height: 1.72;
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
  font-size: 13px;
  color: rgba(220, 230, 255, 0.68);
  padding: 6px 2px 0;
  text-align: center;
  line-height: 1.6;
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
  padding: 18px 20px;
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
  -webkit-appearance: none;
  appearance: none;
}

.harvey-ai-footer {
  padding: 18px 20px 20px;
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
  min-height: 82px;
  max-height: 220px;
  resize: none;
  padding: 18px 20px;
  border-radius: 22px;
  border: 1px solid rgba(110, 231, 255, 0.18);
  background: rgba(7, 16, 34, 0.95);
  color: #ffffff;
  font-size: 16px;
  line-height: 1.6;
  outline: none;
}

.harvey-ai-input::placeholder {
  color: rgba(220, 230, 255, 0.48);
}

.harvey-ai-send {
  width: 92px;
  height: 82px;
  border: none;
  border-radius: 22px;
  cursor: pointer;
  font-size: 28px;
  font-weight: 800;
  color: #07131f;
  background: linear-gradient(135deg, #79f0b7 0%, #78f0e9 100%);
  box-shadow: 0 12px 28px rgba(121, 240, 183, 0.25);
  -webkit-appearance: none;
  appearance: none;
}

.harvey-ai-send:disabled,
.harvey-ai-input:disabled {
  opacity: 0.65;
  cursor: not-allowed;
}

.harvey-ai-footnote {
  margin-top: 12px;
  font-size: 12px;
  line-height: 1.6;
  color: rgba(220, 230, 255, 0.72);
}

@media (max-width: 900px) {
  .harvey-ai-panel {
    width: calc(100vw - 20px);
    max-width: calc(100vw - 20px);
    height: min(84vh, 900px);
    min-height: 640px;
  }
}

@media (max-width: 640px) {
  #harvey-ai-chat-root {
    right: 10px !important;
    bottom: 84px !important;
    left: auto !important;
  }

  .harvey-ai-launch {
    width: 60px;
    height: 60px;
    font-size: 22px;
  }

  .harvey-ai-panel {
    width: calc(100vw - 20px);
    max-width: calc(100vw - 20px);
    height: min(84vh, 860px);
    min-height: 620px;
    bottom: 74px;
    border-radius: 22px;
  }

  .harvey-ai-panel.expanded {
    top: 8px;
    right: 8px;
    bottom: 8px;
    left: 8px;
    border-radius: 18px;
  }

  .harvey-ai-header {
    padding: 16px;
  }

  .harvey-ai-badge {
    width: 56px;
    height: 56px;
    border-radius: 18px;
    font-size: 20px;
  }

  .harvey-ai-title {
    font-size: 18px;
  }

  .harvey-ai-icon-btn {
    width: 46px;
    height: 46px;
    border-radius: 16px;
    font-size: 20px;
  }

  .harvey-ai-body {
    padding: 16px;
  }

  .harvey-ai-bubble {
    max-width: 96%;
    font-size: 15px;
    line-height: 1.65;
    padding: 16px 18px;
  }

  .harvey-ai-suggestions {
    padding: 16px;
  }

  .harvey-ai-suggestion {
    width: 100%;
    text-align: left;
  }

  .harvey-ai-footer {
    padding: 16px;
  }

  .harvey-ai-input {
    min-height: 70px;
    font-size: 15px;
    padding: 16px 18px;
  }

  .harvey-ai-send {
    width: 76px;
    height: 70px;
    border-radius: 20px;
    font-size: 24px;
  }
}
      `;
      document.head.appendChild(style);
    }

    window.HarveyAI = {
      open: function () {
        open();
      },
      close: function () {
        close();
      },
      expand: function () {
        open();
        toggleExpand(true);
      },
      restore: function () {
        toggleExpand(false);
      },
      ask: function (message) {
        open();
        return sendMessage(message);
      },
      reset: function () {
        state.messages = getWelcomeMessages();
        saveMessages();
        renderMessages();
      },
      setContext: function (nextContext) {
        if (!nextContext || typeof nextContext !== "object") return;
        state.riderId = nextContext.rider_id || state.riderId;
        state.driverId = nextContext.driver_id || state.driverId;
        state.rideId = nextContext.ride_id || state.rideId;
      },
      getState: function () {
        return {
          isOpen: state.isOpen,
          isLoading: state.isLoading,
          isExpanded: state.isExpanded,
          page: PAGE_CONTEXT,
          riderId: state.riderId,
          driverId: state.driverId,
          rideId: state.rideId,
          messages: state.messages.slice()
        };
      }
    };

    createWidget();
    console.log("Harvey Taxi AI widget booted");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootHarveyAI);
  } else {
    bootHarveyAI();
  }
})();

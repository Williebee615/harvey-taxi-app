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

    injectStyles();

    const CONFIG = {
      storageKey: "harvey_ai_chat_state_v10",
      endpoint: "/api/ai/support",
      messageLimit: 40,
      rateLimitMs: 1200,
      requestTimeoutMs: 20000,
      autoOpenParam: "openHarveyAI",
      defaultOpenOnPages: [],
      widgetTitle: "Harvey Taxi AI Support"
    };

    const PAGE_CONTEXT = detectPageContext();

    const state = {
      isOpen: false,
      isLoading: false,
      isExpanded: false,
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
        const queryValue = new URLSearchParams(window.location.search).get(name);
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
      } catch (error) {}

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
          "Hi, I’m Harvey Taxi AI Support. I can help with rides, driver onboarding, rider approval, payment questions, support flow, and autonomous pilot guidance.",
        rider:
          "Hi, I’m Harvey Taxi AI Support. I can help explain rider signup, verification, approval, payment authorization, and ride access.",
        driver:
          "Hi, I’m Harvey Taxi AI Support. I can help with driver onboarding, verification, approval, missions, driver status, and payouts.",
        request:
          "Hi, I’m Harvey Taxi AI Support. I can help with fare estimates, ride requests, payment authorization, dispatch flow, and ride availability.",
        support:
          "Hi, I’m Harvey Taxi AI Support. I can help answer support questions about accounts, rides, drivers, approvals, and payments.",
        admin:
          "Hi, I’m Harvey Taxi AI Support. I can help explain platform flow, rider access rules, driver activation flow, dispatch logic, and support processes."
      };

      return map[pageContext] || map.general;
    }

    function buildSuggestions(pageContext) {
      const map = {
        general: [
          "How do I request a ride?",
          "How do I sign up as a driver?",
          "What is Harvey Taxi?",
          "What is autonomous pilot mode?",
          "How does support work?"
        ],
        rider: [
          "Why do riders need approval?",
          "When can I request a ride?",
          "How does payment authorization work?",
          "How do I check my rider status?",
          "What documents do I need?"
        ],
        driver: [
          "How does driver verification work?",
          "When can I start driving?",
          "How do missions work?",
          "How do payouts work?",
          "What do I need before activation?"
        ],
        request: [
          "How is fare estimated?",
          "Why can't I request a ride yet?",
          "How does dispatch work?",
          "Can I request autonomous service?",
          "Why is payment authorization required?"
        ],
        support: [
          "How do I get ride help?",
          "How do I contact support?",
          "How do approvals work?",
          "What if my ride request is blocked?",
          "What does pilot mode mean?"
        ],
        admin: [
          "How does rider approval work?",
          "How does driver activation work?",
          "What is the dispatch flow?",
          "How do mission offers work?",
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
        if (!Array.isArray(parsed) || !parsed.length) return getWelcomeMessages();

        return parsed
          .filter(function (item) {
            return item && typeof item.text === "string" && typeof item.role === "string";
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
          >
            ✦
          </button>

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
                  maxlength="1200"
                  placeholder="Ask Harvey Taxi AI about rides, signup, payment holds, dispatch, missions, support, or autonomous pilot..."
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

      if (shouldAutoOpen()) {
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
          if (!text) return;
          if (state.isLoading) return;

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
    }

    function autoResizeTextarea(textarea) {
      if (!textarea) return;
      textarea.style.height = "auto";
      textarea.style.height = Math.min(textarea.scrollHeight, 180) + "px";
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

    function open() {
      state.isOpen = true;

      const panel = root.querySelector(".harvey-ai-panel");
      if (panel) panel.classList.add("open");

      updateExpandButton();

      const input = root.querySelector("[data-harvey-ai-input]");
      setTimeout(function () {
        if (input) input.focus();
      }, 60);

      scrollToBottom();
    }

    function close() {
      state.isOpen = false;

      const panel = root.querySelector(".harvey-ai-panel");
      if (panel) panel.classList.remove("open");
    }

    function toggleExpand(forceValue) {
      const panel = root.querySelector(".harvey-ai-panel");
      if (!panel) return;

      state.isExpanded =
        typeof forceValue === "boolean" ? forceValue : !state.isExpanded;

      if (state.isExpanded) {
        panel.classList.add("expanded");
      } else {
        panel.classList.remove("expanded");
      }

      updateExpandButton();
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
        "Harvey Taxi AI Support can explain rides, rider approval, driver onboarding, dispatch, payment authorization, and autonomous pilot guidance.";
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
        source: "widget",
        context: {
          page: PAGE_CONTEXT,
          pathname: window.location.pathname || "",
          userAgent: navigator.userAgent || ""
        }
      };
    }

    function parseReply(data) {
      if (!data || typeof data !== "object") return null;

      if (typeof data.reply === "string" && data.reply.trim()) return data.reply.trim();
      if (data.ai && typeof data.ai.reply === "string" && data.ai.reply.trim()) {
        return data.ai.reply.trim();
      }
      if (typeof data.message === "string" && data.message.trim()) return data.message.trim();

      return null;
    }

    async function sendMessage(text) {
      const trimmed = String(text || "").trim();
      if (!trimmed) return;
      if (state.isLoading) return;

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
          "I’m here to help with Harvey Taxi support, rides, onboarding, and platform guidance.";

        addMessage("assistant", reply, CONFIG.widgetTitle);
      } catch (error) {
        console.error("Harvey Taxi AI widget error:", error);

        addMessage(
          "assistant",
          "I’m having trouble reaching Harvey Taxi AI Support right now. Please try again in a moment or use the support page.",
          CONFIG.widgetTitle
        );
      } finally {
        state.isLoading = false;
        renderMessages();
        toggleFormDisabled(false);
      }
    }

    function injectStyles() {
      if (document.getElementById("harvey-ai-widget-inline-styles")) return;

      const style = document.createElement("style");
      style.id = "harvey-ai-widget-inline-styles";
      style.textContent = `
        #harvey-ai-chat-root {
          position: fixed;
          right: 20px;
          bottom: 96px;
          z-index: 99999;
          font-family: Inter, Arial, sans-serif;
        }

        .harvey-ai-widget {
          position: relative;
        }

        .harvey-ai-launch {
          width: 78px;
          height: 78px;
          border: none;
          border-radius: 50%;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 30px;
          font-weight: 900;
          line-height: 1;
          color: #04121f;
          background: linear-gradient(135deg, #63f5ff, #5ea0ff);
          box-shadow:
            0 16px 40px rgba(94,160,255,.38),
            0 0 20px rgba(99,245,255,.45);
          transition: transform .2s ease, box-shadow .2s ease, filter .2s ease;
        }

        .harvey-ai-launch:hover {
          transform: scale(1.05);
          filter: brightness(1.03);
        }

        .harvey-ai-launch:active {
          transform: scale(.98);
        }

        .harvey-ai-panel {
          width: min(940px, calc(100vw - 34px));
          max-width: 940px;
          height: min(84vh, 1200px);
          min-height: 760px;
          display: none;
          flex-direction: column;
          overflow: hidden;
          border-radius: 36px;
          margin-bottom: 18px;
          background:
            radial-gradient(circle at top right, rgba(99,245,255,.10), transparent 24%),
            linear-gradient(180deg, rgba(10,18,40,.98), rgba(4,10,28,.98));
          border: 1px solid rgba(122,162,255,.16);
          box-shadow: 0 28px 90px rgba(0,0,0,.45);
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
        }

        .harvey-ai-panel.open {
          display: flex;
        }

        .harvey-ai-panel.expanded {
          position: fixed;
          top: 20px;
          right: 20px;
          bottom: 20px;
          left: 20px;
          width: auto;
          max-width: none;
          height: auto;
          min-height: 0;
          margin-bottom: 0;
          border-radius: 28px;
          z-index: 100000;
        }

        .harvey-ai-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          padding: 22px 26px;
          border-bottom: 1px solid rgba(255,255,255,.08);
          background: rgba(255,255,255,.02);
        }

        .harvey-ai-header-left {
          display: flex;
          align-items: center;
          gap: 16px;
          min-width: 0;
        }

        .harvey-ai-badge {
          width: 64px;
          height: 64px;
          border-radius: 20px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: linear-gradient(135deg, #63f5ff, #5ea0ff);
          color: #04121f;
          font-size: 20px;
          font-weight: 900;
          flex-shrink: 0;
        }

        .harvey-ai-title-wrap {
          min-width: 0;
        }

        .harvey-ai-title {
          color: #f4f7ff;
          font-size: 22px;
          font-weight: 900;
          line-height: 1.2;
          margin-bottom: 4px;
        }

        .harvey-ai-subtitle {
          color: #aab8de;
          font-size: 14px;
          line-height: 1.5;
        }

        .harvey-ai-actions {
          display: flex;
          gap: 10px;
          flex-shrink: 0;
        }

        .harvey-ai-icon-btn {
          width: 54px;
          height: 54px;
          border-radius: 18px;
          border: 1px solid rgba(255,255,255,.08);
          background: rgba(255,255,255,.04);
          color: #e9f0ff;
          font-size: 24px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .harvey-ai-body {
          flex: 1;
          overflow-y: auto;
          padding: 22px 24px;
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .harvey-ai-message {
          display: flex;
          flex-direction: column;
          gap: 8px;
          max-width: 90%;
        }

        .harvey-ai-message.user {
          align-self: flex-end;
          align-items: flex-end;
        }

        .harvey-ai-message.assistant {
          align-self: flex-start;
          align-items: flex-start;
        }

        .harvey-ai-bubble {
          padding: 20px 22px;
          border-radius: 24px;
          font-size: 18px;
          line-height: 1.72;
          white-space: pre-wrap;
          word-break: break-word;
        }

        .harvey-ai-message.user .harvey-ai-bubble {
          background: linear-gradient(135deg, #63f5ff, #5ea0ff);
          color: #04121f;
          font-weight: 700;
          border-bottom-right-radius: 10px;
        }

        .harvey-ai-message.assistant .harvey-ai-bubble {
          background: rgba(255,255,255,.06);
          color: #f4f7ff;
          border: 1px solid rgba(255,255,255,.07);
          border-bottom-left-radius: 10px;
        }

        .harvey-ai-meta {
          color: #aab8de;
          font-size: 13px;
          line-height: 1.4;
          padding: 0 2px;
        }

        .harvey-ai-system-line {
          color: #aab8de;
          font-size: 13px;
          line-height: 1.7;
          margin-top: 4px;
        }

        .harvey-ai-suggestions {
          padding: 0 24px 20px;
          display: flex;
          flex-wrap: wrap;
          gap: 12px;
          border-top: 1px solid rgba(255,255,255,.06);
          padding-top: 20px;
        }

        .harvey-ai-suggestion {
          border: 1px solid rgba(255,255,255,.08);
          background: rgba(255,255,255,.04);
          color: #dfe8ff;
          border-radius: 999px;
          padding: 13px 20px;
          font-size: 14px;
          font-weight: 800;
          cursor: pointer;
        }

        .harvey-ai-footer {
          padding: 20px 24px 22px;
          border-top: 1px solid rgba(255,255,255,.08);
          background: rgba(255,255,255,.02);
        }

        .harvey-ai-form {
          display: grid;
          grid-template-columns: 1fr 100px;
          gap: 14px;
          align-items: end;
        }

        .harvey-ai-input {
          width: 100%;
          min-height: 78px;
          max-height: 180px;
          resize: none;
          border-radius: 24px;
          border: 1px solid rgba(94,160,255,.28);
          background: rgba(0,18,66,.34);
          color: #f4f7ff;
          font-size: 17px;
          line-height: 1.6;
          padding: 20px 22px;
          outline: none;
        }

        .harvey-ai-input::placeholder {
          color: #aab8de;
        }

        .harvey-ai-send {
          height: 78px;
          border: none;
          border-radius: 24px;
          background: linear-gradient(135deg, #6dffb3, #89ffd0);
          color: #04121f;
          font-size: 32px;
          font-weight: 900;
          cursor: pointer;
        }

        .harvey-ai-send:disabled,
        .harvey-ai-input:disabled {
          opacity: .65;
          cursor: not-allowed;
        }

        .harvey-ai-footnote {
          margin-top: 14px;
          color: #aab8de;
          font-size: 12px;
          line-height: 1.7;
        }

        .harvey-ai-typing {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          padding: 16px 18px;
          border-radius: 18px;
          background: rgba(255,255,255,.06);
          border: 1px solid rgba(255,255,255,.07);
        }

        .harvey-ai-typing-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: #b7c7f2;
          opacity: .7;
          animation: harveyAiTyping 1.1s infinite ease-in-out;
        }

        .harvey-ai-typing-dot:nth-child(2) {
          animation-delay: .15s;
        }

        .harvey-ai-typing-dot:nth-child(3) {
          animation-delay: .3s;
        }

        @keyframes harveyAiTyping {
          0%, 80%, 100% {
            transform: scale(.8);
            opacity: .45;
          }
          40% {
            transform: scale(1);
            opacity: 1;
          }
        }

        @media (max-width: 900px) {
          #harvey-ai-chat-root {
            right: 14px;
            bottom: 88px;
          }

          .harvey-ai-launch {
            width: 72px;
            height: 72px;
            font-size: 30px;
          }

          .harvey-ai-panel {
            width: calc(100vw - 28px);
            max-width: calc(100vw - 28px);
            height: min(82vh, 1000px);
            min-height: 680px;
            border-radius: 28px;
          }

          .harvey-ai-panel.expanded {
            top: 10px;
            right: 10px;
            bottom: 10px;
            left: 10px;
            border-radius: 22px;
          }

          .harvey-ai-header {
            padding: 18px;
          }

          .harvey-ai-badge {
            width: 56px;
            height: 56px;
            font-size: 17px;
            border-radius: 18px;
          }

          .harvey-ai-title {
            font-size: 19px;
          }

          .harvey-ai-icon-btn {
            width: 48px;
            height: 48px;
            border-radius: 16px;
            font-size: 22px;
          }

          .harvey-ai-body {
            padding: 18px;
          }

          .harvey-ai-bubble {
            font-size: 16px;
            line-height: 1.65;
            padding: 18px 20px;
          }

          .harvey-ai-suggestions {
            padding: 18px;
            gap: 10px;
          }

          .harvey-ai-suggestion {
            width: 100%;
            text-align: left;
          }

          .harvey-ai-footer {
            padding: 18px;
          }

          .harvey-ai-form {
            grid-template-columns: 1fr 82px;
          }

          .harvey-ai-input {
            min-height: 68px;
            font-size: 16px;
            padding: 18px 20px;
          }

          .harvey-ai-send {
            height: 68px;
            border-radius: 20px;
            font-size: 28px;
          }
        }

        @media (max-width: 600px) {
          .harvey-ai-panel {
            width: calc(100vw - 20px);
            max-width: calc(100vw - 20px);
            height: min(84vh, 920px);
            min-height: 620px;
            border-radius: 24px;
          }

          .harvey-ai-message {
            max-width: 94%;
          }

          .harvey-ai-bubble {
            font-size: 15px;
            line-height: 1.6;
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

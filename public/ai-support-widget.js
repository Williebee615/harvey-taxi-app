(function () {
  function bootHarveyAI() {
    let root = document.getElementById("harvey-ai-chat-root");

    if (!root) {
      root = document.createElement("div");
      root.id = "harvey-ai-chat-root";
      document.body.appendChild(root);
    } else if (root.parentElement !== document.body) {
      document.body.appendChild(root);
    }

    injectStyles();

    const STORAGE_KEY = "harvey_ai_chat_state_v7";
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
      if (path.includes("rider-signup")) return "rider";
      if (path.includes("driver-signup")) return "driver";
      if (path.includes("request-ride")) return "request";
      if (path.includes("driver-dashboard")) return "driver";
      if (path.includes("rider-dashboard")) return "rider";
      return "general";
    }

    function readContextValue(name) {
      try {
        const query = new URLSearchParams(window.location.search).get(name);
        if (query) return query;
        return sessionStorage.getItem(name) || localStorage.getItem(name) || null;
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
          meta: "Harvey Taxi AI Support"
        }
      ];
    }

    function getWelcomeTextByPage(pageContext) {
      const map = {
        general:
          "Hi, I’m Harvey Taxi AI Support. I can help with rides, support, driver onboarding, rider approval, payment questions, and platform guidance.",
        rider:
          "Hi, I’m Harvey Taxi AI Support. I can help explain rider signup, verification, approval, payment holds, and ride access.",
        driver:
          "Hi, I’m Harvey Taxi AI Support. I can help with driver onboarding, verification, approval, missions, and payouts.",
        request:
          "Hi, I’m Harvey Taxi AI Support. I can help with fare questions, trip requests, payment authorization, and dispatch flow."
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

    function injectStyles() {
      if (document.getElementById("harvey-ai-widget-inline-styles")) return;

      const style = document.createElement("style");
      style.id = "harvey-ai-widget-inline-styles";
      style.textContent = `
        #harvey-ai-chat-root {
          position: fixed;
          right: 18px;
          bottom: 92px;
          z-index: 99999;
          font-family: Inter, Arial, sans-serif;
        }

        .harvey-ai-widget {
          position: relative;
        }

        .harvey-ai-launch {
          width: 72px;
          height: 72px;
          border: none;
          border-radius: 50%;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 34px;
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
          width: min(780px, calc(100vw - 28px));
          max-width: 780px;
          height: min(78vh, 1080px);
          display: none;
          flex-direction: column;
          overflow: hidden;
          border-radius: 34px;
          margin-bottom: 16px;
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

        .harvey-ai-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 14px;
          padding: 18px 22px;
          border-bottom: 1px solid rgba(255,255,255,.08);
          background: rgba(255,255,255,.02);
        }

        .harvey-ai-header-left {
          display: flex;
          align-items: center;
          gap: 14px;
          min-width: 0;
        }

        .harvey-ai-badge {
          width: 58px;
          height: 58px;
          border-radius: 18px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: linear-gradient(135deg, #63f5ff, #5ea0ff);
          color: #04121f;
          font-size: 32px;
          font-weight: 900;
          flex-shrink: 0;
        }

        .harvey-ai-title-wrap {
          min-width: 0;
        }

        .harvey-ai-title {
          color: #f4f7ff;
          font-size: 20px;
          font-weight: 900;
          line-height: 1.2;
          margin-bottom: 4px;
        }

        .harvey-ai-subtitle {
          color: #aab8de;
          font-size: 13px;
          line-height: 1.5;
        }

        .harvey-ai-actions {
          display: flex;
          gap: 10px;
          flex-shrink: 0;
        }

        .harvey-ai-icon-btn {
          width: 52px;
          height: 52px;
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
          padding: 18px 20px;
          display: flex;
          flex-direction: column;
          gap: 14px;
        }

        .harvey-ai-message {
          display: flex;
          flex-direction: column;
          gap: 8px;
          max-width: 88%;
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
          padding: 18px 20px;
          border-radius: 22px;
          font-size: 16px;
          line-height: 1.65;
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
          font-size: 12px;
          line-height: 1.4;
          padding: 0 2px;
        }

        .harvey-ai-system-line {
          color: #aab8de;
          font-size: 12px;
          line-height: 1.6;
          margin-top: 2px;
        }

        .harvey-ai-suggestions {
          padding: 0 20px 18px;
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
          border-top: 1px solid rgba(255,255,255,.06);
          padding-top: 18px;
        }

        .harvey-ai-suggestion {
          border: 1px solid rgba(255,255,255,.08);
          background: rgba(255,255,255,.04);
          color: #dfe8ff;
          border-radius: 999px;
          padding: 12px 18px;
          font-size: 14px;
          font-weight: 800;
          cursor: pointer;
        }

        .harvey-ai-footer {
          padding: 18px 20px 20px;
          border-top: 1px solid rgba(255,255,255,.08);
          background: rgba(255,255,255,.02);
        }

        .harvey-ai-form {
          display: grid;
          grid-template-columns: 1fr 92px;
          gap: 12px;
          align-items: end;
        }

        .harvey-ai-input {
          width: 100%;
          min-height: 68px;
          max-height: 140px;
          resize: none;
          border-radius: 22px;
          border: 1px solid rgba(94,160,255,.28);
          background: rgba(0,18,66,.34);
          color: #f4f7ff;
          font-size: 16px;
          line-height: 1.55;
          padding: 18px 20px;
          outline: none;
        }

        .harvey-ai-input::placeholder {
          color: #aab8de;
        }

        .harvey-ai-send {
          height: 68px;
          border: none;
          border-radius: 22px;
          background: linear-gradient(135deg, #6dffb3, #89ffd0);
          color: #04121f;
          font-size: 30px;
          font-weight: 900;
          cursor: pointer;
        }

        .harvey-ai-send:disabled,
        .harvey-ai-input:disabled {
          opacity: .65;
          cursor: not-allowed;
        }

        .harvey-ai-footnote {
          margin-top: 12px;
          color: #aab8de;
          font-size: 12px;
          line-height: 1.65;
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

        @media (max-width: 700px) {
          #harvey-ai-chat-root {
            right: 14px;
            bottom: 88px;
          }

          .harvey-ai-launch {
            width: 72px;
            height: 72px;
            font-size: 36px;
          }

          .harvey-ai-panel {
            width: calc(100vw - 28px);
            height: min(76vh, 900px);
            border-radius: 28px;
          }

          .harvey-ai-header {
            padding: 16px 16px;
          }

          .harvey-ai-badge {
            width: 52px;
            height: 52px;
            font-size: 28px;
            border-radius: 16px;
          }

          .harvey-ai-title {
            font-size: 18px;
          }

          .harvey-ai-icon-btn {
            width: 48px;
            height: 48px;
            border-radius: 16px;
            font-size: 22px;
          }

          .harvey-ai-body {
            padding: 16px;
          }

          .harvey-ai-bubble {
            font-size: 15px;
            padding: 16px 18px;
          }

          .harvey-ai-suggestions {
            padding: 16px;
            gap: 10px;
          }

          .harvey-ai-suggestion {
            width: 100%;
            text-align: left;
          }

          .harvey-ai-footer {
            padding: 16px;
          }

          .harvey-ai-form {
            grid-template-columns: 1fr 78px;
          }

          .harvey-ai-input {
            min-height: 62px;
            font-size: 15px;
            padding: 16px 18px;
          }

          .harvey-ai-send {
            height: 62px;
            border-radius: 20px;
            font-size: 28px;
          }
        }
      `;
      document.head.appendChild(style);
    }

    function createWidget() {
      root.innerHTML = `
        <div class="harvey-ai-widget">
          <button
            class="harvey-ai-launch"
            type="button"
            aria-label="Open Harvey Taxi AI Support"
            title="Open Harvey Taxi AI Support"
            data-harvey-ai-open
          >+</button>

          <section class="harvey-ai-panel" aria-live="polite" aria-label="Harvey Taxi AI Support chat panel">
            <div class="harvey-ai-header">
              <div class="harvey-ai-header-left">
                <div class="harvey-ai-badge">+</div>
                <div class="harvey-ai-title-wrap">
                  <div class="harvey-ai-title">Harvey Taxi AI Support</div>
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
                  placeholder="Ask Harvey Taxi AI about rides, signup, payment holds, dispatch, missions, support, or autonomous pilot..."
                ></textarea>
                <button class="harvey-ai-send" data-harvey-ai-send type="submit" aria-label="Send message">➜</button>
              </form>
              <div class="harvey-ai-footnote">
                Harvey Taxi AI Support explains platform flow and support guidance. For emergencies, contact local emergency services immediately.
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
      if (panel) {
        panel.classList.add("open");
      }

      const input = root.querySelector("[data-harvey-ai-input]");
      setTimeout(function () {
        if (input) input.focus();
      }, 80);

      scrollToBottom();
    }

    function close() {
      state.isOpen = false;
      const panel = root.querySelector(".harvey-ai-panel");
      if (panel) {
        panel.classList.remove("open");
      }
    }

    function addMessage(role, text, meta) {
      state.messages.push({
        role,
        text,
        meta: meta || (role === "user" ? "You" : "Harvey Taxi AI Support")
      });
      saveMessages();
      renderMessages();
    }

    function renderMessages() {
      const body = root.querySelector("[data-harvey-ai-body]");
      if (!body) return;

      body.innerHTML = "";

      state.messages.forEach(function (message) {
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
          <div class="harvey-ai-typing" aria-label="Harvey Taxi AI Support is typing">
            <span class="harvey-ai-typing-dot"></span>
            <span class="harvey-ai-typing-dot"></span>
            <span class="harvey-ai-typing-dot"></span>
          </div>
          <div class="harvey-ai-meta">Harvey Taxi AI Support</div>
        `;
        body.appendChild(typingWrap);
      }

      const systemLine = document.createElement("div");
      systemLine.className = "harvey-ai-system-line";
      systemLine.textContent =
        "Harvey Taxi AI Support can explain rides, support flow, driver onboarding, rider approval, and autonomous pilot status.";
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

        const data = await response.json().catch(function () {
          return null;
        });

        if (!response.ok) {
          throw new Error((data && data.error) || "Harvey Taxi AI Support could not respond right now.");
        }

        const reply =
          (data && (data.reply || (data.ai && data.ai.reply))) ||
          "I’m here to help with Harvey Taxi support.";

        addMessage("assistant", reply, "Harvey Taxi AI Support");
      } catch (error) {
        console.error("Harvey Taxi AI widget error:", error);
        addMessage(
          "assistant",
          "I’m having trouble reaching Harvey Taxi AI Support right now. Please try again in a moment or use the support page.",
          "Harvey Taxi AI Support"
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
      open: open,
      close: close,
      ask: function (message) {
        open();
        return sendMessage(message);
      },
      setContext: function (nextContext) {
        if (!nextContext || typeof nextContext !== "object") return;
        state.riderId = nextContext.rider_id || state.riderId;
        state.driverId = nextContext.driver_id || state.driverId;
        state.rideId = nextContext.ride_id || state.rideId;
      },
      reset: function () {
        state.messages = getWelcomeMessages();
        saveMessages();
        renderMessages();
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

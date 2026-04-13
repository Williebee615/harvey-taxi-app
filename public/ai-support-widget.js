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
      storageKey: "harvey_ai_chat_state_v12",
      endpoint: "/api/ai/support",
      messageLimit: 50,
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
          "Hi, I’m Harvey Taxi AI Support. I can help with rides, rider approval, driver onboarding, payment authorization, dispatch, and autonomous pilot guidance.",
        rider:
          "Hi, I’m Harvey Taxi AI Support. I can help explain rider signup, rider approval, payment authorization, and ride access.",
        driver:
          "Hi, I’m Harvey Taxi AI Support. I can help with driver onboarding, verification, approval, missions, driver status, and payout questions.",
        request:
          "Hi, I’m Harvey Taxi AI Support. I can help with fare estimates, payment authorization, ride requests, dispatch flow, and ride availability.",
        support:
          "Hi, I’m Harvey Taxi AI Support. I can help with support questions about accounts, rides, approvals, dispatch, and payment flow.",
        admin:
          "Hi, I’m Harvey Taxi AI Support. I can help explain rider access rules, driver activation flow, dispatch logic, and support processes."
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
                  maxlength="1200"
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
        source: "widget"
      };
    }

    function parseReply(data) {
      if (!data || typeof data !== "object") return null;

      if (typeof data.reply === "string" && data.reply.trim()) {
        return data.reply.trim();
      }

      if (data.ai && typeof data.ai.reply === "string" && data.ai.reply.trim()) {
        return data.ai.reply.trim();
      }

      if (
        data.ok &&
        typeof data.message === "string" &&
        data.message.trim() &&
        !/response generated/i.test(data.message)
      ) {
        return data.message.trim();
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
          "I’m here to help with Harvey Taxi support, rides, onboarding, approvals, payment authorization, and platform guidance.";

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

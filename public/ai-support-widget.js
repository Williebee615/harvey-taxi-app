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
      storageKey: "harvey_ai_chat_state_v23",
      uiStateKey: "harvey_ai_chat_ui_state_v23",
      endpoint: "/api/ai/support",
      messageLimit: 160,
      rateLimitMs: 900,
      requestTimeoutMs: 25000,
      autoOpenParam: "openHarveyAI",
      defaultOpenOnPages: [],
      widgetTitle: "Harvey Taxi AI Support",
      foundationUrl: "foundation.html",
      donationUrl: "https://buy.stripe.com/00w14g14g3JrcpEc4i6kg00",
      fallbackError:
        "I’m having trouble reaching Harvey Taxi AI Support right now. Please try again in a moment.",
      assistantMeta: "Harvey Taxi AI Support",
      emergencyNotice:
        "Harvey Taxi AI Support provides platform guidance only. For emergencies, contact local emergency services immediately.",
      systemLine:
        "Harvey Taxi AI Support can explain rides, rider approval, driver onboarding, dispatch, mission status, payment authorization, autonomous pilot guidance, and foundation support."
    };

    injectStyles();

    const PAGE_CONTEXT = detectPageContext();
    const savedUiState = loadUiState();

    const state = {
      isOpen: !!savedUiState.isOpen,
      isExpanded: !!savedUiState.isExpanded,
      isLoading: false,
      messages: loadMessages(),
      riderId: readContextValue("rider_id"),
      driverId: readContextValue("driver_id"),
      rideId: readContextValue("ride_id"),
      lastSentAt: 0
    };

    function detectPageContext() {
      const path = String(window.location.pathname || "").toLowerCase();

      if (path.includes("foundation")) return "foundation";
      if (path.includes("rider-signup")) return "rider";
      if (path.includes("rider-dashboard")) return "rider";
      if (path.includes("driver-signup")) return "driver";
      if (path.includes("driver-dashboard")) return "driver";
      if (path.includes("request-ride")) return "request";
      if (path.includes("support")) return "support";
      if (path.includes("admin")) return "admin";
      if (path.includes("index") || path === "/" || path.endsWith("/")) return "general";

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
      } catch (_error) {}

      return null;
    }

    function safeJsonParse(value, fallback) {
      try {
        return JSON.parse(value);
      } catch (_error) {
        return fallback;
      }
    }

    function shouldAutoOpen() {
      try {
        const params = new URLSearchParams(window.location.search);
        if (params.get(CONFIG.autoOpenParam) === "1") return true;
      } catch (_error) {}

      return CONFIG.defaultOpenOnPages.includes(PAGE_CONTEXT);
    }

    function getWelcomeMessages() {
      return [
        {
          role: "assistant",
          text: getWelcomeTextByPage(PAGE_CONTEXT),
          meta: CONFIG.assistantMeta,
          ts: Date.now()
        }
      ];
    }

    function getWelcomeTextByPage(pageContext) {
      const map = {
        general:
          "Hi, I’m Harvey Taxi AI Support. I can help with rides, rider approval, driver onboarding, payment authorization, dispatch, mission flow, autonomous pilot guidance, and Harvey Transportation Assistance Foundation questions.",
        rider:
          "Hi, I’m Harvey Taxi AI Support. I can help explain rider signup, rider approval, payment authorization, ride access, and account support.",
        driver:
          "Hi, I’m Harvey Taxi AI Support. I can help with driver onboarding, verification, approval, missions, driver status, payouts, and support guidance.",
        request:
          "Hi, I’m Harvey Taxi AI Support. I can help with fare estimates, payment authorization, ride requests, dispatch flow, trip updates, and ride availability.",
        support:
          "Hi, I’m Harvey Taxi AI Support. I can help with support questions about accounts, rides, approvals, dispatch, payments, autonomous pilot mode, and foundation access.",
        admin:
          "Hi, I’m Harvey Taxi AI Support. I can help explain rider access rules, driver activation flow, dispatch logic, payment holds, trip operations, and support processes.",
        foundation:
          "Hi, I’m Harvey Taxi AI Support. I can help explain the Harvey Transportation Assistance Foundation mission, transportation access support, donations, and how community giving connects to the Harvey ecosystem."
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
          "How do I support the foundation?"
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
          "How do I request a ride?",
          "How do I sign up as a driver?",
          "What is Harvey Taxi?",
          "What is autonomous pilot mode?",
          "How do I support the foundation?"
        ],
        admin: [
          "How does rider approval work?",
          "How does driver activation work?",
          "What is the dispatch flow?",
          "How do payment holds work?"
        ],
        foundation: [
          "What does the foundation support?",
          "How do I donate?",
          "How do donations help transportation access?",
          "How is the foundation connected to Harvey Taxi?"
        ]
      };

      return map[pageContext] || map.general;
    }

    function buildQuickActions(pageContext) {
      const base = [
        {
          label: "Foundation",
          action: "link",
          href: CONFIG.foundationUrl,
          style: "gold"
        },
        {
          label: "Donate",
          action: "link",
          href: CONFIG.donationUrl,
          external: true,
          style: "green"
        }
      ];

      const pageSpecific = {
        general: [
          { label: "Request Ride", action: "link", href: "request-ride.html?mode=driver" },
          { label: "Driver Signup", action: "link", href: "driver-signup.html" },
          { label: "Ask About Pilot", action: "message", message: "What is autonomous pilot mode?" }
        ],
        rider: [
          { label: "Rider Status", action: "message", message: "How do I check my rider status?" },
          { label: "Payment Help", action: "message", message: "How does payment authorization work?" }
        ],
        driver: [
          { label: "Driver Missions", action: "message", message: "How do missions work?" },
          { label: "Payout Help", action: "message", message: "How do payouts work?" }
        ],
        request: [
          { label: "Fare Help", action: "message", message: "How is fare estimated?" },
          { label: "Dispatch Flow", action: "message", message: "How does dispatch work?" }
        ],
        support: [
          { label: "Ride Help", action: "message", message: "How do I request a ride?" },
          { label: "Approvals", action: "message", message: "How do approvals work?" }
        ],
        admin: [
          { label: "Rider Approval", action: "message", message: "How does rider approval work?" },
          { label: "Driver Activation", action: "message", message: "How does driver activation work?" }
        ],
        foundation: [
          { label: "Foundation Mission", action: "message", message: "What does the foundation support?" },
          { label: "Donate Now", action: "link", href: CONFIG.donationUrl, external: true, style: "green" }
        ]
      };

      return (pageSpecific[pageContext] || pageSpecific.general).concat(base);
    }

    function formatPageSubtitle(pageContext) {
      const map = {
        general: "General support",
        rider: "Rider support",
        driver: "Driver support",
        request: "Ride request support",
        support: "Customer support",
        admin: "Platform support",
        foundation: "Foundation support"
      };

      return map[pageContext] || "Platform support";
    }

    function loadMessages() {
      try {
        const raw = sessionStorage.getItem(CONFIG.storageKey);
        if (!raw) return getWelcomeMessages();

        const parsed = safeJsonParse(raw, null);

        if (!Array.isArray(parsed) || !parsed.length) {
          return getWelcomeMessages();
        }

        return parsed
          .filter(function (item) {
            return item && typeof item.role === "string" && typeof item.text === "string";
          })
          .slice(-CONFIG.messageLimit);
      } catch (_error) {
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
        if (!raw) return { isOpen: false, isExpanded: true };

        const parsed = safeJsonParse(raw, {});
        return {
          isOpen: !!parsed.isOpen,
          isExpanded: parsed.isExpanded !== false
        };
      } catch (_error) {
        return { isOpen: false, isExpanded: true };
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
          >
            <span class="harvey-ai-launch-icon">✦</span>
            <span class="harvey-ai-launch-ping"></span>
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
                  data-harvey-ai-reset
                  title="New chat"
                  aria-label="New chat"
                >↺</button>

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
                  data-harvey-ai-close
                  title="Close chat"
                  aria-label="Close chat"
                >✕</button>
              </div>
            </div>

            <div class="harvey-ai-layout">
              <aside class="harvey-ai-sidebar">
                <div class="harvey-ai-support-window">
                  <div class="harvey-ai-support-window-head">
                    <div class="harvey-ai-support-window-title">Suggested Questions</div>
                    <div class="harvey-ai-support-window-subtitle">Tap a topic below to ask instantly</div>
                  </div>
                  <div class="harvey-ai-support-grid" data-harvey-ai-support-grid></div>
                </div>

                <div class="harvey-ai-quick-actions" data-harvey-ai-quick-actions></div>
              </aside>

              <section class="harvey-ai-conversation-zone">
                <div class="harvey-ai-body" data-harvey-ai-body></div>

                <div class="harvey-ai-inline-composer">
                  <div class="harvey-ai-composer-label">Ask Harvey Taxi AI</div>

                  <form class="harvey-ai-form" data-harvey-ai-form>
                    <textarea
                      class="harvey-ai-input"
                      data-harvey-ai-input
                      rows="1"
                      maxlength="1400"
                      placeholder="Ask Harvey Taxi AI about rides, signup, approvals, dispatch, payment authorization, pilot mode, or foundation support..."
                    ></textarea>

                    <button
                      class="harvey-ai-send"
                      data-harvey-ai-send
                      type="submit"
                      aria-label="Send message"
                    >➜</button>
                  </form>

                  <div class="harvey-ai-footnote">
                    ${escapeHtml(CONFIG.emergencyNotice)}
                  </div>
                </div>
              </section>
            </div>
          </section>
        </div>
      `;

      bindEvents();
      renderMessages();
      renderSupportGrid();
      renderQuickActions();
      syncPanelState();

      if (shouldAutoOpen() && !state.isOpen) {
        open();
      }
    }

    function bindEvents() {
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
          renderSupportGrid();
          renderQuickActions();

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
            if (form && typeof form.requestSubmit === "function") {
              form.requestSubmit();
            } else if (form) {
              form.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
            }
          }
        });
      }

      document.addEventListener("keydown", function (event) {
        if (event.key === "Escape" && state.isOpen) {
          close();
        }
      });

      window.addEventListener("resize", function () {
        scrollToBottom();
      });
    }

    function autoResizeTextarea(textarea) {
      if (!textarea) return;
      textarea.style.height = "auto";
      textarea.style.height = Math.min(textarea.scrollHeight, 180) + "px";
    }

    function syncPanelState() {
      const panel = root.querySelector(".harvey-ai-panel");
      const launch = root.querySelector(".harvey-ai-launch");
      if (!panel || !launch) return;

      panel.classList.toggle("open", !!state.isOpen);
      panel.classList.toggle("expanded", !!state.isExpanded);
      launch.classList.toggle("hidden-launch", !!state.isOpen);

      saveUiState();
    }

    function open() {
      state.isOpen = true;
      syncPanelState();

      const input = root.querySelector("[data-harvey-ai-input]");
      setTimeout(function () {
        if (input) input.focus();
      }, 60);
    }

    function close() {
      state.isOpen = false;
      syncPanelState();
    }

    function toggleExpand() {
      state.isExpanded = !state.isExpanded;
      syncPanelState();
    }

    function addMessage(role, text, meta, data) {
      state.messages.push({
        role: role === "user" ? "user" : "assistant",
        text: String(text || ""),
        meta: meta || (role === "user" ? "You" : CONFIG.assistantMeta),
        ts: Date.now(),
        card: data && data.card ? data.card : null
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
          message.meta || (message.role === "user" ? "You" : CONFIG.assistantMeta)
        );

        wrapper.appendChild(bubble);

        if (message.card && message.role !== "user") {
          const card = document.createElement("div");
          card.className = "harvey-ai-inline-card";

          if (message.card.title) {
            const title = document.createElement("strong");
            title.textContent = message.card.title;
            card.appendChild(title);
          }

          if (message.card.text) {
            const text = document.createElement("span");
            text.textContent = message.card.text;
            card.appendChild(text);
          }

          if (message.card.href) {
            const link = document.createElement("a");
            link.className = "harvey-ai-inline-link";
            link.href = message.card.href;
            link.textContent = message.card.label || "Open";
            if (message.card.external) {
              link.target = "_blank";
              link.rel = "noopener noreferrer";
            }
            card.appendChild(link);
          }

          wrapper.appendChild(card);
        }

        wrapper.appendChild(meta);
        body.appendChild(wrapper);
      });

      if (state.isLoading) {
        const typingWrap = document.createElement("div");
        typingWrap.className = "harvey-ai-message assistant";

        const typing = document.createElement("div");
        typing.className = "harvey-ai-typing";

        for (let i = 0; i < 3; i += 1) {
          const dot = document.createElement("span");
          dot.className = "harvey-ai-typing-dot";
          typing.appendChild(dot);
        }

        typingWrap.appendChild(typing);
        body.appendChild(typingWrap);
      }

      const systemLine = document.createElement("div");
      systemLine.className = "harvey-ai-system-line";
      systemLine.textContent = CONFIG.systemLine;
      body.appendChild(systemLine);

      scrollToBottom();
    }

    function renderSupportGrid() {
      const container = root.querySelector("[data-harvey-ai-support-grid]");
      if (!container) return;

      container.innerHTML = "";

      buildSuggestions(PAGE_CONTEXT).forEach(function (prompt, index) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "harvey-ai-support-card" + (index === 0 ? " primary" : "");
        button.innerHTML = `
          <span class="harvey-ai-support-card-text">${escapeHtml(prompt)}</span>
          <span class="harvey-ai-support-card-arrow">→</span>
        `;

        button.addEventListener("click", function () {
          if (state.isLoading) return;
          open();
          sendMessage(prompt);
        });

        container.appendChild(button);
      });
    }

    function renderQuickActions() {
      const container = root.querySelector("[data-harvey-ai-quick-actions]");
      if (!container) return;

      container.innerHTML = "";

      buildQuickActions(PAGE_CONTEXT).forEach(function (item) {
        const button = document.createElement(item.action === "link" ? "a" : "button");

        button.className =
          "harvey-ai-quick-action" +
          (item.style === "green" ? " green" : "") +
          (item.style === "gold" ? " gold" : "");

        if (item.action === "link") {
          button.href = item.href;
          if (item.external) {
            button.target = "_blank";
            button.rel = "noopener noreferrer";
          }
        } else {
          button.type = "button";
          button.addEventListener("click", function () {
            if (state.isLoading) return;
            open();
            sendMessage(item.message);
          });
        }

        button.textContent = item.label;
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
        foundation_url: CONFIG.foundationUrl,
        donation_url: CONFIG.donationUrl
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

    function maybeBuildLocalCard(messageText, replyText) {
      const combined = (String(messageText || "") + " " + String(replyText || "")).toLowerCase();

      if (
        combined.includes("foundation") ||
        combined.includes("donate") ||
        combined.includes("donation") ||
        combined.includes("transportation access")
      ) {
        return {
          title: "Harvey Transportation Assistance Foundation",
          text: "Support transportation access for medical appointments, work, school, and essential community mobility.",
          href: CONFIG.foundationUrl,
          label: "Open Foundation",
          external: false
        };
      }

      return null;
    }

    async function safeParseResponse(response) {
      const text = await response.text();
      const data = safeJsonParse(text, null);
      return { text: text, data: data };
    }

    function buildLocalFallback(trimmed) {
      const message = String(trimmed || "").toLowerCase();

      if (message.includes("foundation") || message.includes("donate") || message.includes("donation")) {
        return {
          reply:
            "Harvey Transportation Assistance Foundation helps remove transportation barriers for medical appointments, work, school, and community mobility. You can open the foundation page or use the secure donation link to support transportation access.",
          card: {
            title: "Support Transportation Access",
            text: "Visit the foundation page or donate securely to help expand community mobility support.",
            href: CONFIG.foundationUrl,
            label: "Open Foundation",
            external: false
          }
        };
      }

      if (message.includes("pilot") || message.includes("autonomous")) {
        return {
          reply:
            "Autonomous Pilot is a clearly labeled pilot experience. Standard Harvey rides are fulfilled by human drivers today, and pilot experiences should only be used where available.",
          card: null
        };
      }

      if (message.includes("driver")) {
        return {
          reply:
            "I can help with driver onboarding, verification, approval, missions, and payout guidance. You can also open the driver signup flow or dashboard from the platform.",
          card: null
        };
      }

      if (message.includes("rider") || message.includes("ride")) {
        return {
          reply:
            "I can help explain rider approval, payment authorization, ride requests, dispatch flow, and trip support. Harvey Taxi uses a structured access flow before live ride activity begins.",
          card: null
        };
      }

      return {
        reply:
          "I’m here to help with Harvey Taxi support, rides, onboarding, approvals, payment authorization, dispatch, mission guidance, and foundation support.",
        card: null
      };
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

        const parsed = await safeParseResponse(response);
        const data = parsed.data;

        if (!response.ok) {
          throw new Error(
            (data && (data.error || data.message)) ||
              "Harvey Taxi AI Support could not respond right now."
          );
        }

        const reply =
          parseReply(data) ||
          "I’m here to help with Harvey Taxi support, rides, onboarding, approvals, payment authorization, dispatch, mission guidance, and foundation support.";

        addMessage(
          "assistant",
          reply,
          CONFIG.assistantMeta,
          { card: maybeBuildLocalCard(trimmed, reply) }
        );
      } catch (error) {
        console.error("Harvey Taxi AI widget error:", error);

        let message = CONFIG.fallbackError;
        let card = null;

        const lowered = String((error && error.message) || "").toLowerCase();

        if (lowered.includes("timeout")) {
          message =
            "Harvey Taxi AI Support took too long to respond. Please try again in a moment.";
        } else if (
          lowered.includes("failed to fetch") ||
          lowered.includes("network") ||
          lowered.includes("load")
        ) {
          message =
            "Harvey Taxi AI Support could not reach the server. Please try again in a moment.";
        } else {
          const fallback = buildLocalFallback(trimmed);
          message = fallback.reply;
          card = fallback.card;
        }

        addMessage("assistant", message, CONFIG.assistantMeta, { card: card });
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
  right: 12px !important;
  bottom: calc(88px + env(safe-area-inset-bottom, 0px)) !important;
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
  position: relative;
  width: 66px;
  height: 66px;
  border: none;
  border-radius: 999px;
  cursor: pointer;
  font-size: 24px;
  font-weight: 900;
  color: #06111f;
  background: linear-gradient(135deg, #6ee7ff 0%, #7aa2ff 100%);
  box-shadow: 0 18px 40px rgba(0, 0, 0, 0.35);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  -webkit-appearance: none;
  appearance: none;
  transition: transform 0.18s ease, filter 0.18s ease, opacity 0.2s ease;
  overflow: hidden;
}

.harvey-ai-launch.hidden-launch {
  opacity: 0;
  pointer-events: none;
}

.harvey-ai-launch:hover {
  transform: translateY(-2px);
  filter: brightness(1.04);
}

.harvey-ai-launch-icon {
  position: relative;
  z-index: 2;
}

.harvey-ai-launch-ping {
  position: absolute;
  inset: 0;
  border-radius: inherit;
  box-shadow: 0 0 0 0 rgba(110, 231, 255, 0.36);
  animation: harveyAiPing 2.4s infinite;
}

@keyframes harveyAiPing {
  0% { box-shadow: 0 0 0 0 rgba(110, 231, 255, 0.34); }
  70% { box-shadow: 0 0 0 18px rgba(110, 231, 255, 0); }
  100% { box-shadow: 0 0 0 0 rgba(110, 231, 255, 0); }
}

.harvey-ai-panel {
  position: fixed;
  top: max(12px, env(safe-area-inset-top, 0px));
  right: 12px;
  bottom: calc(88px + env(safe-area-inset-bottom, 0px));
  left: 12px;
  display: none;
  flex-direction: column;
  overflow: hidden;
  border-radius: 28px;
  border: 1px solid rgba(120, 170, 255, 0.16);
  background: linear-gradient(180deg, rgba(8,18,36,.985), rgba(5,11,24,.985));
  color: #ffffff;
  box-shadow: 0 28px 70px rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
}

.harvey-ai-panel.open {
  display: flex;
}

.harvey-ai-panel:not(.expanded) {
  top: auto;
  left: auto;
  width: min(920px, calc(100vw - 24px));
  height: min(82vh, 900px);
  bottom: calc(88px + env(safe-area-inset-bottom, 0px));
}

.harvey-ai-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 18px 18px 14px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  flex-shrink: 0;
}

.harvey-ai-header-left {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.harvey-ai-badge {
  width: 56px;
  height: 56px;
  border-radius: 18px;
  display: grid;
  place-items: center;
  font-size: 21px;
  font-weight: 900;
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
  font-size: 12px;
  color: rgba(230, 238, 255, 0.72);
  line-height: 1.4;
}

.harvey-ai-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

.harvey-ai-icon-btn {
  width: 42px;
  height: 42px;
  border: 1px solid rgba(255,255,255,.08);
  border-radius: 14px;
  cursor: pointer;
  font-size: 18px;
  color: #ffffff;
  background: rgba(255,255,255,.06);
  -webkit-appearance: none;
  appearance: none;
}

.harvey-ai-layout {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 340px 1fr;
}

.harvey-ai-sidebar {
  min-height: 0;
  overflow-y: auto;
  border-right: 1px solid rgba(255,255,255,.06);
  background: linear-gradient(180deg, rgba(5,12,25,.46), rgba(7,14,28,.82));
}

.harvey-ai-support-window {
  margin: 14px;
  padding: 16px;
  border-radius: 22px;
  background: linear-gradient(180deg, rgba(8,18,40,.96), rgba(4,12,28,.96));
  border: 1px solid rgba(110, 170, 255, 0.14);
  box-shadow: 0 14px 28px rgba(0, 0, 0, 0.26), inset 0 1px 0 rgba(255,255,255,0.03);
}

.harvey-ai-support-window-head {
  margin-bottom: 12px;
}

.harvey-ai-support-window-title {
  font-size: 13px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  font-weight: 800;
  color: #7fc4ff;
}

.harvey-ai-support-window-subtitle {
  margin-top: 6px;
  font-size: 12px;
  line-height: 1.5;
  color: rgba(220,230,255,.60);
}

.harvey-ai-support-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 10px;
}

.harvey-ai-support-card {
  min-height: 64px;
  padding: 0 18px;
  border-radius: 18px;
  border: 1px solid rgba(255,255,255,.08);
  background: linear-gradient(145deg, rgba(24, 37, 74, 0.92), rgba(13, 22, 48, 0.96));
  color: #ffffff;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  box-shadow: inset 0 1px 0 rgba(255,255,255,.03);
  cursor: pointer;
  -webkit-appearance: none;
  appearance: none;
  transition: transform .18s ease, border-color .18s ease;
}

.harvey-ai-support-card:hover {
  transform: translateY(-1px);
  border-color: rgba(122, 162, 255, .22);
}

.harvey-ai-support-card.primary {
  border-color: rgba(122, 240, 200, 0.22);
  background: linear-gradient(145deg, rgba(18, 53, 65, 0.95), rgba(11, 23, 39, 0.98));
}

.harvey-ai-support-card-text {
  font-size: 15px;
  line-height: 1.35;
  font-weight: 750;
  color: #f5f8ff;
  text-align: left;
}

.harvey-ai-support-card-arrow {
  font-size: 18px;
  color: #89f2ff;
  opacity: 0.9;
  flex-shrink: 0;
}

.harvey-ai-quick-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  padding: 0 14px 14px;
}

.harvey-ai-quick-action {
  border: 1px solid rgba(255,255,255,.10);
  background: rgba(255,255,255,.05);
  color: #f3f8ff;
  border-radius: 999px;
  padding: 11px 15px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 800;
  line-height: 1.2;
  -webkit-appearance: none;
  appearance: none;
  text-decoration: none;
}

.harvey-ai-quick-action.green {
  background: linear-gradient(135deg, #79f0b7 0%, #78f0e9 100%);
  color: #07131f;
  border: none;
}

.harvey-ai-quick-action.gold {
  background: linear-gradient(135deg, #ffd76a 0%, #ffe8a2 100%);
  color: #2e2400;
  border: none;
}

.harvey-ai-conversation-zone {
  min-height: 0;
  display: grid;
  grid-template-rows: 1fr auto;
  background: linear-gradient(180deg, rgba(5,12,25,.34), rgba(7,14,28,.84));
}

.harvey-ai-body {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 18px;
  overflow-y: auto;
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
  max-width: min(88%, 760px);
  padding: 16px 18px;
  border-radius: 20px;
  font-size: 15px;
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-word;
  overflow-wrap: anywhere;
}

.harvey-ai-message.user .harvey-ai-bubble {
  background: linear-gradient(135deg, #79f0b7 0%, #78f0e9 100%);
  color: #04131d;
  border-bottom-right-radius: 8px;
  font-weight: 700;
}

.harvey-ai-message.assistant .harvey-ai-bubble {
  background: rgba(255,255,255,.10);
  color: #f8fbff;
  border-bottom-left-radius: 8px;
}

.harvey-ai-inline-card {
  margin-top: 8px;
  max-width: min(88%, 760px);
  padding: 14px 16px;
  border-radius: 16px;
  background: rgba(255,255,255,.06);
  border: 1px solid rgba(255,255,255,.08);
}

.harvey-ai-inline-card strong {
  display: block;
  margin-bottom: 6px;
  font-size: 14px;
}

.harvey-ai-inline-card span {
  display: block;
  font-size: 13px;
  line-height: 1.6;
  color: rgba(234,240,255,.88);
}

.harvey-ai-inline-link {
  display: inline-flex;
  margin-top: 10px;
  padding: 10px 14px;
  border-radius: 999px;
  background: linear-gradient(135deg, #ffd76a 0%, #ffe8a2 100%);
  color: #2e2400;
  font-size: 13px;
  font-weight: 900;
  text-decoration: none;
}

.harvey-ai-meta {
  font-size: 12px;
  color: rgba(230,238,255,.78);
  padding: 0 4px;
  font-weight: 700;
}

.harvey-ai-system-line {
  font-size: 12px;
  color: rgba(220,230,255,.64);
  padding: 4px 2px 0;
  text-align: center;
  line-height: 1.55;
}

.harvey-ai-typing {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 12px 14px;
  border-radius: 18px;
  background: rgba(255,255,255,.08);
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
  0%, 80%, 100% { transform: scale(0.7); opacity: 0.6; }
  40% { transform: scale(1); opacity: 1; }
}

.harvey-ai-inline-composer {
  position: relative;
  z-index: 5;
  margin: 0 18px 18px;
  padding: 18px;
  border-radius: 22px;
  background: linear-gradient(180deg, rgba(10, 24, 50, 0.98), rgba(6, 14, 32, 0.98));
  border: 1px solid rgba(110, 231, 255, 0.18);
  box-shadow:
    0 18px 40px rgba(0,0,0,.35),
    0 0 0 1px rgba(110,231,255,.06),
    inset 0 1px 0 rgba(255,255,255,.04);
  flex-shrink: 0;
}

.harvey-ai-inline-composer::before {
  content: "";
  position: absolute;
  inset: -1px;
  border-radius: inherit;
  background: linear-gradient(
    135deg,
    rgba(110,231,255,.25),
    rgba(122,162,255,.18),
    transparent
  );
  opacity: 0.35;
  z-index: -1;
  pointer-events: none;
}

.harvey-ai-composer-label {
  margin-bottom: 12px;
  font-size: 12px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  font-weight: 900;
  color: #8fefff;
}

.harvey-ai-form {
  display: grid;
  grid-template-columns: 1fr 84px;
  gap: 12px;
  align-items: center;
}

.harvey-ai-input {
  min-height: 72px;
  max-height: 180px;
  resize: none;
  padding: 16px 18px;
  border-radius: 18px;
  border: 1px solid rgba(110, 231, 255, 0.35);
  background: rgba(5, 14, 30, 1);
  color: #f8fbff;
  font-size: 15px;
  line-height: 1.5;
  font-weight: 700;
  outline: none;
  width: 100%;
}

.harvey-ai-input::placeholder {
  color: rgba(220, 230, 255, 0.72);
  font-size: 14px;
  line-height: 1.45;
  font-weight: 600;
}

.harvey-ai-input:focus {
  border-color: rgba(110, 231, 255, 0.46);
  box-shadow: 0 0 0 3px rgba(110, 231, 255, 0.08);
}

.harvey-ai-send {
  width: 84px;
  height: 72px;
  border: none;
  border-radius: 18px;
  cursor: pointer;
  font-size: 26px;
  font-weight: 800;
  color: #07131f;
  background: linear-gradient(135deg, #79f0b7 0%, #78f0e9 100%);
  box-shadow: 0 12px 30px rgba(121, 240, 183, 0.35);
  -webkit-appearance: none;
  appearance: none;
}

.harvey-ai-send:disabled,
.harvey-ai-input:disabled {
  opacity: 0.65;
  cursor: not-allowed;
}

.harvey-ai-footnote {
  margin-top: 10px;
  font-size: 11px;
  line-height: 1.45;
  color: rgba(220,230,255,.68);
}

@media (max-width: 980px) {
  .harvey-ai-layout {
    grid-template-columns: 1fr;
    grid-template-rows: auto 1fr;
  }

  .harvey-ai-sidebar {
    max-height: 34vh;
    border-right: none;
    border-bottom: 1px solid rgba(255,255,255,.06);
  }
}

@media (max-width: 640px) {
  #harvey-ai-chat-root {
    right: 8px !important;
    bottom: calc(82px + env(safe-area-inset-bottom, 0px)) !important;
  }

  .harvey-ai-panel {
    right: 8px;
    left: 8px;
    top: max(8px, env(safe-area-inset-top, 0px));
    bottom: calc(82px + env(safe-area-inset-bottom, 0px));
    border-radius: 20px;
  }

  .harvey-ai-panel:not(.expanded) {
    width: calc(100vw - 16px);
    height: min(80vh, 860px);
  }

  .harvey-ai-header {
    padding: 14px;
  }

  .harvey-ai-badge {
    width: 48px;
    height: 48px;
    border-radius: 14px;
    font-size: 18px;
  }

  .harvey-ai-title {
    font-size: 16px;
  }

  .harvey-ai-icon-btn {
    width: 38px;
    height: 38px;
    font-size: 16px;
  }

  .harvey-ai-support-window {
    margin: 12px;
    padding: 14px;
    border-radius: 18px;
  }

  .harvey-ai-support-card {
    min-height: 56px;
    border-radius: 16px;
    padding: 0 15px;
  }

  .harvey-ai-support-card-text {
    font-size: 14px;
  }

  .harvey-ai-quick-actions {
    padding: 0 12px 12px;
  }

  .harvey-ai-body {
    padding: 14px;
  }

  .harvey-ai-bubble,
  .harvey-ai-inline-card {
    max-width: 94%;
  }

  .harvey-ai-inline-composer {
    margin: 0 12px 12px;
    padding: 14px;
    border-radius: 18px;
  }

  .harvey-ai-form {
    grid-template-columns: 1fr 72px;
  }

  .harvey-ai-input {
    min-height: 64px;
    font-size: 14px;
    padding: 14px;
  }

  .harvey-ai-send {
    width: 72px;
    height: 64px;
    border-radius: 16px;
    font-size: 22px;
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
      ask: function (message) {
        open();
        return sendMessage(message);
      },
      reset: function () {
        state.messages = getWelcomeMessages();
        saveMessages();
        renderMessages();
        renderSupportGrid();
        renderQuickActions();
      },
      openFoundation: function () {
        window.location.href = CONFIG.foundationUrl;
      },
      donate: function () {
        window.open(CONFIG.donationUrl, "_blank", "noopener,noreferrer");
      },
      setContext: function (nextContext) {
        if (!nextContext || typeof nextContext !== "object") return;
        state.riderId = nextContext.rider_id || nextContext.riderId || state.riderId;
        state.driverId = nextContext.driver_id || nextContext.driverId || state.driverId;
        state.rideId = nextContext.ride_id || nextContext.rideId || state.rideId;
      },
      getState: function () {
        return {
          isOpen: state.isOpen,
          isExpanded: state.isExpanded,
          isLoading: state.isLoading,
          page: PAGE_CONTEXT,
          riderId: state.riderId,
          driverId: state.driverId,
          rideId: state.rideId,
          messages: state.messages.slice()
        };
      }
    };

    createWidget();
    console.log("Harvey Taxi AI safe full-chat widget booted");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootHarveyAI);
  } else {
    bootHarveyAI();
  }
})();

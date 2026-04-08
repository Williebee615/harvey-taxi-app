(function () {
  const PAGE_MODE = detectPageMode();

  const QUICK_ACTIONS = {
    rider: [
      "How do I complete rider signup?",
      "Why is my rider verification pending?",
      "Why can’t I request a ride yet?",
      "How does payment authorization work?"
    ],
    driver: [
      "What documents do I need to drive?",
      "Why is my driver approval pending?",
      "How do background checks work?",
      "When can I start accepting rides?"
    ],
    request: [
      "How do I request a ride?",
      "What is autonomous pilot mode?",
      "Why do I need payment authorization first?",
      "Can I tip during or after the trip?"
    ],
    general: [
      "How do I get started?",
      "Who can use Harvey Taxi?",
      "How do I contact support?",
      "What if this is an emergency?"
    ]
  };

  const root = document.createElement("div");
  root.id = "harvey-ai-chat-root";
  root.innerHTML = `
    <div id="harveyAiWindow" class="harvey-ai-window" aria-hidden="true">
      <div class="harvey-ai-header">
        <div class="harvey-ai-header-top">
          <div class="harvey-ai-brand">
            <div class="harvey-ai-badge">AI</div>
            <div>
              <div class="harvey-ai-title">Harvey AI Support</div>
              <div class="harvey-ai-subtitle">Onboarding help, live guidance, and common questions</div>
            </div>
          </div>
          <button id="harveyAiClose" class="harvey-ai-close" aria-label="Close chat">×</button>
        </div>
        <div class="harvey-ai-note">
          Harvey AI Support can help with onboarding, account flow, verification, payment steps,
          and platform questions. It does not provide legal advice, emergency services, or final approval decisions.
          For emergencies, call 911.
        </div>
      </div>

      <div id="harveyAiQuickActions" class="harvey-ai-quick-actions"></div>

      <div id="harveyAiMessages" class="harvey-ai-messages"></div>

      <div class="harvey-ai-footer">
        <div class="harvey-ai-input-row">
          <textarea
            id="harveyAiInput"
            class="harvey-ai-textarea"
            placeholder="Ask a question about signup, verification, payment authorization, rides, or support..."
          ></textarea>
          <button id="harveyAiSend" class="harvey-ai-send">Send</button>
        </div>
        <div class="harvey-ai-footer-help">
          Need human help? Email <a href="mailto:support@harveytaxiservice.com">support@harveytaxiservice.com</a>.
        </div>
      </div>
    </div>

    <button id="harveyAiFab" class="harvey-ai-fab" aria-label="Open Harvey AI Support">
      HELP
    </button>
  `;

  document.body.appendChild(root);

  const windowEl = document.getElementById("harveyAiWindow");
  const fabEl = document.getElementById("harveyAiFab");
  const closeEl = document.getElementById("harveyAiClose");
  const messagesEl = document.getElementById("harveyAiMessages");
  const quickActionsEl = document.getElementById("harveyAiQuickActions");
  const inputEl = document.getElementById("harveyAiInput");
  const sendEl = document.getElementById("harveyAiSend");

  renderQuickActions(PAGE_MODE);

  addBotMessage(getWelcomeMessage(PAGE_MODE));
  addSystemMessage("Tip: You can ask plain-English questions like “Why is my verification pending?” or “How do I request an autonomous pilot ride?”");

  fabEl.addEventListener("click", openChat);
  closeEl.addEventListener("click", closeChat);
  sendEl.addEventListener("click", handleSend);
  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  });

  function detectPageMode() {
    const pathname = window.location.pathname.toLowerCase();

    if (pathname.includes("rider-signup")) return "rider";
    if (pathname.includes("driver-signup")) return "driver";
    if (pathname.includes("request-ride")) return "request";

    return "general";
  }

  function renderQuickActions(mode) {
    const actions = QUICK_ACTIONS[mode] || QUICK_ACTIONS.general;
    quickActionsEl.innerHTML = "";

    actions.forEach((text) => {
      const btn = document.createElement("button");
      btn.className = "harvey-ai-chip";
      btn.type = "button";
      btn.textContent = text;
      btn.addEventListener("click", () => {
        inputEl.value = text;
        handleSend();
      });
      quickActionsEl.appendChild(btn);
    });
  }

  function openChat() {
    windowEl.classList.add("open");
    windowEl.setAttribute("aria-hidden", "false");
    fabEl.style.display = "none";
    setTimeout(() => inputEl.focus(), 150);
  }

  function closeChat() {
    windowEl.classList.remove("open");
    windowEl.setAttribute("aria-hidden", "true");
    fabEl.style.display = "flex";
  }

  function addMessage(role, text) {
    const msg = document.createElement("div");
    msg.className = `harvey-ai-message ${role}`;
    msg.textContent = text;
    messagesEl.appendChild(msg);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function addBotMessage(text) {
    addMessage("bot", text);
  }

  function addUserMessage(text) {
    addMessage("user", text);
  }

  function addSystemMessage(text) {
    addMessage("system", text);
  }

  function showTyping() {
    const wrap = document.createElement("div");
    wrap.className = "harvey-ai-message bot";
    wrap.id = "harvey-ai-typing";
    wrap.innerHTML = `
      <div class="harvey-ai-typing">
        <span></span><span></span><span></span>
      </div>
    `;
    messagesEl.appendChild(wrap);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function hideTyping() {
    const el = document.getElementById("harvey-ai-typing");
    if (el) el.remove();
  }

  async function handleSend() {
    const text = inputEl.value.trim();
    if (!text) return;

    addUserMessage(text);
    inputEl.value = "";
    showTyping();

    try {
      const response = await fetch("/api/ai-support", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          question: text,
          pageMode: PAGE_MODE,
          pagePath: window.location.pathname,
          context: collectPageContext()
        })
      });

      const data = await response.json();
      hideTyping();

      if (!response.ok) {
        addBotMessage(data?.reply || "I’m having trouble right now. Please try again or contact support@harveytaxiservice.com.");
        return;
      }

      addBotMessage(data.reply || "I’m here to help with onboarding, verification, payments, and ride flow questions.");
    } catch (error) {
      hideTyping();

      const fallback = localFallbackAnswer(text, PAGE_MODE);
      addBotMessage(fallback);
    }
  }

  function collectPageContext() {
    const safeValue = (selector) => {
      const el = document.querySelector(selector);
      return el && typeof el.value === "string" ? el.value.trim() : "";
    };

    return {
      riderId: safeValue("#riderId"),
      firstName: safeValue("#firstName"),
      phone: safeValue("#phone"),
      email: safeValue("#email"),
      pickupAddress: safeValue("#pickupAddress"),
      dropoffAddress: safeValue("#dropoffAddress"),
      rideType: safeValue("#rideType"),
      mode: new URLSearchParams(window.location.search).get("mode") || ""
    };
  }

  function getWelcomeMessage(mode) {
    if (mode === "rider") {
      return "Welcome to Harvey AI Support. I can help you complete rider signup, explain verification status, and walk you through what happens before you can request a ride.";
    }

    if (mode === "driver") {
      return "Welcome to Harvey AI Support. I can help with driver onboarding, required documents, verification, approval flow, and what to expect before you can accept missions.";
    }

    if (mode === "request") {
      return "Welcome to Harvey AI Support. I can help explain ride requests, fare estimates, payment authorization, driver mode versus autonomous pilot mode, and next steps if something is blocked.";
    }

    return "Welcome to Harvey AI Support. I can answer common questions about Harvey Taxi onboarding, verification, ride flow, and account support.";
  }

  function localFallbackAnswer(question, mode) {
    const q = question.toLowerCase();

    if (q.includes("emergency") || q.includes("unsafe") || q.includes("danger")) {
      return "If this is an emergency or you feel unsafe, call 911 immediately. Harvey AI Support is not an emergency service.";
    }

    if (q.includes("verification") && q.includes("pending")) {
      return "A pending verification usually means your review is still in progress, your submission needs more time, or additional information may be needed. Until approval is complete, some features may stay locked.";
    }

    if (q.includes("payment authorization") || (q.includes("payment") && q.includes("authorize"))) {
      return "Harvey Taxi may require payment authorization before dispatch. That means the payment method is checked before a driver or autonomous pilot ride can be assigned.";
    }

    if (q.includes("request ride") || q.includes("can't request") || q.includes("cannot request")) {
      return "If you cannot request a ride yet, the most common reasons are rider verification not approved yet, payment authorization not completed, or missing required form details.";
    }

    if (q.includes("driver") && q.includes("documents")) {
      return "Driver onboarding typically requires identity verification and driver-related documentation before approval. Keep your information accurate and complete to avoid delays.";
    }

    if (q.includes("autonomous")) {
      return "Autonomous Pilot mode is the Harvey Taxi AV-style request flow. Availability may be limited by pilot rules, service area, and platform readiness.";
    }

    if (q.includes("tip") || q.includes("tipping")) {
      return "Harvey Taxi supports tipping in the trip flow plan, including during the trip and after the trip.";
    }

    if (mode === "rider") {
      return "For rider onboarding help, make sure your signup details are complete and accurate. After verification approval, you can move into payment authorization and ride request flow.";
    }

    if (mode === "driver") {
      return "For driver onboarding help, complete your signup carefully and upload all requested information. Approval is required before you can start accepting missions.";
    }

    if (mode === "request") {
      return "For ride request help, confirm rider approval first, then payment authorization, then complete pickup and dropoff details before dispatch.";
    }

    return "I can help with onboarding, verification, payment authorization, ride requests, driver approval, autonomous pilot questions, and support flow.";
  }
})();

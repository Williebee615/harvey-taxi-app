(function () {
  const root = document.getElementById("harvey-ai-chat-root");
  if (!root) return;

  root.innerHTML = `
    <div id="harveyAiLauncher" aria-label="Open Harvey AI Support">AI</div>

    <div id="harveyAiWindow">
      <div class="harvey-header">
        <div class="harvey-head-copy">
          <strong>Harvey AI Support</strong>
          <span>Taxi + Assistance Foundation</span>
        </div>
        <button id="harveyAiClose" aria-label="Close Harvey AI Support">×</button>
      </div>

      <div id="harveyAiMessages"></div>

      <div class="harvey-quick">
        <button data-q="How do I request a ride?">Request Ride</button>
        <button data-q="How does assistance work?">Assistance</button>
        <button data-q="How do I become a driver?">Driver</button>
        <button data-q="How do I contact support?">Support</button>
      </div>

      <div class="harvey-input">
        <input id="harveyAiInput" placeholder="Ask about Harvey Taxi or assistance..." />
        <button id="harveyAiSend">Send</button>
      </div>
    </div>
  `;

  const styleId = "harvey-ai-widget-style";
  if (!document.getElementById(styleId)) {
    const style = document.createElement("style");
    style.id = styleId;
    style.innerHTML = `
      :root{
        --harvey-nav-clearance: 92px;
        --harvey-launcher-size: 68px;
        --harvey-widget-right: 16px;
      }

      #harvey-ai-chat-root,
      #harvey-ai-chat-root *{
        box-sizing:border-box;
        font-family:Inter, Arial, sans-serif;
      }

      #harveyAiLauncher{
        position:fixed;
        right:var(--harvey-widget-right);
        bottom:calc(var(--harvey-nav-clearance) + env(safe-area-inset-bottom));
        width:var(--harvey-launcher-size);
        height:var(--harvey-launcher-size);
        border-radius:50%;
        background:linear-gradient(135deg,#4facfe,#00f2fe);
        display:flex;
        align-items:center;
        justify-content:center;
        font-weight:900;
        font-size:22px;
        color:#03111d;
        box-shadow:0 18px 40px rgba(0,0,0,.35);
        z-index:99999;
        cursor:pointer;
        user-select:none;
      }

      #harveyAiWindow{
        position:fixed;
        right:16px;
        bottom:calc(16px + var(--harvey-nav-clearance) + env(safe-area-inset-bottom));
        width:390px;
        max-width:calc(100vw - 24px);
        height:min(680px, calc(100dvh - 140px));
        background:linear-gradient(180deg,#061125,#040814);
        border:1px solid rgba(255,255,255,.08);
        border-radius:24px;
        display:none;
        flex-direction:column;
        overflow:hidden;
        box-shadow:0 24px 60px rgba(0,0,0,.42);
        z-index:999999;
      }

      .harvey-header{
        display:flex;
        justify-content:space-between;
        align-items:flex-start;
        gap:12px;
        padding:16px;
        border-bottom:1px solid rgba(255,255,255,.08);
        background:rgba(255,255,255,.03);
      }

      .harvey-head-copy{
        display:flex;
        flex-direction:column;
        gap:4px;
      }

      .harvey-head-copy strong{
        color:#ffffff;
        font-size:18px;
        line-height:1.2;
      }

      .harvey-head-copy span{
        color:#aab8de;
        font-size:13px;
        line-height:1.4;
      }

      #harveyAiClose{
        border:none;
        background:rgba(255,255,255,.08);
        color:#fff;
        width:40px;
        height:40px;
        border-radius:12px;
        font-size:28px;
        line-height:1;
        cursor:pointer;
      }

      #harveyAiMessages{
        flex:1;
        overflow:auto;
        padding:16px;
        display:flex;
        flex-direction:column;
        gap:10px;
      }

      .msg{
        margin-bottom:0;
        padding:12px 14px;
        border-radius:14px;
        max-width:84%;
        white-space:pre-wrap;
        word-break:break-word;
        font-size:15px;
        line-height:1.5;
      }

      .msg.user{
        background:linear-gradient(135deg,#4facfe,#00f2fe);
        color:#03111d;
        margin-left:auto;
        font-weight:700;
      }

      .msg.ai{
        background:#101a2e;
        color:#ffffff;
        border:1px solid rgba(255,255,255,.06);
      }

      .harvey-quick{
        display:flex;
        gap:8px;
        overflow:auto;
        padding:10px 12px;
        border-top:1px solid rgba(255,255,255,.06);
        border-bottom:1px solid rgba(255,255,255,.06);
        background:rgba(255,255,255,.02);
      }

      .harvey-quick button{
        padding:10px 12px;
        border-radius:999px;
        border:none;
        background:#111a2e;
        color:white;
        white-space:nowrap;
        font-weight:700;
        cursor:pointer;
      }

      .harvey-input{
        display:flex;
        gap:8px;
        padding:12px;
        background:#07101f;
      }

      .harvey-input input{
        flex:1;
        padding:14px;
        border-radius:12px;
        border:1px solid rgba(255,255,255,.08);
        background:#111a2e;
        color:#fff;
        outline:none;
      }

      .harvey-input input::placeholder{
        color:#9fb0d5;
      }

      .harvey-input button{
        padding:14px 18px;
        border-radius:12px;
        background:linear-gradient(135deg,#4facfe,#00f2fe);
        border:none;
        color:#03111d;
        font-weight:800;
        cursor:pointer;
      }

      @media (max-width: 768px){
        :root{
          --harvey-nav-clearance: 104px;
          --harvey-launcher-size: 62px;
          --harvey-widget-right: 14px;
        }

        #harveyAiLauncher{
          right:14px;
          bottom:calc(var(--harvey-nav-clearance) + env(safe-area-inset-bottom));
          width:var(--harvey-launcher-size);
          height:var(--harvey-launcher-size);
          font-size:20px;
        }

        #harveyAiWindow{
          right:0;
          left:0;
          bottom:calc(72px + env(safe-area-inset-bottom));
          width:100vw;
          max-width:100vw;
          height:calc(100dvh - 72px - env(safe-area-inset-bottom));
          border-radius:22px 22px 0 0;
          border-left:none;
          border-right:none;
          border-bottom:none;
        }

        .harvey-input{
          padding:10px;
        }

        .harvey-input input{
          min-width:0;
          font-size:16px;
        }

        .harvey-input button{
          padding:14px 16px;
          flex-shrink:0;
        }
      }
    `;
    document.head.appendChild(style);
  }

  const launcher = document.getElementById("harveyAiLauncher");
  const windowEl = document.getElementById("harveyAiWindow");
  const closeBtn = document.getElementById("harveyAiClose");
  const messages = document.getElementById("harveyAiMessages");
  const input = document.getElementById("harveyAiInput");
  const send = document.getElementById("harveyAiSend");

  launcher.onclick = openChat;
  closeBtn.onclick = closeChat;

  send.onclick = handleSend;
  input.addEventListener("keypress", (e) => {
    if (e.key === "Enter") handleSend();
  });

  document.querySelectorAll(".harvey-quick button").forEach((btn) => {
    btn.onclick = () => handleSend(btn.dataset.q);
  });

  let greeted = false;

  function openChat() {
    windowEl.style.display = "flex";
    if (!greeted) {
      addMessage(
        "ai",
        "Hi — I can help with Harvey Taxi rides, rider signup, driver signup, payments, support, and Harvey Transportation Assistance Foundation questions."
      );
      greeted = true;
    }
  }

  function closeChat() {
    windowEl.style.display = "none";
  }

  function handleSend(text) {
    const msg = text || input.value.trim();
    if (!msg) return;

    addMessage("user", msg);
    input.value = "";

    setTimeout(() => {
      addMessage("ai", getResponse(msg));
    }, 250);
  }

  function addMessage(type, text) {
    const div = document.createElement("div");
    div.className = "msg " + type;
    div.innerText = text;
    messages.appendChild(div);
    messages.scrollTop = messages.scrollHeight;
  }

  function getResponse(message) {
    const msg = message.toLowerCase();

    if (msg.includes("support") || msg.includes("help")) {
      return "Harvey AI Support can help with rider signup, driver signup, ride requests, payments, verification, and Harvey Transportation Assistance Foundation questions.";
    }

    if (msg.includes("harvey taxi")) {
      return "Harvey Taxi is a transportation platform supporting rider onboarding, driver onboarding, ride dispatch, payment authorization, and transportation assistance.";
    }

    if (msg.includes("foundation") || msg.includes("assistance")) {
      return "Harvey Transportation Assistance Foundation helps provide transportation for essential needs like medical, work, school, and community travel.";
    }

    if (msg.includes("request") && msg.includes("ride")) {
      return "To request a ride, enter pickup and destination, complete payment authorization, and submit your request.";
    }

    if (msg.includes("driver")) {
      return "To become a driver, complete driver signup, upload documents, and wait for approval.";
    }

    if (msg.includes("rider")) {
      return "Create a rider account, complete verification, authorize payment, then request a ride.";
    }

    if (msg.includes("payment")) {
      return "Harvey Taxi authorizes payment before dispatch. You are only charged after the trip.";
    }

    if (msg.includes("schedule")) {
      return "Scheduled rides allow you to request transportation in advance.";
    }

    if (msg.includes("medical")) {
      return "Medical rides may be supported through Harvey Taxi or the Harvey Transportation Assistance Foundation.";
    }

    if (msg.includes("autonomous")) {
      return "Autonomous pilot mode allows future self-driving ride requests.";
    }

    if (msg.includes("contact")) {
      return "You can contact Harvey Taxi support through the support page or AI chat.";
    }

    if (msg.includes("emergency") || msg.includes("911")) {
      return "If this is an emergency please call 911 immediately.";
    }

    return "I can help with Harvey Taxi, rides, drivers, riders, payments, safety, and Harvey Transportation Assistance Foundation.";
  }

  window.HarveyAI = {
    open: openChat,
    close: closeChat
  };
})();

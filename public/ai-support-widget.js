(function () {

const root = document.getElementById("harvey-ai-chat-root");
if (!root) return;

root.innerHTML = `
<div id="harveyAiLauncher" class="harvey-ai-launch">AI</div>

<div id="harveyAiWindow" class="harvey-ai-window">
  <div class="harvey-ai-header">
    <div>
      <strong>Harvey AI Support</strong>
      <span>Taxi + Assistance Foundation</span>
    </div>
    <button id="harveyAiClose">×</button>
  </div>

  <div id="harveyAiMessages" class="harvey-ai-messages"></div>

  <div class="harvey-ai-quick">
    <button data-q="How do I request a ride?">Request ride</button>
    <button data-q="How does Harvey assistance work?">Assistance</button>
    <button data-q="How do I become a driver?">Drive</button>
    <button data-q="What is autonomous pilot?">Autonomous</button>
  </div>

  <div class="harvey-ai-input">
    <input id="harveyAiInput" placeholder="Ask about Harvey Taxi or assistance..." />
    <button id="harveyAiSend">Send</button>
  </div>
</div>
`;

const launcher = document.getElementById("harveyAiLauncher");
const windowEl = document.getElementById("harveyAiWindow");
const closeBtn = document.getElementById("harveyAiClose");
const messages = document.getElementById("harveyAiMessages");
const input = document.getElementById("harveyAiInput");
const send = document.getElementById("harveyAiSend");

launcher.onclick = openChat;
closeBtn.onclick = closeChat;

function openChat(){
windowEl.classList.add("open");
addMessage("ai", greeting());
}

function closeChat(){
windowEl.classList.remove("open");
}

send.onclick = handleSend;
input.addEventListener("keypress", e=>{
if(e.key === "Enter") handleSend();
});

document.querySelectorAll(".harvey-ai-quick button")
.forEach(btn=>{
btn.onclick = ()=>{
handleSend(btn.dataset.q);
};
});

function handleSend(text){
const msg = text || input.value.trim();
if(!msg) return;

addMessage("user", msg);
input.value = "";

setTimeout(()=>{
addMessage("ai", getResponse(msg));
}, 400);
}

function addMessage(type, text){
const div = document.createElement("div");
div.className = "harvey-msg " + type;
div.innerText = text;
messages.appendChild(div);
messages.scrollTop = messages.scrollHeight;
}

function greeting(){
return "Hi — I can help with Harvey Taxi rides, driver signup, rider signup, payments, and Harvey Transportation Assistance Foundation support. What would you like help with?";
}

/* =================================
   AI KNOWLEDGE BRAIN
================================= */

function getResponse(message){
const msg = message.toLowerCase();

/* request ride */
if(msg.includes("request") && msg.includes("ride"))
return "To request a ride, open Request Ride, enter pickup and destination, complete payment authorization, and wait for dispatch.";

/* assistance */
if(msg.includes("assistance") || msg.includes("foundation"))
return "Harvey Transportation Assistance Foundation helps provide transportation for essential needs like medical, work, and community access. Availability may vary.";

/* driver */
if(msg.includes("driver"))
return "To become a driver, complete driver signup, upload documents, and wait for approval. Once approved, you can accept ride missions.";

/* rider */
if(msg.includes("rider"))
return "Create a rider account, complete verification, authorize payment, then request a ride.";

/* payment */
if(msg.includes("payment"))
return "Harvey Taxi uses payment authorization before dispatch. You are only charged after the trip.";

/* autonomous */
if(msg.includes("autonomous"))
return "Autonomous pilot mode allows requesting future self-driving vehicles. This is currently a pilot feature.";

/* safety */
if(msg.includes("emergency"))
return "If this is an emergency please call 911 immediately.";

/* default */
return "I can help with rides, drivers, riders, payments, safety, or Harvey Transportation Assistance Foundation. Ask me anything.";
}

window.HarveyAI = {
open: openChat
};

})();

(function(){

const root = document.getElementById("harvey-ai-chat-root");
if(!root) return;

root.innerHTML = `
<div id="harveyAiLauncher">AI</div>

<div id="harveyAiWindow">
<div id="harveyAiHeader">
<div>
<strong>Harvey AI Support</strong>
<span>Taxi + Assistance Foundation</span>
</div>
<button id="harveyAiClose">×</button>
</div>

<div id="harveyAiMessages"></div>

<div id="harveyAiQuick">
<button data-q="How do I request a ride?">Request Ride</button>
<button data-q="How does assistance work?">Assistance</button>
<button data-q="How do I become a driver?">Driver</button>
<button data-q="How do I contact support?">Support</button>
</div>

<div id="harveyAiInputWrap">
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
windowEl.style.display="flex";
addMessage("ai", greeting());
}

function closeChat(){
windowEl.style.display="none";
}

send.onclick = handleSend;
input.addEventListener("keypress",e=>{
if(e.key==="Enter") handleSend();
});

document.querySelectorAll("#harveyAiQuick button").forEach(btn=>{
btn.onclick=()=>handleSend(btn.dataset.q);
});

function handleSend(text){
const msg = text || input.value.trim();
if(!msg) return;

addMessage("user",msg);
input.value="";

setTimeout(()=>{
addMessage("ai",getResponse(msg));
},400);
}

function addMessage(type,text){
const div=document.createElement("div");
div.className="msg "+type;
div.innerText=text;
messages.appendChild(div);
messages.scrollTop=messages.scrollHeight;
}

function greeting(){
return "Hi — I can help with Harvey Taxi rides, driver signup, rider signup, payments, and Harvey Transportation Assistance Foundation support.";
}

/* ===============================
AI SUPPORT BRAIN
=============================== */

function getResponse(message){
const msg=message.toLowerCase();

/* support */
if(msg.includes("support")||msg.includes("help"))
return "Harvey AI Support can help with rider signup, driver signup, ride requests, payments, verification, and Harvey Transportation Assistance Foundation questions.";

/* harvey taxi */
if(msg.includes("harvey taxi"))
return "Harvey Taxi is a transportation platform supporting rider onboarding, driver onboarding, ride dispatch, and transportation assistance.";

/* foundation */
if(msg.includes("foundation")||msg.includes("assistance"))
return "Harvey Transportation Assistance Foundation helps provide transportation for essential needs like medical, work, and community travel.";

/* request ride */
if(msg.includes("request")&&msg.includes("ride"))
return "To request a ride, enter pickup and destination, complete payment authorization, and submit your request.";

/* driver */
if(msg.includes("driver"))
return "To become a driver, complete driver signup, upload documents, and wait for approval.";

/* rider */
if(msg.includes("rider"))
return "Create a rider account, complete verification, authorize payment, then request a ride.";

/* payment */
if(msg.includes("payment"))
return "Harvey Taxi authorizes payment before dispatch. You are only charged after the trip.";

/* scheduled */
if(msg.includes("schedule"))
return "Scheduled rides allow you to request transportation in advance.";

/* medical */
if(msg.includes("medical"))
return "Medical rides may be supported through Harvey Taxi or the Harvey Transportation Assistance Foundation.";

/* autonomous */
if(msg.includes("autonomous"))
return "Autonomous pilot mode allows future self-driving ride requests.";

/* contact */
if(msg.includes("contact"))
return "You can contact Harvey Taxi support through the support page or AI chat.";

/* emergency */
if(msg.includes("emergency")||msg.includes("911"))
return "If this is an emergency please call 911 immediately.";

/* default */
return "I can help with Harvey Taxi, rides, drivers, riders, payments, safety, and Harvey Transportation Assistance Foundation.";
}

window.HarveyAI={
open:openChat
};

})();

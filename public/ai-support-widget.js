(function () {

const root = document.createElement("div");
root.id = "harvey-ai-root";

root.innerHTML = `
<div id="harveyAiLauncher">AI</div>

<div id="harveyAiWindow">
  <div class="harvey-header">
    <div>
      <strong>Harvey AI Support</strong>
      <span>Taxi + Assistance Foundation</span>
    </div>
    <button id="harveyAiClose">×</button>
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

document.body.appendChild(root);

/* ===============================
STYLE (FULLSCREEN MOBILE)
=============================== */

const style = document.createElement("style");
style.innerHTML = `
#harveyAiLauncher{
position:fixed;
bottom:20px;
right:20px;
width:60px;
height:60px;
border-radius:50%;
background:linear-gradient(135deg,#4facfe,#00f2fe);
display:flex;
align-items:center;
justify-content:center;
font-weight:700;
color:#000;
z-index:99999;
}

#harveyAiWindow{
position:fixed;
top:0;
left:0;
right:0;
bottom:0;
background:#040814;
display:none;
flex-direction:column;
z-index:999999;
}

.harvey-header{
display:flex;
justify-content:space-between;
padding:16px;
border-bottom:1px solid rgba(255,255,255,.1);
}

#harveyAiMessages{
flex:1;
overflow:auto;
padding:16px;
}

.msg{
margin-bottom:10px;
padding:12px;
border-radius:12px;
max-width:80%;
}

.msg.user{
background:#4facfe;
color:#000;
margin-left:auto;
}

.msg.ai{
background:#111a2e;
color:#fff;
}

.harvey-input{
display:flex;
gap:8px;
padding:12px;
border-top:1px solid rgba(255,255,255,.1);
}

.harvey-input input{
flex:1;
padding:14px;
border-radius:10px;
border:none;
}

.harvey-input button{
padding:14px 18px;
border-radius:10px;
background:linear-gradient(135deg,#4facfe,#00f2fe);
border:none;
font-weight:600;
}

.harvey-quick{
display:flex;
gap:8px;
overflow:auto;
padding:10px;
}

.harvey-quick button{
padding:8px 12px;
border-radius:20px;
border:none;
background:#111a2e;
color:white;
white-space:nowrap;
}
`;

document.head.appendChild(style);

/* ===============================
LOGIC
=============================== */

const launcher = document.getElementById("harveyAiLauncher");
const windowEl = document.getElementById("harveyAiWindow");
const closeBtn = document.getElementById("harveyAiClose");
const messages = document.getElementById("harveyAiMessages");
const input = document.getElementById("harveyAiInput");
const send = document.getElementById("harveyAiSend");

launcher.onclick = ()=> windowEl.style.display="flex";
closeBtn.onclick = ()=> windowEl.style.display="none";

send.onclick = handleSend;

input.addEventListener("keypress",e=>{
if(e.key==="Enter") handleSend();
});

document.querySelectorAll(".harvey-quick button").forEach(btn=>{
btn.onclick=()=>handleSend(btn.dataset.q);
});

function handleSend(text){
const msg=text||input.value.trim();
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

/* ===============================
AI RESPONSES
=============================== */

function getResponse(message){

const msg=message.toLowerCase();

if(msg.includes("ride"))
return "You can request a ride by tapping Book Ride and entering pickup and destination.";

if(msg.includes("driver"))
return "To become a driver, complete driver signup and submit documents for approval.";

if(msg.includes("support"))
return "Harvey Taxi support can help with riders, drivers, rides, and payments.";

if(msg.includes("foundation") || msg.includes("assistance"))
return "Harvey Transportation Assistance Foundation helps provide transportation for essential needs.";

if(msg.includes("payment"))
return "Payment is authorized before dispatch and charged after trip completion.";

if(msg.includes("emergency"))
return "If this is an emergency call 911 immediately.";

return "I can help with Harvey Taxi rides, drivers, payments, or assistance foundation.";
}

})();

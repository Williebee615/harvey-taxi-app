const express = require("express");
const cors = require("cors");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));


// ==============================
// ADMIN CONFIG
// ==============================
const ADMIN_EMAIL = "admin@harveytaxi.com";
const ADMIN_PASSWORD = "admin123";
const ADMIN_SECRET_PATH = "control-center-879";


// ==============================
// MEMORY
// ==============================
let drivers = [];
let rides = [];
let deliveries = [];


// ==============================
// HEALTH
// ==============================
app.get("/health", (req, res) => {
  res.json({ status: "Harvey Taxi running" });
});


// ==============================
// ADMIN LOGIN PAGE
// ==============================
app.get("/admin", (req, res) => {
  res.send(`
  <html>
  <head>
  <title>Harvey Taxi Admin</title>
  <style>
  body{font-family:Arial;background:#f4f6fb;padding:40px}
  .box{max-width:420px;margin:auto;background:white;padding:20px;border-radius:12px}
  input{width:100%;padding:12px;margin-top:10px}
  button{width:100%;padding:12px;margin-top:10px;background:#111;color:white;border:none;border-radius:8px}
  </style>
  </head>
  <body>
  <div class="box">
  <h2>🔐 Harvey Taxi Admin Login</h2>
  <input id="email" placeholder="Admin Email"/>
  <input id="password" type="password" placeholder="Password"/>
  <button onclick="login()">Enter Admin Dashboard</button>
  <p id="msg" style="color:red"></p>
  </div>

  <script>
  async function login(){
    const res = await fetch('/admin/login',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        email:document.getElementById('email').value,
        password:document.getElementById('password').value
      })
    })

    const data = await res.json()

    if(data.success){
      window.location = data.redirect
    }else{
      document.getElementById('msg').innerText = data.message
    }
  }
  </script>

  </body>
  </html>
  `);
});


// ==============================
// ADMIN LOGIN API
// ==============================
app.post("/admin/login", (req, res) => {
  const { email, password } = req.body;

  if (email === ADMIN_EMAIL && password === ADMIN_PASSWORD) {
    return res.json({
      success: true,
      redirect: "/" + ADMIN_SECRET_PATH,
    });
  }

  res.status(401).json({
    success: false,
    message: "Invalid login",
  });
});


// ==============================
// ADMIN DASHBOARD
// ==============================
app.get("/" + ADMIN_SECRET_PATH, (req, res) => {
  res.send(`
  <html>
  <head>
  <title>Admin Dashboard</title>
  <style>
  body{font-family:Arial;background:#0f172a;color:white;padding:20px}
  .card{background:#111827;padding:20px;margin:10px;border-radius:12px}
  </style>
  </head>
  <body>

  <h1>Harvey Taxi Admin Dashboard</h1>

  <div class="card">
  <h2>Drivers (${drivers.length})</h2>
  ${drivers.map(d=>`<div>${d.id}</div>`).join("")}
  </div>

  <div class="card">
  <h2>Rides (${rides.length})</h2>
  ${rides.map(r=>`<div>${r.pickup} → ${r.dropoff}</div>`).join("")}
  </div>

  <div class="card">
  <h2>Deliveries (${deliveries.length})</h2>
  ${deliveries.map(d=>`<div>${d.item}</div>`).join("")}
  </div>

  </body>
  </html>
  `);
});


// ==============================
// DRIVER UPDATE
// ==============================
app.post("/driver/update", (req, res) => {
  const { id, lat, lng } = req.body;

  let driver = drivers.find(d => d.id === id);

  if (driver) {
    driver.lat = lat;
    driver.lng = lng;
  } else {
    drivers.push({ id, lat, lng });
  }

  res.json({ success: true });
});


// ==============================
// REQUEST RIDE
// ==============================
app.post("/request-ride", (req, res) => {
  const ride = {
    id:

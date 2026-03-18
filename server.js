// ===== PART 1: SETUP =====
const express = require("express");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 10000;

// Middleware
app.use(cors());
app.use(express.json());

// Test route (VERY IMPORTANT for Render)
app.get("/", (req, res) => {
  res.send("Harvey Taxi API is running 🚖");
});const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname));

let rideRequests = [];
let driverLocations = [];// ROUTES

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/request-ride", (req, res) => {
  res.sendFile(path.join(__dirname, "request-ride.html"));
});

app.get("/driver", (req, res) => {
  res.sendFile(path.join(__dirname, "driver.html"));
});

// CREATE RIDE (SAFE VERSION - NO CRASH)
app.post("/api/request-ride", (req, res) => {
  const ride = {
    id: Date.now(),
    ...req.body,
    status: "pending"
  };

  rideRequests.push(ride);

  console.log("Ride created:", ride);

  res.json({ success: true, ride });
});

// GET RIDES
app.get("/api/rides", (req, res) => {
  res.json({ success: true, rides: rideRequests });
});

// DRIVER LOCATION
app.post("/api/driver-location", (req, res) => {
  driverLocations.push(req.body);
  res.json({ success: true });
});

// START SERVER
app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});

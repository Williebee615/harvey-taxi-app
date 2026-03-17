const express = require("express");
const path = require("path");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname));

// In-memory storage
let driverApplications = [];
let drivers = {};
let rides = {};
let rideRequests = [];

// Routes for pages
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/driver", (req, res) => {
  res.sendFile(path.join(__dirname, "driver.html"));
});

app.get("/driver-signup", (req, res) => {
  res.sendFile(path.join(__dirname, "driver-signup.html"));
});

app.get("/request-ride", (req, res) => {
  res.sendFile(path.join(__dirname, "request-ride.html"));
});

// ✅ DRIVER SIGNUP ROUTE (IMPORTANT)
app.post("/api/driver/apply", (req, res) => {
  console.log("=== DRIVER APPLICATION RECEIVED ===");
  console.log(req.body);

  try {
    const {
      fullName,
      phone,
      email,
      city,
      state,
      vehicleType,
      driverType
    } = req.body;

    if (
      !fullName ||
      !phone ||
      !email ||
      !city ||
      !state ||
      !vehicleType ||
      !driverType
    ) {
      return res.status(400).json({
        success: false,
        message: "All fields are required"
      });
    }

    const application = {
      id: Date.now(),
      fullName,
      phone,
      email,
      city,
      state,
      vehicleType,
      driverType,
      status: "pending",
      createdAt: new Date().toISOString()
    };

    driverApplications.push(application);

    res.json({
      success: true,
      message: "Application submitted successfully",
      application
    });

  } catch (error) {
    console.error("SERVER ERROR:", error);

    res.status(500).json({
      success: false,
      message: "Server error"
    });
  }
});

// View applications (for admin later)
app.get("/api/driver/applications", (req, res) => {
  res.json({
    success: true,
    applications: driverApplications
  });
});

// Driver GPS update
app.post("/api/driver/update", (req, res) => {
  const { driverId, lat, lng } = req.body;

  if (!driverId || lat == null || lng == null) {
    return res.status(400).json({
      success: false,
      message: "Missing driver data"
    });
  }

  drivers[driverId] = { driverId, lat, lng };

  res.json({
    success: true
  });
});

// Ride request
app.post("/request-ride", (req, res) => {
  const { lat, lng } = req.body;

  if (lat == null || lng == null) {
    return res.status(400).json({
      success: false
    });
  }

  const newRide = {
    id: Date.now(),
    lat,
    lng,
    status: "waiting"
  };

  rideRequests.push(newRide);

  res.json({
    success: true,
    ride: newRide
  });
});

// Get rides
app.get("/rides", (req, res) => {
  res.json(rideRequests);
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

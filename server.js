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
let drivers = {};
let rides = {};
let rideRequests = [];
let driverApplications = [];

// Pages
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

app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "admin.html"));
});

app.get("/dashboard", (req, res) => {
  res.sendFile(path.join(__dirname, "dashboard.html"));
});

// Driver signup route
app.post("/api/driver/apply", (req, res) => {
  console.log("Driver application received:", req.body);

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

  return res.json({
    success: true,
    message: "Application submitted successfully",
    application
  });
});

// View submitted applications
app.get("/api/driver/applications", (req, res) => {
  res.json({
    success: true,
    applications: driverApplications
  });
});

// Driver GPS update
app.post("/api/driver/update", (req, res) => {
  const { driverId, lat, lng, name } = req.body;

  if (!driverId || lat == null || lng == null) {
    return res.status(400).json({
      success: false,
      message: "driverId, lat, and lng are required"
    });
  }

  drivers[driverId] = {
    driverId,
    name: name || "Driver",
    lat,
    lng,
    updatedAt: new Date().toISOString()
  };

  res.json({
    success: true,
    driver: drivers[driverId]
  });
});

// Get drivers
app.get("/api/drivers", (req, res) => {
  res.json({
    success: true,
    drivers: Object.values(drivers)
  });
});

// Ride request
app.post("/request-ride", (req, res) => {
  const { lat, lng } = req.body;

  if (lat == null || lng == null) {
    return res.status(400).json({
      success: false,
      message: "lat and lng are required"
    });
  }

  const driverList = Object.values(drivers);
  const latestDriver = driverList.length > 0 ? driverList[driverList.length - 1] : null;

  const newRide = {
    id: Date.now(),
    lat,
    lng,
    status: latestDriver ? "assigned" : "waiting",
    driver: latestDriver || null,
    createdAt: new Date().toISOString()
  };

  rideRequests.push(newRide);
  rides[newRide.id] = newRide;

  res.json({
    success: true,
    ride: newRide
  });
});

// Get rides
app.get("/rides", (req, res) => {
  res.json(rideRequests);
});

app.get("/api/rides", (req, res) => {
  res.json({
    success: true,
    rides: Object.values(rides)
  });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

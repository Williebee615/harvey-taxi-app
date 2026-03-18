const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 10000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files
app.use(express.static(__dirname));

// In-memory storage
let rideRequests = [];
let driverLocations = [];

// Page routes
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/request-ride", (req, res) => {
  res.sendFile(path.join(__dirname, "request-ride.html"));
});

app.get("/driver", (req, res) => {
  res.sendFile(path.join(__dirname, "driver.html"));
});

app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "admin.html"));
});

app.get("/dashboard", (req, res) => {
  res.sendFile(path.join(__dirname, "dashboard.html"));
});

app.get("/driver-signup", (req, res) => {
  res.sendFile(path.join(__dirname, "driver-signup.html"));
});

// Health check
app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "Harvey Taxi API is running"
  });
});

// Create ride request
app.post("/api/request-ride", (req, res) => {
  const {
    name,
    phone,
    pickup,
    dropoff,
    notes,
    latitude,
    longitude,
    manualPickup
  } = req.body;

  const ride = {
    id: Date.now(),
    name: name || "Unknown Rider",
    phone: phone || "",
    pickup: pickup || manualPickup || "No pickup entered",
    dropoff: dropoff || "No dropoff entered",
    notes: notes || "",
    latitude: latitude || null,
    longitude: longitude || null,
    status: "pending",
    assignedDriver: null,
    createdAt: new Date().toISOString()
  };

  rideRequests.push(ride);

  console.log("NEW RIDE REQUEST:", ride);

  res.json({
    success: true,
    message: "Ride request received successfully",
    ride
  });
});

// Get all rides
app.get("/api/rides", (req, res) => {
  res.json({
    success: true,
    rides: rideRequests
  });
});// Accept ride
app.post("/api/rides/:id/accept", (req, res) => {
  const rideId = parseInt(req.params.id, 10);
  const { driverName } = req.body;

  const ride = rideRequests.find(r => r.id === rideId);

  if (!ride) {
    return res.status(404).json({
      success: false,
      message: "Ride not found"
    });
  }

  ride.status = "accepted";
  ride.assignedDriver = driverName || "Driver";
  ride.acceptedAt = new Date().toISOString();

  console.log("RIDE ACCEPTED:", ride);

  res.json({
    success: true,
    message: "Ride accepted successfully",
    ride
  });
});

// Complete ride
app.post("/api/rides/:id/complete", (req, res) => {
  const rideId = parseInt(req.params.id, 10);

  const ride = rideRequests.find(r => r.id === rideId);

  if (!ride) {
    return res.status(404).json({
      success: false,
      message: "Ride not found"
    });
  }

  ride.status = "completed";
  ride.completedAt = new Date().toISOString();

  console.log("RIDE COMPLETED:", ride);

  res.json({
    success: true,
    message: "Ride completed successfully",
    ride
  });
});

// Update driver location
app.post("/api/driver-location", (req, res) => {
  const { driverId, driverName, latitude, longitude } = req.body;

  if (!driverId || latitude === undefined || longitude === undefined) {
    return res.status(400).json({
      success: false,
      message: "Missing required driver location data"
    });
  }

  const existingDriver = driverLocations.find(
    d => String(d.driverId) === String(driverId)
  );

  if (existingDriver) {
    existingDriver.driverName = driverName || existingDriver.driverName;
    existingDriver.latitude = latitude;
    existingDriver.longitude = longitude;
    existingDriver.updatedAt = new Date().toISOString();
  } else {
    driverLocations.push({
      driverId,
      driverName: driverName || "Driver",
      latitude,
      longitude,
      updatedAt: new Date().toISOString()
    });
  }

  res.json({
    success: true,
    message: "Driver location updated successfully"
  });
});

// Get driver locations
app.get("/api/driver-locations", (req, res) => {
  res.json({
    success: true,
    drivers: driverLocations
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).send("Page not found");
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

const express = require("express");
const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json());
app.use(express.static(__dirname));

let drivers = {};
let rides = {};

// Save or update driver location
app.post("/api/driver/location", (req, res) => {
  const { id, lat, lng } = req.body;

  if (!id || lat == null || lng == null) {
    return res.status(400).json({ error: "Missing driver location data" });
  }

  drivers[id] = {
    id,
    lat,
    lng,
    updatedAt: Date.now()
  };

  res.json({
    status: "ok",
    driver: drivers[id]
  });
});

// Simple distance helper
function getDistance(a, b) {
  const dx = a.lat - b.lat;
  const dy = a.lng - b.lng;
  return Math.sqrt(dx * dx + dy * dy);
}

// Request ride and assign nearest driver
app.post("/api/ride/request", (req, res) => {
  const rideId = "ride_" + Date.now();
  const { riderId, pickup } = req.body;

  if (!pickup || pickup.lat == null || pickup.lng == null) {
    return res.status(400).json({ error: "Missing pickup location" });
  }

  let assignedDriver = null;
  let minDistance = Infinity;

  const driverIds = Object.keys(drivers);

  if (driverIds.length > 0) {
    for (let id of driverIds) {
      const driver = drivers[id];
      const dist = getDistance(pickup, driver);

      if (dist < minDistance) {
        minDistance = dist;
        assignedDriver = driver;
      }
    }
  }

  rides[rideId] = {
    id: rideId,
    riderId: riderId || "rider1",
    pickup,
    status: assignedDriver ? "assigned" : "waiting",
    assignedDriverId: assignedDriver ? assignedDriver.id : null,
    createdAt: Date.now()
  };

  res.json({
    rideId,
    status: rides[rideId].status
  });
});

// Get ride status and latest assigned driver location
app.get("/api/ride/:id", (req, res) => {
  const ride = rides[req.params.id];

  if (!ride) {
    return res.status(404).json({ error: "Ride not found" });
  }

  const driver = ride.assignedDriverId
    ? drivers[ride.assignedDriverId]
    : null;

  res.json({
    id: ride.id,
    status: driver ? "assigned" : ride.status,
    driver: driver || null
  });
});

app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});

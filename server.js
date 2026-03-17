const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json());
app.use(express.static(__dirname));

let drivers = {};
let rides = {};
let rideRequests = [];

// Home + pages
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/driver", (req, res) => {
  res.sendFile(path.join(__dirname, "driver.html"));
});

app.get("/request-ride", (req, res) => {
  res.sendFile(path.join(__dirname, "request-ride.html"));
});

// Driver GPS update
app.post("/api/driver/update", (req, res) => {
  const { driverId, lat, lng } = req.body;

  if (!driverId || lat == null || lng == null) {
    return res.status(400).json({ error: "Missing driver location data" });
  }

  drivers[driverId] = {
    driverId,
    lat,
    lng,
    updatedAt: Date.now()
  };

  res.json({
    success: true,
    driver: drivers[driverId]
  });
});

// Optional compatibility route
app.post("/api/driver/location", (req, res) => {
  const { id, lat, lng } = req.body;

  if (!id || lat == null || lng == null) {
    return res.status(400).json({ error: "Missing driver location data" });
  }

  drivers[id] = {
    driverId: id,
    lat,
    lng,
    updatedAt: Date.now()
  };

  res.json({
    success: true,
    driver: drivers[id]
  });
});

function getDistance(a, b) {
  const dx = a.lat - b.lat;
  const dy = a.lng - b.lng;
  return Math.sqrt(dx * dx + dy * dy);
}// Rider creates ride request
app.post("/api/ride/request", (req, res) => {
  const { riderId, pickup } = req.body;

  if (!pickup || pickup.lat == null || pickup.lng == null) {
    return res.status(400).json({ error: "Missing pickup location" });
  }

  let nearestDriver = null;
  let minDistance = Infinity;

  for (const key in drivers) {
    const driver = drivers[key];
    const dist = getDistance(pickup, driver);

    if (dist < minDistance) {
      minDistance = dist;
      nearestDriver = driver;
    }
  }

  const rideId = "ride_" + Date.now();

  rides[rideId] = {
    id: rideId,
    riderId: riderId || "rider1",
    pickup,
    status: nearestDriver ? "assigned" : "waiting",
    driver: nearestDriver || null,
    createdAt: Date.now()
  };

  if (nearestDriver) {
    rideRequests.push({
      id: rideId,
      riderId: riderId || "rider1",
      pickup,
      driver: nearestDriver,
      status: "assigned"
    });
  }

  res.json({
    success: true,
    rideId,
    status: rides[rideId].status
  });
});

// Rider checks ride
app.get("/api/ride/:id", (req, res) => {
  const ride = rides[req.params.id];

  if (!ride) {
    return res.status(404).json({ error: "Ride not found" });
  }

  let latestDriver = ride.driver;

  if (ride.driver && ride.driver.driverId && drivers[ride.driver.driverId]) {
    latestDriver = drivers[ride.driver.driverId];
  }

  res.json({
    id: ride.id,
    status: latestDriver ? "assigned" : ride.status,
    driver: latestDriver || null
  });
});

// Simple ride request list
app.post("/request-ride", (req, res) => {
  const { lat, lng } = req.body;

  if (lat == null || lng == null) {
    return res.status(400).json({ error: "Missing location" });
  }

  const newRide = {
    id: Date.now(),
    lat,
    lng,
    status: "waiting"
  };

  rideRequests.push(newRide);

  res.json({ success: true, ride: newRide });
});

app.get("/rides", (req, res) => {
  res.json(rideRequests);
});

app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});

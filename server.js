const express = require("express");

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Temporary ride storage
let rides = [];

// Home route
app.get("/", (req, res) => {
  res.send("🚕 Harvey Taxi API is running");
});

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "OK" });
});

// Get all ride requests
app.get("/rides", (req, res) => {
  res.json(rides);
});

// Request a ride
app.post("/ride/request", (req, res) => {
  const ride = {
    id: rides.length + 1,
    pickup: req.body.pickup,
    dropoff: req.body.dropoff,
    rider: req.body.rider,
    status: "requested",
    time: new Date()
  };

  rides.push(ride);

  res.json({
    success: true,
    message: "Ride requested successfully",
    ride
  });
});

// Start server
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚕 Harvey Taxi server running on port ${PORT}`);
});

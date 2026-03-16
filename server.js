const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files
app.use(express.static(__dirname));

// Temporary ride storage
let rides = [];

// Home route
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "request-ride.html"));
});

// Handle ride request
app.post("/request-ride", (req, res) => {
  const ride = req.body;
  rides.push(ride);

  console.log("New Ride Request:", ride);

  res.send("Ride request received! A driver will contact you soon.");
});

// View all rides
app.get("/rides", (req, res) => {
  res.json(rides);
});

app.listen(PORT, () => {
  console.log(`🚕 Harvey Taxi server running on port ${PORT}`);
});

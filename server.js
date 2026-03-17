const express = require("express");
const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json());
app.use(express.static(__dirname));

let drivers = {};
let rides = {};

// DRIVER LOCATION UPDATE
app.post("/api/driver/location", (req, res) => {
  const { id, lat, lng } = req.body;
  drivers[id] = { lat, lng };
  res.json({ status: "ok" });
});

// REQUEST RIDE
app.post("/api/ride/request", (req, res) => {
  const rideId = "ride_" + Date.now();
  const { pickup } = req.body;

  rides[rideId] = {
    id: rideId,
    pickup,
    status: "waiting",
    driver: null
  };

  const driverIds = Object.keys(drivers);
  if (driverIds.length > 0) {
    const driver = drivers[driverIds[0]];
    rides[rideId].driver = driver;
    rides[rideId].status = "assigned";
  }

  res.json({ rideId });
});

// GET RIDE STATUS
app.get("/api/ride/:id", (req, res) => {
  const ride = rides[req.params.id];
  res.json(ride || {});
});

app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});

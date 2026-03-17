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
  }  rides[rideId] = {
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

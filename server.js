function getDistance(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) *
    Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) *
    Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}app.post("/api/request-ride", (req, res) => {
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
    assignedDriverId: null,
    createdAt: new Date().toISOString()
  };

  if (driverLocations.length > 0 && ride.latitude && ride.longitude) {
    let closestDriver = null;
    let shortestDistance = Infinity;

    driverLocations.forEach((driver) => {
      const distance = getDistance(
        Number(ride.latitude),
        Number(ride.longitude),
        Number(driver.latitude),
        Number(driver.longitude)
      );

      if (distance < shortestDistance) {
        shortestDistance = distance;
        closestDriver = driver;
      }
    });

    if (closestDriver) {
      ride.status = "assigned";
      ride.assignedDriver = closestDriver.driverName || "Driver";
      ride.assignedDriverId = closestDriver.driverId;
    }
  }

  rideRequests.push(ride);

  console.log("AUTO ASSIGNED RIDE:", ride);

  res.json({
    success: true,
    message: "Ride request processed successfully",
    ride
  });
});

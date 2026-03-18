const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(__dirname));

const drivers = {
  driver_1: {
    id: "driver_1",
    name: "WILLIE",
    photo: "https://via.placeholder.com/110",

    acceptedJobs: 0,
    cancelledJobs: 0,
    completedJobs: 0,

    ridesCompleted: 0,
    deliveriesCompleted: 0,

    rideRatingTotal: 0,
    rideRatingCount: 0,

    deliveryPositiveCount: 0,
    deliveryRatingCount: 0,

    totalEarnings: 0
  }
};

function acceptanceRate(driver) {
  const total = driver.acceptedJobs + driver.cancelledJobs;
  if (total === 0) return 100;
  return Math.round((driver.acceptedJobs / total) * 100);
}

function cancellationRate(driver) {
  const total = driver.acceptedJobs + driver.cancelledJobs;
  if (total === 0) return 0;
  return Math.round((driver.cancelledJobs / total) * 100);
}

function completionRate(driver) {
  if (driver.acceptedJobs === 0) return 0;
  return Math.round((driver.completedJobs / driver.acceptedJobs) * 100);
}

function rideRating(driver) {
  if (driver.rideRatingCount === 0) return "5.00";
  return (driver.rideRatingTotal / driver.rideRatingCount).toFixed(2);
}

function deliverySatisfaction(driver) {
  if (driver.deliveryRatingCount === 0) return 100;
  return Math.round(
    (driver.deliveryPositiveCount / driver.deliveryRatingCount) * 100
  );
}

function tier(driver) {
  const totalJobs = driver.ridesCompleted + driver.deliveriesCompleted;

  if (totalJobs >= 1000) return "Diamond";
  if (totalJobs >= 500) return "Gold";
  if (totalJobs >= 200) return "Blue";
  return "Starter";
}

function buildStats(driver) {
  return {
    id: driver.id,
    name: driver.name,
    photo: driver.photo,
    tier: tier(driver),
    acceptanceRate: acceptanceRate(driver),
    cancellationRate: cancellationRate(driver),
    completionRate: completionRate(driver),
    rideRating: rideRating(driver),
    deliverySatisfaction: deliverySatisfaction(driver),
    ridesCompleted: driver.ridesCompleted,
    deliveriesCompleted: driver.deliveriesCompleted,
    totalEarnings: driver.totalEarnings.toFixed(2)
  };
}

app.get("/api/driver/stats", (req, res) => {
  const driver = drivers.driver_1;
  res.json(buildStats(driver));
});

app.post("/api/driver/accept", (req, res) => {
  const driver = drivers.driver_1;
  driver.acceptedJobs += 1;
  res.json(buildStats(driver));
});

app.post("/api/driver/cancel", (req, res) => {
  const driver = drivers.driver_1;
  driver.cancelledJobs += 1;
  res.json(buildStats(driver));
});

app.post("/api/driver/complete-ride", (req, res) => {
  const driver = drivers.driver_1;

  driver.acceptedJobs += 1;
  driver.completedJobs += 1;
  driver.ridesCompleted += 1;

  driver.rideRatingTotal += 5;
  driver.rideRatingCount += 1;

  driver.totalEarnings += 15;

  res.json(buildStats(driver));
});

app.post("/api/driver/complete-delivery", (req, res) => {
  const driver = drivers.driver_1;

  driver.acceptedJobs += 1;
  driver.completedJobs += 1;
  driver.deliveriesCompleted += 1;

  driver.deliveryPositiveCount += 1;
  driver.deliveryRatingCount += 1;

  driver.totalEarnings += 10;

  res.json(buildStats(driver));
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

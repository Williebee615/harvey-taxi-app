const express = require("express");
const path = require("path");

const app = express();
const PORT = 3000;

app.use(express.json());
app.use(express.static(__dirname));

/* ===============================
   DRIVER DATABASE (TEMP STORAGE)
================================ */
const drivers = {
  "driver_1": {
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

/* ===============================
   CALCULATIONS
================================ */
function acceptanceRate(d) {
  const total = d.acceptedJobs + d.cancelledJobs;
  if (total === 0) return 100;
  return Math.round((d.acceptedJobs / total) * 100);
}

function cancellationRate(d) {
  const total = d.acceptedJobs + d.cancelledJobs;
  if (total === 0) return 0;
  return Math.round((d.cancelledJobs / total) * 100);
}

function completionRate(d) {
  if (d.acceptedJobs === 0) return 0;
  return Math.round((d.completedJobs / d.acceptedJobs) * 100);
}

function rideRating(d) {
  if (d.rideRatingCount === 0) return 5.0;
  return (d.rideRatingTotal / d.rideRatingCount).toFixed(2);
}

function deliverySatisfaction(d) {
  if (d.deliveryRatingCount === 0) return 100;
  return Math.round((d.deliveryPositiveCount / d.deliveryRatingCount) * 100);
}

function tier(d) {
  const totalJobs = d.ridesCompleted + d.deliveriesCompleted;

  if (totalJobs >= 1000) return "Diamond";
  if (totalJobs >= 500) return "Gold";
  if (totalJobs >= 200) return "Blue";
  return "Starter";
}

function buildStats(d) {
  return {
    id: d.id,
    name: d.name,
    photo: d.photo,
    tier: tier(d),

    acceptanceRate: acceptanceRate(d),
    cancellationRate: cancellationRate(d),
    completionRate: completionRate(d),

    rideRating: rideRating(d),
    deliverySatisfaction: deliverySatisfaction(d),

    ridesCompleted: d.ridesCompleted,
    deliveriesCompleted: d.deliveriesCompleted,
    totalEarnings: d.totalEarnings.toFixed(2)
  };
}

/* ===============================
   API ROUTES
================================ */

/* GET DRIVER STATS */
app.get("/api/driver/stats", (req, res) => {
  const driver = drivers["driver_1"];
  res.json(buildStats(driver));
});

/* ACCEPT JOB */
app.post("/api/driver/accept", (req, res) => {
  const d = drivers["driver_1"];
  d.acceptedJobs += 1;
  res.json(buildStats(d));
});

/* CANCEL JOB */
app.post("/api/driver/cancel", (req, res) => {
  const d = drivers["driver_1"];
  d.cancelledJobs += 1;
  res.json(buildStats(d));
});

/* COMPLETE RIDE */
app.post("/api/driver/complete-ride", (req, res) => {
  const d = drivers["driver_1"];

  d.completedJobs += 1;
  d.ridesCompleted += 1;
  d.acceptedJobs += 1;

  d.rideRatingTotal += 5;
  d.rideRatingCount += 1;

  d.totalEarnings += 15;

  res.json(buildStats(d));
});

/* COMPLETE DELIVERY */
app.post("/api/driver/complete-delivery", (req, res) => {
  const d = drivers["driver_1"];

  d.completedJobs += 1;
  d.deliveriesCompleted += 1;
  d.acceptedJobs += 1;

  d.deliveryPositiveCount += 1;
  d.deliveryRatingCount += 1;

  d.totalEarnings += 10;

  res.json(buildStats(d));
});

/* ===============================
   START SERVER
================================ */
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

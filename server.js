const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json());
app.use(express.static(__dirname));

let drivers = [];
let applications = [];
let driverStats = {
  name: "WILLIE",
  photo: "https://via.placeholder.com/80",
  tier: "Starter",
  acceptanceRate: 0,
  cancellationRate: 0,
  completionRate: 0,
  rideRating: 4.96,
  deliverySatisfaction: 100,
  ridesCompleted: 0,
  deliveriesCompleted: 0,
  totalEarnings: "0.00"
};

// HOME
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// DRIVER SIGNUP
app.post("/api/driver/signup", (req, res) => {
  const newApplication = {
    id: Date.now().toString(),
    name: req.body.name || "",
    email: req.body.email || "",
    phone: req.body.phone || "",
    city: req.body.city || "",
    state: req.body.state || "",
    vehicleType: req.body.vehicleType || "",
    driverType: req.body.driverType || "",
    status: "pending",
    createdAt: new Date().toISOString()
  };

  applications.push(newApplication);
  drivers.push(newApplication);

  res.json({
    success: true,
    message: "Driver application submitted successfully.",
    application: newApplication
  });
});

// ADMIN - GET APPLICATIONS
app.get("/api/admin/applications", (req, res) => {
  res.json(applications);
});

// ADMIN - APPROVE APPLICATION
app.post("/api/admin/approve/:id", (req, res) => {
  const application = applications.find(app => app.id === req.params.id);

  if (!application) {
    return res.status(404).json({ success: false, message: "Application not found." });
  }

  application.status = "approved";
  res.json({ success: true, application });
});

// ADMIN - REJECT APPLICATION
app.post("/api/admin/reject/:id", (req, res) => {
  const application = applications.find(app => app.id === req.params.id);

  if (!application) {
    return res.status(404).json({ success: false, message: "Application not found." });
  }

  application.status = "rejected";
  res.json({ success: true, application });
});// DRIVER LIST
app.get("/drivers", (req, res) => {
  res.json(drivers);
});

// DRIVER STATS
app.get("/api/driver/stats", (req, res) => {
  res.json(driverStats);
});

// COMPLETE RIDE
app.post("/api/driver/complete-ride", (req, res) => {
  driverStats.ridesCompleted += 1;
  driverStats.totalEarnings = (
    parseFloat(driverStats.totalEarnings) + 15
  ).toFixed(2);
  driverStats.acceptanceRate = 100;
  driverStats.completionRate = 100;

  if (driverStats.ridesCompleted >= 10) {
    driverStats.tier = "Blue";
  }

  res.json({ success: true, stats: driverStats });
});

// COMPLETE DELIVERY
app.post("/api/driver/complete-delivery", (req, res) => {
  driverStats.deliveriesCompleted += 1;
  driverStats.totalEarnings = (
    parseFloat(driverStats.totalEarnings) + 10
  ).toFixed(2);
  driverStats.acceptanceRate = 100;
  driverStats.completionRate = 100;

  if (driverStats.deliveriesCompleted >= 10) {
    driverStats.tier = "Blue";
  }

  res.json({ success: true, stats: driverStats });
});

// APPLY DRIVER SIMPLE ROUTE
app.post("/apply-driver", (req, res) => {
  const driver = {
    id: Date.now().toString(),
    ...req.body
  };

  drivers.push(driver);
  res.json({ success: true, driver });
});

// FALLBACK FOR STATIC PAGES
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
/* ===============================
   DRIVER STATS
================================ */

app.get("/driver-stats", (req, res) => {
  res.json(driverStats);
});

app.post("/complete-ride", (req, res) => {
  driverStats.rides += 1;
  driverStats.earnings += 15;
  driverStats.acceptanceRate = 100;
  driverStats.completionRate = 100;

  res.json({ success: true, stats: driverStats });
});

app.post("/complete-delivery", (req, res) => {
  driverStats.deliveries += 1;
  driverStats.earnings += 10;
  driverStats.acceptanceRate = 100;
  driverStats.completionRate = 100;

  res.json({ success: true, stats: driverStats });
});

/* ===============================
   FALLBACK FIX (VERY IMPORTANT)
================================ */

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

/* ===============================
   START SERVER
================================ */

app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});

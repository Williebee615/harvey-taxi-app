const express = require("express");
const cors = require("cors");
const path = require("path");

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

let applications = [];
let rides = [];

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

app.get("/admin.html", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

app.get("/health", (req, res) => {
  res.json({ success: true, message: "Harvey Taxi API is running" });
});

app.get("/api/driver-applications", (req, res) => {
  res.json(applications);
});

app.post("/api/driver-applications", (req, res) => {
  const newApplication = {
    id: Date.now().toString(),
    fullName: req.body.fullName || req.body.name || "",
    email: req.body.email || "",
    phone: req.body.phone || "",
    vehicleType: req.body.vehicleType || req.body.vehicle || "",
    vehicle: req.body.vehicle || req.body.vehicleType || "",
    licenseNumber: req.body.licenseNumber || "",
    latitude: req.body.latitude !== undefined ? Number(req.body.latitude) : null,
    longitude: req.body.longitude !== undefined ? Number(req.body.longitude) : null,
    status: "pending",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  applications.unshift(newApplication);
  res.status(201).json(newApplication);
});

app.post("/api/driver-applications/:id/approve", (req, res) => {
  const application = applications.find(item => item.id === req.params.id);
  if (!application) {
    return res.status(404).json({ error: "Application not found" });
  }

  application.status = "approved";
  application.updatedAt = new Date().toISOString();

  res.json({ success: true, application });
});

app.post("/api/driver-applications/:id/reject", (req, res) => {
  const application = applications.find(item => item.id === req.params.id);
  if (!application) {
    return res.status(404).json({ error: "Application not found" });
  }

  application.status = "rejected";
  application.updatedAt = new Date().toISOString();

  res.json({ success: true, application });
});

app.get("/api/drivers/approved-locations", (req, res) => {
  const approvedDrivers = applications.filter(item =>
    item.status === "approved" &&
    item.latitude !== null &&
    item.longitude !== null
  );

  res.json(approvedDrivers);
});

app.post("/api/drivers/:id/location", (req, res) => {
  const driver = applications.find(item =>
    item.id === req.params.id && item.status === "approved"
  );

  if (!driver) {
    return res.status(404).json({ error: "Approved driver not found" });
  }

  driver.latitude = req.body.latitude !== undefined ? Number(req.body.latitude) : driver.latitude;
  driver.longitude = req.body.longitude !== undefined ? Number(req.body.longitude) : driver.longitude;
  driver.updatedAt = new Date().toISOString();

  res.json({ success: true, driver });
});

app.get("/api/rides", (req, res) => {
  res.json(rides);
});

app.post("/api/rides", (req, res) => {
  const newRide = {
    id: Date.now().toString(),
    riderName: req.body.riderName || "",
    pickup: req.body.pickup || req.body.pickupLocation || "",
    pickupLocation: req.body.pickupLocation || req.body.pickup || "",
    dropoff: req.body.dropoff || req.body.dropoffLocation || "",
    dropoffLocation: req.body.dropoffLocation || req.body.dropoff || "",
    driverName: req.body.driverName || "",
    status: req.body.status || "pending",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  rides.unshift(newRide);
  res.status(201).json(newRide);
});

app.patch("/api/rides/:id", (req, res) => {
  const ride = rides.find(item => item.id === req.params.id);
  if (!ride) {
    return res.status(404).json({ error: "Ride not found" });
  }

  Object.assign(ride, req.body, { updatedAt: new Date().toISOString() });
  res.json(ride);
});

const PORT = process.env.PORT || 10000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

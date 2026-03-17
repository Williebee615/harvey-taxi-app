const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
require("dotenv").config();

const app = express();

// ================= MIDDLEWARE =================
app.use(cors());
app.use(express.json());

// ================= DATABASE =================
const MONGODB_URI =
  process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/harvey_taxi";

mongoose
  .connect(MONGODB_URI)
  .then(() => {
    console.log("MongoDB connected");
  })
  .catch((err) => {
    console.error("MongoDB connection error:", err.message);
  });

// ================= SCHEMAS =================
const driverApplicationSchema = new mongoose.Schema(
  {
    fullName: { type: String, default: "" },
    email: { type: String, default: "" },
    phone: { type: String, default: "" },
    vehicleType: { type: String, default: "" },
    vehicle: { type: String, default: "" },
    licenseNumber: { type: String, default: "" },
    latitude: { type: Number, default: null },
    longitude: { type: Number, default: null },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
    },
  },
  { timestamps: true }
);

const rideSchema = new mongoose.Schema(
  {
    riderName: { type: String, default: "" },
    pickup: { type: String, default: "" },
    pickupLocation: { type: String, default: "" },
    dropoff: { type: String, default: "" },
    dropoffLocation: { type: String, default: "" },
    driverName: { type: String, default: "" },
    status: {
      type: String,
      enum: ["pending", "active", "completed", "cancelled"],
      default: "pending",
    },
  },
  { timestamps: true }
);

const DriverApplication = mongoose.model(
  "DriverApplication",
  driverApplicationSchema
);
const Ride = mongoose.model("Ride", rideSchema);

// ================= BASIC ROUTES =================
app.get("/", (req, res) => {
  res.send("Harvey Taxi API is running");
});

app.get("/health", (req, res) => {
  res.json({
    success: true,
    message: "Server is healthy",
  });
});

// ================= DRIVER APPLICATION ROUTES =================

// Get all driver applications
app.get("/api/driver-applications", async (req, res) => {
  try {
    const applications = await DriverApplication.find().sort({ createdAt: -1 });
    res.json(applications);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create a new driver application
app.post("/api/driver-applications", async (req, res) => {
  try {
    const newApplication = new DriverApplication({
      fullName: req.body.fullName || req.body.name || "",
      email: req.body.email || "",
      phone: req.body.phone || "",
      vehicleType: req.body.vehicleType || req.body.vehicle || "",
      vehicle: req.body.vehicle || req.body.vehicleType || "",
      licenseNumber: req.body.licenseNumber || "",
      latitude:
        req.body.latitude !== undefined ? Number(req.body.latitude) : null,
      longitude:
        req.body.longitude !== undefined ? Number(req.body.longitude) : null,
      status: "pending",
    });

    const savedApplication = await newApplication.save();
    res.status(201).json(savedApplication);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Approve driver application
app.post("/api/driver-applications/:id/approve", async (req, res) => {
  try {
    const updated = await DriverApplication.findByIdAndUpdate(
      req.params.id,
      { status: "approved" },
      { new: true }
    );

    if (!updated) {
      return res.status(404).json({ error: "Application not found" });
    }

    res.json({
      success: true,
      message: "Driver approved successfully",
      application: updated,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Reject driver application
app.post("/api/driver-applications/:id/reject", async (req, res) => {
  try {
    const updated = await DriverApplication.findByIdAndUpdate(
      req.params.id,
      { status: "rejected" },
      { new: true }
    );

    if (!updated) {
      return res.status(404).json({ error: "Application not found" });
    }

    res.json({
      success: true,
      message: "Driver rejected successfully",
      application: updated,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update approved driver live location
app.post("/api/drivers/:id/location", async (req, res) => {
  try {
    const { latitude, longitude } = req.body;

    const updated = await DriverApplication.findOneAndUpdate(
      { _id: req.params.id, status: "approved" },
      {
        latitude: Number(latitude),
        longitude: Number(longitude),
      },
      { new: true }
    );

    if (!updated) {
      return res.status(404).json({ error: "Approved driver not found" });
    }

    res.json({
      success: true,
      message: "Driver location updated",
      driver: updated,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get approved drivers with location
app.get("/api/drivers/approved-locations", async (req, res) => {
  try {
    const drivers = await DriverApplication.find({
      status: "approved",
      latitude: { $ne: null },
      longitude: { $ne: null },
    }).sort({ updatedAt: -1 });

    res.json(drivers);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ================= RIDE ROUTES =================

// Get rides
app.get("/api/rides", async (req, res) => {
  try {
    const rides = await Ride.find().sort({ createdAt: -1 }).limit(50);
    res.json(rides);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create a ride
app.post("/api/rides", async (req, res) => {
  try {
    const newRide = new Ride({
      riderName: req.body.riderName || "",
      pickup: req.body.pickup || req.body.pickupLocation || "",
      pickupLocation: req.body.pickupLocation || req.body.pickup || "",
      dropoff: req.body.dropoff || req.body.dropoffLocation || "",
      dropoffLocation: req.body.dropoffLocation || req.body.dropoff || "",
      driverName: req.body.driverName || "",
      status: req.body.status || "pending",
    });

    const savedRide = await newRide.save();
    res.status(201).json(savedRide);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update ride status
app.patch("/api/rides/:id", async (req, res) => {
  try {
    const updatedRide = await Ride.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true }
    );

    if (!updatedRide) {
      return res.status(404).json({ error: "Ride not found" });
    }

    res.json(updatedRide);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ================= START SERVER =================
const PORT = process.env.PORT || 10000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

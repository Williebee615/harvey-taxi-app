const express = require("express");
const path = require("path");
const cors = require("cors");
const mongoose = require("mongoose");

const app = express();
const PORT = process.env.PORT || 10000;
const MONGODB_URI = process.env.MONGODB_URI;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname));

if (!MONGODB_URI) {
  console.error("Missing MONGODB_URI environment variable");
  process.exit(1);
}

// MongoDB connection
mongoose.connect(MONGODB_URI)
  .then(() => {
    console.log("MongoDB connected successfully");
  })
  .catch((error) => {
    console.error("MongoDB connection error:", error);
    process.exit(1);
  });

// Schemas
const driverApplicationSchema = new mongoose.Schema(
  {
    fullName: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true },
    email: { type: String, required: true, trim: true },
    city: { type: String, required: true, trim: true },
    state: { type: String, required: true, trim: true },
    vehicleType: { type: String, required: true, trim: true },
    driverType: { type: String, required: true, trim: true },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending"
    }
  },
  { timestamps: true }
);

const driverLocationSchema = new mongoose.Schema(
  {
    driverId: { type: String, required: true, unique: true },
    name: { type: String, default: "Driver" },
    lat: { type: Number, required: true },
    lng: { type: Number, required: true }
  },
  { timestamps: true }
);

const rideRequestSchema = new mongoose.Schema(
  {
    riderName: { type: String, default: "" },
    phone: { type: String, default: "" },
    pickup: { type: String, default: "" },
    dropoff: { type: String, default: "" },
    lat: { type: Number, required: true },
    lng: { type: Number, required: true },
    status: {
      type: String,
      enum: ["waiting", "assigned", "completed", "cancelled"],
      default: "waiting"
    },
    driver: {
      driverId: { type: String, default: null },
      name: { type: String, default: null },
      lat: { type: Number, default: null },
      lng: { type: Number, default: null }
    }
  },
  { timestamps: true }
);

const DriverApplication = mongoose.model("DriverApplication", driverApplicationSchema);
const DriverLocation = mongoose.model("DriverLocation", driverLocationSchema);
const RideRequest = mongoose.model("RideRequest", rideRequestSchema);

// Page routes
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/driver", (req, res) => {
  res.sendFile(path.join(__dirname, "driver.html"));
});

app.get("/driver-signup", (req, res) => {
  res.sendFile(path.join(__dirname, "driver-signup.html"));
});

app.get("/request-ride", (req, res) => {
  res.sendFile(path.join(__dirname, "request-ride.html"));
});

app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "admin.html"));
});

app.get("/dashboard", (req, res) => {
  res.sendFile(path.join(__dirname, "dashboard.html"));
});

// Driver signup
app.post("/api/driver/apply", async (req, res) => {
  try {
    const {
      fullName,
      phone,
      email,
      city,
      state,
      vehicleType,
      driverType
    } = req.body;

    if (
      !fullName ||
      !phone ||
      !email ||
      !city ||
      !state ||
      !vehicleType ||
      !driverType
    ) {
      return res.status(400).json({
        success: false,
        message: "All fields are required"
      });
    }

    const application = await DriverApplication.create({
      fullName,
      phone,
      email,
      city,
      state,
      vehicleType,
      driverType,
      status: "pending"
    });

    return res.json({
      success: true,
      message: "Application submitted successfully",
      application
    });
  } catch (error) {
    console.error("Driver application error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error submitting application"
    });
  }
});

// Get all driver applications
app.get("/api/driver/applications", async (req, res) => {
  try {
    const applications = await DriverApplication.find().sort({ createdAt: -1 });

    return res.json({
      success: true,
      applications
    });
  } catch (error) {
    console.error("Get applications error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to load applications"
    });
  }
});

// Approve application
app.post("/api/driver/applications/:id/approve", async (req, res) => {
  try {
    const application = await DriverApplication.findByIdAndUpdate(
      req.params.id,
      { status: "approved" },
      { new: true }
    );

    if (!application) {
      return res.status(404).json({
        success: false,
        message: "Application not found"
      });
    }

    return res.json({
      success: true,
      message: "Driver approved",
      application
    });
  } catch (error) {
    console.error("Approve application error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to approve driver"
    });
  }
});

// Reject application
app.post("/api/driver/applications/:id/reject", async (req, res) => {
  try {
    const application = await DriverApplication.findByIdAndUpdate(
      req.params.id,
      { status: "rejected" },
      { new: true }
    );

    if (!application) {
      return res.status(404).json({
        success: false,
        message: "Application not found"
      });
    }

    return res.json({
      success: true,
      message: "Driver rejected",
      application
    });
  } catch (error) {
    console.error("Reject application error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to reject driver"
    });
  }
});

// Driver GPS update
app.post("/api/driver/update", async (req, res) => {
  try {
    const { driverId, lat, lng, name } = req.body;

    if (!driverId || lat == null || lng == null) {
      return res.status(400).json({
        success: false,
        message: "driverId, lat, and lng are required"
      });
    }

    const driver = await DriverLocation.findOneAndUpdate(
      { driverId },
      {
        driverId,
        name: name || "Driver",
        lat,
        lng
      },
      {
        new: true,
        upsert: true
      }
    );

    return res.json({
      success: true,
      message: "Driver location updated",
      driver
    });
  } catch (error) {
    console.error("Driver update error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update driver"
    });
  }
});

// Get approved/live drivers
app.get("/api/drivers", async (req, res) => {
  try {
    const drivers = await DriverLocation.find().sort({ updatedAt: -1 });

    return res.json({
      success: true,
      drivers
    });
  } catch (error) {
    console.error("Get drivers error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to load drivers"
    });
  }
});

// Request ride
app.post("/request-ride", async (req, res) => {
  try {
    const { lat, lng, riderName, phone, pickup, dropoff } = req.body;

    if (lat == null || lng == null) {
      return res.status(400).json({
        success: false,
        message: "lat and lng are required"
      });
    }

    const latestDriver = await DriverLocation.findOne().sort({ updatedAt: -1 });

    const newRide = await RideRequest.create({
      riderName: riderName || "",
      phone: phone || "",
      pickup: pickup || "",
      dropoff: dropoff || "",
      lat,
      lng,
      status: latestDriver ? "assigned" : "waiting",
      driver: latestDriver
        ? {
            driverId: latestDriver.driverId,
            name: latestDriver.name,
            lat: latestDriver.lat,
            lng: latestDriver.lng
          }
        : {
            driverId: null,
            name: null,
            lat: null,
            lng: null
          }
    });

    return res.json({
      success: true,
      ride: newRide
    });
  } catch (error) {
    console.error("Ride request error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to request ride"
    });
  }
});

// Get rides
app.get("/rides", async (req, res) => {
  try {
    const rides = await RideRequest.find().sort({ createdAt: -1 });
    return res.json(rides);
  } catch (error) {
    console.error("Get rides error:", error);
    return res.status(500).json([]);
  }
});

app.get("/api/rides", async (req, res) => {
  try {
    const rides = await RideRequest.find().sort({ createdAt: -1 });

    return res.json({
      success: true,
      rides
    });
  } catch (error) {
    console.error("Get API rides error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to load rides"
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

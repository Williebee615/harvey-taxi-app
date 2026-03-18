const express = require("express");
const cors = require("cors");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Temporary storage
let drivers = [];

// Home route
app.get("/", (req, res) => {
  res.send("Harvey Taxi API is running 🚖");
});

// Serve frontend files
app.use(express.static(__dirname));

// Driver signup route
app.post("/api/drivers/signup", (req, res) => {
  try {
    const {
      name,
      phone,
      email,
      city,
      state,
      vehicleType,
      driverType,
    } = req.body;

    if (!name || !phone || !email || !city || !state || !vehicleType || !driverType) {
      return res.status(400).json({
        success: false,
        message: "All fields are required.",
      });
    }

    const newDriver = {
      id: Date.now(),
      name: String(name).trim(),
      phone: String(phone).trim(),
      email: String(email).trim().toLowerCase(),
      city: String(city).trim(),
      state: String(state).trim(),
      vehicleType: String(vehicleType).trim(),
      driverType: String(driverType).trim(),
      status: "pending",
      createdAt: new Date().toISOString(),
    };

    drivers.push(newDriver);

    console.log("New driver application:", newDriver);

    return res.status(201).json({
      success: true,
      message: "Driver application submitted successfully.",
      driver: newDriver,
    });
  } catch (error) {
    console.error("Signup route error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error. Please try again.",
    });
  }
});

// Optional: see all drivers
app.get("/api/drivers", (req, res) => {
  res.json({
    success: true,
    count: drivers.length,
    drivers,
  });
});

// Direct route to signup page
app.get("/driver-signup", (req, res) => {
  res.sendFile(path.join(__dirname, "driver-signup.html"));
});

// 404 fallback
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "Route not found.",
  });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

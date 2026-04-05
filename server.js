const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

const dataDir = path.join(__dirname, "data");
const ridersFile = path.join(dataDir, "riders.json");
const driversFile = path.join(dataDir, "drivers.json");
const ridesFile = path.join(dataDir, "rides.json");
const paymentsFile = path.join(dataDir, "payments.json");

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

function ensureFile(filePath, defaultValue = []) {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify(defaultValue, null, 2));
  }
}

ensureFile(ridersFile, []);
ensureFile(driversFile, []);
ensureFile(ridesFile, []);
ensureFile(paymentsFile, []);

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    console.error(`Error reading ${filePath}:`, error.message);
    return [];
  }
}

function writeJson(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    return true;
  } catch (error) {
    console.error(`Error writing ${filePath}:`, error.message);
    return false;
  }
}

function makeId(prefix) {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
}

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizePhone(value) {
  return String(value || "").replace(/\D/g, "");
}

/* -----------------------------
   HEALTH CHECK
----------------------------- */
app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "Harvey Taxi server is running"
  });
});

/* -----------------------------
   RIDER SIGNUP
----------------------------- */
app.post("/api/rider-signup", (req, res) => {
  const fullName = normalizeText(req.body.fullName);
  const phone = normalizePhone(req.body.phone);
  const email = normalizeText(req.body.email).toLowerCase();
  const address = normalizeText(req.body.address);

  if (!fullName || !phone || !email || !address) {
    return res.status(400).json({
      success: false,
      message: "All rider fields are required."
    });
  }

  const riders = readJson(ridersFile);

  const existingRiderIndex = riders.findIndex(
    (r) => r.email === email || r.phone === phone
  );

  const riderRecord = {
    id: existingRiderIndex >= 0 ? riders[existingRiderIndex].id : makeId("rider"),
    fullName,
    phone,
    email,
    address,
    verificationStatus:
      existingRiderIndex >= 0
        ? riders[existingRiderIndex].verificationStatus || "pending"
        : "pending",
    rideAccessApproved:
      existingRiderIndex >= 0
        ? Boolean(riders[existingRiderIndex].rideAccessApproved)
        : false,
    createdAt:
      existingRiderIndex >= 0
        ? riders[existingRiderIndex].createdAt
        : new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  if (existingRiderIndex >= 0) {
    riders[existingRiderIndex] = {
      ...riders[existingRiderIndex],
      ...riderRecord
    };
  } else {
    riders.push(riderRecord);
  }

  const saved = writeJson(ridersFile, riders);

  if (!saved) {
    return res.status(500).json({
      success: false,
      message: "Unable to save rider account."
    });
  }

  return res.json({
    success: true,
    message: "Rider account created successfully. Verification review has started.",
    rider: riderRecord
  });
});

/* -----------------------------
   DRIVER SIGNUP
----------------------------- */
app.post("/api/driver-signup", (req, res) => {
  const fullName = normalizeText(req.body.fullName);
  const phone = normalizePhone(req.body.phone);
  const email = normalizeText(req.body.email).toLowerCase();
  const vehicleType = normalizeText(req.body.vehicleType);
  const licenseNumber = normalizeText(req.body.licenseNumber);
  const city = normalizeText(req.body.city);

  if (!fullName || !phone || !email || !vehicleType || !licenseNumber || !city) {
    return res.status(400).json({
      success: false,
      message: "All driver fields are required."
    });
  }

  const drivers = readJson(driversFile);

  const existingDriverIndex = drivers.findIndex(
    (d) => d.email === email || d.phone === phone || d.licenseNumber === licenseNumber
  );

  const driverRecord = {
    id: existingDriverIndex >= 0 ? drivers[existingDriverIndex].id : makeId("driver"),
    fullName,
    phone,
    email,
    vehicleType,
    licenseNumber,
    city,
    personaStatus:
      existingDriverIndex >= 0
        ? drivers[existingDriverIndex].personaStatus || "pending"
        : "pending",
    checkrStatus:
      existingDriverIndex >= 0
        ? drivers[existingDriverIndex].checkrStatus || "pending"
        : "pending",
    approvalStatus:
      existingDriverIndex >= 0
        ? drivers[existingDriverIndex].approvalStatus || "pending"
        : "pending",
    isOnline:
      existingDriverIndex >= 0
        ? Boolean(drivers[existingDriverIndex].isOnline)
        : false,
    createdAt:
      existingDriverIndex >= 0
        ? drivers[existingDriverIndex].createdAt
        : new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  if (existingDriverIndex >= 0) {
    drivers[existingDriverIndex] = {
      ...drivers[existingDriverIndex],
      ...driverRecord
    };
  } else {
    drivers.push(driverRecord);
  }

  const saved = writeJson(driversFile, drivers);

  if (!saved) {
    return res.status(500).json({
      success: false,
      message: "Unable to save driver application."
    });
  }

  return res.json({
    success: true,
    message: "Driver application submitted successfully. Verification review has started.",
    driver: driverRecord
  });
});

/* -----------------------------
   CHECK RIDER APPROVAL
   Used by request-ride.html
----------------------------- */
app.get("/api/check-rider", (req, res) => {
  const email = normalizeText(req.query.email).toLowerCase();
  const phone = normalizePhone(req.query.phone);

  const riders = readJson(ridersFile);

  let rider = null;

  if (email) {
    rider = riders.find((r) => r.email === email);
  }

  if (!rider && phone) {
    rider = riders.find((r) => r.phone === phone);
  }

  if (!rider) {
    return res.json({
      success: true,
      approved: false,
      message: "No rider account found."
    });
  }

  const approved =
    rider.verificationStatus === "approved" || rider.rideAccessApproved === true;

  return res.json({
    success: true,
    approved,
    message: approved
      ? "Rider is approved for ride requests."
      : "Rider is not approved yet.",
    rider: {
      id: rider.id,
      fullName: rider.fullName,
      email: rider.email,
      phone: rider.phone,
      verificationStatus: rider.verificationStatus,
      rideAccessApproved: Boolean(rider.rideAccessApproved)
    }
  });
});

/* -----------------------------
   REQUEST RIDE
   HARD GATE: approved riders only
----------------------------- */
app.post("/api/request-ride", (req, res) => {
  const riderName = normalizeText(req.body.name || req.body.riderName);
  const riderPhone = normalizePhone(req.body.phone || req.body.riderPhone);
  const pickupAddress = normalizeText(req.body.pickup || req.body.pickupAddress);
  const dropoffAddress = normalizeText(req.body.dropoff || req.body.dropoffAddress);
  const rideNotes = normalizeText(req.body.rideNotes);

  if (!riderName || !riderPhone || !pickupAddress || !dropoffAddress) {
    return res.status(400).json({
      success: false,
      message: "Name, phone, pickup address, and dropoff address are required."
    });
  }

  const riders = readJson(ridersFile);
  const rider = riders.find((r) => r.phone === riderPhone);

  if (!rider) {
    return res.status(403).json({
      success: false,
      message: "No rider account found. Please complete rider signup first."
    });
  }

  const approved =
    rider.verificationStatus === "approved" || rider.rideAccessApproved === true;

  if (!approved) {
    return res.status(403).json({
      success: false,
      message: "Ride requests are locked until rider verification is approved."
    });
  }

  const rides = readJson(ridesFile);

  const rideRecord = {
    id: makeId("ride"),
    riderId: rider.id,
    riderName,
    riderPhone,
    pickupAddress,
    dropoffAddress,
    rideNotes,
    status: "pending_dispatch",
    assignedDriverId: null,
    assignedDriverName: null,
    fareEstimate: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  rides.push(rideRecord);

  const saved = writeJson(ridesFile, rides);

  if (!saved) {
    return res.status(500).json({
      success: false,
      message: "Unable to create ride request."
    });
  }

  return res.json({
    success: true,
    message: "Ride request submitted successfully. Dispatch review has started.",
    ride: rideRecord
  });
});

/* -----------------------------
   PAYMENT
----------------------------- */
app.post("/api/payment", (req, res) => {
  const riderName = normalizeText(req.body.riderName);
  const amount = Number(req.body.amount);
  const paymentMethod = normalizeText(req.body.paymentMethod);
  const cardLast4 = normalizeText(req.body.cardLast4);
  const rideId = normalizeText(req.body.rideId);

  if (!riderName || !amount || amount <= 0 || !paymentMethod || !rideId) {
    return res.status(400).json({
      success: false,
      message: "Rider name, amount, payment method, and ride reference are required."
    });
  }

  const payments = readJson(paymentsFile);

  const paymentRecord = {
    id: makeId("payment"),
    riderName,
    amount: Number(amount.toFixed(2)),
    paymentMethod,
    cardLast4,
    rideId,
    status: "paid",
    createdAt: new Date().toISOString()
  };

  payments.push(paymentRecord);

  const saved = writeJson(paymentsFile, payments);

  if (!saved) {
    return res.status(500).json({
      success: false,
      message: "Unable to save payment."
    });
  }

  return res.json({
    success: true,
    message: "Payment submitted successfully.",
    payment: paymentRecord
  });
});

/* -----------------------------
   ADMIN LOGIN
----------------------------- */
app.post("/api/admin-login", (req, res) => {
  const email = normalizeText(req.body.email).toLowerCase();
  const password = normalizeText(req.body.password);

  const adminEmail = (process.env.ADMIN_EMAIL || "admin@harveytaxi.com").toLowerCase();
  const adminPassword = process.env.ADMIN_PASSWORD || "Harvey123!";

  if (!email || !password) {
    return res.status(400).json({
      success: false,
      message: "Admin email and password are required."
    });
  }

  if (email === adminEmail && password === adminPassword) {
    return res.json({
      success: true,
      message: "Admin login successful.",
      redirectUrl: "/admin-dashboard.html"
    });
  }

  return res.status(401).json({
    success: false,
    message: "Invalid admin credentials."
  });
});

/* -----------------------------
   SIMPLE ADMIN DATA ROUTES
----------------------------- */
app.get("/api/admin/riders", (req, res) => {
  const riders = readJson(ridersFile);
  res.json({ success: true, riders });
});

app.get("/api/admin/drivers", (req, res) => {
  const drivers = readJson(driversFile);
  res.json({ success: true, drivers });
});

app.get("/api/admin/rides", (req, res) => {
  const rides = readJson(ridesFile);
  res.json({ success: true, rides });
});

app.get("/api/admin/payments", (req, res) => {
  const payments = readJson(paymentsFile);
  res.json({ success: true, payments });
});

/* -----------------------------
   ADMIN: APPROVE RIDER
   lets you unlock ride requests
----------------------------- */
app.post("/api/admin/approve-rider", (req, res) => {
  const riderId = normalizeText(req.body.riderId);
  const email = normalizeText(req.body.email).toLowerCase();
  const phone = normalizePhone(req.body.phone);

  const riders = readJson(ridersFile);

  const riderIndex = riders.findIndex(
    (r) => r.id === riderId || r.email === email || r.phone === phone
  );

  if (riderIndex === -1) {
    return res.status(404).json({
      success: false,
      message: "Rider not found."
    });
  }

  riders[riderIndex].verificationStatus = "approved";
  riders[riderIndex].rideAccessApproved = true;
  riders[riderIndex].updatedAt = new Date().toISOString();

  const saved = writeJson(ridersFile, riders);

  if (!saved) {
    return res.status(500).json({
      success: false,
      message: "Unable to approve rider."
    });
  }

  return res.json({
    success: true,
    message: "Rider approved successfully.",
    rider: riders[riderIndex]
  });
});

/* -----------------------------
   ADMIN: APPROVE DRIVER
----------------------------- */
app.post("/api/admin/approve-driver", (req, res) => {
  const driverId = normalizeText(req.body.driverId);
  const email = normalizeText(req.body.email).toLowerCase();
  const phone = normalizePhone(req.body.phone);

  const drivers = readJson(driversFile);

  const driverIndex = drivers.findIndex(
    (d) => d.id === driverId || d.email === email || d.phone === phone
  );

  if (driverIndex === -1) {
    return res.status(404).json({
      success: false,
      message: "Driver not found."
    });
  }

  drivers[driverIndex].personaStatus = "approved";
  drivers[driverIndex].checkrStatus = "approved";
  drivers[driverIndex].approvalStatus = "approved";
  drivers[driverIndex].updatedAt = new Date().toISOString();

  const saved = writeJson(driversFile, drivers);

  if (!saved) {
    return res.status(500).json({
      success: false,
      message: "Unable to approve driver."
    });
  }

  return res.json({
    success: true,
    message: "Driver approved successfully.",
    driver: drivers[driverIndex]
  });
});

/* -----------------------------
   FALLBACK ROUTE
----------------------------- */
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`Harvey Taxi server running on port ${PORT}`);
});

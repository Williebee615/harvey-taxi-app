const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const fsp = require("fs/promises");

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

/* =========================================================
   FILE PATHS
========================================================= */
const DATA_FILES = {
  riders: path.join(__dirname, "riders.json"),
  drivers: path.join(__dirname, "drivers.json"),
  rides: path.join(__dirname, "rides.json"),
  payments: path.join(__dirname, "payments.json"),
  dispatches: path.join(__dirname, "dispatches.json"),
  missions: path.join(__dirname, "missions.json"),
  gpsLocations: path.join(__dirname, "gps-locations.json"),
  messages: path.join(__dirname, "messages.json"),
  vehicles: path.join(__dirname, "vehicles.json"),
  adminLogs: path.join(__dirname, "admin-logs.json"),
  settings: path.join(__dirname, "settings.json")
};

const DISPATCH_OFFER_TIMEOUT_MS = 20000;
const MAX_DISPATCH_ATTEMPTS = 10;

/* =========================================================
   DEFAULT FILE CONTENT
========================================================= */
const DEFAULT_DATA = {
  riders: [],
  drivers: [],
  rides: [],
  payments: [],
  dispatches: [],
  missions: [],
  gpsLocations: [],
  messages: [],
  vehicles: [],
  adminLogs: [],
  settings: {
    fare: {
      baseFare: 4.5,
      perMile: 1.95,
      perMinute: 0.35,
      bookingFee: 2.5,
      minimumFare: 9.5,
      surgeMultiplier: 1
    },
    platform: {
      riderVerificationRequired: true,
      paymentAuthorizationRequired: true,
      driverMustBeApproved: true
    }
  }
};

/* =========================================================
   HELPERS
========================================================= */
function generateId(prefix) {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
}

function nowIso() {
  return new Date().toISOString();
}

function round2(num) {
  return Math.round(Number(num || 0) * 100) / 100;
}

function safeString(value) {
  return String(value || "").trim();
}

function normalizeEmail(email) {
  return safeString(email).toLowerCase();
}

function estimateDistanceMiles(pickupAddress, dropoffAddress) {
  const a = safeString(pickupAddress).length;
  const b = safeString(dropoffAddress).length;
  const pseudoDistance = ((a + b) % 18) + 4;
  return round2(pseudoDistance);
}

function estimateDurationMinutes(distanceMiles, rideType = "standard") {
  const multiplier = rideType === "premium" ? 1.18 : rideType === "xl" ? 1.28 : 1;
  return Math.max(8, Math.round(Number(distanceMiles || 0) * 3.6 * multiplier));
}

function getRideTypeMultiplier(rideType = "standard") {
  if (rideType === "premium") return 1.45;
  if (rideType === "xl") return 1.65;
  return 1;
}

function estimateFare(
  {
    pickupAddress,
    dropoffAddress,
    rideType = "standard",
    surgeMultiplier = 1
  },
  fareSettings
) {
  const distanceMiles = estimateDistanceMiles(pickupAddress, dropoffAddress);
  const durationMinutes = estimateDurationMinutes(distanceMiles, rideType);

  const subtotal =
    Number(fareSettings.baseFare || 0) +
    distanceMiles * Number(fareSettings.perMile || 0) +
    durationMinutes * Number(fareSettings.perMinute || 0);

  const adjusted = subtotal * getRideTypeMultiplier(rideType) * Number(surgeMultiplier || 1);
  const total = Math.max(adjusted + Number(fareSettings.bookingFee || 0), Number(fareSettings.minimumFare || 0));

  return {
    distanceMiles: round2(distanceMiles),
    durationMinutes,
    surgeMultiplier: round2(surgeMultiplier),
    estimatedFare: round2(total)
  };
}

function sanitizeAddressOnlyLocation(address) {
  return {
    address: safeString(address),
    latitude: null,
    longitude: null
  };
}async function ensureFile(filePath, fallbackData) {
  try {
    await fsp.access(filePath, fs.constants.F_OK);
  } catch {
    await fsp.writeFile(filePath, JSON.stringify(fallbackData, null, 2));
  }
}

async function initializeDataFiles() {
  await Promise.all(
    Object.entries(DATA_FILES).map(([key, filePath]) =>
      ensureFile(filePath, DEFAULT_DATA[key])
    )
  );
}

async function readJson(filePath, fallback = []) {
  try {
    const raw = await fsp.readFile(filePath, "utf8");
    if (!raw.trim()) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function writeJson(filePath, data) {
  await fsp.writeFile(filePath, JSON.stringify(data, null, 2));
}

async function appendJson(filePath, item, fallback = []) {
  const data = await readJson(filePath, fallback);
  data.push(item);
  await writeJson(filePath, data);
  return item;
}

async function getAllData() {
  const [
    riders,
    drivers,
    rides,
    payments,
    dispatches,
    missions,
    gpsLocations,
    messages,
    vehicles,
    adminLogs,
    settings
  ] = await Promise.all([
    readJson(DATA_FILES.riders, []),
    readJson(DATA_FILES.drivers, []),
    readJson(DATA_FILES.rides, []),
    readJson(DATA_FILES.payments, []),
    readJson(DATA_FILES.dispatches, []),
    readJson(DATA_FILES.missions, []),
    readJson(DATA_FILES.gpsLocations, []),
    readJson(DATA_FILES.messages, []),
    readJson(DATA_FILES.vehicles, []),
    readJson(DATA_FILES.adminLogs, []),
    readJson(DATA_FILES.settings, DEFAULT_DATA.settings)
  ]);

  return {
    riders,
    drivers,
    rides,
    payments,
    dispatches,
    missions,
    gpsLocations,
    messages,
    vehicles,
    adminLogs,
    settings
  };
}

async function logAdmin(action, payload = {}) {
  const entry = {
    id: generateId("log"),
    action,
    payload,
    createdAt: nowIso()
  };
  await appendJson(DATA_FILES.adminLogs, entry, []);
  return entry;
}

function findLatestPaymentAuthorization(payments, riderId) {
  return [...payments]
    .filter(
      (p) =>
        p.riderId === riderId &&
        p.type === "ride_authorization" &&
        p.status === "authorized"
    )
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
}

function chooseBestDriver(drivers, pickupAddress, excludedDriverIds = []) {
  const excluded = new Set(excludedDriverIds);

  const availableDrivers = drivers.filter(
    (d) =>
      d.status === "approved" &&
      d.availability === "online" &&
      !d.currentRideId &&
      !excluded.has(d.id)
  );

  if (!availableDrivers.length) return null;

  const ranked = availableDrivers
    .map((driver) => ({
      ...driver,
      dispatchScore:
        Math.abs(safeString(driver.currentZone).length - safeString(pickupAddress).length) +
        Math.floor(Math.random() * 10)
    }))
    .sort((a, b) => a.dispatchScore - b.dispatchScore);

  return ranked[0];
}async function updateRecordById(filePath, id, updater, fallback = []) {
  const items = await readJson(filePath, fallback);
  const index = items.findIndex((item) => item.id === id);

  if (index === -1) return null;

  const current = items[index];
  const updated = updater(current);
  items[index] = updated;
  await writeJson(filePath, items);
  return updated;
}

async function getRecordById(filePath, id, fallback = []) {
  const items = await readJson(filePath, fallback);
  return items.find((item) => item.id === id) || null;
}

function requireFields(fields, body) {
  const missing = fields.filter((field) => !safeString(body[field]));
  return missing;
}

async function createDispatchAndMissionForRide(ride, excludedDriverIds = []) {
  const drivers = await readJson(DATA_FILES.drivers, []);
  const chosenDriver = chooseBestDriver(drivers, ride.pickup.address, excludedDriverIds);

  if (!chosenDriver) {
    await updateRecordById(
      DATA_FILES.rides,
      ride.id,
      (current) => ({
        ...current,
        driverId: null,
        dispatchId: null,
        missionId: null,
        status: "searching_driver",
        updatedAt: nowIso()
      }),
      []
    );

    await logAdmin("ride_waiting_for_driver", { rideId: ride.id });
    return { ride: await getRecordById(DATA_FILES.rides, ride.id, []), dispatch: null, mission: null };
  }

  const dispatch = {
    id: generateId("dispatch"),
    rideId: ride.id,
    riderId: ride.riderId,
    driverId: chosenDriver.id,
    offerStatus: "offered",
    attempts: 1,
    maxAttempts: MAX_DISPATCH_ATTEMPTS,
    offerTimeoutMs: DISPATCH_OFFER_TIMEOUT_MS,
    createdAt: nowIso(),
    updatedAt: nowIso()
  };

  const mission = {
    id: generateId("mission"),
    rideId: ride.id,
    dispatchId: dispatch.id,
    driverId: chosenDriver.id,
    riderId: ride.riderId,
    status: "offered",
    missionPreview: {
      pickupAddress: ride.pickup.address,
      dropoffAddress: ride.dropoff.address,
      rideType: ride.rideType,
      estimatedFare: ride.estimatedFare,
      estimatedDistanceMiles: ride.estimatedDistanceMiles,
      estimatedDurationMinutes: ride.estimatedDurationMinutes,
      passengerCount: ride.passengerCount,
      specialInstructions: ride.specialInstructions
    },
    createdAt: nowIso(),
    updatedAt: nowIso()
  };

  await appendJson(DATA_FILES.dispatches, dispatch, []);
  await appendJson(DATA_FILES.missions, mission, []);

  const updatedRide = await updateRecordById(
    DATA_FILES.rides,
    ride.id,
    (current) => ({
      ...current,
      driverId: chosenDriver.id,
      dispatchId: dispatch.id,
      missionId: mission.id,
      status: "driver_offered",
      updatedAt: nowIso()
    }),
    []
  );

  await logAdmin("ride_dispatched", {
    rideId: ride.id,
    dispatchId: dispatch.id,
    missionId: mission.id,
    driverId: chosenDriver.id
  });

  return {
    ride: updatedRide,
    dispatch,
    mission
  };
}/* =========================================================
   HEALTH / BASIC ROUTES
========================================================= */
app.get("/health", async (req, res) => {
  try {
    const data = await getAllData();
    res.json({
      ok: true,
      service: "Harvey Taxi Unified Server",
      timestamp: nowIso(),
      totals: {
        riders: data.riders.length,
        drivers: data.drivers.length,
        rides: data.rides.length,
        payments: data.payments.length
      }
    });
  } catch {
    res.status(500).json({ ok: false, error: "Health check failed." });
  }
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin-dashboard.html"));
});

/* =========================================================
   RIDERS
========================================================= */
app.post("/api/rider/signup", async (req, res) => {
  try {
    const missing = requireFields(
      ["fullName", "email", "phone", "password"],
      req.body
    );

    if (missing.length) {
      return res.status(400).json({
        ok: false,
        error: `Missing required fields: ${missing.join(", ")}`
      });
    }

    const riders = await readJson(DATA_FILES.riders, []);
    const email = normalizeEmail(req.body.email);

    const existing = riders.find((r) => normalizeEmail(r.email) === email);
    if (existing) {
      return res.status(409).json({
        ok: false,
        error: "A rider with that email already exists."
      });
    }

    const rider = {
      id: generateId("rider"),
      fullName: safeString(req.body.fullName),
      email,
      phone: safeString(req.body.phone),
      password: safeString(req.body.password),
      verificationMethod: safeString(req.body.verificationMethod) || "state_id",
      verificationStatus: "pending",
      riderApproved: false,
      status: "pending",
      createdAt: nowIso(),
      updatedAt: nowIso()
    };

    await appendJson(DATA_FILES.riders, rider, []);
    await logAdmin("rider_signup_created", { riderId: rider.id, email: rider.email });

    res.status(201).json({
      ok: true,
      message: "Rider signup created. Verification approval is required before ride requests.",
      rider
    });
  } catch {
    res.status(500).json({ ok: false, error: "Failed to create rider." });
  }
});

app.post("/api/rider/login", async (req, res) => {
  try {
    const riders = await readJson(DATA_FILES.riders, []);
    const email = normalizeEmail(req.body.email);
    const password = safeString(req.body.password);

    const rider = riders.find(
      (r) => normalizeEmail(r.email) === email && r.password === password
    );

    if (!rider) {
      return res.status(401).json({
        ok: false,
        error: "Invalid rider email or password."
      });
    }

    res.json({
      ok: true,
      message: "Rider login successful.",
      rider
    });
  } catch {
    res.status(500).json({ ok: false, error: "Rider login failed." });
  }
});

app.get("/api/riders", async (req, res) => {
  try {
    const riders = await readJson(DATA_FILES.riders, []);
    res.json({ ok: true, riders });
  } catch {
    res.status(500).json({ ok: false, error: "Failed to load riders." });
  }
});/* =========================================================
   DRIVERS
========================================================= */
app.post("/api/driver/signup", async (req, res) => {
  try {
    const missing = requireFields(
      ["fullName", "email", "phone", "password", "driversLicenseNumber", "vehicleType"],
      req.body
    );

    if (missing.length) {
      return res.status(400).json({
        ok: false,
        error: `Missing required fields: ${missing.join(", ")}`
      });
    }

    const drivers = await readJson(DATA_FILES.drivers, []);
    const email = normalizeEmail(req.body.email);

    const existing = drivers.find((d) => normalizeEmail(d.email) === email);
    if (existing) {
      return res.status(409).json({
        ok: false,
        error: "A driver with that email already exists."
      });
    }

    const driver = {
      id: generateId("driver"),
      fullName: safeString(req.body.fullName),
      email,
      phone: safeString(req.body.phone),
      password: safeString(req.body.password),
      driversLicenseNumber: safeString(req.body.driversLicenseNumber),
      vehicleType: safeString(req.body.vehicleType),
      vehicleMake: safeString(req.body.vehicleMake),
      vehicleModel: safeString(req.body.vehicleModel),
      vehicleColor: safeString(req.body.vehicleColor),
      plateNumber: safeString(req.body.plateNumber),
      personaStatus: "pending",
      checkrStatus: "pending",
      verificationStatus: "pending",
      status: "pending",
      availability: "offline",
      currentRideId: null,
      currentZone: safeString(req.body.currentZone) || "Nashville",
      walletBalance: 0,
      createdAt: nowIso(),
      updatedAt: nowIso()
    };

    await appendJson(DATA_FILES.drivers, driver, []);
    await logAdmin("driver_signup_created", { driverId: driver.id, email: driver.email });

    res.status(201).json({
      ok: true,
      message: "Driver signup created. Driver license verification and background approval required.",
      driver
    });
  } catch {
    res.status(500).json({ ok: false, error: "Failed to create driver." });
  }
});

app.post("/api/driver/login", async (req, res) => {
  try {
    const drivers = await readJson(DATA_FILES.drivers, []);
    const email = normalizeEmail(req.body.email);
    const password = safeString(req.body.password);

    const driver = drivers.find(
      (d) => normalizeEmail(d.email) === email && d.password === password
    );

    if (!driver) {
      return res.status(401).json({
        ok: false,
        error: "Invalid driver email or password."
      });
    }

    res.json({
      ok: true,
      message: "Driver login successful.",
      driver
    });
  } catch {
    res.status(500).json({ ok: false, error: "Driver login failed." });
  }
});

app.get("/api/drivers", async (req, res) => {
  try {
    const drivers = await readJson(DATA_FILES.drivers, []);
    res.json({ ok: true, drivers });
  } catch {
    res.status(500).json({ ok: false, error: "Failed to load drivers." });
  }
});

app.patch("/api/driver/:driverId/availability", async (req, res) => {
  try {
    const driverId = req.params.driverId;
    const nextAvailability = safeString(req.body.availability).toLowerCase();

    if (!["online", "offline"].includes(nextAvailability)) {
      return res.status(400).json({
        ok: false,
        error: "Availability must be online or offline."
      });
    }

    const updated = await updateRecordById(
      DATA_FILES.drivers,
      driverId,
      (driver) => ({
        ...driver,
        availability: nextAvailability,
        updatedAt: nowIso()
      }),
      []
    );

    if (!updated) {
      return res.status(404).json({ ok: false, error: "Driver not found." });
    }

    await logAdmin("driver_availability_changed", {
      driverId,
      availability: nextAvailability
    });

    res.json({
      ok: true,
      message: "Driver availability updated.",
      driver: updated
    });
  } catch {
    res.status(500).json({ ok: false, error: "Failed to update driver availability." });
  }
});/* =========================================================
   PAYMENT AUTHORIZATION + FARE ESTIMATE
========================================================= */
app.post("/api/payments/authorize", async (req, res) => {
  try {
    const missing = requireFields(["riderId", "paymentMethod"], req.body);
    if (missing.length) {
      return res.status(400).json({
        ok: false,
        error: `Missing required fields: ${missing.join(", ")}`
      });
    }

    const riders = await readJson(DATA_FILES.riders, []);
    const rider = riders.find((r) => r.id === safeString(req.body.riderId));

    if (!rider) {
      return res.status(404).json({ ok: false, error: "Rider not found." });
    }

    const authorization = {
      id: generateId("payauth"),
      riderId: rider.id,
      type: "ride_authorization",
      paymentMethod: safeString(req.body.paymentMethod),
      status: "authorized",
      amount: round2(req.body.amount || 25),
      createdAt: nowIso()
    };

    await appendJson(DATA_FILES.payments, authorization, []);
    await logAdmin("payment_authorized", {
      riderId: rider.id,
      authorizationId: authorization.id
    });

    res.status(201).json({
      ok: true,
      message: "Payment authorized successfully.",
      authorization
    });
  } catch {
    res.status(500).json({ ok: false, error: "Failed to authorize payment." });
  }
});

app.get("/api/payments", async (req, res) => {
  try {
    const payments = await readJson(DATA_FILES.payments, []);
    res.json({ ok: true, payments });
  } catch {
    res.status(500).json({ ok: false, error: "Failed to load payments." });
  }
});

app.post("/api/fare-estimate", async (req, res) => {
  try {
    const missing = requireFields(["pickupAddress", "dropoffAddress"], req.body);
    if (missing.length) {
      return res.status(400).json({
        ok: false,
        error: `Missing required fields: ${missing.join(", ")}`
      });
    }

    const settings = await readJson(DATA_FILES.settings, DEFAULT_DATA.settings);
    const fare = estimateFare(
      {
        pickupAddress: req.body.pickupAddress,
        dropoffAddress: req.body.dropoffAddress,
        rideType: req.body.rideType || "standard",
        surgeMultiplier: Number(req.body.surgeMultiplier || settings.fare.surgeMultiplier || 1)
      },
      settings.fare
    );

    res.json({
      ok: true,
      pickup: sanitizeAddressOnlyLocation(req.body.pickupAddress),
      dropoff: sanitizeAddressOnlyLocation(req.body.dropoffAddress),
      fare
    });
  } catch {
    res.status(500).json({ ok: false, error: "Failed to estimate fare." });
  }
});

/* =========================================================
   REQUEST RIDE
========================================================= */
app.post("/api/request-ride", async (req, res) => {
  try {
    const missing = requireFields(["riderId", "pickupAddress", "dropoffAddress"], req.body);

    if (missing.length) {
      return res.status(400).json({
        ok: false,
        error: `Missing required fields: ${missing.join(", ")}`
      });
    }

    const { riders, payments, settings } = await getAllData();

    const rider = riders.find((r) => r.id === safeString(req.body.riderId));
    if (!rider) {
      return res.status(404).json({ ok: false, error: "Rider not found." });
    }

    if (settings.platform.riderVerificationRequired && !rider.riderApproved) {
      return res.status(403).json({
        ok: false,
        error: "Ride request blocked. Rider verification approval is required first."
      });
    }

    const latestAuthorization = findLatestPaymentAuthorization(payments, rider.id);
    if (settings.platform.paymentAuthorizationRequired && !latestAuthorization) {
      return res.status(402).json({
        ok: false,
        error: "Ride request blocked. Payment authorization required before requesting a ride."
      });
    }

    const rideType = safeString(req.body.rideType) || "standard";
    const fare = estimateFare(
      {
        pickupAddress: req.body.pickupAddress,
        dropoffAddress: req.body.dropoffAddress,
        rideType,
        surgeMultiplier: 1
      },
      settings.fare
    );

    const ride = {
      id: generateId("ride"),
      riderId: rider.id,
      driverId: null,
      dispatchId: null,
      missionId: null,
      status: "searching_driver",
      rideType,
      pickup: sanitizeAddressOnlyLocation(req.body.pickupAddress),
      dropoff: sanitizeAddressOnlyLocation(req.body.dropoffAddress),
      estimatedFare: fare.estimatedFare,
      estimatedDistanceMiles: fare.distanceMiles,
      estimatedDurationMinutes: fare.durationMinutes,
      paymentAuthorizationId: latestAuthorization ? latestAuthorization.id : null,
      passengerCount: Number(req.body.passengerCount || 1),
      specialInstructions: safeString(req.body.specialInstructions),
      createdAt: nowIso(),
      updatedAt: nowIso()
    };

    await appendJson(DATA_FILES.rides, ride, []);
    const result = await createDispatchAndMissionForRide(ride);

    res.status(201).json({
      ok: true,
      message: result.driver ? "Ride created and dispatched." : "Ride created.",
      ride: result.ride,
      dispatch: result.dispatch,
      mission: result.mission
    });
  } catch {
    res.status(500).json({ ok: false, error: "Failed to request ride." });
  }
});app.get("/api/rides", async (req, res) => {
  try {
    const rides = await readJson(DATA_FILES.rides, []);
    res.json({ ok: true, rides });
  } catch {
    res.status(500).json({ ok: false, error: "Failed to load rides." });
  }
});

app.get("/api/rides/:rideId", async (req, res) => {
  try {
    const ride = await getRecordById(DATA_FILES.rides, req.params.rideId, []);
    if (!ride) {
      return res.status(404).json({ ok: false, error: "Ride not found." });
    }
    res.json({ ok: true, ride });
  } catch {
    res.status(500).json({ ok: false, error: "Failed to load ride." });
  }
});

/* =========================================================
   DRIVER MISSIONS
========================================================= */
app.get("/api/driver/:driverId/missions", async (req, res) => {
  try {
    const missions = await readJson(DATA_FILES.missions, []);
    const driverMissions = missions.filter((m) => m.driverId === req.params.driverId);
    res.json({ ok: true, missions: driverMissions });
  } catch {
    res.status(500).json({ ok: false, error: "Failed to load driver missions." });
  }
});

app.post("/api/missions/:missionId/accept", async (req, res) => {
  try {
    const missionId = req.params.missionId;
    const mission = await getRecordById(DATA_FILES.missions, missionId, []);
    if (!mission) {
      return res.status(404).json({ ok: false, error: "Mission not found." });
    }

    const driver = await getRecordById(DATA_FILES.drivers, mission.driverId, []);
    if (!driver) {
      return res.status(404).json({ ok: false, error: "Driver not found." });
    }

    if (driver.status !== "approved") {
      return res.status(403).json({
        ok: false,
        error: "Only approved drivers can accept missions."
      });
    }

    const updatedMission = await updateRecordById(
      DATA_FILES.missions,
      missionId,
      (current) => ({
        ...current,
        status: "accepted",
        acceptedAt: nowIso(),
        updatedAt: nowIso()
      }),
      []
    );

    if (mission.dispatchId) {
      await updateRecordById(
        DATA_FILES.dispatches,
        mission.dispatchId,
        (current) => ({
          ...current,
          offerStatus: "accepted",
          acceptedAt: nowIso(),
          updatedAt: nowIso()
        }),
        []
      );
    }

    await updateRecordById(
      DATA_FILES.rides,
      mission.rideId,
      (ride) => ({
        ...ride,
        status: "driver_assigned",
        updatedAt: nowIso()
      }),
      []
    );

    await updateRecordById(
      DATA_FILES.drivers,
      mission.driverId,
      (d) => ({
        ...d,
        currentRideId: mission.rideId,
        availability: "online",
        updatedAt: nowIso()
      }),
      []
    );

    await logAdmin("mission_accepted", {
      missionId,
      rideId: mission.rideId,
      driverId: mission.driverId
    });

    res.json({
      ok: true,
      message: "Mission accepted.",
      mission: updatedMission
    });
  } catch {
    res.status(500).json({ ok: false, error: "Failed to accept mission." });
  }
});

app.post("/api/missions/:missionId/decline", async (req, res) => {
  try {
    const missionId = req.params.missionId;
    const mission = await getRecordById(DATA_FILES.missions, missionId, []);
    if (!mission) {
      return res.status(404).json({ ok: false, error: "Mission not found." });
    }

    const ride = await getRecordById(DATA_FILES.rides, mission.rideId, []);
    if (!ride) {
      return res.status(404).json({ ok: false, error: "Ride not found." });
    }

    const updatedMission = await updateRecordById(
      DATA_FILES.missions,
      missionId,
      (current) => ({
        ...current,
        status: "declined",
        declinedAt: nowIso(),
        updatedAt: nowIso()
      }),
      []
    );

    if (mission.dispatchId) {
      await updateRecordById(
        DATA_FILES.dispatches,
        mission.dispatchId,
        (current) => ({
          ...current,
          offerStatus: "declined",
          declinedAt: nowIso(),
          updatedAt: nowIso()
        }),
        []
      );
    }

    const currentMissions = await readJson(DATA_FILES.missions, []);
    const excludedDriverIds = currentMissions
      .filter((m) => m.rideId === ride.id && ["declined", "accepted"].includes(m.status))
      .map((m) => m.driverId);

    const refreshedRide = await updateRecordById(
      DATA_FILES.rides,
      ride.id,
      (current) => ({
        ...current,
        status: "searching_driver",
        driverId: null,
        dispatchId: null,
        missionId: null,
        updatedAt: nowIso()
      }),
      []
    );

    const redispatch = await createDispatchAndMissionForRide(refreshedRide, excludedDriverIds);

    await logAdmin("mission_declined", {
      missionId,
      rideId: mission.rideId,
      driverId: mission.driverId
    });

    res.json({
      ok: true,
      message: redispatch.mission
        ? "Mission declined. Ride was offered to another driver."
        : "Mission declined. Ride is waiting for another available driver.",
      mission: updatedMission,
      ride: redispatch.ride,
      newDispatch: redispatch.dispatch,
      newMission: redispatch.mission
    });
  } catch {
    res.status(500).json({ ok: false, error: "Failed to decline mission." });
  }
});/* =========================================================
   RIDE LIFECYCLE
========================================================= */
app.post("/api/rides/:rideId/arrive", async (req, res) => {
  try {
    const updated = await updateRecordById(
      DATA_FILES.rides,
      req.params.rideId,
      (ride) => ({
        ...ride,
        status: "driver_arrived",
        driverArrivedAt: nowIso(),
        updatedAt: nowIso()
      }),
      []
    );

    if (!updated) {
      return res.status(404).json({ ok: false, error: "Ride not found." });
    }

    await logAdmin("ride_driver_arrived", { rideId: updated.id, driverId: updated.driverId });
    res.json({ ok: true, message: "Driver marked as arrived.", ride: updated });
  } catch {
    res.status(500).json({ ok: false, error: "Failed to update arrival status." });
  }
});

app.post("/api/rides/:rideId/start", async (req, res) => {
  try {
    const updated = await updateRecordById(
      DATA_FILES.rides,
      req.params.rideId,
      (ride) => ({
        ...ride,
        status: "in_progress",
        startedAt: nowIso(),
        updatedAt: nowIso()
      }),
      []
    );

    if (!updated) {
      return res.status(404).json({ ok: false, error: "Ride not found." });
    }

    await logAdmin("ride_started", { rideId: updated.id, driverId: updated.driverId });
    res.json({ ok: true, message: "Ride started.", ride: updated });
  } catch {
    res.status(500).json({ ok: false, error: "Failed to start ride." });
  }
});

app.post("/api/rides/:rideId/complete", async (req, res) => {
  try {
    const ride = await getRecordById(DATA_FILES.rides, req.params.rideId, []);
    if (!ride) {
      return res.status(404).json({ ok: false, error: "Ride not found." });
    }

    const settings = await readJson(DATA_FILES.settings, DEFAULT_DATA.settings);

    const finalFare = estimateFare(
      {
        pickupAddress: ride.pickup.address,
        dropoffAddress: ride.dropoff.address,
        rideType: ride.rideType,
        surgeMultiplier: 1
      },
      settings.fare
    );

    const tipAmount = round2(req.body.tipAmount || 0);
    const totalCharged = round2(finalFare.estimatedFare + tipAmount);
    const driverPayout = round2(totalCharged * 0.78);

    const updatedRide = await updateRecordById(
      DATA_FILES.rides,
      req.params.rideId,
      (current) => ({
        ...current,
        status: "completed",
        completedAt: nowIso(),
        fareCharged: finalFare.estimatedFare,
        tipAmount,
        totalCharged,
        driverPayout,
        updatedAt: nowIso()
      }),
      []
    );

    const charge = {
      id: generateId("payment"),
      riderId: updatedRide.riderId,
      driverId: updatedRide.driverId,
      rideId: updatedRide.id,
      type: "ride_charge",
      status: "captured",
      amount: totalCharged,
      fareAmount: finalFare.estimatedFare,
      tipAmount,
      createdAt: nowIso()
    };

    await appendJson(DATA_FILES.payments, charge, []);

    if (updatedRide.driverId) {
      await updateRecordById(
        DATA_FILES.drivers,
        updatedRide.driverId,
        (driver) => ({
          ...driver,
          walletBalance: round2((driver.walletBalance || 0) + driverPayout),
          currentRideId: null,
          availability: "online",
          updatedAt: nowIso()
        }),
        []
      );
    }

    await logAdmin("ride_completed", {
      rideId: updatedRide.id,
      totalCharged,
      driverPayout
    });

    res.json({
      ok: true,
      message: "Ride completed successfully.",
      ride: updatedRide,
      charge
    });
  } catch {
    res.status(500).json({ ok: false, error: "Failed to complete ride." });
  }
});

app.post("/api/rides/:rideId/cancel", async (req, res) => {
  try {
    const updatedRide = await updateRecordById(
      DATA_FILES.rides,
      req.params.rideId,
      (ride) => ({
        ...ride,
        status: "cancelled",
        cancelReason: safeString(req.body.reason) || "Cancelled",
        cancelledAt: nowIso(),
        updatedAt: nowIso()
      }),
      []
    );

    if (!updatedRide) {
      return res.status(404).json({ ok: false, error: "Ride not found." });
    }

    if (updatedRide.driverId) {
      await updateRecordById(
        DATA_FILES.drivers,
        updatedRide.driverId,
        (driver) => ({
          ...driver,
          currentRideId: null,
          availability: "online",
          updatedAt: nowIso()
        }),
        []
      );
    }

    await logAdmin("ride_cancelled", {
      rideId: updatedRide.id,
      reason: updatedRide.cancelReason
    });

    res.json({
      ok: true,
      message: "Ride cancelled.",
      ride: updatedRide
    });
  } catch {
    res.status(500).json({ ok: false, error: "Failed to cancel ride." });
  }
});

/* =========================================================
   GPS / ADMIN / SETTINGS / SERVER START
========================================================= */
app.post("/api/gps/update", async (req, res) => {
  try {
    const missing = requireFields(["entityType", "entityId", "address"], req.body);
    if (missing.length) {
      return res.status(400).json({
        ok: false,
        error: `Missing required fields: ${missing.join(", ")}`
      });
    }

    const entry = {
      id: generateId("gps"),
      entityType: safeString(req.body.entityType),
      entityId: safeString(req.body.entityId),
      address: safeString(req.body.address),
      latitude: null,
      longitude: null,
      createdAt: nowIso()
    };

    await appendJson(DATA_FILES.gpsLocations, entry, []);
    res.status(201).json({
      ok: true,
      message: "Address-based location updated without exposing coordinates.",
      location: entry
    });
  } catch {
    res.status(500).json({ ok: false, error: "Failed to update location." });
  }
});

app.post("/api/admin/riders/:riderId/approve", async (req, res) => {
  try {
    const updated = await updateRecordById(
      DATA_FILES.riders,
      req.params.riderId,
      (rider) => ({
        ...rider,
        verificationStatus: "approved",
        riderApproved: true,
        status: "approved",
        updatedAt: nowIso()
      }),
      []
    );

    if (!updated) {
      return res.status(404).json({ ok: false, error: "Rider not found." });
    }

    await logAdmin("rider_approved", { riderId: updated.id });
    res.json({ ok: true, message: "Rider approved successfully.", rider: updated });
  } catch {
    res.status(500).json({ ok: false, error: "Failed to approve rider." });
  }
});

app.post("/api/admin/drivers/:driverId/approve", async (req, res) => {
  try {
    const updated = await updateRecordById(
      DATA_FILES.drivers,
      req.params.driverId,
      (driver) => ({
        ...driver,
        personaStatus: "approved",
        checkrStatus: "approved",
        verificationStatus: "approved",
        status: "approved",
        updatedAt: nowIso()
      }),
      []
    );

    if (!updated) {
      return res.status(404).json({ ok: false, error: "Driver not found." });
    }

    await logAdmin("driver_approved", { driverId: updated.id });
    res.json({ ok: true, message: "Driver approved successfully.", driver: updated });
  } catch {
    res.status(500).json({ ok: false, error: "Failed to approve driver." });
  }
});

app.get("/api/admin/analytics", async (req, res) => {
  try {
    const { riders, drivers, rides, payments } = await getAllData();

    const completedRides = rides.filter((r) => r.status === "completed");
    const activeRides = rides.filter((r) =>
      ["searching_driver", "driver_offered", "driver_assigned", "driver_arrived", "in_progress"].includes(r.status)
    );
    const approvedDrivers = drivers.filter((d) => d.status === "approved");
    const approvedRiders = riders.filter((r) => r.riderApproved);

    const grossRevenue = payments
      .filter((p) => p.type === "ride_charge" && p.status === "captured")
      .reduce((sum, p) => sum + Number(p.amount || 0), 0);

    const totalTips = payments
      .filter((p) => p.type === "ride_charge" && p.status === "captured")
      .reduce((sum, p) => sum + Number(p.tipAmount || 0), 0);

    res.json({
      ok: true,
      analytics: {
        ridersTotal: riders.length,
        ridersApproved: approvedRiders.length,
        driversTotal: drivers.length,
        driversApproved: approvedDrivers.length,
        ridesTotal: rides.length,
        ridesCompleted: completedRides.length,
        ridesActive: activeRides.length,
        grossRevenue: round2(grossRevenue),
        totalTips: round2(totalTips)
      }
    });
  } catch {
    res.status(500).json({ ok: false, error: "Failed to load admin analytics." });
  }
});

app.get("/api/settings", async (req, res) => {
  try {
    const settings = await readJson(DATA_FILES.settings, DEFAULT_DATA.settings);
    res.json({ ok: true, settings });
  } catch {
    res.status(500).json({ ok: false, error: "Failed to load settings." });
  }
});

app.post("/api/settings/fare", async (req, res) => {
  try {
    const current = await readJson(DATA_FILES.settings, DEFAULT_DATA.settings);

    const updated = {
      ...current,
      fare: {
        ...current.fare,
        baseFare: Number(req.body.baseFare ?? current.fare.baseFare),
        perMile: Number(req.body.perMile ?? current.fare.perMile),
        perMinute: Number(req.body.perMinute ?? current.fare.perMinute),
        bookingFee: Number(req.body.bookingFee ?? current.fare.bookingFee),
        minimumFare: Number(req.body.minimumFare ?? current.fare.minimumFare),
        surgeMultiplier: Number(req.body.surgeMultiplier ?? current.fare.surgeMultiplier)
      }
    };

    await writeJson(DATA_FILES.settings, updated);
    await logAdmin("fare_settings_updated", updated.fare);

    res.json({
      ok: true,
      message: "Fare settings updated.",
      settings: updated
    });
  } catch {
    res.status(500).json({ ok: false, error: "Failed to update fare settings." });
  }
});

app.use((req, res) => {
  res.status(404).json({
    ok: false,
    error: "Route not found."
  });
});

initializeDataFiles()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Harvey Taxi unified server running on port ${PORT}`);
    });
  })
  .catch((error) => {
    console.error("Failed to initialize data files:", error);
    process.exit(1);
  });

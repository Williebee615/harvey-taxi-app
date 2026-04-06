const express = require("express");
const cors = require("cors");
const path = require("path");
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

/* =========================================================
   ENV
========================================================= */
const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  PLATFORM_BOOKING_FEE = "2.25",
  PLATFORM_BASE_FARE = "4.50",
  PLATFORM_PER_MILE = "1.95",
  PLATFORM_PER_MINUTE = "0.32",
  PLATFORM_MINIMUM_FARE = "12.00",
  PLATFORM_DRIVER_SHARE = "0.82",
  PLATFORM_SURGE_MULTIPLIER = "1.00",
  NODE_ENV = "development"
} = process.env;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

/* =========================================================
   CONSTANTS
========================================================= */
const RIDE_STATUSES = {
  REQUESTED: "requested",
  SEARCHING_DRIVER: "searching_driver",
  DRIVER_ASSIGNED: "driver_assigned",
  DRIVER_ARRIVING: "driver_arriving",
  TRIP_STARTED: "trip_started",
  TRIP_IN_PROGRESS: "trip_in_progress",
  TRIP_COMPLETED: "trip_completed",
  PAYMENT_PROCESSED: "payment_processed",
  CANCELLED: "cancelled"
};

const DRIVER_DECISIONS = {
  ACCEPTED: "accepted",
  DECLINED: "declined"
};

const DRIVER_STATUS = {
  OFFLINE: "offline",
  ONLINE: "online",
  ON_TRIP: "on_trip"
};

const RIDER_ID_DOCUMENT_TYPES = {
  DRIVER_LICENSE: "driver_license",
  STATE_ID: "state_id",
  PASSPORT: "passport"
};

const DRIVER_ID_DOCUMENT_TYPES = {
  DRIVER_LICENSE: "driver_license"
};

/* =========================================================
   HELPERS
========================================================= */
function generateId(prefix) {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
}

function round2(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function toNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function ok(res, data = {}, code = 200) {
  return res.status(code).json({ success: true, ...data });
}

function fail(res, message = "Request failed", code = 400, extra = {}) {
  return res.status(code).json({ success: false, message, ...extra });
}

function requireFields(body, fields) {
  const missing = fields.filter((field) => {
    const value = body[field];
    return value === undefined || value === null || value === "";
  });
  return missing;
}

function sanitizeRideForClient(ride) {
  if (!ride) return ride;
  const copy = { ...ride };
  delete copy.pickup_lat;
  delete copy.pickup_lng;
  delete copy.dropoff_lat;
  delete copy.dropoff_lng;
  delete copy.driver_current_lat;
  delete copy.driver_current_lng;
  return copy;
}

function sanitizeDriverForClient(driver) {
  if (!driver) return driver;
  const copy = { ...driver };
  delete copy.password;
  delete copy.current_lat;
  delete copy.current_lng;
  delete copy.home_lat;
  delete copy.home_lng;
  delete copy.id_document_last4;
  return copy;
}

function sanitizeRiderForClient(rider) {
  if (!rider) return rider;
  const copy = { ...rider };
  delete copy.password;
  delete copy.id_document_last4;
  return copy;
}

function normalizeRiderIdDocumentType(value) {
  const raw = String(value || "").trim().toLowerCase();

  if (
    raw === "driver_license" ||
    raw === "driver license" ||
    raw === "drivers_license" ||
    raw === "drivers license" ||
    raw === "license"
  ) {
    return RIDER_ID_DOCUMENT_TYPES.DRIVER_LICENSE;
  }

  if (
    raw === "state_id" ||
    raw === "state id" ||
    raw === "id card" ||
    raw === "state identification"
  ) {
    return RIDER_ID_DOCUMENT_TYPES.STATE_ID;
  }

  if (raw === "passport") {
    return RIDER_ID_DOCUMENT_TYPES.PASSPORT;
  }

  return null;
}

function normalizeDriverIdDocumentType(value) {
  const raw = String(value || "").trim().toLowerCase();

  if (
    raw === "driver_license" ||
    raw === "driver license" ||
    raw === "drivers_license" ||
    raw === "drivers license" ||
    raw === "license"
  ) {
    return DRIVER_ID_DOCUMENT_TYPES.DRIVER_LICENSE;
  }

  return null;
}

function getLast4(value) {
  const clean = String(value || "").trim();
  if (!clean) return null;
  return clean.slice(-4);
}

function assertStatusTransition(currentStatus, nextStatus) {
  const allowed = {
    [RIDE_STATUSES.REQUESTED]: [RIDE_STATUSES.SEARCHING_DRIVER, RIDE_STATUSES.CANCELLED],
    [RIDE_STATUSES.SEARCHING_DRIVER]: [RIDE_STATUSES.DRIVER_ASSIGNED, RIDE_STATUSES.CANCELLED],
    [RIDE_STATUSES.DRIVER_ASSIGNED]: [
      RIDE_STATUSES.DRIVER_ARRIVING,
      RIDE_STATUSES.SEARCHING_DRIVER,
      RIDE_STATUSES.CANCELLED
    ],
    [RIDE_STATUSES.DRIVER_ARRIVING]: [RIDE_STATUSES.TRIP_STARTED, RIDE_STATUSES.CANCELLED],
    [RIDE_STATUSES.TRIP_STARTED]: [RIDE_STATUSES.TRIP_IN_PROGRESS, RIDE_STATUSES.TRIP_COMPLETED],
    [RIDE_STATUSES.TRIP_IN_PROGRESS]: [RIDE_STATUSES.TRIP_COMPLETED],
    [RIDE_STATUSES.TRIP_COMPLETED]: [RIDE_STATUSES.PAYMENT_PROCESSED],
    [RIDE_STATUSES.PAYMENT_PROCESSED]: [],
    [RIDE_STATUSES.CANCELLED]: []
  };

  return (allowed[currentStatus] || []).includes(nextStatus);
}

function getPickupZone(address = "") {
  const a = String(address || "").toLowerCase();
  if (a.includes("airport") || a.includes("bna")) return "AIRPORT";
  if (a.includes("north")) return "NORTH";
  if (a.includes("downtown")) return "DOWNTOWN";
  if (a.includes("west")) return "WEST";
  if (a.includes("east")) return "EAST";
  if (a.includes("south")) return "SOUTH";
  return "GENERAL";
}

function estimateDistanceMiles(pickup, dropoff) {
  const a = String(pickup || "").length;
  const b = String(dropoff || "").length;
  const pseudoDistance = ((a + b) % 18) + 4;
  return round2(pseudoDistance);
}

function estimateDurationMinutes(distanceMiles, rideType) {
  let multiplier = 2.0;
  if (rideType === "airport") multiplier = 2.4;
  if (rideType === "medical") multiplier = 2.1;
  if (rideType === "scheduled") multiplier = 2.2;
  return Math.max(8, Math.round(distanceMiles * multiplier));
}

function buildFareConfig() {
  return {
    booking_fee: toNumber(PLATFORM_BOOKING_FEE, 2.25),
    base_fare: toNumber(PLATFORM_BASE_FARE, 4.5),
    per_mile: toNumber(PLATFORM_PER_MILE, 1.95),
    per_minute: toNumber(PLATFORM_PER_MINUTE, 0.32),
    minimum_fare: toNumber(PLATFORM_MINIMUM_FARE, 12),
    driver_share: toNumber(PLATFORM_DRIVER_SHARE, 0.82),
    surge_multiplier: toNumber(PLATFORM_SURGE_MULTIPLIER, 1)
  };
}

function calculateFare({ pickupAddress, dropoffAddress, rideType = "standard" }) {
  const cfg = buildFareConfig();
  const distanceMiles = estimateDistanceMiles(pickupAddress, dropoffAddress);
  const durationMinutes = estimateDurationMinutes(distanceMiles, rideType);

  let multiplier = cfg.surge_multiplier;
  if (rideType === "xl") multiplier += 0.35;
  if (rideType === "premium") multiplier += 0.75;
  if (rideType === "airport") multiplier += 0.15;
  if (rideType === "scheduled") multiplier += 0.10;
  if (rideType === "medical") multiplier += 0.05;

  const subtotal =
    cfg.base_fare +
    distanceMiles * cfg.per_mile +
    durationMinutes * cfg.per_minute;

  const fareBeforeBooking = Math.max(subtotal * multiplier, cfg.minimum_fare);
  const totalFare = round2(fareBeforeBooking + cfg.booking_fee);
  const driverPayout = round2(totalFare * cfg.driver_share);
  const platformFee = round2(totalFare - driverPayout);

  return {
    distance_miles: distanceMiles,
    duration_minutes: durationMinutes,
    estimated_fare: totalFare,
    estimated_driver_payout: driverPayout,
    estimated_platform_fee: platformFee,
    surge_multiplier: round2(multiplier),
    fare_config: cfg
  };
}

function getDriverEtaMinutes(driver, ride) {
  const pickupZone = getPickupZone(ride.pickup_address);
  const driverZone =
    driver.current_address || driver.last_known_address || driver.home_address || "";

  const sameZone = getPickupZone(driverZone) === pickupZone;
  if (sameZone) return 4;
  if (pickupZone === "AIRPORT" && getPickupZone(driverZone) === "DOWNTOWN") return 9;
  if (pickupZone === "DOWNTOWN" && getPickupZone(driverZone) === "AIRPORT") return 9;

  return 7 + Math.floor((Number(driver.completed_missions || 0) % 3));
}

function driverEligibleForRide(driver, ride) {
  if (!driver) return false;
  if (!driver.online) return false;
  if (!driver.available) return false;
  if (!driver.verified) return false;
  if (!driver.approved) return false;
  if (driver.id_document_type !== DRIVER_ID_DOCUMENT_TYPES.DRIVER_LICENSE) return false;
  if (String(driver.checkr_status || "").toLowerCase() !== "clear") return false;
  if (!ride) return false;
  return true;
}

function scoreDriverForRide(driver, ride) {
  const eta = getDriverEtaMinutes(driver, ride);
  const payout = Number(ride.estimated_driver_payout || 0);
  const rideTypeBonus =
    ride.ride_type === "airport" && getPickupZone(driver.current_address) === "AIRPORT" ? 8 : 0;
  const onlineBonus = driver.online ? 5 : 0;
  const reliabilityBonus = Number(driver.acceptance_score || 90) / 10;
  const experienceBonus = Math.min(Number(driver.completed_missions || 0), 40) / 8;

  const score =
    100 -
    eta * 7 +
    onlineBonus +
    rideTypeBonus +
    reliabilityBonus +
    experienceBonus +
    payout * 0.15;

  return {
    score: round2(score),
    eta_to_pickup_minutes: eta
  };
}

/* =========================================================
   DATABASE HELPERS
========================================================= */
async function findRiderById(riderId) {
  const { data, error } = await supabase
    .from("riders")
    .select("*")
    .eq("id", riderId)
    .single();

  if (error) throw error;
  return data;
}

async function findDriverById(driverId) {
  const { data, error } = await supabase
    .from("drivers")
    .select("*")
    .eq("id", driverId)
    .single();

  if (error) throw error;
  return data;
}

async function findRideById(rideId) {
  const { data, error } = await supabase
    .from("rides")
    .select("*")
    .eq("id", rideId)
    .single();

  if (error) throw error;
  return data;
}

async function insertEvent(type, payload) {
  const { error } = await supabase.from("events").insert({
    id: generateId("evt"),
    type,
    payload,
    created_at: new Date().toISOString()
  });

  if (error) {
    console.error("Event insert failed:", error.message);
  }
}

async function ensureWallet(driverId) {
  const { data: existing, error: selectError } = await supabase
    .from("driver_wallets")
    .select("*")
    .eq("driver_id", driverId)
    .maybeSingle();

  if (selectError) throw selectError;
  if (existing) return existing;

  const newWallet = {
    id: generateId("wallet"),
    driver_id: driverId,
    balance: 0,
    lifetime_earnings: 0,
    updated_at: new Date().toISOString()
  };

  const { data, error } = await supabase
    .from("driver_wallets")
    .insert(newWallet)
    .select()
    .single();

  if (error) throw error;
  return data;
}

async function creditDriverWallet(driverId, amount) {
  const wallet = await ensureWallet(driverId);
  const nextBalance = round2(toNumber(wallet.balance) + toNumber(amount));
  const nextLifetime = round2(toNumber(wallet.lifetime_earnings) + toNumber(amount));

  const { data, error } = await supabase
    .from("driver_wallets")
    .update({
      balance: nextBalance,
      lifetime_earnings: nextLifetime,
      updated_at: new Date().toISOString()
    })
    .eq("driver_id", driverId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

async function updateRideStatus(rideId, currentStatus, nextStatus, patch = {}) {
  if (!assertStatusTransition(currentStatus, nextStatus)) {
    throw new Error(`Invalid ride status transition: ${currentStatus} -> ${nextStatus}`);
  }

  const { data, error } = await supabase
    .from("rides")
    .update({
      status: nextStatus,
      updated_at: new Date().toISOString(),
      ...patch
    })
    .eq("id", rideId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

async function setDriverAvailability(driverId, patch = {}) {
  const { data, error } = await supabase
    .from("drivers")
    .update({
      updated_at: new Date().toISOString(),
      ...patch
    })
    .eq("id", driverId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

async function hydrateRide(ride) {
  if (!ride) return null;
  if (!ride.driver_id) return ride;

  try {
    const driver = await findDriverById(ride.driver_id);
    return {
      ...ride,
      driver_name: ride.driver_name || driver.full_name,
      driver_phone: ride.driver_phone || driver.phone,
      driver_vehicle:
        ride.driver_vehicle ||
        `${driver.vehicle_color || ""} ${driver.vehicle_make || ""} ${driver.vehicle_model || ""}`.trim()
    };
  } catch {
    return ride;
  }
}

async function hydrateRides(rides) {
  const results = [];
  for (const ride of rides || []) {
    results.push(await hydrateRide(ride));
  }
  return results;
}

/* =========================================================
   DISPATCH BRAIN
========================================================= */
async function getEligibleDrivers() {
  const { data, error } = await supabase
    .from("drivers")
    .select("*")
    .eq("verified", true)
    .eq("approved", true)
    .eq("online", true)
    .eq("available", true);

  if (error) throw error;
  return data || [];
}

async function findBestDriverForRide(ride) {
  const drivers = await getEligibleDrivers();
  const eligibleDrivers = drivers.filter((driver) => driverEligibleForRide(driver, ride));

  if (!eligibleDrivers.length) return null;

  const ranked = eligibleDrivers
    .map((driver) => ({
      driver,
      ...scoreDriverForRide(driver, ride)
    }))
    .sort((a, b) => b.score - a.score);

  return ranked[0];
}

async function assignNearestDriverToRide(ride) {
  const bestMatch = await findBestDriverForRide(ride);

  if (!bestMatch) {
    await supabase
      .from("rides")
      .update({
        driver_id: null,
        driver_name: null,
        driver_phone: null,
        driver_vehicle: null,
        driver_eta_to_pickup_minutes: null,
        driver_eta_to_pickup_text: null,
        driver_distance_to_pickup_miles: null,
        driver_distance_to_pickup_text: null,
        dispatch_score: null,
        status: RIDE_STATUSES.SEARCHING_DRIVER,
        updated_at: new Date().toISOString()
      })
      .eq("id", ride.id);

    return null;
  }

  const driver = bestMatch.driver;
  const driverVehicle =
    `${driver.vehicle_color || ""} ${driver.vehicle_make || ""} ${driver.vehicle_model || ""}`.trim();

  const { data, error } = await supabase
    .from("rides")
    .update({
      driver_id: driver.id,
      driver_name: driver.full_name,
      driver_phone: driver.phone,
      driver_vehicle: driverVehicle,
      driver_eta_to_pickup_minutes: bestMatch.eta_to_pickup_minutes,
      driver_eta_to_pickup_text: `${bestMatch.eta_to_pickup_minutes} min`,
      driver_distance_to_pickup_miles: null,
      driver_distance_to_pickup_text: null,
      dispatch_score: bestMatch.score,
      mission_sent_at: new Date().toISOString(),
      status: RIDE_STATUSES.DRIVER_ASSIGNED,
      updated_at: new Date().toISOString()
    })
    .eq("id", ride.id)
    .select()
    .single();

  if (error) throw error;

  await insertEvent("ride.driver_assigned", {
    ride_id: ride.id,
    driver_id: driver.id,
    dispatch_score: bestMatch.score
  });

  return data;
}

/* =========================================================
   STATIC PAGE ROUTES
========================================================= */
app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/request-ride", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "request-ride.html"));
});

app.get("/driver-missions", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "driver-missions.html"));
});

app.get("/active-trip", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "active-trip.html"));
});

app.get("/admin-dispatch", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin-dispatch.html"));
});

app.get("/admin-dashboard", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin-dashboard.html"));
});

/* =========================================================
   HEALTH / ADMIN LOGIN
========================================================= */
app.get("/api/health", (_req, res) => {
  return ok(res, {
    message: "Harvey Taxi production server running",
    environment: NODE_ENV,
    timestamp: new Date().toISOString()
  });
});

app.post("/api/admin/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
      return fail(res, "Admin credentials not configured on server", 500);
    }

    if (email !== ADMIN_EMAIL || password !== ADMIN_PASSWORD) {
      return fail(res, "Invalid admin credentials", 401);
    }

    return ok(res, {
      message: "Admin login successful",
      admin: { email }
    });
  } catch (error) {
    console.error(error);
    return fail(res, "Admin login failed", 500);
  }
});

/* =========================================================
   RIDER ROUTES
========================================================= */
app.post("/api/rider/signup", async (req, res) => {
  try {
    const fullName =
      req.body.full_name ||
      req.body.fullName ||
      req.body.name ||
      "";

    const phone =
      req.body.phone ||
      req.body.phone_number ||
      req.body.phoneNumber ||
      "";

    const email =
      req.body.email ||
      req.body.email_address ||
      req.body.emailAddress ||
      "";

    const riderIdDocumentType = normalizeRiderIdDocumentType(
      req.body.id_document_type ||
      req.body.idDocumentType ||
      req.body.verification_document_type ||
      req.body.verificationDocumentType ||
      req.body.document_type ||
      req.body.documentType
    );

    const riderIdDocumentNumber =
      req.body.id_document_number ||
      req.body.idDocumentNumber ||
      req.body.document_number ||
      req.body.documentNumber ||
      "";

    if (!fullName || !phone || !email) {
      return fail(res, "Full name, phone, and email are required.");
    }

    if (!riderIdDocumentType) {
      return fail(
        res,
        "Rider ID document type is required. Use driver_license, state_id, or passport."
      );
    }

    const rider = {
      id: generateId("rider"),
      full_name: fullName,
      email: String(email).toLowerCase().trim(),
      phone: String(phone).trim(),
      verified: false,
      approved: false,
      persona_status: "pending",
      id_document_type: riderIdDocumentType,
      id_document_last4: getLast4(riderIdDocumentNumber),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    const { data, error } = await supabase
      .from("riders")
      .insert(rider)
      .select()
      .single();

    if (error) throw error;

    await insertEvent("rider.created", {
      rider_id: data.id,
      email: data.email,
      id_document_type: data.id_document_type
    });

    return ok(
      res,
      {
        message: "Rider account created. Verification required before ride requests.",
        rider: sanitizeRiderForClient(data)
      },
      201
    );
  } catch (error) {
    console.error(error);
    return fail(res, error.message || "Failed to create rider", 500);
  }
});

app.get("/api/riders/:riderId", async (req, res) => {
  try {
    const rider = await findRiderById(req.params.riderId);
    return ok(res, { rider: sanitizeRiderForClient(rider) });
  } catch (error) {
    console.error(error);
    return fail(res, "Rider not found", 404);
  }
});

/* =========================================================
   DRIVER ROUTES
========================================================= */
app.post("/api/driver/signup", async (req, res) => {
  try {
    const fullName =
      req.body.full_name ||
      req.body.fullName ||
      req.body.name ||
      "";

    const phone =
      req.body.phone ||
      req.body.phone_number ||
      req.body.phoneNumber ||
      "";

    const email =
      req.body.email ||
      req.body.email_address ||
      req.body.emailAddress ||
      "";

    const vehicleMake = req.body.vehicle_make || req.body.vehicleMake || "Unknown";
    const vehicleModel = req.body.vehicle_model || req.body.vehicleModel || "Unknown";
    const vehicleColor = req.body.vehicle_color || req.body.vehicleColor || "Unknown";
    const vehiclePlate = req.body.vehicle_plate || req.body.vehiclePlate || "Unknown";
    const currentAddress =
      req.body.current_address ||
      req.body.city ||
      req.body.operating_city ||
      "";

    const driverIdDocumentType = normalizeDriverIdDocumentType(
      req.body.id_document_type ||
      req.body.idDocumentType ||
      req.body.verification_document_type ||
      req.body.verificationDocumentType ||
      req.body.document_type ||
      req.body.documentType
    );

    const driverIdDocumentNumber =
      req.body.id_document_number ||
      req.body.idDocumentNumber ||
      req.body.document_number ||
      req.body.documentNumber ||
      "";

    if (!fullName || !phone || !email) {
      return fail(res, "Full name, phone, and email are required.");
    }

    if (!driverIdDocumentType) {
      return fail(
        res,
        "Driver ID document type must be driver_license."
      );
    }

    const driver = {
      id: generateId("driver"),
      full_name: fullName,
      email: String(email).toLowerCase().trim(),
      phone: String(phone).trim(),
      vehicle_make: vehicleMake,
      vehicle_model: vehicleModel,
      vehicle_color: vehicleColor,
      vehicle_plate: vehiclePlate,
      verified: false,
      approved: false,
      persona_status: "pending",
      checkr_status: "pending",
      id_document_type: driverIdDocumentType,
      id_document_last4: getLast4(driverIdDocumentNumber),
      online: false,
      available: false,
      driver_status: DRIVER_STATUS.OFFLINE,
      current_address: currentAddress || null,
      last_known_address: currentAddress || null,
      completed_missions: 0,
      acceptance_score: 90,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    const { data, error } = await supabase
      .from("drivers")
      .insert(driver)
      .select()
      .single();

    if (error) throw error;

    await ensureWallet(data.id);
    await insertEvent("driver.created", {
      driver_id: data.id,
      email: data.email,
      id_document_type: data.id_document_type,
      checkr_status: data.checkr_status
    });

    return ok(
      res,
      {
        message: "Driver account created. Driver license verification and background check are required before going online.",
        driver: sanitizeDriverForClient(data)
      },
      201
    );
  } catch (error) {
    console.error(error);
    return fail(res, error.message || "Failed to create driver", 500);
  }
});

app.get("/api/drivers/:driverId", async (req, res) => {
  try {
    const driver = await findDriverById(req.params.driverId);
    return ok(res, { driver: sanitizeDriverForClient(driver) });
  } catch (error) {
    console.error(error);
    return fail(res, "Driver not found", 404);
  }
});

app.post("/api/drivers/:driverId/go-online", async (req, res) => {
  try {
    const driver = await findDriverById(req.params.driverId);

    if (!driver.verified || !driver.approved) {
      return fail(res, "Driver must be verified and approved before going online", 403);
    }

    if (driver.id_document_type !== DRIVER_ID_DOCUMENT_TYPES.DRIVER_LICENSE) {
      return fail(res, "Driver must be verified with a driver license", 403);
    }

    if (String(driver.checkr_status || "").toLowerCase() !== "clear") {
      return fail(res, "Driver background check must be clear before going online", 403);
    }

    const currentAddress = req.body.current_address || driver.current_address || driver.last_known_address;
    if (!currentAddress) {
      return fail(res, "Driver current address is required to go online");
    }

    const updatedDriver = await setDriverAvailability(driver.id, {
      online: true,
      available: true,
      driver_status: DRIVER_STATUS.ONLINE,
      current_address: currentAddress,
      last_known_address: currentAddress
    });

    await insertEvent("driver.online", { driver_id: driver.id });

    return ok(res, {
      message: "Driver is now online and available",
      driver: sanitizeDriverForClient(updatedDriver)
    });
  } catch (error) {
    console.error(error);
    return fail(res, "Failed to set driver online", 500);
  }
});

app.post("/api/drivers/:driverId/go-offline", async (req, res) => {
  try {
    const updatedDriver = await setDriverAvailability(req.params.driverId, {
      online: false,
      available: false,
      driver_status: DRIVER_STATUS.OFFLINE
    });

    await insertEvent("driver.offline", { driver_id: req.params.driverId });

    return ok(res, {
      message: "Driver is now offline",
      driver: sanitizeDriverForClient(updatedDriver)
    });
  } catch (error) {
    console.error(error);
    return fail(res, "Failed to set driver offline", 500);
  }
});

app.post("/api/drivers/:driverId/location", async (req, res) => {
  try {
    const { current_address } = req.body;
    if (!current_address) {
      return fail(res, "current_address is required");
    }

    const updatedDriver = await setDriverAvailability(req.params.driverId, {
      current_address,
      last_known_address: current_address
    });

    return ok(res, {
      message: "Driver location updated",
      driver: sanitizeDriverForClient(updatedDriver)
    });
  } catch (error) {
    console.error(error);
    return fail(res, "Failed to update driver location", 500);
  }
});

/* =========================================================
   FARE ESTIMATE
========================================================= */
app.post("/api/fare-estimate", async (req, res) => {
  try {
    const { pickup_address, dropoff_address, ride_type = "standard" } = req.body;

    if (!pickup_address || !dropoff_address) {
      return fail(res, "Pickup and dropoff addresses are required.");
    }

    const estimate = calculateFare({
      pickupAddress: pickup_address,
      dropoffAddress: dropoff_address,
      rideType: String(ride_type).toLowerCase()
    });

    return ok(res, { estimate });
  } catch (error) {
    console.error(error);
    return fail(res, "Failed to calculate fare estimate", 500);
  }
});

/* =========================================================
   RIDE REQUEST + DISPATCH
========================================================= */
app.post("/api/request-ride", async (req, res) => {
  try {
    const missing = requireFields(req.body, ["rider_id", "pickup_address", "dropoff_address"]);
    if (missing.length) {
      return fail(res, `Missing fields: ${missing.join(", ")}`);
    }

    const rider = await findRiderById(req.body.rider_id);
    if (!rider.verified || !rider.approved) {
      return fail(res, "Rider must be verified and approved before requesting a ride", 403);
    }

    const pickupAddress = String(req.body.pickup_address).trim();
    const dropoffAddress = String(req.body.dropoff_address).trim();
    const rideType = String(req.body.ride_type || "standard").toLowerCase();
    const paymentMethod = req.body.payment_method || "card";

    const fare = calculateFare({
      pickupAddress,
      dropoffAddress,
      rideType
    });

    const rideRecord = {
      id: generateId("ride"),
      rider_id: rider.id,
      rider_name: rider.full_name,
      rider_phone: rider.phone,
      pickup_address: pickupAddress,
      dropoff_address: dropoffAddress,
      ride_type: rideType,
      payment_method: paymentMethod,
      distance_miles: fare.distance_miles,
      duration_minutes: fare.duration_minutes,
      distance_text: `${fare.distance_miles} mi`,
      duration_text: `${fare.duration_minutes} min`,
      estimated_fare: fare.estimated_fare,
      estimated_driver_payout: fare.estimated_driver_payout,
      estimated_platform_fee: fare.estimated_platform_fee,
      surge_multiplier: fare.surge_multiplier,
      fare_config: fare.fare_config,
      status: RIDE_STATUSES.REQUESTED,
      driver_id: null,
      driver_name: null,
      driver_phone: null,
      driver_vehicle: null,
      requested_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    const { data: createdRide, error: createRideError } = await supabase
      .from("rides")
      .insert(rideRecord)
      .select()
      .single();

    if (createRideError) throw createRideError;

    await insertEvent("ride.requested", {
      ride_id: createdRide.id,
      rider_id: rider.id,
      pickup_address: createdRide.pickup_address,
      dropoff_address: createdRide.dropoff_address
    });

    const searchingRide = await updateRideStatus(
      createdRide.id,
      RIDE_STATUSES.REQUESTED,
      RIDE_STATUSES.SEARCHING_DRIVER,
      { search_started_at: new Date().toISOString() }
    );

    await insertEvent("ride.searching_driver", {
      ride_id: searchingRide.id
    });

    const assignedRide = await assignNearestDriverToRide(searchingRide);

    if (!assignedRide) {
      return ok(
        res,
        {
          message: "Ride created. No drivers available right now.",
          ride: sanitizeRideForClient(searchingRide),
          dispatch_status: "no_driver_available"
        },
        201
      );
    }

    return ok(
      res,
      {
        message: "Ride requested and driver assigned",
        ride: sanitizeRideForClient(assignedRide)
      },
      201
    );
  } catch (error) {
    console.error(error);
    return fail(res, error.message || "Failed to request ride", 500);
  }
});

app.get("/api/rides/:rideId", async (req, res) => {
  try {
    const ride = await findRideById(req.params.rideId);
    return ok(res, { ride: sanitizeRideForClient(await hydrateRide(ride)) });
  } catch (error) {
    console.error(error);
    return fail(res, "Ride not found", 404);
  }
});

app.get("/api/rides", async (req, res) => {
  try {
    const { rider_id, driver_id, status } = req.query;

    let query = supabase
      .from("rides")
      .select("*")
      .order("created_at", { ascending: false });

    if (rider_id) query = query.eq("rider_id", rider_id);
    if (driver_id) query = query.eq("driver_id", driver_id);
    if (status) query = query.eq("status", status);

    const { data, error } = await query;
    if (error) throw error;

    return ok(res, {
      rides: (await hydrateRides(data || [])).map(sanitizeRideForClient)
    });
  } catch (error) {
    console.error(error);
    return fail(res, "Failed to fetch rides", 500);
  }
});

app.post("/api/rides/:rideId/cancel", async (req, res) => {
  try {
    const ride = await findRideById(req.params.rideId);

    if (
      ride.status === RIDE_STATUSES.TRIP_COMPLETED ||
      ride.status === RIDE_STATUSES.PAYMENT_PROCESSED ||
      ride.status === RIDE_STATUSES.CANCELLED
    ) {
      return fail(res, "Ride can no longer be cancelled", 400);
    }

    const cancelledRide = await updateRideStatus(
      ride.id,
      ride.status,
      RIDE_STATUSES.CANCELLED,
      {
        cancelled_at: new Date().toISOString(),
        cancellation_reason: req.body.reason || "Cancelled by user"
      }
    );

    if (ride.driver_id) {
      await setDriverAvailability(ride.driver_id, {
        available: true,
        driver_status: DRIVER_STATUS.ONLINE
      });
    }

    await insertEvent("ride.cancelled", {
      ride_id: ride.id,
      reason: req.body.reason || "Cancelled by user"
    });

    return ok(res, {
      message: "Ride cancelled",
      ride: sanitizeRideForClient(cancelledRide)
    });
  } catch (error) {
    console.error(error);
    return fail(res, error.message || "Failed to cancel ride", 500);
  }
});

/* =========================================================
   DRIVER MISSIONS + TRIP LIFECYCLE
========================================================= */
app.get("/api/drivers/:driverId/missions", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("rides")
      .select("*")
      .eq("driver_id", req.params.driverId)
      .in("status", [
        RIDE_STATUSES.DRIVER_ASSIGNED,
        RIDE_STATUSES.DRIVER_ARRIVING,
        RIDE_STATUSES.TRIP_STARTED,
        RIDE_STATUSES.TRIP_IN_PROGRESS
      ])
      .order("created_at", { ascending: false });

    if (error) throw error;

    return ok(res, {
      missions: (await hydrateRides(data || [])).map(sanitizeRideForClient)
    });
  } catch (error) {
    console.error(error);
    return fail(res, "Failed to fetch driver missions", 500);
  }
});

app.post("/api/rides/:rideId/driver-decision", async (req, res) => {
  try {
    const { driver_id, decision } = req.body;

    if (!driver_id || !decision) {
      return fail(res, "driver_id and decision are required");
    }

    const ride = await findRideById(req.params.rideId);

    if (ride.driver_id !== driver_id) {
      return fail(res, "This ride is not assigned to that driver", 403);
    }

    if (ride.status !== RIDE_STATUSES.DRIVER_ASSIGNED) {
      return fail(res, "Ride is not awaiting driver decision", 400);
    }

    if (decision === DRIVER_DECISIONS.ACCEPTED) {
      const acceptedRide = await updateRideStatus(
        ride.id,
        RIDE_STATUSES.DRIVER_ASSIGNED,
        RIDE_STATUSES.DRIVER_ARRIVING,
        { driver_accepted_at: new Date().toISOString() }
      );

      await setDriverAvailability(driver_id, {
        available: false,
        driver_status: DRIVER_STATUS.ON_TRIP
      });

      await insertEvent("ride.driver_accepted", {
        ride_id: ride.id,
        driver_id
      });

      return ok(res, {
        message: "Ride accepted by driver",
        ride: sanitizeRideForClient(acceptedRide)
      });
    }

    if (decision === DRIVER_DECISIONS.DECLINED) {
      await insertEvent("ride.driver_declined", {
        ride_id: ride.id,
        driver_id
      });

      await setDriverAvailability(driver_id, {
        available: true,
        driver_status: DRIVER_STATUS.ONLINE
      });

      const { data: resetRide, error: resetError } = await supabase
        .from("rides")
        .update({
          driver_id: null,
          driver_name: null,
          driver_phone: null,
          driver_vehicle: null,
          driver_eta_to_pickup_minutes: null,
          driver_eta_to_pickup_text: null,
          driver_distance_to_pickup_miles: null,
          driver_distance_to_pickup_text: null,
          mission_sent_at: null,
          updated_at: new Date().toISOString()
        })
        .eq("id", ride.id)
        .select()
        .single();

      if (resetError) throw resetError;

      const searchingAgain = await updateRideStatus(
        resetRide.id,
        RIDE_STATUSES.DRIVER_ASSIGNED,
        RIDE_STATUSES.SEARCHING_DRIVER,
        { search_restarted_at: new Date().toISOString() }
      );

      const reassignedRide = await assignNearestDriverToRide(searchingAgain);

      if (!reassignedRide) {
        return ok(res, {
          message: "Driver declined. Ride remains open with no available replacement yet.",
          ride: sanitizeRideForClient(searchingAgain),
          dispatch_status: "no_driver_available"
        });
      }

      return ok(res, {
        message: "Driver declined. Ride reassigned to another driver.",
        ride: sanitizeRideForClient(reassignedRide)
      });
    }

    return fail(res, "Invalid driver decision", 400);
  } catch (error) {
    console.error(error);
    return fail(res, error.message || "Failed to process driver decision", 500);
  }
});

app.post("/api/rides/:rideId/arrive", async (req, res) => {
  try {
    const { driver_id } = req.body;
    if (!driver_id) return fail(res, "driver_id is required");

    const ride = await findRideById(req.params.rideId);

    if (ride.driver_id !== driver_id) {
      return fail(res, "This ride is not assigned to that driver", 403);
    }

    if (ride.status !== RIDE_STATUSES.DRIVER_ARRIVING) {
      return fail(res, "Ride is not in driver arriving status", 400);
    }

    const { data, error } = await supabase
      .from("rides")
      .update({
        driver_arrived_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq("id", ride.id)
      .select()
      .single();

    if (error) throw error;

    await insertEvent("ride.driver_arrived", {
      ride_id: ride.id,
      driver_id
    });

    return ok(res, {
      message: "Driver arrival recorded",
      ride: sanitizeRideForClient(data)
    });
  } catch (error) {
    console.error(error);
    return fail(res, error.message || "Failed to mark driver arrived", 500);
  }
});

app.post("/api/rides/:rideId/start", async (req, res) => {
  try {
    const { driver_id } = req.body;
    if (!driver_id) return fail(res, "driver_id is required");

    const ride = await findRideById(req.params.rideId);

    if (ride.driver_id !== driver_id) {
      return fail(res, "This ride is not assigned to that driver", 403);
    }

    if (ride.status !== RIDE_STATUSES.DRIVER_ARRIVING) {
      return fail(res, "Ride must be in driver arriving status before starting", 400);
    }

    const startedRide = await updateRideStatus(
      ride.id,
      RIDE_STATUSES.DRIVER_ARRIVING,
      RIDE_STATUSES.TRIP_STARTED,
      { trip_started_at: new Date().toISOString() }
    );

    await insertEvent("ride.trip_started", {
      ride_id: ride.id,
      driver_id
    });

    return ok(res, {
      message: "Trip started",
      ride: sanitizeRideForClient(startedRide)
    });
  } catch (error) {
    console.error(error);
    return fail(res, error.message || "Failed to start trip", 500);
  }
});

app.post("/api/rides/:rideId/in-progress", async (req, res) => {
  try {
    const { driver_id } = req.body;
    if (!driver_id) return fail(res, "driver_id is required");

    const ride = await findRideById(req.params.rideId);

    if (ride.driver_id !== driver_id) {
      return fail(res, "This ride is not assigned to that driver", 403);
    }

    if (ride.status !== RIDE_STATUSES.TRIP_STARTED) {
      return fail(res, "Ride must be trip_started before moving to in progress", 400);
    }

    const inProgressRide = await updateRideStatus(
      ride.id,
      RIDE_STATUSES.TRIP_STARTED,
      RIDE_STATUSES.TRIP_IN_PROGRESS,
      { trip_in_progress_at: new Date().toISOString() }
    );

    await insertEvent("ride.trip_in_progress", {
      ride_id: ride.id,
      driver_id
    });

    return ok(res, {
      message: "Trip is now in progress",
      ride: sanitizeRideForClient(inProgressRide)
    });
  } catch (error) {
    console.error(error);
    return fail(res, error.message || "Failed to move trip to in-progress", 500);
  }
});

app.post("/api/rides/:rideId/complete", async (req, res) => {
  try {
    const { driver_id, final_tip = 0 } = req.body;
    if (!driver_id) return fail(res, "driver_id is required");

    const ride = await findRideById(req.params.rideId);

    if (ride.driver_id !== driver_id) {
      return fail(res, "This ride is not assigned to that driver", 403);
    }

    if (![RIDE_STATUSES.TRIP_STARTED, RIDE_STATUSES.TRIP_IN_PROGRESS].includes(ride.status)) {
      return fail(res, "Ride must be active before completion", 400);
    }

    const tipAmount = round2(toNumber(final_tip, 0));
    const finalFare = round2(toNumber(ride.estimated_fare, 0) + tipAmount);
    const finalDriverPayout = round2(toNumber(ride.estimated_driver_payout, 0) + tipAmount);
    const finalPlatformFee = round2(finalFare - finalDriverPayout);

    const completedRide = await updateRideStatus(
      ride.id,
      ride.status,
      RIDE_STATUSES.TRIP_COMPLETED,
      {
        trip_completed_at: new Date().toISOString(),
        final_tip: tipAmount,
        final_fare: finalFare,
        final_driver_payout: finalDriverPayout,
        final_platform_fee: finalPlatformFee
      }
    );

    await creditDriverWallet(driver_id, finalDriverPayout);

    await setDriverAvailability(driver_id, {
      available: true,
      driver_status: DRIVER_STATUS.ONLINE
    });

    const processedRide = await updateRideStatus(
      completedRide.id,
      RIDE_STATUSES.TRIP_COMPLETED,
      RIDE_STATUSES.PAYMENT_PROCESSED,
      { payment_processed_at: new Date().toISOString() }
    );

    await insertEvent("ride.completed", {
      ride_id: ride.id,
      driver_id,
      final_fare: finalFare,
      final_driver_payout: finalDriverPayout,
      final_platform_fee: finalPlatformFee,
      final_tip: tipAmount
    });

    return ok(res, {
      message: "Trip completed and payment processed",
      ride: sanitizeRideForClient(processedRide)
    });
  } catch (error) {
    console.error(error);
    return fail(res, error.message || "Failed to complete trip", 500);
  }
});

app.post("/api/rides/:rideId/tip", async (req, res) => {
  try {
    const { amount } = req.body;
    const ride = await findRideById(req.params.rideId);

    if (!ride.driver_id) {
      return fail(res, "Ride has no assigned driver", 400);
    }

    const tipAmount = round2(toNumber(amount, 0));
    if (tipAmount <= 0) {
      return fail(res, "Tip amount must be greater than zero", 400);
    }

    const existingTip = round2(toNumber(ride.final_tip, 0));
    const nextTip = round2(existingTip + tipAmount);

    const baseFare =
      ride.final_fare != null
        ? round2(toNumber(ride.final_fare) - existingTip)
        : round2(toNumber(ride.estimated_fare, 0));

    const nextFare = round2(baseFare + nextTip);
    const baseDriverPayout =
      ride.final_driver_payout != null
        ? round2(toNumber(ride.final_driver_payout) - existingTip)
        : round2(toNumber(ride.estimated_driver_payout, 0));

    const nextDriverPayout = round2(baseDriverPayout + nextTip);
    const nextPlatformFee = round2(nextFare - nextDriverPayout);

    const { data, error } = await supabase
      .from("rides")
      .update({
        final_tip: nextTip,
        final_fare: nextFare,
        final_driver_payout: nextDriverPayout,
        final_platform_fee: nextPlatformFee,
        updated_at: new Date().toISOString()
      })
      .eq("id", ride.id)
      .select()
      .single();

    if (error) throw error;

    await creditDriverWallet(ride.driver_id, tipAmount);

    await insertEvent("ride.tip_added", {
      ride_id: ride.id,
      driver_id: ride.driver_id,
      tip_amount: tipAmount,
      total_tip: nextTip
    });

    return ok(res, {
      message: "Tip added successfully",
      ride: sanitizeRideForClient(data)
    });
  } catch (error) {
    console.error(error);
    return fail(res, error.message || "Failed to add tip", 500);
  }
});

/* =========================================================
   ADMIN / OPERATIONS
========================================================= */
app.get("/api/admin/dispatch", async (_req, res) => {
  try {
    const { data: drivers, error: driversError } = await supabase
      .from("drivers")
      .select("*")
      .order("updated_at", { ascending: false });

    const { data: rides, error: ridesError } = await supabase
      .from("rides")
      .select("*")
      .order("created_at", { ascending: false });

    const { data: wallets, error: walletsError } = await supabase
      .from("driver_wallets")
      .select("*")
      .order("updated_at", { ascending: false });

    if (driversError) throw driversError;
    if (ridesError) throw ridesError;
    if (walletsError) throw walletsError;

    const activeStatuses = [
      RIDE_STATUSES.SEARCHING_DRIVER,
      RIDE_STATUSES.DRIVER_ASSIGNED,
      RIDE_STATUSES.DRIVER_ARRIVING,
      RIDE_STATUSES.TRIP_STARTED,
      RIDE_STATUSES.TRIP_IN_PROGRESS
    ];

    const summary = {
      total_drivers: (drivers || []).length,
      online_drivers: (drivers || []).filter((d) => d.online).length,
      available_drivers: (drivers || []).filter((d) => d.available).length,
      total_rides: (rides || []).length,
      active_rides: (rides || []).filter((r) => activeStatuses.includes(r.status)).length,
      completed_rides: (rides || []).filter((r) => r.status === RIDE_STATUSES.PAYMENT_PROCESSED).length,
      cancelled_rides: (rides || []).filter((r) => r.status === RIDE_STATUSES.CANCELLED).length,
      total_driver_wallet_balance: round2(
        (wallets || []).reduce((sum, wallet) => sum + toNumber(wallet.balance, 0), 0)
      ),
      total_driver_lifetime_earnings: round2(
        (wallets || []).reduce((sum, wallet) => sum + toNumber(wallet.lifetime_earnings, 0), 0)
      ),
      platform_revenue: round2(
        (rides || []).reduce((sum, ride) => sum + toNumber(ride.final_platform_fee || ride.estimated_platform_fee, 0), 0)
      )
    };

    return ok(res, {
      summary,
      drivers: (drivers || []).map(sanitizeDriverForClient),
      rides: (await hydrateRides(rides || [])).map(sanitizeRideForClient),
      wallets: wallets || []
    });
  } catch (error) {
    console.error(error);
    return fail(res, "Failed to load admin dispatch data", 500);
  }
});

app.post("/api/admin/riders/:riderId/approve", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("riders")
      .update({
        verified: true,
        approved: true,
        persona_status: "approved",
        updated_at: new Date().toISOString()
      })
      .eq("id", req.params.riderId)
      .select()
      .single();

    if (error) throw error;

    await insertEvent("rider.approved", { rider_id: req.params.riderId });

    return ok(res, {
      message: "Rider approved successfully",
      rider: sanitizeRiderForClient(data)
    });
  } catch (error) {
    console.error(error);
    return fail(res, "Failed to approve rider", 500);
  }
});

app.post("/api/admin/drivers/:driverId/approve", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("drivers")
      .update({
        verified: true,
        approved: true,
        persona_status: "approved",
        checkr_status: "clear",
        updated_at: new Date().toISOString()
      })
      .eq("id", req.params.driverId)
      .select()
      .single();

    if (error) throw error;

    await insertEvent("driver.approved", { driver_id: req.params.driverId });

    return ok(res, {
      message: "Driver approved successfully",
      driver: sanitizeDriverForClient(data)
    });
  } catch (error) {
    console.error(error);
    return fail(res, "Failed to approve driver", 500);
  }
});

app.post("/api/admin/rides/:rideId/reassign", async (req, res) => {
  try {
    const ride = await findRideById(req.params.rideId);

    if (
      ![
        RIDE_STATUSES.SEARCHING_DRIVER,
        RIDE_STATUSES.DRIVER_ASSIGNED,
        RIDE_STATUSES.DRIVER_ARRIVING
      ].includes(ride.status)
    ) {
      return fail(res, "Ride cannot be reassigned in its current status", 400);
    }

    if (ride.driver_id) {
      await setDriverAvailability(ride.driver_id, {
        available: true,
        driver_status: DRIVER_STATUS.ONLINE
      });
    }

    const { data: resetRide, error: resetError } = await supabase
      .from("rides")
      .update({
        driver_id: null,
        driver_name: null,
        driver_phone: null,
        driver_vehicle: null,
        driver_eta_to_pickup_minutes: null,
        driver_eta_to_pickup_text: null,
        driver_distance_to_pickup_miles: null,
        driver_distance_to_pickup_text: null,
        status: RIDE_STATUSES.SEARCHING_DRIVER,
        updated_at: new Date().toISOString()
      })
      .eq("id", ride.id)
      .select()
      .single();

    if (resetError) throw resetError;

    const reassignedRide = await assignNearestDriverToRide(resetRide);

    if (!reassignedRide) {
      return ok(res, {
        message: "Ride reset to searching but no replacement driver is currently available",
        ride: sanitizeRideForClient(resetRide)
      });
    }

    await insertEvent("ride.reassigned", {
      ride_id: ride.id,
      new_driver_id: reassignedRide.driver_id
    });

    return ok(res, {
      message: "Ride reassigned successfully",
      ride: sanitizeRideForClient(reassignedRide)
    });
  } catch (error) {
    console.error(error);
    return fail(res, error.message || "Failed to reassign ride", 500);
  }
});

/* =========================================================
   EVENTS / WALLET
========================================================= */
app.get("/api/events", async (_req, res) => {
  try {
    const { data, error } = await supabase
      .from("events")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(250);

    if (error) throw error;

    return ok(res, { events: data || [] });
  } catch (error) {
    console.error(error);
    return fail(res, "Failed to fetch events", 500);
  }
});

app.get("/api/drivers/:driverId/wallet", async (req, res) => {
  try {
    const wallet = await ensureWallet(req.params.driverId);
    return ok(res, { wallet });
  } catch (error) {
    console.error(error);
    return fail(res, "Failed to fetch driver wallet", 500);
  }
});

/* =========================================================
   404 + ERROR
========================================================= */
app.use((req, res) => {
  return fail(res, `Route not found: ${req.method} ${req.originalUrl}`, 404);
});

app.use((error, _req, res, _next) => {
  console.error("Unhandled server error:", error);
  return fail(res, "Internal server error", 500);
});

/* =========================================================
   START
========================================================= */
app.listen(PORT, () => {
  console.log(`Harvey Taxi production server running on port ${PORT}`);
});

const express = require("express");
const cors = require("cors");
const path = require("path");
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
  GOOGLE_MAPS_API_KEY
} = process.env;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

/* =========================================================
   CONSTANTS
========================================================= */
const DISPATCH_OFFER_TIMEOUT_MS = 20000;
const MAX_DISPATCH_ATTEMPTS = 5;

/* =========================================================
   HELPERS
========================================================= */
function generateId(prefix) {
  return `${prefix}_${Math.random().toString(36).substring(2, 10)}`;
}

function now() {
  return new Date().toISOString();
}

function requireFields(body, fields) {
  for (const f of fields) {
    if (
      body[f] === undefined ||
      body[f] === null ||
      body[f] === ""
    ) {
      return `Missing field: ${f}`;
    }
  }
  return null;
}

function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeRideType(value = "") {
  const type = String(value).trim().toLowerCase();
  if (["standard", "scheduled", "airport", "medical", "nonprofit"].includes(type)) {
    return type;
  }
  return "standard";
}

function normalizeRequestedMode(value = "") {
  const mode = String(value).trim().toLowerCase();
  if (mode === "autonomous") return "autonomous";
  return "driver";
}

function normalizeAvailability(value = "") {
  const availability = String(value).trim().toLowerCase();
  if (["available", "offline", "busy"].includes(availability)) return availability;
  return "offline";
}

function calculateFare({
  distanceMiles = 5,
  durationMinutes = 15,
  rideType = "standard"
}) {
  const baseFare = 4.5;
  const perMile = 2.25;
  const perMinute = 0.45;
  const bookingFee = 2.5;

  const typeMultiplierMap = {
    standard: 1,
    scheduled: 1.15,
    airport: 1.25,
    medical: 1.1,
    nonprofit: 0.9
  };

  const multiplier = typeMultiplierMap[rideType] || 1;

  let total =
    (baseFare + distanceMiles * perMile + durationMinutes * perMinute + bookingFee) *
    multiplier;

  if (total < 10) total = 10;

  const driverPayout = +(total * 0.72).toFixed(2);

  return {
    estimated_fare: +total.toFixed(2),
    driver_payout: driverPayout,
    breakdown: {
      base_fare: baseFare,
      per_mile: perMile,
      per_minute: perMinute,
      booking_fee: bookingFee,
      ride_type_multiplier: multiplier,
      distance_miles: +distanceMiles.toFixed(2),
      duration_minutes: +durationMinutes.toFixed(2)
    }
  };
}

function isExpiredAt(isoString) {
  if (!isoString) return false;
  return new Date(isoString).getTime() < Date.now();
}

/* =========================================================
   ADMIN AUTH HELPER
========================================================= */
function requireAdmin(req, res, next) {
  const email = req.headers["x-admin-email"];
  const password = req.headers["x-admin-password"];

  if (email === ADMIN_EMAIL && password === ADMIN_PASSWORD) {
    return next();
  }

  return res.status(401).json({
    ok: false,
    error: "Unauthorized admin request"
  });
}

/* =========================================================
   DB HELPERS
========================================================= */
async function getRiderById(riderId) {
  const { data, error } = await supabase
    .from("riders")
    .select("*")
    .eq("rider_id", riderId)
    .maybeSingle();

  if (error) return null;
  return data || null;
}

async function getDriverById(driverId) {
  const { data, error } = await supabase
    .from("drivers")
    .select("*")
    .eq("driver_id", driverId)
    .maybeSingle();

  if (error) return null;
  return data || null;
}

async function getRideById(rideId) {
  const { data, error } = await supabase
    .from("rides")
    .select("*")
    .eq("ride_id", rideId)
    .maybeSingle();

  if (error) return null;
  return data || null;
}

async function getMissionById(missionId) {
  const { data, error } = await supabase
    .from("missions")
    .select("*")
    .eq("mission_id", missionId)
    .maybeSingle();

  if (error) return null;
  return data || null;
}

async function getOpenDispatchByRideId(rideId) {
  const { data, error } = await supabase
    .from("dispatches")
    .select("*")
    .eq("ride_id", rideId)
    .in("status", ["pending", "offered"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return null;
  return data || null;
}

async function getDispatchForDriverRide(driverId, rideId) {
  const { data, error } = await supabase
    .from("dispatches")
    .select("*")
    .eq("driver_id", driverId)
    .eq("ride_id", rideId)
    .in("status", ["pending", "offered"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return null;
  return data || null;
}

async function getDispatchAttemptsForRide(rideId) {
  const { data, error } = await supabase
    .from("dispatches")
    .select("*")
    .eq("ride_id", rideId)
    .order("created_at", { ascending: true });

  if (error) return [];
  return data || [];
}

async function createAdminLog(action, payload = {}) {
  try {
    await supabase.from("admin_logs").insert([
      {
        log_id: generateId("log"),
        action,
        payload,
        created_at: now()
      }
    ]);
  } catch (error) {
    console.error("Admin log error:", error.message);
  }
}

async function findRiderByEmail(email) {
  const { data, error } = await supabase
    .from("riders")
    .select("*")
    .eq("email", String(email).toLowerCase().trim())
    .maybeSingle();

  if (error) return null;
  return data || null;
}

async function findDriverByEmail(email) {
  const { data, error } = await supabase
    .from("drivers")
    .select("*")
    .eq("email", String(email).toLowerCase().trim())
    .maybeSingle();

  if (error) return null;
  return data || null;
}

/* =========================================================
   HEALTH CHECK
========================================================= */
app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    service: "Harvey Taxi API",
    time: now()
  });
});

/* =========================================================
   BASIC PAGES
========================================================= */
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/request-ride", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "request-ride.html"));
});

app.get("/rider-signup", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "rider-signup.html"));
});

app.get("/driver-signup", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "driver-signup.html"));
});

app.get("/admin-dashboard", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin-dashboard.html"));
});

/* =========================================================
   ADMIN LOGIN
========================================================= */
app.post("/api/admin/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (email === ADMIN_EMAIL && password === ADMIN_PASSWORD) {
      await createAdminLog("admin_login_success", { email });
      return res.json({ ok: true, message: "Admin login successful" });
    }

    await createAdminLog("admin_login_failed", { email });
    return res.status(401).json({ ok: false, error: "Invalid admin credentials" });
  } catch (error) {
    return res.status(500).json({ ok: false, error: "Admin login failed" });
  }
});

/* =========================================================
   RIDER ROUTES
========================================================= */
app.post("/api/rider/signup", async (req, res) => {
  try {
    const missing = requireFields(req.body, [
      "firstName",
      "lastName",
      "email",
      "phone",
      "password"
    ]);
    if (missing) {
      return res.status(400).json({ ok: false, error: missing });
    }

    const email = String(req.body.email).toLowerCase().trim();
    const existingRider = await findRiderByEmail(email);
    if (existingRider) {
      return res.status(409).json({
        ok: false,
        error: "A rider account with this email already exists"
      });
    }

    const riderId = generateId("rider");

    const newRider = {
      rider_id: riderId,
      first_name: req.body.firstName,
      last_name: req.body.lastName,
      email,
      phone: req.body.phone,
      password: req.body.password,
      verification_status: "pending",
      is_approved: false,
      payment_authorized: false,
      created_at: now(),
      updated_at: now()
    };

    const { data, error } = await supabase
      .from("riders")
      .insert([newRider])
      .select()
      .single();

    if (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }

    await createAdminLog("rider_signup", { rider_id: riderId, email });

    return res.json({
      ok: true,
      message: "Rider signup successful",
      rider: data
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: "Rider signup failed" });
  }
});

app.post("/api/rider/login", async (req, res) => {
  try {
    const missing = requireFields(req.body, ["email", "password"]);
    if (missing) {
      return res.status(400).json({ ok: false, error: missing });
    }

    const email = String(req.body.email).toLowerCase().trim();
    const password = req.body.password;

    const { data, error } = await supabase
      .from("riders")
      .select("*")
      .eq("email", email)
      .eq("password", password)
      .maybeSingle();

    if (error || !data) {
      return res.status(401).json({ ok: false, error: "Invalid rider credentials" });
    }

    return res.json({
      ok: true,
      message: "Rider login successful",
      rider: data
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: "Rider login failed" });
  }
});

app.get("/api/riders", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("riders")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }

    return res.json({ ok: true, riders: data || [] });
  } catch (error) {
    return res.status(500).json({ ok: false, error: "Failed to fetch riders" });
  }
});

app.get("/api/riders/:riderId", async (req, res) => {
  try {
    const rider = await getRiderById(req.params.riderId);

    if (!rider) {
      return res.status(404).json({ ok: false, error: "Rider not found" });
    }

    return res.json({ ok: true, rider });
  } catch (error) {
    return res.status(500).json({ ok: false, error: "Failed to fetch rider" });
  }
});

app.post("/api/riders/:riderId/approve", requireAdmin, async (req, res) => {
  try {
    const riderId = req.params.riderId;
    const rider = await getRiderById(riderId);

    if (!rider) {
      return res.status(404).json({ ok: false, error: "Rider not found" });
    }

    const { data, error } = await supabase
      .from("riders")
      .update({
        verification_status: "approved",
        is_approved: true,
        updated_at: now()
      })
      .eq("rider_id", riderId)
      .select()
      .single();

    if (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }

    await createAdminLog("rider_approved", { rider_id: riderId });

    return res.json({
      ok: true,
      message: "Rider approved successfully",
      rider: data
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: "Failed to approve rider" });
  }
});

app.post("/api/riders/:riderId/reject", requireAdmin, async (req, res) => {
  try {
    const riderId = req.params.riderId;
    const rider = await getRiderById(riderId);

    if (!rider) {
      return res.status(404).json({ ok: false, error: "Rider not found" });
    }

    const { data, error } = await supabase
      .from("riders")
      .update({
        verification_status: "rejected",
        is_approved: false,
        updated_at: now()
      })
      .eq("rider_id", riderId)
      .select()
      .single();

    if (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }

    await createAdminLog("rider_rejected", {
      rider_id: riderId,
      reason: req.body.reason || null
    });

    return res.json({
      ok: true,
      message: "Rider rejected successfully",
      rider: data
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: "Failed to reject rider" });
  }
});

/* =========================================================
   DRIVER ROUTES
========================================================= */
app.post("/api/driver/signup", async (req, res) => {
  try {
    const missing = requireFields(req.body, [
      "firstName",
      "lastName",
      "email",
      "phone",
      "password",
      "vehicleMake",
      "vehicleModel",
      "vehicleColor",
      "plateNumber"
    ]);
    if (missing) {
      return res.status(400).json({ ok: false, error: missing });
    }

    const email = String(req.body.email).toLowerCase().trim();
    const existingDriver = await findDriverByEmail(email);
    if (existingDriver) {
      return res.status(409).json({
        ok: false,
        error: "A driver account with this email already exists"
      });
    }

    const driverId = generateId("driver");

    const newDriver = {
      driver_id: driverId,
      first_name: req.body.firstName,
      last_name: req.body.lastName,
      email,
      phone: req.body.phone,
      password: req.body.password,
      vehicle_make: req.body.vehicleMake,
      vehicle_model: req.body.vehicleModel,
      vehicle_color: req.body.vehicleColor,
      plate_number: req.body.plateNumber,
      verification_status: "pending",
      background_check_status: "pending",
      is_approved: false,
      availability: "offline",
      active_ride_id: null,
      created_at: now(),
      updated_at: now()
    };

    const { data, error } = await supabase
      .from("drivers")
      .insert([newDriver])
      .select()
      .single();

    if (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }

    await createAdminLog("driver_signup", { driver_id: driverId, email });

    return res.json({
      ok: true,
      message: "Driver signup successful",
      driver: data
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: "Driver signup failed" });
  }
});

app.post("/api/driver/login", async (req, res) => {
  try {
    const missing = requireFields(req.body, ["email", "password"]);
    if (missing) {
      return res.status(400).json({ ok: false, error: missing });
    }

    const email = String(req.body.email).toLowerCase().trim();
    const password = req.body.password;

    const { data, error } = await supabase
      .from("drivers")
      .select("*")
      .eq("email", email)
      .eq("password", password)
      .maybeSingle();

    if (error || !data) {
      return res.status(401).json({ ok: false, error: "Invalid driver credentials" });
    }

    return res.json({
      ok: true,
      message: "Driver login successful",
      driver: data
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: "Driver login failed" });
  }
});

app.get("/api/drivers", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("drivers")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }

    return res.json({ ok: true, drivers: data || [] });
  } catch (error) {
    return res.status(500).json({ ok: false, error: "Failed to fetch drivers" });
  }
});

app.get("/api/drivers/available", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("drivers")
      .select("*")
      .eq("is_approved", true)
      .eq("availability", "available")
      .is("active_ride_id", null)
      .order("updated_at", { ascending: true });

    if (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }

    return res.json({ ok: true, drivers: data || [] });
  } catch (error) {
    return res.status(500).json({ ok: false, error: "Failed to fetch available drivers" });
  }
});

app.post("/api/drivers/:driverId/approve", requireAdmin, async (req, res) => {
  try {
    const driverId = req.params.driverId;
    const driver = await getDriverById(driverId);

    if (!driver) {
      return res.status(404).json({ ok: false, error: "Driver not found" });
    }

    const { data, error } = await supabase
      .from("drivers")
      .update({
        verification_status: "approved",
        background_check_status: "approved",
        is_approved: true,
        updated_at: now()
      })
      .eq("driver_id", driverId)
      .select()
      .single();

    if (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }

    await createAdminLog("driver_approved", { driver_id: driverId });

    return res.json({
      ok: true,
      message: "Driver approved successfully",
      driver: data
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: "Failed to approve driver" });
  }
});

app.post("/api/drivers/:driverId/reject", requireAdmin, async (req, res) => {
  try {
    const driverId = req.params.driverId;
    const driver = await getDriverById(driverId);

    if (!driver) {
      return res.status(404).json({ ok: false, error: "Driver not found" });
    }

    const { data, error } = await supabase
      .from("drivers")
      .update({
        verification_status: "rejected",
        background_check_status: "rejected",
        is_approved: false,
        availability: "offline",
        updated_at: now()
      })
      .eq("driver_id", driverId)
      .select()
      .single();

    if (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }

    await createAdminLog("driver_rejected", {
      driver_id: driverId,
      reason: req.body.reason || null
    });

    return res.json({
      ok: true,
      message: "Driver rejected successfully",
      driver: data
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: "Failed to reject driver" });
  }
});

app.post("/api/driver/:driverId/availability", async (req, res) => {
  try {
    const driverId = req.params.driverId;
    const driver = await getDriverById(driverId);

    if (!driver) {
      return res.status(404).json({ ok: false, error: "Driver not found" });
    }

    if (!driver.is_approved) {
      return res.status(403).json({
        ok: false,
        error: "Driver must be approved before changing availability"
      });
    }

    if (driver.active_ride_id && req.body.availability === "available") {
      return res.status(409).json({
        ok: false,
        error: "Driver cannot become available while assigned to an active ride"
      });
    }

    const availability = normalizeAvailability(req.body.availability);

    const { data, error } = await supabase
      .from("drivers")
      .update({
        availability,
        updated_at: now()
      })
      .eq("driver_id", driverId)
      .select()
      .single();

    if (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }

    return res.json({
      ok: true,
      message: "Driver availability updated",
      driver: data
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: "Failed to update availability" });
  }
});

/* =========================================================
   MAP / ETA / PRICING HELPERS
========================================================= */
async function geocodeAddress(address) {
  if (!GOOGLE_MAPS_API_KEY || !address) {
    return {
      formatted_address: address || "",
      lat: null,
      lng: null
    };
  }

  try {
    const url =
      "https://maps.googleapis.com/maps/api/geocode/json?address=" +
      encodeURIComponent(address) +
      "&key=" +
      GOOGLE_MAPS_API_KEY;

    const response = await fetch(url);
    const data = await response.json();

    if (!data.results || !data.results.length) {
      return {
        formatted_address: address,
        lat: null,
        lng: null
      };
    }

    const result = data.results[0];
    return {
      formatted_address: result.formatted_address || address,
      lat: result.geometry?.location?.lat ?? null,
      lng: result.geometry?.location?.lng ?? null
    };
  } catch (error) {
    return {
      formatted_address: address,
      lat: null,
      lng: null
    };
  }
}

async function getDistanceAndDuration(originAddress, destinationAddress) {
  if (!GOOGLE_MAPS_API_KEY || !originAddress || !destinationAddress) {
    return {
      distance_miles: 5,
      duration_minutes: 15
    };
  }

  try {
    const url =
      "https://maps.googleapis.com/maps/api/distancematrix/json?origins=" +
      encodeURIComponent(originAddress) +
      "&destinations=" +
      encodeURIComponent(destinationAddress) +
      "&units=imperial&key=" +
      GOOGLE_MAPS_API_KEY;

    const response = await fetch(url);
    const data = await response.json();

    const element = data?.rows?.[0]?.elements?.[0];
    if (!element || element.status !== "OK") {
      return {
        distance_miles: 5,
        duration_minutes: 15
      };
    }

    const meters = safeNumber(element.distance?.value, 8046.72);
    const seconds = safeNumber(element.duration?.value, 900);

    return {
      distance_miles: +(meters / 1609.34).toFixed(2),
      duration_minutes: +(seconds / 60).toFixed(2)
    };
  } catch (error) {
    return {
      distance_miles: 5,
      duration_minutes: 15
    };
  }
}

/* =========================================================
   PAYMENTS
========================================================= */
app.post("/api/payments/authorize", async (req, res) => {
  try {
    const missing = requireFields(req.body, ["riderId", "paymentMethod"]);
    if (missing) {
      return res.status(400).json({ ok: false, error: missing });
    }

    const rider = await getRiderById(req.body.riderId);
    if (!rider) {
      return res.status(404).json({ ok: false, error: "Rider not found" });
    }

    if (!rider.is_approved || rider.verification_status !== "approved") {
      return res.status(403).json({
        ok: false,
        error: "Rider must be approved before payment authorization"
      });
    }

    const paymentId = generateId("payment");

    const paymentRecord = {
      payment_id: paymentId,
      rider_id: rider.rider_id,
      payment_method: req.body.paymentMethod,
      status: "authorized",
      amount: safeNumber(req.body.amount, 0),
      created_at: now()
    };

    const { error: paymentError } = await supabase
      .from("payments")
      .insert([paymentRecord]);

    if (paymentError) {
      return res.status(500).json({ ok: false, error: paymentError.message });
    }

    const { error: riderUpdateError } = await supabase
      .from("riders")
      .update({
        payment_authorized: true,
        updated_at: now()
      })
      .eq("rider_id", rider.rider_id);

    if (riderUpdateError) {
      return res.status(500).json({ ok: false, error: riderUpdateError.message });
    }

    await createAdminLog("payment_authorized", {
      rider_id: rider.rider_id,
      payment_id: paymentId
    });

    return res.json({
      ok: true,
      message: "Payment authorized successfully",
      payment: paymentRecord
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: "Payment authorization failed" });
  }
});

/* =========================================================
   FARE ESTIMATE
========================================================= */
app.post("/api/fare-estimate", async (req, res) => {
  try {
    const missing = requireFields(req.body, ["pickupAddress", "dropoffAddress"]);
    if (missing) {
      return res.status(400).json({ ok: false, error: missing });
    }

    const rideType = normalizeRideType(req.body.rideType);
    const requestedMode = normalizeRequestedMode(req.body.requestedMode);

    const metrics = await getDistanceAndDuration(
      req.body.pickupAddress,
      req.body.dropoffAddress
    );

    const fare = calculateFare({
      distanceMiles: metrics.distance_miles,
      durationMinutes: metrics.duration_minutes,
      rideType
    });

    return res.json({
      ok: true,
      pickup_address: req.body.pickupAddress,
      dropoff_address: req.body.dropoffAddress,
      ride_type: rideType,
      requested_mode: requestedMode,
      ...fare
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: "Failed to estimate fare" });
  }
});

/* =========================================================
   DISPATCH BRAIN
========================================================= */
async function getCandidateDrivers() {
  const { data, error } = await supabase
    .from("drivers")
    .select("*")
    .eq("is_approved", true)
    .eq("availability", "available")
    .is("active_ride_id", null)
    .order("updated_at", { ascending: true });

  if (error) return [];
  return data || [];
}

async function buildMissionPackage(ride, driver) {
  return {
    mission_id: generateId("mission"),
    ride_id: ride.ride_id,
    driver_id: driver.driver_id,
    rider_id: ride.rider_id,
    mission_status: "offered",
    trip_summary: {
      pickup_address: ride.pickup_address,
      dropoff_address: ride.dropoff_address,
      ride_type: ride.ride_type,
      requested_mode: ride.requested_mode || "driver",
      scheduled_time: ride.scheduled_time,
      notes: ride.notes || ""
    },
    payout: {
      estimated_fare: ride.estimated_fare,
      driver_payout: ride.driver_payout
    },
    route_highlights: {
      estimated_distance_miles: ride.estimated_distance_miles,
      estimated_duration_minutes: ride.estimated_duration_minutes
    },
    offered_at: now(),
    expires_at: new Date(Date.now() + DISPATCH_OFFER_TIMEOUT_MS).toISOString(),
    created_at: now()
  };
}

async function expireDispatchIfNeeded(dispatch) {
  if (!dispatch) return null;
  if (!isExpiredAt(dispatch.expires_at)) return dispatch;

  await supabase
    .from("dispatches")
    .update({
      status: "expired",
      updated_at: now()
    })
    .eq("dispatch_id", dispatch.dispatch_id);

  if (dispatch.mission_id) {
    await supabase
      .from("missions")
      .update({
        mission_status: "expired"
      })
      .eq("mission_id", dispatch.mission_id);
  }

  return null;
}

async function dispatchRideToNextDriver(rideId) {
  const ride = await getRideById(rideId);
  if (!ride) {
    return { ok: false, error: "Ride not found" };
  }

  if (ride.requested_mode === "autonomous") {
    await supabase
      .from("rides")
      .update({
        status: "autonomous_queue",
        updated_at: now()
      })
      .eq("ride_id", rideId);

    await createAdminLog("autonomous_ride_queued", { ride_id: rideId });

    return {
      ok: true,
      message: "Autonomous pilot ride queued",
      autonomous: true
    };
  }

  const attempts = await getDispatchAttemptsForRide(rideId);
  if (attempts.length >= MAX_DISPATCH_ATTEMPTS) {
    await supabase
      .from("rides")
      .update({
        status: "no_driver_found",
        updated_at: now()
      })
      .eq("ride_id", rideId);

    await createAdminLog("dispatch_max_attempts_reached", { ride_id: rideId });

    return {
      ok: false,
      error: "Maximum dispatch attempts reached"
    };
  }

  const previouslyTried = new Set(attempts.map((a) => a.driver_id));
  const candidates = await getCandidateDrivers();
  const nextDriver = candidates.find((d) => !previouslyTried.has(d.driver_id));

  if (!nextDriver) {
    await supabase
      .from("rides")
      .update({
        status: "no_driver_found",
        updated_at: now()
      })
      .eq("ride_id", rideId);

    await createAdminLog("dispatch_no_driver_found", { ride_id: rideId });

    return {
      ok: false,
      error: "No available drivers found"
    };
  }

  const dispatchId = generateId("dispatch");
  const mission = await buildMissionPackage(ride, nextDriver);

  const { error: missionError } = await supabase
    .from("missions")
    .insert([mission]);

  if (missionError) {
    return { ok: false, error: missionError.message };
  }

  const { data: dispatch, error: dispatchError } = await supabase
    .from("dispatches")
    .insert([
      {
        dispatch_id: dispatchId,
        ride_id: ride.ride_id,
        driver_id: nextDriver.driver_id,
        mission_id: mission.mission_id,
        status: "offered",
        attempt_number: attempts.length + 1,
        created_at: now(),
        updated_at: now(),
        expires_at: mission.expires_at
      }
    ])
    .select()
    .single();

  if (dispatchError) {
    return { ok: false, error: dispatchError.message };
  }

  await supabase
    .from("rides")
    .update({
      status: "driver_offered",
      updated_at: now()
    })
    .eq("ride_id", ride.ride_id);

  await createAdminLog("dispatch_offered", {
    ride_id: ride.ride_id,
    driver_id: nextDriver.driver_id,
    dispatch_id: dispatchId
  });

  return {
    ok: true,
    message: "Ride offered to next driver",
    dispatch,
    mission
  };
}

/* =========================================================
   RIDE REQUEST
========================================================= */
app.post("/api/request-ride", async (req, res) => {
  try {
    const missing = requireFields(req.body, [
      "riderId",
      "pickupAddress",
      "dropoffAddress"
    ]);

    if (missing) {
      return res.status(400).json({ ok: false, error: missing });
    }

    const rider = await getRiderById(req.body.riderId);
    if (!rider) {
      return res.status(404).json({ ok: false, error: "Rider not found" });
    }

    if (!rider.is_approved || rider.verification_status !== "approved") {
      return res.status(403).json({
        ok: false,
        error: "Rider must be verified and approved before requesting a ride"
      });
    }

    if (!rider.payment_authorized) {
      return res.status(403).json({
        ok: false,
        error: "Payment authorization is required before dispatch"
      });
    }

    const rideType = normalizeRideType(req.body.rideType);
    const requestedMode = normalizeRequestedMode(req.body.requestedMode);

    const pickupGeo = await geocodeAddress(req.body.pickupAddress);
    const dropoffGeo = await geocodeAddress(req.body.dropoffAddress);

    const metrics = await getDistanceAndDuration(
      pickupGeo.formatted_address,
      dropoffGeo.formatted_address
    );

    const fare = calculateFare({
      distanceMiles: metrics.distance_miles,
      durationMinutes: metrics.duration_minutes,
      rideType
    });

    const rideId = generateId("ride");

    const ride = {
      ride_id: rideId,
      rider_id: rider.rider_id,
      driver_id: null,
      status: requestedMode === "autonomous" ? "autonomous_queue" : "searching_driver",
      ride_type: rideType,
      requested_mode: requestedMode,
      pickup_address: pickupGeo.formatted_address,
      dropoff_address: dropoffGeo.formatted_address,
      scheduled_time: req.body.scheduledTime || null,
      notes: req.body.notes || "",
      payment_method: req.body.paymentMethod || "card",
      estimated_fare: fare.estimated_fare,
      driver_payout: fare.driver_payout,
      estimated_distance_miles: metrics.distance_miles,
      estimated_duration_minutes: metrics.duration_minutes,
      created_at: now(),
      updated_at: now()
    };

    const { data, error } = await supabase
      .from("rides")
      .insert([ride])
      .select()
      .single();

    if (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }

    await createAdminLog("ride_requested", {
      ride_id: rideId,
      rider_id: rider.rider_id,
      requested_mode: requestedMode
    });

    const dispatchResult = await dispatchRideToNextDriver(rideId);

    return res.json({
      ok: true,
      message:
        requestedMode === "autonomous"
          ? "Autonomous pilot request submitted"
          : "Ride request submitted",
      ride: data,
      dispatch: dispatchResult
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: "Ride request failed" });
  }
});

/* =========================================================
   RIDES / TRIPS
========================================================= */
app.get("/api/rides", async (req, res) => {
  try {
    const { riderId, driverId, status, requestedMode } = req.query;

    let query = supabase
      .from("rides")
      .select("*")
      .order("created_at", { ascending: false });

    if (riderId) query = query.eq("rider_id", riderId);
    if (driverId) query = query.eq("driver_id", driverId);
    if (status) query = query.eq("status", String(status).toLowerCase());
    if (requestedMode) query = query.eq("requested_mode", normalizeRequestedMode(requestedMode));

    const { data, error } = await query;

    if (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }

    return res.json({ ok: true, rides: data || [] });
  } catch (error) {
    return res.status(500).json({ ok: false, error: "Failed to fetch rides" });
  }
});

app.get("/api/rides/:rideId", async (req, res) => {
  try {
    const ride = await getRideById(req.params.rideId);

    if (!ride) {
      return res.status(404).json({ ok: false, error: "Ride not found" });
    }

    return res.json({ ok: true, ride });
  } catch (error) {
    return res.status(500).json({ ok: false, error: "Failed to fetch ride" });
  }
});

app.post("/api/rides/:rideId/start", async (req, res) => {
  try {
    const rideId = req.params.rideId;
    const ride = await getRideById(rideId);

    if (!ride) {
      return res.status(404).json({ ok: false, error: "Ride not found" });
    }

    if (!["driver_assigned", "autonomous_assigned"].includes(ride.status)) {
      return res.status(409).json({
        ok: false,
        error: "Ride cannot be started from the current status"
      });
    }

    const { data, error } = await supabase
      .from("rides")
      .update({
        status: "in_progress",
        started_at: now(),
        updated_at: now()
      })
      .eq("ride_id", rideId)
      .select()
      .single();

    if (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }

    await createAdminLog("ride_started", { ride_id: rideId });

    return res.json({ ok: true, message: "Ride started", ride: data });
  } catch (error) {
    return res.status(500).json({ ok: false, error: "Failed to start ride" });
  }
});

app.post("/api/rides/:rideId/complete", async (req, res) => {
  try {
    const rideId = req.params.rideId;
    const ride = await getRideById(rideId);

    if (!ride) {
      return res.status(404).json({ ok: false, error: "Ride not found" });
    }

    const { data, error } = await supabase
      .from("rides")
      .update({
        status: "completed",
        completed_at: now(),
        updated_at: now()
      })
      .eq("ride_id", rideId)
      .select()
      .single();

    if (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }

    if (ride.driver_id) {
      await supabase
        .from("drivers")
        .update({
          availability: "available",
          active_ride_id: null,
          updated_at: now()
        })
        .eq("driver_id", ride.driver_id);
    }

    await createAdminLog("ride_completed", { ride_id: rideId });

    return res.json({ ok: true, message: "Ride completed", ride: data });
  } catch (error) {
    return res.status(500).json({ ok: false, error: "Failed to complete ride" });
  }
});

app.post("/api/rides/:rideId/cancel", async (req, res) => {
  try {
    const rideId = req.params.rideId;
    const ride = await getRideById(rideId);

    if (!ride) {
      return res.status(404).json({ ok: false, error: "Ride not found" });
    }

    const { data, error } = await supabase
      .from("rides")
      .update({
        status: "cancelled",
        cancelled_at: now(),
        cancel_reason: req.body.reason || null,
        updated_at: now()
      })
      .eq("ride_id", rideId)
      .select()
      .single();

    if (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }

    if (ride.driver_id) {
      await supabase
        .from("drivers")
        .update({
          availability: "available",
          active_ride_id: null,
          updated_at: now()
        })
        .eq("driver_id", ride.driver_id);
    }

    await supabase
      .from("dispatches")
      .update({
        status: "cancelled",
        updated_at: now()
      })
      .eq("ride_id", rideId)
      .in("status", ["pending", "offered"]);

    await supabase
      .from("missions")
      .update({
        mission_status: "cancelled"
      })
      .eq("ride_id", rideId)
      .in("mission_status", ["offered", "accepted"]);

    await createAdminLog("ride_cancelled", {
      ride_id: rideId,
      reason: req.body.reason || null
    });

    return res.json({ ok: true, message: "Ride cancelled", ride: data });
  } catch (error) {
    return res.status(500).json({ ok: false, error: "Failed to cancel ride" });
  }
});

/* =========================================================
   DRIVER MISSIONS / ACCEPT / DECLINE
========================================================= */
app.get("/api/driver/:driverId/missions", async (req, res) => {
  try {
    const driverId = req.params.driverId;

    const { data, error } = await supabase
      .from("missions")
      .select("*")
      .eq("driver_id", driverId)
      .in("mission_status", ["offered", "accepted"])
      .order("created_at", { ascending: false });

    if (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }

    const filtered = [];
    for (const mission of data || []) {
      const dispatch = await getDispatchForDriverRide(driverId, mission.ride_id);
      if (dispatch) {
        const stillOpen = await expireDispatchIfNeeded(dispatch);
        if (stillOpen) filtered.push(mission);
      } else if (mission.mission_status === "accepted") {
        filtered.push(mission);
      }
    }

    return res.json({ ok: true, missions: filtered });
  } catch (error) {
    return res.status(500).json({ ok: false, error: "Failed to fetch missions" });
  }
});

app.post("/api/driver/:driverId/accept-ride", async (req, res) => {
  try {
    const driverId = req.params.driverId;
    const missing = requireFields(req.body, ["rideId"]);
    if (missing) {
      return res.status(400).json({ ok: false, error: missing });
    }

    const driver = await getDriverById(driverId);
    if (!driver) {
      return res.status(404).json({ ok: false, error: "Driver not found" });
    }

    if (!driver.is_approved) {
      return res.status(403).json({ ok: false, error: "Driver is not approved" });
    }

    if (driver.active_ride_id) {
      return res.status(409).json({
        ok: false,
        error: "Driver already has an active ride"
      });
    }

    const ride = await getRideById(req.body.rideId);
    if (!ride) {
      return res.status(404).json({ ok: false, error: "Ride not found" });
    }

    if (ride.requested_mode !== "driver") {
      return res.status(409).json({
        ok: false,
        error: "This ride is not a driver-dispatch mission"
      });
    }

    if (ride.driver_id) {
      return res.status(409).json({
        ok: false,
        error: "Ride has already been assigned"
      });
    }

    const openDispatch = await getDispatchForDriverRide(driverId, ride.ride_id);
    if (!openDispatch) {
      return res.status(404).json({ ok: false, error: "No active dispatch found" });
    }

    const stillOpenDispatch = await expireDispatchIfNeeded(openDispatch);
    if (!stillOpenDispatch) {
      const nextDispatch = await dispatchRideToNextDriver(ride.ride_id);
      return res.status(409).json({
        ok: false,
        error: "Dispatch offer expired",
        next_dispatch: nextDispatch
      });
    }

    const { error: rideUpdateError } = await supabase
      .from("rides")
      .update({
        driver_id: driverId,
        status: "driver_assigned",
        accepted_at: now(),
        updated_at: now()
      })
      .eq("ride_id", ride.ride_id)
      .is("driver_id", null);

    if (rideUpdateError) {
      return res.status(500).json({ ok: false, error: rideUpdateError.message });
    }

    await supabase
      .from("drivers")
      .update({
        availability: "busy",
        active_ride_id: ride.ride_id,
        updated_at: now()
      })
      .eq("driver_id", driverId);

    await supabase
      .from("dispatches")
      .update({
        status: "accepted",
        updated_at: now()
      })
      .eq("dispatch_id", stillOpenDispatch.dispatch_id);

    await supabase
      .from("missions")
      .update({
        mission_status: "accepted"
      })
      .eq("mission_id", stillOpenDispatch.mission_id);

    await supabase
      .from("dispatches")
      .update({
        status: "closed",
        updated_at: now()
      })
      .eq("ride_id", ride.ride_id)
      .neq("dispatch_id", stillOpenDispatch.dispatch_id)
      .in("status", ["pending", "offered"]);

    await supabase
      .from("missions")
      .update({
        mission_status: "closed"
      })
      .eq("ride_id", ride.ride_id)
      .neq("mission_id", stillOpenDispatch.mission_id)
      .in("mission_status", ["offered"]);

    await createAdminLog("ride_accepted", {
      ride_id: ride.ride_id,
      driver_id: driverId
    });

    const updatedRide = await getRideById(ride.ride_id);

    return res.json({
      ok: true,
      message: "Ride accepted successfully",
      ride: updatedRide
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: "Failed to accept ride" });
  }
});

app.post("/api/driver/:driverId/decline-ride", async (req, res) => {
  try {
    const driverId = req.params.driverId;
    const missing = requireFields(req.body, ["rideId"]);
    if (missing) {
      return res.status(400).json({ ok: false, error: missing });
    }

    const ride = await getRideById(req.body.rideId);
    if (!ride) {
      return res.status(404).json({ ok: false, error: "Ride not found" });
    }

    const openDispatch = await getDispatchForDriverRide(driverId, ride.ride_id);
    if (!openDispatch) {
      return res.status(404).json({
        ok: false,
        error: "Active dispatch not found for driver"
      });
    }

    await supabase
      .from("dispatches")
      .update({
        status: "declined",
        updated_at: now()
      })
      .eq("dispatch_id", openDispatch.dispatch_id);

    await supabase
      .from("missions")
      .update({
        mission_status: "declined"
      })
      .eq("mission_id", openDispatch.mission_id);

    await createAdminLog("ride_declined", {
      ride_id: ride.ride_id,
      driver_id: driverId
    });

    const nextDispatch = await dispatchRideToNextDriver(ride.ride_id);

    return res.json({
      ok: true,
      message: "Ride declined, dispatch moved to next driver",
      dispatch: nextDispatch
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: "Failed to decline ride" });
  }
});

/* =========================================================
   AUTONOMOUS PILOT ADMIN ROUTES
========================================================= */
app.post("/api/admin/rides/:rideId/assign-autonomous", requireAdmin, async (req, res) => {
  try {
    const rideId = req.params.rideId;
    const ride = await getRideById(rideId);

    if (!ride) {
      return res.status(404).json({ ok: false, error: "Ride not found" });
    }

    if (ride.requested_mode !== "autonomous") {
      return res.status(409).json({
        ok: false,
        error: "Ride is not marked for autonomous mode"
      });
    }

    const vehicleName = req.body.vehicleName || "Harvey AV Pilot Unit 1";

    const { data, error } = await supabase
      .from("rides")
      .update({
        status: "autonomous_assigned",
        autonomous_vehicle_name: vehicleName,
        accepted_at: now(),
        updated_at: now()
      })
      .eq("ride_id", rideId)
      .select()
      .single();

    if (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }

    await createAdminLog("autonomous_ride_assigned", {
      ride_id: rideId,
      autonomous_vehicle_name: vehicleName
    });

    return res.json({
      ok: true,
      message: "Autonomous pilot ride assigned",
      ride: data
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: "Failed to assign autonomous ride" });
  }
});

/* =========================================================
   ADMIN ANALYTICS
========================================================= */
app.get("/api/admin/analytics", requireAdmin, async (req, res) => {
  try {
    const [
      { count: ridersCount },
      { count: driversCount },
      { count: ridesCount },
      { count: autonomousCount },
      { count: completedCount }
    ] = await Promise.all([
      supabase.from("riders").select("*", { count: "exact", head: true }),
      supabase.from("drivers").select("*", { count: "exact", head: true }),
      supabase.from("rides").select("*", { count: "exact", head: true }),
      supabase
        .from("rides")
        .select("*", { count: "exact", head: true })
        .eq("requested_mode", "autonomous"),
      supabase
        .from("rides")
        .select("*", { count: "exact", head: true })
        .eq("status", "completed")
    ]);

    const { data: recentRides } = await supabase
      .from("rides")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(10);

    const { data: recentLogs } = await supabase
      .from("admin_logs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(20);

    return res.json({
      ok: true,
      analytics: {
        total_riders: ridersCount || 0,
        total_drivers: driversCount || 0,
        total_rides: ridesCount || 0,
        total_autonomous_requests: autonomousCount || 0,
        total_completed_rides: completedCount || 0,
        recent_rides: recentRides || [],
        recent_logs: recentLogs || []
      }
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: "Failed to load analytics" });
  }
});

/* =========================================================
   404 + SERVER START
========================================================= */
app.use((req, res) => {
  res.status(404).json({
    ok: false,
    error: "Route not found"
  });
});

app.listen(PORT, () => {
  console.log(`✅ Harvey Taxi server running on port ${PORT}`);
});

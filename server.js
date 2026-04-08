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
const BOOKING_FEE = 3.5;
const MINIMUM_FARE = 10;

/* =========================================================
   HELPERS
========================================================= */
function nowIso() {
  return new Date().toISOString();
}

function safeString(value = "") {
  return String(value || "").trim();
}

function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function calculateFare({
  distanceMiles = 0,
  durationMinutes = 0,
  rideType = "standard",
  requestedMode = "driver"
}) {
  const baseFare = requestedMode === "autonomous" ? 8 : 6;
  const perMile = requestedMode === "autonomous" ? 2.75 : 2.25;
  const perMinute = requestedMode === "autonomous" ? 0.45 : 0.35;

  let rideTypeMultiplier = 1;
  const normalizedRideType = safeString(rideType).toLowerCase();

  if (normalizedRideType === "airport") rideTypeMultiplier = 1.2;
  if (normalizedRideType === "scheduled") rideTypeMultiplier = 1.15;
  if (normalizedRideType === "medical") rideTypeMultiplier = 1.1;
  if (normalizedRideType === "nonprofit") rideTypeMultiplier = 0.95;

  const subtotal =
    (baseFare + distanceMiles * perMile + durationMinutes * perMinute) *
    rideTypeMultiplier;

  const total = Math.max(MINIMUM_FARE, subtotal + BOOKING_FEE);

  return {
    baseFare: Number(baseFare.toFixed(2)),
    perMile: Number(perMile.toFixed(2)),
    perMinute: Number(perMinute.toFixed(2)),
    distanceMiles: Number(distanceMiles.toFixed(2)),
    durationMinutes: Number(durationMinutes.toFixed(2)),
    bookingFee: Number(BOOKING_FEE.toFixed(2)),
    minimumFare: Number(MINIMUM_FARE.toFixed(2)),
    rideTypeMultiplier: Number(rideTypeMultiplier.toFixed(2)),
    estimatedTotal: Number(total.toFixed(2))
  };
}

function toRadians(value) {
  return (value * Math.PI) / 180;
}

function haversineMiles(lat1, lon1, lat2, lon2) {
  if (
    !Number.isFinite(lat1) ||
    !Number.isFinite(lon1) ||
    !Number.isFinite(lat2) ||
    !Number.isFinite(lon2)
  ) {
    return Number.POSITIVE_INFINITY;
  }

  const R = 3958.8;
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

async function geocodeAddress(address) {
  const cleanAddress = safeString(address);
  if (!cleanAddress) {
    return {
      success: false,
      message: "Address is required for geocoding."
    };
  }

  if (!GOOGLE_MAPS_API_KEY) {
    return {
      success: false,
      message: "GOOGLE_MAPS_API_KEY is missing."
    };
  }

  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(
    cleanAddress
  )}&key=${GOOGLE_MAPS_API_KEY}`;

  const response = await fetch(url);
  const data = await response.json();

  if (data.status !== "OK" || !data.results || !data.results.length) {
    return {
      success: false,
      message: "Unable to geocode address."
    };
  }

  const result = data.results[0];
  const location = result.geometry?.location || {};

  return {
    success: true,
    formattedAddress: result.formatted_address || cleanAddress,
    latitude: safeNumber(location.lat, null),
    longitude: safeNumber(location.lng, null)
  };
}

async function getDistanceAndDuration(pickupAddress, dropoffAddress) {
  const pickup = safeString(pickupAddress);
  const dropoff = safeString(dropoffAddress);

  if (!pickup || !dropoff) {
    return {
      success: false,
      message: "Pickup and dropoff are required."
    };
  }

  if (!GOOGLE_MAPS_API_KEY) {
    return {
      success: false,
      message: "GOOGLE_MAPS_API_KEY is missing."
    };
  }

  const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${encodeURIComponent(
    pickup
  )}&destinations=${encodeURIComponent(
    dropoff
  )}&units=imperial&key=${GOOGLE_MAPS_API_KEY}`;

  const response = await fetch(url);
  const data = await response.json();

  if (
    data.status !== "OK" ||
    !data.rows ||
    !data.rows[0] ||
    !data.rows[0].elements ||
    !data.rows[0].elements[0]
  ) {
    return {
      success: false,
      message: "Unable to calculate route."
    };
  }

  const element = data.rows[0].elements[0];

  if (element.status !== "OK") {
    return {
      success: false,
      message: "Route not available for these addresses."
    };
  }

  const distanceMeters = safeNumber(element.distance?.value, 0);
  const durationSeconds = safeNumber(element.duration?.value, 0);

  return {
    success: true,
    distanceMiles: distanceMeters / 1609.344,
    durationMinutes: durationSeconds / 60,
    pickupDisplay: data.origin_addresses?.[0] || pickup,
    dropoffDisplay: data.destination_addresses?.[0] || dropoff
  };
}

async function getRideById(rideId) {
  const { data, error } = await supabase
    .from("rides")
    .select("*")
    .eq("id", rideId)
    .single();

  if (error) throw error;
  return data;
}

async function createDispatchRecord(ride, driver, attemptNumber) {
  const payload = {
    ride_id: ride.id,
    driver_id: driver.id,
    attempt_number: attemptNumber,
    status: "offered",
    requested_mode: ride.requested_mode || "driver",
    created_at: nowIso(),
    expires_at: new Date(Date.now() + DISPATCH_OFFER_TIMEOUT_MS).toISOString()
  };

  const { data, error } = await supabase
    .from("dispatches")
    .insert(payload)
    .select()
    .single();

  if (error) throw error;
  return data;
}

async function assignRideToDriver(rideId, driverId, dispatchId, attemptNumber) {
  const { data, error } = await supabase
    .from("rides")
    .update({
      driver_id: driverId,
      dispatch_id: dispatchId,
      dispatch_attempts: attemptNumber,
      status: "awaiting_driver_acceptance",
      assigned_at: nowIso(),
      updated_at: nowIso()
    })
    .eq("id", rideId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

async function getAvailableDrivers(requestedMode = "driver") {
  let query = supabase
    .from("drivers")
    .select("*")
    .eq("approved", true)
    .eq("status", "available");

  if (requestedMode === "autonomous") {
    query = query.eq("driver_type", "autonomous");
  } else {
    query = query.neq("driver_type", "autonomous");
  }

  const { data, error } = await query;
  if (error) throw error;

  return data || [];
}

function rankDriversByProximity(drivers, pickupGeo) {
  if (!pickupGeo || !pickupGeo.success) return drivers;

  const pickupLat = safeNumber(pickupGeo.latitude, null);
  const pickupLng = safeNumber(pickupGeo.longitude, null);

  return [...drivers].sort((a, b) => {
    const aLat = safeNumber(a.latitude, null);
    const aLng = safeNumber(a.longitude, null);
    const bLat = safeNumber(b.latitude, null);
    const bLng = safeNumber(b.longitude, null);

    const aDistance = haversineMiles(aLat, aLng, pickupLat, pickupLng);
    const bDistance = haversineMiles(bLat, bLng, pickupLat, pickupLng);

    return aDistance - bDistance;
  });
}

async function dispatchRide(rideId) {
  try {
    const ride = await getRideById(rideId);

    if (!ride) {
      return { success: false, message: "Ride not found." };
    }

    if (ride.status === "cancelled" || ride.status === "completed") {
      return { success: false, message: "Ride is not dispatchable." };
    }

    const currentAttempts = safeNumber(ride.dispatch_attempts, 0);

    if (currentAttempts >= MAX_DISPATCH_ATTEMPTS) {
      await supabase
        .from("rides")
        .update({
          status: "no_driver_available",
          updated_at: nowIso()
        })
        .eq("id", ride.id);

      return {
        success: false,
        message: "Max dispatch attempts reached."
      };
    }

    const pickupGeo = await geocodeAddress(ride.pickup_address);
    const availableDrivers = await getAvailableDrivers(
      ride.requested_mode || "driver"
    );

    if (!availableDrivers.length) {
      await supabase
        .from("rides")
        .update({
          status: "no_driver_available",
          updated_at: nowIso()
        })
        .eq("id", ride.id);

      return {
        success: false,
        message: "No drivers available."
      };
    }

    const rankedDrivers = rankDriversByProximity(availableDrivers, pickupGeo);
    const selectedDriver = rankedDrivers[0];
    const attemptNumber = currentAttempts + 1;

    const dispatch = await createDispatchRecord(ride, selectedDriver, attemptNumber);
    const updatedRide = await assignRideToDriver(
      ride.id,
      selectedDriver.id,
      dispatch.id,
      attemptNumber
    );

    return {
      success: true,
      message: "Driver dispatch started.",
      ride: updatedRide,
      driver: {
        id: selectedDriver.id,
        first_name: selectedDriver.first_name || "",
        last_name: selectedDriver.last_name || "",
        vehicle_make: selectedDriver.vehicle_make || "",
        vehicle_model: selectedDriver.vehicle_model || ""
      },
      dispatch
    };
  } catch (error) {
    console.error("❌ dispatchRide error:", error);
    return {
      success: false,
      message: "Dispatch failed.",
      error: error.message
    };
  }
}

async function recordMissionForRide(ride) {
  try {
    const missionPayload = {
      ride_id: ride.id,
      rider_id: ride.rider_id,
      driver_id: ride.driver_id || null,
      requested_mode: ride.requested_mode || "driver",
      ride_type: ride.ride_type || "standard",
      pickup_address: ride.pickup_address,
      dropoff_address: ride.dropoff_address,
      notes: ride.notes || "",
      payout_estimate: ride.estimated_fare || 0,
      mission_status: ride.status || "requested",
      created_at: nowIso(),
      updated_at: nowIso()
    };

    await supabase.from("missions").insert(missionPayload);
  } catch (error) {
    console.error("⚠️ Mission insert skipped:", error.message);
  }
}

/* =========================================================
   HEALTH / ROOT
========================================================= */
app.get("/api/health", async (req, res) => {
  try {
    const { error } = await supabase.from("riders").select("id").limit(1);
    if (error) throw error;

    res.json({
      ok: true,
      app: "Harvey Taxi",
      database: "connected",
      timestamp: nowIso()
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      app: "Harvey Taxi",
      database: "disconnected",
      error: error.message
    });
  }
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

/* =========================================================
   ADMIN
========================================================= */
app.post("/api/admin/login", async (req, res) => {
  try {
    const email = safeString(req.body.email).toLowerCase();
    const password = safeString(req.body.password);

    if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
      return res.status(500).json({
        success: false,
        message: "Admin credentials not configured."
      });
    }

    if (
      email === safeString(ADMIN_EMAIL).toLowerCase() &&
      password === safeString(ADMIN_PASSWORD)
    ) {
      return res.json({
        success: true,
        message: "Admin login successful."
      });
    }

    return res.status(401).json({
      success: false,
      message: "Invalid admin credentials."
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Admin login failed.",
      error: error.message
    });
  }
});

/* =========================================================
   RIDERS
========================================================= */
app.post("/api/rider/signup", async (req, res) => {
  try {
    const payload = {
      first_name: safeString(req.body.first_name),
      last_name: safeString(req.body.last_name),
      email: safeString(req.body.email).toLowerCase(),
      phone: safeString(req.body.phone),
      city: safeString(req.body.city),
      state: safeString(req.body.state),
      verification_status: "pending",
      approved: false,
      created_at: nowIso(),
      updated_at: nowIso()
    };

    if (!payload.first_name || !payload.email || !payload.phone) {
      return res.status(400).json({
        success: false,
        message: "First name, email, and phone are required."
      });
    }

    const { data, error } = await supabase
      .from("riders")
      .insert(payload)
      .select()
      .single();

    if (error) throw error;

    res.json({
      success: true,
      message: "Rider signup submitted.",
      rider: data
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Rider signup failed.",
      error: error.message
    });
  }
});

app.get("/api/riders", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("riders")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) throw error;

    res.json({
      success: true,
      riders: data || []
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to load riders.",
      error: error.message
    });
  }
});

app.get("/api/riders/:riderId", async (req, res) => {
  try {
    const riderId = req.params.riderId;

    const { data, error } = await supabase
      .from("riders")
      .select("*")
      .eq("id", riderId)
      .single();

    if (error) throw error;

    res.json({
      success: true,
      rider: data
    });
  } catch (error) {
    res.status(404).json({
      success: false,
      message: "Rider not found.",
      error: error.message
    });
  }
});

/* =========================================================
   DRIVERS
========================================================= */
app.post("/api/driver/signup", async (req, res) => {
  try {
    const payload = {
      first_name: safeString(req.body.first_name),
      last_name: safeString(req.body.last_name),
      email: safeString(req.body.email).toLowerCase(),
      phone: safeString(req.body.phone),
      city: safeString(req.body.city),
      state: safeString(req.body.state),
      vehicle_make: safeString(req.body.vehicle_make),
      vehicle_model: safeString(req.body.vehicle_model),
      vehicle_year: safeString(req.body.vehicle_year),
      vehicle_color: safeString(req.body.vehicle_color),
      license_plate: safeString(req.body.license_plate),
      verification_status: "pending",
      background_check_status: "pending",
      approved: false,
      status: "offline",
      driver_type: safeString(req.body.driver_type || "human").toLowerCase(),
      latitude: null,
      longitude: null,
      created_at: nowIso(),
      updated_at: nowIso()
    };

    if (!payload.first_name || !payload.email || !payload.phone) {
      return res.status(400).json({
        success: false,
        message: "First name, email, and phone are required."
      });
    }

    const { data, error } = await supabase
      .from("drivers")
      .insert(payload)
      .select()
      .single();

    if (error) throw error;

    res.json({
      success: true,
      message: "Driver signup submitted.",
      driver: data
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Driver signup failed.",
      error: error.message
    });
  }
});

app.get("/api/drivers", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("drivers")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) throw error;

    res.json({
      success: true,
      drivers: data || []
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to load drivers.",
      error: error.message
    });
  }
});

app.get("/api/drivers/available", async (req, res) => {
  try {
    const requestedMode = safeString(req.query.requestedMode || "driver").toLowerCase();
    const drivers = await getAvailableDrivers(requestedMode);

    res.json({
      success: true,
      drivers
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to load available drivers.",
      error: error.message
    });
  }
});

app.post("/api/driver/:driverId/availability", async (req, res) => {
  try {
    const driverId = req.params.driverId;
    const status = safeString(req.body.status || "offline").toLowerCase();
    const latitude = req.body.latitude == null ? null : safeNumber(req.body.latitude, null);
    const longitude = req.body.longitude == null ? null : safeNumber(req.body.longitude, null);

    const allowedStatuses = ["available", "busy", "offline"];
    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid driver status."
      });
    }

    const updatePayload = {
      status,
      updated_at: nowIso()
    };

    if (latitude !== null) updatePayload.latitude = latitude;
    if (longitude !== null) updatePayload.longitude = longitude;

    const { data, error } = await supabase
      .from("drivers")
      .update(updatePayload)
      .eq("id", driverId)
      .select()
      .single();

    if (error) throw error;

    res.json({
      success: true,
      message: "Driver availability updated.",
      driver: data
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to update driver availability.",
      error: error.message
    });
  }
});

/* =========================================================
   PAYMENT
========================================================= */
app.post("/api/payments/authorize", async (req, res) => {
  try {
    const riderId = safeString(req.body.rider_id);
    const amount = safeNumber(req.body.amount, 0);
    const paymentMethod = safeString(req.body.payment_method || "card").toLowerCase();

    if (!riderId || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: "rider_id and valid amount are required."
      });
    }

    const paymentPayload = {
      rider_id: riderId,
      amount: Number(amount.toFixed(2)),
      payment_method: paymentMethod,
      status: "authorized",
      authorized_at: nowIso(),
      created_at: nowIso()
    };

    const { data, error } = await supabase
      .from("payments")
      .insert(paymentPayload)
      .select()
      .single();

    if (error) throw error;

    res.json({
      success: true,
      message: "Payment authorized.",
      payment: data
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Payment authorization failed.",
      error: error.message
    });
  }
});

/* =========================================================
   FARE ESTIMATE
========================================================= */
app.post("/api/fare-estimate", async (req, res) => {
  try {
    const pickupAddress = safeString(req.body.pickup_address || req.body.pickupAddress);
    const dropoffAddress = safeString(req.body.dropoff_address || req.body.dropoffAddress);
    const rideType = safeString(req.body.ride_type || req.body.rideType || "standard");
    const requestedMode = safeString(
      req.body.requested_mode || req.body.requestedMode || "driver"
    ).toLowerCase();

    if (!pickupAddress || !dropoffAddress) {
      return res.status(400).json({
        success: false,
        message: "Pickup and dropoff addresses are required."
      });
    }

    const route = await getDistanceAndDuration(pickupAddress, dropoffAddress);

    if (!route.success) {
      return res.status(400).json(route);
    }

    const fare = calculateFare({
      distanceMiles: route.distanceMiles,
      durationMinutes: route.durationMinutes,
      rideType,
      requestedMode
    });

    res.json({
      success: true,
      pickup_address: route.pickupDisplay,
      dropoff_address: route.dropoffDisplay,
      distance_miles: fare.distanceMiles,
      duration_minutes: fare.durationMinutes,
      ride_type: rideType,
      requested_mode: requestedMode,
      fare
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Fare estimate failed.",
      error: error.message
    });
  }
});

/* =========================================================
   REQUEST RIDE
========================================================= */
app.post("/api/request-ride", async (req, res) => {
  try {
    const riderId = safeString(req.body.rider_id);
    const pickupAddress = safeString(req.body.pickup_address);
    const dropoffAddress = safeString(req.body.dropoff_address);
    const rideType = safeString(req.body.ride_type || "standard").toLowerCase();
    const requestedMode = safeString(req.body.requested_mode || "driver").toLowerCase();
    const scheduledTime = req.body.scheduled_time || null;
    const notes = safeString(req.body.notes);
    const paymentMethod = safeString(req.body.payment_method || "card").toLowerCase();

    if (!riderId || !pickupAddress || !dropoffAddress) {
      return res.status(400).json({
        success: false,
        message: "rider_id, pickup_address, and dropoff_address are required."
      });
    }

    const { data: rider, error: riderError } = await supabase
      .from("riders")
      .select("*")
      .eq("id", riderId)
      .single();

    if (riderError || !rider) {
      return res.status(404).json({
        success: false,
        message: "Rider not found."
      });
    }

    const riderApproved =
      rider.approved === true ||
      safeString(rider.verification_status).toLowerCase() === "approved";

    if (!riderApproved) {
      return res.status(403).json({
        success: false,
        message: "Rider verification approval is required before requesting a ride."
      });
    }

    const route = await getDistanceAndDuration(pickupAddress, dropoffAddress);
    if (!route.success) {
      return res.status(400).json(route);
    }

    const fare = calculateFare({
      distanceMiles: route.distanceMiles,
      durationMinutes: route.durationMinutes,
      rideType,
      requestedMode
    });

    const { data: payment, error: paymentError } = await supabase
      .from("payments")
      .select("*")
      .eq("rider_id", riderId)
      .eq("status", "authorized")
      .order("authorized_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (paymentError) {
      return res.status(500).json({
        success: false,
        message: "Failed to verify payment authorization.",
        error: paymentError.message
      });
    }

    if (!payment) {
      return res.status(403).json({
        success: false,
        message: "Payment authorization is required before dispatch."
      });
    }

    const ridePayload = {
      rider_id: riderId,
      driver_id: null,
      dispatch_id: null,
      payment_id: payment.id,
      ride_type: rideType,
      requested_mode: requestedMode,
      pickup_address: route.pickupDisplay,
      dropoff_address: route.dropoffDisplay,
      scheduled_time: scheduledTime,
      notes,
      estimated_fare: fare.estimatedTotal,
      distance_miles: fare.distanceMiles,
      duration_minutes: fare.durationMinutes,
      status: "requested",
      dispatch_attempts: 0,
      payment_method: paymentMethod,
      created_at: nowIso(),
      updated_at: nowIso()
    };

    const { data: ride, error: rideError } = await supabase
      .from("rides")
      .insert(ridePayload)
      .select()
      .single();

    if (rideError) throw rideError;

    await recordMissionForRide(ride);
    const dispatchResult = await dispatchRide(ride.id);
    const refreshedRide = await getRideById(ride.id);

    res.json({
      success: true,
      message: dispatchResult.success
        ? "Ride created and dispatch started."
        : "Ride created, but dispatch is pending.",
      ride_id: refreshedRide.id,
      ride: refreshedRide,
      fare,
      dispatch: dispatchResult
    });
  } catch (error) {
    console.error("❌ /api/request-ride error:", error);
    res.status(500).json({
      success: false,
      message: "Ride request failed.",
      error: error.message
    });
  }
});

app.get("/api/rides", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("rides")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) throw error;

    res.json({
      success: true,
      rides: data || []
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to load rides.",
      error: error.message
    });
  }
});

app.get("/api/rides/:rideId", async (req, res) => {
  try {
    const ride = await getRideById(req.params.rideId);

    res.json({
      success: true,
      ride
    });
  } catch (error) {
    res.status(404).json({
      success: false,
      message: "Ride not found.",
      error: error.message
    });
  }
});

/* =========================================================
   DRIVER ACCEPT / REJECT / STATUS
========================================================= */
app.post("/api/driver/accept", async (req, res) => {
  try {
    const rideId = safeString(req.body.ride_id);
    const driverId = safeString(req.body.driver_id);

    if (!rideId || !driverId) {
      return res.status(400).json({
        success: false,
        message: "ride_id and driver_id are required."
      });
    }

    const { data: ride, error: rideError } = await supabase
      .from("rides")
      .select("*")
      .eq("id", rideId)
      .eq("driver_id", driverId)
      .single();

    if (rideError || !ride) {
      return res.status(404).json({
        success: false,
        message: "Assigned ride not found."
      });
    }

    const { data: updatedRide, error: updateRideError } = await supabase
      .from("rides")
      .update({
        status: "driver_enroute",
        accepted_at: nowIso(),
        updated_at: nowIso()
      })
      .eq("id", rideId)
      .eq("driver_id", driverId)
      .select()
      .single();

    if (updateRideError) throw updateRideError;

    await supabase
      .from("drivers")
      .update({
        status: "busy",
        updated_at: nowIso()
      })
      .eq("id", driverId);

    if (ride.dispatch_id) {
      await supabase
        .from("dispatches")
        .update({
          status: "accepted",
          responded_at: nowIso()
        })
        .eq("id", ride.dispatch_id);
    }

    await supabase
      .from("missions")
      .update({
        driver_id: driverId,
        mission_status: "driver_enroute",
        updated_at: nowIso()
      })
      .eq("ride_id", rideId);

    res.json({
      success: true,
      message: "Ride accepted.",
      ride: updatedRide
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Driver accept failed.",
      error: error.message
    });
  }
});

app.post("/api/driver/reject", async (req, res) => {
  try {
    const rideId = safeString(req.body.ride_id);
    const driverId = safeString(req.body.driver_id);

    if (!rideId || !driverId) {
      return res.status(400).json({
        success: false,
        message: "ride_id and driver_id are required."
      });
    }

    const ride = await getRideById(rideId);

    if (!ride || safeString(ride.driver_id) !== driverId) {
      return res.status(404).json({
        success: false,
        message: "Assigned ride not found."
      });
    }

    if (ride.dispatch_id) {
      await supabase
        .from("dispatches")
        .update({
          status: "rejected",
          responded_at: nowIso()
        })
        .eq("id", ride.dispatch_id);
    }

    await supabase
      .from("rides")
      .update({
        driver_id: null,
        dispatch_id: null,
        status: "redispatching",
        updated_at: nowIso()
      })
      .eq("id", rideId);

    await supabase
      .from("drivers")
      .update({
        status: "available",
        updated_at: nowIso()
      })
      .eq("id", driverId);

    const result = await dispatchRide(rideId);
    const refreshedRide = await getRideById(rideId);

    res.json({
      success: true,
      message: result.success ? "Ride redispatched." : "Redispatch pending.",
      ride: refreshedRide,
      dispatch: result
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Driver reject failed.",
      error: error.message
    });
  }
});

app.post("/api/rides/:rideId/start", async (req, res) => {
  try {
    const rideId = req.params.rideId;

    const { data: updatedRide, error } = await supabase
      .from("rides")
      .update({
        status: "in_progress",
        started_at: nowIso(),
        updated_at: nowIso()
      })
      .eq("id", rideId)
      .select()
      .single();

    if (error) throw error;

    await supabase
      .from("missions")
      .update({
        mission_status: "in_progress",
        updated_at: nowIso()
      })
      .eq("ride_id", rideId);

    res.json({
      success: true,
      message: "Ride started.",
      ride: updatedRide
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to start ride.",
      error: error.message
    });
  }
});

app.post("/api/rides/:rideId/complete", async (req, res) => {
  try {
    const rideId = req.params.rideId;
    const ride = await getRideById(rideId);

    const { data: updatedRide, error } = await supabase
      .from("rides")
      .update({
        status: "completed",
        completed_at: nowIso(),
        updated_at: nowIso()
      })
      .eq("id", rideId)
      .select()
      .single();

    if (error) throw error;

    if (ride?.driver_id) {
      await supabase
        .from("drivers")
        .update({
          status: "available",
          updated_at: nowIso()
        })
        .eq("id", ride.driver_id);
    }

    await supabase
      .from("missions")
      .update({
        mission_status: "completed",
        updated_at: nowIso()
      })
      .eq("ride_id", rideId);

    res.json({
      success: true,
      message: "Ride completed.",
      ride: updatedRide
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to complete ride.",
      error: error.message
    });
  }
});

app.post("/api/rides/:rideId/cancel", async (req, res) => {
  try {
    const rideId = req.params.rideId;
    const ride = await getRideById(rideId);

    const { data: updatedRide, error } = await supabase
      .from("rides")
      .update({
        status: "cancelled",
        cancelled_at: nowIso(),
        updated_at: nowIso()
      })
      .eq("id", rideId)
      .select()
      .single();

    if (error) throw error;

    if (ride?.driver_id) {
      await supabase
        .from("drivers")
        .update({
          status: "available",
          updated_at: nowIso()
        })
        .eq("id", ride.driver_id);
    }

    await supabase
      .from("missions")
      .update({
        mission_status: "cancelled",
        updated_at: nowIso()
      })
      .eq("ride_id", rideId);

    res.json({
      success: true,
      message: "Ride cancelled.",
      ride: updatedRide
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to cancel ride.",
      error: error.message
    });
  }
});

/* =========================================================
   ADMIN ANALYTICS
========================================================= */
app.get("/api/admin/analytics", async (req, res) => {
  try {
    const [ridesRes, ridersRes, driversRes, paymentsRes] = await Promise.all([
      supabase.from("rides").select("*"),
      supabase.from("riders").select("*"),
      supabase.from("drivers").select("*"),
      supabase.from("payments").select("*")
    ]);

    if (ridesRes.error) throw ridesRes.error;
    if (ridersRes.error) throw ridersRes.error;
    if (driversRes.error) throw driversRes.error;
    if (paymentsRes.error) throw paymentsRes.error;

    const rides = ridesRes.data || [];
    const riders = ridersRes.data || [];
    const drivers = driversRes.data || [];
    const payments = paymentsRes.data || [];

    const completedRides = rides.filter(
      (ride) => safeString(ride.status).toLowerCase() === "completed"
    );

    const activeRides = rides.filter((ride) =>
      ["requested", "awaiting_driver_acceptance", "driver_enroute", "in_progress", "redispatching"].includes(
        safeString(ride.status).toLowerCase()
      )
    );

    const availableDrivers = drivers.filter(
      (driver) => safeString(driver.status).toLowerCase() === "available"
    );

    const totalRevenue = completedRides.reduce(
      (sum, ride) => sum + safeNumber(ride.estimated_fare, 0),
      0
    );

    const authorizedPayments = payments.filter(
      (payment) => safeString(payment.status).toLowerCase() === "authorized"
    );

    res.json({
      success: true,
      analytics: {
        total_rides: rides.length,
        active_rides: activeRides.length,
        completed_rides: completedRides.length,
        total_riders: riders.length,
        total_drivers: drivers.length,
        available_drivers: availableDrivers.length,
        authorized_payments: authorizedPayments.length,
        total_revenue_estimate: Number(totalRevenue.toFixed(2))
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to load analytics.",
      error: error.message
    });
  }
});

/* =========================================================
   STATIC PAGES
========================================================= */
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

app.get("/admin-dispatch", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin-dispatch.html"));
});

app.get("/active-trip", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "active-trip.html"));
});

/* =========================================================
   START
========================================================= */
app.listen(PORT, () => {
  console.log(`✅ Harvey Taxi server running on port ${PORT}`);
});

const express = require("express");
const cors = require("cors");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

/* ===============================
   SUPABASE
================================ */
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/* ===============================
   HELPERS
================================ */
function generateId(prefix) {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
}

function round2(num) {
  return Math.round(Number(num) * 100) / 100;
}

function estimateDistanceMiles(pickup, dropoff) {
  const a = String(pickup || "").length;
  const b = String(dropoff || "").length;
  const pseudoDistance = ((a + b) % 18) + 4;
  return round2(pseudoDistance);
}

function estimateDurationMinutes(distanceMiles, rideType) {
  let multiplier = 2.0;
  if (rideType === "AIRPORT") multiplier = 2.4;
  if (rideType === "MEDICAL") multiplier = 2.1;
  if (rideType === "SCHEDULED") multiplier = 2.2;
  return Math.max(8, Math.round(distanceMiles * multiplier));
}

function buildFareEstimate({ pickup_address, dropoff_address, ride_type }) {
  const distance = estimateDistanceMiles(pickup_address, dropoff_address);
  const duration = estimateDurationMinutes(distance, ride_type);

  const baseFare = 4.5;
  const perMile = 1.95;
  const perMinute = 0.32;
  const bookingFee = 2.25;

  let surgeMultiplier = 1.0;
  if (ride_type === "AIRPORT") surgeMultiplier = 1.15;
  if (ride_type === "SCHEDULED") surgeMultiplier = 1.10;
  if (ride_type === "MEDICAL") surgeMultiplier = 1.05;
  if (ride_type === "NONPROFIT") surgeMultiplier = 1.0;

  const rawFare =
    (baseFare + distance * perMile + duration * perMinute) * surgeMultiplier +
    bookingFee;

  const estimatedFare = Math.max(12, round2(rawFare));
  const platformFee = round2(estimatedFare * 0.18);
  const driverPayout = round2(estimatedFare - platformFee);

  return {
    distance_miles: distance,
    duration_minutes: duration,
    estimated_fare: estimatedFare,
    estimated_driver_payout: driverPayout,
    platform_fee: platformFee,
    booking_fee: bookingFee,
    surge_multiplier: surgeMultiplier
  };
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

function getDriverEtaMinutes(driver, ride) {
  const pickupZone = getPickupZone(ride.pickup_address);
  const sameZone = driver.zone === pickupZone;

  if (sameZone) return 4;
  if (pickupZone === "AIRPORT" && driver.zone === "DOWNTOWN") return 9;
  if (pickupZone === "DOWNTOWN" && driver.zone === "AIRPORT") return 9;

  return 7 + Math.floor((Number(driver.completed_missions || 0) % 3));
}

function driverEligibleForRide(driver, ride) {
  if (!driver) return false;
  if (!driver.is_online) return false;
  if (driver.is_busy) return false;
  if (driver.verification_status !== "APPROVED") return false;
  if (driver.background_status !== "APPROVED") return false;
  if (!["AUTHORIZED", "SPONSORED"].includes(ride.payment_status)) return false;
  if (ride.rider_verification_status !== "APPROVED") return false;
  return true;
}

function scoreDriverForRide(driver, ride) {
  const eta = getDriverEtaMinutes(driver, ride);
  const payout = Number(ride.estimated_driver_payout || 0);
  const rideTypeBonus =
    ride.ride_type === "AIRPORT" && driver.zone === "AIRPORT" ? 8 : 0;
  const onlineBonus = driver.is_online ? 5 : 0;
  const reliabilityBonus = Number(driver.acceptance_score || 0) / 10;
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

/* ===============================
   DB HELPERS
================================ */
async function getRiderById(riderId) {
  const { data, error } = await supabase
    .from("riders")
    .select("*")
    .eq("rider_id", riderId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

async function getDriverById(driverId) {
  const { data, error } = await supabase
    .from("drivers")
    .select("*")
    .eq("driver_id", driverId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

async function getRideById(rideId) {
  const { data, error } = await supabase
    .from("rides")
    .select("*")
    .eq("ride_id", rideId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

async function hasAuthorizedPayment(riderId, estimatedFare) {
  const { data, error } = await supabase
    .from("payment_authorizations")
    .select("*")
    .eq("rider_id", riderId)
    .in("status", ["AUTHORIZED", "SPONSORED"]);

  if (error) throw error;

  return (data || []).some(
    (auth) => Number(auth.authorized_amount) >= Number(estimatedFare)
  );
}

async function hydrateRide(ride) {
  if (!ride) return null;

  let driverName = null;
  if (ride.assigned_driver_id) {
    const driver = await getDriverById(ride.assigned_driver_id);
    driverName = driver ? driver.first_name : null;
  }

  return {
    ...ride,
    driver_name: driverName
  };
}

async function hydrateRides(rides) {
  const result = [];
  for (const ride of rides || []) {
    result.push(await hydrateRide(ride));
  }
  return result;
}

async function findBestDriverForRide(ride) {
  const { data: drivers, error } = await supabase
    .from("drivers")
    .select("*");

  if (error) throw error;

  const eligibleDrivers = (drivers || []).filter((driver) =>
    driverEligibleForRide(driver, ride)
  );

  if (!eligibleDrivers.length) return null;

  const ranked = eligibleDrivers
    .map((driver) => ({
      driver,
      ...scoreDriverForRide(driver, ride)
    }))
    .sort((a, b) => b.score - a.score);

  return ranked[0];
}

async function assignDriverToRide(ride) {
  const bestMatch = await findBestDriverForRide(ride);

  if (!bestMatch) {
    const { data, error } = await supabase
      .from("rides")
      .update({
        assigned_driver_id: null,
        eta_to_pickup_minutes: null,
        dispatch_score: null,
        ride_status: "DISPATCHING",
        mission_status: "WAITING_FOR_DRIVER",
        updated_at: new Date().toISOString()
      })
      .eq("ride_id", ride.ride_id)
      .select()
      .single();

    if (error) throw error;
    return { assigned: false, ride: data };
  }

  const { data, error } = await supabase
    .from("rides")
    .update({
      assigned_driver_id: bestMatch.driver.driver_id,
      eta_to_pickup_minutes: bestMatch.eta_to_pickup_minutes,
      dispatch_score: bestMatch.score,
      ride_status: "READY_FOR_DRIVER",
      mission_status: "OFFERED_TO_DRIVER",
      updated_at: new Date().toISOString()
    })
    .eq("ride_id", ride.ride_id)
    .select()
    .single();

  if (error) throw error;

  return {
    assigned: true,
    driver: bestMatch.driver,
    eta_to_pickup_minutes: bestMatch.eta_to_pickup_minutes,
    dispatch_score: bestMatch.score,
    ride: data
  };
}

async function redispatchRide(ride) {
  const { error } = await supabase
    .from("rides")
    .update({
      assigned_driver_id: null,
      ride_status: "DISPATCHING",
      mission_status: "REDISPATCHING",
      updated_at: new Date().toISOString()
    })
    .eq("ride_id", ride.ride_id);

  if (error) throw error;

  const freshRide = await getRideById(ride.ride_id);
  return await assignDriverToRide(freshRide);
}

function buildDriverMission(ride, driverId) {
  return {
    ride_id: ride.ride_id,
    driver_id: driverId,
    passenger_first_name: ride.passenger_first_name,
    rider_verification_status: ride.rider_verification_status,
    pickup_address: ride.pickup_address,
    dropoff_address: ride.dropoff_address,
    ride_type: ride.ride_type,
    scheduled_time: ride.scheduled_time || "",
    special_notes: ride.special_notes || "",
    estimated_distance_miles: ride.estimated_distance_miles,
    estimated_duration_minutes: ride.estimated_duration_minutes,
    estimated_fare: ride.estimated_fare,
    estimated_driver_payout: ride.estimated_driver_payout,
    eta_to_pickup_minutes: ride.eta_to_pickup_minutes || 6,
    payment_status: ride.payment_status,
    dispatch_score: ride.dispatch_score || null
  };
}

async function getDashboardSummary() {
  const { data: rides, error } = await supabase.from("rides").select("*");
  if (error) throw error;

  return {
    waiting_rides: (rides || []).filter(
      (r) => r.ride_status === "DISPATCHING" || r.ride_status === "READY_FOR_DRIVER"
    ).length,
    active_trips: (rides || []).filter(
      (r) =>
        r.ride_status === "DRIVER_ACCEPTED" ||
        r.ride_status === "DRIVER_ARRIVING" ||
        r.ride_status === "IN_PROGRESS"
    ).length,
    completed_trips: (rides || []).filter((r) => r.ride_status === "COMPLETED").length
  };
}

/* ===============================
   STATIC PAGE ROUTES
================================ */
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/request-ride", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "request-ride.html"));
});

app.get("/driver-missions", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "driver-missions.html"));
});

app.get("/active-trip", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "active-trip.html"));
});

app.get("/admin-dispatch", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin-dispatch.html"));
});

app.get("/admin-dashboard", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin-dashboard.html"));
});

/* ===============================
   RIDER SIGNUP
================================ */
app.post("/api/rider/signup", async (req, res) => {
  try {
    const fullName =
      req.body.full_name ||
      req.body.fullName ||
      req.body.name ||
      req.body.fullname ||
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

    const city =
      req.body.city ||
      req.body.operating_city ||
      req.body.operatingCity ||
      req.body.operating_area ||
      req.body.operatingArea ||
      "";

    if (!fullName || !phone) {
      return res.status(400).json({
        success: false,
        message: "Full name and phone are required.",
        received: req.body
      });
    }

    const riderId = generateId("rider");

    const { data, error } = await supabase
      .from("riders")
      .insert([
        {
          rider_id: riderId,
          first_name: fullName,
          phone,
          verification_status: "PENDING"
        }
      ])
      .select()
      .single();

    if (error) {
      console.log("Rider insert error:", error);
      return res.status(500).json({
        success: false,
        message: "Database insert failed.",
        error: error.message
      });
    }

    return res.json({
      success: true,
      rider_id: data.rider_id,
      status: "PENDING_APPROVAL",
      rider: data,
      submitted_profile: {
        full_name: fullName,
        phone,
        email,
        city
      }
    });
  } catch (error) {
    console.log("Rider signup error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to submit rider application right now.",
      error: error.message
    });
  }
});

/* ===============================
   DRIVER SIGNUP
================================ */
app.post("/api/driver/signup", async (req, res) => {
  try {
    const fullName =
      req.body.full_name ||
      req.body.fullName ||
      req.body.name ||
      req.body.fullname ||
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

    const vehicleType =
      req.body.vehicle_type ||
      req.body.vehicleType ||
      "STANDARD";

    const licenseNumber =
      req.body.license ||
      req.body.license_number ||
      req.body.licenseNumber ||
      req.body.driver_license_number ||
      req.body.driverLicenseNumber ||
      "";

    const city =
      req.body.city ||
      req.body.operating_city ||
      req.body.operatingCity ||
      req.body.operating_area ||
      req.body.operatingArea ||
      req.body.operating_city_area ||
      req.body.operatingCityArea ||
      "";

    if (!fullName || !phone || !vehicleType || !city) {
      return res.status(400).json({
        success: false,
        message: "Full name, phone, vehicle type, and city are required.",
        received: req.body
      });
    }

    const driverId = generateId("driver");

    const insertPayload = {
      driver_id: driverId,
      first_name: fullName,
      verification_status: "PENDING",
      background_status: "PENDING",
      is_online: false,
      is_busy: false,
      current_address: city,
      zone: getPickupZone(city),
      vehicle_type: vehicleType,
      completed_missions: 0,
      acceptance_score: 90
    };

    const { data, error } = await supabase
      .from("drivers")
      .insert([insertPayload])
      .select()
      .single();

    if (error) {
      console.log("Driver insert error:", error);
      return res.status(500).json({
        success: false,
        message: "Database insert failed.",
        error: error.message
      });
    }

    return res.json({
      success: true,
      message: "Driver application submitted successfully.",
      driver_id: data.driver_id,
      status: "PENDING_APPROVAL",
      driver: data,
      submitted_profile: {
        full_name: fullName,
        phone,
        email,
        vehicle_type: vehicleType,
        license_number: licenseNumber,
        city
      }
    });
  } catch (error) {
    console.log("Driver signup error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to submit the driver application right now. Please try again.",
      error: error.message
    });
  }
});

/* ===============================
   TEMP DEBUG ROUTES
================================ */
app.post("/api/debug/driver-signup-test", (req, res) => {
  console.log("Driver signup payload:", req.body);
  res.json({
    success: true,
    received: req.body
  });
});

app.post("/api/debug/rider-signup-test", (req, res) => {
  console.log("Rider signup payload:", req.body);
  res.json({
    success: true,
    received: req.body
  });
});

/* ===============================
   RIDER STATUS
================================ */
app.get("/api/rider-status/:riderId", async (req, res) => {
  try {
    const rider = await getRiderById(req.params.riderId);

    if (!rider) {
      return res.status(404).json({
        success: false,
        message: "Rider not found."
      });
    }

    return res.json({
      success: true,
      rider
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

/* ===============================
   FARE ESTIMATE
================================ */
app.post("/api/fare-estimate", async (req, res) => {
  try {
    const { pickup_address, dropoff_address, ride_type } = req.body;

    if (!pickup_address || !dropoff_address) {
      return res.status(400).json({
        success: false,
        message: "Pickup and dropoff addresses are required."
      });
    }

    const estimate = buildFareEstimate({
      pickup_address,
      dropoff_address,
      ride_type: ride_type || "STANDARD"
    });

    return res.json({
      success: true,
      estimate
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

/* ===============================
   PAYMENT AUTHORIZATION
================================ */
app.post("/api/payments/authorize", async (req, res) => {
  try {
    const { rider_id, payment_method, estimated_fare, ride_type } = req.body;

    if (!rider_id || !payment_method || !estimated_fare) {
      return res.status(400).json({
        success: false,
        message: "Rider, payment method, and estimated fare are required."
      });
    }

    const rider = await getRiderById(rider_id);
    if (!rider) {
      return res.status(404).json({
        success: false,
        message: "Rider not found."
      });
    }

    if (ride_type !== "NONPROFIT" && payment_method === "CASH") {
      return res.status(400).json({
        success: false,
        message: "Cash is not eligible for secured pre-dispatch authorization."
      });
    }

    const authorization = {
      authorization_id: generateId("auth"),
      rider_id,
      payment_method,
      authorized_amount: round2(estimated_fare),
      status: ride_type === "NONPROFIT" ? "SPONSORED" : "AUTHORIZED"
    };

    const { data, error } = await supabase
      .from("payment_authorizations")
      .insert([authorization])
      .select()
      .single();

    if (error) throw error;

    return res.json({
      success: true,
      authorization: data
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

/* ===============================
   REQUEST RIDE + DISPATCH BRAIN
================================ */
app.post("/api/request-ride", async (req, res) => {
  try {
    const {
      rider_id,
      passenger_first_name,
      passenger_phone,
      pickup_address,
      dropoff_address,
      ride_type,
      scheduled_time,
      special_notes,
      payment_method,
      estimate
    } = req.body;

    if (
      !rider_id ||
      !passenger_first_name ||
      !passenger_phone ||
      !pickup_address ||
      !dropoff_address
    ) {
      return res.status(400).json({
        success: false,
        message: "Missing required ride request fields."
      });
    }

    const rider = await getRiderById(rider_id);
    if (!rider) {
      return res.status(404).json({
        success: false,
        message: "Rider not found."
      });
    }

    if (rider.verification_status !== "APPROVED") {
      return res.status(403).json({
        success: false,
        message: "Ride blocked. Rider verification must be approved."
      });
    }

    const estimatedFare = Number(estimate?.estimated_fare || 0);
    const paymentSecured =
      ride_type === "NONPROFIT"
        ? true
        : await hasAuthorizedPayment(rider_id, estimatedFare);

    if (!paymentSecured) {
      return res.status(403).json({
        success: false,
        message: "Ride blocked. Payment must be secured before dispatch."
      });
    }

    const ride = {
      ride_id: generateId("ride"),
      rider_id,
      assigned_driver_id: null,
      passenger_first_name,
      passenger_phone,
      pickup_address,
      dropoff_address,
      ride_type: ride_type || "STANDARD",
      scheduled_time: scheduled_time || "",
      special_notes: special_notes || "",
      rider_verification_status: rider.verification_status,
      estimated_distance_miles: Number(estimate?.distance_miles || 0),
      estimated_duration_minutes: Number(estimate?.duration_minutes || 0),
      estimated_fare: round2(estimate?.estimated_fare || 0),
      estimated_driver_payout: round2(estimate?.estimated_driver_payout || 0),
      fare_amount: round2(estimate?.estimated_fare || 0),
      tip_amount: 0,
      total_amount: round2(estimate?.estimated_fare || 0),
      payment_method: payment_method || "CARD",
      payment_status: ride_type === "NONPROFIT" ? "SPONSORED" : "AUTHORIZED",
      tip_status: "NO_TIP",
      eta_to_pickup_minutes: null,
      dispatch_score: null,
      ride_status: "DISPATCHING",
      mission_status: "RUNNING_DISPATCH_BRAIN"
    };

    const { data: insertedRide, error } = await supabase
      .from("rides")
      .insert([ride])
      .select()
      .single();

    if (error) throw error;

    const dispatchResult = await assignDriverToRide(insertedRide);
    const hydratedRide = await hydrateRide(dispatchResult.ride);

    return res.json({
      success: true,
      message: dispatchResult.assigned
        ? "Ride created and dispatched to the best available driver."
        : "Ride created. Dispatch brain is waiting for an approved online driver.",
      dispatch: {
        assigned: dispatchResult.assigned,
        driver_id: dispatchResult.driver ? dispatchResult.driver.driver_id : null,
        driver_name: dispatchResult.driver ? dispatchResult.driver.first_name : null,
        eta_to_pickup_minutes: dispatchResult.eta_to_pickup_minutes || null,
        dispatch_score: dispatchResult.dispatch_score || null
      },
      ride: hydratedRide
    });
  } catch (error) {
    console.log("Request ride error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

/* ===============================
   DRIVER ONLINE / OFFLINE
================================ */
app.post("/api/driver/go-online", async (req, res) => {
  try {
    const { driver_id, is_online } = req.body;

    const driver = await getDriverById(driver_id);
    if (!driver) {
      return res.status(404).json({
        success: false,
        message: "Driver not found."
      });
    }

    const { data, error } = await supabase
      .from("drivers")
      .update({ is_online: Boolean(is_online) })
      .eq("driver_id", driver_id)
      .select()
      .single();

    if (error) throw error;

    return res.json({
      success: true,
      driver: data
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

/* ===============================
   DRIVER MISSIONS
================================ */
app.get("/api/driver-missions/:driverId", async (req, res) => {
  try {
    const driver = await getDriverById(req.params.driverId);

    if (!driver) {
      return res.status(404).json({
        success: false,
        message: "Driver not found."
      });
    }

    if (!driver.is_online) {
      return res.json({
        success: true,
        missions: []
      });
    }

    const { data: rides, error } = await supabase
      .from("rides")
      .select("*")
      .eq("assigned_driver_id", driver.driver_id)
      .eq("ride_status", "READY_FOR_DRIVER");

    if (error) throw error;

    const missions = (rides || []).map((ride) =>
      buildDriverMission(ride, driver.driver_id)
    );

    return res.json({
      success: true,
      missions
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

app.post("/api/driver-missions/accept", async (req, res) => {
  try {
    const { driver_id, ride_id } = req.body;

    const driver = await getDriverById(driver_id);
    if (!driver) {
      return res.status(404).json({ success: false, message: "Driver not found." });
    }

    if (
      driver.verification_status !== "APPROVED" ||
      driver.background_status !== "APPROVED"
    ) {
      return res.status(403).json({
        success: false,
        message: "Driver is not approved for missions."
      });
    }

    const ride = await getRideById(ride_id);
    if (!ride) {
      return res.status(404).json({ success: false, message: "Ride not found." });
    }

    if (ride.assigned_driver_id !== driver_id) {
      return res.status(403).json({
        success: false,
        message: "This mission is not assigned to this driver."
      });
    }

    const { data: updatedRide, error: rideError } = await supabase
      .from("rides")
      .update({
        ride_status: "DRIVER_ACCEPTED",
        mission_status: "ACCEPTED",
        updated_at: new Date().toISOString()
      })
      .eq("ride_id", ride_id)
      .select()
      .single();

    if (rideError) throw rideError;

    const { error: driverError } = await supabase
      .from("drivers")
      .update({ is_busy: true })
      .eq("driver_id", driver_id);

    if (driverError) throw driverError;

    return res.json({
      success: true,
      message: "Mission accepted successfully.",
      ride: await hydrateRide(updatedRide)
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

app.post("/api/driver-missions/decline", async (req, res) => {
  try {
    const { driver_id, ride_id } = req.body;

    const ride = await getRideById(ride_id);
    if (!ride) {
      return res.status(404).json({ success: false, message: "Ride not found." });
    }

    const driver = await getDriverById(driver_id);
    if (driver) {
      await supabase
        .from("drivers")
        .update({
          acceptance_score: Math.max(50, Number(driver.acceptance_score || 90) - 2)
        })
        .eq("driver_id", driver_id);
    }

    const redispatchResult = await redispatchRide(ride);

    return res.json({
      success: true,
      message: redispatchResult.assigned
        ? "Mission declined. Dispatch brain reassigned the ride."
        : "Mission declined. Dispatch brain is waiting for another approved online driver.",
      dispatch: {
        assigned: redispatchResult.assigned,
        driver_id: redispatchResult.driver ? redispatchResult.driver.driver_id : null,
        driver_name: redispatchResult.driver ? redispatchResult.driver.first_name : null
      },
      ride: await hydrateRide(redispatchResult.ride)
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

/* ===============================
   ACTIVE TRIP LOOKUP
================================ */
app.get("/api/rides/:rideId", async (req, res) => {
  try {
    const ride = await getRideById(req.params.rideId);

    if (!ride) {
      return res.status(404).json({
        success: false,
        message: "Ride not found."
      });
    }

    return res.json({
      success: true,
      ride: await hydrateRide(ride)
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

/* ===============================
   TRIP STATUS
================================ */
app.post("/api/rides/:rideId/arriving", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("rides")
      .update({
        ride_status: "DRIVER_ARRIVING",
        mission_status: "DRIVER_EN_ROUTE_TO_PICKUP",
        updated_at: new Date().toISOString()
      })
      .eq("ride_id", req.params.rideId)
      .select()
      .single();

    if (error || !data) {
      return res.status(404).json({ success: false, message: "Ride not found." });
    }

    return res.json({
      success: true,
      message: "Driver marked as arriving.",
      ride: await hydrateRide(data)
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

app.post("/api/rides/:rideId/start", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("rides")
      .update({
        ride_status: "IN_PROGRESS",
        mission_status: "TRIP_ACTIVE",
        updated_at: new Date().toISOString()
      })
      .eq("ride_id", req.params.rideId)
      .select()
      .single();

    if (error || !data) {
      return res.status(404).json({ success: false, message: "Ride not found." });
    }

    return res.json({
      success: true,
      message: "Trip started.",
      ride: await hydrateRide(data)
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

app.post("/api/rides/:rideId/complete", async (req, res) => {
  try {
    const ride = await getRideById(req.params.rideId);
    if (!ride) {
      return res.status(404).json({ success: false, message: "Ride not found." });
    }

    const totalAmount = round2((ride.fare_amount || 0) + (ride.tip_amount || 0));

    const { data: updatedRide, error } = await supabase
      .from("rides")
      .update({
        ride_status: "COMPLETED",
        mission_status: "TRIP_CLOSED",
        payment_status: ride.payment_status === "SPONSORED" ? "SPONSORED" : "SETTLED",
        total_amount: totalAmount,
        updated_at: new Date().toISOString()
      })
      .eq("ride_id", req.params.rideId)
      .select()
      .single();

    if (error) throw error;

    if (ride.assigned_driver_id) {
      const driver = await getDriverById(ride.assigned_driver_id);
      if (driver) {
        await supabase
          .from("drivers")
          .update({
            is_busy: false,
            completed_missions: Number(driver.completed_missions || 0) + 1,
            acceptance_score: Math.min(99, Number(driver.acceptance_score || 90) + 1)
          })
          .eq("driver_id", ride.assigned_driver_id);
      }
    }

    return res.json({
      success: true,
      message: "Trip completed and payment settled.",
      ride: await hydrateRide(updatedRide)
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

/* ===============================
   TIPS
================================ */
app.post("/api/rides/:rideId/tip-during", async (req, res) => {
  try {
    const ride = await getRideById(req.params.rideId);

    if (!ride) {
      return res.status(404).json({ success: false, message: "Ride not found" });
    }

    if (ride.ride_status !== "IN_PROGRESS") {
      return res.json({
        success: false,
        message: "Tips during trip only allowed while trip is active"
      });
    }

    const amount = Number(req.body.amount || 0);
    if (amount <= 0) {
      return res.json({ success: false, message: "Invalid tip amount" });
    }

    const tipAmount = round2((ride.tip_amount || 0) + amount);
    const totalAmount = round2((ride.fare_amount || 0) + tipAmount);

    const { data, error } = await supabase
      .from("rides")
      .update({
        tip_amount: tipAmount,
        total_amount: totalAmount,
        tip_status: "IN_TRIP_TIPPED",
        updated_at: new Date().toISOString()
      })
      .eq("ride_id", ride.ride_id)
      .select()
      .single();

    if (error) throw error;

    return res.json({
      success: true,
      ride: await hydrateRide(data)
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

app.post("/api/rides/:rideId/tip-after", async (req, res) => {
  try {
    const ride = await getRideById(req.params.rideId);

    if (!ride) {
      return res.status(404).json({ success: false, message: "Ride not found" });
    }

    if (ride.ride_status !== "COMPLETED") {
      return res.json({
        success: false,
        message: "Post-trip tips only allowed after completion"
      });
    }

    const amount = Number(req.body.amount || 0);
    if (amount <= 0) {
      return res.json({ success: false, message: "Invalid tip amount" });
    }

    const tipAmount = round2((ride.tip_amount || 0) + amount);
    const totalAmount = round2((ride.fare_amount || 0) + tipAmount);

    const { data, error } = await supabase
      .from("rides")
      .update({
        tip_amount: tipAmount,
        total_amount: totalAmount,
        tip_status: "POST_TRIP_TIPPED",
        updated_at: new Date().toISOString()
      })
      .eq("ride_id", ride.ride_id)
      .select()
      .single();

    if (error) throw error;

    return res.json({
      success: true,
      ride: await hydrateRide(data)
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

/* ===============================
   ADMIN DISPATCH BOARD
================================ */
app.get("/api/admin/dispatch-board", async (req, res) => {
  try {
    const { data: rides, error: ridesError } = await supabase
      .from("rides")
      .select("*")
      .order("created_at", { ascending: false });

    if (ridesError) throw ridesError;

    const { data: drivers, error: driversError } = await supabase
      .from("drivers")
      .select("*");

    if (driversError) throw driversError;

    const hydrated = await hydrateRides(rides || []);

    const summary = {
      total_rides: hydrated.length,
      waiting_for_driver: hydrated.filter(
        (r) => r.ride_status === "DISPATCHING" || r.ride_status === "READY_FOR_DRIVER"
      ).length,
      active_trips: hydrated.filter(
        (r) =>
          r.ride_status === "DRIVER_ACCEPTED" ||
          r.ride_status === "DRIVER_ARRIVING" ||
          r.ride_status === "IN_PROGRESS"
      ).length,
      completed_trips: hydrated.filter((r) => r.ride_status === "COMPLETED").length
    };

    return res.json({
      success: true,
      summary,
      rides: hydrated,
      drivers: drivers || []
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

/* ===============================
   ADMIN APPROVAL DASHBOARD
================================ */
app.get("/api/admin/dashboard-data", async (req, res) => {
  try {
    const { data: pendingRiders, error: ridersError } = await supabase
      .from("riders")
      .select("*")
      .eq("verification_status", "PENDING");

    if (ridersError) throw ridersError;

    const { data: drivers, error: driversError } = await supabase
      .from("drivers")
      .select("*");

    if (driversError) throw driversError;

    const pendingDrivers = (drivers || []).filter(
      (d) => d.verification_status === "PENDING" || d.background_status === "PENDING"
    );

    const { data: rides, error: ridesError } = await supabase
      .from("rides")
      .select("*")
      .order("created_at", { ascending: false });

    if (ridesError) throw ridesError;

    return res.json({
      success: true,
      pending_riders: pendingRiders || [],
      pending_drivers: pendingDrivers,
      rides: await hydrateRides(rides || []),
      summary: await getDashboardSummary()
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

app.post("/api/admin/approve-rider", async (req, res) => {
  try {
    const { rider_id } = req.body;

    const { data, error } = await supabase
      .from("riders")
      .update({ verification_status: "APPROVED" })
      .eq("rider_id", rider_id)
      .select()
      .single();

    if (error || !data) {
      return res.status(404).json({ success: false, message: "Rider not found." });
    }

    return res.json({ success: true, rider: data });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

app.post("/api/admin/reject-rider", async (req, res) => {
  try {
    const { rider_id } = req.body;

    const { data, error } = await supabase
      .from("riders")
      .update({ verification_status: "REJECTED" })
      .eq("rider_id", rider_id)
      .select()
      .single();

    if (error || !data) {
      return res.status(404).json({ success: false, message: "Rider not found." });
    }

    return res.json({ success: true, rider: data });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

app.post("/api/admin/approve-driver", async (req, res) => {
  try {
    const { driver_id } = req.body;

    const { data, error } = await supabase
      .from("drivers")
      .update({
        verification_status: "APPROVED",
        background_status: "APPROVED"
      })
      .eq("driver_id", driver_id)
      .select()
      .single();

    if (error || !data) {
      return res.status(404).json({ success: false, message: "Driver not found." });
    }

    return res.json({ success: true, driver: data });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

app.post("/api/admin/reject-driver", async (req, res) => {
  try {
    const { driver_id } = req.body;

    const { data, error } = await supabase
      .from("drivers")
      .update({ verification_status: "REJECTED" })
      .eq("driver_id", driver_id)
      .select()
      .single();

    if (error || !data) {
      return res.status(404).json({ success: false, message: "Driver not found." });
    }

    return res.json({ success: true, driver: data });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

/* ===============================
   DISPATCH BRAIN TOOLS
================================ */
app.post("/api/admin/run-dispatch/:rideId", async (req, res) => {
  try {
    const ride = await getRideById(req.params.rideId);

    if (!ride) {
      return res.status(404).json({
        success: false,
        message: "Ride not found."
      });
    }

    const result = await assignDriverToRide(ride);

    return res.json({
      success: true,
      message: result.assigned
        ? "Dispatch brain assigned the best available driver."
        : "No approved online driver available right now.",
      dispatch: result,
      ride: await hydrateRide(result.ride)
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

app.get("/api/admin/dispatch-insights/:rideId", async (req, res) => {
  try {
    const ride = await getRideById(req.params.rideId);

    if (!ride) {
      return res.status(404).json({
        success: false,
        message: "Ride not found."
      });
    }

    const { data: drivers, error } = await supabase.from("drivers").select("*");
    if (error) throw error;

    const ranked = (drivers || [])
      .filter((driver) => driverEligibleForRide(driver, ride))
      .map((driver) => ({
        driver_id: driver.driver_id,
        driver_name: driver.first_name,
        zone: driver.zone,
        is_online: driver.is_online,
        is_busy: driver.is_busy,
        ...scoreDriverForRide(driver, ride)
      }))
      .sort((a, b) => b.score - a.score);

    return res.json({
      success: true,
      ride: await hydrateRide(ride),
      candidates: ranked
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

/* ===============================
   DEBUG
================================ */
app.get("/api/debug/all-rides", async (req, res) => {
  try {
    const { data: rides } = await supabase.from("rides").select("*");
    const { data: riders } = await supabase.from("riders").select("*");
    const { data: drivers } = await supabase.from("drivers").select("*");
    const { data: paymentAuthorizations } = await supabase
      .from("payment_authorizations")
      .select("*");

    return res.json({
      success: true,
      rides: await hydrateRides(rides || []),
      riders: riders || [],
      drivers: drivers || [],
      paymentAuthorizations: paymentAuthorizations || []
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

/* ===============================
   START SERVER
================================ */
app.listen(PORT, () => {
  console.log(`HARVEY SERVER RUNNING ON PORT ${PORT}`);
});

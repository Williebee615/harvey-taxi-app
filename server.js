const express = require("express");
const cors = require("cors");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

/*
  Harvey Taxi Dispatch Brain Backend
  ---------------------------------
  Supports:
  - rider verification gate
  - payment secured before dispatch
  - smart dispatch brain
  - approved online driver matching
  - driver mission offers
  - driver accept / decline
  - re-dispatch when a mission is declined
  - active trip lookup
  - arriving / start / complete
  - tip during and after trip
  - admin dispatch board
  - admin approval dashboard

  NOTE:
  This is still demo-memory storage.
  Next production step is moving all arrays into Supabase/PostgreSQL.
*/

/* -----------------------------
   DEMO DATA
----------------------------- */

const riders = [
  {
    rider_id: "rider_1001",
    first_name: "Willie",
    phone: "(555) 111-1111",
    verification_status: "APPROVED"
  },
  {
    rider_id: "rider_1002",
    first_name: "Pending Rider",
    phone: "(555) 222-2222",
    verification_status: "PENDING"
  }
];

const drivers = [
  {
    driver_id: "driver_2001",
    first_name: "Marcus",
    verification_status: "APPROVED",
    background_status: "APPROVED",
    is_online: false,
    is_busy: false,
    current_address: "Downtown Nashville, TN",
    zone: "DOWNTOWN",
    vehicle_type: "STANDARD",
    completed_missions: 18,
    acceptance_score: 92
  },
  {
    driver_id: "driver_2002",
    first_name: "Avery",
    verification_status: "PENDING",
    background_status: "PENDING",
    is_online: false,
    is_busy: false,
    current_address: "North Nashville, TN",
    zone: "NORTH",
    vehicle_type: "STANDARD",
    completed_missions: 6,
    acceptance_score: 83
  },
  {
    driver_id: "driver_2003",
    first_name: "Jordan",
    verification_status: "APPROVED",
    background_status: "APPROVED",
    is_online: false,
    is_busy: false,
    current_address: "Airport District, Nashville, TN",
    zone: "AIRPORT",
    vehicle_type: "STANDARD",
    completed_missions: 31,
    acceptance_score: 96
  }
];

const rides = [];
const paymentAuthorizations = [];

/* -----------------------------
   HELPERS
----------------------------- */

function generateId(prefix) {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
}

function round2(num) {
  return Math.round(Number(num) * 100) / 100;
}

function getRiderById(riderId) {
  return riders.find((r) => r.rider_id === riderId);
}

function getDriverById(driverId) {
  return drivers.find((d) => d.driver_id === driverId);
}

function getRideById(rideId) {
  return rides.find((r) => r.ride_id === rideId);
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
  if (ride_type === "SCHEDULED") surgeMultiplier = 1.1;
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

function hasAuthorizedPayment(riderId, estimatedFare) {
  return paymentAuthorizations.some((auth) => {
    const validStatus =
      auth.status === "AUTHORIZED" || auth.status === "SPONSORED";

    return (
      auth.rider_id === riderId &&
      validStatus &&
      Number(auth.authorized_amount) >= Number(estimatedFare)
    );
  });
}

function getPickupZone(address = "") {
  const a = address.toLowerCase();

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

  return 7 + Math.floor((driver.completed_missions % 3));
}

function driverEligibleForRide(driver, ride) {
  if (!driver) return false;
  if (!driver.is_online) return false;
  if (driver.is_busy) return false;
  if (driver.verification_status !== "APPROVED") return false;
  if (driver.background_status !== "APPROVED") return false;
  if (
    ride.payment_status !== "AUTHORIZED" &&
    ride.payment_status !== "SPONSORED"
  ) return false;
  if (ride.rider_verification_status !== "APPROVED") return false;

  return true;
}

function scoreDriverForRide(driver, ride) {
  const eta = getDriverEtaMinutes(driver, ride);
  const payout = Number(ride.estimated_driver_payout || 0);
  const rideTypeBonus = ride.ride_type === "AIRPORT" && driver.zone === "AIRPORT" ? 8 : 0;
  const onlineBonus = driver.is_online ? 5 : 0;
  const reliabilityBonus = Number(driver.acceptance_score || 0) / 10;
  const experienceBonus = Math.min(Number(driver.completed_missions || 0), 40) / 8;

  const score =
    100
    - eta * 7
    + onlineBonus
    + rideTypeBonus
    + reliabilityBonus
    + experienceBonus
    + payout * 0.15;

  return {
    score: round2(score),
    eta_to_pickup_minutes: eta
  };
}

function findBestDriverForRide(ride) {
  const eligibleDrivers = drivers.filter((driver) =>
    driverEligibleForRide(driver, ride)
  );

  if (!eligibleDrivers.length) return null;

  const ranked = eligibleDrivers
    .map((driver) => {
      const scoring = scoreDriverForRide(driver, ride);
      return {
        driver,
        ...scoring
      };
    })
    .sort((a, b) => b.score - a.score);

  return ranked[0];
}

function assignDriverToRide(ride) {
  const bestMatch = findBestDriverForRide(ride);

  if (!bestMatch) {
    ride.assigned_driver_id = null;
    ride.eta_to_pickup_minutes = null;
    ride.dispatch_score = null;
    ride.ride_status = "DISPATCHING";
    ride.mission_status = "WAITING_FOR_DRIVER";
    ride.updated_at = new Date().toISOString();

    return {
      assigned: false,
      driver: null
    };
  }

  ride.assigned_driver_id = bestMatch.driver.driver_id;
  ride.eta_to_pickup_minutes = bestMatch.eta_to_pickup_minutes;
  ride.dispatch_score = bestMatch.score;
  ride.ride_status = "READY_FOR_DRIVER";
  ride.mission_status = "OFFERED_TO_DRIVER";
  ride.updated_at = new Date().toISOString();

  return {
    assigned: true,
    driver: bestMatch.driver,
    eta_to_pickup_minutes: bestMatch.eta_to_pickup_minutes,
    dispatch_score: bestMatch.score
  };
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

function hydrateRide(ride) {
  const driver = ride.assigned_driver_id
    ? getDriverById(ride.assigned_driver_id)
    : null;

  return {
    ...ride,
    driver_name: driver ? driver.first_name : null
  };
}

function getDashboardSummary() {
  const hydratedRides = rides.map(hydrateRide);

  return {
    waiting_rides: hydratedRides.filter(
      (r) =>
        r.ride_status === "DISPATCHING" ||
        r.ride_status === "READY_FOR_DRIVER"
    ).length,
    active_trips: hydratedRides.filter(
      (r) =>
        r.ride_status === "DRIVER_ACCEPTED" ||
        r.ride_status === "DRIVER_ARRIVING" ||
        r.ride_status === "IN_PROGRESS"
    ).length,
    completed_trips: hydratedRides.filter(
      (r) => r.ride_status === "COMPLETED"
    ).length
  };
}

function redispatchRide(ride) {
  if (!ride) return { assigned: false };

  ride.assigned_driver_id = null;
  ride.ride_status = "DISPATCHING";
  ride.mission_status = "REDISPATCHING";
  ride.updated_at = new Date().toISOString();

  return assignDriverToRide(ride);
}

/* -----------------------------
   STATIC PAGE ROUTES
----------------------------- */

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

/* -----------------------------
   RIDER / VERIFICATION
----------------------------- */

app.get("/api/rider-status/:riderId", (req, res) => {
  const rider = getRiderById(req.params.riderId);

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
});

/* -----------------------------
   FARE ESTIMATE
----------------------------- */

app.post("/api/fare-estimate", (req, res) => {
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
});

/* -----------------------------
   PAYMENT AUTHORIZATION
----------------------------- */

app.post("/api/payments/authorize", (req, res) => {
  const { rider_id, payment_method, estimated_fare, ride_type } = req.body;

  if (!rider_id || !payment_method || !estimated_fare) {
    return res.status(400).json({
      success: false,
      message: "Rider, payment method, and estimated fare are required."
    });
  }

  const rider = getRiderById(rider_id);
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
    status: ride_type === "NONPROFIT" ? "SPONSORED" : "AUTHORIZED",
    created_at: new Date().toISOString()
  };

  paymentAuthorizations.push(authorization);

  return res.json({
    success: true,
    authorization
  });
});

/* -----------------------------
   REQUEST RIDE + DISPATCH BRAIN
----------------------------- */

app.post("/api/request-ride", (req, res) => {
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

  const rider = getRiderById(rider_id);

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
      : hasAuthorizedPayment(rider_id, estimatedFare);

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
    mission_status: "RUNNING_DISPATCH_BRAIN",

    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  rides.push(ride);

  const dispatchResult = assignDriverToRide(ride);

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
    ride: hydrateRide(ride)
  });
});

/* -----------------------------
   DRIVER ONLINE / OFFLINE
----------------------------- */

app.post("/api/driver/go-online", (req, res) => {
  const { driver_id, is_online } = req.body;

  const driver = getDriverById(driver_id);

  if (!driver) {
    return res.status(404).json({
      success: false,
      message: "Driver not found."
    });
  }

  driver.is_online = Boolean(is_online);

  return res.json({
    success: true,
    driver
  });
});

/* -----------------------------
   DRIVER MISSIONS
----------------------------- */

app.get("/api/driver-missions/:driverId", (req, res) => {
  const driver = getDriverById(req.params.driverId);

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

  const missions = rides
    .filter((ride) => {
      const assignedToDriver = ride.assigned_driver_id === driver.driver_id;
      const openMission = ride.ride_status === "READY_FOR_DRIVER";
      const paymentReady =
        ride.payment_status === "AUTHORIZED" ||
        ride.payment_status === "SPONSORED";

      return assignedToDriver && openMission && paymentReady;
    })
    .map((ride) => buildDriverMission(ride, driver.driver_id));

  return res.json({
    success: true,
    missions
  });
});

app.post("/api/driver-missions/accept", (req, res) => {
  const { driver_id, ride_id } = req.body;

  const driver = getDriverById(driver_id);
  if (!driver) {
    return res.status(404).json({
      success: false,
      message: "Driver not found."
    });
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

  const ride = getRideById(ride_id);
  if (!ride) {
    return res.status(404).json({
      success: false,
      message: "Ride not found."
    });
  }

  if (ride.assigned_driver_id !== driver_id) {
    return res.status(403).json({
      success: false,
      message: "This mission is not assigned to this driver."
    });
  }

  if (
    ride.payment_status !== "AUTHORIZED" &&
    ride.payment_status !== "SPONSORED"
  ) {
    return res.status(403).json({
      success: false,
      message: "Mission blocked. Payment is not secured."
    });
  }

  ride.assigned_driver_id = driver_id;
  ride.ride_status = "DRIVER_ACCEPTED";
  ride.mission_status = "ACCEPTED";
  ride.updated_at = new Date().toISOString();

  driver.is_busy = true;

  return res.json({
    success: true,
    message: "Mission accepted successfully.",
    ride: hydrateRide(ride)
  });
});

app.post("/api/driver-missions/decline", (req, res) => {
  const { driver_id, ride_id } = req.body;

  const ride = getRideById(ride_id);
  if (!ride) {
    return res.status(404).json({
      success: false,
      message: "Ride not found."
    });
  }

  const driver = getDriverById(driver_id);
  if (driver) {
    driver.acceptance_score = Math.max(50, Number(driver.acceptance_score || 90) - 2);
  }

  const redispatchResult = redispatchRide(ride);

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
    ride: hydrateRide(ride)
  });
});

/* -----------------------------
   ACTIVE TRIP LOOKUP
----------------------------- */

app.get("/api/rides/:rideId", (req, res) => {
  const ride = getRideById(req.params.rideId);

  if (!ride) {
    return res.status(404).json({
      success: false,
      message: "Ride not found."
    });
  }

  return res.json({
    success: true,
    ride: hydrateRide(ride)
  });
});

/* -----------------------------
   TRIP STATUS UPDATES
----------------------------- */

app.post("/api/rides/:rideId/arriving", (req, res) => {
  const ride = getRideById(req.params.rideId);

  if (!ride) {
    return res.status(404).json({
      success: false,
      message: "Ride not found."
    });
  }

  ride.ride_status = "DRIVER_ARRIVING";
  ride.mission_status = "DRIVER_EN_ROUTE_TO_PICKUP";
  ride.updated_at = new Date().toISOString();

  return res.json({
    success: true,
    message: "Driver marked as arriving.",
    ride: hydrateRide(ride)
  });
});

app.post("/api/rides/:rideId/start", (req, res) => {
  const ride = getRideById(req.params.rideId);

  if (!ride) {
    return res.status(404).json({
      success: false,
      message: "Ride not found."
    });
  }

  ride.ride_status = "IN_PROGRESS";
  ride.mission_status = "TRIP_ACTIVE";
  ride.updated_at = new Date().toISOString();

  return res.json({
    success: true,
    message: "Trip started.",
    ride: hydrateRide(ride)
  });
});

app.post("/api/rides/:rideId/complete", (req, res) => {
  const ride = getRideById(req.params.rideId);

  if (!ride) {
    return res.status(404).json({
      success: false,
      message: "Ride not found."
    });
  }

  ride.ride_status = "COMPLETED";
  ride.mission_status = "TRIP_CLOSED";
  ride.payment_status =
    ride.payment_status === "SPONSORED" ? "SPONSORED" : "SETTLED";
  ride.total_amount = round2((ride.fare_amount || 0) + (ride.tip_amount || 0));
  ride.updated_at = new Date().toISOString();

  const driver = ride.assigned_driver_id ? getDriverById(ride.assigned_driver_id) : null;
  if (driver) {
    driver.is_busy = false;
    driver.completed_missions = Number(driver.completed_missions || 0) + 1;
    driver.acceptance_score = Math.min(99, Number(driver.acceptance_score || 90) + 1);
  }

  return res.json({
    success: true,
    message: "Trip completed and payment settled.",
    ride: hydrateRide(ride)
  });
});

/* -----------------------------
   TIPPING
----------------------------- */

app.post("/api/rides/:rideId/tip-during", (req, res) => {
  const ride = getRideById(req.params.rideId);

  if (!ride) {
    return res.status(404).json({
      success: false,
      message: "Ride not found"
    });
  }

  if (ride.ride_status !== "IN_PROGRESS") {
    return res.json({
      success: false,
      message: "Tips during trip only allowed while trip is active"
    });
  }

  const amount = Number(req.body.amount || 0);

  if (amount <= 0) {
    return res.json({
      success: false,
      message: "Invalid tip amount"
    });
  }

  ride.tip_amount = round2((ride.tip_amount || 0) + amount);
  ride.total_amount = round2((ride.fare_amount || 0) + ride.tip_amount);
  ride.tip_status = "IN_TRIP_TIPPED";
  ride.updated_at = new Date().toISOString();

  return res.json({
    success: true,
    ride: hydrateRide(ride)
  });
});

app.post("/api/rides/:rideId/tip-after", (req, res) => {
  const ride = getRideById(req.params.rideId);

  if (!ride) {
    return res.status(404).json({
      success: false,
      message: "Ride not found"
    });
  }

  if (ride.ride_status !== "COMPLETED") {
    return res.json({
      success: false,
      message: "Post-trip tips only allowed after completion"
    });
  }

  const amount = Number(req.body.amount || 0);

  if (amount <= 0) {
    return res.json({
      success: false,
      message: "Invalid tip amount"
    });
  }

  ride.tip_amount = round2((ride.tip_amount || 0) + amount);
  ride.total_amount = round2((ride.fare_amount || 0) + ride.tip_amount);
  ride.tip_status = "POST_TRIP_TIPPED";
  ride.updated_at = new Date().toISOString();

  return res.json({
    success: true,
    ride: hydrateRide(ride)
  });
});

/* -----------------------------
   ADMIN DISPATCH BOARD
----------------------------- */

app.get("/api/admin/dispatch-board", (req, res) => {
  const hydratedRides = rides.map(hydrateRide);

  const summary = {
    total_rides: hydratedRides.length,
    waiting_for_driver: hydratedRides.filter(
      (r) =>
        r.ride_status === "DISPATCHING" ||
        r.ride_status === "READY_FOR_DRIVER"
    ).length,
    active_trips: hydratedRides.filter(
      (r) =>
        r.ride_status === "DRIVER_ACCEPTED" ||
        r.ride_status === "DRIVER_ARRIVING" ||
        r.ride_status === "IN_PROGRESS"
    ).length,
    completed_trips: hydratedRides.filter(
      (r) => r.ride_status === "COMPLETED"
    ).length
  };

  return res.json({
    success: true,
    summary,
    rides: hydratedRides.sort(
      (a, b) => new Date(b.created_at) - new Date(a.created_at)
    ),
    drivers
  });
});

/* -----------------------------
   ADMIN APPROVAL DASHBOARD
----------------------------- */

app.get("/api/admin/dashboard-data", (req, res) => {
  const pendingRiders = riders.filter((r) => r.verification_status === "PENDING");
  const pendingDrivers = drivers.filter(
    (d) =>
      d.verification_status === "PENDING" ||
      d.background_status === "PENDING"
  );

  const hydratedRides = rides
    .map(hydrateRide)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  return res.json({
    success: true,
    pending_riders: pendingRiders,
    pending_drivers: pendingDrivers,
    rides: hydratedRides,
    summary: getDashboardSummary()
  });
});

app.post("/api/admin/approve-rider", (req, res) => {
  const { rider_id } = req.body;
  const rider = riders.find((r) => r.rider_id === rider_id);

  if (!rider) {
    return res.status(404).json({
      success: false,
      message: "Rider not found."
    });
  }

  rider.verification_status = "APPROVED";

  return res.json({
    success: true,
    rider
  });
});

app.post("/api/admin/reject-rider", (req, res) => {
  const { rider_id } = req.body;
  const rider = riders.find((r) => r.rider_id === rider_id);

  if (!rider) {
    return res.status(404).json({
      success: false,
      message: "Rider not found."
    });
  }

  rider.verification_status = "REJECTED";

  return res.json({
    success: true,
    rider
  });
});

app.post("/api/admin/approve-driver", (req, res) => {
  const { driver_id } = req.body;
  const driver = drivers.find((d) => d.driver_id === driver_id);

  if (!driver) {
    return res.status(404).json({
      success: false,
      message: "Driver not found."
    });
  }

  driver.verification_status = "APPROVED";
  driver.background_status = "APPROVED";

  return res.json({
    success: true,
    driver
  });
});

app.post("/api/admin/reject-driver", (req, res) => {
  const { driver_id } = req.body;
  const driver = drivers.find((d) => d.driver_id === driver_id);

  if (!driver) {
    return res.status(404).json({
      success: false,
      message: "Driver not found."
    });
  }

  driver.verification_status = "REJECTED";

  return res.json({
    success: true,
    driver
  });
});

/* -----------------------------
   DISPATCH BRAIN TOOLS
----------------------------- */

app.post("/api/admin/run-dispatch/:rideId", (req, res) => {
  const ride = getRideById(req.params.rideId);

  if (!ride) {
    return res.status(404).json({
      success: false,
      message: "Ride not found."
    });
  }

  const result = assignDriverToRide(ride);

  return res.json({
    success: true,
    message: result.assigned
      ? "Dispatch brain assigned the best available driver."
      : "No approved online driver available right now.",
    dispatch: result,
    ride: hydrateRide(ride)
  });
});

app.get("/api/admin/dispatch-insights/:rideId", (req, res) => {
  const ride = getRideById(req.params.rideId);

  if (!ride) {
    return res.status(404).json({
      success: false,
      message: "Ride not found."
    });
  }

  const ranked = drivers
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
    ride: hydrateRide(ride),
    candidates: ranked
  });
});

/* -----------------------------
   DEBUG
----------------------------- */

app.get("/api/debug/all-rides", (req, res) => {
  return res.json({
    success: true,
    rides: rides.map(hydrateRide),
    riders,
    drivers,
    paymentAuthorizations
  });
});

/* -----------------------------
   START SERVER
----------------------------- */

app.listen(PORT, () => {
  console.log(`Harvey Taxi server running on port ${PORT}`);
});

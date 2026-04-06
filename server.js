const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const fsp = require("fs/promises");

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());
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
  data: path.join(__dirname, "data.json")
};

const DISPATCH_OFFER_TIMEOUT_MS = 20000;
const MAX_DISPATCH_ATTEMPTS = 10;

/* =========================================================
   RUNTIME TIMERS
========================================================= */
const activeOfferTimers = new Map();

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
  return Math.round(Number(num) * 100) / 100;
}

function normalizeStatus(value) {
  return String(value || "").trim().toUpperCase();
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

async function ensureJsonFile(filePath, fallback = []) {
  try {
    await fsp.access(filePath, fs.constants.F_OK);
  } catch {
    await fsp.writeFile(filePath, JSON.stringify(fallback, null, 2), "utf8");
  }
}

async function readJson(filePath, fallback = []) {
  try {
    await ensureJsonFile(filePath, fallback);
    const raw = await fsp.readFile(filePath, "utf8");
    if (!raw.trim()) return fallback;
    return JSON.parse(raw);
  } catch (error) {
    console.error(`Failed to read JSON file: ${filePath}`, error);
    return fallback;
  }
}

async function writeJson(filePath, value) {
  await fsp.writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
}

async function appendJson(filePath, item, fallback = []) {
  const data = await readJson(filePath, fallback);
  const arr = safeArray(data);
  arr.push(item);
  await writeJson(filePath, arr);
  return item;
}

async function updateJsonItem(filePath, predicate, updater, fallback = []) {
  const data = await readJson(filePath, fallback);
  const arr = safeArray(data);

  let updatedItem = null;
  const next = arr.map((item) => {
    if (predicate(item)) {
      updatedItem = typeof updater === "function" ? updater(item) : { ...item, ...updater };
      return updatedItem;
    }
    return item;
  });

  await writeJson(filePath, next);
  return updatedItem;
}

async function findOne(filePath, predicate, fallback = []) {
  const data = await readJson(filePath, fallback);
  return safeArray(data).find(predicate) || null;
}

async function filterMany(filePath, predicate, fallback = []) {
  const data = await readJson(filePath, fallback);
  return safeArray(data).filter(predicate);
}

function estimateDistanceMiles(pickup, dropoff) {
  const a = String(pickup || "").trim().length;
  const b = String(dropoff || "").trim().length;
  const pseudoDistance = ((a + b) % 18) + 4;
  return round2(pseudoDistance);
}

function estimateDurationMinutes(distanceMiles, rideType) {
  let speedFactor = 2.6;
  if (rideType === "AIRPORT") speedFactor = 2.2;
  if (rideType === "MEDICAL") speedFactor = 2.8;
  if (rideType === "SCHEDULED") speedFactor = 2.5;
  if (rideType === "NONPROFIT") speedFactor = 2.9;
  return Math.max(8, Math.round(distanceMiles * speedFactor + 6));
}

function buildFareEstimate({ pickup_address, dropoff_address, ride_type }) {
  const distance_miles = estimateDistanceMiles(pickup_address, dropoff_address);
  const duration_minutes = estimateDurationMinutes(distance_miles, ride_type);

  const pricing = {
    STANDARD: { base: 4.5, perMile: 1.85, perMinute: 0.32, bookingFee: 2.0 },
    SCHEDULED: { base: 6.0, perMile: 1.95, perMinute: 0.34, bookingFee: 2.5 },
    AIRPORT: { base: 7.5, perMile: 2.15, perMinute: 0.36, bookingFee: 3.0 },
    MEDICAL: { base: 6.5, perMile: 1.9, perMinute: 0.35, bookingFee: 2.25 },
    NONPROFIT: { base: 3.0, perMile: 1.2, perMinute: 0.2, bookingFee: 0.0 }
  };

  const selected = pricing[ride_type] || pricing.STANDARD;

  const tripSubtotal =
    selected.base +
    distance_miles * selected.perMile +
    duration_minutes * selected.perMinute;

  const booking_fee = selected.bookingFee;
  const estimated_fare = round2(tripSubtotal + booking_fee);
  const estimated_driver_payout = round2(estimated_fare * 0.78);
  const platform_fee = round2(estimated_fare - estimated_driver_payout);

  return {
    distance_miles,
    duration_minutes,
    estimated_fare,
    estimated_driver_payout,
    platform_fee,
    booking_fee
  };
}

function riderIsApproved(rider) {
  if (!rider) return false;
  return (
    normalizeStatus(rider.verification_status) === "APPROVED" ||
    rider.ride_access_enabled === true
  );
}

function driverIsApproved(driver) {
  if (!driver) return false;

  const approval = normalizeStatus(driver.approval_status || driver.verification_status);
  const background = normalizeStatus(driver.background_check_status || driver.checkr_status);
  const online = normalizeStatus(driver.online_status || driver.status);
  const service = normalizeStatus(driver.service_status || driver.availability_status);

  const verificationOkay =
    approval === "APPROVED" || approval === "ACTIVE" || approval === "VERIFIED";

  const backgroundOkay =
    background === "" ||
    background === "APPROVED" ||
    background === "CLEAR" ||
    background === "PASSED";

  const onlineOkay =
    online === "ONLINE" ||
    online === "AVAILABLE" ||
    online === "READY" ||
    online === "";

  const serviceOkay =
    service === "" ||
    service === "ACTIVE" ||
    service === "AVAILABLE" ||
    service === "READY";

  const notBusy =
    !driver.current_ride_id &&
    normalizeStatus(driver.trip_status) !== "IN_PROGRESS" &&
    normalizeStatus(driver.trip_status) !== "EN_ROUTE";

  return verificationOkay && backgroundOkay && onlineOkay && serviceOkay && notBusy;
}

function computePseudoDriverScore(driver, ride, gpsLocations = []) {
  const gps = gpsLocations.find((g) => g.driver_id === driver.driver_id) || {};
  const zoneText =
    String(gps.current_address || gps.zone || driver.current_zone || driver.city || "").toLowerCase();
  const pickupText = String(ride.pickup_address || "").toLowerCase();

  let score = 1000;

  if (zoneText && pickupText) {
    const pickupWords = pickupText.split(/[\s,]+/).filter(Boolean);
    const overlap = pickupWords.filter((w) => zoneText.includes(w)).length;
    score -= overlap * 120;
  }

  const lastSeenPenalty = gps.updated_at ? 0 : 80;
  score += lastSeenPenalty;

  const acceptanceBoost = Number(driver.acceptance_score || 0);
  score -= acceptanceBoost * 5;

  const ratingBoost = Number(driver.rating || 0);
  score -= ratingBoost * 10;

  score += Math.floor(Math.random() * 15);

  return score;
}

async function logMessage(message) {
  const payload = {
    message_id: generateId("msg"),
    created_at: nowIso(),
    ...message
  };
  await appendJson(DATA_FILES.messages, payload, []);
  return payload;
}

async function logRideEvent(ride, eventType, details = {}) {
  await logMessage({
    scope: "RIDE_EVENT",
    ride_id: ride.ride_id,
    rider_id: ride.rider_id,
    driver_id: ride.driver_id || null,
    event_type: eventType,
    details
  });
}

async function getLatestPaymentAuthorizationForRider(riderId) {
  const payments = await readJson(DATA_FILES.payments, []);
  const riderPayments = safeArray(payments)
    .filter((p) => p.rider_id === riderId)
    .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));

  return riderPayments[0] || null;
}

async function updateRide(rideId, updater) {
  return updateJsonItem(
    DATA_FILES.rides,
    (ride) => ride.ride_id === rideId,
    updater,
    []
  );
}

async function updateDriver(driverId, updater) {
  return updateJsonItem(
    DATA_FILES.drivers,
    (driver) => driver.driver_id === driverId,
    updater,
    []
  );
}

async function updateDispatch(dispatchId, updater) {
  return updateJsonItem(
    DATA_FILES.dispatches,
    (dispatch) => dispatch.dispatch_id === dispatchId,
    updater,
    []
  );
}

async function updateMissionByDispatch(dispatchId, updater) {
  const missions = await readJson(DATA_FILES.missions, []);
  const next = missions.map((mission) => {
    if (mission.dispatch_id === dispatchId) {
      return typeof updater === "function" ? updater(mission) : { ...mission, ...updater };
    }
    return mission;
  });
  await writeJson(DATA_FILES.missions, next);
}

/* =========================================================
   DISPATCH BRAIN
========================================================= */
async function getEligibleDriversForRide(ride) {
  const drivers = await readJson(DATA_FILES.drivers, []);
  const gpsLocations = await readJson(DATA_FILES.gpsLocations, []);

  return safeArray(drivers)
    .filter(driverIsApproved)
    .map((driver) => ({
      ...driver,
      _dispatchScore: computePseudoDriverScore(driver, ride, gpsLocations)
    }))
    .sort((a, b) => a._dispatchScore - b._dispatchScore);
}

async function getOpenOffersForRide(rideId) {
  const dispatches = await readJson(DATA_FILES.dispatches, []);
  return dispatches.filter(
    (item) =>
      item.ride_id === rideId &&
      ["PENDING", "OFFERED"].includes(normalizeStatus(item.offer_status))
  );
}

async function getDriversAlreadyOffered(rideId) {
  const dispatches = await readJson(DATA_FILES.dispatches, []);
  return new Set(dispatches.filter((d) => d.ride_id === rideId).map((d) => d.driver_id));
}

async function createDispatchOffer(ride, driver) {
  const offer = {
    dispatch_id: generateId("dispatch"),
    ride_id: ride.ride_id,
    rider_id: ride.rider_id,
    driver_id: driver.driver_id,
    offer_status: "OFFERED",
    mission_status: "OFFERED",
    offered_at: nowIso(),
    expires_at: new Date(Date.now() + DISPATCH_OFFER_TIMEOUT_MS).toISOString(),
    estimated_fare: ride.estimated_fare,
    estimated_driver_payout: ride.estimated_driver_payout,
    pickup_address: ride.pickup_address,
    dropoff_address: ride.dropoff_address,
    ride_type: ride.ride_type,
    special_notes: ride.special_notes || "",
    dispatch_attempt: Number(ride.dispatch_attempt_count || 0) + 1
  };

  const mission = {
    mission_id: generateId("mission"),
    dispatch_id: offer.dispatch_id,
    ride_id: ride.ride_id,
    driver_id: driver.driver_id,
    rider_id: ride.rider_id,
    mission_status: "OFFERED",
    title: "Harvey Taxi Ride Mission",
    pickup_address: ride.pickup_address,
    dropoff_address: ride.dropoff_address,
    ride_type: ride.ride_type,
    estimated_fare: ride.estimated_fare,
    estimated_driver_payout: ride.estimated_driver_payout,
    estimated_distance_miles: ride.estimated_distance_miles,
    estimated_duration_minutes: ride.estimated_duration_minutes,
    special_notes: ride.special_notes || "",
    created_at: nowIso(),
    expires_at: offer.expires_at
  };

  await appendJson(DATA_FILES.dispatches, offer, []);
  await appendJson(DATA_FILES.missions, mission, []);

  await logMessage({
    scope: "DISPATCH",
    ride_id: ride.ride_id,
    rider_id: ride.rider_id,
    driver_id: driver.driver_id,
    event_type: "DRIVER_OFFERED",
    details: {
      dispatch_id: offer.dispatch_id,
      mission_id: mission.mission_id,
      pickup_address: ride.pickup_address,
      dropoff_address: ride.dropoff_address,
      estimated_driver_payout: ride.estimated_driver_payout
    }
  });

  return offer;
}

async function expireDispatchOffer(dispatchId, reason = "TIMEOUT") {
  const dispatch = await findOne(DATA_FILES.dispatches, (d) => d.dispatch_id === dispatchId, []);
  if (!dispatch) return null;

  const currentStatus = normalizeStatus(dispatch.offer_status);
  if (currentStatus === "ACCEPTED" || currentStatus === "DECLINED" || currentStatus === "EXPIRED") {
    return dispatch;
  }

  const updatedDispatch = await updateDispatch(dispatchId, (item) => ({
    ...item,
    offer_status: "EXPIRED",
    mission_status: "EXPIRED",
    expired_at: nowIso(),
    expire_reason: reason
  }));

  await updateMissionByDispatch(dispatchId, (mission) => ({
    ...mission,
    mission_status: "EXPIRED",
    expired_at: nowIso(),
    expire_reason: reason
  }));

  activeOfferTimers.delete(dispatchId);

  await logMessage({
    scope: "DISPATCH",
    ride_id: dispatch.ride_id,
    rider_id: dispatch.rider_id,
    driver_id: dispatch.driver_id,
    event_type: "DRIVER_OFFER_EXPIRED",
    details: {
      dispatch_id: dispatch.dispatch_id,
      reason
    }
  });

  return updatedDispatch;
}

function scheduleOfferExpiry(dispatchId, rideId) {
  if (activeOfferTimers.has(dispatchId)) {
    clearTimeout(activeOfferTimers.get(dispatchId));
  }

  const timer = setTimeout(async () => {
    try {
      await expireDispatchOffer(dispatchId, "TIMEOUT");
      await runDispatchBrain(rideId);
    } catch (error) {
      console.error("Offer expiry timer error:", error);
    }
  }, DISPATCH_OFFER_TIMEOUT_MS);

  activeOfferTimers.set(dispatchId, timer);
}

async function assignDriverToRide(ride, driver, dispatch) {
  await updateRide(ride.ride_id, (current) => ({
    ...current,
    driver_id: driver.driver_id,
    assigned_driver_id: driver.driver_id,
    ride_status: "DRIVER_ACCEPTED",
    mission_status: "DRIVER_ACCEPTED",
    dispatch_status: "DRIVER_ACCEPTED",
    driver_assigned_at: nowIso(),
    updated_at: nowIso()
  }));

  await updateDriver(driver.driver_id, (current) => ({
    ...current,
    current_ride_id: ride.ride_id,
    current_dispatch_id: dispatch.dispatch_id,
    trip_status: "ASSIGNED",
    online_status: current.online_status || "ONLINE",
    updated_at: nowIso()
  }));

  await updateDispatch(dispatch.dispatch_id, (current) => ({
    ...current,
    offer_status: "ACCEPTED",
    mission_status: "ACCEPTED",
    accepted_at: nowIso()
  }));

  await updateMissionByDispatch(dispatch.dispatch_id, (mission) => ({
    ...mission,
    mission_status: "ACCEPTED",
    accepted_at: nowIso()
  }));

  if (activeOfferTimers.has(dispatch.dispatch_id)) {
    clearTimeout(activeOfferTimers.get(dispatch.dispatch_id));
    activeOfferTimers.delete(dispatch.dispatch_id);
  }

  await logMessage({
    scope: "DISPATCH",
    ride_id: ride.ride_id,
    rider_id: ride.rider_id,
    driver_id: driver.driver_id,
    event_type: "DRIVER_ASSIGNED",
    details: {
      dispatch_id: dispatch.dispatch_id
    }
  });
}

async function runDispatchBrain(rideId) {
  const ride = await findOne(DATA_FILES.rides, (r) => r.ride_id === rideId, []);
  if (!ride) return { success: false, message: "Ride not found." };

  const rideStatus = normalizeStatus(ride.ride_status);
  if (
    ["DRIVER_ACCEPTED", "DRIVER_EN_ROUTE", "DRIVER_ARRIVED", "IN_PROGRESS", "COMPLETED", "CANCELLED"].includes(rideStatus)
  ) {
    return { success: true, message: "Ride already assigned or closed." };
  }

  const rider = await findOne(DATA_FILES.riders, (r) => r.rider_id === ride.rider_id, []);
  if (!rider || !riderIsApproved(rider)) {
    await updateRide(rideId, (current) => ({
      ...current,
      ride_status: "VERIFICATION_BLOCKED",
      mission_status: "VERIFICATION_BLOCKED",
      updated_at: nowIso()
    }));

    return { success: false, message: "Rider approval required." };
  }

  if (ride.ride_type !== "NONPROFIT") {
    const payment = await getLatestPaymentAuthorizationForRider(ride.rider_id);

    if (!payment || normalizeStatus(payment.status) !== "SECURED") {
      await updateRide(rideId, (current) => ({
        ...current,
        ride_status: "PAYMENT_BLOCKED",
        mission_status: "PAYMENT_BLOCKED",
        updated_at: nowIso()
      }));

      return { success: false, message: "Payment must be secured." };
    }
  }

  const openOffers = await getOpenOffersForRide(rideId);
  if (openOffers.length) {
    return { success: true, message: "Dispatch already in progress." };
  }

  const alreadyOffered = await getDriversAlreadyOffered(rideId);
  const eligibleDrivers = await getEligibleDriversForRide(ride);
  const nextDriver = eligibleDrivers.find((driver) => !alreadyOffered.has(driver.driver_id));

  const nextAttempt = Number(ride.dispatch_attempt_count || 0) + 1;

  await updateRide(rideId, (current) => ({
    ...current,
    dispatch_attempt_count: nextAttempt,
    ride_status: "DISPATCHING",
    mission_status: "DISPATCHING",
    updated_at: nowIso()
  }));  if (!nextDriver || nextAttempt > MAX_DISPATCH_ATTEMPTS) {
    await updateRide(rideId, (current) => ({
      ...current,
      ride_status: "NO_DRIVER_AVAILABLE",
      mission_status: "NO_DRIVER_AVAILABLE",
      dispatch_status: "NO_DRIVER_AVAILABLE",
      updated_at: nowIso()
    }));

    await logRideEvent(ride, "NO_DRIVER_AVAILABLE", {
      dispatch_attempt_count: nextAttempt
    });

    return {
      success: false,
      message: "No eligible driver available."
    };
  }

  const refreshedRide = await findOne(DATA_FILES.rides, (r) => r.ride_id === rideId, []);
  const offer = await createDispatchOffer(refreshedRide, nextDriver);

  await updateRide(rideId, (current) => ({
    ...current,
    offered_driver_id: nextDriver.driver_id,
    ride_status: "DRIVER_OFFERED",
    mission_status: "DRIVER_OFFERED",
    dispatch_status: "DRIVER_OFFERED",
    updated_at: nowIso()
  }));

  scheduleOfferExpiry(offer.dispatch_id, rideId);

  return {
    success: true,
    message: "Driver offer created.",
    dispatch: offer
  };
}

/* =========================================================
   STARTUP FILE INIT
========================================================= */
async function initializeFiles() {
  await Promise.all([
    ensureJsonFile(DATA_FILES.riders, []),
    ensureJsonFile(DATA_FILES.drivers, []),
    ensureJsonFile(DATA_FILES.rides, []),
    ensureJsonFile(DATA_FILES.payments, []),
    ensureJsonFile(DATA_FILES.dispatches, []),
    ensureJsonFile(DATA_FILES.missions, []),
    ensureJsonFile(DATA_FILES.gpsLocations, []),
    ensureJsonFile(DATA_FILES.messages, []),
    ensureJsonFile(DATA_FILES.vehicles, []),
    ensureJsonFile(DATA_FILES.data, {})
  ]);
}

/* =========================================================
   HEALTH
========================================================= */
app.get("/api/health", async (req, res) => {
  res.json({
    success: true,
    message: "Harvey Taxi API is running",
    autonomous_dispatch_brain: true,
    timestamp: nowIso()
  });
});

/* =========================================================
   RIDER SIGNUP
========================================================= */
app.post("/api/rider-signup", async (req, res) => {
  try {
    const { fullName, phone, email, address } = req.body;

    if (!fullName || !phone || !email || !address) {
      return res.status(400).json({
        success: false,
        message: "Full name, phone, email, and address are required."
      });
    }

    const riders = await readJson(DATA_FILES.riders, []);
    const existing = riders.find(
      (r) =>
        String(r.email || "").toLowerCase() === String(email).toLowerCase() ||
        String(r.phone || "") === String(phone)
    );

    if (existing) {
      return res.status(409).json({
        success: false,
        message: "A rider account already exists with this email or phone number."
      });
    }

    const rider = {
      rider_id: generateId("rider"),
      full_name: fullName,
      first_name: String(fullName).trim().split(" ")[0] || fullName,
      phone,
      email,
      address,
      verification_status: "PENDING",
      ride_access_enabled: false,
      created_at: nowIso(),
      updated_at: nowIso()
    };

    await appendJson(DATA_FILES.riders, rider, []);

    return res.status(201).json({
      success: true,
      message: "Rider account created successfully. Verification review has started.",
      rider
    });
  } catch (error) {
    console.error("Rider signup error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to create rider account."
    });
  }
});

/* =========================================================
   RIDER STATUS
========================================================= */
app.get("/api/rider-status/:riderId", async (req, res) => {
  try {
    const rider = await findOne(
      DATA_FILES.riders,
      (r) => r.rider_id === req.params.riderId,
      []
    );

    if (!rider) {
      return res.status(404).json({
        success: false,
        message: "Rider profile not found."
      });
    }

    return res.json({
      success: true,
      rider
    });
  } catch (error) {
    console.error("Rider status error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to check rider status."
    });
  }
});

/* =========================================================
   DRIVER STATUS / AVAILABILITY
========================================================= */
app.post("/api/driver/update-status", async (req, res) => {
  try {
    const { driver_id, online_status, service_status, trip_status } = req.body;

    if (!driver_id) {
      return res.status(400).json({
        success: false,
        message: "driver_id is required."
      });
    }

    const driver = await updateDriver(driver_id, (current) => ({
      ...current,
      online_status: online_status ?? current.online_status,
      service_status: service_status ?? current.service_status,
      trip_status: trip_status ?? current.trip_status,
      updated_at: nowIso()
    }));

    if (!driver) {
      return res.status(404).json({
        success: false,
        message: "Driver not found."
      });
    }

    return res.json({
      success: true,
      driver
    });
  } catch (error) {
    console.error("Driver update status error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to update driver status."
    });
  }
});

app.post("/api/driver/location", async (req, res) => {
  try {
    const { driver_id, current_address, zone, latitude, longitude } = req.body;

    if (!driver_id) {
      return res.status(400).json({
        success: false,
        message: "driver_id is required."
      });
    }

    const gps = await readJson(DATA_FILES.gpsLocations, []);
    const existingIndex = gps.findIndex((item) => item.driver_id === driver_id);

    const payload = {
      driver_id,
      current_address: current_address || "",
      zone: zone || "",
      latitude: latitude ?? null,
      longitude: longitude ?? null,
      updated_at: nowIso()
    };

    if (existingIndex >= 0) {
      gps[existingIndex] = { ...gps[existingIndex], ...payload };
    } else {
      gps.push(payload);
    }

    await writeJson(DATA_FILES.gpsLocations, gps);

    return res.json({
      success: true,
      location: payload
    });
  } catch (error) {
    console.error("Driver location error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to update driver location."
    });
  }
});

/* =========================================================
   FARE ESTIMATE
========================================================= */
app.post("/api/fare-estimate", async (req, res) => {
  try {
    const {
      pickup_address,
      dropoff_address,
      ride_type
    } = req.body;

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
    console.error("Fare estimate error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to calculate fare estimate."
    });
  }
});

/* =========================================================
   PAYMENT AUTHORIZE
========================================================= */
app.post("/api/payments/authorize", async (req, res) => {
  try {
    const { rider_id, payment_method, estimated_fare, ride_type } = req.body;

    if (!rider_id || !payment_method || estimated_fare == null) {
      return res.status(400).json({
        success: false,
        message: "rider_id, payment_method, and estimated_fare are required."
      });
    }

    if (payment_method === "CASH" && ride_type !== "NONPROFIT") {
      return res.status(400).json({
        success: false,
        message: "Cash payments are not currently available for this ride type."
      });
    }

    const payment = {
      payment_id: generateId("payment"),
      authorization_id: generateId("auth"),
      rider_id,
      payment_method,
      authorized_amount: round2(estimated_fare),
      captured_amount: 0,
      ride_type: ride_type || "STANDARD",
      status: "SECURED",
      created_at: nowIso(),
      updated_at: nowIso()
    };

    await appendJson(DATA_FILES.payments, payment, []);

    return res.json({
      success: true,
      message: "Payment secured successfully.",
      authorization: payment
    });
  } catch (error) {
    console.error("Payment authorize error:", error);
    return res.status(500).json({
      success: false,
      message: "Payment service unavailable."
    });
  }
});

/* =========================================================
   REQUEST RIDE + AUTONOMOUS DISPATCH START
========================================================= */
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

    if (!rider_id) {
      return res.status(400).json({
        success: false,
        message: "rider_id is required."
      });
    }

    if (!passenger_first_name || !passenger_phone) {
      return res.status(400).json({
        success: false,
        message: "Passenger first name and phone number are required."
      });
    }

    if (!pickup_address || !dropoff_address) {
      return res.status(400).json({
        success: false,
        message: "Pickup and dropoff addresses are required."
      });
    }

    if (!estimate || !estimate.estimated_fare) {
      return res.status(400).json({
        success: false,
        message: "A valid fare estimate is required before requesting a ride."
      });
    }

    const rider = await findOne(DATA_FILES.riders, (r) => r.rider_id === rider_id, []);
    if (!rider) {
      return res.status(404).json({
        success: false,
        message: "Rider profile not found."
      });
    }

    if (!riderIsApproved(rider)) {
      return res.status(403).json({
        success: false,
        message: "Your rider account must be approved before you can request a ride."
      });
    }

    if (ride_type !== "NONPROFIT") {
      const latestPayment = await getLatestPaymentAuthorizationForRider(rider_id);
      if (!latestPayment || normalizeStatus(latestPayment.status) !== "SECURED") {
        return res.status(403).json({
          success: false,
          message: "Payment must be secured before your ride can be requested."
        });
      }
    }

    const ride = {
      ride_id: generateId("ride"),
      rider_id,
      driver_id: null,
      passenger_first_name,
      passenger_phone,
      pickup_address,
      dropoff_address,
      ride_type: ride_type || "STANDARD",
      scheduled_time: scheduled_time || null,
      special_notes: special_notes || "",
      payment_method: payment_method || "CARD",
      payment_status: ride_type === "NONPROFIT" ? "NOT_REQUIRED" : "SECURED",
      payout_status: "PENDING",
      tip_status: "AVAILABLE_LATER",
      estimated_fare: round2(estimate.estimated_fare),
      estimated_driver_payout: round2(estimate.estimated_driver_payout || 0),
      estimated_distance_miles: round2(estimate.distance_miles || 0),
      estimated_duration_minutes: Math.round(Number(estimate.duration_minutes || 0)),
      ride_status: "REQUESTED",
      mission_status: "REQUESTED",
      dispatch_status: "PENDING",
      dispatch_attempt_count: 0,
      created_at: nowIso(),
      updated_at: nowIso()
    };

    await appendJson(DATA_FILES.rides, ride, []);
    await logRideEvent(ride, "RIDE_CREATED", {
      pickup_address,
      dropoff_address,
      ride_type: ride.ride_type
    });

    const dispatchResult = await runDispatchBrain(ride.ride_id);
    const refreshedRide = await findOne(DATA_FILES.rides, (r) => r.ride_id === ride.ride_id, []);

    return res.status(201).json({
      success: true,
      message: dispatchResult.success
        ? "Ride requested successfully and dispatch has started."
        : "Ride requested successfully, but dispatch could not complete yet.",
      ride: refreshedRide,
      dispatch: dispatchResult
    });
  } catch (error) {
    console.error("Request ride error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to submit ride request."
    });
  }
});

/* =========================================================
   DRIVER MISSION FEED
========================================================= */
app.get("/api/driver/:driverId/missions", async (req, res) => {  try {
    const { driverId } = req.params;

    const missions = await filterMany(
      DATA_FILES.missions,
      (mission) =>
        mission.driver_id === driverId &&
        ["OFFERED", "ACCEPTED", "EN_ROUTE", "ARRIVED", "IN_PROGRESS"].includes(
          normalizeStatus(mission.mission_status)
        ),
      []
    );

    const sorted = missions.sort(
      (a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0)
    );

    return res.json({
      success: true,
      missions: sorted
    });
  } catch (error) {
    console.error("Driver missions error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to load driver missions."
    });
  }
});

/* =========================================================
   DRIVER ACCEPT MISSION
========================================================= */
app.post("/api/driver/accept-mission", async (req, res) => {
  try {
    const { driver_id, dispatch_id } = req.body;

    if (!driver_id || !dispatch_id) {
      return res.status(400).json({
        success: false,
        message: "driver_id and dispatch_id are required."
      });
    }

    const dispatch = await findOne(
      DATA_FILES.dispatches,
      (d) => d.dispatch_id === dispatch_id && d.driver_id === driver_id,
      []
    );

    if (!dispatch) {
      return res.status(404).json({
        success: false,
        message: "Dispatch offer not found."
      });
    }

    const currentStatus = normalizeStatus(dispatch.offer_status);
    if (currentStatus === "EXPIRED") {
      return res.status(409).json({
        success: false,
        message: "This dispatch offer has expired."
      });
    }

    if (currentStatus === "DECLINED") {
      return res.status(409).json({
        success: false,
        message: "This dispatch offer was already declined."
      });
    }

    if (currentStatus === "ACCEPTED") {
      return res.json({
        success: true,
        message: "Mission already accepted.",
        dispatch
      });
    }

    const ride = await findOne(DATA_FILES.rides, (r) => r.ride_id === dispatch.ride_id, []);
    if (!ride) {
      return res.status(404).json({
        success: false,
        message: "Ride not found."
      });
    }

    const driver = await findOne(DATA_FILES.drivers, (d) => d.driver_id === driver_id, []);
    if (!driver) {
      return res.status(404).json({
        success: false,
        message: "Driver not found."
      });
    }

    if (!driverIsApproved(driver)) {
      return res.status(403).json({
        success: false,
        message: "Driver is not eligible to accept rides."
      });
    }

    await assignDriverToRide(ride, driver, dispatch);

    const allDispatches = await readJson(DATA_FILES.dispatches, []);
    const competingDispatches = allDispatches.filter(
      (item) =>
        item.ride_id === ride.ride_id &&
        item.dispatch_id !== dispatch_id &&
        ["PENDING", "OFFERED"].includes(normalizeStatus(item.offer_status))
    );

    for (const item of competingDispatches) {
      await expireDispatchOffer(item.dispatch_id, "ACCEPTED_BY_OTHER_DRIVER");
    }

    const updatedRide = await findOne(DATA_FILES.rides, (r) => r.ride_id === ride.ride_id, []);
    const updatedDispatch = await findOne(
      DATA_FILES.dispatches,
      (d) => d.dispatch_id === dispatch_id,
      []
    );

    return res.json({
      success: true,
      message: "Mission accepted successfully.",
      ride: updatedRide,
      dispatch: updatedDispatch
    });
  } catch (error) {
    console.error("Driver accept mission error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to accept mission."
    });
  }
});

/* =========================================================
   DRIVER DECLINE MISSION
========================================================= */
app.post("/api/driver/decline-mission", async (req, res) => {
  try {
    const { driver_id, dispatch_id } = req.body;

    if (!driver_id || !dispatch_id) {
      return res.status(400).json({
        success: false,
        message: "driver_id and dispatch_id are required."
      });
    }

    const dispatch = await findOne(
      DATA_FILES.dispatches,
      (d) => d.dispatch_id === dispatch_id && d.driver_id === driver_id,
      []
    );

    if (!dispatch) {
      return res.status(404).json({
        success: false,
        message: "Dispatch offer not found."
      });
    }

    const currentStatus = normalizeStatus(dispatch.offer_status);
    if (currentStatus === "ACCEPTED") {
      return res.status(409).json({
        success: false,
        message: "Accepted mission cannot be declined from this route."
      });
    }

    await updateDispatch(dispatch_id, (item) => ({
      ...item,
      offer_status: "DECLINED",
      mission_status: "DECLINED",
      declined_at: nowIso()
    }));

    await updateMissionByDispatch(dispatch_id, (mission) => ({
      ...mission,
      mission_status: "DECLINED",
      declined_at: nowIso()
    }));

    if (activeOfferTimers.has(dispatch_id)) {
      clearTimeout(activeOfferTimers.get(dispatch_id));
      activeOfferTimers.delete(dispatch_id);
    }

    await logMessage({
      scope: "DISPATCH",
      ride_id: dispatch.ride_id,
      rider_id: dispatch.rider_id,
      driver_id,
      event_type: "DRIVER_DECLINED",
      details: {
        dispatch_id
      }
    });

    await runDispatchBrain(dispatch.ride_id);

    return res.json({
      success: true,
      message: "Mission declined. Dispatch is moving to the next eligible driver."
    });
  } catch (error) {
    console.error("Driver decline mission error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to decline mission."
    });
  }
});

/* =========================================================
   DRIVER TRIP PROGRESSION
========================================================= */
app.post("/api/driver/mark-en-route", async (req, res) => {
  try {
    const { driver_id, ride_id } = req.body;

    if (!driver_id || !ride_id) {
      return res.status(400).json({
        success: false,
        message: "driver_id and ride_id are required."
      });
    }

    const ride = await findOne(
      DATA_FILES.rides,
      (r) => r.ride_id === ride_id && r.driver_id === driver_id,
      []
    );

    if (!ride) {
      return res.status(404).json({
        success: false,
        message: "Assigned ride not found."
      });
    }

    const updatedRide = await updateRide(ride_id, (current) => ({
      ...current,
      ride_status: "DRIVER_EN_ROUTE",
      mission_status: "DRIVER_EN_ROUTE",
      dispatch_status: "DRIVER_EN_ROUTE",
      updated_at: nowIso()
    }));

    await updateDriver(driver_id, (current) => ({
      ...current,
      trip_status: "EN_ROUTE",
      updated_at: nowIso()
    }));

    const dispatches = await readJson(DATA_FILES.dispatches, []);
    const acceptedDispatch = dispatches.find(
      (d) =>
        d.ride_id === ride_id &&
        d.driver_id === driver_id &&
        normalizeStatus(d.offer_status) === "ACCEPTED"
    );

    if (acceptedDispatch) {
      await updateDispatch(acceptedDispatch.dispatch_id, (current) => ({
        ...current,
        mission_status: "EN_ROUTE",
        driver_trip_status: "EN_ROUTE",
        en_route_at: nowIso()
      }));

      await updateMissionByDispatch(acceptedDispatch.dispatch_id, (mission) => ({
        ...mission,
        mission_status: "EN_ROUTE",
        driver_trip_status: "EN_ROUTE",
        en_route_at: nowIso()
      }));
    }

    await logRideEvent(updatedRide, "DRIVER_EN_ROUTE", { driver_id });

    return res.json({
      success: true,
      message: "Driver marked en route.",
      ride: updatedRide
    });
  } catch (error) {
    console.error("Mark en route error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to mark driver en route."
    });
  }
});

app.post("/api/driver/mark-arrived", async (req, res) => {
  try {
    const { driver_id, ride_id } = req.body;

    if (!driver_id || !ride_id) {
      return res.status(400).json({
        success: false,
        message: "driver_id and ride_id are required."
      });
    }

    const ride = await findOne(
      DATA_FILES.rides,
      (r) => r.ride_id === ride_id && r.driver_id === driver_id,
      []
    );

    if (!ride) {
      return res.status(404).json({
        success: false,
        message: "Assigned ride not found."
      });
    }

    const updatedRide = await updateRide(ride_id, (current) => ({
      ...current,
      ride_status: "DRIVER_ARRIVED",
      mission_status: "DRIVER_ARRIVED",
      dispatch_status: "DRIVER_ARRIVED",
      arrived_at: nowIso(),
      updated_at: nowIso()
    }));

    await updateDriver(driver_id, (current) => ({
      ...current,
      trip_status: "ARRIVED",
      updated_at: nowIso()
    }));

    const dispatches = await readJson(DATA_FILES.dispatches, []);
    const acceptedDispatch = dispatches.find(
      (d) =>
        d.ride_id === ride_id &&
        d.driver_id === driver_id &&
        normalizeStatus(d.offer_status) === "ACCEPTED"
    );

    if (acceptedDispatch) {
      await updateDispatch(acceptedDispatch.dispatch_id, (current) => ({
        ...current,
        mission_status: "ARRIVED",
        driver_trip_status: "ARRIVED",
        arrived_at: nowIso()
      }));

      await updateMissionByDispatch(acceptedDispatch.dispatch_id, (mission) => ({
        ...mission,
        mission_status: "ARRIVED",
        driver_trip_status: "ARRIVED",
        arrived_at: nowIso()
      }));
    }

    await logRideEvent(updatedRide, "DRIVER_ARRIVED", { driver_id });

    return res.json({
      success: true,
      message: "Driver marked arrived.",
      ride: updatedRide
    });
  } catch (error) {
    console.error("Mark arrived error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to mark driver arrived."
    });
  }
});

app.post("/api/driver/start-trip", async (req, res) => {
  try {
    const { driver_id, ride_id } = req.body;

    if (!driver_id || !ride_id) {
      return res.status(400).json({
        success: false,
        message: "driver_id and ride_id are required."
      });
    }

    const ride = await findOne(
      DATA_FILES.rides,
      (r) => r.ride_id === ride_id && r.driver_id === driver_id,
      []
    );

    if (!ride) {
      return res.status(404).json({
        success: false,
        message: "Assigned ride not found."
      });
    }

    const updatedRide = await updateRide(ride_id, (current) => ({
      ...current,
      ride_status: "IN_PROGRESS",
      mission_status: "IN_PROGRESS",
      dispatch_status: "IN_PROGRESS",
      started_at: nowIso(),
      updated_at: nowIso()
    }));

    await updateDriver(driver_id, (current) => ({
      ...current,
      trip_status: "IN_PROGRESS",
      updated_at: nowIso()
    }));

    const dispatches = await readJson(DATA_FILES.dispatches, []);
    const acceptedDispatch = dispatches.find(
      (d) =>
        d.ride_id === ride_id &&
        d.driver_id === driver_id &&
        normalizeStatus(d.offer_status) === "ACCEPTED"
    );

    if (acceptedDispatch) {
      await updateDispatch(acceptedDispatch.dispatch_id, (current) => ({
        ...current,
        mission_status: "IN_PROGRESS",
        driver_trip_status: "IN_PROGRESS",
        started_at: nowIso()
      }));

      await updateMissionByDispatch(acceptedDispatch.dispatch_id, (mission) => ({
        ...mission,
        mission_status: "IN_PROGRESS",
        driver_trip_status: "IN_PROGRESS",
        started_at: nowIso()
      }));
    }

    await logRideEvent(updatedRide, "TRIP_STARTED", { driver_id });

    return res.json({
      success: true,
      message: "Trip started successfully.",
      ride: updatedRide
    });
  } catch (error) {
    console.error("Start trip error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to start trip."
    });
  }
});

app.post("/api/driver/complete-trip", async (req, res) => {
  try {
    const { driver_id, ride_id, final_fare, tip_amount } = req.body;

    if (!driver_id || !ride_id) {
      return res.status(400).json({
        success: false,
        message: "driver_id and ride_id are required."
      });
    }

    const ride = await findOne(
      DATA_FILES.rides,
      (r) => r.ride_id === ride_id && r.driver_id === driver_id,
      []
    );

    if (!ride) {
      return res.status(404).json({
        success: false,
        message: "Assigned ride not found."
      });
    }

    const baseFare = final_fare != null ? Number(final_fare) : Number(ride.estimated_fare || 0);
    const safeTip = tip_amount != null ? Number(tip_amount) : Number(ride.tip_amount || 0);
    const totalFare = round2(baseFare);
    const totalTip = round2(safeTip);
    const driverPayout = round2(Number(ride.estimated_driver_payout || 0) + totalTip);

    const updatedRide = await updateRide(ride_id, (current) => ({
      ...current,
      ride_status: "COMPLETED",
      mission_status: "COMPLETED",
      dispatch_status: "COMPLETED",
      payout_status: "POSTED",
      payment_status:
        current.payment_status === "NOT_REQUIRED" ? "NOT_REQUIRED" : "CAPTURED",
      final_fare: totalFare,
      tip_amount: totalTip,
      final_driver_payout: driverPayout,
      completed_at: nowIso(),
      updated_at: nowIso()
    }));

    await updateDriver(driver_id, (current) => ({
      ...current,
      current_ride_id: null,
      current_dispatch_id: null,
      trip_status: "AVAILABLE",
      online_status: current.online_status || "ONLINE",
      updated_at: nowIso()
    }));

    const dispatches = await readJson(DATA_FILES.dispatches, []);
    const acceptedDispatch = dispatches.find(
      (d) =>
        d.ride_id === ride_id &&
        d.driver_id === driver_id &&
        normalizeStatus(d.offer_status) === "ACCEPTED"
    );

    if (acceptedDispatch) {
      await updateDispatch(acceptedDispatch.dispatch_id, (current) => ({
        ...current,
        mission_status: "COMPLETED",
        driver_trip_status: "COMPLETED",
        completed_at: nowIso()
      }));

      await updateMissionByDispatch(acceptedDispatch.dispatch_id, (mission) => ({
        ...mission,
        mission_status: "COMPLETED",
        driver_trip_status: "COMPLETED",
        final_fare: totalFare,
        tip_amount: totalTip,
        final_driver_payout: driverPayout,
        completed_at: nowIso()
      }));
    }

    await logRideEvent(updatedRide, "TRIP_COMPLETED", {
      driver_id,
      final_fare: totalFare,
      tip_amount: totalTip,
      final_driver_payout: driverPayout
    });

    return res.json({
      success: true,
      message: "Trip completed successfully.",
      ride: updatedRide
    });
  } catch (error) {
    console.error("Complete trip error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to complete trip."
    });
  }
});

/* =========================================================
   RIDER TIP
========================================================= */
app.post("/api/rides/:rideId/tip", async (req, res) => {
  try {
    const { rideId } = req.params;
    const { tip_amount } = req.body;

    const ride = await findOne(DATA_FILES.rides, (r) => r.ride_id === rideId, []);
    if (!ride) {
      return res.status(404).json({
        success: false,
        message: "Ride not found."
      });
    }

    const nextTip = round2(Number(tip_amount || 0));
    if (nextTip < 0) {
      return res.status(400).json({
        success: false,
        message: "Tip amount cannot be negative."
      });
    }

    const updatedRide = await updateRide(rideId, (current) => ({
      ...current,
      tip_amount: nextTip,
      final_driver_payout: round2(
        Number(current.final_driver_payout || current.estimated_driver_payout || 0) + nextTip
      ),
      updated_at: nowIso()
    }));

    await logRideEvent(updatedRide, "TIP_ADDED", {
      ride_id: rideId,
      tip_amount: nextTip
    });

    return res.json({
      success: true,
      message: "Tip added successfully.",
      ride: updatedRide
    });
  } catch (error) {
    console.error("Tip error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to add tip."
    });
  }
});

/* =========================================================
   ADMIN / DISPATCH VIEW
========================================================= */
app.get("/api/admin/rides", async (req, res) => {
  try {
    const rides = await readJson(DATA_FILES.rides, []);
    const sorted = rides.sort(
      (a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0)
    );

    return res.json({
      success: true,
      rides: sorted
    });
  } catch (error) {
    console.error("Admin rides error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to load rides."
    });
  }
});

app.get("/api/admin/dispatches", async (req, res) => {
  try {
    const dispatches = await readJson(DATA_FILES.dispatches, []);
    const sorted = dispatches.sort(
      (a, b) => new Date(b.offered_at || b.created_at || 0) - new Date(a.offered_at || a.created_at || 0)
    );

    return res.json({
      success: true,
      dispatches: sorted
    });
  } catch (error) {
    console.error("Admin dispatches error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to load dispatches."
    });
  }
});

app.get("/api/admin/messages", async (req, res) => {
  try {
    const messages = await readJson(DATA_FILES.messages, []);
    const sorted = messages.sort(
      (a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0)
    );

    return res.json({
      success: true,
      messages: sorted
    });
  } catch (error) {
    console.error("Admin messages error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to load messages."
    });
  }
});

/* =========================================================
   MANUAL ADMIN RIDER APPROVAL
========================================================= */
app.post("/api/admin/approve-rider", async (req, res) => {
  try {
    const { rider_id } = req.body;

    if (!rider_id) {
      return res.status(400).json({
        success: false,
        message: "rider_id is required."
      });
    }

    const rider = await updateJsonItem(
      DATA_FILES.riders,
      (item) => item.rider_id === rider_id,
      (current) => ({
        ...current,
        verification_status: "APPROVED",
        ride_access_enabled: true,
        updated_at: nowIso()
      }),
      []
    );

    if (!rider) {
      return res.status(404).json({
        success: false,
        message: "Rider not found."
      });
    }

    return res.json({
      success: true,
      message: "Rider approved successfully.",
      rider
    });
  } catch (error) {
    console.error("Approve rider error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to approve rider."
    });
  }
});

/* =========================================================
   DRIVER SIGNUP PLACEHOLDER COMPATIBILITY
========================================================= */
app.post("/api/driver-signup", async (req, res) => {
  try {
    const {
      fullName,
      phone,
      email,
      address,
      vehicleMake,
      vehicleModel,
      vehicleYear,
      licensePlate
    } = req.body;

    if (!fullName || !phone || !email) {
      return res.status(400).json({
        success: false,
        message: "Full name, phone, and email are required."
      });
    }

    const existingDrivers = await readJson(DATA_FILES.drivers, []);
    const existing = existingDrivers.find(
      (d) =>
        String(d.email || "").toLowerCase() === String(email).toLowerCase() ||
        String(d.phone || "") === String(phone)
    );

    if (existing) {
      return res.status(409).json({
        success: false,
        message: "A driver account already exists with this email or phone number."
      });
    }

    const driver = {
      driver_id: generateId("driver"),
      full_name: fullName,
      first_name: String(fullName).trim().split(" ")[0] || fullName,
      phone,
      email,
      address: address || "",
      vehicle_make: vehicleMake || "",
      vehicle_model: vehicleModel || "",
      vehicle_year: vehicleYear || "",
      license_plate: licensePlate || "",
      approval_status: "PENDING",
      background_check_status: "PENDING",
      verification_status: "PENDING",
      online_status: "OFFLINE",
      service_status: "INACTIVE",
      trip_status: "AVAILABLE",
      current_ride_id: null,
      acceptance_score: 0,
      rating: 5,
      created_at: nowIso(),
      updated_at: nowIso()
    };

    await appendJson(DATA_FILES.drivers, driver, []);

    return res.status(201).json({
      success: true,
      message: "Driver account created successfully. Verification review has started.",
      driver
    });
  } catch (error) {
    console.error("Driver signup error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to create driver account."
    });
  }
});

/* =========================================================
   STATIC PAGE FALLBACK
========================================================= */
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

/* =========================================================
   API 404
========================================================= */
app.use("/api/*", (req, res) => {
  res.status(404).json({
    success: false,
    message: `Route not found: ${req.method} ${req.originalUrl}`
  });
});

/* =========================================================
   START
========================================================= */
initializeFiles()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Harvey Taxi server running on port ${PORT}`);
    });
  })
  .catch((error) => {
    console.error("Failed to initialize files:", error);
    process.exit(1);
  });      updated_at: nowIso()
    })
    .eq("id", rideId)
    .select()
    .single();

  if (updateRideResult.error) {
    throw new Error(mapDbError(updateRideResult.error));
  }

  await logTripEvent(rideId, "driver_offered", {
    driverId: best.driver.id,
    attemptNumber: currentAttempt,
    score: best.score
  });

  return {
    message: "Driver offer created.",
    ride: updateRideResult.data,
    offeredDriver: best.driver,
    score: best.score
  };
}

/* =========================================================
   RIDES / REQUEST RIDE
========================================================= */
app.post("/api/request-ride", async (req, res) => {
  try {
    const {
      riderId,
      pickupAddress,
      dropoffAddress,
      rideType = "standard",
      notes = "",
      paymentMethod = "card"
    } = req.body;

    if (!riderId || !pickupAddress || !dropoffAddress) {
      return res.status(400).json({
        error: "riderId, pickupAddress, and dropoffAddress are required."
      });
    }

    const riderResult = await supabase
      .from("riders")
      .select("*")
      .eq("id", riderId)
      .maybeSingle();

    if (riderResult.error) {
      return res.status(500).json({ error: mapDbError(riderResult.error) });
    }

    if (!riderResult.data) {
      return res.status(404).json({ error: "Rider not found." });
    }

    if (!isApprovedRider(riderResult.data)) {
      return res.status(403).json({
        error: "Rider verification must be approved before requesting a ride."
      });
    }

    const onlineDrivers = await getApprovedOnlineDrivers();
    const fare = calculateFare({
      pickupAddress,
      dropoffAddress,
      rideType,
      onlineDriversCount: onlineDrivers.length
    });

    const paymentResult = await supabase
      .from("payments")
      .select("*")
      .eq("rider_id", riderId)
      .eq("status", "authorized")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (paymentResult.error) {
      return res.status(500).json({ error: mapDbError(paymentResult.error) });
    }

    if (!paymentAuthorized(paymentResult.data)) {
      return res.status(403).json({
        error: "Payment authorization is required before requesting a ride."
      });
    }

    const rideId = generateId("ride");

    const ridePayload = {
      id: rideId,
      rider_id: riderId,
      driver_id: null,
      status: "requested",
      ride_type: rideType,
      pickup_address: pickupAddress,
      dropoff_address: dropoffAddress,
      notes,
      total_fare: fare.totalFare,
      driver_payout: fare.driverPayout,
      platform_revenue: fare.platformRevenue,
      distance_miles: fare.distanceMiles,
      duration_minutes: fare.durationMinutes,
      surge_multiplier: fare.surgeMultiplier,
      booking_fee: fare.bookingFee,
      estimated_eta_minutes: fare.durationMinutes,
      current_dispatch_attempt: 0,
      dispatch_status: "queued",
      payment_status: "authorized",
      requested_at: nowIso(),
      created_at: nowIso(),
      updated_at: nowIso()
    };

    const insertRide = await supabase
      .from("rides")
      .insert([ridePayload])
      .select()
      .single();

    if (insertRide.error) {
      return res.status(500).json({ error: mapDbError(insertRide.error) });
    }

    await supabase
      .from("payments")
      .update({
        ride_id: rideId,
        method: paymentMethod,
        updated_at: nowIso()
      })
      .eq("id", paymentResult.data.id);

    await logTripEvent(rideId, "ride_requested", {
      riderId,
      pickupAddress,
      dropoffAddress,
      rideType
    });

    let dispatchResult = null;
    try {
      dispatchResult = await runAutonomousDispatch(rideId);
    } catch (dispatchError) {
      console.error("Autonomous dispatch failed:", dispatchError.message);
    }

    res.json({
      success: true,
      message: "Ride requested successfully.",
      ride: insertRide.data,
      dispatch: dispatchResult
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/rides", async (req, res) => {
  const { status, riderId, driverId } = req.query;

  let query = supabase
    .from("rides")
    .select("*")
    .order("created_at", { ascending: false });

  if (status) query = query.eq("status", status);
  if (riderId) query = query.eq("rider_id", riderId);
  if (driverId) query = query.eq("driver_id", driverId);

  const { data, error } = await query;

  if (error) return res.status(500).json({ error: mapDbError(error) });
  res.json(data || []);
});

app.get("/api/rides/:id", async (req, res) => {
  const { data, error } = await supabase
    .from("rides")
    .select("*")
    .eq("id", req.params.id)
    .maybeSingle();

  if (error) return res.status(500).json({ error: mapDbError(error) });
  if (!data) return res.status(404).json({ error: "Ride not found." });

  res.json(data);
});

app.post("/api/rides/:id/dispatch/retry", async (req, res) => {
  try {
    const result = await runAutonomousDispatch(req.params.id);
    res.json({
      success: true,
      ...result
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/* =========================================================
   DRIVER MISSIONS / DISPATCH ACTIONS
========================================================= */
app.get("/api/drivers/:id/missions", async (req, res) => {
  const { data, error } = await supabase
    .from("missions")
    .select("*")
    .eq("driver_id", req.params.id)
    .order("created_at", { ascending: false });

  if (error) return res.status(500).json({ error: mapDbError(error) });
  res.json(data || []);
});

app.get("/api/rides/:id/dispatches", async (req, res) => {
  const { data, error } = await supabase
    .from("dispatches")
    .select("*")
    .eq("ride_id", req.params.id)
    .order("created_at", { ascending: false });

  if (error) return res.status(500).json({ error: mapDbError(error) });
  res.json(data || []);
});

app.post("/api/rides/:rideId/accept", async (req, res) => {
  try {
    const { driverId } = req.body;
    const { rideId } = req.params;

    if (!driverId) {
      return res.status(400).json({ error: "driverId is required." });
    }

    const rideResult = await supabase
      .from("rides")
      .select("*")
      .eq("id", rideId)
      .maybeSingle();

    if (rideResult.error) {
      return res.status(500).json({ error: mapDbError(rideResult.error) });
    }

    if (!rideResult.data) {
      return res.status(404).json({ error: "Ride not found." });
    }

    const ride = rideResult.data;

    if (ride.driver_id && ride.driver_id !== driverId) {
      return res.status(409).json({ error: "Ride already accepted by another driver." });
    }

    if (statusRank(ride.status) >= statusRank("accepted")) {
      return res.status(409).json({ error: "Ride is no longer available for acceptance." });
    }

    const driverResult = await supabase
      .from("drivers")
      .select("*")
      .eq("id", driverId)
      .maybeSingle();

    if (driverResult.error) {
      return res.status(500).json({ error: mapDbError(driverResult.error) });
    }

    if (!driverResult.data) {
      return res.status(404).json({ error: "Driver not found." });
    }

    if (!isApprovedDriver(driverResult.data)) {
      return res.status(403).json({ error: "Driver is not approved." });
    }

    const rideUpdate = await supabase
      .from("rides")
      .update({
        driver_id: driverId,
        status: "accepted",
        dispatch_status: "accepted",
        accepted_at: nowIso(),
        updated_at: nowIso()
      })
      .eq("id", rideId)
      .select()
      .single();

    if (rideUpdate.error) {
      return res.status(500).json({ error: mapDbError(rideUpdate.error) });
    }

    await supabase
      .from("dispatches")
      .update({
        offer_status: "accepted",
        updated_at: nowIso()
      })
      .eq("ride_id", rideId)
      .eq("driver_id", driverId);

    await supabase
      .from("dispatches")
      .update({
        offer_status: "closed",
        updated_at: nowIso()
      })
      .eq("ride_id", rideId)
      .neq("driver_id", driverId);

    await supabase
      .from("missions")
      .update({
        mission_status: "accepted",
        updated_at: nowIso()
      })
      .eq("ride_id", rideId)
      .eq("driver_id", driverId);

    await supabase
      .from("missions")
      .update({
        mission_status: "closed",
        updated_at: nowIso()
      })
      .eq("ride_id", rideId)
      .neq("driver_id", driverId);

    await logTripEvent(rideId, "ride_accepted", {
      driverId
    });

    res.json({
      success: true,
      message: "Ride accepted successfully.",
      ride: rideUpdate.data
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/rides/:rideId/decline", async (req, res) => {
  try {
    const { driverId, reason = "Driver declined mission." } = req.body;
    const { rideId } = req.params;

    if (!driverId) {
      return res.status(400).json({ error: "driverId is required." });
    }

    await supabase
      .from("dispatches")
      .update({
        offer_status: "declined",
        reason,
        updated_at: nowIso()
      })
      .eq("ride_id", rideId)
      .eq("driver_id", driverId);

    await supabase
      .from("missions")
      .update({
        mission_status: "declined",
        updated_at: nowIso()
      })
      .eq("ride_id", rideId)
      .eq("driver_id", driverId);

    await logTripEvent(rideId, "ride_declined", {
      driverId,
      reason
    });

    const retryResult = await runAutonomousDispatch(rideId);

    res.json({
      success: true,
      message: "Ride declined. Dispatch retried.",
      dispatch: retryResult
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/* =========================================================
   TRIP LIFECYCLE
========================================================= */
app.patch("/api/rides/:rideId/status", async (req, res) => {
  try {
    const { status, driverId } = req.body;
    const { rideId } = req.params;

    const allowedStatuses = [
      "arriving",
      "driver_arrived",
      "in_progress",
      "completed",
      "cancelled"
    ];

    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({ error: "Invalid ride status update." });
    }

    const rideResult = await supabase
      .from("rides")
      .select("*")
      .eq("id", rideId)
      .maybeSingle();

    if (rideResult.error) {
      return res.status(500).json({ error: mapDbError(rideResult.error) });
    }

    if (!rideResult.data) {
      return res.status(404).json({ error: "Ride not found." });
    }

    const ride = rideResult.data;

    if (driverId && ride.driver_id && ride.driver_id !== driverId) {
      return res.status(403).json({ error: "Only the assigned driver can update this ride." });
    }

    const updatePayload = {
      status,
      updated_at: nowIso()
    };

    if (status === "in_progress") updatePayload.started_at = nowIso();
    if (status === "completed") updatePayload.completed_at = nowIso();
    if (status === "cancelled") updatePayload.cancelled_at = nowIso();

    if (status === "completed") {
      updatePayload.payment_status = "captured";
    }

    const rideUpdate = await supabase
      .from("rides")
      .update(updatePayload)
      .eq("id", rideId)
      .select()
      .single();

    if (rideUpdate.error) {
      return res.status(500).json({ error: mapDbError(rideUpdate.error) });
    }

    if (status === "completed") {
      await supabase
        .from("payments")
        .update({
          status: "captured",
          updated_at: nowIso()
        })
        .eq("ride_id", rideId);

      if (ride.driver_id) {
        const driverResult = await supabase
          .from("drivers")
          .select("*")
          .eq("id", ride.driver_id)
          .maybeSingle();

        if (driverResult.data) {
          const newWalletBalance =
            round2(Number(driverResult.data.wallet_balance || 0) + Number(ride.driver_payout || 0));

          await supabase
            .from("drivers")
            .update({
              wallet_balance: newWalletBalance,
              updated_at: nowIso()
            })
            .eq("id", ride.driver_id);
        }
      }

      await supabase
        .from("missions")
        .update({
          mission_status: "completed",
          updated_at: nowIso()
        })
        .eq("ride_id", rideId);
    }

    if (status === "cancelled") {
      await supabase
        .from("missions")
        .update({
          mission_status: "cancelled",
          updated_at: nowIso()
        })
        .eq("ride_id", rideId);

      await supabase
        .from("dispatches")
        .update({
          offer_status: "cancelled",
          updated_at: nowIso()
        })
        .eq("ride_id", rideId);
    }

    await logTripEvent(rideId, `ride_${status}`, {
      driverId: driverId || ride.driver_id || null
    });

    res.json({
      success: true,
      ride: rideUpdate.data
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/* =========================================================
   TIPS
========================================================= */
app.post("/api/rides/:rideId/tip", async (req, res) => {
  try {
    const { riderId, driverId, amount, phase = "post_trip" } = req.body;
    const { rideId } = req.params;

    if (!riderId || !driverId || !amount) {
      return res.status(400).json({
        error: "riderId, driverId, and amount are required."
      });
    }

    if (!["in_trip", "post_trip"].includes(phase)) {
      return res.status(400).json({
        error: "phase must be in_trip or post_trip."
      });
    }

    const tipAmount = round2(amount);

    const tipInsert = await supabase
      .from("tips")
      .insert([
        {
          id: generateId("tip"),
          ride_id: rideId,
          rider_id: riderId,
          driver_id: driverId,
          amount: tipAmount,
          phase,
          created_at: nowIso()
        }
      ])
      .select()
      .single();

    if (tipInsert.error) {
      return res.status(500).json({ error: mapDbError(tipInsert.error) });
    }

    const driverResult = await supabase
      .from("drivers")
      .select("*")
      .eq("id", driverId)
      .maybeSingle();

    if (driverResult.data) {
      const newWalletBalance =
        round2(Number(driverResult.data.wallet_balance || 0) + tipAmount);

      await supabase
        .from("drivers")
        .update({
          wallet_balance: newWalletBalance,
          updated_at: nowIso()
        })
        .eq("id", driverId);
    }

    await logTripEvent(rideId, "tip_added", {
      riderId,
      driverId,
      amount: tipAmount,
      phase
    });

    res.json({
      success: true,
      tip: tipInsert.data
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/rides/:rideId/tips", async (req, res) => {
  const { data, error } = await supabase
    .from("tips")
    .select("*")
    .eq("ride_id", req.params.rideId)
    .order("created_at", { ascending: false });

  if (error) return res.status(500).json({ error: mapDbError(error) });
  res.json(data || []);
});

/* =========================================================
   TRIP EVENTS
========================================================= */
app.get("/api/rides/:rideId/events", async (req, res) => {
  const { data, error } = await supabase
    .from("trip_events")
    .select("*")
    .eq("ride_id", req.params.rideId)
    .order("created_at", { ascending: true });

  if (error) return res.status(500).json({ error: mapDbError(error) });
  res.json(data || []);
});

/* =========================================================
   ADMIN / ANALYTICS
========================================================= */
app.get("/api/admin/analytics", async (req, res) => {
  try {
    const ridesResult = await supabase.from("rides").select("*");
    const driversResult = await supabase.from("drivers").select("*");
    const ridersResult = await supabase.from("riders").select("*");
    const tipsResult = await supabase.from("tips").select("*");
    const paymentsResult = await supabase.from("payments").select("*");

    if (ridesResult.error) return res.status(500).json({ error: mapDbError(ridesResult.error) });
    if (driversResult.error) return res.status(500).json({ error: mapDbError(driversResult.error) });
    if (ridersResult.error) return res.status(500).json({ error: mapDbError(ridersResult.error) });
    if (tipsResult.error) return res.status(500).json({ error: mapDbError(tipsResult.error) });
    if (paymentsResult.error) return res.status(500).json({ error: mapDbError(paymentsResult.error) });

    const rides = ridesResult.data || [];
    const drivers = driversResult.data || [];
    const riders = ridersResult.data || [];
    const tips = tipsResult.data || [];
    const payments = paymentsResult.data || [];

    const completedRides = rides.filter(r => r.status === "completed");
    const activeRides = rides.filter(r =>
      ["requested", "dispatching", "offered", "accepted", "arriving", "driver_arrived", "in_progress"].includes(r.status)
    );
    const approvedDrivers = drivers.filter(isApprovedDriver);
    const onlineDrivers = approvedDrivers.filter(d => d.is_online);
    const approvedRiders = riders.filter(isApprovedRider);

    const grossRevenue = round2(
      completedRides.reduce((sum, r) => sum + Number(r.total_fare || 0), 0)
    );

    const driverPayouts = round2(
      completedRides.reduce((sum, r) => sum + Number(r.driver_payout || 0), 0)
    );

    const platformRevenue = round2(
      completedRides.reduce((sum, r) => sum + Number(r.platform_revenue || 0), 0)
    );

    const tipsTotal = round2(
      tips.reduce((sum, t) => sum + Number(t.amount || 0), 0)
    );

    const authorizedPayments = payments.filter(p => p.status === "authorized").length;
    const capturedPayments = payments.filter(p => p.status === "captured").length;

    res.json({
      success: true,
      analytics: {
        totalRides: rides.length,
        activeRides: activeRides.length,
        completedRides: completedRides.length,
        totalDrivers: drivers.length,
        approvedDrivers: approvedDrivers.length,
        onlineDrivers: onlineDrivers.length,
        totalRiders: riders.length,
        approvedRiders: approvedRiders.length,
        grossRevenue,
        driverPayouts,
        platformRevenue,
        tipsTotal,
        authorizedPayments,
        capturedPayments
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/admin/live-board", async (req, res) => {
  try {
    const ridesResult = await supabase
      .from("rides")
      .select("*")
      .in("status", ["requested", "dispatching", "offered", "accepted", "arriving", "driver_arrived", "in_progress"])
      .order("created_at", { ascending: false });

    const driversResult = await supabase
      .from("drivers")
      .select("*")
      .order("updated_at", { ascending: false });

    if (ridesResult.error) return res.status(500).json({ error: mapDbError(ridesResult.error) });
    if (driversResult.error) return res.status(500).json({ error: mapDbError(driversResult.error) });

    res.json({
      success: true,
      activeRides: ridesResult.data || [],
      drivers: driversResult.data || []
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/* =========================================================
   PERSONA / CHECKR WEBHOOK PLACEHOLDERS
   Replace verification of signatures when you wire live services.
========================================================= */
app.post("/api/webhooks/persona", async (req, res) => {
  try {
    const payload = req.body || {};
    const inquiryId =
      payload?.data?.id ||
      payload?.inquiryId ||
      null;

    const attributes =
      payload?.data?.attributes ||
      payload?.attributes ||
      {};

    const referenceId =
      attributes.reference_id ||      attributes.reference_id ||
      payload?.referenceId ||
      payload?.reference_id ||
      null;

    const statusRaw =
      attributes.status ||
      payload?.status ||
      payload?.data?.attributes?.status ||
      "";

    const status = String(statusRaw).toLowerCase();

    if (!referenceId) {
      return res.status(200).json({
        success: true,
        message: "Persona webhook received without referenceId."
      });
    }

    const isApproved =
      status.includes("approved") ||
      status.includes("completed") ||
      status.includes("passed");

    const isRejected =
      status.includes("failed") ||
      status.includes("declined") ||
      status.includes("rejected");

    if (String(referenceId).startsWith("rider_")) {
      const riderUpdate = await supabase
        .from("riders")
        .update({
          verification_status: isApproved ? "approved" : isRejected ? "rejected" : "pending",
          persona_inquiry_id: inquiryId,
          updated_at: nowIso()
        })
        .eq("id", referenceId)
        .select()
        .single();

      if (riderUpdate.error) {
        return res.status(500).json({ error: mapDbError(riderUpdate.error) });
      }

      await logTripEvent(`rider_verification_${referenceId}`, "persona_rider_webhook", {
        riderId: referenceId,
        inquiryId,
        status
      });

      return res.json({
        success: true,
        type: "rider",
        rider: riderUpdate.data
      });
    }

    if (String(referenceId).startsWith("driver_")) {
      const driverUpdate = await supabase
        .from("drivers")
        .update({
          verification_status: isApproved ? "approved" : isRejected ? "rejected" : "pending",
          persona_inquiry_id: inquiryId,
          updated_at: nowIso()
        })
        .eq("id", referenceId)
        .select()
        .single();

      if (driverUpdate.error) {
        return res.status(500).json({ error: mapDbError(driverUpdate.error) });
      }

      const shouldActivate =
        driverUpdate.data.verification_status === "approved" &&
        driverUpdate.data.background_check_status === "approved";

      let finalDriver = driverUpdate.data;

      if (shouldActivate && driverUpdate.data.is_active !== true) {
        const activationUpdate = await supabase
          .from("drivers")
          .update({
            is_active: true,
            updated_at: nowIso()
          })
          .eq("id", referenceId)
          .select()
          .single();

        if (!activationUpdate.error && activationUpdate.data) {
          finalDriver = activationUpdate.data;
        }
      }

      await logTripEvent(`driver_verification_${referenceId}`, "persona_driver_webhook", {
        driverId: referenceId,
        inquiryId,
        status
      });

      return res.json({
        success: true,
        type: "driver",
        driver: finalDriver
      });
    }

    return res.status(200).json({
      success: true,
      message: "Persona webhook received, but referenceId was not recognized."
    });
  } catch (error) {
    console.error("Persona webhook error:", error);
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/webhooks/checkr", async (req, res) => {
  try {
    const payload = req.body || {};

    const candidateId =
      payload?.data?.object?.candidate_id ||
      payload?.candidate_id ||
      payload?.candidateId ||
      null;

    const reportId =
      payload?.data?.object?.id ||
      payload?.report_id ||
      payload?.reportId ||
      null;

    const statusRaw =
      payload?.data?.object?.status ||
      payload?.status ||
      payload?.event ||
      "";

    const status = String(statusRaw).toLowerCase();

    if (!candidateId) {
      return res.status(200).json({
        success: true,
        message: "Checkr webhook received without candidateId."
      });
    }

    const driverLookup = await supabase
      .from("drivers")
      .select("*")
      .eq("checkr_candidate_id", candidateId)
      .maybeSingle();

    if (driverLookup.error) {
      return res.status(500).json({ error: mapDbError(driverLookup.error) });
    }

    if (!driverLookup.data) {
      return res.status(200).json({
        success: true,
        message: "No driver matched this Checkr candidate."
      });
    }

    const driver = driverLookup.data;

    const backgroundApproved =
      status.includes("clear") ||
      status.includes("complete") ||
      status.includes("completed") ||
      status.includes("approved") ||
      status.includes("passed");

    const backgroundRejected =
      status.includes("consider") ||
      status.includes("suspended") ||
      status.includes("failed") ||
      status.includes("rejected");

    const backgroundStatus = backgroundApproved
      ? "approved"
      : backgroundRejected
      ? "rejected"
      : "pending";

    const driverUpdate = await supabase
      .from("drivers")
      .update({
        background_check_status: backgroundStatus,
        updated_at: nowIso()
      })
      .eq("id", driver.id)
      .select()
      .single();

    if (driverUpdate.error) {
      return res.status(500).json({ error: mapDbError(driverUpdate.error) });
    }

    const shouldActivate =
      driverUpdate.data.verification_status === "approved" &&
      driverUpdate.data.background_check_status === "approved";

    let finalDriver = driverUpdate.data;

    if (shouldActivate && driverUpdate.data.is_active !== true) {
      const activationUpdate = await supabase
        .from("drivers")
        .update({
          is_active: true,
          updated_at: nowIso()
        })
        .eq("id", driver.id)
        .select()
        .single();

      if (!activationUpdate.error && activationUpdate.data) {
        finalDriver = activationUpdate.data;
      }
    }

    await logTripEvent(`driver_background_${driver.id}`, "checkr_webhook", {
      driverId: driver.id,
      candidateId,
      reportId,
      status
    });

    res.json({
      success: true,
      driver: finalDriver
    });
  } catch (error) {
    console.error("Checkr webhook error:", error);
    res.status(500).json({ error: error.message });
  }
});

/* =========================================================
   ADMIN / REVIEW TOOLS
========================================================= */
app.get("/api/admin/riders/pending", async (req, res) => {
  const { data, error } = await supabase
    .from("riders")
    .select("*")
    .eq("verification_status", "pending")
    .order("created_at", { ascending: false });

  if (error) return res.status(500).json({ error: mapDbError(error) });
  res.json(data || []);
});

app.get("/api/admin/drivers/pending", async (req, res) => {
  const { data, error } = await supabase
    .from("drivers")
    .select("*")
    .or("verification_status.eq.pending,background_check_status.eq.pending")
    .order("created_at", { ascending: false });

  if (error) return res.status(500).json({ error: mapDbError(error) });
  res.json(data || []);
});

app.post("/api/admin/riders/:id/approve", async (req, res) => {
  const { data, error } = await supabase
    .from("riders")
    .update({
      verification_status: "approved",
      updated_at: nowIso()
    })
    .eq("id", req.params.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: mapDbError(error) });
  res.json({ success: true, rider: data });
});

app.post("/api/admin/drivers/:id/approve", async (req, res) => {
  const driverResult = await supabase
    .from("drivers")
    .select("*")
    .eq("id", req.params.id)
    .maybeSingle();

  if (driverResult.error) {
    return res.status(500).json({ error: mapDbError(driverResult.error) });
  }

  if (!driverResult.data) {
    return res.status(404).json({ error: "Driver not found." });
  }

  const updated = await supabase
    .from("drivers")
    .update({
      verification_status: "approved",
      background_check_status:
        driverResult.data.background_check_status === "approved"
          ? "approved"
          : driverResult.data.background_check_status,
      is_active:
        driverResult.data.background_check_status === "approved" ? true : false,
      updated_at: nowIso()
    })
    .eq("id", req.params.id)
    .select()
    .single();

  if (updated.error) {
    return res.status(500).json({ error: mapDbError(updated.error) });
  }

  res.json({ success: true, driver: updated.data });
});

/* =========================================================
   ROOT + STATIC PAGES
========================================================= */
app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin-dashboard.html"));
});

/* =========================================================
   API 404
========================================================= */
app.use("/api/*", (req, res) => {
  res.status(404).json({
    success: false,
    error: `Route not found: ${req.method} ${req.originalUrl}`
  });
});

/* =========================================================
   SERVER START
========================================================= */
app.listen(PORT, () => {
  console.log(`Harvey Taxi server running on port ${PORT}`);
});
     

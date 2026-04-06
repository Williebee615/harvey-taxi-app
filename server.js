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

function normalizeVerificationStatus(status) {
  return String(status || "").trim().toUpperCase();
}

function isApprovedStatus(status) {
  return normalizeVerificationStatus(status) === "APPROVED";
}

/* ===============================
   BASIC HEALTH
================================ */
app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "Harvey Taxi API is running"
  });
});

/* ===============================
   RIDER SIGNUP
================================ */
app.post("/api/rider-signup", async (req, res) => {
  try {
    const { fullName, phone, email, address } = req.body;

    if (!fullName || !phone || !email || !address) {
      return res.status(400).json({
        success: false,
        message: "Full name, phone, email, and address are required."
      });
    }

    const rider_id = generateId("rider");

    const newRider = {
      rider_id,
      full_name: fullName,
      first_name: String(fullName).trim().split(" ")[0] || fullName,
      phone,
      email,
      address,
      verification_status: "PENDING",
      ride_access_enabled: false,
      created_at: new Date().toISOString()
    };

    const { data, error } = await supabase
      .from("riders")
      .insert([newRider])
      .select()
      .single();

    if (error) {
      console.error("Supabase rider signup error:", error);
      return res.status(500).json({
        success: false,
        message: error.message || "Failed to create rider account."
      });
    }

    return res.status(201).json({
      success: true,
      message: "Rider account created successfully. Verification review has started.",
      rider: data
    });
  } catch (err) {
    console.error("Server rider signup error:", err);
    return res.status(500).json({
      success: false,
      message: "Server error while creating rider account."
    });
  }
});

/* ===============================
   RIDER STATUS
================================ */
app.get("/api/rider-status/:riderId", async (req, res) => {
  try {
    const riderId = req.params.riderId;

    if (!riderId) {
      return res.status(400).json({
        success: false,
        message: "Rider ID is required."
      });
    }

    const { data, error } = await supabase
      .from("riders")
      .select("*")
      .eq("rider_id", riderId)
      .maybeSingle();

    if (error) {
      console.error("Supabase rider status error:", error);
      return res.status(500).json({
        success: false,
        message: error.message || "Unable to check rider status."
      });
    }

    if (!data) {
      return res.status(404).json({
        success: false,
        message: "Rider profile not found."
      });
    }

    return res.json({
      success: true,
      rider: data
    });
  } catch (err) {
    console.error("Server rider status error:", err);
    return res.status(500).json({
      success: false,
      message: "Server error while checking rider status."
    });
  }
});

/* ===============================
   FARE ESTIMATE
================================ */
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
  } catch (err) {
    console.error("Fare estimate error:", err);
    return res.status(500).json({
      success: false,
      message: "Unable to calculate fare estimate."
    });
  }
});

/* ===============================
   PAYMENT AUTHORIZE
================================ */
app.post("/api/payments/authorize", async (req, res) => {
  try {
    const { rider_id, payment_method, estimated_fare, ride_type } = req.body;

    if (!rider_id || !payment_method || !estimated_fare) {
      return res.status(400).json({
        success: false,
        message: "Rider ID, payment method, and estimated fare are required."
      });
    }

    if (payment_method === "CASH" && ride_type !== "NONPROFIT") {
      return res.status(400).json({
        success: false,
        message: "Cash payments are not currently available for this ride type."
      });
    }

    const authorization = {
      authorization_id: generateId("payauth"),
      rider_id,
      payment_method,
      authorized_amount: round2(estimated_fare),
      status: "Secured",
      created_at: new Date().toISOString()
    };

    const { data, error } = await supabase
      .from("payment_authorizations")
      .insert([authorization])
      .select()
      .single();

    if (error) {
      console.error("Supabase payment authorization error:", error);
      return res.status(500).json({
        success: false,
        message: error.message || "Payment authorization failed."
      });
    }

    return res.json({
      success: true,
      message: "Payment secured successfully.",
      authorization: data
    });
  } catch (err) {
    console.error("Payment authorization server error:", err);
    return res.status(500).json({
      success: false,
      message: "Payment service unavailable."
    });
  }
});

/* ===============================
   REQUEST RIDE
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

    if (!rider_id) {
      return res.status(400).json({
        success: false,
        message: "Rider ID is required."
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

    const { data: rider, error: riderError } = await supabase
      .from("riders")
      .select("*")
      .eq("rider_id", rider_id)
      .maybeSingle();

    if (riderError) {
      console.error("Rider lookup error:", riderError);
      return res.status(500).json({
        success: false,
        message: riderError.message || "Unable to verify rider account."
      });
    }

    if (!rider) {
      return res.status(404).json({
        success: false,
        message: "Rider profile not found."
      });
    }

    const riderApproved =
      isApprovedStatus(rider.verification_status) ||
      rider.ride_access_enabled === true;

    if (!riderApproved) {
      return res.status(403).json({
        success: false,
        message: "Your rider account must be approved before you can request a ride."
      });
    }

    let payment_status = "Not Required";
    let payment_authorized = false;

    if (ride_type !== "NONPROFIT") {
      const { data: authData, error: authError } = await supabase
        .from("payment_authorizations")
        .select("*")
        .eq("rider_id", rider_id)
        .order("created_at", { ascending: false })
        .limit(1);

      if (authError) {
        console.error("Payment lookup error:", authError);
        return res.status(500).json({
          success: false,
          message: authError.message || "Unable to verify payment authorization."
        });
      }

      const latestAuth = authData && authData.length ? authData[0] : null;

      if (!latestAuth || String(latestAuth.status).toLowerCase() !== "secured") {
        return res.status(403).json({
          success: false,
          message: "Payment must be secured before your ride can be requested."
        });
      }

      payment_status = "Secured";
      payment_authorized = true;
    }

    const ride = {
      ride_id: generateId("ride"),
      rider_id,
      passenger_first_name,
      passenger_phone,
      pickup_address,
      dropoff_address,
      ride_type: ride_type || "STANDARD",
      scheduled_time: scheduled_time || null,
      special_notes: special_notes || null,
      payment_method,
      payment_status,
      payment_authorized,
      estimated_fare: round2(estimate.estimated_fare),
      estimated_distance_miles: round2(estimate.distance_miles || 0),
      estimated_duration_minutes: Math.round(Number(estimate.duration_minutes || 0)),
      ride_status: "REQUESTED",
      mission_status: "PENDING_DISPATCH",
      created_at: new Date().toISOString()
    };

    const { data, error } = await supabase
      .from("rides")
      .insert([ride])
      .select()
      .single();

    if (error) {
      console.error("Ride insert error:", error);
      return res.status(500).json({
        success: false,
        message: error.message || "Unable to request ride."
      });
    }

    return res.status(201).json({
      success: true,
      message: "Ride requested successfully.",
      ride: data
    });
  } catch (err) {
    console.error("Request ride server error:", err);
    return res.status(500).json({
      success: false,
      message: "Unable to submit ride request."
    });
  }
});

/* ===============================
   STATIC PAGE FALLBACKS
================================ */
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

/* ===============================
   404 API HANDLER
================================ */
app.use("/api/*", (req, res) => {
  res.status(404).json({
    success: false,
    message: `Route not found: ${req.method} ${req.originalUrl}`
  });
});

/* ===============================
   START
================================ */
app.listen(PORT, () => {
  console.log(`Harvey Taxi server running on port ${PORT}`);
});  try {
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
  });

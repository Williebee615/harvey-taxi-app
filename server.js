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
});

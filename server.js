const { createClient } = require("@supabase/supabase-js")
const express = require("express")
const cors = require("cors")
const path = require("path")

const app = express()
const PORT = process.env.PORT || 10000

app.use(cors())
app.use(express.json())
app.use(express.static(path.join(__dirname, "public")))

/* ----------------------------------
   SUPABASE
---------------------------------- */

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
)

/* ----------------------------------
   HELPERS
---------------------------------- */

function uid(prefix = "id") {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`
}

function nowIso() {
  return new Date().toISOString()
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n))
}

function haversineMiles(lat1, lon1, lat2, lon2) {
  const toRad = deg => (deg * Math.PI) / 180
  const R = 3958.8

  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2)

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

function etaMinutesFromDistance(distanceMiles) {
  const avgCityMph = 22
  const minutes = (distanceMiles / avgCityMph) * 60
  return clamp(Math.round(minutes), 1, 45)
}

function progressFromDistance(distanceMiles) {
  if (distanceMiles <= 0.15) return 92
  if (distanceMiles <= 0.4) return 82
  if (distanceMiles <= 0.8) return 70
  if (distanceMiles <= 1.5) return 58
  if (distanceMiles <= 3) return 45
  if (distanceMiles <= 5) return 32
  return 20
}

function classifySupportIssue(text) {
  const msg = String(text || "").toLowerCase()

  const severeWords = [
    "emergency",
    "911",
    "unsafe",
    "assault",
    "harassment",
    "threat",
    "police",
    "crash",
    "accident",
    "injury",
    "fraud",
    "scam",
    "stolen"
  ]

  const refundWords = [
    "refund",
    "charged",
    "double charged",
    "charged twice",
    "billing",
    "payment issue",
    "overcharged"
  ]

  const noShowWords = [
    "no show",
    "never showed",
    "didn't show",
    "driver never came",
    "driver not here",
    "where is my driver"
  ]

  if (severeWords.some(word => msg.includes(word))) {
    return { category: "safety", escalate: true }
  }

  if (refundWords.some(word => msg.includes(word))) {
    return { category: "billing", escalate: true }
  }

  if (noShowWords.some(word => msg.includes(word))) {
    return { category: "no_show", escalate: false }
  }

  return { category: "general", escalate: false }
}

function generateAiSupportReply(ticketText, requesterType = "user") {
  const issue = classifySupportIssue(ticketText)

  if (issue.category === "safety") {
    return {
      reply:
        "Your message has been flagged as a safety issue. Please contact emergency services immediately if anyone is in danger. Harvey Taxi support should review this urgently.",
      escalated: true,
      category: "safety"
    }
  }

  if (issue.category === "billing") {
    return {
      reply:
        "I’m sorry about the billing issue. Please reply with the ride details and what charge looks wrong so support can review it faster.",
      escalated: true,
      category: "billing"
    }
  }

  if (issue.category === "no_show") {
    return {
      reply:
        "I’m sorry your driver did not arrive as expected. Please confirm your pickup location and check your ride status again.",
      escalated: false,
      category: "no_show"
    }
  }

  if (requesterType === "driver") {
    return {
      reply:
        "Thanks for contacting Harvey Taxi driver support. Please share whether your issue is onboarding, ride status, vehicle setup, or earnings.",
      escalated: false,
      category: "general"
    }
  }

  return {
    reply:
      "Thanks for contacting Harvey Taxi support. Your message was received. Please reply with any extra details if needed.",
    escalated: false,
    category: "general"
  }
}

function buildLiveStage(ride) {
  if (!ride) {
    return {
      stage: "searching",
      progress: 15,
      etaMinutes: null,
      liveLabel: "Searching for vehicle"
    }
  }

  if (ride.status === "completed") {
    return {
      stage: "completed",
      progress: 100,
      etaMinutes: 0,
      liveLabel: "Ride completed"
    }
  }

  if (ride.status === "on_trip") {
    return {
      stage: "on_trip",
      progress: 78,
      etaMinutes: null,
      liveLabel: "Ride in progress"
    }
  }

  if (ride.status === "assigned") {
    if (
      typeof ride.dispatch_distance_miles === "number" &&
      ride.dispatch_distance_miles >= 0
    ) {
      return {
        stage: "assigned",
        progress: progressFromDistance(ride.dispatch_distance_miles),
        etaMinutes: etaMinutesFromDistance(ride.dispatch_distance_miles),
        liveLabel: "Driver approaching pickup"
      }
    }

    return {
      stage: "assigned",
      progress: 45,
      etaMinutes: null,
      liveLabel: "Vehicle assigned"
    }
  }

  if (ride.status === "searching") {
    return {
      stage: "searching",
      progress: 15,
      etaMinutes: null,
      liveLabel: "Searching for vehicle"
    }
  }

  return {
    stage: ride.status || "searching",
    progress: 20,
    etaMinutes: null,
    liveLabel: "Ride updating"
  }
}

/* ----------------------------------
   DB HELPERS
---------------------------------- */

async function dbInsert(table, row) {
  const { data, error } = await supabase.from(table).insert([row]).select()
  if (error) throw error
  return data[0]
}

async function dbSelect(table) {
  const { data, error } = await supabase.from(table).select("*")
  if (error) throw error
  return data || []
}

async function dbSingleBy(table, column, value) {
  const { data, error } = await supabase
    .from(table)
    .select("*")
    .eq(column, value)
    .maybeSingle()
  if (error) throw error
  return data
}

async function dbUpdate(table, values, match) {
  const { data, error } = await supabase
    .from(table)
    .update(values)
    .match(match)
    .select()
  if (error) throw error
  return data
}

/* ----------------------------------
   DISPATCH HELPERS
---------------------------------- */

function getDispatchEligibleDrivers(drivers) {
  return drivers.filter(
    d => d.approved === true && d.available === true && d.online === true
  )
}

function autoAssignNearestDriver(ride, drivers) {
  const eligible = getDispatchEligibleDrivers(drivers)
  if (!eligible.length) return null

  if (
    typeof ride.pickup_lat === "number" &&
    typeof ride.pickup_lng === "number"
  ) {
    const ranked = eligible
      .filter(
        d =>
          typeof d.last_lat === "number" &&
          typeof d.last_lng === "number"
      )
      .map(driver => ({
        driver,
        distanceMiles: haversineMiles(
          driver.last_lat,
          driver.last_lng,
          ride.pickup_lat,
          ride.pickup_lng
        )
      }))
      .sort((a, b) => a.distanceMiles - b.distanceMiles)

    if (ranked.length) return ranked[0]
  }

  return {
    driver: eligible[0],
    distanceMiles: null
  }
}

/* ----------------------------------
   STATUS
---------------------------------- */

app.get("/api/status", (req, res) => {
  res.json({
    success: true,
    system: "Harvey Taxi Phase 2 Dispatch Backend",
    time: nowIso()
  })
})

/* ----------------------------------
   RIDER SIGNUP
---------------------------------- */

app.post("/api/rider/signup", async (req, res) => {
  try {
    const rider = {
      id: uid("rider"),
      name: req.body.name || "",
      email: req.body.email || "",
      phone: req.body.phone || "",
      created_at: nowIso()
    }

    const saved = await dbInsert("riders", rider)
    res.json(saved)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

/* ----------------------------------
   DRIVER SIGNUP
---------------------------------- */

app.post("/api/driver/signup", async (req, res) => {
  try {
    const driver = {
      id: uid("driver"),
      name: req.body.name || "",
      email: req.body.email || "",
      phone: req.body.phone || "",
      vehicle: req.body.vehicle || "",
      plate: req.body.plate || "",
      status: "offline",
      approved: false,
      available: false,
      online: false,
      created_at: nowIso()
    }

    const saved = await dbInsert("drivers", driver)
    res.json(saved)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

/* ----------------------------------
   DRIVER GO ONLINE / OFFLINE
---------------------------------- */

app.post("/api/driver/go-online", async (req, res) => {
  try {
    const { driverId, lat, lng } = req.body

    if (!driverId) {
      return res.status(400).json({ error: "driverId required" })
    }

    const update = {
      online: true,
      available: true,
      status: "online"
    }

    if (typeof lat === "number") update.last_lat = lat
    if (typeof lng === "number") update.last_lng = lng
    if (typeof lat === "number" && typeof lng === "number") {
      update.last_gps_at = nowIso()
    }

    const rows = await dbUpdate("drivers", update, { id: driverId })
    res.json({ success: true, driver: rows[0] || null })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

app.post("/api/driver/go-offline", async (req, res) => {
  try {
    const { driverId } = req.body

    if (!driverId) {
      return res.status(400).json({ error: "driverId required" })
    }

    const rows = await dbUpdate(
      "drivers",
      {
        online: false,
        available: false,
        status: "offline"
      },
      { id: driverId }
    )

    res.json({ success: true, driver: rows[0] || null })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

/* ----------------------------------
   DRIVER LOCATION
---------------------------------- */

app.post("/api/driver/location", async (req, res) => {
  try {
    const { driverId, lat, lng } = req.body

    if (!driverId) {
      return res.status(400).json({ error: "driverId required" })
    }

    if (typeof lat !== "number" || typeof lng !== "number") {
      return res.status(400).json({ error: "lat and lng must be numbers" })
    }

    const rows = await dbUpdate(
      "drivers",
      {
        last_lat: lat,
        last_lng: lng,
        last_gps_at: nowIso()
      },
      { id: driverId }
    )

    res.json({ success: true, driver: rows[0] || null })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

/* ----------------------------------
   REQUEST RIDE + AUTO DISPATCH
---------------------------------- */

app.post("/api/request-ride", async (req, res) => {
  try {
    let ride = {
      id: uid("ride"),
      rider_name: req.body.name || "",
      phone: req.body.phone || "",
      pickup: req.body.pickup || "",
      dropoff: req.body.dropoff || "",
      pickup_lat:
        typeof req.body.pickupLat === "number" ? req.body.pickupLat : null,
      pickup_lng:
        typeof req.body.pickupLng === "number" ? req.body.pickupLng : null,
      dropoff_lat:
        typeof req.body.dropoffLat === "number" ? req.body.dropoffLat : null,
      dropoff_lng:
        typeof req.body.dropoffLng === "number" ? req.body.dropoffLng : null,
      status: "searching",
      created_at: nowIso(),
      updated_at: nowIso()
    }

    const drivers = await dbSelect("drivers")
    const match = autoAssignNearestDriver(ride, drivers)

    if (match) {
      const driver = match.driver
      ride.driver_id = driver.id
      ride.status = "assigned"
      ride.dispatch_distance_miles =
        typeof match.distanceMiles === "number"
          ? Number(match.distanceMiles.toFixed(2))
          : null
      ride.assigned_at = nowIso()
      ride.updated_at = nowIso()

      await dbUpdate(
        "drivers",
        {
          available: false,
          status: "assigned"
        },
        { id: driver.id }
      )
    }

    const saved = await dbInsert("rides", ride)

    res.json({
      success: true,
      ride: saved,
      dispatchMode: match ? "auto_dispatch" : "searching"
    })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

/* ----------------------------------
   AUTO ASSIGN EXISTING RIDE
---------------------------------- */

app.post("/api/dispatch/auto-assign", async (req, res) => {
  try {
    const { rideId } = req.body

    if (!rideId) {
      return res.status(400).json({ error: "rideId required" })
    }

    const ride = await dbSingleBy("rides", "id", rideId)
    if (!ride) {
      return res.status(404).json({ error: "Ride not found" })
    }

    if (ride.driver_id) {
      return res.json({ success: true, ride, message: "Ride already assigned" })
    }

    const drivers = await dbSelect("drivers")
    const match = autoAssignNearestDriver(ride, drivers)

    if (!match) {
      return res.json({
        success: true,
        ride,
        dispatchMode: "searching",
        message: "No eligible drivers online"
      })
    }

    await dbUpdate(
      "rides",
      {
        driver_id: match.driver.id,
        status: "assigned",
        dispatch_distance_miles:
          typeof match.distanceMiles === "number"
            ? Number(match.distanceMiles.toFixed(2))
            : null,
        assigned_at: nowIso(),
        updated_at: nowIso()
      },
      { id: rideId }
    )

    await dbUpdate(
      "drivers",
      {
        available: false,
        status: "assigned"
      },
      { id: match.driver.id }
    )

    const updatedRide = await dbSingleBy("rides", "id", rideId)

    res.json({
      success: true,
      ride: updatedRide,
      driver: match.driver
    })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

/* ----------------------------------
   AVAILABLE DRIVERS
---------------------------------- */

app.get("/api/dispatch/available-drivers", async (req, res) => {
  try {
    const drivers = await dbSelect("drivers")
    const eligible = getDispatchEligibleDrivers(drivers)
    res.json(eligible)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

/* ----------------------------------
   DRIVER ACCEPT RIDE
---------------------------------- */

app.post("/api/driver/accept", async (req, res) => {
  try {
    const { rideId, driverId } = req.body

    if (!rideId || !driverId) {
      return res.status(400).json({ error: "rideId and driverId required" })
    }

    const rideRows = await dbUpdate(
      "rides",
      {
        driver_id: driverId,
        status: "assigned",
        assigned_at: nowIso(),
        updated_at: nowIso()
      },
      { id: rideId }
    )

    await dbUpdate(
      "drivers",
      {
        available: false,
        status: "assigned"
      },
      { id: driverId }
    )

    res.json(rideRows[0] || null)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

/* ----------------------------------
   DRIVER UPDATE RIDE STATUS
---------------------------------- */

app.post("/api/driver/status", async (req, res) => {
  try {
    const { rideId, driverId, status } = req.body

    const allowed = ["assigned", "on_trip", "completed", "cancelled"]
    if (!allowed.includes(status)) {
      return res.status(400).json({ error: "Invalid status" })
    }

    const rideRows = await dbUpdate(
      "rides",
      {
        status,
        updated_at: nowIso()
      },
      { id: rideId }
    )

    if (driverId) {
      if (status === "assigned") {
        await dbUpdate(
          "drivers",
          { status: "assigned", available: false },
          { id: driverId }
        )
      }

      if (status === "on_trip") {
        await dbUpdate(
          "drivers",
          { status: "on_trip", available: false },
          { id: driverId }
        )
      }

      if (status === "completed" || status === "cancelled") {
        await dbUpdate(
          "drivers",
          { status: "online", available: true },
          { id: driverId }
        )
      }
    }

    res.json(rideRows[0] || null)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

/* ----------------------------------
   GPS UPDATE
---------------------------------- */

app.post("/api/gps", async (req, res) => {
  try {
    const { driverId, lat, lng } = req.body

    if (!driverId) {
      return res.status(400).json({ error: "driverId required" })
    }

    if (typeof lat !== "number" || typeof lng !== "number") {
      return res.status(400).json({ error: "lat and lng must be numbers" })
    }

    await dbUpdate(
      "drivers",
      {
        last_lat: lat,
        last_lng: lng,
        last_gps_at: nowIso()
      },
      { id: driverId }
    )

    res.json({ success: true })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

/* ----------------------------------
   LIVE RIDE STATUS
---------------------------------- */

app.get("/api/ride/:rideId/live-status", async (req, res) => {
  try {
    const ride = await dbSingleBy("rides", "id", req.params.rideId)
    if (!ride) {
      return res.status(404).json({ error: "Ride not found" })
    }

    let driver = null
    if (ride.driver_id) {
      driver = await dbSingleBy("drivers", "id", ride.driver_id)
    }

    const live = buildLiveStage(ride)

    res.json({
      rideId: ride.id,
      status: ride.status,
      driverId: ride.driver_id || null,
      driverName: driver?.name || null,
      stage: live.stage,
      progress: live.progress,
      etaMinutes: live.etaMinutes,
      liveLabel: live.liveLabel,
      dispatchDistanceMiles: ride.dispatch_distance_miles || null,
      driverLat: null,
      driverLng: null,
      lastGpsUpdate: driver?.last_gps_at || null
    })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

/* ----------------------------------
   RIDES / DRIVERS / RIDERS
---------------------------------- */

app.get("/api/rides", async (req, res) => {
  try {
    const rides = await dbSelect("rides")
    res.json(rides)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

app.get("/api/drivers", async (req, res) => {
  try {
    const drivers = await dbSelect("drivers")
    res.json(drivers)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

app.get("/api/riders", async (req, res) => {
  try {
    const riders = await dbSelect("riders")
    res.json(riders)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

/* ----------------------------------
   CHAT
---------------------------------- */

app.post("/api/chat/send", async (req, res) => {
  try {
    const msg = {
      id: uid("msg"),
      ride_id: req.body.rideId || null,
      sender: req.body.from || "user",
      recipient: req.body.to || "user",
      message: req.body.text || "",
      created_at: nowIso()
    }

    const saved = await dbInsert("messages", msg)
    res.json(saved)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

app.get("/api/chat/:rideId", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("messages")
      .select("*")
      .eq("ride_id", req.params.rideId)
      .order("created_at", { ascending: true })

    if (error) throw error
    res.json(data || [])
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

/* ----------------------------------
   SUPPORT
---------------------------------- */

app.post("/api/support", async (req, res) => {
  try {
    const ticketText = req.body.text || req.body.message || ""
    const requesterType = req.body.requesterType || "user"
    const ai = generateAiSupportReply(ticketText, requesterType)

    const ticket = {
      id: uid("support"),
      requester_type: requesterType,
      user_id: req.body.userId || null,
      text: ticketText,
      status: ai.escalated ? "escalated" : "open",
      category: ai.category,
      escalated: ai.escalated,
      created_at: nowIso()
    }

    await dbInsert("support", ticket)

    res.json({
      reply: ai.reply,
      escalated: ai.escalated,
      category: ai.category
    })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

/* ----------------------------------
   ROOT
---------------------------------- */

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public/index.html"))
})

/* ----------------------------------
   START SERVER
---------------------------------- */

app.listen(PORT, () => {
  console.log("Harvey Taxi Phase 2 running on port " + PORT)
})

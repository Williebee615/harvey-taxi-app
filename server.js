const express = require("express")
const cors = require("cors")
const fs = require("fs")
const path = require("path")
const axios = require("axios")

const app = express()
const PORT = process.env.PORT || 10000

app.use(cors())

app.use("/webhook/persona", express.raw({ type: "*/*" }))
app.use("/webhook/checkr", express.raw({ type: "*/*" }))

app.use((req, res, next) => {
  if (req.path === "/webhook/persona" || req.path === "/webhook/checkr") {
    return next()
  }
  express.json()(req, res, next)
})

app.use(express.static(path.join(__dirname, "public")))

/* ----------------------------------
   ENV
---------------------------------- */

const PERSONA_API_KEY = process.env.PERSONA_API_KEY || ""
const PERSONA_BASE_URL = process.env.PERSONA_BASE_URL || "https://withpersona.com/api/v1"
const PERSONA_RIDER_TEMPLATE_ID = process.env.PERSONA_RIDER_TEMPLATE_ID || ""
const PERSONA_DRIVER_TEMPLATE_ID = process.env.PERSONA_DRIVER_TEMPLATE_ID || ""

const CHECKR_API_KEY = process.env.CHECKR_API_KEY || ""
const CHECKR_BASE_URL = process.env.CHECKR_BASE_URL || "https://api.checkr.com/v1"
const CHECKR_PACKAGE = process.env.CHECKR_PACKAGE || "Harvey Taxi Driver Check"
const CHECKR_WORK_COUNTRY = process.env.CHECKR_WORK_COUNTRY || "US"
const CHECKR_WORK_STATE = process.env.CHECKR_WORK_STATE || "TN"
const CHECKR_WORK_CITY = process.env.CHECKR_WORK_CITY || "Nashville"

/* ----------------------------------
   FILES
---------------------------------- */

const RIDERS_FILE = path.join(__dirname, "riders.json")
const DRIVERS_FILE = path.join(__dirname, "drivers.json")
const RIDES_FILE = path.join(__dirname, "rides.json")
const MESSAGES_FILE = path.join(__dirname, "messages.json")
const SUPPORT_FILE = path.join(__dirname, "support.json")
const GPS_FILE = path.join(__dirname, "gps-locations.json")

function ensure(file) {
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, "[]")
  }
}

;[
  RIDERS_FILE,
  DRIVERS_FILE,
  RIDES_FILE,
  MESSAGES_FILE,
  SUPPORT_FILE,
  GPS_FILE
].forEach(ensure)

function read(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"))
}

function write(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2))
}

function uid(prefix = "id") {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`
}

function nowIso() {
  return new Date().toISOString()
}

function splitName(fullName) {
  const cleaned = String(fullName || "").trim()
  const parts = cleaned.split(/\s+/).filter(Boolean)

  return {
    firstName: parts[0] || "Driver",
    lastName: parts.slice(1).join(" ") || "Applicant"
  }
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

function progressFromDistance(distanceMiles) {
  if (distanceMiles <= 0.15) return 92
  if (distanceMiles <= 0.4) return 82
  if (distanceMiles <= 0.8) return 70
  if (distanceMiles <= 1.5) return 58
  if (distanceMiles <= 3) return 45
  if (distanceMiles <= 5) return 32
  return 20
}

function etaMinutesFromDistance(distanceMiles) {
  const avgCityMph = 22
  const minutes = (distanceMiles / avgCityMph) * 60
  return clamp(Math.round(minutes), 1, 45)
}

function publicVehicleStage(ride, driver, gpsPoint) {
  if (!ride) {
    return {
      stage: "searching",
      progress: 15,
      etaMinutes: null,
      vehicleLabel: "Pending",
      liveLabel: "Searching for vehicle"
    }
  }

  if (ride.status === "completed") {
    return {
      stage: "completed",
      progress: 100,
      etaMinutes: 0,
      vehicleLabel: driver?.name || driver?.vehicle || "Vehicle",
      liveLabel: "Ride completed"
    }
  }

  if (ride.status === "on_trip") {
    return {
      stage: "on_trip",
      progress: 78,
      etaMinutes: null,
      vehicleLabel: driver?.name || driver?.vehicle || "Vehicle",
      liveLabel: "Ride in progress"
    }
  }

  if (ride.status === "assigned") {
    if (
      gpsPoint &&
      typeof ride.pickupLat === "number" &&
      typeof ride.pickupLng === "number"
    ) {
      const distanceMiles = haversineMiles(
        gpsPoint.lat,
        gpsPoint.lng,
        ride.pickupLat,
        ride.pickupLng
      )

      return {
        stage: "assigned",
        progress: progressFromDistance(distanceMiles),
        etaMinutes: etaMinutesFromDistance(distanceMiles),
        vehicleLabel: driver?.name || driver?.vehicle || "Vehicle",
        liveLabel: "Driver approaching pickup"
      }
    }

    return {
      stage: "assigned",
      progress: 45,
      etaMinutes: null,
      vehicleLabel: driver?.name || driver?.vehicle || "Vehicle",
      liveLabel: "Vehicle assigned"
    }
  }

  return {
    stage: "searching",
    progress: 15,
    etaMinutes: null,
    vehicleLabel: "Pending",
    liveLabel: "Searching for vehicle"
  }
}

/* ----------------------------------
   PERSONA
---------------------------------- */

async function createPersona(templateId, ref) {
  const res = await axios.post(
    `${PERSONA_BASE_URL}/inquiries`,
    {
      data: {
        attributes: {
          inquiry_template_id: templateId,
          reference_id: ref
        }
      }
    },
    {
      headers: {
        Authorization: `Bearer ${PERSONA_API_KEY}`,
        "Persona-Version": "2023-01-05",
        "Content-Type": "application/json"
      }
    }
  )

  return res.data.data
}

/* ----------------------------------
   CHECKR
---------------------------------- */

async function createCheckr(driver) {
  const name = splitName(
    `${driver.firstName || ""} ${driver.lastName || ""}`.trim()
  )

  const candidate = await axios.post(
    `${CHECKR_BASE_URL}/candidates`,
    {
      first_name: name.firstName,
      last_name: name.lastName,
      email: driver.email
    },
    {
      auth: { username: CHECKR_API_KEY, password: "" }
    }
  )

  const invite = await axios.post(
    `${CHECKR_BASE_URL}/invitations`,
    {
      candidate_id: candidate.data.id,
      package: CHECKR_PACKAGE,
      work_locations: [
        {
          country: CHECKR_WORK_COUNTRY,
          state: CHECKR_WORK_STATE,
          city: CHECKR_WORK_CITY
        }
      ]
    },
    {
      auth: { username: CHECKR_API_KEY, password: "" }
    }
  )

  return {
    candidate: candidate.data,
    invitation: invite.data
  }
}

/* ----------------------------------
   SUPPORT AI
---------------------------------- */

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

  const accountWords = [
    "login",
    "account",
    "password",
    "verification",
    "persona",
    "checkr",
    "signup"
  ]

  const driverWords = [
    "driver dashboard",
    "earnings",
    "trip",
    "vehicle",
    "background check"
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
  if (accountWords.some(word => msg.includes(word))) {
    return { category: "account", escalate: false }
  }
  if (driverWords.some(word => msg.includes(word))) {
    return { category: "driver_ops", escalate: false }
  }

  return { category: "general", escalate: false }
}

function generateAiSupportReply(ticket, latestMessage) {
  const issue = classifySupportIssue(latestMessage.text || "")
  const senderRole = ticket.requesterType || "user"

  if (issue.category === "safety") {
    return {
      reply:
        "Your message has been flagged as a safety issue. Please contact emergency services immediately if anyone is in danger. I have escalated this to Harvey Taxi support for urgent review.",
      escalate: true,
      status: "escalated",
      category: "safety"
    }
  }

  if (issue.category === "billing") {
    return {
      reply:
        "I’m sorry about the billing issue. I’ve flagged this ticket for support review. Please send the trip details, ride date, and what charge looks incorrect so the team can review it faster.",
      escalate: true,
      status: "escalated",
      category: "billing"
    }
  }

  if (issue.category === "no_show") {
    return {
      reply:
        "I’m sorry your driver did not arrive as expected. Please refresh your ride status and confirm your pickup location. If the issue continues, this ticket will remain open for support review.",
      escalate: false,
      status: "open",
      category: "no_show"
    }
  }

  if (issue.category === "account" && senderRole === "rider") {
    return {
      reply:
        "I can help with rider account access. If you are still signing up, complete the Persona verification flow first. If you are already verified and still blocked, reply with the email or phone number tied to your account.",
      escalate: false,
      status: "open",
      category: "account"
    }
  }

  if (issue.category === "account" && senderRole === "driver") {
    return {
      reply:
        "I can help with driver onboarding. Drivers must complete Persona verification first, then Checkr background screening. If one of those steps is stuck, reply with your email and I’ll keep this ticket open for review.",
      escalate: false,
      status: "open",
      category: "account"
    }
  }

  if (issue.category === "driver_ops") {
    return {
      reply:
        "I can help with driver operations. Please share whether the issue is with earnings, trip status, vehicle setup, or onboarding so support can respond more accurately.",
      escalate: false,
      status: "open",
      category: "driver_ops"
    }
  }

  return {
    reply:
      "Thanks for contacting Harvey Taxi support. I’ve received your message and opened a support ticket. Please reply with any extra details so I can help or escalate this if needed.",
    escalate: false,
    status: "open",
    category: "general"
  }
}

/* ----------------------------------
   STATUS
---------------------------------- */

app.get("/api/status", (req, res) => {
  res.json({
    success: true,
    system: "Harvey Taxi GPS-Safe Backend",
    time: nowIso()
  })
})

/* ----------------------------------
   RIDER SIGNUP
---------------------------------- */

app.post("/api/rider/signup", async (req, res) => {
  try {
    const rider = req.body
    rider.id = uid("rider")
    rider.status = "pending"

    if (PERSONA_API_KEY && PERSONA_RIDER_TEMPLATE_ID) {
      const inquiry = await createPersona(PERSONA_RIDER_TEMPLATE_ID, rider.id)
      rider.persona = inquiry.id
      rider.personaUrl =
        inquiry.attributes?.inquiry_url ||
        inquiry.attributes?.inquiry_link ||
        null
    }

    const riders = read(RIDERS_FILE)
    riders.push(rider)
    write(RIDERS_FILE, riders)

    res.json(rider)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

/* ----------------------------------
   DRIVER SIGNUP
---------------------------------- */

app.post("/api/driver/signup", async (req, res) => {
  try {
    const driver = req.body
    driver.id = uid("driver")
    driver.status = "persona_pending"
    driver.available = false
    driver.approved = false

    if (PERSONA_API_KEY && PERSONA_DRIVER_TEMPLATE_ID) {
      const inquiry = await createPersona(PERSONA_DRIVER_TEMPLATE_ID, driver.id)
      driver.persona = inquiry.id
      driver.personaUrl =
        inquiry.attributes?.inquiry_url ||
        inquiry.attributes?.inquiry_link ||
        null
    }

    const drivers = read(DRIVERS_FILE)
    drivers.push(driver)
    write(DRIVERS_FILE, drivers)

    res.json(driver)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

/* ----------------------------------
   PERSONA WEBHOOK
---------------------------------- */

app.post("/webhook/persona", (req, res) => {
  try {
    const event = JSON.parse(req.body.toString())
    const eventName = event.data?.attributes?.name || ""

    const ref =
      event.data?.attributes?.payload?.data?.attributes?.reference_id ||
      event.data?.attributes?.payload?.attributes?.reference_id ||
      event.data?.attributes?.reference_id

    if (!ref) {
      return res.sendStatus(200)
    }

    const riders = read(RIDERS_FILE)
    const rider = riders.find(x => x.id === ref)

    if (rider) {
      if (eventName.includes("completed")) rider.status = "approved"
      if (eventName.includes("failed")) rider.status = "failed"
      write(RIDERS_FILE, riders)
      return res.sendStatus(200)
    }

    const drivers = read(DRIVERS_FILE)
    const driver = drivers.find(x => x.id === ref)

    if (driver) {
      if (eventName.includes("failed")) {
        driver.status = "persona_failed"
        write(DRIVERS_FILE, drivers)
        return res.sendStatus(200)
      }

      if (eventName.includes("completed")) {
        driver.status = "checkr_pending"
        write(DRIVERS_FILE, drivers)

        if (CHECKR_API_KEY) {
          createCheckr(driver)
            .then(result => {
              const currentDrivers = read(DRIVERS_FILE)
              const d = currentDrivers.find(x => x.id === ref)
              if (d) {
                d.checkrCandidateId = result.candidate.id
                d.checkrInvitationId = result.invitation.id
                d.checkrInvitationUrl = result.invitation.invitation_url || null
                d.status = "checkr_started"
                write(DRIVERS_FILE, currentDrivers)
              }
            })
            .catch(() => {})
        }
      }
    }

    res.sendStatus(200)
  } catch {
    res.sendStatus(200)
  }
})

/* ----------------------------------
   CHECKR WEBHOOK
---------------------------------- */

app.post("/webhook/checkr", (req, res) => {
  try {
    const event = JSON.parse(req.body.toString())

    if (event.type === "report.completed") {
      const candidateId =
        event.data?.object?.candidate_id ||
        event.data?.candidate_id ||
        event.data?.attributes?.candidate_id

      const drivers = read(DRIVERS_FILE)
      const driver = drivers.find(x => x.checkrCandidateId === candidateId)

      if (driver) {
        driver.status = "approved"
        driver.approved = true
        driver.available = true
        write(DRIVERS_FILE, drivers)
      }
    }

    res.sendStatus(200)
  } catch {
    res.sendStatus(200)
  }
})

/* ----------------------------------
   REQUEST RIDE
---------------------------------- */

app.post("/api/request-ride", (req, res) => {
  const ride = req.body

  ride.id = uid("ride")
  ride.status = "searching"
  ride.created = Date.now()

  ride.pickupLat =
    typeof req.body.pickupLat === "number" ? req.body.pickupLat : null
  ride.pickupLng =
    typeof req.body.pickupLng === "number" ? req.body.pickupLng : null
  ride.dropoffLat =
    typeof req.body.dropoffLat === "number" ? req.body.dropoffLat : null
  ride.dropoffLng =
    typeof req.body.dropoffLng === "number" ? req.body.dropoffLng : null

  const rides = read(RIDES_FILE)
  rides.push(ride)
  write(RIDES_FILE, rides)

  res.json({ success: true, ride })
})

/* ----------------------------------
   DRIVER CLAIM RIDE
---------------------------------- */

app.post("/api/driver/claim-ride", (req, res) => {
  const { rideId, driverId } = req.body

  const rides = read(RIDES_FILE)
  const drivers = read(DRIVERS_FILE)

  const ride = rides.find(r => r.id === rideId)
  const driver = drivers.find(d => d.id === driverId)

  if (!ride) return res.status(404).json({ error: "Ride not found" })
  if (!driver) return res.status(404).json({ error: "Driver not found" })

  ride.driverId = driver.id
  ride.driverName =
    driver.name || `${driver.firstName || ""} ${driver.lastName || ""}`.trim()
  ride.vehicleId = driver.id
  ride.status = "assigned"
  ride.updatedAt = nowIso()

  driver.available = false
  driver.status = "assigned"

  write(RIDES_FILE, rides)
  write(DRIVERS_FILE, drivers)

  res.json({ success: true, ride, driver })
})

/* ----------------------------------
   DRIVER UPDATE RIDE STATUS
---------------------------------- */

app.post("/api/driver/update-ride-status", (req, res) => {
  const { rideId, driverId, status } = req.body

  const allowed = ["assigned", "on_trip", "completed", "cancelled"]
  if (!allowed.includes(status)) {
    return res.status(400).json({ error: "Invalid status" })
  }

  const rides = read(RIDES_FILE)
  const drivers = read(DRIVERS_FILE)

  const ride = rides.find(r => r.id === rideId)
  const driver = drivers.find(d => d.id === driverId || d.id === ride?.driverId)

  if (!ride) return res.status(404).json({ error: "Ride not found" })
  if (!driver) return res.status(404).json({ error: "Driver not found" })

  ride.status = status
  ride.updatedAt = nowIso()

  if (status === "assigned") {
    ride.driverId = driver.id
    ride.driverName =
      driver.name || `${driver.firstName || ""} ${driver.lastName || ""}`.trim()
    ride.vehicleId = driver.id
    driver.status = "assigned"
    driver.available = false
  }

  if (status === "on_trip") {
    driver.status = "on_trip"
    driver.available = false
  }

  if (status === "completed" || status === "cancelled") {
    driver.status = "online"
    driver.available = true
    ride.completedAt = status === "completed" ? nowIso() : null
  }

  write(RIDES_FILE, rides)
  write(DRIVERS_FILE, drivers)

  res.json({ success: true, ride, driver })
})

/* ----------------------------------
   GPS UPDATE
---------------------------------- */

app.post("/api/gps/update", (req, res) => {
  const { driverId, rideId, lat, lng, heading, speed } = req.body

  if (!driverId) {
    return res.status(400).json({ error: "driverId required" })
  }

  if (typeof lat !== "number" || typeof lng !== "number") {
    return res.status(400).json({ error: "lat and lng must be numbers" })
  }

  const gps = read(GPS_FILE)
  const existing = gps.find(g => g.driverId === driverId)

  const payload = {
    driverId,
    rideId: rideId || null,
    lat,
    lng,
    heading: typeof heading === "number" ? heading : null,
    speed: typeof speed === "number" ? speed : null,
    updatedAt: nowIso()
  }

  if (existing) {
    Object.assign(existing, payload)
  } else {
    gps.push(payload)
  }

  write(GPS_FILE, gps)

  res.json({
    success: true,
    updatedAt: payload.updatedAt
  })
})

/* ----------------------------------
   PUBLIC LIVE STATUS
---------------------------------- */

app.get("/api/ride/:rideId/live-status", (req, res) => {
  const rides = read(RIDES_FILE)
  const drivers = read(DRIVERS_FILE)
  const gps = read(GPS_FILE)

  const ride = rides.find(r => String(r.id) === String(req.params.rideId))
  if (!ride) {
    return res.status(404).json({ error: "Ride not found" })
  }

  const driver =
    drivers.find(d => String(d.id) === String(ride.driverId || ride.vehicleId)) ||
    null

  const gpsPoint =
    gps.find(g => String(g.driverId) === String(ride.driverId || ride.vehicleId)) ||
    null

  const live = publicVehicleStage(ride, driver, gpsPoint)

  res.json({
    rideId: ride.id,
    stage: live.stage,
    progress: live.progress,
    etaMinutes: live.etaMinutes,
    liveLabel: live.liveLabel,
    vehicleLabel: live.vehicleLabel,
    status: ride.status,
    driverName: ride.driverName || driver?.name || null,
    lastGpsUpdate: gpsPoint?.updatedAt || null
  })
})

/* ----------------------------------
   ADMIN GPS
---------------------------------- */

app.get("/api/admin/gps", (req, res) => {
  res.json(read(GPS_FILE))
})

/* ----------------------------------
   RIDES / DRIVERS / RIDERS
---------------------------------- */

app.get("/api/rides", (req, res) => {
  const rides = read(RIDES_FILE).map(r => {
    const clone = { ...r }
    delete clone.pickupLat
    delete clone.pickupLng
    delete clone.dropoffLat
    delete clone.dropoffLng
    return clone
  })

  res.json(rides)
})

app.get("/api/drivers", (req, res) => {
  res.json(read(DRIVERS_FILE))
})

app.get("/api/riders", (req, res) => {
  res.json(read(RIDERS_FILE))
})

/* ----------------------------------
   CHAT
---------------------------------- */

app.post("/api/chat/send", (req, res) => {
  const msg = req.body
  msg.id = uid("msg")
  msg.time = Date.now()

  const msgs = read(MESSAGES_FILE)
  msgs.push(msg)
  write(MESSAGES_FILE, msgs)

  res.json(msg)
})

app.post("/api/send-message", (req, res) => {
  const msg = req.body
  msg.id = uid("msg")
  msg.time = Date.now()

  const msgs = read(MESSAGES_FILE)
  msgs.push(msg)
  write(MESSAGES_FILE, msgs)

  res.json({ success: true, message: msg })
})

app.get("/api/chat/:rideId", (req, res) => {
  const msgs = read(MESSAGES_FILE).filter(m => m.rideId === req.params.rideId)
  res.json(msgs)
})

app.get("/api/messages/:rideId", (req, res) => {
  const msgs = read(MESSAGES_FILE).filter(m => m.rideId === req.params.rideId)
  res.json(msgs)
})

/* ----------------------------------
   SUPPORT
---------------------------------- */

app.post("/api/support", (req, res) => {
  const ticket = req.body
  ticket.id = uid("support")
  ticket.status = "open"

  const issue = classifySupportIssue(ticket.text || ticket.message || "")
  ticket.category = issue.category
  ticket.escalated = issue.escalate

  const support = read(SUPPORT_FILE)
  support.push(ticket)
  write(SUPPORT_FILE, support)

  const reply = generateAiSupportReply(
    { requesterType: ticket.requesterType || "user" },
    { text: ticket.text || ticket.message || "" }
  )

  res.json({
    reply: reply.reply,
    escalated: reply.escalate,
    category: reply.category
  })
})

/* ----------------------------------
   ROOT
---------------------------------- */

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public/index.html"))
})

app.listen(PORT, () => {
  console.log("Harvey Taxi GPS-Safe Server Running")
})

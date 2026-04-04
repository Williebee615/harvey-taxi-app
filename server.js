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
const VEHICLES_FILE = path.join(__dirname, "vehicles.json")
const RIDES_FILE = path.join(__dirname, "rides.json")
const MESSAGES_FILE = path.join(__dirname, "messages.json")
const MISSIONS_FILE = path.join(__dirname, "missions.json")
const COMMANDS_FILE = path.join(__dirname, "commands.json")
const SUPPORT_TICKETS_FILE = path.join(__dirname, "support-tickets.json")

function ensureFile(filePath) {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, "[]")
  }
}

;[
  RIDERS_FILE,
  VEHICLES_FILE,
  RIDES_FILE,
  MESSAGES_FILE,
  MISSIONS_FILE,
  COMMANDS_FILE,
  SUPPORT_TICKETS_FILE
].forEach(ensureFile)

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"))
  } catch (error) {
    return []
  }
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2))
}

function uid(prefix = "id") {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`
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

/* ----------------------------------
   HELPERS
---------------------------------- */

async function createPersonaInquiry(templateId, referenceId) {
  const response = await axios.post(
    `${PERSONA_BASE_URL}/inquiries`,
    {
      data: {
        attributes: {
          inquiry_template_id: templateId,
          reference_id: referenceId
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

  return response.data.data
}

async function createCheckrCandidateAndInvitation(driver) {
  const { firstName, lastName } = splitName(`${driver.firstName || ""} ${driver.lastName || ""}`)

  const candidateResponse = await axios.post(
    `${CHECKR_BASE_URL}/candidates`,
    {
      first_name: firstName,
      last_name: lastName,
      email: driver.email,
      phone: driver.phone
    },
    {
      auth: {
        username: CHECKR_API_KEY,
        password: ""
      }
    }
  )

  const candidate = candidateResponse.data

  const invitationResponse = await axios.post(
    `${CHECKR_BASE_URL}/invitations`,
    {
      candidate_id: candidate.id,
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
      auth: {
        username: CHECKR_API_KEY,
        password: ""
      }
    }
  )

  return {
    candidate,
    invitation: invitationResponse.data
  }
}

function parseRawJson(rawBuffer) {
  try {
    return JSON.parse(rawBuffer.toString("utf8"))
  } catch (error) {
    return null
  }
}

function classifySupportIssue(text) {
  const msg = String(text || "").toLowerCase()

  const severeWords = [
    "emergency", "911", "unsafe", "assault", "harassment", "threat",
    "police", "crash", "accident", "injury", "fraud", "scam", "stolen"
  ]

  const refundWords = [
    "refund", "charged", "double charged", "charged twice", "billing",
    "payment issue", "overcharged"
  ]

  const noShowWords = [
    "no show", "never showed", "didn't show", "driver never came",
    "driver not here", "where is my driver"
  ]

  const accountWords = [
    "login", "account", "password", "verification", "persona", "checkr", "signup"
  ]

  const driverWords = [
    "driver dashboard", "earnings", "trip", "vehicle", "background check"
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
      reply: "Your message has been flagged as a safety issue. Please contact emergency services immediately if anyone is in danger. I have escalated this to Harvey Taxi support for urgent review.",
      escalate: true,
      status: "escalated",
      category: "safety"
    }
  }

  if (issue.category === "billing") {
    return {
      reply: "I’m sorry about the billing issue. I’ve flagged this ticket for support review. Please send the trip details, ride date, and what charge looks incorrect so the team can review it faster.",
      escalate: true,
      status: "escalated",
      category: "billing"
    }
  }

  if (issue.category === "no_show") {
    return {
      reply: "I’m sorry your driver did not arrive as expected. Please refresh your ride status and confirm your pickup location. If the issue continues, this ticket will remain open for support review.",
      escalate: false,
      status: "open",
      category: "no_show"
    }
  }

  if (issue.category === "account" && senderRole === "rider") {
    return {
      reply: "I can help with rider account access. If you are still signing up, complete the Persona verification flow first. If you are already verified and still blocked, reply with the email or phone number tied to your account.",
      escalate: false,
      status: "open",
      category: "account"
    }
  }

  if (issue.category === "account" && senderRole === "driver") {
    return {
      reply: "I can help with driver onboarding. Drivers must complete Persona verification first, then Checkr background screening. If one of those steps is stuck, reply with your email and I’ll keep this ticket open for review.",
      escalate: false,
      status: "open",
      category: "account"
    }
  }

  if (issue.category === "driver_ops") {
    return {
      reply: "I can help with driver operations. Please share whether the issue is with earnings, trip status, vehicle setup, or onboarding so support can respond more accurately.",
      escalate: false,
      status: "open",
      category: "driver_ops"
    }
  }

  return {
    reply: "Thanks for contacting Harvey Taxi support. I’ve received your message and opened a support ticket. Please reply with any extra details so I can help or escalate this if needed.",
    escalate: false,
    status: "open",
    category: "general"
  }
}

function createSupportMessage({ ticketId, rideId, from, to, text, senderType }) {
  return {
    id: uid("msg"),
    ticketId: ticketId || null,
    rideId: rideId || null,
    from: from || "system",
    to: to || "user",
    text: text || "",
    time: nowIso(),
    senderType: senderType || "human"
  }
}

function saveMessage(message) {
  const messages = readJson(MESSAGES_FILE)
  messages.push(message)
  writeJson(MESSAGES_FILE, messages)
  return message
}

function getTicketMessages(ticketId) {
  const messages = readJson(MESSAGES_FILE)
  return messages.filter(m => String(m.ticketId) === String(ticketId))
}

function maybeCreateAiReply(ticket, latestMessage) {
  const tickets = readJson(SUPPORT_TICKETS_FILE)
  const savedTicket = tickets.find(t => t.id === ticket.id)
  if (!savedTicket) return null

  const aiResult = generateAiSupportReply(savedTicket, latestMessage)

  savedTicket.category = aiResult.category
  savedTicket.status = aiResult.status
  savedTicket.escalated = aiResult.escalate
  savedTicket.lastUpdatedAt = nowIso()

  if (aiResult.escalate) {
    savedTicket.escalatedAt = nowIso()
  }

  writeJson(SUPPORT_TICKETS_FILE, tickets)

  const aiMessage = createSupportMessage({
    ticketId: savedTicket.id,
    rideId: savedTicket.rideId,
    from: "ai_support",
    to: savedTicket.requesterType || "user",
    text: aiResult.reply,
    senderType: "ai"
  })

  saveMessage(aiMessage)
  return aiMessage
}

/* ----------------------------------
   ROOT + STATUS
---------------------------------- */

app.get("/", (req, res) => {
  const indexPath = path.join(__dirname, "public", "index.html")

  if (fs.existsSync(indexPath)) {
    return res.sendFile(indexPath)
  }

  res.send("Harvey Taxi API running")
})

app.get("/api/status", (req, res) => {
  res.json({
    success: true,
    system: "Harvey Taxi Persona + Checkr + AI Support + Driver Status",
    time: nowIso()
  })
})

/* ----------------------------------
   ADMIN LOGIN
---------------------------------- */

app.post("/api/admin-login", (req, res) => {
  const email = req.body.email || ""
  const password = req.body.password || ""

  if (email === "admin@harveytaxi.com" && password === "admin123") {
    return res.json({
      success: true,
      user: {
        email,
        role: "admin"
      }
    })
  }

  return res.status(401).json({
    success: false,
    message: "Invalid login"
  })
})

/* ----------------------------------
   RIDER SIGNUP -> PERSONA
---------------------------------- */

app.post("/api/rider-signup", async (req, res) => {
  const riders = readJson(RIDERS_FILE)

  const rider = {
    id: uid("rider"),
    name: req.body.name || "",
    email: req.body.email || "",
    phone: req.body.phone || "",
    city: req.body.city || "",
    personaInquiryId: null,
    personaLink: null,
    personaStatus: "pending",
    approved: false,
    createdAt: nowIso()
  }

  riders.push(rider)
  writeJson(RIDERS_FILE, riders)

  try {
    if (!PERSONA_API_KEY || !PERSONA_RIDER_TEMPLATE_ID) {
      return res.json({
        success: true,
        rider,
        message: "Rider saved, but Persona rider template/key is missing."
      })
    }

    const inquiry = await createPersonaInquiry(PERSONA_RIDER_TEMPLATE_ID, rider.id)

    rider.personaInquiryId = inquiry.id
    rider.personaLink = inquiry.attributes?.inquiry_url || null
    writeJson(RIDERS_FILE, riders)

    res.json({
      success: true,
      rider,
      verifyUrl: rider.personaLink
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.response?.data || error.message
    })
  }
})

/* ----------------------------------
   DRIVER SIGNUP -> PERSONA
---------------------------------- */

app.post("/api/driver-signup", async (req, res) => {
  const vehicles = readJson(VEHICLES_FILE)

  const driver = {
    id: uid("driver"),
    firstName: req.body.firstName || "",
    lastName: req.body.lastName || "",
    name: req.body.name || `${req.body.firstName || ""} ${req.body.lastName || ""}`.trim(),
    email: req.body.email || "",
    phone: req.body.phone || "",
    vehicle: req.body.vehicle || "",
    plate: req.body.plate || "",
    city: req.body.city || "",
    type: req.body.type || "human",
    personaInquiryId: null,
    personaLink: null,
    personaStatus: "pending",
    checkrCandidateId: null,
    checkrInvitationId: null,
    checkrInvitationUrl: null,
    checkrStatus: "pending",
    approved: false,
    available: false,
    status: "pending_verification",
    battery: 100,
    zone: "default",
    remoteAssist: false,
    takeoverMode: false,
    safetyState: "normal",
    createdAt: nowIso()
  }

  vehicles.push(driver)
  writeJson(VEHICLES_FILE, vehicles)

  try {
    if (!PERSONA_API_KEY || !PERSONA_DRIVER_TEMPLATE_ID) {
      return res.json({
        success: true,
        driver,
        message: "Driver saved, but Persona driver template/key is missing."
      })
    }

    const inquiry = await createPersonaInquiry(PERSONA_DRIVER_TEMPLATE_ID, driver.id)

    driver.personaInquiryId = inquiry.id
    driver.personaLink = inquiry.attributes?.inquiry_url || null
    writeJson(VEHICLES_FILE, vehicles)

    res.json({
      success: true,
      driver,
      verifyUrl: driver.personaLink
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.response?.data || error.message
    })
  }
})

/* ----------------------------------
   PERSONA WEBHOOK
---------------------------------- */

app.post("/webhook/persona", async (req, res) => {
  try {
    const rawBody = req.body.toString("utf8")
    const payload = JSON.parse(rawBody)

    const eventName = payload.data?.attributes?.name || payload.type || ""
    const inquiry = payload.data?.attributes?.payload?.data || payload.data?.attributes?.payload || payload.data || {}
    const inquiryAttributes = inquiry.attributes || {}
    const referenceId = inquiryAttributes.reference_id

    if (!referenceId) {
      return res.sendStatus(200)
    }

    const riders = readJson(RIDERS_FILE)
    const rider = riders.find(r => r.id === referenceId)

    if (rider) {
      if (eventName.includes("completed")) {
        rider.personaStatus = "completed"
        rider.approved = true
      } else if (eventName.includes("failed")) {
        rider.personaStatus = "failed"
        rider.approved = false
      } else if (eventName.includes("created")) {
        rider.personaStatus = "created"
      }

      writeJson(RIDERS_FILE, riders)
      return res.sendStatus(200)
    }

    const vehicles = readJson(VEHICLES_FILE)
    const driver = vehicles.find(v => v.id === referenceId)

    if (driver) {
      if (eventName.includes("created")) {
        driver.personaStatus = "created"
      }

      if (eventName.includes("failed")) {
        driver.personaStatus = "failed"
        driver.status = "persona_failed"
        driver.available = false
      }

      if (eventName.includes("completed")) {
        driver.personaStatus = "completed"
        driver.status = "persona_verified"

        if (CHECKR_API_KEY) {
          try {
            const checkrData = await createCheckrCandidateAndInvitation(driver)

            driver.checkrCandidateId = checkrData.candidate.id
            driver.checkrInvitationId = checkrData.invitation.id
            driver.checkrInvitationUrl = checkrData.invitation.invitation_url || null
            driver.checkrStatus = checkrData.invitation.status || "created"
            driver.status = "checkr_started"
          } catch (checkrError) {
            driver.checkrStatus = "error"
            driver.status = "checkr_error"
          }
        }
      }

      writeJson(VEHICLES_FILE, vehicles)
      return res.sendStatus(200)
    }

    return res.sendStatus(200)
  } catch (error) {
    return res.sendStatus(200)
  }
})

/* ----------------------------------
   CHECKR WEBHOOK
---------------------------------- */

app.post("/webhook/checkr", (req, res) => {
  try {
    const rawBody = req.body.toString("utf8")
    const payload = JSON.parse(rawBody)

    const vehicles = readJson(VEHICLES_FILE)
    const data = payload.data || {}
    const attributes = data.attributes || {}
    const objectId = data.id || null
    const eventType = payload.type || ""

    let driver = vehicles.find(v =>
      v.checkrInvitationId === objectId ||
      v.checkrCandidateId === objectId
    )

    if (!driver && attributes.candidate_id) {
      driver = vehicles.find(v => v.checkrCandidateId === attributes.candidate_id)
    }

    if (!driver) {
      return res.sendStatus(200)
    }

    if (eventType.includes("invitation.created")) {
      driver.checkrStatus = "invitation_created"
      if (attributes.invitation_url) {
        driver.checkrInvitationUrl = attributes.invitation_url
      }
    }

    if (eventType.includes("invitation.completed")) {
      driver.checkrStatus = "invitation_completed"
      driver.status = "checkr_processing"
    }

    if (eventType.includes("report.created")) {
      driver.checkrStatus = "report_created"
      driver.status = "checkr_processing"
    }

    if (eventType.includes("report.completed")) {
      driver.checkrStatus = "clear"
      driver.approved = true
      driver.available = true
      driver.status = "online"
    }

    writeJson(VEHICLES_FILE, vehicles)
    return res.sendStatus(200)
  } catch (error) {
    return res.sendStatus(200)
  }
})

/* ----------------------------------
   GET DATA
---------------------------------- */

app.get("/api/riders", (req, res) => {
  res.json(readJson(RIDERS_FILE))
})

app.get("/api/drivers", (req, res) => {
  res.json(readJson(VEHICLES_FILE))
})

app.get("/api/vehicles", (req, res) => {
  res.json(readJson(VEHICLES_FILE))
})

app.get("/api/rides", (req, res) => {
  res.json(readJson(RIDES_FILE))
})

/* ----------------------------------
   REQUEST RIDE
---------------------------------- */

app.post("/api/request-ride", (req, res) => {
  const rides = readJson(RIDES_FILE)
  const vehicles = readJson(VEHICLES_FILE)

  const availableVehicle = vehicles.find(v => v.approved === true && v.available === true)

  const ride = {
    id: uid("ride"),
    rider: req.body.name || "",
    phone: req.body.phone || "",
    pickup: req.body.pickup || "",
    dropoff: req.body.dropoff || "",
    vehicleId: availableVehicle ? availableVehicle.id : null,
    driverName: availableVehicle ? (availableVehicle.name || availableVehicle.vehicle || "Assigned Driver") : null,
    status: availableVehicle ? "assigned" : "searching",
    createdAt: nowIso()
  }

  if (availableVehicle) {
    availableVehicle.available = false
    availableVehicle.status = "assigned"
    writeJson(VEHICLES_FILE, vehicles)
  }

  rides.push(ride)
  writeJson(RIDES_FILE, rides)

  res.json({
    success: true,
    ride
  })
})

/* ----------------------------------
   DRIVER LIVE STATUS CONTROLS
---------------------------------- */

app.post("/api/driver/update-ride-status", (req, res) => {
  const { rideId, driverId, status } = req.body

  const allowed = ["assigned", "on_trip", "completed", "cancelled"]
  if (!allowed.includes(status)) {
    return res.status(400).json({
      success: false,
      error: "Invalid status"
    })
  }

  const rides = readJson(RIDES_FILE)
  const vehicles = readJson(VEHICLES_FILE)

  const ride = rides.find(r => String(r.id) === String(rideId))
  if (!ride) {
    return res.status(404).json({
      success: false,
      error: "Ride not found"
    })
  }

  const vehicle = vehicles.find(v => String(v.id) === String(driverId || ride.vehicleId))
  if (!vehicle) {
    return res.status(404).json({
      success: false,
      error: "Driver vehicle not found"
    })
  }

  ride.status = status
  ride.updatedAt = nowIso()

  if (status === "assigned") {
    ride.vehicleId = vehicle.id
    ride.driverName = vehicle.name || vehicle.vehicle || "Assigned Driver"
    vehicle.status = "assigned"
    vehicle.available = false
  }

  if (status === "on_trip") {
    ride.vehicleId = vehicle.id
    ride.driverName = vehicle.name || vehicle.vehicle || "Assigned Driver"
    vehicle.status = "on_trip"
    vehicle.available = false
  }

  if (status === "completed") {
    vehicle.status = "online"
    vehicle.available = true
    ride.completedAt = nowIso()
  }

  if (status === "cancelled") {
    vehicle.status = "online"
    vehicle.available = true
  }

  writeJson(RIDES_FILE, rides)
  writeJson(VEHICLES_FILE, vehicles)

  res.json({
    success: true,
    ride,
    vehicle
  })
})

app.get("/api/driver/:id/assigned-rides", (req, res) => {
  const rides = readJson(RIDES_FILE)
  const driverId = req.params.id

  const assigned = rides.filter(r =>
    String(r.vehicleId) === String(driverId) &&
    ["assigned", "on_trip"].includes(String(r.status))
  )

  res.json(assigned)
})

app.post("/api/driver/claim-ride", (req, res) => {
  const { rideId, driverId } = req.body

  const rides = readJson(RIDES_FILE)
  const vehicles = readJson(VEHICLES_FILE)

  const ride = rides.find(r => String(r.id) === String(rideId))
  if (!ride) {
    return res.status(404).json({ success: false, error: "Ride not found" })
  }

  const vehicle = vehicles.find(v => String(v.id) === String(driverId))
  if (!vehicle) {
    return res.status(404).json({ success: false, error: "Driver vehicle not found" })
  }

  ride.vehicleId = vehicle.id
  ride.driverName = vehicle.name || vehicle.vehicle || "Assigned Driver"
  ride.status = "assigned"
  ride.updatedAt = nowIso()

  vehicle.available = false
  vehicle.status = "assigned"

  writeJson(RIDES_FILE, rides)
  writeJson(VEHICLES_FILE, vehicles)

  res.json({
    success: true,
    ride,
    vehicle
  })
})

/* ----------------------------------
   AI SUPPORT TICKETS
---------------------------------- */

app.post("/api/support/create-ticket", (req, res) => {
  const tickets = readJson(SUPPORT_TICKETS_FILE)

  const ticket = {
    id: uid("ticket"),
    rideId: req.body.rideId || null,
    requesterId: req.body.requesterId || null,
    requesterType: req.body.requesterType || "user",
    subject: req.body.subject || "Support Request",
    category: "general",
    status: "open",
    escalated: false,
    createdAt: nowIso(),
    lastUpdatedAt: nowIso()
  }

  tickets.push(ticket)
  writeJson(SUPPORT_TICKETS_FILE, tickets)

  res.json({
    success: true,
    ticket
  })
})

app.get("/api/support/tickets", (req, res) => {
  res.json(readJson(SUPPORT_TICKETS_FILE))
})

app.get("/api/support/ticket/:id", (req, res) => {
  const tickets = readJson(SUPPORT_TICKETS_FILE)
  const ticket = tickets.find(t => t.id === req.params.id)

  if (!ticket) {
    return res.status(404).json({ success: false, error: "Ticket not found" })
  }

  const messages = getTicketMessages(ticket.id)

  res.json({
    success: true,
    ticket,
    messages
  })
})

app.post("/api/support/send-message", (req, res) => {
  const tickets = readJson(SUPPORT_TICKETS_FILE)
  let ticket = null

  if (req.body.ticketId) {
    ticket = tickets.find(t => t.id === req.body.ticketId)
  }

  if (!ticket) {
    ticket = {
      id: uid("ticket"),
      rideId: req.body.rideId || null,
      requesterId: req.body.requesterId || null,
      requesterType: req.body.requesterType || "user",
      subject: req.body.subject || "Support Request",
      category: "general",
      status: "open",
      escalated: false,
      createdAt: nowIso(),
      lastUpdatedAt: nowIso()
    }
    tickets.push(ticket)
    writeJson(SUPPORT_TICKETS_FILE, tickets)
  }

  const message = createSupportMessage({
    ticketId: ticket.id,
    rideId: req.body.rideId || ticket.rideId,
    from: req.body.from || ticket.requesterType || "user",
    to: req.body.to || "support",
    text: req.body.text || "",
    senderType: req.body.senderType || "human"
  })

  saveMessage(message)

  ticket.lastUpdatedAt = nowIso()
  writeJson(SUPPORT_TICKETS_FILE, tickets)

  const aiMessage = maybeCreateAiReply(ticket, message)

  res.json({
    success: true,
    ticket,
    message,
    aiReply: aiMessage
  })
})

app.post("/api/support/ai-reply", (req, res) => {
  const tickets = readJson(SUPPORT_TICKETS_FILE)
  const ticket = tickets.find(t => t.id === req.body.ticketId)

  if (!ticket) {
    return res.status(404).json({ success: false, error: "Ticket not found" })
  }

  const messages = getTicketMessages(ticket.id)
  const latestMessage = messages[messages.length - 1]

  if (!latestMessage) {
    return res.status(400).json({ success: false, error: "No messages found for ticket" })
  }

  const aiReply = maybeCreateAiReply(ticket, latestMessage)

  res.json({
    success: true,
    ticket,
    aiReply
  })
})

app.post("/api/support/escalate", (req, res) => {
  const tickets = readJson(SUPPORT_TICKETS_FILE)
  const ticket = tickets.find(t => t.id === req.body.ticketId)

  if (!ticket) {
    return res.status(404).json({ success: false, error: "Ticket not found" })
  }

  ticket.escalated = true
  ticket.status = "escalated"
  ticket.lastUpdatedAt = nowIso()
  ticket.escalatedAt = nowIso()
  writeJson(SUPPORT_TICKETS_FILE, tickets)

  const msg = createSupportMessage({
    ticketId: ticket.id,
    rideId: ticket.rideId,
    from: "system",
    to: "admin_support",
    text: req.body.note || "Ticket escalated for manual review.",
    senderType: "system"
  })

  saveMessage(msg)

  res.json({
    success: true,
    ticket,
    message: msg
  })
})

/* ----------------------------------
   CHAT MESSAGES
---------------------------------- */

app.post("/api/send-message", (req, res) => {
  const message = createSupportMessage({
    ticketId: req.body.ticketId || null,
    rideId: req.body.rideId || "support",
    from: req.body.from || "user",
    to: req.body.to || "admin",
    text: req.body.text || "",
    senderType: req.body.senderType || "human"
  })

  saveMessage(message)

  res.json({
    success: true,
    message
  })
})

app.get("/api/messages/:rideId", (req, res) => {
  const messages = readJson(MESSAGES_FILE)
  const filtered = messages.filter(m => String(m.rideId) === String(req.params.rideId))
  res.json(filtered)
})

/* ----------------------------------
   AV / COMMANDS / MISSIONS
---------------------------------- */

app.get("/api/missions", (req, res) => {
  res.json(readJson(MISSIONS_FILE))
})

app.get("/api/vehicle/:id/commands", (req, res) => {
  const commands = readJson(COMMANDS_FILE)
  res.json(commands.filter(c => c.vehicleId === req.params.id))
})

app.post("/api/vehicle/:id/command", (req, res) => {
  const commands = readJson(COMMANDS_FILE)

  const command = {
    id: uid("cmd"),
    vehicleId: req.params.id,
    type: req.body.type || "",
    data: req.body.data || {},
    status: "queued",
    createdAt: nowIso()
  }

  commands.push(command)
  writeJson(COMMANDS_FILE, commands)

  res.json({
    success: true,
    command
  })
})

/* ----------------------------------
   FALLBACK PAGE ROUTER
---------------------------------- */

app.get("/:page", (req, res) => {
  const file = path.join(__dirname, "public", req.params.page)

  if (fs.existsSync(file)) {
    return res.sendFile(file)
  }

  if (fs.existsSync(file + ".html")) {
    return res.sendFile(file + ".html")
  }

  return res.sendFile(path.join(__dirname, "public", "index.html"))
})

/* ----------------------------------
   START
---------------------------------- */

app.listen(PORT, () => {
  console.log(`Harvey Taxi server running on port ${PORT}`)
})    status: "open",
    category: "general"
  }
}

/* ----------------------------------
   ROUTES
---------------------------------- */

/* DRIVER STATUS UPDATE */
app.post("/api/driver/update-status", (req, res) => {
  const { rideId, status, driverId } = req.body

  const rides = readJson(RIDES_FILE)

  const ride = rides.find(r => r.id === rideId)

  if (!ride) {
    return res.status(404).json({ error: "Ride not found" })
  }

  ride.status = status
  ride.driverId = driverId || ride.driverId
  ride.updatedAt = nowIso()

  writeJson(RIDES_FILE, rides)

  res.json({ success: true, ride })
})

/* GET RIDES */
app.get("/api/rides", (req, res) => {
  res.json(readJson(RIDES_FILE))
})

/* GET VEHICLES */
app.get("/api/vehicles", (req, res) => {
  res.json(readJson(VEHICLES_FILE))
})

/* SEND MESSAGE */
app.post("/api/send-message", (req, res) => {
  const { rideId, from, to, text } = req.body

  const messages = readJson(MESSAGES_FILE)

  const msg = {
    id: uid("msg"),
    rideId,
    from,
    to,
    text,
    time: nowIso()
  }

  messages.push(msg)

  writeJson(MESSAGES_FILE, messages)

  res.json({ success: true })
})

/* GET MESSAGES */
app.get("/api/messages/:rideId", (req, res) => {
  const messages = readJson(MESSAGES_FILE)

  const rideMessages = messages.filter(
    m => String(m.rideId) === String(req.params.rideId)
  )

  res.json(rideMessages)
})

/* REQUEST RIDE */
app.post("/api/request-ride", (req, res) => {
  const { name, phone, pickup, dropoff } = req.body

  const rides = readJson(RIDES_FILE)

  const ride = {
    id: uid("ride"),
    rider: name,
    phone,
    pickup,
    dropoff,
    status: "searching",
    createdAt: nowIso()
  }

  rides.push(ride)

  writeJson(RIDES_FILE, rides)

  res.json({ success: true, ride })
})

/* ROOT */
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"))
})

/* FALLBACK */
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"))
})

app.listen(PORT, () => {
  console.log("====================================")
  console.log("Harvey Taxi Server Running")
  console.log("PORT:", PORT)
  console.log("====================================")
})

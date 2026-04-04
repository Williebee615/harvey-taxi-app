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
    status:    status: "open",
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

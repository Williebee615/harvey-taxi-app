const express = require("express")
const cors = require("cors")
const fs = require("fs")
const path = require("path")
const axios = require("axios")

const app = express()
const PORT = process.env.PORT || 10000

app.use(cors())

// Keep raw body for webhook routes
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
  COMMANDS_FILE
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
    system: "Harvey Taxi Persona + Checkr",
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
    name: `${req.body.firstName || ""} ${req.body.lastName || ""}`.trim(),
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

    // Rider lookup
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

    // Driver lookup
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

    const driver = vehicles.find(v =>
      v.checkrInvitationId === objectId ||
      v.checkrCandidateId === objectId
    )

    if (!driver) {
      return res.sendStatus(200)
    }

    const eventType = payload.type || ""

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

/* ----------------------------------
   RIDE REQUEST
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
    status: availableVehicle ? "assigned" : "searching",
    createdAt: nowIso()
  }

  if (availableVehicle) {
    availableVehicle.available = false
    availableVehicle.status = "on_trip"
    writeJson(VEHICLES_FILE, vehicles)
  }

  rides.push(ride)
  writeJson(RIDES_FILE, rides)

  res.json({
    success: true,
    ride
  })
})

app.get("/api/rides", (req, res) => {
  res.json(readJson(RIDES_FILE))
})

/* ----------------------------------
   SUPPORT MESSAGES
---------------------------------- */

app.post("/api/send-message", (req, res) => {
  const messages = readJson(MESSAGES_FILE)

  const message = {
    id: uid("msg"),
    rideId: req.body.rideId || "support",
    from: req.body.from || "user",
    to: req.body.to || "admin",
    text: req.body.text || "",
    time: nowIso()
  }

  messages.push(message)
  writeJson(MESSAGES_FILE, messages)

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
})

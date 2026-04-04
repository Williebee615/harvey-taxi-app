const express = require('express')
const cors = require('cors')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const app = express()
const PORT = process.env.PORT || 10000

app.use(cors())

// Keep raw body for webhook signature support
app.use('/api/checkr/webhook', express.raw({ type: '*/*' }))

app.use((req, res, next) => {
  if (req.path === '/api/checkr/webhook') return next()
  express.json()(req, res, next)
})

app.use(express.static(path.join(__dirname, 'public')))

const RIDERS_FILE = path.join(__dirname, 'riders.json')
const RIDES_FILE = path.join(__dirname, 'rides.json')
const VEHICLES_FILE = path.join(__dirname, 'vehicles.json')
const MESSAGES_FILE = path.join(__dirname, 'messages.json')
const MISSIONS_FILE = path.join(__dirname, 'missions.json')
const COMMANDS_FILE = path.join(__dirname, 'commands.json')

// Direct Checkr workflow env vars
const CHECKR_API_KEY = process.env.CHECKR_API_KEY || ''
const CHECKR_PACKAGE = process.env.CHECKR_PACKAGE || 'Harvey Taxi Driver Check'
const CHECKR_BASE_URL = process.env.CHECKR_BASE_URL || 'https://api.checkr.com/v1'
const CHECKR_WEBHOOK_SECRET = process.env.CHECKR_WEBHOOK_SECRET || ''
const DEFAULT_WORK_STATE = process.env.CHECKR_WORK_STATE || 'TN'
const DEFAULT_WORK_CITY = process.env.CHECKR_WORK_CITY || 'Nashville'
const DEFAULT_WORK_COUNTRY = process.env.CHECKR_WORK_COUNTRY || 'US'

function ensureFile(filePath) {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, '[]')
  }
}

;[
  RIDERS_FILE,
  RIDES_FILE,
  VEHICLES_FILE,
  MESSAGES_FILE,
  MISSIONS_FILE,
  COMMANDS_FILE
].forEach(ensureFile)

function readJson(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8')
    return JSON.parse(raw)
  } catch (error) {
    return []
  }
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2))
}

function uid(prefix = 'id') {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`
}

function nowIso() {
  return new Date().toISOString()
}

function timelineEntry(event, note = '') {
  return {
    time: nowIso(),
    event,
    note
  }
}

function safeNameParts(fullName) {
  const trimmed = String(fullName || '').trim()
  const parts = trimmed.split(/\s+/).filter(Boolean)

  return {
    first_name: parts[0] || 'Driver',
    last_name: parts.slice(1).join(' ') || 'Applicant'
  }
}

function driverPublicView(vehicle) {
  return {
    id: vehicle.id,
    type: vehicle.type,
    name: vehicle.name,
    email: vehicle.email,
    phone: vehicle.phone,
    vehicle: vehicle.vehicle,
    plate: vehicle.plate,
    zone: vehicle.zone,
    battery: vehicle.battery,
    status: vehicle.status,
    available: vehicle.available,
    remoteAssist: vehicle.remoteAssist,
    takeoverMode: vehicle.takeoverMode,
    safetyState: vehicle.safetyState,
    backgroundCheckStatus: vehicle.backgroundCheckStatus,
    approvalStatus: vehicle.approvalStatus,
    checkrInvitationStatus: vehicle.checkrInvitationStatus,
    createdAt: vehicle.createdAt
  }
}

async function checkrRequest(endpoint, method = 'GET', body = null) {
  if (!CHECKR_API_KEY) {
    throw new Error('Missing CHECKR_API_KEY')
  }

  const response = await fetch(`${CHECKR_BASE_URL}${endpoint}`, {
    method,
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${CHECKR_API_KEY}:`).toString('base64'),
      'Content-Type': 'application/json'
    },
    body: body ? JSON.stringify(body) : undefined
  })

  const text = await response.text()
  let data = {}

  try {
    data = text ? JSON.parse(text) : {}
  } catch {
    data = { raw: text }
  }

  if (!response.ok) {
    throw new Error(data.error || data.message || `Checkr request failed: ${response.status}`)
  }

  return data
}

function findVehicleByCheckrCandidateId(vehicles, candidateId) {
  return vehicles.find(v => String(v.checkrCandidateId || '') === String(candidateId || ''))
}

function findVehicleByEmail(vehicles, email) {
  return vehicles.find(v => String(v.email || '').toLowerCase() === String(email || '').toLowerCase())
}

function verifyCheckrSignature(rawBody, signatureHeader) {
  if (!CHECKR_WEBHOOK_SECRET) return true
  if (!signatureHeader) return false

  const digest = crypto
    .createHmac('sha256', CHECKR_WEBHOOK_SECRET)
    .update(rawBody)
    .digest('hex')

  return digest === signatureHeader
}

/* ------------------------------
   BASIC ROUTES
------------------------------ */

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'))
})

app.get('/api/status', (req, res) => {
  res.json({
    success: true,
    system: 'Harvey Taxi Direct Checkr Workflow',
    checkrConfigured: !!CHECKR_API_KEY,
    time: nowIso()
  })
})

app.post('/api/admin-login', (req, res) => {
  const email = req.body.email || ''
  const password = req.body.password || ''

  if (email === 'admin@harveytaxi.com' && password === 'admin123') {
    return res.json({
      success: true,
      user: {
        email,
        role: 'admin'
      }
    })
  }

  return res.status(401).json({
    success: false,
    message: 'Invalid login'
  })
})

/* ------------------------------
   RIDER SIGNUP
------------------------------ */

app.post('/api/rider-signup', (req, res) => {
  const riders = readJson(RIDERS_FILE)

  const rider = {
    id: uid('rider'),
    name: req.body.name || '',
    email: req.body.email || '',
    phone: req.body.phone || '',
    city: req.body.city || '',
    createdAt: nowIso()
  }

  riders.push(rider)
  writeJson(RIDERS_FILE, riders)

  res.json({
    success: true,
    rider
  })
})

/* ------------------------------
   DIRECT DRIVER / VEHICLE SIGNUP
------------------------------ */

app.post('/api/driver-signup', async (req, res) => {
  const vehicles = readJson(VEHICLES_FILE)

  const vehicle = {
    id: uid('vehicle'),
    type: req.body.type || 'human',
    name: req.body.name || '',
    email: req.body.email || '',
    phone: req.body.phone || '',
    city: req.body.city || '',
    vehicle: req.body.vehicle || '',
    plate: req.body.plate || '',
    license: req.body.license || '',
    zone: req.body.zone || 'default',
    battery: Number(req.body.battery || 100),
    status: 'pending_checkr',
    available: false,
    remoteAssist: false,
    remoteOperatorId: null,
    takeoverMode: false,
    safetyState: 'normal',

    approvalStatus: 'pending_review',
    backgroundCheckStatus: 'pending_checkr',
    checkrInvitationStatus: 'not_sent',

    checkrCandidateId: null,
    checkrInvitationId: null,
    checkrInvitationUrl: null,
    checkrReportId: null,
    checkrResult: null,

    createdAt: nowIso(),
    timeline: [
      timelineEntry('driver_signup_submitted', 'Driver/vehicle profile created')
    ]
  }

  vehicles.push(vehicle)
  writeJson(VEHICLES_FILE, vehicles)

  try {
    if (!CHECKR_API_KEY) {
      return res.json({
        success: true,
        vehicle,
        message: 'Driver saved. CHECKR_API_KEY not set yet, so invitation was not sent.'
      })
    }

    const nameParts = safeNameParts(vehicle.name)

    const candidate = await checkrRequest('/candidates', 'POST', {
      email: vehicle.email,
      phone: vehicle.phone,
      first_name: nameParts.first_name,
      last_name: nameParts.last_name
    })

    vehicle.checkrCandidateId = candidate.id
    vehicle.backgroundCheckStatus = 'checkr_candidate_created'
    vehicle.timeline.push(
      timelineEntry('checkr_candidate_created', `Candidate ${candidate.id} created`)
    )

    const invitation = await checkrRequest('/invitations', 'POST', {
      candidate_id: candidate.id,
      package: CHECKR_PACKAGE,
      work_locations: [
        {
          country: DEFAULT_WORK_COUNTRY,
          state: DEFAULT_WORK_STATE,
          city: DEFAULT_WORK_CITY
        }
      ]
    })

    vehicle.checkrInvitationId = invitation.id || null
    vehicle.checkrInvitationUrl = invitation.invitation_url || null
    vehicle.checkrInvitationStatus = invitation.status || 'pending'
    vehicle.backgroundCheckStatus = 'checkr_invited'
    vehicle.timeline.push(
      timelineEntry('checkr_invitation_created', `Invitation ${invitation.id || ''} created`)
    )

    writeJson(VEHICLES_FILE, vehicles)

    return res.json({
      success: true,
      vehicle,
      invitationUrl: vehicle.checkrInvitationUrl,
      message: 'Driver saved and Checkr invitation created.'
    })
  } catch (error) {
    vehicle.backgroundCheckStatus = 'checkr_error'
    vehicle.checkrInvitationStatus = 'failed'
    vehicle.timeline.push(
      timelineEntry('checkr_error', error.message)
    )
    writeJson(VEHICLES_FILE, vehicles)

    return res.status(500).json({
      success: false,
      vehicle,
      error: error.message
    })
  }
})

/* ------------------------------
   MANUAL RE-SEND CHECKR INVITE
------------------------------ */

app.post('/api/vehicle/:id/send-checkr', async (req, res) => {
  const vehicles = readJson(VEHICLES_FILE)
  const vehicle = vehicles.find(v => v.id === req.params.id)

  if (!vehicle) {
    return res.status(404).json({ success: false, error: 'Vehicle not found' })
  }

  if (!CHECKR_API_KEY) {
    return res.status(400).json({ success: false, error: 'Missing CHECKR_API_KEY' })
  }

  try {
    let candidateId = vehicle.checkrCandidateId

    if (!candidateId) {
      const nameParts = safeNameParts(vehicle.name)

      const candidate = await checkrRequest('/candidates', 'POST', {
        email: vehicle.email,
        phone: vehicle.phone,
        first_name: nameParts.first_name,
        last_name: nameParts.last_name
      })

      candidateId = candidate.id
      vehicle.checkrCandidateId = candidate.id
      vehicle.timeline.push(
        timelineEntry('checkr_candidate_created', `Candidate ${candidate.id} created`)
      )
    }

    const invitation = await checkrRequest('/invitations', 'POST', {
      candidate_id: candidateId,
      package: CHECKR_PACKAGE,
      work_locations: [
        {
          country: DEFAULT_WORK_COUNTRY,
          state: DEFAULT_WORK_STATE,
          city: DEFAULT_WORK_CITY
        }
      ]
    })

    vehicle.checkrInvitationId = invitation.id || null
    vehicle.checkrInvitationUrl = invitation.invitation_url || null
    vehicle.checkrInvitationStatus = invitation.status || 'pending'
    vehicle.backgroundCheckStatus = 'checkr_invited'
    vehicle.timeline.push(
      timelineEntry('checkr_invitation_created', `Invitation ${invitation.id || ''} created`)
    )

    writeJson(VEHICLES_FILE, vehicles)

    res.json({
      success: true,
      vehicle,
      invitationUrl: vehicle.checkrInvitationUrl
    })
  } catch (error) {
    vehicle.backgroundCheckStatus = 'checkr_error'
    vehicle.timeline.push(timelineEntry('checkr_error', error.message))
    writeJson(VEHICLES_FILE, vehicles)

    res.status(500).json({
      success: false,
      error: error.message
    })
  }
})

/* ------------------------------
   GET VEHICLES
------------------------------ */

app.get('/api/vehicles', (req, res) => {
  const vehicles = readJson(VEHICLES_FILE)
  res.json(vehicles.map(driverPublicView))
})

/* ------------------------------
   MANUAL APPROVAL / REVIEW
------------------------------ */

app.post('/api/vehicle/:id/approve', (req, res) => {
  const vehicles = readJson(VEHICLES_FILE)
  const vehicle = vehicles.find(v => v.id === req.params.id)

  if (!vehicle) {
    return res.status(404).json({ success: false, error: 'Vehicle not found' })
  }

  vehicle.approvalStatus = 'approved'
  vehicle.backgroundCheckStatus = 'approved'
  vehicle.status = 'online'
  vehicle.available = true
  vehicle.timeline.push(timelineEntry('driver_approved', 'Approved manually by admin'))

  writeJson(VEHICLES_FILE, vehicles)

  res.json({
    success: true,
    vehicle: driverPublicView(vehicle)
  })
})

app.post('/api/vehicle/:id/review-required', (req, res) => {
  const vehicles = readJson(VEHICLES_FILE)
  const vehicle = vehicles.find(v => v.id === req.params.id)

  if (!vehicle) {
    return res.status(404).json({ success: false, error: 'Vehicle not found' })
  }

  vehicle.approvalStatus = 'review_required'
  vehicle.backgroundCheckStatus = 'review_required'
  vehicle.status = 'review_required'
  vehicle.available = false
  vehicle.timeline.push(timelineEntry('review_required', 'Marked for manual review'))

  writeJson(VEHICLES_FILE, vehicles)

  res.json({
    success: true,
    vehicle: driverPublicView(vehicle)
  })
})

/* ------------------------------
   CHECKR WEBHOOK
------------------------------ */

app.post('/api/checkr/webhook', (req, res) => {
  try {
    const rawBody = req.body
    const signature = req.headers['x-checkr-signature']

    if (!verifyCheckrSignature(rawBody, signature)) {
      return res.status(401).json({ success: false, error: 'Invalid signature' })
    }

    const payload = JSON.parse(rawBody.toString('utf8'))
    const vehicles = readJson(VEHICLES_FILE)

    const eventType = payload.type || ''
    const dataObject = payload.data?.object || payload.data || {}

    // Invitation updates
    if (eventType === 'invitation.created') {
      const vehicle =
        findVehicleByCheckrCandidateId(vehicles, dataObject.candidate_id) ||
        findVehicleByEmail(vehicles, dataObject.candidate?.email)

      if (vehicle) {
        vehicle.checkrInvitationId = dataObject.id || vehicle.checkrInvitationId
        vehicle.checkrInvitationUrl = dataObject.invitation_url || vehicle.checkrInvitationUrl
        vehicle.checkrInvitationStatus = dataObject.status || 'pending'
        vehicle.backgroundCheckStatus = 'checkr_invited'
        vehicle.timeline.push(
          timelineEntry('invitation_created', `Invitation ${dataObject.id || ''} received via webhook`)
        )
      }
    }

    if (eventType === 'invitation.completed') {
      const vehicle =
        findVehicleByCheckrCandidateId(vehicles, dataObject.candidate_id) ||
        findVehicleByEmail(vehicles, dataObject.candidate?.email)

      if (vehicle) {
        vehicle.checkrInvitationStatus = 'completed'
        vehicle.backgroundCheckStatus = 'invitation_completed'
        vehicle.checkrReportId = dataObject.report_id || vehicle.checkrReportId
        vehicle.timeline.push(
          timelineEntry('invitation_completed', 'Candidate completed invitation')
        )
      }
    }

    // Report updates
    if (eventType === 'report.completed') {
      const vehicle =
        findVehicleByCheckrCandidateId(vehicles, dataObject.candidate_id) ||
        findVehicleByEmail(vehicles, dataObject.candidate?.email)

      if (vehicle) {
        const result = dataObject.result || dataObject.status || 'completed'

        vehicle.checkrReportId = dataObject.id || vehicle.checkrReportId
        vehicle.checkrResult = result
        vehicle.checkrInvitationStatus = 'completed'
        vehicle.timeline.push(
          timelineEntry('report_completed', `Checkr result: ${result}`)
        )

        if (String(result).toLowerCase() === 'clear') {
          vehicle.approvalStatus = 'approved'
          vehicle.backgroundCheckStatus = 'approved'
          vehicle.status = 'online'
          vehicle.available = true
          vehicle.timeline.push(
            timelineEntry('driver_auto_approved', 'Auto approved after clear report')
          )
        } else {
          vehicle.approvalStatus = 'review_required'
          vehicle.backgroundCheckStatus = 'review_required'
          vehicle.status = 'review_required'
          vehicle.available = false
          vehicle.timeline.push(
            timelineEntry('driver_review_required', 'Manual review required after report completion')
          )
        }
      }
    }

    if (eventType === 'report.suspended') {
      const vehicle =
        findVehicleByCheckrCandidateId(vehicles, dataObject.candidate_id) ||
        findVehicleByEmail(vehicles, dataObject.candidate?.email)

      if (vehicle) {
        vehicle.backgroundCheckStatus = 'suspended'
        vehicle.approvalStatus = 'pending_review'
        vehicle.status = 'pending_checkr'
        vehicle.available = false
        vehicle.timeline.push(
          timelineEntry('report_suspended', 'Checkr report suspended, waiting for more info')
        )
      }
    }

    writeJson(VEHICLES_FILE, vehicles)

    return res.status(200).json({ received: true })
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message
    })
  }
})

/* ------------------------------
   RIDES
------------------------------ */

app.post('/api/request-ride', (req, res) => {
  const rides = readJson(RIDES_FILE)
  const vehicles = readJson(VEHICLES_FILE)

  const approvedVehicle = vehicles.find(v =>
    v.available === true &&
    v.approvalStatus === 'approved' &&
    v.status === 'online'
  )

  const ride = {
    id: uid('ride'),
    rider: req.body.name || req.body.rider || '',
    phone: req.body.phone || '',
    pickup: req.body.pickup || '',
    dropoff: req.body.dropoff || '',
    zone: req.body.zone || 'default',
    status: approvedVehicle ? 'assigned' : 'searching',
    vehicle: approvedVehicle ? approvedVehicle.id : null,
    mission: null,
    createdAt: nowIso()
  }

  if (approvedVehicle) {
    approvedVehicle.available = false
    approvedVehicle.timeline.push(
      timelineEntry('ride_assigned', `Assigned to ride ${ride.id}`)
    )
    writeJson(VEHICLES_FILE, vehicles)
  }

  rides.push(ride)
  writeJson(RIDES_FILE, rides)

  res.json({
    success: true,
    ride
  })
})

app.get('/api/rides', (req, res) => {
  res.json(readJson(RIDES_FILE))
})

app.post('/api/rides/:id/complete', (req, res) => {
  const rides = readJson(RIDES_FILE)
  const vehicles = readJson(VEHICLES_FILE)

  const ride = rides.find(r => r.id === req.params.id)
  if (!ride) {
    return res.status(404).json({ success: false, error: 'Ride not found' })
  }

  ride.status = 'completed'

  const vehicle = vehicles.find(v => v.id === ride.vehicle)
  if (vehicle && vehicle.approvalStatus === 'approved') {
    vehicle.available = true
    vehicle.status = 'online'
    vehicle.timeline.push(
      timelineEntry('ride_completed', `Completed ride ${ride.id}`)
    )
  }

  writeJson(RIDES_FILE, rides)
  writeJson(VEHICLES_FILE, vehicles)

  res.json({ success: true, ride })
})

/* ------------------------------
   MESSAGES
------------------------------ */

app.post('/api/send-message', (req, res) => {
  const messages = readJson(MESSAGES_FILE)

  const message = {
    id: uid('msg'),
    rideId: req.body.rideId || 'support',
    from: req.body.from || 'user',
    to: req.body.to || 'admin',
    text: req.body.text || '',
    time: nowIso()
  }

  messages.push(message)
  writeJson(MESSAGES_FILE, messages)

  res.json({
    success: true,
    message
  })
})

app.get('/api/messages/:rideId', (req, res) => {
  const messages = readJson(MESSAGES_FILE)
  const filtered = messages.filter(m => String(m.rideId) === String(req.params.rideId))
  res.json(filtered)
})

/* ------------------------------
   MISSIONS
------------------------------ */

app.get('/api/missions', (req, res) => {
  res.json(readJson(MISSIONS_FILE))
})

/* ------------------------------
   COMMANDS
------------------------------ */

app.get('/api/vehicle/:id/commands', (req, res) => {
  const commands = readJson(COMMANDS_FILE)
  res.json(commands.filter(c => c.vehicleId === req.params.id))
})

app.post('/api/vehicle/:id/command', (req, res) => {
  const commands = readJson(COMMANDS_FILE)

  const command = {
    id: uid('cmd'),
    vehicleId: req.params.id,
    type: req.body.type || '',
    data: req.body.data || {},
    status: 'queued',
    createdAt: nowIso()
  }

  commands.push(command)
  writeJson(COMMANDS_FILE, commands)

  res.json({
    success: true,
    command
  })
})

/* ------------------------------
   PAGE ROUTER
------------------------------ */

app.get('/:page', (req, res) => {
  const file = path.join(__dirname, 'public', req.params.page)

  if (fs.existsSync(file)) {
    return res.sendFile(file)
  }

  if (fs.existsSync(file + '.html')) {
    return res.sendFile(file + '.html')
  }

  return res.sendFile(path.join(__dirname, 'public', 'index.html'))
})

app.listen(PORT, () => {
  console.log(`Harvey Taxi Direct Checkr server running on port ${PORT}`)
})

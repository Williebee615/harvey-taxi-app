const express = require('express')
const cors = require('cors')
const path = require('path')
const fs = require('fs')
const axios = require('axios')
const crypto = require('crypto')

const app = express()
const PORT = process.env.PORT || 10000

/*
|--------------------------------------------------------------------------
| CONFIG
|--------------------------------------------------------------------------
*/
const DATA_FILE = path.join(__dirname, 'data.json')

const PERSONA_API_KEY = process.env.PERSONA_API_KEY || ''
const PERSONA_WEBHOOK_SECRET = process.env.PERSONA_WEBHOOK_SECRET || ''

const CHECKR_API_KEY = process.env.CHECKR_API_KEY || ''
const CHECKR_WEBHOOK_TOKEN = process.env.CHECKR_WEBHOOK_TOKEN || ''

const CHECKR_BASE_URL = 'https://api.checkr.com/v1'

// IMPORTANT:
// Replace with the exact Checkr package slug/name that works in your account.
// If "harvey driver" fails, try the exact slug shown by Checkr.
const CHECKR_PACKAGE = process.env.CHECKR_PACKAGE || 'harvey driver'

/*
|--------------------------------------------------------------------------
| RAW BODY + JSON PARSING
|--------------------------------------------------------------------------
| We keep rawBody so we can verify Persona webhook signatures.
|--------------------------------------------------------------------------
*/
app.use(cors())
app.use(express.urlencoded({ extended: true }))
app.use(express.json({
  limit: '10mb',
  verify: (req, res, buf) => {
    req.rawBody = buf ? buf.toString('utf8') : ''
  }
}))

app.use(express.static(path.join(__dirname, 'public')))

/*
|--------------------------------------------------------------------------
| DATA HELPERS
|--------------------------------------------------------------------------
*/
function createDefaultData() {
  return {
    drivers: [],
    riders: [],
    rides: [],
    admin: {
      email: 'admin@harveytaxi.com'
    }
  }
}

function ensureDataFile() {
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(createDefaultData(), null, 2))
  }
}

function readData() {
  ensureDataFile()

  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8')
    const parsed = JSON.parse(raw)

    return {
      drivers: Array.isArray(parsed.drivers) ? parsed.drivers : [],
      riders: Array.isArray(parsed.riders) ? parsed.riders : [],
      rides: Array.isArray(parsed.rides) ? parsed.rides : [],
      admin: parsed.admin || { email: 'admin@harveytaxi.com' }
    }
  } catch (error) {
    console.error('Error reading data.json:', error.message)
    const fallback = createDefaultData()
    fs.writeFileSync(DATA_FILE, JSON.stringify(fallback, null, 2))
    return fallback
  }
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2))
}

function makeId(prefix = 'id') {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase()
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return value
    }
  }
  return ''
}

function getNested(obj, pathString, fallback = '') {
  try {
    const value = pathString.split('.').reduce((acc, key) => acc?.[key], obj)
    return value === undefined || value === null ? fallback : value
  } catch {
    return fallback
  }
}

function parseBoolean(value) {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    return ['true', '1', 'yes', 'on'].includes(value.toLowerCase())
  }
  return false
}

function findDriverById(drivers, driverId) {
  return drivers.find(d => d.id === driverId)
}

function findDriverByEmail(drivers, email) {
  const target = normalizeEmail(email)
  return drivers.find(d => normalizeEmail(d.email) === target)
}

function nowIso() {
  return new Date().toISOString()
}

/*
|--------------------------------------------------------------------------
| PERSONA SIGNATURE VERIFICATION
|--------------------------------------------------------------------------
| Persona documents signatures as: t=<unix_timestamp>,v1=<signature>
| Signature is HMAC(secret, `${timestamp}.${rawBody}`)
|--------------------------------------------------------------------------
*/
function parsePersonaSignature(headerValue = '') {
  const parts = String(headerValue)
    .split(',')
    .map(part => part.trim())
    .filter(Boolean)

  const parsed = {}
  for (const part of parts) {
    const [key, value] = part.split('=')
    if (key && value) parsed[key] = value
  }

  return parsed
}

function verifyPersonaSignature(req) {
  if (!PERSONA_WEBHOOK_SECRET) {
    throw new Error('Missing PERSONA_WEBHOOK_SECRET')
  }

  const header =
    req.headers['persona-signature'] ||
    req.headers['Persona-Signature']

  if (!header) {
    throw new Error('Missing Persona-Signature header')
  }

  const parsed = parsePersonaSignature(header)
  const timestamp = parsed.t
  const providedSignature = parsed.v1

  if (!timestamp || !providedSignature) {
    throw new Error('Invalid Persona-Signature header format')
  }

  const signedPayload = `${timestamp}.${req.rawBody || ''}`
  const expectedSignature = crypto
    .createHmac('sha256', PERSONA_WEBHOOK_SECRET)
    .update(signedPayload, 'utf8')
    .digest('hex')

  const providedBuffer = Buffer.from(providedSignature, 'hex')
  const expectedBuffer = Buffer.from(expectedSignature, 'hex')

  if (
    providedBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(providedBuffer, expectedBuffer)
  ) {
    throw new Error('Persona signature verification failed')
  }

  const maxAgeSeconds = 300
  const currentTimestamp = Math.floor(Date.now() / 1000)
  if (Math.abs(currentTimestamp - Number(timestamp)) > maxAgeSeconds) {
    throw new Error('Persona webhook timestamp too old')
  }

  return true
}

/*
|--------------------------------------------------------------------------
| PERSONA DATA EXTRACTION
|--------------------------------------------------------------------------
| Payload shapes can vary by workflow/template, so this tries several paths.
|--------------------------------------------------------------------------
*/
function extractPersonaEvent(reqBody) {
  const eventType = firstNonEmpty(
    reqBody.type,
    reqBody.data?.type,
    reqBody.event_name
  )

  const inquiry = firstNonEmpty(
    reqBody.data?.attributes ? reqBody.data : '',
    reqBody.data?.object,
    reqBody.inquiry,
    reqBody
  )

  const inquiryId = firstNonEmpty(
    reqBody.data?.id,
    reqBody.data?.object?.id,
    reqBody.inquiry?.id,
    reqBody.id
  )

  const inquiryStatus = firstNonEmpty(
    reqBody.data?.attributes?.status,
    reqBody.data?.object?.attributes?.status,
    reqBody.inquiry?.attributes?.status,
    reqBody.status
  )

  const email = firstNonEmpty(
    getNested(reqBody, 'data.attributes.email-address'),
    getNested(reqBody, 'data.attributes.email_address'),
    getNested(reqBody, 'data.attributes.fields.email-address.value'),
    getNested(reqBody, 'data.attributes.fields.email_address.value'),
    getNested(reqBody, 'data.object.attributes.email-address'),
    getNested(reqBody, 'data.object.attributes.email_address'),
    getNested(reqBody, 'included.0.attributes.email-address'),
    getNested(reqBody, 'included.0.attributes.email_address'),
    getNested(reqBody, 'attributes.email-address'),
    getNested(reqBody, 'attributes.email_address')
  )

  const referenceId = firstNonEmpty(
    reqBody.data?.attributes?.referenceId,
    reqBody.data?.attributes?.reference_id,
    reqBody.data?.object?.attributes?.referenceId,
    reqBody.data?.object?.attributes?.reference_id,
    reqBody.referenceId,
    reqBody.reference_id
  )

  return {
    eventType: String(eventType || '').toLowerCase(),
    inquiry,
    inquiryId,
    inquiryStatus: String(inquiryStatus || '').toLowerCase(),
    email,
    referenceId
  }
}

/*
|--------------------------------------------------------------------------
| CHECKR HELPERS
|--------------------------------------------------------------------------
*/
function getCheckrAuthConfig() {
  if (!CHECKR_API_KEY) {
    throw new Error('Missing CHECKR_API_KEY')
  }

  return {
    auth: {
      username: CHECKR_API_KEY,
      password: ''
    },
    headers: {
      'Content-Type': 'application/json'
    }
  }
}

async function createCheckrCandidate(driver) {
  const payload = {
    first_name: driver.firstName || '',
    last_name: driver.lastName || '',
    email: driver.email || '',
    phone: driver.phone || '',
    zipcode: driver.zipCode || driver.zip || '',
    custom_id: driver.id
  }

  const response = await axios.post(
    `${CHECKR_BASE_URL}/candidates`,
    payload,
    getCheckrAuthConfig()
  )

  return response.data
}

async function sendCheckrInvitation(driver, candidateId) {
  const payload = {
    candidate_id: candidateId,
    package: CHECKR_PACKAGE,
    work_locations: [
      {
        country: driver.countryCode || 'US',
        state: driver.stateCode || driver.state || 'TN',
        city: driver.city || 'Nashville'
      }
    ]
  }

  const response = await axios.post(
    `${CHECKR_BASE_URL}/invitations`,
    payload,
    getCheckrAuthConfig()
  )

  return response.data
}

async function startAutomaticCheckrFlow(driver, data) {
  if (!driver) {
    throw new Error('Driver not found for Checkr flow')
  }

  if (driver.checkrStatus === 'invitation_sent' || driver.checkrStatus === 'clear') {
    return {
      skipped: true,
      reason: 'Checkr already started'
    }
  }

  let candidateId = driver.checkrCandidateId || ''
  let candidate = null
  let invitation = null

  if (!candidateId) {
    candidate = await createCheckrCandidate(driver)
    candidateId = candidate.id || ''
    driver.checkrCandidateId = candidateId
    driver.checkrCandidate = candidate
    driver.checkrCandidateCreatedAt = nowIso()
  }

  invitation = await sendCheckrInvitation(driver, candidateId)

  driver.checkrInvitationId = invitation.id || ''
  driver.checkrInvitationUrl = invitation.invitation_url || ''
  driver.checkrPackage = CHECKR_PACKAGE
  driver.checkrStatus = 'invitation_sent'
  driver.status = 'background_pending'
  driver.checkrInvitationSentAt = nowIso()
  driver.lastAutomationStep = 'checkr_invitation_sent'

  saveData(data)

  return {
    skipped: false,
    candidate,
    invitation
  }
}

/*
|--------------------------------------------------------------------------
| DRIVER / RIDER SIGNUP
|--------------------------------------------------------------------------
*/
app.post('/api/driver-signup', (req, res) => {
  try {
    const data = readData()

    const {
      firstName,
      lastName,
      email,
      phone,
      password,
      vehicleMake,
      vehicleModel,
      vehicleYear,
      licensePlate,
      city,
      state,
      zipCode,
      countryCode
    } = req.body

    if (!firstName || !lastName || !email || !phone) {
      return res.status(400).json({
        success: false,
        message: 'First name, last name, email, and phone are required'
      })
    }

    const existingDriver = findDriverByEmail(data.drivers, email)

    if (existingDriver) {
      return res.status(400).json({
        success: false,
        message: 'Driver already exists with this email'
      })
    }

    const driver = {
      id: makeId('driver'),
      firstName,
      lastName,
      email,
      phone,
      password: password || '',
      vehicleMake: vehicleMake || '',
      vehicleModel: vehicleModel || '',
      vehicleYear: vehicleYear || '',
      licensePlate: licensePlate || '',
      city: city || 'Nashville',
      state: state || 'TN',
      stateCode: state || 'TN',
      zipCode: zipCode || '',
      countryCode: countryCode || 'US',
      createdAt: nowIso(),

      // automation state
      personaVerified: false,
      personaStatus: 'pending',
      personaInquiryId: '',
      personaReferenceId: '',

      checkrCandidateId: '',
      checkrInvitationId: '',
      checkrInvitationUrl: '',
      checkrPackage: CHECKR_PACKAGE,
      checkrStatus: 'not_sent',

      approved: false,
      active: false,
      status: 'pending_persona',

      lastAutomationStep: 'driver_signed_up'
    }

    data.drivers.push(driver)
    saveData(data)

    res.json({
      success: true,
      message: 'Driver signup submitted successfully',
      driver
    })
  } catch (error) {
    console.error('Driver signup error:', error.message)
    res.status(500).json({
      success: false,
      message: 'Failed to create driver signup'
    })
  }
})

app.post('/api/rider-signup', (req, res) => {
  try {
    const data = readData()
    const { firstName, lastName, email, phone, password } = req.body

    if (!firstName || !lastName || !email || !phone) {
      return res.status(400).json({
        success: false,
        message: 'First name, last name, email, and phone are required'
      })
    }

    const existingRider = data.riders.find(
      r => normalizeEmail(r.email) === normalizeEmail(email)
    )

    if (existingRider) {
      return res.status(400).json({
        success: false,
        message: 'Rider already exists with this email'
      })
    }

    const rider = {
      id: makeId('rider'),
      firstName,
      lastName,
      email,
      phone,
      password: password || '',
      createdAt: nowIso(),
      active: true,
      status: 'active'
    }

    data.riders.push(rider)
    saveData(data)

    res.json({
      success: true,
      message: 'Rider signup successful',
      rider
    })
  } catch (error) {
    console.error('Rider signup error:', error.message)
    res.status(500).json({
      success: false,
      message: 'Failed to create rider signup'
    })
  }
})

/*
|--------------------------------------------------------------------------
| OPTIONAL MANUAL PERSONA MARKER
|--------------------------------------------------------------------------
| Keeps your older workflow available if needed.
|--------------------------------------------------------------------------
*/
app.post('/api/persona/verified', async (req, res) => {
  try {
    const data = readData()
    const { driverId, personaInquiryId } = req.body

    const driver = findDriverById(data.drivers, driverId)

    if (!driver) {
      return res.status(404).json({
        success: false,
        message: 'Driver not found'
      })
    }

    driver.personaVerified = true
    driver.personaStatus = 'approved'
    driver.personaInquiryId = personaInquiryId || driver.personaInquiryId || ''
    driver.status = 'persona_approved'
    driver.lastAutomationStep = 'persona_verified'

    saveData(data)

    const checkrResult = await startAutomaticCheckrFlow(driver, data)

    res.json({
      success: true,
      message: 'Persona verification saved and Checkr automation started',
      driver,
      checkr: checkrResult
    })
  } catch (error) {
    console.error('Manual persona verification error:', error.message)
    res.status(500).json({
      success: false,
      message: 'Failed to update Persona verification'
    })
  }
})

/*
|--------------------------------------------------------------------------
| PERSONA WEBHOOK - AUTONOMOUS
|--------------------------------------------------------------------------
*/
app.post('/api/webhooks/persona', async (req, res) => {
  try {
    verifyPersonaSignature(req)

    const data = readData()
    const event = extractPersonaEvent(req.body)

    let driver = null

    if (event.referenceId) {
      driver = findDriverById(data.drivers, event.referenceId)
    }

    if (!driver && event.email) {
      driver = findDriverByEmail(data.drivers, event.email)
    }

    if (!driver) {
      return res.status(200).json({
        received: true,
        ignored: true,
        reason: 'No matching driver found'
      })
    }

    driver.personaInquiryId = event.inquiryId || driver.personaInquiryId || ''
    driver.personaReferenceId = event.referenceId || driver.personaReferenceId || ''
    driver.lastPersonaWebhook = req.body
    driver.lastPersonaWebhookAt = nowIso()

    const approved =
      event.eventType === 'inquiry.approved' ||
      event.inquiryStatus === 'approved'

    const failed =
      event.eventType === 'inquiry.failed' ||
      event.inquiryStatus === 'failed'

    const review =
      event.eventType === 'inquiry.marked-for-review' ||
      event.inquiryStatus === 'needs_review' ||
      event.inquiryStatus === 'marked_for_review'

    if (approved) {
      driver.personaVerified = true
      driver.personaStatus = 'approved'
      driver.status = 'persona_approved'
      driver.lastAutomationStep = 'persona_verified'

      saveData(data)

      try {
        await startAutomaticCheckrFlow(driver, data)
      } catch (checkrError) {
        driver.checkrStatus = 'failed'
        driver.status = 'checkr_send_failed'
        driver.checkrError = checkrError.response?.data || checkrError.message
        saveData(data)
      }
    } else if (failed) {
      driver.personaVerified = false
      driver.personaStatus = 'failed'
      driver.status = 'persona_failed'
      driver.active = false
      driver.lastAutomationStep = 'persona_failed'
      saveData(data)
    } else if (review) {
      driver.personaVerified = false
      driver.personaStatus = 'review_required'
      driver.status = 'persona_review_required'
      driver.active = false
      driver.lastAutomationStep = 'persona_review_required'
      saveData(data)
    } else {
      driver.personaStatus = event.inquiryStatus || event.eventType || driver.personaStatus
      saveData(data)
    }

    res.json({ received: true })
  } catch (error) {
    console.error('Persona webhook error:', error.message)
    res.status(400).json({
      success: false,
      message: error.message
    })
  }
})

/*
|--------------------------------------------------------------------------
| CHECKR WEBHOOK - AUTONOMOUS
|--------------------------------------------------------------------------
| This version protects the endpoint with a shared token header/query param.
|--------------------------------------------------------------------------
*/
function verifyCheckrWebhook(req) {
  if (!CHECKR_WEBHOOK_TOKEN) {
    return true
  }

  const headerToken = req.headers['x-checkr-webhook-token']
  const queryToken = req.query.token

  if (headerToken === CHECKR_WEBHOOK_TOKEN || queryToken === CHECKR_WEBHOOK_TOKEN) {
    return true
  }

  throw new Error('Unauthorized Checkr webhook')
}

app.post('/api/webhooks/checkr', (req, res) => {
  try {
    verifyCheckrWebhook(req)

    const data = readData()
    const event = req.body

    const eventType = String(event.type || '').toLowerCase()

    const object = event.data?.object || event.object || event.data || {}
    const candidateId = firstNonEmpty(
      object.candidate_id,
      object.candidate,
      object.id
    )

    const invitationId = firstNonEmpty(
      object.invitation_id,
      object.invitation,
      object.id
    )

    const reportId = firstNonEmpty(
      object.report_id,
      object.report,
      object.id
    )

    const adjudication = String(
      firstNonEmpty(
        object.result,
        object.status,
        object.adjudication
      )
    ).toLowerCase()

    const driver = data.drivers.find(d =>
      d.checkrCandidateId === candidateId ||
      d.checkrInvitationId === invitationId ||
      d.checkrReportId === reportId
    )

    if (!driver) {
      return res.status(200).json({
        received: true,
        ignored: true,
        reason: 'No matching driver found'
      })
    }

    driver.lastCheckrWebhook = event
    driver.lastCheckrWebhookAt = nowIso()

    const looksClear =
      eventType.includes('clear') ||
      adjudication.includes('clear')

    const looksReview =
      eventType.includes('consider') ||
      eventType.includes('suspended') ||
      eventType.includes('review') ||
      adjudication.includes('consider') ||
      adjudication.includes('suspended') ||
      adjudication.includes('review')

    const looksPending =
      eventType.includes('pending') ||
      adjudication.includes('pending')

    if (looksClear) {
      driver.checkrStatus = 'clear'
      driver.approved = true
      driver.active = true
      driver.status = 'active'
      driver.activatedAt = nowIso()
      driver.lastAutomationStep = 'driver_activated'
    } else if (looksReview) {
      driver.checkrStatus = adjudication || eventType || 'review_required'
      driver.approved = false
      driver.active = false
      driver.status = 'background_review_required'
      driver.lastAutomationStep = 'background_review_required'
    } else if (looksPending) {
      driver.checkrStatus = 'pending'
      driver.approved = false
      driver.active = false
      driver.status = 'background_pending'
      driver.lastAutomationStep = 'background_pending'
    } else {
      driver.checkrStatus = adjudication || eventType || driver.checkrStatus
    }

    saveData(data)

    res.json({ received: true })
  } catch (error) {
    console.error('Checkr webhook error:', error.message)
    res.status(401).json({
      success: false,
      message: error.message
    })
  }
})

/*
|--------------------------------------------------------------------------
| OPTIONAL MANUAL FALLBACK ROUTES
|--------------------------------------------------------------------------
*/
app.post('/api/admin/approve-driver', async (req, res) => {
  try {
    const data = readData()
    const { driverId } = req.body
    const driver = findDriverById(data.drivers, driverId)

    if (!driver) {
      return res.status(404).json({
        success: false,
        message: 'Driver not found'
      })
    }

    if (!driver.personaVerified) {
      return res.status(400).json({
        success: false,
        message: 'Driver must complete Persona verification first'
      })
    }

    const checkrResult = await startAutomaticCheckrFlow(driver, data)

    res.json({
      success: true,
      message: 'Checkr flow started',
      driver,
      checkr: checkrResult
    })
  } catch (error) {
    console.error('Manual approve driver error:', error.message)
    res.status(500).json({
      success: false,
      message: 'Failed to start Checkr flow'
    })
  }
})

app.post('/api/admin/activate-driver', (req, res) => {
  try {
    const data = readData()
    const { driverId } = req.body
    const driver = findDriverById(data.drivers, driverId)

    if (!driver) {
      return res.status(404).json({
        success: false,
        message: 'Driver not found'
      })
    }

    driver.checkrStatus = 'clear'
    driver.approved = true
    driver.active = true
    driver.status = 'active'
    driver.activatedAt = nowIso()
    driver.lastAutomationStep = 'driver_activated_manually'

    saveData(data)

    res.json({
      success: true,
      message: 'Driver activated successfully',
      driver
    })
  } catch (error) {
    console.error('Activate driver error:', error.message)
    res.status(500).json({
      success: false,
      message: 'Failed to activate driver'
    })
  }
})

/*
|--------------------------------------------------------------------------
| READ ROUTES
|--------------------------------------------------------------------------
*/
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'))
})

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    message: 'Harvey Taxi autonomous API is running'
  })
})

app.get('/api/drivers', (req, res) => {
  try {
    const data = readData()
    res.json({
      success: true,
      drivers: data.drivers
    })
  } catch (error) {
    console.error('Get drivers error:', error.message)
    res.status(500).json({
      success: false,
      message: 'Failed to load drivers'
    })
  }
})

app.get('/api/rides', (req, res) => {
  try {
    const data = readData()
    res.json({
      success: true,
      rides: data.rides
    })
  } catch (error) {
    console.error('Get rides error:', error.message)
    res.status(500).json({
      success: false,
      message: 'Failed to load rides'
    })
  }
})

/*
|--------------------------------------------------------------------------
| REQUEST RIDE
|--------------------------------------------------------------------------
*/
app.post('/api/request-ride', (req, res) => {
  try {
    const data = readData()

    const {
      riderId,
      riderName,
      pickup,
      dropoff,
      rideType,
      notes
    } = req.body

    if (!pickup || !dropoff) {
      return res.status(400).json({
        success: false,
        message: 'Pickup and dropoff are required'
      })
    }

    const activeDrivers = data.drivers.filter(d => d.active === true && d.status === 'active')
    const assignedDriver = activeDrivers.length > 0 ? activeDrivers[0] : null

    const ride = {
      id: makeId('ride'),
      riderId: riderId || '',
      riderName: riderName || 'Guest Rider',
      pickup,
      dropoff,
      rideType: rideType || 'Standard',
      notes: notes || '',
      driverId: assignedDriver ? assignedDriver.id : '',
      driverName: assignedDriver
        ? `${assignedDriver.firstName} ${assignedDriver.lastName}`
        : '',
      status: assignedDriver ? 'assigned' : 'pending',
      createdAt: nowIso()
    }

    data.rides.push(ride)
    saveData(data)

    res.json({
      success: true,
      message: assignedDriver
        ? 'Ride requested and driver assigned'
        : 'Ride requested and waiting for driver',
      ride
    })
  } catch (error) {
    console.error('Request ride error:', error.message)
    res.status(500).json({
      success: false,
      message: 'Failed to request ride'
    })
  }
})

/*
|--------------------------------------------------------------------------
| HTML FALLBACK
|--------------------------------------------------------------------------
*/
app.get('/:page', (req, res, next) => {
  const requestedFile = `${req.params.page}`
  const fullPath = path.join(__dirname, 'public', requestedFile)

  if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
    return res.sendFile(fullPath)
  }

  const htmlPath = path.join(__dirname, 'public', `${req.params.page}.html`)

  if (fs.existsSync(htmlPath)) {
    return res.sendFile(htmlPath)
  }

  next()
})

app.listen(PORT, () => {
  ensureDataFile()
  console.log(`Harvey Taxi autonomous server running on port ${PORT}`)
})

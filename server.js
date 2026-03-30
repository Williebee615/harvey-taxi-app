const express = require('express')
const cors = require('cors')
const path = require('path')
const fs = require('fs')
const axios = require('axios')
const crypto = require('crypto')

const app = express()
const PORT = process.env.PORT || 10000

app.use(cors())
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true }))
app.use(express.static(path.join(__dirname, 'public')))

const DATA_FILE = path.join(__dirname, 'data.json')

const CHECKR_API_KEY = process.env.CHECKR_API_KEY || ''
const CHECKR_BASE_URL = 'https://api.checkr.com/v1'

// IMPORTANT:
// If "harvey driver" does not work in live testing,
// replace it with the exact package slug from Checkr.
const CHECKR_PACKAGE = 'harvey driver'

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

function findDriverById(drivers, driverId) {
  return drivers.find(d => d.id === driverId)
}

async function sendCheckrInvitation(driver) {
  if (!CHECKR_API_KEY) {
    throw new Error('Missing CHECKR_API_KEY environment variable')
  }

  const firstName = driver.firstName || driver.first_name || ''
  const lastName = driver.lastName || driver.last_name || ''
  const email = driver.email || ''
  const phone = driver.phone || ''

  if (!firstName || !lastName || !email) {
    throw new Error('Driver is missing first name, last name, or email')
  }

  const payload = {
    package: CHECKR_PACKAGE,
    candidate: {
      first_name: firstName,
      last_name: lastName,
      email,
      phone
    }
  }

  const response = await axios.post(
    `${CHECKR_BASE_URL}/invitations`,
    payload,
    {
      auth: {
        username: CHECKR_API_KEY,
        password: ''
      },
      headers: {
        'Content-Type': 'application/json'
      }
    }
  )

  return response.data
}

// Home
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'))
})

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    message: 'Harvey Taxi API is running'
  })
})

/*
|--------------------------------------------------------------------------
| DRIVER SIGNUP
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
      state
    } = req.body

    if (!firstName || !lastName || !email || !phone) {
      return res.status(400).json({
        success: false,
        message: 'First name, last name, email, and phone are required'
      })
    }

    const existingDriver = data.drivers.find(
      d => d.email && d.email.toLowerCase() === String(email).toLowerCase()
    )

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
      city: city || '',
      state: state || 'TN',
      createdAt: new Date().toISOString(),

      // Verification flow
      personaVerified: false,
      personaStatus: 'pending',
      checkrInvitationId: '',
      checkrCandidateId: '',
      checkrPackage: CHECKR_PACKAGE,
      checkrStatus: 'not_sent',

      // Platform status
      approved: false,
      active: false,
      status: 'pending_persona'
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

/*
|--------------------------------------------------------------------------
| RIDER SIGNUP
|--------------------------------------------------------------------------
*/
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
      r => r.email && r.email.toLowerCase() === String(email).toLowerCase()
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
      createdAt: new Date().toISOString(),
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
| PERSONA CALLBACK / MANUAL UPDATE
|--------------------------------------------------------------------------
| Use this after Persona verifies a driver.
|--------------------------------------------------------------------------
*/
app.post('/api/persona/verified', (req, res) => {
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
    driver.personaInquiryId = personaInquiryId || ''
    driver.status = 'pending_admin_approval'

    saveData(data)

    res.json({
      success: true,
      message: 'Persona verification saved',
      driver
    })
  } catch (error) {
    console.error('Persona verify error:', error.message)
    res.status(500).json({
      success: false,
      message: 'Failed to update Persona verification'
    })
  }
})

/*
|--------------------------------------------------------------------------
| GET ALL DRIVERS
|--------------------------------------------------------------------------
*/
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

/*
|--------------------------------------------------------------------------
| GET ALL RIDES
|--------------------------------------------------------------------------
*/
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
      createdAt: new Date().toISOString()
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
| ADMIN APPROVE DRIVER
|--------------------------------------------------------------------------
| Flow:
| 1. Driver signs up
| 2. Persona verifies identity
| 3. Admin approves
| 4. Checkr invitation is sent
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
        message: 'Driver must complete Persona verification before approval'
      })
    }

    let invitation = null

    try {
      invitation = await sendCheckrInvitation(driver)
    } catch (checkrError) {
      console.error('Checkr invitation error:', checkrError.response?.data || checkrError.message)

      driver.approved = false
      driver.active = false
      driver.status = 'checkr_send_failed'
      driver.checkrStatus = 'failed'
      driver.checkrError = checkrError.response?.data || checkrError.message

      saveData(data)

      return res.status(500).json({
        success: false,
        message: 'Driver approval failed because Checkr invitation could not be sent',
        error: checkrError.response?.data || checkrError.message
      })
    }

    driver.approved = true
    driver.active = false
    driver.status = 'background_pending'
    driver.checkrStatus = 'invitation_sent'
    driver.checkrInvitationId = invitation.id || ''
    driver.checkrCandidateId = invitation.candidate_id || ''
    driver.checkrInvitationUrl = invitation.invitation_url || ''
    driver.checkrReportId = invitation.report_id || ''
    driver.checkrPackage = CHECKR_PACKAGE
    driver.approvedAt = new Date().toISOString()

    saveData(data)

    res.json({
      success: true,
      message: 'Driver approved and Checkr background check sent',
      driver,
      checkr: invitation
    })
  } catch (error) {
    console.error('Approve driver error:', error.message)
    res.status(500).json({
      success: false,
      message: 'Failed to approve driver'
    })
  }
})

/*
|--------------------------------------------------------------------------
| ADMIN ACTIVATE DRIVER
|--------------------------------------------------------------------------
| Use this after Checkr clears the report
|--------------------------------------------------------------------------
*/
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

    driver.active = true
    driver.approved = true
    driver.status = 'active'
    driver.checkrStatus = 'clear'
    driver.activatedAt = new Date().toISOString()

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
| ADMIN REJECT DRIVER
|--------------------------------------------------------------------------
*/
app.post('/api/admin/reject-driver', (req, res) => {
  try {
    const data = readData()
    const { driverId, reason } = req.body

    const driver = findDriverById(data.drivers, driverId)

    if (!driver) {
      return res.status(404).json({
        success: false,
        message: 'Driver not found'
      })
    }

    driver.active = false
    driver.approved = false
    driver.status = 'rejected'
    driver.rejectionReason = reason || 'Not provided'
    driver.rejectedAt = new Date().toISOString()

    saveData(data)

    res.json({
      success: true,
      message: 'Driver rejected successfully',
      driver
    })
  } catch (error) {
    console.error('Reject driver error:', error.message)
    res.status(500).json({
      success: false,
      message: 'Failed to reject driver'
    })
  }
})

/*
|--------------------------------------------------------------------------
| OPTIONAL CHECKR WEBHOOK
|--------------------------------------------------------------------------
| If you later add a Checkr webhook, this can auto-update drivers.
|--------------------------------------------------------------------------
*/
app.post('/api/checkr/webhook', (req, res) => {
  try {
    const data = readData()
    const event = req.body

    const candidateId =
      event?.data?.object?.candidate_id ||
      event?.data?.object?.candidate ||
      ''

    const invitationId =
      event?.data?.object?.invitation_id ||
      event?.data?.object?.id ||
      ''

    const status =
      event?.data?.object?.status ||
      event?.type ||
      ''

    const driver = data.drivers.find(d =>
      d.checkrCandidateId === candidateId ||
      d.checkrInvitationId === invitationId
    )

    if (driver) {
      driver.lastCheckrWebhook = event
      driver.lastCheckrUpdateAt = new Date().toISOString()

      if (String(status).toLowerCase().includes('clear')) {
        driver.checkrStatus = 'clear'
        driver.status = 'active'
        driver.active = true
        driver.approved = true
      } else if (
        String(status).toLowerCase().includes('consider') ||
        String(status).toLowerCase().includes('suspended')
      ) {
        driver.checkrStatus = status
        driver.status = 'review_required'
        driver.active = false
      } else {
        driver.checkrStatus = status || driver.checkrStatus
      }

      saveData(data)
    }

    res.json({ received: true })
  } catch (error) {
    console.error('Checkr webhook error:', error.message)
    res.status(500).json({
      success: false,
      message: 'Webhook processing failed'
    })
  }
})

/*
|--------------------------------------------------------------------------
| FALLBACK FOR HTML FILES
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
  console.log(`Harvey Taxi server running on port ${PORT}`)
})

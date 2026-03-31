require('dotenv').config()

const express = require('express')
const cors = require('cors')
const fs = require('fs')
const path = require('path')
const axios = require('axios')

const app = express()
const PORT = process.env.PORT || 10000
const DATA_FILE = path.join(__dirname, 'data.json')

const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`

app.use(cors())
app.use(express.json({ limit: '2mb' }))
app.use(express.urlencoded({ extended: true }))
app.use(express.static(path.join(__dirname, 'public')))

function defaultData() {
  return {
    users: [],
    drivers: [],
    rides: [],
    company: {
      totalRevenue: 0,
      totalCompletedRides: 0
    }
  }
}

function loadData() {
  try {
    if (!fs.existsSync(DATA_FILE)) return defaultData()

    const raw = fs.readFileSync(DATA_FILE, 'utf8')
    if (!raw.trim()) return defaultData()

    const parsed = JSON.parse(raw)

    if (!parsed.users) parsed.users = []
    if (!parsed.drivers) parsed.drivers = []
    if (!parsed.rides) parsed.rides = []
    if (!parsed.company) {
      parsed.company = {
        totalRevenue: 0,
        totalCompletedRides: 0
      }
    }

    return parsed
  } catch (error) {
    console.error('loadData error:', error.message)
    return defaultData()
  }
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2))
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase()
}

function findUserByEmail(data, email) {
  return data.users.find(u => normalizeEmail(u.email) === normalizeEmail(email))
}

function findUserById(data, id) {
  return data.users.find(u => String(u.id) === String(id))
}

function findDriverById(data, id) {
  return data.drivers.find(d => String(d.id) === String(id))
}

function sanitizeUser(user) {
  if (!user) return null
  const clone = { ...user }
  delete clone.password
  return clone
}

function getOrCreateAdmin(data) {
  let admin = data.users.find(u => u.role === 'admin')

  if (!admin) {
    admin = {
      id: 'admin_1',
      name: 'Admin',
      email: process.env.ADMIN_EMAIL || 'admin@harveytaxiservice.com',
      password: process.env.ADMIN_PASSWORD || '123456',
      role: 'admin',
      createdAt: new Date().toISOString()
    }
    data.users.push(admin)
    saveData(data)
  }

  return admin
}

async function createPersonaInquiry({ templateId, userId, name, email }) {
  const response = await axios.post(
    'https://withpersona.com/api/v1/inquiries',
    {
      data: {
        type: 'inquiry',
        attributes: {
          inquiry_template_id: templateId,
          reference_id: userId,
          note: email || '',
          redirect_uri: `${BASE_URL}/login.html`
        }
      }
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.PERSONA_API_KEY}`,
        'Content-Type': 'application/json'
      },
      timeout: 30000
    }
  )

  const inquiry = response.data?.data || response.data

  return {
    inquiryId: inquiry?.id || '',
    inquiryStatus: inquiry?.attributes?.status || 'created',
    inquiryLink:
      inquiry?.attributes?.inquiry_link ||
      inquiry?.attributes?.expired_inquiry_link ||
      ''
  }
}

async function createCheckrCandidate({ driverId, name, email, phone }) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean)
  const firstName = parts[0] || 'Driver'
  const lastName = parts.slice(1).join(' ') || 'Applicant'

  const params = new URLSearchParams()
  params.append('first_name', firstName)
  params.append('last_name', lastName)
  params.append('email', email || '')
  params.append('phone', phone || '')
  params.append('custom_id', driverId)

  const response = await axios.post(
    'https://api.checkr.com/v1/candidates',
    params.toString(),
    {
      headers: {
        Authorization: `Bearer ${process.env.CHECKR_API_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      timeout: 30000
    }
  )

  return response.data
}

async function createCheckrInvitation({ candidateId }) {
  const params = new URLSearchParams()
  params.append('candidate_id', candidateId)
  params.append('package', process.env.CHECKR_PACKAGE || 'driver_pro')

  if (process.env.CHECKR_NODE) {
    params.append('node', process.env.CHECKR_NODE)
  }

  // Checkr commonly requires work location context for invitations.
  params.append('work_locations[][country]', process.env.CHECKR_WORK_LOCATION_COUNTRY || 'US')
  params.append('work_locations[][state]', process.env.CHECKR_WORK_LOCATION_STATE || 'TN')
  params.append('work_locations[][city]', process.env.CHECKR_WORK_LOCATION_CITY || 'Nashville')

  const response = await axios.post(
    'https://api.checkr.com/v1/invitations',
    params.toString(),
    {
      headers: {
        Authorization: `Bearer ${process.env.CHECKR_API_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      timeout: 30000
    }
  )

  return response.data
}

app.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'Harvey Taxi verification server is running'
  })
})

app.post('/api/setup-admin', (req, res) => {
  try {
    const data = loadData()
    const admin = getOrCreateAdmin(data)

    res.json({
      success: true,
      admin: sanitizeUser(admin)
    })
  } catch (error) {
    console.error('setup-admin error:', error.message)
    res.status(500).json({
      success: false,
      message: 'Failed to set up admin'
    })
  }
})

app.get('/api/admin/drivers', (req, res) => {
  try {
    const data = loadData()
    res.json({
      success: true,
      drivers: data.drivers
    })
  } catch (error) {
    console.error('admin drivers error:', error.message)
    res.status(500).json({
      success: false,
      message: 'Failed to load drivers'
    })
  }
})

app.post('/api/rider/signup', async (req, res) => {
  try {
    const { name, phone, email, password } = req.body

    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        message: 'name, email, and password are required'
      })
    }

    const data = loadData()

    if (findUserByEmail(data, email)) {
      return res.status(400).json({
        success: false,
        message: 'Email already exists'
      })
    }

    const userId = `rider_${Date.now()}`

    const user = {
      id: userId,
      name,
      phone: phone || '',
      email,
      password,
      role: 'rider',
      verificationStatus: 'persona_pending',
      personaInquiryId: '',
      personaInquiryUrl: '',
      personaInquiryStatus: 'not_started',
      createdAt: new Date().toISOString()
    }

    data.users.push(user)
    saveData(data)

    const persona = await createPersonaInquiry({
      templateId: process.env.PERSONA_TEMPLATE_ID_RIDER,
      userId,
      name,
      email
    })

    user.personaInquiryId = persona.inquiryId
    user.personaInquiryUrl = persona.inquiryLink
    user.personaInquiryStatus = persona.inquiryStatus
    saveData(data)

    res.json({
      success: true,
      message: 'Rider created. Complete Persona verification.',
      user: sanitizeUser(user)
    })
  } catch (error) {
    console.error('rider signup error:', error.response?.data || error.message)
    res.status(500).json({
      success: false,
      message: 'Failed to create rider account'
    })
  }
})

app.post('/api/driver/signup', async (req, res) => {
  try {
    const { name, phone, email, password, vehicle, plate } = req.body

    if (!name || !email || !password || !vehicle) {
      return res.status(400).json({
        success: false,
        message: 'name, email, password, and vehicle are required'
      })
    }

    const data = loadData()

    if (findUserByEmail(data, email)) {
      return res.status(400).json({
        success: false,
        message: 'Email already exists'
      })
    }

    const userId = `driver_${Date.now()}`

    const user = {
      id: userId,
      name,
      phone: phone || '',
      email,
      password,
      role: 'driver',
      approvalStatus: 'pending',
      personaStatus: 'pending',
      checkrStatus: 'not_started',
      personaInquiryId: '',
      personaInquiryUrl: '',
      personaInquiryStatus: 'not_started',
      checkrCandidateId: '',
      checkrInvitationId: '',
      checkrInvitationUrl: '',
      createdAt: new Date().toISOString()
    }

    const driver = {
      id: userId,
      name,
      phone: phone || '',
      email,
      vehicle,
      plate: plate || '',
      wallet: 0,
      totalTrips: 0,
      totalEarnings: 0,
      status: 'pending'
    }

    data.users.push(user)
    data.drivers.push(driver)
    saveData(data)

    const persona = await createPersonaInquiry({
      templateId: process.env.PERSONA_TEMPLATE_ID_DRIVER,
      userId,
      name,
      email
    })

    user.personaInquiryId = persona.inquiryId
    user.personaInquiryUrl = persona.inquiryLink
    user.personaInquiryStatus = persona.inquiryStatus
    saveData(data)

    res.json({
      success: true,
      message: 'Driver created. Complete Persona verification first.',
      user: sanitizeUser(user),
      driver
    })
  } catch (error) {
    console.error('driver signup error:', error.response?.data || error.message)
    res.status(500).json({
      success: false,
      message: 'Failed to create driver account'
    })
  }
})

app.post('/api/login', (req, res) => {
  try {
    const { email, password } = req.body
    const data = loadData()

    const user = data.users.find(
      u => normalizeEmail(u.email) === normalizeEmail(email) && u.password === password
    )

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      })
    }

    if (user.role === 'rider' && user.verificationStatus !== 'persona_passed') {
      return res.status(403).json({
        success: false,
        message: 'Rider must complete Persona verification first'
      })
    }

    if (user.role === 'driver') {
      if (user.personaStatus !== 'passed') {
        return res.status(403).json({
          success: false,
          message: 'Driver must complete Persona first'
        })
      }

      if (user.checkrStatus !== 'clear') {
        return res.status(403).json({
          success: false,
          message: 'Driver background check is not cleared yet'
        })
      }

      if (user.approvalStatus !== 'approved') {
        return res.status(403).json({
          success: false,
          message: 'Driver account is waiting for approval'
        })
      }
    }

    res.json({
      success: true,
      user: sanitizeUser(user)
    })
  } catch (error) {
    console.error('login error:', error.message)
    res.status(500).json({
      success: false,
      message: 'Login failed'
    })
  }
})

app.post('/api/admin/approve-driver', (req, res) => {
  try {
    const { driverId } = req.body
    const data = loadData()

    const user = findUserById(data, driverId)
    const driver = findDriverById(data, driverId)

    if (!user || !driver || user.role !== 'driver') {
      return res.status(404).json({
        success: false,
        message: 'Driver not found'
      })
    }

    if (user.personaStatus !== 'passed' || user.checkrStatus !== 'clear') {
      return res.status(400).json({
        success: false,
        message: 'Driver must pass Persona and Checkr first'
      })
    }

    user.approvalStatus = 'approved'
    driver.status = 'active'
    saveData(data)

    res.json({
      success: true,
      message: 'Driver approved'
    })
  } catch (error) {
    console.error('approve driver error:', error.message)
    res.status(500).json({
      success: false,
      message: 'Failed to approve driver'
    })
  }
})

app.post('/api/webhooks/persona', async (req, res) => {
  try {
    const payload = req.body

    const inquiryId =
      payload?.data?.id ||
      payload?.data?.data?.id ||
      payload?.included?.[0]?.id ||
      ''

    const referenceId =
      payload?.data?.attributes?.reference_id ||
      payload?.data?.data?.attributes?.reference_id ||
      payload?.included?.[0]?.attributes?.reference_id ||
      ''

    const status =
      payload?.data?.attributes?.status ||
      payload?.data?.data?.attributes?.status ||
      payload?.included?.[0]?.attributes?.status ||
      ''

    const data = loadData()
    const user = data.users.find(
      u => String(u.id) === String(referenceId) || String(u.personaInquiryId) === String(inquiryId)
    )

    if (!user) {
      return res.json({ success: true, message: 'No matching user' })
    }

    if (user.role === 'rider') {
      user.personaInquiryStatus = status || user.personaInquiryStatus

      if (status === 'approved' || status === 'completed') {
        user.verificationStatus = 'persona_passed'
      } else if (status === 'failed' || status === 'declined') {
        user.verificationStatus = 'persona_failed'
      } else {
        user.verificationStatus = 'persona_pending'
      }
    }

    if (user.role === 'driver') {
      user.personaInquiryStatus = status || user.personaInquiryStatus

      if (status === 'approved' || status === 'completed') {
        user.personaStatus = 'passed'

        if (!user.checkrCandidateId) {
          const candidate = await createCheckrCandidate({
            driverId: user.id,
            name: user.name,
            email: user.email,
            phone: user.phone
          })

          user.checkrCandidateId = candidate.id
          user.checkrStatus = 'candidate_created'

          const invitation = await createCheckrInvitation({
            candidateId: candidate.id
          })

          user.checkrInvitationId = invitation.id || ''
          user.checkrInvitationUrl =
            invitation.invitation_url ||
            invitation.url ||
            ''
          user.checkrStatus = 'pending'
        }
      } else if (status === 'failed' || status === 'declined') {
        user.personaStatus = 'failed'
      } else {
        user.personaStatus = 'pending'
      }
    }

    saveData(data)

    res.json({ success: true })
  } catch (error) {
    console.error('persona webhook error:', error.response?.data || error.message)
    res.status(500).json({
      success: false,
      message: 'Persona webhook failed'
    })
  }
})

app.post('/api/webhooks/checkr', (req, res) => {
  try {
    const payload = req.body
    const data = loadData()

    const object = payload?.data?.object || payload?.object || {}
    const candidateId = object?.candidate_id || object?.id || ''
    const eventType = String(payload?.type || payload?.event || '').toLowerCase()

    const user = data.users.find(
      u => u.role === 'driver' && String(u.checkrCandidateId) === String(candidateId)
    )

    if (!user) {
      return res.json({ success: true, message: 'No matching driver' })
    }

    const adjudication = String(object?.adjudication || object?.status || '').toLowerCase()

    if (eventType.includes('invitation')) {
      if (adjudication.includes('complete') || adjudication.includes('completed')) {
        user.checkrStatus = 'report_pending'
      } else {
        user.checkrStatus = 'pending'
      }
    }

    if (eventType.includes('report')) {
      if (adjudication.includes('clear')) {
        user.checkrStatus = 'clear'
      } else if (adjudication.includes('consider')) {
        user.checkrStatus = 'consider'
      } else {
        user.checkrStatus = 'pending'
      }
    }

    saveData(data)

    res.json({ success: true })
  } catch (error) {
    console.error('checkr webhook error:', error.message)
    res.status(500).json({
      success: false,
      message: 'Checkr webhook failed'
    })
  }
})

app.listen(PORT, () => {
  console.log(`Harvey Taxi verification server running on port ${PORT}`)
})

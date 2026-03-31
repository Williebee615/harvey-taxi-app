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

function sanitizeUser(user) {
  if (!user) return null
  const clone = { ...user }
  delete clone.password
  return clone
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

async function createPersonaVerificationLink({ userId, name, email, templateId }) {
  return {
    verificationId: `persona_${Date.now()}`,
    verificationUrl: `${BASE_URL}/persona-start.html?userId=${encodeURIComponent(userId)}&templateId=${encodeURIComponent(templateId)}`
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
      }
    }
  )

  return response.data
}

async function createCheckrInvitation({ candidateId }) {
  const params = new URLSearchParams()
  params.append('candidate_id', candidateId)
  params.append('package', process.env.CHECKR_PACKAGE || 'harvey driver')

  const response = await axios.post(
    'https://api.checkr.com/v1/invitations',
    params.toString(),
    {
      headers: {
        Authorization: `Bearer ${process.env.CHECKR_API_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    }
  )

  return response.data
}

app.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'Harvey Taxi server is running'
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
    res.status(500).json({
      success: false,
      message: 'Failed to set up admin'
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

    const verification = await createPersonaVerificationLink({
      userId,
      name,
      email,
      templateId: process.env.PERSONA_TEMPLATE_ID_RIDER
    })

    const user = {
      id: userId,
      name,
      phone: phone || '',
      email,
      password,
      role: 'rider',
      verificationStatus: 'persona_pending',
      personaTemplateId: process.env.PERSONA_TEMPLATE_ID_RIDER || '',
      personaVerificationId: verification.verificationId,
      personaVerificationUrl: verification.verificationUrl,
      createdAt: new Date().toISOString()
    }

    data.users.push(user)
    saveData(data)

    res.json({
      success: true,
      message: 'Rider account created. Complete Persona verification.',
      user: sanitizeUser(user)
    })
  } catch (error) {
    console.error('rider signup error:', error.message)
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

    const verification = await createPersonaVerificationLink({
      userId,
      name,
      email,
      templateId: process.env.PERSONA_TEMPLATE_ID_DRIVER
    })

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
      personaTemplateId: process.env.PERSONA_TEMPLATE_ID_DRIVER || '',
      personaVerificationId: verification.verificationId,
      personaVerificationUrl: verification.verificationUrl,
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

    res.json({
      success: true,
      message: 'Driver application submitted. Complete Persona first.',
      user: sanitizeUser(user),
      driver
    })
  } catch (error) {
    console.error('driver signup error:', error.message)
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
          message: 'Driver is waiting for approval'
        })
      }
    }

    res.json({
      success: true,
      user:

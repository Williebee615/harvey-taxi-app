require('dotenv').config()

const express = require('express')
const cors = require('cors')
const fs = require('fs')
const path = require('path')
const axios = require('axios')

const app = express()
const PORT = process.env.PORT || 10000
const DATA_FILE = path.join(__dirname, 'data.json')
const PUBLIC_DIR = path.join(__dirname, 'public')

app.use(cors())
app.use(express.json({ limit: '2mb' }))
app.use(express.urlencoded({ extended: true }))
app.use(express.static(PUBLIC_DIR))

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
    if (!fs.existsSync(DATA_FILE)) {
      const fresh = defaultData()
      fs.writeFileSync(DATA_FILE, JSON.stringify(fresh, null, 2))
      return fresh
    }

    const raw = fs.readFileSync(DATA_FILE, 'utf8')
    if (!raw.trim()) return defaultData()

    const parsed = JSON.parse(raw)

    if (!Array.isArray(parsed.users)) parsed.users = []
    if (!Array.isArray(parsed.drivers)) parsed.drivers = []
    if (!Array.isArray(parsed.rides)) parsed.rides = []
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

function generateId(prefix = 'id') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function sanitizeUser(user) {
  if (!user) return null
  const clean = { ...user }
  delete clean.password
  return clean
}

function findUserByEmail(data, email) {
  return data.users.find(u => normalizeEmail(u.email) === normalizeEmail(email))
}

function findUserById(data, id) {
  return data.users.find(u => u.id === id)
}

function findDriverById(data, id) {
  return data.drivers.find(d => d.id === id)
}

function getBaseUrl() {
  return process.env.BASE_URL || `http://localhost:${PORT}`
}

async function createPersonaInquiry({ templateId, referenceId }) {
  const response = await axios.post(
    'https://withpersona.com/api/v1/inquiries',
    {
      data: {
        type: 'inquiry',
        attributes: {
          inquiry_template_id: templateId,
          reference_id: referenceId,
          redirect_uri: `${getBaseUrl()}/login.html`
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

  const inquiry = response.data?.data
  return {
    inquiryId: inquiry?.id || '',
    inquiryUrl:
      inquiry?.attributes?.inquiry_link ||
      inquiry?.attributes?.expired_inquiry_link ||
      ''
  }
}

function ensureAdmin(data) {
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

app.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'Harvey Taxi server is running'
  })
})

app.post('/api/setup-admin', (req, res) => {
  try {
    const data = loadData()
    const admin = ensureAdmin(data)

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

    const userId = generateId('rider')

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
      createdAt: new Date().toISOString()
    }

    data.users.push(user)
    saveData(data)

    try {
      const persona = await createPersonaInquiry({
        templateId: process.env.PERSONA_TEMPLATE_ID_RIDER,
        referenceId: userId
      })

      user.personaInquiryId = persona.inquiryId
      user.personaInquiryUrl = persona.inquiryUrl
      saveData(data)
    } catch (personaError) {
      console.error('rider persona error:', personaError.response?.data || personaError.message)
    }

    res.json({
      success: true,
      message: 'Rider account created',
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

    const userId = generateId('driver')

    const user = {
      id: userId,
      name,
      phone: phone || '',
      email,
      password,
      role: 'driver',
      approvalStatus: 'pending',
      personaStatus: 'pending',
      checkrStatus: 'pending',
      personaInquiryId: '',
      personaInquiryUrl: '',
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

    try {
      const persona = await createPersonaInquiry({
        templateId: process.env.PERSONA_TEMPLATE_ID_DRIVER,
        referenceId: userId
      })

      user.personaInquiryId = persona.inquiryId
      user.personaInquiryUrl = persona.inquiryUrl
      saveData(data)
    } catch (personaError) {
      console.error('driver persona error:', personaError.response?.data || personaError.message)
    }

    res.json({
      success: true,
      message: 'Driver application submitted',
      user: sanitizeUser(user)
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

    ensureAdmin(data)

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
          message: 'Driver must complete Persona verification first'
        })
      }

      if (user.checkrStatus !== 'clear') {
        return res.status(403).json({
          success: false,
          message: 'Driver background check has not cleared yet'
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

app.get('/api/admin/drivers', (req, res) => {
  try {
    const data = loadData()

    const result = data.drivers.map(driver => {
      const user = findUserById(data, driver.id)

      return {
        ...driver,
        personaStatus: user?.personaStatus || '',
        checkrStatus: user?.checkrStatus || '',
        approvalStatus: user?.approvalStatus || '',
        personaInquiryUrl: user?.personaInquiryUrl || '',
        checkrInvitationUrl: user?.checkrInvitationUrl || ''
      }
    })

    res.json({
      success: true,
      drivers: result
    })
  } catch (error) {
    console.error('admin drivers error:', error.message)
    res.status(500).json({
      success: false,
      message: 'Failed to load drivers'
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

    if (user.personaStatus !== 'passed') {
      return res.status(400).json({
        success: false,
        message: 'Driver has not passed Persona yet'
      })
    }

    if (user.checkrStatus !== 'clear') {
      return res.status(400).json({
        success: false,
        message: 'Driver has not cleared Checkr yet'
      })
    }

    user.approvalStatus = 'approved'
    driver.status = 'active'
    saveData(data)

    res.json({
      success: true,
      message: 'Driver approved successfully'
    })
  } catch (error) {
    console.error('approve driver error:', error.message)
    res.status(500).json({
      success: false,
      message: 'Failed to approve driver'
    })
  }
})

app.post('/api/persona/mark-pass', (req, res) => {
  try {
    const { userId } = req.body
    const data = loadData()
    const user = findUserById(data, userId)

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      })
    }

    if (user.role === 'rider') {
      user.verificationStatus = 'persona_passed'
    }

    if (user.role === 'driver') {
      user.personaStatus = 'passed'
    }

    saveData(data)

    res.json({
      success: true,
      message: 'Persona marked passed'
    })
  } catch (error) {
    console.error('persona pass error:', error.message)
    res.status(500).json({
      success: false,
      message: 'Failed to mark Persona passed'
    })
  }
})

app.post('/api/checkr/mark-clear', (req, res) => {
  try {
    const { driverId } = req.body
    const data = loadData()
    const user = findUserById(data, driverId)

    if (!user || user.role !== 'driver') {
      return res.status(404).json({
        success: false,
        message: 'Driver not found'
      })
    }

    user.checkrStatus = 'clear'
    saveData(data)

    res.json({
      success: true,
      message: 'Driver Checkr marked clear'
    })
  } catch (error) {
    console.error('checkr mark clear error:', error.message)
    res.status(500).json({
      success: false,
      message: 'Failed to mark Checkr clear'
    })
  }
})

app.post('/api/webhooks/persona', (req, res) => {
  try {
    const payload = req.body
    const data = loadData()

    const referenceId =
      payload?.data?.attributes?.reference_id ||
      payload?.data?.data?.attributes?.reference_id ||
      ''

    const status =
      payload?.data?.attributes?.status ||
      payload?.data?.data?.attributes?.status ||
      ''

    const user = findUserById(data, referenceId)

    if (!user) {
      return res.json({ success: true, message: 'No matching user' })
    }

    if (user.role === 'rider') {
      user.verificationStatus =
        status === 'approved' || status === 'completed'
          ? 'persona_passed'
          : 'persona_pending'
    }

    if (user.role === 'driver') {
      user.personaStatus =
        status === 'approved' || status === 'completed'
          ? 'passed'
          : 'pending'
    }

    saveData(data)

    res.json({ success: true })
  } catch (error) {
    console.error('persona webhook error:', error.message)
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

    const customId =
      payload?.data?.object?.candidate?.custom_id ||
      payload?.data?.object?.custom_id ||
      payload?.custom_id ||
      ''

    const user = findUserById(data, customId)

    if (!user || user.role !== 'driver') {
      return res.json({ success: true, message: 'No matching driver' })
    }

    user.checkrStatus = 'clear'
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

app.get('*', (req, res) => {
  const target = path.join(PUBLIC_DIR, req.path)

  if (fs.existsSync(target) && fs.statSync(target).isFile()) {
    return res.sendFile(target)
  }

  res.sendFile(path.join(PUBLIC_DIR, 'index.html'))
})

app.listen(PORT, () => {
  console.log(`Harvey Taxi server running on port ${PORT}`)
})

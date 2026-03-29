app.post('/api/admin-login',(req,res)=>{

const {email,password} = req.body

if(
email === 'admin@harvey.com' &&
password === 'HarveyAdmin123'
){
res.json({success:true})
}else{
res.json({success:false})
}

})const express = require('express')
const cors = require('cors')
const path = require('path')
const fs = require('fs')

const app = express()
const PORT = process.env.PORT || 10000

app.use(cors())
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true, limit: '10mb' }))
app.use(express.static(path.join(__dirname, 'public')))

const dataFile = path.join(__dirname, 'data.json')

function defaultData() {
  return {
    riders: [],
    drivers: [],
    serviceRequests: [],
    adminNotifications: [],
    admins: [
      {
        id: 'admin_1',
        name: 'Harvey Admin',
        email: 'admin@harveytaxi.com',
        password: 'admin123'
      }
    ]
  }
}

function loadData() {
  if (!fs.existsSync(dataFile)) {
    fs.writeFileSync(dataFile, JSON.stringify(defaultData(), null, 2))
    return defaultData()
  }

  try {
    const raw = fs.readFileSync(dataFile, 'utf8')
    return JSON.parse(raw)
  } catch (err) {
    console.log('Failed to read data.json, creating new file.')
    fs.writeFileSync(dataFile, JSON.stringify(defaultData(), null, 2))
    return defaultData()
  }
}

function saveData(data) {
  fs.writeFileSync(dataFile, JSON.stringify(data, null, 2))
}

function makeId(prefix) {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 100000)}`
}

function sanitizeDriver(driver) {
  return {
    id: driver.id,
    name: driver.name,
    email: driver.email,
    phone: driver.phone,
    vehicleType: driver.vehicleType,
    vehicleMake: driver.vehicleMake,
    vehicleModel: driver.vehicleModel,
    vehicleColor: driver.vehicleColor,
    plateNumber: driver.plateNumber,
    city: driver.city,
    status: driver.status,
    approvalStatus: driver.approvalStatus,
    verificationSubmittedAt: driver.verificationSubmittedAt,
    reviewedAt: driver.reviewedAt || null,
    reviewNotes: driver.reviewNotes || '',
    documents: driver.documents || {},
    createdAt: driver.createdAt
  }
}

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'))
})

app.get('/api/health', (req, res) => {
  res.json({ ok: true, app: 'Harvey Taxi API' })
})

app.post('/api/driver/signup', (req, res) => {
  const data = loadData()

  const {
    name,
    email,
    phone,
    password,
    vehicleType,
    vehicleMake,
    vehicleModel,
    vehicleColor,
    plateNumber,
    city
  } = req.body

  if (!name || !email || !phone || !password) {
    return res.status(400).json({ error: 'Missing required driver fields.' })
  }

  const existing = data.drivers.find(
    d => d.email.toLowerCase() === email.toLowerCase()
  )

  if (existing) {
    return res.status(400).json({ error: 'Driver already exists with this email.' })
  }

  const driver = {
    id: makeId('driver'),
    name,
    email,
    phone,
    password,
    vehicleType: vehicleType || '',
    vehicleMake: vehicleMake || '',
    vehicleModel: vehicleModel || '',
    vehicleColor: vehicleColor || '',
    plateNumber: plateNumber || '',
    city: city || '',
    status: 'offline',
    approvalStatus: 'pending_documents',
    documents: {
      licenseFront: '',
      selfie: '',
      vehicleRegistration: '',
      insurance: ''
    },
    verificationSubmittedAt: null,
    reviewedAt: null,
    reviewNotes: '',
    createdAt: new Date().toISOString()
  }

  data.drivers.push(driver)
  saveData(data)

  res.json({
    message: 'Driver account created.',
    driver: sanitizeDriver(driver)
  })
})

app.post('/api/driver/login', (req, res) => {
  const data = loadData()
  const { email, password } = req.body

  const driver = data.drivers.find(
    d => d.email.toLowerCase() === String(email || '').toLowerCase() && d.password === password
  )

  if (!driver) {
    return res.status(401).json({ error: 'Invalid driver login.' })
  }

  res.json({
    message: 'Driver login successful.',
    driver: sanitizeDriver(driver)
  })
})

app.post('/api/driver/submit-verification', (req, res) => {
  const data = loadData()

  const {
    driverId,
    licenseFront,
    selfie,
    vehicleRegistration,
    insurance
  } = req.body

  const driver = data.drivers.find(d => d.id === driverId)

  if (!driver) {
    return res.status(404).json({ error: 'Driver not found.' })
  }

  if (!licenseFront || !selfie || !vehicleRegistration || !insurance) {
    return res.status(400).json({
      error: 'All verification documents are required.'
    })
  }

  driver.documents = {
    licenseFront,
    selfie,
    vehicleRegistration,
    insurance
  }

  driver.approvalStatus = 'under_review'
  driver.verificationSubmittedAt = new Date().toISOString()
  driver.reviewNotes = ''

  data.adminNotifications.unshift({
    id: makeId('notice'),
    type: 'driver_verification_submitted',
    driverId: driver.id,
    driverName: driver.name,
    createdAt: new Date().toISOString(),
    read: false
  })

  saveData(data)

  res.json({
    message: 'Verification submitted successfully.',
    driver: sanitizeDriver(driver)
  })
})

app.get('/api/driver/:driverId/status', (req, res) => {
  const data = loadData()
  const driver = data.drivers.find(d => d.id === req.params.driverId)

  if (!driver) {
    return res.status(404).json({ error: 'Driver not found.' })
  }

  res.json({
    driver: sanitizeDriver(driver)
  })
})

app.post('/api/admin/login', (req, res) => {
  const data = loadData()
  const { email, password } = req.body

  const admin = data.admin

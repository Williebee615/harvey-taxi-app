const express = require('express')
const cors = require('cors')
const path = require('path')
const fs = require('fs')

const app = express()
const PORT = process.env.PORT || 10000
const DATA_FILE = path.join(__dirname, 'data.json')

app.use(cors())
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true }))
app.use(express.static(path.join(__dirname, 'public')))

function createDefaultData() {
  return {
    riders: [],
    drivers: [],
    admins: [
      {
        id: 'admin_1',
        name: 'Harvey Admin',
        email: 'admin@harveytaxi.com',
        password: 'admin123',
        role: 'admin'
      }
    ],
    rideRequests: [],
    trips: [],
    settings: {
      baseFare: 5,
      perMile: 1.75,
      perMinute: 0.35,
      bookingFee: 2.5,
      minimumFare: 8
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
    return JSON.parse(raw)
  } catch (error) {
    console.error('Error reading data.json:', error)
    return createDefaultData()
  }
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2))
}

function generateId(prefix) {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 100000)}`
}

function toRadians(value) {
  return (value * Math.PI) / 180
}

function getDistanceMiles(lat1, lng1, lat2, lng2) {
  const earthRadiusMiles = 3958.8

  const dLat = toRadians(lat2 - lat1)
  const dLng = toRadians(lng2 - lng1)

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2)

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return earthRadiusMiles * c
}

function estimateFare(distanceMiles, durationMinutes, settings) {
  const rawFare =
    settings.baseFare +
    settings.bookingFee +
    distanceMiles * settings.perMile +
    durationMinutes * settings.perMinute

  return Math.max(rawFare, settings.minimumFare).toFixed(2)
}

function sanitizeUser(user) {
  if (!user) return null
  const copy = { ...user }
  delete copy.password
  return copy
}

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'))
})

app.get('/health', (req, res) => {
  res.json({ success: true, message: 'Harvey Taxi API is running' })
})

/* =========================
   AUTH / SIGNUP
========================= */

app.post('/api/riders/signup', (req, res) => {
  const {
    fullName,
    email,
    phone,
    password,
    emergencyContactName,
    emergencyContactPhone
  } = req.body

  if (!fullName || !email || !phone || !password) {
    return res.status(400).json({
      success: false,
      message: 'Full name, email, phone, and password are required.'
    })
  }

  const data = readData()

  const existingRider = data.riders.find(
    rider => rider.email.toLowerCase() === email.toLowerCase()
  )

  if (existingRider) {
    return res.status(400).json({
      success: false,
      message: 'A rider with this email already exists.'
    })
  }

  const rider = {
    id: generateId('rider'),
    fullName,
    email,
    phone,
    password,
    emergencyContactName: emergencyContactName || '',
    emergencyContactPhone: emergencyContactPhone || '',
    role: 'rider',
    idVerificationStatus: 'pending',
    accountStatus: 'active',
    createdAt: new Date().toISOString()
  }

  data.riders.push(rider)
  saveData(data)

  res.json({
    success: true,
    message: 'Rider account created successfully.',
    rider: sanitizeUser(rider)
  })
})

app.post('/api/drivers/signup', (req, res) => {
  const {
    fullName,
    email,
    phone,
    password,
    vehicleMake,
    vehicleModel,
    vehicleYear,
    vehicleColor,
    licensePlate,
    driversLicenseNumber,
    insurancePolicyNumber,
    selfiePhoto,
    licensePhoto,
    vehicleRegistrationPhoto,
    insurancePhoto
  } = req.body

  if (
    !fullName ||
    !email ||
    !phone ||
    !password ||
    !vehicleMake ||
    !vehicleModel ||
    !vehicleYear ||
    !vehicleColor ||
    !licensePlate
  ) {
    return res.status(400).json({
      success: false,
      message: 'Driver, vehicle, and login details are required.'
    })
  }

  const data = readData()

  const existingDriver = data.drivers.find(
    driver => driver.email.toLowerCase() === email.toLowerCase()
  )

  if (existingDriver) {
    return res.status(400).json({
      success: false,
      message: 'A driver with this email already exists.'
    })
  }

  const driver = {
    id: generateId('driver'),
    fullName,
    email,
    phone,
    password,
    role: 'driver',
    isOnline: false,
    isApproved: false,
    verificationStatus: 'pending',
    backgroundCheckStatus: 'pending',
    currentLat: null,
    currentLng: null,
    vehicle: {
      make: vehicleMake,
      model: vehicleModel,
      year: vehicleYear,
      color: vehicleColor,
      plate: licensePlate
    },
    documents: {
      driversLicenseNumber: driversLicenseNumber || '',
      insurancePolicyNumber: insurancePolicyNumber || '',
      selfiePhoto: selfiePhoto || '',
      licensePhoto: licensePhoto || '',
      vehicleRegistrationPhoto: vehicleRegistrationPhoto || '',
      insurancePhoto: insurancePhoto || ''
    },
    createdAt: new Date().toISOString()
  }

  data.drivers.push(driver)
  saveData(data)

  res.json({
    success: true,
    message: 'Driver account created and submitted for admin approval.',
    driver: sanitizeUser(driver)
  })
})

app.post('/api/login', (req, res) => {
  const { email, password } = req.body

  if (!email || !password) {
    return res.status(400).json({
      success: false,
      message: 'Email and password are required.'
    })
  }

  const data = readData()

  const rider = data.riders.find(
    user =>
      user.email.toLowerCase() === email.toLowerCase() &&
      user.password === password
  )

  if (rider) {
    return res.json({
      success: true,
      role: 'rider',
      user: sanitizeUser(rider)
    })
  }

  const driver = data.drivers.find(
    user =>
      user.email.toLowerCase() === email.toLowerCase() &&
      user.password === password
  )

  if (driver) {
    return res.json({
      success: true,
      role: 'driver',
      user: sanitizeUser(driver)
    })
  }

  const admin = data.admins.find(
    user =>
      user.email.toLowerCase() === email.toLowerCase() &&
      user.password === password
  )

  if (admin) {
    return res.json({
      success:

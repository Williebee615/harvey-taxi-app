const express = require('express')
const cors = require('cors')
const path = require('path')
const fs = require('fs')

const app = express()
const PORT = process.env.PORT || 10000
const DATA_FILE = path.join(__dirname, 'data.json')

app.use(cors())
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true, limit: '10mb' }))
app.use(express.static(path.join(__dirname, 'public')))

function loadData() {
  if (!fs.existsSync(DATA_FILE)) {
    const starterData = {
      users: {
        riders: [],
        drivers: [],
        admins: [
          {
            id: 'admin_1',
            name: 'Harvey Admin',
            email: 'williebee@harveytaxiservice.com',
            password: 'admin123'
          }
        ]
      },
      driversLive: [],
      serviceRequests: [],
      notifications: []
    }
    fs.writeFileSync(DATA_FILE, JSON.stringify(starterData, null, 2))
    return starterData
  }

  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'))
  } catch (err) {
    console.error('Error reading data.json:', err)
    return {
      users: { riders: [], drivers: [], admins: [] },
      driversLive: [],
      serviceRequests: [],
      notifications: []
    }
  }
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2))
}

function uid(prefix = 'id') {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 100000)}`
}

function getDistanceMiles(lat1, lng1, lat2, lng2) {
  const toRad = deg => (deg * Math.PI) / 180
  const R = 3958.8
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2)

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

function seedDefaultDriver(data) {
  if (data.users.drivers.length === 0) {
    data.users.drivers.push({
      id: 'driver_1',
      name: 'Demo Driver',
      email: 'driver1@harveytaxi.com',
      phone: '(615) 555-0101',
      carMake: 'Toyota',
      carModel: 'Camry',
      carColor: 'Black',
      plateNumber: 'HTS-1001',
      verified: true,
      approved: true,
      verificationStatus: 'approved',
      verification: {
        licenseNumber: 'D12345678',
        vehicleRegistration: 'REG-001',
        insurancePolicy: 'INS-001',
        selfieImage: '',
        licenseImage: '',
        vehicleImage: '',
        submittedAt: new Date().toISOString()
      }
    })

    data.driversLive.push({
      driverId: 'driver_1',
      lat: 36.1627,
      lng: -86.7816,
      isOnline: true,
      updatedAt: new Date().toISOString()
    })
  }
}

let db = loadData()
seedDefaultDriver(db)
saveData(db)

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'))
})

app.get('/driver-verification', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'driver-verification.html'))
})

app.get('/admin-verification', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin-verification.html'))
})

app.get('/request-ride', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'request-ride.html'))
})

app.get('/api/health', (req, res) => {
  res.json({ success: true, message: 'Harvey Taxi API running' })
})

app.post('/api/driver/signup', (req, res) => {
  const {
    name,
    email,
    phone,
    password,
    carMake,
    carModel,
    carColor,
    plateNumber
  } = req.body

  if (!name || !email || !phone || !password) {
    return res.status(400).json({
      success: false,
      message: 'Name, email, phone, and password are required.'
    })
  }

  const existing = db.users.drivers.find(
    d => d.email.toLowerCase() === email.toLowerCase()
  )

  if (existing) {
    return res.status(400).json({
      success: false,
      message: 'Driver already exists with this email.'
    })
  }

  const newDriver = {
    id: uid('driver'),
    name,
    email,
    phone,
    password,
    carMake: carMake || '',
    carModel: carModel || '',
    carColor: carColor || '',
    plateNumber: plateNumber || '',
    verified: false,
    approved: false,
    verificationStatus: 'not_submitted',
    verification: null
  }

  db.users.drivers.push(newDriver)
  saveData(db)

  res.json({
    success: true,
    message: 'Driver account created.',
    driver: newDriver
  })
})

app.post('/api/driver/verification-submit', (req, res) => {
  const {
    driverId,
    fullName,
    phone,
    email,
    licenseNumber,
    vehicleRegistration,
    insurancePolicy,
    carMake,
    carModel,
    carColor,
    plateNumber,
    selfieImage,
    licenseImage,
    vehicleImage
  } = req.body

  const driver = db.users.drivers.find(d => d.id === driverId)

  if (!driver) {
    return res.status(404).json({
      success: false,
      message: 'Driver not found.'
    })
  }

  if (
    !fullName ||
    !phone ||
    !email ||
    !licenseNumber ||
    !vehicleRegistration ||
    !insurancePolicy
  ) {
    return res.status(400).json({
      success: false,
      message: 'Please complete all required verification fields.'
    })
  }

  driver.name = fullName
  driver.phone = phone
  driver.email = email
  driver.carMake = carMake || driver.carMake
  driver.carModel = carModel || driver.carModel
  driver.carColor = carColor || driver.carColor
  driver.plateNumber = plateNumber || driver.plateNumber

  driver.verified = false
  driver.approved = false
  driver.verificationStatus = 'pending'
  driver.verification = {
    licenseNumber,
    vehicleRegistration,
    insurancePolicy,
    selfieImage: selfieImage || '',
    licenseImage: licenseImage || '',
    vehicleImage: vehicleImage || '',
    submittedAt: new Date().toISOString()
  }

  db.notifications.push({
    id: uid('note'),
    type: 'driver_verification_submitted',
    driverId: driver.id,
    message: `${driver.name} submitted verification for review.`,
    createdAt: new Date().toISOString(),
    read: false
  })

  saveData(db)

  res.json({
    success: true,
    message: 'Verification submitted successfully. Awaiting admin approval.',
    driver
  })
})

app.get('/api/admin/pending-verifications', (req, res) => {
  const pendingDrivers = db.users.drivers.filter(
    d => d.verificationStatus === 'pending'
  )

  res.json({
    success: true,
    count: pendingDrivers.length,
    drivers: pendingDrivers
  })
})

app.get('/api/admin/all-drivers', (req, res) => {
  res.json({
    success: true,
    drivers: db.users.drivers
  })
})

app.post('/api/admin/approve-driver', (req, res) => {
  const { driverId } = req.body
  const driver = db.users.drivers.find(d => d.id === driverId)

  if (!driver) {
    return res.status(404).json({
      success: false,
      message: 'Driver not found.'
    })
  }

  driver.verified = true
  driver.approved = true
  driver.verificationStatus = 'approved'

  const liveDriver = db.driversLive.find(d => d.driverId === driver.id)
  if (!liveDriver) {
    db.driversLive.push({
      driverId: driver.id,
      lat: 36.1627,
      lng: -86.7816,
      isOnline: true,
      updatedAt: new Date().toISOString()
    })
  }

  db.notifications.push({
    id: uid('note'),
    type: 'driver_approved',
    driverId: driver.id,
    message: `${driver.name} was approved and can now accept

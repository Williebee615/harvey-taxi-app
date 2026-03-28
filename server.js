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
    emergencyEvents: [],
    settings: {
      baseFare: 5,
      perMile: 1.75,
      perMinute: 0.35,
      bookingFee: 2.5,
      minimumFare: 8,
      cancellationFee: 5
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
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'))
  } catch (error) {
    console.error('Error reading data file:', error)
    return createDefaultData()
  }
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2))
}

function generateId(prefix) {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 100000)}`
}

function sanitizeUser(user) {
  if (!user) return null
  const copy = { ...user }
  delete copy.password
  return copy
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

  return Number(Math.max(rawFare, settings.minimumFare).toFixed(2))
}

function calculateDriverPayout(totalFare) {
  return Number((totalFare * 0.75).toFixed(2))
}

function calculatePlatformFee(totalFare, driverPayout) {
  return Number((totalFare - driverPayout).toFixed(2))
}

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'))
})

app.get('/health', (req, res) => {
  res.json({ success: true, message: 'Harvey Taxi API running' })
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
      success: true,
      role: 'admin',
      user: sanitizeUser(admin)
    })
  }

  return res.status(401).json({
    success: false,
    message: 'Invalid login credentials.'
  })
})

/* =========================
   DRIVER STATUS / LOCATION
========================= */

app.post('/api/drivers/:driverId/location', (req, res) => {
  const { driverId } = req.params
  const { lat, lng, isOnline } = req.body

  const data = readData()
  const driver = data.drivers.find(d => d.id === driverId)

  if (!driver) {
    return res.status(404).json({
      success: false,
      message: 'Driver not found.'
    })
  }

  if (typeof lat === 'number') driver.currentLat = lat
  if (typeof lng === 'number') driver.currentLng = lng
  if (typeof isOnline === 'boolean') driver.isOnline = isOnline

  saveData(data)

  res.json({
    success: true,
    message: 'Driver location/status updated.',
    driver: sanitizeUser(driver)
  })
})

app.get('/api/drivers/available', (req, res) => {
  const data = readData()

  const drivers = data.drivers.filter(
    driver =>
      driver.isApproved &&
      driver.isOnline &&
      typeof driver.currentLat === 'number' &&
      typeof driver.currentLng === 'number'
  )

  res.json({
    success: true,
    drivers: drivers.map(sanitizeUser)
  })
})

app.get('/api/drivers/:driverId/history', (req, res) => {
  const data = readData()
  const driverId = req.params.driverId

  const trips = data.trips
    .filter(trip => trip.assignedDriverId === driverId)
    .slice()
    .reverse()

  const completedTrips = trips.filter(trip => trip.status === 'completed')
  const totalEarnings = completedTrips.reduce(
    (sum, trip) => sum + Number(trip.driverPayout || 0),
    0
  )

  res.json({
    success: true,
    trips,
    summary: {
      totalTrips: trips.length,
      completedTrips: completedTrips.length,
      totalEarnings: Number(totalEarnings.toFixed(2))
    }
  })
})

/* =========================
   ADMIN
========================= */

app.get('/api/admin/drivers/pending', (req, res) => {
  const data = readData()

  const pendingDrivers = data.drivers.filter(
    driver => !driver.isApproved || driver.verificationStatus === 'pending'
  )

  res.json({
    success: true,
    drivers: pendingDrivers.map(sanitizeUser)
  })
})

app.post('/api/admin/drivers/:driverId/approve', (req, res) => {
  const { driverId } = req.params
  const data = readData()

  const driver = data.drivers.find(d => d.id === driverId)

  if (!driver) {
    return res.status(404).json({
      success: false,
      message: 'Driver not found.'
    })
  }

  driver.isApproved = true
  driver.verificationStatus = 'approved'
  driver.backgroundCheckStatus = 'ready_for_check'

  saveData(data)

  res.json({
    success: true,
    message: 'Driver approved successfully.',
    driver: sanitizeUser(driver)
  })
})

app.post('/api/admin/drivers/:driverId/reject', (req, res) => {
  const { driverId } = req.params
  const { reason } = req.body
  const data = readData()

  const driver = data.drivers.find(d => d.id === driverId)

  if (!driver) {
    return res.status(404).json({
      success: false,
      message: 'Driver not found.'
    })
  }

  driver.isApproved = false
  driver.verificationStatus = 'rejected'
  driver.rejectionReason = reason || 'Not specified'

  saveData(data)

  res.json({
    success: true,
    message: 'Driver rejected.',
    driver: sanitizeUser(driver)
  })
})

/* =========================
   RIDES / DISPATCH
========================= */

app.post('/api/rides/request', (req, res) => {
  const {
    riderId,
    pickupAddress,
    dropoffAddress,
    pickupLat,
    pickupLng,
    dropoffLat,
    dropoffLng,
    serviceType
  } = req.body

  if (
    !riderId ||
    !pickupAddress ||
    !dropoffAddress ||
    typeof pickupLat !== 'number' ||
    typeof pickupLng !== 'number'
  ) {
    return res.status(400).json({
      success: false,
      message: 'Missing ride request details.'
    })
  }

  const data = readData()

  const rider = data.riders.find(r => r.id === riderId)
  if (!rider) {
    return res.status(404).json({
      success: false,
      message: 'Rider not found.'
    })
  }

  const availableDrivers = data.drivers
    .filter(
      driver =>
        driver.isApproved &&
        driver.isOnline &&
        typeof driver.currentLat === 'number' &&
        typeof driver.currentLng === 'number'
    )
    .map(driver => {
      const distanceAway = getDistanceMiles(
        pickupLat,
        pickupLng,
        driver.currentLat,
        driver.currentLng
      )

      return { ...driver, distanceAway }
    })
    .sort((a, b) => a.distanceAway - b.distanceAway)

  const assignedDriver = availableDrivers.length ? availableDrivers[0] : null

  const estimatedDistance =
    typeof dropoffLat === 'number' && typeof dropoffLng === 'number'
      ? getDistanceMiles(pickupLat, pickupLng, dropoffLat, dropoffLng)
      : 5

  const estimatedDuration = Math.max(Math.round(estimatedDistance * 3), 10)
  const estimatedFare = estimateFare(
    estimatedDistance,
    estimatedDuration,
    data.settings
  )
  const driverPayout = assignedDriver ? calculateDriverPayout(estimatedFare) : 0
  const platformFee = assignedDriver
    ? calculatePlatformFee(estimatedFare, driverPayout)
    : 0

  const rideRequest = {
    id: generateId('ride'),
    riderId,
    riderName: rider.fullName,
    pickupAddress,
    dropoffAddress,
    pickupLat,
    pickupLng,
    dropoffLat: typeof dropoffLat === 'number' ? dropoffLat : null,
    dropoffLng: typeof dropoffLng === 'number' ? dropoffLng : null,
    serviceType: serviceType || 'ride',
    status: assignedDriver ? 'driver_assigned' : 'searching',
    assignedDriverId: assignedDriver ? assignedDriver.id : null,
    assignedDriverName: assignedDriver ? assignedDriver.fullName : null,
    assignedVehicle:

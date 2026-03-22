const express = require('express')
const cors = require('cors')
const path = require('path')
const fs = require('fs')

const app = express()
const PORT = process.env.PORT || 10000

app.use(cors())
app.use(express.json())
app.use(express.static(path.join(__dirname, 'public')))

// --------------------
// SIMPLE DATA STORAGE
// --------------------
const DATA_DIR = path.join(__dirname, 'data')
const RIDES_FILE = path.join(DATA_DIR, 'rides.json')
const DRIVERS_FILE = path.join(DATA_DIR, 'drivers.json')

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR)
}

if (!fs.existsSync(RIDES_FILE)) {
  fs.writeFileSync(RIDES_FILE, JSON.stringify([]))
}

if (!fs.existsSync(DRIVERS_FILE)) {
  fs.writeFileSync(DRIVERS_FILE, JSON.stringify([]))
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch (error) {
    return []
  }
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2))
}

let rides = readJson(RIDES_FILE)
let drivers = readJson(DRIVERS_FILE)

// --------------------
// HARVEY TAXI SETTINGS
// --------------------
const fareSettings = {
  baseFare: 3.5,
  perMile: 1.85,
  perMinute: 0.32,
  minimumFare: 8,
  bookingFee: 2.25,
  serviceFeeRate: 0.08, // 8%
  cancelFee: 5,
  driverPayoutRate: 0.8 // driver gets 80% of trip subtotal before booking/service platform fees
}

// --------------------
// HELPERS
// --------------------
function generateId(prefix = 'id') {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 100000)}`
}

function toMoney(value) {
  return Number(Number(value).toFixed(2))
}

function getDistanceMiles(lat1, lng1, lat2, lng2) {
  const R = 3958.8
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLng = ((lng2 - lng1) * Math.PI) / 180

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2)

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

function calculateDemandMultiplier() {
  const activeRideRequests = rides.filter(
    (ride) =>
      ride.status === 'requested' ||
      ride.status === 'accepted' ||
      ride.status === 'arriving' ||
      ride.status === 'in_progress'
  ).length

  const onlineDrivers = drivers.filter(
    (driver) => driver.isOnline && driver.isApproved
  ).length

  if (onlineDrivers === 0 && activeRideRequests > 0) return 2.2
  if (activeRideRequests <= 3) return 1
  if (activeRideRequests > onlineDrivers * 2) return 2
  if (activeRideRequests > onlineDrivers) return 1.5
  if (activeRideRequests > 6) return 1.3

  return 1
}

function calculateFare({ distanceMiles, durationMinutes, surgeMultiplier = 1 }) {
  const rawBase = fareSettings.baseFare
  const rawDistance = distanceMiles * fareSettings.perMile
  const rawTime = durationMinutes * fareSettings.perMinute

  const subtotalBeforeSurge = rawBase + rawDistance + rawTime
  const surgedSubtotal = subtotalBeforeSurge * surgeMultiplier
  const serviceFee = surgedSubtotal * fareSettings.serviceFeeRate
  let total = surgedSubtotal + fareSettings.bookingFee + serviceFee

  if (total < fareSettings.minimumFare) {
    total = fareSettings.minimumFare
  }

  const driverPayout = Math.max(
    fareSettings.minimumFare * 0.55,
    surgedSubtotal * fareSettings.driverPayoutRate
  )

  return {
    baseFare: toMoney(rawBase),
    distanceFare: toMoney(rawDistance),
    timeFare: toMoney(rawTime),
    subtotalBeforeSurge: toMoney(subtotalBeforeSurge),
    surgeMultiplier: toMoney(surgeMultiplier),
    surgedSubtotal: toMoney(surgedSubtotal),
    bookingFee: toMoney(fareSettings.bookingFee),
    serviceFee: toMoney(serviceFee),
    minimumFare: toMoney(fareSettings.minimumFare),
    totalFare: toMoney(total),
    driverPayout: toMoney(driverPayout),
    platformRevenue: toMoney(total - driverPayout)
  }
}

function estimateDurationMinutes(distanceMiles) {
  const averageCitySpeedMph = 22
  const hours = distanceMiles / averageCitySpeedMph
  const minutes = hours * 60
  return Math.max(4, Math.round(minutes))
}

function findNearestDriver(pickupLat, pickupLng) {
  const onlineApprovedDrivers = drivers
    .filter((driver) => driver.isOnline && driver.isApproved && driver.lat && driver.lng)
    .map((driver) => {
      const distanceAway = getDistanceMiles(
        pickupLat,
        pickupLng,
        Number(driver.lat),
        Number(driver.lng)
      )

      return {
        ...driver,
        distanceAway
      }
    })
    .sort((a, b) => a.distanceAway - b.distanceAway)

  return onlineApprovedDrivers[0] || null
}

// --------------------
// ROUTES
// --------------------

// Root
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'))
})

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    app: 'Harvey Taxi API',
    status: 'running'
  })
})

// Get fare settings
app.get('/api/fare/settings', (req, res) => {
  res.json({
    success: true,
    settings: fareSettings
  })
})

// Estimate fare by coordinates
app.post('/api/fare/estimate', (req, res) => {
  try {
    const {
      pickupLat,
      pickupLng,
      dropoffLat,
      dropoffLng
    } = req.body

    if (
      pickupLat === undefined ||
      pickupLng === undefined ||
      dropoffLat === undefined ||
      dropoffLng === undefined
    ) {
      return res.status(400).json({
        success: false,
        message: 'Pickup and dropoff coordinates are required.'
      })
    }

    const distanceMiles = getDistanceMiles(
      Number(pickupLat),
      Number(pickupLng),
      Number(dropoffLat),
      Number(dropoffLng)
    )

    const durationMinutes = estimateDurationMinutes(distanceMiles)
    const surgeMultiplier = calculateDemandMultiplier()

    const fare = calculateFare({
      distanceMiles,
      durationMinutes,
      surgeMultiplier
    })

    return res.json({
      success: true,
      trip: {
        distanceMiles: toMoney(distanceMiles),
        durationMinutes
      },
      fare
    })
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to calculate fare.',
      error: error.message
    })
  }
})

// Register driver
app.post('/api/drivers/register', (req, res) => {
  try {
    const { name, email, phone, vehicleType, vehicleMake, vehicleModel, plate } = req.body

    if (!name || !email) {
      return res.status(400).json({
        success: false,
        message: 'Name and email are required.'
      })
    }

    const newDriver = {
      id: generateId('driver'),
      name,
      email,
      phone: phone || '',
      vehicleType: vehicleType || 'Standard',
      vehicleMake: vehicleMake || '',
      vehicleModel: vehicleModel || '',
      plate: plate || '',
      isApproved: false,
      isOnline: false,
      lat: null,
      lng: null,
      createdAt: new Date().toISOString()
    }

    drivers.push(newDriver)
    writeJson(DRIVERS_FILE, drivers)

    return res.json({
      success: true,
      message: 'Driver registered successfully.',
      driver: newDriver
    })
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to register driver.',
      error: error.message
    })
  }
})

// Update driver status/location
app.post('/api/drivers/update-status', (req, res) => {
  try {
    const { driverId, isOnline, lat, lng, isApproved } = req.body

    const driver = drivers.find((d) => d.id === driverId)

    if (!driver) {
      return res.status(404).json({
        success: false,
        message: 'Driver not found.'
      })
    }

    if (typeof isOnline === 'boolean') driver.isOnline = isOnline
    if (typeof isApproved === 'boolean') driver.isApproved = isApproved
    if (lat !== undefined) driver.lat = Number(lat)
    if (lng !== undefined) driver.lng = Number(lng)

    driver.updatedAt = new Date().toISOString()
    writeJson(DRIVERS_FILE, drivers)

    return res.json({
      success: true,
      message: 'Driver updated successfully.',
      driver
    })
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to update driver.',
      error: error.message
    })
  }
})

// Request a ride with fare engine
app.post('/api/rides/request', (req, res) => {
  try {
    const {
      riderName,
      riderPhone,
      pickupAddress,
      dropoffAddress,
      pickupLat,
      pickupLng,
      dropoffLat,
      dropoffLng,
      serviceType
    } = req.body

    if (
      !pickupAddress ||
      !dropoffAddress ||
      pickupLat === undefined ||
      pickupLng === undefined ||
      dropoffLat === undefined ||
      dropoffLng === undefined
    ) {
      return res.status(400).json({
        success: false,
        message: 'Pickup/dropoff addresses and coordinates are required.'
      })
    }

    const distanceMiles = getDistanceMiles(
      Number(pickupLat),
      Number(pickupLng),
      Number(dropoffLat),
      Number(dropoffLng)
    )

    const durationMinutes = estimateDurationMinutes(distanceMiles)
    const surgeMultiplier = calculateDemandMultiplier()

    const fare = calculateFare({
      distanceMiles,
      durationMinutes,
      surgeMultiplier
    })

    const nearestDriver = findNearestDriver(Number(pickupLat), Number(pickupLng))

    const newRide = {
      id: generateId('ride'),
      riderName: riderName || 'Guest Rider',
      riderPhone: riderPhone || '',
      pickupAddress,
      dropoffAddress,
      pickupLat: Number(pickupLat),
      pickupLng: Number(pickupLng),
      dropoffLat: Number(dropoffLat),
      dropoffLng: Number(dropoffLng),
      serviceType: serviceType || 'Ride',
      status: nearestDriver ? 'accepted' : 'requested',
      assignedDriverId: nearestDriver ? nearestDriver.id : null,
      assignedDriverName: nearestDriver ? nearestDriver.name : null,
      assignedVehicle: nearestDriver
        ? `${nearestDriver.vehicleMake} ${nearestDriver.vehicleModel}`.trim()
        : null,
      driverDistanceAway: nearestDriver ? toMoney(nearestDriver.distanceAway) : null,
      trip: {
        distanceMiles: toMoney(distanceMiles),
        durationMinutes
      },
      fare,
      createdAt: new Date().toISOString()
    }

    rides.push(newRide)
    writeJson(RIDES_FILE, rides)

    return res.json({
      success: true,
      message: nearestDriver
        ? 'Ride requested and matched with nearest driver.'
        : 'Ride requested. Waiting for a driver.',
      ride: newRide
    })
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to request ride.',
      error: error.message
    })
  }
})

// Get all rides
app.get('/api/rides', (req, res) => {
  res.json({
    success: true,
    rides
  })
})

// Get all drivers
app.get('/api/drivers', (req, res) => {
  res.json({
    success: true,
    drivers
  })
})

// Admin fare update
app.post('/api/admin/fare-settings', (req, res) => {
  try {
    const {
      baseFare,
      perMile,
      perMinute,
      minimumFare,
      bookingFee,
      serviceFeeRate,
      cancelFee,
      driverPayoutRate
    } = req.body

    if (baseFare !== undefined) fareSettings.baseFare = Number(baseFare)
    if (perMile !== undefined) fareSettings.perMile = Number(perMile)
    if (perMinute !== undefined) fareSettings.perMinute = Number(perMinute)
    if (minimumFare !== undefined) fareSettings.minimumFare = Number(minimumFare)
    if (bookingFee !== undefined) fareSettings.bookingFee = Number(bookingFee)
    if (serviceFeeRate !== undefined) fareSettings.serviceFeeRate = Number(serviceFeeRate)
    if (cancelFee !== undefined) fareSettings.cancelFee = Number(cancelFee)
    if (driverPayoutRate !== undefined) fareSettings.driverPayoutRate = Number(driverPayoutRate)

    return res.json({
      success: true,
      message: 'Fare settings updated.',
      settings: fareSettings
    })
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to update fare settings.',
      error: error.message
    })
  }
})

// Fallback for direct page access
app.get('/:page', (req, res) => {
  const filePath = path.join(__dirname, 'public', req.params.page)

  if (fs.existsSync(filePath)) {
    res.sendFile(filePath)
  } else {
    res.sendFile(path.join(__dirname, 'public', 'index.html'))
  }
})

app.listen(PORT, () => {
  console.log(`Harvey Taxi server running on port ${PORT}`)
})

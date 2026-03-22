const express = require('express')
const cors = require('cors')
const path = require('path')
const fs = require('fs')

const app = express()
const PORT = process.env.PORT || 10000

app.use(cors())
app.use(express.json())

// serve public folder
app.use(express.static(path.join(__dirname, 'public')))

// --------------------
// SIMPLE DATA STORAGE
// --------------------
const DATA_DIR = path.join(__dirname, 'data')
const RIDES_FILE = path.join(DATA_DIR, 'rides.json')
const DRIVERS_FILE = path.join(DATA_DIR, 'drivers.json')

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true })
}

if (!fs.existsSync(RIDES_FILE)) {
  fs.writeFileSync(RIDES_FILE, JSON.stringify([], null, 2))
}

if (!fs.existsSync(DRIVERS_FILE)) {
  fs.writeFileSync(DRIVERS_FILE, JSON.stringify([], null, 2))
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
  serviceFeeRate: 0.08,
  cancelFee: 5,
  driverPayoutRate: 0.8
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

function calculateDemandMultiplier() {
  const activeRideRequests = rides.filter((ride) => {
    return (
      ride.status === 'requested' ||
      ride.status === 'accepted' ||
      ride.status === 'arriving' ||
      ride.status === 'in_progress'
    )
  }).length

  const onlineDrivers = drivers.filter((driver) => {
    return driver.isOnline && driver.isApproved
  }).length

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

// address-only temporary trip estimate
function getAddressEstimate(pickupAddress, dropoffAddress) {
  const pickup = String(pickupAddress || '').trim().toLowerCase()
  const dropoff = String(dropoffAddress || '').trim().toLowerCase()

  if (!pickup || !dropoff) {
    return {
      distanceMiles: 0,
      durationMinutes: 0
    }
  }

  if (pickup === dropoff) {
    return {
      distanceMiles: 2,
      durationMinutes: 8
    }
  }

  const combinedLength = pickup.length + dropoff.length
  const distanceMiles = Math.max(3, Math.min(18, Math.round(combinedLength / 6)))
  const durationMinutes = Math.max(8, Math.round(distanceMiles * 2.6))

  return {
    distanceMiles,
    durationMinutes
  }
}

// --------------------
// ROUTES
// --------------------

// root
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'))
})

// health
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    app: 'Harvey Taxi API',
    status: 'running'
  })
})

// fare settings
app.get('/api/fare/settings', (req, res) => {
  res.json({
    success: true,
    settings: fareSettings
  })
})

// fare estimate using addresses only
app.post('/api/fare/estimate', (req, res) => {
  try {
    const { pickupAddress, dropoffAddress } = req.body

    if (!pickupAddress || !dropoffAddress) {
      return res.status(400).json({
        success: false,
        message: 'Pickup and dropoff addresses are required.'
      })
    }

    const tripEstimate = getAddressEstimate(pickupAddress, dropoffAddress)
    const surgeMultiplier = calculateDemandMultiplier()

    const fare = calculateFare({
      distanceMiles: tripEstimate.distanceMiles,
      durationMinutes: tripEstimate.durationMinutes,
      surgeMultiplier
    })

    return res.json({
      success: true,
      trip: {
        pickupAddress,
        dropoffAddress,
        distanceMiles: toMoney(tripEstimate.distanceMiles),
        durationMinutes: tripEstimate.durationMinutes
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

// register driver
app.post('/api/drivers/register', (req, res) => {
  try {
    const {
      name,
      email,
      phone,
      vehicleType,
      vehicleMake,
      vehicleModel,
      plate
    } = req.body

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

// update driver status
app.post('/api/drivers/update-status', (req, res) => {
  try {
    const { driverId, isOnline, isApproved } = req.body

    const driver = drivers.find((d) => d.id === driverId)

    if (!driver) {
      return res.status(404).json({
        success: false,
        message: 'Driver not found.'
      })
    }

    if (typeof isOnline === 'boolean') driver.isOnline = isOnline
    if (typeof isApproved === 'boolean') driver.isApproved = isApproved

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

// request ride using addresses only
app.post('/api/rides/request', (req, res) => {
  try {
    const {
      riderName,
      riderPhone,
      pickupAddress,
      dropoffAddress,
      serviceType
    } = req.body

    if (!pickupAddress || !dropoffAddress) {
      return res.status(400).json({
        success: false,
        message: 'Pickup and dropoff addresses are required.'
      })
    }

    const tripEstimate = getAddressEstimate(pickupAddress, dropoffAddress)
    const surgeMultiplier = calculateDemandMultiplier()

    const fare = calculateFare({
      distanceMiles: tripEstimate.distanceMiles,
      durationMinutes: tripEstimate.durationMinutes,
      surgeMultiplier
    })

    const availableDriver = drivers.find((driver) => {
      return driver.isApproved && driver.isOnline
    })

    const newRide = {
      id: generateId('ride'),
      riderName: riderName || 'Guest Rider',
      riderPhone: riderPhone || '',
      pickupAddress,
      dropoffAddress,
      serviceType: serviceType || 'Ride',
      status: availableDriver ? 'accepted' : 'requested',
      assignedDriverId: availableDriver ? availableDriver.id : null,
      assignedDriverName: availableDriver ? availableDriver.name : null,
      assignedVehicle: availableDriver
        ? `${availableDriver.vehicleMake} ${availableDriver.vehicleModel}`.trim()
        : null,
      trip: {
        distanceMiles: toMoney(tripEstimate.distanceMiles),
        durationMinutes: tripEstimate.durationMinutes
      },
      fare,
      createdAt: new Date().toISOString()
    }

    rides.push(newRide)
    writeJson(RIDES_FILE, rides)

    return res.json({
      success: true,
      message: availableDriver
        ? 'Ride requested and matched with a driver.'
        : 'Ride requested successfully.',
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

// get all rides
app.get('/api/rides', (req, res) => {
  rides = readJson(RIDES_FILE)

  res.json({
    success: true,
    rides
  })
})

// get all drivers
app.get('/api/drivers', (req, res) => {
  drivers = readJson(DRIVERS_FILE)

  res.json({
    success: true,
    drivers
  })
})

// update fare settings
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

// direct page access fallback
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

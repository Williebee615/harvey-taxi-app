const express = require('express')
const cors = require('cors')
const path = require('path')
const fs = require('fs')

const app = express()
const PORT = process.env.PORT || 10000
const DATA_FILE = path.join(__dirname, 'data.json')

app.use(cors())
app.use(express.json())
app.use(express.static(path.join(__dirname, 'public')))

function loadData() {
  if (!fs.existsSync(DATA_FILE)) {
    const starterData = {
      drivers: [],
      rides: [],
      admins: [
        {
          id: 'admin_1',
          name: 'Harvey Admin',
          email: 'admin@harveytaxi.com',
          password: 'admin123'
        }
      ]
    }
    fs.writeFileSync(DATA_FILE, JSON.stringify(starterData, null, 2))
    return starterData
  }

  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'))
  } catch (error) {
    console.error('Failed to read data.json:', error)
    return { drivers: [], rides: [], admins: [] }
  }
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2))
}

function createId(prefix) {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 100000)}`
}

function toRadians(value) {
  return value * (Math.PI / 180)
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

function estimateFareMiles(distanceMiles, serviceType) {
  const safeDistance = Number.isFinite(distanceMiles) ? distanceMiles : 5

  let baseFare = 5
  let perMile = 2.25

  if (serviceType === 'XL Ride') {
    baseFare = 8
    perMile = 3.25
  }

  if (serviceType === 'Airport Ride') {
    baseFare = 10
    perMile = 3.5
  }

  const total = baseFare + safeDistance * perMile
  return Number(total.toFixed(2))
}

function findNearestAvailableDriver(drivers, pickupLat, pickupLng) {
  const availableDrivers = drivers.filter(
    (driver) =>
      driver.isOnline === true &&
      driver.isApproved !== false &&
      driver.currentRideId == null &&
      typeof driver.lat === 'number' &&
      typeof driver.lng === 'number'
  )

  if (availableDrivers.length === 0) return null

  let nearestDriver = null
  let shortestDistance = Infinity

  for (const driver of availableDrivers) {
    const distance = getDistanceMiles(driver.lat, driver.lng, pickupLat, pickupLng)
    if (distance < shortestDistance) {
      shortestDistance = distance
      nearestDriver = { ...driver, distanceMiles: Number(distance.toFixed(2)) }
    }
  }

  return nearestDriver
}

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'))
})

app.get('/:page', (req, res) => {
  const requested = req.params.page
  const filePath = path.join(__dirname, 'public', requested)

  if (fs.existsSync(filePath)) {
    res.sendFile(filePath)
  } else {
    res.sendFile(path.join(__dirname, 'public', 'index.html'))
  }
})

app.post('/api/drivers/register', (req, res) => {
  const data = loadData()
  const {
    name,
    phone,
    vehicle,
    email,
    lat = 36.1627,
    lng = -86.7816
  } = req.body

  if (!name || !phone) {
    return res.status(400).json({ error: 'Name and phone are required.' })
  }

  const driver = {
    id: createId('driver'),
    name,
    phone,
    vehicle: vehicle || '',
    email: email || '',
    lat: Number(lat),
    lng: Number(lng),
    isOnline: false,
    isApproved: true,
    currentRideId: null,
    createdAt: new Date().toISOString()
  }

  data.drivers.push(driver)
  saveData(data)

  res.json({
    message: 'Driver registered successfully.',
    driver
  })
})

app.post('/api/drivers/go-online', (req, res) => {
  const data = loadData()
  const { driverId, lat, lng } = req.body

  const driver = data.drivers.find((item) => item.id === driverId)
  if (!driver) {
    return res.status(404).json({ error: 'Driver not found.' })
  }

  driver.isOnline = true
  if (lat !== undefined) driver.lat = Number(lat)
  if (lng !== undefined) driver.lng = Number(lng)

  saveData(data)

  res.json({
    message: 'Driver is now online.',
    driver
  })
})

app.post('/api/drivers/go-offline', (req, res) => {
  const data = loadData()
  const { driverId } = req.body

  const driver = data.drivers.find((item) => item.id === driverId)
  if (!driver) {
    return res.status(404).json({ error: 'Driver not found.' })
  }

  driver.isOnline = false
  saveData(data)

  res.json({
    message: 'Driver is now offline.',
    driver
  })
})

app.post('/api/drivers/update-location', (req, res) => {
  const data = loadData()
  const { driverId, lat, lng } = req.body

  const driver = data.drivers.find((item) => item.id === driverId)
  if (!driver) {
    return res.status(404).json({ error: 'Driver not found.' })
  }

  driver.lat = Number(lat)
  driver.lng = Number(lng)
  saveData(data)

  res.json({
    message: 'Driver location updated.',
    driver
  })
})

app.get('/api/drivers', (req, res) => {
  const data = loadData()
  res.json(data.drivers)
})

app.post('/api/rides/request', (req, res) => {
  const data = loadData()
  const {
    riderName,
    riderPhone,
    pickupAddress,
    dropoffAddress,
    pickupLat = 36.1627,
    pickupLng = -86.7816,
    dropoffLat = 36.1263,
    dropoffLng = -86.6774,
    serviceType = 'Standard Ride'
  } = req.body

  if (!riderName || !pickupAddress || !dropoffAddress) {
    return res.status(400).json({
      error: 'Rider name, pickup address, and dropoff address are required.'
    })
  }

  const distanceMiles = getDistanceMiles(
    Number(pickupLat),
    Number(pickupLng),
    Number(dropoffLat),
    Number(dropoffLng)
  )

  const estimatedFare = estimateFareMiles(distanceMiles, serviceType)
  const nearestDriver = findNearestAvailableDriver(
    data.drivers,
    Number(pickupLat),
    Number(pickupLng)
  )

  const ride = {
    id: createId('ride'),
    riderName,
    riderPhone: riderPhone || '',
    pickupAddress,
    dropoffAddress,
    pickupLat: Number(pickupLat),
    pickupLng: Number(pickupLng),
    dropoffLat: Number(dropoffLat),
    dropoffLng: Number(dropoffLng),
    serviceType,
    estimatedFare,
    distanceMiles: Number(distanceMiles.toFixed(2)),
    status: nearestDriver ? 'driver_assigned' : 'pending',
    assignedDriverId: nearestDriver ? nearestDriver.id : null,
    assignedDriverName: nearestDriver ? nearestDriver.name : null,
    assignedDriverPhone: nearestDriver ? nearestDriver.phone : null,
    assignedDriverVehicle: nearestDriver ? nearestDriver.vehicle : null,
    assignedDistanceMiles: nearestDriver ? nearestDriver.distanceMiles : null,
    createdAt: new Date().toISOString(),
    acceptedAt: null,
    completedAt: null
  }

  if (nearestDriver) {
    const realDriver = data.drivers.find((item) => item.id === nearestDriver.id)
    if (realDriver) {
      realDriver.currentRideId = ride.id
    }
  }

  data.rides.unshift(ride)
  saveData(data)

  res.json({
    message: nearestDriver
      ? 'Ride requested and driver assigned.'
      : 'Ride requested. Waiting for available driver.',
    ride
  })
})

app.get('/api/rides', (req, res) => {
  const data = loadData()
  res.json(data.rides)
})

app.get('/api/rides/:rideId', (req, res) => {
  const data = loadData()
  const ride = data.rides.find((item) => item.id === req.params.rideId)

  if (!ride) {
    return res.status(404).json({ error: 'Ride not found.' })
  }

  res.json(ride)
})

app.get('/api/drivers/:driverId/rides', (req, res) => {
  const data = loadData()
  const rides = data.rides.filter(
    (ride) =>
      ride.assignedDriverId === req.params.driverId &&
      ['driver_assigned', 'accepted'].includes(ride.status)
  )

  res.json(rides)
})

app.post('/api/rides/:rideId/accept', (req, res) => {
  const data = loadData()
  const { driverId } = req.body

  const ride = data.rides.find((item) => item.id === req.params.rideId)
  if (!ride) {
    return res.status(404).json({ error: 'Ride not found.' })
  }

  if (ride.assignedDriverId !== driverId) {
    return res.status(400).json({ error: 'This ride is not assigned to that driver.' })
  }

  ride.status = 'accepted'
  ride.acceptedAt = new Date().toISOString()
  saveData(data)

  res.json({
    message: 'Ride accepted.',
    ride
  })
})

app.post('/api/rides/:rideId/complete', (req, res) => {
  const data = loadData()
  const { driverId } = req.body

  const ride = data.rides.find((item) => item.id === req.params.rideId)
  if (!ride) {
    return res.status(404).json({ error: 'Ride not found.' })
  }

  if (ride.assignedDriverId !== driverId) {
    return res.status(400).json({ error: 'This ride is not assigned to that driver.' })
  }

  ride.status = 'completed'
  ride.completedAt = new Date().toISOString()

  const driver = data.drivers.find((item) => item.id === driverId)
  if (driver) {
    driver.currentRideId = null
  }

  saveData(data)

  res.json({
    message: 'Ride completed.',
    ride
  })
})

app.post('/api/rides/:rideId/reassign', (req, res) => {
  const data = loadData()
  const ride = data.rides.find((item) => item.id === req.params.rideId)

  if (!ride) {
    return res.status(404).json({ error: 'Ride not found.' })
  }

  const oldDriver = data.drivers.find((item) => item.id === ride.assignedDriverId)
  if (oldDriver) {
    oldDriver.currentRideId = null
  }

  const nearestDriver = findNearestAvailableDriver(
    data.drivers,
    ride.pickupLat,
    ride.pickupLng
  )

  if (!nearestDriver) {
    ride.status = 'pending'
    ride.assignedDriverId = null
    ride.assignedDriverName = null
    ride.assignedDriverPhone = null
    ride

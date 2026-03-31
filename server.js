const express = require('express')
const cors = require('cors')
const path = require('path')
const fs = require('fs')

const app = express()
const PORT = process.env.PORT || 10000

app.use(cors())
app.use(express.json())
app.use(express.static(path.join(__dirname, 'public')))

const DATA_FILE = path.join(__dirname, 'data.json')

const ADMIN_EMAIL = 'admin@harveytaxi.com'
const ADMIN_PASSWORD = 'HarveyAdmin123'

const FARE_CONFIG = {
  baseFare: 3.5,
  perMile: 2.35,
  bookingFee: 1.5,
  minimumFare: 8.0
}

function ensureDataFile() {
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(
      DATA_FILE,
      JSON.stringify(
        {
          rides: [],
          drivers: [],
          riders: []
        },
        null,
        2
      )
    )
  }
}

function readData() {
  ensureDataFile()
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'))
}

function writeData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2))
}

function toRad(d) {
  return d * Math.PI / 180
}

function distanceMiles(lat1, lon1, lat2, lon2) {
  const R = 3958.8
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) ** 2

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

function canAutoDispatchDriver(driver) {
  return (
    driver &&
    (driver.approved === true || driver.status === 'approved') &&
    driver.online === true &&
    !driver.currentRide &&
    driver.location &&
    typeof driver.location.lat === 'number' &&
    typeof driver.location.lng === 'number'
  )
}

function getSurgeMultiplier(data) {
  const activeTrips = data.rides.filter((ride) =>
    ride.status === 'requested' ||
    ride.status === 'assigned' ||
    ride.status === 'enroute' ||
    ride.status === 'in_progress'
  ).length

  if (activeTrips >= 5) return 1.5
  if (activeTrips >= 3) return 1.25
  return 1.0
}

function calculateFare(distance, surgeMultiplier = 1) {
  const rawSubtotal = FARE_CONFIG.baseFare + distance * FARE_CONFIG.perMile
  const minimumAdjustedSubtotal = Math.max(rawSubtotal, FARE_CONFIG.minimumFare)
  const surgedSubtotal = minimumAdjustedSubtotal * surgeMultiplier
  const total = surgedSubtotal + FARE_CONFIG.bookingFee

  return {
    baseFare: Number(FARE_CONFIG.baseFare.toFixed(2)),
    perMile: Number(FARE_CONFIG.perMile.toFixed(2)),
    distanceMiles: Number(distance.toFixed(2)),
    subtotalBeforeSurge: Number(minimumAdjustedSubtotal.toFixed(2)),
    surgeMultiplier: Number(surgeMultiplier.toFixed(2)),
    surgeAmount: Number((surgedSubtotal - minimumAdjustedSubtotal).toFixed(2)),
    subtotal: Number(surgedSubtotal.toFixed(2)),
    bookingFee: Number(FARE_CONFIG.bookingFee.toFixed(2)),
    total: Number(total.toFixed(2)),
    minimumFareApplied: rawSubtotal < FARE_CONFIG.minimumFare
  }
}

async function geocodeAddress(address) {
  if (!address || !address.trim()) return null

  const query = new URLSearchParams({
    q: address.trim(),
    format: 'jsonv2',
    limit: '1',
    addressdetails: '1'
  }).toString()

  const response = await fetch(`https://nominatim.openstreetmap.org/search?${query}`, {
    headers: {
      'User-Agent': 'HarveyTaxi/1.0 (williebee@harveytaxiservice.com)',
      'Accept-Language': 'en-US,en;q=0.9'
    }
  })

  if (!response.ok) {
    throw new Error(`Geocoding failed with status ${response.status}`)
  }

  const results = await response.json()

  if (!Array.isArray(results) || results.length === 0) {
    return null
  }

  const first = results[0]

  return {
    lat: Number(first.lat),
    lng: Number(first.lon),
    displayName: first.display_name || address.trim()
  }
}

function findNearestDriver(drivers, pickupCoords) {
  let nearestDriver = null
  let nearestDistance = Infinity

  drivers.forEach((driver) => {
    if (!canAutoDispatchDriver(driver)) return

    const distance = distanceMiles(
      pickupCoords.lat,
      pickupCoords.lng,
      Number(driver.location.lat),
      Number(driver.location.lng)
    )

    if (distance < nearestDistance) {
      nearestDistance = distance
      nearestDriver = driver
    }
  })

  return {
    driver: nearestDriver,
    distanceMiles: nearestDistance === Infinity ? null : nearestDistance
  }
}

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'))
})

/* =========================
   ADMIN LOGIN
========================= */
app.post('/api/admin-login', (req, res) => {
  const { email, password } = req.body || {}

  if (email === ADMIN_EMAIL && password === ADMIN_PASSWORD) {
    return res.json({
      success: true,
      token: 'admin-token'
    })
  }

  return res.status(401).json({
    success: false,
    message: 'Invalid login'
  })
})

/* =========================
   DRIVER LOCATION
========================= */
app.post('/api/driver-location', (req, res) => {
  const { driverId, lat, lng } = req.body || {}
  const data = readData()

  const driver = data.drivers.find((d) => String(d.id) === String(driverId))

  if (!driver) {
    return res.status(404).json({
      success: false,
      message: 'Driver not found'
    })
  }

  driver.location = {
    lat: Number(lat),
    lng: Number(lng),
    updatedAt: new Date().toISOString()
  }

  driver.online = true
  writeData(data)

  return res.json({
    success: true,
    location: driver.location
  })
})

app.get('/api/driver-location/:id', (req, res) => {
  const data = readData()
  const driver = data.drivers.find((d) => String(d.id) === String(req.params.id))

  if (!driver || !driver.location) {
    return res.json({
      success: false,
      location: null
    })
  }

  return res.json({
    success: true,
    location: driver.location
  })
})

/* =========================
   DRIVER SIGNUP
========================= */
app.post('/api/driver-signup', (req, res) => {
  const data = readData()

  const driver = {
    id: Date.now().toString(),
    name: req.body.name || '',
    email: req.body.email || '',
    phone: req.body.phone || '',
    vehicle: req.body.vehicle || '',
    city: req.body.city || '',
    license: req.body.license || '',
    approved: true,
    status: 'approved',
    online: false,
    location: null,
    currentRide: null,
    createdAt: new Date().toISOString()
  }

  data.drivers.push(driver)
  writeData(data)

  return res.json({
    success: true,
    driver
  })
})

/* =========================
   RIDER SIGNUP
========================= */
app.post('/api/rider-signup', (req, res) => {
  const data = readData()

  const rider = {
    id: Date.now().toString(),
    name: req.body.name || '',
    email: req.body.email || '',
    phone: req.body.phone || '',
    createdAt: new Date().toISOString()
  }

  data.riders.push(rider)
  writeData(data)

  return res.json({
    success: true,
    rider
  })
})

/* =========================
   REQUEST RIDE
========================= */
app.post('/api/request-ride', async (req, res) => {
  try {
    const data = readData()

    const pickupInput = req.body.pickup || ''
    const dropoffInput = req.body.dropoff || ''

    const pickupGeo = await geocodeAddress(pickupInput)
    const dropoffGeo = await geocodeAddress(dropoffInput)

    let tripDistance = 0
    if (pickupGeo && dropoffGeo) {
      tripDistance = distanceMiles(
        pickupGeo.lat,
        pickupGeo.lng,
        dropoffGeo.lat,
        dropoffGeo.lng
      )
    }

    const surgeMultiplier = getSurgeMultiplier(data)
    const fare = calculateFare(tripDistance, surgeMultiplier)

    const ride = {
      id: Date.now().toString(),
      pickup: pickupInput,
      dropoff: dropoffInput,
      pickupGeo,
      dropoffGeo,
      rider: req.body.rider || req.body.name || '',
      name: req.body.name || '',
      phone: req.body.phone || '',
      status: 'requested',
      driverId: null,
      assignedDriverName: '',
      autoAssigned: false,
      autoAssignedDistanceMiles: null,
      fare,
      created: new Date().toISOString(),
      acceptedAt: '',
      startedAt: '',
      completedAt: ''
    }

    if (pickupGeo) {
      const result = findNearestDriver(data.drivers, pickupGeo)

      if (result.driver) {
        ride.driverId = result.driver.id
        ride.assignedDriverName = result.driver.name || 'Driver'
        ride.status = 'assigned'
        ride.autoAssigned = true
        ride.autoAssignedDistanceMiles = Number(result.distanceMiles.toFixed(2))

        const matchedDriver = data.drivers.find(
          (d) => String(d.id) === String(result.driver.id)
        )

        if (matchedDriver) {
          matchedDriver.currentRide = ride.id
          matchedDriver.online = false
        }
      }
    }

    data.rides.push(ride)
    writeData(data)

    return res.json({
      success: true,
      ride,
      autoDispatch: {
        matched: !!ride.driverId,
        driverId: ride.driverId,
        driverName: ride.assignedDriverName || null,
        distanceMiles: ride.autoAssignedDistanceMiles
      }
    })
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: 'Could not request ride',
      error: err.message
    })
  }
})

/* =========================
   GET LISTS
========================= */
app.get('/api/rides', (req, res) => {
  const data = readData()
  return res.json(data.rides)
})

app.get('/api/drivers', (req, res) => {
  const data = readData()
  return res.json(data.drivers)
})

app.get('/api/riders', (req, res) => {
  const data = readData()
  return res.json(data.riders)
})

/* =========================
   DRIVER ADMIN ACTIONS
========================= */
app.post('/api/approve-driver', (req, res) => {
  const { id } = req.body || {}
  const data = readData()

  const driver = data.drivers.find((d) => String(d.id) === String(id))

  if (!driver) {
    return res.status(404).json({ error: 'Driver not found' })
  }

  driver.approved = true
  driver.status = 'approved'
  writeData(data)

  return res.json({
    success: true,
    driver
  })
})

app.post('/api/reject-driver', (req, res) => {
  const { id } = req.body || {}
  const data = readData()

  const driver = data.drivers.find((d) => String(d.id) === String(id))

  if (!driver) {
    return res.status(404).json({ error: 'Driver not found' })
  }

  driver.approved = false
  driver.status = 'rejected'
  driver.online = false
  writeData(data)

  return res.json({
    success: true,
    driver
  })
})

app.post('/api/toggle-driver-online', (req, res) => {
  const { driverId } = req.body || {}
  const data = readData()

  const driver = data.drivers.find((d) => String(d.id) === String(driverId))

  if (!driver) {
    return res.status(404).json({ error: 'Driver not found' })
  }

  if (!driver.approved && driver.status !== 'approved') {
    return res.status(400).json({ error: 'Driver must be approved first' })
  }

  driver.online = !driver.online
  writeData(data)

  return res.json({
    success: true,
    driver
  })
})

/* =========================
   MANUAL ASSIGN
========================= */
app.post('/api/assign-driver', (req, res) => {
  const { rideId, driverId } = req.body || {}
  const data = readData()

  const ride = data.rides.find((r) => String(r.id) === String(rideId))
  const driver = data.drivers.find((d) => String(d.id) === String(driverId))

  if (!ride) {
    return res.status(404).json({ error: 'Ride not found' })
  }

  if (!driver) {
    return res.status(404).json({ error: 'Driver not found' })
  }

  ride.driverId = driverId
  ride.assignedDriverName = driver.name || 'Driver'
  ride.status = 'assigned'

  driver.currentRide = rideId
  driver.online = false

  writeData(data)

  return res.json({
    success: true,
    ride
  })
})

/* =========================
   TRIP FLOW
========================= */
app.post('/api/driver-accept', (req, res) => {
  const { rideId } = req.body || {}
  const data = readData()

  const ride = data.rides.find((r) => String(r.id) === String(rideId))

  if (!ride) {
    return res.status(404).json({ error: 'Ride not found' })
  }

  ride.status = 'enroute'
  ride.acceptedAt = new Date().toISOString()
  writeData(data)

  return res.json({
    success: true,
    ride
  })
})

app.post('/api/start-trip', (req, res) => {
  const { rideId } = req.body || {}
  const data = readData()

  const ride = data.rides.find((r) => String(r.id) === String(rideId))

  if (!ride) {
    return res.status(404).json({ error: 'Ride not found' })
  }

  ride.status = 'in_progress'
  ride.startedAt = new Date().toISOString()
  writeData(data)

  return res.json({
    success: true,
    ride
  })
})

app.post('/api/driver-complete', (req, res) => {
  const { rideId } = req.body || {}
  const data = readData()

  const ride = data.rides.find((r) => String(r.id) === String(rideId))

  if (!ride) {
    return res.status(404).json({ error: 'Ride not found' })
  }

  ride.status = 'completed'
  ride.completedAt = new Date().toISOString()

  const driver = data.drivers.find((d) => String(d.id) === String(ride.driverId))
  if (driver) {
    driver.currentRide = null
    driver.online = true
  }

  writeData(data)

  return res.json({
    success: true,
    ride
  })
})

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`)
})

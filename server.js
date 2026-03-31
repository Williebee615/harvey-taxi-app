const express = require('express')
const cors = require('cors')
const path = require('path')
const fs = require('fs')

const app = express()
const PORT = process.env.PORT || 10000

app.use(cors())
app.use(express.json())

const DATA_FILE = path.join(__dirname, 'data.json')

const FARE_CONFIG = {
  baseFare: 3.5,
  perMile: 2.35,
  bookingFee: 1.5,
  minimumFare: 8.0
}

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

function readData() {
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
  const activeTrips = data.rides.filter(ride =>
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

  const url =
    `https://nominatim.openstreetmap.org/search?` +
    new URLSearchParams({
      q: address.trim(),
      format: 'jsonv2',
      limit: '1',
      addressdetails: '1',
      email: 'williebee@harveytaxiservice.com'
    }).toString()

  const response = await fetch(url, {
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

  drivers.forEach(driver => {
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

app.use(express.static(path.join(__dirname, 'public')))

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'))
})

app.post('/api/driver-location', (req, res) => {
  const { driverId, lat, lng } = req.body || {}
  const data = readData()

  const driver = data.drivers.find(d => d.id === driverId)

  if (!driver) {
    return res.status(404).json({ success: false, message: 'Driver not found' })
  }

  driver.location = {
    lat: Number(lat),
    lng: Number(lng),
    updatedAt: new Date().toISOString()
  }

  driver.online = true
  writeData(data)

  res.json({ success: true, location: driver.location })
})

app.get('/api/driver-location/:id', (req, res) => {
  const data = readData()
  const driver = data.drivers.find(d => d.id === req.params.id)

  if (!driver || !driver.location) {
    return res.json({ success: false, location: null })
  }

  res.json({ success: true, location: driver.location })
})

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

  res.json({ success: true, driver })
})

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

  res.json({ success: true, rider })
})

app.post('/api/request-ride', async (req, res) => {
  try {
    const data = readData()

    const pickupInput = req.body.pickup || ''
    const dropoffInput = req.body.dropoff || ''

    const pickupGeo = await geocodeAddress(pickupInput)
    const dropoffGeo = await geocodeAddress(dropoffInput)

    let tripDistance = 0
    const surgeMultiplier = getSurgeMultiplier(data)

    if (pickupGeo && dropoffGeo) {
      tripDistance = distanceMiles(
        pickupGeo.lat,
        pickupGeo.lng,
        dropoffGeo.lat,
        dropoffGeo.lng
      )
    }

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
          d => String(d.id) === String(result.driver.id)
        )

        if (matchedDriver) {
          matchedDriver.currentRide = ride.id
          matchedDriver.online = false
        }
      }
    }

    data.rides.push(ride)
    writeData(data)

    res.json({
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
    res.status(500).json({
      success: false,
      message: 'Could not request ride',
      error: err.message
    })
  }
})

app.get('/api/rides', (req, res) => {
  const data = readData()
  res.json(data.rides)
})

app.get('/api/drivers', (req, res) => {
  const data = readData()
  res.json(data.drivers)
})

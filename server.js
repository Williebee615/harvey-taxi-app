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

function defaultData() {
  return {
    admins: [
      {
        id: 'admin_1',
        name: 'Harvey Admin',
        email: 'admin@harveytaxi.com',
        password: 'admin123'
      }
    ],
    drivers: [
      {
        id: 'driver_1',
        name: 'Marcus Driver',
        email: 'driver1@harveytaxi.com',
        password: '123456',
        phone: '615-555-1001',
        car: 'Toyota Camry',
        plate: 'HTX-101',
        approved: true,
        online: true,
        currentLat: 36.1627,
        currentLng: -86.7816,
        activeRideId: null,
        totalTrips: 0,
        createdAt: new Date().toISOString()
      }
    ],
    riders: [],
    rides: [],
    notifications: [],
    emergencies: []
  }
}

function ensureDataShape(data) {
  if (!data.admins) data.admins = []
  if (!data.drivers) data.drivers = []
  if (!data.riders) data.riders = []
  if (!data.rides) data.rides = []
  if (!data.notifications) data.notifications = []
  if (!data.emergencies) data.emergencies = []
  return data
}

function loadData() {
  if (!fs.existsSync(DATA_FILE)) {
    const starter = defaultData()
    fs.writeFileSync(DATA_FILE, JSON.stringify(starter, null, 2))
    return starter
  }

  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8')
    const parsed = JSON.parse(raw)
    return ensureDataShape(parsed)
  } catch (err) {
    const starter = defaultData()
    fs.writeFileSync(DATA_FILE, JSON.stringify(starter, null, 2))
    return starter
  }
}

let db = loadData()

function saveData() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2))
}

function makeId(prefix) {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 100000)}`
}

function toRad(value) {
  return (value * Math.PI) / 180
}

function getDistanceMiles(lat1, lng1, lat2, lng2) {
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

function estimateFare(distanceMiles, durationMinutes = 10) {
  const baseFare = 3.5
  const perMile = 2.2
  const perMinute = 0.35
  const bookingFee = 1.75
  const minimumFare = 8.5

  const total = baseFare + distanceMiles * perMile + durationMinutes * perMinute + bookingFee
  return Number(Math.max(total, minimumFare).toFixed(2))
}

function createNotification(userType, userId, message) {
  db.notifications.unshift({
    id: makeId('note'),
    userType,
    userId,
    message,
    createdAt: new Date().toISOString()
  })
}

function findRideById(rideId) {
  return db.rides.find(r => r.id === rideId)
}

function getNearestAvailableDriver(lat, lng) {
  const availableDrivers = db.drivers
    .filter(driver => driver.approved && driver.online && !driver.activeRideId)
    .map(driver => {
      const distanceAway = getDistanceMiles(
        Number(lat),
        Number(lng),
        Number(driver.currentLat),
        Number(driver.currentLng)
      )
      return { ...driver, distanceAway }
    })
    .sort((a, b) => a.distanceAway - b.distanceAway)

  return availableDrivers.length ? availableDrivers[0] : null
}

// page aliases
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'))
})

app.get('/request-ride', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'request.html'))
})

app.get('/rider-signup', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'rider-verification.html'))
})

app.get('/driver-signup', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'driver.html'))
})

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    message: 'Harvey Taxi API running',
    totals: {
      riders: db.riders.length,
      drivers: db.drivers.length,
      rides: db.rides.length
    }
  })
})

app.post('/api/signup/rider', (req, res) => {
  const {
    firstName,
    lastName,
    email,
    password,
    phone,
    emergencyContactName,
    emergencyContactPhone
  } = req.body

  if (!firstName || !lastName || !email || !password || !phone) {
    return res.status(400).json({ error: 'First name, last name, email, password, and phone are required.' })
  }

  const existing = db.riders.find(r => r.email.toLowerCase() === email.toLowerCase())
  if (existing) {
    return res.status(400).json({ error: 'A rider account with this email already exists.' })
  }

  const rider = {
    id: makeId('rider'),
    firstName,
    lastName,
    name: `${firstName} ${lastName}`.trim(),
    email,
    password,
    phone,
    emergencyContactName: emergencyContactName || '',
    emergencyContactPhone: emergencyContactPhone || '',
    verificationStatus: 'pending',
    createdAt: new Date().toISOString()
  }

  db.riders.push(rider)
  createNotification('admin', 'all', `New rider signup: ${rider.name}`)
  saveData()

  res.json({
    success: true,
    message: 'Rider account created successfully.',
    rider: {
      id: rider.id,
      name: rider.name,
      email: rider.email,
      phone: rider.phone,
      verificationStatus: rider.verificationStatus
    }
  })
})

app.post('/api/signup/driver', (req, res) => {
  const {
    firstName,
    lastName,
    email,
    password,
    phone,
    car,
    plate,
    city,
    vehicleColor
  } = req.body

  if (!firstName || !lastName || !email || !password || !phone || !car || !plate) {
    return res.status(400).json({ error: 'First name, last name, email, password, phone, vehicle, and plate are required.' })
  }

  const existing = db.drivers.find(d => d.email.toLowerCase() === email.toLowerCase())
  if (existing) {
    return res.status(400).json({ error: 'A driver account with this email already exists.' })
  }

  const driver = {
    id: makeId('driver'),
    firstName,
    lastName,
    name: `${firstName} ${lastName}`.trim(),
    email,
    password,
    phone,
    car,
    plate,
    city: city || '',
    vehicleColor: vehicleColor || '',
    approved: false,
    online: false,
    currentLat: 36.1627,
    currentLng: -86.7816,
    activeRideId: null,
    totalTrips: 0,
    verificationStatus: 'pending',
    createdAt: new Date().toISOString()
  }

  db.drivers.push(driver)
  createNotification('admin', 'all', `New driver signup: ${driver.name}`)
  saveData()

  res.json({
    success: true,
    message: 'Driver account created. Waiting for admin approval.',
    driver: {
      id: driver.id,
      name: driver.name,
      email: driver.email,
      approved: driver.approved,
      verificationStatus: driver.verificationStatus
    }
  })
})

app.get('/api/drivers', (req, res) => {
  const drivers = db.drivers.map(driver => ({
    id: driver.id,
    name: driver.name,
    email: driver.email,
    phone: driver.phone,
    car: driver.car,
    plate: driver.plate,
    city: driver.city || '',
    vehicleColor: driver.vehicleColor || '',
    approved: driver.approved,
    online: driver.online,
    activeRideId: driver.activeRideId,
    totalTrips: driver.totalTrips
  }))

  res.json(drivers)
})

app.put('/api/drivers/:driverId/status', (req, res) => {
  const { driverId } = req.params
  const { online } = req.body

  const driver = db.drivers.find(d => d.id === driverId)
  if (!driver) {
    return res.status(404).json({ error: 'Driver not found.' })
  }

  driver.online = !!online
  saveData()

  res.json({
    success: true,
    driver
  })
})

app.put('/api/admin/drivers/:driverId/approve', (req, res) => {
  const { driverId } = req.params
  const driver = db.drivers.find(d => d.id === driverId)

  if (!driver) {
    return res.status(404).json({ error: 'Driver not found.' })
  }

  driver.approved = true
  createNotification('driver', driver.id, 'Your account has been approved by admin.')
  saveData()

  res.json({
    success: true,
    driver
  })
})

app.post('/api/request-ride', (req, res) => {
  const {
    riderName,
    riderPhone,
    pickupAddress,
    destinationAddress,
    pickupLat,
    pickupLng,
    destinationLat,
    destinationLng,
    rideType,
    notes
  } = req.body

  if (
    !riderName ||
    !riderPhone ||
    !pickupAddress ||
    !destinationAddress ||
    pickupLat === undefined ||
    pickupLng === undefined ||
    destinationLat === undefined ||
    destinationLng === undefined
  ) {
    return res.status(400).json({ error: 'Please complete all required ride request fields.' })
  }

  const nearestDriver = getNearestAvailableDriver(pickupLat, pickupLng)

  if (!nearestDriver) {
    return res.status(400).json({ error: 'No available drivers right now. Please try again shortly.' })
  }

  const tripDistance = getDistanceMiles(
    Number(pickupLat),
    Number(pickupLng),
    Number(destinationLat),
    Number(destinationLng)
  )

  const driverToPickupDistance = getDistanceMiles(
    Number(pickupLat),
    Number(pickupLng),
    Number(nearestDriver.currentLat),
    Number(nearestDriver.currentLng)
  )

  const fare = estimateFare(tripDistance, Math.max(10, Math.round(tripDistance * 3)))

  const ride = {
    id: makeId('ride'),
    riderName,
    riderPhone,
    pickupAddress,
    destinationAddress,
    pickupLat: Number(pickupLat),
    pickupLng: Number(pickupLng),
    destinationLat: Number(destinationLat),
    destinationLng: Number(destinationLng),
    rideType: rideType || 'Standard',
    notes: notes || '',
    driverId: nearestDriver.id,
    driverName: nearestDriver.name,
    driverPhone: nearestDriver.phone,
    car: nearestDriver.car,
    plate: nearestDriver.plate,
    fare,
    tripDistanceMiles: Number(tripDistance.toFixed(2)),
    driverDistanceMiles: Number(driverToPickupDistance.toFixed(2)),
    status: 'assigned',
    emergencyActive: false,
    createdAt: new Date().toISOString()
  }

  db.rides.unshift(ride)

  const actualDriver = db.drivers.find(d => d.id === nearestDriver.id)
  if (actualDriver) {
    actualDriver.activeRideId = ride.id
  }

  createNotification('driver', nearestDriver.id, `New ride assigned: ${pickupAddress} → ${destinationAddress}`)
  createNotification('admin', 'all', `Ride created: ${ride.id} assigned to ${nearestDriver.name}`)
  saveData()

  res.json({
    success: true,
    message: 'Ride requested successfully.',
    ride
  })
})

app.get('/api/rides', (req, res) => {
  res.json(db.rides)
})

app.get('/api/rides/:rideId', (req, res) => {
  const ride = findRideById(req.params.rideId)

  if (!ride) {
    return res.status(404).json({ error: 'Ride not found.' })
  }

  res.json(ride)
})

app.put('/api/rides/:rideId/status', (req, res) => {
  const { rideId } = req.params
  const { status } = req.body

  const ride = findRideById(rideId)

  if (!ride) {
    return res.status(404).json({ error: 'Ride not found.' })
  }

  ride.status = status

  if (status === 'completed' || status === 'cancelled') {
    const driver = db.drivers.find(d => d.id === ride.driverId)
    if (driver) {
      driver.activeRideId = null
      if (status === 'completed') {
        driver.totalTrips += 1
        driver.currentLat = ride.destinationLat
        driver.currentLng = ride.destinationLng
      }
    }
  }

  saveData()

  res.json({
    success: true,
    ride
  })
})

app.post('/api/emergency', (req, res) => {
  const {
    rideId,
    riderName,
    driverName,
    car,
    plate,
    lat,
    lng,
    note
  } = req.body

  const ride = rideId ? findRideById(rideId) : null

  const emergency = {
    id: makeId('emergency'),
    rideId: rideId || null,
    riderName: riderName || (ride ? ride.riderName : 'Unknown Rider'),
    driverName: driverName || (ride ? ride.driverName : 'Unknown Driver'),
    car: car || (ride ? ride.car : ''),
    plate: plate || (ride ? ride.plate : ''),
    lat: lat !== undefined ? Number(lat) : ride ? Number(ride.pickupLat) : null,
    lng: lng !== undefined ? Number(lng) : ride ? Number(ride.pickupLng) : null,
    note: note || 'Emergency button activated',
    status: 'active',
    createdAt: new Date().toISOString()
  }

  db.emergencies.unshift(emergency)

  if (ride) {
    ride.emergencyActive = true
  }

  createNotification('admin', 'all', `EMERGENCY ALERT on ride ${rideId || 'unknown'}`)
  saveData()

  res.json({
    success: true,
    emergency
  })
})

app.listen(PORT, () => {
  console.log(`Harvey Taxi running on port ${PORT}`)
})

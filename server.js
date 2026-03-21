const express = require('express')
const cors = require('cors')
const path = require('path')
const fs = require('fs')

const app = express()
const PORT = process.env.PORT || 10000

app.use(cors())
app.use(express.json())
app.use(express.static(path.join(__dirname, 'public')))

const DATA_DIR = path.join(__dirname, 'data')
const DATA_FILE = path.join(DATA_DIR, 'store.json')

let drivers = []
let serviceRequests = []

let users = {
  riders: [],
  drivers: [],
  admins: [
    {
      id: 'admin_1',
      name: 'Harvey Admin',
      email: 'admin@harveytaxi.com',
      password: 'admin123',
      phone: '',
      role: 'admin',
      approved: true
    }
  ]
}

function ensureDataFile() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true })
  }

  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(
      DATA_FILE,
      JSON.stringify(
        {
          drivers: [],
          serviceRequests: [],
          users
        },
        null,
        2
      )
    )
  }
}

function loadData() {
  try {
    ensureDataFile()
    const raw = fs.readFileSync(DATA_FILE, 'utf8')
    const parsed = JSON.parse(raw)

    drivers = Array.isArray(parsed.drivers) ? parsed.drivers : []
    serviceRequests = Array.isArray(parsed.serviceRequests) ? parsed.serviceRequests : []
    users = parsed.users || users

    if (!Array.isArray(users.riders)) users.riders = []
    if (!Array.isArray(users.drivers)) users.drivers = []
    if (!Array.isArray(users.admins) || !users.admins.length) {
      users.admins = [
        {
          id: 'admin_1',
          name: 'Harvey Admin',
          email: 'admin@harveytaxi.com',
          password: 'admin123',
          phone: '',
          role: 'admin',
          approved: true
        }
      ]
    }
  } catch (error) {
    console.error('Failed to load data:', error.message)
  }
}

function saveData() {
  try {
    ensureDataFile()
    fs.writeFileSync(
      DATA_FILE,
      JSON.stringify(
        {
          drivers,
          serviceRequests,
          users
        },
        null,
        2
      )
    )
  } catch (error) {
    console.error('Failed to save data:', error.message)
  }
}

function createId(prefix) {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 100000)}`
}

function normalizeEmail(email = '') {
  return String(email).trim().toLowerCase()
}

function sanitizeUser(user) {
  if (!user) return null

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone || '',
    role: user.role || '',
    vehicleType: user.vehicleType || '',
    carModel: user.carModel || '',
    carColor: user.carColor || '',
    plateNumber: user.plateNumber || '',
    approved: user.approved !== false
  }
}

function getDistance(lat1, lng1, lat2, lng2) {
  const R = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) *
    Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2

  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function moveTowards(current, target, step = 0.003) {
  const latDiff = target.lat - current.lat
  const lngDiff = target.lng - current.lng
  const distance = Math.sqrt(latDiff * latDiff + lngDiff * lngDiff)

  if (distance <= step) {
    return { lat: target.lat, lng: target.lng }
  }

  return {
    lat: current.lat + (latDiff / distance) * step,
    lng: current.lng + (lngDiff / distance) * step
  }
}

function findUserByEmail(email) {
  const clean = normalizeEmail(email)

  return (
    users.riders.find(item => normalizeEmail(item.email) === clean) ||
    users.drivers.find(item => normalizeEmail(item.email) === clean) ||
    users.admins.find(item => normalizeEmail(item.email) === clean)
  )
}

function getAvailableDrivers() {
  return drivers.filter(driver => driver.isOnline && driver.isAvailable)
}

function syncRequestDriverLocation(driver) {
  if (!driver || !driver.currentRequestId) return

  const request = serviceRequests.find(item => item.id === driver.currentRequestId)
  if (!request) return

  request.driverLat = driver.lat
  request.driverLng = driver.lng
  request.updatedAt = new Date().toISOString()
}

function assignNearestDriver(request) {
  const availableDrivers = getAvailableDrivers()

  if (!availableDrivers.length) return null

  let nearestDriver = null
  let shortestDistance = Infinity

  for (const driver of availableDrivers) {
    if (
      typeof driver.lat !== 'number' ||
      typeof driver.lng !== 'number' ||
      typeof request.pickupLat !== 'number' ||
      typeof request.pickupLng !== 'number'
    ) {
      continue
    }

    const distance = getDistance(
      driver.lat,
      driver.lng,
      request.pickupLat,
      request.pickupLng
    )

    if (distance < shortestDistance) {
      shortestDistance = distance
      nearestDriver = driver
    }
  }

  if (!nearestDriver) return null

  nearestDriver.isAvailable = false
  nearestDriver.currentRequestId = request.id

  request.driverId = nearestDriver.id
  request.driverName = nearestDriver.name
  request.driverPhone = nearestDriver.phone || ''
  request.driverVehicle = nearestDriver.vehicleType || 'Taxi'
  request.driverCarModel = nearestDriver.carModel || ''
  request.driverCarColor = nearestDriver.carColor || ''
  request.driverPlateNumber = nearestDriver.plateNumber || ''
  request.driverLat = nearestDriver.lat
  request.driverLng = nearestDriver.lng
  request.estimatedDistanceKm = Number(shortestDistance.toFixed(2))
  request.status = 'matched'
  request.updatedAt = new Date().toISOString()

  saveData()
  return nearestDriver
}

function updateRequestStatus(request, status) {
  request.status = status
  request.updatedAt = new Date().toISOString()
  saveData()
}

function releaseDriverFromRequest(request) {
  if (!request || !request.driverId) return

  const driver = drivers.find(item => item.id === request.driverId)
  if (!driver) return

  driver.currentRequestId = null
  driver.isAvailable = !!driver.isOnline
  saveData()
}

function createDemoDrivers() {
  if (drivers.length) {
    return { message: 'Drivers already loaded.', totalDrivers: drivers.length }
  }

  const demoDrivers = [
    {
      id: 'driver_demo_1',
      name: 'Marcus',
      email: 'marcus@harveytaxi.com',
      phone: '615-555-1001',
      vehicleType: 'Taxi',
      carModel: 'Toyota Camry',
      carColor: 'Black',
      plateNumber: 'HT-101',
      lat: 36.1627,
      lng: -86.7816,
      isOnline: true,
      isAvailable: true,
      currentRequestId: null,
      rating: 4.9
    },
    {
      id: 'driver_demo_2',
      name: 'Tanya',
      email: 'tanya@harveytaxi.com',
      phone: '615-555-1002',
      vehicleType: 'SUV',
      carModel: 'Chevy Tahoe',
      carColor: 'White',
      plateNumber: 'HT-102',
      lat: 36.155,
      lng: -86.775,
      isOnline: true,
      isAvailable: true,
      currentRequestId: null,
      rating: 5.0
    },
    {
      id: 'driver_demo_3',
      name: 'James',
      email: 'james@harveytaxi.com',
      phone: '615-555-1003',
      vehicleType: 'Delivery',
      carModel: 'Honda Accord',
      carColor: 'Blue',
      plateNumber: 'HT-103',
      lat: 36.169,
      lng: -86.79,
      isOnline: true,
      isAvailable: true,
      currentRequestId: null,
      rating: 4.8
    }
  ]

  const demoDriverUsers = [
    {
      id: 'driver_demo_1',
      name: 'Marcus',
      email: 'marcus@harveytaxi.com',
      password: 'driver123',
      phone: '615-555-1001',
      role: 'driver',
      vehicleType: 'Taxi',
      carModel: 'Toyota Camry',
      carColor: 'Black',
      plateNumber: 'HT-101',
      approved: true
    },
    {
      id: 'driver_demo_2',
      name: 'Tanya',
      email: 'tanya@harveytaxi.com',
      password: 'driver123',
      phone: '615-555-1002',
      role: 'driver',
      vehicleType: 'SUV',
      carModel: 'Chevy Tahoe',
      carColor: 'White',
      plateNumber: 'HT-102',
      approved: true
    },
    {
      id: 'driver_demo_3',
      name: 'James',
      email: 'james@harveytaxi.com',
      password: 'driver123',
      phone: '615-555-1003',
      role: 'driver',
      vehicleType: 'Delivery',
      carModel: 'Honda Accord',
      carColor: 'Blue',
      plateNumber: 'HT-103',
      approved: true
    }
  ]

  drivers.push(...demoDrivers)

  demoDriverUsers.forEach(driverUser => {
    const exists = users.drivers.find(item => item.id === driverUser.id)
    if (!exists) users.drivers.push(driverUser)
  })

  saveData()

  return {
    message: 'Demo drivers loaded.',
    totalDrivers: drivers.length
  }
}

function autoAdvanceMatchedRides() {
  const now = Date.now()

  serviceRequests.forEach(request => {
    if (!request.driverId) return

    const createdAtMs = new Date(request.createdAt).getTime()
    const updatedAtMs = new Date(request.updatedAt).getTime()
    const ageMs = now - createdAtMs
    const sinceUpdateMs = now - updatedAtMs

    if (request.status === 'matched' && sinceUpdateMs > 10000) {
      updateRequestStatus(request, 'accepted')
      return
    }

    if (request.status === 'accepted' && ageMs > 25000) {
      updateRequestStatus(request, 'in_progress')
      return
    }

    if (request.status === 'in_progress' && ageMs > 50000) {
      updateRequestStatus(request, 'completed')
      releaseDriverFromRequest(request)
    }
  })
}

function moveActiveDrivers() {
  const activeRequests = serviceRequests.filter(item =>
    ['matched', 'accepted', 'in_progress'].includes(item.status)
  )

  activeRequests.forEach(request => {
    const driver = drivers.find(item => item.id === request.driverId)
    if (!driver) return

    let target = null

    if (request.status === 'matched' || request.status === 'accepted') {
      target = {
        lat: request.pickupLat,
        lng: request.pickupLng
      }
    }

    if (request.status === 'in_progress') {
      target = {
        lat: request.destinationLat,
        lng: request.destinationLng
      }
    }

    if (!target) return

    const nextPosition = moveTowards(
      { lat: driver.lat, lng: driver.lng },
      target,
      0.0025
    )

    driver.lat = nextPosition.lat
    driver.lng = nextPosition.lng
    request.driverLat = driver.lat
    request.driverLng = driver.lng
    request.updatedAt = new Date().toISOString()
  })

  saveData()
}

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    message: 'Harvey Taxi API is live',
    timestamp: new Date().toISOString(),
    driversOnline: drivers.filter(driver => driver.isOnline).length,
    activeRequests: serviceRequests.filter(item =>
      ['searching', 'matched', 'accepted', 'in_progress'].includes(item.status)
    ).length
  })
})

app.post('/api/auth/signup', (req, res) => {
  const {
    name,
    email,
    password,
    phone,
    role,
    vehicleType,
    carModel,
    carColor,
    plateNumber
  } = req.body

  if (!name || !email || !password || !role) {
    return res.status(400).json({ error: 'Name, email, password, and role are required.' })
  }

  if (!['rider', 'driver'].includes(role)) {
    return res.status(400).json({ error: 'Role must be rider or driver.' })
  }

  const cleanEmail = normalizeEmail(email)

  if (findUserByEmail(cleanEmail)) {
    return res.status(400).json({ error: 'An account with that email already exists.' })
  }

  const newUser = {
    id: createId(role),
    name,
    email: cleanEmail,
    password,
    phone: phone || '',
    role,
    approved: true
  }

  if (role === 'driver') {
    newUser.vehicleType = vehicleType || 'Taxi'
    newUser.carModel = carModel || ''
    newUser.carColor = carColor || ''
    newUser.plateNumber = plateNumber || ''

    users.drivers.push(newUser)

    drivers.push({
      id: newUser.id,
      name: newUser.name,
      email: newUser.email,
      phone: newUser.phone,
      vehicleType: newUser.vehicleType,
      carModel: newUser.carModel,
      carColor: newUser.carColor,
      plateNumber: newUser.plateNumber,
      lat: 36.1627,
      lng: -86.7816,
      isOnline: false,
      isAvailable: false,
      currentRequestId: null,
      rating: 5.0
    })
  } else {
    users.riders.push(newUser)
  }

  saveData()

  res.json({
    message: `${role} account created successfully.`,
    user: sanitizeUser(newUser)
  })
})

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body

  const user = findUserByEmail(email)

  if (!user || user.password !== password) {
    return res.status(401).json({ error: 'Invalid email or password.' })
  }

  res.json({
    message: 'Login successful.',
    user: sanitizeUser(user)
  })
})

app.get('/api/drivers', (req, res) => {
  res.json(drivers)
})

app.post('/api/drivers/status', (req, res) => {
  const { driverId, isOnline } = req.body
  const driver = drivers.find(item => item.id === driverId)

  if (!driver) {
    return res.status(404).json({ error: 'Driver not found.' })
  }

  driver.isOnline = !!isOnline
  driver.isAvailable = !!isOnline && !driver.currentRequestId
  saveData()

  res.json({
    message: `Driver is now ${driver.isOnline ? 'online' : 'offline'}.`,
    driver
  })
})

app.post('/api/drivers/location', (req, res) => {
  const { driverId, lat, lng } = req.body
  const driver = drivers.find(item => item.id === driverId)

  if (!driver) {
    return res.status(404).json({ error: 'Driver not found.' })
  }

  if (typeof lat !== 'number' || typeof lng !== 'number') {
    return res.status(400).json({ error: 'Valid lat and lng are required.' })
  }

  driver.lat = lat
  driver.lng = lng
  syncRequestDriverLocation(driver)
  saveData()

  res.json({
    message: 'Driver location updated.',
    driver
  })
})

app.post('/api/requests', (req, res) => {
  const {
    riderId,
    riderName,
    riderPhone,
    serviceType,
    pickup,
    destination,
    pickupLat,
    pickupLng,
    destinationLat,
    destinationLng,
    notes
  } = req.body

  if (!riderName || !pickup || !destination) {
    return res.status(400).json({ error: 'Rider name, pickup, and destination are required.' })
  }

  const request = {
    id: createId('ride'),
    riderId: riderId || null,
    riderName,
    riderPhone: riderPhone || '',
    serviceType: serviceType || 'ride',
    pickup,
    destination,
    pickupLat: typeof pickupLat === 'number' ? pickupLat : 36.1627,
    pickupLng: typeof pickupLng === 'number' ? pickupLng : -86.7816,
    destinationLat: typeof destinationLat === 'number' ? destinationLat : 36.1745,
    destinationLng: typeof destinationLng === 'number' ? destinationLng : -86.7679,
    notes: notes || '',
    status: 'searching',
    driverId: null,
    driverName: '',
    driverPhone: '',
    driverVehicle: '',
    driverCarModel: '',
    driverCarColor: '',
    driverPlateNumber: '',
    driverLat: null,
    driverLng: null,
    estimatedDistanceKm: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }

  serviceRequests.unshift(request)

  if (!drivers.length) {
    createDemoDrivers()
  }

  const matchedDriver = assignNearestDriver(request)

  if (!matchedDriver) {
    request.status = 'searching'
    request.updatedAt = new Date().toISOString()
  }

  saveData()

  res.json({
    message: matchedDriver
      ? 'Driver matched successfully.'
      : 'Request created. No driver available yet.',
    request
  })
})

app.get('/api/requests', (req, res) => {
  res.json(serviceRequests)
})

app.get('/api/requests/:id', (req, res) => {
  const request = serviceRequests.find(item => item.id === req.params.id)

  if (!request) {
    return res.status(404).json({ error: 'Request not found.' })
  }

  res.json(request)
})

app.post('/api/requests/:id/accept', (req, res) => {
  const { driverId } = req.body

  const request = serviceRequests.find(item => item.id === req.params.id)
  const driver = drivers.find(item => item.id === driverId)

  if (!request) {
    return res.status(404).json({ error: 'Request not found.' })
  }

  if (!driver) {
    return res.status(404).json({ error: 'Driver not found.' })
  }

  request.driverId = driver.id
  request.driverName = driver.name
  request.driverPhone = driver.phone || ''
  request.driverVehicle = driver.vehicleType || 'Taxi'
  request.driverCarModel = driver.carModel || ''
  request.driverCarColor = driver.carColor || ''
  request.driverPlateNumber = driver.plateNumber || ''
  request.driverLat = driver.lat
  request.driverLng = driver.lng

  driver.currentRequestId = request.id
  driver.isOnline = true
  driver.isAvailable = false

  updateRequestStatus(request, 'accepted')

  res.json({
    message: 'Ride accepted.',
    request,
    driver
  })
})

app.post('/api/requests/:id/start', (req, res) => {
  const request = serviceRequests.find(item => item.id === req.params.id)

  if (!request) {
    return res.status(404).json({ error: 'Request not found.' })
  }

  updateRequestStatus(request, 'in_progress')

  res.json({
    message: 'Ride started.',
    request
  })
})

app.post('/api/requests/:id/complete', (req, res) => {
  const request = serviceRequests.find(item => item.id === req.params.id)

  if (!request) {
    return res.status(404).json({ error: 'Request not found.' })
  }

  updateRequestStatus(request, 'completed')
  releaseDriverFromRequest(request)

  res.json({
    message: 'Ride completed.',
    request
  })
})

app.post('/api/requests/:id/cancel', (req, res) => {
  const request = serviceRequests.find(item => item.id === req.params.id)

  if (!request) {
    return res.status(404).json({ error: 'Request not found.' })
  }

  updateRequestStatus(request, 'cancelled')
  releaseDriverFromRequest(request)

  res.json({
    message: 'Ride cancelled.',
    request
  })
})

app.get('/api/riders/:riderId/requests', (req, res) => {
  const riderRequests = serviceRequests.filter(item => item.riderId === req.params.riderId)
  res.json(riderRequests)
})

app.get('/api/drivers/:driverId/requests', (req, res) => {
  const driverRequests = serviceRequests.filter(item => item.driverId === req.params.driverId)
  res.json(driverRequests)
})

app.get('/api/admin/stats', (req, res) => {
  res.json({
    totalRiders: users.riders.length,
    totalDrivers: users.drivers.length,
    onlineDrivers: drivers.filter(driver => driver.isOnline).length,
    availableDrivers: drivers.filter(driver => driver.isOnline && driver.isAvailable).length,
    totalRequests: serviceRequests.length,
    activeRequests: serviceRequests.filter(item =>
      ['searching', 'matched', 'accepted', 'in_progress'].includes(item.status)
    ).length,
    completedRequests: serviceRequests.filter(item => item.status === 'completed').length,
    cancelledRequests: serviceRequests.filter(item => item.status === 'cancelled').length
  })
})

app.get('/api/admin/users', (req, res) => {
  res.json({
    riders: users.riders.map(sanitizeUser),
    drivers: users.drivers.map(sanitizeUser),
    admins: users.admins.map(sanitizeUser)
  })
})

app.post('/api/seed-demo', (req, res) => {
  const result = createDemoDrivers()
  res.json(result)
})

app.get('/api/debug/store', (req, res) => {
  res.json({
    users: {
      riders: users.riders.map(sanitizeUser),
      drivers: users.drivers.map(sanitizeUser),
      admins: users.admins.map(sanitizeUser)
    },
    drivers,
    serviceRequests
  })
})

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'))
})

app.get('/request', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'request.html'))
})

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'))
})

loadData()

setInterval(() => {
  autoAdvanceMatchedRides()
  moveActiveDrivers()
}, 5000)

app.listen(PORT, () => {
  console.log(`Harvey Taxi API running on port ${PORT}`)
})

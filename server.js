const express = require('express')
const cors = require('cors')
const path = require('path')
const fs = require('fs')

const app = express()
const PORT = process.env.PORT || 10000
const DATA_FILE = path.join(__dirname, 'data.json')

app.use(cors())
app.use(express.json({ limit: '2mb' }))
app.use(express.static(path.join(__dirname, 'public')))

function defaultData() {
  return {
    users: {
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
      ]
    },
    serviceRequests: [],
    notifications: []
  }
}

function loadData() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      const seed = defaultData()
      fs.writeFileSync(DATA_FILE, JSON.stringify(seed, null, 2))
      return seed
    }
    const raw = fs.readFileSync(DATA_FILE, 'utf8')
    return JSON.parse(raw)
  } catch (err) {
    console.error('Failed to load data:', err.message)
    return defaultData()
  }
}

function saveData() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2))
  } catch (err) {
    console.error('Failed to save data:', err.message)
  }
}

let db = loadData()

function uid(prefix = 'id') {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 100000)}`
}

function toNumber(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function getDistanceKm(lat1, lng1, lat2, lng2) {
  const R = 6371
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

function sanitizeUser(user) {
  if (!user) return null
  const clone = { ...user }
  delete clone.password
  return clone
}

function findNearestAvailableDriver(pickupLat, pickupLng, serviceType = 'ride') {
  const approvedDrivers = db.users.drivers.filter((driver) => {
    const supportsRide = !driver.services || driver.services.includes('ride')
    const supportsDelivery = !driver.services || driver.services.includes('delivery')
    const matchesService =
      serviceType === 'ride' ? supportsRide : serviceType === 'delivery' ? supportsDelivery : true

    return (
      driver.isApproved === true &&
      driver.isOnline === true &&
      driver.isAvailable === true &&
      typeof driver.location?.lat === 'number' &&
      typeof driver.location?.lng === 'number' &&
      matchesService
    )
  })

  if (!approvedDrivers.length) return null

  let nearest = null
  let nearestDistance = Infinity

  for (const driver of approvedDrivers) {
    const distance = getDistanceKm(
      pickupLat,
      pickupLng,
      driver.location.lat,
      driver.location.lng
    )

    if (distance < nearestDistance) {
      nearestDistance = distance
      nearest = driver
    }
  }

  if (!nearest) return null

  return {
    driver: nearest,
    distanceKm: Number(nearestDistance.toFixed(2))
  }
}

function addNotification(userId, message, type = 'general') {
  db.notifications.push({
    id: uid('note'),
    userId,
    message,
    type,
    createdAt: new Date().toISOString(),
    read: false
  })
  saveData()
}

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    message: 'Harvey Taxi API is running',
    time: new Date().toISOString()
  })
})

app.post('/api/auth/register-rider', (req, res) => {
  const { name, email, password, phone } = req.body

  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Name, email, and password are required.' })
  }

  const exists =
    db.users.riders.find((u) => u.email.toLowerCase() === email.toLowerCase()) ||
    db.users.drivers.find((u) => u.email.toLowerCase() === email.toLowerCase()) ||
    db.users.admins.find((u) => u.email.toLowerCase() === email.toLowerCase())

  if (exists) {
    return res.status(409).json({ error: 'Email already exists.' })
  }

  const rider = {
    id: uid('rider'),
    role: 'rider',
    name,
    email,
    password,
    phone: phone || '',
    createdAt: new Date().toISOString(),
    isVerified: false
  }

  db.users.riders.push(rider)
  saveData()

  res.json({
    message: 'Rider account created.',
    user: sanitizeUser(rider)
  })
})

app.post('/api/auth/register-driver', (req, res) => {
  const { name, email, password, phone, vehicle, services } = req.body

  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Name, email, and password are required.' })
  }

  const exists =
    db.users.riders.find((u) => u.email.toLowerCase() === email.toLowerCase()) ||
    db.users.drivers.find((u) => u.email.toLowerCase() === email.toLowerCase()) ||
    db.users.admins.find((u) => u.email.toLowerCase() === email.toLowerCase())

  if (exists) {
    return res.status(409).json({ error: 'Email already exists.' })
  }

  const driver = {
    id: uid('driver'),
    role: 'driver',
    name,
    email,
    password,
    phone: phone || '',
    vehicle: vehicle || '',
    services: Array.isArray(services) && services.length ? services : ['ride', 'delivery'],
    createdAt: new Date().toISOString(),
    isApproved: false,
    isOnline: false,
    isAvailable: false,
    approvalBadge: 'Pending',
    location: {
      lat: null,
      lng: null
    },
    stats: {
      completedTrips: 0,
      completedDeliveries: 0
    }
  }

  db.users.drivers.push(driver)
  saveData()

  res.json({
    message: 'Driver account created. Awaiting admin approval.',
    user: sanitizeUser(driver)
  })
})

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' })
  }

  const allUsers = [
    ...db.users.riders.map((u) => ({ ...u, role: 'rider' })),
    ...db.users.drivers.map((u) => ({ ...u, role: 'driver' })),
    ...db.users.admins.map((u) => ({ ...u, role: 'admin' }))
  ]

  const user = allUsers.find(
    (u) => u.email.toLowerCase() === email.toLowerCase() && u.password === password
  )

  if (!user) {
    return res.status(401).json({ error: 'Invalid email or password.' })
  }

  res.json({
    message: 'Login successful.',
    user: sanitizeUser(user)
  })
})

app.get('/api/admin/drivers', (req, res) => {
  res.json(db.users.drivers.map(sanitizeUser))
})

app.post('/api/admin/approve-driver/:driverId', (req, res) => {
  const { driverId } = req.params
  const driver = db.users.drivers.find((d) => d.id === driverId)

  if (!driver) {
    return res.status(404).json({ error: 'Driver not found.' })
  }

  driver.isApproved = true
  driver.isOnline = true
  driver.isAvailable = true
  driver.approvalBadge = 'Approved'
  driver.approvedAt = new Date().toISOString()

  saveData()
  addNotification(driver.id, 'Your driver account has been approved.', 'approval')

  res.json({
    message: 'Driver approved and auto-enabled.',
    driver: sanitizeUser(driver)
  })
})

app.post('/api/admin/reject-driver/:driverId', (req, res) => {
  const { driverId } = req.params
  const driver = db.users.drivers.find((d) => d.id === driverId)

  if (!driver) {
    return res.status(404).json({ error: 'Driver not found.' })
  }

  driver.isApproved = false
  driver.isOnline = false
  driver.isAvailable = false
  driver.approvalBadge = 'Rejected'
  driver.rejectedAt = new Date().toISOString()

  saveData()
  addNotification(driver.id, 'Your driver account is not approved yet.', 'approval')

  res.json({
    message: 'Driver rejected.',
    driver: sanitizeUser(driver)
  })
})

app.post('/api/drivers/location', (req, res) => {
  const { driverId, lat, lng } = req.body
  const driver = db.users.drivers.find((d) => d.id === driverId)

  if (!driver) {
    return res.status(404).json({ error: 'Driver not found.' })
  }

  const parsedLat = toNumber(lat)
  const parsedLng = toNumber(lng)

  if (parsedLat === null || parsedLng === null) {
    return res.status(400).json({ error: 'Valid latitude and longitude are required.' })
  }

  driver.location = {
    lat: parsedLat,
    lng: parsedLng,
    updatedAt: new Date().toISOString()
  }

  saveData()

  res.json({
    message: 'Driver location updated.',
    driver: sanitizeUser(driver)
  })
})

app.post('/api/drivers/status', (req, res) => {
  const { driverId, isOnline, isAvailable } = req.body
  const driver = db.users.drivers.find((d) => d.id === driverId)

  if (!driver) {
    return res.status(404).json({ error: 'Driver not found.' })
  }

  if (!driver.isApproved) {
    return res.status(403).json({ error: 'Driver must be approved first.' })
  }

  if (typeof isOnline === 'boolean') driver.isOnline = isOnline
  if (typeof isAvailable === 'boolean') driver.isAvailable = isAvailable

  saveData()

  res.json({
    message: 'Driver status updated.',
    driver: sanitizeUser(driver)
  })
})

app.post('/api/requests/create', (req, res) => {
  const {
    riderId,
    serviceType,
    pickupAddress,
    dropoffAddress,
    pickupLat,
    pickupLng,
    dropoffLat,
    dropoffLng,
    notes
  } = req.body

  const rider = db.users.riders.find((r) => r.id === riderId)
  if (!rider) {
    return res.status(404).json({ error: 'Rider not found.' })
  }

  const parsedPickupLat = toNumber(pickupLat)
  const parsedPickupLng = toNumber(pickupLng)

  if (parsedPickupLat === null || parsedPickupLng === null) {
    return res.status(400).json({ error: 'Pickup coordinates are required.' })
  }

  const type = serviceType === 'delivery' ? 'delivery' : 'ride'
  const nearest = findNearestAvailableDriver(parsedPickupLat, parsedPickupLng, type)

  const requestItem = {
    id: uid('req'),
    riderId,
    riderName: rider.name,
    serviceType: type,
    pickupAddress: pickupAddress || '',
    dropoffAddress: dropoffAddress || '',
    pickupLat: parsedPickupLat,
    pickupLng: parsedPickupLng,
    dropoffLat: toNumber(dropoffLat),
    dropoffLng: toNumber(dropoffLng),
    notes: notes || '',
    status: nearest ? 'assigned' : 'pending',
    createdAt: new Date().toISOString(),
    driverId: nearest ? nearest.driver.id : null,
    driverName: nearest ? nearest.driver.name : null,
    estimatedDriverDistanceKm: nearest ? nearest.distanceKm : null
  }

  db.serviceRequests.push(requestItem)

  if (nearest) {
    nearest.driver.isAvailable = false
    addNotification(
      nearest.driver.id,
      `New ${type} request assigned to you.`,
      'dispatch'
    )
  }

  saveData()

  res.json({
    message: nearest
      ? `Request created and assigned to nearest driver (${nearest.driver.name}).`
      : 'Request created. No available driver found yet.',
    request: requestItem
  })
})

app.get('/api/requests', (req, res) => {
  res.json(db.serviceRequests)
})

app.get('/api/requests/driver/:driverId', (req, res) => {
  const { driverId } = req.params
  const items = db.serviceRequests.filter((r) => r.driverId === driverId)
  res.json(items)
})

app.get('/api/requests/rider/:riderId', (req, res) => {
  const { riderId } = req.params
  const items = db.serviceRequests.filter((r) => r.riderId === riderId)
  res.json(items)
})

app.post('/api/requests/accept/:requestId', (req, res) => {
  const { requestId } = req.params
  const { driverId } = req.body

  const requestItem = db.serviceRequests.find((r) => r.id === requestId)
  if (!requestItem) {
    return res.status(404).json({ error: 'Request not found.' })
  }

  const driver = db.users.drivers.find((d) => d.id === driverId)
  if (!driver) {
    return res.status(404).json({ error: 'Driver not found.' })
  }

  requestItem.status = 'accepted'
  requestItem.driverId = driver.id
  requestItem.driverName = driver.name
  requestItem.acceptedAt = new Date().toISOString()

  driver.isAvailable = false

  saveData()
  addNotification(requestItem.riderId, `${driver.name} accepted your request.`, 'trip')

  res.json({
    message: 'Request accepted.',
    request: requestItem
  })
})

app.post('/api/requests/complete/:requestId', (req, res) => {
  const { requestId } = req.params
  const requestItem = db.serviceRequests.find((r) => r.id === requestId)

  if (!requestItem) {
    return res.status(404).json({ error: 'Request not found.' })
  }

  const driver = db.users.drivers.find((d) => d.id === requestItem.driverId)
  if (!driver) {
    return res.status(404).json({ error: 'Assigned driver not found.' })
  }

  requestItem.status = 'completed'
  requestItem.completedAt = new Date().toISOString()

  driver.isAvailable = true

  if (requestItem.serviceType === 'delivery') {
    driver.stats.completedDeliveries += 1
  } else {
    driver.stats.completedTrips += 1
  }

  saveData()
  addNotification(requestItem.riderId, 'Your service has been completed.', 'trip')

  res.json({
    message: 'Request completed.',
    request: requestItem,
    driver: sanitizeUser(driver)
  })
})

app.get('/api/notifications/:userId', (req, res) => {
  const { userId } = req.params
  const items = db.notifications.filter((n) => n.userId === userId)
  res.json(items)
})

app.get('/api/admin/stats', (req, res) => {
  const approvedDrivers = db.users.drivers.filter((d) => d.isApproved).length
  const onlineDrivers = db.users.drivers.filter((d) => d.isOnline).length
  const availableDrivers = db.users.drivers.filter((d) => d.isAvailable).length
  const totalRiders = db.users.riders.length
  const totalRequests = db.serviceRequests.length
  const completedRequests = db.serviceRequests.filter((r) => r.status === 'completed').length
  const pendingRequests = db.serviceRequests.filter((r) => r.status === 'pending').length

  res.json({
    approvedDrivers,
    onlineDrivers,
    availableDrivers,
    totalRiders,
    totalRequests,
    completedRequests,
    pendingRequests
  })
})

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'))
})

app.listen(PORT, () => {
  console.log(`Harvey Taxi server running on port ${PORT}`)
})

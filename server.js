const express = require('express')
const cors = require('cors')
const path = require('path')

const app = express()
const PORT = process.env.PORT || 10000

app.use(cors())
app.use(express.json())
app.use(express.static(path.join(__dirname, 'public')))

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
      password: 'admin123'
    }
  ]
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

function moveTowards(current, target, step = 0.0005) {
  const latDiff = target.lat - current.lat
  const lngDiff = target.lng - current.lng
  const distance = Math.sqrt(latDiff * latDiff + lngDiff * lngDiff)

  if (distance < step) return target

  return {
    lat: current.lat + (latDiff / distance) * step,
    lng: current.lng + (lngDiff / distance) * step
  }
}

function sanitizeRider(rider) {
  return {
    id: rider.id,
    name: rider.name,
    email: rider.email,
    status: rider.status || 'active'
  }
}

function sanitizeDriver(driver) {
  return {
    id: driver.id,
    name: driver.name,
    email: driver.email,
    carType: driver.carType || 'Standard',
    status: driver.status || 'active',
    approved: driver.approved === undefined ? false : driver.approved,
    services: driver.services || ['ride']
  }
}

function normalizeServices(services) {
  const valid = ['ride', 'food_delivery', 'grocery_delivery', 'package_delivery']
  if (!Array.isArray(services) || !services.length) return ['ride']
  return [...new Set(services.filter(service => valid.includes(service)))]
}

function serviceLabel(serviceType) {
  const map = {
    ride: 'Ride',
    food_delivery: 'Food Delivery',
    grocery_delivery: 'Grocery Delivery',
    package_delivery: 'Package Delivery'
  }
  return map[serviceType] || serviceType
}

function servicePrice(serviceType) {
  const map = {
    ride: 12,
    food_delivery: 8,
    grocery_delivery: 14,
    package_delivery: 10
  }
  return map[serviceType] || 12
}

// auto movement
setInterval(() => {
  serviceRequests.forEach(request => {
    if (!request.driver || !request.driver.driverId) return

    const driver = drivers.find(d => d.driverId === request.driver.driverId)
    if (!driver) return

    if (request.status === 'en_route_pickup') {
      const next = moveTowards(driver, request.pickup)
      driver.lat = next.lat
      driver.lng = next.lng

      if (
        getDistance(driver.lat, driver.lng, request.pickup.lat, request.pickup.lng) < 0.05
      ) {
        request.status = 'picked_up'
      }
    } else if (request.status === 'picked_up') {
      const next = moveTowards(driver, request.dropoff)
      driver.lat = next.lat
      driver.lng = next.lng

      if (
        getDistance(driver.lat, driver.lng, request.dropoff.lat, request.dropoff.lng) < 0.05
      ) {
        request.status = 'completed'
        driver.available = true
      }
    }
  })
}, 2000)

// home
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'))
})

app.get('/api/test', (req, res) => {
  res.json({ message: 'API working perfectly' })
})

// rider auth
app.post('/api/rider/signup', (req, res) => {
  const { name, email, password } = req.body

  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Name, email, and password are required' })
  }

  const exists = users.riders.find(user => user.email === email)
  if (exists) {
    return res.status(400).json({ error: 'Rider already exists' })
  }

  const newRider = {
    id: `rider_${Date.now()}`,
    name,
    email,
    password,
    status: 'active'
  }

  users.riders.push(newRider)

  res.json({
    success: true,
    message: 'Rider account created',
    rider: sanitizeRider(newRider)
  })
})

app.post('/api/rider/login', (req, res) => {
  const { email, password } = req.body

  const rider = users.riders.find(
    user => user.email === email && user.password === password
  )

  if (!rider) {
    return res.status(401).json({ error: 'Invalid rider login' })
  }

  if (rider.status === 'suspended') {
    return res.status(403).json({ error: 'Rider account is suspended' })
  }

  res.json({
    success: true,
    message: 'Rider login successful',
    rider: sanitizeRider(rider)
  })
})

// driver auth
app.post('/api/driver/signup', (req, res) => {
  const { name, email, password, carType, services } = req.body

  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Name, email, and password are required' })
  }

  const exists = users.drivers.find(user => user.email === email)
  if (exists) {
    return res.status(400).json({ error: 'Driver already exists' })
  }

  const newDriver = {
    id: `driver_${Date.now()}`,
    name,
    email,
    password,
    carType: carType || 'Standard',
    status: 'active',
    approved: false,
    services: normalizeServices(services)
  }

  users.drivers.push(newDriver)

  res.json({
    success: true,
    message: 'Driver account created',
    driver: sanitizeDriver(newDriver)
  })
})

app.post('/api/driver/login', (req, res) => {
  const { email, password } = req.body

  const driver = users.drivers.find(
    user => user.email === email && user.password === password
  )

  if (!driver) {
    return res.status(401).json({ error: 'Invalid driver login' })
  }

  if (driver.status === 'suspended') {
    return res.status(403).json({ error: 'Driver account is suspended' })
  }

  if (!driver.approved) {
    return res.status(403).json({ error: 'Driver account is pending admin approval' })
  }

  res.json({
    success: true,
    message: 'Driver login successful',
    driver: sanitizeDriver(driver)
  })
})

// admin auth
app.post('/api/admin/login', (req, res) => {
  const { email, password } = req.body

  const admin = users.admins.find(
    user => user.email === email && user.password === password
  )

  if (!admin) {
    return res.status(401).json({ error: 'Invalid admin login' })
  }

  res.json({
    success: true,
    message: 'Admin login successful',
    admin: {
      id: admin.id,
      name: admin.name,
      email: admin.email
    }
  })
})

// driver location
app.post('/api/driver/location', (req, res) => {
  const { driverId, lat, lng } = req.body

  if (!driverId || lat === undefined || lng === undefined) {
    return res.status(400).json({ error: 'driverId, lat, and lng are required' })
  }

  const driverProfile = users.drivers.find(d => d.id === driverId)
  if (driverProfile && (!driverProfile.approved || driverProfile.status === 'suspended')) {
    return res.status(403).json({ error: 'Driver is not allowed to go online' })
  }

  let existing = drivers.find(d => d.driverId === driverId)

  if (existing) {
    existing.lat = lat
    existing.lng = lng
    existing.available = true
  } else {
    drivers.push({ driverId, lat, lng, available: true })
  }

  res.json({ success: true })
})

// create service request
app.post('/api/request-service', (req, res) => {
  const { riderId, serviceType, pickup, dropoff, details } = req.body

  if (!riderId || !serviceType || !pickup || !dropoff) {
    return res.status(400).json({
      error: 'riderId, serviceType, pickup, and dropoff are required'
    })
  }

  const validServiceTypes = ['ride', 'food_delivery', 'grocery_delivery', 'package_delivery']
  if (!validServiceTypes.includes(serviceType)) {
    return res.status(400).json({ error: 'Invalid service type' })
  }

  const riderProfile = users.riders.find(r => r.name === riderId || r.id === riderId)
  if (riderProfile && riderProfile.status === 'suspended') {
    return res.status(403).json({ error: 'Rider account is suspended' })
  }

  let nearest = null
  let min = Infinity

  drivers.forEach(d => {
    if (!d.available) return

    const driverProfile = users.drivers.find(profile => profile.id === d.driverId)
    if (!driverProfile || !driverProfile.approved || driverProfile.status === 'suspended') {
      return
    }

    if (!driverProfile.services || !driverProfile.services.includes(serviceType)) {
      return
    }

    const dist = getDistance(pickup.lat, pickup.lng, d.lat, d.lng)
    if (dist < min) {
      min = dist
      nearest = d
    }
  })

  const request = {
    id: Date.now(),
    riderId,
    serviceType,
    serviceLabel: serviceLabel(serviceType),
    pickup,
    dropoff,
    details: details || {},
    price: servicePrice(serviceType),
    status: nearest ? 'matched' : 'waiting',
    driver: nearest ? { driverId: nearest.driverId } : null,
    distance: nearest ? Number(min.toFixed(2)) : null,
    acceptedBy: null,
    createdAt: new Date().toISOString()
  }

  serviceRequests.push(request)

  res.json({ success: true, request })
})

// accept request
app.post('/api/requests/:id/accept', (req, res) => {
  const request = serviceRequests.find(r => r.id == req.params.id)
  const driver = drivers.find(d => d.driverId === req.body.driverId)
  const driverProfile = users.drivers.find(d => d.id === req.body.driverId)

  if (!request) {
    return res.status(404).json({ error: 'Request not found' })
  }

  if (!driver) {
    return res.status(404).json({ error: 'Driver not found' })
  }

  if (!driverProfile || !driverProfile.approved || driverProfile.status === 'suspended') {
    return res.status(403).json({ error: 'Driver is not authorized' })
  }

  if (!driverProfile.services || !driverProfile.services.includes(request.serviceType)) {
    return res.status(403).json({ error: 'Driver is not approved for this service type' })
  }

  request.status = 'en_route_pickup'
  request.acceptedBy = driver.driverId
  request.driver = { driverId: driver.driverId }
  driver.available = false

  res.json({ success: true, message: 'Request accepted', request })
})

// admin dashboard
app.get('/api/admin/dashboard', (req, res) => {
  res.json({
    riders: users.riders.map(sanitizeRider),
    drivers: users.drivers.map(sanitizeDriver),
    requests: serviceRequests,
    counts: {
      riders: users.riders.length,
      drivers: users.drivers.length,
      requests: serviceRequests.length,
      pendingDrivers: users.drivers.filter(d => !d.approved).length,
      activeDrivers: users.drivers.filter(d => d.status !== 'suspended').length
    }
  })
})

// admin actions
app.post('/api/admin/driver/:id/approve', (req, res) => {
  const driver = users.drivers.find(d => d.id === req.params.id)
  if (!driver) {
    return res.status(404).json({ error: 'Driver not found' })
  }

  driver.approved = true

  res.json({
    success: true,
    message: 'Driver approved successfully',
    driver: sanitizeDriver(driver)
  })
})

app.post('/api/admin/driver/:id/suspend', (req, res) => {
  const driver = users.drivers.find(d => d.id === req.params.id)
  if (!driver) {
    return res.status(404).json({ error: 'Driver not found' })
  }

  driver.status = 'suspended'

  const liveDriver = drivers.find(d => d.driverId === driver.id)
  if (liveDriver) {
    liveDriver.available = false
  }

  res.json({
    success: true,
    message: 'Driver suspended successfully',
    driver: sanitizeDriver(driver)
  })
})

app.post('/api/admin/driver/:id/activate', (req, res) => {
  const driver = users.drivers.find(d => d.id === req.params.id)
  if (!driver) {
    return res.status(404).json({ error: 'Driver not found' })
  }

  driver.status = 'active'

  res.json({
    success: true,
    message: 'Driver activated successfully',
    driver: sanitizeDriver(driver)
  })
})

app.post('/api/admin/rider/:id/suspend', (req, res) => {
  const rider = users.riders.find(r => r.id === req.params.id)
  if (!rider) {
    return res.status(404).json({ error: 'Rider not found' })
  }

  rider.status = 'suspended'

  res.json({
    success: true,
    message: 'Rider suspended successfully',
    rider: sanitizeRider(rider)
  })
})

app.post('/api/admin/rider/:id/activate', (req, res) => {
  const rider = users.riders.find(r => r.id === req.params.id)
  if (!rider) {
    return res.status(404).json({ error: 'Rider not found' })
  }

  rider.status = 'active'

  res.json({
    success: true,
    message: 'Rider activated successfully',
    rider: sanitizeRider(rider)
  })
})

app.post('/api/admin/driver/:id/services', (req, res) => {
  const driver = users.drivers.find(d => d.id === req.params.id)
  if (!driver) {
    return res.status(404).json({ error: 'Driver not found' })
  }

  driver.services = normalizeServices(req.body.services)

  res.json({
    success: true,
    message: 'Driver services updated',
    driver: sanitizeDriver(driver)
  })
})

// general data
app.get('/api/requests/:id', (req, res) => {
  const request = serviceRequests.find(r => r.id == req.params.id)

  if (!request) {
    return res.status(404).json({ error: 'Request not found' })
  }

  const driver = drivers.find(d => d.driverId === request.driver?.driverId)

  res.json({
    ...request,
    driver
  })
})

app.get('/api/requests', (req, res) => {
  res.json(serviceRequests)
})

app.get('/api/drivers', (req, res) => {
  res.json(drivers)
})

app.get('/api/users', (req, res) => {
  res.json({
    riders: users.riders.map(sanitizeRider),
    drivers: users.drivers.map(sanitizeDriver),
    admins: users.admins.map(a => ({
      id: a.id,
      name: a.name,
      email: a.email
    }))
  })
})

app.listen(PORT, () => {
  console.log(`🚖 Server running on port ${PORT}`)
})

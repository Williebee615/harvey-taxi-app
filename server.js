const express = require('express')
const cors = require('cors')
const path = require('path')

const app = express()
const PORT = process.env.PORT || 10000

app.use(cors())
app.use(express.json())
app.use(express.static(path.join(__dirname, 'public')))

let drivers = []
let rideRequests = []

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
    approved: driver.approved === undefined ? false : driver.approved
  }
}

// auto movement
setInterval(() => {
  rideRequests.forEach(ride => {
    if (!ride.driver || !ride.driver.driverId) return

    const driver = drivers.find(d => d.driverId === ride.driver.driverId)
    if (!driver) return

    if (ride.status === 'en_route') {
      const next = moveTowards(driver, ride.pickup)
      driver.lat = next.lat
      driver.lng = next.lng

      if (
        getDistance(driver.lat, driver.lng, ride.pickup.lat, ride.pickup.lng) <
        0.05
      ) {
        ride.status = 'arrived'
      }
    } else if (ride.status === 'arrived') {
      const next = moveTowards(driver, ride.dropoff)
      driver.lat = next.lat
      driver.lng = next.lng

      if (
        getDistance(driver.lat, driver.lng, ride.dropoff.lat, ride.dropoff.lng) <
        0.05
      ) {
        ride.status = 'completed'
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
    return res
      .status(400)
      .json({ error: 'Name, email, and password are required' })
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
  const { name, email, password, carType } = req.body

  if (!name || !email || !password) {
    return res
      .status(400)
      .json({ error: 'Name, email, and password are required' })
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
    approved: false
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
    return res
      .status(403)
      .json({ error: 'Driver account is pending admin approval' })
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
    return res
      .status(400)
      .json({ error: 'driverId, lat, and lng are required' })
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

// request ride
app.post('/api/request-ride', (req, res) => {
  const { riderId, pickup, dropoff, rideType } = req.body

  if (!riderId || !pickup || !dropoff) {
    return res
      .status(400)
      .json({ error: 'riderId, pickup, and dropoff are required' })
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

    const dist = getDistance(pickup.lat, pickup.lng, d.lat, d.lng)
    if (dist < min) {
      min = dist
      nearest = d
    }
  })

  const ride = {
    id: Date.now(),
    riderId,
    pickup,
    dropoff,
    rideType,
    status: nearest ? 'matched' : 'waiting',
    driver: nearest ? { driverId: nearest.driverId } : null,
    distance: nearest ? Number(min.toFixed(2)) : null,
    acceptedBy: null,
    createdAt: new Date().toISOString()
  }

  rideRequests.push(ride)

  res.json({ success: true, ride })
})

// accept ride
app.post('/api/rides/:id/accept', (req, res) => {
  const ride = rideRequests.find(r => r.id == req.params.id)
  const driver = drivers.find(d => d.driverId === req.body.driverId)
  const driverProfile = users.drivers.find(d => d.id === req.body.driverId)

  if (!ride) {
    return res.status(404).json({ error: 'Ride not found' })
  }

  if (!driver) {
    return res.status(404).json({ error: 'Driver not found' })
  }

  if (!driverProfile || !driverProfile.approved || driverProfile.status === 'suspended') {
    return res.status(403).json({ error: 'Driver is not authorized to accept rides' })
  }

  ride.status = 'en_route'
  ride.acceptedBy = driver.driverId
  ride.driver = { driverId: driver.driverId }
  driver.available = false

  res.json({ success: true, message: 'Ride accepted', ride })
})

// admin dashboard
app.get('/api/admin/dashboard', (req, res) => {
  res.json({
    riders: users.riders.map(sanitizeRider),
    drivers: users.drivers.map(sanitizeDriver),
    rides: rideRequests,
    counts: {
      riders: users.riders.length,
      drivers: users.drivers.length,
      rides: rideRequests.length,
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

// general data
app.get('/api/rides/:id', (req, res) => {
  const ride = rideRequests.find(r => r.id == req.params.id)

  if (!ride) {
    return res.status(404).json({ error: 'Ride not found' })
  }

  const driver = drivers.find(d => d.driverId === ride.driver?.driverId)

  res.json({
    ...ride,
    driver
  })
})

app.get('/api/rides', (req, res) => {
  res.json(rideRequests)
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

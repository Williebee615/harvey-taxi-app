const express = require('express')
const cors = require('cors')
const path = require('path')

const app = express()
const PORT = process.env.PORT || 10000

app.use(cors())
app.use(express.json())
app.use(express.static(path.join(__dirname, 'public')))

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@harveytaxi.com'
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'change-me'
const ADMIN_SECRET_PATH = process.env.ADMIN_SECRET_PATH || 'control-center-879'

let drivers = []
let serviceRequests = []

let users = {
  riders: [],
  drivers: [],
  admins: [
    {
      id: 'admin_1',
      name: 'Harvey Admin',
      email: Williebee@harveytaxiservice.com,
      password: Jakurean870$
    }
  ]
}

function getDistance(lat1, lng1, lat2, lng2) {
  const R = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) *
      Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2)

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

app.get('/api/config', (req, res) => {
  res.json({
    adminPath: `/${ADMIN_SECRET_PATH}`
  })
})

app.post('/api/admin/login', (req, res) => {
  const { email, password } = req.body

  if (email === ADMIN_EMAIL && password === ADMIN_PASSWORD) {
    return res.json({
      success: true,
      message: 'Admin login successful',
      redirect: `/${ADMIN_SECRET_PATH}`
    })
  }

  return res.status(401).json({
    success: false,
    message: 'Invalid admin credentials'
  })
})

app.get(`/${ADMIN_SECRET_PATH}`, (req, res) => {
  res.sendFile(path.join(__dirname, 'public/admin.html'))
})

app.get('/api/admin/stats', (req, res) => {
  res.json({
    riders: users.riders.length,
    drivers: users.drivers.length,
    admins: users.admins.length,
    requests: serviceRequests.length,
    activeDrivers: drivers.length
  })
})

app.get('/api/admin/users', (req, res) => {
  res.json({
    riders: users.riders,
    drivers: users.drivers,
    admins: users.admins.map(admin => ({
      id: admin.id,
      name: admin.name,
      email: admin.email
    }))
  })
})

app.get('/api/admin/requests', (req, res) => {
  res.json(serviceRequests)
})

app.post('/api/signup/rider', (req, res) => {
  const { name, email, password } = req.body

  if (!name || !email || !password) {
    return res.status(400).json({ success: false, message: 'Missing fields' })
  }

  const existing = users.riders.find(user => user.email === email)
  if (existing) {
    return res.status(400).json({ success: false, message: 'Rider already exists' })
  }

  const rider = {
    id: `rider_${Date.now()}`,
    name,
    email,
    password
  }

  users.riders.push(rider)

  res.json({
    success: true,
    message: 'Rider signup successful',
    user: {
      id: rider.id,
      name: rider.name,
      email: rider.email
    }
  })
})

app.post('/api/signup/driver', (req, res) => {
  const { name, email, password, vehicle } = req.body

  if (!name || !email || !password) {
    return res.status(400).json({ success: false, message: 'Missing fields' })
  }

  const existing = users.drivers.find(user => user.email === email)
  if (existing) {
    return res.status(400).json({ success: false, message: 'Driver already exists' })
  }

  const driver = {
    id: `driver_${Date.now()}`,
    name,
    email,
    password,
    vehicle: vehicle || 'Not provided'
  }

  users.drivers.push(driver)

  res.json({
    success: true,
    message: 'Driver signup successful',
    user: {
      id: driver.id,
      name: driver.name,
      email: driver.email,
      vehicle: driver.vehicle
    }
  })
})

app.post('/api/login/rider', (req, res) => {
  const { email, password } = req.body
  const rider = users.riders.find(user => user.email === email && user.password === password)

  if (!rider) {
    return res.status(401).json({ success: false, message: 'Invalid rider login' })
  }

  res.json({
    success: true,
    message: 'Rider login successful',
    user: {
      id: rider.id,
      name: rider.name,
      email: rider.email
    }
  })
})

app.post('/api/login/driver', (req, res) => {
  const { email, password } = req.body
  const driver = users.drivers.find(user => user.email === email && user.password === password)

  if (!driver) {
    return res.status(401).json({ success: false, message: 'Invalid driver login' })
  }

  res.json({
    success: true,
    message: 'Driver login successful',
    user: {
      id: driver.id,
      name: driver.name,
      email: driver.email,
      vehicle: driver.vehicle
    }
  })
})

app.post('/api/request-service', (req, res) => {
  const request = {
    id: `request_${Date.now()}`,
    ...req.body,
    createdAt: new Date().toISOString()
  }

  serviceRequests.push(request)
  res.json({ success: true, request })
})

app.post('/api/driver-location', (req, res) => {
  const { driverId, name, lat, lng, vehicle } = req.body

  if (!driverId || lat == null || lng == null) {
    return res.status(400).json({ success: false, message: 'Missing location fields' })
  }

  const existingIndex = drivers.findIndex(driver => driver.driverId === driverId)

  const driverData = {
    driverId,
    name: name || 'Driver',
    lat,
    lng,
    vehicle: vehicle || 'Vehicle',
    updatedAt: new Date().toISOString()
  }

  if (existingIndex >= 0) {
    drivers[existingIndex] = driverData
  } else {
    drivers.push(driverData)
  }

  res.json({ success: true, driver: driverData })
})

app.get('/api/drivers', (req, res) => {
  res.json(drivers)
})

app.get('/api/nearest-driver', (req, res) => {
  const { lat, lng } = req.query

  if (!lat || !lng) {
    return res.status(400).json({ success: false, message: 'Missing coordinates' })
  }

  if (!drivers.length) {
    return res.json({ success: false, message: 'No drivers available' })
  }

  let nearest = null
  let nearestDistance = Infinity

  drivers.forEach(driver => {
    const distance = getDistance(Number(lat), Number(lng), Number(driver.lat), Number(driver.lng))
    if (distance < nearestDistance) {
      nearestDistance = distance
      nearest = { ...driver, distanceKm: distance.toFixed(2) }
    }
  })

  res.json({ success: true, driver: nearest })
})

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'))
})

app.listen(PORT, () => {
  console.log(`Harvey Taxi server running on port ${PORT}`)
})

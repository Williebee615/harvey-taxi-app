const express = require('express')
const cors = require('cors')
const path = require('path')
const Stripe = require('stripe')

const app = express()
const PORT = process.env.PORT || 10000

const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY)
  : null

app.use(cors())
app.use(express.json())
app.use(express.static(path.join(__dirname, 'public')))

let users = {
  riders: [],
  drivers: []
}

let serviceRequests = []
let drivers = [
  {
    id: 'driver_1',
    name: 'Marcus Johnson',
    phone: '(615) 555-1001',
    vehicleType: 'Harvey Standard',
    carModel: 'Toyota Camry',
    carColor: 'Black',
    plateNumber: 'HTX-101',
    lat: 36.1627,
    lng: -86.7816,
    isOnline: true,
    isAvailable: true,
    currentRequestId: null
  },
  {
    id: 'driver_2',
    name: 'Tanya Brooks',
    phone: '(615) 555-1002',
    vehicleType: 'Harvey XL',
    carModel: 'Chevrolet Tahoe',
    carColor: 'White',
    plateNumber: 'HTX-102',
    lat: 36.1699,
    lng: -86.7844,
    isOnline: true,
    isAvailable: true,
    currentRequestId: null
  },
  {
    id: 'driver_3',
    name: 'James Carter',
    phone: '(615) 555-1003',
    vehicleType: 'Delivery',
    carModel: 'Honda Accord',
    carColor: 'Blue',
    plateNumber: 'HTX-103',
    lat: 36.1575,
    lng: -86.7732,
    isOnline: true,
    isAvailable: true,
    currentRequestId: null
  }
]

function createId(prefix) {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 100000)}`
}

function normalizeEmail(email = '') {
  return String(email).trim().toLowerCase()
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

function getServiceAmount(serviceType) {
  switch (serviceType) {
    case 'xl':
      return 1800
    case 'delivery':
      return 1500
    case 'package':
      return 1600
    case 'food':
      return 1400
    case 'grocery':
      return 2000
    case 'ride':
    default:
      return 1200
  }
}

function getDriverCompatibilityScore(driver, request) {
  let score = 0

  if (request.serviceType === 'ride') {
    if (driver.vehicleType.includes('Standard')) score += 5
    if (driver.vehicleType.includes('XL')) score += 3
  }

  if (request.serviceType === 'xl') {
    if (driver.vehicleType.includes('XL')) score += 10
  }

  if (['delivery', 'food', 'package', 'grocery'].includes(request.serviceType)) {
    if (driver.vehicleType.includes('Delivery')) score += 10
    if (driver.vehicleType.includes('Standard')) score += 4
    if (driver.vehicleType.includes('XL')) score += 3
  }

  return score
}

function findNearestDriver(request) {
  const availableDrivers = drivers.filter(driver => driver.isOnline && driver.isAvailable)

  if (!availableDrivers.length) return null

  let bestDriver = null
  let bestScore = -Infinity

  for (const driver of availableDrivers) {
    const distance = getDistance(
      driver.lat,
      driver.lng,
      request.pickupLat,
      request.pickupLng
    )

    const compatibility = getDriverCompatibilityScore(driver, request)
    const score = compatibility - distance

    if (score > bestScore) {
      bestScore = score
      bestDriver = driver
    }
  }

  if (!bestDriver) return null

  const shortest = getDistance(
    bestDriver.lat,
    bestDriver.lng,
    request.pickupLat,
    request.pickupLng
  )

  bestDriver.isAvailable = false
  bestDriver.currentRequestId = request.id

  request.driverId = bestDriver.id
  request.driverName = bestDriver.name
  request.driverPhone = bestDriver.phone
  request.driverVehicle = bestDriver.vehicleType
  request.driverCarModel = bestDriver.carModel
  request.driverCarColor = bestDriver.carColor
  request.driverPlateNumber = bestDriver.plateNumber
  request.driverLat = bestDriver.lat
  request.driverLng = bestDriver.lng
  request.estimatedDistanceKm = Number(shortest.toFixed(2))
  request.status = 'matched'
  request.updatedAt = new Date().toISOString()

  return bestDriver
}

function releaseDriver(request) {
  if (!request || !request.driverId) return

  const driver = drivers.find(item => item.id === request.driverId)
  if (!driver) return

  driver.isAvailable = true
  driver.currentRequestId = null
}

function moveTowards(current, target, step = 0.0025) {
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

function autoAdvanceRequests() {
  const now = Date.now()

  serviceRequests.forEach(request => {
    if (!request.driverId) return

    const createdAtMs = new Date(request.createdAt).getTime()
    const ageMs = now - createdAtMs

    if (request.status === 'matched' && ageMs > 10000) {
      request.status = 'accepted'
      request.updatedAt = new Date().toISOString()
      return
    }

    if (request.status === 'accepted' && ageMs > 25000) {
      request.status = 'in_progress'
      request.updatedAt = new Date().toISOString()
      return
    }

    if (request.status === 'in_progress' && ageMs > 50000) {
      request.status = 'completed'
      request.updatedAt = new Date().toISOString()
      releaseDriver(request)
    }
  })
}

function moveDriversOnActiveTrips() {
  serviceRequests.forEach(request => {
    if (!request.driverId) return
    if (!['matched', 'accepted', 'in_progress'].includes(request.status)) return

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
      target
    )

    driver.lat = nextPosition.lat
    driver.lng = nextPosition.lng
    request.driverLat = driver.lat
    request.driverLng = driver.lng
    request.updatedAt = new Date().toISOString()
  })
}

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    message: 'Harvey Taxi API is live',
    timestamp: new Date().toISOString()
  })
})

app.post('/api/auth/signup', (req, res) => {
  const { name, email, password, phone, role } = req.body

  if (!name || !email || !password || !role) {
    return res.status(400).json({ error: 'Name, email, password, and role are required.' })
  }

  const cleanEmail = normalizeEmail(email)

  if (users.riders.find(u => u.email === cleanEmail) || users.drivers.find(u => u.email === cleanEmail)) {
    return res.status(400).json({ error: 'Account already exists.' })
  }

  const newUser = {
    id: createId(role),
    name,
    email: cleanEmail,
    password,
    phone: phone || '',
    role
  }

  if (role === 'driver') {
    users.drivers.push(newUser)
  } else {
    users.riders.push(newUser)
  }

  res.json({
    message: 'Account created successfully.',
    user: {
      id: newUser.id,
      name: newUser.name,
      email: newUser.email,
      phone: newUser.phone,
      role: newUser.role
    }
  })
})

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body
  const cleanEmail = normalizeEmail(email)

  const user =
    users.riders.find(u => u.email === cleanEmail && u.password === password) ||
    users.drivers.find(u => u.email === cleanEmail && u.password === password)

  if (!user) {
    return res.status(401).json({ error: 'Invalid email or password.' })
  }

  res.json({
    message: 'Login successful.',
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role
    }
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
  if (!driver.currentRequestId) {
    driver.isAvailable = !!isOnline
  }

  res.json({
    message: `Driver is now ${driver.isOnline ? 'online' : 'offline'}.`,
    driver
  })
})

app.post('/api/seed-demo', (req, res) => {
  res.json({
    message: 'Demo drivers already loaded.',
    totalDrivers: drivers.length
  })
})

app.post('/api/requests', (req, res) => {
  const {
    riderId,
    riderName,
    riderPhone,
    pickup,
    destination,
    serviceType,
    notes,
    itemList,
    merchantName,
    dropoffContact,
    deliveryInstructions
  } = req.body

  if (!riderName || !pickup || !destination) {
    return res.status(400).json({ error: 'Rider name, pickup, and destination are required.' })
  }

  const request = {
    id: createId('ride'),
    riderId: riderId || null,
    riderName,
    riderPhone: riderPhone || '',
    pickup,
    destination,
    serviceType: serviceType || 'ride',
    notes: notes || '',
    itemList: itemList || '',
    merchantName: merchantName || '',
    dropoffContact: dropoffContact || '',
    deliveryInstructions: deliveryInstructions || '',
    pickupLat: 36.1627,
    pickupLng: -86.7816,
    destinationLat: 36.1745,
    destinationLng: -86.7679,
    status: 'searching',
    paymentStatus: 'unpaid',
    paymentIntentId: '',
    amount: getServiceAmount(serviceType || 'ride'),
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
  findNearestDriver(request)

  res.json({
    message: 'Service request created.',
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
  const request = serviceRequests.find(item => item.id === req.params.id)

  if (!request) {
    return res.status(404).json({ error: 'Request not found.' })
  }

  request.status = 'accepted'
  request.updatedAt = new Date().toISOString()

  res.json({
    message: 'Request accepted.',
    request
  })
})

app.post('/api/requests/:id/start', (req, res) => {
  const request = serviceRequests.find(item => item.id === req.params.id)

  if (!request) {
    return res.status(404).json({ error: 'Request not found.' })
  }

  request.status = 'in_progress'
  request.updatedAt = new Date().toISOString()

  res.json({
    message: 'Request started.',
    request
  })
})

app.post('/api/requests/:id/complete', (req, res) => {
  const request = serviceRequests.find(item => item.id === req.params.id)

  if (!request) {
    return res.status(404).json({ error: 'Request not found.' })
  }

  request.status = 'completed'
  request.updatedAt = new Date().toISOString()
  releaseDriver(request)

  res.json({
    message: 'Request completed.',
    request
  })
})

app.post('/api/requests/:id/cancel', (req, res) => {
  const request = serviceRequests.find(item => item.id === req.params.id)

  if (!request) {
    return res.status(404).json({ error: 'Request not found.' })
  }

  request.status = 'cancelled'
  request.updatedAt = new Date().toISOString()
  releaseDriver(request)

  res.json({
    message: 'Request cancelled.',
    request
  })
})

app.get('/api/admin/stats', (req, res) => {
  res.json({
    totalRiders: users.riders.length,
    totalDrivers: drivers.length,
    onlineDrivers: drivers.filter(d => d.isOnline).length,
    availableDrivers: drivers.filter(d => d.isOnline && d.isAvailable).length,
    totalRequests: serviceRequests.length,
    activeRequests: serviceRequests.filter(r =>
      ['searching', 'matched', 'accepted', 'in_progress'].includes(r.status)
    ).length
  })
})

app.get('/api/admin/users', (req, res) => {
  res.json({
    riders: users.riders.map(user => ({
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role
    })),
    drivers: users.drivers.map(user => ({
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role
    }))
  })
})

app.get('/api/payments/config', (req, res) => {
  if (!process.env.STRIPE_PUBLISHABLE_KEY) {
    return res.status(500).json({ error: 'Stripe publishable key is missing.' })
  }

  res.json({
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY
  })
})

app.post('/create-payment-intent', async (req, res) => {
  if (!stripe) {
    return res.status(500).json({ error: 'Stripe secret key is missing.' })
  }

  try {
    const { amount } = req.body

    if (!amount || Number(amount) < 50) {
      return res.status(400).json({ error: 'Valid amount is required.' })
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount: Number(amount),
      currency: 'usd',
      automatic_payment_methods: { enabled: true }
    })

    res.json({
      clientSecret: paymentIntent.client_secret
    })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/payments/create-intent', async (req, res) => {
  if (!stripe) {
    return res.status(500).json({ error: 'Stripe secret key is missing.' })
  }

  try {
    const { requestId, riderName, riderEmail, serviceType } = req.body

    if (!requestId) {
      return res.status(400).json({ error: 'Ride request ID is required.' })
    }

    const request = serviceRequests.find(item => item.id === requestId)

    if (!request) {
      return res.status(404).json({ error: 'Ride request not found.' })
    }

    const amount = getServiceAmount(serviceType || request.serviceType)

    const paymentIntent = await stripe.paymentIntents.create({
      amount,
      currency: 'usd',
      automatic_payment_methods: { enabled: true },
      metadata: {
        requestId,
        riderName: riderName || request.riderName || '',
        riderEmail: riderEmail || '',
        serviceType: serviceType || request.serviceType || 'ride'
      }
    })

    request.paymentStatus = 'pending'
    request.paymentIntentId = paymentIntent.id
    request.amount = amount
    request.updatedAt = new Date().toISOString()

    res.json({
      clientSecret: paymentIntent.client_secret,
      amount
    })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Could not create payment intent.' })
  }
})

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'))
})

app.get('/request', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'request.html'))
})

app.get('/payment', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'payment.html'))
})

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'))
})

app.get('/driver', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'driver.html'))
})

setInterval(() => {
  autoAdvanceRequests()
  moveDriversOnActiveTrips()
}, 5000)

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`)
})

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
        totalTrips: 0
      }
    ],
    riders: [],
    rides: [],
    fastFoodOrders: [],
    groceryOrders: [],
    notifications: [],
    emergencies: []
  }
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

    if (!parsed.admins) parsed.admins = []
    if (!parsed.drivers) parsed.drivers = []
    if (!parsed.riders) parsed.riders = []
    if (!parsed.rides) parsed.rides = []
    if (!parsed.fastFoodOrders) parsed.fastFoodOrders = []
    if (!parsed.groceryOrders) parsed.groceryOrders = []
    if (!parsed.notifications) parsed.notifications = []
    if (!parsed.emergencies) parsed.emergencies = []

    return parsed
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

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'))
})

app.get('/ride', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'ride.html'))
})

app.get('/fast-food', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'fast-food.html'))
})

app.get('/grocery', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'grocery.html'))
})

app.get('/rider-signup', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'rider-signup.html'))
})

app.get('/driver-signup', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'driver-signup.html'))
})

app.get('/driver-dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'driver-dashboard.html'))
})

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'))
})

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    message: 'Harvey Taxi API running',
    totals: {
      drivers: db.drivers.length,
      riders: db.riders.length,
      rides: db.rides.length,
      fastFoodOrders: db.fastFoodOrders.length,
      groceryOrders: db.groceryOrders.length,
      emergencies: db.emergencies.length
    }
  })
})

app.post('/api/signup/rider', (req, res) => {
  const { name, email, password, phone } = req.body

  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Name, email, and password are required.' })
  }

  const existing = db.riders.find(r => r.email.toLowerCase() === email.toLowerCase())
  if (existing) {
    return res.status(400).json({ error: 'Rider already exists.' })
  }

  const rider = {
    id: makeId('rider'),
    name,
    email,
    password,
    phone: phone || '',
    verified: false,
    createdAt: new Date().toISOString()
  }

  db.riders.push(rider)
  saveData()

  res.json({
    success: true,
    rider
  })
})

app.post('/api/signup/driver', (req, res) => {
  const { name, email, password, phone, car, plate } = req.body

  if (!name || !email || !password || !car) {
    return res.status(400).json({ error: 'Name, email, password, and car are required.' })
  }

  const existing = db.drivers.find(d => d.email.toLowerCase() === email.toLowerCase())
  if (existing) {
    return res.status(400).json({ error: 'Driver already exists.' })
  }

  const driver = {
    id: makeId('driver'),
    name,
    email,
    password,
    phone: phone || '',
    car,
    plate: plate || '',
    approved: false,
    online: false,
    currentLat: 36.1627,
    currentLng: -86.7816,
    activeRideId: null,
    totalTrips: 0,
    createdAt: new Date().toISOString()
  }

  db.drivers.push(driver)
  saveData()

  res.json({
    success: true,
    message: 'Driver account created. Waiting for admin approval.',
    driver
  })
})

app.get('/api/drivers', (req, res) => {
  const safeDrivers = db.drivers.map(driver => ({
    id: driver.id,
    name: driver.name,
    email: driver.email,
    phone: driver.phone,
    car: driver.car,
    plate: driver.plate,
    approved: driver.approved,
    online: driver.online,
    currentLat: driver.currentLat,
    currentLng: driver.currentLng,
    activeRideId: driver.activeRideId,
    totalTrips: driver.totalTrips
  }))

  res.json(safeDrivers)
})

app.put('/api/drivers/:driverId/location', (req, res) => {
  const { driverId } = req.params
  const { lat, lng } = req.body

  const driver = db.drivers.find(d => d.id === driverId)
  if (!driver) {
    return res.status(404).json({ error: 'Driver not found.' })
  }

  driver.currentLat = Number(lat)
  driver.currentLng = Number(lng)
  saveData()

  res.json({
    success: true,
    driver
  })
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
    destinationLng
  } = req.body

  if (
    !riderName ||
    !pickupAddress ||
    !destinationAddress ||
    pickupLat === undefined ||
    pickupLng === undefined ||
    destinationLat === undefined ||
    destinationLng === undefined
  ) {
    return res.status(400).json({ error: 'Missing required ride request fields.' })
  }

  const nearestDriver = getNearestAvailableDriver(pickupLat, pickupLng)

  if (!nearestDriver) {
    return res.status(400).json({ error: 'No available drivers right now.' })
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
    riderPhone: riderPhone || '',
    pickupAddress,
    destinationAddress,
    pickupLat: Number(pickupLat),
    pickupLng: Number(pickupLng),
    destinationLat: Number(destinationLat),
    destinationLng: Number(destinationLng),
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

  createNotification('admin', 'all', `Ride ${ride.id} status changed to ${status}`)
  saveData()

  res.json({
    success: true,
    ride
  })
})

app.post('/api/fast-food-order', (req, res) => {
  const { customerName, phone, restaurant, items, deliveryAddress } = req.body

  if (!customerName || !restaurant || !deliveryAddress) {
    return res.status(400).json({ error: 'Missing required fast food order fields.' })
  }

  const order = {
    id: makeId('food'),
    customerName,
    phone: phone || '',
    restaurant,
    items: items || '',
    deliveryAddress,
    status: 'pending',
    createdAt: new Date().toISOString()
  }

  db.fastFoodOrders.unshift(order)
  createNotification('admin', 'all', `Fast food order placed: ${restaurant}`)
  saveData()

  res.json({
    success: true,
    order
  })
})

app.get('/api/fast-food-orders', (req, res) => {
  res.json(db.fastFoodOrders)
})

app.post('/api/grocery-order', (req, res) => {
  const { customerName, phone, store, items, deliveryAddress } = req.body

  if (!customerName || !store || !deliveryAddress) {
    return res.status(400).json({ error: 'Missing required grocery order fields.' })
  }

  const order = {
    id: makeId('grocery'),
    customerName,
    phone: phone || '',
    store,
    items: items || '',
    deliveryAddress,
    status: 'pending',
    createdAt: new Date().toISOString()
  }

  db.groceryOrders.unshift(order)
  createNotification('admin', 'all', `Grocery order placed: ${store}`)
  saveData()

  res.json({
    success: true,
    order
  })
})

app.get('/api/grocery-orders', (req, res) => {
  res.json(db.groceryOrders)
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
    ride.emergencyId = emergency.id
  }

  createNotification('admin', 'all', `EMERGENCY ALERT on ride ${rideId || 'unknown'}`)
  saveData()

  res.json({
    success: true,
    emergency
  })
})

app.get('/api/emergencies', (req, res) => {
  res.json(db.emergencies)
})

app.put('/api/emergencies/:emergencyId/resolve', (req, res) => {
  const emergency = db.emergencies.find(e => e.id === req.params.emergencyId)

  if (!emergency) {
    return res.status(404).json({ error: 'Emergency not found.' })
  }

  emergency.status = 'resolved'
  emergency.resolvedAt = new Date().toISOString()

  const ride = emergency.rideId ? findRideById(emergency.rideId) : null
  if (ride) {
    ride.emergencyActive = false
  }

  saveData()

  res.json({
    success: true,
    emergency
  })
})

app.get('/api/notifications', (req, res) => {
  res.json(db.notifications)
})

app.listen(PORT, () => {
  console.log(`Harvey Taxi running on port ${PORT}`)
})

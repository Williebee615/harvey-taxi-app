const express = require('express')
const cors = require('cors')
const path = require('path')

const app = express()
const PORT = process.env.PORT || 10000

app.use(cors())
app.use(express.json())
app.use(express.static(path.join(__dirname, 'public')))


// ===============================
// SAFE ADMIN CONFIG (RESTORED)
// ===============================
const ADMIN_EMAIL =
  process.env.ADMIN_EMAIL ||
  "admin@harveytaxi.com"

const ADMIN_PASSWORD =
  process.env.ADMIN_PASSWORD ||
  "admin123"

const ADMIN_SECRET_PATH =
  process.env.ADMIN_SECRET_PATH ||
  "control-center-879"


// ===============================
// MEMORY STORAGE
// ===============================
let drivers = []
let rides = []
let deliveries = []
let users = {
  riders: [],
  drivers: [],
  admins: []
}


// ===============================
// DISTANCE HELPER
// ===============================
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


// ===============================
// HEALTH CHECK
// ===============================
app.get('/health', (req, res) => {
  res.json({ status: 'Harvey Taxi API Running' })
})


// ===============================
// DRIVER ONLINE UPDATE
// ===============================
app.post('/driver/update', (req, res) => {
  const { id, lat, lng, name, vehicle } = req.body

  let driver = drivers.find(d => d.id === id)

  if (driver) {
    driver.lat = lat
    driver.lng = lng
    driver.online = true
  } else {
    drivers.push({
      id,
      name,
      vehicle,
      lat,
      lng,
      online: true
    })
  }

  res.json({ success: true })
})


// ===============================
// GET DRIVERS
// ===============================
app.get('/drivers', (req, res) => {
  res.json(drivers)
})


// ===============================
// REQUEST RIDE
// ===============================
app.post('/request-ride', (req, res) => {
  const { riderId, pickup, dropoff, lat, lng, service } = req.body

  if (!drivers.length) {
    return res.json({
      success: false,
      message: "No drivers available"
    })
  }

  let nearest = null
  let shortest = Infinity

  drivers.forEach(driver => {
    const distance = getDistance(lat, lng, driver.lat, driver.lng)

    if (distance < shortest) {
      shortest = distance
      nearest = driver
    }
  })

  const ride = {
    id: "ride_" + Date.now(),
    riderId,
    pickup,
    dropoff,
    service: service || "ride",
    driver: nearest,
    status: "assigned",
    created: new Date()
  }

  rides.push(ride)

  res.json({
    success: true,
    ride
  })
})


// ===============================
// REQUEST DELIVERY
// ===============================
app.post('/request-delivery', (req, res) => {
  const { pickup, dropoff, item } = req.body

  const delivery = {
    id: "delivery_" + Date.now(),
    pickup,
    dropoff,
    item,
    status: "pending"
  }

  deliveries.push(delivery)

  res.json({
    success: true,
    delivery
  })
})


// ===============================
// ADMIN LOGIN
// ===============================
app.post('/admin/login', (req, res) => {
  const { email, password } = req.body

  if (email === ADMIN_EMAIL && password === ADMIN_PASSWORD) {
    return res.json({
      success: true,
      token: "admin-authenticated"
    })
  }

  res.status(401).json({
    success: false,
    message: "Invalid admin login"
  })
})


// ===============================
// ADMIN DASHBOARD
// ===============================
app.get(`/${ADMIN_SECRET_PATH}`, (req, res) => {
  res.send(`
    <h1>Harvey Taxi Admin</h1>
    <h2>Drivers: ${drivers.length}</h2>
    <h2>Rides: ${rides.length}</h2>
    <h2>Deliveries: ${deliveries.length}</h2>
  `)
})


// ===============================
// ADMIN DATA
// ===============================
app.get('/admin/data', (req, res) => {
  res.json({
    drivers,
    rides,
    deliveries,
    users
  })
})


// ===============================
// ROOT
// ===============================
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'))
})


// ===============================
app.listen(PORT, () => {
  console.log("Harvey Taxi Server Running on port " + PORT)
})

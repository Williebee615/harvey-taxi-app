const express = require('express')
const cors = require('cors')
const path = require('path')
const fs = require('fs')

const app = express()
const PORT = process.env.PORT || 10000

app.use(cors())
app.use(express.json({ limit: '10mb' }))
app.use(express.static(path.join(__dirname, 'public')))

const DATA_FILE = path.join(__dirname, 'data.json')

function loadData() {
  if (!fs.existsSync(DATA_FILE)) {
    const initial = {
      drivers: [],
      riders: [],
      rides: []
    }
    fs.writeFileSync(DATA_FILE, JSON.stringify(initial, null, 2))
  }
  return JSON.parse(fs.readFileSync(DATA_FILE))
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2))
}

function makeId(prefix) {
  return prefix + '_' + Math.random().toString(36).substr(2, 9)
}

/* =========================
   ROOT
========================= */

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/index.html'))
})

/* =========================
   DRIVER SIGNUP
========================= */

app.post('/signup-driver', (req, res) => {
  const data = loadData()

  const { name, phone, email, vehicle, city } = req.body

  if (!name || !phone || !vehicle) {
    return res.status(400).json({
      error: 'Missing required fields'
    })
  }

  const driver = {
    id: makeId('driver'),
    name,
    phone,
    email,
    vehicle,
    city,
    approved: false,
    verified: false,
    status: 'pending',
    online: false,
    created: new Date()
  }

  data.drivers.push(driver)
  saveData(data)

  res.json({
    success: true,
    message: 'Driver submitted',
    driver
  })
})

/* =========================
   RIDER SIGNUP
========================= */

app.post('/signup-rider', (req, res) => {
  const data = loadData()

  const { name, phone } = req.body

  const rider = {
    id: makeId('rider'),
    name,
    phone,
    created: new Date()
  }

  data.riders.push(rider)
  saveData(data)

  res.json({
    success: true,
    rider
  })
})

/* =========================
   GET DRIVERS
========================= */

app.get('/drivers', (req, res) => {
  const data = loadData()
  res.json(data.drivers)
})

/* =========================
   APPROVE DRIVER
========================= */

app.post('/approve-driver/:id', (req, res) => {
  const data = loadData()

  const driver = data.drivers.find(d => d.id === req.params.id)

  if (!driver) {
    return res.status(404).json({ error: 'Driver not found' })
  }

  driver.approved = true
  driver.status = 'approved'

  saveData(data)

  res.json({
    success: true,
    driver
  })
})

/* =========================
   VERIFY DRIVER (PERSONA)
========================= */

app.post('/verify-driver/:id', (req, res) => {
  const data = loadData()

  const driver = data.drivers.find(d => d.id === req.params.id)

  if (!driver) {
    return res.status(404).json({ error: 'Driver not found' })
  }

  driver.verified = true

  saveData(data)

  res.json({
    success: true,
    driver
  })
})

/* =========================
   REQUEST RIDE
========================= */

app.post('/request-ride', (req, res) => {
  const data = loadData()

  const ride = {
    id: makeId('ride'),
    pickup: req.body.pickup,
    dropoff: req.body.dropoff,
    rider: req.body.rider,
    status: 'waiting',
    created: new Date()
  }

  data.rides.push(ride)
  saveData(data)

  res.json({
    success: true,
    ride
  })
})

/* =========================
   GET RIDES
========================= */

app.get('/rides', (req, res) => {
  const data = loadData()
  res.json(data.rides)
})

/* =========================
   ACCEPT RIDE
========================= */

app.post('/accept-ride/:id', (req, res) => {
  const data = loadData()

  const ride = data.rides.find(r => r.id === req.params.id)

  if (!ride) {
    return res.status(404).json({ error: 'Ride not found' })
  }

  ride.status = 'accepted'
  ride.driver = req.body.driver

  saveData(data)

  res.json({
    success

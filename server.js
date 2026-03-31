const express = require('express')
const cors = require('cors')
const path = require('path')
const fs = require('fs')

const app = express()
const PORT = process.env.PORT || 10000

app.use(cors())
app.use(express.json())

const DATA_FILE = path.join(__dirname, 'data.json')

if (!fs.existsSync(DATA_FILE)) {
  fs.writeFileSync(
    DATA_FILE,
    JSON.stringify(
      {
        rides: [],
        drivers: [],
        riders: []
      },
      null,
      2
    )
  )
}

function readData() {
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'))
}

function writeData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2))
}

app.use(express.static(path.join(__dirname, 'public')))

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'))
})

/* =========================
   DRIVER SIGNUP
========================= */
app.post('/api/driver-signup', (req, res) => {
  const data = readData()

  const driver = {
    id: Date.now().toString(),
    name: req.body.name || '',
    email: req.body.email || '',
    phone: req.body.phone || '',
    city: req.body.city || '',
    vehicle: req.body.vehicle || '',
    license: req.body.license || '',
    notes: req.body.notes || '',
    status: 'pending',
    approved: false,
    online: false,
    currentRideId: '',
    location: null,
    createdAt: new Date().toISOString()
  }

  data.drivers.push(driver)
  writeData(data)

  res.json({
    success: true,
    driver
  })
})

/* =========================
   RIDER SIGNUP
========================= */
app.post('/api/rider-signup', (req, res) => {
  const data = readData()

  const rider = {
    id: Date.now().toString(),
    name: req.body.name || '',
    email: req.body.email || '',
    phone: req.body.phone || '',
    city: req.body.city || '',
    createdAt: new Date().toISOString()
  }

  data.riders.push(rider)
  writeData(data)

  res.json({
    success: true,
    rider
  })
})

/* =========================
   REQUEST RIDE
========================= */
app.post('/api/request-ride', (req, res) => {
  const data = readData()

  const ride = {
    id: Date.now().toString(),
    pickup: req.body.pickup || '',
    dropoff: req.body.dropoff || '',
    rider: req.body.rider || req.body.name || '',
    name: req.body.name || '',
    phone: req.body.phone || '',
    status: 'requested',
    driverId: null,
    assignedDriverName: '',
    created: new Date().toISOString(),
    acceptedAt: '',
    startedAt: '',
    completedAt: ''
  }

  data.rides.push(ride)
  writeData(data)

  res.json({
    success: true,
    ride
  })
})

/* =========================
   GET DATA
========================= */
app.get('/api/rides', (req, res) => {
  const data = readData()
  res.json(data.rides)
})

app.get('/api/drivers', (req, res) => {
  const data = readData()
  res.json(data.drivers)
})

app.get('/api/riders', (req, res) => {
  const data = readData()
  res.json(data.riders)
})

/* =========================
   APPROVE / REJECT DRIVER
========================= */
app.post('/api/approve-driver', (req, res) => {
  const { id } = req.body
  const data = readData()

  const driver = data.drivers.find(d => String(d.id) === String(id))

  if (!driver) {
    return res.status(404).json({ error: 'Driver not found' })
  }

  driver.approved = true
  driver.status = 'approved'

  writeData(data)
  res.json({ success: true, driver })
})

app.post('/api/reject-driver', (req, res) => {
  const { id } = req.body
  const data = readData()

  const driver = data.drivers.find(d => String(d.id) === String(id))

  if (!driver) {
    return res.status(404).json({ error: 'Driver not found' })
  }

  driver.approved = false
  driver.status = 'rejected'
  driver.online = false

  writeData(data)
  res.json({ success: true, driver })
})

/* =========================
   DRIVER ONLINE / OFFLINE
========================= */
app.post('/api/toggle-driver-online', (req, res) => {
  const { driverId } = req.body
  const data = readData()

  const driver = data.drivers.find(d => String(d.id) === String(driverId))

  if (!driver) {
    return res.status(404).json({ error: 'Driver not found' })
  }

  if (!driver.approved && driver.status !== 'approved') {
    return res.status(400).json({ error: 'Driver must be approved first' })
  }

  driver.online = !driver.online

  writeData(data)
  res.json({ success: true, driver })
})

/* =========================
   ASSIGN DRIVER
========================= */
app.post('/api/assign-driver', (req, res) => {
  const { rideId, driverId } = req.body
  const data = readData()

  const ride = data.rides.find(r => String(r.id) === String(rideId))
  const driver = data.drivers.find(d => String(d.id) === String(driverId))

  if (!ride) return res.status(404).json({ error: 'Ride not found' })
  if (!driver) return res.status(404).json({ error: 'Driver not found' })

  ride.driverId = driverId
  ride.assignedDriverName = driver.name || 'Driver'
  ride.status = 'assigned'

  driver.currentRideId = rideId
  driver.online = false

  writeData(data)
  res.json({ success: true, ride })
})

/* =========================
   DRIVER ACCEPT
========================= */
app.post('/api/driver-accept', (req, res) => {
  const { rideId } = req.body
  const data = readData()

  const ride = data.rides.find(r => String(r.id) === String(rideId))

  if (!ride) return res.status(404).json({ error: 'Ride not found' })

  ride.status = 'enroute'
  ride.acceptedAt = new Date().toISOString()

  writeData(data)
  res.json({ success: true, ride })
})

/* =========================
   START TRIP
========================= */
app.post('/api/start-trip', (req, res) => {
  const { rideId } = req.body
  const data = readData()

  const ride = data.rides.find(r => String(r.id) === String(rideId))

  if (!ride) return res.status(404).json({ error: 'Ride not found' })

  ride.status = 'in_progress'
  ride.startedAt = new Date().toISOString()

  writeData(data)
  res.json({ success: true, ride })
})

/* =========================
   COMPLETE TRIP
========================= */
app.post('/api/complete-trip', (req, res) => {
  const { rideId } = req.body
  const data = readData()

  const ride = data.rides.find(r => String(r.id) === String(rideId))

  if (!ride) return res.status(404).json({ error: 'Ride not found' })

  ride.status = 'completed'
  ride.completedAt = new Date().toISOString()

  const driver = data.drivers.find(d => String(d.id) === String(ride.driverId))
  if (driver) {
    driver.currentRideId = ''
    driver.online = true
  }

  writeData(data)
  res.json({ success: true, ride })
})

/* =========================
   UPDATE DRIVER LOCATION
========================= */
app.post('/api/update-driver-location', (req, res) => {
  const { driverId, lat, lng } = req.body
  const data = readData()

  const driver = data.drivers.find(d => String(d.id) === String(driverId))

  if (!driver) {
    return res.status(404).json({ error: 'Driver not found' })
  }

  driver.location = {
    lat: Number(lat),
    lng: Number(lng),
    updatedAt: new Date().toISOString()
  }

  writeData(data)

  res.json({
    success: true,
    location: driver.location
  })
})

/* =========================
   GET DRIVER LOCATION
========================= */
app.get('/api/driver-location/:driverId', (req, res) => {
  const { driverId } = req.params
  const data = readData()

  const driver = data.drivers.find(d => String(d.id) === String(driverId))

  if (!driver) {
    return res.status(404).json({ error: 'Driver not found' })
  }

  res.json({
    success: true,
    location: driver.location || null
  })
})

app.listen(PORT, () => {
  console.log('Server running on port', PORT)
})

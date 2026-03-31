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

const ADMIN_EMAIL = 'admin@harveytaxi.com'
const ADMIN_PASSWORD = 'HarveyAdmin123'

function ensureDataFile() {
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
}

function readData() {
  ensureDataFile()
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'))
}

function writeData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2))
}

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'))
})

app.post('/api/admin-login', (req, res) => {
  const { email, password } = req.body || {}

  if (email === ADMIN_EMAIL && password === ADMIN_PASSWORD) {
    return res.json({ success: true })
  }

  return res.status(401).json({ success: false })
})

app.post('/api/rider-signup', (req, res) => {
  const data = readData()

  const rider = {
    id: Date.now().toString(),
    ...req.body,
    created: new Date().toISOString()
  }

  data.riders.push(rider)
  writeData(data)

  return res.json({ success: true, rider })
})

app.post('/api/driver-signup', (req, res) => {
  const data = readData()

  const driver = {
    id: Date.now().toString(),
    ...req.body,
    approved: true,
    online: false,
    currentRide: null,
    created: new Date().toISOString()
  }

  data.drivers.push(driver)
  writeData(data)

  return res.json({ success: true, driver })
})

app.post('/api/request-ride', (req, res) => {
  const data = readData()

  const ride = {
    id: Date.now().toString(),
    ...req.body,
    status: 'requested',
    driverId: null,
    driverName: '',
    acceptedAt: '',
    startedAt: '',
    completedAt: '',
    created: new Date().toISOString()
  }

  data.rides.push(ride)
  writeData(data)

  return res.json({ success: true, ride })
})

app.get('/api/rides', (req, res) => {
  const data = readData()
  return res.json(data.rides)
})

app.get('/api/drivers', (req, res) => {
  const data = readData()
  return res.json(data.drivers)
})

app.get('/api/riders', (req, res) => {
  const data = readData()
  return res.json(data.riders)
})

app.post('/api/driver-online', (req, res) => {
  const { driverId, online } = req.body || {}
  const data = readData()

  const driver = data.drivers.find(d => String(d.id) === String(driverId))

  if (!driver) {
    return res.status(404).json({ success: false, message: 'Driver not found' })
  }

  driver.online = !!online
  writeData(data)

  return res.json({ success: true, driver })
})

app.post('/api/auto-dispatch', (req, res) => {
  const { rideId } = req.body || {}
  const data = readData()

  const ride = data.rides.find(r => String(r.id) === String(rideId))
  const driver = data.drivers.find(d => d.online === true)

  if (!ride) {
    return res.status(404).json({ matched: false, message: 'Ride not found' })
  }

  if (!driver) {
    return res.json({ matched: false, message: 'No online driver available' })
  }

  ride.driverId = driver.id
  ride.driverName = driver.name || ''
  ride.status = 'assigned'

  driver.currentRide = ride.id
  driver.online = false

  writeData(data)

  return res.json({ matched: true, ride, driver })
})

app.post('/api/assign-driver', (req, res) => {
  const { rideId, driverId } = req.body || {}
  const data = readData()

  const ride = data.rides.find(r => String(r.id) === String(rideId))
  const driver = data.drivers.find(d => String(d.id) === String(driverId))

  if (!ride) {
    return res.status(404).json({ success: false, message: 'Ride not found' })
  }

  if (!driver) {
    return res.status(404).json({ success: false, message: 'Driver not found' })
  }

  ride.driverId = driver.id
  ride.driverName = driver.name || ''
  ride.status = 'assigned'

  driver.currentRide = ride.id
  driver.online = false

  writeData(data)

  return res.json({ success: true, ride, driver })
})

app.get('/api/driver-trip/:driverId', (req, res) => {
  const { driverId } = req.params
  const data = readData()

  const driver = data.drivers.find(d => String(d.id) === String(driverId))

  if (!driver) {
    return res.status(404).json({ success: false, message: 'Driver not found' })
  }

  const ride = data.rides.find(r => String(r.driverId) === String(driverId) && r.status !== 'completed')

  if (!ride) {
    return res.json({ success: true, ride: null })
  }

  return res.json({ success: true, ride })
})

app.post('/api/driver-accept', (req, res) => {
  const { rideId, driverId } = req.body || {}
  const data = readData()

  const ride = data.rides.find(r => String(r.id) === String(rideId))
  const driver = data.drivers.find(d => String(d.id) === String(driverId))

  if (!ride) {
    return res.status(404).json({ success: false, message: 'Ride not found' })
  }

  if (!driver) {
    return res.status(404).json({ success: false, message: 'Driver not found' })
  }

  ride.status = 'accepted'
  ride.acceptedAt = new Date().toISOString()

  driver.currentRide = ride.id
  driver.online = false

  writeData(data)

  return res.json({ success: true, ride })
})

app.post('/api/start-trip', (req, res) => {
  const { rideId, driverId } = req.body || {}
  const data = readData()

  const ride = data.rides.find(r => String(r.id) === String(rideId))
  const driver = data.drivers.find(d => String(d.id) === String(driverId))

  if (!ride) {
    return res.status(404).json({ success: false, message: 'Ride not found' })
  }

  if (!driver) {
    return res.status(404).json({ success: false, message: 'Driver not found' })
  }

  ride.status = 'enroute'
  ride.startedAt = new Date().toISOString()

  writeData(data)

  return res.json({ success: true, ride })
})

app.post('/api/complete-trip', (req, res) => {
  const { rideId, driverId } = req.body || {}
  const data = readData()

  const ride = data.rides.find(r => String(r.id) === String(rideId))
  const driver = data.drivers.find(d => String(d.id) === String(driverId))

  if (!ride) {
    return res.status(404).json({ success: false, message: 'Ride not found' })
  }

  if (!driver) {
    return res.status(404).json({ success: false, message: 'Driver not found' })
  }

  ride.status = 'completed'
  ride.completedAt = new Date().toISOString()

  driver.currentRide = null
  driver.online = true

  writeData(data)

  return res.json({ success: true, ride, driver })
})

app.listen(PORT, () => {
  console.log('Server running on port', PORT)
})

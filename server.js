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
    return res.json({
      success: true,
      token: 'admin-token'
    })
  }

  return res.status(401).json({
    success: false,
    message: 'Invalid login'
  })
})

app.post('/api/rider-signup', (req, res) => {
  const data = readData()

  const rider = {
    id: Date.now().toString(),
    name: req.body.name || '',
    email: req.body.email || '',
    phone: req.body.phone || '',
    createdAt: new Date().toISOString()
  }

  data.riders.push(rider)
  writeData(data)

  return res.json({
    success: true,
    rider
  })
})

app.post('/api/driver-signup', (req, res) => {
  const data = readData()

  const driver = {
    id: Date.now().toString(),
    name: req.body.name || '',
    email: req.body.email || '',
    phone: req.body.phone || '',
    vehicle: req.body.vehicle || '',
    city: req.body.city || '',
    license: req.body.license || '',
    approved: true,
    status: 'approved',
    online: false,
    location: null,
    currentRide: null,
    createdAt: new Date().toISOString()
  }

  data.drivers.push(driver)
  writeData(data)

  return res.json({
    success: true,
    driver
  })
})

app.post('/api/request-ride', (req, res) => {
  const data = readData()

  const ride = {
    id: Date.now().toString(),
    rideType: req.body.rideType || 'scheduled_local',
    pickup: req.body.pickup || '',
    dropoff: req.body.dropoff || '',
    rider: req.body.rider || req.body.name || '',
    name: req.body.name || '',
    phone: req.body.phone || '',
    passengerCount: Number(req.body.passengerCount || 1),
    luggageCount: Number(req.body.luggageCount || 0),
    airline: req.body.airline || '',
    flightNumber: req.body.flightNumber || '',
    scheduledDate: req.body.scheduledDate || '',
    scheduledTime: req.body.scheduledTime || '',
    scheduled: !!(req.body.scheduledDate || req.body.scheduledTime),
    bookingLeadStatus: req.body.scheduledDate || req.body.scheduledTime ? 'scheduled' : 'asap',
    status: 'requested',
    lifecycleStage: 'request_intake',
    driverId: null,
    assignedDriverName: '',
    backupDriverName: '',
    autoAssigned: false,
    autoAssignedDistanceMiles: null,
    driverConfirmed24h: false,
    riderConfirmed24h: false,
    driverConfirmed2h: false,
    riderConfirmed2h: false,
    driverAlertSeen: false,
    driver24hAlertSent: false,
    driver2hAlertSent: false,
    fare: {
      baseFare: 

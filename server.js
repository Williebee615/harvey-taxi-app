const express = require('express')
const cors = require('cors')
const fs = require('fs')
const path = require('path')

const app = express()
const PORT = process.env.PORT || 10000
const DATA_FILE = path.join(__dirname, 'data.json')

app.use(cors())
app.use(express.json())
app.use(express.static(path.join(__dirname, 'public')))

function loadData() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      return { drivers: [], rides: [] }
    }

    const raw = fs.readFileSync(DATA_FILE, 'utf8')
    if (!raw.trim()) {
      return { drivers: [], rides: [] }
    }

    return JSON.parse(raw)
  } catch (error) {
    console.error('loadData error:', error.message)
    return { drivers: [], rides: [] }
  }
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2))
}

function getOrCreateDriver(data, driverId, driverName = 'Auto Driver') {
  let driver = data.drivers.find(d => d.id === driverId)

  if (!driver) {
    driver = {
      id: driverId,
      name: driverName,
      wallet: 0,
      totalEarnings: 0,
      totalTrips: 0
    }
    data.drivers.push(driver)
  }

  return driver
}

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'))
})

app.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'Harvey Taxi autonomous server is running'
  })
})

app.post('/api/rides/create', (req, res) => {
  try {
    const { riderName, pickup, dropoff, fare, driverId, driverName } = req.body

    if (!driverId || fare === undefined) {
      return res.status(400).json({
        success: false,
        message: 'driverId and fare are required'
      })
    }

    const numericFare = Number(fare)
    if (Number.isNaN(numericFare) || numericFare < 0) {
      return res.status(400).json({
        success: false,
        message: 'fare must be a valid number'
      })
    }

    const data = loadData()
    getOrCreateDriver(data, driverId, driverName || 'Auto Driver')

    const ride = {
      id: `ride_${Date.now()}`,
      riderName: riderName || 'Rider',
      pickup: pickup || '',
      dropoff: dropoff || '',
      fare: numericFare,
      driverId,
      status: 'assigned',
      createdAt: new Date().toISOString(),
      completedAt: null
    }

    data.rides.push(ride)
    saveData(data)

    res.json({
      success: true,
      ride
    })
  } catch (error) {
    console.error('create ride error:', error.message)
    res.status(500).json({
      success: false,
      message: 'Failed to create ride'
    })
  }
})

app.post('/api/rides/complete', (req, res) => {
  try {
    const { rideId } = req

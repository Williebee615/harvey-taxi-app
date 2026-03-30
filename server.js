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
      return {
        drivers: [],
        rides: []
      }
    }

    const raw = fs.readFileSync(DATA_FILE, 'utf8')
    if (!raw.trim()) {
      return {
        drivers: [],
        rides: []
      }
    }

    return JSON.parse(raw)
  } catch (error) {
    console.error('loadData error:', error.message)
    return {
      drivers: [],
      rides: []
    }
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

app.post('/api/drivers/register', (req, res) => {
  try {
    const { id, name } = req.body

    if (!id) {
      return res.status(400).json({
        success: false,
        message: 'Driver id is required'
      })
    }

    const data = loadData()
    const driver = getOrCreateDriver(data, id, name || 'Auto Driver')

    saveData(data)

    res.json({
      success: true,
      driver
    })
  } catch (error) {
    console.error('register driver error:', error.message)
    res.status(500).json({
      success: false,
      message: 'Failed to register driver'
    })
  }
})

app.post('/api/rides/create', (req, res) => {
  try {
    const {
      riderName,
      pickup,
      dropoff,
      fare,
      driverId,
      driverName
    } = req.body

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
    const { rideId } = req.body

    if (!rideId) {
      return res.status(400).json({
        success: false,
        message: 'rideId is required'
      })
    }

    const data = loadData()
    const ride = data.rides.find(r => r.id === rideId)

    if (!ride) {
      return res.status(404).json({
        success: false,
        message: 'Ride not found'
      })
    }

    if (ride.status === 'completed') {
      const existingDriver = data.drivers.find(d => d.id === ride.driverId)

      return res.json({
        success: true,
        message: 'Ride already completed',
        ride,
        wallet: existingDriver ? existingDriver.wallet : 0
      })
    }

    const driver = getOrCreateDriver(data, ride.driverId)

    const platformFee = Number((ride.fare * 0.20).toFixed(2))
    const driverEarnings = Number((ride.fare - platformFee).toFixed(2))

    ride.status = 'completed'
    ride.completedAt = new Date().toISOString()
    ride.platformFee = platformFee
    ride.driverEarnings = driverEarnings

    driver.wallet = Number((Number(driver.wallet || 0) + driverEarnings).toFixed(2))
    driver.totalEarnings = Number((Number(driver.totalEarnings || 0) + driverEarnings).toFixed(2))
    driver.totalTrips = Number(driver.totalTrips || 0) + 1

    saveData(data)

    res.json({
      success: true,
      ride,
      driver: {
        id: driver.id,
        name: driver.name,
        wallet: driver.wallet,
        totalEarnings: driver.totalEarnings,
        totalTrips: driver.totalTrips
      }
    })
  } catch (error) {
    console.error('complete ride error:', error.message)
    res.status(500).json({
      success: false,
      message: 'Failed to complete ride'
    })
  }
})

app.get('/api/driver/wallet/:driverId', (req, res) => {
  try {
    const { driverId } = req.params
    const data = loadData()
    const driver = data.drivers.find(d => d.id === driverId)

    if (!driver) {
      return res.json({
        success: true,
        wallet: 0,
        totalEarnings: 0,
        totalTrips: 0
      })
    }

    res.json({
      success: true,
      wallet: Number(driver.wallet || 0),
      totalEarnings: Number(driver.totalEarnings || 0),
      totalTrips: Number(driver.totalTrips || 0)
    })
  } catch (error) {
    console.error('wallet error:', error.message)
    res.status(500).json({
      success: false,
      message: 'Failed to load wallet'
    })
  }
})

app.get('/api/rides', (req, res) => {
  try {
    const data = loadData()
    res.json({
      success: true,
      rides: data.rides
    })
  } catch (error) {
    console.error('rides list error:', error.message)
    res.status(500).json({
      success: false,
      message: 'Failed to load rides'
    })
  }
})

app.listen(PORT, () => {
  console.log(`Harvey Taxi autonomous server running on port ${PORT}`)
})

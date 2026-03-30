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

function defaultData() {
  return {
    drivers: [],
    rides: [],
    company: {
      totalRevenue: 0,
      totalCompletedRides: 0
    }
  }
}

function loadData() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      return defaultData()
    }

    const raw = fs.readFileSync(DATA_FILE, 'utf8')
    if (!raw.trim()) {
      return defaultData()
    }

    const parsed = JSON.parse(raw)

    if (!parsed.company) {
      parsed.company = {
        totalRevenue: 0,
        totalCompletedRides: 0
      }
    }

    if (!parsed.drivers) parsed.drivers = []
    if (!parsed.rides) parsed.rides = []

    return parsed
  } catch (error) {
    console.error('loadData error:', error.message)
    return defaultData()
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
      totalTrips: 0,
      totalEarnings: 0,
      status: 'active'
    }
    data.drivers.push(driver)
  }

  return driver
}

app.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'Harvey Taxi server is running'
  })
})

app.get('/api/rides', (req, res) => {
  const data = loadData()
  res.json({
    success: true,
    rides: data.rides
  })
})

app.get('/api/company/stats', (req, res) => {
  const data = loadData()

  res.json({
    success: true,
    totalRevenue: data.company.totalRevenue,
    totalCompletedRides: data.company.totalCompletedRides,
    totalDrivers: data.drivers.length,
    totalRides: data.rides.length
  })
})

app.get('/api/driver/wallet/:driverId', (req, res) => {
  const data = loadData()
  const driver = data.drivers.find(d => d.id === req.params.driverId)

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
      phone,
      pickup,
      dropoff,
      fare,
      driverId,
      driverName
    } = req.body

    if (!pickup || !dropoff || fare === undefined) {
      return res.status(400).json({
        success: false,
        message: 'pickup, dropoff, and fare are required'
      })
    }

    const numericFare = Number(fare)

    if (Number.isNaN(numericFare) || numericFare <= 0) {
      return res.status(400).json({
        success: false,
        message: 'fare must be a valid number greater than 0'
      })
    }

    const data = loadData()

    const assignedDriverId = driverId || 'driver_1'
    getOrCreateDriver(data, assignedDriverId, driverName || 'Auto Driver')

    const ride = {
      id: 'ride_' + Date.now(),
      riderName: riderName || 'Rider',
      phone: phone || '',
      pickup,
      dropoff,
      fare: numericFare,
      driverId: assignedDriverId,
      status: 'assigned',
      createdAt: new Date().toISOString(),
      completedAt: null,
      platformFee: 0,
      driverPay: 0
    }

    data.rides.unshift(ride)
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

    const driver = getOrCreateDriver(data, ride.driverId)

    if (ride.status === 'completed') {
      return res.json({
        success: true,
        message: 'Ride already completed',
        driverWallet: driver.wallet
      })
    }

    const platformFee = Number((ride.fare * 0.20).toFixed(2))
    const driverPay = Number((ride.fare - platformFee).toFixed(2))

    ride.status = 'completed'
    ride.completedAt = new Date().toISOString()
    ride.platformFee = platformFee
    ride.driverPay = driverPay

    driver.wallet = Number((driver.wallet + driverPay).toFixed(2))
    driver.totalTrips += 1
    driver.totalEarnings = Number((driver.totalEarnings + driverPay).toFixed(2))

    data.company.totalRevenue = Number((data.company.totalRevenue + platformFee).toFixed(2))
    data.company.totalCompletedRides += 1

    saveData(data)

    res.json({
      success: true,
      ride,
      driverWallet: driver.wallet,
      companyRevenue: data.company.totalRevenue
    })
  } catch (error) {
    console.error('complete ride error:', error.message)
    res.status(500).json({
      success: false,
      message: 'Failed to complete ride'
    })
  }
})

app.listen(PORT, () => {
  console.log(`Harvey Taxi server running on port ${PORT}`)
})

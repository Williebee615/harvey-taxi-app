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
    users: [],
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

    if (!parsed.users) parsed.users = []
    if (!parsed.drivers) parsed.drivers = []
    if (!parsed.rides) parsed.rides = []
    if (!parsed.company) {
      parsed.company = {
        totalRevenue: 0,
        totalCompletedRides: 0
      }
    }

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

function findRide(data, rideId) {
  return data.rides.find(r => r.id === rideId)
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

app.get('/api/rides/open', (req, res) => {
  const data = loadData()
  const openRides = data.rides.filter(
    r => r.status !== 'completed' && r.status !== 'cancelled'
  )

  res.json({
    success: true,
    rides: openRides
  })
})

app.get('/api/company/stats', (req, res) => {
  const data = loadData()

  res.json({
    success: true,
    totalRevenue: data.company.totalRevenue,
    totalCompletedRides: data.company.totalCompletedRides,
    totalDrivers: data.drivers.length,
    totalUsers: data.users.length,
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

app.get('/api/admin/drivers', (req, res) => {
  const data = loadData()
  res.json({
    success: true,
    drivers: data.drivers
  })
})

app.post('/api/rider/signup', (req, res) => {
  try {
    const { name, phone, email, password } = req.body

    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        message: 'name, email, and password are required'
      })
    }

    const data = loadData()

    const existing = data.users.find(
      u => u.email.toLowerCase() === email.toLowerCase()
    )

    if (existing) {
      return res.status(400).json({
        success: false,
        message: 'Email already exists'
      })
    }

    const user = {
      id: 'rider_' + Date.now(),
      name,
      phone: phone || '',
      email,
      password,
      role: 'rider',
      createdAt: new Date().toISOString()
    }

    data.users.push(user)
    saveData(data)

    res.json({
      success: true,
      user
    })
  } catch (error) {
    console.error('rider signup error:', error.message)
    res.status(500).json({
      success: false,
      message: 'Failed to create rider account'
    })
  }
})

app.post('/api/driver/signup', (req, res) => {
  try {
    const { name, phone, email, password, vehicle, plate } = req.body

    if (!name || !email || !password || !vehicle) {
      return res.status(400).json({
        success: false,
        message: 'name, email, password, and vehicle are required'
      })
    }

    const data = loadData()

    const existing = data.users.find(
      u => u.email.toLowerCase() === email.toLowerCase()
    )

    if (existing) {
      return res.status(400).json({
        success: false,
        message: 'Email already exists'
      })
    }

    const userId = 'driver_' + Date.now()

    const user = {
      id: userId,
      name,
      phone: phone || '',
      email,
      password,
      role: 'driver',
      approvalStatus: 'pending',
      createdAt: new Date().toISOString()
    }

    const driver = {
      id: userId,
      name,
      phone: phone || '',
      email,
      vehicle,
      plate: plate || '',
      wallet: 0,
      totalTrips: 0,
      totalEarnings: 0,
      status: 'pending'
    }

    data.users.push(user)
    data.drivers.push(driver)
    saveData(data)

    res.json({
      success: true,
      message: 'Driver signup submitted. Waiting for admin approval.',
      user,
      driver
    })
  } catch (error) {
    console.error('driver signup error:', error.message)
    res.status(500).json({
      success: false,
      message: 'Failed to create driver account'
    })
  }
})

app.post('/api/login', (req, res) => {
  try {
    const { email, password } = req.body
    const data = loadData()

    const user = data.users.find(
      u =>
        u.email.toLowerCase() === String(email).toLowerCase() &&
        u.password === password
    )

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      })
    }

    if (user.role === 'driver' && user.approvalStatus !== 'approved') {
      return res.status(403).json({
        success: false,
        message: 'Driver account is pending approval'
      })
    }

    res.json({
      success: true,
      user
    })
  } catch (error) {
    console.error('login error:', error.message)
    res.status(500).json({
      success: false,
      message: 'Login failed'
    })
  }
})

app.post('/api/admin/create', (req, res) => {
  try {
    const { name, email, password } = req.body
    const data = loadData()

    const existing = data.users.find(
      u => u.email.toLowerCase() === String(email).toLowerCase()
    )

    if (existing) {
      return res.status(400).json({
        success: false,
        message: 'Admin already exists'
      })
    }

    const admin = {
      id: 'admin_' + Date.now(),
      name: name || 'Admin',
      email,
      password,
      role: 'admin',
      createdAt: new Date().toISOString()
    }

    data.users.push(admin)
    saveData(data)

    res.json({
      success: true,
      admin
    })
  } catch (error) {
    console.error('admin create error:', error.message)
    res.status(500).json({
      success: false,
      message: 'Failed to create admin'
    })
  }
})

app.post('/api/admin/approve-driver', (req, res) => {
  try {
    const { driverId } = req.body
    const data = loadData()

    const driver = data.drivers.find(d => d.id === driverId)
    const user = data.users.find(u => u.id === driverId && u.role === 'driver')

    if (!driver || !user) {
      return res.status(404).json({
        success: false,
        message: 'Driver not found'
      })
    }

    driver.status = 'active'
    user.approvalStatus = 'approved'

    saveData(data)

    res.json({
      success: true,
      message: 'Driver approved successfully',
      driver
    })
  } catch (error) {
    console.error('approve driver error:', error.message)
    res.status(500).json({
      success: false,
      message: 'Failed to approve driver'
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
      fare
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

    const ride = {
      id: 'ride_' + Date.now(),
      riderName: riderName || 'Rider',
      phone: phone || '',
      pickup,
      dropoff,
      fare: numericFare,
      driverId: null,
      status: 'pending',
      createdAt: new Date().toISOString(),
      acceptedAt: null,
      arrivedAt: null,
      pickedUpAt: null,
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

app.post('/api/rides/accept', (req, res) => {
  try {
    const { rideId, driverId, driverName } = req.body

    if (!rideId || !driverId) {
      return res.status(400).json({
        success: false,
        message: 'rideId and driverId are required'
      })
    }

    const data = loadData()
    const ride = findRide(data, rideId)

    if (!ride) {
      return res.status(404).json({
        success: false,
        message: 'Ride not found'
      })
    }

    if (ride.status === 'completed') {
      return res.status(400).json({
        success: false,
        message: 'Ride already completed'
      })
    }

    const driver = getOrCreateDriver(data, driverId, driverName || 'Auto Driver')

    ride.driverId = driver.id
    ride.status = 'assigned'
    ride.acceptedAt = new Date().toISOString()

    saveData(data)

    res.json({
      success: true,
      ride
    })
  } catch (error) {
    console.error('accept ride error:', error.message)
    res.status(500).json({
      success: false,
      message: 'Failed to accept ride'
    })
  }
})

app.post('/api/rides/decline', (req, res) => {
  try {
    const { rideId } = req.body

    if (!rideId) {
      return res.status(400).json({
        success: false,
        message: 'rideId is required'
      })
    }

    const data = loadData()
    const ride = findRide(data, rideId)

    if (!ride) {
      return res.status(404).json({
        success: false,
        message: 'Ride not found'
      })
    }

    ride.driverId = null
    ride.status = 'pending'

    saveData(data)

    res.json({
      success: true,
      ride
    })
  } catch (error) {
    console.error('decline ride error:', error.message)
    res.status(500).json({
      success: false,
      message: 'Failed to decline ride'
    })
  }
})

app.post('/api/rides/arrived', (req, res) => {
  try {
    const { rideId } = req.body

    const data = loadData()
    const ride = findRide(data, rideId)

    if (!ride) {
      return res.status(404).json({
        success: false,
        message: 'Ride not found'
      })
    }

    ride.status = 'arrived'
    ride.arrivedAt = new Date().toISOString()

    saveData(data)

    res.json({
      success: true,
      ride
    })
  } catch (error) {
    console.error('arrived error:', error.message)
    res.status(500).json({
      success: false,
      message: 'Failed to update ride'
    })
  }
})

app.post('/api/rides/pickup', (req, res) => {
  try {
    const { rideId } = req.body

    const data = loadData()
    const ride = findRide(data, rideId)

    if (!ride) {
      return res.status(404).json({
        success: false,
        message: 'Ride not found'
      })
    }

    ride.status = 'in_progress'
    ride.pickedUpAt = new Date().toISOString()

    saveData(data)

    res.json({
      success: true,
      ride
    })
  } catch (error) {
    console.error('pickup error:', error.message)
    res.status(500).json({
      success: false,
      message: 'Failed to update ride'
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
    const ride = findRide(data, rideId)

    if (!ride) {
      return res.status(404).json({
        success: false,
        message: 'Ride not found'
      })
    }

    if (!ride.driverId) {
      return res.status(400).json({
        success: false,
        message: 'Ride has no assigned driver'
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

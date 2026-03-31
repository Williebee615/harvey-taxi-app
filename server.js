const express = require('express')
const cors = require('cors')
const fs = require('fs')
const path = require('path')

const app = express()
const PORT = process.env.PORT || 10000

app.use(cors())
app.use(express.json())
app.use(express.static(path.join(__dirname, 'public')))

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@harveytaxi.com'
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'HarveyAdmin123!'

const driversFile = path.join(__dirname, 'drivers.json')
const ridersFile = path.join(__dirname, 'riders.json')
const ridesFile = path.join(__dirname, 'rides.json')

function ensureFile(filePath) {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, '[]', 'utf8')
  }
}

function readJson(filePath) {
  ensureFile(filePath)

  try {
    const raw = fs.readFileSync(filePath, 'utf8').trim()
    if (!raw) return []
    return JSON.parse(raw)
  } catch (err) {
    return []
  }
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8')
}

ensureFile(driversFile)
ensureFile(ridersFile)
ensureFile(ridesFile)

// HOME
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'))
})

// ADMIN LOGIN
app.post('/api/admin-login', (req, res) => {
  const { email, password } = req.body || {}

  if (email === ADMIN_EMAIL && password === ADMIN_PASSWORD) {
    return res.json({
      success: true,
      message: 'Admin login successful'
    })
  }

  return res.status(401).json({
    success: false,
    message: 'Invalid admin login'
  })
})

// DRIVER SIGNUP
app.post('/api/driver-signup', (req, res) => {
  try {
    const body = req.body || {}

    const newDriver = {
      id: body.id || Date.now().toString(),
      name: body.name || '',
      email: body.email || '',
      phone: body.phone || '',
      city: body.city || '',
      vehicle: body.vehicle || '',
      license: body.license || '',
      notes: body.notes || '',
      approved: false,
      status: 'pending',
      online: false,
      currentRideId: '',
      createdAt: new Date().toISOString()
    }

    const drivers = readJson(driversFile)
    drivers.push(newDriver)
    writeJson(driversFile, drivers)

    return res.json({
      success: true,
      message: 'Driver application submitted',
      driver: newDriver
    })
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: 'Could not save driver signup'
    })
  }
})

// RIDER SIGNUP
app.post('/api/rider-signup', (req, res) => {
  try {
    const body = req.body || {}

    const newRider = {
      id: body.id || Date.now().toString(),
      name: body.name || '',
      email: body.email || '',
      phone: body.phone || '',
      city: body.city || '',
      createdAt: new Date().toISOString()
    }

    const riders = readJson(ridersFile)
    riders.push(newRider)
    writeJson(ridersFile, riders)

    return res.json({
      success: true,
      message: 'Rider account created',
      rider: newRider
    })
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: 'Could not save rider signup'
    })
  }
})

// REQUEST RIDE
app.post('/api/request-ride', (req, res) => {
  try {
    const body = req.body || {}

    const newRide = {
      id: body.id || Date.now().toString(),
      name: body.name || '',
      phone: body.phone || '',
      pickup: body.pickup || '',
      dropoff: body.dropoff || '',
      service: body.service || 'Standard Ride',
      pickupTime: body.pickupTime || 'ASAP',
      notes: body.notes || '',
      status: body.status || 'pending',
      assignedDriverId: '',
      assignedDriverName: '',
      completedAt: '',
      createdAt: body.createdAt || new Date().toISOString()
    }

    const rides = readJson(ridesFile)
    rides.push(newRide)
    writeJson(ridesFile, rides)

    return res.json({
      success: true,
      message: 'Ride request submitted',
      ride: newRide
    })
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: 'Could not save ride request'
    })
  }
})

// GET DATA
app.get('/api/drivers', (req, res) => {
  return res.json(readJson(driversFile))
})

app.get('/api/riders', (req, res) => {
  return res.json(readJson(ridersFile))
})

app.get('/api/rides', (req, res) => {
  return res.json(readJson(ridesFile))
})

// APPROVE DRIVER
app.post('/api/approve-driver', (req, res) => {
  try {
    const { id } = req.body || {}

    const drivers = readJson(driversFile).map((driver) => {
      if (String(driver.id) === String(id)) {
        return {
          ...driver,
          approved: true,
          status: 'approved'
        }
      }
      return driver
    })

    writeJson(driversFile, drivers)

    return res.json({
      success: true,
      message: 'Driver approved'
    })
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: 'Could not approve driver'
    })
  }
})

// REJECT DRIVER
app.post('/api/reject-driver', (req, res) => {
  try {
    const { id } = req.body || {}

    const drivers = readJson(driversFile).map((driver) => {
      if (String(driver.id) === String(id)) {
        return {
          ...driver,
          approved: false,
          status: 'rejected'
        }
      }
      return driver
    })

    writeJson(driversFile, drivers)

    return res.json({
      success: true,
      message: 'Driver rejected'
    })
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: 'Could not reject driver'
    })
  }
})

// ASSIGN DRIVER
app.post('/api/assign-driver', (req, res) => {
  try {
    const { rideId, driverId } = req.body || {}

    if (!rideId || !driverId) {
      return res.status(400).json({
        success: false,
        message: 'rideId and driverId are required'
      })
    }

    const drivers = readJson(driversFile)
    const rides = readJson(ridesFile)

    const selectedDriver = drivers.find(
      (driver) => String(driver.id) === String(driverId)
    )

    if (!selectedDriver) {
      return res.status(404).json({
        success: false,
        message: 'Driver not found'
      })
    }

    if (!(selectedDriver.approved === true || selectedDriver.status === 'approved')) {
      return res.status(400).json({
        success: false,
        message: 'Driver must be approved before assignment'
      })
    }

    const updatedRides = rides.map((ride) => {
      if (String(ride.id) === String(rideId)) {
        return {
          ...ride,
          status: 'assigned',
          assignedDriverId: selectedDriver.id,
          assignedDriverName: selectedDriver.name || 'Assigned Driver'
        }
      }
      return ride
    })

    const updatedDrivers = drivers.map((driver) => {
      if (String(driver.id) === String(driverId)) {
        return {
          ...driver,
          currentRideId: rideId
        }
      }
      return driver
    })

    writeJson(ridesFile, updatedRides)
    writeJson(driversFile, updatedDrivers)

    return res.json({
      success: true,
      message: 'Driver assigned successfully'
    })
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: 'Could not assign driver'
    })
  }
})

// COMPLETE TRIP
app.post('/api/complete-trip', (req, res) => {
  try {
    const { rideId } = req.body || {}

    if (!rideId) {
      return res.status(400).json({
        success: false,
        message: 'rideId is required'
      })
    }

    const rides = readJson(ridesFile)
    const drivers = readJson(driversFile)

    const targetRide = rides.find((ride) => String(ride.id) === String(rideId))

    if (!targetRide) {
      return res.status(404).json({
        success: false,
        message: 'Ride not found'
      })
    }

    const updatedRides = rides.map((ride) => {
      if (String(ride.id) === String(rideId)) {
        return {
          ...ride,
          status: 'completed',
          completedAt: new Date().toISOString()
        }
      }
      return ride
    })

    const updatedDrivers = drivers.map((driver) => {
      if (String(driver.id) === String(targetRide.assignedDriverId)) {
        return {
          ...driver,
          currentRideId: ''
        }
      }
      return driver
    })

    writeJson(ridesFile, updatedRides)
    writeJson(driversFile, updatedDrivers)

    return res.json({
      success: true,
      message: 'Trip completed successfully'
    })
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: 'Could not complete trip'
    })
  }
})

// HTML FALLBACK
app.get('/:page', (req, res) => {
  const filePath = path.join(__dirname, 'public', req.params.page)

  if (fs.existsSync(filePath)) {
    return res.sendFile(filePath)
  }

  return res.sendFile(path.join(__dirname, 'public', 'index.html'))
})

app.listen(PORT, () => {
  console.log(`Harvey Taxi running on port ${PORT}`)
})

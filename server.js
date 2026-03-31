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

function ensureFile(filePath) {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, '[]', 'utf8')
  }
}

function readJson(filePath) {
  ensureFile(filePath)

  try {
    const raw = fs.readFileSync(filePath, 'utf8').trim()

    if (!raw) {
      return []
    }

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

// GET DRIVERS
app.get('/api/drivers', (req, res) => {
  try {
    const drivers = readJson(driversFile)
    return res.json(drivers)
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: 'Could not load drivers'
    })
  }
})

// GET RIDERS
app.get('/api/riders', (req, res) => {
  try {
    const riders = readJson(ridersFile)
    return res.json(riders)
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: 'Could not load riders'
    })
  }
})

// APPROVE DRIVER
app.post('/api/approve-driver', (req, res) => {
  try {
    const { id } = req.body || {}

    if (!id) {
      return res.status(400).json({
        success: false,
        message: 'Driver id is required'
      })
    }

    const drivers = readJson(driversFile)

    const updatedDrivers = drivers.map((driver) => {
      if (String(driver.id) === String(id)) {
        return {
          ...driver,
          approved: true,
          status: 'approved'
        }
      }

      return driver
    })

    writeJson(driversFile, updatedDrivers)

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

    if (!id) {
      return res.status(400).json({
        success: false,
        message: 'Driver id is required'
      })
    }

    const drivers = readJson(driversFile)

    const updatedDrivers = drivers.map((driver) => {
      if (String(driver.id) === String(id)) {
        return {
          ...driver,
          approved: false,
          status: 'rejected'
        }
      }

      return driver
    })

    writeJson(driversFile, updatedDrivers)

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

// OPTIONAL: SAVE DRIVER SIGNUP
app.post('/api/driver-signup', (req, res) => {
  try {
    const driver = req.body || {}

    const drivers = readJson(driversFile)

    const newDriver = {
      id: driver.id || Date.now().toString(),
      name: driver.name || driver.fullName || '',
      email: driver.email || '',
      phone: driver.phone || '',
      vehicle: driver.vehicle || driver.car || driver.vehicleType || '',
      license: driver.license || driver.licenseNumber || '',
      city: driver.city || driver.location || '',
      approved: false,
      status: 'pending',
      createdAt: new Date().toISOString()
    }

    drivers.push(newDriver)
    writeJson(driversFile, drivers)

    return res.json({
      success: true,
      message: 'Driver signup saved',
      driver: newDriver
    })
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: 'Could not save driver signup'
    })
  }
})

// OPTIONAL: SAVE RIDER SIGNUP
app.post('/api/rider-signup', (req, res) => {
  try {
    const rider = req.body || {}

    const riders = readJson(ridersFile)

    const newRider = {
      id: rider.id || Date.now().toString(),
      name: rider.name || rider.fullName || '',
      email: rider.email || '',
      phone: rider.phone || '',
      city: rider.city || rider.location || '',
      createdAt: new Date().toISOString()
    }

    riders.push(newRider)
    writeJson(ridersFile, riders)

    return res.json({
      success: true,
      message: 'Rider signup saved',
      rider: newRider
    })
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: 'Could not save rider signup'
    })
  }
})

// FALLBACK FOR HTML PAGES
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

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

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'))
})

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
      assignedDriverId: body.assignedDriverId || '',
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

app.get('/api/drivers', (req, res) => {
  return res.json(readJson(driversFile))
})

app.get('/api/riders', (req, res) => {
  return res.json(readJson(ridersFile))
})

app.get('/api/rides', (req, res) => {
  return res.json(readJson(ridesFile))
})

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

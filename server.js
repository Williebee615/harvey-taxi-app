const express = require('express')
const cors = require('cors')
const fs = require('fs')
const path = require('path')

const app = express()
const PORT = process.env.PORT || 10000
const DATA_FILE = path.join(__dirname, 'data.json')
const PUBLIC_DIR = path.join(__dirname, 'public')

app.use(cors())
app.use(express.json({ limit: '10mb' }))
app.use(express.static(PUBLIC_DIR))

function getDefaultData() {
  return {
    drivers: [],
    riders: [],
    rides: []
  }
}

function loadData() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      const starter = getDefaultData()
      fs.writeFileSync(DATA_FILE, JSON.stringify(starter, null, 2))
      return starter
    }

    const raw = fs.readFileSync(DATA_FILE, 'utf8')
    const parsed = JSON.parse(raw)

    return {
      drivers: Array.isArray(parsed.drivers) ? parsed.drivers : [],
      riders: Array.isArray(parsed.riders) ? parsed.riders : [],
      rides: Array.isArray(parsed.rides) ? parsed.rides : []
    }
  } catch (error) {
    console.error('Error loading data.json:', error)
    return getDefaultData()
  }
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2))
}

function makeId(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}_${Date.now()}`
}

app.get('/', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'))
})

app.post('/signup-driver', (req, res) => {
  const data = loadData()
  const { name, phone, email, vehicle, city } = req.body

  if (!name || !phone || !vehicle) {
    return res.status(400).json({
      success: false,
      error: 'Name, phone, and vehicle are required.'
    })
  }

  const driver = {
    id: makeId('driver'),
    name,
    phone,
    email: email || '',
    vehicle,
    city: city || '',
    status: 'pending',
    verified: false,
    approved: false,
    createdAt: new Date().toISOString()
  }

  data.drivers.push(driver)
  saveData(data)

  res.json({
    success: true,
    message: 'Driver application submitted successfully.',
    driver
  })
})

app.post('/signup-rider', (req, res) => {
  const data = loadData()
  const { name, phone, email } = req.body

  if (!name || !phone) {
    return res.status(400).json({
      success: false,
      error: 'Name and phone are required.'
    })
  }

  const rider = {
    id: makeId('rider'),
    name,
    phone,
    email: email || '',
    verified: false,
    status: 'active',
    createdAt: new Date().toISOString()
  }

  data.riders.push(rider)
  saveData(data)

  res.json({
    success: true,
    message: 'Rider account created successfully.',
    rider
  })
})

app.post('/request-ride', (req, res) => {
  const data = loadData()
  const { pickup, dropoff, service } = req.body

  if (!pickup || !dropoff) {
    return res.status(400).json({
      success: false,
      error: 'Pickup and dropoff are required.'
    })
  }

  const ride = {
    id: makeId('ride'),
    pickup,
    dropoff,
    service: service || 'Standard Ride',
    status: 'waiting',
    createdAt: new Date().toISOString()
  }

  data.rides.push(ride)
  saveData(data)

  res.json({
    success: true,
    message: 'Ride request created.',
    ride
  })
})

app.get('/rides', (req, res) => {
  const data = loadData()
  res.json(data.rides)
})

app.get('/drivers', (req, res) => {
  const data = loadData()
  res.json(data.drivers)
})

app.get('/riders', (req, res) => {
  const data = loadData()
  res.json(data.riders)
})

app.get('/api/admin/drivers', (req, res) => {
  const data = loadData()
  res.json(data.drivers)
})

app.get('/api/admin/riders', (req, res) => {
  const data = loadData()
  res.json(data.riders)
})

app.post('/api/admin/approve-driver', (req, res) => {
  const data = loadData()
  const { id } = req.body

  if (!id) {
    return res.status(400).json({
      success: false,
      error: 'Driver id is required.'
    })
  }

  const driver = data.drivers.find((d) => d.id === id)

  if (!driver) {
    return res.status(404).json({
      success: false,
      error: 'Driver not found.'
    })
  }

  driver.approved = true
  driver.status = 'approved'
  saveData(data)

  res.json({
    success: true,
    message: 'Driver approved successfully.',
    driver
  })
})

app.post('/api/admin/reject-driver', (req, res) => {
  const data = loadData()
  const { id } = req.body

  if (!id) {
    return res.status(400).json({
      success: false,
      error: 'Driver id is required.'
    })
  }

  const driver = data.drivers.find((d) => d.id === id)

  if (!driver) {
    return res.status(404).json({
      success: false,
      error: 'Driver not found.'
    })
  }

  driver.approved = false
  driver.status = 'rejected'
  saveData(data)

  res.json({
    success: true,
    message: 'Driver rejected.',
    driver
  })
})

app.post('/approve-driver', (req, res) => {
  const data = loadData()
  const { id } = req.body
  const driver = data.drivers.find((d) => d.id === id)

  if (!driver) {
    return res.status(404).json({
      success: false,
      error: 'Driver not found.'
    })
  }

  driver.approved = true
  driver.status = 'approved'
  saveData(data)

  res.json({ success: true, driver })
})

app.post('/reject-driver', (req, res) => {
  const data = loadData()
  const { id } = req.body
  const driver = data.drivers.find((d) => d.id === id)

  if (!driver) {
    return res.status(404).json({
      success: false,
      error: 'Driver not found.'
    })
  }

  driver.approved = false
  driver.status = 'rejected'
  saveData(data)

  res.json({ success: true, driver })
})

app.get('*', (req, res) => {
  const requestedPath = path.join(PUBLIC_DIR, req.path)

  if (fs.existsSync(requestedPath) && fs.statSync(requestedPath).isFile()) {
    return res.sendFile(requestedPath)
  }

  res.sendFile(path.join(PUBLIC_DIR, 'index.html'))
})

app.listen(PORT, () => {
  console.log(`Harvey Taxi server running on port ${PORT}`)
})

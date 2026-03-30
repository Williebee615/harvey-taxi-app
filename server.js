const express = require('express')
const cors = require('cors')
const path = require('path')
const fs = require('fs')

const app = express()
const PORT = process.env.PORT || 10000
const DATA_FILE = path.join(__dirname, 'data.json')

app.use(cors())
app.use(express.json())
app.use(express.static(path.join(__dirname, 'public')))

function defaultData() {
  return {
    riders: [],
    drivers: []
  }
}

function loadData() {
  if (!fs.existsSync(DATA_FILE)) {
    const starter = defaultData()
    fs.writeFileSync(DATA_FILE, JSON.stringify(starter, null, 2))
    return starter
  }

  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8')
    const parsed = JSON.parse(raw)
    return {
      riders: parsed.riders || [],
      drivers: parsed.drivers || []
    }
  } catch (error) {
    console.error('Error loading data.json:', error)
    return defaultData()
  }
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2))
}

function makeId(prefix) {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 100000)}`
}

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'))
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
    createdAt: new Date().toISOString()
  }

  data.riders.unshift(rider)
  saveData(data)

  res.json({
    success: true,
    message: 'Rider account created successfully.',
    rider
  })
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
    approved: false,
    status: 'pending',
    createdAt: new Date().toISOString()
  }

  data.drivers.unshift(driver)
  saveData(data)

  res.json({
    success: true,
    message: 'Driver application submitted successfully.',
    driver
  })
})

app.get('/api/admin/riders', (req, res) => {
  const data = loadData()
  res.json(data.riders)
})

app.get('/api/admin/drivers', (req, res) => {
  const data = loadData()
  res.json(data.drivers)
})

app.post('/api/admin/approve-driver', (req, res) => {
  const data = loadData()
  const { id } = req.body

  const driver = data.drivers.find((item) => item.id === id)

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

  const driver = data.drivers.find((item) => item.id === id)

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

app.listen(PORT, () => {
  console.log(`Harvey Taxi server running on port ${PORT}`)
})

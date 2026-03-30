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

function readData() {
  if (!fs.existsSync(DATA_FILE)) {
    const data = {
      riders: [],
      drivers: [],
      serviceRequests: []
    }
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2))
    return data
  }

  return JSON.parse(fs.readFileSync(DATA_FILE))
}

function writeData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2))
}

function generateId(prefix) {
  return prefix + "_" + Date.now()
}

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/index.html'))
})

/* DRIVER SIGNUP */
app.post('/api/driver-signup', (req, res) => {
  const data = readData()

  const driver = {
    id: generateId('driver'),
    name: req.body.name,
    email: req.body.email,
    phone: req.body.phone,
    vehicle: req.body.vehicle,
    approved: false,
    available: false,
    status: 'offline'
  }

  data.drivers.push(driver)
  writeData(data)

  res.json({ success: true })
})

/* APPROVE DRIVER */
app.post('/api/admin/approve-driver/:id', (req, res) => {
  const data = readData()
  const driver = data.drivers.find(d => d.id === req.params.id)

  if (driver) {
    driver.approved = true
    driver.available = true
    driver.status = 'available'
  }

  writeData(data)
  res.json({ success: true })
})

/* GET DRIVERS */
app.get('/api/drivers', (req, res) => {
  const data = readData()
  res.json({ drivers: data.drivers })
})

/* REQUEST RIDE */
app.post('/api/request-ride', (req, res) => {
  const data = readData()

  const request = {
    id: generateId('ride'),
    riderName: req.body.riderName,
    riderPhone: req.body.riderPhone,
    pickup: req.body.pickup,
    dropoff: req.body.dropoff,
    status: 'pending',
    assignedDriver: null,
    created: new Date()
  }

  data.serviceRequests.unshift(request)
  writeData(data)

  res.json({ success: true })
})

/* GET REQUESTS */
app.get('/api/service-requests', (req, res) => {
  const data = readData()
  res.json({ requests: data.serviceRequests })
})

/* ASSIGN DRIVER */
app.post('/api/assign-driver', (req, res) => {
  const data = readData()

  const request = data.serviceRequests.find(r => r.id === req.body.requestId)
  const driver = data.drivers.find(d => d.id === req.body.driverId)

  if (request && driver) {
    request.assignedDriver = driver.name
    request.status = 'assigned'

    driver.available = false
    driver.status = 'assigned'
  }

  writeData(data)
  res.json({ success: true })
})

/* EN ROUTE */
app.post('/api/enroute/:id', (req, res) => {
  const data = readData()
  const ride = data.serviceRequests.find(r => r.id === req.params.id)

  if (ride) ride.status = 'enroute'

  writeData(data)
  res.json({ success: true })
})

/* START RIDE */
app.post('/api/start/:id', (req, res) => {
  const data = readData()
  const ride = data.serviceRequests.find(r => r.id === req.params.id)

  if (ride) ride.status = 'in_progress'

  writeData(data)
  res.json({ success: true })
})

/* COMPLETE RIDE */
app.post('/api/complete/:id', (req, res) => {
  const data = readData()
  const ride = data.serviceRequests.find(r => r.id === req.params.id)

  if (ride) ride.status = 'completed'

  writeData(data)
  res.json({ success: true })
})

/* ADMIN PAGE */
app.get('/admin-dispatch', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/admin-dispatch.html'))
})

app.listen(PORT, () => {
  console.log("Harvey Taxi running on port " + PORT)
})

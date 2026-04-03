const express = require('express')
const cors = require('cors')
const path = require('path')
const fs = require('fs')

const app = express()
const PORT = process.env.PORT || 10000

app.use(cors())
app.use(express.json())
app.use(express.static(path.join(__dirname, 'public')))

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/index.html'))
})

function read(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return []
  }
}

function write(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2))
}

/* -------------------------
   STATUS
--------------------------*/
app.get('/api/status', (req, res) => {
  res.json({
    status: 'Harvey Taxi Running',
    time: new Date()
  })
})

/* -------------------------
   RIDER SIGNUP
--------------------------*/
app.post('/api/rider-signup', (req, res) => {
  const riders = read('riders.json')

  const rider = {
    id: Date.now(),
    name: req.body.name || '',
    phone: req.body.phone || '',
    email: req.body.email || '',
    city: req.body.city || '',
    created: new Date()
  }

  riders.push(rider)
  write('riders.json', riders)

  res.json({
    success: true,
    rider
  })
})

/* -------------------------
   DRIVER SIGNUP
--------------------------*/
app.post('/api/driver-signup', (req, res) => {
  const drivers = read('drivers.json')

  const driver = {
    id: Date.now(),
    name: req.body.name || '',
    phone: req.body.phone || '',
    email: req.body.email || '',
    city: req.body.city || '',
    vehicle: req.body.vehicle || '',
    status: 'active',
    online: true,
    created: new Date()
  }

  drivers.push(driver)
  write('drivers.json', drivers)

  res.json({
    success: true,
    driver
  })
})

/* -------------------------
   GET DRIVERS
--------------------------*/
app.get('/api/drivers', (req, res) => {
  res.json(read('drivers.json'))
})

/* -------------------------
   REQUEST RIDE
--------------------------*/
app.post('/api/request-ride', (req, res) => {
  const rides = read('rides.json')

  const ride = {
    id: Date.now(),
    pickup: req.body.pickup || '',
    dropoff: req.body.dropoff || '',
    rider: req.body.rider || '',
    riderPhone: req.body.riderPhone || '',
    status: 'waiting',
    driverId: null,
    driverName: null,
    acceptedAt: null,
    assignedBy: null,
    created: new Date()
  }

  rides.push(ride)
  write('rides.json', rides)

  res.json({
    success: true,
    ride
  })
})

/* -------------------------
   GET ALL RIDES
--------------------------*/
app.get('/api/rides', (req, res) => {
  res.json(read('rides.json'))
})

/* -------------------------
   AVAILABLE RIDES
--------------------------*/
app.get('/api/available-rides', (req, res) => {
  const rides = read('rides.json')
  const available = rides.filter(r => r.status === 'waiting')
  res.json(available)
})

/* -------------------------
   DRIVER ACCEPT RIDE
--------------------------*/
app.post('/api/rides/:id/accept', (req, res) => {
  const rides = read('rides.json')
  const ride = rides.find(r => String(r.id) === String(req.params

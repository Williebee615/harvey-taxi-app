const express = require('express')
const cors = require('cors')
const fs = require('fs')
const path = require('path')

const app = express()
const PORT = process.env.PORT || 10000

app.use(cors())
app.use(express.json())
app.use(express.static(path.join(__dirname, 'public')))

function read(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (error) {
    return []
  }
}

function write(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2))
}

function uid() {
  return Math.random().toString(36).slice(2, 10)
}

/* HOME */
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'))
})

/* PAGE ROUTES */
app.get('/:page', (req, res, next) => {
  if (req.params.page.startsWith('api')) return next()

  const filePath = path.join(__dirname, 'public', req.params.page)

  if (fs.existsSync(filePath)) {
    return res.sendFile(filePath)
  }

  if (fs.existsSync(filePath + '.html')) {
    return res.sendFile(filePath + '.html')
  }

  return res.sendFile(path.join(__dirname, 'public', 'index.html'))
})

/* STATUS */
app.get('/api/status', (req, res) => {
  res.json({
    success: true,
    status: 'Harvey Taxi Running'
  })
})

/* ADMIN LOGIN */
app.post('/api/admin-login', (req, res) => {
  const email = req.body.email || ''
  const password = req.body.password || ''

  if (email === 'admin@harveytaxi.com' && password === 'admin123') {
    return res.json({
      success: true,
      user: {
        email: 'admin@harveytaxi.com',
        role: 'admin'
      }
    })
  }

  return res.status(401).json({
    success: false,
    message: 'Invalid login'
  })
})

/* RIDER SIGNUP */
app.post('/api/rider-signup', (req, res) => {
  const riders = read('riders.json')

  const rider = {
    id: Date.now(),
    name: req.body.name || '',
    email: req.body.email || '',
    phone: req.body.phone || '',
    city: req.body.city || '',
    createdAt: new Date()
  }

  riders.push(rider)
  write('riders.json', riders)

  res.json({
    success: true,
    rider
  })
})

/* DRIVER SIGNUP */
app.post('/api/driver-signup', (req, res) => {
  const drivers = read('drivers.json')

  const driver = {
    id: Date.now(),
    name: req.body.name || '',
    email: req.body.email || '',
    phone: req.body.phone || '',
    city: req.body.city || '',
    vehicle: req.body.vehicle || '',
    license: req.body.license || '',
    notes: req.body.notes || '',
    status: 'active',
    online: true,
    createdAt: new Date()
  }

  drivers.push(driver)
  write('drivers.json', drivers)

  res.json({
    success: true,
    driver
  })
})

/* REQUEST RIDE */
app.post('/api/request-ride', (req, res) => {
  const rides = read('rides.json')

  const ride = {
    id: Date.now(),
    rider: req.body.name || req.body.rider || '',
    riderPhone: req.body.phone || req.body.riderPhone || '',
    pickup: req.body.pickup || '',
    dropoff: req.body.dropoff || '',
    status: 'waiting',
    driverId: null,
    driverName: null,
    acceptedAt: null,
    createdAt: new Date()
  }

  rides.push(ride)
  write('rides.json', rides)

  res.json({
    success: true,
    ride
  })
})

/* GET ALL RIDES */
app.get('/api/rides', (req, res) => {
  res.json(read('rides.json'))
})

/* GET DRIVERS */
app.get('/api/drivers', (req, res) => {
  res.json(read('drivers.json'))
})

/* GET AVAILABLE RIDES */
app.get('/api/available-rides', (req, res) => {
  const rides = read('rides.json')
  const available = rides.filter(ride => ride.status === 'waiting')
  res.json(available)
})

/* ACCEPT RIDE */
app.post('/api/rides/:id/accept', (req, res) => {
  const rides = read('rides.json')
  const ride = rides.find(r => String(r.id) === String(req.params.id))

  if (!ride) {
    return res.status(404).json({
      success: false,
      error: 'Ride not found'
    })
  }

  ride.status = 'accepted'
  ride.driverId = req.body.driverId || null
  ride.driverName = req.body.driverName || ''
  ride.acceptedAt = new Date()

  write('rides.json', rides)

  return res.json({
    success: true,
    ride
  })
})

/* UPDATE RIDE STATUS */
app.post('/api/rides/:id/status', (req, res) => {
  const rides = read('rides.json')
  const ride = rides.find(r => String(r.id) === String(req.params.id))

  if (!ride) {
    return res.status(404).json({
      success: false,
      error: 'Ride not found'
    })
  }

  ride.status = req.body.status || ride.status
  write('rides.json', rides)

  return res.json({
    success: true,
    ride
  })
})

/* SEND MESSAGE */
app.post('/api/send-message', (req, res) => {
  const messages = read('messages.json')

  const message = {
    id: uid(),
    rideId: req.body.rideId || 'support',
    from: req.body.from || 'user',
    to: req.body.to || 'admin',
    text: req.body.text || '',
    time: Date.now()
  }

  messages.push(message)
  write('messages.json', messages)

  res.json({
    success: true,
    message
  })
})

/* GET MESSAGES BY RIDE OR SUPPORT THREAD */
app.get('/api/messages/:rideId', (req, res) => {
  const messages = read('messages.json')
  const filtered = messages.filter(m => String(m.rideId) === String(req.params.rideId))
  res.json(filtered)
})

app.listen(PORT, () => {
  console.log('Harvey Taxi UI + Messaging running on port ' + PORT)
})

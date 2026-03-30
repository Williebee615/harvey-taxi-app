app.get('/driver', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/driver.html'))
})const express = require('express')
const cors = require('cors')
const path = require('path')
const fs = require('fs')

const app = express()
const PORT = process.env.PORT || 10000
const DATA_FILE = path.join(__dirname, 'data.json')

app.use(cors())
app.use(express.json())
app.use(express.urlencoded({ extended: true }))
app.use(express.static(path.join(__dirname, 'public')))

function defaultData() {
  return {
    riders: [],
    drivers: [],
    admins: [
      {
        id: 'admin_1',
        name: 'Harvey Admin',
        email: 'admin@harveytaxi.com',
        password: 'admin123'
      }
    ],
    serviceRequests: []
  }
}

function readData() {
  if (!fs.existsSync(DATA_FILE)) {
    const data = defaultData()
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2))
    return data
  }

  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8')
    return JSON.parse(raw)
  } catch (error) {
    console.error('Error reading data file:', error)
    return defaultData()
  }
}

function writeData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2))
}

function generateId(prefix) {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 100000)}`
}

function sanitizeDriver(driver) {
  return {
    id: driver.id,
    name: driver.name,
    email: driver.email,
    phone: driver.phone || '',
    vehicleType: driver.vehicleType || '',
    carModel: driver.carModel || '',
    licensePlate: driver.licensePlate || '',
    approved: !!driver.approved,
    available: !!driver.available,
    status: driver.status || 'offline',
    currentLat: driver.currentLat ?? null,
    currentLng: driver.currentLng ?? null,
    createdAt: driver.createdAt || null
  }
}

function ensureRequestShape(requestRecord) {
  if (!requestRecord.lifecycle) {
    requestRecord.lifecycle = {
      stage: 'request_intake',
      requestIntakeAt: requestRecord.createdAt || new Date().toISOString(),
      validatedAt: null,
      driverAssignedAt: null,
      acceptedAt: null,
      declinedAt: null,
      enRouteAt: null,
      riderPickedUpAt: null,
      dropoffCompleteAt: null
    }
  }

  if (!requestRecord.payment) {
    requestRecord.payment = {
      fareQuoted: 0,
      fareCharged: 0,
      driverPay: 0,
      paymentMethod: '',
      paymentStatus: 'unpaid'
    }
  }

  if (!requestRecord.operations) {
    requestRecord.operations = {
      dispatcherNotes: '',
      referralSource: '',
      routeType: '',
      passengerCount: '',
      luggageCount: '',
      backupDriverId: null,
      backupDriverName: null
    }
  }

  return requestRecord
}

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'))
})

app.get('/admin-dispatch', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin-dispatch.html'))
})

app.get('/driver-dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'driver-dashboard.html'))
})

/* DRIVER SIGNUP */
app.post('/api/driver-signup', (req, res) => {
  const data = readData()
  const { name, email, password, phone, vehicleType, carModel, licensePlate } = req.body

  if (!name || !email || !password) {
    return res.status(400).json({
      success: false,
      message: 'Name, email, and password are required.'
    })
  }

  const existing = data.drivers.find(
    d => d.email.toLowerCase() === String(email).toLowerCase()
  )

  if (existing) {
    return res.status(400).json({
      success: false,
      message: 'A driver with this email already exists.'
    })
  }

  const driver = {
    id: generateId('driver'),
    name,
    email,
    password,
    phone: phone || '',
    vehicleType: vehicleType || '',
    carModel: carModel || '',
    licensePlate: licensePlate || '',
    approved: false,
    available: false,
    status: 'offline',
    currentLat: null,
    currentLng: null,
    createdAt: new Date().toISOString()
  }

  data.drivers.push(driver)
  writeData(data)

  res.json({
    success: true,
    message: 'Driver signup submitted successfully.',
    driver: sanitizeDriver(driver)
  })
})

/* DRIVER LOGIN */
app.post('/api/driver-login', (req, res) => {
  const data = readData()
  const { email, password } = req.body

  const driver = data.drivers.find(
    d =>
      d.email.toLowerCase() === String(email).toLowerCase() &&
      d.password === password
  )

  if (!driver) {
    return res.status(401).json({
      success: false,
      message: 'Invalid driver login.'
    })
  }

  res.json({
    success: true,
    message: 'Driver login successful.',
    driver: sanitizeDriver(driver)
  })
})

/* UPDATE DRIVER STATUS */
app.post('/api/driver/update-status', (req, res) => {
  const data = readData()
  const { driverId, status, available, currentLat, currentLng } = req.body

  const driver = data.drivers.find(d => d.id === driverId)

  if (!driver) {
    return res.status(404).json({
      success: false,
      message: 'Driver not found.'
    })
  }

  if (status) driver.status = status
  if (typeof available === 'boolean') driver.available = available
  if (typeof currentLat === 'number') driver.currentLat = currentLat
  if (typeof currentLng === 'number') driver.currentLng = currentLng

  writeData(data)

  res.json({
    success: true,
    driver: sanitizeDriver(driver)
  })
})

/* ADMIN APPROVE DRIVER */
app.post('/api/admin/approve-driver/:id', (req, res) => {
  const data = readData()
  const driver = data.drivers.find(d => d.id === req.params.id)

  if (!driver) {
    return res.status(404).json({
      success: false,
      message: 'Driver not found.'
    })
  }

  driver.approved = true
  driver.available = true
  driver.status = 'available'

  writeData(data)

  res.json({
    success: true,
    driver: sanitizeDriver(driver)
  })
})

/* GET DRIVERS */
app.get('/api/drivers', (req, res) => {
  const data = readData()
  res.json({
    success: true,
    drivers: data.drivers.map(sanitizeDriver)
  })
})

/* RIDER REQUEST */
app.post('/api/request-ride', (req, res) => {
  const data = readData()

  const {
    riderName,
    riderPhone,
    pickup,
    dropoff,
    scheduledTime,
    notes,
    passengerCount,
    luggageCount,
    routeType,
    referralSource,
    fareQuoted
  } = req.body

  if (!riderName || !riderPhone || !pickup || !dropoff) {
    return res.status(400).json({
      success: false,
      message: 'Rider name, phone, pickup, and dropoff are required.'
    })
  }

  const requestRecord = ensureRequestShape({
    id: generateId('ride'),
    riderName,
    riderPhone,
    pickup,
    dropoff,
    scheduledTime: scheduledTime || '',
    status: 'pending',
    assignedDriverId: null,
    assignedDriverName: null,
    driverResponse: 'waiting',
    startedAt: null,
    completedAt: null,
    cancelledAt: null,
    createdAt: new Date().toISOString(),
    payment: {
      fareQuoted: Number(fareQuoted || 0),
      fareCharged: 0,
      driverPay: 0,
      paymentMethod: '',
      paymentStatus: 'unpaid'
    },
    operations: {
      dispatcherNotes: notes || '',
      referralSource: referralSource || '',
      routeType: routeType || '',
      passengerCount: passengerCount || '',
      luggageCount: luggageCount || '',
      backupDriverId: null,
      backupDriverName: null
    }
  })

  data.serviceRequests.unshift(requestRecord)
  writeData(data)

  res.json({
    success: true,
    message: 'Ride request created.',
    request: requestRecord
  })
})

/* GET ALL REQUESTS */
app.get('/api/service-requests', (req, res) => {
  const data = readData()
  data.serviceRequests = data.serviceRequests.map(ensureRequestShape)
  writeData(data)

  res.json({
    success: true,
    requests: data.serviceRequests
  })
})

/* GET DRIVER'S RIDES */
app.get('/api/driver-rides/:driverId', (req, res) => {
  const data = readData()
  const rides = data.serviceRequests
    .map(ensureRequestShape)
    .filter(ride => ride.assignedDriverId === req.params.driverId)

  res.json({
    success: true,
    rides
  })
})

/* ASSIGN DRIVER */
app.post('/api/assign-driver', (req, res) => {
  const data = readData()
  const { requestId, driverId } = req.body

  const requestRecord = data.serviceRequests.find(r => r.id === requestId)
  const driver = data.drivers.find(d => d.id === driverId)

  if (!requestRecord) {
    return res.status(404).json({
      success: false,
      message: 'Ride request not found.'
    })
  }

  if (!driver) {
    return res.status(404).json({
      success: false,
      message: 'Driver not found.'
    })
  }

  if (!driver.approved) {
    return res.status(400).json({
      success: false,
      message: 'Driver is not approved.'
    })
  }

  ensureRequestShape(requestRecord)

  requestRecord.assignedDriverId = driver.id
  requestRecord.assignedDriverName = driver.name
  requestRecord.driverResponse = 'waiting'
  requestRecord.status = 'assigned'
  requestRecord.lifecycle.driverAssignedAt = new Date().toISOString()
  requestRecord.lifecycle.stage = 'driver_assignment'

  driver.available = false
  driver.status = 'assigned'

  writeData(data)

  res.json({
    success: true,
    request: requestRecord
  })
})

/* DRIVER ACCEPT RIDE */
app.post('/api/driver/accept-ride/:rideId', (req, res) => {
  const data = readData()
  const { driverId } = req.body

  const ride = data.serviceRequests.find(r => r.id === req.params.rideId)
  const driver = data.drivers.find(d => d.id === driverId)

  if (!ride || !driver) {
    return res.status(404).json({
      success: false,
      message: 'Ride or driver not found.'
    })
  }

  if (ride.assignedDriverId !== driver.id) {
    return res.status(400).json({
      success: false,
      message: 'This ride is not assigned to this driver.'
    })
  }

  ensureRequestShape(ride)

  ride.driverResponse = 'accepted'
  ride.status = 'accepted'
  ride.lifecycle.acceptedAt = new Date().toISOString()
  ride.lifecycle.stage = 'pre_ride_confirmation'

  driver.status = 'accepted'
  driver.available = false

  writeData(data)

  res.json({
    success: true,
    ride
  })
})

/* DRIVER DECLINE RIDE */
app.post('/api/driver/decline-ride/:rideId', (req, res) => {
  const data = readData()
  const { driverId } = req.body

  const ride = data.serviceRequests.find(r => r.id === req.params.rideId)
  const driver = data.drivers.find(d => d.id === driverId)

  if (!ride || !driver) {
    return res.status(404).json({
      success: false,
      message: 'Ride or driver not found.'
    })
  }

  if (ride.assignedDriverId !== driver.id) {
    return res.status(400).json({
      success: false,
      message: 'This ride is not assigned to this driver.'
    })
  }

  ensureRequestShape(ride)

  ride.driverResponse = 'declined'
  ride.status = 'pending'
  ride.lifecycle.declinedAt = new Date().toISOString()
  ride.lifecycle.stage = 'validation'
  ride.assignedDriverId = null
  ride.assignedDriverName = null

  driver.status = 'available'
  driver.available = true

  writeData(data)

  res.json({
    success: true,
    ride
  })
})

/* DRIVER EN ROUTE */
app.post('/api/driver/enroute/:rideId', (req, res) => {
  const data = readData()
  const { driverId } = req.body

  const ride = data.serviceRequests.find(r => r.id === req.params.rideId)
  const driver = data.drivers.find(d => d.id === driverId)

  if (!ride || !driver) {
    return res.status(404).json({
      success: false,
      message: 'Ride or driver not found.'
    })
  }

  if (ride.assignedDriverId !== driver.id) {
    return res.status(400).json({
      success: false,
      message: 'This ride is not assigned to this driver.'
    })
  }

  ensureRequestShape(ride)

  ride.status = 'en_route'
  ride.lifecycle.enRouteAt = new Date().toISOString()
  ride.lifecycle.stage = 'active_ride'

  driver.status = 'en_route'
  driver.available = false

  writeData(data)

  res.json({
    success: true,
    ride
  })
})

/* DRIVER PICKED UP */
app.post('/api/driver/picked-up/:rideId', (req, res) => {
  const data = readData()
  const { driverId } = req.body

  const ride = data.serviceRequests.find(r => r.id === req.params.rideId)
  const driver = data.drivers.find(d => d.id === driverId)

  if (!ride || !driver) {
    return res.status(404).json({
      success: false,
      message: 'Ride or driver not found.'
    })
  }

  if (ride.assignedDriverId !== driver.id) {
    return res.status(400).json({
      success: false,
      message: 'This ride is not assigned to this driver.'
    })
  }

  ensureRequestShape(ride)

  ride.status = 'in_progress'
  ride.startedAt = new Date().toISOString()
  ride.lifecycle.riderPickedUpAt = ride.startedAt
  ride.lifecycle.stage = 'active_ride'

  driver.status = 'busy'
  driver.available = false

  writeData(data)

  res.json({
    success: true,
    ride
  })
})

/* DRIVER COMPLETE */
app.post('/api/driver/complete/:rideId', (req, res) => {
  const data = readData()
  const { driverId } = req.body

  const ride = data.serviceRequests.find(r => r.id === req.params.rideId)
  const driver = data.drivers.find(d => d.id === driverId)

  if (!ride || !driver) {
    return res.status(404).json({
      success: false,
      message: 'Ride or driver not found.'
    })
  }

  if (ride.assignedDriverId !== driver.id) {
    return res.status(400).json({
      success: false,
      message: 'This ride is not assigned to this driver.'
    })
  }

  ensureRequestShape(ride)

  ride.status = 'completed'
  ride.completedAt = new Date().toISOString()
  ride.lifecycle.dropoffCompleteAt = ride.completedAt
  ride.lifecycle.stage = 'completion'

  driver.status = 'available'
  driver.available = true

  writeData(data)

  res.json({
    success: true,
    ride
  })
})

/* ADMIN START RIDE */
app.post('/api/start/:id', (req, res) => {
  const data = readData()
  const ride = data.serviceRequests.find(r => r.id === req.params.id)

  if (!ride) {
    return res.status(404).json({
      success: false,
      message: 'Ride not found.'
    })
  }

  ensureRequestShape(ride)

  ride.status = 'in_progress'
  ride.startedAt = new Date().toISOString()
  ride.lifecycle.riderPickedUpAt = ride.startedAt
  ride.lifecycle.stage = 'active_ride'

  writeData(data)
  res.json({ success: true, ride })
})

/* ADMIN COMPLETE RIDE */
app.post('/api/complete/:id', (req, res) => {
  const data = readData()
  const ride = data.serviceRequests.find(r => r.id === req.params.id)

  if (!ride) {
    return res.status(404).json({
      success: false,
      message: 'Ride not found.'
    })
  }

  ensureRequestShape(ride)

  ride.status = 'completed'
  ride.completedAt = new Date().toISOString()
  ride.lifecycle.dropoffCompleteAt = ride.completedAt
  ride.lifecycle.stage = 'completion'

  const driver = data.drivers.find(d => d.id === ride.assignedDriverId)
  if (driver) {
    driver.status = 'available'
    driver.available = true
  }

  writeData(data)
  res.json({ success: true, ride })
})

app.listen(PORT, () => {
  console.log(`Harvey Taxi running on port ${PORT}`)
})

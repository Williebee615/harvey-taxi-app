const express = require('express')
const cors = require('cors')
const path = require('path')
const fs = require('fs')

const app = express()
const PORT = process.env.PORT || 10000
const DATA_FILE = path.join(__dirname, 'data.json')

app.use(cors())
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true }))
app.use(express.static(path.join(__dirname, 'public')))

function readData() {
  if (!fs.existsSync(DATA_FILE)) {
    const starterData = {
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
    fs.writeFileSync(DATA_FILE, JSON.stringify(starterData, null, 2))
    return starterData
  }

  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8')
    return JSON.parse(raw)
  } catch (error) {
    console.error('Error reading data file:', error)
    return {
      riders: [],
      drivers: [],
      admins: [],
      serviceRequests: []
    }
  }
}

function writeData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2))
}

function generateId(prefix) {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 100000)}`
}

function toRadians(degrees) {
  return degrees * (Math.PI / 180)
}

function getDistanceMiles(lat1, lng1, lat2, lng2) {
  if (
    typeof lat1 !== 'number' ||
    typeof lng1 !== 'number' ||
    typeof lat2 !== 'number' ||
    typeof lng2 !== 'number'
  ) {
    return Number.MAX_SAFE_INTEGER
  }

  const earthRadiusKm = 6371
  const dLat = toRadians(lat2 - lat1)
  const dLng = toRadians(lng2 - lng1)

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2)

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  const distanceKm = earthRadiusKm * c
  return distanceKm * 0.621371
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
    status: driver.status || 'offline',
    approved: !!driver.approved,
    available: !!driver.available,
    currentLat: typeof driver.currentLat === 'number' ? driver.currentLat : null,
    currentLng: typeof driver.currentLng === 'number' ? driver.currentLng : null,
    createdAt: driver.createdAt || null
  }
}

function sanitizeRequest(request) {
  return request
}

function findNearestAvailableDriver(drivers, pickupLat, pickupLng) {
  const eligibleDrivers = drivers
    .filter(driver => driver.approved)
    .filter(driver => driver.available)
    .filter(driver => driver.status !== 'offline')
    .filter(
      driver =>
        typeof driver.currentLat === 'number' &&
        typeof driver.currentLng === 'number'
    )
    .map(driver => {
      const distanceMiles = getDistanceMiles(
        pickupLat,
        pickupLng,
        driver.currentLat,
        driver.currentLng
      )
      return { ...driver, distanceMiles }
    })
    .sort((a, b) => a.distanceMiles - b.distanceMiles)

  return eligibleDrivers.length ? eligibleDrivers[0] : null
}

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'))
})

app.get('/admin-dispatch', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin-dispatch.html'))
})

/*
  DRIVER SIGNUP
*/
app.post('/api/driver-signup', (req, res) => {
  const data = readData()

  const {
    name,
    email,
    password,
    phone,
    vehicleType,
    carModel,
    licensePlate
  } = req.body

  if (!name || !email || !password) {
    return res.status(400).json({
      success: false,
      message: 'Name, email, and password are required.'
    })
  }

  const alreadyExists = data.drivers.find(
    driver => driver.email.toLowerCase() === email.toLowerCase()
  )

  if (alreadyExists) {
    return res.status(400).json({
      success: false,
      message: 'Driver with this email already exists.'
    })
  }

  const newDriver = {
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

  data.drivers.push(newDriver)
  writeData(data)

  res.json({
    success: true,
    message: 'Driver signup submitted successfully. Awaiting approval.',
    driver: sanitizeDriver(newDriver)
  })
})

/*
  RIDER SIGNUP
*/
app.post('/api/rider-signup', (req, res) => {
  const data = readData()

  const { name, email, password, phone } = req.body

  if (!name || !email || !password) {
    return res.status(400).json({
      success: false,
      message: 'Name, email, and password are required.'
    })
  }

  const alreadyExists = data.riders.find(
    rider => rider.email.toLowerCase() === email.toLowerCase()
  )

  if (alreadyExists) {
    return res.status(400).json({
      success: false,
      message: 'Rider with this email already exists.'
    })
  }

  const newRider = {
    id: generateId('rider'),
    name,
    email,
    password,
    phone: phone || '',
    createdAt: new Date().toISOString()
  }

  data.riders.push(newRider)
  writeData(data)

  res.json({
    success: true,
    message: 'Rider signup successful.',
    rider: newRider
  })
})

/*
  DRIVER LOGIN
*/
app.post('/api/driver-login', (req, res) => {
  const data = readData()
  const { email, password } = req.body

  const driver = data.drivers.find(
    item =>
      item.email.toLowerCase() === String(email).toLowerCase() &&
      item.password === password
  )

  if (!driver) {
    return res.status(401).json({
      success: false,
      message: 'Invalid driver credentials.'
    })
  }

  res.json({
    success: true,
    message: 'Driver login successful.',
    driver: sanitizeDriver(driver)
  })
})

/*
  ADMIN LOGIN
*/
app.post('/api/admin-login', (req, res) => {
  const data = readData()
  const { email, password } = req.body

  const admin = data.admins.find(
    item =>
      item.email.toLowerCase() === String(email).toLowerCase() &&
      item.password === password
  )

  if (!admin) {
    return res.status(401).json({
      success: false,
      message: 'Invalid admin credentials.'
    })
  }

  res.json({
    success: true,
    message: 'Admin login successful.',
    admin: {
      id: admin.id,
      name: admin.name,
      email: admin.email
    }
  })
})

/*
  DRIVER APPROVAL
*/
app.post('/api/admin/approve-driver/:driverId', (req, res) => {
  const data = readData()
  const driver = data.drivers.find(item => item.id === req.params.driverId)

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
    message: 'Driver approved successfully.',
    driver: sanitizeDriver(driver)
  })
})

/*
  DRIVER STATUS / LOCATION UPDATE
*/
app.post('/api/driver/update-status', (req, res) => {
  const data = readData()
  const { driverId, available, status, currentLat, currentLng } = req.body

  const driver = data.drivers.find(item => item.id === driverId)

  if (!driver) {
    return res.status(404).json({
      success: false,
      message: 'Driver not found.'
    })
  }

  if (typeof available === 'boolean') {
    driver.available = available
  }

  if (status) {
    driver.status = status
  }

  if (typeof currentLat === 'number') {
    driver.currentLat = currentLat
  }

  if (typeof currentLng === 'number') {
    driver.currentLng = currentLng
  }

  writeData(data)

  res.json({
    success: true,
    message: 'Driver status updated.',
    driver: sanitizeDriver(driver)
  })
})

/*
  CREATE RIDE REQUEST
*/
app.post('/api/request-ride', (req, res) => {
  const data = readData()

  const {
    riderName,
    riderPhone,
    pickup,
    dropoff,
    pickupLat,
    pickupLng,
    dropoffLat,
    dropoffLng,
    scheduledTime,
    notes
  } = req.body

  if (!riderName || !riderPhone || !pickup || !dropoff) {
    return res.status(400).json({
      success: false,
      message: 'Rider name, phone, pickup, and dropoff are required.'
    })
  }

  const requestRecord = {
    id: generateId('ride'),
    riderName,
    riderPhone,
    pickup,
    dropoff,
    pickupLat: typeof pickupLat === 'number' ? pickupLat : null,
    pickupLng: typeof pickupLng === 'number' ? pickupLng : null,
    dropoffLat: typeof dropoffLat === 'number' ? dropoffLat : null,
    dropoffLng: typeof dropoffLng === 'number' ? dropoffLng : null,
    scheduledTime: scheduledTime || '',
    notes: notes || '',
    status: 'pending',
    assignedDriverId: null,
    assignedDriverName: null,
    assignedAt: null,
    startedAt: null,
    completedAt: null,
    createdAt: new Date().toISOString()
  }

  if (
    typeof requestRecord.pickupLat === 'number' &&
    typeof requestRecord.pickupLng === 'number'
  ) {
    const nearestDriver = findNearestAvailableDriver(
      data.drivers,
      requestRecord.pickupLat,
      requestRecord.pickupLng
    )

    if (nearestDriver) {
      requestRecord.assignedDriverId = nearestDriver.id
      requestRecord.assignedDriverName = nearestDriver.name
      requestRecord.assignedAt = new Date().toISOString()
      requestRecord.status = 'assigned'

      const driverToUpdate = data.drivers.find(d => d.id === nearestDriver.id)
      if (driverToUpdate) {
        driverToUpdate.available = false
        driverToUpdate.status = 'assigned'
      }
    }
  }

  data.serviceRequests.unshift(requestRecord)
  writeData(data)

  res.json({
    success: true,
    message:
      requestRecord.status === 'assigned'
        ? 'Ride request created and driver assigned.'
        : 'Ride request created. Awaiting dispatch.',
    request: sanitizeRequest(requestRecord)
  })
})

/*
  GET ALL REQUESTS
*/
app.get('/api/service-requests', (req, res) => {
  const data = readData()
  res.json({
    success: true,
    requests: data.serviceRequests
  })
})

/*
  GET ALL DRIVERS
*/
app.get('/api/drivers', (req, res) => {
  const data = readData()
  res.json({
    success: true,
    drivers: data.drivers.map(sanitizeDriver)
  })
})

/*
  MANUAL ASSIGN DRIVER
*/
app.post('/api/admin/assign-driver', (req, res) => {
  const data = readData()
  const { requestId, driverId } = req.body

  const requestRecord = data.serviceRequests.find(item => item.id === requestId)
  const driver = data.drivers.find(item => item.id === driverId)

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
      message: 'Driver is not approved yet.'
    })
  }

  requestRecord.assignedDriverId = driver.id
  requestRecord.assignedDriverName = driver.name
  requestRecord.assignedAt = new Date().toISOString()
  requestRecord.status = 'assigned'

  driver.available = false
  driver.status = 'assigned'

  writeData(data)

  res.json({
    success: true,
    message: 'Driver assigned successfully.',
    request: requestRecord
  })
})

/*
  START RIDE
*/
app.post('/api/admin/start-ride/:requestId', (req, res) => {
  const data = readData()
  const requestRecord = data.serviceRequests.find(item => item.id === req.params.requestId)

  if (!requestRecord) {
    return res.status(404).json({
      success: false,
      message: 'Ride request not found.'
    })
  }

  requestRecord.status = 'in_progress'
  requestRecord.startedAt = new Date().toISOString()

  const driver = data.drivers.find(item => item.id === requestRecord.assignedDriverId)
  if (driver) {
    driver.status = 'busy'
    driver.available = false
  }

  writeData(data)

  res.json({
    success: true,
    message: 'Ride started.',
    request: requestRecord
  })
})

/*
  COMPLETE RIDE
*/
app.post('/api/admin/complete-ride/:requestId', (req, res) => {
  const data = readData()
  const requestRecord = data.serviceRequests.find(item => item.id === req.params.requestId)

  if (!requestRecord) {
    return res.status(404).json({
      success: false,
      message: 'Ride request not found.'
    })
  }

  requestRecord.status = 'completed'
  requestRecord.completedAt = new Date().toISOString()

  const driver = data.drivers.find(item => item.id === requestRecord.assignedDriverId)
  if (driver) {
    driver.status = 'available'
    driver.available = true
  }

  writeData(data)

  res.json({
    success: true,
    message: 'Ride completed successfully.',
    request: requestRecord
  })
})

/*
  CANCEL RIDE
*/
app.post('/api/admin/cancel-ride/:requestId', (req, res) => {
  const data = readData()
  const requestRecord = data.serviceRequests.find(item => item.id === req.params.requestId)

  if (!requestRecord) {
    return res.status(404).json({
      success: false,
      message: 'Ride request not found.'
    })
  }

  requestRecord.status = 'cancelled'

  const driver = data.drivers.find(item => item.id === requestRecord.assignedDriverId)
  if (driver) {
    driver.status = 'available'
    driver.available = true
  }

  writeData(data)

  res.json({
    success: true,
    message: 'Ride cancelled.',
    request: requestRecord
  })
})

/*
  SIMPLE STATS
*/
app.get('/api/admin/stats', (req, res) => {
  const data = readData()

  const stats = {
    totalDrivers: data.drivers.length,
    approvedDrivers: data.drivers.filter(driver => driver.approved).length,
    availableDrivers: data.drivers.filter(driver => driver.available).length,
    totalRequests: data.serviceRequests.length,
    pendingRequests: data.serviceRequests.filter(r => r.status === 'pending').length,
    assignedRequests: data.serviceRequests.filter(r => r.status === 'assigned').length,
    inProgressRequests: data.serviceRequests.filter(r => r.status === 'in_progress').length,
    completedRequests: data.serviceRequests.filter(r => r.status === 'completed').length
  }

  res.json({
    success: true,
    stats
  })
})

/*
  FALLBACK ROUTE
*/
app.get('*', (req, res) => {
  const requestedFile = path.join(__dirname, 'public', req.path)

  if (fs.existsSync(requestedFile) && fs.statSync(requestedFile).isFile()) {
    return res.sendFile(requestedFile)
  }

  res.sendFile(path.join(__dirname, 'public', 'index.html'))
})

app.listen(PORT, () => {
  console.log(`Harvey Taxi server running on port ${PORT}`)
})

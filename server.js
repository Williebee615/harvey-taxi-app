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

function ensureLifecycle(requestRecord) {
  if (!requestRecord.lifecycle) {
    requestRecord.lifecycle = {
      stage: 'request_intake',
      requestIntakeAt: requestRecord.createdAt || new Date().toISOString(),
      validatedAt: null,
      driverAssignedAt: null,
      riderConfirmed24hAt: null,
      driverConfirmed24hAt: null,
      riderConfirmed2hAt: null,
      driverConfirmed2hAt: null,
      enRouteAt: null,
      riderPickedUpAt: null,
      dropoffCompleteAt: null,
      postRideClosedAt: null
    }
  }

  if (!requestRecord.payment) {
    requestRecord.payment = {
      fareQuoted: 0,
      fareCharged: 0,
      driverPay: 0,
      grossMargin: 0,
      paymentMethod: '',
      paymentStatus: 'unpaid'
    }
  }

  if (!requestRecord.flightInfo) {
    requestRecord.flightInfo = {
      airline: '',
      flightNumber: '',
      arrivalTerminal: '',
      flightStatus: ''
    }
  }

  if (!requestRecord.feedback) {
    requestRecord.feedback = {
      riderRating: '',
      riderComment: '',
      followUpSentAt: null
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

function calculateMargin(requestRecord) {
  const fareCharged = Number(requestRecord.payment?.fareCharged || 0)
  const driverPay = Number(requestRecord.payment?.driverPay || 0)
  requestRecord.payment.grossMargin = Number((fareCharged - driverPay).toFixed(2))
}

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'))
})

app.get('/admin-dispatch', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin-dispatch.html'))
})

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
    notes,
    passengerCount,
    luggageCount,
    routeType,
    referralSource,
    fareQuoted,
    airline,
    flightNumber,
    arrivalTerminal
  } = req.body

  if (!riderName || !riderPhone || !pickup || !dropoff) {
    return res.status(400).json({
      success: false,
      message: 'Rider name, phone, pickup, and dropoff are required.'
    })
  }

  const requestRecord = ensureLifecycle({
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
    status: 'pending',
    assignedDriverId: null,
    assignedDriverName: null,
    assignedAt: null,
    startedAt: null,
    completedAt: null,
    cancelledAt: null,
    createdAt: new Date().toISOString(),
    operations: {
      dispatcherNotes: notes || '',
      referralSource: referralSource || '',
      routeType: routeType || '',
      passengerCount: passengerCount || '',
      luggageCount: luggageCount || '',
      backupDriverId: null,
      backupDriverName: null
    },
    flightInfo: {
      airline: airline || '',
      flightNumber: flightNumber || '',
      arrivalTerminal: arrivalTerminal || '',
      flightStatus: ''
    },
    payment: {
      fareQuoted: Number(fareQuoted || 0),
      fareCharged: 0,
      driverPay: 0,
      grossMargin: 0,
      paymentMethod: '',
      paymentStatus: 'unpaid'
    },
    feedback: {
      riderRating: '',
      riderComment: '',
      followUpSentAt: null
    },
    lifecycle: {
      stage: 'request_intake',
      requestIntakeAt: new Date().toISOString(),
      validatedAt: null,
      driverAssignedAt: null,
      riderConfirmed24hAt: null,
      driverConfirmed24hAt: null,
      riderConfirmed2hAt: null,
      driverConfirmed2hAt: null,
      enRouteAt: null,
      riderPickedUpAt: null,
      dropoffCompleteAt: null,
      postRideClosedAt: null
    }
  })

  if (
    typeof requestRecord.pickupLat === 'number' &&
    typeof requestRecord.pickupLng === '

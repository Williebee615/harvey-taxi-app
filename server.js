const express = require('express')
const cors = require('cors')
const path = require('path')
const fs = require('fs')

const app = express()
const PORT = process.env.PORT || 10000
const DATA_FILE = path.join(__dirname, 'data.json')

app.use(cors())
app.use(express.json({ limit: '15mb' }))
app.use(express.urlencoded({ extended: true, limit: '15mb' }))
app.use(express.static(path.join(__dirname, 'public')))

function defaultData() {
  return {
    users: {
      riders: [],
      drivers: [],
      admins: [
        {
          id: 'admin_1',
          name: 'Harvey Admin',
          email: 'admin@harveytaxi.com',
          password: 'admin123',
          role: 'admin',
          createdAt: new Date().toISOString()
        }
      ]
    },
    serviceRequests: [],
    notifications: [],
    liveDrivers: []
  }
}

function loadData() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      const seed = defaultData()
      fs.writeFileSync(DATA_FILE, JSON.stringify(seed, null, 2))
      return seed
    }

    const raw = fs.readFileSync(DATA_FILE, 'utf8')
    const parsed = JSON.parse(raw)

    return {
      users: {
        riders: parsed?.users?.riders || [],
        drivers: parsed?.users?.drivers || [],
        admins: parsed?.users?.admins?.length ? parsed.users.admins : defaultData().users.admins
      },
      serviceRequests: parsed?.serviceRequests || [],
      notifications: parsed?.notifications || [],
      liveDrivers: parsed?.liveDrivers || []
    }
  } catch (error) {
    console.error('Failed to load data:', error.message)
    return defaultData()
  }
}

let db = loadData()

function saveData() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2))
  } catch (error) {
    console.error('Failed to save data:', error.message)
  }
}

function uid(prefix = 'id') {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 100000)}`
}

function toNumber(value) {
  const num = Number(value)
  return Number.isFinite(num) ? num : null
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase()
}

function sanitizeUser(user) {
  if (!user) return null
  const copy = JSON.parse(JSON.stringify(user))
  delete copy.password
  return copy
}

function addNotification(userId, message, type = 'general') {
  db.notifications.push({
    id: uid('note'),
    userId,
    type,
    message,
    read: false,
    createdAt: new Date().toISOString()
  })
  saveData()
}

function getDistanceKm(lat1, lng1, lat2, lng2) {
  const R = 6371
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLng = ((lng2 - lng1) * Math.PI) / 180

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2)

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

function allowedServiceType(type) {
  const normalized = String(type || '').toLowerCase()
  if (normalized === 'food') return 'food'
  if (normalized === 'groceries' || normalized === 'grocery') return 'groceries'
  if (normalized === 'package') return 'package'
  return 'ride'
}

function ensureDriverDefaults(driver) {
  if (!driver.services || !Array.isArray(driver.services) || !driver.services.length) {
    driver.services = ['ride', 'food', 'groceries']
  }

  if (!driver.location) {
    driver.location = { lat: null, lng: null, updatedAt: null }
  }

  if (!driver.stats) {
    driver.stats = {
      completedTrips: 0,
      completedFoodDeliveries: 0,
      completedGroceryDeliveries: 0,
      completedPackageDeliveries: 0
    }
  }

  if (!driver.verification) {
    driver.verification = { status: 'not_submitted' }
  }

  if (typeof driver.isApproved !== 'boolean') driver.isApproved = false
  if (typeof driver.isOnline !== 'boolean') driver.isOnline = false
  if (typeof driver.isAvailable !== 'boolean') driver.isAvailable = false
  if (!driver.approvalBadge) driver.approvalBadge = 'Pending'
}

function ensureRiderDefaults(rider) {
  if (!rider.verification) {
    rider.verification = { status: 'not_submitted' }
  }

  if (typeof rider.isVerified !== 'boolean') rider.isVerified = false
  if (!rider.approvalBadge) rider.approvalBadge = rider.isVerified ? 'Approved' : 'Pending'
}

function bootNormalizeData() {
  db.users.drivers.forEach(ensureDriverDefaults)
  db.users.riders.forEach(ensureRiderDefaults)
  saveData()
}

bootNormalizeData()

function driverSupportsService(driver, serviceType) {
  ensureDriverDefaults(driver)
  return driver.services.includes(serviceType)
}

function findNearestAvailableDriver(pickupLat, pickupLng, serviceType = 'ride') {
  const eligibleDrivers = db.users.drivers.filter((driver) => {
    ensureDriverDefaults(driver)

    return (
      driver.isApproved === true &&
      driver.isOnline === true &&
      driver.isAvailable === true &&
      typeof driver.location?.lat === 'number' &&
      typeof driver.location?.lng === 'number' &&
      driverSupportsService(driver, serviceType)
    )
  })

  if (!eligibleDrivers.length) return null

  let nearest = null
  let nearestDistance = Infinity

  for (const driver of eligibleDrivers) {
    const distance = getDistanceKm(
      pickupLat,
      pickupLng,
      driver.location.lat,
      driver.location.lng
    )

    if (distance < nearestDistance) {
      nearestDistance = distance
      nearest = driver
    }
  }

  if (!nearest) return null

  return {
    driver: nearest,
    distanceKm: Number(nearestDistance.toFixed(2))
  }
}

function findUserByEmail(email) {
  const normalizedEmail = normalizeEmail(email)

  return (
    db.users.riders.find((u) => normalizeEmail(u.email) === normalizedEmail) ||
    db.users.drivers.find((u) => normalizeEmail(u.email) === normalizedEmail) ||
    db.users.admins.find((u) => normalizeEmail(u.email) === normalizedEmail)
  )
}

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    time: new Date().toISOString(),
    message: 'Harvey Taxi API is running'
  })
})

app.post('/api/auth/register-rider', (req, res) => {
  try {
    const { name, email, password, phone } = req.body

    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Name, email, and password are required.' })
    }

    if (findUserByEmail(email)) {
      return res.status(409).json({ error: 'Email already exists.' })
    }

    const rider = {
      id: uid('rider'),
      role: 'rider',
      name: String(name).trim(),
      email: normalizeEmail(email),
      password: String(password),
      phone: String(phone || '').trim(),
      createdAt: new Date().toISOString(),
      isVerified: false,
      approvalBadge: 'Pending',
      verification: {
        status: 'not_submitted'
      }
    }

    db.users.riders.push(rider)
    saveData()

    res.json({
      message: 'Rider account created. Verification required before requesting service.',
      user: sanitizeUser(rider)
    })
  } catch (error) {
    console.error(error)
    res.status(500).json({ error: 'Failed to register rider.' })
  }
})

app.post('/api/auth/register-driver', (req, res) => {
  try {
    const { name, email, password, phone, vehicle, services } = req.body

    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Name, email, and password are required.' })
    }

    if (findUserByEmail(email)) {
      return res.status(409).json({ error: 'Email already exists.' })
    }

    const normalizedServices = Array.isArray(services) && services.length
      ? services.map(allowedServiceType)
      : ['ride', 'food', 'groceries']

    const driver = {
      id: uid('driver'),
      role: 'driver',
      name: String(name).trim(),
      email: normalizeEmail(email),
      password: String(password),
      phone: String(phone || '').trim(),
      vehicle: String(vehicle || '').trim(),
      services: [...new Set(normalizedServices)],
      createdAt: new Date().toISOString(),
      isApproved: false,
      isOnline: false,
      isAvailable: false,
      approvalBadge: 'Pending',
      location: {
        lat: null,
        lng: null,
        updatedAt: null
      },
      stats: {
        completedTrips: 0,
        completedFoodDeliveries: 0,
        completedGroceryDeliveries: 0,
        completedPackageDeliveries: 0
      },
      verification: {
        status: 'not_submitted'
      }
    }

    db.users.drivers.push(driver)
    saveData()

    res.json({
      message: 'Driver account created. Verification required before admin approval.',
      user: sanitizeUser(driver)
    })
  } catch (error) {
    console.error(error)
    res.status(500).json({ error: 'Failed to register driver.' })
  }
})

app.post('/api/auth/login', (req, res) => {
  try {
    const { email, password } = req.body

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' })
    }

    const allUsers = [
      ...db.users.riders,
      ...db.users.drivers,
      ...db.users.admins
    ]

    const user = allUsers.find(
      (u) => normalizeEmail(u.email) === normalizeEmail(email) && u.password === String(password)
    )

    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password.' })
    }

    res.json({
      message: 'Login successful.',
      user: sanitizeUser(user)
    })
  } catch (error) {
    console.error(error)
    res.status(500).json({ error: 'Login failed.' })
  }
})

app.post('/api/rider/verify', (req, res) => {
  try {
    const {
      riderId,
      name,
      email,
      phone,
      selfie,
      idFront,
      idBack,
      idNumber,
      idImage
    } = req.body

    let rider = null

    if (riderId) {
      rider = db.users.riders.find((r) => r.id === riderId)
    }

    if (!rider && email) {
      rider = db.users.riders.find((r) => normalizeEmail(r.email) === normalizeEmail(email))
    }

    if (!rider) {
      return res.status(404).json({ error: 'Rider not found.' })
    }

    rider.verification = {
      status: 'pending',
      submittedAt: new Date().toISOString(),
      name: String(name || rider.name || '').trim(),
      email: normalizeEmail(email || rider.email),
      phone: String(phone || rider.phone || '').trim(),
      selfie: selfie || '',
      idFront: idFront || idImage || '',
      idBack: idBack || '',
      idNumber: idNumber || ''
    }

    rider.isVerified = false
    rider.approvalBadge = 'Pending Verification'

    saveData()
    addNotification(rider.id, 'Your rider verification was submitted and is pending review.', 'verification')

    res.json({
      message: 'Rider verification submitted successfully.',
      rider: sanitizeUser(rider),
      status: rider.verification.status
    })
  } catch (error) {
    console.error(error)
    res.status(500).json({ error: 'Failed to submit rider verification.' })
  }
})

app.post('/api/driver/verify', (req, res) => {
  try {
    const {
      driverId,
      name,
      email,
      phone,
      licenseNumber,
      vehicleInfo,
      selfie,
      licenseImage,
      vehicleDocument
    } = req.body

    let driver = null

    if (driverId) {
      driver = db.users.drivers.find((d) => d.id === driverId)
    }

    if (!driver && email) {
      driver = db.users.drivers.find((d) => normalizeEmail(d.email) === normalizeEmail(email))
    }

    if (!driver) {
      return res.status(404).json({ error: 'Driver not found.' })
    }

    ensureDriverDefaults(driver)

    driver.verification = {
      status: 'pending',
      submittedAt: new Date().toISOString(),
      name: String(name || driver.name || '').trim(),
      email: normalizeEmail(email || driver.email),
      phone: String(phone || driver.phone || '').trim(),
      licenseNumber: String(licenseNumber || '').trim(),
      vehicleInfo: String(vehicleInfo || driver.vehicle || '').trim(),
      selfie: selfie || '',
      licenseImage: licenseImage || '',
      vehicleDocument: vehicleDocument || ''
    }

    driver.isApproved = false
    driver.isOnline = false
    driver.isAvailable = false
    driver.approvalBadge = 'Pending Verification'

    saveData()
    addNotification(driver.id, 'Your driver verification was submitted and is pending review.', 'verification')

    res.json({
      message: 'Driver verification submitted successfully.',
      driver: sanitizeUser(driver),
      status: driver.verification.status
    })
  } catch (error) {
    console.error(error)
    res.status(500).json({ error: 'Failed to submit driver verification.' })
  }
})

app.get('/api/admin/riders', (req, res) => {
  res.json(db.users.riders.map((rider) => {
    ensureRiderDefaults(rider)
    return sanitizeUser(rider)
  }))
})

app.get('/api/admin/drivers', (req, res) => {
  res.json(db.users.drivers.map((driver) => {
    ensureDriverDefaults(driver)
    return sanitizeUser(driver)
  }))
})

app.post('/api/admin/approve-rider/:riderId', (req, res) => {
  try {
    const { riderId } = req.params
    const rider = db.users.riders.find((r) => r.id === riderId)

    if (!rider) {
      return res.status(404).json({ error: 'Rider not found.' })
    }

    ensureRiderDefaults(rider)

    rider.isVerified = true
    rider.approvalBadge = 'Approved'
    rider.verifiedAt = new Date().toISOString()
    rider.verification.status = 'approved'
    rider.verification.reviewedAt = new Date().toISOString()

    saveData()
    addNotification(rider.id, 'Your rider account has been approved.', 'approval')

    res.json({
      message: 'Rider approved.',
      rider: sanitizeUser(rider)
    })
  } catch (error) {
    console.error(error)
    res.status(500).json({ error: 'Failed to approve rider.' })
  }
})

app.post('/api/admin/reject-rider/:riderId', (req, res) => {
  try {
    const { riderId } = req.params
    const rider = db.users.riders.find((r) => r.id === riderId)

    if (!rider) {
      return res.status(404).json({ error: 'Rider not found.' })
    }

    ensureRiderDefaults(rider)

    rider.isVerified = false
    rider.approvalBadge = 'Rejected'
    rider.rejectedAt = new Date().toISOString()
    rider.verification.status = 'rejected'
    rider.verification.reviewedAt = new Date().toISOString()

    saveData()
    addNotification(rider.id, 'Your rider verification was rejected or needs review.', 'approval')

    res.json({
      message: 'Rider rejected.',
      rider: sanitizeUser(rider)
    })
  } catch (error) {
    console.error(error)
    res.status(500).json({ error: 'Failed to reject rider.' })
  }
})

app.post('/api/admin/approve-driver/:driverId', (req, res) => {
  try {
    const { driverId } = req.params
    const driver = db.users.drivers.find((d) => d.id === driverId)

    if (!driver) {
      return res.status(404).json({ error: 'Driver not found.' })
    }

    ensureDriverDefaults(driver)

    driver.isApproved = true
    driver.isOnline = true
    driver.isAvailable = true
    driver.approvalBadge = 'Approved'
    driver.approvedAt = new Date().toISOString()
    driver.verification.status = 'approved'
    driver.verification.reviewedAt = new Date().toISOString()

    saveData()
    addNotification(driver.id, 'Your driver account has been approved and auto-enabled.', 'approval')

    res.json({
      message: 'Driver approved and auto-enabled.',
      driver: sanitizeUser(driver)
    })
  } catch (error) {
    console.error(error)
    res.status(500).json({ error: 'Failed to approve driver.' })
  }
})

app.post('/api/admin/reject-driver/:driverId', (req, res) => {
  try {
    const { driverId } = req.params
    const driver = db.users.drivers.find((d) => d.id === driverId)

    if (!driver) {
      return res.status(404).json({ error: 'Driver not found.' })
    }

    ensureDriverDefaults(driver)

    driver.isApproved = false
    driver.isOnline = false
    driver.isAvailable = false
    driver.approvalBadge = 'Rejected'
    driver.rejectedAt = new Date().toISOString()
    driver.verification.status = 'rejected'
    driver.verification.reviewedAt = new Date().toISOString()

    saveData()
    addNotification(driver.id, 'Your driver verification was rejected or needs review.', 'approval')

    res.json({
      message: 'Driver rejected.',
      driver: sanitizeUser(driver)
    })
  } catch (error) {
    console.error(error)
    res.status(500).json({ error: 'Failed to reject driver.' })
  }
})

app.post('/api/drivers/location', (req, res) => {
  try {
    const { driverId, lat, lng } = req.body
    const driver = db.users.drivers.find((d) => d.id === driverId)

    if (!driver) {
      return res.status(404).json({ error: 'Driver not found.' })
    }

    const parsedLat = toNumber(lat)
    const parsedLng = toNumber(lng)

    if (parsedLat === null || parsedLng === null) {
      return res.status(400).json({ error: 'Valid latitude and longitude are required.' })
    }

    driver.location = {
      lat: parsedLat,
      lng: parsedLng,
      updatedAt: new Date().toISOString()
    }

    const liveDriver = db.liveDrivers.find((d) => d.id === driverId)
    if (liveDriver) {
      liveDriver.lat = parsedLat
      liveDriver.lng = parsedLng
      liveDriver.available = driver.isAvailable
      liveDriver.services = driver.services
    } else {
      db.liveDrivers.push({
        id: driverId,
        lat: parsedLat,
        lng: parsedLng,
        available: driver.isAvailable,
        services: driver.services
      })
    }

    saveData()

    res.json({
      message: 'Driver location updated.',
      driver: sanitizeUser(driver)
    })
  } catch (error) {
    console.error(error)
    res.status(500).json({ error: 'Failed to update driver location.' })
  }
})

app.post('/api/drivers/status', (req, res) => {
  try {
    const { driverId, isOnline, isAvailable } = req.body
    const driver = db.users.drivers.find((d) => d.id === driverId)

    if (!driver) {
      return res.status(404).json({ error: 'Driver not found.' })
    }

    ensureDriverDefaults(driver)

    if (!driver.isApproved) {
      return res.status(403).json({ error: 'Driver must be approved first.' })
    }

    if (typeof isOnline === 'boolean') driver.isOnline = isOnline
    if (typeof isAvailable === 'boolean') driver.isAvailable = isAvailable

    const liveDriver = db.liveDrivers.find((d) => d.id === driverId)
    if (liveDriver) {
      liveDriver.available = driver.isAvailable
      liveDriver.services = driver.services
    }

    saveData()

    res.json({
      message: 'Driver status updated.',
      driver: sanitizeUser(driver)
    })
  } catch (error) {
    console.error(error)
    res.status(500).json({ error: 'Failed to update driver status.' })
  }
})

app.post('/driver/location', (req, res) => {
  try {
    const { driverId, lat, lng, services } = req.body
    const parsedLat = toNumber(lat)
    const parsedLng = toNumber(lng)

    if (!driverId || parsedLat === null || parsedLng === null) {
      return res.status(400).json({ error: 'driverId, lat, and lng are required.' })
    }

    let liveDriver = db.liveDrivers.find((d) => d.id === driverId)

    if (!liveDriver) {
      liveDriver = {
        id: driverId,
        lat: parsedLat,
        lng: parsedLng,
        services: Array.isArray(services) && services.length ? services.map(allowedServiceType) : ['ride', 'food', 'groceries'],
        available: true
      }
      db.liveDrivers.push(liveDriver)
    } else {
      liveDriver.lat = parsedLat
      liveDriver.lng = parsedLng
      liveDriver.services = Array.isArray(services) && services.length ? services.map(allowedServiceType) : liveDriver.services
      liveDriver.available = true
    }

    const driver = db.users.drivers.find((d) => d.id === driverId)
    if (driver) {
      ensureDriverDefaults(driver)
      driver.location = {
        lat: parsedLat,
        lng: parsedLng,
        updatedAt: new Date().toISOString()
      }
      driver.isOnline = true
      if (!Array.isArray(driver.services) || !driver.services.length) {
        driver.services = liveDriver.services
      }
    }

    saveData()
    res.json({ status: 'updated', driver: liveDriver })
  } catch (error) {
    console.error(error)
    res.status(500).json({ error: 'Failed to update live driver location.' })
  }
})

app.post('/request', (req, res) => {
  try {
    const { type, pickupLat, pickupLng, dropoff, details } = req.body
    const serviceType = allowedServiceType(type)
    const parsedPickupLat = toNumber(pickupLat)
    const parsedPickupLng = toNumber(pickupLng)

    if (parsedPickupLat === null || parsedPickupLng === null) {
      return res.status(400).json({ error: 'pickupLat and pickupLng are required.' })
    }

    let nearest = null
    let minDistance = Infinity

    db.liveDrivers.forEach((driver) => {
      if (driver.available && Array.isArray(driver.services) && driver.services.includes(serviceType)) {
        const d = getDistanceKm(parsedPickupLat, parsedPickupLng, driver.lat, driver.lng)
        if (d < minDistance) {
          minDistance = d
          nearest = driver
        }
      }
    })

    if (!nearest) {
      return res.json({
        status: 'searching',
        message: 'No drivers yet'
      })
    }

    nearest.available = false

    const requestItem = {
      id: uid('req'),
      type: serviceType,
      driverId: nearest.id,
      dropoff: dropoff || '',
      details: details || '',
      status: 'assigned',
      pickupLat: parsedPickupLat,
      pickupLng: parsedPickupLng,
      createdAt: new Date().toISOString()
    }

    db.serviceRequests.push(requestItem)
    saveData()

    res.json({
      status: 'assigned',
      driver: nearest,
      request: requestItem
    })
  } catch (error) {
    console.error(error)
    res.status(500).json({ error: 'Failed to create simple dispatch request.' })
  }
})

app.post('/api/requests/create', (req, res) => {
  try {
    const {
      riderId,
      serviceType,
      pickupAddress,
      dropoffAddress,
      pickupLat,
      pickupLng,
      dropoffLat,
      dropoffLng,
      notes
    } = req.body

    const rider = db.users.riders.find((r) => r.id === riderId)

    if (!rider) {
      return res.status(404).json({ error: 'Rider not found.' })
    }

    ensureRiderDefaults(rider)

    if (!rider.isVerified) {
      return res.status(403).json({ error: 'Rider must be verified and approved before creating requests.' })
    }

    const parsedPickupLat = toNumber(pickupLat)
    const parsedPickupLng = toNumber(pickupLng)

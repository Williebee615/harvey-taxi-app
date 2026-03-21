const express = require('express')
const cors = require('cors')
const path = require('path')
const multer = require('multer')
const fs = require('fs')

const app = express()
const PORT = process.env.PORT || 10000

app.use(cors())
app.use(express.json())
app.use(express.static(path.join(__dirname, 'public')))

const publicDir = path.join(__dirname, 'public')
const uploadDir = path.join(publicDir, 'uploads')
const dataDir = path.join(__dirname, 'data')
const verificationFile = path.join(dataDir, 'verificationQueue.json')
const approvedFile = path.join(dataDir, 'approvedDrivers.json')
const requestsFile = path.join(dataDir, 'serviceRequests.json')
const onlineDriversFile = path.join(dataDir, 'onlineDrivers.json')

if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true })
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true })
if (!fs.existsSync(verificationFile)) fs.writeFileSync(verificationFile, '[]')
if (!fs.existsSync(approvedFile)) fs.writeFileSync(approvedFile, '[]')
if (!fs.existsSync(requestsFile)) fs.writeFileSync(requestsFile, '[]')
if (!fs.existsSync(onlineDriversFile)) fs.writeFileSync(onlineDriversFile, '[]')

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch (error) {
    return []
  }
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2))
}

function getVerificationQueue() {
  return readJson(verificationFile)
}

function saveVerificationQueue(data) {
  writeJson(verificationFile, data)
}

function getApprovedDrivers() {
  return readJson(approvedFile)
}

function saveApprovedDrivers(data) {
  writeJson(approvedFile, data)
}

function getServiceRequests() {
  return readJson(requestsFile)
}

function saveServiceRequests(data) {
  writeJson(requestsFile, data)
}

function getOnlineDrivers() {
  return readJson(onlineDriversFile)
}

function saveOnlineDrivers(data) {
  writeJson(onlineDriversFile, data)
}

function getDistanceKm(lat1, lng1, lat2, lng2) {
  const toRad = (value) => (value * Math.PI) / 180
  const R = 6371
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2)

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir)
  },
  filename: function (req, file, cb) {
    const safeOriginal = file.originalname.replace(/\s+/g, '-')
    cb(null, `${Date.now()}-${safeOriginal}`)
  }
})

const upload = multer({ storage })

app.get('/', (req, res) => {
  res.send('Harvey Taxi API Running')
})

/* ===============================
   DRIVER VERIFICATION
================================ */
app.post(
  '/api/driver/verify',
  upload.fields([
    { name: 'license', maxCount: 1 },
    { name: 'selfie', maxCount: 1 },
    { name: 'vehicle', maxCount: 1 }
  ]),
  (req, res) => {
    try {
      const { name, email, phone } = req.body

      if (!name || !email) {
        return res.status(400).json({
          success: false,
          message: 'Name and email are required'
        })
      }

      const verificationQueue = getVerificationQueue()

      const verification = {
        id: Date.now(),
        name,
        email,
        phone: phone || '',
        license: req.files?.license?.[0]?.filename || '',
        selfie: req.files?.selfie?.[0]?.filename || '',
        vehicle: req.files?.vehicle?.[0]?.filename || '',
        status: 'pending',
        notes: '',
        submittedAt: new Date().toISOString(),
        reviewedAt: ''
      }

      verificationQueue.push(verification)
      saveVerificationQueue(verificationQueue)

      res.json({
        success: true,
        message: 'Verification submitted successfully',
        verification
      })
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Verification submission failed'
      })
    }
  }
)

app.get('/api/admin/verifications', (req, res) => {
  res.json(getVerificationQueue())
})

app.post('/api/admin/approve/:id', (req, res) => {
  const id = parseInt(req.params.id, 10)
  const verificationQueue = getVerificationQueue()
  const approvedDrivers = getApprovedDrivers()

  const driver = verificationQueue.find(v => v.id === id)

  if (!driver) {
    return res.status(404).json({ error: 'Not found' })
  }

  driver.status = 'approved'
  driver.notes = 'Approved by admin'
  driver.reviewedAt = new Date().toISOString()

  const alreadyApproved = approvedDrivers.find(d => d.id === driver.id)
  if (!alreadyApproved) {
    approvedDrivers.push(driver)
  } else {
    const idx = approvedDrivers.findIndex(d => d.id === driver.id)
    approvedDrivers[idx] = driver
  }

  saveVerificationQueue(verificationQueue)
  saveApprovedDrivers(approvedDrivers)

  res.json({ success: true })
})

app.post('/api/admin/reject/:id', (req, res) => {
  const id = parseInt(req.params.id, 10)
  const verificationQueue = getVerificationQueue()

  const driver = verificationQueue.find(v => v.id === id)

  if (!driver) {
    return res.status(404).json({ error: 'Not found' })
  }

  driver.status = 'rejected'
  driver.notes = 'Rejected by admin'
  driver.reviewedAt = new Date().toISOString()

  saveVerificationQueue(verificationQueue)

  res.json({ success: true })
})

app.get('/api/driver/verification-status', (req, res) => {
  const email = (req.query.email || '').trim().toLowerCase()
  const verificationQueue = getVerificationQueue()

  if (!email) {
    return res.status(400).json({
      success: false,
      message: 'Email is required'
    })
  }

  const verification = [...verificationQueue]
    .reverse()
    .find(v => (v.email || '').toLowerCase() === email)

  if (!verification) {
    return res.json({
      success: true,
      verification: null
    })
  }

  res.json({
    success: true,
    verification
  })
})

app.get('/api/driver/access', (req, res) => {
  const email = (req.query.email || '').trim().toLowerCase()
  const verificationQueue = getVerificationQueue()

  if (!email) {
    return res.status(400).json({
      success: false,
      message: 'Email is required'
    })
  }

  const driver = [...verificationQueue]
    .reverse()
    .find(v => (v.email || '').toLowerCase() === email)

  if (!driver) {
    return res.json({
      success: false,
      message: 'No verification found'
    })
  }

  return res.json({
    success: true,
    driver
  })
})

app.get('/api/drivers/approved', (req, res) => {
  res.json(getApprovedDrivers())
})

/* ===============================
   DRIVER ONLINE / LOCATION
================================ */
app.post('/api/driver/go-online', (req, res) => {
  const { email, lat, lng } = req.body
  const approvedDrivers = getApprovedDrivers()
  const onlineDrivers = getOnlineDrivers()

  if (!email) {
    return res.status(400).json({
      success: false,
      message: 'Email is required'
    })
  }

  const approvedDriver = approvedDrivers.find(
    d => (d.email || '').toLowerCase() === String(email).toLowerCase()
  )

  if (!approvedDriver) {
    return res.status(403).json({
      success: false,
      message: 'Driver is not approved'
    })
  }

  const existingIndex = onlineDrivers.findIndex(
    d => (d.email || '').toLowerCase() === String(email).toLowerCase()
  )

  const onlineRecord = {
    id: approvedDriver.id,
    name: approvedDriver.name,
    email: approvedDriver.email,
    phone: approvedDriver.phone || '',
    lat: Number(lat) || 36.1627,
    lng: Number(lng) || -86.7816,
    isOnline: true,
    updatedAt: new Date().toISOString()
  }

  if (existingIndex >= 0) {
    onlineDrivers[existingIndex] = onlineRecord
  } else {
    onlineDrivers.push(onlineRecord)
  }

  saveOnlineDrivers(onlineDrivers)

  res.json({
    success: true,
    message: 'Driver is now online',
    driver: onlineRecord
  })
})

app.post('/api/driver/update-location', (req, res) => {
  const { email, lat, lng } = req.body
  const onlineDrivers = getOnlineDrivers()

  const driverIndex = onlineDrivers.findIndex(
    d => (d.email || '').toLowerCase() === String(email || '').toLowerCase()
  )

  if (driverIndex === -1) {
    return res.status(404).json({
      success: false,
      message: 'Online driver not found'
    })
  }

  onlineDrivers[driverIndex].lat = Number(lat)
  onlineDrivers[driverIndex].lng = Number(lng)
  onlineDrivers[driverIndex].updatedAt = new Date().toISOString()

  saveOnlineDrivers(onlineDrivers)

  res.json({
    success: true,
    driver: onlineDrivers[driverIndex]
  })
})

app.post('/api/driver/go-offline', (req, res) => {
  const { email } = req.body
  const onlineDrivers = getOnlineDrivers().filter(
    d => (d.email || '').toLowerCase() !== String(email || '').toLowerCase()
  )

  saveOnlineDrivers(onlineDrivers)

  res.json({
    success: true,
    message: 'Driver is now offline'
  })
})

app.get('/api/drivers/online', (req, res) => {
  res.json(getOnlineDrivers())
})

/* ===============================
   REQUEST + DISPATCH
================================ */
app.post('/api/request-service', (req, res) => {
  const {
    name,
    phone,
    pickup,
    dropoff,
    serviceType,
    riderLat,
    riderLng
  } = req.body

  if (!name || !phone || !pickup || !serviceType) {
    return res.status(400).json({
      success: false,
      message: 'Missing required fields'
    })
  }

  const onlineDrivers = getOnlineDrivers().filter(d => d.isOnline)

  if (!onlineDrivers.length) {
    return res.json({
      success: false,
      message: 'No approved online drivers available right now'
    })
  }

  const riderLatitude = Number(riderLat) || 36.1627
  const riderLongitude = Number(riderLng) || -86.7816

  const rankedDrivers = onlineDrivers
    .map(driver => ({
      ...driver,
      distanceKm: getDistanceKm(
        riderLatitude,
        riderLongitude,
        Number(driver.lat),
        Number(driver.lng)
      )
    }))
    .sort((a, b) => a.distanceKm - b.distanceKm)

  const assignedDriver = rankedDrivers[0]

  const serviceRequests = getServiceRequests()

  const request = {
    id: `req_${Date.now()}`,
    riderName: name,
    riderPhone: phone,
    pickup,
    dropoff: dropoff || '',
    serviceType,
    riderLat: riderLatitude,
    riderLng: riderLongitude,
    assignedDriverId: assignedDriver.id,
    assignedDriverEmail: assignedDriver.email,
    assignedDriverName: assignedDriver.name,
    estimatedDistanceKm: Number(assignedDriver.distanceKm.toFixed(2)),
    status: 'driver_assigned',
    createdAt: new Date().toISOString(),
    acceptedAt: '',
    declinedAt: '',
    completedAt: ''
  }

  serviceRequests.push(request)
  saveServiceRequests(serviceRequests)

  res.json({
    success: true,
    message: 'Driver assigned successfully',
    request
  })
})

app.get('/api/driver/requests', (req, res) => {
  const email = (req.query.email || '').trim().toLowerCase()
  const requests = getServiceRequests()

  const driverRequests = requests
    .filter(r => (r.assignedDriverEmail || '').toLowerCase() === email)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))

  res.json({
    success: true,
    requests: driverRequests
  })
})

app.post('/api/driver/requests/:id/accept', (req, res) => {
  const requestId = req.params.id
  const requests = getServiceRequests()
  const requestIndex = requests.findIndex(r => r.id === requestId)

  if (requestIndex === -1) {
    return res.status(404).json({
      success: false,
      message: 'Request not found'
    })
  }

  requests[requestIndex].status = 'accepted'
  requests[requestIndex].acceptedAt = new Date().toISOString()

  saveServiceRequests(requests)

  res.json({
    success: true,
    request: requests[requestIndex]
  })
})

app.post('/api/driver/requests/:id/decline', (req, res) => {
  const requestId = req.params.id
  const requests = getServiceRequests()
  const onlineDrivers = getOnlineDrivers().filter(d => d.isOnline)

  const requestIndex = requests.findIndex(r => r.id === requestId)

  if (requestIndex === -1) {
    return res.status(404).json({
      success: false,
      message: 'Request not found'
    })
  }

  const currentRequest = requests[requestIndex]
  currentRequest.status = 'declined'
  currentRequest.declinedAt = new Date().toISOString()

  const nextDrivers = onlineDrivers
    .filter(d => d.email !== currentRequest.assignedDriverEmail)
    .map(driver => ({
      ...driver,
      distanceKm: getDistanceKm(
        Number(currentRequest.riderLat),
        Number(currentRequest.riderLng),
        Number(driver.lat),
        Number(driver.lng)
      )
    }))
    .sort((a, b) => a.distanceKm - b.distanceKm)

  if (nextDrivers.length > 0) {
    const nextDriver = nextDrivers[0]
    currentRequest.assignedDriverId = nextDriver.id
    currentRequest.assignedDriverEmail = nextDriver.email
    currentRequest.assignedDriverName = nextDriver.name
    currentRequest.estimatedDistanceKm = Number(nextDriver.distanceKm.toFixed(2))
    currentRequest.status = 'driver_assigned'
  }

  saveServiceRequests(requests)

  res.json({
    success: true,
    request: currentRequest
  })
})

app.get('/api/request-status/:id', (req, res) => {
  const requests = getServiceRequests()
  const request = requests.find(r => r.id === req.params.id)

  if (!request) {
    return res.status(404).json({
      success: false,
      message: 'Request not found'
    })
  }

  res.json({
    success: true,
    request
  })
})

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`)
})

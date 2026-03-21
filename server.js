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

if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true })
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true })
if (!fs.existsSync(verificationFile)) fs.writeFileSync(verificationFile, '[]')
if (!fs.existsSync(approvedFile)) fs.writeFileSync(approvedFile, '[]')

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
  const verificationQueue = getVerificationQueue()
  res.json(verificationQueue)
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
  const approvedDrivers = getApprovedDrivers()
  res.json(approvedDrivers)
})

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`)
})

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


// Ensure uploads folder exists
const uploadDir = path.join(__dirname, 'public/uploads')
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true })
}


// Multer storage
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'public/uploads')
  },
  filename: function (req, file, cb) {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1E9)
    cb(null, unique + '-' + file.originalname)
  }
})

const upload = multer({ storage })



let drivers = []
let verificationQueue = []



/* ===============================
   DRIVER VERIFICATION SUBMIT
================================ */
app.post('/api/driver/verify',
  upload.fields([
    { name: 'license', maxCount: 1 },
    { name: 'selfie', maxCount: 1 },
    { name: 'vehicle', maxCount: 1 }
  ]),
  (req, res) => {

    const { name, email, phone } = req.body

    const verification = {
      id: Date.now(),
      name,
      email,
      phone,
      license: req.files.license?.[0]?.filename,
      selfie: req.files.selfie?.[0]?.filename,
      vehicle: req.files.vehicle?.[0]?.filename,
      status: 'pending',
      notes: '',
      submittedAt: new Date().toISOString()
    }

    verificationQueue.push(verification)

    res.json({
      success: true,
      message: 'Verification submitted',
      verification
    })
  }
)



/* ===============================
   ADMIN GET VERIFICATIONS
================================ */
app.get('/api/admin/verifications', (req, res) => {
  res.json(verificationQueue)
})



/* ===============================
   ADMIN APPROVE DRIVER
================================ */
app.post('/api/admin/approve/:id', (req, res) => {
  const id = parseInt(req.params.id)

  const driver = verificationQueue.find(v => v.id === id)

  if (!driver) {
    return res.status(404).json({ error: 'Not found' })
  }

  driver.status = 'approved'
  driver.notes = 'Approved by admin'
  driver.reviewedAt = new Date().toISOString()

  const alreadyExists = drivers.find(d => d.id === driver.id)

  if (!alreadyExists) {
    drivers.push(driver)
  }

  res.json({ success: true })
})



/* ===============================
   ADMIN REJECT DRIVER
================================ */
app.post('/api/admin/reject/:id', (req, res) => {
  const id = parseInt(req.params.id)

  const driver = verificationQueue.find(v => v.id === id)

  if (!driver) {
    return res.status(404).json({ error: 'Not found' })
  }

  driver.status = 'rejected'
  driver.notes = 'Rejected by admin'
  driver.reviewedAt = new Date().toISOString()

  res.json({ success: true })
})



/* ===============================
   DRIVER STATUS CHECK
================================ */
app.get('/api/driver/verification-status', (req, res) => {
  const email = (req.query.email || '').trim().toLowerCase()

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



/* ===============================
   DRIVER ACCESS (APPROVED ONLY)
================================ */
app.get('/api/driver/access', (req, res) => {
  const email = (req.query.email || '').trim().toLowerCase()

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



/* ===============================
   GET APPROVED DRIVERS
================================ */
app.get('/api/drivers', (req, res) => {
  const approved = verificationQueue.filter(
    d => d.status === 'approved'
  )

  res.json(approved)
})



app.listen(PORT, () => {
  console.log('Server running on port', PORT)
})

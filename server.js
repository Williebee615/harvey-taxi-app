const express = require('express')
const cors = require('cors')
const path = require('path')
const multer = require('multer')

const app = express()
const PORT = process.env.PORT || 10000

app.use(cors())
app.use(express.json())
app.use(express.static(path.join(__dirname, 'public')))

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'public/uploads/')
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + '-' + file.originalname)
  }
})

const upload = multer({ storage })

let driverVerifications = []

app.post('/api/driver/verify',
  upload.fields([
    { name: 'licenseFront' },
    { name: 'licenseBack' },
    { name: 'selfie' },
    { name: 'insurance' },
    { name: 'registration' }
  ]),
  (req, res) => {

    const data = {
      id: Date.now().toString(),
      fullName: req.body.fullName,
      email: req.body.email,
      phone: req.body.phone,
      vehicleMake: req.body.vehicleMake,
      vehicleModel: req.body.vehicleModel,
      vehicleYear: req.body.vehicleYear,
      licenseNumber: req.body.licenseNumber,
      status: 'pending',
      submittedAt: new Date(),
      licenseFront: req.files.licenseFront?.[0]?.path,
      licenseBack: req.files.licenseBack?.[0]?.path,
      selfie: req.files.selfie?.[0]?.path,
      insurance: req.files.insurance?.[0]?.path,
      registration: req.files.registration?.[0]?.path
    }

    driverVerifications.push(data)

    res.json({
      success: true,
      message: 'Verification submitted'
    })
})

app.get('/api/admin/verifications', (req, res) => {
  res.json({
    success: true,
    verifications: driverVerifications
  })
})

app.post('/api/admin/verifications/:id/review', (req, res) => {
  const { id } = req.params
  const { status, notes } = req.body

  const verification = driverVerifications.find(v => v.id === id)

  if (!verification) {
    return res.json({ success: false })
  }

  verification.status = status
  verification.notes = notes
  verification.reviewedAt = new Date()

  res.json({ success: true })
})

app.get('/', (req, res) => {
  res.send('Harvey Taxi API Running')
})

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`)
})

app.post(
  '/api/drivers/verification',
  upload.fields([
    { name: 'licenseFront', maxCount: 1 },
    { name: 'licenseBack', maxCount: 1 },
    { name: 'selfie', maxCount: 1 },
    { name: 'insurance', maxCount: 1 },
    { name: 'registration', maxCount: 1 }
  ]),
  (req, res) => {
    try {
      const { driverId, fullName, email, phone, vehicleMake, vehicleModel, vehicleYear, licenseNumber } = req.body

      if (!driverId || !fullName || !email) {
        return res.status(400).json({
          success: false,
          message: 'driverId, fullName, and email are required'
        })
      }

      const existingIndex = driverVerifications.findIndex(v => v.driverId === driverId)

      const verificationRecord = {
        id: `ver_${Date.now()}`,
        driverId,
        fullName,
        email,
        phone: phone || '',
        vehicleMake: vehicleMake || '',
        vehicleModel: vehicleModel || '',
        vehicleYear: vehicleYear || '',
        licenseNumber: licenseNumber || '',
        licenseFront: req.files?.licenseFront?.[0]
          ? `/uploads/verification/${req.files.licenseFront[0].filename}`
          : '',
        licenseBack: req.files?.licenseBack?.[0]
          ? `/uploads/verification/${req.files.licenseBack[0].filename}`
          : '',
        selfie: req.files?.selfie?.[0]
          ? `/uploads/verification/${req.files.selfie[0].filename}`
          : '',
        insurance: req.files?.insurance?.[0]
          ? `/uploads/verification/${req.files.insurance[0].filename}`
          : '',
        registration: req.files?.registration?.[0]
          ? `/uploads/verification/${req.files.registration[0].filename}`
          : '',
        status: 'pending',
        notes: '',
        submittedAt: new Date().toISOString(),
        reviewedAt: '',
        reviewedBy: ''
      }

      if (existingIndex >= 0) {
        driverVerifications[existingIndex] = {
          ...driverVerifications[existingIndex],
          ...verificationRecord,
          id: driverVerifications[existingIndex].id,
          status: 'pending',
          notes: '',
          reviewedAt: '',
          reviewedBy: ''
        }

        return res.json({
          success: true,
          message: 'Verification resubmitted successfully',
          verification: driverVerifications[existingIndex]
        })
      }

      driverVerifications.push(verificationRecord)

      res.json({
        success: true,
        message: 'Verification submitted successfully',
        verification: verificationRecord
      })
    } catch (error) {
      console.error('Verification upload error:', error)
      res.status(500).json({
        success: false,
        message: 'Failed to submit verification'
      })
    }
  }
)

app.get('/api/drivers/verification/:driverId', (req, res) => {
  const verification = driverVerifications.find(v => v.driverId === req.params.driverId)

  if (!verification) {
    return res.status(404).json({
      success: false,
      message: 'No verification found'
    })
  }

  res.json({
    success: true,
    verification
  })
})

app.get('/api/admin/verifications', (req, res) => {
  res.json({
    success: true,
    verifications: driverVerifications.sort(
      (a, b) => new Date(b.submittedAt) - new Date(a.submittedAt)
    )
  })
})

app.post('/api/admin/verifications/:id/review', (req, res) => {
  const { status, notes, reviewedBy } = req.body

  if (!['approved', 'rejected', 'pending'].includes(status)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid status'
    })
  }

  const verification = driverVerifications.find(v => v.id === req.params.id)

  if (!verification) {
    return res.status(404).json({
      success: false,
      message: 'Verification not found'
    })
  }

  verification.status = status
  verification.notes = notes || ''
  verification.reviewedBy = reviewedBy || 'Admin'
  verification.reviewedAt = new Date().toISOString()

  const driver = users.drivers.find(d => d.id === verification.driverId)
  if (driver) {
    driver.verificationStatus = status
    driver.verificationNotes = verification.notes
  }

  res.json({
    success: true,
    message: `Driver verification ${status}`,
    verification
  })
})const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, verificationDir)
  },
  filename: function (req, file, cb) {
    const safeName = file.originalname.replace(/\s+/g, '-')
    cb(null, `${Date.now()}-${safeName}`)
  }
})

const upload = multer({ storage })let driverVerifications = []const uploadsDir = path.join(__dirname, 'uploads')
const verificationDir = path.join(uploadsDir, 'verification')

if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir)
if (!fs.existsSync(verificationDir)) fs.mkdirSync(verificationDir, { recursive: true })

app.use('/uploads', express.static(uploadsDir))const fs = require('fs')
const multer = require('multer')const express = require('express')
const cors = require('cors')
const path = require('path')

const app = express()
const PORT = process.env.PORT || 10000

app.use(cors())
app.use(express.json())
app.use(express.urlencoded({ extended: true }))
app.use(express.static(path.join(__dirname, 'public')))

// ADMIN CONFIG
const ADMIN_EMAIL = 'admin@harveytaxi.com'
const ADMIN_PASSWORD = 'admin123'
const ADMIN_SECRET_PATH = 'control-center-879'

// MEMORY
let drivers = []
let rides = []
let deliveries = []

// HOME
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'))
})

// HEALTH
app.get('/health', (req, res) => {
  res.json({ success: true, status: 'Harvey Taxi running' })
})

// ADMIN LOGIN PAGE
app.get('/admin', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>Harvey Taxi Admin</title>
      <style>
        body {
          margin: 0;
          font-family: Arial, sans-serif;
          background: #eef1f6;
          padding: 30px 16px;
        }
        .box {
          max-width: 420px;
          margin: 40px auto;
          background: white;
          padding: 24px;
          border-radius: 20px;
          box-shadow: 0 10px 30px rgba(0,0,0,0.08);
        }
        h1 {
          margin: 0 0 10px;
          font-size: 30px;
          color: #081633;
        }
        p {
          color: #666;
          margin-bottom: 18px;
        }
        input {
          width: 100%;
          box-sizing: border-box;
          padding: 16px;
          margin-bottom: 12px;
          border-radius: 14px;
          border: 2px solid #ddd;
          font-size: 16px;
        }
        button {
          width: 100%;
          padding: 16px;
          border: none;
          border-radius: 14px;
          background: #081633;
          color: white;
          font-size: 18px;
          font-weight: 700;
          cursor: pointer;
        }
        #msg {
          margin-top: 12px;
          color: #b91c1c;
          font-weight: 700;
        }
      </style>
    </head>
    <body>
      <div class="box">
        <h1>🔐 Harvey Taxi Admin Login</h1>
        <p>Private access only.</p>

        <input id="email" type="email" placeholder="Admin email" />
        <input id="password" type="password" placeholder="Password" />

        <button onclick="login()">Enter Admin Dashboard</button>

        <div id="msg"></div>
      </div>

      <script>
        async function login() {
          const msg = document.getElementById('msg')
          msg.innerText = ''

          try {
            const res = await fetch('/admin/login', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                email: document.getElementById('email').value,
                password: document.getElementById('password').value
              })
            })

            const data = await res.json()

            if (data.success) {
              window.location.href = data.redirect
            } else {
              msg.innerText = data.message || 'Login failed'
            }
          } catch (error) {
            msg.innerText = 'Server error while logging in'
          }
        }
      </script>
    </body>
    </html>
  `)
})

// ADMIN LOGIN API
app.post('/admin/login', (req, res) => {
  try {
    const { email, password } = req.body

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Missing email or password'
      })
    }

    if (email === ADMIN_EMAIL && password === ADMIN_PASSWORD) {
      return res.json({
        success: true,
        redirect: '/' + ADMIN_SECRET_PATH
      })
    }

    return res.status(401).json({
      success: false,
      message: 'Invalid admin login'
    })
  } catch (error) {
    console.error('ADMIN LOGIN ERROR:', error)
    return res.status(500).json({
      success: false,
      message: 'Server error while logging in'
    })
  }
})

// ADMIN DASHBOARD
app.get('/' + ADMIN_SECRET_PATH, (req, res) => {
  const driverItems = drivers.length
    ? drivers.map((d) => `
        <div class="item">
          ${d.name || d.id || 'Driver'} - ${d.online ? 'Online' : 'Offline'}
        </div>
      `).join('')
    : '<div class="item">No drivers yet</div>'

  const rideItems = rides.length
    ? rides.map((r) => `
        <div class="item">
          ${(r.pickup || 'Pickup')} → ${(r.dropoff || 'Dropoff')} (${r.status || 'requested'})
        </div>
      `).join('')
    : '<div class="item">No rides yet</div>'

  const deliveryItems = deliveries.length
    ? deliveries.map((d) => `
        <div class="item">
          ${(d.item || 'Delivery item')} (${d.status || 'pending'})
        </div>
      `).join('')
    : '<div class="item">No deliveries yet</div>'

  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>Harvey Taxi Admin Dashboard</title>
      <style>
        body {
          margin: 0;
          font-family: Arial, sans-serif;
          background: #0f172a;
          color: white;
          padding: 20px;
        }
        h1 {
          margin-top: 0;
          font-size: 32px;
        }
        .grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
          gap: 16px;
          margin: 20px 0;
        }
        .card {
          background: #111827;
          border-radius: 18px;
          padding: 20px;
        }
        .big {
          font-size: 32px;
          font-weight: 800;
          margin-top: 8px;
        }
        .section {
          background: #111827;
          border-radius: 18px;
          padding: 20px;
          margin-top: 18px;
        }
        .item {
          padding: 10px 0;
          border-bottom: 1px solid #243041;
        }
      </style>
    </head>
    <body>
      <h1>Harvey Taxi Admin Dashboard</h1>

      <div class="grid">
        <div class="card">
          <div>Total Drivers</div>
          <div class="big">${drivers.length}</div>
        </div>
        <div class="card">
          <div>Total Rides</div>
          <div class="big">${rides.length}</div>
        </div>
        <div class="card">
          <div>Total Deliveries</div>
          <div class="big">${deliveries.length}</div>
        </div>
      </div>

      <div class="section">
        <h2>Drivers</h2>
        ${driverItems}
      </div>

      <div class="section">
        <h2>Rides</h2>
        ${rideItems}
      </div>

      <div class="section">
        <h2>Deliveries</h2>
        ${deliveryItems}
      </div>
    </body>
    </html>
  `)
})

// DRIVER UPDATE
app.post('/driver/update', (req, res) => {
  const { id, lat, lng, name } = req.body

  if (!id) {
    return res.status(400).json({
      success: false,
      message: 'Driver id is required'
    })
  }

  let driver = drivers.find((d) => d.id === id)

  if (driver) {
    driver.lat = lat
    driver.lng = lng
    driver.name = name || driver.name
    driver.online = true
  } else {
    drivers.push({
      id,
      name: name || id,
      lat: lat || 0,
      lng: lng || 0,
      online: true
    })
  }

  return res.json({ success: true })
})

// REQUEST RIDE
app.post('/request-ride', (req, res) => {
  const ride = {
    id: 'ride_' + Date.now(),
    pickup: req.body.pickup || 'Pickup',
    dropoff: req.body.dropoff || 'Dropoff',
    status: 'requested'
  }

  rides.push(ride)

  return res.json({
    success: true,
    ride
  })
})

// REQUEST DELIVERY
app.post('/request-delivery', (req, res) => {
  const delivery = {
    id: 'delivery_' + Date.now(),
    item: req.body.item || 'Package',
    status: 'pending'
  }

  deliveries.push(delivery)

  return res.json({
    success: true,
    delivery
  })
})

app.listen(PORT, () => {
  console.log('Harvey Taxi running on port ' + PORT)
  console.log('Admin route: /admin')
  console.log('Secret dashboard route: /' + ADMIN_SECRET_PATH)
})

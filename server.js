const express = require('express')
const cors = require('cors')
const path = require('path')
const fs = require('fs')

const app = express()
const PORT = process.env.PORT || 10000
const DATA_FILE = path.join(__dirname, 'data.json')

app.use(cors())
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true, limit: '10mb' }))
app.use(express.static(path.join(__dirname, 'public')))

function loadData() {
  if (!fs.existsSync(DATA_FILE)) {
    const starterData = {
      users: {
        riders: [],
        drivers: [],
        admins: []
      },
      driversLive: [],
      serviceRequests: [],
      notifications: []
    }
    fs.writeFileSync(DATA_FILE, JSON.stringify(starterData, null, 2))
    return starterData
  }

  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'))
  } catch (err) {
    console.error('Error reading data.json:', err)
    return {
      users: {
        riders: [],
        drivers: [],
        admins: []
      },
      driversLive: [],
      serviceRequests: [],
      notifications: []
    }
  }
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2))
}

function uid(prefix = 'id') {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 100000)}`
}

let db = loadData()

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'))
})

app.get('/request-ride', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'request-ride.html'))
})

app.get('/driver-signup', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'driver-signup.html'))
})

app.get('/rider-signup', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'rider-signup.html'))
})

app.get('/driver-verification', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'driver-verification.html'))
})

app.get('/admin-verification', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin-verification.html'))
})

app.get('/api/health', (req, res) => {
  res.json({ success: true, message: 'Harvey Taxi API running' })
})

app.post('/api/rider/signup', (req, res) => {
  const { fullName, phone, email, password } = req.body

  if (!fullName || !phone || !email || !password) {
    return res.status(400).json({
      success: false,
      message: 'Please complete all rider sign up fields.'
    })
  }

  const existing = db.users.riders.find(
    rider => rider.email.toLowerCase() === email.toLowerCase()
  )

  if (existing) {
    return res.status(400).json({
      success: false,
      message: 'A rider with that email already exists.'
    })
  }

  const newRider = {
    id: uid('rider'),
    fullName,
    phone,
    email,
    password,
    createdAt: new Date().toISOString()
  }

  db.users.riders.push(newRider)
  saveData(db)

  res.json({
    success: true,
    message: 'Rider sign up successful.',
    rider: newRider
  })
})

app.post('/api/driver/signup', (req, res) => {
  const {
    fullName,
    phone,
    email,
    password,
    carMake,
    carModel,
    carColor,
    plateNumber
  } = req.body

  if (!fullName || !phone || !email || !password) {
    return res.status(400).json({
      success: false,
      message: 'Please complete all required driver sign up fields.'
    })
  }

  const existing = db.users.drivers.find(
    driver => driver.email.toLowerCase() === email.toLowerCase()
  )

  if (existing) {
    return res.status(400).json({
      success: false,
      message: 'A driver with that email already exists.'
    })
  }

  const newDriver = {
    id: uid('driver'),
    fullName,
    phone,
    email,
    password,
    carMake: carMake || '',
    carModel: carModel || '',
    carColor: carColor || '',
    plateNumber: plateNumber || '',
    approved: false,
    createdAt: new Date().toISOString()
  }

  db.users.drivers.push(newDriver)
  saveData(db)

  res.json({
    success: true,
    message: 'Driver sign up successful.',
    driver: newDriver
  })
})

app.listen(PORT, () => {
  console.log(`Harvey Taxi server running on port ${PORT}`)
})

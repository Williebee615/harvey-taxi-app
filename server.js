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

let db = loadData()

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'))
})

app.get('/driver-verification', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'driver-verification.html'))
})

app.get('/admin-verification', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin-verification.html'))
})

app.get('/request-ride', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'request-ride.html'))
})

app.get('/api/health', (req, res) => {
  res.json({ success: true, message: 'Harvey Taxi API running' })
})

app.listen(PORT, () => {
  console.log(`Harvey Taxi server running on port ${PORT}`)
})

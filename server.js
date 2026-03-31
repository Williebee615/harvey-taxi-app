const express = require('express')
const cors = require('cors')
const path = require('path')
const fs = require('fs')
const https = require('https')

const app = express()
const PORT = process.env.PORT || 10000

app.use(cors())
app.use(express.json())
app.use(express.static(path.join(__dirname, 'public')))

const DATA_FILE = path.join(__dirname, 'data.json')

function ensureDataFile() {
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify({
      rides: [],
      drivers: [],
      riders: []
    }, null, 2))
  }
}

function readData() {
  ensureDataFile()
  return JSON.parse(fs.readFileSync(DATA_FILE))
}

function writeData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2))
}

/* =============================
   SAFE GEOCODER (NO FETCH)
============================= */
function geocodeAddress(address) {
  return new Promise((resolve) => {

    if (!address) return resolve(null)

    const url =
      "https://nominatim.openstreetmap.org/search?format=json&q=" +
      encodeURIComponent(address)

    https.get(url, { headers: { 'User-Agent': 'HarveyTaxi' } }, (res) => {

      let data = ''

      res.on('data', chunk => data += chunk)

      res.on('end', () => {
        try {
          const json = JSON.parse(data)

          if (!json.length) return resolve(null)

          resolve({
            lat: Number(json[0].lat),
            lng: Number(json[0].lon)
          })

        } catch {
          resolve(null)
        }
      })

    }).on('error', () => resolve(null))

  })
}

/* =============================
   ROUTES
============================= */

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/index.html'))
})

/* =============================
   DRIVER SIGNUP
============================= */

app.post('/api/driver-signup', (req, res) => {
  const data = readData()

  const driver = {
    id: Date.now().toString(),
    name: req.body.name,
    email: req.body.email,
    approved: true,
    online: false,
    location: null
  }

  data.drivers.push(driver)
  writeData(data)

  res.json({ success: true, driver })
})

/* =============================
   RIDER SIGNUP
============================= */

app.post('/api/rider-signup', (req, res) => {
  const data = readData()

  const rider = {
    id: Date.now().toString(),
    name: req.body.name,
    email: req.body.email
  }

  data.riders.push(rider)
  writeData(data)

  res.json({ success: true, rider })
})

/* =============================
   DRIVER LOCATION
============================= */

app.post('/api/driver-location', (req, res) => {
  const { driverId, lat, lng } = req.body
  const data = readData()

  const driver = data.drivers.find(d => d.id === driverId)

  if (!driver) {
    return res.status(404).json({ error: 'driver not found' })
  }

  driver.location = { lat, lng }
  driver.online = true

  writeData(data)

  res.json({ success: true })
})

/* =============================
   REQUEST RIDE
============================= */

app.post('/api/request-ride', async (req, res) => {

  const data = readData()

  const pickup = await geocodeAddress(req.body.pickup)
  const dropoff = await geocodeAddress(req.body.dropoff)

  const ride = {
    id: Date.now().toString(),
    pickup: req.body.pickup,
    dropoff: req.body.dropoff,
    pickupGeo: pickup,
    dropoffGeo: dropoff,
    scheduledDate: req.body.scheduledDate,
    scheduledTime: req.body.scheduledTime,
    status: "requested",
    driverId: null
  }

  data.rides.push(ride)
  writeData(data)

  res.json({
    success: true,
    ride
  })
})

/* =============================
   GET LISTS
============================= */

app.get('/api/rides', (req, res) => {
  res.json(readData().rides)
})

app.get('/api/drivers', (req, res) => {
  res.json(readData().drivers)
})

app.listen(PORT, () => {
  console.log("Server running on port", PORT)
})

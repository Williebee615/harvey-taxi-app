const express = require('express')
const cors = require('cors')
const path = require('path')

const app = express()
const PORT = process.env.PORT || 10000

app.use(cors())
app.use(express.json())
app.use(express.static(path.join(__dirname, 'public')))

/* =========================
   MEMORY DATABASE (TEMP)
========================= */

let drivers = []
let requests = []

/* =========================
   HELPER: DISTANCE
========================= */
function getDistance(lat1, lon1, lat2, lon2) {
  const R = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) *
    Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2)

  return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)))
}

/* =========================
   DRIVER LOCATION UPDATE
========================= */
app.post('/api/driver/location', (req, res) => {
  const { driverId, lat, lng, type } = req.body

  let driver = drivers.find(d => d.id === driverId)

  if (!driver) {
    driver = {
      id: driverId,
      lat,
      lng,
      type: type || 'ride', // ride OR delivery
      available: true
    }
    drivers.push(driver)
  } else {
    driver.lat = lat
    driver.lng = lng
    driver.available = true
    driver.type = type || driver.type
  }

  res.json({ success: true })
})

/* =========================
   GET NEARBY DRIVERS
========================= */
app.get('/api/drivers/nearby', (req, res) => {
  const { lat, lng, type } = req.query

  const nearby = drivers
    .filter(d => d.available && (!type || d.type === type))
    .map(d => ({
      ...d,
      distance: getDistance(lat, lng, d.lat, d.lng)
    }))
    .sort((a, b) => a.distance - b.distance)

  res.json(nearby.slice(0, 5))
})

/* =========================
   CREATE REQUEST (RIDE OR DELIVERY)
========================= */
app.post('/api/request', (req, res) => {
  const {
    pickup,
    destination,
    type, // ride OR delivery
    notes
  } = req.body

  const requestId = 'req_' + Date.now()

  const newRequest = {
    id: requestId,
    pickup,
    destination,
    type,
    notes,
    status: 'searching',
    driver: null
  }

  requests.push(newRequest)

  // FIND NEAREST DRIVER
  const availableDrivers = drivers
    .filter(d => d.available && d.type === type)
    .map(d => ({
      ...d,
      distance: getDistance(
        pickup.lat,
        pickup.lng,
        d.lat,
        d.lng
      )
    }))
    .sort((a, b) => a.distance - b.distance)

  if (availableDrivers.length > 0) {
    const chosen = availableDrivers[0]

    newRequest.driver = chosen.id
    newRequest.status = 'assigned'

    chosen.available = false
  }

  res.json(newRequest)
})

/* =========================
   DRIVER ACCEPT JOB
========================= */
app.post('/api/driver/accept', (req, res) => {
  const { driverId, requestId } = req.body

  const request = requests.find(r => r.id === requestId)

  if (!request) return res.status(404).json({ error: 'Not found' })

  request.status = 'in_progress'
  request.driver = driverId

  res.json({ success: true })
})

/* =========================
   DRIVER COMPLETE JOB
========================= */
app.post('/api/driver/complete', (req, res) => {
  const { requestId } = req.body

  const request = requests.find(r => r.id === requestId)

  if (!request) return res.status(404).json({ error: 'Not found' })

  request.status = 'completed'

  const driver = drivers.find(d => d.id === request.driver)
  if (driver) driver.available = true

  res.json({ success: true })
})

/* =========================
   TRACK REQUEST
========================= */
app.get('/api/request/:id', (req, res) => {
  const request = requests.find(r => r.id === req.params.id)

  if (!request) return res.status(404).json({ error: 'Not found' })

  const driver = drivers.find(d => d.id === request.driver)

  res.json({
    ...request,
    driverLocation: driver
      ? { lat: driver.lat, lng: driver.lng }
      : null
  })
})

/* =========================
   START SERVER
========================= */
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`)
})

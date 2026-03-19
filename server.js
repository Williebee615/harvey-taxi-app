const path = require('path')
app.use(express.static(path.join(__dirname, 'public')))const express = require('express')
const cors = require('cors')

const app = express()
const PORT = process.env.PORT || 10000

app.use(cors())
app.use(express.json())

// Temporary in-memory storage
let drivers = []
let rideRequests = []

// Home route
app.get('/', (req, res) => {
  res.send('🚖 Harvey Taxi API is running...')
})

// Test route
app.get('/api/test', (req, res) => {
  res.json({ message: 'API working perfectly' })
})

// Distance calculator
function getDistance(lat1, lng1, lat2, lng2) {
  const R = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) *
    Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) *
    Math.sin(dLng / 2)

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

// Driver location update
app.post('/api/driver/location', (req, res) => {
  const { driverId, lat, lng } = req.body

  if (!driverId || lat === undefined || lng === undefined) {
    return res.status(400).json({ error: 'driverId, lat, and lng are required' })
  }

  let existingDriver = drivers.find(driver => driver.driverId === driverId)

  if (existingDriver) {
    existingDriver.lat = lat
    existingDriver.lng = lng
  } else {
    drivers.push({ driverId, lat, lng })
  }

  res.json({
    success: true,
    drivers
  })
})

// Ride request with nearest-driver matching
app.post('/api/request-ride', (req, res) => {
  const { riderId, pickup, dropoff } = req.body

  if (!pickup || pickup.lat === undefined || pickup.lng === undefined) {
    return res.status(400).json({ error: 'Pickup location required' })
  }

  let nearestDriver = null
  let minDistance = Infinity

  drivers.forEach(driver => {
    const distance = getDistance(
      pickup.lat,
      pickup.lng,
      driver.lat,
      driver.lng
    )

    if (distance < minDistance) {
      minDistance = distance
      nearestDriver = driver
    }
  })

  const newRide = {
    id: Date.now(),
    riderId: riderId || 'unknown',
    pickup,
    dropoff: dropoff || null,
    status: nearestDriver ? 'matched' : 'waiting',
    driver: nearestDriver || null,
    distance: nearestDriver ? minDistance : null
  }

  rideRequests.push(newRide)

  res.json({
    success: true,
    ride: newRide
  })
})

// Get all drivers
app.get('/api/drivers', (req, res) => {
  res.json(drivers)
})

// Get all rides
app.get('/api/rides', (req, res) => {
  res.json(rideRequests)
})

app.listen(PORT, () => {
  console.log(`🚖 Server running on port ${PORT}`)
})
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'))
})

const express = require('express')
const cors = require('cors')
const path = require('path')

const app = express()
const PORT = process.env.PORT || 10000

app.use(cors())
app.use(express.json())
app.use(express.static(path.join(__dirname, 'public')))

let drivers = []
let rideRequests = []

app.get('/', (req, res) => {
  res.send('🚖 Harvey Taxi API is running...')
})

app.get('/api/test', (req, res) => {
  res.json({ message: 'API working perfectly' })
})

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
    drivers.push({ driverId, lat, lng, available: true })
  }

  res.json({
    success: true,
    message: 'Driver location updated',
    drivers
  })
})

app.post('/api/request-ride', (req, res) => {
  const { riderId, pickup, dropoff, rideType } = req.body

  if (!pickup || pickup.lat === undefined || pickup.lng === undefined) {
    return res.status(400).json({ error: 'Pickup location required' })
  }

  let nearestDriver = null
  let minDistance = Infinity

  drivers
    .filter(driver => driver.available !== false)
    .forEach(driver => {
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
    rideType: rideType || 'Standard',
    status: nearestDriver ? 'matched' : 'waiting',
    driver: nearestDriver ? { driverId: nearestDriver.driverId } : null,
    distance: nearestDriver ? Number(minDistance.toFixed(2)) : null,
    acceptedBy: null
  }

  rideRequests.push(newRide)

  res.json({
    success: true,
    ride: newRide
  })
})

app.post('/api/rides/:id/accept', (req, res) => {
  const rideId = Number(req.params.id)
  const { driverId } = req.body

  const ride = rideRequests.find(r => r.id === rideId)

  if (!ride) {
    return res.status(404).json({ error: 'Ride not found' })
  }

  if (!driverId) {
    return res.status(400).json({ error: 'driverId is required' })
  }

  if (ride.status === 'accepted') {
    return res.status(400).json({ error: 'Ride already accepted' })
  }

  ride.status = 'accepted'
  ride.acceptedBy = driverId
  ride.driver = { driverId }

  const driver = drivers.find(d => d.driverId === driverId)
  if (driver) {
    driver.available = false
  }

  res.json({
    success: true,
    message: 'Ride accepted successfully',
    ride
  })
})

app.get('/api/drivers', (req, res) => {
  res.json(drivers)
})

app.get('/api/rides', (req, res) => {
  res.json(rideRequests)
})

app.listen(PORT, () => {
  console.log(`🚖 Server running on port ${PORT}`)
})

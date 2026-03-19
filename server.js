// server.js

const express = require('express')
const cors = require('cors')

const app = express()
const PORT = process.env.PORT || 10000

// Middleware
app.use(cors())
app.use(express.json())

// Health check route (VERY IMPORTANT for Render)
app.get('/', (req, res) => {
  res.send('🚖 Harvey Taxi API is running...')
})

// Test route
app.get('/api/test', (req, res) => {
  res.json({ message: 'API working perfectly' })
})

/*
========================================
🚖 DRIVER + RIDER MEMORY (TEMP DATABASE)
========================================
*/

let drivers = []
let rideRequests = []

/*
========================================
📍 DRIVER LOCATION UPDATE
========================================
*/

app.post('/api/driver/location', (req, res) => {
  const { driverId, lat, lng } = req.body

  let existingDriver = drivers.find(d => d.driverId === driverId)

  if (existingDriver) {
    existingDriver.lat = lat
    existingDriver.lng = lng
  } else {
    drivers.push({ driverId, lat, lng })
  }

  res.json({ success: true, drivers })
})

/*
========================================
🚖 REQUEST A RIDE
========================================
*/

app.post('/api/request-ride', (req, res) => {
  const { riderId, pickup, dropoff } = req.body

  const newRide = {
    id: Date.now(),
    riderId,
    pickup,
    dropoff,
    status: 'waiting'
  }

  rideRequests.push(newRide)

  res.json({ success: true, ride: newRide })
})

/*
========================================
📡 GET ALL DRIVERS (for rider app)
========================================
*/

app.get('/api/drivers', (req, res) => {
  res.json(drivers)
})

/*
========================================
📦 GET ALL RIDE REQUESTS (for driver app)
========================================
*/

app.get('/api/rides', (req, res) => {
  res.json(rideRequests)
})

/*
========================================
🚀 START SERVER
========================================
*/

app.listen(PORT, () => {
  console.log(`🚖 Server running on port ${PORT}`)
})

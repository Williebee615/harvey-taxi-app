const express = require('express')
const cors = require('cors')
const path = require('path')
const fs = require('fs')

const app = express()
const PORT = process.env.PORT || 10000

app.use(cors())
app.use(express.json())
app.use(express.static(path.join(__dirname, 'public')))

let drivers = [
  {
    id: 'driver_1',
    name: 'Marcus Johnson',
    car: 'Toyota Camry',
    plate: 'HTX-101',
    lat: 36.1627,
    lng: -86.7816,
    online: true,
    busy: false
  },
  {
    id: 'driver_2',
    name: 'Alicia Brown',
    car: 'Honda Accord',
    plate: 'HTX-202',
    lat: 36.1745,
    lng: -86.7679,
    online: true,
    busy: false
  },
  {
    id: 'driver_3',
    name: 'David Smith',
    car: 'Nissan Altima',
    plate: 'HTX-303',
    lat: 36.1570,
    lng: -86.8040,
    online: true,
    busy: false
  }
]

let rideRequests = []

function getDistance(lat1, lng1, lat2, lng2) {
  const toRad = (value) => (value * Math.PI) / 180
  const R = 6371

  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2)

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

function findNearestDriver(pickupLat, pickupLng) {
  const availableDrivers = drivers.filter(driver => driver.online && !driver.busy)

  if (availableDrivers.length === 0) return null

  let nearestDriver = null
  let shortestDistance = Infinity

  for (const driver of availableDrivers) {
    const distance = getDistance(pickupLat, pickupLng, driver.lat, driver.lng)
    if (distance < shortestDistance) {
      shortestDistance = distance
      nearestDriver = driver
    }
  }

  return nearestDriver
}

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/index.html'))
})

app.get('/driver', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/driver.html'))
})

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/admin.html'))
})

app.get('/:page', (req, res) => {
  const file = path.join(__dirname, 'public', req.params.page)
  if (fs.existsSync(file)) {
    res.sendFile(file)
  } else {
    res.sendFile(path.join(__dirname, 'public/index.html'))
  }
})

app.get('/api/drivers', (req, res) => {
  res.json(drivers)
})

app.post('/api/drivers/go-online', (req, res) => {
  const { id, lat, lng } = req.body

  const driver = drivers.find(d => d.id === id)
  if (!driver) {
    return res.status(404).json({ error: 'Driver not found' })
  }

  driver.online = true
  driver.busy = false
  if (typeof lat === 'number') driver.lat = lat
  if (typeof lng === 'number') driver.lng = lng

  res.json({
    success: true,
    message: `${driver.name} is now online`,
    driver
  })
})

app.post('/api/drivers/go-offline', (req, res) => {
  const { id } = req.body

  const driver = drivers.find(d => d.id === id)
  if (!driver) {
    return res.status(404).json({ error: 'Driver not found' })
  }

  driver.online = false
  driver.busy = false

  res.json({
    success: true,
    message: `${driver.name} is now offline`,
    driver
  })
})

app.post('/api/request-ride', (req, res) => {
  const {
    pickup,
    dropoff,
    rideType,
    pickupLat,
    pickupLng
  } = req.body

  if (!pickup || !dropoff || !rideType) {
    return res.status(400).json({ error: 'Missing required fields' })
  }

  const requestLat = typeof pickupLat === 'number' ? pickupLat : 36.1627
  const requestLng = typeof pickupLng === 'number' ? pickupLng : -86.7816

  const nearestDriver = findNearestDriver(requestLat, requestLng)

  if (!nearestDriver) {
    return res.status(404).json({
      success: false,
      message: 'No available drivers found right now'
    })
  }

  nearestDriver.busy = true

  const ride = {
    id: `ride_${Date.now()}`,
    pickup,
    dropoff,
    rideType,
    pickupLat: requestLat,
    pickupLng: requestLng,
    status: 'assigned',
    driverId: nearestDriver.id,
    driverName: nearestDriver.name,
    car: nearestDriver.car,
    plate: nearestDriver.plate,
    etaMinutes: Math.floor(Math.random() * 5) + 3,
    createdAt: new Date().toISOString()
  }

  rideRequests.unshift(ride)

  res.json({
    success: true,
    message: 'Driver assigned successfully',
    ride
  })
})

app.get('/api/rides', (req, res) => {
  res.json(rideRequests)
})

app.post('/api/complete-ride', (req, res) => {
  const { rideId } = req.body

  const ride = rideRequests.find(r => r.id === rideId)
  if (!ride) {
    return res.status(404).json({ error: 'Ride not found' })
  }

  ride.status = 'completed'

  const driver = drivers.find(d => d.id === ride.driverId)
  if (driver) {
    driver.busy = false
  }

  res.json({
    success: true,
    message: 'Ride completed',
    ride
  })
})

app.listen(PORT, () => {
  console.log(`Harvey Taxi running on port ${PORT}`)
})

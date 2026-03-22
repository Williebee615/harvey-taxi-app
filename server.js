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
    busy: false,
    currentRideId: null
  },
  {
    id: 'driver_2',
    name: 'Alicia Brown',
    car: 'Honda Accord',
    plate: 'HTX-202',
    lat: 36.1745,
    lng: -86.7679,
    online: true,
    busy: false,
    currentRideId: null
  },
  {
    id: 'driver_3',
    name: 'David Smith',
    car: 'Nissan Altima',
    plate: 'HTX-303',
    lat: 36.1570,
    lng: -86.8040,
    online: true,
    busy: false,
    currentRideId: null
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

function movePointTowards(currentLat, currentLng, targetLat, targetLng, step = 0.22) {
  const latDiff = targetLat - currentLat
  const lngDiff = targetLng - currentLng

  return {
    lat: currentLat + latDiff * step,
    lng: currentLng + lngDiff * step
  }
}

function findNearestDriver(pickupLat, pickupLng) {
  const availableDrivers = drivers.filter(driver => driver.online && !driver.busy)

  if (!availableDrivers.length) return null

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

function getEtaLabel(driver, targetLat, targetLng, rideStatus) {
  if (rideStatus === 'arrived') return 'Driver has arrived'
  if (rideStatus === 'in_progress') return 'On the trip now'
  if (rideStatus === 'completed') return 'Trip completed'

  const km = getDistance(driver.lat, driver.lng, targetLat, targetLng)
  const minutes = Math.max(1, Math.round(km * 2.4))
  return `${minutes} min away`
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
  if (!driver.currentRideId) driver.busy = false
  if (typeof lat === 'number') driver.lat = lat
  if (typeof lng === 'number') driver.lng = lng

  res.json({ success: true, message: `${driver.name} is now online`, driver })
})

app.post('/api/drivers/go-offline', (req, res) => {
  const { id } = req.body
  const driver = drivers.find(d => d.id === id)

  if (!driver) {
    return res.status(404).json({ error: 'Driver not found' })
  }

  if (driver.currentRideId) {
    return res.status(400).json({ error: 'Driver cannot go offline during active ride' })
  }

  driver.online = false
  driver.busy = false

  res.json({ success: true, message: `${driver.name} is now offline`, driver })
})

app.post('/api/request-ride', (req, res) => {
  const {
    pickup,
    dropoff,
    rideType,
    pickupLat,
    pickupLng,
    dropoffLat,
    dropoffLng
  } = req.body

  if (!pickup || !dropoff || !rideType) {
    return res.status(400).json({ error: 'Missing required fields' })
  }

  const requestLat = typeof pickupLat === 'number' ? pickupLat : 36.1627
  const requestLng = typeof pickupLng === 'number' ? pickupLng : -86.7816
  const endLat = typeof dropoffLat === 'number' ? dropoffLat : 36.1699
  const endLng = typeof dropoffLng === 'number' ? dropoffLng : -86.7944

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
    dropoffLat: endLat,
    dropoffLng: endLng,
    status: 'assigned',
    driverId: nearestDriver.id,
    driverName: nearestDriver.name,
    car: nearestDriver.car,
    plate: nearestDriver.plate,
    createdAt: new Date().toISOString()
  }

  nearestDriver.currentRideId = ride.id
  ride.etaLabel = getEtaLabel(nearestDriver, ride.pickupLat, ride.pickupLng, ride.status)
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

app.get('/api/rides/:rideId', (req, res) => {
  const ride = rideRequests.find(r => r.id === req.params.rideId)

  if (!ride) {
    return res.status(404).json({ error: 'Ride not found' })
  }

  const driver = drivers.find(d => d.id === ride.driverId)

  if (driver) {
    const target =
      ride.status === 'in_progress'
        ? { lat: ride.dropoffLat, lng: ride.dropoffLng }
        : { lat: ride.pickupLat, lng: ride.pickupLng }

    ride.etaLabel = getEtaLabel(driver, target.lat, target.lng, ride.status)
  }

  res.json({
    ...ride,
    driverLocation: driver
      ? {
          lat: driver.lat,
          lng: driver.lng
        }
      : null
  })
})

app.post('/api/rides/:rideId/status', (req, res) => {
  const { status } = req.body
  const allowedStatuses = ['accepted', 'arriving', 'arrived', 'in_progress', 'completed']

  if (!allowedStatuses.includes(status)) {
    return res.status(400).json({ error: 'Invalid ride status' })
  }

  const ride = rideRequests.find(r => r.id === req.params.rideId)
  if (!ride) {
    return res.status(404).json({ error: 'Ride not found' })
  }

  ride.status = status
  ride.updatedAt = new Date().toISOString()

  const driver = drivers.find(d => d.id === ride.driverId)

  if (driver) {
    const target =
      ride.status === 'in_progress'
        ? { lat: ride.dropoffLat, lng: ride.dropoffLng }
        : { lat: ride.pickupLat, lng: ride.pickupLng }

    ride.etaLabel = getEtaLabel(driver, target.lat, target.lng, ride.status)
  }

  if (status === 'completed' && driver) {
    driver.busy = false
    driver.currentRideId = null
  }

  res.json({
    success: true,
    message: `Ride updated to ${status}`,
    ride
  })
})

app.get('/api/drivers/:driverId/current-ride', (req, res) => {
  const driver = drivers.find(d => d.id === req.params.driverId)

  if (!driver) {
    return res.status(404).json({ error: 'Driver not found' })
  }

  if (!driver.currentRideId) {
    return res.json({ ride: null })
  }

  const ride = rideRequests.find(r => r.id === driver.currentRideId)

  res.json({
    ride: ride || null
  })
})

app.post('/api/drivers/:driverId/move', (req, res) => {
  const driver = drivers.find(d => d.id === req.params.driverId)

  if (!driver) {
    return res.status(404).json({ error: 'Driver not found' })
  }

  let targetLat = driver.lat
  let targetLng = driver.lng

  if (driver.currentRideId) {
    const ride = rideRequests.find(r => r.id === driver.currentRideId)

    if (ride) {
      if (ride.status === 'assigned' || ride.status === 'accepted' || ride.status === 'arriving') {
        targetLat = ride.pickupLat
        targetLng = ride.pickupLng
      } else if (ride.status === 'in_progress') {
        targetLat = ride.dropoffLat
        targetLng = ride.dropoffLng
      }

      const moved = movePointTowards(driver.lat, driver.lng, targetLat, targetLng, 0.25)
      driver.lat = moved.lat
      driver.lng = moved.lng

      const remainingKm = getDistance(driver.lat, driver.lng, targetLat, targetLng)

      if ((ride.status === 'assigned' || ride.status === 'accepted' || ride.status === 'arriving') && remainingKm < 0.08) {
        ride.status = 'arrived'
      }

      if (ride.status === 'in_progress' && remainingKm < 0.08) {
        ride.status = 'completed'
        driver.busy = false
        driver.currentRideId = null
      }

      ride.etaLabel = getEtaLabel(driver, targetLat, targetLng, ride.status)
    }
  }

  res.json({
    success: true,
    driver
  })
})

app.listen(PORT, () => {
  console.log(`Harvey Taxi running on port ${PORT}`)
})

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
    lat: 36.1627,
    lng: -86.7816,
    online: true,
    car: 'Toyota Camry',
    plate: 'HTX-101'
  },
  {
    id: 'driver_2',
    name: 'Ashley Smith',
    lat: 36.1740,
    lng: -86.7670,
    online: true,
    car: 'Honda Accord',
    plate: 'HTX-202'
  },
  {
    id: 'driver_3',
    name: 'David Brown',
    lat: 36.1570,
    lng: -86.8040,
    online: false,
    car: 'Nissan Altima',
    plate: 'HTX-303'
  }
]

let rideRequests = []

function getDistanceKm(lat1, lng1, lat2, lng2) {
  const R = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) *
    Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2)

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

function estimateEtaMinutes(distanceKm) {
  const avgCitySpeedKmPerMin = 0.6
  return Math.max(3, Math.round(distanceKm / avgCitySpeedKmPerMin))
}

function findNearestDriver(pickupLat, pickupLng) {
  const onlineDrivers = drivers.filter(driver => driver.online)

  if (!onlineDrivers.length) return null

  let nearest = null
  let nearestDistance = Infinity

  for (const driver of onlineDrivers) {
    const distance = getDistanceKm(pickupLat, pickupLng, driver.lat, driver.lng)

    if (distance < nearestDistance) {
      nearestDistance = distance
      nearest = driver
    }
  }

  if (!nearest) return null

  return {
    ...nearest,
    distanceKm: Number(nearestDistance.toFixed(2)),
    etaMinutes: estimateEtaMinutes(nearestDistance)
  }
}

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'))
})

app.get('/api/drivers', (req, res) => {
  res.json({
    success: true,
    drivers
  })
})

app.post('/api/drivers/go-online', (req, res) => {
  const { id, name, lat, lng, car, plate } = req.body

  if (!id || !name) {
    return res.status(400).json({
      success: false,
      message: 'Driver id and name are required'
    })
  }

  const existingDriver = drivers.find(driver => driver.id === id)

  if (existingDriver) {
    existingDriver.online = true
    existingDriver.lat = typeof lat === 'number' ? lat : existingDriver.lat
    existingDriver.lng = typeof lng === 'number' ? lng : existingDriver.lng
    existingDriver.car = car || existingDriver.car
    existingDriver.plate = plate || existingDriver.plate
  } else {
    drivers.push({
      id,
      name,
      lat: typeof lat === 'number' ? lat : 36.1627,
      lng: typeof lng === 'number' ? lng : -86.7816,
      online: true,
      car: car || 'Vehicle',
      plate: plate || 'PENDING'
    })
  }

  res.json({
    success: true,
    message: 'Driver is now online',
    drivers
  })
})

app.post('/api/drivers/go-offline', (req, res) => {
  const { id } = req.body

  const driver = drivers.find(d => d.id === id)

  if (!driver) {
    return res.status(404).json({
      success: false,
      message: 'Driver not found'
    })
  }

  driver.online = false

  res.json({
    success: true,
    message: 'Driver is now offline',
    driver
  })
})

app.post('/api/drivers/update-location', (req, res) => {
  const { id, lat, lng } = req.body

  const driver = drivers.find(d => d.id === id)

  if (!driver) {
    return res.status(404).json({
      success: false,
      message: 'Driver not found'
    })
  }

  if (typeof lat !== 'number' || typeof lng !== 'number') {
    return res.status(400).json({
      success: false,
      message: 'Valid lat and lng are required'
    })
  }

  driver.lat = lat
  driver.lng = lng

  res.json({
    success: true,
    message: 'Driver location updated',
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
    return res.status(400).json({
      success: false,
      message: 'Pickup, dropoff, and ride type are required'
    })
  }

  const finalPickupLat = typeof pickupLat === 'number' ? pickupLat : 36.1627
  const finalPickupLng = typeof pickupLng === 'number' ? pickupLng : -86.7816

  const assignedDriver = findNearestDriver(finalPickupLat, finalPickupLng)

  const ride = {
    id: `ride_${Date.now()}`,
    pickup,
    dropoff,
    rideType,
    pickupLat: finalPickupLat,
    pickupLng: finalPickupLng,
    status: assignedDriver ? 'assigned' : 'pending',
    createdAt: new Date().toISOString(),
    driver: assignedDriver
      ? {
          id: assignedDriver.id,
          name: assignedDriver.name,
          car: assignedDriver.car,
          plate: assignedDriver.plate,
          etaMinutes: assignedDriver.etaMinutes,
          distanceKm: assignedDriver.distanceKm
        }
      : null
  }

  rideRequests.unshift(ride)

  res.json({
    success: true,
    ride
  })
})

app.get('/api/rides', (req, res) => {
  res.json({
    success: true,
    rides: rideRequests
  })
})

app.get('/driver.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'driver.html'))
})

app.get('/admin.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'))
})

app.get('/:page', (req, res) => {
  const filePath = path.join(__dirname, 'public', req.params.page)

  if (fs.existsSync(filePath)) {
    return res.sendFile(filePath)
  }

  res.sendFile(path.join(__dirname, 'public', 'index.html'))
})

app.listen(PORT, () => {
  console.log(`Harvey Taxi server running on port ${PORT}`)
})

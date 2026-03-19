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

function getDistance(lat1, lng1, lat2, lng2) {
  const R = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) *
    Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2

  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// 🔥 MOVE DRIVER TOWARD TARGET
function moveTowards(current, target, step = 0.0005) {
  const latDiff = target.lat - current.lat
  const lngDiff = target.lng - current.lng

  const distance = Math.sqrt(latDiff * latDiff + lngDiff * lngDiff)
  if (distance < step) return target

  return {
    lat: current.lat + (latDiff / distance) * step,
    lng: current.lng + (lngDiff / distance) * step
  }
}

// 🔥 AUTO DRIVER MOVEMENT LOOP
setInterval(() => {
  rideRequests.forEach(ride => {
    if (!ride.driver || !ride.driver.driverId) return

    const driver = drivers.find(d => d.driverId === ride.driver.driverId)
    if (!driver) return

    if (ride.status === 'en_route') {
      const next = moveTowards(driver, ride.pickup)
      driver.lat = next.lat
      driver.lng = next.lng

      if (getDistance(driver.lat, driver.lng, ride.pickup.lat, ride.pickup.lng) < 0.05) {
        ride.status = 'arrived'
      }
    }

    if (ride.status === 'arrived') {
      const next = moveTowards(driver, ride.dropoff)
      driver.lat = next.lat
      driver.lng = next.lng

      if (getDistance(driver.lat, driver.lng, ride.dropoff.lat, ride.dropoff.lng) < 0.05) {
        ride.status = 'completed'
        driver.available = true
      }
    }
  })
}, 2000)

app.post('/api/driver/location', (req, res) => {
  const { driverId, lat, lng } = req.body

  let existing = drivers.find(d => d.driverId === driverId)

  if (existing) {
    existing.lat = lat
    existing.lng = lng
    existing.available = true
  } else {
    drivers.push({ driverId, lat, lng, available: true })
  }

  res.json({ success: true })
})

app.post('/api/request-ride', (req, res) => {
  const { riderId, pickup, dropoff, rideType } = req.body

  let nearest = null
  let min = Infinity

  drivers.forEach(d => {
    if (!d.available) return
    const dist = getDistance(pickup.lat, pickup.lng, d.lat, d.lng)
    if (dist < min) {
      min = dist
      nearest = d
    }
  })

  const ride = {
    id: Date.now(),
    riderId,
    pickup,
    dropoff,
    rideType,
    status: nearest ? 'matched' : 'waiting',
    driver: nearest ? { driverId: nearest.driverId } : null,
    distance: min,
    acceptedBy: null
  }

  rideRequests.push(ride)

  res.json({ success: true, ride })
})

app.post('/api/rides/:id/accept', (req, res) => {
  const ride = rideRequests.find(r => r.id == req.params.id)
  const driver = drivers.find(d => d.driverId === req.body.driverId)

  ride.status = 'en_route'
  ride.acceptedBy = driver.driverId
  driver.available = false

  res.json({ success: true })
})

app.get('/api/rides/:id', (req, res) => {
  const ride = rideRequests.find(r => r.id == req.params.id)
  const driver = drivers.find(d => d.driverId === ride.driver?.driverId)

  res.json({
    ...ride,
    driver
  })
})

app.get('/api/rides', (req, res) => {
  res.json(rideRequests)
})

app.listen(PORT, () => {
  console.log('Server running 🚖')
})

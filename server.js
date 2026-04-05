const express = require('express')
const cors = require('cors')
const path = require('path')
const fs = require('fs')

const app = express()
const PORT = process.env.PORT || 10000

app.use(cors())
app.use(express.json())
app.use(express.static(path.join(__dirname, 'public')))

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'))
})

app.get('/:page', (req, res) => {
  const file = path.join(__dirname, 'public', req.params.page)

  if (fs.existsSync(file)) {
    res.sendFile(file)
  } else {
    res.sendFile(path.join(__dirname, 'public', 'index.html'))
  }
})

let riders = []
let rides = []
let drivers = [
  {
    id: 'driver_1',
    name: 'Nearest Driver',
    lat: 36.1627,
    lng: -86.7816,
    available: true,
    type: 'human',
    vehicle_type: 'sedan',
    current_address: 'Downtown Nashville, TN',
    verification_status: 'approved'
  },
  {
    id: 'driver_2',
    name: 'Autonomous Unit A1',
    lat: 36.1744,
    lng: -86.7679,
    available: true,
    type: 'av',
    vehicle_type: 'autonomous',
    current_address: 'Midtown Nashville, TN',
    verification_status: 'approved'
  }
]

function fallbackCoordinates(address) {
  const baseLat = 36.1627
  const baseLng = -86.7816

  const hash = String(address || '')
    .split('')
    .reduce((acc, char) => acc + char.charCodeAt(0), 0)

  return {
    lat: baseLat + (hash % 100) * 0.0001,
    lng: baseLng + (hash % 100) * 0.0001
  }
}

async function geocodeAddress(address) {
  try {
    if (!process.env.GOOGLE_MAPS_KEY) {
      return fallbackCoordinates(address)
    }

    const response = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${process.env.GOOGLE_MAPS_KEY}`
    )

    const data = await response.json()

    if (data.status === 'OK' && data.results && data.results.length) {
      return {
        lat: data.results[0].geometry.location.lat,
        lng: data.results[0].geometry.location.lng
      }
    }

    return fallbackCoordinates(address)
  } catch (e) {
    return fallbackCoordinates(address)
  }
}

function distance(a, b) {
  const dx = a.lat - b.lat
  const dy = a.lng - b.lng
  return Math.sqrt(dx * dx + dy * dy)
}

function findNearestDriver(pickupCoords) {
  let best = null
  let bestDistance = Infinity

  drivers.forEach((driver) => {
    if (!driver.available) return
    if (driver.verification_status !== 'approved') return

    const d = distance(pickupCoords, driver)
    if (d < bestDistance) {
      best = driver
      bestDistance = d
    }
  })

  return best
}

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    service: 'Harvey Taxi Verification + Dispatch Brain'
  })
})

app.post('/api/rider-signup', (req, res) => {
  const { name, email, phone } = req.body

  if (!name || !email) {
    return res.status(400).json({
      error: 'name and email are required'
    })
  }

  const rider = {
    id: 'rider_' + Date.now(),
    name,
    email,
    phone: phone || '',
    verification_status: 'pending',
    created_at: new Date().toISOString()
  }

  riders.push(rider)

  res.json({
    success: true,
    message: 'Rider signup created. Verification required before requesting rides.',
    rider
  })
})

app.get('/api/rider/:id', (req, res) => {
  const rider = riders.find((r) => r.id === req.params.id)

  if (!rider) {
    return res.status(404).json({
      error: 'Rider not found'
    })
  }

  res.json(rider)
})

app.post('/api/admin/approve-rider', (req, res) => {
  const { rider_id } = req.body
  const rider = riders.find((r) => r.id === rider_id)

  if (!rider) {
    return res.status(404).json({
      error: 'Rider not found'
    })
  }

  rider.verification_status = 'approved'
  rider.approved_at = new Date().toISOString()

  res.json({
    success: true,
    message: 'Rider approved',
    rider
  })
})

app.post('/api/admin/reject-rider', (req, res) => {
  const { rider_id } = req.body
  const rider = riders.find((r) => r.id === rider_id)

  if (!rider) {
    return res.status(404).json({
      error: 'Rider not found'
    })
  }

  rider.verification_status = 'rejected'
  rider.rejected_at = new Date().toISOString()

  res.json({
    success: true,
    message: 'Rider rejected',
    rider
  })
})

app.get('/api/riders', (req, res) => {
  res.json(riders)
})

app.post('/api/request-ride', async (req, res) => {
  const {
    rider_id,
    rider_name,
    rider_phone,
    pickup_address,
    dropoff_address
  } = req.body

  if (!rider_id || !rider_name || !pickup_address || !dropoff_address) {
    return res.status(400).json({
      error: 'rider_id, rider_name, pickup_address, and dropoff_address are required'
    })
  }

  const rider = riders.find((r) => r.id === rider_id)

  if (!rider) {
    return res.status(404).json({
      error: 'Rider not found'
    })
  }

  if (rider.verification_status !== 'approved') {
    return res.status(403).json({
      error: 'Your verification must be approved before requesting a ride.'
    })
  }

  const pickupCoords = await geocodeAddress(pickup_address)
  const dropoffCoords = await geocodeAddress(dropoff_address)
  const driver = findNearestDriver(pickupCoords)

  const ride = {
    id: 'ride_' + Date.now(),
    rider_id,
    rider_name,
    rider_phone: rider_phone || rider.phone || '',
    pickup_address,
    dropoff_address,
    pickup_coords: pickupCoords,
    dropoff_coords: dropoffCoords,
    status: driver ? 'driver_assigned' : 'searching',
    driver_id: driver ? driver.id : null,
    driver_name: driver ? driver.name : null,
    fleet_type: driver ? driver.type : null,
    vehicle_type: driver ? driver.vehicle_type : null,
    estimated_fare: (8 + Math.random() * 12).toFixed(2),
    created_at: new Date().toISOString()
  }

  if (driver) {
    driver.available = false
  }

  rides.push(ride)

  res.json({
    success: true,
    message: driver ? 'Driver assigned automatically' : 'Searching for nearest driver',
    ride,
    assigned_driver: driver || null
  })
})

app.get('/api/rides', (req, res) => {
  res.json(rides)
})

app.get('/api/rides/:id', (req, res) => {
  const ride = rides.find((r) => r.id === req.params.id)

  if (!ride) {
    return res.status(404).json({
      error: 'Ride not found'
    })
  }

  res.json(ride)
})

app.post('/api/driver/update-status', (req, res) => {
  const { driver_id, status, available } = req.body
  const driver = drivers.find((d) => d.id === driver_id)

  if (!driver) {
    return res.status(404).json({
      error: 'Driver not found'
    })
  }

  if (typeof status === 'string') {
    driver.status = status
  }

  if (typeof available === 'boolean') {
    driver.available = available
  }

  res.json({
    success: true,
    driver
  })
})

app.get('/api/drivers', (req, res) => {
  res.json(drivers)
})

app.listen(PORT, () => {
  console.log('====================================')
  console.log('Harvey Taxi Verification Gate Running')
  console.log('====================================')
})

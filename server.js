const express = require('express')
const cors = require('cors')
const path = require('path')

const app = express()
const PORT = process.env.PORT || 10000

app.use(cors())
app.use(express.json())
app.use(express.static(path.join(__dirname, 'public')))

let rides = []

let drivers = [
  {
    id: 'driver_1',
    name: 'Marcus Johnson',
    vehicle: 'Toyota Camry',
    plate: 'HTX-101',
    phone: '615-555-0101',
    online: true,
    lat: 36.1627,
    lng: -86.7816
  },
  {
    id: 'driver_2',
    name: 'Alicia Brown',
    vehicle: 'Honda Accord',
    plate: 'HTX-202',
    phone: '615-555-0102',
    online: true,
    lat: 36.1745,
    lng: -86.7679
  },
  {
    id: 'driver_3',
    name: 'David Carter',
    vehicle: 'Nissan Altima',
    plate: 'HTX-303',
    phone: '615-555-0103',
    online: true,
    lat: 36.157,
    lng: -86.804
  }
]

const fareSettings = {
  Standard: {
    base: 3.5,
    mile: 1.8,
    minute: 0.32,
    booking: 2.25
  },
  XL: {
    base: 5.5,
    mile: 2.6,
    minute: 0.45,
    booking: 2.75
  },
  Luxury: {
    base: 8,
    mile: 3.75,
    minute: 0.65,
    booking: 3.5
  }
}

function normalizeRideType(type) {
  const value = String(type || '').trim().toLowerCase()

  if (value === 'standard ride' || value === 'standard') return 'Standard'
  if (value === 'xl ride' || value === 'xl') return 'XL'
  if (value === 'luxury ride' || value === 'luxury') return 'Luxury'

  return 'Standard'
}

function getDistance(lat1, lng1, lat2, lng2) {
  const R = 3958.8
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLng = ((lng2 - lng1) * Math.PI) / 180

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2)

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

function calculateFare(miles, minutes, type) {
  const rideType = normalizeRideType(type)
  const s = fareSettings[rideType] || fareSettings.Standard

  const safeMiles = Number(miles) || 8
  const safeMinutes = Number(minutes) || 18

  const base = s.base
  const distanceCharge = safeMiles * s.mile
  const timeCharge = safeMinutes * s.minute
  const booking = s.booking
  const service = 0
  const total = base + distanceCharge + timeCharge + booking + service

  return {
    rideType,
    base: base.toFixed(2),
    distanceCharge: distanceCharge.toFixed(2),
    timeCharge: timeCharge.toFixed(2),
    booking: booking.toFixed(2),
    service: service.toFixed(2),
    total: total.toFixed(2)
  }
}

function stepToward(currentLat, currentLng, targetLat, targetLng, fraction = 0.22) {
  return {
    lat: currentLat + (targetLat - currentLat) * fraction,
    lng: currentLng + (targetLng - currentLng) * fraction
  }
}

function getRideStatusLabel(status) {
  switch (status) {
    case 'matched':
      return 'Driver matched'
    case 'accepted':
      return 'Driver accepted'
    case 'en_route':
      return 'Driver en route'
    case 'arrived':
      return 'Driver arrived'
    case 'in_progress':
      return 'Trip started'
    case 'completed':
      return 'Trip completed'
    case 'cancelled':
      return 'Ride cancelled'
    default:
      return 'Pending'
  }
}

function buildRideResponse(ride) {
  const driverDistanceToPickup = getDistance(
    ride.driver.lat,
    ride.driver.lng,
    ride.pickupLat,
    ride.pickupLng
  )

  const tripRemaining =
    ride.status === 'in_progress'
      ? getDistance(ride.driver.lat, ride.driver.lng, ride.dropoffLat, ride.dropoffLng)
      : getDistance(ride.pickupLat, ride.pickupLng, ride.dropoffLat, ride.dropoffLng)

  return {
    id: ride.id,
    pickup: ride.pickup,
    dropoff: ride.dropoff,
    pickupLat: ride.pickupLat,
    pickupLng: ride.pickupLng,
    dropoffLat: ride.dropoffLat,
    dropoffLng: ride.dropoffLng,
    distance: ride.distance,
    duration: ride.duration,
    rideType: ride.rideType,
    fare: ride.fare,
    status: ride.status,
    statusLabel: getRideStatusLabel(ride.status),
    createdAt: ride.createdAt,
    acceptedAt: ride.acceptedAt || null,
    arrivedAt: ride.arrivedAt || null,
    startedAt: ride.startedAt || null,
    completedAt: ride.completedAt || null,
    cancelledAt: ride.cancelledAt || null,
    driver: {
      id: ride.driver.id,
      name: ride.driver.name,
      vehicle: ride.driver.vehicle,
      plate: ride.driver.plate,
      phone: ride.driver.phone,
      lat: Number(ride.driver.lat.toFixed(6)),
      lng: Number(ride.driver.lng.toFixed(6)),
      distanceAway: Number(driverDistanceToPickup.toFixed(1)),
      etaMinutes: Math.max(1, Math.round(driverDistanceToPickup / 0.4) + 1)
    },
    trip: {
      remainingMiles: Number(tripRemaining.toFixed(1))
    }
  }
}

function advanceRideState(ride) {
  if (!ride || ride.status === 'completed' || ride.status === 'cancelled') return

  if (ride.status === 'matched') {
    ride.status = 'accepted'
    ride.acceptedAt = new Date().toISOString()
    return
  }

  if (ride.status === 'accepted') {
    ride.status = 'en_route'
    return
  }

  if (ride.status === 'en_route') {
    const moved = stepToward(
      ride.driver.lat,
      ride.driver.lng,
      ride.pickupLat,
      ride.pickupLng,
      0.35
    )

    ride.driver.lat = moved.lat
    ride.driver.lng = moved.lng

    const remaining = getDistance(
      ride.driver.lat,
      ride.driver.lng,
      ride.pickupLat,
      ride.pickupLng
    )

    if (remaining <= 0.2) {
      ride.driver.lat = ride.pickupLat
      ride.driver.lng = ride.pickupLng
      ride.status = 'arrived'
      ride.arrivedAt = new Date().toISOString()
    }
    return
  }

  if (ride.status === 'arrived') {
    ride.status = 'in_progress'
    ride.startedAt = new Date().toISOString()
    return
  }

  if (ride.status === 'in_progress') {
    const moved = stepToward(
      ride.driver.lat,
      ride.driver.lng,
      ride.dropoffLat,
      ride.dropoffLng,
      0.3
    )

    ride.driver.lat = moved.lat
    ride.driver.lng = moved.lng

    const remaining = getDistance(
      ride.driver.lat,
      ride.driver.lng,
      ride.dropoffLat,
      ride.dropoffLng
    )

    if (remaining <= 0.25) {
      ride.driver.lat = ride.dropoffLat
      ride.driver.lng = ride.dropoffLng
      ride.status = 'completed'
      ride.completedAt = new Date().toISOString()

      const driver = drivers.find(d => d.id === ride.driver.id)
      if (driver) {
        driver.online = true
        driver.lat = ride.dropoffLat
        driver.lng = ride.dropoffLng
      }
    }
  }
}

app.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'Harvey Taxi running'
  })
})

app.get('/drivers', (req, res) => {
  res.json({
    success: true,
    drivers
  })
})

app.post('/driver/update', (req, res) => {
  try {
    const { id, lat, lng, online } = req.body

    if (!id) {
      return res.json({
        success: false,
        message: 'Driver id required'
      })
    }

    const driver = drivers.find(d => d.id === id)

    if (!driver) {
      return res.json({
        success: false,
        message: 'Driver not found'
      })
    }

    if (lat !== undefined) driver.lat = Number(lat)
    if (lng !== undefined) driver.lng = Number(lng)
    if (online !== undefined) driver.online = Boolean(online)

    res.json({
      success: true,
      driver
    })
  } catch (error) {
    console.log(error)
    res.json({
      success: false,
      message: 'Failed to update driver'
    })
  }
})

app.post('/estimate-fare', (req, res) => {
  try {
    const miles = Number(req.body.distance) || 8
    const minutes = Number(req.body.duration) || 18
    const rideType = normalizeRideType(req.body.rideType)

    res.json({
      success: true,
      distance: miles,
      duration: minutes,
      fare: calculateFare(miles, minutes, rideType)
    })
  } catch (error) {
    console.log(error)
    res.json({
      success: false,
      message: 'Estimate failed'
    })
  }
})

app.post('/request-ride', (req, res) => {
  try {
    const pickup = req.body.pickup || 'Pickup'
    const dropoff = req.body.dropoff || 'Dropoff'

    const pickupLat = Number(req.body.pickupLat) || 36.1627
    const pickupLng = Number(req.body.pickupLng) || -86.7816
    const dropoffLat = Number(req.body.dropoffLat) || 36.1245
    const dropoffLng = Number(req.body.dropoffLng) || -86.7093

    const distance = Number(req.body.distance) || Number(getDistance(pickupLat, pickupLng, dropoffLat, dropoffLng).toFixed(1))
    const duration = Number(req.body.duration) || Math.max(10, Math.round(distance * 2.2))
    const rideType = normalizeRideType(req.body.rideType)
    const fare = calculateFare(distance, duration, rideType)

    let closestDriver = null
    let closestDistance = Infinity

    drivers.forEach(driver => {
      if (!driver.online) return

      const milesAway = getDistance(pickupLat, pickupLng, driver.lat, driver.lng)

      if (milesAway < closestDistance) {
        closestDistance = milesAway
        closestDriver = driver
      }
    })

    if (!closestDriver) {
      return res.json({
        success: false,
        message: 'No drivers available'
      })
    }

    closestDriver.online = false

    const ride = {
      id: 'ride_' + Date.now(),
      pickup,
      dropoff,
      pickupLat,
      pickupLng,
      dropoffLat,
      dropoffLng,
      distance,
      duration,
      rideType,
      fare,
      status: 'matched',
      createdAt: new Date().toISOString(),
      driver: {
        id: closestDriver.id,
        name: closestDriver.name,
        vehicle: closestDriver.vehicle,
        plate: closestDriver.plate,
        phone: closestDriver.phone,
        lat: closestDriver.lat,
        lng: closestDriver.lng
      }
    }

    rides.unshift(ride)

    res.json({
      success: true,
      message: 'Driver matched successfully',
      ride: buildRideResponse(ride)
    })
  } catch (error) {
    console.log(error)
    res.json({
      success: false,
      message: 'Server error while requesting ride.'
    })
  }
})

app.get('/rides', (req, res) => {
  res.json({
    success: true,
    rides: rides.map(buildRideResponse)
  })
})

app.get('/rides/:id', (req, res) => {
  const ride = rides.find(r => r.id === req.params.id)

  if (!ride) {
    return res.json({
      success: false,
      message: 'Ride not found'
    })
  }

  res.json({
    success: true,
    ride: buildRideResponse(ride)
  })
})

app.get('/rides/:id/live', (req, res) => {
  try {
    const ride = rides.find(r => r.id === req.params.id)

    if (!ride) {
      return res.json({
        success: false,
        message: 'Ride not found'
      })
    }

    advanceRideState(ride)

    res.json({
      success: true,
      ride: buildRideResponse(ride)
    })
  } catch (error) {
    console.log(error)
    res.json({
      success: false,
      message: 'Live tracking failed'
    })
  }
})

app.post('/rides/:id/accept', (req, res) => {
  const ride = rides.find(r => r.id === req.params.id)

  if (!ride) {
    return res.json({
      success: false,
      message: 'Ride not found'
    })
  }

  if (ride.status === 'matched') {
    ride.status = 'accepted'
    ride.acceptedAt = new Date().toISOString()
  }

  res.json({
    success: true,
    ride: buildRideResponse(ride)
  })
})

app.post('/rides/:id/arrive', (req, res) => {
  const ride = rides.find(r => r.id === req.params.id)

  if (!ride) {
    return res.json({
      success: false,
      message: 'Ride not found'
    })
  }

  if (ride.status === 'accepted' || ride.status === 'en_route') {
    ride.status = 'arrived'
    ride.arrivedAt = new Date().toISOString()
    ride.driver.lat = ride.pickupLat
    ride.driver.lng = ride.pickupLng
  }

  res.json({
    success: true,
    ride: buildRideResponse(ride)
  })
})

app.post('/rides/:id/start', (req, res) => {
  const ride = rides.find(r => r.id === req.params.id)

  if (!ride) {
    return res.json({
      success: false,
      message: 'Ride not found'
    })
  }

  if (ride.status === 'arrived') {
    ride.status = 'in_progress'
    ride.startedAt = new Date().toISOString()
  }

  res.json({
    success: true,
    ride: buildRideResponse(ride)
  })
})

app.post('/rides/:id/complete', (req, res) => {
  const ride = rides.find(r => r.id === req.params.id)

  if (!ride) {
    return res.json({
      success: false,
      message: 'Ride not found'
    })
  }

  ride.status = 'completed'
  ride.completedAt = new Date().toISOString()
  ride.driver.lat = ride.dropoffLat
  ride.driver.lng = ride.dropoffLng

  const driver = drivers.find(d => d.id === ride.driver.id)
  if (driver) {
    driver.online = true
    driver.lat = ride.dropoffLat
    driver.lng = ride.dropoffLng
  }

  res.json({
    success: true,
    ride: buildRideResponse(ride)
  })
})

app.post('/rides/:id/cancel', (req, res) => {
  const ride = rides.find(r => r.id === req.params.id)

  if (!ride) {
    return res.json({
      success: false,
      message: 'Ride not found'
    })
  }

  ride.status = 'cancelled'
  ride.cancelledAt = new Date().toISOString()

  const driver = drivers.find(d => d.id === ride.driver.id)
  if (driver) {
    driver.online = true
    driver.lat = ride.driver.lat
    driver.lng = ride.driver.lng
  }

  res.json({
    success: true,
    ride: buildRideResponse(ride)
  })
})

app.listen(PORT, () => {
  console.log('Harvey Taxi live tracking server running on port ' + PORT)
})

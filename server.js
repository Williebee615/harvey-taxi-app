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

  if (value === 'standard' || value === 'standard ride') return 'Standard'
  if (value === 'xl' || value === 'xl ride') return 'XL'
  if (value === 'luxury' || value === 'luxury ride') return 'Luxury'

  return 'Standard'
}

function toRadians(value) {
  return (value * Math.PI) / 180
}

function getDistance(lat1, lng1, lat2, lng2) {
  const R = 3958.8
  const dLat = toRadians(lat2 - lat1)
  const dLng = toRadians(lng2 - lng1)

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2)

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

function moveToward(currentLat, currentLng, targetLat, targetLng, fraction) {
  return {
    lat: currentLat + (targetLat - currentLat) * fraction,
    lng: currentLng + (targetLng - currentLng) * fraction
  }
}

function calculateFare(miles, minutes, type) {
  const rideType = normalizeRideType(type)
  const settings = fareSettings[rideType] || fareSettings.Standard

  const safeMiles = Number(miles) || 8
  const safeMinutes = Number(minutes) || 18

  const base = settings.base
  const distanceCharge = safeMiles * settings.mile
  const timeCharge = safeMinutes * settings.minute
  const booking = settings.booking
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

function getStatusLabel(status) {
  switch (status) {
    case 'matched':
      return 'Driver matched'
    case 'accepted':
      return 'Driver accepted'
    case 'en_route':
      return 'Driver on the way'
    case 'arrived':
      return 'Driver arrived'
    case 'in_progress':
      return 'Trip started'
    case 'completed':
      return 'Trip completed'
    case 'cancelled':
      return 'Ride cancelled'
    default:
      return 'Ride update'
  }
}

function getEtaMinutes(miles, speedMph) {
  if (miles <= 0) return 1
  return Math.max(1, Math.round((miles / speedMph) * 60))
}

function buildRideResponse(ride) {
  const driverToPickupMiles = getDistance(
    ride.driver.lat,
    ride.driver.lng,
    ride.pickupLat,
    ride.pickupLng
  )

  const driverToDropoffMiles = getDistance(
    ride.driver.lat,
    ride.driver.lng,
    ride.dropoffLat,
    ride.dropoffLng
  )

  let etaMinutes = 1
  let remainingMiles = 0

  if (ride.status === 'matched' || ride.status === 'accepted' || ride.status === 'en_route') {
    etaMinutes = getEtaMinutes(driverToPickupMiles, 22)
    remainingMiles = driverToPickupMiles
  } else if (ride.status === 'arrived') {
    etaMinutes = 1
    remainingMiles = 0
  } else if (ride.status === 'in_progress') {
    etaMinutes = getEtaMinutes(driverToDropoffMiles, 28)
    remainingMiles = driverToDropoffMiles
  }

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
    statusLabel: getStatusLabel(ride.status),
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
      distanceAway: Number(driverToPickupMiles.toFixed(1)),
      etaMinutes
    },
    trip: {
      remainingMiles: Number(remainingMiles.toFixed(1))
    }
  }
}

function advanceRide(ride) {
  if (!ride) return
  if (ride.status === 'completed' || ride.status === 'cancelled') return

  if (ride.status === 'matched') {
    ride.status = 'accepted'
    ride.acceptedAt = new Date().toISOString()
    return
  }

  if (ride.status === 'accepted') {
    ride.status = 'en_route'
  }

  if (ride.status === 'en_route') {
    const remainingToPickup = getDistance(
      ride.driver.lat,
      ride.driver.lng,
      ride.pickupLat,
      ride.pickupLng
    )

    if (remainingToPickup <= 0.12) {
      ride.driver.lat = ride.pickupLat
      ride.driver.lng = ride.pickupLng
      ride.status = 'arrived'
      ride.arrivedAt = new Date().toISOString()
      return
    }

    const moved = moveToward(
      ride.driver.lat,
      ride.driver.lng,
      ride.pickupLat,
      ride.pickupLng,
      0.32
    )

    ride.driver.lat = moved.lat
    ride.driver.lng = moved.lng
    return
  }

  if (ride.status === 'arrived') {
    if (!ride.arrivedTickCount) {
      ride.arrivedTickCount = 1
      return
    }

    ride.arrivedTickCount += 1

    if (ride.arrivedTickCount >= 2) {
      ride.status = 'in_progress'
      ride.startedAt = new Date().toISOString()
    }
    return
  }

  if (ride.status === 'in_progress') {
    const remainingToDropoff = getDistance(
      ride.driver.lat,
      ride.driver.lng,
      ride.dropoffLat,
      ride.dropoffLng
    )

    if (remainingToDropoff <= 0.15) {
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
      return
    }

    const moved = moveToward(
      ride.driver.lat,
      ride.driver.lng,
      ride.dropoffLat,
      ride.dropoffLng,
      0.28
    )

    ride.driver.lat = moved.lat
    ride.driver.lng = moved.lng
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
    const distance = Number(req.body.distance) || 8
    const duration = Number(req.body.duration) || 18
    const rideType = normalizeRideType(req.body.rideType)

    res.json({
      success: true,
      distance,
      duration,
      fare: calculateFare(distance, duration, rideType)
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
    const pickup = String(req.body.pickup || 'Pickup')
    const dropoff = String(req.body.dropoff || 'Dropoff')

    const pickupLat = Number(req.body.pickupLat)
    const pickupLng = Number(req.body.pickupLng)

    if (!Number.isFinite(pickupLat) || !Number.isFinite(pickupLng)) {
      return res.json({
        success: false,
        message: 'Pickup GPS location is required'
      })
    }

    const dropoffLat = Number(req.body.dropoffLat) || 36.1245
    const dropoffLng = Number(req.body.dropoffLng) || -86.7093

    const rideType = normalizeRideType(req.body.rideType)
    const distance =
      Number(req.body.distance) ||
      Number(getDistance(pickupLat, pickupLng, dropoffLat, dropoffLng).toFixed(1))
    const duration = Number(req.body.duration) || Math.max(10, Math.round(distance * 2.2))
    const fare = calculateFare(distance, duration, rideType)

    let closestDriver = null
    let closestMiles = Infinity

    drivers.forEach(driver => {
      if (!driver.online) return

      const milesAway = getDistance(pickupLat, pickupLng, driver.lat, driver.lng)

      if (milesAway < closestMiles) {
        closestMiles = milesAway
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

    advanceRide(ride)

    res.json({
      success: true,
      ride: buildRideResponse(ride)
    })
  } catch (error) {
    console.log(error)
    res.json({
      success: false,
      message: 'Live ride update failed'
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

  ride.driver.lat = ride.pickupLat
  ride.driver.lng = ride.pickupLng
  ride.status = 'arrived'
  ride.arrivedAt = new Date().toISOString()

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

  ride.status = 'in_progress'
  ride.startedAt = new Date().toISOString()

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
  console.log('Harvey Taxi live movement server running on port ' + PORT)
})

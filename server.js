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
    phone: '615-555-0101',
    vehicle: 'Toyota Camry',
    plate: 'HTX-101',
    approved: true,
    online: true,
    lat: 36.1627,
    lng: -86.7816
  },
  {
    id: 'driver_2',
    name: 'Alicia Brown',
    phone: '615-555-0102',
    vehicle: 'Honda Accord',
    plate: 'HTX-202',
    approved: true,
    online: true,
    lat: 36.1745,
    lng: -86.7679
  },
  {
    id: 'driver_3',
    name: 'David Carter',
    phone: '615-555-0103',
    vehicle: 'Nissan Altima',
    plate: 'HTX-303',
    approved: true,
    online: true,
    lat: 36.1570,
    lng: -86.8040
  }
]

const fareSettings = {
  Standard: {
    baseFare: 3.5,
    perMile: 1.85,
    perMinute: 0.32,
    bookingFee: 2.25,
    serviceRate: 0.07,
    minimumFare: 8.5
  },
  XL: {
    baseFare: 5.5,
    perMile: 2.6,
    perMinute: 0.45,
    bookingFee: 2.75,
    serviceRate: 0.08,
    minimumFare: 12
  },
  Luxury: {
    baseFare: 8,
    perMile: 3.75,
    perMinute: 0.65,
    bookingFee: 3.5,
    serviceRate: 0.1,
    minimumFare: 18
  }
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

function calculateFare(distance, duration, rideType = 'Standard') {
  const settings = fareSettings[rideType] || fareSettings.Standard

  const miles = Number(distance) || 0
  const minutes = Number(duration) || 0

  const base = settings.baseFare
  const distanceCharge = miles * settings.perMile
  const timeCharge = minutes * settings.perMinute
  const booking = settings.bookingFee
  const subtotal = base + distanceCharge + timeCharge + booking
  const service = subtotal * settings.serviceRate
  let total = subtotal + service

  if (total < settings.minimumFare) {
    total = settings.minimumFare
  }

  return {
    base: Number(base.toFixed(2)),
    distanceCharge: Number(distanceCharge.toFixed(2)),
    timeCharge: Number(timeCharge.toFixed(2)),
    booking: Number(booking.toFixed(2)),
    service: Number(service.toFixed(2)),
    total: Number(total.toFixed(2))
  }
}

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'))
})

app.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'Harvey Taxi API running'
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
    const { id, name, phone, vehicle, plate, lat, lng, online, approved } = req.body

    if (!id) {
      return res.status(400).json({
        success: false,
        message: 'Driver id is required'
      })
    }

    const existingDriver = drivers.find(driver => driver.id === id)

    if (existingDriver) {
      if (name !== undefined) existingDriver.name = name
      if (phone !== undefined) existingDriver.phone = phone
      if (vehicle !== undefined) existingDriver.vehicle = vehicle
      if (plate !== undefined) existingDriver.plate = plate
      if (lat !== undefined) existingDriver.lat = Number(lat)
      if (lng !== undefined) existingDriver.lng = Number(lng)
      if (online !== undefined) existingDriver.online = Boolean(online)
      if (approved !== undefined) existingDriver.approved = Boolean(approved)
    } else {
      drivers.push({
        id,
        name: name || 'New Driver',
        phone: phone || '',
        vehicle: vehicle || 'Vehicle',
        plate: plate || '',
        approved: approved !== undefined ? Boolean(approved) : true,
        online: online !== undefined ? Boolean(online) : true,
        lat: Number(lat) || 36.1627,
        lng: Number(lng) || -86.7816
      })
    }

    res.json({
      success: true,
      message: 'Driver updated successfully',
      drivers
    })
  } catch (error) {
    console.error('Driver update error:', error)
    res.status(500).json({
      success: false,
      message: 'Failed to update driver'
    })
  }
})

app.post('/estimate-fare', (req, res) => {
  try {
    const { distance, duration, rideType } = req.body

    const fare = calculateFare(distance, duration, rideType || 'Standard')

    res.json({
      success: true,
      distance: Number((Number(distance) || 0).toFixed(1)),
      duration: Math.round(Number(duration) || 0),
      rideType: rideType || 'Standard',
      fare
    })
  } catch (error) {
    console.error('Estimate fare error:', error)
    res.status(500).json({
      success: false,
      message: 'Failed to estimate fare'
    })
  }
})

app.post('/request-ride', (req, res) => {
  try {
    const {
      pickup,
      dropoff,
      pickupLat,
      pickupLng,
      dropoffLat,
      dropoffLng,
      distance,
      duration,
      rideType,
      fare
    } = req.body

    if (!pickup || !dropoff) {
      return res.status(400).json({
        success: false,
        message: 'Pickup and dropoff addresses are required'
      })
    }

    if (pickupLat === undefined || pickupLng === undefined) {
      return res.status(400).json({
        success: false,
        message: 'Pickup coordinates are required for driver matching'
      })
    }

    let closestDriver = null
    let closestDistance = Infinity

    drivers.forEach(driver => {
      if (!driver.online || !driver.approved) return
      if (typeof driver.lat !== 'number' || typeof driver.lng !== 'number') return

      const milesAway = getDistance(
        Number(pickupLat),
        Number(pickupLng),
        driver.lat,
        driver.lng
      )

      if (milesAway < closestDistance) {
        closestDistance = milesAway
        closestDriver = driver
      }
    })

    if (!closestDriver) {
      return res.json({
        success: false,
        message: 'No drivers available right now'
      })
    }

    closestDriver.online = false

    const finalFare =
      fare && typeof fare.total === 'number'
        ? fare
        : calculateFare(distance, duration, rideType || 'Standard')

    const etaMinutes = Math.max(3, Math.round((closestDistance / 0.35) + 2))

    const ride = {
      id: `ride_${Date.now()}`,
      pickup,
      dropoff,
      pickupLat: Number(pickupLat),
      pickupLng: Number(pickupLng),
      dropoffLat: dropoffLat !== undefined ? Number(dropoffLat) : null,
      dropoffLng: dropoffLng !== undefined ? Number(dropoffLng) : null,
      distance: Number((Number(distance) || 0).toFixed(1)),
      duration: Math.round(Number(duration) || 0),
      rideType: rideType || 'Standard',
      fare: finalFare,
      status: 'matched',
      createdAt: new Date().toISOString(),
      driver: {
        id: closestDriver.id,
        name: closestDriver.name,
        phone: closestDriver.phone,
        vehicle: closestDriver.vehicle,
        plate: closestDriver.plate,
        lat: closestDriver.lat,
        lng: closestDriver.lng,
        distanceAway: Number(closestDistance.toFixed(1)),
        etaMinutes
      }
    }

    rides.unshift(ride)

    res.json({
      success: true,
      message: 'Driver matched successfully.',
      ride
    })
  } catch (error) {
    console.error('Request ride error:', error)
    res.status(500).json({
      success: false,
      message: 'Server error while requesting ride.'
    })
  }
})

app.get('/rides', (req, res) => {
  res.json({
    success: true,
    rides
  })
})

app.get('/rides/:id', (req, res) => {
  const ride = rides.find(item => item.id === req.params.id)

  if (!ride) {
    return res.status(404).json({
      success: false,
      message: 'Ride not found'
    })
  }

  res.json({
    success: true,
    ride
  })
})

app.post('/rides/:id/cancel', (req, res) => {
  try {
    const ride = rides.find(item => item.id === req.params.id)

    if (!ride) {
      return res.status(404).json({
        success: false,
        message: 'Ride not found'
      })
    }

    ride.status = 'cancelled'
    ride.cancelledAt = new Date().toISOString()

    const driver = drivers.find(d => d.id === ride.driver.id)
    if (driver) {
      driver.online = true
    }

    res.json({
      success: true,
      message: 'Ride cancelled successfully',
      ride
    })
  } catch (error) {
    console.error('Cancel ride error:', error)
    res.status(500).json({
      success: false,
      message: 'Failed to cancel ride'
    })
  }
})

app.post('/rides/:id/complete', (req, res) => {
  try {
    const ride = rides.find(item => item.id === req.params.id)

    if (!ride) {
      return res.status(404).json({
        success: false,
        message: 'Ride not found'
      })
    }

    ride.status = 'completed'
    ride.completedAt = new Date().toISOString()

    const driver = drivers.find(d => d.id === ride.driver.id)
    if (driver) {
      driver.online = true
    }

    res.json({
      success: true,
      message: 'Ride completed successfully',
      ride
    })
  } catch (error) {
    console.error('Complete ride error:', error)
    res.status(500).json({
      success: false,
      message: 'Failed to complete ride'
    })
  }
})

app.get('/:page', (req, res, next) => {
  const requestedFile = path.join(__dirname, 'public', req.params.page)

  if (path.extname(req.params.page)) {
    return res.sendFile(requestedFile, err => {
      if (err) next()
    })
  }

  next()
})

app.listen(PORT, () => {
  console.log(`Harvey Taxi server running on port ${PORT}`)
})

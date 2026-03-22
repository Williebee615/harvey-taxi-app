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
  }
]

const fareSettings = {
  baseFare: 3.5,
  perMile: 1.85,
  perMinute: 0.32,
  minimumFare: 8,
  bookingFee: 2.25,
  serviceFeeRate: 0.08
}

function toMoney(value) {
  return Number(value).toFixed(2)
}

function estimateTrip(pickupAddress, dropoffAddress) {
  const pickup = String(pickupAddress || '').trim()
  const dropoff = String(dropoffAddress || '').trim()

  const combinedLength = pickup.length + dropoff.length
  const distanceMiles = Math.max(3, Math.min(15, combinedLength / 5))
  const durationMinutes = Math.max(8, Math.round(distanceMiles * 2.5))

  return {
    distanceMiles: Number(distanceMiles.toFixed(1)),
    durationMinutes
  }
}

function calculateFare(distanceMiles, durationMinutes) {
  const baseFare = fareSettings.baseFare
  const distanceFare = Number(distanceMiles) * fareSettings.perMile
  const timeFare = Number(durationMinutes) * fareSettings.perMinute
  const subtotal = baseFare + distanceFare + timeFare
  const serviceFee = subtotal * fareSettings.serviceFeeRate

  let totalFare = subtotal + serviceFee + fareSettings.bookingFee

  if (totalFare < fareSettings.minimumFare) {
    totalFare = fareSettings.minimumFare
  }

  return {
    baseFare: toMoney(baseFare),
    distanceFare: toMoney(distanceFare),
    timeFare: toMoney(timeFare),
    bookingFee: toMoney(fareSettings.bookingFee),
    serviceFee: toMoney(serviceFee),
    totalFare: toMoney(totalFare)
  }
}

function estimateAddressPoint(address) {
  const text = String(address || '')
  let sum = 0

  for (let i = 0; i < text.length; i++) {
    sum += text.charCodeAt(i)
  }

  const lat = 36.10 + ((sum % 90) / 1000)
  const lng = -86.90 + ((sum % 120) / 1000)

  return {
    lat: Number(lat.toFixed(4)),
    lng: Number(lng.toFixed(4))
  }
}

function distanceBetween(lat1, lng1, lat2, lng2) {
  const dx = lat1 - lat2
  const dy = lng1 - lng2
  return Math.sqrt(dx * dx + dy * dy) * 69
}

function findNearestDriver(pickupAddress) {
  const pickupPoint = estimateAddressPoint(pickupAddress)

  const availableDrivers = drivers
    .filter((driver) => driver.approved && driver.online)
    .map((driver) => {
      const milesAway = distanceBetween(
        pickupPoint.lat,
        pickupPoint.lng,
        driver.lat,
        driver.lng
      )

      return {
        ...driver,
        milesAway: Number(milesAway.toFixed(1))
      }
    })
    .sort((a, b) => a.milesAway - b.milesAway)

  return availableDrivers[0] || null
}

app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    message: 'Harvey Taxi API is running'
  })
})

app.get('/api/drivers', (req, res) => {
  res.json({
    success: true,
    drivers
  })
})

app.post('/api/drivers/register', (req, res) => {
  try {
    const { name, phone, vehicle, plate } = req.body

    if (!name || !phone || !vehicle || !plate) {
      return res.status(400).json({
        success: false,
        message: 'Name, phone, vehicle, and plate are required.'
      })
    }

    const newDriver = {
      id: `driver_${Date.now()}`,
      name,
      phone,
      vehicle,
      plate,
      approved: false,
      online: false,
      lat: 36.1627,
      lng: -86.7816
    }

    drivers.push(newDriver)

    return res.json({
      success: true,
      message: 'Driver registered successfully.',
      driver: newDriver
    })
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Could not register driver.'
    })
  }
})

app.post('/api/drivers/update-status', (req, res) => {
  try {
    const { driverId, approved, online, lat, lng } = req.body

    const driver = drivers.find((d) => d.id === driverId)

    if (!driver) {
      return res.status(404).json({
        success: false,
        message: 'Driver not found.'
      })
    }

    if (typeof approved === 'boolean') driver.approved = approved
    if (typeof online === 'boolean') driver.online = online
    if (typeof lat === 'number') driver.lat = lat
    if (typeof lng === 'number') driver.lng = lng

    return res.json({
      success: true,
      message: 'Driver updated successfully.',
      driver
    })
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Could not update driver.'
    })
  }
})

app.post('/api/fare/estimate', (req, res) => {
  try {
    const { pickupAddress, dropoffAddress } = req.body

    if (!pickupAddress || !dropoffAddress) {
      return res.status(400).json({
        success: false,
        message: 'Please enter both pickup and dropoff addresses.'
      })
    }

    const trip = estimateTrip(pickupAddress, dropoffAddress)
    const fare = calculateFare(trip.distanceMiles, trip.durationMinutes)
    const matchedDriver = findNearestDriver(pickupAddress)

    return res.json({
      success: true,
      message: 'Fare estimate ready.',
      trip: {
        pickupAddress,
        dropoffAddress,
        distanceMiles: trip.distanceMiles,
        durationMinutes: trip.durationMinutes
      },
      fare,
      driverPreview: matchedDriver
        ? {
            name: matchedDriver.name,
            vehicle: matchedDriver.vehicle,
            plate: matchedDriver.plate,
            milesAway: matchedDriver.milesAway
          }
        : null
    })
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Could not estimate fare.'
    })
  }
})

app.post('/api/rides/request', (req, res) => {
  try {
    const { pickupAddress, dropoffAddress, serviceType } = req.body

    if (!pickupAddress || !dropoffAddress) {
      return res.status(400).json({
        success: false,
        message: 'Please enter both pickup and dropoff addresses.'
      })
    }

    const trip = estimateTrip(pickupAddress, dropoffAddress)
    const fare = calculateFare(trip.distanceMiles, trip.durationMinutes)
    const matchedDriver = findNearestDriver(pickupAddress)

    const ride = {
      id: `ride_${Date.now()}`,
      pickupAddress,
      dropoffAddress,
      serviceType: serviceType || 'Standard Ride',
      trip,
      fare,
      status: matchedDriver ? 'driver_assigned' : 'searching',
      assignedDriver: matchedDriver
        ? {
            id: matchedDriver.id,
            name: matchedDriver.name,
            phone: matchedDriver.phone,
            vehicle: matchedDriver.vehicle,
            plate: matchedDriver.plate,
            milesAway: matchedDriver.milesAway
          }
        : null,
      createdAt: new Date().toISOString()
    }

    rides.push(ride)

    return res.json({
      success: true,
      message: matchedDriver
        ? 'Driver matched successfully.'
        : 'Ride requested. Searching for a driver.',
      ride
    })
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Could not request ride.'
    })
  }
})

app.get('/api/rides', (req, res) => {
  res.json({
    success: true,
    rides
  })
})

app.get('/api/rides/:rideId', (req, res) => {
  const ride = rides.find((r) => r.id === req.params.rideId)

  if (!ride) {
    return res.status(404).json({
      success: false,
      message: 'Ride not found.'
    })
  }

  res.json({
    success: true,
    ride
  })
})

app.post('/api/rides/:rideId/status', (req, res) => {
  try {
    const { status } = req.body

    const allowedStatuses = [
      'searching',
      'driver_assigned',
      'driver_arriving',
      'in_progress',
      'completed',
      'cancelled'
    ]

    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status.'
      })
    }

    const ride = rides.find((r) => r.id === req.params.rideId)

    if (!ride) {
      return res.status(404).json({
        success: false,
        message: 'Ride not found.'
      })
    }

    ride.status = status

    return res.json({
      success: true,
      message: 'Ride status updated.',
      ride
    })
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Could not update ride status.'
    })
  }
})

app.listen(PORT, () => {
  console.log(`Harvey Taxi running on port ${PORT}`)
})

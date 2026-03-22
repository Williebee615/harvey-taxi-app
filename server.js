const express = require('express')
const cors = require('cors')
const path = require('path')

const app = express()
const PORT = process.env.PORT || 10000

app.use(cors())
app.use(express.json())
app.use(express.static(path.join(__dirname, 'public')))

let rides = []
let drivers = []

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

app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    message: 'Harvey Taxi API is running'
  })
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

    return res.json({
      success: true,
      message: 'Fare estimate ready.',
      trip: {
        pickupAddress,
        dropoffAddress,
        distanceMiles: trip.distanceMiles,
        durationMinutes: trip.durationMinutes
      },
      fare
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

    const ride = {
      id: `ride_${Date.now()}`,
      pickupAddress,
      dropoffAddress,
      serviceType: serviceType || 'Standard Ride',
      trip,
      fare,
      status: drivers.length > 0 ? 'matched' : 'searching',
      assignedDriverName: drivers.length > 0 ? drivers[0].name : null,
      createdAt: new Date().toISOString()
    }

    rides.push(ride)

    return res.json({
      success: true,
      message: drivers.length > 0
        ? 'Ride requested and matched with a driver.'
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

app.listen(PORT, () => {
  console.log(`Harvey Taxi running on port ${PORT}`)
})

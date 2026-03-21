const express = require('express')
const cors = require('cors')
const path = require('path')
const Stripe = require('stripe')

const app = express()
const PORT = process.env.PORT || 10000

app.use(cors())
app.use(express.json())
app.use(express.static(path.join(__dirname, 'public')))

const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY)
  : null

let drivers = [
  {
    id: 'driver_1',
    name: 'Marcus Johnson',
    phone: '(615) 555-1001',
    vehicleType: 'Harvey Standard',
    lat: 36.1627,
    lng: -86.7816,
    available: true
  },
  {
    id: 'driver_2',
    name: 'Tanya Brooks',
    phone: '(615) 555-1002',
    vehicleType: 'Harvey XL',
    lat: 36.1699,
    lng: -86.7844,
    available: true
  },
  {
    id: 'driver_3',
    name: 'Derrick Stone',
    phone: '(615) 555-1003',
    vehicleType: 'Delivery',
    lat: 36.1575,
    lng: -86.7732,
    available: true
  }
]

let requests = []

function createId(prefix) {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 100000)}`
}

function getDistance(lat1, lon1, lat2, lon2) {
  const R = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) *
    Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2)

  return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)))
}

function getAmount(serviceType) {
  if (serviceType === 'xl') return 1800
  if (serviceType === 'delivery') return 1500
  if (serviceType === 'food') return 2000
  return 1200
}

function getLabel(serviceType) {
  if (serviceType === 'xl') return 'Harvey XL'
  if (serviceType === 'delivery') return 'Package Delivery'
  if (serviceType === 'food') return 'Food Delivery'
  return 'Harvey Standard'
}

function findNearestDriver(pickup) {
  const availableDrivers = drivers.filter(d => d.available)

  if (!availableDrivers.length) return null

  const sorted = availableDrivers
    .map(driver => ({
      ...driver,
      distance: getDistance(pickup.lat, pickup.lng, driver.lat, driver.lng)
    }))
    .sort((a, b) => a.distance - b.distance)

  return sorted[0] || null
}

function simulateTrip(requestId) {
  setTimeout(() => {
    const request = requests.find(r => r.id === requestId)
    if (!request || request.status === 'cancelled') return
    request.status = 'on_the_way'
  }, 5000)

  setTimeout(() => {
    const request = requests.find(r => r.id === requestId)
    if (!request || request.status === 'cancelled') return
    request.status = 'arrived'
  }, 10000)

  setTimeout(() => {
    const request = requests.find(r => r.id === requestId)
    if (!request || request.status === 'cancelled') return
    request.status = 'completed'

    if (request.driverId) {
      const driver = drivers.find(d => d.id === request.driverId)
      if (driver) driver.available = true
    }
  }, 15000)
}

app.get('/api/health', (req, res) => {
  res.json({ ok: true })
})

app.get('/api/payments/config', (req, res) => {
  if (!process.env.STRIPE_PUBLISHABLE_KEY) {
    return res.status(500).json({ error: 'Missing STRIPE_PUBLISHABLE_KEY' })
  }

  res.json({
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY
  })
})

app.post('/api/request', (req, res) => {
  const {
    riderName,
    riderPhone,
    pickupText,
    destinationText,
    pickupLat,
    pickupLng,
    destinationLat,
    destinationLng,
    serviceType,
    notes
  } = req.body

  if (!pickupText || !destinationText) {
    return res.status(400).json({ error: 'Pickup and destination are required.' })
  }

  const pickup = {
    text: pickupText,
    lat: typeof pickupLat === 'number' ? pickupLat : 36.1627,
    lng: typeof pickupLng === 'number' ? pickupLng : -86.7816
  }

  const destination = {
    text: destinationText,
    lat: typeof destinationLat === 'number' ? destinationLat : 36.1745,
    lng: typeof destinationLng === 'number' ? destinationLng : -86.7679
  }

  const driver = findNearestDriver(pickup)

  const newRequest = {
    id: createId('req'),
    riderName: riderName || 'App User',
    riderPhone: riderPhone || '',
    pickup,
    destination,
    serviceType: serviceType || 'ride',
    serviceLabel: getLabel(serviceType || 'ride'),
    notes: notes || '',
    amount: getAmount(serviceType || 'ride'),
    status: driver ? 'assigned' : 'searching',
    driverId: driver ? driver.id : null,
    driverName: driver ? driver.name : '',
    driverPhone: driver ? driver.phone : '',
    driverVehicle: driver ? driver.vehicleType : '',
    driverLat: driver ? driver.lat : null,
    driverLng: driver ? driver.lng : null,
    paid: false,
    createdAt: new Date().toISOString()
  }

  if (driver) {
    const driverRef = drivers.find(d => d.id === driver.id)
    if (driverRef) driverRef.available = false
    simulateTrip(newRequest.id)
  }

  requests.unshift(newRequest)
  res.json(newRequest)
})

app.get('/api/request/:id', (req, res) => {
  const request = requests.find(r => r.id === req.params.id)
  if (!request) {
    return res.status(404).json({ error: 'Request not found.' })
  }

  res.json(request)
})

app.post('/create-payment-intent', async (req, res) => {
  try {
    if (!stripe) {
      return res.status(500).json({ error: 'Stripe is not configured.' })
    }

    const { amount, requestId } = req.body

    if (!amount || Number(amount) < 50) {
      return res.status(400).json({ error: 'Invalid amount.' })
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount: Number(amount),
      currency: 'usd',
      automatic_payment_methods: { enabled: true },
      metadata: {
        requestId: requestId || ''
      }
    })

    res.json({
      clientSecret: paymentIntent.client_secret
    })
  } catch (error) {
    console.error(error)
    res.status(500).json({ error: error.message })
  }
})

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'))
})

app.get('/payment', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'payment.html'))
})

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`)
})

const express = require('express')
const cors = require('cors')
const path = require('path')
const Stripe = require('stripe')

const app = express()
const PORT = process.env.PORT || 10000

if (!process.env.STRIPE_SECRET_KEY) {
  console.warn('Missing STRIPE_SECRET_KEY')
}
if (!process.env.STRIPE_PUBLISHABLE_KEY) {
  console.warn('Missing STRIPE_PUBLISHABLE_KEY')
}

const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY)
  : null

app.use(cors())
app.use(express.json())
app.use(express.static(path.join(__dirname, 'public')))

let drivers = []
let requests = []

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

function getServiceAmount(type) {
  if (type === 'xl') return 1800
  if (type === 'delivery') return 1500
  if (type === 'food') return 2000
  return 1200
}

app.get('/api/payments/config', (req, res) => {
  if (!process.env.STRIPE_PUBLISHABLE_KEY) {
    return res.status(500).json({ error: 'Missing publishable key' })
  }

  res.json({
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY
  })
})

app.post('/create-payment-intent', async (req, res) => {
  try {
    if (!stripe) {
      return res.status(500).json({ error: 'Stripe is not configured' })
    }

    const { amount } = req.body

    if (!amount || Number(amount) < 50) {
      return res.status(400).json({ error: 'Invalid amount' })
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount: Number(amount),
      currency: 'usd',
      automatic_payment_methods: { enabled: true }
    })

    res.json({
      clientSecret: paymentIntent.client_secret
    })
  } catch (err) {
    console.error('create-payment-intent error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/driver/location', (req, res) => {
  const { driverId, lat, lng, type } = req.body

  let driver = drivers.find(d => d.id === driverId)

  if (!driver) {
    driver = {
      id: driverId,
      lat,
      lng,
      type: type || 'ride',
      available: true
    }
    drivers.push(driver)
  } else {
    driver.lat = lat
    driver.lng = lng
    driver.available = true
    driver.type = type || driver.type
  }

  res.json({ success: true })
})

app.get('/api/drivers/nearby', (req, res) => {
  const lat = Number(req.query.lat)
  const lng = Number(req.query.lng)
  const type = req.query.type

  const nearby = drivers
    .filter(d => d.available && (!type || d.type === type))
    .map(d => ({
      ...d,
      distance: getDistance(lat, lng, d.lat, d.lng)
    }))
    .sort((a, b) => a.distance - b.distance)

  res.json(nearby.slice(0, 5))
})

app.post('/api/request', (req, res) => {
  const {
    pickup,
    destination,
    type,
    notes
  } = req.body

  if (!pickup || !destination || !pickup.lat || !pickup.lng || !destination.lat || !destination.lng) {
    return res.status(400).json({ error: 'Pickup and destination coordinates are required' })
  }

  const requestId = 'req_' + Date.now()

  const newRequest = {
    id: requestId,
    pickup,
    destination,
    type: type || 'ride',
    notes: notes || '',
    amount: getServiceAmount(type || 'ride'),
    status: 'searching',
    paymentStatus: 'unpaid',
    driver: null
  }

  requests.push(newRequest)

  const availableDrivers = drivers
    .filter(d => d.available && d.type === (type || 'ride'))
    .map(d => ({
      ...d,
      distance: getDistance(
        pickup.lat,
        pickup.lng,
        d.lat,
        d.lng
      )
    }))
    .sort((a, b) => a.distance - b.distance)

  if (availableDrivers.length > 0) {
    const chosen = availableDrivers[0]
    newRequest.driver = chosen.id
    newRequest.status = 'assigned'

    const driverIndex = drivers.findIndex(d => d.id === chosen.id)
    if (driverIndex !== -1) {
      drivers[driverIndex].available = false
    }
  }

  res.json(newRequest)
})

app.post('/api/driver/accept', (req, res) => {
  const { driverId, requestId } = req.body

  const request = requests.find(r => r.id === requestId)
  if (!request) return res.status(404).json({ error: 'Request not found' })

  request.status = 'in_progress'
  request.driver = driverId

  res.json({ success: true })
})

app.post('/api/driver/complete', (req, res) => {
  const { requestId } = req.body

  const request = requests.find(r => r.id === requestId)
  if (!request) return res.status(404).json({ error: 'Request not found' })

  request.status = 'completed'

  const driver = drivers.find(d => d.id === request.driver)
  if (driver) driver.available = true

  res.json({ success: true })
})

app.get('/api/request/:id', (req, res) => {
  const request = requests.find(r => r.id === req.params.id)
  if (!request) return res.status(404).json({ error: 'Request not found' })

  const driver = drivers.find(d => d.id === request.driver)

  res.json({
    ...request,
    driverLocation: driver
      ? { lat: driver.lat, lng: driver.lng }
      : null
  })
})

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'))
})

app.get('/request', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'request.html'))
})

app.get('/payment', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'payment.html'))
})

app.get('/driver', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'driver.html'))
})

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`)
})

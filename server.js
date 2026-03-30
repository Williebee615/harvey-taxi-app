app.post('/api/driver/add-earnings', (req, res) => {
try {

const { driverId, amount } = req.body

const data = loadData()

const driver = data.drivers.find(d => d.id === driverId)

if (!driver.wallet) driver.wallet = 0

driver.wallet += amount

saveData(data)

res.send({ success: true })

} catch (err) {
res.status(500).send(err.message)
}
})require('dotenv').config()

const express = require('express')
const cors = require('cors')
const fs = require('fs')
const path = require('path')
const Stripe = require('stripe')

const app = express()
const PORT = process.env.PORT || 10000
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)

app.use(cors())
app.use(express.json())
app.use(express.urlencoded({ extended: true }))
app.use(express.static(path.join(__dirname, 'public')))

const DATA_FILE = path.join(__dirname, 'data.json')
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`
const PLATFORM_FEE_PERCENT = Number(process.env.PLATFORM_FEE_PERCENT || 20)

function loadData() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      return { drivers: [], rides: [], payments: [] }
    }
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'))
  } catch (err) {
    console.error('loadData error:', err.message)
    return { drivers: [], rides: [], payments: [] }
  }
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2))
}

function getDriver(driverId) {
  const data = loadData()
  return data.drivers.find(d => String(d.id) === String(driverId))
}

function updateDriver(driverId, updates) {
  const data = loadData()
  const index = data.drivers.findIndex(d => String(d.id) === String(driverId))
  if (index === -1) return null

  data.drivers[index] = {
    ...data.drivers[index],
    ...updates,
    updatedAt: new Date().toISOString()
  }

  saveData(data)
  return data.drivers[index]
}

function calculateAmounts(amountInCents) {
  const platformFee = Math.round(amountInCents * (PLATFORM_FEE_PERCENT / 100))
  const driverAmount = amountInCents - platformFee
  return { platformFee, driverAmount }
}

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'))
})

app.get('/health', (req, res) => {
  res.json({
    ok: true,
    message: 'Harvey Taxi payment server is running'
  })
})

app.post('/api/drivers/register', (req, res) => {
  try {
    const { id, fullName, email, phone, vehicle } = req.body

    if (!id || !fullName || !email) {
      return res.status(400).json({
        success: false,
        message: 'id, fullName, and email are required'
      })
    }

    const data = loadData()
    const exists = data.drivers.find(d => String(d.id) === String(id))

    if (exists) {
      return res.json({
        success: true,
        message: 'Driver already exists',
        driver: exists
      })
    }

    const driver = {
      id: String(id),
      fullName,
      email,
      phone: phone || '',
      vehicle: vehicle || '',
      approved: true,
      stripeAccountId: '',
      stripeOnboarded: false,
      payoutsEnabled: false,
      chargesEnabled: false,
      createdAt: new Date().toISOString()
    }

    data.drivers.push(driver)
    saveData(data)

    res.json({
      success: true,
      message: 'Driver registered',
      driver
    })
  } catch (err) {
    console.error('register driver error:', err)
    res.status(500).json({
      success: false,
      message: 'Failed to register driver'
    })
  }
})

app.post('/api/stripe/create-connect-account', async (req, res) => {
  try {
    const { driverId, email, fullName } = req.body

    if (!driverId || !email) {
      return res.status(400).json({
        success: false,
        message: 'driverId and email are required'
      })
    }

    const driver = getDriver(driverId)
    if (!driver) {
      return res.status(404).json({
        success: false,
        message: 'Driver not found'
      })
    }

    if (driver.stripeAccountId) {
      return res.json({
        success: true,
        message: 'Stripe account already exists',
        stripeAccountId: driver.stripeAccountId
      })
    }

    const account = await stripe.accounts.create({
      type: 'express',
      email,
      business_type: 'individual',
      metadata: {
        driverId: String(driverId),
        fullName: fullName || driver.fullName || ''
      }
    })

    const updated = updateDriver(driverId, {
      stripeAccountId: account.id
    })

    res.json({
      success: true,
      stripeAccountId: account.id,
      driver: updated
    })
  } catch (err) {
    console.error('create connect account error:', err)
    res.status(500).json({
      success: false,
      message: err.message || 'Failed to create connect account'
    })
  }
})

app.post('/api/stripe/onboard-driver', async (req, res) => {
  try {
    const { driverId } = req.body

    if (!driverId) {
      return res.status(400).json({
        success: false,
        message: 'driverId is required'
      })
    }

    const driver = getDriver(driverId)
    if (!driver || !driver.stripeAccountId) {
      return res.status(404).json({
        success: false,
        message: 'Driver Stripe account not found'
      })
    }

    const accountLink = await stripe.accountLinks.create({
      account: driver.stripeAccountId,
      refresh_url: `${BASE_URL}/stripe-refresh.html?driverId=${driverId}`,
      return_url: `${BASE_URL}/stripe-return.html?driverId=${driverId}`,
      type: 'account_onboarding'
    })

    res.json({
      success: true,
      url: accountLink.url
    })
  } catch (err) {
    console.error('onboard driver error:', err)
    res.status(500).json({
      success: false,
      message: err.message || 'Failed to create onboarding link'
    })
  }
})

app.get('/api/stripe/driver-status/:driverId', async (req, res) => {
  try {
    const driver = getDriver(req.params.driverId)

    if (!driver || !driver.stripeAccountId) {
      return res.status(404).json({
        success: false,
        message: 'Driver Stripe account not found'
      })
    }

    const account = await stripe.accounts.retrieve(driver.stripeAccountId)

    const updated = updateDriver(req.params.driverId, {
      stripeOnboarded: !!account.details_submitted,
      payoutsEnabled: !!account.payouts_enabled,
      chargesEnabled: !!account.charges_enabled
    })

    res.json({
      success: true,
      driver: updated,
      stripeAccount: {
        id: account.id,
        detailsSubmitted: account.details_submitted,
        payoutsEnabled: account.payouts_enabled,
        chargesEnabled: account.charges_enabled
      }
    })
  } catch (err) {
    console.error('driver status error:', err)
    res.status(500).json({
      success: false,
      message: err.message || 'Failed to get driver status'
    })
  }
})

app.post('/api/stripe/express-dashboard-link', async (req, res) => {
  try {
    const { driverId } = req.body

    const driver = getDriver(driverId)
    if (!driver || !driver.stripeAccountId) {
      return res.status(404).json({
        success: false,
        message: 'Driver Stripe account not found'
      })
    }

    const loginLink = await stripe.accounts.createLoginLink(driver.stripeAccountId)

    res.json({
      success: true,
      url: loginLink.url
    })
  } catch (err) {
    console.error('express dashboard link error:', err)
    res.status(500).json({
      success: false,
      message: err.message || 'Failed to create dashboard link'
    })
  }
})

app.post('/api/payments/create-payment-intent', async (req, res) => {
  try {
    const {
      riderName,
      riderEmail,
      driverId,
      amount,
      pickup,
      dropoff,
      currency = 'usd'
    } = req.body

    if (!driverId || !amount) {
      return res.status(400).json({
        success: false,
        message: 'driverId and amount are required'
      })
    }

    const driver = getDriver(driverId)
    if (!driver || !driver.stripeAccountId) {
      return res.status(404).json({
        success: false,
        message: 'Driver Stripe account not found'
      })
    }

    const account = await stripe.accounts.retrieve(driver.stripeAccountId)
    if (!account.charges_enabled) {
      return res.status(400).json({
        success: false,
        message: 'Driver is not fully onboarded with Stripe'
      })
    }

    const amountInCents = Math.round(Number(amount) * 100)
    if (Number.isNaN(amountInCents) || amountInCents < 50) {
      return res.status(400).json({
        success: false,
        message: 'Amount must be at least 0.50'
      })
    }

    const { platformFee, driverAmount } = calculateAmounts(amountInCents)

    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountInCents,
      currency,
      automatic_payment_methods: {
        enabled: true
      },
      application_fee_amount: platformFee,
      transfer_data: {
        destination: driver.stripeAccountId
      },
      receipt_email: riderEmail || undefined,
      metadata: {
        type: 'ride_payment',
        riderName: riderName || '',
        riderEmail: riderEmail || '',
        driverId: String(driverId),
        driverName: driver.fullName || '',
        pickup: pickup || '',
        dropoff: dropoff || '',
        platformFee: String(platformFee),
        driverAmount: String(driverAmount)
      }
    })

    const data = loadData()
    data.payments.push({
      id: paymentIntent.id,
      driverId: String(driverId),
      stripeAccountId: driver.stripeAccountId,
      riderName: riderName || '',
      riderEmail: riderEmail || '',
      pickup: pickup || '',
      dropoff: dropoff || '',
      amount: amountInCents,
      platformFee,
      driverAmount,
      status: paymentIntent.status,
      createdAt: new Date().toISOString()
    })
    saveData(data)

    res.json({
      success: true,
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      amount: amountInCents,
      platformFee,
      driverAmount
    })
  } catch (err) {
    console.error('create payment intent error:', err)
    res.status(500).json({
      success: false,
      message: err.message || 'Failed to create payment intent'
    })
  }
})

app.post('/api/rides/create', (req, res) => {
  try {
    const {
      rideId,
      riderName,
      riderEmail,
      driverId,
      pickup,
      dropoff,
      amount
    } = req.body

    const data = loadData()

    const ride = {
      rideId: rideId || `ride_${Date.now()}`,
      riderName: riderName || '',
      riderEmail: riderEmail || '',
      driverId: driverId || '',
      pickup: pickup || '',
      dropoff: dropoff || '',
      amount: Number(amount || 0),
      status: 'requested',
      createdAt: new Date().toISOString()
    }

    data.rides.push(ride)
    saveData(data)

    res.json({
      success: true,
      ride
    })
  } catch (err) {
    console.error('create ride error:', err)
    res.status(500).json({
      success: false,
      message: 'Failed to create ride'
    })
  }
})

app.listen(PORT, () => {
  console.log(`Harvey Taxi server running on port ${PORT}`)
})
// =============================
// DRIVER INSTANT PAYOUT
// =============================
app.post('/api/driver/payout', async (req, res) => {
try {

const { driverStripeId, amount } = req.body

const payout = await stripe.transfers.create({
amount: amount,
currency: 'usd',
destination: driverStripeId,
})

res.send({
success: true,
payout
})

} catch (err) {
res.status(500).send(err.message)
}
})

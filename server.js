const express = require('express')
const cors = require('cors')
const path = require('path')
const Stripe = require('stripe')

const app = express()
const PORT = process.env.PORT || 10000

// 🔐 Stripe Secret Key (comes from Render ENV)
const stripe = Stripe(process.env.STRIPE_SECRET_KEY)

app.use(cors())
app.use(express.json())
app.use(express.static(path.join(__dirname, 'public')))

// =============================
// USERS + DRIVERS (basic setup)
// =============================
let users = {
  riders: [],
  drivers: []
}

// =============================
// CREATE PAYMENT INTENT
// =============================
app.post('/create-payment-intent', async (req, res) => {
  try {
    const { amount } = req.body

    const paymentIntent = await stripe.paymentIntents.create({
      amount: amount, // in cents
      currency: 'usd',
      automatic_payment_methods: { enabled: true }
    })

    res.send({
      clientSecret: paymentIntent.client_secret
    })
  } catch (err) {
    console.error(err)
    res.status(500).send({ error: err.message })
  }
})

// =============================
// SIMPLE LOGIN (TEMP)
// =============================
app.post('/login', (req, res) => {
  const { email, password } = req.body

  if (email && password) {
    res.send({ success: true })
  } else {
    res.send({ success: false })
  }
})

// =============================
// START SERVER
// =============================
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`)
})

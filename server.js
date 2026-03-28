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

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    app: 'Harvey Taxi API running'
  })
})

/* ---------------- RIDER SIGNUP ---------------- */

app.post('/api/riders/signup', (req, res) => {
  res.json({
    success: true,
    message: "Rider signup working"
  })
})

/* ---------------- DRIVER SIGNUP ---------------- */

app.post('/api/drivers/signup', (req, res) => {
  res.json({
    success: true,
    message: "Driver signup working"
  })
})

/* ---------------- REQUEST RIDE ---------------- */

app.post('/api/rides/request', (req, res) => {
  res.json({
    success: true,
    message: "Ride requested",
    rideId: Date.now()
  })
})

/* ---------------- PAYMENT ---------------- */

app.post('/api/rides/:id/pay', (req, res) => {
  res.json({
    success: true,
    message: "Payment complete"
  })
})

/* ---------------- FALLBACK ---------------- */

app.get('/:page', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'))
})

app.listen(PORT, () => {
  console.log('Harvey Taxi running on port', PORT)
})

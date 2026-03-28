const express = require('express')
const cors = require('cors')
const path = require('path')
const fs = require('fs')

let Stripe = null
try {
  Stripe = require('stripe')
} catch (error) {
  console.log('Stripe package not installed yet. Stripe routes will stay disabled until installed.')
}

const app = express()
const PORT = process.env.PORT || 10000
const DATA_FILE = path.join(__dirname, 'data.json')

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || ''
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`

const stripe =
  Stripe && STRIPE_SECRET_KEY
    ? new Stripe(STRIPE_SECRET_KEY)
    : null

app.use(cors())
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true }))
app.use(express.static(path.join(__dirname, 'public')))

function createDefaultData() {
  return {
    riders: [],
    drivers: [],
    admins: [
      {
        id: 'admin_1',
        name: 'Harvey Admin',
        email: 'admin@harveytaxi.com',
        password: 'admin123',
        role: 'admin'
      }
    ],
    rideRequests: [],
    trips: [],
    emergencyEvents: [],
    settings: {
      baseFare: 5,
      perMile: 1.75,
      perMinute: 0.35,
      bookingFee: 2.5,
      minimumFare: 8,
      cancellationFee: 5
    }
  }
}

function ensureDataFile() {
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(createDefaultData(), null, 2))
  }
}

function readData() {
  ensureDataFile()
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'))
  } catch (error) {
    console.error('Error reading data file:', error)
    return createDefaultData()
  }
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2))
}

function generateId(prefix) {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 100000)}`
}

function sanitizeUser(user) {
  if (!user) return null
  const copy = { ...user }
  delete copy.password
  return copy
}

function toRadians(value) {
  return (value * Math.PI) / 180
}

function getDistanceMiles(lat1, lng1, lat2, lng2) {
  const earthRadiusMiles = 3958.8
  const dLat

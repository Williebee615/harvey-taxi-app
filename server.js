const express = require('express')
const cors = require('cors')
const path = require('path')
const fs = require('fs')

const fetch = (...args) =>
  import('node-fetch').then(({ default: fetch }) => fetch(...args))

const app = express()
const PORT = process.env.PORT || 10000

app.use(cors())
app.use(express.json())
app.use(express.static(path.join(__dirname, 'public')))

const DATA_FILE = path.join(__dirname, 'data.json')

const ADMIN_EMAIL = 'admin@harveytaxi.com'
const ADMIN_PASSWORD = 'HarveyAdmin123'

const FARE_CONFIG = {
  baseFare: 3.5,
  perMile: 2.35,
  bookingFee: 1.5,
  minimumFare: 8.0
}

function ensureDataFile() {
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(
      DATA_FILE,
      JSON.stringify(
        {
          rides: [],
          drivers: [],
          riders: []
        },
        null,
        2
      )
    )
  }
}

function readData() {
  ensureDataFile()
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'))
}

function writeData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2))
}

function toRad(d) {
  return d * Math.PI / 180
}

function distanceMiles(lat1, lon1, lat2, lon2) {
  const R = 3958.8
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) ** 2

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

function canAutoDispatchDriver(driver) {
  return (
    driver &&
    (driver.approved === true || driver.status === 'approved') &&
    driver.online === true &&
    !driver.currentRide &&
    driver

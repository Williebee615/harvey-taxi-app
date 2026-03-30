const express = require('express')
const cors = require('cors')
const fs = require('fs')
const path = require('path')

const app = express()
const PORT = process.env.PORT || 10000

app.use(cors())
app.use(express.json())
app.use(express.static(path.join(__dirname, 'public')))

const DATA_FILE = path.join(__dirname, 'data.json')

function loadData() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      return { drivers: [], rides: [] }
    }

    return JSON.parse(fs.readFileSync(DATA_FILE))
  } catch {
    return { drivers: [], rides: [] }
  }
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2))
}

function getDriver(data, id) {
  let driver = data.drivers.find(d => d.id === id)

  if (!driver) {
    driver = {
      id,
      name: "Auto Driver",
      wallet: 0,
      totalTrips: 0,
      totalEarnings: 0
    }

    data.drivers.push(driver)
  }

  return driver
}

/* CREATE RIDE */
app.post('/api/rides/create', (req, res) => {
  const data = loadData()

  const { fare, driverId } = req.body

  const driver = getDriver(data, driverId)

  const ride = {
    id: 'ride_' + Date.now(),
    driverId,
    fare,
    status: "assigned"
  }

  data.rides.push(ride)
  saveData(data)

  res.json({ success: true, ride })
})

/* COMPLETE RIDE AUTO */
app.post('/api/rides/complete', (req, res) => {
  const data = loadData()

  const { rideId } = req.body

  const ride = data.rides.find(r => r.id === rideId)

  if (!ride) {
    return res.json({ success: false })
  }

  const driver = getDriver(data, ride.driverId)

  const platformFee = ride.fare * 0.20
  const driverPay = ride.fare - platformFee

  driver.wallet += driverPay
  driver.totalTrips += 1
  driver.totalEarnings += driverPay

  ride.status = "completed"

  saveData(data)

  res.json({
    success: true,
    driverWallet: driver.wallet
  })
})

/* WALLET */
app.get('/api/driver/wallet/:id', (req, res) => {
  const data = loadData()

  const driver = getDriver(data, req.params.id)

  res.json(driver)
})

app.listen(PORT, () => {
  console.log("Harvey Taxi Autonomous Server Running")
})

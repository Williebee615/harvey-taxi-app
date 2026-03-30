const express = require('express')
const cors = require('cors')
const path = require('path')
const fs = require('fs')

const app = express()
const PORT = process.env.PORT || 10000

app.use(cors())
app.use(express.json())
app.use(express.static('public'))

const DATA_FILE = './data.json'

function loadData() {
  if (!fs.existsSync(DATA_FILE)) {
    return { drivers: {} }
  }
  return JSON.parse(fs.readFileSync(DATA_FILE))
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2))
}

/* ===============================
   REGISTER DRIVER
================================ */
app.post('/api/drivers/register', (req, res) => {
  const { id, name } = req.body
  const data = loadData()

  if (!data.drivers[id]) {
    data.drivers[id] = {
      id,
      name,
      wallet: 0
    }
  }

  saveData(data)

  res.json({
    success: true,
    driver: data.drivers[id]
  })
})

/* ===============================
   ADD EARNINGS
================================ */
app.post('/api/driver/add-earnings', (req, res) => {
  const { driverId, amount } = req.body
  const data = loadData()

  if (!data.drivers[driverId]) {
    return res.status(404).json({
      error: 'Driver not found'
    })
  }

  data.drivers[driverId].wallet += Number(amount)

  saveData(data)

  res.json({
    success: true,
    wallet: data.drivers[driverId].wallet
  })
})

/* ===============================
   GET WALLET
================================ */
app.get('/api/driver/wallet/:driverId', (req, res) => {
  const { driverId } = req.params
  const data = loadData()

  if (!data.drivers[driverId]) {
    return res.json({ wallet: 0 })
  }

  res.json({
    wallet: data.drivers[driverId].wallet
  })
})

app.listen(PORT, () => {
  console.log('Harvey Taxi Server Running')
  console.log('Your service is live 🎉')
})
